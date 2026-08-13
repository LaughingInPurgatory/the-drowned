import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'
import { WILDLIFE_SPECIES } from '../game/wildlife.js'

const ASSETS = {
  rabbit: '/models/wildlife/rabbit/rabbit.fbx',
  deer: '/models/wildlife/deer/Stag.glb',
  dog: '/models/wildlife/wolf/Wolf.glb',
  cat: '/models/wildlife/cat/cat.glb',
  rat: '/models/wildlife/rat/rat.glb'
}
const TEXTURE_ASSETS = {
  rabbit: {
    map: '/models/wildlife/rabbit/texture/Fur-skin.png',
    normalMap: '/models/wildlife/rabbit/texture/rabbit-NORM.png',
    coat: '/models/wildlife/rabbit/coat.jpg'
  },
  cat: {
    map: '/models/wildlife/cat/cat.png',
    coat: '/models/wildlife/cat/coat.jpg'
  },
  dog: { map: '/models/wildlife/wolf/coat.jpg' },
  deer: { map: '/models/wildlife/deer/coat.jpg' },
  rat: { map: '/models/wildlife/rat/coat.jpg', coat: '/models/wildlife/rat/coat.jpg' },
  boar: { map: '/models/wildlife/boar/coat.jpg', coat: '/models/wildlife/boar/coat.jpg' },
  ferret: { map: '/models/wildlife/ferret/coat.jpg', coat: '/models/wildlife/ferret/coat.jpg' },
  stoat: { map: '/models/wildlife/stoat/coat.jpg', coat: '/models/wildlife/stoat/coat.jpg' }
}
const CACHE = new Map()
const LOADS = new Map()
const TEXTURES = new Map()
const COLOR = {
  rabbit: 0xc4b49a,
  deer: 0x8a5a36,
  dog: 0x5a4634,
  cat: 0x7e8587,
  rat: 0x6a6158,
  boar: 0x3a2a1c,
  ferret: 0xc8b089,
  stoat: 0x8a5a32
}
const FUR_SPEC = {
  rabbit: { base: '#cbb89a', dark: '#6a5340', light: '#f0e6d2' },
  deer: { base: '#6b3d1f', dark: '#3a1e0d', light: '#c4a06a' },
  dog: { base: '#4a3828', dark: '#1c120c', light: '#c4a06a' },
  rat: { base: '#4a4038', dark: '#1c1612', light: '#8a7a68' },
  boar: { base: '#3a2a1c', dark: '#1a1008', light: '#7a6040' },
  ferret: { base: '#c8b089', dark: '#6a4a28', light: '#f2e6c8' },
  stoat: { base: '#8a5a32', dark: '#3a2414', light: '#f0e6d4' }
}
const _legAxis = new THREE.Vector3(1, 0, 0)
const _legQ = new THREE.Quaternion()

function loadObject(url, species) {
  return new Promise((resolve, reject) => {
    const href = encodeURI(url)
    const lower = url.toLowerCase()
    if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
      new GLTFLoader().load(
        href,
        (gltf) => {
          const scene = gltf.scene || gltf.scenes?.[0]
          if (!scene) {
            reject(new Error(`empty gltf: ${url}`))
            return
          }
          scene.userData.clips = (gltf.animations || []).filter((clip) => !clip.name.includes('|'))
          resolve(scene)
        },
        undefined,
        reject
      )
      return
    }
    if (lower.endsWith('.fbx') || species === 'rabbit') {
      new FBXLoader().load(href, resolve, undefined, reject)
      return
    }
    reject(new Error(`unsupported wildlife model: ${url}`))
  })
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      encodeURI(url),
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping
        resolve(texture)
      },
      undefined,
      reject
    )
  })
}

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function makeFurTexture(spec, seed = 1) {
  if (typeof document === 'undefined') return null
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = spec.base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 2200; i++) {
    const x = hash01(i * 3.1 + seed) * size
    const y = hash01(i * 7.7 + seed * 2) * size
    const len = 6 + hash01(i * 1.9) * 14
    const lean = (hash01(i * 4.4) - 0.5) * 0.7
    ctx.strokeStyle = hash01(i + seed) > 0.72 ? spec.light : spec.dark
    ctx.globalAlpha = 0.18 + hash01(i * 0.6) * 0.35
    ctx.lineWidth = 0.7 + hash01(i * 2.2) * 1.3
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + lean * len, y + len)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}

