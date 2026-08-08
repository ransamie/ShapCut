/**
 * TranscriptEditor — Scrollable, editable transcript with:
 *  - Color-coded impact highlights (green/yellow/dim)
 *  - Click to seek video
 *  - Inline text editing
 *  - Toggle marks
 *  - Auto-scroll to active segment during playback
 */
import { useEffect, useRef, useCallback } from 'react'
import { CheckSquare, Square, Edit3, Check, X } from 'lucide-react'
import { useState } from 'react'
import useEditorStore from '../store/editorStore'
import { updateSegment } from '../api/client'
import './TranscriptEditor.css'

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}

function SegmentRow({ seg, isActive, videoRef }) {
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const { jobId, toggleSegmentMark, updateSegmentText, setCurrentTime, selectSegment, selectedSegmentId } = useEditorStore()
  const rowRef = useRef(null)
  const isSelected = selectedSegmentId === seg.id

  // Auto scroll to active segment
  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [isActive])

  const handleClick = useCallback(() => {
    if (videoRef?.current) {
      videoRef.current.currentTime = seg.start
    }
    setCurrentTime(seg.start)
    selectSegment(seg.id)
  }, [seg.start, seg.id, videoRef, setCurrentTime, selectSegment])

  const handleToggleMark = useCallback(async (e) => {
    e.stopPropagation()
    toggleSegmentMark(seg.id)
    try {
      if (jobId) {
        await updateSegment(jobId, seg.id, { is_marked: !seg.is_marked })
      }
    } catch (_) {}
  }, [seg.id, seg.is_marked, jobId, toggleSegmentMark])

  const startEdit = useCallback((e) => {
    e.stopPropagation()
    setEditText(seg.corrected_text || seg.text)
    setEditing(true)
  }, [seg.corrected_text, seg.text])

  const saveEdit = useCallback(async (e) => {
    e?.stopPropagation()
    updateSegmentText(seg.id, editText)
    setEditing(false)
    try {
      if (jobId) {
        await updateSegment(jobId, seg.id, { corrected_text: editText })
      }
    } catch (_) {}
  }, [editText, seg.id, jobId, updateSegmentText])

  const cancelEdit = useCallback((e) => {
    e?.stopPropagation()
    setEditing(false)
  }, [])

  const impactClass = seg.impact_level || 'low'
  const displayText = seg.corrected_text || seg.text

  return (
    <div
      ref={rowRef}
      className={`segment-row ${impactClass} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${seg.is_marked ? 'marked' : ''}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      {/* Mark toggle */}
      <button
        className="seg-mark-btn"
        onClick={handleToggleMark}
        title={seg.is_marked ? 'Remove mark' : 'Mark for short'}
      >
        {seg.is_marked
          ? <CheckSquare size={16} className="mark-icon marked" />
          : <Square size={16} className="mark-icon" />
        }
      </button>

      {/* Timecode */}
      <span className="seg-time">{formatTime(seg.start)}</span>

      {/* Text / editor */}
      <div className="seg-text-wrap">
        {editing ? (
          <div className="seg-editor" onClick={e => e.stopPropagation()}>
            <textarea
              className="seg-textarea"
              value={editText}
              onChange={e => setEditText(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                if (e.key === 'Escape') cancelEdit()
              }}
            />
            <div className="seg-editor-actions">
              <button className="btn btn-sm btn-success" onClick={saveEdit}><Check size={12}/> Save</button>
              <button className="btn btn-sm btn-ghost" onClick={cancelEdit}><X size={12}/> Cancel</button>
            </div>
          </div>
        ) : (
          <span className="seg-text">{displayText}</span>
        )}
      </div>

      {/* Score pill */}
      {seg.impact_score > 0 && (
        <span className={`impact-pill ${impactClass}`}>
          {(seg.impact_score * 100).toFixed(0)}
        </span>
      )}

      {/* Edit button */}
      {!editing && (
        <button className="seg-edit-btn" onClick={startEdit} title="Edit text">
          <Edit3 size={13} />
        </button>
      )}
    </div>
  )
}

export default function TranscriptEditor({ videoRef }) {
  const { segments, currentTime } = useEditorStore()

  const activeId = segments.reduce((closest, seg) => {
    if (seg.start <= currentTime && seg.end > currentTime) return seg.id
    return closest
  }, null)

  if (!segments.length) {
    return (
      <div className="transcript-empty">
        <p>No transcript yet. Upload a video and run transcription.</p>
      </div>
    )
  }

  return (
    <div className="transcript-editor">
      <div className="transcript-header">
        <span className="transcript-count">{segments.length} segments</span>
        <span className="transcript-marked">
          {segments.filter(s => s.is_marked).length} marked
        </span>
      </div>
      <div className="transcript-list">
        {segments.map(seg => (
          <SegmentRow
            key={seg.id}
            seg={seg}
            isActive={seg.id === activeId}
            videoRef={videoRef}
          />
        ))}
      </div>
    </div>
  )
}
