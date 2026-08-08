/**
 * ShapCut Global State — Zustand store
 *
 * State shape:
 *   jobId, status, filename, duration, language
 *   segments: TranscriptSegment[]
 *   cuts: { start, end, title, score, duration }[]
 *   exportFiles: string[]
 *   progress: { step, pct, message }
 *   toasts: { id, type, message }[]
 *   videoUrl: string (blob URL)
 *   currentTime: number (video playback position)
 *   selectedSegmentId: number | null
 *   analysisSettings: { threshold, minDur, maxDur, maxShorts }
 *   exportSettings: { format, burnSubs, crf, individual, merged }
 */

import { create } from 'zustand'

const useEditorStore = create((set, get) => ({
  // ── Job ──
  jobId: null,
  status: 'idle',          // idle | uploading | transcribing | correcting | analyzing | exporting | exported | error
  filename: '',
  duration: 0,
  language: null,
  error: null,

  // ── Content ──
  segments: [],
  _segmentIds: new Set(),
  cuts: [],
  exportFiles: [],

  // ── UI ──
  videoUrl: null,
  currentTime: 0,
  isGlobalScrubbing: false,
  selectedSegmentId: null,
  progress: { step: '', pct: 0, message: '' },
  toasts: [],

  // ── Settings ──
  analysisSettings: {
    threshold: 0.5,
    minDuration: 5,
    maxDuration: 60,
    maxShorts: 5,
  },
  exportSettings: {
    format: 'mp4',
    burnSubtitles: false,
    crf: 23,
    exportIndividual: true,
    exportMerged: true,
    aspectRatio: 'horizontal', // horizontal | vertical
  },

  // ── Actions ──

  setJob: (job) => set({
    jobId: job.jobId || job.job_id,
    status: job.status || 'uploaded',
    filename: job.filename || '',
    duration: job.duration || 0,
    language: job.language || null,
    error: null,
  }),

  setStatus: (status) => set({ status }),

  setVideoUrl: (url) => set({ videoUrl: url }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setIsGlobalScrubbing: (isScrubbing) => set({ isGlobalScrubbing: isScrubbing }),
  setDuration: (d) => set({ duration: d }),

  setSegments: (segments) => set({ segments }),

  appendSegment: (segment) => set((state) => {
    if (state._segmentIds.has(segment.id)) return state;
    const newIds = new Set(state._segmentIds);
    newIds.add(segment.id);
    return { segments: [...state.segments, segment], _segmentIds: newIds };
  }),

  setCuts: (cuts) => set({ cuts }),

  updateCutBounds: (index, start, end) => set((state) => {
    const newCuts = [...state.cuts]
    if (newCuts[index]) {
      const clampedStart = Math.max(0, start)
      const clampedEnd = Math.min(state.duration || end, end)
      newCuts[index] = {
        ...newCuts[index],
        start: clampedStart,
        end: clampedEnd,
        duration: clampedEnd - clampedStart
      }
    }
    return { cuts: newCuts }
  }),


  setExportFiles: (files) => set({ exportFiles: files }),

  setProgress: (step, pct, message = '') =>
    set({ progress: { step, pct, message } }),

  setError: (error) => set({ status: 'error', error }),

  selectSegment: (id) => set({ selectedSegmentId: id }),

  /** Toggle a segment's mark state locally (optimistic) */
  toggleSegmentMark: (segId) => {
    const segments = get().segments.map(s =>
      s.id === segId ? { ...s, is_marked: !s.is_marked } : s
    )
    set({ segments })
  },

  /** Update corrected_text for a segment locally */
  updateSegmentText: (segId, text) => {
    const segments = get().segments.map(s =>
      s.id === segId ? { ...s, corrected_text: text } : s
    )
    set({ segments })
  },

  setAnalysisSettings: (settings) =>
    set(state => ({
      analysisSettings: { ...state.analysisSettings, ...settings }
    })),

  setExportSettings: (settings) =>
    set(state => ({
      exportSettings: { ...state.exportSettings, ...settings }
    })),

  /** Add a toast notification */
  addToast: (type, message) => {
    const id = crypto.randomUUID()
    set(state => ({
      toasts: [...state.toasts, { id, type, message }]
    }))
    setTimeout(() => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }))
    }, 4000)
  },

  /** Remove a specific toast */
  removeToast: (id) =>
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) })),

  /** Reset everything for a new session */
  reset: () => {
    const state = get()
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl)
    set({
      jobId: null,
      status: 'idle',
      filename: '',
      duration: 0,
      language: null,
      error: null,
      segments: [],
      _segmentIds: new Set(),
      cuts: [],
      exportFiles: [],
      videoUrl: null,
      currentTime: 0,
      selectedSegmentId: null,
      progress: { step: '', pct: 0, message: '' },
    })
  },

  /** Rebuild cuts from currently marked segments */
  rebuildCutsFromMarked: () => {
    const { segments } = get()
    const marked = segments.filter(s => s.is_marked)
    if (!marked.length) {
      set({ cuts: [] })
      return
    }
    // Merge adjacent marked segments into windows
    const cuts = []
    let groupStart = marked[0].start
    let groupEnd = marked[0].end
    let groupTitle = marked[0].corrected_text || marked[0].text || ''
    let groupScore = marked[0].impact_score || 0
    let count = 1

    for (let i = 1; i < marked.length; i++) {
      const seg = marked[i]
      if (seg.start - groupEnd <= 2.0) {
        groupEnd = seg.end
        groupScore += (seg.impact_score || 0)
        count++
      } else {
        cuts.push({
          start: groupStart,
          end: groupEnd,
          duration: groupEnd - groupStart,
          title: groupTitle.slice(0, 60),
          score: count > 0 ? groupScore / count : 0,
        })
        groupStart = seg.start
        groupEnd = seg.end
        groupTitle = seg.corrected_text || seg.text || ''
        groupScore = seg.impact_score || 0
        count = 1
      }
    }
    cuts.push({
      start: groupStart,
      end: groupEnd,
      duration: groupEnd - groupStart,
      title: groupTitle.slice(0, 60),
      score: count > 0 ? groupScore / count : 0,
    })
    set({ cuts })
  },
}))

export default useEditorStore
