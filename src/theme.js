// Tema da interface: escuro (padrão) ou claro. Fica gravado e vale também na tela de projetos.
import { useSyncExternalStore } from 'react';

const KEY = 've.theme';
const listeners = new Set();
let current = 'dark';

const BAR = { dark: { color: '#131418', symbolColor: '#d9dade', bg: '#0e0f12' }, light: { color: '#ffffff', symbolColor: '#1a1c24', bg: '#f4f5f8' } };

function apply(theme, animate) {
  current = theme;
  const el = document.documentElement;
  if (animate) {
    el.classList.add('theme-anim');
    setTimeout(() => el.classList.remove('theme-anim'), 320);
  }
  el.dataset.theme = theme;
  window.api?.setTheme?.(BAR[theme]);
  listeners.forEach((f) => f());
}

export function loadTheme() {
  let t = 'dark';
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') t = v;
  } catch {}
  apply(t, false);
}

export function setTheme(t) {
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  apply(t, true);
}

export const toggleTheme = () => setTheme(current === 'dark' ? 'light' : 'dark');

export function useTheme() {
  return useSyncExternalStore((f) => (listeners.add(f), () => listeners.delete(f)), () => current);
}
