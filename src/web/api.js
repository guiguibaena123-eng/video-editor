// Versão para navegador do window.api do Electron: leitura de mídia, miniaturas, onda de áudio e a
// biblioteca de projetos (IndexedDB). Assim o motor, a store e as ops do PC rodam sem mudanças no celular.
import { dbPut, dbGet, dbDelete, dbAll, dbKeys } from './db';
import { registerBlob, webBlob, webUrl, webName, webId, isWebPath, makeWebPath, prewarmVideo } from './registry';
import { useStore } from '../store';
import { makePreviewProxy } from './proxy';
import { engine } from '../engine';
import { framesSupported, thumbsFromFrames, openSource, playsDirect } from './frames';

const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma)$/i;

const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const typeOfFile = (f) => {
  const t = f.type || '';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  if (IMAGE_RE.test(f.name || '')) return 'image';
  if (AUDIO_RE.test(f.name || '')) return 'audio';
  return 'video';
};

// Gravações no aparelho que ainda estão acontecendo em segundo plano.
const pendingWrites = new Set();
export const flushStorage = () => Promise.allSettled([...pendingWrites]);

// Aceita os arquivos escolhidos na galeria e devolve os caminhos "web:" na hora: o arquivo já pode ser usado
// direto da galeria. A cópia para o armazenamento do app (que pode levar vários segundos em vídeo grande) roda
// em segundo plano; salvar o projeto espera ela terminar.
export async function storeFiles(fileList) {
  const paths = [];
  for (const f of fileList) {
    const id = rid();
    const path = makeWebPath(id, f.name || 'arquivo');
    registerBlob(path, f);
    // Vídeo escolhido: já lê o índice dos quadros (celular) ou começa a carregar um <video> (navegador sem WebCodecs).
    if (typeOfFile(f) === 'video') framesSupported() ? openSource(f) : prewarmVideo(path);
    const job = dbPut('files', id, { blob: f, name: f.name, type: f.type, size: f.size })
      .catch((err) => useStore.getState().notify('Não foi possível guardar "' + (f.name || 'arquivo') + '" no aparelho (falta de espaço?): ' + String(err?.message || err), 'error'))
      .finally(() => pendingWrites.delete(job));
    pendingWrites.add(job);
    paths.push(path);
  }
  return paths;
}

// ---------- trabalho de fundo (miniaturas, onda) ----------
// Tarefas de fundo (miniaturas, onda do som): uma de cada vez em cada fila (imagem / som), e só quando o player não está
// tocando nem esperando o primeiro quadro: o quadro aparece antes e tocar não trava.
const lanes = { v: Promise.resolve(), a: Promise.resolve() };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function playerFree(maxWait = 10000) {
  const t0 = performance.now();
  while (performance.now() - t0 < maxWait) {
    const playing = useStore.getState().playing;
    // esperando o primeiro quadro: no máximo ~0,6 s (com a decodificação própria ele sai em ~60 ms)
    const loading = performance.now() - t0 < 600 && (engine.loading ? engine.loading() : [...engine.entries.values()].some((e) => e.el.readyState < 2 && !e.el.error));
    if (!playing && !loading) return;
    await sleepMs(playing ? 250 : 40);
  }
}
const background = (fn, lane = 'v') => {
  const p = lanes[lane].then(() => playerFree()).then(fn);
  lanes[lane] = p.catch(() => {});
  return p;
};

function waitFor(el, ok, bad = 'error', ms = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => done(new Error('Tempo esgotado ao ler o arquivo.')), ms);
    const done = (err) => {
      clearTimeout(t);
      el.removeEventListener(ok, onOk);
      el.removeEventListener(bad, onBad);
      err ? reject(err) : resolve();
    };
    const onOk = () => done();
    const onBad = () => done(new Error('Este formato não é compatível com o navegador do celular.'));
    el.addEventListener(ok, onOk);
    el.addEventListener(bad, onBad);
  });
}

// Procura uma faixa de áudio dentro de um MP4/MOV lendo só os cabeçalhos. null = não deu para saber.
async function mp4HasAudio(blob) {
  try {
    let pos = 0;
    while (pos + 8 <= blob.size) {
      const dv = new DataView(await blob.slice(pos, pos + 16).arrayBuffer());
      let len = dv.getUint32(0);
      const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
      if (len === 1) len = Number(dv.getBigUint64(8));
      else if (len === 0) len = blob.size - pos;
      if (type === 'moov') {
        const bytes = new Uint8Array(await blob.slice(pos, pos + Math.min(len, 12_000_000)).arrayBuffer());
        for (let i = 0; i < bytes.length - 3; i++) {
          if (bytes[i] === 0x73 && bytes[i + 1] === 0x6f && bytes[i + 2] === 0x75 && bytes[i + 3] === 0x6e) return true; // "soun"
        }
        return false;
      }
      if (len < 8) return null;
      pos += len;
    }
  } catch {}
  return null;
}

