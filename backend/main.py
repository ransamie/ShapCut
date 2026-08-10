"""
ShapCut Backend — FastAPI Application

Endpoints:
  POST /api/upload                     → upload video file
  POST /api/transcribe/{job_id}        → transcribe or import subtitles
  POST /api/correct/{job_id}           → correct caption errors
  POST /api/analyze/{job_id}           → AI segment analysis & marking
  PATCH /api/segments/{job_id}/{seg_id} → toggle/update a segment manually
  POST /api/export/{job_id}            → cut & export video
  GET  /api/jobs/{job_id}              → get job state
  GET  /api/jobs/{job_id}/srt          → download SRT file
  GET  /api/jobs/{job_id}/export/{filename} → download exported file
  DELETE /api/jobs/{job_id}            → clean up job files
  GET  /api/health                     → health check
  GET  /api/events/{job_id}            → SSE progress stream
"""

import os
import uuid
import asyncio
import logging
import shutil
import json
import zipfile
import urllib.parse
from pathlib import Path
from typing import Optional, AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI, UploadFile, File, HTTPException, BackgroundTasks,
    Form, Request
)
from fastapi.responses import (
    FileResponse, StreamingResponse, JSONResponse
)
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import aiofiles
from pydantic import BaseModel

from models.schemas import (
    TranscriptionRequest, TranscriptionResponse, TranscriptionStatus,
    CorrectionRequest, CorrectionResponse,
    AnalysisRequest, AnalysisResponse,
    ExportRequest, ExportResponse,
    TranscriptSegment, SegmentImpact,
)
from services.transcription import transcribe_video, load_subtitle_file, export_srt
from services.correction import correct_segments
from services.analysis import analyze_segments, toggle_segment_mark
from services.video_editor import cut_and_export, export_srt_for_cuts

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("shapcut.api")

import tempfile

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_temp_base = Path(tempfile.gettempdir()) / "ShapCutData"
UPLOAD_DIR = _temp_base / "uploads"
EXPORT_DIR = _temp_base / "exports"

# Create immediately so StaticFiles mount doesn't fail
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".flv"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024  # 10 GB

# ---------------------------------------------------------------------------
# In-memory job store (use Redis for production)
# ---------------------------------------------------------------------------
jobs: dict[str, dict] = {}

# SSE event queues per job_id
event_queues: dict[str, asyncio.Queue] = {}


main_loop = None

# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_loop
    main_loop = asyncio.get_running_loop()
    UPLOAD_DIR.mkdir(exist_ok=True)
    EXPORT_DIR.mkdir(exist_ok=True)
    logger.info("ShapCut backend started ✓")
    yield
    logger.info("ShapCut backend shutting down…")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="ShapCut API",
    description="AI-powered video editor backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static_jobs", StaticFiles(directory=UPLOAD_DIR), name="static_jobs")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_job(job_id: str) -> dict:
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return jobs[job_id]


def _job_dir(job_id: str) -> Path:
    return UPLOAD_DIR / job_id


def _export_dir(job_id: str) -> Path:
    d = EXPORT_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _push_event(job_id: str, step: str, progress: float, message: str = "", data: dict = None):
    """Push a progress event to the SSE queue for a job."""
    if job_id in event_queues:
        event = {"step": step, "progress": progress, "message": message}
        if data:
            event.update(data)
        try:
            if main_loop:
                main_loop.call_soon_threadsafe(event_queues[job_id].put_nowait, event)
        except Exception as e:
            pass


def _segments_to_dict(segments: list[TranscriptSegment]) -> list[dict]:
    return [s.model_dump() for s in segments]


