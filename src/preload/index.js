import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  saveGame: (data) => ipcRenderer.invoke('save-game', data),
  loadGame: () => ipcRenderer.invoke('load-game'),
  deleteSave: () => ipcRenderer.invoke('delete-save'),
  hasSave: () => ipcRenderer.invoke('has-save'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getDisplayMode: () => ipcRenderer.invoke('get-display-mode'),
  setDisplayMode: (mode) => ipcRenderer.invoke('set-display-mode', mode),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  getSoundEnabled: () => ipcRenderer.invoke('get-sound-enabled'),
  setSoundEnabled: (enabled) => ipcRenderer.invoke('set-sound-enabled', enabled),
  getSfxEnabled: () => ipcRenderer.invoke('get-sfx-enabled'),
  setSfxEnabled: (enabled) => ipcRenderer.invoke('set-sfx-enabled', enabled),
  getMusicEnabled: () => ipcRenderer.invoke('get-music-enabled'),
  setMusicEnabled: (enabled) => ipcRenderer.invoke('set-music-enabled', enabled),
  getUiHue: () => ipcRenderer.invoke('get-ui-hue'),
  setUiHue: (hue) => ipcRenderer.invoke('set-ui-hue', hue),
  getUiBgHue: () => ipcRenderer.invoke('get-ui-bg-hue'),
  setUiBgHue: (hue) => ipcRenderer.invoke('set-ui-bg-hue', hue),
  // Main fires this if the OS enters/leaves fullscreen (e.g. green button).
  onFullscreenChanged: (cb) => {
    const handler = (_event, isFullscreen) => cb(isFullscreen)
    ipcRenderer.on('fullscreen-changed', handler)
    return () => ipcRenderer.removeListener('fullscreen-changed', handler)
  },
  onDisplayModeChanged: (cb) => {
    const handler = (_event, mode) => cb(mode)
    ipcRenderer.on('display-mode-changed', handler)
    return () => ipcRenderer.removeListener('display-mode-changed', handler)
  }
})
