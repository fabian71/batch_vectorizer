// Shared file store (IndexedDB) used by the popup and the background service worker.
// Image files live on disk here instead of in memory or in chrome.storage,
// so the queue only carries lightweight metadata.
const VecFileStore = (() => {
  const DB_NAME = 'vectorizer-files';
  const DB_VERSION = 1;
  const FILES = 'files';
  const THUMBS = 'thumbs';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
          if (!db.objectStoreNames.contains(THUMBS)) db.createObjectStore(THUMBS);
        };
        req.onsuccess = () => {
          req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
          resolve(req.result);
        };
        req.onerror = () => { dbPromise = null; reject(req.error); };
      });
    }
    return dbPromise;
  }

  async function run(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      result = fn(tx);
    });
  }

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Saves the original file and (optionally) its small thumbnail.
  function put(id, blob, thumb) {
    return run([FILES, THUMBS], 'readwrite', (tx) => {
      tx.objectStore(FILES).put(blob, id);
      if (thumb) tx.objectStore(THUMBS).put(thumb, id);
    });
  }

  async function getFile(id) {
    const db = await open();
    return request(db.transaction(FILES, 'readonly').objectStore(FILES).get(id));
  }

  async function hasFile(id) {
    const db = await open();
    const count = await request(db.transaction(FILES, 'readonly').objectStore(FILES).count(id));
    return count > 0;
  }

  async function getThumb(id) {
    const db = await open();
    return request(db.transaction(THUMBS, 'readonly').objectStore(THUMBS).get(id));
  }

  // Removes only the heavy original file, keeping the thumbnail for the queue list.
  function removeFiles(ids) {
    return run([FILES], 'readwrite', (tx) => {
      const store = tx.objectStore(FILES);
      ids.forEach((id) => store.delete(id));
    });
  }

  // Removes file and thumbnail.
  function remove(ids) {
    return run([FILES, THUMBS], 'readwrite', (tx) => {
      ids.forEach((id) => {
        tx.objectStore(FILES).delete(id);
        tx.objectStore(THUMBS).delete(id);
      });
    });
  }

  // Deletes everything whose id is not in keepIds (leftovers from older queues).
  async function prune(keepIds) {
    const keep = new Set(keepIds);
    const db = await open();
    const tx = db.transaction([FILES, THUMBS], 'readonly');
    const [fileKeys, thumbKeys] = await Promise.all([
      request(tx.objectStore(FILES).getAllKeys()),
      request(tx.objectStore(THUMBS).getAllKeys())
    ]);
    const stale = [...new Set([...fileKeys, ...thumbKeys])].filter((id) => !keep.has(id));
    if (stale.length) await remove(stale);
    return stale.length;
  }

  function clear() {
    return run([FILES, THUMBS], 'readwrite', (tx) => {
      tx.objectStore(FILES).clear();
      tx.objectStore(THUMBS).clear();
    });
  }

  return { put, getFile, hasFile, getThumb, removeFiles, remove, prune, clear };
})();
