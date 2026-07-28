/**
 * Shared particle helpers: a round glow sprite and a pooled puff emitter.
 *
 * These used to draw engine plumes. Boats leave a wake instead
 * (render/wake.js), but damage smoke, torpedo trails and the salvage scoop are
 * all built from the same two pieces, so they live here.
 */
import * as THREE from 'three'

// Soft glowing sprite (no image asset). Shared by thrusters + damage FX.
export function buildGlowTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

const _spreadJitter = new THREE.Vector3()

/**
 * Round glow puffs with short lifetimes (fade out) so trails don't stretch
 * across the HUD into the bottom radar.
 * life is in seconds; keep rear exhaust well under ~0.2s so plumes die
 * before the chase-cam radar band.
 */
export function createPuffEmitter(count, color, size, texture, { life = 0.28 } = {}) {
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const ages = new Float32Array(count)
  // Start "dead" so idle particles aren't visible as a cloud at world origin.
  ages.fill(life + 1)
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    map: texture,
    color,
    size,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  })
  const points = new THREE.Points(geometry, material)
  points.visible = false
  points.frustumCulled = false

  const velocities = Array.from({ length: count }, () => new THREE.Vector3())
  let nextIndex = 0
  let spawnAccumulator = 0
  let nozzleCursor = 0
  const baseSize = size
  const maxLife = life

  return {
    mesh: points,
    /**
     * @param {THREE.Vector3|THREE.Vector3[]} originWorld single origin or multi-nozzle list
     */
    update(dt, active, originWorld, dirWorld, spawnRate, speed, spread) {
      const origins = Array.isArray(originWorld) ? originWorld : null
      const single = origins ? null : originWorld

      if (active) {
        points.visible = true
        spawnAccumulator += dt * spawnRate
        while (spawnAccumulator >= 1) {
          spawnAccumulator -= 1
          const i = nextIndex
          nextIndex = (nextIndex + 1) % count
          const origin = origins
            ? origins[nozzleCursor++ % origins.length]
            : single
          positions[i * 3] = origin.x
          positions[i * 3 + 1] = origin.y
          positions[i * 3 + 2] = origin.z
          ages[i] = 0
          _spreadJitter.set(
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread,
            (Math.random() - 0.5) * spread
          )
          velocities[i].copy(dirWorld).multiplyScalar(speed * (0.75 + Math.random() * 0.5)).add(_spreadJitter)
        }
      }

      let anyAlive = false
      let maxOpacity = 0
      for (let i = 0; i < count; i++) {
        ages[i] += dt
        if (ages[i] > maxLife) {
          // Park dead particles far away so they don't stack at origin.
          positions[i * 3] = 0
          positions[i * 3 + 1] = 1e6
          positions[i * 3 + 2] = 0
          continue
        }
        anyAlive = true
        // Drag: exhaust quickly loses energy (realistic short plume).
        velocities[i].multiplyScalar(Math.max(0.02, 1 - 4.2 * dt))
        positions[i * 3] += velocities[i].x * dt
        positions[i * 3 + 1] += velocities[i].y * dt
        positions[i * 3 + 2] += velocities[i].z * dt
        const u = ages[i] / maxLife
        // Bright near nozzle, then hard falloff — dies before bottom HUD.
        const a = u < 0.08 ? u / 0.08 : Math.pow(1 - (u - 0.08) / 0.92, 2.4)
        if (a > maxOpacity) maxOpacity = a
      }
      // One material opacity for the batch — driven by the brightest living particle.
      material.opacity = active ? 0.45 + 0.4 * maxOpacity : maxOpacity * 0.45
      material.size = baseSize * (0.5 + 0.5 * maxOpacity)
      geometry.attributes.position.needsUpdate = true
      if (!active && !anyAlive) points.visible = false
    },
    burst(originWorld, dirWorld, countBurst, speed, spread) {
      points.visible = true
      for (let n = 0; n < countBurst; n++) {
        const i = nextIndex
        nextIndex = (nextIndex + 1) % count
        positions[i * 3] = originWorld.x + (Math.random() - 0.5) * spread
        positions[i * 3 + 1] = originWorld.y + (Math.random() - 0.5) * spread
        positions[i * 3 + 2] = originWorld.z + (Math.random() - 0.5) * spread
        ages[i] = 0
        _spreadJitter.set(
          (Math.random() - 0.5) * spread * 2,
          (Math.random() - 0.5) * spread * 2,
          (Math.random() - 0.5) * spread * 2
        )
        velocities[i]
          .copy(dirWorld)
          .multiplyScalar(speed * (0.5 + Math.random()))
          .add(_spreadJitter)
      }
      geometry.attributes.position.needsUpdate = true
    }
  }
}

