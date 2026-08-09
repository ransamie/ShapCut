/**
 * EditorPage — The main video editing workspace.
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────┐
 *   │  Topbar: title, pipeline controls                   │
 *   ├──────────────┬──────────────────────┬───────────────┤
 *   │ Left         │ Center               │ Right         │
 *   │ Transcript   │ Video player         │ AI Cuts       │
 *   │ Editor       │ + Timeline           │ + Export      │
 *   │              │                      │               │
 *   └──────────────┴──────────────────────┴───────────────┘
 */
import { useRef, useEffect, useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Scissors, Wand2, CheckCheck,
  FileUp, BarChart3, Plus, Sliders, RefreshCw, AlertCircle, Download
} from 'lucide-react'
import useEditorStore from '../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import {
  transcribeJob, correctJob, analyzeJob,
  getSegments, updateCuts, openEventStream, pollJobUntil
} from '../api/client'
import VideoUploader from '../components/VideoUploader'
import Dropdown from '../components/Dropdown'
import TranscriptEditor from '../components/TranscriptEditor'
import Timeline from '../components/Timeline'
import SegmentCard from '../components/SegmentCard'
import ExportPanel from '../components/ExportPanel'
import ProgressModal from '../components/ProgressModal'
import VideoPlayer from '../components/VideoPlayer'
import './EditorPage.css'

