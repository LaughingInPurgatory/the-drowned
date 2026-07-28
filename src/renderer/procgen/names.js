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
// Land / island endings — never facility words (those are for ports/outposts).
const LAND_SUFFIX = [
  'ain', 'os', 'ara', 'ell', 'ion', 'oth', 'yn', 'ade', 'ora', 'ex',
  'ius', 'arae', 'holm', 'mere', 'reach', 'spire', 'well', 'ridge', 'fall',
  'deep', 'crest', 'shard', 'veil', 'prime',
  'strand', 'skerry', 'sound', 'bight', 'shoal', 'cay', 'ness', 'firth',
  'barrow', 'tide', 'reef', 'scar', 'drift', 'isle', 'key', 'rock', 'head',
  'point', 'bank', 'lea', 'moor', 'vale', 'tor', 'crag'
]
// Facility roots (open water ports / wreck fields) may still use these.
const FACILITY_SUFFIX = [
  ...LAND_SUFFIX,
  'gate', 'march', 'watch', 'haven', 'port', 'quay', 'wharf', 'landing', 'nexus'
]
// Back-compat alias — callers that want a generic root get facility pool.
const NAME_SUFFIX = FACILITY_SUFFIX

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
export function generateNameRoot(rng, attempt = 0, landOnly = false) {
  const suffixes = landOnly ? LAND_SUFFIX : FACILITY_SUFFIX
  let root = pick(rng, NAME_PREFIX) + pick(rng, NAME_MID) + pick(rng, suffixes)
  // Extra entropy after collisions so we don't burn the whole catalog.
  if (attempt > 0 && attempt % 3 === 0) root += pick(rng, suffixes)
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

const PORT_FORMS = ['Port %', '% Harbour', '% Quay', '% Landing', '% Docks']
const OUTPOST_FORMS = ['% Fort', '% Anchorage', '% Light', '% Watch', '% Station']
const WRECK_FORMS = ['% Shoal', 'The % Wreck', '% Graves', '% Scatter', '% Reef']
const HOST_DIR = ['North', 'South', 'East', 'West', 'Outer', 'Inner', 'New', 'Old', 'Upper', 'Lower']

/** Register a fixed name into the used set (or throw if already taken). */
export function claimFixedName(name, used) {
  const set = used ?? new Set()
  const key = String(name).toLowerCase()
  if (set.has(key)) {
    // Caller must resolve collisions; still mark so nothing else reuses it.
    return name
  }
  set.add(key)
  return name
}

/**
 * Harbour / outpost / wreck-field / island labels.
 * All full display names share one `used` set (case-insensitive) so nothing collides.
 *
 * @param {string|null} [hostName] island this facility sits on — may be inherited
 *   into the name ("Haven Sound Harbour") ~half the time when present.
 */
export function generateBodyName(rng, kind, used = null, hostName = null) {
  const set = used ?? new Set()
  const fromForms = (forms, landRoot = false) =>
    claimUniqueName(rng, set, (r, attempt) =>
      pick(r, forms).replace('%', generateNameRoot(r, attempt, landRoot))
    )

  if (kind === 'port' || kind === 'outpost') {
    const forms = kind === 'port' ? PORT_FORMS : OUTPOST_FORMS
    // Coastal facilities often take the island's name into their own.
    if (hostName && rng() < 0.55) {
      return claimUniqueName(rng, set, (r, attempt) => {
        if (attempt === 0) return pick(r, forms).replace('%', hostName)
        if (attempt < 10) {
          const dir = pick(r, HOST_DIR)
          return pick(r, forms).replace('%', `${hostName} ${dir}`)
        }
        return pick(r, forms).replace('%', generateNameRoot(r, attempt, false))
      })
    }
    return fromForms(forms, false)
  }
  if (kind === 'wreckField') return fromForms(WRECK_FORMS, false)
  if (kind === 'archipelago') return generateSystemName(rng, set)
  // Islands: bare land root only — never "… Landing" as a landmass by itself.
  return claimUniqueName(rng, set, (r, attempt) => generateNameRoot(r, attempt, true))
}