async function texturesFor(species) {
  if (TEXTURES.has(species)) return TEXTURES.get(species)
  const files = TEXTURE_ASSETS[species]
  const maps = {}
  if (files?.map) {
    try {
      maps.map = await loadTexture(files.map)
    } catch {
      /* keep generated / none */
    }
  }
  if (files?.normalMap) {
    try {
      maps.normalMap = await loadTexture(files.normalMap)
      maps.normalMap.colorSpace = THREE.NoColorSpace
    } catch {
      /* */
    }
  }
  if (files?.coat) {
    try {
      maps.coat = await loadTexture(files.coat)
    } catch {
      /* */
    }
  }
  if (!maps.map && FUR_SPEC[species]) maps.map = makeFurTexture(FUR_SPEC[species], species.length)
  TEXTURES.set(species, maps)
  return maps
}

function ensureTilingUVs(geometry, scale = 1.6) {
  if (!geometry || geometry.attributes.uv) return
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  if (!pos) return
  const uvs = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = Math.abs(nrm?.getX(i) ?? 0)
    const ny = Math.abs(nrm?.getY(i) ?? 1)
    const nz = Math.abs(nrm?.getZ(i) ?? 0)
    if (ny >= nx && ny >= nz) {
      uvs[i * 2] = x * scale
      uvs[i * 2 + 1] = z * scale
    } else if (nx >= nz) {
      uvs[i * 2] = z * scale
      uvs[i * 2 + 1] = y * scale
    } else {
      uvs[i * 2] = x * scale
      uvs[i * 2 + 1] = y * scale
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
}

function meshOnlyBounds(root) {
  const box = new THREE.Box3()
  let any = false
  root.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return
    const piece = new THREE.Box3().setFromObject(child)
    if (!Number.isFinite(piece.min.x)) return
    if (!any) {
      box.copy(piece)
      any = true
    } else box.union(piece)
  })
  return any ? box : new THREE.Box3().setFromObject(root)
}

/** Authored packs often face +X. Movement and heading assume +Z is the nose. */
function faceAlongPositiveZ(source) {
  source.updateMatrixWorld(true)
  const size = meshOnlyBounds(source).getSize(new THREE.Vector3())
  if (size.x > size.z * 1.12) {
    source.rotation.y -= Math.PI / 2
    source.updateMatrixWorld(true)
  }
}

function applyCoat(child, species, maps) {
  const tag = `${child.name || ''} ${child.material?.name || ''}`
  const skipFur = /eye|nose|horn|antler|hoof|tooth|tusk|iris/i.test(tag)
  const hadUv = !!child.geometry?.attributes?.uv
  if (!hadUv && child.geometry && !skipFur) ensureTilingUVs(child.geometry)
  const materials = Array.isArray(child.material) ? child.material : [child.material]
  const output = materials.map((material) => {
    const authored = !!(hadUv && (maps.map || material?.map))
    const fur = skipFur ? null : (authored ? (maps.map ?? material?.map) : (maps.coat ?? maps.map ?? material?.map))
    const tint = fur ? (authored || skipFur ? 0xffffff : (material?.color?.getHex?.() || 0xffffff)) : COLOR[species]
    const out = new THREE.MeshStandardMaterial({
      color: tint,
      map: fur,
      normalMap: authored ? (maps.normalMap ?? material?.normalMap ?? null) : null,
      roughness: skipFur ? 0.35 : 0.88,
      metalness: 0,
      envMapIntensity: skipFur ? 0.4 : 0.18
    })
    if (out.normalMap) out.normalScale = new THREE.Vector2(0.85, 0.85)
    return out
  })
  child.material = Array.isArray(child.material) ? output : output[0]
}

