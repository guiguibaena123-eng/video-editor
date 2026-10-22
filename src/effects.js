// Biblioteca de efeitos do clipe: clip.effects = [{ type, amount, speed, dur }].
// Cada efeito é uma receita feita de "peças" com a mesma conta na prévia e na exportação:
// - movimento (posição, escala, giro, opacidade, desfoque): vira estado por quadro (keyframes);
// - tom (brilho, contraste, saturação, matiz): na prévia o WebGL imita os filtros eq/hue
//   do FFmpeg; na exportação os valores vão quadro a quadro (sendcmd);
// - imagem (glitch, pixelar, inverter, granulado, brilho, espelho, tela dividida, barras, íris).

// [id, nome, categoria]
export const EFFECTS = [
  ['shake', 'Tremer', 'motion'],
  ['quake', 'Terremoto', 'motion'],
  ['handheld', 'Câmera na mão', 'motion'],
  ['pulse', 'Pulsar', 'motion'],
  ['punch', 'Zoom batida', 'motion'],
  ['zoomSlow', 'Zoom lento', 'motion'],
  ['zoomOutSlow', 'Afastar lento', 'motion'],
  ['sway', 'Balançar', 'motion'],
  ['spin', 'Rodopio', 'motion'],
  ['float', 'Flutuar', 'motion'],
  ['bounce', 'Pular', 'motion'],
  ['strobe', 'Piscar', 'motion'],
  ['blur', 'Desfoque', 'motion'],
  ['blurPulse', 'Desfoque pulsante', 'motion'],

  ['glitch', 'Glitch RGB', 'retro'],
  ['chroma', 'Aberração cromática', 'retro'],
  ['vhs', 'VHS', 'retro'],
  ['oldfilm', 'Filme antigo', 'retro'],
  ['tv', 'TV velha', 'retro'],
  ['cctv', 'Câmera de segurança', 'retro'],
  ['pixel', 'Pixelar', 'retro'],
  ['grain', 'Granulado', 'retro'],

  ['glow', 'Brilho', 'light'],
  ['dream', 'Sonho', 'light'],
  ['neon', 'Neon', 'light'],
  ['flash', 'Flash de batida', 'light'],
  ['strobeColor', 'Estrobo colorido', 'light'],
  ['rainbow', 'Arco-íris', 'light'],
  ['bwFlicker', 'P&B piscando', 'light'],
  ['heat', 'Calor', 'light'],
  ['invert', 'Inverter cores', 'light'],

  ['mirror', 'Espelho', 'screen'],
  ['split4', 'Tela dividida 4', 'screen'],
  ['split9', 'Tela dividida 9', 'screen'],
  ['letterbox', 'Formato cinema', 'screen'],

  ['openBlack', 'Surgir do preto', 'open'],
  ['openWhite', 'Surgir do branco', 'open'],
  ['openBars', 'Abertura de cinema', 'open'],
  ['openIris', 'Íris abrindo', 'open'],
  ['openZoom', 'Zoom de abertura', 'open'],
  ['openBlur', 'Desfoque de abertura', 'open'],
  ['openFlash', 'Flash de abertura', 'open'],
  ['openGlitch', 'Glitch de abertura', 'open'],

  ['closeBlack', 'Escurecer no fim', 'close'],
  ['closeWhite', 'Clarear no fim', 'close'],
  ['closeBars', 'Fechamento de cinema', 'close'],
  ['closeIris', 'Íris fechando', 'close'],
  ['closeZoom', 'Zoom de saída', 'close'],
  ['closeBlur', 'Desfoque de saída', 'close'],
  ['closeFilm', 'Fim de filme', 'close'],
  ['closeGlitch', 'Glitch de saída', 'close'],
];
export const EFFECT_CATS = [
  ['motion', 'Movimento'],
  ['retro', 'Retrô e distorção'],
  ['light', 'Luz e cor'],
  ['screen', 'Tela'],
  ['open', 'Aberturas'],
  ['close', 'Fechamentos'],
];
export const EFFECT_LABEL = Object.fromEntries(EFFECTS.map(([id, label]) => [id, label]));
export const EFFECT_CAT = Object.fromEntries(EFFECTS.map(([id, , c]) => [id, c]));

