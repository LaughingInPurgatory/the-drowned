import * as THREE from 'three'
import { mulberry32 } from '../procgen/prng.js'
import {
  buildPlayerAvatarMesh,
  updatePlayerAvatarMesh,
  PLAYER_AVATAR_HEIGHT
} from './playerAvatarMesh.js'

const NPC_COUNT_MIN = 2
const NPC_COUNT_MAX = 4
// Harbour pedestrians keep the authored human scale. The player is deliberately
// reduced on foot so ships feel enormous; deck NPCs need to remain readable.
const NPC_WORLD_HEIGHT = PLAYER_AVATAR_HEIGHT
const NPC_SPEED_MIN = 0.7
const NPC_SPEED_MAX = 1.15

function hashString(value) {
  let h = 0
  for (let i = 0; i < String(value).length; i++) h = (h * 31 + String(value)[i].charCodeAt(0)) | 0
  return Math.abs(h)
}

function routePoint(distance, width, length, out) {
  // Keep the walking lane near the quay edge. The middle of a working port is
  // deliberately cluttered with sheds, tanks and crates, which used to hide
  // most of the pedestrians from the water-facing camera.
  const halfW = width * 0.4
  const halfL = length * 0.44
  const perimeter = (halfW + halfL) * 4
  let d = ((distance % perimeter) + perimeter) % perimeter
  if (d < halfW * 2) {
    out.x = -halfW + d
    out.z = -halfL
    out.heading = Math.PI / 2
  } else if ((d -= halfW * 2) < halfL * 2) {
    out.x = halfW
    out.z = -halfL + d
    out.heading = 0
  } else if ((d -= halfL * 2) < halfW * 2) {
    out.x = halfW - d
    out.z = halfL
    out.heading = -Math.PI / 2
  } else {
    d -= halfW * 2
    out.x = -halfW
    out.z = halfL - d
    out.heading = Math.PI
  }
  return out
}

function routePerimeter(width, length) {
  return 4 * (width * 0.4 + length * 0.44)
}

function styleHarbourNpc(avatar, rng) {
  // Keep the pedestrians readable, but let the shared sun/moon and harbour
  // lights shade them. Unlit materials made every NPC look self-illuminated at
  // night and washed out the chosen clothing colours.
  const copies = new Map()
  avatar.traverse((child) => {
    if (!child.isMesh || !child.material) return
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material]
    const materials = sourceMaterials.map((source) => {
      if (!source?.clone) return source
      if (copies.has(source)) return copies.get(source)
      const material = source.clone()
      material.toneMapped = true
      material.roughness = Math.max(0.82, Number(material.roughness) || 0.86)
      material.metalness = Math.min(0.08, Number(material.metalness) || 0)
      copies.set(source, material)
      return material
    })
    child.material = Array.isArray(child.material) ? materials : materials[0]
  })

  const bandColors = [0xd2a33e, 0xc86d32, 0x6da99d]
  const bandMaterial = new THREE.MeshStandardMaterial({
    color: bandColors[Math.floor(rng() * bandColors.length)],
    roughness: 0.78,
    metalness: 0.05
  })
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.055, 0.025), bandMaterial)
  band.name = 'harbourNpcReflectiveBand'
  band.position.set(0, 1.15, 0.19)
  band.castShadow = true
  band.receiveShadow = true
  avatar.add(band)
}

/** Build 2–4 non-persistent pedestrians for a port's main quay. */
export function buildHarbourNpcGroup(body, harbourMesh) {
  const deck = harbourMesh?.userData?.npcDeck
  if (body?.kind !== 'port' || !deck) return null

  const rng = mulberry32(hashString(`${body.id}:harbour-pedestrians`))
  const count = NPC_COUNT_MIN + Math.floor(rng() * (NPC_COUNT_MAX - NPC_COUNT_MIN + 1))
  const group = new THREE.Group()
  group.name = 'harbourPedestrians'
  group.userData.npcs = []
  group.userData.deck = deck
  const localHeight = NPC_WORLD_HEIGHT / Math.max(0.001, harbourMesh.scale.x || 1)

  for (let i = 0; i < count; i++) {
    const state = {
      position: [0, deck.y, 0],
      velocity: [0, 0, 0],
      heading: 0,
      pitch: 0,
      walkPhase: rng() * Math.PI * 2,
      jumping: false,
      running: false,
      routeDistance: (i / count) * routePerimeter(deck.width, deck.length) + rng() * 4,
      routeSpeed: NPC_SPEED_MIN + rng() * (NPC_SPEED_MAX - NPC_SPEED_MIN)
    }
    const initialPoint = routePoint(state.routeDistance, deck.width, deck.length, _routePoint)
    state.position = [initialPoint.x, deck.y, initialPoint.z]
    state.heading = initialPoint.heading
    const avatar = buildPlayerAvatarMesh({
      height: localHeight,
      headId: Math.floor(rng() * 10),
      upperBodyId: Math.floor(rng() * 10),
      lowerBodyId: Math.floor(rng() * 10)
    })
    avatar.name = `harbourPedestrian:${i}`
    avatar.userData.harbourNpcState = state
    updatePlayerAvatarMesh(avatar, state, 0)
    styleHarbourNpc(avatar, rng)
    avatar.visible = true
    avatar.layers.set(0)
    avatar.frustumCulled = false
    avatar.renderOrder = 2
    avatar.traverse((child) => {
      if (child.isMesh) {
        child.layers.set(0)
        child.renderOrder = 2
      }
    })
    group.add(avatar)
    group.userData.npcs.push(avatar)
  }
  return group
}

/** Advance the cheap rectangular deck loops; no NPC state is saved. */
export function updateHarbourNpcGroup(group, dt = 0) {
  const deck = group?.userData?.deck ?? group?.parent?.userData?.npcDeck
  const npcs = group?.userData?.npcs
  if (!deck || !Array.isArray(npcs)) return
  const seconds = Math.max(0, Math.min(0.1, Number(dt) || 0))
  for (const avatar of npcs) {
    const state = avatar.userData.harbourNpcState
    if (!state) continue
    state.routeDistance += state.routeSpeed * seconds
    const point = routePoint(state.routeDistance, deck.width, deck.length, _routePoint)
    state.position[0] = point.x
    state.position[1] = deck.y
    state.position[2] = point.z
    state.heading = point.heading
    // Use the segment's intended speed directly so animation cadence and
    // movement agree, including on the frame a pedestrian rounds a corner.
    state.velocity[0] = Math.sin(point.heading) * state.routeSpeed
    state.velocity[1] = 0
    state.velocity[2] = Math.cos(point.heading) * state.routeSpeed
    updatePlayerAvatarMesh(avatar, state, seconds)
  }
}

const _routePoint = { x: 0, z: 0, heading: 0 }

export const HARBOUR_NPC_LIMITS = Object.freeze({
  min: NPC_COUNT_MIN,
  max: NPC_COUNT_MAX,
  worldHeight: NPC_WORLD_HEIGHT
})
