import { withStyle, withAnim } from './text';
import { engine } from './engine';
import { saveToLibrary, projectData, cancelAutosave } from './library';
import { newEffect } from './effects';
import { sourceAt, subCurve } from './speed';
import { beatTimes } from './audioPro';
import { splitKeyframes, scaleKeyframes, transformAt, setKeyframe, valueAt, TRANSFORM_PROPS } from './keyframes';
import { useStore, uid, clipDur, clipEnd, projectDuration, packMain, DEFAULT_TRANSFORM, getMedia, newProject, ASPECTS, croppedSize } from './store';

const EPS = 1e-4;
export const trackKindFor = (media) => (media.type === 'audio' ? 'audio' : 'video');
export const IMAGE_DEFAULT_DURATION = 5;
export const TEXT_DEFAULT_DURATION = 4;

export function isFree(p, trackId, start, end, exclude = new Set()) {
  return !p.clips.some((c) => c.trackId === trackId && !exclude.has(c.id) && c.start < end - EPS && clipEnd(c) > start + EPS);
}

// Cria uma trilha nova: vídeo/sobreposição acima da principal, áudio no final.
export function createTrack(p, kind, nearTrackId, name) {
  const count = p.tracks.filter((t) => t.kind === kind).length;
  const track = { id: uid('t'), kind, name: name || (kind === 'video' ? `Sobreposição ${count}` : `Áudio ${count + 1}`), main: false, hidden: false, muted: false, locked: false };
  if (kind === 'video') {
    const near = p.tracks.findIndex((t) => t.id === nearTrackId);
    const idx = near >= 0 && p.tracks[near].kind === 'video' ? near : p.tracks.findIndex((t) => t.main);
    p.tracks.splice(Math.max(0, idx), 0, track);
  } else {
    p.tracks.push(track);
  }
  return track;
}

// Garante que o clipe não sobreponha outro: tenta a trilha atual, depois as outras do mesmo tipo, senão cria uma.
export function placeClip(p, clip, exclude = new Set([clip.id])) {
  const track = p.tracks.find((t) => t.id === clip.trackId);
  const kind = track.kind;
  const isText = clip.kind === 'text' || clip.kind === 'effect';
  if (track.main && p.settings.magnet && !isText) return;
  const s = clip.start;
  const e = clipEnd(clip);
  // Textos nunca ficam na trilha principal.
  if (!(isText && track.main) && isFree(p, track.id, s, e, exclude)) return;
  const candidates = p.tracks.filter((t) => t.kind === kind && !t.main && !t.locked && t.id !== track.id);
  const free = candidates.find((t) => isFree(p, t.id, s, e, exclude));
  clip.trackId = free ? free.id : createTrack(p, kind, track.id, isText ? nextTextTrackName(p, clip) : undefined).id;
}

// Nome da nova trilha de textos ("Texto N") ou de efeitos ("Efeito N").
export const nextTextTrackName = (p, clip) => {
  const base = clip?.kind === 'effect' ? 'Efeito' : 'Texto';
  return `${base} ${p.tracks.filter((t) => t.name.startsWith(base)).length + 1}`;
};

// Adiciona um estilo ou modelo de texto no cursor. Modelos podem ter vários textos.
export function addTextPreset(preset) {
  const { commit, currentTime } = useStore.getState();
  const ids = [];
  commit((p) => {
    const main = p.tracks.find((t) => t.main);
    for (const spec of preset.clips) {
      const clip = {
        id: uid('c'),
        kind: 'text',
        trackId: main.id,
        start: currentTime,
        in: 0,
        out: TEXT_DEFAULT_DURATION,
        speed: 1,
        text: withStyle(spec.style),
        anim: withAnim(spec.anim),
        transform: { ...DEFAULT_TRANSFORM, ...spec.transform },
      };
      p.clips.push(clip);
      placeClip(p, clip);
      ids.push(clip.id);
    }
  });
  useStore.setState({ selection: ids.slice(0, 1) });
}

export function makeClip(media, trackId, start) {
  const duration = media.type === 'image' ? IMAGE_DEFAULT_DURATION : media.duration;
  return {
    id: uid('c'),
    mediaId: media.id,
    trackId,
    start,
    in: 0,
    out: duration,
    speed: 1,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
  };
}

// Adiciona uma mídia na linha do tempo (botão "+" ou arrastar).
export function addMediaToTimeline(media, opts = {}) {
  const { commit, currentTime } = useStore.getState();
  let newId = null;
  commit((p) => {
    const kind = trackKindFor(media);
    let track = opts.trackId && p.tracks.find((t) => t.id === opts.trackId && t.kind === kind && !t.locked);
    if (!track && opts.newTrack) track = createTrack(p, kind, opts.nearTrackId);
    if (!track) track = kind === 'video' ? p.tracks.find((t) => t.main) : p.tracks.find((t) => t.kind === 'audio' && !t.locked) || createTrack(p, 'audio');
    let start = opts.start;
    if (start === undefined) {
      start = track.main ? p.clips.filter((c) => c.trackId === track.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0) : currentTime;
    }
    const clip = makeClip(media, track.id, Math.max(0, start));
    p.clips.push(clip);
    if (track.main && p.settings.magnet) {
      packMain(p, insertionOrder(p, clip.id, clip.start));
    } else {
      placeClip(p, clip);
    }
    newId = clip.id;
  });
  if (newId) useStore.setState({ selection: [newId] });
}

