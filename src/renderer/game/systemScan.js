/**
 * Region Sonar Scan / Anomalous Signals — drone scan of nearby hidden sites.
 * Anomalies roll per system; scan progress lives on the system object (saved with galaxy).
 */
import { mulberry32, pick, intRange, range } from '../procgen/prng.js'
import { GOODS, MINED_ORE_GOOD_IDS, SHIP_PARTS_GOOD_ID, SURVEY_DATA_GOOD_ID } from '../data/goods.js'
import {
  tryRollBlueprintDrop,
  tryRollAlienBlueprintDrop
} from './crafting.js'
import { tryRollSkillbookDrop, getSkillDef } from './skills.js'
import { oreTierForField } from './mining.js'
import { WORLD_RADIUS } from '../procgen/world.js'

export const SYSTEM_SCAN_PROBE_COUNT = 4
/** Local contacts shown by the Region Sonar Scan, centred on the player's boat. */
export const SYSTEM_SCAN_CONTACT_RANGE = 20000
/** Base seconds of “lock” progress needed at full strength (explorer reduces). */
export const BASE_SCAN_LOCK_S = 14
/** Site despawn after alien base destroyed. */
export const ALIEN_SITE_DESPAWN_S = 300
/** Galaxy-wide spatial anomaly reshuffle interval (sim seconds = wall seconds while playing). */
export const ANOMALY_REFRESH_INTERVAL_S = 4 * 3600
export const ALIEN_BASE_CREDITS_BASE = 6000
export const VALUABLE_LOOT_CHANCE = 0.25
export const DATACORE_VALUABLE_CHANCE = 0.3
/** Very rare site drops (datacore hack / alien base wreck). */
export const SITE_BLUEPRINT_CHANCE = 0.012
export const SITE_SKILLBOOK_CHANCE = 0.008
/** Radius of the synthetic asteroidField body an ore_anomaly site owns. */
export const ORE_ANOMALY_FIELD_RADIUS = 260

const ANOMALY_DISPLAY_NAMES = {
  // Faction id is still `alien` in code; player-facing name is The Drowned.
  alien_incursion: 'Drowned Incursion',
  datacore: 'Datacore Relic',
  datacore_takeover: 'Datacore Takeover',
  alien_datacore: 'Pre-war Datacore',
  ore_anomaly: 'Rare Salvage Cache'
}

/** Datacore-family types all share the nodule-hacking interaction. */
export function isDatacoreType(type) {
  return type === 'datacore' || type === 'datacore_takeover' || type === 'alien_datacore'
}

/** One grade better than the surrounding water normally gives, capped at the top. */
export function rareOreTierForSystem(site) {
  const base = MINED_ORE_GOOD_IDS.indexOf(oreTierForField(site))
  const idx = Math.min(MINED_ORE_GOOD_IDS.length - 1, Math.max(0, base) + 1)
  return MINED_ORE_GOOD_IDS[idx]
}

const TRADE_GOODS = GOODS.filter(
  (g) =>
    !MINED_ORE_GOOD_IDS.includes(g.id) &&
    g.id !== SHIP_PARTS_GOOD_ID &&
    g.id !== SURVEY_DATA_GOOD_ID &&
    g.id !== 'ore'
)

const VALUABLE_GOOD_IDS = ['luxury_goods', 'electronics', 'narcotics', 'quantum_ore', 'ship_parts'].filter(
  (id) => GOODS.some((g) => g.id === id)
)

function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function systemRng(systemId, epoch = 0) {
  // Epoch is the reshuffle window — each window re-rolls presence, type, and
  // count independently (not a like-for-like replace of the previous sites).
  // v4: sea-surface placement inside WORLD_RADIUS (not space orbits).
  return mulberry32(hashString(`anomaly-v4:${systemId}:e${epoch}`))
}

/** Integer anomaly generation from campaign simTime. */
export function anomalyEpochAt(simTime) {
  return Math.floor(Math.max(0, simTime ?? 0) / ANOMALY_REFRESH_INTERVAL_S)
}

/**
 * Resolve epoch from a number, galaxy object, or default 0.
 * @param {number | { anomalyEpoch?: number } | null | undefined} epochOrGalaxy
 */
