# ShapCut — AI Video Editor

> Turn long-form footage into viral shorts using AI-powered caption analysis.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-green.svg)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-required-orange.svg)](https://ffmpeg.org)

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

## Prerequisites

| Requirement | Version | Download |
|-------------|---------|----------|
| Python | 3.11+ | [python.org](https://python.org) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| FFmpeg | Auto-downloads | [ffmpeg.org](https://ffmpeg.org/download.html) |

*Note: On Windows, ShapCut will automatically download FFmpeg on first run if it isn't found on your PATH.*

---

## Quick Start

### Windows (one command)
```batch
start.bat
```

This script will:
- Create a Python virtual environment
- Install all backend dependencies
- Install npm packages
- Start both services
- Open the app in your browser

### Manual Start

**Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
python main.py
# API available at http://127.0.0.1:8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# App available at http://localhost:5173
```

---

## Usage Guide

### 1. Upload Video
- Open `http://localhost:5173/editor`
- Drag & drop or click to upload your video (MP4, MOV, AVI, MKV, WebM)

### 2. Transcribe
- Select Whisper model size (Base is recommended for speed/accuracy balance)
- Click **Auto-Process All** to run the full pipeline, or step through manually

| Model | Speed | Accuracy |
|-------|-------|----------|
| tiny | ⚡⚡⚡ | ★★ |
| base | ⚡⚡ | ★★★ |
| small | ⚡ | ★★★★ |
| medium | 🐌 | ★★★★★ |
| large-v3 | 🐌🐌 | ★★★★★ |

### 3. Correct Captions
- Automatically removes Whisper hallucinations and fixes grammar
- Edit any segment inline by clicking the ✏️ icon in the transcript

### 4. Analyse
- AI scores each segment from 0-100 based on:
  - **Information density** — numbers, named entities, technical terms
  - **Sentiment intensity** — emotional peaks (positive or negative)
  - **Speech pace** — words per second (sweet spot: 2-4 wps)
  - **Hook keywords** — questions, superlatives, statistics, call-outs
  - **Lexical diversity** — vocabulary richness
- Segments above the threshold are auto-marked (green ✓)
- Adjust threshold in **Settings**

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
├── frontend/                   # React + Vite SPA (port 5173)
│   └── src/
│       ├── pages/
│       │   ├── HomePage.jsx    # Landing page
│       │   └── EditorPage.jsx  # 3-panel editor workspace
│       ├── components/
│       │   ├── VideoUploader.jsx
│       │   ├── TranscriptEditor.jsx
│       │   ├── Timeline.jsx
│       │   ├── SegmentCard.jsx
│       │   ├── ExportPanel.jsx
│       │   └── ProgressModal.jsx
│       ├── store/editorStore.js # Zustand global state
│       └── api/client.js       # REST API client
│
├── start.bat                   # Windows one-click launcher
└── README.md
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload` | Upload video file |
| `POST` | `/api/transcribe/{job_id}` | Start transcription |
| `POST` | `/api/import-subtitles/{job_id}` | Import SRT/VTT |
| `POST` | `/api/correct/{job_id}` | Correct captions |
| `POST` | `/api/analyze/{job_id}` | AI segment analysis |
| `PATCH`| `/api/segments/{job_id}/{seg_id}` | Update segment |
| `PUT`  | `/api/cuts/{job_id}` | Update cuts list |
| `POST` | `/api/export/{job_id}` | Export video |
| `GET`  | `/api/jobs/{job_id}` | Get job state |
| `GET`  | `/api/jobs/{job_id}/segments` | Get all segments |
| `GET`  | `/api/jobs/{job_id}/srt` | Download SRT |
| `GET`  | `/api/jobs/{job_id}/export/{file}` | Download export |
| `GET`  | `/api/events/{job_id}` | SSE progress stream |
| `DELETE`| `/api/jobs/{job_id}` | Delete job & files |

Interactive API docs: `http://127.0.0.1:8000/docs`

---

## GPU Acceleration

faster-whisper automatically uses CUDA if available. To enable GPU acceleration:

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

With a modern GPU (RTX 3060+), transcription of a 1-hour video takes ~2-3 minutes with `large-v3`.

---

## License

MIT © ShapCut Contributors
