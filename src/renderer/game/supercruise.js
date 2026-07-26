import * as THREE from 'three'
import { collisionRadiusFor } from './collision.js'

// 3× prior (12.6) for the larger systems — normal flight speeds unchanged.
export const SUPERCRUISE_MULTIPLIER = 37.8
// Time to spool from engage to full cruise cap (seconds of simTime).
export const SUPERCRUISE_RAMP_UP_S = 3
// Default for tests / callers that don't pass a body-sized range. Real play
// uses collisionRadius + ship radius + margin — a flat 60 never reaches the
// center of a large planet/station (collision stops you far outside it).
export const DEFAULT_ARRIVAL_RANGE = 60
const STEER_RATE_MULTIPLIER = 1.5

// How far along the path to scan for blocking bodies (world units).
// Scaled with the faster cruise multiplier so we still steer early.
const LOOK_AHEAD = 9600
// Extra gap beyond the collision shell when skirting an obstacle.
const AVOID_MARGIN = 40
// How far past the skirt point to aim so we don't orbit the body forever.
const AVOID_LEAD = 0.55
// Floor on approach speed factor so we always creep into the arrival sphere.
const APPROACH_MIN = 0.06
// Deceleration distance ≈ this many seconds of full-cruise travel.
const DECEL_TRAVEL_S = 2.8
// Inside this multiple of arrivalRange, stop skirting and fly straight in —
// prevents endless orbits around host planets when the waypoint is a
// surface settlement / near-shell station.
const FINAL_APPROACH_MUL = 3.5
const FINAL_APPROACH_MIN = 600

const _up = new THREE.Vector3(0, 1, 0)
const _xAxis = new THREE.Vector3(1, 0, 0)
const _pathDir = new THREE.Vector3()
const _toBody = new THREE.Vector3()
const _closest = new THREE.Vector3()
const _lateral = new THREE.Vector3()
const _avoidAim = new THREE.Vector3()
const _bodyPos = new THREE.Vector3()
const _destPos = new THREE.Vector3()

/**
 * Bodies we must not skirt/tunnel-skip around when flying to a destination:
 * the destination itself, and any body whose shell contains (or nearly
 * contains) the destination — e.g. the host planet of a surface settlement.
 * Without this, SC keeps orbiting the parent and never arrives.
 */
function copyPos(out, pos) {
  if (!pos) return null
  if (pos.isVector3) return out.copy(pos)
  return out.fromArray(pos)
}

export function ignoreBodyAsCruiseObstacle(body, destPos, destBodyId = null, arrivalRange = 60) {
  if (destBodyId && body.id === destBodyId) return true
  if (!destPos) return false
  const bodyRadius = collisionRadiusFor(body)
  if (bodyRadius == null) return false
  _bodyPos.fromArray(body.position)
  copyPos(_destPos, destPos)
  const d = _bodyPos.distanceTo(_destPos)
  // Dest sits inside / on / just outside this shell → host terrain, not a blocker.
  return d <= bodyRadius + arrivalRange + AVOID_MARGIN
}

/**
 * Path aim for supercruise. Always flies straight at the target — bodies
 * on the line are tunnelled through (arcade cruise, not a traffic sim).
 * Signature kept so main.js / tests don't need a call-site rewrite.
 */
export function aimAroundObstacles(
  shipPos,
  targetPos,
  _bodies,
  _shipRadius,
  _destinationBodyId = null,
  _destPos = null,
  _arrivalRange = 60
) {
  return targetPos
}

