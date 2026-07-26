/**
 * Docking-bay interior backdrop.
 *
 * Themes:
 *  - core / mid  — polished station bays (neon, busy)
 *  - outer       — rusty / gritty rim stations
 *  - palace      — SerNub's Pleasure Palace (fanciest)
 *  - settlement  — slightly dirty outpost bays
 *
 * Geometry: procedural shell + Kenney Space Station Kit dressing +
 * Quaternius Ultimate Space Kit props/activity when preloaded.
 */
import * as THREE from 'three'
import { stationMaterialMaps, retileUVsTriplanar } from './textures.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  placeInteriorModule,
  applyInteriorTint,
  hasInteriorModule,
  interiorModelsReady
} from './interiorModels.js'

export const INTERIOR_THEMES = ['core', 'mid', 'outer', 'palace', 'settlement']

/**
 * World scale for station/settlement docking bays (structure + décor).
 * Ship park/entry offsets in main.js use the same factor.
 */
export const INTERIOR_WORLD_SCALE = 3
/**
 * Local scale for landed ships / vehicles / workers / drones.
 * Counteracts INTERIOR_WORLD_SCALE so they stay ~player-ship sized
 * (the player mesh is not parented under the bay group).
 */
const ACTOR_SCALE = 1 / INTERIOR_WORLD_SCALE

const BAY_WIDTH = 72
const BAY_HEIGHT = 48
const BAY_LENGTH = 150
const FLOOR_Y = -BAY_HEIGHT / 2

const THEMES = {
  core: {
    wall: 0x4a5d78,
    floor: 0x2e3848,
    beam: 0x5a6e88,
    accent: 0x4fc3d9,
    hazard: 0xc45a18,
    panel: 0x2a3548,
    ambient: 0x5080a8,
    ambientI: 0.32,
    bayLight: 0xa8c8ff,
    bayI: 3.0,
    padLight: 0x6fe0ff,
    padI: 2.2,
    doorLight: 0x7ab0c8,
    doorI: 1.7,
    neon: true,
    luxury: false,
    grit: 0,
    activity: 'busy',
    propTint: { roughness: 0.45, metalness: 0.55 },
    shipScale: 1.15
  },
  mid: {
    wall: 0x3a4a62,
    floor: 0x2a3038,
    beam: 0x4a5a70,
    accent: 0x4fc3d9,
    hazard: 0xc45a18,
    panel: 0x2a3548,
    ambient: 0x406080,
    ambientI: 0.3,
    bayLight: 0x8fb3ff,
    bayI: 2.7,
    padLight: 0x4fc3d9,
    padI: 1.9,
    doorLight: 0x6a9aaa,
    doorI: 1.5,
    neon: true,
    luxury: false,
    grit: 0.15,
    activity: 'busy',
    propTint: { roughness: 0.55, metalness: 0.5 },
    shipScale: 1.05
  },
  outer: {
    wall: 0x3a342c,
    floor: 0x2a241c,
    beam: 0x4a4035,
    accent: 0xc47a3a,
    hazard: 0x8a4010,
    panel: 0x32281e,
    ambient: 0x403828,
    ambientI: 0.2,
    bayLight: 0xb08050,
    bayI: 1.85,
    padLight: 0xff8844,
    padI: 1.35,
    doorLight: 0x886040,
    doorI: 1.1,
    neon: false,
    luxury: false,
    grit: 1,
    activity: 'sparse',
    propTint: { color: 0xccaa88, roughness: 0.88, metalness: 0.25 },
    shipScale: 0.95
  },
  palace: {
    wall: 0x3a2a55,
    floor: 0x1a1228,
    beam: 0x6a4a8a,
    accent: 0xff66cc,
    hazard: 0xffd700,
    panel: 0x2a1a40,
    ambient: 0x7040a8,
    ambientI: 0.42,
    bayLight: 0xe0b0ff,
    bayI: 3.5,
    padLight: 0xff88ee,
    padI: 2.6,
    doorLight: 0xffaaee,
    doorI: 2.0,
    neon: true,
    luxury: true,
    grit: 0,
    activity: 'party',
    propTint: { roughness: 0.35, metalness: 0.65, emissive: 0x220033, emissiveIntensity: 0.15 },
    shipScale: 1.25
  },
  settlement: {
    wall: 0x3a4238,
    floor: 0x2a3028,
    beam: 0x4a5448,
    accent: 0x7aaa5a,
    hazard: 0xb07030,
    panel: 0x2e362c,
    ambient: 0x384838,
    ambientI: 0.26,
    bayLight: 0x90a880,
    bayI: 2.05,
    padLight: 0xa0c070,
    padI: 1.5,
    doorLight: 0x6a8860,
    doorI: 1.2,
    neon: false,
    luxury: false,
    grit: 0.55,
    activity: 'modest',
    propTint: { color: 0xb0b098, roughness: 0.78, metalness: 0.35 },
    shipScale: 1.0
  }
}

function mat(hex, mapsKey, extra = {}) {
  // `mapScale` was being passed straight into stationMaterialMaps' SECOND
  // parameter — which is normalStrength, not a scale. Every interior surface
  // was therefore running its normal map at ~0.3 instead of ~1.8, i.e. almost
  // flat. The values (0.25-0.72) only ever made sense as a tiling density, so
  // that is what they are used for now: carried on the material and consumed by
  // makeBox's triplanar re-UV below.
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    // Capped. Callers ask for 0.85-0.9, but a near-pure metal has almost no
    // diffuse response: under ambient/bounce light it resolves to black and its
    // albedo and normal maps never show at all, which is why the bay's walls
    // and floors read as blank voids. Real hangar decking and wall panels are
    // painted or coated, not mirror-finish, so a much lower metalness is both
    // more accurate and lets the textures actually appear. Bright trim and
    // machinery still pass through anything at or below the cap.
    metalness: Math.min(extra.metalness ?? 0.5, 0.45),
    roughness: extra.roughness ?? 0.7,
    emissive: extra.emissive ?? 0x000000,
    emissiveIntensity: extra.emissiveIntensity ?? 0,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
    ...stationMaterialMaps(mapsKey, extra.normalStrength ?? 1.7)
  })
  m.userData.uvDensity = extra.mapScale ?? 0.72
  return m
}

function glassMat(theme) {
  const fancy = theme.neon || theme.luxury
  return new THREE.MeshStandardMaterial({
    color: theme.luxury ? 0x3a2050 : 0x1a3048,
    transparent: true,
    opacity: fancy ? 0.4 : 0.48,
    metalness: 0.2,
    roughness: 0.15,
    emissive: theme.luxury ? 0x401060 : 0x0a2035,
    emissiveIntensity: fancy ? 0.45 : 0.28
  })
}

/** Thin emissive edge strip for sci-fi viewport framing (not a full-pane glow). */
function makeEdgeLight(w, h, d, color, x, y, z, group, anim, phase = 0) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75
    })
  )
  m.position.set(x, y, z)
  group.add(m)
  anim.lights.push({ mesh: m, phase, base: 0.55 })
  return m
}

/**
 * Chamfered box. A fabricated panel never has a perfectly sharp arris, and a
 * hard 90-degree edge is exactly what makes a interior read as stacked
 * programmer blocks. A small bevel catches a specular highlight along every
 * edge, so the same layout reads as machined metal instead.
 *
 * Not cached: main.js disposes every interior geometry when it rebuilds the
 * hangar, so a shared cache would hand out disposed buffers. One geometry per
 * box matches the ownership the old BoxGeometry call already had, and this
 * only runs on dock.
 */
function bevelledBox(w, h, d) {
  // Bevel scales off the thinnest face, so a slab stays a slab instead of
  // inflating into a pill, and is capped so big walls keep a crisp edge.
  const r = Math.min(0.07, Math.min(Math.abs(w), Math.abs(h), Math.abs(d)) * 0.2)
  if (!(r > 0.005)) return new THREE.BoxGeometry(w, h, d)
  return new RoundedBoxGeometry(w, h, d, 1, r)
}