def _segments_from_dict(data: list[dict]) -> list[TranscriptSegment]:
    return [TranscriptSegment(**d) for d in data]


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@app.get("/api/health", tags=["System"])
async def health():
    return {"status": "ok", "service": "ShapCut API v1.0.0"}


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@app.post("/api/upload", tags=["Jobs"])
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file and create a new job."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {ALLOWED_EXTENSIONS}",
        )

    job_id = uuid.uuid4().hex
    job_path = _job_dir(job_id)
    job_path.mkdir(parents=True, exist_ok=True)
    video_path = job_path / f"source{ext}"

    async with aiofiles.open(video_path, "wb") as f:
        total = 0
        while chunk := await file.read(8 * 1024 * 1024):  # 8 MB chunks
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(
                    status_code=413, detail="File too large (max 10 GB)"
                )
            await f.write(chunk)

    jobs[job_id] = {
        "job_id": job_id,
        "status": "uploaded",
        "video_path": str(video_path),
        "filename": file.filename,
        "segments": [],
        "cuts": [],
        "language": None,
        "duration": 0.0,
        "srt_path": None,
        "export_files": [],
    }
    event_queues[job_id] = asyncio.Queue(maxsize=100)
    logger.info(f"Uploaded: {file.filename} → job {job_id}")
    return {"job_id": job_id, "filename": file.filename, "video_url": f"/static_jobs/{job_id}/source{ext}"}


class UploadPathRequest(BaseModel):
    path: str

@app.post("/api/upload-path", tags=["Jobs"])
async def upload_video_from_path(req: UploadPathRequest):
    """Upload a video instantly by referencing a local absolute path."""
    file_path = Path(req.path).resolve()
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=400,
            detail="File does not exist at specified path."
        )

    ext = file_path.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {ALLOWED_EXTENSIONS}",
        )

    job_id = uuid.uuid4().hex
    job_path = _job_dir(job_id)
    job_path.mkdir(parents=True, exist_ok=True)
    
    # ZERO-COPY: We do not move or hardlink the file. 
    # We store the absolute native path, and stream it via a dedicated endpoint.
    video_path = str(file_path)

    jobs[job_id] = {
        "job_id": job_id,
        "status": "uploaded",
        "video_path": video_path,
        "filename": file_path.name,
        "segments": [],
        "cuts": [],
        "language": None,
        "duration": 0.0,
        "srt_path": None,
        "export_files": [],
    }
    event_queues[job_id] = asyncio.Queue(maxsize=100)
    logger.info(f"Instant load (Zero Copy): {file_path.name} → job {job_id}")
    
    # URL for frontend to stream the video directly from its original drive location
    video_url = f"/api/stream-local/{job_id}"
    return {"job_id": job_id, "filename": file_path.name, "video_url": video_url}

from fastapi import Request
from fastapi.responses import Response

@app.get("/api/stream-local/{job_id}", tags=["Jobs"])
async def stream_local(job_id: str, request: Request):
    """Stream a local file directly from its absolute path with Range support."""
    job = _get_job(job_id)
    file_path = Path(job["video_path"]).resolve()
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on system")
        
    return FileResponse(file_path, media_type="video/mp4")


# ---------------------------------------------------------------------------
# Transcribe
# ---------------------------------------------------------------------------
@app.post("/api/transcribe/{job_id}", tags=["Pipeline"])
async def transcribe(
    job_id: str,
    background_tasks: BackgroundTasks,
    model_size: str = "base",
    language: Optional[str] = None,
):
    """Start transcription of uploaded video in the background."""
    job = _get_job(job_id)
    jobs[job_id]["status"] = "transcribing"
    background_tasks.add_task(
        _run_transcription, job_id, job["video_path"], model_size, language
    )
    return {"job_id": job_id, "status": "transcribing"}


