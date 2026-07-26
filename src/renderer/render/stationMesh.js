import * as THREE from 'three'
import { mulberry32, range, intRange, pick } from '../procgen/prng.js'
import {
  stationMaterialMaps,
  cloneStationMaps,
  retileUVsTriplanar,
  STATION_NORMAL_STRENGTH
} from './textures.js'
import {
  buildStationFromFreeModel,
  addStationLighting,
  STATION_TYPE_COUNT,
  stationModelsReady
} from './stationModels.js'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Dense PBR plating — maps are cloned per material with UV offsets so
// modules don't share an identical tile phase.
const stationMaps = (role, strength = STATION_NORMAL_STRENGTH, rng = null) => {
  const base = stationMaterialMaps(role, strength)
  if (!rng || !base.map) return base
  return cloneStationMaps(base, {
    offsetU: rng(),
    offsetV: rng(),
    rot: (rng() - 0.5) * 0.15
  })
}

function hullMaterials(rng, { settlement = false } = {}) {
  // Long-service exterior: warm oxidized greys (light enough to read in scene fill).
  //
  // Hull, panel and accent used to sit within ~0.1 lightness of each other at
  // low saturation, so a station resolved as one flat brown mass however good
  // the plating maps were. Spreading them apart in VALUE is what gives the
  // structure legible parts: mid hull, clearly darker panels, brighter trim.
  const warm = rng() < 0.7
  const hue = warm ? range(rng, 18, 42) : range(rng, 195, 215)
  const hullColor = new THREE.Color().setHSL(hue / 360, range(rng, 0.06, 0.14), range(rng, 0.5, 0.6))
  const accentColor = new THREE.Color().setHSL(
    ((hue + range(rng, 80, 140)) % 360) / 360,
    range(rng, 0.4, 0.6),
    range(rng, 0.55, 0.66)
  )
  // Recessed plating reads as a separate material, not a shade of the hull.
  const panelColor = hullColor.clone().offsetHSL(range(rng, -0.02, 0.04), 0.03, range(rng, -0.24, -0.15))
  const hullRole = settlement ? 'settlementHull' : 'hull'
  const panelRole = settlement ? 'settlementPanel' : 'panel'
  const nStr = settlement ? STATION_NORMAL_STRENGTH * 1.0 : STATION_NORMAL_STRENGTH * 0.9
  const worn = (maps) => {
    if (maps.aoMap) maps.aoMapIntensity = 0.95
    return maps
  }
  return {
    hull: new THREE.MeshStandardMaterial({
      color: hullColor,
      metalness: 0.45,
      roughness: 0.62,
      envMapIntensity: 1.35,
      ...worn(stationMaps(hullRole, nStr, rng))
    }),
    accent: new THREE.MeshStandardMaterial({
      color: accentColor,
      metalness: 0.55,
      roughness: 0.45,
      envMapIntensity: 1.5,
      ...worn(stationMaps('accent', nStr * 1.05, rng))
    }),
    panel: new THREE.MeshStandardMaterial({
      color: panelColor,
      metalness: 0.5,
      roughness: 0.72,
      envMapIntensity: 1.2,
      ...worn(stationMaps(panelRole, nStr * 1.1, rng))
    }),
    // noWindows: portholes must not be punched into glazing, radiator fins or
    // solar arrays — see addStationLighting's surface filter.
    window: new THREE.MeshStandardMaterial({
      userData: { noWindows: true },
      color: 0x152838,
      emissive: accentColor.clone().multiplyScalar(0.4),
      emissiveIntensity: 0.55,
      metalness: 0.2,
      roughness: 0.28,
      transparent: true,
      opacity: 0.9
    }),
    solar: new THREE.MeshStandardMaterial({
      userData: { noWindows: true },
      color: 0x9aabbc,
      emissive: 0x041018,
      emissiveIntensity: 0.12,
      metalness: 0.7,
      roughness: 0.55,
      envMapIntensity: 0.85,
      ...worn(stationMaps('solar', nStr * 0.95, rng))
    }),
    radiator: new THREE.MeshStandardMaterial({
      userData: { noWindows: true },
      color: 0x5a4038,
      metalness: 0.55,
      roughness: 0.7,
      emissive: 0x120806,
      emissiveIntensity: 0.1,
      envMapIntensity: 0.7,
      ...worn(stationMaps('radiator', nStr, rng))
    })
  }
}

/**
 * Dense worn plating UVs + uv2 for aoMap (procedural meshes are world-sized).
 * Returns the geometry to use — per-face triplanar splits indexed meshes and
 * produces a new BufferGeometry, so the caller has to swap it onto the mesh.
 */
function ensureWornUVs(geometry) {
  if (!geometry?.attributes?.position) return geometry
  if (!geometry.userData.stationRetiled) {
    const retiled = retileUVsTriplanar(geometry, 0.32)
    retiled.userData.stationRetiled = true
    return retiled
  }
  if (geometry.attributes.uv && !geometry.attributes.uv2) {
    geometry.setAttribute('uv2', geometry.attributes.uv)
  }
  return geometry
}

function edgesFor(geometry, color = 0x0a0a0a) {
  // Soft panel seams only — heavy EdgesGeometry fought the normal maps.
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 28),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 })
  )
}

function addBeacon(group, position, color, phase, radius = 0.55) {
  const light = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), new THREE.MeshBasicMaterial({ color }))
  light.position.copy(position)
  group.add(light)

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 2.6, 12, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  glow.position.copy(position)
  group.add(glow)

  if (!group.userData.beacons) group.userData.beacons = []
  group.userData.beacons.push({ glow, phase })
}

