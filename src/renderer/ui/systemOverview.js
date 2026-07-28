import { getSystem } from '../procgen/world.js'
import { missionMarkedBodyIds } from '../game/missions.js'
import { overviewAnomalies, isDatacoreType } from '../game/systemScan.js'
import { escapeHtml } from './escapeHtml.js'

const STYLE = `
/* Top right — target panel sits to the left when locked. */
#system-overview {
  position: fixed; top: 16px; right: 16px; bottom: auto; width: 240px;
  max-height: min(55vh, calc(100vh - 32px));
  z-index: 8; font-family: monospace; color: var(--ui-text); pointer-events: none;
  display: none;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.92), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.82));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-right: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow:
    0 2px 4px rgba(0,0,0,0.85),
    0 6px 14px rgba(0,0,0,0.55);
  filter: none;
}
#system-overview.visible { display: flex; flex-direction: column; }
/* Clickable only when not in flight-mode (Space to free the mouse). */
#system-overview.interactive { pointer-events: auto; z-index: 12; }
#system-overview .ov-head {
  padding: 6px 8px 5px; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  display: flex; justify-content: space-between; align-items: baseline; gap: 4px;
}
#system-overview .ov-title {
  font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ui-accent);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#system-overview .ov-hint {
  font-size: 8px; opacity: 0.55; letter-spacing: 0.3px; white-space: nowrap;
}
#system-overview.interactive .ov-hint { color: #7fe0a0; opacity: 0.85; }
#system-overview .ov-list {
  overflow-y: auto; flex: 1; padding: 2px 0; min-height: 0;
}
#system-overview .ov-row {
  display: grid; grid-template-columns: 1fr auto; gap: 4px 6px; align-items: center;
  padding: 4px 8px; font-size: 10px; border-left: 2px solid transparent;
  cursor: default; user-select: none;
}
#system-overview.interactive .ov-row { cursor: pointer; }
#system-overview.interactive .ov-row:hover {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1);
  border-left-color: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5);
}
#system-overview .ov-row.waypoint {
  color: #7fe0a0; border-left-color: #7fe0a0;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
}
#system-overview .ov-row.mission { color: #ffb07a; }
#system-overview .ov-row.warp { color: #ff5040; }
#system-overview .ov-row.anomaly { color: #d4a0ff; }
#system-overview .ov-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
}
#system-overview .ov-kind {
  grid-column: 1; font-size: 8px; letter-spacing: 0.4px; text-transform: uppercase; opacity: 0.5;
  margin-top: -2px;
}
#system-overview .ov-dist {
  grid-column: 2; grid-row: 1 / span 2; font-size: 9px; opacity: 0.75;
  font-variant-numeric: tabular-nums; align-self: center;
}
`

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function kindLabel(kind) {
  if (kind === 'wreckField') return 'wrecks'
  if (kind === 'port') return 'harbour'
  if (kind === 'anomaly') return 'signal'
  if (kind === 'alien_incursion') return 'raiders'
  if (kind === 'datacore') return 'datacore'
  if (kind === 'datacore_takeover') return 'takeover'
  if (kind === 'alien_datacore') return 'pre-war core'
  if (kind === 'ore_anomaly') return 'rich salvage'
  return kind
}

/**
 * System overview HUD: list of bodies in the current system.
 * Click (when interactive / not flight-mode) toggles a navigation waypoint.
 *
 * @param {HTMLElement} container
 * @param {object} gameState
 * @param {{
 *   canSetWaypoint?: () => boolean,
 *   onWaypointChange?: (payload: { id: string|null, name: string|null, set: boolean }) => void
 * }} [hooks]
 */
