import * as THREE from 'three'

/**
 * Time of day.
 *
 * One shared clock drives the sun's position, the sky gradient, the cloud deck,
 * the fog, the key light and the water's colour. Everything that needs to know
 * what time it is calls `daylightAt(t)` and reads the same answer, so the sun
 * cannot be setting in the sky while the sea is still lit for noon.
 */

/** Seconds for a full day + night. Long enough to notice, short enough to see. */
export const DAY_LENGTH_S = 1500
/** Where in the cycle a new game opens — mid-morning, so the first voyage is lit. */
// Start mid-morning. A new game used to open at 21:21 — a black sea and a
// black sky, which is a poor first thing to see and made the title screen look
// broken rather than atmospheric.
const DAY_START_PHASE = 0.2
/** The sun's arc tilts off vertical so it tracks across the sky rather than over it. */
const SUN_TILT = 0.42

/**
 * Palette keyframes by sun elevation (-1 below, +1 overhead). Between these the
 * values are interpolated, so dawn and dusk get their colour for free rather
 * than needing their own branch.
 *
 * Tuned for a damaged post-nuclear sky: deep zenith blues by day (not holiday
 * postcard cyan), dusty warm horizons.
 *
 * Twilight is deliberately stretched. The keys between elevation -0.03 and
 * -0.52 cover what is really the first 18° below the horizon, i.e. about 70
 * minutes at this latitude — but the day here is 1500 s, so honestly-placed
 * keys would give a dusk lasting five seconds and the sky would snap from
 * sunset to a full star field. Spreading the blue hour across a third of the
 * sun's downward arc is what buys an evening you can actually sail through.
 * `stars` rides the same curve: zero while the sky is still bright, then in
 * gradually, so the field arrives brightest-first rather than all at once.
 */
