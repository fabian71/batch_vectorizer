let queue = [];
let isRunning = false;
let isPaused = false;
let workerTabId = null;
let delaySeconds = 5;
let downloadFormat = 'eps';
let downloadFolder = '';
let removeBackground = false;
let autoPause = { enabled: false, count: 10, minutes: 5 };
let processedCount = 0; // Counter for processed images since last pause
let autoPauseEndTime = null; // When the automatic pause ends
const downloadNameMap = new Map();


let stateReadyPromiseResolve;
const stateReadyPromise = new Promise(resolve => stateReadyPromiseResolve = resolve);

loadConfig();
registerDownloadHandler();
loadAutoPauseState(); // Loads auto-pause state if it exists


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
    console.log('[queue:add] Received', msg.items?.length, 'items');

    // Clears existing queue and resets state
    queue = [];
    isRunning = false;
    isPaused = false;
    processedCount = 0;
    autoPauseEndTime = null;
    chrome.alarms.clear('autoPauseResume');
    chrome.storage.local.remove('autoPauseState');

    // Adds new items
    queue.push(...msg.items.map(it => ({ ...it, status: 'pending' })));

    console.log('[queue:add] Queue now has', queue.length, 'items');
    console.log('[queue:add] Queue items:', queue.map(q => q.name));

    broadcastQueue();
    kick();
    sendResponse?.();
    return;
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
  if (msg.type === 'config:setAutoPause') {
    autoPause = {
      enabled: Boolean(msg.autoPause?.enabled),
      count: parseInt(msg.autoPause?.count) || 10,
      minutes: parseInt(msg.autoPause?.minutes) || 5
    };
    persistConfig();
    sendResponse?.({ autoPause });
    return;
  }
  if (msg.type === 'config:get') {
    sendResponse?.({ delaySeconds, format: downloadFormat, folder: downloadFolder, removeBackground, autoPause });
    return;
  }
  if (msg.type === 'pricing:retry') {
    retryItem(msg.name);
    sendResponse?.();
    return;
  }
  if (msg.type === 'poc:retry') {
    retryItem(msg.name);
    sendResponse?.();
    return;
  }
  // Pause processing
  if (msg.type === 'queue:pause') {
    isPaused = true;
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
    console.log('[background] queue cancelled and cleared');
    queue = [];
    isRunning = false;
    isPaused = false;
    processedCount = 0; // Resets counter
    // Clears auto-pause alarm
    chrome.alarms.clear('autoPauseResume');
    chrome.storage.local.remove('autoPauseState');
    chrome.storage.local.remove('manualPauseState'); // NEW: Clear manual pause state
    autoPauseEndTime = null;
    broadcastQueue();
    // Notifies ALL vectorizer tabs (not just workerTabId)
    chrome.tabs.query({ url: '*://*.vectorizer.ai/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'queue:cancel' }).catch(() => { });
      });
    });
    workerTabId = null; // Resets workerTabId
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

  // Checks if the item has data (it might not if restored from storage)
  if (!next.data || next.data.length === 0) {
    console.log('[kick] Item without data, skipping:', next.name);
    next.status = 'skipped'; // Marks as skipped
    broadcastQueue();
    // Continues to the next
    setTimeout(() => kick(), 100);
    return;
  }

  console.log('[kick] Processing:', next.name);
  next.status = 'processing';
  broadcastQueue();
  isRunning = true;
  const tab = await ensureTab();
  const position = queue.findIndex(q => q.name === next.name) + 1;
  await sendProcessMessage(tab.id, stripData(next), position, queue.length);
}

function stripData(item) {
  return { name: item.name, type: item.type, data: item.data, width: item.width, height: item.height };
}

async function ensureTab() {
  if (workerTabId) {
    try { return await chrome.tabs.get(workerTabId); } catch (e) { /* recreate below */ }
  }
  const tab = await chrome.tabs.create({ url: 'https://pt.vectorizer.ai/' });
  workerTabId = tab.id;
  return tab;
}

