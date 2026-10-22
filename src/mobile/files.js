import { useStore } from '../store';
import { importPaths, cleanError } from '../ops';
import { storeFiles } from '../web/api';
import { requestPersistence } from '../web/db';

// Abre a galeria do celular. Precisa ser chamado direto de um toque (o navegador exige).
export function pickFiles({ accept = 'video/*,image/*,audio/*' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = accept;
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(input);
    const done = (files) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done([...input.files]));
    input.addEventListener('cancel', () => done([]));
    input.click();
  });
}

// Guarda os arquivos no aparelho, lê as informações e põe na biblioteca de mídia do projeto.
export async function importFiles(files, onEach) {
  if (!files.length) return [];
  const s = useStore.getState();
  useStore.setState({ busy: { label: files.length > 1 ? `Importando ${files.length} arquivos…` : 'Importando…', progress: null } });
  try {
    requestPersistence();
    const paths = await storeFiles(files);
    // O aviso "Importando…" some assim que o primeiro arquivo está pronto; os outros continuam entrando.
    let first = true;
    return await importPaths(paths, (m) => {
      if (first) {
        first = false;
        useStore.setState({ busy: null });
      }
      onEach?.(m);
    });
  } catch (err) {
    s.notify('Não foi possível importar: ' + cleanError(err), 'error');
    return [];
  } finally {
    useStore.setState({ busy: null });
  }
}
