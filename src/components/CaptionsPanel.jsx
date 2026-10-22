import { useEffect, useRef, useState } from 'react';
import { useStore, clipEnd } from '../store';
import { Icon } from '../icons';
import { SliderField } from './Fields.jsx';
import { seek, cleanError } from '../ops';
import { CAPTION_STYLES, captionClips, captionStyleOf, addCaption, updateCaption, removeCaption, setCaptionStyle, parseSrt, toSrt, importCaptions } from '../captions';
import { askConfirm } from './DialogHost.jsx';

// Tempo no formato m:ss.d (ex.: 1:05.3) e leitura do que o usuário digitar (1:05.3 ou 65.3).
const fmt = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
function parse(v) {
  const s = String(v).trim().replace(',', '.');
  const m = s.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (m) return +m[1] * 60 + +m[2];
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default function CaptionsPanel() {
  const clips = useStore((s) => captionClips(s.project));
  const cs = useStore((s) => captionStyleOf(s.project));
  const now = useStore((s) => s.currentTime);
  const name = useStore((s) => s.project.name);
  const [focusId, setFocusId] = useState(null);

  const add = (at = useStore.getState().currentTime) => {
    const id = addCaption(at);
    if (id) setFocusId(id);
    else useStore.getState().notify('Não há espaço livre aqui: mova o cursor para depois da fala atual.');
  };

  const importFile = async () => {
    try {
      const r = await window.api.openSrt();
      if (!r) return;
      const items = parseSrt(r.text);
      if (!items.length) throw new Error('nenhuma fala encontrada no arquivo');
      if (clips.length && !(await askConfirm({ title: 'Trocar as legendas?', message: `As ${clips.length} legendas atuais serão trocadas pelas ${items.length} do arquivo.`, ok: 'Trocar' }))) return;
      importCaptions(items);
      useStore.getState().notify(`${items.length} legendas importadas de ${r.name}.`);
    } catch (err) {
      useStore.getState().notify('Não foi possível importar: ' + cleanError(err), 'error');
    }
  };

  const exportFile = async () => {
    try {
      const out = await window.api.saveSrt(toSrt(clips), name || 'legendas');
      if (out) useStore.getState().notify('Legendas salvas em ' + out);
    } catch (err) {
      useStore.getState().notify('Não foi possível salvar: ' + cleanError(err), 'error');
    }
  };

  return (
    <div className="captions">
      <p className="hint tr-help">
        Escreva as falas do vídeo. Cada uma aparece entre o tempo de <b>início</b> e de <b>fim</b>. Dica: pause no começo da fala e clique em <b>Adicionar fala</b>; aperte <b>Enter</b> no texto para criar a próxima.
      </p>

      <h3 className="panel-subtitle">Estilo de todas as legendas</h3>
      <div className="mask-grid">
        {CAPTION_STYLES.map(([id, label]) => (
          <button key={id} className={'mask-chip cap-style cap-' + id + (cs.style === id ? ' on' : '')} aria-pressed={cs.style === id} onClick={() => setCaptionStyle({ style: id })}>
            <span>Aa</span> {label}
          </button>
        ))}
      </div>
      <StyleSlider label="Tamanho" value={cs.size} min={24} max={140} step={1} unit="px" def={56} k="size" />
      <StyleSlider label="Altura na tela" value={cs.y} min={-0.45} max={0.45} step={1} unit="%" def={0.36} k="y" pct />

      <div className="button-row cap-actions">
        <button className="primary small" onClick={() => add()}>
          <Icon name="plus" size={15} /> Adicionar fala
        </button>
        <button className="secondary small" onClick={importFile} title="Abrir um arquivo de legendas .srt">
          <Icon name="import" size={15} /> Importar .srt
        </button>
        <button className="secondary small" onClick={exportFile} disabled={!clips.length} title="Salvar as legendas como arquivo .srt (para YouTube e outros)">
          <Icon name="export" size={15} /> Exportar .srt
        </button>
      </div>

      {clips.length === 0 ? (
        <p className="muted cap-empty">Nenhuma legenda ainda.</p>
      ) : (
        <ol className="cap-list">
          {clips.map((c, i) => (
            <CaptionRow key={c.id} clip={c} index={i} active={now >= c.start && now < clipEnd(c)} autoFocus={focusId === c.id} onAddNext={() => add(clipEnd(c))} />
          ))}
        </ol>
      )}
    </div>
  );
}

function StyleSlider({ label, value, min, max, step, unit, def, k, pct }) {
  const onChange = (v, phase) => {
    const s = useStore.getState();
    if (v == null) return;
    if (phase === 'start') s.gestureStart();
    else if (phase === 'end') s.gestureEnd();
    else if (phase === 'live') s.live((p) => applyStyleLive(p, k, v));
    else setCaptionStyle({ [k]: v });
  };
  const conv = pct ? { toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100 } : {};
  return <SliderField label={label} value={value} min={min} max={max} step={step} unit={unit} defaultValue={def} onChange={onChange} {...conv} />;
}

// Arrastando o slider: atualiza sem criar um passo de desfazer por movimento.
function applyStyleLive(p, k, v) {
  p.captionStyle = { ...captionStyleOf(p), [k]: v };
  for (const c of p.clips) {
    if (!c.caption) continue;
    if (k === 'size') c.text = { ...c.text, size: v };
    else c.transform = { ...c.transform, y: v };
  }
}

function CaptionRow({ clip, index, active, autoFocus, onAddNext }) {
  const [text, setText] = useState(clip.text?.content || '');
  const ref = useRef(null);
  useEffect(() => setText(clip.text?.content || ''), [clip.text?.content]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    if (active) ref.current?.closest('li')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const save = () => text !== (clip.text?.content || '') && updateCaption(clip.id, { content: text });
  const end = clipEnd(clip);

  return (
    <li className={'cap-row' + (active ? ' on' : '')}>
      <div className="cap-times">
        <button className="cap-num" onClick={() => seek(clip.start + 0.01)} title="Ir para esta fala">
          {index + 1}
        </button>
        <TimeInput value={clip.start} label="Início" onCommit={(v) => v < end - 0.1 && updateCaption(clip.id, { start: v, end })} />
        <span className="muted">→</span>
        <TimeInput value={end} label="Fim" onCommit={(v) => v > clip.start + 0.1 && updateCaption(clip.id, { end: v })} />
        <button className="icon-btn" onClick={() => removeCaption(clip.id)} title="Apagar fala" aria-label="Apagar fala">
          <Icon name="trash" size={14} />
        </button>
      </div>
      <textarea
        ref={ref}
        rows={2}
        value={text}
        placeholder="Escreva a fala…"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => seek(clip.start + 0.01)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation(); // atalhos do editor (espaço, Delete...) não disparam enquanto escreve
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
            onAddNext();
          }
        }}
      />
    </li>
  );
}

function TimeInput({ value, label, onCommit }) {
  const [v, setV] = useState(fmt(value));
  useEffect(() => setV(fmt(value)), [value]);
  const commit = () => {
    const t = parse(v);
    if (t == null) setV(fmt(value));
    else if (Math.abs(t - value) > 1e-3) onCommit(t);
  };
  return (
    <input
      className="cap-time"
      aria-label={label}
      title={`${label} (minutos:segundos)`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
