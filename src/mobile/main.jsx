import React from 'react';
import { createRoot } from 'react-dom/client';
import { installWebApi } from '../web/api';
import { useStore } from '../store';
import * as ops from '../ops';
import { engine } from '../engine';
import MobileApp from './MobileApp.jsx';
import './m.css';

installWebApi();
useStore.setState({ zoom: 90 });

// Acesso para testes automatizados, só no modo de desenvolvimento.
if (import.meta.env.DEV) window.__ve = { useStore, ops, engine };

createRoot(document.getElementById('root')).render(<MobileApp />);

// App instalável e que abre sem internet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}
