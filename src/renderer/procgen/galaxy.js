import { mulberry32, pick, range, intRange } from './prng.js'
import {
  generateBodyName,
  generateSpeciesName,
  generateSystemName,
  generateUniquePlanetName,
  generateUniqueMoonName,
  sequentialPlanetName,
  sequentialMoonName,
  isSequentialMoonName
} from './names.js'
import { ECONOMY_TAGS } from '../data/economyTags.js'

const ARM_COUNT = 4
export const GALAXY_MAX_RADIUS = 2600
const MAX_RADIUS = GALAXY_MAX_RADIUS
const ARM_TWIST = 2.5
const JITTER_ANGLE = 0.5
const DISK_THICKNESS = 120
// Local system scatter. Stars are STAR_SIZE_SCALE 225 (giants ~45k radius,
// corona ~1.9×) — min orbit must clear that or planets spawn inside the sun.
// Bumped with the 6× sun / 5× planet pass (was SYSTEM_SIZE_SCALE 18).
const SYSTEM_SIZE_SCALE = 120
const SYSTEM_LOCAL_MIN_RADIUS = 900 * SYSTEM_SIZE_SCALE
const SYSTEM_LOCAL_MAX_RADIUS = 2800 * SYSTEM_SIZE_SCALE
// Planets 5× prior (was 37.5); moons keep the same relative scale vs planets.
const PLANET_SIZE_SCALE = 187.5
const MOON_SIZE_SCALE = 123.75
const SYSTEM_SCALE_VARIANCE = [0.85, 1.15]
const MOON_CHANCE = 0.23
const MOON_ORBIT_MIN_RADIUS = 18
const MOON_ORBIT_MAX_RADIUS = 45
const MOON_ORBIT_CLEARANCE_MARGIN = 6
// Placement / orbital packing for station *visual* bulk (~STATION_SCALE 190).
// Player collision is smaller (500m) in collision.js so you can fly in close.
const STATION_CLEARANCE_RADIUS = 2500
// Min extra gap beyond planet surface + station shell — stations must orbit
// no closer than this many world units from a planet's crust (not merely the
// thin MOON_ORBIT_CLEARANCE_MARGIN used for moon↔host packing).
const STATION_PLANET_ORBIT_GAP = 2000
// Settlements were not part of the behemoth scale pass — keep original shells.
const SETTLEMENT_CLEARANCE_RADIUS = 72
// Settlements sit ON the crust — tiny lift only to avoid z-fighting (mesh
// origin is at the pad base). Large lifts read as floating bases.
const SETTLEMENT_SURFACE_LIFT = 1.5
// Vast majority of stations orbit a planet, moon, or the star; a tiny fraction drift alone.
const STATION_FREE_DRIFT_CHANCE = 0.003
// Planets/moons that host a station or settlement keep their catalog name
// most of the time, but sometimes receive a unique proper name instead
// (proper names never include Roman/Arabic numerals).
const PLANET_UNIQUE_NAME_CHANCE = 0.55
const MOON_UNIQUE_NAME_CHANCE = 0.4
// Settlements are almost always surface-bound; a rare outpost in an asteroid belt.
const SETTLEMENT_ASTEROID_CHANCE = 0.003
// If the chosen host already has an orbiting station, settlement is rare.
const SETTLEMENT_WITH_STATION_CHANCE = 0.05
// Placement retries when a rolled position clips another body / orbit band.
const STATION_PLACE_ATTEMPTS = 48
// Sparse warp-lane graph: MST over k-nearest candidates (all systems reachable)
// + a few short extras. Not a dense mesh — most systems have 2–3 gates.
const JUMP_NEAREST_CANDIDATES = 10 // candidate edges per system for Kruskal MST
const JUMP_EXTRA_NEAR_LINKS = 1 // try one optional short hop beyond the MST
const JUMP_MAX_DEGREE = 4

export const SYSTEM_ARRIVAL_POSITION = [0, 400, -SYSTEM_LOCAL_MAX_RADIUS * 0.95]

// Special outer-rim destination: always one system, always this station name.
// Ambient hostiles never spawn here (mission NPCs still can).
export const WHISPERS_SYSTEM_NAME = 'Whispers'
/** Canonical name for the New Game home system (galactic centre). */
export const STARTING_SYSTEM_NAME = 'Terra Prime'
export const WHISPERS_STATION_NAME = "SerNub's Pleasure Palace"

/**
 * Spiral-arm galaxy position.
 * @param {{ coreOnly?: boolean, outerOnly?: boolean }} [opts]
 *   coreOnly  — place inside ~30% of max radius (dense core)
 *   outerOnly — place outside the core disk
 */
function spiralPosition(rng, armIndex, opts = {}) {
  const { coreOnly = false, outerOnly = false } = opts
  // sqrt radius keeps surface density roughly even within the chosen band.
  let radius
  if (coreOnly) {
    radius = MAX_RADIUS * 0.3 * Math.sqrt(rng())
  } else if (outerOnly) {
    // Annulus from 0.3R–1.0R (area-weighted via sqrt of remapped u).
    const u = 0.09 + rng() * (1 - 0.09)
    radius = MAX_RADIUS * Math.sqrt(u)
  } else {
    radius = MAX_RADIUS * Math.sqrt(rng())
  }
  const angle = (armIndex / ARM_COUNT) * Math.PI * 2 + radius * 0.01 * ARM_TWIST + (rng() - 0.5) * JITTER_ANGLE
  const x = radius * Math.cos(angle)
  const z = radius * Math.sin(angle)
  const y = (rng() - 0.5) * DISK_THICKNESS
  return [x, y, z]
}

function localPosition(rng, systemScale) {
  const radius = range(rng, SYSTEM_LOCAL_MIN_RADIUS, SYSTEM_LOCAL_MAX_RADIUS) * systemScale
  const theta = rng() * Math.PI * 2
  const phi = Math.acos(2 * rng() - 1)
  return [radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi) * 0.3, radius * Math.sin(phi) * Math.sin(theta)]
}

