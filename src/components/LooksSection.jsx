import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { SliderField, Section } from './Fields.jsx';
import { LOOKS, LOOK_CATS, LOOK_PARAMS, LOOK_TINTS, NEUTRAL, lookParams, describeLook, oklchCss } from '../looks';
import { buildLut, sampleCube } from '../color';
import { dragPointer } from '../util';
import { askText } from './DialogHost.jsx';

// "Meus looks": receitas salvas pelo usuário (ficam neste computador).
const MY_KEY = 've.myLooks';
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

export const pct = { toDisplay: (x) => x * 100, fromDisplay: (x) => x / 100 };
const HUE_STOPS = Array.from({ length: 13 }, (_, i) => oklchCss(0.74, 0.13, i * 30));

// Miniaturas: uma LUT pequena (17³) por look, guardada para não refazer a conta a cada abertura.
const thumbLuts = new Map();
export function thumbLut(color) {
  const key = JSON.stringify(color);
  let l = thumbLuts.get(key);
  if (!l) {
    l = { size: 17, data: buildLut(color, null, 17), min: [0, 0, 0], max: [1, 1, 1] };
    thumbLuts.set(key, l);
    if (thumbLuts.size > 80) thumbLuts.delete(thumbLuts.keys().next().value);
  }
  return l;
}

