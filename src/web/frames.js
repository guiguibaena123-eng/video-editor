// Quadros do vídeo decodificados com WebCodecs (celular). Em vez de um <video> escondido (que demora para ligar, busca
// devagar e entrega o quadro quando quer), lemos o MP4 nós mesmos e decodificamos só os quadros que o player precisa.
// A imagem fica ligada ao relógio da linha do tempo: pular é decodificar ≤ 1 grupo de quadros; tocar é decodificar
// um pouco à frente; nada "liga" nem "esquenta". O som continua no elemento de áudio (ver liteEngine.js).
import { createFile, MP4BoxBuffer, DataStream, Endianness } from 'mp4box';

// Dá para tocar o ORIGINAL direto, sem a cópia leve? (H.264 de até Full HD cujos grupos de quadros são curtos: buscar
// decodifica poucos quadros.) Vídeo mais pesado, em outro codec ou com grupos longos continua usando a cópia leve.
// (4K e HEVC também abrem aqui — são o último recurso quando a cópia leve não pôde ser feita —, mas nunca tocam direto
// por escolha: isso fica só para H.264 até Full HD.)
export const playsDirect = (src) => !!src && src.avc && src.w * src.h <= MAX_DIRECT_PIXELS && src.gop <= (src.w * src.h > 1280 * 736 ? 48 : 90);

export const framesSupported = () => typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined' && typeof VideoFrame !== 'undefined';

const BLOCK = 24; // amostras lidas do arquivo de uma vez
const MAX_GOP = 90; // grupo de quadros maior que isso: buscar custa demais, o vídeo fica no <video>
const MAX_DIRECT_PIXELS = 1920 * 1088;
const MAX_PIXELS = 3840 * 2176; // 4K: o decodificador do aparelho dá conta; o de software, não (ver step())

// Decodificador do aparelho (hardware) é bem mais rápido, mas em alguns aparelhos demora ~500 ms para começar depois de
// uma busca. Se isso acontecer, passamos a usar o de software (previsível) e lembramos — separado para vídeo pequeno
// (a cópia leve de 540p: ~4 ms por quadro) e grande (Full HD: ~14 ms por quadro, só vale se o de hardware for pior).
const soft = { small: false, big: false, huge: false }; // 'huge' (4K) nunca vai para software: seria pior
try {
  soft.small = localStorage.getItem('ve.fpSoft.small') === '1';
  soft.big = localStorage.getItem('ve.fpSoft.big') === '1';
} catch {}
const sizeClass = (src) => (src.w * src.h <= 600 * 1000 ? 'small' : src.w * src.h > MAX_DIRECT_PIXELS ? 'huge' : 'big');
function goSoft(src) {
  const k = sizeClass(src);
  soft[k] = true;
  try {
    localStorage.setItem('ve.fpSoft.' + k, '1');
  } catch {}
}
export const decoderMode = (src) => (soft[sizeClass(src)] ? 'software' : 'hardware');

// ---------------------------------------------------------------------------------------------------------------
// Fonte: tabela de quadros de um arquivo (lida uma vez por arquivo; os bytes dos quadros são lidos sob demanda).
// ---------------------------------------------------------------------------------------------------------------
const sources = new WeakMap(); // Blob -> Promise<Source|null>

export function openSource(blob) {
  if (!blob) return Promise.resolve(null);
  let p = sources.get(blob);
  if (!p) {
    p = load(blob).catch((err) => {
      console.debug('quadros: fonte fica com o <video> —', err?.message || err);
      return null;
    });
    sources.set(blob, p);
  }
  return p;
}

