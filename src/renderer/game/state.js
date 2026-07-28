import { mulberry32 } from '../procgen/prng.js'
import { generateWorld, getWorld, CANONICAL_WORLD_SEED } from '../procgen/world.js'
import { getShipClass } from '../data/shipClasses.js'
import { seedMissionsForGalaxy } from '../data/missionTemplates.js'
import { defaultLoadoutFor } from '../data/weapons.js'
import { defaultAccessoriesFor } from '../data/accessories.js'
import { emptySkills } from '../data/skills.js'

export function createGameState({
  characterName,
  shipInstanceName,
  shipClassId,
  seed,
  portraitDataUrl = null,
  /** Passed through to generateWorld (tests use a compact world). */
  galaxyOpts = undefined,
  /** Override only for tests; production always uses CANONICAL_WORLD_SEED. */
  galaxySeed = CANONICAL_WORLD_SEED
}) {
  // The sea is the same for everyone — one fixed seed, one layout, so a place
  // named in one player's log is the same place in another's. The career `seed`
  // only varies the contract boards, never the map.
  const galaxy = generateWorld(galaxySeed, galaxyOpts)
  const shipClass = getShipClass(shipClassId)
  const world = getWorld(galaxy)
  const homePort =
    world.bodies.find((b) => b.id === galaxy.homePortId) ??
    world.bodies.find((b) => b.kind === 'port')
  // Missions use the career seed so each skipper gets a different board.
  const missionRng = mulberry32(seed + 1)
  const availableMissions = seedMissionsForGalaxy(missionRng, galaxy)

  const gameState = {
    version: 1,
    seed,
    galaxySeed,
    createdAt: new Date().toISOString(),
    player: {
      name: characterName,
      credits: 1500,
      reputation: 0,
      // One sea, so this never changes — kept because roughly a hundred call
      // sites reach the body list through it (see procgen/world.js).
      currentSystemId: world.id,
      startingSystemId: world.id,
      /** Haven Reach. Where a new skipper starts and where a berth returns them. */
      homePortId: homePort?.id ?? null,
      waypointBodyId: null,
      // Free-space waypoint (e.g. bounty hunt marker) — cleared when a body
      // waypoint is set. Not required for normal body navigation.
      waypointPosition: null,
      // Berthed at this body id (port/outpost); null when under way.
      // Exterior hang point + approach bearing let undock after load line up.
      dockedBodyId: null,
      dockedExteriorPosition: null,
      dockedApproachDir: null,
      // NPC ids that have exchanged fire with the player (drones only engage these).
      combatEngagedNpcIds: {},
      // Authority reputation 0–10 (see game/security.js). Start clean.
      lawStanding: 10,
      // Optional base64 data-URL of player portrait (Create Pilot / Character upload).
      portraitDataUrl: portraitDataUrl || null,
      // Player-only skills 0–20 (data/skills.js) — raised via skillbooks.
      skills: emptySkills(),
      ship: {
        classId: shipClassId,
        instanceName: shipInstanceName,
        hull: shipClass.stats.hull,
        armor: shipClass.stats.armor,
        cargo: {},
        miningHold: {},
        shipParts: 0,
        // Every hardpoint starts mounted with its category's free base
        // weapon (see data/weapons.js) — the same stats combat.js's old
        // fixed presets used, so an untouched loadout plays identically.
        equippedWeapons: defaultLoadoutFor(shipClass),
        // Optional modules — empty array when the hull has 0 slots.
        equippedAccessories: defaultAccessoriesFor(shipClass),
        // Salvaged hardpoint weapons from wrecks — equip or sell at a shipyard.
        spareWeapons: {},
        // Rare industry blueprints (ships/weapons) — craft at station Industry.
        blueprints: {},
        // Skillbooks on board { skillId: qty } — use from Character / Inventory.
        skillbooks: {},
        // Combat drones — empty until bought/equipped (max = shipClass.droneBays).
        drones: [],
        // Alongside at Haven Reach. main.js sets dockedBodyId before starting
        // the session, so a new game opens tied up rather than adrift.
        position: homePort ? [...homePort.position] : [0, 0, 0],
        velocity: [0, 0, 0],
        heading: 0,
        quaternion: [0, 0, 0, 1]
      }
    },
    galaxy,
    economyOverrides: {},
    // Per-body market depth: how many units of each good the bay has for sale.
    // Lazy-seeded on first trade access (see game/economy.js getMarketAvailable).
    marketStock: {},
    missions: { available: availableMissions, active: [] },
    visitedBodyIds: [],
    probedBodyIds: [],
    // How many times each body (or system star id) has been fully probed.
    // Cap is MAX_PROBE_ATTEMPTS in game/probe.js.
    probeCounts: {},
    // Per-harbour storage — cargo/salvage/parts left ashore, and boats owned
    // but not currently in use — keyed by body id (see game/economy.js's
    // storage-related functions). Nothing ever moves between harbours on its own.
    stationStorage: {},
    // Active industry jobs (wall-clock; persist across save/load).
    craftingJobs: [],
    npcs: [],
    projectiles: [],
    // Wrecks left behind by destroyed ships (game/wrecks.js) — ephemeral like
    // npcs/projectiles, never persisted (see game/save.js).
    wrecks: [],
    // Per-wreck salvage state (remaining material, destroyedAt simTime), keyed
    // by "fieldId:index" — persisted so fields settle again while offline.
    asteroids: {},
    inCombat: false,
    // Seconds of campaign time; driven by wall clock (see game/gameClock.js).
    simTime: 0,
    // Date.now() origin such that simTime ≈ (now - simClockOriginMs) / 1000.
    simClockOriginMs: Date.now(),
    // startingSystemPeaceBroken flips permanently true the moment the player
    // fires on a non-hostile boat in home waters (see combat.js's
    // updateProjectiles) — until then Haven Reach sees only honest traffic,
    // never raiders (see main.js's ambient spawner).
    flags: { alive: true, startingSystemPeaceBroken: false }
  }

  return gameState
}
