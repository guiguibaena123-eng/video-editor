// Áudio profissional: ducking automático (a música abaixa quando alguém fala) e batidas
// (ritmo da música). As duas contas usam só os picos da forma de onda (40 por segundo),
// então a prévia e a exportação recebem exatamente os mesmos números.
import { sourceAt, effSpeed } from './speed';
import { valueAt } from './keyframes';

export const DEFAULT_DUCK = { on: false, amount: 14, sens: 0.2 };
export const withDuck = (a) => ({ ...DEFAULT_DUCK, ...a?.duck });

const durOf = (c) => (c.out - c.in) / effSpeed(c);
const RATE = 30; // amostras por segundo da curva de volume

// ---------- ducking ----------

// Nível a partir do qual um áudio conta como "voz": relativo aos picos fortes do arquivo.
const thrCache = new WeakMap();
function thresholdOf(wave, sens) {
  let base = thrCache.get(wave);
  if (base === undefined) {
    const sorted = Float32Array.from(wave.peaks).sort();
    base = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
    thrCache.set(wave, base);
  }
  return Math.max(0.015, base * sens);
}

// Clipes cujo som faz a música abaixar: qualquer outro clipe com som que não seja música com ducking.
export function duckSources(project, cache, media, clip) {
  const tracks = new Map(project.tracks.map((t) => [t.id, t]));
  const out = [];
  for (const c of project.clips) {
    if (c.id === clip.id || c.kind || c.audioDetached || c.audio?.duck?.on) continue;
    const tr = tracks.get(c.trackId);
    const m = media.get(c.mediaId);
    const wave = cache[c.mediaId]?.wave;
    if (!tr || tr.muted || tr.hidden || !m?.hasAudio || !wave || (c.volume ?? 1) <= 0) continue;
    out.push({ clip: c, wave });
  }
  return out;
}

// Curva de ganho (Float32Array a 30 por segundo) do ducking de um clipe de música.
export function duckCurve(project, cache, media, clip) {
  const d = withDuck(clip.audio);
  const dur = durOf(clip);
  const n = Math.ceil(dur * RATE) + 1;
  const raw = new Float32Array(n);
  for (const { clip: c, wave } of duckSources(project, cache, media, clip)) {
    const thr = thresholdOf(wave, d.sens);
    const cd = durOf(c);
    const i0 = Math.max(0, Math.floor((c.start - clip.start) * RATE));
    const i1 = Math.min(n - 1, Math.ceil((c.start + cd - clip.start) * RATE));
    for (let i = i0; i <= i1; i++) {
      const local = clip.start + i / RATE - c.start;
      if (local < 0 || local > cd) continue;
      const k = Math.floor(sourceAt(c, local) * wave.rate);
      let peak = 0;
      for (let j = k - 1; j <= k + 1; j++) if (wave.peaks[j] > peak) peak = wave.peaks[j];
      if (peak * valueAt(c, 'volume', local) > thr) raw[i] = 1;
    }
  }
  // Mantém abaixado nas pausas curtas entre palavras e começa a baixar um pouco antes da voz.
  const hold = Math.round(0.45 * RATE);
  const look = Math.round(0.12 * RATE);
  const act = new Float32Array(n);
  let last = -1e9;
  for (let i = 0; i < n; i++) {
    if (raw[i]) last = i;
    if (i - last <= hold) act[i] = 1;
  }
  for (let i = n - 1, next = 1e9; i >= 0; i--) {
    if (raw[i]) next = i;
    if (next - i <= look) act[i] = 1;
  }
  // Suaviza: desce rápido, sobe devagar.
  const low = Math.pow(10, -d.amount / 20);
  const aUp = 1 - Math.exp(-1 / (0.1 * RATE));
  const aDown = 1 - Math.exp(-1 / (0.4 * RATE));
  const out = new Float32Array(n);
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += (act[i] - s) * (act[i] > s ? aUp : aDown);
    out[i] = 1 - (1 - low) * s;
  }
  return out;
}

const memo = new Map(); // clipId -> { project, cache, curve }

