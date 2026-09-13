import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }
}

let backendProcess = null

/**
 * Poll http://127.0.0.1:8000/api/health until it responds or we time out.
 * Returns true if healthy, false if timed out.
 */
async function waitForBackend(timeoutMs = 30000, intervalMs = 500) {
  const { default: http } = await import('http')
  const start = Date.now()

  return new Promise((resolve) => {
    function check() {
      const req = http.get('http://127.0.0.1:8000/api/health', (res) => {
        if (res.statusCode === 200) {
          resolve(true)
        } else {
          retry()
        }
      })
      req.on('error', () => retry())
      req.setTimeout(400, () => { req.destroy(); retry() })
    }

    function retry() {
      if (Date.now() - start > timeoutMs) {
        resolve(false)
      } else {
        setTimeout(check, intervalMs)
      }
    }

    check()
  })
}

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
  })

  const splashPath = path.join(__dirname, '..', 'splash.html')
  await splashWindow.loadFile(splashPath)

  const step = (id, state, sub, progress) => {
    if (!splashWindow.isDestroyed()) {
      splashWindow.webContents.send('splash-step', { step: id, state, sub, progress })
    }
  }

  try {
    // Step 1 — FFmpeg
    step('step-ffmpeg', 'active', '', 5)
    const { ensureDependencies } = await import('./downloader.js')
    const ffmpegPath = await ensureDependencies(splashWindow)
    process.env.SHAPCUT_FFMPEG_PATH = ffmpegPath
    step('step-ffmpeg', 'done', '', 33)

    // Step 2 — Backend
    step('step-backend', 'active', 'Launching AI engine...', 40)

    if (app.isPackaged) {
      const { spawn } = await import('child_process')
      const backendExe = process.platform === 'win32' ? 'shapcut_api.exe' : 'shapcut_api'
      const backendPath = path.join(process.resourcesPath, 'backend', backendExe)

      console.log(`[Electron] Looking for backend at: ${backendPath}`)

      if (fs.existsSync(backendPath)) {
        backendProcess = spawn(backendPath, [], {
          env: process.env,
          windowsHide: true,
        })

        backendProcess.stdout.on('data', data => console.log(`[Backend] ${data}`))
        backendProcess.stderr.on('data', data => console.error(`[Backend ERR] ${data}`))
        backendProcess.on('exit', (code, signal) => {
          console.error(`[Backend] Process exited with code=${code} signal=${signal}`)
        })
        backendProcess.on('error', (err) => {
          console.error(`[Backend] Failed to spawn: ${err.message}`)
          step('step-backend', 'error', `Failed to start: ${err.message}`, 40)
        })
      } else {
        console.error(`[Electron] Backend NOT FOUND at: ${backendPath}`)
        step('step-backend', 'error', 'Backend executable not found', 40)
      }
    }

    // Poll until backend is healthy
    const isReady = await waitForBackend(30000, 500, (elapsed) => {
      const secs = Math.round(elapsed / 1000)
      step('step-backend', 'active', `Waiting for AI engine... ${secs}s`, 40 + Math.min(secs, 20))
    })

    if (isReady) {
      step('step-backend', 'done', '', 70)
    } else {
      step('step-backend', 'error', 'AI engine did not respond in time', 70)
    }

    // Step 3 — Ready
    step('step-ready', 'active', 'Opening editor...', 90)
    await new Promise(r => setTimeout(r, 400))
    step('step-ready', 'done', '', 100)
    await new Promise(r => setTimeout(r, 300))

    createWindow()
    splashWindow.close()

  } catch (err) {
    console.error('[Electron] Startup error:', err)
    createWindow()
    splashWindow.close()
  }
}

app.whenReady().then(() => {
  startApplication()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (backendProcess) {
    backendProcess.kill()
  }
  if (process.platform !== 'darwin') app.quit()
})