function makeBox(w, h, d, material, x, y, z, group) {
  // Box UVs map one whole texture tile across each face, so a 20m wall showed a
  // single smeared copy and read as blank. Triplanar re-UV in local space tiles
  // by size instead — the same trick the station exteriors already use — so a
  // big floor gets many panels and a small crate gets one.
  // Returns a new geometry (it splits indexed meshes), so take the result.
  const geo = retileUVsTriplanar(bevelledBox(w, h, d), material?.userData?.uvDensity ?? 0.5)
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z)
  group.add(m)
  return m
}

function makeCylinder(rTop, rBot, h, segs, material, x, y, z, group, rotX = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs), material)
  m.position.set(x, y, z)
  m.rotation.x = rotX
  group.add(m)
  return m
}

function placeProp(group, name, x, y, z, opts = {}, tint = null) {
  const placed = placeInteriorModule(group, name, x, y, z, opts)
  if (placed && tint) applyInteriorTint(placed.obj, tint)
  return placed
}

function activityCounts(level) {
  switch (level) {
    case 'party':
      return { workers: 8, drones: 6, ships: 7, mechs: 2, rovers: 2, carts: 2 }
    case 'busy':
      return { workers: 6, drones: 5, ships: 6, mechs: 2, rovers: 2, carts: 2 }
    case 'modest':
      return { workers: 3, drones: 2, ships: 4, mechs: 1, rovers: 1, carts: 1 }
    case 'sparse':
    default:
      return { workers: 2, drones: 1, ships: 3, mechs: 0, rovers: 1, carts: 1 }
  }
}

// Fallback procedural parked ship if Quaternius not loaded.
function makeParkedShip(color, scale = 1) {
  const g = new THREE.Group()
  const hullMat = mat(color, 'hull', { metalness: 0.75, roughness: 0.55, mapScale: 0.32 })
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1a3048, transparent: true, opacity: 0.45, metalness: 0.2, roughness: 0.15,
    emissive: 0x0a2035, emissiveIntensity: 0.3
  })
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2.2 * scale, 0.9 * scale, 5.5 * scale), hullMat))
  const wing = new THREE.Mesh(new THREE.BoxGeometry(5 * scale, 0.15 * scale, 1.8 * scale), hullMat)
  wing.position.z = -0.5 * scale
  g.add(wing)
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.45 * scale, 8, 6), glass)
  canopy.scale.set(1, 0.6, 1.4)
  canopy.position.set(0, 0.55 * scale, 1.2 * scale)
  g.add(canopy)
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.35 * scale, 10),
    new THREE.MeshBasicMaterial({
      color: 0x7fe6ff, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })
  )
  glow.position.set(0, 0, -2.9 * scale)
  glow.rotation.y = Math.PI
  g.add(glow)
  g.userData.engineGlow = glow
  return g
}

function makeDrone() {
  const g = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.55, 1.1),
    mat(0x5a6a7a, 'panel', { metalness: 0.85, roughness: 0.4, mapScale: 0.35 })
  )
  g.add(body)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1.4), mat(0x2a3548, 'panel', { mapScale: 0.4 }))
  arm.position.set(0.5, -0.2, 0.3)
  g.add(arm)
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 6, 4),
    new THREE.MeshBasicMaterial({ color: 0xffcf4f })
  )
  light.position.set(0, 0.35, 0.4)
  g.add(light)
  g.userData.navLight = light
  return g
}

function makeWorker(theme) {
  const g = new THREE.Group()
  const suit = mat(
    theme.luxury ? 0x6a3a8a : theme.grit > 0.5 ? 0x4a4035 : 0x3a4a5a,
    'panel',
    { metalness: 0.55, roughness: 0.55, mapScale: 0.25 }
  )
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), suit)
  torso.position.y = 0.9
  g.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), suit)
  head.position.y = 1.55
  g.add(head)
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.12, 0.08),
    new THREE.MeshBasicMaterial({ color: theme.luxury ? 0xff88ee : 0x4fc3d9 })
  )
  visor.position.set(0, 1.55, 0.18)
  g.add(visor)
  return g
}

/**
 * @param {{ theme?: string, fancy?: boolean }} [options]
 * theme: core | mid | outer | palace | settlement
 * fancy: legacy — maps to mid (true) / settlement (false)
 */
