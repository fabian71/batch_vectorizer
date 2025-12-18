let pricingHandled = false;
let pricingRedirected = false;
let isRedirecting = false;
let shouldAbortProcessing = false; // Flag to abort current processing when paused

// Initialization function - called at the end of the script
function initContentScript() {
  // Log initial page load
  log('[Init] Page loaded:', location.href);
  log('[Init] Pathname:', location.pathname);

  // If on pricing page, DO NOT auto-resume
  if (isPricingPage()) {
    log('[Init] On pricing page - handling pricing redirect only');
    checkPricingRedirect();
    return; // Stop here, do not auto-resume
  }

  autoResumeFromSession();

  // If on image page and no overlay shown yet, try to show it
  if (isImagePage() && !overlayEl) {
    log('[Init] On image page, checking for resume data...');
    tryShowOverlayOnImagePage();
  }

  // Check background pause state
  checkPauseState();
}

// Check if processing is paused and update overlay
function checkPauseState() {
  try {
    chrome.runtime.sendMessage({ type: 'queue:get' }, (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.isPaused && overlayEl) {
        log('[checkPauseState] queue is paused, updating overlay');
        updateOverlayPaused(true);
      }
    });
  } catch (e) {
    log('[checkPauseState] error', e);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'poc:process') {
    log('[onMessage] ========== POC:PROCESS RECEIVED ==========');
    log('[onMessage] File:', msg.item?.name);
    log('[onMessage] Format:', msg.format);
    log('[onMessage] Meta:', msg.meta);
    log('[onMessage] RemoveBackground:', msg.removeBackground);
    log('[onMessage] Current overlay state:', overlayEl ? 'exists' : 'null');
    log('[onMessage] ========================================');
    processFile(msg.item, msg.format || 'eps', msg.meta || {}, msg.removeBackground || false);
    return;
  }


  // Cancelar - remove a div flutuante
  if (msg.type === 'queue:cancel') {
    log('[content] ========== QUEUE CANCEL RECEIVED ==========');
    log('[content] Overlay exists:', overlayEl ? 'YES' : 'NO');
    log('[content] Setting abort flag and removing overlay...');
    shouldAbortProcessing = true; // Abort any ongoing processing
    stopKeepAlive(); // Stop keep-alive pings when queue is cancelled
    removeOverlay();
    log('[content] ========== CANCEL COMPLETE ==========');
    return;
  }

  // Pausar - atualiza status na div flutuante
  if (msg.type === 'queue:pause') {
    log('[content] queue paused - setting abort flag');
    shouldAbortProcessing = true; // Signal to abort current processing
    updateOverlayPaused(true);
    return;
  }

  // Continuar - atualiza status na div flutuante
  if (msg.type === 'queue:resume') {
    log('[content] queue resumed - clearing abort flag');
    shouldAbortProcessing = false; // Clear abort flag

    // Explicitly reset the position text (remove "Resuming...", restore "Image X of Y")
    // Retrieve stored meta if possible or just wait for next update
    // But updateOverlayPaused alone doesn't fix #vo-pos text if it was "Resuming..."

    // We try to restore the text. Since we don't have the current 'meta' in this message,
    // we set it to "Resumed" momentarily or rely on subsequent updates.
    // Ideally, the background sends a queue:update shortly. 
    // Just clearing the "Resuming..." text is helpful.
    const posEl = document.querySelector('#vo-pos');
    if (posEl && posEl.textContent.includes(t('resuming').replace('...', ''))) {
      posEl.textContent = t('processing');
    }

    updateOverlayPaused(false);
    stopAutoPauseCountdown();
    return;
  }

  // Auto-pause - mostra countdown na div flutuante
  if (msg.type === 'queue:autoPause') {
    log('[content] auto-pause activated, endTime:', msg.endTime);
    startAutoPauseCountdown(msg.endTime);
    return;
  }

  // Esperar (Keep-Alive) - inicia ping para manter background vivo
  if (msg.type === 'queue:wait') {
    log('[content] queue wait requested, duration:', msg.duration);
    startKeepAlive(msg.duration);
    return;
  }
});

// Keep-alive interval to prevent service worker suspension
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) return; // Already running

  log('[startKeepAlive] Starting keep-alive pings every 10s');
  keepAliveInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'keepAlive' }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        log('[keepAlive] ERROR:', lastError.message);
      } else {
        log('[keepAlive] Ping successful, response:', response);
      }
    });
  }, 10000); // Every 10 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    log('[stopKeepAlive] Stopping keep-alive pings');
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

