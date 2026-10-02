// Image files live in IndexedDB (filestore.js); the queue only holds metadata.
importScripts('filestore.js');

let queue = [];
let isRunning = false;
let isPaused = false;
let workerTabId = null;
let delaySeconds = 5;
let downloadFormat = 'eps';
let downloadFolder = '';
let removeBackground = false;
let autoPause = { enabled: false, count: 10, minMinutes: 1, maxMinutes: 5 };
let processedCount = 0; // Counter for processed images since last pause
let autoPauseEndTime = null; // When the automatic pause ends
let queueExplicitlyCancelled = false; // Flag to prevent persisting after cancellation
const downloadNameMap = new Map();
const QUEUE_ITEM_KEY_PREFIX = 'vectorizer-queue-item:';


let stateReadyPromiseResolve;
const stateReadyPromise = new Promise(resolve => stateReadyPromiseResolve = resolve);

loadConfig();
registerDownloadHandler();
restoreQueueFromStorage(); // CRITICAL: Restore queue from storage on startup
loadAutoPauseState(); // Loads auto-pause state if it exists

function createQueueItemId(item, index = 0) {
  if (item?.id) return item.id;
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `queue-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

function getQueueItemStorageKey(id) {
  return `${QUEUE_ITEM_KEY_PREFIX}${id}`;
}

// Removes the stored original of one item (its thumbnail stays for the queue list).
async function removeQueueItemData(id) {
  if (!id) return;
  await VecFileStore.removeFiles([id]);
}

// Removes originals and thumbnails of the given queue items.
async function clearQueueFiles(ids) {
  const valid = (ids || []).filter(Boolean);
  if (valid.length > 0) await VecFileStore.remove(valid);
}

// Older versions kept the image bytes in chrome.storage.local; free that space.
async function clearLegacyQueueItemData() {
  const allItems = await chrome.storage.local.get(null);
  const keys = Object.keys(allItems).filter((key) => key.startsWith(QUEUE_ITEM_KEY_PREFIX));
  if (keys.length > 0) {
    await chrome.storage.local.remove(keys);
  }
}

// Reads a Blob as base64 so a single file can be handed to the content script.
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function requeueProcessingItems(reason = 'unknown') {
  let changed = false;
  queue.forEach((item) => {
    if (item.status === 'processing') {
      item.status = 'pending';
      changed = true;
    }
  });

  if (changed) {
    console.log('[requeueProcessingItems] Requeued processing items due to', reason);
  }

  return changed;
}

// CRITICAL: Persist queue to storage to survive service worker restarts
// NOTE: Binary data is persisted separately in chrome.storage.local by item id.
// The queue state itself stays lightweight and survives service worker restarts.
function persistQueue() {
  try {
    // Do NOT persist if queue was explicitly cancelled
    if (queueExplicitlyCancelled) {
      console.log('[persistQueue] Queue was cancelled, skipping persistence');
      return;
    }

    // Do NOT persist empty queue (it was likely cancelled)
    if (queue.length === 0) {
      console.log('[persistQueue] Queue is empty, skipping persistence');
      return;
    }

    chrome.storage.local.set({
      persistedQueue: {
        queue: queue.map(q => ({
          id: q.id,
          name: q.name,
          type: q.type,
          status: q.status,
          size: q.size,
          removeBackground: Boolean(q.removeBackground),
          // data: q.data, // REMOVED: Binary data causes quota exceeded error
          width: q.width,
          height: q.height
        })),
        isRunning,
        isPaused,
        workerTabId,
        processedCount,
        timestamp: Date.now()
      }
    });
    console.log('[persistQueue] Queue saved with', queue.length, 'items (metadata only, binary stored separately)');
  } catch (e) {
    console.log('[persistQueue] Error:', e);
  }
}

// CRITICAL: Restore queue from storage when service worker starts
// NOTE: Restored items will NOT have binary data, so they can only be displayed in UI
// They will be skipped during processing (see kick() function)
// IMPORTANT: We should NOT restore the queue if it will just be skipped anyway!
function restoreQueueFromStorage() {
  console.log('[restoreQueueFromStorage] ========== ATTEMPTING TO RESTORE QUEUE ==========');
  chrome.storage.local.get(['persistedQueue'], (res) => {
    (async () => {
      console.log('[restoreQueueFromStorage] Storage result:', res);
      const state = res?.persistedQueue;
      if (state && state.queue && state.queue.length > 0) {
        const age = Date.now() - (state.timestamp || 0);
        console.log('[restoreQueueFromStorage] Queue age:', age, 'ms (', Math.round(age / 1000), 'seconds)');
        if (age < 3600000) {
          queue = state.queue.map((item, index) => ({
            ...item,
            id: item.id || createQueueItemId(item, index)
          }));
          isRunning = false;
          isPaused = state.isPaused || false;
          workerTabId = state.workerTabId;
          processedCount = state.processedCount || 0;

          requeueProcessingItems('restoreQueueFromStorage');

          console.log('[restoreQueueFromStorage] Restored queue with', queue.length, 'items');
          console.log('[restoreQueueFromStorage] Queue items:', queue.map(q => `${q.name}:${q.status}`));
          broadcastQueue();

          const hasPendingOrProcessing = queue.some(q => q.status === 'pending' || q.status === 'processing');
          if (hasPendingOrProcessing && !isPaused) {
            console.log('[restoreQueueFromStorage] Pending items found after restore, resuming kick()');
            setTimeout(() => kick(), 500);
          }
        } else {
          console.log('[restoreQueueFromStorage] Queue too old, clearing');
          chrome.storage.local.remove('persistedQueue');
          clearQueueFiles(state.queue.map(q => q.id)).catch((e) => console.log('[restoreQueueFromStorage] Error clearing stored queue items:', e));
        }
      } else {
        console.log('[restoreQueueFromStorage] No persisted queue found in storage');
      }
    })().catch((e) => {
      console.log('[restoreQueueFromStorage] Error:', e);
    }).finally(() => {
      console.log('[restoreQueueFromStorage] ========== RESTORE COMPLETE ==========');
    });
  });
}


// Listener for alarms (auto-pause)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'autoPauseResume') {
    // Wait for state to be restored
    await stateReadyPromise;

    console.log('[alarms] Auto-resume triggered');
    console.log('[alarms] Current queue length:', queue.length);
    console.log('[alarms] Current isPaused:', isPaused);
    console.log('[alarms] Current isRunning:', isRunning);

    // No need to restore the queue - it's still in memory
    // (the service worker was not restarted if the queue exists)

    isPaused = false;
    isRunning = false;
    autoPauseEndTime = null;

    // Clears persistent state
    chrome.storage.local.remove('autoPauseState');

    broadcastQueue();

    // Notifies ALL vectorizer tabs to ensure the countdown is cleared
    // (workerTabId might be stale or the tab might have been reloaded)
    console.log('[alarms] Sending resume to ALL vectorizer tabs...');
    chrome.tabs.query({ url: '*://*.vectorizer.ai/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'queue:resume' }).catch((e) => {
          console.log('[alarms] Error sending to tab:', tab.id, e);
        });
      });
    });

    console.log('[alarms] Calling kick()...');
    kick();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'queue:add') {
    (async () => {
      console.log('[queue:add] Received', msg.items?.length, 'items');

      queue = [];
      isRunning = false;
      isPaused = false;
      processedCount = 0;
      autoPauseEndTime = null;
      queueExplicitlyCancelled = false;
      chrome.alarms.clear('autoPauseResume');
      chrome.storage.local.remove('autoPauseState');
      chrome.storage.local.remove('manualPauseState');
      chrome.storage.local.remove('vectorizer-active-session');

      const items = (msg.items || []).map((it, index) => ({
        ...it,
        id: createQueueItemId(it, index),
        // Per-item option; falls back to the global default when the popup doesn't send it
        removeBackground: typeof it.removeBackground === 'boolean' ? it.removeBackground : removeBackground,
        status: 'pending'
      }));

      queue.push(...items);

      // Drop files left over from previous queues; the new items were stored by the popup.
      await VecFileStore.prune(items.map(item => item.id)).catch((e) => console.log('[queue:add] Error pruning file store:', e));
      clearLegacyQueueItemData().catch(() => { });

      console.log('[queue:add] Queue now has', queue.length, 'items');
      console.log('[queue:add] Queue items:', queue.map(q => q.name));

      persistQueue();
      broadcastQueue();
      kick();
      sendResponse?.({ queued: queue.length, queue: sanitizedQueue() });
    })().catch((e) => {
      console.log('[queue:add] Error:', e);
      sendResponse?.({ error: String(e) });
    });
    return true;
  }
  if (msg.type === 'poc:done') {
    console.log('[background] ========== POC:DONE RECEIVED ==========');
    console.log('[background] Received poc:done for:', msg.result?.name, 'status:', msg.result?.status);
    console.log('[background] Current queue length:', queue.length, 'isRunning:', isRunning, 'isPaused:', isPaused);
    console.log('[background] Queue items:', queue.map(q => `${q.name}:${q.status}`));

    // CRITICAL: Send response IMMEDIATELY to keep port open
    sendResponse?.({ received: true, timestamp: Date.now() });

    markDone(msg.result);
    console.log('[background] After markDone - isRunning:', isRunning, 'isPaused:', isPaused);
    console.log('[background] ========== POC:DONE PROCESSED ==========');
    return true; // Keep message channel open for async response
  }
  if (msg.type === 'queue:get') {
    sendResponse?.({
      queue: sanitizedQueue(),
      delaySeconds,
      format: downloadFormat,
      folder: downloadFolder,
      removeBackground,
      autoPause,
      autoPauseEndTime,
      isProcessing: queue.some(q => q.status === 'processing' || q.status === 'pending') || isPaused,
      isPaused
    });
    return;
  }
  if (msg.type === 'config:setDelay') {
    delaySeconds = Math.max(0, Number(msg.seconds) || 0);
    persistConfig();
    sendResponse?.({ delaySeconds });
    return;
  }
  if (msg.type === 'config:setFormat') {
    const fmt = String(msg.format || '').toLowerCase();
    if (fmt === 'eps' || fmt === 'svg') {
      downloadFormat = fmt;
    }
    persistConfig();
    sendResponse?.({ format: downloadFormat });
    return;
  }
  if (msg.type === 'config:setFolder') {
    downloadFolder = sanitizeFolder(String(msg.folder || ''));
    persistConfig();
    sendResponse?.({ folder: downloadFolder });
    return;
  }
  if (msg.type === 'config:setRemoveBackground') {
    removeBackground = Boolean(msg.removeBackground);
    persistConfig();
    sendResponse?.({ removeBackground });
    return;
  }
  if (msg.type === 'queue:updateItemRemoveBackground') {
    const target = queue.find(q => q.id === msg.itemId);
    // Only items that haven't started yet can still change
    if (target && target.status === 'pending') {
      target.removeBackground = Boolean(msg.removeBackground);
      persistQueue();
    }
    broadcastQueue();
    sendResponse?.({ ok: Boolean(target) });
    return;
  }
  if (msg.type === 'queue:setAllRemoveBackground') {
    const value = Boolean(msg.removeBackground);
    queue.forEach(q => {
      if (q.status === 'pending') q.removeBackground = value;
    });
    persistQueue();
    broadcastQueue();
    sendResponse?.({ ok: true });
    return;
  }
  if (msg.type === 'config:setAutoPause') {
    autoPause = {
      enabled: Boolean(msg.autoPause?.enabled),
      count: parseInt(msg.autoPause?.count) || 10,
      minMinutes: parseInt(msg.autoPause?.minMinutes) || 1,
      maxMinutes: parseInt(msg.autoPause?.maxMinutes) || 5
    };
    // Ensure max is always greater than min
    if (autoPause.maxMinutes <= autoPause.minMinutes) {
      autoPause.maxMinutes = autoPause.minMinutes + 1;
    }
    persistConfig();
    sendResponse?.({ autoPause });
    return;
  }
  if (msg.type === 'config:get') {
    sendResponse?.({ delaySeconds, format: downloadFormat, folder: downloadFolder, removeBackground, autoPause });
    return;
  }
  if (msg.type === 'pricing:retry') {
    retryItem(msg.id || msg.name);
    sendResponse?.();
    return;
  }
  if (msg.type === 'poc:retry') {
    retryItem(msg.id || msg.name);
    sendResponse?.();
    return;
  }
  // Pause processing
  if (msg.type === 'queue:pause') {
    isPaused = true;
    isRunning = false;
    requeueProcessingItems('manual-pause');
    persistQueue();
    console.log('[background] queue paused');
    broadcastQueue();
    // Persist visual state to simple storage (prevents UI clearing on suspend)
    persistQueueState(); // NEW: Saves queue structure

    // Notifies the worker tab
    if (workerTabId) {
      chrome.tabs.sendMessage(workerTabId, { type: 'queue:pause' }).catch(() => { });
    }
    sendResponse?.({ isPaused });
    return;
  }
  // Resume processing
  if (msg.type === 'queue:resume') {
    isPaused = false;
    isRunning = false; // Resets to allow kick()
    // Clears auto-pause alarm if it exists
    chrome.alarms.clear('autoPauseResume');
    chrome.storage.local.remove('autoPauseState');
    chrome.storage.local.remove('manualPauseState'); // NEW: Clear manual pause state
    autoPauseEndTime = null;
    console.log('[background] queue resumed');
    broadcastQueue();
    // Notifies the worker tab
    if (workerTabId) {
      chrome.tabs.sendMessage(workerTabId, { type: 'queue:resume' }).catch(() => { });
    }
    kick(); // Continues processing
    sendResponse?.({ isPaused });
    return;
  }
  // Cancel and clear queue
  if (msg.type === 'queue:cancel') {
    console.log('[background] ========== QUEUE CANCEL REQUESTED ==========');
    console.log('[background] Clearing queue with', queue.length, 'items');

    // CRITICAL: Set flag to prevent persistQueue from saving empty queue
    queueExplicitlyCancelled = true;

    const cancelledIds = queue.map(q => q.id);
    queue = [];
    isRunning = false;
    isPaused = false;
    processedCount = 0; // Resets counter
    workerTabId = null; // Resets workerTabId
    autoPauseEndTime = null;

    // Clears auto-pause alarm
    chrome.alarms.clear('autoPauseResume');

    // CRITICAL: Clear ALL storage related to queue
    chrome.storage.local.remove(['persistedQueue', 'autoPauseState', 'manualPauseState'], () => {
      console.log('[background] Storage cleared successfully');
      if (chrome.runtime.lastError) {
        console.log('[background] Error clearing storage:', chrome.runtime.lastError);
      }
    });
    clearQueueFiles(cancelledIds).catch((e) => console.log('[background] Error clearing stored queue items:', e));
    chrome.storage.local.remove('vectorizer-active-session');

    console.log('[background] Queue cleared, broadcasting update...');
    broadcastQueue();

    // Notifies ALL vectorizer tabs (not just workerTabId)
    chrome.tabs.query({ url: '*://*.vectorizer.ai/*' }, (tabs) => {
      console.log('[background] Notifying', tabs.length, 'vectorizer tabs to cancel');
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'queue:cancel' }).catch(() => { });
      });
    });

    console.log('[background] ========== QUEUE CANCEL COMPLETE ==========');
    sendResponse?.();
    return;
  }
  if (msg.type === 'keepAlive') {
    // Just to keep the service worker awake
    sendResponse?.({ status: 'alive' });
    return;
  }
  sendResponse?.();
});

async function kick() {
  console.log('[kick] Called. isRunning:', isRunning, 'isPaused:', isPaused, 'queue.length:', queue.length);

  if (isRunning) {
    console.log('[kick] Already running, returning');
    return;
  }
  if (isPaused) {
    console.log('[kick] Paused, returning');
    return;
  }

  const next = queue.find(q => q.status === 'pending');
  console.log('[kick] Next pending item:', next ? next.name : 'NONE');
  console.log('[kick] Queue statuses:', queue.map(q => q.status));

  if (!next) {
    console.log('[kick] No pending items, returning');
    return;
  }

  // Claim the run before any await so concurrent kick() calls cannot start a second item.
  isRunning = true;

  // The original is read from IndexedDB only now, one file at a time.
  let fileBlob = null;
  try {
    fileBlob = await VecFileStore.getFile(next.id);
  } catch (e) {
    console.log('[kick] Error reading stored file:', next.name, e);
  }

  if (!fileBlob) {
    console.log('[kick] Item without stored file, skipping:', next.name);
    isRunning = false;
    next.status = 'skipped'; // Marks as skipped
    persistQueue(); // Save skipped status
    broadcastQueue();
    // Continues to the next
    setTimeout(() => kick(), 100);
    return;
  }

  console.log('[kick] Processing:', next.name);
  next.status = 'processing';
  persistQueue(); // CRITICAL: Save processing status before sending to content script
  broadcastQueue();
  try {
    const tab = await ensureTab();
    const position = queue.findIndex(q => q.id === next.id || q.name === next.name) + 1;
    const payload = stripData(next);
    payload.type = payload.type || fileBlob.type;
    payload.dataBase64 = await blobToBase64(fileBlob);
    fileBlob = null;
    await sendProcessMessage(tab.id, payload, position, queue.length);
  } catch (e) {
    console.log('[kick] Error starting item, will retry:', next.name, e);
    if (next.status === 'processing') next.status = 'pending';
    isRunning = false;
    persistQueue();
    broadcastQueue();
    setTimeout(() => kick(), 3000);
  }
}

function stripData(item) {
  return { id: item.id, name: item.name, type: item.type, width: item.width, height: item.height, removeBackground: item.removeBackground };
}

async function ensureTab() {
  // Get the user's preferred language to use the correct locale URL
  let langCode = 'en'; // default to English
  try {
    const result = await chrome.storage.local.get('vectorizer-language');
    langCode = result['vectorizer-language'] || 'en';
  } catch (e) {
    console.log('[ensureTab] Error getting language:', e);
  }

  // Map language code to vectorizer.ai subdomain
  const subdomainMap = {
    'en': 'www',
    'pt': 'pt',
    'es': 'es',
    'fr': 'fr',
    'de': 'de',
    'it': 'it',
    'ja': 'ja',
    'ko': 'ko',
    'ru': 'ru',
    'zh': 'zh',
    'hi': 'hi',
    'id': 'id',
    'pl': 'pl',
    'th': 'th',
    'tr': 'tr',
    'vi': 'vi'
  };

  const subdomain = subdomainMap[langCode] || 'www';
  const homeUrl = `https://${subdomain}.vectorizer.ai/`;

  if (workerTabId) {
    try {
      const existingTab = await chrome.tabs.get(workerTabId);
      const tabUrl = existingTab.url || '';

      // Check if tab is on an image result page (e.g., /images/...)
      // If so, we need to navigate back to home for the next upload
      const isOnImagePage = tabUrl.includes('/images/');

      if (isOnImagePage) {
        console.log('[ensureTab] ========== NAVIGATING BACK TO HOME ==========');
        console.log('[ensureTab] Current URL:', tabUrl);
        console.log('[ensureTab] Target home URL:', homeUrl);

        await chrome.tabs.update(workerTabId, { url: homeUrl });
        console.log('[ensureTab] Navigation initiated, waiting for page to load...');

        // Wait for the page to load before returning
        // We need to wait for the content script to be ready
        await new Promise(resolve => {
          let resolved = false;
          const checkReady = (tabId, changeInfo) => {
            if (tabId === workerTabId && changeInfo.status === 'complete' && !resolved) {
              console.log('[ensureTab] Tab load complete event received');
              resolved = true;
              chrome.tabs.onUpdated.removeListener(checkReady);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(checkReady);
          // Timeout after 15 seconds
          setTimeout(() => {
            if (!resolved) {
              console.log('[ensureTab] Timeout waiting for tab load, continuing anyway');
              resolved = true;
              chrome.tabs.onUpdated.removeListener(checkReady);
              resolve();
            }
          }, 15000);
        });

        // Additional delay to ensure content script is fully loaded
        console.log('[ensureTab] Waiting 2s for content script to initialize...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('[ensureTab] ========== NAVIGATION COMPLETE ==========');
        const updatedTab = await chrome.tabs.get(workerTabId);
        console.log('[ensureTab] Returning tab with URL:', updatedTab.url);
        return updatedTab;
      }

      console.log('[ensureTab] Tab exists and is on valid page, reusing');
      return existingTab;
    } catch (e) {
      console.log('[ensureTab] Error getting existing tab, will create new:', e);
      /* recreate below */
    }
  }

  console.log('[ensureTab] Creating new tab with locale URL:', homeUrl);
  const tab = await chrome.tabs.create({ url: homeUrl });
  workerTabId = tab.id;
  return tab;
}

function markDone(result) {
  console.log('[markDone] START - result:', result.name, 'status:', result.status);
  console.log('[markDone] Queue before:', queue.map(q => `${q.name}:${q.status}`));

  const idx = queue.findIndex(q => (result.id && q.id === result.id) || q.name === result.name);
  if (idx >= 0) {
    queue[idx].status = result.status;
    console.log('[markDone] Updated queue[' + idx + '] to status:', result.status);
    persistQueue(); // CRITICAL: Save updated queue to storage
    if (result.status === 'done' || result.status === 'error' || result.status === 'skipped') {
      removeQueueItemData(queue[idx].id).catch((e) => console.log('[markDone] Error removing item data:', e));
    }
  } else {
    console.log('[markDone] WARNING: Item not found in queue!');
  }

  console.log('[markDone] Queue after update:', queue.map(q => `${q.name}:${q.status}`));

  // Only registers the URL to override name/folder when the site starts the download.
  if (result.status === 'done' && result.downloadUrl) {
    downloadNameMap.set(result.downloadUrl, result.name);
  }

  // Increments counter if completed successfully
  if (result.status === 'done') {
    processedCount++;
    console.log('[markDone] processedCount:', processedCount, 'autoPause:', autoPause);

    // Checks if it should auto-pause
    if (autoPause.enabled && processedCount >= autoPause.count) {
      // Checks if there are still pending items in the queue
      const hasPendingItems = queue.some(q => q.status === 'pending');

      if (!hasPendingItems) {
        console.log('[markDone] Auto-pause triggered but no pending items, skipping pause');
        processedCount = 0; // Resets counter anyway
      } else {
        console.log('[markDone] Auto-pause triggered after', processedCount, 'images');
        processedCount = 0; // Resets counter
        isPaused = true;
        isRunning = false; // Resets to allow kick() on timer
        // Generate random pause duration between min and max minutes
        const randomMinutes = autoPause.minMinutes + Math.random() * (autoPause.maxMinutes - autoPause.minMinutes);
        const pauseDurationMs = Math.round(randomMinutes * 60 * 1000);
        console.log('[markDone] Random pause duration:', randomMinutes.toFixed(2), 'minutes (', pauseDurationMs, 'ms)');
        autoPauseEndTime = Date.now() + pauseDurationMs;

        // Persists pause state AND the queue to survive service worker restarts
        chrome.storage.local.set({
          autoPauseState: {
            isPaused: true,
            endTime: autoPauseEndTime,
            queue: queue.map(q => ({ id: q.id, name: q.name, type: q.type, status: q.status, size: q.size })), // Without data (too large)
            workerTabId
          }
        });

        // Schedules automatic resume using chrome.alarms (persists even if worker suspends)
        chrome.alarms.clear('autoPauseResume');
        chrome.alarms.create('autoPauseResume', {
          when: autoPauseEndTime
        });
        console.log('[markDone] Alarm set for', new Date(autoPauseEndTime).toLocaleTimeString());

        broadcastQueue();
        // Notifies the worker tab about the pause
        broadcastQueue();
        // Notifies ALL vectorizer tabs about the pause to ensure Keep-Alive starts
        chrome.tabs.query({ url: '*://*.vectorizer.ai/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'queue:autoPause', endTime: autoPauseEndTime }).catch(() => { });
          });
        });
        return; // Does not call kick(), remains paused
      }
    }
  }

  console.log('[markDone] About to broadcast and kick. Queue length:', queue.length);
  console.log('[markDone] Queue after all processing:', queue.map(q => `${q.name}:${q.status}`));
  broadcastQueue();
  isRunning = false;

  // Check if all items are done - if so, clear persisted queue
  const hasPendingOrProcessing = queue.some(q => q.status === 'pending' || q.status === 'processing');
  console.log('[markDone] hasPendingOrProcessing:', hasPendingOrProcessing);
  if (!hasPendingOrProcessing && queue.length > 0) {
    console.log('[markDone] All items done, clearing queue and persisted state');
    chrome.storage.local.remove(['persistedQueue', 'manualPauseState', 'autoPauseState', 'vectorizer-active-session']);
    queue = [];
    isRunning = false;
    isPaused = false;
    processedCount = 0;
    autoPauseEndTime = null;
    workerTabId = null;
    broadcastQueue();
    return;
  }

  const waitMs = delaySeconds > 0 ? delaySeconds * 1000 : 0;
  console.log('[markDone] Delay configured:', delaySeconds, 'seconds =', waitMs, 'ms');

  // CRITICAL FIX: Always request keep-alive when there are pending items
  // This prevents the Service Worker from being suspended during the delay between images
  const stillHasPending = queue.some(q => q.status === 'pending');
  if (stillHasPending && workerTabId) {
    // Request keep-alive for at least the delay duration + extra time for navigation
    const keepAliveDuration = Math.max(waitMs + 20000, 30000); // At least 30 seconds
    console.log('[markDone] Still has pending items, requesting keep-alive for', keepAliveDuration, 'ms');
    chrome.tabs.sendMessage(workerTabId, { type: 'queue:wait', duration: keepAliveDuration }).catch(() => { });
  }

  console.log('[markDone] ========== CALLING KICK AFTER', waitMs, 'ms ==========');
  if (waitMs > 0) setTimeout(() => kick(), waitMs); else kick();
}

function sanitizedQueue() {
  return queue.map(({ id, name, type, status, size, removeBackground }) => ({ id, name, type, status, size, removeBackground: Boolean(removeBackground) }));
}

function broadcastQueue() {
  const hasPendingOrProcessing = queue.some(q => q.status === 'processing' || q.status === 'pending');
  // isProcessing is true if there are items in the queue OR if it's paused (to keep buttons active)
  const isProcessingOrPaused = hasPendingOrProcessing || isPaused;
  chrome.runtime.sendMessage({
    type: 'queue:update',
    queue: sanitizedQueue(),
    delaySeconds,
    format: downloadFormat,
    folder: downloadFolder,
    removeBackground,
    autoPause,
    autoPauseEndTime,
    isProcessing: isProcessingOrPaused,
    isPaused
  }).catch(() => { /* popup closed, ignore */ });
}

function buildFilename(originalName, downloadUrl) {
  let urlExt = 'svg';
  try {
    const parsed = new URL(downloadUrl);
    const urlPath = parsed.pathname || '';
    const urlExtMatch = urlPath.match(/\.([a-zA-Z0-9]+)$/);
    urlExt = urlExtMatch ? urlExtMatch[1].toLowerCase() : 'svg';
  } catch (_) {
    // keep default
  }
  const base = originalName.replace(/\.[^.]+$/, '');
  return `${base}.${urlExt}`;
}

function isDownloadable(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return /\.(svg|pdf|eps|dxf|png|jpg|jpeg)$/.test(path);
  } catch (_) {
    return false;
  }
}

