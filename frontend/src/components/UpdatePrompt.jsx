import React, { useState, useEffect } from 'react';
import './UpdatePrompt.css';
import { X, ExternalLink, Download } from 'lucide-react';
import packageJson from '../../package.json';

const SNOOZE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

function isNewerVersion(current, remote) {
  const currentParts = current.replace('v', '').split('.').map(Number);
  const remoteParts = remote.replace('v', '').split('.').map(Number);
  
  for (let i = 0; i < Math.max(currentParts.length, remoteParts.length); i++) {
    const c = currentParts[i] || 0;
    const r = remoteParts[i] || 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

export default function UpdatePrompt() {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const snoozedUntil = localStorage.getItem('shapcut_update_snoozed_until');
        if (snoozedUntil && Date.now() < parseInt(snoozedUntil, 10)) {
          return;
        }

        const response = await fetch('https://api.github.com/repos/ransamie/ShapCut/releases/latest');
        if (!response.ok) return;
        const data = await response.json();
        
        const currentVersion = packageJson.version;
        if (isNewerVersion(currentVersion, data.tag_name)) {
          setUpdateInfo(data);
          setIsVisible(true);
        }
      } catch (error) {
        console.error('Failed to check for updates:', error);
      }
    };

    checkUpdate();
    
    // Check every 6 hours
    const interval = setInterval(checkUpdate, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSnooze = () => {
    localStorage.setItem('shapcut_update_snoozed_until', Date.now() + SNOOZE_DURATION);
    setIsVisible(false);
  };

  const handleDownload = () => {
    window.open(updateInfo.html_url, '_blank');
    setIsVisible(false); // Can choose to keep it visible or dismiss
  };

  if (!isVisible || !updateInfo) return null;

  return (
    <div className="update-prompt-overlay">
      <div className="update-prompt-modal">
        <button className="update-prompt-close" onClick={handleSnooze}>
          <X size={20} />
        </button>
        <div className="update-prompt-header">
          <Download size={24} className="update-icon" />
          <h2>Update Available</h2>
        </div>
        <div className="update-prompt-content">
          <p>A new version of ShapCut ({updateInfo.tag_name}) is available.</p>
          <p className="update-current-version">Current version: {packageJson.version}</p>
        </div>
        <div className="update-prompt-actions">
          <button className="btn-secondary" onClick={handleSnooze}>
            Remind Me Later
          </button>
          <button className="btn-primary" onClick={handleDownload}>
            Download Update <ExternalLink size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
