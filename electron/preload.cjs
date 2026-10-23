const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openMedia: () => ipcRenderer.invoke('media:open'),
  allowPaths: (paths) => ipcRenderer.invoke('media:allow', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  probe: (file) => ipcRenderer.invoke('media:probe', file),
  thumbnails: (file, duration, type) => ipcRenderer.invoke('media:thumbs', file, duration, type),
  waveform: (file) => ipcRenderer.invoke('media:waveform', file),
  saveProject: (payload) => ipcRenderer.invoke('project:save', payload),
  openProject: () => ipcRenderer.invoke('project:open'),
  libraryList: () => ipcRenderer.invoke('library:list'),
  libraryNewFile: () => ipcRenderer.invoke('library:newFile'),
  librarySave: (payload) => ipcRenderer.invoke('library:save', payload),
  libraryOpen: (file) => ipcRenderer.invoke('library:open', file),
  libraryDelete: (file) => ipcRenderer.invoke('library:delete', file),
  libraryRename: (file, name) => ipcRenderer.invoke('library:rename', file, name),
  libraryDuplicate: (file) => ipcRenderer.invoke('library:duplicate', file),
  libraryImport: () => ipcRenderer.invoke('library:import'),
  libraryImportPath: (file) => ipcRenderer.invoke('library:importPath', file),
  takePendingOpen: () => ipcRenderer.invoke('app:pendingOpen'),
  onOpenFile: (cb) => {
    const listener = (_e, file) => cb(file);
    ipcRenderer.on('app:openFile', listener);
    return () => ipcRenderer.removeListener('app:openFile', listener);
  },
  libraryReveal: (file) => ipcRenderer.invoke('library:reveal', file),
  chooseExportPath: (name, ext) => ipcRenderer.invoke('export:choosePath', name, ext),
  startExport: (job) => ipcRenderer.invoke('export:start', job),
  exportAssetDir: () => ipcRenderer.invoke('export:assetDir'),
  writeExportAsset: (dir, name, data) => ipcRenderer.invoke('export:writeAsset', dir, name, data),
  cleanExportAssets: (dir) => ipcRenderer.invoke('export:cleanAssets', dir),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  setFullScreen: (on) => ipcRenderer.invoke('window:setFullScreen', on),
  onFullScreenChange: (cb) => {
    const listener = (_e, on) => cb(on);
    ipcRenderer.on('window:fullscreen', listener);
    return () => ipcRenderer.removeListener('window:fullscreen', listener);
  },
  onExportProgress: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('export:progress', listener);
    return () => ipcRenderer.removeListener('export:progress', listener);
  },
  previewProxy: (file, hasAudio) => ipcRenderer.invoke('media:previewProxy', file, hasAudio),
  audioProxy: (file, fx) => ipcRenderer.invoke('audio:proxy', file, fx),
  saveRecording: (data) => ipcRenderer.invoke('audio:saveRecording', data),
  extractFrame: (file, time) => ipcRenderer.invoke('media:frame', file, time),
  stabilizeMedia: (file, start, end, hasAudio, level) => ipcRenderer.invoke('media:stabilize', file, start, end, hasAudio, level),
  onStabilizeProgress: (cb) => {
    const listener = (_e, v) => cb(v);
    ipcRenderer.on('media:stabilizeProgress', listener);
    return () => ipcRenderer.removeListener('media:stabilizeProgress', listener);
  },
  reverseMedia: (file, start, end, hasAudio) => ipcRenderer.invoke('media:reverse', file, start, end, hasAudio),
  onReverseProgress: (cb) => {
    const listener = (_e, value) => cb(value);
    ipcRenderer.on('media:reverseProgress', listener);
    return () => ipcRenderer.removeListener('media:reverseProgress', listener);
  },
  openSrt: () => ipcRenderer.invoke('srt:open'),
  saveSrt: (text, name) => ipcRenderer.invoke('srt:save', text, name),
  openLut: () => ipcRenderer.invoke('lut:open'),
  readLut: (p) => ipcRenderer.invoke('lut:read', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  setTheme: (t) => ipcRenderer.invoke('window:setTheme', t),
  setUiZoom: (f) => webFrame.setZoomFactor(f),
  getUiZoom: () => webFrame.getZoomFactor(),
  setDirty: (value) => ipcRenderer.send('app:dirty', value),
});
