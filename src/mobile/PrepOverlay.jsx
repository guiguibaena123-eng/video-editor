import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { engine } from '../engine';

const fmt = (v) => Math.round(v * 100) + '%';

// Tela cheia "Preparando o vídeo": barra de progresso da cópia leve. Só aparece se algum vídeo realmente vai ser
// otimizado, e some quando todos estão prontos e o player já está tocando a cópia (primeiro quadro na tela).
export default function PrepOverlay() {
  const prep = useStore((s) => s.prep);
  const cache = useStore((s) => s.cache);
  const [canSkip, setCanSkip] = useState(false);
  const [late, setLate] = useState(false); // só mostra se a preparação durar mais que um instante (sem piscar)
  const shownAt = useRef(0);

  const ids = prep ? prep.ids : [];
  const states = ids.map((id) => cache[id]).filter((c) => c?.proxyState);
  const working = states.some((c) => c.proxyState === 'working');
  const wantShow = !!prep && (working || (prep.phase === 'import' && states.length > 0 && states.some((c) => c.proxyState !== 'ready' && c.proxyState !== 'failed')));
  const progress = states.length ? states.reduce((a, c) => a + (c.proxyState === 'working' ? Math.min(0.99, c.proxyProgress || 0) : 1), 0) / states.length : 0;

  useEffect(() => {
    if (!wantShow) return setLate(false);
    const t = setTimeout(() => setLate(true), 350);
    return () => clearTimeout(t);
  }, [wantShow]);
  const visible = wantShow && late;

  useEffect(() => {
    if (visible && !shownAt.current) shownAt.current = performance.now();
    if (!visible) {
      shownAt.current = 0;
      setCanSkip(false);
      return;
    }
    const t = setTimeout(() => setCanSkip(true), 2500);
    return () => clearTimeout(t);
  }, [visible]);

  // Acabou: fecha quando todas as cópias terminaram (ou falharam) e o player já está com o primeiro quadro pronto.
  useEffect(() => {
    if (!prep || prep.phase !== 'optimize' || working) return;
    let tries = 0;
    const id = setInterval(() => {
      const s = useStore.getState();
      const ready = [...engine.entries.values()].every((e) => e.el.readyState >= 2 || e.el.error);
      const swapped = ids.every((mid) => {
        const c = s.cache[mid];
        if (c?.proxyState !== 'ready') return true;
        return [...engine.entries.values()].filter((e) => e.mediaId === mid).every((e) => e.srcPath === c.proxy);
      });
      if (((ready && swapped) || ++tries > 25) && s.prep) {
        clearInterval(id);
        useStore.setState({ prep: null });
      }
    }, 120);
    return () => clearInterval(id);
  }, [prep, working]);

  if (!visible) return null;
  return (
    <div className="mprep" role="status" aria-live="polite">
      <div className="mprep-card">
        <div className="mprep-icon" aria-hidden="true">
          <i />
        </div>
        <h2>Preparando o vídeo</h2>
        <p>Criando uma versão leve para a edição ficar fluida. Isso acontece uma vez por vídeo.</p>
        <div className="mprep-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <i style={{ width: progress * 100 + '%' }} />
        </div>
        <b>{fmt(progress)}</b>
        {canSkip && (
          <button className="mprep-skip" onClick={() => useStore.setState({ prep: null })}>
            Continuar sem esperar
          </button>
        )}
      </div>
    </div>
  );
}