function addGlowRing(group, radius, tube, color, rotationX = Math.PI / 2) {
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 10, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
  )
  glow.rotation.x = rotationX
  group.add(glow)
}

// Thin reinforcement rings on cylindrical hulls (reads more "built" than bare loft).
function addHullBands(group, mats, radius, y0, y1, count = 3) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const y = y0 + (y1 - y0) * t
    const band = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.02, radius * 0.04, 8, 40), mats.panel)
    band.rotation.x = Math.PI / 2
    band.position.y = y
    group.add(band)
  }
}

function addAntennaDish(group, mats, position, radius = 2.2) {
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, radius * 2.2, 8), mats.panel)
  mast.position.copy(position)
  mast.position.y += radius * 0.6
  group.add(mast)
  const dish = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), mats.accent)
  dish.position.copy(position)
  dish.position.y += radius * 1.7
  dish.rotation.x = -Math.PI / 3.2
  group.add(dish)
}

// Row of lit portholes along a cylinder / flat face.
function addWindowRow(group, mats, { count, radius, y, z = 0, axis = 'y' }) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.18), mats.window)
    if (axis === 'y') {
      win.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius + z)
      win.lookAt(0, y, 0)
    } else {
      win.position.set((i - (count - 1) / 2) * 1.15, y, radius)
    }
    group.add(win)
  }
}

function addSolarArray(group, mats, origin, length, width, tilt = 0.15) {
  // Framed multi-panel wing rather than a single slab.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(length + 0.4, 0.18, width + 0.35), mats.panel)
  frame.position.copy(origin)
  frame.rotation.z = tilt
  group.add(frame)
  const cols = 3
  const rows = 2
  const cellL = (length - 0.3) / cols
  const cellW = (width - 0.25) / rows
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(cellL * 0.92, 0.1, cellW * 0.9), mats.solar)
      const ox = (c - (cols - 1) / 2) * cellL
      const oz = (r - (rows - 1) / 2) * cellW
      panel.position.set(origin.x + ox * Math.cos(tilt), origin.y + ox * Math.sin(tilt) + 0.06, origin.z + oz)
      panel.rotation.z = tilt
      group.add(panel)
    }
  }
  const boomLen = Math.abs(origin.x) * 0.85 + 1.2
  const boom = new THREE.Mesh(new THREE.BoxGeometry(boomLen, 0.32, 0.32), mats.panel)
  boom.position.set(origin.x * 0.42, origin.y, origin.z)
  group.add(boom)
  // Cross-brace.
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, width * 0.7), mats.panel)
  brace.position.set(origin.x * 0.7, origin.y, origin.z)
  group.add(brace)
}

function addRadiatorFin(group, mats, origin, size) {
  // Stack of thin radiator plates.
  const stack = 3
  for (let i = 0; i < stack; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.045, size * 0.55), mats.radiator)
    fin.position.set(origin.x, origin.y + (i - 1) * size * 0.08, origin.z)
    group.add(fin)
  }
  const spine = new THREE.Mesh(new THREE.BoxGeometry(size * 0.12, size * 0.28, size * 0.12), mats.panel)
  spine.position.copy(origin)
  group.add(spine)
}

function addDockingPort(group, mats, position, facing = new THREE.Vector3(0, 0, 1)) {
  const f = facing.clone().normalize()
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.85, 1.4, 16), mats.accent)
  collar.position.copy(position)
  collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), f)
  group.add(collar)
  const outer = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 8, 24), mats.panel)
  outer.position.copy(position).addScaledVector(f, 0.35)
  outer.quaternion.copy(collar.quaternion)
  outer.rotateX(Math.PI / 2)
  group.add(outer)
  const hatch = new THREE.Mesh(new THREE.CircleGeometry(1.15, 20), mats.panel)
  hatch.position.copy(position).addScaledVector(f, 0.75)
  hatch.lookAt(position.clone().add(f))
  group.add(hatch)
}

function addTrussModule(group, mats, from, to) {
  const mid = from.clone().add(to).multiplyScalar(0.5)
  const len = from.distanceTo(to)
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, len), mats.panel)
  beam.position.copy(mid)
  beam.lookAt(to)
  beam.rotateX(Math.PI / 2)
  group.add(beam)
}

