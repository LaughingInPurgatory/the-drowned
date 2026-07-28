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

/**
 * Relative closing speed (m/s) above which two hulls bounce; softer contacts
 * just kill the way into each other (come to a stop / scrape along).
 * Tuned for boat speeds after SPEED_SCALE (~4–50 m/s typical).
 */
export const SHIP_BOUNCE_SPEED = 10
/** How lively a hard bump is (0 = dead stop, 1 = perfectly elastic). */
export const SHIP_BOUNCE_RESTITUTION = 0.42
/** Soft contact restitution — nearly stops the closing component. */
export const SHIP_SCRAPE_RESTITUTION = 0.05

/**
 * Ship–ship collisions in the horizontal plane. No damage — only separation
 * and a speed-dependent bounce or stop.
 *
 * Each entry: `{ ship: { position, velocity }, radius, mass? }`.
 * Equal-mass when mass is omitted. Positions/velocities are written back
 * in place. Y is never touched (the sea owns vertical).
 *
 * Call once per frame after every hull has integrated its motion for that
 * step, so the player and all live NPCs see each other.
 */
export function resolveShipCollisions(ships) {
  if (!ships || ships.length < 2) return

  for (let i = 0; i < ships.length; i++) {
    const A = ships[i]
    if (!A?.ship?.position || !A.ship.velocity) continue
    const ra = Math.max(0.5, A.radius ?? 5)
    const ma = Math.max(1e-3, A.mass ?? ra * ra)

    for (let j = i + 1; j < ships.length; j++) {
      const B = ships[j]
      if (!B?.ship?.position || !B.ship.velocity) continue
      const rb = Math.max(0.5, B.radius ?? 5)
      const mb = Math.max(1e-3, B.mass ?? rb * rb)

      const ax = A.ship.position[0]
      const az = A.ship.position[2]
      const bx = B.ship.position[0]
      const bz = B.ship.position[2]
      let dx = ax - bx
      let dz = az - bz
      let dist = Math.hypot(dx, dz)
      const minDist = ra + rb
      if (dist >= minDist) continue

      // Contact normal: from B toward A (A is pushed along +n).
      let nx
      let nz
      if (dist < 1e-8) {
        nx = 1
        nz = 0
        dist = 0
      } else {
        nx = dx / dist
        nz = dz / dist
      }

      // Separate so hulls just touch. Split by inverse mass.
      const overlap = minDist - dist
      const invMa = 1 / ma
      const invMb = 1 / mb
      const invSum = invMa + invMb
      const pushA = (overlap * invMa) / invSum
      const pushB = (overlap * invMb) / invSum
      A.ship.position[0] = ax + nx * pushA
      A.ship.position[2] = az + nz * pushA
      B.ship.position[0] = bx - nx * pushB
      B.ship.position[2] = bz - nz * pushB

      // Relative velocity of A as seen from B, along the contact normal.
      // Positive → already separating; leave the velocities alone.
      const vax = A.ship.velocity[0] ?? 0
      const vaz = A.ship.velocity[2] ?? 0
      const vbx = B.ship.velocity[0] ?? 0
      const vbz = B.ship.velocity[2] ?? 0
      const vrelN = (vax - vbx) * nx + (vaz - vbz) * nz
      if (vrelN >= 0) continue

      const closing = -vrelN
      const e = closing >= SHIP_BOUNCE_SPEED ? SHIP_BOUNCE_RESTITUTION : SHIP_SCRAPE_RESTITUTION
      // Impulse along n: changes relative normal speed to -e * vrelN.
      const impulse = (-(1 + e) * vrelN) / invSum
      A.ship.velocity[0] = vax + impulse * invMa * nx
      A.ship.velocity[2] = vaz + impulse * invMa * nz
      B.ship.velocity[0] = vbx - impulse * invMb * nx
      B.ship.velocity[2] = vbz - impulse * invMb * nz
      // Keep vertical way at zero — boats don't leap on impact.
      if (A.ship.velocity[1]) A.ship.velocity[1] = 0
      if (B.ship.velocity[1]) B.ship.velocity[1] = 0
    }
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