async function processFile(item, format = 'eps', meta = {}, removeBackground = false) {
  try {
    // Reset abort flag at start of new processing
    shouldAbortProcessing = false;

    // Start keep-alive to prevent service worker suspension
    startKeepAlive();

    pricingHandled = false;
    pricingRedirected = false;
    if (isPricingPage()) {
      if (isRedirecting) return;

      pricingRedirected = true;
      if (!pricingHandled) {
        pricingHandled = true;
        log('[processFile] on pricing page, requesting retry and returning to home');
        stopKeepAlive(); // Stop keep-alive before redirecting
        requestRetry(item.name);
        isRedirecting = true;
        setTimeout(() => (location.href = location.origin), 300);
      }
      return;
    }

    log('[processFile] start', item.name, 'removeBackground:', removeBackground);
    showOverlay(item, meta);
    const file = new File([new Uint8Array(item.data)], item.name, { type: item.type });

    // Aguarda o input de upload estar disponível (até 10 segundos)
    let input = null;
    let inputAttempts = 0;
    while (!input && inputAttempts < 20) {
      // Check abort flag
      if (shouldAbortProcessing) {
        log('[processFile] ABORTED while waiting for input');
        stopKeepAlive();
        return;
      }

      input = document.querySelector('#FileInput-Field') || document.querySelector('input[type="file"]');
      if (!input) {
        log('[processFile] waiting for upload input... attempt', inputAttempts + 1);
        await delay(500);
        inputAttempts++;
      }
    }

    if (!input) {
      log('[processFile] upload input not found after 10 seconds');
      stopKeepAlive(); // Stop keep-alive before retry
      requestRetry(item.name);
      return;
    }

    // Check abort flag before uploading
    if (shouldAbortProcessing) {
      log('[processFile] ABORTED before upload');
      stopKeepAlive();
      return;
    }

    log('[processFile] upload input found, uploading file...');

    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    // Dispara múltiplos eventos para garantir que o upload seja reconhecido
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Aguarda um pouco e verifica se algo mudou na página
    await delay(1000);

    // Check abort flag
    if (shouldAbortProcessing) {
      log('[processFile] ABORTED after upload');
      stopKeepAlive();
      return;
    }

    // Tenta novamente se não houver indicação de processamento
    const processingIndicator = document.querySelector('.progress, [class*="progress"], [class*="loading"], [class*="upload"]');
    if (!processingIndicator) {
      log('[processFile] no processing indicator found, retrying upload...');
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(500);
    }

    // Check abort flag before waiting for download button
    if (shouldAbortProcessing) {
      log('[processFile] ABORTED before waiting for download button');
      stopKeepAlive();
      return;
    }

    // Aguarda o botão de download aparecer (indica que a imagem foi processada)
    let downloadBtn = await waitForDownloadButton();
    let currentDownloadUrl = downloadBtn?.href || null;

    // Check abort flag after download button appears
    if (shouldAbortProcessing) {
      log('[processFile] ABORTED after download button appeared - NOT clicking download');
      stopKeepAlive();
      return;
    }

    // Se removeBackground estiver ativo, executa o fluxo de remoção de fundo
    if (removeBackground) {
      log('[processFile] image processed, now starting background removal flow');

      const removeSuccess = await clickPaletteButton(item.width, item.height);

      if (!removeSuccess) {
        log('[processFile] background removal FAILED, stopping flow');
        // stopKeepAlive() will be called inside sendDone
        sendDone(item.name, 'error', null, new Error('Background removal failed'), meta);
        return;
      }

      // Check abort flag
      if (shouldAbortProcessing) {
        log('[processFile] ABORTED during background removal');
        stopKeepAlive();
        return;
      }

      // Após remover o fundo, a imagem é reprocessada
      // Aguarda o modal de progresso desaparecer (indica que processamento terminou)
      log('[processFile] waiting for progress modal to disappear...');

      await waitForProgressModalToDisappear();

      // Check abort flag
      if (shouldAbortProcessing) {
        log('[processFile] ABORTED after progress modal');
        stopKeepAlive();
        return;
      }

      log('[processFile] progress modal disappeared, image re-processed');

      // Busca o novo botão de download
      await delay(500); // Pequeno delay para garantir que a UI atualizou
      downloadBtn = document.querySelector('#App-DownloadLink');
      currentDownloadUrl = downloadBtn?.href || null;
      log('[processFile] download button after background removal:', currentDownloadUrl);
    }

    // Final abort check before downloading
    if (shouldAbortProcessing) {
      log('[processFile] ABORTED before download - NOT clicking download or sending done');
      stopKeepAlive();
      return;
    }

    setResumeFlag({
      name: item.name,
      downloadUrl: currentDownloadUrl,
      format,
      position: meta?.position,
      total: meta?.total,
      type: item.type
    });

    // Clica no botão de download
    log('[processFile] downloadBtn object:', downloadBtn);
    log('[processFile] currentDownloadUrl:', currentDownloadUrl);

    if (downloadBtn) {
      log('[processFile] clicking download button', currentDownloadUrl);
      downloadBtn.click();
      detectRecaptchaIframe();
    } else {
      // Tenta encontrar o botão diretamente pelo ID
      log('[processFile] downloadBtn is null, trying to find by ID...');
      const directBtn = document.querySelector('#App-DownloadLink');
      if (directBtn) {
        log('[processFile] found #App-DownloadLink, clicking it');
        directBtn.click();
        detectRecaptchaIframe();
      } else {
        log('[processFile] download button not found, trying manual click');
        manualDownloadClick();
        detectRecaptchaIframe();
      }
    }

    await clickOptionsSubmitAfterDelay(item.name, currentDownloadUrl, format);
    if (pricingRedirected || isPricingPage()) {
      log('[processFile] pricing redirect occurred, skipping done for', item.name);
      stopKeepAlive(); // Stop keep-alive before returning
      return;
    }
    sendDone(item.name, 'done', currentDownloadUrl, null, meta);
  } catch (e) {
    log('[processFile] error', e);
    if (pricingRedirected || isPricingPage()) {
      stopKeepAlive(); // Stop keep-alive before retry
      requestRetry(item?.name);
      return;
    }
    sendDone(item?.name || 'unknown', 'error', null, e, meta);
  }
}