// The classic ring station — also used for the main-menu flyby background
// (createHud-independent decoration), so its exact structure (a child named
// 'ring' that the flyby spins) must stay stable regardless of the variety
// added below for in-game stations/settlements.
export function buildStationMesh() {
  const group = new THREE.Group()
  // Worn menu flyby palette (fixed, not seeded off a body id).
  const mats = {
    hull: new THREE.MeshStandardMaterial({
      color: 0x6a6258, metalness: 0.48, roughness: 0.68, envMapIntensity: 0.75, ...stationMaps('hull')
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0x3a7a88, metalness: 0.42, roughness: 0.62, envMapIntensity: 0.8, ...stationMaps('accent')
    }),
    panel: new THREE.MeshStandardMaterial({
      color: 0x3a3530, metalness: 0.45, roughness: 0.72, envMapIntensity: 0.7, ...stationMaps('panel')
    }),
    solar: new THREE.MeshStandardMaterial({
      color: 0x9aabbc,
      metalness: 0.7,
      roughness: 0.55,
      emissive: 0x061428,
      emissiveIntensity: 0.12,
      envMapIntensity: 0.85,
      ...stationMaps('solar')
    }),
    radiator: new THREE.MeshStandardMaterial({
      color: 0x5a4038, metalness: 0.55, roughness: 0.7, envMapIntensity: 0.7, ...stationMaps('radiator')
    }),
    window: new THREE.MeshStandardMaterial({
      color: 0x1a3040,
      emissive: 0x2a6070,
      emissiveIntensity: 0.7,
      metalness: 0.15,
      roughness: 0.18,
      transparent: true,
      opacity: 0.92
    })
  }

  const coreGeometry = new THREE.CylinderGeometry(5.5, 5.5, 24, 20)
  const core = new THREE.Mesh(coreGeometry, mats.hull)
  group.add(core)
  addHullBands(group, mats, 5.5, -8, 8, 4)
  addWindowRow(group, mats, { count: 14, radius: 5.65, y: 2 })
  addWindowRow(group, mats, { count: 14, radius: 5.65, y: -4 })

  // Hab ring with thicker tube (pressure shell). Name 'ring' required by menu flyby.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(17, 2.15, 14, 56), mats.accent)
  ring.rotation.x = Math.PI / 2
  ring.name = 'ring'
  group.add(ring)
  addGlowRing(group, 17, 2.9, 0x4fc3d9)
  // Ring panel segments (visual only — don't rename 'ring').
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    const node = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), mats.panel)
    node.position.set(Math.cos(a) * 17, 0, Math.sin(a) * 17)
    group.add(node)
  }

  // Spoke arms + docking nodes.
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 12, 10), mats.hull)
    arm.rotation.z = Math.PI / 2
    arm.rotation.y = -angle
    arm.position.set(Math.cos(angle) * 11.5, 0, Math.sin(angle) * 11.5)
    group.add(arm)
    const node = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 3.4), mats.panel)
    node.position.set(Math.cos(angle) * 17, 0, Math.sin(angle) * 17)
    group.add(node)
    addDockingPort(group, mats, new THREE.Vector3(Math.cos(angle) * 19.2, 0, Math.sin(angle) * 19.2), new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)))
  }

  // Command modules top/bottom.
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 5, 14), mats.accent)
  cap.position.y = 14.5
  group.add(cap)
  const cap2 = cap.clone()
  cap2.position.y = -14.5
  group.add(cap2)
  addAntennaDish(group, mats, new THREE.Vector3(0, 16.5, 0), 1.8)

  addSolarArray(group, mats, new THREE.Vector3(28, 0, 0), 20, 6.5, 0.08)
  addSolarArray(group, mats, new THREE.Vector3(-28, 0, 0), 20, 6.5, -0.08)
  addRadiatorFin(group, mats, new THREE.Vector3(0, 6, 8), 6)

  addBeacon(group, new THREE.Vector3(0, 18, 0), 0xff4040, 0)
  addBeacon(group, new THREE.Vector3(0, -18, 0), 0xff4040, Math.PI)

  group.add(edgesFor(coreGeometry))
  return group
}

// Tall industrial spire with stacked decks, solar top, radiators.
function buildSpireStation(rng) {
  const mats = hullMaterials(rng)
  const group = new THREE.Group()

  const bodyHeight = 32
  const coreGeometry = new THREE.CylinderGeometry(4.5, 7.5, bodyHeight, 18)
  group.add(new THREE.Mesh(coreGeometry, mats.hull))
  addHullBands(group, mats, 5.5, -10, 10, 5)
  addWindowRow(group, mats, { count: 14, radius: 5.4, y: 4 })
  addWindowRow(group, mats, { count: 14, radius: 6.4, y: -6 })
  addWindowRow(group, mats, { count: 12, radius: 5.0, y: 10 })

  const spire = new THREE.Mesh(new THREE.ConeGeometry(4.5, 14, 16), mats.accent)
  spire.position.y = bodyHeight / 2 + 7
  group.add(spire)
  addAntennaDish(group, mats, new THREE.Vector3(2.5, bodyHeight / 2 + 2, 0), 1.6)

  const platformCount = intRange(rng, 2, 4)
  for (let i = 0; i < platformCount; i++) {
    const platformRadius = 9 + i * 1.4
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(platformRadius, platformRadius, 1.1, 24), mats.panel)
    platform.position.y = -bodyHeight / 2 + 5 + i * 8
    group.add(platform)
    const lip = new THREE.Mesh(new THREE.TorusGeometry(platformRadius, 0.28, 8, 36), mats.accent)
    lip.rotation.x = Math.PI / 2
    lip.position.y = platform.position.y + 0.6
    group.add(lip)
    if (i === platformCount - 1) addGlowRing(group, platformRadius, 0.35, mats.accent.color, Math.PI / 2)
  }

  addSolarArray(group, mats, new THREE.Vector3(14, bodyHeight * 0.15, 0), 12, 5, 0.1)
  addSolarArray(group, mats, new THREE.Vector3(-14, bodyHeight * 0.15, 0), 12, 5, -0.1)
  addRadiatorFin(group, mats, new THREE.Vector3(0, -2, 10), 7)
  addDockingPort(group, mats, new THREE.Vector3(0, -bodyHeight / 2 + 2, 8), new THREE.Vector3(0, 0, 1))

  addBeacon(group, new THREE.Vector3(0, bodyHeight / 2 + 15, 0), 0xff4040, rng() * Math.PI * 2)
  group.add(edgesFor(coreGeometry))
  return group
}

