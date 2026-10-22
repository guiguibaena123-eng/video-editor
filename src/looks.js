// Looks de cinema: correções de cor inspiradas na cor de filmes famosos (não são cópias de nenhum
// filme: cada um é uma "receita" de parâmetros editáveis). Tudo vira uma função cor → cor que entra
// na mesma LUT 3D dos outros ajustes, então a prévia (WebGL) e a exportação (FFmpeg) saem iguais.
//
// Por que é melhor que ajustes simples em RGB:
//  - O cálculo é feito em OKLab (espaço perceptual): contraste, saturação, matiz e divisão de tons
//    mexem na cor como o olho enxerga, sem o "escorregar" de matiz e brilho do RGB/HSL.
//  - A curva de contraste é em S com ombro e pé (como a de uma película), sem estourar luz nem sombra.
//  - Cores que saem do que a tela mostra não são cortadas canal a canal (isso mudaria o matiz):
//    a saturação é reduzida até caber, mantendo brilho e matiz (gamut mapping).
//  - A intensidade mistura o resultado com o original dentro do OKLab, e vai até 150%.

// ---------- OKLab ----------

const D2R = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
// Curva do sRGB por tabela (as potências eram o maior custo de montar a LUT). Erro < 0,0001.
const exactToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const exactToEnc = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const TN = 2048;
const LIN_T = new Float32Array(TN + 2);
const ENC_T = new Float32Array(TN + 2); // indexada pela raiz do valor linear (mais pontos nas sombras)
for (let i = 0; i <= TN + 1; i++) {
  LIN_T[i] = exactToLin(i / TN);
  ENC_T[i] = exactToEnc((i / TN) * (i / TN));
}
const toLin = (c) => {
  const x = (c < 0 ? 0 : c > 1 ? 1 : c) * TN;
  const i = x | 0;
  return LIN_T[i] + (LIN_T[i + 1] - LIN_T[i]) * (x - i);
};
const toEnc = (c) => {
  const x = Math.sqrt(c < 0 ? 0 : c > 1 ? 1 : c) * TN;
  const i = x | 0;
  return ENC_T[i] + (ENC_T[i + 1] - ENC_T[i]) * (x - i);
};

