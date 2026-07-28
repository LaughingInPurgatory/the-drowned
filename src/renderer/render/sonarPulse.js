import * as THREE from 'three'
import { waveHeight } from '../world/sea.js'

/**
 * Sonar pulse — expanding rings + a brief vertical shaft on the water.
 * Rides the real sea surface so the swell rolls under the ping.
 */

const RING_SEGMENTS = 160
const RING_LIFETIME_S = 4.2
const RING_REACH = 420
/** Match main.js sounding cadence so rings land with the movie pings. */
const RING_COUNT = 4
const RING_INTERVAL_S = 1.55
const RING_LIFT = 0.4

function buildRingGeometry() {
  const positions = new Float32Array((RING_SEGMENTS + 1) * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

export function createSonarPulse() {
  const group = new THREE.Group()
  group.name = 'sonar'
  group.frustumCulled = false

  const rings = []
  for (let i = 0; i < RING_COUNT; i++) {
    const material = new THREE.LineBasicMaterial({
      color: i % 2 === 0 ? 0x8ff0e0 : 0x5ec8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      linewidth: 1
    })
    const line = new THREE.LineLoop(buildRingGeometry(), material)
    line.frustumCulled = false
    line.visible = false
    group.add(line)
    rings.push({ line, material, age: -1, delay: i * RING_INTERVAL_S, phase: i * 0.37 })
  }

  // Soft disc flash at the origin on each burst.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0x7fe0d0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  })
  const flash = new THREE.Mesh(new THREE.CircleGeometry(8, 32), flashMat)
  flash.rotation.x = -Math.PI / 2
  flash.visible = false
  flash.frustumCulled = false
  group.add(flash)

  const origin = new THREE.Vector3()
  let active = false
  let flashAge = -1

  function ping(originArray) {
    origin.set(originArray[0], 0, originArray[2])
    active = true
    flashAge = 0
    for (const ring of rings) ring.age = -ring.delay
  }

  function stop() {
    active = false
    flashAge = -1
    flash.visible = false
    for (const ring of rings) {
      ring.age = -1
      ring.line.visible = false
    }
  }

  function update(dt, t) {
    if (!active) return
    let anyLive = false

    if (flashAge >= 0) {
      flashAge += dt
      if (flashAge < 0.55) {
        anyLive = true
        flash.visible = true
        const k = flashAge / 0.55
        flash.position.set(origin.x, waveHeight(origin.x, origin.z, t) + RING_LIFT, origin.z)
        flash.scale.setScalar(1 + k * 6)
        flashMat.opacity = (1 - k) * 0.45
      } else {
        flash.visible = false
        flashAge = -1
      }
    }

    for (const ring of rings) {
      ring.age += dt
      if (ring.age < 0 || ring.age > RING_LIFETIME_S) {
        ring.line.visible = false
        if (ring.age <= RING_LIFETIME_S) anyLive = true
        continue
      }
      anyLive = true
      ring.line.visible = true
      const k = ring.age / RING_LIFETIME_S
      const radius = RING_REACH * Math.pow(k, 0.58)
      // Pulse the opacity so rings read as sound, not a static disc.
      const pulse = 0.55 + 0.45 * Math.sin(ring.age * 9 + ring.phase)
      ring.material.opacity = Math.sin(Math.min(1, k * 1.12) * Math.PI) * 0.9 * pulse

      const pos = ring.line.geometry.getAttribute('position')
      for (let s = 0; s <= RING_SEGMENTS; s++) {
        const a = (s / RING_SEGMENTS) * Math.PI * 2
        // Slight radial jitter so the ring is not a perfect CAD circle.
        const wobble = 1 + 0.012 * Math.sin(a * 5 + ring.phase + t * 2)
        const x = origin.x + Math.cos(a) * radius * wobble
        const z = origin.z + Math.sin(a) * radius * wobble
        pos.setXYZ(s, x, waveHeight(x, z, t) + RING_LIFT, z)
      }
      pos.needsUpdate = true
      ring.line.geometry.computeBoundingSphere()
    }
    if (!anyLive) active = false
  }

  function dispose() {
    for (const ring of rings) {
      ring.line.geometry.dispose()
      ring.material.dispose()
    }
    flash.geometry.dispose()
    flashMat.dispose()
  }

  return { group, ping, update, stop, dispose, get active() { return active } }
}
