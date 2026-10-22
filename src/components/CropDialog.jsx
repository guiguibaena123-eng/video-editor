import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, clipEnd, cropOf, mediaUrl } from '../store';
import { engine } from '../engine';
import { Icon } from '../icons';
import { dragPointer, clamp } from '../util';
import { sourceAt } from '../speed';

const RATIOS = [
  ['free', 'Livre', null],
  ['original', 'Original', 'original'],
  ['16:9', '16:9', 16 / 9],
  ['9:16', '9:16', 9 / 16],
  ['1:1', '1:1', 1],
  ['4:3', '4:3', 4 / 3],
  ['3:4', '3:4', 3 / 4],
  ['4:5', '4:5', 4 / 5],
  ['2.35:1', '2.35:1', 2.35],
];
const MIN_PX = 24;

export default function CropDialog() {
  const clipId = useStore((s) => s.cropClipId);
  const clip = useStore((s) => s.project.clips.find((c) => c.id === s.cropClipId));
  const media = useStore((s) => s.media.find((m) => m.id === clip?.mediaId));
  const canvasRef = useRef(null);
  const [disp, setDisp] = useState(null); // tamanho do quadro na tela
  const dispRef = useRef(null);
  const [rect, setRect] = useState(null); // recorte em pixels da tela
  const [ratioKey, setRatioKey] = useState(clip?.cropRatio || 'free');
  const [ready, setReady] = useState(false);

  const close = () => useStore.setState({ cropClipId: null });

  useEffect(() => {
    engine.pause();
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') document.getElementById('crop-apply')?.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!clip || !media) close();
  }, [clip, media]);

  // Tamanho de exibição: o maior possível que caiba na janela.
  useLayoutEffect(() => {
    if (!media) return;
    const fit = () => {
      const maxW = Math.min(980, window.innerWidth - 120);
      const maxH = Math.min(620, window.innerHeight - 260);
      const k = Math.min(maxW / media.width, maxH / media.height);
      const d = { w: Math.round(media.width * k), h: Math.round(media.height * k) };
      const prev = dispRef.current;
      dispRef.current = d;
      setDisp(d);
      const c = cropOf(clip);
      // Ao redimensionar a janela, o recorte acompanha na mesma proporção.
      setRect((r) => (r && prev ? { x: (r.x / prev.w) * d.w, y: (r.y / prev.h) * d.h, w: (r.w / prev.w) * d.w, h: (r.h / prev.h) * d.h } : { x: c.x * d.w, y: c.y * d.h, w: c.w * d.w, h: c.h * d.h }));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [media?.id]);

  // Mostra o quadro do clipe no ponto do cursor (ou o primeiro quadro do trecho).
  useEffect(() => {
    if (!disp || !media) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = disp.w * dpr;
    canvas.height = disp.h * dpr;
    const g = canvas.getContext('2d');
    const draw = (src) => {
      g.drawImage(src, 0, 0, canvas.width, canvas.height);
      setReady(true);
    };
    if (media.type === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => draw(img);
      img.src = mediaUrl(media.path);
      return;
    }
    const t = useStore.getState().currentTime;
    const inside = t >= clip.start && t < clipEnd(clip);
    const target = inside ? sourceAt(clip, t - clip.start) : clip.in;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.onloadeddata = () => (v.currentTime = Math.min(target, Math.max(0, media.duration - 0.05)));
    v.onseeked = () => draw(v);
    v.src = mediaUrl(media.path);
    return () => {
      v.removeAttribute('src');
      v.load();
    };
  }, [disp, media?.id]);

  if (!clip || !media || !disp || !rect) return null;

  const ratioValue = (key) => {
    const r = RATIOS.find((x) => x[0] === key)?.[2];
    return r === 'original' ? media.width / media.height : r;
  };
  const ratio = ratioValue(ratioKey);

  // Escolher uma proporção: maior retângulo dessa proporção, centrado no recorte atual.
  const chooseRatio = (key) => {
    setRatioKey(key);
    const r = ratioValue(key);
    if (!r) return;
    let w = disp.w;
    let h = w / r;
    if (h > disp.h) {
      h = disp.h;
      w = h * r;
    }
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    setRect({ x: clamp(cx - w / 2, 0, disp.w - w), y: clamp(cy - h / 2, 0, disp.h - h), w, h });
  };

  const startMove = (e) => {
    e.stopPropagation();
    const o = rect;
    const sx = e.clientX;
    const sy = e.clientY;
    dragPointer(e, (ev) => {
      setRect({ ...o, x: clamp(o.x + ev.clientX - sx, 0, disp.w - o.w), y: clamp(o.y + ev.clientY - sy, 0, disp.h - o.h) });
    });
  };

  // handle: combinação de 'n','s','e','w'. O lado oposto fica parado.
  const startResize = (e, handle) => {
    e.stopPropagation();
    const o = rect;
    const box = canvasRef.current.getBoundingClientRect();
    const left = o.x;
    const top = o.y;
    const right = o.x + o.w;
    const bottom = o.y + o.h;
    dragPointer(e, (ev) => {
      const px = clamp(ev.clientX - box.left, 0, disp.w);
      const py = clamp(ev.clientY - box.top, 0, disp.h);
      let x1 = left;
      let y1 = top;
      let x2 = right;
      let y2 = bottom;
      if (handle.includes('w')) x1 = Math.min(px, right - MIN_PX);
      if (handle.includes('e')) x2 = Math.max(px, left + MIN_PX);
      if (handle.includes('n')) y1 = Math.min(py, bottom - MIN_PX);
      if (handle.includes('s')) y2 = Math.max(py, top + MIN_PX);
      if (ratio && handle.length === 2) {
        // Canto com proporção fixa: o canto oposto é a âncora.
        const ax = handle.includes('w') ? right : left;
        const ay = handle.includes('n') ? bottom : top;
        const availW = handle.includes('w') ? ax : disp.w - ax;
        const availH = handle.includes('n') ? ay : disp.h - ay;
        let w = Math.max(Math.abs(px - ax), Math.abs(py - ay) * ratio, MIN_PX);
        w = Math.min(w, availW, availH * ratio);
        const h = w / ratio;
        x1 = handle.includes('w') ? ax - w : ax;
        x2 = x1 + w;
        y1 = handle.includes('n') ? ay - h : ay;
        y2 = y1 + h;
      }
      setRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    });
  };

  const apply = () => {
    const crop = {
      x: clamp(rect.x / disp.w, 0, 1),
      y: clamp(rect.y / disp.h, 0, 1),
      w: clamp(rect.w / disp.w, 0.01, 1),
      h: clamp(rect.h / disp.h, 0.01, 1),
    };
    const full = crop.x < 0.002 && crop.y < 0.002 && crop.w > 0.998 && crop.h > 0.998;
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clipId);
      if (full) {
        delete c.crop;
        delete c.cropRatio;
      } else {
        c.crop = crop;
        c.cropRatio = ratioKey;
      }
    });
    close();
  };

  const reset = () => {
    setRatioKey('free');
    setRect({ x: 0, y: 0, w: disp.w, h: disp.h });
  };

  const pxW = Math.round((rect.w / disp.w) * media.width);
  const pxH = Math.round((rect.h / disp.h) * media.height);
  const handles = ratio ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal crop-modal" role="dialog" aria-label="Recortar">
        <div className="modal-head">
          <h2>Recortar</h2>
          <button className="icon-btn" onClick={close} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="crop-stage">
          <div className="crop-frame" style={{ width: disp.w, height: disp.h }}>
            <canvas ref={canvasRef} style={{ width: disp.w, height: disp.h, opacity: ready ? 1 : 0 }} />
            <div className="crop-shade">
              <div style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
            </div>
            <div className="crop-rect" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} onPointerDown={startMove}>
              <span className="third v1" />
              <span className="third v2" />
              <span className="third h1" />
              <span className="third h2" />
              {handles.map((h) => (
                <span key={h} className={`crop-handle ${h}`} onPointerDown={(e) => startResize(e, h)} />
              ))}
            </div>
          </div>
        </div>
        <div className="crop-ratios seg">
          {RATIOS.map(([key, label]) => (
            <button key={key} className={ratioKey === key ? 'on' : ''} onClick={() => chooseRatio(key)} aria-pressed={ratioKey === key}>
              {label}
            </button>
          ))}
        </div>
        <div className="modal-foot crop-foot">
          <span className="muted">
            {pxW} × {pxH} px
          </span>
          <span className="spacer" />
          <button className="secondary" onClick={reset}>
            <Icon name="reset" size={15} /> Restaurar
          </button>
          <button className="secondary" onClick={close}>
            Cancelar
          </button>
          <button className="primary" id="crop-apply" onClick={apply}>
            <Icon name="check" size={16} /> Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
