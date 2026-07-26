import * as THREE from 'three'
import { buildGlowTexture } from './thrusterParticles.js'

// World-space fire + smoke contrail for flying missiles.

const FIRE_POOL = 280
const SMOKE_POOL = 360
const FIRE_LIFE = 0.28
const SMOKE_LIFE = 0.85
const _nozzle = new THREE.Vector3()
const _back = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _quat = new THREE.Quaternion()

function makePool(count, color, size, additive) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  // Park unused off-screen.
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 1] = -1e6
    sizes[i] = size
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  // PointsMaterial doesn't use per-vertex size without a shader; we animate
  // material.size globally per system and color per particle instead.
  const mat = new THREE.PointsMaterial({
    map: buildGlowTexture(),
    vertexColors: true,
    size,
    transparent: true,
    opacity: 0.9,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    sizeAttenuation: true
  })
  const points = new THREE.Points(geo, mat)
  points.frustumCulled = false
  points.renderOrder = additive ? 2 : 1

  const slots = Array.from({ length: count }, () => ({
    alive: false,
    age: 0,
    life: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    baseSize: size
  }))

  return { positions, colors, sizes, geo, mat, points, slots, next: 0, count, baseSize: size }
}

function spawn(pool, x, y, z, vx, vy, vz, life, sizeMul, cr, cg, cb) {
  const i = pool.next
  pool.next = (pool.next + 1) % pool.count
  const s = pool.slots[i]
  s.alive = true
  s.age = 0
  s.life = life
  s.vx = vx
  s.vy = vy
  s.vz = vz
  s.baseSize = pool.baseSize * sizeMul
  pool.positions[i * 3] = x
  pool.positions[i * 3 + 1] = y
  pool.positions[i * 3 + 2] = z
  pool.colors[i * 3] = cr
  pool.colors[i * 3 + 1] = cg
  pool.colors[i * 3 + 2] = cb
  pool.sizes[i] = s.baseSize
}

function stepPool(pool, dt) {
  let any = false
  for (let i = 0; i < pool.count; i++) {
    const s = pool.slots[i]
    if (!s.alive) continue
    any = true
    s.age += dt
    const u = s.age / s.life
    if (u >= 1) {
      s.alive = false
      pool.positions[i * 3 + 1] = -1e6
      continue
    }
    pool.positions[i * 3] += s.vx * dt
    pool.positions[i * 3 + 1] += s.vy * dt
    pool.positions[i * 3 + 2] += s.vz * dt
    // Slow drift drag.
    s.vx *= Math.exp(-1.2 * dt)
    s.vy *= Math.exp(-1.2 * dt)
    s.vz *= Math.exp(-1.2 * dt)
    // Fade + grow (smoke) / shrink (fire).
    const fade = 1 - u
    pool.colors[i * 3] *= 0.998
    pool.colors[i * 3 + 1] *= 0.997
    pool.colors[i * 3 + 2] *= 0.995
    // Encode fade via color brightness already; material opacity is global —
    // dim by reducing color toward black.
    const dim = fade * fade
    // sizes attribute unused by default PointsMaterial — scale via re-tint
    void dim
  }
  pool.geo.attributes.position.needsUpdate = true
  pool.geo.attributes.color.needsUpdate = true
  pool.points.visible = any
}

/**
 * Shared missile contrail system (fire core + grey smoke).
 * Call emitFromMissile each frame per live missile; update() once after.
 */