async function probe(path) {
  const blob = webBlob(path);
  if (!blob) throw new Error('Arquivo não encontrado.');
  const name = webName(path);
  const type = typeOfFile({ type: blob.type, name });
  const url = webUrl(path);
  const base = { path, name, type, size: blob.size, fps: 30 };
  if (type === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('Não foi possível abrir esta imagem.');
    });
    return { ...base, duration: 0, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false, fps: 0 };
  }
  const el = document.createElement(type === 'video' ? 'video' : 'audio');
  el.preload = 'metadata';
  el.muted = true;
  el.playsInline = true;
  el.src = url;
  await waitFor(el, 'loadedmetadata');
  let duration = el.duration;
  if (!Number.isFinite(duration)) {
    // webm gravado no celular às vezes não guarda a duração: força o navegador a calcular.
    el.currentTime = 1e7;
    await waitFor(el, 'durationchange', 'error', 8000).catch(() => {});
    duration = el.duration;
    el.currentTime = 0;
  }
  const out = { ...base, duration: Number.isFinite(duration) ? duration : 0, width: el.videoWidth || 0, height: el.videoHeight || 0, hasAudio: true };
  if (type === 'video') {
    const has = /\.(mp4|m4v|mov|3gp)$/i.test(name) ? await mp4HasAudio(blob) : null;
    out.hasAudio = has === null ? true : has;
  }
  el.removeAttribute('src');
  el.load();
  if (!out.duration) throw new Error('Não foi possível ler a duração do arquivo.');
  return out;
}

const THUMB_H = 72;

// Miniaturas e onda do som ficam guardadas no aparelho ("-t" e "-w"): ao reabrir o projeto aparecem na hora.
async function cached(path, suffix, make) {
  const key = webId(path) + suffix;
  try {
    const rec = await dbGet('files', key);
    if (rec?.data) return rec.data;
  } catch {}
  const data = await make();
  dbPut('files', key, { data }).catch(() => {});
  return data;
}

async function thumbnails(path, duration, type) {
  return cached(path, '-t', () => background(() => makeThumbnails(path, duration, type)));
}

async function makeThumbnails(path, duration, type) {
  const url = webUrl(path);
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const shot = (src, w, h) => {
    c.height = THUMB_H;
    c.width = Math.max(8, Math.round((THUMB_H * w) / h));
    g.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.6);
  };
  if (type === 'image') {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { interval: 0, frames: [shot(img, img.naturalWidth, img.naturalHeight)] };
  }
  const count = Math.max(1, Math.min(20, Math.ceil(duration / (duration > 90 ? 5 : 2))));
  // Celular: decodifica os quadros direto do arquivo (bem mais rápido do que buscar num <video>).
  if (framesSupported()) {
    try {
      const fast = await thumbsFromFrames(webBlob(path), count, THUMB_H, () => (useStore.getState().playing ? playerFree() : null));
      if (fast) return fast;
    } catch {}
  }
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await waitFor(v, 'loadeddata');
  const interval = Math.max(duration / count, 0.05);
  const frames = [];
  for (let i = 0; i < count; i++) {
    if (useStore.getState().playing) await playerFree(); // toca com prioridade; as miniaturas esperam
    v.currentTime = Math.min(Math.max(0, duration - 0.05), i * interval + interval / 2);
    await waitFor(v, 'seeked', 'error', 4000).catch(() => {});
    frames.push(shot(v, v.videoWidth || 16, v.videoHeight || 9));
    await sleepMs(40); // respiro para o resto do app
  }
  v.removeAttribute('src');
  v.load();
  return { interval, frames };
}

async function waveform(path, duration = 0) {
  return cached(path, '-w', () => background(() => makeWaveform(path, duration), 'a'));
}

async function makeWaveform(path, duration) {
  const blob = webBlob(path);
  // Decodificar o som inteiro ocupa muita memória (estéreo 44,1 kHz ≈ 350 KB/s) e lê o arquivo todo: só em
  // arquivos de tamanho razoável. Vídeos grandes ficam sem onda no celular.
  if (!blob || blob.size > 80 * 1024 * 1024 || duration > 330) throw new Error('Arquivo grande demais para a onda de áudio.');
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new AC(1, 44100, 44100);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const RATE = 40; // picos por segundo
  const data = buf.getChannelData(0);
  const per = Math.max(1, Math.floor(buf.sampleRate / RATE));
  const peaks = new Float32Array(Math.ceil(data.length / per));
  for (let p = 0; p < peaks.length; p++) {
    let max = 0;
    const end = Math.min(data.length, (p + 1) * per);
    for (let i = p * per; i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > max) max = v;
    }
    peaks[p] = max;
  }
  return { rate: RATE, peaks };
}

