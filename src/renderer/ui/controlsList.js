/**
 * Shared control bindings for pause menu, intro Settings, and docs alignment.
 * Keep in sync with README Controls table when changing bindings.
 */
export const CONTROLS = [
  ['Space', 'Enter / exit mouse-aim flight mode'],
  ['Mouse', 'Aim (pitch & yaw) while in flight mode'],
  ['Alt + Mouse', 'Free-look — orbit chase camera around ship'],
  ['Alt + Enter', 'Toggle fullscreen'],
  ['W / S', 'Throttle forward / reverse (flight)'],
  ['A / D', 'Strafe left / right'],
  ['X / Z', 'Strafe up / down'],
  ['Q / E', 'Roll left / right'],
  ['LMB', 'Fire lasers'],
  ['RMB', 'Fire missiles'],
  ['Tab', 'Acquire / cycle target under crosshair'],
  ['Shift+Tab', 'Clear target lock'],
  ['Backspace', 'Clear target lock'],
  ['Ctrl+Tab', 'Set waypoint on body under crosshair'],
  ['C', 'Toggle supercruise (requires a waypoint)'],
  ['S', 'Station Services (docked only)'],
  ['M', 'Galaxy map (flight or docked; plot routes)'],
  ['B', 'System Scan (deploy probes, lock anomalies)'],
  ['F', 'Use targeted: warp gate jump · loot wreck · dock · hack datacore nodule'],
  ['P', 'Launch / use survey probe'],
  ['G', 'Launch drones (buy & equip from Shipyard Armoury)'],
  ['H', 'Recall drones to bay'],
  ['I', 'Inventory'],
  ['J', 'Missions'],
  ['F1', 'Character sheet'],
  ['Esc', 'Pause (Resume to continue)'],
  ['F5', 'Hail locked target'],
  ['Free mouse', 'Click system overview (right) to set waypoints']
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
