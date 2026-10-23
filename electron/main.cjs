const { app, BrowserWindow, ipcMain, dialog, protocol, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { buildExport } = require('./exporter.cjs');
const { fxChain } = require('./audioFx.cjs');
const crypto = require('crypto');
const proxyJobs = new Map();

const isDev = !!process.env.VITE_DEV;
const unpacked = (p) => p.replace('app.asar', 'app.asar.unpacked');
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('ffprobe-static').path);

const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'ico', 'jfif'];
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', opus: 'audio/ogg',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp',
};

protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } },
]);

// Só servimos arquivos que o usuário escolheu (importação, arrastar ou projeto aberto).
const allowed = new Set();
const key = (p) => path.resolve(p).toLowerCase();
const allow = (p) => allowed.add(key(p));
const isAllowed = (p) => allowed.has(key(p));

let win = null;
let pendingOpen = null;
let dirty = false;
let exportProc = null;
const assetDirs = new Set();

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0e0f12',
    title: 'Video Editor',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#131418', symbolColor: '#d9dade', height: 44 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('leave-full-screen', () => win.webContents.send('window:fullscreen', false));

  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), process.env.VE_E2E ? { query: { e2e: '1' } } : undefined);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://localhost:5173')) e.preventDefault(); });

  // Se a tela do editor travar ou cair, oferece reiniciar (o projeto é salvo sozinho a cada alteração).
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit' || d.reason === 'killed') return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      buttons: ['Reiniciar o editor', 'Fechar'],
      defaultId: 0,
      cancelId: 1,
      title: 'O editor parou',
      message: 'A janela do editor foi encerrada por um erro inesperado.',
      detail: 'Seus projetos ficam salvos automaticamente na biblioteca. Ao reiniciar, é só abrir o projeto de novo.',
    });
    if (choice === 0) win.reload();
    else app.exit(1);
  });
  win.on('closed', () => {
    for (const dir of assetDirs) fs.rmSync(dir, { recursive: true, force: true });
  });
  win.on('close', (e) => {
    if (!dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Sair sem salvar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
      title: 'Alterações não salvas',
      message: 'O projeto tem alterações não salvas.',
      detail: 'Se sair agora, as alterações desde o último salvamento serão perdidas.',
    });
    if (choice === 1) e.preventDefault();
    else if (exportProc) exportProc.kill('SIGKILL');
  });
}

function handleMediaProtocol() {
  protocol.handle('media', async (req) => {
    const filePath = decodeURIComponent(new URL(req.url).pathname.slice(1));
    if (!isAllowed(filePath)) return new Response('Forbidden', { status: 403 });
    let stat;
    try { stat = await fs.promises.stat(filePath); } catch { return new Response('Not found', { status: 404 }); }
    const size = stat.size;
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };
    const range = req.headers.get('range');
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
      let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) },
    });
  });
}

function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, ...opts });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').slice(-4).join('\n') || `código ${code}`))));
  });
}

const parseRate = (r) => {
  if (!r) return 0;
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : a || 0;
};

function rotationOf(stream) {
  if (!stream) return 0;
  if (stream.tags && stream.tags.rotate) return parseInt(stream.tags.rotate, 10) || 0;
  const sd = (stream.side_data_list || []).find((d) => d.rotation !== undefined);
  return sd ? Number(sd.rotation) || 0 : 0;
}

async function probe(file) {
  const j = JSON.parse((await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).toString());
  const ext = path.extname(file).slice(1).toLowerCase();
  const streams = j.streams || [];
  const vs = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const as = streams.find((s) => s.codec_type === 'audio');
  const isImage = IMAGE_EXT.includes(ext);
  // O ffprobe lê qualquer arquivo de texto como "vídeo" de arte ANSI: não é mídia.
  const TEXT_CODECS = ['ansi', 'bintext', 'xbin', 'idf', 'tty'];
  const isTextArt = !!vs && TEXT_CODECS.includes(vs.codec_name);
  const type = isImage ? 'image' : vs && !isTextArt ? 'video' : as ? 'audio' : null;
  if (!type) throw new Error('Formato não suportado');
  let width = (vs && vs.width) || 0;
  let height = (vs && vs.height) || 0;
  if (Math.abs(rotationOf(vs)) % 180 === 90) [width, height] = [height, width];
  const duration = isImage ? 0 : parseFloat((j.format && j.format.duration) || (vs && vs.duration) || (as && as.duration) || 0);
  return {
    path: file,
    name: path.basename(file),
    type,
    duration,
    width,
    height,
    hasAudio: !!as && !isImage,
    // Tem transparência (PNG/WebP/GIF com alfa, WebM com canal alfa): o exportador mantém o canal alfa.
    alpha: !!vs && (/^(rgba|bgra|argb|abgr|yuva|ya8|ya16|gbrap|pal8)/.test(vs.pix_fmt || '') || String((vs.tags && (vs.tags.alpha_mode || vs.tags.ALPHA_MODE)) || '') === '1'),
    fps: vs ? Math.round(parseRate(vs.avg_frame_rate || vs.r_frame_rate) * 100) / 100 : 0,
    size: Number(j.format && j.format.size) || 0,
  };
}