// ── Toast Container ──────────────────────────────────────────────────────────
function ToastContainer() {
  const { toasts, removeToast } = useEditorStore()
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast ${t.type}`}
          onClick={() => removeToast(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  )
}

// ── Custom Stepper Input ────────────────────────────────────────────────────
function Stepper({ value, min, max, step = 1, onChange }) {
  const [localValue, setLocalValue] = useState(value)

  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const commitChange = (newVal) => {
    const clamped = Math.max(min, Math.min(max, newVal))
    setLocalValue(clamped)
    onChange(clamped)
  }

  const dec = () => commitChange(value - step)
  const inc = () => commitChange(value + step)

  const handleChange = (e) => setLocalValue(e.target.value)
  const handleBlur = () => {
    const parsed = parseInt(localValue, 10)
    if (isNaN(parsed)) {
      setLocalValue(value)
    } else {
      commitChange(parsed)
    }
  }

  return (
    <div className="stepper">
      <button className="stepper-btn" onClick={dec} type="button" aria-label="Decrease">−</button>
      <input 
        type="number" 
        className="stepper-input" 
        value={localValue} 
        onChange={handleChange} 
        onBlur={handleBlur}
        min={min}
        max={max}
        step={step}
      />
      <button className="stepper-btn" onClick={inc} type="button" aria-label="Increase">+</button>
    </div>
  )
}

// ── Analysis Settings Panel (docked right) ────────────────────────────────────
function AnalysisSettingsModal({ onClose, onApply }) {
  const { analysisSettings, setAnalysisSettings } = useEditorStore()
  const [local, setLocal] = useState({ ...analysisSettings })

  return (
    <div className="settings-panel-backdrop" onClick={onClose}>
      <aside className="settings-panel" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="settings-panel-header">
          <div className="settings-panel-title">
            <Sliders size={15} />
            <span>AI Settings</span>
          </div>
          <button className="settings-panel-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Body */}
        <div className="settings-panel-body">

          {/* Impact Threshold */}
          <div className="settings-field">
            <div className="settings-field-header">
              <label className="settings-label">Impact Threshold</label>
              <span className="settings-value-badge">{Math.round(local.threshold * 100)}%</span>
            </div>
            <p className="settings-hint">Minimum score for a moment to become a short.</p>
            <input type="range" min={10} max={90} step={5}
              value={local.threshold * 100}
              onChange={e => setLocal(s => ({ ...s, threshold: e.target.value / 100 }))}
              className="range-input" />
            <div className="range-labels"><span>More clips</span><span>Fewer clips</span></div>
          </div>

          {/* Min Duration */}
          <div className="settings-field">
            <div className="settings-field-header">
              <label className="settings-label">Min Clip Duration</label>
              <span className="settings-value-badge">{local.minDuration}s</span>
            </div>
            <p className="settings-hint">Clips shorter than this are skipped.</p>
            <Stepper value={local.minDuration} min={3} max={60}
              onChange={v => setLocal(s => ({ ...s, minDuration: v }))} />
          </div>

          {/* Max Duration */}
          <div className="settings-field">
            <div className="settings-field-header">
              <label className="settings-label">Max Clip Duration</label>
              <span className="settings-value-badge">{local.maxDuration}s</span>
            </div>
            <p className="settings-hint">Clips longer than this are dropped.</p>
            <Stepper value={local.maxDuration} min={10} max={300} step={5}
              onChange={v => setLocal(s => ({ ...s, maxDuration: v }))} />
          </div>

          {/* Max Shorts */}
          <div className="settings-field">
            <div className="settings-field-header">
              <label className="settings-label">Max Shorts</label>
              <span className="settings-value-badge">{local.maxShorts}</span>
            </div>
            <p className="settings-hint">Hard cap on how many clips the AI picks.</p>
            <Stepper value={local.maxShorts} min={1} max={20}
              onChange={v => setLocal(s => ({ ...s, maxShorts: v }))} />
          </div>
        </div>

        {/* Footer */}
        <div className="settings-panel-footer">
          <button className="btn btn-ghost" onClick={onClose}>Discard</button>
          <button className="btn btn-primary" onClick={() => { setAnalysisSettings(local); onApply(local); onClose() }}>
            Apply
          </button>
        </div>
      </aside>
    </div>
  )
}

// ── Model Selection ─────────────────────────────────────────────────────────
const MODELS = [
  { value: 'tiny', label: 'Tiny (fastest)' },
  { value: 'base', label: 'Base (recommended)' },
  { value: 'small', label: 'Small (better accuracy)' },
  { value: 'medium', label: 'Medium (high accuracy)' },
  { value: 'large-v3', label: 'Large-v3 (best accuracy)' },
]

// ── EditorPage ───────────────────────────────────────────────────────────────
export default function EditorPage() {
  const navigate = useNavigate()
  const videoRef = useRef(null)
  const [modelSize, setModelSize] = useState('base')
  const [showSettings, setShowSettings] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(400) // Increased vertical height
  const [activeTab, setActiveTab] = useState('captions')
  const isResizing = useRef(false)

  const {
    jobId, status, filename, duration, segments, cuts,
    videoUrl, setCurrentTime, setSegments, setCuts,
    setStatus, setProgress, addToast, rebuildCutsFromMarked,
    analysisSettings, appendSegment
  } = useEditorStore(useShallow(state => ({
    jobId: state.jobId,
    status: state.status,
    filename: state.filename,
    duration: state.duration,
    segments: state.segments,
    cuts: state.cuts,
    videoUrl: state.videoUrl,
    setCurrentTime: state.setCurrentTime,
    setSegments: state.setSegments,
    setCuts: state.setCuts,
    setStatus: state.setStatus,
    setProgress: state.setProgress,
    addToast: state.addToast,
    rebuildCutsFromMarked: state.rebuildCutsFromMarked,
    analysisSettings: state.analysisSettings,
    appendSegment: state.appendSegment
  })))

  const hasJob = !!jobId
  const hasSegments = segments.length > 0
  const hasCuts = cuts.length > 0

  // Track video time and auto-pause for cuts
  const playUntilRef = useRef(null)
  
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => {
      // Auto-pause for cuts
      if (playUntilRef.current !== null && video.currentTime >= playUntilRef.current) {
        video.pause()
        playUntilRef.current = null
      }
    }
    video.addEventListener('timeupdate', onTime)
    return () => video.removeEventListener('timeupdate', onTime)
  }, [])

  // Spacebar → play / pause
  useEffect(() => {
    const onKey = (e) => {
      // Don't intercept when user is typing in an input/textarea
      const tag = e.target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return
      if (e.code === 'Space') {
        e.preventDefault()
        const video = videoRef.current
        if (!video) return
        video.paused ? video.play() : video.pause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])


  // ── Pipeline steps ───────────────────────────────────────────────────────
  const runTranscription = useCallback(async () => {
    if (!jobId) return
    setStatus('transcribing')
    setProgress('transcription', 5, 'Starting transcription…')

    const es = openEventStream(jobId, (ev) => {
      if (ev.step === 'transcription') {
        // progress === -1 means "message only, keep current %"
        if (ev.progress >= 0) {
          setProgress('transcription', ev.progress, ev.message)
        } else if (ev.message) {
          // update message without resetting the bar
          useEditorStore.setState(s => ({
            progress: { ...s.progress, message: ev.message }
          }))
        }
      } else if (ev.step === 'transcription_segment' && ev.segment) {
        appendSegment(ev.segment)
      }
    }, () => {
      setProgress('transcription', -1, 'Connection lost — reconnecting…')
    })

    try {
      await transcribeJob(jobId, { modelSize })
      const job = await pollJobUntil(
        jobId,
        j => ['transcribed', 'error'].includes(j.status)
      )
      if (job.status !== 'transcribed') throw new Error(job.error || 'Transcription failed')
      const seg = await getSegments(jobId)
      setSegments(seg.segments || [])
      setStatus('transcribed')
      addToast('success', `Transcription complete — ${seg.segments?.length} segments`)
    } catch (err) {
      addToast('error', `Transcription failed: ${err.message}`)
      setStatus('error')
    } finally {
      es.close()
    }
  }, [jobId, modelSize, setStatus, setProgress, addToast, setSegments])

  // Auto-start transcription on load if status is 'uploaded'
  useEffect(() => {
    if (status === 'uploaded' && !hasSegments) {
      runTranscription()
    }
  }, [status, hasSegments, runTranscription])

  const runCorrection = useCallback(async () => {
    if (!jobId || !hasSegments) return
    setStatus('correcting')
    setProgress('correction', 5, 'Starting correction…')

    const es = openEventStream(jobId, (ev) => {
      if (ev.step === 'correction') setProgress('correction', ev.progress, ev.message)
    })

    try {
      await correctJob(jobId)
      const job = await pollJobUntil(
        jobId,
        j => ['corrected', 'error'].includes(j.status)
      )
      if (job.status !== 'corrected') throw new Error(job.error || 'Correction failed')
      const seg = await getSegments(jobId)
      setSegments(seg.segments || [])
      setStatus('corrected')
      addToast('success', `${job.corrections_made || 0} caption corrections applied`)
    } catch (err) {
      addToast('error', `Correction failed: ${err.message}`)
      setStatus('error')
    } finally {
      es.close()
    }
  }, [jobId, hasSegments, setStatus, setProgress, addToast, setSegments])

  const runAnalysis = useCallback(async (settings = analysisSettings) => {
    if (!jobId || !hasSegments) return
    setStatus('analyzing')
    setProgress('analysis', 5, 'Scoring segments…')

    const es = openEventStream(jobId, (ev) => {
      if (ev.step === 'analysis') setProgress('analysis', ev.progress, ev.message)
    })

    try {
      await analyzeJob(jobId, {
        impactThreshold: settings.threshold,
        minDuration: settings.minDuration,
        maxDuration: settings.maxDuration,
        maxShorts: settings.maxShorts,
      })
      const job = await pollJobUntil(
        jobId,
        j => ['analyzed', 'error'].includes(j.status)
      )
      if (job.status !== 'analyzed') throw new Error(job.error || 'Analysis failed')
      const seg = await getSegments(jobId)
      setSegments(seg.segments || [])
      setCuts(job.cuts || [])
      setStatus('analyzed')
      addToast('success', `Analysis complete — ${job.cuts?.length || 0} shorts suggested`)
    } catch (err) {
      addToast('error', `Analysis failed: ${err.message}`)
      setStatus('error')
    } finally {
      es.close()
    }
  }, [jobId, hasSegments, analysisSettings, setStatus, setProgress, addToast, setSegments, setCuts])

  // Run all steps in sequence
  const runAll = useCallback(async () => {
    await runTranscription()
    await runCorrection()
    await runAnalysis()
  }, [runTranscription, runCorrection, runAnalysis])

  // Sync marked segments → cuts
  const handleSyncCuts = useCallback(async () => {
    rebuildCutsFromMarked()
    if (jobId && cuts.length > 0) {
      try { await updateCuts(jobId, cuts) } catch (_) {}
    }
    addToast('info', 'Cuts synced from marked segments')
  }, [rebuildCutsFromMarked, jobId, cuts, addToast])

  const handleSeek = useCallback((time, endTime = null) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time
      if (endTime) {
        playUntilRef.current = endTime
        videoRef.current.play().catch(e => console.error('Play error:', e))
      } else {
        playUntilRef.current = null
      }
    }
    setCurrentTime(time)
  }, [setCurrentTime])

  // Timeline resizer logic
  const handleMouseDown = useCallback((e) => {
    isResizing.current = true
    document.body.style.cursor = 'ns-resize'
  }, [])

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current) return
      const newHeight = window.innerHeight - e.clientY
      setTimelineHeight(Math.max(100, Math.min(newHeight, window.innerHeight * 0.8)))
    }
    const handleMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = 'default'
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const statusSteps = [
    { key: 'transcribed', label: 'Captions', done: ['transcribed','correcting','corrected','analyzing','analyzed','exporting','exported'].includes(status) },
    { key: 'corrected', label: 'Corrected', done: ['corrected','analyzing','analyzed','exporting','exported'].includes(status) },
    { key: 'analyzed', label: 'Analysed', done: ['analyzed','exporting','exported'].includes(status) },
    { key: 'exported', label: 'Exported', done: status === 'exported' },
  ]

  return (
    <div className="editor-page">
      {/* Topbar */}
      <header className="editor-topbar">
        <div className="topbar-left">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            <ArrowLeft size={14} /> Home
          </button>
          <div className="topbar-logo">
            <Scissors size={16} />
            <span>ShapCut</span>
          </div>
          {filename && <span className="topbar-filename">{filename}</span>}
        </div>

        {/* Pipeline step indicators */}
        {hasJob && (
          <>
            <div className="pipeline-steps">
              {statusSteps.map((s, i) => (
                <div key={s.key} className={`pipeline-step ${s.done ? 'done' : ''}`}>
                  <span className="ps-dot" />
                  <span className="ps-label">{s.label}</span>
                  {i < statusSteps.length - 1 && <span className="ps-sep">→</span>}
                </div>
              ))}
            </div>

            {hasSegments && (
              <div className="topbar-right" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={runAll}
                  disabled={status === 'transcribing'}
                  title="Re-run the entire pipeline from scratch"
                >
                  <RefreshCw size={13} /> Re-run All
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={runCorrection}
                  disabled={status === 'correcting'}
                >
                  <CheckCheck size={14} /> AI Correct
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => runAnalysis()}
                  disabled={status === 'analyzing'}
                >
                  <Scissors size={14} /> Analyze Shorts
                </button>
              </div>
            )}
          </>
        )}

      </header>

      {/* Main workspace */}
      <main className="editor-main">
        {!hasJob ? (
          /* Upload state */
          <div className="upload-state">
            <div className="upload-header">
              <Scissors size={32} className="upload-logo-icon" />
              <h2>ShapCut Editor</h2>
              <p>Open a long-form video to get started. ShapCut will extract captions, find the best moments, and create your short clips.</p>
            </div>
            <VideoUploader onUploadComplete={() => {}} />
          </div>
        ) : (
          <div className="editor-main animate-fade-in">
            <div className="workspace-top">
              {/* LEFT: Video & Settings Area */}
              <div className="video-area">
                <div className="video-wrap">
                  {videoUrl ? (
                    <VideoPlayer
                      ref={videoRef}
                      src={videoUrl}
                      className="video-player"
                      onLoadedMetadata={(e) => {
                        useEditorStore.getState().setDuration(e.target.duration)
                      }}
                    />
                  ) : (
                    <div className="video-placeholder">
                      <Scissors size={40} />
                      <p>Video preview</p>
                    </div>
                  )}
                </div>

                {/* Settings Bar — compact horizontal strip below video */}
                <div className="config-stepper">
                  {/* Source */}
                  <div className="config-row">
                    <div className="config-row-left">
                      <span className="step-label">Source</span>
                    </div>
                    <div className="config-row-right">
                      <div className="config-display">
                        <Scissors size={12}/> <span>{filename}</span>
                      </div>
                    </div>
                  </div>

                  {/* Language */}
                  <div className="config-row">
                    <div className="config-row-left">
                      <span className="step-label">Language</span>
                    </div>
                    <div className="config-row-right">
                      <Dropdown
                        className="config-dropdown"
                        value={'Auto'}
                        onChange={() => {}}
                        options={[{value: 'Auto', label: 'Auto-Detect'}]}
                      />
                    </div>
                  </div>

                  {/* Model */}
                  <div className="config-row">
                    <div className="config-row-left">
                      <span className="step-label">Model</span>
                    </div>
                    <div className="config-row-right">
                      <Dropdown
                        className="config-dropdown"
                        value={modelSize}
                        onChange={setModelSize}
                        options={MODELS}
                      />
                    </div>
                  </div>

                  {/* Options */}
                  <div className="config-row">
                    <div className="config-row-right config-buttons">
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>
                        <Sliders size={13} /> Settings
                      </button>
                    </div>
                  </div>

                  {/* Generate & Pipeline Controls — pushed to the far right */}
                  <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', alignItems: 'center' }}>
                    {!hasSegments && (
                      <button
                        className="btn btn-primary btn-generate"
                        onClick={runAll}
                        disabled={status === 'transcribing'}
                      >
                        <Wand2 size={15} /> Generate All
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT: AI Cuts & Transcript Area */}
              <div className="cuts-area">
                <div className="panel-header">
                  <div className="panel-title" style={{ flex: 1 }}>
                    <div className="right-tabs">
                      <button 
                        className={`right-tab ${activeTab === 'captions' ? 'active' : ''}`}
                        onClick={() => setActiveTab('captions')}
                      >
                        <BarChart3 size={14} /> Subtitles
                      </button>
                      <button 
                        className={`right-tab ${activeTab === 'shorts' ? 'active' : ''}`}
                        onClick={() => setActiveTab('shorts')}
                      >
                        <Scissors size={14} /> Shorts
                        {hasCuts && <span className="cuts-badge">{cuts.length}</span>}
                      </button>
                      <button 
                        className={`right-tab ${activeTab === 'export' ? 'active' : ''}`}
                        onClick={() => setActiveTab('export')}
                      >
                        <Download size={14} /> Export
                      </button>
                    </div>
                  </div>
                  {hasSegments && activeTab === 'shorts' && (
                    <div className="panel-controls">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={handleSyncCuts}
                        title="Sync cuts from marked segments"
                      >
                        <Plus size={13} /> Sync Marks
                      </button>
                    </div>
                  )}
                </div>
                
                <div className="cuts-list-wrap">
                  {!hasSegments ? (
                    status === 'transcribing' ? (
                      <div className="empty-state">
                        <RefreshCw size={32} className="empty-state-icon spin" />
                        <p>Transcribing audio... this may take a moment.</p>
                      </div>
                    ) : (
                      <div className="empty-state">
                        <BarChart3 size={32} className="empty-state-icon" />
                        <p>Click Generate to extract subtitles and AI shorts.</p>
                      </div>
                    )
                  ) : (
                    <div className="right-panel-tabs-content">
                      {activeTab === 'captions' ? (
                        <div className="transcript-section">
                          <TranscriptEditor videoRef={videoRef} />
                        </div>
                      ) : activeTab === 'shorts' ? (
                        <div className="shorts-section">
                          {cuts.length === 0 ? (
                            status === 'analyzing' ? (
                              <div className="empty-state">
                                <RefreshCw size={32} className="empty-state-icon spin" />
                                <p>Analyzing transcription for viral hooks...</p>
                              </div>
                            ) : (
                              <div className="empty-state">
                                <p>No shorts generated yet. Click "Analyze Shorts" to extract cuts.</p>
                              </div>
                            )
                          ) : (
                            cuts.map((cut, i) => (
                              <SegmentCard
                                key={i}
                                cut={cut}
                                index={i}
                                onSeek={handleSeek}
                              />
                            ))
                          )}
                        </div>
                      ) : (
                        <div className="export-section">
                          <ExportPanel />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* BOTTOM: Timeline */}
            <div className="timeline-resizer" onMouseDown={handleMouseDown} />
            <div className="workspace-bottom" style={{ height: timelineHeight }}>
              <Timeline videoRef={videoRef} />
            </div>
          </div>
        )}
      </main>

      {/* Modals & overlays */}
      <ProgressModal />
      <ToastContainer />
      {showSettings && (
        <AnalysisSettingsModal
          onClose={() => setShowSettings(false)}
          onApply={(s) => runAnalysis(s)}
        />
      )}
    </div>
  )
}