export function createSystemOverview(container, gameState, hooks = {}) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'system-overview'
  root.innerHTML = `
    <div class="ov-head">
      <span class="ov-title">Overview</span>
      <span class="ov-hint">Space · free mouse</span>
    </div>
    <div class="ov-list"></div>
  `
  container.appendChild(root)

  const listEl = root.querySelector('.ov-list')
  const hintEl = root.querySelector('.ov-hint')
  let interactive = false
  // Avoid full DOM rebuild every frame (that was killing click events).
  let lastStructureKey = ''
  let lastInteractive = false

  function formatDist(d) {
    if (d >= 10000) return `${(d / 1000).toFixed(1)}km`
    return `${Math.round(d)}m`
  }

  function bodyRows() {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (!system || !gameState?.player) return null
    const playerPos = gameState.player.ship.position
    const missionBodies = missionMarkedBodyIds(gameState, system.id)
    const anomalyRows = overviewAnomalies(system, gameState.galaxy).map((a) => ({
      id: a.id,
      name: a.displayName || 'Spatial Anomaly',
      kind: a.type === 'alien_incursion' ? 'alien_incursion' : isDatacoreType(a.type) ? a.type : 'anomaly',
      position: a.position,
      anomaly: true
    }))
    const rows = [
      // A rich salvage patch owns a synthetic wreckField body (see systemScan.js)
      // — it already gets a purple anomaly row above, so skip its plain row.
      ...system.bodies.filter((b) => !b.anomalySiteId).map((b) => ({
        id: b.id,
        name: b.name,
        kind: b.kind,
        position: b.position
      })),
      ...anomalyRows
    ]
      .map((r) => ({ ...r, d: dist3(playerPos, r.position) }))
      .sort((a, b) => a.d - b.d)
    return { system, rows, missionBodies }
  }

  function structureKey(rows, missionBodies) {
    const wp = gameState.player.waypointBodyId ?? ''
    const sysId = gameState.player.currentSystemId ?? ''
    const ids = rows.map((r) => r.id).join(',')
    const missions = [...missionBodies].sort().join(',')
    return `${sysId}|${wp}|${ids}|${missions}|${interactive ? 1 : 0}`
  }

  function renderFull() {
    const data = bodyRows()
    if (!data) {
      listEl.innerHTML = ''
      lastStructureKey = ''
      return
    }
    const { rows, missionBodies } = data
    lastStructureKey = structureKey(rows, missionBodies)

    listEl.innerHTML = rows
      .map((r) => {
        const isWp = gameState.player.waypointBodyId === r.id
        const isMission = missionBodies.has(r.id)
        const isWarp = r.kind === 'warpGate'
        const isAnomaly = !!r.anomaly
        const classes = [
          'ov-row',
          isWp ? 'waypoint' : '',
          isMission ? 'mission' : '',
          isWarp ? 'warp' : '',
          isAnomaly ? 'anomaly' : ''
        ]
          .filter(Boolean)
          .join(' ')
        return `<div class="${classes}" data-id="${escapeHtml(r.id)}" title="${escapeHtml(r.name)} · ${escapeHtml(kindLabel(r.kind))}">
          <span class="ov-name">${escapeHtml(r.name)}${isMission ? ' ·' : ''}</span>
          <span class="ov-dist">${formatDist(r.d)}</span>
          <span class="ov-kind">${escapeHtml(kindLabel(r.kind))}</span>
        </div>`
      })
      .join('')
  }

  /** Patch distances only — keeps row nodes stable for pointer events. */
  function updateDistances() {
    const data = bodyRows()
    if (!data) return
    const { rows, missionBodies } = data
    const key = structureKey(rows, missionBodies)
    if (key !== lastStructureKey) {
      renderFull()
      return
    }
    const distById = new Map(rows.map((r) => [r.id, r.d]))
    listEl.querySelectorAll('.ov-row').forEach((row) => {
      const d = distById.get(row.dataset.id)
      if (d == null) return
      const el = row.querySelector('.ov-dist')
      if (el) el.textContent = formatDist(d)
    })
  }

  function toggleWaypoint(id) {
    if (!id || !gameState?.player) return
    let name = null
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    name = system?.bodies.find((b) => b.id === id)?.name ?? 'Waypoint'

    if (gameState.player.waypointBodyId === id) {
      // Clear is always allowed (including during supercruise).
      gameState.player.waypointBodyId = null
      gameState.player.waypointPosition = null
      hooks.onWaypointChange?.({ id: null, name, set: false })
    } else {
      // A new waypoint would redirect the autopilot mid-passage — blocked under way.
      if (hooks.canSetWaypoint && !hooks.canSetWaypoint()) return
      gameState.player.waypointBodyId = id
      gameState.player.waypointPosition = null
      hooks.onWaypointChange?.({ id, name, set: true })
    }
    renderFull()
  }

  // Event delegation: stable parent survives distance-only updates.
  // pointerdown (not click) so a frame rebuild can't cancel mousedown→mouseup.
  listEl.addEventListener(
    'pointerdown',
    (e) => {
      if (!interactive) return
      if (e.button !== 0) return
      const row = e.target.closest?.('.ov-row')
      if (!row || !listEl.contains(row)) return
      e.preventDefault()
      e.stopPropagation()
      toggleWaypoint(row.dataset.id)
    },
    true
  )

  return {
    element: root,
    show() {
      root.classList.add('visible')
      if (!lastStructureKey) renderFull()
      else updateDistances()
    },
    hide() {
      root.classList.remove('visible')
      root.classList.remove('interactive')
      interactive = false
      lastInteractive = false
    },
    /** @param {boolean} canClick - true when mouse is free (not flight-mode) */
    setInteractive(canClick) {
      const next = !!canClick
      if (next === lastInteractive && next === interactive) return
      interactive = next
      lastInteractive = next
      root.classList.toggle('interactive', interactive)
      hintEl.textContent = interactive ? 'Click · waypoint' : 'Space · free mouse'
    },
    update() {
      if (!root.classList.contains('visible')) return
      updateDistances()
    }
  }
}
