/**
 * Runtime helpers for Anomalous Signal sites once fully scanned.
 */
import { intRange } from '../procgen/prng.js'
import { spawnNpc } from './spawner.js'
import {
  rollSiteLoot,
  markAlienBaseDestroyed,
  markAnomalyCompleted,
  allDatacoreNodulesDone,
  ALIEN_SITE_DESPAWN_S
} from './systemScan.js'
import { ALIEN_SHIP_CLASSES } from '../data/shipClasses.js'

export const SITE_ACTIVATION_RANGE = 12000
/** Approach range to hack a sealed nodule with F (generous so the site is usable). */
export const NODULE_PROBE_RANGE = 1000

/**
 * Spawn one alien wave near anomaly position.
 * @returns {object[]} npcs
 */
export function spawnAlienIncursionWave(rng, anomaly, waveIndex, systemBodies, coreFraction = 0.5) {
  const n = 2 + intRange(rng, 0, 3) // 2–5
  const npcs = []
  const base = anomaly.position
  for (let i = 0; i < n; i++) {
    const ang = rng() * Math.PI * 2
    // Tighter formation than a generic guard wave — reads as a coordinated pack.
    const d = 300 + rng() * 450
    const position = [
      base[0] + Math.cos(ang) * d,
      base[1] + (rng() - 0.5) * 200,
      base[2] + Math.sin(ang) * d
    ]
    const hull =
      ALIEN_SHIP_CLASSES[Math.floor(rng() * Math.max(1, ALIEN_SHIP_CLASSES.length))] ?? null
    const npc = spawnNpc(rng, {
      position,
      faction: 'alien',
      coreFraction,
      bodies: systemBodies
    })
    if (hull) npc.shipClassId = hull.id
    npc.anomalySiteId = anomaly.id
    npc.anomalyWave = waveIndex
    npcs.push(npc)
  }
  return npcs
}

/**
 * Spawn a batch of guard/ambush NPCs at an anomaly site (datacore takeover
 * guards, alien datacore guards, or an ore-anomaly pirate ambush). Unlike
 * spawnAlienIncursionWave this isn't wave-indexed — all requested guards
 * spawn at once and are tagged so the epoch-reshuffle NPC sweep clears them.
 */
export function spawnGuardWave(
  rng,
  anomaly,
  count,
  systemBodies,
  coreFraction = 0.5,
  faction = 'pirate',
  { minDist = 600, maxDist = 1500 } = {}
) {
  const npcs = []
  const base = anomaly.position
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2
    const d = minDist + rng() * (maxDist - minDist)
    const position = [
      base[0] + Math.cos(ang) * d,
      base[1] + (rng() - 0.5) * 200,
      base[2] + Math.sin(ang) * d
    ]
    const npc = spawnNpc(rng, { position, faction, coreFraction, bodies: systemBodies })
    npc.anomalySiteId = anomaly.id
    npcs.push(npc)
  }
  return npcs
}

export function grantLootToShip(gameState, loot) {
  if (!loot || !gameState?.player?.ship) return
  const ship = gameState.player.ship
  const cargo = ship.cargo
  for (const [id, qty] of Object.entries(loot.cargo ?? {})) {
    cargo[id] = (cargo[id] ?? 0) + qty
  }
  if (loot.shipParts) {
    ship.shipParts = (ship.shipParts ?? 0) + loot.shipParts
  }
  ship.blueprints ??= {}
  for (const [blueprintId, qty] of Object.entries(loot.blueprints ?? {})) {
    ship.blueprints[blueprintId] = (ship.blueprints[blueprintId] ?? 0) + qty
  }
  ship.skillbooks ??= {}
  for (const [skillId, qty] of Object.entries(loot.skillbooks ?? {})) {
    ship.skillbooks[skillId] = (ship.skillbooks[skillId] ?? 0) + qty
  }
}

export function applyAlienBaseKill(gameState, anomaly, rng, simTime) {
  const credits = anomaly.creditsReward ?? 6000
  gameState.player.credits += credits
  markAlienBaseDestroyed(anomaly, simTime)
  // Alien site wreck: rare alien BPs + skillbooks (very small chance).
  const loot = rollSiteLoot(rng, {
    valuableChance: 0.25,
    gameState,
    alien: true
  })
  return { credits, loot }
}

export function applyDatacoreNoduleSuccess(gameState, anomaly, nodule, rng) {
  nodule.status = 'open'
  nodule.looted = true
  const loot = rollSiteLoot(rng, {
    valuableChance: 0.3,
    gameState,
    alien: false
  })
  grantLootToShip(gameState, loot)
  if (allDatacoreNodulesDone(anomaly)) {
    markAnomalyCompleted(anomaly, gameState.simTime)
  }
  return loot
}

/** Failed hack: the nodule blows up and is gone for good (not just sealed-off debris). */
export function applyDatacoreNoduleFail(anomaly, nodule, simTime) {
  anomaly.nodules = (anomaly.nodules ?? []).filter((n) => n.id !== nodule.id)
  if (allDatacoreNodulesDone(anomaly)) {
    markAnomalyCompleted(anomaly, simTime)
  }
}

export { SITE_ACTIVATION_RANGE as ANOMALY_SITE_RANGE, ALIEN_SITE_DESPAWN_S }
