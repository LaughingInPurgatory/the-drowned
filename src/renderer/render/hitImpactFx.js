import * as THREE from 'three'
import { float, vec3, vec4, smoothstep, mix, pow, clamp } from 'three/tsl'
import {
  createSpriteField,
  createSpriteMaterial,
  puffMask,
  dropletMask,
  seaSurface
} from './vfxParticles.js'

// Short-lived hit feedback: sparks for all weapons; lasers also puff smoke,
// missiles flash a compact detonation.
//
// Sparks used to be a `THREE.Points`. On WebGPU that rasterises at one pixel
// per particle whatever the material says, so every impact in the game has been
// throwing invisible sparks. They are instanced billboards now, sharing one
// material across every hit so a firefight compiles one pipeline, not one per
// impact.

/* ------------------------------------------------------- shared materials */

let _sparkMat = null
let _smokeMat = null
let _fireMat = null

function sparkMaterial() {
  if (_sparkMat) return _sparkMat
  _sparkMat = createSpriteMaterial({
    blending: THREE.AdditiveBlending,
    depthTest: true,
    shade: ({ q, life, seed, tint }) => {
      // A spark is a hot streak, not a dot: bright core, fast cool to ember red.
      const core = pow(smoothstep(float(1), float(0), q.length()), float(2.2))
      const hot = mix(vec3(1, 0.95, 0.82), tint, smoothstep(float(0), float(0.35), life))
      const ember = mix(hot, vec3(0.65, 0.16, 0.03), pow(life, float(1.4)))
      const fade = pow(float(1).sub(life), float(1.6))
      void seed
      return vec4(ember.mul(float(1.6).sub(life)), core.mul(fade))
    }
  })
  return _sparkMat
}

function smokeMaterial() {
  if (_smokeMat) return _smokeMat
  _smokeMat = createSpriteMaterial({
    blending: THREE.NormalBlending,
    fog: true,
    shade: ({ q, life, seed, tint }) => {
      const mask = puffMask(q, seed, life.mul(0.6))
      const birth = smoothstep(float(0), float(0.1), life)
      const decay = pow(float(1).sub(life), float(1.5))
      return vec4(tint.mul(mix(float(1.1), float(0.55), life)), mask.mul(birth).mul(decay).mul(0.8))
    }
  })
  return _smokeMat
}

function fireMaterial() {
  if (_fireMat) return _fireMat
  _fireMat = createSpriteMaterial({
    blending: THREE.AdditiveBlending,
    shade: ({ q, life, seed, tint }) => {
      const mask = puffMask(q, seed, life.mul(0.35))
      // Fireball → smoke: white-hot core, through orange, to nothing. The
      // colour ramp is the whole effect; a fireball that stays orange reads as
      // a sprite, and one that just fades reads as a light.
      const col = mix(vec3(1, 0.96, 0.85), tint, smoothstep(float(0), float(0.22), life))
      const cooled = mix(col, vec3(0.35, 0.1, 0.03), pow(life, float(0.85)))
      const fade = pow(float(1).sub(life), float(1.8))
      return vec4(cooled.mul(float(2.2).sub(life.mul(1.6))), clamp(mask.mul(fade), float(0), float(1)))
    }
  })
  return _fireMat
}

let _splashMat = null
function splashMaterial() {
  if (_splashMat) return _splashMat
  _splashMat = createSpriteMaterial({
    fog: true,
    shade: ({ q, life, seed, tint }) => {
      const mask = dropletMask(q, seed)
      const birth = smoothstep(float(0), float(0.06), life)
      const decay = float(1).sub(smoothstep(float(0.45), float(1), life))
      return vec4(tint, mask.mul(birth).mul(decay).mul(0.9))
    }
  })
  return _splashMat
}

/**
 * Water column from a near miss.
 *
 * A shell that misses still tells you it missed — the plume is most of the
 * feedback in naval gunnery, and without it incoming fire is silent. It rides
 * the visible ocean surface via `seaSurface`, so the column erupts from the
 * water you can see rather than from y = 0.
 *
 * Not yet wired: main.js owns projectile expiry — see qa-shots/CROSSTALK.md.
 *
 * @param {number[]|THREE.Vector3} position world XZ of the miss
 * @param {number} t campaign time (the sea clock)
 * @param {number} [strength] 0..1, scales with the round's calibre
 */
