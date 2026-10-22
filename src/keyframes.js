// Keyframes: valores marcados em instantes do clipe; entre eles o editor anima sozinho.
// clip.keyframes = { x: [{ t, v, ease }], scale: [...], ... }  (t = segundos desde o início do clipe)
import { DEFAULT_TRANSFORM } from './store';
import { animState } from './text';
import { transitionMods, hasTransitionAt } from './transitions';
import { effectMods, hasMotionFx, withTrackFx } from './effects';

export const KF_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume'];
export const TRANSFORM_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];
export const EASES = [
  ['linear', 'Linear'],
  ['ease', 'Suave'],
  ['in', 'Acelerar'],
  ['out', 'Desacelerar'],
];

const easeFn = {
  linear: (p) => p,
  ease: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  in: (p) => p * p * p,
  out: (p) => 1 - Math.pow(1 - p, 3),
};

export function baseValue(clip, prop) {
  if (prop === 'volume') return clip.volume ?? 1;
  return { ...DEFAULT_TRANSFORM, ...clip.transform }[prop];
}

export const hasKeyframes = (clip, prop) => (prop ? (clip.keyframes?.[prop]?.length || 0) > 0 : KF_PROPS.some((p) => clip.keyframes?.[p]?.length));

// Valor da propriedade no instante "local" do clipe.
export function valueAt(clip, prop, local) {
  const ks = clip.keyframes?.[prop];
  if (!ks?.length) return baseValue(clip, prop);
  if (local <= ks[0].t) return ks[0].v;
  for (let i = 1; i < ks.length; i++) {
    const b = ks[i];
    if (local <= b.t) {
      const a = ks[i - 1];
      const p = b.t > a.t ? (local - a.t) / (b.t - a.t) : 1;
      return a.v + (b.v - a.v) * (easeFn[a.ease] || easeFn.ease)(p);
    }
  }
  return ks[ks.length - 1].v;
}

export function transformAt(clip, local) {
  const out = {};
  for (const p of TRANSFORM_PROPS) out[p] = valueAt(clip, p, local);
  return out;
}

const animOn = (clip) => ['in', 'out', 'loop'].some((k) => clip.anim?.[k]?.type && clip.anim[k].type !== 'none');

// Clipe muda ao longo do tempo (keyframes ou animação)? Na exportação ele é calculado quadro a quadro.
export const isAnimated = (clip, project) => hasKeyframes(clip) || animOn(clip) || hasMotionFx(withTrackFx(project, clip)) || (!!project && hasTransitionAt(project, clip));

// Estado visual final num instante: keyframes + animação de entrada/saída/repetição + efeitos de movimento.
// Com "project", inclui as transições com os clipes vizinhos.
export function visualStateAt(clip, local, dur, project) {
  const tr = transformAt(clip, local);
  const t = transitionMods(project, clip, local, dur);
  const a = animOn(clip) ? animState(clip.anim, local, dur) : { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, blur: 0 };
  const e = effectMods(withTrackFx(project, clip), local, dur);
  return {
    x: tr.x + a.dx + t.dx + e.dx,
    y: tr.y + a.dy + t.dy + e.dy,
    scale: tr.scale * a.scale * t.scale * e.scale,
    rotation: tr.rotation + a.rotation + t.rotation + e.rotation,
    opacity: tr.opacity * a.opacity * t.opacity * e.opacity,
    blur: a.blur + t.blur + e.blur,
  };
}

export function keyframeTimes(clip) {
  const ts = [];
  for (const p of KF_PROPS) for (const k of clip.keyframes?.[p] || []) if (!ts.some((t) => Math.abs(t - k.t) < 1e-3)) ts.push(k.t);
  return ts.sort((a, b) => a - b);
}

export const findKey = (clip, prop, local, tol) => (clip.keyframes?.[prop] || []).findIndex((k) => Math.abs(k.t - local) <= tol);

// ---------- alterações (mutam o clipe; use dentro de commit/live) ----------

export function setKeyframe(c, prop, local, v, tol) {
  c.keyframes = { ...(c.keyframes || {}) };
  const ks = [...(c.keyframes[prop] || [])];
  const i = ks.findIndex((k) => Math.abs(k.t - local) <= tol);
  if (i >= 0) ks[i] = { ...ks[i], v };
  else ks.push({ t: Math.max(0, local), v, ease: 'ease' });
  ks.sort((a, b) => a.t - b.t);
  c.keyframes[prop] = ks;
}

export function removeKeyframe(c, prop, local, tol) {
  const ks = (c.keyframes?.[prop] || []).filter((k) => Math.abs(k.t - local) > tol);
  c.keyframes = { ...(c.keyframes || {}), [prop]: ks };
  if (!ks.length) {
    delete c.keyframes[prop];
    if (!Object.keys(c.keyframes).length) delete c.keyframes;
  }
}

// Mudou um valor no painel ou no player: se a propriedade já tem keyframes, grava um keyframe
// no instante atual (como no CapCut); senão muda o valor fixo do clipe.
export function applyProp(c, prop, v, local, tol) {
  if (hasKeyframes(c, prop)) return setKeyframe(c, prop, local, v, tol);
  if (prop === 'volume') c.volume = v;
  else c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, [prop]: v };
}

// Ajustes quando o tempo do clipe muda, para os keyframes continuarem presos ao mesmo conteúdo.
export function shiftKeyframes(c, delta) {
  if (!c.keyframes || !delta) return;
  for (const p of Object.keys(c.keyframes)) c.keyframes[p] = c.keyframes[p].map((k) => ({ ...k, t: k.t + delta }));
}
export function scaleKeyframes(c, factor) {
  if (!c.keyframes || factor === 1 || !Number.isFinite(factor)) return;
  for (const p of Object.keys(c.keyframes)) c.keyframes[p] = c.keyframes[p].map((k) => ({ ...k, t: k.t * factor }));
}

// Ao dividir: a esquerda fica com os keyframes antes do corte e a direita com os depois,
// e as duas ganham um keyframe no ponto do corte para o valor continuar igual.
export function splitKeyframes(left, right, cut) {
  if (!left.keyframes) return;
  const L = {};
  const R = {};
  for (const p of Object.keys(left.keyframes)) {
    const v = valueAt(left, p, cut);
    const ks = left.keyframes[p];
    L[p] = [...ks.filter((k) => k.t < cut - 1e-3), { t: cut, v, ease: 'ease' }];
    R[p] = [{ t: 0, v, ease: 'ease' }, ...ks.filter((k) => k.t > cut + 1e-3).map((k) => ({ ...k, t: k.t - cut }))];
  }
  left.keyframes = L;
  right.keyframes = R;
}
