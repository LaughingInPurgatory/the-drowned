import { pick, range, intRange } from '../procgen/prng.js'
import { SHIP_CLASSES, ALIEN_SHIP_CLASSES } from '../data/shipClasses.js'
import { defaultLoadoutFor } from '../data/weapons.js'
import { generateHumanName } from '../procgen/names.js'
import {
  exteriorRadiusFor,
  npcExclusionRadiusFor,
  STAR_NPC_EXCLUSION_RADIUS
} from './collision.js'

let npcCounter = 0

// Sorted once so pirate difficulty can be picked as a position in this list
// rather than re-sorting per spawn. Exclude alien + police (not pirate hulls).
const SHIP_CLASSES_BY_PRICE = [...SHIP_CLASSES]
  .filter((c) => !c.alien && c.faction !== 'police')
  .sort((a, b) => a.price - b.price)
// Fraction of the roster a pirate is drawn from around its difficulty band —
// wide enough that pirates at any given distance from the core still vary,
// rather than every pirate at a given coreFraction flying the same hull.
const PIRATE_DIFFICULTY_BAND_FRACTION = 0.3

// Approximate half-length of a typical NPC hull + safety pad outside body shells.
export const NPC_SPAWN_SHIP_RADIUS = 14
export const NPC_SPAWN_CLEARANCE = 80
// Tighter pad while steering (still outside exterior mesh).
export const NPC_FLIGHT_CLEARANCE = 24

// Pirates fly cheaper/weaker hulls near the galactic core and pricier/
// stronger ones toward the rim — coreFraction is the same 0-1 "how far
// toward the rim" value spawnEncounterNear already uses for alien odds.
function pickPirateShipClass(rng, coreFraction) {
  const bandSize = Math.max(1, Math.floor(SHIP_CLASSES_BY_PRICE.length * PIRATE_DIFFICULTY_BAND_FRACTION))
  const maxStart = SHIP_CLASSES_BY_PRICE.length - bandSize
  const start = Math.round(coreFraction * maxStart)
  return SHIP_CLASSES_BY_PRICE[start + intRange(rng, 0, bandSize - 1)]
}

function starExclusionRadius(opts = {}) {
  if (opts.excludeStar === false) return 0
  const r = opts.starRadius
  return r != null && Number.isFinite(r) ? r : STAR_NPC_EXCLUSION_RADIUS
}

/** True if `position` sits inside any solid body / sun shell (+ ship + clearance). */
export function positionOverlapsBodies(
  position,
  bodies,
  shipRadius = NPC_SPAWN_SHIP_RADIUS,
  clearance = NPC_SPAWN_CLEARANCE,
  opts = {}
) {
  const starR = starExclusionRadius(opts)
  if (starR > 0) {
    const need = starR + shipRadius + clearance
    const d = Math.hypot(position[0], position[1], position[2])
    if (d < need) return true
  }
  for (const body of bodies ?? []) {
    const bodyR = npcExclusionRadiusFor(body)
    if (bodyR == null) continue
    const need = bodyR + shipRadius + clearance
    const d = Math.hypot(
      position[0] - body.position[0],
      position[1] - body.position[1],
      position[2] - body.position[2]
    )
    if (d < need) return true
  }
  return false
}

/**
 * Iteratively push a point outside every solid body shell + sun.
 * Used as a final safety net for bounty hints, ambient spawns, probe hostiles,
 * and live NPC flight so ships are never trapped inside mesh.
 */
export function clearPositionOfBodies(
  position,
  bodies,
  shipRadius = NPC_SPAWN_SHIP_RADIUS,
  clearance = NPC_SPAWN_CLEARANCE,
  opts = {}
) {
  const pos = [position[0], position[1], position[2]]
  const starR = starExclusionRadius(opts)

  for (let iter = 0; iter < 24; iter++) {
    let moved = false

    // System primary / sun at local origin.
    if (starR > 0) {
      const need = starR + shipRadius + clearance
      const d = Math.hypot(pos[0], pos[1], pos[2])
      if (d < need) {
        if (d < 1e-6) {
          pos[0] = need
          pos[1] = 0
          pos[2] = 0
        } else {
          const s = need / d
          pos[0] *= s
          pos[1] *= s
          pos[2] *= s
        }
        moved = true
      }
    }

    for (const body of bodies ?? []) {
      const bodyR = npcExclusionRadiusFor(body)
      if (bodyR == null) continue
      const need = bodyR + shipRadius + clearance
      const dx = pos[0] - body.position[0]
      const dy = pos[1] - body.position[1]
      const dz = pos[2] - body.position[2]
      const d = Math.hypot(dx, dy, dz)
      if (d >= need) continue
      if (d < 1e-6) {
        pos[0] = body.position[0] + need
        pos[1] = body.position[1]
        pos[2] = body.position[2]
      } else {
        const s = need / d
        pos[0] = body.position[0] + dx * s
        pos[1] = body.position[1] + dy * s
        pos[2] = body.position[2] + dz * s
      }
      moved = true
    }
    if (!moved) break
  }
  return pos
}

/**
 * Random point outside a host body's exterior shell (and clear of all
 * solid system bodies + sun). Used for bounty locationHints and similar.
 */
