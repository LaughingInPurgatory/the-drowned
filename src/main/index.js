import { app, BrowserWindow, Menu } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerSaveHandlers } from './ipc.js'
import {
  applyWindowedLayout,
  attachWindowBoundsPersistence,
  windowCreateOptions,
  getMainWindow,
  notifyDisplayModeForMain,
  setMainWindow,
  toggleFullscreen
} from './display.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Matches the in-game title screen (menu copyright) and packaged installers.
const APP_NAME = 'Whispers In The Void'
const APP_COPYRIGHT = '© Laughing In Purgatory 2026'
const APP_ID = 'com.whispersinthevoid.game'

// Must run before ready — macOS menubar / app menu label, Linux process title,
// and Electron's default getName() all key off this (otherwise dev shows "Electron").
app.setName(APP_NAME)
process.title = APP_NAME
if (process.platform === 'win32') {
  // Taskbar grouping + jump list name use the AppUserModelID.
  app.setAppUserModelId(APP_ID)
}

if (process.env.DEV_REMOTE_DEBUG) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.DEV_REMOTE_DEBUG)
}

function appIconPath() {
  // Packaged: electron-builder embeds the platform icon in the binary.
  // Dev / Linux window chrome + About dialog still need an explicit PNG path.
  const candidates = [
    join(app.getAppPath(), 'build', 'icon.png'),
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath ?? '', 'icon.png')
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  return undefined
}

let aboutWindow = null

/**
 * Custom About window — native message boxes can't center icon + text.
 * Single centered column: app icon, name, version, copyright, OK.
 */
function showAbout() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus()
    return
  }

  const iconPath = appIconPath()
  // data: URL so packaging / asar paths don't break <img src>.
  let iconSrc = ''
  if (iconPath) {
    try {
      const b64 = readFileSync(iconPath).toString('base64')
      iconSrc = `data:image/png;base64,${b64}`
    } catch {
      iconSrc = pathToFileURL(iconPath).href
    }
  }

  const version = app.getVersion()
  const parent = BrowserWindow.getFocusedWindow()
  aboutWindow = new BrowserWindow({
    width: 360,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${APP_NAME}`,
    show: false,
    autoHideMenuBar: true,
    ...(parent ? { parent, modal: true } : {}),
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>About ${escapeHtml(APP_NAME)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0b1020;
      color: #e8eef8;
      -webkit-user-select: none;
      user-select: none;
      overflow: hidden;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 28px 24px 22px;
      gap: 10px;
      width: 100%;
    }
    img.icon {
      width: 96px;
      height: 96px;
      border-radius: 18px;
      object-fit: cover;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      margin-bottom: 6px;
    }
    h1 {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: 0.02em;
      line-height: 1.3;
    }
    .version {
      font-size: 13px;
      color: #9ab0cc;
      margin-top: 2px;
    }
    .copy {
      font-size: 12px;
      color: #7a90ab;
      margin-top: 4px;
    }
    button {
      margin-top: 16px;
      min-width: 88px;
      padding: 7px 22px;
      font-size: 13px;
      font-family: inherit;
      color: #e8eef8;
      background: linear-gradient(180deg, #2a3f62 0%, #1a2a44 100%);
      border: 1px solid #3d5a82;
      border-radius: 6px;
      cursor: pointer;
    }
    button:hover { border-color: #5a8ec4; background: linear-gradient(180deg, #345078 0%, #223552 100%); }
    button:active { transform: translateY(1px); }
    button:focus { outline: 2px solid #5a9fd4; outline-offset: 2px; }
  </style>
</head>
<body>
  <div class="panel">
    ${iconSrc ? `<img class="icon" src="${iconSrc}" alt="" draggable="false" />` : ''}
    <h1>${escapeHtml(APP_NAME)}</h1>
    <div class="version">Version ${escapeHtml(version)}</div>
    <div class="copy">${escapeHtml(APP_COPYRIGHT)}</div>
    <button type="button" id="ok" autofocus>OK</button>
  </div>
  <script>
    document.getElementById('ok').addEventListener('click', () => window.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') window.close();
    });
  </script>
</body>
</html>`

  aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  aboutWindow.once('ready-to-show', () => {
    if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.show()
  })
  aboutWindow.on('closed', () => {
    aboutWindow = null
  })
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function setupApplicationMenu() {
  // Reinforce name after ready (menu rebuild uses getName() on some platforms).
  app.setName(APP_NAME)
  process.title = APP_NAME

  const iconPath = appIconPath()
  // Still set native panel options (dock / system paths); iconPath is Linux/Windows.
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: APP_COPYRIGHT,
    ...(iconPath ? { iconPath } : {})
  })

  // Arcade game: no View / Help / Edit chrome in the window.
  // Quit is available in-game and by closing the window.
  if (process.platform === 'darwin') {
    // Custom About (not role:about) so we can show build/icon.png — macOS's
    // native About panel won't use iconPath and falls back to Electron's icon in dev.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          role: 'appMenu',
          submenu: [
            {
              label: `About ${APP_NAME}`,
              click: () => showAbout()
            },
            { type: 'separator' },
            { role: 'hide', label: `Hide ${APP_NAME}` },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: `Quit ${APP_NAME}` }
          ]
        }
      ])
    )
    return
  }

  // Windows / Linux: hide the in-window menubar entirely.
  Menu.setApplicationMenu(null)
}

function createWindow() {
  const icon = appIconPath()
  const opts = windowCreateOptions()

  const win = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    x: opts.x,
    y: opts.y,
    center: opts.center,
    // Always windowed with native OS title bar and borders.
    // useContentSize:false → width/height are outer size (chrome included).
    frame: true,
    useContentSize: false,
    fullscreen: false,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: APP_NAME,
    show: false,
    backgroundColor: '#05070d',
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  setMainWindow(win)
  // Remember manual resize/position as the new default for next launch.
  attachWindowBoundsPersistence(win)

  // Prevent the renderer document title from overwriting APP_NAME with "Electron".
  win.on('page-title-updated', (event) => {
    event.preventDefault()
    win.setTitle(APP_NAME)
  })

  // Tell the renderer so Alt free-look can snap back if fullscreen changes.
  const notifyFullscreen = () => notifyDisplayModeForMain()
  win.on('enter-full-screen', notifyFullscreen)
  win.on('leave-full-screen', notifyFullscreen)
  win.on('enter-html-full-screen', notifyFullscreen)
  win.on('leave-html-full-screen', notifyFullscreen)

  // Alt/Option+Enter toggles native fullscreen (works with pointer lock).
  // Match codes + keys broadly — macOS Option can report key as "Enter"/"Return".
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return
    const enter =
      input.code === 'Enter' ||
      input.code === 'NumpadEnter' ||
      input.key === 'Enter' ||
      input.key === 'Return'
    if (!enter) return
    if (!input.alt) return
    event.preventDefault()
    toggleFullscreen(win)
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`)
  })

  win.once('ready-to-show', () => {
    applyWindowedLayout(win)
    win.show()
    notifyDisplayModeForMain()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (getMainWindow() === win) setMainWindow(null)
  })
}

app.whenReady().then(() => {
  setupApplicationMenu()
  registerSaveHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Electron's own boilerplate skips this on darwin (macOS apps conventionally
// stay alive in the dock after their last window closes, e.g. multi-document
// editors). That doesn't fit a single-window arcade game with nothing useful
// to do in the background — without this, closing the window (red button or
// Cmd+W) left the process running indefinitely on macOS, which read as the
// game failing to quit rather than a deliberate platform convention.
app.on('window-all-closed', () => {
  app.quit()
})
