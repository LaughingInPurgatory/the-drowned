import * as THREE from 'three'
import { createPuffEmitter } from './particles.js'
import { WIND_BEARING } from '../world/sea.js'

/**
 * Battle damage: fire, smoke, sparks.
 *
 * Three separate media, not three colours of one puff:
 *
 *  - **Fire** is additive, buoyant and short-lived. It stays near the hull
 *    because that is where the fuel is.
 *  - **Smoke** is *not* additive — smoke occludes, and an additive black puff is
 *    a no-op. It is also the only one of the three that lives long enough for
 *    the wind to own it, and it must, because a plume rising straight up from a
 *    boat making way is the clearest possible tell that a damage effect is a
 *    canned particle preset.
 *  - **Sparks** are small, fast, ballistic and gone.
 *
 * Everything scales continuously with armour/hull fraction and stops the moment
 * repairs land — both are read live off the ship each frame, not triggered.
 */

/** Prevailing wind, shared with the sea so smoke lies the way the swell runs. */
const WIND_SPEED = 7.5
const WIND = [Math.sin(WIND_BEARING) * WIND_SPEED, 0, Math.cos(WIND_BEARING) * WIND_SPEED]

export function createDamageEffects() {
  // Smoke: opaque, cool, slow, long-lived, wind-driven.
  const smoke = createPuffEmitter(56, 0x30302e, 2.6, null, {
    life: 3.4,
    additive: false,
    buoyancy: 2.2,
    drag: 0.8,
    wind: 0.5,
    grow: 2.6
  })
  // Fire: additive, hot, buoyant, brief.
  const flame = createPuffEmitter(34, 0xff6a22, 1.5, null, { life: 0.55, buoyancy: 6, drag: 2.4 })
  // Sparks: tiny, bright, ballistic.
  const sparks = createPuffEmitter(28, 0xffc06a, 0.32, null, { life: 0.8, gravity: 11, drag: 1.1, grow: -0.2 })

  const group = new THREE.Group()
  group.add(smoke.mesh, flame.mesh, sparks.mesh)
  group.renderOrder = 1

  const UP = new THREE.Vector3(0, 1, 0)
  const jitterOrigin = new THREE.Vector3()

  // A random point across roughly the ship's hull volume, in world space —
  // recomputed each frame so emission wanders instead of pouring from one spot.
  function randomHullPoint(shipPos, shipQuat, hullLength) {
    jitterOrigin.set(
      (Math.random() - 0.5) * hullLength * 0.5,
      (Math.random() - 0.15) * hullLength * 0.18,
      (Math.random() - 0.5) * hullLength * 0.6
    )
    return jitterOrigin.applyQuaternion(shipQuat).add(shipPos)
  }

  // Smoke is the only one light enough for the wind to own.
  smoke.env = { wind: WIND }

  return {
    group,
    update(dt, { armorFraction, hullFraction, shipPos, shipQuat, hullLength }) {
      const armorDamage = Math.max(0, 1 - armorFraction)
      const hullDamage = Math.max(0, 1 - hullFraction)

      smoke.update(
        dt,
        armorDamage > 0.02,
        randomHullPoint(shipPos, shipQuat, hullLength),
        UP,
        3 + armorDamage * 16,
        1.8 + armorDamage * 3.2,
        1.4
      )
      flame.update(
        dt,
        hullDamage > 0.02,
        randomHullPoint(shipPos, shipQuat, hullLength),
        UP,
        6 + hullDamage * 34,
        3.2 + hullDamage * 5,
        1.1
      )
      sparks.update(
        dt,
        hullDamage > 0.15,
        randomHullPoint(shipPos, shipQuat, hullLength),
        UP,
        4 + hullDamage * 22,
        7 + hullDamage * 14,
        5.5
      )
    },
    dispose() {
      smoke.dispose()
      flame.dispose()
      sparks.dispose()
    }
  }
}
