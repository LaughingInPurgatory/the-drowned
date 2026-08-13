/**
 * Docking-bay interior props — Kenney Space Station Kit (CC0) +
 * Quaternius Ultimate Space Kit selections (CC0 via Poly Pizza).
 * See public/models/interiors/(kenney|quaternius)/LICENSE.txt
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const KENNEY_BASE = 'models/interiors/kenney'
const QUAT_BASE = 'models/interiors/quaternius'
// Quaternius Modular Sci-Fi MegaKit (CC0) — real PBR sets (basecolor/normal/ORM)
// rather than a flat colour atlas, which is what lets the bay read as built
// hardware. Shipped as .gltf + .bin with shared textures, so these load by a
// different extension than the two .glb packs above.
const MEGAKIT_BASE = 'models/interiors/megakit'

const KENNEY_FILES = [
  'wall', 'wall-detail', 'wall-banner',
  'container', 'container-tall', 'container-wide', 'container-flat',
  'computer-system', 'computer-screen', 'display-wall-wide',
  'table-display', 'table-display-planet',
  'chair', 'pipe', 'skip', 'skip-rocks', 'rocks'
]

const QUAT_FILES = [
  'astronaut_a', 'astronaut_b', 'astronaut_c',
  'spaceship_a', 'spaceship_b', 'spaceship_c', 'spaceship_d',
  'mech_a', 'mech_b', 'mech_c',
  'pickup_crate', 'solar_panel', 'solar_structure',
  'roof_antenna', 'roof_radar',
  'geodesic_dome', 'metal_support',
  'rover', 'round_rover', 'enemy_flying'
]

const MEGAKIT_FILES = [
  'Prop_Light_Wide',
  'Prop_Crate3', 'Prop_Crate4', 'Prop_Chest', 'Prop_Barrel_Large',
  'Prop_Computer', 'Prop_AccessPoint',
  'Prop_Vent_Big', 'Prop_Vent_Wide',
  'Column_Astra'
]

/** @type {Map<string, { root: THREE.Object3D, size: THREE.Vector3, pack: string }>} */
const cache = new Map()
let loadPromise = null
let ready = false

function loadGltf(url) {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject)
  })
}

function prepareModule(scene) {
  scene.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(scene)
  const center = new THREE.Vector3()
  const size = new THREE.Vector3()
  box.getCenter(center)
  box.getSize(size)
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
  // Ensure materials can be recolored per theme.
  scene.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i]
      if (m && m.clone) {
        const c = m.clone()
        c.side = THREE.DoubleSide
        mats[i] = c
      }
    }
    obj.material = Array.isArray(obj.material) ? mats : mats[0]
  })
  return { root: scene, size }
}

export function preloadInteriorModels() {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const jobs = []
    for (const name of KENNEY_FILES) {
      jobs.push(
        loadGltf(`${KENNEY_BASE}/${name}.glb`)
          .then((scene) => {
            const prep = prepareModule(scene)
            cache.set(`k:${name}`, { ...prep, pack: 'kenney' })
            cache.set(name, cache.get(`k:${name}`))
          })
          .catch((err) => console.warn(`interior kenney load failed: ${name}`, err))
      )
    }
    for (const name of QUAT_FILES) {
      jobs.push(
        loadGltf(`${QUAT_BASE}/${name}.glb`)
          .then((scene) => {
            const prep = prepareModule(scene)
            cache.set(`q:${name}`, { ...prep, pack: 'quaternius' })
            // Prefer kenney when names collide (stairs); keep q: prefix for quat.
          })
          .catch((err) => console.warn(`interior quaternius load failed: ${name}`, err))
      )
    }
    for (const name of MEGAKIT_FILES) {
      jobs.push(
        loadGltf(`${MEGAKIT_BASE}/${name}.gltf`)
          .then((scene) => {
            const prep = prepareModule(scene)
            cache.set(`m:${name}`, { ...prep, pack: 'megakit' })
          })
          .catch((err) => console.warn(`interior megakit load failed: ${name}`, err))
      )
    }
    await Promise.all(jobs)
    ready = cache.size > 0
    return ready
  })()
  return loadPromise
}

export function interiorModelsReady() {
  return ready
}

export function hasInteriorModule(name) {
  if (!name) return false
  if (cache.has(name)) return true
  if (name.startsWith('q:') || name.startsWith('k:') || name.startsWith('m:')) {
    return cache.has(name)
  }
  return cache.has(`q:${name}`) || cache.has(`k:${name}`) || cache.has(`m:${name}`)
}

/**
 * Clone a module. Prefer explicit `k:` / `q:` prefix; bare names resolve kenney first.
 * @returns {{ obj: THREE.Object3D, size: THREE.Vector3 } | null}
 */
export function cloneInteriorModule(name) {
  const entry =
    cache.get(name) || cache.get(`k:${name}`) || cache.get(`q:${name}`) || cache.get(`m:${name}`)
  if (!entry) return null
  return { obj: entry.root.clone(true), size: entry.size.clone() }
}

/**
 * Place module with bottom on y (Kenney-style ground), centered on xz.
 */
export function placeInteriorModule(
  group,
  name,
  x,
  y,
  z,
  {
    rotY = 0,
    scale = 1,
    /** 'bottom' | 'center' */
    anchor = 'bottom'
  } = {}
) {
  const cloned = cloneInteriorModule(name)
  if (!cloned) return null
  const { obj, size } = cloned
  obj.scale.setScalar(scale)
  obj.rotation.y = rotY
  const h = size.y * scale
  obj.position.set(x, anchor === 'center' ? y : y + h * 0.5, z)
  group.add(obj)
  return { obj, size: size.clone().multiplyScalar(scale) }
}

/** Recolor / grit a cloned module tree for a theme. */
export function applyInteriorTint(root, { color, roughness, metalness, emissive, emissiveIntensity } = {}) {
  if (!root) return
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      if (color != null && m.color) m.color.multiply(new THREE.Color(color))
      if (roughness != null && 'roughness' in m) m.roughness = Math.min(1, Math.max(0, roughness))
      if (metalness != null && 'metalness' in m) m.metalness = Math.min(1, Math.max(0, metalness))
      if (emissive != null && m.emissive) m.emissive.set(emissive)
      if (emissiveIntensity != null && 'emissiveIntensity' in m) m.emissiveIntensity = emissiveIntensity
      m.needsUpdate = true
    }
  })
}
