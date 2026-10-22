// PROTÓTIPO (só teste): toca a cópia leve decodificando com WebCodecs, sem <video>.
import { createFile, MP4BoxBuffer, DataStream, Endianness } from 'mp4box';

export async function openSource(blob) {
  const file = createFile();
  let info = null;
  const samples = [];
  file.onReady = (i) => {
    info = i;
    file.setExtractionOptions(i.videoTracks[0].id, 'v', { nbSamples: 100000 });
    file.start();
  };
  file.onSamples = (id, u, s) => samples.push(...s);
  const ab = await blob.arrayBuffer();
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0), true);
  file.flush();
  for (let i = 0; i < 50 && !samples.length; i++) await new Promise((r) => setTimeout(r, 20));
  const vt = info.videoTracks[0];
  const box = file.getTrackById(vt.id).mdia.minf.stbl.stsd.entries[0].avcC;
  const s = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(s);
  const description = new Uint8Array(s.buffer, 8);
  const ts = vt.timescale;
  const list = samples.map((x) => ({ cts: Math.round((x.cts / ts) * 1e6), dur: Math.round((x.duration / ts) * 1e6), sync: x.is_sync, data: x.data }));
  list.sort((a, b) => a.cts - b.cts);
  return { codec: vt.codec, w: vt.video.width, h: vt.video.height, description, list, duration: vt.duration / ts };
}

export class Player {
  constructor(src) {
    this.src = src;
    this.frames = []; // [{ts, frame}] ordenado
    this.fed = -1; // último índice de amostra enviado
    this.gen = 0;
    this.mk();
  }
  mk() {
    this.dec = new VideoDecoder({
      output: (f) => {
        if (this.dead) return f.close();
        this.frames.push({ ts: f.timestamp, frame: f });
        this.frames.sort((a, b) => a.ts - b.ts);
      },
      error: (e) => console.error('dec', e),
    });
    this.dec.configure({ codec: this.src.codec, codedWidth: this.src.w, codedHeight: this.src.h, description: this.src.description, hardwareAcceleration: 'prefer-hardware' });
  }
  idxAt(us) {
    const l = this.src.list;
    let lo = 0, hi = l.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (l[mid].cts <= us) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  keyBefore(i) {
    const l = this.src.list;
    while (i > 0 && !l[i].sync) i--;
    return i;
  }
  seek(us) {
    const target = this.idxAt(us);
    const k = this.keyBefore(target);
    for (const f of this.frames) f.frame.close();
    this.frames = [];
    this.dec.reset();
    this.dec.configure({ codec: this.src.codec, codedWidth: this.src.w, codedHeight: this.src.h, description: this.src.description, hardwareAcceleration: 'prefer-hardware' });
    this.fed = k - 1;
    this.feed(target + 12);
  }
  feed(upto) {
    const l = this.src.list;
    while (this.fed < Math.min(upto, l.length - 1) && this.dec.decodeQueueSize < 12) {
      const s = l[++this.fed];
      this.dec.decode(new EncodedVideoChunk({ type: s.sync ? 'key' : 'delta', timestamp: s.cts, duration: s.dur, data: s.data }));
    }
  }
  // quadro a mostrar no tempo us (o último com ts <= us); descarta os mais velhos
  frameAt(us) {
    this.feed(this.idxAt(us) + 14);
    let best = -1;
    for (let i = 0; i < this.frames.length; i++) if (this.frames[i].ts <= us) best = i; else break;
    if (best < 0) return null;
    for (let i = 0; i < best; i++) this.frames[i].frame.close();
    this.frames.splice(0, best);
    return this.frames[0].frame;
  }
  close() {
    this.dead = true;
    for (const f of this.frames) f.frame.close();
    this.frames = [];
    try { this.dec.close(); } catch {}
  }
}