// Ordem na trilha principal quando clipes são soltos: o clipe movido entra antes
// do clipe cujo meio fica depois do ponto onde foi solto.
export function insertionOrder(p, ids, time) {
  const moved = ids instanceof Set ? ids : new Set([ids]);
  return (a, b) => {
    const key = (c) => (moved.has(c.id) ? (time !== undefined && !(ids instanceof Set) ? time : c.start) : c.start + clipDur(c) / 2);
    return key(a) - key(b);
  };
}

export function splitAtPlayhead() {
  const { project, selection, currentTime: t, commit, notify } = useStore.getState();
  const locked = new Set(project.tracks.filter((tr) => tr.locked).map((tr) => tr.id));
  const under = project.clips.filter((c) => !locked.has(c.trackId) && c.start + 0.02 < t && clipEnd(c) - 0.02 > t);
  const targets = selection.length ? under.filter((c) => selection.includes(c.id)) : under;
  if (!targets.length) {
    notify('Posicione o cursor sobre um clipe para dividir.');
    return;
  }
  const newIds = [];
  commit((p) => {
    for (const ref of targets) newIds.push(splitClipAt(p, p.clips.find((x) => x.id === ref.id), t).id);
  });
  useStore.setState({ selection: newIds });
}

// Divide o clipe no instante t da linha do tempo; devolve a metade da direita.
function splitClipAt(p, c, t) {
  const cut = sourceAt(c, t - c.start);
  const right = { ...structuredClone(c), id: uid('c'), start: t, in: cut };
  // Com curva de velocidade, cada metade fica com o seu pedaço da curva.
  if (c.curve) {
    const u = (t - c.start) / clipDur(c);
    right.curve = subCurve(c.curve, u, 1);
    c.curve = subCurve(c.curve, 0, u);
  }
  splitKeyframes(c, right, t - c.start);
  c.out = cut;
  p.clips.push(right);
  return right;
}

// Depois de um clipe crescer, empurra os seguintes da mesma trilha para não ficarem por cima.
export function rippleAfter(p, clip, oldEnd) {
  const delta = clipEnd(clip) - oldEnd;
  if (delta <= 1e-6) return;
  for (const x of p.clips) if (x.id !== clip.id && x.trackId === clip.trackId && x.start >= oldEnd - 1e-3) x.start += delta;
}

// Muda a velocidade (constante ou curva). phase segue o padrão dos sliders (start/live/end/set).
export function setClipSpeed(clipId, patch, phase = 'set') {
  const s = useStore.getState();
  const apply = (p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (!c) return;
    const oldEnd = clipEnd(c);
    const oldDur = clipDur(c);
    if ('speed' in patch) c.speed = patch.speed;
    if ('curve' in patch) {
      if (patch.curve) c.curve = patch.curve;
      else delete c.curve;
    }
    if ('keepPitch' in patch) c.keepPitch = patch.keepPitch;
    scaleKeyframes(c, clipDur(c) / oldDur);
    rippleAfter(p, c, oldEnd);
  };
  if (phase === 'start') s.gestureStart();
  else if (phase === 'live') s.live(apply);
  else if (phase === 'end') s.gestureEnd();
  else s.commit(apply);
}

const findMediaByPath = (path) => useStore.getState().media.find((m) => m.path.toLowerCase() === path.toLowerCase());
async function mediaForPath(path) {
  return findMediaByPath(path) || (await importPaths([path]))[0] || findMediaByPath(path);
}

