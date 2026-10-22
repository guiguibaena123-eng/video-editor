import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, clipEnd, projectDuration, ASPECTS, DEFAULT_TRANSFORM, setPreviewQuality } from '../store';
import { engine, visualBox } from '../engine';
import { transformAt, applyProp } from '../keyframes';
import { Icon } from '../icons';
import { seek, setOrientation } from '../ops';
import { fmtTimecode, dragPointer } from '../util';

const SNAP_PX = 6;

// Largura máxima (em pixels reais) em que o player desenha, por qualidade.
const QUALITY_CAP = { auto: 1280, high: Infinity, medium: 960, low: 640 };

// Tela cheia do player: cobre a janela e também coloca a janela em tela cheia.
export function setTheater(on) {
  useStore.setState({ theater: on });
  window.api?.setFullScreen?.(on);
}

export default function Preview() {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [idle, setIdle] = useState(false);
  const settings = useStore((s) => s.project.settings);
  const theater = useStore((s) => s.theater);
  const quality = useStore((s) => s.previewQuality);
  const autoScale = useStore((s) => s.autoScale);
  const aspect = settings.width / settings.height;

  useEffect(() => {
    engine.attach(canvasRef.current);
    return () => engine.detach();
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const pad = theater ? 0 : 24;
      const aw = Math.max(10, r.width - pad * 2);
      const ah = Math.max(10, r.height - pad * 2);
      const w = Math.min(aw, ah * aspect);
      setSize({ w: Math.round(w), h: Math.round(w / aspect) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, theater]);

  // Tela cheia: Esc sai; os controles somem depois de 2,5 s sem mexer o mouse.
  useEffect(() => {
    if (!theater) return;
    let timer;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), 2500);
    };
    const key = (e) => {
      if (e.key === 'Escape') setTheater(false);
      wake();
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', key);
    const off = window.api?.onFullScreenChange?.((on) => !on && useStore.setState({ theater: false }));
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', key);
      off?.();
    };
  }, [theater]);

  useEffect(() => {
    const c = canvasRef.current;
    // Resolução real do desenho: limitada pela qualidade (e reduzida sozinha no modo automático se o PC
    // não acompanha). A exportação não usa isso: ela sempre sai na resolução escolhida.
    const dpr = window.devicePixelRatio || 1;
    const cap = quality === 'auto' && theater ? 1920 : QUALITY_CAP[quality];
    let k = Math.min(dpr, cap / Math.max(1, size.w));
    if (quality === 'auto') k *= autoScale;
    c.width = Math.max(2, Math.round(size.w * k));
    c.height = Math.max(2, Math.round(size.h * k));
    engine.requestDraw();
  }, [size, quality, autoScale, theater]);

  return (
    <section className={'panel preview-panel' + (theater ? ' theater' : '') + (theater && idle ? ' idle' : '')}>
      <div className="panel-head">
        <h2>Player</h2>
        <span className="muted small-text">
          {settings.width}×{settings.height} · {settings.fps} fps
        </span>
      </div>
      <div className="stage" ref={stageRef}>
        <div className="canvas-wrap" style={{ width: size.w, height: size.h }}>
          <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
          {!theater && <TransformOverlay w={size.w} h={size.h} />}
        </div>
      </div>
      <Transport stageRef={stageRef} />
    </section>
  );
}

function activeVisualClips(s) {
  const t = s.currentTime;
  const out = [];
  for (const tr of s.project.tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue;
    for (const c of s.project.clips) {
      if (c.trackId === tr.id && t >= c.start && t < clipEnd(c)) out.push({ clip: c, track: tr });
    }
  }
  return out; // de cima para baixo
}

function hit(box, px, py) {
  const a = (-box.rotation * Math.PI) / 180;
  const dx = px - box.cx;
  const dy = py - box.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= box.w / 2 && Math.abs(ly) <= box.h / 2;
}

