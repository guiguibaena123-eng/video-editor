// Valores quadro a quadro dos clipes animados, para a exportação.
// Usa visualStateAt (a mesma conta da prévia), então o vídeo final anda igual ao player.
import { clipDur, croppedSize } from './store';
import { visualStateAt, valueAt, hasKeyframes } from './keyframes';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Linhas por quadro: [largura, altura, ângulo (rad), opacidade, x, y, desfoque]
// (x, y = canto do quadrado transparente de lado D que gira sem cortar a imagem).
export function visualFrames(clip, media, { width: W, height: H, fps, settings, project }) {
  const dur = clipDur(clip);
  const n = Math.max(1, Math.ceil(dur * fps - 1e-6));
  const { width: sw, height: sh } = croppedSize(media, clip);
  const fit = Math.min(W / sw, H / sh);
  const maxSide = 3 * Math.max(W, H); // limite de memória: maior que isso já está fora da tela
  const k = W / settings.width;
  const rows = [];
  let D = 2;
  for (let i = 0; i < n; i++) {
    const st = visualStateAt(clip, i / fps, dur, project);
    let w = sw * fit * st.scale;
    let h = sh * fit * st.scale;
    const over = Math.max(w, h) / maxSide;
    if (over > 1) {
      w /= over;
      h /= over;
    }
    w = even(w);
    h = even(h);
    D = Math.max(D, Math.ceil(Math.hypot(w, h)) + 4);
    rows.push([w, h, (st.rotation * Math.PI) / 180, Math.min(1, Math.max(0, st.opacity)), W / 2 + st.x * W, H / 2 + st.y * H, Math.max(0, st.blur * k)]);
  }
  D = even(D);
  return {
    D,
    f: rows.map(([w, h, a, op, cx, cy, blur]) => [w, h, +a.toFixed(5), +op.toFixed(4), Math.round(cx - D / 2), Math.round(cy - D / 2), +blur.toFixed(2)]),
  };
}

// Volume com keyframes: amostras [t, volume] 30 vezes por segundo.
// extra(local) = multiplicador a mais (ducking automático).
export function volumeSamples(clip, rate = 30, extra) {
  if (!hasKeyframes(clip, 'volume') && !extra) return undefined;
  const dur = clipDur(clip);
  const out = [];
  for (let i = 0; i <= Math.ceil(dur * rate); i++) out.push([+(i / rate).toFixed(4), +(valueAt(clip, 'volume', i / rate) * (extra ? extra(i / rate) : 1)).toFixed(4)]);
  return out;
}