export function resolveAnomalyEpoch(epochOrGalaxy) {
  if (typeof epochOrGalaxy === 'number' && Number.isFinite(epochOrGalaxy)) {
    return Math.max(0, Math.floor(epochOrGalaxy))
  }
  if (epochOrGalaxy && typeof epochOrGalaxy === 'object') {
    const e = epochOrGalaxy.anomalyEpoch
    if (typeof e === 'number' && Number.isFinite(e)) return Math.max(0, Math.floor(e))
  }
  return 0
}

/**
 * Align galaxy.anomalyEpoch with simTime. When the 4h window advances,
 * wipe every system's sites so the next ensure re-rolls from scratch —
 * different systems may gain/lose sites, and types need not match the
 * previous window (not a like-for-like replace).
 *
 * Safe on first call / old saves: initializes epoch without wiping sites.
 *
 * @returns {{ refreshed: boolean, epoch: number }}
 */
export function tickGalaxyAnomalies(galaxy, simTime) {
  if (!galaxy) return { refreshed: false, epoch: 0 }
  const epoch = anomalyEpochAt(simTime)

  // First touch: adopt current window; keep any already-rolled sites.
  if (galaxy.anomalyEpoch == null || !Number.isFinite(galaxy.anomalyEpoch)) {
    galaxy.anomalyEpoch = epoch
    for (const system of galaxy.systems ?? []) {
      if (Array.isArray(system.spatialAnomalies) && system.anomalyEpoch == null) {
        system.anomalyEpoch = epoch
      }
    }
    return { refreshed: false, epoch }
  }

  if (galaxy.anomalyEpoch === epoch) {
    return { refreshed: false, epoch }
  }

  // Window rolled (may skip multiple if offline for a long time).
  galaxy.anomalyEpoch = epoch
  for (const system of galaxy.systems ?? []) {
    // Full wipe — next ensureSystemAnomalies rolls presence + type anew.
    delete system.spatialAnomalies
    delete system.anomalyEpoch
    delete system.anomalyDensityTag
    // ore_anomaly sites own a synthetic asteroidField body registered into
    // system.bodies (see ensureSystemAnomalies) — those don't live in
    // spatialAnomalies, so they need their own sweep on reshuffle.
    if (system.bodies?.some((b) => b.anomalySiteId)) {
      system.bodies = system.bodies.filter((b) => !b.anomalySiteId)
    }
  }
  return { refreshed: true, epoch }
}

// Sea placement: open water inside WORLD_RADIUS, clear of land/ports/fields.
// (Space-era star-orbit constants left the sites outside the 80 km sea with
// huge Y offsets — players never saw them.)
const ANOMALY_MIN_HOME_DIST = WORLD_RADIUS * 0.12
const ANOMALY_MIN_BODY_PAD = 1800
const ANOMALY_MIN_SITE_SEP = 6000
const ANOMALY_PLACE_ATTEMPTS = 64
/** Migration stamp: re-place space-era / off-sea sites once. */
const ANOMALY_SEA_MIGRATE_TAG = 'sea-v4'
/** Density layout stamp: safely refreshes only untouched old sparse site sets. */
const ANOMALY_DENSITY_TAG = 'sea-v5-dense'

function bodyClearanceRadius(body) {
  if (!body) return 0
  const r = Number(body.radius)
  if (Number.isFinite(r) && r > 0) return r
  if (body.kind === 'port') return 220
  if (body.kind === 'outpost') return 90
  if (body.kind === 'wreckField') return 280
  if (body.kind === 'island') return 800
  return 200
}

/** Horizontal distance on the sea (Y is always the waterline). */
function horizDist(a, b) {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[2] ?? 0) - (b[2] ?? 0))
}

/**
 * True when `pos` sits in open water: inside the world, clear of home waters
 * centre, and well clear of every island / harbour / wreck field.
 */
export function isAnomalyOpenSpace(pos, system, { extraPositions = [], minBodyPad = ANOMALY_MIN_BODY_PAD } = {}) {
  if (!pos || pos.length < 3) return false
  const r = Math.hypot(pos[0], pos[2])
  if (r < ANOMALY_MIN_HOME_DIST) return false
  if (r > WORLD_RADIUS * 0.98) return false
  // Sites live on the surface — reject leftover space-era altitude.
  if (Math.abs(pos[1] ?? 0) > 40) return false
  for (const body of system?.bodies ?? []) {
    if (!body?.position) continue
    const need = bodyClearanceRadius(body) + minBodyPad
    if (horizDist(pos, body.position) < need) return false
  }
  for (const other of extraPositions) {
    if (!other || other === pos) continue
    if (horizDist(pos, other) < ANOMALY_MIN_SITE_SEP) return false
  }
  return true
}

