import { useStore } from '../store';
import { proxySupported } from '../web/proxy';
import { importFiles } from './files';

// Importa arquivos e, se algum vídeo vai ganhar a cópia leve, mostra a tela "Preparando o vídeo" (barra de progresso)
// antes de revelar o player — como os editores de celular fazem. A tela fecha sozinha quando tudo está pronto.
export async function importWithPrep(files, onEach) {
  const want = proxySupported(); // (em "Original" só aparece se algum vídeo não puder tocar direto e precisar da cópia leve)
  if (want) useStore.setState({ prep: { ids: [], phase: 'import', startedAt: performance.now() } });
  try {
    return await importFiles(files, (m) => {
      onEach?.(m);
      if (want) useStore.setState((s) => (s.prep ? { prep: { ...s.prep, ids: [...s.prep.ids, m.id] } } : {}));
    });
  } finally {
    if (want) useStore.setState((s) => (s.prep ? { prep: { ...s.prep, phase: 'optimize' } } : {}));
  }
}