function smoothstep01(t) {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/**
 * Spool factor 0→1 over SUPERCRUISE_RAMP_UP_S after engage.
 * Caller should reset shipState.supercruiseElapsed = 0 when engaging.
 */
export function supercruiseRampUpFactor(elapsedS) {
  return smoothstep01((elapsedS ?? 0) / SUPERCRUISE_RAMP_UP_S)
}

/**
 * Approach factor 0→1: full speed far out, eases down near the arrival sphere.
 * Decel distance is hard-capped — giant star shells (tens of km) used to stretch
 * the old arrivalRange*6 formula into hundreds of km of crawl, then a hard stop.
 */
export function supercruiseApproachFactor(dist, arrivalRange, cruiseTopSpeed) {
  const DECEL_MAX = 12000
  // Prefer a short standoff-proportional ramp, but never more than DECEL_MAX.
  const fromArrival = Math.min(Math.max(arrivalRange * 2.2, 400), DECEL_MAX)
  const fromSpeed = Math.min(cruiseTopSpeed * DECEL_TRAVEL_S, DECEL_MAX)
  const decelDistance = Math.max(400, Math.min(DECEL_MAX, Math.max(fromArrival, fromSpeed)))
  // Distance left until the arrival sphere (not a fraction inside it).
  const remaining = Math.max(0, dist - arrivalRange)
  return Math.min(1, Math.max(APPROACH_MIN, remaining / decelDistance))
}

// Autopilot flight toward a fixed target while supercruise is engaged.
// Returns true once the ship has arrived (caller should disengage).
// arrivalRange is the distance-to-target center that counts as "there"
// (main.js sizes this off the waypoint body's collision shell).
// bodies / shipRadius / destinationBodyId retained for API compat (no skirting).
/**
 * @param {object|null} skillOpts player-only: { speedMult, cruiseMult, turnMult }
 */
export function updateSupercruise(
  shipState,
  shipClass,
  targetPosition,
  dt,
  arrivalRange = DEFAULT_ARRIVAL_RANGE,
  bodies = null,
  shipRadius = 0,
  destinationBodyId = null,
  skillOpts = null
) {
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  const targetPos = new THREE.Vector3(...targetPosition)
  const toTarget = targetPos.clone().sub(shipPos)
  const dist = toTarget.length()
  if (dist < arrivalRange) return true

  // Straight-line cruise: pass through anything on the path.
  const aimPos = aimAroundObstacles(
    shipPos,
    targetPos,
    bodies,
    shipRadius,
    destinationBodyId,
    targetPosition,
    arrivalRange
  )

  const turnMult = skillOpts?.turnMult ?? 1
  const speedMult = skillOpts?.speedMult ?? 1
  const cruiseMult = skillOpts?.cruiseMult ?? 1

  const quat = new THREE.Quaternion().fromArray(shipState.quaternion)
  // Matrix4.lookAt follows the camera convention (local +Z points away from
  // the target), but our ships' forward is +Z, so eye/target are swapped —
  // matches the same fix used for NPC AI facing in combat.js.
  const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(aimPos, shipPos, new THREE.Vector3(0, 1, 0))
  )
  quat.slerp(
    targetQuat,
    Math.min(1, shipClass.stats.turnRate * turnMult * STEER_RATE_MULTIPLIER * dt)
  )

  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
  const velocity = new THREE.Vector3().fromArray(shipState.velocity)

  // Spool-up after engage (reset supercruiseElapsed on engage in main.js).
  shipState.supercruiseElapsed = (shipState.supercruiseElapsed ?? 0) + dt
  const rampUp = supercruiseRampUpFactor(shipState.supercruiseElapsed)

  // Thrust skill: base max-v mult + dedicated supercruise mult (player only).
  const cruiseTop =
    shipClass.stats.speed * speedMult * SUPERCRUISE_MULTIPLIER * cruiseMult
  const approach = supercruiseApproachFactor(dist, arrivalRange, cruiseTop)
  const maxSpeed = cruiseTop * rampUp * approach

  // Accel scales with the allowed cap so spool-up feels smooth, not instant.
  const cruiseAccel = shipClass.stats.accel * SUPERCRUISE_MULTIPLIER * 2.5 * Math.max(0.15, rampUp)
  velocity.addScaledVector(forward, cruiseAccel * dt)
  const dragK = cruiseAccel / Math.max(1e-3, cruiseTop)
  velocity.multiplyScalar(1 / (1 + dragK * dt))
  if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed)

  const position = shipPos.addScaledVector(velocity, dt)

  shipState.position = position.toArray()
  shipState.velocity = velocity.toArray()
  shipState.quaternion = quat.toArray()
  return false
}