// XZ orbital radius of a body around its host (placement only; orbits are fixed in play).
function xzOrbitRadius(position, parentPosition = [0, 0, 0]) {
  const dx = position[0] - parentPosition[0]
  const dz = position[2] - parentPosition[2]
  return Math.hypot(dx, dz)
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Collision shell radius used for placement clearance (matches game/collision.js). */
function bodyShellRadius(body) {
  if (body.kind === 'station') return STATION_CLEARANCE_RADIUS
  if (body.kind === 'settlement') return SETTLEMENT_CLEARANCE_RADIUS
  return body.radius ?? 0
}

/**
 * True if `position` would put a body of `ownShell` inside any solid body
 * already in the system (planets, moons, stations, settlements, asteroid fields).
 */
function clearanceMarginFor(otherKind) {
  // Stations keep a much wider berth from planets than from moons/peers.
  return otherKind === 'planet' ? STATION_PLANET_ORBIT_GAP : MOON_ORBIT_CLEARANCE_MARGIN
}

function positionOverlapsBodies(position, ownShell, system) {
  for (const b of system.bodies) {
    if (
      b.kind !== 'planet' &&
      b.kind !== 'moon' &&
      b.kind !== 'station' &&
      b.kind !== 'settlement' &&
      b.kind !== 'asteroidField'
    ) {
      continue
    }
    const need = ownShell + bodyShellRadius(b) + clearanceMarginFor(b.kind)
    if (dist3(position, b.position) < need) return true
  }
  return false
}

/**
 * Flat XZ-plane orbit around a host body (moons, orbiting stations).
 * @param {Array<{ r: number, halfWidth: number }>} [avoidBands]
 *   Forbidden orbital-radius bands so co-hosted moons/stations don't share an
 *   orbit shell (radial gap >= moon size + station shell at every angle).
 * @param {number} [maxOrbitRadius]
 *   Hard cap on XZ radius (e.g. moon-hosted stations must stay clear of the
 *   grandparent planet over the full circle). Returns null if no valid shell.
 */
function localPositionNearBody(
  rng,
  parentPosition,
  parentRadius,
  ownClearance,
  avoidBands = [],
  maxOrbitRadius = Infinity,
  surfaceGap = MOON_ORBIT_CLEARANCE_MARGIN
) {
  const clearance = parentRadius + ownClearance + surfaceGap
  const minR = Math.max(MOON_ORBIT_MIN_RADIUS, clearance)
  // Default outer roll; expand if we must clear co-hosted orbiters further out.
  let maxR = Math.max(MOON_ORBIT_MAX_RADIUS, clearance * 1.4)
  for (const band of avoidBands) {
    maxR = Math.max(maxR, band.r + band.halfWidth + ownClearance * 0.15)
  }
  maxR = Math.min(maxR, maxOrbitRadius)
  if (!(maxR >= minR)) return null

  function radiusOk(r) {
    return r >= minR && r <= maxR && avoidBands.every((b) => Math.abs(r - b.r) >= b.halfWidth)
  }

  let xzRadius = null
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = range(rng, minR, Math.max(minR * 1.05, maxR))
    if (radiusOk(candidate)) {
      xzRadius = candidate
      break
    }
  }
  // Fallback: park outside the outermost forbidden band (always clears moons),
  // still respecting the hard max orbit cap.
  if (xzRadius == null) {
    xzRadius = minR
    for (const band of avoidBands) {
      xzRadius = Math.max(xzRadius, band.r + band.halfWidth)
    }
    xzRadius += range(rng, ownClearance * 0.05, ownClearance * 0.25)
    if (xzRadius > maxR) {
      // Try just under the cap if the outer-park overshot.
      xzRadius = maxR
      if (!radiusOk(xzRadius)) return null
    }
  }

  const theta = rng() * Math.PI * 2
  // Cap y so the 3D distance to the host still clears the host shell (xz alone
  // already does; a large y is fine for host clearance, but keep the flat orbit
  // convention used by main.js moonOrbits).
  const y = range(rng, -xzRadius * 0.15, xzRadius * 0.15)
  return [
    parentPosition[0] + xzRadius * Math.cos(theta),
    parentPosition[1] + y,
    parentPosition[2] + xzRadius * Math.sin(theta)
  ]
}

/**
 * Orbit shells to avoid around a host: direct child moons/stations, plus the
 * annulus swept by stations that themselves orbit a child moon of this host.
 */
function orbitAvoidBandsForHost(system, host, ownClearance) {
  const bands = []
  for (const b of system.bodies) {
    if (b.parentId === host.id && (b.kind === 'moon' || b.kind === 'station')) {
      const r = xzOrbitRadius(b.position, host.position)
      bands.push({
        r,
        halfWidth: bodyShellRadius(b) + ownClearance + MOON_ORBIT_CLEARANCE_MARGIN
      })
      continue
    }
    // Station orbiting a moon of this host sweeps ~[moonR ± stR] around host.
    if (b.kind === 'station' && b.parentId) {
      const mid = system.bodies.find((x) => x.id === b.parentId)
      if (!mid || mid.kind !== 'moon' || mid.parentId !== host.id) continue
      const moonR = xzOrbitRadius(mid.position, host.position)
      const stR = xzOrbitRadius(b.position, mid.position)
      bands.push({
        r: moonR,
        halfWidth: stR + bodyShellRadius(b) + ownClearance + MOON_ORBIT_CLEARANCE_MARGIN
      })
    }
  }
  return bands
}

/**
 * Max XZ radius for a station orbiting a moon so its full circle stays outside
 * the grandparent planet and does not cross other planet-level orbiters.
 * Returns null if no safe radius exists (caller should pick another host).
 */
function maxOrbitRadiusForMoonHost(system, moon, ownClearance) {
  if (!moon.parentId) return Infinity
  const planet = system.bodies.find((b) => b.id === moon.parentId)
  if (!planet || planet.kind !== 'planet') return Infinity

  const moonR = xzOrbitRadius(moon.position, planet.position)
  // Coplanar worst case: station on the near side of the moon toward the planet.
  // Use the planet orbit gap so moon-hosted stations also stay ≥2000 from crust.
  let maxR = moonR - ((planet.radius ?? 0) + ownClearance + STATION_PLANET_ORBIT_GAP)

  // Other bodies orbiting the same planet (sibling moons, planet-hosted stations).
  for (const b of system.bodies) {
    if (b.parentId !== planet.id) continue
    if (b.id === moon.id) continue
    if (b.kind !== 'moon' && b.kind !== 'station') continue
    const siblingR = xzOrbitRadius(b.position, planet.position)
    const gap = Math.abs(siblingR - moonR)
    maxR = Math.min(maxR, gap - (bodyShellRadius(b) + ownClearance + MOON_ORBIT_CLEARANCE_MARGIN))
  }

  return maxR
}

/** Star-orbit avoid bands: planets, moons, and other star-orbiting stations. */
function starOrbitAvoidBands(system, ownClearance) {
  const bands = []
  for (const b of system.bodies) {
    if (b.kind === 'planet' || b.kind === 'moon') {
      bands.push({
        r: xzOrbitRadius(b.position),
        halfWidth: (b.radius ?? 0) + ownClearance + clearanceMarginFor(b.kind)
      })
    } else if (b.kind === 'station' && b.orbitsStar) {
      bands.push({
        r: xzOrbitRadius(b.position),
        halfWidth: STATION_CLEARANCE_RADIUS + ownClearance + MOON_ORBIT_CLEARANCE_MARGIN
      })
    }
  }
  return bands
}

// Station orbiting the system star (origin). Same avoid-band logic as host orbits.
function localPositionStarOrbit(rng, systemScale, avoidBands = []) {
  const minR = SYSTEM_LOCAL_MIN_RADIUS * 0.2 * systemScale
  let maxR = SYSTEM_LOCAL_MIN_RADIUS * 0.65 * systemScale
  for (const band of avoidBands) {
    maxR = Math.max(maxR, band.r + band.halfWidth + STATION_CLEARANCE_RADIUS * 0.15)
  }
  // Also allow parking outside the outermost planet band if the default shell is busy.
  for (const band of avoidBands) {
    maxR = Math.max(maxR, band.r + band.halfWidth + STATION_CLEARANCE_RADIUS * 0.05)
  }
  if (maxR < minR) return null

  function radiusOk(r) {
    return avoidBands.every((b) => Math.abs(r - b.r) >= b.halfWidth)
  }

  let radius = null
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = range(rng, minR, maxR)
    if (radiusOk(candidate)) {
      radius = candidate
      break
    }
  }
  if (radius == null) {
    radius = minR
    for (const band of avoidBands) {
      radius = Math.max(radius, band.r + band.halfWidth)
    }
    radius += range(rng, STATION_CLEARANCE_RADIUS * 0.05, STATION_CLEARANCE_RADIUS * 0.25)
  }

  const theta = rng() * Math.PI * 2
  const y = range(rng, -radius * 0.08, radius * 0.08)
  return [radius * Math.cos(theta), y, radius * Math.sin(theta)]
}