function attachWalkLegs(root, species) {
  const def = WILDLIFE_SPECIES[species] ?? WILDLIFE_SPECIES.rabbit
  const legs = new THREE.Group()
  legs.name = 'wildlifeLegs'
  const length = def.height * 0.42
  const thick = Math.max(0.025, def.radius * 0.16)
  const fore = def.radius * 0.55
  const side = def.radius * 0.42
  const specs = [
    ['fl', side, 0.02, fore],
    ['fr', -side, 0.02, fore],
    ['bl', side, 0.02, -fore],
    ['br', -side, 0.02, -fore]
  ]
  const mat = new THREE.MeshStandardMaterial({
    color: COLOR[species],
    roughness: 0.9,
    metalness: 0,
    map: TEXTURES.get(species)?.map ?? null
  })
  for (const [name, x, y, z] of specs) {
    const hip = new THREE.Group()
    hip.name = `wildlifeLeg:${name}`
    hip.position.set(x, y + length * 0.15, z)
    const bone = new THREE.Mesh(new THREE.CapsuleGeometry(thick, length, 3, 5), mat)
    bone.position.y = -length * 0.5
    bone.castShadow = true
    hip.add(bone)
    legs.add(hip)
  }
  root.add(legs)
  root.userData.hasWalkLegs = true
}

function tilingMapForFallback(species) {
  const maps = TEXTURES.get(species)
  if (maps?.coat) return maps.coat
  // Rabbit/rat/cat authored maps are UV atlases — they turn primitive stand-ins black.
  if (species === 'rabbit' || species === 'rat' || species === 'cat') {
    return FUR_SPEC[species] ? makeFurTexture(FUR_SPEC[species], species.length) : null
  }
  return maps?.map ?? null
}

function buildBoarMesh(material, def) {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.72, 10, 8),
    material
  )
  body.scale.set(1.15, 0.85, 1.45)
  body.position.set(0, def.height * 0.52, 0.02)
  body.castShadow = true
  group.add(body)
  const hump = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.38, 8, 6), material)
  hump.scale.set(1.1, 0.7, 0.9)
  hump.position.set(0, def.height * 0.78, 0.12)
  group.add(hump)
  const head = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.34, 8, 6), material)
  head.position.set(0, def.height * 0.5, def.radius * 0.82)
  group.add(head)
  const snout = new THREE.Mesh(
    new THREE.CylinderGeometry(def.radius * 0.14, def.radius * 0.2, def.radius * 0.42, 7),
    material
  )
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, def.height * 0.46, def.radius * 1.12)
  group.add(snout)
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(def.radius * 0.16, def.radius * 0.16, 0.04, 8), material)
  disk.rotation.x = Math.PI / 2
  disk.position.set(0, def.height * 0.46, def.radius * 1.32)
  group.add(disk)
  const tuskMat = new THREE.MeshStandardMaterial({ color: 0xe8d8b8, roughness: 0.45, metalness: 0.05 })
  for (const side of [-1, 1]) {
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 5), tuskMat)
    tusk.rotation.z = side * 0.9
    tusk.rotation.x = 0.5
    tusk.position.set(side * def.radius * 0.16, def.height * 0.4, def.radius * 1.18)
    group.add(tusk)
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.11, 5), material)
    ear.rotation.x = -0.6
    ear.position.set(side * 0.12, def.height * 0.68, def.radius * 0.72)
    group.add(ear)
  }
  return group
}

