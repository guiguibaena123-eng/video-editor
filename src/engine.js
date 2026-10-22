import { drawTextClip, textBounds } from './text';
import { fadeGain, needsProxy, ensureProxy } from './audio';
import { duckGainAt } from './audioPro';
import { sourceAt, speedAt } from './speed';
import { transformAt, visualStateAt, valueAt } from './keyframes';
import { colorGL } from './gl';
import { hasMask, maskCanvas, CANVAS_BLEND } from './masks';
import { effectiveAudio } from './transitions';
import { hasImageFx, imageFxAt, needsGLPass, withTrackFx } from './effects';
import { lutFor, spatialOf, onLutReady } from './colorRuntime';
import { useStore, clipEnd, projectDuration, mediaUrl, cropOf, croppedSize } from './store';
import { takePrewarmed } from './web/registry';

// iPhone/iPad: o navegador ignora o volume do elemento de mídia, então o som precisa passar pelo WebAudio.
export const IOS_LIKE = typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Motor de reprodução: mantém um <video> por clipe próximo do cursor, sincroniza
// com o relógio da linha do tempo e desenha as trilhas de vídeo num canvas.
export class Engine {
  canvas = null;
  g = null;
  entries = new Map(); // clipId -> { el, mediaId, gain, primed }
  images = new Map(); // mediaId -> HTMLImageElement
  audioCtx = null;
  playing = false;
  clock = { t0: 0, wall0: 0 };
  lastTime = -1;
  raf = 0;

  // Perfil leve (celular): desenha no máximo maxFps quadros por segundo, guarda o quadro de apoio só de vez em
  // quando, abre poucos vídeos ao mesmo tempo e tolera mais atraso antes de refazer uma busca.
  lite = false;
  maxFps = 0;
  nextLead = 3; // perfil leve: quantos segundos antes o próximo clipe começa a ser preparado (vídeo carregado + tira de quadros)
  lastFrameAt = 0;
  snapTick = 0;
  lastTickMs = 0;
  heldMs = 0;
  stalledPrev = false;
  // "Quente" (celular): ao parar, o vídeo do ponto atual não é pausado — fica rodando a taxa 0, mudo, com o
  // decodificador ligado. Dar play vira só trocar a taxa para 1: o quadro novo sai em ~1–2 quadros, sem ligar nada.
  warmRate = 0.0625; // velocidade do pré-aquecimento do próximo clipe
  warmLead = 0.7; // quantos segundos antes ele começa
  stripsOn = true; // tira de quadros ligada (desligar só em testes)
  cold = false; // depois de 20 s parado tudo é pausado de verdade (bateria)
  noHot = false; // este navegador não respeita taxa 0: usa pausa normal
  coolT = 0;
  stats = { rejects: 0, lastErr: '', plays: 0, rvfc: 0, sync: 0, holds: [] }; // para o painel de diagnóstico do celular
  lastWritten = 0; // último tempo gravado na interface (a interface recebe ~30 Hz; o relógio corre a cada quadro)
  lastWriteAt = 0;
  frameFlag = false; // chegou um quadro novo do vídeo (requestVideoFrameCallback)
  lastDrawAt = 0;
  drewNow = false;
  rvfc = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  tickFns = new Set(); // quem quer o tempo a cada quadro (sem passar pelo store)

  onTick(fn) {
    this.tickFns.add(fn);
    return () => this.tickFns.delete(fn);
  }

  // O tempo de agora: tocando, o do relógio do motor (o do store pode estar um pouco atrasado).
  timeNow() {
    return this.playing && this.lastTime >= 0 ? this.lastTime : useStore.getState().currentTime;
  }

  drawUntil = 0; // o player só redesenha parado enquanto algo mudou (poupa CPU/GPU/bateria)
  slowFrames = 0;
  lastLoop = 0;
  emaInterval = 0;

  // Pede para desenhar nos próximos instantes (mudou o projeto, o tempo, o tamanho...).
  invalidate(ms = 450) {
    this.drawUntil = Math.max(this.drawUntil, performance.now() + ms);
    if (this.lite && !this.playing) {
      this.cold = false;
      clearTimeout(this.coolT);
      this.coolT = setTimeout(() => this.cool(), 20000);
    }
  }

  // Esfria: pausa de verdade o que estava "quente" (sem mexer há 20 s, ou o app foi para o segundo plano).
  cool() {
    if (this.playing) return;
    this.cold = true;
    for (const e of this.entries.values()) for (const el of [e.el, e.ael]) if (el && !el.paused && el.playbackRate === 0) el.pause();
  }

  // Parar sem esfriar o decodificador (ver "quente").
  park(el) {
    if (el.paused) return;
    if (!this.lite || this.cold || this.noHot) return void el.pause();
    try {
      el.playbackRate = 0;
    } catch {
      return void el.pause();
    }
    if (el.playbackRate !== 0) el.pause();
  }

  // Esquenta um vídeo parado: roda mudo a taxa 0. Se o navegador não respeitar (a posição andou), desiste.
  heat(el) {
    if (!el.paused) {
      const h = el.__heat;
      if (h && el.playbackRate === 0 && !el.seeking && performance.now() - h.t > 400) {
        if (Math.abs(el.currentTime - h.ct) > 0.15) {
          this.noHot = true;
          el.pause();
        }
        el.__heat = null;
      }
      return;
    }
    if (!this.lite || this.cold || this.noHot || el.readyState < 2 || el.seeking || el.ended) return;
    try {
      el.muted = true;
      el.playbackRate = 0;
      el.__heat = { t: performance.now(), ct: el.currentTime };
      el.play().catch(() => {});
    } catch {}
  }