/**
 * Elongated engine streaks. Normal thrust uses short travel; supercruise is long.
 * When nozzles are provided, streaks are pinned to each engine (round-robin).
 */
function createStreakEmitter(count, color, length, radius) {
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.35, length, 6, 1, true)
  geometry.rotateX(Math.PI / 2)
  // Unique material per streak so each can fade independently.
  const meshes = Array.from({ length: count }, () => {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    return new THREE.Mesh(geometry, mat)
  })
  const group = new THREE.Group()
  for (const m of meshes) {
    m.visible = false
    group.add(m)
  }
  group.visible = false

  // Base local XY/Z per streak (nozzle + jitter).
  const baseX = new Float32Array(count)
  const baseY = new Float32Array(count)
  const baseZ = new Float32Array(count)
  const localOffsets = meshes.map(() => new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, 0))
  const distances = meshes.map(() => Math.random())
  const localPos = new THREE.Vector3()
  let nozzleCursor = 0
  let needsPin = true

  function pinToNozzle(i, nozzles, rearZ, spreadRadius) {
    if (nozzles?.length) {
      const n = nozzles[nozzleCursor++ % nozzles.length]
      baseX[i] = n.x
      baseY[i] = n.y
      baseZ[i] = n.z
    } else {
      baseX[i] = 0
      baseY[i] = 0
      baseZ[i] = rearZ
    }
    localOffsets[i].set(
      (Math.random() - 0.5) * spreadRadius,
      (Math.random() - 0.5) * spreadRadius,
      0
    )
  }

  return {
    mesh: group,
    update(dt, active, shipPos, shipQuat, rearZ, speed, travel, spreadRadius, nozzles = null) {
      if (!active) {
        group.visible = false
        needsPin = true
        for (let i = 0; i < meshes.length; i++) {
          distances[i] = Math.random() * 0.35
          meshes[i].visible = false
        }
        return
      }
      group.visible = true
      const travelSafe = Math.max(0.5, travel)
      // Stagger initial ages across nozzles so multi-engine plumes read immediately.
      if (needsPin) {
        nozzleCursor = 0
        for (let i = 0; i < meshes.length; i++) {
          pinToNozzle(i, nozzles, rearZ, spreadRadius)
          distances[i] = (i / meshes.length) * travelSafe * 0.55
        }
        needsPin = false
      }
      for (let i = 0; i < meshes.length; i++) {
        distances[i] += dt * speed
        if (distances[i] > travelSafe) {
          distances[i] = 0
          pinToNozzle(i, nozzles, rearZ, spreadRadius)
        }
        const u = distances[i] / travelSafe
        // Peak early, then die fast — normal plumes must not reach the radar.
        const fade = u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 2.6)
        if (fade < 0.05) {
          meshes[i].visible = false
          continue
        }
        meshes[i].visible = true
        localPos.set(
          baseX[i] + localOffsets[i].x,
          baseY[i] + localOffsets[i].y,
          baseZ[i] - distances[i]
        )
        meshes[i].position.copy(localPos).applyQuaternion(shipQuat).add(shipPos)
        meshes[i].quaternion.copy(shipQuat)
        // Shrink and dim with age (short tongue, not a long ribbon).
        const s = 0.4 + 0.5 * (1 - u)
        meshes[i].scale.set(s * (0.65 + 0.35 * fade), s * (0.65 + 0.35 * fade), s * (0.85 + 0.15 * (1 - u)))
        meshes[i].material.opacity = 0.12 + 0.55 * fade
      }
    },
    /** Force re-pin on next active frame (e.g. ship class change). */
    resetNozzles() {
      needsPin = true
      nozzleCursor = 0
    },
    stop() {
      group.visible = false
      needsPin = true
      for (const m of meshes) m.visible = false
    }
  }
}

/** Shared glow map so many NPC thrusters don't each allocate a canvas texture. */
let _sharedGlowTexture = null
export function getSharedGlowTexture() {
  if (!_sharedGlowTexture) _sharedGlowTexture = buildGlowTexture()
  return _sharedGlowTexture
}

// Warm rear exhaust + cool brake + side jets + short normal streaks + long SC streaks.