function waitForDownloadButton() {
  return new Promise((resolve, reject) => {
    const existing = findMainDownloadLink();
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const btn = findMainDownloadLink();
      if (btn) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(btn);
      }
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject('timeout'); }, 600000);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Aguarda um botão de download com URL DIFERENTE da original (para quando a imagem é reprocessada)
function waitForNewDownloadButton(originalUrl, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    log('[waitForNewDownloadButton] waiting for new URL, original:', originalUrl);

    const checkForNewUrl = () => {
      const btn = findMainDownloadLink();
      if (btn && btn.href && btn.href !== originalUrl) {
        return btn;
      }
      return null;
    };

    // Verifica imediatamente
    const immediate = checkForNewUrl();
    if (immediate) {
      log('[waitForNewDownloadButton] found new URL immediately:', immediate.href);
      return resolve(immediate);
    }

    const observer = new MutationObserver(() => {
      const btn = checkForNewUrl();
      if (btn) {
        clearTimeout(timeout);
        observer.disconnect();
        log('[waitForNewDownloadButton] found new URL via observer:', btn.href);
        resolve(btn);
      }
    });

    const timeout = setTimeout(() => {
      observer.disconnect();
      log('[waitForNewDownloadButton] timeout reached');
      // Retorna o botão existente mesmo com URL antiga se timeout
      const btn = findMainDownloadLink();
      resolve(btn);
    }, timeoutMs);

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Aguarda o modal de progresso desaparecer (indica que o processamento terminou)
async function waitForProgressModalToDisappear(timeoutMs = 600000) {
  log('[waitForProgressModalToDisappear] starting...');

  const isModalVisible = () => {
    const modal = document.querySelector('#App-Progress-Pane');
    if (!modal) return false;

    // Verifica se o modal está realmente visível
    const parent = modal.closest('.modal');
    if (parent) {
      const style = window.getComputedStyle(parent);
      return style.display !== 'none' && style.visibility !== 'hidden';
    }

    return modal.offsetParent !== null;
  };

  const isProcessing = () => {
    // Verifica se há barras de progresso ativas
    const processBar = document.querySelector('#App-Progress-Process-Bar');
    const downloadBar = document.querySelector('#App-Progress-Download-Bar');

    if (processBar) {
      const width = parseFloat(processBar.style.width) || 0;
      const isActive = processBar.classList.contains('active');
      // Se a barra de processamento está ativa e não está em 100%, ainda está processando
      if (isActive && width < 100) {
        return true;
      }
    }

    if (downloadBar) {
      const width = parseFloat(downloadBar.style.width) || 0;
      // Se a barra de download está em 0%, ainda não terminou
      if (width === 0) {
        return true;
      }
    }

    return false;
  };

  // Primeiro: espera o modal APARECER (até 15 segundos - aumentado para imagens complexas)
  let waitForAppear = 0;
  while (!isModalVisible() && waitForAppear < 30) {
    log('[waitForProgressModalToDisappear] waiting for modal to appear... (' + (waitForAppear * 0.5) + 's)');
    await delay(500);
    waitForAppear++;
  }

  if (!isModalVisible()) {
    log('[waitForProgressModalToDisappear] modal never appeared, checking if processing anyway...');

    // Mesmo que o modal não apareça, espera um pouco para garantir
    // que o processamento teve tempo de começar
    await delay(2000);

    // Verifica se ainda está processando
    let processingChecks = 0;
    while (isProcessing() && processingChecks < 20) {
      log('[waitForProgressModalToDisappear] processing detected without modal visible, waiting... (' + (processingChecks * 0.5) + 's)');
      await delay(500);
      processingChecks++;
    }

    log('[waitForProgressModalToDisappear] processing check complete, continuing...');
    return;
  }

  log('[waitForProgressModalToDisappear] modal is visible, waiting for it to disappear...');

  // Depois: espera o modal DESAPARECER E o processamento terminar
  let attempts = 0;
  const maxAttempts = timeoutMs / 500;

  while ((isModalVisible() || isProcessing()) && attempts < maxAttempts) {
    await delay(500);
    attempts++;

    if (attempts % 10 === 0) {
      const processBar = document.querySelector('#App-Progress-Process-Bar');
      const processWidth = processBar ? parseFloat(processBar.style.width) || 0 : 0;
      log('[waitForProgressModalToDisappear] still waiting... (' + (attempts * 0.5) + 's) - Process: ' + processWidth.toFixed(1) + '%');
    }
  }

  if (attempts >= maxAttempts) {
    log('[waitForProgressModalToDisappear] timeout reached');
  } else {
    log('[waitForProgressModalToDisappear] modal disappeared and processing complete after', attempts * 0.5, 'seconds');
  }

  // Aguarda mais 1 segundo para garantir que a UI atualizou completamente
  log('[waitForProgressModalToDisappear] waiting additional 1s for UI to update...');
  await delay(1000);
}

async function clickOptionsSubmitAfterDelay(itemName, downloadUrl, format = 'eps') {
  try {
    const btn = await waitForOptionsSubmit(15000);
    if (!btn) return;
    selectFormatRadio(format);
    log('[clickOptionsSubmitAfterDelay] found confirm button, waiting 5s then click');
    await delay(5000);
    btn.click();
    log('[clickOptionsSubmitAfterDelay] clicked confirm button');
  } catch (_) {
    log('[clickOptionsSubmitAfterDelay] confirm button not found');
  }
}

function waitForOptionsSubmit(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const existing = findDownloadConfirmButton();
    if (existing) return resolve(existing);
    const observer = new MutationObserver(() => {
      const btn = findDownloadConfirmButton();
      if (btn) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(btn);
      }
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('Options-Submit not found'));
    }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function findDownloadConfirmButton() {
  const byId = document.querySelector('#Options-Submit');
  if (byId) return byId;
  const imgBtn = document.querySelector('button img[src*="download-white"]');
  if (imgBtn && imgBtn.closest('button')) return imgBtn.closest('button');
  return null;
}

function manualDownloadClick() {
  const topBox = document.querySelector('.ShowPage-topBox');
  if (!topBox) return;
  const btnById = topBox.querySelector('#Options-Submit');
  if (btnById) {
    log('[manualDownloadClick] clicking #Options-Submit inside ShowPage-topBox');
    btnById.click();
    return;
  }
  const imgBtn = topBox.querySelector('button img[src*="download-white"]');
  if (imgBtn && imgBtn.closest('button')) {
    log('[manualDownloadClick] clicking button with download-white inside ShowPage-topBox');
    imgBtn.closest('button').click();
  }
}

function findMainDownloadLink() {
  const byId = document.querySelector('#App-DownloadLink[href]:not([href="#"])');
  if (byId && byId.href && !byId.href.endsWith('#')) return byId;
  const topBox = document.querySelector('.ShowPage-topBox');
  if (topBox) {
    const linkWithIcon = topBox.querySelector('a[href]:has(img[src*="download-white"])');
    if (linkWithIcon && linkWithIcon.href && !linkWithIcon.href.endsWith('#')) return linkWithIcon;
    const buttonLink = topBox.querySelector('button img[src*="download-white"]');
    if (buttonLink && buttonLink.closest('a')) {
      const a = buttonLink.closest('a');
      if (a.href && !a.href.endsWith('#')) return a;
    }
  }
  return null;
}

function log(...args) {
  try { console.log('[Vectorizer-Ext]', ...args); } catch (_) { }
}

function selectFormatRadio(format = 'eps') {
  const value = format.toLowerCase();
  const targetId = value === 'svg' ? '#file_format_svg' : '#file_format_eps';
  const input = document.querySelector(targetId);
  if (input) {
    input.checked = true;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    log('[selectFormatRadio] selected', value);
  } else {
    log('[selectFormatRadio] target not found for', value);
  }
}

function setResumeFlag(data) {
  try {
    sessionStorage.setItem('vectorizer-auto-resume', JSON.stringify({ ...data, ts: Date.now() }));
    log('[setResumeFlag] saved for', data.name);
  } catch (e) {
    log('[setResumeFlag] error', e);
  }
}

function clearResumeFlag() {
  try {
    sessionStorage.removeItem('vectorizer-auto-resume');
    log('[clearResumeFlag] cleared');
  } catch (e) {
    log('[clearResumeFlag] error', e);
  }
}

function autoResumeFromSession() {
  try {
    const raw = sessionStorage.getItem('vectorizer-auto-resume');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data?.name) return;
    if (isPricingPage()) {
      log('[autoResumeFromSession] on pricing page - showing attention overlay and pausing');
      showPricingOverlay(data);
      requestRetry(data.name);
      // Pausa a fila
      try {
        chrome.runtime.sendMessage({ type: 'queue:pause' }, () => { });
      } catch (_) { }
      return;
    }
    log('[autoResumeFromSession] resuming for', data.name);
    // Mostra overlay mesmo na página de download (após redirecionar)
    showOverlay(
      { name: data.name, data: [], type: data.type || '' },
      { position: data.position || '?', total: data.total || '?' }
    );
    clickOptionsSubmitAfterDelay(data.name, data.downloadUrl, data.format || 'eps').finally(() => {
      clearResumeFlag();
      sendDone(data.name, 'done', data.downloadUrl, null, { position: data.position, total: data.total });
    });
  } catch (e) {
    log('[autoResumeFromSession] error', e);
  }
}

