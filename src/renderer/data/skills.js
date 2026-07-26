/**
 * Player-only skill system (0–20 levels). Raised only by skillbooks.
 * Skillbooks drop from wrecks (0.5%) and probes (0.05%); maxed skills stop dropping.
 * Skillbooks are NEVER market goods — loot only; read from Inventory → Skillbooks.
 */

export const MAX_SKILL_LEVEL = 20

/** Wreck salvage chance to roll a skillbook (among trainable skills). */
export const WRECK_SKILLBOOK_CHANCE = 0.005
/** Extra skillbook chance on alien ship wrecks (additive → 1.5% total). */
export const ALIEN_WRECK_SKILLBOOK_BONUS = 0.01
/** Probe find chance to roll a skillbook (among trainable skills). */
export const PROBE_SKILLBOOK_CHANCE = 0.0005

/**
 * @typedef {{ id: string, name: string, bookName: string, description: string }} SkillDef
 */

/** @type {SkillDef[]} */
export const SKILLS = [
  {
    id: 'probe_expert',
    name: 'Probe Expert',
    bookName: 'Skillbook: Probe Expert',
    description: 'Each level: +2% chance of good probe loot (survey data / blueprints).'
  },
  {
    id: 'trading',
    name: 'Trading',
    bookName: 'Skillbook: Trading',
    description: 'Each level: 1% cheaper buys, 1% better sell prices.'
  },
  {
    id: 'industry',
    name: 'Industry',
    bookName: 'Skillbook: Industry',
    description: 'Each level: 2% lower bay credit fees and 2% lower ore materials.'
  },
  {
    id: 'gunnery',
    name: 'Gunnery',
    bookName: 'Skillbook: Gunnery',
    description: 'Each level: +2% damage on laser / turret hardpoints (player only).'
  },
  {
    id: 'launchers',
    name: 'Launchers',
    bookName: 'Skillbook: Launchers',
    description: 'Each level: +2% damage on missile / rocket hardpoints (player only).'
  },
  {
    id: 'manoeuvring',
    name: 'Starship Manoeuvring',
    bookName: 'Skillbook: Starship Manoeuvring',
    description: 'Each level: +2% ship agility (turn rate, player only).'
  },
  {
    id: 'thrust',
    name: 'Starship Thrust Control',
    bookName: 'Skillbook: Starship Thrust Control',
    description: 'Each level: +5% max velocity and +4% supercruise speed (player only).'
  },
  {
    id: 'drones',
    name: 'Drones',
    bookName: 'Skillbook: Drones',
    description: 'Each level: +1% drone damage and +1% drone speed (player only).'
  },
  {
    id: 'cloning',
    name: 'Cloning',
    bookName: 'Skillbook: Cloning',
    description:
      'Base capacity is 1 clone. Each level adds one clone slot. Level 1+ unlocks clone jumps between bodies (Clone Bay).'
  }
]

const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]))

export function getSkillDef(skillId) {
  const def = SKILL_BY_ID[skillId]
  if (!def) throw new Error(`Unknown skill: ${skillId}`)
  return def
}

export function isSkillId(id) {
  return !!SKILL_BY_ID[id]
}

/** Empty skill map (all zero). */
export function emptySkills() {
  const m = {}
  for (const s of SKILLS) m[s.id] = 0
  return m
}

/**
 * Clamp / fill missing skills on a map.
 * @param {Record<string, number> | null | undefined} raw
 */
export function normalizeSkills(raw) {
  const out = emptySkills()
  if (!raw || typeof raw !== 'object') return out
  for (const s of SKILLS) {
    const v = Math.floor(Number(raw[s.id]) || 0)
    out[s.id] = Math.max(0, Math.min(MAX_SKILL_LEVEL, v))
  }
  return out
}

export function skillLevel(skills, skillId) {
  const v = Math.floor(Number(skills?.[skillId]) || 0)
  return Math.max(0, Math.min(MAX_SKILL_LEVEL, v))
}

export function isSkillMaxed(skills, skillId) {
  return skillLevel(skills, skillId) >= MAX_SKILL_LEVEL
}

/** Skills still trainable (level < 20) — skillbooks of maxed skills never drop. */
export function trainableSkillIds(skills) {
  return SKILLS.filter((s) => !isSkillMaxed(skills, s.id)).map((s) => s.id)
}

// —— Bonus helpers (level → multiplier / additive) ——

/** Probe Expert: +0.02 absolute chance per level. */
export function probeLootBonus(level) {
  return skillLevel({ probe_expert: level }, 'probe_expert') * 0.02
}

/** Trading: buy price multiplier (0.80 at L20). */
export function tradingBuyMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return Math.max(0.01, 1 - 0.01 * n)
}

/** Trading: sell price multiplier (1.20 at L20). */
export function tradingSellMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return 1 + 0.01 * n
}

/** Industry: cost multiplier for credits & ore (0.60 at L20). */
export function industryCostMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return Math.max(0.01, 1 - 0.02 * n)
}

/** Gunnery / Launchers: damage mult (+2%/level). */
export function weaponSkillDamageMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return 1 + 0.02 * n
}

/** Manoeuvring: turn-rate mult (+2%/level). */
export function manoeuvringMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return 1 + 0.02 * n
}

/** Thrust: max velocity mult (+5%/level). */
export function thrustSpeedMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return 1 + 0.05 * n
}

/** Thrust: supercruise mult (+4%/level) on top of velocity mult. */
export function thrustCruiseMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return 1 + 0.04 * n
}

/** Drones: damage & speed mult (+1%/level). */
export function droneSkillMult(level) {
  const n = Math.max(0, Math.min(MAX_SKILL_LEVEL, level | 0))
  return 1 + 0.01 * n
}

/**
 * Scale an ore cost map by industry mult (round; drop zeros).
 * @param {Record<string, number>} cost
 * @param {number} mult
 */
export function scaleOreCost(cost, mult) {
  const m = Math.max(0, Number(mult) || 0)
  const out = {}
  for (const [id, qty] of Object.entries(cost ?? {})) {
    const q = Math.max(0, Math.floor(Number(qty) || 0))
    if (q < 1) continue
    const n = Math.max(0, Math.round(q * m))
    // Keep at least 1 unit if any remaining cost after heavy discount would wipe a line of 1.
    if (n > 0) out[id] = n
    else if (m > 0 && q > 0 && m < 1) {
      // Very high skill: allow zero for that ore type when fractionally gone.
    }
  }
  return out
}
