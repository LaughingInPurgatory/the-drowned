/**
 * UI accent colour theme.
 * Default cyan (hue ≈ 191) matches the original HUD chrome.
 * Sets CSS custom properties on :root so menus, HUD, and panels recolor live.
 */

/** Default blue/cyan accent (original game UI). */
export const DEFAULT_UI_HUE = 191
/**
 * Default panel fill hue — matches original dark navy
 * rgba(12,20,36) / rgba(7,12,22). Independent of accent hue.
 */
export const DEFAULT_UI_BG_HUE = 220

/** @type {number} */
let currentHue = DEFAULT_UI_HUE
/** @type {number} */
let currentBgHue = DEFAULT_UI_BG_HUE

function clampHue(h, fallback = DEFAULT_UI_HUE) {
  const n = Math.round(Number(h))
  if (!Number.isFinite(n)) return fallback
  return ((n % 360) + 360) % 360
}

function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360
  const ss = Math.max(0, Math.min(1, s))
  const ll = Math.max(0, Math.min(1, l))
  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hh < 60) {
    r = c
    g = x
  } else if (hh < 120) {
    r = x
    g = c
  } else if (hh < 180) {
    g = c
    b = x
  } else if (hh < 240) {
    g = x
    b = c
  } else if (hh < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255)
  }
}

function toHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * Derive full accent palette from a single hue (degrees).
 * Tuned so hue 191 reproduces the original cyan chrome.
 */
export function paletteFromHue(hue) {
  const h = clampHue(hue, DEFAULT_UI_HUE)
  const accent = hslToRgb(h, 1, 0.75)
  const mid = hslToRgb(h, 0.78, 0.69)
  const glow = hslToRgb(h, 0.62, 0.58)
  const text = hslToRgb(h, 1, 0.9)
  const deep = hslToRgb(h, 0.56, 0.42)
  const key = hslToRgb(h, 0.55, 0.79)
  // Secondary / hint text (title subtitle, table headers, footers).
  const soft = hslToRgb(h, 0.55, 0.83) // was ~#b8d4f0 cyan-soft
  const muted = hslToRgb(h, 0.28, 0.6) // was ~#7a9ab8 dim footer
  const dim = hslToRgb(h, 0.35, 0.64) // was ~#7fa8c9 / #8fb3d9 labels
  const bright = hslToRgb(h, 0.85, 0.96) // was ~#eaffff highlights
  const pale = hslToRgb(h, 0.7, 0.9) // was ~#b8e8f8 / #e8f4ff pale UI text
  return {
    hue: h,
    accent: toHex(accent),
    accentMid: toHex(mid),
    glow: toHex(glow),
    text: toHex(text),
    deep: toHex(deep),
    key: toHex(key),
    soft: toHex(soft),
    muted: toHex(muted),
    dim: toHex(dim),
    bright: toHex(bright),
    pale: toHex(pale),
    accentRgb: accent,
    glowRgb: glow,
    textRgb: text
  }
}

export function getUiHue() {
  return currentHue
}

export function getUiPalette() {
  return paletteFromHue(currentHue)
}

/** Hex accent for canvas / SVG / inline JS (e.g. radar, icons). */
export function getUiAccent() {
  return paletteFromHue(currentHue).accent
}

export function getUiText() {
  return paletteFromHue(currentHue).text
}

/**
 * Dark panel fill palette from a single hue (menus, HUD cards, docks).
 * Keeps panels near-black with a tinted navy cast — not scene/starfield.
 */
export function panelBgFromHue(hue) {
  const h = clampHue(hue, DEFAULT_UI_BG_HUE)
  // Primary panel face ≈ original rgba(12,20,36)
  const panel = hslToRgb(h, 0.5, 0.094)
  // Deeper edge ≈ original rgba(7,12,22)
  const panelDeep = hslToRgb(h, 0.52, 0.057)
  // Solid inputs ≈ #10182a
  const solid = hslToRgb(h, 0.45, 0.11)
  // Button face ≈ #16223a
  const solidMid = hslToRgb(h, 0.42, 0.16)
  // Scrim / overlay ≈ rgba(4,6,12)
  const scrim = hslToRgb(h, 0.5, 0.03)
  // Scrollbar track ≈ rgba(8,14,26)
  const track = hslToRgb(h, 0.52, 0.067)
  return {
    hue: h,
    panel,
    panelDeep,
    solid,
    solidMid,
    scrim,
    track,
    panelHex: toHex(panel),
    panelDeepHex: toHex(panelDeep)
  }
}

