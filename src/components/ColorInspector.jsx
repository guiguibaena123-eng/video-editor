import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { SliderField, Section } from './Fields.jsx';
import { FILTERS, FILTER_CATS, ADJUSTMENTS, HSL_BANDS, colorFunction, curveTable, hasColor, hasSpatial } from '../color';
import { dragPointer, clamp } from '../util';
import { cleanError } from '../ops';
import LooksSection from './LooksSection.jsx';
import CameraSection from './CameraSection.jsx';
import { askText } from './DialogHost.jsx';

// Atualiza a cor do clipe; arrastar slider conta como um só passo de desfazer.
function useColorUpdater(clipId) {
  return (mutate) => (value, phase) => {
    const s = useStore.getState();
    const apply = (p) => {
      const c = p.clips.find((x) => x.id === clipId);
      if (!c) return;
      c.color = structuredClone(c.color || {});
      mutate(c.color, value);
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
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

const RANGES = { exposure: [-2, 2], fade: [0, 1] };

// "Meus filtros": cores salvas pelo usuário (ficam neste computador).
const MY_KEY = 've.myFilters';
function loadMine() {
  try {
    const v = JSON.parse(localStorage.getItem(MY_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveMine(list) {
  try {
    localStorage.setItem(MY_KEY, JSON.stringify(list));
  } catch {}
}
// Parte da cor que vira filtro (ajustes, HSL, curvas, rodas). Filtro/LUT/vinheta/nitidez ficam de fora.
function adjustPart(color) {
  const out = {};
  for (const [k] of ADJUSTMENTS) if (color[k]) out[k] = color[k];
  for (const k of ['hsl', 'curves', 'wheels']) if (color[k]) out[k] = structuredClone(color[k]);
  return out;
}

export default function ColorInspector({ clip, media }) {
  const update = useColorUpdater(clip.id);
  const color = clip.color || {};
  const set = (path) => update((col, v) => setPath(col, path, v));
  const commit = (path, v) => set(path)(v, 'set');
  const thumb = useStore((s) => {
    const fr = s.cache[clip.mediaId]?.thumbs?.frames;
    return fr ? fr[Math.floor(fr.length / 2)] : null;
  });
  const changed = hasColor(color) || hasSpatial(color);

  const [cat, setCat] = useState('all');
  const [mine, setMine] = useState(loadMine);
  const clipboard = useStore((s) => s.colorClipboard);
  const copy = () => {
    useStore.setState({ colorClipboard: structuredClone(color) });
    useStore.getState().notify('Cor copiada. Selecione outro clipe e clique em "Colar cor".');
  };
  const paste = () => update((col) => {
    Object.keys(col).forEach((k) => delete col[k]);
    Object.assign(col, structuredClone(clipboard));
  })(null, 'set');
  const saveMineNow = async () => {
    const s = adjustPart(color);
    if (!Object.keys(s).length) {
      useStore.getState().notify('Faça algum ajuste de cor antes de salvar um filtro.');
      return;
    }
    const label = await askText({ title: 'Salvar como meu filtro', label: 'Nome', value: `Meu filtro ${mine.length + 1}`, ok: 'Salvar' });
    if (!label) return;
    const next = [...mine, { id: 'my_' + Date.now().toString(36), label: label.slice(0, 30), s }];
    setMine(next);
    saveMine(next);
    setCat('mine');
    useStore.getState().notify(`Filtro "${label}" salvo. Ele aparece em "Meus filtros".`);
  };
  const removeMine = (id) => {
    const next = mine.filter((f) => f.id !== id);
    setMine(next);
    saveMine(next);
  };
  const shown = cat === 'mine' ? mine : cat === 'all' ? FILTERS : FILTERS.filter((f) => f.cat === cat);
  const pick = (f) => commit('filter', f.id.startsWith('my_') ? { id: f.id, label: f.label, s: structuredClone(f.s), intensity: color.filter?.intensity ?? 1 } : { id: f.id, intensity: color.filter?.intensity ?? 1 });

  const resetAll = () => update((col) => Object.keys(col).forEach((k) => delete col[k]))(null, 'set');
  const applyToAll = () => {
    const visual = new Set(useStore.getState().media.filter((m) => m.type !== 'audio').map((m) => m.id));
    useStore.getState().commit((p) => {
      for (const c of p.clips) if (visual.has(c.mediaId) && !c.kind) c.color = structuredClone(color);
    });
    useStore.getState().notify('Cor aplicada em todos os vídeos e imagens.');
  };

  return (
    <>
      <div className="color-actions">
        <button
          className="secondary small"
          disabled={!changed}
          onPointerDown={() => useStore.setState({ compareOriginal: true })}
          onPointerUp={() => useStore.setState({ compareOriginal: false })}
          onPointerLeave={() => useStore.setState({ compareOriginal: false })}
          title="Segure para ver o vídeo sem a cor (comparar com o original)"
        >
          <Icon name="eye" size={15} /> Original
        </button>
        <button className="secondary small" onClick={applyToAll} disabled={!changed} title="Aplicar esta cor em todos os vídeos e imagens">
          Em todos
        </button>
        <button className="secondary small" onClick={copy} disabled={!changed} title="Copia toda a cor deste clipe">
          <Icon name="duplicate" size={15} /> Copiar
        </button>
        <button className="secondary small" onClick={paste} disabled={!clipboard} title="Usa neste clipe a cor copiada">
          Colar
        </button>
        <button className="icon-btn" onClick={resetAll} disabled={!changed} title="Restaurar toda a cor deste clipe" aria-label="Restaurar cor">
          <Icon name="reset" size={15} />
        </button>
      </div>

      <Section title={`Filtros (${FILTERS.length})`} defaultOpen={false} meta={color.filter ? 'ativo' : null}>
        <div className="filter-cats" role="tablist" aria-label="Categorias de filtro">
          {[...FILTER_CATS, ['mine', 'Meus filtros']].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={cat === id} className={'mask-chip' + (cat === id ? ' on' : '')} onClick={() => setCat(id)}>
              {label}
            </button>
          ))}
        </div>
        <div className="filter-grid">
          <FilterCard label="Nenhum" thumb={thumb} on={!color.filter} onClick={() => commit('filter', null)} />
          {shown.map((f) => (
            <FilterCard key={f.id} label={f.label} thumb={thumb} filter={f} on={color.filter?.id === f.id} onClick={() => pick(f)} onRemove={cat === 'mine' ? () => removeMine(f.id) : null} />
          ))}
        </div>
        {cat === 'mine' && !mine.length && <p className="hint">Ajuste a cor do jeito que gostar e clique em "Salvar como meu filtro" para usar de novo em outros vídeos.</p>}
        <button className="link-btn" onClick={saveMineNow} title="Guarda os ajustes, HSL, curvas e rodas atuais como um filtro seu">
          <Icon name="save" size={14} /> Salvar como meu filtro
        </button>
        {color.filter && (
          <SliderField label="Intensidade" value={color.filter.intensity ?? 1} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={set('filter.intensity')} />
        )}
      </Section>

      <LooksSection color={color} set={set} commit={commit} update={update} thumb={thumb} />

      <CameraSection color={color} set={set} commit={commit} update={update} thumb={thumb} />

      {[
        ['light', 'Ajustes: luz'],
        ['color', 'Ajustes: cor'],
      ].map(([group, title]) => (
        <Section key={group} title={title}>
          {ADJUSTMENTS.filter((a) => a[2] === group).map(([key, label]) => {
            const [min, max] = RANGES[key] || [-1, 1];
            return <SliderField key={key} label={label} value={color[key] || 0} min={min} max={max} step={1} toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={0} onChange={set(key)} />;
          })}
          {group === 'light' && <p className="hint">Clique duas vezes no nome de um ajuste para zerar.</p>}
        </Section>
      ))}

      <HslSection color={color} set={set} />
      <CurvesSection color={color} set={set} commit={commit} />
      <WheelsSection color={color} set={set} commit={commit} />

      <Section title="Efeitos">
        <SliderField label="Vinheta" value={color.vignette || 0} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={0} onChange={set('vignette')} />
        <SliderField label="Nitidez" value={color.sharpen || 0} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={0} onChange={set('sharpen')} />
      </Section>

      <LutSection color={color} set={set} commit={commit} />
    </>
  );
}

// Miniatura do próprio clipe com o filtro aplicado (mesma função de cor da prévia).
function FilterCard({ label, thumb, filter, on, onClick, onRemove }) {
  const filterId = filter?.id;
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !thumb) return;
    const img = new Image();
    img.onload = () => {
      const W = 120;
      const H = Math.round((W * img.height) / img.width) || 68;
      c.width = W;
      c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      if (!filterId) return;
      const fn = colorFunction({ filter: { ...filter, intensity: 1 } }, null);
      const d = g.getImageData(0, 0, W, H);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const [r, gg, b] = fn(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
        px[i] = r * 255;
        px[i + 1] = gg * 255;
        px[i + 2] = b * 255;
      }
      g.putImageData(d, 0, 0);
    };
    img.src = thumb;
  }, [thumb, filterId]);
  return (
    <span className="filter-wrap">
      <button className={'filter-card' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on}>
        <span className="filter-thumb">{thumb ? <canvas ref={ref} /> : <span className="filter-placeholder" />}</span>
        <span>{label}</span>
      </button>
      {onRemove && (
        <button className="filter-remove" onClick={onRemove} title="Apagar este filtro" aria-label={`Apagar ${label}`}>
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

function HslSection({ color, set }) {
  const [band, setBand] = useState('red');
  const v = color.hsl?.[band] || {};
  const pct = { toDisplay: (x) => x * 100, fromDisplay: (x) => x / 100 };
  return (
    <Section title="HSL (por cor)" defaultOpen={false}>
      <div className="hsl-dots" role="radiogroup" aria-label="Cor">
        {HSL_BANDS.map(([id, label, , hex]) => {
          const used = color.hsl?.[id] && (color.hsl[id].h || color.hsl[id].s || color.hsl[id].l);
          return (
            <button key={id} role="radio" aria-checked={band === id} className={'hsl-dot' + (band === id ? ' on' : '') + (used ? ' used' : '')} style={{ background: hex }} onClick={() => setBand(id)} title={label} aria-label={label} />
          );
        })}
      </div>
      <p className="hint">{HSL_BANDS.find((b) => b[0] === band)[1]}: muda só os tons dessa cor no vídeo.</p>
      <SliderField label="Matiz" value={v.h || 0} min={-1} max={1} step={1} {...pct} defaultValue={0} onChange={set(`hsl.${band}.h`)} />
      <SliderField label="Saturação" value={v.s || 0} min={-1} max={1} step={1} {...pct} defaultValue={0} onChange={set(`hsl.${band}.s`)} />
      <SliderField label="Luminosidade" value={v.l || 0} min={-1} max={1} step={1} {...pct} defaultValue={0} onChange={set(`hsl.${band}.l`)} />
    </Section>
  );
}

const CHANNELS = [
  ['master', 'Geral', '#e9e9ee'],
  ['r', 'Vermelho', '#ff5a52'],
  ['g', 'Verde', '#3fd18f'],
  ['b', 'Azul', '#4c9bff'],
];
const DEFAULT_CURVE = [
  [0, 0],
  [1, 1],
];

function CurvesSection({ color, set, commit }) {
  const [ch, setCh] = useState('master');
  const points = color.curves?.[ch] || DEFAULT_CURVE;
  const ref = useRef(null);
  const S = 200;
  const stroke = CHANNELS.find((c) => c[0] === ch)[2];
  const table = curveTable(points);
  let d = '';
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    d += `${i ? 'L' : 'M'}${(x * S).toFixed(1)} ${((1 - clamp(table[Math.round(x * 255)], 0, 1)) * S).toFixed(1)}`;
  }
  const toLocal = (e) => {
    const r = ref.current.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width, 0, 1), clamp(1 - (e.clientY - r.top) / r.height, 0, 1)];
  };
  const startDrag = (e, idx) => {
    e.stopPropagation();
    set(`curves.${ch}`)(null, 'start');
    const last = points.length - 1;
    dragPointer(
      e,
      (ev) => {
        const [x, y] = toLocal(ev);
        const next = points.map((p) => [...p]);
        const nx = idx === 0 ? 0 : idx === last ? 1 : clamp(x, next[idx - 1][0] + 0.02, next[idx + 1][0] - 0.02);
        next[idx] = [Math.round(nx * 1000) / 1000, Math.round(y * 1000) / 1000];
        set(`curves.${ch}`)(next, 'live');
      },
      () => set(`curves.${ch}`)(null, 'end'),
    );
  };
  const add = (e) => {
    const [x, y] = toLocal(e);
    if (x < 0.03 || x > 0.97) return;
    commit(`curves.${ch}`, [...points.map((p) => [...p]), [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]].sort((a, b) => a[0] - b[0]));
  };
  const remove = (e, i) => {
    e.stopPropagation();
    if (i === 0 || i === points.length - 1) return;
    commit(`curves.${ch}`, points.filter((_, j) => j !== i));
  };
  return (
    <Section
      title="Curvas"
      defaultOpen={false}
      action={
        <button className="link-btn" onClick={() => commit(`curves.${ch}`, DEFAULT_CURVE)}>
          <Icon name="reset" size={14} /> Restaurar
        </button>
      }
    >
      <div className="seg curve-tabs">
        {CHANNELS.map(([id, label, c]) => (
          <button key={id} className={ch === id ? 'on' : ''} onClick={() => setCh(id)} aria-pressed={ch === id}>
            <span className="ch-dot" style={{ background: c }} /> {label}
          </button>
        ))}
      </div>
      <div className="curves-box">
        <svg ref={ref} viewBox={`0 0 ${S} ${S}`} onDoubleClick={add} role="img" aria-label="Curva de cor">
          {[0.25, 0.5, 0.75].map((g) => (
            <g key={g}>
              <line x1={g * S} x2={g * S} y1="0" y2={S} className="curve-grid-line" />
              <line y1={g * S} y2={g * S} x1="0" x2={S} className="curve-grid-line" />
            </g>
          ))}
          <line x1="0" y1={S} x2={S} y2="0" className="curve-one" />
          <path d={d} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map(([x, y], i) => (
          <span key={i} className="curve-point" style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%`, borderColor: stroke }} onPointerDown={(e) => startDrag(e, i)} onDoubleClick={(e) => remove(e, i)} />
        ))}
      </div>
      <p className="hint">Puxe para cima para clarear, para baixo para escurecer. Clique duas vezes para criar um ponto e duas vezes num ponto para apagá-lo. Uma curva em "S" aumenta o contraste.</p>
    </Section>
  );
}

const WHEELS = [
  ['shadows', 'Sombras'],
  ['midtones', 'Meios-tons'],
  ['highlights', 'Realces'],
  ['global', 'Geral'],
];

function WheelsSection({ color, set, commit }) {
  return (
    <Section title="Rodas de cor" defaultOpen={false}>
      <div className="wheels">
        {WHEELS.map(([id, label]) => (
          <Wheel key={id} label={label} value={color.wheels?.[id] || {}} onChange={set(`wheels.${id}`)} onReset={() => commit(`wheels.${id}`, {})} />
        ))}
      </div>
      <p className="hint">Arraste o ponto na direção da cor para puxar aquela parte da imagem para esse tom. Clique duas vezes na roda para zerar.</p>
    </Section>
  );
}

function Wheel({ label, value, onChange, onReset }) {
  const ref = useRef(null);
  const hue = value.hue || 0;
  const amount = value.amount || 0;
  const rad = (hue * Math.PI) / 180;
  // Mesmo círculo de cores do HSL: 0° vermelho no topo, girando no sentido horário.
  const px = 50 + Math.sin(rad) * amount * 46;
  const py = 50 - Math.cos(rad) * amount * 46;
  const start = (e) => {
    onChange(value, 'start');
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const amt = Math.min(1, Math.hypot(dx, dy));
      const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      onChange({ ...value, hue: Math.round(h), amount: Math.round(amt * 100) / 100 }, 'live');
    };
    move(e);
    dragPointer(e, move, () => onChange(null, 'end'));
  };
  return (
    <div className="wheel">
      <div className="wheel-disc" ref={ref} onPointerDown={start} onDoubleClick={onReset} title={`${label}: arraste para escolher a cor`}>
        <span className="wheel-point" style={{ left: `${px}%`, top: `${py}%` }} />
      </div>
      <span className="wheel-label">{label}</span>
      <input
        type="range"
        min={-100}
        max={100}
        value={Math.round((value.lum || 0) * 100)}
        onPointerDown={() => onChange(value, 'start')}
        onPointerUp={() => onChange(null, 'end')}
        onChange={(e) => onChange({ ...value, lum: Number(e.target.value) / 100 }, 'live')}
        aria-label={`${label}: luminosidade`}
        title="Luminosidade"
        style={{ '--fill': `${((value.lum || 0) + 1) * 50}%` }}
      />
    </div>
  );
}

function LutSection({ color, set, commit }) {
  const status = useStore((s) => (color.lut ? s.lutFiles[color.lut.path] : null));
  const importLut = async () => {
    try {
      const r = await window.api.openLut();
      if (r) commit('lut', { path: r.path, name: r.name, intensity: 1 });
    } catch (err) {
      useStore.getState().notify('Não foi possível abrir a LUT: ' + cleanError(err), 'error');
    }
  };
  return (
    <Section title="LUT" defaultOpen={false} meta={color.lut ? 'ativa' : null}>
      {color.lut ? (
        <>
          <div className="lut-row">
            <Icon name="file" size={16} />
            <span className="lut-name" title={color.lut.path}>
              {color.lut.name}
            </span>
            <button className="link-btn" onClick={() => commit('lut', null)}>
              <Icon name="close" size={13} /> Remover
            </button>
          </div>
          {status?.error && <p className="hint warn">{status.error}</p>}
          <SliderField label="Intensidade" value={color.lut.intensity ?? 1} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={set('lut.intensity')} />
        </>
      ) : (
        <>
          <button className="secondary small" onClick={importLut}>
            <Icon name="import" size={15} /> Importar LUT (.cube)
          </button>
          <p className="hint">LUTs são "receitas de cor" prontas usadas por editores e câmeras (arquivos .cube).</p>
        </>
      )}
    </Section>
  );
}
