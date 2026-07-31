import {
  SETTINGS_VIEW_CSS,
  settingsViewHTML,
  soundVolumeViewHTML,
  uiColourViewHTML,
  bindSettingsView,
  bindSoundVolumeView,
  bindUiColourView
} from './settingsView.js'
import { controlsListHTML } from './controlsList.js'

const STYLE = `
/* Above docking chrome (z 50–55) so pause works while docked. */
#pause-menu { position: fixed; inset: 0; background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b), 0.75); backdrop-filter: blur(2px); font-family: monospace; color: var(--ui-text); display: none; align-items: center; justify-content: center; z-index: 60; }
#pause-menu .panel {
  display: flex; flex-direction: column; gap: 10px; width: 340px; padding: 26px 28px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.95), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.9));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#pause-menu .panel.controls-view { width: min(460px, 92vw); max-height: min(80vh, 640px); }
#pause-menu .panel.settings-view,
#pause-menu .panel.sound-volume-view,
#pause-menu .panel.ui-colour-view { width: min(360px, 92vw); }
#pause-menu h2 {
  margin: 0 0 14px 0; text-align: center; font-weight: normal;
  letter-spacing: 0.5px; line-height: 1.35; font-size: 13px;
  text-transform: none; color: var(--ui-accent);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#pause-menu .main-view h2.pause-pun {
  min-height: 2.7em; display: flex; align-items: center; justify-content: center;
}
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

/** Taking a break at sea while there's work outstanding. */
const PAUSE_PUNS = [
  'Holding station while the cargo looks at you.',
  'The sea doesn’t pause. You do.',
  'All ahead… later.',
  'Dropped the hook. The jobs didn’t.',
  'Taking five. The chart still wants a course.',
  'Idle screws. Busy conscience.',
  'Standing by. The contracts are standing by harder.',
  'You’re not adrift. You’re on break. There’s a difference.',
  'Engine room silent. The to-do list isn’t.',
  'Moored to the moment. Untied from the work.',
  'Dead in the water, on purpose, with unfinished business.',
  'Coffee break at sea. No coffee. Still work.',
  'Heaving to while the log says “things to do.”',
  'Paused the ship. Not the invoices.',
  'Time and tide wait for no one. You made them wait.',
  'Laying off the throttle. The missions didn’t get the memo.',
  'Secure from labour. Temporarily. Allegedly.',
  'Taking soundings of your own patience.',
  'On the hard for a moment. Metaphorically. You’re still afloat.',
  'The bilge still needs pumping. Just… not this second.',
  'Hands idle. Hold full of unfulfilled promises.',
  'Breakwater? More like break-from-water-work.',
  'Anchored in denial while the radar spins on.',
  'You can rest. The wreck fields can’t leave.',
  'Full stop. The harbour still expects you yesterday.',
  'Drifting on purpose. The market doesn’t care.',
  'Sails furled. Ambition: not so much.',
  'Parked. Professionally. The pirates didn’t get the memo.',
  'Between watches, between jobs, between excuses.',
  'The helm is yours. You’re giving it a moment.',
  'Not lost. Just… not underway.',
  'Sonar quiet. Your list of errands isn’t.',
  'Riding the swell of procrastination.',
  'Slow ahead to nowhere. Perfect.',
  'The log will say “administrative pause.” Believe that if you like.',
  'Casting off later. Much later.',
  'You’ve struck for a break. The sea has not struck with you.',
  'Holding pattern over unfinished business.',
  'Reefed the effort. Left the obligations flying.',
  'A brief shore leave. Without the shore.',
  'The engine cools. The debt doesn’t.',
  'At rest. The salvage rights are not.',
  'You’ve put the war on hold. Kind of you.',
  'Midships of a mid-day nap. Metaphorically.',
  'The barometer is falling. Your motivation already has.',
  'Standing easy while the chart stands ready.',
  'You’ve heaved to. The contracts remain hove up.',
  'Not abandoning ship. Abandoning productivity.',
  'A tactical pause. The tactics can wait.',
  'The lookout is still looking. You’re looking at nothing.',
  'You’ve secured for tea. There is no tea. There is still work.',
  'Leeward of responsibility for a few minutes.',
  'The tide waits for no one. You made it queue.',
  'Ballast of guilt: steady. Propulsion: off.',
  'You’ve dropped out of the convoy of busy captains.',
  'Making way… for a sit-down.',
  'The sea is patient. Your clients less so.',
  'You’ve taken a sounding of the pause menu. Deep enough.',
  'Not under command. Under a break.',
  'The radar paints targets. You’re painting over them with rest.',
  'You’ve reefed the schedule. Smart seamanship.',
  'Between storms. Between jobs. Between good decisions.',
  'All stop. All still owed.',
  'You’re free to manoeuvre. You’re choosing not to.',
  'The bilge pump rests. Your reputation does not.',
  'You’ve made fast to the moment. Cast off when ready.',
  'A lull in the labour. The labour has opinions.',
  'You’ve stood down. The drowneds are still standing up.',
  'Course: undecided. Purpose: delayed.',
  'You’ve put the screw in neutral. The world in motion.',
  'Briefly unburdened. Still very much burdened.',
  'The watch changes. You’re off watch from effort.',
  'You’ve found a lee. From work, not weather.',
  'Paused like a good tide table: temporary, inevitable, slightly rude.'
]

function pickPausePun() {
  return PAUSE_PUNS[Math.floor(Math.random() * PAUSE_PUNS.length)]
}

export function createPauseMenu(container, { onResume, onSave, onRestart, onQuit }) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'pause-menu'
  root.innerHTML = `
    <div class="panel main-view">
      <h2 class="pause-pun">Paused</h2>
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
    <div class="panel sound-volume-view" style="display:none;">
      ${soundVolumeViewHTML()}
    </div>
    <div class="panel ui-colour-view" style="display:none;">
      ${uiColourViewHTML()}
    </div>
  `
  container.appendChild(root)

  const mainView = root.querySelector('.main-view')
  const pausePunEl = root.querySelector('.pause-pun')
  const controlsView = root.querySelector('.controls-view')
  const settingsView = root.querySelector('.settings-view')
  const soundVolumeView = root.querySelector('.sound-volume-view')
  const uiColourView = root.querySelector('.ui-colour-view')

  function showMain() {
    mainView.style.display = 'flex'
    controlsView.style.display = 'none'
    settingsView.style.display = 'none'
    if (soundVolumeView) soundVolumeView.style.display = 'none'
    if (uiColourView) uiColourView.style.display = 'none'
  }

  function showControls() {
    mainView.style.display = 'none'
    controlsView.style.display = 'flex'
    settingsView.style.display = 'none'
    if (soundVolumeView) soundVolumeView.style.display = 'none'
    if (uiColourView) uiColourView.style.display = 'none'
  }

  function showSettings() {
    mainView.style.display = 'none'
    controlsView.style.display = 'none'
    settingsView.style.display = 'flex'
    if (soundVolumeView) soundVolumeView.style.display = 'none'
    if (uiColourView) uiColourView.style.display = 'none'
    settingsApi.refresh()
  }

  function showSoundVolume() {
    mainView.style.display = 'none'
    controlsView.style.display = 'none'
    settingsView.style.display = 'none'
    if (soundVolumeView) {
      soundVolumeView.style.display = 'flex'
      soundVolumeApi.refresh()
    }
    if (uiColourView) uiColourView.style.display = 'none'
  }

  function showUiColour() {
    mainView.style.display = 'none'
    controlsView.style.display = 'none'
    settingsView.style.display = 'none'
    if (soundVolumeView) soundVolumeView.style.display = 'none'
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
    onShowSoundVolume: showSoundVolume,
    onShowControls: showControls,
    onShowUiColour: showUiColour
  })
  const soundVolumeApi = bindSoundVolumeView(soundVolumeView, {
    onBack: showSettings
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
      if (pausePunEl) pausePunEl.textContent = pickPausePun()
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
    /**
     * Esc while paused: pop sub-panels (controls / settings) first.
     * @returns {boolean} true if a sub-panel was closed (Esc consumed).
     */
    handleEscape() {
      if (mainView.style.display === 'none') {
        showMain()
        return true
      }
      return false
    },
    element: root
  }
}
