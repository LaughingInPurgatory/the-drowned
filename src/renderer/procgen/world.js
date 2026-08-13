import { mulberry32, pick, range, intRange } from './prng.js'
import { generateBodyName, generateHumanName, generateSpeciesName, claimFixedName } from './names.js'
import { ECONOMY_TAGS } from '../data/economyTags.js'
import { rollSecurityRating } from '../game/security.js'
import { islandShorelineToward, SHORE_KEEP_OUT } from '../render/islandMesh.js'

/**
 * The drowned world: one seamless sea with everything in a single coordinate
 * space. There is no galaxy, no jump graph and no loading seam — the whole
 * playable world is generated once and lives in `galaxy.systems[0]`.
 *
 * That container is kept deliberately: the base game reached the body list
 * through `getSystem(galaxy, currentSystemId)` in roughly a hundred places, and
 * collapsing the list to one entry keeps every one of those call sites correct
 * for free. `getWorld(gameState)` is the accessor new code should use.
 */

/** Half-width of the sea. Sailing past this is open water and nothing else. */
export const WORLD_RADIUS = 80000
/** The one and only region id. */
export const WORLD_ID = 'sea-0'
export const WORLD_NAME = 'The Drowned World'
/** Home archipelago at the world's centre — always safe, always the start. */
export const HOME_ARCHIPELAGO_NAME = 'Haven Reach'
export const CANONICAL_WORLD_SEED = 8675309

const ISLAND_CLUSTERS = 26
const ISLANDS_PER_CLUSTER = [3, 8]
const CLUSTER_SPREAD = [3200, 9000]
export const DEFAULT_PORT_COUNT = 48
export const DEFAULT_OUTPOST_COUNT = 60
export const DEFAULT_WRECK_FIELD_COUNT = 80
export const DEFAULT_SPECIES_COUNT = 12

const ISLAND_RADIUS = [420, 2900]
const ISLET_RADIUS = [180, 460]
const WRECK_FIELD_RADIUS = [180, 320]

/** Collision/placement shells — must match game/collision.js. */
const PORT_CLEARANCE = 520
const OUTPOST_CLEARANCE = 150
/** Keep a navigable channel between anything the player can run aground on. */
const PLACEMENT_MARGIN = 380
const PLACE_ATTEMPTS = 60

/**
 * Outposts may sit in open water (rigs, weather posts). Harbours never do —
 * a working port is always hard against an island shore.
 */
const FLOATING_OUTPOST_CHANCE = 0.45
/** Ports that keep a crew berth — where you wake up after being sunk. */
const BERTH_CHANCE = 0.3
/** Coastal ports sit on the beach edge; this is the small seaward gap. */
export const COASTAL_PORT_GAP = Object.freeze([18, 36])

/**
 * How far out a place is, 0 at Haven Reach → 1 at the world's edge.
 *
 * This is the game's only progression gradient, and it is a straight swap for
 * the `coreFraction` the space build rolled off galactic position — same range,
 * same meaning. It drives security, salvage tier, market depth and prices,
 * hostile strength and ambient spawn mix. Safe in the middle, lawless out deep.
 */
export function remoteness(position) {
  if (!position) return 0
  const d = Math.hypot(position[0] ?? 0, position[2] ?? 0)
  return Math.min(1, d / WORLD_RADIUS)
}

/** Inside this, Haven Reach's patrols keep the peace (until the player breaks it). */
export const HOME_WATERS_REMOTENESS = 0.12

/** True in the policed water around the home archipelago. */
export function inHomeWaters(position) {
  return remoteness(position) < HOME_WATERS_REMOTENESS
}

/** The single region. Every `getSystem(...)` in the codebase resolves to this. */
export function getWorld(gameStateOrGalaxy) {
  const galaxy = gameStateOrGalaxy?.galaxy ?? gameStateOrGalaxy
  return galaxy?.systems?.[0] ?? null
}

export function getSystem(galaxy, systemId) {
  const world = getWorld(galaxy)
  if (!world) return null
  // One region: any id resolves to it, including a stale id from an old save.
  return systemId == null || systemId === world.id ? world : world
}

export function findBody(galaxy, bodyId) {
  const world = getWorld(galaxy)
  return world?.bodies.find((b) => b.id === bodyId) ?? null
}

