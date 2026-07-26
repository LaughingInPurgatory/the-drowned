import { pick, intRange } from './prng.js'

const FIRST_NAME_PARTS = [
  'Ja', 'Mor', 'Ka', 'El', 'Ro', 'Sa', 'Ti', 'Mi', 'Lu', 'De',
  'An', 'Vi', 'Bri', 'Cor', 'Nad', 'Ori', 'Fen', 'Zeph', 'Yol', 'Quin',
  'Rem', 'Wes', 'Iva', 'Pet'
]
const LAST_NAME_PARTS = [
  'son', 'ley', 'ford', 'stone', 'wick', 'ton', 'vale', 'moor', 'ridge', 'field',
  'burn', 'well', 'shaw', 'kirk', 'holt', 'dale', 'gate', 'reed', 'cross', 'thorn',
  'brook', 'wood', 'lund', 'hart'
]

export function generateHumanName(rng) {
  const first = pick(rng, FIRST_NAME_PARTS) + pick(rng, FIRST_NAME_PARTS)
  const last = pick(rng, LAST_NAME_PARTS).replace(/^./, (c) => c.toUpperCase())
  return `${first} ${last.charAt(0).toUpperCase() + last.slice(1)}`
}

const ALIEN_CONSONANTS = ['kr', 'th', 'vor', 'x', 'q', 'zh', 'gr', 'nn', 'ss', 'tk', 'dr', 'vex', 'kh', 'zr']
const ALIEN_VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'oo', 'ai']

export function generateSpeciesName(rng) {
  const syllables = intRange(rng, 2, 3)
  let name = ''
  for (let i = 0; i < syllables; i++) {
    name += pick(rng, ALIEN_CONSONANTS) + pick(rng, ALIEN_VOWELS)
  }
  if (rng() < 0.2) name += `'${pick(rng, ALIEN_CONSONANTS)}`
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Expanded pools so ~450 systems + facilities can all claim unique roots
// without colliding. Case-insensitive uniqueness is enforced by used-name sets.
const NAME_PREFIX = [
  'Kor', 'Val', 'Ther', 'Ash', 'Bel', 'Dun', 'Eri', 'Fal', 'Gal', 'Hes',
  'Ios', 'Jun', 'Lyr', 'Mira', 'Nyx', 'Oster', 'Pryn', 'Quel', 'Ravn', 'Sol',
  'Tarn', 'Ul', 'Vesh', 'Wren', 'Cael', 'Drav', 'Hex', 'Ix', 'Jor', 'Kel',
  'Lux', 'Mar', 'Nex', 'Orn', 'Pax', 'Rho', 'Sarn', 'Tor', 'Umb', 'Vex',
  'Wey', 'Xan', 'Yara', 'Zel', 'Arct', 'Bran', 'Cind', 'Dusk', 'Ember', 'Frost'
]
const NAME_MID = [
  'a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'or', 'an', 'el',
  'is', 'um', 'ar', 'yn', 'os'
]
const NAME_SUFFIX = [
  'ain', 'os', 'ara', 'ell', 'ion', 'oth', 'yn', 'ade', 'ora', 'ex',
  'ius', 'arae', 'holm', 'mere', 'reach', 'gate', 'spire', 'well', 'ridge', 'fall',
  'port', 'haven', 'march', 'watch', 'deep', 'crest', 'shard', 'veil', 'prime', 'nexus'
]
/** Convert a positive integer to Roman numerals (enough for multi-planet systems). */
export function toRoman(n) {
  if (!Number.isFinite(n) || n < 1) return String(n)
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ]
  let left = Math.floor(n)
  let out = ''
  for (const [val, sym] of table) {
    while (left >= val) {
      out += sym
      left -= val
    }
  }
  return out
}

function capitalizeRoot(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** One procedural root word (not yet uniqueness-checked). */
export function generateNameRoot(rng, attempt = 0) {
  let root = pick(rng, NAME_PREFIX) + pick(rng, NAME_MID) + pick(rng, NAME_SUFFIX)
  // Extra entropy after collisions so we don't burn the whole catalog.
  if (attempt > 0 && attempt % 3 === 0) root += pick(rng, NAME_SUFFIX)
  if (attempt > 12) root += String(attempt)
  return capitalizeRoot(root)
}

/**
 * Claim a unique display name. `used` stores lowercase keys.
 * `build(attempt)` returns a candidate string for that try.
 */
export function claimUniqueName(rng, used, build) {
  const set = used ?? new Set()
  for (let attempt = 0; attempt < 120; attempt++) {
    const name = build(rng, attempt)
    const key = name.toLowerCase()
    if (!set.has(key)) {
      set.add(key)
      return name
    }
  }
  // Absolute fallback — always unique.
  let n = set.size
  let name
  do {
    name = `${build(rng, 0)}-${n++}`
  } while (set.has(name.toLowerCase()))
  set.add(name.toLowerCase())
  return name
}

/** Unique star-system name for the galaxy map. */
export function generateSystemName(rng, used) {
  return claimUniqueName(rng, used, (r, attempt) => generateNameRoot(r, attempt))
}

/** Sequential catalog name: "Sarnosian III" (system name + Roman numeral). */
export function sequentialPlanetName(systemName, index1Based) {
  return `${systemName} ${toRoman(index1Based)}`
}

/**
 * Sequential moon of a planet: "Sarnosian II - Moon I".
 * Always uses Roman indices (even for a lone moon).
 */
export function sequentialMoonName(planetName, moonIndex1Based = 1) {
  return `${planetName} - Moon ${toRoman(moonIndex1Based)}`
}

/** True if moonName is a catalog moon of planetName (any Roman index). */
export function isSequentialMoonName(planetName, moonName) {
  const esc = planetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${esc} - Moon [IVXLCDM]+$`).test(moonName)
}

/**
 * Proper name for a planet that hosts a facility — plain word root only,
 * never Roman/Arabic numerals (those are reserved for sequential catalog names).
 */
export function generateUniquePlanetName(rng, used) {
  return claimUniqueName(rng, used, (r, attempt) => generateNameRoot(r, attempt))
}

/** Same rules as unique planets — no numerals in the proper name. */
export function generateUniqueMoonName(rng, used) {
  return claimUniqueName(rng, used, (r, attempt) => generateNameRoot(r, attempt))
}

/** Station / settlement / belt labels with unique roots. */
export function generateBodyName(rng, kind, used = null) {
  const root = () => generateNameRoot(rng)
  if (kind === 'station') {
    return claimUniqueName(rng, used ?? new Set(), (r, attempt) => `${generateNameRoot(r, attempt)} Station`)
  }
  if (kind === 'settlement') {
    return claimUniqueName(rng, used ?? new Set(), (r, attempt) => `${generateNameRoot(r, attempt)} Settlement`)
  }
  if (kind === 'asteroidField') {
    return claimUniqueName(rng, used ?? new Set(), (r, attempt) => `${generateNameRoot(r, attempt)} Belt`)
  }
  if (kind === 'system') {
    return generateSystemName(rng, used ?? new Set())
  }
  // Proper names only — no numerals (use sequentialPlanetName for catalog planets).
  if (kind === 'planet' || kind === 'moon') {
    return claimUniqueName(rng, used ?? new Set(), (r, attempt) => generateNameRoot(r, attempt))
  }
  if (used) {
    return claimUniqueName(rng, used, (r, attempt) => generateNameRoot(r, attempt))
  }
  return root()
}
