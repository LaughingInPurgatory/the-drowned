import * as THREE from 'three'
import { waveNormal } from '../world/sea.js'

const FORWARD = new THREE.Vector3(0, 0, 1)
const WORLD_UP = new THREE.Vector3(0, 1, 0)
const ROLL_AXIS = new THREE.Vector3(0, 0, 1)
const PITCH_AXIS = new THREE.Vector3(1, 0, 0)
// Coast decay when off the throttle — a hull carries way, it does not stop dead.
const DAMPING_PER_SECOND = 0.35
const THROTTLE_RATE = 0.6 // fraction of full throttle gained/lost per second while W/S is held
const THROTTLE_DECAY = 0.55 // throttle returns toward 0 per second when W/S released
const THROTTLE_MIN = -1 // S can ramp throttle negative for astern
const REVERSE_SPEED_FRACTION = 0.25 // astern speed never exceeds this fraction of the hull's forward max
const MOUSE_SENSITIVITY = 0.0022 // radians per pixel of mouse movement, scaled by the hull's turnRate
// A rudder only bites against water flowing past it. Below this fraction of top
// speed steering authority tapers off, so a stopped boat cannot spin on the spot.
const STEER_AUTHORITY_SPEED_FRACTION = 0.25
// How much of the wave normal the hull adopts. Full normal is far too lively —
// a hull spans several metres and averages the slope it sits across.
const WAVE_TILT = 0.7
const MAX_BANK = 0.42 // radians of heel into a hard turn
const BANK_PER_TURN_RATE = 0.55 // heel per radian/sec of yaw
const BANK_SMOOTHING = 3.5 // per-second approach rate toward target heel
const TRIM_PITCH = 0.09 // bow rise under power, radians at full throttle

export function createInputState() {
  const keys = new Set()
  window.addEventListener('keydown', (e) => keys.add(e.code))
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  return keys
}

// Mouse deltas accumulate only while the pointer is locked (cursor confined).
// Consumed — reset to 0 — once applied each frame in updateFlight.
export function createMouseAimState() {
  const state = { dx: 0, dy: 0 }
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement) return
    state.dx += e.movementX
    state.dy += e.movementY
  })
  return state
}

const _q = new THREE.Quaternion()
const _fwd = new THREE.Vector3()
const _up = new THREE.Vector3()
const _right = new THREE.Vector3()
const _basis = new THREE.Matrix4()
const _spin = new THREE.Quaternion()

/**
 * Heading (radians, yaw about world Y) is the authoritative attitude for a
 * surface vessel — pitch and roll are consequences of the sea and the turn,
 * never inputs. Older state (and everything that only stored a quaternion)
 * gets its heading recovered from the hull's forward axis.
 */
export function headingOf(shipState) {
  if (typeof shipState.heading === 'number') return shipState.heading
  _fwd.copy(FORWARD).applyQuaternion(_q.fromArray(shipState.quaternion))
  shipState.heading = Math.atan2(_fwd.x, _fwd.z)
  return shipState.heading
}

/**
 * Build the hull's visual orientation: heading yaw, tilted onto the local wave
 * slope, heeled into the turn, trimmed bow-up under power. Written back to
 * `shipState.quaternion` so every downstream consumer — mesh sync, chase
 * camera, muzzle offsets, radar — keeps reading the same field it always did.
 */
export function applySeaAttitude(shipState, heading, t, bank = 0, trim = 0) {
  const pos = shipState.position
  const n = waveNormal(pos[0], pos[2], t)
  // Blend toward world up: the hull averages the slope it spans, and the full
  // normal makes small craft twitch on the short chop.
  _up.set(n.x * WAVE_TILT, n.y * WAVE_TILT + (1 - WAVE_TILT), n.z * WAVE_TILT).normalize()
  _fwd.set(Math.sin(heading), 0, Math.cos(heading))
  // Orthogonalize the heading against the tilted up so the basis stays rigid.
  _fwd.addScaledVector(_up, -_fwd.dot(_up))
  if (_fwd.lengthSq() < 1e-8) _fwd.set(Math.sin(heading), 0, Math.cos(heading))
  _fwd.normalize()
  _right.crossVectors(_up, _fwd).normalize()
  _basis.makeBasis(_right, _up, _fwd)
  _q.setFromRotationMatrix(_basis)
  if (bank) _q.multiply(_spin.setFromAxisAngle(ROLL_AXIS, bank))
  if (trim) _q.multiply(_spin.setFromAxisAngle(PITCH_AXIS, -trim))
  shipState.quaternion = _q.toArray()
}

/**
 * @param {object} [skillOpts] player-only skill mults: { speedMult, turnMult }
 */