export function findSystemOfBody(galaxy, bodyId) {
  return findBody(galaxy, bodyId) ? getWorld(galaxy) : null
}

/** Dockable places give out work. */
export function isDockable(body) {
  return body?.kind === 'port' || body?.kind === 'outpost'
}

function randomTags(rng) {
  const count = intRange(rng, 1, 2)
  const tags = new Set()
  while (tags.size < count) tags.add(pick(rng, ECONOMY_TAGS))
  return [...tags]
}

/** Placement shell — anything solid enough to hole a hull on. */
export function bodyShellRadius(body) {
  if (body.kind === 'port') return PORT_CLEARANCE
  if (body.kind === 'outpost') return OUTPOST_CLEARANCE
  return body.radius ?? 0
}

/**
 * @param {string|null} [ignoreId] body to skip — used when seating a harbour on
 *   its own island (parent shells intentionally overlap).
 */
function overlapsAnything(position, shell, bodies, ignoreId = null) {
  for (const other of bodies) {
    if (ignoreId && other.id === ignoreId) continue
    const dx = position[0] - other.position[0]
    const dz = position[2] - other.position[2]
    const need = shell + bodyShellRadius(other) + PLACEMENT_MARGIN
    if (dx * dx + dz * dz < need * need) return true
  }
  return false
}

/** Uniform point in the sea disc — sqrt keeps density even, not centre-heavy. */
function seaPosition(rng, minR = 0, maxR = WORLD_RADIUS) {
  const t = rng()
  const r = Math.sqrt(minR * minR + t * (maxR * maxR - minR * minR))
  const a = rng() * Math.PI * 2
  return [Math.cos(a) * r, 0, Math.sin(a) * r]
}

/**
 * Seat a settlement on an island's real waterline (not the generation disc).
 * `ownShell` is only used as a soft push so large harbours sit a little further
 * out than a jetty — still hard against the landmass, never mid-channel.
 */
function coastPosition(rng, host, ownShell = 0) {
  const a = rng() * Math.PI * 2
  const dirX = Math.cos(a)
  const dirZ = Math.sin(a)
  // islandShorelineToward includes ship keep-out; strip that so the quay sits
  // on the beach edge, then add a short jetty reach.
  const probeX = host.position[0] + dirX * (host.radius * 3 + 2000)
  const probeZ = host.position[2] + dirZ * (host.radius * 3 + 2000)
  const shore =
    islandShorelineToward(host, probeX, probeZ) - SHORE_KEEP_OUT
  // Ports are waterfront infrastructure, not offshore markers: keep their
  // centre close enough that the quay reads as part of the island from sea.
  // Keep the broad placement shell above unchanged for unrelated bodies.
  const isPort = ownShell === PORT_CLEARANCE
  const jetty = isPort
    ? range(rng, COASTAL_PORT_GAP[0], COASTAL_PORT_GAP[1])
    : range(rng, 50, 140) + Math.min(120, ownShell * 0.12)
  const r = Math.max(80, shore) + jetty
  return [host.position[0] + dirX * r, 0, host.position[2] + dirZ * r]
}

function placeFree(rng, bodies, shell, minR = 0, maxR = WORLD_RADIUS) {
  for (let i = 0; i < PLACE_ATTEMPTS; i++) {
    const p = seaPosition(rng, minR, maxR)
    if (!overlapsAnything(p, shell, bodies)) return p
  }
  return null
}

function makeIsland(rng, id, name, position, radius) {
  return {
    id,
    name,
    kind: 'island',
    position,
    radius,
    economyTags: randomTags(rng),
    hasMissions: false,
    hasShipyard: false,
    hasShipParts: false,
    // Cosmetic seed so the mesh builder can vary silhouette without re-rolling
    // the world RNG (meshes are rebuilt on load, the world is not).
    shapeSeed: Math.floor(rng() * 0xffffffff)
  }
}

function makeWreckField(rng, id, position, usedNames) {
  return {
    id,
    name: generateBodyName(rng, 'wreckField', usedNames),
    kind: 'wreckField',
    position,
    radius: range(rng, WRECK_FIELD_RADIUS[0], WRECK_FIELD_RADIUS[1]),
    economyTags: randomTags(rng),
    hasMissions: false,
    hasShipyard: false,
    hasShipParts: false
  }
}

