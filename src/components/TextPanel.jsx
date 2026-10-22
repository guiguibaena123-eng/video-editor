import { useEffect, useRef, useState } from 'react';
import CaptionsPanel from './CaptionsPanel.jsx';
import { TEXT_STYLES, TEXT_TEMPLATES } from '../textPresets';
import { drawTextClip, withStyle, loadFont } from '../text';
import { addTextPreset } from '../ops';
import { Icon } from '../icons';
import { schedule, useVisible } from '../lazyDraw';

const THUMB_SETTINGS = { width: 1920, height: 1080 };

const MODE_KEY = 've.textMode';

export default function TextPanel() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(MODE_KEY) || 'texts';
    } catch {
      return 'texts';
    }
  });
  const choose = (m) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  return (
    <div className="panel-scroll text-panel">
      <div className="seg-toggle" role="tablist" aria-label="Tipo de texto">
        {[
          ['texts', 'Textos'],
          ['captions', 'Legendas'],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'on' : ''} onClick={() => choose(id)}>
            {label}
          </button>
        ))}
      </div>
      {mode === 'captions' ? <CaptionsPanel /> : <TextsList />}
    </div>
  );
}

function TextsList() {
  return (
    <>
      <button className="add-text" onClick={() => addTextPreset(TEXT_STYLES[0])}>
        <span className="add-text-icon">T</span>
        <span>
          <strong>Adicionar texto</strong>
          <span className="muted">Entra no ponto do cursor da linha do tempo.</span>
        </span>
        <Icon name="plus" size={18} strokeWidth={2.2} />
      </button>

      <h3 className="panel-subtitle">Estilos</h3>
      <div className="preset-grid">
        {TEXT_STYLES.map((p) => (
          <PresetCard key={p.id} preset={p} />
        ))}
      </div>

      <h3 className="panel-subtitle">Modelos animados</h3>
      <div className="preset-grid">
        {TEXT_TEMPLATES.map((p) => (
          <PresetCard key={p.id} preset={p} animated />
        ))}
      </div>
    </>
  );
}

// Miniatura desenhada com o mesmo código da prévia, então mostra o estilo de verdade.
function PresetCard({ preset, animated }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  const visible = useVisible(wrap);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    let cancel = () => {};
    const draw = () => {
      const c = ref.current;
      if (!alive || !c) return;
      const W = 480; // resolução fixa: fica nítido em qualquer largura do painel
      const H = Math.round(W * 0.5625);
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      g.clearRect(0, 0, W, H);
      for (const spec of preset.clips) {
        const isTemplate = preset.clips.length > 1 || spec.style.content;
        // Estilos simples aparecem maiores na miniatura para dar para ver os detalhes.
        const style = withStyle({ ...spec.style, content: spec.style.content || 'Texto' });
        const boost = isTemplate ? 1 : 2.2;
        const clip = { text: { ...style, size: style.size * boost }, transform: { ...spec.transform }, in: 0, out: 1, speed: 1 };
        drawTextClip(g, clip, 0, W, H, THUMB_SETTINGS, { static: true });
      }
    };
    // Desenha quando as fontes do estilo estiverem prontas (em fatias, sem travar a rolagem).
    const later = () => {
      cancel = schedule(draw);
    };
    Promise.all(preset.clips.map((s) => loadFont(s.style))).then(later, later);
    return () => {
      alive = false;
      cancel();
    };
  }, [preset, visible]);

  return (
    <button className="preset-card" onClick={() => addTextPreset(preset)} title={`Adicionar "${preset.label}"`}>
      <span className="preset-canvas" ref={wrap}>
        <canvas ref={ref} />
        {animated && <span className="preset-badge">✦ animado</span>}
      </span>
      <span className="preset-label">{preset.label}</span>
    </button>
  );
}
