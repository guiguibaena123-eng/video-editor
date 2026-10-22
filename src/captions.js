// Legendas manuais: cada fala é um clipe de texto (caption: true) na trilha "Legendas".
// Como são textos comuns, a prévia e a exportação usam o mesmo desenho (src/text.js).
import { useStore, uid, clipEnd, DEFAULT_TRANSFORM } from './store';
import { withStyle, withAnim } from './text';

export const CAPTION_STYLES = [
  ['classic', 'Clássica', { font: 'Montserrat', bold: true, color: '#ffffff', stroke: { enabled: true, color: '#000000', width: 6 } }],
  ['box', 'Caixa', { font: 'Poppins', bold: true, color: '#ffffff', background: { enabled: true, color: '#000000', opacity: 0.72, radius: 10, padding: 16 } }],
  ['yellow', 'Amarela', { font: 'Montserrat', bold: true, color: '#ffd400', stroke: { enabled: true, color: '#000000', width: 7 } }],
  ['soft', 'Suave', { font: 'Poppins', bold: false, color: '#ffffff', shadow: { enabled: true, color: '#000000', opacity: 0.85, blur: 12, distance: 3, angle: 90 } }],
  ['neon', 'Neon', { font: 'Poppins', bold: true, color: '#effcff', glow: { enabled: true, color: '#00c8ff', strength: 26 } }],
];
export const DEFAULT_CAPTION = { style: 'box', size: 56, y: 0.36 };
export const DEFAULT_CAPTION_DUR = 2;

export const captionStyleOf = (p) => ({ ...DEFAULT_CAPTION, ...p.captionStyle });

// Estilo de texto completo de uma legenda (estilo escolhido + tamanho), com o conteúdo dado.
function textStyle(cs, content) {
  const base = (CAPTION_STYLES.find(([id]) => id === cs.style) || CAPTION_STYLES[1])[2];
  return withStyle({ ...base, content, size: cs.size, align: 'center' });
}

export const captionClips = (p) => p.clips.filter((c) => c.caption).sort((a, b) => a.start - b.start);

function captionTrack(p) {
  let t = p.tracks.find((x) => x.captions);
  if (!t) {
    // No topo: legenda fica por cima de tudo.
    t = { id: uid('t'), kind: 'video', name: 'Legendas', captions: true, main: false, hidden: false, muted: false, locked: false };
    p.tracks.unshift(t);
  }
  return t;
}

function makeCaption(p, start, end, content) {
  const cs = captionStyleOf(p);
  return {
    id: uid('c'),
    kind: 'text',
    caption: true,
    trackId: captionTrack(p).id,
    start,
    in: 0,
    out: Math.max(0.1, end - start),
    speed: 1,
    text: textStyle(cs, content),
    anim: withAnim({}),
    transform: { ...DEFAULT_TRANSFORM, y: cs.y },
  };
}

// Nova fala no instante "at" (ou logo depois da fala que está ali), sem sobrepor a seguinte.
export function addCaption(at, content = '') {
  let id;
  useStore.getState().commit((p) => {
    const list = captionClips(p);
    let start = Math.max(0, at);
    const covering = list.find((c) => c.start <= start + 1e-3 && clipEnd(c) > start + 1e-3);
    if (covering) start = clipEnd(covering);
    const next = list.find((c) => c.start > start + 1e-3);
    const end = Math.min(start + DEFAULT_CAPTION_DUR, next ? next.start : Infinity);
    if (end - start < 0.2) return;
    const c = makeCaption(p, start, end, content);
    p.clips.push(c);
    id = c.id;
  });
  if (id) useStore.setState({ selection: [id] });
  return id;
}

export function updateCaption(id, { content, start, end }) {
  useStore.getState().commit((p) => {
    const c = p.clips.find((x) => x.id === id);
    if (!c) return;
    if (content != null) c.text = { ...c.text, content };
    const s = start != null ? Math.max(0, start) : c.start;
    const e = end != null ? end : clipEnd(c);
    c.start = s;
    c.in = 0;
    c.speed = 1;
    c.out = Math.max(0.1, e - s);
  });
}

export function removeCaption(id) {
  useStore.getState().commit((p) => {
    p.clips = p.clips.filter((x) => x.id !== id);
  });
}

// Muda o estilo de todas as legendas (e das próximas).
export function setCaptionStyle(patch) {
  useStore.getState().commit((p) => {
    const cs = { ...captionStyleOf(p), ...patch };
    p.captionStyle = cs;
    for (const c of p.clips) {
      if (!c.caption) continue;
      c.text = textStyle(cs, c.text?.content || '');
      c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, y: cs.y };
    }
  });
}

// ---------- arquivo .srt ----------

export function fmtSrt(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(ms % 1000, 3)}`;
}

const parseTime = (s) => {
  const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000 : null;
};

export function parseSrt(text) {
  const out = [];
  for (const block of text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTime(a);
    const end = parseTime(b);
    if (start == null || end == null || end <= start) continue;
    out.push({ start, end, content: lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '') });
  }
  return out;
}

export const toSrt = (clips) => clips.map((c, i) => `${i + 1}\n${fmtSrt(c.start)} --> ${fmtSrt(clipEnd(c))}\n${c.text?.content || ''}\n`).join('\n');

// Coloca as falas de um .srt no projeto (substitui as legendas que já existem).
export function importCaptions(items) {
  useStore.getState().commit((p) => {
    p.clips = p.clips.filter((c) => !c.caption);
    for (const it of items) p.clips.push(makeCaption(p, it.start, it.end, it.content));
  });
}
