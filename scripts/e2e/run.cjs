// Testes de ponta a ponta do app de PC. Abre o Electron de verdade, gera mídia de teste com o FFmpeg
// e usa a interface (cliques e arrastes reais) + o estado interno (window.__ve, só em desenvolvimento).
//
//   npm run test:e2e            (todos)
//   npm run test:e2e -- boot    (só os testes cujo nome contém "boot")
//
// Capturas de tela e o relatório ficam em %TEMP%\video-editor-e2e (ou em VE_OUT).
const { app, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.VE_OUT || path.join(os.tmpdir(), 'video-editor-e2e');
const MEDIA = path.join(OUT, 'media');
const LIB = path.join(OUT, 'library');
const FF = require(path.join(ROOT, 'node_modules', 'ffmpeg-static'));
const FFPROBE = require(path.join(ROOT, 'node_modules', 'ffprobe-static')).path;
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('.cjs') && !a.includes('electron'))[0] || process.env.VE_FILTER || '';
// Com filtro, estes sempre rodam antes (montam o projeto de teste).
const SETUP = ['boot', 'projeto: criar', 'mídia', 'linha do tempo'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// VE_PROD=1: testa a versão compilada (dist), como o usuário vai usar. Padrão: servidor de desenvolvimento.
if (!process.env.VE_PROD) process.env.VITE_DEV = '1';
process.env.VE_E2E = '1';
process.env.VE_LIB_DIR = LIB;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(MEDIA, { recursive: true });
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('js-flags', '--expose-gc');

const results = [];
const consoleErrors = [];
let reportLines = [];
const report = (line) => {
  reportLines.push(line);
  fs.writeFileSync(path.join(OUT, 'relatorio.txt'), reportLines.join('\n'));
  console.log(line);
};

// ---------- mídia de teste ----------
function makeMedia() {
  const ff = (...a) => execFileSync(FF, ['-v', 'error', '-y', ...a]);
  const m = {};
  m.vidA = path.join(MEDIA, 'a-720p.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '15', '-c:a', 'aac', '-shortest', m.vidA);
  m.vidB = path.join(MEDIA, 'b-1080p.mp4');
  ff('-f', 'lavfi', '-i', 'smptehdbars=size=1920x1080:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=3', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', m.vidB);
  m.vidV = path.join(MEDIA, 'v-vertical.mp4');
  ff('-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', m.vidV);
  m.img = path.join(MEDIA, 'img.png');
  ff('-f', 'lavfi', '-i', 'testsrc2=size=1600x900', '-frames:v', '1', m.img);
  m.aud = path.join(MEDIA, 'music.wav');
  ff('-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', m.aud);
  return m;
}

// ---------- ajudantes ----------
let win = null;
const js = (code) => win.webContents.executeJavaScript(code, true);
const shot = async (name) => fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
const waitFor = async (fn, ms = 8000, label = 'condição') => {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`tempo esgotado esperando: ${label}`);
    await sleep(60);
  }
};
const q = (sel) => js(`!!document.querySelector(${JSON.stringify(sel)})`);
const text = (sel) => js(`document.querySelector(${JSON.stringify(sel)})?.textContent?.trim() ?? null`);
const click = (sel, txt) => js(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})]; const el = ${txt ? `els.find((b) => b.textContent.trim().startsWith(${JSON.stringify(txt)}))` : 'els[0]'}; if (!el) return false; el.click(); return true; })()`);
const state = (expr) => js(`(() => { const s = window.__ve.useStore.getState(); return ${expr}; })()`);
const rect = (sel) => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; })()`);
const mouse = (type, x, y, extra = {}) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...extra });
async function drag(x0, y0, x1, y1, steps = 12) {
  mouse('mouseMove', x0, y0);
  mouse('mouseDown', x0, y0, { button: 'left', clickCount: 1 });
  for (let i = 1; i <= steps; i++) { mouse('mouseMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); await sleep(16); }
  mouse('mouseUp', x1, y1, { button: 'left', clickCount: 1 });
  await sleep(80);
}
const key = async (k, mods = []) => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods }); await sleep(60); };
const probe = (f) => JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', f]).toString());
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg); };
const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) throw new Error(`${msg}: esperado ≈${b} (±${tol}), veio ${a}`); };

let M = null;
async function importAll(files) {
  await js(`(async () => { await window.api.allowPaths(${JSON.stringify(files)}); await window.__ve.ops.importPaths(${JSON.stringify(files)}); })()`);
  await waitFor(() => state(`s.media.length >= ${files.length}`), 15000, 'mídia importada');
}
const newProject = async (aspect = '16:9') => {
  await js(`window.__ve.ops.createProject({ aspect: ${JSON.stringify(aspect)} })`);
  await waitFor(() => state(`s.view === 'editor'`), 5000, 'editor aberto');
  await sleep(250);
};


// Perfil de CPU (VE_PROFILE=1): mostra as funções que mais gastam tempo durante "fn".
async function profile(label, fn) {
  if (!process.env.VE_PROFILE) return fn();
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Profiler.enable');
  await dbg.sendCommand('Profiler.start');
  const r = await fn();
  const { profile: prof } = await dbg.sendCommand('Profiler.stop');
  const self = new Map();
  const dt = prof.timeDeltas;
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  prof.samples.forEach((id, i) => {
    const n = byId.get(id);
    const k = `${n.callFrame.functionName || '(anon)'} ${String(n.callFrame.url).split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`;
    self.set(k, (self.get(k) || 0) + (dt[i] || 0));
  });
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `   ${(v / 1000).toFixed(0).padStart(5)} ms  ${k}`);
  console.log(`   PERFIL ${label}:\n${top.join('\n')}`);
  return r;
}

// ---------- os testes ----------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('boot: tela de projetos abre sem erros', async () => {
  await waitFor(() => q('.home'), 8000, 'tela inicial');
  // preferências de execuções anteriores (seções abertas, tema, painéis...) não podem contaminar os testes
  await js(`localStorage.clear(); location.reload()`);
  await sleep(1500);
  await waitFor(() => q('.home'), 8000, 'tela inicial depois de limpar as preferências');
  const nav = await js(`(() => { const n = performance.getEntriesByType('navigation')[0]; const fp = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fp ? Math.round(fp.startTime) : null }; })()`);
  console.log('   carregamento da janela (ms):', JSON.stringify(nav));
  ok(nav.fcp === null || nav.fcp < 2500, 'primeira pintura demorou ' + nav.fcp + ' ms');
  eq(await state(`s.view`), 'home', 'view inicial');
  ok(await q('.home-empty'), 'estado vazio deveria aparecer sem projetos');
  await shot('01-home-vazio');
});

test('projeto: criar pela interface (Novo projeto → Horizontal)', async () => {
  await click('.home-empty .primary');
  await waitFor(() => q('.newproj-tile'), 3000, 'diálogo de formato');
  await click('.newproj-tile', 'Horizontal');
  await waitFor(() => state(`s.view === 'editor'`), 5000, 'editor');
  eq(await state(`s.project.settings.aspect`), '16:9', 'proporção');
  ok(await q('.timeline') && await q('.inspector') && await q('.left-panel'), 'painéis do editor');
});

test('mídia: importar vídeo, imagem e áudio', async () => {
  M = makeMedia();
  await importAll([M.vidA, M.vidB, M.vidV, M.img, M.aud]);
  const media = await state(`s.media.map((m) => ({ n: m.name, t: m.type, w: m.width, h: m.height, d: +m.duration.toFixed(1), a: m.hasAudio }))`);
  const by = Object.fromEntries(media.map((m) => [m.n, m]));
  eq([by['a-720p.mp4'].t, by['a-720p.mp4'].w, by['a-720p.mp4'].h, by['a-720p.mp4'].d, by['a-720p.mp4'].a], ['video', 1280, 720, 4, true], 'vídeo A');
  eq([by['b-1080p.mp4'].w, by['b-1080p.mp4'].d], [1920, 3], 'vídeo B');
  eq(by['img.png'].t, 'image', 'imagem');
  eq(by['music.wav'].t, 'audio', 'áudio');
  await waitFor(() => js(`document.querySelectorAll('.media-card img, .media-item img, .left-panel img').length >= 4`), 10000, 'miniaturas da biblioteca');
  await shot('02-midia');
});

