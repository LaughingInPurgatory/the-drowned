/**
 * Shared Settings panel for main menu and pause menu.
 * Separate SFX and music toggles; window size is remembered by the main process.
 * UI Colour opens a sub-panel to retint chrome away from the default blue.
 */
import * as audio from '../audio.js'
import {
  loadSoundPreference,
  persistSfxEnabled,
  persistMusicEnabled,
  loadUiThemePreference,
  persistUiHue,
  persistUiBgHue
} from '../preferences.js'
import {
  DEFAULT_UI_HUE,
  DEFAULT_UI_BG_HUE,
  getUiHue,
  getUiBgHue,
  applyUiTheme,
  applyUiBgTheme
} from './uiTheme.js'

/**
 * Full Station Services / Undock chrome (copied from dockingUI).
 * !important so #main-menu / #pause-menu button rules cannot strip the fill/glow.
 */
export const UI_ACTION_BTN_CSS = `
button.ui-btn-gold,
button.ui-btn-danger {
  box-sizing: border-box;
  cursor: pointer;
  font-family: monospace;
  font-weight: 600;
  letter-spacing: 2px;
  font-size: 13px;
  text-transform: uppercase;
  padding: 13px 26px;
  opacity: 1 !important;
  transform: none;
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease, filter 0.12s ease;
}
button.ui-btn-gold {
  background: linear-gradient(180deg, rgba(255,210,70,0.42), rgba(180,120,20,0.55)) !important;
  border: 2px solid #ffe08a !important;
  color: #fff6c8 !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.75);
  box-shadow:
    0 3px 8px rgba(0,0,0,0.85),
    0 8px 18px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.25) !important;
}
button.ui-btn-gold:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(255,220,90,0.58), rgba(210,150,30,0.65)) !important;
  box-shadow:
    0 4px 10px rgba(0,0,0,0.85),
    0 10px 20px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.35) !important;
  transform: translateY(-1px) !important;
  filter: brightness(1.06);
}
button.ui-btn-danger {
  background: linear-gradient(180deg, rgba(224,90,90,0.45), rgba(140,30,30,0.62)) !important;
  border: 2px solid #ff9a9a !important;
  color: #ffe0e0 !important;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.75);
  box-shadow:
    0 3px 8px rgba(0,0,0,0.85),
    0 8px 18px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.2) !important;
}
button.ui-btn-danger:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(240,110,110,0.58), rgba(170,40,40,0.7)) !important;
  box-shadow:
    0 4px 10px rgba(0,0,0,0.85),
    0 10px 20px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.28) !important;
  transform: translateY(-1px) !important;
  filter: brightness(1.06);
}
button.ui-btn-danger.active {
  background: linear-gradient(180deg, rgba(240,110,110,0.55), rgba(160,35,35,0.68)) !important;
  border-color: #ff9a9a !important;
  color: #ffe0e0 !important;
  box-shadow:
    0 2px 8px rgba(0,0,0,0.85),
    0 6px 16px rgba(0,0,0,0.5),
    inset 0 1px 0 rgba(255,255,255,0.15) !important;
}
/* Settings layout: full-width Back; Off shares the row 50/50. */
.settings-view button.settings-back.ui-btn-gold,
.controls-view button.controls-back.ui-btn-gold,
.ui-colour-view button.ui-colour-back.ui-btn-gold {
  display: block;
  width: 100%;
  margin-top: 10px;
}
.settings-view .settings-btns button.ui-btn-danger {
  flex: 1;
  padding: 11px 12px;
  font-size: 12px;
}
`