  attach(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.unsub = useStore.subscribe(() => this.invalidate());
    this.onHide = () => document.hidden && this.onHidden();
    document.addEventListener('visibilitychange', this.onHide);
    this.onFonts = () => this.invalidate(300);
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    onLutReady(() => this.invalidate(300));
    this.invalidate(1000);
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  onHidden() {
    this.cool();
  }

  detach() {
    this.unsub?.();
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
    document.removeEventListener('visibilitychange', this.onHide);
    clearTimeout(this.coolT);
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.canvas = null;
  }

  ensureAudio() {
    if (this.audioCtx) {
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
      return;
    }
    this.audioCtx = new AudioContext();
    for (const entry of this.entries.values()) this.connect(entry);
  }

  // Liga o som do elemento a um controle de volume (permite passar de 100%).
  // No celular o som só passa pelo WebAudio quando precisa (volume acima de 100%, ou iPhone, onde o volume do
  // elemento não funciona): o caminho nativo toca junto com a imagem, sem o atraso extra do WebAudio.
  connect(entry, vol = 1) {
    // iPhone: o volume do elemento não funciona, mas em 100% (o normal) o som nativo é o mais colado na imagem.
    if (this.lite && !(vol > 1.001 || (IOS_LIKE && vol > 0.001 && vol < 0.999))) return;
    if (!this.audioCtx) {
      this.ensureAudio();
      if (!this.audioCtx) return;
    }
    if (!entry.gain) entry.gain = this.route(entry.el);
    if (entry.ael && !entry.again) entry.again = this.route(entry.ael);
  }

  route(el) {
    const src = this.audioCtx.createMediaElementSource(el);
    const gain = this.audioCtx.createGain();
    src.connect(gain).connect(this.audioCtx.destination);
    return gain;
  }

  setVolume(el, gainNode, vol) {
    if (gainNode) {
      gainNode.gain.value = vol;
      el.volume = 1;
    } else {
      el.volume = Math.min(1, vol);
      const mute = vol <= 0.001; // iPhone ignora volume, mas respeita mudo
      if (el.muted !== mute) el.muted = mute;
    }
  }

  // Mantém um elemento de mídia no ponto certo (tocando ou parado).
  sync(el, target, speed, keepPitch = true, tol = this.lite ? 0.5 : 0.3, nudge = false, boost = 0) {
    // O navegador só toca entre 1/16x e 16x; fora disso a posição é corrigida por saltos.
    let rate = Math.min(16, Math.max(0.0625, speed));
    // Pequeno atraso/adiantamento (som que começou um pouco depois): corrige acelerando ou freando o som em
    // até 8%, sem busca — a busca faz o som falhar e voltar "bugado". Só para quem segue a linha do tempo.
    // Começo instantâneo: o vídeo ainda está atrás da linha do tempo (acabou de ligar): corre até 2× por um instante.
    if (boost > 0.03) rate = Math.min(16, rate * Math.min(2, 1 + boost * 4));
    if (nudge && this.playing && !el.paused && !el.seeking) {
      const drift = el.currentTime - target;
      if (Math.abs(drift) > 0.02 && Math.abs(drift) <= tol) rate *= 1 - Math.max(-0.12, Math.min(0.12, drift * 0.8));
    }
    if (this.playing && Math.abs(el.playbackRate - rate) > 5e-4) el.playbackRate = rate;
    if (el.preservesPitch !== keepPitch) el.preservesPitch = keepPitch;
    if (this.playing) {
      if (el.paused) {
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
        this.stats.plays++;
        el.play().catch((err) => {
          this.stats.rejects++;
          this.stats.lastErr = err?.name || String(err);
        });
      } else if (!(this.lite && el.seeking) && Math.abs(el.currentTime - target) > tol) {
        el.currentTime = target;
      }
    } else {
      this.park(el);
      this.heat(el);
      if (!el.seeking && Math.abs(el.currentTime - target) > 0.015) {
        // Arrastando a linha do tempo: no Safari, "fastSeek" vai ao quadro-chave mais próximo (rápido); ao soltar vem a busca exata.
        if (this.scrubbing && el.fastSeek && Math.abs(el.currentTime - target) > 0.25) el.fastSeek(target);
        else el.currentTime = target;
      }
    }
  }

  // Recorta o quadro com a máscara (mesmo desenho usado na exportação).
  applyMask(src, mask) {
    const w = src.videoWidth || src.naturalWidth || src.displayWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.displayHeight || src.height;
    if (!w || !h) return src;
    const k = Math.min(1, 1920 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k));
    const H = Math.max(1, Math.round(h * k));
    let buf = this.maskBuf;
    if (!buf) buf = this.maskBuf = document.createElement('canvas');
    if (buf.width !== W || buf.height !== H) {
      buf.width = W;
      buf.height = H;
    }
    const bg = buf.getContext('2d');
    bg.globalCompositeOperation = 'source-over';
    bg.clearRect(0, 0, W, H);
    bg.drawImage(src, 0, 0, W, H);
    bg.globalCompositeOperation = 'destination-in';
    bg.drawImage(maskCanvas(mask, W, H), 0, 0);
    bg.globalCompositeOperation = 'source-over';
    return buf;
  }