async function load(blob) {
  const file = createFile();
  let info = null;
  let failed = null;
  file.onError = (er) => (failed = new Error('MP4: ' + er));
  file.onReady = (i) => (info = i);
  // O mp4box diz qual trecho precisa a seguir (vídeo gravado sem "faststart" tem o índice no fim do arquivo).
  let pos = 0;
  let size = 1024 * 1024;
  for (let iter = 0; !info && pos < blob.size && iter < 400; iter++) {
    const end = Math.min(blob.size, pos + size);
    const ab = await blob.slice(pos, end).arrayBuffer();
    const next = file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos), false);
    pos = typeof next === 'number' && Number.isFinite(next) && next >= 0 ? next : end;
    size = 4 * 1024 * 1024;
    if (failed) throw failed;
  }
  if (!info) throw new Error('índice do vídeo não encontrado');
  const vt = info.videoTracks[0];
  if (!vt) throw new Error('sem trilha de vídeo');
  const avc = /^(avc1|avc3)/.test(vt.codec);
  if (!avc && !/^(hvc1|hev1)/.test(vt.codec)) throw new Error('codec ' + vt.codec + ' fica com o <video>');
  const trak = file.getTrackById(vt.id);
  const samples = trak.samples;
  const n = samples?.length || 0;
  if (n < 2) throw new Error('poucos quadros');
  const m = vt.matrix ? Array.from(vt.matrix) : [65536, 0, 0, 65536];
  const rot = (((Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) % 360) + 360) % 360) | 0;
  const w = vt.video.width;
  const h = vt.video.height;
  if (w * h > MAX_PIXELS) throw new Error('vídeo grande demais para decodificar sem a cópia leve');

  // Edição do arquivo: câmeras com B-frames começam o relógio uns quadros antes (a lista de edição desconta isso).
  const ts = vt.timescale;
  const edit = trak.edts?.elst?.entries?.find((x) => x.media_time >= 0);
  const shift = edit ? edit.media_time / ts : 0;
  const ctsDec = new Float64Array(n); // tempo de exibição de cada amostra, em ordem de decodificação
  const dur = new Float64Array(n);
  const off = new Float64Array(n);
  const sz = new Uint32Array(n);
  const sync = new Uint8Array(n);
  let lastKey = 0;
  let gop = 0;
  let reorder = false;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    ctsDec[i] = Math.round(((s.cts / ts - shift) * 1e6));
    dur[i] = Math.round((s.duration * 1e6) / ts);
    off[i] = s.offset;
    sz[i] = s.size;
    sync[i] = s.is_sync ? 1 : 0;
    if (i && ctsDec[i] <= ctsDec[i - 1]) reorder = true;
    if (sync[i]) {
      gop = Math.max(gop, i - lastKey);
      lastKey = i;
    }
  }
  if (!sync[0]) throw new Error('começa sem quadro-chave');
  gop = Math.max(gop, n - lastKey);
  if (gop > MAX_GOP) throw new Error('grupo de quadros longo demais (' + gop + ')');
  // Ordem de exibição: rank (0..n-1) de cada amostra, e "até qual amostra decodificar" para mostrar cada rank.
  let order; // rank -> índice na ordem de decodificação
  let pts; // tempo de exibição por rank, crescente
  let need; // rank -> maior índice de decodificação necessário para mostrar todos os quadros até esse rank
  if (reorder) {
    order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => ctsDec[a] - ctsDec[b]);
    pts = new Float64Array(n);
    need = new Int32Array(n);
    let mx = 0;
    for (let r = 0; r < n; r++) {
      pts[r] = ctsDec[order[r]];
      mx = Math.max(mx, order[r]);
      need[r] = mx;
    }
  } else {
    order = Int32Array.from({ length: n }, (_, i) => i);
    pts = ctsDec;
    need = order;
  }

  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = avc ? entry.avcC : entry.hvcC;
  if (!box) throw new Error('sem configuração do codec');
  const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(s);
  const description = new Uint8Array(s.buffer, 8);
  const config = { codec: vt.codec, codedWidth: w, codedHeight: h, description, optimizeForLatency: !reorder };
  const sup = await VideoDecoder.isConfigSupported(config);
  if (!sup.supported) throw new Error('decodificador não aceita ' + vt.codec);

  const swap = rot === 90 || rot === 270;
  const duration = (pts[n - 1] + dur[order[n - 1]]) / 1e6;
  return new Source(blob, { n, cts: ctsDec, pts, order, need, dur, off, sz, sync, w, h, dw: swap ? h : w, dh: swap ? w : h, rot, reorder, config, gop, duration, avc });
}

