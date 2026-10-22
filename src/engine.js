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

// iPhone/iPad: o navegador ignora o volume do elemento de mídia, então o som precisa passar pelo WebAudio.
const IOS_LIKE = typeof navigator !== 'undefined' && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// Motor de reprodução: mantém um <video> por clipe próximo do cursor, sincroniza
// com o relógio da linha do tempo e desenha as trilhas de vídeo num canvas.
class Engine {
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
  lastFrameAt = 0;
  snapTick = 0;
  lastTickMs = 0;
  heldMs = 0;
  stalledPrev = false;
  frameFlag = false; // chegou um quadro novo do vídeo (requestVideoFrameCallback)
  lastDrawAt = 0;
  drewNow = false;
  rvfc = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  drawUntil = 0; // o player só redesenha parado enquanto algo mudou (poupa CPU/GPU/bateria)
  slowFrames = 0;
  lastLoop = 0;
  emaInterval = 0;

  // Pede para desenhar nos próximos instantes (mudou o projeto, o tempo, o tamanho...).
  invalidate(ms = 450) {
    this.drawUntil = Math.max(this.drawUntil, performance.now() + ms);
  }

  attach(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.unsub = useStore.subscribe(() => this.invalidate());
    this.onFonts = () => this.invalidate(300);
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    onLutReady(() => this.invalidate(300));
    this.invalidate(1000);
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  detach() {
    this.unsub?.();
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
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
    if (!this.audioCtx) return;
    if (this.lite && !(vol > 1.001 || IOS_LIKE)) return;
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
    } else el.volume = Math.min(1, vol);
  }

  // Mantém um elemento de mídia no ponto certo (tocando ou parado).
  sync(el, target, speed, keepPitch = true, tol = this.lite ? 0.5 : 0.3, nudge = false) {
    // O navegador só toca entre 1/16x e 16x; fora disso a posição é corrigida por saltos.
    let rate = Math.min(16, Math.max(0.0625, speed));
    // Pequeno atraso/adiantamento (som que começou um pouco depois): corrige acelerando ou freando o som em
    // até 8%, sem busca — a busca faz o som falhar e voltar "bugado". Só para quem segue a linha do tempo.
    if (nudge && this.playing && !el.paused && !el.seeking) {
      const drift = el.currentTime - target;
      if (Math.abs(drift) > 0.02 && Math.abs(drift) <= tol) rate *= 1 - Math.max(-0.12, Math.min(0.12, drift * 0.8));
    }
    if (Math.abs(el.playbackRate - rate) > 5e-4) el.playbackRate = rate;
    if (el.preservesPitch !== keepPitch) el.preservesPitch = keepPitch;
    if (this.playing) {
      if (el.paused) {
        if (Math.abs(el.currentTime - target) > 0.05) el.currentTime = target;
        el.play().catch(() => {});
      } else if (!(this.lite && el.seeking) && Math.abs(el.currentTime - target) > tol) {
        el.currentTime = target;
      }
    } else {
      if (!el.paused) el.pause();
      if (!el.seeking && Math.abs(el.currentTime - target) > 0.015) el.currentTime = target;
    }
  }

  // Recorta o quadro com a máscara (mesmo desenho usado na exportação).
  applyMask(src, mask) {
    const w = src.videoWidth || src.naturalWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.height;
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
    const w = src.videoWidth || src.naturalWidth || src.width;
    const h = src.videoHeight || src.naturalHeight || src.height;
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
    this.ensureAudio();
    const start = s.currentTime >= total - 0.01 ? 0 : s.currentTime;
    this.clock = { t0: start, wall0: performance.now() };
    this.lastTickMs = performance.now();
    this.startHold = true; // até o vídeo mestre rodar, os outros sons NÃO esperam: começam juntos e a linha do tempo os alcança
    this.heldMs = 0;
    this.stalledPrev = this.lite; // no celular o relógio só anda quando o vídeo já está rodando
    this.lastTime = start;
    this.playing = true;
    useStore.setState({ playing: true, currentTime: start });
  }

  // Toca de "from" até "to" e para (usado na prévia de animações).
  playRange(from, to) {
    useStore.setState({ currentTime: from });
    this.stopAt = to;
    this.play();
  }

