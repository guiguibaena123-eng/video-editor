import { useStore, clipEnd, projectDuration } from '../store';
import { engine } from '../engine';
import { sourceAt } from '../speed';

// Teste automático do player, para rodar no aparelho de verdade (botão "Testar" do painel de diagnóstico): toca, passa por
// uma emenda, arrasta a linha e pula, e devolve um relatório curto para colar na conversa. Usa o projeto que está aberto.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const activeClips = (s, t) => s.project.clips.filter((c) => t >= c.start && t < clipEnd(c));

// Observa desenhos, telas pretas (clipe de vídeo sem imagem), pausas do relógio de animação e o desvio do som.
function probe() {
  const rec = { draws: [], black: 0, raf: [], drift: [], sigs: new Set() };
  const od = engine.draw.bind(engine);
  engine.draw = (t, ...a) => {
    const s = useStore.getState();
    let miss = false;
    for (const c of activeClips(s, t)) {
      const m = s.media.find((x) => x.id === c.mediaId);
      if (m?.type === 'video' && !engine.sourceOf(c, t)) miss = true;
      const e = engine.entries.get(c.id);
      if (e?.fp) rec.sigs.add(c.id + ':' + e.fp.curTs);
    }
    if (miss) rec.black++;
    rec.draws.push(performance.now());
    return od(t, ...a);
  };
  let on = true;
  let last = performance.now();
  const tick = (n) => {
    if (!on) return;
    rec.raf.push(n - last);
    last = n;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const iv = setInterval(() => {
    if (!engine.playing) return;
    const s = useStore.getState();
    const t = engine.timeNow();
    for (const c of activeClips(s, t)) {
      const e = engine.entries.get(c.id);
      if (e?.el && !e.el.paused && e.live) rec.drift.push(Math.abs(e.el.currentTime - sourceAt(c, t - c.start)) * 1000);
    }
  }, 100);
  rec.stop = () => {
    on = false;
    clearInterval(iv);
    engine.draw = od;
  };
  return rec;
}

function summarize(rec, secs) {
  const gaps = [];
  for (let i = 1; i < rec.draws.length; i++) gaps.push(rec.draws[i] - rec.draws[i - 1]);
  const over = (ms) => gaps.filter((g) => g > ms).length;
  const worst = gaps.length ? Math.round(Math.max(...gaps)) : 0;
  const rafWorst = rec.raf.length ? Math.round(Math.max(...rec.raf)) : 0;
  const drift = rec.drift.length ? Math.round(rec.drift.reduce((a, b) => a + b, 0) / rec.drift.length) : null;
  return `${(rec.sigs.size / secs).toFixed(0)} quadros/s · paradas >60 ms: ${over(60)} · >120 ms: ${over(120)} · pior ${worst} ms · tela preta: ${rec.black} · pior quadro de animação ${rafWorst} ms · desvio do som ${drift == null ? '-' : drift + ' ms'}`;
}

async function playFor(from, secs) {
  engine.pause();
  useStore.setState({ currentTime: from });
  await sleep(1500); // deixa o primeiro quadro e o som prontos, como acontece antes de um play de verdade
  const rec = probe();
  const st0 = { ...engine.stats };
  engine.play();
  const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000 && engine.playing) await sleep(100);
  const real = (performance.now() - t0) / 1000;
  engine.pause();
  rec.stop();
  const resync = (engine.stats.resyncs || 0) - (st0.resyncs || 0);
  const waits = (engine.stats.waits || 0) - (st0.waits || 0);
  const rej = (engine.stats.rejects || 0) - (st0.rejects || 0);
  return `${summarize(rec, real)} · som: pulos ${resync}, esperas ${waits}${rej ? ', RECUSADO ' + rej : ''}`;
}

