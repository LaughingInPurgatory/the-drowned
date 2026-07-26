/**
 * Player clone vault: place body backups at clone bays; jump between them
 * when Cloning skill ≥ 1 (capacity > 1).
 *
 * Capacity = 1 + Cloning skill level.
 * Create: 10_000 cr. Jump: 100_000 cr (requires Cloning ≥ 1).
 */
import { skillLevel } from '../data/skills.js'
import { ensureSkills } from './skills.js'
import { getSystem, findBody, findSystemOfBody } from '../procgen/galaxy.js'

export const CLONE_CREATE_COST = 10_000
export const CLONE_JUMP_COST = 100_000

let cloneCounter = 0

export function ensureClones(gameState) {
  if (!gameState?.player) return []
  if (!Array.isArray(gameState.player.clones)) gameState.player.clones = []
  return gameState.player.clones
}

/** Max simultaneous placed clones (1 base + Cloning skill levels). */
export function maxCloneCapacity(gameState) {
  ensureSkills(gameState)
  return 1 + skillLevel(gameState.player.skills, 'cloning')
}

/** Jump requires Cloning ≥ 1 so capacity can hold more than one body. */
export function canCloneJump(gameState) {
  ensureSkills(gameState)
  return skillLevel(gameState.player.skills, 'cloning') >= 1
}

/**
 * Snapshot of where a new clone should be recorded (exterior if docked).
 */
export function currentCloneSnapshot(gameState) {
  const p = gameState.player
  const ship = p.ship
  if (p.dockedBodyId && Array.isArray(p.dockedExteriorPosition)) {
    return {
      systemId: p.currentSystemId,
      position: p.dockedExteriorPosition.map(Number),
      stationId: p.dockedBodyId
    }
  }
  return {
    systemId: p.currentSystemId,
    position: (ship.position ?? [0, 0, 0]).map(Number),
    stationId: null
  }
}

function labelForClone(gameState, snap) {
  const system = getSystem(gameState.galaxy, snap.systemId)
  const sysName = system?.name ?? snap.systemId
  if (snap.stationId) {
    const body = findBody(gameState.galaxy, snap.stationId)
    if (body?.name) return `${body.name} · ${sysName}`
  }
  return `Deep space · ${sysName}`
}

/**
 * Place a clone at the player's current location.
 * @returns {{ clone: object }}
 */
export function createClone(gameState) {
  ensureClones(gameState)
  ensureSkills(gameState)
  const max = maxCloneCapacity(gameState)
  if (gameState.player.clones.length >= max) {
    throw new Error(`Clone capacity full (${max}). Raise Cloning skill for more slots.`)
  }
  if ((gameState.player.credits ?? 0) < CLONE_CREATE_COST) {
    throw new Error(`Need ${CLONE_CREATE_COST} cr to create a clone`)
  }
  const snap = currentCloneSnapshot(gameState)
  gameState.player.credits -= CLONE_CREATE_COST
  const clone = {
    id: `clone-${++cloneCounter}-${Date.now().toString(36)}`,
    systemId: snap.systemId,
    position: snap.position,
    stationId: snap.stationId,
    label: labelForClone(gameState, snap),
    createdAt: gameState.simTime ?? 0
  }
  gameState.player.clones.push(clone)
  return { clone }
}

/**
 * Jump to a placed clone: free the destination, move player there, leave a
 * clone at the origin (if capacity allows after freeing dest).
 * @returns {{ from: object, to: object, systemChanged: boolean }}
 */
export function jumpToClone(gameState, cloneId) {
  ensureClones(gameState)
  ensureSkills(gameState)
  if (!canCloneJump(gameState)) {
    throw new Error('Clone jump requires Cloning skill level 1+')
  }
  if ((gameState.player.credits ?? 0) < CLONE_JUMP_COST) {
    throw new Error(`Need ${CLONE_JUMP_COST} cr to jump to a clone`)
  }
  const list = gameState.player.clones
  const idx = list.findIndex((c) => c.id === cloneId)
  if (idx < 0) throw new Error('Clone not found')
  const target = list[idx]

  // Free destination slot first so capacity stays valid when we place origin.
  list.splice(idx, 1)

  const originSnap = currentCloneSnapshot(gameState)
  const fromSystemId = gameState.player.currentSystemId
  const destSystemId = target.systemId
  const destPos = Array.isArray(target.position) ? target.position.map(Number) : [0, 0, 0]

  gameState.player.credits -= CLONE_JUMP_COST

  // Clear dock state — arrive free-flying at the clone coordinates.
  gameState.player.dockedBodyId = null
  gameState.player.dockedExteriorPosition = null
  gameState.player.dockedApproachDir = null

  gameState.player.currentSystemId = destSystemId
  gameState.player.ship.position = [...destPos]
  gameState.player.ship.velocity = [0, 0, 0]
  gameState.player.ship.throttle = 0

  // Leave a clone at origin (player's previous body).
  const max = maxCloneCapacity(gameState)
  if (list.length < max) {
    list.push({
      id: `clone-${++cloneCounter}-${Date.now().toString(36)}`,
      systemId: originSnap.systemId,
      position: originSnap.position,
      stationId: originSnap.stationId,
      label: labelForClone(gameState, originSnap),
      createdAt: gameState.simTime ?? 0
    })
  }

  // Refresh labels (system names).
  for (const c of list) {
    c.label = labelForClone(gameState, c)
  }

  return {
    from: originSnap,
    to: { systemId: destSystemId, position: destPos, stationId: target.stationId },
    systemChanged: fromSystemId !== destSystemId
  }
}

/** Drop a clone without refund. */
export function discardClone(gameState, cloneId) {
  ensureClones(gameState)
  const list = gameState.player.clones
  const idx = list.findIndex((c) => c.id === cloneId)
  if (idx < 0) throw new Error('Clone not found')
  list.splice(idx, 1)
}

export function cloneListForUi(gameState) {
  ensureClones(gameState)
  return gameState.player.clones.map((c) => ({
    ...c,
    label: c.label || labelForClone(gameState, c),
    isCurrentSystem: c.systemId === gameState.player.currentSystemId
  }))
}

/** Deterministic station flag — used when regenerating flags on old saves. */
export function stationHasCloneBay(stationId) {
  if (!stationId) return false
  let h = 2166136261
  const s = `clonebay:${stationId}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // ~30% of stations
  return (h >>> 0) % 100 < 30
}

/** Ensure body.hasCloneBay is set (stations only); preserves existing true/false. */
export function ensureStationCloneBayFlag(body) {
  if (!body || body.kind !== 'station') return false
  if (typeof body.hasCloneBay === 'boolean') return body.hasCloneBay
  body.hasCloneBay = stationHasCloneBay(body.id)
  return body.hasCloneBay
}

export function ensureGalaxyCloneBays(galaxy) {
  if (!galaxy?.systems) return
  for (const sys of galaxy.systems) {
    for (const b of sys.bodies ?? []) {
      if (b.kind === 'station') ensureStationCloneBayFlag(b)
    }
  }
}

// re-export find helpers for UI convenience
export { findSystemOfBody, findBody, getSystem }
