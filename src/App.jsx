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
import { clamp, isTyping } from './util';
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
import { startAutosave } from './library';

const SPLIT_KEY = 've.timelineHeight';

export default function App() {
  const view = useStore((s) => s.view);
  useEffect(() => startAutosave(), []);
  return (
    <>
      {view === 'home' ? <Home /> : <Editor />}
      <Tooltip />
      <DialogHost />
    </>
  );
}

function Editor() {
  const exportOpen = useStore((s) => s.exportOpen);
  const cropOpen = useStore((s) => !!s.cropClipId);
  const recordOpen = useStore((s) => s.recordOpen);
  const busy = useStore((s) => s.busy);
  const dirty = useStore((s) => s.dirty);
  const [timelineH, setTimelineH] = useState(() => {
    try {
      return Number(localStorage.getItem(SPLIT_KEY)) || 330;
    } catch {
      return 330;
    }
  });
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
      else if (k === '=' || k === '+') s.setZoom(s.zoom * 1.25);
      else if (k === '-') s.setZoom(s.zoom / 1.25);
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

  return (
    <div className="app" onDragEnter={onDragEnter} onDragLeave={onDragLeave} onDragOver={onDragOver} onDrop={onDrop}>
      <TopBar onShortcuts={() => setShortcutsOpen(true)} />
      <div className="workspace" style={{ gridTemplateRows: `1fr 6px ${timelineH}px` }}>
        <div className="upper">
          <LeftPanel />
          <Preview />
          <Inspector />
        </div>
        <div className="resizer" onPointerDown={startResize} role="separator" aria-orientation="horizontal" />
        <Timeline />
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