// Congelar quadro: divide o vídeo na barra branca e insere uma imagem parada daquele quadro.
export async function freezeFrame(seconds = 3) {
  const s = useStore.getState();
  const t = s.currentTime;
  const mediaById = new Map(s.media.map((m) => [m.id, m]));
  const order = new Map(s.project.tracks.map((tr, i) => [tr.id, i]));
  const under = s.project.clips
    .filter((c) => {
      const tr = s.project.tracks.find((x) => x.id === c.trackId);
      return !c.kind && tr?.kind === 'video' && !tr.locked && mediaById.get(c.mediaId)?.type === 'video' && t >= c.start && t < clipEnd(c);
    })
    .sort((a, b) => order.get(a.trackId) - order.get(b.trackId));
  const clip = under.find((c) => s.selection.includes(c.id)) || under[0];
  if (!clip) {
    s.notify('Posicione a barra branca sobre um vídeo para congelar o quadro.');
    return;
  }
  const m = mediaById.get(clip.mediaId);
  try {
    const img = await mediaForPath(await window.api.extractFrame(m.path, sourceAt(clip, t - clip.start)));
    if (!img) return;
    let freezeId = null;
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      if (t > c.start + 0.02 && t < clipEnd(c) - 0.02) splitClipAt(p, c, t);
      for (const x of p.clips) if (x.trackId === c.trackId && x.start >= t - 1e-3) x.start += seconds;
      const freeze = {
        id: uid('c'),
        mediaId: img.id,
        trackId: c.trackId,
        start: t,
        in: 0,
        out: seconds,
        speed: 1,
        volume: 1,
        transform: { ...DEFAULT_TRANSFORM, ...c.transform, ...transformAt(c, t - c.start) },
        ...(c.crop ? { crop: structuredClone(c.crop) } : {}),
      };
      p.clips.push(freeze);
      freezeId = freeze.id;
    });
    useStore.setState({ selection: freezeId ? [freezeId] : [] });
    useStore.getState().notify(`Quadro congelado por ${seconds} s.`);
  } catch (err) {
    useStore.getState().notify('Não foi possível congelar o quadro: ' + cleanError(err), 'error');
  }
}

// Reverso: troca o trecho do clipe por uma versão de trás para frente (gerada pelo FFmpeg).
// Num clipe já invertido, desfaz e volta ao vídeo original.
export async function reverseClip(clipId) {
  const s = useStore.getState();
  const c = s.project.clips.find((x) => x.id === clipId);
  const m = c && s.media.find((x) => x.id === c.mediaId);
  if (!c || !m || c.kind || m.type === 'image') return;
  if (c.reversedFrom) {
    s.commit((p) => {
      const x = p.clips.find((y) => y.id === clipId);
      const o = x.reversedFrom;
      // No arquivo invertido, o instante r corresponde a (fim original - r) no vídeo original.
      const inside = { in: Math.max(0, o.out - x.out), out: o.out - x.in };
      x.mediaId = o.mediaId;
      x.in = inside.in;
      x.out = inside.out;
      delete x.reversedFrom;
    });
    s.notify('O clipe voltou a tocar para frente.');
    return;
  }
  useStore.setState({ busy: { label: 'Invertendo o vídeo…', progress: 0 } });
  const off = window.api.onReverseProgress((v) => useStore.setState({ busy: { label: 'Invertendo o vídeo…', progress: v } }));
  try {
    const rm = await mediaForPath(await window.api.reverseMedia(m.path, c.in, c.out, m.hasAudio));
    if (!rm) throw new Error('arquivo invertido não pôde ser lido');
    useStore.getState().commit((p) => {
      const x = p.clips.find((y) => y.id === clipId);
      x.reversedFrom = { mediaId: m.id, in: x.in, out: x.out };
      x.mediaId = rm.id;
      const len = x.out - x.in;
      x.in = 0;
      x.out = Math.min(rm.duration, len);
    });
    useStore.getState().notify('Clipe invertido: agora ele toca de trás para frente.');
  } catch (err) {
    useStore.getState().notify('Não foi possível inverter: ' + cleanError(err), 'error');
  } finally {
    off();
    useStore.setState({ busy: null });
  }
}

export function deleteSelection() {
  const { selection, project, commit } = useStore.getState();
  const locked = new Set(project.tracks.filter((t) => t.locked).map((t) => t.id));
  const ids = new Set(selection.filter((id) => !locked.has(project.clips.find((c) => c.id === id)?.trackId)));
  if (!ids.size) return;
  commit((p) => {
    p.clips = p.clips.filter((c) => !ids.has(c.id));
  });
  useStore.setState({ selection: [] });
  useStore.getState().notify(ids.size === 1 ? 'Clipe excluído' : `${ids.size} clipes excluídos`, 'info', { label: 'Desfazer', run: () => useStore.getState().undo() });
}

export function duplicateSelection() {
  const { selection, commit } = useStore.getState();
  if (!selection.length) return;
  const newIds = [];
  commit((p) => {
    for (const id of selection) {
      const c = p.clips.find((x) => x.id === id);
      if (!c) continue;
      const copy = { ...structuredClone(c), id: uid('c'), start: clipEnd(c) };
      p.clips.push(copy);
      const track = p.tracks.find((t) => t.id === c.trackId);
      if (track.main && p.settings.magnet) packMain(p, insertionOrder(p, copy.id, clipEnd(c) + 1e-3));
      else placeClip(p, copy);
      newIds.push(copy.id);
    }
  });
  useStore.setState({ selection: newIds });
}

export function copySelection() {
  const { selection, project } = useStore.getState();
  const clips = project.clips.filter((c) => selection.includes(c.id));
  if (clips.length) useStore.setState({ clipboard: structuredClone(clips) });
}

