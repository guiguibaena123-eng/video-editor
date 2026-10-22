// Máscaras: definem que parte do clipe aparece. O mesmo desenho gera a máscara da prévia
// (canvas) e a imagem de máscara usada na exportação (FFmpeg alphamerge).

export const MASKS = [
  ['none', 'Nenhuma'],
  ['linear', 'Linear'],
  ['mirror', 'Espelho'],
  ['circle', 'Círculo'],
  ['rect', 'Retângulo'],
  ['heart', 'Coração'],
  ['star', 'Estrela'],
];

export const DEFAULT_MASK = { type: 'circle', x: 0, y: 0, w: 0.6, h: 0.6, rotation: 0, feather: 0.08, invert: false, round: 0 };
export const withMask = (m) => ({ ...DEFAULT_MASK, ...m });
export const hasMask = (clip) => !!clip.mask && clip.mask.type && clip.mask.type !== 'none';

function shapePath(g, m, W, H) {
  const big = (W + H) * 2;
  const w = m.w * W;
  const h = m.h * H;
  g.beginPath();
  switch (m.type) {
    case 'linear':
      g.rect(-big, 0, big * 2, big);
      break;
    case 'mirror':
      g.rect(-big, -h / 2, big * 2, h);
      break;
    case 'circle':
      g.ellipse(0, 0, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      break;
    case 'rect':
      g.roundRect(-w / 2, -h / 2, w, h, (m.round || 0) * Math.min(w, h) * 0.5);
      break;
    case 'heart': {
      // Coração desenhado num quadrado unitário e esticado para w×h.
      g.save();
      g.scale(w / 2, h / 2);
      g.moveTo(0, 0.9);
      g.bezierCurveTo(-1.1, 0.1, -1.05, -0.95, 0, -0.45);
      g.bezierCurveTo(1.05, -0.95, 1.1, 0.1, 0, 0.9);
      g.restore();
      break;
    }
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.42 : 1;
        const px = Math.cos(a) * r * (w / 2);
        const py = Math.sin(a) * r * (h / 2);
        if (i) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.closePath();
      break;
    }
    default:
  }
}

// Desenha a máscara (branco = aparece) num canvas W×H transparente.
export function drawMask(g, W, H, mask) {
  const m = withMask(mask);
  g.clearRect(0, 0, W, H);
  g.save();
  const blur = (m.feather || 0) * 0.25 * Math.min(W, H);
  if (blur > 0.3) g.filter = `blur(${blur}px)`;
  g.fillStyle = '#fff';
  if (m.invert) {
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
  }
  g.translate(W / 2 + m.x * W, H / 2 + m.y * H);
  g.rotate(((m.rotation || 0) * Math.PI) / 180);
  shapePath(g, m, W, H);
  g.fill();
  g.restore();
}

const cache = new Map();
// Canvas de máscara pronto (com cache) para um tamanho.
export function maskCanvas(mask, W, H) {
  const key = JSON.stringify(mask) + `|${W}x${H}`;
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    drawMask(c.getContext('2d'), W, H, mask);
    cache.set(key, c);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
  }
  return c;
}

// Imagem da máscara para o FFmpeg: cinza = transparência (preto some, branco aparece).
export async function maskPng(mask, W, H) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.drawImage(maskCanvas(mask, W, H), 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return blob.arrayBuffer();
}

export const BLEND_MODES = [
  ['normal', 'Normal'],
  ['multiply', 'Multiplicar'],
  ['screen', 'Tela'],
  ['overlay', 'Sobrepor'],
  ['darken', 'Escurecer'],
  ['lighten', 'Clarear'],
  ['addition', 'Adicionar'],
  ['difference', 'Diferença'],
  ['softlight', 'Luz suave'],
];
// Nome do mesmo modo no canvas do navegador.
export const CANVAS_BLEND = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', addition: 'lighter', difference: 'difference', softlight: 'soft-light' };
// Cor "neutra" de cada modo (não muda nada onde o clipe não está) para a exportação.
export const BLEND_NEUTRAL = { multiply: '0xFFFFFF', darken: '0xFFFFFF', screen: '0x000000', lighten: '0x000000', addition: '0x000000', difference: '0x000000', overlay: '0x808080', softlight: '0x808080' };
