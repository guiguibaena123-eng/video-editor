// Cor dos clipes. Todos os ajustes viram uma função cor → cor, que é amostrada numa LUT 3D.
// A prévia (WebGL) e a exportação (FFmpeg lut3d) usam a mesma LUT, então a cor final é igual.

import { makeLook, hasLook, lookVignette } from './looks';
import { makeCamera, hasCamera, opticsOf } from './cameras';

export const LUT_SIZE = 33;
// Tamanhos maiores deixam a LUT mais fiel nos looks de cor forte: a prévia sobe para 49 quando
// para de mexer nos controles e a exportação usa 65.
export const LUT_SIZE_PREVIEW_HQ = 49;
export const LUT_SIZE_EXPORT = 65;

export const HSL_BANDS = [
  ['red', 'Vermelho', 0, '#ff3b30'],
  ['orange', 'Laranja', 30, '#ff9500'],
  ['yellow', 'Amarelo', 60, '#ffcc00'],
  ['green', 'Verde', 120, '#34c759'],
  ['cyan', 'Ciano', 180, '#32d6e8'],
  ['blue', 'Azul', 225, '#0a84ff'],
  ['purple', 'Roxo', 270, '#8e5cf6'],
  ['magenta', 'Magenta', 315, '#ff2d92'],
];

// [chave, nome, grupo]
export const ADJUSTMENTS = [
  ['exposure', 'Exposição', 'light'],
  ['brightness', 'Brilho', 'light'],
  ['contrast', 'Contraste', 'light'],
  ['highlights', 'Realces', 'light'],
  ['shadows', 'Sombras', 'light'],
  ['whites', 'Brancos', 'light'],
  ['blacks', 'Pretos', 'light'],
  ['fade', 'Desbotar', 'light'],
  ['temperature', 'Temperatura', 'color'],
  ['tint', 'Tom (verde ↔ rosa)', 'color'],
  ['saturation', 'Saturação', 'color'],
  ['vibrance', 'Vibração', 'color'],
  ['hue', 'Matiz geral', 'color'],
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l) {
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hh = (((h % 360) + 360) % 360) / 360;
  return [hue2rgb(p, q, hh + 1 / 3), hue2rgb(p, q, hh), hue2rgb(p, q, hh - 1 / 3)];
}

// Cor pura de um ângulo (para as rodas de cor), sem a luminosidade: só o "empurrão" de cor.
function hueOffset(deg) {
  const [r, g, b] = hslToRgb(deg, 1, 0.5);
  const L = lum(r, g, b);
  return [r - L, g - L, b - L];
}

// Curva suave que passa pelos pontos e nunca "volta" (interpolação monotônica).
export function curveTable(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const table = new Float32Array(256);
  for (let k = 0; k < 256; k++) {
    const x = k / 255;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    if (x <= xs[0]) table[k] = ys[0];
    else if (x >= xs[n - 1]) table[k] = ys[n - 1];
    else {
      const h = xs[i + 1] - xs[i];
      const t = (x - xs[i]) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      table[k] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    }
  }
  return table;
}
const lookup = (table, v) => {
  const p = clamp01(v) * 255;
  const i = Math.floor(p);
  return i >= 255 ? table[255] : table[i] + (table[i + 1] - table[i]) * (p - i);
};
const isIdentityCurve = (pts) => !pts || (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1);

