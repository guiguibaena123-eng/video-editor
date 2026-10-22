import { useEffect } from 'react';
import { useStore } from '../store';
import { goHome } from '../ops';
import { startAutosave } from '../library';
import { Toast, DialogHost } from './ui';
import MHome from './Home';
import MEditor from './Editor';

export default function MobileApp() {
  const view = useStore((s) => s.view);
  const busy = useStore((s) => s.busy);

  useEffect(() => startAutosave(), []);

  // Botão "voltar" do Android (e gesto do iPhone) volta para os projetos em vez de sair do app.
  useEffect(() => {
    if (view === 'editor') {
      history.pushState({ editor: true }, '');
      const onPop = () => goHome();
      window.addEventListener('popstate', onPop);
      return () => window.removeEventListener('popstate', onPop);
    }
  }, [view]);

  // Guarda o projeto quando o app vai para o segundo plano (o celular pode encerrar a página).
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && useStore.getState().view === 'editor') {
        import('../library').then((l) => l.saveToLibrary({ thumb: true }).catch(() => {}));
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  return (
    <>
      {view === 'home' ? <MHome /> : <MEditor />}
      {busy && (
        <div className="m-busy" role="status">
          <i className="m-spin" />
          <span>{busy.label}</span>
        </div>
      )}
      <Toast />
      <DialogHost />
    </>
  );
}