/** Stable 0–1 from a body id, for decisions that must survive a reload. */
function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** Stable coastal placement gap for saves made before the shoreline move. */
export function coastalPortGap(portId) {
  return COASTAL_PORT_GAP[0] + hash01(`coast-gap:${portId}`) * (COASTAL_PORT_GAP[1] - COASTAL_PORT_GAP[0])
}

/** Re-seat saved coastal ports after the harbour shoreline was brought in. */
export function normalizeCoastalPortPositions(world, player = null) {
  const bodies = world?.bodies
  if (!Array.isArray(bodies)) return world
  const islands = new Map(bodies.filter((body) => body.kind === 'island').map((body) => [body.id, body]))
  for (const port of bodies) {
    if (port.kind !== 'port' || !port.parentId) continue
    const host = islands.get(port.parentId)
    if (!host) continue
    const source = port.surfaceOffset ?? [
      (Number(port.position?.[0]) || 0) - (Number(host.position?.[0]) || 0),
      0,
      (Number(port.position?.[2]) || 0) - (Number(host.position?.[2]) || 0)
    ]
    let dx = Number(source[0]) || 0
    let dz = Number(source[2]) || 0
    const length = Math.hypot(dx, dz)
    if (length < 1e-6) {
      dx = 1
      dz = 0
    } else {
      dx /= length
      dz /= length
    }
    const probeX = host.position[0] + dx * (host.radius * 3 + 2000)
    const probeZ = host.position[2] + dz * (host.radius * 3 + 2000)
    const shore = islandShorelineToward(host, probeX, probeZ) - SHORE_KEEP_OUT
    const previousX = Number(port.position?.[0]) || 0
    const previousZ = Number(port.position?.[2]) || 0
    const existingGap = Math.hypot(previousX - host.position[0], previousZ - host.position[2]) - shore
    if (existingGap >= COASTAL_PORT_GAP[0] && existingGap <= COASTAL_PORT_GAP[1]) continue
    const distance = Math.max(80, shore) + coastalPortGap(port.id)
    port.position = [host.position[0] + dx * distance, 0, host.position[2] + dz * distance]
    port.surfaceOffset = [port.position[0] - host.position[0], 0, port.position[2] - host.position[2]]
    if (player?.dockedBodyId === port.id) {
      const moveX = port.position[0] - previousX
      const moveZ = port.position[2] - previousZ
      for (const position of [player.dockedExteriorPosition, player.ship?.position]) {
        if (!Array.isArray(position) || position.length < 3) continue
        position[0] += moveX
        position[2] += moveZ
      }
    }
  }
  return world
}

/** Deterministic from the id, so a harbour's berth survives a reload. */
export function portHasBerth(portId) {
  return hash01(`berth:${portId}`) < BERTH_CHANCE
}

function makePort(rng, id, position, host, usedNames) {
  const body = {
    id,
    // Host island name may be woven in ("Vale Sound Harbour") or fully unique.
    name: generateBodyName(rng, 'port', usedNames, host?.name ?? null),
    kind: 'port',
    parentId: host?.id,
    position,
    radius: null,
    economyTags: randomTags(rng),
    hasMissions: true,
    hasShipyard: true,
    hasShipParts: rng() < 0.06,
    securityRating: rollSecurityRating(rng, remoteness(position))
  }
  if (host) {
    body.surfaceOffset = [
      position[0] - host.position[0],
      0,
      position[2] - host.position[2]
    ]
  }
  body.hasBerth = portHasBerth(body.id)
  return body
}

function makeOutpost(rng, id, position, host, usedNames) {
  const body = {
    id,
    name: generateBodyName(rng, 'outpost', usedNames, host?.name ?? null),
    kind: 'outpost',
    parentId: host?.id,
    position,
    radius: null,
    economyTags: randomTags(rng),
    hasMissions: true,
    hasShipyard: false,
    hasShipParts: rng() < 0.06,
    // Outposts run lighter than a full harbour — one step down, never zero
    // in the safe centre so Haven Reach's neighbours still keep the peace.
    securityRating: Math.max(0, rollSecurityRating(rng, remoteness(position)) - 1)
  }
  if (host) {
    body.surfaceOffset = [
      position[0] - host.position[0],
      0,
      position[2] - host.position[2]
    ]
  }
  return body
}

/**
 * Scatter islands in archipelagos rather than uniformly — clusters with open
 * water between them is what makes a sea feel navigated rather than crossed.
 */
