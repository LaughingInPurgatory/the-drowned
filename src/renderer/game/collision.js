import * as THREE from 'three'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'

// Stations: player shell is 500m so you can fly in close for docking.
// Visual bulk is larger (STATION_SCALE); orbital packing uses a bigger
// clearance in galaxy.js so stations don't spawn through each other.
// Settlements stay modest — not part of the station behemoth pass.
const STATION_COLLISION_RADIUS = 500
const SETTLEMENT_COLLISION_RADIUS = 72

// Exterior hang / undock shells — must clear *visual* bulk, not just the tight
// flight collision sphere. Free-model stations normalize to maxDim ~26–30,
// then main.js applies STATION_SCALE (190) × per-body variance 0.85–1.15:
//   half-extent ≈ 30 * 190 * 1.15 / 2 ≈ 3278
// Settlements use SETTLEMENT_SCALE (~9.28) the same way:
//   half-extent ≈ 30 * 9.28 * 1.15 / 2 ≈ 160
// Pads cover beacons, solar arms, and ship half-length.
export const STATION_EXTERIOR_RADIUS = 3400
export const SETTLEMENT_EXTERIOR_RADIUS = 200

/**
 * Shell used for targeting, spawn clearance, orbital capture, etc.
 * Asteroid *fields* still report body.radius (scatter extent) here — flight
 * physics does not use that shell; see resolveBodyCollisions (per-rock only).
 */
export function collisionRadiusFor(body) {
  if (body.kind === 'planet' || body.kind === 'moon' || body.kind === 'asteroidField') return body.radius
  if (body.kind === 'warpGate') return body.radius ?? 140
  if (body.kind === 'station') return STATION_COLLISION_RADIUS
  if (body.kind === 'settlement') return SETTLEMENT_COLLISION_RADIUS
  return null
}

/**
 * Shell used for dock exterior hang / undock exit so the ship is not placed
 * inside station or settlement mesh. Flight collision stays tighter via
 * collisionRadiusFor so players can still fly in close to dock.
 */
export function exteriorRadiusFor(body) {
  if (body.kind === 'station') return STATION_EXTERIOR_RADIUS
  if (body.kind === 'settlement') return SETTLEMENT_EXTERIOR_RADIUS
  return collisionRadiusFor(body)
}

/**
 * Solid shell NPCs must stay outside of (spawn + AI). Uses visual exterior
 * for stations/settlements so they are not buried in free-model geometry.
 * Asteroid fields are skipped (sparse rocks, not a solid ball).
 */
export function npcExclusionRadiusFor(body) {
  if (!body) return null
  if (body.kind === 'asteroidField') return null
  if (body.kind === 'warpGate') return null
  if (body.kind === 'station' || body.kind === 'settlement') return exteriorRadiusFor(body)
  if (body.kind === 'planet' || body.kind === 'moon') {
    const r = body.radius
    return r != null && Number.isFinite(r) ? r : null
  }
  if (body.kind === 'star') {
    const r = body.radius
    return r != null && Number.isFinite(r) ? r : 16000
  }
  return exteriorRadiusFor(body)
}

/** Default exclusion radius around system origin (local sun / primary). */
export const STAR_NPC_EXCLUSION_RADIUS = 16000

/** Effective sphere radius for a rock mesh (lumpy icosa + non-uniform scale). */
export function rockCollisionRadius(rock) {
  if (rock.collisionRadius != null) return rock.collisionRadius
  const s = rock.scale
  if (Array.isArray(s) && s.length >= 3) {
    return rock.radius * Math.max(s[0], s[1], s[2], 1)
  }
  // Legacy scaleY-only rocks.
  return rock.radius * Math.max(1, rock.scaleY ?? 1)
}

function pushOutOfSphere(shipPos, shipState, center, solidRadius, shipRadius) {
  const offset = shipPos.clone().sub(center)
  let dist = offset.length()
  const minDist = solidRadius + shipRadius
  if (dist >= minDist) return false

  // Buried at exact center — pick a default outward axis.
  const normal = dist < 1e-8 ? new THREE.Vector3(1, 0, 0) : offset.multiplyScalar(1 / dist)
  shipPos.copy(center).addScaledVector(normal, minDist)
  shipState.position = shipPos.toArray()

  const velocity = new THREE.Vector3().fromArray(shipState.velocity)
  const inward = velocity.dot(normal)
  if (inward < 0) {
    velocity.addScaledVector(normal, -inward)
    shipState.velocity = velocity.toArray()
  }
  return true
}

