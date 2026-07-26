/**
 * 3D system scan map — bodies + Spatial Anomalies + 4 repositionable scan probes.
 * Opened from the radar "System Scan" button.
 */
import * as THREE from 'three'
import { getSystem } from '../procgen/galaxy.js'
import {
  SYSTEM_SCAN_PROBE_COUNT,
  ensureSystemAnomalies,
  updateSystemScan,
  computeProbeSignal
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
}
#system-scan-map .ssm-header.dragging { cursor: grabbing; }
#system-scan-map .ssm-header h2 {
  margin: 0; font-weight: normal; letter-spacing: 2px; font-size: 15px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#system-scan-map .ssm-header .ssm-sub { font-size: 10px; opacity: 0.65; margin-left: 10px; }
#system-scan-map button.ssm-close {
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5); color: #ffb3b3;
  padding: 6px 14px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
}
#system-scan-map button.ssm-close:hover {
  background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#system-scan-map .ssm-body { flex: 1; display: flex; min-height: 0; }
#system-scan-map .ssm-canvas-wrap {
  flex: 1; position: relative; min-width: 0;
  background: radial-gradient(ellipse at center, #0a1428 0%, #040810 70%);
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
  padding: 10px 12px; overflow-y: auto; background: rgba(8,14,24,0.92);
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
          <h2>System Scan</h2>
          <span class="ssm-sub">Deploy probes · form on signals · lock Spatial Anomalies</span>
        </div>
        <button type="button" class="ssm-close">Close</button>
      </div>
      <div class="ssm-body">
        <div class="ssm-canvas-wrap">
          <canvas class="ssm-canvas"></canvas>
          <div class="ssm-hint">WASD pan · Drag rotate · Scroll zoom · Select probe · Click map to place · Form probes ON the bright purple rings</div>
          <div class="ssm-legend">
            <div class="lg-a">◆ PURPLE = Spatial Anomaly</div>
            <div class="lg-p">◇ CYAN = Scan probes</div>
            <div class="lg-y">▲ GREEN = Your ship</div>
          </div>
        </div>
        <div class="ssm-side">
          <h3>Scan Probes (4)</h3>
          <div class="ssm-probes"></div>
          <div class="ssm-actions">
            <button type="button" class="primary ssm-deploy">Deploy / Reset Formation</button>
          </div>
          <div class="ssm-sig">
            <h3>Signals</h3>
            <div class="ssm-sig-list"></div>
          </div>
        </div>
      </div>
      <div class="float-resize" title="Resize" aria-label="Resize system scan"></div>
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
  const camera = new THREE.PerspectiveCamera(50, 1, 200, 5e6)
  camera.position.set(0, 90000, 140000)
  camera.lookAt(0, 0, 0)

  const ambient = new THREE.AmbientLight(0xcce8ff, 1.55)
  scene.add(ambient)
  const sun = new THREE.PointLight(0xfff4cc, 3.2, 0, 0)
  sun.position.set(0, 0, 0)
  scene.add(sun)
  const hemi = new THREE.HemisphereLight(0xaaccff, 0x334466, 0.9)
  scene.add(hemi)
  // Extra fill so dark map regions still read markers
  const fill = new THREE.DirectionalLight(0xb0d0ff, 0.55)
  fill.position.set(40000, 80000, 20000)
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

  /** @type {{ id: number, active: boolean, position: number[], mesh: THREE.Mesh }[]} */
  let probes = []
  let selectedProbe = 0
  let raf = 0
  let lastT = 0
  let orbitYaw = 0.6
  let orbitPitch = 0.55
  let orbitDist = 180000
  let dragging = false
  let lastX = 0
  let lastY = 0
  /** World-space look-at (player, or anomaly when focused). Always an array once panned. */
  let focusTarget = null
  /** Held WASD codes while map is open. */
  const panKeys = new Set()
  /** Ideal probe ring radius (matches systemScan idealR for unknown). */
  const IDEAL_PROBE_R = 12000

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
      // Bright solid core — large so visible across the system map
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(2800, 0),
        new THREE.MeshBasicMaterial({ color: 0xd0ffff })
      )
      root.add(core)
      // Wire shell for readability at distance
      const shell = new THREE.Mesh(
        new THREE.OctahedronGeometry(4200, 0),
        new THREE.MeshBasicMaterial({
          color: 0x40d0ff,
          wireframe: true,
          transparent: true,
          opacity: 1
        })
      )
      root.add(shell)
      // Wide scan ring (placement aid)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(7000, 9500, 48),
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
      // Outer soft disc
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(8000, 32),
        new THREE.MeshBasicMaterial({
          color: 0x40b0ff,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      disc.rotation.x = -Math.PI / 2
      disc.position.y = -20
      root.add(disc)
      // Vertical pin so probes pop against the ecliptic
      const pin = new THREE.Mesh(
        new THREE.CylinderGeometry(220, 220, 14000, 6),
        new THREE.MeshBasicMaterial({
          color: 0x60e8ff,
          transparent: true,
          opacity: 0.55,
          depthWrite: false
        })
      )
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
    const baseR = 18000
    for (let i = 0; i < probes.length; i++) {
      const a = (i / probes.length) * Math.PI * 2
      const p = probes[i]
      p.active = true
      p.position = [
        ship[0] + Math.cos(a) * baseR,
        ship[1] + 2000,
        ship[2] + Math.sin(a) * baseR
      ]
      p.mesh.visible = true
      p.mesh.position.fromArray(p.position)
    }
    renderProbeList()
  }

  function recallProbes() {
    for (const p of probes) {
      p.active = false
      p.mesh.visible = false
    }
    renderProbeList()
  }

  function renderProbeList() {
    probesEl.innerHTML = probes
      .map((p, i) => {
        const st = p.active ? 'DEPLOYED' : 'BAY'
        return `<div class="ssm-probe${i === selectedProbe ? ' active' : ''}" data-i="${i}">
          <div class="lab">PROBE ${i + 1}</div>
          <div>${st}${p.active ? ` · ${Math.round(Math.hypot(...p.position) / 1000)}km from star` : ''}</div>
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

    // Bright star + corona
    const starMesh = new THREE.Mesh(
      new THREE.SphereGeometry(11000, 28, 20),
      new THREE.MeshBasicMaterial({ color: 0xfff0a8 })
    )
    bodyGroup.add(starMesh)
    const corona = new THREE.Mesh(
      new THREE.SphereGeometry(20000, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffc060,
        transparent: true,
        opacity: 0.32,
        depthWrite: false
      })
    )
    bodyGroup.add(corona)

    for (const b of system.bodies) {
      if (b.kind === 'warpGate') {
        // Compact cyan torus markers so gates are readable
        const g = new THREE.Mesh(
          new THREE.TorusGeometry(4000, 700, 8, 24),
          new THREE.MeshBasicMaterial({ color: 0x80e0ff, wireframe: true })
        )
        g.position.fromArray(b.position)
        g.lookAt(0, b.position[1], 0)
        bodyGroup.add(g)
        continue
      }
      let r = 2400
      let color = 0x9ac0e8
      if (b.kind === 'planet') {
        r = Math.min(10000, Math.max(3200, (b.radius ?? 2000) * 0.3))
        color = 0xb8d8ff
      } else if (b.kind === 'moon') {
        r = 2000
        color = 0xd0d8e8
      } else if (b.kind === 'station' || b.kind === 'settlement') {
        r = 2400
        color = 0x70ffff
      } else if (b.kind === 'asteroidField') {
        r = 4500
        color = 0xc8b8a0
      }
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({
          color,
          wireframe: b.kind === 'asteroidField',
          transparent: b.kind === 'asteroidField',
          opacity: b.kind === 'asteroidField' ? 0.85 : 1
        })
      )
      m.position.fromArray(b.position)
      bodyGroup.add(m)
      // Halo so small bodies stay visible at long range
      if (b.kind === 'planet' || b.kind === 'station' || b.kind === 'settlement') {
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(r * 1.5, 12, 10),
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.22,
            depthWrite: false
          })
        )
        halo.position.fromArray(b.position)
        bodyGroup.add(halo)
      }
    }

    // Player ship — large bright green marker
    const pm = new THREE.Mesh(
      new THREE.ConeGeometry(2800, 7000, 8),
      new THREE.MeshBasicMaterial({ color: 0x60ff90 })
    )
    pm.position.fromArray(ship)
    pm.rotation.x = Math.PI / 2
    bodyGroup.add(pm)
    const pRing = new THREE.Mesh(
      new THREE.RingGeometry(4500, 6000, 40),
      new THREE.MeshBasicMaterial({
        color: 0x7fe0a0,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    )
    pRing.rotation.x = -Math.PI / 2
    pRing.position.set(ship[0], ship[1] - 40, ship[2])
    bodyGroup.add(pRing)
    // Ship pin
    const shipPin = new THREE.Mesh(
      new THREE.CylinderGeometry(300, 300, 16000, 6),
      new THREE.MeshBasicMaterial({
        color: 0x60ff90,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      })
    )
    shipPin.position.fromArray(ship)
    bodyGroup.add(shipPin)

    // Large system-wide placement grid (star-centered) so far anomalies still have a floor
    gridHelper = new THREE.GridHelper(400000, 40, 0x4a80b0, 0x243858)
    gridHelper.position.set(0, ship[1] - 80, 0)
    if (Array.isArray(gridHelper.material)) {
      gridHelper.material.forEach((m) => {
        m.transparent = true
        m.opacity = 0.55
        m.depthWrite = false
      })
    } else if (gridHelper.material) {
      gridHelper.material.transparent = true
      gridHelper.material.opacity = 0.55
      gridHelper.material.depthWrite = false
    }
    guideGroup.add(gridHelper)

    // Radial range rings from star (distance cues)
    for (const [r, op] of [
      [50000, 0.2],
      [100000, 0.16],
      [150000, 0.12]
    ]) {
      const rr = new THREE.Mesh(
        new THREE.RingGeometry(r - 400, r + 400, 64),
        new THREE.MeshBasicMaterial({
          color: 0x3a6088,
          transparent: true,
          opacity: op,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      rr.rotation.x = -Math.PI / 2
      rr.position.y = ship[1] - 60
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

    for (const a of ensureSystemAnomalies(system, gameState.galaxy)) {
      if (a.status === 'completed' || a.status === 'despawning') continue
      const known = a.fullyScanned
      const live = computeProbeSignal(a, probePos, cls)
      const sig = Math.max(a.signal ?? 0, live)

      // Always highly visible — unscanned sites are huge purple beacons so
      // you can form probes on the ideal-range rings without hunting pixels.
      const col = known
        ? a.type === 'alien_incursion'
          ? 0xff5533
          : 0xff90ff
        : 0xe070ff
      const coreR = known ? 6500 : 5500 + sig * 3500
      const group = new THREE.Group()
      group.position.fromArray(a.position)

      // Solid bright diamond core
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
      // Wire overlay for depth
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

      // Outer glow sphere
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(coreR * 1.7, 16, 12),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: known ? 0.35 : 0.28 + pulse * 0.2,
          depthWrite: false
        })
      )
      group.add(glow)

      // Ideal probe-formation rings at scan ranges (matches computeProbeSignal idealR ≈ 12km)
      // Outer ring = max useful range (~4× ideal); middle = ideal; inner = tight lock.
      const idealR = known ? 5000 : IDEAL_PROBE_R
      for (const [mul, thickness, op] of [
        [0.45, 600, 0.55],
        [1.0, 900, 0.95], // primary place-here ring
        [2.0, 700, 0.55],
        [3.5, 500, 0.35]
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

      // Thick vertical beacon beam (very hard to miss)
      const spikeH = 50000
      const spike = new THREE.Mesh(
        new THREE.CylinderGeometry(500, 900, spikeH, 8),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.55 + pulse * 0.25,
          depthWrite: false
        })
      )
      spike.position.y = spikeH * 0.35
      group.add(spike)
      // Thin bright core of the beam
      const spikeCore = new THREE.Mesh(
        new THREE.CylinderGeometry(180, 180, spikeH * 1.1, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.7,
          depthWrite: false
        })
      )
      spikeCore.position.y = spikeH * 0.35
      group.add(spikeCore)

      // Ground pad — bright disc you place around
      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(idealR * 1.05, 48),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.18 + pulse * 0.1,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      pad.rotation.x = -Math.PI / 2
      pad.position.y = -40
      group.add(pad)

      // Crosshair arms on the placement plane
      for (const rot of [0, Math.PI / 2]) {
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(idealR * 2.2, 200, 500),
          new THREE.MeshBasicMaterial({
            color: 0xffc0ff,
            transparent: true,
            opacity: 0.65,
            depthWrite: false
          })
        )
        arm.rotation.y = rot
        arm.position.y = -20
        group.add(arm)
      }

      group.userData.anomalyId = a.id
      group.userData.core = core
      anomalyGroup.add(group)

      // Always draw probe → anomaly guide lines so formation is obvious
      for (const p of probes) {
        if (!p.active) continue
        const d = Math.hypot(
          p.position[0] - a.position[0],
          p.position[1] - a.position[1],
          p.position[2] - a.position[2]
        )
        const near = d < idealR * 4
        const pts = [
          new THREE.Vector3(...p.position),
          new THREE.Vector3(...a.position)
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
    const list = ensureSystemAnomalies(system, gameState.galaxy).filter(
      (a) => a.status !== 'completed' && a.status !== 'despawning'
    )
    const rows = list.map((a) => {
      const live = computeProbeSignal(a, probePos, cls)
      const sig = Math.max(a.signal ?? 0, live)
      const pct = Math.round((a.fullyScanned ? 1 : a.scanProgress ?? 0) * 100)
      const nm = a.fullyScanned
        ? escapeHtml(a.displayName)
        : sig > 0.08
          ? 'Spatial Anomaly'
          : 'Unidentified'
      const distKm = Math.round(
        Math.hypot(
          a.position[0] - gameState.player.ship.position[0],
          a.position[1] - gameState.player.ship.position[1],
          a.position[2] - gameState.player.ship.position[2]
        ) / 1000
      )
      return `<div class="ssm-sig-row" data-anomaly-id="${escapeHtml(a.id)}" style="cursor:pointer" title="Click to focus camera">
          <span class="nm${a.fullyScanned ? ' done' : ''}">◆ ${nm}</span>
          <span>${a.fullyScanned ? 'LOCKED' : `${Math.round(sig * 100)}% · ${distKm}km`}</span>
          <div class="ssm-bar"><i style="width:${pct}%"></i></div>
        </div>`
    })
    sigListEl.innerHTML = rows.length
      ? rows.join('') +
        `<div style="margin-top:8px;font-size:10px;opacity:0.65;line-height:1.4">Click a signal to center the map. Place probes on the bright purple ring (~12 km from the beacon).</div>`
      : `<div style="opacity:0.5;font-size:11px">No signatures in this system.</div>`
    sigListEl.querySelectorAll('.ssm-sig-row[data-anomaly-id]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.anomalyId
        const a = list.find((x) => x.id === id)
        if (!a) return
        focusTarget = [...a.position]
        // Frame close enough to see rings and place probes
        orbitDist = Math.max(45000, Math.min(160000, IDEAL_PROBE_R * 8))
        orbitPitch = 0.85
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
    // Keep Y on the placement plane (ship altitude).
    p[1] = gameState.player.ship.position[1]
  }

  /**
   * Center the map on the system star (local origin) and zoom so bodies /
   * anomalies around the star fit in view.
   */
  function frameSystem() {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const ship = gameState.player.ship.position
    // Star is at local origin; keep look-at on the ecliptic plane at ship altitude.
    focusTarget = [0, ship[1], 0]
    if (!system) {
      orbitDist = 180000
      orbitPitch = 0.95
      return
    }
    let maxD = 50000
    for (const b of system.bodies ?? []) {
      if (!b.position) continue
      const d = Math.hypot(b.position[0], b.position[2])
      if (d > maxD) maxD = d
    }
    const anomalies = ensureSystemAnomalies(system, gameState.galaxy).filter(
      (a) => a.status !== 'completed' && a.status !== 'despawning'
    )
    for (const a of anomalies) {
      const d = Math.hypot(a.position[0], a.position[2])
      if (d > maxD) maxD = d
    }
    // Also keep the player in frame when they're far from the star.
    const shipD = Math.hypot(ship[0], ship[2])
    if (shipD > maxD) maxD = shipD
    // High overhead so rings / grid read clearly
    orbitPitch = 0.95
    orbitDist = Math.max(90000, Math.min(500000, maxD * 1.65 + 35000))
  }

  function placeSelectedProbeAt(world) {
    const p = probes[selectedProbe]
    if (!p) return
    p.active = true
    p.position = [world.x, world.y, world.z]
    p.mesh.visible = true
    p.mesh.position.copy(world)
    renderProbeList()
  }

  function raycastPlane(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 2 - 1
    const y = -((clientY - rect.top) / rect.height) * 2 + 1
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(x, y), camera)
    // Horizontal plane at player Y
    const y0 = gameState.player.ship.position[1]
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0)
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
      orbitDist = Math.max(25000, Math.min(900000, orbitDist))
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
    if (!probes.some((p) => p.active)) deployFormation()
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
