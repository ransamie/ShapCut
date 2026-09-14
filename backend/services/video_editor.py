"""
Video Editor Service — cuts and exports video segments using FFmpeg.

Features:
  - Lossless (stream-copy) cutting when possible, re-encode fallback
  - Concatenation of multiple cuts into a single short
  - Optional burned-in subtitles
  - Progress tracking via callback
  - Export multiple cuts as separate files
"""

import os
import uuid
import json
import subprocess
import logging
import tempfile
from pathlib import Path
from typing import Optional, Callable

logger = logging.getLogger("shapcut.video_editor")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

import urllib.request
import zipfile
import shutil
import sys

FFMPEG_CMD = "ffmpeg"
FFPROBE_CMD = "ffprobe"

def _check_ffmpeg() -> None:
    """Check if ffmpeg is available on PATH, otherwise download it."""
    global FFMPEG_CMD, FFPROBE_CMD
    
    # 1. Check directory of running python executable (packaged backend)
    exe_dir = Path(sys.executable).parent
    exe_ffmpeg = exe_dir / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    exe_ffprobe = exe_dir / ("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
    if exe_ffmpeg.exists():
        FFMPEG_CMD = str(exe_ffmpeg)
        if exe_ffprobe.exists():
            FFPROBE_CMD = str(exe_ffprobe)
        return

    # 2. Check SHAPCUT_FFMPEG_PATH from Electron
    env_ffmpeg = os.environ.get("SHAPCUT_FFMPEG_PATH")
    if env_ffmpeg and Path(env_ffmpeg).exists():
        FFMPEG_CMD = env_ffmpeg
        ffprobe_path = Path(env_ffmpeg).with_name("ffprobe.exe" if sys.platform == "win32" else "ffprobe")
        if ffprobe_path.exists():
            FFPROBE_CMD = str(ffprobe_path)
        else:
            parent_bin = Path(env_ffmpeg).parent
            found = list(parent_bin.glob("**/ffprobe*"))
            if found:
                FFPROBE_CMD = str(found[0])
                try:
                    shutil.copy2(found[0], ffprobe_path)
                    FFPROBE_CMD = str(ffprobe_path)
                except Exception:
                    pass
        return

    # 3. Check AppData/ShapCut/bin (Windows standard install location)
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "")
        if appdata:
            appdata_bin = Path(appdata) / "ShapCut" / "bin"
            app_ffmpeg = appdata_bin / "ffmpeg.exe"
            app_ffprobe = appdata_bin / "ffprobe.exe"
            if app_ffmpeg.exists():
                FFMPEG_CMD = str(app_ffmpeg)
                if app_ffprobe.exists():
                    FFPROBE_CMD = str(app_ffprobe)
                return

    # 4. Check system PATH
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return

    bin_dir = Path(__file__).parent.parent / "bin"
    ffmpeg_exe = bin_dir / "ffmpeg.exe"
    ffprobe_exe = bin_dir / "ffprobe.exe"

    if ffmpeg_exe.exists() and ffprobe_exe.exists():
        FFMPEG_CMD = str(ffmpeg_exe)
        FFPROBE_CMD = str(ffprobe_exe)
        return

    if sys.platform != "win32":
        raise EnvironmentError(
            "ffmpeg is not installed or not on PATH. "
            "Please install it via your package manager (e.g. apt install ffmpeg or brew install ffmpeg)"
        )

    logger.info("FFmpeg not found on PATH. Downloading commercial-safe LGPL FFmpeg...")
    bin_dir.mkdir(exist_ok=True)
    zip_path = bin_dir / "ffmpeg.zip"
    url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip"
    
    urllib.request.urlretrieve(url, zip_path)
    
    logger.info("Extracting FFmpeg...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        for file_info in zip_ref.infolist():
            if file_info.filename.endswith('ffmpeg.exe'):
                file_info.filename = "ffmpeg.exe"
                zip_ref.extract(file_info, bin_dir)
            elif file_info.filename.endswith('ffprobe.exe'):
                file_info.filename = "ffprobe.exe"
                zip_ref.extract(file_info, bin_dir)
                
    zip_path.unlink()
    
    FFMPEG_CMD = str(ffmpeg_exe)
    FFPROBE_CMD = str(ffprobe_exe)
    logger.info("LGPL FFmpeg downloaded successfully.")


def _format_ffmpeg_time(seconds: float) -> str:
    """Format seconds as HH:MM:SS.mmm for ffmpeg -ss / -to arguments."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def _get_video_info(video_path: str) -> dict:
    """Return basic video metadata dict via ffprobe with OpenCV fallback."""
    _check_ffmpeg()
    try:
        cmd = [
            FFPROBE_CMD, "-v", "quiet",
            "-print_format", "json",
            "-show_streams", "-show_format",
            video_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return json.loads(result.stdout)
    except Exception as e:
        logger.warning(f"ffprobe failed ({e}), falling back to OpenCV")

    # Fallback to OpenCV
    try:
        import cv2
        cap = cv2.VideoCapture(video_path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        duration = frame_count / fps if fps > 0 else 0.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
        return {
            "format": {"duration": str(duration)},
            "streams": [{"width": width, "height": height, "codec_type": "video"}]
        }
    except Exception as e:
        logger.warning(f"OpenCV fallback also failed ({e})")
        return {"format": {"duration": "0.0"}, "streams": []}


def _cut_segment(
    video_path: str,
    start: float,
    end: float,
    output_path: str,
    use_stream_copy: bool = False,
    crf: int = 23,
    aspect_ratio: str = "horizontal",
    subtitle_path: Optional[str] = None,
) -> None:
    """
    Extract a sub-clip using FFmpeg.
    """
    if aspect_ratio in ["vertical", "vertical-ai"] or subtitle_path:
        use_stream_copy = False

    is_ai_tracking = (aspect_ratio == "vertical-ai")
    
    # If AI tracking, we first extract the full 16:9 clip to a temporary file
    actual_output_path = output_path
    if is_ai_tracking:
        import tempfile
        import os
        tmp_fd, actual_output_path = tempfile.mkstemp(suffix=".mp4")
        os.close(tmp_fd)

    if use_stream_copy:
        cmd = [
            FFMPEG_CMD, "-y",
            "-ss", _format_ffmpeg_time(start),
            "-to", _format_ffmpeg_time(end),
            "-i", video_path,
            "-c", "copy",
            actual_output_path,
        ]
    else:
        cmd = [
            FFMPEG_CMD, "-y",
            "-ss", _format_ffmpeg_time(start),
            "-to", _format_ffmpeg_time(end),
            "-i", video_path,
        ]
        vf_filters = []
        if aspect_ratio == "vertical": # Static center crop
            vf_filters.append("crop=ih*9/16:ih")
            
        if subtitle_path and not is_ai_tracking:
            srt_escaped = subtitle_path.replace("\\", "/").replace(":", "\\:")
            vf_filters.append(f"subtitles='{srt_escaped}'")
            
        cmd_encode = [
            "-c:v", "libx264",
            "-crf", str(crf),
            "-preset", "fast",
            "-c:a", "aac",
            "-b:a", "128k"
        ]
        
        if vf_filters:
            cmd.extend(["-vf", ",".join(vf_filters)])
            
        cmd.extend(cmd_encode)
        cmd.append(actual_output_path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        if is_ai_tracking and os.path.exists(actual_output_path):
            os.remove(actual_output_path)
        raise RuntimeError(
            f"FFmpeg cut failed for [{start}-{end}]:\n{result.stderr}"
        )
        
    if is_ai_tracking:
        try:
            from services.ai_tracking import apply_ai_tracking
            apply_ai_tracking(actual_output_path, output_path, crf=crf, subtitle_path=subtitle_path)
        finally:
            if os.path.exists(actual_output_path):
                os.remove(actual_output_path)


def _burn_subtitles(
    video_path: str,
    srt_path: str,
    output_path: str,
    crf: int = 23,
    aspect_ratio: str = "horizontal",
) -> None:
    """Burn SRT subtitles into video using ffmpeg subtitle filter."""
    # Escape path for ffmpeg filter (Windows backslashes need escaping)
    srt_escaped = srt_path.replace("\\", "/").replace(":", "\\:")
    
    vf_filter = f"subtitles='{srt_escaped}'"
    if aspect_ratio == "vertical":
        vf_filter = f"crop=ih*9/16:ih,{vf_filter}"
    # If aspect_ratio == "vertical-ai", the video is ALREADY cropped to 9:16 by apply_ai_tracking
    # so we just apply subtitles directly to the 9:16 frame.
        
    cmd = [
        FFMPEG_CMD, "-y",
        "-i", video_path,
        "-vf", vf_filter,
        "-c:v", "libx264",
        "-crf", str(crf),
        "-preset", "fast",
        "-c:a", "aac",
        "-b:a", "128k",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg subtitle burn failed:\n{result.stderr}")


def _build_concat_list(segment_paths: list[str], list_path: str) -> None:
    """Write an ffmpeg concat demuxer list file."""
    with open(list_path, "w", encoding="utf-8") as f:
        for p in segment_paths:
            # ffmpeg concat list uses forward slashes
            safe_path = p.replace("\\", "/")
            f.write(f"file '{safe_path}'\n")


def _concatenate_segments(
    segment_paths: list[str],
    output_path: str,
) -> None:
    """Concatenate pre-cut segments using ffmpeg concat demuxer (lossless)."""
    list_path = output_path + ".txt"
    _build_concat_list(segment_paths, list_path)
    cmd = [
        FFMPEG_CMD, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", list_path,
        "-c", "copy",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        os.remove(list_path)
    except OSError:
        pass
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg concat failed:\n{result.stderr}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def cut_and_export(
    video_path: str,
    cuts: list[dict],
    output_dir: str,
    output_format: str = "mp4",
    burn_subtitles: bool = False,
    subtitle_path: Optional[str] = None,
    crf: int = 23,
    export_individual: bool = True,
    export_merged: bool = True,
    aspect_ratio: str = "horizontal",
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> list[str]:
    """
    Cut video based on a list of time ranges and export clips.

    Args:
        video_path: Path to input video.
        cuts: List of dicts [{start, end, title}].
        output_dir: Directory to write output files.
        output_format: Output container format (mp4/mov/webm).
        burn_subtitles: Whether to burn SRT into each clip.
        subtitle_path: Path to the SRT file (required if burn_subtitles=True).
        crf: H.264 CRF quality value.
        export_individual: If True, export each cut as a separate file.
        export_merged: If True, export all cuts merged into one file.
        aspect_ratio: "horizontal" or "vertical".
        progress_callback: Optional fn(step_name, 0-100) for progress updates.

    Returns:
        List of output file paths.
    """
    _check_ffmpeg()
    os.makedirs(output_dir, exist_ok=True)

    if not cuts:
        raise ValueError("No cuts provided for export.")

    output_files: list[str] = []
    total_cuts = len(cuts)
    tmp_segments: list[str] = []

    def _report(step: str, pct: float):
        logger.info(f"[{pct:.0f}%] {step}")
        if progress_callback:
            progress_callback(step, pct)

    with tempfile.TemporaryDirectory(prefix="shapcut_") as tmp_dir:

        for i, cut in enumerate(cuts):
            start = float(cut["start"])
            end = float(cut["end"])
            raw_title = cut.get("title", f"cut_{i+1}")
            # Sanitize title for filename
            safe_title = "".join(
                c for c in raw_title if c.isalnum() or c in " _-"
            ).strip()[:40].replace(" ", "_") or f"cut_{i+1}"

            base_pct = (i / total_cuts) * 80
            _report(f"Cutting clip {i+1}/{total_cuts}: {safe_title}", base_pct)

            tmp_path = os.path.join(tmp_dir, f"seg_{i:04d}.{output_format}")
            _cut_segment(
                video_path, start, end, tmp_path,
                use_stream_copy=not burn_subtitles and aspect_ratio == "horizontal", 
                crf=crf,
                aspect_ratio=aspect_ratio,
                subtitle_path=subtitle_path if burn_subtitles else None
            )

            tmp_segments.append(tmp_path)

            if export_individual:
                out_path = os.path.join(
                    output_dir, f"{safe_title}.{output_format}"
                )
                import shutil
                shutil.copy2(tmp_path, out_path)
                output_files.append(out_path)
                _report(f"Saved: {os.path.basename(out_path)}", base_pct + (1/total_cuts)*40)

        if export_merged and len(tmp_segments) > 1:
            _report("Merging all clips…", 85)
            merged_path = os.path.join(output_dir, f"merged_short.{output_format}")
            _concatenate_segments(tmp_segments, merged_path)
            output_files.append(merged_path)
            _report("Merge complete", 100)
        elif export_merged and len(tmp_segments) == 1:
            import shutil
            merged_path = os.path.join(output_dir, f"merged_short.{output_format}")
            shutil.copy2(tmp_segments[0], merged_path)
            output_files.append(merged_path)

    _report("Export complete", 100)
    return output_files


def export_srt_for_cuts(
    all_segments: list,
    cuts: list[dict],
    output_path: str,
) -> str:
    """
    Export a new SRT file whose timestamps are relative to the merged export.
    Handles timeline re-zeroing so that subtitles match the exported video.
    """
    from services.transcription import export_srt, _format_srt_time
    from models.schemas import TranscriptSegment

    timeline_offset = 0.0
    output_segments: list[TranscriptSegment] = []
    new_id = 0

    for cut in cuts:
        cut_start = float(cut["start"])
        cut_end = float(cut["end"])
        cut_duration = cut_end - cut_start

        # Collect segments that overlap this cut
        for seg in all_segments:
            if seg.end <= cut_start or seg.start >= cut_end:
                continue
            # Clamp to cut window
            rel_start = max(seg.start, cut_start) - cut_start + timeline_offset
            rel_end = min(seg.end, cut_end) - cut_start + timeline_offset
            text = seg.corrected_text or seg.text
            output_segments.append(
                TranscriptSegment(
                    id=new_id,
                    start=rel_start,
                    end=rel_end,
                    text=text,
                )
            )
            new_id += 1

        timeline_offset += cut_duration

    return export_srt(output_segments, output_path)