  pause() {
    this.stopAt = null;
    this.playing = false;
    for (const e of this.entries.values()) {
      e.el.pause();
      e.ael?.pause();
    }
    useStore.setState({ playing: false });
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
    if (entry && entry.srcPath !== want) {
      // Proxy ficou pronto (ou a qualidade mudou): troca a fonte; o último quadro guardado cobre a troca.
      this.keepFrame(entry);
      entry.srcPath = want;
      entry.el.src = mediaUrl(want);
      entry.primed = false;
    }
    if (!entry) {
      const el = document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.playsInline = true;
      el.src = mediaUrl(want);
      el.addEventListener('seeked', () => this.requestDraw());
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
          if (!el.paused && !el.seeking) entry.live = true; // quadro novo apresentado: o vídeo está rodando

          if (this.entries.get(clip.id)?.el === el) el.requestVideoFrameCallback(cb);
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
    this.setProxy(e, null);
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    this.entries.delete(clipId);
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
      if (Math.abs(t - this.lastTime) > 1e-6) this.clock = { t0: t, wall0: performance.now() };
      // Se no quadro anterior o vídeo mestre ainda não estava rodando, o relógio não anda neste (espera por ele).
      const nowT = performance.now();
      if (this.lite && this.stalledPrev && this.heldMs < 2500 && this.lastTickMs) this.clock.wall0 += nowT - this.lastTickMs;
      t = Math.max(0, this.clock.t0 + (nowT - this.clock.wall0) / 1000);
      if (t >= total || (this.stopAt != null && t >= this.stopAt)) {
        t = Math.min(t, total, this.stopAt ?? total);
        this.pause();
      }
      useStore.setState({ currentTime: t });
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

    for (const c of p.clips) {
      const m = mediaById.get(c.mediaId);
      const tr = trackById.get(c.trackId);
      if (!m || !tr || m.missing || m.type === 'image') continue;
      const end = clipEnd(c);
      if (t < c.start - (this.lite ? 1.2 : 3) || t > end + 1) continue;
      near.add(c.id);
      const entry = this.getEntry(c, m);
      const el = entry.el;
      const speed = speedAt(c, t - c.start);
      const keepPitch = c.keepPitch !== false;
      const active = t >= c.start && t < end;
      const silent = tr.muted || tr.hidden || c.audioDetached || this.muteAll || !m.hasAudio;
      const vol = silent ? 0 : valueAt(c, 'volume', t - c.start) * fadeGain(effectiveAudio(p, c), t - c.start, end - c.start) * duckGainAt(p, s.cache, mediaById, c, t - c.start);

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

      if (!active) {
        if (!el.paused) el.pause();
        if (entry.ael && !entry.ael.paused) entry.ael.pause();
        // Deixa o primeiro quadro pronto para não travar na entrada do clipe.
        if (t < c.start && !entry.primed && el.readyState >= 1) {
          el.currentTime = c.in;
          entry.primed = true;
        }
        continue;
      }
      entry.primed = false;
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
        const tol = !this.lite ? 0.3 : isMaster ? 0.6 : loud ? 0.25 : 0.6;
        const nudge = this.lite && !isMaster;
        this.sync(el, target, speed, keepPitch, tol, nudge);
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
        if (((el.seeking || el.readyState < 2) && !el.error) || (!entry.live && !el.error)) {
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
      const fresh = this.rvfc && hasMaster ? this.frameFlag || since > 120 : true;
      if (!fresh || since < minGap) return;
      this.frameFlag = false;
      this.lastDrawAt = nowMs;
    }
    this.drewNow = true;
    this.draw(t, p, mediaById);
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
          const entry = this.entries.get(c.id);
          if (!entry) continue;
          // Durante uma busca (arrastar a barra, mudar velocidade) o vídeo fica sem quadro
          // por um instante; desenha o último quadro guardado para o player não piscar preto.
          if (entry.el.readyState >= 2) {
            src = entry.el;
            if (!this.lite || !this.playing || ++this.snapTick % 8 === 0) this.keepFrame(entry);
          } else if (entry.snap) src = entry.snap;
          else continue;
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
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
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

export const engine = new Engine();
