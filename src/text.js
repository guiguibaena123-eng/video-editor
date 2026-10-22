// Desenho de textos no canvas. A prévia e a exportação usam exatamente estas funções,
// então o vídeo final sai igual ao que aparece no player.
import { fontInfo } from './fonts';
import { clipDur, DEFAULT_TRANSFORM } from './store';

export const DEFAULT_STYLE = {
  content: 'Texto',
  font: 'Montserrat',
  size: 96, // em pixels do projeto (ex.: quadro 1920×1080)
  bold: true,
  italic: false,
  underline: false,
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.15,
  color: '#ffffff',
  gradient: { enabled: false, from: '#ffd34d', to: '#ff4e7a' },
  stroke: { enabled: false, color: '#000000', width: 6 },
  shadow: { enabled: false, color: '#000000', opacity: 0.6, blur: 14, distance: 6, angle: 45 },
  glow: { enabled: false, color: '#ffc72c', strength: 26 },
  background: { enabled: false, color: '#000000', opacity: 0.7, radius: 14, padding: 24 },
};

export const DEFAULT_ANIM = {
  in: { type: 'none', dur: 0.5 },
  out: { type: 'none', dur: 0.5 },
  loop: { type: 'none', period: 1.2 },
};

export const ANIMS_IN = [
  ['none', 'Nenhuma'],
  ['fade', 'Surgir'],
  ['slideUp', 'Subir'],
  ['slideDown', 'Descer'],
  ['slideLeft', 'Vir da direita'],
  ['slideRight', 'Vir da esquerda'],
  ['zoomIn', 'Zoom'],
  ['zoomOut', 'Encolher'],
  ['pop', 'Pop'],
  ['blur', 'Desfoque'],
  ['typewriter', 'Máquina de escrever'],
];
export const ANIMS_OUT = [
  ['none', 'Nenhuma'],
  ['fade', 'Sumir'],
  ['slideUp', 'Subir'],
  ['slideDown', 'Descer'],
  ['slideLeft', 'Ir para a esquerda'],
  ['slideRight', 'Ir para a direita'],
  ['zoomIn', 'Ampliar'],
  ['zoomOut', 'Encolher'],
  ['pop', 'Pop'],
  ['blur', 'Desfoque'],
  ['typewriter', 'Apagar letras'],
];
export const ANIMS_LOOP = [
  ['none', 'Nenhuma'],
  ['pulse', 'Pulsar'],
  ['sway', 'Balançar'],
  ['float', 'Flutuar'],
  ['blink', 'Piscar'],
  ['shake', 'Tremer'],
];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  return out;
}
export const withStyle = (text) => merge(DEFAULT_STYLE, text);
export const withAnim = (anim) => merge(DEFAULT_ANIM, anim);

export function fontString(st, px) {
  const info = fontInfo(st.font);
  const weight = st.bold && info.bold ? info.bold : 400;
  return `${st.italic ? 'italic ' : ''}${weight} ${px}px "${st.font}"`;
}

// Carrega a fonte sob demanda; enquanto não chega, o canvas usa uma fonte reserva.
const loadingFonts = new Set();
export function ensureFont(font) {
  if (document.fonts.check(font)) return true;
  if (!loadingFonts.has(font)) {
    loadingFonts.add(font);
    document.fonts.load(font).finally(() => loadingFonts.delete(font));
  }
  return false;
}
export const loadFont = (st) => document.fonts.load(fontString(withStyle(st), 64));

// ---------- animação ----------

const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const backOut = (p) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const SLIDE = 0.12; // fração do quadro

