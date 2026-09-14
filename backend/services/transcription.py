"""
Transcription Service — extracts captions from video using faster-whisper.

Features:
  - Auto audio extraction via ffmpeg
  - Word-level timestamps
  - SRT file generation
  - Import existing SRT/VTT files
"""

import os
import re
import uuid
import subprocess
import logging
from pathlib import Path
from typing import Optional

from models.schemas import WordTimestamp, TranscriptSegment, SegmentImpact
import services.video_editor as ve

logger = logging.getLogger("shapcut.transcription")

_MODEL_CACHE = {}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_audio_with_progress(
    video_path: str,
    audio_path: str,
    duration_s: float,
    progress_callback=None,
    status_callback=None,
) -> None:
    """
    Extract 16 kHz mono WAV from video via ffmpeg.
    Uses -progress pipe:1 to stream real-time progress back.
    Maps 0.0–1.0 via progress_callback while running.
    """
    ve._check_ffmpeg()
    if status_callback:
        status_callback("Extracting audio track…")

    cmd = [
        ve.FFMPEG_CMD, "-y",
        "-v", "error",           # prevent stderr from filling up with banner/info
        "-i", video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-progress", "pipe:1",   # write progress key=value to stdout
        "-nostats",
        audio_path,
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,  # merge stderr into stdout to prevent pipe deadlock
        text=True,
        bufsize=1,
    )

    error_log = []
    try:
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            # ffmpeg -progress emits "out_time_ms=<microseconds>"
            if line.startswith("out_time_ms="):
                try:
                    us = int(line.split("=", 1)[1])
                    if us > 0 and duration_s > 0 and progress_callback:
                        frac = min(us / (duration_s * 1_000_000), 1.0)
                        progress_callback(frac)
                except ValueError:
                    pass
            else:
                # Keep last few lines of output in case of error
                error_log.append(line)
                if len(error_log) > 20:
                    error_log.pop(0)
    finally:
        proc.wait()

    if proc.returncode != 0:
        err_msg = "\n".join(error_log)
        raise RuntimeError(f"FFmpeg audio extraction failed:\n{err_msg}")


