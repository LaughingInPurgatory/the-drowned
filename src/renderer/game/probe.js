import { SURVEY_DATA_GOOD_ID, MINED_ORE_GOOD_IDS, getGood } from '../data/goods.js'
import {
  PROBE_BLUEPRINT_DROP_CHANCE,
  tryRollBlueprintDrop,
  grantShipBlueprint
} from './crafting.js'
import { getBlueprint } from '../data/blueprints.js'
import { mulberry32, pick } from '../procgen/prng.js'
import { oreTierForField } from './mining.js'
import { tryRollProbeSkillbook, getSkillDef, playerSkillBonuses } from './skills.js'

/** Chance a sounding turns up saleable survey data. */
export const PROBE_FIND_CHANCE = 0.08
/** Explorer hulls: +5 percentage points to survey-data finds when sounding. */
export const EXPLORER_PROBE_LOOT_BONUS = 0.05
export const MAX_PROBE_ATTEMPTS = 3

/** Effective survey-data find chance for this ship class (+ Sonar Specialist skill). */
export function probeFindChance(shipClass, gameState = null) {
  let p = PROBE_FIND_CHANCE
  if (shipClass?.role === 'explorer') p += EXPLORER_PROBE_LOOT_BONUS
  if (gameState) {
    try {
      p += playerSkillBonuses(gameState).probeLoot
    } catch {
      /* */
    }
  }
  return Math.min(1, Math.max(0, p))
}

/** Effective blueprint drop chance (explorers + Sonar Specialist). */
export function probeBlueprintChance(shipClass, gameState = null) {
  let p = PROBE_BLUEPRINT_DROP_CHANCE
  if (shipClass?.role === 'explorer') p *= 1 + EXPLORER_PROBE_LOOT_BONUS
  if (gameState) {
    try {
      p += playerSkillBonuses(gameState).probeLoot
    } catch {
      /* */
    }
  }
  return Math.min(1, Math.max(0, p))
}
/** Shown once the water around a place has given up everything it holds. */
export function probeExhaustedMessage(bodyName) {
  const name = bodyName?.trim() || 'This water'
  return `${name} fully sounded.`
}

/** @deprecated Prefer probeExhaustedMessage(name) — kept for tests / imports. */
export const PROBE_EXHAUSTED_MESSAGE = 'Fully sounded.'
export { SURVEY_DATA_GOOD_ID }

// Must match render/islandMesh.js ISLAND_ARCHETYPES key order (Object.keys).
const ISLAND_ARCHETYPE_NAMES = ['barren', 'scrub', 'drowned', 'industrial', 'volcanic']

const ARCHETYPE_LABEL = {
  barren: 'Bare rock',
  scrub: 'Scrub and hardwood',
  drowned: 'Drowned settlement',
  industrial: 'Pre-war industrial',
  volcanic: 'Volcanic'
}

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Same seeded archetype the island mesh uses, so the report matches the view. */
export function planetArchetypeForBody(body) {
  if (body?.kind !== 'island') return null
  const rng = mulberry32(hashString(body.id))
  return pick(rng, ISLAND_ARCHETYPE_NAMES)
}

/**
 * Always-on classification lines for a successful sounding — deterministic from
 * body.id so repeat surveys (and the mesh you can see) agree.
 * @returns {string[]}
 */