export function buildStationInteriorMesh(options = {}) {
  let themeId = options.theme
  if (!themeId || !THEMES[themeId]) {
    themeId = options.fancy ? 'mid' : 'settlement'
  }
  const theme = THEMES[themeId]
  const group = new THREE.Group()
  group.userData.theme = themeId
  group.userData.fancy = theme.neon || theme.luxury // keep for old anim paths

  const wall = mat(theme.wall, 'wall', { metalness: 0.85, roughness: 0.72 + theme.grit * 0.15, mapScale: 0.42 })
  const floor = mat(theme.floor, 'floor', { metalness: 0.88, roughness: 0.7 + theme.grit * 0.2, mapScale: 0.45 })
  const beam = mat(theme.beam, 'beam', { metalness: 0.9, roughness: 0.65 + theme.grit * 0.2, mapScale: 0.4 })
  const accent = mat(theme.accent, 'accent', {
    metalness: 0.55, roughness: 0.5,
    emissive: theme.accent, emissiveIntensity: theme.neon ? 0.35 : 0.12, mapScale: 0.3
  })
  const hazard = mat(theme.hazard, 'panel', { metalness: 0.45, roughness: 0.55, mapScale: 0.35 })
  const panel = mat(theme.panel, 'panel', { metalness: 0.82, roughness: 0.68 + theme.grit * 0.15, mapScale: 0.4 })

  const counts = activityCounts(theme.activity)
  const useModels = interiorModelsReady()

  const anim = {
    theme: themeId,
    fancy: theme.neon || theme.luxury,
    lights: [],
    loaders: [],
    drones: [],
    workers: [],
    parkedShips: [],
    mechs: [],
    rovers: [],
    doorField: null,
    chevrons: [],
    holograms: [],
    sparks: [],
    fans: [],
    crane: null,
    pointLights: [],
    neonStrips: [],
    glowPlanes: [],
    elapsed: 0
  }

  // --- Shell ---------------------------------------------------------------
  makeBox(BAY_WIDTH, 2, BAY_LENGTH, floor, 0, FLOOR_Y, 0, group)
  for (let x = -BAY_WIDTH / 2 + 6; x < BAY_WIDTH / 2; x += 8) {
    makeBox(0.15, 0.08, BAY_LENGTH - 8, accent, x, FLOOR_Y + 1.05, 4, group)
  }
  for (let z = -BAY_LENGTH / 2 + 10; z < BAY_LENGTH / 2; z += 12) {
    makeBox(BAY_WIDTH - 8, 0.08, 0.15, panel, 0, FLOOR_Y + 1.04, z, group)
  }
  makeBox(BAY_WIDTH, 2, BAY_LENGTH, floor, 0, BAY_HEIGHT / 2, 0, group)
  makeBox(2.5, BAY_HEIGHT, BAY_LENGTH, wall, -BAY_WIDTH / 2, 0, 0, group)
  makeBox(2.5, BAY_HEIGHT, BAY_LENGTH, wall, BAY_WIDTH / 2, 0, 0, group)
  // Far end (+Z): open observation window — no solid bulkhead (starfield shows through).
  // Near end (−Z): docking bay doors (built below).

  // Side catwalks
  for (const side of [-1, 1]) {
    makeBox(8, 0.6, BAY_LENGTH - 20, panel, side * (BAY_WIDTH / 2 - 5), 6, 5, group)
    makeBox(0.2, 1.2, BAY_LENGTH - 20, beam, side * (BAY_WIDTH / 2 - 9), 6.9, 5, group)
    for (let z = -50; z <= 50; z += 25) {
      makeBox(1.2, 14, 1.2, beam, side * (BAY_WIDTH / 2 - 5), -1, z, group)
    }
  }

  // Overhead gantries + lights
  for (let z = -BAY_LENGTH / 2 + 18; z < BAY_LENGTH / 2 - 10; z += 28) {
    makeBox(BAY_WIDTH - 6, 2.2, 2.2, beam, 0, BAY_HEIGHT / 2 - 3, z, group)
    for (const x of [-18, 0, 18]) {
      makeBox(3.5, 0.5, 1.2, panel, x, BAY_HEIGHT / 2 - 5, z, group)
      const bulb = new THREE.Mesh(
        new THREE.BoxGeometry(3, 0.25, 0.8),
        new THREE.MeshBasicMaterial({
          color: theme.luxury ? 0xffc0f0 : theme.grit > 0.5 ? 0xffc080 : 0xa8c8ff,
          transparent: true,
          opacity: 0.85
        })
      )
      bulb.position.set(x, BAY_HEIGHT / 2 - 5.4, z)
      group.add(bulb)
      anim.lights.push({ mesh: bulb, phase: z * 0.05 + x * 0.1, base: 0.55 })
    }
  }

  // —— Far end (+Z): sci-fi observation viewport (starfield through clear glass) ——
  const windowZ = BAY_LENGTH / 2 - 0.8
  const winFrame = 3.6
  const edgeCol = theme.luxury ? 0xff88ee : theme.grit > 0.5 ? 0xffb060 : 0x6ee0ff
  // Deep multi-layer bulkhead frame
  makeBox(BAY_WIDTH, winFrame, 3.4, beam, 0, BAY_HEIGHT / 2 - winFrame / 2, windowZ, group)
  makeBox(BAY_WIDTH, winFrame * 0.7, 2.2, panel, 0, BAY_HEIGHT / 2 - winFrame * 0.9, windowZ - 0.8, group)
  makeBox(BAY_WIDTH, winFrame, 3.4, beam, 0, -BAY_HEIGHT / 2 + winFrame / 2, windowZ, group)
  makeBox(BAY_WIDTH, winFrame * 0.7, 2.2, panel, 0, -BAY_HEIGHT / 2 + winFrame * 0.9, windowZ - 0.8, group)
  makeBox(winFrame, BAY_HEIGHT, 3.4, beam, -BAY_WIDTH / 2 + winFrame / 2, 0, windowZ, group)
  makeBox(winFrame * 0.7, BAY_HEIGHT, 2.2, panel, -BAY_WIDTH / 2 + winFrame * 0.9, 0, windowZ - 0.8, group)
  makeBox(winFrame, BAY_HEIGHT, 3.4, beam, BAY_WIDTH / 2 - winFrame / 2, 0, windowZ, group)
  makeBox(winFrame * 0.7, BAY_HEIGHT, 2.2, panel, BAY_WIDTH / 2 - winFrame * 0.9, 0, windowZ - 0.8, group)
  // Corner armor braces
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      makeBox(
        4.5,
        4.5,
        1.6,
        beam,
        sx * (BAY_WIDTH / 2 - 5.5),
        sy * (BAY_HEIGHT / 2 - 5.5),
        windowZ - 0.4,
        group
      )
      // Corner status nodes
      makeEdgeLight(
        0.7,
        0.7,
        0.9,
        edgeCol,
        sx * (BAY_WIDTH / 2 - 5.5),
        sy * (BAY_HEIGHT / 2 - 5.5),
        windowZ - 1.5,
        group,
        anim,
        sx + sy
      )
    }
  }
  // Lattice mullions — grid of thin beams (sci-fi canopy / pressure lattice)
  const latticeInset = winFrame + 0.6
  const gridXs = [-0.33, 0, 0.33].map((f) => f * (BAY_WIDTH - latticeInset * 2))
  const gridYs = [-0.28, 0.05, 0.32].map((f) => f * (BAY_HEIGHT - latticeInset * 2))
  for (const x of gridXs) {
    makeBox(0.35, BAY_HEIGHT - latticeInset * 2, 0.9, beam, x, 0, windowZ - 0.2, group)
  }
  for (const y of gridYs) {
    makeBox(BAY_WIDTH - latticeInset * 2, 0.35, 0.9, beam, 0, y, windowZ - 0.2, group)
  }
  // Diagonal tension braces (outer corners only — doesn't fill the glass)
  for (const sx of [-1, 1]) {
    const brace = makeBox(0.28, BAY_HEIGHT * 0.38, 0.55, panel, 0, 0, windowZ - 0.15, group)
    brace.position.set(sx * BAY_WIDTH * 0.28, BAY_HEIGHT * 0.12, windowZ - 0.15)
    brace.rotation.z = sx * 0.55
  }
  // Open aperture only — no glass panes / filled glow (those read as a blue slab).
  // Starfield is visible straight through the lattice.
  const openW = BAY_WIDTH - latticeInset * 2
  const openH = BAY_HEIGHT - latticeInset * 2
  // Tiny corner LEDs only (not full-length strips that merge into a rectangle).
  const led = 0.55
  const trimZ = windowZ - 1.2
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      makeEdgeLight(
        led,
        led,
        0.35,
        edgeCol,
        sx * (openW / 2 - 0.4),
        sy * (openH / 2 - 0.4),
        trimZ,
        group,
        anim,
        sx * 0.5 + sy
      )
    }
  }

  // —— Near end (−Z): closed docking-bay doors (entry from space) ——
  const doorZ = -BAY_LENGTH / 2 + 2.5
  // Heavy outer frame / bulkhead
  makeBox(BAY_WIDTH, 5, 4, beam, 0, BAY_HEIGHT / 2 - 2.5, doorZ, group)
  makeBox(BAY_WIDTH, 4, 4, beam, 0, -BAY_HEIGHT / 2 + 2, doorZ, group)
  makeBox(5, BAY_HEIGHT, 4, beam, -BAY_WIDTH / 2 + 2.5, 0, doorZ, group)
  makeBox(5, BAY_HEIGHT, 4, beam, BAY_WIDTH / 2 - 2.5, 0, doorZ, group)
  // Door aperture ring
  const entryRing = new THREE.Mesh(new THREE.TorusGeometry(24, 1.4, 8, 40), accent)
  entryRing.position.set(0, 0, doorZ + 0.5)
  group.add(entryRing)

  // Twin sliding leaves (closed, center seam)
  const leafW = BAY_WIDTH * 0.42
  const leafH = BAY_HEIGHT * 0.78
  const leafDepth = 1.8
  for (const side of [-1, 1]) {
    const leaf = makeBox(
      leafW,
      leafH,
      leafDepth,
      panel,
      side * (leafW * 0.5 + 0.4),
      0.5,
      doorZ + 1.2,
      group
    )
    // Horizontal plating ribs on each leaf
    for (let r = 0; r < 6; r++) {
      const y = -leafH * 0.35 + r * (leafH * 0.12)
      makeBox(leafW * 0.92, 0.35, 0.25, beam, side * (leafW * 0.5 + 0.4), y, doorZ + 1.2 + leafDepth * 0.45, group)
    }
    // Vertical guide rails
    makeBox(0.5, leafH * 0.95, 0.4, hazard, side * (leafW * 0.95 + 0.5), 0.5, doorZ + 2.2, group)
    // Hazard chevron on each leaf
    for (let c = 0; c < 4; c++) {
      const chev = new THREE.Mesh(
        new THREE.BoxGeometry(leafW * 0.35, 0.55, 0.2),
        new THREE.MeshBasicMaterial({
          color: theme.luxury ? 0xff88ee : theme.grit > 0.5 ? 0xffaa44 : 0x4fc3d9,
          transparent: true,
          opacity: 0.55
        })
      )
      chev.position.set(
        side * (leafW * 0.35),
        leafH * 0.15 - c * 2.2,
        doorZ + 1.2 + leafDepth * 0.55
      )
      chev.rotation.z = side * 0.35
      group.add(chev)
    }
  }
  // Center seal / parting line
  makeBox(1.1, leafH * 0.98, 0.5, hazard, 0, 0.5, doorZ + 2.1, group)
  // Soft energy seal glow in the seam (reads as pressurized door)
  const doorField = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, leafH * 0.9),
    new THREE.MeshBasicMaterial({
      color: theme.luxury ? 0xff66cc : theme.grit > 0.5 ? 0xff8844 : 0x4fc3d9,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  doorField.position.set(0, 0.5, doorZ + 2.4)
  group.add(doorField)
  anim.doorField = doorField
  // Status lights on the lintel
  for (const x of [-16, -8, 8, 16]) {
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.6, 0.8),
      new THREE.MeshBasicMaterial({
        color: theme.luxury ? 0xff88cc : 0xff6040,
        transparent: true,
        opacity: 0.85
      })
    )
    lamp.position.set(x, BAY_HEIGHT / 2 - 4.2, doorZ + 2.5)
    group.add(lamp)
    anim.lights.push({ mesh: lamp, phase: x * 0.08, base: 0.5, warn: true })
  }

  // Landing pad
  const padY = FLOOR_Y + 1.15
  makeBox(28, 0.4, 36, panel, 0, padY - 0.1, 18, group)
  const padMarking = new THREE.Mesh(new THREE.RingGeometry(9, 10.2, 32), accent)
  padMarking.rotation.x = -Math.PI / 2
  padMarking.position.set(0, padY + 0.15, 18)
  group.add(padMarking)
  const padInner = new THREE.Mesh(new THREE.RingGeometry(3.5, 4.2, 24), hazard)
  padInner.rotation.x = -Math.PI / 2
  padInner.position.set(0, padY + 0.16, 18)
  group.add(padInner)

  for (let i = 0; i < 8; i++) {
    const chev = new THREE.Mesh(
      new THREE.BoxGeometry(3.5, 0.12, 1.2),
      new THREE.MeshBasicMaterial({
        color: theme.luxury ? 0xff88ee : theme.grit > 0.5 ? 0xffaa55 : 0x4fc3d9,
        transparent: true,
        opacity: 0.35
      })
    )
    chev.position.set(0, padY + 0.2, -40 + i * 7)
    chev.scale.x = 1 - i * 0.04
    group.add(chev)
    anim.chevrons.push({ mesh: chev, index: i })
  }

  // Docking clamps
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    const cx = Math.cos(a) * 14
    const cz = 18 + Math.sin(a) * 14
    makeBox(2, 1.5, 2, beam, cx, padY + 0.8, cz, group)
    const arm = makeBox(1.2, 0.6, 6, hazard, cx * 0.55, padY + 2.2, 18 + (cz - 18) * 0.55, group)
    anim.loaders.push({ kind: 'clamp', mesh: arm, baseY: padY + 2.2, phase: i * 1.2 })
  }

  // --- Kenney / Quaternius dressing ----------------------------------------
  const tint = theme.propTint
  if (useModels) {
    // Side wall paneling (Kenney modular walls)
    if (hasInteriorModule('wall')) {
      for (const side of [-1, 1]) {
        for (let z = -55; z <= 55; z += 10) {
          placeProp(
            group,
            theme.luxury && hasInteriorModule('wall-banner') ? 'wall-banner' : 'wall-detail',
            side * (BAY_WIDTH / 2 - 2.2),
            FLOOR_Y + 1,
            z,
            { rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2, scale: 8.5 },
            tint
          )
        }
      }
    }

    // Cargo containers (Kenney + Quaternius crate)
    const crateNames = ['container', 'container-tall', 'container-wide', 'container-flat', 'q:pickup_crate']
    for (let i = 0; i < (theme.grit > 0.5 ? 16 : 12); i++) {
      const name = crateNames[i % crateNames.length]
      const ok = hasInteriorModule(name)
      if (!ok) {
        const crate = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, 1.6, 2.2),
          mat(i % 2 ? 0x4a3a2a : 0x3a4a3a, 'panel', { metalness: 0.6, roughness: 0.55 })
        )
        crate.position.set(
          -BAY_WIDTH / 2 + 8 + (i % 3) * 2.8,
          FLOOR_Y + 2 + Math.floor(i / 6) * 1.7,
          35 + Math.floor((i % 6) / 3) * 4
        )
        group.add(crate)
        continue
      }
      placeProp(
        group,
        name,
        -BAY_WIDTH / 2 + 8 + (i % 3) * 2.8,
        FLOOR_Y + 1.1,
        32 + Math.floor(i / 3) * 3.5 + (i % 2),
        { rotY: (i % 4) * 0.2, scale: name.includes('pickup') ? 2.2 : 3.2 },
        tint
      )
    }
    if (hasInteriorModule('q:pickup_crate')) {
      for (let i = 0; i < 4; i++) {
        placeProp(
          group,
          'q:pickup_crate',
          BAY_WIDTH / 2 - 10 - (i % 2) * 3,
          FLOOR_Y + 1.1,
          40 + i * 3,
          { scale: 2.5, rotY: i * 0.4 },
          tint
        )
      }
    }

    // --- Quaternius MegaKit dressing (CC0) --------------------------------
    // These carry real basecolor/normal/ORM sets rather than the flat colour
    // atlas the Kenney pieces use, so they are deliberately NOT tinted — the
    // whole reason they are here is the material detail, and applyInteriorTint
    // would flatten it back out. Authored at ~1 m scale, hence the scale-up
    // into a 72-unit bay.
    if (hasInteriorModule('m:Prop_Light_Wide')) {
      // Deck lighting down both side walls.
      for (let i = 0; i < 6; i++) {
        const side = i % 2 ? 1 : -1
        placeProp(group, 'm:Prop_Light_Wide', side * (BAY_WIDTH / 2 - 3), FLOOR_Y + 13 + (i % 2) * 4,
          -34 + Math.floor(i / 2) * 26, { scale: 4.5, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2 })
      }
    }
    if (hasInteriorModule('m:Column_Astra')) {
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1
        placeProp(group, 'm:Column_Astra', side * (BAY_WIDTH / 2 - 6), FLOOR_Y,
          -26 + Math.floor(i / 2) * 40, { scale: 5.5, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2 })
      }
    }
    if (hasInteriorModule('m:Prop_Crate3')) {
      const crates = ['m:Prop_Crate3', 'm:Prop_Crate4', 'm:Prop_Chest', 'm:Prop_Barrel_Large']
      for (let i = 0; i < 7; i++) {
        const side = i % 2 ? 1 : -1
        placeProp(group, crates[i % crates.length],
          side * (BAY_WIDTH / 2 - 11 - (i % 3) * 2.5), FLOOR_Y, -16 + i * 9,
          { scale: 2.6, rotY: i * 0.7 })
      }
    }
    if (hasInteriorModule('m:Prop_Computer')) {
      placeProp(group, 'm:Prop_Computer', -(BAY_WIDTH / 2 - 9), FLOOR_Y, -30, { scale: 3.4, rotY: Math.PI / 2 })
      placeProp(group, 'm:Prop_AccessPoint', -(BAY_WIDTH / 2 - 9), FLOOR_Y, -24, { scale: 3.0, rotY: Math.PI / 2 })
    }
    if (hasInteriorModule('m:Prop_Vent_Big')) {
      for (let i = 0; i < 4; i++) {
        const side = i % 2 ? 1 : -1
        placeProp(group, i % 3 ? 'm:Prop_Vent_Big' : 'm:Prop_Vent_Wide',
          side * (BAY_WIDTH / 2 - 2), FLOOR_Y + 20 + (i % 2) * 6, -20 + Math.floor(i / 2) * 34,
          { scale: 4, rotY: side > 0 ? -Math.PI / 2 : Math.PI / 2, anchor: 'center' })
      }
    }

    // Pipes & rails (grit / settlement denser)
    if (hasInteriorModule('pipe')) {
      const pipeCount = theme.grit > 0.4 ? 8 : 4
      for (let i = 0; i < pipeCount; i++) {
        placeProp(
          group,
          i % 2 ? 'pipe-bend' : 'pipe',
          BAY_WIDTH / 2 - 5,
          FLOOR_Y + 4 + (i % 3) * 3,
          -30 + i * 12,
          { rotY: Math.PI / 2, scale: 4, anchor: 'center' },
          tint
        )
      }
    }

    // Control booth furniture
    if (hasInteriorModule('computer-system')) {
      placeProp(group, 'computer-system', BAY_WIDTH / 2 - 14, FLOOR_Y + 5.2, -25, { scale: 3.5 }, tint)
      placeProp(group, 'computer-screen', BAY_WIDTH / 2 - 12, FLOOR_Y + 6.5, -27, { scale: 3.2 }, {
        ...tint,
        emissive: theme.accent,
        emissiveIntensity: 0.4
      })
      // Keep the far +Z wall clear for the space window — put displays on the side.
      if (hasInteriorModule('display-wall-wide')) {
        placeProp(
          group,
          'display-wall-wide',
          BAY_WIDTH / 2 - 4,
          FLOOR_Y + 8,
          35,
          { scale: 5, rotY: -Math.PI / 2 },
          {
            ...tint,
            emissive: theme.accent,
            emissiveIntensity: 0.25
          }
        )
      }
    }
    if (hasInteriorModule('chair') && (theme.neon || theme.luxury)) {
      for (let i = 0; i < (theme.luxury ? 4 : 2); i++) {
        placeProp(
          group,
          theme.luxury ? 'chair-armrest' : 'chair',
          BAY_WIDTH / 2 - 16 + i * 2.2,
          FLOOR_Y + 5.2,
          -22,
          { scale: 3, rotY: Math.PI },
          tint
        )
      }
    }
    if (theme.luxury && hasInteriorModule('table-display-planet')) {
      placeProp(group, 'table-display-planet', -18, FLOOR_Y + 1.1, 50, { scale: 4 }, {
        ...tint,
        emissive: 0xff44aa,
        emissiveIntensity: 0.2
      })
      placeProp(group, 'table-display', 18, FLOOR_Y + 1.1, 48, { scale: 3.5 }, tint)
    }

    // Debris for grit
    if (theme.grit > 0.4) {
      if (hasInteriorModule('rocks')) {
        for (let i = 0; i < 6; i++) {
          placeProp(
            group,
            i % 2 ? 'skip-rocks' : 'rocks',
            -20 + i * 7,
            FLOOR_Y + 1.05,
            -10 + (i % 3) * 8,
            { scale: 2.5 + theme.grit, rotY: i },
            tint
          )
        }
      }
      if (hasInteriorModule('skip')) {
        placeProp(group, 'skip', -BAY_WIDTH / 2 + 10, FLOOR_Y + 1.1, 20, { scale: 4, rotY: 0.3 }, tint)
      }
    }

    // Outer / settlement industrial kit extras
    if (theme.grit > 0.3 && hasInteriorModule('q:metal_support')) {
      for (const side of [-1, 1]) {
        placeProp(
          group,
          'q:metal_support',
          side * 20,
          FLOOR_Y + 1.1,
          55,
          { scale: 5, rotY: side * 0.2 },
          tint
        )
      }
    }
    if (theme.luxury && hasInteriorModule('q:geodesic_dome')) {
      placeProp(group, 'q:geodesic_dome', 0, FLOOR_Y + 1.1, 60, { scale: 3.5 }, {
        ...tint,
        emissive: 0xaa44ff,
        emissiveIntensity: 0.15
      })
    }
    if (hasInteriorModule('q:solar_panel') && themeId !== 'palace') {
      placeProp(group, 'q:solar_structure', -BAY_WIDTH / 2 + 12, FLOOR_Y + 1.1, -35, { scale: 3, rotY: 0.4 }, tint)
    }
    if (hasInteriorModule('q:roof_antenna')) {
      placeProp(group, 'q:roof_antenna', BAY_WIDTH / 2 - 10, BAY_HEIGHT / 2 - 6, 30, { scale: 4, anchor: 'center' }, tint)
    }
    if (hasInteriorModule('q:roof_radar') && theme.neon) {
      placeProp(group, 'q:roof_radar', -BAY_WIDTH / 2 + 10, BAY_HEIGHT / 2 - 6, 25, { scale: 4, anchor: 'center' }, tint)
    }
  } else {
    // Fallback cargo crates without GLBs
    for (let i = 0; i < 12; i++) {
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 1.6, 2.2),
        mat(i % 2 ? 0x4a3a2a : 0x3a4a3a, 'panel', { metalness: 0.6, roughness: 0.55 })
      )
      crate.position.set(
        -BAY_WIDTH / 2 + 8 + (i % 3) * 2.8,
        FLOOR_Y + 2 + Math.floor(i / 6) * 1.7,
        35 + Math.floor((i % 6) / 3) * 4
      )
      group.add(crate)
    }
  }

  // Cargo cart(s) — actor-sized (not full hangar scale)
  for (let c = 0; c < counts.carts; c++) {
    const loader = new THREE.Group()
    makeBox(4, 1.2, 6, beam, 0, 0, 0, loader)
    makeBox(5, 0.4, 0.4, hazard, 0, 1.2, 0, loader)
    makeBox(0.5, 5, 0.5, panel, -1.2, 3, 0, loader)
    const fork = makeBox(2.5, 0.25, 1.5, hazard, 0.5, 1.8, 0, loader)
    loader.scale.setScalar(ACTOR_SCALE)
    loader.position.set(-BAY_WIDTH / 2 + 12 + c * 4, FLOOR_Y + 1.15, 10 - c * 15)
    group.add(loader)
    anim.loaders.push({
      kind: 'cart',
      mesh: loader,
      fork,
      z0: -25 + c * 5,
      z1: 45 - c * 5,
      speed: 0.1 + c * 0.03,
      phase: c * 1.5
    })
  }

  // Overhead crane
  const crane = new THREE.Group()
  makeBox(BAY_WIDTH - 20, 1.2, 2, beam, 0, 0, 0, crane)
  const hoist = makeBox(2.5, 2, 2.5, panel, 0, -1.5, 0, crane)
  const cable = makeBox(0.15, 8, 0.15, panel, 0, -6, 0, crane)
  const hook = makeBox(1.5, 0.8, 1.5, hazard, 0, -10, 0, crane)
  crane.position.set(0, BAY_HEIGHT / 2 - 4, 0)
  group.add(crane)
  anim.crane = { mesh: crane, hoist, cable, hook, z0: -30, z1: 40, x0: -12, x1: 12 }

  // Fuel tanks / pipes (procedural)
  for (let i = 0; i < 3; i++) {
    makeCylinder(2.2, 2.2, 10, 12, panel, BAY_WIDTH / 2 - 8, FLOOR_Y + 6, 30 + i * 12, group)
    makeCylinder(2.4, 2.4, 0.5, 12, hazard, BAY_WIDTH / 2 - 8, FLOOR_Y + 11, 30 + i * 12, group)
  }
  makeCylinder(0.4, 0.4, 50, 8, beam, BAY_WIDTH / 2 - 6, 4, 20, group, Math.PI / 2)

  // Vent fans
  for (const side of [-1, 1]) {
    for (const z of [-20, 20, 50]) {
      const fan = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.4, 12), panel)
      fan.rotation.z = Math.PI / 2
      fan.position.set(side * (BAY_WIDTH / 2 - 1.5), 10, z)
      group.add(fan)
      const blades = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.15), beam)
      blades.position.copy(fan.position)
      blades.rotation.z = Math.PI / 2
      group.add(blades)
      anim.fans.push(blades)
    }
  }

  // Control booth shell
  const booth = new THREE.Group()
  makeBox(10, 6, 8, panel, 0, 0, 0, booth)
  makeBox(9, 3.5, 0.3, glassMat(theme), 0, 1, -4.1, booth)
  booth.position.set(BAY_WIDTH / 2 - 14, FLOOR_Y + 8, -25)
  group.add(booth)
  for (let i = 0; i < 3; i++) {
    const holo = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshBasicMaterial({
        color: theme.luxury ? 0xff66cc : 0x4fc3d9,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    holo.position.set(BAY_WIDTH / 2 - 14 + (i - 1) * 2.5, FLOOR_Y + 9.5, -28.5)
    group.add(holo)
    anim.holograms.push({ mesh: holo, phase: i * 1.7 })
  }
  // Status holoboards on the side walls — never on the +Z space window.
  for (const side of [-1, 1]) {
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 5),
      new THREE.MeshBasicMaterial({
        color: theme.luxury ? 0xaa44cc : 0x2a8aaa,
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    board.position.set(side * (BAY_WIDTH / 2 - 3.2), 10, 22)
    board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
    group.add(board)
    anim.holograms.push({ mesh: board, phase: side * 0.5, isBoard: true })
  }

  // Warning beacons
  for (const pos of [
    [-BAY_WIDTH / 2 + 3, 12, doorZ + 5],
    [BAY_WIDTH / 2 - 3, 12, doorZ + 5],
    [-BAY_WIDTH / 2 + 3, 12, 55],
    [BAY_WIDTH / 2 - 3, 12, 55]
  ]) {
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 8, 6),
      new THREE.MeshBasicMaterial({
        color: theme.luxury ? 0xff66cc : 0xff4040,
        transparent: true,
        opacity: 0.9
      })
    )
    beacon.position.set(...pos)
    group.add(beacon)
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(1.4, 8, 6),
      new THREE.MeshBasicMaterial({
        color: theme.luxury ? 0xff66cc : 0xff4040,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    halo.position.set(...pos)
    group.add(halo)
    anim.lights.push({ mesh: beacon, halo, phase: pos[2] * 0.08, base: 0.7, warn: true })
  }

  // --- Parked ships on the deck (player-scale; hangar is 3× so actors are compensated) ---
  const shipSlots = [
    { x: -26, z: 52, y: FLOOR_Y + 1.15, rot: 0.4 },
    { x: 28, z: 46, y: FLOOR_Y + 1.15, rot: -0.5 },
    { x: -24, z: -18, y: FLOOR_Y + 1.15, rot: 0.2 },
    { x: 26, z: 12, y: FLOOR_Y + 1.15, rot: -0.3 },
    // Extra ground pads along the flanks / mid-bay
    { x: -20, z: 28, y: FLOOR_Y + 1.15, rot: 0.55 },
    { x: 22, z: 30, y: FLOOR_Y + 1.15, rot: -0.45 },
    { x: 0, z: 58, y: FLOOR_Y + 1.15, rot: 0.08 },
    { x: -28, z: 5, y: FLOOR_Y + 1.15, rot: 0.9 }
  ].slice(0, counts.ships)
  const shipNames = ['q:spaceship_a', 'q:spaceship_b', 'q:spaceship_c', 'q:spaceship_d']
  for (let i = 0; i < shipSlots.length; i++) {
    const slot = shipSlots[i]
    const sName = shipNames[i % shipNames.length]
    // ~player hull size after INTERIOR_WORLD_SCALE (was 2.8 before hangar enlarge).
    const shipLocal = 2.8 * theme.shipScale * ACTOR_SCALE
    let ship = null
    if (useModels && hasInteriorModule(sName)) {
      const placed = placeProp(
        group,
        sName,
        slot.x,
        slot.y,
        slot.z,
        { rotY: slot.rot, scale: shipLocal, anchor: 'bottom' },
        tint
      )
      ship = placed?.obj
    }
    if (!ship) {
      const colors = theme.luxury
        ? [0xc090e0, 0xff88cc, 0xa070ff]
        : theme.grit > 0.5
          ? [0x6a5a48, 0x5a4a38, 0x7a6a50]
          : [0x7a8a9a, 0x6a7a70, 0x8a7a60]
      ship = makeParkedShip(colors[i % colors.length], theme.shipScale * (1 + i * 0.15) * ACTOR_SCALE)
      ship.position.set(slot.x, slot.y, slot.z)
      ship.rotation.y = slot.rot
      group.add(ship)
    }
    if (ship) anim.parkedShips.push(ship)
  }

  // Footprints for ground traffic (rovers) — keep clear of parked hulls + player pad.
  // Radii are local bay units (before INTERIOR_WORLD_SCALE).
  const shipPads = shipSlots.map((s) => ({ x: s.x, z: s.z, r: 10 }))
  // Player park sits near bay local (0, 20) — leave room so rovers don't clip the hull.
  shipPads.push({ x: 0, z: 20, r: 12 })
  anim.shipPads = shipPads

  // --- Service drones / flying units ---------------------------------------
  for (let i = 0; i < counts.drones; i++) {
    let drone = null
    if (useModels && hasInteriorModule('q:enemy_flying') && i % 2 === 0) {
      const placed = placeProp(
        group,
        'q:enemy_flying',
        0,
        0,
        0,
        { scale: 1.4 * ACTOR_SCALE, anchor: 'center' },
        tint
      )
      drone = placed?.obj
    }
    if (!drone) {
      drone = makeDrone()
      drone.scale.setScalar(ACTOR_SCALE)
      group.add(drone)
    }
    anim.drones.push({
      mesh: drone,
      radius: 18 + i * 6,
      height: -2 + i * 2.5,
      speed: 0.32 + i * 0.07,
      phase: i * 1.6,
      zCenter: 10 + i * 8
    })
  }

  // --- Workers / astronauts ------------------------------------------------
  const astroNames = ['q:astronaut_a', 'q:astronaut_b', 'q:astronaut_c']
  for (let i = 0; i < counts.workers; i++) {
    const side = i % 2 === 0 ? -1 : 1
    let worker = null
    if (useModels && hasInteriorModule(astroNames[i % 3])) {
      const placed = placeProp(
        group,
        astroNames[i % 3],
        0,
        0,
        0,
        { scale: 2.2 * ACTOR_SCALE, anchor: 'bottom' },
        tint
      )
      worker = placed?.obj
    }
    if (!worker) {
      worker = makeWorker(theme)
      worker.scale.setScalar(ACTOR_SCALE)
      group.add(worker)
    }
    const onFloor = i >= counts.workers - 2 && theme.activity !== 'sparse'
    const baseY = onFloor
      ? (worker?.position.y || FLOOR_Y + 1.15)
      : 6.8
    anim.workers.push({
      mesh: worker,
      side,
      z0: -40 + i * 6,
      z1: 50 - i * 4,
      speed: 0.07 + (i % 3) * 0.025,
      phase: i * 2.1,
      y: onFloor ? baseY : 6.8,
      onFloor,
      floorY: baseY
    })
  }

  // --- Mechs (cargo loaders) -----------------------------------------------
  const mechNames = ['q:mech_a', 'q:mech_b', 'q:mech_c']
  for (let i = 0; i < counts.mechs; i++) {
    if (!useModels || !hasInteriorModule(mechNames[i % 3])) continue
    const placed = placeProp(
      group,
      mechNames[i % 3],
      0,
      FLOOR_Y + 1.1,
      0,
      { scale: 2.0 * ACTOR_SCALE, anchor: 'bottom' },
      tint
    )
    if (!placed) continue
    anim.mechs.push({
      mesh: placed.obj,
      baseY: placed.obj.position.y,
      x0: -22 + i * 10,
      x1: 22 - i * 8,
      z: 32 + i * 12,
      speed: 0.12 + i * 0.04,
      phase: i * 2.5
    })
  }

  // --- Rovers (side aisles only — avoid ship pad columns) --------------------
  const roverClear = 4 // extra margin past ship pad radius
  const roverLaneCandidates = [
    -BAY_WIDTH / 2 + 12,
    -BAY_WIDTH / 2 + 16,
    BAY_WIDTH / 2 - 12,
    BAY_WIDTH / 2 - 16,
    -10,
    10
  ]
  const roverLanes = roverLaneCandidates.filter((lx) =>
    shipPads.every((p) => Math.abs(lx - p.x) >= p.r + roverClear)
  )
  const lanePool = roverLanes.length ? roverLanes : [-BAY_WIDTH / 2 + 11, BAY_WIDTH / 2 - 11]

  for (let i = 0; i < counts.rovers; i++) {
    const name = i % 2 ? 'q:round_rover' : 'q:rover'
    if (!useModels || !hasInteriorModule(name)) continue
    const laneX = lanePool[i % lanePool.length]
    const placed = placeProp(
      group,
      name,
      laneX,
      FLOOR_Y + 1.1,
      0,
      { scale: 2.2 * ACTOR_SCALE, anchor: 'bottom' },
      tint
    )
    if (!placed) continue
    anim.rovers.push({
      mesh: placed.obj,
      baseY: placed.obj.position.y,
      z0: -38,
      z1: 50,
      x: laneX,
      speed: 0.09,
      phase: i * 3,
      clear: roverClear
    })
  }

  // Welding sparks
  const sparkPts =
    theme.grit > 0.4
      ? [[-20, FLOOR_Y + 5, -12], [22, FLOOR_Y + 6, 40], [10, FLOOR_Y + 5, 25], [-15, FLOOR_Y + 5, 35]]
      : [[-20, FLOOR_Y + 5, -12], [22, FLOOR_Y + 6, 40]]
  for (const [x, y, z] of sparkPts) {
    const sparkGroup = new THREE.Group()
    sparkGroup.position.set(x, y, z)
    for (let s = 0; s < 8; s++) {
      sparkGroup.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.9 })
        )
      )
    }
    group.add(sparkGroup)
    anim.sparks.push({ group: sparkGroup, phase: x * 0.1 })
  }

  // Lights
  const bayLight = new THREE.PointLight(theme.bayLight, theme.bayI, 280)
  bayLight.position.set(0, BAY_HEIGHT / 2 - 8, 10)
  group.add(bayLight)
  anim.bayLight = bayLight

  const padLight = new THREE.PointLight(theme.padLight, theme.padI, 80)
  padLight.position.set(0, 8, 18)
  group.add(padLight)
  anim.padLight = padLight

  const doorLight = new THREE.PointLight(theme.doorLight, theme.doorI, 100)
  doorLight.position.set(0, 5, doorZ + 10)
  group.add(doorLight)

  // A hangar has to carry its own bounce light. The bay PointLights above all
  // have tight `distance` caps, so beyond a few metres the volume was lit
  // almost entirely by scene ambient — which is deliberately near-black now
  // that space is lit by a real star, leaving floors and walls too dark for any
  // surface detail to read. Scoped to the interior group so open space stays
  // dark.
  group.add(new THREE.AmbientLight(theme.ambient, theme.ambientI * 2.8))
  // Sky/ground fill approximating light bouncing off the deck and roof — gives
  // the bevelled panel edges a gradient to catch instead of one flat level.
  group.add(new THREE.HemisphereLight(theme.bayLight, theme.floor ?? 0x1a2028, 0.75))

  if (theme.neon || theme.luxury) {
    const washA = new THREE.PointLight(theme.luxury ? 0xff60d0 : 0x40e0ff, theme.luxury ? 1.8 : 1.4, 90)
    washA.position.set(-BAY_WIDTH / 2 + 8, 4, 0)
    group.add(washA)
    anim.pointLights.push({ light: washA, base: theme.luxury ? 1.8 : 1.4, phase: 0.2, speed: 0.9, hueShift: !theme.luxury, hue0: 0.5 })

    const washB = new THREE.PointLight(theme.luxury ? 0xffd700 : 0xff60c8, theme.luxury ? 1.5 : 1.1, 85)
    washB.position.set(BAY_WIDTH / 2 - 8, 6, 20)
    group.add(washB)
    anim.pointLights.push({ light: washB, base: theme.luxury ? 1.5 : 1.1, phase: 1.4, speed: 1.1, hueShift: false })

    const washC = new THREE.PointLight(theme.luxury ? 0xaa66ff : 0xffb347, 1.3, 70)
    washC.position.set(0, BAY_HEIGHT / 2 - 10, -30)
    group.add(washC)
    anim.pointLights.push({ light: washC, base: 1.3, phase: 2.2, speed: 0.7, hueShift: false })

    const rimDoor = new THREE.PointLight(theme.luxury ? 0xff88ee : 0x7fe6ff, 2.2, 120)
    rimDoor.position.set(0, 2, doorZ + 4)
    group.add(rimDoor)
    anim.pointLights.push({ light: rimDoor, base: 2.2, phase: 0.5, speed: 1.6, hueShift: false })

    const neonMat = (hex, opacity = 0.55) =>
      new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(0.35, BAY_LENGTH - 24),
        neonMat(side < 0 ? (theme.luxury ? 0xff66cc : 0x4fc3d9) : (theme.luxury ? 0xffd700 : 0xff6ad1), 0.45)
      )
      strip.rotation.x = -Math.PI / 2
      strip.rotation.z = Math.PI / 2
      strip.position.set(side * (BAY_WIDTH / 2 - 3.2), FLOOR_Y + 1.15, 5)
      group.add(strip)
      anim.neonStrips.push({ mesh: strip, phase: side * 0.8, base: 0.4, amp: 0.25 })
    }
    for (const x of [-20, 0, 20]) {
      const vein = new THREE.Mesh(
        new THREE.PlaneGeometry(BAY_LENGTH * 0.7, 0.45),
        neonMat(theme.luxury ? 0xffc0f0 : 0xa8d8ff, 0.35)
      )
      vein.rotation.x = Math.PI / 2
      vein.position.set(x, BAY_HEIGHT / 2 - 1.3, 0)
      group.add(vein)
      anim.neonStrips.push({ mesh: vein, phase: x * 0.05, base: 0.3, amp: 0.2 })
    }
    // No large additive haze planes mid-bay — they read as a semi-opaque blue slab.
    for (let z = -40; z <= 50; z += 22) {
      for (const x of [-12, 12]) {
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.55, 10, 8),
          new THREE.MeshBasicMaterial({
            color: theme.luxury ? 0xffd0f0 : 0xc8e8ff,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          })
        )
        bulb.position.set(x, BAY_HEIGHT / 2 - 6.5, z)
        group.add(bulb)
        anim.lights.push({ mesh: bulb, phase: z * 0.04 + x, base: 0.65 })
        const pl = new THREE.PointLight(theme.luxury ? 0xffa0e0 : 0xb0d0ff, 0.55, 40)
        pl.position.copy(bulb.position)
        group.add(pl)
        anim.pointLights.push({ light: pl, base: 0.55, phase: z * 0.03, speed: 1.3, hueShift: false })
      }
    }
    for (const side of [-1, 1]) {
      const col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, BAY_HEIGHT * 0.7, 8),
        neonMat(theme.luxury ? 0xff66cc : 0x5ee6ff, 0.4)
      )
      col.position.set(side * 18, 0, doorZ + 2)
      group.add(col)
      anim.neonStrips.push({ mesh: col, phase: side, base: 0.35, amp: 0.3 })
    }
  }

  group.userData.anim = anim
  // Enlarge hangar vs player ship so bays feel vast (stations + settlements).
  group.scale.setScalar(INTERIOR_WORLD_SCALE)
  // Light `distance` is world-space and does not inherit parent scale.
  group.traverse((obj) => {
    if (obj.isPointLight || obj.isSpotLight) {
      if (Number.isFinite(obj.distance) && obj.distance > 0) {
        obj.distance *= INTERIOR_WORLD_SCALE
      }
    }
  })
  group.userData.interiorScale = INTERIOR_WORLD_SCALE
  return group
}