// Função dos ajustes: (r, g, b) em 0..1 → [r, g, b].
export function makeAdjust(s = {}) {
  const exp = Math.pow(2, s.exposure || 0);
  const bri = (s.brightness || 0) * 0.25;
  const con = 1 + (s.contrast || 0);
  const sat = 1 + (s.saturation || 0);
  const vib = s.vibrance || 0;
  const temp = s.temperature || 0;
  const tint = s.tint || 0;
  const hi = s.highlights || 0;
  const sh = s.shadows || 0;
  const fade = s.fade || 0;
  const whites = s.whites || 0;
  const blacks = s.blacks || 0;
  const hueShift = (s.hue || 0) * 180;
  const bands = HSL_BANDS.map(([id, , center]) => [center, s.hsl?.[id]]).filter(([, v]) => v && (v.h || v.s || v.l));
  const curves = {};
  for (const ch of ['master', 'r', 'g', 'b']) if (!isIdentityCurve(s.curves?.[ch])) curves[ch] = curveTable(s.curves[ch]);
  const wheels = ['shadows', 'midtones', 'highlights', 'global']
    .map((k) => [k, s.wheels?.[k]])
    .filter(([, w]) => w && (w.amount || w.lum))
    .map(([k, w]) => [k, hueOffset(w.hue || 0), (w.amount || 0) * 0.35, (w.lum || 0) * 0.25]);

  return (r, g, b) => {
    r *= exp;
    g *= exp;
    b *= exp;
    // Temperatura: mais quente puxa para o laranja; matiz: verde ↔ magenta.
    r *= 1 + 0.18 * temp;
    b *= 1 - 0.18 * temp;
    g *= 1 - 0.12 * tint;
    r += bri;
    g += bri;
    b += bri;
    r = (r - 0.5) * con + 0.5;
    g = (g - 0.5) * con + 0.5;
    b = (b - 0.5) * con + 0.5;
    if (hi || sh) {
      const L = clamp01(lum(r, g, b));
      const d = sh * 0.3 * (1 - L) * (1 - L) + hi * 0.3 * L * L;
      r += d;
      g += d;
      b += d;
    }
    if (whites || blacks) {
      // Brancos mexem só no topo da luz; pretos só no fundo (como em editores de foto).
      const L = clamp01(lum(r, g, b));
      const d = whites * 0.25 * L * L * L + blacks * 0.2 * (1 - L) * (1 - L) * (1 - L);
      r += d;
      g += d;
      b += d;
    }
    if (sat !== 1 || vib) {
      const L = lum(r, g, b);
      const cs = Math.max(r, g, b) - Math.min(r, g, b);
      const k = sat * (1 + vib * (1 - clamp01(cs)));
      r = L + (r - L) * k;
      g = L + (g - L) * k;
      b = L + (b - L) * k;
    }
    if (hueShift) {
      const [h, ss, l] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
      [r, g, b] = hslToRgb(h + hueShift, ss, l);
    }
    if (bands.length) {
      let [h, ss, l] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
      let dh = 0;
      let ds = 0;
      let dl = 0;
      for (const [center, v] of bands) {
        let dist = Math.abs(h - center);
        if (dist > 180) dist = 360 - dist;
        if (dist >= 45) continue;
        const w = Math.pow(Math.cos((dist / 45) * (Math.PI / 2)), 2) * Math.min(1, ss * 3);
        dh += (v.h || 0) * 30 * w;
        ds += (v.s || 0) * w;
        dl += (v.l || 0) * 0.25 * w;
      }
      h += dh;
      ss = clamp01(ss * (1 + ds));
      l = clamp01(l + dl * (1 - Math.abs(2 * l - 1) * 0.5));
      [r, g, b] = hslToRgb(h, ss, l);
    }
    if (wheels.length) {
      const L = clamp01(lum(r, g, b));
      for (const [k, off, amt, lm] of wheels) {
        const w = k === 'shadows' ? (1 - L) * (1 - L) : k === 'highlights' ? L * L : k === 'global' ? 0.6 : 4 * L * (1 - L);
        r += w * (off[0] * amt + lm);
        g += w * (off[1] * amt + lm);
        b += w * (off[2] * amt + lm);
      }
    }
    if (curves.master) {
      r = lookup(curves.master, r);
      g = lookup(curves.master, g);
      b = lookup(curves.master, b);
    }
    if (curves.r) r = lookup(curves.r, r);
    if (curves.g) g = lookup(curves.g, g);
    if (curves.b) b = lookup(curves.b, b);
    if (fade) {
      r = r * (1 - fade * 0.25) + fade * 0.1;
      g = g * (1 - fade * 0.25) + fade * 0.1;
      b = b * (1 - fade * 0.25) + fade * 0.1;
    }
    return [clamp01(r), clamp01(g), clamp01(b)];
  };
}

// LUT importada (.cube): leitura e aplicação com interpolação trilinear.
export function parseCube(text) {
  let size = 0;
  const vals = [];
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size = parseInt(parts[1], 10);
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (/^[-+\d.]/.test(parts[0]) && parts.length >= 3) vals.push(+parts[0], +parts[1], +parts[2]);
  }
  if (!size || vals.length < size * size * size * 3) throw new Error('Arquivo .cube inválido ou LUT 1D (só LUT 3D é aceita).');
  return { size, data: new Float32Array(vals.slice(0, size * size * size * 3)), min, max };
}

