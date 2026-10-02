const fileInput = document.getElementById("files");
const startBtn = document.getElementById("start");
const grid = document.getElementById("grid");
const delayInput = document.getElementById("delay");
const formatSelect = document.getElementById("format");
const folderInput = document.getElementById("folder");
const folderSummary = document.getElementById("folder-summary");
const removeBackgroundCheckbox = {
  checked: false,
  addEventListener() {}
};
const queueBulkBar = null;
const pauseBtn = document.getElementById("pauseBtn");
const cancelBtn = document.getElementById("cancelBtn");
const autoPauseEnabled = document.getElementById("autoPauseEnabled");
const autoPauseConfig = document.getElementById("autoPauseConfig");
const autoPauseCount = document.getElementById("autoPauseCount");
const autoPauseMinMin = document.getElementById("autoPauseMinMin");
const autoPauseMaxMin = document.getElementById("autoPauseMaxMin");
const pauseRangeDisplay = document.getElementById("pauseRangeDisplay");
const dropzone = document.getElementById("dropzone");
const langSelect = document.getElementById("langSelect");
const clearQueueBtn = document.getElementById("clearQueueBtn");
const clearQueueContainer = document.getElementById("clearQueueContainer");
const selectAllBgBtn = document.getElementById("selectAllBgBtn");
const clearAllBgBtn = document.getElementById("clearAllBgBtn");
const previewModal = document.getElementById("previewModal");
const previewModalTitle = document.getElementById("previewModalTitle");
const previewModalImage = document.getElementById("previewModalImage");
const closePreviewModal = document.getElementById("closePreviewModal");
const licenseModal = document.getElementById("licenseModal");
const licenseKeyInput = document.getElementById("licenseKeyInput");
const verifyLicenseBtn = document.getElementById("verifyLicenseBtn");
const licenseError = document.getElementById("licenseError");
const buyLicenseLink = document.getElementById("buyLicenseLink");
const GUMROAD_PRODUCT_ID = "wiMaBP3bXVyY4UCrBeQEfQ==";
let files = [];
const DRAFT_FILES_KEY = "vectorizer-draft-files";
let isPaused = false;
let isProcessing = false;
let isLicenseValid = false;
function initLanguageSelector() {
  const _0x44f4ce = getAvailableLanguages();
  const _0x4493cd = getCurrentLanguage();
  langSelect.innerHTML = _0x44f4ce.map(_0x26d06e => "<option value=\"" + _0x26d06e.code + "\" " + (_0x26d06e.code === _0x4493cd ? "selected" : "") + ">" + _0x26d06e.flag + " " + _0x26d06e.name + "</option>").join("");
  langSelect.onchange = () => {
    setLanguage(langSelect.value);
    applyTranslations();
    if (files.length > 0) {
      renderLocalSelection();
    } else {
      chrome.runtime.sendMessage({
        type: "queue:get"
      }, async _0x2213fb => {
        if (_0x2213fb && _0x2213fb.queue && _0x2213fb.queue.length > 0) {
          renderQueue(_0x2213fb.queue);
        } else {
          await restoreDraftSelection();
        }
      });
    }
  };
}
function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(_0x5d555f => {
    const _0x5d60b0 = _0x5d555f.getAttribute("data-i18n");
    _0x5d555f.textContent = t(_0x5d60b0);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(_0xaa5180 => {
    const _0x6bea1b = _0xaa5180.getAttribute("data-i18n-title");
    _0xaa5180.title = t(_0x6bea1b);
  });
  document.querySelector(".dropzone-text").textContent = t("dropzone");
  document.querySelector(".file-btn").textContent = t("selectFiles");
  document.querySelector(".queue-title").innerHTML = "📋 " + t("queue");
  const _0x511776 = null;
  if (_0x511776) {
    _0x511776.textContent = "🎨 " + t("removeBackground");
  }
  const _0x5eedc7 = autoPauseEnabled?.closest(".checkbox-item")?.querySelector("span");
  if (_0x5eedc7) {
    _0x5eedc7.textContent = "⏱ " + t("scheduledPause");
  }
  const _0x16a9fd = document.querySelectorAll(".auto-pause-row");
  if (_0x16a9fd[0]) {
    const _0x16688d = _0x16a9fd[0].querySelectorAll("span");
    if (_0x16688d[0]) {
      _0x16688d[0].textContent = t("every");
    }
    if (_0x16688d[1]) {
      _0x16688d[1].textContent = t("images");
    }
  }
  updatePauseRangeDisplay();
  const _0x5d1e04 = startBtn.querySelector(".btn-text");
  if (_0x5d1e04) {
    _0x5d1e04.textContent = "🚀 " + t("start");
  }
  pauseBtn.textContent = isPaused ? "▶ " + t("resume") : "⏸ " + t("pause");
  cancelBtn.textContent = "✕ " + t("cancel");
  const _0x2287b8 = document.querySelector(".card-body > p");
  if (_0x2287b8) {
    _0x2287b8.innerHTML = "⚠️ " + t("warning");
  }
  const _0x265181 = document.getElementById("infoModalTitle");
  if (_0x265181) {
    _0x265181.textContent = t("howItWorks");
  }
  if (previewModalTitle) {
    previewModalTitle.textContent = t("imagePreview");
  }
  if (folderSummary) {
    folderSummary.textContent = t("savedIn") + " " + (folderInput?.value || "Downloads");
  }
  const _0x223ea4 = document.getElementById("secLabel");
  if (_0x223ea4) {
    _0x223ea4.textContent = t("sec");
  }
  const _0x280780 = document.getElementById("downloadTip");
  if (_0x280780) {
    _0x280780.textContent = t("downloadTip");
  }
}
(async function () {
  await initLanguage();
  initLanguageSelector();
  applyTranslations();
  await checkLicense();
  const _0x4d46eb = chrome.runtime.getManifest();
  const _0x391d09 = document.getElementById("extVersion");
  if (_0x391d09) {
    _0x391d09.textContent = _0x4d46eb.version;
  }
  chrome.runtime.sendMessage({
    type: "queue:get"
  }, async _0x375f82 => {
    if (_0x375f82 && _0x375f82.queue && _0x375f82.queue.length > 0) {
      renderQueue(_0x375f82.queue);
      return;
    }
    await restoreDraftSelection();
  });
})();
const DEV_MODE = false;
async function checkLicense() {
  if (DEV_MODE) {
    console.log("[DEV MODE] License check bypassed");
    isLicenseValid = true;
    licenseModal.classList.remove("show");
    return;
  }
  const _0x538562 = await chrome.storage.local.get(["licenseKey", "licenseValid"]);
  if (_0x538562.licenseValid && _0x538562.licenseKey) {
    isLicenseValid = true;
    licenseModal.classList.remove("show");
  } else {
    isLicenseValid = false;
    licenseModal.classList.add("show");
  }
}
verifyLicenseBtn.onclick = async () => {
  const _0x1f0d78 = licenseKeyInput.value.trim();
  if (!_0x1f0d78) {
    showLicenseError(t("licenseInvalid"));
    return;
  }
  verifyLicenseBtn.textContent = "...";
  verifyLicenseBtn.disabled = true;
  licenseError.style.display = "none";
  try {
    const _0x3c324d = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "product_id=" + GUMROAD_PRODUCT_ID + "&license_key=" + _0x1f0d78
    });
    const _0x20af6b = await _0x3c324d.json();
    if (_0x20af6b.success && !_0x20af6b.purchase.refunded && !_0x20af6b.purchase.chargebacked) {
      await chrome.storage.local.set({
        licenseKey: _0x1f0d78,
        licenseValid: true
      });
      isLicenseValid = true;
      licenseModal.classList.remove("show");
    } else {
      isLicenseValid = false;
      showLicenseError(t("licenseInvalid"));
      await chrome.storage.local.remove(["licenseValid"]);
    }
  } catch (_0x53c785) {
    console.error("License check error:", _0x53c785);
    showLicenseError(t("licenseCheckError"));
  } finally {
    verifyLicenseBtn.textContent = t("verifyLicense");
    verifyLicenseBtn.disabled = false;
  }
};
function showLicenseError(_0xe9dbc3) {
  licenseError.textContent = _0xe9dbc3;
  licenseError.style.display = "block";
}
// ---------------------------------------------------------------------------
// File handling: originals are stored in IndexedDB (see filestore.js).
// `files` only keeps lightweight metadata: { id, name, type, size, width, height, removeBackground }.
// ---------------------------------------------------------------------------
const MAX_FILE_SIZE = 30 * 1024 * 1024; // per-file limit; larger resolutions are downscaled by Vectorizer.AI itself
const THUMB_SIZE = 160;
const ADD_CONCURRENCY = 3; // images decoded at the same time while adding
const thumbCache = new Map(); // id -> object URL of the small thumbnail
const PLACEHOLDER_THUMB = chrome.runtime.getURL("assets/image_v.webp");

