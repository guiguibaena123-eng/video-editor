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

// Cena de exemplo (céu, sol, morro, casa) desenhada uma vez.
let scene = null;
function sampleScene() {
  if (scene) return scene;
  scene = document.createElement('canvas');
  scene.width = TW * 2;
  scene.height = TH * 2;
  const g = scene.getContext('2d');
  const W = scene.width;
  const H = scene.height;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#3d8cff');
  sky.addColorStop(1, '#bfe0ff');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffc72c';
  g.beginPath();
  g.arc(W * 0.72, H * 0.3, H * 0.16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1f8a4c';
  g.beginPath();
  g.ellipse(W * 0.35, H * 1.05, W * 0.6, H * 0.42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e2508d';
  g.fillRect(W * 0.18, H * 0.48, W * 0.16, H * 0.2);
  g.fillStyle = '#7a2448';
  g.beginPath();
  g.moveTo(W * 0.15, H * 0.5);
  g.lineTo(W * 0.26, H * 0.36);
  g.lineTo(W * 0.37, H * 0.5);
  g.fill();
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
          ['clip', 'No clipe selecionado'],
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