function buildRatMesh(material, def) {
  const group = new THREE.Group()
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.62, 10, 8),
    material
  )
  body.scale.set(1.05, 0.78, 1.85)
  body.position.set(0, def.height * 0.38, 0.02)
  body.castShadow = true
  group.add(body)
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.34, 8, 6), material)
  haunch.scale.set(1.15, 0.9, 1.05)
  haunch.position.set(0, def.height * 0.36, -def.radius * 0.42)
  group.add(haunch)
  const head = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.32, 8, 6), material)
  head.position.set(0, def.height * 0.42, def.radius * 0.78)
  head.castShadow = true
  group.add(head)
  const snout = new THREE.Mesh(
    new THREE.ConeGeometry(def.radius * 0.16, def.radius * 0.42, 7),
    material
  )
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, def.height * 0.38, def.radius * 1.08)
  group.add(snout)
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x2a1814, roughness: 0.55, metalness: 0 })
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), noseMat)
  nose.position.set(0, def.height * 0.37, def.radius * 1.28)
  group.add(nose)
  const earMat = new THREE.MeshStandardMaterial({ color: 0xc48a78, roughness: 0.7, metalness: 0 })
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), earMat)
    ear.name = side < 0 ? 'wildlifeRatEarL' : 'wildlifeRatEarR'
    ear.scale.set(0.7, 1.15, 0.35)
    ear.position.set(side * def.radius * 0.2, def.height * 0.58, def.radius * 0.68)
    group.add(ear)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), noseMat)
    eye.position.set(side * def.radius * 0.14, def.height * 0.46, def.radius * 0.96)
    group.add(eye)
  }
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, def.radius * 0.1, def.radius * 1.7, 6),
    earMat
  )
  tail.name = 'wildlifeRatTail'
  tail.rotation.x = Math.PI / 2.35
  tail.position.set(0, def.height * 0.28, -def.radius * 1.15)
  group.add(tail)
  return group
}

function buildMustelidMesh(material, def, species) {
  const group = new THREE.Group()
  const stoat = species === 'stoat'
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(def.radius * 0.42, def.height * 1.15, 6, 8),
    material
  )
  body.rotation.x = Math.PI / 2
  body.position.set(0, def.height * 0.38, 0.02)
  body.castShadow = true
  group.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(def.radius * 0.42, 8, 6), material)
  head.scale.set(0.85, 0.8, 1.15)
  head.position.set(0, def.height * 0.44, def.radius * 1.15)
  head.castShadow = true
  group.add(head)
  const snout = new THREE.Mesh(
    new THREE.ConeGeometry(def.radius * 0.16, def.radius * 0.38, 6),
    material
  )
  snout.rotation.x = Math.PI / 2
  snout.position.set(0, def.height * 0.4, def.radius * 1.48)
  group.add(snout)
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x2a1814, roughness: 0.5, metalness: 0 })
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), noseMat)
  nose.position.set(0, def.height * 0.4, def.radius * 1.66)
  group.add(nose)
  const earMat = new THREE.MeshStandardMaterial({
    color: stoat ? 0xc4a070 : 0xd8b898,
    roughness: 0.75,
    metalness: 0
  })
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), earMat)
    ear.scale.set(0.65, 0.9, 0.35)
    ear.position.set(side * def.radius * 0.22, def.height * 0.58, def.radius * 1.05)
    group.add(ear)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), noseMat)
    eye.position.set(side * def.radius * 0.16, def.height * 0.48, def.radius * 1.32)
    group.add(eye)
  }
  const tailMat = stoat
    ? new THREE.MeshStandardMaterial({ color: 0x14110e, roughness: 0.8, metalness: 0 })
    : material
  const tail = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, def.radius * 0.16, def.radius * 2.1, 6),
    tailMat
  )
  tail.rotation.x = Math.PI / 2.2
  tail.position.set(0, def.height * 0.32, -def.radius * 1.35)
  group.add(tail)
  return group
}

function buildFallbackWildlifeMesh(creature) {
  const species = creature?.species
  const def = WILDLIFE_SPECIES[species] ?? WILDLIFE_SPECIES.rabbit
  const map = tilingMapForFallback(species)
  const group = new THREE.Group()
  group.name = `wildlife:${creature?.id ?? 'unknown'}`
  group.userData.wildlifeId = creature?.id
  group.userData.wildlifeSpecies = creature?.species
  group.userData.wildlifeFallback = true
  const material = new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : COLOR[species] ?? COLOR.rabbit,
    map,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.22
  })
  if (species === 'boar') {
    group.add(buildBoarMesh(material, def))
    attachWalkLegs(group, species)
    return group
  }
  if (species === 'rat') {
    group.add(buildRatMesh(material, def))
    attachWalkLegs(group, species)
    return group
  }
  if (species === 'ferret' || species === 'stoat') {
    group.add(buildMustelidMesh(material, def, species))
    attachWalkLegs(group, species)
    return group
  }
  const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(
      Math.max(0.09, def.radius * 0.5),
      Math.max(0.16, def.height * 0.42),
      5,
      8
    ),
    material
  )
  torso.rotation.x = Math.PI / 2
  torso.position.y = def.height * 0.55
  torso.castShadow = true
  torso.receiveShadow = true
  torso.frustumCulled = false
  group.add(torso)
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(def.radius * 0.36, 8, 6),
    material
  )
  head.position.set(0, def.height * 0.68, def.radius * 0.62)
  head.castShadow = true
  group.add(head)
  attachWalkLegs(group, species)
  return group
}

