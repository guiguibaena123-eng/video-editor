// Gera as imagens dos textos para a exportação. Cada texto vira:
//  - uma sequência de quadros na animação de entrada,
//  - uma imagem parada no meio,
//  - uma sequência de quadros na animação de saída.
// Textos com animação de repetição viram uma sequência do começo ao fim.
import { clipDur } from './store';
import { drawTextClip, animSpans, loadFont } from './text';
import { transformAt, hasKeyframes } from './keyframes';

const toPng = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('Falha ao gerar imagem do texto'))), 'image/png'),
  );

export function textFrameCount(clips, fps) {
  let n = 0;
  for (const c of clips) {
    const dur = clipDur(c);
    const { inDur, outDur, loop } = animSpans(c.anim, dur);
    n += loop || hasKeyframes(c) ? Math.max(1, Math.round(dur * fps)) : Math.round(inDur * fps) + Math.round(outDur * fps) + 1;
  }
  return n;
}

export async function renderTextAssets(clips, { width: W, height: H, fps, settings, dir, onFrame, isCanceled }) {
  await Promise.all(clips.map((c) => loadFont(c.text)));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const assets = {};

  for (const clip of clips) {
    const dur = clipDur(clip);
    const spans = animSpans(clip.anim, dur);
    const { inDur, outDur } = spans;
    // Com keyframes o texto muda o tempo todo: vira uma sequência do começo ao fim.
    const loop = spans.loop || hasKeyframes(clip);
    const segments = [];
    const write = async (name, local) => {
      if (isCanceled?.()) throw new Error('canceled');
      g.clearRect(0, 0, W, H);
      drawTextClip(g, clip, local, W, H, settings, { transform: transformAt(clip, local) });
      await window.api.writeExportAsset(dir, name, await toPng(canvas));
      onFrame?.();
    };
    const seq = async (tag, from, count) => {
      if (count <= 0) return;
      for (let i = 0; i < count; i++) await write(`${clip.id}_${tag}_${String(i).padStart(5, '0')}.png`, from + i / fps);
      segments.push({ kind: 'seq', pattern: `${clip.id}_${tag}_%05d.png`, start: clip.start + from, dur: count / fps });
    };

    if (loop) {
      await seq('full', 0, Math.max(1, Math.round(dur * fps)));
    } else {
      const nIn = Math.round(inDur * fps);
      const nOut = Math.round(outDur * fps);
      await seq('in', 0, nIn);
      const midStart = nIn / fps;
      const midDur = dur - midStart - nOut / fps;
      if (midDur > 1e-3) {
        const name = `${clip.id}_still.png`;
        await write(name, midStart + midDur / 2);
        segments.push({ kind: 'still', file: name, start: clip.start + midStart, dur: midDur });
      }
      await seq('out', dur - nOut / fps, nOut);
    }
    assets[clip.id] = { segments };
  }
  return assets;
}