export default function LooksSection({ color, set, commit, update, thumb }) {
  const look = color.look || null;
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(loadMine);
  const myItem = look && mine.find((m) => m.id === look.id);
  const eff = useMemo(() => (look ? lookParams(look) : NEUTRAL), [look]);
  const base = useMemo(() => (look ? (myItem ? { ...NEUTRAL, ...myItem.p } : lookParams({ id: look.id })) : NEUTRAL), [look?.id, myItem]);
  const recipe = look && (LOOKS.find((l) => l.id === look.id) || myItem);
  const modified = look && JSON.stringify(look.p || {}) !== JSON.stringify(myItem ? myItem.p : {});

  const intensity = look?.intensity ?? 1;
  const pick = (l) => commit('look', { id: l.id, intensity });
  const pickMine = (m) => commit('look', { id: m.id, label: m.label, p: structuredClone(m.p), intensity });
  const reset = () => commit('look', myItem ? { id: myItem.id, label: myItem.label, p: structuredClone(myItem.p), intensity } : { id: look.id, intensity });

  const saveNow = async () => {
    const name = await askText({ title: 'Salvar como meu look', label: 'Nome', value: `Meu look ${mine.length + 1}`, ok: 'Salvar' });
    if (!name) return;
    const full = structuredClone(eff);
    const item = { id: 'my_' + Date.now().toString(36), label: name.slice(0, 30), p: full };
    const next = [...mine, item];
    setMine(next);
    saveMine(next);
    commit('look', { id: item.id, label: item.label, p: structuredClone(full), intensity });
    setCat('mine');
    useStore.getState().notify(`Look "${item.label}" salvo em "Meus looks".`);
  };
  const removeMine = (id) => {
    const next = mine.filter((m) => m.id !== id);
    setMine(next);
    saveMine(next);
  };

  const shown = cat === 'mine' ? [] : cat === 'all' ? LOOKS : LOOKS.filter((l) => l.cat === cat);
  const P = (key) => set(`look.p.${key}`);

  return (
    <Section title={`Looks de cinema (${LOOKS.length})`} defaultOpen={false} meta={color.look ? 'ativo' : null}>
      <p className="hint look-note">Cores inspiradas no visual de filmes famosos. São receitas editáveis feitas por nós, não cópias oficiais. Escolha um, ajuste a intensidade e personalize tudo.</p>
      <div className="filter-cats" role="tablist" aria-label="Categorias de look">
        {[...LOOK_CATS, ['mine', 'Meus looks']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={cat === id} className={'mask-chip' + (cat === id ? ' on' : '')} onClick={() => setCat(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="filter-grid">
        <LookCard label="Nenhum" thumb={thumb} on={!look} onClick={() => commit('look', null)} />
        {shown.map((l) => (
          <LookCard key={l.id} label={l.label} title={`${l.film}\n${l.desc}`} thumb={thumb} look={{ id: l.id }} on={look?.id === l.id} onClick={() => pick(l)} />
        ))}
        {cat === 'mine' &&
          mine.map((m) => (
            <LookCard key={m.id} label={m.label} thumb={thumb} look={{ id: m.id, p: m.p }} on={look?.id === m.id} onClick={() => pickMine(m)} onRemove={() => removeMine(m.id)} />
          ))}
      </div>
      {cat === 'mine' && !mine.length && <p className="hint">Personalize um look e clique em "Salvar como meu look" para reutilizar em outros vídeos.</p>}

      {look && (
        <>
          <div className="look-info">
            <strong>{recipe?.label || 'Look'}</strong>
            {recipe?.film && <span className="muted"> · {recipe.film}</span>}
            {recipe?.desc && <p className="hint">{recipe.desc}</p>}
            <div className="look-chips">
              {describeLook({ id: look.id, p: look.p }).map((t) => (
                <span key={t} className="look-chip">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <SliderField label="Intensidade do look" value={intensity} min={0} max={1.5} step={1} unit="%" {...pct} defaultValue={1} onChange={set('look.intensity')} />
          <p className="hint">Acima de 100% exagera o efeito além da receita original.</p>

          <div className="look-actions">
            <button className="secondary small" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span aria-hidden="true">{open ? '▾' : '▸'}</span> Personalizar este look
            </button>
            <button className="link-btn" onClick={reset} disabled={!modified} title="Volta todos os controles para a receita original">
              <Icon name="reset" size={14} /> Restaurar receita
            </button>
            <button className="link-btn" onClick={saveNow} title="Guarda este look, com seus ajustes, para usar em outros vídeos">
              <Icon name="save" size={14} /> Salvar como meu look
            </button>
          </div>

          {open && (
            <div className="look-adv">
              {[
                ['light', 'Luz'],
                ['color', 'Cor'],
              ].map(([group, title]) => (
                <div key={group} className="look-group">
                  <h4>{title}</h4>
                  {LOOK_PARAMS.filter((q) => q[2] === group).map(([key, label, , min, max]) => (
                    <SliderField key={key} label={label} value={eff[key]} min={min} max={max} step={1} {...pct} defaultValue={base[key]} onChange={P(key)} />
                  ))}
                </div>
              ))}

              <div className="look-group">
                <h4>Divisão de tons</h4>
                <p className="hint">Pinta separadamente as sombras, os meios-tons e os realces. Arraste o ponto: o ângulo é a cor e a distância do centro é a força.</p>
                <div className="wheels">
                  {LOOK_TINTS.map(([k, label]) => (
                    <TintWheel
                      key={k}
                      label={label}
                      hue={eff[`${k}H`]}
                      amount={eff[`${k}A`]}
                      onChange={(v, phase) => update((col, val) => {
                        col.look = { ...col.look, p: { ...(col.look?.p || {}), [`${k}H`]: val.hue, [`${k}A`]: val.amount } };
                      })(v, phase)}
                      onReset={() => update((col) => {
                        col.look = { ...col.look, p: { ...(col.look?.p || {}), [`${k}H`]: base[`${k}H`], [`${k}A`]: base[`${k}A`] } };
                      })(null, 'set')}
                    />
                  ))}
                </div>
                {LOOK_PARAMS.filter((q) => q[2] === 'tone').map(([key, label, , min, max]) => (
                  <SliderField key={key} label={label} value={eff[key]} min={min} max={max} step={1} {...pct} defaultValue={base[key]} onChange={P(key)} />
                ))}
              </div>

              <div className="look-group">
                <h4>Película e preto e branco</h4>
                {LOOK_PARAMS.filter((q) => q[2] === 'film' && q[0] !== 'vig').map(([key, label, , min, max]) => (
                  <SliderField key={key} label={label} value={eff[key]} min={min} max={max} step={1} {...pct} defaultValue={base[key]} onChange={P(key)} />
                ))}
                {eff.mono > 0 && (
                  <>
                    <p className="hint">Mistura dos canais no P&B: é como usar um filtro de cor na lente (vermelho escurece o céu; verde clareia plantas).</p>
                    {['Vermelho', 'Verde', 'Azul'].map((name, i) => (
                      <SliderField
                        key={name}
                        label={`Filtro ${name.toLowerCase()}`}
                        value={eff.monoW[i]}
                        min={0}
                        max={1}
                        step={1}
                        {...pct}
                        defaultValue={base.monoW[i]}
                        onChange={update((col, v) => {
                          const w = [...(lookParams(col.look).monoW || NEUTRAL.monoW)];
                          w[i] = v;
                          col.look = { ...col.look, p: { ...(col.look?.p || {}), monoW: w } };
                        })}
                      />
                    ))}
                  </>
                )}
                {eff.keep > 0 && eff.mono > 0 && <HueBar label="Cor mantida" value={eff.keepH} onChange={P('keepH')} onReset={() => P('keepH')(base.keepH, 'set')} />}
              </div>

              <div className="look-group">
                <h4>Vinheta</h4>
                {LOOK_PARAMS.filter((q) => q[0] === 'vig').map(([key, label, , min, max]) => (
                  <SliderField key={key} label={label} value={eff[key]} min={min} max={max} step={1} {...pct} defaultValue={base[key]} onChange={P(key)} />
                ))}
              </div>
              <p className="hint">Clique duas vezes no nome de um controle para voltar ao valor da receita. Depois do look ainda valem todos os ajustes, HSL, curvas e rodas mais abaixo.</p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// Miniatura do próprio clipe com o look aplicado.
export function LookCard({ label, title, thumb, look, color: colorProp, on, onClick, onRemove }) {
  const ref = useRef(null);
  const color = colorProp || (look ? { look: { ...look, intensity: 1 } } : null);
  const key = color ? JSON.stringify(color) : '';
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
      if (!color) return;
      const lut = thumbLut(color);
      const d = g.getImageData(0, 0, W, H);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const [r, gg, b] = sampleCube(lut, px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
        px[i] = r * 255;
        px[i + 1] = gg * 255;
        px[i + 2] = b * 255;
      }
      g.putImageData(d, 0, 0);
    };
    img.src = thumb;
  }, [thumb, key]);
  return (
    <span className="filter-wrap">
      <button className={'filter-card' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on} title={title}>
        <span className="filter-thumb">{thumb ? <canvas ref={ref} /> : <span className="filter-placeholder" />}</span>
        <span>{label}</span>
      </button>
      {onRemove && (
        <button className="filter-remove" onClick={onRemove} title="Apagar este look" aria-label={`Apagar ${label}`}>
          <Icon name="close" size={11} />
        </button>
      )}
    </span>
  );
}

// Barra com o arco-íris do OKLCh: arrastar escolhe o matiz (0–360°).
export function HueBar({ label, value, onChange, onReset }) {
  const dragging = useRef(false);
  return (
    <div className="field slider-field">
      <div className="field-top">
        <label onDoubleClick={onReset} title="Clique duas vezes para restaurar">
          {label}
        </label>
        <span className="spacer" />
        <span className="muted">{Math.round(value)}°</span>
      </div>
      <input
        type="range"
        className="hue-range"
        min={0}
        max={360}
        step={1}
        value={value}
        aria-label={label}
        style={{ '--hue-grad': `linear-gradient(90deg, ${HUE_STOPS.join(',')})` }}
        onPointerDown={() => {
          dragging.current = true;
          onChange(value, 'start');
          const up = () => {
            window.removeEventListener('pointerup', up);
            dragging.current = false;
            onChange(null, 'end');
          };
          window.addEventListener('pointerup', up);
        }}
        onChange={(e) => onChange(Number(e.target.value), dragging.current ? 'live' : 'set')}
      />
    </div>
  );
}

// Roda de cor da divisão de tons: ângulo = matiz (OKLCh), distância do centro = força.
export function TintWheel({ label, hue, amount, onChange, onReset }) {
  const ref = useRef(null);
  const rad = (hue * Math.PI) / 180;
  const px = 50 + Math.sin(rad) * amount * 46;
  const py = 50 - Math.cos(rad) * amount * 46;
  const bg = `radial-gradient(circle, rgba(140,140,140,1) 0%, rgba(140,140,140,0) 72%), conic-gradient(${HUE_STOPS.join(',')})`;
  const start = (e) => {
    onChange({ hue, amount }, 'start');
    const move = (ev) => {
      const r = ref.current.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const amt = Math.min(1, Math.hypot(dx, dy));
      const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      onChange({ hue: Math.round(h), amount: Math.round(amt * 100) / 100 }, 'live');
    };
    move(e);
    dragPointer(e, move, () => onChange(null, 'end'));
  };
  return (
    <div className="wheel">
      <div className="wheel-disc" ref={ref} onPointerDown={start} onDoubleClick={onReset} style={{ background: bg }} title={`${label}: arraste para escolher a cor`}>
        <span className="wheel-point" style={{ left: `${px}%`, top: `${py}%` }} />
      </div>
      <span className="wheel-label">
        {label} · {Math.round(amount * 100)}%
      </span>
    </div>
  );
}
