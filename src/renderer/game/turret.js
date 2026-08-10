import * as THREE from 'three'
import { headingOf } from './flight.js'

/**
 * Turret aim.
 *
 * The guns are no longer welded to the hull. The mouse lays the turret and
 * nothing else; the boat is steered entirely on the keyboard. That split is
 * what makes a gunboat feel like a gunboat — you hold a target while
 * manoeuvring independently of it — and it is also the only way to engage
 * something that is not on the surface, which is why the mount carries real
 * elevation rather than just a bearing.
 *
 * Aim is stored as two scalars on the ship state:
 *
 *   `turretYaw`    radians, **relative to the hull's heading**. Relative, not
 *                  absolute, so the mount stays trained where the gunner put it
 *                  as the boat turns under it — which is what a turret does.
 *   `turretPitch`  radians, positive up.
 *
 * Both are plain numbers so the whole thing survives the structured clone that
 * saving does (see render/islandMesh.js for what happens when it does not).
 */

/**
 * Historical name: half a turn either side of ahead. The mount now free-spins
 * a full 360° (yaw wraps); this constant is kept for tests / docs that talk
 * about “dead aft is reachable”.
 */
export const TURRET_MAX_TRAVERSE = Math.PI
/** Depression: a gun can be laid a little below the horizon, not much. */
export const TURRET_MIN_PITCH = -0.14
/** Elevation: high enough to engage something in the air. */
export const TURRET_MAX_PITCH = 1.15
/** Radians per pixel of mouse travel. Matches the old rudder feel. */
export const TURRET_SENSITIVITY = 0.0022
/**
 * How far out the aim ray is resolved when nothing is being tracked.
 *
 * The crosshair is the projection of this point, so it also sets how much the
 * reticle moves for a given traverse.
 */
export const TURRET_AIM_DISTANCE = 900

const _q = new THREE.Quaternion()
const _fwd = new THREE.Vector3()

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/** Wrap to (-PI, PI]. */
export function normaliseAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

/** Read (and initialise) a ship's turret bearing relative to its hull. */
export function turretYawOf(shipState) {
  if (typeof shipState.turretYaw !== 'number' || !Number.isFinite(shipState.turretYaw)) {
    shipState.turretYaw = 0
  }
  return shipState.turretYaw
}

/** Read (and initialise) a ship's turret elevation. */
export function turretPitchOf(shipState) {
  if (typeof shipState.turretPitch !== 'number' || !Number.isFinite(shipState.turretPitch)) {
    shipState.turretPitch = 0
  }
  return shipState.turretPitch
}

/**
 * Lay the turret with the mouse. Consumes the accumulated delta.
 *
 * This is now the **only** consumer of mouse movement — `updateFlight` used to
 * take it for the rudder and must not any more, or the two fight over the same
 * pixels and both end up at half sensitivity.
 *
 * @param {object} shipState
 * @param {{dx:number, dy:number}} mouseAim accumulated pixels, zeroed here
 * @param {number} [sensitivity]
 */
export function updateTurretAim(shipState, mouseAim, sensitivity = TURRET_SENSITIVITY) {
  const yaw = turretYawOf(shipState)
  const pitch = turretPitchOf(shipState)
  // Chase camera sits astern looking forward, so hull local +X is screen-left
  // — the same reason the radar negates x. Mouse-right must train to
  // starboard, which is negative yaw.
  // Free 360° traverse: wrap, don't clamp — no hard stop at dead aft.
  shipState.turretYaw = normaliseAngle(yaw - mouseAim.dx * sensitivity)
  // Screen y grows downward, so a mouse push forward (negative dy) elevates.
  shipState.turretPitch = clamp(
    pitch - mouseAim.dy * sensitivity,
    TURRET_MIN_PITCH,
    TURRET_MAX_PITCH
  )
  mouseAim.dx = 0
  mouseAim.dy = 0
}

/**
 * Train an NPC's turret onto a world point.
 *
 * Instant rather than slewed: NPC gunnery is already governed by the fire cone
 * and cooldowns in combat.js, and adding a second lag on top just makes them
 * miss for reasons the player cannot see.
 */
export function aimTurretAt(shipState, targetWorld) {
  const heading = headingOf(shipState)
  const dx = targetWorld[0] - shipState.position[0]
  const dy = targetWorld[1] - shipState.position[1]
  const dz = targetWorld[2] - shipState.position[2]
  const flat = Math.hypot(dx, dz)
  if (flat < 1e-4) return
  const worldBearing = Math.atan2(dx, dz)
  // Shortest path onto the target; full circle means any bearing is legal.
  shipState.turretYaw = normaliseAngle(worldBearing - heading)
  shipState.turretPitch = clamp(Math.atan2(dy, flat), TURRET_MIN_PITCH, TURRET_MAX_PITCH)
}

