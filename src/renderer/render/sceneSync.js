import * as THREE from 'three'
import { headingOf } from '../game/flight.js'

// Default chase seat: astern and above the boat (local +Z forward).
// Elevated so the hull sits low in frame and the reticle is clear above it.
const CHASE_OFFSET = new THREE.Vector3(0, 14, -38)
// How fast the seat height chases the waterline. Low enough to smooth the
// swell, high enough that cresting a wave is still felt.
const SEAT_HEAVE_SMOOTHING = 2.4
// Slightly tighter seat in supercruise so we don't read as "pulling way out".
const CRUISE_SEAT_SCALE = 0.88
/**
 * World point the seat looks at, guns aim at, and the reticle represents:
 * shipPos + shipForward * AIM_LOOK_AHEAD. Must match main.js combat aim.
 */
export const AIM_LOOK_AHEAD = 400
const ZOOM_MIN = 0.35
const ZOOM_MAX = 3.2
const FREE_LOOK_SENS = 0.0042
const FREE_LOOK_PITCH_MAX = 1.25 // ~72deg

// Multiplier on CHASE_OFFSET; 1 = stock view. Adjusted by mouse wheel.
let chaseZoom = 1
// Alt+mouse orbit around the ship (ship-local yaw/pitch from default seat).
let freeLookActive = false
let freeLookYaw = 0
let freeLookPitch = 0
// 0 = look at combat aim, 1 = look at hull. Smooths Alt free-look engage/release.
let freeLookBlend = 0
const FREE_LOOK_BLEND_SPEED = 4.5 // ~0.25s ease toward target

const _worldUp = new THREE.Vector3(0, 1, 0)
const _headingQ = new THREE.Quaternion()
// Smoothed seat height, so the view rides the swell instead of every ripple.
let smoothedSeatY = 0
const _shipUp = new THREE.Vector3()
const _shipFwd = new THREE.Vector3()
const _lookAt = new THREE.Vector3()
const _lookHull = new THREE.Vector3()
const _offset = new THREE.Vector3()
const _freeQ = new THREE.Quaternion()
const _euler = new THREE.Euler(0, 0, 0, 'YXZ')
// Robust camera basis (lookAt fails when preferred-up ≈ view direction).
const _camZ = new THREE.Vector3()
const _camX = new THREE.Vector3()
const _camY = new THREE.Vector3()
const _camMat = new THREE.Matrix4()
const _altUp = new THREE.Vector3()

export function syncMeshToEntity(mesh, entityState) {
  mesh.position.fromArray(entityState.position)
  mesh.quaternion.fromArray(entityState.quaternion)
}

/** Wheel deltaY > 0 (scroll down / pinch out) → zoom out. Returns new zoom. */
export function adjustChaseZoom(deltaY) {
  // Exponential so one notch feels even at near and far ends.
  const factor = Math.exp(deltaY * 0.00115)
  chaseZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, chaseZoom * factor))
  return chaseZoom
}

export function getChaseZoom() {
  return chaseZoom
}

export function resetChaseZoom() {
  chaseZoom = 1
}

/**
 * Full chase-cam state wipe (zoom, free-look, any residual orbit).
 * Call after undock / load so a bay camera or prior free-look can't leave
 * the seat skewed relative to ship boresight + crosshair.
 */
export function resetChaseCameraState() {
  chaseZoom = 1
  freeLookActive = false
  freeLookYaw = 0
  freeLookPitch = 0
  freeLookBlend = 0
  // Force the next frame to seat at the real waterline rather than easing up
  // from wherever the previous view left it.
  smoothedSeatY = Number.NaN
}

export function setChaseFreeLook(active) {
  freeLookActive = !!active
  if (!freeLookActive) {
    freeLookYaw = 0
    freeLookPitch = 0
    // freeLookBlend eases back to 0 in syncChaseCamera (don't snap look target).
  }
}

// --- Idle orbit -----------------------------------------------------------
// Hands-off for a while: drift the chase seat slowly around the ship. Reuses
// the free-look orbit path rather than adding a second camera mode, and the
// angle is scaled by an eased blend so releasing it UNWINDS back to the normal
// aft view instead of snapping.
const IDLE_ORBIT_SPEED = 0.1 // rad/s — a full lap takes about a minute
let idleOrbitActive = false
let idleOrbitYaw = 0
let idleOrbitBlend = 0

/** @param {boolean} active */
export function setChaseIdleOrbit(active) {
  idleOrbitActive = !!active
}

export function isChaseIdleOrbit() {
  return idleOrbitBlend > 0.01
}

