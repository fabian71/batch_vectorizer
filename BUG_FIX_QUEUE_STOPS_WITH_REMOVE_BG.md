# Bug Fix: Queue Stops After First Image with Remove Background

## Date: 2025-12-19

## Problem
The user reported that when "Remove Background" (Cortar Fundo) option is enabled, the extension only processes the first image and then stops. The queue does not advance to the next image.

## Analysis

Looking at the console logs:
```
[sendDone] More images pending, keeping keep-alive active
```

And then errors like:
```
[sendProcessMessage] ERROR: The message port closed before a response was received.
```

This shows that the background was trying to send the next image but the content script was not responding.

### Root Causes Found

1. **Missing `startKeepAliveForDuration` function**: 
   - In `content.js` line 113, when the background sends `queue:wait`, it calls `startKeepAliveForDuration(msg.duration)` 
   - However, this function was **never defined** in the file!
   - Only `startKeepAlive()` and `stopKeepAlive()` existed
   - This caused a silent JavaScript error when the background tried to request keep-alive

2. **Keep-alive not requested for short delays**:
   - In `background.js`, the `markDone` function only requested keep-alive when `waitMs > 20000` (20+ seconds)
   - For shorter delays (like 5 seconds default), no keep-alive was requested
   - This meant the Service Worker could be suspended during the delay between images

3. **Content script not responding to messages**:
   - The message listener was not using `sendResponse` properly
   - Messages were not returning `true` to keep the channel open
   - This caused "message port closed" errors

4. **No verification that content script is ready**:
   - After navigating back to home page, the background immediately sent messages
   - But the content script might not be fully initialized yet
   - There was no "ping" mechanism to verify content script readiness

## Solution

### 1. Added `startKeepAliveForDuration` function (content.js)
```javascript
function startKeepAliveForDuration(durationMs) {
  // Clear any existing duration timeout
  if (keepAliveDurationTimeout) {
    clearTimeout(keepAliveDurationTimeout);
  }
  
  // Start the regular keep-alive
  startKeepAlive();
  
  // Schedule stopping after duration (but check if still needed first)
  keepAliveDurationTimeout = setTimeout(() => {
    // Check queue status before stopping
    chrome.runtime.sendMessage({ type: 'queue:get' }, (res) => {
      const hasPending = res?.queue?.some(q => q.status === 'pending' || q.status === 'processing');
      if (!hasPending) {
        stopKeepAlive();
      }
    });
  }, durationMs);
}
```

### 2. Fixed `markDone` to always request keep-alive when pending items exist (background.js)
Changed from:
```javascript
if (waitMs > 20000 && workerTabId) {
  // Only for long waits
}
```

To:
```javascript
const stillHasPending = queue.some(q => q.status === 'pending');
if (stillHasPending && workerTabId) {
  const keepAliveDuration = Math.max(waitMs + 20000, 30000); // At least 30 seconds
  chrome.tabs.sendMessage(workerTabId, { type: 'queue:wait', duration: keepAliveDuration });
}
```

### 3. Added "ping" mechanism to verify content script readiness (background.js)
```javascript
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
        return true;
      }
    } catch (e) {
      // Wait and retry
    }
    await new Promise(resolve => setTimeout(resolve, 500 + (attempt * 200)));
  }
  return false;
}
```

### 4. Fixed message listener to respond properly (content.js)
- Added `sendResponse` parameter to the listener
- Added response for each message type
- Return `true` to keep message channel open
- Added handler for 'ping' message type

### 5. Improved retry logic (background.js)
- Increased max retries from 3 to 5
- Increased delay between retries from 500ms to 1000ms
- Wait for content script to be ready before sending first message

## Files Modified
- `content.js`: 
  - Added `startKeepAliveForDuration` function
  - Added `ping` handler
  - Fixed message listener to use `sendResponse` properly
- `background.js`: 
  - Modified `markDone` to always request keep-alive when pending items exist
  - Added `waitForContentScript` function
  - Modified `sendProcessMessage` to wait for content script before sending
  - Added better logging in `ensureTab` for debugging

## Testing
1. Load 3+ images with "Remove Background" enabled
2. Start processing
3. Check console logs for:
   - `[waitForContentScript] Content script is ready after X attempts`
   - `[onMessage] Ping received, responding with pong`
4. Verify all images are processed sequentially
5. Check that keep-alive messages are being sent between images
