import * as THREE from 'three'
import { getDrone, DEFAULT_DRONE_ID } from '../data/drones.js'

/**
 * Small airborne combat drone — hover gunship, not a surface boat.
 *
 * Local frame: +Z nose/guns, −Z rear, +Y up (lift fans).
 * Propellers provide the visual thrust — no exhaust trails.
 * Materials are shared (cheap, no PBR map thrash on first launch).
 */

// Shared materials — created once, never disposed with individual meshes.
let _mats = null
function droneMaterials() {
  if (_mats) return _mats
  _mats = {
    hull: new THREE.MeshStandardMaterial({
      color: 0x8ab4c8,
      metalness: 0.72,
      roughness: 0.34
    }),
    dark: new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      metalness: 0.85,
      roughness: 0.3
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0xc8dce8,
      metalness: 0.65,
      roughness: 0.25,
      emissive: 0x143048,
      emissiveIntensity: 0.35
    }),
    gun: new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      metalness: 0.9,
      roughness: 0.25
    }),
    lens: new THREE.MeshStandardMaterial({
      color: 0x40e0ff,
      metalness: 0.15,
      roughness: 0.15,
      emissive: 0x1888aa,
      emissiveIntensity: 0.8
    }),
    fan: new THREE.MeshStandardMaterial({
      color: 0x0a1018,
      metalness: 0.4,
      roughness: 0.55,
      emissive: 0x224466,
      emissiveIntensity: 0.4,
      side: THREE.DoubleSide
    }),
    engine: new THREE.MeshStandardMaterial({
      color: 0x181c22,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0xff6633,
      emissiveIntensity: 0.35
    }),
    glow: new THREE.MeshBasicMaterial({
      color: 0x4ec8ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    })
  }
  return _mats
}

export function buildDroneMesh(typeId = DEFAULT_DRONE_ID) {
  const def = getDrone(typeId)
  const mats = droneMaterials()
  const group = new THREE.Group()
  group.name = 'combat-drone'
  group.userData.droneTypeId = typeId

  // Tint hull per type without cloning whole material stack when possible.
  const hullMat =
    def.color && def.color !== '#8ab4c8'
      ? mats.hull.clone()
      : mats.hull
  if (hullMat !== mats.hull) hullMat.color.set(def.color)

  // —— Central armoured hull ——
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 1.55), hullMat)
  body.position.set(0, 0.02, 0.05)
  group.add(body)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.65, 6), hullMat)
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 0.02, 0.95)
  group.add(nose)

  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 1.0), mats.accent)
  spine.position.set(0, 0.26, 0.05)
  group.add(spine)

  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), mats.lens)
  sensor.position.set(0, 0.2, 0.7)
  group.add(sensor)

  // —— Twin chin projectile guns ——
  const gunMuzzles = []
  for (const side of [-1, 1]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.65), mats.dark)
    housing.position.set(side * 0.36, -0.2, 0.35)
    group.add(housing)

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.9, 6), mats.gun)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(side * 0.36, -0.22, 0.9)
    group.add(barrel)

    gunMuzzles.push(new THREE.Vector3(side * 0.36, -0.22, 1.35))
  }
  group.userData.gunMuzzlesLocal = gunMuzzles

  // —— Four ducted lift fans ——
  const fanRoots = []
  const fanCorners = [
    [-0.7, 0.52],
    [0.7, 0.52],
    [-0.7, -0.52],
    [0.7, -0.52]
  ]
  for (const [fx, fz] of fanCorners) {
    const duct = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 5, 12), mats.dark)
    duct.rotation.x = Math.PI / 2
    duct.position.set(fx, 0.06, fz)
    group.add(duct)

    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), mats.fan)
    disk.rotation.x = -Math.PI / 2
    disk.position.set(fx, 0.08, fz)
    group.add(disk)

    const blades = new THREE.Group()
    blades.position.set(fx, 0.1, fz)
    for (let i = 0; i < 2; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.4), mats.accent)
      blade.rotation.y = (i * Math.PI) / 2
      blades.add(blade)
    }
    group.add(blades)
    fanRoots.push(blades)

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.28, 16), mats.glow)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(fx, -0.06, fz)
    group.add(ring)
  }
  group.userData.fanRoots = fanRoots

  // Side armour
  for (const side of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.85), mats.dark)
    plate.position.set(side * 0.5, 0, 0)
    group.add(plate)
  }

  // Rear thruster housings (visual only — no exhaust puffs)
  for (const side of [-1, 0, 1]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.28, 6), mats.engine)
    eng.rotation.x = Math.PI / 2
    eng.position.set(side * 0.18, 0.02, -0.98)
    group.add(eng)
  }

  const s = (def.meshScale ?? 0.22) * 5.2
  group.scale.setScalar(s)
  group.userData.spin = 0
  // Geometries are owned by this mesh; materials are shared (do not dispose mats).
  group.userData.ownsMaterials = false

  return group
}

/**
 * Face + spin lift fans. No thruster trails (props carry that read).
 * @param {THREE.Object3D} mesh
 * @param {{ position: number[], velocity: number[], quaternion: number[], deployed?: boolean, destroyed?: boolean }} drone
 * @param {number} dt
 */
export function updateDroneMesh(mesh, drone, dt) {
  if (!mesh || !drone?.position || !drone?.quaternion) return
  if (drone.position.length < 3 || drone.quaternion.length < 4) return
  // Guard NaNs so a bad sim sample cannot poison the renderer.
  if (!Number.isFinite(drone.position[0]) || !Number.isFinite(drone.quaternion[3])) return

  mesh.position.fromArray(drone.position)
  mesh.quaternion.fromArray(drone.quaternion)

  const speed = Math.hypot(
    drone.velocity?.[0] ?? 0,
    drone.velocity?.[1] ?? 0,
    drone.velocity?.[2] ?? 0
  )
  const active = !!drone.deployed && !drone.destroyed
  const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0

  const spinRate = active ? 16 + Math.min(20, speed * 0.1) : 0
  mesh.userData.spin = (mesh.userData.spin ?? 0) + spinRate * safeDt
  const fans = mesh.userData.fanRoots
  if (fans) {
    for (const f of fans) f.rotation.y = mesh.userData.spin
  }
}

export function disposeDroneMesh(mesh) {
  if (!mesh) return
  // Only dispose geometries. Shared materials stay alive.
  mesh.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
  })
}