  // Brilho: uma cópia desfocada somada por cima no modo "tela" (igual a gblur + blend screen do FFmpeg).
  applyGlow(src, glow) {
    const w = src.videoWidth || src.naturalWidth || src.displayWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.displayHeight || src.height;
    if (!w || !h) return src;
    const k = Math.min(1, 1920 / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k));
    const H = Math.max(1, Math.round(h * k));
    let buf = this.glowBuf;
    if (!buf) buf = this.glowBuf = document.createElement('canvas');
    if (buf.width !== W || buf.height !== H) {
      buf.width = W;
      buf.height = H;
    }
    const bg = buf.getContext('2d');
    bg.save();
    bg.clearRect(0, 0, W, H);
    bg.drawImage(src, 0, 0, W, H);
    bg.globalAlpha = glow.opacity;
    bg.globalCompositeOperation = 'screen';
    bg.filter = `blur(${glow.sigma * W}px)`;
    bg.drawImage(src, 0, 0, W, H);
    bg.restore();
    return buf;
  }

  // Cópia do quadro atual (no tamanho original, limitado a 1280 px) para usar durante buscas.
  // Tem o mesmo tamanho do vídeo, então o recorte em frações continua valendo.
  keepFrame(entry) {
    const el = entry.el;
    if (!el.videoWidth) return;
    let snap = entry.snap;
    if (!snap) {
      const k = Math.min(1, 1280 / el.videoWidth);
      snap = entry.snap = document.createElement('canvas');
      snap.width = Math.max(1, Math.round(el.videoWidth * k));
      snap.height = Math.max(1, Math.round(el.videoHeight * k));
      snap.ctx = snap.getContext('2d');
    }
    snap.ctx.drawImage(el, 0, 0, snap.width, snap.height);
  }

  // Áudio processado (efeito de voz, redução de ruído...) tocado junto do clipe.
  setProxy(entry, path) {
    if (entry.proxyPath === path) return;
    if (entry.ael) {
      entry.ael.pause();
      entry.ael.removeAttribute('src');
      entry.ael.load();
      entry.ael = null;
      entry.again = null;
    }
    entry.proxyPath = path;
    if (!path) return;
    const a = document.createElement('audio');
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    a.src = mediaUrl(path);
    entry.ael = a;
    this.connect(entry);
  }

  play() {
    const s = useStore.getState();
    const total = projectDuration(s.project);
    if (total <= 0) return;
    if (!this.lite) this.ensureAudio(); // no celular o contexto de áudio só nasce se algum som precisar (volume > 100%...)
    const start = s.currentTime >= total - 0.01 ? 0 : s.currentTime;
    this.clock = { t0: start, wall0: performance.now() };
    this.lastTickMs = performance.now();
    this.startHold = true; // até o vídeo mestre rodar, os outros sons NÃO esperam: começam juntos e a linha do tempo os alcança
    this.heldMs = 0;
    // Começo instantâneo: a linha do tempo anda NA HORA, sem esperar o decodificador ligar; o vídeo (e o som dele)
    // entram uns 50–150 ms depois e correm até 2× por um instante para alcançá-la.
    clearTimeout(this.coolT);
    this.cold = false;
    for (const e of this.entries.values()) {
      e.wasActive = false; // o primeiro quadro abaixo abre a "rampa" de cada clipe ativo
      e.capToken = (e.capToken || 0) + 1; // cancela capturas de quadros em andamento
    }
    this.stalledPrev = false;
    this.lastTime = start;
    this.lastWritten = start;
    this.lastWriteAt = 0;
    this.playing = true;
    useStore.setState({ playing: true, currentTime: start });
    // O navegador só deixa o vídeo começar a tocar a partir de um toque: roda o primeiro passo já, dentro do toque
    // (no iPhone, tocar no próximo quadro de animação é tarde demais e o vídeo nem começa).
    try {
      this.frame();
    } catch (err) {
      console.error(err);
    }
  }

  // Toca de "from" até "to" e para (usado na prévia de animações).
  playRange(from, to) {
    useStore.setState({ currentTime: from });
    this.stopAt = to;
    this.play();
  }

  pause() {
    this.stopAt = null;
    // O último tempo calculado pode ainda não ter ido para a tela (veja frame()): grava antes de parar.
    if (this.playing && this.lite && this.lastWritten !== this.lastTime && this.lastTime >= 0) {
      useStore.setState({ currentTime: this.lastTime });
      this.lastWritten = this.lastTime;
    }
    this.playing = false;
    const st = useStore.getState();
    const tNow = st.currentTime;
    for (const [id, e] of this.entries) {
      if (this.lite && e.el.readyState >= 2 && !e.snap) this.keepFrame(e); // quadro de apoio para buscas depois de parar
      const c = st.project.clips.find((x) => x.id === id);
      if (c && tNow >= c.start && tNow < clipEnd(c)) this.park(e.el);
      else e.el.pause();
      e.ael?.pause();
    }
    useStore.setState({ playing: false });
    this.invalidate(600);
    if (this.lite) {
      clearTimeout(this.idleT);
      this.idleT = setTimeout(() => this.captureIdle(), 250);
    }
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  getEntry(clip, media) {
    let entry = this.entries.get(clip.id);
    if (entry && entry.mediaId !== media.id) {
      this.dispose(clip.id);
      entry = null;
    }
    // Vídeo grande toca pelo proxy leve (menos na qualidade "Alta"); a exportação nunca usa o proxy.
    const s = useStore.getState();
    const want = s.previewQuality !== 'high' && s.cache[media.id]?.proxy ? s.cache[media.id].proxy : media.path;
    // (Só parado: trocar a fonte no meio da reprodução cortaria a imagem e o som; a troca espera uma pausa.)
    if (entry && entry.srcPath !== want && !this.playing) {
      // Proxy ficou pronto (ou a qualidade mudou): troca a fonte; o último quadro guardado cobre a troca.
      this.keepFrame(entry);
      entry.srcPath = want;
      entry.stripSlow = false;
      this.dropStrip(entry);
      entry.el.src = mediaUrl(want);
      entry.primed = false;
    }
    if (!entry) {
      // Vídeo importado agora: adota o elemento que já começou a carregar (celular); senão cria um novo.
      const el = takePrewarmed(want) || document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.playsInline = true;
      if (!el.src) el.src = mediaUrl(want);
      el.addEventListener('seeked', () => {
        // Arrastando a linha do tempo, o próximo pedido de busca sai antes do desenho: guarda o quadro que acabou de chegar.
        if (!this.playing && el.readyState >= 2 && !entry.capturing) this.keepFrame(entry);
        this.requestDraw();
      });
      el.addEventListener('loadeddata', () => this.requestDraw());
      entry = { el, mediaId: media.id, gain: null, primed: false, srcPath: want, live: false };
      // "live" = o vídeo está de fato rodando agora (não só mandado tocar): o relógio espera por isso.
      const setLive = (v) => () => void ((entry.live = v), v || (entry.snapped = false));
      el.addEventListener('playing', setLive(true));
      for (const ev of ['pause', 'waiting', 'seeking', 'ended', 'emptied']) el.addEventListener(ev, setLive(false));
      // Cada quadro novo do vídeo pede um desenho: o player acompanha o ritmo real do vídeo, sem pular quadros.
      if (this.lite && this.rvfc) {
        const cb = () => {
          this.frameFlag = true;
          this.stats.rvfc++;
          entry.vf = (entry.vf || 0) + 1; // quadros que este vídeo já apresentou (fim da rampa)
          if (!el.paused && !el.seeking) entry.live = true; // quadro novo apresentado: o vídeo está rodando

          if (!entry.dead) el.requestVideoFrameCallback(cb);
        };
        el.requestVideoFrameCallback(cb);
      }
      this.entries.set(clip.id, entry);
      this.connect(entry);
    }
    return entry;
  }

  getImage(media) {
    let img = this.images.get(media.id);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.requestDraw();
      img.src = mediaUrl(media.path);
      this.images.set(media.id, img);
    }
    return img;
  }

  dispose(clipId) {
    const e = this.entries.get(clipId);
    if (!e) return;
    e.dead = true;
    this.dropStrip(e);
    this.setProxy(e, null);
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    this.entries.delete(clipId);
  }

  // Clipe anterior que termina onde este começa, do mesmo arquivo, no mesmo ponto de origem e na mesma velocidade
  // (um corte): dá para seguir tocando o MESMO elemento de vídeo, sem parar nem buscar.
  continuesFrom(p, c) {
    if (c.curve || c.kind) return null;
    return p.clips.find((q) => q.id !== c.id && !q.kind && !q.curve && q.mediaId === c.mediaId && q.trackId === c.trackId && (q.speed || 1) === (c.speed || 1) && Math.abs(clipEnd(q) - c.start) < 0.08 && Math.abs(q.out - c.in) < 0.12);
  }

  adoptContinuations(p, t) {
    for (const c of p.clips) {
      if (c.kind || t < c.start || t >= clipEnd(c)) continue;
      const prev = this.continuesFrom(p, c);
      const pe = prev && this.entries.get(prev.id);
      if (!pe || pe.el.paused || pe.el.seeking || pe.dead) continue;
      if (this.entries.get(c.id) === pe) continue;
      if (this.entries.has(c.id)) this.dispose(c.id);
      this.entries.delete(prev.id);
      this.entries.set(c.id, pe);
      pe.primed = false;
    }
  }

  // ---- "Tira de quadros": os primeiros ~0,33 s de um clipe, já decodificados em bitmaps ----
  // Quando o vídeo volta a andar (play ou entrada de um clipe de outro arquivo) o navegador leva ~100–130 ms para
  // entregar o primeiro quadro novo. Durante esse tempo o player desenha estes bitmaps (iguais aos quadros do vídeo),
  // então a imagem não congela; assim que o vídeo emparelha, a tira é descartada.
  seekTo(el, t, ms = 500) {
    return new Promise((resolve) => {
      if (!el.seeking && el.readyState >= 2 && Math.abs(el.currentTime - t) < 0.002) return resolve(true);
      let to = 0;
      const done = (ok) => {
        clearTimeout(to);
        el.removeEventListener('seeked', on);
        resolve(ok);
      };
      const on = () => done(true);
      to = setTimeout(() => done(false), ms);
      el.addEventListener('seeked', on, { once: true });
      el.currentTime = t;
    });
  }

  // A tira só compensa em vídeo de busca rápida: a cópia leve ou vídeo pequeno. Original grande: pré-aquecimento lento.
  canStrip(entry, m) {
    if (entry.stripSlow) return false;
    const proxy = /-p\/previa\.mp4$/.test(entry.srcPath || '');
    return proxy || Math.max(m?.width || 0, m?.height || 0) <= 1280;
  }

  dropStrip(entry) {
    if (entry.strip) for (const b of entry.strip.bitmaps) b.close?.();
    entry.strip = null;
  }

  async captureStrip(entry, c, start, kind) {
    // Só vale a pena em vídeo de busca rápida (a cópia leve): em original pesado cada busca leva centenas de ms.
    if (!this.stripsOn || entry.capturing || entry.dead || entry.stripSlow || c.curve || typeof createImageBitmap === 'undefined') return;
    const el = entry.el;
    const token = (entry.capToken = (entry.capToken || 0) + 1);
    const K = 10;
    const dt = 1 / 30;
    const bms = [];
    entry.capturing = true;
    let aborted = false;
    try {
      for (let k = 0; k < K; k++) {
        if (entry.dead || entry.capToken !== token || (kind === 'idle' && this.playing)) {
          aborted = true;
          throw 0;
        }
        const t0 = performance.now();
        if (!(await this.seekTo(el, start + k * dt))) throw 0;
        if (k > 0 && performance.now() - t0 > 220) {
          entry.stripSlow = true;
          throw 0;
        }
        bms.push(await createImageBitmap(el));
      }
      await this.seekTo(el, start);
      if (entry.dead || entry.capToken !== token) throw 0;
      this.dropStrip(entry);
      entry.strip = { start, dt, bitmaps: bms };
    } catch {
      entry.primed = false; // a busca da captura mexeu no vídeo: volta ao ponto de entrada
      if (aborted && !entry.dead && bms.length >= 4 && !entry.stripSlow) {
        // Tocou antes de terminar: os primeiros quadros já bastam para cobrir a partida do vídeo.
        this.dropStrip(entry);
        entry.strip = { start, dt, bitmaps: bms };
      } else for (const b of bms) b.close?.();
    } finally {
      entry.capturing = false;
      this.requestDraw();
    }
  }

  // Parado e sem mexer: prepara a tira do ponto atual para o play seguinte começar sem congelar.
  async captureIdle(tries = 0) {
    if (!this.lite || this.playing || !this.stripsOn) return;
    const s = useStore.getState();
    const t = s.currentTime;
    let waiting = false;
    for (const c of s.project.clips) {
      if (c.kind || t < c.start || t >= clipEnd(c) || c.curve) continue;
      const entry = this.entries.get(c.id);
      if (!entry || entry.el.readyState < 2 || entry.el.seeking) {
        waiting = true; // ainda carregando: tenta de novo daqui a pouco
        continue;
      }
      const m = s.media.find((x) => x.id === c.mediaId);
      if (!m || m.type !== 'video' || !this.canStrip(entry, m)) continue;
      const target = sourceAt(c, t - c.start);
      if (entry.strip && Math.abs(entry.strip.start - target) < 0.02) continue;
      await this.captureStrip(entry, c, target, 'idle');
      if (this.playing || Math.abs(useStore.getState().currentTime - t) > 1e-4) return;
    }
    if (waiting && tries < 40) {
      clearTimeout(this.idleT);
      this.idleT = setTimeout(() => this.captureIdle(tries + 1), 150);
    }
  }

  requestDraw() {
    this.lastTime = -1;
    this.invalidate();
  }

  loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    this.lastFrameAt = now;
    this.drewNow = false;
    try {
      this.frame();
    } catch (err) {
      console.error(err);
    }
    // No perfil leve o ritmo é o dos desenhos (não o do rAF, que roda a 60 Hz só para manter o relógio colado).
    if (!this.lite || this.drewNow) this.watchSpeed(now);
  };

  // No modo "Automático" da qualidade, se a reprodução não acompanha o relógio a imagem do player
  // passa a ser desenhada em resolução menor (a exportação não muda) — assim roda leve em qualquer PC.
  watchSpeed(now) {
    const s = useStore.getState();
    if (!this.playing || s.previewQuality !== 'auto') {
      this.lastLoop = 0;
      this.slowFrames = 0;
      return;
    }
    if (this.lastLoop) {
      const dt = now - this.lastLoop;
      this.emaInterval = this.emaInterval ? this.emaInterval * 0.9 + dt * 0.1 : dt;
      const budget = 1000 / Math.min(this.lite && this.maxFps ? this.maxFps : 60, s.project.settings.fps || 30);
      if (this.emaInterval > budget * 1.4) this.slowFrames++;
      else this.slowFrames = Math.max(0, this.slowFrames - 1);
      if (this.slowFrames > 40 && s.autoScale > (this.lite ? 0.65 : 0.4)) {
        this.slowFrames = 0;
        this.emaInterval = 0;
        useStore.setState({ autoScale: Math.max(this.lite ? 0.65 : 0.4, +(s.autoScale * 0.8).toFixed(2)) });
      }
    }
    this.lastLoop = now;
  }

  frame() {
    // Parado e sem nada novo para mostrar: não gasta nada.
    if (!this.playing && performance.now() > this.drawUntil) return;
    const s = useStore.getState();
    const p = s.project;
    const total = projectDuration(p);
    let t = s.currentTime;

    if (this.playing) {
      // Se alguém mudou o tempo (clique na régua, atalhos), o relógio recomeça dali.
      if (Math.abs(t - this.lastWritten) > 1e-6) this.clock = { t0: t, wall0: performance.now() };
      // Se no quadro anterior o vídeo mestre ainda não estava rodando, o relógio não anda neste (espera por ele).
      const nowT = performance.now();
      if (this.lite && this.stalledPrev && this.heldMs < 2500 && this.lastTickMs) this.clock.wall0 += nowT - this.lastTickMs;
      t = Math.max(0, this.clock.t0 + (nowT - this.clock.wall0) / 1000);
      let ended = false;
      if (t >= total || (this.stopAt != null && t >= this.stopAt)) {
        t = Math.min(t, total, this.stopAt ?? total);
        this.lastTime = t;
        this.pause();
        ended = true;
      }
      // O tempo vai para a tela (linha do tempo, contador) a ~30 Hz: o relógio interno corre a cada quadro, mas
      // atualizar a interface 60 vezes por segundo pesa no celular sem ninguém enxergar a diferença.
      if (ended || !this.lite || nowT - this.lastWriteAt >= 28) {
        useStore.setState({ currentTime: t });
        this.lastWritten = t;
        this.lastWriteAt = nowT;
      }
    }
    // Mexendo no tempo com o player parado (arrastando a linha): busca rápida; 200 ms sem mexer → busca exata.
    if (!this.playing) {
      if (Math.abs(t - this.lastTime) > 1e-4) {
        this.lastScrubAt = performance.now();
        if (this.lite) {
          clearTimeout(this.idleT);
          this.idleT = setTimeout(() => this.captureIdle(), 200);
        }
      }
      this.scrubbing = performance.now() - (this.lastScrubAt || 0) < 200;
      if (this.scrubbing) this.invalidate(350);
      else if (this.lite && this.stripsOn && !this.idlePending) {
        // Parado há um instante e algum clipe visível ainda sem a tira de quadros: prepara (ex.: logo depois de carregar).
        const need = [...this.entries.entries()].some(([id, e]) => !e.strip && !e.capturing && !e.stripSlow && e.wasActive !== undefined && p.clips.some((c) => c.id === id && t >= c.start && t < clipEnd(c) && !c.kind && !c.curve));
        if (need) {
          this.idlePending = true;
          clearTimeout(this.idleT);
          this.idleT = setTimeout(() => {
            this.idlePending = false;
            this.captureIdle();
          }, 120);
        }
      }
    } else this.scrubbing = false;
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
    const near = new Set();
    // Mestre do relógio (perfil leve): o vídeo visível mais embaixo (trilha principal); só na falta dele, um áudio.
    let masterId = null;
    if (this.lite && this.playing) {
      let best = -1;
      for (const c of p.clips) {
        const m0 = mediaById.get(c.mediaId);
        const tr0 = trackById.get(c.trackId);
        if (!m0 || !tr0 || m0.missing || m0.type === 'image' || tr0.hidden) continue;
        if (t < c.start || t >= clipEnd(c)) continue;
        const score = m0.type === 'video' ? (tr0.main ? 3 : 2) : 1;
        if (score > best) {
          best = score;
          masterId = c.id;
        }
      }
    }
    const nowMs = performance.now();
    if (!this.lastTickMs) this.lastTickMs = nowMs;
    let stalled = false; // o vídeo mestre ainda não tem quadro: mantém na tela o último quadro bom
    let hasMaster = false; // já há um vídeo mestre do relógio neste quadro
    if (this.lite && this.playing) this.adoptContinuations(p, t);

    for (const c of p.clips) {
      const m = mediaById.get(c.mediaId);
      const tr = trackById.get(c.trackId);
      if (!m || !tr || m.missing || m.type === 'image') continue;
      const end = clipEnd(c);
      if (t < c.start - (this.lite ? this.nextLead : 3) || t > end + 1) continue;
      if (this.lite && t >= end && !this.entries.has(c.id)) continue; // já passou: não reabre
      near.add(c.id);
      const entry = this.getEntry(c, m);
      const el = entry.el;
      const speed = speedAt(c, t - c.start);
      const keepPitch = c.keepPitch !== false;
      const active = t >= c.start && t < end;
      const silent = tr.muted || tr.hidden || c.audioDetached || this.muteAll || !m.hasAudio;
      const vol = silent || !active ? 0 : valueAt(c, 'volume', t - c.start) * fadeGain(effectiveAudio(p, c), t - c.start, end - c.start) * duckGainAt(p, s.cache, mediaById, c, t - c.start);

      // Efeitos que precisam do FFmpeg: toca o áudio processado no lugar do original.
      let proxy = null;
      if (m.hasAudio && needsProxy(c.audio)) {
        const st = ensureProxy(m, c.audio);
        if (st.status === 'ready') proxy = st.path;
      }
      this.setProxy(entry, proxy);
      if (this.lite && !entry.gain) this.connect(entry, vol);
      this.setVolume(el, entry.gain, entry.ael ? 0 : vol);
      if (entry.ael) this.setVolume(entry.ael, entry.again, vol);
      if (!this.playing && !el.paused) el.muted = true;

      if (!active) {
        entry.wasActive = false;
        entry.ramp = 0;
        // Próximo clipe (outro arquivo ou outro ponto): pouco antes da hora, decodifica os primeiros quadros numa tira
        // (ver acima) e fica "quente" no ponto de entrada.
        const lead = c.start - t;
        const comingUp = this.lite && this.playing && lead > 0 && lead < Math.max(1.8, this.nextLead) && entry.primed && !c.curve && !this.continuesFrom(p, c);
        const useStrip = comingUp && this.stripsOn && this.canStrip(entry, m);
        if (useStrip && !entry.capturing && !el.seeking && el.readyState >= 2 && !(entry.strip && Math.abs(entry.strip.start - c.in) < 0.02)) this.captureStrip(entry, c, c.in, 'next');
        if (comingUp && !useStrip && lead < this.warmLead && !el.seeking && el.readyState >= 2) {
          // Sem tira (original pesado): o próximo clipe começa a rodar em câmera lenta, mudo, pouco antes da hora.
          if (el.paused) {
            el.playbackRate = this.warmRate;
            el.play().catch(() => {});
          }
        } else if (comingUp) {
          if (!entry.capturing) this.heat(el);
        } else if (!entry.capturing) {
          if (!el.paused) el.pause();
          if (entry.ael && !entry.ael.paused) entry.ael.pause();
        }
        // Deixa o primeiro quadro pronto para não travar na entrada do clipe.
        if (t < c.start && !entry.primed && !entry.capturing && el.readyState >= 1) {
          el.currentTime = c.in;
          entry.primed = true;
        }
        continue;
      }
      entry.primed = false;
      if (entry.capturing) continue; // está sendo lido para a tira de quadros: não mexe (o desenho usa o quadro guardado)
      const target0 = sourceAt(c, t - c.start);
      if (!entry.wasActive) {
        entry.wasActive = true;
        // Voltou a andar (play ou entrada do clipe): rampa = relógio livre + quadros da tira até o vídeo emparelhar.
        if (this.lite && this.playing && !c.curve) {
          entry.ramp = nowMs;
          entry.vf0 = entry.vf || 0;
          if (!entry.strip || Math.abs(entry.strip.start - target0) > 0.04) this.dropStrip(entry);
        }
      }
      // Vídeo ainda buscando/carregando o quadro: continua desenhando até ele chegar.
      if ((el.seeking || el.readyState < 2) && !el.error) this.invalidate(150);
      const target = sourceAt(c, t - c.start);
      const isMaster = c.id === masterId;
      if (this.lite && this.playing && !isMaster && this.stalledPrev && (!this.startHold || this.mSeek)) {
        // O mestre está esperando o vídeo chegar: os outros sons param juntos (senão ficam adiantados).
        if (!el.paused) el.pause();
        if (entry.ael && !entry.ael.paused) entry.ael.pause();
      } else {
        // Som tem de ficar bem colado; só um vídeo mudo pode atrasar mais sem ninguém notar.
        const loud = vol > 0.001;
        const tol = !this.lite ? 0.3 : isMaster ? 0.6 : loud ? 0.15 : 0.6;
        const nudge = this.lite && !isMaster;
        const boost = entry.ramp && !c.curve ? Math.max(0, target - el.currentTime) : 0;
        this.sync(el, target, speed, keepPitch, tol, nudge, boost);
        if (entry.ael) this.sync(entry.ael, target, speed, keepPitch, tol, nudge);
      }
      // Perfil leve: o vídeo manda no relógio. Se ele atrasa (carregando, busca, celular lento), a linha do
      // tempo espera por ele em vez de seguir sozinha e forçar buscas que travam ainda mais.
      if (isMaster) {
        hasMaster = true;
        // O evento "playing" pode chegar atrasado: se o tempo do vídeo já está andando, ele está rodando.
        if (!el.paused && !el.seeking && el.readyState >= 2 && entry.lastCT != null && el.currentTime !== entry.lastCT && !entry.live) entry.live = true;
        const justLive = entry.live && !entry.snapped;
        entry.lastCT = el.currentTime;
        this.mSeekNow = (el.seeking || el.readyState < 2) && !el.error;
        if (this.startHold && (entry.live || this.heldMs >= 2500)) this.startHold = false;
        // Rampa (começo do play ou entrada do clipe): o relógio anda sozinho enquanto o vídeo liga e o alcança. Termina
        // quando o vídeo já apresentou quadros e está no ponto certo, passa de 1,2 s, ou se ele nem estava pronto.
        if (entry.ramp) {
          const lag = target - el.currentTime;
          const notReady = (el.seeking || el.readyState < 2) && !el.error;
          const presented = (entry.vf || 0) - (entry.vf0 || 0) >= 2;
          if (notReady || lag > 1 || nowMs - entry.ramp > 1200 || (presented && lag < 0.04)) {
            entry.ramp = 0;
            this.dropStrip(entry);
            if (entry.live && !notReady && Math.abs(lag) < 0.15) entry.snapped = true; // já está colado: o relógio só o acompanha, sem pulo
          }
        }
        if (entry.ramp) {
          // relógio livre
        } else if (((el.seeking || el.readyState < 2) && !el.error) || (!entry.live && !el.error)) {
          // Ainda não está rodando (começando a tocar, buscando ou carregando): a linha do tempo espera.
          stalled = true;
        } else if (!c.curve) {
          // O vídeo é o relógio: puxa o tempo da linha para onde o vídeo (e o som dele) realmente está.
          // Assim imagem, som e linha do tempo nunca se separam, mesmo com o celular engasgando.
          const tv = c.start + (el.currentTime - c.in) / speed;
          const err = tv - t;
          // Acabou de começar a rodar: o relógio encaixa de uma vez no ponto do vídeo.
          if (justLive) {
            entry.snapped = true;
            if (Math.abs(err) <= 1) this.clock = { t0: tv, wall0: nowMs };
          }
          else          // Diferença grande = o vídeo ficou para trás de verdade: quem corrige é o sync() (busca), não o relógio.
          if (Math.abs(err) > 0.004 && Math.abs(err) <= 0.5) this.clock.t0 += err * 0.15;
        }
      }
    }
    // Espera no máximo ~2,5 s seguidos (se o vídeo nunca chega, a linha do tempo volta a andar).
    this.heldMs = stalled ? this.heldMs + (nowMs - this.lastTickMs) : 0;
    if (stalled && this.playing) this.stats.holds.push([+t.toFixed(2), Math.round(nowMs - this.lastTickMs)]);
    this.lastTickMs = nowMs;
    this.stalledPrev = stalled;
    this.mSeek = this.mSeekNow; // o mestre está buscando (pulou o tempo): os outros sons esperam por ele, não correm à frente
    this.mSeekNow = false;

    for (const id of [...this.entries.keys()]) if (!near.has(id)) this.dispose(id);
    // Esperando o vídeo (troca de clipe, busca): não redesenha, para não piscar preto entre um quadro e outro.
    if (stalled && this.playing && this.heldMs < 2500) return;
    if (this.lite && this.playing) {
      // Só desenha quando chegou quadro novo do vídeo (ou, sem vídeo/sem suporte, no ritmo máximo).
      const since = nowMs - this.lastDrawAt;
      const minGap = (1000 / (this.maxFps || 30)) * 0.8;
      const ramping = [...this.entries.values()].some((e) => e.ramp && e.strip);
      const fresh = this.rvfc && hasMaster && !ramping ? this.frameFlag || since > 38 : true;
      if (!fresh || since < minGap) return;
      this.frameFlag = false;
      this.lastDrawAt = nowMs;
    }
    this.drewNow = true;
    this.draw(t, p, mediaById);
  }

  // Imagem do clipe de vídeo para desenhar agora (um <video>, um quadro guardado...), ou null se ainda não há.
  sourceOf(c, t) {
    const entry = this.entries.get(c.id);
    if (!entry) return null;
    // Durante uma busca (arrastar a barra, mudar velocidade) o vídeo fica sem quadro
    // por um instante; desenha o último quadro guardado para o player não piscar preto.
    if (entry.capturing) return entry.snap || null;
    if (entry.ramp && entry.strip) {
      const i = Math.round((sourceAt(c, t - c.start) - entry.strip.start) / entry.strip.dt);
      return entry.strip.bitmaps[Math.max(0, Math.min(entry.strip.bitmaps.length - 1, i))];
    }
    if (entry.el.readyState >= 2) {
      if (!this.lite || !this.playing) this.keepFrame(entry);
      return entry.el;
    }
    return entry.snap || null;
  }

  // Desenha de baixo (trilha principal) para cima (sobreposições).
  draw(t, p, mediaById) {
    if (!this.canvas) return;
    const { g, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = p.settings.background || '#000';
    g.fillRect(0, 0, W, H);
    const tracks = p.tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).reverse();
    for (const tr of tracks) {
      // Por ordem de início: na transição o clipe que entra fica por cima do que sai.
      const onTrack = p.clips.filter((c) => c.trackId === tr.id && t >= c.start && t < clipEnd(c)).sort((a, b) => a.start - b.start);
      for (const c of onTrack) {
        if (c.kind === 'effect') continue;
        if (c.kind === 'text') {
          drawTextClip(g, c, t - c.start, W, H, p.settings, { transform: transformAt(c, t - c.start) });
          continue;
        }
        const m = mediaById.get(c.mediaId);
        if (!m || m.missing || !m.width) continue;
        let src;
        if (m.type === 'image') {
          src = this.getImage(m);
          if (!src.complete || !src.naturalWidth) continue;
        } else {
          src = this.sourceOf(c, t);
          if (!src) continue;
        }
        // Cor (filtro, ajustes, LUT, vinheta, nitidez) aplicada na placa de vídeo.
        // Chroma key (fundo verde) também é feito ali, antes da cor.
        // Efeitos de imagem (glitch, pixelar, inverter, granulado) vão no mesmo passo, depois da cor.
        const original = useStore.getState().compareOriginal;
        const key = c.chroma?.on ? c.chroma : null;
        const cf = withTrackFx(p, c);
        let fx = hasImageFx(cf) ? imageFxAt(cf, t - c.start, clipEnd(c) - c.start) : null;
        if ((c.color && !original) || key || fx) {
          const lut = original ? null : lutFor(c.color);
          const sp = original ? {} : spatialOf(c.color);
          // Grão da câmera entra no mesmo passo dos efeitos de imagem (mesmo ruído do granulado).
          if (sp.grain) fx = { ...(fx || { shift: 0 }), grain: Math.max(fx?.grain || 0, sp.grain) };
          if (lut || sp.vignette || sp.sharpen || sp.optics || key || needsGLPass(fx)) src = colorGL.render(src, lut, { ...sp, chroma: key, fx, time: t - c.start });
        }
        if (fx?.glow) src = this.applyGlow(src, fx.glow);
        // Máscara: só a parte desenhada da forma aparece.
        if (hasMask(c)) src = this.applyMask(src, c.mask);
        // Posição/escala/rotação/opacidade do instante (keyframes + animação).
        const st = visualStateAt(c, t - c.start, clipEnd(c) - c.start, p);
        drawClip(g, src, m, { ...c, transform: st }, W, H, st.blur * (W / p.settings.width), CANVAS_BLEND[c.blend]);
      }
    }
  }
}

