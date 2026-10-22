// Modelos de projeto: projetos prontos (trilhas, textos, transições, cor e efeitos já
// montados) — o usuário só escolhe qual mídia entra em cada "vaga" (slot) e o projeto sai
// pronto para exportar. Cada modelo usa exatamente os mesmos blocos que o app já tem
// (clip.transition, clip.color.filter, clip.effects, clip.text) — nenhum motor novo.
import { uid, DEFAULT_TRANSFORM, ASPECTS, normalize, useStore } from './store';
import { createTrack } from './ops';
import { withStyle, withAnim } from './text';
import { newEffect } from './effects';
import { askConfirm } from './components/DialogHost.jsx';

// Clipe de uma vaga: até "dur" segundos da mídia escolhida (imagens usam dur inteiro;
// vídeos mais curtos que a vaga usam o que existir).
function slotClip(media, trackId, start, dur) {
  const out = media.type === 'image' ? dur : Math.min(dur, media.duration || dur);
  return { id: uid('c'), mediaId: media.id, trackId, start, in: 0, out, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM } };
}
// Clipe de texto pronto, na trilha indicada.
function textClip(trackId, start, dur, style, anim, transform) {
  return { id: uid('c'), kind: 'text', trackId, start, in: 0, out: dur, speed: 1, text: withStyle(style), anim: withAnim(anim), transform: { ...DEFAULT_TRANSFORM, ...transform } };
}
const filterOf = (id, intensity = 1) => ({ filter: { id, intensity } });

// Põe os clipes das vagas na trilha principal e calcula onde cada um vai começar depois de
// empacotado (packMain: cada transição sobrepõe o clipe anterior). Os textos usam essas posições.
// trs[i] = duração da transição de entrada do clipe i (trs[0] é ignorado).
function mainSequence(p, media, ids, durs, trs, types) {
  const main = p.tracks.find((t) => t.main);
  const clips = ids.map((id, i) => slotClip(media[id], main.id, i * 100, durs[i]));
  const starts = [];
  let t = 0;
  clips.forEach((cl, i) => {
    const d = i > 0 ? trs[i] : 0;
    if (d) cl.transition = { type: types[i], dur: d };
    t -= d;
    starts.push(t);
    t += cl.out - cl.in;
  });
  p.clips.push(...clips);
  return { main, clips, starts, total: t };
}