function placeIslands(rng, bodies, nextId, usedNames) {
  const clusters = []
  for (let c = 0; c < ISLAND_CLUSTERS; c++) {
    // Leave the middle for Haven Reach.
    clusters.push(seaPosition(rng, WORLD_RADIUS * 0.14, WORLD_RADIUS * 0.97))
  }
  for (const centre of clusters) {
    const spread = range(rng, CLUSTER_SPREAD[0], CLUSTER_SPREAD[1])
    const count = intRange(rng, ISLANDS_PER_CLUSTER[0], ISLANDS_PER_CLUSTER[1])
    for (let i = 0; i < count; i++) {
      const big = rng() < 0.45
      const radius = big
        ? range(rng, ISLAND_RADIUS[0], ISLAND_RADIUS[1])
        : range(rng, ISLET_RADIUS[0], ISLET_RADIUS[1])
      let position = null
      for (let a = 0; a < PLACE_ATTEMPTS; a++) {
        const ang = rng() * Math.PI * 2
        const d = Math.sqrt(rng()) * spread
        const p = [centre[0] + Math.cos(ang) * d, 0, centre[2] + Math.sin(ang) * d]
        if (Math.hypot(p[0], p[2]) > WORLD_RADIUS) continue
        if (!overlapsAnything(p, radius, bodies)) {
          position = p
          break
        }
      }
      if (!position) continue
      const name = generateBodyName(rng, 'island', usedNames)
      bodies.push(makeIsland(rng, `body-${nextId()}`, name, position, radius))
    }
  }
}

/**
 * Haven Reach: the starting archipelago at the world's centre. Hand-placed so
 * a new game always has a harbour to cast off from, a fort in sight of it, and
 * a wreck field close enough to reach before the fuel runs out.
 */
function buildHomeArchipelago(rng, bodies, nextId, usedNames) {
  // Fixed home names — claim first so nothing else can reuse them.
  claimFixedName(HOME_ARCHIPELAGO_NAME, usedNames)
  claimFixedName('Port Haven', usedNames)

  const island = makeIsland(rng, `body-${nextId()}`, HOME_ARCHIPELAGO_NAME, [0, 0, 0], 1400)
  island.economyTags = ['wealthy', 'tech']
  bodies.push(island)

  // Hand-built home harbour: inherits the Reach into "Port Haven" (special form).
  const homePort = {
    id: `body-${nextId()}`,
    name: 'Port Haven',
    kind: 'port',
    parentId: island.id,
    position: coastPosition(rng, island, PORT_CLEARANCE),
    radius: null,
    economyTags: ['wealthy', 'industrial'],
    hasMissions: true,
    hasShipyard: true,
    hasShipParts: true,
    securityRating: 6,
    hasBerth: true,
    isHome: true,
    surfaceOffset: null
  }
  homePort.surfaceOffset = [
    homePort.position[0] - island.position[0],
    0,
    homePort.position[2] - island.position[2]
  ]
  bodies.push(homePort)

  // A second island close by so the first voyage has somewhere to aim.
  const neighbour = makeIsland(
    rng,
    `body-${nextId()}`,
    generateBodyName(rng, 'island', usedNames),
    [range(rng, 3800, 6200), 0, range(rng, -4800, 4800)],
    range(rng, 600, 1100)
  )
  bodies.push(neighbour)
  bodies.push(
    makeOutpost(rng, `body-${nextId()}`, coastPosition(rng, neighbour, OUTPOST_CLEARANCE), neighbour, usedNames)
  )

  for (let i = 0; i < 2; i++) {
    const p = placeFree(rng, bodies, WRECK_FIELD_RADIUS[1], 2800, 10000)
    if (p) bodies.push(makeWreckField(rng, `body-${nextId()}`, p, usedNames))
  }
  return homePort
}

/**
 * Generate the whole sea. Deterministic for a given seed.
 *
 * Returns the same `{ seed, systems, species }` shape the space build used, with
 * exactly one entry in `systems` — see the note at the top of this file.
 *
 * Canonical (and any other seed+opts pair) is built once and cloned. The title
 * already pays for the playable sea; New Game must not spend another 1.5s+
 * placing 300 bodies. Callers get an isolated copy so play can mutate
 * security, breakwaters, etc. without poisoning the cache.
 */
const _generatedWorldCache = new Map()

