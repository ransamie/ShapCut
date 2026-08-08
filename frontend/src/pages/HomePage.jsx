/**
 * HomePage — Landing page with hero, features, and get-started CTA
 */
import { useNavigate } from 'react-router-dom'
import { Scissors, Zap, FileText, TrendingUp, ChevronRight, Film, Sparkles } from 'lucide-react'
import VideoUploader from '../components/VideoUploader'
import './HomePage.css'

const FEATURES = [
  {
    icon: <FileText size={24} />,
    title: 'AI Caption Extraction',
    desc: 'Automatically extract word-level captions from any video using OpenAI Whisper. Works offline, no API key needed.',
    color: 'accent',
  },
  {
    icon: <Sparkles size={24} />,
    title: 'Smart Error Correction',
    desc: 'Grammar correction, Whisper hallucination removal, and punctuation normalization keep your transcript clean.',
    color: 'yellow',
  },
  {
    icon: <TrendingUp size={24} />,
    title: 'Impact Analysis',
    desc: 'Multi-factor AI scoring rates each segment by information density, sentiment, pace, and hook keywords.',
    color: 'green',
  },
  {
    icon: <Scissors size={24} />,
    title: 'Frame-Accurate Cuts',
    desc: 'FFmpeg-powered cutting ensures your exported clips start and end exactly where you want them.',
    color: 'red',
  },
  {
    icon: <Zap size={24} />,
    title: 'One-Click Export',
    desc: 'Export individual clips or a single merged short. Optional burned-in subtitles for social media.',
    color: 'accent',
  },
  {
    icon: <Film size={24} />,
    title: 'Runs Locally',
    desc: 'Everything runs on your machine. Your footage never leaves your computer — total privacy.',
    color: 'green',
  },
]

const STEPS = [
  { n: '01', label: 'New project', desc: 'Drop your long-form video file' },
  { n: '02', label: 'Transcribe', desc: 'AI extracts & corrects captions' },
  { n: '03', label: 'Analyse', desc: 'Score & mark impactful moments' },
  { n: '04', label: 'Export', desc: 'Cut & save your short clips' },
]

export default function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="home">
      {/* Navbar */}
      <nav className="home-nav">
        <div className="home-logo">
          <Scissors size={20} />
          <span>ShapCut</span>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <Zap size={12} />
          AI-Powered Video Intelligence
        </div>
        <h1 className="hero-title">
          Turn Long Videos into<br />
          <span className="hero-gradient">Viral Shorts</span>
        </h1>
        <p className="hero-sub">
          ShapCut uses AI-transcribed captions to automatically find the most impactful
          moments in your footage — then cuts them with frame-perfect precision.
        </p>

        <div className="hero-upload-container" style={{ marginTop: '40px', maxWidth: '600px', margin: '40px auto 0' }}>
          <button 
            className="btn btn-primary" 
            style={{ fontSize: '1.2rem', padding: '16px 32px', borderRadius: '8px' }}
            onClick={() => navigate('/editor')}
          >
            New project
          </button>
          
          <div className="hero-mini-steps" style={{ 
            marginTop: '28px', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            gap: '16px',
            color: 'var(--color-text-muted)',
            fontSize: '0.95rem',
            fontWeight: '500'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>1</div>
              Start a project
            </span>
            <span style={{ color: 'var(--color-border)' }}>—</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>2</div>
              Let AI find the best clips
            </span>
            <span style={{ color: 'var(--color-border)' }}>—</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>3</div>
              Export viral shorts
            </span>
          </div>
        </div>
      </section>

      {/* Steps */}
      <section className="steps-section">
        <h2 className="section-title">How it works</h2>
        <div className="steps-grid">
          {STEPS.map((step, i) => (
            <div key={i} className="step-item">
              <div className="step-num">{step.n}</div>
              <h3>{step.label}</h3>
              <p>{step.desc}</p>
              {i < STEPS.length - 1 && <div className="step-arrow">→</div>}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="features-section">
        <h2 className="section-title">Everything you need</h2>
        <div className="features-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className={`feature-card color-${f.color}`}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer CTA */}
      <section className="home-footer-cta">
        <h2>Ready to create your first short?</h2>
        <p>Upload any long-form video and let ShapCut do the heavy lifting.</p>
        <button className="btn btn-primary btn-lg" onClick={() => navigate('/editor')}>
          <Film size={18} /> Open Editor
        </button>
      </section>

      <footer className="home-footer">
        <p>ShapCut — AI Video Editor • Built with faster-whisper, FFmpeg & React</p>
      </footer>
    </div>
  )
}
