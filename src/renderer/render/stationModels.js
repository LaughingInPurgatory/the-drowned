import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  stationMaterialMaps,
  cloneStationMaps,
  retileUVsTriplanar,
  STATION_NORMAL_STRENGTH
} from './textures.js'

const _worldScale = new THREE.Vector3()
// Module names that are equipment, not habitable structure. Portholes must
// never land on these — a lit window on a radar dish or a rocket fin is the
// giveaway that lights are being scattered by geometry rather than placed.
// Matched against the mesh and every ancestor, since the module name lives on
// the parent node of the GLB's mesh children.
const NO_WINDOW_PARTS = [
  'dish', 'wireless', 'antenna', 'radar', 'chimney', 'fins', 'cable',
  'generator', 'barrel', 'solar', 'rocket_base', 'machine'
]
function isEquipmentPart(obj) {
  for (let p = obj; p; p = p.parent) {
    const n = p.name && p.name.toLowerCase()
    if (n && NO_WINDOW_PARTS.some((frag) => n.includes(frag))) return true
  }
  return false
}
const _wNormal = new THREE.Vector3()
const _nrmMat = new THREE.Matrix3()
// Source geometry -> its per-face-retiled copy, so GLB clones keep sharing one.
const _retiledGeoCache = new WeakMap()

// Three orbital station archetypes from Kenney Space Kit modules (CC0 —
// public/models/stations/LICENSE.txt). Each type is one solid primary
// structure plus a couple of snug attachments — not a loose kitbash field.

const BASE = 'models/stations'

const MODULE_FILES = [
  'hangar_largeA',
  'hangar_largeB',
  'hangar_roundA',
  'hangar_roundGlass',
  'hangar_smallA',
  'gate_complex',
  'corridor',
  'corridor_cross',
  'platform_large',
  'rocket_baseA',
  'rocket_finsA',
  'rocket_fuelA',
  'machine_generator',
  'satelliteDish',
  'chimney_detailed'
]

/** @type {Map<string, { root: THREE.Object3D, size: THREE.Vector3 }>} */
const moduleCache = new Map()
/** @type {(THREE.Group|null)[]} */
let templates = [null, null, null]
let loadPromise = null
let ready = false

function loadGltf(url) {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject)
  })
}

/**
 * Bake geometry so the module's visual center is at local (0,0,0) and its
 * position can be set freely without fighting an internal pivot offset.
 */
function prepareModule(scene) {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
  // Prefer shifting children; if the scene has no children, shift meshes.
  if (scene.children.length) {
    for (const c of scene.children) {
      c.position.x -= center.x
      c.position.y -= center.y
      c.position.z -= center.z
    }
  } else {
    scene.position.sub(center)
  }
  scene.position.set(0, 0, 0)
  scene.updateMatrixWorld(true)
  return { root: scene, size }
}

function cloneModule(modName) {
  const entry = moduleCache.get(modName)
  if (!entry) return null
  return { obj: entry.root.clone(true), size: entry.size.clone() }
}

/**
 * Add a module with its *bottom* sitting on y=0 (Kenney ground convention)
 * after we centered it — so we lift by half-height.
 * Returns measured scaled size + placement for snug attachment of neighbors.
 */
function addModule(group, modName, x, z, rotY = 0, uniformScale = 1) {
  const cloned = cloneModule(modName)
  if (!cloned) return null
  const { obj, size } = cloned
  obj.scale.setScalar(uniformScale)
  obj.rotation.y = rotY
  const sx = size.x * uniformScale
  const sy = size.y * uniformScale
  const sz = size.z * uniformScale
  // Centered model: bottom was at -size.y/2; lift so it sits on y=0.
  obj.position.set(x, sy / 2, z)
  group.add(obj)
  return { size: new THREE.Vector3(sx, sy, sz), x, z, rotY, obj }
}

/** Stack module on top of another (same x/z), sitting on `baseTopY`. */
function stackModule(group, modName, x, z, baseTopY, rotY = 0, uniformScale = 1) {
  const cloned = cloneModule(modName)
  if (!cloned) return baseTopY
  const { obj, size } = cloned
  obj.scale.setScalar(uniformScale)
  obj.rotation.y = rotY
  const h = size.y * uniformScale
  obj.position.set(x, baseTopY + h / 2, z)
  group.add(obj)
  return baseTopY + h
}

