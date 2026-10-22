import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, clipDur, clipEnd, packMain, projectDuration } from '../store';
import { engine } from '../engine';
import { sourceAt, effSpeed } from '../speed';
import { shiftKeyframes } from '../keyframes';
import { insertionOrder, placeClip, seek } from '../ops';
import { Icon } from '../icons';
import { clamp } from '../util';
import { haptic } from './ui';

// Linha do tempo para toque: o cursor fica fixo no centro e a linha desliza por baixo do dedo.
// Arrastar = navegar (com inércia) · pinça = zoom · tocar = selecionar · segurar = mover o clipe ·
// puxar as alças amarelas = aparar.

const MAIN_H = 58;
const SUB_H = 40;
const GAP = 5;
const RULER_H = 26;
const MIN_CLIP = 0.1;
const SNAP_PX = 9;
const LONG_MS = 380;

const laneHeight = (tr) => (tr.main ? MAIN_H : SUB_H);

export default function MTimeline({ onAdd }) {
  const wrapRef = useRef(null);
  const contentRef = useRef(null);
  const [W, setW] = useState(360);
  const project = useStore((s) => s.project);
  const media = useStore((s) => s.media);
  const cache = useStore((s) => s.cache);
  const selection = useStore((s) => s.selection);
  const zoom = useStore((s) => s.zoom);
  const [lifted, setLifted] = useState(null);
  const g = useRef({ pointers: new Map(), mode: 'idle' });
  const inertia = useRef(0);

  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const total = projectDuration(project);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // O conteúdo acompanha o tempo sem redesenhar os clipes (só muda o transform).
  useEffect(() => {
    const apply = (t) => {
      if (contentRef.current) contentRef.current.style.transform = `translate3d(${(W / 2 - t * zoom).toFixed(2)}px,0,0)`;
    };
    apply(useStore.getState().currentTime);
    return useStore.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime) apply(s.currentTime);
    });
  }, [W, zoom]);

  const stopInertia = () => {
    cancelAnimationFrame(inertia.current);
    inertia.current = 0;
  };
  useEffect(() => stopInertia, []);

  const targetsFor = (exclude) => {
    const p = useStore.getState().project;
    const t = [0];
    for (const c of p.clips) {
      if (exclude.has(c.id)) continue;
      t.push(c.start, clipEnd(c));
    }
    return t;
  };
  const nearest = (v, targets, th) => {
    let best = null;
    let bd = th;
    for (const t of targets) {
      const d = Math.abs(t - v);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };

  // ---------- mover clipe (depois de segurar) ----------
  const beginMove = (clipId) => {
    const s = useStore.getState();
    const clip = s.project.clips.find((c) => c.id === clipId);
    const track = s.project.tracks.find((t) => t.id === clip?.trackId);
    if (!clip || track?.locked) return false;
    s.select([clipId]);
    const st = g.current;
    st.mode = 'move';
    st.move = { id: clipId, orig: clip.start, dur: clipDur(clip), t0: s.currentTime, targets: targetsFor(new Set([clipId])), snapped: null };
    s.gestureStart();
    setLifted(clipId);
    haptic(16);
    const loop = () => {
      if (g.current.mode !== 'move') return;
      // Perto das bordas a linha rola sozinha.
      const r = wrapRef.current.getBoundingClientRect();
      const x = g.current.lastX;
      const edge = 56;
      let v = 0;
      if (x < r.left + edge) v = -(1 - clamp((x - r.left) / edge, 0, 1));
      else if (x > r.right - edge) v = 1 - clamp((r.right - x) / edge, 0, 1);
      if (v) {
        const z = useStore.getState().zoom;
        seek(clamp(useStore.getState().currentTime + (v * 340 * 0.016) / z, 0, Math.max(total, 0) + 30));
        applyMove(x);
      }
      g.current.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
    return true;
  };

  const applyMove = (x) => {
    const st = g.current;
    const m = st.move;
    if (!m) return;
    const s = useStore.getState();
    const z = s.zoom;
    let ns = Math.max(0, m.orig + (x - st.sx) / z + (s.currentTime - m.t0));
    let at = null;
    if (s.project.settings.snap) {
      const th = SNAP_PX / z;
      const a = nearest(ns, m.targets, th);
      const b = nearest(ns + m.dur, m.targets, th);
      if (a !== null && (b === null || Math.abs(a - ns) <= Math.abs(b - ns - m.dur))) {
        ns = a;
        at = a;
      } else if (b !== null) {
        ns = b - m.dur;
        at = b;
      }
    }
    if (at !== null && at !== m.snapped) haptic(6);
    m.snapped = at;
    s.live((q) => {
      const c = q.clips.find((x2) => x2.id === m.id);
      if (c) c.start = ns;
    });
  };

  const endMove = (cancel) => {
    const st = g.current;
    cancelAnimationFrame(st.raf);
    const m = st.move;
    st.move = null;
    setLifted(null);
    if (!m) return;
    if (cancel) {
      useStore.getState().gestureCancel();
      return;
    }
    const ids = new Set([m.id]);
    useStore.getState().gestureEnd((q) => {
      const main = q.tracks.find((t) => t.main);
      const moved = q.clips.filter((c) => ids.has(c.id));
      if (q.settings.magnet && moved.some((c) => c.trackId === main.id)) packMain(q, insertionOrder(q, ids));
      for (const c of moved) if (c.trackId !== main.id || !q.settings.magnet) placeClip(q, c, ids);
    });
  };

  // ---------- gestos no corpo da linha ----------
  const onPointerDown = (e) => {
    if (e.target.closest('.mtrim, .madd')) return;
    const st = g.current;
    stopInertia();
    if (engine.playing) engine.pause();
    st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      wrapRef.current.setPointerCapture(e.pointerId);
    } catch {}
    if (st.pointers.size === 2) {
      clearTimeout(st.lp);
      if (st.mode === 'move') endMove(true);
      const [a, b] = [...st.pointers.values()];
      st.mode = 'pinch';
      st.d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      st.z0 = useStore.getState().zoom;
      return;
    }
    const clipId = e.target.closest('[data-clip]')?.dataset.clip || null;
    st.mode = 'pending';
    st.id = e.pointerId;
    st.sx = e.clientX;
    st.sy = e.clientY;
    st.lastX = e.clientX;
    st.t0 = useStore.getState().currentTime;
    st.clipId = clipId;
    st.samples = [[performance.now(), e.clientX]];
    clearTimeout(st.lp);
    if (clipId) {
      st.lp = setTimeout(() => {
        if (st.mode === 'pending') beginMove(clipId);
      }, LONG_MS);
    }
  };

  const onPointerMove = (e) => {
    const st = g.current;
    const p = st.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (st.mode === 'pinch' && st.pointers.size >= 2) {
      const [a, b] = [...st.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      useStore.getState().setZoom(st.z0 * (d / st.d0));
      return;
    }
    if (e.pointerId !== st.id) return;
    st.lastX = e.clientX;
    if (st.mode === 'pending') {
      const dx = e.clientX - st.sx;
      const dy = e.clientY - st.sy;
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        clearTimeout(st.lp);
        st.mode = 'scrub';
      } else if (Math.abs(dy) > 10) clearTimeout(st.lp);
    }
    if (st.mode === 'scrub') {
      const z = useStore.getState().zoom;
      seek(clamp(st.t0 - (e.clientX - st.sx) / z, 0, Math.max(total, 0)));
      const now = performance.now();
      st.samples.push([now, e.clientX]);
      while (st.samples.length > 2 && now - st.samples[0][0] > 90) st.samples.shift();
    } else if (st.mode === 'move') applyMove(e.clientX);
  };

  const onPointerUp = (e) => {
    const st = g.current;
    st.pointers.delete(e.pointerId);
    if (st.mode === 'pinch') {
      if (st.pointers.size < 2) st.mode = 'idle';
      return;
    }
    if (e.pointerId !== st.id) return;
    clearTimeout(st.lp);
    if (st.mode === 'pending') {
      // Toque simples: seleciona o clipe (ou limpa a seleção).
      const s = useStore.getState();
      if (st.clipId) {
        if (!s.selection.includes(st.clipId)) {
          s.select([st.clipId]);
          haptic(6);
        }
      } else if (s.selection.length) s.select([]);
    } else if (st.mode === 'scrub') {
      const a = st.samples[0];
      const b = st.samples[st.samples.length - 1];
      const dt = b[0] - a[0];
      let v = dt > 0 ? (b[1] - a[1]) / dt : 0; // px/ms (sentido do dedo)
      if (Math.abs(v) > 0.25 && performance.now() - b[0] < 80) {
        let last = performance.now();
        const step = (now) => {
          const z = useStore.getState().zoom;
          const dtm = Math.min(40, now - last);
          last = now;
          v *= Math.exp(-dtm / 380);
          const t = useStore.getState().currentTime - (v * dtm) / z;
          const tt = clamp(t, 0, Math.max(total, 0));
          seek(tt);
          if (Math.abs(v) > 0.03 && tt === t) inertia.current = requestAnimationFrame(step);
        };
        inertia.current = requestAnimationFrame(step);
      }
    } else if (st.mode === 'move') endMove(false);
    st.mode = 'idle';
  };

  const onPointerCancel = (e) => {
    const st = g.current;
    st.pointers.delete(e.pointerId);
    clearTimeout(st.lp);
    if (st.mode === 'move') endMove(true);
    st.mode = 'idle';
  };

  // ---------- aparar (alças amarelas) ----------
  const onTrimDown = (e, clip, side) => {
    e.stopPropagation();
    e.preventDefault();
    const s = useStore.getState();
    const p = s.project;
    const track = p.tracks.find((t) => t.id === clip.trackId);
    if (track.locked) return;
    const m = mediaById.get(clip.mediaId);
    const isImage = !m || m.type === 'image';
    const speed = effSpeed(clip);
    const magnetMain = track.main && p.settings.magnet;
    const others = p.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id);
    const end0 = clipEnd(clip);
    const prevEnd = magnetMain ? 0 : Math.max(0, ...others.filter((c) => clipEnd(c) <= clip.start + 1e-3).map(clipEnd));
    const nextStart = magnetMain ? Infinity : Math.min(Infinity, ...others.filter((c) => c.start >= end0 - 1e-3).map((c) => c.start));
    const targets = [...targetsFor(new Set([clip.id])), s.currentTime];
    const z = s.zoom;
    const sx = e.clientX;
    let snapped = null;
    stopInertia();
    if (engine.playing) engine.pause();
    s.select([clip.id]);
    s.gestureStart();
    haptic(10);
    const pid = e.pointerId;

    const snap = (v) => {
      if (!p.settings.snap) return v;
      const r = nearest(v, targets, SNAP_PX / z);
      if (r !== null && r !== snapped) haptic(6);
      snapped = r;
      return r === null ? v : r;
    };
    const move = (ev) => {
      if (ev.pointerId !== pid) return;
      const dt = (ev.clientX - sx) / z;
      useStore.getState().live((q) => {
        const c = q.clips.find((x) => x.id === clip.id);
        if (!c) return;
        if (side === 'l') {
          if (magnetMain) {
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
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      useStore.getState().gestureEnd();
    };
    // Na janela inteira (não só na alça): não depende da captura de ponteiro e segue o dedo para fora da linha.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---------- desenho ----------
  const tracks = project.tracks;
  const lanes = [];
  let y = 0;
  for (const tr of tracks) {
    const h = laneHeight(tr);
    lanes.push({ tr, y, h });
    y += h + GAP;
  }
  const lanesH = y;
  const mainEnd = project.clips.filter((c) => project.tracks.find((t) => t.id === c.trackId)?.main).reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const mainLane = lanes.find((l) => l.tr.main);
  const sel = new Set(selection);

  return (
    <div className="mtl" ref={wrapRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}>
      <Ruler zoom={zoom} W={W} total={total} fps={project.settings.fps} />
      <div className="mtl-scroll" style={{ top: RULER_H }}>
        <div className="mtl-inner" style={{ height: Math.max(lanesH, 1) }}>
          {lanes.map(({ tr, y: ly, h }) => (
            <div key={tr.id} className={'mlane' + (tr.main ? ' main' : '') + (tr.hidden ? ' hidden' : '')} style={{ top: ly, height: h }} />
          ))}
          <div className="mtl-content" ref={contentRef}>
            {project.clips.map((c) => {
              const lane = lanes.find((l) => l.tr.id === c.trackId);
              if (!lane) return null;
              return <MClip key={c.id} clip={c} media={mediaById.get(c.mediaId)} thumbs={cache[c.mediaId]?.thumbs} wave={cache[c.mediaId]?.wave} lane={lane} zoom={zoom} selected={sel.has(c.id)} lifted={lifted === c.id} onTrim={onTrimDown} />;
            })}
            {mainLane && (
              <button className="madd" style={{ left: mainEnd * zoom + 12, top: mainLane.y, height: mainLane.h }} onClick={onAdd} aria-label="Adicionar mídia">
                <Icon name="plus" size={22} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mtl-playhead" aria-hidden="true">
        <i />
      </div>
      {project.clips.length === 0 && <p className="mtl-empty">Toque em + para adicionar vídeos, fotos ou músicas</p>}
    </div>
  );
}

// ---------- régua ----------
const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

function Ruler({ zoom, W, total, fps }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Canvas com 3 telas de largura: durante a reprodução ele só desliza (transform) e é redesenhado
    // quando o cursor chega perto da borda dele. Antes a régua inteira era redesenhada a cada quadro.
    const CW = W * 3;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(CW * dpr);
    c.height = Math.round(RULER_H * dpr);
    c.style.width = CW + 'px';
    const gx = c.getContext('2d');
    const step = STEPS.find((s) => s * zoom >= 64) || STEPS[STEPS.length - 1];
    const css = getComputedStyle(document.documentElement);
    const tick = css.getPropertyValue('--m-text-3').trim() || '#777';
    const txt = css.getPropertyValue('--m-text-2').trim() || '#aaa';
    let base = null; // tempo que fica no centro do canvas largo
    const paint = (t) => {
      base = t;
      gx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gx.clearRect(0, 0, CW, RULER_H);
      const x0 = CW / 2 - t * zoom;
      const from = Math.max(0, Math.floor((t - CW / 2 / zoom) / step) * step);
      const to = t + CW / 2 / zoom + step;
      gx.font = '500 10.5px system-ui, sans-serif';
      gx.textBaseline = 'top';
      gx.textAlign = 'left';
      gx.strokeStyle = tick;
      gx.beginPath();
      for (let v = from; v <= to; v += step) {
        const x = Math.round(x0 + v * zoom) + 0.5;
        gx.moveTo(x, RULER_H - 9);
        gx.lineTo(x, RULER_H);
        const xm = Math.round(x0 + (v + step / 2) * zoom) + 0.5;
        gx.moveTo(xm, RULER_H - 5);
        gx.lineTo(xm, RULER_H);
      }
      gx.stroke();
      gx.fillStyle = txt;
      for (let v = from; v <= to; v += step) {
        const x = Math.round(x0 + v * zoom) + 0.5;
        const m = Math.floor(v / 60);
        const sec = v - m * 60;
        gx.fillText(step < 1 ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.round(sec)).padStart(2, '0')}`, x + 4, 3);
      }
      if (total > 0) {
        const xe = x0 + total * zoom;
        gx.fillStyle = 'rgba(255,255,255,0.14)';
        gx.fillRect(xe, 0, 1.5, RULER_H);
      }
    };
    const place = (t) => {
      if (base === null || Math.abs(t - base) * zoom > W * 0.9) paint(t);
      // O centro do canvas largo (CW/2) está em "base"; o cursor (W/2 na tela) está em "t".
      c.style.transform = `translate3d(${(W / 2 - CW / 2 - (t - base) * zoom).toFixed(2)}px,0,0)`;
    };
    place(useStore.getState().currentTime);
    return useStore.subscribe((s, prev) => {
      if (s.currentTime !== prev.currentTime) place(s.currentTime);
    });
  }, [zoom, W, total, fps]);
  return <canvas ref={ref} className="mtl-ruler" style={{ height: RULER_H }} />;
}

// ---------- clipe ----------
const MClip = memo(function MClip({ clip, media, thumbs, wave, lane, zoom, selected, lifted, onTrim }) {
  const dur = clipDur(clip);
  const w = Math.max(6, dur * zoom);
  const kind = clip.kind === 'effect' ? 'effect' : clip.kind === 'text' ? 'text' : media?.type === 'audio' ? 'audio' : 'video';
  const cls = ['mclip', kind, selected ? 'sel' : '', lifted ? 'lift' : '', media?.missing ? 'missing' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-clip={clip.id} style={{ left: clip.start * zoom, top: lane.y, width: w, height: lane.h }}>
      {kind === 'video' && media && <Filmstrip clip={clip} media={media} thumbs={thumbs} width={w} height={lane.h} zoom={zoom} />}
      {kind === 'audio' && wave && <Waveform clip={clip} wave={wave} width={w} height={lane.h} />}
      {(kind === 'text' || kind === 'effect') && <span className="mclip-label">{kind === 'text' ? clip.text?.content || 'Texto' : clip.fx || 'Efeito'}</span>}
      {kind === 'audio' && <span className="mclip-label audio">{media?.name}</span>}
      {media?.missing && (
        <span className="mclip-missing">
          <Icon name="warning" size={14} /> Ausente
        </span>
      )}
      {selected && (
        <>
          <span className="mtrim l" onPointerDown={(e) => onTrim(e, clip, 'l')} aria-label="Aparar início">
            <i />
          </span>
          <span className="mtrim r" onPointerDown={(e) => onTrim(e, clip, 'r')} aria-label="Aparar fim">
            <i />
          </span>
        </>
      )}
    </div>
  );
});

function Filmstrip({ clip, media, thumbs, width, height, zoom }) {
  if (!thumbs?.frames?.length) return <div className="filmstrip loading" />;
  const ratio = media.width && media.height ? media.width / media.height : 16 / 9;
  let tileW = Math.max(24, height * ratio);
  let count = Math.ceil(width / tileW);
  if (count > 60) {
    count = 60;
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
  return <div className="filmstrip">{tiles}</div>;
}

function Waveform({ clip, wave, width, height }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.min(4096, Math.max(1, Math.round(width * dpr)));
    const ch = Math.max(1, Math.round(height * dpr));
    c.width = cw;
    c.height = ch;
    const gx = c.getContext('2d');
    gx.clearRect(0, 0, cw, ch);
    gx.fillStyle = 'rgba(255,255,255,0.78)';
    const { peaks, rate } = wave;
    const span = clip.out - clip.in;
    let maxPeak = 0;
    for (const v of peaks) if (v > maxPeak) maxPeak = v;
    const gain = Math.min(2, clip.volume ?? 1) * Math.min(4, 0.95 / Math.max(maxPeak, 1e-3));
    const step = Math.max(1, Math.round(2.5 * dpr));
    for (let x = 0; x < cw; x += step) {
      const t0 = clip.in + (x / cw) * span;
      const t1 = clip.in + ((x + step) / cw) * span;
      const i0 = Math.floor(t0 * rate);
      const i1 = Math.max(i0 + 1, Math.ceil(t1 * rate));
      let max = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
      const hh = Math.max(2 * dpr, Math.min(1, max * gain) * ch * 0.8);
      gx.fillRect(x, (ch - hh) / 2, Math.max(1, step - dpr), hh);
    }
  }, [clip.in, clip.out, clip.volume, wave, width, height]);
  return <canvas ref={ref} className="waveform" style={{ width, height }} />;
}