// Boxy modular hub — ISS-style pressurized modules + trusses.
function buildModularStation(rng) {
  const mats = hullMaterials(rng)
  const group = new THREE.Group()

  const coreSize = 10
  const coreGeometry = new THREE.BoxGeometry(coreSize, coreSize * 0.85, coreSize)
  group.add(new THREE.Mesh(coreGeometry, mats.hull))
  // Beveled corner caps on the hub.
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mats.panel)
        cap.position.set(sx * 4.2, sy * 3.4, sz * 4.2)
        group.add(cap)
      }
    }
  }
  addWindowRow(group, mats, { count: 8, radius: coreSize / 2 + 0.1, y: 1, axis: 'flat' })

  // Central truss spine with lattice.
  const spine = new THREE.Mesh(new THREE.BoxGeometry(28, 1.0, 1.0), mats.panel)
  group.add(spine)
  for (let i = -3; i <= 3; i++) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.2, 0.25), mats.panel)
    cross.position.set(i * 3.5, 0, 0)
    group.add(cross)
  }

  const directions = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1]
  ]
  for (const dir of directions) {
    if (rng() < 0.28) continue
    const size = range(rng, 4, 8)
    const strutLen = range(rng, 2.5, 5)
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, strutLen, 10), mats.panel)
    const isHab = rng() < 0.55
    const module = isHab
      ? new THREE.Mesh(new THREE.CylinderGeometry(size * 0.4, size * 0.4, size * 1.1, 16), mats.accent)
      : new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.7, size), mats.accent)
    if (isHab && dir[1] === 0) module.rotation.z = Math.PI / 2
    if (isHab && dir[2] !== 0) module.rotation.x = Math.PI / 2

    const strutCenter = coreSize / 2 + strutLen / 2
    const moduleCenter = coreSize / 2 + strutLen + size / 2
    strut.position.set(dir[0] * strutCenter, dir[1] * strutCenter, dir[2] * strutCenter)
    module.position.set(dir[0] * moduleCenter, dir[1] * moduleCenter, dir[2] * moduleCenter)
    if (dir[0] !== 0) strut.rotation.z = Math.PI / 2
    if (dir[2] !== 0) strut.rotation.x = Math.PI / 2
    group.add(strut)
    group.add(module)

    const beaconOffset = dir.map((d) => d * (moduleCenter + size / 2 + 0.4))
    addBeacon(group, new THREE.Vector3(...beaconOffset), 0xffcf4f, rng() * Math.PI * 2, 0.45)
  }

  addSolarArray(group, mats, new THREE.Vector3(18, 2, 0), 14, 5.5, 0.12)
  addSolarArray(group, mats, new THREE.Vector3(-18, -1, 0), 14, 5.5, -0.1)
  addRadiatorFin(group, mats, new THREE.Vector3(0, 8, 0), 6)
  addDockingPort(group, mats, new THREE.Vector3(0, 0, coreSize / 2 + 1.5), new THREE.Vector3(0, 0, 1))
  addAntennaDish(group, mats, new THREE.Vector3(3, coreSize * 0.5, -2), 1.5)

  group.add(edgesFor(coreGeometry))
  return group
}

// Gravity-ring habitat with offset command module (asymmetric station).
function buildRingHabitatStation(rng) {
  const mats = hullMaterials(rng)
  const group = new THREE.Group()

  const coreGeom = new THREE.CylinderGeometry(3.5, 3.5, 18, 18)
  const core = new THREE.Mesh(coreGeom, mats.hull)
  group.add(core)
  addHullBands(group, mats, 3.5, -6, 6, 3)

  const ringR = 16
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 2.2, 14, 56), mats.accent)
  ring.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.15
  group.add(ring)
  addGlowRing(group, ringR, 2.8, mats.accent.color, ring.rotation.x)

  // Three spokes (not four) — slight asymmetry.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + 0.2
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, ringR - 2, 10), mats.panel)
    arm.rotation.z = Math.PI / 2
    arm.rotation.y = -angle
    arm.position.set(Math.cos(angle) * ringR * 0.45, 0, Math.sin(angle) * ringR * 0.45)
    group.add(arm)
  }

  const cmd = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 8), mats.hull)
  cmd.position.set(4, 12, -2)
  group.add(cmd)
  addDockingPort(group, mats, new THREE.Vector3(4, 12, 3), new THREE.Vector3(0, 0, 1))
  addAntennaDish(group, mats, new THREE.Vector3(4, 14, -2), 1.4)

  addSolarArray(group, mats, new THREE.Vector3(22, 3, 0), 16, 4.5, 0.08)
  addRadiatorFin(group, mats, new THREE.Vector3(-6, -8, 0), 8)
  addWindowRow(group, mats, { count: 20, radius: ringR + 1.6, y: 0 })

  addBeacon(group, new THREE.Vector3(4, 15, -2), 0xff4040, rng() * Math.PI * 2)
  group.add(edgesFor(coreGeom))
  return group
}

// Drydock frame: open truss with a ship-sized berth.
function buildDrydockStation(rng) {
  const mats = hullMaterials(rng)
  const group = new THREE.Group()

  const frameL = 28
  const frameW = 16
  const frameH = 14
  // Corner posts.
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.2, frameH, 1.2), mats.panel)
      post.position.set(x * frameW / 2, 0, z * frameL / 2)
      group.add(post)
    }
  }
  // Longitudinal beams.
  for (const y of [-frameH / 2, frameH / 2]) {
    for (const x of [-frameW / 2, frameW / 2]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, frameL), mats.hull)
      beam.position.set(x, y, 0)
      group.add(beam)
    }
    for (const z of [-frameL / 2, frameL / 2]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(frameW, 1, 1), mats.hull)
      beam.position.set(0, y, z)
      group.add(beam)
    }
  }

  // Control shack offset to one side.
  const shack = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 6), mats.accent)
  shack.position.set(frameW / 2 + 5, -2, -4)
  group.add(shack)
  addDockingPort(group, mats, new THREE.Vector3(frameW / 2 + 5, -2, 0), new THREE.Vector3(0, 0, 1))

  addSolarArray(group, mats, new THREE.Vector3(0, frameH / 2 + 2, 0), 18, 5, 0)
  addBeacon(group, new THREE.Vector3(frameW / 2, frameH / 2 + 1, frameL / 2), 0xffcf4f, 0)
  addBeacon(group, new THREE.Vector3(-frameW / 2, frameH / 2 + 1, -frameL / 2), 0xff4040, Math.PI)

  return group
}