/** Horizontal gap between two modules after rotation about Y (AABB on XZ). */
function moduleHalfXZ(size, rotY = 0) {
  const c = Math.abs(Math.cos(rotY))
  const s = Math.abs(Math.sin(rotY))
  // Rotated AABB extents.
  return {
    hx: (size.x * c + size.z * s) * 0.5,
    hz: (size.x * s + size.z * c) * 0.5
  }
}

/**
 * Center + size the assembly, baking transform into children so group.scale
 * stays 1. main.js applies STATION_SCALE via setScalar on the root mesh —
 * any scale left on the group here would be wiped and stations look tiny.
 */
function normalizeGroup(group, targetSize = 26) {
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return group
  const center = new THREE.Vector3()
  box.getCenter(center)
  for (const c of group.children) {
    c.position.x -= center.x
    c.position.y -= center.y
    c.position.z -= center.z
  }
  group.position.set(0, 0, 0)
  group.scale.set(1, 1, 1)
  group.updateMatrixWorld(true)
  const box2 = new THREE.Box3().setFromObject(group)
  const size2 = new THREE.Vector3()
  box2.getSize(size2)
  const maxDim = Math.max(size2.x, size2.y, size2.z, 0.001)
  const s = targetSize / maxDim
  for (const c of group.children) {
    c.position.multiplyScalar(s)
    c.scale.multiplyScalar(s)
  }
  return group
}

// --- Type 0: Large hangar station (one solid hangar + dish + small wing) --
function buildHangarStation() {
  const g = new THREE.Group()
  const main = addModule(g, 'hangar_largeA', 0, 0, 0, 1)
  if (!main) return normalizeGroup(g, 28)
  const mainXZ = moduleHalfXZ(main.size, 0)
  // Side hangar snug on +Z face (overlap slightly so no gap after normalize).
  const sideScale = 0.85
  const side = addModule(g, 'hangar_smallA', 0, 0, Math.PI, sideScale)
  if (side) {
    const sideXZ = moduleHalfXZ(side.size, Math.PI)
    side.obj.position.z = mainXZ.hz + sideXZ.hz * 0.92
  }
  // Dish on the roof.
  const dish = cloneModule('satelliteDish')
  if (dish) {
    const ds = 0.9
    dish.obj.scale.setScalar(ds)
    dish.obj.position.set(0, main.size.y + (dish.size.y * ds) * 0.35, 0)
    g.add(dish.obj)
  }
  // Corridor docking collar on the front (−Z).
  const cor = addModule(g, 'corridor', 0, 0, 0, 0.9)
  if (cor) {
    const corXZ = moduleHalfXZ(cor.size, 0)
    cor.obj.position.z = -(mainXZ.hz + corXZ.hz * 0.92)
  }
  return normalizeGroup(g, 28)
}

// --- Type 1: Round habitat dome + pad ------------------------------------
function buildDomeStation() {
  const g = new THREE.Group()
  const pad = addModule(g, 'platform_large', 0, 0, 0, 1.6)
  const dome = addModule(g, 'hangar_roundGlass', 0, 0, 0, 1)
  const domeXZ = dome ? moduleHalfXZ(dome.size, 0) : { hx: 1, hz: 1 }
  // Machine flush to +X of dome.
  const mach = addModule(g, 'machine_generator', 0, 0, -0.3, 1.2)
  if (mach) {
    const mXZ = moduleHalfXZ(mach.size, -0.3)
    mach.obj.position.x = domeXZ.hx + mXZ.hx * 0.9
    mach.obj.position.z = 0.15
  }
  // Small hangar on −X.
  const small = addModule(g, 'hangar_smallA', 0, 0, Math.PI / 2, 0.7)
  if (small) {
    const sXZ = moduleHalfXZ(small.size, Math.PI / 2)
    small.obj.position.x = -(domeXZ.hx + sXZ.hx * 0.9)
  }
  const dish = cloneModule('satelliteDish')
  if (dish && dome) {
    const ds = 1.0
    dish.obj.scale.setScalar(ds)
    dish.obj.position.set(0.2, dome.size.y + dish.size.y * ds * 0.3, 0.2)
    g.add(dish.obj)
  }
  // Keep pad under everything (y already 0-based).
  if (pad) pad.obj.position.y = pad.size.y * 0.5
  return normalizeGroup(g, 26)
}