test('linha do tempo: adicionar, dividir, apagar, desfazer, refazer', async () => {
  const ids = await state(`s.media.filter((m) => m.type === 'video' && m.height === 720 || m.name === 'b-1080p.mp4').map((m) => m.id)`);
  for (const id of ids) await js(`window.__ve.ops.addMediaToTimeline(window.__ve.useStore.getState().media.find((m) => m.id === ${JSON.stringify(id)}), {})`);
  eq(await state(`s.project.clips.length`), 2, 'clipes adicionados');
  near(await state(`window.__ve.useStore.getState().project.clips.reduce((m, c) => Math.max(m, c.start + (c.out - c.in) / (c.speed || 1)), 0)`), 7, 0.05, 'duração do projeto (4 s + 3 s)');
  // dividir em 2 s
  await js(`window.__ve.ops.seek(2)`);
  await js(`window.__ve.useStore.setState({ selection: [] })`);
  await js(`window.__ve.ops.splitAtPlayhead()`);
  eq(await state(`s.project.clips.length`), 3, 'após dividir');
  const parts = await state(`s.project.clips.filter((c) => c.in < 0.01 || c.start > 1.9).map((c) => +(c.out - c.in).toFixed(2))`);
  ok(parts.some((d) => Math.abs(d - 2) < 0.05), 'metades de 2 s: ' + parts);
  // apagar o selecionado e desfazer/refazer
  await js(`window.__ve.ops.deleteSelection()`);
  eq(await state(`s.project.clips.length`), 2, 'após apagar');
  await key('z', ['control']);
  eq(await state(`s.project.clips.length`), 3, 'após desfazer (Ctrl+Z)');
  await key('y', ['control']);
  eq(await state(`s.project.clips.length`), 2, 'após refazer (Ctrl+Y)');
  await key('z', ['control']);
  await shot('03-linha-do-tempo');
});

test('player: reproduz e o tempo avança; pausa; ir ao início/fim', async () => {
  await js(`window.__ve.ops.seek(0)`);
  await click('.transport .play, .play-btn, button[aria-label="Reproduzir"]');
  const t0 = await state(`s.currentTime`);
  await sleep(1200);
  const t1 = await state(`s.currentTime`);
  ok(t1 - t0 > 0.7 && t1 - t0 < 1.8, `tempo deveria avançar ~1,2 s (avançou ${(t1 - t0).toFixed(2)})`);
  await key(' ');
  await sleep(150);
  const t2 = await state(`s.currentTime`);
  await sleep(400);
  near(await state(`s.currentTime`), t2, 0.02, 'tempo parado após pausar');
  await key('Home');
  eq(await state(`s.currentTime`), 0, 'Home vai ao início');
});

test('inspetor: escala, posição e opacidade alteram o clipe (e desfazem)', async () => {
  const id = await state(`s.project.clips[0].id`);
  await js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(id)}] })`);
  await waitFor(() => q('.inspector input[type=range]'), 3000, 'sliders');
  await js(`(() => { const i = document.querySelector('.inspector input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '150'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(150);
  near(await state(`s.project.clips[0].transform?.scale ?? 1`), 1.5, 0.01, 'escala');
  await key('z', ['control']);
  near(await state(`s.project.clips[0].transform?.scale ?? 1`), 1, 0.01, 'escala após desfazer');
});

test('texto, transição, efeito e cor: aplicam no projeto', async () => {
  await js(`(async () => { window.__ve.ops.addTextPreset(window.__ve.textStyles[2]); })()`);
  eq(await state(`s.project.clips.filter((c) => c.kind === 'text').length`), 1, 'clipe de texto');
  const main = await state(`s.project.clips.filter((c) => !c.kind && c.trackId === s.project.tracks.find((t) => t.main).id).sort((a, b) => a.start - b.start).map((c) => c.id)`);
  await js(`window.__ve.ops.setTransition(${JSON.stringify(main[1])}, 'fade', 0.5)`);
  eq(await state(`s.project.clips.find((c) => c.id === ${JSON.stringify(main[1])}).transition?.type`), 'fade', 'transição');
  await js(`window.__ve.ops.toggleEffect(${JSON.stringify(main[0])}, 'glitch')`);
  ok(await state(`s.project.clips.find((c) => c.id === ${JSON.stringify(main[0])}).effects?.length === 1`), 'efeito aplicado');
  await js(`window.__ve.useStore.getState().commit((p) => { p.clips.find((c) => c.id === ${JSON.stringify(main[0])}).color = { filter: { id: 'vivid', s: 1 } }; })`);
  ok(await state(`!!s.project.clips.find((c) => c.id === ${JSON.stringify(main[0])}).color`), 'cor');
});

test('janelas: menu de contexto fecha com Esc; atalhos abrem e fecham', async () => {
  const r = await rect('.clip');
  ok(r, 'clipe na linha do tempo');
  await js(`document.querySelector('.clip').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${r.x + 20}, clientY: ${r.y + 10} }))`);
  await waitFor(() => q('.context-menu'), 2000, 'menu abre');
  await key('Escape');
  await waitFor(async () => !(await q('.context-menu')), 2000, 'menu fecha com Esc');
  await key('?', ['shift']);
  await waitFor(() => q('.shortcuts'), 3000, 'atalhos abrem');
  await click('.shortcuts .icon-btn');
  await waitFor(async () => !(await q('.shortcuts')), 2000, 'atalhos fecham');
});

test('painéis laterais: arrastar divisor muda a largura, persiste e restaura', async () => {
  const before = await rect('.left-panel');
  const bar = await rect('.vresizer[data-side=l]');
  ok(bar, 'divisor existe');
  const hit = await js(`document.elementFromPoint(${bar.x + bar.w / 2}, ${bar.y + 200})?.className`);
  await drag(bar.x + bar.w / 2, bar.y + 200, bar.x + bar.w / 2 + 90, bar.y + 200);
  const after = await rect('.left-panel');
  near(after.w - before.w, 90, 4, 'largura do painel esquerdo');
  const saved = await js(`JSON.parse(localStorage.getItem('ve.panelWidths'))`);
  near(saved.l, after.w, 2, 'largura gravada');
  await js(`document.querySelector('.vresizer[data-side=l]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await sleep(120);
  near((await rect('.left-panel')).w, before.w, 3, 'largura restaurada');
  // limite mínimo do centro: puxa o direito além do possível
  const r2 = await rect('.vresizer[data-side=r]');
  await drag(r2.x + r2.w / 2, r2.y + 200, r2.x - 900, r2.y + 200);
  ok((await rect('.preview, .stage, .player')).w >= 430, 'player não encolhe abaixo do mínimo');
  await js(`document.querySelector('.vresizer[data-side=r]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
});

test('robustez: erro num painel não derruba o editor', async () => {
  await js(`window.__ve.useStore.setState({ __crash: true })`);
  await waitFor(() => q('.boundary-panel'), 3000, 'aviso do painel');
  ok(await q('.timeline') && await q('.topbar') && await q('.left-panel'), 'resto do editor continua');
  await js(`window.__ve.useStore.setState({ __crash: false })`);
  await click('.boundary-panel .secondary');
  await waitFor(async () => !(await q('.boundary-panel')), 2000, 'painel volta ao tentar de novo');
  ok(await q('.inspector'), 'inspetor voltou');
});

test('projeto: salva sozinho, aparece na tela de projetos e reabre igual', async () => {
  const before = await state(`JSON.stringify({ n: s.project.clips.length, name: s.project.name, texts: s.project.clips.filter((c) => c.kind === 'text').length })`);
  await js(`window.__ve.useStore.getState().commit((p) => { p.name = 'Projeto E2E'; })`);
  await waitFor(() => state(`!s.dirty`), 8000, 'salvamento automático');
  await js(`window.__ve.ops.goHome()`);
  await waitFor(() => q('.proj-card'), 4000, 'cartão na tela de projetos');
  eq(await text('.proj-card h3'), 'Projeto E2E', 'nome do cartão');
  ok(await js(`!!document.querySelector('.proj-card img')`), 'miniatura do projeto');
  await shot('04-home-com-projeto');
  await click('.proj-card');
  await waitFor(() => state(`s.view === 'editor'`), 5000, 'reabriu');
  const after = await state(`JSON.stringify({ n: s.project.clips.length, name: s.project.name, texts: s.project.clips.filter((c) => c.kind === 'text').length })`);
  eq(JSON.parse(after), JSON.parse(before.replace('Projeto sem título', 'Projeto E2E')), 'projeto reaberto');
  await waitFor(() => js(`document.querySelectorAll('.clip').length >= 3`), 8000, 'clipes na linha do tempo');
});

test('exportação: gera MP4 H.264 com áudio na resolução e duração certas', async () => {
  const out = path.join(OUT, 'saida.mp4');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
  await js(`window.__ve.useStore.setState({ exportOpen: true })`);
  await waitFor(() => q('.export-modal'), 4000, 'diálogo de exportação');
  await click('.export-modal .chip, .export-modal button', '480p');
  await click('.export-modal .chip, .export-modal button', 'Menor arquivo');
  await shot('05-exportar');
  await click('.export-modal .primary');
  await waitFor(() => fs.existsSync(out) && q('.export-modal .primary, .export-done'), 90000, 'arquivo exportado').catch(() => {});
  await waitFor(() => js(`/pronto|concluíd|Exportado/i.test(document.querySelector('.export-modal')?.textContent || '')`), 90000, 'exportação concluída');
  const info = probe(out);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  eq(v.codec_name, 'h264', 'codec');
  eq(v.height, 480, 'altura');
  ok(a, 'faixa de áudio presente');
  const dur = +info.format.duration;
  ok(dur > 5.5 && dur < 8, `duração fora do esperado: ${dur}`);
  await key('Escape');
  await js(`window.__ve.useStore.setState({ exportOpen: false })`);
});


// ---------- timeline com mouse de verdade ----------
const mainClips = () => state(`s.project.clips.filter((c) => !c.kind && c.trackId === s.project.tracks.find((t) => t.main).id).sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, name: window.__ve.useStore.getState().media.find((m) => m.id === c.mediaId).name, start: +c.start.toFixed(3), dur: +((c.out - c.in) / (c.speed || 1)).toFixed(3) }))`);
const addByName = (n) => js(`window.__ve.ops.addMediaToTimeline(window.__ve.useStore.getState().media.find((m) => m.name === ${JSON.stringify(n)}), {})`);
const clipRects = () => js(`[...document.querySelectorAll('.clip:not(.text):not(.effect)')].map((el) => { const r = el.getBoundingClientRect(); return { name: el.querySelector('.clip-name')?.textContent, x: r.x, y: r.y, w: r.width, h: r.height }; })`);

test('timeline (mouse): arrastar um clipe troca a ordem na trilha principal', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB]);
  await addByName('a-720p.mp4');
  await addByName('b-1080p.mp4');
  await sleep(300);
  let order = (await mainClips()).map((c) => c.name);
  eq(order, ['a-720p.mp4', 'b-1080p.mp4'], 'ordem inicial');
  const r = await clipRects();
  const a = r.find((c) => c.name === 'a-720p.mp4'), b = r.find((c) => c.name === 'b-1080p.mp4');
  await drag(a.x + a.w / 2, a.y + a.h / 2, b.x + b.w * 0.9, b.y + b.h / 2, 20);
  await sleep(250);
  order = (await mainClips()).map((c) => c.name);
  eq(order, ['b-1080p.mp4', 'a-720p.mp4'], 'ordem depois de arrastar ' + JSON.stringify({ a, b, st: await mainClips(), z: await state('s.zoom') }));
  const gaps = await mainClips();
  near(gaps[1].start, gaps[0].dur, 0.02, 'sem espaço entre os clipes (ímã)');
  await key('z', ['control']);
  eq((await mainClips()).map((c) => c.name), ['a-720p.mp4', 'b-1080p.mp4'], 'desfazer volta a ordem');
});