/**
 * Collide the ship with individual rocks in an asteroid field (not the field
 * bounding shell). Optional isRockAlive(fieldId, index) skips depleted rocks.
 */
function resolveAsteroidFieldCollisions(shipState, shipPos, body, shipRadius, isRockAlive) {
  const fieldPos = body.position
  const rocks = getAsteroidRocks(body)
  for (let i = 0; i < rocks.length; i++) {
    if (isRockAlive && !isRockAlive(body.id, i)) continue
    const rock = rocks[i]
    const center = new THREE.Vector3(
      fieldPos[0] + rock.position[0],
      fieldPos[1] + rock.position[1],
      fieldPos[2] + rock.position[2]
    )
    pushOutOfSphere(shipPos, shipState, center, rockCollisionRadius(rock), shipRadius)
  }
}

// Sphere-sphere collision against system bodies: pushes the ship back to the
// surface and cancels the velocity component pointing into the body, so
// flying into something slides you along its surface rather than damaging
// you or letting you pass through.
// Asteroid fields: per-rock only (no field-wide invisible shell).
// options.isRockAlive(fieldId, index) — optional; when set, destroyed rocks are ignored.
export function resolveBodyCollisions(shipState, bodies, shipRadius, options = {}) {
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  const isRockAlive = options.isRockAlive

  for (const body of bodies) {
    if (body.kind === 'asteroidField') {
      resolveAsteroidFieldCollisions(shipState, shipPos, body, shipRadius, isRockAlive)
      continue
    }
    // Warp gates are hollow portals — fly through, no solid bounce.
    if (body.kind === 'warpGate') continue

    const bodyRadius = collisionRadiusFor(body)
    if (bodyRadius == null) continue

    const bodyPos = new THREE.Vector3(...body.position)
    pushOutOfSphere(shipPos, shipState, bodyPos, bodyRadius, shipRadius)
  }
}

// Supercruise: instead of bouncing off a body, tunnel straight through along
// travel direction and exit the far side. Destination body (and host shells
// that contain it — surface settlements) are left alone so arrival works.
// Asteroid fields are skipped (no field shell); rocks are not tunneled.
// Returns event info for VFX/SFX, or null.
// ignoreBodyIds: optional Set of body ids to never tunnel through.
export function trySupercruiseTunnel(
  shipState,
  bodies,
  shipRadius,
  destinationBodyId = null,
  ignoreBodyIds = null
) {
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  const velocity = new THREE.Vector3().fromArray(shipState.velocity)
  let dir = velocity.lengthSq() > 1e-4
    ? velocity.clone().normalize()
    : new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(shipState.quaternion))

  for (const body of bodies) {
    if (destinationBodyId && body.id === destinationBodyId) continue
    if (ignoreBodyIds?.has(body.id)) continue
    // Belts have no solid field shell — fly through; individual rocks are tiny
    // at cruise speed and are not worth tunnel VFX.
    if (body.kind === 'asteroidField') continue
    if (body.kind === 'warpGate') continue

    const bodyRadius = collisionRadiusFor(body)
    if (bodyRadius == null) continue

    const bodyPos = new THREE.Vector3(...body.position)
    const offset = shipPos.clone().sub(bodyPos)
    const dist = offset.length()
    const minDist = bodyRadius + shipRadius
    if (dist >= minDist || dist === 0) continue

    // Exit just past the far shell along travel dir.
    const exitDist = bodyRadius + shipRadius + 24
    const exit = bodyPos.clone().addScaledVector(dir, exitDist)
    const from = shipPos.toArray()
    shipState.position = exit.toArray()
    // Keep cruise velocity; slight boost so you don't re-intersect next frame.
    if (velocity.lengthSq() > 1e-4) {
      velocity.setLength(Math.max(velocity.length(), 40))
      shipState.velocity = velocity.toArray()
    }
    return { body, from, to: exit.toArray() }
  }
  return null
}
