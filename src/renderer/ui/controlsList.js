/**
 * Shared control bindings for pause menu, intro Settings, and docs alignment.
 * Keep in sync with README Controls table when changing bindings.
 */
export const CONTROLS = [
  ['Space', 'Take / leave the helm'],
  ['Mouse', 'Lay the gun — traverse and elevate the turret'],
  ['MMB', 'Free the mouse for menus (helm stays yours) — click again to take the gun back'],
  ['Alt + Enter', 'Toggle fullscreen'],
  ['W / S', 'Ahead / astern'],
  ['A / D', 'Helm to port / starboard'],
  ['Q / E', 'Thrusters — crab sideways to port / starboard (works stopped, for coming alongside)'],
  ['LMB', 'Fire guns — deck guns, autocannon, catapults'],
  ['RMB', 'Fire launchers — harpoons, torpedoes, depth charges'],
  ['Tab', 'Acquire / cycle target under crosshair'],
  ['Shift+Tab', 'Clear target lock'],
  ['Backspace', 'Clear target lock'],
  ['Ctrl+Tab', 'Set waypoint under the crosshair (any distance, if on screen)'],
  ['C', 'Toggle open-sea cruise (requires a waypoint)'],
  ['S', 'Services (alongside only)'],
  ['M', 'Sea chart'],
  ['B', 'Region Sonar Scan (deploy drones, run down signals)'],
  ['F', 'Use targeted: salvage wreck · come alongside · crack a datacore'],
  ['P', 'Sonar pulse (sound the water)'],
  ['G', 'Launch support drones (buy & fit at the Boatyard Armoury)'],
  ['H', 'Recall support drones'],
  ['I', 'Hold'],
  ['J', 'Missions journal'],
  ['F1', 'Character sheet'],
  ['Esc', 'Pause (Resume to continue)'],
  ['F5', 'Hail locked target'],
  ['Free mouse', 'Click the contacts list (right) to set waypoints']
]

/** CSS for a scrollable key/action list (scope under parent id). */
export const CONTROLS_LIST_CSS = `
.controls-list {
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; max-height: min(52vh, 420px);
  margin: 0 0 4px 0; padding-right: 4px;
}
.controls-list .row {
  display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: baseline;
  font-size: 12px; line-height: 1.35;
}
.controls-list .key {
  display: inline-block; padding: 2px 7px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-radius: 3px; color: var(--ui-key); background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1);
  font-size: 11px; letter-spacing: 0.5px; text-align: center; white-space: nowrap;
}
.controls-list .label { opacity: 0.85; color: var(--ui-text); }
`

export function controlsListHTML() {
  return CONTROLS.map(
    ([key, label]) =>
      `<div class="row"><span class="key">${key}</span><span class="label">${label}</span></div>`
  ).join('')
}