export function isChaseFreeLook() {
  return freeLookActive
}

/** Mouse pixel deltas while Alt free-look is held (pointer-lock movement). */
export function addChaseFreeLookDelta(dx, dy) {
  if (!freeLookActive) return
  freeLookYaw -= dx * FREE_LOOK_SENS
  freeLookPitch = Math.max(
    -FREE_LOOK_PITCH_MAX,
    Math.min(FREE_LOOK_PITCH_MAX, freeLookPitch - dy * FREE_LOOK_SENS)
  )
}

/**
 * Hard-snap the chase seat to the ship (no lerp). Also rebuilds orientation
 * from a clean basis so a previous bay lookAt / free-look can't linger.
 * @param {THREE.Camera} camera
 * @param {object} shipState
 * @param {{ cruising?: boolean, resetState?: boolean }} [opts]
 */
export function snapChaseCamera(camera, shipState, { cruising = false, resetState = true } = {}) {
  if (resetState) resetChaseCameraState()
  // Wipe any residual camera transform (bay interior leaves a distant pose).
  camera.position.set(0, 0, 0)
  camera.quaternion.identity()
  camera.up.set(0, 1, 0)
  camera.matrix.identity()
  camera.matrixWorld.identity()
  // Force the non-lerp path.
  const wasFree = freeLookActive
  freeLookActive = false
  syncChaseCamera(camera, shipState, { cruising, forceSnap: true })
  freeLookActive = wasFree && !resetState
}

/**
 * Shared combat aim point: ship origin + local +Z * AIM_LOOK_AHEAD.
 * Camera looks here; guns fire along +Z; reticle is the projection of this point.
 */
export function getShipAimPoint(shipState, out = _lookAt, distance = AIM_LOOK_AHEAD) {
  const quat = new THREE.Quaternion().fromArray(shipState.quaternion).normalize()
  out.fromArray(shipState.position)
  _shipFwd.set(0, 0, 1).applyQuaternion(quat)
  if (_shipFwd.lengthSq() < 1e-8) _shipFwd.set(0, 0, 1)
  else _shipFwd.normalize()
  return out.addScaledVector(_shipFwd, distance)
}

// Scratch for getReticleAimPoint only — must not alias _shipFwd / _lookAt used by
// getShipAimPoint (that clobber made the "center ray" aim drift off reticle).
const _reticleDir = new THREE.Vector3()
const _reticleBore = new THREE.Vector3()

/**
 * World point under the screen-center reticle: camera center ray at the same
 * depth as the ship boresight aim. When the chase seat is synced this equals
 * getShipAimPoint; if the seat is ever stale, guns still hit the reticle.
 */
export function getReticleAimPoint(camera, shipState, out = _lookAt, distance = AIM_LOOK_AHEAD) {
  if (!camera) return getShipAimPoint(shipState, out, distance)
  camera.updateMatrixWorld(true)
  _reticleDir.set(0, 0, 0.5).unproject(camera).sub(camera.position)
  if (_reticleDir.lengthSq() < 1e-10) return getShipAimPoint(shipState, out, distance)
  _reticleDir.normalize()
  getShipAimPoint(shipState, _reticleBore, distance)
  const depth = Math.max(40, camera.position.distanceTo(_reticleBore))
  return out.copy(camera.position).addScaledVector(_reticleDir, depth)
}

/**
 * Orient a camera to look at `target` with a preferred up vector.
 * Unlike Object3D.lookAt, stays stable when preferred-up is nearly parallel
 * to the view axis (common after pitch loops) — that was flipping the seat
 * and making boresight leave the HUD reticle mid-flight.
 */
export function orientCameraToward(camera, target, preferredUp) {
  // Camera looks down -Z: basis Z = eye → behind = eye - target direction.
  _camZ.copy(camera.position).sub(target)
  if (_camZ.lengthSq() < 1e-12) _camZ.set(0, 0, 1)
  else _camZ.normalize()

  _camX.crossVectors(preferredUp, _camZ)
  if (_camX.lengthSq() < 1e-8) {
    // preferredUp ≈ view axis — pick a non-parallel alternate.
    _altUp.set(0, 1, 0)
    if (Math.abs(preferredUp.dot(_altUp)) > 0.9) _altUp.set(1, 0, 0)
    _camX.crossVectors(_altUp, _camZ)
  }
  _camX.normalize()
  _camY.crossVectors(_camZ, _camX).normalize()
  // Re-orthogonalize X in case of numerical drift.
  _camX.crossVectors(_camY, _camZ).normalize()

  _camMat.makeBasis(_camX, _camY, _camZ)
  camera.quaternion.setFromRotationMatrix(_camMat)
  camera.up.copy(_camY)
}

