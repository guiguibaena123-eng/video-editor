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
