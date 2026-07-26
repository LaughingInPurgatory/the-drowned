import { getSystem, canJumpTo, findHyperspaceRoute, ensureSystemSecurity } from '../procgen/galaxy.js'
import { getSystemSecurity } from '../game/security.js'
import { missionMarkedSystemIds } from '../game/missions.js'
import { playerAssetSystemIds } from '../game/economy.js'
import { shipHasAutopilot } from '../data/accessories.js'
import { escapeHtml } from './escapeHtml.js'
import {
  defaultPanelGeom,
  floatingPanelElevationCss,
  floatingResizeHandleCss,
  wireFloatingPanel
} from './floatingPanel.js'
import { getUiPalette } from './uiTheme.js'

const GEOM_LS_KEY = 'witv.galaxyMapPanel'

const STYLE = `
/* Dim scrim; panel free-floating (move / resize, geometry remembered).
   z-index above docking (50) so the map opens while docked. */
#nav-map {
  position: fixed; inset: 0; z-index: 58; display: none;
  background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b), 0.55);
  backdrop-filter: blur(2px);
  font-family: monospace; color: var(--ui-text);
  box-sizing: border-box;
  pointer-events: auto;
}
#nav-map .panel {
  position: fixed;
  display: flex; flex-direction: column;
  overflow: hidden;
  padding: 12px 16px;
  min-width: 420px; min-height: 300px;
  background: rgba(4,8,16,0.96);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  border-right: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
  box-sizing: border-box;
}
${floatingPanelElevationCss('#nav-map .panel')}
#nav-map h2 { font-weight: normal; letter-spacing: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); margin: 0; font-size: 15px; }
#nav-map h3 { font-weight: normal; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--ui-accent); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); margin: 0 0 8px 0; }
#nav-map .header {
  display: flex; justify-content: space-between; align-items: center; gap: 12px;
  margin-bottom: 10px; flex-shrink: 0;
  padding-bottom: 8px; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  cursor: grab; user-select: none; touch-action: none;
}
#nav-map .header.dragging { cursor: grabbing; }
#nav-map .header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
#nav-map .header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; cursor: default; }
#nav-map .sys-search {
  width: min(200px, 28vw);
  box-sizing: border-box;
  font-family: monospace; font-size: 12px; letter-spacing: 0.4px;
  padding: 6px 10px;
  color: var(--ui-bright);
  background: rgba(8,14,24,0.9);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  border-right: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  outline: none;
}
#nav-map .sys-search::placeholder { color: rgba(180,210,240,0.4); }
#nav-map .sys-search:focus {
  border-color: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.7);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#nav-map .sys-search.match {
  border-color: rgba(127,224,160,0.65);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#nav-map .sys-search.nomatch:not(:placeholder-shown) {
  border-color: rgba(224,90,90,0.55);
}
#nav-map button.close {
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5); color: #ffb3b3;
  padding: 6px 14px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#nav-map button.close:hover { background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#nav-map .tab-content { flex: 1; min-height: 0; display: flex; flex-direction: column; }
#nav-map .galaxy-body {
  flex: 1; display: flex; gap: 12px; min-height: 0; position: relative; align-items: stretch;
}
#nav-map .map-canvas-wrap {
  flex: 1; min-width: 0; min-height: 0; position: relative;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(ellipse at center, #0a1428 0%, #040810 70%);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
}
#nav-map canvas {
  background: #05070d; border: none; cursor: crosshair;
  display: block; max-width: 100%; max-height: 100%;
}
#nav-map .map-hint {
  position: absolute; left: 10px; bottom: 8px; font-size: 10px; letter-spacing: 0.4px;
  color: rgba(180,210,240,0.65); pointer-events: none; font-family: monospace;
}
#nav-map .map-tooltip {
  position: absolute; pointer-events: none; font-size: 11px; color: var(--ui-bright);
  background: rgba(10,14,24,0.92); border: 1px solid rgba(94,230,255,0.5); padding: 4px 9px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
  white-space: nowrap; display: none; transform: translate(-50%, -130%); z-index: 2;
}
#nav-map .info-panel {
  width: 240px; flex-shrink: 0; overflow-y: auto; min-height: 0;
  padding-left: 2px;
}
#nav-map .info-panel .stat { margin-bottom: 4px; font-size: 13px; opacity: 0.9; }
#nav-map .info-panel .stat.route-hint { color: #ffe08a; opacity: 0.95; margin-top: 6px; font-size: 12px; }
#nav-map button.engage-ap {
  background: rgba(127,224,160,0.12); border: 1px solid rgba(127,224,160,0.5); color: #bdf5cf;
  padding: 9px 16px; cursor: pointer; margin-top: 12px; width: 100%; font-family: monospace;
  letter-spacing: 1px; transition: background 0.15s ease, box-shadow 0.15s ease;
}
#nav-map button.engage-ap:not(:disabled):hover { background: rgba(127,224,160,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#nav-map button.engage-ap:disabled { opacity: 0.35; cursor: not-allowed; }
#nav-map button.engage-ap[data-mode="cancel"] {
  background: rgba(224,90,90,0.12); border-color: rgba(224,90,90,0.55); color: #ffb3b3;
}
#nav-map button.engage-ap[data-mode="cancel"]:not(:disabled):hover {
  background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#nav-map button.plot-route {
  background: rgba(255,210,70,0.12); border: 1px solid rgba(255,210,70,0.55); color: #ffe08a;
  padding: 9px 16px; cursor: pointer; margin-top: 8px; width: 100%; font-family: monospace;
  letter-spacing: 1px; transition: background 0.15s ease, box-shadow 0.15s ease;
}
#nav-map button.plot-route:not(:disabled):hover { background: rgba(255,210,70,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#nav-map button.plot-route:disabled { opacity: 0.35; cursor: not-allowed; }
#nav-map button.clear-route {
  background: rgba(224,90,90,0.1); border: 1px solid rgba(224,90,90,0.4); color: #ffb3b3;
  padding: 6px 12px; cursor: pointer; margin-top: 8px; width: 100%; font-family: monospace;
  font-size: 11px; letter-spacing: 1px;
}
#nav-map button.clear-route:hover { background: rgba(224,90,90,0.2); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#nav-map .route-panel {
  margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,210,70,0.25);
}
#nav-map .route-panel h3 { color: #ffe08a; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#nav-map .route-panel .route-empty { font-size: 12px; opacity: 0.5; line-height: 1.4; }
#nav-map .route-list {
  list-style: none; margin: 0; padding: 0; max-height: 140px; overflow-y: auto;
}
#nav-map .route-list li {
  display: flex; align-items: baseline; gap: 8px; padding: 6px 8px; margin-bottom: 3px;
  font-size: 12px; background: rgba(255,210,70,0.06); border-left: 2px solid rgba(255,210,70,0.35);
}
#nav-map .route-list li.next {
  background: rgba(255,210,70,0.14); border-left-color: #ffd246;
  color: #ffe8a8; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#nav-map .route-list li.dest { border-left-color: #ffb347; }
#nav-map .route-list .hop { opacity: 0.55; font-size: 10px; min-width: 1.5em; }
#nav-map .route-list .name { flex: 1; }
#nav-map .route-list .tag {
  font-size: 9px; letter-spacing: 1px; text-transform: uppercase; opacity: 0.7; color: #ffe08a;
}
#nav-map table { width: 100%; border-collapse: collapse; }
#nav-map th { text-align: left; padding: 6px 8px; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ui-dim); font-weight: normal; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3); }
#nav-map td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(42,58,85,0.5); font-size: 13px; }
#nav-map tbody tr:hover td { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.05); }
#nav-map td.body-name { display: flex; align-items: center; gap: 6px; }
#nav-map button.waypoint {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 3px 9px; cursor: pointer; font-family: monospace; transition: background 0.15s ease, box-shadow 0.15s ease;
}
#nav-map button.waypoint:hover { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#nav-map tr.active-waypoint td { color: #7fe0a0; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#nav-map tr.mission-marker td { color: #ffb07a; }
#nav-map tr.mission-marker td.body-name { text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#nav-map .mission-tag {
  font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
  color: #ff8a3d; margin-left: 4px; opacity: 0.9;
}
${floatingResizeHandleCss('#nav-map .float-resize')}
`