// Ajustes que cada efeito oferece no painel.
const PERIODIC = new Set(['shake', 'quake', 'handheld', 'pulse', 'punch', 'sway', 'spin', 'float', 'bounce', 'strobe', 'blurPulse', 'glitch', 'vhs', 'oldfilm', 'tv', 'flash', 'strobeColor', 'rainbow', 'bwFlicker']);
export const HAS_SPEED = PERIODIC;
export const HAS_DUR = (type) => EFFECT_CAT[type] === 'open' || EFFECT_CAT[type] === 'close';
export const HAS_AMOUNT = (type) => !HAS_DUR(type) && !['invert', 'mirror', 'split4', 'split9'].includes(type);
export const newEffect = (type) => ({ type, amount: 0.5, speed: 1, ...(HAS_DUR(type) ? { dur: 1 } : {}) });

const list = (clip) => (Array.isArray(clip?.effects) ? clip.effects : []);
export const hasEffects = (clip) => list(clip).length > 0;

// ---------- trilha de efeito ----------
// Um clipe de efeito (kind: 'effect', fx: { type, amount, speed, dur }) fica numa trilha "Efeito N"
// e vale para todos os vídeos e imagens das trilhas ABAIXO dele, só no trecho que ele cobre.
// Para isso o efeito entra na lista do clipe com uma janela: off = início do efeito no tempo
// do clipe, win = duração do efeito. A conta usa o tempo dentro do efeito (igual prévia/exportação).
const fxEnd = (c) => c.start + (c.out - c.in) / (c.speed || 1);
export function trackEffectsFor(project, clip) {
  if (!project || !clip || clip.kind) return [];
  const idx = project.tracks.findIndex((t) => t.id === clip.trackId);
  if (idx < 0) return [];
  const end = fxEnd(clip);
  const out = [];
  for (const c of project.clips) {
    if (c.kind !== 'effect' || !c.fx) continue;
    const ti = project.tracks.findIndex((t) => t.id === c.trackId);
    if (ti < 0 || ti >= idx || project.tracks[ti].hidden) continue;
    const s = c.start;
    const e = fxEnd(c);
    if (e <= clip.start + 1e-4 || s >= end - 1e-4) continue;
    out.push({ ...c.fx, off: s - clip.start, win: e - s });
  }
  return out;
}
// O clipe com os efeitos da trilha de efeito somados aos dele.
export function withTrackFx(project, clip) {
  const extra = trackEffectsFor(project, clip);
  return extra.length ? { ...clip, effects: [...list(clip), ...extra] } : clip;
}
// Efeitos ativos no instante t, cada um com o seu tempo local e duração.
function* active(clip, t, dur) {
  for (const e of list(clip)) {
    if (e.off == null) {
      yield [e, t, dur];
      continue;
    }
    const te = t - e.off;
    if (te < 0 || te >= e.win) continue;
    yield [e, te, e.win];
  }
}

// Quais peças cada efeito usa (para saber se o clipe precisa de cada etapa).
const MOTION = new Set(['shake', 'quake', 'handheld', 'pulse', 'punch', 'zoomSlow', 'zoomOutSlow', 'sway', 'spin', 'float', 'bounce', 'strobe', 'blur', 'blurPulse', 'vhs', 'oldfilm', 'openZoom', 'openBlur', 'openFlash', 'openGlitch', 'closeZoom', 'closeBlur', 'closeGlitch']);
const IMAGE = new Set(['glitch', 'chroma', 'vhs', 'oldfilm', 'tv', 'cctv', 'pixel', 'grain', 'glow', 'dream', 'neon', 'flash', 'strobeColor', 'rainbow', 'bwFlicker', 'heat', 'invert', 'mirror', 'split4', 'split9', 'letterbox', 'openBlack', 'openWhite', 'openBars', 'openIris', 'openFlash', 'openGlitch', 'closeBlack', 'closeWhite', 'closeBars', 'closeIris', 'closeFilm', 'closeGlitch']);
export const hasMotionFx = (clip) => list(clip).some((e) => MOTION.has(e.type));
export const hasImageFx = (clip) => list(clip).some((e) => IMAGE.has(e.type));

