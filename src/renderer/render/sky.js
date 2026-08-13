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
 * Two palettes only. Dawn and dusk are a brightness fade, not a colour show —
 * no orange belt, no magenta blue hour. `dayAmount(elevation)` is the single
 * mix (1 = noon, 0 = night).
 */
const NIGHT = {
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
  cloudLit: 0x222c3b
}

const DAY = {
  zenith: 0x1470b0,
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
  cloudLit: 0xf8f4ea
}

const _a = new THREE.Color()
const _b = new THREE.Color()

/** 1 at full day, 0 at full night. Smooth across the horizon, no colour keys. */
export function dayAmountFromElevation(elevation) {
  const t = Math.min(1, Math.max(0, (elevation + 0.18) / 0.46))
  return t * t * (3 - 2 * t)
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
  isNight: false,
  dayAmount: 1
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

  const k = dayAmountFromElevation(elevation)
  _out.phase = phase
  _out.elevation = elevation
  _out.dayAmount = k
  mixColor(_out.zenith, NIGHT.zenith, DAY.zenith, k)
  mixColor(_out.horizon, NIGHT.horizon, DAY.horizon, k)
  mixColor(_out.fog, NIGHT.fog, DAY.fog, k)
  _out.fogDensity = mixNum(NIGHT.fogDensity, DAY.fogDensity, k)
  mixColor(_out.sunColor, NIGHT.sun, DAY.sun, k)
  _out.sunIntensity = mixNum(NIGHT.sunIntensity, DAY.sunIntensity, k)
  mixColor(_out.hemiSky, NIGHT.hemiSky, DAY.hemiSky, k)
  mixColor(_out.hemiGround, NIGHT.hemiGround, DAY.hemiGround, k)
  _out.hemiIntensity = mixNum(NIGHT.hemiIntensity, DAY.hemiIntensity, k)
  _out.envIntensity = mixNum(NIGHT.env, DAY.env, k)
  mixColor(_out.seaDeep, NIGHT.seaDeep, DAY.seaDeep, k)
  mixColor(_out.seaCrest, NIGHT.seaCrest, DAY.seaCrest, k)
  mixColor(_out.cloudColor, NIGHT.cloud, DAY.cloud, k)
  mixColor(_out.cloudLit, NIGHT.cloudLit, DAY.cloudLit, k)
  _out.starOpacity = (1 - k) * (1 - k)
  _out.isNight = k < 0.5
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
// render/skyNodeMaterial.js (TSL), including the restrained damaged-atmosphere
// haze that sits in the star field rather than the lower cloud layers.