function checkPricingRedirect() {
  try {
    if (!location.pathname.includes('/pricing')) return;
    if (pricingHandled) {
      return; // Já tratou, não faz nada
    }
    pricingHandled = true;
    pricingRedirected = true;
    const raw = sessionStorage.getItem('vectorizer-auto-resume');
    const data = raw ? JSON.parse(raw) : null;
    log('[pricingRedirect] detected - staying on page and pausing IMMEDIATELY');

    // PRIMEIRO: Pausa a fila no background ANTES de qualquer outra coisa
    try {
      chrome.runtime.sendMessage({ type: 'queue:pause' }, () => {
        log('[pricingRedirect] queue paused');
      });
    } catch (_) { }

    // DEPOIS: Mostra overlay de ATENÇÃO
    showPricingOverlay(data);

    // POR ÚLTIMO: Solicita retry (o item volta para pending, mas a fila está pausada)
    try {
      chrome.runtime.sendMessage({ type: 'pricing:retry', name: data?.name }, () => { });
    } catch (_) { }


    // NÃO redireciona - fica na página para o usuário resolver

    // Mantém o Service Worker vivo enquanto estiver na página de pricing
    startKeepAlive(3600000); // 1 hora de ping
  } catch (e) {
    log('[pricingRedirect] error', e);
  }
}