// Número "aleatório" fixo para cada passo: tremores e glitches saem iguais em toda execução.
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
// Ruído suave entre -1 e 1.
function smoothNoise(t, seed) {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash(i + seed * 101) * 2 - 1;
  const b = hash(i + 1 + seed * 101) * 2 - 1;
  return a + (b - a) * f * f * (3 - 2 * f);
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Suavização usada nas aberturas/fechamentos (mesma fórmula na expressão do FFmpeg).
const ease = (p) => {
  const q = clamp01(p);
  return q * q * (3 - 2 * q);
};
const durOf = (e, dur) => Math.max(0.05, Math.min(e.dur ?? 1, dur));
// Progresso de uma abertura (0 → 1) e de um fechamento (0 → 1 no fim do clipe).
const openP = (e, t, dur) => ease(t / durOf(e, dur));
const closeP = (e, t, dur) => ease((t - (dur - durOf(e, dur))) / durOf(e, dur));

// Entrada em "S" com um pequeno estouro além do alvo antes de assentar — a curva de mola
// (spring) usada em motion graphics profissional para zooms de batida com gosto de clique.
const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const q = x - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
};
// Ruído em camadas (fractal/FBM): três oscilações (lenta + média + rápida) somadas em vez de
// uma onda só — o mesmo truque de tremores de câmera profissionais; fica orgânico, não mecânico.
function fbm(t, seed) {
  return 0.55 * smoothNoise(t, seed) + 0.3 * smoothNoise(t * 2.17 + 11, seed + 53) + 0.15 * smoothNoise(t * 4.9 + 23, seed + 131);
}
// Entrada e saída suaves (como um fade de áudio): um efeito contínuo nunca liga/desliga com um
// corte seco — essencial na trilha de efeito, onde o efeito pode começar e terminar no meio do
// clipe. Aberturas/fechamentos (openP/closeP) já são a própria rampa, por isso ficam de fora.
function envelope(t, dur) {
  if (!(dur > 0) || !isFinite(dur)) return 1;
  const r = Math.min(dur * 0.22, 0.3);
  if (r <= 1e-4) return 1;
  return ease(Math.min(t / r, (dur - t) / r));
}

// ---------- movimento ----------

const NONE = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, blur: 0 };
const isEdgeFx = (type) => EFFECT_CAT[type] === 'open' || EFFECT_CAT[type] === 'close';

