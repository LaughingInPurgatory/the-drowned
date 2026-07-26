// Temporary dev/test loadout. Flip DEV_TEST_SETUP to false for normal New Game.
// When true, the intro menu still appears; starting a New Game applies cheats.
import { createGameState } from './state.js'
import { CANONICAL_GALAXY_SEED } from '../procgen/galaxy.js'
import { getShipClass } from '../data/shipClasses.js'
import { defaultLoadoutFor } from '../data/weapons.js'
import { defaultAccessoriesFor } from '../data/accessories.js'
import { ensureDrones, installDroneOnShip } from './drones.js'
import { DEFAULT_DRONE_ID } from '../data/drones.js'

/** When true, New Game uses the test ship + resources (menu still boots normally). */
export const DEV_TEST_SETUP = false

// Far Reach: explorer, 2 drone bays, laser + missile, 3 accessory slots.
const DEV_SHIP_CLASS_ID = 'far_reach'

/**
 * @param {{ characterName?: string, shipInstanceName?: string, seed?: number }} [opts]
 */
export function createDevTestGameState(opts = {}) {
  const gameState = createGameState({
    characterName: opts.characterName || 'Test Pilot',
    shipInstanceName: opts.shipInstanceName || 'Far Reach',
    shipClassId: DEV_SHIP_CLASS_ID,
    seed: opts.seed ?? Math.floor(Math.random() * 1e9),
    galaxySeed: CANONICAL_GALAXY_SEED
  })
  applyDevTestLoadout(gameState, opts)
  return gameState
}

/**
 * @param {object} gameState
 * @param {{ shipInstanceName?: string }} [opts]
 */
export function applyDevTestLoadout(gameState, opts = {}) {
  const shipClass = getShipClass(DEV_SHIP_CLASS_ID)
  const ship = gameState.player.ship

  ship.classId = DEV_SHIP_CLASS_ID
  ship.instanceName = opts.shipInstanceName || 'Far Reach'

  ship.hull = shipClass.stats.hull
  ship.shields = shipClass.stats.shields
  ship.armor = shipClass.stats.armor

  // Best weapons per hardpoint type.
  ship.equippedWeapons = defaultLoadoutFor(shipClass)
  for (const hp of shipClass.hardpoints) {
    if (hp.type === 'laser') ship.equippedWeapons[hp.id] = 'plasma_cannon'
    else if (hp.type === 'missile') ship.equippedWeapons[hp.id] = 'torpedo'
  }

  // Autopilot in first accessory slot.
  ship.equippedAccessories = defaultAccessoriesFor(shipClass)
  if (ship.equippedAccessories.length >= 1) ship.equippedAccessories[0] = 'autopilot'

  ship.spareWeapons ??= {}
  ship.blueprints ??= {}
  ship.cargo ??= {}
  ship.miningHold = {}
  ship.shipParts = ship.shipParts ?? 0

  // Player-only combat drones for the two bays (normally bought from Armoury).
  ensureDrones(ship, shipClass)
  ship.drones = []
  try {
    installDroneOnShip(ship, DEFAULT_DRONE_ID, shipClass)
    installDroneOnShip(ship, DEFAULT_DRONE_ID, shipClass)
  } catch {
    /* hull may have fewer bays */
  }

  gameState.player.credits = 999_999

  gameState.player.dockedBodyId = null
  gameState.player.dockedExteriorPosition = null
  gameState.player.dockedApproachDir = null

  return gameState
}
