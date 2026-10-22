import { useEffect, useState } from 'react';

const KEY = 've.installDismissed';
let deferred = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    window.dispatchEvent(new Event('ve-install-ready'));
  });
}

export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Convite para instalar o app na tela inicial (no iPhone ele guarda os arquivos por mais tempo).
export function useInstall() {
  const [, bump] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('ve-install-ready', on);
    return () => window.removeEventListener('ve-install-ready', on);
  }, []);
  const standalone = isStandalone();
  const ios = isIOS();
  return {
    show: !standalone && !dismissed && (ios || !!deferred),
    ios,
    canPrompt: !!deferred,
    prompt: async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      bump((n) => n + 1);
    },
    dismiss: () => {
      try {
        localStorage.setItem(KEY, '1');
      } catch {}
      setDismissed(true);
    },
  };
}
