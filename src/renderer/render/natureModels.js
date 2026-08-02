/**
 * Island vegetation models.
 *
 * Primary: Quaternius Ultimate Nature Pack (CC0) — low-poly trees, bushes,
 * plants, grass. Source FBX is solid-colour Phong (Wood / Green / DarkGreen)
 * with no UVs; we bake PBR maps (grass foliage + bark trunks) via triplanar UVs.
 * A textured CC0 broadleaf is retained separately for the closest canopy layer;
 * its alpha-cut leaves and bark maps are intentionally kept intact.
 * Fallback: Kenney Nature Kit GLBs if Quaternius fails to load.
 * See public/models/nature/(quaternius|kenney)/LICENSE.txt
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { getPlantTextures, retileUVsTriplanar } from './textures.js'

const QUAT_BASE = 'models/nature/quaternius'
const KENNEY_BASE = 'models/nature/kenney'
const REALISTIC_BASE = 'models/nature/realistic'

/**
 * Near-white-green tints so albedo maps show (dark × map = mud).
 * Still read as foliage next to island grass.
 */
export const ISLAND_GRASS_GREEN = 0xc4d49a
export const ISLAND_GRASS_GREEN_DARK = 0xa8bc7a
export const ISLAND_SCRUB_GREEN = 0xc4c090
/** Warm bark tint over Bark012 albedo. */
export const TREE_TRUNK_BROWN = 0xc8a888

const QUAT_TREES = [
  'CommonTree_1',
  'CommonTree_2',
  'CommonTree_3',
  'CommonTree_4',
  'CommonTree_5',
  'PineTree_1',
  'PineTree_2',
  'PineTree_3',
  'PineTree_4',
  'BirchTree_1',
  'BirchTree_2',
  'Willow_1',
  'Willow_2'
]

/** Bushes + low plants + flowers — used as undergrowth foliage. */
const QUAT_BUSHES = [
  'Bush_1',
  'Bush_2',
  'BushBerries_1',
  'BushBerries_2',
  'Plant_1',
  'Plant_2',
  'Plant_3',
  'Plant_4',
  'Plant_5',
  'Flowers'
]

/** Clump grass for instanced shore bands. */
const QUAT_GRASS = ['Grass', 'Grass_2', 'Grass_Short']

const KENNEY_TREES = [
  'tree_detailed',
  'tree_oak',
  'tree_default',
  'tree_pineDefaultA',
  'tree_pineTallA',
  'tree_tall',
  'tree_thin'
]

const KENNEY_BUSHES = ['plant_bush', 'plant_bushLarge', 'plant_bushSmall']
const KENNEY_GRASS = ['grass', 'grass_large', 'grass_leafs']

/**
 * @typedef {{ root: THREE.Object3D, height: number, radius: number }} NatureProto
 * @type {Map<string, NatureProto>}
 */
const cache = new Map()
/** Detailed models used sparingly at the front of a woodland. */
const heroTreeCache = new Map()
/** @type {Map<string, { geometry: THREE.BufferGeometry, material: THREE.Material, height: number }>} */
const grassMeshes = new Map()

let loadPromise = null
let ready = false
/** @type {'quaternius'|'kenney'|null} */
let activePack = null

function loadGltf(url) {
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject)
  })
}

function loadFbx(url) {
  const loader = new FBXLoader()
  return new Promise((resolve, reject) => {
    loader.load(url, (obj) => resolve(obj), undefined, reject)
  })
}

/**
 * Foliage / grass with island grass PBR maps (or solid if headless / load fail).
 * Tint stays light so photo detail multiplies through.
 */
