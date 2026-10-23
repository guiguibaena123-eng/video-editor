import { Engine, IOS_LIKE } from './engine';
import { useStore, clipEnd, projectDuration, mediaUrl } from './store';
import { sourceAt, speedAt } from './speed';
import { valueAt, isAnimated } from './keyframes';
import { fadeGain } from './audio';
import { duckGainAt } from './audioPro';
import { effectiveAudio } from './transitions';
import { webBlob } from './web/registry';
import { framesSupported, openSource, FramePlayer } from './web/frames';
import { openAudio, pcmSupported, CHUNK } from './web/pcm';

// Motor de reprodução do celular. Diferente do motor do PC (que desenha o que um <video> escondido mostra), aqui:
//   • a IMAGEM vem de quadros que nós mesmos decodificamos (src/web/frames.js), escolhidos pelo relógio da linha do
//     tempo — pular é decodificar um grupo de quadros (~30 ms), tocar é decodificar um pouco à frente, e a emenda
//     entre clipes é só trocar de quadro; nada de "ligar" um vídeo, aquecer decodificador ou esperar o navegador;
//   • o SOM vem de um elemento <audio> por clipe (só áudio, sem decodificar imagem) e é o RELÓGIO: a linha do
//     tempo anda sozinha e o som a puxa devagar para onde ele de fato está, então imagem e som nunca se separam;
//   • a imagem nunca segura o relógio: se um quadro atrasa, o anterior continua na tela e o próximo chega no tempo.
// Vídeos que não dá para decodificar assim (formato, tamanho, girado...) usam um <video> mudo só para a imagem.
const MAX_PLAYERS = 4;
// Um áudio minúsculo e mudo, só para "destravar" os elementos de som no primeiro toque (iPhone: um elemento novo só
// toca se alguém o mandou tocar dentro de um toque; depois de destravado, serve para qualquer clipe).
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

export class LiteEngine extends Engine {
  lite = true;
  maxFps = 30;
  nextLead = 3; // quantos segundos antes o próximo clipe começa a ser preparado
  audioLead = 0.08; // quanto o som é posto à frente ao ligar a frio (aprende o atraso real do aparelho)
  fpOn = framesSupported();
  // Som pelo WebAudio (ver web/pcm.js). "?el" no endereço volta ao <audio> por clipe, para comparar.
  pcmOn = pcmSupported() && !/[?&]el\b/.test(location.search) && localStorage.getItem('ve.el') !== '1';
  fpStats = { opened: 0, fallback: 0 };

  // Chegou algo novo (índice, bytes, quadro): parado, roda um passo já em seguida (sem esperar o próximo quadro de
  // animação); tocando, o próprio laço já está rodando.
  invalidate(ms) {
    this.needDraw = true; // o projeto, o tempo ou o tamanho mudaram: o próximo quadro de animação redesenha
    super.invalidate(ms);
  }

