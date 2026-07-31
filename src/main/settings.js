import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Default outer window size (title bar + borders included).
 * Matches BrowserWindow getBounds() / setBounds(), not content-only size.
 */
export const DEFAULT_WINDOWED_WIDTH = 1600
export const DEFAULT_WINDOWED_HEIGHT = 900

const DEFAULTS = {
  /** Outer width including OS frame chrome. */
  windowedWidth: DEFAULT_WINDOWED_WIDTH,
  /** Outer height including title bar + frame. */
  windowedHeight: DEFAULT_WINDOWED_HEIGHT,
  /** Optional saved position; null = center on next launch. */
  windowedX: null,
  windowedY: null,
  /** Sound effects + synth + voice callouts. */
  sfxEnabled: true,
  /** Sound effects level, 0–1. */
  sfxVolume: 1,
  /** Title / ambient / death music tracks. */
  musicEnabled: true,
  /** Music level, 0–1. */
  musicVolume: 1,
  /** Sea wash and lapping level, 0–1. */
  seaVolume: 1,
  /** UI accent hue degrees (0–360). Default ~38 = yellow-orange. */
  uiHue: 38,
  /** UI panel background hue (0–360). Default ~220 = original navy fills. */
  uiBgHue: 220
}

function settingsPath() {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

function clampInt(n, min, max, fallback) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, v))
}

function clampVolume(value, fallback = 1) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
}

