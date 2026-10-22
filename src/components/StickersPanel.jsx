import { useState } from 'react';
import { addSticker } from '../ops';

const GROUPS = [
  ['Reações', ['😂', '😍', '😮', '😎', '🥳', '😭', '🤯', '😡', '🤔', '😴', '🙄', '🤩']],
  ['Gestos', ['👍', '👎', '👏', '🙌', '👉', '👈', '👆', '👇', '✌️', '🤞', '💪', '🙏']],
  ['Destaques', ['🔥', '⭐', '✨', '💥', '💯', '❤️', '💔', '⚡', '🎉', '🏆', '✅', '❌']],
  ['Setas e sinais', ['➡️', '⬅️', '⬆️', '⬇️', '↗️', '🔴', '🟡', '🟢', '❗', '❓', '⚠️', '🔔']],
  ['Objetos', ['🎬', '🎵', '📸', '🎮', '💰', '📌', '🕒', '💡', '🎁', '🚀', '🍕', '☕']],
  ['Natureza', ['☀️', '🌙', '🌈', '☁️', '❄️', '🌊', '🌸', '🍀', '🐶', '🐱', '🦋', '🌵']],
];
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
  return (
    <div className="panel-scroll text-panel">
      <p className="hint tr-help">Clique num adesivo para colocá-lo no ponto do cursor. Arraste no player para mudar posição e tamanho.</p>
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
                <span>{e}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