def _format_srt_time(seconds: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _segments_to_srt(segments: list[TranscriptSegment]) -> str:
    """Convert segment list to SRT subtitle format string."""
    lines = []
    for idx, seg in enumerate(segments, start=1):
        text = seg.corrected_text or seg.text
        start = _format_srt_time(seg.start)
        end = _format_srt_time(seg.end)
        lines.append(f"{idx}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def _parse_srt(srt_content: str) -> list[TranscriptSegment]:
    """Parse an SRT file into TranscriptSegment list."""
    segments = []
    blocks = re.split(r"\n\s*\n", srt_content.strip())
    for idx, block in enumerate(blocks):
        block = block.strip()
        if not block:
            continue
        lines = block.split("\n")
        if len(lines) < 3:
            continue
        try:
            _seq = int(lines[0])  # sequence number (ignored, re-indexed)
            time_line = lines[1]
            text = " ".join(lines[2:])
            # Parse timecodes: HH:MM:SS,mmm --> HH:MM:SS,mmm
            pattern = r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)"
            m = re.match(pattern, time_line)
            if not m:
                continue
            sh, sm, ss, sms, eh, em, es, ems = [int(x) for x in m.groups()]
            start = sh * 3600 + sm * 60 + ss + sms / 1000
            end = eh * 3600 + em * 60 + es + ems / 1000
            segments.append(
                TranscriptSegment(id=idx, start=start, end=end, text=text)
            )
        except (ValueError, IndexError):
            continue
    return segments


def _parse_vtt(vtt_content: str) -> list[TranscriptSegment]:
    """Parse a WebVTT file into TranscriptSegment list."""
    # Strip WEBVTT header and notes
    content = re.sub(r"WEBVTT.*?\n\n", "", vtt_content, count=1)
    # VTT uses --> with HH:MM:SS.mmm format — reuse SRT parser after normalising
    content = content.replace(".", ",")
    return _parse_srt(content)


# ---------------------------------------------------------------------------
# Main transcription function
# ---------------------------------------------------------------------------

def transcribe_video(
    video_path: str,
    model_size: str = "base",
    language: Optional[str] = None,
    word_timestamps: bool = True,
    temp_dir: Optional[str] = None,
    progress_callback = None,
    status_callback = None,
    segment_callback = None,
) -> tuple[list[TranscriptSegment], str, float]:
    """
    Transcribes video and returns structured segments.
    
    Args:
        video_path: Path to the video file.
        model_size: faster-whisper model size (tiny/base/small/medium/large-v3).
        language: ISO language code or None for auto-detect.
        word_timestamps: If True, include word-level timestamps.
        temp_dir: Directory for temporary audio files.
        progress_callback: Optional callable that receives progress fraction (0.0 to 1.0).

    Returns:
        Tuple of (segments, language, duration_seconds).
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise RuntimeError(
            "faster-whisper is not installed. Run: pip install faster-whisper"
        )

    video_path = str(Path(video_path).resolve())
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video not found: {video_path}")

    import tempfile
    tmp = temp_dir or os.path.join(tempfile.gettempdir(), "ShapCutData", "tmp")
    os.makedirs(tmp, exist_ok=True)
    audio_path = os.path.join(tmp, f"{uuid.uuid4().hex}.wav")

    # ── Phase boundaries (overall 0–1 scale sent to caller) ──────────────
    EXTRACT_START = 0.05   # 5 %
    EXTRACT_END   = 0.45   # 45%
    MODEL_END     = 0.50   # 50%
    TRANSCRIBE_END = 0.95  # 95%

    def _emit(frac: float, msg: str = ""):
        if progress_callback:
            progress_callback(frac)
        if msg and status_callback:
            status_callback(msg)

    def _get_video_duration(path: str) -> float:
        info = ve._get_video_info(path)
        return float(info.get("format", {}).get("duration", 0.0))

    try:
        # ── Phase 0: get duration ─────────────────────────────────────────
        duration = _get_video_duration(video_path)

        # ── Phase 1: extract audio with live ffmpeg progress ──────────────
        def on_extract(frac: float):
            # map 0-1 extraction progress → EXTRACT_START to EXTRACT_END
            overall = EXTRACT_START + frac * (EXTRACT_END - EXTRACT_START)
            pct = int(overall * 100)
            if progress_callback:
                progress_callback(overall)
            if status_callback:
                status_callback(f"Extracting audio… {pct}%")

        _extract_audio_with_progress(
            video_path, audio_path, duration,
            progress_callback=on_extract,
            status_callback=None,
        )
        _emit(EXTRACT_END, "Loading AI model…")

        # ── Phase 2: load Whisper model ───────────────────────────────────
        if model_size in _MODEL_CACHE:
            model = _MODEL_CACHE[model_size]
        else:
            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
                compute_type = "float16" if device == "cuda" else "int8"
            except ImportError:
                device = "cpu"
                compute_type = "int8"
                
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
            _MODEL_CACHE[model_size] = model
        _emit(MODEL_END, "Transcribing…")

        # ── Phase 3: transcribe with VAD fallback & per-segment progress ──
        def _transcribe_stream(use_vad: bool):
            return model.transcribe(
                audio_path,
                language=language,
                word_timestamps=word_timestamps,
                vad_filter=use_vad,
                vad_parameters={"min_silence_duration_ms": 500} if use_vad else None,
            )

        try:
            whisper_segments, info = _transcribe_stream(use_vad=True)
            # Evaluate the first segment to verify VAD ONNX model initializes correctly
            seg_iter = iter(whisper_segments)
            first_item = next(seg_iter, None)
            # Reconstruct generator stream
            def _chained_stream():
                if first_item is not None:
                    yield first_item
                for item in seg_iter:
                    yield item
            active_stream = _chained_stream()
        except Exception as vad_err:
            logger.warning(f"VAD model failed ({vad_err}); falling back to standard transcription without VAD.")
            whisper_segments, info = _transcribe_stream(use_vad=False)
            active_stream = whisper_segments

        segments: list[TranscriptSegment] = []
        for idx, seg in enumerate(active_stream):
            if duration > 0:
                seg_frac = min(seg.end / duration, 1.0)
                overall = MODEL_END + seg_frac * (TRANSCRIBE_END - MODEL_END)
                pct = int(overall * 100)
                if progress_callback:
                    progress_callback(overall)
                if status_callback:
                    status_callback(f"Transcribing… {pct}%")

            words = []
            if word_timestamps and seg.words:
                words = [
                    WordTimestamp(
                        word=w.word,
                        start=w.start,
                        end=w.end,
                        probability=w.probability,
                    )
                    for w in seg.words
                ]
            transcript_seg = TranscriptSegment(
                id=idx,
                start=seg.start,
                end=seg.end,
                text=seg.text.strip(),
                words=words,
            )
            segments.append(transcript_seg)
            if segment_callback:
                segment_callback(transcript_seg)

        detected_lang = info.language or (language or "unknown")
        logger.info(f"Transcription done: {len(segments)} segments, lang={detected_lang}")
        return segments, detected_lang, duration

    finally:
        try:
            if os.path.exists(audio_path):
                os.remove(audio_path)
        except OSError:
            pass
        pass


def _get_video_duration(video_path: str) -> float:
    """Return video duration in seconds using ffprobe."""
    ve._check_ffmpeg()
    cmd = [
        ve.FFPROBE_CMD, "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


# ---------------------------------------------------------------------------
# Import existing subtitle file
# ---------------------------------------------------------------------------

def load_subtitle_file(file_path: str) -> list[TranscriptSegment]:
    """
    Load an existing SRT or VTT subtitle file and convert to segments.
    """
    file_path = Path(file_path)
    if not file_path.exists():
        raise FileNotFoundError(f"Subtitle file not found: {file_path}")

    content = file_path.read_text(encoding="utf-8", errors="replace")
    ext = file_path.suffix.lower()

    if ext == ".srt":
        return _parse_srt(content)
    elif ext in (".vtt", ".webvtt"):
        return _parse_vtt(content)
    else:
        raise ValueError(f"Unsupported subtitle format: {ext}")


# ---------------------------------------------------------------------------
# Export subtitles
# ---------------------------------------------------------------------------

def export_srt(segments: list[TranscriptSegment], output_path: str) -> str:
    """Write segments as an SRT file. Returns the output path."""
    srt_content = _segments_to_srt(segments)
    output_path = str(output_path)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(srt_content)
    return output_path
