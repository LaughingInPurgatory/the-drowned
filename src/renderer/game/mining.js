import { mulberry32, intRange, range } from '../procgen/prng.js'
import { remoteness, inHomeWaters } from '../procgen/world.js'
import { MINED_ORE_GOOD_IDS, getGood } from '../data/goods.js'
import { effectiveMiningCapacity } from '../data/accessories.js'
import { getWeapon, BASE_WEAPON_ID } from '../data/weapons.js'
import { getSystemSecurity } from './security.js'

/** Security 0–3: mining can draw pirate attention. */
export const MINING_PIRATE_MAX_SECURITY = 3
/** Chance per successful mine hit to spawn a pirate ambush. */
export const MINING_PIRATE_CHANCE = 0.1
/**
 * Min sim-time between mining ambush spawns.
 * Without this, a 0.25s laser would nearly guarantee a fleet in seconds.
 */
export const MINING_PIRATE_SPAWN_COOLDOWN_S = 60

// Default laser (pulse_laser, damage 6) → 1 ore; default missile (rocket_pod, 30) → 2.
const LASER_BASE_DAMAGE = 6
const MISSILE_BASE_DAMAGE = 30
const LASER_BASE_YIELD = 1
const MISSILE_BASE_YIELD = 2

/**
 * Ore stripped from a rock per hit, scaled by weapon power.
 * pulse_laser → 1, rocket_pod → 2; stronger guns scale up from there.
 *
 * @param {{ damage?: number, category?: string, id?: string } | string | null} weaponOrId
 */
export function mineYieldForWeapon(weaponOrId) {
  let weapon = weaponOrId
  if (typeof weaponOrId === 'string') {
    try {
      weapon = getWeapon(weaponOrId)
    } catch {
      weapon = getWeapon(BASE_WEAPON_ID.laser)
    }
  }
  if (!weapon || typeof weapon.damage !== 'number') return LASER_BASE_YIELD
  if (weapon.category === 'missile') {
    return Math.max(
      1,
      Math.round((weapon.damage / MISSILE_BASE_DAMAGE) * MISSILE_BASE_YIELD)
    )
  }
  return Math.max(1, Math.round((weapon.damage / LASER_BASE_DAMAGE) * LASER_BASE_YIELD))
}

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function rockKey(fieldId, index) {
  return `${fieldId}:${index}`
}

// Deterministic per-rock seed (same hashString(id) convention as
// render/asteroidFieldMesh.js's own rock scatter) — only used to roll the
// rock's max ore/respawn delay, not its remaining ore, which is mutable
// state that has to live in gameState instead (see rockState below).
function rockSeed(fieldId, index) {
  return hashString(rockKey(fieldId, index))
}

const ORE_MIN = 10
const ORE_MAX = 200

function rollMaxOre(fieldId, index) {
  return intRange(mulberry32(rockSeed(fieldId, index)), ORE_MIN, ORE_MAX)
}

// ~12-24hrs of campaign time (wall-clock-driven simTime — see game/gameClock.js).
// Persisted with the save so fields keep respawning while the player is offline.
const RESPAWN_MIN_S = 12 * 3600
const RESPAWN_MAX_S = 24 * 3600

function rollRespawnDelay(fieldId, index) {
  // +1 on the seed so this doesn't roll the exact same sequence as
  // rollMaxOre off the same rock.
  return range(mulberry32(rockSeed(fieldId, index) + 1), RESPAWN_MIN_S, RESPAWN_MAX_S)
}

// Lazily creates a rock's mutable mining state on first touch — same
// lazy-create-on-first-use pattern as game/economy.js's storageFor.
// Persisted in save.js (asteroids map) so offline hours count toward respawn.
function rockState(gameState, fieldId, index) {
  gameState.asteroids ??= {}
  const key = rockKey(fieldId, index)
  return (gameState.asteroids[key] ??= { ore: rollMaxOre(fieldId, index), destroyedAt: null })
}

// A depleted rock "explodes" (see game/combat.js/main.js) and stops being
// targetable/mineable until its own randomly-rolled respawn delay passes,
// at which point it comes back at full ore — as if it had never been
// touched, rather than resuming some partial state.
export function isRockAlive(gameState, fieldId, index) {
  const state = rockState(gameState, fieldId, index)
  if (state.destroyedAt == null) return true
  if (gameState.simTime - state.destroyedAt < rollRespawnDelay(fieldId, index)) return false
  state.ore = rollMaxOre(fieldId, index)
  state.destroyedAt = null
  return true
}

// Salvage grade is set by how far out the wreck lies. Picked-over hulks in
// home waters give up scrap and little else; the deep still holds warship
// plate and intact pre-war cores, which is the whole reason to sail out
// there. Every wreck in a field shares its field's grade (stripping any of
// them already gave the same material regardless of which), so this also
// names every hulk the field displays (see rockDisplayName).
export function oreTierForField(field) {
  const t = remoteness(field?.position)
  const index = Math.min(MINED_ORE_GOOD_IDS.length - 1, Math.floor(t * MINED_ORE_GOOD_IDS.length))
  return MINED_ORE_GOOD_IDS[index]
}

export function rockDisplayName(field, oreOverride = null) {
  return `${getGood(oreOverride ?? oreTierForField(field)).name} Wreck`
}