function makeFoliageMaterial(dark = false, dry = false) {
  let hex = dark ? ISLAND_GRASS_GREEN_DARK : ISLAND_GRASS_GREEN
  if (dry) hex = dark ? 0xb0a868 : ISLAND_SCRUB_GREEN
  const maps = getPlantTextures('foliage') ?? {}
  return new THREE.MeshStandardMaterial({
    color: hex,
    map: maps.map ?? null,
    normalMap: maps.normalMap ?? null,
    // Skip roughnessMap — dark grass patches read as wet specular flecks.
    roughness: 0.93,
    metalness: 0,
    envMapIntensity: 0.06,
    side: THREE.DoubleSide,
    flatShading: false,
    normalScale: new THREE.Vector2(0.9, 0.9)
  })
}

/** Bark-mapped trunk (ambientCG Bark012). */
function makeTrunkMaterial() {
  const maps = getPlantTextures('bark') ?? {}
  return new THREE.MeshStandardMaterial({
    color: TREE_TRUNK_BROWN,
    map: maps.map ?? null,
    normalMap: maps.normalMap ?? null,
    roughnessMap: maps.roughnessMap ?? null,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.05,
    flatShading: false,
    normalScale: new THREE.Vector2(1.15, 1.15)
  })
}

/** UV density for baked unit-space plant meshes (~1–2 units tall). */
function plantUvDensity(isGrass) {
  return isGrass ? 1.8 : 1.35
}

/**
 * Decide foliage vs trunk from Quaternius material names (Wood / Green / DarkGreen)
 * or source colour. Prefer name — FBX often loads diffuse as washed-out grey.
 */
function isFoliageMaterial(src, meshName = '') {
  const name = String(src?.name || meshName || '').toLowerCase()
  if (/wood|bark|trunk|stem|branch|brown/.test(name)) return false
  if (/green|leaf|leav|foliage|canopy|pine|needl|flower|petal|grass|plant|berry/.test(name)) {
    return true
  }
  if (/dark/.test(name) && /green/.test(name)) return true
  // Colour heuristic (only when names are unhelpful)
  if (src?.color) {
    const { r, g, b } = src.color
    if (r > g * 1.05 && r > b * 1.05 && g < 0.55) return false // brown-ish
    if (g > r * 0.9 && g > b * 0.9) return true
  }
  // Default: treat unnamed plant meshes as foliage (bushes/grass have no wood).
  return true
}

function isDarkFoliage(src, meshName = '') {
  const name = String(src?.name || meshName || '').toLowerCase()
  return /dark/.test(name)
}

/**
 * Replace every mesh material with textured MeshStandardMaterial.
 * Drops FBX Phong + broken maps; canopies get grass PBR, wood gets bark.
 */
function applyPlantMaterials(root, { dry = false, forceFoliage = false } = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    // Grass is deliberately receive-only. Thousands of thin blades add a
    // disproportionate amount of work to the shadow pass and make a noisy
    // stippled shadow, while trees and larger foliage still cast properly.
    obj.castShadow = !forceFoliage
    obj.receiveShadow = true
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    const out = list.map((src) => {
      if (forceFoliage || isFoliageMaterial(src, obj.name)) {
        return makeFoliageMaterial(isDarkFoliage(src, obj.name), dry)
      }
      return makeTrunkMaterial()
    })
    obj.material = Array.isArray(obj.material) ? out : out[0]
  })
}

/**
 * Bake all meshes into a clean Group with identity root transform and
 * geometry in unit space (target height ≈ `targetH`).
 * Fixes: placePlantClone was wiping root.scale after prepare, exploding FBX cm-scale models.
 * Quaternius has no UVs — triplanar re-UV after normalize so PBR maps tile cleanly.
 */