export const TEMPLATES = [
  {
    id: 'vlog-open',
    label: 'Abertura de vlog',
    icon: '🎬',
    aspect: '16:9',
    desc: '3 cortes com título animado, cor vívida e fechamento em preto.',
    slots: [
      { id: 'a', label: 'Clipe 1 (abertura)', dur: 3 },
      { id: 'b', label: 'Clipe 2', dur: 3 },
      { id: 'c', label: 'Clipe 3 (fim)', dur: 3 },
    ],
    build(p, media) {
      const [a, b, c] = ['a', 'b', 'c'].map((id) => media[id]);
      const main = p.tracks.find((t) => t.main);
      const clips = [slotClip(a, main.id, 0, 3), slotClip(b, main.id, 10, 3), slotClip(c, main.id, 20, 3)];
      clips.forEach((cl) => (cl.color = filterOf('vivid')));
      clips[1].transition = { type: 'zoomIn', dur: 0.6 };
      clips[2].transition = { type: 'fade', dur: 0.6 };
      clips[1].effects = [{ ...newEffect('punch'), amount: 0.6 }];
      clips[2].effects = [{ ...newEffect('closeBlack'), dur: 0.8 }];
      p.clips.push(...clips);
      const textTrack = createTrack(p, 'video', main.id, 'Texto 1');
      p.clips.push(
        textClip(textTrack.id, 0, 2.2, { content: 'SEU VLOG', size: 150, letterSpacing: 4 }, { in: { type: 'zoomOut', dur: 0.8 }, out: { type: 'fade', dur: 0.5 } }, { y: -0.04 }),
        textClip(textTrack.id, 0, 2.2, { content: 'um novo vídeo toda semana', font: 'Poppins', bold: false, size: 46, letterSpacing: 8, color: '#d9d9d9' }, { in: { type: 'fade', dur: 1.2 }, out: { type: 'fade', dur: 0.5 } }, { y: 0.09 }),
      );
    },
  },
  {
    id: 'reels',
    label: 'Reels rápido',
    icon: '📱',
    aspect: '9:16',
    desc: '4 cortes curtos com empurrões alternados, cor vívida e título fixo no topo.',
    slots: [
      { id: 'a', label: 'Clipe 1', dur: 1.3 },
      { id: 'b', label: 'Clipe 2', dur: 1.3 },
      { id: 'c', label: 'Clipe 3', dur: 1.3 },
      { id: 'd', label: 'Clipe 4', dur: 1.3 },
    ],
    build(p, media) {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => media[id]);
      const main = p.tracks.find((t) => t.main);
      const clips = [slotClip(a, main.id, 0, 1.3), slotClip(b, main.id, 10, 1.3), slotClip(c, main.id, 20, 1.3), slotClip(d, main.id, 30, 1.3)];
      clips.forEach((cl) => (cl.color = filterOf('vivid')));
      clips[1].transition = { type: 'pushL', dur: 0.3 };
      clips[2].transition = { type: 'pushR', dur: 0.3 };
      clips[3].transition = { type: 'pushL', dur: 0.3 };
      clips[3].effects = [{ ...newEffect('zoomSlow'), amount: 0.5 }];
      p.clips.push(...clips);
      const total = clips.reduce((sum, cl) => sum + (cl.out - cl.in), 0) - 3 * 0.3; // soma menos a sobreposição das transições
      const textTrack = createTrack(p, 'video', main.id, 'Texto 1');
      p.clips.push(
        textClip(
          textTrack.id,
          0,
          total,
          { content: 'TÍTULO AQUI', size: 86, color: '#111111', background: { enabled: true, color: '#ffc72c', opacity: 1, radius: 10, padding: 20 } },
          { in: { type: 'pop', dur: 0.35 }, out: { type: 'fade', dur: 0.3 } },
          { y: -0.35 },
        ),
      );
    },
  },
  {
    id: 'before-after',
    label: 'Antes e depois',
    icon: '↔️',
    aspect: '1:1',
    desc: 'Dois clipes lado a lado no tempo, com rótulos ANTES/DEPOIS prontos.',
    slots: [
      { id: 'a', label: 'Antes', dur: 3 },
      { id: 'b', label: 'Depois', dur: 3 },
    ],
    build(p, media) {
      const [a, b] = ['a', 'b'].map((id) => media[id]);
      const main = p.tracks.find((t) => t.main);
      const DUR = 3;
      const TR = 0.5;
      const clips = [slotClip(a, main.id, 0, DUR), slotClip(b, main.id, 10, DUR)];
      clips[1].transition = { type: 'pushL', dur: TR };
      p.clips.push(...clips);
      const textTrack = createTrack(p, 'video', main.id, 'Texto 1');
      const labelStyle = (text, bg) => ({ content: text, size: 52, color: '#111111', align: 'left', letterSpacing: 2, background: { enabled: true, color: bg, opacity: 1, radius: 8, padding: 16 } });
      const labelAnim = { in: { type: 'slideRight', dur: 0.45 }, out: { type: 'fade', dur: 0.3 } };
      // Depois de empacotado (packMain, em buildTemplateProject), o clipe B sempre começa
      // em "duração de A − sobreposição da transição" — calculado aqui para o rótulo
      // "DEPOIS" nascer exatamente onde B começa a aparecer.
      p.clips.push(
        textClip(textTrack.id, 0, DUR, labelStyle('ANTES', '#ff5a5a'), labelAnim, { x: -0.25, y: 0.36 }),
        textClip(textTrack.id, DUR - TR, DUR, labelStyle('DEPOIS', '#4ade80'), labelAnim, { x: -0.25, y: 0.36 }),
      );
    },
  },
  {
    id: 'tutorial',
    label: 'Tutorial passo a passo',
    icon: '📝',
    aspect: '16:9',
    desc: 'Título de abertura e um selo numerado (PASSO 1, 2, 3, 4) em cada etapa.',
    slots: [
      { id: 'a', label: 'Passo 1', dur: 5 },
      { id: 'b', label: 'Passo 2', dur: 5 },
      { id: 'c', label: 'Passo 3', dur: 5 },
      { id: 'd', label: 'Passo 4', dur: 5 },
    ],
    build(p, media) {
      const TR = 0.5;
      const { main, clips, starts, total } = mainSequence(p, media, ['a', 'b', 'c', 'd'], [5, 5, 5, 5], [0, TR, TR, TR], ['', 'fade', 'fade', 'fade']);
      clips.forEach((cl) => (cl.color = filterOf('natural')));
      const tt = createTrack(p, 'video', main.id, 'Texto 1');
      p.clips.push(textClip(tt.id, 0, 2.6, { content: 'COMO FAZER', size: 130, letterSpacing: 3, background: { enabled: true, color: '#000000', opacity: 0.55, radius: 12, padding: 28 } }, { in: { type: 'slideUp', dur: 0.6 }, out: { type: 'fade', dur: 0.4 } }, { y: 0 }));
      const badge = { size: 48, color: '#111111', letterSpacing: 2, background: { enabled: true, color: '#ffc72c', opacity: 1, radius: 10, padding: 16 } };
      clips.forEach((cl, i) => {
        // O selo do passo 1 espera o título de abertura sair.
        const at = i === 0 ? 2.6 : starts[i];
        const dur = Math.min(2.5, (i < clips.length - 1 ? starts[i + 1] : total) - at);
        if (dur > 0.5) p.clips.push(textClip(tt.id, at, dur, { ...badge, content: `PASSO ${i + 1}` }, { in: { type: 'slideRight', dur: 0.4 }, out: { type: 'fade', dur: 0.3 } }, { x: -0.36, y: -0.4 }));
      });
    },
  },
  {
    id: 'slideshow',
    label: 'Slideshow de fotos',
    icon: '🖼️',
    aspect: '16:9',
    desc: '5 fotos com zoom lento, dissolver suave, tom quente e fechamento em preto.',
    slots: [
      { id: 'a', label: 'Foto 1', dur: 3.5 },
      { id: 'b', label: 'Foto 2', dur: 3.5 },
      { id: 'c', label: 'Foto 3', dur: 3.5 },
      { id: 'd', label: 'Foto 4', dur: 3.5 },
      { id: 'e', label: 'Foto 5', dur: 3.5 },
    ],
    build(p, media) {
      const TR = 0.9;
      const { main, clips } = mainSequence(p, media, ['a', 'b', 'c', 'd', 'e'], [3.5, 3.5, 3.5, 3.5, 3.5], [0, TR, TR, TR, TR], ['', 'fade', 'fade', 'fade', 'fade']);
      clips.forEach((cl, i) => {
        cl.color = filterOf('warm', 0.8);
        cl.effects = [{ ...newEffect(i % 2 ? 'zoomOutSlow' : 'zoomSlow'), amount: 0.4 }];
      });
      clips[4].effects.push({ ...newEffect('closeBlack'), dur: 1.2 });
      const tt = createTrack(p, 'video', main.id, 'Texto 1');
      p.clips.push(textClip(tt.id, 0.5, 3, { content: 'Nossas memórias', font: 'Dancing Script', size: 130, bold: false, shadow: { enabled: true, color: '#000000', opacity: 0.6, blur: 18, distance: 6, angle: 45 } }, { in: { type: 'fade', dur: 1 }, out: { type: 'fade', dur: 0.8 } }, { y: 0.3 }));
    },
  },
  {
    id: 'product',
    label: 'Oferta de produto',
    icon: '🛍️',
    aspect: '4:5',
    desc: '3 cortes de impacto com selo OFERTA pulsando e chamada no rodapé.',
    slots: [
      { id: 'a', label: 'Produto (visão geral)', dur: 2.5 },
      { id: 'b', label: 'Detalhe', dur: 2.5 },
      { id: 'c', label: 'Em uso', dur: 2.5 },
    ],
    build(p, media) {
      const TR = 0.4;
      const { main, clips, total } = mainSequence(p, media, ['a', 'b', 'c'], [2.5, 2.5, 2.5], [0, TR, TR], ['', 'zoomIn', 'zoomIn']);
      clips.forEach((cl) => (cl.color = filterOf('crisp')));
      clips[1].effects = [{ ...newEffect('punch'), amount: 0.5 }];
      const tt = createTrack(p, 'video', main.id, 'Texto 1');
      p.clips.push(
        textClip(tt.id, 0, total, { content: 'OFERTA', font: 'Anton', size: 120, color: '#ffffff', letterSpacing: 4, background: { enabled: true, color: '#e11d48', opacity: 1, radius: 12, padding: 22 } }, { in: { type: 'pop', dur: 0.4 }, out: { type: 'fade', dur: 0.3 }, loop: { type: 'pulse', period: 1 } }, { y: -0.36 }),
        textClip(tt.id, 0.6, total - 0.6, { content: 'SÓ ESTA SEMANA', size: 62, color: '#111111', background: { enabled: true, color: '#ffc72c', opacity: 1, radius: 10, padding: 18 } }, { in: { type: 'slideUp', dur: 0.4 }, out: { type: 'fade', dur: 0.3 } }, { y: 0.38 }),
      );
    },
  },
  {
    id: 'trailer',
    label: 'Trailer de cinema',
    icon: '🎞️',
    aspect: '16:9',
    desc: 'Faixas de cinema, cor azul-e-laranja, cortes no preto e título "EM BREVE".',
    slots: [
      { id: 'a', label: 'Cena 1', dur: 3 },
      { id: 'b', label: 'Cena 2', dur: 3 },
      { id: 'c', label: 'Cena 3 (final)', dur: 3 },
    ],
    build(p, media) {
      const TR = 0.5;
      const { main, clips, starts, total } = mainSequence(p, media, ['a', 'b', 'c'], [3, 3, 3], [0, TR, TR], ['', 'black', 'black']);
      clips.forEach((cl) => {
        cl.color = filterOf('tealorange');
        cl.effects = [{ ...newEffect('letterbox'), amount: 0.5 }];
      });
      clips[0].effects.push({ ...newEffect('openBlack'), dur: 1 });
      clips[1].effects.push({ ...newEffect('handheld'), amount: 0.25 });
      const tt = createTrack(p, 'video', main.id, 'Texto 1');
      const big = { font: 'Bebas Neue', size: 170, letterSpacing: 18, color: '#f5f5f5' };
      p.clips.push(
        textClip(tt.id, 0.9, 1.8, { ...big, size: 60, content: 'ESTE VERÃO' }, { in: { type: 'fade', dur: 0.6 }, out: { type: 'fade', dur: 0.4 } }, { y: 0 }),
        textClip(tt.id, starts[2] + 0.3, total - starts[2] - 0.3, { ...big, content: 'EM BREVE' }, { in: { type: 'zoomOut', dur: 0.9 }, out: { type: 'fade', dur: 0.6 } }, { y: 0 }),
      );
    },
  },
  {
    id: 'story-tip',
    label: 'Story: dica rápida',
    icon: '💡',
    aspect: '9:16',
    desc: '3 cortes verticais com título "DICA DO DIA" e convite para continuar assistindo.',
    slots: [
      { id: 'a', label: 'Abertura', dur: 2.5 },
      { id: 'b', label: 'A dica', dur: 3 },
      { id: 'c', label: 'Resultado', dur: 2.5 },
    ],
    build(p, media) {
      const TR = 0.35;
      const { main, clips, total } = mainSequence(p, media, ['a', 'b', 'c'], [2.5, 3, 2.5], [0, TR, TR], ['', 'slideU', 'slideU']);
      clips.forEach((cl) => (cl.color = filterOf('bright')));
      const tt = createTrack(p, 'video', main.id, 'Texto 1');
      p.clips.push(
        textClip(tt.id, 0, total, { content: 'DICA DO DIA', font: 'Bebas Neue', size: 150, letterSpacing: 6, color: '#ffffff', stroke: { enabled: true, color: '#000000', width: 8 } }, { in: { type: 'pop', dur: 0.4 }, out: { type: 'fade', dur: 0.3 } }, { y: -0.36 }),
        textClip(tt.id, 0.5, total - 0.5, { content: 'veja até o final', font: 'Poppins', bold: false, size: 54, color: '#ffffff', background: { enabled: true, color: '#000000', opacity: 0.55, radius: 30, padding: 18 } }, { in: { type: 'fade', dur: 0.4 }, out: { type: 'fade', dur: 0.3 }, loop: { type: 'float', period: 2 } }, { y: 0.36 }),
      );
    },
  },
  {
    id: 'retro-vhs',
    label: 'Retrô VHS',
    icon: '📼',
    aspect: '4:3',
    desc: 'Visual de fita antiga: VHS, cor desbotada, "REC" piscando e data no canto.',
    slots: [
      { id: 'a', label: 'Cena 1', dur: 3 },
      { id: 'b', label: 'Cena 2', dur: 3 },
      { id: 'c', label: 'Cena 3', dur: 3 },
    ],
    build(p, media) {
      const TR = 0.3;
      const { main, clips, total } = mainSequence(p, media, ['a', 'b', 'c'], [3, 3, 3], [0, TR, TR], ['', 'blur', 'blur']);
      clips.forEach((cl) => {
        cl.color = filterOf('retro');
        cl.effects = [{ ...newEffect('vhs'), amount: 0.6 }];
      });
      clips[2].effects.push({ ...newEffect('closeFilm'), dur: 0.8 });
      const tt = createTrack(p, 'video', main.id, 'Texto 1');
      const mono = { font: 'Poppins', size: 54, bold: true, color: '#ffffff', align: 'left', letterSpacing: 3, shadow: { enabled: true, color: '#000000', opacity: 0.8, blur: 4, distance: 3, angle: 45 } };
      p.clips.push(
        textClip(tt.id, 0, total, { ...mono, content: '● REC' }, { loop: { type: 'blink', period: 1 } }, { x: -0.3, y: -0.4 }),
        textClip(tt.id, 0, total, { ...mono, size: 42, content: 'OUT 21 2026' }, {}, { x: 0.28, y: 0.4 }),
      );
    },
  },
];

