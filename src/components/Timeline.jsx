import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { flushSync } from 'react-dom';
import { useStore, clipDur, clipEnd, projectDuration, packMain } from '../store';
import { beatTimes } from '../audioPro';
import { Icon } from '../icons';
import {
  addMediaToTimeline, createTrack, placeClip, insertionOrder, splitAtPlayhead, deleteSelection,
  duplicateSelection, copySelection, seek, trackKindFor, openCrop, nextTextTrackName, freezeFrame, reverseClip, addKeyframesHere,
} from '../ops';
import { dragPointer, fmtDuration, clamp } from '../util';
import { MEDIA_DRAG_TYPE } from './MediaPanel.jsx';
import { withAudio, needsProxy } from '../audio';
import { effSpeed, sourceAt, fmtSpeed } from '../speed';
import { keyframeTimes, shiftKeyframes } from '../keyframes';
import { EFFECT_LABEL } from '../effects';

const HEADER_W = 148;
const RULER_H = 30;
const SNAP_PX = 8;
const MIN_CLIP = 0.1;
const WIN_STEP = 400;
const trackHeight = (t) => (t.kind === 'audio' ? 48 : t.main ? 72 : 58);

// Posição de rolagem fica fora do estado principal para não redesenhar os clipes ao rolar.
const useView = create(() => ({ scrollLeft: 0, viewW: 800, scrubbing: false }));