function sanitizeFolder(input) {
  let clean = input.trim().replace(/^[\\/]+/, '').replace(/(\.\.(?:\\|\/|$))/g, '');
  return clean;
}

function persistConfig() {
  try {
    chrome.storage.local.set({
      vectorizerConfig: {
        delaySeconds,
        downloadFormat,
        downloadFolder,
        removeBackground,
        autoPause
      }
    });
  } catch (e) {
    // ignore
  }
}

function loadConfig() {
  try {
    chrome.storage.local.get(['vectorizerConfig'], (res) => {
      if (chrome.runtime.lastError) return;
      const cfg = res?.vectorizerConfig || {};
      if (typeof cfg.delaySeconds === 'number') delaySeconds = cfg.delaySeconds;
      if (cfg.downloadFormat === 'svg' || cfg.downloadFormat === 'eps') downloadFormat = cfg.downloadFormat;
      if (typeof cfg.downloadFolder === 'string') downloadFolder = sanitizeFolder(cfg.downloadFolder);
      if (typeof cfg.removeBackground === 'boolean') removeBackground = cfg.removeBackground;
      if (cfg.autoPause) {
        autoPause = {
          enabled: Boolean(cfg.autoPause.enabled),
          count: parseInt(cfg.autoPause.count) || 10,
          minMinutes: parseInt(cfg.autoPause.minMinutes) || 1,
          maxMinutes: parseInt(cfg.autoPause.maxMinutes) || 5
        };
        // Ensure max is always greater than min
        if (autoPause.maxMinutes <= autoPause.minMinutes) {
          autoPause.maxMinutes = autoPause.minMinutes + 1;
        }
      }
      broadcastQueue();
    });
  } catch (e) {
    // ignore
  }
}

