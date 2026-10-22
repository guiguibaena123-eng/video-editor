import { useEffect, useRef, useState } from 'react';
import { useStore, clipDur, DEFAULT_TRANSFORM } from '../store';
import { Icon } from '../icons';
import { SliderField, Section, Switch } from './Fields.jsx';
import { FONTS, fontInfo } from '../fonts';
import { withStyle, withAnim, ANIMS_IN, ANIMS_OUT, ANIMS_LOOP, animSpans } from '../text';
import { engine } from '../engine';
import { KfButton, KeyframeHere, useLocalTime } from './KeyframeControls.jsx';
import { transformAt, applyProp } from '../keyframes';
import { fmtTimecode, fmtDuration } from '../util';

// Atualiza um campo do clipe; arrastar slider conta como um só passo de desfazer.
function useUpdater(clipId) {
  return (mutate) => (value, phase) => {
    const s = useStore.getState();
    const apply = (p) => {
      const c = p.clips.find((x) => x.id === clipId);
      if (c) mutate(c, value);
    };
    if (phase === 'start') s.gestureStart();
    else if (phase === 'live') s.live(apply);
    else if (phase === 'end') s.gestureEnd();
    else s.commit(apply);
  };
}

const setPath = (obj, path, v) => {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = { ...(o[k] || {}) };
  o[keys[keys.length - 1]] = v;
};

export default function TextInspector({ clip }) {
  const [tab, setTab] = useState('text');
  const fps = useStore((s) => s.project.settings.fps);
  const track = useStore((s) => s.project.tracks.find((t) => t.id === clip.trackId));
  const preview = String(clip.text?.content || '').split('\n')[0];

  return (
    <>
      <div className="clip-head">
        <div className="clip-head-thumb text-thumb">{clip.sticker ? clip.text?.content : 'T'}</div>
        <div className="clip-head-text">
          <strong title={preview}>{preview || 'Texto vazio'}</strong>
          <span className="muted">
            {clip.sticker ? 'Adesivo' : clip.caption ? 'Legenda' : 'Texto'} · {fmtDuration(clipDur(clip))}
            {track?.locked && ' · trilha bloqueada'}
          </span>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {[
          ['text', clip.sticker ? 'Adesivo' : clip.caption ? 'Legenda' : 'Texto'],
          ['anim', 'Animação'],
          ['info', 'Info'],
        ].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={'tab' + (tab === id ? ' on' : '')} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className={'panel-scroll' + (track?.locked ? ' disabled' : '')}>
        {tab === 'text' && <TextTab clip={clip} />}
        {tab === 'text' && <KeyframeHere clip={clip} />}
        {tab === 'anim' && <AnimTab clip={clip} />}
        {tab === 'info' && (
          <Section title="Informações">
            <dl className="info-list">
              <div>
                <dt>Início</dt>
                <dd>{fmtTimecode(clip.start, fps)}</dd>
              </div>
              <div>
                <dt>Duração</dt>
                <dd>{fmtTimecode(clipDur(clip), fps)}</dd>
              </div>
              <div>
                <dt>Linhas</dt>
                <dd>{String(clip.text?.content || '').split('\n').length}</dd>
              </div>
            </dl>
          </Section>
        )}
      </div>
    </>
  );
}

const COLORS = ['#ffffff', '#000000', '#ffd400', '#ffc72c', '#ff4e7a', '#e1141f', '#ff8a00', '#3fd18f', '#00c8ff', '#2f6bff', '#9b5cff', '#ff2bd6'];

function ColorField({ label, value, onChange }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="swatches small">
        {COLORS.map((c) => (
          <button key={c} className={'swatch' + (value?.toLowerCase() === c ? ' on' : '')} style={{ background: c }} onClick={() => onChange(c)} aria-label={`Cor ${c}`} />
        ))}
        <label className="swatch custom" title="Outra cor" style={!COLORS.includes(value?.toLowerCase()) ? { background: value } : undefined}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
          {COLORS.includes(value?.toLowerCase()) && <Icon name="plus" size={13} />}
        </label>
      </div>
    </div>
  );
}