/**
 * Local position on the open sea — surface only, inside WORLD_RADIUS.
 */
function randomAnomalyPosition(rng, system = null, occupied = []) {
  const rMin = ANOMALY_MIN_HOME_DIST + 800
  const rMax = WORLD_RADIUS * 0.94

  for (let attempt = 0; attempt < ANOMALY_PLACE_ATTEMPTS; attempt++) {
    const r = range(rng, rMin, rMax)
    const theta = rng() * Math.PI * 2
    const pos = [r * Math.cos(theta), 0, r * Math.sin(theta)]
    if (isAnomalyOpenSpace(pos, system, { extraPositions: occupied })) return pos
  }

  // Fallback: mid-outer ring on a random bearing (always surface).
  const r = range(rng, WORLD_RADIUS * 0.45, WORLD_RADIUS * 0.9)
  const theta = rng() * Math.PI * 2
  return [r * Math.cos(theta), 0, r * Math.sin(theta)]
}

/** Re-place nodule offsets when a datacore site moves (surface cluster). */
function reanchorNodules(anomaly, newPos, rng) {
  if (!anomaly?.nodules?.length) return
  for (let n = 0; n < anomaly.nodules.length; n++) {
    const nodule = anomaly.nodules[n]
    const ang = (n / anomaly.nodules.length) * Math.PI * 2 + rng() * 0.4
    const d = 280 + rng() * 420
    nodule.position = [
      newPos[0] + Math.cos(ang) * d,
      0,
      newPos[2] + Math.sin(ang) * d
    ]
  }
}

/** True when sitting inside an island / harbour / field shell + pad. */
function isTooCloseToABody(pos, system, minBodyPad = ANOMALY_MIN_BODY_PAD) {
  for (const body of system?.bodies ?? []) {
    if (!body?.position) continue
    const need = bodyClearanceRadius(body) + minBodyPad
    if (horizDist(pos, body.position) < need) return true
  }
  return false
}

/** Sites rolled under the space placer (off-map or high Y) need re-seeding. */
function anomalyNeedsSeaFix(pos, system, occupied) {
  if (!pos) return true
  if (Math.abs(pos[1] ?? 0) > 40) return true
  if (Math.hypot(pos[0], pos[2]) > WORLD_RADIUS * 0.98) return true
  if (Math.hypot(pos[0], pos[2]) < ANOMALY_MIN_HOME_DIST * 0.5) return true
  if (isTooCloseToABody(pos, system)) return true
  if (!isAnomalyOpenSpace(pos, system, { extraPositions: occupied, minBodyPad: ANOMALY_MIN_BODY_PAD * 0.5 })) {
    // Allow already-scanned sites that are merely a bit close; still fix altitude.
    return Math.abs(pos[1] ?? 0) > 5
  }
  return false
}

/**
 * Migration: move sites that still use space-era positions (off the sea /
 * airborne) onto open water. Preserves scanned/active progress.
 */