export default function Timeline() {
  const project = useStore((s) => s.project);
  const media = useStore((s) => s.media);
  const cache = useStore((s) => s.cache);
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.zoom);
  const scrollRef = useRef(null);
  const rowRefs = useRef(new Map());
  const [snapLine, setSnapLine] = useState(null);
  const [newTrackHint, setNewTrackHint] = useState(null);
  const [dropGhost, setDropGhost] = useState(null);
  const [menu, setMenu] = useState(null);
  const viewW = useView((s) => s.viewW);
  // Só os clipes perto da parte visível são montados (projetos grandes ficam leves). A janela é medida em blocos
  // de 400 px para a rolagem não redesenhar a cada pixel.
  const winKey = useView((s) => `${Math.floor(s.scrollLeft / WIN_STEP)}:${Math.floor((s.scrollLeft + s.viewW) / WIN_STEP)}`);
  const [wLo, wHi] = winKey.split(':').map(Number);
  const pxFrom = (wLo - 1) * WIN_STEP;
  const pxTo = (wHi + 2) * WIN_STEP;

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const total = projectDuration(project);
  const laneW = Math.max(viewW - HEADER_W, (total + Math.max(30, total * 0.3)) * zoom);
  const selected = new Set(selection);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const update = () => useView.setState({ scrollLeft: el.scrollLeft, viewW: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  // Roda do mouse: zoom mantendo fixo o ponto sob o cursor.
  // Shift + roda: rolar para os lados. Alt + roda: rolar as trilhas para cima/baixo.
  useEffect(() => {
    const el = scrollRef.current;
    const pending = { factor: 1, mx: 0, raf: 0 };
    const onWheel = (e) => {
      if (e.altKey) {
        e.preventDefault();
        el.scrollTop += e.deltaY;
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY || e.deltaX;
        return;
      }
      // Touchpad deslizando para os lados: deixa rolar normalmente.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      // Vários eventos da roda no mesmo quadro viram um só zoom (mouse de 1000 Hz / touchpad).
      const rect = el.getBoundingClientRect();
      pending.mx = Math.max(0, e.clientX - rect.left - HEADER_W);
      // Passo proporcional ao giro: suave no touchpad, ~20% por "clique" da roda.
      pending.factor *= Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.06 : 0.0018));
      if (!pending.raf)
        pending.raf = requestAnimationFrame(() => {
          const s = useStore.getState();
          const t = (el.scrollLeft + pending.mx) / s.zoom;
          const z = clamp(s.zoom * pending.factor, 2, 600);
          pending.factor = 1;
          pending.raf = 0;
          // flushSync: a largura da linha do tempo já está nova quando ajustamos a rolagem (sem "pulo" de um quadro).
          flushSync(() => s.setZoom(z));
          el.scrollLeft = t * z - pending.mx;
        });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const rows = () =>
    project.tracks
      .map((t) => ({ track: t, el: rowRefs.current.get(t.id) }))
      .filter((r) => r.el)
      .map((r) => ({ ...r, rect: r.el.getBoundingClientRect() }));

  // Qual trilha está sob o ponteiro: objeto da trilha, 'above' ou 'below'.
  const trackAtY = (y) => {
    const list = rows();
    if (!list.length) return null;
    if (y < list[0].rect.top) return 'above';
    if (y > list[list.length - 1].rect.bottom) return 'below';
    const r = list.find((r) => y >= r.rect.top && y <= r.rect.bottom);
    if (r) return r.track;
    const between = list.find((r) => y < r.rect.top);
    return between ? between.track : 'below';
  };

  const timeAtX = (clientX) => {
    const el = scrollRef.current;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / useStore.getState().zoom);
  };

  // ---------- mover clipes ----------
  const onClipDown = (e, clip) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const s = useStore.getState();
    let sel = s.selection;
    if (e.shiftKey || e.ctrlKey) {
      s.select(sel.includes(clip.id) ? sel.filter((i) => i !== clip.id) : [...sel, clip.id]);
      return;
    }
    if (!sel.includes(clip.id)) {
      sel = [clip.id];
      s.select(sel);
    }
    const p = s.project;
    const trackById = new Map(p.tracks.map((t) => [t.id, t]));
    const moving = p.clips.filter((c) => sel.includes(c.id) && !trackById.get(c.trackId).locked);
    if (!moving.some((c) => c.id === clip.id)) return;
    const ids = new Set(moving.map((c) => c.id));
    const orig = new Map(moving.map((c) => [c.id, c.start]));
    const minStart = Math.min(...moving.map((c) => c.start));
    const kind = trackById.get(clip.trackId).kind;
    const dur = clipDur(clip);
    const z = s.zoom;
    const sx = e.clientX;
    const sy = e.clientY;
    const targets = snapTargets(p, ids, s.currentTime);
    let started = false;
    let newSide = null;
    let targetTrack = null;
    let lastDelta = 0;

    dragPointer(
      e,
      (ev) => {
        if (!started) {
          if (Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
          started = true;
          useStore.getState().gestureStart();
        }
        let ns = Math.max(0, orig.get(clip.id) + (ev.clientX - sx) / z);
        let at = null;
        if (p.settings.snap) {
          const r = snapEdges(ns, dur, targets, SNAP_PX / z);
          if (r) {
            ns = r.start;
            at = r.at;
          }
        }
        const delta = Math.max(ns - orig.get(clip.id), -minStart);
        lastDelta = delta;
        newSide = null;
        targetTrack = null;
        if (moving.length === 1) {
          const hitT = trackAtY(ev.clientY);
          if (hitT === 'above' && kind === 'video') newSide = 'above';
          else if (hitT === 'below' && kind === 'audio') newSide = 'below';
          else if (hitT && typeof hitT === 'object' && hitT.kind === kind && !hitT.locked && !(clip.kind && hitT.main)) targetTrack = hitT.id;
        }
        setSnapLine(at);
        setNewTrackHint(newSide);
        useStore.getState().live((q) => {
          for (const c of q.clips) {
            if (!ids.has(c.id)) continue;
            c.start = orig.get(c.id) + delta;
            if (targetTrack) c.trackId = targetTrack;
          }
        });
      },
      () => {
        setSnapLine(null);
        setNewTrackHint(null);
        if (!started) return;
        useStore.getState().gestureEnd((q) => {
          if (newSide) {
            const t = createTrack(q, kind, newSide === 'above' ? q.tracks[0].id : undefined, clip.kind ? nextTextTrackName(q, clip) : undefined);
            q.clips.find((c) => c.id === clip.id).trackId = t.id;
          }
          const main = q.tracks.find((t) => t.main);
          const moved = q.clips.filter((c) => ids.has(c.id));
          if (q.settings.magnet && moved.some((c) => c.trackId === main.id)) packMain(q, insertionOrder(q, ids, undefined, lastDelta));
          for (const c of moved) if (c.trackId !== main.id || !q.settings.magnet) placeClip(q, c, ids);
        });
      },
    );
  };

  // ---------- aparar (bordas do clipe) ----------
  const onTrimDown = (e, clip, side) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setMenu(null);
    const s = useStore.getState();
    s.select([clip.id]);
    const p = s.project;
    const track = p.tracks.find((t) => t.id === clip.trackId);
    if (track.locked) return;
    const m = mediaById.get(clip.mediaId);
    const isImage = !m || m.type === 'image'; // imagens e textos podem ter qualquer duração
    const speed = effSpeed(clip);
    const magnetMain = track.main && p.settings.magnet;
    const others = p.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id);
    const end0 = clipEnd(clip);
    const prevEnd = magnetMain ? 0 : Math.max(0, ...others.filter((c) => clipEnd(c) <= clip.start + 1e-3).map(clipEnd));
    const nextStart = magnetMain ? Infinity : Math.min(Infinity, ...others.filter((c) => c.start >= end0 - 1e-3).map((c) => c.start));
    const targets = snapTargets(p, new Set([clip.id]), s.currentTime);
    const z = s.zoom;
    const sx = e.clientX;
    s.gestureStart();

    dragPointer(
      e,
      (ev) => {
        const dt = (ev.clientX - sx) / z;
        let at = null;
        const snap = (v) => {
          if (!p.settings.snap) return v;
          const r = nearest(v, targets, SNAP_PX / z);
          if (r === null) return v;
          at = r;
          return r;
        };
        useStore.getState().live((q) => {
          const c = q.clips.find((x) => x.id === clip.id);
          if (side === 'l') {
            if (magnetMain) {
              // Na trilha principal com ímã, cortar o início puxa o resto para a esquerda.
              const maxCut = clipDur(clip) - MIN_CLIP;
              const cut = clamp(dt, isImage ? -Infinity : -clip.in / speed, maxCut);
              if (isImage) c.out = clip.out - cut * speed;
              else c.in = clip.in + cut * speed;
              c.keyframes = clip.keyframes && structuredClone(clip.keyframes);
              shiftKeyframes(c, -cut);
              packMain(q);
            } else {
              const lower = isImage ? prevEnd : Math.max(prevEnd, clip.start - clip.in / speed);
              const ns = clamp(snap(clip.start + dt), lower, end0 - MIN_CLIP);
              if (isImage) c.out = clip.in + (end0 - ns) * speed;
              else c.in = clip.in + (ns - clip.start) * speed;
              c.keyframes = clip.keyframes && structuredClone(clip.keyframes);
              shiftKeyframes(c, -(ns - clip.start));
              c.start = ns;
            }
          } else {
            const maxEnd = isImage ? Infinity : clip.start + (m.duration - clip.in) / speed;
            const ne = clamp(snap(end0 + dt), clip.start + MIN_CLIP, Math.min(nextStart, maxEnd));
            c.out = clip.in + (ne - clip.start) * speed;
            if (magnetMain) packMain(q);
          }
        });
        setSnapLine(at);
      },
      () => {
        setSnapLine(null);
        useStore.getState().gestureEnd();
      },
    );
  };

  // ---------- fades (bolinhas no topo do clipe) ----------
  const onFadeDown = (e, clip, side) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = useStore.getState();
    s.select([clip.id]);
    if (s.project.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    const dur = clipDur(clip);
    const orig = withAudio(clip.audio);
    const z = s.zoom;
    const sx = e.clientX;
    s.gestureStart();
    dragPointer(
      e,
      (ev) => {
        const dx = (ev.clientX - sx) / z;
        useStore.getState().live((q) => {
          const c = q.clips.find((x) => x.id === clip.id);
          const a = withAudio(c.audio);
          const round = (v) => Math.round(v * 20) / 20;
          if (side === 'in') a.fadeIn = round(clamp(orig.fadeIn + dx, 0, Math.min(10, dur - a.fadeOut)));
          else a.fadeOut = round(clamp(orig.fadeOut - dx, 0, Math.min(10, dur - a.fadeIn)));
          c.audio = a;
        });
      },
      () => useStore.getState().gestureEnd(),
    );
  };

  // ---------- arrastar mídia do painel ----------
  const dropTarget = (e) => {
    const id = e.dataTransfer.getData(MEDIA_DRAG_TYPE);
    return id ? mediaById.get(id) : null;
  };
  const onDragOver = (e) => {
    if (![...e.dataTransfer.types].includes(MEDIA_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const hitT = trackAtY(e.clientY);
    setDropGhost({ x: timeAtX(e.clientX), track: typeof hitT === 'object' ? hitT?.id : hitT });
  };
  const onDrop = (e) => {
    const m = dropTarget(e);
    setDropGhost(null);
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    if (m.missing) return;
    const hitT = trackAtY(e.clientY);
    const kind = trackKindFor(m);
    const start = timeAtX(e.clientX);
    if (hitT && typeof hitT === 'object' && hitT.kind === kind && !hitT.locked) addMediaToTimeline(m, { trackId: hitT.id, start });
    else addMediaToTimeline(m, { newTrack: true, start, nearTrackId: hitT === 'above' ? project.tracks[0].id : typeof hitT === 'object' ? hitT?.id : undefined });
  };

  // Clicar (ou arrastar) num espaço vazio leva a barra branca até ali.
  const onLaneDown = (e) => {
    if (e.button !== 0) return;
    setMenu(null);
    useStore.getState().select([]);
    startScrub(e, scrollRef.current);
  };

  const onContextMenu = (e, clip) => {
    e.preventDefault();
    const s = useStore.getState();
    if (!s.selection.includes(clip.id)) s.select([clip.id]);
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // Funções estáveis para os clipes: sem isso, cada alteração no projeto (até arrastar um slider)
  // recria os handlers e a linha do tempo inteira é redesenhada, mesmo com o React.memo do clipe.
  const hx = useRef({});
  hx.current = { onClipDown, onTrimDown, onFadeDown, onContextMenu };
  const stable = useMemo(
    () => ({
      onDown: (...a) => hx.current.onClipDown(...a),
      onTrim: (...a) => hx.current.onTrimDown(...a),
      onFade: (...a) => hx.current.onFadeDown(...a),
      onContextMenu: (...a) => hx.current.onContextMenu(...a),
    }),
    [],
  );

  const fit = () => {
    const el = scrollRef.current;
    const t = projectDuration(useStore.getState().project);
    if (t > 0) useStore.getState().setZoom((el.clientWidth - HEADER_W - 40) / t);
    el.scrollLeft = 0;
  };

  return (
    <section className="timeline" onClick={() => menu && setMenu(null)}>
      <Toolbar onFit={fit} />
      <div className="tl-scroll" ref={scrollRef} onDragOver={onDragOver} onDrop={onDrop} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setDropGhost(null)}>
        <div className="tl-inner" style={{ width: HEADER_W + laneW }}>
          <div className="tl-ruler-row" style={{ height: RULER_H }}>
            <div className="tl-corner" style={{ width: HEADER_W }}>
              <span className="muted small-text">Trilhas</span>
            </div>
            <Ruler fps={project.settings.fps} scrollRef={scrollRef} />
          </div>
          <div className={'tl-tracks' + (newTrackHint === 'above' ? ' hint-above' : '') + (newTrackHint === 'below' ? ' hint-below' : '')}>
            {project.tracks.map((track) => (
              <div className={`track-row ${track.kind}` + (track.main ? ' main' : '') + (dropGhost?.track === track.id ? ' drop-on' : '')} key={track.id} ref={(el) => (el ? rowRefs.current.set(track.id, el) : rowRefs.current.delete(track.id))} style={{ height: trackHeight(track) }}>
                <TrackHeader track={track} />
                <div className={'lane' + (track.locked ? ' locked' : '')} onPointerDown={onLaneDown}>
                  {project.clips
                    .filter((c) => c.trackId === track.id && (selected.has(c.id) || (clipEnd(c) * zoom >= pxFrom && c.start * zoom <= pxTo)))
                    .map((c) => (
                      <Clip
                        key={c.id}
                        clip={c}
                        media={mediaById.get(c.mediaId)}
                        cache={cache[c.mediaId]}
                        zoom={zoom}
                        height={trackHeight(track)}
                        selected={selected.has(c.id)}
                        hidden={track.hidden}
                        asAudio={track.kind === 'audio'}
                        onDown={stable.onDown}
                        onTrim={stable.onTrim}
                        onFade={stable.onFade}
                        onContextMenu={stable.onContextMenu}
                      />
                    ))}
                </div>
              </div>
            ))}
            {project.clips.length === 0 && (
              <div className="tl-empty" style={{ marginLeft: HEADER_W }}>
                <Icon name="film" size={20} /> Arraste mídia para cá ou use o botão <b>+</b> no painel de mídia.
              </div>
            )}
          </div>
          {snapLine !== null && <div className="snap-line" style={{ left: HEADER_W + snapLine * zoom }} />}
          {dropGhost && <div className="drop-line" style={{ left: HEADER_W + dropGhost.x * zoom }} />}
          <Playhead scrollRef={scrollRef} />
        </div>
      </div>
      {menu && <ClipMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </section>
  );
}

// ---------- snapping ----------

function snapTargets(p, exclude, playhead) {
  const t = [0, playhead];
  const cache = useStore.getState().cache;
  for (const c of p.clips) {
    // Batidas da música (marcadas no clipe) também atraem os clipes arrastados.
    if (c.audio?.beats && !c.kind) t.push(...beatTimes(c, cache[c.mediaId]?.wave));
    if (exclude.has(c.id)) continue;
    t.push(c.start, clipEnd(c));
  }
  return t;
}

function nearest(v, targets, threshold) {
  let best = null;
  let bestD = threshold;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function snapEdges(start, dur, targets, threshold) {
  const a = nearest(start, targets, threshold);
  const b = nearest(start + dur, targets, threshold);
  if (a === null && b === null) return null;
  if (b === null || (a !== null && Math.abs(a - start) <= Math.abs(b - start - dur))) return { start: a, at: a };
  return { start: b - dur, at: b };
}

// ---------- partes ----------

function Toolbar({ onFit }) {
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasSel = useStore((s) => s.selection.length > 0);
  const canCrop = useStore((s) => {
    if (s.selection.length !== 1) return false;
    const c = s.project.clips.find((x) => x.id === s.selection[0]);
    const m = c && s.media.find((x) => x.id === c.mediaId);
    return !!m && m.type !== 'audio';
  });
  const zoom = useStore((s) => s.zoom);
  const settings = useStore((s) => s.project.settings);
  const toggle = (key) => useStore.getState().commit((p) => (p.settings[key] = !p.settings[key]));
  // Zoom em escala logarítmica para o slider ficar suave.
  const zToSlider = (z) => Math.log(z / 2) / Math.log(300);
  const sliderToZ = (v) => 2 * Math.pow(300, v);

  return (
    <div className="tl-toolbar">
      <div className="tool-group">
        <button className="icon-btn" disabled={!canUndo} onClick={() => useStore.getState().undo()} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => useStore.getState().redo()} title="Refazer (Ctrl+Y)" aria-label="Refazer">
          <Icon name="redo" />
        </button>
        <span className="tool-sep" />
        <button className="icon-btn" onClick={splitAtPlayhead} title="Dividir no cursor (S / Ctrl+B)" aria-label="Dividir">
          <Icon name="split" />
        </button>
        <button className="icon-btn" disabled={!hasSel} onClick={duplicateSelection} title="Duplicar (Ctrl+D)" aria-label="Duplicar">
          <Icon name="duplicate" />
        </button>
        <button className="icon-btn" onClick={() => useStore.setState({ recordOpen: true })} title="Gravar narração (R)" aria-label="Gravar narração">
          <Icon name="mic" />
        </button>
        <button className="icon-btn" disabled={!hasSel} onClick={addKeyframesHere} title="Adicionar keyframe em tudo neste instante (K)" aria-label="Adicionar keyframe">
          <Icon name="keyframe" />
        </button>
        <button className="icon-btn" onClick={() => freezeFrame()} title="Congelar quadro (F)" aria-label="Congelar quadro">
          <Icon name="freeze" />
        </button>
        <button className="icon-btn" disabled={!canCrop} onClick={openCrop} title="Recortar (C)" aria-label="Recortar">
          <Icon name="crop" />
        </button>
        <button className="icon-btn" disabled={!hasSel} onClick={deleteSelection} title="Excluir (Delete)" aria-label="Excluir">
          <Icon name="trash" />
        </button>
      </div>
      <div className="tool-group">
        <button className={'icon-btn' + (settings.magnet ? ' active' : '')} onClick={() => toggle('magnet')} title="Ímã da trilha principal" aria-pressed={settings.magnet}>
          <Icon name="magnet" />
        </button>
        <button className={'icon-btn' + (settings.snap ? ' active' : '')} onClick={() => toggle('snap')} title="Encaixe automático" aria-pressed={settings.snap}>
          <Icon name="snap" />
        </button>
        <span className="tool-sep" />
        <button className="icon-btn" onClick={() => useStore.getState().setZoom(zoom / 1.25)} title="Menos zoom (-)" aria-label="Menos zoom">
          <Icon name="zoomOut" />
        </button>
        <input className="zoom-slider" type="range" min={0} max={1} step={0.001} value={zToSlider(zoom)} onChange={(e) => useStore.getState().setZoom(sliderToZ(Number(e.target.value)))} aria-label="Zoom" />
        <button className="icon-btn" onClick={() => useStore.getState().setZoom(zoom * 1.25)} title="Mais zoom (+)" aria-label="Mais zoom">
          <Icon name="zoomIn" />
        </button>
        <button className="icon-btn" onClick={onFit} title="Ajustar à janela" aria-label="Ajustar à janela">
          <Icon name="fit" />
        </button>
      </div>
    </div>
  );
}

function TrackHeader({ track }) {
  const set = (patch) => useStore.getState().commit((p) => Object.assign(p.tracks.find((t) => t.id === track.id), patch));
  return (
    <div className="track-head" style={{ width: HEADER_W }}>
      <div className="track-name">
        <Icon name={track.kind === 'audio' ? 'music' : track.name.startsWith('Texto') ? 'text' : 'film'} size={14} />
        <span title={track.name}>{track.name}</span>
      </div>
      <div className="track-btns">
        {track.kind === 'video' && (
          <button className={'mini-btn' + (track.hidden ? ' off' : '')} onClick={() => set({ hidden: !track.hidden })} title={track.hidden ? 'Mostrar trilha' : 'Ocultar trilha'} aria-label={track.hidden ? 'Mostrar trilha' : 'Ocultar trilha'}>
            <Icon name={track.hidden ? 'eyeOff' : 'eye'} size={15} />
          </button>
        )}
        <button className={'mini-btn' + (track.muted ? ' off' : '')} onClick={() => set({ muted: !track.muted })} title={track.muted ? 'Ativar som' : 'Silenciar trilha'} aria-label={track.muted ? 'Ativar som' : 'Silenciar trilha'}>
          <Icon name={track.muted ? 'mute' : 'volume'} size={15} />
        </button>
        <button className={'mini-btn' + (track.locked ? ' off' : '')} onClick={() => set({ locked: !track.locked })} title={track.locked ? 'Desbloquear' : 'Bloquear'} aria-label={track.locked ? 'Desbloquear' : 'Bloquear'}>
          <Icon name={track.locked ? 'lock' : 'unlock'} size={15} />
        </button>
      </div>
    </div>
  );
}

const Clip = memo(function Clip({ clip, media, cache, zoom, height, selected, hidden, asAudio, onDown, onTrim, onFade, onContextMenu }) {
  if (clip.kind === 'effect') return <EffectClip clip={clip} zoom={zoom} selected={selected} hidden={hidden} onDown={onDown} onTrim={onTrim} onContextMenu={onContextMenu} />;
  if (clip.kind === 'text') return <TextClip clip={clip} zoom={zoom} selected={selected} hidden={hidden} onDown={onDown} onTrim={onTrim} onContextMenu={onContextMenu} />;
  if (!media) return null;
  const width = Math.max(4, clipDur(clip) * zoom);
  // Vídeo na trilha de áudio (áudio separado) aparece como clipe de áudio.
  const isAudio = media.type === 'audio' || asAudio;
  const hasSound = media.hasAudio && !clip.audioDetached;
  const showWave = hasSound && cache?.wave;
  const filmH = isAudio ? 0 : showWave ? height - 18 : height;
  const fx = withAudio(clip.audio);
  const fadeInW = Math.min(width, fx.fadeIn * zoom);
  const fadeOutW = Math.min(width, fx.fadeOut * zoom);
  const fxOn = needsProxy(clip.audio);
  return (
    <div
      className={`clip ${isAudio ? 'audio' : media.type}` + (selected ? ' selected' : '') + (hidden ? ' dim' : '') + (media.missing ? ' missing' : '')}
      style={{ left: clip.start * zoom, width }}
      onPointerDown={(e) => onDown(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
    >
      {!isAudio && <Filmstrip clip={clip} media={media} thumbs={cache?.thumbs} width={width} height={filmH} zoom={zoom} />}
      {fx.beats && showWave && <BeatMarks clip={clip} wave={cache.wave} zoom={zoom} />}
      {showWave && <Waveform clip={clip} wave={cache.wave} width={width} height={isAudio ? height - 4 : 18} color={isAudio ? '#41d6a0' : '#7fc6ff'} />}
      <div className="clip-label">
        <span className="clip-name">{media.name}</span>
        <span className="clip-dur">{fmtDuration(clipDur(clip))}</span>
        {(clip.volume === 0 || clip.audioDetached) && <Icon name="mute" size={12} />}
        {fxOn && hasSound && <span className="clip-fx" title="Tem efeito de áudio">FX</span>}
        {clip.audio?.duck?.on && <span className="clip-fx" title="Ducking automático ligado">Duck</span>}
        {clip.curve ? <span className="clip-badge" title="Curva de velocidade">Curva</span> : (clip.speed || 1) !== 1 && <span className="clip-badge" title="Velocidade">{fmtSpeed(clip.speed)}</span>}
        {clip.reversedFrom && <span className="clip-badge" title="Reverso">↺</span>}
      </div>
      {clip.transition && (
        <span className="tr-mark" style={{ width: Math.max(8, clip.transition.dur * zoom) }} title={`Transição: ${clip.transition.type} (${clip.transition.dur}s)`}>
          <Icon name="transition" size={12} />
        </span>
      )}
      <div style={{ display: 'none' }}>
      </div>
      {hasSound && fadeInW > 0.5 && (
        <svg className="fade-wedge l" width={fadeInW} height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0H100L0 100Z" />
        </svg>
      )}
      {hasSound && fadeOutW > 0.5 && (
        <svg className="fade-wedge r" width={fadeOutW} height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0H100V100Z" />
        </svg>
      )}
      {hasSound && selected && width > 40 && (
        <>
          <span className="fade-handle" style={{ left: Math.max(6, fadeInW) }} onPointerDown={(e) => onFade(e, clip, 'in')} title="Arraste para criar fade de entrada" />
          <span className="fade-handle" style={{ left: Math.min(width - 6, width - fadeOutW) }} onPointerDown={(e) => onFade(e, clip, 'out')} title="Arraste para criar fade de saída" />
        </>
      )}
      {selected && <KfDots clip={clip} zoom={zoom} />}
      <div className="trim l" onPointerDown={(e) => onTrim(e, clip, 'l')} />
      <div className="trim r" onPointerDown={(e) => onTrim(e, clip, 'r')} />
    </div>
  );
});

// Losangos dos keyframes; clicar leva a barra branca até ele.
function KfDots({ clip, zoom }) {
  const times = keyframeTimes(clip);
  if (!times.length) return null;
  return times.map((t) => (
    <span
      key={t}
      className="kf-dot"
      style={{ left: t * zoom }}
      title="Keyframe (clique para ir até ele)"
      onPointerDown={(e) => {
        e.stopPropagation();
        seek(clip.start + t);
      }}
    />
  ));
}

// Clipe de efeito (trilha de efeito): vale para tudo que estiver abaixo dele.
function EffectClip({ clip, zoom, selected, hidden, onDown, onTrim, onContextMenu }) {
  const width = Math.max(4, clipDur(clip) * zoom);
  return (
    <div
      className={'clip effect' + (selected ? ' selected' : '') + (hidden ? ' dim' : '')}
      style={{ left: clip.start * zoom, width }}
      onPointerDown={(e) => onDown(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
      title="Efeito para tudo que está abaixo"
    >
      <div className="text-clip-body">
        <span className="text-clip-icon">✦</span>
        <span className="clip-name">{EFFECT_LABEL[clip.fx?.type] || 'Efeito'}</span>
      </div>
      <div className="trim l" onPointerDown={(e) => onTrim(e, clip, 'l')} />
      <div className="trim r" onPointerDown={(e) => onTrim(e, clip, 'r')} />
    </div>
  );
}

function TextClip({ clip, zoom, selected, hidden, onDown, onTrim, onContextMenu }) {
  const width = Math.max(4, clipDur(clip) * zoom);
  const text = String(clip.text?.content || '').replace(/\n/g, ' ');
  const animated = ['in', 'out', 'loop'].some((k) => clip.anim?.[k]?.type && clip.anim[k].type !== 'none');
  return (
    <div
      className={'clip text' + (selected ? ' selected' : '') + (hidden ? ' dim' : '')}
      style={{ left: clip.start * zoom, width }}
      onPointerDown={(e) => onDown(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
    >
      <div className="text-clip-body">
        <span className="text-clip-icon">T</span>
        <span className="clip-name">{text || 'Texto vazio'}</span>
        {animated && <span className="text-clip-anim" title="Tem animação">✦</span>}
      </div>
      {selected && <KfDots clip={clip} zoom={zoom} />}
      <div className="trim l" onPointerDown={(e) => onTrim(e, clip, 'l')} />
      <div className="trim r" onPointerDown={(e) => onTrim(e, clip, 'r')} />
    </div>
  );
}

function Filmstrip({ clip, media, thumbs, width, height, zoom }) {
  if (!thumbs?.frames?.length || height <= 0) return <div className="filmstrip loading" style={{ height }} />;
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;
  let tileW = Math.max(24, height * ratio);
  let count = Math.ceil(width / tileW);
  if (count > 80) {
    count = 80;
    tileW = width / count;
  }
  const tiles = [];
  for (let i = 0; i < count; i++) {
    let idx = 0;
    if (thumbs.interval > 0) {
      const t = sourceAt(clip, (i * tileW + tileW / 2) / zoom);
      idx = clamp(Math.floor(t / thumbs.interval), 0, thumbs.frames.length - 1);
    }
    tiles.push(<div key={i} className="tile" style={{ width: tileW, backgroundImage: `url(${thumbs.frames[idx]})` }} />);
  }
  return (
    <div className="filmstrip" style={{ height }}>
      {tiles}
    </div>
  );
}

// Marcas das batidas dentro do clipe (a cada 4ª batida a marca é mais alta).
function BeatMarks({ clip, wave, zoom }) {
  const times = beatTimes(clip, wave);
  const spacing = times.length > 1 ? (times[1] - times[0]) * zoom : 0;
  if (spacing < 5) return null;
  return (
    <div className="beat-marks" aria-hidden="true">
      {times.map((t, i) => (
        <i key={i} className={i % 4 === 0 ? 'bar' : ''} style={{ left: (t - clip.start) * zoom }} />
      ))}
    </div>
  );
}

const peakCache = new WeakMap();
function peakOf(wave) {
  let m = peakCache.get(wave);
  if (m === undefined) {
    m = 0;
    for (const v of wave.peaks) if (v > m) m = v;
    peakCache.set(wave, m);
  }
  return m;
}

function Waveform({ clip, wave, width, height, color }) {
  const ref = useRef(null);
  const drawn = useRef(false);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      drawn.current = true;
      const dpr = window.devicePixelRatio || 1;
      const cw = Math.min(4096, Math.max(1, Math.round(width * dpr)));
      const ch = Math.max(1, Math.round(height * dpr));
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d');
      g.clearRect(0, 0, cw, ch);
      g.fillStyle = color;
      const { peaks, rate } = wave;
      const span = clip.out - clip.in;
      // Escala pelo pico do arquivo para áudios baixos também ficarem visíveis.
      const maxPeak = peakOf(wave);
      const gain = Math.min(2, clip.volume ?? 1) * Math.min(4, 0.95 / Math.max(maxPeak, 1e-3));
      const step = Math.max(1, Math.round(2 * dpr));
      for (let x = 0; x < cw; x += step) {
        const t0 = clip.in + (x / cw) * span;
        const t1 = clip.in + ((x + step) / cw) * span;
        const i0 = Math.floor(t0 * rate);
        const i1 = Math.max(i0 + 1, Math.ceil(t1 * rate));
        let max = 0;
        for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
        const h = Math.max(1, Math.min(1, max * gain) * ch * 0.92);
        g.fillRect(x, ch - h, Math.max(1, step - dpr), h);
      }
    };
    // O primeiro desenho é imediato; os seguintes esperam o zoom/aparo "assentar" (enquanto isso a onda só estica).
    if (!drawn.current) {
      draw();
      return;
    }
    const t = setTimeout(draw, 90);
    return () => clearTimeout(t);
  }, [clip.in, clip.out, clip.volume, wave, width, height, color]);
  return <canvas ref={ref} className="waveform" style={{ width, height }} />;
}

function Ruler({ fps, scrollRef }) {
  const ref = useRef(null);
  const zoom = useStore((s) => s.zoom);
  const { scrollLeft, viewW } = useView();
  const w = Math.max(1, viewW - HEADER_W);

  useEffect(() => {
    const c = ref.current;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(RULER_H * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, RULER_H);
    const steps = [1 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    const major = steps.find((s) => s * zoom >= 90) || 3600;
    const minorDiv = major >= 1 && major % 5 === 0 ? 5 : major >= 1 ? 4 : 5;
    const minor = major / minorDiv;
    const t0 = scrollLeft / zoom;
    const t1 = (scrollLeft + w) / zoom;
    g.font = '10.5px "Segoe UI Variable Text", "Segoe UI", sans-serif';
    g.textBaseline = 'top';
    const css = getComputedStyle(document.documentElement);
    const tick = css.getPropertyValue('--ruler-tick').trim() || '#555';
    const text = css.getPropertyValue('--text-3').trim() || '#888';
    for (let i = Math.floor(t0 / minor); i * minor <= t1 + minor; i++) {
      const t = i * minor;
      const x = Math.round(t * zoom - scrollLeft) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      g.fillStyle = tick;
      g.fillRect(x, isMajor ? RULER_H - 12 : RULER_H - 6, 1, isMajor ? 12 : 6);
      if (isMajor) {
        g.fillStyle = text;
        g.fillText(rulerLabel(t, major, fps), x + 4, 5);
      }
    }
  }, [scrollLeft, w, zoom, fps]);

  return <canvas ref={ref} className="ruler" style={{ width: w, height: RULER_H, left: HEADER_W }} onPointerDown={(e) => startScrub(e, scrollRef.current)} />;
}

// Arrastar a barra branca (na régua, na própria barra ou num espaço vazio).
// Perto das bordas a linha do tempo rola sozinha e o vídeo continua avançando/voltando.
function startScrub(e, scroller) {
  if (e.button !== 0 || !scroller) return;
  e.preventDefault();
  e.stopPropagation();
  let lastX = e.clientX;
  let raf = 0;
  const EDGE = 56;
  const timeAt = (x) => {
    const r = scroller.getBoundingClientRect();
    return (x - r.left - HEADER_W + scroller.scrollLeft) / useStore.getState().zoom;
  };
  const apply = () => seek(timeAt(lastX));
  const edgeScroll = () => {
    const r = scroller.getBoundingClientRect();
    const left = r.left + HEADER_W;
    const right = r.left + scroller.clientWidth;
    // Velocidade cresce de forma suave quanto mais perto (ou além) da borda.
    let v = 0;
    if (lastX > right - EDGE) v = Math.min(2.5, (lastX - (right - EDGE)) / EDGE);
    else if (lastX < left + EDGE && scroller.scrollLeft > 0) v = -Math.min(2.5, (left + EDGE - lastX) / EDGE);
    if (v) {
      scroller.scrollLeft += Math.sign(v) * (4 + v * v * 14);
      apply();
    }
    raf = requestAnimationFrame(edgeScroll);
  };
  useView.setState({ scrubbing: true });
  apply();
  raf = requestAnimationFrame(edgeScroll);
  dragPointer(
    e,
    (ev) => {
      lastX = ev.clientX;
      apply();
    },
    () => {
      cancelAnimationFrame(raf);
      useView.setState({ scrubbing: false });
    },
  );
}

function rulerLabel(t, major, fps) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (major >= 1) return base;
  const f = Math.round((t - Math.floor(t)) * fps);
  return f ? `${f}f` : base;
}

function Playhead({ scrollRef }) {
  const t = useStore((s) => s.currentTime);
  const zoom = useStore((s) => s.zoom);
  const playing = useStore((s) => s.playing);
  const { scrollLeft, viewW, scrubbing } = useView();
  const x = t * zoom;

  // A linha do tempo acompanha a barra quando ela sai da tela (tocando ou com as setas).
  // Enquanto você arrasta a barra, quem rola é o próprio arrastar.
  useEffect(() => {
    if (scrubbing) return;
    const el = scrollRef.current;
    const laneView = viewW - HEADER_W;
    if (x > scrollLeft + laneView - 40 || x < scrollLeft) el.scrollLeft = Math.max(0, x - (playing ? 60 : laneView / 3));
  }, [x, playing]);

  if (x < scrollLeft - 1) return null;
  return (
    <div className="playhead" style={{ left: HEADER_W + x }}>
      <div className="playhead-hit" onPointerDown={(e) => startScrub(e, scrollRef.current)} title="Arraste para escolher o ponto do vídeo" />
      <div className="playhead-cap" onPointerDown={(e) => startScrub(e, scrollRef.current)} />
    </div>
  );
}

function ClipMenu({ x, y, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && onClose();
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...ref.current.querySelectorAll('button')];
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    const unsub = useStore.subscribe((s, p) => (s.exportOpen && !p.exportOpen) || (s.cropClipId && !p.cropClipId) || (s.recordOpen && !p.recordOpen) ? onClose() : null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      unsub();
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, []);
  const item = (label, icon, fn, keys) => (
    <button
      role="menuitem"
      onClick={() => {
        fn();
        onClose();
      }}
    >
      <Icon name={icon} size={15} />
      <span>{label}</span>
      <kbd>{keys}</kbd>
    </button>
  );
  return (
    <div className="context-menu" role="menu" ref={ref} style={pos}>
      {item('Dividir no cursor', 'split', splitAtPlayhead, 'S')}
      {item('Duplicar', 'duplicate', duplicateSelection, 'Ctrl+D')}
      {item('Copiar', 'duplicate', copySelection, 'Ctrl+C')}
      {item('Recortar', 'crop', openCrop, 'C')}
      {item('Congelar quadro', 'freeze', () => freezeFrame(), 'F')}
      {item('Reverso', 'reverse', () => useStore.getState().selection[0] && reverseClip(useStore.getState().selection[0]), '')}
      <div className="menu-sep" />
      {item('Excluir', 'trash', deleteSelection, 'Del')}
    </div>
  );
}
