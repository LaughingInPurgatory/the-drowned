/**
 * 3D region sonar scan map — bodies + Anomalous Signals + 4 repositionable sonar probes.
 * Opened from the radar "Region Sonar Scan" button.
 */
import * as THREE from 'three'
import { getSystem } from '../procgen/world.js'
import {
  SYSTEM_SCAN_PROBE_COUNT,
  SYSTEM_SCAN_CONTACT_RANGE,
  ensureSystemAnomalies,
  updateSystemScan,
  computeProbeSignal,
  idealProbeScanRadius,
  PROBE_SIGNAL_RANGE_MUL
} from '../game/systemScan.js'
import { getShipClass } from '../data/shipClasses.js'
import { escapeHtml } from './escapeHtml.js'
import {
  defaultPanelGeom,
  floatingPanelElevationCss,
  floatingResizeHandleCss,
  wireFloatingPanel
} from './floatingPanel.js'

const GEOM_LS_KEY = 'witv.systemScanPanel'

const STYLE = `
/* Dim scrim; panel is free-floating (move / resize, geometry remembered). */
#system-scan-map {
  position: fixed; inset: 0; z-index: 56; display: none;
  background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b), 0.55);
  backdrop-filter: blur(2px);
  font-family: monospace; color: var(--ui-text);
  box-sizing: border-box;
  pointer-events: auto;
}
#system-scan-map.visible { display: block; }
#system-scan-map .ssm-panel {
  position: fixed;
  display: flex; flex-direction: column;
  box-sizing: border-box;
  min-width: 420px; min-height: 300px;
  background: rgba(4,8,16,0.96);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  border-right: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
  overflow: hidden;
}
${floatingPanelElevationCss('#system-scan-map .ssm-panel')}
#system-scan-map .ssm-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 16px; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3);
  flex-shrink: 0;
  cursor: grab; user-select: none; touch-action: none;
  background: repeating-linear-gradient(108deg, transparent 0 17px, rgba(255,230,200,0.025) 17px 18px, transparent 18px 41px);
}
#system-scan-map .ssm-header.dragging { cursor: grabbing; }
#system-scan-map .ssm-header h2 {
  margin: 0; font-weight: normal; letter-spacing: 2px; font-size: 15px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#system-scan-map .ssm-header .ssm-sub { font-size: 10px; opacity: 0.65; margin-left: 10px; }
#system-scan-map button.ssm-close {
  display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5); color: #ffb3b3;
  cursor: pointer; font-family: monospace; font-size: 18px; line-height: 1;
}
#system-scan-map button.ssm-close:hover {
  background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#system-scan-map .ssm-body { flex: 1; display: flex; min-height: 0; }
#system-scan-map .ssm-canvas-wrap {
  flex: 1; position: relative; min-width: 0;
  background: radial-gradient(ellipse at center, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.8) 0%, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.96) 70%);
}
#system-scan-map canvas.ssm-canvas { width: 100%; height: 100%; display: block; cursor: grab; }
#system-scan-map canvas.ssm-canvas.dragging { cursor: grabbing; }
#system-scan-map .ssm-hint {
  position: absolute; left: 10px; bottom: 8px; font-size: 10px; opacity: 0.8;
  pointer-events: none; letter-spacing: 0.4px; color: #d0b8ff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  max-width: 55%;
}
#system-scan-map .ssm-legend {
  position: absolute; right: 10px; bottom: 8px; font-size: 9px;
  pointer-events: none; line-height: 1.5; text-align: right;
  color: var(--ui-soft); opacity: 0.9;
}
#system-scan-map .ssm-legend .lg-a { color: #e090ff; font-weight: bold; }
#system-scan-map .ssm-legend .lg-p { color: var(--ui-accent); }
#system-scan-map .ssm-legend .lg-y { color: #60ff90; }
#system-scan-map .ssm-side {
  width: 240px; flex-shrink: 0; border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  padding: 10px 12px; overflow-y: auto;
  background: linear-gradient(180deg, rgba(0,0,0,0.24), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.4));
}
#system-scan-map .ssm-side h3 {
  margin: 0 0 8px; font-weight: normal; font-size: 11px; letter-spacing: 1.5px;
  text-transform: uppercase; color: var(--ui-accent);
}
#system-scan-map .ssm-probe {
  padding: 8px; margin-bottom: 6px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.06); font-size: 11px; cursor: pointer;
}
#system-scan-map .ssm-probe.active { border-color: var(--ui-accent); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#system-scan-map .ssm-probe .lab { opacity: 0.6; font-size: 9px; letter-spacing: 1px; }
#system-scan-map .ssm-sig {
  margin-top: 14px; padding-top: 10px; border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
}
#system-scan-map .ssm-sig-row {
  display: grid; grid-template-columns: 1fr auto; gap: 4px; font-size: 11px;
  padding: 8px 6px; border-bottom: 1px solid rgba(42,58,85,0.4);
  border-left: 3px solid rgba(200,100,255,0.55);
  background: rgba(120,40,180,0.08);
  margin-bottom: 4px;
}
#system-scan-map .ssm-sig-row:hover { background: rgba(160,60,220,0.2); }
#system-scan-map .ssm-sig-row .nm { color: #e8b0ff; font-weight: bold; }
#system-scan-map .ssm-sig-row .done { color: #7fe0a0; }
#system-scan-map .ssm-bar {
  grid-column: 1 / -1; height: 5px; background: #0c1424; border: 1px solid #2a3a55;
  margin-top: 2px;
}
#system-scan-map .ssm-bar > i {
  display: block; height: 100%; background: linear-gradient(90deg, #6a4cff, var(--ui-accent));
  width: 0%;
}
#system-scan-map .ssm-actions { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
#system-scan-map .ssm-actions button {
  font-family: monospace; padding: 8px; cursor: pointer; letter-spacing: 0.5px;
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
}
#system-scan-map .ssm-actions button:hover { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2); }
#system-scan-map .ssm-actions button.primary {
  background: rgba(127,224,160,0.12); border-color: rgba(127,224,160,0.5); color: #bdf5cf;
}
${floatingResizeHandleCss('#system-scan-map .float-resize')}
`

