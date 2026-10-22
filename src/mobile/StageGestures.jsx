import { useRef, useState } from 'react';
import { useStore, clipEnd, DEFAULT_TRANSFORM } from '../store';
import { engine, visualBox } from '../engine';
import { transformAt, applyProp } from '../keyframes';
import { haptic } from './ui';

const SNAP_PX = 6;
const TAP_MOVE = 8; // pixels: abaixo disso o toque ainda é um "toque"

function activeVisualClips(s) {
  const t = s.currentTime;
  const out = [];
  for (const tr of s.project.tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue;
    for (const c of s.project.clips) if (c.trackId === tr.id && t >= c.start && t < clipEnd(c)) out.push({ clip: c, track: tr });
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

// Camada de toque sobre o player: toque seleciona, um dedo move, dois dedos dão zoom e giram o clipe selecionado.
export default function StageGestures({ w, h }) {
  const selection = useStore((s) => s.selection);
  const media = useStore((s) => s.media);
  const settings = useStore((s) => s.project.settings);
  const now = useStore((s) => s.currentTime);
  useStore((s) => s.project);
  const activeKey = useStore((s) => activeVisualClips(s).map((a) => a.clip.id).join(','));
  const [guides, setGuides] = useState({ v: false, h: false });
  const ref = useRef(null);
  const pointers = useRef(new Map());
  const g = useRef(null); // gesto em andamento

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const view = (clip) => (clip.keyframes ? { ...clip, transform: { ...clip.transform, ...transformAt(clip, now - clip.start) } } : clip);
  const active = activeKey ? activeVisualClips(useStore.getState()) : [];
  const selected = selection.length === 1 ? active.find((a) => a.clip.id === selection[0]) : null;
  const box = selected ? visualBox(view(selected.clip), mediaById.get(selected.clip.mediaId), w, h, settings) : null;
  const locked = selected?.track.locked;

  const local = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const update = (id, patch) => {
    const st = useStore.getState();
    const tol = 0.5 / st.project.settings.fps;
    st.live((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (!c) return;
      for (const [k, v] of Object.entries(patch)) applyProp(c, k, v, st.currentTime - c.start, tol);
    });
  };

  const currentOf = (id) => {
    const st = useStore.getState();
    const c = st.project.clips.find((x) => x.id === id);
    return c ? { clip: c, tr: { ...DEFAULT_TRANSFORM, ...view(c).transform } } : null;
  };

  const begin = () => {
    // Prepara o gesto conforme a quantidade de dedos e o clipe selecionado.
    const st = useStore.getState();
    const pts = [...pointers.current.values()];
    const sel = st.selection.length === 1 ? activeVisualClips(st).find((a) => a.clip.id === st.selection[0]) : null;
    if (g.current?.moved) st.gestureEnd?.();
    g.current = { moved: g.current?.moved || false, started: false, id: sel && !sel.track.locked ? sel.clip.id : null, startPts: pts, t0: g.current?.t0 ?? Date.now(), hadMulti: g.current?.hadMulti || pts.length > 1 };
    const cur = g.current.id && currentOf(g.current.id);
    g.current.orig = cur?.tr;
    g.current.clipRef = cur?.clip;
    if (pts.length >= 2) {
      g.current.d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      g.current.a0 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
    }
    g.current.started = false;
  };

  const onDown = (e) => {
    ref.current.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) g.current = { moved: false, t0: Date.now(), down: local(e) };
    else if (g.current) g.current.hadMulti = true;
    begin();
  };

  const onMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !g.current) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const st = useStore.getState();
    const gg = g.current;
    const far = Math.hypot(pts[0].x - gg.startPts[0].x, pts[0].y - gg.startPts[0].y) > TAP_MOVE;
    if (!gg.id || !gg.orig) {
      if (far) gg.moved = true;
      return;
    }
    if (!gg.started) {
      if (!far && pts.length < 2) return;
      gg.started = true;
      gg.moved = true;
      st.gestureStart();
    }
    const orig = gg.orig;
    const patch = {};
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      let scale = Math.max(0.05, Math.min(10, (orig.scale * d) / gg.d0));
      if (Math.abs(scale - 1) < 0.03) scale = 1;
      let deg = orig.rotation + ((Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) - gg.a0) * 180) / Math.PI;
      deg = ((deg + 540) % 360) - 180;
      const near = Math.round(deg / 45) * 45;
      if (Math.abs(deg - near) < 4) deg = near;
      patch.scale = scale;
      patch.rotation = Math.round(deg * 10) / 10;
      // O centro entre os dedos também arrasta.
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const sx = (gg.startPts[0].x + (gg.startPts[1]?.x ?? gg.startPts[0].x)) / 2;
      const sy = (gg.startPts[0].y + (gg.startPts[1]?.y ?? gg.startPts[0].y)) / 2;
      patch.x = orig.x + (cx - sx) / w;
      patch.y = orig.y + (cy - sy) / h;
    } else {
      let x = orig.x + (pts[0].x - gg.startPts[0].x) / w;
      let y = orig.y + (pts[0].y - gg.startPts[0].y) / h;
      const m = mediaById.get(gg.clipRef.mediaId);
      const b = visualBox({ ...gg.clipRef, transform: { ...orig, x, y } }, m, w, h, st.project.settings);
      const snapV = Math.abs(b.cx - w / 2) < SNAP_PX;
      const snapH = Math.abs(b.cy - h / 2) < SNAP_PX;
      if (snapV) x = 0;
      if (snapH) y = 0;
      if (snapV !== gg.sv || snapH !== gg.sh) {
        if (snapV || snapH) haptic(8);
        gg.sv = snapV;
        gg.sh = snapH;
      }
      setGuides({ v: snapV, h: snapH });
      patch.x = x;
      patch.y = y;
    }
    update(gg.id, patch);
  };

  const finish = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const gg = g.current;
    const p = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      begin(); // sobrou um dedo: continua movendo a partir da posição atual
      return;
    }
    setGuides({ v: false, h: false });
    const st = useStore.getState();
    if (gg?.started) st.gestureEnd();
    // Toque curto sem movimento: seleciona o clipe do dedo, ou fecha a seleção, ou liga/desliga o play.
    if (gg && !gg.moved && !gg.hadMulti && e.type === 'pointerup' && Date.now() - gg.t0 < 500) {
      const target = activeVisualClips(st).find(({ clip }) => {
        const b = visualBox(view(clip), mediaById.get(clip.mediaId), w, h, st.project.settings);
        return b && hit(b, p.x, p.y);
      });
      if (target) {
        if (st.selection[0] !== target.clip.id) {
          st.select([target.clip.id]);
          haptic(8);
        } else engine.toggle();
      } else if (st.selection.length) st.select([]);
      else if (st.project.clips.length) engine.toggle();
    }
    g.current = null;
  };

  return (
    <div ref={ref} className="stage-touch" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={finish} onPointerCancel={finish}>
      {guides.v && <i className="guide v" />}
      {guides.h && <i className="guide h" />}
      {box && (
        <div className={'sel-box' + (locked ? ' locked' : '')} style={{ left: box.cx - box.w / 2, top: box.cy - box.h / 2, width: box.w, height: box.h, transform: `rotate(${box.rotation}deg)` }} />
      )}
    </div>
  );
}
