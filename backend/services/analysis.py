"""
AI Analysis Service — scores transcript segments for impact/informativeness.

Scoring factors (each 0-1):
  1. Information density  — keyword richness, named entities, numbers/stats
  2. Sentiment intensity  — emotional peaks (positive or negative extremes)
  3. Speech pace          — words per second (too slow = dull, too fast = hard to follow)
  4. Structural hooks     — opening questions, superlatives, calls to action
  5. Lexical diversity    — type-token ratio (richer vocabulary = more informative)

Final score = weighted average. Segments above threshold get auto-marked.
"""

import re
import math
import logging
from typing import Optional

from models.schemas import TranscriptSegment, SegmentImpact

logger = logging.getLogger("shapcut.analysis")

# ---------------------------------------------------------------------------
# Weights for each scoring factor
# ---------------------------------------------------------------------------
WEIGHTS = {
    "info_density":   0.30,
    "sentiment":      0.20,
    "pace":           0.20,
    "hooks":          0.20,
    "lexical_div":    0.10,
}

# Pace sweet spot: 2.0–4.0 words/second (broadcast speech)
PACE_IDEAL_MIN = 2.0
PACE_IDEAL_MAX = 4.0

# Hook keywords / phrases
HOOK_PATTERNS = [
    r"\bwhy\b", r"\bhow\b", r"\bsecret\b", r"\bnever\b", r"\balways\b",
    r"\bmost important\b", r"\bkey\b", r"\btip\b", r"\btrick\b",
    r"\bwarning\b", r"\bbreaking\b", r"\bwatch out\b", r"\bstep \d+\b",
    r"\b\d+%\b", r"\b\d+x\b", r"\bmillion\b", r"\bbillion\b",
    r"\bincredible\b", r"\bamazing\b", r"\bshocking\b", r"\bproof\b",
    r"\bstudy\b", r"\bresearch\b", r"\bscience\b", r"\bdata\b",
    r"\bfact\b", r"\btruth\b", r"\bmyth\b", r"\bexpert\b",
    r"\bfirst time\b", r"\bnew\b", r"\bbreakthrough\b",
]

_HOOK_RE = [re.compile(p, re.IGNORECASE) for p in HOOK_PATTERNS]

# Named entity triggers (simple heuristic without spaCy for portability)
_NUMBER_RE = re.compile(r"\b\d[\d,]*(?:\.\d+)?\b")
_PROPER_NOUN_RE = re.compile(r"\b[A-Z][a-z]{2,}\b")


# ---------------------------------------------------------------------------
# Individual scoring functions
# ---------------------------------------------------------------------------

def _score_info_density(text: str) -> float:
    """Score based on presence of numbers, named entities, and keyword richness."""
    words = text.split()
    if not words:
        return 0.0
    numbers = len(_NUMBER_RE.findall(text))
    proper_nouns = len(_PROPER_NOUN_RE.findall(text))
    long_words = sum(1 for w in words if len(w) > 7)  # technical terms tend to be long
    raw = (numbers * 2 + proper_nouns * 1.5 + long_words * 0.5) / len(words)
    return min(raw * 3, 1.0)  # normalize to 0-1


def _score_sentiment(text: str) -> float:
    """Score based on emotional intensity (extreme = high impact)."""
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        sia = SentimentIntensityAnalyzer()
        scores = sia.polarity_scores(text)
        compound = abs(scores["compound"])  # 0-1, absolute = intensity
        return compound
    except ImportError:
        # Fallback: count exclamation marks and superlatives
        intensity = text.count("!") * 0.2 + text.count("?") * 0.1
        return min(intensity, 1.0)


def _score_pace(start: float, end: float, text: str) -> float:
    """Score based on speech rate (words per second)."""
    duration = max(end - start, 0.5)
    wps = len(text.split()) / duration
    if PACE_IDEAL_MIN <= wps <= PACE_IDEAL_MAX:
        return 1.0
    elif wps < PACE_IDEAL_MIN:
        return max(wps / PACE_IDEAL_MIN, 0.1)
    else:
        # Penalise for being too fast
        return max(1.0 - (wps - PACE_IDEAL_MAX) / PACE_IDEAL_MAX, 0.1)


def _score_hooks(text: str) -> float:
    """Score based on presence of hook keywords."""
    matches = sum(1 for p in _HOOK_RE if p.search(text))
    return min(matches / 3, 1.0)   # 3+ hooks = max score


def _score_lexical_diversity(text: str) -> float:
    """Type-token ratio: unique_words / total_words."""
    words = [w.lower().strip(".,!?\"'") for w in text.split() if len(w) > 2]
    if not words:
        return 0.0
    return min(len(set(words)) / len(words), 1.0)


# ---------------------------------------------------------------------------
# Composite scorer
# ---------------------------------------------------------------------------

def _compute_impact_score(seg: TranscriptSegment) -> float:
    """Compute weighted composite impact score for a segment."""
    text = seg.corrected_text or seg.text
    if not text.strip():
        return 0.0

    scores = {
        "info_density": _score_info_density(text),
        "sentiment":    _score_sentiment(text),
        "pace":         _score_pace(seg.start, seg.end, text),
        "hooks":        _score_hooks(text),
        "lexical_div":  _score_lexical_diversity(text),
    }
    composite = sum(scores[k] * WEIGHTS[k] for k in WEIGHTS)
    return round(composite, 4)


