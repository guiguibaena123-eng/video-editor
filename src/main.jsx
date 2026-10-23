import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './fonts';
import './styles.css';
import { useStore } from './store';
import * as ops from './ops';
import { engine } from './engine';
import { loadUiZoom } from './util';
import * as transitions from './transitions';
import { CAMERAS } from './cameras';
import { LOOKS } from './looks';
import { EFFECTS } from './effects';
import { FILTERS } from './color';
import { TEXT_STYLES } from './textPresets';

// Acesso para testes automatizados: no modo de desenvolvimento ou quando a janela é aberta com ?e2e.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('e2e')) window.__ve = { useStore, ops, engine, textStyles: TEXT_STYLES, transitions, catalog: { CAMERAS, LOOKS, EFFECTS, FILTERS } };

loadUiZoom();

createRoot(document.getElementById('root')).render(<App />);
