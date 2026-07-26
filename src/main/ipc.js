import { app, ipcMain } from 'electron'
import { saveGame, loadGame, deleteSave, hasSave } from './save.js'
import {
  getSoundEnabled,
  setSoundEnabled,
  getSfxEnabled,
  setSfxEnabled,
  getMusicEnabled,
  setMusicEnabled,
  getUiHue,
  setUiHue,
  getUiBgHue,
  setUiBgHue
} from './settings.js'
import { getDisplayMode, getMainWindow, toggleFullscreen } from './display.js'

export function registerSaveHandlers() {
  ipcMain.handle('save-game', (_event, data) => saveGame(data))
  ipcMain.handle('load-game', () => loadGame())
  ipcMain.handle('delete-save', () => deleteSave())
  ipcMain.handle('has-save', () => hasSave())
  ipcMain.handle('quit-app', () => app.quit())
  ipcMain.handle('get-display-mode', () => getDisplayMode())
  ipcMain.handle('set-display-mode', (_event, mode) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return getDisplayMode()
    const wantFs = mode === 'fullscreen' || mode === 'full' || mode === true
    const isFs = getDisplayMode(win) === 'fullscreen'
    if (wantFs !== isFs) toggleFullscreen(win)
    return getDisplayMode(win)
  })
  ipcMain.handle('toggle-fullscreen', () => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return getDisplayMode()
    toggleFullscreen(win)
    return getDisplayMode(win)
  })
  // Legacy master mute (sets both SFX + music).
  ipcMain.handle('get-sound-enabled', () => getSoundEnabled())
  ipcMain.handle('set-sound-enabled', (_event, enabled) => setSoundEnabled(enabled))
  // Separate channels — persisted in userData/settings.json.
  ipcMain.handle('get-sfx-enabled', () => getSfxEnabled())
  ipcMain.handle('set-sfx-enabled', (_event, enabled) => setSfxEnabled(enabled))
  ipcMain.handle('get-music-enabled', () => getMusicEnabled())
  ipcMain.handle('set-music-enabled', (_event, enabled) => setMusicEnabled(enabled))
  ipcMain.handle('get-ui-hue', () => getUiHue())
  ipcMain.handle('set-ui-hue', (_event, hue) => setUiHue(hue))
  ipcMain.handle('get-ui-bg-hue', () => getUiBgHue())
  ipcMain.handle('set-ui-bg-hue', (_event, hue) => setUiBgHue(hue))
}