export function paste() {
  const { clipboard, currentTime, commit } = useStore.getState();
  if (!clipboard?.length) return;
  const first = Math.min(...clipboard.map((c) => c.start));
  const newIds = [];
  commit((p) => {
    for (const src of clipboard) {
      const copy = { ...structuredClone(src), id: uid('c'), start: currentTime + (src.start - first) };
      if (!p.tracks.some((t) => t.id === copy.trackId)) copy.trackId = p.tracks.find((t) => t.main).id;
      const track = p.tracks.find((t) => t.id === copy.trackId);
      if (track.main && p.settings.magnet) {
        copy.trackId = createTrack(p, 'video', track.id).id;
      }
      p.clips.push(copy);
      placeClip(p, copy);
      newIds.push(copy.id);
    }
  });
  useStore.setState({ selection: newIds });
}

// Muda entre horizontal (16:9) e vertical (9:16).
// mode 'fill': os clipes da trilha principal crescem para cobrir a tela vertical
// (a posição/escala anterior é guardada e volta ao retornar para horizontal).
export function setOrientation(orientation, mode = 'fill') {
  const { commit, media } = useStore.getState();
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const aspect = orientation === 'vertical' ? '9:16' : '16:9';
  const [W, H] = ASPECTS[aspect];
  commit((p) => {
    p.settings.aspect = aspect;
    p.settings.width = W;
    p.settings.height = H;
    const main = p.tracks.find((t) => t.main);
    for (const c of p.clips) {
      const m = mediaById.get(c.mediaId);
      if (!m || m.type === 'audio' || !m.width) continue;
      if (orientation === 'horizontal') {
        if (c.preVertical) {
          c.transform = c.preVertical.transform;
          delete c.preVertical;
        }
        continue;
      }
      if (mode !== 'fill' || c.trackId !== main?.id) continue;
      if (!c.preVertical) c.preVertical = { transform: { ...DEFAULT_TRANSFORM, ...c.transform } };
      const { width: mw, height: mh } = croppedSize(m, c);
      const cover = Math.max(W / mw, H / mh) / Math.min(W / mw, H / mh);
      c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, scale: cover, x: 0, y: 0 };
    }
  });
}

// Separa o som de um vídeo num clipe próprio na trilha de áudio (o vídeo fica mudo).
export function detachAudio(clipId) {
  const { commit } = useStore.getState();
  let newId = null;
  commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (!c || c.audioDetached) return;
    const track = p.tracks.find((t) => t.kind === 'audio' && !t.locked && isFree(p, t.id, c.start, clipEnd(c))) || createTrack(p, 'audio');
    const a = {
      id: uid('c'),
      mediaId: c.mediaId,
      trackId: track.id,
      start: c.start,
      in: c.in,
      out: c.out,
      speed: c.speed || 1,
      curve: c.curve ? structuredClone(c.curve) : undefined,
      keepPitch: c.keepPitch,
      volume: c.volume ?? 1,
      audio: c.audio ? structuredClone(c.audio) : undefined,
      transform: { ...DEFAULT_TRANSFORM },
    };
    c.audioDetached = true;
    p.clips.push(a);
    newId = a.id;
  });
  if (newId) {
    useStore.setState({ selection: [newId] });
    useStore.getState().notify('Áudio separado: agora ele é um clipe na trilha de áudio.');
  }
}

// Coloca uma narração gravada na linha do tempo, numa trilha "Narração".
export async function addRecording(path, start) {
  const [media] = await importPaths([path]);
  if (!media) return;
  const { commit } = useStore.getState();
  let id = null;
  commit((p) => {
    const dur = media.duration;
    const track =
      p.tracks.find((t) => t.kind === 'audio' && t.name.startsWith('Narração') && !t.locked && isFree(p, t.id, start, start + dur)) ||
      createTrack(p, 'audio', undefined, `Narração ${p.tracks.filter((t) => t.name.startsWith('Narração')).length + 1}`);
    const clip = makeClip(media, track.id, start);
    p.clips.push(clip);
    id = clip.id;
  });
  useStore.setState({ selection: id ? [id] : [] });
}

