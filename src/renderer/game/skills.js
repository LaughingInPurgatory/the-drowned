/**
 * Player skill state + skillbook inventory ops.
 * Skills live on gameState.player.skills; books on ship.skillbooks { skillId: qty }.
 */
import {
  SKILLS,
  MAX_SKILL_LEVEL,
  WRECK_SKILLBOOK_CHANCE,
  ALIEN_WRECK_SKILLBOOK_BONUS,
  PROBE_SKILLBOOK_CHANCE,
  normalizeSkills,
  emptySkills,
  skillLevel,
  isSkillMaxed,
  trainableSkillIds,
  getSkillDef,
  probeLootBonus,
  tradingBuyMult,
  tradingSellMult,
  industryCostMult,
  weaponSkillDamageMult,
  manoeuvringMult,
  thrustSpeedMult,
  thrustCruiseMult,
  droneSkillMult,
  scaleOreCost
} from '../data/skills.js'

export {
  SKILLS,
  MAX_SKILL_LEVEL,
  WRECK_SKILLBOOK_CHANCE,
  ALIEN_WRECK_SKILLBOOK_BONUS,
  PROBE_SKILLBOOK_CHANCE,
  skillLevel,
  isSkillMaxed,
  getSkillDef,
  probeLootBonus,
  tradingBuyMult,
  tradingSellMult,
  industryCostMult,
  weaponSkillDamageMult,
  manoeuvringMult,
  thrustSpeedMult,
  thrustCruiseMult,
  droneSkillMult,
  scaleOreCost
}

export function ensureSkills(gameState) {
  if (!gameState?.player) return emptySkills()
  gameState.player.skills = normalizeSkills(gameState.player.skills)
  const ship = gameState.player.ship
  if (ship) {
    ship.skillbooks ??= {}
  }
  return gameState.player.skills
}

export function getPlayerSkillLevel(gameState, skillId) {
  ensureSkills(gameState)
  return skillLevel(gameState.player.skills, skillId)
}

/** Player flight / combat multipliers for the active pilot. */
export function playerSkillBonuses(gameState) {
  ensureSkills(gameState)
  const s = gameState.player.skills
  return {
    probeLoot: probeLootBonus(skillLevel(s, 'probe_expert')),
    buyMult: tradingBuyMult(skillLevel(s, 'trading')),
    sellMult: tradingSellMult(skillLevel(s, 'trading')),
    industryMult: industryCostMult(skillLevel(s, 'industry')),
    gunneryMult: weaponSkillDamageMult(skillLevel(s, 'gunnery')),
    launchersMult: weaponSkillDamageMult(skillLevel(s, 'launchers')),
    turnMult: manoeuvringMult(skillLevel(s, 'manoeuvring')),
    speedMult: thrustSpeedMult(skillLevel(s, 'thrust')),
    cruiseMult: thrustCruiseMult(skillLevel(s, 'thrust')),
    droneMult: droneSkillMult(skillLevel(s, 'drones'))
  }
}

export function skillbookCount(gameState, skillId) {
  ensureSkills(gameState)
  return Math.max(0, Math.floor(Number(gameState.player.ship?.skillbooks?.[skillId]) || 0))
}

export function addSkillbook(gameState, skillId, qty = 1) {
  ensureSkills(gameState)
  getSkillDef(skillId)
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  if (n < 1) return
  const ship = gameState.player.ship
  ship.skillbooks ??= {}
  ship.skillbooks[skillId] = (ship.skillbooks[skillId] ?? 0) + n
}

/**
 * Consume one skillbook and gain +1 level (if not maxed).
 * @returns {{ ok: boolean, reason?: string, level?: number, name?: string }}
 */
export function useSkillbook(gameState, skillId) {
  ensureSkills(gameState)
  const def = getSkillDef(skillId)
  const ship = gameState.player.ship
  ship.skillbooks ??= {}
  const have = ship.skillbooks[skillId] ?? 0
  if (have < 1) return { ok: false, reason: 'No skillbook of that type on board' }
  const cur = skillLevel(gameState.player.skills, skillId)
  if (cur >= MAX_SKILL_LEVEL) {
    return { ok: false, reason: `${def.name} is already at maximum level` }
  }
  ship.skillbooks[skillId] = have - 1
  if (ship.skillbooks[skillId] <= 0) delete ship.skillbooks[skillId]
  gameState.player.skills[skillId] = cur + 1
  return { ok: true, level: gameState.player.skills[skillId], name: def.name }
}

/**
 * Roll a skillbook drop among non-maxed skills.
 * @returns {string|null} skill id or null
 */
export function tryRollSkillbookDrop(rng, gameState, chance) {
  ensureSkills(gameState)
  if ((rng?.() ?? Math.random()) >= chance) return null
  const pool = trainableSkillIds(gameState.player.skills)
  if (!pool.length) return null
  return pool[Math.floor((rng?.() ?? Math.random()) * pool.length)]
}

/**
 * @param {boolean} [fromAlienHull] alien wrecks get +1% skillbook chance
 */
export function tryRollWreckSkillbook(rng, gameState, fromAlienHull = false) {
  const chance =
    WRECK_SKILLBOOK_CHANCE + (fromAlienHull ? ALIEN_WRECK_SKILLBOOK_BONUS : 0)
  return tryRollSkillbookDrop(rng, gameState, chance)
}

export function tryRollProbeSkillbook(rng, gameState) {
  return tryRollSkillbookDrop(rng, gameState, PROBE_SKILLBOOK_CHANCE)
}
