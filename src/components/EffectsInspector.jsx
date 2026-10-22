import { useStore } from '../store';
import { Icon } from '../icons';
import { SliderField, Section } from './Fields.jsx';
import { EFFECTS, EFFECT_CATS, EFFECT_LABEL, HAS_SPEED, HAS_AMOUNT, HAS_DUR } from '../effects';
import { toggleEffect, applyEffectsToAll, toggleFlip, stabilizeClip, setEffectClipType, deleteSelection, duplicateSelection } from '../ops';
import { clipDur } from '../store';
import { fmtDuration } from '../util';

const pct = { toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100, unit: '%' };

// Aba "Efeitos" do clipe: efeitos ligados, com intensidade e velocidade.
export default function EffectsInspector({ clip }) {
  const effects = clip.effects || [];
  const set = (type, key) => (value, phase) => {
    const s = useStore.getState();
    const apply = (p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      c.effects = (c.effects || []).map((e) => (e.type === type ? { ...e, [key]: value } : e));
    };
    if (phase === 'start') s.gestureStart();
    else if (phase === 'live') s.live(apply);
    else if (phase === 'end') s.gestureEnd();
    else if (value != null) s.commit(apply);
  };
  const on = new Set(effects.map((e) => e.type));

  return (
    <>
      <Section title="Adicionar efeito">
        <select
          className="fx-add"
          value=""
          aria-label="Adicionar efeito"
          onChange={(ev) => {
            if (ev.target.value) toggleEffect(clip.id, ev.target.value);
          }}
        >
          <option value="">Escolha um efeito…</option>
          {EFFECT_CATS.map(([cid, title]) => (
            <optgroup key={cid} label={title}>
              {EFFECTS.filter(([, , k]) => k === cid).map(([id, label]) => (
                <option key={id} value={id} disabled={on.has(id)}>
                  {label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="hint">Para ver todos com miniaturas animadas, use a aba Efeitos do painel da esquerda.</p>
      </Section>
      {effects.length === 0 && <p className="muted pad">Nenhum efeito neste clipe.</p>}
      {effects.map((e) => (
        <Section
          key={e.type}
          title={EFFECT_LABEL[e.type] || e.type}
          action={
            <button className="link-btn" onClick={() => toggleEffect(clip.id, e.type)} title="Tirar efeito">
              <Icon name="trash" size={14} /> Tirar
            </button>
          }
        >
          <EffectFields e={e} set={(key) => set(e.type, key)} />
        </Section>
      ))}
      {effects.length > 0 && (
        <div className="button-row pad">
          <button className="secondary small" onClick={() => applyEffectsToAll(clip.id)} title="Copia estes efeitos para todos os clipes da trilha principal">
            Aplicar em todos
          </button>
        </div>
      )}
    </>
  );
}

// Ajustes de um efeito (intensidade, velocidade, duração). onChange(key) recebe (valor, fase).
function EffectFields({ e, set }) {
  return (
    <>
      {HAS_AMOUNT(e.type) && <SliderField label="Intensidade" value={e.amount ?? 0.5} min={0} max={1} step={1} {...pct} defaultValue={0.5} onChange={set('amount')} />}
      {HAS_SPEED.has(e.type) && <SliderField label="Velocidade" value={e.speed ?? 1} min={0.25} max={3} step={0.05} unit="x" decimals={2} defaultValue={1} onChange={set('speed')} />}
      {HAS_DUR(e.type) && <SliderField label="Duração" value={e.dur ?? 1} min={0.2} max={4} step={0.1} unit="s" decimals={1} defaultValue={1} onChange={set('dur')} />}
      {!HAS_AMOUNT(e.type) && !HAS_DUR(e.type) && <p className="muted">Sem ajustes: é só ligar ou desligar.</p>}
    </>
  );
}

// Clipe da trilha de efeito: um efeito que vale para tudo que está abaixo dele.
export function EffectClipInspector({ clip }) {
  const e = clip.fx || { type: 'shake' };
  const set = (key) => (value, phase) => {
    const s = useStore.getState();
    const apply = (p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      c.fx = { ...c.fx, [key]: value };
    };
    if (phase === 'start') s.gestureStart();
    else if (phase === 'live') s.live(apply);
    else if (phase === 'end') s.gestureEnd();
    else if (value != null) s.commit(apply);
  };
  return (
    <>
      <div className="clip-head">
        <div className="clip-head-thumb fx-thumb">✦</div>
        <div className="clip-head-text">
          <strong>{EFFECT_LABEL[e.type] || 'Efeito'}</strong>
          <span className="muted">Trilha de efeito · {fmtDuration(clipDur(clip))}</span>
        </div>
      </div>
      <div className="panel-scroll">
        <p className="hint pad">Vale para todos os vídeos e imagens das trilhas abaixo, só no trecho que este clipe cobre. Estique as pontas na linha do tempo para mudar o trecho.</p>
        <Section title="Efeito">
          <select className="fx-add" value={e.type} aria-label="Trocar efeito" onChange={(ev) => setEffectClipType(clip.id, ev.target.value)}>
            {EFFECT_CATS.map(([cid, title]) => (
              <optgroup key={cid} label={title}>
                {EFFECTS.filter(([, , k]) => k === cid).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <EffectFields e={e} set={set} />
        </Section>
        <div className="button-row pad">
          <button className="secondary small" onClick={duplicateSelection}>
            <Icon name="duplicate" size={15} /> Duplicar
          </button>
          <button className="danger small" onClick={deleteSelection}>
            <Icon name="trash" size={15} /> Excluir
          </button>
        </div>
      </div>
    </>
  );
}

// Seção da aba Vídeo: espelhar e estabilizar.
export function FlipStabilize({ clip, media }) {
  const stab = clip.stabilizedFrom?.level || null;
  const busy = useStore((s) => !!s.busy);
  return (
    <>
      <Section title="Virar a imagem">
        <div className="button-row">
          <button className={'secondary small' + (clip.flipH ? ' active-pick' : '')} aria-pressed={!!clip.flipH} onClick={() => toggleFlip(clip.id, 'h')}>
            <Icon name="flip" size={15} /> Espelhar
          </button>
          <button className={'secondary small' + (clip.flipV ? ' active-pick' : '')} aria-pressed={!!clip.flipV} onClick={() => toggleFlip(clip.id, 'v')}>
            <Icon name="flip" size={15} className="rot90" /> De cabeça para baixo
          </button>
        </div>
      </Section>
      {media.type === 'video' && (
        <Section title="Estabilizar">
          <p className="muted">Reduz o tremor de vídeos gravados com a mão. O vídeo é ampliado um pouco para esconder as bordas.</p>
          <div className="mask-grid">
            {[
              [null, 'Desligado'],
              ['low', 'Leve'],
              ['medium', 'Recomendado'],
              ['high', 'Máximo'],
            ].map(([id, label]) => (
              <button key={label} disabled={busy} className={'mask-chip' + (stab === id ? ' on' : '')} aria-pressed={stab === id} onClick={() => stab !== id && stabilizeClip(clip.id, id)}>
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