test('timeline (mouse): aparar pela borda direita encurta o clipe; desfazer restaura', async () => {
  const before = (await mainClips())[0];
  const r = (await clipRects()).find((c) => c.name === 'a-720p.mp4');
  await js(`window.__ve.useStore.setState({ selection: [] })`);
  await drag(r.x + r.w - 2, r.y + r.h / 2, r.x + r.w - 2 - r.w * 0.5, r.y + r.h / 2, 14);
  await sleep(200);
  const after = (await mainClips())[0];
  ok(after.dur < before.dur - 1.5 && after.dur > 1, `duração deveria cair ~metade: ${before.dur} → ${after.dur}`);
  await key('z', ['control']);
  near((await mainClips())[0].dur, before.dur, 0.02, 'duração restaurada');
});

test('timeline: clicar na régua move o cursor; roda do mouse dá zoom', async () => {
  const ruler = await rect('.tl-ruler-row');
  const hdr = 150;
  await js(`window.__ve.ops.seek(0)`);
  mouse('mouseMove', ruler.x + hdr + 200, ruler.y + 10);
  mouse('mouseDown', ruler.x + hdr + 200, ruler.y + 10, { button: 'left', clickCount: 1 });
  mouse('mouseUp', ruler.x + hdr + 200, ruler.y + 10, { button: 'left', clickCount: 1 });
  await sleep(150);
  const t = await state(`s.currentTime`);
  ok(t > 0.5, 'cursor saiu do zero (t=' + t + ')');
  const z0 = await state(`s.zoom`);
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: ruler.x + 400, y: ruler.y + 80, deltaX: 0, deltaY: 120, canScroll: true });
  await sleep(200);
  const z1 = await state(`s.zoom`);
  ok(z1 !== z0, `zoom deveria mudar com a roda (${z0} → ${z1})`);
});

test('velocidade: 2× reduz à metade; desfazer restaura', async () => {
  const c = (await mainClips())[0];
  await js(`window.__ve.ops.setClipSpeed(${JSON.stringify(c.id)}, { speed: 2 })`);
  near((await mainClips())[0].dur, c.dur / 2, 0.03, 'duração com 2×');
  await key('z', ['control']);
  near((await mainClips())[0].dur, c.dur, 0.03, 'duração restaurada');
});

test('atalhos: copiar, colar, duplicar e excluir', async () => {
  await js(`window.__ve.ops.seek(0)`);
  const n0 = await state(`s.project.clips.length`);
  const id = (await mainClips())[0].id;
  await js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(id)}] })`);
  await key('d', ['control']);
  eq(await state(`s.project.clips.length`), n0 + 1, 'Ctrl+D duplica');
  await key('c', ['control']);
  await key('v', ['control']);
  eq(await state(`s.project.clips.length`), n0 + 2, 'Ctrl+C / Ctrl+V cola');
  await key('Delete');
  eq(await state(`s.project.clips.length`), n0 + 1, 'Delete exclui');
  await key('z', ['control']); await key('z', ['control']); await key('z', ['control']);
  eq(await state(`s.project.clips.length`), n0, 'desfazer 3× volta ao início');
});

test('recorte: C abre o diálogo e Esc fecha', async () => {
  const id = (await mainClips())[0].id;
  await js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(id)}] })`);
  await key('c');
  await waitFor(() => state(`!!s.cropClipId`), 3000, 'diálogo de recorte');
  await sleep(300);
  await shot('07-recorte');
  await key('Escape');
  await waitFor(() => state(`!s.cropClipId`), 2000, 'recorte fecha com Esc');
});

