import * as THREE from 'three'
import { waveHeight } from '../world/sea.js'

/**
 * Sonar.
 *
 * Rings of sound going out across the water from under the hull. There is no
 * launched craft any more — you sound from where you are, and what comes back
 * is the survey.
 *
 * Rings ride the actual sea surface (`waveHeight`) rather than a flat disc, so
 * they roll over the swell instead of slicing through it.
 */

const RING_SEGMENTS = 128
/** Radial samples per ring — enough that the swell reads along the circle. */
const RING_LIFETIME_S = 3.4
/** How far a single ring travels before it fades out. */
const RING_REACH = 340
/** Rings per sounding, and the gap between them. */
const RING_COUNT = 3
const RING_INTERVAL_S = 0.85
/** Sits just clear of the surface so it is never z-fought by the water. */
const RING_LIFT = 0.35

function buildRingGeometry() {
  const positions = new Float32Array((RING_SEGMENTS + 1) * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

/**
 * Create the sonar effect. Returns a group to add to the scene plus
 * `ping(originArray)` / `update(dt, t)` / `stop()`.
 */
export function createSonarPulse() {
  const group = new THREE.Group()
  group.name = 'sonar'
  group.frustumCulled = false

  const rings = []
  for (let i = 0; i < RING_COUNT; i++) {
    const material = new THREE.LineBasicMaterial({
      color: 0x7fe0d0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
    const line = new THREE.LineLoop(buildRingGeometry(), material)
    line.frustumCulled = false
    line.visible = false
    group.add(line)
    rings.push({ line, material, age: -1, delay: i * RING_INTERVAL_S })
  }

  const origin = new THREE.Vector3()
  let active = false

  function ping(originArray) {
    origin.set(originArray[0], 0, originArray[2])
    active = true
    for (const ring of rings) ring.age = -ring.delay
  }

  function stop() {
    active = false
    for (const ring of rings) {
      ring.age = -1
      ring.line.visible = false
    }
  }

  function update(dt, t) {
    if (!active) return
    let anyLive = false
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
      // Fast out of the hull, slowing as it spreads — sound losing energy.
      const radius = RING_REACH * Math.pow(k, 0.62)
      // Bright at the front of the ping, gone by the time it is spent.
      ring.material.opacity = Math.sin(Math.min(1, k * 1.15) * Math.PI) * 0.85

      const pos = ring.line.geometry.getAttribute('position')
      for (let s = 0; s <= RING_SEGMENTS; s++) {
        const a = (s / RING_SEGMENTS) * Math.PI * 2
        const x = origin.x + Math.cos(a) * radius
        const z = origin.z + Math.sin(a) * radius
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
  }

  return { group, ping, update, stop, dispose, get active() { return active } }
}
