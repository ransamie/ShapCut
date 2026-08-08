/**
 * SegmentCard — Right-panel card showing an AI-suggested cut with score,
 * duration, preview text, and controls.
 */
import { Scissors, Trash2, GripVertical, Clock } from 'lucide-react'
import useEditorStore from '../store/editorStore'
import './SegmentCard.css'

function formatDuration(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function ScoreBar({ score }) {
  const pct = Math.round(score * 100)
  const cls = pct >= 60 ? 'high' : pct >= 35 ? 'medium' : 'low'
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        <div
          className={`score-bar-fill ${cls}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`score-label ${cls}`}>{pct}</span>
    </div>
  )
}

export default function SegmentCard({ cut, index, onSeek }) {
  const { setCuts, cuts } = useEditorStore()

  const handleRemove = () => {
    setCuts(cuts.filter((_, i) => i !== index))
  }

  const handleSeek = () => {
    onSeek?.(cut.start, cut.end)
  }

  const duration = cut.end - cut.start

  return (
    <div className="seg-card animate-fade-in">
      <div className="seg-card-header">
        <div className="seg-card-number">#{index + 1}</div>
        <div className="seg-card-time">
          <Clock size={11} />
          {formatDuration(duration)}
        </div>
        <button className="btn btn-icon" onClick={handleRemove} title="Remove cut">
          <Trash2 size={13} />
        </button>
      </div>

      <p className="seg-card-title">{cut.title || `Clip ${index + 1}`}</p>

      <div className="seg-card-meta">
        <div className="seg-card-bounds">
          <div className="seg-bound-stepper">
            <span className="seg-bound-label">Start</span>
            <input 
              type="number" 
              step="0.1" 
              value={cut.start.toFixed(1)} 
              onChange={(e) => useEditorStore.getState().updateCutBounds(index, parseFloat(e.target.value) || 0, cut.end)}
            />
            <span className="seg-bound-unit">s</span>
          </div>
          <div className="seg-bound-stepper">
            <span className="seg-bound-label">End</span>
            <input 
              type="number" 
              step="0.1" 
              value={cut.end.toFixed(1)} 
              onChange={(e) => useEditorStore.getState().updateCutBounds(index, cut.start, parseFloat(e.target.value) || 0)}
            />
            <span className="seg-bound-unit">s</span>
          </div>
        </div>
      </div>

      <ScoreBar score={cut.score || 0} />

      <button
        className="btn btn-ghost btn-sm seg-card-preview"
        onClick={handleSeek}
      >
        <Scissors size={13} />
        Preview Cut
      </button>
    </div>
  )
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = (sec % 60).toFixed(1).padStart(4, '0')
  return `${m}:${s}`
}