/**
 * The turret's world-space pointing direction (unit vector).
 *
 * Built from the hull heading plus the relative bearing, deliberately ignoring
 * the hull's wave pitch and heel: the mount is stabilised, so a swell does not
 * throw the fall of shot around. This is also why the crosshair sits still.
 */
export function turretDirection(shipState, out = _fwd) {
  const heading = headingOf(shipState)
  const bearing = heading + turretYawOf(shipState)
  const pitch = turretPitchOf(shipState)
  const cosP = Math.cos(pitch)
  return out.set(Math.sin(bearing) * cosP, Math.sin(pitch), Math.cos(bearing) * cosP)
}

/**
 * Where the turret sits on the hull, in ship-local space.
 *
 * One mount per vessel, stepped on the centreline forward of the wheelhouse.
 * shipMesh.js builds the visible turret from the same numbers, so the shots
 * leave the barrel you can see rather than the middle of the boat.
 */
export function turretMountLocal(shipClass) {
  const hull = shipClass?.hull
  const length = hull?.length ?? 18
  const heights = hull?.stationHeights ?? [1]
  const offsets = hull?.stationOffsetsY ?? heights.map(() => 0)
  // Two-thirds forward: ahead of the house, clear of the working deck aft.
  const f = 0.66
  const last = heights.length - 1
  const i = Math.max(0, Math.min(last, Math.round(f * last)))
  const deckY = (heights[i] ?? 1) + (offsets[i] ?? 0)
  return {
    x: 0,
    y: deckY,
    z: -length / 2 + f * length,
    /** Height of the trunnion above the deck — where the barrel pivots. */
    height: Math.max(0.35, (heights[i] ?? 1) * 0.45),
    /** Barrel length, scaled off the hull so a tug is not carrying a battleship gun. */
    barrel: Math.max(1.2, length * 0.13)
  }
}

const _muzzleLocal = new THREE.Vector3()
const _muzzleQuat = new THREE.Quaternion()

/**
 * World position the shells actually leave from: the end of the barrel, with
 * the turret trained where it is currently pointing.
 */
export function turretMuzzleWorld(shipState, shipClass, out = new THREE.Vector3()) {
  const mount = turretMountLocal(shipClass)
  const heading = headingOf(shipState)
  const bearing = heading + turretYawOf(shipState)
  const pitch = turretPitchOf(shipState)

  // Mount position rides the hull's heading only — same stabilised assumption
  // as turretDirection, so the muzzle does not swing with the swell.
  _muzzleLocal.set(mount.x, 0, mount.z).applyQuaternion(
    _muzzleQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
  )
  const cosP = Math.cos(pitch)
  out.set(
    shipState.position[0] + _muzzleLocal.x + Math.sin(bearing) * cosP * mount.barrel,
    shipState.position[1] + mount.y + mount.height + Math.sin(pitch) * mount.barrel,
    shipState.position[2] + _muzzleLocal.z + Math.cos(bearing) * cosP * mount.barrel
  )
  return out
}

/** World point the guns are laid on — the crosshair is this, projected. */
export function turretAimPoint(shipState, shipClass, out = new THREE.Vector3(), distance = TURRET_AIM_DISTANCE) {
  turretMuzzleWorld(shipState, shipClass, out)
  const dir = turretDirection(shipState, _fwd)
  return out.addScaledVector(dir, distance)
}

/** Extend the camera-to-reticle ray without changing its screen position. */
export function crosshairSightlineEnd(cameraPosition, displayedAim, distance, out = new THREE.Vector3()) {
  out.copy(displayedAim).sub(cameraPosition)
  if (out.lengthSq() < 1e-8) return out.copy(displayedAim)
  return out.normalize().multiplyScalar(distance).add(cameraPosition)
}

/** Ease the turret back to dead ahead — used when the helm is unmanned. */
export function centreTurret(shipState, dt, rate = 2.2) {
  const k = Math.min(1, rate * dt)
  // Multiply-toward-zero is the shortest path on a wrapped bearing (±π).
  shipState.turretYaw = normaliseAngle(turretYawOf(shipState) * (1 - k))
  shipState.turretPitch = turretPitchOf(shipState) * (1 - k)
}
