// Gera a "prévia leve" de um vídeo no próprio aparelho (só celular): lê o MP4 (mp4box), decodifica com WebCodecs,
// reduz para ~540p, recodifica em H.264 com um quadro-chave a cada ~0,4 s e empacota de novo (mp4-muxer),
// copiando o som AAC sem mexer. Roda num Worker para não pesar a tela. O vídeo original nunca é alterado.
import { createFile, MP4BoxBuffer, DataStream, Endianness } from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

let hold = false; // o app está tocando: espera (o decodificador é de todos)
const waiters = [];
const gate = async () => {
  while (hold) await new Promise((r) => waiters.push(r));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'hold') {
    hold = m.on;
    if (!hold) while (waiters.length) waiters.shift()();
  } else if (m.type === 'start') {
    run(m)
      .then((buffer) => self.postMessage({ type: 'done', buffer }, [buffer]))
      .catch((err) => self.postMessage({ type: 'error', message: String(err?.message || err) + ' @ ' + String(err?.stack || '').split('\n').slice(0, 4).join(' | ') }));
  }
};

function videoDescription(file, trackId) {
  const entry = file.getTrackById(trackId).mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC || entry.hvcC;
  if (!box) throw new Error('codec de vídeo sem configuração conhecida');
  const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(s);
  return new Uint8Array(s.buffer, 8); // pula o cabeçalho da caixa (tamanho + nome)
}

function audioSpecificConfig(file, trackId) {
  const entry = file.getTrackById(trackId).mdia.minf.stbl.stsd.entries[0];
  return entry.esds.esd.descs[0].descs[0].data;
}

async function run({ blob, hasAudio, shortSide = 540, maxFps = 30, gop = 12 }) {
  if (blob.size > 400 * 1024 * 1024) throw new Error('arquivo grande demais para a prévia leve');
  const file = createFile();
  let info = null;
  let failed = null;
  file.onError = (er) => (failed = new Error('MP4: ' + er));
  const vq = [];
  const aq = [];
  file.onReady = (i) => {
    info = i;
    const v = i.videoTracks[0];
    if (!v) return;
    file.setExtractionOptions(v.id, 'v', { nbSamples: 60 });
    const a = i.audioTracks[0];
    if (a && hasAudio) file.setExtractionOptions(a.id, 'a', { nbSamples: 200 });
    file.start();
  };
  let got = 0;
  file.onSamples = (id, user, samples) => {
    if (user === 'v') got += samples.length;
    (user === 'v' ? vq : aq).push(...samples);
  };

  // ---- lê o começo do arquivo até conhecer as trilhas ----
  const CHUNK = 4 * 1024 * 1024;
  let pos = 0;
  let iter = 0;
  // O mp4box diz qual é o próximo trecho de que precisa e devolve essa posição. Em vídeos gravados sem "faststart"
  // o índice fica no FIM do arquivo: ele pede o fim e depois volta ao começo para os quadros. Seguimos o que ele pede.
  const feed = async () => {
    if (pos >= blob.size || ++iter > 5000) return false;
    const end = Math.min(blob.size, pos + CHUNK);
    const ab = await blob.slice(pos, end).arrayBuffer();
    const next = file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos), false);
    pos = typeof next === 'number' && Number.isFinite(next) && next >= 0 ? next : end;
    return true;
  };
  while (!info && (await feed())) if (failed) throw failed;
  if (!info) throw new Error('não consegui ler as trilhas do vídeo');
  const vt = info.videoTracks[0];
  if (!vt) throw new Error('sem trilha de vídeo');
  const at = hasAudio ? info.audioTracks[0] : null;
  if (at && !/^mp4a\.40\./.test(at.codec)) throw new Error('som não AAC: prévia leve não copia este formato');

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

  const description = videoDescription(file, vt.id);
  const decCfg = { codec: vt.codec, codedWidth: cw, codedHeight: ch, description };
  const encCfg = { codec: 'avc1.4d0028', width: W, height: H, bitrate: Math.round(W * H * fps * 0.12), framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  if (!(await VideoDecoder.isConfigSupported(decCfg)).supported) throw new Error('este aparelho não decodifica ' + vt.codec);
  const encSupport = await VideoEncoder.isConfigSupported(encCfg);
  if (!encSupport.supported) throw new Error('este aparelho não codifica H.264');

  const audioCfg = at ? { codec: 'aac', numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate } : undefined;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: W, height: H }, audio: audioCfg, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset' });

  // ---- recodificação ----
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
      } finally {
        frame.close();
      }
    },
    error: (er) => (decErr = er),
  });
  dec.configure(decCfg);

  const total = vt.nb_samples;
  let done = 0;
  let lastReport = 0;
  const flushAudio = () => {
    while (aq.length) {
      const s = aq.shift();
      const us = 1e6 / s.timescale;
      muxer.addAudioChunkRaw(s.data, s.is_sync ? 'key' : 'delta', Math.round(s.cts * us), Math.round(s.duration * us), { decoderConfig: { codec: at.codec, numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate, description: audioSpecificConfig(file, at.id) } });
    }
  };
  const pump = async () => {
    while (vq.length) {
      await gate();
      if (decErr || encErr) throw decErr || encErr;
      while (dec.decodeQueueSize > 6 || enc.encodeQueueSize > 6) await sleep(3);
      const s = vq.shift();
      const us = 1e6 / s.timescale;
      dec.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(s.cts * us), duration: Math.round(s.duration * us), data: s.data }));
      done++;
      if (done % 15 === 0) await sleep(0); // respiro: o app continua fluido
      const now = performance.now();
      if (now - lastReport > 400) {
        lastReport = now;
        self.postMessage({ type: 'progress', f: Math.min(0.99, done / total) });
      }
    }
    flushAudio();
  };

  await pump();
  while (await feed()) {
    if (failed) throw failed;
    await pump();
  }
  file.flush();
  // O mp4box entrega as amostras de forma assíncrona: espera chegarem todas (ou parar de chegar).
  for (let idle = 0, last = -1; got < total && idle < 150; idle++) {
    await sleep(20);
    await pump();
    if (got !== last) {
      last = got;
      idle = 0;
    }
  }
  await pump();
  await dec.flush();
  await enc.flush();
  if (decErr || encErr) throw decErr || encErr;
  flushAudio();
  if (!chunksOut) throw new Error(`nenhum quadro saiu: amostras lidas ${done}/${total}, quadros decodificados ${framesOut}, pos ${pos}/${blob.size}`);
  muxer.finalize();
  dec.close();
  enc.close();
  return target.buffer;
}