// --- Type 2: Gate tower with rocket stack --------------------------------
function buildGateStation() {
  const g = new THREE.Group()
  const pad = addModule(g, 'platform_large', 0, 0, 0, 1.8)
  // Gate scaled up as the main structure.
  const gate = addModule(g, 'gate_complex', 0, 0, 0, 2.4)
  const padXZ = pad ? moduleHalfXZ(pad.size, 0) : { hx: 2, hz: 2 }
  // Rocket stack on the pad, just inside the edge.
  const rx = padXZ.hx * 0.55
  const rz = padXZ.hz * 0.15
  let top = 0
  top = stackModule(g, 'rocket_baseA', rx, rz, top, 0, 0.75)
  top = stackModule(g, 'rocket_fuelA', rx, rz, top, 0, 0.75)
  stackModule(g, 'rocket_finsA', rx, rz, top, 0, 0.75)
  // Chimney opposite side, still on the pad.
  addModule(g, 'chimney_detailed', -rx * 0.9, rz, 0, 1.0)
  // Cargo bay on −Z face of pad, snug.
  const bay = addModule(g, 'hangar_roundA', 0, 0, 0, 0.65)
  if (bay) {
    const bXZ = moduleHalfXZ(bay.size, 0)
    bay.obj.position.z = -(padXZ.hz + bXZ.hz * 0.85)
  }
  return normalizeGroup(g, 30)
}

const BUILDERS = [buildHangarStation, buildDomeStation, buildGateStation]

export const STATION_TYPE_COUNT = 3
export const STATION_TYPE_NAMES = ['hangar', 'dome', 'gate']

export function stationModelsReady() {
  return ready
}

export function preloadStationModels() {
  if (ready) return Promise.resolve()
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    await Promise.all(
      MODULE_FILES.map(async (name) => {
        try {
          const scene = await loadGltf(`${BASE}/${name}.glb`)
          scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = false
              o.receiveShadow = false
              // Kenney pieces are often MeshStandard with dark defaults; ensure
              // double-sided so thin walls don't vanish from one view.
              if (o.material) {
                const mats = Array.isArray(o.material) ? o.material : [o.material]
                for (const m of mats) {
                  if (m) m.side = THREE.DoubleSide
                }
              }
            }
          })
          moduleCache.set(name, prepareModule(scene))
        } catch (err) {
          console.warn(`[stationModels] failed to load ${name}.glb`, err)
        }
      })
    )

    for (let i = 0; i < BUILDERS.length; i++) {
      try {
        templates[i] = BUILDERS[i]()
        templates[i].name = `station-template-${STATION_TYPE_NAMES[i]}`
      } catch (err) {
        console.warn(`[stationModels] template ${i} failed`, err)
        templates[i] = null
      }
    }
    ready = templates.some(Boolean)
  })()

  return loadPromise
}