export function effectMods(clip, T, D) {
  const m = { ...NONE };
  for (const [e, t, dur] of active(clip, T, D)) {
    const env = isEdgeFx(e.type) ? 1 : envelope(t, dur);
    const a = (e.amount ?? 0.5) * env;
    const sp = e.speed ?? 1;
    switch (e.type) {
      case 'shake':
      case 'quake': {
        const k = e.type === 'quake' ? 2.5 : 1;
        const u = t * 14 * sp * (e.type === 'quake' ? 1.6 : 1);
        m.dx += 0.03 * a * k * fbm(u, 1);
        m.dy += 0.03 * a * k * fbm(u, 2);
        m.rotation += 2.5 * a * k * fbm(u, 3);
        m.scale *= 1 + 0.06 * a * k; // amplia para as bordas não aparecerem
        // Desfoque de movimento proporcional à velocidade do tremor, como a borragem de
        // obturador de uma câmera de verdade — não um chacoalhar perfeitamente nítido.
        const vel = Math.abs(fbm(u + 0.35, 1) - fbm(u - 0.35, 1)) + Math.abs(fbm(u + 0.35, 2) - fbm(u - 0.35, 2));
        m.blur += Math.min(5, vel * 9) * a * k;
        break;
      }
      case 'handheld': {
        const u = t * 1.2 * sp;
        m.dx += 0.012 * a * fbm(u, 4);
        m.dy += 0.01 * a * fbm(u, 5);
        m.rotation += 0.8 * a * fbm(u, 6);
        m.scale *= 1 + 0.04 * a;
        const vel = Math.abs(fbm(u + 0.3, 4) - fbm(u - 0.3, 4)) + Math.abs(fbm(u + 0.3, 5) - fbm(u - 0.3, 5));
        m.blur += Math.min(2.5, vel * 6) * a;
        break;
      }
      case 'pulse': {
        // Sobe suave até o pico (nunca pula direto nele) e relaxa: sem o salto de quem
        // reinicia o ciclo do zero a cada batida.
        const p = (t * 2 * sp) % 1;
        const attack = 0.1;
        const amt = p < attack ? ease(p / attack) : Math.exp(-(p - attack) * 5);
        m.scale *= 1 + 0.12 * a * amt;
        break;
      }
      case 'punch': {
        // Zoom de batida: entra com uma pequena mola (passa um pouco do alvo) e assenta —
        // o mesmo ar de clique usado em edição de ritmo profissional.
        const p = (t * sp) % 1;
        const attack = 0.16;
        const amt = p < attack ? easeOutBack(p / attack) : Math.exp(-(p - attack) * 6.5);
        m.scale *= 1 + 0.3 * a * amt;
        break;
      }
      case 'zoomSlow':
        m.scale *= 1 + 0.3 * a * ease(clamp01(t / Math.max(0.1, dur)));
        break;
      case 'zoomOutSlow':
        m.scale *= 1 + 0.3 * a * (1 - ease(clamp01(t / Math.max(0.1, dur))));
        break;
      case 'sway':
        // Duas frequências somadas (fundamental + harmônico leve): nunca parece um pêndulo
        // perfeito, fica como um balanço de verdade.
        m.rotation += a * (7 * Math.sin(2 * Math.PI * t * 0.8 * sp) + 1.4 * Math.sin(2 * Math.PI * t * 2.15 * sp + 1.1));
        break;
      case 'spin':
        m.rotation += 360 * (0.1 + 0.4 * a) * sp * t;
        break;
      case 'float':
        m.dy += 0.025 * a * Math.sin(2 * Math.PI * t * 0.6 * sp);
        break;
      case 'bounce': {
        // Parábola de queda livre em vez de senoide: acelera para baixo e para cima como
        // gravidade de verdade, com um leve achatamento no topo do salto.
        const p = (t * 2 * sp) % 1;
        const h = 4 * p * (1 - p);
        m.dy -= 0.085 * a * h;
        m.scale *= 1 + 0.018 * a * h;
        break;
      }
      case 'strobe':
        if ((t * 4 * sp) % 1 >= 0.5) m.opacity *= 1 - a;
        break;
      case 'blur':
        m.blur += 30 * a;
        break;
      case 'blurPulse': {
        const p = (t * 2 * sp) % 1;
        const attack = 0.08;
        const amt = p < attack ? ease(p / attack) : Math.exp(-(p - attack) * 5);
        m.blur += 28 * a * amt;
        break;
      }
      case 'vhs':
        m.blur += 1.2 * env;
        m.dy += 0.003 * a * fbm(t * 3 * sp, 7);
        break;
      case 'oldfilm':
        // Oscilação suave (peso do filme no projetor), não um tranco a cada quadro.
        m.dx += 0.0035 * a * fbm(t * 2.3 * sp, 11);
        m.dy += 0.004 * a * fbm(t * 1.7 * sp, 13);
        break;
      case 'openZoom': {
        const p = openP(e, t, dur);
        m.scale *= 1 + 0.5 * (1 - p);
        m.opacity *= p;
        break;
      }
      case 'openBlur':
        m.blur += 40 * (1 - openP(e, t, dur));
        break;
      case 'openFlash':
        m.scale *= 1 + 0.15 * (1 - openP(e, t, dur));
        break;
      case 'openGlitch': {
        const p = openP(e, t, dur);
        m.dx += 0.02 * (1 - p) * (hash(Math.floor(t * 20)) - 0.5);
        break;
      }
      case 'closeZoom': {
        const q = closeP(e, t, dur);
        m.scale *= 1 + 0.5 * q;
        m.opacity *= 1 - q;
        break;
      }
      case 'closeBlur':
        m.blur += 40 * closeP(e, t, dur);
        break;
      case 'closeGlitch': {
        const q = closeP(e, t, dur);
        m.dx += 0.02 * q * (hash(Math.floor(t * 20) + 5) - 0.5);
        break;
      }
      default:
    }
  }
  return m;
}