// Low dome + wide pad — still used as a station archetype in orbit.
function buildDomeStation(rng) {
  const mats = hullMaterials(rng)
  const group = new THREE.Group()

  const baseRadius = 12
  const baseGeometry = new THREE.CylinderGeometry(baseRadius, baseRadius * 1.12, 5, 28)
  const base = new THREE.Mesh(baseGeometry, mats.hull)
  base.position.y = -2.5
  group.add(base)
  // Skirt ring under the pad.
  const skirt = new THREE.Mesh(new THREE.TorusGeometry(baseRadius * 1.05, 0.35, 8, 40), mats.panel)
  skirt.rotation.x = Math.PI / 2
  skirt.position.y = -4.8
  group.add(skirt)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(baseRadius * 0.82, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    mats.accent
  )
  group.add(dome)
  // Dome meridian ribs.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI
    const rib = new THREE.Mesh(new THREE.TorusGeometry(baseRadius * 0.82, 0.12, 6, 24, Math.PI), mats.panel)
    rib.rotation.y = a
    rib.rotation.z = Math.PI / 2
    group.add(rib)
  }
  addGlowRing(group, baseRadius * 1.02, 0.4, mats.accent.color, Math.PI / 2)

  const tower = new THREE.Mesh(new THREE.BoxGeometry(3.5, 10, 3.5), mats.panel)
  tower.position.set(baseRadius * 0.55, 3, -baseRadius * 0.2)
  group.add(tower)
  addAntennaDish(group, mats, new THREE.Vector3(baseRadius * 0.55, 7, -baseRadius * 0.2), 1.3)

  addSolarArray(group, mats, new THREE.Vector3(-baseRadius * 0.9, 1, baseRadius * 0.3), 10, 4, 0.2)
  addRadiatorFin(group, mats, new THREE.Vector3(baseRadius * 0.3, 0, baseRadius * 0.85), 5)
  addDockingPort(group, mats, new THREE.Vector3(0, -1, baseRadius + 1), new THREE.Vector3(0, 0, 1))
  addWindowRow(group, mats, { count: 16, radius: baseRadius * 0.75, y: 1.5 })

  addBeacon(group, new THREE.Vector3(baseRadius * 0.55, 9, -baseRadius * 0.2), 0xff4040, rng() * Math.PI * 2)
  group.add(edgesFor(baseGeometry))
  return group
}

// --- Surface settlements (distinct from free-floating stations) ------------

function buildSettlementDomeCluster(rng) {
  const mats = hullMaterials(rng, { settlement: true })
  const group = new THREE.Group()

  // Multi-tier landing pad.
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(14, 15.5, 1.4, 32), mats.panel)
  pad.position.y = -0.5
  group.add(pad)
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 0.35, 28), mats.hull)
  apron.position.y = 0.25
  group.add(apron)
  const mark = new THREE.Mesh(new THREE.RingGeometry(4, 5.2, 32), mats.accent)
  mark.rotation.x = -Math.PI / 2
  mark.position.y = 0.48
  group.add(mark)
  const mark2 = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.7, 24), mats.accent)
  mark2.rotation.x = -Math.PI / 2
  mark2.position.y = 0.49
  group.add(mark2)

  // Central habitat dome with skirt.
  const mainDome = new THREE.Mesh(
    new THREE.SphereGeometry(6, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    mats.hull
  )
  mainDome.position.set(0, 0, -2)
  group.add(mainDome)
  const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.8, 1.2, 24), mats.panel)
  domeBase.position.set(0, 0.2, -2)
  group.add(domeBase)
  addWindowRow(group, mats, { count: 10, radius: 5.9, y: 2.2, z: -2 })

  const satelliteCount = intRange(rng, 3, 5)
  for (let i = 0; i < satelliteCount; i++) {
    const a = (i / satelliteCount) * Math.PI * 2 + rng() * 0.4
    const dist = range(rng, 7, 11)
    const r = range(rng, 2.2, 3.8)
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      i % 2 === 0 ? mats.accent : mats.hull
    )
    dome.position.set(Math.cos(a) * dist, 0, Math.sin(a) * dist)
    group.add(dome)
    const corridor = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, dist * 0.55, 10), mats.panel)
    corridor.rotation.z = Math.PI / 2
    corridor.rotation.y = -a
    corridor.position.set(Math.cos(a) * dist * 0.4, 0.7, Math.sin(a) * dist * 0.4 - 1)
    group.add(corridor)
  }

  addAntennaDish(group, mats, new THREE.Vector3(5, 0, 4), 2.0)
  // Fuel tanks.
  for (const [x, z] of [[-10, 5], [-11.5, 7.5]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4.5, 12), mats.radiator)
    tank.position.set(x, 2.2, z)
    group.add(tank)
  }

  addBeacon(group, new THREE.Vector3(5, 13, 4), 0xff4040, rng() * Math.PI * 2, 0.4)
  addBeacon(group, new THREE.Vector3(-8, 1, -6), 0xffcf4f, Math.PI, 0.35)
  addSolarArray(group, mats, new THREE.Vector3(0, 6, -10), 9, 3.2, 0.2)
  return group
}

