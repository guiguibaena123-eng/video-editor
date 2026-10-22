import { useStore } from '../store';
import { engine } from '../engine';

// Acompanha o tempo da linha do tempo SEM passar pelo React: o motor avisa a cada quadro (engine.onTick) e o store
// só recebe o tempo de vez em quando durante o play. Também ouve o store (arrastar a linha, pular, parar).
// fn(t) roda só quando o tempo mudou de verdade.
export function onTime(fn) {
  let last = NaN;
  const f = (t) => {
    if (t !== last) {
      last = t;
      fn(t);
    }
  };
  const un1 = useStore.subscribe((s, p) => s.currentTime !== p.currentTime && f(s.currentTime));
  const un2 = engine.onTick ? engine.onTick(f) : () => {};
  f(useStore.getState().currentTime);
  return () => {
    un1();
    un2();
  };
}

// O tempo de agora (durante o play o do store pode estar um pouco atrasado).
export const timeNow = () => (engine.timeNow ? engine.timeNow() : useStore.getState().currentTime);
