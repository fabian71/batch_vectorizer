const fileInput = document.getElementById('files');
const startBtn = document.getElementById('start');
const grid = document.getElementById('grid');
const delayInput = document.getElementById('delay');
const formatSelect = document.getElementById('format');
const folderInput = document.getElementById('folder');
const folderSummary = document.getElementById('folder-summary');
const removeBackgroundCheckbox = document.getElementById('removeBackground');
const pauseBtn = document.getElementById('pauseBtn');
const cancelBtn = document.getElementById('cancelBtn');
const autoPauseEnabled = document.getElementById('autoPauseEnabled');
const autoPauseConfig = document.getElementById('autoPauseConfig');
const autoPauseCount = document.getElementById('autoPauseCount');
const autoPauseMinutes = document.getElementById('autoPauseMinutes');
const dropzone = document.getElementById('dropzone');
const langSelect = document.getElementById('langSelect');
const clearQueueBtn = document.getElementById('clearQueueBtn');
const clearQueueContainer = document.getElementById('clearQueueContainer');

// License elements
const licenseModal = document.getElementById('licenseModal');
const licenseKeyInput = document.getElementById('licenseKeyInput');
const verifyLicenseBtn = document.getElementById('verifyLicenseBtn');
const licenseError = document.getElementById('licenseError');
const buyLicenseLink = document.getElementById('buyLicenseLink');

// CONFIGURATION: Replace with your actual Gumroad Product ID
const GUMROAD_PRODUCT_ID = 'wiMaBP3bXVyY4UCrBeQEfQ==';

let files = [];
let previews = new Map(); // name -> objectURL
let isPaused = false;
let isProcessing = false;
let isLicenseValid = false;

// Initialize language selector
function initLanguageSelector() {
  const languages = getAvailableLanguages();
  const currentLang = getCurrentLanguage();

  langSelect.innerHTML = languages.map(lang =>
    `<option value="${lang.code}" ${lang.code === currentLang ? 'selected' : ''}>${lang.flag} ${lang.name}</option>`
  ).join('');

  langSelect.onchange = () => {
    setLanguage(langSelect.value);
    applyTranslations();
    // Re-render queue with new language
    // If there are local files selected, preserve them
    if (files.length > 0) {
      renderLocalSelection();
    } else {
      chrome.runtime.sendMessage({ type: 'queue:get' }, (res) => {
        if (res && res.queue) renderQueue(res.queue);
      });
    }
  };
}

// Apply translations to all elements with data-i18n attribute
function applyTranslations() {
  // Update elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Update titles with data-i18n-title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });

  // Update specific elements
  document.querySelector('.dropzone-text').textContent = t('dropzone');
  document.querySelector('.file-btn').textContent = t('selectFiles');
  document.querySelector('.queue-title').innerHTML = `📋 ${t('queue')}`;

  // Update checkboxes
  const bgCheckLabel = removeBackgroundCheckbox?.closest('.checkbox-item')?.querySelector('span');
  if (bgCheckLabel) bgCheckLabel.textContent = `🎨 ${t('removeBackground')}`;

  const pauseCheckLabel = autoPauseEnabled?.closest('.checkbox-item')?.querySelector('span');
  if (pauseCheckLabel) pauseCheckLabel.textContent = `⏱ ${t('scheduledPause')}`;

  // Update auto-pause config (only updates spans, does not destroy inputs)
  const autoPauseRows = document.querySelectorAll('.auto-pause-row');
  if (autoPauseRows[0]) {
    const spans = autoPauseRows[0].querySelectorAll('span');
    if (spans[0]) spans[0].textContent = t('every');
    if (spans[1]) spans[1].textContent = t('images');
  }
  if (autoPauseRows[1]) {
    const spans = autoPauseRows[1].querySelectorAll('span');
    if (spans[0]) spans[0].textContent = t('pauseFor');
    if (spans[1]) spans[1].textContent = t('minutes');
  }

  // Update buttons
  startBtn.innerHTML = `🚀 ${t('start')}`;
  pauseBtn.textContent = isPaused ? `▶ ${t('resume')}` : `⏸ ${t('pause')}`;
  cancelBtn.textContent = `✕ ${t('cancel')}`;

  // Update warning
  const warning = document.querySelector('.card-body > p');
  if (warning) warning.innerHTML = `⚠️ ${t('warning')}`;

  // Update info modal title
  const infoModalTitle = document.getElementById('infoModalTitle');
  if (infoModalTitle) infoModalTitle.textContent = t('howItWorks');

  // Update folder summary
  if (folderSummary) folderSummary.textContent = `${t('savedIn')} ${folderInput?.value || 'Downloads'}`;

  // Update seg label
  const segLabel = document.getElementById('secLabel');
  if (segLabel) segLabel.textContent = t('sec');

  // Update download tip
  const downloadTip = document.getElementById('downloadTip');
  if (downloadTip) downloadTip.textContent = t('downloadTip');
}

