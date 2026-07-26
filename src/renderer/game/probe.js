import { SURVEY_DATA_GOOD_ID, MINED_ORE_GOOD_IDS, getGood } from '../data/goods.js'
import {
  PROBE_BLUEPRINT_DROP_CHANCE,
  tryRollBlueprintDrop,
  grantShipBlueprint
} from './crafting.js'
import { getBlueprint } from '../data/blueprints.js'
import { mulberry32, pick } from '../procgen/prng.js'
import { starTypeForSystem } from '../procgen/starType.js'
import { oreTierForSystem } from './mining.js'
import { tryRollProbeSkillbook, getSkillDef, playerSkillBonuses } from './skills.js'

export const PROBE_FIND_CHANCE = 0.08
/** Explorer hulls: +5 percentage points to survey-data finds when probing. */
export const EXPLORER_PROBE_LOOT_BONUS = 0.05
export const MAX_PROBE_ATTEMPTS = 3

/** Effective survey-data find chance for this ship class (+ Probe Expert skill). */
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

/** Effective blueprint drop chance (explorers + Probe Expert). */
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
/** Shown after the last allowed probe attempt on a body. */
export function probeExhaustedMessage(bodyName) {
  const name = bodyName?.trim() || 'Target'
  return `${name} fully scanned.`
}

/** @deprecated Prefer probeExhaustedMessage(name) — kept for tests / imports. */
export const PROBE_EXHAUSTED_MESSAGE = 'Target fully scanned.'
export { SURVEY_DATA_GOOD_ID }

// Must match render/planetMesh.js PLANET_ARCHETYPES key order (Object.keys).
const PLANET_ARCHETYPE_NAMES = ['rocky', 'gasGiant', 'ice', 'lush', 'volcanic']

const ARCHETYPE_LABEL = {
  rocky: 'Rocky world',
  gasGiant: 'Gas giant',
  ice: 'Ice world',
  lush: 'Lush / terrestrial',
  volcanic: 'Volcanic world'
}

const STAR_TYPE_LABEL = {
  mainSequence: 'Main-sequence star (yellow–white, G/K class)',
  redDwarf: 'Red dwarf (M-class)',
  whiteDwarf: 'White dwarf (compact remnant)',
  giant: 'Giant / evolved star',
  binary: 'Binary star system',
  trinary: 'Trinary star system'
}

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Same seeded archetype as buildPlanetMesh (planets only; moons are always rocky). */
export function planetArchetypeForBody(body) {
  if (!body) return null
  if (body.kind === 'moon') return 'rocky'
  if (body.kind !== 'planet') return null
  const rng = mulberry32(hashString(body.id))
  return pick(rng, PLANET_ARCHETYPE_NAMES)
}

/**
 * Always-on classification lines for a successful probe return — deterministic
 * from body.id / system id so re-probes (and mesh visuals) agree.
 * @returns {string[]}
 */