export async function runSelfTest(log) {
  const s = useStore.getState();
  const total = projectDuration(s.project);
  if (total <= 0.5) return log('Teste: abra um projeto com vídeo primeiro.');
  const nav = navigator;
  log(`aparelho: ${nav.userAgent.slice(0, 110)}`);
  log(`núcleos ${nav.hardwareConcurrency || '?'} · memória ${nav.deviceMemory || '?'} GB · tela ${screen.width}x${screen.height} @${devicePixelRatio} · palco ${engine.canvas?.width}x${engine.canvas?.height} · qualidade ${s.previewQuality} (escala ${s.autoScale})`);
  for (const m of s.media.filter((x) => x.type === 'video')) {
    const c = s.cache[m.id];
    const e = [...engine.entries.values()].find((x) => x.mediaId === m.id);
    log(`vídeo ${m.name.slice(0, 18)}: ${m.width}x${m.height} ${m.duration?.toFixed(1)}s · cópia leve ${c?.proxyState || 'não precisa'}${c?.proxyError ? ' (' + c.proxyError.slice(0, 70) + ')' : ''}${e?.fp ? ` · decodifica ${e.fp.src.w}x${e.fp.src.h} GOP ${e.fp.src.gop}${e.fp.src.avc ? ' H.264' : ' HEVC'}` : e?.vel ? ' · usa <video>' : ''}`);
  }
  const t0 = Math.min(0.2, total * 0.1);
  const len = Math.min(5, total - t0 - 0.2);
  log(`1) tocar do começo (${len.toFixed(0)} s): ${await playFor(t0, len)}`);

  const main = s.project.tracks.find((t) => t.main);
  const cuts = s.project.clips.filter((c) => c.trackId === main?.id).map((c) => c.start).filter((x) => x > 0.5).sort((a, b) => a - b);
  if (cuts.length) {
    const from = Math.max(0, cuts[0] - 2);
    log(`2) passar pela emenda em ${cuts[0].toFixed(1)} s (4 s): ${await playFor(from, Math.min(4, total - from - 0.1))}`);
  } else log('2) emenda: o projeto tem um clipe só (pulei)');

  // arrastar a linha: 90 passos de ~16 ms por todo o projeto
  engine.pause();
  useStore.setState({ currentTime: 0 });
  await sleep(800);
  let rec = probe();
  const ts0 = performance.now();
  for (let i = 0; i <= 90; i++) {
    useStore.setState({ currentTime: (i / 90) * (total - 0.1) });
    await sleep(16);
  }
  const dragMs = performance.now() - ts0;
  await sleep(600);
  rec.stop();
  const pic = rec.sigs.size;
  log(`3) arrastar a linha (90 passos): ${pic} imagens distintas, pior intervalo entre desenhos ${Math.round(Math.max(0, ...rec.draws.slice(1).map((d, i) => d - rec.draws[i])))} ms, tela preta ${rec.black}, durou ${Math.round(dragMs)} ms`);

  // pulos: tempo até ter a imagem certa
  const lat = [];
  for (const f of [0.15, 0.85, 0.4, 0.7, 0.05, 0.55]) {
    const tt = total * f;
    useStore.setState({ currentTime: tt });
    const a = performance.now();
    let ok = false;
    while (performance.now() - a < 2500) {
      await sleep(10);
      const cl = activeClips(useStore.getState(), tt);
      if (cl.every((c) => { const e = engine.entries.get(c.id); return !e || e.kind !== 'video' || e.fp?.ready(sourceAt(c, tt - c.start) * 1e6) || (e.vel && e.vel.readyState >= 2); })) { ok = true; break; }
    }
    lat.push(ok ? Math.round(performance.now() - a) : 'não chegou');
  }
  log(`4) pular para 6 pontos: ${lat.join(' · ')} ms até a imagem certa`);
  engine.pause();
  useStore.setState({ currentTime: 0 });
  log(`fim · decodificador ${[...engine.entries.values()].map((e) => (e.fp ? e.fp.stats.resets + ' buscas' : '-')).join(', ')} · tempo do teste ${Math.round(performance.now() / 1000)} s desde a abertura`);
}
