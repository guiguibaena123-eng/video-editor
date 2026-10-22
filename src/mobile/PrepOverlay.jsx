import { useEffect, useRef, useState } from 'react';
import { useStore, clipEnd } from '../store';
import { engine } from '../engine';

const fmt = (v) => Math.round(v * 100) + '%';

// O que cada mídia ainda precisa antes de o player ficar pronto: cópia leve (se vai ter), miniaturas da linha do
// tempo e onda do som.
function needs(s, id) {
  const m = s.media.find((x) => x.id === id);
  const c = s.cache[id] || {};
  const proxy = c.proxyState === 'working';
  const thumbs = !!m && m.type !== 'audio' && !c.thumbs && !c.thumbsFailed;
  const wave = !!m && m.hasAudio && !c.wave && !c.waveFailed;
  return { m, c, proxy, thumbs, wave };
}

// Tela cheia "Preparando o vídeo": barra de progresso da cópia leve e dos itens do player. Só aparece se a preparação
// passar de um instante, e só some quando tudo está pronto: cópia leve, miniaturas na linha do tempo e o primeiro
// quadro do vídeo já na tela.
export default function PrepOverlay() {
  const prep = useStore((s) => s.prep);
  const state = useStore((s) => s);
  const [canSkip, setCanSkip] = useState(false);
  const [late, setLate] = useState(false);
  const doneAt = useRef(0);

  const ids = prep ? prep.ids : [];
  const items = ids.map((id) => needs(state, id));
  const anyProxy = items.some((n) => n.proxy);
  const assetsPending = items.some((n) => n.thumbs || n.wave);
  const wantShow = !!prep && (anyProxy || (prep.phase === 'optimize' && assetsPending));

  // Progresso: 85% é a cópia leve; 15% são miniaturas e onda.
  const withProxy = items.filter((n) => n.c.proxyState);
  const pProxy = withProxy.length ? withProxy.reduce((a, n) => a + (n.proxy ? Math.min(0.99, n.c.proxyProgress || 0) : 1), 0) / withProxy.length : 1;
  const slots = items.reduce((a, n) => a + (n.m && n.m.type !== 'audio' ? 1 : 0) + (n.m && n.m.hasAudio ? 1 : 0), 0);
  const left = items.reduce((a, n) => a + (n.thumbs ? 1 : 0) + (n.wave ? 1 : 0), 0);
  const pAssets = slots ? 1 - left / slots : 1;
  const progress = Math.min(0.99, pProxy * 0.85 + pAssets * 0.15);

  useEffect(() => {
    if (!wantShow) return setLate(false);
    const t = setTimeout(() => setLate(true), 350); // preparação curta não pisca a tela
    return () => clearTimeout(t);
  }, [wantShow]);
  const visible = wantShow && late;

  useEffect(() => {
    if (!visible) return setCanSkip(false);
    const t = setTimeout(() => setCanSkip(true), 2500);
    return () => clearTimeout(t);
  }, [visible]);

  // Tudo pronto: espera o player estar na cópia leve com o primeiro quadro (máx. ~3 s) e fecha.
  useEffect(() => {
    if (!prep || prep.phase !== 'optimize' || anyProxy) return;
    if (!doneAt.current) doneAt.current = performance.now();
    const id = setInterval(() => {
      const s = useStore.getState();
      const nothingLeft = ids.every((mid) => {
        const n = needs(s, mid);
        return !n.thumbs && !n.wave;
      });
      const waited = performance.now() - doneAt.current;
      // Miniaturas/onda que demoram demais (>8 s depois da cópia) não seguram a tela: terminam em segundo plano.
      const assetsOk = nothingLeft || waited > 8000;
      const entries = [...engine.entries.values()];
      const frameReady = entries.every((e) => e.el.readyState >= 2 || e.el.error);
      const swapped = ids.every((mid) => {
        const c = s.cache[mid];
        if (c?.proxyState !== 'ready') return true;
        return entries.filter((e) => e.mediaId === mid).every((e) => e.srcPath === c.proxy);
      });
      // Os primeiros quadros do ponto atual já decodificados (tira): o primeiro play começa sem congelar.
      const stripsOk =
        !engine.stripsOn ||
        [...engine.entries.entries()].every(([eid, e]) => {
          const c = s.project.clips.find((x) => x.id === eid);
          if (!c || s.currentTime < c.start || s.currentTime >= clipEnd(c)) return true;
          const m = s.media.find((x) => x.id === c.mediaId);
          return !m || m.type !== 'video' || !engine.canStrip(e, m) || !!e.strip;
        });
      if (assetsOk && ((frameReady && swapped && (stripsOk || waited > 6000)) || waited > 11000) && s.prep) {
        clearInterval(id);
        doneAt.current = 0;
        useStore.setState({ prep: null });
      }
    }, 120);
    return () => clearInterval(id);
  }, [prep, anyProxy]);

  if (!visible) return null;
  return (
    <div className="mprep" role="status" aria-live="polite">
      <div className="mprep-card">
        <div className="mprep-icon" aria-hidden="true">
          <i />
        </div>
        <h2>Preparando o vídeo</h2>
        <p>{anyProxy ? 'Criando uma versão leve para a edição ficar fluida. Isso acontece uma vez por vídeo.' : 'Quase pronto: montando as miniaturas da linha do tempo.'}</p>
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
