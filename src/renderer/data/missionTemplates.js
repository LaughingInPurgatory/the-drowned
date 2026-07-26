import { pick, intRange } from '../procgen/prng.js'
import { systemsWithinJumps, getSystem } from '../procgen/galaxy.js'
import { spawnPointNearBody } from '../game/spawner.js'
import { GOODS, getGood, isBuyableTradeGood } from './goods.js'
import { maxShipCargoCapacity } from './shipClasses.js'

// A plain incrementing counter reset to 0 on every app launch — but the whole
// galaxy's mission board is seeded once at New Game and persists in the save,
// so a later session's freshly-generated ids (board refills) could collide
// with ids already baked into that save. Once two missions share an id,
// acceptMission's id lookup can grab the wrong one and its cleanup step
// deletes both — "accepted a probe mission, got a cargo mission instead".
// A random id has no such restart-dependent state to collide on.
function nextMissionId() {
  return `m-${crypto.randomUUID()}`
}

const BOUNTY_TARGET_CLASSES = ['raider_mk1', 'needle_dart', 'gun_barge', 'light_runner']
// A mission planted in a different system than where it's picked up should
// still be a reasonable trip, not an arbitrary trek across the galaxy.
const MAX_MISSION_JUMP_DISTANCE = 4
/** Trade hauls must be at least this many hyperspace jumps from origin. */
const MIN_TRADE_JUMPS = 4
/** Cap search radius so trade destinations stay in a playable neighborhood. */
const MAX_TRADE_JUMPS = 10

// Bounty targets always spawn in the giver's own system, so accepting one
// never requires a hyperspace jump just to reach the fight. Exploration and
// investigation missions may point at a different system, giving hyperspace
// travel an actual reason to exist — but capped to a handful of jumps away.
function pickTargetSystem(rng, galaxy, giverSystem) {
  if (rng() < 0.5) return giverSystem
  const reachable = systemsWithinJumps(galaxy, giverSystem.id, MAX_MISSION_JUMP_DISTANCE)
  return pick(rng, reachable)
}

/** Systems at jump distance ∈ [minJumps, maxJumps] from origin (excludes closer). */
function systemsAtLeastJumps(galaxy, originSystemId, minJumps, maxJumps) {
  const tooClose = new Set(
    systemsWithinJumps(galaxy, originSystemId, Math.max(0, minJumps - 1)).map((s) => s.id)
  )
  return systemsWithinJumps(galaxy, originSystemId, maxJumps).filter((s) => !tooClose.has(s.id))
}

function tradeFacilityBodies(system) {
  return (system?.bodies ?? []).filter((b) => b.kind === 'station' || b.kind === 'settlement')
}

// Anomaly sites (e.g. a Rare Ore Deposit) register a synthetic body directly
// into system.bodies so mining/targeting/radar reuse the normal asteroidField
// pipeline (see systemScan.js) — tagged anomalySiteId. Anomalies should only
// ever be found by scanning, never handed out as a mission's target/location,
// and one can vanish on the next 4h epoch reshuffle while a mission still
// references it. Exclude them from every "pick a body" candidate pool.
function missionEligibleBodies(system) {
  return (system?.bodies ?? []).filter((b) => !b.anomalySiteId)
}

/** Tag-only unit price (no scarcity / player skill) for mission route viability. */
function tagUnitPrice(body, goodId) {
  const good = getGood(goodId)
  let price = good.basePrice
  for (const tag of body?.economyTags ?? []) {
    const mult = good.tagMultipliers?.[tag]
    if (mult) price *= 1 + mult
  }
  return Math.max(1, Math.round(price))
}

function buyableTradeGoodIds() {
  return GOODS.map((g) => g.id).filter((id) => isBuyableTradeGood(id))
}

export function generateBountyMission(rng, galaxy, giverSystemId, giverStationId) {
  const giverSystem = galaxy.systems.find((s) => s.id === giverSystemId)
  const locationBody = pick(rng, missionEligibleBodies(giverSystem))
  // Outside the body's shell (and clear of other system solids) — never at
  // body.position (planet/station centers used to bury bounty NPCs).
  const locationHint = spawnPointNearBody(rng, locationBody, giverSystem.bodies)
  return {
    id: nextMissionId(),
    type: 'bounty',
    title: `Eliminate hostile near ${locationBody.name}`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 1500, 5000),
    status: 'available',
    objectiveComplete: false,
    target: {
      kind: 'npcShip',
      shipClassId: pick(rng, BOUNTY_TARGET_CLASSES),
      systemId: giverSystemId,
      locationHint,
      npcId: null
    }
  }
}