// Mostra overlay de atenção na página de pricing
function showPricingOverlay(data) {
  try {
    // Remove overlay existente se houver
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }

    overlayEl = document.createElement('div');
    overlayEl.id = 'vectorizer-overlay';
    overlayEl.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      width: 300px;
      border-radius: 14px;
      background: rgba(239, 68, 68, 0.95);
      color: #ffffff;
      box-shadow: 0 12px 32px rgba(239, 68, 68, 0.5);
      font-family: "Segoe UI", "Inter", system-ui, sans-serif;
      z-index: 2147483647;
      padding: 16px;
      border: 2px solid #fca5a5;
      animation: pulse 2s infinite;
    `;

    // Adiciona animação de pulso
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { box-shadow: 0 12px 32px rgba(239, 68, 68, 0.5); }
        50% { box-shadow: 0 12px 48px rgba(239, 68, 68, 0.8); }
      }
    `;
    document.head.appendChild(style);

    overlayEl.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <span style="font-size:24px;">⚠️</span>
        <span style="font-size:14px; font-weight:700;">${t('captchaDetected')}</span>
      </div>
      <div style="font-size:13px; line-height:1.5; margin-bottom:12px;">
        <p style="margin:0 0 8px 0;">${t('processing')} <strong>${t('paused')}</strong></p>
        <p style="margin:0 0 8px 0;">${t('step1AddImage')}</p>
        <p style="margin:0 0 8px 0;">${t('step2SolveCaptcha')}</p>
        <p style="margin:0 0 8px 0;">${t('step3ClickResume')}</p>
      </div>
      <div style="font-size:11px; opacity:0.8; border-top:1px solid rgba(255,255,255,0.3); padding-top:10px;">
        ${t('image')}: ${data?.name || '?'} | Status: ⏸ ${t('paused')}
      </div>
    `;

    document.body.appendChild(overlayEl);
    log('[showOverlay] attention overlay shown');

  } catch (e) {
    log('[showPricingOverlay] error', e);
  }
}

function sendDone(name, status, downloadUrl, err, meta = {}) {
  try {
    clearResumeFlag();

    log('[sendDone]', name, status, 'position:', meta?.position, 'total:', meta?.total);

    // Check if this is the last image in the queue
    const isLastImage = meta?.position && meta?.total && parseInt(meta.position) >= parseInt(meta.total);
    log('[sendDone] isLastImage:', isLastImage);

    // Envia mensagem SIMPLES - sem retry
    chrome.runtime.sendMessage({
      type: 'poc:done',
      result: { name, status, downloadUrl, error: err ? String(err) : undefined }
    }, (response) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        log('[sendDone] ERROR:', lastError.message);
      } else {
        log('[sendDone] Success, response:', response);
      }

      // CRITICAL: Only stop keep-alive if this is the LAST image
      // Otherwise, keep pinging to prevent Service Worker from suspending during delay
      if (isLastImage) {
        log('[sendDone] Last image processed, stopping keep-alive');
        stopKeepAlive();
      } else {
        log('[sendDone] More images pending, keeping keep-alive active');
      }
    });

    // Marca overlay como completo se for o último arquivo
    markOverlayComplete(meta?.position, meta?.total);

    // hideOverlay() não remove mais, apenas mantém visível
    hideOverlay();
  } catch (e) {
    log('[sendDone] error', e);
    // Only stop keep-alive on error if it's the last image
    const isLastImage = meta?.position && meta?.total && parseInt(meta.position) >= parseInt(meta.total);
    if (isLastImage) {
      stopKeepAlive();
    }
  }
}

// ---------- Overlay ----------
let overlayEl = null;
let overlayTimer = null;
let overlayStart = null;
let globalStartTime = null; // Tempo global de início da sessão
let isTimerRunning = false;

// Salva/recupera tempo global do sessionStorage
function saveGlobalTime() {
  try {
    if (globalStartTime) {
      sessionStorage.setItem('vectorizer-global-time', JSON.stringify({
        startTime: globalStartTime,
        isRunning: isTimerRunning
      }));
    }
  } catch (e) {
    log('[saveGlobalTime] error', e);
  }
}

function loadGlobalTime() {
  try {
    const raw = sessionStorage.getItem('vectorizer-global-time');
    if (raw) {
      const data = JSON.parse(raw);
      globalStartTime = data.startTime;
      isTimerRunning = data.isRunning;
      return true;
    }
  } catch (e) {
    log('[loadGlobalTime] error', e);
  }
  return false;
}

function startGlobalTimer() {
  if (!globalStartTime) {
    globalStartTime = Date.now();
    log('[startGlobalTimer] Timer iniciado em:', new Date(globalStartTime).toLocaleTimeString());
  }
  isTimerRunning = true;
  saveGlobalTime();

  // Inicia o interval se não estiver rodando
  if (!overlayTimer && overlayEl) {
    const timeEl = overlayEl.querySelector('#vo-time');
    overlayTimer = setInterval(() => {
      if (isTimerRunning && globalStartTime) {
        const diff = Date.now() - globalStartTime;
        if (timeEl) timeEl.textContent = formatTime(diff);
      }
    }, 1000);
  }
}

function stopGlobalTimer() {
  isTimerRunning = false;
  saveGlobalTime();
  log('[stopGlobalTimer] Timer parado. Tempo total:', formatTime(Date.now() - globalStartTime));
}

function resetGlobalTimer() {
  globalStartTime = null;
  isTimerRunning = false;
  sessionStorage.removeItem('vectorizer-global-time');
  log('[resetGlobalTimer] Timer resetado');
}

function showOverlay(item, meta) {
  try {
    // Carrega tempo global se existir
    loadGlobalTime();

    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'vectorizer-overlay';
      overlayEl.style.cssText = `
        position: fixed;
        bottom: 12px;
        right: 12px;
        width: 260px;
        border-radius: 14px;
        background: rgba(20,22,30,0.94);
        color: #f5f7ff;
        box-shadow: 0 12px 32px rgba(0,0,0,0.35);
        font-family: "Segoe UI", "Inter", system-ui, sans-serif;
        z-index: 2147483647;
        padding: 12px;
        box-sizing: border-box;
      `;
      overlayEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; font-weight:700; opacity:0.9;">
          <span>Batch Vectorizer</span>
          <div style="display:flex; align-items:center; gap:8px;">
            <span id="vo-status">${t('processing')}</span>
            <button id="vo-close" style="background:transparent; border:none; color:#9ca3af; cursor:pointer; font-size:16px; padding:0; width:20px; height:20px; display:flex; align-items:center; justify-content:center; border-radius:4px; transition:all 0.2s;" title="Fechar">✕</button>
          </div>
        </div>
        <div style="display:flex; gap:10px; margin-top:10px;">
          <div id="vo-thumb" style="width:46px; height:46px; border-radius:10px; background:#232734 center/cover no-repeat; flex-shrink:0;"></div>
          <div style="flex:1; min-width:0;">
            <div id="vo-title" style="font-size:12px; font-weight:600; line-height:1.3; max-height:32px; overflow:hidden;"></div>
            <div id="vo-pos" style="font-size:11px; margin-top:4px; opacity:0.8;"></div>
            <div id="vo-notice" style="font-size:11px; margin-top:4px; color:#f6d365; display:none;"></div>
          </div>
        </div>
        <div style="margin-top:8px; font-size:11px; opacity:0.85;">
          ${t('totalTime')} <span id="vo-time">00:00</span>
        </div>
        <div style="margin-top:8px; width:100%; height:6px; border-radius:999px; background:#2f3544; overflow:hidden;">
          <div id="vo-bar" style="height:100%; width:0%; background:linear-gradient(135deg,#1cc9f4,#0da7e0);"></div>
        </div>
      `;
      document.body.appendChild(overlayEl);

      // Add close button handler
      const closeBtn = overlayEl.querySelector('#vo-close');
      if (closeBtn) {
        closeBtn.addEventListener('mouseenter', () => {
          closeBtn.style.background = '#ef4444';
          closeBtn.style.color = '#ffffff';
        });
        closeBtn.addEventListener('mouseleave', () => {
          closeBtn.style.background = 'transparent';
          closeBtn.style.color = '#9ca3af';
        });
        closeBtn.addEventListener('click', () => {
          log('[overlay] Close button clicked');
          removeOverlay();
        });
      }
    }

    const titleEl = overlayEl.querySelector('#vo-title');
    const posEl = overlayEl.querySelector('#vo-pos');
    const noticeEl = overlayEl.querySelector('#vo-notice');
    const timeEl = overlayEl.querySelector('#vo-time');
    const barEl = overlayEl.querySelector('#vo-bar');
    const thumbEl = overlayEl.querySelector('#vo-thumb');
    const statusEl = overlayEl.querySelector('#vo-status');

    titleEl.textContent = item?.name || t('image');
    const pos = meta?.position ? parseInt(meta.position) : 0;
    const total = meta?.total ? parseInt(meta.total) : 0;
    posEl.textContent = `${t('image')} ${pos || '?'} ${t('of')} ${total || '?'}`;

    // Atualiza status
    if (statusEl) {
      statusEl.textContent = t('processing');
      statusEl.style.color = '#f5f7ff';
    }

    if (meta?.notice) {
      noticeEl.textContent = meta.notice;
      noticeEl.style.display = 'block';
    } else {
      noticeEl.style.display = 'none';
    }

    // thumb
    if (item?.data?.length && thumbEl) {
      const blob = new Blob([new Uint8Array(item.data)], { type: item.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      thumbEl.style.backgroundImage = `url("${url}")`;
      thumbEl.style.display = 'block';
    } else if (thumbEl) {
      // Esconde thumbnail quando nao ha dados
      thumbEl.style.display = 'none';
    }

    // Atualiza barra de progresso baseado na posição
    if (pos && total) {
      const percent = Math.round((pos / total) * 100);
      barEl.style.width = `${percent}%`;
    } else {
      barEl.style.width = '30%';
    }

    // Inicia timer global se ainda não iniciou
    startGlobalTimer();

    // Atualiza display do tempo imediatamente
    if (globalStartTime && timeEl) {
      timeEl.textContent = formatTime(Date.now() - globalStartTime);
    }



    // Garante que o interval está rodando
    if (!overlayTimer) {
      overlayTimer = setInterval(() => {
        if (isTimerRunning && globalStartTime && overlayEl) {
          const timeEl = overlayEl.querySelector('#vo-time');
          if (timeEl) timeEl.textContent = formatTime(Date.now() - globalStartTime);
        }
      }, 1000);
    }
  } catch (e) {
    log('[showOverlay] error', e);
  }
}