function migrateCrowdedHiddenAnomalies(system, epoch) {
  if (!system?.spatialAnomalies?.length) return
  if (system.anomalySeaMigrated === ANOMALY_SEA_MIGRATE_TAG && system.anomalyOpenSpaceMigrated === epoch) {
    return
  }
  if (!system.bodies?.length) {
    system.anomalyOpenSpaceMigrated = epoch
    system.anomalySeaMigrated = ANOMALY_SEA_MIGRATE_TAG
    return
  }
  const rng = systemRng(system.id, epoch)
  const occupied = []
  for (const a of system.spatialAnomalies) {
    if (!a?.position) continue
    // Snap Y to the surface for every live site.
    if (Math.abs(a.position[1] ?? 0) > 0.01) {
      a.position = [a.position[0], 0, a.position[2]]
      if (a.nodules?.length) {
        for (const n of a.nodules) {
          if (n?.position) n.position = [n.position[0], 0, n.position[2]]
        }
      }
      if (a.oreFieldId) {
        const field = system.bodies?.find((b) => b.id === a.oreFieldId)
        if (field?.position) field.position = [field.position[0], 0, field.position[2]]
      }
    }
    // Re-place only still-hidden sites that are unusable on the sea.
    const progress =
      a.fullyScanned ||
      a.status === 'active' ||
      a.status === 'scanned' ||
      a.status === 'completed' ||
      a.status === 'despawning'
    if (progress) {
      occupied.push(a.position)
      continue
    }
    if (!anomalyNeedsSeaFix(a.position, system, occupied)) {
      occupied.push(a.position)
      continue
    }
    const next = randomAnomalyPosition(rng, system, occupied)
    a.position = next
    reanchorNodules(a, next, rng)
    if (a.oreFieldId) {
      const field = system.bodies?.find((b) => b.id === a.oreFieldId)
      if (field) field.position = [...next]
    }
    occupied.push(next)
  }
  system.anomalyOpenSpaceMigrated = epoch
  system.anomalySeaMigrated = ANOMALY_SEA_MIGRATE_TAG
}

/**
 * Roll / ensure spatial anomalies for a system (idempotent within an epoch).
 * Full sea worlds always get 6–12 surface sites; sparse fixtures keep a 20%
 * presence roll for unit tests.
 *
 * @param {object} system
 * @param {number | { anomalyEpoch?: number }} [epochOrGalaxy=0]
 */