function registerDownloadHandler() {
  if (chrome.downloads && chrome.downloads.onDeterminingFilename.hasListener(onDetermineFilename)) return;
  chrome.downloads.onDeterminingFilename.addListener(onDetermineFilename);
}

// Load persisted auto-pause state
function loadAutoPauseState() {
  chrome.storage.local.get(['manualPauseState'], (res) => {
    (async () => {
      try {
        if (res.manualPauseState && res.manualPauseState.queue) {
          console.log('[loadAutoPauseState] Found manualPauseState, restoring visual queue...');
          queue = (res.manualPauseState.queue || []).map((item, index) => ({ ...item, id: item.id || createQueueItemId(item, index) }));
          requeueProcessingItems('load-manual-pause');
          isPaused = true;
          isRunning = false;
        }
      } catch (e) {
        console.log('[loadAutoPauseState] manual state error', e);
      }

      try {
        chrome.storage.local.get(['autoPauseState'], (res) => {
          (async () => {
            try {
              if (chrome.runtime.lastError) return;
              const state = res?.autoPauseState;
              if (state && state.isPaused && state.endTime) {
                const now = Date.now();

                if (state.queue && state.queue.length > 0) {
                  queue = state.queue.map((item, index) => ({ ...item, id: item.id || createQueueItemId(item, index) }));
                  requeueProcessingItems('load-auto-pause');
                  console.log('[loadAutoPauseState] Restored queue with', queue.length, 'items');
                }
                if (state.workerTabId) {
                  workerTabId = state.workerTabId;
                  console.log('[loadAutoPauseState] Restored workerTabId:', workerTabId);
                }

                if (state.endTime > now) {
                  console.log('[loadAutoPauseState] Restoring auto-pause state, ends at', new Date(state.endTime).toLocaleTimeString());
                  isPaused = true;
                  autoPauseEndTime = state.endTime;
                  isRunning = false;
                  chrome.alarms.clear('autoPauseResume');
                  chrome.alarms.create('autoPauseResume', {
                    when: state.endTime
                  });
                  broadcastQueue();
                } else {
                  console.log('[loadAutoPauseState] Auto-pause expired, resuming...');
                  chrome.storage.local.remove('autoPauseState');
                  isPaused = false;
                  autoPauseEndTime = null;
                  isRunning = false;
                  broadcastQueue();
                  kick();
                }
              } else {
                broadcastQueue();
              }
            } catch (innerErr) {
              console.log('[loadAutoPauseState] inner error', innerErr);
            } finally {
              if (stateReadyPromiseResolve) stateReadyPromiseResolve();
            }
          })();
        });
      } catch (e) {
        console.log('[loadAutoPauseState] error', e);
        if (stateReadyPromiseResolve) stateReadyPromiseResolve();
      }
    })();
  });
}

