import * as THREE from 'three'

const YAW_AXIS = new THREE.Vector3(0, 1, 0)
const PITCH_AXIS = new THREE.Vector3(1, 0, 0)
const ROLL_AXIS = new THREE.Vector3(0, 0, 1)
const FORWARD = new THREE.Vector3(0, 0, 1)
const RIGHT = new THREE.Vector3(1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)
// Coast decay when not thrusting (no Shift boost — full throttle already hits max).
const DAMPING_PER_SECOND = 0.35
const THROTTLE_RATE = 0.6 // fraction of full throttle gained/lost per second while W/S is held
const THROTTLE_DECAY = 0.55 // throttle returns toward 0 per second when W/S released
const THROTTLE_MIN = -1 // S can ramp throttle negative for reverse thrust
const REVERSE_SPEED_FRACTION = 0.25 // reverse speed never exceeds this fraction of the class's forward max speed
const MOUSE_SENSITIVITY = 0.0022 // radians per pixel of mouse movement, scaled by the ship's turnRate
// Side/vertical thrusters hit harder than main-engine lateral was — 6DOF feel.
const STRAFE_MULTIPLIER = 3

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

/**
 * @param {object} [skillOpts] player-only skill mults: { speedMult, turnMult }
 */
export function updateFlight(shipState, shipClass, keys, mouseAim, dt, skillOpts = null) {
  const speedMult = skillOpts?.speedMult ?? 1
  const turnMult = skillOpts?.turnMult ?? 1
  // skillOpts.maxSpeed overrides base hull speed (e.g. Speed Upgrade accessory).
  const baseSpeed = skillOpts?.maxSpeed ?? shipClass.stats.speed
  const speed = baseSpeed * speedMult
  const turnRate = shipClass.stats.turnRate * turnMult
  const { accel } = shipClass.stats
  const quat = new THREE.Quaternion().fromArray(shipState.quaternion)
  const velocity = new THREE.Vector3().fromArray(shipState.velocity)

  // Ship-local pitch/yaw — full loops past any attitude (no zenith stop).
  // Chase cam banks with the ship so local axes stay screen-aligned.
  // Camera sits behind the ship with lookAt: ship local +X is screen-left
  // (same reason radar negates x). +yaw around Y sends the nose to local +X
  // (screen-left), so mouse-right (dx>0) needs -yaw to turn screen-right.
  // Pitch: mouse up (dy<0) → nose up.
  const yawAmount = -mouseAim.dx * MOUSE_SENSITIVITY * turnRate
  const pitchAmount = mouseAim.dy * MOUSE_SENSITIVITY * turnRate
  quat.multiply(new THREE.Quaternion().setFromAxisAngle(YAW_AXIS, yawAmount))
  quat.multiply(new THREE.Quaternion().setFromAxisAngle(PITCH_AXIS, pitchAmount))
  mouseAim.dx = 0
  mouseAim.dy = 0

  const rollTurn = turnRate * dt
  if (keys.has('KeyQ')) quat.multiply(new THREE.Quaternion().setFromAxisAngle(ROLL_AXIS, -rollTurn))
  if (keys.has('KeyE')) quat.multiply(new THREE.Quaternion().setFromAxisAngle(ROLL_AXIS, rollTurn))
  quat.normalize()

  // W/S ramp throttle while held; release slowly bleeds throttle back to 0
  // so forward/reverse both coast down instead of holding a set speed.
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

  // Thrust response > 1 so we settle on stats.speed quickly; terminal speed
  // is still exactly `speed` (dragK scales with the same factor). No Shift boost.
  const thrustResponse = 2.5
  const forward = FORWARD.clone().applyQuaternion(quat)
  velocity.addScaledVector(forward, accel * thrustResponse * shipState.throttle * dt)

  // Full translation triad: A/D lateral, X/Z vertical (local ship axes).
  // Chase cam: ship +X is screen-left — A (left) thrusts +X, D (right) -X.
  const right = RIGHT.clone().applyQuaternion(quat)
  const up = UP.clone().applyQuaternion(quat)
  const strafeAccel = accel * STRAFE_MULTIPLIER
  let strafeX = 0
  let strafeY = 0
  if (keys.has('KeyA')) { velocity.addScaledVector(right, strafeAccel * dt); strafeX += 1 }
  if (keys.has('KeyD')) { velocity.addScaledVector(right, -strafeAccel * dt); strafeX -= 1 }
  if (keys.has('KeyX')) { velocity.addScaledVector(up, strafeAccel * dt); strafeY += 1 }
  if (keys.has('KeyZ')) { velocity.addScaledVector(up, -strafeAccel * dt); strafeY -= 1 }
  // Exposed for thruster VFX/SFX (main.js).
  shipState.strafeX = strafeX
  shipState.strafeY = strafeY

  // Implicit drag: equilibrium at full throttle is stats.speed.
  const thrusting = Math.abs(shipState.throttle) > 0.01 || strafeX !== 0 || strafeY !== 0
  if (thrusting) {
    const dragK = (accel * thrustResponse) / Math.max(1e-3, speed)
    velocity.multiplyScalar(1 / (1 + dragK * dt))
  } else {
    velocity.multiplyScalar(Math.pow(DAMPING_PER_SECOND, dt))
  }

  if (velocity.length() > speed) velocity.setLength(speed)

  // Cap reverse (backward-facing) speed to a small fraction of the forward
  // max — the maxSpeed clamp above only bounds overall magnitude, not
  // direction, so it wouldn't stop the ship reversing at full speed.
  const forwardSpeed = velocity.dot(forward)
  const maxReverseSpeed = speed * REVERSE_SPEED_FRACTION
  if (forwardSpeed < -maxReverseSpeed) velocity.addScaledVector(forward, -(forwardSpeed + maxReverseSpeed))

  const position = new THREE.Vector3().fromArray(shipState.position).addScaledVector(velocity, dt)

  shipState.position = position.toArray()
  shipState.velocity = velocity.toArray()
  shipState.quaternion = quat.toArray()
}