function prepareTemplate(source, species, maps = {}) {
  source.updateMatrixWorld(true)
  faceAlongPositiveZ(source)
  const box = meshOnlyBounds(source)
  const size = box.getSize(new THREE.Vector3())
  const def = WILDLIFE_SPECIES[species]
  const scale = def.height / Math.max(0.001, size.y)
  const root = new THREE.Group()
  source.scale.multiplyScalar(scale)
  source.updateMatrixWorld(true)
  const scaled = meshOnlyBounds(source)
  source.position.x -= (scaled.min.x + scaled.max.x) * 0.5
  source.position.y -= scaled.min.y
  source.position.z -= (scaled.min.z + scaled.max.z) * 0.5
  root.add(source)
  let skinned = false
  root.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return
    if (child.isSkinnedMesh) skinned = true
    child.castShadow = true
    child.receiveShadow = true
    applyCoat(child, species, maps)
  })
  root.updateMatrixWorld(true)
  const finalSize = meshOnlyBounds(root).getSize(new THREE.Vector3())
  // A collapsed import (empty helpers in the bounds) is unusable — stand-in instead.
  if (finalSize.x < 0.12 && finalSize.z < 0.12) return null
  root.userData.wildlifeSpecies = species
  const clips = source.userData.clips || []
  return { root, clips, skinned }
}

export function loadWildlifeModels() {
  const pending = []
  for (const species of Object.keys(TEXTURE_ASSETS)) pending.push(texturesFor(species))
  for (const species of Object.keys(ASSETS)) {
    if (CACHE.has(species) || LOADS.has(species)) continue
    const load = texturesFor(species)
      .then((maps) => loadObject(ASSETS[species], species).then((source) => {
        const template = prepareTemplate(source, species, maps)
        if (template) CACHE.set(species, template)
        return template
      }))
      .catch((error) => {
        console.warn(`[wildlife] ${species} model failed`, error)
        return null
      })
      .finally(() => LOADS.delete(species))
    LOADS.set(species, load)
    pending.push(load)
  }
  return Promise.all(pending)
}

export function wildlifeModelReady(species) {
  return CACHE.has(species)
}

function pickWalkClip(clips) {
  return (clips || []).find((clip) => /^walk$/i.test(clip.name))
    || (clips || []).find((clip) => /walk/i.test(clip.name))
    || null
}

export function buildWildlifeMesh(creature) {
  const entry = CACHE.get(creature?.species)
  const template = entry?.root
  const mesh = template
    ? (entry.skinned ? SkeletonUtils.clone(template) : template.clone(true))
    : buildFallbackWildlifeMesh(creature)
  mesh.name = `wildlife:${creature.id}`
  mesh.userData.wildlifeId = creature.id
  mesh.userData.wildlifeSpecies = creature.species
  mesh.userData.wildlifeFallback = !template
  mesh.userData.skinned = !!entry?.skinned
  if (entry?.clips?.length) {
    const walk = pickWalkClip(entry.clips)
    if (walk) {
      const mixer = new THREE.AnimationMixer(mesh)
      const action = mixer.clipAction(walk)
      action.enabled = true
      action.setLoop(THREE.LoopRepeat, Infinity)
      mesh.userData.mixer = mixer
      mesh.userData.walkAction = action
    }
  }
  mesh.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) child.frustumCulled = false
  })
  return mesh
}

