import * as THREE from 'three'
import { createPuffEmitter, buildGlowTexture } from './thrusterParticles.js'

// Reuses thrusterParticles.js's round glow-sprite puff emitter for smoke
// (armor damage), flame, and scattering hull-debris chunks — the same
// "recycled pool drifting forever" technique, just recolored and driven by
// damage fraction instead of thrust state. Intensity (spawn rate/speed) scales
// continuously with how damaged the ship is, and the whole effect vanishes
// the instant armor/hull are repaired back to full (armorFraction/hullFraction
// read live off the ship each frame, not a one-shot trigger).
export function createDamageEffects() {
  const texture = buildGlowTexture()
  const smoke = createPuffEmitter(26, 0x3a3a3a, 3.4, texture)
  const flame = createPuffEmitter(22, 0xff5a1a, 2.6, texture)
  const debris = createPuffEmitter(16, 0x201a16, 1.1, texture)

  const group = new THREE.Group()
  group.add(smoke.mesh, flame.mesh, debris.mesh)

  const UP = new THREE.Vector3(0, 1, 0)
  const jitterOrigin = new THREE.Vector3()

  // A random point scattered across roughly the ship's own hull volume,
  // in world space — recomputed fresh each frame so emission wanders across
  // the hull over time rather than pouring from one fixed point.
  function randomHullPoint(shipPos, shipQuat, hullLength) {
    jitterOrigin.set((Math.random() - 0.5) * hullLength * 0.5, (Math.random() - 0.5) * hullLength * 0.15, (Math.random() - 0.5) * hullLength * 0.6)
    return jitterOrigin.applyQuaternion(shipQuat).add(shipPos)
  }

  return {
    group,
    update(dt, { armorFraction, hullFraction, shipPos, shipQuat, hullLength }) {
      const armorDamage = Math.max(0, 1 - armorFraction)
      const hullDamage = Math.max(0, 1 - hullFraction)

      const smokeActive = armorDamage > 0.02
      smoke.update(dt, smokeActive, randomHullPoint(shipPos, shipQuat, hullLength), UP, 3 + armorDamage * 25, 3 + armorDamage * 5, 2.5)

      const flameActive = hullDamage > 0.02
      flame.update(dt, flameActive, randomHullPoint(shipPos, shipQuat, hullLength), UP, 5 + hullDamage * 35, 5 + hullDamage * 8, 3)
      debris.update(dt, flameActive, randomHullPoint(shipPos, shipQuat, hullLength), UP, 2 + hullDamage * 12, 8 + hullDamage * 18, 6)
    }
  }
}
