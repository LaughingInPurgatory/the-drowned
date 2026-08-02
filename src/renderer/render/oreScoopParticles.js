import * as THREE from 'three'
import { waveHeight } from '../world/sea.js'

// Rock fragments that stream from a hit asteroid toward the ship when the
// ore hold scoops yield. Small 3D blocks (not soft point sprites).

const POOL = 36
const _toShip = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _pos = new THREE.Vector3()

function makeFragmentMesh() {
  // Irregular rock chips — boxes and tetrahedra, non-uniform scale.
  const kind = Math.random()
  let geo
  if (kind < 0.45) {
    geo = new THREE.BoxGeometry(1, 1, 1)
  } else if (kind < 0.75) {
    geo = new THREE.TetrahedronGeometry(0.85, 0)
  } else {
    geo = new THREE.OctahedronGeometry(0.7, 0)
  }
  const warm = 0.55 + Math.random() * 0.35
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.07 + Math.random() * 0.05, 0.28, 0.28 + Math.random() * 0.18),
    roughness: 0.95,
    metalness: 0.04 + Math.random() * 0.08,
    flatShading: true,
    transparent: true,
    fog: false,
    opacity: 1
  })
  // Slight amber ore flecks on some chunks.
  if (Math.random() < 0.35) {
    mat.color.offsetHSL(0.02, 0.15, 0.08 * warm)
  }
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  mesh.frustumCulled = false
  const sx = 0.55 + Math.random() * 1.1
  const sy = 0.45 + Math.random() * 1.2
  const sz = 0.55 + Math.random() * 1.1
  mesh.userData.baseScale = new THREE.Vector3(sx, sy, sz)
  mesh.scale.copy(mesh.userData.baseScale).multiplyScalar(1.6)
  mesh.renderOrder = 30
  mesh.material.depthWrite = false
  return mesh
}

export function createOreScoopEffects() {
  const group = new THREE.Group()
  group.frustumCulled = false
  group.renderOrder = 30

  /** @type {{
   *   alive: boolean,
   *   t: number,
   *   life: number,
   *   start: THREE.Vector3,
   *   jitter: THREE.Vector3,
   *   spin: THREE.Vector3,
   *   mesh: THREE.Mesh
   * }[]} */
  const slots = Array.from({ length: POOL }, () => {
    const mesh = makeFragmentMesh()
    group.add(mesh)
    return {
      alive: false,
      t: 0,
      life: 0.7,
      start: new THREE.Vector3(),
      jitter: new THREE.Vector3(),
      spin: new THREE.Vector3(),
      mesh
    }
  })
  let next = 0

  return {
    group,
    /**
     * Spawn rock fragments at `fromWorld` that tumble toward the ship.
     */
    burst(fromWorld, count = 7) {
      const n = Math.min(count, 12)
      for (let k = 0; k < n; k++) {
        const i = next
        next = (next + 1) % POOL
        const s = slots[i]
        s.alive = true
        s.t = 0
        s.life = 0.55 + Math.random() * 0.45
        s.start.copy(fromWorld).add(
          _tmp.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5)
        )
        // Initial scatter so chips peel off the rock before being sucked in.
        s.jitter.set(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 14
        )
        s.spin.set(
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 14
        )
        s.mesh.position.copy(s.start)
        s.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
        const base = s.mesh.userData.baseScale
        const size = 1.4 + Math.random() * 2.2
        s.mesh.scale.set(base.x * size, base.y * size, base.z * size)
        s.mesh.material.opacity = 1
        s.mesh.visible = true
      }
    },
    update(dt, shipWorldPos, simTime = 0) {
      const targetX = Number(shipWorldPos?.x ?? shipWorldPos?.[0]) || 0
      const targetZ = Number(shipWorldPos?.z ?? shipWorldPos?.[2]) || 0
      const targetWaterY = waveHeight(targetX, targetZ, simTime)
      for (let i = 0; i < POOL; i++) {
        const s = slots[i]
        if (!s.alive) {
          if (s.mesh.visible) s.mesh.visible = false
          continue
        }
        _toShip.copy(shipWorldPos)
        const travelDistance = Math.hypot(
          _toShip.x - s.start.x,
          _toShip.z - s.start.z
        )
        // Salvage can be collected from up to 1 km away. Give a distant pull
        // enough time to remain a readable trail instead of blinking out at
        // the source before the debris reaches the hold.
        s.life = Math.max(s.life, 0.55 + travelDistance / 360)
        s.t += dt / s.life
        const u = Math.min(1, s.t)
        // Ease: drift outward early, then pull hard into the ship.
        const ease = u * u * (3 - 2 * u)
        const pull = ease * ease
        const drift = (1 - ease) * (1 + u * 0.35)
        // Keep the debris above the visible waterline. Wreck positions are
        // often authored at sea level, so interpolating their raw Y toward the
        // ship would otherwise put most fragments behind the ocean depth pass.
        const sourceWaterY = waveHeight(s.start.x, s.start.z, simTime)
        const sourceY = Math.max(s.start.y, sourceWaterY + 1.35)
        const targetY = Math.max(_toShip.y, targetWaterY + 1.35)
        _pos.set(
          s.start.x * (1 - pull) + _toShip.x * pull + s.jitter.x * drift,
          sourceY * (1 - pull) + targetY * pull + s.jitter.y * drift * 0.45,
          s.start.z * (1 - pull) + _toShip.z * pull + s.jitter.z * drift
        )
        s.mesh.position.copy(_pos)
        s.mesh.rotation.x += s.spin.x * dt
        s.mesh.rotation.y += s.spin.y * dt
        s.mesh.rotation.z += s.spin.z * dt
        // Keep fragments readable all the way to the hold; dissolve only in
        // the final instant instead of making the last stretch look cut off.
        const shrink = 1 - pull * 0.35
        const base = s.mesh.userData.baseScale
        const size = (1.4 + (1 - u) * 1.2) * shrink
        s.mesh.scale.set(base.x * size, base.y * size, base.z * size)
        const terminalFade = u > 0.985 ? Math.max(0, (1 - u) / 0.015) : 1
        s.mesh.material.opacity = terminalFade * Math.min(1, 1.05 - pull * 0.12)
        if (u >= 1) {
          s.alive = false
          s.mesh.visible = false
        }
      }
    }
  }
}
