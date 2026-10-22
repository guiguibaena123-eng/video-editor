// Mídia no navegador: cada arquivo importado vira um caminho "web:<id>/<nome>" e um endereço blob:
// guardado aqui. É o que o motor do PC usa no lugar do protocolo media:// do Electron.
const urls = new Map(); // caminho -> endereço blob:
const blobs = new Map(); // caminho -> Blob

export const isWebPath = (p) => typeof p === 'string' && p.startsWith('web:');
export const webId = (p) => p.slice(4).split('/')[0];
export const webName = (p) => {
  try {
    return decodeURIComponent(p.slice(4).split('/').slice(1).join('/'));
  } catch {
    return p;
  }
};
export const makeWebPath = (id, name) => `web:${id}/${encodeURIComponent(name)}`;

export function registerBlob(path, blob) {
  const old = urls.get(path);
  if (old) URL.revokeObjectURL(old);
  urls.set(path, URL.createObjectURL(blob));
  blobs.set(path, blob);
}
export const webUrl = (p) => urls.get(p) || '';
export const webBlob = (p) => blobs.get(p) || null;
export const hasWebMedia = (p) => urls.has(p);

// Elementos de vídeo "aquecidos": começam a carregar o arquivo assim que ele é escolhido (junto com a leitura das
// informações), e o player os adota ao criar o clipe — o primeiro quadro fica pronto bem antes.
const warm = new Map(); // caminho -> { el, timer }
export function prewarmVideo(path, max = 1) {
  if (warm.has(path) || warm.size >= max || !urls.has(path)) return;
  const el = document.createElement('video');
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  el.playsInline = true;
  el.muted = true;
  el.src = urls.get(path);
  // Não adotado em 25 s: solta o decodificador (celulares limitam quantos podem existir ao mesmo tempo).
  const timer = setTimeout(() => {
    warm.delete(path);
    el.removeAttribute('src');
    el.load();
  }, 25000);
  warm.set(path, { el, timer });
}
export function takePrewarmed(path) {
  const w = warm.get(path);
  if (!w) return null;
  clearTimeout(w.timer);
  warm.delete(path);
  return w.el;
}