function persistQueueState() {
  try {
    chrome.storage.local.set({
      manualPauseState: {
        isPaused: true,
        queue: queue.map(q => ({ id: q.id, name: q.name, type: q.type, status: q.status, size: q.size })) // Light backup
      }
    });
  } catch (_) { }
}

function onDetermineFilename(item, suggest) {
  try {
    const url = item.finalUrl || item.url || '';
    if (!/vectorizer\.ai/.test(url)) return;

    // If there's a mapping, uses the original name; otherwise, reuses the name suggested by the site.
    const mappedName = getMappedName(url);
    let fname;
    if (mappedName) {
      fname = buildFilename(mappedName, url);
    } else {
      // fallback: use filename suggested by site
      const suggested = item.filename || '';
      fname = downloadFolder ? suggested.split(/[\\/]/).pop() : suggested;
    }

    const path = downloadFolder ? `${downloadFolder}/${fname}` : fname;
    suggest({ filename: path, conflictAction: 'uniquify' });
    console.log('[Vectorizer-Ext] overriding filename', path);
  } catch (e) {
    console.log('[Vectorizer-Ext] onDetermineFilename error', e);
  }
}

function getMappedName(url) {
  if (downloadNameMap.has(url)) return downloadNameMap.get(url);
  // try to match without querystring
  try {
    const parsed = new URL(url);
    const key = parsed.origin + parsed.pathname;
    return downloadNameMap.get(key);
  } catch (_) {
    return null;
  }
}