function tintMaterials(root, hullColor, accentColor, panelColor) {
  // Worn panel maps need denser UVs than Kenney atlas packing. Geometry is
  // small in local space; scale lives on parents — bake world scale into dens.
  const mapsHull = stationMaterialMaps('hull', STATION_NORMAL_STRENGTH)
  const mapsAccent = stationMaterialMaps('accent', STATION_NORMAL_STRENGTH * 1.05)
  const mapsPanel = stationMaterialMaps('panel', STATION_NORMAL_STRENGTH * 1.1)
  root.updateMatrixWorld(true)
  let i = 0
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return
    // Keep nav beacons (MeshBasicMaterial) alone.
    if (o.material.isMeshBasicMaterial) return
    if (o.geometry) {
      // Re-UV once per shared source BufferGeometry (clones share geo).
      // Per-face triplanar returns a NEW geometry, so the result is cached
      // against the source — otherwise every clone would get its own copy and
      // the sharing this guard exists to preserve would be lost.
      const src = o.geometry
      let retiled = _retiledGeoCache.get(src)
      if (!retiled) {
        o.getWorldScale(_worldScale)
        const sc = Math.max(_worldScale.x, _worldScale.y, _worldScale.z, 0.01)
        // World dens ~0.28 × 12.8 plates/UV ≈ plate every ~0.3 world units
        retiled = retileUVsTriplanar(src, 0.28 * sc)
        retiled.userData.stationRetiled = true
        _retiledGeoCache.set(src, retiled)
      }
      o.geometry = retiled
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    const replaced = mats.map(() => {
      const pick = i++ % 5
      // Mostly hull, occasional accent/panel — avoids rainbow noise.
      const role = pick === 0 ? 'accent' : pick === 1 ? 'panel' : 'hull'
      const color =
        role === 'accent' ? accentColor : role === 'panel' ? panelColor : hullColor
      const baseMaps = role === 'accent' ? mapsAccent : role === 'panel' ? mapsPanel : mapsHull
      const maps = cloneStationMaps(baseMaps, {
        offsetU: (i * 0.17) % 1,
        offsetV: (i * 0.31) % 1,
        rot: (i % 4) * 0.05
      })
      // Per-panel wear variance (mottled age, not factory-fresh).
      const c = color.clone().offsetHSL(
        ((i * 17) % 7) * 0.004 - 0.012,
        0.04,
        ((i * 13) % 5) * 0.018 - 0.06
      )
      // Brighter base so map×color still reads under sparse scene lights
      // (dark worn albedo × mid greys was pure black silhouettes).
      return new THREE.MeshStandardMaterial({
        color: c,
        // Plated metal, not near-dielectric. At 0.28/0.72 the hull caught
        // almost nothing from the environment and read as flat matte plastic;
        // this is the GLB path, so it is what actually renders for stations.
        metalness: 0.45 + (i % 3) * 0.05,
        roughness: 0.58 + (i % 4) * 0.05,
        envMapIntensity: 1.35,
        map: maps.map,
        normalMap: maps.normalMap,
        roughnessMap: maps.roughnessMap,
        metalnessMap: maps.metalnessMap,
        aoMap: maps.aoMap,
        aoMapIntensity: maps.aoMap ? 0.95 : 1,
        normalScale: maps.normalScale
          ? maps.normalScale.clone().multiplyScalar(0.75)
          : undefined,
        side: THREE.FrontSide
      })
    })
    o.material = replaced.length === 1 ? replaced[0] : replaced
  })
}

// ponytail: AABB greebles floated off the hull ("bits not attached") — skip them.

function addNavBeacons(group, phaseBase = 0) {
  const mk = (pos, color, phase, r = 0.35) => {
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(r, 10, 8),
      new THREE.MeshBasicMaterial({ color })
    )
    light.position.copy(pos)
    group.add(light)
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(r * 2.4, 12, 10),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    glow.position.copy(pos)
    group.add(glow)
    if (!group.userData.beacons) group.userData.beacons = []
    group.userData.beacons.push({ glow, phase })
  }
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  mk(new THREE.Vector3(0, box.max.y + 0.4, 0), 0xff4040, phaseBase)
  mk(new THREE.Vector3(0, box.min.y - 0.2, 0), 0xff4040, phaseBase + Math.PI, 0.28)
}

/**
 * Station self-lighting: lit window bands, port/starboard strobes and bay
 * floodlights. A GLB station previously carried two red beacons and nothing
 * else, so away from the sun it was a black lump — real orbital hardware is
 * mostly visible by its OWN lights.
 *
 * Everything here is emissive/additive geometry rather than real lights: the
 * renderer keeps a fixed light count on purpose (adding lights at runtime
 * recompiles every MeshStandardMaterial — the combat hitch noted in AGENTS.md).
 * Emissive values run over 1.0 so the bloom pass ignites them.
 *
 * Placement is off the assembly's AABB, same as addNavBeacons already does —
 * this is lighting on the silhouette, not the AABB greebling that was removed.
 */
/**
 * Split a station's meshes into everything solid (`all`) and the subset that
 * counts as habitable wall (`wall`).
 *
 * Shared by window placement and hull greebling so both obey the same rule.
 * Rays are cast at `all` and the hit rejected unless the NEAREST surface is in
 * `wall` — casting only at `wall` lets a ray pass straight through a dish and
 * land on the plating behind it, which is how portholes ended up looking like
 * they were stuck to the radar.
 */
