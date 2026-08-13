import { ensureBountyNpcsForSystem, updateMissionProgress } from './missions.js'
import { getShipClass, resolveShipClassId, SHIP_CLASSES, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { resolveDroneId } from '../data/drones.js'
import { defaultLoadoutFor } from '../data/weapons.js'
import { defaultAccessoriesFor, normalizeAccessories } from '../data/accessories.js'
import { ensureBlueprintMaps, updateCraftingJobs } from './crafting.js'
import { applyOfflineTime, reanchorGameClock } from './gameClock.js'
import { ensureDrones } from './drones.js'
import { ensureLawStanding } from './security.js'
import { generateWorld, getWorld, CANONICAL_WORLD_SEED } from '../procgen/world.js'
import { seedMissionsForGalaxy } from '../data/missionTemplates.js'
import { mulberry32 } from '../procgen/prng.js'
import { tickGalaxyAnomalies } from './systemScan.js'
import { ensureSkills } from './skills.js'
import { normalizeAvatarSelection, randomAvatarSelection } from '../render/playerAvatarVariants.js'

/** Player/assets-only save. Older files that embed `galaxy` are version 1. */
export const SAVE_VERSION = 2

/** Remap qty map keys through a resolver, merging collisions. */
function remapCountMap(map, resolveKey) {
  if (!map || typeof map !== 'object') return map
  const next = {}
  for (const [key, qty] of Object.entries(map)) {
    const n = Number(qty) || 0
    if (n <= 0) continue
    const k = resolveKey(key) ?? key
    next[k] = (next[k] ?? 0) + n
  }
  return next
}

function resolveBlueprintId(blueprintId) {
  if (!blueprintId || typeof blueprintId !== 'string') return blueprintId
  if (!blueprintId.startsWith('ship:')) return blueprintId
  const oldId = blueprintId.slice(5)
  const newId = resolveShipClassId(oldId)
  return newId !== oldId ? `ship:${newId}` : blueprintId
}

/**
 * Rewrite renamed ship / drone ids so older saves load after roster renames.
 * getShipClass / getDrone also accept aliases; this persists the new ids on next save.
 */
/** Rewrite class ids that no longer exist (renames + re-rolled gen roster). */
function coerceShipClassId(classId) {
  if (classId == null || classId === '') return classId
  const resolved = resolveShipClassId(classId)
  if (SHIP_CLASSES.some((c) => c.id === resolved)) return resolved
  // Orphaned gen_* from a previous roster seed → stable fallback.
  try {
    return getShipClass(resolved).id
  } catch {
    return STARTER_SHIP_CLASS_ID
  }
}

function migrateLegacyIds(gameState) {
  const ship = gameState.player?.ship
  if (ship) {
    if (ship.classId) ship.classId = coerceShipClassId(ship.classId)
    if (Array.isArray(ship.drones)) {
      for (const d of ship.drones) {
        if (d?.typeId) d.typeId = resolveDroneId(d.typeId)
      }
    }
    if (ship.blueprints) ship.blueprints = remapCountMap(ship.blueprints, resolveBlueprintId)
  }

  for (const storage of Object.values(gameState.stationStorage ?? {})) {
    if (!storage) continue
    const parkedShips = Array.isArray(storage.ships) ? storage.ships : []
    for (const parked of parkedShips) {
      if (parked?.classId) parked.classId = coerceShipClassId(parked.classId)
      if (Array.isArray(parked?.drones)) {
        for (const d of parked.drones) {
          if (d?.typeId) d.typeId = resolveDroneId(d.typeId)
        }
      }
      if (parked?.blueprints) parked.blueprints = remapCountMap(parked.blueprints, resolveBlueprintId)
    }
    if (storage.drones) storage.drones = remapCountMap(storage.drones, resolveDroneId)
    if (storage.blueprints) storage.blueprints = remapCountMap(storage.blueprints, resolveBlueprintId)
  }

  const jobs = Array.isArray(gameState.craftingJobs) ? gameState.craftingJobs : []
  for (const job of jobs) {
    if (job?.blueprintId) job.blueprintId = resolveBlueprintId(job.blueprintId)
  }

  // missions is { available, active }, not a flat array.
  const missionLists = []
  if (Array.isArray(gameState.missions?.available)) missionLists.push(gameState.missions.available)
  if (Array.isArray(gameState.missions?.active)) missionLists.push(gameState.missions.active)
  if (Array.isArray(gameState.missions)) missionLists.push(gameState.missions)
  for (const list of missionLists) {
    for (const mission of list) {
      if (!mission || typeof mission !== 'object') continue
      if (mission.targetShipClassId) {
        mission.targetShipClassId = resolveShipClassId(mission.targetShipClassId)
      }
      if (mission.shipClassId) {
        mission.shipClassId = resolveShipClassId(mission.shipClassId)
      }
      // Bounty missions store the hull under target.shipClassId
      if (mission.target?.shipClassId) {
        mission.target.shipClassId = resolveShipClassId(mission.target.shipClassId)
      }
      const objectives = Array.isArray(mission.objectives) ? mission.objectives : []
      for (const obj of objectives) {
        if (obj?.shipClassId) obj.shipClassId = resolveShipClassId(obj.shipClassId)
        if (obj?.targetShipClassId) obj.targetShipClassId = resolveShipClassId(obj.targetShipClassId)
      }
    }
  }

  // Repair id collisions from saves written before mission ids became
  // crypto.randomUUID()-based (see nextMissionId() in missionTemplates.js) —
  // a counter that reset every app launch could hand a fresh mission an id
  // already baked into an older save, and acceptMission's id lookup would
  // then grab whichever of the two matched first. Keep the first occurrence
  // as-is; give every later duplicate a fresh, permanently unique id.
  const seenMissionIds = new Set()
  for (const list of missionLists) {
    for (const mission of list) {
      if (!mission || typeof mission !== 'object' || !mission.id) continue
      if (seenMissionIds.has(mission.id)) {
        mission.id = `m-${crypto.randomUUID()}`
      }
      seenMissionIds.add(mission.id)
    }
  }
}

function isLegacyWorldSave(data) {
  if (!data || typeof data !== 'object') return false
  if (data.galaxy && typeof data.galaxy === 'object') return true
  return (Number(data.version) || 1) < SAVE_VERSION
}

function emptyHarbourStorage() {
  return {
    cargo: {},
    miningHold: {},
    shipParts: 0,
    ships: [],
    weapons: {},
    accessories: {},
    blueprints: {},
    drones: {}
  }
}

function addCountMap(target, source) {
  if (!source || typeof source !== 'object') return
  for (const [id, qty] of Object.entries(source)) {
    const n = Number(qty) || 0
    if (n <= 0) continue
    target[id] = (target[id] ?? 0) + n
  }
}

function mergeHarbourStorage(target, source) {
  if (!source) return
  addCountMap(target.cargo ??= {}, source.cargo)
  addCountMap(target.miningHold ??= {}, source.miningHold)
  addCountMap(target.weapons ??= {}, source.weapons)
  addCountMap(target.accessories ??= {}, source.accessories)
  addCountMap(target.blueprints ??= {}, source.blueprints)
  addCountMap(target.drones ??= {}, source.drones)
  target.shipParts = (Number(target.shipParts) || 0) + (Number(source.shipParts) || 0)
  target.ships = [...(target.ships ?? []), ...(source.ships ?? [])]
}

function homePortOf(world, galaxy) {
  return (
    world?.bodies?.find((b) => b.id === galaxy?.homePortId) ??
    world?.bodies?.find((b) => b.kind === 'port' && b.name === 'Port Haven') ??
    world?.bodies?.find((b) => b.kind === 'port') ??
    null
  )
}

/** One-time: old world-saves drop at Port Haven. Assets stay put. */
function portCaptainToHome(gameState, homePort) {
  if (!homePort || !gameState?.player) return
  const world = getWorld(gameState.galaxy)
  const player = gameState.player
  player.homePortId = homePort.id
  if (world?.id) {
    player.currentSystemId = world.id
    player.startingSystemId = world.id
  }
  player.dockedBodyId = homePort.id
  player.dockedExteriorPosition = null
  player.dockedApproachDir = null
  player.waypointBodyId = null
  player.waypointPosition = null
  player.combatEngagedNpcIds = {}
  if (player.onFoot) {
    player.onFoot.active = false
    player.onFoot.bodyId = null
  }
  const ship = player.ship
  if (ship) {
    ship.position = [homePort.position[0], 0, homePort.position[2]]
    ship.velocity = [0, 0, 0]
    ship.heading = 0
    ship.throttle = 0
  }
}

/** Storage / jobs whose harbour no longer exists land at Port Haven. */
function rehomeOrphanedAssets(gameState, homePortId) {
  if (!homePortId) return
  const world = getWorld(gameState.galaxy)
  const live = new Set((world?.bodies ?? []).map((b) => b.id))
  const storage = gameState.stationStorage ?? {}
  for (const [bodyId, pile] of Object.entries(storage)) {
    if (live.has(bodyId)) continue
    mergeHarbourStorage((storage[homePortId] ??= emptyHarbourStorage()), pile)
    delete storage[bodyId]
  }
  for (const job of gameState.craftingJobs ?? []) {
    if (job && !live.has(job.bodyId)) job.bodyId = homePortId
  }
}

export function serializeGameState(gameState) {
  // Snapshot clock at save so load can apply offline wall time.
  const nowMs = Date.now()
  if (gameState.simClockOriginMs != null) {
    gameState.simTime = Math.max(0, (nowMs - gameState.simClockOriginMs) / 1000)
  }
  const payload = {
    version: SAVE_VERSION,
    seed: gameState.seed,
    galaxySeed: gameState.galaxySeed ?? CANONICAL_WORLD_SEED,
    createdAt: gameState.createdAt,
    player: gameState.player,
    stationStorage: gameState.stationStorage ?? {},
    craftingJobs: gameState.craftingJobs ?? [],
    simTime: gameState.simTime ?? 0,
    savedAtWallMs: nowMs,
    flags: gameState.flags
  }
  if (gameState.galaxyOpts) payload.galaxyOpts = gameState.galaxyOpts
  return payload
}

export function deserializeGameState(data) {
  const galaxySeed = data.galaxySeed ?? CANONICAL_WORLD_SEED
  const galaxyOpts = data.galaxyOpts
  const galaxy = generateWorld(galaxySeed, galaxyOpts)
  const world = getWorld(galaxy)
  const homePort = homePortOf(world, galaxy)
  const legacy = isLegacyWorldSave(data)
  const careerSeed = Number.isFinite(Number(data.seed)) ? Number(data.seed) : 0
  const availableMissions = seedMissionsForGalaxy(mulberry32(careerSeed + 1), galaxy)

  const gameState = {
    version: SAVE_VERSION,
    seed: careerSeed,
    galaxySeed,
    galaxyOpts,
    createdAt: data.createdAt,
    player: data.player,
    galaxy,
    economyOverrides: {},
    marketStock: {},
    missions: { available: availableMissions, active: [] },
    visitedBodyIds: [],
    probedBodyIds: [],
    probeCounts: {},
    stationStorage: data.stationStorage ?? {},
    craftingJobs: data.craftingJobs ?? [],
    npcs: [],
    projectiles: [],
    wrecks: [],
    asteroids: {},
    inCombat: false,
    simTime: data.simTime ?? 0,
    flags: data.flags ?? { alive: true, startingSystemPeaceBroken: false }
  }
  if (gameState.player?.avatar) gameState.player.avatar = normalizeAvatarSelection(gameState.player.avatar)
  else if (gameState.player) gameState.player.avatar = randomAvatarSelection()
  if (gameState.player && !gameState.player.onFoot) {
    gameState.player.onFoot = {
      active: false,
      bodyId: null,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      heading: 0,
      pitch: 0,
      walkPhase: 0,
      jumping: false,
      falling: false,
      verticalVelocity: 0,
      jumpTime: 0,
      fallStartY: null,
      flashlightOn: false,
      health: 100,
      stamina: 100,
      runLocked: false,
      running: false
    }
  }
  // miningHold falls back to {} for saves written before mining existed.
  gameState.player.ship.miningHold ??= {}
  gameState.player.ship.shipParts ??= 0
  // Rename ship/drone ids from pre-roster-rename saves (e.g. odyssey → far_reach).
  migrateLegacyIds(gameState)
  // equippedWeapons falls back for saves written before weapons were
  // swappable — every hardpoint just defaults to its category's free base
  // weapon, matching how it already behaved.
  const activeClass = getShipClass(gameState.player.ship.classId)
  gameState.player.ship.equippedWeapons ??= defaultLoadoutFor(activeClass)
  // Pre-accessory saves: pad/truncate to the class's current slot count.
  gameState.player.ship.equippedAccessories = normalizeAccessories(
    gameState.player.ship.equippedAccessories ?? defaultAccessoriesFor(activeClass),
    activeClass
  ).equipped
  gameState.player.ship.spareWeapons ??= {}
  gameState.player.ship.blueprints ??= {}
  gameState.player.ship.skillbooks ??= {}
  gameState.player.ship.drones ??= []
  // Skills (0–20) + skillbooks on ship; normalize missing keys from older saves.
  ensureSkills(gameState)
  // Ensure bay-compatible drone slots after load (class may have gained bays).
  try {
    ensureDrones(gameState.player.ship)
  } catch {
    /* class missing / old saves */
  }
  gameState.stationStorage ??= {}
  for (const storage of Object.values(gameState.stationStorage)) {
    if (!storage) continue
    storage.accessories ??= {}
    storage.weapons ??= {}
    storage.drones ??= {}
    for (const parked of storage.ships ?? []) {
      try {
        const cls = getShipClass(parked.classId)
        parked.equippedAccessories = normalizeAccessories(
          parked.equippedAccessories ?? defaultAccessoriesFor(cls),
          cls
        ).equipped
      } catch {
        parked.equippedAccessories ??= []
      }
    }
  }
  ensureBlueprintMaps(gameState)
  // One sea — both ids always name it, whatever a save happened to store.
  gameState.player.currentSystemId = world?.id ?? gameState.player.currentSystemId
  gameState.player.startingSystemId = world?.id ?? gameState.player.startingSystemId
  gameState.player.waypointPosition ??= null
  gameState.player.homePortId ??= homePort?.id ?? galaxy.homePortId ?? null
  gameState.galaxySeed = galaxySeed
  // Pre-docking-save fields: null = was flying when saved.
  gameState.player.dockedBodyId ??= null
  gameState.player.dockedExteriorPosition ??= null
  gameState.player.dockedApproachDir ??= null
  gameState.player.combatEngagedNpcIds ??= {}
  gameState.player.portraitDataUrl ??= null
  ensureLawStanding(gameState)
  // Live local security is recomputed from the boat's position every frame
  // (see game/security.js applyLocalSecurity); nothing to restore here.
  // Keep last pose arrays valid if a corrupt save omitted them.
  const ship = gameState.player.ship
  if (!Array.isArray(ship.position) || ship.position.length !== 3) {
    ship.position = [0, 0, 0]
  }
  // The sea owns the vertical; a saved altitude would just be re-clamped.
  ship.position[1] = 0
  if (!Array.isArray(ship.velocity) || ship.velocity.length !== 3) {
    ship.velocity = [0, 0, 0]
  } else {
    ship.velocity[1] = 0
  }
  if (!Array.isArray(ship.quaternion) || ship.quaternion.length !== 4) {
    ship.quaternion = [0, 0, 0, 1]
  }
  // Heading is authoritative for surface boats; recover from quaternion when
  // an older free-flight save omitted it so wake / helm / attitude work on load.
  if (typeof ship.heading !== 'number' || !Number.isFinite(ship.heading)) {
    const qx = ship.quaternion[0]
    const qy = ship.quaternion[1]
    const qz = ship.quaternion[2]
    const qw = ship.quaternion[3]
    // Local +Z through the saved orientation → yaw about world Y.
    const fx = 2 * (qx * qz + qw * qy)
    const fz = 1 - 2 * (qx * qx + qy * qy)
    // Prefer atan2 of the horizontal forward when the quat is valid.
    if (Number.isFinite(fx) && Number.isFinite(fz) && fx * fx + fz * fz > 1e-10) {
      ship.heading = Math.atan2(fx, fz)
    } else {
      ship.heading = 0
    }
  }
  ship.throttle ??= 0
  // Weapon cooldowns are absolute simTime timestamps. After offline catch-up
  // they would still be in the past if we kept them — clear so guns work
  // immediately on load (same as pre-persist-clock behaviour).
  ship.hardpointCooldowns = {}
  // lastHitAt is simTime-relative; drop it so nothing
  // isn't stuck waiting for a pre-save combat timestamp.
  delete ship.lastHitAt
  gameState.flags.startingSystemPeaceBroken ??= false

  if (legacy) {
    portCaptainToHome(gameState, homePort)
    rehomeOrphanedAssets(gameState, homePort?.id)
    gameState._portedFromLegacySave = true
  }

  const nowMs = Date.now()
  // Advance campaign clock by real time since save (Industry already uses wall time).
  const offlineS = applyOfflineTime(gameState, nowMs, data.savedAtWallMs ?? null)
  gameState._offlineSecondsApplied = offlineS
  reanchorGameClock(gameState, nowMs)

  // Catch up anomaly epoch after offline time (4h galaxy-wide refresh).
  if (gameState.galaxy) {
    const { refreshed } = tickGalaxyAnomalies(gameState.galaxy, gameState.simTime)
    gameState._anomaliesRefreshedOffline = refreshed
    if (refreshed && gameState.player?.waypointBodyId && String(gameState.player.waypointBodyId).startsWith('anomaly-')) {
      gameState.player.waypointBodyId = null
    }
  }

  // Resolve any crafts that finished while the save was offline (wall-clock).
  // Toasts for those completions are fired by main.js after load.
  gameState._craftingJustCompleted = updateCraftingJobs(gameState, nowMs)

  // Encounter/NPC state is never persisted (see plan). Only the current
  // system's bounty target needs to exist right away; other systems'
  // bounties re-materialize the same way when the player jumps there.
  ensureBountyNpcsForSystem(gameState, gameState.player.currentSystemId, Math.random)
  // Re-sync probe/exploration objectives against visited/probed lists.
  updateMissionProgress(gameState)
  return gameState
}

export async function saveGame(gameState) {
  if (gameState.inCombat) throw new Error('Cannot save while in combat')
  await window.electronAPI.saveGame(serializeGameState(gameState))
}

export async function loadGame() {
  const data = await window.electronAPI.loadGame()
  return data ? deserializeGameState(data) : null
}

export function hasSave() {
  return window.electronAPI.hasSave()
}

export function deleteSave() {
  return window.electronAPI.deleteSave()
}
