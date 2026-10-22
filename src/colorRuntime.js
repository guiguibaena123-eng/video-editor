// LUTs prontas para usar (com cache) e arquivos .cube importados.
import { useStore } from './store';
import { hasColor, buildLut, parseCube, colorFunction, LUT_SIZE_EXPORT } from './color';
import { lookVignette } from './looks';
import { opticsOf } from './cameras';

const cache = new Map();
const loading = new Set();

// Conteúdo de um .cube importado (carrega na primeira vez; até lá devolve null).
export function lutFile(path) {
  const entry = useStore.getState().lutFiles[path];
  if (entry) return entry.data || null;
  if (!loading.has(path)) {
    loading.add(path);
    window.api
      .readLut(path)
      .then((text) => ({ data: parseCube(text) }))
      .catch((err) => ({ error: String(err?.message || err) }))
      .then((v) => useStore.setState((s) => ({ lutFiles: { ...s.lutFiles, [path]: v } })))
      .finally(() => loading.delete(path));
  }
  return null;
}

// Parte da cor que entra na LUT (vinheta e nitidez ficam de fora: dependem da posição do pixel).
const lutPart = ({ vignette, sharpen, ...rest }) => rest;

// LUT 3D do clipe: { key, data, size } ou null se a cor não muda nada.
// Prévia progressiva: monta na hora uma LUT 17 (rápida, acompanha o arrastar dos sliders) e refina em
// segundo plano (25 → 33 → 49) em fatias de ~5 ms, sem travar a reprodução nem os sliders.
// Exportação (best = true): LUT 65 montada de uma vez.
const STEPS = [17, 25, 33, 49];
const queue = []; // { base, size, color, imported }
const seen = new Map(); // base -> última vez que o player pediu essa cor
let working = false;
let readyCb = null;
export const onLutReady = (cb) => {
  readyCb = cb;
};

function runQueue() {
  if (working) return;
  const now = performance.now();
  // Descarta pedidos de cores que o player já não usa (ex.: valores antigos de um slider).
  while (queue.length && now - (seen.get(queue[0].base) || 0) > 400) queue.shift();
  const job = queue[0];
  if (!job) return;
  working = true;
  const { base, size, color, imported } = job;
  const fn = colorFunction(color, imported);
  const data = new Float32Array(size * size * size * 3);
  const rows = size * size; // cada linha = um (azul, verde) com todos os vermelhos
  let row = 0;
  const step = () => {
    const t0 = performance.now();
    while (row < rows && performance.now() - t0 < 5) {
      const b = Math.floor(row / size);
      const g = row % size;
      let o = row * size * 3;
      for (let r = 0; r < size; r++) {
        const c = fn(r / (size - 1), g / (size - 1), b / (size - 1));
        data[o++] = c[0];
        data[o++] = c[1];
        data[o++] = c[2];
      }
      row++;
    }
    if (row < rows) return setTimeout(step, 0);
    const key = `${base}#${size}`;
    cache.set(key, { key, data, size });
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    queue.shift();
    working = false;
    readyCb?.();
    setTimeout(runQueue, 0);
  };
  step();
}

export function lutFor(color, best = false) {
  if (!hasColor(color)) return null;
  const imported = color.lut ? lutFile(color.lut.path) : null;
  const base = JSON.stringify(lutPart(color)) + (imported ? '|ok' : '');
  if (best) {
    const key = `${base}#${LUT_SIZE_EXPORT}`;
    let e = cache.get(key);
    if (!e) {
      e = { key, data: buildLut(color, imported, LUT_SIZE_EXPORT), size: LUT_SIZE_EXPORT };
      cache.set(key, e);
    }
    return e;
  }
  seen.set(base, performance.now());
  if (seen.size > 200) seen.delete(seen.keys().next().value);
  let have = -1;
  for (let i = STEPS.length - 1; i >= 0; i--) {
    if (cache.has(`${base}#${STEPS[i]}`)) {
      have = i;
      break;
    }
  }
  if (have < 0) {
    const key = `${base}#${STEPS[0]}`;
    const entry = { key, data: buildLut(color, imported, STEPS[0]), size: STEPS[0] };
    cache.set(key, entry);
    have = 0;
  }
  if (have < STEPS.length - 1 && !queue.some((j) => j.base === base)) {
    queue.push({ base, size: STEPS[have + 1], color, imported });
    runQueue();
  }
  return cache.get(`${base}#${STEPS[have]}`);
}

// Valores usados igualmente na prévia (WebGL) e na exportação (FFmpeg).
// sharpen < 0 = desfoque (a "maciez" da lente da câmera usa o mesmo filtro unsharp com valor negativo).
export function spatialOf(color) {
  const o = opticsOf(color?.camera);
  const vig = Math.min(1, (color?.vignette || 0) + lookVignette(color?.look) + (o?.vig || 0));
  const sharp = (color?.sharpen || 0) * 1.5 + (o ? (o.soft > 0 ? -o.soft : -o.soft * 1.5) : 0);
  return {
    vignette: vig * (Math.PI / 2.2),
    sharpen: Math.max(-1, Math.min(3, sharp)),
    optics: o && (o.ca > 0.004 || o.hal || o.str) ? { ca: o.ca, hal: o.hal, str: o.str } : null,
    grain: o?.grain ? Math.round(o.grain * 35) : 0,
  };
}
