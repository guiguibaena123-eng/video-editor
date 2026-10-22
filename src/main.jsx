import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './fonts';
import './styles.css';
import { useStore } from './store';
import * as ops from './ops';
import { engine } from './engine';

// Acesso para testes automatizados, só no modo de desenvolvimento.
if (import.meta.env.DEV) window.__ve = { useStore, ops, engine };

createRoot(document.getElementById('root')).render(<App />);