/** Shared styles — scope with a parent id (#pause-menu / #main-menu). */
export const SETTINGS_VIEW_CSS = `
${UI_ACTION_BTN_CSS}
.settings-view .settings-section {
  display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px;
  padding: 10px 0 4px; border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
}
.settings-view .settings-section:first-of-type { border-top: none; padding-top: 0; }
.settings-view .settings-label {
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--ui-accent); opacity: 0.8;
  text-align: center;
}
.settings-view .settings-btns { display: flex; gap: 6px; }
.settings-view .settings-btns button {
  flex: 1; padding: 8px 6px; font-size: 11px; letter-spacing: 0.5px;
}
.settings-view .settings-btns button.active:not(.ui-btn-danger) {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.28); border-color: var(--ui-accent-mid);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65); color: var(--ui-bright);
}
.settings-view .settings-note {
  font-size: 10px; opacity: 0.55; text-align: center; line-height: 1.35; margin: 0;
}
.ui-colour-view .ui-colour-preview {
  display: flex; flex-direction: column; gap: 8px; align-items: stretch;
  margin: 4px 0 10px;
  padding: 12px;
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.08);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35);
  box-shadow: 0 2px 6px rgba(0,0,0,0.55);
}
.ui-colour-view .ui-colour-swatch-row {
  display: flex; gap: 8px; align-items: center; justify-content: center;
}
.ui-colour-view .ui-colour-swatch {
  width: 36px; height: 36px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.35);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
.ui-colour-view .ui-colour-hex {
  font-size: 12px; letter-spacing: 1px; color: var(--ui-accent);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  text-align: center;
}
.ui-colour-view .ui-colour-field {
  display: flex; flex-direction: column; gap: 6px; margin: 6px 0 10px;
}
.ui-colour-view .ui-colour-field label {
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.85; text-align: center;
}
.ui-colour-view .ui-hue,
.ui-colour-view .ui-bg-hue {
  width: 100%; accent-color: var(--ui-accent); cursor: pointer;
}
.ui-colour-view .ui-colour-presets,
.ui-colour-view .ui-bg-presets {
  display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 4px 0 8px;
}
.ui-colour-view .ui-colour-presets button,
.ui-colour-view .ui-bg-presets button {
  width: 28px; height: 28px; padding: 0; border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.35); cursor: pointer;
  box-shadow: 0 0 8px rgba(0,0,0,0.4);
}
.ui-colour-view .ui-colour-presets button:hover,
.ui-colour-view .ui-bg-presets button:hover {
  transform: scale(1.08);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
.ui-colour-view .ui-colour-reset,
.ui-colour-view .ui-bg-reset {
  width: 100%; margin-top: 4px;
}
.ui-colour-view .settings-note {
  font-size: 10px; opacity: 0.55; text-align: center; line-height: 1.35; margin: 0 0 6px;
}
.ui-colour-view .ui-colour-block {
  margin: 10px 0 4px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22);
}
.ui-colour-view .ui-colour-block-title {
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.85; text-align: center; margin: 0 0 8px;
}
.ui-colour-view .ui-bg-preview {
  height: 40px; border-radius: 6px; margin: 0 0 8px;
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35);
  background: linear-gradient(
    135deg,
    rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.98),
    rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.95)
  );
  box-shadow: 0 0 12px rgba(0,0,0,0.45);
}
`

export function settingsViewHTML() {
  return `
    <h2>Settings</h2>
    <div class="settings-section">
      <div class="settings-label">Sound Effects</div>
      <div class="settings-btns">
        <button type="button" class="sfx-on">On</button>
        <button type="button" class="sfx-off ui-btn-danger">Off</button>
      </div>
      <p class="settings-note">Weapons, thrusters, docks, and voice callouts.</p>
    </div>
    <div class="settings-section">
      <div class="settings-label">Music</div>
      <div class="settings-btns">
        <button type="button" class="music-on">On</button>
        <button type="button" class="music-off ui-btn-danger">Off</button>
      </div>
      <p class="settings-note">Title, ambient, and death tracks. Saved as defaults.</p>
    </div>
    <div class="settings-section">
      <button type="button" class="settings-ui-colour">UI Colour</button>
      <p class="settings-note">Accent and panel background colours.</p>
    </div>
    <div class="settings-section">
      <button type="button" class="settings-controls">Controls</button>
      <p class="settings-note">Keyboard and mouse bindings.</p>
    </div>
    <button type="button" class="settings-back ui-btn-gold">Back</button>
  `
}

/** Preset hues for quick picks (default cyan first). */
const UI_COLOUR_PRESETS = [
  { hue: DEFAULT_UI_HUE, title: 'Cyan (default)' },
  { hue: 145, title: 'Teal' },
  { hue: 95, title: 'Green' },
  { hue: 45, title: 'Gold' },
  { hue: 12, title: 'Orange' },
  { hue: 0, title: 'Red' },
  { hue: 300, title: 'Magenta' },
  { hue: 265, title: 'Violet' },
  { hue: 220, title: 'Blue' }
]

/** Panel background presets — darker chips show fill tint. */
const UI_BG_PRESETS = [
  { hue: DEFAULT_UI_BG_HUE, title: 'Navy (default)' },
  { hue: 200, title: 'Steel' },
  { hue: 250, title: 'Indigo' },
  { hue: 280, title: 'Violet' },
  { hue: 160, title: 'Teal' },
  { hue: 120, title: 'Green' },
  { hue: 30, title: 'Bronze' },
  { hue: 0, title: 'Charcoal red' },
  { hue: 340, title: 'Plum' }
]

