"""
Caption Correction Service

Applies multiple layers of caption cleaning:
  1. Whisper hallucination / artifact removal
  2. Grammar and punctuation correction (LanguageTool)
  3. Repeated-word deduplication
  4. Basic filler word normalization
"""

import re
import logging
from typing import Optional

from models.schemas import TranscriptSegment

logger = logging.getLogger("shapcut.correction")

# ---------------------------------------------------------------------------
# Patterns for known Whisper artefacts / hallucinations
# ---------------------------------------------------------------------------

_HALLUCINATION_PATTERNS = [
    re.compile(r"\[.*?\]"),                          # [Music], [Applause], etc.
    re.compile(r"\(.*?\)"),                          # (inaudible), (crosstalk)
    re.compile(r"(?i)\b(um+|uh+|ah+|er+|hmm+)\b"), # filler sounds
    re.compile(r"(?i)subtitles? by\s+\w+"),          # subtitle credits
    re.compile(r"(?i)transcript(ion)? by\s+\w+"),    # transcript credits
    re.compile(r"(?i)www\.\S+"),                     # spurious URLs
]

_REPEATED_WORD_PATTERN = re.compile(r"\b(\w+)(\s+\1){2,}\b", re.IGNORECASE)


def _remove_hallucinations(text: str) -> str:
    """Strip known Whisper hallucination patterns from text."""
    for pattern in _HALLUCINATION_PATTERNS:
        text = pattern.sub("", text)
    return text.strip()


def _deduplicate_words(text: str) -> str:
    """Remove excessively repeated words (Whisper loop artefact)."""
    return _REPEATED_WORD_PATTERN.sub(r"\1", text)


def _normalize_punctuation(text: str) -> str:
    """Fix common punctuation issues."""
    # Remove multiple spaces
    text = re.sub(r" {2,}", " ", text)
    # Remove space before punctuation
    text = re.sub(r" ([,;:.!?])", r"\1", text)
    # Capitalize first letter
    if text:
        text = text[0].upper() + text[1:]
    # Add period if no ending punctuation
    if text and text[-1] not in ".!?":
        text = text + "."
    return text.strip()


def _apply_language_tool(text: str, lang: str = "en-US") -> str:
    """
    Apply LanguageTool grammar/spelling corrections.
    Falls back gracefully if LanguageTool is unavailable.
    """
    try:
        import language_tool_python
        tool = language_tool_python.LanguageTool(lang, remote_server=None)
        corrected = tool.correct(text)
        tool.close()
        return corrected
    except Exception as e:
        logger.debug(f"LanguageTool unavailable, skipping: {e}")
        return text


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def correct_segments(
    segments: list[TranscriptSegment],
    language: str = "en-US",
    use_language_tool: bool = True,
) -> tuple[list[TranscriptSegment], int]:
    """
    Correct errors in a list of transcript segments.

    Args:
        segments: List of raw TranscriptSegment objects from transcription.
        language: BCP-47 language code for grammar correction.
        use_language_tool: If True, apply LanguageTool grammar check.

    Returns:
        (corrected_segments, number_of_corrections_made)
    """
    corrections = 0

    # Instantiate LanguageTool once for all segments (expensive to init)
    lt_tool = None
    if use_language_tool:
        try:
            import language_tool_python
            lt_tool = language_tool_python.LanguageTool(language)
            logger.info(f"LanguageTool initialized for lang={language}")
        except Exception as e:
            logger.warning(f"LanguageTool not available: {e}")

    corrected: list[TranscriptSegment] = []

    for seg in segments:
        original = seg.text
        text = original

        # Step 1: Remove hallucinations
        text = _remove_hallucinations(text)

        # Step 2: Deduplicate repeated words
        text = _deduplicate_words(text)

        # Step 3: Grammar correction via LanguageTool
        if lt_tool and text.strip():
            try:
                text = lt_tool.correct(text)
            except Exception as e:
                logger.debug(f"LanguageTool correction failed for segment {seg.id}: {e}")

        # Step 4: Normalize punctuation
        text = _normalize_punctuation(text)

        if text != original:
            corrections += 1

        corrected.append(
            seg.model_copy(update={"corrected_text": text})
        )

    # Close LanguageTool JVM process
    if lt_tool:
        try:
            lt_tool.close()
        except Exception:
            pass

    logger.info(
        f"Correction complete: {corrections}/{len(segments)} segments changed."
    )
    return corrected, corrections


def correct_single(text: str, language: str = "en-US") -> str:
    """
    Correct a single text string. Useful for inline user edits.
    """
    text = _remove_hallucinations(text)
    text = _deduplicate_words(text)
    text = _apply_language_tool(text, language)
    text = _normalize_punctuation(text)
    return text