export function loadSettings() {
  const path = settingsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    const windowedWidth = clampInt(data.windowedWidth, 640, 7680, DEFAULTS.windowedWidth)
    const windowedHeight = clampInt(data.windowedHeight, 480, 4320, DEFAULTS.windowedHeight)
    const windowedX =
      data.windowedX == null || data.windowedX === ''
        ? null
        : clampInt(data.windowedX, -10000, 10000, null)
    const windowedY =
      data.windowedY == null || data.windowedY === ''
        ? null
        : clampInt(data.windowedY, -10000, 10000, null)
    // Migrate legacy master mute and the old boolean channel settings into
    // continuous levels. A saved volume is authoritative when present.
    const legacyMaster = data.soundEnabled
    const oldSfxVolume = data.sfxVolume == null
      ? (data.sfxEnabled === false || (data.sfxEnabled == null && legacyMaster === false) ? 0 : 1)
      : clampVolume(data.sfxVolume)
    const oldMusicVolume = data.musicVolume == null
      ? (data.musicEnabled === false || (data.musicEnabled == null && legacyMaster === false) ? 0 : 1)
      : clampVolume(data.musicVolume)
    const sfxVolume = clampVolume(oldSfxVolume)
    const musicVolume = clampVolume(oldMusicVolume)
    const seaVolume = clampVolume(data.seaVolume, DEFAULTS.seaVolume)
    const sfxEnabled = sfxVolume > 0
    const musicEnabled = musicVolume > 0
    let uiHue = DEFAULTS.uiHue
    if (data.uiHue != null && Number.isFinite(Number(data.uiHue))) {
      uiHue = ((Math.round(Number(data.uiHue)) % 360) + 360) % 360
    }
    let uiBgHue = DEFAULTS.uiBgHue
    if (data.uiBgHue != null && Number.isFinite(Number(data.uiBgHue))) {
      uiBgHue = ((Math.round(Number(data.uiBgHue)) % 360) + 360) % 360
    }
    return {
      ...DEFAULTS,
      windowedWidth,
      windowedHeight,
      windowedX,
      windowedY,
      sfxEnabled,
      sfxVolume,
      musicEnabled,
      musicVolume,
      seaVolume,
      uiHue,
      uiBgHue
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial }
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function getSfxEnabled() {
  return loadSettings().sfxVolume > 0
}

export function setSfxEnabled(enabled) {
  const settings = loadSettings()
  const sfxVolume = enabled !== false ? (settings.sfxVolume > 0 ? settings.sfxVolume : 1) : 0
  const next = saveSettings({ sfxEnabled: sfxVolume > 0, sfxVolume })
  return next.sfxVolume > 0
}

export function getMusicEnabled() {
  return loadSettings().musicVolume > 0
}

export function setMusicEnabled(enabled) {
  const settings = loadSettings()
  const musicVolume = enabled !== false ? (settings.musicVolume > 0 ? settings.musicVolume : 1) : 0
  const next = saveSettings({ musicEnabled: musicVolume > 0, musicVolume })
  return next.musicVolume > 0
}

export function getSfxVolume() {
  return loadSettings().sfxVolume
}

export function setSfxVolume(value) {
  const sfxVolume = clampVolume(value)
  const next = saveSettings({ sfxVolume, sfxEnabled: sfxVolume > 0 })
  return next.sfxVolume
}

export function getMusicVolume() {
  return loadSettings().musicVolume
}

export function setMusicVolume(value) {
  const musicVolume = clampVolume(value)
  const next = saveSettings({ musicVolume, musicEnabled: musicVolume > 0 })
  return next.musicVolume
}

export function getSeaVolume() {
  return loadSettings().seaVolume
}

export function setSeaVolume(value) {
  const seaVolume = clampVolume(value)
  const next = saveSettings({ seaVolume })
  return next.seaVolume
}

/** @deprecated use getSfxEnabled / getMusicEnabled */
export function getSoundEnabled() {
  const s = loadSettings()
  return s.sfxVolume > 0 || s.musicVolume > 0
}

/** @deprecated sets both channels for older callers */
export function setSoundEnabled(enabled) {
  const on = enabled !== false
  const settings = loadSettings()
  const sfxVolume = on ? (settings.sfxVolume > 0 ? settings.sfxVolume : 1) : 0
  const musicVolume = on ? (settings.musicVolume > 0 ? settings.musicVolume : 1) : 0
  const next = saveSettings({ sfxEnabled: on, sfxVolume, musicEnabled: on, musicVolume })
  return next.sfxVolume > 0
}

export function getUiHue() {
  const h = loadSettings().uiHue
  if (h == null || !Number.isFinite(Number(h))) return DEFAULTS.uiHue
  return ((Math.round(Number(h)) % 360) + 360) % 360
}

export function setUiHue(hue) {
  let h = Math.round(Number(hue))
  if (!Number.isFinite(h)) h = DEFAULTS.uiHue
  h = ((h % 360) + 360) % 360
  const next = saveSettings({ uiHue: h })
  return getUiHueFrom(next)
}

function getUiHueFrom(s) {
  const h = s?.uiHue
  if (h == null || !Number.isFinite(Number(h))) return DEFAULTS.uiHue
  return ((Math.round(Number(h)) % 360) + 360) % 360
}

export function getUiBgHue() {
  const h = loadSettings().uiBgHue
  if (h == null || !Number.isFinite(Number(h))) return DEFAULTS.uiBgHue
  return ((Math.round(Number(h)) % 360) + 360) % 360
}

export function setUiBgHue(hue) {
  let h = Math.round(Number(hue))
  if (!Number.isFinite(h)) h = DEFAULTS.uiBgHue
  h = ((h % 360) + 360) % 360
  saveSettings({ uiBgHue: h })
  return getUiBgHue()
}

export function getWindowedBounds() {
  const s = loadSettings()
  return {
    width: s.windowedWidth,
    height: s.windowedHeight,
    x: s.windowedX,
    y: s.windowedY
  }
}

/**
 * Persist outer window geometry (from BrowserWindow.getBounds()).
 * width/height include the native title bar and borders.
 */
export function saveWindowedBounds({ width, height, x, y }) {
  return saveSettings({
    windowedWidth: clampInt(width, 640, 7680, DEFAULT_WINDOWED_WIDTH),
    windowedHeight: clampInt(height, 480, 4320, DEFAULT_WINDOWED_HEIGHT),
    windowedX: x == null ? null : clampInt(x, -10000, 10000, null),
    windowedY: y == null ? null : clampInt(y, -10000, 10000, null)
  })
}