class Source {
  constructor(blob, t) {
    this.blob = blob;
    Object.assign(this, t);
  }
  // "Rank" do quadro mostrado em "us" (microssegundos), na ordem de EXIBIÇÃO: o último com tempo <= us.
  idxAt(us) {
    const c = this.pts;
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid] <= us) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  keyAtOrBefore(i) {
    while (i > 0 && !this.sync[i]) i--;
    return i;
  }
  // Bytes das amostras do bloco b (uma leitura só do arquivo).
  async readBlock(b) {
    const i0 = b * BLOCK;
    const i1 = Math.min(this.n, i0 + BLOCK) - 1;
    const start = this.off[i0];
    const end = this.off[i1] + this.sz[i1];
    const buf = new Uint8Array(await this.blob.slice(start, end).arrayBuffer());
    const out = [];
    for (let i = i0; i <= i1; i++) out.push(buf.subarray(this.off[i] - start, this.off[i] - start + this.sz[i]));
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tocador de quadros: um decodificador por clipe. step() é chamado a cada quadro do motor com o instante do vídeo
// que a linha do tempo está mostrando; frame() é o que desenhar (um VideoFrame, valido até o próximo step()).
// ---------------------------------------------------------------------------------------------------------------
export class FramePlayer {
  constructor(src, onChange) {
    this.src = src;
    this.onChange = onChange; // chegou algo novo (bytes ou quadro): o motor deve rodar de novo
    this.dead = false;
    this.failed = null;
    this.cur = null; // quadro em exibição
    this.curTs = -1;
    this.queue = []; // quadros decodificados ainda não exibidos, em ordem de tempo
    this.blocks = new Map();
    this.reading = new Set();
    this.next = 0; // próxima amostra a enviar ao decodificador
    this.runKey = -1; // quadro-chave onde começou a sequência atual
    this.goal = 0; // até onde enviar ao decodificador
    this.lastResetAt = 0;
    this.stats = { resets: 0, decoded: 0 };
    this.make();
  }

  make() {
    this.dec = new VideoDecoder({
      output: (f) => {
        this.waiting = 0;
        if (this.dead) return void f.close();
        this.stats.decoded++;
        const q = this.queue;
        let i = q.length;
        while (i > 0 && q[i - 1].timestamp > f.timestamp) i--;
        q.splice(i, 0, f);
        this.onChange?.();
      },
      error: (e) => {
        this.failed = e;
        console.warn('decodificador de quadros falhou:', e?.message || e);
        this.onChange?.();
      },
    });
    this.dec.configure(this.cfg());
  }

  cfg() {
    return { ...this.src.config, hardwareAcceleration: globalThis.__FP_HW || (soft[sizeClass(this.src)] ? 'prefer-software' : 'no-preference') };
  }

  reset(target) {
    const s = this.src;
    for (const f of this.queue) f.close();
    this.queue = [];
    this.stash();
    if (globalThis.__FP_FRESH) {
      try {
        this.dec.close();
      } catch {}
      this.make();
    } else {
      try {
        this.dec.reset();
        this.dec.configure(this.cfg());
      } catch {
        this.make();
      }
    }
    this.runKey = s.keyAtOrBefore(s.order[target]);
    this.next = this.runKey;
    this.cold = true;
    this.flushed = false;
    this.waiting = 0;
    this.lastResetAt = performance.now();
    this.stats.resets++;
  }

  // Um VideoFrame guardado impede o decodificador de recomeçar (os quadros do aparelho vêm de um conjunto pequeno):
  // antes de recomeçar a imagem atual vira uma cópia em canvas, que cobre a espera sem prender o decodificador.
  stash() {
    const img = this.upright();
    if (!img) return;
    const w = img.displayWidth || img.width;
    const h = img.displayHeight || img.height;
    let c = this.hold;
    if (!c) c = this.hold = document.createElement('canvas');
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    this.cur.close();
    this.cur = null;
    this.curTs = -1;
  }

  // O quadro em pé: vídeos gravados de lado (a câmera só marca "girar 90°" no arquivo) são girados aqui.
  upright() {
    const f = this.cur;
    if (!f || !this.src.rot) return f;
    if (this.rotTs !== this.curTs) {
      const { dw, dh, rot } = this.src;
      let c = this.rotC;
      if (!c) c = this.rotC = document.createElement('canvas');
      if (c.width !== dw || c.height !== dh) {
        c.width = dw;
        c.height = dh;
      }
      const g = c.getContext('2d');
      g.save();
      g.translate(dw / 2, dh / 2);
      g.rotate((rot * Math.PI) / 180);
      g.drawImage(f, -f.displayWidth / 2, -f.displayHeight / 2, f.displayWidth, f.displayHeight);
      g.restore();
      this.rotTs = this.curTs;
    }
    return this.rotC;
  }

  // O que desenhar agora: o quadro atual ou, logo depois de uma busca, a cópia do anterior.
  image() {
    return this.cur ? this.upright() : this.hold || null;
  }

  bytes(i) {
    const b = (i / BLOCK) | 0;
    const blk = this.blocks.get(b);
    if (blk) return blk[i - b * BLOCK];
    this.read(b);
    return null;
  }

  read(b) {
    if (this.reading.has(b) || b * BLOCK >= this.src.n) return;
    this.reading.add(b);
    this.src
      .readBlock(b)
      .then((arr) => {
        this.reading.delete(b);
        if (this.dead) return;
        this.blocks.set(b, arr);
        this.trim();
        this.pump(); // os bytes chegaram: segue decodificando já, sem esperar o próximo quadro de animação
        this.onChange?.();
      })
      .catch((err) => {
        this.reading.delete(b);
        this.failed = err;
      });
  }

  trim() {
    if (this.blocks.size <= 8) return;
    const here = ((this.next / BLOCK) | 0);
    for (const b of this.blocks.keys()) if (b < here - 2 || b > here + 4) this.blocks.delete(b);
  }

  pump() {
    if (!this.dead && !this.failed && this.runKey >= 0) this.feed(this.goal);
  }

  feed(limit) {
    const s = this.src;
    const max = Math.min(limit, s.n - 1);
    let guard = 0;
    while (this.next <= max && this.dec.decodeQueueSize < 8 && this.queue.length < 10 && guard++ < 64) {
      const i = this.next;
      const data = this.bytes(i);
      if (!data) break;
      if (this.cold) {
        this.cold = false;
        this.waiting = performance.now(); // primeiro quadro depois de uma busca: se demorar demais, troca de decodificador
      }
      this.dec.decode(new EncodedVideoChunk({ type: s.sync[i] ? 'key' : 'delta', timestamp: s.cts[i], duration: s.dur[i], data }));
      this.next++;
    }
    // Chegou ao último quadro do arquivo: com B-frames os últimos ainda estão retidos no decodificador, "flush" os solta.
    if (this.next >= s.n && !this.flushed && s.reorder) {
      this.flushed = true;
      this.dec.flush().catch(() => {});
    }
    // leitura adiantada do bloco seguinte
    if (this.next <= s.n - 1) this.bytes(Math.min(s.n - 1, this.next + BLOCK));
  }

  // mode: 'play' (decodifica à frente), 'scrub' (só até o alvo, sem guardar à frente), 'idle' (parado: deixa uns
  // quadros prontos para o play começar na hora). Devolve true se o quadro em exibição mudou.
  step(us, mode) {
    if (this.dead || this.failed) return false;
    const s = this.src;
    const target = s.idxAt(us);
    if (this.waiting && sizeClass(s) !== 'huge' && !soft[sizeClass(s)] && !globalThis.__FP_HW && performance.now() - this.waiting > 220) {
      // O decodificador de hardware deste aparelho está lento para começar: usa o de software daqui em diante.
      goSoft(s);
      this.dec.close?.();
      this.make();
      this.reset(target);
    }
    // (Com B-frames o decodificador só entrega um quadro depois de receber alguns seguintes: manda uns a mais.)
    const ahead = Math.max(mode === 'play' ? 9 : mode === 'idle' ? 6 : 0, s.reorder ? 4 : 0);
    this.goal = s.need[Math.min(s.n - 1, target + ahead)];
    const have = this.cur ? s.idxAt(this.curTs) : -1;
    // Recomeça (busca) quando o alvo está fora do que a sequência atual consegue entregar: antes do início dela, mais de
    // um quadro antes do que já foi mostrado, ou adiante de um quadro-chave que ainda não foi enviado (pular direto para
    // ele poupa decodificar o que está no meio; sem quadro-chave no caminho, é só continuar). (Uma volta de 1 quadro,
    // do ajuste fino do relógio, não conta.)
    const lost = this.runKey < 0 || s.order[target] < this.runKey || (have >= 0 && target < have - 1) || s.keyAtOrBefore(s.order[target]) > this.next + 2;
    if (lost) {
      // Buscas em sequência (dedo arrastando) não deixariam nenhuma terminar: dá um respiro ao que já foi pedido.
      const busy = mode === 'scrub' && this.runKey >= 0 && this.dec.decodeQueueSize > 0 && performance.now() - this.lastResetAt < 90;
      if (!busy) this.reset(target);
    }
    this.feed(this.goal);
    return this.present(us);
  }

  // Escolhe o quadro certo para "us": o último com tempo <= us. Fecha o que ficou para trás.
  present(us) {
    const q = this.queue;
    let k = -1;
    for (let i = 0; i < q.length; i++) {
      if (q[i].timestamp <= us) k = i;
      else break;
    }
    // Nada ≤ us ainda. No começo (nada mostrado) e a menos de 100 ms, o primeiro que chegou serve.
    if (k < 0) {
      if (this.cur || !q.length || q[0].timestamp - us > 100000) return false;
      k = 0;
    }
    const f = q[k];
    for (let i = 0; i < k; i++) q[i].close();
    q.splice(0, k + 1);
    if (f.timestamp === this.curTs && this.cur) {
      f.close();
      return false;
    }
    this.cur?.close();
    this.cur = f;
    this.curTs = f.timestamp;
    this.rotTs = -1;
    return true;
  }

  // Há quadro no ponto pedido (e não é um resto de antes)?
  ready(us) {
    if (!this.cur) return false;
    const s = this.src;
    return Math.abs(s.idxAt(this.curTs) - s.idxAt(us)) <= 2;
  }

  dispose() {
    this.dead = true;
    for (const f of this.queue) f.close();
    this.queue = [];
    this.cur?.close();
    this.cur = null;
    this.hold = null;
    this.rotC = null;
    this.blocks.clear();
    try {
      this.dec.close();
    } catch {}
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Miniaturas da linha do tempo: um quadro a cada "intervalo", decodificados daqui (sem abrir um <video> e buscar
// quadro a quadro). Devolve { interval, frames: [jpeg...] } ou null se este arquivo não dá para decodificar.
// ---------------------------------------------------------------------------------------------------------------
export async function thumbsFromFrames(blob, count, h = 72, shouldWait) {
  const src = await openSource(blob);
  if (!src) return null;
  const duration = src.duration;
  const interval = Math.max(duration / count, 0.05);
  const fp = new FramePlayer(src, null);
  const c = document.createElement('canvas');
  c.height = h;
  c.width = Math.max(8, Math.round((h * src.dw) / src.dh));
  const g = c.getContext('2d');
  const frames = [];
  try {
    for (let i = 0; i < count; i++) {
      if (shouldWait) await shouldWait(); // o app está tocando: as miniaturas esperam
      const us = Math.min(Math.max(0, duration - 0.05), i * interval + interval / 2) * 1e6;
      const t0 = performance.now();
      for (;;) {
        fp.step(us, 'scrub');
        if (fp.failed) throw fp.failed;
        if (fp.ready(us) || performance.now() - t0 > 2500) break;
        await new Promise((r) => setTimeout(r, 2));
      }
      if (!fp.cur) return null;
      g.drawImage(fp.image(), 0, 0, c.width, c.height);
      frames.push(c.toDataURL('image/jpeg', 0.6));
    }
  } finally {
    fp.dispose();
  }
  return { interval, frames };
}