function TransformOverlay({ w, h }) {
  const selection = useStore((s) => s.selection);
  const media = useStore((s) => s.media);
  // Recalcula só quando o clipe visível muda, não a cada quadro.
  const activeKey = useStore((s) => activeVisualClips(s).map((a) => a.clip.id).join(','));
  useStore((s) => s.project); // redesenha a caixa quando o clipe muda
  const pickMode = useStore((s) => !!s.pickColorFor);
  const now = useStore((s) => s.currentTime); // com keyframes a caixa acompanha o tempo
  // O clipe "como aparece agora": posição/escala/rotação vindas dos keyframes.
  const view = (clip) => (clip.keyframes ? { ...clip, transform: { ...clip.transform, ...transformAt(clip, now - clip.start) } } : clip);
  const [guides, setGuides] = useState({ v: false, h: false });
  const ref = useRef(null);

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const active = activeKey ? activeVisualClips(useStore.getState()) : [];
  const selected = selection.length === 1 ? active.find((a) => a.clip.id === selection[0]) : null;
  const selMedia = selected && mediaById.get(selected.clip.mediaId);
  const settings = useStore((s) => s.project.settings);
  const box = selected ? visualBox(view(selected.clip), selMedia, w, h, settings) : null;
  const locked = selected?.track.locked;

  const local = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Se a propriedade tem keyframes, grava um keyframe no instante atual; senão muda o valor fixo.
  const updateTransform = (id, patch) => {
    const st = useStore.getState();
    const tol = 0.5 / st.project.settings.fps;
    st.live((p) => {
      const c = p.clips.find((x) => x.id === id);
      for (const [k, v] of Object.entries(patch)) applyProp(c, k, v, st.currentTime - c.start, tol);
    });
  };

  const startMove = (e, clip) => {
    const store = useStore.getState();
    const start = local(e);
    const orig = { ...DEFAULT_TRANSFORM, ...view(clip).transform };
    const m = mediaById.get(clip.mediaId);
    store.gestureStart();
    dragPointer(
      e,
      (ev) => {
        const p = local(ev);
        let x = orig.x + (p.x - start.x) / w;
        let y = orig.y + (p.y - start.y) / h;
        const b = visualBox({ ...clip, transform: { ...orig, x, y } }, m, w, h, useStore.getState().project.settings);
        const snapV = Math.abs(b.cx - w / 2) < SNAP_PX;
        const snapH = Math.abs(b.cy - h / 2) < SNAP_PX;
        if (snapV) x = 0;
        if (snapH) y = 0;
        // Bordas do vídeo grudam nas bordas da tela (evita faixas pretas sem querer).
        if (!snapV && b.w >= w) {
          if (Math.abs(b.cx - b.w / 2) < SNAP_PX) x = (b.w / 2 - w / 2) / w;
          else if (Math.abs(b.cx + b.w / 2 - w) < SNAP_PX) x = (w / 2 - b.w / 2) / w;
        }
        if (!snapH && b.h >= h) {
          if (Math.abs(b.cy - b.h / 2) < SNAP_PX) y = (b.h / 2 - h / 2) / h;
          else if (Math.abs(b.cy + b.h / 2 - h) < SNAP_PX) y = (h / 2 - b.h / 2) / h;
        }
        setGuides({ v: snapV, h: snapH });
        updateTransform(clip.id, { x, y });
      },
      () => {
        setGuides({ v: false, h: false });
        useStore.getState().gestureEnd();
      },
    );
  };

  const onStageDown = (e) => {
    if (e.button !== 0) return;
    const p = local(e);
    const s = useStore.getState();
    if (s.pickColorFor) {
      const cv = ref.current.parentElement.querySelector('canvas');
      const k = cv.width / w;
      const d = cv.getContext('2d').getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data;
      const hex = '#' + [d[0], d[1], d[2]].map((x) => x.toString(16).padStart(2, '0')).join('');
      const id = s.pickColorFor;
      useStore.setState({ pickColorFor: null });
      s.commit((q) => {
        const c = q.clips.find((x) => x.id === id);
        if (c) c.chroma = { similarity: 0.3, smooth: 0.1, ...c.chroma, color: hex, on: true };
      });
      s.notify('Cor do fundo escolhida: ' + hex);
      return;
    }
    const target = activeVisualClips(s).find(({ clip }) => {
      const m = mediaById.get(clip.mediaId);
      const b = visualBox(view(clip), m, w, h, s.project.settings);
      return b && hit(b, p.x, p.y);
    });
    if (!target) {
      s.select([]);
      return;
    }
    s.select([target.clip.id]);
    if (!target.track.locked) startMove(e, target.clip);
  };

  const startScale = (e) => {
    e.stopPropagation();
    const clip = selected.clip;
    const orig = { ...DEFAULT_TRANSFORM, ...view(clip).transform };
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + box.cx;
    const cy = r.top + box.cy;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1;
    useStore.getState().gestureStart();
    dragPointer(
      e,
      (ev) => {
        const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
        let scale = Math.max(0.05, Math.min(10, (orig.scale * d) / d0));
        if (Math.abs(scale - 1) < 0.02) scale = 1;
        updateTransform(clip.id, { scale });
      },
      () => useStore.getState().gestureEnd(),
    );
  };

  const startRotate = (e) => {
    e.stopPropagation();
    const clip = selected.clip;
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + box.cx;
    const cy = r.top + box.cy;
    useStore.getState().gestureStart();
    dragPointer(
      e,
      (ev) => {
        let deg = (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI + 90;
        deg = ((deg + 540) % 360) - 180;
        const near = Math.round(deg / 45) * 45;
        if (Math.abs(deg - near) < 4) deg = near;
        updateTransform(clip.id, { rotation: Math.round(deg * 10) / 10 });
      },
      () => useStore.getState().gestureEnd(),
    );
  };

  return (
    <div className={'overlay' + (pickMode ? ' picking' : '')} ref={ref} onPointerDown={onStageDown} onDoubleClick={() => {
        if (!selected || locked) return;
        // Duplo clique: texto → editar o conteúdo; vídeo/imagem → recortar.
        if (selected.clip.kind === 'text') useStore.setState({ textFocus: Date.now() });
        else useStore.setState({ cropClipId: selected.clip.id });
      }}>
      {guides.v && <div className="guide v" />}
      {guides.h && <div className="guide h" />}
      {box && (
        <div
          className={'sel-box' + (locked ? ' locked' : '')}
          style={{ left: box.cx - box.w / 2, top: box.cy - box.h / 2, width: box.w, height: box.h, transform: `rotate(${box.rotation}deg)` }}
        >
          {!locked && (
            <>
              {['nw', 'ne', 'sw', 'se'].map((k) => (
                <span key={k} className={`handle ${k}`} onPointerDown={startScale} />
              ))}
              <span className="rotate-handle" onPointerDown={startRotate} title="Girar">
                <Icon name="reset" size={12} strokeWidth={2.2} />
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OrientationToggle({ settings }) {
  const [askOpen, setAskOpen] = useState(false);
  const ref = useRef(null);
  const hasVisual = useStore((s) => {
    const ids = new Set(s.media.filter((m) => m.type !== 'audio').map((m) => m.id));
    return s.project.clips.some((c) => ids.has(c.mediaId));
  });
  const vertical = settings.height > settings.width;
  const horizontal = settings.width > settings.height;

  useEffect(() => {
    if (!askOpen) return;
    const close = (e) => !ref.current?.contains(e.target) && setAskOpen(false);
    const esc = (e) => e.key === 'Escape' && setAskOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [askOpen]);

  const toVertical = () => {
    if (vertical) return;
    if (!hasVisual) return setOrientation('vertical', 'fit');
    // Posição fixa na tela: o painel do player corta o que passa da borda dele.
    const r = ref.current.getBoundingClientRect();
    setAskOpen({ right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 10 });
  };
  const choose = (mode) => {
    setAskOpen(false);
    setOrientation('vertical', mode);
    if (mode === 'fill') useStore.getState().notify('Arraste o vídeo no player para escolher a parte que aparece.');
  };

  return (
    <div className="orient" ref={ref}>
      <div className="orient-toggle" role="group" aria-label="Formato">
        <button className={horizontal ? 'on' : ''} onClick={() => !horizontal && setOrientation('horizontal')} aria-pressed={horizontal} title="Horizontal (16:9)">
          <span className="orient-icon h" /> Horizontal
        </button>
        <button className={vertical ? 'on' : ''} onClick={toVertical} aria-pressed={vertical} title="Vertical (9:16) — para Reels, TikTok e Shorts">
          <span className="orient-icon v" /> Vertical
        </button>
      </div>
      {askOpen && (
        <div className="orient-pop" role="dialog" aria-label="Verticalizar" style={askOpen}>
          <strong>Verticalizar o vídeo</strong>
          <button className="orient-choice" onClick={() => choose('fill')}>
            <span className="orient-preview fill">
              <span />
            </span>
            <span>
              <b>Preencher a tela</b>
              <span className="muted">O vídeo ocupa a tela toda e as laterais ficam de fora. Arraste no player para escolher a parte que aparece.</span>
            </span>
          </button>
          <button className="orient-choice" onClick={() => choose('fit')}>
            <span className="orient-preview fit">
              <span />
            </span>
            <span>
              <b>Mostrar o vídeo inteiro</b>
              <span className="muted">Nada é cortado; aparecem faixas em cima e embaixo.</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function QualitySelect() {
  const quality = useStore((s) => s.previewQuality);
  const autoScale = useStore((s) => s.autoScale);
  return (
    <select
      className="quality-select"
      value={quality}
      onChange={(e) => setPreviewQuality(e.target.value)}
      title={quality === 'auto' && autoScale < 1 ? `Automático: o player está em ${Math.round(autoScale * 100)}% da resolução para rodar leve` : 'Qualidade do player (a exportação não muda)'}
      aria-label="Qualidade do player"
    >
      <option value="auto">Auto</option>
      <option value="high">Alta</option>
      <option value="medium">Média</option>
      <option value="low">Baixa</option>
    </select>
  );
}

function Transport({ stageRef }) {
  const theater = useStore((s) => s.theater);
  const playing = useStore((s) => s.playing);
  const currentTime = useStore((s) => s.currentTime);
  const total = useStore((s) => projectDuration(s.project));
  const settings = useStore((s) => s.project.settings);
  const frame = 1 / settings.fps;

  const setAspect = (aspect) => {
    const [width, height] = ASPECTS[aspect];
    useStore.getState().commit((p) => {
      p.settings.aspect = aspect;
      p.settings.width = width;
      p.settings.height = height;
    });
  };

  return (
    <div className="transport">
      {theater && (
        <input
          className="theater-seek"
          type="range"
          min={0}
          max={Math.max(0.01, total)}
          step={0.01}
          value={Math.min(currentTime, total)}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Posição do vídeo"
          style={{ '--fill': `${total ? (Math.min(currentTime, total) / total) * 100 : 0}%` }}
        />
      )}
      <div className="time">
        <span className="now">{fmtTimecode(currentTime, settings.fps)}</span>
        <span className="sep">/</span>
        <span className="muted">{fmtTimecode(total, settings.fps)}</span>
      </div>
      <div className="transport-buttons">
        <button className="icon-btn" onClick={() => seek(0)} title="Início (Home)" aria-label="Início">
          <Icon name="toStart" />
        </button>
        <button className="icon-btn" onClick={() => seek(currentTime - frame)} title="Quadro anterior (←)" aria-label="Quadro anterior">
          <Icon name="stepBack" />
        </button>
        <button className="play-btn" onClick={() => engine.toggle()} title="Reproduzir / pausar (Espaço)" aria-label={playing ? 'Pausar' : 'Reproduzir'} disabled={total <= 0}>
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
        <button className="icon-btn" onClick={() => seek(currentTime + frame)} title="Próximo quadro (→)" aria-label="Próximo quadro">
          <Icon name="stepForward" />
        </button>
        <button className="icon-btn" onClick={() => seek(total)} title="Fim (End)" aria-label="Fim">
          <Icon name="toEnd" />
        </button>
      </div>
      <div className="transport-right">
        {!theater && <OrientationToggle settings={settings} />}
        <select hidden={theater} value={settings.aspect} onChange={(e) => setAspect(e.target.value)} title="Outros formatos" aria-label="Proporção">
          {Object.keys(ASPECTS).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <QualitySelect />
        <button className="icon-btn" onClick={() => setTheater(!theater)} title={theater ? 'Sair da tela cheia (Esc)' : 'Tela cheia (F11)'} aria-label={theater ? 'Sair da tela cheia' : 'Tela cheia'}>
          <Icon name="fullscreen" />
        </button>
      </div>
    </div>
  );
}
