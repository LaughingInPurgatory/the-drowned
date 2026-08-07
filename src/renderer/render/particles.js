/**
 * Shared particle helpers: a round glow sprite and a pooled puff emitter.
 *
 * These used to draw engine plumes. Boats leave a wake instead
 * (render/wake.js), but damage smoke, torpedo trails and the salvage scoop are
 * all built from the same two pieces, so they live here.
 *
 * `createPuffEmitter` used to be a `THREE.Points`. On WebGPU that is
 * `GPUPrimitiveTopology.PointList`, whose primitives are **always one pixel** —
 * `size`, `sizeAttenuation` and the glow map were all silently discarded, so
 * every puff this emitter has ever drawn was a single pixel. It now runs on the
 * instanced billboard pool in `vfxParticles.js`; the API is unchanged so callers
 * did not have to move.
 */
import * as THREE from 'three'
import { createSpriteField, createSpriteMaterial, puffMask } from './vfxParticles.js'
import { float, vec4, smoothstep, mix, pow } from 'three/tsl'

/**
 * Puff materials are shared across every emitter — colour is per-particle
 * (`iTint`), so the only thing that actually varies is the blend mode. Two
 * materials for the whole game instead of three per damaged hull.
 */
const _puffMats = new Map()
export function puffMaterial(additive) {
  const key = additive ? 'add' : 'normal'
  let m = _puffMats.get(key)
  if (m) return m
  m = createSpriteMaterial({
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
    shade: ({ q, life: k, seed, tint }) => {
      // Erode the puff from the outside in as it ages, so it shreds rather than
      // fading as a disc.
      const mask = puffMask(q, seed, k.mul(0.5))
      const birth = smoothstep(float(0), float(0.09), k)
      const decay = pow(float(1).sub(k), float(1.7))
      // Hot cores cool as they expand — smoke greys out, flame drops to ember.
      const col = mix(tint.mul(1.35), tint.mul(0.55), pow(k, float(0.7)))
      return vec4(col, mask.mul(birth).mul(decay).mul(0.85))
    }
  })
  _puffMats.set(key, m)
  return m
}

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
export function createPuffEmitter(
  count,
  color,
  size,
  texture,
  { life = 0.28, additive = true, gravity = 0, buoyancy = 0, wind = 0, drag = 4.2, grow = 1.4 } = {}
) {
  void texture // procedural now — the glow map only existed to shape a point sprite
  const field = createSpriteField({
    capacity: count,
    material: puffMaterial(additive),
    renderOrder: 3,
    name: 'puff-emitter'
  })

  const dir = new THREE.Vector3()
  let spawnAccumulator = 0
  let nozzleCursor = 0
  const maxLife = life

  function spawnAt(origin, dirWorld, speed, spread, jitterPos) {
    dir
      .copy(dirWorld)
      .multiplyScalar(speed * (0.75 + Math.random() * 0.5))
      .add(
        _spreadJitter.set(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread
        )
      )
    field.emit({
      position: [
        origin.x + (jitterPos ? (Math.random() - 0.5) * spread : 0),
        origin.y + (jitterPos ? (Math.random() - 0.5) * spread : 0),
        origin.z + (jitterPos ? (Math.random() - 0.5) * spread : 0)
      ],
      velocity: [dir.x, dir.y, dir.z],
      size: size * (0.55 + Math.random() * 0.6),
      grow: size * grow,
      life: maxLife * (0.75 + Math.random() * 0.5),
      tint: color,
      drag,
      gravity,
      buoyancy,
      wind
    })
  }

  return {
    mesh: field.mesh,
    /**
     * @param {THREE.Vector3|THREE.Vector3[]} originWorld single origin or multi-nozzle list
     */
    update(dt, active, originWorld, dirWorld, spawnRate, speed, spread) {
      const origins = Array.isArray(originWorld) ? originWorld : null
      if (active) {
        spawnAccumulator += dt * spawnRate
        while (spawnAccumulator >= 1) {
          spawnAccumulator -= 1
          spawnAt(
            origins ? origins[nozzleCursor++ % origins.length] : originWorld,
            dirWorld,
            speed,
            spread,
            false
          )
        }
      } else {
        spawnAccumulator = 0
      }
      field.update(dt, this.env || null)
    },
    /** Ambient wind / sea clearance for the next update — see createSpriteField. */
    env: null,
    burst(originWorld, dirWorld, countBurst, speed, spread) {
      for (let n = 0; n < countBurst; n++) {
        spawnAt(originWorld, dirWorld, speed * (0.5 + Math.random()), spread * 2, true)
      }
    },
    reset: field.reset,
    dispose: field.dispose
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