export function probeSurveyReport(body, system) {
  if (!body) return []
  const lines = [`Survey: ${body.name}`]

  if (body.kind === 'wreckField') {
    const primaryId = body.oreOverride ?? oreTierForField(body)
    const primary = getGood(primaryId).name
    const idx = MINED_ORE_GOOD_IDS.indexOf(primaryId)
    const secondary =
      idx > 0
        ? getGood(MINED_ORE_GOOD_IDS[idx - 1]).name
        : idx < MINED_ORE_GOOD_IDS.length - 1
          ? getGood(MINED_ORE_GOOD_IDS[idx + 1]).name
          : null
    lines.push('Site type: Sunken hulls — a convoy or harbour that went down whole')
    lines.push('Water: Shallow enough to work; hulks break the surface at low swell')
    lines.push('Hazards: Shifting plate, snagged cable, no shelter in weather')
    lines.push(`Primary salvage: ${primary}`)
    if (secondary) lines.push(`Also present, in smaller quantity: ${secondary}`)
    lines.push('Method: Cut the hulks open with deck guns, then scoop what floats up.')
    return lines
  }

  if (body.kind === 'island') {
    const arch = planetArchetypeForBody(body)
    // Extra flavour rolls on a separate stream so they cannot desync the mesh.
    const flavor = mulberry32(hashString(`${body.id}:probe-survey`))
    lines.push(`Land type: ${ARCHETYPE_LABEL[arch] ?? arch}`)

    if (arch === 'drowned') {
      lines.push('Surface: Rooftops and upper storeys above the waterline; streets below')
      lines.push('Structures: Substantially intact — much of it never burned, only flooded')
      lines.push(
        flavor() < 0.4
          ? 'Occupants: Signs of recent habitation — smoke, cleared channels'
          : 'Occupants: Abandoned; no fires, no cleared moorings'
      )
      lines.push('Salvage: Household and light industrial, mostly below the waterline')
    } else if (arch === 'industrial') {
      lines.push('Surface: Concrete aprons, collapsed sheds, standing gantry')
      lines.push('Structures: Heavy plant, seized and stripped of anything portable')
      lines.push(
        flavor() < 0.3
          ? 'Contamination: Elevated — do not take on water here'
          : 'Contamination: Within tolerance for a short stay'
      )
      lines.push('Salvage: Structural steel, machine parts, cable runs')
    } else if (arch === 'volcanic') {
      lines.push('Surface: Fresh basalt and ash; the sea steams along the south shore')
      lines.push('Vegetation: None established')
      lines.push('Hazards: Unstable ground, sudden squalls off the thermal column')
      lines.push('Note: New land. Nothing pre-war here to recover.')
    } else if (arch === 'scrub') {
      lines.push('Surface: Thin soil over rock; wind-shaped hardwood and salt scrub')
      lines.push(
        flavor() < 0.55
          ? 'Fresh water: Standing catchment on the high ground'
          : 'Fresh water: None found'
      )
      lines.push(
        flavor() < 0.35
          ? 'Fauna: Seabird colony; the eggs are edible'
          : 'Fauna: Nothing larger than insects'
      )
      lines.push('Salvage: Negligible. This was never built on.')
    } else {
      lines.push('Surface: Bare rock, scoured clean by weather and swell')
      lines.push('Vegetation: None')
      lines.push('Fresh water: None')
      lines.push('Salvage: Negligible. Useful chiefly as a mark to steer by.')
    }

    const anchorage = flavor()
    lines.push(
      anchorage < 0.3
        ? 'Anchorage: Good holding in the lee; safe in most weather'
        : anchorage < 0.7
          ? 'Anchorage: Passable in settled conditions; exposed to the swell'
          : 'Anchorage: Poor. Foul ground and a lee shore.'
    )
    return lines
  }

  if (body.kind === 'port' || body.kind === 'outpost') {
    lines.push(body.kind === 'port' ? 'Site type: Working harbour' : 'Site type: Outpost')
    lines.push('Nothing to survey here — go ashore and ask instead.')
    return lines
  }

  return lines
}

export function probeAttemptCount(gameState, bodyId) {
  if (!bodyId) return 0
  return gameState.probeCounts?.[bodyId] ?? 0
}

// True when this body is the open objective of an active probe/investigation mission
// (those always resolve their mission outcome on the first successful probe).
export function isActiveMissionProbeTarget(gameState, bodyId) {
  if (!bodyId || !gameState?.missions?.active) return false
  const id = String(bodyId)
  return gameState.missions.active.some(
    (m) =>
      !m.objectiveComplete &&
      ((m.type === 'probe' && String(m.target?.bodyId) === id) ||
        (m.type === 'investigation' &&
          m.target?.kind === 'body' &&
          String(m.target?.bodyId) === id))
  )
}

