/**
 * ShapCut API Client
 * Thin wrapper over the FastAPI backend endpoints.
 */

const BASE = '/api'

async function request(method, path, body = null, isFormData = false) {
  const opts = {
    method,
    headers: isFormData ? {} : { 'Content-Type': 'application/json' },
  }
  if (body) {
    opts.body = isFormData ? body : JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

// ---------- Upload ----------

export async function uploadVideo(file) {
  const form = new FormData()
  form.append('file', file)
  return request('POST', '/upload', form, true)
}

export async function uploadVideoFromPath(path) {
  return request('POST', '/upload-path', { path })
}

// ---------- Transcription ----------

export async function transcribeJob(jobId, { modelSize = 'base', language = null } = {}) {
  const params = new URLSearchParams({ model_size: modelSize })
  if (language) params.append('language', language)
  return request('POST', `/transcribe/${jobId}?${params}`)
}

export async function importSubtitles(jobId, file) {
  const form = new FormData()
  form.append('file', file)
  return request('POST', `/import-subtitles/${jobId}`, form, true)
}

// ---------- Correction ----------

export async function correctJob(jobId) {
  return request('POST', `/correct/${jobId}`)
}

// ---------- Analysis ----------

export async function analyzeJob(jobId, {
  impactThreshold = 0.5,
  minDuration = 5,
  maxDuration = 60,
  maxShorts = 5,
} = {}) {
  const params = new URLSearchParams({
    impact_threshold: impactThreshold,
    min_duration: minDuration,
    max_duration: maxDuration,
    max_shorts: maxShorts,
  })
  return request('POST', `/analyze/${jobId}?${params}`)
}

// ---------- Segment editing ----------

export async function updateSegment(jobId, segId, payload) {
  return request('PATCH', `/segments/${jobId}/${segId}`, payload)
}

export async function updateCuts(jobId, cuts) {
  return request('PUT', `/cuts/${jobId}`, cuts)
}

// ---------- Job state ----------

export async function getJob(jobId) {
  return request('GET', `/jobs/${jobId}`)
}

export async function getSegments(jobId) {
  return request('GET', `/jobs/${jobId}/segments`)
}

export async function deleteJob(jobId) {
  return request('DELETE', `/jobs/${jobId}`)
}

// ---------- Export ----------

export async function exportJob(jobId, {
  outputFormat = 'mp4',
  burnSubtitles = false,
  crf = 23,
  exportIndividual = true,
  exportMerged = true,
  aspect_ratio = 'horizontal',
} = {}) {
  const params = new URLSearchParams({
    output_format: outputFormat,
    burn_subtitles: burnSubtitles,
    crf,
    export_individual: exportIndividual,
    export_merged: exportMerged,
    aspect_ratio,
  })
  return request('POST', `/export/${jobId}?${params}`)
}

export function getExportUrl(jobId, filename) {
  return `${BASE}/jobs/${jobId}/export/${encodeURIComponent(filename)}`
}

export function getSrtUrl(jobId) {
  return `${BASE}/jobs/${jobId}/srt`
}

// ---------- Polling helper ----------

export async function pollJobUntil(jobId, condition, { interval = 1500, timeout = 600000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const job = await getJob(jobId)
    if (condition(job)) return job
    if (job.status === 'error') throw new Error(job.error || 'Job failed')
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error('Job timed out')
}

// ---------- SSE — auto-reconnecting ----------

export function openEventStream(jobId, onEvent, onReconnect) {
  let es = null
  let closed = false
  let retryTimer = null

  function connect() {
    if (closed) return
    es = new EventSource(`${BASE}/events/${jobId}`)

    es.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)) } catch (_) {}
    }

    es.onerror = () => {
      es.close()
      if (closed) return
      // Auto-reconnect after 2 s — the transcription job is still running server-side
      retryTimer = setTimeout(() => {
        if (onReconnect) onReconnect()
        connect()
      }, 2000)
    }
  }

  connect()

  return {
    close() {
      closed = true
      if (retryTimer) clearTimeout(retryTimer)
      if (es) es.close()
    }
  }
}