export function sampleCube(lut, r, g, b) {
  const n = lut.size;
  const d = lut.data;
  const f = (v, i) => clamp01((v - lut.min[i]) / (lut.max[i] - lut.min[i])) * (n - 1);
  const fr = f(r, 0);
  const fg = f(g, 1);
  const fb = f(b, 2);
  const r0 = Math.floor(fr);
  const g0 = Math.floor(fg);
  const b0 = Math.floor(fb);
  const r1 = Math.min(n - 1, r0 + 1);
  const g1 = Math.min(n - 1, g0 + 1);
  const b1 = Math.min(n - 1, b0 + 1);
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;
  const at = (ri, gi, bi, c) => d[((bi * n + gi) * n + ri) * 3 + c];
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(r0, g0, b0, c) * (1 - tr) + at(r1, g0, b0, c) * tr;
    const c10 = at(r0, g1, b0, c) * (1 - tr) + at(r1, g1, b0, c) * tr;
    const c01 = at(r0, g0, b1, c) * (1 - tr) + at(r1, g0, b1, c) * tr;
    const c11 = at(r0, g1, b1, c) * (1 - tr) + at(r1, g1, b1, c) * tr;
    out[c] = (c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb;
  }
  return out;
}

// ---------- configuração do clipe ----------

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Ordem: filtro pronto → LUT importada → câmera (ciência de cor) → look de cinema → ajustes do usuário.
export function colorFunction(color, lutData) {
  // Filtro pronto ou "meu filtro" (salvo pelo usuário: os ajustes vêm junto, em filter.s).
  const filter = color?.filter && (color.filter.s ? color.filter : FILTERS.find((f) => f.id === color.filter.id));
  const fFn = filter && makeAdjust(filter.s);
  const fAmt = color?.filter?.intensity ?? 1;
  const lutAmt = color?.lut?.intensity ?? 1;
  const camFn = hasCamera(color?.camera) ? makeCamera(color.camera) : null;
  const lookFn = hasLook(color?.look) ? makeLook(color.look) : null;
  const aFn = makeAdjust(color || {});
  return (r, g, b) => {
    let c = [r, g, b];
    if (fFn) c = mix(c, fFn(c[0], c[1], c[2]), fAmt);
    if (lutData) c = mix(c, sampleCube(lutData, c[0], c[1], c[2]), lutAmt);
    if (camFn) c = camFn(c[0], c[1], c[2]);
    if (lookFn) c = lookFn(c[0], c[1], c[2]);
    return aFn(c[0], c[1], c[2]);
  };
}

// Algo muda a cor? (sem nada, o clipe não passa pela LUT).
export function hasColor(color) {
  if (!color) return false;
  if (color.filter || color.lut || hasLook(color.look) || hasCamera(color.camera)) return true;
  if (ADJUSTMENTS.some(([k]) => color[k])) return true;
  if (HSL_BANDS.some(([id]) => color.hsl?.[id] && (color.hsl[id].h || color.hsl[id].s || color.hsl[id].l))) return true;
  if (['master', 'r', 'g', 'b'].some((ch) => !isIdentityCurve(color.curves?.[ch]))) return true;
  if (['shadows', 'midtones', 'highlights', 'global'].some((k) => color.wheels?.[k]?.amount || color.wheels?.[k]?.lum)) return true;
  return false;
}
// Óptica da câmera que não passa pela LUT (vinheta, maciez, aberração, halação, flare, grão).
export const hasOptics = (color) => {
  const o = opticsOf(color?.camera);
  return !!o && !!(o.soft || o.vig || o.ca > 0.004 || o.hal || o.str || o.grain);
};
export const hasSpatial = (color) => !!(color?.vignette || color?.sharpen || lookVignette(color?.look) || hasOptics(color));

// LUT 3D com o vermelho variando mais rápido (ordem do formato .cube).
export function buildLut(color, lutData, n = LUT_SIZE) {
  const fn = colorFunction(color, lutData);
  const out = new Float32Array(n * n * n * 3);
  let o = 0;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const c = fn(r / (n - 1), g / (n - 1), b / (n - 1));
        out[o++] = c[0];
        out[o++] = c[1];
        out[o++] = c[2];
      }
  return out;
}

export function toCube(data, n = LUT_SIZE) {
  const lines = [`TITLE "Video Editor"`, `LUT_3D_SIZE ${n}`];
  for (let i = 0; i < data.length; i += 3) lines.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}

// Vinheta igual à do FFmpeg (filtro vignette): fator cos(ângulo × distância)^4.
export const vignetteAngle = (v) => v * (Math.PI / 2.2);

// ---------- filtros prontos ----------

export const FILTER_CATS = [
  ['all', 'Todos'],
  ['life', 'Dia a dia'],
  ['portrait', 'Retrato'],
  ['landscape', 'Paisagem'],
  ['food', 'Comida'],
  ['cinema', 'Cinema'],
  ['vintage', 'Vintage'],
  ['bw', 'P&B'],
  ['style', 'Estilo'],
];

const W = (hue, amount, lum = 0) => ({ hue, amount, lum });
const F = (cat, id, label, s) => ({ cat, id, label, s });