// Transição no começo de um clipe da trilha principal (entre ele e o clipe anterior).
// type = null remove. Com o ímã ligado a trilha se reorganiza sozinha; sem ímã, o clipe e
// os seguintes são puxados para sobrepor o anterior pela duração da transição.
export function setTransition(clipId, type, dur) {
  const s = useStore.getState();
  const c0 = s.project.clips.find((x) => x.id === clipId);
  const main = s.project.tracks.find((t) => t.main);
  if (!c0 || c0.trackId !== main?.id || c0.kind) {
    s.notify('Transições ficam entre dois clipes da trilha principal. Selecione o segundo clipe.');
    return false;
  }
  const before = s.project.clips.filter((x) => x.trackId === main.id && x.start < c0.start - 1e-3);
  if (!before.length) {
    s.notify('O primeiro clipe não tem um clipe antes dele para fazer a transição.');
    return false;
  }
  s.commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    const oldOverlap = c.transition?.dur || 0;
    if (type) c.transition = { type, dur: dur ?? c.transition?.dur ?? 0.6 };
    else delete c.transition;
    if (!p.settings.magnet) {
      const delta = (c.transition?.dur || 0) - oldOverlap;
      for (const x of p.clips) if (x.trackId === c.trackId && x.start >= c.start - 1e-3) x.start = Math.max(0, x.start - delta);
    }
  });
  return true;
}

// Mesma transição em todos os cortes da trilha principal.
export function setTransitionAll(type, dur) {
  const s = useStore.getState();
  const main = s.project.tracks.find((t) => t.main);
  s.commit((p) => {
    const clips = p.clips.filter((x) => x.trackId === main.id && !x.kind).sort((a, b) => a.start - b.start);
    clips.forEach((c, i) => {
      if (i === 0) return;
      if (type) c.transition = { type, dur };
      else delete c.transition;
    });
  });
}

// Marca keyframe em todas as propriedades do clipe selecionado, no instante da barra branca.
export function addKeyframesHere() {
  const s = useStore.getState();
  const ids = s.selection.filter((id) => {
    const c = s.project.clips.find((x) => x.id === id);
    return c && s.currentTime >= c.start - 1e-6 && s.currentTime <= clipEnd(c) + 1e-6;
  });
  if (!ids.length) {
    s.notify('Selecione um clipe e coloque a barra branca sobre ele.');
    return;
  }
  const tol = 0.5 / s.project.settings.fps;
  s.commit((p) => {
    for (const id of ids) {
      const c = p.clips.find((x) => x.id === id);
      const m = useStore.getState().media.find((x) => x.id === c.mediaId);
      const local = s.currentTime - c.start;
      const track = p.tracks.find((t) => t.id === c.trackId);
      const visual = c.kind === 'text' || (m && m.type !== 'audio' && track.kind === 'video');
      const props = [...(visual ? TRANSFORM_PROPS : []), ...(m?.hasAudio && !c.audioDetached ? ['volume'] : [])];
      for (const prop of props) setKeyframe(c, prop, local, valueAt(c, prop, local), tol);
    }
  });
  s.notify('Keyframe adicionado. Mude a posição, o tamanho ou outro valor em outro instante para animar.');
}

// Abre a janela de recorte para o clipe visual selecionado.
export function openCrop() {
  const { selection, project, media, notify } = useStore.getState();
  const clip = selection.length === 1 && project.clips.find((c) => c.id === selection[0]);
  const m = clip && media.find((x) => x.id === clip.mediaId);
  if (!clip || !m || m.type === 'audio') {
    notify('Selecione um vídeo ou imagem para recortar.');
    return;
  }
  if (m.missing) return;
  if (project.tracks.find((t) => t.id === clip.trackId)?.locked) {
    notify('A trilha deste clipe está bloqueada.');
    return;
  }
  useStore.setState({ cropClipId: clip.id });
}

export function seek(t) {
  const p = useStore.getState().project;
  const total = projectDuration(p);
  useStore.setState({ currentTime: Math.max(0, Math.min(t, total)) });
}

// ---------- Importação ----------

export async function importPaths(paths) {
  const { notify } = useStore.getState();
  const existing = new Set(useStore.getState().media.map((m) => m.path.toLowerCase()));
  const fresh = paths.filter((p) => !existing.has(p.toLowerCase()));
  const added = [];
  for (const path of fresh) {
    try {
      const info = await window.api.probe(path);
      const media = { id: uid('m'), ...info };
      useStore.setState((s) => ({ media: [...s.media, media] }));
      loadMediaCache(media);
      added.push(media);
    } catch (err) {
      notify(`Não foi possível importar ${path.split(/[\\/]/).pop()}: ${cleanError(err)}`, 'error');
    }
  }
  if (added.length) useStore.setState({ dirty: true });
  return added;
}

export async function importDialog() {
  const paths = await window.api.openMedia();
  if (paths.length) await importPaths(paths);
}

export async function importDroppedFiles(fileList) {
  const paths = [...fileList].map((f) => window.api.pathForFile(f)).filter(Boolean);
  const ok = await window.api.allowPaths(paths);
  if (ok.length < paths.length) useStore.getState().notify('Alguns arquivos foram ignorados (formato não suportado).');
  return ok.length ? importPaths(ok) : [];
}

// Acima desse lado maior (em px) o vídeo ganha proxy de prévia.
export const PROXY_MIN_SIDE = 1920;

function setCache(id, patch) {
  useStore.setState((s) => ({ cache: { ...s.cache, [id]: { ...s.cache[id], ...patch } } }));
}

