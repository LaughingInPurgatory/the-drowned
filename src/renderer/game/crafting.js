import {
  getBlueprint,
  craftDurationS,
  oreCostForBlueprint,
  creditCostForBlueprint,
  rollRandomBlueprintId,
  rollAlienBlueprintId,
  parseBlueprintId
} from '../data/blueprints.js'
import { getShipClass } from '../data/shipClasses.js'
import { defaultLoadoutFor } from '../data/weapons.js'
import { defaultAccessoriesFor } from '../data/accessories.js'
import { getSystem, findBody } from '../procgen/galaxy.js'
import { MINED_ORE_GOOD_IDS } from '../data/goods.js'
import { playerSkillBonuses, scaleOreCost } from './skills.js'

// Very rare blueprint finds.
export const WRECK_BLUEPRINT_DROP_CHANCE = 0.025
export const PROBE_BLUEPRINT_DROP_CHANCE = 0.012
/** Extremely rare alien ship/weapon blueprint — only from alien wrecks. */
export const ALIEN_WRECK_BLUEPRINT_DROP_CHANCE = 0.018

let craftCounter = 0

function storageFor(gameState, bodyId) {
  const storage = (gameState.stationStorage[bodyId] ??= {
    cargo: {},
    miningHold: {},
    shipParts: 0,
    ships: [],
    weapons: {},
    accessories: {},
    blueprints: {}
  })
  storage.weapons ??= {}
  storage.accessories ??= {}
  storage.blueprints ??= {}
  storage.miningHold ??= {}
  return storage
}

export function ensureBlueprintMaps(gameState) {
  gameState.player.ship.blueprints ??= {}
  gameState.craftingJobs ??= []
  gameState.stationStorage ??= {}
  for (const storage of Object.values(gameState.stationStorage)) {
    storage.blueprints ??= {}
    storage.accessories ??= {}
  }
}

export function addBlueprint(targetMap, blueprintId, qty = 1) {
  if (!blueprintId || qty < 1) return
  // Validate id
  getBlueprint(blueprintId)
  targetMap[blueprintId] = (targetMap[blueprintId] ?? 0) + qty
}

export function removeBlueprint(targetMap, blueprintId, qty = 1) {
  const have = targetMap[blueprintId] ?? 0
  if (have < qty) throw new Error('Blueprint not available')
  targetMap[blueprintId] = have - qty
  if (targetMap[blueprintId] <= 0) delete targetMap[blueprintId]
}

export function storeBlueprints(gameState, bodyId) {
  ensureBlueprintMaps(gameState)
  const storage = storageFor(gameState, bodyId)
  const ship = gameState.player.ship
  for (const [id, qty] of Object.entries(ship.blueprints ?? {})) {
    storage.blueprints[id] = (storage.blueprints[id] ?? 0) + qty
  }
  ship.blueprints = {}
}

export function retrieveBlueprints(gameState, bodyId) {
  ensureBlueprintMaps(gameState)
  const storage = storageFor(gameState, bodyId)
  const ship = gameState.player.ship
  ship.blueprints ??= {}
  for (const [id, qty] of Object.entries(storage.blueprints ?? {})) {
    ship.blueprints[id] = (ship.blueprints[id] ?? 0) + qty
  }
  storage.blueprints = {}
}

/**
 * Transfer quantity of one blueprint id ship ↔ station.
 * direction: 'toStation' | 'toShip'
 * Returns { moved, requested, capacityLimited: false }.
 */
export function transferBlueprintItem(gameState, bodyId, blueprintId, quantity, direction) {
  ensureBlueprintMaps(gameState)
  const qty = Math.max(0, Math.floor(Number(quantity) || 0))
  if (qty < 1) return { moved: 0, requested: 0, capacityLimited: false }
  const storage = storageFor(gameState, bodyId)
  const ship = gameState.player.ship
  ship.blueprints ??= {}
  storage.blueprints ??= {}

  if (direction === 'toStation') {
    const available = ship.blueprints[blueprintId] ?? 0
    const moved = Math.min(qty, available)
    if (moved <= 0) return { moved: 0, requested: qty, capacityLimited: false }
    ship.blueprints[blueprintId] = available - moved
    if (ship.blueprints[blueprintId] <= 0) delete ship.blueprints[blueprintId]
    storage.blueprints[blueprintId] = (storage.blueprints[blueprintId] ?? 0) + moved
    return { moved, requested: qty, capacityLimited: false }
  }

  const available = storage.blueprints[blueprintId] ?? 0
  const moved = Math.min(qty, available)
  if (moved <= 0) return { moved: 0, requested: qty, capacityLimited: false }
  storage.blueprints[blueprintId] = available - moved
  if (storage.blueprints[blueprintId] <= 0) delete storage.blueprints[blueprintId]
  ship.blueprints[blueprintId] = (ship.blueprints[blueprintId] ?? 0) + moved
  return { moved, requested: qty, capacityLimited: false }
}

function hasOre(hold, cost) {
  for (const [id, need] of Object.entries(cost)) {
    if ((hold[id] ?? 0) < need) return false
  }
  return true
}

function consumeOre(hold, cost) {
  for (const [id, need] of Object.entries(cost)) {
    hold[id] = (hold[id] ?? 0) - need
    if (hold[id] <= 0) delete hold[id]
  }
}

