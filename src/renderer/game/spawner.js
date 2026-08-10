import { pick, range, intRange } from '../procgen/prng.js'
import { SHIP_CLASSES, ALIEN_SHIP_CLASSES } from '../data/shipClasses.js'
import { defaultLoadoutFor } from '../data/weapons.js'
import { generateHumanName } from '../procgen/names.js'
import { exteriorRadiusFor, npcExclusionRadiusFor } from './collision.js'
import { WORLD_RADIUS } from '../procgen/world.js'

let npcCounter = 0

// Civilian shipping is a background population, not a combat encounter. Keep
// it in the simulation so the sea feels inhabited everywhere, but do not use
// it to fill the near-player encounter cap below.
export const AMBIENT_TRAFFIC_COUNT = 400
const TRAFFIC_HUB_KINDS = new Set(['port', 'outpost'])

// Sorted once so pirate difficulty can be picked as a position in this list
// rather than re-sorting per spawn. Exclude alien + police (not pirate hulls).
const SHIP_CLASSES_BY_PRICE = [...SHIP_CLASSES]
  .filter((c) => !c.alien && c.faction !== 'police')
  .sort((a, b) => a.price - b.price)
// Fraction of the roster a pirate is drawn from around its difficulty band —
// wide enough that pirates at any given distance from the core still vary,
// rather than every raider at a given remoteness running the same hull.
const PIRATE_DIFFICULTY_BAND_FRACTION = 0.3

// Approximate half-length of a typical NPC hull + safety pad outside body shells.
export const NPC_SPAWN_SHIP_RADIUS = 14
export const NPC_SPAWN_CLEARANCE = 80
// Tighter pad while steering (still outside exterior mesh).
export const NPC_FLIGHT_CLEARANCE = 24

// Pirates run cheap, tired hulls in home waters and serious ones out in the
// deep — `remoteness` is the same 0-1 "how far from Haven Reach" value
// spawnEncounterNear already uses for the odds of meeting something worse.
function pickPirateShipClass(rng, coreFraction) {
  const bandSize = Math.max(1, Math.floor(SHIP_CLASSES_BY_PRICE.length * PIRATE_DIFFICULTY_BAND_FRACTION))
  const maxStart = SHIP_CLASSES_BY_PRICE.length - bandSize
  const start = Math.round(coreFraction * maxStart)
  return SHIP_CLASSES_BY_PRICE[start + intRange(rng, 0, bandSize - 1)]
}

/** True if `position` sits inside any solid body shell (+ hull + clearance). */
export function positionOverlapsBodies(
  position,
  bodies,
  shipRadius = NPC_SPAWN_SHIP_RADIUS,
  clearance = NPC_SPAWN_CLEARANCE,
  opts = {}
) {
  for (const body of bodies ?? []) {
    const bodyR = npcExclusionRadiusFor(body)
    if (bodyR == null) continue
    const need = bodyR + shipRadius + clearance
    // Horizontal only: everything floats at sea level, so a vertical term would
    // just measure wave bob and let a boat "clear" an island by riding a crest.
    const d = Math.hypot(position[0] - body.position[0], position[2] - body.position[2])
    if (d < need) return true
  }
  return false
}

/**
 * Iteratively push a point out of every solid body shell, in the horizontal
 * plane. Final safety net for bounty hints, ambient spawns and live NPC
 * steering, so nothing is ever left moored inside a rock.
 */