function collectWallSurfaces(group, size) {
  const stationRadius = size.length() * 0.5
  const all = []
  const wall = new Set()
  const scale = new THREE.Vector3()
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    if (o.userData.stationLight || o.userData.stationGreeble) return
    all.push(o)
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    if (mats.some((mm) => mm?.userData?.noWindows)) return
    // Equipment (dishes, antennae, fins, chimneys) is never a wall.
    if (isEquipmentPart(o)) return
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere()
    const bs = o.geometry.boundingSphere
    if (!bs) return
    o.getWorldScale(scale)
    const worldR = bs.radius * Math.max(scale.x, scale.y, scale.z)
    // Too small to be habitable structure — a masthead is not a wall.
    if (worldR < stationRadius * 0.12) return
    wall.add(o)
  })
  return { all, wall }
}

/**
 * Surface-projected hull greebling: vents, conduit runs and equipment housings
 * sitting flush on the plating.
 *
 * This is NOT the AABB greebling that was removed previously — nothing is
 * placed from the bounding box. Each piece is raycast onto a real wall (same
 * rule as the portholes: nearest surface must be a wall, not a dish or fin) and
 * then oriented to that surface's normal, so detail follows the actual
 * structure instead of floating in the box around it.
 *
 * A whole station is only ~1,900 triangles, so it can carry this comfortably.
 */
function addHullGreebles(group, rng, colors) {
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return
  const size = new THREE.Vector3()
  const centre = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(centre)
  const { all, wall } = collectWallSurfaces(group, size)
  if (!wall.size) return

  const ring = Math.max(0.5, Math.max(size.x, size.z) * 0.5)
  // Two tones so greebles read as fitted hardware rather than hull lumps.
  const matBody = new THREE.MeshStandardMaterial({
    color: colors.panel.clone().offsetHSL(0, 0, -0.05),
    metalness: 0.55,
    roughness: 0.6,
    envMapIntensity: 1.25
  })
  const trimColor = colors.panel.clone()
  trimColor.setHSL(...(() => { const h = {}; trimColor.getHSL(h); return [h.h, h.s * 0.5, h.l * 0.85] })())
  const matTrim = new THREE.MeshStandardMaterial({
    color: trimColor,
    metalness: 0.6,
    roughness: 0.5,
    envMapIntensity: 1.3
  })

  const ray = new THREE.Raycaster()
  const from = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const nrm = new THREE.Vector3()
  const nrmMat = new THREE.Matrix3()
  const up = new THREE.Vector3(0, 1, 0)
  const quat = new THREE.Quaternion()

  const attempts = 120
  let placed = 0
  for (let i = 0; i < attempts && placed < 34; i++) {
    const a = rng() * Math.PI * 2
    const y = centre.y + (rng() - 0.5) * size.y * 0.8
    from.set(centre.x + Math.cos(a) * ring * 3, y, centre.z + Math.sin(a) * ring * 3)
    dir.set(-Math.cos(a), 0, -Math.sin(a)).normalize()
    ray.set(from, dir)
    const hit = ray.intersectObjects(all, false)[0]
    if (!hit?.face) continue
    if (!wall.has(hit.object)) continue
    nrm.copy(hit.face.normal).applyNormalMatrix(nrmMat.getNormalMatrix(hit.object.matrixWorld)).normalize()
    if (nrm.dot(dir) > -0.35) continue
    if (Math.abs(nrm.y) > 0.5) continue

    // Three shapes: flat vent panel, conduit run, boxy housing.
    const kind = rng()
    let geo
    let mat
    const s = ring * (0.014 + rng() * 0.022)
    if (kind < 0.55) {
      geo = new THREE.BoxGeometry(s * 2.2, s * 1.3, s * 0.35)
      mat = matBody
    } else if (kind < 0.8) {
      geo = new THREE.CylinderGeometry(s * 0.16, s * 0.16, s * 2.4, 6)
      geo.rotateZ(Math.PI / 2) // lie along the surface, not poking out of it
      mat = matTrim
    } else {
      geo = new THREE.BoxGeometry(s * 1.1, s * 1.1, s * 0.9)
      mat = matBody
    }
    const m = new THREE.Mesh(geo, mat)
    // Sit ON the plating: half the depth proud of the surface.
    m.position.copy(hit.point).addScaledVector(nrm, s * 0.18)
    quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm)
    m.quaternion.copy(quat)
    m.rotateZ(rng() * Math.PI)
    m.userData.stationGreeble = true
    group.add(m)
    placed++
  }
}

