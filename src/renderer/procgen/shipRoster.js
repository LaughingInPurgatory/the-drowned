import { pick, range, intRange } from './prng.js'

// Unique ship model names — no Mk / I / II / III.
/**
 * Vessel model names. Boats are named the way boats are named: after weather,
 * seabirds, places on a chart, and the sort of grim humour that comes of
 * working a drowned world.
 */
const SHIP_NAME_POOL = [
  // Single-word
  'Solace', 'Halcyon', 'Meridian', 'Petrel', 'Nomad', 'Fulmar',
  'Kittiwake', 'Gannet', 'Cormorant', 'Skua', 'Tern', 'Shearwater',
  'Guillemot', 'Puffin', 'Curlew', 'Dunlin', 'Sanderling', 'Brent',
  'Squall', 'Gale', 'Doldrum', 'Monsoon', 'Trade Wind', 'Sirocco',
  'Bilge', 'Ballast', 'Gunwale', 'Transom', 'Capstan', 'Windlass',
  'Halyard', 'Bowline', 'Sheepshank', 'Marlinspike', 'Holdfast', 'Grapnel',
  'Driftwood', 'Flotsam', 'Jetsam', 'Salvor', 'Wrecker', 'Beachcomber',
  'Barnacle', 'Limpet', 'Kelp', 'Bladderwrack', 'Spindrift', 'Backwash',
  // Two-word compounds (always unique as a pair)
  'Broken Meridian', 'Cold Anchorage', 'Deep Sounding', 'Empty Net',
  'Far Landing', 'Grey Horizon', 'Hollow Keel', 'Iron Draught', 'Long Watch',
  'Lost Solace', 'Low Water', 'Night Fisher', 'Old Salt', 'Open Roads',
  'Pale Wake', 'Quiet Berth', 'Red Ensign', 'Silent Tide', 'Slack Water',
  'Standing Wave', 'Storm Petrel', 'White Squall', 'Foul Ground', 'Last Buoy',
  'Amber Lantern', 'Black Rock', 'Copper Wake', 'Dead Reckoning', 'Ebb Tide',
  'Flood Tide', 'Ghost Net', 'Half Fathom', 'High Water', 'Ill Wind',
  'Jury Rig', 'Kedge Anchor', 'Leeward Bell', 'Mercy of the Sea', 'Neap Tide',
  'North Channel', 'Old Compass', 'Port Bower', 'Quarter Sea', 'Rough Passage',
  'Salt Meridian', 'Spring Tide', 'Tall Water', 'Under Keel', 'Van Der Waal',
  'Weather Gauge', 'Wide Berth', 'Yellow Flag', 'Zero Fathom', 'Fair Wind',
  'Grave Shoal', 'Hard Aground', 'Idle Hands', 'Just Enough', 'Keel Hauler',
  'Late Landfall', 'Made Good', 'Narrow Sound', 'Ordinary Seaman', 'Plain Sailing',
  'Quick Water', 'Rising Glass', 'Sea Room', 'Two Fathom', 'Up Anchor'
]

// Used only for emergency uniqueness if the pool is exhausted.
const SHIP_NAME_SUFFIXES = [
  'Runner', 'Keel', 'Wake', 'Trader', 'Hauler', 'Lighter', 'Tender', 'Cutter',
  'Launch', 'Skiff', 'Dredger', 'Lugger', 'Smack', 'Ketch', 'Hoy', 'Barge'
]

const ROLE_WEIGHTS = ['trader', 'trader', 'fighter', 'fighter', 'explorer']

// cargoCapacity pre-scale values — shipClasses.js applies scaleCargoCapacity()
// so light hulls rise modestly and top freighters land near ~700.
// Ranges are [cheap tier … expensive tier]; generation interpolates by price tier.
const ROLE_STAT_RANGES = {
  trader: { hull: [95, 210], armor: [53, 130], cargoCapacity: [60, 260], speed: [95, 55], turnRate: [1.2, 0.65], accel: [22, 12] },
  fighter: { hull: [55, 155], armor: [72, 190], cargoCapacity: [8, 32], speed: [155, 245], turnRate: [1.9, 3.0], accel: [38, 68] },
  explorer: { hull: [45, 125], armor: [43, 122], cargoCapacity: [22, 120], speed: [140, 200], turnRate: [1.5, 2.5], accel: [24, 48] }
}

// Shop price bands for generated hulls (hand-crafted keep authored prices).
const ROLE_PRICE_BANDS = {
  trader: [10000, 72000],
  fighter: [12000, 58000],
  explorer: [9000, 54000]
}

const ROLE_LENGTH_RANGES = {
  // Wide bands so same-role hulls aren't all mid-sized clones.
  trader: [20, 46],
  fighter: [11, 32],
  explorer: [13, 38]
}

// Broad industrial palettes per role — still readable as "fleet family",
// but individual hulls can sit anywhere in a wide hue/sat/light window.
const ROLE_HUE_RANGES = {
  trader: [8, 95], // rust → bronze → olive
  fighter: [165, 295], // teal → blue → violet → magenta edge
  explorer: [95, 240] // green → cyan → sky
}
const ROLE_SAT_RANGES = {
  trader: [0.08, 0.48],
  fighter: [0.06, 0.42],
  explorer: [0.1, 0.5]
}
const ROLE_LIGHT_RANGES = {
  trader: [0.28, 0.62],
  fighter: [0.32, 0.68],
  explorer: [0.34, 0.7]
}

const ROLE_HARDPOINT_COUNTS = {
  trader: [1, 1],
  fighter: [2, 3],
  explorer: [1, 2]
}