function splitJpegs(buf) {
  const starts = [];
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) starts.push(i);
  }
  return starts.map((s, k) => 'data:image/jpeg;base64,' + buf.subarray(s, starts[k + 1] ?? buf.length).toString('base64'));
}

async function thumbnails(file, duration, type) {
  if (type === 'image') {
    const b = await run(FFMPEG, ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'scale=-2:96', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', '-']);
    return { interval: 0, frames: splitJpegs(b) };
  }
  const count = Math.max(1, Math.min(60, Math.ceil(duration)));
  const interval = Math.max(duration / count, 0.05);
  const fast = duration > 120 ? ['-skip_frame', 'nokey'] : [];
  const b = await run(FFMPEG, ['-v', 'error', ...fast, '-i', file, '-an', '-vf', `fps=1/${interval.toFixed(4)},scale=-2:96`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '5', '-']);
  return { interval, frames: splitJpegs(b) };
}

async function waveform(file) {
  const RATE = 4000;
  const PER_PEAK = 100; // 40 picos por segundo
  const b = await run(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-']);
  const samples = Math.floor(b.length / 2);
  const peaks = new Float32Array(Math.ceil(samples / PER_PEAK));
  for (let p = 0; p < peaks.length; p++) {
    let max = 0;
    const end = Math.min(samples, (p + 1) * PER_PEAK);
    for (let i = p * PER_PEAK; i < end; i++) {
      const v = Math.abs(b.readInt16LE(i * 2));
      if (v > max) max = v;
    }
    peaks[p] = max / 32768;
  }
  return { rate: RATE / PER_PEAK, peaks };
}

// ---------- IPC ----------

function registerIpc() {
  const mediaFilters = [
    { name: 'Mídia', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
    { name: 'Vídeo', extensions: VIDEO_EXT },
    { name: 'Áudio', extensions: AUDIO_EXT },
    { name: 'Imagem', extensions: IMAGE_EXT },
  ];

  ipcMain.handle('media:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar mídia', properties: ['openFile', 'multiSelections'], filters: mediaFilters });
    if (r.canceled) return [];
    r.filePaths.forEach(allow);
    return r.filePaths;
  });

  ipcMain.handle('media:allow', (_e, paths) => {
    const exts = new Set([...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT]);
    const ok = (paths || []).filter((p) => typeof p === 'string' && exts.has(path.extname(p).slice(1).toLowerCase()));
    ok.forEach(allow);
    return ok;
  });

  const guard = (fn) => async (_e, file, ...rest) => {
    if (!isAllowed(file)) throw new Error('Arquivo não autorizado');
    return fn(file, ...rest);
  };

  // ---------- meus adesivos (Documentos\Video Editor\Adesivos) ----------
  // Qualquer imagem, GIF animado, SVG ou vídeo. GIF/APNG viram WebM com transparência (toca no player e exporta);
  // SVG é desenhado pelo app (que chama stickers:saveRaster com o PNG pronto); o resto é copiado como veio.
  const stickerDir = () => process.env.VE_STICKERS_DIR || path.join(app.getPath('documents'), 'Video Editor', 'Adesivos');
  const STICKER_MEDIA = new Set([...VIDEO_EXT, ...IMAGE_EXT, 'gif', 'apng', 'tif', 'tiff', 'avif', 'ico', 'heic', 'jfif']);
  const uniqueIn = async (dir, name) => {
    const ext = path.extname(name);
    const base = path.basename(name, ext).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 60) || 'adesivo';
    let out = path.join(dir, base + ext);
    for (let i = 2; fs.existsSync(out); i++) out = path.join(dir, `${base} (${i})${ext}`);
    return out;
  };
  const listStickers = async () => {
    const dir = stickerDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const out = [];
    for (const name of await fs.promises.readdir(dir)) {
      const file = path.join(dir, name);
      const st = await fs.promises.stat(file).catch(() => null);
      if (!st || !st.isFile()) continue;
      allow(file);
      out.push({ file, name, mtime: st.mtimeMs, video: /\.webm$|\.(mp4|mov|m4v|mkv|avi)$/i.test(name) });
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  };
  const importStickerPaths = async (paths) => {
    const dir = stickerDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const added = [];
    const svgs = [];
    const failed = [];
    for (const src of paths) {
      try {
        const ext = path.extname(src).slice(1).toLowerCase();
        const name = path.basename(src);
        if (ext === 'svg') {
          svgs.push({ name, text: await fs.promises.readFile(src, 'utf8') });
          continue;
        }
        if (ext === 'gif' || ext === 'apng') {
          const out = await uniqueIn(dir, path.basename(name, path.extname(name)) + '.alpha.webm');
          await run(FFMPEG, ['-v', 'error', '-y', '-i', src, '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '22', '-row-mt', '1', out]);
          allow(out);
          added.push(out);
          continue;
        }
        const out = await uniqueIn(dir, name);
        await fs.promises.copyFile(src, out);
        allow(out);
        try {
          await probe(out); // confirma que o app consegue abrir (senão não entra na lista)
        } catch (e) {
          await fs.promises.rm(out, { force: true });
          throw e;
        }
        added.push(out);
      } catch (e) {
        failed.push(`${path.basename(src)}: ${String(e.message || e).split('\n').pop().slice(0, 120)}`);
      }
    }
    return { added, svgs, failed };
  };
  ipcMain.handle('stickers:list', listStickers);
  ipcMain.handle('stickers:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importar adesivos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Imagens, GIFs, SVG e vídeos', extensions: [...STICKER_MEDIA, 'svg'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
    });
    if (r.canceled) return { added: [], svgs: [], failed: [] };
    return importStickerPaths(r.filePaths);
  });
  ipcMain.handle('stickers:importPaths', (_e, paths) => importStickerPaths((paths || []).filter((p) => typeof p === 'string')));
  ipcMain.handle('stickers:saveRaster', async (_e, name, bytes) => {
    const dir = stickerDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const out = await uniqueIn(dir, path.basename(String(name), path.extname(String(name))) + '.png');
    await fs.promises.writeFile(out, Buffer.from(bytes));
    allow(out);
    return out;
  });
  ipcMain.handle('stickers:remove', async (_e, file) => {
    const full = path.resolve(String(file));
    if (!full.toLowerCase().startsWith(path.resolve(stickerDir()).toLowerCase() + path.sep)) throw new Error('Fora da pasta de adesivos');
    await fs.promises.rm(full, { force: true });
  });

  ipcMain.handle('media:probe', guard(probe));
  ipcMain.handle('media:thumbs', guard(thumbnails));
  ipcMain.handle('media:waveform', guard(waveform));

  ipcMain.handle('project:save', async (_e, { data, filePath, saveAs }) => {
    let target = filePath;
    if (!target || saveAs) {
      const r = await dialog.showSaveDialog(win, {
        title: 'Salvar projeto',
        defaultPath: (data.name || 'Projeto') + '.vedit',
        filters: [{ name: 'Projeto do Video Editor', extensions: ['vedit'] }],
      });
      if (r.canceled) return null;
      target = r.filePath;
    }
    await fs.promises.writeFile(target, JSON.stringify(data, null, 2), 'utf8');
    return target;
  });

  // ---------- biblioteca de projetos (Documentos\Video Editor\Projetos) ----------
  // Cada projeto = <id>.vedit (o projeto), <id>.meta.json (dados da lista) e <id>.jpg (miniatura).
  // A lista só lê os .meta.json e as miniaturas: abrir a tela de projetos é rápido mesmo com muitos.
  const libDir = () => process.env.VE_LIB_DIR || path.join(app.getPath('documents'), 'Video Editor', 'Projetos');
  const libFile = (f) => {
    const full = path.resolve(String(f));
    const base = path.resolve(libDir());
    if (!full.toLowerCase().startsWith(base.toLowerCase() + path.sep) || !full.toLowerCase().endsWith('.vedit')) throw new Error('Projeto fora da biblioteca');
    return full;
  };
  const sidecar = (file, ext) => file.replace(/\.vedit$/i, ext);
  const newLibFile = () => path.join(libDir(), `p-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}.vedit`);
  const releaseMedia = (data) => {
    for (const c of data.clips || []) if (c.color?.lut?.path && fs.existsSync(c.color.lut.path)) allow(c.color.lut.path);
    for (const m of data.media || []) {
      m.missing = !fs.existsSync(m.path);
      if (!m.missing) allow(m.path);
    }
  };
  const readThumb = async (file) => {
    try {
      return 'data:image/jpeg;base64,' + (await fs.promises.readFile(sidecar(file, '.jpg'))).toString('base64');
    } catch {
      return null;
    }
  };
  ipcMain.handle('library:list', async () => {
    const dir = libDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const out = [];
    for (const name of await fs.promises.readdir(dir)) {
      if (!name.endsWith('.meta.json')) continue;
      try {
        const file = path.join(dir, name.replace(/\.meta\.json$/, '.vedit'));
        if (!fs.existsSync(file)) continue;
        const meta = JSON.parse(await fs.promises.readFile(path.join(dir, name), 'utf8'));
        out.push({ ...meta, file, thumb: await readThumb(file) });
      } catch {}
    }
    return out.sort((a, b) => (b.modified || 0) - (a.modified || 0));
  });
  ipcMain.handle('library:newFile', async () => {
    await fs.promises.mkdir(libDir(), { recursive: true });
    return newLibFile();
  });
  ipcMain.handle('library:save', async (_e, { file, data, meta, thumb }) => {
    const f = libFile(file);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, JSON.stringify(data), 'utf8');
    await fs.promises.writeFile(sidecar(f, '.meta.json'), JSON.stringify({ ...meta, modified: Date.now() }), 'utf8');
    if (thumb && /^data:image\/jpeg;base64,/.test(thumb)) await fs.promises.writeFile(sidecar(f, '.jpg'), Buffer.from(thumb.split(',')[1], 'base64'));
    return f;
  });
  ipcMain.handle('library:open', async (_e, file) => {
    const f = libFile(file);
    const data = JSON.parse(await fs.promises.readFile(f, 'utf8'));
    if (data.app !== 'video-editor') throw new Error('Este arquivo não é um projeto do Video Editor.');
    releaseMedia(data);
    return { filePath: f, data };
  });
  ipcMain.handle('library:delete', async (_e, file) => {
    const f = libFile(file);
    for (const p of [f, sidecar(f, '.meta.json'), sidecar(f, '.jpg')]) {
      try {
        await shell.trashItem(p); // vai para a Lixeira: dá para recuperar
      } catch {
        try { await fs.promises.rm(p, { force: true }); } catch {}
      }
    }
    return true;
  });
  ipcMain.handle('library:rename', async (_e, file, name) => {
    const f = libFile(file);
    const data = JSON.parse(await fs.promises.readFile(f, 'utf8'));
    data.name = String(name).slice(0, 80) || data.name;
    await fs.promises.writeFile(f, JSON.stringify(data), 'utf8');
    const mp = sidecar(f, '.meta.json');
    const meta = JSON.parse(await fs.promises.readFile(mp, 'utf8').catch(() => '{}'));
    await fs.promises.writeFile(mp, JSON.stringify({ ...meta, name: data.name }), 'utf8');
    return data.name;
  });
  ipcMain.handle('library:duplicate', async (_e, file) => {
    const f = libFile(file);
    const data = JSON.parse(await fs.promises.readFile(f, 'utf8'));
    data.name = `${data.name || 'Projeto'} (cópia)`.slice(0, 80);
    const nf = newLibFile();
    await fs.promises.writeFile(nf, JSON.stringify(data), 'utf8');
    const meta = JSON.parse(await fs.promises.readFile(sidecar(f, '.meta.json'), 'utf8').catch(() => '{}'));
    await fs.promises.writeFile(sidecar(nf, '.meta.json'), JSON.stringify({ ...meta, name: data.name, modified: Date.now() }), 'utf8');
    await fs.promises.copyFile(sidecar(f, '.jpg'), sidecar(nf, '.jpg')).catch(() => {});
    return nf;
  });
  // Abrir um .vedit de qualquer pasta: entra na biblioteca como cópia (o original não é mexido).
  const importVedit = async (file) => {
    const data = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    if (data.app !== 'video-editor') throw new Error('Este arquivo não é um projeto do Video Editor.');
    await fs.promises.mkdir(libDir(), { recursive: true });
    const nf = newLibFile();
    await fs.promises.writeFile(nf, JSON.stringify(data), 'utf8');
    const clips = data.clips || [];
    await fs.promises.writeFile(sidecar(nf, '.meta.json'), JSON.stringify({ name: data.name, modified: Date.now(), clips: clips.length, aspect: data.settings?.aspect, width: data.settings?.width, height: data.settings?.height, duration: 0 }), 'utf8');
    return nf;
  };
  ipcMain.handle('library:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Abrir projeto', properties: ['openFile'], filters: [{ name: 'Projeto do Video Editor', extensions: ['vedit'] }] });
    if (r.canceled) return null;
    return importVedit(r.filePaths[0]);
  });
  // Duplo clique num .vedit no Windows: o arquivo chega por argumento (ou pela 2ª instância).
  ipcMain.handle('library:importPath', (_e, file) => {
    if (typeof file !== 'string' || !/\.vedit$/i.test(file)) throw new Error('Arquivo inválido.');
    return importVedit(file);
  });
  ipcMain.handle('app:pendingOpen', () => {
    const f = pendingOpen;
    pendingOpen = null;
    return f;
  });
  ipcMain.handle('library:reveal', (_e, file) => shell.showItemInFolder(libFile(file)));

  ipcMain.handle('project:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Abrir projeto', properties: ['openFile'], filters: [{ name: 'Projeto do Video Editor', extensions: ['vedit'] }] });
    if (r.canceled) return null;
    const filePath = r.filePaths[0];
    const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    if (data.app !== 'video-editor') throw new Error('Este arquivo não é um projeto do Video Editor.');
    // LUTs usadas pelos clipes também precisam ser liberadas para leitura.
    for (const c of data.clips || []) if (c.color?.lut?.path && fs.existsSync(c.color.lut.path)) allow(c.color.lut.path);
    for (const m of data.media || []) {
      m.missing = !fs.existsSync(m.path);
      if (!m.missing) allow(m.path);
    }
    return { filePath, data };
  });

  ipcMain.handle('export:choosePath', async (_e, name, ext) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Exportar vídeo',
      defaultPath: path.join(app.getPath('videos'), `${name}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    return r.canceled ? null : r.filePath;
  });

  // Pasta temporária para as imagens dos textos de uma exportação.
  ipcMain.handle('export:assetDir', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'video-editor-assets-'));
    assetDirs.add(dir);
    return dir;
  });
  ipcMain.handle('export:writeAsset', async (_e, dir, name, data) => {
    if (!assetDirs.has(dir) || !/^[\w.-]+\.(png|cube)$/.test(name)) throw new Error('Destino inválido');
    await fs.promises.writeFile(path.join(dir, name), Buffer.from(data));
  });
  ipcMain.handle('export:cleanAssets', async (_e, dir) => {
    if (!assetDirs.has(dir)) return;
    assetDirs.delete(dir);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  ipcMain.handle('export:start', async (_e, job) => {
    if (exportProc) throw new Error('Já existe uma exportação em andamento.');
    for (const m of Object.values(job.media)) if (!isAllowed(m.path)) throw new Error('Arquivo de mídia não autorizado');
    if (job.assetDir && !assetDirs.has(job.assetDir)) throw new Error('Pasta de textos inválida');
    for (const p of Object.values(job.audioProxies || {})) if (!isAllowed(p)) throw new Error('Áudio processado não autorizado');
    const { args, script, total, temps } = buildExport(job);
    return new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, args, { windowsHide: true, cwd: os.tmpdir() });
      exportProc = p;
      let err = '';
      let buf = '';
      p.stdout.on('data', (d) => {
        buf += d;
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const m = /^out_time_us=(\d+)/.exec(line.trim());
          if (m && win) win.webContents.send('export:progress', Math.min(1, Number(m[1]) / 1e6 / total));
        }
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
      p.on('error', reject);
      p.on('close', (code, signal) => {
        exportProc = null;
        fs.promises.unlink(script).catch(() => {});
        for (const f of temps) fs.promises.unlink(f).catch(() => {});
        if (code === 0) resolve({ ok: true, path: job.output.output });
        else if (signal || code === null) { fs.promises.unlink(job.output.output).catch(() => {}); resolve({ ok: false, canceled: true }); }
        else reject(new Error(err.trim().split('\n').slice(-4).join('\n') || `FFmpeg terminou com código ${code}`));
      });
    });
  });

  ipcMain.handle('window:setTheme', (_e, t) => {
    if (!win || win.isDestroyed() || !t) return;
    win.setBackgroundColor(String(t.bg));
    if (win.setTitleBarOverlay) win.setTitleBarOverlay({ color: String(t.color), symbolColor: String(t.symbolColor), height: 44 });
  });
  ipcMain.handle('window:setFullScreen', (_e, on) => { if (win && !win.isDestroyed()) win.setFullScreen(!!on); });
  ipcMain.handle('export:cancel', () => { if (exportProc) exportProc.kill('SIGKILL'); });
  // Áudio processado (voz, redução de ruído, normalização) do arquivo inteiro.
  // Fica em cache: o mesmo arquivo com os mesmos efeitos não é processado de novo.
  ipcMain.handle('audio:proxy', async (_e, file, fx) => {
    if (!isAllowed(file)) throw new Error('Arquivo não autorizado');
    const chain = fxChain(fx);
    if (!chain) return null;
    const st = await fs.promises.stat(file);
    const key = crypto.createHash('sha1').update(`${file}|${st.mtimeMs}|${st.size}|${chain}`).digest('hex').slice(0, 24);
    const dir = path.join(app.getPath('userData'), 'audio-cache');
    await fs.promises.mkdir(dir, { recursive: true });
    const out = path.join(dir, key + '.flac');
    if (fs.existsSync(out)) {
      allow(out);
      return out;
    }
    if (!proxyJobs.has(key)) {
      const job = (async () => {
        const tmp = path.join(dir, key + '.part.flac');
        await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-vn', '-af', chain, '-ar', '48000', '-ac', '2', '-c:a', 'flac', tmp]);
        await fs.promises.rename(tmp, out);
        allow(out);
        return out;
      })().finally(() => proxyJobs.delete(key));
      proxyJobs.set(key, job);
    }
    return proxyJobs.get(key);
  });

  // Proxy de prévia: cópia leve (lado maior 1280 px, quadros-chave a cada 12) de vídeos grandes.
  // Só o player usa; a exportação continua lendo o arquivo original. Um por vez, para não
  // disputar CPU com o editor, e fica em cache (mesmo arquivo = mesmo proxy).
  let proxyQueue = Promise.resolve();
  ipcMain.handle('media:previewProxy', async (_e, file, hasAudio) => {
    if (!isAllowed(file)) throw new Error('Arquivo não autorizado');
    const key = await keyFor(file, 'pv1');
    const dir = path.join(app.getPath('userData'), 'preview-cache');
    await fs.promises.mkdir(dir, { recursive: true });
    const out = path.join(dir, key + '.mp4');
    if (fs.existsSync(out)) {
      allow(out);
      return out;
    }
    const jobKey = 'pv:' + key;
    if (!proxyJobs.has(jobKey)) {
      const job = proxyQueue.then(async () => {
        const tmp = path.join(dir, key + '.part.mp4');
        const audio = hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an'];
        const vf = "scale='if(gte(iw,ih),min(1280,iw),-2)':'if(gte(iw,ih),-2,min(1280,ih))',format=yuv420p";
        await run(FFMPEG, ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []), '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-g', '12', ...audio, '-movflags', '+faststart', '-f', 'mp4', tmp]);
        await fs.promises.rename(tmp, out);
        allow(out);
        return out;
      }).finally(() => proxyJobs.delete(jobKey));
      proxyQueue = job.catch(() => {});
      proxyJobs.set(jobKey, job);
    }
    return proxyJobs.get(jobKey);
  });

  // Narração gravada no microfone: salva em Documentos\Video Editor\Narrações como .m4a.
  ipcMain.handle('audio:saveRecording', async (_e, data) => {
    const dir = path.join(app.getPath('documents'), 'Video Editor', 'Narrações');
    await fs.promises.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const raw = path.join(dir, `narracao-${stamp}.webm`);
    const out = path.join(dir, `narracao-${stamp}.m4a`);
    await fs.promises.writeFile(raw, Buffer.from(data));
    try {
      // O arquivo do gravador não guarda a duração; convertendo, ele fica com duração e busca precisas.
      await run(FFMPEG, ['-v', 'error', '-y', '-i', raw, '-vn', '-c:a', 'aac', '-b:a', '192k', out]);
    } finally {
      fs.promises.unlink(raw).catch(() => {});
    }
    allow(out);
    return out;
  });

  // Arquivos criados pelo editor (quadros congelados, vídeos invertidos).
  const generatedDir = async () => {
    const dir = path.join(app.getPath('documents'), 'Video Editor', 'Arquivos gerados');
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  };
  const keyFor = async (file, extra) => {
    const st = await fs.promises.stat(file);
    return crypto.createHash('sha1').update(`${file}|${st.mtimeMs}|${st.size}|${extra}`).digest('hex').slice(0, 12);
  };

  // Congelar quadro: salva o quadro do instante "time" como PNG.
  ipcMain.handle('media:frame', async (_e, file, time) => {
    if (!isAllowed(file)) throw new Error('Arquivo não autorizado');
    const t = Math.max(0, Number(time) || 0);
    const out = path.join(await generatedDir(), `quadro-${path.parse(file).name.slice(0, 40)}-${await keyFor(file, t.toFixed(3))}.png`);
    if (!fs.existsSync(out)) await run(FFMPEG, ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', out]);
    allow(out);
    return out;
  });

  // Reverso: inverte o trecho [start, end] em pedaços de 2 s (inverter tudo de uma vez
  // ocuparia memória demais em vídeos longos) e junta os pedaços de trás para frente.
  ipcMain.handle('media:reverse', async (_e, file, start, end, hasAudio) => {
    if (!isAllowed(file)) throw new Error('Arquivo não autorizado');
    const s0 = Math.max(0, Number(start) || 0);
    const s1 = Math.max(s0 + 0.05, Number(end) || 0);
    const out = path.join(await generatedDir(), `reverso-${path.parse(file).name.slice(0, 40)}-${await keyFor(file, `${s0.toFixed(3)}-${s1.toFixed(3)}`)}.mp4`);
    if (fs.existsSync(out)) {
      allow(out);
      return out;
    }
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'video-editor-rev-'));
    try {
      const CHUNK = 2;
      const parts = [];
      const count = Math.ceil((s1 - s0) / CHUNK - 1e-6);
      for (let k = 0; k < count; k++) {
        const a = s0 + k * CHUNK;
        const len = Math.min(CHUNK, s1 - a);
        const part = path.join(tmp, `p${String(k).padStart(5, '0')}.mp4`);
        const audio = hasAudio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '192k'] : ['-an'];
        await run(FFMPEG, ['-v', 'error', '-y', '-ss', a.toFixed(3), '-t', len.toFixed(3), '-i', file, '-vf', 'reverse', ...audio, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', part]);
        parts.push(part);
        if (win) win.webContents.send('media:reverseProgress', (k + 1) / count);
      }
      const list = path.join(tmp, 'lista.txt');
      await fs.promises.writeFile(list, parts.reverse().map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
      await run(FFMPEG, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
    } finally {
      fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
    allow(out);
    return out;
  });

  // Estabilizar: duas passadas do vid.stab. A 1ª mede o tremor de cada quadro; a 2ª
  // compensa o movimento, suavizando o caminho da câmera, e amplia o necessário para
  // esconder as bordas. O clipe passa a usar o arquivo estabilizado (prévia = exportação).
  const STAB = { low: { shakiness: 4, smoothing: 10 }, medium: { shakiness: 6, smoothing: 20 }, high: { shakiness: 9, smoothing: 40 } };
  ipcMain.handle('media:stabilize', async (_e, file, start, end, hasAudio, level) => {
    if (!isAllowed(file)) throw new Error('Arquivo não autorizado');
    const cfg = STAB[level] || STAB.medium;
    const s0 = Math.max(0, Number(start) || 0);
    const s1 = Math.max(s0 + 0.1, Number(end) || 0);
    const out = path.join(await generatedDir(), `estavel-${path.parse(file).name.slice(0, 40)}-${await keyFor(file, `${s0.toFixed(3)}-${s1.toFixed(3)}-${level}`)}.mp4`);
    if (fs.existsSync(out)) {
      allow(out);
      return out;
    }
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'video-editor-stab-'));
    try {
      // O vid.stab não aceita "C:" no caminho do arquivo de medidas: roda dentro da pasta temporária.
      const cut = ['-ss', s0.toFixed(3), '-t', (s1 - s0).toFixed(3), '-i', file];
      if (win) win.webContents.send('media:stabilizeProgress', 0.05);
      await run(FFMPEG, ['-v', 'error', '-y', ...cut, '-vf', `vidstabdetect=shakiness=${cfg.shakiness}:accuracy=15:result=medidas.trf`, '-f', 'null', '-'], { cwd: tmp });
      if (win) win.webContents.send('media:stabilizeProgress', 0.5);
      const audio = hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an'];
      await run(FFMPEG, ['-v', 'error', '-y', ...cut, '-vf', `vidstabtransform=input=medidas.trf:smoothing=${cfg.smoothing}:optzoom=1:interpol=bicubic,unsharp=5:5:0.6:3:3:0`, ...audio, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { cwd: tmp });
      if (win) win.webContents.send('media:stabilizeProgress', 1);
    } finally {
      fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
    allow(out);
    return out;
  });

  // LUTs (.cube) importadas pelo usuário.
  ipcMain.handle('lut:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar LUT', properties: ['openFile'], filters: [{ name: 'LUT 3D (.cube)', extensions: ['cube'] }] });
    if (r.canceled) return null;
    const p = r.filePaths[0];
    allow(p);
    return { path: p, name: path.basename(p) };
  });
  ipcMain.handle('lut:read', async (_e, p) => {
    if (!isAllowed(p) || path.extname(p).toLowerCase() !== '.cube') throw new Error('LUT não autorizada');
    return fs.promises.readFile(p, 'utf8');
  });

  // Legendas: abrir e salvar arquivos .srt (o conteúdo vai e volta como texto).
  ipcMain.handle('srt:open', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importar legendas', properties: ['openFile'], filters: [{ name: 'Legendas (.srt)', extensions: ['srt'] }] });
    if (r.canceled) return null;
    const buf = await fs.promises.readFile(r.filePaths[0]);
    if (buf.length > 5 * 1024 * 1024) throw new Error('Arquivo de legenda grande demais');
    return { name: path.basename(r.filePaths[0]), text: buf.toString('utf8') };
  });
  ipcMain.handle('srt:save', async (_e, text, suggested) => {
    const name = String(suggested || 'legendas').replace(/[<>:"/\\|?*]+/g, '-');
    const r = await dialog.showSaveDialog(win, { title: 'Exportar legendas', defaultPath: path.join(app.getPath('documents'), `${name}.srt`), filters: [{ name: 'Legendas (.srt)', extensions: ['srt'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.writeFile(r.filePath, '﻿' + String(text), 'utf8');
    return r.filePath;
  });

  ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));
  ipcMain.on('app:dirty', (_e, value) => { dirty = !!value; });
}

// Desempenho: usa a placa de vídeo mesmo em PCs que o Chromium põe na "lista de bloqueio" e deixa o
// desenho e a decodificação de vídeo na GPU.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Uma só janela do app: abrir outro .vedit com ele já aberto manda o arquivo para a janela existente.
const veditArg = (argv) => argv.slice(1).find((a) => /\.vedit$/i.test(a) && fs.existsSync(a));
if (!isDev && !process.env.VE_E2E && !app.requestSingleInstanceLock()) app.quit();
else {
  pendingOpen = veditArg(process.argv) || null;
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = veditArg(argv);
    if (f) win.webContents.send('app:openFile', f);
  });
}

app.whenReady().then(() => {
  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; img-src 'self' data: blob: media:; media-src 'self' blob: media:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self' media:"],
        },
      });
    });
  }
  // Microfone liberado só para áudio (gravação de narração). Câmera e tela continuam bloqueadas.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) => {
    cb(permission === 'media' && (details.mediaTypes || []).every((t) => t === 'audio'));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  handleMediaProtocol();
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
