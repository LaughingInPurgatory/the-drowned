import * as THREE from 'three'

// Fracture debris + expanding shock when a rock or ship is destroyed.

const SHARD_COUNT = 16
const DUST_COUNT = 28
// 50% slower than original 1.35s.
const LIFE = 2.025

const STYLES = {
  rock: {
    flash: 0xffb347,
    ring: 0xc28a4a,
    dust: 0xe0a060,
    shardHue: [0.06, 0.08],
    shardSat: 0.35,
    shardLight: [0.32, 0.22],
    metalness: 0.05,
    roughness: 0.95
  },
  ship: {
    flash: 0xff6a2a,
    ring: 0xffaa44,
    dust: 0xffcc66,
    // Cool grey-blue hull plating
    shardHue: [0.55, 0.08],
    shardSat: 0.12,
    shardLight: [0.28, 0.2],
    metalness: 0.72,
    roughness: 0.38
  }
}

/**
 * @param {THREE.Vector3|number[]} position
 * @param {number} [baseRadius=12]
 * @param {'rock'|'ship'} [style='rock']
 */
export function spawnRockExplosion(position, baseRadius = 12, style = 'rock') {
  const palette = STYLES[style] ?? STYLES.rock
  const origin = position.isVector3
    ? position.clone()
    : new THREE.Vector3().fromArray(position)

  const group = new THREE.Group()
  group.position.copy(origin)
  group.frustumCulled = false

  const R = Math.max(6, baseRadius)
  const shards = []
  const dust = []

  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({
      color: palette.flash,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  flash.scale.setScalar(R * 0.35)
  group.add(flash)

  const ring = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 12),
    new THREE.MeshBasicMaterial({
      color: palette.ring,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  ring.scale.setScalar(R * 0.5)
  group.add(ring)

  for (let i = 0; i < SHARD_COUNT; i++) {
    const size = R * (0.1 + Math.random() * 0.22)
    let geo
    if (style === 'ship') {
      // Hull plating / structural chunks — boxes and plates, not rock blobs.
      const kind = Math.random()
      if (kind < 0.55) {
        geo = new THREE.BoxGeometry(
          size * (0.6 + Math.random() * 1.4),
          size * (0.15 + Math.random() * 0.45),
          size * (0.5 + Math.random() * 1.2)
        )
      } else if (kind < 0.8) {
        geo = new THREE.BoxGeometry(size * 0.4, size * 1.2, size * 0.35)
      } else {
        geo = new THREE.TetrahedronGeometry(size * 0.9, 0)
      }
    } else {
      geo =
        Math.random() < 0.5
          ? new THREE.TetrahedronGeometry(size, 0)
          : new THREE.OctahedronGeometry(size * 0.85, 0)
    }

    const hue = palette.shardHue[0] + (Math.random() - 0.5) * palette.shardHue[1]
    const light = palette.shardLight[0] + Math.random() * palette.shardLight[1]
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(hue, palette.shardSat, light),
      roughness: palette.roughness,
      metalness: palette.metalness,
      flatShading: true,
      transparent: true,
      opacity: 1
    })
    // Scorched edges on some ship shards.
    if (style === 'ship' && Math.random() < 0.4) {
      mat.color.offsetHSL(0.02, 0.15, -0.08)
      mat.emissive = new THREE.Color(0xff4400)
      mat.emissiveIntensity = 0.15 + Math.random() * 0.25
    }

    const mesh = new THREE.Mesh(geo, mat)
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize()
    mesh.position.copy(dir).multiplyScalar(R * 0.15)
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6)
    const speed = R * (2.2 + Math.random() * 4.5)
    shards.push({
      mesh,
      vel: dir.multiplyScalar(speed),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 8
      )
    })
    group.add(mesh)
  }

  const dustPos = new Float32Array(DUST_COUNT * 3)
  const dustVel = []
  for (let i = 0; i < DUST_COUNT; i++) {
    const dir = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize()
    dustPos[i * 3] = dir.x * R * 0.1
    dustPos[i * 3 + 1] = dir.y * R * 0.1
    dustPos[i * 3 + 2] = dir.z * R * 0.1
    dustVel.push(dir.multiplyScalar(R * (3 + Math.random() * 6)))
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
  const dustMat = new THREE.PointsMaterial({
    color: palette.dust,
    size: R * 0.12,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  })
  const dustPts = new THREE.Points(dustGeo, dustMat)
  dustPts.frustumCulled = false
  group.add(dustPts)
  dust.push({ pos: dustPos, vel: dustVel, geo: dustGeo, mat: dustMat })

  return {
    group,
    shards,
    dust,
    flash,
    ring,
    ttl: LIFE,
    life: LIFE,
    baseR: R,
    style
  }
}

/** Hull-plate fracture burst (no rock/ice look). */
export function spawnShipExplosion(position, baseRadius = 12) {
  return spawnRockExplosion(position, baseRadius, 'ship')
}

/** @returns {boolean} still alive */
export function updateRockExplosion(fx, dt) {
  fx.ttl -= dt
  const t = Math.max(0, fx.ttl / fx.life)
  const age = 1 - t

  fx.flash.scale.setScalar(fx.baseR * (0.4 + age * 3.2))
  fx.flash.material.opacity = 0.85 * t * t
  fx.ring.scale.setScalar(fx.baseR * (0.5 + age * 5.5))
  fx.ring.material.opacity = 0.4 * t

  const motion = 0.67
  for (const s of fx.shards) {
    s.mesh.position.addScaledVector(s.vel, dt * motion)
    s.vel.multiplyScalar(Math.exp(-1.05 * dt))
    s.mesh.rotation.x += s.spin.x * dt * motion
    s.mesh.rotation.y += s.spin.y * dt * motion
    s.mesh.rotation.z += s.spin.z * dt * motion
    s.mesh.material.opacity = Math.min(1, t * 1.4)
    if (s.mesh.material.emissiveIntensity != null) {
      s.mesh.material.emissiveIntensity *= Math.exp(-1.2 * dt)
    }
    const shrink = 0.55 + t * 0.45
    s.mesh.scale.setScalar(shrink)
  }

  for (const d of fx.dust) {
    for (let i = 0; i < d.vel.length; i++) {
      d.pos[i * 3] += d.vel[i].x * dt * motion
      d.pos[i * 3 + 1] += d.vel[i].y * dt * motion
      d.pos[i * 3 + 2] += d.vel[i].z * dt * motion
      d.vel[i].multiplyScalar(Math.exp(-0.85 * dt))
    }
    d.geo.attributes.position.needsUpdate = true
    d.mat.opacity = 0.9 * t
    d.mat.size = fx.baseR * 0.12 * (0.6 + t * 0.5)
  }

  return fx.ttl > 0
}

export function disposeRockExplosion(fx) {
  fx.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose())
      else obj.material.dispose()
    }
  })
}
