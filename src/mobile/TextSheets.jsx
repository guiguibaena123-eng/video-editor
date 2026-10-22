import { useRef, useState } from 'react';
import { useStore, clipEnd } from '../store';
import { TEXT_STYLES, TEXT_TEMPLATES } from '../textPresets';
import { FONTS, fontInfo } from '../fonts';
import { withStyle, withAnim, ANIMS_IN, ANIMS_OUT, ANIMS_LOOP, loadFont } from '../text';
import { addTextPreset, addSticker, seek } from '../ops';
import { GROUPS } from '../stickerGroups';
import { addCaption, captionClips, captionStyleOf, setCaptionStyle, CAPTION_STYLES, updateCaption, removeCaption } from '../captions';
import { engine } from '../engine';
import { Icon } from '../icons';
import { Slider, haptic, askText } from './ui';

// ---------- edição de um campo do clipe (arrastar vira um só passo de desfazer) ----------
const setPath = (obj, path, v) => {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] = { ...(o[k] || {}) };
  o[keys[keys.length - 1]] = v;
};
const edit = (clipId, root, path, v, phase = 'set') => {
  const s = useStore.getState();
  const apply = (p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (!c) return;
    c[root] = { ...(c[root] || {}) };
    setPath(c[root], path, v);
  };
  if (phase === 'start') s.gestureStart();
  else if (phase === 'live') s.live(apply);
  else if (phase === 'end') s.gestureEnd();
  else s.commit(apply);
};

const SWATCHES = ['#ffffff', '#000000', '#ffc72c', '#ff4e7a', '#e1141f', '#ff8a2b', '#37d67a', '#00c8ff', '#2f6bff', '#8a5cff', '#ff2bd6', '#d9d9d9'];