// p = 0 → estado escondido, p = 1 → estado normal. dir = +1 entrada, -1 saída.
function applyAnim(s, type, p, dir) {
  const e = easeOut(p);
  switch (type) {
    case 'fade':
      s.opacity *= e;
      break;
    case 'slideUp':
      s.dy += dir * (1 - e) * SLIDE;
      s.opacity *= e;
      break;
    case 'slideDown':
      s.dy -= dir * (1 - e) * SLIDE;
      s.opacity *= e;
      break;
    case 'slideLeft':
      s.dx += dir * (1 - e) * SLIDE;
      s.opacity *= e;
      break;
    case 'slideRight':
      s.dx -= dir * (1 - e) * SLIDE;
      s.opacity *= e;
      break;
    case 'zoomIn':
      s.scale *= dir > 0 ? 0.3 + 0.7 * e : 1 + 0.6 * (1 - e);
      s.opacity *= e;
      break;
    case 'zoomOut':
      s.scale *= dir > 0 ? 1.6 - 0.6 * e : 0.3 + 0.7 * e;
      s.opacity *= e;
      break;
    case 'pop':
      s.scale *= Math.max(0, backOut(p));
      s.opacity *= clamp01(p * 3);
      break;
    case 'blur':
      s.blur += (1 - e) * 24;
      s.opacity *= e;
      break;
    case 'typewriter':
      s.reveal = Math.min(s.reveal, p);
      break;
    default:
  }
}

export function animSpans(anim, dur) {
  const a = withAnim(anim);
  const inDur = a.in.type !== 'none' ? Math.min(a.in.dur, dur) : 0;
  const outDur = a.out.type !== 'none' ? Math.min(a.out.dur, Math.max(0, dur - inDur)) : 0;
  return { a, inDur, outDur, loop: a.loop.type !== 'none' };
}

export function animState(anim, local, dur) {
  const s = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, reveal: 1, blur: 0 };
  const { a, inDur, outDur } = animSpans(anim, dur);
  if (inDur > 0 && local < inDur) applyAnim(s, a.in.type, clamp01(local / inDur), 1);
  if (outDur > 0 && local > dur - outDur) applyAnim(s, a.out.type, clamp01((dur - local) / outDur), -1);
  const w = (2 * Math.PI * local) / Math.max(0.1, a.loop.period);
  switch (a.loop.type) {
    case 'pulse':
      s.scale *= 1 + 0.07 * Math.sin(w);
      break;
    case 'sway':
      s.rotation += 5 * Math.sin(w);
      break;
    case 'float':
      s.dy += 0.014 * Math.sin(w);
      break;
    case 'blink':
      s.opacity *= 0.2 + 0.8 * (0.5 + 0.5 * Math.cos(w));
      break;
    case 'shake':
      s.dx += 0.004 * Math.sin(w * 7);
      s.dy += 0.004 * Math.cos(w * 9);
      break;
    default:
  }
  return s;
}

// ---------- medidas ----------

const measureCtx = document.createElement('canvas').getContext('2d');

export function layoutText(st, k, maxW) {
  const px = Math.max(1, st.size * k);
  const g = measureCtx;
  g.font = fontString(st, px);
  g.letterSpacing = `${st.letterSpacing * k}px`;
  const lines = [];
  for (const para of String(st.content ?? '').split('\n')) {
    let cur = '';
    for (const word of para.split(' ')) {
      const test = cur ? cur + ' ' + word : word;
      if (cur && g.measureText(test).width > maxW) {
        lines.push(cur);
        cur = word;
      } else cur = test;
    }
    lines.push(cur);
  }
  const widths = lines.map((l) => g.measureText(l).width);
  const lineH = px * st.lineHeight;
  return { px, lines, widths, w: Math.max(px * 0.3, ...widths), h: lines.length * lineH, lineH };
}

const extraOf = (st, k) => Math.max(st.background.enabled ? st.background.padding * k : 0, st.stroke.enabled ? st.stroke.width * k : 0);

// Retângulo do texto no quadro (sem animação), para seleção e arrastar no player.
export function textBounds(clip, W, H, settings) {
  const st = withStyle(clip.text);
  const tr = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const k = W / settings.width;
  const L = layoutText(st, k, W * 0.92);
  const e = extraOf(st, k);
  return { w: (L.w + 2 * e) * tr.scale, h: (L.h + 2 * e) * tr.scale, cx: W / 2 + tr.x * W, cy: H / 2 + tr.y * H, rotation: tr.rotation };
}

