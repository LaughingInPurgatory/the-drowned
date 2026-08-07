import * as THREE from 'three'
import { createPuffEmitter } from './particles.js'

/**
 * World-space fire + smoke contrail for flying missiles.
 *
 * This used to be two hand-rolled `THREE.Points` pools, and its own comments
 * recorded the fight: *"sizes attribute unused by default PointsMaterial"*,
 * *"material opacity is global — dim by reducing color toward black"*, *"global
 * size is a compromise"*. All of it was moot — `THREE.Points` rasterises as
 * `GPUPrimitiveTopology.PointList` on WebGPU, one pixel per particle whatever
 * `size` says, so no trail was ever visible. It was also the last source of the
 * `AttributeNode: Vertex attribute "uv" not found on geometry` warning on every
 * boot: a `PointsMaterial` with a `map` asks for `uv()`, and Points geometry
 * here had none.
 *
 * Both pools are now the shared instanced billboard emitter, which gives real
 * per-particle size, lifetime and colour for free — so the ~200 lines of
 * workaround (and a `stepPool` that nothing ever called) are gone.
 */

const FIRE_POOL = 280
const SMOKE_POOL = 360
const _nozzle = new THREE.Vector3()
const _back = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _origin = new THREE.Vector3()

/**
 * Shared missile contrail system (fire core + grey smoke).
 * Call `track()` each frame per live missile; `update()` once after.
 */
export function createMissileTrailSystem() {
  const group = new THREE.Group()
  group.frustumCulled = false

  // Fire: hot, additive, brief, shrinking.
  const fire = createPuffEmitter(FIRE_POOL, 0xffaa44, 2.2, null, {
    life: 0.28,
    additive: true,
    drag: 2.5,
    grow: -0.35
  })
  // Smoke: occluding, buoyant, expanding, and long-lived enough to be blown
  // about — a contrail that hangs dead straight is the giveaway.
  const smoke = createPuffEmitter(SMOKE_POOL, 0x88909a, 3.4, null, {
    life: 0.85,
    additive: false,
    drag: 0.9,
    buoyancy: 0.6,
    wind: 0.25,
    grow: 1.8
  })
  smoke.env = { wind: [3.1, 0.4, 6.8] }

  group.add(fire.mesh, smoke.mesh)

  let fireAcc = 0
  let smokeAcc = 0
  /** @type {Map<string, { emit: number }>} */
  const perMissile = new Map()

  return {
    group,

    /**
     * Spawn trail particles from a missile's nozzle.
     * @param {string} id projectile id
     * @param {number[]} position
     * @param {number[]} quaternion
     * @param {number[]} velocity unused — see below
     * @param {number} dt
     * @param {number} [scale=1] size multiplier (a torpedo is bigger)
     */
    track(id, position, quaternion, velocity, dt, scale = 1) {
      let state = perMissile.get(id)
      if (!state) {
        state = { emit: 0 }
        perMissile.set(id, state)
      }
      state.emit += dt

      _quat.fromArray(quaternion)
      // Missile model faces +Z; the nozzle is behind it.
      _back.set(0, 0, -1).applyQuaternion(_quat)
      _right.set(1, 0, 0).applyQuaternion(_quat)
      _up.set(0, 1, 0).applyQuaternion(_quat)
      _nozzle.set(position[0], position[1], position[2]).addScaledVector(_back, 1.2 * scale)

      // Exhaust does **not** inherit the missile's own speed — if it does, every
      // particle flies along with the round and the trail collapses into a blob
      // stuck to the nozzle. It drifts backwards out of the nozzle instead.
      fireAcc += dt * (55 * scale)
      const fireN = Math.floor(fireAcc)
      if (fireN > 0) {
        fireAcc -= fireN
        fire.burst(_nozzle, _back, fireN, 8 + Math.random() * 8, 0.35 * scale)
      }

      smokeAcc += dt * (32 * scale)
      const smokeN = Math.floor(smokeAcc)
      if (smokeN > 0) {
        smokeAcc -= smokeN
        _origin.copy(_nozzle).addScaledVector(_back, 0.6)
        smoke.burst(_origin, _back, smokeN, 2 + Math.random() * 4, 0.6 * scale)
      }
    },

    /** Drop tracking for a projectile that has died / hit. */
    release(id) {
      perMissile.delete(id)
    },

    /** Keep only active missile ids. */
    prune(liveMissileIds) {
      for (const id of perMissile.keys()) {
        if (!liveMissileIds.has(id)) perMissile.delete(id)
      }
    },

    update(dt) {
      // `active: false` — emission happens in track(); this only integrates.
      fire.update(dt, false, _nozzle, _back, 0, 0, 0)
      smoke.update(dt, false, _nozzle, _back, 0, 0, 0)
    },

    clear() {
      perMissile.clear()
      fireAcc = 0
      smokeAcc = 0
      fire.reset()
      smoke.reset()
    },

    dispose() {
      fire.dispose()
      smoke.dispose()
    }
  }
}