// ---------- imagem ----------
// Medidas em fração da largura do quadro original (antes do recorte).

export const TONE_ID = { bri: 0, con: 1, sat: 1, hue: 0 };
const isToneId = (o) => Math.abs(o.bri) < 1e-4 && Math.abs(o.con - 1) < 1e-4 && Math.abs(o.sat - 1) < 1e-4 && Math.abs(o.hue) < 1e-3;

// Deslocamento do glitch: saltos ~12 por segundo, alguns passos limpos.
const glitchShift = (t, sp, a, seed = 0) => {
  const step = Math.floor(t * 12 * sp) + seed;
  if (hash(step + 7) < 0.35) return 0;
  return 0.025 * a * (0.4 + 0.6 * hash(step + 19)) * (hash(step + 3) < 0.5 ? -1 : 1);
};

export function imageFxAt(clip, T, D = Infinity) {
  const out = { shift: 0, tone: { ...TONE_ID } };
  const tone = out.tone;
  for (const [e, t, dur] of active(clip, T, D)) {
    const env = isEdgeFx(e.type) ? 1 : envelope(t, dur);
    const a0 = e.amount ?? 0.5;
    const a = a0 * env;
    const sp = e.speed ?? 1;
    switch (e.type) {
      case 'glitch':
        out.shift += glitchShift(t, sp, a);
        break;
      case 'chroma':
        out.shift += (0.004 + 0.012 * a) * env;
        break;
      case 'vhs':
        out.shift += (0.004 + 0.004 * a * (1 + smoothNoise(t * 6 * sp, 8))) * env;
        // Grão e brilho (glow) não são animados quadro a quadro na exportação (o FFmpeg usa
        // um valor só para o trecho inteiro) — por isso usam a intensidade crua (a0), não a
        // rampa (env): a presença continua ligando/desligando certinho na janela do efeito,
        // mas sem descasar prévia × exportação.
        out.grain = Math.max(out.grain || 0, 10 + 14 * a0);
        tone.sat *= 1 + 0.35 * a;
        tone.con *= 1 + 0.05 * env;
        break;
      case 'oldfilm':
        tone.sat *= 1 - 0.75 * a;
        tone.con *= 1 + 0.08 * env;
        // Cintilação de exposição suave (o grão do filme variando), não um flicker quadrado.
        tone.bri += fbm(t * 7 * sp, 19) * 0.07 * a;
        out.grain = Math.max(out.grain || 0, 10 + 25 * a0);
        break;
      case 'tv':
        tone.bri += (hash(Math.floor(t * 24 * sp) + 3) - 0.5) * 0.18 * a;
        out.shift += 0.003 * a;
        out.grain = Math.max(out.grain || 0, 8 + 10 * a0);
        break;
      case 'cctv':
        tone.sat = Math.max(0, 1 - env);
        tone.con *= 1 + (0.15 + 0.15 * a) * env;
        out.grain = Math.max(out.grain || 0, 8 + 16 * a0);
        out.pixel = Math.max(out.pixel || 0, 0.002 + 0.003 * a0);
        break;
      case 'pixel':
        out.pixel = Math.max(out.pixel || 0, 0.004 + 0.05 * a0);
        break;
      case 'grain':
        out.grain = Math.max(out.grain || 0, 6 + 40 * a0);
        break;
      case 'glow':
        out.glow = { sigma: 0.004 + 0.02 * a0, opacity: 0.35 + 0.5 * a0 };
        break;
      case 'dream':
        out.glow = { sigma: 0.02, opacity: 0.45 + 0.4 * a0 };
        tone.bri += 0.04 * a;
        tone.sat *= 1 - 0.15 * a;
        break;
      case 'neon':
        out.glow = { sigma: 0.012, opacity: 0.55 + 0.35 * a0 };
        tone.sat *= 1 + 1.2 * a;
        tone.con *= 1 + 0.12 * env;
        break;
      case 'flash':
        tone.bri += 0.6 * a * Math.exp(-((t * 2 * sp) % 1) * 8);
        break;
      case 'strobeColor':
        tone.hue += env * ((Math.floor(t * 4 * sp) * 97) % 360);
        tone.sat *= 1 + 0.6 * a;
        break;
      case 'rainbow':
        tone.hue += env * ((t * 120 * sp) % 360);
        tone.sat *= 1 + 0.4 * a;
        break;
      case 'bwFlicker':
        if (Math.floor(t * 4 * sp) % 2) tone.sat *= 1 - a;
        break;
      case 'heat':
        tone.hue += -20 * a;
        tone.sat *= 1 + 0.5 * a;
        tone.con *= 1 + 0.1 * a;
        break;
      case 'invert':
        out.invert = 1;
        break;
      case 'mirror':
        out.mirror = 1;
        break;
      case 'split4':
        out.split = 2;
        break;
      case 'split9':
        out.split = 3;
        break;
      case 'openBlack':
        tone.bri -= 1 - openP(e, t, dur);
        break;
      case 'openWhite':
        tone.bri += 1 - openP(e, t, dur);
        break;
      case 'openFlash':
        tone.bri += 1 - ease(t / (durOf(e, dur) * 0.6));
        break;
      case 'openGlitch':
        out.shift += glitchShift(t, 1.5, 1.6 * (1 - openP(e, t, dur)), 31);
        break;
      case 'closeBlack':
        tone.bri -= closeP(e, t, dur);
        break;
      case 'closeWhite':
        tone.bri += closeP(e, t, dur);
        break;
      case 'closeFilm': {
        const q = closeP(e, t, dur);
        tone.sat *= 1 - 0.85 * q;
        tone.bri -= q;
        break;
      }
      case 'closeGlitch':
        out.shift += glitchShift(t, 1.5, 1.6 * closeP(e, t, dur), 47);
        break;
      default:
    }
  }
  const bars = barsAt(clip, T, D);
  if (bars > 0) out.bars = bars;
  const iris = irisAt(clip, T, D);
  if (iris < 1) out.iris = iris;
  if (isToneId(tone)) delete out.tone;
  else {
    tone.bri = Math.max(-1, Math.min(1, tone.bri));
    tone.sat = Math.max(0, Math.min(3, tone.sat));
  }
  if (!out.shift) delete out.shift;
  return out;
}

