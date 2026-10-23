// Emojis dos adesivos: imagens vetoriais (Twemoji, licença CC-BY 4.0 — ver docs/LICENCAS.md) em vez da fonte do sistema.
// Assim o adesivo é igual em qualquer PC, nítido em qualquer tamanho e idêntico na prévia e no vídeo exportado.
const urls = import.meta.glob('./emoji/*.svg', { query: '?url', import: 'default', eager: true });
const cache = new Map();
const S = 768; // lado da imagem pronta (nítida mesmo em adesivo grande)

// Dá volume ao emoji plano, no estilo dos emojis da Apple: realce de luz no alto, sombra embaixo, borda interna
// escurecida (efeito de relevo), cores um pouco mais vivas e sombra projetada suave. Tudo calculado a partir do
// formato (canal alfa) do próprio emoji.
function compose(img) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const pad = S * 0.07; // folga para a sombra projetada não cortar
  const box = S - pad * 2;
  // 1) emoji base, um pouco mais saturado e com mais contraste
  const base = document.createElement('canvas');
  base.width = base.height = S;
  const b = base.getContext('2d');
  b.filter = 'saturate(1.18) contrast(1.06)';
  b.drawImage(img, pad, pad, box, box);
  b.filter = 'none';
  // 2) borda interna escura (relevo): preto menos o formato deslocado e borrado, recortado dentro do emoji
  const rim = document.createElement('canvas');
  rim.width = rim.height = S;
  const r = rim.getContext('2d');
  r.fillStyle = 'rgba(0,0,0,0.38)';
  r.fillRect(0, 0, S, S);
  r.globalCompositeOperation = 'destination-out';
  r.filter = `blur(${S * 0.022}px)`;
  r.drawImage(base, 0, S * 0.012);
  r.filter = 'none';
  b.globalCompositeOperation = 'source-atop';
  b.drawImage(rim, 0, 0);
  // 3) sombra suave de baixo (ambiente) e brilho de cima (reflexo da luz), só dentro do formato
  const down = b.createLinearGradient(0, S * 0.45, 0, S * 0.95);
  down.addColorStop(0, 'rgba(60,20,0,0)');
  down.addColorStop(1, 'rgba(60,20,0,0.26)');
  b.fillStyle = down;
  b.fillRect(0, 0, S, S);
  const gloss = b.createLinearGradient(0, S * 0.06, 0, S * 0.56);
  gloss.addColorStop(0, 'rgba(255,255,255,0.46)');
  gloss.addColorStop(0.55, 'rgba(255,255,255,0.1)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  b.fillStyle = gloss;
  b.fillRect(0, 0, S, S);
  const spec = b.createRadialGradient(S * 0.34, S * 0.27, 0, S * 0.34, S * 0.27, S * 0.3);
  spec.addColorStop(0, 'rgba(255,255,255,0.55)');
  spec.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  b.fillStyle = spec;
  b.fillRect(0, 0, S, S);
  b.globalCompositeOperation = 'source-over';
  // 4) luz fina na borda de baixo (reflexo) + sombra projetada
  g.shadowColor = 'rgba(0,0,0,0.34)';
  g.shadowBlur = S * 0.035;
  g.shadowOffsetY = S * 0.02;
  g.drawImage(base, 0, 0);
  return c;
}

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
    e = { img, ready: false, promise: null, out: null };
    e.promise = new Promise((res) => {
      img.onload = () => {
        e.out = compose(img);
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
  return e && e.ready ? e.out : null;
};

// Espera a imagem carregar (usado antes de exportar).
export const emojiLoaded = (s) => entry(s)?.promise ?? Promise.resolve();
