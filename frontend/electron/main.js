import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Customize the app name for system menus and notifications
app.name = 'ShapCut'
if (process.platform === 'win32') {
  app.setAppUserModelId('ShapCut')
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'ShapCut Editor',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    }
  })

  // Load the Vite dev server URL or the local file in production
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  } else {
    const devUrl = 'http://localhost:5173';
    mainWindow.loadURL(devUrl);
  }
}

let backendProcess = null;

async function startApplication() {
  const splashWindow = new BrowserWindow({
    width: 400,
    height: 500,
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const splashPath = path.join(__dirname, '..', 'splash.html');
  await splashWindow.loadFile(splashPath);

  try {
    const { ensureDependencies } = await import('./downloader.js');
    const ffmpegPath = await ensureDependencies(splashWindow);
    
    // Pass ffmpeg path to python via env var
    process.env.SHAPCUT_FFMPEG_PATH = ffmpegPath;

    // Spawn Backend
    if (app.isPackaged) {
      const { spawn } = await import('child_process');
      const backendExe = process.platform === 'win32' ? 'shapcut_api.exe' : 'shapcut_api';
      const backendPath = path.join(process.resourcesPath, 'backend', backendExe);
      
      if (fs.existsSync(backendPath)) {
        backendProcess = spawn(backendPath, [], { env: process.env, windowsHide: true });
        backendProcess.stdout.on('data', data => console.log(`Backend: ${data}`));
        backendProcess.stderr.on('data', data => console.error(`Backend Error: ${data}`));
      }
    }

    // Give backend a moment to start
    setTimeout(() => {
      createWindow();
      splashWindow.close();
    }, 2000);

  } catch (err) {
    console.error(err);
    // Splash window handles error display natively via download-error event
  }
}

app.whenReady().then(() => {
  startApplication();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
})

app.on('window-all-closed', function () {
  if (backendProcess) {
    backendProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit()
})