// Precisa do segundo passo do WebGL?
export const needsGLPass = (fx) => !!fx && !!(fx.shift || fx.pixel || fx.invert || fx.grain || fx.tone || fx.mirror || fx.split || fx.bars || fx.iris != null);

// ---------- barras de cinema e íris ----------

const BAR_BASE = 0.12; // altura de cada barra no formato cinema aberto (fração da altura)

const BAR_TYPES = new Set(['letterbox', 'openBars', 'closeBars']);
const IRIS_TYPES = new Set(['openIris', 'closeIris']);
export function barsAt(clip, T, D) {
  let b = 0;
  for (const [e, t, dur] of active(clip, T, D)) {
    if (e.type === 'letterbox') b = Math.max(b, (0.05 + 0.1 * (e.amount ?? 0.5)) * envelope(t, dur));
    else if (e.type === 'openBars') b = Math.max(b, BAR_BASE + (0.5 - BAR_BASE) * (1 - ease(t / durOf(e, dur))));
    else if (e.type === 'closeBars') b = Math.max(b, BAR_BASE + (0.5 - BAR_BASE) * ease((t - (dur - durOf(e, dur))) / durOf(e, dur)));
  }
  return Math.min(0.5, b);
}
// Raio da íris (1 = aberta, cobrindo até o canto; 0 = fechada).
export function irisAt(clip, T, D) {
  let r = 1;
  for (const [e, t, dur] of active(clip, T, D)) {
    if (e.type === 'openIris') r = Math.min(r, ease(t / durOf(e, dur)));
    else if (e.type === 'closeIris') r = Math.min(r, 1 - ease((t - (dur - durOf(e, dur))) / durOf(e, dur)));
  }
  return r;
}

