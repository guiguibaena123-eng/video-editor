// Transições entre clipes vizinhos da trilha principal.
// A transição fica no clipe que entra (B.transition = { type, dur }) e B começa "dur" segundos
// antes do fim de A: os dois aparecem juntos e mudam de posição/escala/opacidade.
// Tudo vira estado visual por quadro, então a prévia e a exportação usam a mesma conta.
import { clipEnd } from './store';

export const TRANSITIONS = [
  ['fade', 'Dissolver'],
  ['black', 'Fade preto'],
  ['slideL', 'Deslizar ←'],
  ['slideR', 'Deslizar →'],
  ['slideU', 'Deslizar ↑'],
  ['slideD', 'Deslizar ↓'],
  ['pushL', 'Empurrar ←'],
  ['pushR', 'Empurrar →'],
  ['zoomIn', 'Zoom entrando'],
  ['zoomOut', 'Zoom saindo'],
  ['spin', 'Girar'],
  ['blur', 'Desfocar'],
];
export const DEFAULT_TRANSITION_DUR = 0.6;

const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Entrada em "S" com um pequeno estouro além do alvo antes de assentar — a mesma curva de
// mola usada no zoom de batida da biblioteca de efeitos. Pode passar de 1 por um instante
// de propósito: é esse pulinho que dá o ar de transição de edição profissional.
const easeOutBack = (x) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const q = x - 1;
  return 1 + c3 * q * q * q + c1 * q * q;
};
// Velocidade aparente da curva padrão (derivada de `ease`), normalizada de 0 a 1: maior
// bem no meio da transição, zero nas pontas — usada para um leve desfoque de movimento só
// na parte rápida, como a borragem de obturador de uma câmera de verdade.
const easeSpeed = (u) => (u < 0.5 ? 12 * u * u : 3 * (2 - 2 * u) * (2 - 2 * u)) / 3;

// Zoom e giro ganham a mola (ficam "de batida"); deslizar e empurrar ficam com a curva
// clássica (mais sóbrios, como uma cortina puxada).
const SPRING = new Set(['zoomIn', 'zoomOut', 'spin']);
const shapeOf = (type, u) => (SPRING.has(type) ? easeOutBack(u) : ease(u));
// Que tipos recebem o desfoque de movimento, e o quanto no pico.
const BLUR_PEAK = { slideL: 9, slideR: 9, slideU: 9, slideD: 9, pushL: 10, pushR: 10, zoomIn: 14, zoomOut: 14, spin: 11 };
const motionBlur = (type, u) => (BLUR_PEAK[type] || 0) * easeSpeed(u);

// Clipe anterior (A) que a transição do clipe B cobre.
export function prevOf(project, b) {
  if (!b.transition) return null;
  const target = b.start + b.transition.dur;
  return project.clips.find((a) => a !== b && a.id !== b.id && a.trackId === b.trackId && a.start < b.start && Math.abs(clipEnd(a) - target) < 0.05) || null;
}
// Clipe seguinte (B) com transição que começa sobre o fim de A.
export function nextOf(project, a) {
  const end = clipEnd(a);
  return project.clips.find((b) => b.id !== a.id && b.trackId === a.trackId && b.transition && b.start > a.start && Math.abs(b.start + b.transition.dur - end) < 0.05) || null;
}

const NONE = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, blur: 0 };

// Alterações de estado por causa de transições, no instante "local" do clipe.
export function transitionMods(project, clip, local, dur) {
  if (!project) return NONE;
  const m = { ...NONE };
  // Entrando (este clipe é o B).
  if (clip.transition && local < clip.transition.dur && prevOf(project, clip)) {
    const u = clamp01(local / clip.transition.dur);
    applyIn(m, clip.transition.type, shapeOf(clip.transition.type, u), u);
  }
  // Saindo (este clipe é o A de um B com transição).
  const nb = nextOf(project, clip);
  if (nb) {
    const d = nb.transition.dur;
    const u = clamp01((local - (dur - d)) / d);
    if (local > dur - d) applyOut(m, nb.transition.type, shapeOf(nb.transition.type, u), u);
  }
  return m;
}

// "p" é a curva já moldada (pode passar de 1 por um instante nos tipos com mola — de
// propósito, é o que dá o estouro); "u" é o progresso cru (0→1), só para o desfoque.
function applyIn(m, type, p, u) {
  switch (type) {
    case 'fade':
      m.opacity *= p;
      break;
    case 'black':
      // Um instante parado no preto puro no meio (em vez de um corte seco exatamente na
      // metade): lê como uma batida deliberada, não um piscar acidental.
      m.opacity *= p < 0.42 ? 0 : clamp01((p - 0.42) / 0.58);
      break;
    case 'slideL':
    case 'pushL':
      m.dx += 1 - p;
      m.blur += motionBlur(type, u);
      break;
    case 'slideR':
    case 'pushR':
      m.dx -= 1 - p;
      m.blur += motionBlur(type, u);
      break;
    case 'slideU':
      m.dy += 1 - p;
      m.blur += motionBlur(type, u);
      break;
    case 'slideD':
      m.dy -= 1 - p;
      m.blur += motionBlur(type, u);
      break;
    case 'zoomIn':
      // p pode passar de 1 (mola): o zoom afunda um pouco além do tamanho final antes de
      // assentar, em vez de parar seco no alvo.
      m.scale *= 1.6 - 0.6 * p;
      m.opacity *= clamp01(p * 1.4); // fica visível um pouco antes do zoom terminar de assentar
      m.blur += motionBlur(type, u);
      break;
    case 'zoomOut':
      m.opacity *= clamp01(p);
      break;
    case 'spin':
      m.rotation += (1 - p) * 180; // a mola faz girar um pouquinho além de 0° e voltar
      m.scale *= Math.max(0.05, p);
      m.opacity *= clamp01(p * 1.3);
      m.blur += motionBlur(type, u);
      break;
    case 'blur':
      m.blur += (1 - p) * 24;
      m.opacity *= clamp01(p);
      break;
    default:
  }
}

function applyOut(m, type, p, u) {
  switch (type) {
    case 'black':
      m.opacity *= p < 0.58 ? clamp01(1 - p / 0.58) : 0;
      break;
    case 'pushL':
      m.dx -= p;
      m.blur += motionBlur(type, u);
      break;
    case 'pushR':
      m.dx += p;
      m.blur += motionBlur(type, u);
      break;
    case 'zoomOut':
      m.scale *= 1 + 0.6 * p; // mesma mola do zoomIn: um leve "empurrão" extra antes de sumir
      m.blur += motionBlur(type, u);
      break;
    case 'blur':
      m.blur += p * 24;
      break;
    default:
  }
}

export const hasTransitionAt = (project, clip) => !!(clip.transition && prevOf(project, clip)) || !!nextOf(project, clip);

// Áudio: durante a transição o som de A diminui enquanto o de B aumenta.
export function effectiveAudio(project, clip) {
  const a = { fadeIn: 0, fadeOut: 0, ...clip.audio };
  if (project && clip.transition && prevOf(project, clip)) a.fadeIn = Math.max(a.fadeIn, clip.transition.dur);
  const nb = project && nextOf(project, clip);
  if (nb) a.fadeOut = Math.max(a.fadeOut, nb.transition.dur);
  return a;
}
