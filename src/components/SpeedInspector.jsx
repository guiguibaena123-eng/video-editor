import { useRef, useState } from 'react';
import { useStore, clipDur } from '../store';
import { Icon } from '../icons';
import { Section, Switch, NumberInput } from './Fields.jsx';
import { setClipSpeed, reverseClip, freezeFrame } from '../ops';
import { CURVE_PRESETS, CUSTOM_CURVE, CURVE_MIN, CURVE_MAX, SPEED_MIN, SPEED_MAX, curveValue, fmtSpeed } from '../speed';
import { fmtDuration, clamp, dragPointer } from '../util';

// Slider em escala logarítmica: o meio é 1x, a esquerda 0,1x e a direita 100x.
const toPos = (v) => Math.log(v / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN);
const fromPos = (p) => SPEED_MIN * Math.pow(SPEED_MAX / SPEED_MIN, p);
const QUICK = [0.25, 0.5, 1, 1.5, 2, 3, 5, 10];

export default function SpeedInspector({ clip, media }) {
  const [mode, setMode] = useState(clip.curve ? 'curve' : 'normal');
  const original = clip.out - clip.in;
  const dur = clipDur(clip);
  const speed = clip.speed || 1;
  const dragging = useRef(false);
  const isVideo = media.type === 'video';

  const onSlider = (e) => {
    const v = Math.round(fromPos(Number(e.target.value) / 1000) * 100) / 100;
    setClipSpeed(clip.id, { speed: v, curve: null }, dragging.current ? 'live' : 'set');
  };
  const startDrag = () => {
    dragging.current = true;
    setClipSpeed(clip.id, {}, 'start');
    const up = () => {
      window.removeEventListener('pointerup', up);
      dragging.current = false;
      setClipSpeed(clip.id, {}, 'end');
    };
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      <div className="speed-mode seg">
        <button className={mode === 'normal' ? 'on' : ''} onClick={() => setMode('normal')} aria-pressed={mode === 'normal'}>
          Normal
        </button>
        <button className={mode === 'curve' ? 'on' : ''} onClick={() => setMode('curve')} aria-pressed={mode === 'curve'}>
          Curva
        </button>
      </div>

      {mode === 'normal' ? (
        <Section title="Velocidade">
          {clip.curve && <p className="hint warn">Este clipe usa uma curva. Mexer aqui troca a curva por uma velocidade fixa.</p>}
          <div className="field-top">
            <label>Velocidade</label>
            <NumberInput value={clip.curve ? 1 : speed} decimals={2} unit="x" min={SPEED_MIN} max={SPEED_MAX} onCommit={(v) => setClipSpeed(clip.id, { speed: v, curve: null })} />
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={Math.round(toPos(clip.curve ? 1 : speed) * 1000)}
            onPointerDown={startDrag}
            onChange={onSlider}
            aria-label="Velocidade"
            style={{ '--fill': `${toPos(clip.curve ? 1 : speed) * 100}%` }}
          />
          <div className="speed-scale">
            <span>0,1x</span>
            <span>1x</span>
            <span>100x</span>
          </div>
          <div className="quick-speeds">
            {QUICK.map((v) => (
              <button key={v} className={'chip' + (!clip.curve && Math.abs(speed - v) < 1e-3 ? ' on' : '')} onClick={() => setClipSpeed(clip.id, { speed: v, curve: null })}>
                {fmtSpeed(v)}
              </button>
            ))}
          </div>
          <p className="hint">
            Duração: {fmtDuration(original)} → <b>{fmtDuration(dur)}</b>
          </p>
        </Section>
      ) : (
        <CurveSection clip={clip} />
      )}

      {media.hasAudio && (
        <Section title="Som" action={<Switch label="Manter o tom da voz" checked={clip.keepPitch !== false} onChange={(v) => setClipSpeed(clip.id, { keepPitch: v })} />}>
          <p className="hint">{clip.keepPitch !== false ? 'Manter o tom: a voz fica com o mesmo timbre, só mais rápida ou lenta.' : 'Sem manter o tom: acelerado fica agudo e lento fica grave, como fita.'}</p>
        </Section>
      )}

      {isVideo && (
        <Section title="Mais">
          <div className="button-row">
            <button className="secondary small" onClick={() => reverseClip(clip.id)}>
              <Icon name="reverse" size={15} /> {clip.reversedFrom ? 'Desfazer reverso' : 'Reverso'}
            </button>
            <button className="secondary small" onClick={() => freezeFrame()}>
              <Icon name="freeze" size={15} /> Congelar quadro
            </button>
          </div>
          <p className="hint">Reverso faz o clipe tocar de trás para frente. Congelar quadro para a imagem por 3 s no ponto da barra branca.</p>
        </Section>
      )}
    </>
  );
}

