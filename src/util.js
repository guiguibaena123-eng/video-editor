const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

// 00:01:05:12 (horas opcionais, quadros no final)
export function fmtTimecode(t, fps = 30) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t - Math.floor(t)) * fps + 1e-6);
  return (h ? pad(h) + ':' : '') + `${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function fmtDuration(t) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Arrastar com o ponteiro: chama onMove(ev) a cada movimento e onUp(ev) ao soltar.
export function dragPointer(e, onMove, onUp) {
  e.preventDefault();
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp?.(ev);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

export const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

// Zoom da interface (Ctrl + / Ctrl - / Ctrl 0): ajuda em monitores grandes ou de alta resolução. Fica gravado.
const UI_ZOOM_KEY = 've.uiZoom';
export function loadUiZoom() {
  let z = 1;
  try {
    z = Number(localStorage.getItem(UI_ZOOM_KEY)) || 1;
  } catch {}
  z = Math.min(1.6, Math.max(0.7, z));
  window.api?.setUiZoom?.(z);
  return z;
}
export function stepUiZoom(dir) {
  const cur = window.api?.getUiZoom?.() || 1;
  const next = dir === 0 ? 1 : Math.round(Math.min(1.6, Math.max(0.7, cur + dir * 0.1)) * 100) / 100;
  window.api?.setUiZoom?.(next);
  try {
    localStorage.setItem(UI_ZOOM_KEY, String(next));
  } catch {}
  return next;
}
