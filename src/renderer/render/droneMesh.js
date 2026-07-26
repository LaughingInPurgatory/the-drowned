import * as THREE from 'three'
import { getDrone, DEFAULT_DRONE_ID } from '../data/drones.js'
import { buildGlowTexture, createPuffEmitter } from './thrusterParticles.js'
import { getSurfaceTextures } from './textures.js'

/**
 * Compact textured combat drone (Stinger Light Combat).
 * Local +Z forward, thrusters at -Z.
 */
export function buildDroneMesh(typeId = DEFAULT_DRONE_ID) {
  const def = getDrone(typeId)
  const group = new THREE.Group()
  group.userData.droneTypeId = typeId

  const color = new THREE.Color(def.color ?? '#8ab4c8')
  let maps = {}
  try {
    const metal = getSurfaceTextures('rocky')
    if (metal?.map) maps = { map: metal.map, normalMap: metal.normalMap, roughnessMap: metal.roughnessMap }
  } catch { /* textures optional in tests */ }
  const bodyMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.55,
    roughness: 0.38,
    flatShading: false,
    ...maps
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#cfe8f5'),
    metalness: 0.7,
    roughness: 0.25,
    emissive: new THREE.Color('#1a3040'),
    emissiveIntensity: 0.25
  })

  // Fuselage — short dart
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.4, 8), bodyMat)
  body.rotation.x = Math.PI / 2
  body.position.z = 0.2
  group.add(body)

  // Core cylinder
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 1.4, 8), bodyMat)
  core.rotation.x = Math.PI / 2
  core.position.z = -0.35
  group.add(core)

  // Twin stub wings
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.55), accentMat)
    wing.position.set(side * 0.65, 0, -0.2)
    wing.rotation.z = side * 0.12
    group.add(wing)
  }

  // Canopy / sensor blister
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({
      color: '#4fc3d9',
      metalness: 0.2,
      roughness: 0.15,
      emissive: '#1a6080',
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.85
    })
  )
  canopy.position.set(0, 0.22, 0.35)
  group.add(canopy)

  // Engine bells (rear)
  for (const side of [-1, 1]) {
    const eng = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 0.35, 8),
      new THREE.MeshStandardMaterial({
        color: '#222830',
        emissive: '#ff6633',
        emissiveIntensity: 0.55,
        metalness: 0.6,
        roughness: 0.4
      })
    )
    eng.rotation.x = Math.PI / 2
    eng.position.set(side * 0.22, 0, -1.15)
    group.add(eng)
  }

  // Hardpoint nose laser housing
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), accentMat)
  gun.position.set(0, -0.05, 1.15)
  group.add(gun)

  const s = def.meshScale ?? 0.22
  // Cone was authored at ~2.5m; scale whole craft
  group.scale.setScalar(s * 4.5)

  // Thruster trail emitter (world-updated each frame)
  const glow = buildGlowTexture()
  const trail = createPuffEmitter(48, 0xff8844, 1.2, glow)
  trail.mesh.renderOrder = 2
  // Parent trails under a separate group handled by caller for world-space puffs
  group.userData.trail = trail
  group.userData.trailTexture = glow

  return group
}

/**
 * Update drone visual: face, thruster puffs at rear.
 * @param {THREE.Object3D} mesh
 * @param {{ position: number[], velocity: number[], quaternion: number[] }} drone
 * @param {number} dt
 */
export function updateDroneMesh(mesh, drone, dt) {
  if (!mesh || !drone) return
  mesh.position.fromArray(drone.position)
  mesh.quaternion.fromArray(drone.quaternion)

  const trail = mesh.userData.trail
  if (!trail) return

  const speed = Math.hypot(drone.velocity[0], drone.velocity[1], drone.velocity[2])
  const active = speed > 8 && drone.deployed && !drone.destroyed
  // Rear of drone in world space (local −Z)
  const back = new THREE.Vector3(0, 0, -1.2).applyQuaternion(mesh.quaternion)
  const origin = mesh.position.clone().add(back)
  const dir = back.clone().normalize()
  trail.update(dt, active, origin, dir, 40, 18, 4)
}

export function disposeDroneMesh(mesh) {
  if (!mesh) return
  mesh.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) m.dispose?.()
    }
  })
  mesh.userData.trailTexture?.dispose?.()
}