export function ensureSystemAnomalies(system, epochOrGalaxy = 0) {
  if (!system) return []
  const epoch = resolveAnomalyEpoch(epochOrGalaxy)

  if (
    Array.isArray(system.spatialAnomalies) &&
    (system.anomalyEpoch ?? epoch) === epoch
  ) {
    system.anomalyEpoch = epoch
    // Old saves: empty list on the full sea (20% space-era presence roll) or
    // off-map sites — re-seed once under the sea placer so Region Sonar has work.
    const fullWorld = (system.bodies?.length ?? 0) >= 20
    const untouchedOldLayout =
      fullWorld &&
      system.anomalyDensityTag !== ANOMALY_DENSITY_TAG &&
      system.spatialAnomalies.every(
        (a) => a?.status === 'hidden' && !a.fullyScanned && (a.scanProgress ?? 0) <= 0
      )
    if (
      fullWorld &&
      ((system.spatialAnomalies.length === 0 && system.anomalySeaMigrated !== ANOMALY_SEA_MIGRATE_TAG) || untouchedOldLayout)
    ) {
      // An untouched legacy set has no player progress to preserve. Remove its
      // synthetic ore fields too, then re-roll under the denser sea layout.
      if (untouchedOldLayout && system.bodies?.some((b) => b.anomalySiteId)) {
        system.bodies = system.bodies.filter((b) => !b.anomalySiteId)
      }
      delete system.spatialAnomalies
      delete system.anomalyEpoch
      // Fall through to roll below.
    } else {
      migrateCrowdedHiddenAnomalies(system, epoch)
      return system.spatialAnomalies
    }
  }

  const rng = systemRng(system.id, epoch)
  const sec = Math.max(0, Math.min(6, Math.floor(system.securityRating ?? 2)))
  // One-sea world always needs signals to find. Sparse test fixtures (no
  // bodies) keep the old 20% presence so unit tests still sample empties.
  const fullWorld = (system.bodies?.length ?? 0) >= 20
  if (!fullWorld && rng() >= 0.2) {
    system.spatialAnomalies = []
    system.anomalyEpoch = epoch
    system.anomalyOpenSpaceMigrated = epoch
    system.anomalySeaMigrated = ANOMALY_SEA_MIGRATE_TAG
    return system.spatialAnomalies
  }

  // Lower security rating → more sites. The sea is large enough to support a
  // proper spread of sites; the scan UI deliberately shows only the local 10km.
  const lowSecurityBias = 1 - sec / 6
  let count = fullWorld ? 6 : 1
  if (rng() < 0.45 + lowSecurityBias * 0.4) count = fullWorld ? 8 : 2
  if (rng() < 0.24 + lowSecurityBias * 0.38) count = fullWorld ? 10 : 3
  if (rng() < 0.08 + lowSecurityBias * 0.28) count = fullWorld ? 12 : 4
  count = Math.min(fullWorld ? 12 : 4, Math.max(fullWorld ? 6 : 1, count))

  const anomalies = []
  const occupied = []
  for (let i = 0; i < count; i++) {
    const typeRoll = rng()
    const type =
      typeRoll < 0.35
        ? 'alien_incursion'
        : typeRoll < 0.6
          ? 'datacore'
          : typeRoll < 0.75
            ? 'datacore_takeover'
            : typeRoll < 0.85
              ? 'alien_datacore'
              : 'ore_anomaly'
    const id = `anomaly-${system.id}-e${epoch}-${i}`
    const position = randomAnomalyPosition(rng, system, occupied)
    occupied.push(position)
    const anomaly = {
      id,
      systemId: system.id,
      type,
      position,
      // scan: 0..1 how identified; fullyScanned when scanProgress complete
      signal: 0,
      scanProgress: 0,
      fullyScanned: false,
      displayName: 'Anomalous Signal',
      status: 'hidden', // hidden | scanned | active | completed | despawning
      despawnAt: null,
      epoch
    }
    if (type === 'alien_incursion') {
      anomaly.wavesTotal = 3
      anomaly.waveIndex = 0
      anomaly.waveCleared = 0
      anomaly.baseDestroyed = false
      anomaly.creditsReward = Math.round(
        ALIEN_BASE_CREDITS_BASE * (1 + (6 - sec) * 0.22)
      )
    } else if (isDatacoreType(type)) {
      let nodules
      if (type === 'datacore') {
        // At least 2; lower security always more.
        if (sec <= 2) nodules = 3 + (rng() < 0.5 ? 1 : 0)
        else if (sec <= 4) nodules = 2 + (rng() < 0.55 ? 1 : 0)
        else nodules = 2
      } else {
        // Takeover variants: 3–8 datacores, each guarded by 2 pirates/aliens.
        nodules = 3 + intRange(rng, 0, 5) // 3–8
        anomaly.guardFaction = type === 'alien_datacore' ? 'alien' : 'pirate'
      }
      anomaly.nodules = []
      for (let n = 0; n < nodules; n++) {
        const ang = (n / nodules) * Math.PI * 2 + rng() * 0.4
        // Spread around the central relic so the cluster is obvious in free flight.
        const d = 280 + rng() * 420
        anomaly.nodules.push({
          id: `${id}-nodule-${n}`,
          position: [
            position[0] + Math.cos(ang) * d,
            0,
            position[2] + Math.sin(ang) * d
          ],
          status: 'sealed', // sealed | open | destroyed
          looted: false
        })
      }
    } else {
      // ore_anomaly: 6–15 asteroids of one ore tier rarer than the system's
      // normal yield, sitting in a real asteroidField body so mining reuses
      // the existing shoot-to-mine pipeline untouched (see combat.js).
      const rockCount = 6 + intRange(rng, 0, 9) // 6–15
      anomaly.ambush = rng() < 0.5
      const fieldId = `${id}-orefield`
      anomaly.oreFieldId = fieldId
      system.bodies ??= []
      system.bodies.push({
        id: fieldId,
        name: 'Rare Ore Deposit',
        kind: 'wreckField',
        position: [...position],
        radius: ORE_ANOMALY_FIELD_RADIUS,
        economyTags: [],
        hasMissions: false,
        hasShipyard: false,
        hasShipParts: false,
        oreOverride: rareOreTierForSystem(system),
        rockCount,
        anomalySiteId: id
      })
    }
    anomalies.push(anomaly)
  }
  system.spatialAnomalies = anomalies
  system.anomalyEpoch = epoch
  system.anomalyOpenSpaceMigrated = epoch
  system.anomalySeaMigrated = ANOMALY_SEA_MIGRATE_TAG
  system.anomalyDensityTag = ANOMALY_DENSITY_TAG
  return anomalies
}

export function getSystemAnomalies(system, epochOrGalaxy = 0) {
  return ensureSystemAnomalies(system, epochOrGalaxy)
}

export function getAnomaly(system, anomalyId, epochOrGalaxy = 0) {
  return getSystemAnomalies(system, epochOrGalaxy).find((a) => a.id === anomalyId) ?? null
}