export function clearPositionOfBodies(
  position,
  bodies,
  shipRadius = NPC_SPAWN_SHIP_RADIUS,
  clearance = NPC_SPAWN_CLEARANCE,
  opts = {}
) {
  const pos = [position[0], position[1], position[2]]

  for (let iter = 0; iter < 24; iter++) {
    let moved = false
    for (const body of bodies ?? []) {
      const bodyR = npcExclusionRadiusFor(body)
      if (bodyR == null) continue
      const need = bodyR + shipRadius + clearance
      const dx = pos[0] - body.position[0]
      const dz = pos[2] - body.position[2]
      const d = Math.hypot(dx, dz)
      if (d >= need) continue
      if (d < 1e-6) {
        pos[0] = body.position[0] + need
        pos[2] = body.position[2]
      } else {
        const s = need / d
        pos[0] = body.position[0] + dx * s
        pos[2] = body.position[2] + dz * s
      }
      moved = true
    }
    if (!moved) break
  }
  return pos
}

/**
 * Random patch of open water outside a place's exterior shell and clear of
 * everything else solid. Used for bounty locationHints and similar.
 */
export function spawnPointNearBody(rng, body, allBodies = null, opts = {}) {
  const shipRadius = opts.shipRadius ?? NPC_SPAWN_SHIP_RADIUS
  const clearance = opts.clearance ?? NPC_SPAWN_CLEARANCE
  const shell = npcExclusionRadiusFor(body) ?? exteriorRadiusFor(body) ?? collisionRadiusFallback(body)
  const minDist = shell + shipRadius + clearance
  const maxDist = minDist + (opts.extraRange ?? 240)
  const checkBodies = allBodies?.length ? allBodies : [body]

  for (let i = 0; i < 48; i++) {
    const dist = range(rng, minDist, maxDist)
    const theta = rng() * Math.PI * 2
    // On the water, always — the sea sets the height (world/sea.js snapToSea).
    const pos = [
      body.position[0] + dist * Math.cos(theta),
      0,
      body.position[2] + dist * Math.sin(theta)
    ]
    if (!positionOverlapsBodies(pos, checkBodies, shipRadius, clearance)) return pos
  }
  return clearPositionOfBodies(
    [body.position[0] + minDist + 80, 0, body.position[2]],
    checkBodies,
    shipRadius,
    clearance
  )
}

function collisionRadiusFallback(body) {
  if (body?.radius != null && Number.isFinite(body.radius)) return body.radius
  return 80
}

export function spawnNpcWithClass(rng, { shipClassId, position, faction = 'pirate', species = null, bodies = null }) {
  const shipClass = SHIP_CLASSES.find((c) => c.id === shipClassId)
  // `galaxy.species` stores records, not strings. Older callers passed one of
  // those records through as `species`, which left pilotName as an object and
  // eventually rendered as "[object Object]" on the death screen.
  const speciesPilot =
    typeof species === 'string' && species.trim()
      ? species.trim()
      : species && typeof species === 'object'
        ? [species.leader, species.name].find((value) => typeof value === 'string' && value.trim())
        : null
  const pilotName =
    faction === 'police'
      ? `Patrol ${100 + Math.floor(rng() * 900)}`
      : speciesPilot || generateHumanName(rng)
  const clearPos = clearPositionOfBodies(position, bodies ?? [])
  clearPos[1] = 0 // afloat; the sea sets the actual height each frame
  // Combat drones are player-only — NPCs never get a drones array, even when
  // their hull class has droneBays for the player shipyard.
  const npc = {
    id: `npc-${npcCounter++}`,
    shipClassId: shipClass.id,
    pilotName,
    faction: faction === 'police' || shipClass.faction === 'police' ? 'police' : faction,
    isAlien: species !== null || !!shipClass.alien,
    position: clearPos,
    velocity: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    hull: shipClass.stats.hull,
    armor: shipClass.stats.armor,
    aiState: 'patrol',
    patrolTarget: null,
    lastHitAt: -Infinity,
    lastFireAt: -Infinity,
    destroyed: false,
    equippedWeapons: defaultLoadoutFor(shipClass)
  }
  // Police get best guns; aliens keep alien default loadout; others may stay base.
  if (npc.faction === 'police') {
    for (const hp of shipClass.hardpoints ?? []) {
      npc.equippedWeapons[hp.id] = hp.type === 'missile' ? 'torpedo' : 'plasma_cannon'
    }
  } else if (shipClass.alien) {
    // Tier up paid alien guns on heavier hulls.
    for (const hp of shipClass.hardpoints ?? []) {
      if (hp.type === 'missile' && shipClass.price >= 100000) {
        npc.equippedWeapons[hp.id] = 'singularity_seed'
      } else if (hp.type === 'laser' && shipClass.price >= 80000) {
        npc.equippedWeapons[hp.id] = 'void_lance'
      } else if (hp.type === 'laser' && shipClass.price >= 55000) {
        npc.equippedWeapons[hp.id] = 'neural_sear'
      }
    }
  }
  return npc
}