export function loadMediaCache(media) {
  if (media.missing) return;
  if (media.type !== 'audio') {
    window.api.thumbnails(media.path, media.duration, media.type).then((thumbs) => setCache(media.id, { thumbs })).catch(() => {});
  }
  if (media.hasAudio) {
    window.api.waveform(media.path, media.duration).then((wave) => setCache(media.id, { wave })).catch(() => {});
  }
  // Vídeo grande (2K/4K): o player usa uma cópia leve gerada em segundo plano; a exportação usa o original.
  if (media.type === 'video' && Math.max(media.width, media.height) > PROXY_MIN_SIDE) {
    setCache(media.id, { proxyState: 'working' });
    window.api
      .previewProxy(media.path, media.hasAudio)
      .then((proxy) => setCache(media.id, { proxy, proxyState: 'ready' }))
      .catch(() => setCache(media.id, { proxyState: 'failed' }));
  }
}

export function removeMedia(id) {
  const { project, commit } = useStore.getState();
  if (project.clips.some((c) => c.mediaId === id)) {
    commit((p) => {
      p.clips = p.clips.filter((c) => c.mediaId !== id);
    });
  }
  useStore.setState((s) => ({ media: s.media.filter((m) => m.id !== id), dirty: true }));
}

export const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------- Projeto ----------

export async function saveProject(saveAs = false) {
  const s = useStore.getState();
  try {
    if (saveAs) {
      // "Salvar uma cópia": grava onde o usuário escolher, sem trocar o projeto da biblioteca.
      const target = await window.api.saveProject({ data: projectData(s), filePath: null, saveAs: true });
      if (target) s.notify('Cópia do projeto salva.');
      return !!target;
    }
    const ok = await saveToLibrary();
    s.notify(ok ? 'Projeto salvo.' : 'Adicione mídia ao projeto para salvá-lo.');
    return ok;
  } catch (err) {
    s.notify('Erro ao salvar: ' + cleanError(err), 'error');
    return false;
  }
}

// Guarda o projeto aberto (se mudou) antes de trocar de projeto ou voltar para a tela inicial.
async function flushCurrent() {
  cancelAutosave();
  const s = useStore.getState();
  if (s.view === 'editor' && s.dirty && s.filePath) {
    try {
      await saveToLibrary();
    } catch (err) {
      s.notify('Não foi possível salvar o projeto: ' + cleanError(err), 'error');
    }
  }
}

// Abre um projeto da biblioteca no editor.
export async function openLibraryProject(file) {
  const s = useStore.getState();
  await flushCurrent();
  try {
    const { filePath, data } = await window.api.libraryOpen(file);
    const { media, app, version, ...project } = data;
    useStore.setState({ project, media, filePath, dirty: false, past: [], future: [], selection: [], currentTime: 0, cache: {}, view: 'editor' });
    media.forEach(loadMediaCache);
    const missing = media.filter((m) => m.missing).length;
    if (missing) useStore.getState().notify(`${missing} arquivo(s) de mídia não foram encontrados no local original.`, 'error');
  } catch (err) {
    s.notify('Erro ao abrir: ' + cleanError(err), 'error');
  }
}

// Abrir um .vedit de qualquer pasta (entra na biblioteca como cópia).
export async function openProject() {
  try {
    const file = await window.api.libraryImport();
    if (file) await openLibraryProject(file);
  } catch (err) {
    useStore.getState().notify('Erro ao abrir: ' + cleanError(err), 'error');
  }
}

// Novo projeto vazio (já com o arquivo reservado na biblioteca) e abre o editor.
export async function createProject({ aspect = '16:9', name } = {}) {
  await flushCurrent();
  const [width, height] = ASPECTS[aspect] || ASPECTS['16:9'];
  const project = newProject();
  project.settings = { ...project.settings, aspect, width, height };
  if (name) project.name = name;
  const filePath = await window.api.libraryNewFile();
  useStore.setState({ project, media: [], cache: {}, filePath, dirty: false, past: [], future: [], selection: [], currentTime: 0, view: 'editor' });
}

// Arrastar vídeos, fotos ou músicas para a tela de projetos: cria um projeto já com tudo na linha do tempo,
// no formato do primeiro vídeo (vertical, quadrado ou horizontal).
export async function createProjectFromFiles(fileList) {
  await createProject();
  fillProject(await importDroppedFiles(fileList));
}

export function fillProject(added) {
  if (!added.length) return;
  const first = added.find((m) => m.type !== 'audio' && m.width && m.height);
  if (first) {
    const r = first.width / first.height;
    const aspect = r < 0.9 ? '9:16' : r < 1.1 ? '1:1' : '16:9';
    const [width, height] = ASPECTS[aspect];
    useStore.getState().commit((p) => Object.assign(p.settings, { aspect, width, height }));
  }
  for (const m of added) addMediaToTimeline(m, {});
  useStore.setState({ currentTime: 0 });
  useStore.getState().notify(`Projeto criado com ${added.length} ${added.length === 1 ? 'arquivo' : 'arquivos'}.`);
}

