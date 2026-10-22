import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { TRANSITIONS, DEFAULT_TRANSITION_DUR } from '../transitions';
import { setTransition, setTransitionAll } from '../ops';
import { SliderField } from './Fields.jsx';

// Painel de transições: escolha um clipe da trilha principal (o que entra) e clique numa transição.
export default function TransitionsPanel() {
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : null));
  const [dur, setDur] = useState(clip?.transition?.dur || DEFAULT_TRANSITION_DUR);
  const current = clip?.transition?.type;

  const apply = (type) => {
    if (!clip) {
      useStore.getState().notify('Selecione na linha do tempo o clipe que vai ENTRAR (o segundo dos dois).');
      return;
    }
    setTransition(clip.id, type, dur);
  };

  return (
    <div className="panel-scroll text-panel">
      <p className="hint tr-help">
        <b>Como usar:</b> selecione o clipe que entra (o segundo de dois clipes da trilha principal) e clique numa transição. Ela acontece no corte entre ele e o clipe anterior.
      </p>
      <SliderField
        label="Duração"
        value={dur}
        min={0.1}
        max={3}
        step={0.1}
        unit="s"
        decimals={1}
        defaultValue={DEFAULT_TRANSITION_DUR}
        onChange={(v, phase) => {
          if (v == null) return;
          setDur(v);
          if (clip?.transition && (phase === 'set' || phase === 'live')) setTransition(clip.id, clip.transition.type, v);
        }}
      />
      <div className="tr-grid">
        <button className={'tr-card' + (!current ? ' on' : '')} onClick={() => clip && setTransition(clip.id, null)} disabled={!clip?.transition}>
          <span className="tr-thumb none">
            <Icon name="close" size={18} />
          </span>
          <span>Nenhuma</span>
        </button>
        {TRANSITIONS.map(([id, label]) => (
          <button key={id} className={'tr-card' + (current === id ? ' on' : '')} onClick={() => apply(id)} title={label}>
            <span className={`tr-thumb tr-${id}`}>
              <span className="tr-a" />
              <span className="tr-b" />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="button-row">
        <button className="secondary small" onClick={() => current && setTransitionAll(current, dur)} disabled={!current} title="Usa a transição selecionada em todos os cortes da trilha principal">
          Aplicar em todos os cortes
        </button>
        <button className="link-btn" onClick={() => setTransitionAll(null)}>
          <Icon name="trash" size={14} /> Remover todas
        </button>
      </div>
    </div>
  );
}
