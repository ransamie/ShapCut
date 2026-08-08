# ShapCut — AI Video Editor

> Turn long-form footage into viral shorts using AI-powered caption analysis.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green.svg)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev)
[![Electron](https://img.shields.io/badge/Electron-31-blue.svg)](https://electronjs.org)

---

## What is ShapCut?

ShapCut is a **local AI video editor** that:
1. **Extracts captions** from any video using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (OpenAI Whisper v3)
2. **Corrects errors** — removes Whisper hallucinations, fixes grammar, normalises punctuation
3. **Scores segments** for impact using a multi-factor AI model (information density, sentiment, pace, hook keywords)
4. **Marks high-impact sections** automatically and lets you curate them
5. **Cuts and exports** frame-accurate short clips using FFmpeg — individually or merged

All processing runs **100% locally**. No cloud, no API keys required.

---

## Installation

ShapCut is distributed as a single packaged executable for Windows, Mac, and Linux.

1. Navigate to the [Releases](https://github.com/ransamie/ShapCut/releases) tab.
2. Download the installer for your platform (`.exe`, `.dmg`, or `.AppImage`).
3. Run the installer.

*Note: On your very first launch, ShapCut will automatically securely download the required open-source FFmpeg binaries directly into your local AppData folder. An active internet connection is required only for this initial setup.*

---

## Development Setup

If you want to contribute to the code or run it manually:

### 1. Start the Python Backend
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
python main.py
```
*(The backend runs on `http://127.0.0.1:8000`)*

### 2. Start the Electron/React Frontend
```bash
cd frontend
npm install
npm run dev
```
*(This will launch the native Electron wrapper connected to the Vite dev server)*

---

## CI/CD and Building
This project is configured with GitHub Actions to automatically cross-compile for all operating systems. 

When code is pushed to `master`, GitHub's cloud runners will:
1. Build the Python backend into a native executable via `PyInstaller`.
2. Build the React frontend.
3. Bundle everything into an installer using `electron-builder`.

To trigger a manual build, go to the **Actions** tab on GitHub.

---

## Usage Guide

### 1. Upload Video
- Drag & drop or click to upload your video (MP4, MOV, AVI, MKV, WebM)

### 2. Transcribe
- Select Whisper model size (Base is recommended for speed/accuracy balance)
- Click **Auto-Process All** to run the full pipeline, or step through manually

### 3. Correct Captions
- Automatically removes Whisper hallucinations and fixes grammar
- Edit any segment inline by clicking the ✏️ icon in the transcript

### 4. Analyse
- AI scores each segment from 0-100 based on Information density, Sentiment, Pace, and Hook keywords.
- Segments above the threshold are auto-marked (green ✓)

### 5. Curate
- In the transcript, click the ☐ checkbox to toggle any segment's mark
- Marked segments appear as purple overlays on the timeline
- Use **Sync Marks** to rebuild the cut list from your manual selections

### 6. Export
- Configure format (MP4/MOV/WebM) and quality (CRF)
- Optionally burn subtitles into the video
- Choose individual clips, merged short, or both
- Click **Export** — files download directly from the app

---

## Architecture

```
ShapCut/
├── backend/                    # Python FastAPI service (port 8000)
│   ├── main.py                 # All API endpoints
│   ├── services/
│   │   ├── transcription.py    # faster-whisper + SRT I/O
│   │   ├── correction.py       # Error correction pipeline
│   │   ├── analysis.py         # AI impact scoring
│   │   └── video_editor.py     # FFmpeg cutting & export
│   ├── models/
│   │   └── schemas.py          # Pydantic data models
│   └── requirements.txt
│
├── frontend/                   # Electron + React + Vite SPA
│   ├── electron/               
│   │   ├── main.js             # Electron Main Process & Python spawner
│   │   └── downloader.js       # FFmpeg dynamic dependency fetcher
│   └── src/
│       ├── pages/
│       │   ├── HomePage.jsx    # Landing page
│       │   └── EditorPage.jsx  # 3-panel editor workspace
│       └── components/         # Modular React components
│
├── .github/workflows/          # Cross-platform build pipelines
└── README.md
```

---

## License

MIT © ShapCut Contributors
