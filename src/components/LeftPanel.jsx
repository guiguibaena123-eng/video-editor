import { useState } from 'react';
import { Icon } from '../icons';
import MediaPanel from './MediaPanel.jsx';
import TextPanel from './TextPanel.jsx';
import AudioPanel from './AudioPanel.jsx';
import TransitionsPanel from './TransitionsPanel.jsx';
import EffectsPanel from './EffectsPanel.jsx';
import StickersPanel from './StickersPanel.jsx';
import TemplatesPanel from './TemplatesPanel.jsx';

const TABS = [
  ['media', 'Mídia', 'media'],
  ['templates', 'Modelos', 'layout'],
  ['audio', 'Áudio', 'music'],
  ['text', 'Texto', 'text'],
  ['transitions', 'Transições', 'transition'],
  ['effects', 'Efeitos', 'sparkle'],
  ['stickers', 'Adesivos', 'sticker'],
];
const KEY = 've.leftTab';

export default function LeftPanel() {
  const [tab, setTab] = useState(() => {
    try {
      return localStorage.getItem(KEY) || 'media';
    } catch {
      return 'media';
    }
  });
  const choose = (id) => {
    setTab(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };
  return (
    <aside className="panel left-panel">
      <div className="left-tabs" role="tablist">
        {TABS.map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={'left-tab' + (tab === id ? ' on' : '')} onClick={() => choose(id)} title={label}>
            <Icon name={icon} size={17} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {tab === 'media' ? <MediaPanel /> : tab === 'templates' ? <TemplatesPanel /> : tab === 'audio' ? <AudioPanel /> : tab === 'transitions' ? <TransitionsPanel /> : tab === 'effects' ? <EffectsPanel /> : tab === 'stickers' ? <StickersPanel /> : <TextPanel />}
    </aside>
  );
}
