# Bug Fix: Queue Stops After First Image When "Remove Background" is Enabled

## Problem
For some users, when the "Remove Background" option was enabled, the extension would only process the first image in the queue. After the first image completed successfully, subsequent images would not be processed.

## Root Cause
The issue was in the `ensureTab()` function in `background.js`. 

After processing an image with "Remove Background":
1. The tab navigates to a result page (e.g., `/images/1234567890-...`)
2. When `kick()` is called to process the next image, `ensureTab()` was returning the existing tab **without checking if it was on the correct page**
3. The content script on the result page doesn't have the upload input field available
4. The `processFile()` function would wait 10 seconds looking for the upload input, then call `requestRetry()`, but this didn't properly advance the queue

## Solution
Modified `ensureTab()` to:
1. Check if the existing tab is on an image result page (`/images/...`)
2. If so, navigate the tab back to the home page before returning
3. Wait for the page to fully load (using `chrome.tabs.onUpdated` listener with a 15-second timeout)
4. Wait an additional 2 seconds to ensure the content script is fully initialized
5. Only then return the tab for the next image to be processed

## Code Changes
- **File**: `background.js`
- **Function**: `ensureTab()`
- Added URL check for `/images/` path
- Added navigation back to home URL when on result page
- Added proper wait for page load completion

## Testing
1. Enable "Remove Background" option
2. Add 2+ images to the queue
3. Verify all images are processed sequentially
4. Check console logs for:
   - `[ensureTab] Tab is on image result page, navigating back to home:`
   - `[ensureTab] Navigation to home complete, returning tab`

## Date
2025-12-18