// Atualiza o overlay para mostrar que terminou (mas não remove)
function markOverlayComplete(position, total) {
  try {
    if (!overlayEl) return;

    const statusEl = overlayEl.querySelector('#vo-status');
    const barEl = overlayEl.querySelector('#vo-bar');
    const posEl = overlayEl.querySelector('#vo-pos');

    // Verifica se é o último arquivo
    const isLastFile = position && total && parseInt(position) >= parseInt(total);

    if (isLastFile) {
      // Para o timer quando o último arquivo é processado
      stopGlobalTimer();

      // Para o keep-alive quando terminar
      stopKeepAlive();

      if (statusEl) {
        statusEl.textContent = `${t('completed')}!`;
        statusEl.style.color = '#4ade80'; // Verde
      }
      if (barEl) {
        barEl.style.width = '100%';
        barEl.style.background = 'linear-gradient(135deg, #4ade80, #22c55e)'; // Verde
      }
      if (posEl) {
        posEl.textContent = `${total} ${t('images')} ${t('processed')}!`;
      }
    }
  } catch (e) {
    log('[markOverlayComplete] error', e);
  }
}

function hideOverlay() {
  // Não remove mais o overlay, apenas atualiza o status se necessário
  try {
    log('[hideOverlay] called - overlay permanece visível');
  } catch (e) {
    log('[hideOverlay] error', e);
  }
}

// Remove completamente a div flutuante
function removeOverlay() {
  try {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
      log('[removeOverlay] overlay removed');
    }
    stopGlobalTimer();
    // Limpa dados de sessão
    sessionStorage.removeItem('vectorizer_resume');
  } catch (e) {
    log('[removeOverlay] error', e);
  }
}

// Atualiza a div flutuante para mostrar status de pausado
function updateOverlayPaused(isPaused) {
  try {
    if (!overlayEl) return;

    const statusEl = overlayEl.querySelector('#vo-status');
    if (statusEl) {
      if (isPaused) {
        statusEl.textContent = `⏸ ${t('paused')}`;
        statusEl.style.color = '#f59e0b';
        // NÃO para o timer - tempo total continua rodando
      } else {
        statusEl.textContent = t('processing');
        statusEl.style.color = '#ffffff';
      }
    }
  } catch (e) {
    log('[updateOverlayPaused] error', e);
  }
}

// Variáveis para countdown de auto-pause
let autoPauseCountdownTimer = null;
let keepAliveTimer = null;
let autoPauseEndTime = null;

// Inicia countdown de auto-pause na div flutuante
function startAutoPauseCountdown(endTime) {
  try {
    // Se o overlay não existir, cria um genérico para mostrar o status
    if (!overlayEl) {
      showOverlay({ name: 'Batch Vectorizer' }, { position: 0, total: 0 });
    }
    if (!overlayEl) return;

    autoPauseEndTime = endTime;
    // NÃO para o timer - tempo total continua rodando

    const statusEl = overlayEl.querySelector('#vo-status');
    const posEl = overlayEl.querySelector('#vo-pos');

    // Atualiza status
    if (statusEl) {
      statusEl.textContent = `⏸ ${t('autoPause')}`;
      statusEl.style.color = '#f59e0b';
    }

    // Função para atualizar o countdown
    const updateCountdown = () => {
      const remaining = autoPauseEndTime - Date.now();
      if (remaining <= 0) {
        if (posEl) posEl.textContent = t('resuming');
        stopAutoPauseCountdown();
        return;
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      if (posEl) {
        posEl.textContent = `⏱ ${t('resuming').replace('...', '')}: ${minutes}:${String(seconds).padStart(2, '0')}`;
      }
    };

    // Atualiza imediatamente
    updateCountdown();

    // Inicia interval para atualizar a cada segundo
    if (autoPauseCountdownTimer) clearInterval(autoPauseCountdownTimer);
    autoPauseCountdownTimer = setInterval(updateCountdown, 1000);

    log('[startAutoPauseCountdown] countdown started, endTime:', endTime);

    // Inicia Keep-Alive para manter o Service Worker acordado
    startKeepAlive(endTime - Date.now());

  } catch (e) {
    log('[startAutoPauseCountdown] error', e);
  }
}

// Inicia pings de keep-alive por uma duração específica
function startKeepAlive(durationMs) {
  if (keepAliveTimer) clearInterval(keepAliveTimer);

  if (durationMs <= 0) return;

  log('[startKeepAlive] starting pings for', durationMs, 'ms');

  // Ping inicial
  chrome.runtime.sendMessage({ type: 'keepAlive' }).catch(() => { });

  keepAliveTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'keepAlive' }).catch(() => { });
  }, 20000); // Ping a cada 20 segundos

  // Para automaticamente após a duração (+ buffer de 5s)
  setTimeout(() => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      log('[startKeepAlive] stopped after duration');
    }
  }, durationMs + 5000);
}



// Para o countdown de auto-pause
function stopAutoPauseCountdown() {
  try {
    if (autoPauseCountdownTimer) {
      clearInterval(autoPauseCountdownTimer);
      autoPauseCountdownTimer = null;
    }
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    autoPauseEndTime = null;
    log('[stopAutoPauseCountdown] countdown stopped');
  } catch (e) {
    log('[stopAutoPauseCountdown] error', e);
  }
}

