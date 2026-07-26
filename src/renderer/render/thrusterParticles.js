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

/**
 * Cheap rear-only thruster FX for on-screen NPCs (no brake / RCS / supercruise).
 * Multi-nozzle aware; smaller particle pools than the player set.
 */
export function createLiteThrusterEffects(texture = getSharedGlowTexture()) {
  const rearPuff = createPuffEmitter(22, 0xff8a3d, 1.4, texture, { life: 0.14 })
  const thrustStreaks = createStreakEmitter(8, 0xffa040, 2.2, 0.14)
  const group = new THREE.Group()
  group.add(rearPuff.mesh, thrustStreaks.mesh)

  const forward = new THREE.Vector3()
  const back = new THREE.Vector3()
  const localNozzle = new THREE.Vector3()
  const nozzleWorld = []
  let cachedNozzleKey = ''

  function ensureNozzleWorld(nozzles, shipPos, shipQuat) {
    while (nozzleWorld.length < nozzles.length) nozzleWorld.push(new THREE.Vector3())
    for (let i = 0; i < nozzles.length; i++) {
      const n = nozzles[i]
      localNozzle.set(n.x, n.y, n.z)
      nozzleWorld[i].copy(localNozzle).applyQuaternion(shipQuat).add(shipPos)
    }
    return nozzleWorld
  }

  return {
    group,
    update(dt, { accelActive, shipPos, shipQuat, hullLength, nozzles = null }) {
      const rearZ = -hullLength / 2
      forward.set(0, 0, 1).applyQuaternion(shipQuat)
      back.copy(forward).negate()
      const nozzleList = nozzles?.length > 0 ? nozzles : [{ x: 0, y: 0, z: rearZ }]
      const key = `${nozzleList.length}:${nozzleList.map((n) => `${n.x.toFixed(1)},${n.y.toFixed(1)}`).join('|')}`
      if (key !== cachedNozzleKey) {
        cachedNozzleKey = key
        thrustStreaks.resetNozzles?.()
      }
      const worldNozzles = ensureNozzleWorld(nozzleList, shipPos, shipQuat).slice(0, nozzleList.length)
      const nCount = nozzleList.length
      const puffSpread = nCount > 1 ? 0.45 : 0.9
      const streakSpread = nCount > 1 ? 0.3 : 0.55
      rearPuff.update(dt, accelActive, worldNozzles, back, 36 * (0.9 + 0.1 * Math.min(nCount, 4)), 8, puffSpread)
      thrustStreaks.update(
        dt,
        accelActive,
        shipPos,
        shipQuat,
        rearZ,
        16,
        3.4,
        streakSpread,
        nozzleList
      )
    },
    dispose() {
      group.parent?.remove(group)
      rearPuff.mesh.geometry?.dispose?.()
      rearPuff.mesh.material?.dispose?.()
      for (const child of thrustStreaks.mesh.children) {
        child.material?.dispose?.()
      }
      // Geometry is shared among streak meshes — dispose once.
      thrustStreaks.mesh.children[0]?.geometry?.dispose?.()
    }
  }
}

