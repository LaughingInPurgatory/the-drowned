import * as THREE from 'three'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { islandShorelineToward, islandMaxShoreline } from '../render/islandMesh.js'

// Harbour approach shell. Sized to the mesh it guards: render/harbourMesh.js
// builds a port ~50 local units across, which main.js STATION_SCALE brings to
// ~145 world units, so this leaves a boat room to come alongside without
// letting it drive through the quay.
const PORT_COLLISION_RADIUS = 120
const OUTPOST_COLLISION_RADIUS = 40

// Exterior hang / undock shells — must clear *visual* bulk, not just the tight
// collision sphere, so leaving a berth never drops you inside the jetty.
export const PORT_EXTERIOR_RADIUS = 190
export const OUTPOST_EXTERIOR_RADIUS = 75

/**
 * Shell used for targeting, spawn clearance, docking range, etc.
 * Wreck *fields* report body.radius (scatter extent) here — hull physics does
 * not use that shell; see resolveBodyCollisions (per-wreck only).
 */
export function collisionRadiusFor(body) {
  // For an island this is how far the *land* actually reaches, not the extent
  // of the disc it was generated in — a sea stack occupies a fraction of its
  // own radius, and treating the whole disc as solid would hold a boat hundreds
  // of metres off a rock it can plainly see. Grounding uses the per-bearing
  // coastline instead; see resolveBodyCollisions.
  if (body.kind === 'island') return islandMaxShoreline(body)
  if (body.kind === 'wreckField') return body.radius
  if (body.kind === 'port') return PORT_COLLISION_RADIUS
  if (body.kind === 'outpost') return OUTPOST_COLLISION_RADIUS
  return null
}

/**
 * Shell used for berth exterior hang / undock exit so the boat is not placed
 * inside harbour geometry. Running collision stays tighter via
 * collisionRadiusFor so players can still come right alongside.
 */
export function exteriorRadiusFor(body) {
  if (body.kind === 'port') return PORT_EXTERIOR_RADIUS
  if (body.kind === 'outpost') return OUTPOST_EXTERIOR_RADIUS
  return collisionRadiusFor(body)
}

/**
 * Solid shell NPCs must stay outside of (spawn + AI). Uses visual exterior for
 * harbours so they are not moored inside the jetty. Wreck fields are skipped
 * (scattered hulks, not a solid mass).
 */
export function npcExclusionRadiusFor(body) {
  if (!body) return null
  if (body.kind === 'wreckField') return null
  if (body.kind === 'port' || body.kind === 'outpost') return exteriorRadiusFor(body)
  // Same coastline the player grounds on, so NPCs use the water close inshore
  // instead of standing off the whole disc.
  if (body.kind === 'island') return islandMaxShoreline(body)
  return exteriorRadiusFor(body)
}

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

/**
 * Push a hull clear of something solid, in the horizontal plane only — a boat
 * that touches a reef sheers off along it, it does not ride up over it. The
 * vertical axis belongs to the sea (see world/sea.js snapToSea), so nothing
 * here may touch Y.
 */
function pushOutOfSphere(shipPos, shipState, center, solidRadius, shipRadius) {
  const dx = shipPos.x - center.x
  const dz = shipPos.z - center.z
  let dist = Math.hypot(dx, dz)
  const minDist = solidRadius + shipRadius
  if (dist >= minDist) return false

  // Dead centre — pick a default outward bearing.
  const nx = dist < 1e-8 ? 1 : dx / dist
  const nz = dist < 1e-8 ? 0 : dz / dist
  shipPos.x = center.x + nx * minDist
  shipPos.z = center.z + nz * minDist
  shipState.position = shipPos.toArray()

  const velocity = shipState.velocity
  // Cancel only the component driving into the obstruction, so way carried
  // along the shore is kept and the hull slides rather than stopping dead.
  const inward = velocity[0] * nx + velocity[2] * nz
  if (inward < 0) {
    velocity[0] -= inward * nx
    velocity[2] -= inward * nz
  }
  return true
}

/**
 * Collide the hull with individual hulks in a wreck field (not the field
 * bounding shell). Optional isRockAlive(fieldId, index) skips stripped wrecks.
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

// Horizontal circle-circle collision against world bodies: pushes the hull back
// off the obstruction and cancels the velocity driving into it, so running onto
// a shore sheers you along it rather than damaging you or letting you pass
// through. Wreck fields: per-hulk only (no field-wide invisible shell).
// options.isRockAlive(fieldId, index) — optional; when set, stripped wrecks are ignored.
export function resolveBodyCollisions(shipState, bodies, shipRadius, options = {}) {
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  const isRockAlive = options.isRockAlive

  for (const body of bodies) {
    if (body.kind === 'wreckField') {
      resolveAsteroidFieldCollisions(shipState, shipPos, body, shipRadius, isRockAlive)
      continue
    }

    // Islands ground on their real coastline, traced from the same height field
    // the mesh is built from (render/islandMesh.js). That is what lets a boat
    // run right up onto a beach, nose into a bay, or slip through the gap in an
    // atoll — none of which a single radius around the whole disc allows.
    let bodyRadius
    if (body.kind === 'island') {
      // Cheap reject first: nothing can be aground while outside the furthest
      // the land reaches, and this runs for every body every frame.
      const dx = shipPos.x - body.position[0]
      const dz = shipPos.z - body.position[2]
      const reach = islandMaxShoreline(body) + shipRadius
      if (dx * dx + dz * dz >= reach * reach) continue
      bodyRadius = islandShorelineToward(body, shipPos.x, shipPos.z)
    } else {
      bodyRadius = collisionRadiusFor(body)
    }
    if (bodyRadius == null) continue

    const bodyPos = new THREE.Vector3(...body.position)
    pushOutOfSphere(shipPos, shipState, bodyPos, bodyRadius, shipRadius)
  }
}