/**
 * Start assembling at this station. Blueprint + ore must already be in
 * *station* storage (not ship). Duration is wall-clock so it continues across save/load.
 */
export function startCraft(gameState, bodyId, blueprintId, nowMs = Date.now()) {
  ensureBlueprintMaps(gameState)
  const body = findBody(gameState.galaxy, bodyId)
  if (!body || (body.kind !== 'station' && body.kind !== 'settlement')) {
    throw new Error('Industry only available at stations and settlements')
  }
  const storage = storageFor(gameState, bodyId)
  if ((storage.blueprints[blueprintId] ?? 0) < 1) {
    throw new Error('Blueprint must be in station storage before assembling')
  }
  // Industry skill reduces credits + ore materials (player only).
  let industryMult = 1
  try {
    industryMult = playerSkillBonuses(gameState).industryMult
  } catch {
    industryMult = 1
  }
  const oreCost = scaleOreCost(oreCostForBlueprint(blueprintId), industryMult)
  if (!hasOre(storage.miningHold, oreCost)) {
    throw new Error('Not enough ore in station storage for this blueprint')
  }
  const creditCost = Math.max(
    0,
    Math.round(creditCostForBlueprint(blueprintId) * industryMult)
  )
  if (gameState.player.credits < creditCost) {
    throw new Error(`Need ${creditCost}cr for bay fees (have ${gameState.player.credits}cr)`)
  }

  removeBlueprint(storage.blueprints, blueprintId, 1)
  consumeOre(storage.miningHold, oreCost)
  gameState.player.credits -= creditCost

  const durationS = craftDurationS(blueprintId)
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const job = {
    id: `craft-${++craftCounter}-${nowMs}`,
    bodyId,
    systemId: system.id,
    systemName: system.name,
    stationName: body.name,
    blueprintId,
    durationS,
    startedAtWallMs: nowMs,
    completesAtWallMs: nowMs + durationS * 1000,
    completedNotified: false
  }
  gameState.craftingJobs.push(job)
  return job
}

function deliverProduct(gameState, job) {
  const storage = storageFor(gameState, job.bodyId)
  const parsed = parseBlueprintId(job.blueprintId)
  if (!parsed) return
  if (parsed.kind === 'weapon') {
    storage.weapons[parsed.itemId] = (storage.weapons[parsed.itemId] ?? 0) + 1
    return
  }
  if (parsed.kind === 'accessory') {
    storage.accessories[parsed.itemId] = (storage.accessories[parsed.itemId] ?? 0) + 1
    return
  }
  // Ship — same shape as purchaseShip storage entry.
  const shipClass = getShipClass(parsed.itemId)
  storage.ships.push({
    classId: shipClass.id,
    instanceName: shipClass.name,
    hull: shipClass.stats.hull,
    shields: shipClass.stats.shields,
    armor: shipClass.stats.armor,
    cargo: {},
    miningHold: {},
    shipParts: 0,
    equippedWeapons: defaultLoadoutFor(shipClass),
    equippedAccessories: defaultAccessoriesFor(shipClass),
    spareWeapons: {},
    blueprints: {}
  })
}

/**
 * Advance wall-clock crafts. Returns list of newly completed jobs (for toasts).
 * Safe to call every frame and on load.
 */
export function updateCraftingJobs(gameState, nowMs = Date.now()) {
  ensureBlueprintMaps(gameState)
  const newlyDone = []
  const remaining = []
  for (const job of gameState.craftingJobs) {
    if (nowMs >= job.completesAtWallMs) {
      if (!job.completedNotified) {
        deliverProduct(gameState, job)
        job.completedNotified = true
        newlyDone.push(job)
      }
      // Drop finished jobs after notify — product already delivered.
    } else {
      remaining.push(job)
    }
  }
  gameState.craftingJobs = remaining
  return newlyDone
}

export function craftProgress01(job, nowMs = Date.now()) {
  const span = Math.max(1, job.completesAtWallMs - job.startedAtWallMs)
  return Math.min(1, Math.max(0, (nowMs - job.startedAtWallMs) / span))
}

export function craftRemainingS(job, nowMs = Date.now()) {
  return Math.max(0, (job.completesAtWallMs - nowMs) / 1000)
}

export function jobsAtBody(gameState, bodyId) {
  ensureBlueprintMaps(gameState)
  return gameState.craftingJobs.filter((j) => j.bodyId === bodyId)
}

/** Roll a human blueprint into an object map (wreck loot / probe result). */
export function tryRollBlueprintDrop(rng, chance) {
  if (rng() >= chance) return null
  return rollRandomBlueprintId(rng)
}

/** Alien wreck only — never from probes or human salvage. */
export function tryRollAlienBlueprintDrop(rng, chance = ALIEN_WRECK_BLUEPRINT_DROP_CHANCE) {
  if (rng() >= chance) return null
  return rollAlienBlueprintId(rng)
}

export function grantShipBlueprint(gameState, blueprintId) {
  ensureBlueprintMaps(gameState)
  addBlueprint(gameState.player.ship.blueprints, blueprintId, 1)
}

export { getBlueprint, oreCostForBlueprint, creditCostForBlueprint, craftDurationS }
