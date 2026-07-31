/**
 * User preferences that outlive a session.
 * SFX + music + sea volume + UI colour are applied in the renderer and mirrored in
 * localStorage for a fast cold-start; Electron settings.json is the long-term
 * source of truth.
 */
import * as audio from './audio.js'
import {
  applyUiTheme,
  applyUiBgTheme,
  DEFAULT_UI_HUE,
  DEFAULT_UI_BG_HUE,
  getUiHue as getAppliedUiHue,
  getUiBgHue as getAppliedUiBgHue
} from './ui/uiTheme.js'

const SFX_LS_KEY = 'witv.sfxEnabled'
const MUSIC_LS_KEY = 'witv.musicEnabled'
const SFX_VOLUME_LS_KEY = 'witv.sfxVolume'
const MUSIC_VOLUME_LS_KEY = 'witv.musicVolume'
const SEA_VOLUME_LS_KEY = 'witv.seaVolume'
const UI_HUE_LS_KEY = 'witv.uiHue'
const UI_BG_HUE_LS_KEY = 'witv.uiBgHue'
/** Legacy master key — migrated once into sfx + music. */
const LEGACY_SOUND_LS_KEY = 'witv.soundEnabled'

function readLocalBool(key) {
  try {
    const v = localStorage.getItem(key)
    if (v === '0') return false
    if (v === '1') return true
  } catch {
    /* private mode */
  }
  return null
}

function writeLocalBool(key, enabled) {
  try {
    localStorage.setItem(key, enabled ? '1' : '0')
  } catch {
    /* */
  }
}

function clampVolume(value, fallback = 1) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
}

function readLocalVolume(key) {
  try {
    const v = localStorage.getItem(key)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? clampVolume(n) : null
  } catch {
    return null
  }
}

function writeLocalVolume(key, value) {
  try {
    localStorage.setItem(key, String(clampVolume(value)))
  } catch {
    /* */
  }
}

function readLocalChannels() {
  let sfxVolume = readLocalVolume(SFX_VOLUME_LS_KEY)
  let musicVolume = readLocalVolume(MUSIC_VOLUME_LS_KEY)
  const seaVolume = readLocalVolume(SEA_VOLUME_LS_KEY)
  if (sfxVolume == null || musicVolume == null) {
    const legacy = readLocalBool(LEGACY_SOUND_LS_KEY)
    if (legacy != null) {
      if (sfxVolume == null) sfxVolume = legacy ? 1 : 0
      if (musicVolume == null) musicVolume = legacy ? 1 : 0
    }
  }
  if (sfxVolume == null) {
    const enabled = readLocalBool(SFX_LS_KEY)
    if (enabled != null) sfxVolume = enabled ? 1 : 0
  }
  if (musicVolume == null) {
    const enabled = readLocalBool(MUSIC_LS_KEY)
    if (enabled != null) musicVolume = enabled ? 1 : 0
  }
  return { sfxVolume, musicVolume, seaVolume }
}

/** Apply cached channels immediately (sync) so title music respects last choice. */
export function applyLocalSoundCache() {
  const { sfxVolume, musicVolume, seaVolume } = readLocalChannels()
  if (sfxVolume != null) audio.setSfxVolume(sfxVolume)
  if (musicVolume != null) audio.setMusicVolume(musicVolume)
  if (seaVolume != null) audio.setSeaVolume(seaVolume)
}

/**
 * Load SFX + music from Electron settings.json (authoritative),
 * fall back to localStorage, and keep both in sync.
 */