function bakePlantRoot(source, { targetH = 2, dry = false, isGrass = false } = {}) {
  source.updateMatrixWorld(true)

  // Collect meshes before we strip hierarchy.
  /** @type {THREE.Mesh[]} */
  const meshes = []
  source.traverse((o) => {
    if ((o.isMesh || o.isSkinnedMesh) && o.geometry) meshes.push(o)
  })

  applyPlantMaterials(source, { dry, forceFoliage: isGrass })

  const wrapper = new THREE.Group()
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    let geo = mesh.geometry.clone()
    geo.applyMatrix4(mesh.matrixWorld)
    // Drop skinning / colour attrs that fight standard mats
    for (const key of Object.keys(geo.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        geo.deleteAttribute(key)
      }
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals()
    const mat = mesh.material
    // Clone so instances don't share mutable mats (dry tint, etc.)
    const matOut = Array.isArray(mat) ? mat.map((m) => m.clone()) : mat.clone()
    const nm = new THREE.Mesh(geo, matOut)
    nm.castShadow = !isGrass
    nm.receiveShadow = true
    nm.name = mesh.name || 'plantPart'
    // Tag for UV density after normalize (foliage denser than bark).
    nm.userData.isFoliage =
      isGrass ||
      (Array.isArray(mesh.material)
        ? mesh.material.every((m) => isFoliageMaterial(m, mesh.name))
        : isFoliageMaterial(mesh.material, mesh.name))
    wrapper.add(nm)
  }

  if (!wrapper.children.length) {
    return { root: wrapper, height: targetH, radius: targetH * 0.3, isGrass }
  }

  // Normalize height to targetH, ground min.y = 0, centre XZ.
  wrapper.updateMatrixWorld(true)
  const box0 = new THREE.Box3().setFromObject(wrapper)
  const size0 = new THREE.Vector3()
  box0.getSize(size0)
  const h0 = Math.max(size0.y, 0.001)
  const s = targetH / h0
  for (const child of wrapper.children) {
    if (!child.geometry) continue
    child.geometry.scale(s, s, s)
  }
  wrapper.updateMatrixWorld(true)
  const box1 = new THREE.Box3().setFromObject(wrapper)
  const cx = (box1.min.x + box1.max.x) * 0.5
  const cz = (box1.min.z + box1.max.z) * 0.5
  const uvDens = plantUvDensity(isGrass)
  for (const child of wrapper.children) {
    if (!child.geometry) continue
    child.geometry.translate(-cx, -box1.min.y, -cz)
    // Project UVs in final unit space (source FBX has none).
    const dens = child.userData.isFoliage ? uvDens : uvDens * 0.85
    child.geometry = retileUVsTriplanar(child.geometry, dens)
    child.geometry.computeBoundingBox()
    child.geometry.computeBoundingSphere()
  }

  wrapper.updateMatrixWorld(true)
  const box2 = new THREE.Box3().setFromObject(wrapper)
  const size2 = new THREE.Vector3()
  box2.getSize(size2)
  return {
    root: wrapper,
    height: Math.max(0.08, size2.y),
    radius: Math.max(size2.x, size2.z) * 0.5,
    isGrass
  }
}

/**
 * Keep an authored GLB's materials and alpha-cut foliage rather than replacing
 * them with the generic plant material. It is only used for a small foreground
 * share, where the extra geometry and texture detail are visible.
 */
function prepareHeroTree(source) {
  source.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(source)
  const size = new THREE.Vector3()
  box.getSize(size)
  const height = Math.max(0.08, size.y)
  const root = new THREE.Group()
  source.position.x -= (box.min.x + box.max.x) * 0.5
  source.position.y -= box.min.y
  source.position.z -= (box.min.z + box.max.z) * 0.5
  root.add(source)
  root.traverse((obj) => {
    if (!obj.isMesh) return
    obj.castShadow = true
    obj.receiveShadow = true
  })
  return { root, height, radius: Math.max(size.x, size.z) * 0.5 }
}

/**
 * Bake all meshes under root into one geometry + textured grass material for InstancedMesh.
 */