// ---------- desenho ----------

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawTextClip(g, clip, local, W, H, settings, opts = {}) {
  const st = withStyle(clip.text);
  // opts.transform: posição/escala do instante (com keyframes), calculada por quem chama.
  const tr = { ...DEFAULT_TRANSFORM, ...clip.transform, ...opts.transform };
  const k = W / settings.width;
  const a = opts.static ? { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, reveal: 1, blur: 0 } : animState(clip.anim, local, clipDur(clip));
  const alpha = tr.opacity * a.opacity;
  if (alpha <= 0.001 || !st.content) return;
  const L = layoutText(st, k, W * 0.92);
  const font = fontString(st, L.px);
  ensureFont(font);
  const scale = tr.scale * a.scale;

  g.save();
  g.globalAlpha = alpha;
  g.translate(W / 2 + (tr.x + a.dx) * W, H / 2 + (tr.y + a.dy) * H);
  g.rotate(((tr.rotation + a.rotation) * Math.PI) / 180);
  g.scale(scale, scale);
  if (a.blur > 0.05) g.filter = `blur(${a.blur * k}px)`;
  g.font = font;
  g.letterSpacing = `${st.letterSpacing * k}px`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';

  if (st.background.enabled) {
    const pad = st.background.padding * k;
    g.save();
    g.globalAlpha *= st.background.opacity;
    g.fillStyle = st.background.color;
    g.beginPath();
    g.roundRect(-L.w / 2 - pad, -L.h / 2 - pad, L.w + 2 * pad, L.h + 2 * pad, Math.min(st.background.radius * k, (L.h + 2 * pad) / 2));
    g.fill();
    g.restore();
  }

  // Máquina de escrever: mostra só parte das letras.
  const total = L.lines.reduce((n, l) => n + l.length, 0);
  let budget = Math.round(total * a.reveal);
  const rows = L.lines.map((line, i) => {
    const vis = line.slice(0, Math.max(0, budget));
    budget -= line.length;
    const w = L.widths[i];
    const x = st.align === 'left' ? -L.w / 2 : st.align === 'right' ? L.w / 2 - w : -w / 2;
    return { vis, x, y: -L.h / 2 + L.lineH * (i + 0.5) };
  });
  const each = (fn) => rows.forEach((r) => r.vis && fn(r));

  if (st.glow.enabled) {
    g.save();
    g.shadowColor = st.glow.color;
    g.shadowBlur = st.glow.strength * k * scale;
    g.fillStyle = st.glow.color;
    each((r) => g.fillText(r.vis, r.x, r.y));
    each((r) => g.fillText(r.vis, r.x, r.y));
    g.restore();
  }

  const shadowOn = () => {
    if (!st.shadow.enabled) return;
    const rad = (st.shadow.angle * Math.PI) / 180;
    const d = st.shadow.distance * k * scale;
    g.shadowColor = hexA(st.shadow.color, st.shadow.opacity);
    g.shadowBlur = st.shadow.blur * k * scale;
    g.shadowOffsetX = Math.cos(rad) * d;
    g.shadowOffsetY = Math.sin(rad) * d;
  };

  if (st.stroke.enabled && st.stroke.width > 0) {
    g.save();
    shadowOn();
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.lineWidth = st.stroke.width * k * 2;
    g.strokeStyle = st.stroke.color;
    each((r) => g.strokeText(r.vis, r.x, r.y));
    g.restore();
  }

  g.save();
  if (!st.stroke.enabled) shadowOn();
  if (st.gradient.enabled) {
    const grad = g.createLinearGradient(0, -L.h / 2, 0, L.h / 2);
    grad.addColorStop(0, st.gradient.from);
    grad.addColorStop(1, st.gradient.to);
    g.fillStyle = grad;
  } else g.fillStyle = st.color;
  each((r) => {
    g.fillText(r.vis, r.x, r.y);
    if (st.underline) {
      const w = measureWithSpacing(g, r.vis);
      g.fillRect(r.x, r.y + L.px * 0.42, w, Math.max(1, L.px * 0.06));
    }
  });
  g.restore();
  g.restore();
}

const measureWithSpacing = (g, s) => g.measureText(s).width;