// Ganho do ducking no instante "local" do clipe (1 = sem efeito). Refaz a conta só quando algo muda.
export function duckGainAt(project, cache, media, clip, local) {
  if (!clip.audio?.duck?.on) return 1;
  let e = memo.get(clip.id);
  if (!e || e.project !== project || e.cache !== cache) {
    e = { project, cache, curve: duckCurve(project, cache, media, clip) };
    memo.set(clip.id, e);
  }
  const x = Math.max(0, local) * RATE;
  const i = Math.min(e.curve.length - 1, Math.floor(x));
  const j = Math.min(e.curve.length - 1, i + 1);
  return e.curve[i] + (e.curve[j] - e.curve[i]) * (x - i);
}

export const duckActive = (clip) => !!clip.audio?.duck?.on;

// ---------- batidas ----------

const beatCache = new WeakMap();

// Detecta o andamento e as batidas de um áudio. Devolve { bpm, beats: [segundos no arquivo], confidence }.
export function detectBeats(wave) {
  const hit = beatCache.get(wave);
  if (hit) return hit;
  const res = compute(wave);
  beatCache.set(wave, res);
  return res;
}

function compute(wave) {
  const { peaks, rate } = wave;
  const n = peaks.length;
  if (n < rate * 4) return { bpm: 0, beats: [], confidence: 0 };
  // Força de ataque: quanto o volume subiu em relação à média dos instantes anteriores.
  const o = new Float32Array(n);
  let top = 0;
  for (let i = 4; i < n; i++) {
    const m = (peaks[i - 1] + peaks[i - 2] + peaks[i - 3] + peaks[i - 4]) / 4;
    o[i] = Math.max(0, peaks[i] - m);
    if (o[i] > top) top = o[i];
  }
  if (top < 0.01) return { bpm: 0, beats: [], confidence: 0 };
  for (let i = 0; i < n; i++) o[i] /= top;
  const at = (x) => {
    const i = Math.floor(x);
    if (i < 0 || i + 1 >= n) return 0;
    return o[i] + (o[i + 1] - o[i]) * (x - i);
  };
  // Andamento: o intervalo (70 a 180 bpm) em que os ataques mais se repetem.
  const corr = (lag) => {
    let s = 0;
    for (let i = 0; i + lag * 2 < n; i++) s += o[i] * (at(i + lag) + 0.5 * at(i + lag * 2));
    return s;
  };
  let bestLag = 0;
  let best = -1;
  let sum = 0;
  let cnt = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.25) {
    const lag = (60 / bpm) * rate;
    const s = corr(lag);
    sum += s;
    cnt++;
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  const confidence = Math.min(1, best / ((sum / cnt) * 3));
  // Prefere o dobro do andamento se for tão forte quanto (evita meio-tempo).
  const half = bestLag / 2;
  if (60 / (half / rate) <= 180 && corr(half) >= best * 0.97) bestLag = half;
  // Refina o intervalo ao redor do melhor valor.
  let refined = bestLag;
  let rb = -1;
  for (let l = bestLag * 0.97; l <= bestLag * 1.03; l += bestLag * 0.0005) {
    const s = corr(l);
    if (s > rb) {
      rb = s;
      refined = l;
    }
  }
  const period = refined;
  // Fase: onde cai a primeira batida.
  let phase = 0;
  let pb = -1;
  for (let ph = 0; ph < period; ph += 0.25) {
    let s = 0;
    for (let x = ph; x < n - 1; x += period) s += at(x);
    if (s > pb) {
      pb = s;
      phase = ph;
    }
  }
  const beats = [];
  for (let x = phase; x < n - 1; x += period) beats.push(+(x / rate).toFixed(4));
  return { bpm: +(60 / (period / rate)).toFixed(1), beats, confidence };
}

// Batidas de um clipe na linha do tempo (segundos), já com o ajuste fino.
export function beatTimes(clip, wave) {
  if (!wave || !clip.audio?.beats) return [];
  const { beats } = detectBeats(wave);
  const shift = clip.audio.beatShift || 0;
  const sp = effSpeed(clip);
  const dur = durOf(clip);
  const out = [];
  for (const b of beats) {
    const t = clip.start + (b + shift - clip.in) / sp;
    if (t >= clip.start - 1e-6 && t <= clip.start + dur + 1e-6) out.push(t);
  }
  return out;
}
