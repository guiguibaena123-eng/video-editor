import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore, projectDuration } from './store';
import { engine } from './engine';
import {
  splitAtPlayhead, deleteSelection, duplicateSelection, copySelection, paste, seek,
  saveProject, openProject, newProjectAction, importDroppedFiles, importDialog, openCrop, freezeFrame, addKeyframesHere,
} from './ops';
const CropDialog = lazy(() => import('./components/CropDialog.jsx'));
const VoiceoverDialog = lazy(() => import('./components/VoiceoverDialog.jsx'));
import { addTextPreset } from './ops';
import { TEXT_STYLES } from './textPresets';
import { clamp, isTyping, stepUiZoom } from './util';
import TopBar from './components/TopBar.jsx';
import LeftPanel from './components/LeftPanel.jsx';
import Preview, { setTheater } from './components/Preview.jsx';
import Inspector from './components/Inspector.jsx';
import Timeline from './components/Timeline.jsx';
const ExportDialog = lazy(() => import('./components/ExportDialog.jsx'));
import Toast from './components/Toast.jsx';
import Tooltip from './components/Tooltip.jsx';
import DialogHost from './components/DialogHost.jsx';
const ShortcutsDialog = lazy(() => import('./components/ShortcutsDialog.jsx'));
import Home from './components/Home.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { startAutosave } from './library';
import { openVeditPath } from './ops';

const SPLIT_KEY = 've.timelineHeight';
const COLS_KEY = 've.panelWidths';
const COL_LIMITS = { l: [220, 520], r: [260, 560] };
const MIN_CENTER = 440;

export default function App() {
  const view = useStore((s) => s.view);
  useEffect(() => startAutosave(), []);
  // Arquivo .vedit aberto pelo Windows (ao iniciar ou com o app já aberto).
  useEffect(() => {
    window.api.takePendingOpen?.().then((f) => f && openVeditPath(f));
    return window.api.onOpenFile?.((f) => openVeditPath(f));
  }, []);
  // Ctrl + / Ctrl - / Ctrl 0: tamanho da interface (vale na tela de projetos e no editor).
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const dir = e.key === '=' || e.key === '+' ? 1 : e.key === '-' || e.key === '_' ? -1 : e.key === '0' ? 0 : null;
      if (dir === null) return;
      e.preventDefault();
      const z = stepUiZoom(dir);
      useStore.getState().notify(`Interface em ${Math.round(z * 100)}%`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <ErrorBoundary>
      {view === 'home' ? <Home /> : <Editor />}
      <Tooltip />
      <DialogHost />
    </ErrorBoundary>
  );
}

