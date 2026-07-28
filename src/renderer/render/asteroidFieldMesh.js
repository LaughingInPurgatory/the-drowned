import * as THREE from 'three'
import { mulberry32, range } from '../procgen/prng.js'
import { getSurfaceTextures } from './textures.js'
import { oreTierForField } from '../game/mining.js'
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

// Base albedo tint per salvage grade (field remoteness → what it yields).
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
 * One sunken hull, half out of the water.
 *
 * A wreck field is a convoy or a harbour that went down together, so what
 * breaks the surface is plate and frame — a bow standing on end, a rolled hull
 * with its bilge up, a superstructure with the deck gone. Built from boxes
 * because that is what a broken ship is: flat panels at angles they were never
 * meant to be at.
 */
function buildWreckHulk(rng, size, material, plateMaterial) {
  const hulk = new THREE.Group()
  const form = Math.floor(rng() * 3)

  if (form === 0) {
    // A bow section standing up out of the water, stem to the sky.
    const len = size * range(rng, 1.6, 2.6)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(size * 0.85, len, size * 0.7), material)
    hull.position.y = len * 0.18
    hull.rotation.set(range(rng, 0.9, 1.3), rng() * Math.PI, range(rng, -0.25, 0.25))
    hulk.add(hull)
    // Torn plate peeling off the break.
    for (let i = 0; i < 3; i++) {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(size * range(rng, 0.3, 0.7), size * 0.06, size * range(rng, 0.3, 0.8)),
        plateMaterial
      )
      plate.position.set(
        range(rng, -size * 0.5, size * 0.5),
        len * range(rng, 0.3, 0.7),
        range(rng, -size * 0.5, size * 0.5)
      )
      plate.rotation.set(rng() * 1.4, rng() * Math.PI, rng() * 1.4)
      hulk.add(plate)
    }
  } else if (form === 1) {
    // Rolled over, bilge and keel up, awash along her length.
    const len = size * range(rng, 2.2, 3.4)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(size * 0.95, size * 0.6, len), material)
    hull.position.y = -size * 0.1
    hull.rotation.set(range(rng, -0.35, 0.35), rng() * Math.PI, range(rng, 2.5, 3.6))
    hulk.add(hull)
    // The bilge keel standing proud of the water like a fin.
    const keel = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.1, size * 0.5, len * 0.7),
      plateMaterial
    )
    keel.position.set(0, size * 0.32, 0)
    keel.rotation.copy(hull.rotation)
    hulk.add(keel)
  } else {
    // A superstructure block — deck-house, funnel stub, mast still standing.
    const w = size * range(rng, 0.7, 1.0)
    const house = new THREE.Mesh(new THREE.BoxGeometry(w, size * 0.7, w * 1.2), material)
    house.position.y = size * 0.1
    house.rotation.set(range(rng, -0.3, 0.3), rng() * Math.PI, range(rng, -0.4, 0.4))
    hulk.add(house)
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(size * 0.16, size * 0.19, size * 0.55, 8),
      plateMaterial
    )
    funnel.position.set(range(rng, -w * 0.2, w * 0.2), size * 0.55, 0)
    funnel.rotation.z = range(rng, -0.5, 0.5)
    hulk.add(funnel)
    if (rng() < 0.7) {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.03, size * 0.04, size * 1.5, 5),
        plateMaterial
      )
      mast.position.set(range(rng, -w * 0.3, w * 0.3), size * 0.85, range(rng, -w * 0.3, w * 0.3))
      mast.rotation.set(range(rng, -0.6, 0.6), 0, range(rng, -0.6, 0.6))
      hulk.add(mast)
    }
  }

  hulk.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.receiveShadow = true
  })
  return hulk
}

/**
 * @param {object} body wreckField body — its position sets the salvage grade
 */
export function buildAsteroidFieldMesh(body) {
  const oreId = body.oreOverride ?? oreTierForField(body)
  const maps = getSurfaceTextures('rocky') ?? {}
  const group = new THREE.Group()

  getAsteroidRocks(body).forEach((rock, i) => {
    // Per-hulk material so the salvage grade tints it; maps are shared GPU
    // textures. Rusted plate, not stone — high roughness, real metalness.
    const tint = tintForOreTier(oreId, i, body.id)
    const material = new THREE.MeshStandardMaterial({
      color: tint,
      roughness: 0.88,
      metalness: 0.45,
      flatShading: true,
      ...maps
    })
    // Only set once we actually have a normal map — three warns on undefined.
    if (maps.normalMap) material.normalScale = new THREE.Vector2(1.1, 1.1)
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tint).multiplyScalar(0.72),
      roughness: 0.92,
      metalness: 0.5,
      flatShading: true
    })

    const rng = mulberry32(hashString(`${body.id}:hulk:${i}`))
    const s = rock.scale ?? [1, rock.scaleY ?? 1, 1]
    const hulk = buildWreckHulk(rng, rock.radius * Math.max(s[0], s[1], s[2]), material, plateMaterial)
    hulk.position.set(...rock.position)
    // Sit them on the waterline rather than wherever the scatter put them —
    // a wreck field is what broke the surface, not what is on the bottom.
    hulk.position.y = 0
    hulk.rotation.y = rock.rotation?.[1] ?? 0
    group.add(hulk)
  })

  return group
}
