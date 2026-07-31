/**
 * Shared control bindings for pause menu, intro Settings, and docs alignment.
 * Keep in sync with README Controls table when changing bindings.
 */
export const CONTROLS = [
  ['Space', 'Take / leave the helm'],
  ['Mouse', 'Aim the turret — traverse and elevate the guns'],
  ['Mouse wheel', 'Chase-camera zoom'],
  ['Wheel on Overview', 'Scroll the body list'],
  ['Alt + Enter', 'Toggle fullscreen'],
  ['W / S', 'Ahead / astern; release to coast down'],
  ['S (alongside)', 'Open / close dockside Services'],
  ['A / D', 'Helm to port / starboard'],
  ['Q / E', 'Bow and stern thrusters — crab sideways to port / starboard'],
  ['LMB', 'Fire gun mounts (can hold with RMB)'],
  ['RMB', 'Fire launchers (can hold with LMB)'],
  ['Tab', 'Lock contact under crosshair / cycle nearby contacts'],
  ['Shift+Tab', 'Clear target lock'],
  ['Ctrl/Cmd+Tab', 'Clear target lock'],
  ['Backspace', 'Clear target lock'],
  ['C', 'Cruise Control — holds heading and speed; A/D steer; W/S/Q/E cancel'],
  ['M', 'Open the sea chart; pan, zoom and set a waypoint'],
  ['B', 'Region Sonar — deploy scan probes and investigate signals'],
  ['F', 'Use locked contact — salvage, dock or hack when in range'],
  ['P', 'Sonar pulse — survey a nearby island or wreck field'],
  ['G', 'Launch installed combat drones (requires drone bays and drones aboard)'],
  ['H', 'Recall combat drones'],
  ['L', 'Bow searchlight on / off'],
  ['I', 'Inventory'],
  ['J', 'Missions journal'],
  ['F1', 'Character sheet'],
  ['Esc', 'Pause / resume; back out of open panels'],
  ['F5', 'Hail locked target'],
  ['Free mouse', 'Click Overview / sea chart / Region Sonar to set waypoints; scroll Overview with the wheel']
]

/** CSS for a scrollable key/action list (scope under parent id). */
export const CONTROLS_LIST_CSS = `
.controls-list {
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; max-height: min(52vh, 420px);
  margin: 0 0 4px 0; padding-right: 4px;
}
.controls-list .row {
  display: grid; grid-template-columns: 140px 1fr; gap: 10px; align-items: baseline;
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