export function updateFlight(shipState, shipClass, keys, mouseAim, dt, skillOpts = null, t = 0) {
  const speedMult = skillOpts?.speedMult ?? 1
  const turnMult = skillOpts?.turnMult ?? 1
  // skillOpts.maxSpeed overrides base hull speed (e.g. Engine Upgrade accessory).
  const baseSpeed = skillOpts?.maxSpeed ?? shipClass.stats.speed
  const speed = baseSpeed * speedMult
  const turnRate = shipClass.stats.turnRate * turnMult
  const { accel } = shipClass.stats
  const velocity = new THREE.Vector3().fromArray(shipState.velocity)
  velocity.y = 0 // the sea owns vertical motion; thrust is horizontal only

  let heading = headingOf(shipState)

  // W/S ramp throttle while held; release slowly bleeds throttle back to 0
  // so ahead and astern both coast down instead of holding a set speed.
  shipState.throttle ??= 0
  if (keys.has('KeyW')) {
    shipState.throttle = Math.min(1, shipState.throttle + THROTTLE_RATE * dt)
  } else if (keys.has('KeyS')) {
    shipState.throttle = Math.max(THROTTLE_MIN, shipState.throttle - THROTTLE_RATE * dt)
  } else if (shipState.throttle > 0) {
    shipState.throttle = Math.max(0, shipState.throttle - THROTTLE_DECAY * dt)
  } else if (shipState.throttle < 0) {
    shipState.throttle = Math.min(0, shipState.throttle + THROTTLE_DECAY * dt)
  }

  // Rudder: mouse X and A/D both steer. Authority scales with way through the
  // water, so a dead-stopped hull will not pivot in place.
  const wayFraction = Math.min(1, velocity.length() / Math.max(1e-3, speed * STEER_AUTHORITY_SPEED_FRACTION))
  // Camera sits astern looking forward, so hull local +X is screen-left (the
  // same reason radar negates x). Mouse-right must therefore yaw negative.
  let rudder = -mouseAim.dx * MOUSE_SENSITIVITY
  if (keys.has('KeyA')) rudder += turnRate * dt
  if (keys.has('KeyD')) rudder -= turnRate * dt
  mouseAim.dx = 0
  mouseAim.dy = 0 // no pitch input on the water — consume it so it cannot pile up

  const yawDelta = rudder * turnRate * wayFraction
  heading += yawDelta
  shipState.heading = heading

  const forward = _fwd.set(Math.sin(heading), 0, Math.cos(heading)).clone()

  // Thrust response > 1 so we settle on stats.speed quickly; terminal speed
  // is still exactly `speed` (dragK scales with the same factor).
  const thrustResponse = 2.5
  velocity.addScaledVector(forward, accel * thrustResponse * shipState.throttle * dt)

  // Implicit drag: equilibrium at full throttle is stats.speed.
  const thrusting = Math.abs(shipState.throttle) > 0.01
  if (thrusting) {
    const dragK = (accel * thrustResponse) / Math.max(1e-3, speed)
    velocity.multiplyScalar(1 / (1 + dragK * dt))
  } else {
    velocity.multiplyScalar(Math.pow(DAMPING_PER_SECOND, dt))
  }

  if (velocity.length() > speed) velocity.setLength(speed)

  // Cap astern speed to a small fraction of the ahead max — the speed clamp
  // above only bounds magnitude, not direction, so it would not stop a hull
  // making full speed in reverse.
  const forwardSpeed = velocity.dot(forward)
  const maxReverseSpeed = speed * REVERSE_SPEED_FRACTION
  if (forwardSpeed < -maxReverseSpeed) velocity.addScaledVector(forward, -(forwardSpeed + maxReverseSpeed))

  const position = new THREE.Vector3().fromArray(shipState.position).addScaledVector(velocity, dt)

  shipState.position = position.toArray()
  shipState.velocity = velocity.toArray()

  // Heel into the turn, eased so a flicked rudder does not snap the hull over.
  const targetBank = THREE.MathUtils.clamp(
    (dt > 0 ? yawDelta / dt : 0) * BANK_PER_TURN_RATE,
    -MAX_BANK,
    MAX_BANK
  )
  shipState.bank ??= 0
  shipState.bank += (targetBank - shipState.bank) * Math.min(1, BANK_SMOOTHING * dt)
  applySeaAttitude(shipState, heading, t, shipState.bank, TRIM_PITCH * Math.max(0, shipState.throttle))

  // Exposed for wake/spray VFX + SFX (main.js). strafeX carries rudder side so
  // the wake kicks out of the turn; there is no vertical thruster on a boat.
  shipState.strafeX = Math.sign(yawDelta)
  shipState.strafeY = 0
}
