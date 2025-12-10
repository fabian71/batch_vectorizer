# Batch Vectorizer - Unofficial Tool

**Batch Vectorizer - Unofficial Tool** is a powerful browser extension designed to automate the process of vectorizing images using [Vectorizer.ai](https://vectorizer.ai/). It allows you to queue multiple images, process them automatically, and download the results in your preferred format, all while managing processing intervals to avoid rate limits.

## 🚀 Features

*   **Bulk Processing:** Upload multiple images at once (PNG, JPG, GIF) and process them in a queue.
*   **Automated Workflow:** Automatically uploads, waits for processing, and downloads the vectorized result.
*   **Queue Management:** View the status of each image in the queue, pause, resume, or cancel the entire process.
*   **Smart Auto-Pause:** Configure automatic pauses after a certain number of images to prevent being blocked by the website (e.g., pause for 3 minutes every 80 images).
*   **Background Removal:** Option to automatically remove the background from images during processing.
*   **Format Selection:** Choose between **EPS** and **SVG** output formats.
*   **Custom Download Folder:** Organize your downloads by specifying a subfolder within your browser's default download directory.
*   **Internationalization (i18n):** Fully translated into 16 languages, including English, Portuguese, Spanish, French, German, Italian, Japanese, Korean, Russian, Chinese, and more.
*   **Drag & Drop:** Easily drag and drop images directly into the extension popup.
*   **Cross-Browser Support:** Compatible with Chrome, Edge, Brave, and Opera.

## 🛠️ Installation

1.  Download or clone this repository.
2.  Open your browser and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked**.
5.  Select the folder containing the extension files.

## 📖 Usage

1.  **Open the Extension:** Click the Vectorizer Automator icon in your browser toolbar.
2.  **Select Images:** Click "Select files" or drag and drop your images into the drop zone.
3.  **Configure Settings:**
    *   **Type:** Select EPS or SVG.
    *   **Interval:** Set the delay (in seconds) between processing each image.
    *   **Destination Folder:** (Optional) Name a folder to save your files.
    *   **Remove Background:** Check if you want to remove backgrounds.
    *   **Scheduled Pause:** Enable and configure auto-pause settings if processing large batches.
4.  **Start:** Click **"🚀 Start Vectorization"**.
5.  **Relax:** The extension will handle the rest. You can see the progress in the popup or via the floating overlay on the page.

## ⚠️ Important Note

For the extension to work seamlessly without interruption, **you must disable the "Ask where to save each file before downloading"** option in your browser settings.
*   **Chrome/Edge/Brave:** Settings > Downloads > Ask where to save each file before downloading (Disable).

## 🌍 Supported Languages
*   English
*   Português
*   Español
*   Français
*   Deutsch
*   Italiano
*   日本語 (Japanese)
*   한국어 (Korean)
*   Русский (Russian)
*   中文 (Chinese)
*   हिन्दी (Hindi)
*   Bahasa Indonesia
*   Polski
*   ไทย (Thai)
*   Türkçe
*   Tiếng Việt

## 📄 License
This project is for educational and personal use. Please respect the terms of service of Vectorizer.ai.