/**
 * Does a panel of w x h, centred at `point` and lying on `normal`, sit entirely
 * on wall surface?
 *
 * Checking only the centre hit is not enough: a ray landing near the top edge
 * of a wall places a pane whose upper half overhangs into empty space, which is
 * exactly what read as "floating windows". Every corner has to find wall at
 * roughly the same depth as the centre.
 */
function footprintOnWall(point, normal, w, h, all, wall, ray, standoff, tol) {
  _fpRight.set(0, 1, 0).cross(normal)
  if (_fpRight.lengthSq() < 1e-6) _fpRight.set(1, 0, 0).cross(normal)
  _fpRight.normalize()
  _fpUp.crossVectors(normal, _fpRight).normalize()
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1
    const sy = i & 2 ? 1 : -1
    _fpCorner
      .copy(point)
      .addScaledVector(_fpRight, sx * w * 0.5)
      .addScaledVector(_fpUp, sy * h * 0.5)
    _fpFrom.copy(_fpCorner).addScaledVector(normal, standoff)
    _fpDir.copy(normal).negate()
    ray.set(_fpFrom, _fpDir)
    const hit = ray.intersectObjects(all, false)[0]
    if (!hit) return false
    if (!wall.has(hit.object)) return false
    // Corner must be at essentially the same depth — otherwise it is hanging
    // over an edge and finding some other surface far behind.
    if (Math.abs(hit.distance - standoff) > tol) return false
  }
  return true
}

const _fpRight = new THREE.Vector3()
const _fpUp = new THREE.Vector3()
const _fpCorner = new THREE.Vector3()
const _fpFrom = new THREE.Vector3()
const _fpDir = new THREE.Vector3()