/**
 * @param {HTMLElement} container
 * @param {object} gameState
 * @param {{
 *   getShipClassId: () => string,
 *   onFullyScanned?: (anomaly) => void,
 *   onClose?: () => void
 * }} hooks
 */
export function createSystemScanMap(container, gameState, hooks = {}) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'system-scan-map'
  root.innerHTML = `
    <div class="ssm-panel">
      <div class="ssm-header">
        <div>
          <h2>Region Sonar Scan</h2>
          <span class="ssm-sub">Local 20 km contacts · deploy sonar probes · form on signals</span>
        </div>
        <button type="button" class="ssm-close" aria-label="Close region sonar scan" title="Close region sonar scan">×</button>
      </div>
      <div class="ssm-body">
        <div class="ssm-canvas-wrap">
          <canvas class="ssm-canvas"></canvas>
          <div class="ssm-hint">20 km contact radius · WASD pan · Drag rotate · Scroll zoom · Select probe · Click map to place · Form on the bright purple ring (~3 km from a fresh signal)</div>
          <div class="ssm-legend">
            <div class="lg-a">◆ PURPLE = Anomalous Signal</div>
            <div class="lg-p">◇ CYAN = Sonar probes</div>
            <div class="lg-y">▲ GREEN = Your ship</div>
          </div>
        </div>
        <div class="ssm-side">
          <h3>Sonar Probes (4)</h3>
          <div class="ssm-probes"></div>
          <div class="ssm-actions">
            <button type="button" class="primary ssm-deploy">Deploy / Reset Sonar Formation</button>
          </div>
          <div class="ssm-sig">
            <h3>Signals</h3>
            <div class="ssm-sig-list"></div>
          </div>
        </div>
      </div>
      <div class="float-resize" title="Resize" aria-label="Resize region sonar scan"></div>
    </div>
  `
  container.appendChild(root)

  const panelEl = root.querySelector('.ssm-panel')
  const headerEl = root.querySelector('.ssm-header')
  const canvas = root.querySelector('.ssm-canvas')
  const probesEl = root.querySelector('.ssm-probes')
  const sigListEl = root.querySelector('.ssm-sig-list')
  let open = false

  const floating = wireFloatingPanel({
    panelEl,
    headerEl,
    resizeEl: root.querySelector('.float-resize'),
    storageKey: GEOM_LS_KEY,
    minW: 420,
    minH: 300,
    isActive: () => open,
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
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  const scene = new THREE.Scene()
  // Sea-scale map: world is 80 km radius — not a star system.
  const camera = new THREE.PerspectiveCamera(50, 1, 20, 220000)
  camera.position.set(0, 12000, 18000)
  camera.lookAt(0, 0, 0)

  const ambient = new THREE.AmbientLight(0xcce8ff, 1.55)
  scene.add(ambient)
  const sun = new THREE.DirectionalLight(0xfff4cc, 1.4)
  sun.position.set(8000, 14000, 4000)
  scene.add(sun)
  const hemi = new THREE.HemisphereLight(0xaaccff, 0x334466, 0.9)
  scene.add(hemi)
  const fill = new THREE.DirectionalLight(0xb0d0ff, 0.45)
  fill.position.set(-6000, 9000, -3000)
  scene.add(fill)

  const bodyGroup = new THREE.Group()
  const probeGroup = new THREE.Group()
  const anomalyGroup = new THREE.Group()
  const guideGroup = new THREE.Group()
  scene.add(bodyGroup)
  scene.add(probeGroup)
  scene.add(anomalyGroup)
  scene.add(guideGroup)

  // Placement grid (rebuilt to player Y on open)
  let gridHelper = null

  /** @type {{ id: number, active: boolean, position: number[], mesh: THREE.Object3D }[]} */
  let probes = []
  let selectedProbe = 0
  // Auto-deployed probes follow the player's current area between map opens;
  // manually placed formations are deliberately left alone.
  let autoFormation = true
  let autoFormationAnchor = null
  let raf = 0
  let lastT = 0
  let orbitYaw = 0.55
  let orbitPitch = 0.72
  let orbitDist = 14000
  let dragging = false
  let lastX = 0
  let lastY = 0
  /** World-space look-at (player, or anomaly when focused). Always an array once panned. */
  let focusTarget = null
  /** Held WASD codes while map is open. */
  const panKeys = new Set()
  /** Fresh-signal ideal ring — same as idealProbeScanRadius(0). */
  const FRESH_PROBE_R = idealProbeScanRadius(0)

  function distanceFromShip(position) {
    const ship = gameState.player.ship.position
    return Math.hypot((position[0] ?? 0) - ship[0], (position[2] ?? 0) - ship[2])
  }

  /** Keep scan navigation and manual probe placement inside the local chart. */
  function clampToContactRadius(position) {
    const ship = gameState.player.ship.position
    const dx = position[0] - ship[0]
    const dz = position[2] - ship[2]
    const distance = Math.hypot(dx, dz)
    if (distance <= SYSTEM_SCAN_CONTACT_RANGE) return position
    const scale = SYSTEM_SCAN_CONTACT_RANGE / distance
    position[0] = ship[0] + dx * scale
    position[2] = ship[2] + dz * scale
    return position
  }

  function shipClass() {
    try {
      return getShipClass(hooks.getShipClassId?.() ?? gameState.player.ship.classId)
    } catch {
      return null
    }
  }

  function ensureProbes() {
    if (probes.length) return
    for (let i = 0; i < SYSTEM_SCAN_PROBE_COUNT; i++) {
      const root = new THREE.Group()
      root.visible = false
      probeGroup.add(root)
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(45, 0),
        new THREE.MeshBasicMaterial({ color: 0xd0ffff })
      )
      root.add(core)
      const shell = new THREE.Mesh(
        new THREE.OctahedronGeometry(70, 0),
        new THREE.MeshBasicMaterial({
          color: 0x40d0ff,
          wireframe: true,
          transparent: true,
          opacity: 1
        })
      )
      root.add(shell)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(110, 160, 40),
        new THREE.MeshBasicMaterial({
          color: 0x5ee6ff,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      ring.rotation.x = -Math.PI / 2
      root.add(ring)
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(140, 28),
        new THREE.MeshBasicMaterial({
          color: 0x40b0ff,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      disc.rotation.x = -Math.PI / 2
      disc.position.y = -4
      root.add(disc)
      // Short pin above the water plane
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(8, 8, 280, 6),
        new THREE.MeshBasicMaterial({
          color: 0x60e8ff,
          transparent: true,
          opacity: 0.55,
          depthWrite: false
        })
      )
      pin.position.y = 140
      root.add(pin)
      probes.push({
        id: i,
        active: false,
        position: [0, 0, 0],
        mesh: root,
        core,
        shell
      })
    }
  }

  function deployFormation() {
    ensureProbes()
    const ship = gameState.player.ship.position
    // Start close enough to be visibly beside the boat, not somewhere in the
    // wider region view. The player moves this ring to a signal when ready.
    const baseR = 300
    for (let i = 0; i < probes.length; i++) {
      const a = (i / probes.length) * Math.PI * 2
      const p = probes[i]
      p.active = true
      p.position = [ship[0] + Math.cos(a) * baseR, 0, ship[2] + Math.sin(a) * baseR]
      p.mesh.visible = true
      p.mesh.position.set(p.position[0], 0, p.position[2])
    }
    autoFormation = true
    autoFormationAnchor = [ship[0], ship[2]]
    renderProbeList()
  }

  function recallProbes() {
    for (const p of probes) {
      p.active = false
      p.mesh.visible = false
    }
    autoFormationAnchor = null
    renderProbeList()
  }

  function renderProbeList() {
    probesEl.innerHTML = probes
      .map((p, i) => {
        const st = p.active ? 'DEPLOYED' : 'BAY'
        return `<div class="ssm-probe${i === selectedProbe ? ' active' : ''}" data-i="${i}">
          <div class="lab">PROBE ${i + 1}</div>
          <div>${st}${
            p.active
              ? ` · ${Math.round(
                  Math.hypot(
                    p.position[0] - gameState.player.ship.position[0],
                    p.position[2] - gameState.player.ship.position[2]
                  ) / 1000
                )}km from ship`
              : ''
          }</div>
        </div>`
      })
      .join('')
    probesEl.querySelectorAll('.ssm-probe').forEach((el) => {
      el.addEventListener('click', () => {
        selectedProbe = Number(el.dataset.i)
        renderProbeList()
      })
    })
  }

  function disposeObject3D(obj) {
    obj.traverse((c) => {
      c.geometry?.dispose?.()
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.())
      else c.material?.dispose?.()
    })
  }

  function rebuildBodies() {
    while (bodyGroup.children.length) {
      const c = bodyGroup.children[0]
      bodyGroup.remove(c)
      disposeObject3D(c)
    }
    while (guideGroup.children.length) {
      const c = guideGroup.children[0]
      guideGroup.remove(c)
      disposeObject3D(c)
    }
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (!system) return
    const ship = gameState.player.ship.position
    const y0 = 0

    // Haven Reach centre marker (not a star — world origin), only while it
    // lies within this local scan's 20 km radius.
    if (distanceFromShip([0, 0, 0]) <= SYSTEM_SCAN_CONTACT_RANGE) {
      const home = new THREE.Mesh(
        new THREE.SphereGeometry(90, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xffe8a0 })
      )
      home.position.set(0, y0, 0)
      bodyGroup.add(home)
    }

    for (const b of system.bodies) {
      if (b.kind === 'warpGate') continue
      if (distanceFromShip(b.position) > SYSTEM_SCAN_CONTACT_RANGE) continue
      let r = 70
      let color = 0x9ac0e8
      if (b.kind === 'island') {
        r = Math.min(420, Math.max(60, (b.radius ?? 800) * 0.12))
        color = 0xb8d8ff
      } else if (b.kind === 'port' || b.kind === 'outpost') {
        r = b.kind === 'port' ? 55 : 40
        color = 0x70ffff
      } else if (b.kind === 'wreckField') {
        r = Math.min(180, Math.max(50, (b.radius ?? 200) * 0.35))
        color = 0xc8b8a0
      }
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 12, 10),
        new THREE.MeshBasicMaterial({
          color,
          wireframe: b.kind === 'wreckField',
          transparent: b.kind === 'wreckField',
          opacity: b.kind === 'wreckField' ? 0.85 : 1
        })
      )
      m.position.set(b.position[0], y0, b.position[2])
      bodyGroup.add(m)
      if (b.kind === 'island' || b.kind === 'port' || b.kind === 'outpost') {
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(r * 1.45, 10, 8),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.2,
            depthWrite: false
          })
        )
        halo.position.set(b.position[0], y0, b.position[2])
        bodyGroup.add(halo)
      }
    }

    // Player ship — green cone on the water
    const pm = new THREE.Mesh(
      new THREE.ConeGeometry(55, 140, 8),
      new THREE.MeshBasicMaterial({ color: 0x60ff90 })
    )
    pm.position.set(ship[0], y0 + 40, ship[2])
    pm.rotation.x = Math.PI / 2
    bodyGroup.add(pm)
    const pRing = new THREE.Mesh(
      new THREE.RingGeometry(90, 130, 36),
      new THREE.MeshBasicMaterial({
        color: 0x7fe0a0,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    pRing.rotation.x = -Math.PI / 2
    pRing.position.set(ship[0], y0 - 2, ship[2])
    bodyGroup.add(pRing)
    const shipPin = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 220, 6),
      new THREE.MeshBasicMaterial({
        color: 0x60ff90,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      })
    )
    shipPin.position.set(ship[0], y0 + 110, ship[2])
    bodyGroup.add(shipPin)

    // Local sea grid (world-sized would be unreadable at boat scale)
    const gridSize = SYSTEM_SCAN_CONTACT_RANGE * 2
    gridHelper = new THREE.GridHelper(gridSize, 20, 0x4a80b0, 0x243858)
    gridHelper.position.set(ship[0], y0 - 8, ship[2])
    if (Array.isArray(gridHelper.material)) {
      gridHelper.material.forEach((m) => {
        m.transparent = true
        m.opacity = 0.45
        m.depthWrite = false
      })
    } else if (gridHelper.material) {
      gridHelper.material.transparent = true
      gridHelper.material.opacity = 0.45
      gridHelper.material.depthWrite = false
    }
    guideGroup.add(gridHelper)
    const contactBoundary = new THREE.Mesh(
      new THREE.RingGeometry(SYSTEM_SCAN_CONTACT_RANGE - 70, SYSTEM_SCAN_CONTACT_RANGE + 70, 96),
      new THREE.MeshBasicMaterial({
        color: 0xffd080,
        transparent: true,
        opacity: 0.48,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    contactBoundary.rotation.x = -Math.PI / 2
    contactBoundary.position.set(ship[0], y0 - 6, ship[2])
    guideGroup.add(contactBoundary)

    // Range rings around the ship (local distance cues)
    for (const [r, op] of [
      [2000, 0.22],
      [5000, 0.16],
      [10000, 0.12]
    ]) {
      const rr = new THREE.Mesh(
        new THREE.RingGeometry(r - 25, r + 25, 64),
        new THREE.MeshBasicMaterial({
          color: 0x3a6088,
          transparent: true,
          opacity: op,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      rr.rotation.x = -Math.PI / 2
      rr.position.set(ship[0], y0 - 4, ship[2])
      guideGroup.add(rr)
    }
  }

  function rebuildAnomalyMarkers() {
    while (anomalyGroup.children.length) {
      const c = anomalyGroup.children[0]
      anomalyGroup.remove(c)
      disposeObject3D(c)
    }
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (!system) return
    const cls = shipClass()
    const probePos = probes.map((p) => ({ active: p.active, position: p.position }))
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004)

    const ship = gameState.player.ship.position
    for (const a of ensureSystemAnomalies(system, gameState.galaxy)) {
      if (a.status === 'completed' || a.status === 'despawning') continue
      if (Math.hypot(a.position[0] - ship[0], a.position[2] - ship[2]) > SYSTEM_SCAN_CONTACT_RANGE) continue
      const known = a.fullyScanned
      const live = computeProbeSignal(a, probePos, cls)
      const sig = Math.max(a.signal ?? 0, live)

      // Purple beacons sized for sea-scale framing (not multi-km space markers).
      const col = known
        ? a.type === 'alien_incursion'
          ? 0xff5533
          : 0xff90ff
        : 0xe070ff
      const coreR = known ? 90 : 70 + sig * 50
      const group = new THREE.Group()
      group.position.set(a.position[0], 0, a.position[2])

      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(coreR, 1),
        new THREE.MeshBasicMaterial({
          color: col,
          wireframe: false,
          transparent: true,
          opacity: known ? 0.95 : 0.75 + pulse * 0.2
        })
      )
      group.add(core)
      const wire = new THREE.Mesh(
        new THREE.IcosahedronGeometry(coreR * 1.08, 1),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          wireframe: true,
          transparent: true,
          opacity: 0.55 + pulse * 0.35
        })
      )
      group.add(wire)
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(coreR * 1.7, 14, 10),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: known ? 0.32 : 0.26 + pulse * 0.18,
          depthWrite: false
        })
      )
      group.add(glow)

      // Rings match computeProbeSignal / idealProbeScanRadius exactly.
      // mul 1.0 = ideal (bright place-here); outer = PROBE_SIGNAL_RANGE_MUL falloff edge.
      const idealR = idealProbeScanRadius(a.signal ?? 0)
      for (const [mul, thickness, op] of [
        [0.45, 35, 0.5],
        [1.0, 55, 0.95],
        [1.6, 40, 0.5],
        [PROBE_SIGNAL_RANGE_MUL, 30, 0.32]
      ]) {
        const mid = idealR * mul
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(mid - thickness / 2, mid + thickness / 2, 64),
          new THREE.MeshBasicMaterial({
            color: mul === 1.0 ? 0xffa0ff : col,
            transparent: true,
            opacity: mul === 1.0 ? 0.85 + pulse * 0.15 : op,
            side: THREE.DoubleSide,
            depthWrite: false
          })
        )
        ring.rotation.x = -Math.PI / 2
        group.add(ring)
      }

      const spikeH = 900
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(12, 22, spikeH, 8),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.55 + pulse * 0.25,
          depthWrite: false
        })
      )
      spike.position.y = spikeH * 0.45
      group.add(spike)
      const spikeCore = new THREE.Mesh(
        new THREE.CylinderGeometry(5, 5, spikeH * 1.05, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.7,
          depthWrite: false
        })
      )
      spikeCore.position.y = spikeH * 0.45
      group.add(spikeCore)

      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(idealR * 1.02, 48),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.14 + pulse * 0.08,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      pad.rotation.x = -Math.PI / 2
      pad.position.y = -3
      group.add(pad)

      for (const rot of [0, Math.PI / 2]) {
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(idealR * 2.05, 8, 18),
          new THREE.MeshBasicMaterial({
            color: 0xffc0ff,
            transparent: true,
            opacity: 0.55,
            depthWrite: false
          })
        )
        arm.rotation.y = rot
        arm.position.y = -1
        group.add(arm)
      }

      group.userData.anomalyId = a.id
      group.userData.core = core
      anomalyGroup.add(group)

      for (const p of probes) {
        if (!p.active) continue
        const d = Math.hypot(p.position[0] - a.position[0], p.position[2] - a.position[2])
        const near = d < idealR * PROBE_SIGNAL_RANGE_MUL
        const pts = [
          new THREE.Vector3(p.position[0], 0, p.position[2]),
          new THREE.Vector3(a.position[0], 0, a.position[2])
        ]
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: known ? 0x90ffb0 : near ? 0xffd0ff : 0x9060c0,
            transparent: true,
            opacity: known ? 0.7 : near ? 0.75 : 0.35
          })
        )
        anomalyGroup.add(line)
      }
    }
  }

  function renderSignals() {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (!system) {
      sigListEl.innerHTML = ''
      return
    }
    const cls = shipClass()
    const probePos = probes.map((p) => ({
      active: p.active,
      position: p.position
    }))
    const ship = gameState.player.ship.position
    const list = ensureSystemAnomalies(system, gameState.galaxy).filter(
      (a) =>
        a.status !== 'completed' &&
        a.status !== 'despawning' &&
        Math.hypot(a.position[0] - ship[0], a.position[2] - ship[2]) <= SYSTEM_SCAN_CONTACT_RANGE
    )
    const rows = list.map((a) => {
      const live = computeProbeSignal(a, probePos, cls)
      const sig = Math.max(a.signal ?? 0, live)
      const pct = Math.round((a.fullyScanned ? 1 : a.scanProgress ?? 0) * 100)
      const nm = a.fullyScanned
        ? escapeHtml(a.displayName)
        : sig > 0.08
          ? 'Anomalous Signal'
          : 'Unidentified'
      const distM = Math.hypot(
        a.position[0] - ship[0],
        a.position[2] - ship[2]
      )
      const distLabel =
        distM >= 10000 ? `${(distM / 1000).toFixed(1)}km` : `${Math.round(distM)}m`
      const idealKm = (idealProbeScanRadius(a.signal ?? 0) / 1000).toFixed(1)
      const isWp = gameState.player.waypointBodyId === a.id
      return `<div class="ssm-sig-row" data-anomaly-id="${escapeHtml(a.id)}" style="cursor:pointer" title="${a.fullyScanned ? 'Click to focus · double-click to set waypoint' : `Click to focus · ideal ring ~${idealKm} km`}">
          <span class="nm${a.fullyScanned ? ' done' : ''}">◆ ${nm}${isWp ? ' · WP' : ''}</span>
          <span>${a.fullyScanned ? 'LOCKED' : `${Math.round(sig * 100)}% · ${distLabel}`}</span>
          <div class="ssm-bar"><i style="width:${pct}%"></i></div>
        </div>`
    })
    sigListEl.innerHTML = rows.length
      ? rows.join('') +
        `<div style="margin-top:8px;font-size:10px;opacity:0.65;line-height:1.4">Click a signal to center. Locked: double-click sets waypoint. Place probes on the bright purple ring (ideal ≈ ${(FRESH_PROBE_R / 1000).toFixed(1)} km for a fresh signal; shrinks as it locks).</div>`
      : `<div style="opacity:0.5;font-size:11px">No signatures within 20 km.</div>`
    sigListEl.querySelectorAll('.ssm-sig-row[data-anomaly-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.anomalyId
        const a = list.find((x) => x.id === id)
        if (!a) return
        focusTarget = [a.position[0], 0, a.position[2]]
        // Frame the ideal ring with a little margin
        const idealR = idealProbeScanRadius(a.signal ?? 0)
        orbitDist = Math.max(4500, Math.min(22000, idealR * PROBE_SIGNAL_RANGE_MUL * 1.35 + 2000))
        orbitPitch = 0.82
      })
      el.addEventListener('dblclick', (e) => {
        e.preventDefault()
        const id = el.dataset.anomalyId
        const a = list.find((x) => x.id === id)
        if (!a?.fullyScanned) return
        if (gameState.player.waypointBodyId === a.id) {
          gameState.player.waypointBodyId = null
          gameState.player.waypointPosition = null
          hooks.onWaypointChange?.({ id: null, name: a.displayName, set: false })
        } else {
          if (hooks.canSetWaypoint && !hooks.canSetWaypoint()) return
          gameState.player.waypointBodyId = a.id
          gameState.player.waypointPosition = null
          hooks.onWaypointChange?.({ id: a.id, name: a.displayName || 'Anomalous Signal', set: true })
        }
        renderSignals()
      })
    })
  }

  function ensureFocusTarget() {
    if (!focusTarget) {
      const ship = gameState.player.ship.position
      focusTarget = [ship[0], ship[1], ship[2]]
    }
    return focusTarget
  }

  function syncCamera() {
    const p = ensureFocusTarget()
    const cp = Math.cos(orbitPitch)
    const ox = orbitDist * Math.sin(orbitYaw) * cp
    const oy = orbitDist * Math.sin(orbitPitch)
    const oz = orbitDist * Math.cos(orbitYaw) * cp
    camera.position.set(p[0] + ox, p[1] + oy, p[2] + oz)
    camera.lookAt(p[0], p[1], p[2])
  }

  /**
   * Pan the look-at point on the XZ plane relative to camera yaw
   * (W = into view, S = toward camera, A/D = strafe).
   */
  function applyWasdPan(dt) {
    if (!open || !panKeys.size) return
    let forward = 0
    let strafe = 0
    if (panKeys.has('KeyW')) forward += 1
    if (panKeys.has('KeyS')) forward -= 1
    if (panKeys.has('KeyA')) strafe -= 1
    if (panKeys.has('KeyD')) strafe += 1
    if (forward === 0 && strafe === 0) return
    // Speed scales with zoom so one key-hold covers a similar screen fraction.
    const speed = orbitDist * 1.15
    const len = Math.hypot(forward, strafe) || 1
    forward = (forward / len) * speed * dt
    strafe = (strafe / len) * speed * dt
    // Horizontal forward = look direction projected on XZ.
    const fwdX = -Math.sin(orbitYaw)
    const fwdZ = -Math.cos(orbitYaw)
    const rightX = Math.cos(orbitYaw)
    const rightZ = -Math.sin(orbitYaw)
    const p = ensureFocusTarget()
    p[0] += fwdX * forward + rightX * strafe
    p[2] += fwdZ * forward + rightZ * strafe
    // Placement plane is the sea surface.
    p[1] = 0
    clampToContactRadius(p)
  }

  /**
   * Center on the player and zoom to the 20 km local sonar contact area.
   */
  function frameSystem() {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const ship = gameState.player.ship.position
    focusTarget = [ship[0], 0, ship[2]]
    let maxD = 6000
    if (system) {
      for (const b of system.bodies ?? []) {
        if (!b?.position) continue
        if (b.kind === 'warpGate') continue
        const d = Math.hypot(b.position[0] - ship[0], b.position[2] - ship[2])
        if (d < SYSTEM_SCAN_CONTACT_RANGE && d > maxD) maxD = d
      }
      for (const a of ensureSystemAnomalies(system, gameState.galaxy)) {
        if (a.status === 'completed' || a.status === 'despawning') continue
        const d = Math.hypot(a.position[0] - ship[0], a.position[2] - ship[2])
        if (d < SYSTEM_SCAN_CONTACT_RANGE && d > maxD) maxD = d
      }
    }
    orbitPitch = 0.78
    orbitDist = Math.max(7000, Math.min(30000, maxD * 1.2 + 2800))
  }

  function placeSelectedProbeAt(world) {
    const p = probes[selectedProbe]
    if (!p) return
    p.active = true
    // Always on the water plane
    p.position = clampToContactRadius([world.x, 0, world.z])
    p.mesh.visible = true
    p.mesh.position.set(world.x, 0, world.z)
    autoFormation = false
    renderProbeList()
  }

  function raycastPlane(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    const y = -((clientY - rect.top) / rect.height) * 2 + 1
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(x, y), camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hit = new THREE.Vector3()
    if (ray.ray.intersectPlane(plane, hit)) return hit
    return null
  }

  function frame(t) {
    if (!open) return
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016)
    lastT = t
    applyWasdPan(dt)
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (system && probes.some((p) => p.active)) {
      const { fullyScanned } = updateSystemScan(
        system,
        probes.map((p) => ({ active: p.active, position: p.position })),
        shipClass(),
        dt
      )
      for (const a of fullyScanned) hooks.onFullyScanned?.(a)
    }
    for (const p of probes) {
      if (p.active) {
        p.mesh.rotation.y += dt * 0.9
        if (p.core) p.core.rotation.y -= dt * 1.4
        // Highlight selected probe
        const sel = p.id === selectedProbe
        if (p.shell?.material) {
          p.shell.material.color.setHex(sel ? 0xffff88 : 0x40d0ff)
        }
        if (p.core?.material) {
          p.core.material.color.setHex(sel ? 0xffffcc : 0xb8f8ff)
        }
      }
    }
    // Rebuild anomaly visuals every frame is OK for a few sites; keeps signal rings live.
    rebuildAnomalyMarkers()
    renderSignals()
    syncCamera()
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w && h) {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0 && !e.shiftKey) {
      // Place probe if one selected and not starting drag much
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      canvas.classList.add('dragging')
      canvas.setPointerCapture(e.pointerId)
    }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    if (e.shiftKey || Math.abs(dx) + Math.abs(dy) > 2) {
      orbitYaw -= dx * 0.005
      orbitPitch = Math.max(-1.2, Math.min(1.2, orbitPitch + dy * 0.005))
    }
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    dragging = false
    canvas.classList.remove('dragging')
    // Click without drag → place probe
    if (Math.abs(dx) + Math.abs(dy) < 4 && !e.shiftKey) {
      const hit = raycastPlane(e.clientX, e.clientY)
      if (hit) placeSelectedProbeAt(hit)
    }
  })
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      orbitDist *= e.deltaY > 0 ? 1.12 : 1 / 1.12
      orbitDist = Math.max(2500, Math.min(30000, orbitDist))
    },
    { passive: false }
  )

  root.querySelector('.ssm-close').addEventListener('click', () => hide())
  root.querySelector('.ssm-deploy').addEventListener('click', () => deployFormation())

  function onPanKeyDown(e) {
    if (!open) return
    if (e.code !== 'KeyW' && e.code !== 'KeyA' && e.code !== 'KeyS' && e.code !== 'KeyD') return
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    e.preventDefault()
    e.stopPropagation()
    panKeys.add(e.code)
  }
  function onPanKeyUp(e) {
    if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
      panKeys.delete(e.code)
    }
  }
  // Capture so flight/WASD elsewhere does not fight the map while open.
  window.addEventListener('keydown', onPanKeyDown, true)
  window.addEventListener('keyup', onPanKeyUp, true)

  function show() {
    open = true
    panKeys.clear()
    floating.restore()
    root.classList.add('visible')
    ensureProbes()
    const ship = gameState.player.ship.position
    const autoFormationIsStale =
      autoFormation &&
      (!autoFormationAnchor || Math.hypot(ship[0] - autoFormationAnchor[0], ship[2] - autoFormationAnchor[1]) > 2500)
    if (!probes.some((p) => p.active) || autoFormationIsStale) deployFormation()
    rebuildBodies()
    frameSystem()
    renderProbeList()
    lastT = performance.now()
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(frame)
  }

  function hide() {
    open = false
    panKeys.clear()
    root.classList.remove('visible')
    cancelAnimationFrame(raf)
    raf = 0
    hooks.onClose?.()
  }

  return {
    show,
    hide,
    isOpen: () => open,
    element: root,
    /** Probe state for external systems (optional). */
    getProbes: () => probes.map((p) => ({ active: p.active, position: [...p.position] }))
  }
}
