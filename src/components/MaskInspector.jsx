import { useStore } from '../store';
import { Icon } from '../icons';
import { SliderField, Section, Switch } from './Fields.jsx';
import { MASKS, BLEND_MODES, withMask } from '../masks';

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
const pct = { toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100, unit: '%' };

export default function MaskInspector({ clip }) {
  const update = useUpdater(clip.id);
  const mask = withMask(clip.mask);
  const type = clip.mask?.type || 'none';
  const setM = (key) => update((c, v) => (c.mask = { ...withMask(c.mask), [key]: v }));
  const choose = (t) => update((c) => (c.mask = t === 'none' ? undefined : { ...withMask(c.mask), type: t }))(null, 'set');

  return (
    <>
      <Section title="Forma">
        <div className="mask-grid">
          {MASKS.map(([id, label]) => (
            <button key={id} className={'mask-chip' + (type === id ? ' on' : '')} onClick={() => choose(id)} aria-pressed={type === id}>
              <MaskGlyph id={id} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </Section>
      {type !== 'none' && (
        <Section
          title="Ajustar máscara"
          action={
            <span className="inline-switch">
              Inverter <Switch label="Inverter máscara" checked={!!mask.invert} onChange={(v) => setM('invert')(v, 'set')} />
            </span>
          }
        >
          <SliderField label="Posição X" value={mask.x} min={-1} max={1} step={1} {...pct} defaultValue={0} onChange={setM('x')} />
          <SliderField label="Posição Y" value={mask.y} min={-1} max={1} step={1} {...pct} defaultValue={0} onChange={setM('y')} />
          {type !== 'linear' && <SliderField label={type === 'mirror' ? 'Largura da faixa' : 'Largura'} value={type === 'mirror' ? mask.h : mask.w} min={0.02} max={2} step={1} {...pct} defaultValue={0.6} onChange={setM(type === 'mirror' ? 'h' : 'w')} />}
          {!['linear', 'mirror'].includes(type) && <SliderField label="Altura" value={mask.h} min={0.02} max={2} step={1} {...pct} defaultValue={0.6} onChange={setM('h')} />}
          <SliderField label="Rotação" value={mask.rotation} min={-180} max={180} step={1} unit="°" defaultValue={0} onChange={setM('rotation')} />
          {type === 'rect' && <SliderField label="Cantos" value={mask.round} min={0} max={1} step={1} {...pct} defaultValue={0} onChange={setM('round')} />}
          <SliderField label="Suavizar borda" value={mask.feather} min={0} max={1} step={1} {...pct} defaultValue={0.08} onChange={setM('feather')} />
        </Section>
      )}
    </>
  );
}

function MaskGlyph({ id }) {
  const d = {
    none: 'M6 6l12 12',
    linear: 'M3 12h18M5 15h14v4H5z',
    mirror: 'M3 9h18M3 15h18M5 10.5h14v3H5z',
    circle: 'M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Z',
    rect: 'M5 7h14v10H5z',
    heart: 'M12 19s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 7 2.5C19 14.6 12 19 12 19Z',
    star: 'M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6Z',
  }[id];
  return (
    <svg className="anim-glyph" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ---------- seções da aba Vídeo ----------

export function BlendSection({ clip }) {
  const update = useUpdater(clip.id);
  const isMain = useStore((s) => s.project.tracks.find((t) => t.id === clip.trackId)?.main);
  return (
    <Section title="Mesclagem">
      <select className="font-select" value={clip.blend || 'normal'} onChange={(e) => update((c, v) => (v === 'normal' ? delete c.blend : (c.blend = v)))(e.target.value, 'set')} aria-label="Modo de mesclagem">
        {BLEND_MODES.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <p className="hint">{isMain ? 'A mesclagem combina este clipe com o que está embaixo dele. Use em clipes de sobreposição (trilhas acima da principal).' : 'Combina este clipe com o que está embaixo: "Tela" clareia (bom para fogo, luz), "Multiplicar" escurece (bom para texturas).'}</p>
    </Section>
  );
}

export function ChromaSection({ clip }) {
  const update = useUpdater(clip.id);
  const ch = { color: '#00ff00', similarity: 0.3, smooth: 0.1, ...clip.chroma };
  const picking = useStore((s) => s.pickColorFor === clip.id);
  const setC = (key) => update((c, v) => (c.chroma = { ...ch, ...c.chroma, [key]: v }));
  return (
    <Section title="Chroma key (fundo verde)" action={<Switch label="Ativar chroma key" checked={!!ch.on} onChange={(v) => setC('on')(v, 'set')} />}>
      <div className="chroma-row">
        <label className="swatch custom chroma-swatch" style={{ background: ch.color }} title="Escolher a cor do fundo">
          <input type="color" value={ch.color} onChange={(e) => setC('color')(e.target.value, 'set')} />
        </label>
        <button className={'secondary small' + (picking ? ' active-pick' : '')} onClick={() => useStore.setState({ pickColorFor: picking ? null : clip.id })}>
          <Icon name="eyedropper" size={15} /> {picking ? 'Clique no fundo no player…' : 'Pegar cor no player'}
        </button>
      </div>
      {ch.on && (
        <>
          <SliderField label="Intensidade" value={ch.similarity} min={0.01} max={1} step={1} {...pct} defaultValue={0.3} onChange={setC('similarity')} />
          <SliderField label="Suavizar borda" value={ch.smooth} min={0} max={0.5} step={1} {...pct} defaultValue={0.1} onChange={setC('smooth')} />
        </>
      )}
      <p className="hint">Remove a cor escolhida (geralmente o verde ou azul do fundo) para mostrar o que está na trilha de baixo. Coloque o vídeo com fundo verde numa trilha acima do fundo novo.</p>
    </Section>
  );
}