export const FILTERS = [
  // dia a dia
  F('life', 'vivid', 'Vívido', { saturation: 0.35, contrast: 0.12, vibrance: 0.2 }),
  F('life', 'natural', 'Natural', { saturation: 0.12, contrast: 0.06, highlights: -0.15, shadows: 0.12 }),
  F('life', 'warm', 'Quente', { temperature: 0.45, saturation: 0.08 }),
  F('life', 'cool', 'Frio', { temperature: -0.45, tint: -0.05 }),
  F('life', 'bright', 'Claro', { exposure: 0.35, shadows: 0.2, highlights: -0.1, vibrance: 0.15 }),
  F('life', 'crisp', 'Nítido', { contrast: 0.25, whites: 0.3, blacks: -0.3, vibrance: 0.2 }),
  F('life', 'soft', 'Suave', { contrast: -0.2, highlights: -0.2, shadows: 0.2, fade: 0.15 }),
  F('life', 'pastel', 'Pastel', { saturation: -0.35, brightness: 0.25, contrast: -0.25, fade: 0.2 }),
  // retrato
  F('portrait', 'skin', 'Pele viva', { temperature: 0.12, vibrance: 0.15, highlights: -0.1, hsl: { orange: { s: 0.1, l: 0.15 }, red: { s: -0.1 } } }),
  F('portrait', 'rose', 'Rosado', { tint: 0.35, temperature: 0.15, brightness: 0.08 }),
  F('portrait', 'porcelain', 'Porcelana', { exposure: 0.2, saturation: -0.2, fade: 0.1, hsl: { orange: { s: -0.3, l: 0.25 } } }),
  F('portrait', 'golden', 'Hora dourada', { temperature: 0.5, tint: 0.08, highlights: 0.1, wheels: { highlights: W(40, 0.6) } }),
  F('portrait', 'studio', 'Estúdio', { contrast: 0.15, whites: 0.2, saturation: -0.05, hsl: { orange: { l: 0.1 } } }),
  F('portrait', 'peach', 'Pêssego', { temperature: 0.25, tint: 0.2, fade: 0.2, saturation: -0.1 }),
  // paisagem
  F('landscape', 'sky', 'Céu azul', { highlights: -0.2, vibrance: 0.2, hsl: { blue: { s: 0.4, l: -0.15 }, cyan: { s: 0.3 } } }),
  F('landscape', 'green', 'Verde vivo', { contrast: 0.1, hsl: { green: { s: 0.45, l: 0.05 }, yellow: { h: 0.2, s: 0.2 } } }),
  F('landscape', 'autumn', 'Outono', { temperature: 0.3, hsl: { green: { h: -0.6, s: -0.1 }, yellow: { h: -0.3, s: 0.3 }, orange: { s: 0.3 } } }),
  F('landscape', 'sunset', 'Pôr do sol', { temperature: 0.6, tint: 0.15, saturation: 0.2, highlights: 0.1 }),
  F('landscape', 'ocean', 'Oceano', { temperature: -0.3, contrast: 0.1, hsl: { cyan: { s: 0.4 }, blue: { s: 0.3, h: -0.2 } } }),
  F('landscape', 'hdr', 'HDR', { highlights: -0.6, shadows: 0.6, contrast: 0.2, vibrance: 0.3, whites: 0.2, blacks: -0.2 }),
  F('landscape', 'mist', 'Névoa', { fade: 0.45, contrast: -0.25, saturation: -0.3, temperature: -0.15, exposure: 0.15 }),
  // comida
  F('food', 'tasty', 'Apetitoso', { temperature: 0.25, vibrance: 0.35, contrast: 0.1, hsl: { red: { s: 0.2 }, orange: { s: 0.2 } } }),
  F('food', 'fresh', 'Fresco', { exposure: 0.15, vibrance: 0.25, hsl: { green: { s: 0.3, l: 0.1 } } }),
  F('food', 'cafe', 'Café', { temperature: 0.35, fade: 0.25, contrast: -0.05, saturation: -0.1, wheels: { shadows: W(30, 0.4) } }),
  F('food', 'dessert', 'Doce', { exposure: 0.25, tint: 0.15, saturation: 0.1, highlights: -0.15 }),
  // cinema
  F('cinema', 'cinema', 'Cinema', { contrast: 0.2, saturation: -0.1, wheels: { shadows: W(185, 0.9), highlights: W(30, 0.8) } }),
  F('cinema', 'tealorange', 'Azul e laranja', { contrast: 0.15, vibrance: 0.15, wheels: { shadows: W(195, 1), highlights: W(32, 0.9) }, hsl: { blue: { h: -0.2 } } }),
  F('cinema', 'film', 'Filme', { fade: 0.35, contrast: 0.1, wheels: { shadows: W(190, 0.6), highlights: W(35, 0.5) } }),
  F('cinema', 'drama', 'Dramático', { contrast: 0.45, saturation: -0.15, shadows: -0.25, highlights: -0.2 }),
  F('cinema', 'thriller', 'Suspense', { temperature: -0.3, tint: -0.2, saturation: -0.35, contrast: 0.3, wheels: { shadows: W(160, 0.6) } }),
  F('cinema', 'blockbuster', 'Ação', { contrast: 0.35, whites: 0.2, blacks: -0.3, saturation: 0.05, wheels: { shadows: W(200, 0.7), highlights: W(25, 0.6) } }),
  F('cinema', 'night', 'Noite', { exposure: -0.5, temperature: -0.6, saturation: -0.3, contrast: 0.15 }),
  F('cinema', 'western', 'Faroeste', { temperature: 0.55, saturation: -0.2, contrast: 0.25, fade: 0.15, wheels: { highlights: W(40, 0.5) } }),
  // vintage
  F('vintage', 'vintage', 'Vintage', { fade: 0.55, saturation: -0.25, temperature: 0.3, contrast: -0.1 }),
  F('vintage', 'retro', 'Retrô', { saturation: 0.15, temperature: 0.25, tint: -0.2, fade: 0.35, hsl: { blue: { h: -0.4 }, green: { h: 0.4, s: -0.3 } } }),
  F('vintage', 'polaroid', 'Polaroid', { fade: 0.4, temperature: 0.2, tint: 0.1, contrast: -0.1, wheels: { shadows: W(170, 0.4), highlights: W(50, 0.4) } }),
  F('vintage', 'eighties', 'Anos 80', { saturation: 0.2, contrast: 0.15, temperature: 0.3, fade: 0.15, hsl: { red: { s: 0.2 }, yellow: { s: 0.25 } } }),
  F('vintage', 'sepia', 'Sépia', { saturation: -0.75, temperature: 0.7, fade: 0.2 }),
  F('vintage', 'matte', 'Fosco', { fade: 0.7, contrast: -0.15 }),
  F('vintage', 'moss', 'Musgo', { tint: -0.3, saturation: -0.2, fade: 0.25, shadows: 0.1 }),
  F('vintage', 'faded', 'Desbotado', { fade: 0.5, saturation: -0.45, highlights: -0.2 }),
  // preto e branco
  F('bw', 'bw', 'P&B', { saturation: -1 }),
  F('bw', 'noir', 'Noir', { saturation: -1, contrast: 0.5, shadows: -0.3 }),
  F('bw', 'silver', 'Prata', { saturation: -1, fade: 0.3, highlights: -0.2, shadows: 0.2 }),
  F('bw', 'highkey', 'Claro P&B', { saturation: -1, exposure: 0.4, contrast: -0.1, whites: 0.3 }),
  F('bw', 'selenium', 'Selênio', { saturation: -1, contrast: 0.2, wheels: { shadows: W(260, 0.5), highlights: W(40, 0.3) } }),
  // estilo
  F('style', 'cyber', 'Cyberpunk', { tint: 0.4, temperature: -0.35, contrast: 0.25, saturation: 0.2, wheels: { shadows: W(270, 0.9), highlights: W(190, 0.7) } }),
  F('style', 'neon', 'Neon', { saturation: 0.6, contrast: 0.3, blacks: -0.4, hsl: { magenta: { s: 0.4 }, cyan: { s: 0.4 } } }),
  F('style', 'dream', 'Sonho', { exposure: 0.25, fade: 0.3, tint: 0.2, saturation: -0.1, wheels: { highlights: W(300, 0.4) } }),
  F('style', 'arctic', 'Ártico', { temperature: -0.7, saturation: -0.3, exposure: 0.2, whites: 0.2 }),
  F('style', 'desert', 'Deserto', { temperature: 0.6, saturation: -0.15, contrast: 0.2, hsl: { blue: { s: -0.4 } } }),
  F('style', 'onlyred', 'Só vermelho', { hsl: { orange: { s: -1 }, yellow: { s: -1 }, green: { s: -1 }, cyan: { s: -1 }, blue: { s: -1 }, purple: { s: -1 }, magenta: { s: -0.6 } } }),
  F('style', 'matrix', 'Matrix', { tint: -0.6, saturation: -0.3, contrast: 0.3, wheels: { global: W(130, 0.4) } }),
];
