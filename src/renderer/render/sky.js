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
 */
const KEYS = [
  {
    // Deep night. Thin, damaged atmosphere — dark enough for cosmic colour
    // (nebulae / dust) to read through the tears, not a pure black void.
    at: -0.35,
    zenith: 0x060a16,
    horizon: 0x121820,
    fog: 0x121820,
    fogDensity: 0.0004,
    sun: 0x9fb4d8,
    sunIntensity: 0.16,
    hemiSky: 0x283448,
    hemiGround: 0x0c1014,
    hemiIntensity: 0.4,
    env: 0.25,
    seaDeep: 0x040b18,
    seaCrest: 0x0d2136,
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
    seaDeep: 0x0a1522,
    seaCrest: 0x2c3c4e,
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
    seaDeep: 0x081c2e,
    seaCrest: 0x1c4c66,
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
    seaDeep: 0x0a2136,
    seaCrest: 0x216580,
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

/**
 * Sky dome + cloud deck + stars + night nebulae / cosmic dust, as one shader.
 *
 * The clouds are a drifting FBM sampled on a plane above the viewer, which is
 * what makes them read as a deck at altitude rather than a texture painted on
 * the inside of a dome. They are lit from the sun direction, so at dawn they
 * catch it on one side exactly as the sea does.
 *
 * At night the damaged atmosphere opens onto space: soft multi-hue nebulae,
 * a faint galactic band, and brown dust lanes that eat stars — all driven by
 * `uStars` so they clear with the dawn.
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
    uniform vec3 uMoonDir;
    uniform float uMoonPhase;
    uniform vec3 uZenith;
    uniform vec3 uHorizon;
    uniform vec3 uCloudColor;
    uniform vec3 uCloudLit;
    uniform float uCloudCover;
    uniform float uStars;
    uniform float uTime;

    // Angular radii, radians. Both are several times life-size: the real sun
    // and moon subtend about half a degree, which at this field of view is a
    // handful of pixels and reads as a blemish rather than a body.
    #define SUN_ANGULAR_RADIUS 0.030
    #define MOON_ANGULAR_RADIUS 0.038

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

      // How much of the sky is open to space (night / twilight). Zero by day.
      float openSky = uStars * smoothstep(0.0, 0.18, d.y);
      float dustLane = 0.0;

      // --- Damaged atmosphere: nebulae + cosmic dust -----------------------
      // Soft multi-hue gas and dark dust lanes, only when day has thinned
      // enough for the stars. FBM on the dome so it turns with the view.
      if (openSky > 0.02) {
        vec2 sp = d.xz / max(d.y * 0.55 + 0.38, 0.08);

        // Large, slow nebula fields.
        float n1 = fbm(sp * 0.48 + vec2(uTime * 0.0009, -uTime * 0.00055));
        float n2 = fbm(sp * 1.05 + vec2(13.7, 5.1) - vec2(uTime * 0.0004, uTime * 0.00025));
        float n3 = fbm(sp * 2.2 + 29.4);
        float nebMask = smoothstep(0.46, 0.74, n1 * 0.62 + n2 * 0.38);
        nebMask *= smoothstep(0.02, 0.28, d.y);
        float filaments = smoothstep(0.35, 0.8, n3);
        nebMask *= 0.45 + filaments * 0.55;

        // Magenta / cyan gas with dusty amber veins (torn upper air + ion glow).
        vec3 nebViolet = vec3(0.52, 0.16, 0.68);
        vec3 nebCyan = vec3(0.10, 0.42, 0.78);
        vec3 nebAmber = vec3(0.58, 0.30, 0.12);
        float hue = smoothstep(0.28, 0.72, n2);
        float warm = smoothstep(0.4, 0.78, n3);
        vec3 nebCol = mix(mix(nebViolet, nebCyan, hue), nebAmber, warm * 0.4);
        c += nebCol * nebMask * openSky * 0.42 * (0.55 + n3 * 0.55);

        // Faint galactic band — denser stars/gas scar across the dome.
        float bandAxis = sp.x * 0.38 + sp.y * 0.72;
        float band = exp(-bandAxis * bandAxis * 5.5);
        float bandGrain = fbm(sp * 3.4 + vec2(uTime * 0.0003, 8.2));
        float milky = band * smoothstep(0.28, 0.7, bandGrain);
        c += vec3(0.42, 0.48, 0.72) * milky * openSky * 0.28;
        // Dusty core of the band (darker lane down the middle).
        float rift = band * smoothstep(0.55, 0.2, abs(bandAxis) * 3.5 + bandGrain * 0.3);
        c = mix(c, c * vec3(0.55, 0.5, 0.48), rift * openSky * 0.55);

        // Cosmic dust lanes — brown/grey veils that eat light and stars.
        float dust = fbm(sp * 0.85 + vec2(-uTime * 0.00065, uTime * 0.0004));
        float dustFine = fbm(sp * 2.6 + 17.0);
        dustLane = smoothstep(0.44, 0.8, dust) * (0.5 + dustFine * 0.5);
        dustLane *= mix(0.35, 1.0, nebMask * 0.5 + milky * 0.6);
        dustLane *= smoothstep(0.0, 0.15, d.y);
        vec3 dustCol = vec3(0.16, 0.12, 0.1);
        c = mix(c, dustCol, dustLane * openSky * 0.62);

        // Sparse particulate glitter (high-altitude dust catching starlight).
        vec2 gritCell = floor(sp * 160.0);
        float grit = hash21(gritCell);
        if (grit > 0.9935) {
          vec2 gj = vec2(hash21(gritCell + 2.1), hash21(gritCell + 7.9));
          float gdist = length(fract(sp * 160.0) - gj);
          float speck = smoothstep(0.28, 0.0, gdist);
          c += vec3(0.75, 0.68, 0.55) * speck * (grit - 0.9935) * 55.0 * openSky * 0.2;
        }
      }

      // Stars after nebulae/dust so dust lanes thin them and gas sits behind.
      // Clouds still occlude them later.
      if (uStars > 0.001 && d.y > 0.0) {
        vec2 sp = d.xz / max(d.y * 0.6 + 0.4, 0.05);
        float starVis = (1.0 - dustLane * 0.85) * uStars;
        vec2 grid = sp * 90.0;
        vec2 cell = floor(grid);
        float star = hash21(cell);
        if (star > 0.988 && starVis > 0.02) {
          // Put the star at a random point *inside* its cell and fall off with
          // distance from it. Lighting the whole cell — which is what this used
          // to do — draws every star as a square, and at this cell size they
          // are unmistakably squares.
          vec2 jitter = vec2(hash21(cell + 3.7), hash21(cell + 11.3));
          float dist = length(fract(grid) - jitter);
          float point = smoothstep(0.34, 0.0, dist);
          float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + star * 90.0);
          // Slight colour variety — not all ice-white.
          vec3 starTint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash21(cell + 19.0));
          c += starTint * (star - 0.988) * 70.0 * point * twinkle * starVis
             * smoothstep(0.0, 0.25, d.y);
        }
        // Denser field of dimmer background stars when the sky is fully open.
        if (starVis > 0.4) {
          vec2 grid2 = sp * 160.0;
          vec2 cell2 = floor(grid2);
          float s2 = hash21(cell2 + 41.0);
          if (s2 > 0.994) {
            vec2 j2 = vec2(hash21(cell2 + 1.3), hash21(cell2 + 5.7));
            float p2 = smoothstep(0.22, 0.0, length(fract(grid2) - j2));
            c += vec3(0.7, 0.78, 1.0) * p2 * (s2 - 0.994) * 35.0 * starVis
               * smoothstep(0.05, 0.35, d.y);
          }
        }
      }

      // Cloud deck: project the view ray toward a deck overhead and sample a
      // drifting FBM there. A true plane projection (d.xz / d.y) blows up at the
      // horizon, and from a boat almost everything you look at *is* near the
      // horizon — the softened denominator keeps cells finite down to the
      // skyline, which is where the clouds actually need to be.
      float cloudVeil = 0.0;
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
        cloudVeil = cover;
      }

      // Below the horizon the sea covers this, but the PMREM bake samples it
      // for the underside of every hull — keep it dull, not black.
      c = mix(vec3(0.05, 0.06, 0.06), c, smoothstep(-0.12, 0.03, d.y));

      // --- Sun and moon ------------------------------------------------
      // Drawn after the cloud deck and veiled by it rather than hidden behind
      // it. Physically a thick overcast does hide the sun completely, but this
      // sky is broken cover most of the time and a sun you can never actually
      // find is worse than a slightly too persistent one — so cloud dims the
      // discs rather than erasing them.
      float discVeil = 1.0 - cloudVeil * 0.72;

      // Sun: a hard-edged disc with a hot core. Bigger than the real thing's
      // half-degree — at that size it is a couple of pixels and reads as a
      // stuck highlight rather than a sun.
      float sunUp = smoothstep(-0.03, 0.05, uSunDir.y);
      if (sunUp > 0.001) {
        float sunCos = dot(d, uSunDir);
        float sunEdge = cos(SUN_ANGULAR_RADIUS);
        float disc = smoothstep(sunEdge - 0.0016, sunEdge + 0.0008, sunCos);
        // Warmer and dimmer near the horizon — the same reddening the palette
        // does to everything else at dawn and dusk.
        vec3 low = vec3(1.0, 0.52, 0.24);
        vec3 high = vec3(1.0, 0.97, 0.90);
        vec3 sunTint = mix(low, high, smoothstep(0.0, 0.35, uSunDir.y));
        c = mix(c, sunTint * 2.6, disc * sunUp * discVeil);
      }

      // Moon: a disc with a terminator and some mare blotching, brightest at
      // night but not hidden by day — a moon in a daylit sky is a real sight
      // and costs nothing here.
      float moonUp = smoothstep(-0.03, 0.05, uMoonDir.y);
      if (moonUp > 0.001) {
        float moonCos = dot(d, uMoonDir);
        float moonEdge = cos(MOON_ANGULAR_RADIUS);
        float disc = smoothstep(moonEdge - 0.0014, moonEdge + 0.0006, moonCos);
        if (disc > 0.001) {
          // Local frame on the disc so the terminator and the mare can be
          // placed in surface coordinates rather than screen ones.
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
          vec3 upv = cross(uMoonDir, right);
          vec2 sp = vec2(dot(d, right), dot(d, upv)) / MOON_ANGULAR_RADIUS;
          // Terminator: the lit edge faces the sun.
          float toSun = dot(normalize(uSunDir - uMoonDir * dot(uSunDir, uMoonDir)), right);
          float limb = smoothstep(-0.25, 0.35, sp.x * sign(toSun) + (uMoonPhase * 2.0 - 1.0));
          // Mare: low-frequency blotches, plus a little fine grain.
          float mare = fbm(sp * 1.6 + 31.7);
          float shade = mix(0.62, 1.0, smoothstep(0.35, 0.72, mare));
          // Darken toward the limb so it reads as a sphere, not a coin.
          float sphere = sqrt(max(0.0, 1.0 - min(1.0, dot(sp, sp))));
          vec3 moonCol = vec3(0.86, 0.87, 0.82) * shade * (0.55 + 0.45 * sphere);
          // Bright at night, washed out in a bright sky.
          float vis = mix(0.55, 1.0, uStars);
          c = mix(c, moonCol * 1.5, disc * moonUp * limb * vis * discVeil);
        }
      }

      float sd = max(dot(d, uSunDir), 0.0);
      // The disc only shows above the horizon.
      float up = smoothstep(-0.06, 0.04, uSunDir.y);
      // Atmospheric glow around the sun. Deliberately tighter than it was:
      // a wide soft halo plus bloom swallowed the disc completely and left one
      // featureless white blob where the sun should be.
      c += vec3(1.0, 0.88, 0.66) * pow(sd, 420.0) * 3.0 * up;
      c += vec3(0.85, 0.72, 0.52) * pow(sd, 22.0) * 0.16 * up;
      gl_FragColor = vec4(c, 1.0);
    }`
}

export function skyUniforms() {
  const day = daylightAt(0)
  return {
    uSunDir: { value: day.sunDirection.clone() },
    uMoonDir: { value: day.moonDirection.clone() },
    uMoonPhase: { value: day.moonPhase },
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