// Initialize on load (wait for language to load from storage)
(async function () {
  await initLanguage();
  initLanguageSelector();
  applyTranslations();

  // Check license
  await checkLicense();

  // Set version
  const manifest = chrome.runtime.getManifest();
  const verEl = document.getElementById('extVersion');
  if (verEl) verEl.textContent = manifest.version;

  // Re-render queue with correct language
  chrome.runtime.sendMessage({ type: 'queue:get' }, (res) => {
    if (res && res.queue) renderQueue(res.queue);
  });
})();

// ========== DEV MODE ==========
// Set to true to bypass license check during development
// IMPORTANT: Set to false before distribution!
const DEV_MODE = false;
// ==============================

// License Logic
async function checkLicense() {
  // DEV MODE: Skip license check
  if (DEV_MODE) {
    console.log('[DEV MODE] License check bypassed');
    isLicenseValid = true;
    licenseModal.classList.remove('show');
    return;
  }

  const data = await chrome.storage.local.get(['licenseKey', 'licenseValid']);
  if (data.licenseValid && data.licenseKey) {
    isLicenseValid = true;
    licenseModal.classList.remove('show');
  } else {
    isLicenseValid = false;
    licenseModal.classList.add('show');
  }
}

verifyLicenseBtn.onclick = async () => {
  const key = licenseKeyInput.value.trim();
  if (!key) {
    showLicenseError(t('licenseInvalid'));
    return;
  }

  verifyLicenseBtn.textContent = '...';
  verifyLicenseBtn.disabled = true;
  licenseError.style.display = 'none';

  try {
    const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `product_id=${GUMROAD_PRODUCT_ID}&license_key=${key}`
    });

    const data = await response.json();

    if (data.success && !data.purchase.refunded && !data.purchase.chargebacked) {
      // Valid license
      await chrome.storage.local.set({
        licenseKey: key,
        licenseValid: true
      });
      isLicenseValid = true;
      licenseModal.classList.remove('show');
      // Optional: Show success toast
    } else {
      // Invalid license
      isLicenseValid = false;
      showLicenseError(t('licenseInvalid'));
      await chrome.storage.local.remove(['licenseValid']);
    }
  } catch (error) {
    console.error('License check error:', error);
    showLicenseError(t('licenseCheckError'));
  } finally {
    verifyLicenseBtn.textContent = t('verifyLicense');
    verifyLicenseBtn.disabled = false;
  }
};

function showLicenseError(msg) {
  licenseError.textContent = msg;
  licenseError.style.display = 'block';
}

if (buyLicenseLink) {
  buyLicenseLink.onclick = (e) => {
    e.preventDefault();
    window.open('https://dentparanoid.gumroad.com/l/batch-vectorizer', '_blank');
  }
}

fileInput.onchange = () => {
  files = [...fileInput.files];
  renderLocalSelection();
  highlightQueue(); // Trigger animation
};

// Drag and Drop handlers
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');

  const droppedFiles = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
  if (droppedFiles.length > 0) {
    files = droppedFiles;
    renderLocalSelection();
    highlightQueue(); // Trigger animation
  }
});

// Modal handlers
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModal = document.getElementById('closeModal');

if (infoBtn && infoModal && closeModal) {
  infoBtn.onclick = () => {
    infoModal.classList.add('show');
  };

  closeModal.onclick = () => {
    infoModal.classList.remove('show');
  };

  infoModal.onclick = (e) => {
    if (e.target === infoModal) {
      infoModal.classList.remove('show');
    }
  };
}

startBtn.onclick = async () => {
  if (!files.length) return;

  // Check if on Vectorizer page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';

  if (!url.includes('vectorizer.ai')) {
    // Show error message
    showError('needVectorizer');
    return;
  }

  const payload = await Promise.all(files.map(async f => {
    const data = Array.from(new Uint8Array(await f.arrayBuffer()));

    // Extract image dimensions
    const dimensions = await getImageDimensions(f);

    return {
      name: f.name,
      type: f.type,
      size: f.size,
      data,
      width: dimensions.width,
      height: dimensions.height
    };
  }));
  chrome.runtime.sendMessage({ type: 'queue:add', items: payload });
  files = [];
  renderLocalSelection();
};

// Extract width and height from an image
function getImageDimensions(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 }); // Fallback if failed
    };
    img.src = url;
  });
}