export const POLICE_SHIP_CLASS_ID = 'system_patrol'

/** Spawn a police response near the player. */
export function spawnPoliceResponse(rng, { position, bodies = null }) {
  return spawnNpcWithClass(rng, {
    shipClassId: POLICE_SHIP_CLASS_ID,
    position,
    faction: 'police',
    bodies
  })
}

/**
 * Station-guard patrol — orbits outside the station exterior shell.
 * Tagged so AI keeps them near the bay and ensureStationPolicePatrols can count them.
 */
export function spawnPolicePatrolNearStation(rng, station, allBodies = null) {
  const shell = exteriorRadiusFor(station) ?? npcExclusionRadiusFor(station) ?? 500
  const minDist = shell + NPC_SPAWN_SHIP_RADIUS + 80
  const maxDist = minDist + 320
  let position = null
  for (let i = 0; i < 48; i++) {
    const dist = range(rng, minDist, maxDist)
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const candidate = [
      station.position[0] + dist * Math.sin(phi) * Math.cos(theta),
      station.position[1] + dist * Math.cos(phi) * 0.35,
      station.position[2] + dist * Math.sin(phi) * Math.sin(theta)
    ]
    if (!positionOverlapsBodies(candidate, allBodies ?? [station])) {
      position = candidate
      break
    }
  }
  if (!position) {
    position = clearPositionOfBodies(
      [station.position[0] + minDist + 100, station.position[1], station.position[2]],
      allBodies ?? [station]
    )
  } else {
    position = clearPositionOfBodies(position, allBodies ?? [station])
  }

  const npc = spawnNpcWithClass(rng, {
    shipClassId: POLICE_SHIP_CLASS_ID,
    position,
    faction: 'police',
    bodies: allBodies
  })
  npc.stationPatrol = true
  npc.patrolStationId = station.id
  // Loiter in a ring outside the station mesh (never inside exterior shell).
  npc.patrolAnchor = [...station.position]
  npc.patrolMinRadius = minDist
  npc.patrolMaxRadius = maxDist
  npc.patrolRadius = maxDist // legacy field for older code paths
  return npc
}

/**
 * Ensure higher-security harbours have police on duty (Sec 3–6).
 * Uses each port's own securityRating (not a single system value applied to
 * every bay — that used to spawn ~100 patrols on Continue and freeze the load).
 * When nearPos is given, only top up stations within maxDist of the player.
 * @returns {object[]} newly spawned NPCs
 */