// ---------- exportação ----------

// Trechos (em segundos do clipe) em que uma peça está ligada: [[início, fim], ...].
function spans(flags, fps) {
  const out = [];
  let s = -1;
  flags.forEach((on, i) => {
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      out.push([+(s / fps).toFixed(4), +((i - 0.5) / fps).toFixed(4)]);
      s = -1;
    }
  });
  if (s >= 0) out.push([+(s / fps).toFixed(4), +((flags.length + 1) / fps).toFixed(4)]);
  return out;
}

export function exportFx(clip, media, fps, dur) {
  if (!hasImageFx(clip)) return undefined;
  const W = media.width;
  const H = media.height;
  const frames = Math.max(1, Math.ceil(dur * fps - 1e-6));
  const out = { w: W, h: H };
  const shift = [];
  const tone = [];
  let anyShift = false;
  let anyTone = false;
  let pixel = 0;
  let grain = 0;
  // Peças sem valor por quadro: ligadas/desligadas a cada quadro (efeitos da trilha de efeito
  // cobrem só um trecho do clipe). Se ficam ligadas o clipe todo, não precisam de trechos.
  const on = { pixel: [], grain: [], invert: [], mirror: [], split: [], glow: [] };
  for (let i = 0; i < frames; i++) {
    const fx = imageFxAt(clip, i / fps, dur);
    const s = Math.round((fx.shift || 0) * W);
    shift.push(s);
    if (s) anyShift = true;
    const tn = fx.tone || TONE_ID;
    tone.push([+tn.bri.toFixed(4), +tn.con.toFixed(4), +tn.sat.toFixed(4), +(((tn.hue % 360) + 360) % 360).toFixed(2)]);
    if (fx.tone) anyTone = true;
    pixel = Math.max(pixel, fx.pixel || 0);
    grain = Math.max(grain, fx.grain || 0);
    if (fx.invert) out.invert = 1;
    if (fx.mirror) out.mirror = 1;
    if (fx.split) out.split = Math.max(out.split || 0, fx.split);
    if (fx.glow && (!out.glow || fx.glow.opacity > out.glow.opacity)) out.glow = { sigma: +(fx.glow.sigma * W).toFixed(2), opacity: +fx.glow.opacity.toFixed(3) };
    for (const k in on) on[k].push(!!fx[k]);
  }
  if (anyShift) out.shift = shift;
  if (anyTone) out.tone = tone;
  if (pixel) out.pixel = Math.max(2, Math.round(pixel * W));
  // Granulado que muda com o tempo (fim de filme) usa o maior valor: o FFmpeg não troca a força no meio.
  if (grain) out.grain = Math.round(grain);
  const when = {};
  for (const k in on) if (on[k].some(Boolean) && !on[k].every(Boolean)) when[k] = spans(on[k], fps);
  if (Object.keys(when).length) out.when = when;
  // Barras e íris quadro a quadro (mesmas funções da prévia).
  if (list(clip).some((e) => BAR_TYPES.has(e.type))) out.bars = Array.from({ length: frames }, (_, i) => +barsAt(clip, i / fps, dur).toFixed(4));
  if (list(clip).some((e) => IRIS_TYPES.has(e.type))) out.iris = Array.from({ length: frames }, (_, i) => +irisAt(clip, i / fps, dur).toFixed(4));
  return out;
}
