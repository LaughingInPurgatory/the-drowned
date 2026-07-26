import {
  SETTINGS_VIEW_CSS,
  settingsViewHTML,
  uiColourViewHTML,
  bindSettingsView,
  bindUiColourView
} from './settingsView.js'
import { controlsListHTML } from './controlsList.js'

const STYLE = `
/* Above docking chrome (z 50–55) so pause works while docked. */
#pause-menu { position: fixed; inset: 0; background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b), 0.75); backdrop-filter: blur(2px); font-family: monospace; color: var(--ui-text); display: none; align-items: center; justify-content: center; z-index: 60; }
#pause-menu .panel {
  display: flex; flex-direction: column; gap: 10px; width: 300px; padding: 26px 28px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.95), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.9));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#pause-menu .panel.controls-view { width: min(460px, 92vw); max-height: min(80vh, 640px); }
#pause-menu .panel.settings-view,
#pause-menu .panel.ui-colour-view { width: min(360px, 92vw); }
#pause-menu h2 { margin: 0 0 14px 0; text-align: center; font-weight: normal; letter-spacing: 4px; text-transform: uppercase; color: var(--ui-accent); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#pause-menu button {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 11px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#pause-menu button:hover { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#pause-menu button.quit-title {
  background: rgba(255,180,60,0.12);
  border-color: rgba(255,190,70,0.55);
  color: #ffe08a;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
}
#pause-menu button.quit-title:hover {
  background: rgba(255,190,70,0.22);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#pause-menu button.quit { background: rgba(224,90,90,0.12); border-color: rgba(224,90,90,0.5); color: #ffb3b3; }
#pause-menu button.quit:hover { background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
${SETTINGS_VIEW_CSS}
#pause-menu .controls-list {
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; max-height: min(52vh, 420px);
  margin: 0 0 4px 0; padding-right: 4px;
}
#pause-menu .controls-list .row {
  display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: baseline;
  font-size: 12px; line-height: 1.35;
}
#pause-menu .controls-list .key {
  display: inline-block; padding: 2px 7px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-radius: 3px; color: var(--ui-key); background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1);
  font-size: 11px; letter-spacing: 0.5px; text-align: center; white-space: nowrap;
}
#pause-menu .controls-list .label { opacity: 0.85; color: var(--ui-text); }
`

export function createPauseMenu(container, { onResume, onSave, onRestart, onQuit }) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'pause-menu'
  root.innerHTML = `
    <div class="panel main-view">
      <h2>Paused</h2>
      <button class="resume">Resume</button>
      <button class="save">Save Game</button>
      <button class="controls">Show Controls</button>
      <button class="settings">Settings</button>
      <button class="quit-title">Quit to Title</button>
      <button class="quit">Quit to Desktop</button>
    </div>
    <div class="panel controls-view" style="display:none;">
      <h2>Controls</h2>
      <div class="controls-list">
        ${controlsListHTML()}
      </div>
      <button type="button" class="controls-back ui-btn-gold">Back</button>
    </div>
    <div class="panel settings-view" style="display:none;">
      ${settingsViewHTML()}
    </div>
    <div class="panel ui-colour-view" style="display:none;">
      ${uiColourViewHTML()}
    </div>
  `
  container.appendChild(root)

  const mainView = root.querySelector('.main-view')
  const controlsView = root.querySelector('.controls-view')
  const settingsView = root.querySelector('.settings-view')
  const uiColourView = root.querySelector('.ui-colour-view')

  function showMain() {
    mainView.style.display = 'flex'
    controlsView.style.display = 'none'
    settingsView.style.display = 'none'
    if (uiColourView) uiColourView.style.display = 'none'
  }

  function showControls() {
    mainView.style.display = 'none'
    controlsView.style.display = 'flex'
    settingsView.style.display = 'none'
    if (uiColourView) uiColourView.style.display = 'none'
  }

  function showSettings() {
    mainView.style.display = 'none'
    controlsView.style.display = 'none'
    settingsView.style.display = 'flex'
    if (uiColourView) uiColourView.style.display = 'none'
    settingsApi.refresh()
  }

  function showUiColour() {
    mainView.style.display = 'none'
    controlsView.style.display = 'none'
    settingsView.style.display = 'none'
    if (uiColourView) {
      uiColourView.style.display = 'flex'
      uiColourApi.refresh()
    }
  }

  function hide() {
    root.style.display = 'none'
    showMain()
  }

  const settingsApi = bindSettingsView(settingsView, {
    onBack: showMain,
    onShowControls: showControls,
    onShowUiColour: showUiColour
  })
  const uiColourApi = bindUiColourView(uiColourView, {
    onBack: showSettings
  })

  // pointerdown keeps the user-activation gesture for pointer lock (click can
  // be too late after hide/focus churn in Chromium/Electron).
  const resumeBtn = root.querySelector('.resume')
  let resumeArmed = false
  const doResume = () => {
    if (root.style.display === 'none') return
    if (resumeArmed) return
    resumeArmed = true
    onResume()
    // Allow a later open → Resume again.
    setTimeout(() => {
      resumeArmed = false
    }, 400)
  }
  resumeBtn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    doResume()
  })
  // Keyboard / accessibility (Enter on focused button)
  resumeBtn.addEventListener('click', (e) => {
    e.preventDefault()
    doResume()
  })
  root.querySelector('.save').addEventListener('click', () => onSave())
  root.querySelector('.controls').addEventListener('click', () => showControls())
  root.querySelector('.controls-back').addEventListener('click', () => showMain())
  root.querySelector('.settings').addEventListener('click', () => showSettings())
  root.querySelector('.quit-title').addEventListener('click', () => onRestart())
  root.querySelector('.quit').addEventListener('click', () => onQuit())

  return {
    show() {
      showMain()
      root.style.display = 'flex'
      // Focus Resume so Enter unpauses with a keyboard user-activation gesture.
      requestAnimationFrame(() => {
        try {
          resumeBtn.focus({ preventScroll: true })
        } catch {
          resumeBtn.focus?.()
        }
      })
    },
    hide,
    element: root
  }
}
