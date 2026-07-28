/**
 * Region Sonar Scan / Spatial Anomalies — drone scan of nearby hidden sites.
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

export const SYSTEM_SCAN_PROBE_COUNT = 4
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
  alien_incursion: 'Alien Incursion',
  datacore: 'Datacore Relic',
  datacore_takeover: 'Datacore Takeover',
  alien_datacore: 'Alien Datacore',
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
  // v3: open-space placement (clear of planets / moons / stations / star).
  return mulberry32(hashString(`anomaly-v3:${systemId}:e${epoch}`))
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
    // ore_anomaly sites own a synthetic asteroidField body registered into
    // system.bodies (see ensureSystemAnomalies) — those don't live in
    // spatialAnomalies, so they need their own sweep on reshuffle.
    if (system.bodies?.some((b) => b.anomalySiteId)) {
      system.bodies = system.bodies.filter((b) => !b.anomalySiteId)
    }
  }
  return { refreshed: true, epoch }
}

// Keep sites in open volume — not hugging the star or a planet/moon/station.
// (System orbits typically sit ~100k–340k from the primary.)
const ANOMALY_MIN_STAR_DIST = 75000
const ANOMALY_MIN_BODY_PAD = 22000
const ANOMALY_MIN_SITE_SEP = 18000
const ANOMALY_PLACE_ATTEMPTS = 56

function bodyClearanceRadius(body) {
  if (!body) return 0
  // Prefer explicit radius; stations/settlements may be small on body.radius.
  const r = Number(body.radius)
  if (Number.isFinite(r) && r > 0) return r
  if (body.kind === 'port') return 3400
  if (body.kind === 'outpost') return 200
  if (body.kind === 'warpGate') return 140
  return 500
}

/**
 * True when `pos` sits in open system space: well clear of the star and every
 * planet / moon / station / belt / gate shell.
 */
export function isAnomalyOpenSpace(pos, system, { extraPositions = [], minBodyPad = ANOMALY_MIN_BODY_PAD } = {}) {
  if (!pos || pos.length < 3) return false
  const starDist = Math.hypot(pos[0], pos[1], pos[2])
  if (starDist < ANOMALY_MIN_STAR_DIST) return false
  for (const body of system?.bodies ?? []) {
    if (!body?.position) continue
    const need = bodyClearanceRadius(body) + minBodyPad
    const d = Math.hypot(
      pos[0] - body.position[0],
      pos[1] - body.position[1],
      pos[2] - body.position[2]
    )
    if (d < need) return false
  }
  for (const other of extraPositions) {
    if (!other || other === pos) continue
    const d = Math.hypot(pos[0] - other[0], pos[1] - other[1], pos[2] - other[2])
    if (d < ANOMALY_MIN_SITE_SEP) return false
  }
  return true
}

/**
 * Local position in open system volume — not near planets/moons/stations/sun.
 * Uses body layout when available so sites can sit between orbits or beyond
 * the outer system, not only on the planetary ring.
 */
function randomAnomalyPosition(rng, system = null, occupied = []) {
  const bodies = system?.bodies ?? []
  let maxBodyR = 140000
  for (const b of bodies) {
    if (!b?.position) continue
    const r = Math.hypot(b.position[0], b.position[1], b.position[2])
    if (r > maxBodyR) maxBodyR = r
  }
  // Open volume from outside the star exclusion out past the outermost body.
  const rMin = ANOMALY_MIN_STAR_DIST + 15000
  const rMax = Math.max(rMin + 80000, maxBodyR * 1.45)

  for (let attempt = 0; attempt < ANOMALY_PLACE_ATTEMPTS; attempt++) {
    // Mix mid-system (gaps between orbits) and deep outer volume.
    const outerBias = attempt > ANOMALY_PLACE_ATTEMPTS * 0.45
    const r = outerBias
      ? range(rng, Math.max(rMin, maxBodyR * 0.85), rMax)
      : range(rng, rMin, rMax)
    const theta = rng() * Math.PI * 2
    // Mostly ecliptic, with occasional high-latitude outliers (deep space).
    const ySpan = outerBias ? maxBodyR * 0.12 : maxBodyR * 0.06
    const y = range(rng, -ySpan, ySpan)
    const pos = [r * Math.cos(theta), y, r * Math.sin(theta)]
    if (isAnomalyOpenSpace(pos, system, { extraPositions: occupied })) return pos
  }

  // Fallback: far beyond outermost body on a random bearing (always open).
  const r = maxBodyR * 1.5 + range(rng, 30000, 90000)
  const theta = rng() * Math.PI * 2
  const y = range(rng, -maxBodyR * 0.1, maxBodyR * 0.1)
  return [r * Math.cos(theta), y, r * Math.sin(theta)]
}