/** Fully scanned sites still listed on overview (not despawned). */
export function overviewAnomalies(system, epochOrGalaxy = 0) {
  return getSystemAnomalies(system, epochOrGalaxy).filter(
    (a) => a.fullyScanned && a.status !== 'completed' && a.status !== 'despawning'
  )
}

/**
 * Explorer role: faster lock + slightly better signal quality.
 * @returns {{ scanSpeed: number, signalBonus: number }}
 */
export function systemScanBonuses(shipClass) {
  if (shipClass?.role === 'explorer') {
    return { scanSpeed: 1.45, signalBonus: 0.12 }
  }
  return { scanSpeed: 1, signalBonus: 0 }
}

/**
 * Ideal probe standoff for a given signal read (0..1).
 * Fresh / unknown ≈ 3.25 km; fully known ≈ 1.7 km. Region Sonar map rings
 * and deploy hints must use this — same formula as computeProbeSignal.
 */
export function idealProbeScanRadius(signalKnown = 0) {
  const known = Math.max(0, Math.min(1, signalKnown ?? 0))
  return 2800 * (1 - known * 0.55) + 450
}

/** Soft falloff ends at this multiple of idealProbeScanRadius (no contribution beyond). */
export const PROBE_SIGNAL_RANGE_MUL = 2.4

/**
 * Signal strength at an anomaly given probe world positions.
 * Probes closer + clustered around the signal raise strength.
 */
export function computeProbeSignal(anomaly, probePositions, shipClass = null) {
  if (!anomaly || !probePositions?.length) return 0
  const bonus = systemScanBonuses(shipClass).signalBonus
  const ax = anomaly.position[0]
  const az = anomaly.position[2]

  // Ideal scan radius shrinks as signal is better known (close-in).
  // Horizontal only: anomalies and probes sit on the sea surface.
  const idealR = idealProbeScanRadius(anomaly.signal ?? 0)

  let score = 0
  let inRange = 0
  const dists = []
  for (const p of probePositions) {
    if (!p?.active) continue
    const d = Math.hypot(p.position[0] - ax, p.position[2] - az)
    dists.push(d)
    // Soft falloff: full contribution inside idealR, zero past PROBE_SIGNAL_RANGE_MUL×
    const t = d / idealR
    if (t < PROBE_SIGNAL_RANGE_MUL) {
      inRange++
      score += Math.max(0, 1 - t / PROBE_SIGNAL_RANGE_MUL)
    }
  }
  if (!inRange) return 0

  // Formation quality: variance of distances (tighter sphere = better when close)
  let form = 1
  if (dists.length >= 2) {
    const mean = dists.reduce((a, b) => a + b, 0) / dists.length
    const variance =
      dists.reduce((s, d) => s + (d - mean) * (d - mean), 0) / dists.length
    const cv = mean > 1 ? Math.sqrt(variance) / mean : 1
    form = Math.max(0.35, 1 - cv * 0.85)
  }

  const coverage = Math.min(1, inRange / SYSTEM_SCAN_PROBE_COUNT)
  let signal = (score / SYSTEM_SCAN_PROBE_COUNT) * 0.55 + coverage * 0.25 + form * 0.2
  signal = Math.min(1, signal + bonus)
  return Math.max(0, Math.min(1, signal))
}

/**
 * Advance scan lock on anomalies. Call each frame while probes are deployed.
 * @returns {{ fullyScanned: object[] }} newly completed scans this tick
 */
export function updateSystemScan(system, probePositions, shipClass, dt) {
  const fullyScanned = []
  if (!system || !dt) return { fullyScanned }
  const anomalies = getSystemAnomalies(system)
  const speed = systemScanBonuses(shipClass).scanSpeed
  const lockNeed = BASE_SCAN_LOCK_S / speed

  for (const a of anomalies) {
    if (a.fullyScanned || a.status === 'completed' || a.status === 'despawning') continue
    const sig = computeProbeSignal(a, probePositions, shipClass)
    // Smooth signal readout (what player sees on map)
    a.signal = a.signal * 0.85 + sig * 0.15
    // Only accumulate lock when signal is decent
    if (sig >= 0.22) {
      const rate = ((sig - 0.15) / 0.85) ** 1.1
      a.scanProgress = Math.min(1, (a.scanProgress ?? 0) + (dt * rate) / lockNeed)
    } else {
      // Weak signal decays slowly so you must hold formation
      a.scanProgress = Math.max(0, (a.scanProgress ?? 0) - dt * 0.04)
    }
    if ((a.scanProgress ?? 0) >= 1) {
      a.fullyScanned = true
      a.signal = 1
      a.scanProgress = 1
      a.status = 'scanned'
      a.displayName = ANOMALY_DISPLAY_NAMES[a.type] ?? 'Anomalous Signal'
      fullyScanned.push(a)
    }
  }
  return { fullyScanned }
}

