/**
 * Windowed-only display: native frame + title bar, remembered size/position.
 *
 * Default outer size 1600×900 (title bar and borders included).
 * Save/restore always uses BrowserWindow.getBounds() / setBounds() so chrome
 * is part of the measured size — never content-only setSize/setContentSize.
 */
import {
  getWindowedBounds,
  saveWindowedBounds,
  DEFAULT_WINDOWED_WIDTH,
  DEFAULT_WINDOWED_HEIGHT
} from './settings.js'

export const WINDOWED_WIDTH = DEFAULT_WINDOWED_WIDTH
export const WINDOWED_HEIGHT = DEFAULT_WINDOWED_HEIGHT

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null

/** Skip persisting size while we apply bounds programmatically. */
let suppressBoundsSave = false
let saveBoundsTimer = null

export function setMainWindow(win) {
  mainWindow = win
}

export function getMainWindow() {
  return mainWindow
}

/**
 * Apply saved (or default) outer window bounds, including OS chrome.
 * Called on ready-to-show so the frame metrics are available.
 */
export function applyWindowedLayout(win) {
  if (!win || win.isDestroyed()) return

  suppressBoundsSave = true
  try {
    win.setFullScreen(false)
    if (typeof win.setSimpleFullScreen === 'function' && win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(false)
    }
    win.setResizable(true)
    win.setMenuBarVisibility(false)

    const saved = getWindowedBounds()
    // Outer size: title bar + borders + content (same as getBounds()).
    const width = saved.width || WINDOWED_WIDTH
    const height = saved.height || WINDOWED_HEIGHT

    if (saved.x != null && saved.y != null) {
      win.setBounds({ x: saved.x, y: saved.y, width, height })
    } else {
      // Keep current origin, set outer size, then center the framed window.
      const cur = win.getBounds()
      win.setBounds({ x: cur.x, y: cur.y, width, height })
      win.center()
    }
  } finally {
    setTimeout(() => {
      suppressBoundsSave = false
    }, 250)
  }

  if (!win.webContents.isDestroyed()) {
    win.webContents.send('fullscreen-changed', false)
    win.webContents.send('display-mode-changed', 'windowed')
  }
}

/** @deprecated alias — always windowed now */
export function applyDisplayMode(win, _mode) {
  applyWindowedLayout(win)
}

function isWindowFullscreen(win) {
  if (!win || win.isDestroyed()) return false
  if (win.isFullScreen()) return true
  if (typeof win.isSimpleFullScreen === 'function' && win.isSimpleFullScreen()) return true
  return false
}

export function notifyDisplayModeForMain() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  const fs = isWindowFullscreen(mainWindow)
  mainWindow.webContents.send('fullscreen-changed', fs)
  mainWindow.webContents.send('display-mode-changed', fs ? 'fullscreen' : 'windowed')
}

/**
 * Toggle native fullscreen. Saves windowed bounds before entering so
 * leave-fullscreen restores the remembered outer size/position.
 * Always pings the renderer first so Alt free-look can drop even if the
 * OS swallows Alt keyup during the transition (old stuck-freelook bug).
 */
export function toggleFullscreen(win = mainWindow) {
  if (!win || win.isDestroyed()) return false
  const wasFs = isWindowFullscreen(win)
  const next = !wasFs
  // Drop free-look before the FS animation can eat Alt keyup.
  if (!win.webContents.isDestroyed()) {
    win.webContents.send('fullscreen-changed', next)
  }
  if (next) {
    // Snapshot outer bounds while still windowed (getBounds is wrong in FS).
    persistWindowedBoundsIfNeeded(win)
    if (typeof win.setFullScreenable === 'function') win.setFullScreenable(true)
    win.setFullScreen(true)
  } else {
    win.setFullScreen(false)
    if (typeof win.setSimpleFullScreen === 'function' && win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(false)
    }
  }
  return next
}

export function getDisplayMode(win = mainWindow) {
  return isWindowFullscreen(win) ? 'fullscreen' : 'windowed'
}

/**
 * Persist outer window bounds (title bar + borders included).
 */
export function persistWindowedBoundsIfNeeded(win) {
  if (suppressBoundsSave || !win || win.isDestroyed()) return
  if (win.isFullScreen()) return
  if (typeof win.isSimpleFullScreen === 'function' && win.isSimpleFullScreen()) return
  if (win.isMinimized()) return
  if (win.isMaximized?.()) return

  // getBounds() = outer rectangle including OS frame chrome.
  const b = win.getBounds()
  if (b.width < 640 || b.height < 480) return

  saveWindowedBounds({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y
  })
}

export function schedulePersistWindowedBounds(win) {
  if (suppressBoundsSave) return
  clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    persistWindowedBoundsIfNeeded(win)
  }, 300)
}

export function attachWindowBoundsPersistence(win) {
  const onChange = () => schedulePersistWindowedBounds(win)
  win.on('resize', onChange)
  win.on('move', onChange)
  win.on('close', () => {
    clearTimeout(saveBoundsTimer)
    persistWindowedBoundsIfNeeded(win)
  })
}

/**
 * BrowserWindow constructor options — always windowed with native frame.
 * width/height are outer window size (useContentSize: false).
 */
export function windowCreateOptions() {
  const saved = getWindowedBounds()
  const w = saved.width || WINDOWED_WIDTH
  const h = saved.height || WINDOWED_HEIGHT
  const hasPos = saved.x != null && saved.y != null

  return {
    width: w,
    height: h,
    x: hasPos ? saved.x : undefined,
    y: hasPos ? saved.y : undefined,
    center: !hasPos,
    frame: true,
    // false → width/height describe the full window (with borders), not the webview alone.
    useContentSize: false
  }
}

/** @deprecated use windowCreateOptions */
export function borderlessCreateOptions() {
  return windowCreateOptions()
}