export function uiColourViewHTML() {
  const presets = UI_COLOUR_PRESETS.map(
    (p) =>
      `<button type="button" class="ui-colour-preset" data-hue="${p.hue}" title="${p.title}" style="background:hsl(${p.hue},90%,62%)"></button>`
  ).join('')
  const bgPresets = UI_BG_PRESETS.map(
    (p) =>
      `<button type="button" class="ui-bg-preset" data-hue="${p.hue}" title="${p.title}" style="background:hsl(${p.hue},40%,14%)"></button>`
  ).join('')
  return `
    <h2>UI Colour</h2>
    <div class="ui-colour-block" style="border-top:none;padding-top:0;margin-top:0">
      <div class="ui-colour-block-title">Accent</div>
      <p class="settings-note">Borders, labels, and highlights. Saves automatically.</p>
      <div class="ui-colour-preview">
        <div class="ui-colour-swatch-row">
          <div class="ui-colour-swatch ui-colour-swatch-main"></div>
          <div class="ui-colour-swatch ui-colour-swatch-mid" style="width:28px;height:28px;opacity:0.85"></div>
          <div class="ui-colour-swatch ui-colour-swatch-glow" style="width:22px;height:22px;opacity:0.7"></div>
        </div>
        <div class="ui-colour-hex">#7FE6FF</div>
      </div>
      <div class="ui-colour-field">
        <label>Hue <span class="ui-hue-value">191</span>°
          <input type="range" class="ui-hue" min="0" max="360" step="1" value="${DEFAULT_UI_HUE}" />
        </label>
      </div>
      <div class="ui-colour-presets">${presets}</div>
      <button type="button" class="ui-colour-reset">Reset accent</button>
    </div>
    <div class="ui-colour-block">
      <div class="ui-colour-block-title">Panel background</div>
      <p class="settings-note">menu and HUD panel fills only — not space or interiors.</p>
      <div class="ui-bg-preview" aria-hidden="true"></div>
      <div class="ui-colour-field">
        <label>Hue <span class="ui-bg-hue-value">220</span>°
          <input type="range" class="ui-bg-hue" min="0" max="360" step="1" value="${DEFAULT_UI_BG_HUE}" />
        </label>
      </div>
      <div class="ui-bg-presets">${bgPresets}</div>
      <button type="button" class="ui-bg-reset">Reset panel background</button>
    </div>
    <button type="button" class="ui-colour-back ui-btn-gold">Back</button>
  `
}

/**
 * Wire SFX + music + colour entry inside a settings view root.
 * @param {HTMLElement} rootEl
 * @param {{ onBack: () => void, onShowControls?: () => void, onShowUiColour?: () => void }} opts
 * @returns {{ refresh: () => Promise<void> }}
 */
export function bindSettingsView(rootEl, { onBack, onShowControls, onShowUiColour } = {}) {
  const btnSfxOn = rootEl.querySelector('.sfx-on')
  const btnSfxOff = rootEl.querySelector('.sfx-off')
  const btnMusicOn = rootEl.querySelector('.music-on')
  const btnMusicOff = rootEl.querySelector('.music-off')
  const btnControls = rootEl.querySelector('.settings-controls')
  const btnUiColour = rootEl.querySelector('.settings-ui-colour')

  function refreshButtons() {
    const sfx = audio.isSfxEnabled()
    const music = audio.isMusicEnabled()
    btnSfxOn.classList.toggle('active', sfx)
    btnSfxOff.classList.toggle('active', !sfx)
    btnMusicOn.classList.toggle('active', music)
    btnMusicOff.classList.toggle('active', !music)
  }

  async function refresh() {
    await loadSoundPreference()
    await loadUiThemePreference()
    refreshButtons()
  }

  btnSfxOn.addEventListener('click', async () => {
    await persistSfxEnabled(true)
    refreshButtons()
  })
  btnSfxOff.addEventListener('click', async () => {
    await persistSfxEnabled(false)
    refreshButtons()
  })
  btnMusicOn.addEventListener('click', async () => {
    await persistMusicEnabled(true)
    refreshButtons()
  })
  btnMusicOff.addEventListener('click', async () => {
    await persistMusicEnabled(false)
    refreshButtons()
  })
  btnControls?.addEventListener('click', () => {
    if (onShowControls) onShowControls()
  })
  btnUiColour?.addEventListener('click', () => {
    if (onShowUiColour) onShowUiColour()
  })
  rootEl.querySelector('.settings-back').addEventListener('click', () => onBack())

  return { refresh }
}

