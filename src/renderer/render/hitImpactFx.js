import * as THREE from 'three'

// Short-lived hit feedback: sparks for all weapons; lasers also puff smoke,
// missiles flash a compact detonation.

const SPARK_COUNT_LASER = 10
const SPARK_COUNT_MISSILE = 14
const SMOKE_PUFFS = 5
const LASER_LIFE = 0.38
const MISSILE_LIFE = 0.55

/**
 * @param {THREE.Vector3|number[]} position
 * @param {'laser'|'missile'} [kind='laser']
 * @param {string|number} [tint] optional weapon color
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

export function spawnHitImpact(position, kind = 'laser', tint = null) {
  ensureSharedHitGeo()
  const origin = position.isVector3
    ? position.clone()
    : new THREE.Vector3().fromArray(position)

  const group = new THREE.Group()
  group.position.copy(origin)
  group.frustumCulled = false

  const isMissile = kind === 'missile'
  const life = isMissile ? MISSILE_LIFE : LASER_LIFE
  const sparkN = isMissile ? SPARK_COUNT_MISSILE : SPARK_COUNT_LASER

  const sparkColor = tint != null
    ? new THREE.Color(tint)
    : isMissile
      ? new THREE.Color(0xff8a3d)
      : new THREE.Color(0x9ee8ff)

  // Tiny bright sparks (points).
  const sparkPos = new Float32Array(sparkN * 3)
  const sparkVel = []
  for (let i = 0; i < sparkN; i++) {
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize()
    sparkPos[i * 3] = dir.x * 0.15
    sparkPos[i * 3 + 1] = dir.y * 0.15
    sparkPos[i * 3 + 2] = dir.z * 0.15
    const speed = isMissile ? 18 + Math.random() * 28 : 12 + Math.random() * 22
    sparkVel.push(dir.multiplyScalar(speed))
  }
  const sparkGeo = new THREE.BufferGeometry()
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3))
  const sparkMat = new THREE.PointsMaterial({
    color: sparkColor,
    size: isMissile ? 1.4 : 1.0,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  })
  const sparks = new THREE.Points(sparkGeo, sparkMat)
  sparks.frustumCulled = false
  group.add(sparks)

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
  let blast = null

  if (!isMissile) {
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
      mesh.scale.setScalar(0.35 + Math.random() * 0.4)
      smoke.push({
        mesh,
        vel: dir.multiplyScalar(1.5 + Math.random() * 2.5),
        grow: 2.5 + Math.random() * 3.5,
        baseOp: mesh.material.opacity
      })
      group.add(mesh)
    }
  } else {
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
    flash.scale.setScalar(0.6)
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
    ring.scale.setScalar(0.5)
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
    sparkPos,
    sparkVel,
    sparkGeo,
    sparkMat,
    flecks,
    smoke,
    blast
  }
}

/** @returns {boolean} still alive */
export function updateHitImpact(fx, dt) {
  fx.ttl -= dt
  const t = Math.max(0, fx.ttl / fx.life)
  const age = 1 - t

  for (let i = 0; i < fx.sparkVel.length; i++) {
    fx.sparkPos[i * 3] += fx.sparkVel[i].x * dt
    fx.sparkPos[i * 3 + 1] += fx.sparkVel[i].y * dt
    fx.sparkPos[i * 3 + 2] += fx.sparkVel[i].z * dt
    fx.sparkVel[i].multiplyScalar(Math.exp(-4 * dt))
  }
  fx.sparkGeo.attributes.position.needsUpdate = true
  fx.sparkMat.opacity = t
  fx.sparkMat.size = (fx.kind === 'missile' ? 1.4 : 1.0) * (0.5 + t * 0.6)

  for (const f of fx.flecks) {
    f.mesh.position.addScaledVector(f.vel, dt)
    f.vel.multiplyScalar(Math.exp(-3.5 * dt))
    f.mesh.rotation.x += f.spin.x * dt
    f.mesh.rotation.y += f.spin.y * dt
    f.mesh.rotation.z += f.spin.z * dt
    f.mesh.material.opacity = t
    f.mesh.scale.setScalar(0.4 + t * 0.7)
  }

  if (fx.smoke) {
    for (const s of fx.smoke) {
      s.mesh.position.addScaledVector(s.vel, dt)
      s.vel.multiplyScalar(Math.exp(-1.2 * dt))
      s.vel.y += 0.8 * dt // slight rise
      const sc = 0.4 + age * s.grow
      s.mesh.scale.setScalar(sc)
      s.mesh.material.opacity = s.baseOp * t * t
    }
  }

  if (fx.blast) {
    const { flash, ring, embers } = fx.blast
    flash.scale.setScalar(0.6 + age * 4.5)
    flash.material.opacity = 0.9 * t * t
    ring.scale.setScalar(0.5 + age * 7)
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
  fx.group.traverse((obj) => {
    // Spark buffers are per-fx; shared spheres/boxes must not be disposed.
    if (obj.geometry && !isSharedGeometry(obj.geometry)) obj.geometry.dispose()
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}
