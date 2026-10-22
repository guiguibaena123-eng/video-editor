// Configuração de áudio de um clipe e o áudio processado (gerado pelo FFmpeg) usado na prévia.
import { useStore } from './store';

export const DEFAULT_AUDIO = { fadeIn: 0, fadeOut: 0, denoise: 'off', voice: 'none', normalize: false };
export const withAudio = (a) => ({ ...DEFAULT_AUDIO, ...a });

export const VOICES = [
  ['none', 'Nenhum'],
  ['chipmunk', 'Esquilo'],
  ['deep', 'Grave'],
  ['monster', 'Monstro'],
  ['robot', 'Robô'],
  ['echo', 'Eco'],
  ['hall', 'Salão'],
  ['phone', 'Telefone'],
  ['megaphone', 'Megafone'],
  ['radio', 'Rádio antigo'],
  ['underwater', 'Debaixo d’água'],
];

export const DENOISE = [
  ['off', 'Desligada'],
  ['low', 'Leve'],
  ['medium', 'Média'],
  ['high', 'Forte'],
];

// Efeitos que precisam do FFmpeg (não dá para fazer igual em tempo real).
export function needsProxy(audio) {
  const a = withAudio(audio);
  return a.denoise !== 'off' || a.voice !== 'none' || a.normalize;
}
const fxOf = (audio) => {
  const a = withAudio(audio);
  return { denoise: a.denoise, voice: a.voice, normalize: !!a.normalize };
};
const keyOf = (media, audio) => {
  const f = fxOf(audio);
  return `${media.id}|${f.denoise}|${f.voice}|${f.normalize ? 1 : 0}`;
};

// Volume relativo ao fade num ponto do clipe (0 a 1).
export function fadeGain(audio, local, dur) {
  const a = withAudio(audio);
  const fi = Math.min(a.fadeIn, dur);
  const fo = Math.min(a.fadeOut, dur - fi);
  let g = 1;
  if (fi > 0.01 && local < fi) g *= Math.max(0, local / fi);
  if (fo > 0.01 && local > dur - fo) g *= Math.max(0, (dur - local) / fo);
  return g;
}

const jobs = new Map();

// Garante que o áudio processado exista; devolve o estado atual { status, path }.
export function ensureProxy(media, audio) {
  const key = keyOf(media, audio);
  const current = useStore.getState().proxies[key];
  if (current) return current;
  if (!jobs.has(key)) {
    const set = (v) => useStore.setState((s) => ({ proxies: { ...s.proxies, [key]: v } }));
    set({ status: 'pending' });
    const job = window.api
      .audioProxy(media.path, fxOf(audio))
      .then((path) => {
        set({ status: 'ready', path });
        return path;
      })
      .catch((err) => {
        set({ status: 'error', error: String(err?.message || err) });
        throw err;
      })
      .finally(() => jobs.delete(key));
    jobs.set(key, job);
  }
  return useStore.getState().proxies[key];
}

// Espera o áudio processado ficar pronto (usado antes de exportar).
export async function proxyPath(media, audio) {
  const key = keyOf(media, audio);
  const st = ensureProxy(media, audio);
  if (st.status === 'ready') return st.path;
  if (st.status === 'error') throw new Error(st.error);
  await jobs.get(key);
  return useStore.getState().proxies[key].path;
}

export function proxyState(media, audio) {
  return useStore.getState().proxies[keyOf(media, audio)];
}
