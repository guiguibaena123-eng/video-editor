import { create } from 'zustand';
import { effSpeed } from './speed';

export const uid = (prefix = 'id') => prefix + '_' + Math.random().toString(36).slice(2, 10);
export const clipDur = (c) => (c.out - c.in) / effSpeed(c);
export const clipEnd = (c) => c.start + clipDur(c);
export const projectDuration = (p) => p.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
export const mediaUrl = (p) => 'media://file/' + encodeURIComponent(p);

export const ASPECTS = {
  '16:9': [1920, 1080],
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:3': [1440, 1080],
  '3:4': [1080, 1440],
  '4:5': [1080, 1350],
  '21:9': [2560, 1080],
  // Formatos de cinema (usados pelas câmeras)
  '2.39:1': [2560, 1072],
  '1.85:1': [1920, 1038],
  '1.9:1': [1920, 1010],
  '1.66:1': [1920, 1156],
  '1.43:1': [1440, 1008],
  '1.37:1': [1480, 1080],
  '3:2': [1620, 1080],
};

export const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };

// Recorte em frações da imagem original (0 a 1).
export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };
export const cropOf = (clip) => clip?.crop || FULL_CROP;
export const isCropped = (clip) => {
  const c = cropOf(clip);
  return c.x > 1e-4 || c.y > 1e-4 || c.w < 1 - 1e-4 || c.h < 1 - 1e-4;
};
// Tamanho (em pixels da fonte) depois do recorte.
export const croppedSize = (media, clip) => {
  const c = cropOf(clip);
  return { width: media.width * c.w, height: media.height * c.h };
};

export function newProject() {
  return {
    name: 'Projeto sem título',
    settings: { aspect: '16:9', width: 1920, height: 1080, fps: 30, background: '#000000', magnet: true, snap: true },
    tracks: [{ id: uid('t'), kind: 'video', name: 'Principal', main: true, hidden: false, muted: false, locked: false }],
    clips: [],
  };
}

// Ajustes automáticos depois de cada alteração: a trilha principal fica sem espaços
// (quando o ímã está ligado) e trilhas secundárias vazias somem.
export function normalize(p) {
  if (p.settings.magnet) packMain(p);
  const used = new Set(p.clips.map((c) => c.trackId));
  p.tracks = p.tracks.filter((t) => t.main || used.has(t.id));
}

export function packMain(p, order) {
  const main = p.tracks.find((t) => t.main);
  if (!main) return;
  const clips = p.clips.filter((c) => c.trackId === main.id);
  clips.sort(order || ((a, b) => a.start - b.start));
  let t = 0;
  let prev = null;
  for (const c of clips) {
    // Transição: este clipe começa antes do fim do anterior (os dois aparecem juntos).
    if (c.transition) {
      const d = prev ? Math.max(0.1, Math.min(c.transition.dur, clipDur(prev) - 0.1, clipDur(c) - 0.1)) : 0;
      if (prev && d > 0.05) c.transition = { ...c.transition, dur: Math.round(d * 1000) / 1000 };
      if (prev) t -= c.transition.dur;
    }
    c.start = Math.max(0, t);
    t = c.start + clipDur(c);
    prev = c;
  }
}

const QUALITY_KEY = 've.previewQuality';
function loadQuality() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return ['auto', 'high', 'medium', 'low'].includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}
export function setPreviewQuality(q) {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {}
  useStore.setState({ previewQuality: q, autoScale: 1 });
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !deepEqual(a[k], b[k])) return false;
  return true;
}

// Depois de copiar o projeto para editar, devolve a identidade dos clipes e trilhas que não mudaram.
// Sem isso toda alteração (até arrastar um slider) parece mudar TODOS os clipes e a linha do tempo
// inteira é redesenhada (miniaturas, ondas de áudio...).
function share(prev, next) {
  const reuse = (a, b) => {
    const byId = new Map(a.map((x) => [x.id, x]));
    let same = a.length === b.length;
    const out = b.map((x, i) => {
      const o = byId.get(x.id);
      const r = o && deepEqual(o, x) ? o : x;
      if (r !== a[i]) same = false;
      return r;
    });
    return same ? a : out;
  };
  next.clips = reuse(prev.clips, next.clips);
  next.tracks = reuse(prev.tracks, next.tracks);
  if (deepEqual(prev.settings, next.settings)) next.settings = prev.settings;
  return next;
}