function worldCacheKey(seed, opts) {
  return [
    seed,
    opts.portCount ?? DEFAULT_PORT_COUNT,
    opts.outpostCount ?? DEFAULT_OUTPOST_COUNT,
    opts.wreckFieldCount ?? DEFAULT_WRECK_FIELD_COUNT,
    opts.speciesCount ?? DEFAULT_SPECIES_COUNT
  ].join('|')
}

export function generateWorld(seed = CANONICAL_WORLD_SEED, opts = {}) {
  const cacheKey = worldCacheKey(seed, opts)
  const cached = _generatedWorldCache.get(cacheKey)
  if (cached) return structuredClone(cached)

  const {
    portCount = DEFAULT_PORT_COUNT,
    outpostCount = DEFAULT_OUTPOST_COUNT,
    wreckFieldCount = DEFAULT_WRECK_FIELD_COUNT,
    speciesCount = DEFAULT_SPECIES_COUNT
  } = opts
  const rng = mulberry32(seed)
  const usedNames = new Set()
  const bodies = []
  let idCounter = 0
  const nextId = () => idCounter++

  const homePort = buildHomeArchipelago(rng, bodies, nextId, usedNames)
  placeIslands(rng, bodies, nextId, usedNames)

  const islands = bodies.filter((b) => b.kind === 'island')

  // Harbours: always hard against an island shore. Never mid-ocean.
  for (let i = 0; i < portCount; i++) {
    if (islands.length === 0) break
    let position = null
    let host = null
    for (let a = 0; a < PLACE_ATTEMPTS * 2 && !position; a++) {
      const candidate = pick(rng, islands)
      // One harbour per island — two on the same rock is a town, not a coast.
      if (bodies.some((b) => b.kind === 'port' && b.parentId === candidate.id)) continue
      const p = coastPosition(rng, candidate, PORT_CLEARANCE)
      // Ignore the host island: quays sit inside its placement shell by design.
      if (!overlapsAnything(p, PORT_CLEARANCE, bodies, candidate.id)) {
        position = p
        host = candidate
      }
    }
    // No free-sea fallback: skip rather than invent a floating harbour.
    if (!position || !host) continue
    bodies.push(makePort(rng, `body-${nextId()}`, position, host, usedNames))
  }

  // Outposts: may hug a coast or sit alone (rigs, weather posts, salvage yards).
  for (let i = 0; i < outpostCount; i++) {
    const floating = rng() < FLOATING_OUTPOST_CHANCE || islands.length === 0
    let position = null
    let host = null
    if (!floating) {
      for (let a = 0; a < PLACE_ATTEMPTS && !position; a++) {
        const candidate = pick(rng, islands)
        const p = coastPosition(rng, candidate, OUTPOST_CLEARANCE)
        if (!overlapsAnything(p, OUTPOST_CLEARANCE, bodies, candidate.id)) {
          position = p
          host = candidate
        }
      }
    }
    position ??= placeFree(rng, bodies, OUTPOST_CLEARANCE)
    if (!position) continue
    bodies.push(makeOutpost(rng, `body-${nextId()}`, position, host, usedNames))
  }

  for (let i = 0; i < wreckFieldCount; i++) {
    const p = placeFree(rng, bodies, WRECK_FIELD_RADIUS[1])
    if (p) bodies.push(makeWreckField(rng, `body-${nextId()}`, p, usedNames))
  }

  const world = {
    id: WORLD_ID,
    name: WORLD_NAME,
    bodies,
    // Live local security, refreshed from the player's position each frame by
    // game/security.js. Everything that used to ask a star system how policed
    // it was still asks this object, and now gets a per-place answer.
    securityRating: 6,
    _usedNames: [...usedNames]
  }

  const species = []
  for (let i = 0; i < speciesCount; i++) {
    species.push({ id: `faction-${i}`, name: generateSpeciesName(rng), leader: generateHumanName(rng) })
  }

  const generated = { seed, systems: [world], species, homePortId: homePort.id, _nextBodyId: idCounter }
  _generatedWorldCache.set(cacheKey, generated)
  return structuredClone(generated)
}

/** Smaller world for tests — same generator, fewer bodies. */
export const TEST_WORLD_OPTS = {
  portCount: 6,
  outpostCount: 6,
  wreckFieldCount: 8,
  speciesCount: 3
}
