import * as THREE from 'three'
import { collisionRadiusFor } from './collision.js'
import { headingOf, applySeaAttitude } from './flight.js'
import { snapToSea } from '../world/sea.js'
import { islandShorelineToward } from '../render/islandMesh.js'

/**
 * Cruise Control. Holds the current heading at normal top speed until the
 * player turns it off. Not waypoint navigation and not a speed boost — same
 * pace as holding W. A/D still helm; no automatic obstacle avoidance.
 */
/** @deprecated name kept for call sites / tests; cruise has no speed boost. */
export const AUTOPILOT_SPEED_MULTIPLIER = 1
/** Seconds to work up to full cruise speed after engaging. */
export const AUTOPILOT_RAMP_UP_S = 1.2
/** Default clearance used by obstacle aiming when no arrival ring applies. */
export const DEFAULT_ARRIVAL_RANGE = 60

/** How far ahead along the track to look for something solid. */
const LOOK_AHEAD = 3000
/** Extra water to leave between the hull and whatever it is passing. */
const AVOID_MARGIN = 90
/** How far past the obstruction to aim, so it clears rather than orbits. */
const AVOID_LEAD = 0.75
/** Floor on approach speed, so it always creeps the last few metres in. */
const APPROACH_MIN = 0.08
/** How long the boat spends shedding way before arrival (legacy waypoint path). */
const DECEL_TRAVEL_S = 2.5
/** Bounds on that, so a very slow or very fast hull still eases in sensibly. */
const DECEL_MIN = 120
const DECEL_MAX = 600
/** Inside this, run straight in — otherwise a harbour against its own island
 *  is circled forever by the avoidance. */
const FINAL_APPROACH_MUL = 3.5
const FINAL_APPROACH_MIN = 400

const _pathDir = new THREE.Vector3()
const _toBody = new THREE.Vector3()
const _closest = new THREE.Vector3()
const _lateral = new THREE.Vector3()
const _avoidAim = new THREE.Vector3()
const _bodyPos = new THREE.Vector3()
const _destPos = new THREE.Vector3()

function copyPos(vec, pos) {
  if (Array.isArray(pos)) vec.set(pos[0], pos[1], pos[2])
  else vec.copy(pos)
  return vec
}

function smoothstep01(t) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

export function autopilotRampUpFactor(elapsedS) {
  return smoothstep01((elapsedS ?? 0) / AUTOPILOT_RAMP_UP_S)
}

/**
 * How much of full speed to use, given how far there is still to run.
 * Kept for tests / any residual waypoint callers — cruise control does not
 * decelerate for a destination.
 */
export function autopilotApproachFactor(dist, arrivalRange, topSpeed) {
  const decelDistance = Math.max(DECEL_MIN, Math.min(DECEL_MAX, topSpeed * DECEL_TRAVEL_S))
  const remaining = Math.max(0, dist - arrivalRange)
  return Math.min(1, Math.max(APPROACH_MIN, remaining / decelDistance))
}

/**
 * True when a body should not be treated as an obstruction: it *is* the
 * destination, or the destination sits against it (a coastal harbour and the
 * island it is built on). Steering around those would mean never arriving.
 */
export function ignoreBodyAsCruiseObstacle(body, destPos, destBodyId = null, arrivalRange = 60) {
  if (destBodyId && body.id === destBodyId) return true
  if (!destPos) return false
  const bodyRadius = collisionRadiusFor(body)
  if (bodyRadius == null) return false
  _bodyPos.fromArray(body.position)
  copyPos(_destPos, destPos)
  const d = _bodyPos.distanceTo(_destPos)
  return d <= bodyRadius + arrivalRange + AVOID_MARGIN
}

/**
 * Give way to land. Finds the nearest thing the straight track would run into
 * and returns an aim point offset to whichever side is closer to clear, so the
 * boat sweeps past instead of grinding along a shore.
 *
 * Returns `targetPos` unchanged when the water ahead is clear.
 */
