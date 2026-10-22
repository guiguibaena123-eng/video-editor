// Biblioteca de projetos: cada projeto fica na pasta Documentos\Video Editor\Projetos e é salvo sozinho
// (depois de ~2,5 s sem mexer), com uma miniatura do quadro que aparece na tela inicial.
import { useStore, projectDuration } from './store';

// Miniatura (480 px de largura) do que está no player agora.
export function captureThumb() {
  const c = document.querySelector('.canvas-wrap canvas');
  if (!c || c.width < 8 || c.height < 8) return null;
  const W = 480;
  const H = Math.max(2, Math.round((W * c.height) / c.width));
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const g = off.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.drawImage(c, 0, 0, W, H);
  try {
    return off.toDataURL('image/jpeg', 0.74);
  } catch {
    return null;
  }
}

export const projectData = (s = useStore.getState()) => ({
  app: 'video-editor',
  version: 1,
  ...s.project,
  media: s.media.map(({ id, path, name, type, duration, width, height, hasAudio, fps, size }) => ({ id, path, name, type, duration, width, height, hasAudio, fps, size })),
});

let saving = null;

// Salva o projeto aberto na biblioteca. Projeto vazio (sem mídia nem clipes) não é gravado.
export async function saveToLibrary({ thumb = true } = {}) {
  if (saving) await saving.catch(() => {});
  const s = useStore.getState();
  if (!s.filePath || (!s.project.clips.length && !s.media.length)) return false;
  const proj = s.project;
  const media = s.media;
  useStore.setState({ saving: true });
  const work = (async () => {
    await window.api.librarySave({
      file: s.filePath,
      data: projectData(s),
      meta: {
        name: proj.name,
        clips: proj.clips.length,
        duration: +projectDuration(proj).toFixed(2),
        aspect: proj.settings.aspect,
        width: proj.settings.width,
        height: proj.settings.height,
      },
      thumb: thumb && s.view === 'editor' ? captureThumb() : null,
    });
    // Só marca como salvo se nada mudou enquanto gravava.
    const now = useStore.getState();
    if (now.project === proj && now.media === media) useStore.setState({ dirty: false });
  })();
  saving = work;
  try {
    await work;
    return true;
  } finally {
    saving = null;
    useStore.setState({ saving: false });
  }
}

let timer = null;

// Salva sozinho 2,5 s depois da última alteração.
export function startAutosave() {
  return useStore.subscribe((s, prev) => {
    if (s.view !== 'editor' || !s.dirty) return;
    if (s.project === prev.project && s.media === prev.media && s.dirty === prev.dirty) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveToLibrary().catch((err) => useStore.getState().notify('Não foi possível salvar sozinho: ' + String(err?.message || err), 'error'));
    }, 2500);
  });
}

export const cancelAutosave = () => clearTimeout(timer);
