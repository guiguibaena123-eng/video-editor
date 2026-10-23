import React from 'react';
import { createRoot } from 'react-dom/client';
import { installWebApi } from '../web/api';
import { useStore } from '../store';
import * as ops from '../ops';
import { engine, setEngine } from '../engine';
import { LiteEngine } from '../liteEngine';
import { framesSupported } from '../web/frames';
import MobileApp from './MobileApp.jsx';
import './m.css';

installWebApi();
useStore.setState({ zoom: 90 });
// Quem nunca escolheu a qualidade da prévia começa em "Original" (a resolução do vídeo, também em 4K).
try {
  if (!localStorage.getItem('ve.previewQuality')) useStore.setState({ previewQuality: 'high' });
} catch {}
// Motor do celular: imagem decodificada quadro a quadro (WebCodecs) e som num elemento de áudio. Sem WebCodecs
// (navegador antigo) continua o motor de <video> no perfil leve.
const legacy = (() => {
  try {
    return /[?&]legacy/.test(location.search) || localStorage.getItem('ve.legacy') === '1';
  } catch {
    return false;
  }
})();
if (framesSupported() && !legacy) setEngine(new LiteEngine());
else {
  engine.lite = true;
  engine.maxFps = 30;
}

// Acesso para testes automatizados, só no modo de desenvolvimento.
if (import.meta.env.DEV) import('./prep').then((m) => (window.__ve = { useStore, ops, get engine() { return engine; }, importWithPrep: m.importWithPrep }));

createRoot(document.getElementById('root')).render(<MobileApp />);

// App instalável e que abre sem internet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}