function Editor() {
  const exportOpen = useStore((s) => s.exportOpen);
  const cropOpen = useStore((s) => !!s.cropClipId);
  const recordOpen = useStore((s) => s.recordOpen);
  const busy = useStore((s) => s.busy);
  const dirty = useStore((s) => s.dirty);
  // Altura da linha do tempo: a que o usuário escolheu ou, na primeira vez, ~36% da janela (menor em janelas baixas).
  const [timelineH, setTimelineH] = useState(() => {
    const auto = Math.round(clamp(window.innerHeight * 0.36, 230, 370));
    try {
      return Number(localStorage.getItem(SPLIT_KEY)) || auto;
    } catch {
      return auto;
    }
  });
  const selection = useStore((s) => s.selection);
  const upperRef = useRef(null);
  // Largura dos painéis laterais (px). null = automática (proporcional à janela).
  const [sizes, setSizes] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(COLS_KEY));
      return { l: Number.isFinite(v?.l) ? v.l : null, r: Number.isFinite(v?.r) ? v.r : null };
    } catch {
      return { l: null, r: null };
    }
  });
  const cols = `${sizes.l ? sizes.l + 'px' : 'minmax(250px, 21%)'} minmax(0, 1fr) ${sizes.r ? sizes.r + 'px' : 'minmax(280px, 22%)'}`;
  const [dropping, setDropping] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => window.api.setDirty(dirty), [dirty]);

  useEffect(() => {
    const onKey = (e) => {
      if (useStore.getState().view !== 'editor') return;
      if (document.activeElement?.closest?.('[role=dialog]')) return;
      if (isTyping(document.activeElement) || useStore.getState().exportOpen || useStore.getState().cropClipId || useStore.getState().recordOpen || useStore.getState().busy) return;
      const s = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const frame = 1 / s.project.settings.fps;
      let handled = true;
      if (k === ' ') engine.toggle();
      else if (ctrl && k === 'z' && !e.shiftKey) s.undo();
      else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) s.redo();
      else if (ctrl && k === 'b') splitAtPlayhead();
      else if (!ctrl && k === 's') splitAtPlayhead();
      else if (ctrl && k === 's') saveProject(e.shiftKey);
      else if (ctrl && k === 'o') openProject();
      else if (ctrl && k === 'n') newProjectAction();
      else if (ctrl && k === 'i') importDialog();
      else if (!ctrl && k === 't') addTextPreset(TEXT_STYLES[0]);
      else if (!ctrl && k === 'r') useStore.setState({ recordOpen: true });
      else if (!ctrl && k === 'f') freezeFrame();
      else if (!ctrl && k === 'k') addKeyframesHere();
      else if (ctrl && k === 'e') useStore.setState({ exportOpen: true });
      else if (ctrl && k === 'd') duplicateSelection();
      else if (!ctrl && k === 'c') openCrop();
      else if (ctrl && k === 'c') copySelection();
      else if (ctrl && k === 'v') paste();
      else if (ctrl && k === 'a') s.select(s.project.clips.map((c) => c.id));
      else if (k === 'delete' || k === 'backspace') deleteSelection();
      else if (k === 'arrowleft') seek(s.currentTime - (e.shiftKey ? 1 : frame));
      else if (k === 'arrowright') seek(s.currentTime + (e.shiftKey ? 1 : frame));
      else if (k === 'home') seek(0);
      else if (k === 'end') seek(projectDuration(s.project));
      else if (!ctrl && (k === '=' || k === '+')) s.setZoom(s.zoom * 1.25);
      else if (!ctrl && k === '-') s.setZoom(s.zoom / 1.25);
      else if (k === 'f11') setTheater(!s.theater);
      else if (k === 'escape') {
        if (!s.theater) s.select([]);
      }
      else if (k === '?') setShortcutsOpen((v) => !v);
      else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Arrastar arquivos do Windows para qualquer lugar da janela importa a mídia.
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const onDragEnter = (e) => {
    if (!hasFiles(e)) return;
    dragDepth.current++;
    setDropping(true);
  };
  const onDragLeave = (e) => {
    if (!hasFiles(e)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDropping(false);
  };
  const onDragOver = (e) => {
    if (hasFiles(e)) e.preventDefault();
  };
  const onDrop = (e) => {
    dragDepth.current = 0;
    setDropping(false);
    if (!hasFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    importDroppedFiles(e.dataTransfer.files);
  };

  const startResize = (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineH;
    const move = (ev) => setTimelineH(clamp(startH - (ev.clientY - startY), 180, window.innerHeight - 320));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTimelineH((h) => {
        try {
          localStorage.setItem(SPLIT_KEY, String(h));
        } catch {}
        return h;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const saveSizes = (next) => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {}
  };
  const resetCol = (side) => {
    const next = { ...sizes, [side]: null };
    setSizes(next);
    saveSizes(next);
  };
  const startColResize = (side) => (e) => {
    e.preventDefault();
    const box = upperRef.current.getBoundingClientRect();
    const panel = upperRef.current.children[side === 'l' ? 0 : 2].getBoundingClientRect();
    const other = upperRef.current.children[side === 'l' ? 2 : 0].getBoundingClientRect().width;
    const startX = e.clientX;
    const startW = panel.width;
    let last = startW;
    document.body.classList.add('col-resizing');
    const move = (ev) => {
      const dx = side === 'l' ? ev.clientX - startX : startX - ev.clientX;
      const [lo, hi] = COL_LIMITS[side];
      last = clamp(startW + dx, lo, Math.min(hi, box.width - other - MIN_CENTER));
      setSizes((s) => ({ ...s, [side]: Math.round(last) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('col-resizing');
      saveSizes({ ...sizes, [side]: Math.round(last) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="app" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
      <TopBar onShortcuts={() => setShortcutsOpen(true)} />
      <div className="workspace" style={{ gridTemplateRows: `1fr 6px min(${timelineH}px, 54vh)` }}>
        <div className="upper" ref={upperRef} style={{ gridTemplateColumns: cols }}>
          <ErrorBoundary panel="O painel esquerdo"><LeftPanel /></ErrorBoundary>
          <ErrorBoundary panel="O player"><Preview /></ErrorBoundary>
          <ErrorBoundary panel="O inspetor" resetKeys={[selection]}><Inspector /></ErrorBoundary>
          <div className="vresizer" data-side="l" onPointerDown={startColResize('l')} onDoubleClick={() => resetCol('l')} role="separator" aria-orientation="vertical" title="Arraste para ajustar. Clique duas vezes para restaurar." />
          <div className="vresizer" data-side="r" onPointerDown={startColResize('r')} onDoubleClick={() => resetCol('r')} role="separator" aria-orientation="vertical" title="Arraste para ajustar. Clique duas vezes para restaurar." />
        </div>
        <div className="resizer" onPointerDown={startResize} role="separator" aria-orientation="horizontal" />
        <ErrorBoundary panel="A linha do tempo"><Timeline /></ErrorBoundary>
      </div>
      {dropping && (
        <div className="drop-overlay">
          <div>Solte para importar</div>
        </div>
      )}
      <Suspense fallback={null}>
        {exportOpen && <ExportDialog />}
        {cropOpen && <CropDialog />}
        {recordOpen && <VoiceoverDialog />}
        {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      </Suspense>
      {busy && (
        <div className="modal-backdrop">
          <div className="busy-box" role="status">
            <span className="spinner" />
            <strong>{busy.label}</strong>
            <div className="progress">
              <div style={{ width: `${Math.round((busy.progress || 0) * 100)}%` }} />
            </div>
          </div>
        </div>
      )}
      <Toast />
    </div>
  );
}