export async function loadSoundPreference() {
  applyLocalSoundCache()
  try {
    const api = window.electronAPI
    if (typeof api?.getSfxVolume === 'function') {
      const [sfxVolume, musicVolume, seaVolume] = await Promise.all([
        api.getSfxVolume(),
        api.getMusicVolume?.(),
        api.getSeaVolume?.()
      ])
      if (typeof sfxVolume === 'number' && Number.isFinite(sfxVolume)) {
        audio.setSfxVolume(sfxVolume)
        writeLocalVolume(SFX_VOLUME_LS_KEY, sfxVolume)
        writeLocalBool(SFX_LS_KEY, sfxVolume > 0)
      }
      if (typeof musicVolume === 'number' && Number.isFinite(musicVolume)) {
        audio.setMusicVolume(musicVolume)
        writeLocalVolume(MUSIC_VOLUME_LS_KEY, musicVolume)
        writeLocalBool(MUSIC_LS_KEY, musicVolume > 0)
      }
      if (typeof seaVolume === 'number' && Number.isFinite(seaVolume)) {
        audio.setSeaVolume(seaVolume)
        writeLocalVolume(SEA_VOLUME_LS_KEY, seaVolume)
      }
      return {
        sfx: audio.isSfxEnabled(),
        music: audio.isMusicEnabled(),
        sea: audio.getSeaVolume(),
        sfxVolume: audio.getSfxVolume(),
        musicVolume: audio.getMusicVolume(),
        seaVolume: audio.getSeaVolume()
      }
    }
    if (typeof api?.getSfxEnabled === 'function') {
      const sfx = await api.getSfxEnabled()
      const music = await api.getMusicEnabled()
      if (typeof sfx === 'boolean') {
        audio.setSfxVolume(sfx ? (audio.getSfxVolume() || 1) : 0)
        writeLocalBool(SFX_LS_KEY, sfx)
        writeLocalVolume(SFX_VOLUME_LS_KEY, audio.getSfxVolume())
      }
      if (typeof music === 'boolean') {
        audio.setMusicVolume(music ? (audio.getMusicVolume() || 1) : 0)
        writeLocalBool(MUSIC_LS_KEY, music)
        writeLocalVolume(MUSIC_VOLUME_LS_KEY, audio.getMusicVolume())
      }
      return {
        sfx: audio.isSfxEnabled(),
        music: audio.isMusicEnabled(),
        sea: audio.getSeaVolume(),
        sfxVolume: audio.getSfxVolume(),
        musicVolume: audio.getMusicVolume(),
        seaVolume: audio.getSeaVolume()
      }
    }
    // Older main process: single master flag.
    const enabled = await api?.getSoundEnabled?.()
    if (typeof enabled === 'boolean') {
      audio.setSfxVolume(enabled ? (audio.getSfxVolume() || 1) : 0)
      audio.setMusicVolume(enabled ? (audio.getMusicVolume() || 1) : 0)
      writeLocalBool(SFX_LS_KEY, enabled)
      writeLocalBool(MUSIC_LS_KEY, enabled)
      writeLocalVolume(SFX_VOLUME_LS_KEY, audio.getSfxVolume())
      writeLocalVolume(MUSIC_VOLUME_LS_KEY, audio.getMusicVolume())
      return {
        sfx: audio.isSfxEnabled(),
        music: audio.isMusicEnabled(),
        sea: audio.getSeaVolume(),
        sfxVolume: audio.getSfxVolume(),
        musicVolume: audio.getMusicVolume(),
        seaVolume: audio.getSeaVolume()
      }
    }
  } catch (err) {
    console.warn('loadSoundPreference failed', err)
  }
  return {
    sfx: audio.isSfxEnabled(),
    music: audio.isMusicEnabled(),
    sea: audio.getSeaVolume(),
    sfxVolume: audio.getSfxVolume(),
    musicVolume: audio.getMusicVolume(),
    seaVolume: audio.getSeaVolume()
  }
}

async function persistVolume(value, audioSetter, localKey, apiSetter, legacyKey) {
  const volume = clampVolume(value)
  audioSetter(volume)
  writeLocalVolume(localKey, volume)
  if (legacyKey) writeLocalBool(legacyKey, volume > 0)
  try {
    const saved = await apiSetter?.(volume)
    if (typeof saved === 'number' && Number.isFinite(saved)) {
      const normalized = clampVolume(saved)
      audioSetter(normalized)
      writeLocalVolume(localKey, normalized)
      if (legacyKey) writeLocalBool(legacyKey, normalized > 0)
      return normalized
    }
  } catch (err) {
    console.error(`persist ${localKey} failed`, err)
  }
  return volume
}

export function persistSfxVolume(value) {
  return persistVolume(
    value,
    audio.setSfxVolume,
    SFX_VOLUME_LS_KEY,
    window.electronAPI?.setSfxVolume,
    SFX_LS_KEY
  )
}

export function persistMusicVolume(value) {
  return persistVolume(
    value,
    audio.setMusicVolume,
    MUSIC_VOLUME_LS_KEY,
    window.electronAPI?.setMusicVolume,
    MUSIC_LS_KEY
  )
}

export function persistSeaVolume(value) {
  return persistVolume(
    value,
    audio.setSeaVolume,
    SEA_VOLUME_LS_KEY,
    window.electronAPI?.setSeaVolume
  )
}

