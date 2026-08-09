import { useRef, useCallback, useState, useEffect } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import useEditorStore from '../store/editorStore'
import './Timeline.css'

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

const TimelineTimeDisplay = ({ duration }) => {
  const currentTime = useEditorStore(state => state.currentTime)
  return <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
}

const TimelinePlayhead = ({ duration, localScrubTime }) => {
  const currentTime = useEditorStore(state => state.currentTime)
  const displayTime = localScrubTime !== null ? localScrubTime : currentTime
  return (
    <div 
      className="timeline-playhead" 
      style={{ left: `${duration > 0 ? (displayTime / duration) * 100 : 0}%` }}
    />
  )
}

const TimelineAutoScroll = ({ duration, zoomLevel, scrollRef, trackRef, isManuallyScrolling }) => {
  const currentTime = useEditorStore(state => state.currentTime)
  
  useEffect(() => {
    if (!scrollRef.current || !trackRef.current || zoomLevel === 1 || isManuallyScrolling.current) return
    const scrollEl = scrollRef.current
    const trackWidth = trackRef.current.offsetWidth
    const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0
    const playheadPx = (playheadPct / 100) * trackWidth
    
    // If playhead is outside the visible scroll window, center it
    const scrollLeft = scrollEl.scrollLeft
    const clientWidth = scrollEl.clientWidth
    
    if (playheadPx < scrollLeft || playheadPx > scrollLeft + clientWidth) {
      scrollEl.scrollLeft = playheadPx - clientWidth / 2
    }
  }, [currentTime, duration, zoomLevel, scrollRef, trackRef, isManuallyScrolling])
  
  return null
}