// Warm rear exhaust + cool brake + side jets + short normal streaks + long SC streaks.
export function createThrusterEffects() {
  const texture = buildGlowTexture()
  // Rear plume — chunky enough to read, still dies before the radar band.
  // Particle pool sized for multi-nozzle (quad) without looking sparse.
  const rearPuff = createPuffEmitter(48, 0xff8a3d, 1.55, texture, { life: 0.16 })
  const frontPuff = createPuffEmitter(14, 0x7fe6ff, 1.1, texture, { life: 0.14 })
  const sidePuff = createPuffEmitter(18, 0xa0e8ff, 1.2, texture, { life: 0.12 })
  // Enough streaks to cover up to 4 nozzles (2–3 each).
  const thrustStreaks = createStreakEmitter(12, 0xffa040, 2.5, 0.16)
  // Supercruise: long cyan rush (unchanged character, still long).
  const cruiseStreaks = createStreakEmitter(12, 0x7fe6ff, 14, 0.32)
  const tunnelBurst = createPuffEmitter(48, 0xc8f0ff, 8, texture, { life: 0.55 })

  const group = new THREE.Group()
  group.add(rearPuff.mesh, frontPuff.mesh, sidePuff.mesh, thrustStreaks.mesh, cruiseStreaks.mesh, tunnelBurst.mesh)

  const forward = new THREE.Vector3()
  const back = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const rearOrigin = new THREE.Vector3()
  const frontOrigin = new THREE.Vector3()
  const sideOrigin = new THREE.Vector3()
  const sideDir = new THREE.Vector3()
  const localNozzle = new THREE.Vector3()
  // Reused world-space nozzle positions (grown as needed).
  const nozzleWorld = []

  let cachedNozzleKey = ''

  function ensureNozzleWorld(nozzles, shipPos, shipQuat) {
    while (nozzleWorld.length < nozzles.length) {
      nozzleWorld.push(new THREE.Vector3())
    }
    for (let i = 0; i < nozzles.length; i++) {
      const n = nozzles[i]
      localNozzle.set(n.x, n.y, n.z)
      nozzleWorld[i].copy(localNozzle).applyQuaternion(shipQuat).add(shipPos)
    }
    return nozzleWorld.slice(0, nozzles.length)
  }

  return {
    group,
    /**
     * @param {object} opts
     * @param {{ x: number, y: number, z: number }[]} [opts.nozzles] ship-local engine nozzles
     */
    update(dt, { accelActive, brakeActive, cruiseActive, strafeX = 0, strafeY = 0, shipPos, shipQuat, hullLength, nozzles = null }) {
      const rearZ = -hullLength / 2
      const frontZ = hullLength / 2
      const halfW = hullLength * 0.12
      forward.set(0, 0, 1).applyQuaternion(shipQuat)
      back.copy(forward).negate()
      right.set(1, 0, 0).applyQuaternion(shipQuat)
      up.set(0, 1, 0).applyQuaternion(shipQuat)
      frontOrigin.set(0, 0, frontZ).applyQuaternion(shipQuat).add(shipPos)

      // Multi-engine: one plume per nacelle. Fallback: single center rear.
      const nozzleList =
        nozzles?.length > 0 ? nozzles : [{ x: 0, y: 0, z: rearZ }]
      const key = `${nozzleList.length}:${nozzleList.map((n) => `${n.x.toFixed(2)},${n.y.toFixed(2)}`).join('|')}`
      if (key !== cachedNozzleKey) {
        cachedNozzleKey = key
        thrustStreaks.resetNozzles?.()
        cruiseStreaks.resetNozzles?.()
      }
      const worldNozzles = ensureNozzleWorld(nozzleList, shipPos, shipQuat)
      // Also keep a center rear for single-origin fallback paths.
      rearOrigin.copy(worldNozzles[0])

      const nCount = nozzleList.length
      // Slight total rate boost for multi-engine so each nacelle still reads.
      const rateBoost = 0.9 + 0.12 * Math.min(nCount, 4)
      // Tighter per-nozzle spread so dual/quad plumes stay distinct.
      const puffSpread = nCount > 1 ? 0.55 : 1.05
      const streakSpread = nCount > 1 ? 0.35 : 0.7

      rearPuff.update(
        dt,
        accelActive && !cruiseActive,
        worldNozzles,
        back,
        50 * rateBoost,
        8.5,
        puffSpread
      )
      frontPuff.update(dt, brakeActive, frontOrigin, forward, 28, 7, 0.9)
      thrustStreaks.update(
        dt,
        accelActive && !cruiseActive,
        shipPos,
        shipQuat,
        rearZ,
        18,
        4.0,
        streakSpread,
        nozzleList
      )
      cruiseStreaks.update(
        dt,
        cruiseActive,
        shipPos,
        shipQuat,
        rearZ,
        140,
        70,
        nCount > 1 ? 2.5 : 5,
        nozzleList
      )

      const strafing = strafeX !== 0 || strafeY !== 0
      if (strafing) {
        sideDir.set(0, 0, 0)
        if (strafeX) sideDir.addScaledVector(right, -strafeX)
        if (strafeY) sideDir.addScaledVector(up, -strafeY)
        if (sideDir.lengthSq() > 1e-6) sideDir.normalize()
        sideOrigin
          .copy(shipPos)
          .addScaledVector(right, strafeX * halfW)
          .addScaledVector(up, strafeY * halfW * 0.6)
      }
      sidePuff.update(dt, strafing, sideOrigin, sideDir, 48, 16, 1.5)

      tunnelBurst.update(dt, false, shipPos, forward, 0, 0, 0)
    },
    stopCruiseStreaks() {
      cruiseStreaks.stop()
    },
    playTunnelBurst(fromPos, toPos) {
      const from = new THREE.Vector3(...fromPos)
      const to = new THREE.Vector3(...toPos)
      const dir = to.clone().sub(from)
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
      else dir.normalize()
      const mid = from.clone().lerp(to, 0.5)
      tunnelBurst.burst(mid, dir, 36, 90, 18)
      tunnelBurst.burst(from, dir, 12, 40, 10)
    }
  }
}
