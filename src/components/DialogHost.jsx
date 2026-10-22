import { useEffect, useRef, useState } from 'react';

// Diálogos do próprio app (o Electron não tem window.prompt, e o confirm nativo destoa do visual).
//   askText({ title, label, value, ok })       -> Promise<string | null>
//   askConfirm({ title, message, ok, danger }) -> Promise<boolean>
let open = null;

export const askText = (opts) => new Promise((res) => (open ? open({ kind: 'text', res, ...opts }) : res(null)));
export const askConfirm = (opts) => new Promise((res) => (open ? open({ kind: 'confirm', res, ...opts }) : res(false)));

export default function DialogHost() {
  const [d, setD] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    open = setD;
    return () => {
      open = null;
    };
  }, []);

  useEffect(() => {
    if (d?.kind === 'text') input.current?.select();
  }, [d]);

  if (!d) return null;
  const done = (value) => {
    setD(null);
    d.res(value);
  };
  const submit = () => {
    if (d.kind === 'confirm') return done(true);
    const v = input.current?.value.trim();
    done(v || null);
  };
  const cancel = () => done(d.kind === 'confirm' ? false : null);

  return (
    <div className="modal-back dlg-back" onPointerDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        className="dlg"
        role="dialog"
        aria-label={d.title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            cancel();
          } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <h2>{d.title}</h2>
        {d.message && <p className="muted">{d.message}</p>}
        {d.kind === 'text' && (
          <label className="dlg-field">
            {d.label && <span>{d.label}</span>}
            <input ref={input} defaultValue={d.value || ''} maxLength={d.max || 40} spellCheck={false} autoFocus />
          </label>
        )}
        <div className="dlg-actions">
          <button className="secondary" onClick={cancel}>
            Cancelar
          </button>
          <button className={d.danger ? 'danger solid' : 'primary'} onClick={submit} autoFocus={d.kind === 'confirm'}>
            {d.ok || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
