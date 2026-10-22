import { useEffect, useState } from 'react';

// Dicas rápidas: troca o "title" lento do navegador por uma dica imediata e legível.
// "Dividir no cursor (S / Ctrl+B)" vira o texto + um selo com o atalho.
function parse(text) {
  const m = /^(.*?)\s*\(([^()]{1,24})\)\s*$/.exec(text);
  return m && !/\s{2,}/.test(m[2]) && m[1] ? { label: m[1], key: m[2] } : { label: text, key: '' };
}

export default function Tooltip() {
  const [tip, setTip] = useState(null);

  useEffect(() => {
    let current = null;
    let timer = 0;
    const restore = () => {
      clearTimeout(timer);
      if (current?.el?.isConnected && current.title != null) current.el.setAttribute('title', current.title);
      current = null;
      setTip(null);
    };
    const over = (e) => {
      const el = e.target.closest?.('[title]');
      if (!el || el === current?.el) return;
      restore();
      const title = el.getAttribute('title');
      if (!title) return;
      el.removeAttribute('title');
      current = { el, title };
      timer = setTimeout(() => {
        if (!current || !current.el.isConnected) return;
        const r = current.el.getBoundingClientRect();
        setTip({ ...parse(current.title), x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, 380);
    };
    const out = (e) => {
      if (current && !current.el.contains(e.relatedTarget)) restore();
    };
    const hide = () => current && restore();
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', hide, true);
    return () => {
      restore();
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('blur', hide);
      document.removeEventListener('scroll', hide, true);
    };
  }, []);

  if (!tip) return null;
  const below = tip.top < 60;
  const x = Math.min(Math.max(tip.x, 130), window.innerWidth - 130);
  return (
    <div className="tip" role="tooltip" style={{ left: x, top: below ? tip.bottom + 8 : tip.top - 8, transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%)' }}>
      <span>{tip.label}</span>
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  );
}
