import { mulberry32 } from './prng.js'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Weighted so a normal yellow/white star is the common case; the rest give
// systems visual variety without every system looking exotic. Shared by
// render/starMesh.js (visuals) and game/state.js (starting-system pick) so
// both agree on which systems are binaries.
// Note: 'trinary' is never rolled here — only Whispers gets one (see
// placeWhispersSystem / system.starType).
export const STAR_TYPES = [
  'mainSequence', 'mainSequence', 'mainSequence',
  'redDwarf', 'redDwarf',
  'whiteDwarf', 'giant', 'binary'
]

export function starTypeForSystem(system) {
  // Explicit override (Whispers sets starType: 'trinary' at galaxy gen).
  if (system && typeof system === 'object') {
    if (system.starType) return system.starType
    // Name fallback for saves / mid-session renames that lack the flag.
    if (system.name === 'Whispers') return 'trinary'
  }
  const id = typeof system === 'string' ? system : system.id
  const rng = mulberry32(hashString(id))
  return STAR_TYPES[Math.floor(rng() * STAR_TYPES.length)]
}

/** Multi-star systems that should not be used as a new-game home. */
export function isExoticStarType(type) {
  return type === 'binary' || type === 'trinary'
}