// Accessory bays (0–4). Starter Light Runner has 1; generated hulls
// usually have at least one bay so Autopilot and later modules can fit.
const ROLE_ACCESSORY_SLOT_COUNTS = {
  trader: [1, 2, 2, 3, 4],
  fighter: [0, 1, 1, 2, 2],
  explorer: [1, 1, 2, 2, 3]
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function generateShipModelName(rng, usedNames) {
  // Prefer unused pool entries (shuffle-ish via random picks).
  for (let attempt = 0; attempt < SHIP_NAME_POOL.length * 2; attempt++) {
    const name = pick(rng, SHIP_NAME_POOL)
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return name
    }
  }
  // Exhausted pool: unique compound, still no Mk / Roman numerals.
  for (let attempt = 0; attempt < 40; attempt++) {
    const a = pick(rng, SHIP_NAME_POOL).split(/\s+/)[0]
    const b = pick(rng, SHIP_NAME_SUFFIXES)
    const name = `${a} ${b}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return name
    }
  }
  const fallback = `${pick(rng, SHIP_NAME_POOL).split(/\s+/)[0]} ${pick(rng, SHIP_NAME_SUFFIXES)} ${Math.floor(rng() * 900 + 100)}`
  usedNames.add(fallback)
  return fallback
}

// Strong asymmetry — enough oddballs that fleets don't look mirrored clones.
export const STRONG_ASYMMETRY_CHANCE = 0.14

// Multiple silhouette archetypes per role so generated fleets don't share one curve.
/**
 * Hull types by trade. These are boats, so the archetypes are the shapes real
 * working craft take: full-bodied and blunt for cargo, fine and fast for
 * patrol, sea-kindly for a survey boat, and beam-heavy for salvage.
 */
const ROLE_ARCHETYPES = {
  trader: ['coaster', 'tanker', 'barge', 'container', 'tug', 'catamaran', 'hoy'],
  fighter: ['patrol', 'gunboat', 'cutter', 'launch', 'corvette', 'hydrofoil'],
  explorer: ['yacht', 'survey', 'trawler', 'ketch', 'pilot']
}

/**
 * Waterline beam at each of 12 stations, transom (0) → bow (11), as a fraction
 * of the maximum beam.
 *
 * Every one of these ends fine at the bow and full at the transom, because
 * that is what a hull is: something that parts water at one end and lets it go
 * at the other. The differences between them are where the volume sits.
 */
function archetypeFracs(rng, role, archetype) {
  const j = (a, b) => range(rng, a, b)

  if (role === 'trader') {
    if (archetype === 'tanker') {
      // Parallel middle body running most of her length — maximum volume.
      return [j(0.72, 0.88), j(0.9, 1), j(0.98, 1), j(1, 1), j(1, 1), j(1, 1), j(1, 1), j(0.98, 1), j(0.9, 1), j(0.7, 0.88), j(0.42, 0.6), j(0.16, 0.28)]
    }
    if (archetype === 'barge') {
      // Near box-shaped: blunt both ends, made for carrying not for going.
      return [j(0.85, 1), j(0.95, 1), j(1, 1), j(1, 1), j(1, 1), j(1, 1), j(1, 1), j(1, 1), j(0.95, 1), j(0.85, 0.97), j(0.6, 0.8), j(0.3, 0.48)]
    }
    if (archetype === 'container') {
      // Long, boxy, fine entry — a working feeder ship.
      return [j(0.7, 0.85), j(0.88, 0.98), j(0.96, 1), j(1, 1), j(1, 1), j(1, 1), j(0.98, 1), j(0.92, 1), j(0.8, 0.94), j(0.58, 0.76), j(0.34, 0.5), j(0.12, 0.22)]
    }
    if (archetype === 'tug') {
      // Short, deep and enormously beamy aft — all engine and bollard pull.
      return [j(0.82, 0.98), j(0.95, 1), j(1, 1), j(1, 1), j(0.96, 1), j(0.88, 0.98), j(0.78, 0.9), j(0.68, 0.82), j(0.56, 0.72), j(0.42, 0.58), j(0.28, 0.42), j(0.14, 0.26)]
    }
    if (archetype === 'catamaran') {
      // Twin hulls; the offsets pass add the split, this is the envelope.
      return [j(0.8, 0.95), j(0.9, 1), j(1, 1), j(0.94, 1), j(0.88, 0.98), j(0.88, 0.98), j(0.9, 1), j(0.86, 0.96), j(0.72, 0.88), j(0.52, 0.7), j(0.32, 0.48), j(0.14, 0.24)]
    }
    if (archetype === 'hoy') {
      // Small beamy trading smack — full aft, apple-cheeked bow.
      return [j(0.7, 0.88), j(0.88, 1), j(0.97, 1), j(1, 1), j(1, 1), j(0.96, 1), j(0.88, 0.98), j(0.78, 0.9), j(0.66, 0.8), j(0.5, 0.64), j(0.32, 0.46), j(0.16, 0.26)]
    }
    // coaster — the ordinary short-sea trader
    return [j(0.72, 0.9), j(0.9, 1), j(0.98, 1), j(1, 1), j(1, 1), j(0.98, 1), j(0.94, 1), j(0.86, 0.96), j(0.72, 0.88), j(0.54, 0.7), j(0.34, 0.5), j(0.14, 0.24)]
  }

  if (role === 'fighter') {
    if (archetype === 'gunboat') {
      // Beamy forward to carry a gun, still fine at the entry.
      return [j(0.78, 0.92), j(0.9, 1), j(0.98, 1), j(1, 1), j(1, 1), j(0.98, 1), j(0.92, 1), j(0.82, 0.94), j(0.68, 0.82), j(0.5, 0.66), j(0.3, 0.46), j(0.12, 0.22)]
    }
    if (archetype === 'cutter') {
      // Long and lean, a fast hull with a hard chine aft.
      return [j(0.7, 0.86), j(0.85, 0.97), j(0.94, 1), j(1, 1), j(0.98, 1), j(0.9, 1), j(0.8, 0.92), j(0.68, 0.82), j(0.54, 0.68), j(0.38, 0.52), j(0.22, 0.34), j(0.08, 0.16)]
    }
    if (archetype === 'launch') {
      // Small, wide transom, planing — mostly engine and a gun.
      return [j(0.86, 1), j(0.96, 1), j(1, 1), j(0.98, 1), j(0.92, 1), j(0.84, 0.95), j(0.74, 0.86), j(0.62, 0.75), j(0.48, 0.62), j(0.34, 0.48), j(0.2, 0.32), j(0.08, 0.16)]
    }
    if (archetype === 'corvette') {
      // The biggest thing that still counts as fast — long, powerful, fine bow.
      return [j(0.68, 0.84), j(0.84, 0.96), j(0.94, 1), j(1, 1), j(1, 1), j(0.96, 1), j(0.88, 0.98), j(0.76, 0.9), j(0.62, 0.76), j(0.44, 0.58), j(0.26, 0.38), j(0.08, 0.16)]
    }
    if (archetype === 'hydrofoil') {
      // Very fine and narrow — she is meant to be up out of the water.
      return [j(0.6, 0.76), j(0.76, 0.9), j(0.88, 0.98), j(0.96, 1), j(1, 1), j(0.92, 1), j(0.8, 0.92), j(0.66, 0.8), j(0.5, 0.64), j(0.34, 0.48), j(0.18, 0.3), j(0.06, 0.13)]
    }
    // patrol — the standard fast hull
    return [j(0.76, 0.9), j(0.88, 1), j(0.96, 1), j(1, 1), j(0.99, 1), j(0.93, 1), j(0.84, 0.96), j(0.72, 0.86), j(0.58, 0.72), j(0.42, 0.56), j(0.24, 0.38), j(0.09, 0.18)]
  }

  // explorer
  if (archetype === 'yacht') {
    // Fine, sea-kindly, a bit of overhang aft. The pretty one.
    return [j(0.6, 0.76), j(0.8, 0.94), j(0.92, 1), j(1, 1), j(1, 1), j(0.96, 1), j(0.88, 0.98), j(0.76, 0.9), j(0.6, 0.76), j(0.42, 0.58), j(0.24, 0.38), j(0.08, 0.16)]
  }
  if (archetype === 'trawler') {
    // Deep and full — built to stay out in weather, not to be quick.
    return [j(0.8, 0.95), j(0.92, 1), j(1, 1), j(1, 1), j(0.98, 1), j(0.92, 1), j(0.84, 0.95), j(0.74, 0.87), j(0.62, 0.76), j(0.46, 0.6), j(0.28, 0.42), j(0.12, 0.22)]
  }
  if (archetype === 'ketch') {
    // A sailing hull under power: long keel, easy lines, fine ends.
    return [j(0.55, 0.7), j(0.75, 0.9), j(0.9, 1), j(0.98, 1), j(1, 1), j(0.97, 1), j(0.9, 1), j(0.78, 0.92), j(0.62, 0.78), j(0.44, 0.6), j(0.26, 0.4), j(0.1, 0.18)]
  }
  if (archetype === 'pilot') {
    // A pilot boat: short, immensely strong, made to lie alongside anything.
    return [j(0.84, 1), j(0.94, 1), j(1, 1), j(1, 1), j(0.96, 1), j(0.9, 1), j(0.82, 0.94), j(0.72, 0.85), j(0.58, 0.72), j(0.42, 0.56), j(0.26, 0.38), j(0.11, 0.2)]
  }
  // survey — beamy working platform with a clear afterdeck
  return [j(0.82, 0.96), j(0.92, 1), j(1, 1), j(1, 1), j(0.98, 1), j(0.94, 1), j(0.88, 0.98), j(0.78, 0.9), j(0.64, 0.78), j(0.48, 0.62), j(0.3, 0.44), j(0.12, 0.22)]
}

/**
 * Compact fingerprint for uniqueness checks (length / bulk / kit).
 * Coarse enough that near-clones collide; fine enough unique kits pass.
 */
export function hullFingerprint(hull) {
  if (!hull) return ''
  const w = hull.stationWidths ?? []
  const h = hull.stationHeights ?? []
  const maxW = Math.max(0, ...w)
  const maxH = Math.max(0, ...h)
  const midW = w[Math.floor(w.length / 2)] ?? 0
  const noseW = w[w.length - 1] ?? 0
  const tailW = w[0] ?? 0
  const st = hull.style ?? {}
  const wings = (hull.wings ?? [])
    .map((x) => `${x.side}:${x.atStation}:${Math.round((x.span ?? 0) * 5)}`)
    .sort()
    .join(',')
  return [
    Math.round((hull.length ?? 0) * 2),
    Math.round(maxW * 12),
    Math.round(maxH * 12),
    Math.round(midW * 12),
    Math.round(noseW * 14),
    Math.round(tailW * 14),
    hull.crossSectionSides ?? 0,
    Math.round((hull.superellipseExponent ?? 2) * 3),
    st.engineLayout ?? '',
    st.asymmetric ? 1 : 0,
    st.cockpitMount ?? 'top',
    st.hasCargoPods ? 1 : 0,
    st.hasDockingRing ? 1 : 0,
    st.visualKit ?? 0,
    wings
  ].join('|')
}

export function hullsTooSimilar(a, b) {
  if (!a || !b) return false
  if (hullFingerprint(a) === hullFingerprint(b)) return true
  const la = a.length ?? 0
  const lb = b.length ?? 0
  if (Math.abs(la - lb) > Math.max(la, lb) * 0.12 + 1.5) return false
  const wa = Math.max(...(a.stationWidths ?? [0]))
  const wb = Math.max(...(b.stationWidths ?? [0]))
  if (Math.abs(wa - wb) > Math.max(wa, wb) * 0.14 + 0.15) return false
  const sa = a.style ?? {}
  const sb = b.style ?? {}
  if ((sa.engineLayout ?? '') !== (sb.engineLayout ?? '')) return false
  if ((sa.visualKit ?? 0) !== (sb.visualKit ?? 0) && Math.abs(la - lb) > 3) return false
  const wingA = (a.wings ?? []).length
  const wingB = (b.wings ?? []).length
  if (Math.abs(wingA - wingB) > 1) return false
  // Same engine + similar bulk + similar wing count → too close.
  return (
    Math.abs(la - lb) < Math.max(la, lb) * 0.08 + 1 &&
    Math.abs(wa - wb) < Math.max(wa, wb) * 0.1 + 0.1 &&
    wingA === wingB &&
    (sa.cockpitMount ?? 'top') === (sb.cockpitMount ?? 'top')
  )
}

// Role-shaped silhouettes that read as human engineering, with archetype variety.
// 12 loft stations for high geometric complexity.
function generateHullSilhouette(rng, role, forcedArchetype = null) {
  const archetypes = ROLE_ARCHETYPES[role] ?? ROLE_ARCHETYPES.explorer
  const archetype = forcedArchetype && archetypes.includes(forcedArchetype)
    ? forcedArchetype
    : pick(rng, archetypes)

  const [minLen, maxLen] = ROLE_LENGTH_RANGES[role] ?? ROLE_LENGTH_RANGES.explorer
  // Length by hull type. Tankers and container boats are long for their beam;
  // tugs, launches and pilot boats are famously short for theirs.
  let lenScale = 1
  if (archetype === 'tanker' || archetype === 'container' || archetype === 'corvette') {
    lenScale = range(rng, 1.1, 1.35)
  }
  if (archetype === 'tug' || archetype === 'launch' || archetype === 'pilot' || archetype === 'hoy') {
    lenScale = range(rng, 0.7, 0.9)
  }
  if (archetype === 'barge' || archetype === 'trawler' || archetype === 'survey') {
    lenScale = range(rng, 0.85, 1.05)
  }
  if (archetype === 'hydrofoil' || archetype === 'cutter' || archetype === 'ketch') {
    lenScale = range(rng, 1.0, 1.22)
  }
  // Extra per-hull jitter so the same type still spreads.
  lenScale *= range(rng, 0.92, 1.1)
  const length = range(rng, minLen, maxLen) * lenScale

  // Beam-to-length. This is the single number that most decides whether
  // something reads as a barge or a launch — real hulls run roughly 1:3 (a tug)
  // to 1:9 (a fast patrol boat).
  const beamRatio =
    archetype === 'barge' || archetype === 'tug' || archetype === 'pilot' || archetype === 'hoy'
      ? range(rng, 0.16, 0.22)
      : archetype === 'hydrofoil' || archetype === 'cutter' || archetype === 'corvette'
        // Fast, but still a boat. The old floor of 0.075 put half the Corsairs
        // past 1:9 and some as fine as 1:15 — that is a racing shell, and it
        // read as a dart rather than a hull however it was detailed.
        ? range(rng, 0.105, 0.145)
        : archetype === 'tanker' || archetype === 'container'
          ? range(rng, 0.13, 0.17)
          : range(rng, 0.125, 0.175)
  const peakWidth = (length * beamRatio) / 2

  const fracs = archetypeFracs(rng, role, archetype)
  // Independent per-station noise so clones of the same archetype diverge.
  const stationWidths = fracs.map((f, i) => {
    const wobble = range(rng, 0.82, 1.18)
    // Occasional mid-body bulge or pinch for individuality.
    const midBump =
      i >= 3 && i <= 8 && rng() < 0.35 ? range(rng, 0.88, 1.22) : 1
    return Math.max(0.08, f * peakWidth * wobble * midBump)
  })
  // Normalise so the widest station actually *is* peakWidth. Without this the
  // archetype's station fractions and the per-station wobble silently scale the
  // beam down — beamRatio is documented as the number that decides whether a
  // hull reads as a barge or a launch, but some archetypes peak well below 1.0,
  // so the finest of them came out at 1:15. That is a racing shell.
  {
    const widest = Math.max(...stationWidths)
    if (widest > 1e-6) {
      const k = peakWidth / widest
      for (let i = 0; i < stationWidths.length; i++) stationWidths[i] *= k
    }
  }

  // Depth of hull relative to beam. Cargo carriers are deep-sided; fast boats
  // are shallow so they can get up and plane.
  const heightRatio =
    role === 'trader'
      ? range(rng, 0.7, 1.05)
      : role === 'fighter'
        ? range(rng, 0.42, 0.66)
        : range(rng, 0.55, 0.85)
  const heightBias = range(rng, 0.9, 1.15)
  // Slight per-station variation so the sheer is not a perfect sweep.
  const heightProfile = stationWidths.map(() => range(rng, 0.94, 1.08))
  const stationHeights = stationWidths.map((w, i) => {
    const tip = i < 2 || i > 9 ? range(rng, 0.75, 1.12) : 1
    return Math.max(0.06, w * heightRatio * heightBias * tip * heightProfile[i])
  })

  // --- Boat profile ---------------------------------------------------------
  // Stations run aft (0) → bow (last). Three things separate a hull from a
  // fuselage, and none of them need new geometry code:
  //   1. A transom. Boats do not taper to a point at the stern.
  //   2. Sheer — the deck line rises toward the bow so it lifts over a sea.
  //   3. Freeboard. Sitting a symmetric hull on the waterline puts half the
  //      boat under; a real hull shows more above than below.
  const last = stationWidths.length - 1
  const transom = range(rng, 0.62, 0.9)
  stationWidths[0] = Math.max(stationWidths[0], stationWidths[1] * transom)
  stationHeights[0] = Math.max(stationHeights[0], stationHeights[1] * transom)
  // Fine the bow so it parts water instead of pushing it.
  stationWidths[last] *= range(rng, 0.35, 0.6)
  stationWidths[last - 1] *= range(rng, 0.6, 0.85)

  const sheer = range(rng, 0.1, 0.32)
  const freeboard = range(rng, 0.16, 0.3)
  const baseOffsetsY = stationHeights.map((h, i) => {
    const t = i / last
    // Rises toward the bow, and a little at the transom — the classic sheer
    // line, lowest around midships where the working deck is.
    const curve = Math.pow(t, 2.2) * sheer + Math.pow(1 - t, 3) * sheer * 0.35
    return h * (freeboard + curve)
  })

  const crossSectionSides = pick(
    rng,
    role === 'fighter'
      ? [6, 8, 10, 12, 14, 16]
      : role === 'trader'
        ? [6, 8, 8, 10, 12, 14]
        : [8, 10, 12, 14, 16, 18]
  )
  // Bilge shape. Low values are a round-bilge displacement hull; high values a
  // hard-chine planing hull, which is what the fast boats want.
  const superellipseExponent =
    archetype === 'barge' || archetype === 'container' || archetype === 'tanker'
      ? range(rng, 3.0, 4.4)
      : role === 'fighter'
        ? range(rng, 2.4, 3.6)
        : range(rng, 1.6, 2.6)

  const asymmetric =
    archetype === 'catamaran' || archetype === 'split' || rng() < STRONG_ASYMMETRY_CHANCE
  let stationOffsetsX = null
  let stationOffsetsY = baseOffsetsY
  if (asymmetric) {
    const bias = (rng() < 0.5 ? -1 : 1) * peakWidth * range(rng, 0.12, 0.38)
    stationOffsetsX = stationWidths.map((_, i) => {
      if (i === 0 || i === stationWidths.length - 1) return 0
      if (archetype === 'catamaran' || archetype === 'split') {
        // Lateral swell mid-body for twin-hull read.
        return bias * Math.sin((i / (stationWidths.length - 1)) * Math.PI)
      }
      return bias * (0.45 + 0.55 * Math.sin((i / (stationWidths.length - 1)) * Math.PI))
    })
    if (rng() < 0.75) {
      // A raised deckhouse amidships, on top of the sheer line.
      const hump = peakWidth * range(rng, 0.08, 0.22)
      stationOffsetsY = baseOffsetsY.map((y, i) =>
        y + (i >= 3 && i <= 8 ? hump * (i >= 5 && i <= 6 ? 1 : 0.55) : 0)
      )
    }
  }

  // Sponsons and guards, not wings. The lofter's "wing" primitive is just a
  // flat slab attached at a station, which reads as an outrigger, a rubbing
  // strake or a gun platform if it stays low, short and level. Anything swept
  // or raised turns the hull back into an aircraft, so none of that here.
  const wings = []
  const sponsonChance = role === 'fighter' ? 0.55 : role === 'trader' ? 0.7 : 0.5
  if (rng() < sponsonChance) {
    wings.push({
      atStation: pick(rng, [3, 4, 5, 6, 7]),
      // Wide enough to read as a hull form, never wide enough to read as a wing.
      span: range(rng, peakWidth * 0.5, peakWidth * 1.2),
      sweep: range(rng, -0.15, 0.15),
      thickness: range(rng, 0.1, 0.24),
      side: asymmetric && rng() < 0.35 ? pick(rng, ['left', 'right']) : 'both',
      tipOffsetY: range(rng, -0.12, 0.05),
      chordScale: range(rng, 0.9, 1.4)
    })
  }
  // A stern gun platform / working deck over the transom.
  if (role === 'fighter' ? rng() < 0.5 : rng() < 0.3) {
    wings.push({
      atStation: pick(rng, [1, 2]),
      span: range(rng, peakWidth * 0.6, peakWidth * 1.3),
      sweep: range(rng, -0.1, 0.1),
      thickness: range(rng, 0.08, 0.18),
      side: 'both',
      chordScale: range(rng, 0.8, 1.2)
    })
  }
  // Bilge keel — a thin strake under the turn of the bilge.
  if (rng() < 0.35) {
    wings.push({
      atStation: pick(rng, [4, 5, 6]),
      span: range(rng, peakWidth * 0.3, peakWidth * 0.7),
      sweep: 0,
      thickness: range(rng, 0.06, 0.14),
      side: 'bottom',
      chordScale: range(rng, 1.0, 1.6)
    })
  }

  const radarDishes = []
  if (role === 'explorer' || archetype === 'survey' || rng() < 0.7) radarDishes.push('top')
  if (role === 'explorer' ? rng() < 0.6 : rng() < 0.25) radarDishes.push('bottom')
  if (role === 'fighter' ? rng() < 0.45 : role === 'explorer' ? rng() < 0.55 : rng() < 0.3) {
    radarDishes.push(rng() < 0.55 ? 'side' : pick(rng, ['left', 'right']))
  }
  if (radarDishes.length === 0) radarDishes.push('top')

  const cockpitBottomChance =
    role === 'fighter' ? (archetype === 'gunboat' ? 0.45 : 0.28) : role === 'trader' ? 0.22 : 0.12
  const cockpitMount = rng() < cockpitBottomChance ? 'bottom' : 'top'

  // Distinct detail kit (0–31) drives addHullDetails branching so meshes diverge.
  const visualKit = Math.floor(rng() * 32)

  const engineLayout = pick(
    rng,
    role === 'trader'
      ? archetype === 'tug'
        ? ['twin', 'twin', 'triple']
        : ['single', 'single', 'twin', 'twin']
      : role === 'fighter'
        ? ['twin', 'twin', 'triple', 'quad']
        : ['single', 'single', 'twin']
  )

  // Plating family — mesh uses this for structural identity within a role.
  const platingStyle = pick(rng, [
    'belts',
    'sparse',
    'spine',
    'sponsons',
    'scales',
    'ribs',
    'clamshell',
    'lattice'
  ])

  const style = {
    asymmetric,
    bridgeSide: asymmetric ? (rng() < 0.5 ? -1 : 1) : 0,
    engineLayout,
    hasRadiator: rng() < (role === 'trader' ? 0.85 : 0.55),
    hasCargoPods: role === 'trader' && archetype !== 'tug' && rng() < 0.85,
    hasSensorMast: radarDishes.includes('top') || role === 'explorer' || rng() < 0.45,
    radarDishes,
    cockpitMount,
    hasDockingRing: role === 'trader' && rng() < 0.55 || role === 'explorer' && rng() < 0.28,
    detailDensity: range(rng, 1.2, 3.0),
    archetype,
    visualKit,
    platingStyle
  }

  return {
    length,
    stationWidths,
    stationHeights,
    crossSectionSides,
    superellipseExponent,
    wings,
    stationOffsetsX,
    stationOffsetsY,
    style
  }
}

function generateHardpoints(rng, role, hull, forcedCount = null) {
  const [minCount, maxCount] = ROLE_HARDPOINT_COUNTS[role] ?? [1, 1]
  const count =
    forcedCount != null
      ? Math.max(minCount, Math.min(maxCount, Math.floor(forcedCount)))
      : intRange(rng, minCount, maxCount)
  const zForward = hull.length * 0.4
  const hardpoints = []
  for (let i = 0; i < count; i++) {
    const missileChance = role === 'fighter' ? 0.4 : role === 'trader' ? 0.1 : 0.2
    const type = rng() < missileChance ? 'missile' : 'laser'
    const x =
      count === 1
        ? 0
        : (i % 2 === 0 ? -1 : 1) *
          range(rng, hull.stationWidths[2] * 0.3, hull.stationWidths[2] * 0.8) *
          (Math.floor(i / 2) + 1)
    hardpoints.push({ id: `hp${i + 1}`, position: [x, range(rng, 0, 0.4), zForward], type })
  }
  return hardpoints
}

// Shop floor for buyable hulls (hand-crafted Light Runner sits here; generated scale up).
export const MIN_SHIP_BUY_PRICE = 8500

function lerp(a, b, t) {
  return a + (b - a) * t
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t))
}

/**
 * Overall effectiveness score for a role — used so cheaper hulls never outclass
 * more expensive ones of the same role after balancing.
 */
export function shipPowerScore(shipClass) {
  const s = shipClass?.stats ?? {}
  const hps = Array.isArray(shipClass?.hardpoints) ? shipClass.hardpoints.length : 0
  const acc = Math.max(0, Math.floor(Number(shipClass?.accessorySlots) || 0))
  const drones = Math.max(0, Math.floor(Number(shipClass?.droneBays) || 0))
  const hull = Number(s.hull) || 0
  const armor = Number(s.armor) || 0
  const cargo = Number(s.cargoCapacity) || 0
  const mining = Number(s.miningCapacity) || 0
  const speed = Number(s.speed) || 0
  const turn = Number(s.turnRate) || 0
  const accel = Number(s.accel) || 0
  const role = shipClass?.role

  if (role === 'trader') {
    return cargo * 2.4 + hull * 0.7 + armor * 0.72 + mining * 0.12 + hps * 25 + acc * 15
  }
  if (role === 'fighter') {
    return (
      hull * 1.1 +
      armor * 1.25 +
      speed * 0.95 +
      turn * 42 +
      accel * 1.6 +
      hps * 55 +
      drones * 40 +
      cargo * 0.4
    )
  }
  if (role === 'explorer') {
    return (
      speed * 1.15 +
      turn * 38 +
      cargo * 1.35 +
      hull * 0.65 +
      accel * 1.1 +
      mining * 0.15 +
      hps * 35 +
      acc * 28 +
      drones * 30
    )
  }
  if (role === 'miner') {
    return mining * 1.55 + hull * 0.9 + armor * 0.68 + cargo * 0.8 + hps * 15 + drones * 25
  }
  return hull + armor + cargo + speed
}

/** Stats that scale when buffing/nerfing a hull toward price rank. */
function scalableStatKeys(role) {
  if (role === 'miner') return ['hull', 'armor']
  if (role === 'trader') return ['hull', 'armor', 'cargoCapacity']
  if (role === 'fighter') return ['hull', 'armor', 'speed', 'accel', 'turnRate']
  if (role === 'explorer') return ['hull', 'armor', 'speed', 'accel', 'turnRate', 'cargoCapacity']
  return ['hull', 'armor', 'speed', 'accel']
}

function scaleShipStats(shipClass, factor) {
  if (!shipClass?.stats || !(factor > 0) || Math.abs(factor - 1) < 0.001) return
  const keys = scalableStatKeys(shipClass.role)
  for (const key of keys) {
    const cur = Number(shipClass.stats[key])
    if (!Number.isFinite(cur)) continue
    if (key === 'turnRate') {
      shipClass.stats[key] = Number(Math.max(0.2, cur * factor).toFixed(2))
    } else {
      shipClass.stats[key] = Math.max(1, Math.round(cur * factor))
    }
  }
}

/**
 * Within each role, ensure power score is non-decreasing with list price.
 * Buffs weaker expensive hulls (and lightly nerfs overtuned cheap ones) so
 * "more credits → better ship" holds for purchasable classes.
 *
 * @param {object[]} classes full SHIP_CLASSES array (mutated in place)
 */
export function balancePurchasableShipsByRole(classes) {
  const byRole = new Map()
  for (const c of classes) {
    if (!c || c.npcOnly || c.alien) continue
    if (!Number.isFinite(c.price) || c.price <= 0) continue
    const role = c.role || 'trader'
    if (!byRole.has(role)) byRole.set(role, [])
    byRole.get(role).push(c)
  }

  for (const [, list] of byRole) {
    list.sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))
    // Forward pass: each ship must beat the previous on power.
    for (let i = 1; i < list.length; i++) {
      const prev = shipPowerScore(list[i - 1])
      let cur = shipPowerScore(list[i])
      if (cur >= prev * 1.01) continue
      // Same price band: allow tiny noise; only force strict order on price steps.
      if (list[i].price <= list[i - 1].price) continue
      const target = prev * 1.02
      if (cur < 1) cur = 1
      scaleShipStats(list[i], target / cur)
    }
    // Backward pass: if a cheap ship still outclasses a pricier one, pull it down.
    for (let i = list.length - 2; i >= 0; i--) {
      if (list[i].price >= list[i + 1].price) continue
      const next = shipPowerScore(list[i + 1])
      let cur = shipPowerScore(list[i])
      if (cur <= next * 0.99) continue
      const target = next * 0.97
      if (cur < 1) continue
      scaleShipStats(list[i], target / cur)
    }
  }
}

/**
 * Build stats from a 0–1 price tier so better stats cost more.
 * Soft independent noise is small enough that balancing still converges.
 */
function statsFromTier(rng, role, tier) {
  const ranges = ROLE_STAT_RANGES[role] ?? ROLE_STAT_RANGES.explorer
  const t0 = clamp01(tier)
  const stats = {}
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    // Per-stat jitter ±6% of the band — keeps individuality without inversions.
    const t = clamp01(t0 + range(rng, -0.06, 0.06))
    const val = lerp(lo, hi, t)
    stats[key] = key === 'turnRate' ? Number(val.toFixed(2)) : Math.round(val)
  }
  return stats
}

function priceFromTier(rng, role, tier) {
  const band = ROLE_PRICE_BANDS[role] ?? ROLE_PRICE_BANDS.explorer
  // Mild curve so top-tier hulls cost disproportionately more.
  const curved = Math.pow(clamp01(tier), 1.25)
  const base = lerp(band[0], band[1], curved)
  return Math.max(MIN_SHIP_BUY_PRICE, Math.round(base * range(rng, 0.97, 1.03)))
}

function accessorySlotsFromTier(rng, role, tier) {
  const opts = ROLE_ACCESSORY_SLOT_COUNTS[role] ?? ROLE_ACCESSORY_SLOT_COUNTS.explorer
  // Bias pick toward higher slot counts as tier rises.
  const idx = Math.min(opts.length - 1, Math.floor(clamp01(tier) * opts.length + range(rng, -0.15, 0.35)))
  return opts[Math.max(0, idx)]
}

function hardpointCountFromTier(rng, role, tier) {
  const [minCount, maxCount] = ROLE_HARDPOINT_COUNTS[role] ?? [1, 1]
  if (minCount >= maxCount) return minCount
  // High tier more often gets the max hardpoint count.
  return rng() < clamp01(tier) * 0.85 + 0.1 ? maxCount : minCount
}

const MINING_HOLD_ROLE_MULTIPLIER = {
  trader: 1.3,
  fighter: 0.6,
  explorer: 0.9,
  // Dedicated mining hulls set miningCapacity explicitly (200–2000); this
  // multiplier is only a fallback if a generated/modded miner lacks one.
  miner: 5.0
}
// 3× prior floor (was 30) — mining holds increased by 300% / triple.
const MINING_HOLD_MIN = 90

// Every ship has a dedicated mining hold for mined ore, sized off price and
// role (traders lean into hauling ore, fighters carry the least) and kept
// separate from cargoCapacity. The starter ship is hard-set below this floor
// in data/shipClasses.js, so it's always the smallest hold in the game.
// Hand-crafted miner hulls set miningCapacity explicitly (200–2000).
export function computeMiningCapacity(price, role) {
  // ×3 on the prior price formula (was price/500) so all ships triple together.
  const mult = MINING_HOLD_ROLE_MULTIPLIER[role] ?? 1
  return Math.max(MINING_HOLD_MIN, Math.round((price / 500) * mult * 3))
}

/**
 * @param {() => number} rng
 * @param {number} count
 * @param {{ priorHulls?: object[], priorNames?: string[] }} [opts]
 *   prior hand-crafted hulls/names to stay unique against
 */
export function generateShipClassRoster(rng, count, opts = {}) {
  const usedNames = new Set(opts.priorNames ?? [])
  const classes = []
  const priorHulls = [...(opts.priorHulls ?? [])]
  // Cycle archetypes so each role's variants are well covered.
  const archetypeCursor = { trader: 0, fighter: 0, explorer: 0 }
  // Per-role look keys — prefer unique engine/kit/plating combos within a role.
  const usedLooks = { trader: new Set(), fighter: new Set(), explorer: new Set() }

  function lookKey(hull) {
    const st = hull?.style ?? {}
    return [
      st.archetype ?? '',
      st.engineLayout ?? '',
      st.cockpitMount ?? 'top',
      st.platingStyle ?? '',
      Math.floor((st.visualKit ?? 0) / 4)
    ].join('|')
  }

  // Spread generated ships across price tiers so the catalogue isn't a pile of 8.5k clones.
  const roleTier = { trader: 0, fighter: 0, explorer: 0 }
  const roleCounts = { trader: 0, fighter: 0, explorer: 0 }
  // Pre-count roles for even tier spacing (second pass assignment uses live counters).
  const plannedRoles = []
  for (let i = 0; i < count; i++) {
    const role = pick(rng, ROLE_WEIGHTS)
    plannedRoles.push(role)
    roleCounts[role] = (roleCounts[role] ?? 0) + 1
  }

  for (let i = 0; i < count; i++) {
    const role = plannedRoles[i]
    const nRole = Math.max(1, roleCounts[role] ?? 1)
    const tierIndex = roleTier[role] ?? 0
    roleTier[role] = tierIndex + 1
    // Even spacing 0..1 within role, with light jitter.
    const tier = clamp01((tierIndex + 0.5) / nRole + range(rng, -0.04, 0.04))
    const stats = statsFromTier(rng, role, tier)
    const price = priceFromTier(rng, role, tier)

    const archetypes = ROLE_ARCHETYPES[role] ?? ROLE_ARCHETYPES.explorer
    const forced = archetypes[(archetypeCursor[role] ?? 0) % archetypes.length]
    archetypeCursor[role] = (archetypeCursor[role] ?? 0) + 1

    // Reject near-clones of prior / already-generated hulls.
    let hull = null
    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = generateHullSilhouette(
        rng,
        role,
        attempt < 10 ? forced : null
      )
      // Prefer larger hulls at higher tiers (visual cost cue).
      if (candidate && tier > 0.55) {
        candidate.length = Math.max(candidate.length, candidate.length * (0.95 + tier * 0.2))
      }
      const clash = priorHulls.some((h) => hullsTooSimilar(h, candidate))
      const look = lookKey(candidate)
      const lookClash = usedLooks[role]?.has(look)
      // Prefer unique looks; allow look reuse only after many failed attempts.
      if (!clash && (!lookClash || attempt >= 24)) {
        hull = candidate
        break
      }
    }
    if (!hull) hull = generateHullSilhouette(rng, role, forced)

    const [hueMin, hueMax] = ROLE_HUE_RANGES[role]
    const [satMin, satMax] = ROLE_SAT_RANGES[role]
    const [litMin, litMax] = ROLE_LIGHT_RANGES[role]
    // Spread hues across the full role window using visualKit + paint mode.
    const kit = hull.style.visualKit ?? 0
    const hueSpan = Math.max(1, hueMax - hueMin)
    const kitHue = hueMin + ((kit / 32) * hueSpan + range(rng, 0, hueSpan * 0.35)) % hueSpan
    const paintMode = rng()
    if (paintMode < 0.12) {
      // High-sat corporate livery accent.
      hull.color = hslToHex(kitHue, range(rng, 0.45, 0.72), range(rng, 0.38, 0.58))
    } else if (paintMode < 0.28) {
      // Near-mono industrial grey / slate.
      hull.color = hslToHex(kitHue, range(rng, 0.04, 0.14), range(rng, 0.3, 0.55))
    } else if (paintMode < 0.4) {
      // Dark hull with deep tone.
      hull.color = hslToHex(kitHue, range(rng, satMin, satMax), range(rng, 0.22, 0.4))
    } else {
      hull.color = hslToHex(kitHue, range(rng, satMin, satMax), range(rng, litMin, litMax))
    }

    const name = generateShipModelName(rng, usedNames)
    const id = `gen_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${i}`
    stats.miningCapacity = computeMiningCapacity(price, role)
    const hpCount = hardpointCountFromTier(rng, role, tier)

    priorHulls.push(hull)
    usedLooks[role]?.add(lookKey(hull))
    classes.push({
      id,
      name,
      role,
      price,
      stats,
      hardpoints: generateHardpoints(rng, role, hull, hpCount),
      accessorySlots: accessorySlotsFromTier(rng, role, tier),
      // Occasional drone bay on high-tier fighters / explorers only.
      droneBays:
        (role === 'fighter' || role === 'explorer') && tier > 0.72 && rng() < 0.35
          ? 1
          : 0,
      hull
    })
  }
  return classes
}