/**
 * Advance docking-bay ambient activity. Call every frame while the interior
 * is visible (docked or mid dock/undock animation).
 */
export function updateStationInterior(mesh, dt) {
  const anim = mesh?.userData?.anim
  if (!anim) return
  anim.elapsed = (anim.elapsed ?? 0) + dt
  const t = anim.elapsed
  const fancy = anim.fancy

  for (const light of anim.lights) {
    if (light.warn) {
      const on = Math.sin(t * 4 + light.phase) > 0.2
      light.mesh.material.opacity = on ? 0.95 : 0.15
      if (light.halo) light.halo.material.opacity = on ? 0.35 : 0.05
    } else {
      const pulse = light.base + 0.35 * Math.sin(t * 1.5 + light.phase)
      light.mesh.material.opacity = Math.max(0.25, Math.min(1, pulse))
    }
  }

  if (anim.doorField) {
    anim.doorField.material.opacity = 0.08 + 0.07 * (0.5 + 0.5 * Math.sin(t * 3.2))
  }

  for (const chev of anim.chevrons) {
    const wave = (t * 2.2 - chev.index * 0.45) % (Math.PI * 2)
    chev.mesh.material.opacity = 0.15 + 0.55 * Math.max(0, Math.sin(wave))
  }

  for (const loader of anim.loaders) {
    if (loader.kind === 'cart') {
      const u = (Math.sin(t * loader.speed + loader.phase) + 1) / 2
      loader.mesh.position.z = loader.z0 + (loader.z1 - loader.z0) * u
      if (loader.fork) loader.fork.position.y = 1.4 + Math.sin(t * 1.8 + loader.phase) * 0.6
    } else if (loader.kind === 'clamp') {
      loader.mesh.position.y = loader.baseY + Math.sin(t * 0.9 + loader.phase) * 0.25
    }
  }

  if (anim.crane) {
    const c = anim.crane
    const u = (Math.sin(t * 0.25) + 1) / 2
    const v = (Math.sin(t * 0.18 + 1) + 1) / 2
    c.mesh.position.z = c.z0 + (c.z1 - c.z0) * u
    c.mesh.position.x = c.x0 + (c.x1 - c.x0) * v
    const lower = 6 + 5 * (0.5 + 0.5 * Math.sin(t * 0.7))
    c.cable.scale.y = lower / 8
    c.cable.position.y = -lower / 2 - 1.5
    c.hook.position.y = -lower - 2
  }

  for (const d of anim.drones) {
    const a = t * d.speed + d.phase
    d.mesh.position.set(
      Math.cos(a) * d.radius,
      d.height + Math.sin(a * 1.7) * 2.5,
      d.zCenter + Math.sin(a * 0.6) * 18
    )
    d.mesh.rotation.y = a + Math.PI / 2
    if (d.mesh.userData.navLight) {
      d.mesh.userData.navLight.material.opacity = 0.5 + 0.5 * Math.sin(t * 8 + d.phase)
    }
  }

  for (const w of anim.workers) {
    const u = (Math.sin(t * w.speed + w.phase) + 1) / 2
    const z = w.z0 + (w.z1 - w.z0) * u
    const prevZ = w.mesh.position.z
    if (w.onFloor) {
      w.mesh.position.set(w.side * 14, w.floorY, z)
    } else {
      w.mesh.position.set(w.side * (BAY_WIDTH / 2 - 6.5), w.y, z)
    }
    if (Math.abs(z - prevZ) > 0.001) {
      w.mesh.rotation.y = z > prevZ ? 0 : Math.PI
    }
    const baseY = w.onFloor ? w.floorY : w.y
    w.mesh.position.y = baseY + Math.abs(Math.sin(t * 6 + w.phase)) * 0.08
  }

  for (const m of anim.mechs ?? []) {
    const u = (Math.sin(t * m.speed + m.phase) + 1) / 2
    const x = m.x0 + (m.x1 - m.x0) * u
    const prevX = m.mesh.position.x
    m.mesh.position.x = x
    m.mesh.position.z = m.z
    m.mesh.position.y = (m.baseY ?? FLOOR_Y + 2) + Math.abs(Math.sin(t * 3 + m.phase)) * 0.12
    if (Math.abs(x - prevX) > 0.001) {
      m.mesh.rotation.y = x > prevX ? Math.PI / 2 : -Math.PI / 2
    }
  }

  for (const r of anim.rovers ?? []) {
    const u = (Math.sin(t * r.speed + r.phase) + 1) / 2
    let z = r.z0 + (r.z1 - r.z0) * u
    let x = r.x
    // Soft collision: push clear of parked ships / player pad (never drive through hulls).
    const pads = anim.shipPads ?? []
    const clear = r.clear ?? 4
    for (let iter = 0; iter < 3; iter++) {
      for (const p of pads) {
        const dx = x - p.x
        const dz = z - p.z
        const d = Math.hypot(dx, dz)
        const minD = (p.r ?? 8) + clear
        if (d < minD) {
          if (d < 1e-4) {
            x += minD * (r.x >= 0 ? 1 : -1)
          } else {
            // Prefer lateral dodge so forward patrol continues.
            const push = (minD - d) / d
            x += dx * push * 1.35
            z += dz * push * 0.25
          }
        }
      }
    }
    const halfW = BAY_WIDTH / 2 - 8
    x = Math.max(-halfW, Math.min(halfW, x))
    z = Math.max(r.z0 - 2, Math.min(r.z1 + 2, z))
    const prevZ = r.mesh.position.z
    const prevX = r.mesh.position.x
    r.mesh.position.set(x, r.baseY ?? FLOOR_Y + 2, z)
    if (Math.abs(z - prevZ) > 0.02 || Math.abs(x - prevX) > 0.02) {
      r.mesh.rotation.y = Math.atan2(x - prevX, z - prevZ)
    }
  }

  for (const ship of anim.parkedShips) {
    if (ship.userData.engineGlow) {
      ship.userData.engineGlow.material.opacity =
        0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.5 + ship.position.x))
    }
  }

  for (const sp of anim.sparks) {
    const burst = (Math.sin(t * 5 + sp.phase) + 1) / 2
    sp.group.children.forEach((spark, i) => {
      const a = t * 4 + i * 0.9 + sp.phase
      const life = (burst + i * 0.08) % 1
      spark.position.set(
        Math.cos(a) * life * 1.8,
        life * 2.2,
        Math.sin(a * 1.3) * life * 1.8
      )
      spark.material.opacity = Math.max(0, 1 - life) * burst
      spark.scale.setScalar(0.5 + life)
    })
  }

  for (const fan of anim.fans) {
    fan.rotation.x += dt * 4
  }

  for (const h of anim.holograms) {
    const flicker = 0.4 + 0.35 * Math.sin(t * 2.5 + h.phase) + 0.1 * Math.sin(t * 17 + h.phase)
    h.mesh.material.opacity = Math.max(0.15, Math.min(0.75, flicker))
    if (h.isBoard) h.mesh.scale.y = 1 + 0.02 * Math.sin(t * 1.2)
  }

  if (anim.bayLight) {
    const boost = fancy ? 0.55 : 0.35
    anim.bayLight.intensity = (fancy ? 2.4 : 2.0) + boost * Math.sin(t * 0.8)
  }
  if (anim.padLight) {
    anim.padLight.intensity = (fancy ? 1.7 : 1.3) + (fancy ? 0.7 : 0.5) * Math.sin(t * 1.4)
  }

  if (fancy) {
    for (const pl of anim.pointLights ?? []) {
      const pulse = pl.base * (0.75 + 0.35 * Math.sin(t * pl.speed + pl.phase))
      pl.light.intensity = Math.max(0.15, pulse)
      if (pl.hueShift) {
        pl.light.color.setHSL(0.48 + 0.06 * Math.sin(t * 0.4 + pl.phase), 0.85, 0.6)
      }
    }
    for (const strip of anim.neonStrips ?? []) {
      const op = strip.base + strip.amp * (0.5 + 0.5 * Math.sin(t * 1.8 + strip.phase))
      strip.mesh.material.opacity = Math.max(0.12, Math.min(0.85, op))
    }
  }

  for (const gp of anim.glowPlanes ?? []) {
    gp.mesh.material.opacity =
      gp.base + gp.amp * (0.5 + 0.5 * Math.sin(t * 1.1 + gp.phase))
  }
}