// Monta um projeto do zero a partir de um modelo. "mediaBySlot" é um objeto { slotId: media }.
export function buildTemplateProject(template, mediaBySlot) {
  const [w, h] = ASPECTS[template.aspect];
  const p = {
    name: template.label,
    settings: { aspect: template.aspect, width: w, height: h, fps: 30, background: '#000000', magnet: true, snap: true },
    tracks: [{ id: uid('t'), kind: 'video', name: 'Principal', main: true, hidden: false, muted: false, locked: false }],
    clips: [],
  };
  template.build(p, mediaBySlot);
  normalize(p);
  return p;
}

// Substitui o projeto atual pelo modelo pronto. A biblioteca de mídia já importada
// continua disponível (só a linha do tempo muda).
export async function applyTemplate(template, mediaBySlot) {
  const s = useStore.getState();
  if (s.project.clips.length && !(await askConfirm({ title: 'Aplicar este modelo?', message: 'A linha do tempo atual será substituída pelo modelo. A mídia já importada continua disponível.', ok: 'Aplicar modelo' }))) return;
  const project = buildTemplateProject(template, mediaBySlot);
  useStore.setState({ project, dirty: true, past: [], future: [], selection: [], currentTime: 0 });
  s.notify(`Modelo "${template.label}" aplicado — troque qualquer clipe ou texto como preferir.`);
}