export function getUiBgHue() {
  return currentBgHue
}

export function getUiPanelBg() {
  return panelBgFromHue(currentBgHue)
}

/**
 * Apply accent theme to the document. Safe to call before DOM is fully ready.
 * @param {number} hue
 * @returns {ReturnType<typeof paletteFromHue>}
 */
export function applyUiTheme(hue) {
  currentHue = clampHue(hue, DEFAULT_UI_HUE)
  const p = paletteFromHue(currentHue)
  if (typeof document === 'undefined') return p
  const root = document.documentElement
  root.style.setProperty('--ui-hue', String(p.hue))
  root.style.setProperty('--ui-accent', p.accent)
  root.style.setProperty('--ui-accent-mid', p.accentMid)
  root.style.setProperty('--ui-glow', p.glow)
  root.style.setProperty('--ui-text', p.text)
  root.style.setProperty('--ui-deep', p.deep)
  root.style.setProperty('--ui-key', p.key)
  root.style.setProperty('--ui-soft', p.soft)
  root.style.setProperty('--ui-muted', p.muted)
  root.style.setProperty('--ui-dim', p.dim)
  root.style.setProperty('--ui-bright', p.bright)
  root.style.setProperty('--ui-pale', p.pale)
  root.style.setProperty('--ui-ar', String(p.accentRgb.r))
  root.style.setProperty('--ui-ag', String(p.accentRgb.g))
  root.style.setProperty('--ui-ab', String(p.accentRgb.b))
  root.style.setProperty('--ui-gr', String(p.glowRgb.r))
  root.style.setProperty('--ui-gg', String(p.glowRgb.g))
  root.style.setProperty('--ui-gb', String(p.glowRgb.b))
  root.style.setProperty('--ui-tr', String(p.textRgb.r))
  root.style.setProperty('--ui-tg', String(p.textRgb.g))
  root.style.setProperty('--ui-tb', String(p.textRgb.b))
  root.dataset.uiHue = String(p.hue)
  return p
}

/**
 * Apply UI panel background hue only (menus / HUD / docks — not space).
 * @param {number} hue
 * @returns {ReturnType<typeof panelBgFromHue>}
 */
export function applyUiBgTheme(hue) {
  currentBgHue = clampHue(hue, DEFAULT_UI_BG_HUE)
  const p = panelBgFromHue(currentBgHue)
  if (typeof document === 'undefined') return p
  const root = document.documentElement
  root.style.setProperty('--ui-bg-hue', String(p.hue))
  root.style.setProperty('--ui-bg-r', String(p.panel.r))
  root.style.setProperty('--ui-bg-g', String(p.panel.g))
  root.style.setProperty('--ui-bg-b', String(p.panel.b))
  root.style.setProperty('--ui-bg2-r', String(p.panelDeep.r))
  root.style.setProperty('--ui-bg2-g', String(p.panelDeep.g))
  root.style.setProperty('--ui-bg2-b', String(p.panelDeep.b))
  root.style.setProperty('--ui-bg-solid', p.solid ? toHex(p.solid) : '#10182a')
  root.style.setProperty('--ui-bg-solid-mid', toHex(p.solidMid))
  root.style.setProperty('--ui-bg-scrim-r', String(p.scrim.r))
  root.style.setProperty('--ui-bg-scrim-g', String(p.scrim.g))
  root.style.setProperty('--ui-bg-scrim-b', String(p.scrim.b))
  root.style.setProperty('--ui-bg-track-r', String(p.track.r))
  root.style.setProperty('--ui-bg-track-g', String(p.track.g))
  root.style.setProperty('--ui-bg-track-b', String(p.track.b))
  root.dataset.uiBgHue = String(p.hue)
  return p
}

/** Apply default cyan + default panel navy without touching storage. */
export function applyDefaultUiTheme() {
  applyUiTheme(DEFAULT_UI_HUE)
  return applyUiBgTheme(DEFAULT_UI_BG_HUE)
}