test('abas: todas as abas da esquerda e do inspetor abrem sem erro', async () => {
  const errBefore = consoleErrors.length;
  const n = await js(`document.querySelectorAll('.left-tab').length`);
  eq(n, 7, 'sete abas na esquerda');
  for (let i = 0; i < n; i++) { await js(`document.querySelectorAll('.left-tab')[${i}].click()`); await sleep(350); }
  await js(`document.querySelectorAll('.left-tab')[0].click()`);
  const ids = [await state(`s.project.clips.find((c) => !c.kind)?.id`), await state(`s.project.clips.find((c) => c.kind === 'text')?.id ?? null`)];
  for (const id of ids) {
    if (!id) continue;
    await js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(id)}] })`);
    await sleep(250);
    const k = await js(`document.querySelectorAll('.inspector .tab').length`);
    for (let i = 0; i < k; i++) { await js(`document.querySelectorAll('.inspector .tab')[${i}].click()`); await sleep(250); }
  }
  eq(consoleErrors.slice(errBefore).filter((m) => !/Security|falha simulada|ErrorBoundary|above error/i.test(m)), [], 'erros ao abrir abas');
});

test('importação: arquivo inválido mostra aviso e não quebra o editor', async () => {
  const bad = path.join(MEDIA, 'quebrado.mp4');
  fs.writeFileSync(bad, 'isto não é um vídeo');
  const nBefore = await state(`s.media.length`);
  await js(`(async () => { await window.api.allowPaths([${JSON.stringify(bad)}]); await window.__ve.ops.importPaths([${JSON.stringify(bad)}]); })()`);
  await sleep(500);
  eq(await state(`s.media.length`), nBefore, 'arquivo inválido não entra na biblioteca');
  ok(await state(`s.toast?.kind === 'error'`), 'aviso de erro aparece');
  ok(await q('.timeline'), 'editor continua de pé');
});

test('estresse: 150 clipes em 6 trilhas — zoom, cursor e seleção continuam rápidos', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA]).catch(() => {});
  await js(`(async () => {
    const { useStore } = window.__ve;
    const m = useStore.getState().media.find((x) => x.name === 'a-720p.mp4') || useStore.getState().media[0];
    useStore.getState().commit((p) => {
      for (let t = 0; t < 5; t++) p.tracks.push({ id: 'tt' + t, kind: 'video', name: 'Trilha ' + t, hidden: false, muted: false, locked: false });
      const mainId = p.tracks.find((x) => x.main).id;
      let n = 0;
      for (const tid of [mainId, ...p.tracks.filter((x) => !x.main).map((x) => x.id)]) for (let i = 0; i < 25; i++) p.clips.push({ id: 'cc' + n++, trackId: tid, mediaId: m.id, start: i * 1.6, in: 0, out: 1.5, speed: 1 });
    });
  })()`);
  await sleep(1200);
  eq(await state(`s.project.clips.length`), 150, 'clipes criados');
  const loop = (name, body) => `(async () => { const { useStore } = window.__ve; const tick = () => new Promise((r) => setTimeout(r, 0)); const t0 = performance.now(); ${body}; return (performance.now() - t0) / 30; })()`;
  const perf = {};
  perf.zoom = +(await profile('zoom', () => js(loop('zoom', `for (let i = 0; i < 30; i++) { useStore.getState().setZoom(40 + (i % 10) * 12); await tick(); }`)))).toFixed(1);
  perf.seek = +(await profile('seek', () => js(loop('seek', `for (let i = 0; i < 30; i++) { window.__ve.ops.seek(i * 0.7); await tick(); }`)))).toFixed(1);
  perf.sel = +(await profile('selecao', () => js(loop('sel', `for (let i = 0; i < 30; i++) { useStore.setState({ selection: ['cc' + (i * 4)] }); await tick(); }`)))).toFixed(1);
  console.log('   desempenho (ms por ação, 150 clipes):', JSON.stringify(perf));
  ok(perf.zoom < 90 && perf.seek < 25 && perf.sel < 45, 'ações devem levar < 90/25/45 ms: ' + JSON.stringify(perf));
  await shot('08-estresse');
});

test('layout: editor em vários tamanhos de janela (capturas + verificações)', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB, M.img]);
  for (const n of ['a-720p.mp4', 'b-1080p.mp4', 'img.png']) await addByName(n);
  await js(`window.__ve.ops.addTextPreset(window.__ve.textStyles[2])`);
  await js(`window.__ve.useStore.setState({ selection: [window.__ve.useStore.getState().project.clips[0].id], currentTime: 1 })`);
  const problems = [];
  for (const [w, h] of [[1100, 680], [1280, 720], [1600, 900], [1920, 1080], [2560, 1440]]) {
    // Telas maiores que o monitor de teste são simuladas com zoom < 1 (a janela fica do tamanho do monitor).
    const wa = screen.getPrimaryDisplay().workAreaSize;
    win.unmaximize();
    const factor = Math.min(1, wa.width / w, wa.height / h);
    win.webContents.setZoomFactor(factor);
    win.setSize(Math.round(w * factor), Math.round(h * factor));
    await sleep(900);
    const m = await js(`(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const out = { iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, left: r('.left-panel'), insp: r('.inspector'), tl: r('.timeline'), stage: r('.canvas-wrap'), top: r('.topbar') };
      out.topOverflow = [...document.querySelectorAll('.topbar > *')].some((e) => e.getBoundingClientRect().right > innerWidth + 1);
      out.clipped = [...document.querySelectorAll('.topbar button, .transport button, .tl-toolbar button')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > innerWidth + 1 || b.bottom > innerHeight + 1); }).length;
      return out;
    })()`);
    if (m.sw > m.iw + 1) problems.push(`${w}×${h}: rolagem horizontal (${m.sw} > ${m.iw})`);
    if (m.sh > m.ih + 1) problems.push(`${w}×${h}: rolagem vertical (${m.sh} > ${m.ih})`);
    if (m.topOverflow || m.clipped) problems.push(`${w}×${h}: botões fora da janela (${m.clipped})`);
    if (m.stage && m.stage.w < 280) problems.push(`${w}×${h}: player muito estreito (${m.stage.w}px)`);
    if (m.tl && m.tl.h < 170) problems.push(`${w}×${h}: linha do tempo muito baixa (${m.tl.h}px)`);
    await shot(`09-layout-${w}x${h}`);
  }
  win.webContents.setZoomFactor(1);
  win.setSize(1440, 900);
  eq(problems, [], 'problemas de layout');
});

test('arquivo .vedit: abrir pelo caminho (duplo clique no Windows) importa e abre', async () => {
  await js(`window.__ve.ops.goHome()`);
  const f = path.join(MEDIA, 'externo.vedit');
  fs.writeFileSync(f, JSON.stringify({ app: 'video-editor', version: 1, name: 'Veio de fora', settings: { aspect: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000', magnet: true, snap: true }, tracks: [{ id: 't1', kind: 'video', name: 'Principal', main: true }], clips: [], media: [] }));
  await js(`window.__ve.ops.openVeditPath(${JSON.stringify(f)})`);
  await waitFor(() => state(`s.view === 'editor' && s.project.name === 'Veio de fora'`), 5000, 'projeto de fora aberto');
  eq(await state(`s.project.settings.aspect`), '9:16', 'proporção do arquivo');
  const bad = path.join(MEDIA, 'ruim.vedit');
  fs.writeFileSync(bad, '{"app":"outro"}');
  await js(`window.__ve.ops.openVeditPath(${JSON.stringify(bad)})`);
  await waitFor(() => state(`s.toast?.kind === 'error'`), 3000, 'aviso para arquivo que não é projeto');
});

test('transições: todas as 18 têm valores válidos e terminam no estado normal', async () => {
  const r = await js(`(() => {
    const { transitions: T } = window.__ve;
    const out = { types: T.TRANSITIONS.length, bad: [] };
    for (const [type] of T.TRANSITIONS) {
      const A = { id: 'A', trackId: 't', start: 0, in: 0, out: 3, speed: 1 };
      const B = { id: 'B', trackId: 't', start: 2, in: 0, out: 3, speed: 1, transition: { type, dur: 1 } };
      const project = { clips: [A, B] };
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        const mb = T.transitionMods(project, B, u * 1, 3);
        const ma = T.transitionMods(project, A, 2 + u * 1, 3);
        for (const m of [mb, ma]) for (const [k, v] of Object.entries(m)) if (!Number.isFinite(v)) out.bad.push(type + ' ' + k + ' NaN em u=' + u);
        if (mb.opacity < -1e-9 || mb.opacity > 1 + 1e-9 || ma.opacity < -1e-9 || ma.opacity > 1 + 1e-9) out.bad.push(type + ' opacidade fora de 0..1');
      }
      const end = T.transitionMods(project, B, 1, 3);
      if (Math.abs(end.dx) + Math.abs(end.dy) + Math.abs(end.rotation) + Math.abs(end.blur) > 1e-6 || Math.abs(end.scale - 1) > 1e-6 || Math.abs(end.opacity - 1) > 1e-6) out.bad.push(type + ' não termina em estado normal: ' + JSON.stringify(end));
      const start = T.transitionMods(project, B, 0, 3);
      const moved = Math.abs(start.dx) + Math.abs(start.dy) + Math.abs(start.rotation) + Math.abs(start.blur) + Math.abs(start.scale - 1) + (1 - start.opacity);
      if (moved < 0.05) out.bad.push(type + ' não muda nada no início');
    }
    return out;
  })()`);
  eq(r.types, 18, 'quantidade de transições');
  eq(r.bad, [], 'problemas nas transições');
});

test('memória: abrir e fechar o editor 12× não vaza memória', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB, M.img]);
  for (const n of ['a-720p.mp4', 'b-1080p.mp4', 'img.png']) await addByName(n);
  await js(`window.__ve.useStore.getState().commit((p) => { p.name = 'Vazamento' })`);
  await waitFor(() => state(`!s.dirty`), 8000, 'salvo');
  const heap = () => js(`(async () => { for (let i = 0; i < 3; i++) { gc(); await new Promise((r) => setTimeout(r, 60)); } return Math.round(performance.memory.usedJSHeapSize / 1048576); })()`);
  const cycle = async () => {
    await js(`window.__ve.ops.goHome()`);
    await waitFor(() => q('.proj-card'), 4000, 'lista');
    await click('.proj-card');
    await waitFor(() => js(`document.querySelectorAll('.clip').length >= 3`), 8000, 'clipes');
    await sleep(500);
  };
  for (let i = 0; i < 3; i++) await cycle();
  const h0 = await heap();
  for (let i = 0; i < 12; i++) await cycle();
  const h1 = await heap();
  console.log(`   heap JS: ${h0} MB → ${h1} MB depois de 12 ciclos`);
  ok(h1 - h0 < 25, `memória cresceu ${h1 - h0} MB em 12 ciclos`);
});

test('player: toca o projeto inteiro (vídeo, vídeo, imagem) até o fim e para sozinho', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB, M.img]);
  for (const n of ['a-720p.mp4', 'b-1080p.mp4', 'img.png']) await addByName(n);
  await js(`window.__ve.ops.seek(0)`);
  const total = await state(`window.__ve.useStore.getState().project.clips.reduce((m, c) => Math.max(m, c.start + (c.out - c.in) / (c.speed || 1)), 0)`);
  near(total, 12, 0.05, 'duração total');
  const t0 = Date.now();
  await key(' ');
  // amostra o tempo a cada 250 ms: nunca pode voltar, nem ficar parado por mais de 600 ms
  let last = 0, lastMove = Date.now(), worstGap = 0, jumps = 0;
  await waitFor(async () => {
    const t = await state(`s.currentTime`);
    if (t < last - 0.05) jumps++;
    if (t > last + 0.001) { worstGap = Math.max(worstGap, Date.now() - lastMove); lastMove = Date.now(); }
    last = t;
    return !(await state(`s.playing`)) && t > total - 0.3;
  }, 20000, 'chegar ao fim');
  const wall = (Date.now() - t0) / 1000;
  console.log(`   reprodução: ${wall.toFixed(1)} s reais para ${total} s de vídeo; maior parada ${worstGap} ms; recuos ${jumps}`);
  ok(wall > total - 0.5 && wall < total + 2.5, `tempo real fora do esperado: ${wall}`);
  eq(jumps, 0, 'o tempo nunca deve voltar durante a reprodução');
  ok(worstGap < 700, `parada de ${worstGap} ms durante a reprodução`);
});

test('exportação completa: look + câmera + efeito + transição + texto + velocidade', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB, M.img, M.aud]);
  for (const n of ['a-720p.mp4', 'b-1080p.mp4', 'img.png']) await addByName(n);
  const ids = await mainClips().then((l) => l.map((c) => c.id));
  const cat = await js(`({ look: window.__ve.catalog.LOOKS[3].id, cam: window.__ve.catalog.CAMERAS[2].id, fx: window.__ve.catalog.EFFECTS[1][0] })`);
  await js(`window.__ve.useStore.getState().commit((p) => { p.clips.find((c) => c.id === ${JSON.stringify(ids[0])}).color = { look: { id: ${JSON.stringify(cat.look)}, intensity: 1 }, camera: { id: ${JSON.stringify(cat.cam)}, intensity: 1 }, vignette: 0.3 }; })`);
  await js(`window.__ve.ops.toggleEffect(${JSON.stringify(ids[1])}, ${JSON.stringify(cat.fx)})`);
  await js(`window.__ve.ops.setTransition(${JSON.stringify(ids[1])}, 'whipL', 0.5)`);
  await js(`window.__ve.ops.setTransition(${JSON.stringify(ids[2])}, 'pop', 0.5)`);
  await js(`window.__ve.ops.setClipSpeed(${JSON.stringify(ids[2])}, { speed: 1.5 })`);
  await js(`window.__ve.ops.addTextPreset(window.__ve.textStyles[3])`);
  await addByName('music.wav');
  const expected = await state(`window.__ve.useStore.getState().project.clips.reduce((m, c) => Math.max(m, c.start + (c.out - c.in) / (c.speed || 1)), 0)`);
  const out = path.join(OUT, 'completo.mp4');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
  await js(`window.__ve.useStore.setState({ exportOpen: true })`);
  await waitFor(() => q('.export-modal'), 4000, 'diálogo de exportação');
  await click('.export-modal button', '480p');
  await click('.export-modal button', 'Menor arquivo');
  await click('.export-modal .primary');
  await waitFor(() => js(`/pronto|concluíd|Exportado/i.test(document.querySelector('.export-modal')?.textContent || '')`), 180000, 'exportação concluída');
  const info = probe(out);
  const v = info.streams.find((x) => x.codec_type === 'video');
  ok(info.streams.some((x) => x.codec_type === 'audio'), 'tem áudio');
  eq(v.height, 480, 'altura');
  near(+info.format.duration, expected, 0.6, 'duração exportada');
  // não pode sair tudo preto: confere o brilho médio de um quadro do meio
  const lum = execFileSync(FF, ['-v', 'error', '-ss', '3', '-i', out, '-frames:v', '1', '-vf', 'scale=16:9,format=gray', '-f', 'rawvideo', '-']).reduce((a, b) => a + b, 0) / (16 * 9);
  ok(lum > 12, 'quadro do meio muito escuro: ' + lum.toFixed(1));
  await js(`window.__ve.useStore.setState({ exportOpen: false })`);
});

test('varredura: todos os filtros, looks, câmeras, efeitos e textos desenham sem erro', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.img]);
  await addByName('img.png');
  const id = (await mainClips())[0].id;
  await js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(id)}], currentTime: 1 }); window.__ve.ops.seek(1)`);
  const errBefore = consoleErrors.length;
  const res = await js(`(async () => {
    const { useStore, engine, catalog } = window.__ve;
    const id = ${JSON.stringify(id)};
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const canvas = () => document.querySelector('.canvas-wrap canvas');
    const lum = () => { const c = canvas(); const t = document.createElement('canvas'); t.width = 32; t.height = 18; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let s = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 5 || Number.isNaN(d[i])) return -1; s += (d[i] + d[i + 1] + d[i + 2]) / 3; } return s / (d.length / 4); };
    const setColor = (color) => useStore.getState().commit((p) => { const c = p.clips.find((x) => x.id === id); if (color) c.color = color; else delete c.color; });
    const bad = [];
    const check = async (label) => { await sleep(60); engine.frame(); const l = lum(); if (!(l > 3)) bad.push(label + ' (brilho ' + l.toFixed(1) + ')'); };
    engine.frame(); const base = lum();
    for (const f of catalog.FILTERS) { setColor({ filter: { id: f.id, s: 1 } }); await check('filtro ' + f.id); }
    for (const l of catalog.LOOKS) { setColor({ look: { id: l.id, intensity: 1 } }); await check('look ' + l.id); }
    for (const c of catalog.CAMERAS) { setColor({ camera: { id: c.id, intensity: 1 } }); await check('câmera ' + c.id); }
    setColor(null);
    for (const [type] of catalog.EFFECTS) {
      window.__ve.ops.toggleEffect(id, type);
      await check('efeito ' + type);
      window.__ve.ops.toggleEffect(id, type);
    }
    return { base: Math.round(base), n: catalog.FILTERS.length + catalog.LOOKS.length + catalog.CAMERAS.length + catalog.EFFECTS.length, bad };
  })()`);
  console.log(`   ${res.n} variações aplicadas (brilho base ${res.base})`);
  eq(res.bad, [], 'variações que não desenharam');
  eq(consoleErrors.slice(errBefore).filter((m) => !/Security/i.test(m)), [], 'erros no console durante a varredura');
});