function buildSettlementOutpost(rng) {
  const mats = hullMaterials(rng, { settlement: true })
  const group = new THREE.Group()

  // Raised platform with edge lip.
  const platform = new THREE.Mesh(new THREE.BoxGeometry(20, 2, 16), mats.hull)
  platform.position.y = 0
  group.add(platform)
  const lip = new THREE.Mesh(new THREE.BoxGeometry(20.6, 0.35, 16.6), mats.panel)
  lip.position.y = 1.1
  group.add(lip)

  const blocks = [
    [0, 3, -2, 8, 6, 7],
    [6, 2.5, 3, 5, 5, 5],
    [-7, 2, 2, 4, 4, 6],
    [2, 4.5, 5, 3.5, 3, 3.5]
  ]
  for (const [x, y, z, w, h, d] of blocks) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rng() < 0.4 ? mats.accent : mats.panel)
    b.position.set(x, y, z)
    group.add(b)
    // Roofline strip.
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 1.05, 0.25, d * 1.05), mats.hull)
    roof.position.set(x, y + h / 2 + 0.15, z)
    group.add(roof)
  }
  // Windows on the main block face.
  for (let i = 0; i < 4; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.12), mats.window)
    win.position.set(-2.5 + i * 1.6, 3.2, 1.55)
    group.add(win)
  }

  for (let i = 0; i < 6; i++) {
    addBeacon(group, new THREE.Vector3(-9 + i * 3.5, 1.2, 7.5), 0xffcf4f, i * 0.7, 0.3)
  }

  const craneBase = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 5, 10), mats.panel)
  craneBase.position.set(-8, 4.5, -5)
  group.add(craneBase)
  const craneArm = new THREE.Mesh(new THREE.BoxGeometry(10, 0.55, 0.55), mats.hull)
  craneArm.position.set(-4, 7, -5)
  craneArm.rotation.z = -0.15
  group.add(craneArm)
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.35), mats.panel)
  hook.position.set(0.5, 5.5, -5)
  group.add(hook)

  addSolarArray(group, mats, new THREE.Vector3(0, 8, -6), 12, 3.5, 0.25)
  addAntennaDish(group, mats, new THREE.Vector3(6, 5, -2), 1.2)
  return group
}

function buildSettlementMinehead(rng) {
  const mats = hullMaterials(rng, { settlement: true })
  const group = new THREE.Group()

  // Ground apron.
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(12, 13, 0.8, 24), mats.panel)
  apron.position.y = -0.2
  group.add(apron)

  const legs = [[-3, -3], [3, -3], [-3, 3], [3, 3]]
  for (const [x, z] of legs) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.75, 14, 0.75), mats.panel)
    leg.position.set(x, 7, z)
    group.add(leg)
  }
  // Cross braces on headframe.
  for (const y of [4, 9, 13]) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.4, 0.4), mats.hull)
    cross.position.set(0, y, -3)
    group.add(cross)
    const cross2 = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.4, 0.4), mats.hull)
    cross2.position.set(0, y, 3)
    group.add(cross2)
  }
  const cap = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 8), mats.hull)
  cap.position.y = 14
  group.add(cap)
  // Sheave wheel.
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.25, 10, 24), mats.accent)
  wheel.position.set(0, 14.8, 0)
  wheel.rotation.y = Math.PI / 2
  group.add(wheel)

  const plant = new THREE.Mesh(new THREE.BoxGeometry(12, 5, 8), mats.accent)
  plant.position.set(10, 2.5, 0)
  group.add(plant)
  for (let i = 0; i < 3; i++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.15), mats.window)
    win.position.set(10 - 3 + i * 3, 3.2, 4.1)
    group.add(win)
  }
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 10, 16), mats.hull)
  silo.position.set(10, 5, 7)
  group.add(silo)
  for (const y of [3, 7]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.12, 8, 24), mats.panel)
    band.rotation.x = Math.PI / 2
    band.position.set(10, y, 7)
    group.add(band)
  }

  const conv = new THREE.Mesh(new THREE.BoxGeometry(10, 0.8, 1.5), mats.panel)
  conv.position.set(4, 3, 4)
  conv.rotation.z = -0.2
  group.add(conv)
  // Conveyor legs.
  for (const t of [0.2, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.5, 0.3), mats.panel)
    leg.position.set(4 - t * 5, 1.2, 4)
    group.add(leg)
  }

  addBeacon(group, new THREE.Vector3(0, 15, 0), 0xff4040, 0)
  addRadiatorFin(group, mats, new THREE.Vector3(10, 6, -5), 4)
  return group
}

function buildSettlementFarmBubble(rng) {
  const mats = hullMaterials(rng, { settlement: true })
  const group = new THREE.Group()

  const growMat = new THREE.MeshStandardMaterial({
    color: 0x2a5a40,
    emissive: 0x1a4030,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.78,
    metalness: 0.08,
    roughness: 0.35
  })

  // Pad under the farm.
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(13, 14, 0.9, 28), mats.panel)
  pad.position.y = -0.3
  group.add(pad)

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3
    const dist = 5 + (i % 2) * 2
    const r = 3.5 + (i % 2)
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), growMat)
    bubble.position.set(Math.cos(a) * dist, 2.5, Math.sin(a) * dist)
    group.add(bubble)
    // Frame rings on greenhouse.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, 0.08, 6, 28), mats.panel)
    ring.position.copy(bubble.position)
    ring.rotation.x = Math.PI / 2
    group.add(ring)
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(3, 3.5, 4, 16), mats.hull)
  hub.position.y = 2
  group.add(hub)
  addWindowRow(group, mats, { count: 8, radius: 3.3, y: 2.2 })

  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 6, 14), mats.panel)
  tank.position.set(9, 3, -3)
  group.add(tank)
  const tankCap = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.hull)
  tankCap.position.set(9, 6, -3)
  group.add(tankCap)

  addBeacon(group, new THREE.Vector3(0, 5, 0), 0x4fe0ff, rng() * Math.PI * 2)
  addSolarArray(group, mats, new THREE.Vector3(-10, 4, 0), 10, 4, 0.3)
  addAntennaDish(group, mats, new THREE.Vector3(2, 3, 6), 1.1)
  return group
}