export async function persistSfxEnabled(enabled) {
  const on = enabled !== false
  if (typeof window.electronAPI?.setSfxVolume === 'function') {
    return (await persistSfxVolume(on ? (audio.getSfxVolume() || 1) : 0)) > 0
  }
  audio.setSfxEnabled(on)
  writeLocalBool(SFX_LS_KEY, on)
  return on
}

export async function persistMusicEnabled(enabled) {
  const on = enabled !== false
  if (typeof window.electronAPI?.setMusicVolume === 'function') {
    return (await persistMusicVolume(on ? (audio.getMusicVolume() || 1) : 0)) > 0
  }
  audio.setMusicEnabled(on)
  writeLocalBool(MUSIC_LS_KEY, on)
  return on
}

/** @deprecated use persistSfxEnabled / persistMusicEnabled */
export async function persistSoundEnabled(enabled) {
  const on = enabled !== false
  await persistSfxEnabled(on)
  await persistMusicEnabled(on)
  return on
}

function clampHue(h, fallback = DEFAULT_UI_HUE) {
  const n = Math.round(Number(h))
  if (!Number.isFinite(n)) return fallback
  return ((n % 360) + 360) % 360
}

function readLocalHue(key, fallback = DEFAULT_UI_HUE) {
  try {
    const v = localStorage.getItem(key)
    if (v == null || v === '') return null
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    return clampHue(n, fallback)
  } catch {
    return null
  }
}

function writeLocalHue(key, hue, fallback) {
  try {
    localStorage.setItem(key, String(clampHue(hue, fallback)))
  } catch {
    /* */
  }
}

/** Apply cached UI accent + panel bg hues before first paint. */
export function applyLocalUiThemeCache() {
  applyUiTheme(readLocalHue(UI_HUE_LS_KEY, DEFAULT_UI_HUE) ?? DEFAULT_UI_HUE)
  applyUiBgTheme(readLocalHue(UI_BG_HUE_LS_KEY, DEFAULT_UI_BG_HUE) ?? DEFAULT_UI_BG_HUE)
  return { accent: getAppliedUiHue(), bg: getAppliedUiBgHue() }
}

/**
 * Load UI accent + panel background hues from Electron settings.json
 * (authoritative), fall back to localStorage, apply, keep stores in sync.
 */
export async function loadUiThemePreference() {
  applyLocalUiThemeCache()
  try {
    const api = window.electronAPI
    if (typeof api?.getUiHue === 'function') {
      const hue = await api.getUiHue()
      if (typeof hue === 'number' && Number.isFinite(hue)) {
        applyUiTheme(hue)
        writeLocalHue(UI_HUE_LS_KEY, hue, DEFAULT_UI_HUE)
      }
    }
    if (typeof api?.getUiBgHue === 'function') {
      const bg = await api.getUiBgHue()
      if (typeof bg === 'number' && Number.isFinite(bg)) {
        applyUiBgTheme(bg)
        writeLocalHue(UI_BG_HUE_LS_KEY, bg, DEFAULT_UI_BG_HUE)
      }
    }
  } catch (err) {
    console.warn('loadUiThemePreference failed', err)
  }
  return { accent: getAppliedUiHue(), bg: getAppliedUiBgHue() }
}

/** Apply + persist UI accent hue. */
export async function persistUiHue(hue) {
  const h = clampHue(hue, DEFAULT_UI_HUE)
  applyUiTheme(h)
  writeLocalHue(UI_HUE_LS_KEY, h, DEFAULT_UI_HUE)
  try {
    const saved = await window.electronAPI?.setUiHue?.(h)
    if (typeof saved === 'number' && Number.isFinite(saved)) {
      applyUiTheme(saved)
      writeLocalHue(UI_HUE_LS_KEY, saved, DEFAULT_UI_HUE)
      return getAppliedUiHue()
    }
  } catch (err) {
    console.error('persistUiHue failed', err)
  }
  return h
}

/** Apply + persist UI panel background hue (panels only — not space). */
export async function persistUiBgHue(hue) {
  const h = clampHue(hue, DEFAULT_UI_BG_HUE)
  applyUiBgTheme(h)
  writeLocalHue(UI_BG_HUE_LS_KEY, h, DEFAULT_UI_BG_HUE)
  try {
    const saved = await window.electronAPI?.setUiBgHue?.(h)
    if (typeof saved === 'number' && Number.isFinite(saved)) {
      applyUiBgTheme(saved)
      writeLocalHue(UI_BG_HUE_LS_KEY, saved, DEFAULT_UI_BG_HUE)
      return getAppliedUiBgHue()
    }
  } catch (err) {
    console.error('persistUiBgHue failed', err)
  }
  return h
}
