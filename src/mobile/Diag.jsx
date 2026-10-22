import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, clipEnd } from '../store';
import { engine } from '../engine';

// Painel de diagnóstico do player (toque 5 vezes no contador de tempo). Mostra o que acontece de verdade no
// aparelho: se o navegador recusou tocar, quanto o som/imagem estão fora da linha do tempo, quadros perdidos...
export default function Diag({ onClose }) {
  const [text, setText] = useState('');
  const prev = useRef({ t: performance.now(), rvfc: 0, draws: 0, ticks: 0 });
  const draws = useRef(0);

  useEffect(() => {
    const od = engine.draw.bind(engine);
    engine.draw = (...a) => {
      draws.current++;
      return od(...a);
    };
    let ticks = 0;
    const unsub = useStore.subscribe((s, p) => s.currentTime !== p.currentTime && ticks++);
    const id = setInterval(() => {
      const s = useStore.getState();
      const t = s.currentTime;
      const now = performance.now();
      const dt = (now - prev.current.t) / 1000;
      const rows = [];
      for (const c of s.project.clips) {
        if (t < c.start - 0.01 || t >= clipEnd(c)) continue;
        const e = engine.entries.get(c.id);
        const m = s.media.find((x) => x.id === c.mediaId);
        if (!e || !m) continue;
        const q = e.el.getVideoPlaybackQuality?.();
        const drift = Math.round((e.el.currentTime - (c.in + (t - c.start) * (c.speed || 1))) * 1000);
        rows.push(`${m.type[0]} ${m.name.slice(0, 14)} desvio ${drift} ms · ${e.el.paused ? 'PARADO' : 'tocando'}${e.el.seeking ? ' buscando' : ''} · estado ${e.el.readyState}${e.live ? ' · live' : ''}${e.gain ? ' · WebAudio' : ''}${q ? ` · perdidos ${q.droppedVideoFrames}/${q.totalVideoFrames}` : ''}`);
      }
      const ua = navigator.userAgent.slice(12, 90);
      setText(
        [
          `${engine.playing ? 'TOCANDO' : 'parado'} · t=${t.toFixed(2)} · ${engine.lite ? 'leve' : 'completo'}`,
          `quadros do vídeo/s ${((engine.stats.rvfc - prev.current.rvfc) / dt).toFixed(0)} · desenhos/s ${((draws.current - prev.current.draws) / dt).toFixed(0)} · tempo/s ${((ticks - prev.current.ticks) / dt).toFixed(0)}`,
          `play() chamado ${engine.stats.plays}x · RECUSADO ${engine.stats.rejects}x ${engine.stats.lastErr}`,
          `qualidade ${s.previewQuality} · escala ${s.autoScale}`,
          ...rows,
          ua,
        ].join('\n'),
      );
      prev.current = { t: now, rvfc: engine.stats.rvfc, draws: draws.current, ticks };
    }, 500);
    return () => {
      clearInterval(id);
      unsub();
      engine.draw = od;
    };
  }, []);

  const copy = () => navigator.clipboard?.writeText(text).catch(() => {});
  return createPortal(
    <div className="mdiag" onPointerDown={(e) => e.stopPropagation()}>
      <pre>{text}</pre>
      <div>
        <button onClick={copy}>Copiar</button>
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>,
    document.body,
  );
}
