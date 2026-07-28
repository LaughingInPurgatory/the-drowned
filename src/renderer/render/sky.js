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
const DAY_START_PHASE = 0.32
/** The sun's arc tilts off vertical so it tracks across the sky rather than over it. */
const SUN_TILT = 0.42

/**
 * Palette keyframes by sun elevation (-1 below, +1 overhead). Between these the
 * values are interpolated, so dawn and dusk get their colour for free rather
 * than needing their own branch.
 */
const KEYS = [
  {
    // Deep night. Not black — an overcast sea at night still carries some light.
    at: -0.35,
    zenith: 0x080e1c,
    horizon: 0x141c28,
    fog: 0x151d29,
    fogDensity: 0.00042,
    sun: 0x9fb4d8,
    sunIntensity: 0.16,
    hemiSky: 0x2b3850,
    hemiGround: 0x0e1518,
    hemiIntensity: 0.42,
    env: 0.25,
    seaDeep: 0x050a10,
    seaCrest: 0x0d1a24,
    cloud: 0x2a3547,
    cloudLit: 0x3d4a60,
    stars: 1
  },
  {
    // First light / last light. The horizon burns and the zenith stays cold.
    at: 0.02,
    zenith: 0x2c3a5e,
    horizon: 0xc06a3c,
    fog: 0x8a6a58,
    fogDensity: 0.00036,
    sun: 0xff9a55,
    sunIntensity: 1.3,
    hemiSky: 0x6a5f72,
    hemiGround: 0x241f1c,
    hemiIntensity: 0.8,
    env: 0.7,
    seaDeep: 0x0d1116,
    seaCrest: 0x33302e,
    cloud: 0x6d5566,
    cloudLit: 0xffb079,
    stars: 0.35
  },
  {
    // Low sun. The dust in the air is doing most of the work.
    at: 0.22,
    zenith: 0x4a6f96,
    horizon: 0xcfa87e,
    fog: 0xa89880,
    fogDensity: 0.0003,
    sun: 0xffd0a0,
    sunIntensity: 2.0,
    hemiSky: 0x93a2b8,
    hemiGround: 0x2c332e,
    hemiIntensity: 1.0,
    env: 0.9,
    seaDeep: 0x0c161a,
    seaCrest: 0x25423d,
    cloud: 0x9a94a0,
    cloudLit: 0xffe0c0,
    stars: 0
  },
  {
    // Full day. Bleached and dust-loaded — a damaged atmosphere, not a holiday.
    at: 0.75,
    zenith: 0x3f6d92,
    horizon: 0xb9b09c,
    fog: 0x9aa096,
    fogDensity: 0.00027,
    sun: 0xfff0d8,
    sunIntensity: 2.4,
    hemiSky: 0xa9bccd,
    hemiGround: 0x2b3a33,
    hemiIntensity: 1.15,
    env: 1.0,
    seaDeep: 0x0d1a1c,
    seaCrest: 0x27453f,
    cloud: 0xb9bcc0,
    cloudLit: 0xfff4e2,
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
  starOpacity: 0,
  isNight: false
}

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

/**
 * Sky dome + cloud deck + stars, as one shader.
 *
 * The clouds are a drifting FBM sampled on a plane above the viewer, which is
 * what makes them read as a deck at altitude rather than a texture painted on
 * the inside of a dome. They are lit from the sun direction, so at dawn they
 * catch it on one side exactly as the sea does.
 */
export const SKY_SHADER = {
  vertex: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragment: `
    varying vec3 vDir;
    uniform vec3 uSunDir;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uCloudColor;
    uniform vec3 uCloudLit;
    uniform float uCloudCover;
    uniform float uStars;
    uniform float uTime;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float valueNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i);
      float b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0));
      float d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 5; i++) {
        v += amp * valueNoise(p);
        p = p * 2.03 + vec2(17.3, 9.1);
        amp *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 d = normalize(vDir);
      // Steep falloff so the haze band hugs the horizon instead of washing
      // halfway up the dome.
      vec3 c = mix(uHorizon, uZenith, pow(max(d.y, 0.0), 0.42));

      // Stars, before the clouds so the deck occludes them.
      if (uStars > 0.001 && d.y > 0.0) {
        vec2 sp = d.xz / max(d.y * 0.6 + 0.4, 0.05);
        vec2 cell = floor(sp * 90.0);
        float star = hash21(cell);
        if (star > 0.988) {
          float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + star * 90.0);
          c += vec3(0.85, 0.9, 1.0) * (star - 0.988) * 70.0 * twinkle * uStars * smoothstep(0.0, 0.25, d.y);
        }
      }

      // Cloud deck: project the view ray toward a deck overhead and sample a
      // drifting FBM there. A true plane projection (d.xz / d.y) blows up at the
      // horizon, and from a boat almost everything you look at *is* near the
      // horizon — the softened denominator keeps cells finite down to the
      // skyline, which is where the clouds actually need to be.
      float horizonFade = smoothstep(0.005, 0.09, d.y);
      if (horizonFade > 0.001) {
        vec2 plane = d.xz / (d.y + 0.30);
        vec2 cp = plane * 1.6 + vec2(uTime * 0.006, uTime * 0.0032);
        float n = fbm(cp);
        // Second, slower layer so the deck has depth rather than one flat mask.
        float n2 = fbm(cp * 0.42 + vec2(uTime * 0.0022, -uTime * 0.0014));
        n = mix(n, n2, 0.4);
        // Thicker toward the horizon, where you are looking through more of the
        // deck — the same reason real cloud reads as a band low down.
        float thickness = mix(1.25, 0.9, smoothstep(0.05, 0.6, d.y));
        float cover = smoothstep(uCloudCover, uCloudCover + 0.20, n * thickness) * horizonFade;
        // Lit from the sun side: sample slightly toward the sun and use the
        // difference as a crude self-shadow, which is what gives them relief.
        float toward = fbm(cp + normalize(uSunDir.xz + vec2(0.001)) * 0.4);
        float lit = clamp((n - toward) * 3.0 + 0.5, 0.0, 1.0);
        vec3 cloud = mix(uCloudColor, uCloudLit, lit);
        c = mix(c, cloud, cover * 0.92);
      }

      // Below the horizon the sea covers this, but the PMREM bake samples it
      // for the underside of every hull — keep it dull, not black.
      c = mix(vec3(0.05, 0.06, 0.06), c, smoothstep(-0.12, 0.03, d.y));

      float sd = max(dot(d, uSunDir), 0.0);
      // The disc only shows above the horizon.
      float up = smoothstep(-0.06, 0.04, uSunDir.y);
      c += vec3(1.0, 0.88, 0.66) * pow(sd, 250.0) * 5.0 * up;
      c += vec3(0.85, 0.72, 0.52) * pow(sd, 6.0) * 0.30 * up;
      gl_FragColor = vec4(c, 1.0);
    }`
}

export function skyUniforms() {
  const day = daylightAt(0)
  return {
    uSunDir: { value: day.sunDirection.clone() },
    uZenith: { value: day.zenith.clone() },
    uHorizon: { value: day.horizon.clone() },
    uCloudColor: { value: day.cloudColor.clone() },
    uCloudLit: { value: day.cloudLit.clone() },
    // Higher = less cloud. Broken cover suits a wrecked sky.
    uCloudCover: { value: 0.52 },
    uStars: { value: day.starOpacity },
    uTime: { value: 0 }
  }
}