const KEYS = [
  {
    // Deep night. Moon and starlight only.
    at: -0.72,
    zenith: 0x02040b,
    horizon: 0x070c17,
    fog: 0x080d17,
    fogDensity: 0.00038,
    sun: 0x9fb4d8,
    sunIntensity: 0.13,
    hemiSky: 0x18212f,
    hemiGround: 0x070a0e,
    hemiIntensity: 0.33,
    env: 0.19,
    seaDeep: 0x02070e,
    seaCrest: 0x081625,
    cloud: 0x0c1119,
    cloudLit: 0x222c3b,
    stars: 1
  },
  {
    // Astronomical twilight. Night everywhere but a cold floor low in the west,
    // and the first of the faint stars are still arriving.
    at: -0.52,
    zenith: 0x040915,
    horizon: 0x0b1730,
    fog: 0x0a1426,
    fogDensity: 0.00037,
    sun: 0x8291bc,
    sunIntensity: 0.17,
    hemiSky: 0x1d2b45,
    hemiGround: 0x090d13,
    hemiIntensity: 0.37,
    env: 0.23,
    seaDeep: 0x030a15,
    seaCrest: 0x0c1d31,
    cloud: 0x111726,
    cloudLit: 0x2b3750,
    stars: 0.8
  },
  {
    // Late nautical twilight. Deep saturated blue still owns the whole dome;
    // the horizon keeps a thin cold glow where the sun went down.
    at: -0.34,
    zenith: 0x061033,
    horizon: 0x142250,
    fog: 0x111e40,
    fogDensity: 0.00036,
    sun: 0x6c7cb4,
    sunIntensity: 0.3,
    hemiSky: 0x2b3b68,
    hemiGround: 0x0d1118,
    hemiIntensity: 0.46,
    env: 0.33,
    seaDeep: 0x040f20,
    seaCrest: 0x112742,
    cloud: 0x18223e,
    cloudLit: 0x445074,
    stars: 0.45
  },
  {
    // The blue hour. Cobalt overhead running down to a warm ember, with the
    // Belt of Venus between them. This is the frame the evening exists for, so
    // it is held far longer in sun elevation than the real thing — on a 25
    // minute day a physically honest dusk is over in seconds.
    at: -0.2,
    zenith: 0x0d2a6e,
    horizon: 0x6e3a56,
    fog: 0x2c2440,
    fogDensity: 0.00035,
    sun: 0xa8688c,
    sunIntensity: 0.46,
    hemiSky: 0x3d4c7c,
    hemiGround: 0x11131c,
    hemiIntensity: 0.54,
    env: 0.4,
    seaDeep: 0x051228,
    seaCrest: 0x172f52,
    cloud: 0x232a48,
    cloudLit: 0x8c5a72,
    stars: 0.15
  },
  {
    // Civil twilight. Rich blue zenith, magenta belt, hot ember on the skyline.
    at: -0.1,
    zenith: 0x14418c,
    horizon: 0xa8523e,
    fog: 0x5c3840,
    fogDensity: 0.00034,
    sun: 0xe0784c,
    sunIntensity: 0.85,
    hemiSky: 0x556090,
    hemiGround: 0x1a1618,
    hemiIntensity: 0.62,
    env: 0.54,
    seaDeep: 0x071626,
    seaCrest: 0x1e3a58,
    cloud: 0x33304a,
    cloudLit: 0xc0704e,
    stars: 0.03
  },
  {
    // Afterglow at its brightest — the horizon burns and the zenith is still a
    // proper daylight blue. No stars yet; the sky is far too bright for them.
    at: -0.03,
    zenith: 0x1e5aa4,
    horizon: 0xe07434,
    fog: 0x936050,
    fogDensity: 0.00034,
    sun: 0xff9046,
    sunIntensity: 1.35,
    hemiSky: 0x6d7c9c,
    hemiGround: 0x261f1a,
    hemiIntensity: 0.7,
    env: 0.68,
    seaDeep: 0x0a1a2a,
    seaCrest: 0x28485f,
    cloud: 0x3d3546,
    cloudLit: 0xf08a54,
    stars: 0
  },
  {
    // First light / last light. Horizon burns; zenith stays cold.
    // Stronger key vs fill so long golden shadows and wet-plate rims read.
    at: 0.04,
    zenith: 0x2166a8,
    horizon: 0xe07830,
    fog: 0xa06848,
    fogDensity: 0.00034,
    sun: 0xff9440,
    sunIntensity: 1.65,
    hemiSky: 0x6a6474,
    hemiGround: 0x2a221c,
    hemiIntensity: 0.72,
    env: 0.78,
    seaDeep: 0x0a1522,
    seaCrest: 0x2c3c4e,
    cloud: 0x3e303c,
    cloudLit: 0xff9a58,
    stars: 0
  },
  {
    // Low sun. Dust in the air does most of the work — warm band, still a
    // real blue overhead. Directional punch for harbour contact shadows.
    at: 0.22,
    zenith: 0x2a6a9c,
    horizon: 0xd8a070,
    fog: 0xa89078,
    fogDensity: 0.00029,
    sun: 0xffd0a0,
    sunIntensity: 2.4,
    hemiSky: 0x8ea6bc,
    hemiGround: 0x36483e,
    hemiIntensity: 0.78,
    env: 1.05,
    seaDeep: 0x081c2e,
    seaCrest: 0x1c4c66,
    // Darker body + warm lit face so the deck reads volume, not cotton.
    cloud: 0x524e60,
    cloudLit: 0xffd4a8,
    stars: 0
  },
  {
    // Full day. Saturated zenith blue, dusty warm horizon — not holiday cyan,
    // not overcast grey. Lower hemi + hotter key for directional wet metal.
    // Cloud body stays slate so undersides can go dark.
    at: 0.75,
    zenith: 0x1470b0,
    // Dusty, but not golden. A yellow-green horizon at noon plus a warm fog
    // reads as late afternoon in every screenshot; the haze here is airborne
    // dust over water, which scatters pale and slightly cool, not tan.
    horizon: 0xa6b3b4,
    fog: 0x93a1a0,
    fogDensity: 0.00024,
    sun: 0xfff0d8,
    sunIntensity: 3.0,
    hemiSky: 0x96b4c8,
    hemiGround: 0x364c44,
    hemiIntensity: 0.72,
    env: 1.18,
    seaDeep: 0x0a2136,
    seaCrest: 0x216580,
    cloud: 0x4e5a68,
    cloudLit: 0xf8f4ea,
    stars: 0
  }
]

const _a = new THREE.Color()
const _b = new THREE.Color()

function lerpKeys(elevation) {
  let lo = KEYS[0]
  let hi = KEYS[KEYS.length - 1]
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (elevation >= KEYS[i].at && elevation <= KEYS[i + 1].at) {
      lo = KEYS[i]
      hi = KEYS[i + 1]
      break
    }
  }
  if (elevation < KEYS[0].at) return { lo: KEYS[0], hi: KEYS[0], t: 0 }
  if (elevation > hi.at && hi === KEYS[KEYS.length - 1]) {
    return { lo: hi, hi, t: 0 }
  }
  const span = hi.at - lo.at
  return { lo, hi, t: span > 1e-6 ? (elevation - lo.at) / span : 0 }
}

function mixColor(out, a, b, t) {
  _a.setHex(a)
  _b.setHex(b)
  return out.copy(_a).lerp(_b, t)
}

function mixNum(a, b, t) {
  return a + (b - a) * t
}