export function updateWildlifeMesh(mesh, creature, dt = 0, now = 0) {
  if (!mesh || !creature) return
  const def = WILDLIFE_SPECIES[creature.species] ?? WILDLIFE_SPECIES.rabbit
  const alive = creature.state === 'alive'
  mesh.visible = creature.state !== 'respawning'
  const heading = Number(creature.heading) || 0
  const phase = Number(creature.walkPhase) || 0
  const moving = alive && !!creature.moving
  const authoredWalk = !!mesh.userData.mixer
  const bob = !authoredWalk && moving ? Math.abs(Math.sin(phase)) * def.height * 0.06 : 0
  const pitch = !authoredWalk && moving ? Math.sin(phase * 2) * 0.09 : 0
  const sway = !authoredWalk && moving ? Math.sin(phase) * 0.05 : 0
  mesh.rotation.order = 'YXZ'
  const walk = mesh.userData.walkAction
  if (mesh.userData.mixer && walk) {
    if (moving) {
      if (!walk.isRunning()) walk.reset().play()
      walk.paused = false
      walk.timeScale = 1.1
    } else {
      walk.paused = true
    }
    mesh.userData.mixer.update(Math.max(0, Number(dt) || 0))
  }
  if (!alive) {
    const fall = Math.min(1, Math.max(0, (Number(now) - Number(creature.deadAt)) / 0.42))
    const eased = fall * fall * (3 - 2 * fall)
    const side = creature.fallSide < 0 ? -1 : 1
    mesh.rotation.set(0, heading, side * (Math.PI / 2) * eased)
    mesh.position.set(
      Number(creature.position?.[0]) || 0,
      (Number(creature.position?.[1]) || 0) + def.radius * 0.42 * eased,
      Number(creature.position?.[2]) || 0
    )
  } else {
    mesh.rotation.set(pitch, heading, sway)
    mesh.position.set(
      Number(creature.position?.[0]) || 0,
      (Number(creature.position?.[1]) || 0) + bob,
      Number(creature.position?.[2]) || 0
    )
  }
  const legs = mesh.getObjectByName('wildlifeLegs')
  if (legs) {
    const swing = moving ? Math.sin(phase) * 0.62 : 0
    for (const hip of legs.children) {
      const name = hip.name || ''
      const sign = name.endsWith('fl') || name.endsWith('br') ? 1 : -1
      hip.quaternion.setFromAxisAngle(_legAxis, 0)
      hip.quaternion.multiply(_legQ.setFromAxisAngle(_legAxis, swing * sign))
    }
  }
}

export function createWildlifeBlood(position) {
  const group = new THREE.Group()
  group.name = 'wildlife-blood'
  const material = new THREE.MeshBasicMaterial({
    color: 0x87141b,
    transparent: true,
    opacity: 0.9,
    depthWrite: false
  })
  for (let i = 0; i < 5; i++) {
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.035 + i * 0.012, 6, 5), material.clone())
    drop.position.set((i - 2) * 0.11, 0.15 + (i % 2) * 0.08, (i % 3 - 1) * 0.09)
    drop.scale.y = 1.8
    group.add(drop)
  }
  group.position.fromArray(position)
  return { group, ttl: 0.42, pool: false }
}

/** Ground puddles that stay around a corpse. */
export function createWildlifeBloodPool(position, species = 'rabbit') {
  const def = WILDLIFE_SPECIES[species] ?? WILDLIFE_SPECIES.rabbit
  const group = new THREE.Group()
  group.name = 'wildlife-blood-pool'
  group.position.set(position[0], (position[1] || 0) + 0.03, position[2])
  const count = 5 + Math.floor(def.radius * 4)
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + i * 0.37
    const dist = 0.08 + (i % 3) * def.radius * 0.38
    const splat = new THREE.Mesh(
      new THREE.CircleGeometry(0.07 + def.radius * (0.18 + (i % 4) * 0.07), 9),
      new THREE.MeshBasicMaterial({
        color: i % 2 ? 0x5a0d14 : 0x7a121c,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2
      })
    )
    splat.rotation.x = -Math.PI / 2
    splat.rotation.z = angle * 0.4
    splat.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist)
    splat.renderOrder = 2
    group.add(splat)
  }
  return { group, ttl: 14, pool: true }
}
