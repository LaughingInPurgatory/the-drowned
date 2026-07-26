import * as THREE from 'three'

/**
 * Warp-gate jump tunnel:
 * bright circular aperture, cylindrical light walls, radial star streaks
 * rushing toward the camera, concentric energy rings.
 * Attached to the camera; geometry lives in front of the chase seat.
 */

const Z_NEAR = -50
const Z_FAR = -420
const RING_COUNT = 14
const STREAK_COUNT = 120
const WALL_SEGMENTS = 48

function glowTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.15, 'rgba(180,230,255,0.95)')
  g.addColorStop(0.45, 'rgba(40,140,255,0.4)')
  g.addColorStop(1, 'rgba(10,40,100,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

function addMat(color, opacity, { side = THREE.DoubleSide } = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side
  })
}

export function createHyperspaceTunnel() {
  const group = new THREE.Group()
  group.visible = false
  group.frustumCulled = false

  const spin = new THREE.Group()
  spin.frustumCulled = false
  group.add(spin)

  const glowMap = glowTexture()

  // Far aperture (vanishing point — the "gate" ahead).
  const aperture = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xb8f0ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    })
  )
  aperture.position.set(0, 0, Z_FAR * 0.88)
  aperture.scale.setScalar(55)
  aperture.frustumCulled = false
  group.add(aperture)

  // Concentric energy rings rushing toward the camera.
  const rings = []
  for (let i = 0; i < RING_COUNT; i++) {
    const geo = new THREE.TorusGeometry(18 + (i % 3) * 2.5, 0.35, 8, 48)
    const mesh = new THREE.Mesh(geo, addMat(i % 2 ? 0x60c8ff : 0xa0e8ff, 0.35))
    mesh.frustumCulled = false
    spin.add(mesh)
    rings.push({
      mesh,
      z: Z_NEAR - 20 - i * ((Math.abs(Z_FAR - Z_NEAR) * 0.85) / RING_COUNT),
      speed: 140 + i * 18,
      baseR: 0.85 + (i % 4) * 0.08
    })
  }

  // Soft cylindrical wall haze (tube of light).
  const wallGeo = new THREE.CylinderGeometry(26, 32, Math.abs(Z_FAR - Z_NEAR), WALL_SEGMENTS, 1, true)
  wallGeo.rotateX(Math.PI / 2)
  wallGeo.translate(0, 0, (Z_NEAR + Z_FAR) / 2)
  const wall = new THREE.Mesh(
    wallGeo,
    new THREE.MeshBasicMaterial({
      color: 0x1860a8,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    })
  )
  wall.frustumCulled = false
  spin.add(wall)

  const wallInner = new THREE.Mesh(
    wallGeo.clone(),
    new THREE.MeshBasicMaterial({
      color: 0x40a0e0,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    })
  )
  wallInner.scale.set(0.72, 0.72, 1)
  wallInner.frustumCulled = false
  spin.add(wallInner)

  // Radial star streaks (lines flying past during the jump).
  const streakPositions = new Float32Array(STREAK_COUNT * 2 * 3)
  const streakGeo = new THREE.BufferGeometry()
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3))
  const streaks = new THREE.LineSegments(
    streakGeo,
    new THREE.LineBasicMaterial({
      color: 0xd0f4ff,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  streaks.frustumCulled = false
  group.add(streaks)

  const streakState = []
  for (let i = 0; i < STREAK_COUNT; i++) {
    streakState.push({
      angle: Math.random() * Math.PI * 2,
      radius: 4 + Math.random() * 28,
      z: Z_FAR + Math.random() * (Z_NEAR - Z_FAR),
      speed: 180 + Math.random() * 320,
      len: 8 + Math.random() * 40
    })
  }

  function writeStreaks() {
    const pos = streaks.geometry.attributes.position.array
    for (let i = 0; i < STREAK_COUNT; i++) {
      const s = streakState[i]
      const x = Math.cos(s.angle) * s.radius
      const y = Math.sin(s.angle) * s.radius
      const i6 = i * 6
      pos[i6] = x
      pos[i6 + 1] = y
      pos[i6 + 2] = s.z
      pos[i6 + 3] = x
      pos[i6 + 4] = y
      pos[i6 + 5] = s.z + s.len
    }
    streaks.geometry.attributes.position.needsUpdate = true
  }
  writeStreaks()

  // Entry flash disc (fills view on gate activation).
  const flashDisc = new THREE.Mesh(
    new THREE.CircleGeometry(40, 32),
    addMat(0xe8ffff, 0)
  )
  flashDisc.position.z = Z_NEAR - 8
  flashDisc.frustumCulled = false
  group.add(flashDisc)

  let active = false
  let spinAngle = 0
  let warpMode = true
  const _aim = new THREE.Vector3()
  const _eye = new THREE.Vector3()
  const _up = new THREE.Vector3()
  const _lookMat = new THREE.Matrix4()

  return {
    group,
    start(opts = {}) {
      active = true
      spinAngle = 0
      warpMode = opts.warpMode !== false
      group.visible = true
      for (const s of streakState) {
        s.z = Z_FAR + Math.random() * (Z_NEAR - Z_FAR)
        s.angle = Math.random() * Math.PI * 2
        s.radius = 4 + Math.random() * 28
        s.speed = 180 + Math.random() * 320
        s.len = 8 + Math.random() * 40
      }
      writeStreaks()
    },
    stop() {
      active = false
      group.visible = false
      if (flashDisc.material) flashDisc.material.opacity = 0
    },
    /**
     * @param {number} dt
     * @param {number} strength 0–1
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3|number[]|null} [aimWorld]
     */
    update(dt, strength, camera, aimWorld = null) {
      if (!active) return
      group.visible = strength > 0.02
      const i = Math.min(1, Math.max(0, strength))
      const rush = 0.7 + i * 1.8

      group.position.copy(camera.position)
      if (aimWorld) {
        if (aimWorld.isVector3) _aim.copy(aimWorld)
        else _aim.fromArray(aimWorld)
        _eye.copy(camera.position)
        if (_eye.distanceToSquared(_aim) > 1e-4) {
          _up.copy(camera.up)
          _lookMat.lookAt(_eye, _aim, _up)
          group.quaternion.setFromRotationMatrix(_lookMat)
        } else {
          group.quaternion.copy(camera.quaternion)
        }
      } else {
        group.quaternion.copy(camera.quaternion)
      }

      // Slow tube spin + shear (spatial distortion).
      spinAngle += 0.35 * rush * dt
      spin.rotation.z = spinAngle
      if (warpMode) {
        spin.rotation.x = Math.sin(spinAngle * 0.6) * 0.04 * i
        spin.rotation.y = Math.cos(spinAngle * 0.5) * 0.03 * i
      }

      // Rings rush toward camera, recycle at near plane.
      for (const r of rings) {
        r.z += r.speed * rush * dt
        if (r.z > Z_NEAR - 4) {
          r.z = Z_FAR * 0.92 - Math.random() * 30
          r.baseR = 0.8 + Math.random() * 0.25
        }
        const span = Math.abs(Z_FAR - Z_NEAR)
        const depthT = Math.min(1, Math.max(0, (r.z - Z_FAR) / span))
        const sc = r.baseR * (0.55 + depthT * 1.1) * (0.75 + i * 0.4)
        r.mesh.scale.set(sc, sc, sc)
        r.mesh.position.set(0, 0, r.z)
        r.mesh.material.opacity = (0.08 + i * 0.35) * Math.min(1, depthT + 0.15)
      }

      // Star streaks
      for (const s of streakState) {
        s.z += s.speed * rush * dt
        // Expand outward slightly as they approach (tunnel perspective).
        s.radius += rush * dt * 2.5
        if (s.z > Z_NEAR + 10) {
          s.z = Z_FAR + Math.random() * 40
          s.angle = Math.random() * Math.PI * 2
          s.radius = 3 + Math.random() * 12
          s.speed = 200 + Math.random() * 360
          s.len = 10 + Math.random() * 50
        }
      }
      writeStreaks()
      streaks.material.opacity = 0.35 + i * 0.55

      wall.material.opacity = 0.06 + i * 0.14
      wallInner.material.opacity = 0.03 + i * 0.1

      aperture.position.z = Z_FAR * 0.88
      aperture.scale.setScalar(30 + i * 55)
      aperture.material.opacity = 0.4 + i * 0.55

      // Entry flash: bright at mid strength, fades as tunnel settles.
      flashDisc.material.opacity = Math.max(0, Math.sin(i * Math.PI) * 0.45 * i)
    }
  }
}
