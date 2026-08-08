import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react'
import { Play, Pause, Volume2, VolumeX, Maximize } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import useEditorStore from '../store/editorStore'
import './VideoPlayer.css'

function formatTime(sec) {
  if (isNaN(sec)) return "00:00"
  const m = Math.floor(sec / 60).toString().padStart(2, '0')
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

const VideoPlayer = forwardRef(({ src, onLoadedMetadata, className }, ref) => {
  const internalRef = useRef(null)
  const progressRef = useRef(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setLocalCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  
  const { cuts, setCurrentTime, setIsGlobalScrubbing } = useEditorStore(useShallow(state => ({
    cuts: state.cuts,
    setCurrentTime: state.setCurrentTime,
    setIsGlobalScrubbing: state.setIsGlobalScrubbing
  })))

  // Expose the video element to the parent so they can call play(), pause(), currentTime etc.
  useImperativeHandle(ref, () => internalRef.current)

  // Sync internal state with video events
  useEffect(() => {
    const video = internalRef.current
    if (!video) return

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleTimeUpdate = () => {
      setLocalCurrentTime(video.currentTime)
    }
    const handleLoadedMetadata = (e) => {
      setDuration(video.duration)
      onLoadedMetadata?.(e)
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [onLoadedMetadata, setCurrentTime])

  const togglePlay = (e) => {
    e?.stopPropagation()
    const video = internalRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(e => console.error("Play err:", e))
    } else {
      video.pause()
    }
  }

  const toggleMute = (e) => {
    e?.stopPropagation()
    const video = internalRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
  }

  const toggleFullscreen = (e) => {
    e?.stopPropagation()
    const video = internalRef.current
    if (!video) return
    if (video.requestFullscreen) {
      video.requestFullscreen()
    }
  }

  const handleProgressClick = (e) => {
    e.stopPropagation()
    const bar = progressRef.current
    const video = internalRef.current
    if (!bar || !video || !duration) return

    let isScrubbing = true
    setIsGlobalScrubbing(true)

    const doSeek = (clientX) => {
      const rect = bar.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      video.currentTime = pct * duration
    }

    doSeek(e.clientX)

    const handleMouseMove = (moveEvent) => {
      if (!isScrubbing) return
      doSeek(moveEvent.clientX)
    }

    const handleMouseUp = () => {
      isScrubbing = false
      setIsGlobalScrubbing(false)
      // Force a final sync to global state
      setCurrentTime(video.currentTime)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className={`video-player-wrapper ${className || ''}`} onClick={togglePlay}>
      <video
        ref={internalRef}
        src={src}
        className="video-element"
        controls={false}
      />
      
      {/* Custom Controls Overlay */}
      <div className="video-controls" onClick={e => e.stopPropagation()}>
        
        {/* Progress Bar Area */}
        <div 
          className="video-progress-area" 
          ref={progressRef}
          onMouseDown={handleProgressClick}
        >
          <div className="video-progress-bg">
            <div 
              className="video-progress-fill" 
              style={{ width: `${progressPct}%` }}
            />
            {/* Cut Markers */}
            {cuts.map((cut, i) => {
              if (!duration) return null
              const left = (cut.start / duration) * 100
              const width = ((cut.end - cut.start) / duration) * 100
              return (
                <div 
                  key={i}
                  className="video-cut-marker"
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`Cut #${i + 1}`}
                />
              )
            })}
          </div>
        </div>

        {/* Buttons Row */}
        <div className="video-controls-row">
          <div className="v-left">
            <button className="v-btn" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}
            </button>
            <span className="v-time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <div className="v-right">
            <button className="v-btn" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
              {isMuted ? <VolumeX size={18}/> : <Volume2 size={18}/>}
            </button>
            <button className="v-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
              <Maximize size={16}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

export default VideoPlayer