function CurveSection({ clip }) {
  const presetId = CURVE_PRESETS.find(([, , pts]) => JSON.stringify(pts) === JSON.stringify(clip.curve))?.[0] || (clip.curve ? 'custom' : 'none');
  const choose = (pts) => setClipSpeed(clip.id, { curve: pts ? structuredClone(pts) : null, speed: 1 });
  return (
    <>
      <Section title="Curvas prontas">
        <div className="curve-grid">
          <button className={'curve-chip' + (presetId === 'none' ? ' on' : '')} onClick={() => choose(null)}>
            <CurveThumb points={[[0, 1], [1, 1]]} />
            <span>Nenhuma</span>
          </button>
          {CURVE_PRESETS.map(([id, label, pts]) => (
            <button key={id} className={'curve-chip' + (presetId === id ? ' on' : '')} onClick={() => choose(pts)}>
              <CurveThumb points={pts} />
              <span>{label}</span>
            </button>
          ))}
          <button className={'curve-chip' + (presetId === 'custom' ? ' on' : '')} onClick={() => choose(clip.curve || CUSTOM_CURVE)}>
            <CurveThumb points={clip.curve && presetId === 'custom' ? clip.curve : CUSTOM_CURVE} />
            <span>Personalizada</span>
          </button>
        </div>
      </Section>
      {clip.curve && (
        <Section
          title="Editar curva"
          action={
            <button className="link-btn" onClick={() => choose(null)}>
              <Icon name="reset" size={14} /> Remover curva
            </button>
          }
        >
          <CurveEditor clip={clip} />
          <p className="hint">Arraste os pontos para cima (mais rápido) ou para baixo (mais lento). Clique duas vezes no gráfico para criar um ponto, e duas vezes num ponto para apagá-lo.</p>
          <p className="hint">Duração: {fmtDuration(clip.out - clip.in)} → <b>{fmtDuration(clipDur(clip))}</b></p>
        </Section>
      )}
    </>
  );
}

const yOf = (v, h) => h - (Math.log(v / CURVE_MIN) / Math.log(CURVE_MAX / CURVE_MIN)) * h;
const vOf = (y, h) => CURVE_MIN * Math.pow(CURVE_MAX / CURVE_MIN, (h - y) / h);

function curvePath(points, w, h, steps = 80) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    d += `${i ? 'L' : 'M'}${(u * w).toFixed(1)} ${yOf(curveValue(points, u), h).toFixed(1)}`;
  }
  return d;
}

function CurveThumb({ points }) {
  return (
    <svg width="54" height="30" viewBox="0 0 54 30" aria-hidden="true">
      <line x1="0" x2="54" y1={yOf(1, 30)} y2={yOf(1, 30)} className="curve-one" />
      <path d={curvePath(points, 54, 30, 40)} className="curve-line" />
    </svg>
  );
}

function CurveEditor({ clip }) {
  const ref = useRef(null);
  const W = 300;
  const H = 150;
  const t = useStore((s) => s.currentTime);
  const dur = clipDur(clip);
  const local = (t - clip.start) / dur;
  const points = clip.curve;

  const toLocal = (e) => {
    const r = ref.current.getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * W, 0, W), y: clamp(((e.clientY - r.top) / r.height) * H, 0, H) };
  };

  const startDrag = (e, idx) => {
    e.stopPropagation();
    setClipSpeed(clip.id, {}, 'start');
    const last = points.length - 1;
    dragPointer(
      e,
      (ev) => {
        const p = toLocal(ev);
        const next = points.map((pt) => [...pt]);
        // Os pontos das pontas ficam presos no começo e no fim; os do meio não passam dos vizinhos.
        const x = idx === 0 ? 0 : idx === last ? 1 : clamp(p.x / W, next[idx - 1][0] + 0.02, next[idx + 1][0] - 0.02);
        let v = vOf(p.y, H);
        if (Math.abs(Math.log(v)) < 0.06) v = 1; // gruda em 1x
        next[idx] = [Math.round(x * 1000) / 1000, Math.round(clamp(v, CURVE_MIN, CURVE_MAX) * 100) / 100];
        setClipSpeed(clip.id, { curve: next }, 'live');
      },
      () => setClipSpeed(clip.id, {}, 'end'),
    );
  };

  const addPoint = (e) => {
    const p = toLocal(e);
    const x = p.x / W;
    if (x <= 0.02 || x >= 0.98) return;
    const next = [...points.map((pt) => [...pt]), [Math.round(x * 1000) / 1000, Math.round(clamp(vOf(p.y, H), CURVE_MIN, CURVE_MAX) * 100) / 100]].sort((a, b) => a[0] - b[0]);
    setClipSpeed(clip.id, { curve: next });
  };

  const removePoint = (e, idx) => {
    e.stopPropagation();
    if (idx === 0 || idx === points.length - 1 || points.length <= 2) return;
    setClipSpeed(clip.id, { curve: points.filter((_, i) => i !== idx) });
  };

  return (
    <div className="curve-editor">
      <div className="curve-axis">
        {[10, 5, 2, 1, 0.5, 0.1].map((v) => (
          <span key={v} style={{ top: `${(yOf(v, H) / H) * 100}%` }}>
            {fmtSpeed(v)}
          </span>
        ))}
      </div>
      <div className="curve-area">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onDoubleClick={addPoint} role="img" aria-label="Curva de velocidade">
        {[10, 5, 2, 0.5, 0.1].map((v) => (
          <line key={v} x1="0" x2={W} y1={yOf(v, H)} y2={yOf(v, H)} className="curve-grid-line" />
        ))}
        <line x1="0" x2={W} y1={yOf(1, H)} y2={yOf(1, H)} className="curve-one" />
        <path d={`${curvePath(points, W, H)} L${W} ${H} L0 ${H}Z`} className="curve-fill" />
        <path d={curvePath(points, W, H)} className="curve-line" />
        {local >= 0 && local <= 1 && <line x1={local * W} x2={local * W} y1="0" y2={H} className="curve-playhead" />}
      </svg>
      {points.map(([x, v], i) => (
        <span
          key={i}
          className="curve-point"
          style={{ left: `${x * 100}%`, top: `${(yOf(v, H) / H) * 100}%` }}
          onPointerDown={(e) => startDrag(e, i)}
          onDoubleClick={(e) => removePoint(e, i)}
          title={`${fmtSpeed(v)}`}
        />
      ))}
      </div>
    </div>
  );
}