/**
 * Standard + optional valuable cargo bundle for site loot.
 * Tiny chance of blueprint / skillbook (datacore minigame + alien base wreck).
 * @param {() => number} rng
 * @param {{
 *   valuableChance?: number,
 *   gameState?: object|null,
 *   alien?: boolean
 * }} [opts]
 */
export function rollSiteLoot(
  rng,
  { valuableChance = VALUABLE_LOOT_CHANCE, gameState = null, alien = false } = {}
) {
  const cargo = {}
  const good = pick(rng, TRADE_GOODS)
  cargo[good.id] = 2 + intRange(rng, 0, 4)
  // Extra filler stack
  if (rng() < 0.55) {
    const g2 = pick(rng, TRADE_GOODS)
    cargo[g2.id] = (cargo[g2.id] ?? 0) + 1 + intRange(rng, 0, 2)
  }
  if (rng() < valuableChance && VALUABLE_GOOD_IDS.length) {
    const v = pick(rng, VALUABLE_GOOD_IDS)
    // Prefer known good id; fall back to trade goods if ids missing from catalog
    const exists = GOODS.some((g) => g.id === v)
    if (exists) cargo[v] = (cargo[v] ?? 0) + 1 + intRange(rng, 0, 1)
    else {
      const g3 = pick(rng, TRADE_GOODS)
      cargo[g3.id] = (cargo[g3.id] ?? 0) + 3
    }
  }
  const loot = { cargo }
  if (rng() < 0.2) loot.shipParts = 1

  // Independent ultra-rare rolls (similar rarity band to wreck salvage, slightly lower).
  const blueprintId = alien
    ? tryRollAlienBlueprintDrop(rng, SITE_BLUEPRINT_CHANCE)
    : tryRollBlueprintDrop(rng, SITE_BLUEPRINT_CHANCE)
  if (blueprintId) loot.blueprints = { [blueprintId]: 1 }

  if (gameState) {
    const skillId = tryRollSkillbookDrop(rng, gameState, SITE_SKILLBOOK_CHANCE)
    if (skillId) {
      loot.skillbooks = { [skillId]: 1 }
      try {
        loot.skillbookName = getSkillDef(skillId).bookName
      } catch {
        loot.skillbookName = 'Skillbook'
      }
    }
  }

  return loot
}

/**
 * Datacore minigame: simple timing lock (0–1 success window).
 * Player must stop a moving cursor inside the green zone.
 * @returns {{ success: boolean }}
 */
export function resolveDatacoreHack(stopPosition, windowCenter = 0.5, windowHalf = 0.12) {
  const d = Math.abs(stopPosition - windowCenter)
  return { success: d <= windowHalf }
}

export function markAnomalyCompleted(anomaly, simTime) {
  if (!anomaly) return
  anomaly.status = 'completed'
  anomaly.despawnAt = (simTime ?? 0) + 1
}

export function markAlienBaseDestroyed(anomaly, simTime) {
  if (!anomaly) return
  anomaly.baseDestroyed = true
  anomaly.status = 'despawning'
  anomaly.despawnAt = (simTime ?? 0) + ALIEN_SITE_DESPAWN_S
}

/** Remove completed/despawned sites past their timer. */
export function pruneAnomalies(system, simTime) {
  if (!system?.spatialAnomalies) return
  system.spatialAnomalies = system.spatialAnomalies.filter((a) => {
    if (a.status === 'completed' && a.despawnAt != null && simTime >= a.despawnAt) return false
    if (a.status === 'despawning' && a.despawnAt != null && simTime >= a.despawnAt) return false
    return true
  })
}

export function allDatacoreNodulesDone(anomaly) {
  if (!anomaly?.nodules?.length) return true
  return anomaly.nodules.every((n) => n.status === 'open' || n.status === 'destroyed')
}
