import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { useStore } from '../store';

// Vibração curta (Android). No iPhone o navegador ignora.
export const haptic = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};

// ---------- painel que sobe de baixo ----------
// Arrastar a alça para baixo (ou tocar fora) fecha. "peek" deixa o vídeo visível acima.
export function Sheet({ open, onClose, title, children, peek = false, action }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;

  const onDown = (e) => {
    const sy = e.clientY;
    let dy = 0;
    const move = (ev) => {
      dy = Math.max(0, ev.clientY - sy);
      setDrag(dy);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(0);
      if (dy > 90) onClose();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return createPortal(
    <div className={'sheet-root' + (shown ? ' on' : '') + (peek ? ' peek' : '')}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" ref={ref} style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined} role="dialog" aria-label={title}>
        <div className="sheet-grab" onPointerDown={onDown}>
          <i />
        </div>
        {(title || action) && (
          <div className="sheet-head">
            <h2>{title}</h2>
            {action || (
              <button className="m-icon" onClick={onClose} aria-label="Fechar">
                <Icon name="check" size={20} strokeWidth={2.4} />
              </button>
            )}
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- controle deslizante grande ----------
export function Slider({ label, value, min, max, step = 1, defaultValue, format = (v) => String(Math.round(v)), onStart, onChange, onEnd }) {
  const ref = useRef(null);
  const drag = useRef(false);
  const lastTap = useRef(0);
  const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

  const valueFrom = (clientX) => {
    const r = ref.current.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const raw = min + f * (max - min);
    return Math.min(max, Math.max(min, Math.round(raw / step) * step));
  };

  const down = (e) => {
    const now = Date.now();
    if (defaultValue !== undefined && now - lastTap.current < 320) {
      // Toque duplo volta ao valor original.
      lastTap.current = 0;
      onStart?.();
      onChange(defaultValue);
      onEnd?.();
      haptic(12);
      return;
    }
    lastTap.current = now;
    const pid = e.pointerId;
    drag.current = true;
    onStart?.();
    onChange(valueFrom(e.clientX));
    // Segue o dedo pela janela inteira: continua funcionando mesmo se o dedo sair da barra.
    const move = (ev) => {
      if (ev.pointerId === pid) onChange(valueFrom(ev.clientX));
    };
    const up = (ev) => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      drag.current = false;
      onEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const key = (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : 0;
    if (!d) return;
    e.preventDefault();
    onStart?.();
    onChange(Math.min(max, Math.max(min, value + d)));
    onEnd?.();
  };

  return (
    <div className="m-slider">
      <div className="m-slider-head">
        <span>{label}</span>
        <b>{format(value)}</b>
      </div>
      <div ref={ref} className="m-slider-track" role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} onPointerDown={down} onKeyDown={key}>
        <div className="m-slider-rail">
          <div className="m-slider-fill" style={{ width: frac * 100 + '%' }} />
        </div>
        <div className="m-slider-thumb" style={{ left: frac * 100 + '%' }} />
      </div>
    </div>
  );
}

// ---------- botão de ferramenta (ícone + nome) ----------
export function Tool({ icon, label, onClick, active, disabled, danger }) {
  return (
    <button className={'m-tool' + (active ? ' active' : '') + (danger ? ' danger' : '')} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  );
}

// ---------- aviso ----------
export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={'m-toast ' + toast.kind} role="status" key={toast.id}>
      {toast.kind === 'error' && <Icon name="warning" size={18} />}
      <span>{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            useStore.setState({ toast: null });
            toast.action.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

// ---------- confirmação / pergunta (no lugar de confirm/prompt do navegador) ----------
let ask = null;
export const askConfirm = (opts) => new Promise((resolve) => ask?.({ kind: 'confirm', ...opts, resolve }));
export const askText = (opts) => new Promise((resolve) => ask?.({ kind: 'text', ...opts, resolve }));

export function DialogHost() {
  const [d, setD] = useState(null);
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    ask = (x) => {
      setText(x.value || '');
      setD(x);
    };
    return () => {
      ask = null;
    };
  }, []);
  useEffect(() => {
    if (d?.kind === 'text') setTimeout(() => inputRef.current?.select(), 60);
  }, [d]);
  if (!d) return null;
  const close = (v) => {
    d.resolve(v);
    setD(null);
  };
  return createPortal(
    <div className="dialog-root">
      <div className="dialog-backdrop" onClick={() => close(d.kind === 'text' ? null : false)} />
      <div className="dialog" role="alertdialog">
        <h2>{d.title}</h2>
        {d.message && <p>{d.message}</p>}
        {d.kind === 'text' && d.multiline && <textarea ref={inputRef} rows={3} value={text} maxLength={300} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} />}
        {d.kind === 'text' && !d.multiline && <input ref={inputRef} value={text} maxLength={80} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && close(text.trim() || null)} />}
        <div className="dialog-actions">
          <button onClick={() => close(d.kind === 'text' ? null : false)}>Cancelar</button>
          <button className={d.danger ? 'danger' : 'primary'} onClick={() => close(d.kind === 'text' ? text.trim() || null : true)}>
            {d.confirm || 'OK'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