export function generateExplorationMission(rng, galaxy, giverSystemId, giverStationId) {
  const giverSystem = galaxy.systems.find((s) => s.id === giverSystemId)
  const targetSystem = pickTargetSystem(rng, galaxy, giverSystem)
  const eligible = missionEligibleBodies(targetSystem)
  const planets = eligible.filter((b) => b.kind === 'planet')
  const targetBody = pick(rng, planets.length ? planets : eligible)
  return {
    id: nextMissionId(),
    type: 'exploration',
    title: `Survey ${targetBody.name} in the ${targetSystem.name} system`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 800, 2500),
    status: 'available',
    objectiveComplete: false,
    target: { kind: 'body', systemId: targetSystem.id, bodyId: targetBody.id }
  }
}

const PROBEABLE_KINDS = ['planet', 'moon', 'asteroidField']

function pickProbeableBody(rng, targetSystem) {
  const probeable = missionEligibleBodies(targetSystem).filter((b) => PROBEABLE_KINDS.includes(b.kind))
  // Never fall back to stations/settlements — those aren't probeable with P.
  if (!probeable.length) return null
  return pick(rng, probeable)
}

// Investigation is resolved by probing (see missions.js resolveInvestigationProbe),
// so the target must be a probeable body — never a station/settlement.
export function generateInvestigationMission(rng, galaxy, giverSystemId, giverStationId) {
  const giverSystem = galaxy.systems.find((s) => s.id === giverSystemId)
  // Prefer systems that actually have a probeable body.
  let targetSystem = pickTargetSystem(rng, galaxy, giverSystem)
  let targetBody = pickProbeableBody(rng, targetSystem)
  if (!targetBody) {
    for (let i = 0; i < 12 && !targetBody; i++) {
      targetSystem = pickTargetSystem(rng, galaxy, giverSystem)
      targetBody = pickProbeableBody(rng, targetSystem)
    }
  }
  if (!targetBody) return null
  return {
    id: nextMissionId(),
    type: 'investigation',
    title: `Investigate the signal near ${targetBody.name} in ${targetSystem.name}`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 1200, 3500),
    status: 'available',
    objectiveComplete: false,
    target: { kind: 'body', systemId: targetSystem.id, bodyId: targetBody.id }
  }
}

export function generateProbeMission(rng, galaxy, giverSystemId, giverStationId) {
  const giverSystem = galaxy.systems.find((s) => s.id === giverSystemId)
  let targetSystem = pickTargetSystem(rng, galaxy, giverSystem)
  let targetBody = pickProbeableBody(rng, targetSystem)
  if (!targetBody) {
    for (let i = 0; i < 12 && !targetBody; i++) {
      targetSystem = pickTargetSystem(rng, galaxy, giverSystem)
      targetBody = pickProbeableBody(rng, targetSystem)
    }
  }
  if (!targetBody) return null
  return {
    id: nextMissionId(),
    type: 'probe',
    title: `Probe ${targetBody.name} in the ${targetSystem.name} system for survey data`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 1000, 3000),
    status: 'available',
    objectiveComplete: false,
    target: { kind: 'body', systemId: targetSystem.id, bodyId: targetBody.id }
  }
}

/**
 * Buy goods at origin (own credits), haul ≥4 jumps, sell at destination where
 * the bay pays more than origin buy cost. Turn in at destination (not origin).
 * Reward scales with quantity × price margin.
 */
