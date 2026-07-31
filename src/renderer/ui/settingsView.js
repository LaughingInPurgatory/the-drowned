/**
 * Shared Settings panel for main menu and pause menu.
 * Separate SFX, music, and sea volume controls; window size is remembered by the main process.
 * UI Colour opens a sub-panel to retint chrome away from the default blue.
 */
import * as audio from '../audio.js'
import {
  loadSoundPreference,
  persistSfxVolume,
  persistMusicVolume,
  persistSeaVolume,
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
 * Full Services / Undock chrome (copied from dockingUI).
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
/* Settings layout: full-width Back button. */
.settings-view button.settings-back.ui-btn-gold,
.sound-volume-view button.sound-volume-back.ui-btn-gold,
.controls-view button.controls-back.ui-btn-gold,
.ui-colour-view button.ui-colour-back.ui-btn-gold {
  display: block;
  width: 100%;
  margin-top: 10px;
}
`

/** Shared styles — scope with a parent id (#pause-menu / #main-menu). */
export const SETTINGS_VIEW_CSS = `
${UI_ACTION_BTN_CSS}
.settings-view .settings-section,
.sound-volume-view .settings-section {
  display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px;
  padding: 10px 0 4px; border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
}
.settings-view .settings-section:first-of-type,
.sound-volume-view .settings-section:first-of-type { border-top: none; padding-top: 0; }
.settings-view .settings-label,
.sound-volume-view .settings-label {
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: var(--ui-accent); opacity: 0.8;
  text-align: center;
}
.settings-view .settings-note,
.sound-volume-view .settings-note {
  font-size: 10px; opacity: 0.55; text-align: center; line-height: 1.35; margin: 0;
}
.settings-view .settings-volume-row,
.sound-volume-view .settings-volume-row {
  display: flex; align-items: center; gap: 8px;
}
.settings-view .settings-volume-row input[type="range"],
.sound-volume-view .settings-volume-row input[type="range"] {
  flex: 1; width: 100%; accent-color: var(--ui-accent); cursor: pointer;
}
.settings-view .settings-volume-end,
.sound-volume-view .settings-volume-end {
  width: 24px; font-size: 9px; opacity: 0.55; text-align: center;
}
.settings-view .settings-volume-value,
.sound-volume-view .settings-volume-value {
  float: right; margin-left: 8px; color: var(--ui-bright); opacity: 0.9;
}
.sound-volume-view .sound-volume-reset {
  width: 100%; margin-top: 4px;
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
.ui-colour-view .ui-colour-presets button.ui-colour-preset {
  background: var(--preset-colour) !important;
}
.ui-colour-view .ui-bg-presets button.ui-bg-preset {
  background: var(--preset-colour) !important;
}
.ui-colour-view .ui-colour-presets button:hover,
.ui-colour-view .ui-bg-presets button:hover {
  transform: scale(1.08);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
  filter: brightness(1.16);
}
.ui-colour-view .ui-colour-presets button.ui-colour-preset:hover,
.ui-colour-view .ui-bg-presets button.ui-bg-preset:hover {
  background: var(--preset-colour) !important;
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
      <button type="button" class="settings-sound-volume">Sound &amp; Volume</button>
      <p class="settings-note">Sound effects, music, and sea ambience.</p>
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

export function soundVolumeViewHTML() {
  return `
    <h2>Sound &amp; Volume</h2>
    <div class="settings-section">
      <div class="settings-label">Sound Effects <span class="settings-volume-value sfx-volume-value">100%</span></div>
      <div class="settings-volume-row">
        <span class="settings-volume-end">0</span>
        <input type="range" class="settings-volume sfx-volume" min="0" max="100" step="1" value="100" aria-label="Sound effects volume" />
        <span class="settings-volume-end">100</span>
      </div>
      <p class="settings-note">Weapons, thrusters, docks, and voice callouts.</p>
    </div>
    <div class="settings-section">
      <div class="settings-label">Music <span class="settings-volume-value music-volume-value">100%</span></div>
      <div class="settings-volume-row">
        <span class="settings-volume-end">0</span>
        <input type="range" class="settings-volume music-volume" min="0" max="100" step="1" value="100" aria-label="Music volume" />
        <span class="settings-volume-end">100</span>
      </div>
      <p class="settings-note">Title, ambient, and death tracks.</p>
    </div>
    <div class="settings-section">
      <div class="settings-label">Sea Sound <span class="settings-volume-value sea-volume-value">100%</span></div>
      <div class="settings-volume-row">
        <span class="settings-volume-end">0</span>
        <input type="range" class="settings-volume sea-volume" min="0" max="100" step="1" value="100" aria-label="Sea sound volume" />
        <span class="settings-volume-end">100</span>
      </div>
      <p class="settings-note">Water wash, waves, and lapping around the hull.</p>
    </div>
    <button type="button" class="sound-volume-reset">Reset audio defaults</button>
    <button type="button" class="sound-volume-back ui-btn-gold">Back</button>
  `
}

/** Preset hues for quick picks (default yellow-orange first). */
const UI_COLOUR_PRESETS = [
  { hue: DEFAULT_UI_HUE, title: 'Amber (default)' },
  { hue: 45, title: 'Gold' },
  { hue: 12, title: 'Orange' },
  { hue: 0, title: 'Red' },
  { hue: 191, title: 'Cyan' },
  { hue: 145, title: 'Teal' },
  { hue: 95, title: 'Green' },
  { hue: 220, title: 'Blue' },
  { hue: 265, title: 'Violet' },
  { hue: 300, title: 'Magenta' }
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
      `<button type="button" class="ui-colour-preset" data-hue="${p.hue}" title="${p.title}" style="--preset-colour:hsl(${p.hue},90%,62%)"></button>`
  ).join('')
  const bgPresets = UI_BG_PRESETS.map(
    (p) =>
      `<button type="button" class="ui-bg-preset" data-hue="${p.hue}" title="${p.title}" style="--preset-colour:hsl(${p.hue},40%,14%)"></button>`
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
        <div class="ui-colour-hex">#FFD080</div>
      </div>
      <div class="ui-colour-field">
        <label>Hue <span class="ui-hue-value">${DEFAULT_UI_HUE}</span>°
          <input type="range" class="ui-hue" min="0" max="360" step="1" value="${DEFAULT_UI_HUE}" />
        </label>
      </div>
      <div class="ui-colour-presets">${presets}</div>
      <button type="button" class="ui-colour-reset">Reset accent</button>
    </div>
    <div class="ui-colour-block">
      <div class="ui-colour-block-title">Panel background</div>
      <p class="settings-note">Menu and HUD panel fills only.</p>
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
 * Wire the top-level Settings panel.
 * @param {HTMLElement} rootEl
 * @param {{ onBack: () => void, onShowSoundVolume?: () => void, onShowControls?: () => void, onShowUiColour?: () => void }} opts
 * @returns {{ refresh: () => Promise<void> }}
 */
export function bindSettingsView(rootEl, { onBack, onShowSoundVolume, onShowControls, onShowUiColour } = {}) {
  const btnSoundVolume = rootEl.querySelector('.settings-sound-volume')
  const btnControls = rootEl.querySelector('.settings-controls')
  const btnUiColour = rootEl.querySelector('.settings-ui-colour')

  async function refresh() {
    await loadUiThemePreference()
  }

  btnSoundVolume?.addEventListener('click', () => onShowSoundVolume?.())
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
 * Wire the separate Sound & Volume sub-panel.
 * @param {HTMLElement} rootEl
 * @param {{ onBack: () => void }} opts
 * @returns {{ refresh: () => Promise<void> }}
 */
export function bindSoundVolumeView(rootEl, { onBack } = {}) {
  const sfxSlider = rootEl.querySelector('.sfx-volume')
  const sfxValue = rootEl.querySelector('.sfx-volume-value')
  const musicSlider = rootEl.querySelector('.music-volume')
  const musicValue = rootEl.querySelector('.music-volume-value')
  const seaSlider = rootEl.querySelector('.sea-volume')
  const seaValue = rootEl.querySelector('.sea-volume-value')
  const resetButton = rootEl.querySelector('.sound-volume-reset')
  const saveTimers = new Map()

  function paintVolume(slider, label, volume) {
    const percent = Math.round(Math.max(0, Math.min(1, volume)) * 100)
    if (slider) slider.value = String(percent)
    if (label) label.textContent = `${percent}%`
  }

  function refreshVolumes() {
    paintVolume(sfxSlider, sfxValue, audio.getSfxVolume())
    paintVolume(musicSlider, musicValue, audio.getMusicVolume())
    paintVolume(seaSlider, seaValue, audio.getSeaVolume())
  }

  function bindVolumeSlider(slider, label, setLive, persist) {
    if (!slider) return
    const update = () => {
      const volume = Math.max(0, Math.min(100, Number(slider.value))) / 100
      setLive(volume)
      paintVolume(slider, label, volume)
      if (saveTimers.has(slider)) clearTimeout(saveTimers.get(slider))
      saveTimers.set(slider, setTimeout(() => {
        saveTimers.delete(slider)
        void persist(volume)
      }, 160))
    }
    slider.addEventListener('input', update)
    slider.addEventListener('change', () => {
      const timer = saveTimers.get(slider)
      if (timer) clearTimeout(timer)
      saveTimers.delete(slider)
      const volume = Math.max(0, Math.min(100, Number(slider.value))) / 100
      void persist(volume)
    })
  }

  async function refresh() {
    await loadSoundPreference()
    refreshVolumes()
  }

  bindVolumeSlider(sfxSlider, sfxValue, audio.setSfxVolume, persistSfxVolume)
  bindVolumeSlider(musicSlider, musicValue, audio.setMusicVolume, persistMusicVolume)
  bindVolumeSlider(seaSlider, seaValue, audio.setSeaVolume, persistSeaVolume)

  resetButton?.addEventListener('click', async () => {
    resetButton.disabled = true
    try {
      // Write sequentially because each Electron settings update reads and
      // rewrites the same JSON file.
      await persistSfxVolume(1)
      await persistMusicVolume(1)
      await persistSeaVolume(1)
      refreshVolumes()
    } finally {
      resetButton.disabled = false
    }
  })
  rootEl.querySelector('.sound-volume-back')?.addEventListener('click', () => onBack?.())

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