async def _run_transcription(
    job_id: str, video_path: str, model_size: str, language: Optional[str]
):
    """Background transcription task."""
    try:
        _push_event(job_id, "transcription", 5, "Starting transcription…")
        loop = asyncio.get_event_loop()
        
        def on_progress(p: float):
            pct = max(5, int(p * 100))
            _push_event(job_id, "transcription", pct, "")

        def on_status(msg: str):
            # Keep whatever % was last reported, just update the message
            _push_event(job_id, "transcription", -1, msg)

        def on_segment(seg: TranscriptSegment):
            _push_event(job_id, "transcription_segment", -1, "", data={"segment": seg.model_dump()})

        segments, lang, duration = await loop.run_in_executor(
            None,
            lambda: transcribe_video(
                video_path, 
                model_size=model_size, 
                language=language, 
                progress_callback=on_progress,
                status_callback=on_status,
                segment_callback=on_segment
            ),
        )

        _push_event(job_id, "transcription", 95, f"Saving {len(segments)} segments…")

        # Save SRT
        srt_path = str(_job_dir(job_id) / "transcript.srt")
        export_srt(segments, srt_path)

        jobs[job_id].update({
            "status": "transcribed",
            "segments": _segments_to_dict(segments),
            "language": lang,
            "duration": duration,
            "srt_path": srt_path,
        })
        _push_event(job_id, "transcription", 100, "Transcription complete")
    except Exception as e:
        logger.exception(f"Transcription failed for {job_id}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        _push_event(job_id, "transcription", -1, f"Error: {e}")


# ---------------------------------------------------------------------------
# Import existing subtitle file
# ---------------------------------------------------------------------------
@app.post("/api/import-subtitles/{job_id}", tags=["Pipeline"])
async def import_subtitles(job_id: str, file: UploadFile = File(...)):
    """Import an existing SRT or VTT file instead of running Whisper."""
    job = _get_job(job_id)
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".srt", ".vtt", ".webvtt"):
        raise HTTPException(
            status_code=400, detail="Only .srt or .vtt files are supported."
        )

    srt_path = str(_job_dir(job_id) / f"transcript{ext}")
    content = await file.read()
    with open(srt_path, "wb") as f:
        f.write(content)

    segments = load_subtitle_file(srt_path)
    jobs[job_id].update({
        "status": "transcribed",
        "segments": _segments_to_dict(segments),
        "srt_path": srt_path,
    })
    return {"job_id": job_id, "segments_count": len(segments)}


# ---------------------------------------------------------------------------
# Correct
# ---------------------------------------------------------------------------
@app.post("/api/correct/{job_id}", tags=["Pipeline"])
async def correct(job_id: str, background_tasks: BackgroundTasks):
    """Run caption error correction on the transcript."""
    job = _get_job(job_id)
    if not job.get("segments"):
        raise HTTPException(
            status_code=400, detail="No transcript found. Run transcription first."
        )
    jobs[job_id]["status"] = "correcting"
    background_tasks.add_task(_run_correction, job_id, job["segments"])
    return {"job_id": job_id, "status": "correcting"}