export function spawnWaterColumn(position, t, strength = 1) {
  const x = position.isVector3 ? position.x : position[0]
  const z = position.isVector3 ? position.z : position[2]
  const y = seaSurface(x, z, t)
  const group = new THREE.Group()
  const n = Math.round(26 + strength * 34)
  const column = createSpriteField({
    capacity: n,
    material: splashMaterial(),
    renderOrder: 5,
    name: 'water-column'
  })
  for (let i = 0; i < n; i++) {
    // Narrow fast core, wide slow collar. That contrast is the shape of a shell
    // splash; a uniform cone reads as a firework.
    const core = i < n * 0.55
    const a = Math.random() * Math.PI * 2
    const r = core ? Math.random() * 0.6 : 0.6 + Math.random() * 2.2 * strength
    const up = core
      ? (11 + Math.random() * 13) * (0.6 + strength * 0.7)
      : (3 + Math.random() * 5) * (0.6 + strength * 0.6)
    const out = (core ? 1.4 : 5) * strength
    column.emit({
      position: [x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r],
      velocity: [Math.cos(a) * out, up, Math.sin(a) * out],
      size: (core ? 0.5 : 1.1) * (0.6 + Math.random() * 0.9) * (0.7 + strength * 0.6),
      grow: core ? 0.9 : 2.2,
      life: (core ? 1.5 : 0.9) * (0.7 + Math.random() * 0.6),
      tint: 0xdfeef5,
      gravity: 16,
      drag: 0.5
    })
  }
  group.add(column.mesh)
  const life = 2.2
  return {
    group,
    kind: 'splash',
    life,
    ttl: life,
    sparks: column,
    flecks: [],
    smoke: null,
    burst: null,
    blast: null,
    seaTime: t
  }
}

/** Blast smoke drifts on the same prevailing wind as damage smoke. */
const BLAST_WIND = [3.1, 0.4, 6.8]

const SPARK_COUNT_LASER = 12
const SPARK_COUNT_MISSILE = 24
const SMOKE_PUFFS = 6
const LASER_LIFE = 2.6
const MISSILE_LIFE = 0.85
const MISSILE_EFFECT_SCALE = 1.9

/**
 * @param {THREE.Vector3|number[]} position
 * @param {'laser'|'missile'} [kind='laser']
 * @param {string|number} [tint] optional weapon color
 * @param {{scale?: number}} [options]
 */
/** Shared static geometries — first combat hit should not allocate mid-frame. */
let _warmed = false
let _sharedReady = false
const _shared = {
  fleckBox: null,
  fleckTet: null,
  smokeSphere: null,
  blastSphere: null,
  blastRing: null,
  emberSphere: null
}

function ensureSharedHitGeo() {
  if (_sharedReady) return
  _shared.fleckBox = new THREE.BoxGeometry(0.2, 0.08, 0.14)
  _shared.fleckTet = new THREE.TetrahedronGeometry(0.14, 0)
  _shared.smokeSphere = new THREE.SphereGeometry(1, 8, 6)
  _shared.blastSphere = new THREE.SphereGeometry(1, 12, 10)
  _shared.blastRing = new THREE.SphereGeometry(1, 16, 10)
  _shared.emberSphere = new THREE.SphereGeometry(0.18, 6, 4)
  _sharedReady = true
}

function isSharedGeometry(geo) {
  return (
    geo === _shared.fleckBox ||
    geo === _shared.fleckTet ||
    geo === _shared.smokeSphere ||
    geo === _shared.blastSphere ||
    geo === _shared.blastRing ||
    geo === _shared.emberSphere
  )
}

/** Call once at session start (after renderer exists) to avoid first-hit hitch. */
export function preloadHitImpactFx(renderer, scene, camera) {
  if (_warmed) return
  ensureSharedHitGeo()
  const dummy = spawnHitImpact([1e6, 1e6, 1e6], 'laser', 0x9ee8ff)
  const dummyM = spawnHitImpact([1e6, 1e6, 1e6], 'missile', 0xff8a3d)
  scene.add(dummy.group, dummyM.group)
  try {
    if (renderer?.compile && scene && camera) renderer.compile(scene, camera)
  } catch {
    /* compile optional */
  }
  scene.remove(dummy.group, dummyM.group)
  disposeHitImpact(dummy)
  disposeHitImpact(dummyM)
  _warmed = true
}

