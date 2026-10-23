// Gera a "prévia leve" de um vídeo no próprio aparelho (só celular): lê o índice do MP4/MOV (mp4box, só o cabeçalho),
// busca os quadros no arquivo aos poucos, decodifica com WebCodecs, reduz para ~540p, recodifica em H.264 com um
// quadro-chave a cada ~0,2 s e empacota de novo (mp4-muxer), copiando o som AAC sem mexer. Roda num Worker para não pesar
// a tela. O vídeo original nunca é alterado e nunca é carregado inteiro na memória (um 4K de minutos passaria de 1 GB).
import { createFile, MP4BoxBuffer, DataStream, Endianness, Log } from 'mp4box';

Log.setLogLevel(Log.error); // (caixas de dados com zeros no fim do .mov do iPhone enchiam o console de avisos)
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

let hold = false; // o app está tocando: espera (o decodificador é de todos)
const waiters = [];
const gate = async () => {
  while (hold) await new Promise((r) => waiters.push(r));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const BLOCK = 24; // amostras lidas do arquivo de uma vez

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'hold') {
    hold = m.on;
    if (!hold) while (waiters.length) waiters.shift()();
  } else if (m.type === 'start') {
    run(m)
      .then(({ buffer, thumbs }) => self.postMessage({ type: 'done', buffer, thumbs }, [buffer]))
      .catch((err) => self.postMessage({ type: 'error', message: String(err?.message || err) + ' @ ' + String(err?.stack || '').split('\n').slice(0, 4).join(' | ') }));
  }
};

// (Alguns .mov do iPhone não respondem a getTrackById: procura a trilha direto na lista do arquivo.)
function trackOf(file, id) {
  return file.getTrackById(id) || file.moov?.traks?.find((t) => t.tkhd?.track_id === id) || null;
}

function videoDescription(trak) {
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC || entry.hvcC;
  if (!box) throw new Error('codec de vídeo sem configuração conhecida');
  const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(s);
  return new Uint8Array(s.buffer, 8); // pula o cabeçalho da caixa (tamanho + nome)
}

function audioSpecificConfig(trak, rate, channels) {
  try {
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    return entry.esds.esd.descs[0].descs[0].data;
  } catch {
    // Sem a configuração no arquivo: monta a de AAC-LC (2 bytes) com a taxa e os canais conhecidos.
    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    const idx = Math.max(0, rates.indexOf(rate));
    return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | ((channels || 2) << 3)]);
  }
}

// Lê só o índice do arquivo (o mp4box diz qual trecho precisa a seguir: em vídeo sem "faststart" o índice fica no fim).
async function readIndex(blob) {
  const file = createFile();
  let info = null;
  let failed = null;
  file.onError = (er) => (failed = new Error('MP4: ' + er));
  file.onReady = (i) => (info = i);
  let pos = 0;
  let size = 1024 * 1024;
  for (let iter = 0; !info && pos < blob.size && iter < 600; iter++) {
    const end = Math.min(blob.size, pos + size);
    const ab = await blob.slice(pos, end).arrayBuffer();
    const next = file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos), false);
    pos = typeof next === 'number' && Number.isFinite(next) && next >= 0 ? next : end;
    size = 4 * 1024 * 1024;
    if (failed) throw failed;
  }
  if (!info) throw new Error('não consegui ler as trilhas do vídeo');
  return { file, info };
}

// Bytes das amostras i0..i1 de uma trilha, em trechos contíguos (o som e o vídeo vêm intercalados no arquivo).
async function readSamples(blob, samples, i0, i1) {
  const out = new Array(i1 - i0 + 1);
  let a = i0;
  while (a <= i1) {
    let b = a;
    while (b < i1 && samples[b + 1].offset === samples[b].offset + samples[b].size) b++;
    const start = samples[a].offset;
    const end = samples[b].offset + samples[b].size;
    const buf = new Uint8Array(await blob.slice(start, end).arrayBuffer());
    for (let i = a; i <= b; i++) out[i - i0] = buf.subarray(samples[i].offset - start, samples[i].offset - start + samples[i].size);
    a = b + 1;
  }
  return out;
}

