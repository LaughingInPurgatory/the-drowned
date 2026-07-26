import * as THREE from 'three'
import { mulberry32, range } from '../procgen/prng.js'
import { getSurfaceTextures } from './textures.js'
import { oreTierForSystem } from '../game/mining.js'
import { MINED_ORE_GOOD_IDS } from '../data/goods.js'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const ROCK_COUNT = 18
// Keep rock centers at least this multiple of (rA+rB) apart so belts don't
// look like a clump of overlapping balls.
const MIN_SEP_MUL = 1.55

// Seeded from the body's id so the same field always scatters the same
// rocks. Spread matches body.radius (field extent for targeting / spawn
// clearance). Flight collision uses each rock individually — see collision.js.
// Exported so main.js targeting and game/collision.js share one rock layout.
// Cached on the body — regenerating every projectile/frame was a belt combat hitch.
export function getAsteroidRocks(body) {
  if (!body) return []
  if (body._asteroidRocks) return body._asteroidRocks

  const rng = mulberry32(hashString(body.id))
  // Field scatter radius (procgen ~180–320×system scale).
  const spread = Math.max(80, body.radius ?? 120)
  // Smaller vs field so packing has room (was 10–28% → overcrowded).
  const rMin = Math.max(8, spread * 0.035)
  const rMax = Math.max(rMin + 3, spread * 0.09)
  // Anomaly ore fields roll a smaller, variable rock count (6–15); normal
  // fields keep the fixed ROCK_COUNT.
  const rockCount = body.rockCount ?? ROCK_COUNT

  const rocks = []
  for (let i = 0; i < rockCount; i++) {
    const radius = range(rng, rMin, rMax)
    // Non-uniform axes → elongated / potato silhouettes after scale.
    const scale = [
      range(rng, 0.5, 1.55),
      range(rng, 0.45, 1.6),
      range(rng, 0.5, 1.55)
    ]
    const collR = radius * Math.max(scale[0], scale[1], scale[2])

    let position = null
    for (let attempt = 0; attempt < 48; attempt++) {
      // Slightly larger placement volume so separation succeeds more often.
      const place = spread * 1.05
      const p = [
        range(rng, -place, place),
        range(rng, -place, place) * 0.22,
        range(rng, -place, place)
      ]
      let ok = true
      for (const other of rocks) {
        const dx = p[0] - other.position[0]
        const dy = p[1] - other.position[1]
        const dz = p[2] - other.position[2]
        const need = (collR + other.collisionRadius) * MIN_SEP_MUL
        if (dx * dx + dy * dy + dz * dz < need * need) {
          ok = false
          break
        }
      }
      if (ok) {
        position = p
        break
      }
    }
    // Last resort: push outward along a random azimuth so we still get a rock.
    if (!position) {
      const a = rng() * Math.PI * 2
      const r = spread * (0.55 + rng() * 0.5)
      position = [Math.cos(a) * r, range(rng, -spread * 0.1, spread * 0.1), Math.sin(a) * r]
    }

    rocks.push({
      radius,
      position,
      rotation: [range(rng, 0, Math.PI), range(rng, 0, Math.PI), range(rng, 0, Math.PI)],
      // Prefer full scale vector; keep scaleY for older callers / collision helper.
      scale,
      scaleY: scale[1],
      collisionRadius: collR
    })
  }
  body._asteroidRocks = rocks
  return rocks
}

// Base albedo tint per mined-ore tier (system coreFraction → ore type).
// Rock PBR maps multiply this color so richer ores read warmer/colder.
const ORE_TINT = {
  raw_ore: new THREE.Color(0x8a8274), // dull grey-brown
  rich_ore: new THREE.Color(0xb87333), // copper / iron
  exotic_ore: new THREE.Color(0x3d9b78), // green mineral
  quantum_ore: new THREE.Color(0x7b4fc4) // violet
}

function tintForOreTier(oreId, rockIndex, fieldId) {
  const base = (ORE_TINT[oreId] ?? ORE_TINT.raw_ore).clone()
  // Mild per-rock variation so the belt isn't a flat paint job.
  const rng = mulberry32(hashString(`${fieldId}:tint:${rockIndex}`))
  const jitter = (rng() - 0.5) * 0.12
  base.offsetHSL(jitter * 0.15, jitter * 0.2, jitter * 0.18)
  return base
}

// Cheap multi-octave noise on the unit sphere for lumpy rock surfaces.
function rockNoise(nx, ny, nz, o) {
  let n = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < 3; i++) {
    n +=
      amp *
      Math.sin(nx * (2.9 + i) * freq + o[0]) *
      Math.cos(ny * (3.4 + i) * freq + o[1]) *
      Math.sin(nz * (2.6 + i) * freq + o[2])
    norm += amp
    amp *= 0.55
    freq *= 2.05
  }
  return n / norm
}

/**
 * Icosahedron pushed into an irregular rock (not a smooth ball).
 * amount ≈ peak fractional radial displacement.
 */
function buildLumpyRockGeometry(radius, seed, amount = 0.32) {
  const rng = mulberry32(seed)
  const offsets = [rng() * 12, rng() * 12, rng() * 12]
  // detail 2: enough verts for real lumps without planet-level cost.
  const geometry = new THREE.IcosahedronGeometry(radius, 2)
  const pos = geometry.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
    const n = rockNoise(v.x, v.y, v.z, offsets)
    // Asymmetric: ridges + pits, not a uniform "blobby sphere".
    const bump = 1 + n * amount + Math.abs(n) * amount * 0.35
    v.multiplyScalar(radius * bump)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
  return geometry
}

/**
 * @param {object} body asteroidField body
 * @param {object} [system] current system — picks ore-tier tint via coreFraction
 */
export function buildAsteroidFieldMesh(body, system = null) {
  const oreId =
    body.oreOverride ?? (system != null ? oreTierForSystem(system) : MINED_ORE_GOOD_IDS[0])
  const maps = getSurfaceTextures('rocky') ?? {}
  const group = new THREE.Group()

  getAsteroidRocks(body).forEach((rock, i) => {
    // Per-rock material so ore tint + slight variation show; maps are shared GPU textures.
    const material = new THREE.MeshStandardMaterial({
      color: tintForOreTier(oreId, i, body.id),
      roughness: 0.94,
      metalness: oreId === 'quantum_ore' ? 0.22 : oreId === 'rich_ore' ? 0.14 : 0.05,
      // Flat faces read more like fractured rock than smooth moons.
      flatShading: true,
      ...maps,
      normalScale: maps.normalMap ? new THREE.Vector2(1.1, 1.1) : undefined
    })
    const geo = buildLumpyRockGeometry(
      rock.radius,
      hashString(`${body.id}:rock:${i}`),
      0.28 + (hashString(`${body.id}:amt:${i}`) % 1000) / 1000 * 0.18
    )
    const mesh = new THREE.Mesh(geo, material)
    mesh.position.set(...rock.position)
    mesh.rotation.set(...rock.rotation)
    const s = rock.scale ?? [1, rock.scaleY ?? 1, 1]
    mesh.scale.set(s[0], s[1], s[2])
    group.add(mesh)
  })

  return group
}