export function ensureStationPolicePatrols(
  rng,
  gameState,
  system,
  securityRating,
  { nearPos = null, maxDist = 12000 } = {}
) {
  if (!gameState || !system) return []
  const bodies = system.bodies ?? []
  const spawned = []
  const px = nearPos ? Number(nearPos[0]) || 0 : 0
  const pz = nearPos ? Number(nearPos[2]) || 0 : 0
  const maxD2 = maxDist * maxDist

  const stations = bodies.filter((b) => b.kind === 'port')
  for (const station of stations) {
    // Harbour security first; system rating is only a fallback for old data.
    const sec = Number.isFinite(station.securityRating)
      ? Math.max(0, Math.min(6, Math.floor(station.securityRating)))
      : securityRating
    if (sec < 3) continue
    if (nearPos) {
      const dx = (station.position?.[0] ?? 0) - px
      const dz = (station.position?.[2] ?? 0) - pz
      if (dx * dx + dz * dz > maxD2) continue
    }
    const perStation = sec >= 5 ? 2 : 1
    const live = (gameState.npcs ?? []).filter(
      (n) =>
        !n.destroyed &&
        n.faction === 'police' &&
        n.stationPatrol &&
        n.patrolStationId === station.id
    ).length
    const need = Math.max(0, perStation - live)
    for (let i = 0; i < need; i++) {
      const npc = spawnPolicePatrolNearStation(rng, station, bodies)
      gameState.npcs.push(npc)
      spawned.push(npc)
    }
  }

  return spawned
}

function pickAlienShipClass(rng, coreFraction) {
  if (!ALIEN_SHIP_CLASSES.length) return pick(rng, SHIP_CLASSES)
  // Mild rim bias toward heavier alien hulls (higher price).
  const sorted = [...ALIEN_SHIP_CLASSES].sort((a, b) => a.price - b.price)
  const t = Math.max(0, Math.min(1, coreFraction))
  const idx = Math.min(sorted.length - 1, Math.floor(t * sorted.length + rng() * 0.8))
  // Mix: sometimes pick any hull so rim fights aren't always the same carapace.
  if (rng() < 0.35) return pick(rng, sorted)
  return sorted[idx]
}

export function spawnNpc(rng, { position, faction = 'pirate', species = null, coreFraction = 0, bodies = null }) {
  let shipClass
  if (faction === 'pirate') shipClass = pickPirateShipClass(rng, coreFraction)
  else if (faction === 'alien') shipClass = pickAlienShipClass(rng, coreFraction)
  else {
    // Traders / civilians — human hulls only.
    const human = SHIP_CLASSES.filter((c) => !c.alien && c.faction !== 'police')
    shipClass = pick(rng, human.length ? human : SHIP_CLASSES)
  }
  return spawnNpcWithClass(rng, {
    shipClassId: shipClass.id,
    position,
    faction,
    species,
    bodies
  })
}

function trafficHubsFor(bodies) {
  return (bodies ?? []).filter((body) => TRAFFIC_HUB_KINDS.has(body.kind))
}

function randomOpenWaterPosition(rng, bodies) {
  const maxRadius = Math.max(1000, WORLD_RADIUS - NPC_SPAWN_CLEARANCE - NPC_SPAWN_SHIP_RADIUS)
  for (let attempt = 0; attempt < 64; attempt++) {
    // Uniform density over the playable sea disc, so the fleet is not packed
    // around the centre of the world.
    const radius = Math.sqrt(rng()) * maxRadius
    const angle = rng() * Math.PI * 2
    const candidate = [Math.cos(angle) * radius, 0, Math.sin(angle) * radius]
    if (!positionOverlapsBodies(candidate, bodies)) return candidate
  }
  return clearPositionOfBodies(
    [Math.cos(rng() * Math.PI * 2) * maxRadius, 0, Math.sin(rng() * Math.PI * 2) * maxRadius],
    bodies
  )
}

function randomTradeDestination(rng, hubs, avoidId = null) {
  if (!hubs.length) return null
  const choices = hubs.length > 1 ? hubs.filter((hub) => hub.id !== avoidId) : hubs
  return pick(rng, choices.length ? choices : hubs)
}

/** Spawn background civilian shipping across the whole world. */
export function spawnAmbientTraffic(rng, bodies, count = AMBIENT_TRAFFIC_COUNT) {
  const hubs = trafficHubsFor(bodies)
  const spawned = []
  for (let i = 0; i < count; i++) {
    const destination = randomTradeDestination(rng, hubs)
    const npc = spawnNpc(rng, {
      position: randomOpenWaterPosition(rng, bodies),
      faction: 'trader',
      bodies
    })
    npc.ambientTraffic = true
    npc.aiState = 'trade'
    npc.tradeDestinationId = destination?.id ?? null
    spawned.push(npc)
  }
  return spawned
}

