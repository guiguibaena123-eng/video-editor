// Prévia leve no celular: cria (uma vez por vídeo) uma cópia pequena e de busca rápida só para o player.
// O trabalho pesado roda em src/web/proxyWorker.js; aqui ficam fila, cache no aparelho e a pausa enquanto toca.
import { useStore } from '../store';
import { webBlob, registerBlob, makeWebPath, webId } from './registry';
import { dbGet, dbPut } from './db';

let chain = Promise.resolve(); // um vídeo por vez

export const proxySupported = () => typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined' && typeof Worker !== 'undefined';

export function makePreviewProxy(path, hasAudio, onProgress, duration, onThumbs) {
  if (!proxySupported()) return Promise.reject(new Error('Este navegador não gera a prévia leve.'));
  const p = chain.then(() => run(path, hasAudio, onProgress, duration, onThumbs));
  chain = p.catch(() => {});
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(path, hasAudio, onProgress, duration, onThumbs) {
  const key = webId(path) + '-p';
  const proxyPath = makeWebPath(key, 'previa.mp4');
  const rec = await dbGet('files', key);
  if (rec?.blob) {
    registerBlob(proxyPath, rec.blob); // já feita numa abertura anterior
    return proxyPath;
  }
  while (useStore.getState().playing) await sleep(500); // não disputa o decodificador com quem está assistindo
  await sleep(600);
  const blob = webBlob(path);
  if (!blob) throw new Error('arquivo não encontrado');

  const worker = new Worker(new URL('./proxyWorker.js', import.meta.url), { type: 'module' });
  const unsub = useStore.subscribe((s, prev) => s.playing !== prev.playing && worker.postMessage({ type: 'hold', on: s.playing }));
  let buffer;
  let thumbs = null;
  try {
    buffer = await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.f);
        else if (m.type === 'done') {
          thumbs = m.thumbs || null;
          resolve(m.buffer);
        }
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'falha na prévia leve'));
      worker.postMessage({ type: 'start', blob, hasAudio, shortSide: globalThis.__PROXY_SHORT || 540 });
      if (useStore.getState().playing) worker.postMessage({ type: 'hold', on: true });
    });
  } finally {
    unsub();
    worker.terminate();
  }

  const out = new Blob([buffer], { type: 'video/mp4' });
  registerBlob(proxyPath, out);
  // Confere antes de usar: a cópia tem de durar o mesmo que o original (senão o player usaria algo torto).
  if (duration) {
    const d = await new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(v.duration);
      v.onerror = () => resolve(0);
      v.src = URL.createObjectURL(out);
      setTimeout(() => resolve(0), 8000);
    });
    if (!d || Math.abs(d - duration) > 0.6) throw new Error(`a cópia leve ficou com duração diferente (${d?.toFixed?.(2)} s contra ${duration.toFixed(2)} s)`);
  }
  if (thumbs) onThumbs?.(thumbs);
  await dbPut('files', key, { blob: out, name: 'previa.mp4', type: 'video/mp4', size: out.size }).catch(() => {});
  return proxyPath;
}