/**
 * Wire the UI Colour sub-panel (accent + panel bg, auto-save).
 * @param {HTMLElement} rootEl
 * @param {{ onBack: () => void }} opts
 * @returns {{ refresh: () => Promise<void> }}
 */
export function bindUiColourView(rootEl, { onBack } = {}) {
  const slider = rootEl.querySelector('.ui-hue')
  const hueValue = rootEl.querySelector('.ui-hue-value')
  const hexEl = rootEl.querySelector('.ui-colour-hex')
  const swatchMain = rootEl.querySelector('.ui-colour-swatch-main')
  const swatchMid = rootEl.querySelector('.ui-colour-swatch-mid')
  const swatchGlow = rootEl.querySelector('.ui-colour-swatch-glow')
  const bgSlider = rootEl.querySelector('.ui-bg-hue')
  const bgHueValue = rootEl.querySelector('.ui-bg-hue-value')
  let saveTimer = null
  let bgSaveTimer = null

  function paintAccent(hue) {
    const live = applyUiTheme(hue ?? getUiHue())
    if (slider) slider.value = String(live.hue)
    if (hueValue) hueValue.textContent = String(live.hue)
    if (hexEl) hexEl.textContent = live.accent.toUpperCase()
    if (swatchMain) swatchMain.style.background = live.accent
    if (swatchMid) swatchMid.style.background = live.accentMid
    if (swatchGlow) swatchGlow.style.background = live.glow
  }

  function paintBg(hue) {
    const live = applyUiBgTheme(hue ?? getUiBgHue())
    if (bgSlider) bgSlider.value = String(live.hue)
    if (bgHueValue) bgHueValue.textContent = String(live.hue)
    // Preview uses CSS vars — applyUiBgTheme already updated them.
  }

  function scheduleAccentSave(hue) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      persistUiHue(hue)
    }, 120)
  }

  function scheduleBgSave(hue) {
    if (bgSaveTimer) clearTimeout(bgSaveTimer)
    bgSaveTimer = setTimeout(() => {
      bgSaveTimer = null
      persistUiBgHue(hue)
    }, 120)
  }

  function flushSaves() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      persistUiHue(getUiHue())
    }
    if (bgSaveTimer) {
      clearTimeout(bgSaveTimer)
      bgSaveTimer = null
      persistUiBgHue(getUiBgHue())
    }
  }

  slider?.addEventListener('input', () => {
    paintAccent(Number(slider.value))
    scheduleAccentSave(getUiHue())
  })
  slider?.addEventListener('change', () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    persistUiHue(Number(slider.value))
  })

  bgSlider?.addEventListener('input', () => {
    paintBg(Number(bgSlider.value))
    scheduleBgSave(getUiBgHue())
  })
  bgSlider?.addEventListener('change', () => {
    if (bgSaveTimer) {
      clearTimeout(bgSaveTimer)
      bgSaveTimer = null
    }
    persistUiBgHue(Number(bgSlider.value))
  })

  rootEl.querySelectorAll('.ui-colour-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      paintAccent(Number(btn.dataset.hue))
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      persistUiHue(getUiHue())
    })
  })

  rootEl.querySelectorAll('.ui-bg-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      paintBg(Number(btn.dataset.hue))
      if (bgSaveTimer) {
        clearTimeout(bgSaveTimer)
        bgSaveTimer = null
      }
      persistUiBgHue(getUiBgHue())
    })
  })

  rootEl.querySelector('.ui-colour-reset')?.addEventListener('click', () => {
    paintAccent(DEFAULT_UI_HUE)
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    persistUiHue(DEFAULT_UI_HUE)
  })

  rootEl.querySelector('.ui-bg-reset')?.addEventListener('click', () => {
    paintBg(DEFAULT_UI_BG_HUE)
    if (bgSaveTimer) {
      clearTimeout(bgSaveTimer)
      bgSaveTimer = null
    }
    persistUiBgHue(DEFAULT_UI_BG_HUE)
  })

  rootEl.querySelector('.ui-colour-back')?.addEventListener('click', () => {
    flushSaves()
    onBack?.()
  })

  async function refresh() {
    await loadUiThemePreference()
    paintAccent(getUiHue())
    paintBg(getUiBgHue())
  }

  return { refresh }
}