/**
 * Fully scanned bodies normally block further probes. Exception: one mission
 * re-probe is allowed while an open probe/investigation targets this body.
 * That re-probe does not change probeCounts and yields no loot (main.js).
 */
export function isMissionOnlyReprobe(gameState, bodyId) {
  if (!bodyId) return false
  return (
    probeAttemptCount(gameState, bodyId) >= MAX_PROBE_ATTEMPTS &&
    isActiveMissionProbeTarget(gameState, bodyId)
  )
}

export function canProbeBody(gameState, bodyId) {
  if (!bodyId) return false
  if (probeAttemptCount(gameState, bodyId) < MAX_PROBE_ATTEMPTS) return true
  // Exhausted count, but an active contract still needs a survey of this body.
  return isActiveMissionProbeTarget(gameState, bodyId)
}

// Call once per launch (not per return) so aborted probes still consume a slot.
// When already at MAX, leave the count unchanged (mission re-probe path).
export function recordProbeAttempt(gameState, bodyId) {
  if (!bodyId) return 0
  if (!gameState.probeCounts || typeof gameState.probeCounts !== 'object') {
    gameState.probeCounts = {}
  }
  const key = String(bodyId)
  const cur = gameState.probeCounts[key] ?? 0
  if (cur >= MAX_PROBE_ATTEMPTS) return cur
  gameState.probeCounts[key] = cur + 1
  return gameState.probeCounts[key]
}

// A find still respects cargo capacity like any other good, so a full hold
// can miss out on a discovery rather than silently exceeding capacity.
// forceFind: used so a mission-target first probe always yields its result path
// (caller still handles mission logic separately; this only affects survey data).
// noLoot: mission re-probe on a fully scanned body — complete the contract only.
export function launchProbe(gameState, shipClass, rng, { forceFind = false, noLoot = false } = {}) {
  if (noLoot) {
    return { found: false, stored: false, blueprint: null, skillbook: null }
  }

  // Independent ultra-rare blueprint find (does not require survey-data roll).
  // Explorer role + Sonar Specialist skill raise odds.
  const blueprintId = tryRollBlueprintDrop(rng, probeBlueprintChance(shipClass, gameState))
  let blueprint = null
  if (blueprintId) {
    grantShipBlueprint(gameState, blueprintId)
    try {
      blueprint = getBlueprint(blueprintId)
    } catch {
      blueprint = { name: 'Unknown Blueprint' }
    }
  }

  // Independent skillbook roll (0.05%); maxed skills excluded from pool.
  let skillbook = null
  const skillId = tryRollProbeSkillbook(rng, gameState)
  if (skillId) {
    const ship = gameState.player.ship
    ship.skillbooks ??= {}
    ship.skillbooks[skillId] = (ship.skillbooks[skillId] ?? 0) + 1
    try {
      skillbook = { skillId, name: getSkillDef(skillId).bookName }
    } catch {
      skillbook = { skillId, name: 'Skillbook' }
    }
  }

  if (!forceFind && rng() >= probeFindChance(shipClass, gameState)) {
    return { found: false, stored: false, blueprint, skillbook }
  }

  const cargo = gameState.player.ship.cargo
  const used = Object.values(cargo).reduce((a, b) => a + b, 0)
  if (used >= shipClass.stats.cargoCapacity) {
    return { found: true, stored: false, blueprint, skillbook }
  }

  // Survey data is ordinary cargo — drag to station storage on Storage tab to sell.
  cargo[SURVEY_DATA_GOOD_ID] = (cargo[SURVEY_DATA_GOOD_ID] ?? 0) + 1
  return { found: true, stored: true, blueprint, skillbook }
}
