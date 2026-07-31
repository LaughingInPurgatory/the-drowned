import * as THREE from 'three'
import { mulberry32, range } from '../procgen/prng.js'
import { oreTierForField } from '../game/mining.js'
import { getShipClass } from '../data/shipClasses.js'
import { buildShipMesh } from './shipMesh.js'

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
const asteroidRockCache = new WeakMap()

export function getAsteroidRocks(body) {
  if (!body) return []
  const cached = asteroidRockCache.get(body)
  if (cached) return cached

  const rng = mulberry32(hashString(body.id))
  // Field scatter radius (procgen ~180–320×system scale).
  const spread = Math.max(80, body.radius ?? 120)
  // Smaller vs field so packing has room (was 10–28% → overcrowded).
  const rMin = Math.max(8, spread * 0.035)
  const rMax = Math.max(rMin + 3, spread * 0.09)
  // Anomaly ore fields roll a smaller, variable rock count (6–15); normal
  // fields keep the fixed ROCK_COUNT.
  const rockCount = body.rockCount ?? ROCK_COUNT

  /**
   * Where a hulk floats.
   *
   * A wreck is a *wreck*: it is on the bottom, or awash, or aground on the
   * shoal. What it must never be is hanging clear of the water with daylight
   * under it, which is what a symmetric scatter around y = 0 produced — a few
   * per field ended up entirely above the surface.
   *
   * So the vertical placement is measured from the hulk's own size: the top of
   * it lands somewhere between well submerged and standing most of the way
   * proud, and never higher.
   */
  const settleDepth = (collR) => range(rng, -collR * 1.35, -collR * 0.12)

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
      const p = [range(rng, -place, place), settleDepth(collR), range(rng, -place, place)]
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
      position = [Math.cos(a) * r, settleDepth(collR), Math.sin(a) * r]
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
  // Cached off the body for the same reason as the island profile: the world
  // is cloned wholesale on save (see render/islandMesh.js).
  asteroidRockCache.set(body, rocks)
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

const WRECK_CLASS_IDS = ['light_runner', 'bravia_mk2', 'hold_runner', 'gun_barge']

/** Turn a normal ship mesh into an inert, corroded casualty. */
function weatherShipIntoWreck(ship, tint) {
  // A wreck keeps the useful hull/superstructure silhouette but no weapon or
  // navigation-light clutter. This is visual-only; salvage collision remains
  // the pre-existing rock layout below.
  ship.remove(ship.userData.turret?.yawGroup)
  for (const lamp of ship.userData.runningLights?.meshes ?? []) lamp.visible = false

  const rust = new THREE.Color(tint).lerp(new THREE.Color(0x38261d), 0.58)
  ship.traverse((part) => {
    if (!part.isMesh) return
    if (part.material?.isMeshBasicMaterial) {
      part.visible = false
      return
    }
    const materials = Array.isArray(part.material) ? part.material : [part.material]
    for (const material of materials) {
      if (!material?.color) continue
      material.color.lerp(rust, 0.7)
      material.roughness = Math.max(material.roughness ?? 0, 0.92)
      material.metalness = Math.min(material.metalness ?? 0.5, 0.42)
      if (material.emissive) material.emissive.set(0)
    }
    part.castShadow = true
    part.receiveShadow = true
  })
}

/**
 * A stranded vessel in one of three readable failure states: listing, rolled,
 * or bow-down. Reusing the production hull builder keeps the silhouettes
 * consistent with ships the player encounters elsewhere in the world.
 */
function buildWreckShip(rng, size, tint) {
  const ship = buildShipMesh(getShipClass(WRECK_CLASS_IDS[Math.floor(rng() * WRECK_CLASS_IDS.length)]), { lite: true })
  weatherShipIntoWreck(ship, tint)

  const box = new THREE.Box3().setFromObject(ship)
  const nativeLength = Math.max(1, box.max.z - box.min.z)
  const desiredLength = size * range(rng, 2.1, 3.35)
  ship.scale.setScalar(desiredLength / nativeLength)

  const state = Math.floor(rng() * 3)
  if (state === 0) {
    // Rolled hull: keel and underside are left above the waves.
    ship.position.y = -size * 0.32
    ship.rotation.set(range(rng, -0.18, 0.18), 0, Math.PI + range(rng, -0.25, 0.25))
  } else if (state === 1) {
    // A ship settling onto one side, bridge and mast still visible.
    ship.position.y = -size * 0.2
    ship.rotation.set(range(rng, -0.15, 0.15), 0, range(rng, 0.45, 0.95) * (rng() < 0.5 ? -1 : 1))
  } else {
    // Bow-down sinking: just enough of the stern and deckhouse remains.
    ship.position.y = -size * 0.42
    ship.rotation.set(range(rng, 0.42, 0.72), 0, range(rng, -0.2, 0.2))
  }
  return ship
}

/**
 * @param {object} body wreckField body — its position sets the salvage grade
 */
export function buildAsteroidFieldMesh(body) {
  const oreId = body.oreOverride ?? oreTierForField(body)
  const group = new THREE.Group()

  getAsteroidRocks(body).forEach((rock, i) => {
    // Per-wreck rust variation tracks the salvage grade without changing the
    // resource/collision data that the game layer uses for this field.
    const tint = tintForOreTier(oreId, i, body.id)
    const rng = mulberry32(hashString(`${body.id}:hulk:${i}`))
    const s = rock.scale ?? [1, rock.scaleY ?? 1, 1]
    const hulk = buildWreckShip(rng, rock.radius * Math.max(s[0], s[1], s[2]), tint)
    hulk.position.set(...rock.position)
    // Sit them on the waterline rather than wherever the scatter put them —
    // a wreck field is what broke the surface, not what is on the bottom.
    hulk.position.y = 0
    hulk.rotation.y = rock.rotation?.[1] ?? 0
    group.add(hulk)
  })

  return group
}