// ---------- biblioteca de projetos ----------

// Reabre os arquivos de mídia do projeto a partir do aparelho; o que sumiu fica marcado como ausente.
async function releaseMedia(data) {
  await Promise.all(
    (data.media || []).map(async (m) => {
      if (!isWebPath(m.path)) {
        m.missing = true;
        return;
      }
      const rec = await dbGet('files', webId(m.path));
      if (rec?.blob) {
        registerBlob(m.path, rec.blob);
        m.missing = false;
      } else m.missing = true;
    }),
  );
}

// Apaga do aparelho os arquivos que nenhum projeto usa mais.
async function collectGarbage() {
  const used = new Set();
  for (const [, rec] of await dbAll('projects')) for (const m of rec.data?.media || []) if (isWebPath(m.path)) used.add(webId(m.path));
  for (const id of await dbKeys('files')) if (!used.has(String(id).replace(/(-p)?(-[tw])?$/, ''))) await dbDelete('files', id); // "-p" = prévia leve, "-t" = miniaturas, "-w" = onda do som
}

const libId = (file) => String(file).replace(/^lib:/, '');

const library = {
  async libraryList() {
    const out = [];
    for (const [id, rec] of await dbAll('projects')) out.push({ ...rec.meta, file: 'lib:' + id, thumb: rec.thumb || null });
    return out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  },
  async libraryNewFile() {
    return 'lib:p-' + rid();
  },
  async librarySave({ file, data, meta, thumb }) {
    const id = libId(file);
    await flushStorage(); // a mídia tem de estar guardada antes do projeto que depende dela
    const old = await dbGet('projects', id);
    await dbPut('projects', id, { data, meta: { ...meta, modified: Date.now() }, thumb: thumb || old?.thumb || null });
    return file;
  },
  async libraryOpen(file) {
    const rec = await dbGet('projects', libId(file));
    if (!rec) throw new Error('Projeto não encontrado.');
    const data = structuredClone(rec.data);
    await releaseMedia(data);
    return { filePath: file, data };
  },
  async libraryDelete(file) {
    await dbDelete('projects', libId(file));
    await collectGarbage();
    return true;
  },
  async libraryRename(file, name) {
    const id = libId(file);
    const rec = await dbGet('projects', id);
    if (!rec) return name;
    const n = String(name).slice(0, 80) || rec.data.name;
    rec.data.name = n;
    rec.meta.name = n;
    await dbPut('projects', id, rec);
    return n;
  },
  async libraryDuplicate(file) {
    const rec = await dbGet('projects', libId(file));
    if (!rec) throw new Error('Projeto não encontrado.');
    const id = 'p-' + rid();
    const name = `${rec.data.name || 'Projeto'} (cópia)`.slice(0, 80);
    await dbPut('projects', id, { ...rec, data: { ...rec.data, name }, meta: { ...rec.meta, name, modified: Date.now() } });
    return 'lib:' + id;
  },
  libraryImport: async () => null,
  libraryReveal: async () => {},
};

const unsupported = (what) => async () => {
  throw new Error(`${what} ainda não está disponível no celular.`);
};

export function installWebApi() {
  if (window.api) return;
  window.api = {
    ...library,
    allowPaths: async (paths) => paths,
    pathForFile: () => null,
    openMedia: async () => [],
    probe,
    thumbnails,
    waveform,
    setDirty: () => {},
    setFullScreen: () => {},
    onFullScreenChange: () => () => {},
    onExportProgress: () => () => {},
    onStabilizeProgress: () => () => {},
    onReverseProgress: () => () => {},
    showItem: () => {},
    saveProject: async () => null,
    previewProxy: makePreviewProxy,
    canFrames: async (path) => framesSupported() && !!(await openSource(webBlob(path))),
    playsDirect: async (path) => (framesSupported() ? playsDirect(await openSource(webBlob(path))) : false),
    proxyMinSide: 1000, // no celular qualquer vídeo acima de HD ganha prévia leve
    proxyThumbs: true, // e as miniaturas saem da própria geração da cópia
    audioProxy: unsupported('Efeito de áudio'),
    extractFrame: unsupported('Congelar quadro'),
    stabilizeMedia: unsupported('Estabilização'),
    reverseMedia: unsupported('Reverso'),
    saveRecording: unsupported('Gravação'),
    openSrt: unsupported('Importar legendas'),
    saveSrt: unsupported('Exportar legendas'),
    openLut: unsupported('Importar LUT'),
    readLut: unsupported('Importar LUT'),
    chooseExportPath: unsupported('Exportação'),
    startExport: unsupported('Exportação'),
    exportAssetDir: unsupported('Exportação'),
    writeExportAsset: unsupported('Exportação'),
    cleanExportAssets: async () => {},
    cancelExport: async () => {},
  };
}
