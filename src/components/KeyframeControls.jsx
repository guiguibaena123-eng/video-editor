import { useStore, clipDur } from '../store';
import { seek } from '../ops';
import { hasKeyframes, findKey, setKeyframe, removeKeyframe, valueAt, keyframeTimes, KF_PROPS, EASES } from '../keyframes';
import { Section } from './Fields.jsx';
import { Icon } from '../icons';

// Instante atual dentro do clipe e tolerância de meio quadro.
export function useLocalTime(clip) {
  const now = useStore((s) => s.currentTime);
  const fps = useStore((s) => s.project.settings.fps);
  const local = now - clip.start;
  return { local, tol: 0.5 / fps, inside: local >= -1e-6 && local <= clipDur(clip) + 1e-6 };
}

const commitClip = (id, fn) => useStore.getState().commit((p) => fn(p.clips.find((c) => c.id === id)));

// Losango ◆ ao lado de uma propriedade: marca/desmarca keyframe no instante da barra branca.
// As setas pulam para o keyframe anterior/seguinte dessa propriedade.
export function KfButton({ clip, prop }) {
  const { local, tol, inside } = useLocalTime(clip);
  const has = hasKeyframes(clip, prop);
  const at = findKey(clip, prop, local, tol) >= 0;
  const ks = clip.keyframes?.[prop] || [];
  const prev = [...ks].reverse().find((k) => k.t < local - tol);
  const next = ks.find((k) => k.t > local + tol);
  const toggle = () =>
    commitClip(clip.id, (c) => {
      if (at) removeKeyframe(c, prop, local, tol);
      else setKeyframe(c, prop, local, valueAt(c, prop, local), tol);
    });
  return (
    <span className="kf-ctl">
      {has && (
        <button className="kf-nav" disabled={!prev} onClick={() => seek(clip.start + prev.t)} aria-label="Keyframe anterior" title="Keyframe anterior">
          ‹
        </button>
      )}
      <button
        className={'kf-btn' + (at ? ' on' : has ? ' has' : '')}
        disabled={!inside}
        onClick={toggle}
        aria-pressed={at}
        title={!inside ? 'Coloque a barra branca sobre o clipe' : at ? 'Remover keyframe deste instante' : 'Adicionar keyframe neste instante'}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1 11 6 6 11 1 6Z" />
        </svg>
      </button>
      {has && (
        <button className="kf-nav" disabled={!next} onClick={() => seek(clip.start + next.t)} aria-label="Próximo keyframe" title="Próximo keyframe">
          ›
        </button>
      )}
    </span>
  );
}

// Aparece quando a barra está sobre um keyframe: escolhe como o movimento chega ao próximo.
export function KeyframeHere({ clip }) {
  const { local, tol } = useLocalTime(clip);
  const props = KF_PROPS.filter((p) => findKey(clip, p, local, tol) >= 0);
  const times = keyframeTimes(clip);
  if (!times.length) return null;
  const ease = props.length ? clip.keyframes[props[0]][findKey(clip, props[0], local, tol)].ease || 'ease' : null;
  const setEase = (e) =>
    commitClip(clip.id, (c) => {
      for (const p of props) {
        const i = findKey(c, p, local, tol);
        c.keyframes[p] = c.keyframes[p].map((k, j) => (j === i ? { ...k, ease: e } : k));
      }
    });
  const clearAll = () =>
    commitClip(clip.id, (c) => {
      delete c.keyframes;
    });
  return (
    <Section
      title="Keyframes"
      action={
        <button className="link-btn" onClick={clearAll} title="Apagar todos os keyframes deste clipe">
          <Icon name="trash" size={14} /> Apagar todos
        </button>
      }
    >
      {props.length ? (
        <>
          <p className="hint">Movimento a partir deste keyframe até o próximo:</p>
          <div className="seg">
            {EASES.map(([id, label]) => (
              <button key={id} className={ease === id ? 'on' : ''} onClick={() => setEase(id)} aria-pressed={ease === id}>
                {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="hint">Este clipe tem {times.length} {times.length === 1 ? 'keyframe' : 'keyframes'}. Mova a barra branca até um deles (os losangos no clipe da linha do tempo) para escolher a suavidade do movimento.</p>
      )}
    </Section>
  );
}