// sRGB (0..1, com gama) → OKLab
function srgbToOk(r, g, b) {
  r = toLin(r);
  g = toLin(g);
  b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
// OKLab → RGB linear (pode sair de 0..1)
function okToLin(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const EPS = 1e-4;
const inGamut = (v) => v[0] >= -EPS && v[0] <= 1 + EPS && v[1] >= -EPS && v[1] <= 1 + EPS && v[2] >= -EPS && v[2] <= 1 + EPS;

// Croma máxima que cabe na tela para cada (brilho, matiz): tabela 49 × 121 feita uma vez (~25 ms).
// Assim o ajuste de uma cor fora do alcance é uma consulta, não uma busca por tentativa.
const GL = 48;
const GH = 120;
let gamutTable = null;
function buildGamutTable() {
  const t = new Float32Array((GL + 1) * (GH + 1));
  for (let i = 0; i <= GL; i++) {
    const L = i / GL;
    for (let j = 0; j <= GH; j++) {
      const ca = Math.cos((j / GH) * 2 * Math.PI);
      const cb = Math.sin((j / GH) * 2 * Math.PI);
      let lo = 0;
      let hi = 0.45;
      for (let k = 0; k < 11; k++) {
        const mid = (lo + hi) / 2;
        if (inGamut(okToLin(L, ca * mid, cb * mid))) lo = mid;
        else hi = mid;
      }
      t[i * (GH + 1) + j] = lo;
    }
  }
  return t;
}
function maxChroma(L, h) {
  if (!gamutTable) gamutTable = buildGamutTable();
  const fl = L * GL;
  const fh = (((h % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * (GH / (2 * Math.PI));
  const i = Math.min(GL - 1, Math.floor(fl));
  const j = Math.min(GH - 1, Math.floor(fh));
  const tl = fl - i;
  const th = fh - j;
  const r = GH + 1;
  const a = gamutTable[i * r + j] * (1 - th) + gamutTable[i * r + j + 1] * th;
  const b = gamutTable[(i + 1) * r + j] * (1 - th) + gamutTable[(i + 1) * r + j + 1] * th;
  return a * (1 - tl) + b * tl;
}

// OKLab → sRGB com gama. Fora do alcance da tela: reduz a saturação (mesmo brilho e matiz) até caber.
function okToSrgb(L, a, b) {
  if (L <= 0) return [0, 0, 0];
  if (L >= 1) return [1, 1, 1];
  let rgb = okToLin(L, a, b);
  if (!inGamut(rgb)) {
    const C = Math.sqrt(a * a + b * b);
    const k = (maxChroma(L, Math.atan2(b, a)) * 0.998) / C;
    if (k < 1) rgb = okToLin(L, a * k, b * k);
  }
  return [toEnc(clamp01(rgb[0])), toEnc(clamp01(rgb[1])), toEnc(clamp01(rgb[2]))];
}

// Cor sRGB (0..1, com gama) de um ponto do OKLCh.
export function oklchRgb(L, C, h) {
  return okToSrgb(L, C * Math.cos(h * D2R), C * Math.sin(h * D2R));
}

// Cor CSS de um matiz do OKLCh (para as barras de matiz da interface).
export function oklchCss(L, C, h) {
  const [r, g, b] = okToSrgb(L, C * Math.cos(h * D2R), C * Math.sin(h * D2R));
  return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
}

// ---------- parâmetros ----------

// [chave, nome, grupo, mín, máx, passo(%)]. Todos começam em 0 (= não faz nada).
export const LOOK_PARAMS = [
  ['ev', 'Exposição', 'light', -1, 1],
  ['con', 'Contraste', 'light', -1, 1],
  ['blk', 'Pretos (levantar / esmagar)', 'light', -1, 1],
  ['wht', 'Brancos', 'light', -1, 1],
  ['roll', 'Suavizar realces (ombro de película)', 'light', 0, 1],
  ['toe', 'Suavizar sombras (pé da curva)', 'light', 0, 1],
  ['fade', 'Desbotar (fosco)', 'light', 0, 1],
  ['sat', 'Saturação', 'color', -1, 1],
  ['vib', 'Vibração', 'color', -1, 1],
  ['temp', 'Temperatura', 'color', -1, 1],
  ['tint', 'Tom (verde ↔ rosa)', 'color', -1, 1],
  ['hue', 'Girar o matiz', 'color', -1, 1],
  ['sep', 'Separar cores (laranja × azul-petróleo)', 'color', 0, 1],
  ['skin', 'Proteger o tom de pele', 'color', 0, 1],
  ['sSat', 'Cor nas sombras', 'tone', -1, 1],
  ['hSat', 'Cor nos realces', 'tone', -1, 1],
  ['bal', 'Equilíbrio sombras ↔ realces', 'tone', -1, 1],
  ['bleach', 'Bleach bypass (prata)', 'film', 0, 1],
  ['mono', 'Preto e branco', 'film', 0, 1],
  ['keep', 'Manter uma cor no P&B', 'film', 0, 1],
  ['vig', 'Vinheta', 'film', 0, 1],
];
// Divisão de tons: matiz (0–360°) + força de cada faixa.
export const LOOK_TINTS = [
  ['sh', 'Sombras'],
  ['md', 'Meios-tons'],
  ['hi', 'Realces'],
];
export const NEUTRAL = {
  ev: 0, con: 0, blk: 0, wht: 0, roll: 0, toe: 0, fade: 0, sat: 0, vib: 0, temp: 0, tint: 0, hue: 0, sep: 0, skin: 0, sSat: 0, hSat: 0, bal: 0, bleach: 0, mono: 0, keep: 0, vig: 0,
  shH: 0, shA: 0, mdH: 0, mdA: 0, hiH: 0, hiA: 0, keepH: 29,
  monoW: [0.2126, 0.7152, 0.0722],
  hsel: [],
};

// ---------- a função de cor ----------

const SKIN_H = 52;
const POLE_W = 55; // laranja
const POLE_C = 215; // azul-petróleo
const hueDist = (a, b) => {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const angDiff = (to, from) => {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};
// Ombro e pé da curva de tons (como a resposta de um sensor/película): a luz alta chega ao branco
// devagar (a inclinação cai para 1 − roll×0,9 no topo) e o preto sai devagar (inclinação 1 − toe×0,65
// em zero). Curvas de Hermite que se emendam com a reta sem dobra.
const SHOULDER = 0.62;
const TOE_K = 0.32;
function shoulder(L, roll) {
  if (L <= SHOULDER) return L;
  const m = 1 - roll * 0.9;
  const x = Math.min(1, (L - SHOULDER) / (1 - SHOULDER));
  return SHOULDER + (1 - SHOULDER) * (x + (1 - m) * x * x * (1 - x));
}
function toe(L, amt) {
  if (L >= TOE_K) return L;
  const mt = 1 - amt * 0.65;
  const x = L / TOE_K;
  return TOE_K * (mt * x + (2 - 2 * mt) * x * x + (mt - 1) * x * x * x);
}
const PIV = 0.58; // brilho (OKLab) do cinza médio
function curve(L, g) {
  if (L <= 0) return 0;
  if (L >= 1) return 1;
  if (L < PIV) return PIV * Math.pow(L / PIV, g);
  const u = (L - PIV) / (1 - PIV);
  return PIV + (1 - PIV) * (1 - Math.pow(1 - u, g));
}

// Parâmetros completos de um look (padrão neutro + receita + ajustes do usuário).
export function lookParams(look) {
  const base = look?.id ? LOOKS.find((l) => l.id === look.id) : null;
  return { ...NEUTRAL, ...(base?.p || {}), ...(look?.p || {}) };
}

// (r,g,b) 0..1 com gama → [r,g,b]. "intensity" mistura com o original (0..1.5).
export function makeLook(look) {
  const P = lookParams(look);
  const intensity = look?.intensity ?? 1;
  const ev = Math.pow(2, P.ev);
  const g = P.con >= 0 ? 1 + 1.2 * P.con : 1 / (1 + 1.2 * -P.con);
  const sel = (P.hsel || []).map((s) => ({ ...s, w: s.w || 40 }));
  const tints = [
    ['sh', P.shA, P.shH],
    ['md', P.mdA, P.mdH],
    ['hi', P.hiA, P.hiH],
  ]
    .filter(([, a]) => a)
    .map(([k, a, h]) => [k, a * 0.1 * Math.cos(h * D2R), a * 0.1 * Math.sin(h * D2R)]);
  const mw = P.monoW;
  const mwSum = mw[0] + mw[1] + mw[2] || 1;
  const sepAmt = P.sep;
  const hueRot = P.hue * 90;
  const tOff = [P.temp * 0.04 * Math.cos(70 * D2R), P.temp * 0.04 * Math.sin(70 * D2R)];
  const tiOff = [P.tint * 0.03 * Math.cos(330 * D2R), P.tint * 0.03 * Math.sin(330 * D2R)];
  const bal = P.bal * 0.2;

  return (inR, inG, inB) => {
    let R = inR;
    let G = inG;
    let B = inB;
    // 1) exposição na luz linear
    if (P.ev) {
      R = toEnc(clamp01(toLin(R) * ev));
      G = toEnc(clamp01(toLin(G) * ev));
      B = toEnc(clamp01(toLin(B) * ev));
    }
    // 2) bleach bypass: dessatura e soma o contraste da luminância (overlay), como o processo químico
    if (P.bleach) {
      const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
      const k = P.bleach;
      const ds = (v) => v + (Y - v) * 0.65 * k;
      const ov = (v) => (Y < 0.5 ? 2 * Y * v : 1 - 2 * (1 - Y) * (1 - v));
      const dr = ds(R);
      const dg = ds(G);
      const db = ds(B);
      R = dr + (ov(dr) - dr) * k;
      G = dg + (ov(dg) - dg) * k;
      B = db + (ov(db) - db) * k;
    }
    let [L, a, b] = srgbToOk(clamp01(R), clamp01(G), clamp01(B));
    const L0 = L;
    const a0 = a;
    const b0 = b;
    const C0 = Math.sqrt(a0 * a0 + b0 * b0);
    const h0 = ((Math.atan2(b0, a0) / D2R) + 360) % 360;
    // 3) preto e branco (com uma cor opcional mantida)
    if (P.mono) {
      const Y = (mw[0] * toLin(clamp01(R)) + mw[1] * toLin(clamp01(G)) + mw[2] * toLin(clamp01(B))) / mwSum;
      const Lm = Math.cbrt(Math.max(0, Y));
      let kept = 0;
      if (P.keep) kept = P.keep * Math.pow(Math.cos((Math.min(hueDist(h0, P.keepH), 24) / 24) * (Math.PI / 2)), 2) * Math.min(1, C0 / 0.05);
      const m = P.mono * (1 - kept);
      L += (Lm - L) * m;
      a *= 1 - m;
      b *= 1 - m;
    }
    // 4) temperatura e tom (deslocam a cor, mas deixam o preto puro em paz)
    if (P.temp || P.tint) {
      const w = smooth(0, 0.45, L);
      a += (tOff[0] + tiOff[0]) * w;
      b += (tOff[1] + tiOff[1]) * w;
    }
    // 5) curva de tons em S + pretos, brancos e fosco
    if (g !== 1) L = curve(L, g);
    if (P.toe) L = toe(L, P.toe);
    if (P.roll) L = shoulder(L, P.roll);
    if (P.blk) L += P.blk * 0.14 * (1 - L) * (1 - L) * (1 - L);
    if (P.wht) L += P.wht * 0.08 * L * L * L;
    if (P.fade) L = L * (1 - 0.18 * P.fade) + 0.15 * P.fade;
    L = L < 0 ? 0 : L;
    const Lt = L; // (para proteger a pele depois)
    // 6) saturação (em croma OKLCh)
    let C = Math.sqrt(a * a + b * b);
    let h = Math.atan2(b, a) / D2R;
    const wS = 1 - smooth(0.12, 0.62 + bal, L);
    const wH = smooth(0.4 + bal, 0.95, L);
    let cm = 1 + P.sat;
    if (P.vib) cm *= 1 + P.vib * (1 - Math.min(1, C / 0.22));
    if (P.sSat) cm *= 1 + P.sSat * wS;
    if (P.hSat) cm *= 1 + P.hSat * wH;
    if (P.fade) cm *= 1 - 0.35 * P.fade * (1 - L) * (1 - L);
    C *= cm > 0 ? cm : 0;
    // 7) matiz: giro geral, separação complementar e ajustes por cor da receita
    if (hueRot) h += hueRot;
    if (sepAmt) {
      // Puxa cada matiz para o polo mais próximo (laranja ou azul-petróleo). O puxão vai a zero nos
      // polos e no ponto médio entre eles, então não há salto de matiz num degradê.
      const hh = ((h % 360) + 360) % 360;
      const dW = hueDist(hh, POLE_W);
      const dC = hueDist(hh, POLE_C);
      const half = hh >= POLE_W && hh <= POLE_C ? (POLE_C - POLE_W) / 2 : (360 - (POLE_C - POLE_W)) / 2;
      const u = Math.min(1, Math.min(dW, dC) / half);
      h += angDiff(dW < dC ? POLE_W : POLE_C, hh) * (1 - u) * sepAmt * 2 * Math.min(1, C / 0.06);
    }
    if (sel.length) {
      const cw = Math.min(1, C / 0.05);
      let dh = 0;
      let ds = 0;
      let dl = 0;
      for (const s of sel) {
        const dist = hueDist(h, s.h);
        if (dist >= s.w) continue;
        const w = Math.pow(Math.cos((dist / s.w) * (Math.PI / 2)), 2) * cw;
        dh += (s.dh || 0) * 30 * w;
        ds += (s.ds || 0) * w;
        dl += (s.dl || 0) * 0.12 * w;
      }
      h += dh;
      C *= Math.max(0, 1 + ds);
      L = clamp01(L + dl);
    }
    a = C * Math.cos(h * D2R);
    b = C * Math.sin(h * D2R);
    // 8) divisão de tons (sombras / meios / realces)
    if (tints.length) {
      const sw = 1 / (1 + Math.exp((L - (0.38 + bal)) * 10));
      const hw = 1 / (1 + Math.exp(-(L - (0.68 + bal)) * 10));
      const mw2 = Math.max(0, 1 - sw - hw);
      for (const [k, da, db] of tints) {
        const w = k === 'sh' ? sw : k === 'hi' ? hw : mw2;
        a += da * w;
        b += db * w;
      }
    }
    // 9) proteger a pele: volta para a cor original (só com o brilho da curva) onde há tom de pele
    if (P.skin) {
      const sm = P.skin * Math.pow(Math.cos((Math.min(hueDist(h0, SKIN_H), 38) / 38) * (Math.PI / 2)), 2) * smooth(0.02, 0.06, C0);
      if (sm > 0) {
        a += (a0 - a) * sm;
        b += (b0 - b) * sm;
        L += (Lt - L) * sm;
      }
    }
    // 10) intensidade (no OKLab) e volta para a tela
    if (intensity !== 1) {
      L = L0 + (L - L0) * intensity;
      a = a0 + (a - a0) * intensity;
      b = b0 + (b - b0) * intensity;
    }
    return okToSrgb(L, a, b);
  };
}

export const hasLook = (look) => !!look && (look.intensity ?? 1) > 0;
// Vinheta do look (somada à vinheta dos "Efeitos" do clipe).
export const lookVignette = (look) => (hasLook(look) ? Math.max(0, lookParams(look).vig * (Math.min(1.5, look.intensity ?? 1))) : 0);

// ---------- receitas ----------

export const LOOK_CATS = [
  ['all', 'Todos'],
  ['epic', 'Épicos e aventura'],
  ['dark', 'Sombrios e tensos'],
  ['scifi', 'Ficção científica'],
  ['night', 'Neon e noite'],
  ['author', 'Cinema autoral'],
  ['bw', 'Preto e branco'],
  ['film', 'Películas e processos'],
];

// p: só o que difere do neutro. Matizes em graus do OKLCh (vermelho 29°, laranja 55°, amarelo 110°,
// verde 142°, ciano 195°, azul 264°, magenta 328°).
const L = (cat, id, label, film, desc, p) => ({ cat, id, label, film, desc, p });

export const LOOKS = [
  // ── Épicos e aventura
  L('epic', 'furyroad', 'Estrada da Fúria', 'Mad Max: Estrada da Fúria (2015)', 'Laranja do deserto contra azul-petróleo do céu, contraste alto e pretos fechados.', {
    con: 0.35, blk: -0.3, sat: 0.12, sep: 0.8, shH: 205, shA: 0.5, hiH: 58, hiA: 0.45, skin: 0.3,
    hsel: [{ h: 55, w: 35, ds: 0.3 }, { h: 255, w: 50, dh: -0.5, ds: 0.2 }], vig: 0.2,
  }),
  L('epic', 'blockbuster', 'Blockbuster azul-e-laranja', 'Superproduções de ação', 'A receita clássica: sombras azul-petróleo, realces alaranjados e pele preservada.', {
    con: 0.22, sat: 0.08, sep: 0.55, shH: 210, shA: 0.4, hiH: 55, hiA: 0.32, skin: 0.4, blk: -0.1,
  }),
  L('epic', 'pirates', 'Mar do Caribe', 'Piratas do Caribe (2003)', 'Dourado quente nos realces, azul-petróleo nas sombras e cores bem ricas.', {
    con: 0.25, sat: 0.2, vib: 0.15, sep: 0.4, shH: 195, shA: 0.4, hiH: 52, hiA: 0.45, mdH: 70, mdA: 0.1, vig: 0.2,
  }),
  L('epic', 'gladiator', 'Areia e Sangue', 'Gladiador (2000)', 'Dourado queimado e dessaturado, aspecto áspero de película com leve bleach bypass.', {
    bleach: 0.3, sat: -0.3, temp: 0.4, con: 0.35, blk: -0.2, mdH: 62, mdA: 0.35, hiH: 70, hiA: 0.3, shH: 40, shA: 0.2, vig: 0.3,
  }),
  L('epic', 'spartan', 'Guerreiros de Ouro', '300 (2006)', 'Quase monocromático dourado, contraste forte, pretos esmagados e brancos queimados.', {
    sat: -0.45, temp: 0.5, con: 0.5, blk: -0.35, wht: 0.2, hiH: 65, hiA: 0.5, mdH: 55, mdA: 0.3, bleach: 0.3, vig: 0.35,
  }),
  L('epic', 'shire', 'Terra Verde', 'O Senhor dos Anéis: A Sociedade do Anel (2001)', 'Verdes amarelados e vivos, luz dourada e suavidade de fábula.', {
    sat: 0.28, temp: 0.3, vib: 0.2, con: 0.06, fade: 0.05, hiH: 72, hiA: 0.35, shH: 150, shA: 0.2,
    hsel: [{ h: 142, w: 45, dh: -0.3, ds: 0.3 }, { h: 110, w: 35, ds: 0.25 }],
  }),
  L('epic', 'titanic', 'Pôr do Sol no Atlântico', 'Titanic (1997)', 'Luz dourada de fim de tarde com sombras azul-noite suaves e pele cálida.', {
    temp: 0.35, sat: 0.15, con: 0.12, fade: 0.1, hiH: 55, hiA: 0.45, shH: 238, shA: 0.3, mdH: 40, mdA: 0.2, skin: 0.2,
  }),
  L('epic', 'oppenheimer', 'Brasa Atômica', 'Oppenheimer (2023)', 'Película grande formato: laranja quente nos realces, azul frio nas sombras, grão limpo.', {
    temp: 0.22, con: 0.26, sat: 0.05, shH: 222, shA: 0.22, hiH: 42, hiA: 0.4, bleach: 0.1, blk: -0.1,
  }),
  L('epic', 'potter', 'Escola de Magia', 'Harry Potter e a Pedra Filosofal (2001)', 'Dourado acolhedor de velas, sombras âmbar e vinheta suave.', {
    temp: 0.35, sat: 0.15, con: 0.15, hiH: 52, hiA: 0.35, shH: 30, shA: 0.25, fade: 0.05, vig: 0.28,
  }),
  // ── Sombrios e tensos
  L('dark', 'matrix', 'Código Verde', 'Matrix (1999)', 'Verde digital em tudo: pretos esmagados, pele fria e cores quentes apagadas.', {
    tint: -0.5, temp: -0.25, sat: -0.2, con: 0.32, blk: -0.3, shH: 150, shA: 0.7, mdH: 145, mdA: 0.4, hiH: 160, hiA: 0.2,
    hsel: [{ h: 29, w: 40, ds: -0.4 }, { h: 55, w: 35, ds: -0.3 }], vig: 0.15,
  }),
  L('dark', 'se7en', 'Chuva Suja', 'Se7en: Os Sete Crimes Capitais (1995)', 'Bleach bypass pesado, verde-amarelado doentio e pretos opacos.', {
    bleach: 0.6, sat: -0.45, con: 0.45, blk: -0.4, shH: 80, shA: 0.25, mdH: 75, mdA: 0.3, hiH: 92, hiA: 0.25, temp: 0.1, vig: 0.28,
  }),
  L('dark', 'joker', 'Escada do Palhaço', 'Coringa (2019)', 'Verde-oliva sujo, amarelo doente e vermelho que salta aos olhos.', {
    tint: -0.2, temp: 0.3, sat: -0.15, con: 0.28, blk: -0.2, shH: 120, shA: 0.35, mdH: 90, mdA: 0.4, hiH: 65, hiA: 0.3,
    hsel: [{ h: 255, w: 60, ds: -0.7 }, { h: 29, w: 30, ds: 0.3 }], vig: 0.3,
  }),
  L('dark', 'fightclub', 'Porão do Clube', 'Clube da Luta (1999)', 'Verde e amarelo sujos, contraste áspero e aspecto de fita velha.', {
    tint: -0.5, temp: 0.1, sat: -0.2, con: 0.3, blk: -0.25, bleach: 0.15, shH: 165, shA: 0.55, mdH: 125, mdA: 0.3, hiH: 100, hiA: 0.3, vig: 0.3,
  }),
  L('dark', 'batman', 'Gotham em Brasa', 'The Batman (2022)', 'Escuro, sombras petróleo e brilho vermelho-alaranjado nas luzes.', {
    ev: -0.3, con: 0.35, blk: -0.3, sat: -0.08, shH: 215, shA: 0.35, mdH: 30, mdA: 0.22, hiH: 25, hiA: 0.4,
    hsel: [{ h: 29, w: 30, ds: 0.35, dl: -0.15 }], vig: 0.4,
  }),
  L('dark', 'ryan', 'Desembarque', 'O Resgate do Soldado Ryan (1998)', 'Dessaturado e granuloso como cinejornal: bleach bypass e contraste duro.', {
    bleach: 0.7, sat: -0.4, con: 0.3, tint: -0.08, temp: -0.08, hiH: 92, hiA: 0.12, vig: 0.15,
  }),
  L('dark', 'revenant', 'Frio Selvagem', 'O Regresso (2015)', 'Luz natural fria: azul-gelo, verdes apagados e pele protegida.', {
    temp: -0.45, sat: -0.3, con: 0.2, shH: 225, shA: 0.3, mdH: 210, mdA: 0.2, hiH: 215, hiA: 0.35, skin: 0.5, ev: 0.05, vig: 0.15,
  }),
  // ── Ficção científica
  L('scifi', 'br2049', 'Neblina Alaranjada', 'Blade Runner 2049 (2017)', 'Cidade morta em névoa laranja: tudo âmbar, azuis sumindo e luz difusa.', {
    temp: 0.65, sat: -0.2, fade: 0.2, con: 0.12, shH: 35, shA: 0.5, mdH: 45, mdA: 0.65, hiH: 62, hiA: 0.5,
    hsel: [{ h: 250, w: 70, ds: -0.7 }, { h: 195, w: 50, ds: -0.5 }],
  }),
  L('scifi', 'dune', 'Arrakis', 'Duna (2021)', 'Areia dessaturada e quente, céu pálido, contraste suave e muita atmosfera.', {
    sat: -0.35, temp: 0.5, fade: 0.15, con: 0.15, ev: 0.1, shH: 50, shA: 0.3, hiH: 72, hiA: 0.25, hsel: [{ h: 255, w: 70, ds: -0.7 }],
  }),
  L('scifi', 'interstellar', 'Fronteira Final', 'Interestelar (2014)', 'Neutro e cinematográfico: sombras azuladas discretas e luz quente moderada.', {
    temp: -0.12, sat: -0.1, con: 0.25, fade: 0.08, shH: 215, shA: 0.25, hiH: 55, hiA: 0.12, skin: 0.3,
  }),
  L('scifi', 'inception', 'Sonho Azul-Aço', 'A Origem (2010)', 'Azul-aço frio, cores contidas e contraste firme.', {
    temp: -0.4, sat: -0.3, con: 0.3, blk: -0.15, shH: 222, shA: 0.4, hiH: 200, hiA: 0.2,
  }),
  L('scifi', 'avatar', 'Floresta Bioluminescente', 'Avatar (2009)', 'Ciano e turquesa exuberantes, verdes que viram água-marinha e azuis vibrantes.', {
    sat: 0.38, vib: 0.3, con: 0.2, temp: -0.15, shH: 200, shA: 0.45,
    hsel: [{ h: 195, w: 45, ds: 0.5 }, { h: 264, w: 45, ds: 0.45 }, { h: 142, w: 45, dh: -0.25, ds: 0.3 }],
  }),
  // ── Neon e noite
  L('night', 'drive', 'Noite de Neon', 'Drive (2011)', 'Magenta e azul-noite com luzes de rua quentes, pretos profundos.', {
    sat: 0.25, con: 0.3, blk: -0.2, shH: 235, shA: 0.55, mdH: 292, mdA: 0.2, hiH: 345, hiA: 0.45, hsel: [{ h: 328, w: 40, ds: 0.4 }, { h: 195, w: 45, ds: 0.3 }], vig: 0.3,
  }),
  L('night', 'stranger', 'Anos 80', 'Stranger Things (2016)', 'Sombras ciano, realces vermelho-alaranjados e verdes apagados, aspecto de VHS caro.', {
    sat: -0.05, con: 0.25, fade: 0.1, blk: -0.1, shH: 192, shA: 0.5, hiH: 35, hiA: 0.35, hsel: [{ h: 142, w: 45, ds: -0.3 }, { h: 29, w: 30, ds: 0.2 }], vig: 0.3,
  }),
  L('night', 'moonlight', 'Azul Luar', 'Moonlight (2016)', 'Azul e magenta saturados com pele escura rica e realces turquesa.', {
    sat: 0.25, con: 0.15, shH: 262, shA: 0.55, mdH: 320, mdA: 0.3, hiH: 195, hiA: 0.3, skin: 0.5, hsel: [{ h: 264, w: 45, ds: 0.4 }, { h: 328, w: 40, ds: 0.3 }],
  }),
  L('night', 'cinestill', 'Halo de Tungstênio', 'Película CineStill 800T', 'Cena noturna: azul-ciano nas sombras e brilho avermelhado nos realces.', {
    sat: 0.1, con: 0.15, fade: 0.1, shH: 205, shA: 0.4, hiH: 352, hiA: 0.35, hSat: 0.15,
  }),
  // ── Cinema autoral
  L('author', 'budapest', 'Hotel Rosa', 'O Grande Hotel Budapeste (2014)', 'Pastéis rosados, luz alta, sombras levantadas e cores de doceria.', {
    ev: 0.2, con: -0.15, fade: 0.2, sat: 0.1, temp: 0.15, tint: 0.3, shH: 350, shA: 0.35, mdH: 355, mdA: 0.25, hiH: 20, hiA: 0.25,
    hsel: [{ h: 340, w: 40, ds: 0.35, dl: 0.1 }, { h: 264, w: 50, ds: -0.3 }],
  }),
  L('author', 'amelie', 'Paris Esverdeada', 'O Fabuloso Destino de Amélie Poulain (2001)', 'Verdes amarelados, vermelhos saturados e luz dourada de conto de fadas.', {
    temp: 0.4, tint: -0.25, sat: 0.32, con: 0.2, vib: 0.2, shH: 150, shA: 0.3, hiH: 85, hiA: 0.4,
    hsel: [{ h: 142, w: 45, dh: -0.2, ds: 0.35 }, { h: 29, w: 30, ds: 0.5 }],
  }),
  L('author', 'lalaland', 'Hora Mágica', 'La La Land (2016)', 'Cores primárias vibrantes, sombras roxas e realces dourados.', {
    sat: 0.32, vib: 0.25, con: 0.2, shH: 285, shA: 0.4, hiH: 62, hiA: 0.3, hsel: [{ h: 328, w: 40, ds: 0.3 }, { h: 264, w: 45, ds: 0.3 }, { h: 110, w: 35, ds: 0.3 }],
  }),
  L('author', 'her', 'Amanhã em Vermelho', 'Ela (2013)', 'Vermelho e laranja suaves, contraste baixo e atmosfera íntima.', {
    temp: 0.3, tint: 0.1, ev: 0.15, con: -0.2, fade: 0.25, sat: -0.05, hiH: 20, hiA: 0.35, mdH: 15, mdA: 0.25,
    hsel: [{ h: 29, w: 30, ds: 0.3 }, { h: 255, w: 60, ds: -0.4 }],
  }),
  L('author', 'lost', 'Tóquio de Madrugada', 'Encontros e Desencontros (2003)', 'Neblina fosca de neon: contraste baixo, sombras azuladas e realces rosados.', {
    fade: 0.3, con: -0.15, sat: -0.05, shH: 215, shA: 0.3, hiH: 332, hiA: 0.25, ev: 0.05,
  }),
  L('author', 'barbie', 'Mundo de Plástico', 'Barbie (2023)', 'Rosa doce a todo volume, cores de brinquedo e luz alta.', {
    ev: 0.15, sat: 0.38, vib: 0.3, temp: 0.1, tint: 0.5, con: 0.05, fade: 0.05, hiH: 350, hiA: 0.3, hsel: [{ h: 335, w: 45, ds: 0.5, dl: 0.05 }],
  }),
  // ── Preto e branco
  L('bw', 'schindler', 'Prata Documental', 'A Lista de Schindler (1993)', 'Preto e branco de contraste alto, escala longa de cinzas e brancos limpos.', {
    mono: 1, monoW: [0.3, 0.59, 0.11], con: 0.35, blk: -0.1, vig: 0.2,
  }),
  L('bw', 'sincity', 'Cidade do Pecado', 'Sin City (2005)', 'Preto e branco duro, pretos totais — e o vermelho continua vivo.', {
    mono: 1, monoW: [0.45, 0.45, 0.1], con: 0.65, blk: -0.35, wht: 0.2, keep: 1, keepH: 29, vig: 0.15,
  }),
  L('bw', 'oppenheimer_bw', 'Reação em Cadeia', 'Oppenheimer (2023), cenas em P&B', 'Preto e branco de película grande formato, tons médios ricos e realces suaves.', {
    mono: 1, monoW: [0.22, 0.68, 0.1], con: 0.3, fade: 0.05, wht: -0.1,
  }),
  L('bw', 'redfilter', 'Filtro Vermelho', 'Técnica de fotografia P&B clássica', 'Céus escuros e pele clara, como a lente com filtro vermelho de cinema antigo.', {
    mono: 1, monoW: [0.75, 0.25, 0.0], con: 0.3, blk: -0.1,
  }),
  // ── Películas e processos
  L('film', 'vision3', 'Cinema 35 mm', 'Kodak Vision3 500T', 'Película de cinema: ombro suave nos brancos, pretos levemente levantados, calor discreto.', {
    fade: 0.08, con: 0.15, sat: 0.05, temp: 0.12, shH: 205, shA: 0.12, hiH: 52, hiA: 0.12, wht: -0.1,
  }),
  L('film', 'portra', 'Retrato Pastel', 'Kodak Portra 400', 'Pastéis quentes, pele lisonjeira e verdes suaves.', {
    ev: 0.1, sat: -0.1, temp: 0.15, fade: 0.1, con: -0.05, hiH: 55, hiA: 0.2, shH: 190, shA: 0.1, skin: 0.6, hsel: [{ h: 142, w: 45, ds: -0.15 }],
  }),
  L('film', 'velvia', 'Slide Saturado', 'Fujifilm Velvia 50', 'Cores intensas e contraste alto de slide, sombras levemente azuladas.', {
    sat: 0.5, vib: 0.2, con: 0.35, blk: -0.2, shH: 245, shA: 0.2, hsel: [{ h: 142, w: 45, ds: 0.2 }, { h: 264, w: 45, ds: 0.25 }, { h: 29, w: 30, ds: 0.2 }],
  }),
  L('film', 'kodachrome', 'Anos 70', 'Kodachrome 64', 'Vermelhos profundos, azuis densos e quentura de foto de família antiga.', {
    temp: 0.2, sat: 0.3, con: 0.3, fade: 0.05, hsel: [{ h: 29, w: 30, ds: 0.35 }, { h: 110, w: 35, ds: 0.2 }, { h: 264, w: 45, ds: 0.2 }], vig: 0.15,
  }),
  L('film', 'bleach', 'Bleach Bypass', 'Processo de laboratório', 'Prata retida na película: menos cor, mais contraste e textura.', {
    bleach: 0.8, sat: -0.3, con: 0.3,
  }),
  L('film', 'cross', 'Processo Cruzado', 'Cross-processing (slide em químico de negativo)', 'Sombras verde-azuladas, realces amarelos, cor e contraste exagerados.', {
    con: 0.5, sat: 0.35, shH: 172, shA: 0.85, mdH: 130, mdA: 0.2, hiH: 80, hiA: 0.8,
  }),
];
export const LOOK_BY_ID = Object.fromEntries(LOOKS.map((l) => [l.id, l]));

// Resumo da receita em frases curtas (mostrado na interface).
const hueName = (h) => {
  h = ((h % 360) + 360) % 360;
  const names = [[20, 'rosa'], [40, 'vermelho'], [75, 'laranja'], [100, 'âmbar'], [125, 'amarelo'], [160, 'verde'], [185, 'verde-água'], [225, 'ciano'], [250, 'azul-claro'], [290, 'azul'], [315, 'violeta'], [345, 'magenta'], [361, 'rosa']];
  return names.find(([max]) => h < max)[1];
};
export function describeLook(look) {
  const P = lookParams(look);
  const out = [];
  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
  if (P.shA) out.push(`Sombras ${hueName(P.shH)} ${Math.round(P.shA * 100)}%`);
  if (P.mdA) out.push(`Meios-tons ${hueName(P.mdH)} ${Math.round(P.mdA * 100)}%`);
  if (P.hiA) out.push(`Realces ${hueName(P.hiH)} ${Math.round(P.hiA * 100)}%`);
  if (P.con) out.push(`Contraste ${pct(P.con)}`);
  if (P.blk) out.push(P.blk < 0 ? 'Pretos esmagados' : 'Pretos levantados');
  if (P.sat) out.push(`Saturação ${pct(P.sat)}`);
  if (P.sep) out.push(`Separação ${Math.round(P.sep * 100)}%`);
  if (P.bleach) out.push(`Bleach bypass ${Math.round(P.bleach * 100)}%`);
  if (P.mono) out.push('Preto e branco' + (P.keep ? ` com ${hueName(P.keepH)} mantido` : ''));
  if (P.skin) out.push('Pele protegida');
  if (P.vig) out.push('Vinheta');
  return out;
}