// Waits for the content script to be ready by sending ping messages
async function waitForContentScript(tabId, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, { type: 'ping' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        });
      });

      if (response && response.pong) {
        console.log('[waitForContentScript] Content script is ready after', attempt + 1, 'attempts');
        return true;
      }
    } catch (e) {
      console.log('[waitForContentScript] Attempt', attempt + 1, '- Content script not ready:', e.message);
    }

    // Wait before next attempt (increasing delay)
    await new Promise(resolve => setTimeout(resolve, 500 + (attempt * 200)));
  }

  console.log('[waitForContentScript] Content script not ready after', maxAttempts, 'attempts');
  return false;
}

function sendProcessMessage(tabId, item, position, total, attempt = 0) {
  console.log('[sendProcessMessage] ========== SENDING POC:PROCESS ==========');
  console.log('[sendProcessMessage] TabId:', tabId);
  console.log('[sendProcessMessage] File:', item.name);
  console.log('[sendProcessMessage] Position:', position, '/', total);
  console.log('[sendProcessMessage] Attempt:', attempt);
  console.log('[sendProcessMessage] ==========================================');

  return new Promise(async (resolve) => {
    // First, wait for the content script to be ready
    if (attempt === 0) {
      console.log('[sendProcessMessage] Waiting for content script to be ready...');
      const isReady = await waitForContentScript(tabId);
      if (!isReady) {
        console.log('[sendProcessMessage] Content script not ready, will retry...');
        // Mark as pending and try again later
        const idx = queue.findIndex(q => (item.id && q.id === item.id) || q.name === item.name);
        if (idx >= 0) queue[idx].status = 'pending';
        isRunning = false;
        persistQueue();
        // Try to kick again after a longer delay
        setTimeout(() => kick(), 3000);
        return resolve();
      }
    }

    chrome.tabs.sendMessage(tabId, { type: 'poc:process', item, format: downloadFormat, removeBackground: typeof item.removeBackground === 'boolean' ? item.removeBackground : removeBackground, meta: { position, total } }, () => {
      if (chrome.runtime.lastError) {
        console.log('[sendProcessMessage] ERROR:', chrome.runtime.lastError.message);
        if (attempt < 5) { // Increased max retries
          console.log('[sendProcessMessage] Retrying... (attempt', attempt + 1, ')');
          // Increased delay between retries
          return setTimeout(() => resolve(sendProcessMessage(tabId, item, position, total, attempt + 1)), 1000);
        } else {
          console.log('[sendProcessMessage] Max retries reached, marking as pending');
          // refile to pending so it can retry later
          const idx = queue.findIndex(q => (item.id && q.id === item.id) || q.name === item.name);
          if (idx >= 0) queue[idx].status = 'pending';
          isRunning = false;
          persistQueue();
          return resolve();
        }
      }
      console.log('[sendProcessMessage] Message sent successfully!');
      resolve();
    });
  });
}

function retryItem(nameOrId) {
  const idx = queue.findIndex(q => q.id === nameOrId || q.name === nameOrId);
  if (idx >= 0) {
    queue[idx].status = 'pending';
    isRunning = false;
    persistQueue();
    broadcastQueue();
    kick();
  }
}