function TextTab({ clip }) {
  const update = useUpdater(clip.id);
  const st = withStyle(clip.text);
  const { local, tol } = useLocalTime(clip);
  const tr = transformAt(clip, local);
  const W = useStore((s) => s.project.settings.width);
  const H = useStore((s) => s.project.settings.height);
  const textFocus = useStore((s) => s.textFocus);
  const areaRef = useRef(null);
  const set = (path) => update((c, v) => {
    c.text = withStyle(c.text);
    setPath(c.text, path, v);
  });
  const commit = (path, v) => set(path)(v, 'set');
  const setT = (key) => update((c, v) => applyProp(c, key, v, local, tol));
  const info = fontInfo(st.font);

  // Duplo clique no texto do player foca a caixa de edição.
  useEffect(() => {
    if (!textFocus || !areaRef.current) return;
    areaRef.current.focus();
    areaRef.current.select();
  }, [textFocus]);

  return (
    <>
      <Section title="Conteúdo">
        <textarea
          ref={areaRef}
          className="text-area"
          value={st.content}
          rows={3}
          placeholder="Digite o texto"
          onFocus={() => useStore.getState().gestureStart()}
          onChange={(e) => set('content')(e.target.value, 'live')}
          onBlur={() => useStore.getState().gestureEnd()}
        />
      </Section>

      <Section title="Fonte">
        <select className="font-select" value={st.font} onChange={(e) => commit('font', e.target.value)} style={{ fontFamily: `"${st.font}"` }} aria-label="Fonte">
          {FONTS.map((f) => (
            <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>
              {f.label}
            </option>
          ))}
        </select>
        <SliderField label="Tamanho" value={st.size} min={10} max={400} step={1} unit="px" defaultValue={96} onChange={set('size')} />
        <div className="style-row">
          <div className="seg icon-seg" role="group" aria-label="Estilo">
            <button className={st.bold ? 'on' : ''} disabled={!info.bold} onClick={() => commit('bold', !st.bold)} aria-pressed={st.bold} title={info.bold ? 'Negrito' : 'Esta fonte só tem um peso'}>
              <b>N</b>
            </button>
            <button className={st.italic ? 'on' : ''} onClick={() => commit('italic', !st.italic)} aria-pressed={st.italic} title="Itálico">
              <i>I</i>
            </button>
            <button className={st.underline ? 'on' : ''} onClick={() => commit('underline', !st.underline)} aria-pressed={st.underline} title="Sublinhado">
              <u>S</u>
            </button>
          </div>
          <div className="seg icon-seg" role="group" aria-label="Alinhamento">
            {[
              ['left', 'Esquerda'],
              ['center', 'Centro'],
              ['right', 'Direita'],
            ].map(([a, label]) => (
              <button key={a} className={st.align === a ? 'on' : ''} onClick={() => commit('align', a)} aria-pressed={st.align === a} title={label}>
                <AlignIcon align={a} />
              </button>
            ))}
          </div>
        </div>
        <SliderField label="Espaço entre letras" value={st.letterSpacing} min={-10} max={60} step={1} unit="px" defaultValue={0} onChange={set('letterSpacing')} />
        <SliderField label="Altura da linha" value={st.lineHeight} min={0.7} max={3} step={0.05} decimals={2} defaultValue={1.15} onChange={set('lineHeight')} />
      </Section>

      <Section title="Cor" action={
          <span className="inline-switch">
            Gradiente <Switch label="Gradiente" checked={st.gradient.enabled} onChange={(v) => commit('gradient.enabled', v)} />
          </span>
        }>
        {st.gradient.enabled ? (
          <div className="grad-row">
            <ColorField label="Topo" value={st.gradient.from} onChange={(v) => commit('gradient.from', v)} />
            <ColorField label="Base" value={st.gradient.to} onChange={(v) => commit('gradient.to', v)} />
          </div>
        ) : (
          <ColorField value={st.color} onChange={(v) => commit('color', v)} />
        )}
      </Section>

      <Section title="Contorno" action={<Switch label="Ativar" checked={st.stroke.enabled} onChange={(v) => commit('stroke.enabled', v)} />}>
        {st.stroke.enabled && (
          <>
            <ColorField value={st.stroke.color} onChange={(v) => commit('stroke.color', v)} />
            <SliderField label="Espessura" value={st.stroke.width} min={1} max={40} step={1} unit="px" defaultValue={6} onChange={set('stroke.width')} />
          </>
        )}
      </Section>

      <Section title="Sombra" action={<Switch label="Ativar" checked={st.shadow.enabled} onChange={(v) => commit('shadow.enabled', v)} />}>
        {st.shadow.enabled && (
          <>
            <ColorField value={st.shadow.color} onChange={(v) => commit('shadow.color', v)} />
            <SliderField label="Opacidade" value={st.shadow.opacity} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={0.6} onChange={set('shadow.opacity')} />
            <SliderField label="Desfoque" value={st.shadow.blur} min={0} max={80} step={1} unit="px" defaultValue={14} onChange={set('shadow.blur')} />
            <SliderField label="Distância" value={st.shadow.distance} min={0} max={60} step={1} unit="px" defaultValue={6} onChange={set('shadow.distance')} />
            <SliderField label="Ângulo" value={st.shadow.angle} min={0} max={360} step={1} unit="°" defaultValue={45} onChange={set('shadow.angle')} />
          </>
        )}
      </Section>

      <Section title="Brilho" action={<Switch label="Ativar" checked={st.glow.enabled} onChange={(v) => commit('glow.enabled', v)} />}>
        {st.glow.enabled && (
          <>
            <ColorField value={st.glow.color} onChange={(v) => commit('glow.color', v)} />
            <SliderField label="Intensidade" value={st.glow.strength} min={2} max={100} step={1} defaultValue={26} onChange={set('glow.strength')} />
          </>
        )}
      </Section>

      <Section title="Fundo" action={<Switch label="Ativar" checked={st.background.enabled} onChange={(v) => commit('background.enabled', v)} />}>
        {st.background.enabled && (
          <>
            <ColorField value={st.background.color} onChange={(v) => commit('background.color', v)} />
            <SliderField label="Opacidade" value={st.background.opacity} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={0.7} onChange={set('background.opacity')} />
            <SliderField label="Cantos" value={st.background.radius} min={0} max={100} step={1} unit="px" defaultValue={14} onChange={set('background.radius')} />
            <SliderField label="Margem" value={st.background.padding} min={0} max={120} step={1} unit="px" defaultValue={24} onChange={set('background.padding')} />
          </>
        )}
      </Section>

      <Section
        title="Transformação"
        action={
          <button className="link-btn" onClick={() => update((c) => (c.transform = { ...DEFAULT_TRANSFORM }))(null, 'set')}>
            <Icon name="reset" size={14} /> Restaurar
          </button>
        }
      >
        <SliderField label="Escala" adornment={<KfButton clip={clip} prop="scale" />} value={tr.scale} min={0.05} max={5} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={setT('scale')} />
        <SliderField label="Posição X" adornment={<KfButton clip={clip} prop="x" />} value={tr.x} min={-1} max={1} step={1} unit="px" toDisplay={(v) => v * W} fromDisplay={(v) => v / W} defaultValue={0} onChange={setT('x')} />
        <SliderField label="Posição Y" adornment={<KfButton clip={clip} prop="y" />} value={tr.y} min={-1} max={1} step={1} unit="px" toDisplay={(v) => v * H} fromDisplay={(v) => v / H} defaultValue={0} onChange={setT('y')} />
        <SliderField label="Rotação" adornment={<KfButton clip={clip} prop="rotation" />} value={tr.rotation} min={-180} max={180} step={1} unit="°" defaultValue={0} onChange={setT('rotation')} />
        <SliderField label="Opacidade" adornment={<KfButton clip={clip} prop="opacity" />} value={tr.opacity} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={setT('opacity')} />
      </Section>
    </>
  );
}