// Função completa para remover fundo via paleta
// Retorna true se completou com sucesso, false se falhou
async function clickPaletteButton(imageWidth = 0, imageHeight = 0) {
  try {
    log('[clickPaletteButton] starting background removal flow...');
    log('[clickPaletteButton] image dimensions:', imageWidth, 'x', imageHeight);

    // Passo 1: Clica no botão de paleta para abrir o modal
    const paletteBtn = await waitForPaletteButton(15000);
    if (!paletteBtn) {
      log('[clickPaletteButton] palette button not found, aborting');
      return false;
    }

    log('[clickPaletteButton] clicking palette button');
    paletteBtn.click();

    // Aguarda o modal de paleta abrir
    log('[clickPaletteButton] waiting 5s for palette modal to open...');
    await delay(5000);

    // Passo 2: Clica no canvas na posição (30, 30) relativa à imagem
    log('[clickPaletteButton] step 2 - clicking on canvas at image position (30, 30)...');
    const backgroundCircle = await findAndClickBackgroundColor(imageWidth, imageHeight);
    if (!backgroundCircle) {
      log('[clickPaletteButton] could not click on canvas, ABORTING');
      return false;
    }

    // Aguarda a cor ser selecionada
    log('[clickPaletteButton] waiting after canvas click...');
    await delay(1500);

    // Passo 3: Desmarca o checkbox para excluir a cor do resultado
    const includeCheckbox = document.querySelector('#App-SubApps-Palette-ColorEditor-IncludeInput');
    log('[clickPaletteButton] step 3 - include checkbox element:', includeCheckbox);
    if (includeCheckbox) {
      log('[clickPaletteButton] step 3 - checkbox checked state:', includeCheckbox.checked);
      if (includeCheckbox.checked) {
        log('[clickPaletteButton] step 3 - unchecking checkbox to exclude color');
        includeCheckbox.click();
        await delay(1000);
      } else {
        log('[clickPaletteButton] step 3 - checkbox already unchecked');
      }
    } else {
      log('[clickPaletteButton] step 3 - checkbox NOT FOUND, ABORTING');
      return false;
    }

    // Passo 4: Clica no botão de aceitar do editor de cor
    // ID: App-SubApps-Palette-ColorEditor-AcceptButton (independente do idioma)
    const acceptBtn = document.querySelector('#App-SubApps-Palette-ColorEditor-AcceptButton');
    log('[clickPaletteButton] step 4 - color editor accept button element:', acceptBtn);
    if (acceptBtn) {
      log('[clickPaletteButton] step 4 - clicking color editor accept button');
      acceptBtn.click();
      await delay(1000);
    } else {
      log('[clickPaletteButton] step 4 - color editor accept button NOT FOUND, ABORTING');
      return false;
    }

    // Passo 5: Clica no botão de aceitar da barra de ferramentas para confirmar todas as alterações
    // ID: App-SubApps-Toolbar-Accept (independente do idioma)
    const toolbarAcceptBtn = document.querySelector('#App-SubApps-Toolbar-Accept');
    log('[clickPaletteButton] step 5 - toolbar accept button element:', toolbarAcceptBtn);
    if (toolbarAcceptBtn) {
      log('[clickPaletteButton] step 5 - simulating real user click on toolbar accept button');

      // Simula clique real do usuário
      await simulateRealClick(toolbarAcceptBtn);

      // Aguarda 2 segundos após clicar
      log('[clickPaletteButton] waiting 2 seconds after toolbar accept click...');
      await delay(2000);

      log('[clickPaletteButton] background removal completed successfully');
      return true;
    } else {
      log('[clickPaletteButton] step 5 - toolbar accept button NOT FOUND, ABORTING');
      return false;
    }

  } catch (e) {
    log('[clickPaletteButton] error', e);
    return false;
  }
}

// Simula um clique real do usuário em um elemento
async function simulateRealClick(element) {
  try {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    log('[simulateRealClick] clicking at center:', centerX, centerY);

    // Propriedades comuns para os eventos
    const eventProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: centerX,
      clientY: centerY,
      screenX: window.screenX + centerX,
      screenY: window.screenY + centerY,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0.5
    };

    // Foca no elemento primeiro
    element.focus();
    await delay(50);

    // Dispara eventos de pointer
    element.dispatchEvent(new PointerEvent('pointerenter', eventProps));
    element.dispatchEvent(new PointerEvent('pointerover', eventProps));
    await delay(50);

    element.dispatchEvent(new PointerEvent('pointerdown', eventProps));
    await delay(100);

    element.dispatchEvent(new PointerEvent('pointerup', eventProps));
    await delay(50);

    // Dispara eventos de mouse
    element.dispatchEvent(new MouseEvent('mouseenter', eventProps));
    element.dispatchEvent(new MouseEvent('mouseover', eventProps));
    element.dispatchEvent(new MouseEvent('mousedown', eventProps));
    await delay(50);
    element.dispatchEvent(new MouseEvent('mouseup', eventProps));
    element.dispatchEvent(new MouseEvent('click', eventProps));

    log('[simulateRealClick] click events dispatched successfully');

  } catch (e) {
    log('[simulateRealClick] error, falling back to simple click:', e);
    element.click();
  }
}

