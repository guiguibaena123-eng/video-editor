import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, clipEnd } from '../store';
import { engine } from '../engine';
import { decoderMode } from '../web/frames';
import { runSelfTest } from './selfTest';

// Painel de diagnóstico do player (toque 5 vezes no contador de tempo). Mostra o que acontece de verdade no
// aparelho: se o navegador recusou tocar, quanto o som/imagem estão fora da linha do tempo, quadros perdidos...
export default function Diag({ onClose }) {
  const [text, setText] = useState('');
  const prev = useRef({ t: performance.now(), rvfc: 0, draws: 0, ticks: 0, dec: 0 });
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
        const q = (e.vel || e.el)?.getVideoPlaybackQuality?.();
        const pc = s.cache[m.id];
        const media = e.el || e.vel;
        const drift = media ? Math.round((media.currentTime - (c.in + (t - c.start) * (c.speed || 1))) * 1000) : 0;
        const el = e.el;
        const src = /-p\/previa\.mp4$/.test(e.srcPath || '') ? ' · PRÉVIA LEVE' : ' · original';
        const vis = e.fp ? ` · imagem: quadros${e.fp.failed ? ' FALHOU ' + String(e.fp.failed.message || e.fp.failed).slice(0, 40) : ''} (${decoderMode(e.fp.src)}, ${e.fp.stats.decoded} quadros, ${e.fp.stats.resets} buscas${e.fp.src.reorder ? ', B-frames' : ''}${e.fp.src.rot ? ', girado ' + e.fp.src.rot + '°' : ''})` : e.vel ? ' · imagem: <video> mudo' : m.type === 'video' ? ' · imagem: abrindo' : '';
        rows.push(`${m.type[0]} ${m.name.slice(0, 14)}${media ? ` desvio ${drift} ms · ${el ? (el.paused ? 'som PARADO' : 'som tocando') : ''}${el?.seeking ? ' buscando' : ''} · estado ${el?.readyState ?? '-'}${e.live ? ' · live' : ''}${e.gain ? ' · WebAudio' : ''}` : ''}${src}${vis}${q ? ` · perdidos ${q.droppedVideoFrames}/${q.totalVideoFrames}` : ''}${pc?.proxyState ? ` · cópia leve: ${pc.proxyState}${pc.proxyError ? ' (' + pc.proxyError.slice(0, 60) + ')' : ''}` : ''}`);
      }
      const decNow = [...engine.entries.values()].reduce((a, e) => a + (e.fp ? e.fp.stats.decoded : 0), 0);
      const ua = navigator.userAgent.slice(12, 90);
      setText(
        [
          `${engine.playing ? 'TOCANDO' : 'parado'} · t=${t.toFixed(2)} · ${engine.lite ? 'leve' : 'completo'}`,
          `quadros do vídeo/s ${((engine.stats.rvfc - prev.current.rvfc + decNow - prev.current.dec) / dt).toFixed(0)} · desenhos/s ${((draws.current - prev.current.draws) / dt).toFixed(0)} · tempo/s ${((ticks - prev.current.ticks) / dt).toFixed(0)}`,
          `play() chamado ${engine.stats.plays}x · RECUSADO ${engine.stats.rejects}x ${engine.stats.lastErr || ""} · som: pulos ${engine.stats.resyncs || 0}, esperas ${engine.stats.waits || 0}`,
          `qualidade ${s.previewQuality} · escala ${s.autoScale}${engine.audioLead != null ? ` · atraso do som ${Math.round(engine.audioLead * 1000)} ms` : ''}`,
          ...rows,
          ua,
        ].join('\n'),
      );
      prev.current = { t: now, rvfc: engine.stats.rvfc, draws: draws.current, ticks, dec: decNow };
    }, 500);
    return () => {
      clearInterval(id);
      unsub();
      engine.draw = od;
    };
  }, []);

  const [report, setReport] = useState([]);
  const [running, setRunning] = useState(false);
  const test = () => {
    if (running) return;
    engine.unlockAudio?.(); // ainda dentro do toque
    setRunning(true);
    setReport(['Testando… não mexa na tela (uns 40 s).']);
    const lines = [];
    // o primeiro play() sai dentro do toque no botão (o iPhone só libera o som assim)
    runSelfTest((l) => {
      lines.push(l);
      setReport([...lines]);
    })
      .catch((err) => lines.push('ERRO no teste: ' + (err?.message || err)))
      .finally(() => {
        setReport([...lines]);
        setRunning(false);
      });
  };
  const copy = () => navigator.clipboard?.writeText(report.length ? report.join('\n') + '\n\n' + text : text).catch(() => {});
  return createPortal(
    <div className="mdiag" onPointerDown={(e) => e.stopPropagation()}>
      {report.length > 0 && <pre>{report.join('\n')}</pre>}
      <pre>{text}</pre>
      <div>
        <button onClick={test} disabled={running}>
          {running ? 'Testando…' : 'Testar'}
        </button>
        <button onClick={copy}>Copiar</button>
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>,
    document.body,
  );
}