/** Remaining mineable ore on a rock (lazy-inits state if needed). */
export function rockOreRemaining(gameState, fieldId, index) {
  if (!isRockAlive(gameState, fieldId, index)) return 0
  return rockState(gameState, fieldId, index).ore
}

/** Max ore this rock starts with (deterministic from field/index). */
export function rockOreMax(fieldId, index) {
  return rollMaxOre(fieldId, index)
}

/** Seconds until a destroyed rock respawns (0 if alive / ready now). */
export function rockRespawnRemainingS(gameState, fieldId, index) {
  const state = rockState(gameState, fieldId, index)
  if (state.destroyedAt == null) return 0
  const delay = rollRespawnDelay(fieldId, index)
  const rem = delay - (gameState.simTime - state.destroyedAt)
  return rem > 0 ? rem : 0
}

/**
 * True when every rock in the field is currently destroyed.
 * @param {number} rockCount from getAsteroidRocks(field).length
 */
export function isFieldDepleted(gameState, fieldId, rockCount) {
  for (let i = 0; i < rockCount; i++) {
    if (isRockAlive(gameState, fieldId, i)) return false
  }
  return rockCount > 0
}

/**
 * Seconds until the next rock in a depleted field respawns
 * (when mining becomes available again). 0 if any rock is alive.
 */
export function fieldRespawnRemainingS(gameState, fieldId, rockCount) {
  let minRem = Infinity
  let anyAlive = false
  for (let i = 0; i < rockCount; i++) {
    // Check without reviving first via remaining; isRockAlive may revive.
    const rem = rockRespawnRemainingS(gameState, fieldId, i)
    if (rem <= 0) {
      // Alive or just ready — confirm via isRockAlive (may revive this tick).
      if (isRockAlive(gameState, fieldId, i)) anyAlive = true
    } else {
      minRem = Math.min(minRem, rem)
    }
  }
  if (anyAlive) return 0
  return minRem === Infinity ? 0 : minRem
}

/** Human-readable countdown for ore-field / rock respawn toasts. */
export function formatRespawnTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  if (s >= 3600) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r > 0 ? `${m}m ${r}s` : `${m}m`
  }
  return `${s}s`
}

// Hits a specific rock with a mining weapon. Ore is always stripped from the
// rock (so a full hold still lets you exhaust and explode it); scoop into the
// ore hold only when there is free capacity.
//
// amount: ore to chip off (weapon-scaled; defaults to 1 for pulse laser)
// mined: rock took a mining hit (ore reduced)
// scooped: any ore landed in the hold
// scoopedAmount: units actually scooped
// amount: units stripped from the rock
// destroyed: this hit emptied the rock
export function mineRock(gameState, shipClass, field, fieldId, index, amount = 1, oreOverride = null) {
  const goodId = oreOverride ?? oreTierForField(field)
  if (!isRockAlive(gameState, fieldId, index)) {
    return { goodId, mined: false, scooped: false, scoopedAmount: 0, amount: 0, destroyed: false }
  }

  const yieldAmt = Math.max(1, Math.floor(amount))
  const state = rockState(gameState, fieldId, index)
  const stripped = Math.min(state.ore, yieldAmt)
  state.ore -= stripped
  const destroyed = state.ore <= 0
  if (destroyed) state.destroyedAt = gameState.simTime

  const hold = gameState.player.ship.miningHold
  const used = Object.values(hold).reduce((a, b) => a + b, 0)
  // Capacity includes Extra Salvage Hold accessory while equipped.
  const cap = effectiveMiningCapacity(gameState.player.ship, shipClass)
  const free = Math.max(0, cap - used)
  const scoopedAmount = Math.min(stripped, free)
  if (scoopedAmount > 0) {
    hold[goodId] = (hold[goodId] ?? 0) + scoopedAmount
  }

  return {
    goodId,
    mined: true,
    scooped: scoopedAmount > 0,
    scoopedAmount,
    amount: stripped,
    destroyed
  }
}

/**
 * Roll whether mining just attracted pirates (Sec 0–3 only, 10% per hit).
 * Stamps a cooldown on success so laser spam cannot stack ambushes.
 *
 * @param {() => number} rng 0–1
 * @param {object} gameState
 * @param {object | null | undefined} system
 * @returns {boolean}
 */
export function rollMiningPirateAmbush(rng, gameState, system) {
  if (!gameState || !system) return false
  if (getSystemSecurity(system) > MINING_PIRATE_MAX_SECURITY) return false
  // Same peace rule as ambient hostiles: Haven Reach's waters stay quiet until
  // the player starts something there.
  if (inHomeWaters(gameState.player?.ship?.position) && !gameState.flags?.startingSystemPeaceBroken) {
    return false
  }
  const last = gameState.flags?.lastMiningPirateAmbushAt
  if (
    last != null &&
    Number.isFinite(last) &&
    gameState.simTime - last < MINING_PIRATE_SPAWN_COOLDOWN_S
  ) {
    return false
  }
  if ((rng?.() ?? Math.random()) >= MINING_PIRATE_CHANCE) return false
  gameState.flags ??= {}
  gameState.flags.lastMiningPirateAmbushAt = gameState.simTime
  return true
}
