import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { SliderField, Section } from './Fields.jsx';
import { LookCard, HueBar, TintWheel, pct } from './LooksSection.jsx';
import { LOOK_PARAMS, LOOK_TINTS } from '../looks';
import { CAMERAS, CAMERA_CATS, GLOW_LAYERS, OPTICS_PARAMS, NEUTRAL_CAMERA, cameraParams, describeCamera } from '../cameras';
import { setProjectFormat } from '../ops';
import { askText } from './DialogHost.jsx';

// "Minhas câmeras": receitas salvas pelo usuário (ficam neste computador).
const MY_KEY = 've.myCameras';
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

const colorParam = (key) => LOOK_PARAMS.find((q) => q[0] === key);

export default function CameraSection({ color, set, commit, update, thumb }) {
  const cam = color.camera || null;
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(loadMine);
  const myItem = cam && mine.find((m) => m.id === cam.id);
  const eff = useMemo(() => (cam ? cameraParams(cam) : NEUTRAL_CAMERA), [cam]);
  const base = useMemo(() => (cam ? (myItem ? { ...NEUTRAL_CAMERA, ...myItem.p } : cameraParams({ id: cam.id })) : NEUTRAL_CAMERA), [cam?.id, myItem]);
  const recipe = cam && (CAMERAS.find((c) => c.id === cam.id) || myItem);
  const modified = cam && JSON.stringify(cam.p || {}) !== JSON.stringify(myItem ? myItem.p : {});
  const intensity = cam?.intensity ?? 1;

  const pick = (c) => commit('camera', { id: c.id, intensity });
  const pickMine = (m) => commit('camera', { id: m.id, label: m.label, p: structuredClone(m.p), intensity });
  const reset = () => commit('camera', myItem ? { id: myItem.id, label: myItem.label, p: structuredClone(myItem.p), intensity } : { id: cam.id, intensity });
  const saveNow = async () => {
    const name = await askText({ title: 'Salvar como minha câmera', label: 'Nome', value: `Minha câmera ${mine.length + 1}`, ok: 'Salvar' });
    if (!name) return;
    const item = { id: 'mycam_' + Date.now().toString(36), label: name.slice(0, 30), p: structuredClone(eff) };
    const next = [...mine, item];
    setMine(next);
    saveMine(next);
    commit('camera', { id: item.id, label: item.label, p: structuredClone(item.p), intensity });
    setCat('mine');
    useStore.getState().notify(`Câmera "${item.label}" salva em "Minhas câmeras".`);
  };
  const removeMine = (id) => {
    const next = mine.filter((m) => m.id !== id);
    setMine(next);
    saveMine(next);
  };

  const shown = cat === 'mine' ? [] : cat === 'all' ? CAMERAS : CAMERAS.filter((c) => c.cat === cat);
  const P = (key) => set(`camera.p.${key}`);
  const slider = (key, label, min, max, extra = {}) => <SliderField key={key} label={label} value={eff[key]} min={min} max={max} step={1} {...pct} defaultValue={base[key]} onChange={P(key)} {...extra} />;
  const colorSlider = (key) => {
    const [, label, , min, max] = colorParam(key);
    return slider(key, label, min, max);
  };

  return (
    <Section title={`Câmeras e lentes (${CAMERAS.length})`} defaultOpen={false} meta={color.camera ? 'ativa' : null}>
      <p className="hint look-note">
        Emula a essência de câmeras e lentes: curva de tons do sensor ou da película, cor da pele, vinheta, aberração, halação, flare anamórfico e grão. Interpretações próprias, não cópias; tudo é editável.
      </p>
      <div className="filter-cats" role="tablist" aria-label="Categorias de câmera">
        {[...CAMERA_CATS, ['mine', 'Minhas câmeras']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={cat === id} className={'mask-chip' + (cat === id ? ' on' : '')} onClick={() => setCat(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="filter-grid">
        <LookCard label="Nenhuma" thumb={thumb} on={!cam} onClick={() => commit('camera', null)} />
        {shown.map((c) => (
          <LookCard key={c.id} label={c.label} title={`${c.maker} ${c.label}\n${c.desc}`} thumb={thumb} color={{ camera: { id: c.id, intensity: 1 } }} on={cam?.id === c.id} onClick={() => pick(c)} />
        ))}
        {cat === 'mine' &&
          mine.map((m) => (
            <LookCard key={m.id} label={m.label} thumb={thumb} color={{ camera: { id: m.id, p: m.p, intensity: 1 } }} on={cam?.id === m.id} onClick={() => pickMine(m)} onRemove={() => removeMine(m.id)} />
          ))}
      </div>
      {cat === 'mine' && !mine.length && <p className="hint">Personalize uma câmera e clique em "Salvar como minha câmera" para reutilizar.</p>}

      {cam && (
        <>
          <div className="look-info">
            <strong>{recipe?.label || 'Câmera'}</strong>
            {recipe?.maker && <span className="muted"> · {recipe.maker}</span>}
            {recipe?.desc && <p className="hint">{recipe.desc}</p>}
            {recipe?.tech && (
              <ul className="cam-tech">
                {recipe.tech.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            <div className="look-chips">
              {describeCamera({ id: cam.id, p: cam.p }).map((t) => (
                <span key={t} className="look-chip">
                  {t}
                </span>
              ))}
            </div>
            {recipe?.asp && (
              <div className="look-actions">
                <button className="secondary small" onClick={() => setProjectFormat({ aspect: recipe.asp })} title="Muda a proporção do projeto para a desta câmera">
                  <Icon name="crop" size={14} /> Usar proporção {recipe.asp}
                </button>
                <button className="secondary small" onClick={() => setProjectFormat({ fps: recipe.fps })} title="Muda a taxa de quadros do projeto">
                  Usar {recipe.fps} fps
                </button>
              </div>
            )}
          </div>
          <SliderField label="Intensidade da câmera" value={intensity} min={0} max={1.5} step={1} unit="%" {...pct} defaultValue={1} onChange={set('camera.intensity')} />
          <p className="hint">Controla a cor e a óptica juntas. Acima de 100% exagera as características da câmera.</p>

          <div className="look-actions">
            <button className="secondary small" onClick={() => setOpen(!open)} aria-expanded={open}>
              <span aria-hidden="true">{open ? '▾' : '▸'}</span> Personalizar esta câmera
            </button>
            <button className="link-btn" onClick={reset} disabled={!modified} title="Volta todos os controles para a receita original">
              <Icon name="reset" size={14} /> Restaurar receita
            </button>
            <button className="link-btn" onClick={saveNow} title="Guarda esta câmera, com seus ajustes, para usar em outros vídeos">
              <Icon name="save" size={14} /> Salvar como minha câmera
            </button>
          </div>

          {open && (
            <div className="look-adv">
              <div className="look-group">
                <h4>Curva do sensor</h4>
                <p className="hint">O ombro faz os realces chegarem ao branco devagar; o pé faz o preto sair devagar. É isso que dá o "caimento" de uma câmera de cinema.</p>
                {['ev', 'con', 'roll', 'toe', 'blk', 'wht', 'fade'].map(colorSlider)}
              </div>
              <div className="look-group">
                <h4>Cor</h4>
                {['sat', 'vib', 'temp', 'tint', 'skin'].map(colorSlider)}
              </div>
              <div className="look-group">
                <h4>Divisão de tons</h4>
                <div className="wheels">
                  {LOOK_TINTS.map(([k, label]) => (
                    <TintWheel
                      key={k}
                      label={label}
                      hue={eff[`${k}H`]}
                      amount={eff[`${k}A`]}
                      onChange={(v, phase) => update((col, val) => {
                        col.camera = { ...col.camera, p: { ...(col.camera?.p || {}), [`${k}H`]: val.hue, [`${k}A`]: val.amount } };
                      })(v, phase)}
                      onReset={() => update((col) => {
                        col.camera = { ...col.camera, p: { ...(col.camera?.p || {}), [`${k}H`]: base[`${k}H`], [`${k}A`]: base[`${k}A`] } };
                      })(null, 'set')}
                    />
                  ))}
                </div>
              </div>
              <div className="look-group">
                <h4>Lente</h4>
                {OPTICS_PARAMS.filter(([k]) => k !== 'grain').map(([key, label, min, max]) => slider(key, label, min, max))}
                <p className="hint">Maciez negativa = mais nítido (lentes modernas); positiva = mais suave (lentes antigas e anamórficas).</p>
              </div>
              {GLOW_LAYERS.map(([name, title]) => (
                <div className="look-group" key={name}>
                  <h4>{title}</h4>
                  {slider(name + 'A', 'Intensidade', 0, 1)}
                  {slider(name + 'T', 'Limiar (só luzes acima disso brilham)', 0.3, 0.95)}
                  {slider(name + 'S', 'Tamanho do brilho', 4, name === 'hal' ? 100 : 400, { toDisplay: (v) => v, fromDisplay: (v) => v, unit: ' px', step: 1 })}
                  <HueBar label="Cor do brilho" value={eff[name + 'H']} onChange={P(name + 'H')} onReset={() => P(name + 'H')(base[name + 'H'], 'set')} />
                  {slider(name + 'C', 'Saturação do brilho', 0, 1)}
                </div>
              ))}
              <div className="look-group">
                <h4>Sensor e película</h4>
                {OPTICS_PARAMS.filter(([k]) => k === 'grain').map(([key, label, min, max]) => slider(key, label, min, max))}
              </div>
              <p className="hint">Clique duas vezes no nome de um controle para voltar ao valor da receita. Depois da câmera ainda valem os Looks e todos os ajustes mais abaixo.</p>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