/** Reusable result — copy anything you need to keep. */
const _out = {
  phase: 0,
  elevation: 0,
  sunDirection: new THREE.Vector3(),
  zenith: new THREE.Color(),
  horizon: new THREE.Color(),
  fog: new THREE.Color(),
  fogDensity: 0,
  sunColor: new THREE.Color(),
  sunIntensity: 0,
  hemiSky: new THREE.Color(),
  hemiGround: new THREE.Color(),
  hemiIntensity: 0,
  envIntensity: 0,
  seaDeep: new THREE.Color(),
  seaCrest: new THREE.Color(),
  cloudColor: new THREE.Color(),
  cloudLit: new THREE.Color(),
  moonDirection: new THREE.Vector3(),
  /** 0 new, 1 full — drives the lit fraction of the disc. */
  moonPhase: 1,
  starOpacity: 0,
  isNight: false
}

/**
 * The moon runs on its own, slightly longer period.
 *
 * Pinning it exactly opposite the sun would be simpler, but then it is always
 * full and always rises at sunset, and you would never see it in daylight. A
 * period a few percent off the sun's makes it drift through its phases and
 * through the day over a campaign, which is free variety from one constant.
 */
const MOON_PERIOD_RATIO = 1.09
/** The moon's orbit is tilted differently from the sun's, so tracks differ. */
const MOON_TILT = 0.55

/**
 * The whole sky at time `t` (seconds of campaign time).
 * @returns the shared result object above.
 */
export function daylightAt(t) {
  const phase = (((t / DAY_LENGTH_S) + DAY_START_PHASE) % 1 + 1) % 1
  const angle = phase * Math.PI * 2

  // The sun rises in the east, crosses tilted off vertical, sets in the west.
  const elevation = Math.sin(angle)
  const across = Math.cos(angle)
  _out.sunDirection.set(across * Math.cos(SUN_TILT), elevation, across * Math.sin(SUN_TILT))
  if (_out.sunDirection.lengthSq() < 1e-8) _out.sunDirection.set(0, 1, 0)
  _out.sunDirection.normalize()

  // Moon: its own slower circuit, on a differently tilted track.
  const moonAngle = phase * Math.PI * 2 / MOON_PERIOD_RATIO + Math.PI
  _out.moonDirection
    .set(
      Math.cos(moonAngle) * Math.cos(MOON_TILT),
      Math.sin(moonAngle),
      Math.cos(moonAngle) * Math.sin(MOON_TILT)
    )
    .normalize()
  // Illuminated fraction is just how opposed the moon is to the sun.
  _out.moonPhase = 0.5 - 0.5 * _out.moonDirection.dot(_out.sunDirection)

  const { lo, hi, t: k } = lerpKeys(elevation)
  _out.phase = phase
  _out.elevation = elevation
  mixColor(_out.zenith, lo.zenith, hi.zenith, k)
  mixColor(_out.horizon, lo.horizon, hi.horizon, k)
  mixColor(_out.fog, lo.fog, hi.fog, k)
  _out.fogDensity = mixNum(lo.fogDensity, hi.fogDensity, k)
  mixColor(_out.sunColor, lo.sun, hi.sun, k)
  _out.sunIntensity = mixNum(lo.sunIntensity, hi.sunIntensity, k)
  mixColor(_out.hemiSky, lo.hemiSky, hi.hemiSky, k)
  mixColor(_out.hemiGround, lo.hemiGround, hi.hemiGround, k)
  _out.hemiIntensity = mixNum(lo.hemiIntensity, hi.hemiIntensity, k)
  _out.envIntensity = mixNum(lo.env, hi.env, k)
  mixColor(_out.seaDeep, lo.seaDeep, hi.seaDeep, k)
  mixColor(_out.seaCrest, lo.seaCrest, hi.seaCrest, k)
  mixColor(_out.cloudColor, lo.cloud, hi.cloud, k)
  mixColor(_out.cloudLit, lo.cloudLit, hi.cloudLit, k)
  _out.starOpacity = mixNum(lo.stars, hi.stars, k)
  _out.isNight = elevation < 0
  return _out
}

/** Rough clock reading for the HUD — "06:24" style. */
export function clockLabel(t) {
  const phase = (((t / DAY_LENGTH_S) + DAY_START_PHASE) % 1 + 1) % 1
  // Phase 0 is sunrise; shift so 06:00 lines up with it.
  const hours = (phase * 24 + 6) % 24
  const h = Math.floor(hours)
  const m = Math.floor((hours - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// The GLSL sky dome that used to live here is gone. WebGPURenderer cannot
// compile a custom GLSL ShaderMaterial, so it had been dead since the port —
// nothing imported SKY_SHADER or skyUniforms(). The live sky is
// render/skyNodeMaterial.js (TSL). Its 'night nebulae / cosmic dust' section
// went with it; a flooded Earth gets a milky way, not a sci-fi skybox.