// Settlement sits ON a planet/moon surface (center slightly above crust so the
// mesh base meets the ground; not perched far out on a collision shell).
function localPositionOnSurface(rng, host) {
  const theta = rng() * Math.PI * 2
  const phi = Math.acos(2 * rng() - 1)
  const dist = host.radius + SETTLEMENT_SURFACE_LIFT
  const nx = Math.sin(phi) * Math.cos(theta)
  const ny = Math.cos(phi)
  const nz = Math.sin(phi) * Math.sin(theta)
  const offset = [dist * nx, dist * ny, dist * nz]
  return {
    position: [host.position[0] + offset[0], host.position[1] + offset[1], host.position[2] + offset[2]],
    surfaceOffset: offset
  }
}

// Planet + its moons share one "family" — at most one settlement in the whole family.
function hostFamilyId(body) {
  if (body.kind === 'moon' && body.parentId) return body.parentId
  return body.id
}

function familiesWithSettlements(system) {
  const taken = new Set()
  for (const b of system.bodies) {
    if (b.kind !== 'settlement' || !b.parentId || b.inAsteroidField) continue
    const parent = system.bodies.find((p) => p.id === b.parentId)
    if (parent) taken.add(hostFamilyId(parent))
  }
  return taken
}

function hostHasStation(system, hostId) {
  return system.bodies.some((b) => b.kind === 'station' && b.parentId === hostId)
}

function randomTags(rng) {
  const count = intRange(rng, 1, 2)
  const tags = new Set()
  while (tags.size < count) tags.add(pick(rng, ECONOMY_TAGS))
  return [...tags]
}

// Missions only at dockable facilities (stations / settlements).
function missionChance(kind) {
  return kind === 'station' || kind === 'settlement'
}

function radiusFor(rng, kind, systemScale) {
  if (kind === 'planet') return range(rng, 8, 21) * PLANET_SIZE_SCALE * systemScale
  if (kind === 'moon') return range(rng, 3, 8) * MOON_SIZE_SCALE * systemScale
  // Wider belt volume so rocks can pack with clear gaps (see asteroidFieldMesh).
  if (kind === 'asteroidField') return range(rng, 180, 320) * systemScale
  return null
}

function makePlanetOrMoon(rng, idCounter, kind, parent, systemScale, name, siblingMoons = []) {
  const radius = radiusFor(rng, kind, systemScale)
  let position
  if (kind === 'moon') {
    // Avoid co-hosted sibling moons so multi-moon orbits never share a shell.
    const avoidBands = siblingMoons.map((m) => ({
      r: xzOrbitRadius(m.position, parent.position),
      halfWidth: (m.radius ?? 0) + radius + MOON_ORBIT_CLEARANCE_MARGIN
    }))
    position = localPositionNearBody(rng, parent.position, parent.radius, radius, avoidBands)
    // Extremely tight family: park outside the outermost sibling band.
    if (!position) {
      let minR = parent.radius + radius + MOON_ORBIT_CLEARANCE_MARGIN
      for (const band of avoidBands) minR = Math.max(minR, band.r + band.halfWidth)
      const theta = rng() * Math.PI * 2
      const xz = minR + range(rng, radius * 0.1, radius * 0.4)
      position = [
        parent.position[0] + xz * Math.cos(theta),
        parent.position[1] + range(rng, -xz * 0.1, xz * 0.1),
        parent.position[2] + xz * Math.sin(theta)
      ]
    }
  } else {
    position = localPosition(rng, systemScale)
  }
  return {
    id: `body-${idCounter}`,
    name:
      name ??
      (kind === 'moon' ? sequentialMoonName(parent.name) : generateBodyName(rng, kind)),
    kind,
    parentId: kind === 'moon' ? parent.id : undefined,
    position,
    radius,
    economyTags: randomTags(rng),
    hasMissions: false,
    hasShipyard: false,
    hasShipParts: false
  }
}

function makeAsteroidField(rng, idCounter, systemScale, usedNames, position = null) {
  return {
    id: `body-${idCounter}`,
    name: generateBodyName(rng, 'asteroidField', usedNames),
    kind: 'asteroidField',
    position: position ?? localPosition(rng, systemScale),
    radius: radiusFor(rng, 'asteroidField', systemScale),
    economyTags: randomTags(rng),
    hasMissions: false,
    hasShipyard: false,
    hasShipParts: false
  }
}

/**
 * Home-system belt near the hyperspace arrival hang so New Game always has a
 * short-SC mining target (random localPosition can land 100–300km from spawn).
 */
function makeHomeAsteroidField(rng, idCounter, system, usedNames) {
  const systemScale = system.sizeScale ?? 1
  const [ax, ay, az] = SYSTEM_ARRIVAL_POSITION
  const angle = rng() * Math.PI * 2
  // Short hop from arrival — far enough to not sit on the ship spawn.
  const dist = range(rng, 12000, 28000)
  const position = [
    ax + Math.cos(angle) * dist,
    ay + range(rng, -400, 400) * systemScale,
    az + Math.sin(angle) * dist
  ]
  return makeAsteroidField(rng, idCounter, systemScale, usedNames, position)
}

function tryStationPosition(rng, system, mode, host) {
  if (mode === 'free') {
    const position = localPosition(rng, system.sizeScale)
    if (positionOverlapsBodies(position, STATION_CLEARANCE_RADIUS, system)) return null
    return { position, parentId: undefined, orbitsStar: false }
  }
  if (mode === 'star') {
    const avoidBands = starOrbitAvoidBands(system, STATION_CLEARANCE_RADIUS)
    const position = localPositionStarOrbit(rng, system.sizeScale, avoidBands)
    if (!position) return null
    if (positionOverlapsBodies(position, STATION_CLEARANCE_RADIUS, system)) return null
    return { position, parentId: undefined, orbitsStar: true }
  }
  // Hosted on a planet or moon.
  const hostRadius = host.radius ?? 0
  const avoidBands = orbitAvoidBandsForHost(system, host, STATION_CLEARANCE_RADIUS)
  let maxOrbit = Infinity
  if (host.kind === 'moon') {
    maxOrbit = maxOrbitRadiusForMoonHost(system, host, STATION_CLEARANCE_RADIUS)
    if (!(maxOrbit >= hostRadius + STATION_CLEARANCE_RADIUS + MOON_ORBIT_CLEARANCE_MARGIN)) {
      return null
    }
  }
  // Planets: enforce STATION_PLANET_ORBIT_GAP so stations never skim the crust.
  const surfaceGap = host.kind === 'planet' ? STATION_PLANET_ORBIT_GAP : MOON_ORBIT_CLEARANCE_MARGIN
  const position = localPositionNearBody(
    rng,
    host.position,
    hostRadius,
    STATION_CLEARANCE_RADIUS,
    avoidBands,
    maxOrbit,
    surfaceGap
  )
  if (!position) return null
  if (positionOverlapsBodies(position, STATION_CLEARANCE_RADIUS, system)) return null
  return { position, parentId: host.id, orbitsStar: false }
}