test('janelas: Esc fecha atalhos, exportação, narração e "novo projeto"; clicar fora também', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await key('?', ['shift']);
  await waitFor(() => q('.shortcuts'), 3000, 'atalhos abrem');
  await key('Escape');
  await waitFor(async () => !(await q('.shortcuts')), 2000, 'atalhos fecham com Esc');
  await js(`window.__ve.useStore.setState({ exportOpen: true })`);
  await waitFor(() => q('.export-modal'), 3000, 'exportar abre');
  await key('Escape');
  await waitFor(() => state(`!s.exportOpen`), 2000, 'exportar fecha com Esc');
  await js(`window.__ve.useStore.setState({ recordOpen: true })`);
  await waitFor(() => js(`!!document.querySelector('.modal')`), 3000, 'narração abre');
  await key('Escape');
  await waitFor(() => state(`!s.recordOpen`), 2000, 'narração fecha com Esc');
  await js(`window.__ve.ops.goHome()`);
  await waitFor(() => q('.home'), 3000, 'home');
  await click('.home-head .primary, .home-actions .primary');
  await waitFor(() => q('.newproj'), 3000, 'novo projeto abre');
  await key('Escape');
  await waitFor(async () => !(await q('.newproj')), 2000, 'novo projeto fecha com Esc');
  await click('.home-head .primary, .home-actions .primary');
  await waitFor(() => q('.newproj'), 3000, 'novo projeto abre de novo');
  const back = await rect('.modal-back');
  mouse('mouseMove', 5, 5); mouse('mouseDown', 5, 5, { button: 'left', clickCount: 1 }); mouse('mouseUp', 5, 5, { button: 'left', clickCount: 1 });
  await waitFor(async () => !(await q('.newproj')), 2000, 'novo projeto fecha clicando fora');
});

