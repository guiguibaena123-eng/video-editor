// Armazenamento do celular (IndexedDB): arquivos de mídia e projetos ficam no aparelho.
const NAME = 'video-editor';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('files');
      db.createObjectStore('projects');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const dbPut = (store, key, value) => tx(store, 'readwrite', (s) => s.put(value, key));
export const dbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const dbDelete = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const dbKeys = (store) => tx(store, 'readonly', (s) => s.getAllKeys());
export async function dbAll(store) {
  const keys = await dbKeys(store);
  const out = [];
  for (const k of keys) out.push([k, await dbGet(store, k)]);
  return out;
}

// Pede ao navegador para não apagar os dados do app quando faltar espaço.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { used: e.usage || 0, quota: e.quota || 0 };
  } catch {
    return null;
  }
}