// Encontra e clica no canvas da preview na posição do fundo (canto superior esquerdo da imagem)
async function findAndClickBackgroundColor(imageWidth = 0, imageHeight = 0) {
  try {
    // O canvas de preview está dentro de #App-SubApps-View
    const viewContainer = document.querySelector('#App-SubApps-View');
    if (!viewContainer) {
      log('[findAndClickBackgroundColor] view container not found');
      return null;
    }

    const canvas = viewContainer.querySelector('canvas');
    if (!canvas) {
      log('[findAndClickBackgroundColor] canvas not found');
      return null;
    }

    // Pega as coordenadas do canvas
    const rect = canvas.getBoundingClientRect();
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;

    log('[findAndClickBackgroundColor] canvas dimensions:', canvasWidth, 'x', canvasHeight);
    log('[findAndClickBackgroundColor] original image dimensions:', imageWidth, 'x', imageHeight);

    // Calculate click position
    let offsetX, offsetY;

    if (imageWidth > 0 && imageHeight > 0) {
      // Calculate image scale factor on canvas
      // Image is resized to fit canvas while maintaining aspect ratio
      const scaleX = canvasWidth / imageWidth;
      const scaleY = canvasHeight / imageHeight;
      const scale = Math.min(scaleX, scaleY); // Use the smaller one to maintain aspect ratio

      // Dimensions of the image rendered on canvas
      const renderedWidth = imageWidth * scale;
      const renderedHeight = imageHeight * scale;

      // Offset for centering the image on canvas
      const imageOffsetX = (canvasWidth - renderedWidth) / 2;
      const imageOffsetY = (canvasHeight - renderedHeight) / 2;

      log('[findAndClickBackgroundColor] scale:', scale, 'rendered size:', renderedWidth, 'x', renderedHeight);
      log('[findAndClickBackgroundColor] image offset in canvas:', imageOffsetX, imageOffsetY);

      // Clica na posição (40, 40) da imagem original, convertida para posição do canvas
      const targetImageX = 40;
      const targetImageY = 40;
      offsetX = imageOffsetX + (targetImageX * scale);
      offsetY = imageOffsetY + (targetImageY * scale);
    } else {
      // Fallback: clica em (30, 30) do canvas se não tivermos dimensões
      log('[findAndClickBackgroundColor] no image dimensions, using fallback position');
      offsetX = 30;
      offsetY = 30;
    }

    const clientX = rect.left + offsetX;
    const clientY = rect.top + offsetY;
    const screenX = window.screenX + clientX;
    const screenY = window.screenY + clientY;

    log('[findAndClickBackgroundColor] clicking at canvas offset:', offsetX, offsetY, '| client:', clientX, clientY);

    // Cria um marcador visual para mostrar onde está clicando (debug)
    const marker = document.createElement('div');
    marker.style.cssText = `
      position: fixed;
      left: ${clientX - 5}px;
      top: ${clientY - 5}px;
      width: 10px;
      height: 10px;
      background: red;
      border-radius: 50%;
      z-index: 999999;
      pointer-events: none;
    `;
    document.body.appendChild(marker);
    log('[findAndClickBackgroundColor] visual marker added at click position');

    // Propriedades comuns para os eventos
    const eventProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX,
      clientY: clientY,
      screenX: screenX,
      screenY: screenY,
      offsetX: offsetX,
      offsetY: offsetY,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: 0.5
    };

    // Try with PointerEvent first (more modern)
    try {
      log('[findAndClickBackgroundColor] dispatching pointer events...');

      canvas.dispatchEvent(new PointerEvent('pointerenter', eventProps));
      canvas.dispatchEvent(new PointerEvent('pointerover', eventProps));
      await delay(50);

      canvas.dispatchEvent(new PointerEvent('pointerdown', eventProps));
      await delay(100);

      canvas.dispatchEvent(new PointerEvent('pointerup', eventProps));
      await delay(50);

      canvas.dispatchEvent(new PointerEvent('click', eventProps));

      log('[findAndClickBackgroundColor] pointer events dispatched');
    } catch (e) {
      log('[findAndClickBackgroundColor] pointer events failed, trying mouse events', e);
    }

    // Also dispatch MouseEvents as fallback
    try {
      log('[findAndClickBackgroundColor] dispatching mouse events...');

      canvas.dispatchEvent(new MouseEvent('mouseenter', eventProps));
      canvas.dispatchEvent(new MouseEvent('mouseover', eventProps));
      await delay(50);

      canvas.dispatchEvent(new MouseEvent('mousedown', eventProps));
      await delay(100);

      canvas.dispatchEvent(new MouseEvent('mouseup', eventProps));
      await delay(50);

      canvas.dispatchEvent(new MouseEvent('click', eventProps));

      log('[findAndClickBackgroundColor] mouse events dispatched');
    } catch (e) {
      log('[findAndClickBackgroundColor] mouse events failed', e);
    }

    // Remove the visual marker after 5 seconds
    setTimeout(() => marker.remove(), 5000);

    log('[findAndClickBackgroundColor] click simulation complete');
    return canvas;

  } catch (e) {
    log('[findAndClickBackgroundColor] error', e);
    return null;
  }
}

// Waits for the palette button to appear
function waitForPaletteButton(timeoutMs = 10000) {
  return new Promise((resolve) => {
    // Tries to find the button by ID (unique and reliable)
    const existing = document.querySelector('#App-Toolbar-Palette');
    if (existing) {
      log('[waitForPaletteButton] found immediately');
      return resolve(existing);
    }

    const observer = new MutationObserver(() => {
      const btn = document.querySelector('#App-Toolbar-Palette');
      if (btn) {
        clearTimeout(timeout);
        observer.disconnect();
        log('[waitForPaletteButton] found via observer');
        resolve(btn);
      }
    });

    const timeout = setTimeout(() => {
      observer.disconnect();
      log('[waitForPaletteButton] timeout reached');
      resolve(null);
    }, timeoutMs);

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function detectRecaptchaIframe() {
  try {
    const iframe = document.querySelector('iframe[title*="recaptcha challenge"]');
    if (iframe) {
      log('[recaptcha] iframe detected');
    } else {
      log('[recaptcha] not found');
    }
  } catch (e) {
    log('[recaptcha] error', e);
  }
}

function isPricingPage() {
  return location.pathname.includes('/pricing');
}

function isImagePage() {
  return location.pathname.includes('/images/');
}

function tryShowOverlayOnImagePage() {
  try {
    const raw = sessionStorage.getItem('vectorizer-auto-resume');
    log('[tryShowOverlayOnImagePage] sessionStorage raw:', raw);

    if (raw) {
      const data = JSON.parse(raw);
      log('[tryShowOverlayOnImagePage] parsed data:', data);

      if (data?.name) {
        showOverlay(
          { name: data.name, data: [], type: data.type || '' },
          { position: data.position || '?', total: data.total || '?' }
        );
        log('[tryShowOverlayOnImagePage] overlay shown for:', data.name);
      }
    } else {
      // If there is no session data but we are on the image page,
      // show a generic overlay indicating that it is processing
      log('[tryShowOverlayOnImagePage] no session data, showing generic overlay');
      showOverlay(
        { name: 'Processing image...', data: [], type: '' },
        { position: '?', total: '?' }
      );
    }
  } catch (e) {
    log('[tryShowOverlayOnImagePage] error:', e);
  }
}

function requestRetry(name) {
  try {
    chrome.runtime.sendMessage({ type: 'poc:retry', name }, () => { });
  } catch (e) {
    log('[requestRetry] error', e);
  }
}

// Initialize the content script (wait for language to load)
(async function () {
  await initLanguage();
  initContentScript();
})();