  wake = () => {
    Engine.prototype.invalidate.call(this, 160); // sem marcar "redesenhar": só redesenha se o que aparece mudou
    if (this.playing || this.soon) return;
    this.soon = true;
    queueMicrotask(() => {
      this.soon = false;
      if (this.playing || !this.canvas) return;
      try {
        this.frame();
      } catch (err) {
        console.error(err);
      }
    });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Entradas (um clipe de mídia perto do cursor)
  // ---------------------------------------------------------------------------------------------------------------
  sourcePath(m) {
    const s = useStore.getState();
    return s.previewQuality !== 'high' && s.cache[m.id]?.proxy ? s.cache[m.id].proxy : m.path;
  }

  ensureEntry(c, m, p) {
    const want = this.sourcePath(m);
    let e = this.entries.get(c.id);
    if (e && e.mediaId !== m.id) {
      this.dispose(c.id);
      e = null;
    }
    // Cópia leve ficou pronta (ou a qualidade mudou): troca a fonte, mas só parado (no meio do play cortaria som e imagem).
    if (e && e.srcPath !== want && !this.playing) {
      this.dropVisual(e);
      e.srcPath = want;
      if (e.el) {
        e.el.src = mediaUrl(want);
        e.live = false;
      }
      if (this.pcmOn && e.pcmState !== 'none') {
        this.stopPcm(e);
        this.openPcm(e, m);
      }
      this.openVisual(e, m);
    }
    if (e) return e;
    e = { mediaId: m.id, srcPath: want, el: null, fp: null, vel: null, snap: null, gain: null, live: false, snapped: false, dead: false, kind: m.type, lastCT: null, gen: 0, pcm: null, pcmState: 'none', pg: null, sched: null };
    this.entries.set(c.id, e);
    if (m.type === 'video') this.openVisual(e, m);
    // Quem continua o clipe anterior (corte) herda o elemento de som dele quando chega a hora (adoptAudio).
    if (m.hasAudio || m.type === 'audio') {
      if (this.pcmOn) this.openPcm(e, m);
      else if (!this.continuesFrom(p, c)) this.makeAudio(e, m);
    }
    return e;
  }

  // ---- som pelo WebAudio ----
  openPcm(e, m) {
    e.pcmState = 'opening';
    e.pcm = null;
    this.ensureAudio(); // parado ele fica suspenso até o primeiro toque em play; já serve para decodificar
    const path = e.srcPath;
    openAudio(webBlob(path)).then((src) => {
      if (e.dead || e.srcPath !== path) return;
      if (src && this.audioCtx) {
        e.pcm = src;
        e.pcmState = 'ready';
      } else e.pcmState = 'off'; // formato que não dá: este clipe usa o <audio>
      this.wake();
    });
  }

  outLat() {
    const c = this.audioCtx;
    return Math.min(0.25, (c.outputLatency || 0) + (c.baseLatency || 0));
  }

  pcmGain(e) {
    if (!e.pg) {
      e.pg = this.audioCtx.createGain();
      e.pg.connect(this.audioCtx.destination);
    }
    return e.pg;
  }

  stopPcm(e) {
    const s = e.sched;
    if (!s) return;
    e.sched = null;
    for (const n of s.nodes) {
      try {
        n.stop();
        n.disconnect();
      } catch {}
    }
  }

  stopAllPcm() {
    for (const e of this.entries.values()) this.stopPcm(e);
  }

  // Agenda um trecho de som no instante "when" do relógio de áudio, começando em "offset" segundos dentro dele; termina no fim do clipe.
  place(e, c, buf, kk, when, offset) {
    const n = this.audioCtx.createBufferSource();
    n.buffer = buf;
    n.connect(this.pcmGain(e));
    n.start(when, offset);
    const endIn = c.out - kk * CHUNK;
    if (endIn < CHUNK) n.stop(when + Math.max(0, endIn - offset));
    const sched = e.sched;
    sched.nodes.push(n);
    n.onended = () => {
      const i = sched.nodes.indexOf(n);
      if (i >= 0) sched.nodes.splice(i, 1);
    };
  }

  // Começa o som do clipe: o instante de saída e a posição no arquivo saem do MESMO relógio da linha do tempo, então imagem
  // e som nascem juntos (inclusive nas emendas: o clipe seguinte é agendado antes, para o instante exato em que começa).
  startPcm(e, c, tN, upcoming) {
    const ctx = this.audioCtx;
    const N = ctx.currentTime;
    const lat = this.outLat();
    let S;
    let O;
    if (upcoming) {
      S = N + (c.start - tN) - lat;
      if (S < N + 0.01) return;
      O = c.in;
    } else {
      S = N + 0.02;
      O = Math.max(c.in, sourceAt(c, tN + 0.02 + lat - c.start));
    }
    if (O >= c.out) return;
    const kk = Math.floor(O / CHUNK);
    const buf = e.pcm.get(kk);
    if (!buf) {
      e.pcm.ensure(kk, ctx);
      this.stats.pcmWait = (this.stats.pcmWait || 0) + 1;
      return;
    }
    e.sched = { nodes: [], nextCtx: S + ((kk + 1) * CHUNK - O), nextK: kk + 1, anchorCtx: S, anchorSrc: O };
    this.place(e, c, buf, kk, S, O - kk * CHUNK);
    this.stats.pcmStarts = (this.stats.pcmStarts || 0) + 1;
  }

  extendPcm(e, c) {
    const ctx = this.audioCtx;
    const N = ctx.currentTime;
    const s = e.sched;
    if (s.nextCtx < N + 0.005) {
      // o próximo trecho não ficou pronto a tempo: recomeça pela linha do tempo em vez de tocar fora de lugar
      this.stopPcm(e);
      this.stats.pcmLate = (this.stats.pcmLate || 0) + 1;
      return;
    }
    while (s.nextCtx - N < 1.5 && s.nextK * CHUNK < c.out) {
      const buf = e.pcm.get(s.nextK);
      if (!buf) {
        e.pcm.ensure(s.nextK, ctx);
        break;
      }
      this.place(e, c, buf, s.nextK, s.nextCtx, 0);
      s.nextCtx += CHUNK;
      s.nextK++;
    }
    e.pcm.ensure(s.nextK, ctx);
  }

  setPcmGain(e, vol) {
    const g = this.pcmGain(e).gain;
    if (e.pgv === undefined) g.value = vol;
    else g.setTargetAtTime(vol, this.audioCtx.currentTime, 0.01);
    e.pgv = vol;
  }

  volumeOf(c, p, tr, m, local, end) {
    const silent = tr.muted || tr.hidden || c.audioDetached || this.muteAll || !m.hasAudio;
    return silent ? 0 : valueAt(c, 'volume', local) * fadeGain(effectiveAudio(p, c), local, end - c.start) * duckGainAt(p, useStore.getState().cache, this.mediaMap, c, local);
  }

  pool = [];
  unlocked = false;

  // Primeiro toque (play): deixa alguns elementos de som prontos para tocar a qualquer hora.
  unlockAudio() {
    this.ensureAudio(); // cria/retoma o WebAudio dentro do toque (o iPhone só deixa assim)
    try {
      navigator.audioSession.type = 'playback'; // toca mesmo com o botão de silêncio ligado
    } catch {}
    if (this.unlocked) return;
    this.unlocked = true;
    for (let i = 0; i < 4; i++) {
      const a = new Audio();
      a.crossOrigin = 'anonymous';
      a.src = SILENCE;
      a.muted = true;
      a.play().then(() => a.pause()).catch(() => {});
      this.pool.push(a);
    }
  }

  takeAudio() {
    const el = this.pool.pop() || new Audio();
    el.crossOrigin = 'anonymous';
    el.muted = false;
    el.playbackRate = 1;
    return el;
  }

  freeAudio(el) {
    el.pause();
    el.removeAttribute('src');
    el.load();
    if (this.unlocked && this.pool.length < 6) this.pool.push(el);
  }

  // O elemento de som só pode ser ligado ao WebAudio uma vez na vida: guarda o controle de volume nele.
  route(el) {
    if (el.__gain) return el.__gain;
    return (el.__gain = super.route(el));
  }

  // O "esquentar" deixa o elemento mudo; pelo caminho do WebAudio (volume > 100 %, fade no iPhone) o volume não mexe no
  // mudo, e o clipe tocava em silêncio. Tocando, o mudo só vale se o volume for zero.
  setVolume(el, gainNode, vol) {
    super.setVolume(el, gainNode, vol);
    if (gainNode && this.playing && el.muted && vol > 0.001) el.muted = false;
  }

  // Quem precisa do WebAudio (volume > 100 %, ou fade/volume no iPhone) é ligado a ele ANTES de tocar: ligar um elemento
  // que já está tocando corta o som por um instante.
  needsGain(c, p) {
    if (c.volume > 1 || c.keyframes?.volume?.length) return true;
    if (!IOS_LIKE) return false;
    const a = effectiveAudio(p, c);
    return (c.volume != null && c.volume < 1) || a.fadeIn > 0.01 || a.fadeOut > 0.01 || !!c.keyframes?.volume;
  }

  makeAudio(e, m) {
    const el = this.takeAudio();
    e.gain = el.__gain || null;
    el.preload = 'auto';
    el.src = mediaUrl(e.srcPath);
    el.load?.();
    const setLive = (v) => () => void ((e.live = v), v || (e.snapped = false));
    el.addEventListener('waiting', () => this.playing && (this.stats.waits = (this.stats.waits || 0) + 1));
    el.addEventListener('playing', setLive(true));
    for (const ev of ['pause', 'waiting', 'seeking', 'ended', 'emptied']) el.addEventListener(ev, setLive(false));
    el.addEventListener('seeked', this.wake);
    e.el = el;
  }

  // Corte contínuo: o mesmo elemento de som segue tocando no clipe seguinte, sem parar nem buscar.
  adoptAudio(e, c, p) {
    const prev = this.continuesFrom(p, c);
    const pe = prev && this.entries.get(prev.id);
    if (!pe || !pe.el || pe.el.paused || pe.el.seeking || pe.dead || pe.mediaId !== e.mediaId || pe.srcPath !== e.srcPath) return false;
    e.el = pe.el;
    e.gain = pe.gain;
    e.live = pe.live;
    e.snapped = pe.snapped;
    pe.el = null;
    pe.gain = null;
    return true;
  }

  // A cópia leve deste vídeo ainda está sendo feita: espera por ela em vez de abrir o original pesado.
  proxyPending(m) {
    const s = useStore.getState();
    const c = s.cache[m.id];
    return s.previewQuality !== 'high' && (c?.proxyState === 'working' || !!c?.deciding);
  }

  openVisual(e, m) {
    const path = e.srcPath;
    const gen = ++e.gen;
    if (this.proxyPending(m)) return;
    if (!this.fpOn) return this.fallbackVisual(e);
    e.opening = true;
    openSource(webBlob(path)).then((src) => {
      if (e.dead || e.gen !== gen) return;
      e.opening = false;
      if (!src) return this.fallbackVisual(e);
      e.fp = new FramePlayer(src, this.wake);
      this.fpStats.opened++;
      this.wake();
    });
  }

  // Sem decodificação própria: um <video> mudo, só para a imagem (como no PC).
  fallbackVisual(e) {
    if (e.vel || e.dead) return;
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.preload = 'auto';
    v.playsInline = true;
    v.muted = true;
    v.src = mediaUrl(e.srcPath);
    v.addEventListener('seeked', () => {
      if (!this.playing && v.readyState >= 2) this.snapVideo(e);
      this.wake();
    });
    v.addEventListener('loadeddata', this.wake);
    e.vel = v;
    this.fpStats.fallback++;
    this.wake();
  }

  snapVideo(e) {
    const v = e.vel;
    if (!v?.videoWidth) return;
    if (!e.snap) {
      const k = Math.min(1, 1280 / v.videoWidth);
      e.snap = document.createElement('canvas');
      e.snap.width = Math.max(1, Math.round(v.videoWidth * k));
      e.snap.height = Math.max(1, Math.round(v.videoHeight * k));
      e.snap.ctx = e.snap.getContext('2d');
    }
    e.snap.ctx.drawImage(v, 0, 0, e.snap.width, e.snap.height);
  }

  dropVisual(e) {
    e.gen++;
    e.opening = false;
    e.fp?.dispose();
    e.fp = null;
    if (e.vel) {
      e.vel.pause();
      e.vel.removeAttribute('src');
      e.vel.load();
      e.vel = null;
    }
  }

  dispose(clipId) {
    const e = this.entries.get(clipId);
    if (!e) return;
    e.dead = true;
    this.dropVisual(e);
    this.stopPcm(e);
    try {
      e.pg?.disconnect();
    } catch {}
    e.pg = null;
    if (e.el) {
      this.freeAudio(e.el);
      e.el = null;
    }
    this.entries.delete(clipId);
  }

  // Imagem do clipe agora (quadro decodificado, ou o <video> mudo do caso especial).
  sourceOf(c) {
    const e = this.entries.get(c.id);
    if (!e) return null;
    if (e.fp) return e.fp.image();
    if (e.vel) {
      if (e.vel.readyState >= 2) return e.vel;
      return e.snap || null;
    }
    return null;
  }

  // Todos os clipes de vídeo sob o cursor já têm imagem? (tela "Preparando o vídeo")
  visualsReady() {
    const s = useStore.getState();
    const t = s.currentTime;
    for (const c of s.project.clips) {
      if (c.kind || t < c.start || t >= clipEnd(c)) continue;
      const m = s.media.find((x) => x.id === c.mediaId);
      if (!m || m.type !== 'video' || m.missing) continue;
      const e = this.entries.get(c.id);
      if (!e) return false;
      if (e.fp) {
        if (!e.fp.ready(sourceAt(c, t - c.start) * 1e6)) return false;
      } else if (e.vel) {
        if (e.vel.readyState < 2 && !e.snap) return false;
      } else return false;
    }
    return true;
  }

  loading() {
    for (const e of this.entries.values()) {
      if (e.fp ? !e.fp.cur : e.vel ? e.vel.readyState < 2 : e.kind === 'video') return true;
      if (e.el && e.el.readyState < 2 && !e.el.error) return true;
    }
    return false;
  }

  // Saiu do editor: solta decodificadores e elementos de som (celulares limitam quantos podem existir).
  detach() {
    this.pause();
    for (const id of [...this.entries.keys()]) this.dispose(id);
    super.detach();
  }

  // App foi para o segundo plano: pára de tocar (a imagem congelaria e o som seguiria sozinho).
  onHidden() {
    if (this.playing) this.pause();
    this.cool();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tocar / parar
  // ---------------------------------------------------------------------------------------------------------------
  play() {
    const s = useStore.getState();
    const total = projectDuration(s.project);
    if (total <= 0) return;
    const start = s.currentTime >= total - 0.01 ? 0 : s.currentTime;
    this.clock = { t0: start, wall0: performance.now() };
    clearTimeout(this.coolT);
    this.cold = false;
    for (const e of this.entries.values()) {
      e.live = false;
      e.snapped = false;
    }
    this.lastTime = start;
    this.lastWritten = start;
    this.lastWriteAt = 0;
    this.scrubbing = false;
    this.unlockAudio();
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume();
    this.playing = true;
    useStore.setState({ playing: true, currentTime: start });
    // O navegador só deixa o som começar a partir de um toque: roda o primeiro passo já, dentro do toque.
    try {
      this.frame();
    } catch (err) {
      console.error(err);
    }
  }

  pause() {
    this.stopAt = null;
    // O último tempo calculado pode ainda não ter ido para a tela (veja frame()): grava antes de parar.
    if (this.playing && this.lastWritten !== this.lastTime && this.lastTime >= 0) {
      useStore.setState({ currentTime: this.lastTime });
      this.lastWritten = this.lastTime;
    }
    this.playing = false;
    this.stopAllPcm();
    const st = useStore.getState();
    const tNow = st.currentTime;
    for (const [id, e] of this.entries) {
      if (!e.el) continue;
      const c = st.project.clips.find((x) => x.id === id);
      e.el.__heat = null;
      if (c && tNow >= c.start && tNow < clipEnd(c)) this.park(e.el);
      else e.el.pause();
    }
    useStore.setState({ playing: false });
    this.invalidate(600);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Um passo do motor (a cada quadro de animação)
  // ---------------------------------------------------------------------------------------------------------------
  frame() {
    // Parado e sem nada novo para mostrar: não gasta nada.
    if (!this.playing && performance.now() > this.drawUntil) return;
    const s = useStore.getState();
    const p = s.project;
    const now = performance.now();
    let t = s.currentTime;

    if (this.playing) {
      // Se alguém mudou o tempo (clique na régua, atalhos), o relógio recomeça dali.
      if (Math.abs(t - this.lastWritten) > 1e-6) {
        this.clock = { t0: t, wall0: now };
        this.stopAllPcm(); // pulou na linha do tempo: o som recomeça dali
      }
      const total = projectDuration(p);
      t = Math.max(0, this.clock.t0 + (now - this.clock.wall0) / 1000);
      let ended = false;
      if (t >= total || (this.stopAt != null && t >= this.stopAt)) {
        t = Math.min(t, total, this.stopAt ?? total);
        this.lastTime = t;
        this.pause();
        ended = true;
      }
      // A linha do tempo e o contador recebem o tempo a cada quadro, direto (onTick); o store (e com ele o React) só
      // a ~10 Hz — atualizá-lo a cada quadro dobrava o custo de cada quadro num celular lento (medido).
      for (const fn of this.tickFns) fn(t);
      if (ended || now - this.lastWriteAt >= 100) {
        useStore.setState({ currentTime: t });
        this.lastWritten = t;
        this.lastWriteAt = now;
      }
      this.scrubbing = false;
    } else {
      // Mexendo no tempo com o player parado (arrastando a linha): decodifica só até o ponto; 200 ms sem mexer → exato.
      if (Math.abs(t - this.lastTime) > 1e-4) this.lastScrubAt = now;
      this.scrubbing = now - (this.lastScrubAt || 0) < 200;
      if (this.scrubbing) this.invalidate(350);
    }
    this.lastTime = t;

    if (this.mediaSrc !== s.media) {
      this.mediaSrc = s.media;
      this.mediaMap = new Map(s.media.map((m) => [m.id, m]));
    }
    if (this.tracksSrc !== p.tracks) {
      this.tracksSrc = p.tracks;
      this.trackMap = new Map(p.tracks.map((tr) => [tr.id, tr]));
    }
    const mediaById = this.mediaMap;
    const trackById = this.trackMap;

    // ---- 1) quem está perto do cursor ----
    const list = [];
    const near = new Set();
    let players = 0;
    for (const e of this.entries.values()) if (e.kind === 'video' && (e.fp || e.vel || e.opening)) players++;
    for (const c of p.clips) {
      const m = mediaById.get(c.mediaId);
      const tr = trackById.get(c.trackId);
      if (!m || !tr || m.missing || m.type === 'image') continue;
      const end = clipEnd(c);
      const active = t >= c.start && t < end;
      const lead = c.start - t;
      if (t < c.start - this.nextLead || t > end + 0.6) continue;
      if (!active && this.scrubbing && !this.entries.has(c.id)) continue; // arrastando: só abre quem está sob o cursor
      if (t >= end && !this.entries.has(c.id)) continue; // já passou: não reabre
      near.add(c.id);
      const had = this.entries.has(c.id);
      if (!had && !active && players >= MAX_PLAYERS) {
        near.delete(c.id);
        continue;
      }
      const e = this.ensureEntry(c, m, p);
      if (!had && e.kind === 'video') players++;
      list.push({ c, m, tr, e, active, lead, end });
    }

    // ---- 2) imagem e som de cada um ----
    let pending = false;
    for (const { c, m, tr, e, active, lead, end } of list) {
      if (!active) {
        // Já passou: solta o decodificador logo; o som segue um instante (o clipe seguinte pode herdá-lo).
        if (t >= end) {
          if (e.fp || e.vel) this.dropVisual(e);
          if (e.el && !e.el.paused) e.el.pause();
          this.stopPcm(e);
          continue;
        }
        // Próximo clipe: deixa os primeiros quadros prontos e o som posicionado (e quente, se já vai começar).
        if (lead < this.nextLead && !this.scrubbing) {
          if (e.fp) e.fp.step(sourceAt(c, 0) * 1e6, 'idle');
          if (e.pcmState === 'ready') {
            // som do próximo clipe: trecho decodificado e, a ~1,2 s do começo, já agendado para o instante exato
            e.pcm.ensure(Math.floor(c.in / CHUNK), this.audioCtx);
            if (this.playing && lead < 1.2 && !e.sched && sourceSpeedOne(c) && this.audioCtx.state === 'running') {
              this.setPcmGain(e, this.volumeOf(c, p, tr, m, 0, end));
              this.startPcm(e, c, t + (performance.now() - now) / 1000, true);
            }
          }
          if (e.el) {
            if (this.needsGain(c, p)) this.connect(e, 2);
            if (e.el.readyState >= 1 && !e.el.seeking && Math.abs(e.el.currentTime - c.in) > 0.05) {
              e.el.currentTime = c.in;
              e.el.__heat = null; // mexi na posição de propósito: não é o navegador ignorando a taxa 0
            }
            if (this.playing && lead < 1.2) this.heat(e.el);
          }
        }
        continue;
      }

      const local = t - c.start;
      const target = sourceAt(c, local);
      const speed = speedAt(c, local);
      const keepPitch = c.keepPitch !== false;

      // imagem
      if (e.fp?.failed) {
        // O decodificador desistiu deste arquivo: o <video> mudo assume a imagem.
        this.dropVisual(e);
        this.fallbackVisual(e);
      }
      if (m.type === 'video' && !e.fp && !e.vel && !e.opening && !this.proxyPending(m)) this.openVisual(e, m); // voltou a um clipe que já tinha passado
      const us = target * 1e6;
      if (e.fp) {
        e.fp.step(us, this.playing ? 'play' : this.scrubbing ? 'scrub' : 'idle');
        if (!e.fp.ready(us)) pending = true;
      } else if (e.vel) {
        this.driveVisualEl(e, target, speed);
        if (e.vel.readyState < 2) pending = true;
      }

      // som
      const hasSound = m.hasAudio || m.type === 'audio';
      if (hasSound && e.pcmState === 'opening') continue; // ainda abrindo o arquivo de som: entra assim que abrir, na posição certa
      if (hasSound && e.pcmState === 'ready' && speed === 1 && !c.curve) {
        if (e.el && !e.el.paused) e.el.pause();
        this.driveVoice(e, c, p, tr, m, t, target, end, now);
        continue;
      }
      if (e.sched) this.stopPcm(e); // velocidade mudou: este trecho passa para o <audio>
      if (!e.el && hasSound && !this.adoptAudio(e, c, p)) this.makeAudio(e, m);
      const el = e.el;
      if (!el) continue;
      const silent = tr.muted || tr.hidden || c.audioDetached || this.muteAll || !m.hasAudio;
      const vol = silent ? 0 : valueAt(c, 'volume', local) * fadeGain(effectiveAudio(p, c), local, end - c.start) * duckGainAt(p, s.cache, mediaById, c, local);
      this.connect(e, this.needsGain(c, p) ? 2 : vol);
      this.setVolume(el, e.gain, vol);
      if (this.playing) {
        this.driveSound(e, c, el, t, target, speed, keepPitch, vol > 0.001, now);
      } else {
        // Parado: o som fica no ponto certo (e quente) para o play começar na hora; arrastando, não mexe.
        if (!this.scrubbing && el.readyState >= 1 && !el.seeking && Math.abs(el.currentTime - target) > 0.04) {
          el.currentTime = target;
          el.__heat = null; // mexi na posição de propósito: não é o navegador ignorando a taxa 0
        }
        if (!this.scrubbing) this.heat(el);
      }
    }

    for (const id of [...this.entries.keys()]) if (!near.has(id)) this.dispose(id);
    if (pending) this.invalidate(160); // ainda chegando: continua tentando

    // ---- 3) desenho ----
    // Só se redesenha quando há algo novo: um quadro de vídeo diferente na tela, um clipe que anima sozinho (texto, efeito,
    // keyframes...) ou uma mudança no projeto. Assim cada quadro do vídeo aparece uma vez, sem depender do ritmo do
    // navegador, e a espera pelo decodificador (uma busca) não gasta desenhos repetidos.
    let sig = '';
    let animated = false;
    let missing = false;
    for (const { c, m, e, active } of list) {
      if (!active) continue;
      if (m.type === 'video' && !m.missing && !this.sourceOf(c)) missing = true;
      sig += e.fp ? e.fp.curTs + ',' : e.vel ? Math.round(e.vel.currentTime * 1000) + ',' : '-,';
      if (this.playing && isAnimated(c, p)) animated = true;
    }
    // Um clipe de vídeo ainda sem imagem (abrindo, ou recomeçando): desenhar agora deixaria o preto no lugar dele e a
    // tela piscaria. Segura a imagem que já está lá; só desiste e desenha depois de meio segundo.
    if (missing && this.drawnOnce && (this.playing || this.scrubbing)) {
      this.missingSince ||= now;
      if (now - this.missingSince < 500) return;
    } else this.missingSince = 0;
    if (this.playing) {
      for (const c of p.clips) if (c.kind && t >= c.start && t < clipEnd(c)) animated = true;
      const since = now - this.lastDrawAt;
      if (!animated && sig === this.lastSig && !this.needDraw && since < 120) return;
      if (since < (1000 / this.maxFps) * 0.55) return;
      this.lastDrawAt = now;
    } else if (!this.needDraw && sig === this.lastSig) return;
    this.needDraw = false;
    this.lastSig = sig;
    this.drewNow = true;
    this.drawnOnce = true;
    try {
      this.draw(t, p, mediaById);
    } catch (err) {
      // um desenho que falha no meio deixa a tela pela metade: refaz no próximo quadro em vez de ficar assim
      this.needDraw = true;
      this.invalidate(100);
      console.error(err);
    }
  }

  // Som de um clipe que está tocando (WebAudio): volume pelo ganho; parado, só deixa os trechos decodificados.
  driveVoice(e, c, p, tr, m, t, target, end, now) {
    const ctx = this.audioCtx;
    if (!ctx) return;
    if (e.pcm.failed) {
      // o aparelho não decodificou este som: o clipe volta para o <audio> (na próxima passada)
      console.warn('som pelo WebAudio falhou, usando <audio>:', e.pcm.failed?.message || e.pcm.failed);
      this.stopPcm(e);
      e.pcmState = 'off';
      this.wake();
      return;
    }
    const vol = this.volumeOf(c, p, tr, m, t - c.start, end);
    this.setPcmGain(e, vol);
    const k = Math.floor(target / CHUNK);
    if (!this.playing) {
      if (e.sched) this.stopPcm(e);
      if (!this.scrubbing) {
        e.pcm.ensure(k, ctx);
        e.pcm.ensure(k + 1, ctx);
      }
      return;
    }
    if (ctx.state !== 'running') {
      // O relógio de áudio só anda depois que o aparelho liga a saída (cerca de 100 ms no primeiro toque): o som entra então,
      // já na posição certa, em vez de ser agendado num relógio parado e sair atrasado.
      ctx.resume?.();
      return;
    }
    if (!e.sched) {
      e.pcm.ensure(k + 1, ctx);
      this.startPcm(e, c, t + (performance.now() - now) / 1000, false);
    }
    if (e.sched) this.extendPcm(e, c);
  }

  // O relógio da linha do tempo é o do aparelho (nunca volta nem espera); o som é que o acompanha. Ligado a frio ele
  // sai já um pouco à frente (o atraso que o aparelho tem para começar a tocar, aprendido); depois, uma diferença
  // pequena é corrigida acelerando ou freando o som (sem que se perceba), e uma grande, com uma busca.
  driveSound(e, c, el, t, target, speed, keepPitch, loud, now) {
    el.__heat = null; // tocando de verdade: a marca de "quente" (taxa 0) de antes não vale mais
    const base = Math.min(16, Math.max(0.0625, speed));
    if (el.preservesPitch !== keepPitch) el.preservesPitch = keepPitch;
    if (el.paused) {
      // a frio: posiciona um pouco à frente e toca
      const want = target + this.audioLead;
      if (Math.abs(el.currentTime - want) > 0.05) el.currentTime = want;
      el.playbackRate = base;
      e.coldStart = true;
      e.live = false;
      e.lastCT = null;
      e.playAt = now;
      this.stats.plays++;
      el.play().catch((err) => {
        this.stats.rejects++;
        this.stats.lastErr = err?.name || String(err);
      });
      return;
    }
    if (el.seeking) return;
    // "ao vivo": o tempo do som já anda
    if (!e.live && el.readyState >= 2 && el.playbackRate > 0 && e.lastCT != null && el.currentTime !== e.lastCT) {
      e.live = true;
      if (e.coldStart) {
        // Quanto o som ficou para trás na primeira vez que "pegou" é o atraso do aparelho; da próxima já sai a tempo.
        const behind = target - el.currentTime;
        this.audioLead = Math.min(0.8, Math.max(0, this.audioLead + behind * 0.7));
        e.coldStart = false;
      }
    }
    e.lastCT = el.currentTime;
    if (c.curve) {
      if (Math.abs(el.playbackRate - base) > 5e-4) el.playbackRate = base;
      return;
    }
    const drift = el.currentTime - target;
    const tol = loud ? 0.35 : 0.8;
    // Som ainda começando (celulares levam de 0,2 a 1 s para o primeiro som sair): esperar, não buscar de novo — cada busca
    // recomeça a espera e o som fica picotado. Depois de uma busca, também há uma folga antes da próxima.
    if ((!e.live && now - (e.playAt || 0) < 1600) || now - (e.resyncAt || 0) < 1200) {
      if (Math.abs(drift) < 1.5) return;
    }
    if (Math.abs(drift) > tol) {
      e.resyncAt = now;
      el.currentTime = target + (el.playbackRate > 0 ? 0.03 : 0);
      el.__heat = null;
      this.stats.resyncs = (this.stats.resyncs || 0) + 1;
      return;
    }
    // Quente (taxa 0) até agora: passa a andar, um pouco mais rápido por um instante (o som leva ~50 ms para pegar o ritmo).
    if (el.playbackRate === 0) e.boostUntil = now + 350;
    let rate = base;
    if (now < (e.boostUntil || 0)) rate *= 1.06;
    // Mexer na taxa de um som que toca faz o navegador recalcular o áudio (estalo/chiado em celulares): só se corrige
    // quando a diferença já é audível para a imagem (> 40 ms), de leve (no máximo ±4 %), e volta a 1× logo que fecha.
    if (el.playbackRate > 0 && !(now < (e.boostUntil || 0))) {
      const ad = Math.abs(drift);
      const cur = el.playbackRate / base;
      if (ad > 0.04 || (Math.abs(cur - 1) > 0.002 && ad > 0.015)) rate *= 1 - Math.max(-0.04, Math.min(0.04, drift * 1.2));
    }
    if (Math.abs(el.playbackRate - rate) > 5e-4) el.playbackRate = rate;
  }

  // Caso especial (sem decodificação própria): o <video> mudo acompanha a linha do tempo só para a imagem.
  driveVisualEl(e, target, speed) {
    const v = e.vel;
    if (this.playing) {
      if (v.paused) {
        if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
        v.play().catch(() => {});
      }
      if (Math.abs(v.playbackRate - speed) > 5e-4) v.playbackRate = Math.min(16, Math.max(0.0625, speed));
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.015) v.currentTime = target;
    }
  }
}

const sourceSpeedOne = (c) => !c.curve && (c.speed == null || c.speed === 1);