/** Re-place nodule offsets when a datacore site moves. */
function reanchorNodules(anomaly, newPos, rng) {
  if (!anomaly?.nodules?.length) return
  for (let n = 0; n < anomaly.nodules.length; n++) {
    const nodule = anomaly.nodules[n]
    const ang = (n / anomaly.nodules.length) * Math.PI * 2 + rng() * 0.4
    const d = 280 + rng() * 420
    nodule.position = [
      newPos[0] + Math.cos(ang) * d,
      newPos[1] + (rng() - 0.5) * 80,
      newPos[2] + Math.sin(ang) * d
    ]
  }
}

/** True only when sitting inside a planet/moon/station/belt/gate shell + pad. */
function isTooCloseToABody(pos, system, minBodyPad = ANOMALY_MIN_BODY_PAD) {
  for (const body of system?.bodies ?? []) {
    if (!body?.position) continue
    const need = bodyClearanceRadius(body) + minBodyPad
    const d = Math.hypot(
      pos[0] - body.position[0],
      pos[1] - body.position[1],
      pos[2] - body.position[2]
    )
    if (d < need) return true
  }
  return false
}

/**
 * One-time migration: move still-hidden sites that were rolled next to bodies
 * under the old placer into open space (preserves scanned/active progress).
 * Only runs when the system has bodies — pure test fixtures are left alone.
 */
function migrateCrowdedHiddenAnomalies(system, epoch) {
  if (!system?.spatialAnomalies?.length) return
  if (system.anomalyOpenSpaceMigrated === epoch) return
  if (!system.bodies?.length) {
    system.anomalyOpenSpaceMigrated = epoch
    return
  }
  const rng = systemRng(system.id, epoch)
  const occupied = []
  for (const a of system.spatialAnomalies) {
    if (!a?.position) continue
    if (a.fullyScanned || a.status === 'active' || a.status === 'scanned' || a.status === 'completed' || a.status === 'despawning') {
      occupied.push(a.position)
      continue
    }
    // Don't force-move for star-only distance; only sites hugging a real body.
    if (!isTooCloseToABody(a.position, system) && isAnomalyOpenSpace(a.position, system, { extraPositions: occupied })) {
      occupied.push(a.position)
      continue
    }
    if (!isTooCloseToABody(a.position, system)) {
      occupied.push(a.position)
      continue
    }
    const next = randomAnomalyPosition(rng, system, occupied)
    a.position = next
    reanchorNodules(a, next, rng)
    occupied.push(next)
  }
  system.anomalyOpenSpaceMigrated = epoch
}

/**
 * Roll / ensure spatial anomalies for a system (idempotent within an epoch).
 * 20% of systems get 1–4 sites; lower security bias toward more.
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
    // Old saves: nudge still-hidden sites off planets/stations into open space.
    migrateCrowdedHiddenAnomalies(system, epoch)
    return system.spatialAnomalies
  }

  const rng = systemRng(system.id, epoch)
  const sec = Math.max(0, Math.min(6, Math.floor(system.securityRating ?? 2)))
  // 20% base presence
  if (rng() >= 0.2) {
    system.spatialAnomalies = []
    system.anomalyEpoch = epoch
    system.anomalyOpenSpaceMigrated = epoch
    return system.spatialAnomalies
  }

  // Lower security rating → more sites. Sec 0–1: weight high, Sec 5–6: often 1.
  const lowSecurityBias = 1 - sec / 6
  let count = 1
  if (rng() < 0.35 + lowSecurityBias * 0.45) count = 2
  if (rng() < 0.2 + lowSecurityBias * 0.35) count = 3
  if (rng() < 0.08 + lowSecurityBias * 0.25) count = 4
  count = Math.min(4, Math.max(1, count))

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
      displayName: 'Spatial Anomaly',
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
            position[1] + (rng() - 0.5) * 80,
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
 * Signal strength at an anomaly given probe world positions.
 * Probes closer + clustered around the signal raise strength.
 */
export function computeProbeSignal(anomaly, probePositions, shipClass = null) {
  if (!anomaly || !probePositions?.length) return 0
  const bonus = systemScanBonuses(shipClass).signalBonus
  const ax = anomaly.position[0]
  const ay = anomaly.position[1]
  const az = anomaly.position[2]

  // Ideal scan radius shrinks as signal is better known (close-in).
  // Short range on purpose — Region Sonar needs you to steam closer to map more.
  const known = anomaly.signal ?? 0
  const idealR = 2800 * (1 - known * 0.55) + 450

  let score = 0
  let inRange = 0
  const dists = []
  for (const p of probePositions) {
    if (!p?.active) continue
    const d = Math.hypot(p.position[0] - ax, p.position[1] - ay, p.position[2] - az)
    dists.push(d)
    // Soft falloff: full contribution inside idealR, zero past 2.4×
    const t = d / idealR
    if (t < 2.4) {
      inRange++
      score += Math.max(0, 1 - t / 2.4)
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
      a.displayName = ANOMALY_DISPLAY_NAMES[a.type] ?? 'Spatial Anomaly'
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
