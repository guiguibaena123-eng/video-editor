// Som do celular decodificado por nós (WebCodecs) e tocado pelo WebAudio, em vez de um <audio> por clipe.
// Por quê: o <audio> do iPhone leva de 0,2 a 1 s para começar, busca devagar, e só dá para "puxá-lo" mudando a taxa
// (estala). Aqui o som de cada trecho (4 s) vira um AudioBuffer e é agendado num instante EXATO do relógio de áudio
// (AudioContext.currentTime): começar, pular e emendar clipes não têm espera nem busca, e imagem e som ficam presos
// ao mesmo relógio. Só vale para AAC em MP4/MOV (o que câmeras e a cópia leve produzem); o resto continua no <audio>.
import { createFile, MP4BoxBuffer, DataStream, Endianness, Log } from 'mp4box';

Log.setLogLevel(Log.error); // (caixas de dados com zeros no fim do .mov do iPhone enchiam o console de avisos)

export const pcmSupported = () => typeof AudioDecoder !== 'undefined' && typeof AudioData !== 'undefined' && typeof AudioContext !== 'undefined';

export const CHUNK = 4; // segundos de som por AudioBuffer

const sources = new WeakMap(); // Blob -> Promise<AudioSource|null>

export function openAudio(blob) {
  if (!blob) return Promise.resolve(null);
  let p = sources.get(blob);
  if (!p) {
    p = load(blob).catch((err) => {
      console.debug('som: fica com o <audio> —', err?.message || err);
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
  if (!info) throw new Error('índice não encontrado');
  const at = info.audioTracks[0];
  if (!at) throw new Error('sem trilha de som');
  if (!/^mp4a\.40\.(2|5|29)$/.test(at.codec)) throw new Error('som ' + at.codec + ' fica com o <audio>');
  const trak = file.getTrackById(at.id);
  const samples = trak.samples;
  const n = samples?.length || 0;
  if (n < 2) throw new Error('poucas amostras');
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const rate = at.audio.sample_rate;
  const ch = at.audio.channel_count;
  // .mov do iPhone guarda a configuração dentro de uma caixa "wave" que o mp4box não abre: monta a de AAC-LC (2 bytes).
  let asc = entry.esds?.esd?.descs?.[0]?.descs?.[0]?.data;
  if (!asc) {
    const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
    const idx = rates.indexOf(rate);
    if (at.codec !== 'mp4a.40.2' || idx < 0) throw new Error('sem configuração do som');
    asc = new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (ch << 3)]);
  }
  const ts = at.timescale;
  const edit = trak.edts?.elst?.entries?.find((x) => x.media_time >= 0);
  const shift = edit ? edit.media_time / ts : 0; // atraso do codificador: o navegador também o desconta
  const cts = new Float64Array(n);
  const dur = new Float64Array(n);
  const off = new Float64Array(n);
  const sz = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    cts[i] = Math.round((s.cts / ts - shift) * 1e6);
    dur[i] = Math.round((s.duration * 1e6) / ts);
    off[i] = s.offset;
    sz[i] = s.size;
  }
  const config = { codec: at.codec, sampleRate: rate, numberOfChannels: ch, description: new Uint8Array(asc) };
  const sup = await AudioDecoder.isConfigSupported(config);
  if (!sup.supported) throw new Error('decodificador de som não aceita ' + at.codec);
  const duration = (cts[n - 1] + dur[n - 1]) / 1e6;
  return new AudioSource(blob, { n, cts, dur, off, sz, rate, ch, config, duration });
}

class AudioSource {
  constructor(blob, t) {
    this.blob = blob;
    Object.assign(this, t);
    this.cache = new Map(); // índice do trecho -> AudioBuffer (ou promessa)
    this.frameLen = Math.round((this.dur[0] * this.rate) / 1e6) || 1024;
  }

  // Primeira amostra cujo fim passa de "us" (microssegundos).
  idxAt(us) {
    let lo = 0;
    let hi = this.n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cts[mid] + this.dur[mid] <= us) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Bytes das amostras i0..i1, em trechos contíguos (num MP4 o som é intercalado com o vídeo: nada de ler o vídeo junto).
  async bytes(i0, i1) {
    const out = new Array(i1 - i0 + 1);
    let a = i0;
    while (a <= i1) {
      let b = a;
      while (b < i1 && this.off[b + 1] === this.off[b] + this.sz[b]) b++;
      const start = this.off[a];
      const end = this.off[b] + this.sz[b];
      const buf = new Uint8Array(await this.blob.slice(start, end).arrayBuffer());
      for (let i = a; i <= b; i++) out[i - i0] = buf.subarray(this.off[i] - start, this.off[i] - start + this.sz[i]);
      a = b + 1;
    }
    return out;
  }

  has(k) {
    return this.cache.get(k) instanceof AudioBuffer;
  }

  get(k) {
    const v = this.cache.get(k);
    return v instanceof AudioBuffer ? v : null;
  }

  // Garante o trecho k decodificado (devolve uma promessa; não repete o trabalho).
  ensure(k, ctx) {
    if (k < 0 || k * CHUNK >= this.duration) return null;
    let v = this.cache.get(k);
    if (v) return v instanceof AudioBuffer ? v : v;
    v = this.decodeChunk(k, ctx).then(
      (buf) => {
        this.cache.set(k, buf);
        this.trim(k);
        return buf;
      },
      (err) => {
        this.cache.delete(k);
        this.failed = err;
        return null;
      },
    );
    this.cache.set(k, v);
    return v;
  }

  trim(keep) {
    if (this.cache.size <= 8) return;
    for (const k of [...this.cache.keys()]) if (Math.abs(k - keep) > 3 && this.cache.get(k) instanceof AudioBuffer) this.cache.delete(k);
  }

  async decodeChunk(k, ctx) {
    const t0 = k * CHUNK;
    const frames = Math.round(CHUNK * this.rate);
    const first = this.idxAt(t0 * 1e6);
    const i0 = Math.max(0, first - 2); // o decodificador precisa de um quadro de arranque antes do ponto
    const i1 = Math.min(this.n - 1, this.idxAt((t0 + CHUNK) * 1e6) + 1);
    const data = await this.bytes(i0, i1);
    const planes = Array.from({ length: this.ch }, () => new Float32Array(frames));
    const base = Math.round(t0 * this.rate); // amostra (da trilha) onde o trecho começa
    let err = null;
    const dec = new AudioDecoder({
      output: (ad) => {
        try {
          const at = Math.round((ad.timestamp * this.rate) / 1e6) - base; // onde esta saída cai dentro do trecho
          const len = ad.numberOfFrames;
          for (let c = 0; c < this.ch; c++) {
            const tmp = new Float32Array(len);
            ad.copyTo(tmp, { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
            const from = Math.max(0, -at);
            const to = Math.min(len, frames - at);
            if (to > from) planes[c].set(tmp.subarray(from, to), at + from);
          }
        } finally {
          ad.close();
        }
      },
      error: (e) => (err = e),
    });
    dec.configure(this.config);
    for (let i = i0; i <= i1; i++) dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.cts[i], duration: this.dur[i], data: data[i - i0] }));
    await dec.flush();
    dec.close();
    if (err) throw err;
    const buf = ctx.createBuffer(this.ch, frames, this.rate);
    for (let c = 0; c < this.ch; c++) buf.copyToChannel(planes[c], c);
    return buf;
  }
}