def _impact_level(score: float) -> SegmentImpact:
    if score >= 0.6:
        return SegmentImpact.HIGH
    elif score >= 0.35:
        return SegmentImpact.MEDIUM
    return SegmentImpact.LOW


# ---------------------------------------------------------------------------
# Cut suggestion builder
# ---------------------------------------------------------------------------

def _build_cuts(
    segments: list[TranscriptSegment],
    impact_threshold: float,
    min_duration: float,
    max_duration: float,
    max_shorts: int,
) -> list[dict]:
    """
    Group consecutive marked segments into suggested cut windows.
    Merges adjacent high-impact segments, respects min/max duration
    by semantically expanding/shrinking whole segments.
    """
    marked = [s for s in segments if s.is_marked]
    if not marked:
        return []

    # Merge marked segments that are within 2 seconds of each other
    groups: list[list[TranscriptSegment]] = []
    current_group: list[TranscriptSegment] = [marked[0]]

    for seg in marked[1:]:
        prev = current_group[-1]
        if seg.start - prev.end <= 2.0:
            current_group.append(seg)
        else:
            groups.append(current_group)
            current_group = [seg]
    groups.append(current_group)

    cuts = []
    for group in groups:
        # Find indices of this group within the full segment array
        first_idx = next(i for i, s in enumerate(segments) if s.id == group[0].id)
        last_idx = next(i for i, s in enumerate(segments) if s.id == group[-1].id)

        # Expand outwards until min_duration is reached
        while segments[last_idx].end - segments[first_idx].start < min_duration:
            can_left = first_idx > 0
            can_right = last_idx < len(segments) - 1
            
            if not can_left and not can_right:
                break
                
            if can_left and can_right:
                left_score = segments[first_idx - 1].impact_score
                right_score = segments[last_idx + 1].impact_score
                if right_score >= left_score:
                    last_idx += 1
                else:
                    first_idx -= 1
            elif can_right:
                last_idx += 1
            else:
                first_idx -= 1

        # Shrink if it exceeds max_duration (with a leeway to avoid abrupt cuts)
        # We allow it to exceed the max_duration by up to 15 seconds if it means keeping a coherent thought.
        leeway = 15.0
        while segments[last_idx].end - segments[first_idx].start > max_duration + leeway and first_idx < last_idx:
            # Remove the lowest-scoring end
            left_score = segments[first_idx].impact_score
            right_score = segments[last_idx].impact_score
            if left_score <= right_score:
                first_idx += 1
            else:
                last_idx -= 1

        final_group = segments[first_idx:last_idx+1]
        start = final_group[0].start
        end = final_group[-1].end
        avg_score = sum(s.impact_score for s in final_group) / len(final_group)
        text_preview = " ".join((s.corrected_text or s.text)[:50] for s in final_group[:2])
        
        cuts.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(end - start, 3),
            "score": round(avg_score, 4),
            "title": text_preview[:60] + "…" if len(text_preview) > 60 else text_preview,
            "segment_ids": [s.id for s in final_group],
        })

    # Sort by score descending, limit to max_shorts
    cuts.sort(key=lambda c: c["score"], reverse=True)
    return cuts[:max_shorts]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def analyze_segments(
    segments: list[TranscriptSegment],
    impact_threshold: float = 0.5,
    min_duration: float = 5.0,
    max_duration: float = 60.0,
    max_shorts: int = 5,
) -> tuple[list[TranscriptSegment], list[dict]]:
    """
    Score all segments and auto-mark high-impact ones.

    Args:
        segments: Corrected transcript segments.
        impact_threshold: Minimum composite score (0-1) to auto-mark.
        min_duration: Minimum cut duration in seconds.
        max_duration: Maximum cut duration in seconds.
        max_shorts: Maximum number of suggested short clips.

    Returns:
        (scored_segments, suggested_cuts)
    """
    scored: list[TranscriptSegment] = []

    for seg in segments:
        score = _compute_impact_score(seg)
        level = _impact_level(score)
        is_marked = score >= impact_threshold

        scored.append(
            seg.model_copy(update={
                "impact_score": score,
                "impact_level": level,
                "is_marked": is_marked,
            })
        )

    marked_count = sum(1 for s in scored if s.is_marked)
    logger.info(
        f"Analysis complete: {marked_count}/{len(scored)} segments marked "
        f"(threshold={impact_threshold})"
    )

    cuts = _build_cuts(
        scored, impact_threshold, min_duration, max_duration, max_shorts
    )
    return scored, cuts


def toggle_segment_mark(
    segments: list[TranscriptSegment],
    segment_id: int,
    marked: bool,
) -> list[TranscriptSegment]:
    """Toggle the is_marked flag for a single segment by ID."""
    return [
        seg.model_copy(update={"is_marked": marked})
        if seg.id == segment_id else seg
        for seg in segments
    ]