async function run({ blob, hasAudio, shortSide = 540, maxFps = 30, gop = 6 }) {
  const { file, info } = await readIndex(blob);
  const vt = info.videoTracks[0];
  if (!vt) throw new Error('sem trilha de vídeo');
  const at = hasAudio ? info.audioTracks[0] : null;
  if (at && !/^mp4a\.40\./.test(at.codec)) throw new Error('som não AAC: prévia leve não copia este formato');
  const vtrak = trackOf(file, vt.id);
  const vs = vtrak?.samples;
  if (!vs?.length) throw new Error('vídeo sem tabela de quadros');
  const atrak = at ? trackOf(file, at.id) : null;
  const as = atrak?.samples || [];

  // ---- dimensões, rotação e taxa de quadros ----
  const m = vt.matrix ? Array.from(vt.matrix) : [65536, 0, 0, 65536];
  const rot = (((Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) % 360) + 360) % 360) | 0;
  const cw = vt.video.width;
  const ch = vt.video.height;
  const swap = rot === 90 || rot === 270;
  const dw = swap ? ch : cw; // tamanho exibido (já girado)
  const dh = swap ? cw : ch;
  const k = Math.min(1, shortSide / Math.min(dw, dh));
  const W = even(dw * k);
  const H = even(dh * k);
  const srcFps = vt.nb_samples / (vt.duration / vt.timescale) || 30;
  const fps = Math.min(maxFps, Math.round(srcFps));

  const description = videoDescription(vtrak);
  const decCfg = { codec: vt.codec, codedWidth: cw, codedHeight: ch, description };
  const encCfg = { codec: 'avc1.4d0028', width: W, height: H, bitrate: Math.round(W * H * fps * 0.12), framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  if (!(await VideoDecoder.isConfigSupported(decCfg)).supported) throw new Error('este aparelho não decodifica ' + vt.codec);
  const encSupport = await VideoEncoder.isConfigSupported(encCfg);
  if (!encSupport.supported) throw new Error('este aparelho não codifica H.264');

  const audioDesc = at ? audioSpecificConfig(atrak, at.audio.sample_rate, at.audio.channel_count) : null;
  const audioCfg = at ? { codec: 'aac', numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate } : undefined;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H }, audio: audioCfg, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset' });

  // ---- recodificação ----
  // Miniaturas da linha do tempo: tiradas dos próprios quadros que já estamos decodificando (sem busca extra).
  const durSec = vt.duration / vt.timescale || 1;
  const tCount = Math.max(1, Math.min(20, Math.ceil(durSec / (durSec > 90 ? 5 : 2))));
  const tInterval = Math.max(durSec / tCount, 0.05);
  const tc = new OffscreenCanvas(Math.max(8, Math.round((72 * W) / H)), 72);
  const tg = tc.getContext('2d');
  const thumbJobs = [];
  const takeThumb = () => {
    tg.drawImage(canvas, 0, 0, tc.width, tc.height);
    thumbJobs.push(tc.convertToBlob({ type: 'image/jpeg', quality: 0.6 }));
  };
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext('2d');
  let nextTs = 0;
  const step = 1e6 / fps;
  let n = 0;
  let encErr = null;
  let framesOut = 0;
  let chunksOut = 0;
  let decErr = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => (chunksOut++, muxer.addVideoChunk(chunk, meta)), error: (er) => (encErr = er) });
  enc.configure(encCfg);
  const dec = new VideoDecoder({
    output: (frame) => {
      framesOut++;
      try {
        if (frame.timestamp + 1 < nextTs) return; // 60 fps → 30 fps: descarta quadros intermediários
        nextTs = Math.max(nextTs, frame.timestamp) + step;
        g.save();
        g.translate(W / 2, H / 2);
        g.rotate((rot * Math.PI) / 180);
        const sw = cw * k;
        const sh = ch * k;
        g.drawImage(frame, -sw / 2, -sh / 2, sw, sh);
        g.restore();
        const out = new VideoFrame(canvas, { timestamp: frame.timestamp, duration: frame.duration || step });
        enc.encode(out, { keyFrame: n++ % gop === 0 });
        out.close();
        while (thumbJobs.length < tCount && frame.timestamp / 1e6 >= thumbJobs.length * tInterval + tInterval / 2 - 1e-4) takeThumb();
      } finally {
        frame.close();
      }
    },
    error: (er) => (decErr = er),
  });
  dec.configure(decCfg);

  const total = vs.length;
  const us = 1e6 / vt.timescale;
  let done = 0;
  let lastReport = 0;

  // Os quadros chegam em blocos lidos do arquivo; o bloco seguinte já vem sendo lido enquanto este é decodificado.
  let ahead = readSamples(blob, vs, 0, Math.min(total, BLOCK) - 1);
  for (let b0 = 0; b0 < total; b0 += BLOCK) {
    const i1 = Math.min(total, b0 + BLOCK) - 1;
    const datas = await ahead;
    ahead = b0 + BLOCK < total ? readSamples(blob, vs, b0 + BLOCK, Math.min(total, b0 + 2 * BLOCK) - 1) : null;
    for (let i = b0; i <= i1; i++) {
      await gate();
      if (decErr || encErr) throw decErr || encErr;
      while (dec.decodeQueueSize > 6 || enc.encodeQueueSize > 6) await sleep(3);
      const s = vs[i];
      dec.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(s.cts * us), duration: Math.round(s.duration * us), data: datas[i - b0] }));
      done++;
      if (done % 15 === 0) await sleep(0); // respiro: o app continua fluido
      const now = performance.now();
      if (now - lastReport > 400) {
        lastReport = now;
        self.postMessage({ type: 'progress', f: Math.min(0.99, done / total) });
      }
    }
  }
  await dec.flush();
  await enc.flush();
  if (decErr || encErr) throw decErr || encErr;

  // ---- som: copiado sem recodificar ----
  if (at && as.length) {
    const aus = 1e6 / at.timescale;
    for (let a0 = 0; a0 < as.length; a0 += 200) {
      const a1 = Math.min(as.length, a0 + 200) - 1;
      const datas = await readSamples(blob, as, a0, a1);
      for (let i = a0; i <= a1; i++) {
        const s = as[i];
        muxer.addAudioChunkRaw(datas[i - a0], s.is_sync ? 'key' : 'delta', Math.round(s.cts * aus), Math.round(s.duration * aus), { decoderConfig: { codec: at.codec, numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate, description: audioDesc } });
      }
    }
  }

  if (!chunksOut) throw new Error(`nenhum quadro saiu: amostras lidas ${done}/${total}, quadros decodificados ${framesOut}`);
  while (thumbJobs.length < tCount) takeThumb(); // vídeo acabou antes da última miniatura: repete o último quadro
  const frames = [];
  for (const blobP of thumbJobs) {
    const blobT = await blobP;
    frames.push(await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(blobT);
    }));
  }
  muxer.finalize();
  dec.close();
  enc.close();
  return { buffer: target.buffer, thumbs: { interval: tInterval, frames } };
}