export function probeSurveyReport(body, system) {
  if (!body) return []
  const lines = [`Classification: ${body.name}`]

  if (body.kind === 'star') {
    const type = starTypeForSystem(system ?? { id: body.id })
    lines.push(`Body type: Star — ${STAR_TYPE_LABEL[type] ?? type}`)
    if (type === 'binary' || type === 'trinary') {
      lines.push('Multiple luminous components detected; strong radiation field.')
    } else if (type === 'redDwarf') {
      lines.push('Long-lived, cool photosphere; flare activity possible.')
    } else if (type === 'whiteDwarf') {
      lines.push('Extremely dense remnant; thin residual atmosphere of stripped metals/helium.')
    } else if (type === 'giant') {
      lines.push('Expanded envelope; high luminosity, short remaining main lifetime.')
    } else {
      lines.push('Stable fusion core; broad habitable-zone potential for bound worlds.')
    }
    lines.push('Surface: N/A (plasma photosphere). Atmosphere: stellar wind / corona only.')
    lines.push('Biosignatures: none (host star).')
    return lines
  }

  if (body.kind === 'asteroidField') {
    lines.push('Body type: Asteroid field / planetesimal belt')
    lines.push('Atmosphere: None (vacuum between rocks)')
    lines.push('Surface: Fractured rock and regolith; no hydrosphere')
    lines.push('Life / flora / fauna: None detected')
    if (system) {
      const primaryId = oreTierForSystem(system)
      const primary = getGood(primaryId).name
      const idx = MINED_ORE_GOOD_IDS.indexOf(primaryId)
      const secondary =
        idx > 0
          ? getGood(MINED_ORE_GOOD_IDS[idx - 1]).name
          : idx < MINED_ORE_GOOD_IDS.length - 1
            ? getGood(MINED_ORE_GOOD_IDS[idx + 1]).name
            : null
      lines.push(`Ore survey: Dominant yield — ${primary}`)
      if (secondary) lines.push(`Ore survey: Trace / secondary — ${secondary}`)
      lines.push('Ore survey: Fire weapons at individual rocks to mine (ore hold).')
    } else {
      lines.push('Ore survey: Composition unknown (no system context).')
    }
    return lines
  }

  if (body.kind === 'planet' || body.kind === 'moon') {
    const isMoon = body.kind === 'moon'
    const arch = planetArchetypeForBody(body)
    // Extra flavor rolls — only after archetype pick so they don't desync mesh rng.
    // Mesh continues consuming rng for ring/tilt/spin; we use a separate stream.
    const flavor = mulberry32(hashString(`${body.id}:probe-survey`))

    lines.push(
      isMoon
        ? `Body type: Moon — barren cratered rock (rocky)`
        : `Body type: Planet — ${ARCHETYPE_LABEL[arch] ?? arch}`
    )

    if (!isMoon && arch === 'gasGiant') {
      // Match mesh: all gas giants have cloudy decks; ~38% stormy.
      const stormy = flavor() < 0.38
      lines.push(
        stormy
          ? 'Atmosphere: Stormy hydrogen–helium envelope — violent cloud decks, oval storms'
          : 'Atmosphere: Thick cloudy hydrogen–helium envelope with layered cloud bands'
      )
      lines.push('Surface: No solid crust (fluid/metallic interior)')
      const aerial = flavor() < 0.12
      lines.push(
        aerial
          ? 'Life: Possible aerial microfauna in upper cloud decks (unconfirmed)'
          : 'Life: No confirmed biosignatures'
      )
      lines.push('Flora / fauna: None on a solid surface')
    } else if (!isMoon && arch === 'lush') {
      lines.push('Atmosphere: Dense N₂–O₂ mix; greenhouse stable')
      lines.push('Surface: Continents, oceans or wetlands; weathered crust')
      lines.push('Life: Supports complex biosphere')
      const flora = pick(flavor, [
        'Dense forests and algal mats',
        'Widespread grasslands and moss fields',
        'Jungle canopy with fungal understory',
        'Blooming coastal wetlands'
      ])
      const fauna = pick(flavor, [
        'Diverse fauna (aerial + surface)',
        'Large grazing herds and predators',
        'Amphibious coastal fauna',
        'Insectoid swarms and small vertebrates'
      ])
      lines.push(`Flora: ${flora}`)
      lines.push(`Fauna: ${fauna}`)
    } else if (!isMoon && arch === 'ice') {
      lines.push('Atmosphere: Thin CO₂ / N₂ or near-vacuum; cryovolcanic traces')
      lines.push('Surface: Ice crust over rock; possible subsurface ocean')
      const life = flavor() < 0.18
      lines.push(life ? 'Life: Possible chemosynthetic microbes under ice' : 'Life: No confirmed biosignatures')
      lines.push('Flora / fauna: None on the exposed surface')
    } else if (!isMoon && arch === 'volcanic') {
      lines.push('Atmosphere: Thick SO₂ / CO₂ toxic haze; ash layers')
      lines.push('Surface: Lava plains, calderas, active vents')
      lines.push('Life: Hostile — no complex life; extremophile microbes unlikely at surface')
      lines.push('Flora / fauna: None detected')
    } else {
      // rocky planet or moon
      const atmoRoll = flavor()
      if (isMoon) {
        lines.push(
          atmoRoll < 0.15
            ? 'Atmosphere: Trace exosphere only'
            : 'Atmosphere: None (vacuum)'
        )
        lines.push('Surface: Cratered regolith; no open water')
        lines.push('Life: None detected')
        lines.push('Flora / fauna: None')
        if (flavor() < 0.55) lines.push('Tidal: Likely tidally influenced by parent world')
      } else {
        if (atmoRoll < 0.25) lines.push('Atmosphere: Thin CO₂ / N₂')
        else if (atmoRoll < 0.55) lines.push('Atmosphere: Trace only')
        else lines.push('Atmosphere: None / negligible')
        lines.push('Surface: Rocky crust, impact basins, limited volatiles')
        const life = flavor() < 0.08
        lines.push(life ? 'Life: Marginal — possible microbial niches' : 'Life: No confirmed biosignatures')
        lines.push('Flora / fauna: None at scale')
      }
    }

    // Rings: match ~3% of planets in buildPlanetMesh (separate cosmetic stream there;
    // report from the same body seed family for a stable answer).
    if (!isMoon) {
      const ringRng = mulberry32(hashString(body.id))
      pick(ringRng, PLANET_ARCHETYPE_NAMES) // consume archetype draw
      if (ringRng() < 0.03) lines.push('Rings: Dust/ice ring system present')
    }

    return lines
  }

  lines.push(`Body type: ${body.kind}`)
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
  // Explorer role + Probe Expert skill raise odds.
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