export function newProjectAction() {
  return createProject();
}

// Volta para a tela de projetos (salva o que mudou antes).
export async function goHome() {
  engine.pause();
  await flushCurrent();
  useStore.setState({ view: 'home' });
}

export function getClipMedia(clip) {
  return getMedia(clip.mediaId);
}

// ---------- efeitos, espelhar, estabilizar, adesivos (etapa 7b) ----------

// Efeito no clipe selecionado (um de cada tipo; clicar de novo no mesmo tira).
export function toggleEffect(clipId, type) {
  const s = useStore.getState();
  const c = s.project.clips.find((x) => x.id === clipId);
  if (!c || c.kind === 'text') return;
  const has = (c.effects || []).some((e) => e.type === type);
  s.commit((p) => {
    const x = p.clips.find((y) => y.id === clipId);
    const list = (x.effects || []).filter((e) => e.type !== type);
    if (!has) list.push(newEffect(type));
    if (list.length) x.effects = list;
    else delete x.effects;
  });
}

// Trilha de efeito: um clipe de efeito no cursor, numa trilha "Efeito N" acima de tudo.
// Vale para todos os vídeos e imagens das trilhas abaixo dele (src/effects.js trackEffectsFor).
export const EFFECT_CLIP_DURATION = 3;
export function addEffectClip(type) {
  const { commit, currentTime } = useStore.getState();
  let id;
  commit((p) => {
    const top = p.tracks[0];
    const clip = { id: uid('c'), kind: 'effect', fx: newEffect(type), trackId: top.id, start: currentTime, in: 0, out: EFFECT_CLIP_DURATION, speed: 1 };
    p.clips.push(clip);
    const free = p.tracks.find((t) => t.kind === 'video' && !t.main && !t.locked && t.name.startsWith('Efeito') && isFree(p, t.id, clip.start, clipEnd(clip)));
    clip.trackId = free ? free.id : createTrack(p, 'video', top.id, nextTextTrackName(p, clip)).id;
    id = clip.id;
  });
  useStore.setState({ selection: [id] });
}

// Troca o efeito de um clipe de efeito (mantém intensidade e velocidade).
export function setEffectClipType(clipId, type) {
  useStore.getState().commit((p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (c?.kind === 'effect') c.fx = { ...newEffect(type), amount: c.fx?.amount ?? 0.5, speed: c.fx?.speed ?? 1 };
  });
}

export function applyEffectsToAll(clipId) {
  const s = useStore.getState();
  const c = s.project.clips.find((x) => x.id === clipId);
  if (!c?.effects?.length) return;
  const main = s.project.tracks.find((t) => t.main);
  s.commit((p) => {
    for (const x of p.clips) if (x.trackId === main.id && !x.kind) x.effects = c.effects.map((e) => ({ ...e }));
  });
  s.notify('Efeitos aplicados em todos os clipes da trilha principal.');
}

export function toggleFlip(clipId, axis) {
  useStore.getState().commit((p) => {
    const x = p.clips.find((y) => y.id === clipId);
    const k = axis === 'v' ? 'flipV' : 'flipH';
    if (x[k]) delete x[k];
    else x[k] = true;
  });
}

// Estabilizar: troca o trecho por uma versão estabilizada (FFmpeg vid.stab). level = low|medium|high|null.
export async function stabilizeClip(clipId, level) {
  const s = useStore.getState();
  let c = s.project.clips.find((x) => x.id === clipId);
  if (!c || c.kind) return;
  // Já estabilizado: volta ao original primeiro (o arquivo estabilizado começa no "in" antigo).
  if (c.stabilizedFrom) {
    s.commit((p) => {
      const x = p.clips.find((y) => y.id === clipId);
      const o = x.stabilizedFrom;
      x.mediaId = o.mediaId;
      x.in = o.in + x.in;
      x.out = o.in + x.out;
      delete x.stabilizedFrom;
    });
    if (!level) {
      s.notify('Estabilização removida.');
      return;
    }
    c = useStore.getState().project.clips.find((x) => x.id === clipId);
  }
  if (!level) return;
  const m = s.media.find((x) => x.id === c.mediaId);
  if (!m || m.type !== 'video') return;
  const label = 'Estabilizando o vídeo… (pode levar um tempo)';
  useStore.setState({ busy: { label, progress: 0 } });
  const off = window.api.onStabilizeProgress((v) => useStore.setState({ busy: { label, progress: v } }));
  try {
    const sm = await mediaForPath(await window.api.stabilizeMedia(m.path, c.in, c.out, m.hasAudio, level));
    if (!sm) throw new Error('arquivo estabilizado não pôde ser lido');
    useStore.getState().commit((p) => {
      const x = p.clips.find((y) => y.id === clipId);
      x.stabilizedFrom = { mediaId: m.id, in: x.in, level };
      x.mediaId = sm.id;
      const len = x.out - x.in;
      x.in = 0;
      x.out = Math.min(sm.duration, len);
    });
    useStore.getState().notify('Vídeo estabilizado.');
  } catch (err) {
    useStore.getState().notify('Não foi possível estabilizar: ' + cleanError(err), 'error');
  } finally {
    off();
    useStore.setState({ busy: null });
  }
}