export function addStationLighting(group, rng, { strobes = true } = {}) {
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return
  const size = new THREE.Vector3()
  const centre = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(centre)
  const rx = Math.max(0.5, size.x * 0.5)
  const rz = Math.max(0.5, size.z * 0.5)
  const ring = Math.max(rx, rz)

  if (!group.userData.beacons) group.userData.beacons = []
  group.userData.strobes = []
  group.userData.windows = []

  // Candidate hull meshes, gathered BEFORE any lights are added so the rays
  // below cannot hit a window that was just placed.
  //
  // Portholes belong on WALLS. Two filters keep them off everything else:
  //  - material tagged noWindows (glazing, radiator fins, solar arrays)
  //  - fittings too small to be habitable structure: dishes, antennae, masts
  //    and beacons are a fraction of the assembly's size, and a lit porthole
  //    on a radar dish looks absurd.
  const { all, wall } = collectWallSurfaces(group, size)
  if (!wall.size) return

  // --- Lit window bands ---------------------------------------------------
  // Placed by raycasting inward onto the actual hull. Ringing them around the
  // bounding box instead leaves them hanging in empty space wherever the
  // structure is narrower than its AABB — which on these assemblies is most
  // of the height.
  const ray = new THREE.Raycaster()
  const from = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const placements = []
  // Single source of truth for the pane size — the footprint test below and the
  // mesh built from it must not disagree, or the validation is meaningless.
  const winW = ring * 0.0375
  const winH = size.y * 0.01875
  // More attempts than before: the footprint test rejects edge hits, so a
  // similar number of panes needs a wider search.
  const bands = 3 + Math.floor(rng() * 2)
  for (let b = 0; b < bands; b++) {
    const y = centre.y + size.y * (0.3 - (b / Math.max(1, bands - 1)) * 0.56)
    const count = 18 + Math.floor(rng() * 14)
    const warmBand = rng() < 0.72
    for (let i = 0; i < count; i++) {
      if (rng() < 0.22) continue // dark window
      const a = (i / count) * Math.PI * 2 + rng() * 0.05
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      // Fire from outside the hull straight at the axis at this height.
      from.set(centre.x + cos * ring * 3, y, centre.z + sin * ring * 3)
      dir.set(-cos, 0, -sin).normalize()
      ray.set(from, dir)
      const hit = ray.intersectObjects(all, false)[0]
      if (!hit?.face) continue
      // The outermost surface here must itself be a wall.
      if (!wall.has(hit.object)) continue
      // Use the real surface normal, not the ray: a porthole has to lie flat on
      // the plating it is set into.
      _wNormal.copy(hit.face.normal).applyNormalMatrix(_nrmMat.getNormalMatrix(hit.object.matrixWorld)).normalize()
      // Outward-facing only (skip backfaces seen through an opening).
      if (_wNormal.dot(dir) > -0.35) continue
      // Wall-like only: a near-horizontal normal means a vertical wall. This
      // rejects roofs, decks, and the sloped faces of dishes and fins.
      if (Math.abs(_wNormal.y) > 0.5) continue
      // And the whole pane has to fit on that wall, not just its centre.
      if (!footprintOnWall(hit.point, _wNormal, winW, winH, all, wall, ray, ring * 0.5, ring * 0.03)) {
        continue
      }
      placements.push({ point: hit.point.clone(), normal: _wNormal.clone(), warmBand })
    }
  }

  for (const pl of placements) {
    const lit = pl.warmBand
      ? new THREE.Color().setHSL((28 + rng() * 14) / 360, 0.75, 0.62)
      : new THREE.Color().setHSL((196 + rng() * 20) / 360, 0.5, 0.72)
    // Over 1.0 so bloom picks it up as a genuine light source.
    lit.multiplyScalar(1.5 + rng() * 0.9)
    const win = new THREE.Mesh(
      // 25% smaller than the first pass — at the original size the portholes
      // read as lit panels rather than windows set into the plating.
      new THREE.PlaneGeometry(winW, winH),
      new THREE.MeshBasicMaterial({
        color: lit,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    // Sit just proud of the surface so it never z-fights the plating.
    win.position.copy(pl.point).addScaledVector(pl.normal, ring * 0.004)
    win.lookAt(win.position.clone().add(pl.normal))
    win.userData.stationLight = true
    group.add(win)
    if (rng() < 0.16) {
      group.userData.windows.push({ mesh: win, phase: rng() * Math.PI * 2, speed: 0.6 + rng() * 2.4 })
    }
  }

  // --- Port / starboard strobes ------------------------------------------
  // Red to port, green to starboard, the real convention. Sharp blink rather
  // than the beacons' slow breathing so they read as separate hardware.
  const strobe = (x, z, color, phase) => {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(ring * 0.018, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) })
    )
    core.position.set(centre.x + x, centre.y, centre.z + z)
    core.userData.stationLight = true
    group.add(core)
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(ring * 0.05, 10, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    halo.position.copy(core.position)
    halo.userData.stationLight = true
    group.add(halo)
    group.userData.strobes.push({ core, halo, phase })
  }
  // Surface settlements skip these: port/starboard nav lights are a spacecraft
  // convention and read as nonsense bolted to the side of a ground base.
  if (strobes) {
    strobe(-rx * 1.02, 0, 0xff2a2a, 0)
    strobe(rx * 1.02, 0, 0x2aff5a, Math.PI)
  }
}


export function buildStationFromFreeModel(typeIndex, colorRng) {
  if (!ready) return null
  const idx = ((typeIndex % STATION_TYPE_COUNT) + STATION_TYPE_COUNT) % STATION_TYPE_COUNT
  const template = templates[idx]
  if (!template) return null

  const group = template.clone(true)
  group.name = `station-${STATION_TYPE_NAMES[idx]}`

  // Space-worn exterior: warmer oxidized greys (light enough to catch fill light).
  const warm = colorRng() < 0.72
  const hue = warm ? 18 + colorRng() * 28 : 195 + colorRng() * 25
  // Spread hull / accent / panel apart in VALUE — see hullMaterials in
  // stationMesh.js. Clustered lightness is what made stations one brown mass.
  const hullColor = new THREE.Color().setHSL(hue / 360, 0.06 + colorRng() * 0.09, 0.5 + colorRng() * 0.1)
  const accentColor = new THREE.Color().setHSL(((hue + 90 + colorRng() * 70) % 360) / 360, 0.42 + colorRng() * 0.2, 0.56 + colorRng() * 0.1)
  const panelColor = hullColor.clone().offsetHSL((colorRng() - 0.5) * 0.05, 0.04, -0.18 - colorRng() * 0.07)
  tintMaterials(group, hullColor, accentColor, panelColor)
  // Greeble first: addStationLighting excludes greebles from its ray set, and
  // this keeps hull detail from being placed on top of a porthole.
  addHullGreebles(group, colorRng, { hull: hullColor, accent: accentColor, panel: panelColor })
  addNavBeacons(group, colorRng() * Math.PI * 2)
  addStationLighting(group, colorRng)

  return group
}
