// Velocidade dos clipes: constante (clip.speed) ou curva (clip.curve = [[x, v], ...]).
// x = posição no clipe (0 a 1, no tempo da linha do tempo); v = velocidade naquele ponto.
// Entre os pontos a velocidade muda de forma suave (interpolação em escala logarítmica).

export const SPEED_MIN = 0.1;
export const SPEED_MAX = 100;
export const CURVE_MIN = 0.1;
export const CURVE_MAX = 10;

export const CURVE_PRESETS = [
  ['montage', 'Montagem', [[0, 1], [0.3, 0.4], [0.5, 3], [0.7, 0.4], [1, 1]]],
  ['hero', 'Herói', [[0, 1.6], [0.35, 1.6], [0.5, 0.2], [0.65, 1.6], [1, 1.6]]],
  ['bullet', 'Bala', [[0, 2.5], [0.3, 0.25], [0.7, 0.25], [1, 2.5]]],
  ['jump', 'Salto', [[0, 1], [0.42, 1], [0.5, 6], [0.58, 1], [1, 1]]],
  ['flashIn', 'Entrada rápida', [[0, 6], [0.4, 1], [1, 1]]],
  ['flashOut', 'Saída rápida', [[0, 1], [0.6, 1], [1, 6]]],
];
export const CUSTOM_CURVE = [[0, 1], [0.33, 1], [0.66, 1], [1, 1]];

const N = 256;
const tables = new Map();

// Velocidade num ponto u (0 a 1) da curva.
export function curveValue(points, u) {
  if (u <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, v1] = points[i];
    if (u <= x1) {
      const [x0, v0] = points[i - 1];
      const f = x1 > x0 ? (u - x0) / (x1 - x0) : 0;
      return Math.pow(2, Math.log2(v0) + (Math.log2(v1) - Math.log2(v0)) * f);
    }
  }
  return points[points.length - 1][1];
}

// Tabela acumulada: quanto do vídeo original já passou em cada ponto (integral da velocidade).
function table(points) {
  const key = JSON.stringify(points);
  let t = tables.get(key);
  if (!t) {
    t = new Float64Array(N + 1);
    let prev = curveValue(points, 0);
    for (let i = 1; i <= N; i++) {
      const v = curveValue(points, i / N);
      t[i] = t[i - 1] + ((prev + v) / 2) / N;
      prev = v;
    }
    if (tables.size > 200) tables.clear();
    tables.set(key, t);
  }
  return t;
}

const integral = (points, u) => {
  const t = table(points);
  const p = Math.min(N, Math.max(0, u * N));
  const i = Math.floor(p);
  return i >= N ? t[N] : t[i] + (t[i + 1] - t[i]) * (p - i);
};

export const averageSpeed = (points) => integral(points, 1);

// Velocidade média do clipe (define a duração na linha do tempo).
export const effSpeed = (c) => (c.curve ? averageSpeed(c.curve) : c.speed || 1);

const durOf = (c) => (c.out - c.in) / effSpeed(c);

// Ponto do vídeo original que aparece "local" segundos depois do início do clipe.
export function sourceAt(c, local) {
  if (!c.curve) return c.in + local * (c.speed || 1);
  const D = durOf(c);
  return c.in + D * integral(c.curve, Math.min(1, Math.max(0, local / D)));
}

// Velocidade instantânea naquele ponto (usada na prévia).
export function speedAt(c, local) {
  if (!c.curve) return c.speed || 1;
  return curveValue(c.curve, Math.min(1, Math.max(0, local / durOf(c))));
}

// Curva dividida em trechos de velocidade constante (usado na exportação).
export function curveSegments(c, n = 24) {
  const D = durOf(c);
  const segs = [];
  for (let k = 0; k < n; k++) {
    const t0 = (k / n) * D;
    const t1 = ((k + 1) / n) * D;
    const s0 = sourceAt(c, t0) - c.in;
    const s1 = sourceAt(c, t1) - c.in;
    segs.push({ s0, s1, v: (s1 - s0) / (t1 - t0) });
  }
  return segs;
}

// Pedaço [u0, u1] de uma curva, reescalado para 0..1 (usado ao dividir um clipe com curva).
export function subCurve(points, u0, u1) {
  const xs = new Set();
  for (let i = 0; i <= 12; i++) xs.add(u0 + ((u1 - u0) * i) / 12);
  for (const [x] of points) if (x > u0 && x < u1) xs.add(x);
  return [...xs].sort((a, b) => a - b).map((x) => [(x - u0) / (u1 - u0), +curveValue(points, x).toFixed(4)]);
}

// 10 → "10x", 1.5 → "1.5x", 0.25 → "0.25x" (zeros só são tirados depois da vírgula).
export const fmtSpeed = (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + 'x';
