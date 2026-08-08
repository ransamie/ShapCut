/**
 * ExportPanel — Right panel section for export controls and download links.
 */
import { useState } from 'react'
import { Download, Film, FileText, Settings2, CheckCircle } from 'lucide-react'
import useEditorStore from '../store/editorStore'
import Dropdown from './Dropdown'
import { exportJob, getExportUrl, getSrtUrl, openEventStream, pollJobUntil } from '../api/client'
import './ExportPanel.css'

export default function ExportPanel() {
  const {
    jobId, cuts, exportFiles, exportSettings, setExportSettings,
    setExportFiles, setStatus, setProgress, addToast,
  } = useEditorStore()
  const [exporting, setExporting] = useState(false)

  const canExport = !!jobId && cuts.length > 0

  const handleExport = async () => {
    if (!canExport || exporting) return
    setExporting(true)
    setStatus('exporting')
    setProgress('export', 0, 'Starting export…')

    // Open SSE stream for progress
    const es = openEventStream(jobId, (event) => {
      if (event.step === 'export') {
        setProgress('export', event.progress, event.message)
        if (event.progress >= 100 || event.progress < 0) {
          es.close()
          setExporting(false)
        }
      }
    })

    try {
      await exportJob(jobId, {
        outputFormat: exportSettings.format,
        burnSubtitles: exportSettings.burnSubtitles,
        crf: exportSettings.crf,
        exportIndividual: exportSettings.exportIndividual,
        exportMerged: exportSettings.exportMerged,
        aspect_ratio: exportSettings.aspectRatio,
      })
      // Poll for completion
      const job = await pollJobUntil(
        jobId,
        j => ['exported', 'error'].includes(j.status),
        { interval: 1000, timeout: 300000 }
      )
      if (job.status === 'exported') {
        setExportFiles(job.export_files || [])
        setStatus('exported')
        addToast('success', `Exported ${job.export_files?.length || 0} file(s)!`)
        setProgress('export', 100, 'Done')

        // Auto-download the zip
        if (job.zip_url) {
          const link = document.createElement('a')
          link.href = job.zip_url
          link.download = ''
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        }
      }
    } catch (err) {
      addToast('error', `Export failed: ${err.message}`)
      setStatus('error')
    } finally {
      setExporting(false)
      es.close()
    }
  }

  return (
    <div className="export-panel">
      <div className="export-section-title">
        <Settings2 size={14} />
        Export Settings
      </div>

      {/* Aspect Ratio */}
      <div className="export-field">
        <label className="label">Aspect Ratio</label>
        <Dropdown
          value={exportSettings.aspectRatio}
          onChange={ratio => setExportSettings({ aspectRatio: ratio })}
          options={[
            { value: 'horizontal', label: 'Horizontal (16:9 Original)' },
            { value: 'vertical', label: 'Vertical (9:16 Auto-Crop)' },
            { value: 'vertical-ai', label: 'Vertical (9:16 AI Auto-Tracking)' }
          ]}
        />
      </div>

      {/* Format */}
      <div className="export-field">
        <label className="label">Format</label>
        <Dropdown
          value={exportSettings.format}
          onChange={format => setExportSettings({ format })}
          options={[
            { value: 'mp4', label: 'MP4 (H.264)' },
            { value: 'mov', label: 'MOV (H.264)' },
            { value: 'webm', label: 'WebM (VP9)' }
          ]}
        />
      </div>

      {/* Quality */}
      <div className="export-field">
        <label className="label">Quality (CRF: {exportSettings.crf})</label>
        <input
          type="range" min={15} max={35} step={1}
          value={exportSettings.crf}
          onChange={e => setExportSettings({ crf: Number(e.target.value) })}
          className="range-input"
        />
        <div className="range-labels">
          <span>Best</span>
          <span>Fastest</span>
        </div>
      </div>

      {/* Options */}
      <div className="export-options">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={exportSettings.burnSubtitles}
            onChange={e => setExportSettings({ burnSubtitles: e.target.checked })}
          />
          Burn subtitles into video
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={exportSettings.exportIndividual}
            onChange={e => setExportSettings({ exportIndividual: e.target.checked })}
          />
          Export clips individually
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={exportSettings.exportMerged}
            onChange={e => setExportSettings({ exportMerged: e.target.checked })}
          />
          Export merged short
        </label>
      </div>

      {/* Export button */}
      <button
        className="btn btn-success w-full"
        onClick={handleExport}
        disabled={!canExport || exporting}
      >
        {exporting ? (
          <><div className="spinner" /> Exporting…</>
        ) : (
          <><Film size={16} /> Export {cuts.length} Cut{cuts.length !== 1 ? 's' : ''}</>
        )}
      </button>

      {!canExport && (
        <p className="export-hint">
          {!jobId ? 'Upload and process a video first.' : 'Run AI analysis to generate cuts, or mark segments manually.'}
        </p>
      )}

      {/* Download links */}
      {exportFiles.length > 0 && (
        <div className="export-downloads">
          <div className="export-section-title">
            <CheckCircle size={14} style={{ color: 'var(--color-green)' }} />
            Downloads
          </div>
          {exportFiles.map(filename => (
            <a
              key={filename}
              href={getExportUrl(jobId, filename)}
              download={filename}
              className="download-link"
            >
              <Download size={14} />
              <span>{filename}</span>
            </a>
          ))}

          {/* SRT download */}
          <a
            href={getSrtUrl(jobId)}
            download={`${jobId}_subtitles.srt`}
            className="download-link srt"
          >
            <FileText size={14} />
            <span>Download SRT Subtitles</span>
          </a>
        </div>
      )}
    </div>
  )
}
