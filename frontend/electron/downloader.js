import fs from 'fs';
import path from 'path';
import axios from 'axios';
import extract from 'extract-zip';
import { app } from 'electron';

const FFMPEG_URLS = {
  win32: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip',
  darwin: 'https://evermeet.cx/ffmpeg/ffmpeg-6.0.zip',
  linux: 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz'
};

function findFileRecursive(dir, filename) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, filename);
      if (found) return found;
    } else if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

export async function ensureDependencies(splashWindow) {
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const binDir = path.join(app.getPath('userData'), 'bin');

  // 1. Check bundled resources in packaged app (resources/backend/ffmpeg)
  if (app.isPackaged) {
    const bundledFfmpeg = path.join(process.resourcesPath, 'backend', exeName);
    if (fs.existsSync(bundledFfmpeg)) {
      splashWindow?.webContents?.send('download-status', 'Bundled FFmpeg verified.');
      return bundledFfmpeg;
    }
  }

  // 2. Check dev build resources (frontend/build/backend/ffmpeg)
  const devFfmpeg = path.join(__dirname, '..', 'build', 'backend', exeName);
  if (fs.existsSync(devFfmpeg)) {
    splashWindow?.webContents?.send('download-status', 'Local FFmpeg verified.');
    return devFfmpeg;
  }

  // 3. Check userData/bin/ffmpeg
  const ffmpegPath = path.join(binDir, exeName);
  if (fs.existsSync(ffmpegPath)) {
    splashWindow?.webContents?.send('download-status', 'Dependencies verified.');
    return ffmpegPath;
  }

  // 4. Check if already extracted in a subfolder within userData/bin (e.g. ffmpeg-master-latest-win64-lgpl)
  if (fs.existsSync(binDir)) {
    const existingFfmpeg = findFileRecursive(binDir, exeName);
    if (existingFfmpeg) {
      try {
        fs.copyFileSync(existingFfmpeg, ffmpegPath);
        const existingProbe = findFileRecursive(binDir, probeName);
        if (existingProbe) {
          fs.copyFileSync(existingProbe, path.join(binDir, probeName));
        }
        splashWindow?.webContents?.send('download-status', 'FFmpeg restored from cache.');
        return ffmpegPath;
      } catch (err) {
        console.warn('Failed to restore from subfolder:', err);
      }
    }
  } else {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // 5. Download only if not found anywhere locally
  splashWindow?.webContents?.send('download-status', 'Downloading FFmpeg (One-time setup)...');
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
        splashWindow?.webContents?.send('download-status', `Downloading FFmpeg... ${percent}%`);
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    splashWindow?.webContents?.send('download-status', 'Extracting files...');

    // Extract zip
    if (process.platform === 'win32') {
      await extract(zipPath, { dir: binDir });

      // Dynamically locate ffmpeg.exe and ffprobe.exe regardless of folder name
      const foundFfmpeg = findFileRecursive(binDir, 'ffmpeg.exe');
      if (foundFfmpeg && foundFfmpeg !== ffmpegPath) {
        fs.copyFileSync(foundFfmpeg, ffmpegPath);
      }

      const probePath = path.join(binDir, 'ffprobe.exe');
      const foundProbe = findFileRecursive(binDir, 'ffprobe.exe');
      if (foundProbe && foundProbe !== probePath) {
        fs.copyFileSync(foundProbe, probePath);
      }

      // Cleanup subdirectories created by zip extraction
      const entries = fs.readdirSync(binDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            fs.rmSync(path.join(binDir, entry.name), { recursive: true, force: true });
          } catch (e) {
            console.warn('Cleanup warning:', e);
          }
        }
      }
    } else {
      splashWindow?.webContents?.send('download-status', 'Manual extraction required on Mac/Linux.');
    }

    // Cleanup zip archive
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    splashWindow?.webContents?.send('download-status', 'Ready.');
    return ffmpegPath;

  } catch (error) {
    splashWindow?.webContents?.send('download-error', `Network Error: Please check your internet connection.\n${error.message}`);
    throw error;
  }
}