// Adesivo: um emoji grande desenhado pelo mesmo motor dos textos (sai igual na exportação).
export function addSticker(emoji, loop = 'none') {
  const { commit, currentTime } = useStore.getState();
  let id;
  commit((p) => {
    const main = p.tracks.find((t) => t.main);
    const clip = {
      id: uid('c'),
      kind: 'text',
      sticker: true,
      trackId: main.id,
      start: currentTime,
      in: 0,
      out: TEXT_DEFAULT_DURATION,
      speed: 1,
      text: withStyle({ content: emoji, size: 260, bold: false, font: 'Montserrat' }),
      anim: withAnim({ in: { type: 'pop', dur: 0.4 }, loop: { type: loop, period: 1.2 } }),
      transform: { ...DEFAULT_TRANSFORM },
    };
    p.clips.push(clip);
    placeClip(p, clip);
    id = clip.id;
  });
  useStore.setState({ selection: [id] });
}

// Ajusta o tamanho dos clipes da trilha principal para as trocas caírem nas batidas da música.
// "every" = a cada quantas batidas troca de clipe. Só aparam o final do clipe (nunca esticam o vídeo).
export function cutToBeats(musicId, every = 1) {
  const { project, media, cache, commit, notify } = useStore.getState();
  const music = project.clips.find((c) => c.id === musicId);
  const wave = music && cache[music.mediaId]?.wave;
  const beats = music ? beatTimes(music, wave).filter((t) => t >= music.start - 1e-6) : [];
  if (beats.length < 2) {
    notify('Ative as marcas de batida nesta música primeiro.');
    return 0;
  }
  const main = project.tracks.find((t) => t.main);
  const ids = project.clips.filter((c) => main && c.trackId === main.id && !c.kind).sort((a, b) => a.start - b.start).map((c) => c.id);
  if (!ids.length) {
    notify('Coloque vídeos ou fotos na trilha principal.');
    return 0;
  }
  const interval = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  let changed = 0;
  commit((p) => {
    let prevEnd = 0;
    let kPrev = -1;
    let first = true;
    for (const id of ids) {
      const c = p.clips.find((x) => x.id === id);
      const m = media.find((x) => x.id === c.mediaId);
      const d = !first && c.transition ? Math.min(c.transition.dur, 99) : 0;
      const startPos = prevEnd - d;
      let k;
      if (first) k = beats.findIndex((t) => t >= 0.75 * every * interval);
      else k = kPrev + every;
      first = false;
      const speed = c.speed || 1;
      const avail = !m || m.type === 'image' ? Infinity : (m.duration - c.in) / speed;
      // Se o arquivo é curto demais, usa uma batida mais cedo.
      while (k >= 0 && k < beats.length && beats[k] - startPos > avail + 1e-6) k -= 1;
      if (c.curve || k < 0 || k >= beats.length || beats[k] - startPos < 0.15) {
        // Não dá para encaixar: mantém o clipe e recomeça a contagem a partir dele.
        prevEnd = clipEnd({ ...c, start: startPos });
        kPrev = beats.reduce((best, t, i) => (Math.abs(t - prevEnd) < Math.abs(beats[best] - prevEnd) ? i : best), 0);
        continue;
      }
      const len = beats[k] - startPos;
      c.out = +(c.in + len * speed).toFixed(4);
      prevEnd = beats[k];
      kPrev = k;
      changed++;
    }
    packMain(p);
  });
  notify(changed ? `${changed} clipe${changed > 1 ? 's' : ''} ajustado${changed > 1 ? 's' : ''} às batidas.` : 'Nenhum clipe pôde ser ajustado.');
  return changed;
}

// Muda a proporção e/ou a taxa de quadros do projeto (usado pelas câmeras: "Usar o formato desta câmera").
export function setProjectFormat({ aspect, fps }) {
  const { commit, notify } = useStore.getState();
  commit((p) => {
    if (aspect && ASPECTS[aspect]) {
      const [w, h] = ASPECTS[aspect];
      p.settings.aspect = aspect;
      p.settings.width = w;
      p.settings.height = h;
    }
    if (fps) p.settings.fps = fps;
  });
  notify(`Formato do projeto: ${aspect || ''}${aspect && fps ? ' · ' : ''}${fps ? fps + ' fps' : ''}`);
}
