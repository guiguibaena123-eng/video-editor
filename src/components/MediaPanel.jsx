import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { addMediaToTimeline, importDialog, removeMedia } from '../ops';
import { fmtDuration, fmtBytes } from '../util';
import { askConfirm } from './DialogHost.jsx';

const FILTERS = [
  ['all', 'Tudo'],
  ['video', 'Vídeo'],
  ['audio', 'Áudio'],
  ['image', 'Imagem'],
];

export const MEDIA_DRAG_TYPE = 'application/x-video-editor-media';

export default function MediaPanel() {
  const media = useStore((s) => s.media);
  const cache = useStore((s) => s.cache);
  const clips = useStore((s) => s.project.clips);
  const [filter, setFilter] = useState('all');
  const used = useMemo(() => new Set(clips.map((c) => c.mediaId)), [clips]);
  const shown = filter === 'all' ? media : media.filter((m) => m.type === filter);

  return (
    <>
      {media.length > 0 && (
        <div className="chips" role="tablist">
          <button className="secondary small import-small" onClick={importDialog} title="Importar mídia (Ctrl+I)">
            <Icon name="import" size={15} /> Importar
          </button>
          {FILTERS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={'chip' + (filter === id ? ' on' : '')} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="panel-scroll">
        {media.length === 0 ? (
          <button className="empty-drop" onClick={importDialog}>
            <span className="empty-icon">
              <Icon name="import" size={26} />
            </span>
            <strong>Importe vídeos, áudios e imagens</strong>
            <span>Clique aqui ou arraste arquivos do computador para a janela.</span>
          </button>
        ) : shown.length === 0 ? (
          <p className="muted center pad">Nenhum item deste tipo.</p>
        ) : (
          <div className="media-grid">
            {shown.map((m) => (
              <MediaCard key={m.id} media={m} thumb={cache[m.id]?.thumbs?.frames?.[Math.min(1, (cache[m.id]?.thumbs?.frames?.length || 1) - 1)]} used={used.has(m.id)} proxy={cache[m.id]?.proxyState} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MediaCard({ media, thumb, used, proxy }) {
  const onDragStart = (e) => {
    e.dataTransfer.setData(MEDIA_DRAG_TYPE, media.id);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const info = [media.type === 'image' ? 'Imagem' : fmtDuration(media.duration), media.width ? `${media.width}×${media.height}` : null, fmtBytes(media.size)].filter(Boolean).join(' · ');
  return (
    <div className={'media-card' + (media.missing ? ' missing' : '')} draggable={!media.missing} onDragStart={onDragStart} onDoubleClick={() => !media.missing && addMediaToTimeline(media)} title={`${media.name}\n${info}`}>
      <div className="media-thumb">
        {media.type === 'audio' ? (
          <div className="audio-thumb">
            <Icon name="music" size={28} />
          </div>
        ) : thumb ? (
          <img src={thumb} alt="" draggable={false} />
        ) : (
          <div className="thumb-loading" />
        )}
        {media.type !== 'image' && <span className="badge">{fmtDuration(media.duration)}</span>}
        {proxy === 'working' && <span className="proxy-tag" title="Criando uma cópia leve para o player. A exportação usa o arquivo original.">Otimizando…</span>}
        {proxy === 'ready' && <span className="proxy-tag ready" title="O player usa uma cópia leve deste vídeo. A exportação usa o arquivo original.">Proxy</span>}
        {used && (
          <span className="used" title="Na linha do tempo">
            <Icon name="check" size={12} strokeWidth={3} />
          </span>
        )}
        {media.missing ? (
          <span className="missing-tag">
            <Icon name="warning" size={14} /> Arquivo ausente
          </span>
        ) : (
          <button className="add-btn" onClick={() => addMediaToTimeline(media)} title="Adicionar à linha do tempo" aria-label={`Adicionar ${media.name}`}>
            <Icon name="plus" size={16} strokeWidth={2.4} />
          </button>
        )}
        <button
          className="remove-btn"
          onClick={async () => {
            if (!used || (await askConfirm({ title: 'Remover esta mídia?', message: 'Ela está na linha do tempo: os clipes dela também serão removidos.', ok: 'Remover', danger: true }))) removeMedia(media.id);
          }}
          title="Remover do projeto"
          aria-label={`Remover ${media.name}`}
        >
          <Icon name="close" size={12} strokeWidth={2.4} />
        </button>
      </div>
      <div className="media-name">{media.name}</div>
    </div>
  );
}