// Show temporary error message
function showError(key) {
  const existingError = document.getElementById('error-msg');
  if (existingError) existingError.remove();

  const errorDiv = document.createElement('div');
  errorDiv.id = 'error-msg';
  errorDiv.style.cssText = `
    background: #ef4444;
    color: white;
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 12px;
    font-size: 13px;
    text-align: center;
    animation: fadeIn 0.3s ease;
  `;
  errorDiv.innerHTML = `
    <div style="margin-bottom: 8px;">⚠️ <span data-i18n="${key}">${t(key)}</span></div>
    <a href="https://www.vectorizer.ai/" target="_blank" style="color: white; text-decoration: underline;" data-i18n="goToVectorizer">
      ${t('goToVectorizer')}
    </a>
  `;

  // Insert before start button
  startBtn.parentNode.insertBefore(errorDiv, startBtn);

  // Remove after 5 seconds
  setTimeout(() => {
    errorDiv.remove();
  }, 5000);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'queue:update') {
    renderQueue(msg.queue || []);
    if (msg.folder !== undefined) {
      folderInput.value = msg.folder;
      updateFolderSummary(msg.folder);
    }
    if (msg.format) {
      formatSelect.value = msg.format;
    }
    if (typeof msg.delaySeconds === 'number') {
      delayInput.value = msg.delaySeconds;
    }
    if (typeof msg.removeBackground === 'boolean') {
      removeBackgroundCheckbox.checked = msg.removeBackground;
    }
    // Update processing state
    if (typeof msg.isProcessing === 'boolean') {
      isProcessing = msg.isProcessing;
    }
    if (typeof msg.isPaused === 'boolean') {
      isPaused = msg.isPaused;
    }
    updateControlButtons();
  }
});

chrome.runtime.sendMessage({ type: 'queue:get' }, (res) => {
  if (res && res.queue) renderQueue(res.queue);
  if (res && typeof res.delaySeconds === 'number') {
    delayInput.value = res.delaySeconds;
  }
  if (res && res.format) {
    formatSelect.value = res.format;
  }
  if (res && res.folder) {
    folderInput.value = res.folder;
    updateFolderSummary(res.folder);
  } else {
    updateFolderSummary('');
  }
  if (res && typeof res.removeBackground === 'boolean') {
    removeBackgroundCheckbox.checked = res.removeBackground;
  }
  // Load auto-pause config
  if (res && res.autoPause) {
    autoPauseEnabled.checked = res.autoPause.enabled || false;
    autoPauseCount.value = res.autoPause.count || 10;
    autoPauseMinutes.value = res.autoPause.minutes || 5;
    autoPauseConfig.style.display = autoPauseEnabled.checked ? 'block' : 'none';
  }
  // Update control buttons state
  if (res && typeof res.isProcessing === 'boolean') {
    isProcessing = res.isProcessing;
  }
  if (res && typeof res.isPaused === 'boolean') {
    isPaused = res.isPaused;
  }
  updateControlButtons();
});

delayInput.addEventListener('change', () => {
  const seconds = Number(delayInput.value) || 0;
  chrome.runtime.sendMessage({ type: 'config:setDelay', seconds });
});

formatSelect.addEventListener('change', () => {
  const format = formatSelect.value;
  chrome.runtime.sendMessage({ type: 'config:setFormat', format });
});

folderInput.addEventListener('change', () => {
  const folder = folderInput.value || '';
  chrome.runtime.sendMessage({ type: 'config:setFolder', folder });
  updateFolderSummary(folder);
});

removeBackgroundCheckbox.addEventListener('change', () => {
  const removeBackground = removeBackgroundCheckbox.checked;
  chrome.runtime.sendMessage({ type: 'config:setRemoveBackground', removeBackground });
});

// Auto-pause checkbox toggle
autoPauseEnabled.addEventListener('change', () => {
  autoPauseConfig.style.display = autoPauseEnabled.checked ? 'block' : 'none';
  saveAutoPauseConfig();
});

// Auto-pause config changes
autoPauseCount.addEventListener('change', saveAutoPauseConfig);
autoPauseMinutes.addEventListener('change', saveAutoPauseConfig);

function saveAutoPauseConfig() {
  chrome.runtime.sendMessage({
    type: 'config:setAutoPause',
    autoPause: {
      enabled: autoPauseEnabled.checked,
      count: parseInt(autoPauseCount.value) || 10,
      minutes: parseInt(autoPauseMinutes.value) || 5
    }
  });
}

// Pause Button
pauseBtn.addEventListener('click', () => {
  isPaused = !isPaused;
  chrome.runtime.sendMessage({ type: isPaused ? 'queue:pause' : 'queue:resume' });
  updateControlButtons();
});

// Cancel Button
cancelBtn.addEventListener('click', () => {
  if (confirm('Cancelar processamento e limpar a fila?')) {
    chrome.runtime.sendMessage({ type: 'queue:cancel' });
    isPaused = false;
    isProcessing = false;
    updateControlButtons();
  }
});