export function spawnHitImpact(position, kind = 'laser', tint = null, { scale = 1 } = {}) {
  ensureSharedHitGeo()
  const origin = position.isVector3
    ? position.clone()
    : new THREE.Vector3().fromArray(position)

  const group = new THREE.Group()
  const isMissile = kind === 'missile'
  group.position.copy(origin)
  group.scale.setScalar(Math.max(0.01, Number(scale) || 1) * (isMissile ? MISSILE_EFFECT_SCALE : 1))
  group.frustumCulled = false

  const life = isMissile ? MISSILE_LIFE : LASER_LIFE
  const sparkN = isMissile ? SPARK_COUNT_MISSILE : SPARK_COUNT_LASER

  const sparkColor = tint != null
    ? new THREE.Color(tint)
    : isMissile
      ? new THREE.Color(0xff8a3d)
      : new THREE.Color(0x9ee8ff)

  // Sparks: instanced billboards sharing one material across every impact.
  const sparks = createSpriteField({
    capacity: sparkN,
    material: sparkMaterial(),
    renderOrder: 6,
    name: 'hit-sparks'
  })
  for (let i = 0; i < sparkN; i++) {
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize()
    const speed = isMissile ? 18 + Math.random() * 28 : 12 + Math.random() * 22
    sparks.emit({
      position: [dir.x * 0.15, dir.y * 0.15, dir.z * 0.15],
      velocity: [dir.x * speed, dir.y * speed, dir.z * speed],
      size: (isMissile ? 0.5 : 0.34) * (0.6 + Math.random() * 0.8),
      grow: -0.12,
      life: (isMissile ? 0.55 : 0.42) * (0.6 + Math.random() * 0.9),
      tint: sparkColor,
      gravity: 9,
      drag: 4
    })
  }
  group.add(sparks.mesh)

  // A few tiny metal flecks for solid "something got hit" read.
  const flecks = []
  const fleckN = isMissile ? 6 : 4
  for (let i = 0; i < fleckN; i++) {
    const size = 0.12 + Math.random() * 0.22
    const geo = Math.random() < 0.5 ? _shared.fleckBox : _shared.fleckTet
    const mat = new THREE.MeshBasicMaterial({
      color: sparkColor.clone().multiplyScalar(0.85 + Math.random() * 0.3),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.setScalar(size / 0.2)
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize()
    mesh.position.copy(dir).multiplyScalar(0.2)
    const speed = 8 + Math.random() * 14
    flecks.push({
      mesh,
      vel: dir.multiplyScalar(speed),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12
      )
    })
    group.add(mesh)
  }

  let smoke = null
  let burst = null
  let blast = null
  let fire = null
  let blastSmoke = null

  if (!isMissile) {
    // A brief expanding core makes small laser impacts readable before the
    // sparks and dust drift away. It stays compact so handheld hits do not
    // become a flash in the camera.
    const flash = new THREE.Mesh(
      _shared.blastSphere,
      new THREE.MeshBasicMaterial({
        color: sparkColor,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    flash.scale.setScalar(0.06)
    group.add(flash)
    burst = { flash }

    // Soft grey dust / smoke puffs for laser hits.
    smoke = []
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const mesh = new THREE.Mesh(
        _shared.smokeSphere,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color().setHSL(0.08, 0.05, 0.55 + Math.random() * 0.2),
          transparent: true,
          opacity: 0.35 + Math.random() * 0.2,
          depthWrite: false
        })
      )
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.6 + 0.1,
        Math.random() - 0.5
      ).normalize()
      mesh.position.copy(dir).multiplyScalar(0.3 + Math.random() * 0.5)
      mesh.scale.setScalar(0.12 + Math.random() * 0.08)
      smoke.push({
        mesh,
        vel: dir.multiplyScalar(1.5 + Math.random() * 2.5),
        grow: 2.5 + Math.random() * 3.5,
        baseOp: mesh.material.opacity
      })
      group.add(mesh)
    }
  } else {
    // Fireball → smoke. A detonation is not a flash: it is a white-hot core
    // that expands, cools through orange, and hands off to a rolling smoke ball
    // that outlives it by an order of magnitude. Two pools rather than one,
    // because the fire is additive and the smoke has to occlude.
    fire = createSpriteField({
      capacity: 14,
      material: fireMaterial(),
      renderOrder: 7,
      name: 'blast-fire'
    })
    for (let i = 0; i < 14; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.35,
        Math.random() - 0.5
      ).normalize()
      const speed = 3 + Math.random() * 7
      fire.emit({
        position: [dir.x * 0.2, dir.y * 0.2, dir.z * 0.2],
        velocity: [dir.x * speed, dir.y * speed + 1.5, dir.z * speed],
        size: 0.9 + Math.random() * 1.3,
        grow: 3.4,
        life: 0.32 + Math.random() * 0.3,
        tint: 0xff7a26,
        drag: 3.2,
        buoyancy: 4
      })
    }
    group.add(fire.mesh)

    blastSmoke = createSpriteField({
      capacity: 12,
      material: smokeMaterial(),
      renderOrder: 6.5,
      name: 'blast-smoke'
    })
    for (let i = 0; i < 12; i++) {
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() * 0.5,
        Math.random() - 0.5
      ).normalize()
      blastSmoke.emit({
        position: [dir.x * 0.3, dir.y * 0.3, dir.z * 0.3],
        velocity: [dir.x * 2.5, dir.y * 2 + 1, dir.z * 2.5],
        size: 1.1 + Math.random() * 1.4,
        // Smoke keeps expanding long after the fire has gone out.
        grow: 2.8,
        life: 1.6 + Math.random() * 1.4,
        tint: 0x35322e,
        drag: 1.1,
        buoyancy: 1.6,
        wind: 0.4
      })
    }
    group.add(blastSmoke.mesh)

    // Compact missile detonation: hot flash + shock ring + a few ember bits.
    const flash = new THREE.Mesh(
      _shared.blastSphere,
      new THREE.MeshBasicMaterial({
        color: 0xffaa44,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    flash.scale.setScalar(0.75)
    group.add(flash)

    const ring = new THREE.Mesh(
      _shared.blastRing,
      new THREE.MeshBasicMaterial({
        color: 0xff6a2a,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    )
    ring.scale.setScalar(0.65)
    group.add(ring)

    const embers = []
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(
        _shared.emberSphere,
        new THREE.MeshBasicMaterial({
          color: Math.random() < 0.5 ? 0xffcc66 : 0xff5522,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
      mesh.scale.setScalar(0.8 + Math.random() * 0.6)
      const dir = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).normalize()
      mesh.position.copy(dir).multiplyScalar(0.2)
      embers.push({
        mesh,
        vel: dir.multiplyScalar(10 + Math.random() * 18)
      })
      group.add(mesh)
    }

    blast = { flash, ring, embers }
  }

  return {
    group,
    kind,
    life,
    ttl: life,
    sparks,
    fire,
    blastSmoke,
    flecks,
    smoke,
    burst,
    blast
  }
}

/** @returns {boolean} still alive */
export function updateHitImpact(fx, dt) {
  fx.ttl -= dt
  const t = Math.max(0, fx.ttl / fx.life)
  const age = 1 - t

  // Water columns carry a sea clock so their spray dies into the surface
  // instead of punching through it; hull impacts have no sea to test against.
  fx.sparks.update(dt, fx.seaTime !== undefined ? { seaTime: fx.seaTime } : null)
  fx.fire?.update(dt)
  // Smoke is the only part of a detonation light enough for the wind to move.
  fx.blastSmoke?.update(dt, { wind: BLAST_WIND })

  for (const f of fx.flecks) {
    f.mesh.position.addScaledVector(f.vel, dt)
    f.vel.multiplyScalar(Math.exp(-3.5 * dt))
    f.mesh.rotation.x += f.spin.x * dt
    f.mesh.rotation.y += f.spin.y * dt
    f.mesh.rotation.z += f.spin.z * dt
    const fleckFade = fx.kind === 'missile'
      ? t
      : Math.min(t, Math.max(0, 1 - age / 0.8))
    f.mesh.material.opacity = fleckFade
    f.mesh.scale.setScalar(0.4 + fleckFade * 0.7)
  }

  if (fx.smoke) {
    for (const s of fx.smoke) {
      s.mesh.position.addScaledVector(s.vel, dt)
      s.vel.multiplyScalar(Math.exp(-1.2 * dt))
      s.vel.y += 0.8 * dt // slight rise
      const sc = 0.12 + age * s.grow
      s.mesh.scale.setScalar(sc)
      const smokeBirth = Math.min(1, age / 0.16)
      s.mesh.material.opacity = s.baseOp * smokeBirth * t * t
    }
  }

  if (fx.burst) {
    const { flash } = fx.burst
    const burstProgress = Math.min(1, age / 0.4)
    flash.scale.setScalar(0.06 + burstProgress * 0.5)
    flash.material.opacity = 0.72 * Math.max(0, 1 - age / 0.4)
  }

  if (fx.blast) {
    const { flash, ring, embers } = fx.blast
    flash.scale.setScalar(0.75 + age * 6.5)
    flash.material.opacity = 0.9 * t * t
    ring.scale.setScalar(0.65 + age * 10)
    ring.material.opacity = 0.55 * t
    for (const e of embers) {
      e.mesh.position.addScaledVector(e.vel, dt)
      e.vel.multiplyScalar(Math.exp(-2.8 * dt))
      e.mesh.material.opacity = t
      e.mesh.scale.setScalar(0.5 + t * 0.7)
    }
  }

  return fx.ttl > 0
}

export function disposeHitImpact(fx) {
  fx.sparks?.dispose()
  fx.fire?.dispose()
  fx.blastSmoke?.dispose()
  fx.group.traverse((obj) => {
    // The shared spark/smoke/fire materials outlive every individual impact —
    // the sprite fields already freed their own (per-impact) geometry.
    if (obj === fx.sparks?.mesh || obj === fx.fire?.mesh || obj === fx.blastSmoke?.mesh) return
    // Spark buffers are per-fx; shared spheres/boxes must not be disposed.
    if (obj.geometry && !isSharedGeometry(obj.geometry)) obj.geometry.dispose()
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}
