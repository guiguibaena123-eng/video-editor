// Sobe o servidor de desenvolvimento (se ainda não estiver no ar) e abre o Electron rodando
// scripts/e2e/run.cjs. (O Electron roda sem ELECTRON_RUN_AS_NODE, senão vira Node puro.)
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const electron = require('electron');
const ROOT = path.resolve(__dirname, '..', '..');

const ping = (port) => new Promise((res) => {
  const req = http.get({ host: 'localhost', port, path: '/' }, (r) => { r.resume(); res(true); });
  req.on('error', () => res(false));
  req.setTimeout(800, () => { req.destroy(); res(false); });
});

(async () => {
  let vite = null;
  if (process.env.VE_PROD) {
    // Versão compilada: gera o dist antes (só o app de PC).
    const { build } = await import('vite');
    await build({ root: ROOT, logLevel: 'warn', build: process.env.VE_NOMINIFY ? { minify: false } : {} });
  } else if (!(await ping(5173))) {
    const { createServer } = await import('vite');
    vite = await createServer({ root: ROOT, server: { port: 5173, strictPort: true }, logLevel: 'error' });
    await vite.listen();
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [path.join(__dirname, 'run.cjs'), ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: ROOT });
  child.on('exit', async (code) => {
    if (vite) await vite.close();
    process.exit(code ?? 1);
  });
})();
