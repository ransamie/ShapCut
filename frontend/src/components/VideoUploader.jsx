/**
 * VideoUploader — Drag-and-drop video file upload component.
 * Supports drag-over highlight, file-type validation, and progress feedback.
 */
import { useState, useRef, useCallback } from 'react'
import { Upload, Film, AlertCircle, Zap } from 'lucide-react'
import useEditorStore from '../store/editorStore'
import { uploadVideo, uploadVideoFromPath } from '../api/client'
import './VideoUploader.css'

const ACCEPTED = ['video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/x-m4v', 'video/x-flv']

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function VideoUploader({ onUploadComplete }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [pathInput, setPathInput] = useState('')
  const inputRef = useRef(null)
  const { setJob, setVideoUrl, setStatus, addToast } = useEditorStore()

  const handleFile = useCallback(async (file) => {
    setError(null)
    if (!file) return
    if (!ACCEPTED.includes(file.type) && !file.name.match(/\.(mp4|mov|avi|mkv|webm|m4v|flv)$/i)) {
      setError('Unsupported file format. Please use MP4, MOV, AVI, MKV, or WebM.')
      return
    }

    setUploading(true)
    setStatus('uploading')
    try {
      let result;
      const baseUrl = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
      
      // Aggressively try to get the absolute path
      let absolutePath = file._electronPath || file.path;
      
      try {
        if (!absolutePath && window.require) {
          const electron = window.require('electron');
          if (electron && electron.webUtils) {
            absolutePath = electron.webUtils.getPathForFile(file);
          }
        }
      } catch (e) {
        console.error("Electron require failed:", e);
      }

      if (absolutePath) {
        result = await uploadVideoFromPath(absolutePath)
        const vUrl = result.video_url;
        const finalUrl = vUrl.startsWith('file://') || vUrl.startsWith('http') ? vUrl : `${baseUrl}${vUrl}`;
        setVideoUrl(finalUrl)
        addToast('success', `"${file.name}" loaded instantly`)
      } else {
        // Fallback: standard HTTP upload (no Electron path available)
        const progress = setInterval(() => {
          setUploadPct(p => Math.min(p + 10, 85))
        }, 200)
        result = await uploadVideo(file)
        clearInterval(progress)
        setUploadPct(100)
        // video_url from backend is already an absolute http:// URL
        setVideoUrl(result.video_url)
        addToast('success', `"${file.name}" uploaded successfully`)
      }

      setJob({ ...result, status: 'uploaded' })
      onUploadComplete?.(result.job_id, file.name)
    } catch (err) {
      setError(err.message)
      setStatus('error')
      addToast('error', `Upload failed: ${err.message}`)
    } finally {
      setUploading(false)
      setUploadPct(0)
    }
  }, [setJob, setVideoUrl, setStatus, addToast, onUploadComplete])

  const handlePathSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (!pathInput.trim()) return
    
    setError(null)
    setUploading(true)
    setStatus('uploading')
    try {
      const result = await uploadVideoFromPath(pathInput.trim())
      
      const baseUrl = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
      const vUrl = result.video_url;
      const finalUrl = vUrl.startsWith('file://') || vUrl.startsWith('http') ? vUrl : `${baseUrl}${vUrl}`;
      setVideoUrl(finalUrl)
      
      setJob({ ...result, status: 'uploaded' })
      addToast('success', `"${result.filename}" loaded instantly`)
      onUploadComplete?.(result.job_id, result.filename)
    } catch (err) {
      setError(err.message)
      setStatus('error')
      addToast('error', `Load failed: ${err.message}`)
    } finally {
      setUploading(false)
      setPathInput('')
    }
  }, [pathInput, setJob, setVideoUrl, setStatus, addToast, onUploadComplete])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    
    // Use the native event to avoid React stripping the native `.path` property
    const nativeFiles = e.nativeEvent?.dataTransfer?.files || e.dataTransfer.files;
    const file = nativeFiles[0]
    
    if (file && nativeFiles[0].path) {
      file._electronPath = nativeFiles[0].path;
    }
    
    handleFile(file)
  }, [handleFile])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const onDragLeave = useCallback(() => setDragging(false), [])

  const onInputChange = useCallback((e) => {
    handleFile(e.target.files[0])
  }, [handleFile])

  return (
  <div className="uploader-wrapper">
    <div
      className={`uploader ${dragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => !uploading && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={onInputChange}
      />

      <div className="uploader-content">
        {uploading ? (
          <>
            <div className="uploader-icon uploading">
              <div className="spinner" style={{ width: 36, height: 36 }} />
            </div>
            <h3>Loading…</h3>
            <p>Preparing your video project</p>
            <div className="progress-bar uploader-progress">
              <div className="progress-fill" style={{ width: `${uploadPct}%` }} />
            </div>
          </>
        ) : (
          <>
            <div className="uploader-icon">
              {dragging ? <Film size={48} /> : <Upload size={48} />}
            </div>
            <h3>{dragging ? 'Drop your video here' : 'New project'}</h3>
            <p>Drag & drop or click to open a file</p>
            <div className="uploader-formats">
              {['MP4', 'MOV', 'AVI', 'MKV', 'WebM'].map(f => (
                <span key={f} className="format-tag">{f}</span>
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="uploader-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
    
    {!uploading && (
      <div className="uploader-path-input">
        <div className="path-divider"><span>OR</span></div>
        <form className="path-form" onSubmit={handlePathSubmit}>
          <input 
            type="text" 
            className="input text-input" 
            placeholder="Paste absolute path (e.g. C:\Videos\clip.mp4)" 
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary path-btn" disabled={!pathInput.trim()}>
            <Zap size={14}/> Instant Load
          </button>
        </form>
      </div>
    )}
  </div>
  )
}