let gestureBase = null;
const HISTORY = 100;

export const useStore = create((set, get) => ({
  project: newProject(),
  media: [],
  cache: {}, // mediaId -> { thumbs, peaks }
  selection: [],
  currentTime: 0,
  playing: false,
  zoom: 60, // pixels por segundo
  filePath: null,
  view: 'home', // home = tela de projetos · editor
  dirty: false,
  past: [],
  future: [],
  clipboard: null,
  toast: null,
  exportOpen: false,
  cropClipId: null,
  proxies: {}, // áudio processado por FFmpeg: "mediaId|efeitos" -> { status, path }
  recordOpen: false,
  lutFiles: {}, // arquivos .cube importados: caminho -> { data } ou { error }
  compareOriginal: false, // segurando o botão "original": mostra sem cor
  pickColorFor: null, // conta-gotas do chroma key: id do clipe esperando o clique no player
  busy: null, // tarefa demorada em andamento: { label, progress }
  prep: null, // tela "preparando o vídeo" (celular): { ids, phase, startedAt }
  previewQuality: loadQuality(), // resolução do player: auto | high | medium | low
  autoScale: 1, // redução automática da resolução quando o PC não acompanha (modo auto)
  theater: false, // player em tela cheia
  saving: false, // gravando o projeto na biblioteca (salvamento automático)

  commit(fn) {
    const s = get();
    const next = structuredClone(s.project);
    fn(next);
    normalize(next);
    share(s.project, next);
    set({ project: next, past: [...s.past.slice(-HISTORY), s.project], future: [], dirty: true });
    pruneSelection();
  },

  // Alterações contínuas (arrastar, sliders): só entram no histórico no fim do gesto.
  gestureStart() {
    gestureBase = get().project;
  },
  live(fn) {
    const prev = get().project;
    const next = structuredClone(prev);
    fn(next);
    share(prev, next);
    set({ project: next });
  },
  gestureEnd(fn) {
    const s = get();
    const next = structuredClone(s.project);
    if (fn) fn(next);
    normalize(next);
    share(s.project, next);
    const base = gestureBase || s.project;
    gestureBase = null;
    if (JSON.stringify(next) === JSON.stringify(base)) {
      set({ project: base });
      return;
    }
    set({ project: next, past: [...s.past.slice(-HISTORY), base], future: [], dirty: true });
    pruneSelection();
  },
  gestureCancel() {
    if (gestureBase) set({ project: gestureBase });
    gestureBase = null;
  },

  undo() {
    const s = get();
    if (!s.past.length) return;
    set({ project: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.project, ...s.future], dirty: true });
    pruneSelection();
  },
  redo() {
    const s = get();
    if (!s.future.length) return;
    set({ project: s.future[0], future: s.future.slice(1), past: [...s.past, s.project], dirty: true });
    pruneSelection();
  },

  select(ids) {
    set({ selection: ids });
  },
  setZoom(z) {
    set({ zoom: Math.min(600, Math.max(2, z)) });
  },
  // "action" = { label, run }: botão dentro do aviso (ex.: Desfazer).
  notify(message, kind = 'info', action = null) {
    const id = Date.now();
    set({ toast: { id, message, kind, action } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, kind === 'error' ? 6000 : action ? 5500 : 3000);
  },
}));

function pruneSelection() {
  const { project, selection } = useStore.getState();
  const ids = new Set(project.clips.map((c) => c.id));
  const kept = selection.filter((id) => ids.has(id));
  if (kept.length !== selection.length) useStore.setState({ selection: kept });
}

export const getMedia = (id) => useStore.getState().media.find((m) => m.id === id);