function extractGrassMesh(root) {
  root.updateMatrixWorld(true)
  /** @type {THREE.BufferGeometry[]} */
  const geos = []
  root.traverse((o) => {
    if ((!o.isMesh && !o.isSkinnedMesh) || !o.geometry) return
    const g = o.geometry.clone()
    o.updateWorldMatrix(true, false)
    g.applyMatrix4(o.matrixWorld)
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        g.deleteAttribute(key)
      }
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    geos.push(g)
  })
  if (!geos.length) return null

  let geo
  if (geos.length === 1) {
    geo = geos[0]
  } else {
    const merged = mergeGeometries(geos, false)
    for (const g of geos) g.dispose()
    if (!merged) return null
    geo = merged
  }

  geo.computeBoundingBox()
  const bb = geo.boundingBox
  if (!bb || !Number.isFinite(bb.min.x)) {
    geo.dispose()
    return null
  }
  geo.translate(-(bb.min.x + bb.max.x) * 0.5, -bb.min.y, -(bb.min.z + bb.max.z) * 0.5)
  geo = retileUVsTriplanar(geo, plantUvDensity(true))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  const mat = makeFoliageMaterial(false, false)
  const h = Math.max(0.05, geo.boundingBox.max.y - geo.boundingBox.min.y)
  return { geometry: geo, material: mat, height: h }
}

async function loadPackQuaternius() {
  const jobs = []
  for (const name of QUAT_TREES) {
    jobs.push(
      loadFbx(`${QUAT_BASE}/${name}.fbx`)
        .then((scene) => {
          // Normalize tree height to 2 units — placement scales from this.
          cache.set(`tree:${name}`, bakePlantRoot(scene, { targetH: 2, dry: false }))
        })
        .catch((e) => console.warn(`[nature] quat tree fail ${name}`, e))
    )
  }
  for (const name of QUAT_BUSHES) {
    jobs.push(
      loadFbx(`${QUAT_BASE}/${name}.fbx`)
        .then((scene) => {
          cache.set(`bush:${name}`, bakePlantRoot(scene, { targetH: 1.2, dry: false }))
        })
        .catch((e) => console.warn(`[nature] quat bush fail ${name}`, e))
    )
  }
  for (const name of QUAT_GRASS) {
    jobs.push(
      loadFbx(`${QUAT_BASE}/${name}.fbx`)
        .then((scene) => {
          const prep = bakePlantRoot(scene, { targetH: 1, dry: false, isGrass: true })
          cache.set(`grass:${name}`, prep)
          prep.root.updateMatrixWorld(true)
          const extracted = extractGrassMesh(prep.root)
          if (extracted) {
            grassMeshes.set(name, extracted)
          } else {
            console.warn(`[nature] quat grass extract empty ${name}`)
          }
        })
        .catch((e) => console.warn(`[nature] quat grass fail ${name}`, e))
    )
  }
  await Promise.all(jobs)
  const trees = [...cache.keys()].filter((k) => k.startsWith('tree:')).length
  const bushes = [...cache.keys()].filter((k) => k.startsWith('bush:')).length
  if (trees > 0 && bushes === 0 && grassMeshes.size === 0) {
    console.warn('[nature] Quaternius trees only — grass/foliage FBX missing or failed')
  }
  return trees > 0 || bushes > 0 || grassMeshes.size > 0
}

async function loadPackKenney() {
  const jobs = []
  for (const name of KENNEY_TREES) {
    jobs.push(
      loadGltf(`${KENNEY_BASE}/${name}.glb`)
        .then((scene) => {
          cache.set(`tree:${name}`, bakePlantRoot(scene, { targetH: 2, dry: false }))
        })
        .catch((e) => console.warn(`[nature] kenney tree fail ${name}`, e))
    )
  }
  for (const name of KENNEY_BUSHES) {
    jobs.push(
      loadGltf(`${KENNEY_BASE}/${name}.glb`)
        .then((scene) => {
          cache.set(`bush:${name}`, bakePlantRoot(scene, { targetH: 1.2, dry: false }))
        })
        .catch((e) => console.warn(`[nature] kenney bush fail ${name}`, e))
    )
  }
  for (const name of KENNEY_GRASS) {
    jobs.push(
      loadGltf(`${KENNEY_BASE}/${name}.glb`)
        .then((scene) => {
          const prep = bakePlantRoot(scene, { targetH: 1, dry: false, isGrass: true })
          cache.set(`grass:${name}`, prep)
          prep.root.updateMatrixWorld(true)
          const extracted = extractGrassMesh(prep.root)
          if (extracted) grassMeshes.set(name, extracted)
        })
        .catch((e) => console.warn(`[nature] kenney grass fail ${name}`, e))
    )
  }
  await Promise.all(jobs)
  return cache.size > 0
}