/**
 * @param {THREE.Camera} camera
 * @param {object} shipState
 * @param {{ cruising?: boolean, forceSnap?: boolean, dt?: number }} [opts]
 */
export function syncChaseCamera(camera, shipState, { cruising = false, forceSnap = false, dt = 1 / 60 } = {}) {
  // Heading only. The hull's own quaternion carries wave pitch and heel, and
  // riding those would shake the camera with every swell and heel it over in
  // every turn — the seat follows where the boat is *pointed*, nothing else.
  _headingQ.setFromAxisAngle(_worldUp, headingOf(shipState))
  const shipPos = new THREE.Vector3().fromArray(shipState.position)
  // Cruise: don't pull the seat further out — stay near normal zoom (or slightly closer).
  const seat = chaseZoom * (cruising ? CRUISE_SEAT_SCALE : 1)

  // Ship-local seat, then optional free-look orbit, then world orientation.
  _offset.copy(CHASE_OFFSET).multiplyScalar(seat)
  if (!forceSnap && freeLookActive && (freeLookYaw !== 0 || freeLookPitch !== 0)) {
    _euler.set(freeLookPitch, freeLookYaw, 0, 'YXZ')
    _freeQ.setFromEuler(_euler)
    _offset.applyQuaternion(_freeQ)
  }
  // Idle drift. Free-look always wins — if the player is actively looking
  // around they are, by definition, not idle.
  {
    const target = idleOrbitActive && !freeLookActive && !forceSnap ? 1 : 0
    idleOrbitBlend += (target - idleOrbitBlend) * Math.min(1, dt * 1.6)
    if (target > 0) idleOrbitYaw += dt * IDLE_ORBIT_SPEED
    if (idleOrbitBlend > 0.001) {
      // Scaling the angle by the blend means the drift rewinds itself on the
      // way out, so control returns to the normal view smoothly.
      _euler.set(0, idleOrbitYaw * idleOrbitBlend, 0, 'YXZ')
      _freeQ.setFromEuler(_euler)
      _offset.applyQuaternion(_freeQ)
    } else if (target === 0) {
      idleOrbitYaw = 0
    }
  }
  _offset.applyQuaternion(_headingQ)
  const desiredPos = shipPos.clone().add(_offset)
  // Ride a smoothed waterline rather than the hull's instantaneous height, so
  // the view does not bob a metre and a half with every crest.
  if (!Number.isFinite(smoothedSeatY) || forceSnap) smoothedSeatY = desiredPos.y
  else smoothedSeatY += (desiredPos.y - smoothedSeatY) * Math.min(1, dt * SEAT_HEAVE_SMOOTHING)
  desiredPos.y = smoothedSeatY

  // Always snap to the ideal chase seat — soft lerp lagged behind mouse turns
  // and biased the view left/right instead of staying centered aft.
  // Free-look uses a light follow so orbiting feels smooth; default is hard.
  // Cruise also hard-snaps: lerp left a lateral lag that skews aim vs reticle.
  if (forceSnap || !freeLookActive) {
    camera.position.copy(desiredPos)
  } else {
    camera.position.lerp(desiredPos, cruising ? 0.9 : 0.4)
  }

  // The horizon stays level. A boat heels; the camera does not go with it.
  _shipUp.copy(_worldUp)

  // Free-look (and idle orbit) frame the hull; combat frames aim ahead. Blend
  // the look target so engage/release eases instead of snapping the pitch —
  // without this the idle drift would orbit around the ship while still aiming
  // at the forward point, so the hull would slide out of frame as it turned.
  getShipAimPoint(shipState, _lookAt, AIM_LOOK_AHEAD)
  _lookAt.y = smoothedSeatY - CHASE_OFFSET.y * chaseZoom
  _lookHull.copy(shipPos)
  const blendTarget = freeLookActive ? 1 : idleOrbitBlend
  if (forceSnap) {
    freeLookBlend = blendTarget
  } else {
    const t = 1 - Math.exp(-FREE_LOOK_BLEND_SPEED * Math.max(0, dt))
    freeLookBlend += (blendTarget - freeLookBlend) * t
    if (Math.abs(freeLookBlend - blendTarget) < 0.001) freeLookBlend = blendTarget
  }
  _lookAt.lerpVectors(_lookAt, _lookHull, freeLookBlend)
  orientCameraToward(camera, _lookAt, _shipUp)
  camera.updateMatrixWorld(true)
}