export function spawnPointNearBody(rng, body, allBodies = null, opts = {}) {
  const shipRadius = opts.shipRadius ?? NPC_SPAWN_SHIP_RADIUS
  const clearance = opts.clearance ?? NPC_SPAWN_CLEARANCE
  const shell = npcExclusionRadiusFor(body) ?? exteriorRadiusFor(body) ?? collisionRadiusFallback(body)
  const minDist = shell + shipRadius + clearance
  const maxDist = minDist + (opts.extraRange ?? 240)
  const checkBodies = allBodies?.length ? allBodies : [body]
  const clearOpts = { excludeStar: opts.excludeStar, starRadius: opts.starRadius }

  for (let i = 0; i < 48; i++) {
    const dist = range(rng, minDist, maxDist)
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const pos = [
      body.position[0] + dist * Math.sin(phi) * Math.cos(theta),
      body.position[1] + dist * Math.cos(phi) * 0.4,
      body.position[2] + dist * Math.sin(phi) * Math.sin(theta)
    ]
    if (!positionOverlapsBodies(pos, checkBodies, shipRadius, clearance, clearOpts)) return pos
  }
  return clearPositionOfBodies(
    [body.position[0] + minDist + 80, body.position[1], body.position[2]],
    checkBodies,
    shipRadius,
    clearance,
    clearOpts
  )
}

function collisionRadiusFallback(body) {
  if (body?.radius != null && Number.isFinite(body.radius)) return body.radius
  return 80
}

export function spawnNpcWithClass(rng, { shipClassId, position, faction = 'pirate', species = null, bodies = null }) {
  const shipClass = SHIP_CLASSES.find((c) => c.id === shipClassId)
  const pilotName =
    faction === 'police' ? `Patrol ${100 + Math.floor(rng() * 900)}` : species ?? generateHumanName(rng)
  const clearPos = bodies?.length
    ? clearPositionOfBodies(position, bodies)
    : clearPositionOfBodies(position, []) // still clear the sun at origin
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
    shields: shipClass.stats.shields,
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
 * Warp-gate patrol — loiters outside the portal (Sec 4–6 only).
 * Reuses station-patrol AI (patrolAnchor + radius ring).
 */
export function spawnPolicePatrolNearWarpGate(rng, gate, allBodies = null) {
  const shell = exteriorRadiusFor(gate) ?? npcExclusionRadiusFor(gate) ?? gate.radius ?? 140
  // Hollow portals: sit well outside the 2 km activation bubble edge so they
  // don't block F-jumps — patrol a ring ~2.2–2.8 km from the gate centre.
  const minDist = Math.max(shell + NPC_SPAWN_SHIP_RADIUS + 200, 2200)
  const maxDist = minDist + 600
  let position = null
  for (let i = 0; i < 48; i++) {
    const dist = range(rng, minDist, maxDist)
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const candidate = [
      gate.position[0] + dist * Math.sin(phi) * Math.cos(theta),
      gate.position[1] + dist * Math.cos(phi) * 0.35,
      gate.position[2] + dist * Math.sin(phi) * Math.sin(theta)
    ]
    if (!positionOverlapsBodies(candidate, allBodies ?? [gate])) {
      position = candidate
      break
    }
  }
  if (!position) {
    position = clearPositionOfBodies(
      [gate.position[0] + minDist + 100, gate.position[1], gate.position[2]],
      allBodies ?? [gate]
    )
  } else {
    position = clearPositionOfBodies(position, allBodies ?? [gate])
  }

  const npc = spawnNpcWithClass(rng, {
    shipClassId: POLICE_SHIP_CLASS_ID,
    position,
    faction: 'police',
    bodies: allBodies
  })
  npc.stationPatrol = true
  npc.warpGatePatrol = true
  npc.patrolStationId = gate.id
  npc.patrolWarpGateId = gate.id
  npc.patrolAnchor = [...gate.position]
  npc.patrolMinRadius = minDist
  npc.patrolMaxRadius = maxDist
  npc.patrolRadius = maxDist
  return npc
}

/**
 * Ensure higher-security systems have police on station duty (Sec 3–6) and at warp
 * gates (Sec 4–6). Higher security → more patrols per fixture (up to 2).
 * @returns {object[]} newly spawned NPCs
 */
export function ensureStationPolicePatrols(rng, gameState, system, securityRating) {
  if (!gameState || !system || securityRating < 3) return []
  const bodies = system.bodies ?? []
  const spawned = []

  // Stations: Sec 3–6
  const stations = bodies.filter((b) => b.kind === 'station')
  const perStation = securityRating >= 5 ? 2 : 1
  for (const station of stations) {
    const live = (gameState.npcs ?? []).filter(
      (n) =>
        !n.destroyed &&
        n.faction === 'police' &&
        n.stationPatrol &&
        !n.warpGatePatrol &&
        n.patrolStationId === station.id
    ).length
    const need = Math.max(0, perStation - live)
    for (let i = 0; i < need; i++) {
      const npc = spawnPolicePatrolNearStation(rng, station, bodies)
      gameState.npcs.push(npc)
      spawned.push(npc)
    }
  }

  // Warp gates: Sec 4–6 only
  if (securityRating >= 4) {
    const gates = bodies.filter((b) => b.kind === 'warpGate')
    const perGate = securityRating >= 6 ? 2 : 1
    for (const gate of gates) {
      const live = (gameState.npcs ?? []).filter(
        (n) =>
          !n.destroyed &&
          n.faction === 'police' &&
          n.warpGatePatrol &&
          n.patrolWarpGateId === gate.id
      ).length
      const need = Math.max(0, perGate - live)
      for (let i = 0; i < need; i++) {
        const npc = spawnPolicePatrolNearWarpGate(rng, gate, bodies)
        gameState.npcs.push(npc)
        spawned.push(npc)
      }
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

// Spawn distance is kept just beyond typical combat engagement range (see
// ATTACK_RANGE in combat.js) so a new contact shows up on radar first,
// rather than an instant point-blank ambush.
const MIN_SPAWN_DISTANCE = 260
const MAX_SPAWN_DISTANCE = 420
const PIRATE_CHANCE = 0.25
// Alien activity is zero at the galactic core and rises toward the rim (see
// procgen/galaxy.js's coreFraction) — the caller passes coreFraction(system),
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