// --- Parametric orbital archetypes ----------------------------------------

function coreBox(size, rng) {
  const h = size * range(rng, 0.7, 1.4)
  return { geometry: new THREE.BoxGeometry(size, h, size * range(rng, 0.7, 1.2)), height: h }
}
function coreCylinder(size, rng) {
  const h = size * range(rng, 1.1, 2.0)
  return { geometry: new THREE.CylinderGeometry(size * range(rng, 0.28, 0.5), size * range(rng, 0.3, 0.55), h, intRange(rng, 14, 20)), height: h }
}
function coreCone(size, rng) {
  const h = size * range(rng, 1.0, 1.8)
  return { geometry: new THREE.ConeGeometry(size * range(rng, 0.35, 0.55), h, intRange(rng, 12, 16)), height: h }
}
function coreSphere(size, rng) {
  const r = size * range(rng, 0.4, 0.6)
  return { geometry: new THREE.SphereGeometry(r, intRange(rng, 16, 24), intRange(rng, 12, 18)), height: r * 2 }
}
function coreTorus(size, rng) {
  const tube = size * range(rng, 0.12, 0.2)
  return {
    geometry: new THREE.TorusGeometry(size * range(rng, 0.45, 0.65), tube, 12, intRange(rng, 32, 48)),
    height: tube * 2,
    rotationX: Math.PI / 2
  }
}
const CORE_BUILDERS = [coreBox, coreCylinder, coreCone, coreSphere, coreTorus]

function accessoryRing(group, size, height, mats, rng) {
  const r = size * range(rng, 0.75, 1.15)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, size * 0.07, 12, 48), mats.accent)
  ring.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.35
  group.add(ring)
  addGlowRing(group, r, size * 0.1, mats.accent.color, ring.rotation.x)
}
function accessoryArms(group, size, height, mats, rng) {
  const count = intRange(rng, 2, 4) // not always even — asymmetry
  const armLen = size * range(rng, 0.8, 1.4)
  const phase = rng() * 0.5
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + phase
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.05, size * 0.05, armLen, 10), mats.hull)
    arm.rotation.z = Math.PI / 2
    arm.rotation.y = -angle
    arm.position.set(Math.cos(angle) * armLen * 0.5, (rng() - 0.5) * height * 0.15, Math.sin(angle) * armLen * 0.5)
    group.add(arm)
    const mod = new THREE.Mesh(new THREE.BoxGeometry(size * 0.3, size * 0.25, size * 0.3), mats.accent)
    mod.position.set(Math.cos(angle) * armLen, arm.position.y, Math.sin(angle) * armLen)
    group.add(mod)
  }
}
function accessorySpikes(group, size, height, mats, rng) {
  const count = intRange(rng, 2, 4)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng()
    const r = size * range(rng, 0.25, 0.55)
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.04, size * 0.08, size * range(rng, 0.5, 0.9), 10), mats.panel)
    spike.position.set(Math.cos(angle) * r, height * 0.45, Math.sin(angle) * r)
    group.add(spike)
  }
}
function accessoryModules(group, size, height, mats, rng) {
  const count = intRange(rng, 2, 4)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng() * 0.8
    const dist = size * range(rng, 0.65, 1.15)
    const moduleSize = size * range(rng, 0.22, 0.42)
    const module = rng() < 0.5
      ? new THREE.Mesh(new THREE.CylinderGeometry(moduleSize * 0.4, moduleSize * 0.4, moduleSize, 14), mats.accent)
      : new THREE.Mesh(new THREE.BoxGeometry(moduleSize, moduleSize * 0.7, moduleSize), mats.accent)
    module.position.set(Math.cos(angle) * dist, (rng() - 0.5) * height * 0.35, Math.sin(angle) * dist)
    if (rng() < 0.5) module.rotation.z = Math.PI / 2
    group.add(module)
  }
}
function accessoryStack(group, size, height, mats, rng) {
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.2, size * 0.28, size * range(rng, 0.35, 0.7), 14), mats.accent)
  cap.position.y = height / 2 + size * 0.15
  group.add(cap)
  if (rng() < 0.55) addAntennaDish(group, mats, new THREE.Vector3(size * 0.15, height / 2, 0), size * 0.12)
}
function accessoryPanels(group, size, height, mats, rng) {
  // Prefer solar-style panels, often only on one side.
  const both = rng() < 0.45
  const sides = both ? [-1, 1] : [rng() < 0.5 ? -1 : 1]
  for (const side of sides) {
    addSolarArray(group, mats, new THREE.Vector3(side * size * 1.1, height * 0.1, 0), size * 0.9, size * 0.4, side * 0.12)
  }
}
function accessoryRadiators(group, size, height, mats, rng) {
  const side = rng() < 0.5 ? -1 : 1
  addRadiatorFin(group, mats, new THREE.Vector3(side * size * 0.7, 0, size * 0.3), size * 0.55)
}
function accessoryDock(group, size, height, mats, rng) {
  const a = rng() * Math.PI * 2
  addDockingPort(group, mats, new THREE.Vector3(Math.cos(a) * size * 0.6, 0, Math.sin(a) * size * 0.6), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)))
}

