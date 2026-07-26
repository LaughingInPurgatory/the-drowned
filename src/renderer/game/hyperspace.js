import * as THREE from 'three'
import {
  getSystem,
  canJumpTo,
  SYSTEM_ARRIVAL_POSITION,
  advancePlottedRoute,
  findWarpGateTo,
  WARP_GATE_ACTIVATION_RANGE
} from '../procgen/galaxy.js'
import { ensureBountyNpcsForSystem } from './missions.js'

const _up = new THREE.Vector3(0, 1, 0)
const _from = new THREE.Vector3()
const _toward = new THREE.Vector3()
const _mat = new THREE.Matrix4()
const _quat = new THREE.Quaternion()

/**
 * Quaternion that aims ship local +Z from `fromPos` toward `towardPos`.
 * Matrix4.lookAt uses camera convention (+Z away from target), so eye/target
 * are swapped — same fix as combat.js / supercruise.js / main.js quatFacing.
 */
export function quatFacingSun(fromPos, towardPos = [0, 0, 0]) {
  _from.fromArray(fromPos)
  _toward.fromArray(towardPos)
  if (_from.distanceToSquared(_toward) < 1e-8) return [0, 0, 0, 1]
  _quat.setFromRotationMatrix(_mat.lookAt(_toward, _from, _up))
  return _quat.toArray()
}

/**
 * Unit direction from a gate into the system (toward the star / origin).
 * Used to face out of the aperture and for arrival standoff.
 */
export function warpGateOutwardDir(gatePosition) {
  let dx = -(gatePosition?.[0] ?? 0)
  let dy = -(gatePosition?.[1] ?? 0)
  let dz = -(gatePosition?.[2] ?? 0)
  let len = Math.hypot(dx, dy, dz)
  if (len < 1e-6) {
    return [0, 0, 1]
  }
  return [dx / len, dy / len, dz / len]
}

/**
 * Exit position just outside the destination gate that leads back to `fromSystemId`.
 * Within WARP_GATE_ACTIVATION_RANGE (2 km) of the gate, offset toward the star.
 * Falls back to SYSTEM_ARRIVAL_POSITION if the gate is missing.
 */
export function warpArrivalNearExitGate(destSystem, fromSystemId) {
  const gate = findWarpGateTo(destSystem, fromSystemId)
  if (!gate?.position) return [...SYSTEM_ARRIVAL_POSITION]

  const gx = gate.position[0]
  const gy = gate.position[1]
  const gz = gate.position[2]
  const [ox, oy, oz] = warpGateOutwardDir(gate.position)
  // ~1.2 km from gate centre — well inside the 2 km F-activate bubble.
  const standoff = Math.min(1200, WARP_GATE_ACTIVATION_RANGE * 0.6)
  return [gx + ox * standoff, gy + oy * standoff, gz + oz * standoff]
}

/** Centre of the destination gate aperture (start of exit animation). */
export function warpArrivalAtExitGateCenter(destSystem, fromSystemId) {
  const gate = findWarpGateTo(destSystem, fromSystemId)
  if (!gate?.position) return [...SYSTEM_ARRIVAL_POSITION]
  return [...gate.position]
}

export function hyperspaceJump(gameState, targetSystemId, rng) {
  if (gameState.inCombat) throw new Error('Cannot hyperspace while in combat')
  if (targetSystemId === gameState.player.currentSystemId) throw new Error('Already in that system')
  const system = getSystem(gameState.galaxy, targetSystemId)
  if (!system) throw new Error('Unknown system')
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!canJumpTo(currentSystem, targetSystemId)) {
    throw new Error('No warp lane to that system — travel via neighboring warp gates')
  }

  const fromSystemId = gameState.player.currentSystemId
  gameState.player.currentSystemId = targetSystemId
  gameState.player.waypointBodyId = null
  // Emerge in the paired gate aperture; flight VFX then flies out to standoff.
  const exitGate = findWarpGateTo(system, fromSystemId)
  gameState.player.ship.position = warpArrivalAtExitGateCenter(system, fromSystemId)
  gameState.player.ship.velocity = [0, 0, 0]
  // Face out of the gate into the system (toward the star).
  if (exitGate?.position) {
    const [ox, oy, oz] = warpGateOutwardDir(exitGate.position)
    const lookAt = [
      exitGate.position[0] + ox * 500,
      exitGate.position[1] + oy * 500,
      exitGate.position[2] + oz * 500
    ]
    gameState.player.ship.quaternion = quatFacingSun(gameState.player.ship.position, lookAt)
  } else {
    gameState.player.ship.quaternion = quatFacingSun(gameState.player.ship.position)
  }
  // Drop hops already reached from any galaxy-map plotted route.
  advancePlottedRoute(gameState)
  // NPCs, projectiles, and wrecks all belong to the system just left;
  // encounter state is never persisted (see the save/load design), so it's
  // simplest to drop them here too rather than track per-system entity lists.
  gameState.npcs = []
  gameState.projectiles = []
  gameState.wrecks = []

  ensureBountyNpcsForSystem(gameState, targetSystemId, rng)
}