/** Replace only the civilian traffic lost since the last population check. */
export function replenishAmbientTraffic(rng, gameState, bodies, count = AMBIENT_TRAFFIC_COUNT) {
  if (!gameState) return []
  const live = (gameState.npcs ?? []).filter((npc) => npc.ambientTraffic && !npc.destroyed).length
  if (live >= count) return []
  const spawned = spawnAmbientTraffic(rng, bodies, count - live)
  gameState.npcs.push(...spawned)
  return spawned
}

// Spawn distance is kept just beyond typical combat engagement range (see
// ATTACK_RANGE in combat.js) so a new contact shows up on radar first,
// rather than an instant point-blank ambush.
const MIN_SPAWN_DISTANCE = 260
const MAX_SPAWN_DISTANCE = 420
const PIRATE_CHANCE = 0.25
// Alien activity is zero at the galactic core and rises toward the rim (see
// procgen/world.js's remoteness) — the caller passes remoteness(position),
// so this stays decoupled from the galaxy/system shape.
const ALIEN_MAX_CHANCE = 0.4

/** Random point near the player, clear of body shells (and the sun). */
function pickSpawnPositionNear(rng, playerPosition, bodies = null) {
  let position = null
  for (let attempt = 0; attempt < 48; attempt++) {
    const dist = range(rng, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE)
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const candidate = [
      playerPosition[0] + dist * Math.sin(phi) * Math.cos(theta),
      playerPosition[1] + dist * Math.cos(phi) * 0.3,
      playerPosition[2] + dist * Math.sin(phi) * Math.sin(theta)
    ]
    if (!positionOverlapsBodies(candidate, bodies ?? [])) {
      position = candidate
      break
    }
  }
  if (!position) {
    position = clearPositionOfBodies(
      [
        playerPosition[0] + MAX_SPAWN_DISTANCE,
        playerPosition[1],
        playerPosition[2]
      ],
      bodies ?? []
    )
  } else {
    position = clearPositionOfBodies(position, bodies ?? [])
  }
  return position
}

// forceNeutral (used for the player's starting system before its peace is
// ever broken — see main.js) skips the pirate/alien rolls entirely and
// always spawns a trader, so ambient traffic still occurs there but never a
// hostile encounter.
// bodies: system bodies to stay outside of (planets, stations, …).
export function spawnEncounterNear(
  rng,
  playerPosition,
  galaxy,
  coreFraction = 0,
  forceNeutral = false,
  bodies = null
) {
  const position = pickSpawnPositionNear(rng, playerPosition, bodies)

  if (forceNeutral) return spawnNpc(rng, { position, faction: 'trader', bodies })
  const alienChance = coreFraction * ALIEN_MAX_CHANCE
  const roll = rng()
  if (roll < PIRATE_CHANCE) return spawnNpc(rng, { position, faction: 'pirate', coreFraction, bodies })
  if (roll < PIRATE_CHANCE + alienChance && galaxy.species.length) {
    return spawnNpc(rng, {
      position,
      faction: 'alien',
      species: pick(rng, galaxy.species),
      bodies
    })
  }
  return spawnNpc(rng, { position, faction: 'trader', bodies })
}

/**
 * Mining ambush — always a pirate, already in attack posture.
 * Spawns just beyond engagement range so radar picks them up first.
 */
export function spawnMiningPirateAmbush(rng, playerPosition, coreFraction = 0, bodies = null) {
  const position = pickSpawnPositionNear(rng, playerPosition, bodies)
  const npc = spawnNpc(rng, {
    position,
    faction: 'pirate',
    coreFraction,
    bodies
  })
  npc.aiState = 'attack'
  npc.miningAmbush = true
  return npc
}
