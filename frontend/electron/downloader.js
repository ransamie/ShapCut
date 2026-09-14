import fs from 'fs';
import path from 'path';
import axios from 'axios';
import extract from 'extract-zip';
import { app } from 'electron';

const FFMPEG_URLS = {
  win32: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
  // In a full production app, you'd provide Mac/Linux URLs too
  darwin: 'https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip',
  linux: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
};

export async function ensureDependencies(splashWindow) {
  const binDir = path.join(app.getPath('userData'), 'bin');
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const ffmpegPath = path.join(binDir, exeName);

  if (fs.existsSync(ffmpegPath)) {
    splashWindow.webContents.send('download-status', 'Dependencies verified.');
    return ffmpegPath;
  }

  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  splashWindow.webContents.send('download-status', 'Downloading FFmpeg (First Launch Setup)...');
  const downloadUrl = FFMPEG_URLS[process.platform];
  
  if (!downloadUrl) {
    throw new Error(`Platform ${process.platform} is not currently supported for auto-download.`);
  }

  const zipPath = path.join(binDir, 'ffmpeg.zip');

  try {
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
    });

    const totalLength = response.headers['content-length'];
    let downloaded = 0;

    const writer = fs.createWriteStream(zipPath);
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (totalLength) {
        const percent = Math.round((downloaded / totalLength) * 100);
        splashWindow.webContents.send('download-status', `Downloading FFmpeg... ${percent}%`);
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    splashWindow.webContents.send('download-status', 'Extracting files...');
    
    // For Windows zip
    if (process.platform === 'win32') {
        await extract(zipPath, { dir: binDir });
        
        // BtbN releases put things in ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe
        const extractedBin = path.join(binDir, 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe');
        if (fs.existsSync(extractedBin)) {
            fs.copyFileSync(extractedBin, ffmpegPath);
        }
        const extractedProbe = path.join(binDir, 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffprobe.exe');
        const probePath = path.join(binDir, 'ffprobe.exe');
        if (fs.existsSync(extractedProbe)) {
            fs.copyFileSync(extractedProbe, probePath);
        }
    } else {
        // Handle mac/linux extraction (simplified for this MVP)
        splashWindow.webContents.send('download-status', 'Manual extraction required on Mac/Linux in this MVP.');
    }

    // Cleanup
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    
    splashWindow.webContents.send('download-status', 'Ready.');
    return ffmpegPath;

  } catch (error) {
    splashWindow.webContents.send('download-error', `Network Error: Please check your internet connection.\n${error.message}`);
    throw error;
  }
}
