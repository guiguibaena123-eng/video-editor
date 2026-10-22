import { useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { TEMPLATES, applyTemplate } from '../templates';
import { importPaths } from '../ops';

const ASPECT_RATIO = { '16:9': '16 / 9', '9:16': '9 / 16', '1:1': '1 / 1', '4:3': '4 / 3', '3:4': '3 / 4', '4:5': '4 / 5', '21:9': '21 / 9' };

export default function TemplatesPanel() {
  const [template, setTemplate] = useState(null);
  return template ? <SlotAssign template={template} onBack={() => setTemplate(null)} /> : <Gallery onPick={setTemplate} />;
}

function Gallery({ onPick }) {
  return (
    <div className="panel-scroll text-panel">
      <p className="hint tr-help">
        <b>Como usar:</b> escolha um modelo, preencha as vagas com sua mídia (ou importe na hora) e clique em Criar projeto. Tudo — textos, transições e cor — já vem pronto; é só trocar depois o que quiser.
      </p>
      <div className="tpl-grid">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="tpl-card" onClick={() => onPick(t)}>
            <div className="tpl-thumb" style={{ aspectRatio: ASPECT_RATIO[t.aspect] }}>
              <span className="tpl-emoji">{t.icon}</span>
              <span className="tpl-aspect">{t.aspect}</span>
            </div>
            <strong>{t.label}</strong>
            <span className="muted">{t.desc}</span>
            <span className="muted tpl-slots">{t.slots.length} vagas de mídia</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SlotAssign({ template, onBack }) {
  const media = useStore((s) => s.media);
  const cache = useStore((s) => s.cache);
  const [picked, setPicked] = useState({}); // slotId -> media
  const [openSlot, setOpenSlot] = useState(null);
  const pool = media.filter((m) => m.type !== 'audio' && !m.missing);
  const ready = template.slots.every((s) => picked[s.id]);

  const assign = (slotId, m) => {
    setPicked((p) => ({ ...p, [slotId]: m }));
    setOpenSlot(null);
  };
  const importFor = async (slotId) => {
    const paths = await window.api.openMedia();
    if (!paths.length) return;
    const added = await importPaths(paths);
    const first = added.find((m) => m.type !== 'audio');
    if (first) assign(slotId, first);
    else useStore.getState().notify('Escolha um vídeo ou uma imagem para esta vaga.');
  };

  return (
    <div className="panel-scroll text-panel">
      <button className="link-btn tpl-back" onClick={onBack}>
        <Icon name="undo" size={14} /> Modelos
      </button>
      <div className="clip-head">
        <div className="clip-head-thumb tpl-head-thumb">{template.icon}</div>
        <div className="clip-head-text">
          <strong>{template.label}</strong>
          <span className="muted">{template.aspect} · {template.desc}</span>
        </div>
      </div>
      {template.slots.map((slot) => (
        <div key={slot.id} className="tpl-slot">
          <button className="tpl-slot-thumb" onClick={() => setOpenSlot(openSlot === slot.id ? null : slot.id)} aria-expanded={openSlot === slot.id}>
            {picked[slot.id] ? (
              cache[picked[slot.id].id]?.thumbs?.frames?.[0] ? (
                <img src={cache[picked[slot.id].id].thumbs.frames[0]} alt="" />
              ) : (
                <Icon name={picked[slot.id].type === 'image' ? 'image' : 'film'} size={20} />
              )
            ) : (
              <Icon name="plus" size={18} />
            )}
          </button>
          <div className="tpl-slot-info">
            <strong>{slot.label}</strong>
            <span className="muted">{picked[slot.id] ? picked[slot.id].name : `Escolha um clipe de ~${slot.dur}s`}</span>
          </div>
        </div>
      ))}
      {openSlot && (
        <div className="tpl-picker">
          <button className="secondary small" onClick={() => importFor(openSlot)}>
            <Icon name="import" size={14} /> Importar novo arquivo
          </button>
          {pool.length > 0 && (
            <div className="media-grid tpl-pick-grid">
              {pool.map((m) => (
                <button key={m.id} className="tpl-pick-item" onClick={() => assign(openSlot, m)} title={m.name}>
                  {cache[m.id]?.thumbs?.frames?.[0] ? <img src={cache[m.id].thumbs.frames[0]} alt="" /> : <Icon name={m.type === 'image' ? 'image' : 'film'} size={18} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="button-row pad">
        <button className="primary" disabled={!ready} onClick={() => applyTemplate(template, Object.fromEntries(template.slots.map((s) => [s.id, picked[s.id]])))}>
          <Icon name="check" size={16} /> Criar projeto
        </button>
      </div>
      {!ready && <p className="hint pad">Preencha todas as vagas para criar o projeto.</p>}
    </div>
  );
}
