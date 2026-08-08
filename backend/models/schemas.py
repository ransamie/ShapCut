"""
ShapCut Backend — Pydantic data models
"""
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class TranscriptionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    ERROR = "error"


class SegmentImpact(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ExportFormat(str, Enum):
    MP4 = "mp4"
    MOV = "mov"
    WEBM = "webm"


# ---------------------------------------------------------------------------
# Word / Segment models
# ---------------------------------------------------------------------------

class WordTimestamp(BaseModel):
    word: str
    start: float
    end: float
    probability: float = 1.0


class TranscriptSegment(BaseModel):
    id: int
    start: float                        # seconds
    end: float                          # seconds
    text: str
    words: list[WordTimestamp] = []
    corrected_text: Optional[str] = None
    impact_score: float = 0.0           # 0-1
    impact_level: SegmentImpact = SegmentImpact.LOW
    is_marked: bool = False             # user / AI has marked for inclusion
    speaker: Optional[str] = None


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class TranscriptionRequest(BaseModel):
    model_size: str = "base"            # tiny | base | small | medium | large-v3
    language: Optional[str] = None      # None = auto-detect
    word_timestamps: bool = True


class TranscriptionResponse(BaseModel):
    job_id: str
    status: TranscriptionStatus
    segments: list[TranscriptSegment] = []
    language: Optional[str] = None
    duration: float = 0.0
    message: str = ""


class CorrectionRequest(BaseModel):
    segments: list[TranscriptSegment]


class CorrectionResponse(BaseModel):
    segments: list[TranscriptSegment]
    corrections_made: int


class AnalysisRequest(BaseModel):
    segments: list[TranscriptSegment]
    impact_threshold: float = Field(default=0.5, ge=0.0, le=1.0)
    min_duration: float = Field(default=5.0, ge=1.0)   # seconds
    max_duration: float = Field(default=60.0, ge=5.0)  # seconds
    max_shorts: int = Field(default=5, ge=1, le=20)


class AnalysisResponse(BaseModel):
    segments: list[TranscriptSegment]
    marked_count: int
    suggested_cuts: list[dict]  # [{start, end, title, score}]


class ExportRequest(BaseModel):
    video_path: str
    cuts: list[dict]            # [{start, end, title}]
    output_format: ExportFormat = ExportFormat.MP4
    burn_subtitles: bool = False
    subtitle_path: Optional[str] = None
    crf: int = Field(default=23, ge=0, le=51)
    output_dir: Optional[str] = None
    aspect_ratio: str = "horizontal"


class ExportResponse(BaseModel):
    job_id: str
    status: TranscriptionStatus
    output_files: list[str] = []
    message: str = ""


class ProgressEvent(BaseModel):
    job_id: str
    step: str
    progress: float             # 0-100
    message: str = ""