// Retângulo de qualquer clipe visual (vídeo, imagem ou texto).
export function visualBox(clip, m, W, H, settings) {
  if (clip.kind === 'text') return textBounds(clip, W, H, settings);
  return m?.width ? clipBox(m, clip, W, H) : null;
}

// Retângulo do clipe no quadro (W×H): ajustado ao quadro, depois escala/posição/rotação.
export function clipBox(m, clip, W, H) {
  const tr = clip?.transform;
  const { width, height } = croppedSize(m, clip);
  const scale = tr?.scale ?? 1;
  const fit = Math.min(W / width, H / height) * scale;
  return {
    w: width * fit,
    h: height * fit,
    cx: W / 2 + (tr?.x || 0) * W,
    cy: H / 2 + (tr?.y || 0) * H,
    rotation: tr?.rotation || 0,
  };
}

function drawClip(g, src, m, clip, W, H, blur = 0, blend) {
  const box = clipBox(m, clip, W, H);
  const crop = cropOf(clip);
  const sw = src.videoWidth || src.naturalWidth || src.displayWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.displayHeight || src.height;
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, clip.transform?.opacity ?? 1));
  if (blur > 0.05) g.filter = `blur(${blur}px)`;
  if (blend) g.globalCompositeOperation = blend;
  g.translate(box.cx, box.cy);
  g.rotate((box.rotation * Math.PI) / 180);
  // Espelhar: vira o clipe já recortado (como hflip/vflip depois do crop na exportação).
  if (clip.flipH || clip.flipV) g.scale(clip.flipH ? -1 : 1, clip.flipV ? -1 : 1);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, -box.w / 2, -box.h / 2, box.w, box.h);
  g.restore();
}

export let engine = new Engine();

// O celular troca o motor por um próprio (src/liteEngine.js), antes de a tela abrir.
export function setEngine(e) {
  engine = e;
}