async def _run_correction(job_id: str, segments_data: list[dict]):
    try:
        _push_event(job_id, "correction", 10, "Starting correction…")
        segments = _segments_from_dict(segments_data)
        loop = asyncio.get_event_loop()
        corrected, n_corrections = await loop.run_in_executor(
            None, lambda: correct_segments(segments)
        )
        # Update SRT with corrected text
        srt_path = str(_job_dir(job_id) / "transcript_corrected.srt")
        export_srt(corrected, srt_path)
        jobs[job_id].update({
            "status": "corrected",
            "segments": _segments_to_dict(corrected),
            "srt_path": srt_path,
            "corrections_made": n_corrections,
        })
        _push_event(job_id, "correction", 100, f"{n_corrections} corrections made")
    except Exception as e:
        logger.exception(f"Correction failed for {job_id}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        _push_event(job_id, "correction", -1, f"Error: {e}")


# ---------------------------------------------------------------------------
# Analyze
# ---------------------------------------------------------------------------
@app.post("/api/analyze/{job_id}", tags=["Pipeline"])
async def analyze(
    job_id: str,
    background_tasks: BackgroundTasks,
    impact_threshold: float = 0.5,
    min_duration: float = 5.0,
    max_duration: float = 60.0,
    max_shorts: int = 5,
):
    """Run AI analysis to score and mark high-impact segments."""
    job = _get_job(job_id)
    if not job.get("segments"):
        raise HTTPException(
            status_code=400, detail="No transcript found. Transcribe first."
        )
    jobs[job_id]["status"] = "analyzing"
    background_tasks.add_task(
        _run_analysis, job_id, job["segments"],
        impact_threshold, min_duration, max_duration, max_shorts
    )
    return {"job_id": job_id, "status": "analyzing"}


async def _run_analysis(
    job_id: str, segments_data: list[dict],
    threshold: float, min_dur: float, max_dur: float, max_shorts: int
):
    try:
        _push_event(job_id, "analysis", 10, "Scoring segments…")
        segments = _segments_from_dict(segments_data)
        loop = asyncio.get_event_loop()
        scored, cuts = await loop.run_in_executor(
            None,
            lambda: analyze_segments(
                segments,
                impact_threshold=threshold,
                min_duration=min_dur,
                max_duration=max_dur,
                max_shorts=max_shorts,
            ),
        )
        jobs[job_id].update({
            "status": "analyzed",
            "segments": _segments_to_dict(scored),
            "cuts": cuts,
        })
        _push_event(job_id, "analysis", 100, f"Found {len(cuts)} suggested cuts")
    except Exception as e:
        logger.exception(f"Analysis failed for {job_id}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        _push_event(job_id, "analysis", -1, f"Error: {e}")


# ---------------------------------------------------------------------------
# Segment update (toggle mark, edit text)
# ---------------------------------------------------------------------------
@app.patch("/api/segments/{job_id}/{seg_id}", tags=["Editing"])
async def update_segment(job_id: str, seg_id: int, payload: dict):
    """
    Update a single segment (toggle mark, edit text, etc.).
    Payload can contain: is_marked, corrected_text
    """
    job = _get_job(job_id)
    segments = _segments_from_dict(job["segments"])
    updated = []
    found = False
    for seg in segments:
        if seg.id == seg_id:
            found = True
            update_data = {}
            if "is_marked" in payload:
                update_data["is_marked"] = bool(payload["is_marked"])
            if "corrected_text" in payload:
                update_data["corrected_text"] = str(payload["corrected_text"])
            seg = seg.model_copy(update=update_data)
        updated.append(seg)
    if not found:
        raise HTTPException(status_code=404, detail=f"Segment {seg_id} not found")
    jobs[job_id]["segments"] = _segments_to_dict(updated)
    return {"job_id": job_id, "segment_id": seg_id, "updated": True}


# ---------------------------------------------------------------------------
# Update cuts list directly
# ---------------------------------------------------------------------------
@app.put("/api/cuts/{job_id}", tags=["Editing"])
async def update_cuts(job_id: str, cuts: list[dict]):
    """Replace the cuts list for a job (manual edit from UI timeline)."""
    _get_job(job_id)
    jobs[job_id]["cuts"] = cuts
    return {"job_id": job_id, "cuts_count": len(cuts)}


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
@app.post("/api/export/{job_id}", tags=["Export"])
async def export_video(
    job_id: str,
    background_tasks: BackgroundTasks,
    output_format: str = "mp4",
    burn_subtitles: bool = False,
    crf: int = 23,
    export_individual: bool = True,
    export_merged: bool = True,
    aspect_ratio: str = "horizontal",
):
    """Start the video export process in the background."""
    job = _get_job(job_id)
    cuts = job.get("cuts", [])
    if not cuts:
        raise HTTPException(
            status_code=400,
            detail="No cuts defined. Run analysis or add cuts manually.",
        )
    jobs[job_id]["status"] = "exporting"
    background_tasks.add_task(
        _run_export, job_id, job, output_format, burn_subtitles,
        crf, export_individual, export_merged, aspect_ratio
    )
    return {"job_id": job_id, "status": "exporting"}


async def _run_export(
    job_id: str, job: dict,
    output_format: str, burn_subtitles: bool,
    crf: int, export_individual: bool, export_merged: bool,
    aspect_ratio: str,
):
    try:
        out_dir = str(_export_dir(job_id))
        subtitle_path = job.get("srt_path")
        segments = _segments_from_dict(job["segments"])

        def _progress(step: str, pct: float):
            _push_event(job_id, "export", pct, step)

        loop = asyncio.get_event_loop()
        output_files = await loop.run_in_executor(
            None,
            lambda: cut_and_export(
                video_path=job["video_path"],
                cuts=job["cuts"],
                output_dir=out_dir,
                output_format=output_format,
                burn_subtitles=burn_subtitles,
                subtitle_path=subtitle_path,
                crf=crf,
                export_individual=export_individual,
                export_merged=export_merged,
                aspect_ratio=aspect_ratio,
                progress_callback=_progress,
            ),
        )

        # Export re-zeroed SRT for the merged short
        if export_merged:
            merged_srt = os.path.join(out_dir, "merged_short.srt")
            export_srt_for_cuts(segments, job["cuts"], merged_srt)

        # Create zip file
        _progress("Packaging ZIP file…", 95)
        zip_filename = f"shapcut_export_{job_id[:8]}.zip"
        zip_path = os.path.join(out_dir, zip_filename)
        
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, _, files in os.walk(out_dir):
                for file in files:
                    if file != zip_filename:
                        file_path = os.path.join(root, file)
                        zipf.write(file_path, file)

        jobs[job_id].update({
            "status": "exported",
            "export_files": [os.path.basename(f) for f in output_files],
            "export_dir": out_dir,
            "zip_url": f"/api/jobs/{job_id}/export/{zip_filename}"
        })
        _push_event(job_id, "export", 100, f"Exported {len(output_files)} file(s) and packaged ZIP")
    except Exception as e:
        logger.exception(f"Export failed for {job_id}")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)
        _push_event(job_id, "export", -1, f"Error: {e}")


# ---------------------------------------------------------------------------
# Job state
# ---------------------------------------------------------------------------
@app.get("/api/jobs/{job_id}", tags=["Jobs"])
async def get_job(job_id: str):
    """Return the current state of a job."""
    job = _get_job(job_id)
    # Return without the full segment list for lighter response
    return {k: v for k, v in job.items() if k != "segments"}


@app.get("/api/jobs/{job_id}/segments", tags=["Jobs"])
async def get_segments(job_id: str):
    """Return all transcript segments for a job."""
    job = _get_job(job_id)
    return {"job_id": job_id, "segments": job.get("segments", [])}


# ---------------------------------------------------------------------------
# File downloads
# ---------------------------------------------------------------------------
@app.get("/api/jobs/{job_id}/srt", tags=["Downloads"])
async def download_srt(job_id: str):
    """Download the SRT subtitle file for this job."""
    job = _get_job(job_id)
    srt_path = job.get("srt_path")
    if not srt_path or not os.path.exists(srt_path):
        raise HTTPException(status_code=404, detail="SRT file not found")
    return FileResponse(
        srt_path,
        media_type="text/plain",
        filename=f"{job_id}_transcript.srt",
    )


@app.get("/api/jobs/{job_id}/export/{filename}", tags=["Downloads"])
async def download_export(job_id: str, filename: str):
    """Download an exported video clip."""
    job = _get_job(job_id)
    export_dir = job.get("export_dir")
    if not export_dir:
        raise HTTPException(status_code=404, detail="No exports found")
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(export_dir, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {safe_filename}")
    return FileResponse(file_path, media_type="video/mp4", filename=safe_filename)


# ---------------------------------------------------------------------------
# SSE progress stream
# ---------------------------------------------------------------------------
@app.get("/api/events/{job_id}", tags=["Events"])
async def sse_events(job_id: str):
    """Server-Sent Events stream for real-time job progress."""
    _get_job(job_id)  # validate job exists
    queue = event_queues.get(job_id, asyncio.Queue())

    async def generator() -> AsyncGenerator[str, None]:
        yield "data: {\"step\": \"connected\", \"progress\": 0}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("progress", 0) >= 100 or event.get("progress", 0) < 0:
                    break
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"  # SSE keep-alive comment

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
@app.delete("/api/jobs/{job_id}", tags=["Jobs"])
async def delete_job(job_id: str):
    """Delete all files and state for a job."""
    _get_job(job_id)
    job_path = _job_dir(job_id)
    export_path = _export_dir(job_id)
    try:
        shutil.rmtree(job_path, ignore_errors=True)
        shutil.rmtree(export_path, ignore_errors=True)
    except Exception as e:
        logger.warning(f"Could not remove files for {job_id}: {e}")
    del jobs[job_id]
    event_queues.pop(job_id, None)
    return {"job_id": job_id, "deleted": True}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import sys
    import multiprocessing
    
    # Required for PyInstaller multi-processing support
    multiprocessing.freeze_support()

    # PyInstaller `--windowed` sets stdout/stderr to None.
    # Uvicorn tries to call `.isatty()` on them for colored logging and crashes.
    class DummyStream:
        def write(self, *args, **kwargs): pass
        def flush(self, *args, **kwargs): pass
        def isatty(self): return False

    if sys.stdout is None:
        sys.stdout = DummyStream()
    if sys.stderr is None:
        sys.stderr = DummyStream()

    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
