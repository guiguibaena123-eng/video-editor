// Emojis dos adesivos: imagens vetoriais (Twemoji, licença CC-BY 4.0 — ver docs/LICENCAS.md) em vez da fonte do sistema.
// Assim o adesivo é igual em qualquer PC, nítido em qualquer tamanho e idêntico na prévia e no vídeo exportado.
const urls = import.meta.glob('./emoji/*.svg', { query: '?url', import: 'default', eager: true });
const cache = new Map();

const codeOf = (s) =>
  [...String(s).trim()]
    .map((c) => c.codePointAt(0).toString(16))
    .filter((h) => h !== 'fe0f')
    .join('-');

export const emojiUrl = (s) => urls[`./emoji/${codeOf(s)}.svg`] || null;
export const hasEmojiImage = (s) => !!urls[`./emoji/${codeOf(s)}.svg`];

function entry(s) {
  const code = codeOf(s);
  const url = urls[`./emoji/${code}.svg`];
  if (!url) return null;
  let e = cache.get(code);
  if (!e) {
    const img = new Image();
    e = { img, ready: false, promise: null };
    e.promise = new Promise((res) => {
      img.onload = () => {
        e.ready = true;
        window.dispatchEvent(new Event('emoji-loaded'));
        res();
      };
      img.onerror = () => res();
    });
    img.src = url;
    cache.set(code, e);
  }
  return e;
}

// Imagem pronta para desenhar (ou null enquanto carrega / se não existe).
export const emojiImage = (s) => {
  const e = entry(s);
  return e && e.ready ? e.img : null;
};

// Espera a imagem carregar (usado antes de exportar).
export const emojiLoaded = (s) => entry(s)?.promise ?? Promise.resolve();