test('vídeo 4K e HEVC: importa, mostra miniaturas, toca sem travar e exporta', async () => {
  const v4k = path.join(MEDIA, 'uhd.mp4');
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', v4k]);
  const hevc = path.join(MEDIA, 'hevc.mp4');
  execFileSync(FF, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', hevc]);
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([v4k, hevc]);
  await addByName('uhd.mp4');
  await addByName('hevc.mp4');
  await waitFor(() => js(`document.querySelectorAll('.clip .tile').length >= 2`), 15000, 'miniaturas dos clipes 4K/HEVC');
  await js(`window.__ve.ops.seek(0)`);
  await key(' ');
  let last = 0, lastMove = Date.now(), worst = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 4500) {
    const t = await state(`s.currentTime`);
    if (t > last + 0.001) { worst = Math.max(worst, Date.now() - lastMove); lastMove = Date.now(); }
    last = t;
    await sleep(40);
  }
  await key(' ');
  console.log(`   4K+HEVC: tempo avançou ${last.toFixed(2)} s em 4,5 s reais; maior parada ${worst} ms`);
  ok(last > 3.2, 'a reprodução avançou pouco: ' + last);
  ok(worst < 900, 'parada de ' + worst + ' ms na reprodução 4K/HEVC');
  const shown = await js(`(() => { const c = document.querySelector('.canvas-wrap canvas'); const t = document.createElement('canvas'); t.width = 16; t.height = 9; const g = t.getContext('2d'); g.drawImage(c, 0, 0, 16, 9); const d = g.getImageData(0, 0, 16, 9).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4 * 3); })()`);
  ok(shown > 8, 'o player mostrou quadro preto durante o HEVC (brilho ' + shown.toFixed(1) + ')');
});

test('tema: alternar escuro/claro pelo botão e por Ctrl+Shift+L, grava a escolha', async () => {
  await js(`window.__ve.ops.goHome()`);
  await waitFor(() => q('.home .theme-btn'), 3000, 'botão de tema na tela de projetos');
  if ((await js(`document.documentElement.dataset.theme`)) === 'light') await click('.home .theme-btn'); // sobra de execução anterior
  eq(await js(`document.documentElement.dataset.theme`), 'dark', 'começa escuro');
  await click('.home .theme-btn');
  eq(await js(`document.documentElement.dataset.theme`), 'light', 'claro depois do clique');
  eq(await js(`localStorage.getItem('ve.theme')`), 'light', 'escolha gravada');
  await sleep(450);
  const bg = await js(`getComputedStyle(document.body).backgroundColor`);
  ok(/rgb\(24\d, 24\d, 24\d\)/.test(bg), 'fundo claro: ' + bg);
  await shot('10-tema-claro-home');
  await newProject();
  await importAll([M.vidA, M.img]);
  await addByName('a-720p.mp4'); await addByName('img.png');
  await js(`window.__ve.ops.addTextPreset(window.__ve.textStyles[2])`);
  await js(`window.__ve.useStore.setState({ selection: [window.__ve.useStore.getState().project.clips[0].id], currentTime: 1 })`);
  await sleep(500);
  await shot('10-tema-claro-editor');
  for (const t of [1, 3, 5]) { await js(`document.querySelectorAll('.left-tab')[${t}].click()`); await sleep(500); await shot('10-tema-claro-aba' + t); }
  await key('l', ['control', 'shift']);
  eq(await js(`document.documentElement.dataset.theme`), 'dark', 'Ctrl+Shift+L volta ao escuro');
  await key('l', ['control', 'shift']);
  await key('l', ['control', 'shift']);
  await js(`localStorage.setItem('ve.theme', 'dark')`);
});

