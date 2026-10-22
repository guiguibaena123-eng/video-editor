import { useEffect, useState } from 'react';

// Miniaturas desenhadas sob demanda: só quando aparecem na tela e em fatias curtas (~6 ms), para
// abrir um painel com dezenas de prévias sem travar a interface.
const jobs = [];
let timer = 0;

function pump() {
  timer = 0;
  const t0 = performance.now();
  while (jobs.length && performance.now() - t0 < 6) {
    const job = jobs.shift();
    if (!job.dead) job.fn();
  }
  if (jobs.length) timer = setTimeout(pump, 0);
}

// Agenda um desenho; devolve a função que cancela.
export function schedule(fn) {
  const job = { fn, dead: false };
  jobs.push(job);
  if (!timer) timer = setTimeout(pump, 0);
  return () => {
    job.dead = true;
  };
}

// Vira true na primeira vez que o elemento chega perto da área visível (e fica true).
export function useVisible(ref, margin = '240px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return seen;
}