export function createMissileTrailSystem() {
  const group = new THREE.Group()
  group.frustumCulled = false

  const fire = makePool(FIRE_POOL, new THREE.Color(0xffaa44), 2.2, true)
  const smoke = makePool(SMOKE_POOL, new THREE.Color(0x88909a), 3.4, false)
  // Smoke slightly translucent grey
  smoke.mat.opacity = 0.55
  fire.mat.opacity = 0.95

  group.add(fire.points)
  group.add(smoke.points)

  // Accumulators so we emit steadily even at high frame rates.
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
     * @param {number[]} velocity
     * @param {number} dt
     * @param {number} [scale=1] size mult (torpedo larger)
     */
    track(id, position, quaternion, velocity, dt, scale = 1) {
      let state = perMissile.get(id)
      if (!state) {
        state = { emit: 0 }
        perMissile.set(id, state)
      }
      state.emit += dt

      _quat.fromArray(quaternion)
      // Missile model faces +Z; nozzle is behind.
      _back.set(0, 0, -1).applyQuaternion(_quat)
      _right.set(1, 0, 0).applyQuaternion(_quat)
      _up.set(0, 1, 0).applyQuaternion(_quat)

      const px = position[0]
      const py = position[1]
      const pz = position[2]
      // Nozzle slightly behind origin of projectile.
      _nozzle.set(px, py, pz).addScaledVector(_back, 1.2 * scale)

      // Fire: frequent, short-lived, hot colors, slight rearward drift.
      fireAcc += dt * (55 * scale)
      while (fireAcc >= 1) {
        fireAcc -= 1
        const jx = (Math.random() - 0.5) * 0.35 * scale
        const jy = (Math.random() - 0.5) * 0.35 * scale
        const jz = (Math.random() - 0.5) * 0.35 * scale
        const sx = _nozzle.x + _right.x * jx + _up.x * jy + _back.x * jz * 0.2
        const sy = _nozzle.y + _right.y * jx + _up.y * jy + _back.y * jz * 0.2
        const sz = _nozzle.z + _right.z * jx + _up.z * jy + _back.z * jz * 0.2
        // Drift opposite flight + a little turbulence (don't inherit full missile speed
        // or the trail collapses into a blob).
        const backSpeed = 6 + Math.random() * 10
        const vx = _back.x * backSpeed + (Math.random() - 0.5) * 4
        const vy = _back.y * backSpeed + (Math.random() - 0.5) * 4
        const vz = _back.z * backSpeed + (Math.random() - 0.5) * 4
        // Hot white → orange → red via spawn color
        const hot = Math.random()
        const cr = 1
        const cg = 0.55 + hot * 0.4
        const cb = 0.15 + hot * 0.25
        spawn(fire, sx, sy, sz, vx, vy, vz, FIRE_LIFE * (0.7 + Math.random() * 0.5), 0.7 + Math.random() * 0.8, cr, cg, cb)
      }

      // Smoke: less frequent, longer life, expands behind fire.
      smokeAcc += dt * (32 * scale)
      while (smokeAcc >= 1) {
        smokeAcc -= 1
        const jx = (Math.random() - 0.5) * 0.6 * scale
        const jy = (Math.random() - 0.5) * 0.6 * scale
        const behind = 0.4 + Math.random() * 0.8
        const sx = _nozzle.x + _back.x * behind + _right.x * jx + _up.x * jy
        const sy = _nozzle.y + _back.y * behind + _right.y * jx + _up.y * jy
        const sz = _nozzle.z + _back.z * behind + _right.z * jx + _up.z * jy
        const backSpeed = 2 + Math.random() * 5
        const vx = _back.x * backSpeed + (Math.random() - 0.5) * 2.5
        const vy = _back.y * backSpeed + (Math.random() - 0.5) * 2.5 + 0.4
        const vz = _back.z * backSpeed + (Math.random() - 0.5) * 2.5
        const g = 0.35 + Math.random() * 0.25
        spawn(
          smoke,
          sx,
          sy,
          sz,
          vx,
          vy,
          vz,
          SMOKE_LIFE * (0.75 + Math.random() * 0.5),
          0.9 + Math.random() * 1.2,
          g,
          g * 0.95,
          g * 0.9
        )
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
      let anyFire = false
      for (let i = 0; i < fire.count; i++) {
        const s = fire.slots[i]
        if (!s.alive) continue
        anyFire = true
        s.age += dt
        const u = s.age / s.life
        if (u >= 1) {
          s.alive = false
          fire.positions[i * 3 + 1] = -1e6
          continue
        }
        fire.positions[i * 3] += s.vx * dt
        fire.positions[i * 3 + 1] += s.vy * dt
        fire.positions[i * 3 + 2] += s.vz * dt
        s.vx *= Math.exp(-2.5 * dt)
        s.vy *= Math.exp(-2.5 * dt)
        s.vz *= Math.exp(-2.5 * dt)
        const fade = 1 - u
        // White-hot → orange → red as it ages
        fire.colors[i * 3] = fade
        fire.colors[i * 3 + 1] = 0.45 * fade * fade + 0.1 * fade
        fire.colors[i * 3 + 2] = 0.1 * fade * fade
      }
      fire.geo.attributes.position.needsUpdate = true
      fire.geo.attributes.color.needsUpdate = true
      fire.points.visible = anyFire
      fire.mat.size = fire.baseSize * (1.05 + 0.12 * Math.sin(performance.now() * 0.025))
      fire.mat.opacity = 0.92

      let anySmoke = false
      for (let i = 0; i < smoke.count; i++) {
        const s = smoke.slots[i]
        if (!s.alive) continue
        anySmoke = true
        s.age += dt
        const u = s.age / s.life
        if (u >= 1) {
          s.alive = false
          smoke.positions[i * 3 + 1] = -1e6
          continue
        }
        smoke.positions[i * 3] += s.vx * dt
        smoke.positions[i * 3 + 1] += s.vy * dt
        smoke.positions[i * 3 + 2] += s.vz * dt
        s.vx *= Math.exp(-0.9 * dt)
        s.vy *= Math.exp(-0.9 * dt)
        s.vz *= Math.exp(-0.9 * dt)
        s.vy += 0.6 * dt // buoyant rise
        const fade = (1 - u) * (1 - u)
        const g = 0.5 * fade
        smoke.colors[i * 3] = g
        smoke.colors[i * 3 + 1] = g * 0.96
        smoke.colors[i * 3 + 2] = g * 0.92
      }
      smoke.geo.attributes.position.needsUpdate = true
      smoke.geo.attributes.color.needsUpdate = true
      smoke.points.visible = anySmoke
      // Smoke expands as particles age (global size is a compromise for PointsMaterial).
      smoke.mat.size = smoke.baseSize * 1.35
      smoke.mat.opacity = 0.5
    },

    clear() {
      perMissile.clear()
      for (const pool of [fire, smoke]) {
        for (let i = 0; i < pool.count; i++) {
          pool.slots[i].alive = false
          pool.positions[i * 3 + 1] = -1e6
        }
        pool.geo.attributes.position.needsUpdate = true
        pool.points.visible = false
      }
    }
  }
}
