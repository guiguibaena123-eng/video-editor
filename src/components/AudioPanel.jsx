import { useMemo } from 'react';
import { useStore } from '../store';
import { Icon } from '../icons';
import { addMediaToTimeline, importDialog } from '../ops';
import { fmtDuration } from '../util';
import { MEDIA_DRAG_TYPE } from './MediaPanel.jsx';

export default function AudioPanel() {
  const media = useStore((s) => s.media);
  const clips = useStore((s) => s.project.clips);
  const audios = useMemo(() => media.filter((m) => m.type === 'audio'), [media]);
  const used = useMemo(() => new Set(clips.map((c) => c.mediaId)), [clips]);

  return (
    <div className="panel-scroll text-panel">
      <button className="add-text" onClick={() => useStore.setState({ recordOpen: true })}>
        <span className="add-text-icon rec">
          <Icon name="mic" size={20} />
        </span>
        <span>
          <strong>Gravar narração</strong>
          <span className="muted">Grave pelo microfone enquanto assiste ao vídeo.</span>
        </span>
        <Icon name="plus" size={18} strokeWidth={2.2} />
      </button>
      <button className="add-text" onClick={importDialog}>
        <span className="add-text-icon">
          <Icon name="import" size={20} />
        </span>
        <span>
          <strong>Importar música ou som</strong>
          <span className="muted">MP3, WAV, M4A, OGG, FLAC…</span>
        </span>
        <Icon name="plus" size={18} strokeWidth={2.2} />
      </button>

      <h3 className="panel-subtitle">Áudios do projeto</h3>
      {audios.length === 0 ? (
        <p className="hint">Nenhum áudio importado ainda. Músicas e narrações aparecem aqui.</p>
      ) : (
        <div className="audio-list">
          {audios.map((m) => (
            <div
              key={m.id}
              className={'audio-row' + (m.missing ? ' missing' : '')}
              draggable={!m.missing}
              onDragStart={(e) => {
                e.dataTransfer.setData(MEDIA_DRAG_TYPE, m.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onDoubleClick={() => !m.missing && addMediaToTimeline(m)}
              title={m.name}
            >
              <span className="audio-row-icon">
                <Icon name="music" size={16} />
              </span>
              <span className="audio-row-text">
                <span className="audio-row-name">{m.name}</span>
                <span className="muted">
                  {fmtDuration(m.duration)}
                  {used.has(m.id) && ' · na linha do tempo'}
                </span>
              </span>
              <button className="icon-btn" disabled={m.missing} onClick={() => addMediaToTimeline(m)} title="Adicionar no cursor" aria-label={`Adicionar ${m.name}`}>
                <Icon name="plus" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