const ACCESSORY_BUILDERS = [
  accessoryRing, accessoryArms, accessorySpikes, accessoryModules,
  accessoryStack, accessoryPanels, accessoryRadiators, accessoryDock
]
const BEACON_COLORS = [0xff4040, 0xffcf4f, 0x4fe0ff]

function buildParametricStation(structureRng, colorRng) {
  const mats = hullMaterials(colorRng)
  const group = new THREE.Group()
  const size = 12

  const coreBuilder = pick(structureRng, CORE_BUILDERS)
  const { geometry: coreGeometry, height, rotationX } = coreBuilder(size, structureRng)
  const core = new THREE.Mesh(coreGeometry, mats.hull)
  if (rotationX) core.rotation.x = rotationX
  group.add(core)

  // Occasional lateral offset of a bolted module for asymmetry.
  if (structureRng() < 0.4) {
    const side = structureRng() < 0.5 ? -1 : 1
    const pod = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.2, size * 0.2, size * 0.55, 8),
      mats.accent
    )
    pod.rotation.z = Math.PI / 2
    pod.position.set(side * size * 0.55, height * 0.1, 0)
    group.add(pod)
  }

  const accessoryCount = intRange(structureRng, 2, 4)
  const chosen = new Set()
  while (chosen.size < accessoryCount) chosen.add(pick(structureRng, ACCESSORY_BUILDERS))
  for (const accessoryFn of chosen) accessoryFn(group, size, height, mats, structureRng)

  addBeacon(group, new THREE.Vector3(0, height / 2 + 1, 0), pick(structureRng, BEACON_COLORS), colorRng() * Math.PI * 2)
  // Second beacon off-axis.
  if (structureRng() < 0.6) {
    addBeacon(
      group,
      new THREE.Vector3(size * 0.4, height * 0.2, -size * 0.3),
      pick(structureRng, BEACON_COLORS),
      colorRng() * Math.PI * 2,
      0.4
    )
  }
  group.add(edgesFor(coreGeometry))
  return group
}

// Exactly three orbital station types — each assembled from free Kenney Space
// Kit GLBs (CC0). See stationModels.js. Procedural builders above remain as
// fallback if models haven't finished loading, and for settlements / menu.
const STATION_FALLBACKS = [buildRingHabitatStation, buildHangarComplexFallback, buildIndustrialGateFallback]

function buildHangarComplexFallback(rng) {
  // Lightweight stand-in until GLBs load (or if a module failed).
  return buildModularStation(rng)
}
function buildIndustrialGateFallback(rng) {
  return buildSpireStation(rng)
}

const SETTLEMENT_VARIANTS = [
  buildSettlementDomeCluster,
  buildSettlementOutpost,
  buildSettlementMinehead,
  buildSettlementFarmBubble
]

// Picks station/settlement mesh deterministically from body id.
// Stations: one of exactly three free-model archetypes (tinted per body).
// Settlements: procedural surface variants (unchanged).
export function buildStationMeshForBody(body) {
  const rng = mulberry32(hashString(body.id))
  const isSettlement = body.kind === 'settlement'
  let group
  if (isSettlement) {
    const variant = SETTLEMENT_VARIANTS[Math.floor(rng() * SETTLEMENT_VARIANTS.length)]
    group = variant(rng)
    group.userData.spinSpeed = 0
    // Lit windows so a surface base is visible on a planet's night side too.
    addStationLighting(group, rng, { strobes: false })
  } else {
    const typeIndex = Math.floor(rng() * STATION_TYPE_COUNT)
    group = stationModelsReady()
      ? buildStationFromFreeModel(typeIndex, rng)
      : null
    if (!group) {
      group = STATION_FALLBACKS[typeIndex](rng)
    }
    group.userData.stationType = typeIndex
    group.userData.spinSpeed = 0.006 + rng() * 0.01
  }
  // Dense worn panel UVs (procedural) / free models already retiled in tint.
  group.traverse((o) => {
    // Skip emissive lights: they carry no plating map, and retiling them
    // replaces their geometry for no reason.
    if (o.userData.stationLight) return
    if (o.isMesh && o.geometry && !o.geometry.userData.stationRetiled) {
      o.geometry = ensureWornUVs(o.geometry)
    }
  })
  return group
}

// Pulses beacon glow halos and applies the slow idle spin set by
// buildStationMeshForBody — driven by dt/elapsed (gameState.simTime), never
// wall-clock time. Safe no-op for any mesh without that userData (planets,
// asteroid fields, the menu's own buildStationMesh() instance).
export function updateStationMesh(mesh, elapsed, dt) {
  if (mesh.userData.spinSpeed) mesh.rotation.y += mesh.userData.spinSpeed * dt
  if (mesh.userData.beacons) {
    for (const beacon of mesh.userData.beacons) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + beacon.phase)
      beacon.glow.material.opacity = 0.15 + pulse * 0.35
    }
  }
  // Nav strobes: a short sharp flash on a ~2s cycle, not the beacons' slow
  // breathing, so the two read as different pieces of hardware.
  if (mesh.userData.strobes) {
    for (const s of mesh.userData.strobes) {
      const cycle = (elapsed * 0.5 + s.phase) % 1
      const flash = cycle < 0.12 ? 1 - cycle / 0.12 : 0
      s.halo.material.opacity = 0.06 + flash * 0.55
      s.core.visible = flash > 0.02
    }
  }
  // Only a minority of windows flicker — a whole hull blinking looks broken.
  if (mesh.userData.windows) {
    for (const w of mesh.userData.windows) {
      const n = Math.sin(elapsed * w.speed + w.phase) * Math.sin(elapsed * w.speed * 0.37 + w.phase)
      w.mesh.material.opacity = 0.55 + 0.45 * (0.5 + 0.5 * n)
    }
  }
}
