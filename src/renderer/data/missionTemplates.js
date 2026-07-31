import { pick, intRange } from '../procgen/prng.js'
import { getWorld, getSystem } from '../procgen/world.js'
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

// One sea, so a contract's reach is measured in water rather than jumps.
/** A posting should be a voyage, not a crossing of the whole world. */
const MAX_MISSION_DISTANCE = 24000
/** Close work — half of all postings stay inside this, so there is always
 *  something to take that does not commit you to a long run. */
const NEARBY_MISSION_DISTANCE = 4500
/** Hauls are the long runs: far enough that the hold space is the point. */
const MIN_TRADE_DISTANCE = 11000
const MAX_TRADE_DISTANCE = 32000

/** Distance over the water. Everything floats at sea level, so Y is noise. */
function seaDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

/** Compass bearing from one place to another, for contract flavour text. */
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
function bearingFrom(origin, target) {
  const angle = Math.atan2(target[0] - origin[0], -(target[2] - origin[2]))
  const i = Math.round((angle / (Math.PI * 2)) * 8 + 8) % 8
  return COMPASS[i]
}

/** Eligible bodies in a distance band from a point, nearest-biased. */
function bodiesInRange(world, from, maxDist, minDist = 0, filter = null) {
  const out = []
  for (const body of missionEligibleBodies(world)) {
    if (filter && !filter(body)) continue
    const d = seaDistance(from, body.position)
    if (d < minDist || d > maxDist) continue
    out.push(body)
  }
  return out
}

/**
 * Pick somewhere to send the player. Half of all postings stay close to the
 * harbour that issued them so the board always has short work on it; the rest
 * reach out across the sea.
 */
function pickTargetBody(rng, world, from, filter = null) {
  const near = bodiesInRange(world, from, NEARBY_MISSION_DISTANCE, 0, filter)
  if (near.length && rng() < 0.5) return pick(rng, near)
  const far = bodiesInRange(world, from, MAX_MISSION_DISTANCE, 0, filter)
  if (far.length) return pick(rng, far)
  return near.length ? pick(rng, near) : null
}

function tradeFacilityBodies(system) {
  return (system?.bodies ?? []).filter((b) => b.kind === 'port' || b.kind === 'outpost')
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
  const world = getWorld(galaxy)
  const giverBody = world?.bodies.find((b) => b.id === giverStationId)
  if (!giverBody) return null
  // Bounties stay in the waters around the harbour that posted them, so taking
  // one never commits the player to a crossing just to reach the fight.
  const nearby = bodiesInRange(world, giverBody.position, NEARBY_MISSION_DISTANCE)
  const locationBody = nearby.length ? pick(rng, nearby) : giverBody
  // Open water outside the body's shell — never at body.position, which used to
  // bury bounty targets inside an island.
  const locationHint = spawnPointNearBody(rng, locationBody, world.bodies)
  return {
    id: nextMissionId(),
    type: 'bounty',
    title: `Clear the raider working ${locationBody.name}`,
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
  const world = getWorld(galaxy)
  const giverBody = world?.bodies.find((b) => b.id === giverStationId)
  if (!giverBody) return null
  const targetBody =
    pickTargetBody(rng, world, giverBody.position, (b) => b.kind === 'island') ??
    pickTargetBody(rng, world, giverBody.position)
  if (!targetBody) return null
  return {
    id: nextMissionId(),
    type: 'exploration',
    title: `Chart ${targetBody.name}, ${bearingFrom(giverBody.position, targetBody.position)} of here`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 800, 2500),
    status: 'available',
    objectiveComplete: false,
    target: { kind: 'body', systemId: world.id, bodyId: targetBody.id }
  }
}

const PROBEABLE_KINDS = ['island', 'wreckField']

const isProbeable = (b) => PROBEABLE_KINDS.includes(b.kind)

// Investigation is resolved by sounding the water (see missions.js
// resolveInvestigationProbe), so the target must be somewhere a sonar drone can
// work — never a harbour.
export function generateInvestigationMission(rng, galaxy, giverSystemId, giverStationId) {
  const world = getWorld(galaxy)
  const giverBody = world?.bodies.find((b) => b.id === giverStationId)
  if (!giverBody) return null
  const targetBody = pickTargetBody(rng, world, giverBody.position, isProbeable)
  if (!targetBody) return null
  return {
    id: nextMissionId(),
    type: 'investigation',
    title: `Run down the signal off ${targetBody.name}`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 1200, 3500),
    status: 'available',
    objectiveComplete: false,
    target: { kind: 'body', systemId: world.id, bodyId: targetBody.id }
  }
}

export function generateProbeMission(rng, galaxy, giverSystemId, giverStationId) {
  const world = getWorld(galaxy)
  const giverBody = world?.bodies.find((b) => b.id === giverStationId)
  if (!giverBody) return null
  const targetBody = pickTargetBody(rng, world, giverBody.position, isProbeable)
  if (!targetBody) return null
  return {
    id: nextMissionId(),
    type: 'probe',
    title: `Sound the water around ${targetBody.name} and bring back the survey`,
    giverStationId,
    giverSystemId,
    reward: intRange(rng, 1000, 3000),
    status: 'available',
    objectiveComplete: false,
    target: { kind: 'body', systemId: world.id, bodyId: targetBody.id }
  }
}

/**
 * Buy at the origin harbour (own Barter Units), haul it a long way across the sea,
 * and sell where the market pays more than it cost. Turned in at the
 * destination, not the origin. Reward scales with quantity × price margin.
 */
export function generateTradeMission(rng, galaxy, giverSystemId, giverStationId) {
  const originSystem = getSystem(galaxy, giverSystemId) ?? galaxy.systems.find((s) => s.id === giverSystemId)
  if (!originSystem) return null
  const originBody =
    originSystem.bodies.find((b) => b.id === giverStationId) ??
    tradeFacilityBodies(originSystem)[0]
  if (!originBody) return null

  const destFacilities = bodiesInRange(
    originSystem,
    originBody.position,
    MAX_TRADE_DISTANCE,
    MIN_TRADE_DISTANCE,
    (b) => b.kind === 'port' || b.kind === 'outpost'
  )
  if (!destFacilities.length) return null

  const goods = buyableTradeGoodIds()
  if (!goods.length) return null

  // Try several random dest×good pairs until the margin is positive.
  for (let attempt = 0; attempt < 40; attempt++) {
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
      title: `Haul ${quantity} ${goodName} to ${destBody.name}`,
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
        destSystemId: originSystem.id,
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
  const world = getWorld(galaxy)
  if (!world) return missions
  for (const body of world.bodies) {
    if (!body.hasMissions) continue
    missions.push(...generateMissionsForBody(rng, galaxy, world.id, body.id))
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
  const system = getWorld(gameState.galaxy)
  const body = system?.bodies.find((b) => String(b.id) === id)
  if (!body?.hasMissions) return []

  // Still has board posts or unfinished contracts → leave the board alone.
  if (openMissionCountForBody(gameState, bodyId) > 0) return []

  const fresh = generateMissionsForBody(rng, gameState.galaxy, system.id, body.id)
  if (!fresh.length) return []
  gameState.missions.available.push(...fresh)
  return fresh
}