function makeStation(rng, idCounter, system) {
  const planets = system.bodies.filter((b) => b.kind === 'planet')
  const moons = system.bodies.filter((b) => b.kind === 'moon')
  // Prefer planet hosts: moon-hosted stations need a large moon–planet gap or
  // they clip the grandparent over the full orbit (main.js animates both).
  const bodyHosts = [...planets, ...moons]

  let placement = null
  const preferFree = rng() < STATION_FREE_DRIFT_CHANCE

  for (let attempt = 0; attempt < STATION_PLACE_ATTEMPTS && !placement; attempt++) {
    if (preferFree && attempt < 8) {
      placement = tryStationPosition(rng, system, 'free')
      if (placement) break
    }

    const useStar = bodyHosts.length === 0 || rng() < 0.28
    if (useStar || bodyHosts.length === 0) {
      placement = tryStationPosition(rng, system, 'star')
      continue
    }

    const host = pick(rng, bodyHosts)
    placement = tryStationPosition(rng, system, 'host', host)
  }

  // Last resort: star orbit outside every avoid band / solid body (expand outward).
  if (!placement) {
    for (let attempt = 0; attempt < STATION_PLACE_ATTEMPTS; attempt++) {
      placement = tryStationPosition(rng, system, 'star')
      if (placement) break
      // Force a far free slot if star bands are packed.
      const far = localPosition(rng, system.sizeScale)
      // Push further out if needed.
      const r = Math.hypot(far[0], far[2])
      const boost = SYSTEM_LOCAL_MAX_RADIUS * system.sizeScale * (0.7 + attempt * 0.01)
      if (r > 1e-6) {
        const s = boost / r
        far[0] *= s
        far[2] *= s
      } else {
        far[0] = boost
      }
      if (!positionOverlapsBodies(far, STATION_CLEARANCE_RADIUS, system)) {
        placement = { position: far, parentId: undefined, orbitsStar: false }
        break
      }
    }
  }

  if (!placement) {
    // Extremely dense system — park on +Z far outside system scale (static free).
    const r = SYSTEM_LOCAL_MAX_RADIUS * (system.sizeScale ?? 1) * 1.2
    placement = { position: [0, 0, r], parentId: undefined, orbitsStar: false }
  }

  const stationId = `body-${idCounter}`
  return {
    id: stationId,
    name: generateBodyName(rng, 'station', system._usedNames),
    kind: 'station',
    parentId: placement.parentId,
    orbitsStar: placement.orbitsStar || undefined,
    position: placement.position,
    radius: null,
    economyTags: randomTags(rng),
    hasMissions: true,
    // Every station stocks a full shipyard (buy/sell ships + armoury).
    hasShipyard: true,
    hasShipParts: rng() < 0.06,
    // ~30% of stations — FNV-ish hash of body id (stable with galaxy seed ids).
    hasCloneBay: stationCloneBayFromId(stationId)
  }
}

