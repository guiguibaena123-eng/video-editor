import { useEffect, useState } from 'react';
import { addSticker, addStickerFile, importStickers } from '../ops';
import { mediaUrl, useStore } from '../store';
import { Icon } from '../icons';
import { emojiUrl } from '../emojiImg';
import { GROUPS } from '../stickerGroups';

const MOTION = [
  ['none', 'Parado'],
  ['pulse', 'Pulsar'],
  ['sway', 'Balançar'],
  ['float', 'Flutuar'],
  ['shake', 'Tremer'],
];

// Adesivos: entram no cursor como uma camada própria; dá para mover, girar e animar como texto.
export default function StickersPanel() {
  const [motion, setMotion] = useState('pulse');
  const [mine, setMine] = useState(null);
  const [over, setOver] = useState(false);
  const refresh = () => window.api.stickersList().then(setMine, () => setMine([]));
  useEffect(() => {
    refresh();
  }, []);
  const doImport = async (paths) => {
    const added = await importStickers(paths);
    if (added.length) refresh();
  };
  const remove = async (e, file) => {
    e.stopPropagation();
    await window.api.stickersRemove(file);
    refresh();
    useStore.getState().notify('Adesivo removido da sua lista (o que já está no projeto continua).');
  };
  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
    if (paths.length) doImport(paths);
  };
  return (
    <div className="panel-scroll text-panel">
      <p className="hint tr-help">Clique num adesivo para colocá-lo no ponto do cursor. Arraste no player para mudar posição e tamanho.</p>
      <section
        className={'my-stickers' + (over ? ' over' : '')}
        onDragOver={(e) => {
          if ([...(e.dataTransfer?.types || [])].includes('Files')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <div className="my-stickers-head">
          <h3 className="panel-subtitle">Meus adesivos</h3>
          <button className="primary small" onClick={() => doImport()} title="Importar qualquer imagem, GIF animado, SVG ou vídeo">
            <Icon name="plus" size={14} /> Importar
          </button>
        </div>
        {mine && mine.length > 0 ? (
          <div className="sticker-grid mine">
            {mine.map((st) => (
              <div key={st.file} className="sticker-btn mine-item" role="button" tabIndex={0} onClick={() => addStickerFile(st.file)} onKeyDown={(e) => e.key === 'Enter' && addStickerFile(st.file)} title={st.name}>
                {st.video ? <video src={mediaUrl(st.file)} muted loop autoPlay playsInline /> : <img src={mediaUrl(st.file)} alt="" draggable={false} />}
                <button className="mine-remove" onClick={(e) => remove(e, st.file)} aria-label="Remover adesivo" title="Remover da lista">
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <button className="my-stickers-empty" onClick={() => doImport()}>
            <Icon name="plus" size={20} />
            <span>Importe seus adesivos</span>
            <small>Qualquer imagem, GIF animado, SVG ou vídeo. Arraste os arquivos para cá.</small>
          </button>
        )}
      </section>
      <div className="sticker-motion" role="radiogroup" aria-label="Movimento do adesivo">
        {MOTION.map(([id, label]) => (
          <button key={id} role="radio" aria-checked={motion === id} className={'mask-chip' + (motion === id ? ' on' : '')} onClick={() => setMotion(id)}>
            {label}
          </button>
        ))}
      </div>
      {GROUPS.map(([title, list]) => (
        <section key={title}>
          <h3 className="panel-subtitle">{title}</h3>
          <div className="sticker-grid">
            {list.map((e) => (
              <button key={e} className={'sticker-btn sk-' + motion} onClick={() => addSticker(e, motion)} title="Adicionar adesivo">
                {emojiUrl(e) ? <img src={emojiUrl(e)} alt={e} draggable={false} /> : <span>{e}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