function newItemId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : "draft-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

// Decodes the image once to read its dimensions and build a small thumbnail.
async function describeImage(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (err) {
    return { width: 0, height: 0, thumb: null };
  }
  const width = bitmap.width;
  const height = bitmap.height;
  let thumb = null;
  try {
    const scale = Math.min(1, THUMB_SIZE / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    thumb = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
  } catch (err) {
    thumb = null;
  } finally {
    bitmap.close();
  }
  return { width, height, thumb };
}

async function fileToDraft(file) {
  const { width, height, thumb } = await describeImage(file);
  const id = newItemId();
  await VecFileStore.put(id, file, thumb);
  if (thumb) {
    thumbCache.set(id, URL.createObjectURL(thumb));
  }
  return {
    id,
    name: file.name,
    type: file.type,
    size: file.size,
    removeBackground: Boolean(removeBackgroundCheckbox?.checked),
    width,
    height
  };
}

async function saveDraftSelection() {
  await chrome.storage.local.set({
    [DRAFT_FILES_KEY]: files
  });
}
async function clearDraftSelection() {
  await chrome.storage.local.remove(DRAFT_FILES_KEY);
}
// Drops the current selection, including the stored originals.
async function discardDraftFiles() {
  const ids = files.map(f => f.id);
  files = [];
  await clearDraftSelection();
  if (ids.length) {
    await VecFileStore.remove(ids).catch(err => console.error("[popup] Error removing draft files:", err));
  }
}
async function restoreDraftSelection() {
  const stored = await chrome.storage.local.get([DRAFT_FILES_KEY]);
  const drafts = Array.isArray(stored?.[DRAFT_FILES_KEY]) ? stored[DRAFT_FILES_KEY] : [];
  // Keep only drafts whose original is still in the file store (older versions kept the image inline).
  const present = await Promise.all(drafts.map(d => VecFileStore.hasFile(d.id).catch(() => false)));
  files = drafts.filter((d, i) => present[i]).map(({ dataUrl, megapixels, ...meta }) => meta);
  if (files.length !== drafts.length || drafts.some(d => d.dataUrl)) {
    await saveDraftSelection();
  }
  renderLocalSelection();
}
let addingFiles = false;
async function setDraftFilesFromInput(selected) {
  if (addingFiles) {
    return;
  }
  addingFiles = true;
  try {
    const tooLarge = selected.filter(f => f.size > MAX_FILE_SIZE);
    if (tooLarge.length > 0) {
      showFileSizeError(tooLarge.map(f => f.name + " (" + Math.round(f.size / 1024 / 1024) + "MB)").join(", "));
    }
    const known = new Set(files.map(f => f.name + "::" + f.size));
    const fresh = selected.filter(f => {
      const key = f.name + "::" + f.size;
      if (f.size > MAX_FILE_SIZE || known.has(key)) {
        return false;
      }
      known.add(key);
      return true;
    });
    if (fresh.length === 0) {
      return;
    }
    // A few images at a time: keeps memory flat no matter how many files are added.
    const results = new Array(fresh.length);
    let cursor = 0;
    let sinceRender = 0;
    const worker = async () => {
      while (cursor < fresh.length) {
        const index = cursor++;
        try {
          results[index] = await fileToDraft(fresh[index]);
        } catch (err) {
          console.error("[popup] Could not add file:", fresh[index].name, err);
          results[index] = null;
        }
        if (++sinceRender >= 12) {
          sinceRender = 0;
          renderQueue([...files, ...results.filter(Boolean)].map(draftToQueueItem));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ADD_CONCURRENCY, fresh.length) }, worker));
    const added = results.filter(Boolean);
    if (added.length < fresh.length) {
      showGenericSizeError();
    }
    files = [...files, ...added];
    await saveDraftSelection();
    renderLocalSelection();
    if (added.length > 0) {
      highlightQueue();
    }
  } finally {
    addingFiles = false;
    fileInput.value = "";
  }
}
if (buyLicenseLink) {
  buyLicenseLink.onclick = _0x4b5c77 => {
    _0x4b5c77.preventDefault();
    window.open("https://dentparanoid.gumroad.com/l/batch-vectorizer", "_blank");
  };
}
fileInput.onchange = async () => {
  await setDraftFilesFromInput([...fileInput.files]);
};
dropzone.addEventListener("dragover", _0x3cb687 => {
  _0x3cb687.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", _0x42998e => {
  _0x42998e.preventDefault();
  dropzone.classList.remove("dragover");
});
dropzone.addEventListener("drop", async _0x321840 => {
  _0x321840.preventDefault();
  dropzone.classList.remove("dragover");
  const _0x1cc1f1 = [..._0x321840.dataTransfer.files].filter(_0x4bb661 => _0x4bb661.type.startsWith("image/"));
  if (_0x1cc1f1.length > 0) {
    await setDraftFilesFromInput(_0x1cc1f1);
  }
});
const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeModal = document.getElementById("closeModal");
if (infoBtn && infoModal && closeModal) {
  infoBtn.onclick = () => {
    infoModal.classList.add("show");
  };
  closeModal.onclick = () => {
    infoModal.classList.remove("show");
  };
  infoModal.onclick = _0x3e54b0 => {
    if (_0x3e54b0.target === infoModal) {
      infoModal.classList.remove("show");
    }
  };
}
startBtn.onclick = async () => {
  if (!files.length || addingFiles) {
    return;
  }
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const activeUrl = activeTab?.url || "";
  if (!activeUrl.includes("vectorizer.ai")) {
    showError("needVectorizer");
    return;
  }
  startBtn.classList.add("loading");
  startBtn.disabled = true;
  try {
    // Only metadata travels to the background; the originals are read from IndexedDB one at a time.
    const items = files.map(f => ({
      id: f.id,
      name: f.name,
      type: f.type,
      size: f.size,
      removeBackground: Boolean(f.removeBackground),
      width: f.width,
      height: f.height
    }));
    const response = await chrome.runtime.sendMessage({
      type: "queue:add",
      items
    });
    if (response?.error) {
      throw new Error(response.error);
    }
    files = [];
    await clearDraftSelection();
    if (response?.queue) {
      renderQueue(response.queue);
    }
  } catch (err) {
    console.error("[Vectorizer] Error starting queue:", err);
    showGenericSizeError();
  } finally {
    startBtn.classList.remove("loading");
    startBtn.disabled = false;
    updateControlButtons();
  }
};
function showError(_0x166a36) {
  const _0x3e3e25 = document.getElementById("error-msg");
  if (_0x3e3e25) {
    _0x3e3e25.remove();
  }
  const _0x26453f = document.createElement("div");
  _0x26453f.id = "error-msg";
  _0x26453f.style.cssText = "\n    background: #ef4444;\n    color: white;\n    padding: 12px;\n    border-radius: 8px;\n    margin-bottom: 12px;\n    font-size: 13px;\n    text-align: center;\n    animation: fadeIn 0.3s ease;\n  ";
  _0x26453f.innerHTML = "\n    <div style=\"margin-bottom: 8px;\">⚠️ <span data-i18n=\"" + _0x166a36 + "\">" + t(_0x166a36) + "</span></div>\n    <a href=\"https://www.vectorizer.ai/\" target=\"_blank\" style=\"color: white; text-decoration: underline;\" data-i18n=\"goToVectorizer\">\n      " + t("goToVectorizer") + "\n    </a>\n  ";
  const _0x531d60 = document.querySelector(".queue-section");
  if (_0x531d60 && _0x531d60.parentNode) {
    _0x531d60.parentNode.insertBefore(_0x26453f, _0x531d60);
  } else {
    startBtn.parentNode.insertBefore(_0x26453f, startBtn);
  }
  setTimeout(() => {
    _0x26453f.remove();
  }, 5000);
}
function showFileSizeError(_0x8351b4) {
  const _0x51600a = document.getElementById("error-msg");
  if (_0x51600a) {
    _0x51600a.remove();
  }
  const _0x547130 = document.createElement("div");
  _0x547130.id = "error-msg";
  _0x547130.style.cssText = "\n    background: #ef4444;\n    color: white;\n    padding: 12px;\n    border-radius: 8px;\n    margin-bottom: 12px;\n    font-size: 12px;\n    text-align: center;\n    animation: fadeIn 0.3s ease;\n  ";
  _0x547130.innerHTML = "\n    <div style=\"margin-bottom: 8px;\">⚠️ " + t("fileTooLarge") + "</div>\n    <div style=\"font-size: 10px; opacity: 0.9; word-break: break-all;\">" + _0x8351b4 + "</div>\n  ";
  const _0x542c24 = document.querySelector(".queue-section");
  if (_0x542c24 && _0x542c24.parentNode) {
    _0x542c24.parentNode.insertBefore(_0x547130, _0x542c24);
  } else {
    startBtn.parentNode.insertBefore(_0x547130, startBtn);
  }
  setTimeout(() => _0x547130.remove(), 8000);
}
function showTotalSizeError(_0x4c9c4d) {
  const _0x2114d2 = document.getElementById("error-msg");
  if (_0x2114d2) {
    _0x2114d2.remove();
  }
  const _0x58c548 = document.createElement("div");
  _0x58c548.id = "error-msg";
  _0x58c548.style.cssText = "\n    background: #ef4444;\n    color: white;\n    padding: 12px;\n    border-radius: 8px;\n    margin-bottom: 12px;\n    font-size: 12px;\n    text-align: center;\n    animation: fadeIn 0.3s ease;\n  ";
  _0x58c548.innerHTML = "\n    <div>⚠️ " + t("totalTooLarge").replace("{size}", _0x4c9c4d) + "</div>\n  ";
  const _0x5242a2 = document.querySelector(".queue-section");
  if (_0x5242a2 && _0x5242a2.parentNode) {
    _0x5242a2.parentNode.insertBefore(_0x58c548, _0x5242a2);
  } else {
    startBtn.parentNode.insertBefore(_0x58c548, startBtn);
  }
  setTimeout(() => _0x58c548.remove(), 8000);
}
function showGenericSizeError() {
  const _0x879b4f = document.getElementById("error-msg");
  if (_0x879b4f) {
    _0x879b4f.remove();
  }
  const _0x2587c8 = document.createElement("div");
  _0x2587c8.id = "error-msg";
  _0x2587c8.style.cssText = "\n    background: #ef4444;\n    color: white;\n    padding: 12px;\n    border-radius: 8px;\n    margin-bottom: 12px;\n    font-size: 12px;\n    text-align: center;\n    animation: fadeIn 0.3s ease;\n  ";
  _0x2587c8.innerHTML = "\n    <div>⚠️ " + t("serializationError") + "</div>\n  ";
  const _0x5e3e56 = document.querySelector(".queue-section");
  if (_0x5e3e56 && _0x5e3e56.parentNode) {
    _0x5e3e56.parentNode.insertBefore(_0x2587c8, _0x5e3e56);
  } else {
    startBtn.parentNode.insertBefore(_0x2587c8, startBtn);
  }
  setTimeout(() => _0x2587c8.remove(), 8000);
}
chrome.runtime.onMessage.addListener(_0x27ed49 => {
  if (_0x27ed49.type === "queue:update") {
    renderQueue(_0x27ed49.queue || []);
    if (_0x27ed49.folder !== undefined) {
      folderInput.value = _0x27ed49.folder;
      updateFolderSummary(_0x27ed49.folder);
    }
    if (_0x27ed49.format) {
      formatSelect.value = _0x27ed49.format;
    }
    if (typeof _0x27ed49.delaySeconds === "number") {
      delayInput.value = _0x27ed49.delaySeconds;
    }
    if (typeof _0x27ed49.removeBackground === "boolean") {
      removeBackgroundCheckbox.checked = _0x27ed49.removeBackground;
    }
    if (typeof _0x27ed49.isProcessing === "boolean") {
      isProcessing = _0x27ed49.isProcessing;
    }
    if (typeof _0x27ed49.isPaused === "boolean") {
      isPaused = _0x27ed49.isPaused;
    }
    updateControlButtons();
  }
});
chrome.runtime.sendMessage({
  type: "queue:get"
}, _0x5c6e5c => {
  if (_0x5c6e5c && _0x5c6e5c.queue) {
    renderQueue(_0x5c6e5c.queue);
  }
  if (_0x5c6e5c && typeof _0x5c6e5c.delaySeconds === "number") {
    delayInput.value = _0x5c6e5c.delaySeconds;
  }
  if (_0x5c6e5c && _0x5c6e5c.format) {
    formatSelect.value = _0x5c6e5c.format;
  }
  if (_0x5c6e5c && _0x5c6e5c.folder) {
    folderInput.value = _0x5c6e5c.folder;
    updateFolderSummary(_0x5c6e5c.folder);
  } else {
    updateFolderSummary("");
  }
  if (_0x5c6e5c && typeof _0x5c6e5c.removeBackground === "boolean") {
    removeBackgroundCheckbox.checked = _0x5c6e5c.removeBackground;
  }
  if (_0x5c6e5c && _0x5c6e5c.autoPause) {
    autoPauseEnabled.checked = _0x5c6e5c.autoPause.enabled || false;
    autoPauseCount.value = _0x5c6e5c.autoPause.count || 10;
    autoPauseMinMin.value = _0x5c6e5c.autoPause.minMinutes || 1;
    autoPauseMaxMin.value = _0x5c6e5c.autoPause.maxMinutes || 5;
    updatePauseRangeDisplay();
    autoPauseConfig.style.display = autoPauseEnabled.checked ? "block" : "none";
  }
  if (_0x5c6e5c && typeof _0x5c6e5c.isProcessing === "boolean") {
    isProcessing = _0x5c6e5c.isProcessing;
  }
  if (_0x5c6e5c && typeof _0x5c6e5c.isPaused === "boolean") {
    isPaused = _0x5c6e5c.isPaused;
  }
  updateControlButtons();
});
delayInput.addEventListener("change", () => {
  const _0x6afd69 = Number(delayInput.value) || 0;
  chrome.runtime.sendMessage({
    type: "config:setDelay",
    seconds: _0x6afd69
  });
});
formatSelect.addEventListener("change", () => {
  const _0x54b751 = formatSelect.value;
  chrome.runtime.sendMessage({
    type: "config:setFormat",
    format: _0x54b751
  });
});
folderInput.addEventListener("change", () => {
  const _0x858b76 = folderInput.value || "";
  chrome.runtime.sendMessage({
    type: "config:setFolder",
    folder: _0x858b76
  });
  updateFolderSummary(_0x858b76);
});
removeBackgroundCheckbox.addEventListener("change", () => {
  const _0x345d69 = removeBackgroundCheckbox.checked;
  chrome.runtime.sendMessage({
    type: "config:setRemoveBackground",
    removeBackground: _0x345d69
  });
});
autoPauseEnabled.addEventListener("change", () => {
  autoPauseConfig.style.display = autoPauseEnabled.checked ? "block" : "none";
  saveAutoPauseConfig();
});
autoPauseCount.addEventListener("change", saveAutoPauseConfig);
autoPauseMinMin.addEventListener("change", saveAutoPauseConfig);
autoPauseMaxMin.addEventListener("change", saveAutoPauseConfig);
function saveAutoPauseConfig() {
  const _0x161153 = parseInt(autoPauseMinMin.value) || 1;
  let _0x2866fb = parseInt(autoPauseMaxMin.value) || 5;
  if (_0x2866fb <= _0x161153) {
    _0x2866fb = _0x161153 + 1;
    autoPauseMaxMin.value = _0x2866fb;
  }
  if (_0x161153 < 1) {
    autoPauseMinMin.value = 1;
  }
  if (_0x2866fb > 45) {
    autoPauseMaxMin.value = 45;
  }
  updatePauseRangeDisplay();
  chrome.runtime.sendMessage({
    type: "config:setAutoPause",
    autoPause: {
      enabled: autoPauseEnabled.checked,
      count: parseInt(autoPauseCount.value) || 10,
      minMinutes: parseInt(autoPauseMinMin.value) || 1,
      maxMinutes: parseInt(autoPauseMaxMin.value) || 5
    }
  });
}
function updatePauseRangeDisplay() {
  const _0x449a1a = parseInt(autoPauseMinMin.value) || 1;
  const _0x44e70b = parseInt(autoPauseMaxMin.value) || 5;
  if (pauseRangeDisplay) {
    pauseRangeDisplay.textContent = _0x449a1a + " - " + _0x44e70b + " min";
  }
}
pauseBtn.addEventListener("click", () => {
  isPaused = !isPaused;
  chrome.runtime.sendMessage({
    type: isPaused ? "queue:pause" : "queue:resume"
  });
  updateControlButtons();
});
cancelBtn.addEventListener("click", async () => {
  if (confirm("Cancelar processamento e limpar a fila?")) {
    chrome.runtime.sendMessage({
      type: "queue:cancel"
    });
    await discardDraftFiles();
    isPaused = false;
    isProcessing = false;
    renderLocalSelection();
    updateControlButtons();
  }
});
if (clearQueueBtn) {
  clearQueueBtn.addEventListener("click", async () => {
    await discardDraftFiles();
    renderLocalSelection();
    chrome.runtime.sendMessage({
      type: "queue:cancel"
    }, () => {
      console.log("[popup] Queue cleared in background");
      isPaused = false;
      isProcessing = false;
      updateControlButtons();
    });
  });
  clearQueueBtn.addEventListener("mouseenter", () => {
    clearQueueBtn.style.color = "#ffffff";
    clearQueueBtn.style.background = "#dc2626";
    clearQueueBtn.style.borderColor = "#dc2626";
    clearQueueBtn.style.boxShadow = "0 8px 18px rgba(220, 38, 38, 0.22)";
  });
  clearQueueBtn.addEventListener("mouseleave", () => {
    clearQueueBtn.style.color = "#dc2626";
    clearQueueBtn.style.background = "#fff5f5";
    clearQueueBtn.style.borderColor = "#fecaca";
    clearQueueBtn.style.boxShadow = "0 4px 12px rgba(220, 38, 38, 0.08)";
  });
}
function updateControlButtons() {
  const _0x5e2d0e = isProcessing;
  pauseBtn.disabled = !_0x5e2d0e;
  cancelBtn.disabled = !_0x5e2d0e;
  startBtn.disabled = isProcessing || isPaused;
  if (isProcessing || isPaused) {
    startBtn.style.opacity = "0.5";
    startBtn.style.cursor = "not-allowed";
  } else {
    startBtn.style.opacity = "1";
    startBtn.style.cursor = "pointer";
  }
  if (isPaused) {
    pauseBtn.textContent = "▶ " + t("resume");
    pauseBtn.style.borderColor = "#22c55e";
    pauseBtn.style.color = "#22c55e";
  } else {
    pauseBtn.textContent = "⏸ " + t("pause");
    pauseBtn.style.borderColor = "#f59e0b";
    pauseBtn.style.color = "#f59e0b";
  }
}
function updateFolderSummary(_0x431147) {
  const _0x3ee3b1 = _0x431147 ? "Downloads/" + _0x431147 : "Downloads";
  folderSummary.textContent = t("savedIn") + " '" + _0x3ee3b1 + "'";
}
function draftToQueueItem(f) {
  return {
    id: f.id,
    name: f.name,
    type: f.type,
    size: f.size,
    status: "pending",
    removeBackground: Boolean(f.removeBackground)
  };
}
function renderLocalSelection() {
  renderQueue(files.map(draftToQueueItem));
}
function highlightQueue() {
  const _0x3d4eed = document.querySelector(".queue-section");
  const _0x148cb0 = document.querySelector(".queue-title");
  if (_0x3d4eed && _0x148cb0) {
    _0x3d4eed.classList.remove("highlight");
    _0x148cb0.classList.remove("highlight");
    _0x3d4eed.offsetWidth;
    _0x3d4eed.classList.add("highlight");
    _0x148cb0.classList.add("highlight");
    setTimeout(() => {
      _0x3d4eed.classList.remove("highlight");
      _0x148cb0.classList.remove("highlight");
    }, 600);
  }
}
let lastQueueSignature = null;
function renderQueue(queue) {
  // Skip the DOM rebuild when nothing visible changed (the background broadcasts often).
  const signature = getCurrentLanguage() + "|" + queue.map(q => q.id + ":" + q.status + ":" + (q.removeBackground ? 1 : 0) + ":" + q.name).join("|");
  if (signature === lastQueueSignature) {
    return;
  }
  lastQueueSignature = signature;
  const removeBgLabel = escapeHtml(t("removeBackground"));
  const previewLabel = escapeAttr(t("clickToPreview"));
  const html = queue.map((item, index) => {
    const progress = progressFromStatus(item.status);
    const label = labelFromStatus(item.status);
    const thumb = thumbUrl(item);
    const sizeLabel = item.size ? " (" + formatSize(item.size) + ")" : "";
    const locked = item.status === "processing" || item.status === "done";
    return "\n      <div class=\"card-item\">\n        <div class=\"thumb\" role=\"button\" tabindex=\"0\" data-item-id=\"" + escapeAttr(item.id || "") + "\" data-preview-name=\"" + escapeAttr(item.name || "") + "\" style=\"background-image:url('" + escapeAttr(thumb) + "');\" title=\"" + previewLabel + "\"></div>\n        <div class=\"info\">\n          <div class=\"card-topline\">\n            <div class=\"name\" title=\"" + escapeAttr(item.name || "") + "\">" + (index + 1) + ". " + escapeHtml(item.name || "") + sizeLabel + "</div>\n            <label class=\"item-bg-toggle\" title=\"" + removeBgLabel + "\">\n              <input type=\"checkbox\" class=\"queue-item-bg-toggle\" data-item-id=\"" + escapeAttr(item.id || "") + "\" " + (item.removeBackground ? "checked" : "") + " " + (locked ? "disabled" : "") + ">\n              <span>" + removeBgLabel + "</span>\n            </label>\n          </div>\n          <div class=\"status\">" + label + "</div>\n          <div class=\"bar\">\n            <div class=\"bar-fill\" style=\"width:" + progress + "%;\"></div>\n          </div>\n        </div>\n      </div>\n    ";
  }).join("");
  grid.innerHTML = html || "<div class=\"empty\">" + t("noFiles") + "</div>";
  if (queueBulkBar) {
    queueBulkBar.classList.toggle("show", queue.length > 0);
  }
  if (clearQueueContainer) {
    clearQueueContainer.style.display = queue.length > 0 ? "block" : "none";
  }
  updateQueueStats(queue);
  loadMissingThumbs(queue);
}
function formatSize(bytes) {
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.round(bytes / 1024) + " KB";
}
function updateQueueStats(_0x53fbfa) {
  const _0x39d1b1 = document.getElementById("queue-stats");
  if (!_0x39d1b1) {
    return;
  }
  const _0xf0e7bd = _0x53fbfa.length;
  const _0x4b4b1b = _0x53fbfa.filter(_0x1f0ad3 => _0x1f0ad3.status === "done").length;
  if (_0xf0e7bd === 0) {
    _0x39d1b1.textContent = "";
  } else {
    _0x39d1b1.textContent = _0x4b4b1b + " " + t("of") + " " + _0xf0e7bd + " " + t("processed");
  }
}
function progressFromStatus(_0x4f0b56) {
  if (_0x4f0b56 === "processing") {
    return 50;
  }
  if (_0x4f0b56 === "done") {
    return 100;
  }
  if (_0x4f0b56 === "error") {
    return 100;
  }
  return 0;
}
function labelFromStatus(_0x41b49c) {
  if (_0x41b49c === "processing") {
    return t("processing") + "...";
  }
  if (_0x41b49c === "done") {
    return t("completed");
  }
  if (_0x41b49c === "error") {
    return t("error");
  }
  return t("waiting");
}
function thumbUrl(item) {
  return thumbCache.get(item?.id) || PLACEHOLDER_THUMB;
}
// Thumbnails are read from IndexedDB once and cached; cards are patched in place when they arrive.
let thumbLoadToken = 0;
async function loadMissingThumbs(queue) {
  const token = ++thumbLoadToken;
  const liveIds = new Set(queue.map(q => q.id));
  for (const [id, url] of thumbCache) {
    if (!liveIds.has(id)) {
      URL.revokeObjectURL(url);
      thumbCache.delete(id);
    }
  }
  for (const item of queue) {
    if (token !== thumbLoadToken) {
      return;
    }
    if (!item.id || thumbCache.has(item.id)) {
      continue;
    }
    try {
      const blob = await VecFileStore.getThumb(item.id);
      if (!blob || thumbCache.has(item.id)) {
        continue;
      }
      const url = URL.createObjectURL(blob);
      thumbCache.set(item.id, url);
      const el = grid.querySelector(".thumb[data-item-id=\"" + CSS.escape(item.id) + "\"]");
      if (el) {
        el.style.backgroundImage = "url('" + url + "')";
      }
    } catch (err) {
      console.error("[popup] Error loading thumbnail:", err);
    }
  }
}
// One delegated listener for the whole list instead of one per card.
grid.addEventListener("change", event => {
  const toggle = event.target.closest?.(".queue-item-bg-toggle");
  if (toggle) {
    updateItemRemoveBackground(toggle.dataset.itemId, toggle.checked);
  }
});
grid.addEventListener("click", event => {
  const thumb = event.target.closest?.(".thumb");
  if (thumb) {
    openPreviewModal(thumb.dataset.itemId, thumb.dataset.previewName);
  }
});
grid.addEventListener("keydown", event => {
  const thumb = event.target.closest?.(".thumb");
  if (thumb && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openPreviewModal(thumb.dataset.itemId, thumb.dataset.previewName);
  }
});
function updateItemRemoveBackground(_0x2ba628, _0xad6237) {
  if (!_0x2ba628) {
    return;
  }
  const _0x68f2ed = files.findIndex(_0x2fbffa => _0x2fbffa.id === _0x2ba628);
  if (_0x68f2ed >= 0) {
    files[_0x68f2ed] = {
      ...files[_0x68f2ed],
      removeBackground: _0xad6237
    };
    saveDraftSelection();
    renderLocalSelection();
    return;
  }
  chrome.runtime.sendMessage({
    type: "queue:updateItemRemoveBackground",
    itemId: _0x2ba628,
    removeBackground: _0xad6237
  });
}
function setAllRemoveBackground(_0x123218) {
  if (files.length > 0) {
    files = files.map(_0x5e0467 => ({
      ..._0x5e0467,
      removeBackground: _0x123218
    }));
    saveDraftSelection();
    renderLocalSelection();
    return;
  }
  chrome.runtime.sendMessage({
    type: "queue:setAllRemoveBackground",
    removeBackground: _0x123218
  });
}
let previewObjectUrl = null;
async function openPreviewModal(itemId, name) {
  if (!previewModal || !previewModalImage || !itemId) {
    return;
  }
  // Full image while it is still stored; the thumbnail once the item was processed.
  let url = thumbCache.get(itemId) || PLACEHOLDER_THUMB;
  try {
    const blob = await VecFileStore.getFile(itemId);
    if (blob) {
      releasePreviewUrl();
      previewObjectUrl = URL.createObjectURL(blob);
      url = previewObjectUrl;
    }
  } catch (err) {
    console.error("[popup] Error loading preview:", err);
  }
  previewModalImage.src = url;
  previewModalImage.alt = name || t("imagePreview");
  if (previewModalTitle) {
    previewModalTitle.textContent = name || t("imagePreview");
  }
  previewModal.classList.add("show");
}
function releasePreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}
function closeImagePreviewModal() {
  if (!previewModal) {
    return;
  }
  previewModal.classList.remove("show");
  if (previewModalImage) {
    previewModalImage.src = "";
  }
  releasePreviewUrl();
}
function escapeHtml(_0x16da3b) {
  return String(_0x16da3b || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escapeAttr(_0x253c8c) {
  return escapeHtml(_0x253c8c);
}
if (selectAllBgBtn) {
  selectAllBgBtn.addEventListener("click", () => setAllRemoveBackground(true));
}
if (clearAllBgBtn) {
  clearAllBgBtn.addEventListener("click", () => setAllRemoveBackground(false));
}
if (closePreviewModal) {
  closePreviewModal.addEventListener("click", closeImagePreviewModal);
}
if (previewModal) {
  previewModal.addEventListener("click", _0x4dcd81 => {
    if (_0x4dcd81.target === previewModal) {
      closeImagePreviewModal();
    }
  });
}
document.addEventListener("keydown", _0x3434f2 => {
  if (_0x3434f2.key === "Escape") {
    closeImagePreviewModal();
  }
});