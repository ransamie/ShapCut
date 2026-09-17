import React, { useState, useEffect } from 'react';
import './InteractiveTour.css';
import { X, ChevronRight, ChevronLeft, PlayCircle, Scissors, Upload, Download, Wand2 } from 'lucide-react';

const TOUR_STEPS = [
  {
    title: 'Welcome to ShapCut',
    description: 'ShapCut is your AI-powered video editor. Turn long videos into viral shorts automatically in just a few clicks.',
    icon: <PlayCircle size={48} className="tour-icon primary" />,
  },
  {
    title: 'Step 1: Upload',
    description: 'Start by uploading a long-form video or podcast. ShapCut processes everything locally on your machine for maximum privacy.',
    icon: <Upload size={48} className="tour-icon" />,
  },
  {
    title: 'Step 2: Generate',
    description: 'Click "Generate All" to let our AI transcribe the audio, correct the captions, and find the most viral, engaging moments.',
    icon: <Wand2 size={48} className="tour-icon magic" />,
  },
  {
    title: 'Step 3: Edit & Timeline',
    description: 'Use the interactive timeline to refine cuts, tweak captions, or manually select new segments to turn into shorts.',
    icon: <Scissors size={48} className="tour-icon" />,
  },
  {
    title: 'Step 4: Export',
    description: 'Preview your AI-generated shorts in the sidebar and export them instantly as MP4 files, ready for TikTok, Reels, or Shorts.',
    icon: <Download size={48} className="tour-icon" />,
  }
];

export default function InteractiveTour() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('shapcut_has_seen_tour');
    if (!hasSeenTour) {
      // Small delay to let the app load first
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
    
    // Listen for custom event to trigger tour manually
    const handleTrigger = () => {
      setCurrentStep(0);
      setIsOpen(true);
    };
    window.addEventListener('trigger-app-tour', handleTrigger);
    return () => window.removeEventListener('trigger-app-tour', handleTrigger);
  }, []);

  const handleClose = () => {
    localStorage.setItem('shapcut_has_seen_tour', 'true');
    setIsOpen(false);
  };

  const handleNext = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(s => s - 1);
    }
  };

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];

  return (
    <div className="tour-overlay">
      <div className="tour-modal">
        <button className="tour-close" onClick={handleClose}>
          <X size={20} />
        </button>
        
        <div className="tour-content">
          <div className="tour-icon-wrapper animate-pop">
            {step.icon}
          </div>
          <h2 className="animate-fade-up">{step.title}</h2>
          <p className="animate-fade-up delay-1">{step.description}</p>
        </div>

        <div className="tour-footer">
          <div className="tour-progress">
            {TOUR_STEPS.map((_, idx) => (
              <div 
                key={idx} 
                className={`tour-dot ${idx === currentStep ? 'active' : ''}`}
                onClick={() => setCurrentStep(idx)}
              />
            ))}
          </div>
          <div className="tour-actions">
            {currentStep > 0 && (
              <button className="btn-secondary" onClick={handlePrev}>
                <ChevronLeft size={16} /> Back
              </button>
            )}
            <button className="btn-primary" onClick={handleNext}>
              {currentStep === TOUR_STEPS.length - 1 ? 'Get Started' : 'Next'}
              {currentStep < TOUR_STEPS.length - 1 && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
