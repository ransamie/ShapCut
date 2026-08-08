/**
 * ProgressModal — Full-screen overlay shown during long operations
 */
import { useEffect, useRef, useState } from 'react'
import useEditorStore from '../store/editorStore'
import './ProgressModal.css'

const STEP_LABELS = {
  transcription: 'Extracting Captions',
  correction: 'Correcting Errors',
  analysis: 'AI Analysis',
  export: 'Exporting Video',
}

export default function ProgressModal() {
  const { status, progress } = useEditorStore()
  const activeSteps = ['transcribing', 'correcting', 'analyzing', 'exporting']
  const isActive = activeSteps.includes(status)

  const stepRef = useRef(progress.step)
  const startRef = useRef(Date.now())
  const [etaStr, setEtaStr] = useState('')

  const pct = Math.max(0, Math.min(100, progress.pct || 0))

  useEffect(() => {
    if (!isActive) {
      setEtaStr('')
      return
    }

    if (progress.step !== stepRef.current) {
      stepRef.current = progress.step
      startRef.current = Date.now()
      setEtaStr('')
      return
    }

    // Only compute ETA if we have meaningful progress (e.g., > 5%)
    if (pct > 5 && pct < 100) {
      const elapsedMs = Date.now() - startRef.current
      const msPerPct = elapsedMs / pct
      const msRemaining = msPerPct * (100 - pct)
      
      if (msRemaining > 0 && msRemaining < 3600000) { // Limit to 1 hr for sanity
        const totalSecs = Math.floor(msRemaining / 1000)
        const m = Math.floor(totalSecs / 60)
        const s = totalSecs % 60
        setEtaStr(m > 0 ? `~${m}m ${s}s left` : `~${s}s left`)
      }
    } else if (pct >= 100) {
      setEtaStr('')
    }
  }, [progress.step, pct, isActive])

  if (!isActive) return null

  const label = STEP_LABELS[progress.step] || progress.step || 'Processing…'

  return (
    <div className="progress-widget-container">
      <div className="modal-card animate-fade-in">
        <div className="widget-header">
          <div className="spinner-small" />
          <h3 className="modal-title">{label}</h3>
        </div>
        <p className="modal-message">{progress.message || 'Please wait…'}</p>
        <div className="progress-bar" style={{ marginTop: '12px' }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="modal-pct">{pct.toFixed(0)}%</span>
          {etaStr && <span className="modal-eta" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{etaStr}</span>}
        </div>
      </div>
    </div>
  )
}