function AlignIcon({ align }) {
  const lines = align === 'left' ? [[4, 16], [4, 12], [4, 18]] : align === 'right' ? [[4, 20], [8, 20], [2, 20]] : [[4, 20], [7, 17], [3, 21]];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      {lines.map(([a, b], i) => (
        <path key={i} d={`M${a} ${7 + i * 5}H${b}`} />
      ))}
    </svg>
  );
}

export function AnimTab({ clip, noTypewriter }) {
  const update = useUpdater(clip.id);
  const anim = withAnim(clip.anim);
  const dur = clipDur(clip);
  const set = (path) => update((c, v) => {
    c.anim = withAnim(c.anim);
    setPath(c.anim, path, v);
  });

  // Ao escolher uma animação, toca só aquele trecho para mostrar como ficou.
  const previewPart = (part, nextAnim) => {
    const { inDur, outDur } = animSpans(nextAnim, dur);
    const end = clip.start + dur;
    if (part === 'in') engine.playRange(clip.start, clip.start + Math.min(dur, inDur + 0.5));
    else if (part === 'out') engine.playRange(Math.max(clip.start, end - outDur - 0.4), end - 0.001);
    else engine.playRange(clip.start, Math.min(end - 0.001, clip.start + 3));
  };

  const choose = (part, type) => {
    const next = withAnim(clip.anim);
    next[part] = { ...next[part], type };
    set(part + '.type')(type, 'set');
    if (type !== 'none') setTimeout(() => previewPart(part, next), 30);
    else engine.pause();
  };

  const group = (part, title, options, extra) => (
    <Section title={title}>
      <div className="anim-grid">
        {options.map(([id, label]) => (
          <button key={id} className={'anim-chip' + (anim[part].type === id ? ' on' : '')} onClick={() => choose(part, id)} aria-pressed={anim[part].type === id}>
            <AnimGlyph id={id} part={part} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {anim[part].type !== 'none' && extra}
    </Section>
  );

  const maxDur = Math.max(0.1, Math.min(5, dur));
  return (
    <>
      {group('in', 'Entrada', noTypewriter ? ANIMS_IN.filter(([id]) => id !== 'typewriter') : ANIMS_IN, <SliderField label="Duração" value={Math.min(anim.in.dur, maxDur)} min={0.1} max={maxDur} step={0.1} unit="s" decimals={1} defaultValue={0.5} onChange={set('in.dur')} />)}
      {group('out', 'Saída', noTypewriter ? ANIMS_OUT.filter(([id]) => id !== 'typewriter') : ANIMS_OUT, <SliderField label="Duração" value={Math.min(anim.out.dur, maxDur)} min={0.1} max={maxDur} step={0.1} unit="s" decimals={1} defaultValue={0.5} onChange={set('out.dur')} />)}
      {group('loop', 'Repetição', ANIMS_LOOP, <SliderField label="Velocidade (ciclo)" value={anim.loop.period} min={0.2} max={4} step={0.1} unit="s" decimals={1} defaultValue={1.2} onChange={set('loop.period')} />)}
      <div className="pad">
        <button className="secondary" onClick={() => engine.playRange(clip.start, clip.start + dur - 0.001)}>
          <Icon name="play" size={14} /> Ver o texto inteiro
        </button>
      </div>
    </>
  );
}

// Pequeno desenho que sugere o movimento de cada animação.
function AnimGlyph({ id }) {
  const arrows = { slideUp: 'M12 18V6m0 0-4 4m4-4 4 4', slideDown: 'M12 6v12m0 0-4-4m4 4 4-4', slideLeft: 'M18 12H6m0 0 4-4m-4 4 4 4', slideRight: 'M6 12h12m0 0-4-4m4 4-4 4' };
  return (
    <svg className="anim-glyph" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {id === 'none' && <path d="M6 6l12 12" />}
      {id === 'fade' && (
        <>
          <rect x="4" y="7" width="5" height="10" rx="1" opacity="0.3" />
          <rect x="10" y="7" width="5" height="10" rx="1" opacity="0.6" />
          <rect x="16" y="7" width="4" height="10" rx="1" />
        </>
      )}
      {arrows[id] && <path d={arrows[id]} />}
      {id === 'zoomIn' && <path d="M9 9l-4-4m0 0v3m0-3h3m7 10 4 4m0 0v-3m0 3h-3M10 10h4v4h-4z" />}
      {id === 'zoomOut' && <path d="M5 5l4 4m0 0V6m0 3H6m13 10-4-4m0 0v3m0-3h3M8 8h8v8H8z" />}
      {id === 'pop' && <path d="M12 4v3m0 10v3M4 12h3m10 0h3M6.5 6.5l2 2m7 7 2 2m0-11-2 2m-7 7-2 2" />}
      {id === 'blur' && (
        <>
          <circle cx="12" cy="12" r="6" opacity="0.35" />
          <circle cx="12" cy="12" r="3.5" />
        </>
      )}
      {id === 'typewriter' && <path d="M5 8h2m3 0h2m3 0h4M5 12h6m3 0h2M5 16h3m3 0h1M18 14v5" />}
      {id === 'pulse' && <path d="M3 12h4l2-5 4 10 2-5h6" />}
      {id === 'sway' && <path d="M12 4v4M8 20l4-12 4 12M6 9l6-1 6 1" />}
      {id === 'float' && <path d="M4 14c2.5-3 5.5-3 8 0s5.5 3 8 0M8 8h8" />}
      {id === 'blink' && <path d="M12 6v2m0 8v2M6 12h2m8 0h2M9 9l-1-1m8 8-1-1m0-6 1-1M8 16l1-1M12 10.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" />}
      {id === 'shake' && <path d="M8 5 6 19M18 5l-2 14M4 9l2 1-2 1 2 1-2 1M20 9l-2 1 2 1-2 1 2 1" />}
    </svg>
  );
}
