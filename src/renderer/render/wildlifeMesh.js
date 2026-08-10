import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { WILDLIFE_SPECIES } from '../game/wildlife.js'

const ASSETS = {
  rabbit: '/models/wildlife/rabbit/rabbit.fbx',
  deer: '/models/wildlife/deer/Deer/Other%20formats/Deer.obj',
  dog: '/models/wildlife/dog/OBJ/Dog%20(Jack%20russel)%20%20Release.obj',
  cat: '/models/wildlife/cat/cat.obj'
}
const CACHE = new Map()
const LOADS = new Map()
const COLOR = { rabbit: 0xb8a48f, deer: 0x8a5a36, dog: 0xb79d78, cat: 0x7e8587 }

function loadObject(url, species) {
  return new Promise((resolve, reject) => {
    const loader = species === 'rabbit' ? new FBXLoader() : new OBJLoader()
    loader.load(url, resolve, undefined, reject)
  })
}

function prepareTemplate(source, species) {
  source.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(source)
  const size = new THREE.Vector3()
  box.getSize(size)
  const def = WILDLIFE_SPECIES[species]
  const scale = def.height / Math.max(0.001, size.y)
  const root = new THREE.Group()
  source.scale.multiplyScalar(scale)
  source.updateMatrixWorld(true)
  const scaled = new THREE.Box3().setFromObject(source)
  source.position.x -= (scaled.min.x + scaled.max.x) * 0.5
  source.position.y -= scaled.min.y
  source.position.z -= (scaled.min.z + scaled.max.z) * 0.5
  root.add(source)
  const texture = species === 'cat' ? new THREE.TextureLoader().load('/models/wildlife/cat/cat.png') : null
  root.traverse((child) => {
    if (!child.isMesh && !child.isSkinnedMesh) return
    child.castShadow = true
    child.receiveShadow = true
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    const output = materials.map((material) => {
      const out = new THREE.MeshStandardMaterial({
        color: COLOR[species],
        map: texture ?? material?.map ?? null,
        roughness: 0.9,
        metalness: 0,
        envMapIntensity: 0.18
      })
      if (material?.normalMap) out.normalMap = material.normalMap
      return out
    })
    child.material = Array.isArray(child.material) ? output : output[0]
  })
  root.updateMatrixWorld(true)
  root.userData.wildlifeSpecies = species
  return root
}

export function loadWildlifeModels() {
  const pending = []
  for (const species of Object.keys(ASSETS)) {
    if (CACHE.has(species) || LOADS.has(species)) continue
    const load = loadObject(ASSETS[species], species)
      .then((source) => {
        CACHE.set(species, prepareTemplate(source, species))
        return CACHE.get(species)
      })
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

export function buildWildlifeMesh(creature) {
  const template = CACHE.get(creature?.species)
  if (!template) return null
  const mesh = template.clone(true)
  mesh.name = `wildlife:${creature.id}`
  mesh.userData.wildlifeId = creature.id
  mesh.userData.wildlifeSpecies = creature.species
  mesh.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) child.frustumCulled = false
  })
  return mesh
}

export function updateWildlifeMesh(mesh, creature, dt = 0, now = 0) {
  if (!mesh || !creature) return
  const alive = creature.state === 'alive'
  mesh.visible = creature.state !== 'respawning'
  mesh.position.fromArray(creature.position)
  mesh.rotation.set(0, Number(creature.heading) || 0, 0)
  if (!alive) {
    const fall = Math.min(1, Math.max(0, (Number(now) - Number(creature.deadAt)) / 0.35))
    mesh.rotation.z = 0.95 * fall
  }
}

export function createWildlifeBlood(position) {
  const group = new THREE.Group()
  group.name = 'wildlife-blood'
  const material = new THREE.MeshBasicMaterial({ color: 0x87141b, transparent: true, opacity: 0.9, depthWrite: false })
  for (let i = 0; i < 5; i++) {
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.035 + i * 0.012, 6, 5), material.clone())
    drop.position.set((i - 2) * 0.11, 0.15 + (i % 2) * 0.08, (i % 3 - 1) * 0.09)
    drop.scale.y = 1.8
    group.add(drop)
  }
  group.position.fromArray(position)
  return { group, ttl: 0.42 }
}