export function aimAroundObstacles(
  shipPos,
  targetPos,
  bodies,
  shipRadius,
  destinationBodyId = null,
  destPos = null,
  arrivalRange = DEFAULT_ARRIVAL_RANGE
) {
  if (!bodies?.length) return targetPos

  _pathDir.subVectors(targetPos, shipPos)
  _pathDir.y = 0
  const distToTarget = _pathDir.length()
  if (distToTarget < 1e-3) return targetPos
  _pathDir.divideScalar(distToTarget)

  // Close in, commit to the approach — except for islands/land: those still
  // steer around the shoreline so cruise never runs you aground.
  const finalApproach = Math.max(FINAL_APPROACH_MIN, arrivalRange * FINAL_APPROACH_MUL)
  const commitApproach = destPos != null && distToTarget <= finalApproach

  const scan = Math.min(distToTarget, LOOK_AHEAD)
  let worst = null
  let worstAlong = Infinity

  for (const body of bodies) {
    let bodyRadius = collisionRadiusFor(body)
    if (bodyRadius == null) continue
    if (ignoreBodyAsCruiseObstacle(body, destPos ?? targetPos, destinationBodyId, arrivalRange)) continue
    // Final approach only ignores non-land so harbours remain reachable.
    if (commitApproach && body.kind !== 'island') continue

    _bodyPos.fromArray(body.position)
    _toBody.subVectors(_bodyPos, shipPos)
    _toBody.y = 0
    const along = _toBody.dot(_pathDir)
    // Behind us, or beyond where we are looking.
    if (along <= 0 || along > scan) continue

    // Use the shoreline toward the track for islands (not the max disc).
    if (body.kind === 'island') {
      const cx = shipPos.x + _pathDir.x * along
      const cz = shipPos.z + _pathDir.z * along
      bodyRadius = islandShorelineToward(body, cx, cz)
    }
    const clearance = bodyRadius + shipRadius + AVOID_MARGIN
    _closest.copy(shipPos).addScaledVector(_pathDir, along)
    const lateralDist = Math.hypot(_closest.x - _bodyPos.x, _closest.z - _bodyPos.z)
    if (lateralDist >= clearance) continue

    // Nearest blocker wins — clearing it usually clears the rest too, and the
    // next frame re-runs this anyway.
    if (along < worstAlong) {
      worstAlong = along
      worst = { bodyPos: _bodyPos.clone(), clearance, lateralDist }
    }
  }

  if (!worst) return targetPos

  // Push off to whichever side the boat is already favouring, so it does not
  // cut back across its own bow.
  _lateral.set(-_pathDir.z, 0, _pathDir.x)
  const side = _lateral.dot(
    _avoidAim.set(shipPos.x - worst.bodyPos.x, 0, shipPos.z - worst.bodyPos.z)
  )
  const sign = side >= 0 ? 1 : -1

  // Aim past the far edge of the shell, a little beyond it so the turn actually
  // clears rather than tracking the shell round.
  _avoidAim
    .copy(worst.bodyPos)
    .addScaledVector(_lateral, sign * worst.clearance * (1 + AVOID_LEAD))
    .addScaledVector(_pathDir, worst.clearance * AVOID_LEAD)
  _avoidAim.y = 0
  return _avoidAim
}

/**
 * One frame of Cruise Control. Holds speed on the current course; never
 * “arrives”. Returns false always (caller disengages on toggle, combat, or
 * thrust/strafe input — W/S/Q/E).
 *
 * A/D still work: helm to port/starboard while under way. Pass the live key
 * set as `keys` so the player can steer without cancelling cruise.
 * No automatic land avoidance — course is straight ahead until you turn or cancel.
 *
 * @param {object|null} skillOpts player-only: { speedMult, turnMult }
 * @param {Set<string>|null} keys keyboard codes; only KeyA / KeyD are read
 * @param {number} [simTime]
 * @param {unknown} [_bodies] unused (kept so call sites stay stable)
 * @param {unknown} [_shipRadius] unused
 */
export function updateCruiseControl(
  shipState,
  shipClass,
  dt,
  _bodies = null,
  _shipRadius = 0,
  skillOpts = null,
  simTime = 0,
  keys = null
) {
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  let heading = headingOf(shipState)
  const turnMult = skillOpts?.turnMult ?? 1
  const speedMult = skillOpts?.speedMult ?? 1
  const turnRate = shipClass.stats.turnRate * turnMult

  // A/D helm only — no AI steering. Same rudder model as flight.js.
  let helm = 0
  if (keys?.has?.('KeyA')) helm += 1
  if (keys?.has?.('KeyD')) helm -= 1
  if (helm !== 0) {
    const velocityNow = new THREE.Vector3().fromArray(shipState.velocity)
    velocityNow.y = 0
    const topForAuth = Math.max(1e-3, shipClass.stats.speed * speedMult)
    const way = Math.min(1, velocityNow.length() / (topForAuth * 0.25))
    const authority = 0.55 + 0.45 * way
    // Match flight.js RUDDER_RATE * 60 * dt scaling.
    heading += helm * 0.028 * turnRate * authority * dt * 60
    shipState.heading = heading
  }

  const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
  const velocity = new THREE.Vector3().fromArray(shipState.velocity)
  velocity.y = 0

  shipState.supercruiseElapsed = (shipState.supercruiseElapsed ?? 0) + dt
  const rampUp = autopilotRampUpFactor(shipState.supercruiseElapsed)

  // No speed boost — same top end as holding W (plus skill speedMult only).
  const topSpeed = shipClass.stats.speed * speedMult
  const maxSpeed = topSpeed * rampUp

  const accel = shipClass.stats.accel * 2.5 * Math.max(0.15, rampUp)
  velocity.addScaledVector(forward, accel * dt)
  const dragK = accel / Math.max(1e-3, topSpeed)
  velocity.multiplyScalar(1 / (1 + dragK * dt))
  if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed)

  const position = shipPos.addScaledVector(velocity, dt)

  shipState.position = position.toArray()
  shipState.velocity = velocity.toArray()
  // Throttle readout matches “full ahead under cruise”.
  shipState.throttle = rampUp
  snapToSea(shipState, simTime)
  applySeaAttitude(shipState, heading, simTime)
  return false
}

/** Keys that cancel Cruise Control (thrust / thrusters — not helm A/D). */
export function cruiseCancelKeysHeld(keys) {
  if (!keys?.has) return false
  return keys.has('KeyW') || keys.has('KeyS') || keys.has('KeyQ') || keys.has('KeyE')
}

/**
 * Legacy name — Cruise Control no longer steers to a waypoint. If a target
 * position is supplied, it is ignored; course is held instead.
 * Prefer `updateCruiseControl`.
 */
export function updateAutopilot(
  shipState,
  shipClass,
  _targetPosition,
  dt,
  _arrivalRange = DEFAULT_ARRIVAL_RANGE,
  bodies = null,
  shipRadius = 0,
  _destinationBodyId = null,
  skillOpts = null,
  simTime = 0
) {
  return updateCruiseControl(shipState, shipClass, dt, bodies, shipRadius, skillOpts, simTime)
}
