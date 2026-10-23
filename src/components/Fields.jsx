import { useEffect, useRef, useState } from 'react';
import { clamp } from '../util';

// Slider com campo numérico. "onChange(v, phase)" recebe phase = 'start' | 'live' | 'end' | 'set'.
export function SliderField({ label, value, min, max, step = 1, unit = '', toDisplay = (v) => v, fromDisplay = (v) => v, decimals = 0, onChange, defaultValue, adornment }) {
  const dragging = useRef(false);
  const shown = toDisplay(value);

  const onPointerDown = () => {
    dragging.current = true;
    onChange(value, 'start');
    const up = () => {
      window.removeEventListener('pointerup', up);
      if (dragging.current) {
        dragging.current = false;
        onChange(null, 'end');
      }
    };
    window.addEventListener('pointerup', up);
  };

  const onRange = (e) => {
    const v = fromDisplay(Number(e.target.value));
    onChange(v, dragging.current ? 'live' : 'set');
  };

  return (
    <div className="field slider-field">
      <div className="field-top">
        <label
          className="scrub-label"
          onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue, 'set')}
          onPointerDown={(e) => {
            // Arrastar o nome do controle para os lados muda o valor (como nos apps de edição do macOS).
            if (e.button !== 0) return;
            e.preventDefault();
            const x0 = e.clientX;
            const v0 = value;
            const range = max - min;
            let started = false;
            const move = (ev) => {
              if (!started) {
                if (Math.abs(ev.clientX - x0) < 3) return;
                started = true;
                dragging.current = true;
                onChange(v0, 'start');
                document.body.classList.add('scrubbing');
              }
              const fine = ev.shiftKey ? 0.2 : 1;
              const raw = v0 + ((ev.clientX - x0) / 260) * range * fine;
              const dv = Math.round(toDisplay(raw) / step) * step;
              onChange(clamp(fromDisplay(dv), min, max), 'live');
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
              document.body.classList.remove('scrubbing');
              if (started) {
                dragging.current = false;
                onChange(null, 'end');
              }
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          title={'Arraste para ajustar' + (defaultValue !== undefined ? ' · clique duas vezes para restaurar' : '')}
        >
          {label}
        </label>
        {adornment}
        <span className="spacer" />
        <NumberInput value={shown} decimals={decimals} unit={unit} min={toDisplay(min)} max={toDisplay(max)} onCommit={(v) => onChange(fromDisplay(v), 'set')} />
      </div>
      <input
        type="range"
        min={toDisplay(min)}
        max={toDisplay(max)}
        step={step}
        value={shown}
        onPointerDown={onPointerDown}
        onChange={onRange}
        aria-label={label}
        style={{ '--fill': `${((shown - toDisplay(min)) / (toDisplay(max) - toDisplay(min))) * 100}%` }}
      />
    </div>
  );
}

export function NumberInput({ value, decimals = 0, unit = '', min = -Infinity, max = Infinity, onCommit }) {
  const fmt = (v) => (Number.isFinite(v) ? Number(v.toFixed(decimals)).toString() : '');
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);

  const commit = () => {
    const v = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(v)) onCommit(clamp(v, min, max));
    else setText(fmt(value));
  };

  return (
    <span className="num-input">
      <input
        value={text}
        inputMode="decimal"
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') {
            setText(fmt(value));
            focused.current = false;
            e.target.blur();
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={'switch' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

// Seções do painel: clicar no título recolhe/abre (lembrado entre sessões). Fechada, a seção nem
// monta o conteúdo, então as pesadas (filtros, looks, câmeras) só custam quando abertas.
const OPEN_KEY = 've.sections';
let openMap = null;
const openState = () => {
  if (!openMap) {
    try {
      openMap = JSON.parse(localStorage.getItem(OPEN_KEY)) || {};
    } catch {
      openMap = {};
    }
  }
  return openMap;
};

export function Section({ title, action, children, defaultOpen = true, meta }) {
  const [open, setOpen] = useState(() => {
    const v = openState()[title];
    return v === undefined ? defaultOpen : v;
  });
  const toggle = () => {
    const next = !open;
    openState()[title] = next;
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(openMap));
    } catch {}
    setOpen(next);
  };
  return (
    <section className={'section' + (open ? '' : ' closed')}>
      <div className="section-head">
        <button type="button" className="section-toggle" onClick={toggle} aria-expanded={open}>
          <svg className="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
          <h3>{title}</h3>
          {meta && <span className="section-meta">{meta}</span>}
        </button>
        {action}
      </div>
      {open && children}
    </section>
  );
}

// Interruptor compacto (usado no título das seções).
export function Switch({ checked, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} className={'switch' + (checked ? ' on' : '')} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

// Abas do inspetor: se não couberem, rolam (roda do mouse também) com sombra na borda que indica "tem mais".
export function TabStrip({ tabs, value, onChange }) {
  const ref = useRef(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  // Medir só no próximo quadro: ler scrollWidth logo depois de mexer no DOM força um layout da página inteira.
  const raf = useRef(0);
  const measure = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const l = el.scrollLeft > 2;
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }));
    });
  };
  useEffect(() => {
    measure();
    const el = ref.current;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [tabs.length]);
  // Traz a aba ativa para dentro da vista rolando só esta faixa (scrollIntoView rolaria o painel todo e força layout).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      const t = el?.querySelector('.tab.on');
      if (!t) return;
      const l = t.offsetLeft;
      const r = l + t.offsetWidth;
      if (l < el.scrollLeft) el.scrollLeft = Math.max(0, l - 10);
      else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth + 10;
    });
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className={'tabs-wrap' + (edge.l ? ' fade-l' : '') + (edge.r ? ' fade-r' : '')}>
      <div
        className="tabs"
        role="tablist"
        ref={ref}
        onScroll={measure}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={value === id} className={'tab' + (value === id ? ' on' : '')} onClick={() => onChange(id)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