async function loadHeroTrees() {
  try {
    const scene = await loadGltf(`${REALISTIC_BASE}/tree.glb`)
    heroTreeCache.set('broadleaf', prepareHeroTree(scene))
  } catch (e) {
    // The normal vegetation pack remains a complete fallback if this optional
    // foreground asset is unavailable.
    console.warn('[nature] realistic tree fail', e)
  }
}

export function preloadNatureModels() {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    cache.clear()
    grassMeshes.clear()
    heroTreeCache.clear()
    activePack = null
    let ok = await loadPackQuaternius()
    if (ok) {
      activePack = 'quaternius'
    } else {
      cache.clear()
      grassMeshes.clear()
      ok = await loadPackKenney()
      activePack = ok ? 'kenney' : null
    }
    await loadHeroTrees()
    ready = ok
    if (ready) {
      const trees = [...cache.keys()].filter((k) => k.startsWith('tree:')).length
      const bushes = [...cache.keys()].filter((k) => k.startsWith('bush:')).length
      const sample = getTreeProtos()[0]
      console.info(
        `[nature] loaded pack=${activePack} trees=${trees} heroTrees=${heroTreeCache.size} bushes=${bushes} grass=${grassMeshes.size}` +
          (sample ? ` sampleH=${sample.height.toFixed(2)}` : '')
      )
    } else {
      console.warn('[nature] no pack loaded — procedural vegetation only')
    }
    return ready
  })()
  return loadPromise
}

export function isNatureReady() {
  return ready
}

export function getActiveNaturePack() {
  return activePack
}

export function getTreeProtos() {
  const out = []
  for (const [k, v] of cache) {
    if (k.startsWith('tree:')) out.push(v)
  }
  return out
}

export function getHeroTreeProtos() {
  return [...heroTreeCache.values()]
}

export function getBushProtos() {
  const out = []
  for (const [k, v] of cache) {
    if (k.startsWith('bush:')) out.push(v)
  }
  return out
}

/** Grass clump protos (full Object3D) for sparse clone placement. */
export function getGrassProtos() {
  const out = []
  for (const [k, v] of cache) {
    if (k.startsWith('grass:')) out.push(v)
  }
  return out
}

export function getGrassMeshData() {
  return [...grassMeshes.values()]
}

/**
 * Clone a plant proto at world-local position with uniform scale + yaw.
 * Proto roots are baked to identity transform; scale is pure world height factor.
 * @param {{ dry?: boolean, noShadow?: boolean }} [opts]
 */
export function placePlantClone(proto, x, y, z, scale, yaw, opts = {}) {
  const obj = proto.root.clone(true)
  obj.position.set(x, y, z)
  obj.rotation.y = yaw
  obj.scale.setScalar(scale)
  if (opts.dry) {
    const scrub = new THREE.Color(ISLAND_SCRUB_GREEN)
    obj.traverse((c) => {
      if (!c.isMesh) return
      const list = Array.isArray(c.material) ? c.material : [c.material]
      for (const m of list) {
        if (!m?.color) continue
        // Pull foliage toward dry scrub; leave bark alone.
        if (m.color.g > m.color.r * 0.9) {
          m.color = m.color.clone().lerp(scrub, 0.55)
        }
      }
    })
  }
  const noShadow = opts.noShadow ?? proto?.isGrass === true
  obj.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = !noShadow
      c.receiveShadow = true
    }
  })
  return obj
}