export function generateTradeMission(rng, galaxy, giverSystemId, giverStationId) {
  const originSystem = getSystem(galaxy, giverSystemId) ?? galaxy.systems.find((s) => s.id === giverSystemId)
  if (!originSystem) return null
  const originBody =
    originSystem.bodies.find((b) => b.id === giverStationId) ??
    tradeFacilityBodies(originSystem)[0]
  if (!originBody) return null

  const destSystems = systemsAtLeastJumps(galaxy, originSystem.id, MIN_TRADE_JUMPS, MAX_TRADE_JUMPS)
  if (!destSystems.length) return null

  const goods = buyableTradeGoodIds()
  if (!goods.length) return null

  // Try several random origin→dest×good pairs until margin is positive.
  for (let attempt = 0; attempt < 40; attempt++) {
    const destSystem = pick(rng, destSystems)
    const destFacilities = tradeFacilityBodies(destSystem)
    if (!destFacilities.length) continue
    const destBody = pick(rng, destFacilities)
    const goodId = pick(rng, goods)
    const originBuy = tagUnitPrice(originBody, goodId)
    const destSell = tagUnitPrice(destBody, goodId)
    if (destSell <= originBuy) continue

    // Hauls span light-trader loads up to the largest freighter hold in the game.
    const maxCargo = maxShipCargoCapacity()
    const minHaul = 50
    const quantity = intRange(rng, minHaul, Math.max(minHaul, maxCargo))
    const unitMargin = destSell - originBuy
    // Contract bonus scales with haul size and arbitrage margin.
    const reward = Math.max(
      800,
      Math.round(quantity * unitMargin * 0.85 + quantity * 12)
    )
    const goodName = getGood(goodId).name
    return {
      id: nextMissionId(),
      type: 'trade',
      title: `Haul ${quantity} ${goodName} to ${destSystem.name}`,
      giverStationId,
      giverSystemId,
      reward,
      status: 'available',
      objectiveComplete: false,
      trade: {
        goodId,
        quantity,
        originBodyId: originBody.id,
        originSystemId: originSystem.id,
        destBodyId: destBody.id,
        destSystemId: destSystem.id,
        originBuyPrice: originBuy,
        destSellPrice: destSell,
        purchased: 0,
        sold: 0
      },
      // Nav target starts at origin buy bay; missions.js advances after purchase.
      target: {
        kind: 'body',
        systemId: originSystem.id,
        bodyId: originBody.id
      }
    }
  }
  return null
}

const GENERATORS = [
  generateBountyMission,
  generateExplorationMission,
  generateInvestigationMission,
  generateProbeMission,
  generateTradeMission
]

/** Post a fresh batch of board contracts for one station/settlement. */
export function generateMissionsForBody(rng, galaxy, systemId, bodyId, count = null) {
  const n = count ?? intRange(rng, 1, 3)
  const missions = []
  for (let i = 0; i < n; i++) {
    const mission = pick(rng, GENERATORS)(rng, galaxy, systemId, bodyId)
    if (mission) missions.push(mission)
  }
  // Rare: every draw returned null (no probeable targets). Try each generator once.
  if (!missions.length) {
    for (const gen of GENERATORS) {
      const mission = gen(rng, galaxy, systemId, bodyId)
      if (mission) {
        missions.push(mission)
        break
      }
    }
  }
  return missions
}

export function seedMissionsForGalaxy(rng, galaxy) {
  const missions = []
  for (const system of galaxy.systems) {
    for (const body of system.bodies) {
      if (!body.hasMissions) continue
      missions.push(...generateMissionsForBody(rng, galaxy, system.id, body.id))
    }
  }
  return missions
}

/** Available + active contracts posted by this station/settlement (string ids). */
export function openMissionCountForBody(gameState, bodyId) {
  const id = String(bodyId)
  let n = 0
  for (const m of gameState.missions?.available ?? []) {
    if (String(m.giverStationId) === id) n++
  }
  for (const m of gameState.missions?.active ?? []) {
    if (String(m.giverStationId) === id) n++
  }
  return n
}

/**
 * Refill a station/settlement board only after *every* contract from that body
 * is gone — none left available on the board, and none still active (must be
 * turned in or dropped first). Accepting a contract must never refill.
 * @returns {object[]} newly generated missions (empty if anything still open)
 */
export function refillMissionsIfExhausted(gameState, bodyId, rng) {
  if (!bodyId || !gameState?.galaxy || typeof rng !== 'function') return []
  const id = String(bodyId)
  const system = gameState.galaxy.systems.find((s) => s.bodies.some((b) => String(b.id) === id))
  const body = system?.bodies.find((b) => String(b.id) === id)
  if (!body?.hasMissions) return []

  // Still has board posts or unfinished contracts → leave the board alone.
  if (openMissionCountForBody(gameState, bodyId) > 0) return []

  const fresh = generateMissionsForBody(rng, gameState.galaxy, system.id, body.id)
  if (!fresh.length) return []
  gameState.missions.available.push(...fresh)
  return fresh
}