// Clear Queue Button
if (clearQueueBtn) {
  clearQueueBtn.addEventListener('click', () => {
    files = [];
    renderLocalSelection();
  });

  // Hover effect
  clearQueueBtn.addEventListener('mouseenter', () => {
    clearQueueBtn.style.color = '#ef4444';
    clearQueueBtn.style.background = '#fef2f2';
  });

  clearQueueBtn.addEventListener('mouseleave', () => {
    clearQueueBtn.style.color = '#9ca3af';
    clearQueueBtn.style.background = 'transparent';
  });
}

// Update visual state of buttons
function updateControlButtons() {
  const hasQueue = isProcessing;
  pauseBtn.disabled = !hasQueue;
  cancelBtn.disabled = !hasQueue;

  // Disable Start button when processing or paused
  startBtn.disabled = isProcessing || isPaused;
  if (isProcessing || isPaused) {
    startBtn.style.opacity = '0.5';
    startBtn.style.cursor = 'not-allowed';
  } else {
    startBtn.style.opacity = '1';
    startBtn.style.cursor = 'pointer';
  }

  if (isPaused) {
    pauseBtn.textContent = `▶ ${t('resume')}`;
    pauseBtn.style.borderColor = '#22c55e';
    pauseBtn.style.color = '#22c55e';
  } else {
    pauseBtn.textContent = `⏸ ${t('pause')}`;
    pauseBtn.style.borderColor = '#f59e0b';
    pauseBtn.style.color = '#f59e0b';
  }
}

function updateFolderSummary(folder) {
  const path = folder ? `Downloads/${folder}` : 'Downloads';
  folderSummary.textContent = `${t('savedIn')} '${path}'`;
}

function renderLocalSelection() {
  renderQueue(files.map(f => ({
    name: f.name,
    type: f.type,
    status: 'pending',
    data: Array.from(new Uint8Array()) // no real preview here
  })));
}

// Highlight queue section with elegant animation
function highlightQueue() {
  const queueSection = document.querySelector('.queue-section');
  const queueTitle = document.querySelector('.queue-title');

  if (queueSection && queueTitle) {
    // Remove classes if they exist (to restart animation)
    queueSection.classList.remove('highlight');
    queueTitle.classList.remove('highlight');

    // Force reflow to restart animation
    void queueSection.offsetWidth;

    // Add highlight classes
    queueSection.classList.add('highlight');
    queueTitle.classList.add('highlight');

    // Remove classes after animation completes
    setTimeout(() => {
      queueSection.classList.remove('highlight');
      queueTitle.classList.remove('highlight');
    }, 600);
  }
}

function renderQueue(items) {
  revokeAll();
  const cards = items.map((item, idx) => {
    const pct = progressFromStatus(item.status);
    const statusLabel = labelFromStatus(item.status);
    const thumb = thumbUrl(item);
    const sizeText = item.size ? ` (${Math.round(item.size / 1024)} KB)` : '';
    return `
      <div class="card-item">
        <div class="thumb" style="background-image:url('${thumb}');"></div>
        <div class="info">
          <div class="name" title="${item.name}">${idx + 1}. ${item.name}${sizeText}</div>
          <div class="status">${statusLabel}</div>
          <div class="bar">
            <div class="bar-fill" style="width:${pct}%;"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
  grid.innerHTML = cards || `<div class="empty">${t('noFiles')}</div>`;

  // Show/hide clear queue button
  if (clearQueueContainer) {
    clearQueueContainer.style.display = items.length > 0 ? 'block' : 'none';
  }

  // Update file counter
  updateQueueStats(items);
}

function updateQueueStats(items) {
  const statsEl = document.getElementById('queue-stats');
  if (!statsEl) return;

  const total = items.length;
  const done = items.filter(i => i.status === 'done').length;

  if (total === 0) {
    statsEl.textContent = '';
  } else {
    statsEl.textContent = `${done} ${t('of')} ${total} ${t('processed')}`;
  }
}

function progressFromStatus(status) {
  if (status === 'processing') return 50;
  if (status === 'done') return 100;
  if (status === 'error') return 100;
  return 0;
}

function labelFromStatus(status) {
  if (status === 'processing') return `${t('processing')}...`;
  if (status === 'done') return t('completed');
  if (status === 'error') return t('error');
  return t('waiting');
}

function thumbUrl(item) {
  if (item?.data?.length) {
    const blob = new Blob([new Uint8Array(item.data)], { type: item.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    previews.set(item.name, url);
    return url;
  }
  const fallback = chrome.runtime.getURL('assets/image_v.webp');
  return fallback;
}

function revokeAll() {
  previews.forEach(url => URL.revokeObjectURL(url));
  previews.clear();
}
