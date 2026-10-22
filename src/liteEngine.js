import { Engine } from './engine';
import { useStore, clipEnd, projectDuration, mediaUrl } from './store';
import { sourceAt, speedAt } from './speed';
import { valueAt, isAnimated } from './keyframes';
import { fadeGain } from './audio';
import { duckGainAt } from './audioPro';
import { effectiveAudio } from './transitions';
import { webBlob } from './web/registry';
import { framesSupported, openSource, FramePlayer } from './web/frames';

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
      this.openVisual(e, m);
    }
    if (e) return e;
    e = { mediaId: m.id, srcPath: want, el: null, fp: null, vel: null, snap: null, gain: null, live: false, snapped: false, dead: false, kind: m.type, lastCT: null, gen: 0 };
    this.entries.set(c.id, e);
    if (m.type === 'video') this.openVisual(e, m);
    // Quem continua o clipe anterior (corte) herda o elemento de som dele quando chega a hora (adoptAudio).
    if ((m.hasAudio || m.type === 'audio') && !this.continuesFrom(p, c)) this.makeAudio(e, m);
    return e;
  }

  pool = [];
  unlocked = false;

  // Primeiro toque (play): deixa alguns elementos de som prontos para tocar a qualquer hora.
  unlockAudio() {
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

  makeAudio(e, m) {
    const el = this.takeAudio();
    e.gain = el.__gain || null;
    el.preload = 'auto';
    el.src = mediaUrl(e.srcPath);
    el.load?.();
    const setLive = (v) => () => void ((e.live = v), v || (e.snapped = false));
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
      if (Math.abs(t - this.lastWritten) > 1e-6) this.clock = { t0: t, wall0: now };
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
          continue;
        }
        // Próximo clipe: deixa os primeiros quadros prontos e o som posicionado (e quente, se já vai começar).
        if (lead < this.nextLead && !this.scrubbing) {
          if (e.fp) e.fp.step(sourceAt(c, 0) * 1e6, 'idle');
          if (e.el) {
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
      if (!e.el && (m.hasAudio || m.type === 'audio') && !this.adoptAudio(e, c, p)) this.makeAudio(e, m);
      const el = e.el;
      if (!el) continue;
      const silent = tr.muted || tr.hidden || c.audioDetached || this.muteAll || !m.hasAudio;
      const vol = silent ? 0 : valueAt(c, 'volume', local) * fadeGain(effectiveAudio(p, c), local, end - c.start) * duckGainAt(p, s.cache, mediaById, c, local);
      this.connect(e, vol);
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
    for (const { c, e, active } of list) {
      if (!active) continue;
      sig += e.fp ? e.fp.curTs + ',' : e.vel ? Math.round(e.vel.currentTime * 1000) + ',' : '-,';
      if (this.playing && isAnimated(c, p)) animated = true;
    }
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
    this.draw(t, p, mediaById);
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
        this.audioLead = Math.min(0.4, Math.max(0, this.audioLead + behind * 0.7));
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
    if (Math.abs(drift) > tol) {
      el.currentTime = target + (el.playbackRate > 0 ? 0.03 : 0);
      el.__heat = null;
      return;
    }
    // Quente (taxa 0) até agora: passa a andar, um pouco mais rápido por um instante (o som leva ~50 ms para pegar o ritmo).
    if (el.playbackRate === 0) e.boostUntil = now + 350;
    let rate = base;
    if (now < (e.boostUntil || 0)) rate *= 1.15;
    if (el.playbackRate > 0 && Math.abs(drift) > 0.012) rate *= 1 - Math.max(-0.25, Math.min(0.25, drift * 2.8));
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
