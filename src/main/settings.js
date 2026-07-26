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
  /** Title / ambient / death music tracks. */
  musicEnabled: true,
  /** UI accent hue degrees (0–360). Default ~191 = original cyan. */
  uiHue: 191,
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
    // Migrate legacy master mute: soundEnabled false → both off.
    const legacyMaster = data.soundEnabled
    const sfxEnabled =
      data.sfxEnabled === false
        ? false
        : data.sfxEnabled === true
          ? true
          : legacyMaster === false
            ? false
            : true
    const musicEnabled =
      data.musicEnabled === false
        ? false
        : data.musicEnabled === true
          ? true
          : legacyMaster === false
            ? false
            : true
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
      musicEnabled,
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
  return loadSettings().sfxEnabled !== false
}

export function setSfxEnabled(enabled) {
  const sfxEnabled = enabled !== false
  const next = saveSettings({ sfxEnabled })
  return next.sfxEnabled !== false
}

export function getMusicEnabled() {
  return loadSettings().musicEnabled !== false
}

export function setMusicEnabled(enabled) {
  const musicEnabled = enabled !== false
  const next = saveSettings({ musicEnabled })
  return next.musicEnabled !== false
}

/** @deprecated use getSfxEnabled / getMusicEnabled */
export function getSoundEnabled() {
  const s = loadSettings()
  return s.sfxEnabled !== false || s.musicEnabled !== false
}

/** @deprecated sets both channels for older callers */
export function setSoundEnabled(enabled) {
  const on = enabled !== false
  const next = saveSettings({ sfxEnabled: on, musicEnabled: on })
  return next.sfxEnabled !== false
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
