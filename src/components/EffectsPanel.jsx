import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { EFFECTS, EFFECT_CATS, newEffect, effectMods, imageFxAt, needsGLPass } from '../effects';
import { colorGL } from '../gl';
import { engine } from '../engine';
import { toggleEffect, addEffectClip, setEffectClipType } from '../ops';
import { schedule, useVisible } from '../lazyDraw';

const KEY = 've.fxCat';
const DEST_KEY = 've.fxDest';
const TW = 160;
const TH = 90;
const SAMPLE_DUR = 2.5; // duração do "clipe" da miniatura

// Cena de exemplo desenhada uma vez: skyline de Nova York ao entardecer (Empire State, One WTC, prédios com janelas acesas,
// ponte estilo Brooklyn, rio com reflexos e táxis amarelos). Tem luzes fortes, sombras e detalhes finos para qualquer efeito aparecer bem.
let scene = null;
function sampleScene() {
  if (scene) return scene;
  scene = document.createElement('canvas');
  scene.width = TW * 2;
  scene.height = TH * 2;
  const g = scene.getContext('2d');
  const W = scene.width;
  const H = scene.height;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const hor = H * 0.7; // linha d'água

  // céu do entardecer
  const sky = g.createLinearGradient(0, 0, 0, hor);
  sky.addColorStop(0, '#0f1a4d');
  sky.addColorStop(0.4, '#5b3d94');
  sky.addColorStop(0.7, '#e8667a');
  sky.addColorStop(0.9, '#ffa860');
  sky.addColorStop(1, '#ffd89a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, hor);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.6})`;
    g.fillRect(rnd() * W, rnd() * hor * 0.3, 1.3, 1.3);
  }
  // nuvens
  for (let i = 0; i < 6; i++) {
    const cy = hor * (0.2 + rnd() * 0.45);
    g.fillStyle = `rgba(255,${140 + rnd() * 60},${140 + rnd() * 40},0.35)`;
    g.beginPath();
    g.ellipse(rnd() * W, cy, W * (0.12 + rnd() * 0.2), 4 + rnd() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }

  // prédio: corpo + janelas acesas (as luzes dão a vida da cidade)
  const building = (x, w, h, color, lit, base = hor) => {
    g.fillStyle = color;
    g.fillRect(x, base - h, w, h);
    if (lit <= 0) return;
    for (let wy = base - h + 5; wy < base - 4; wy += 5) {
      for (let wx = x + 3; wx < x + w - 3; wx += 4) {
        if (rnd() < lit) {
          g.fillStyle = rnd() < 0.8 ? 'rgba(255,214,120,0.9)' : 'rgba(190,225,255,0.85)';
          g.fillRect(wx, wy, 1.8, 2.4);
        }
      }
    }
  };
  // fundo: prédios distantes e azulados
  for (let x = -10; x < W; ) {
    const w = 14 + rnd() * 20;
    building(x, w, H * (0.18 + rnd() * 0.22), '#41357a', 0.12);
    x += w + rnd() * 3;
  }
  // meio: prédios médios
  for (let x = -6; x < W; ) {
    const w = 16 + rnd() * 24;
    building(x, w, H * (0.12 + rnd() * 0.3), '#241c4d', 0.3);
    x += w + 1 + rnd() * 4;
  }
  // Empire State (escalonado, com antena e topo iluminado)
  const ex = W * 0.42;
  const tiers = [[34, 0.34], [26, 0.46], [18, 0.56], [11, 0.63]];
  tiers.forEach(([w, hh], i) => building(ex + (34 - w) / 2, w, H * hh, i % 2 ? '#1a1340' : '#20184a', 0.34));
  g.fillStyle = '#ffd7a0';
  g.fillRect(ex + 14, hor - H * 0.7, 6, H * 0.07);
  g.fillStyle = '#1a1340';
  g.fillRect(ex + 16.2, hor - H * 0.84, 1.6, H * 0.14);
  g.fillStyle = '#ff5050';
  g.beginPath();
  g.arc(ex + 17, hor - H * 0.84, 1.6, 0, Math.PI * 2);
  g.fill();
  // One World Trade Center (afunilado)
  const wx = W * 0.7;
  g.fillStyle = '#1e1a4c';
  g.beginPath();
  g.moveTo(wx, hor);
  g.lineTo(wx + 26, hor);
  g.lineTo(wx + 15, hor - H * 0.62);
  g.lineTo(wx + 11, hor - H * 0.62);
  g.fill();
  g.fillStyle = 'rgba(255,214,150,0.5)';
  g.fillRect(wx + 12.2, hor - H * 0.62, 1.2, -H * 0.1);
  for (let wy = hor - 6; wy > hor - H * 0.58; wy -= 6) {
    g.fillStyle = 'rgba(255,225,160,0.55)';
    g.fillRect(wx + 5, wy, 16, 1.2);
  }
  // prédios altos da frente
  for (const [fx, fw, fh] of [[0.05, 30, 0.4], [0.16, 24, 0.5], [0.29, 28, 0.36], [0.56, 30, 0.45], [0.8, 34, 0.42], [0.9, 28, 0.52]]) {
    building(W * fx, fw, H * fh, '#150f35', 0.4);
  }
  // luz do sol batendo na água
  const water = g.createLinearGradient(0, hor, 0, H);
  water.addColorStop(0, '#f08a78');
  water.addColorStop(0.2, '#7a4a90');
  water.addColorStop(1, '#10143a');
  g.fillStyle = water;
  g.fillRect(0, hor, W, H - hor);
  // reflexo da cidade
  g.save();
  g.beginPath();
  g.rect(0, hor, W, H - hor);
  g.clip();
  g.globalAlpha = 0.45;
  g.translate(0, hor * 2);
  g.scale(1, -1);
  g.drawImage(scene, 0, hor * 0.45, W, hor * 0.55, 0, hor * 0.45, W, hor * 0.55);
  g.restore();
  for (let i = 0; i < 160; i++) {
    const k = rnd();
    g.fillStyle = rnd() < 0.6 ? `rgba(255,205,120,${0.1 + rnd() * 0.3})` : `rgba(255,255,255,${0.05 + rnd() * 0.1})`;
    g.fillRect(rnd() * W, hor + k * (H - hor), 4 + rnd() * 18, 1);
  }
  // ponte suspensa estilo Brooklyn: torres de arco gótico e cabos
  const by = hor + 2;
  const tw = [W * 0.14, W * 0.86];
  g.fillStyle = '#0c0a24';
  tw.forEach((tx) => {
    g.fillRect(tx - 10, by - H * 0.36, 5, H * 0.36);
    g.fillRect(tx + 5, by - H * 0.36, 5, H * 0.36);
    g.fillRect(tx - 10, by - H * 0.36, 20, 4);
    g.beginPath();
    g.moveTo(tx - 5, by - H * 0.2);
    g.quadraticCurveTo(tx, by - H * 0.31, tx + 5, by - H * 0.2);
    g.lineTo(tx + 5, by - H * 0.36 + 4);
    g.lineTo(tx - 5, by - H * 0.36 + 4);
    g.fill();
  });
  g.strokeStyle = '#0c0a24';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(-5, by - H * 0.08);
  g.quadraticCurveTo(tw[0] * 0.5, by - H * 0.1, tw[0], by - H * 0.35);
  g.stroke();
  g.beginPath();
  g.moveTo(tw[0], by - H * 0.35);
  g.quadraticCurveTo((tw[0] + tw[1]) / 2, by + H * 0.04, tw[1], by - H * 0.35);
  g.stroke();
  g.beginPath();
  g.moveTo(tw[1], by - H * 0.35);
  g.quadraticCurveTo(W - tw[0] * 0.5, by - H * 0.1, W + 5, by - H * 0.08);
  g.stroke();
  g.lineWidth = 0.7;
  g.strokeStyle = 'rgba(12,10,36,0.9)';
  for (let x = tw[0] + 8; x < tw[1] - 8; x += 9) {
    const u = (x - tw[0]) / (tw[1] - tw[0]);
    const cy = by - H * 0.35 + 4 * u * (1 - u) * (H * 0.39);
    g.beginPath();
    g.moveTo(x, cy);
    g.lineTo(x, by - H * 0.02);
    g.stroke();
  }
  g.fillStyle = '#0c0a24';
  g.fillRect(0, by - H * 0.02, W, H * 0.025);
  // táxis amarelos no tabuleiro da ponte
  for (const [x, dir] of [[0.3, 1], [0.38, -1], [0.62, 1], [0.7, -1]]) {
    const tx = W * x;
    const ty = by - H * 0.045;
    g.fillStyle = '#ffc61a';
    g.fillRect(tx, ty, 13, 4);
    g.fillRect(tx + 3, ty - 3, 7, 3);
    g.fillStyle = dir > 0 ? '#ffffff' : '#ff3030';
    g.fillRect(tx + (dir > 0 ? 12 : 0), ty + 1, 1.5, 1.5);
    g.fillStyle = 'rgba(255,230,150,0.35)';
    g.fillRect(tx - 2, ty + 4.5, 17, 1);
  }
  // grão de filme e vinheta
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},${rnd() > 0.5 ? 255 : 0},0.035)`;
    g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5);
  }
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.7);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  return scene;
}

// Instante mostrado parado: aberturas no meio da entrada, fechamentos perto do fim.
const restTime = (cat) => (cat === 'open' ? 0.45 : cat === 'close' ? SAMPLE_DUR - 0.45 : 0.6);

// Desenha a miniatura com as mesmas funções do player.
function drawThumb(canvas, type, t) {
  const g = canvas.getContext('2d');
  const clip = { effects: [{ ...newEffect(type), amount: 0.7 }] };
  let src = sampleScene();
  const fx = imageFxAt(clip, t, SAMPLE_DUR);
  if (needsGLPass(fx)) src = colorGL.render(src, null, { fx, time: t });
  if (fx.glow) src = engine.applyGlow(src, fx.glow);
  const m = effectMods(clip, t, SAMPLE_DUR);
  g.fillStyle = '#000';
  g.fillRect(0, 0, TW, TH);
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, m.opacity));
  if (m.blur > 0.05) g.filter = `blur(${(m.blur * TW) / 1920}px)`;
  g.translate(TW / 2 + m.dx * TW, TH / 2 + m.dy * TH);
  g.rotate((m.rotation * Math.PI) / 180);
  g.scale(m.scale, m.scale);
  g.drawImage(src, -TW / 2, -TH / 2, TW, TH);
  g.restore();
}

function EffectThumb({ type, cat }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  const visible = useVisible(wrap);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c || !visible) return;
    c.width = TW;
    c.height = TH;
    if (!hover) return schedule(() => drawThumb(c, type, restTime(cat)));
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      drawThumb(c, type, ((performance.now() - t0) / 1000) % SAMPLE_DUR);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [type, cat, hover, visible]);
  return (
    <span ref={wrap} className="tr-thumb fx-real" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <canvas ref={ref} />
    </span>
  );
}

// Biblioteca de efeitos: selecione um vídeo ou imagem e clique num efeito para ligar/desligar.
export default function EffectsPanel() {
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : null));
  const usable = clip && !clip.kind;
  const fxClip = clip?.kind === 'effect' ? clip : null;
  // Destino: no clipe selecionado ou na trilha de efeito (vale para tudo que está abaixo).
  const [dest, setDest] = useState(() => {
    try {
      return localStorage.getItem(DEST_KEY) || 'clip';
    } catch {
      return 'clip';
    }
  });
  const chooseDest = (d) => {
    setDest(d);
    try {
      localStorage.setItem(DEST_KEY, d);
    } catch {}
  };
  const onTrack = dest === 'track' || !!fxClip;
  const on = new Set(fxClip ? [fxClip.fx?.type] : (!onTrack && usable && clip.effects?.map((e) => e.type)) || []);
  const [cat, setCat] = useState(() => {
    try {
      return localStorage.getItem(KEY) || 'all';
    } catch {
      return 'all';
    }
  });
  const choose = (c) => {
    setCat(c);
    try {
      localStorage.setItem(KEY, c);
    } catch {}
  };

  const apply = (type) => {
    if (fxClip) {
      setEffectClipType(fxClip.id, type);
      return;
    }
    if (onTrack) {
      addEffectClip(type);
      return;
    }
    if (!usable) {
      useStore.getState().notify('Selecione na linha do tempo um vídeo ou uma imagem para receber o efeito.');
      return;
    }
    toggleEffect(clip.id, type);
  };

  const groups = EFFECT_CATS.filter(([id]) => cat === 'all' || cat === id);

  return (
    <div className="panel-scroll text-panel">
      <p className="hint tr-help">
        {onTrack ? (
          <>
            <b>Trilha de efeito:</b> o efeito entra no cursor numa trilha própria e vale para tudo que está abaixo dele. Estique o clipe de efeito para cobrir o trecho que quiser.
            {fxClip && ' Com um clipe de efeito selecionado, clicar troca o efeito dele.'}
          </>
        ) : (
          <>
            <b>Como usar:</b> selecione um vídeo ou uma imagem e clique num efeito (clique de novo para tirar). Ajustes na aba <b>Efeitos</b> do clipe.
          </>
        )}{' '}
        Passe o mouse na miniatura para ver o efeito em movimento.
      </p>
      <div className="mask-grid fx-dest" role="radiogroup" aria-label="Onde aplicar o efeito">
        {[
          ['clip', 'No clipe'],
          ['track', 'Na trilha de efeito'],
        ].map(([id, label]) => (
          <button key={id} role="radio" aria-checked={dest === id} className={'mask-chip' + (dest === id ? ' on' : '')} onClick={() => chooseDest(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="filter-cats" role="tablist" aria-label="Categorias de efeito">
        {[['all', 'Todos'], ...EFFECT_CATS].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={cat === id} className={'mask-chip' + (cat === id ? ' on' : '')} onClick={() => choose(id)}>
            {label}
          </button>
        ))}
      </div>
      {groups.map(([gid, title]) => (
        <section key={gid}>
          <h3 className="panel-subtitle">{title}</h3>
          <div className="tr-grid">
            {EFFECTS.filter(([, , k]) => k === gid).map(([id, label]) => (
              <button key={id} className={'tr-card' + (on.has(id) ? ' on' : '')} onClick={() => apply(id)} aria-pressed={on.has(id)} title={on.has(id) ? `Tirar "${label}"` : `Aplicar "${label}"`}>
                <EffectThumb type={id} cat={gid} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
