import * as THREE from 'three'
import { headingOf } from '../game/flight.js'
import { waveHeight } from '../world/sea.js'

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
/** Metres above local wave height the camera may not cross. */
const CAMERA_WATER_CLEARANCE = 2.8
// Smooth idle-orbit blend when looking at the hull vs combat aim.
const ORBIT_BLEND_SPEED = 4.5

// Multiplier on CHASE_OFFSET; 1 = stock view. Adjusted by mouse wheel.
let chaseZoom = 1
// 0 = look at combat aim, 1 = look at hull (idle orbit).
let lookHullBlend = 0

const _worldUp = new THREE.Vector3(0, 1, 0)
const _headingQ = new THREE.Quaternion()
// Smoothed seat height, so the view rides the swell instead of every ripple.
let smoothedSeatY = 0
const _shipUp = new THREE.Vector3()
const _shipFwd = new THREE.Vector3()
const _lookAt = new THREE.Vector3()
const _lookHull = new THREE.Vector3()
const _offset = new THREE.Vector3()
const _orbitQ = new THREE.Quaternion()
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
  syncTurretMesh(mesh, entityState)
}

/**
 * Train the visible gun mount to match the aim stored on the entity.
 *
 * Yaw is relative to the hull and the mount hangs off the hull group, so it
 * comes through as a plain local rotation. Pitch is negated because the barrel
 * is modelled along local +Z and elevating it is a negative rotation about X.
 *
 * The hull's own wave tilt is *not* compensated for here. Doing so would be
 * more physically honest, but the aim maths in game/turret.js treats the mount
 * as stabilised, and a visible barrel that disagreed with where the shells go
 * is worse than one that rides the swell with the deck.
 */
export function syncTurretMesh(mesh, entityState) {
  const turret = mesh?.userData?.turret
  if (!turret) return
  turret.yawGroup.rotation.y = entityState.turretYaw ?? 0
  turret.pitchGroup.rotation.x = -(entityState.turretPitch ?? 0)
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
 * Full chase-cam state wipe (zoom + idle orbit). Call after undock / load so a
 * bay camera can't leave the seat skewed relative to turret aim + crosshair.
 */
export function resetChaseCameraState() {
  chaseZoom = 1
  lookHullBlend = 0
  idleOrbitActive = false
  idleOrbitYaw = 0
  idleOrbitBlend = 0
  // Force the next frame to seat at the real waterline rather than easing up
  // from wherever the previous view left it.
  smoothedSeatY = Number.NaN
}

// --- Idle orbit -----------------------------------------------------------
// Hands-off for a while: drift the chase seat slowly around the ship. Angle is
// scaled by an eased blend so returning from idle UNWINDS to the aft view.
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

/**
 * Keep a world position above the live sea surface (and a small clearance).
 * Close zoom / steep turret elevation must not put the seat under the swell.
 */
function clampAboveWaterline(pos) {
  const surface = waveHeight(pos.x, pos.z)
  const minY = surface + CAMERA_WATER_CLEARANCE
  if (pos.y < minY) pos.y = minY
  return pos
}

/**
 * Hard-snap the chase seat to the ship (no lerp). Also rebuilds orientation
 * from a clean basis so a previous bay lookAt can't linger.
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
  syncChaseCamera(camera, shipState, { cruising, forceSnap: true })
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

  // Ship-local seat, then turret orbit, then world orientation.
  _offset.copy(CHASE_OFFSET).multiplyScalar(seat)
  // Combat: seat orbits with the turret so the crosshair stays centered as the
  // gunner lays left/right (and a little with elevation).
  const turretYaw = Number.isFinite(shipState.turretYaw) ? shipState.turretYaw : 0
  const turretPitch = Number.isFinite(shipState.turretPitch) ? shipState.turretPitch : 0
  if (!forceSnap && (turretYaw !== 0 || turretPitch !== 0)) {
    // Ease pitch so high elevation does not flip the seat under the keel.
    _euler.set(clampPitchForSeat(turretPitch), turretYaw, 0, 'YXZ')
    _orbitQ.setFromEuler(_euler)
    _offset.applyQuaternion(_orbitQ)
  }
  // Idle drift around the boat when the helm has been quiet.
  {
    const target = idleOrbitActive && !forceSnap ? 1 : 0
    idleOrbitBlend += (target - idleOrbitBlend) * Math.min(1, dt * 1.6)
    if (target > 0) idleOrbitYaw += dt * IDLE_ORBIT_SPEED
    if (idleOrbitBlend > 0.001) {
      // Scaling the angle by the blend means the drift rewinds itself on the
      // way out, so control returns to the normal view smoothly.
      _euler.set(0, idleOrbitYaw * idleOrbitBlend, 0, 'YXZ')
      _orbitQ.setFromEuler(_euler)
      _offset.applyQuaternion(_orbitQ)
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
  // Hard floor: never put the seat under the swell (steep turret + close zoom).
  clampAboveWaterline(desiredPos)
  if (desiredPos.y > smoothedSeatY) smoothedSeatY = desiredPos.y

  // Hard-snap the ideal chase seat — soft lerp lagged behind mouse turns and
  // biased the view left/right instead of staying with the gun.
  camera.position.copy(desiredPos)
  clampAboveWaterline(camera.position)

  // The horizon stays level. A boat heels; the camera does not go with it.
  _shipUp.copy(_worldUp)

  // Combat looks along the turret (reticle = guns). Idle orbit frames the hull.
  const combatLook = idleOrbitBlend < 0.05
  if (combatLook) {
    lookAlongTurret(shipState, shipPos, _lookAt, AIM_LOOK_AHEAD)
    // Keep heave-smoothed horizon base, then add turret elevation.
    _lookAt.y = smoothedSeatY - CHASE_OFFSET.y * chaseZoom + Math.sin(turretPitch) * AIM_LOOK_AHEAD
  } else {
    getShipAimPoint(shipState, _lookAt, AIM_LOOK_AHEAD)
    _lookAt.y = smoothedSeatY - CHASE_OFFSET.y * chaseZoom
  }
  _lookHull.copy(shipPos)
  const blendTarget = idleOrbitBlend
  if (forceSnap) {
    lookHullBlend = blendTarget
  } else {
    const t = 1 - Math.exp(-ORBIT_BLEND_SPEED * Math.max(0, dt))
    lookHullBlend += (blendTarget - lookHullBlend) * t
    if (Math.abs(lookHullBlend - blendTarget) < 0.001) lookHullBlend = blendTarget
  }
  _lookAt.lerpVectors(_lookAt, _lookHull, lookHullBlend)
  orientCameraToward(camera, _lookAt, _shipUp)
  camera.updateMatrixWorld(true)
}

/** Cap seat pitch so high elevation does not put the camera under the keel. */
function clampPitchForSeat(pitch) {
  const p = pitch || 0
  return p > 0.55 ? 0.55 : p < -0.12 ? -0.12 : p
}

/** World look-at along hull heading + turret lay (stabilised, no wave pitch). */
function lookAlongTurret(shipState, shipPos, out, distance) {
  const heading = headingOf(shipState)
  const yaw = Number.isFinite(shipState.turretYaw) ? shipState.turretYaw : 0
  const pitch = Number.isFinite(shipState.turretPitch) ? shipState.turretPitch : 0
  const bearing = heading + yaw
  const cosP = Math.cos(pitch)
  out.set(
    shipPos.x + Math.sin(bearing) * cosP * distance,
    shipPos.y + Math.sin(pitch) * distance,
    shipPos.z + Math.cos(bearing) * cosP * distance
  )
  return out
}