function markDone(result) {
  console.log('[markDone] START - result:', result.name, 'status:', result.status);
  console.log('[markDone] Queue before:', queue.map(q => `${q.name}:${q.status}`));

  const idx = queue.findIndex(q => q.name === result.name);
  if (idx >= 0) {
    queue[idx].status = result.status;
    console.log('[markDone] Updated queue[' + idx + '] to status:', result.status);
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
        autoPauseEndTime = Date.now() + (autoPause.minutes * 60 * 1000);

        // Persists pause state AND the queue to survive service worker restarts
        chrome.storage.local.set({
          autoPauseState: {
            isPaused: true,
            endTime: autoPauseEndTime,
            queue: queue.map(q => ({ name: q.name, type: q.type, status: q.status, size: q.size })), // Without data (too large)
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
  broadcastQueue();
  isRunning = false;
  const waitMs = delaySeconds > 0 ? delaySeconds * 1000 : 0;

  // Se o tempo de espera for longo, pede para a aba manter o worker vivo
  if (waitMs > 20000 && workerTabId) {
    console.log('[markDone] Long wait detected, requesting keep-alive for', waitMs, 'ms');
    chrome.tabs.sendMessage(workerTabId, { type: 'queue:wait', duration: waitMs }).catch(() => { });
  }

  console.log('[markDone] Calling kick() after', waitMs, 'ms delay');
  if (waitMs > 0) setTimeout(() => kick(), waitMs); else kick();
}

function sanitizedQueue() {
  return queue.map(({ name, type, status, data, size }) => ({ name, type, status, data, size }));
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
          minutes: parseInt(cfg.autoPause.minutes) || 5
        };
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
  // First, check general Manual Pause state (Pricing/User pause)
  chrome.storage.local.get(['manualPauseState'], (res) => {
    try {
      if (res.manualPauseState && res.manualPauseState.queue) {
        console.log('[loadAutoPauseState] Found manualPauseState, restoring visual queue...');
        queue = res.manualPauseState.queue || [];
        isPaused = true;
        isRunning = false;
      }
    } catch (_) { }

    // Then check Auto Pause state (overrides if exists)
    try {
      chrome.storage.local.get(['autoPauseState'], (res) => {
        // Must resolve the promise regardless of outcome
        try {
          if (chrome.runtime.lastError) return;
          const state = res?.autoPauseState;
          if (state && state.isPaused && state.endTime) {
            const now = Date.now();

            // Restore queue and workerTabId if they exist
            if (state.queue && state.queue.length > 0) {
              queue = state.queue;
              console.log('[loadAutoPauseState] Restored queue with', queue.length, 'items');
            }
            if (state.workerTabId) {
              workerTabId = state.workerTabId;
              console.log('[loadAutoPauseState] Restored workerTabId:', workerTabId);
            }

            if (state.endTime > now) {
              // Pause is still active
              console.log('[loadAutoPauseState] Restoring auto-pause state, ends at', new Date(state.endTime).toLocaleTimeString());
              isPaused = true;
              autoPauseEndTime = state.endTime;
              isRunning = false;
              // Recreates the alarm
              chrome.alarms.clear('autoPauseResume');
              chrome.alarms.create('autoPauseResume', {
                when: state.endTime
              });
              broadcastQueue();
            } else {
              // Already expired, clears and resumes
              console.log('[loadAutoPauseState] Auto-pause expired, resuming...');
              chrome.storage.local.remove('autoPauseState');
              isPaused = false;
              autoPauseEndTime = null;
              isRunning = false;
              broadcastQueue();
              kick();
            }
          } else {
            // If no auto-pause, verify broadcast for manual pause
            broadcastQueue();
          }
        } catch (innerErr) {
          console.log('[loadAutoPauseState] inner error', innerErr);
        } finally {
          if (stateReadyPromiseResolve) stateReadyPromiseResolve();
        }
      });
    } catch (e) {
      console.log('[loadAutoPauseState] error', e);
      if (stateReadyPromiseResolve) stateReadyPromiseResolve();
    }
  });
}

function persistQueueState() {
  try {
    chrome.storage.local.set({
      manualPauseState: {
        isPaused: true,
        queue: queue.map(q => ({ name: q.name, type: q.type, status: q.status, size: q.size })) // Light backup
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

function sendProcessMessage(tabId, item, position, total, attempt = 0) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'poc:process', item, format: downloadFormat, removeBackground, meta: { position, total } }, () => {
      if (chrome.runtime.lastError) {
        console.log('[Vectorizer-Ext] sendMessage error', chrome.runtime.lastError.message);
        if (attempt < 3) {
          return setTimeout(() => resolve(sendProcessMessage(tabId, item, position, total, attempt + 1)), 500);
        } else {
          // refile to pending so it can retry later
          const idx = queue.findIndex(q => q.name === item.name);
          if (idx >= 0) queue[idx].status = 'pending';
          isRunning = false;
          return resolve();
        }
      }
      resolve();
    });
  });
}

function retryItem(name) {
  const idx = queue.findIndex(q => q.name === name);
  if (idx >= 0) {
    queue[idx].status = 'pending';
    isRunning = false;
    broadcastQueue();
    kick();
  }
}