export default function Timeline({ videoRef }) {
  const { segments, cuts, duration, setCurrentTime, setIsGlobalScrubbing, updateCutBounds } = useEditorStore(useShallow(state => ({
    segments: state.segments,
    cuts: state.cuts,
    duration: state.duration,
    setCurrentTime: state.setCurrentTime,
    setIsGlobalScrubbing: state.setIsGlobalScrubbing,
    updateCutBounds: state.updateCutBounds
  })))
  
  const [zoomLevel, setZoomLevel] = useState(1)
  const trackRef = useRef(null)
  const scrollRef = useRef(null)
  
  // Dragging state for cut handles
  const [draggingHandle, setDraggingHandle] = useState(null) // { cutIndex, edge: 'start' | 'end' }
  const isDragging = useRef(false)

  // Local scrub state for smooth playhead visuals
  const [localScrubTime, setLocalScrubTime] = useState(null)

  const syncRef = useRef(null)
  const isManuallyScrolling = useRef(false)

  const handleScroll = (e) => {
    isManuallyScrolling.current = true
    if (syncRef.current) {
      syncRef.current.style.transform = `translateX(-${e.target.scrollLeft}px)`
      clearTimeout(syncRef.current._scrollTimeout)
      syncRef.current._scrollTimeout = setTimeout(() => {
        isManuallyScrolling.current = false
      }, 1000)
    }
  }

  // Zoom logic
  const handleZoom = (delta) => {
    setZoomLevel(prev => Math.max(1, Math.min(100, prev + delta)))
  }

  // Scroll wheel zoom
  const handleWheel = (e) => {
    if (e.shiftKey || e.altKey) {
      e.preventDefault() // prevent page scroll
      const delta = e.deltaY < 0 ? 1 : -1
      handleZoom(delta * 2) // Faster zoom on wheel
    }
  }

  // Seek / Scrub logic (only if not dragging a cut handle)
  const isScrubbing = useRef(false)
  const seek = useCallback((e) => {
    if (isDragging.current) return
    isScrubbing.current = true
    setIsGlobalScrubbing(true)

    const doSeek = (clientX, final = false) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || !duration) return
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const time = pct * duration
      setLocalScrubTime(time)

      if (videoRef?.current) {
        videoRef.current.currentTime = time
      }
      // Only force a global React state update at the end of the drag
      // or on the initial click to prevent main thread blocking during scrubbing.
      if (final) {
        setLocalScrubTime(null)
        setCurrentTime(time)
      }
    }

    // Seek immediately on click
    doSeek(e.clientX, true)

    const handleMouseMove = (moveEvent) => {
      if (!isScrubbing.current) return
      doSeek(moveEvent.clientX, false)
    }

    const handleMouseUp = (upEvent) => {
      isScrubbing.current = false
      setIsGlobalScrubbing(false)
      doSeek(upEvent.clientX, true)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [duration, videoRef, setCurrentTime])

  // Drag logic for cut handles
  const handleMouseDownOnHandle = (e, cutIndex, edge) => {
    e.stopPropagation()
    isDragging.current = true
    setDraggingHandle({ cutIndex, edge })
  }

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingHandle || !trackRef.current || !duration) return
      
      const rect = trackRef.current.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const newTime = pct * duration
      
      const { cutIndex, edge } = draggingHandle
      const cuts = useEditorStore.getState().cuts
      const cut = cuts[cutIndex]
      
      if (edge === 'start') {
        // limit start to not pass end
        const newStart = Math.min(newTime, cut.end - 1.0)
        updateCutBounds(cutIndex, newStart, cut.end)
        setCurrentTime(newStart)
        if (videoRef?.current) videoRef.current.currentTime = newStart
      } else {
        // limit end to not pass start
        const newEnd = Math.max(newTime, cut.start + 1.0)
        updateCutBounds(cutIndex, cut.start, newEnd)
        setCurrentTime(newEnd)
        if (videoRef?.current) videoRef.current.currentTime = newEnd
      }
    }

    const handleMouseUp = () => {
      if (draggingHandle) {
        setTimeout(() => { isDragging.current = false }, 50)
        setDraggingHandle(null)
      }
    }

    if (draggingHandle) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [draggingHandle, duration, updateCutBounds, setCurrentTime, videoRef])

  return (
    <div className="timeline-outer">
      <div className="timeline-labels">
        <TimelineTimeDisplay duration={duration} />
        
        <div className="timeline-zoom-controls">
          <button className="btn-icon" onClick={() => handleZoom(-1)} disabled={zoomLevel <= 1}>
            <ZoomOut size={14} />
          </button>
          <span className="zoom-level">{zoomLevel}x</span>
          <button className="btn-icon" onClick={() => handleZoom(1)} disabled={zoomLevel >= 100}>
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      <div className="timeline-track-wrap" ref={scrollRef} onWheel={handleWheel} onScroll={handleScroll}>
        <div 
          className="timeline-track" 
          ref={trackRef}
          onMouseDown={seek}
          role="slider"
          aria-label="Video timeline"
          style={{ width: `${zoomLevel * 100}%` }}
        >
          {/* Segment impact bands */}
          {segments.map(seg => {
            if (!duration) return null
            const left = (seg.start / duration) * 100
            const width = ((seg.end - seg.start) / duration) * 100
            return (
              <div
                key={seg.id}
                className={`timeline-seg ${seg.impact_level || 'low'} ${seg.is_marked ? 'marked' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${formatTime(seg.start)} – ${formatTime(seg.end)}\n${seg.corrected_text || seg.text}`}
              />
            )
          })}

          {/* Cut windows */}
          {cuts.map((cut, i) => {
            if (!duration) return null
            const left = (cut.start / duration) * 100
            const width = ((cut.end - cut.start) / duration) * 100
            return (
              <div
                key={i}
                className={`timeline-cut ${draggingHandle?.cutIndex === i ? 'active' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              >
                <div 
                  className="cut-handle left" 
                  onMouseDown={(e) => handleMouseDownOnHandle(e, i, 'start')}
                />
                <div 
                  className="cut-handle right" 
                  onMouseDown={(e) => handleMouseDownOnHandle(e, i, 'end')}
                />
              </div>
            )
          })}

          {/* Playhead */}
          <TimelinePlayhead duration={duration} localScrubTime={localScrubTime} />
        </div>
      </div>

      {/* Cut markers below */}
      <div className="timeline-scroll-sync" ref={syncRef} style={{ width: `${zoomLevel * 100}%` }}>
        {cuts.length > 0 && (
          <div className="timeline-markers" style={{ width: `${zoomLevel * 100}%` }}>
            {cuts.map((cut, i) => {
              const left = duration > 0 ? (cut.start / duration) * 100 : 0
              return (
                <div
                  key={i}
                  className="timeline-marker"
                  style={{ left: `${left}%` }}
                  title={`Cut #${i + 1}`}
                >
                  <span className="marker-label">✂ {i + 1}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <TimelineAutoScroll duration={duration} zoomLevel={zoomLevel} scrollRef={scrollRef} trackRef={trackRef} isManuallyScrolling={isManuallyScrolling} />
    </div>
  )
}