/** Keep in sync with game/clones.js stationHasCloneBay (no import cycle). */
function stationCloneBayFromId(stationId) {
  let h = 2166136261
  const s = `clonebay:${stationId}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 100 < 30
}

function makeSettlement(rng, idCounter, system, { force = false } = {}) {
  // Rare asteroid-belt outpost — only non-surface case (not subject to family rules).
  if (!force && rng() < SETTLEMENT_ASTEROID_CHANCE) {
    const fields = system.bodies.filter((b) => b.kind === 'asteroidField')
    if (fields.length) {
      const field = pick(rng, fields)
      // Sit just outside the field shell (still "in" the belt, not free deep space).
      for (let attempt = 0; attempt < 24; attempt++) {
        const pos = localPositionNearBody(rng, field.position, field.radius ?? 80, SETTLEMENT_CLEARANCE_RADIUS)
        if (!pos) continue
        if (positionOverlapsBodies(pos, SETTLEMENT_CLEARANCE_RADIUS, system)) continue
        return {
          id: `body-${idCounter}`,
          name: generateBodyName(rng, 'settlement', system._usedNames),
          kind: 'settlement',
          parentId: field.id,
          inAsteroidField: true,
          position: pos,
          radius: null,
          economyTags: randomTags(rng),
          hasMissions: true,
          hasShipyard: false,
          hasShipParts: rng() < 0.06
        }
      }
    }
  }

  // Surface settlements: at most ONE per planet family (planet OR one of its
  // moons — never both). If that body already has a station, only 5% chance.
  // Surface points must still clear nearby station shells (a low orbit station
  // can sit close enough to the crust that a random pad would clip it).
  const takenFamilies = familiesWithSettlements(system)
  const candidates = system.bodies.filter(
    (b) => (b.kind === 'planet' || b.kind === 'moon') && !takenFamilies.has(hostFamilyId(b))
  )
  // Shuffle-pick until one accepts (station co-location roll, unless forced).
  const pool = [...candidates]
  while (pool.length) {
    const idx = intRange(rng, 0, pool.length - 1)
    const host = pool.splice(idx, 1)[0]
    if (!force && hostHasStation(system, host.id) && rng() >= SETTLEMENT_WITH_STATION_CHANCE) continue

    for (let attempt = 0; attempt < 32; attempt++) {
      const { position, surfaceOffset } = localPositionOnSurface(rng, host)
      // Host is intentionally "touching" (surface pad); check everything else.
      let clipped = false
      for (const b of system.bodies) {
        if (b.id === host.id) continue
        if (
          b.kind !== 'station' &&
          b.kind !== 'settlement' &&
          b.kind !== 'moon' &&
          b.kind !== 'planet' &&
          b.kind !== 'asteroidField'
        ) {
          continue
        }
        const need = SETTLEMENT_CLEARANCE_RADIUS + bodyShellRadius(b) + MOON_ORBIT_CLEARANCE_MARGIN
        if (dist3(position, b.position) < need) {
          clipped = true
          break
        }
      }
      if (clipped) continue

      return {
        id: `body-${idCounter}`,
        name: generateBodyName(rng, 'settlement', system._usedNames),
        kind: 'settlement',
        parentId: host.id,
        surfaceOffset,
        position,
        radius: null,
        economyTags: randomTags(rng),
        hasMissions: true,
        hasShipyard: false,
        hasShipParts: rng() < 0.06
      }
    }
  }
  return null
}

/**
 * Planets/moons that host a station or surface settlement may keep their
 * catalog name ("Sarnosian III" / "Sarnosian III - Moon I") or roll a unique
 * proper name (no numerals). Catalog moons of a renamed planet are retagged.
 */
function applyFacilityHostPlanetNames(systems, rng, usedNames) {
  for (const system of systems) {
    const hostPlanetIds = new Set()
    const hostMoonIds = new Set()
    for (const b of system.bodies) {
      if (b.kind !== 'station' && b.kind !== 'settlement') continue
      if (!b.parentId) continue
      const parent = system.bodies.find((x) => x.id === b.parentId)
      if (!parent) continue
      if (parent.kind === 'planet') hostPlanetIds.add(parent.id)
      if (parent.kind === 'moon') hostMoonIds.add(parent.id)
    }

    for (const planet of system.bodies) {
      if (planet.kind !== 'planet' || !hostPlanetIds.has(planet.id)) continue
      if (rng() >= PLANET_UNIQUE_NAME_CHANCE) continue
      const oldName = planet.name
      const unique = generateUniquePlanetName(rng, usedNames)
      planet.name = unique
      const moons = system.bodies.filter((m) => m.kind === 'moon' && m.parentId === planet.id)
      moons.forEach((moon, i) => {
        if (isSequentialMoonName(oldName, moon.name)) {
          moon.name = sequentialMoonName(unique, i + 1)
        }
      })
    }

    for (const moon of system.bodies) {
      if (moon.kind !== 'moon' || !hostMoonIds.has(moon.id)) continue
      if (rng() >= MOON_UNIQUE_NAME_CHANCE) continue
      // Only replace catalog-style names ("… - Moon I"); leave proper names alone.
      if (!/ - Moon [IVXLCDM]+$/.test(moon.name)) continue
      moon.name = generateUniqueMoonName(rng, usedNames)
    }
  }
}

/** When a system is renamed (e.g. → Whispers), retag sequential planets/moons. */
function retagSequentialBodiesForSystemRename(system, oldName, newName) {
  if (!oldName || oldName === newName) return
  // Match "{OldSystem} III" / "{OldSystem} XII" catalog names only.
  const re = new RegExp(`^${oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ([IVXLCDM]+)$`)
  for (const body of system.bodies) {
    if (body.kind !== 'planet') continue
    const m = body.name.match(re)
    if (!m) continue
    const oldPlanetName = body.name
    body.name = `${newName} ${m[1]}`
    const moons = system.bodies.filter((moon) => moon.kind === 'moon' && moon.parentId === body.id)
    moons.forEach((moon, i) => {
      if (isSequentialMoonName(oldPlanetName, moon.name)) {
        moon.name = sequentialMoonName(body.name, i + 1)
      }
    })
  }
}

function galaxyDistXZ(a, b) {
  return Math.hypot(
    a.galaxyPosition[0] - b.galaxyPosition[0],
    a.galaxyPosition[2] - b.galaxyPosition[2]
  )
}

/** Stable 0–1 from string (edge decisions without galaxy RNG stream). */
function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * Sparse undirected warp graph (scales to thousands of systems):
 * 1) k-nearest candidate edges → Kruskal MST (or forest)
 * 2) Bridge any remaining components with nearest inter-component links
 * 3) Optional short extras so routes aren't pure trees
 */
function computeNeighborLanes(systems) {
  if (!systems?.length) return
  if (systems.length === 1) {
    systems[0].neighborIds = []
    return
  }

  const neighborSets = new Map(systems.map((s) => [s.id, new Set()]))
  const parent = new Map(systems.map((s) => [s.id, s.id]))
  function find(id) {
    let p = parent.get(id)
    if (p !== id) {
      p = find(p)
      parent.set(id, p)
    }
    return p
  }
  function unite(a, b) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return false
    parent.set(ra, rb)
    return true
  }

  // Per-system k-nearest (undirected candidates) — O(n·k) edges, not O(n²).
  const nearestBySystem = new Map()
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const edgeMap = new Map()
  for (const system of systems) {
    const nearest = systems
      .filter((o) => o.id !== system.id)
      .map((o) => ({ id: o.id, dist: galaxyDistXZ(system, o) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, JUMP_NEAREST_CANDIDATES)
    nearestBySystem.set(system.id, nearest)
    for (const n of nearest) {
      const key = edgeKey(system.id, n.id)
      if (!edgeMap.has(key)) edgeMap.set(key, { a: system.id, b: n.id, dist: n.dist })
    }
  }
  const edges = [...edgeMap.values()].sort(
    (e1, e2) => e1.dist - e2.dist || String(e1.a).localeCompare(String(e2.a))
  )

  // Phase 1 — Kruskal forest on k-nearest candidates.
  let mstEdges = 0
  const need = systems.length - 1
  for (const e of edges) {
    if (unite(e.a, e.b)) {
      neighborSets.get(e.a).add(e.b)
      neighborSets.get(e.b).add(e.a)
      mstEdges++
      if (mstEdges >= need) break
    }
  }

  // Phase 1b — if k-nearest forest is incomplete, bridge components by nearest pair.
  if (mstEdges < need) {
    const byId = new Map(systems.map((s) => [s.id, s]))
    const components = () => {
      const groups = new Map()
      for (const s of systems) {
        const r = find(s.id)
        if (!groups.has(r)) groups.set(r, [])
        groups.get(r).push(s.id)
      }
      return [...groups.values()]
    }
    let comps = components()
    let guard = 0
    while (comps.length > 1 && guard++ < systems.length) {
      let best = null
      for (let i = 0; i < comps.length; i++) {
        for (let j = i + 1; j < comps.length; j++) {
          // Sample up to 40 systems per component for bridge search (O(1) pairs).
          const aList = comps[i].length > 40 ? comps[i].slice(0, 40) : comps[i]
          const bList = comps[j].length > 40 ? comps[j].slice(0, 40) : comps[j]
          for (const aId of aList) {
            const a = byId.get(aId)
            for (const bId of bList) {
              const b = byId.get(bId)
              const dist = galaxyDistXZ(a, b)
              if (!best || dist < best.dist) best = { aId, bId, dist }
            }
          }
        }
      }
      if (!best) break
      if (unite(best.aId, best.bId)) {
        neighborSets.get(best.aId).add(best.bId)
        neighborSets.get(best.bId).add(best.aId)
        mstEdges++
      }
      comps = components()
    }
  }

  // Phase 2 — short redundant lanes from each system's k-nearest list.
  for (const system of systems) {
    const nearest = nearestBySystem.get(system.id) ?? []
    let added = 0
    for (const n of nearest) {
      if (added >= JUMP_EXTRA_NEAR_LINKS) break
      if (neighborSets.get(system.id).has(n.id)) continue
      if (neighborSets.get(system.id).size >= JUMP_MAX_DEGREE) break
      if (neighborSets.get(n.id).size >= JUMP_MAX_DEGREE) continue
      const key = edgeKey(system.id, n.id)
      if (hash01(`warp-extra:${key}`) > 0.42) continue
      neighborSets.get(system.id).add(n.id)
      neighborSets.get(n.id).add(system.id)
      added++
    }
  }

  for (const system of systems) {
    system.neighborIds = [...neighborSets.get(system.id)]
  }
}

/** World radius of a warp gate portal shell (flight / SC arrival). */
export const WARP_GATE_RADIUS = 140
/** Max distance from gate center to activate / F-jump (2 km). */
export const WARP_GATE_ACTIVATION_RANGE = 2000
/** Local-system orbital radius for gate placement (outer rim). */
const WARP_GATE_ORBIT = SYSTEM_LOCAL_MAX_RADIUS * 0.88

/**
 * One warp gate per neighbor lane. Names: "Warp Gate: {adjoining system}".
 * Deterministic from galaxy geometry (no RNG). Safe to re-run on load.
 */
export function placeWarpGates(systems) {
  if (!systems?.length) return
  const byId = new Map(systems.map((s) => [s.id, s]))

  for (const system of systems) {
    system.bodies = (system.bodies ?? []).filter((b) => b.kind !== 'warpGate')
    const neighbors = (system.neighborIds ?? [])
      .map((id) => byId.get(id))
      .filter(Boolean)
    // Stable order: angle toward neighbor in galaxy XZ, then id.
    neighbors.sort((a, b) => {
      const aa = Math.atan2(
        a.galaxyPosition[2] - system.galaxyPosition[2],
        a.galaxyPosition[0] - system.galaxyPosition[0]
      )
      const bb = Math.atan2(
        b.galaxyPosition[2] - system.galaxyPosition[2],
        b.galaxyPosition[0] - system.galaxyPosition[0]
      )
      if (aa !== bb) return aa - bb
      return String(a.id).localeCompare(String(b.id))
    })

    neighbors.forEach((neighbor, i) => {
      const dx = neighbor.galaxyPosition[0] - system.galaxyPosition[0]
      const dz = neighbor.galaxyPosition[2] - system.galaxyPosition[2]
      let angle = Math.atan2(dz, dx)
      if (!Number.isFinite(angle)) angle = (i / Math.max(1, neighbors.length)) * Math.PI * 2
      // Slight fan if two neighbors share nearly the same bearing.
      angle += (i % 5) * 0.04
      const x = Math.cos(angle) * WARP_GATE_ORBIT
      const z = Math.sin(angle) * WARP_GATE_ORBIT
      const y = 180 + (i % 4) * 55
      system.bodies.push({
        id: `warp-gate-${system.id}-${neighbor.id}`,
        name: `Warp Gate: ${neighbor.name}`,
        kind: 'warpGate',
        position: [x, y, z],
        radius: WARP_GATE_RADIUS,
        destinationSystemId: neighbor.id
      })
    })
  }
}

/**
 * Rename the home system to Terra Prime and retag sequential planet names /
 * warp gates that reference it. Idempotent if already named.
 */
export function applyStartingSystemName(system, galaxy) {
  if (!system) return system
  const previous = system.name
  if (previous === STARTING_SYSTEM_NAME) {
    system.securityRating = 6
    return system
  }
  // Free the reserved name if another system accidentally has it.
  if (galaxy?.systems) {
    for (const s of galaxy.systems) {
      if (s !== system && s.name === STARTING_SYSTEM_NAME) {
        s.name = previous && previous !== STARTING_SYSTEM_NAME ? `${previous} Reach` : `${s.id}`
        retagSequentialBodiesForSystemRename(s, STARTING_SYSTEM_NAME, s.name)
      }
    }
  }
  system.name = STARTING_SYSTEM_NAME
  retagSequentialBodiesForSystemRename(system, previous, STARTING_SYSTEM_NAME)
  system.securityRating = 6
  // Gate labels are "Warp Gate: {neighbor name}" — rebuild so routes read Terra Prime.
  if (galaxy?.systems?.length) placeWarpGates(galaxy.systems)
  return system
}

/** Rebuild warp gates if missing or out of sync with neighborIds (old saves). */
export function ensureWarpGates(galaxy) {
  if (!galaxy?.systems?.length) return
  const byId = new Map(galaxy.systems.map((s) => [s.id, s]))
  let needs = false
  for (const system of galaxy.systems) {
    const gates = (system.bodies ?? []).filter((b) => b.kind === 'warpGate')
    const n = system.neighborIds?.length ?? 0
    if (gates.length !== n) {
      needs = true
      break
    }
    const dests = new Set(gates.map((g) => String(g.destinationSystemId)))
    for (const id of system.neighborIds ?? []) {
      if (!dests.has(String(id))) {
        needs = true
        break
      }
    }
    if (needs) break
    for (const g of gates) {
      const dest = byId.get(g.destinationSystemId)
      if (dest && g.name !== `Warp Gate: ${dest.name}`) {
        needs = true
        break
      }
    }
    if (needs) break
  }
  if (needs) placeWarpGates(galaxy.systems)
}

export function findWarpGateTo(system, destinationSystemId) {
  if (!system || destinationSystemId == null) return null
  const dest = String(destinationSystemId)
  return (
    (system.bodies ?? []).find(
      (b) => b.kind === 'warpGate' && String(b.destinationSystemId) === dest
    ) ?? null
  )
}

/** True when ship is within `range` metres of the gate centre (default 2 km). */
export function isNearWarpGate(shipPosition, gate, range = WARP_GATE_ACTIVATION_RANGE) {
  if (!gate || !shipPosition) return false
  const dx = shipPosition[0] - gate.position[0]
  const dy = shipPosition[1] - gate.position[1]
  const dz = shipPosition[2] - gate.position[2]
  return dx * dx + dy * dy + dz * dz <= range * range
}

/** Nearest warp gate within activation range, or null. */
export function findNearbyWarpGate(system, shipPosition, range = WARP_GATE_ACTIVATION_RANGE) {
  if (!system?.bodies || !shipPosition) return null
  let best = null
  let bestD2 = range * range
  for (const body of system.bodies) {
    if (body.kind !== 'warpGate') continue
    const dx = shipPosition[0] - body.position[0]
    const dy = shipPosition[1] - body.position[1]
    const dz = shipPosition[2] - body.position[2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 <= bestD2) {
      bestD2 = d2
      best = body
    }
  }
  return best
}

// Guarantees the player's home system has somewhere to dock and trade.
export function ensureStartingSystemFacilities(system, rng, startId = 0) {
  let bodyIdCounter = startId
  const maxExisting = system.bodies.reduce((m, b) => {
    const n = Number(String(b.id).replace(/^body-/, ''))
    return Number.isFinite(n) ? Math.max(m, n + 1) : m
  }, 0)
  bodyIdCounter = Math.max(bodyIdCounter, maxExisting)

  // Local uniqueness for names we mint here (home system only).
  if (!system._usedNames) {
    const used = new Set()
    if (system.name) used.add(system.name.toLowerCase())
    for (const b of system.bodies) if (b.name) used.add(b.name.toLowerCase())
    system._usedNames = used
  }

  while (system.bodies.filter((b) => b.kind === 'station').length < 1) {
    system.bodies.push(makeStation(rng, bodyIdCounter++, system))
  }
  // Force surface placements so the home system always gets docks even when
  // station co-location / family rules would otherwise reject random rolls.
  let guard = 0
  while (system.bodies.filter((b) => b.kind === 'settlement').length < 2 && guard++ < 20) {
    const s = makeSettlement(rng, bodyIdCounter++, system, { force: true })
    if (s) system.bodies.push(s)
    else break
  }
  // Always at least one asteroid belt in the starting system (mining at home).
  // Place it near arrival so it shows up on Overview and is a short SC hop.
  if (!system.bodies.some((b) => b.kind === 'asteroidField')) {
    system.bodies.push(makeHomeAsteroidField(rng, bodyIdCounter++, system, system._usedNames))
  }
  // Optional unique planet names for newly hosted worlds (home system polish).
  applyFacilityHostPlanetNames([system], rng, system._usedNames)
  return bodyIdCounter
}

// Default production galaxy (~7.8× original 450 systems). Density kept similar
// to the 4050-system pass; denser core (40% of systems/planets).
export const DEFAULT_SYSTEM_COUNT = 3500
export const DEFAULT_TOTAL_PLANETS = 11667
export const DEFAULT_STATION_COUNT = 1400
export const DEFAULT_SETTLEMENT_COUNT = 933
export const DEFAULT_ASTEROID_FIELD_COUNT = 1167
export const DEFAULT_SPECIES_COUNT = 40
/** Fraction of systems (and thus ~planets) placed in the dense core disk. */
export const CORE_SYSTEM_FRACTION = 0.4
/**
 * Fixed seed for the shared galaxy layout — every New Game uses the same systems,
 * names, warp lanes, and central home system. Player seed only diversifies
 * mission boards / career rolls, not the map.
 */
export const CANONICAL_GALAXY_SEED = 8675309

/** Compact galaxy for unit tests (full default is multi-k systems / 13.5k planets). */
export const TEST_GALAXY_OPTS = {
  systemCount: 90,
  totalPlanets: 280,
  stationCount: 40,
  settlementCount: 30,
  asteroidFieldCount: 28,
  speciesCount: 8,
  coreSystemFraction: CORE_SYSTEM_FRACTION
}

export function generateGalaxy(seed, opts = {}) {
  const {
    systemCount = DEFAULT_SYSTEM_COUNT,
    totalPlanets = DEFAULT_TOTAL_PLANETS,
    stationCount = DEFAULT_STATION_COUNT,
    settlementCount = DEFAULT_SETTLEMENT_COUNT,
    // ~1/3 of systems get a belt so mining isn't rare when exploring.
    asteroidFieldCount = DEFAULT_ASTEROID_FIELD_COUNT,
    speciesCount = DEFAULT_SPECIES_COUNT,
    coreSystemFraction = CORE_SYSTEM_FRACTION
  } = opts
  const rng = mulberry32(seed)
  let bodyIdCounter = 0

  // Galaxy-wide display-name registry (case-insensitive). Reserved specials first.
  const usedNames = new Set([
    WHISPERS_SYSTEM_NAME.toLowerCase(),
    WHISPERS_STATION_NAME.toLowerCase(),
    STARTING_SYSTEM_NAME.toLowerCase()
  ])

  // 40% of systems in the core disk so ~40% of planets sit toward the core
  // (planets are spread evenly across systems).
  const coreSystemCount = Math.max(
    1,
    Math.min(systemCount - 1, Math.round(systemCount * coreSystemFraction))
  )

  const planetsPerSystem = []
  let remainingPlanets = totalPlanets
  for (let i = 0; i < systemCount; i++) {
    const systemsLeft = systemCount - i
    const avgLeft = remainingPlanets / systemsLeft
    const count = Math.max(1, Math.round(range(rng, avgLeft * 0.4, avgLeft * 1.6)))
    planetsPerSystem.push(count)
    remainingPlanets -= count
  }
  planetsPerSystem[planetsPerSystem.length - 1] = Math.max(
    1,
    planetsPerSystem[planetsPerSystem.length - 1] + remainingPlanets
  )

  const systems = []
  for (let i = 0; i < systemCount; i++) {
    const sizeScale = range(rng, ...SYSTEM_SCALE_VARIANCE)
    const systemName = generateSystemName(rng, usedNames)
    const bodies = []
    let planetIndex = 0
    for (let p = 0; p < planetsPerSystem[i]; p++) {
      planetIndex += 1
      const planet = makePlanetOrMoon(
        rng,
        bodyIdCounter++,
        'planet',
        null,
        sizeScale,
        sequentialPlanetName(systemName, planetIndex)
      )
      // Sequential planet labels share the system name — not separate usedNames entries.
      bodies.push(planet)
      // 0–3 moons: first at MOON_CHANCE, extras rarer (still ~23% of planets have ≥1).
      let moonCount = 0
      if (rng() < MOON_CHANCE) moonCount = 1
      if (moonCount === 1 && rng() < 0.28) moonCount = 2
      if (moonCount === 2 && rng() < 0.18) moonCount = 3
      const moonsOfPlanet = []
      for (let mi = 0; mi < moonCount; mi++) {
        const moon = makePlanetOrMoon(
          rng,
          bodyIdCounter++,
          'moon',
          planet,
          sizeScale,
          sequentialMoonName(planet.name, mi + 1),
          moonsOfPlanet
        )
        moonsOfPlanet.push(moon)
        bodies.push(moon)
      }
    }
    // First coreSystemCount systems land in the dense core; rest in the outer arms.
    const inCore = i < coreSystemCount
    const galaxyPosition = spiralPosition(rng, i % ARM_COUNT, {
      coreOnly: inCore,
      outerOnly: !inCore
    })
    // Security rating 0–6: center 30% core, outer 10% rim always 0 (see game/security.js).
    const dist = Math.hypot(galaxyPosition[0], galaxyPosition[2])
    const f = Math.min(1, dist / GALAXY_MAX_RADIUS)
    let securityRating = 0
    if (f >= 0.9) securityRating = 0
    else if (f < 0.3) {
      securityRating = rng() < 0.8 ? 3 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 2)
    } else if (rng() < 0.75) {
      securityRating = 1 + Math.floor(rng() * 2)
    } else if (rng() < 0.4) {
      securityRating = 0
    } else {
      securityRating = 3 + Math.floor(rng() * 4)
    }
    systems.push({
      id: `sys-${i}`,
      name: systemName,
      galaxyPosition,
      sizeScale,
      bodies,
      // Shared with makeStation/makeSettlement so facility names stay unique.
      _usedNames: usedNames,
      securityRating
    })
  }

  // Facilities: slight core bias so busy hubs cluster where more planets are.
  function pickSystemBiased() {
    if (rng() < coreSystemFraction && coreSystemCount > 0) {
      return systems[intRange(rng, 0, coreSystemCount - 1)]
    }
    return pick(rng, systems)
  }

  for (let i = 0; i < stationCount; i++) {
    const system = pickSystemBiased()
    system.bodies.push(makeStation(rng, bodyIdCounter++, system))
  }
  for (let i = 0; i < settlementCount; i++) {
    const system = pickSystemBiased()
    const settlement = makeSettlement(rng, bodyIdCounter++, system)
    if (settlement) system.bodies.push(settlement)
  }
  for (let i = 0; i < asteroidFieldCount; i++) {
    const system = pickSystemBiased()
    system.bodies.push(makeAsteroidField(rng, bodyIdCounter++, system.sizeScale, usedNames))
  }

  applyFacilityHostPlanetNames(systems, rng, usedNames)

  computeNeighborLanes(systems)

  // Outer-rim landmark: rename the farthest system and guarantee SerNub's station.
  bodyIdCounter = placeWhispersSystem(systems, bodyIdCounter, usedNames)

  // Warp gates after renames so "Warp Gate: Whispers" uses the final name.
  placeWarpGates(systems)

  // Drop generation-only name sets so save JSON stays lean.
  for (const system of systems) delete system._usedNames

  const species = []
  for (let i = 0; i < speciesCount; i++) species.push(generateSpeciesName(rng))

  return { seed, systems, species, _nextBodyId: bodyIdCounter }
}

/**
 * Picks the system farthest from the galactic core, names it Whispers, tags it
 * as ambient-hostile-free, and ensures a station named SerNub's Pleasure Palace.
 * Deterministic from layout alone (no extra RNG) so seeds stay stable.
 */
function placeWhispersSystem(systems, bodyIdCounter, usedNames = null) {
  let rim = systems[0]
  let bestDist = -1
  for (const system of systems) {
    const dist = Math.hypot(system.galaxyPosition[0], system.galaxyPosition[2])
    if (dist > bestDist) {
      bestDist = dist
      rim = system
    }
  }

  // Systems are already unique; still free the reserved Whispers name if it
  // somehow landed elsewhere, then assign it to the rim system.
  for (const system of systems) {
    if (system !== rim && system.name === WHISPERS_SYSTEM_NAME) {
      const old = system.name
      system.name = usedNames
        ? generateSystemName(mulberry32(hashStringStable(system.id)), usedNames)
        : `${system.name} Reach`
      retagSequentialBodiesForSystemRename(system, old, system.name)
    }
  }

  const previousName = rim.name
  rim.name = WHISPERS_SYSTEM_NAME
  retagSequentialBodiesForSystemRename(rim, previousName, WHISPERS_SYSTEM_NAME)
  // main.js ambient spawn keys off this — permanent (not breakable like home peace).
  rim.noAmbientHostiles = true
  // Only trinary in the galaxy — starMesh / starTypeForSystem read this flag.
  rim.starType = 'trinary'

  let station = rim.bodies.find((b) => b.kind === 'station')
  if (!station) {
    // Seeded only from system id so we don't perturb the main galaxy RNG stream.
    const idHash = [...rim.id].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)
    const stationRng = mulberry32(Math.abs(idHash) ^ 0x5e12ab)
    // Ensure makeStation can claim unique facility names if _usedNames was cleared.
    if (!rim._usedNames && usedNames) rim._usedNames = usedNames
    station = makeStation(stationRng, bodyIdCounter++, rim)
    rim.bodies.push(station)
  }
  station.name = WHISPERS_STATION_NAME
  station.hasMissions = true
  station.hasShipyard = true
  // Keep whatever clone-bay roll makeStation already made (stable with seed).
  if (typeof station.hasCloneBay !== 'boolean') station.hasCloneBay = false
  // Always park on a fixed star orbit outside the trinary companions + planets
  // (bodies don't animate around the sun — "stationary" = orbitsStar, not planet-bound).
  placeWhispersPalaceOnStarOrbit(station, rim)

  return bodyIdCounter
}

/**
 * Worst-case clear of the outer trinary companion:
 *   max mainSequence core = 130 × STAR_SIZE_SCALE 225 = 29250
 *   outer sep ≈ 417500 (halo-stacked), + companion halo 3.5× + station shell.
 * Station sits outside this so secondary/tertiary never sweep through it.
 */
const WHISPERS_TRINARY_OUTER_CLEAR = 560000

function placeWhispersPalaceOnStarOrbit(station, system) {
  station.parentId = undefined
  station.orbitsStar = true

  const scale = system.sizeScale ?? 1
  let r = WHISPERS_TRINARY_OUTER_CLEAR * scale
  for (const b of system.bodies) {
    if (b.id === station.id) continue
    if (b.kind === 'planet' || b.kind === 'moon') {
      r = Math.max(
        r,
        xzOrbitRadius(b.position) + (b.radius ?? 0) + STATION_CLEARANCE_RADIUS + STATION_PLANET_ORBIT_GAP
      )
    } else if (b.kind === 'station' && b.orbitsStar) {
      r = Math.max(
        r,
        xzOrbitRadius(b.position) + STATION_CLEARANCE_RADIUS * 2 + MOON_ORBIT_CLEARANCE_MARGIN
      )
    } else if (b.kind === 'asteroidField') {
      r = Math.max(
        r,
        xzOrbitRadius(b.position) + (b.radius ?? 0) + STATION_CLEARANCE_RADIUS + MOON_ORBIT_CLEARANCE_MARGIN
      )
    }
  }

  // Deterministic angle from system+station id (stable across regenerations).
  const angSeed = hashStringStable(`${system.id}:${station.id}:palace-orbit`)
  let theta = ((angSeed % 3600) / 3600) * Math.PI * 2
  const y = ((angSeed % 17) - 8) * 0.004 * r

  for (let attempt = 0; attempt < 96; attempt++) {
    const pos = [Math.cos(theta) * r, y, Math.sin(theta) * r]
    if (!positionOverlapsBodiesExcept(pos, STATION_CLEARANCE_RADIUS, system, station.id)) {
      station.position = pos
      return
    }
    theta += 0.41
    if (attempt > 0 && attempt % 16 === 0) r += STATION_CLEARANCE_RADIUS
  }
  station.position = [r, y, 0]
}

function positionOverlapsBodiesExcept(position, ownShell, system, excludeId) {
  for (const b of system.bodies) {
    if (b.id === excludeId) continue
    if (
      b.kind !== 'planet' &&
      b.kind !== 'moon' &&
      b.kind !== 'station' &&
      b.kind !== 'settlement' &&
      b.kind !== 'asteroidField'
    ) {
      continue
    }
    const need = ownShell + bodyShellRadius(b) + clearanceMarginFor(b.kind)
    if (dist3(position, b.position) < need) return true
  }
  return false
}

function hashStringStable(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return Math.abs(h) || 1
}

export function canJumpTo(fromSystem, toSystemId) {
  return fromSystem.neighborIds.includes(toSystemId)
}

/**
 * Shortest hyperspace path along neighbor lanes (BFS).
 * Returns system ids from `fromSystemId` to `toSystemId` inclusive, or null
 * if unreachable. Same system → single-element path.
 */
export function findHyperspaceRoute(galaxy, fromSystemId, toSystemId) {
  if (!fromSystemId || !toSystemId) return null
  if (fromSystemId === toSystemId) return [fromSystemId]

  const byId = new Map(galaxy.systems.map((s) => [s.id, s]))
  if (!byId.has(fromSystemId) || !byId.has(toSystemId)) return null

  const prev = new Map([[fromSystemId, null]])
  const queue = [fromSystemId]
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    const system = byId.get(id)
    if (!system) continue
    for (const neighborId of system.neighborIds) {
      if (prev.has(neighborId)) continue
      prev.set(neighborId, id)
      if (neighborId === toSystemId) {
        const path = []
        let cur = toSystemId
        while (cur != null) {
          path.push(cur)
          cur = prev.get(cur)
        }
        path.reverse()
        return path
      }
      queue.push(neighborId)
    }
  }
  return null
}

/**
 * After a jump, drop hops already arrived at from player.plottedRoute
 * (remaining system ids, destination last). Recomputes if the player left
 * the plotted chain so the route still leads to the same destination.
 */
export function advancePlottedRoute(gameState) {
  const route = gameState.player.plottedRoute
  if (!Array.isArray(route) || route.length === 0) {
    gameState.player.plottedRoute = null
    return
  }
  const current = gameState.player.currentSystemId
  const idx = route.indexOf(current)
  if (idx >= 0) {
    const rest = route.slice(idx + 1)
    gameState.player.plottedRoute = rest.length ? rest : null
    return
  }
  // Jumped off the chain — replot from here to the original destination.
  const dest = route[route.length - 1]
  if (current === dest) {
    gameState.player.plottedRoute = null
    return
  }
  const path = findHyperspaceRoute(gameState.galaxy, current, dest)
  if (!path || path.length < 2) {
    gameState.player.plottedRoute = null
    return
  }
  gameState.player.plottedRoute = path.slice(1)
}

export function coreFraction(system) {
  const dist = Math.hypot(system.galaxyPosition[0], system.galaxyPosition[2])
  return Math.min(1, dist / GALAXY_MAX_RADIUS)
}

/**
 * Ensure every system has securityRating 0–6 (lazy for old saves).
 * Uses a deterministic hash of system.id so it stays stable across sessions.
 */
export function ensureSystemSecurity(system) {
  if (!system) return 0
  if (system.securityRating != null && Number.isFinite(system.securityRating)) {
    return Math.max(0, Math.min(6, Math.floor(system.securityRating)))
  }
  // Deterministic "rng" from system id
  let h = 2166136261
  const s = String(system.id ?? '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  let x = h >>> 0
  const rng = () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 4294967296
  }
  const f = coreFraction(system)
  let rating
  // Center 30% core, last 10% outer rim (matches game/security.js rollSecurityRating).
  if (f >= 0.9) rating = 0
  else if (f < 0.3) {
    rating = rng() < 0.8 ? 3 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 2)
  } else {
    if (rng() < 0.75) rating = 1 + Math.floor(rng() * 2)
    else if (rng() < 0.4) rating = 0
    else rating = 3 + Math.floor(rng() * 4)
  }
  system.securityRating = rating
  return rating
}

export function systemsWithinJumps(galaxy, originSystemId, maxJumps) {
  const visited = new Set([originSystemId])
  let frontier = [originSystemId]
  for (let depth = 0; depth < maxJumps && frontier.length; depth++) {
    const next = []
    for (const systemId of frontier) {
      const system = getSystem(galaxy, systemId)
      for (const neighborId of system.neighborIds) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        next.push(neighborId)
      }
    }
    frontier = next
  }
  return [...visited].map((id) => getSystem(galaxy, id))
}

export function findBody(galaxy, bodyId) {
  for (const system of galaxy.systems) {
    const body = system.bodies.find((b) => b.id === bodyId)
    if (body) return body
  }
  return null
}

export function findSystemOfBody(galaxy, bodyId) {
  return galaxy.systems.find((s) => s.bodies.some((b) => b.id === bodyId)) ?? null
}

export function getSystem(galaxy, systemId) {
  return galaxy.systems.find((s) => s.id === systemId) ?? null
}