test('fidelidade: exportar sem editar mantém cor e nitidez do original (qualidade máxima)', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA]);
  await addByName('a-720p.mp4');
  const out = path.join(OUT, 'fiel.mp4');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
  await js(`window.__ve.useStore.setState({ exportOpen: true })`);
  await waitFor(() => q('.export-modal'), 4000, 'diálogo de exportação');
  await click('.export-modal button', '720p');
  await click('.export-modal button', 'Máxima');
  await click('.export-modal .primary');
  await waitFor(() => js(`/pronto|concluíd|Exportado/i.test(document.querySelector('.export-modal')?.textContent || '')`), 120000, 'exportação concluída');
  const cp = require('child_process');
  const psnr = (f) => {
    const log = cp.spawnSync(FF, ['-hide_banner', '-i', f, '-i', M.vidA, '-filter_complex', '[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]psnr', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.replace(/\r/g, '\n');
    const m = /PSNR y:([\d.]+|inf) u:([\d.]+|inf) v:([\d.]+|inf)/.exec(log);
    ok(m, 'não consegui medir o PSNR');
    return m.slice(1).map((x) => (x === 'inf' ? 99 : +x));
  };
  // Referência: a melhor recodificação simples possível (mesmo codec e qualidade, sem passar pelo editor).
  const ideal = path.join(OUT, 'ideal.mp4');
  cp.spawnSync(FF, ['-v', 'error', '-y', '-i', M.vidA, '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', ideal]);
  const [y, u, v] = psnr(out);
  const [iy, iu, iv] = psnr(ideal);
  console.log(`   PSNR do export: Y ${y.toFixed(1)} U ${u.toFixed(1)} V ${v.toFixed(1)} dB · recodificação simples: Y ${iy.toFixed(1)} U ${iu.toFixed(1)} V ${iv.toFixed(1)} dB`);
  ok(y > iy - 1.5 && u > iu - 1.5 && v > iv - 1.5, 'o export perde mais que uma recodificação simples (cor ou detalhe alterados)');
  const sob = (f) => +(/YAVG=([\d.]+)/.exec(require('child_process').spawnSync(FF, ['-hide_banner', '-v', 'info', '-ss', '1', '-i', f, '-vframes', '1', '-vf', 'format=gray,sobel,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1] || 0);
  const a = sob(M.vidA), b = sob(out);
  console.log(`   nitidez (borda média): original ${a}, export ${b}`);
  ok(Math.abs(b / a - 1) < 0.03, `a nitidez mudou ${(100 * (b / a - 1)).toFixed(1)}% (limite 3%)`);
  await js(`window.__ve.useStore.setState({ exportOpen: false })`);
});

test('auditoria: clica em todos os botões de todas as abas (sem erro, sem tela quebrada)', async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB, M.img, M.aud]);
  for (const n of ['a-720p.mp4', 'b-1080p.mp4', 'img.png']) await addByName(n);
  await addByName('music.wav');
  await js(`window.__ve.ops.addTextPreset(window.__ve.textStyles[1])`);
  const ids = await js(`(() => { const s = window.__ve.useStore.getState(); const med = (c) => s.media.find((m) => m.id === c.mediaId); return { vid: s.project.clips.find((c) => !c.kind && med(c)?.name === 'a-720p.mp4').id, img: s.project.clips.find((c) => !c.kind && med(c)?.name === 'img.png').id, aud: s.project.clips.find((c) => !c.kind && med(c)?.name === 'music.wav').id, txt: s.project.clips.find((c) => c.kind === 'text').id }; })()`);
  const SKIP = /^(Excluir|Remover|Limpar|Exportar|Novo projeto|Importar|Abrir arquivo|Gravar|Estabilizar|Reverso|Congelar|Projetos)/i;
  const report = [];
  let clicked = 0;
  const errBase = () => consoleErrors.length;
  const audit = async (label, scopeSel, sel) => {
    const n = await js(`document.querySelectorAll(${JSON.stringify(scopeSel + ' ' + sel)}).length`);
    for (let i = 0; i < n; i++) {
      const info = await js(`(() => { const el = document.querySelectorAll(${JSON.stringify(scopeSel + ' ' + sel)})[${i}]; if (!el) return null; const t = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().slice(0, 40); const r = el.getBoundingClientRect(); return { t, off: el.disabled || r.width === 0 || r.height === 0, cls: el.className?.toString?.().slice(0, 40) }; })()`);
      if (!info || info.off || SKIP.test(info.t)) continue;
      const e0 = errBase();
      clicked++;
      await js(`document.querySelectorAll(${JSON.stringify(scopeSel + ' ' + sel)})[${i}]?.click()`);
      await sleep(70);
      // fecha qualquer janela/menu que o clique tenha aberto e volta ao editor
      for (let k = 0; k < 3; k++) {
        if (await js(`!!document.querySelector('.modal-backdrop, .modal-back, .context-menu, .popover')`)) { await key('Escape'); await sleep(60); }
      }
      if ((await state(`s.view`)) !== 'editor') { await js(`window.__ve.useStore.setState({ view: 'editor' })`); report.push(`${label} · "${info.t}" levou para a tela de projetos`); }
      if (await q('.boundary-panel, .boundary-app')) { report.push(`${label} · "${info.t}" quebrou um painel`); await click('.boundary-panel .secondary'); }
      const errs = consoleErrors.slice(e0).filter((m) => !/Security|falha simulada|ErrorBoundary|above error|moov atom/i.test(m));
      if (errs.length) report.push(`${label} · "${info.t}": ${errs[0].slice(0, 160)}`);
    }
  };
  const sel = (id) => js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(id)}], currentTime: 1 })`);
  // abas da esquerda (com um vídeo selecionado)
  await sel(ids.vid);
  const nTabs = await js(`document.querySelectorAll('.left-tab').length`);
  for (let t = 0; t < nTabs; t++) {
    await js(`document.querySelectorAll('.left-tab')[${t}].click()`);
    await sleep(350);
    await audit('esquerda ' + t, '.left-panel', 'button:not(.left-tab)');
    await sel(ids.vid);
  }
  // inspetor: cada aba de cada tipo de clipe
  for (const [kind, id] of Object.entries(ids)) {
    await sel(id);
    await sleep(250);
    const tabs = await js(`document.querySelectorAll('.inspector .tab').length`);
    for (let t = 0; t < tabs; t++) {
      await js(`document.querySelectorAll('.inspector .tab')[${t}].click()`);
      await sleep(250);
      const name = await js(`document.querySelectorAll('.inspector .tab')[${t}]?.textContent`);
      await audit(`inspetor ${kind}/${name}`, '.inspector .panel-scroll', 'button');
      await sel(id);
    }
  }
  // barra do player e da linha do tempo
  await sel(ids.vid);
  await audit('player', '.preview-panel', '.transport button, .transport .icon-btn');
  await audit('barra da linha do tempo', '.tl-toolbar', 'button');
  console.log(`   ${clicked} botões clicados`);
  if (report.length) console.log('   ACHADOS:\n   - ' + report.join('\n   - '));
  eq(report, [], 'botões com problema');
});

// ---------- funcional: cada item dos painéis faz o que promete ----------
const setupFx = async () => {
  await js(`window.__ve.ops.goHome()`);
  await newProject();
  await importAll([M.vidA, M.vidB, M.img]);
  for (const n of ['a-720p.mp4', 'b-1080p.mp4', 'img.png']) await addByName(n);
  const cl = await mainClips();
  await js(`window.__ve.useStore.setState({ selection: [${JSON.stringify(cl[1].id)}], currentTime: 1 })`);
  return cl;
};
const leftTab = async (i) => { await js(`document.querySelectorAll('.left-tab')[${i}].click()`); await sleep(350); };
const openSection = (title) => js(`(() => { const b = [...document.querySelectorAll('.inspector .section-toggle')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(title)})); if (b && b.getAttribute('aria-expanded') === 'false') b.click(); return !!b; })()`);
const clipOf = (id) => state(`window.__ve.useStore.getState().project.clips.find((c) => c.id === ${JSON.stringify(id)})`);

test('funcional: as 18 transições do painel aplicam no clipe selecionado', async () => {
  const cl = await setupFx();
  await leftTab(4);
  const total = await js(`document.querySelectorAll('.left-panel .tr-card').length - 1`);
  eq(total, 18, 'cartões de transição');
  const seen = new Set();
  for (let i = 1; i <= total; i++) {
    await js(`document.querySelectorAll('.left-panel .tr-card')[${i}].click()`);
    const t = (await clipOf(cl[1].id)).transition?.type ?? null;
    ok(t, 'cartão ' + i + ' não aplicou transição');
    seen.add(t);
  }
  eq(seen.size, 18, 'tipos diferentes aplicados');
  await js(`document.querySelectorAll('.left-panel .tr-card')[0].click()`);
  eq((await clipOf(cl[1].id)).transition ?? null, null, '"Nenhuma" remove');
});

test('funcional: todos os efeitos do painel ligam e desligam no clipe', async () => {
  const cl = await setupFx();
  await leftTab(5);
  await click('.left-panel .mask-chip', 'No clipe');
  await click('.left-panel .filter-cats .mask-chip', 'Todos');
  await sleep(300);
  const total = await js(`document.querySelectorAll('.left-panel .tr-card').length`);
  const catalog = await js(`window.__ve.catalog.EFFECTS.length`);
  eq(total, catalog, 'cartões de efeito');
  const seen = new Set();
  for (let i = 0; i < total; i++) {
    await js(`document.querySelectorAll('.left-panel .tr-card')[${i}].click()`);
    const fx = ((await clipOf(cl[1].id)).effects || []).map((e) => e.type);
    ok(fx.length === 1, `cartão ${i}: esperava 1 efeito ligado, veio ${fx.length}`);
    seen.add(fx[0]);
    await js(`document.querySelectorAll('.left-panel .tr-card')[${i}].click()`);
    eq(((await clipOf(cl[1].id)).effects || []).length, 0, `cartão ${i} desligar`);
  }
  eq(seen.size, catalog, 'efeitos distintos');
  await click('.left-panel .mask-chip', 'Na trilha de efeito');
  await js(`document.querySelectorAll('.left-panel .tr-card')[0].click()`);
  ok(await state(`s.project.clips.some((c) => c.kind === 'effect')`), 'clipe de efeito criado na trilha de efeito');
});

test('funcional: filtros, looks de cinema e câmeras do painel Cor aplicam e saem', async () => {
  const cl = await setupFx();
  await js(`[...document.querySelectorAll('.inspector .tab')].find((b) => b.textContent.trim() === 'Cor').click()`);
  await sleep(300);
  for (const [title, key, count] of [['Filtros', 'filter', 'FILTERS'], ['Looks de cinema', 'look', 'LOOKS'], ['Câmeras e lentes', 'camera', 'CAMERAS']]) {
    await openSection(title);
    await sleep(500);
    const want = await js(`window.__ve.catalog.${count}.length`);
    const sel = `(() => { const sec = [...document.querySelectorAll('.inspector .section')].find((x) => x.querySelector('.section-toggle')?.textContent.trim().startsWith(${JSON.stringify(title)})); return sec ? [...sec.querySelectorAll('.filter-card')] : []; })()`;
    const n = await js(`${sel}.length`);
    ok(n >= want, `${title}: ${n} cartões para ${want} itens`);
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      await js(`${sel}[${i}].click()`);
      const id = ((await clipOf(cl[1].id)).color || {})[key]?.id;
      if (id) seen.add(id);
    }
    ok(seen.size >= want * 0.95, `${title}: só ${seen.size} de ${want} aplicaram`);
    await js(`window.__ve.useStore.getState().commit((p) => { delete p.clips.find((c) => c.id === ${JSON.stringify(cl[1].id)}).color; })`);
    await sleep(150);
  }
});

test('funcional: estilos de texto, adesivos, legendas e modelos', async () => {
  await setupFx();
  await leftTab(3);
  await click('.left-panel button', 'Textos');
  await sleep(300);
  const n = await js(`document.querySelectorAll('.left-panel .preset-card').length`);
  ok(n >= 16, 'estilos de texto: ' + n);
  const t0 = await state(`s.project.clips.filter((c) => c.kind === 'text').length`);
  for (let i = 0; i < n; i++) { await js(`document.querySelectorAll('.left-panel .preset-card')[${i}].click()`); await sleep(40); }
  ok((await state(`s.project.clips.filter((c) => c.kind === 'text').length`)) >= t0 + 4, 'textos adicionados');
  await click('.left-panel button', 'Legendas');
  await sleep(300);
  const c0 = await state(`s.project.clips.filter((c) => c.caption).length`);
  await click('.left-panel .primary.small');
  await sleep(200);
  eq(await state(`s.project.clips.filter((c) => c.caption).length`), c0 + 1, 'legenda adicionada');
  const styles = await js(`document.querySelectorAll('.left-panel .cap-style').length`);
  ok(styles >= 5, 'estilos de legenda: ' + styles);
  for (let i = 0; i < styles; i++) await js(`document.querySelectorAll('.left-panel .cap-style')[${i}].click()`);
  await leftTab(6);
  const st = await js(`document.querySelectorAll('.left-panel .sticker-btn').length`);
  ok(st > 20, 'adesivos: ' + st);
  const k0 = await state(`s.project.clips.length`);
  await js(`document.querySelectorAll('.left-panel .sticker-btn')[0].click()`);
  eq(await state(`s.project.clips.length`), k0 + 1, 'adesivo adicionado');
  await leftTab(1);
  eq(await js(`document.querySelectorAll('.left-panel .tpl-card').length`), 9, 'modelos de projeto');
});

test('funcional: máscaras, mesclagem, espelhar e velocidade pelo inspetor', async () => {
  const cl = await setupFx();
  const tab = async (name) => { await js(`[...document.querySelectorAll('.inspector .tab')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}).click()`); await sleep(300); };
  await tab('Máscara');
  const chips = await js(`document.querySelectorAll('.inspector .mask-chip').length`);
  ok(chips >= 4, 'tipos de máscara: ' + chips);
  await js(`document.querySelectorAll('.inspector .mask-chip')[1].click()`);
  await sleep(150);
  ok((await clipOf(cl[1].id)).mask, 'máscara aplicada');
  await js(`document.querySelectorAll('.inspector .mask-chip')[0].click()`);
  await tab('Vídeo');
  await openSection('Mesclagem');
  await openSection('Virar a imagem');
  await sleep(300);
  await js(`(() => { const sel = [...document.querySelectorAll('.inspector select')].find((x) => [...x.options].some((o) => /multiplic/i.test(o.textContent))); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; const o = [...sel.options].find((o) => o.value !== 'normal'); set.call(sel, o.value); sel.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(150);
  ok((await clipOf(cl[1].id)).blend, 'modo de mesclagem aplicado');
  await click('.inspector button', 'Espelhar');
  ok((await clipOf(cl[1].id)).flipH, 'espelhar');
  await click('.inspector button', 'Espelhar');
  const d0 = (await mainClips())[1].dur;
  await js(`window.__ve.ops.setClipSpeed(${JSON.stringify(cl[1].id)}, { speed: 2 })`);
  near((await mainClips())[1].dur, d0 / 2, 0.05, 'velocidade 2×');
});