function Swatches({ value, onChange, label }) {
  const custom = !SWATCHES.includes(value?.toLowerCase());
  return (
    <div className="mswatches" role="group" aria-label={label}>
      {SWATCHES.map((c) => (
        <button key={c} className={'mswatch' + (value?.toLowerCase() === c ? ' on' : '')} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <label className={'mswatch custom' + (custom ? ' on' : '')} style={custom ? { background: value } : undefined} aria-label="Outra cor">
        {!custom && <Icon name="plus" size={16} />}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

// Miniatura "Aa" que imita o estilo do texto (só para escolher; o desenho real é do motor de texto).
function StyleThumb({ style, label, onClick }) {
  const st = withStyle(style);
  const info = fontInfo(st.font);
  const css = {
    fontFamily: `"${st.font}", sans-serif`,
    fontWeight: st.bold && info.bold ? info.bold : 400,
    fontStyle: st.italic ? 'italic' : 'normal',
    color: st.gradient.enabled ? 'transparent' : st.color,
    background: st.gradient.enabled ? `linear-gradient(${st.gradient.from}, ${st.gradient.to})` : undefined,
    WebkitBackgroundClip: st.gradient.enabled ? 'text' : undefined,
    backgroundClip: st.gradient.enabled ? 'text' : undefined,
    WebkitTextStroke: st.stroke.enabled ? `${Math.min(3, st.stroke.width / 3)}px ${st.stroke.color}` : undefined,
    paintOrder: 'stroke fill',
    textShadow: st.glow.enabled ? `0 0 10px ${st.glow.color}, 0 0 20px ${st.glow.color}` : st.shadow.enabled ? `2px 3px ${Math.min(6, st.shadow.blur / 3)}px rgba(0,0,0,.7)` : undefined,
    letterSpacing: Math.min(4, st.letterSpacing / 4),
  };
  const box = st.background.enabled ? { background: st.background.color, borderRadius: 6, padding: '2px 8px', opacity: st.background.opacity } : null;
  return (
    <button className="mstyle" onClick={onClick}>
      <span className="mstyle-aa">
        <span style={box ? { background: box.background, borderRadius: box.borderRadius, padding: box.padding } : undefined}>
          <span style={css}>Aa</span>
        </span>
      </span>
      <small>{label}</small>
    </button>
  );
}

// ---------- adicionar texto, modelo, adesivo ou legenda ----------
export function AddSheet({ onClose, initial = 'text' }) {
  const [tab, setTab] = useState(initial);
  const [motion, setMotion] = useState('pulse');
  const pick = (fn) => {
    fn();
    haptic(12);
    onClose();
  };
  return (
    <>
      <div className="mseg" role="tablist">
        {[['text', 'Texto'], ['sticker', 'Adesivos'], ['caption', 'Legendas']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'text' && (
        <>
          <p className="msec">Estilos</p>
          <div className="mstyles">
            {TEXT_STYLES.map((t) => (
              <StyleThumb key={t.id} style={t.clips[0].style} label={t.label} onClick={() => pick(() => addTextPreset(t))} />
            ))}
          </div>
          <p className="msec">Modelos animados</p>
          <div className="mstyles">
            {TEXT_TEMPLATES.map((t) => (
              <StyleThumb key={t.id} style={t.clips[0].style} label={t.label} onClick={() => pick(() => addTextPreset(t))} />
            ))}
          </div>
        </>
      )}
      {tab === 'sticker' && (
        <>
          <div className="mchips row">
            {[['none', 'Parado'], ['pulse', 'Pulsar'], ['sway', 'Balançar'], ['float', 'Flutuar'], ['shake', 'Tremer']].map(([k, l]) => (
              <button key={k} className={'mchip' + (motion === k ? ' on' : '')} onClick={() => setMotion(k)}>
                {l}
              </button>
            ))}
          </div>
          {GROUPS.map(([name, list]) => (
            <div key={name}>
              <p className="msec">{name}</p>
              <div className="memojis">
                {list.map((e) => (
                  <button key={e} onClick={() => pick(() => addSticker(e, motion))} aria-label={e}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
      {tab === 'caption' && <CaptionsTab onClose={onClose} />}
    </>
  );
}

// ---------- legendas ----------
function CaptionsTab({ onClose }) {
  const project = useStore((s) => s.project);
  const list = captionClips(project);
  const cs = captionStyleOf(project);
    const fmt = (v) => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`;

  const add = async () => {
    const text = await askText({ title: 'Nova legenda', confirm: 'Adicionar', multiline: true, placeholder: 'O que é dito aqui…' });
    if (text == null) return;
    if (addCaption(useStore.getState().currentTime, text)) haptic(12);
  };
  const editText = async (c) => {
    const text = await askText({ title: 'Texto da legenda', value: c.text?.content || '', confirm: 'Salvar', multiline: true });
    if (text != null) updateCaption(c.id, { content: text });
  };
  const goTo = (c) => {
    seek(c.start + 0.01);
    useStore.getState().select([c.id]);
  };

  return (
    <>
      <p className="msec">Estilo das legendas</p>
      <div className="mchips row">
        {CAPTION_STYLES.map(([id, label]) => (
          <button key={id} className={'mchip' + (cs.style === id ? ' on' : '')} onClick={() => setCaptionStyle({ style: id })}>
            {label}
          </button>
        ))}
      </div>
      <Slider label="Tamanho" value={cs.size} min={24} max={120} step={2} defaultValue={56} onChange={(v) => setCaptionStyle({ size: v })} />
      <Slider label="Posição na altura" value={Math.round(cs.y * 100)} min={-45} max={45} step={1} defaultValue={36} format={(v) => (v < 0 ? 'Topo ' : 'Base ') + Math.abs(Math.round(v)) + '%'} onChange={(v) => setCaptionStyle({ y: v / 100 })} />
      <p className="msec">Falas ({list.length})</p>
      <div className="mcaps">
        {list.map((c) => (
          <div key={c.id} className="mcap">
            <button className="mcap-main" onClick={() => editText(c)}>
              <small>
                {fmt(c.start)} → {fmt(clipEnd(c))}
              </small>
              <span>{c.text?.content || <i>(vazia)</i>}</span>
            </button>
            <button className="m-icon" aria-label="Ir para a fala" onClick={() => goTo(c)}>
              <Icon name="stepForward" size={18} />
            </button>
            <button className="m-icon" aria-label="Apagar fala" onClick={() => removeCaption(c.id)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        {!list.length && <p className="mhint">Nenhuma legenda ainda. Toque em “Nova fala” para escrever a primeira no ponto em que o vídeo está.</p>}
      </div>
      <div className="mchips">
        <button className="mchip on" onClick={add}>
          <Icon name="plus" size={16} /> Nova fala
        </button>
      </div>
    </>
  );
}

// ---------- texto do clipe selecionado ----------
export function TextEditSheet({ clip }) {
  const st = withStyle(clip.text);
  const info = fontInfo(st.font);
  const areaRef = useRef(null);
  const set = (path, v, phase) => edit(clip.id, 'text', path, v, phase);
  const num = (label, path, min, max, step, def, format) => (
    <Slider label={label} value={path.split('.').reduce((o, k) => o[k], st)} min={min} max={max} step={step} defaultValue={def} format={format} onStart={() => set(path, 0, 'start')} onChange={(v) => set(path, v, 'live')} onEnd={() => set(path, 0, 'end')} />
  );
  const toggle = (path, label, children) => {
    const on = path.split('.').reduce((o, k) => o[k], st).enabled ?? false;
    return (
      <div className="mgroup">
        <label className="mswitch">
          <span>{label}</span>
          <input type="checkbox" checked={on} onChange={(e) => set(path + '.enabled', e.target.checked)} />
          <i />
        </label>
        {on && children}
      </div>
    );
  };

  return (
    <>
      {!clip.sticker && (
        <textarea
          ref={areaRef}
          className="mtextarea"
          value={st.content}
          rows={2}
          maxLength={400}
          placeholder="Digite o texto"
          onFocus={() => set('content', '', 'start')}
          onChange={(e) => set('content', e.target.value, 'live')}
          onBlur={() => set('content', '', 'end')}
        />
      )}
      {!clip.sticker && (
        <>
          <p className="msec">Fonte</p>
          <div className="mchips row">
            {FONTS.map((f) => (
              <button
                key={f.family}
                className={'mchip font' + (st.font === f.family ? ' on' : '')}
                style={{ fontFamily: `"${f.family}"` }}
                onClick={() => {
                  set('font', f.family);
                  loadFont({ ...st, font: f.family }).then(() => engine.requestDraw());
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mchips">
            <button className={'mchip' + (st.bold ? ' on' : '')} disabled={!info.bold} onClick={() => set('bold', !st.bold)} aria-label="Negrito">
              <b>B</b>
            </button>
            <button className={'mchip' + (st.italic ? ' on' : '')} onClick={() => set('italic', !st.italic)} aria-label="Itálico">
              <i>I</i>
            </button>
            <button className={'mchip' + (st.underline ? ' on' : '')} onClick={() => set('underline', !st.underline)} aria-label="Sublinhado">
              <u>U</u>
            </button>
            {['left', 'center', 'right'].map((a) => (
              <button key={a} className={'mchip' + (st.align === a ? ' on' : '')} onClick={() => set('align', a)} aria-label={'Alinhar ' + a}>
                {a === 'left' ? '⇤' : a === 'center' ? '↔' : '⇥'}
              </button>
            ))}
          </div>
        </>
      )}
      {num('Tamanho', 'size', 20, clip.sticker ? 600 : 400, 2, clip.sticker ? 260 : 96, (v) => String(Math.round(v)))}
      {!clip.sticker && (
        <>
          <p className="msec">Cor</p>
          <Swatches label="Cor do texto" value={st.color} onChange={(c) => set('color', c)} />
          {num('Espaço entre letras', 'letterSpacing', -5, 40, 1, 0)}
          {toggle('gradient', 'Gradiente', (
            <div className="mpair">
              <Swatches label="Topo" value={st.gradient.from} onChange={(c) => set('gradient.from', c)} />
              <Swatches label="Base" value={st.gradient.to} onChange={(c) => set('gradient.to', c)} />
            </div>
          ))}
          {toggle('stroke', 'Contorno', (
            <>
              <Swatches label="Cor do contorno" value={st.stroke.color} onChange={(c) => set('stroke.color', c)} />
              {num('Espessura', 'stroke.width', 1, 30, 1, 6)}
            </>
          ))}
          {toggle('shadow', 'Sombra', (
            <>
              <Swatches label="Cor da sombra" value={st.shadow.color} onChange={(c) => set('shadow.color', c)} />
              {num('Desfoque', 'shadow.blur', 0, 50, 1, 14)}
              {num('Distância', 'shadow.distance', 0, 40, 1, 6)}
            </>
          ))}
          {toggle('glow', 'Brilho neon', (
            <>
              <Swatches label="Cor do brilho" value={st.glow.color} onChange={(c) => set('glow.color', c)} />
              {num('Força', 'glow.strength', 4, 80, 1, 26)}
            </>
          ))}
          {toggle('background', 'Caixa de fundo', (
            <>
              <Swatches label="Cor da caixa" value={st.background.color} onChange={(c) => set('background.color', c)} />
              {num('Transparência', 'background.opacity', 0.1, 1, 0.05, 0.7, (v) => Math.round(v * 100) + '%')}
              {num('Cantos', 'background.radius', 0, 60, 1, 14)}
              {num('Espaço', 'background.padding', 0, 80, 1, 24)}
            </>
          ))}
        </>
      )}
    </>
  );
}

// ---------- animação do texto ----------
export function AnimSheet({ clip }) {
  const an = withAnim(clip.anim);
  const set = (path, v, phase) => edit(clip.id, 'anim', path, v, phase);
  const row = (label, key, list, hasDur) => (
    <>
      <p className="msec">{label}</p>
      <div className="mchips row">
        {list.map(([k, l]) => (
          <button key={k} className={'mchip' + (an[key].type === k ? ' on' : '')} onClick={() => { set(key + '.type', k); engine.requestDraw(); }}>
            {l}
          </button>
        ))}
      </div>
      {an[key].type !== 'none' && (
        <Slider
          label={hasDur ? 'Duração' : 'Ritmo'}
          value={hasDur ? an[key].dur : an[key].period}
          min={hasDur ? 0.1 : 0.3}
          max={hasDur ? 2 : 4}
          step={0.05}
          format={(v) => v.toFixed(2).replace(/\.?0+$/, '') + ' s'}
          onStart={() => set('x', 0, 'start')}
          onChange={(v) => set(key + (hasDur ? '.dur' : '.period'), v, 'live')}
          onEnd={() => set('x', 0, 'end')}
        />
      )}
    </>
  );
  return (
    <>
      {row('Entrada', 'in', ANIMS_IN, true)}
      {row('Saída', 'out', ANIMS_OUT, true)}
      {row('Movimento contínuo', 'loop', ANIMS_LOOP, false)}
    </>
  );
}
