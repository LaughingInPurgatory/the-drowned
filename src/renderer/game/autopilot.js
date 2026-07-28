import * as THREE from 'three'
import { collisionRadiusFor } from './collision.js'
import { headingOf, applySeaAttitude } from './flight.js'
import { snapToSea } from '../world/sea.js'

/**
 * Autopilot. Hands the helm over: it comes round onto the waypoint, holds a
 * steady course, steers clear of anything solid in the way, and eases off as it
 * closes. Not a fast-travel mode — it runs a little above a hand-steered
 * passage because it never wanders, and because nobody wants to hold W for the
 * length of an ocean.
 *
 * The old space build teleported through obstacles at 38× speed. At this
 * multiplier that would just look like sailing through an island, so the
 * avoidance below is real: the autopilot goes around.
 */
export const AUTOPILOT_SPEED_MULTIPLIER = 1.5
/** Seconds to work up to full autopilot speed after engaging. */
export const AUTOPILOT_RAMP_UP_S = 2
/** Default for tests / callers that don't pass a body-sized standoff. */
export const DEFAULT_ARRIVAL_RANGE = 60
/** The autopilot puts the wheel over harder than a helmsman bothers to. */
const STEER_RATE_MULTIPLIER = 1.5

/** How far ahead along the track to look for something solid. */
const LOOK_AHEAD = 3000
/** Extra water to leave between the hull and whatever it is passing. */
const AVOID_MARGIN = 90
/** How far past the obstruction to aim, so it clears rather than orbits. */
const AVOID_LEAD = 0.75
/** Floor on approach speed, so it always creeps the last few metres in. */
const APPROACH_MIN = 0.08
/** How long the boat spends shedding way before arrival. */
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
 *
 * The ramp is sized by how long the boat needs to shed way — nothing else.
 * It deliberately does **not** scale with `arrivalRange`: that value says where
 * to stop, not how long stopping takes, and a big island has an arrival ring
 * kilometres across. Tying the two together made the autopilot crawl from 6 km
 * out and read as slower than steering by hand.
 *
 * `remaining` already subtracts the ring, so a large one just means the boat
 * comes to rest further off — at full speed right up until it needs not to be.
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

  // Close in, commit to the approach — the destination's own surroundings would
  // otherwise read as obstructions and send the boat round in circles.
  const finalApproach = Math.max(FINAL_APPROACH_MIN, arrivalRange * FINAL_APPROACH_MUL)
  if (distToTarget <= finalApproach) return targetPos

  const scan = Math.min(distToTarget, LOOK_AHEAD)
  let worst = null
  let worstAlong = Infinity

  for (const body of bodies) {
    const bodyRadius = collisionRadiusFor(body)
    if (bodyRadius == null) continue
    if (ignoreBodyAsCruiseObstacle(body, destPos ?? targetPos, destinationBodyId, arrivalRange)) continue

    _bodyPos.fromArray(body.position)
    _toBody.subVectors(_bodyPos, shipPos)
    _toBody.y = 0
    const along = _toBody.dot(_pathDir)
    // Behind us, or beyond where we are looking.
    if (along <= 0 || along > scan) continue

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
 * One frame of autopilot. Returns true on arrival, at which point the caller
 * disengages.
 *
 * @param {object|null} skillOpts player-only: { speedMult, cruiseMult, turnMult }
 */
export function updateAutopilot(
  shipState,
  shipClass,
  targetPosition,
  dt,
  arrivalRange = DEFAULT_ARRIVAL_RANGE,
  bodies = null,
  shipRadius = 0,
  destinationBodyId = null,
  skillOpts = null,
  simTime = 0
) {
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  const targetPos = new THREE.Vector3(...targetPosition)
  const dist = Math.hypot(targetPos.x - shipPos.x, targetPos.z - shipPos.z)
  if (dist < arrivalRange) return true

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

  // Steer by heading, exactly as the helm does — the autopilot has no more
  // ability to point the bow at the sky than the player does.
  let heading = headingOf(shipState)
  const dx = aimPos.x - shipPos.x
  const dz = aimPos.z - shipPos.z
  if (dx * dx + dz * dz > 1e-8) {
    const target = Math.atan2(dx, dz)
    const delta = Math.atan2(Math.sin(target - heading), Math.cos(target - heading))
    const maxTurn = shipClass.stats.turnRate * turnMult * STEER_RATE_MULTIPLIER * dt
    heading += Math.max(-maxTurn, Math.min(maxTurn, delta))
    shipState.heading = heading
  }

  const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
  const velocity = new THREE.Vector3().fromArray(shipState.velocity)
  velocity.y = 0

  shipState.supercruiseElapsed = (shipState.supercruiseElapsed ?? 0) + dt
  const rampUp = autopilotRampUpFactor(shipState.supercruiseElapsed)

  const topSpeed = shipClass.stats.speed * speedMult * AUTOPILOT_SPEED_MULTIPLIER * cruiseMult
  const approach = autopilotApproachFactor(dist, arrivalRange, topSpeed)
  const maxSpeed = topSpeed * rampUp * approach

  const accel = shipClass.stats.accel * AUTOPILOT_SPEED_MULTIPLIER * 2.5 * Math.max(0.15, rampUp)
  velocity.addScaledVector(forward, accel * dt)
  const dragK = accel / Math.max(1e-3, topSpeed)
  velocity.multiplyScalar(1 / (1 + dragK * dt))
  if (velocity.length() > maxSpeed) velocity.setLength(maxSpeed)

  const position = shipPos.addScaledVector(velocity, dt)

  shipState.position = position.toArray()
  shipState.velocity = velocity.toArray()
  snapToSea(shipState, simTime)
  applySeaAttitude(shipState, heading, simTime)
  return false
}