test('inspetor: arrastar o nome do controle ajusta o valor (um passo só no desfazer)', async () => {
  const cl = await setupFx();
  await js(`[...document.querySelectorAll('.inspector .tab')].find((b) => b.textContent.trim() === 'Vídeo').click()`);
  await openSection('Opacidade');
  await sleep(300);
  const r = await js(`(() => { const l = [...document.querySelectorAll('.inspector .scrub-label')].find((x) => x.textContent.trim() === 'Opacidade'); l.scrollIntoView({ block: 'center' }); const b = l.getBoundingClientRect(); return { x: b.x + 10, y: b.y + b.height / 2 }; })()`);
  const past0 = await state(`s.past.length`);
  await drag(r.x, r.y, r.x - 120, r.y, 10);
  const op = (await clipOf(cl[1].id)).transform?.opacity ?? 1;
  ok(op < 0.8 && op > 0.2, 'a opacidade deveria cair arrastando para a esquerda (veio ' + op + ')');
  eq(await state(`s.past.length`), past0 + 1, 'um único passo de desfazer');
  await key('z', ['control']);
  near((await clipOf(cl[1].id)).transform?.opacity ?? 1, 1, 0.001, 'desfazer volta a 100%');
});

test('janela mínima (1100×680): nada vaza para fora da tela', async () => {
  win.unmaximize();
  win.setSize(1100, 680);
  await sleep(600);
  const bad = await js(`(() => { const out = []; if (document.documentElement.scrollWidth > innerWidth + 1) out.push('rolagem horizontal ' + document.documentElement.scrollWidth); for (const sel of ['.topbar', '.left-panel', '.inspector', '.timeline', '.transport']) { const r = document.querySelector(sel)?.getBoundingClientRect(); if (r && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1)) out.push(sel + ' fora da janela'); } return out; })()`);
  eq(bad, [], 'vazamentos de layout em 1100×680');
  await shot('06-janela-minima');
  win.setSize(1440, 900);
});

test('voltar: mensagens de console sem erros inesperados', async () => {
  const real = consoleErrors.filter((m) => !/Electron Security Warning|Content-Security-Policy|favicon|Download the React DevTools|falha simulada|\[ErrorBoundary\]|above error occurred/i.test(m));
  eq(real, [], 'erros no console');
});

// ---------- execução ----------
app.on('browser-window-created', (_e, w) => {
  win = w;
  w.unmaximize(); w.setSize(1440, 900); w.center();
  w.webContents.on('console-message', (_ev, level, message) => { if (level >= 3) consoleErrors.push(message.slice(0, 300)); });
  w.webContents.once('did-finish-load', async () => {
    await sleep(1200);
    let failed = 0;
    for (const t of tests) {
      if (FILTER && !t.name.includes(FILTER) && !SETUP.some((n) => t.name.startsWith(n))) continue;
      const t0 = Date.now();
      try {
        const r = await t.fn();
        const skip = typeof r === 'string' && r.startsWith('SKIP');
        report(`${skip ? '○' : '✓'} ${t.name} (${Date.now() - t0} ms)${skip ? ' — ' + r : ''}`);
        results.push({ name: t.name, ok: true });
      } catch (err) {
        failed++;
        report(`✗ ${t.name}\n    ${String(err.message || err).split('\n')[0]}`);
        results.push({ name: t.name, ok: false, err: String(err.stack || err) });
        try { await shot('FALHA-' + results.length); } catch {}
      }
    }
    report(`\n${results.length - failed}/${results.length} testes passaram${failed ? `, ${failed} falharam` : ''}. Relatório e capturas: ${OUT}`);
    w.destroy();
    app.exit(failed ? 1 : 0);
  });
});

process.chdir(ROOT);
require(path.join(ROOT, 'electron', 'main.cjs'));