// Small per-kind glyphs (not emoji) so the system-body list reads at a
// glance without needing to read the "Kind" column — a filled circle for
// planets, a smaller dim one for moons, a square for stations/settlements
// (settlement dimmer, matching its render/collision size being smaller),
// and a little cluster of dots for asteroid fields (echoing how they
// actually render as scattered rocks).
const BODY_ICONS = {
  planet: '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="var(--ui-key)"/></svg>',
  moon: '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.5" fill="#9aa8bd"/></svg>',
  station: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="var(--ui-accent)"/></svg>',
  settlement: '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" fill="#c2a35c"/></svg>',
  asteroidField: '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="3" cy="4" r="2" fill="#8a8172"/><circle cx="8" cy="3" r="1.4" fill="#8a8172"/><circle cx="7" cy="8" r="2.2" fill="#8a8172"/></svg>',
  star: '<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="#ffe066"/><circle cx="6" cy="6" r="5.5" fill="none" stroke="#ffb347" stroke-width="0.8" opacity="0.7"/></svg>'
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

export function createNavMap(container, gameState) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'nav-map'
  root.innerHTML = `
    <div class="panel">
      <div class="header">
        <div class="header-left">
          <h2>Galaxy Map</h2>
        </div>
        <div class="header-right">
          <input type="search" class="sys-search" placeholder="Search system…" autocomplete="off" spellcheck="false" />
          <button type="button" class="close">Close</button>
        </div>
      </div>
      <div class="tab-content"></div>
      <div class="float-resize" title="Resize" aria-label="Resize galaxy map"></div>
    </div>
  `
  container.appendChild(root)

  const panelEl = root.querySelector('.panel')
  const headerEl = root.querySelector('.header')
  const contentEl = root.querySelector('.tab-content')
  const searchInput = root.querySelector('.sys-search')
  let mapOpen = false
  let selectedSystemId = null
  let hoveredSystemId = null
  // Camera: center (galaxy XZ) + half-extent radius shown on canvas.
  let mapView = { cx: 0, cz: 0, radius: 400 }
  /** Systems visible at default zoom (local neighborhood). */
  const DEFAULT_VIEW_SYSTEM_CAP = 50
  const mapKeys = new Set()
  let mapPanRaf = 0
  /** Latest draw() from the open galaxy tab (for WASD pan redraws). */
  let redrawMap = null
  /** Latest updateInfoPanel from open galaxy tab (search select refresh). */
  let refreshInfoPanel = null

  const floating = wireFloatingPanel({
    panelEl,
    headerEl,
    resizeEl: root.querySelector('.float-resize'),
    storageKey: GEOM_LS_KEY,
    minW: 420,
    minH: 300,
    isActive: () => mapOpen,
    onGeomChange: () => {
      // Canvas fit after panel size changes.
      requestAnimationFrame(() => redrawMap?.())
    },
    defaultGeom: () =>
      defaultPanelGeom({
        fracW: 0.6,
        fracH: 0.6,
        maxW: 1100,
        maxH: 720,
        minW: 420,
        minH: 300,
        align: 'center'
      })
  })

  /**
   * Best name match for query: exact → prefix → substring (case-insensitive).
   * @returns {object|null} system
   */
  function findSystemByNameQuery(query) {
    const q = String(query ?? '').trim().toLowerCase()
    if (!q) return null
    const systems = gameState.galaxy?.systems ?? []
    let exact = null
    let prefix = null
    let contains = null
    for (const s of systems) {
      const name = String(s.name ?? '').toLowerCase()
      if (!name) continue
      if (name === q) {
        exact = s
        break
      }
      if (!prefix && name.startsWith(q)) prefix = s
      else if (!contains && name.includes(q)) contains = s
    }
    return exact ?? prefix ?? contains
  }

  /** Center camera on a system (keep current zoom). */
  function centerMapOnSystem(system) {
    if (!system?.galaxyPosition) return
    mapView.cx = system.galaxyPosition[0]
    mapView.cz = system.galaxyPosition[2]
    selectedSystemId = system.id
    redrawMap?.()
    refreshInfoPanel?.()
  }

  function applySystemSearch() {
    const q = searchInput.value
    searchInput.classList.remove('match', 'nomatch')
    if (!String(q).trim()) return
    const hit = findSystemByNameQuery(q)
    if (hit) {
      searchInput.classList.add('match')
      centerMapOnSystem(hit)
    } else {
      searchInput.classList.add('nomatch')
    }
  }

  searchInput.addEventListener('input', () => applySystemSearch())
  searchInput.addEventListener('keydown', (e) => {
    // Keep typing keys out of game/WASD handlers.
    e.stopPropagation()
    if (e.code === 'Escape') {
      e.preventDefault()
      searchInput.value = ''
      searchInput.classList.remove('match', 'nomatch')
      searchInput.blur()
      return
    }
    if (e.code === 'Enter') {
      e.preventDefault()
      applySystemSearch()
    }
  })
  searchInput.addEventListener('keyup', (e) => e.stopPropagation())

  function renderGalaxyTab() {
    const systems = gameState.galaxy.systems
    const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const galaxyMaxRadius =
      Math.max(...systems.map((s) => Math.hypot(s.galaxyPosition[0], s.galaxyPosition[2])), 1) * 1.1
    const byId = new Map(systems.map((s) => [s.id, s]))

    // Default camera: centered on current system, zoomed so ~50 systems fit.
    {
      const cx = currentSystem.galaxyPosition[0]
      const cz = currentSystem.galaxyPosition[2]
      const dists = systems
        .map((s) => Math.hypot(s.galaxyPosition[0] - cx, s.galaxyPosition[2] - cz))
        .sort((a, b) => a - b)
      const k = Math.min(DEFAULT_VIEW_SYSTEM_CAP, dists.length) - 1
      const localR = Math.max(120, (dists[k] ?? 400) * 1.12)
      mapView = { cx, cz, radius: localR }
    }
    const minViewRadius = Math.max(80, galaxyMaxRadius * 0.02)
    const maxViewRadius = galaxyMaxRadius

    contentEl.innerHTML = `
      <div class="galaxy-body">
        <div class="map-canvas-wrap">
          <canvas width="640" height="640"></canvas>
          <div class="map-tooltip"></div>
          <div class="map-hint">Scroll zoom · WASD pan · default ~${DEFAULT_VIEW_SYSTEM_CAP} systems</div>
        </div>
        <div class="info-panel">
          <h3 class="sel-name">—</h3>
          <div class="stat sel-security"></div>
          <div class="stat sel-bodies"></div>
          <div class="stat sel-distance"></div>
          <div class="stat route-hint"></div>
          <button class="engage-ap" disabled>Engage Autopilot</button>
          <button class="plot-route" disabled>Plot Route</button>
          <div class="route-panel">
            <h3>Plotted Route</h3>
            <div class="route-list-wrap"></div>
          </div>
          <div class="map-legend" style="margin-top:12px;padding-top:8px;border-top:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);font-size:10px;line-height:1.5;opacity:0.75;">
            <div><span style="color:rgba(120,190,230,0.9);">—</span> Cyan — warp gate lanes</div>
            <div><span style="color:#ffd246;">—</span> Yellow — plotted route</div>
            <div><span style="color:#ff8a3d;">○</span> Orange — mission objective</div>
            <div><span style="color:#50dc78;">○</span> Green — stored assets in another system</div>
          </div>
        </div>
      </div>
    `
    const canvasWrap = contentEl.querySelector('.map-canvas-wrap')
    const canvas = contentEl.querySelector('canvas')
    const ctx = canvas.getContext('2d')
    const tooltipEl = contentEl.querySelector('.map-tooltip')
    const margin = 16
    let size = canvas.width
    let half = size / 2 - margin

    /** Fit square canvas into the map wrap (panel is ~60% of viewport). */
    function syncCanvasSize() {
      const availW = Math.max(160, canvasWrap.clientWidth - 4)
      const availH = Math.max(160, canvasWrap.clientHeight - 4)
      const s = Math.max(160, Math.floor(Math.min(availW, availH)))
      if (s === size && canvas.width === s) return false
      size = s
      half = size / 2 - margin
      canvas.width = size
      canvas.height = size
      return true
    }
    syncCanvasSize()
    // Shared by draw() (rings/dots) and the hover tooltip — must live outside
    // draw so mousemove can see it (was ReferenceError: missionSystems).
    const missionSystems = missionMarkedSystemIds(gameState)
    // Remote systems with stored ships/cargo/etc. (not the current system).
    const assetSystems = playerAssetSystemIds(gameState)

    function clampViewRadius(r) {
      return Math.min(maxViewRadius, Math.max(minViewRadius, r))
    }

    /** Galaxy XZ → canvas pixels (camera-relative). */
    function toCanvas(pos) {
      return [
        size / 2 + ((pos[0] - mapView.cx) / mapView.radius) * half,
        size / 2 + ((pos[2] - mapView.cz) / mapView.radius) * half
      ]
    }

    function canvasPointFromEvent(e) {
      const rect = canvas.getBoundingClientRect()
      const sx = canvas.width / Math.max(1, rect.width)
      const sy = canvas.height / Math.max(1, rect.height)
      return [(e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy]
    }

    /** True if galaxy point is near the visible square (for culling). */
    function inView(pos, pad = 1.15) {
      const dx = Math.abs(pos[0] - mapView.cx) / mapView.radius
      const dz = Math.abs(pos[2] - mapView.cz) / mapView.radius
      return dx <= pad && dz <= pad
    }

    function remainingRoute() {
      const r = gameState.player.plottedRoute
      return Array.isArray(r) && r.length ? r : null
    }

    /** Next hop on the plotted route (must be a hyperspace neighbor). */
    function nextRouteHopId() {
      const rem = remainingRoute()
      if (!rem?.length) return null
      const hop = rem[0]
      return canJumpTo(currentSystem, hop) ? hop : null
    }

    /** Full path ids for drawing: current + remaining hops. */
    function plottedPathIds() {
      const rem = remainingRoute()
      if (!rem) return null
      return [currentSystem.id, ...rem]
    }

    function pathToSelected() {
      if (!selectedSystemId || selectedSystemId === currentSystem.id) return null
      return findHyperspaceRoute(gameState.galaxy, currentSystem.id, selectedSystemId)
    }

    // With an active route, default selection to the next hop on the path.
    {
      const hop = nextRouteHopId()
      if (hop) selectedSystemId = hop
    }

    function drawPath(pathIds, { color, lineWidth = 2.5, dashed = false } = {}) {
      if (!pathIds || pathIds.length < 2) return
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      if (dashed) ctx.setLineDash([6, 5])
      else ctx.setLineDash([])
      ctx.shadowColor = color
      ctx.shadowBlur = dashed ? 6 : 10
      ctx.beginPath()
      for (let i = 0; i < pathIds.length; i++) {
        const sys = byId.get(pathIds[i])
        if (!sys) continue
        const [x, y] = toCanvas(sys.galaxyPosition)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.setLineDash([])
      ctx.restore()
    }

    function draw() {
      syncCanvasSize()
      ctx.clearRect(0, 0, size, size)

      // Soft core glow — projected so it stays fixed in galaxy space.
      const [coreX, coreY] = toCanvas([0, 0, 0])
      const corePx = (galaxyMaxRadius * 0.35 / mapView.radius) * half
      if (corePx > 4) {
        const glow = ctx.createRadialGradient(coreX, coreY, 0, coreX, coreY, corePx)
        glow.addColorStop(0, 'rgba(143,179,255,0.18)')
        glow.addColorStop(0.45, 'rgba(94,150,230,0.07)')
        glow.addColorStop(1, 'rgba(94,150,230,0)')
        ctx.fillStyle = glow
        ctx.fillRect(0, 0, size, size)
      } else {
        ctx.fillStyle = 'rgba(20,30,50,0.35)'
        ctx.fillRect(0, 0, size, size)
      }

      // Lanes: only if at least one endpoint is in the padded view.
      ctx.save()
      ctx.strokeStyle = 'rgba(100, 190, 230, 0.28)'
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
      const drawnLanes = new Set()
      const pad = 1.25
      for (const system of systems) {
        const aIn = inView(system.galaxyPosition, pad)
        for (const neighborId of system.neighborIds ?? []) {
          const a = String(system.id)
          const b = String(neighborId)
          const key = a < b ? `${a}|${b}` : `${b}|${a}`
          if (drawnLanes.has(key)) continue
          drawnLanes.add(key)
          const neighbor = byId.get(neighborId)
          if (!neighbor) continue
          if (!aIn && !inView(neighbor.galaxyPosition, pad)) continue
          const [x0, y0] = toCanvas(system.galaxyPosition)
          const [x1, y1] = toCanvas(neighbor.galaxyPosition)
          ctx.beginPath()
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
          ctx.stroke()
        }
      }
      // Highlight lanes from the current system (brighter cyan).
      const [curCx, curCy] = toCanvas(currentSystem.galaxyPosition)
      ctx.strokeStyle = 'rgba(120, 230, 255, 0.75)'
      ctx.lineWidth = 1.6
      ctx.shadowColor = 'rgba(94,230,255,0.5)'
      ctx.shadowBlur = 6
      for (const neighborId of currentSystem.neighborIds ?? []) {
        const neighbor = byId.get(neighborId)
        if (!neighbor) continue
        const [nx, ny] = toCanvas(neighbor.galaxyPosition)
        ctx.beginPath()
        ctx.moveTo(curCx, curCy)
        ctx.lineTo(nx, ny)
        ctx.stroke()
      }
      ctx.shadowBlur = 0
      ctx.restore()

      // Plotted multi-hop route — solid yellow through every system on the path.
      const plotted = plottedPathIds()
      if (plotted && plotted.length > 1) {
        drawPath(plotted, { color: 'rgba(255, 210, 70, 0.98)', lineWidth: 3.25 })
      }

      // Selecting a system previews the shortest warp path (dashed if a different
      // plotted route is already active; solid yellow when no route plotted).
      const preview = pathToSelected()
      if (preview && preview.length > 1) {
        const sameAsPlotted =
          plotted &&
          plotted.length === preview.length &&
          plotted.every((id, i) => id === preview[i])
        if (!sameAsPlotted) {
          drawPath(preview, {
            color: plotted ? 'rgba(255, 220, 90, 0.85)' : 'rgba(255, 210, 70, 0.95)',
            lineWidth: plotted ? 2.25 : 2.75,
            dashed: !!plotted
          })
        }
      }

      // Asset rings first (outer), then mission rings (inner).
      for (const system of systems) {
        if (!assetSystems.has(system.id) || !inView(system.galaxyPosition, 1.2)) continue
        const [px, py] = toCanvas(system.galaxyPosition)
        ctx.beginPath()
        ctx.arc(px, py, 12, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(80,220,120,0.95)'
        ctx.lineWidth = 2.25
        ctx.shadowColor = '#50dc78'
        ctx.shadowBlur = 12
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      for (const system of systems) {
        if (!missionSystems.has(system.id) || !inView(system.galaxyPosition, 1.2)) continue
        const [px, py] = toCanvas(system.galaxyPosition)
        ctx.beginPath()
        ctx.arc(px, py, 9, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(255,138,61,0.95)'
        ctx.lineWidth = 2
        ctx.shadowColor = '#ff8a3d'
        ctx.shadowBlur = 12
        ctx.stroke()
      }
      ctx.shadowBlur = 0

      const routeSet = new Set(plotted ?? [])
      // Scale dot size slightly with zoom so zoomed-out map stays readable.
      const zoomDot = Math.max(0.65, Math.min(1.35, 280 / mapView.radius))
      for (const system of systems) {
        if (!inView(system.galaxyPosition, 1.2)) continue
        const [px, py] = toCanvas(system.galaxyPosition)
        const isCurrent = system.id === currentSystem.id
        const isSelected = system.id === selectedSystemId
        const isHovered = system.id === hoveredSystemId
        const inRange = isCurrent || canJumpTo(currentSystem, system.id)
        const hasMission = missionSystems.has(system.id)
        const hasAssets = assetSystems.has(system.id)
        const onRoute = routeSet.has(system.id) && !isCurrent
        const r =
          (isCurrent ? 5 : isSelected || isHovered || onRoute ? 4.5 : 2.5) * zoomDot
        ctx.beginPath()
        ctx.arc(px, py, r, 0, Math.PI * 2)
        const ui = getUiPalette()
        ctx.fillStyle = isCurrent
          ? ui.accent
          : isSelected
            ? '#ffcc66'
            : onRoute
              ? '#ffd246'
              : isHovered
                ? ui.bright
                : hasMission
                  ? '#ff9a4a'
                  : hasAssets
                    ? '#6fe89a'
                    : inRange
                      ? '#7fe0a0'
                      : '#3a5a8a'
        if (isCurrent || isSelected || isHovered || inRange || hasMission || hasAssets || onRoute) {
          ctx.shadowColor = ctx.fillStyle
          ctx.shadowBlur = isCurrent || isSelected || isHovered || onRoute ? 10 : 5
        } else {
          ctx.shadowBlur = 0
        }
        ctx.fill()
      }
      ctx.shadowBlur = 0
    }

    function renderRouteList() {
      const wrap = contentEl.querySelector('.route-list-wrap')
      const rem = remainingRoute()
      if (!rem) {
        wrap.innerHTML = `<div class="route-empty">Select a distant system and Plot Route. Yellow path shows hops — SC + F manually, or Engage Autopilot after undocking if fitted.</div>`
        return
      }
      const hops = rem.length
      wrap.innerHTML = `
        <ol class="route-list">
          ${rem
            .map((id, i) => {
              const sys = byId.get(id)
              const name = sys?.name ?? id
              const isNext = i === 0
              const isDest = i === rem.length - 1
              const tags = [
                isNext ? '<span class="tag">next</span>' : '',
                isDest && !isNext ? '<span class="tag">dest</span>' : isDest ? '<span class="tag">dest</span>' : ''
              ].join('')
              return `<li class="${isNext ? 'next' : ''} ${isDest ? 'dest' : ''}">
                <span class="hop">${i + 1}.</span>
                <span class="name">${escapeHtml(name)}</span>
                ${tags}
              </li>`
            })
            .join('')}
        </ol>
        <div class="stat" style="margin-top:8px;opacity:0.7;font-size:11px">${hops} jump${hops === 1 ? '' : 's'} remaining</div>
        <button class="clear-route">Clear Route</button>
      `
      wrap.querySelector('.clear-route')?.addEventListener('click', () => {
        gameState.player.plottedRoute = null
        updateInfoPanel()
        draw()
      })
    }

    /** Engage when fitted + route; Cancel while a sequence is running (route kept).
     * Engage is always disabled while docked — plot/route planning still works. */
    function updateAutopilotButton() {
      const apBtn = contentEl.querySelector('.engage-ap')
      if (!apBtn) return
      const routeHop = nextRouteHopId()
      const routeRem = remainingRoute()
      const hasAutopilot = shipHasAutopilot(gameState.player.ship)
      const active = !!isAutopilotActive?.()

      // Cancel is allowed even if you somehow dock mid-sequence.
      if (active && !docked) {
        apBtn.disabled = false
        apBtn.textContent = 'Cancel Autopilot'
        apBtn.dataset.mode = 'cancel'
        apBtn.title = 'Stop the autopilot sequence (route is kept)'
        return
      }
      apBtn.dataset.mode = 'engage'

      if (docked) {
        apBtn.disabled = true
        apBtn.textContent = 'Cannot Autopilot While Docked'
        apBtn.title = 'Undock before engaging route autopilot'
      } else if (inCombat) {
        apBtn.disabled = true
        apBtn.textContent = 'Cannot Autopilot in Combat'
        apBtn.title = ''
      } else if (!hasAutopilot) {
        apBtn.disabled = true
        apBtn.textContent = 'Autopilot Not Fitted'
        apBtn.title = 'Fit an Autopilot accessory at a shipyard'
      } else if (!routeRem?.length || !routeHop) {
        apBtn.disabled = true
        apBtn.textContent = 'Plot Route First'
        apBtn.title = ''
      } else {
        apBtn.disabled = false
        const hops = routeRem.length
        const hopSys = byId.get(routeHop)
        apBtn.textContent =
          hops > 1
            ? `Engage Autopilot (${hops} jumps)`
            : hopSys
              ? `Engage Autopilot · ${hopSys.name}`
              : 'Engage Autopilot'
        apBtn.title = ''
      }
    }

    function updateInfoPanel() {
      const plotBtn = contentEl.querySelector('.plot-route')
      const hintEl = contentEl.querySelector('.route-hint')
      const hasAutopilot = shipHasAutopilot(gameState.player.ship)

      if (!selectedSystemId) {
        contentEl.querySelector('.sel-name').textContent = '—'
        contentEl.querySelector('.sel-security').textContent = ''
        contentEl.querySelector('.sel-bodies').textContent = ''
        contentEl.querySelector('.sel-distance').textContent = ''
        if (docked) {
          hintEl.textContent = hasAutopilot
            ? 'Docked — plot a route now; undock to Engage Autopilot or fly gates (SC + F).'
            : 'Docked — plot a route now; undock and fly gates yourself (SC + F).'
        } else {
          hintEl.textContent = hasAutopilot
            ? 'Plot a route, then Engage Autopilot — or fly gates yourself (SC + F).'
            : 'Select a system and Plot Route. Fly gates yourself (SC + F). Fit Autopilot to automate.'
        }
        plotBtn.disabled = true
        plotBtn.textContent = 'Plot Route'
        updateAutopilotButton()
        renderRouteList()
        return
      }
      const system = systems.find((s) => s.id === selectedSystemId)
      const counts = system.bodies.reduce((acc, b) => ((acc[b.kind] = (acc[b.kind] ?? 0) + 1), acc), {})
      const distance = dist3(system.galaxyPosition, currentSystem.galaxyPosition)
      const isCurrent = system.id === currentSystem.id
      const inRange = isCurrent || canJumpTo(currentSystem, system.id)
      const path = pathToSelected()
      const jumps = path ? path.length - 1 : 0

      ensureSystemSecurity(system)
      const sec = getSystemSecurity(system)
      contentEl.querySelector('.sel-name').textContent = system.name
      contentEl.querySelector('.sel-security').textContent = `Security: ${sec} / 6`
      contentEl.querySelector('.sel-security').style.color =
        sec >= 4 ? '#7fe0a0' : sec >= 2 ? '#ffe08a' : sec >= 1 ? '#ffb07a' : '#ff8a7a'
      contentEl.querySelector('.sel-bodies').textContent =
        `${counts.planet ?? 0} planets, ${counts.station ?? 0} stations, ${counts.settlement ?? 0} settlements`
      contentEl.querySelector('.sel-distance').textContent = isCurrent
        ? 'Current system'
        : `${Math.round(distance)} ly away${inRange ? ' — direct warp gate' : ' — multi-gate route'}`

      if (!isCurrent && path && jumps > 0) {
        if (docked) {
          hintEl.textContent =
            jumps === 1
              ? '1 warp gate. Plot Route here, then undock to fly or Engage Autopilot.'
              : `Route: ${jumps} gates. Plot Route here, then undock to fly or Engage Autopilot.`
        } else {
          hintEl.textContent =
            jumps === 1
              ? hasAutopilot
                ? '1 warp gate — SC + F, or Plot Route and Engage Autopilot.'
                : '1 warp gate — supercruise there and press F to jump.'
              : hasAutopilot
                ? `Route: ${jumps} gates. Plot Route, then Engage Autopilot — or SC + F at each gate.`
                : `Route: ${jumps} gates via ${jumps - 1} system${jumps - 1 === 1 ? '' : 's'}. Plot Route, then SC + F at each gate.`
        }
      } else if (!isCurrent && !path) {
        hintEl.textContent = 'No warp-gate route found.'
      } else {
        hintEl.textContent = ''
      }

      const canPlot = !isCurrent && path && jumps >= 1
      plotBtn.disabled = !canPlot
      plotBtn.textContent =
        canPlot && jumps > 1 ? `Plot Route (${jumps} jumps)` : canPlot ? 'Plot Route' : 'Plot Route'

      updateAutopilotButton()
      renderRouteList()
    }

    function nearestSystemAt(mx, my) {
      let nearest = null
      let nearestDist = Infinity
      // Hit radius grows slightly when zoomed out (smaller dots).
      const hitR = Math.max(8, Math.min(16, 10 * (280 / mapView.radius)))
      for (const system of systems) {
        if (!inView(system.galaxyPosition, 1.3)) continue
        const [px, py] = toCanvas(system.galaxyPosition)
        const d = Math.hypot(px - mx, py - my)
        if (d < nearestDist) {
          nearestDist = d
          nearest = system
        }
      }
      return nearestDist < hitR ? nearest : null
    }

    canvas.addEventListener('click', (e) => {
      const [mx, my] = canvasPointFromEvent(e)
      const nearest = nearestSystemAt(mx, my)
      if (nearest) {
        selectedSystemId = nearest.id
        updateInfoPanel()
        draw()
      }
    })

    // Hover shows the system's name as a floating tooltip near the cursor.
    canvas.addEventListener('mousemove', (e) => {
      const [mx, my] = canvasPointFromEvent(e)
      const nearest = nearestSystemAt(mx, my)
      if (nearest?.id !== hoveredSystemId) {
        hoveredSystemId = nearest?.id ?? null
        draw()
      }
      if (nearest) {
        ensureSystemSecurity(nearest)
        const sec = getSystemSecurity(nearest)
        const tags = [`Sec ${sec}`]
        if (missionSystems.has(nearest.id)) tags.push('mission')
        if (assetSystems.has(nearest.id)) tags.push('assets')
        tooltipEl.textContent = `${nearest.name} · ${tags.join(' · ')}`
        // Position tooltip in map-canvas-wrap coords.
        const bodyRect = canvasWrap.getBoundingClientRect()
        tooltipEl.style.left = `${e.clientX - bodyRect.left}px`
        tooltipEl.style.top = `${e.clientY - bodyRect.top}px`
        tooltipEl.style.display = 'block'
      } else {
        tooltipEl.style.display = 'none'
      }
    })
    canvas.addEventListener('mouseleave', () => {
      tooltipEl.style.display = 'none'
      if (hoveredSystemId) {
        hoveredSystemId = null
        draw()
      }
    })

    // Scroll zoom (centered on current view; keep map under cursor roughly stable).
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        e.stopPropagation()
        const [mx, my] = canvasPointFromEvent(e)
        // Galaxy point under cursor before zoom.
        const gx = mapView.cx + ((mx - size / 2) / half) * mapView.radius
        const gz = mapView.cz + ((my - size / 2) / half) * mapView.radius
        const factor = e.deltaY > 0 ? 1.14 : 1 / 1.14
        mapView.radius = clampViewRadius(mapView.radius * factor)
        // Keep that galaxy point under the cursor after zoom.
        mapView.cx = gx - ((mx - size / 2) / half) * mapView.radius
        mapView.cz = gz - ((my - size / 2) / half) * mapView.radius
        draw()
      },
      { passive: false }
    )

    contentEl.querySelector('.engage-ap').addEventListener('click', () => {
      const apBtn = contentEl.querySelector('.engage-ap')
      if (apBtn?.dataset.mode === 'cancel') {
        onCancelAutopilot?.()
        updateAutopilotButton()
        return
      }
      // Hard block: never start autopilot while docked (button should already be disabled).
      if (docked || inCombat || !onEngageAutopilot) return
      if (!shipHasAutopilot(gameState.player.ship)) return
      const hop = nextRouteHopId()
      const routeRem = remainingRoute()
      if (!hop || !routeRem?.length) return
      onEngageAutopilot(hop)
    })

    contentEl.querySelector('.plot-route').addEventListener('click', () => {
      const path = pathToSelected()
      if (!path || path.length < 2) return
      // Store remaining hops only (exclude current system) — yellow path for manual travel.
      gameState.player.plottedRoute = path.slice(1)
      // Select next hop so the route panel reads clearly.
      selectedSystemId = path[1]
      updateInfoPanel()
      draw()
    })

    redrawMap = draw
    refreshInfoPanel = updateInfoPanel
    draw()
    updateInfoPanel()
  }

  function stopMapPanLoop() {
    if (mapPanRaf) {
      cancelAnimationFrame(mapPanRaf)
      mapPanRaf = 0
    }
    mapKeys.clear()
  }

  function mapPanFrame() {
    mapPanRaf = 0
    if (root.style.display === 'none' || !mapKeys.size) return
    // Pan in galaxy units (screen up = −Z because toCanvas maps +Z downward).
    const step = mapView.radius * 0.028
    let dx = 0
    let dz = 0
    if (mapKeys.has('KeyA')) dx -= step
    if (mapKeys.has('KeyD')) dx += step
    if (mapKeys.has('KeyW')) dz -= step
    if (mapKeys.has('KeyS')) dz += step
    if (dx !== 0 || dz !== 0) {
      mapView.cx += dx
      mapView.cz += dz
      redrawMap?.()
    }
    mapPanRaf = requestAnimationFrame(mapPanFrame)
  }

  function onMapKeyDown(e) {
    if (root.style.display === 'none') return
    if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
      // Don't steal typing from inputs.
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      mapKeys.add(e.code)
      if (!mapPanRaf) mapPanRaf = requestAnimationFrame(mapPanFrame)
    }
  }
  function onMapKeyUp(e) {
    if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
      mapKeys.delete(e.code)
    }
  }
  window.addEventListener('keydown', onMapKeyDown)
  window.addEventListener('keyup', onMapKeyUp)

  let onEngageAutopilot = null
  let onCancelAutopilot = null
  let isAutopilotActive = null
  let onCloseCallback = null
  let inCombat = false
  let docked = false
  root.querySelector('.close').addEventListener('click', () => {
    stopMapPanLoop()
    redrawMap = null
    refreshInfoPanel = null
    searchInput.value = ''
    searchInput.classList.remove('match', 'nomatch')
    mapOpen = false
    root.style.display = 'none'
    onCloseCallback?.()
  })

  return {
    show({
      onEngageAutopilot: onAp,
      onCancelAutopilot: onCancel,
      isAutopilotActive: isApActive,
      onClose,
      inCombat: combat = false,
      docked: isDocked = false
    } = {}) {
      onEngageAutopilot = onAp
      onCancelAutopilot = onCancel
      isAutopilotActive = isApActive
      onCloseCallback = onClose
      inCombat = !!combat
      docked = !!isDocked
      selectedSystemId = null
      searchInput.value = ''
      searchInput.classList.remove('match', 'nomatch')
      stopMapPanLoop()
      mapOpen = true
      floating.restore()
      root.style.display = 'block'
      renderGalaxyTab()
      // One more frame after layout settles (font/scrollbar).
      requestAnimationFrame(() => redrawMap?.())
    },
    hide() {
      stopMapPanLoop()
      redrawMap = null
      refreshInfoPanel = null
      searchInput.value = ''
      searchInput.classList.remove('match', 'nomatch')
      mapOpen = false
      root.style.display = 'none'
    },
    element: root
  }
}
