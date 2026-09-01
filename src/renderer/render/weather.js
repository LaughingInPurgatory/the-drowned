import * as THREE from 'three/webgpu'
import {
  uniform,
  vec4,
  vec3,
  vec2,
  Fn,
  float,
  uv,
  mix,
  sin,
  cos,
  abs,
  exp,
  pow,
  max,
  min,
  fract,
  floor,
  length,
  smoothstep,
  clamp,
  attribute,
  oneMinus,
  negate,
  texture,
  screenUV
} from 'three/tsl'
import { SHOT_MODE } from '../devShots.js'

/**
 * Weather: rain, squalls, and thunderstorms.
 *
 * Three screen-space passes, drawn after the post chain (see scene.js
 * `setPostOverlay`) because all three are artifacts of looking through wet air
 * with a camera rather than things standing in the world:
 *
 *   1. **rain** — one half-resolution quad running six procedural streak layers,
 *      then linearly upscaled over the finished frame. The soft rain streaks lose
 *      no useful detail at half resolution, while the shader shades 75% fewer
 *      pixels. Lightning and its glow remain full resolution.
 *      Not particles. A particle field cheap enough to run at 60fps tops out at
 *      about a thousand sprites, which is why the old one read as snow: you
 *      could count the drops. Six hashed grids give ~30,000 streaks for one
 *      draw call, with real parallax (near layers are longer, faster, sparser
 *      and brighter; far layers collapse into a mist you feel rather than see).
 *      Normal-blended grey, not additive white — rain darkens a bright sky and
 *      lightens a dark sea, which is what water in the air actually does.
 *   2. **flash glow** — additive, centred on where the strike was. A strike lights
 *      the frame from a *direction*; a uniform white wash over the whole image is
 *      the single clearest tell that lightning is faked.
 *   3. **bolt** — a midpoint-displaced ribbon with branches, drawn for close
 *      strikes only. Distant strikes are sheet lightning: glow, no path.
 *
 * Everything animates off an internal clock accumulated from `dt`, never off
 * `simTime`. The screenshot harness pins the weather clock to a constant
 * (devShots.js `STORM_WEATHER_T`), so anything driven by `simTime` freezes —
 * which is why the old lightning schedule could never fire under `?shot`.
 *
 * Weather *phases* are still driven off campaign time so a save reloads into the
 * same sort of weather window rather than a fresh roll every boot.
 */

/** Seconds of clear / thunderstorm windows (campaign time). No plain rain. */
const CLEAR_RANGE = [140, 420]
const STORM_RANGE = [55, 140]

/** NDC y the horizon sits at from the chase camera. Bolts strike down to it. */
const HORIZON_NDC = 0.045

/** Speed of sound, km/s — thunder delay is distance / this. */
const SOUND_KMS = 0.343
/** Strike distance range, km. Past ~3km the clap is a rumble not a crack. */
const STRIKE_KM = [0.2, 3.1]

/** Rain is intentionally soft; half resolution cuts its fragment cost by 75%. */
const RAIN_RENDER_SCALE = 0.5

export function rainRenderSize(width, height) {
  return [
    Math.max(1, Math.round(width * RAIN_RENDER_SCALE)),
    Math.max(1, Math.round(height * RAIN_RENDER_SCALE))
  ]
}

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function pickRange(seed, [lo, hi]) {
  return lo + hash01(seed) * (hi - lo)
}

/**
 * Which weather mode a campaign-time window starts with.
 * Fair weather most of the time; occasional full thunderstorms (rain + lightning).
 * Plain rain without thunder is not a mode.
 */
function modeForSlot(slot) {
  const r = hash01(slot * 19.17 + 3.1)
  // ~14% storm windows — rare enough to feel special.
  return r < 0.86 ? 'clear' : 'storm'
}

function durationFor(mode, slot) {
  if (mode === 'storm') return pickRange(slot * 11.1 + 2, STORM_RANGE)
  return pickRange(slot * 5.9 + 4, CLEAR_RANGE)
}

// Cursor for weather windows — advanced frame-to-frame so long campaigns
// never re-walk from slot 0.
let _wxSlot = 0
let _wxStart = 0
let _wxMode = modeForSlot(0)
let _wxDur = durationFor(_wxMode, 0)

/** Clouds start going grey this long before rain/storm actually begins. */
const PRELUDE_S = 55
/** Residual gloom after wet weather ends. */
const AFTERMATH_S = 65
/** Soft edges on the wet window itself (visual + precipitation). */
const WET_EDGE_S = 22
/** Longer edge for cloud gloom so the deck does not snap. */
const GLOOM_EDGE_S = 36

function smoothstep01(x) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/**
 * Resolve weather mode + blend at campaign time `t`.
 *
 * Precipitation snaps to the wet window (with short edges). Cloud gloom and
 * light dimming lead the weather by PRELUDE_S and lag after by AFTERMATH_S so
 * the deck darkens before the first drop and recovers slowly after.
 */
export function weatherAt(t) {
  const time = Math.max(0, t)
  // Rewind if time jumped backward (new game / load).
  if (time + 0.001 < _wxStart) {
    _wxSlot = 0
    _wxStart = 0
    _wxMode = modeForSlot(0)
    _wxDur = durationFor(_wxMode, 0)
  }
  let guard = 0
  while (_wxStart + _wxDur <= time && guard++ < 10000) {
    _wxStart += _wxDur
    _wxSlot += 1
    _wxMode = modeForSlot(_wxSlot)
    _wxDur = durationFor(_wxMode, _wxSlot)
  }
  const mode = _wxMode
  const dur = _wxDur
  const local = time - _wxStart
  const remain = dur - local
  const nextMode = modeForSlot(_wxSlot + 1)
  const prevMode = _wxSlot > 0 ? modeForSlot(_wxSlot - 1) : 'clear'

  // Precipitation strength — thunderstorms only, short blend at window edges.
  let wetStr = 0
  if (mode === 'storm') {
    wetStr = 1
    if (local < WET_EDGE_S) wetStr = smoothstep01(local / WET_EDGE_S)
    else if (remain < WET_EDGE_S) wetStr = smoothstep01(remain / WET_EDGE_S)
  }
  // Storms always bring rain; there is no plain-rain mode.
  const rain = mode === 'storm' ? 0.75 + 0.25 * wetStr : 0
  const storm = mode === 'storm' ? wetStr : 0

  // Visual gloom for the cloud deck / lighting.
  // While storming: stay fully dark (prelude already brought us up — do not
  // re-zero at the first drop). Fade only as the front leaves.
  let rainGloom = 0
  let stormGloom = 0
  if (mode === 'storm') {
    rainGloom = 0.95
    stormGloom = 1
    if (remain < GLOOM_EDGE_S) {
      const e = smoothstep01(remain / GLOOM_EDGE_S)
      rainGloom *= e
      stormGloom *= e
    }
  }

  // Before a storm: sky loads up while it is still "clear".
  if (mode === 'clear' && remain < PRELUDE_S && nextMode === 'storm') {
    const p = smoothstep01(1 - remain / PRELUDE_S)
    rainGloom = Math.max(rainGloom, p * 0.6)
    stormGloom = Math.max(stormGloom, p * 0.95)
  }

  // After a storm: deck bleeds back to fair-weather colour slowly.
  if (mode === 'clear' && local < AFTERMATH_S && prevMode === 'storm') {
    const a = smoothstep01(1 - local / AFTERMATH_S)
    rainGloom = Math.max(rainGloom, a * 0.55)
    stormGloom = Math.max(stormGloom, a * 0.82)
  }

  // Cover / light from gloom so everything eases with the deck.
  // NOTE: sky shader treats uCloudCover as a *threshold* — higher = clearer sky.
  // Fair ~0.60 (readable sun/glitter); storm drops toward ~0.10 (socked in).
  const cloudCover = 0.6 - 0.18 * rainGloom - 0.32 * stormGloom
  const sunMul = 1 - 0.4 * rainGloom - 0.58 * stormGloom
  const fogMul = 1 + 0.42 * rainGloom + 0.95 * stormGloom
  const hemiMul = 1 - 0.14 * rainGloom - 0.36 * stormGloom

  return {
    mode,
    rain: Math.min(1, rain),
    storm,
    rainGloom: Math.min(1, rainGloom),
    stormGloom: Math.min(1, stormGloom),
    cloudCover,
    sunMul,
    fogMul,
    hemiMul,
    slot: _wxSlot,
    localT: local
  }
}

// ---------------------------------------------------------------------------
// Rain pass
// ---------------------------------------------------------------------------

const FULLSCREEN_VERT = `
uniform float uAspect;
varying vec2 vNdc;
varying vec2 vSq;
void main() {
  vNdc = position.xy;
  // Aspect-corrected: one unit is the same number of pixels in x and y, so
  // streaks are not stretched wide on a landscape viewport.
  vSq = vec2(position.x * uAspect, position.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Six hashed streak grids + horizon veil + wet-lens accumulation.
 *
 * Each layer is a grid of tall cells; one drop per cell, scrolling through the
 * grid in +y so it falls in -y on screen. Near layers use extra wind shear so
 * parallax reads as depth, not a single sheet of parallel lines.
 */
const RAIN_FRAG = `
precision highp float;
uniform float uTime;
uniform float uAspect;
uniform float uRain;      // 0..1 precipitation, already squall-modulated
uniform float uWind;      // shear angle, radians
uniform float uFlash;     // lightning, 0..~1.3 — rain lights up when backlit
uniform float uLens;      // 0..1 water on the front element
uniform float uHorizon;   // NDC y of the horizon
varying vec2 vNdc;
varying vec2 vSq;

vec3 hash32(vec2 p) {
  vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
  return fract(sin(q) * 43758.5453);
}

vec2 rot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

/**
 * One streak layer.
 * cells  cells per aspect-corrected unit (x, y)
 * speed  cells/sec of fall
 * len    streak length as a fraction of cell height
 * wid    streak half-width as a fraction of cell width
 * dens   fraction of cells that hold a drop
 * shear  extra wind lean on this layer (parallax: near = more)
 */
float layer(vec2 p, vec2 cells, float speed, float len, float wid, float dens, float seed, float shear) {
  // Per-layer wind so near rain slants harder than far mist — depth without particles.
  vec2 q = rot(p, shear);
  vec2 g = q * cells;
  g.y += uTime * speed + seed;
  // Slow horizontal crawl so sheets drift with the gust instead of raining on rails.
  g.x += uTime * speed * 0.035 * sign(shear + 0.0001) + seed * 0.17;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec3 r = hash32(id + seed);
  if (r.z > dens) return 0.0;
  // Head sits low enough in the cell that the tail never crosses the boundary.
  float head = r.y * (1.0 - len);
  float dy = f.y - head;
  if (dy < 0.0 || dy > len) return 0.0;
  float t = dy / len;
  // Bright head, long soft tail — motion-smear of a drop over one exposure.
  float along = (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.08, t);
  // Slight width taper toward the tail so streaks read as needles, not sticks.
  float widT = wid * mix(1.15, 0.55, t);
  float dx = f.x - (0.08 + 0.84 * r.x);
  float across = smoothstep(widT, widT * 0.18, abs(dx));
  // Per-drop brightness variance so the field never reads as one flat value.
  float vary = 0.45 + 0.55 * fract(r.x * 7.31 + r.y * 3.77);
  return along * across * vary;
}

/** Drifting sheets — a squall is not uniform across the frame. */
float curtain(float x, float phase) {
  float a = sin(x * 0.72 - uTime * 0.29 + phase);
  float b = sin(x * 1.95 + uTime * 0.17 + phase * 1.7);
  float c = sin(x * 0.31 + uTime * 0.07 + phase * 0.4);
  return 0.52 + 0.48 * (0.45 * (a * 0.5 + 0.5) + 0.35 * (b * 0.5 + 0.5) + 0.20 * (c * 0.5 + 0.5));
}

void main() {
  float rain = uRain;
  if (rain < 0.01 && uLens < 0.01) discard;

  // Base wind on the whole field; layers add extra shear for parallax.
  vec2 p = rot(vSq, uWind * 0.55);
  float acc = 0.0;
  float windSign = sign(uWind + 0.0001);

  if (rain > 0.005) {
    // Far mist — sub-pixel density that textures the air, not countable drops.
    acc += layer(p, vec2(155.0, 46.0), 86.0, 0.38, 0.18, 0.88, 11.3, uWind * 0.12 * windSign)
      * 0.062 * curtain(p.x, 0.0);
    acc += layer(p, vec2(105.0, 30.0), 70.0, 0.42, 0.13, 0.78, 19.7, uWind * 0.22 * windSign)
      * 0.088 * curtain(p.x, 1.1);
    acc += layer(p, vec2(70.0, 19.0), 56.0, 0.48, 0.105, 0.66, 27.9, uWind * 0.38 * windSign)
      * 0.112 * curtain(p.x, 2.1);
    if (rain > 0.15) {
      acc += layer(p, vec2(42.0, 12.0), 44.0, 0.54, 0.088, 0.54, 53.1, uWind * 0.55 * windSign)
        * 0.135 * curtain(p.x, 4.3);
    }
    if (rain > 0.32) {
      // Mid-near: readable streaks that still sit in sheets.
      acc += layer(p, vec2(26.0, 7.5), 36.0, 0.60, 0.07, 0.38, 71.7, uWind * 0.78 * windSign)
        * 0.155 * curtain(p.x, 5.9);
    }
    if (rain > 0.52) {
      // Closest: long, sparse, wind-slashed needles — the scale-sellers.
      // Thin + moderate so they sell scale without fat particle strokes.
      acc += layer(p, vec2(15.0, 4.4), 28.0, 0.66, 0.052, 0.24, 91.4, uWind * 1.05 * windSign)
        * 0.165 * curtain(p.x, 7.2);
    }
    acc *= 0.34 + 0.72 * rain;

    // Distant rain sheets: soft scattering band on the horizon (squall depth).
    float band = exp(-pow((vNdc.y - uHorizon) * 2.15, 2.0));
    float highVeil = smoothstep(-0.15, 0.85, vNdc.y) * 0.035;
    acc += (band * 0.10 + highVeil) * rain * curtain(p.x * 0.45, 1.2);
  }

  // Wet front element: film + rivulets, almost no bead rings (demo tell).
  // Kept off the centre so the reticle / aim stay clean.
  if (uLens > 0.01) {
    float edge = smoothstep(0.32, 0.95, length(vec2(vNdc.x * 1.08, vNdc.y * 0.9)));
    float topHeavy = smoothstep(-0.15, 0.7, -vNdc.y) * 0.3 + 0.7;

    // Film haze — overall wet glass, not discrete drops.
    float film = edge * uLens * 0.055 * (0.88 + 0.12 * sin(vNdc.x * 14.0 + uTime * 0.35));

    // Slow rivulets creeping down the glass (wind-biased).
    vec2 rp = vNdc * vec2(2.4 * uAspect, 3.6);
    rp.x -= uWind * 0.35;
    rp.y += uTime * 0.085;
    vec2 rid = floor(rp);
    vec2 rf = fract(rp);
    vec3 rr = hash32(rid + 44.0);
    float riv = 0.0;
    if (rr.z < 0.18 * uLens + 0.06) {
      float cx = 0.15 + 0.7 * rr.x;
      float dx = abs(rf.x - cx);
      float trail = smoothstep(0.055, 0.0, dx) * smoothstep(0.0, 0.22, rf.y) * (1.0 - rf.y);
      riv = trail * (0.08 + 0.12 * rr.y);
    }

    // Very sparse soft beads — no hard white rings.
    vec2 lp = vNdc * vec2(3.6 * uAspect, 3.6);
    lp.y += uTime * 0.022;
    lp.x += uWind * 0.06;
    vec2 lid = floor(lp);
    vec2 lf = fract(lp);
    vec3 lr = hash32(lid + 91.0);
    float bead = 0.0;
    if (lr.z < 0.08) {
      float rad = 0.06 + 0.07 * lr.z;
      vec2 c = vec2(0.22 + 0.56 * lr.x, 0.2 + 0.5 * lr.y);
      float d = length((lf - c) * vec2(1.0, 1.3));
      float rim = smoothstep(rad, rad * 0.82, d) - smoothstep(rad * 0.84, rad * 0.45, d);
      float body = smoothstep(rad, rad * 0.2, d);
      bead = rim * 0.14 + body * 0.03;
    }

    acc += (film + riv * uLens + bead * uLens) * edge * topHeavy;
  }

  // Backlit rain: a strike lifts drops slightly — never a white rain sheet.
  acc *= 1.0 + uFlash * 1.5;
  acc = clamp(acc, 0.0, 0.64);
  if (acc < 0.002) discard;

  // Cool wet grey; flash cools/lifts without snowing the frame white.
  vec3 tint = mix(vec3(0.55, 0.61, 0.68), vec3(0.85, 0.90, 0.97), clamp(uFlash, 0.0, 1.0) * 0.5);
  gl_FragColor = vec4(tint, acc);
}
`

/**
 * Soft hole over the main-menu logo + link column. NDC: logo sits upper-centre,
 * menu links lower-centre. Used only when uTitleSafe is on so in-game lightning
 * still fills the frame.
 */
const TITLE_UI_MASK = `
float titleUiMask(vec2 ndc) {
  // Logo / title art (upper centre).
  float logo = 1.0 - smoothstep(0.2, 0.48, length(vec2(ndc.x * 1.15, (ndc.y - 0.22) * 1.35)));
  // Menu row + pun under the art.
  float menu = 1.0 - smoothstep(0.14, 0.38, length(vec2(ndc.x * 1.35, (ndc.y + 0.68) * 2.1)));
  // Slight wider soft band so forks can't graze the glyph edges.
  float band = 1.0 - smoothstep(0.28, 0.52, abs(ndc.x)) * smoothstep(-0.15, 0.55, ndc.y);
  float hole = max(logo, max(menu, band * 0.55));
  return 1.0 - hole * 0.98;
}
`

/** Additive directional wash from a strike. Never a flat white frame. */
const GLOW_FRAG = `
precision highp float;
uniform float uFlash;
uniform float uSheet;     // 1 = distant sheet lightning (broader, softer)
uniform vec2 uFlashPos;
uniform vec3 uFlashColor;
uniform float uTitleSafe;
varying vec2 vNdc;
varying vec2 vSq;
${TITLE_UI_MASK}
void main() {
  if (uFlash < 0.003) discard;
  vec2 d = vSq - uFlashPos;
  // Elliptical falloff: more horizontal spill under the cloud deck than down into the sea.
  vec2 de = d * vec2(1.0, mix(1.15, 0.85, uSheet));
  float r2 = dot(de, de);
  // Core bloom near the strike, wide cloud-deck glow, faint whole-sky spill.
  float core = exp(-r2 * mix(0.55, 0.18, uSheet));
  float mid = exp(-r2 * mix(0.12, 0.04, uSheet));
  float wide = exp(-r2 * mix(0.028, 0.012, uSheet));
  // Slight vertical bias toward the upper frame (light comes from the sky).
  float skyBias = smoothstep(-0.6, 0.55, vNdc.y);
  float a = uFlash * (
    core * mix(0.48, 0.22, uSheet) +
    mid  * mix(0.22, 0.34, uSheet) +
    wide * mix(0.08, 0.18, uSheet)
  ) * mix(0.75, 1.0, skyBias);
  if (uTitleSafe > 0.5) a *= titleUiMask(vNdc);
  // Cool white core, soft blue spill at the edges.
  vec3 c = mix(uFlashColor * 0.75, uFlashColor, core);
  gl_FragColor = vec4(c * a, 1.0);
}
`

const BOLT_VERT = `
uniform float uAspect;
attribute float aCross;
attribute float aFade;
varying float vCross;
varying float vFade;
varying vec2 vNdc;
void main() {
  vCross = aCross;
  vFade = aFade;
  vNdc = vec2(position.x / uAspect, position.y);
  gl_Position = vec4(vNdc, 0.0, 1.0);
}
`

const BOLT_FRAG = `
precision highp float;
uniform float uBolt;
uniform vec3 uBoltColor;
uniform float uTitleSafe;
varying float vCross;
varying float vFade;
varying vec2 vNdc;
${TITLE_UI_MASK}
void main() {
  float a = abs(vCross);
  // Wide soft bloom + tight hot core — afterimage-friendly additive ribbon.
  float bloom = pow(max(0.0, 1.0 - a), 1.35);
  float glow = pow(max(0.0, 1.0 - a), 2.4);
  float core = smoothstep(0.32, 0.0, a);
  vec3 c = mix(uBoltColor * 0.9, vec3(1.0, 0.995, 0.97), core * 0.95 + glow * 0.12);
  float amt = (bloom * 0.32 + glow * 0.45 + core * 1.15) * vFade * uBolt;
  if (uTitleSafe > 0.5) amt *= titleUiMask(vNdc);
  if (amt < 0.002) discard;
  gl_FragColor = vec4(c * amt, 1.0);
}
`

/** Midpoint-displaced path from (x0,y0) to (x1,y1) in aspect-corrected NDC. */
function boltPath(x0, y0, x1, y1, rough, iters = 5) {
  let pts = [x0, y0, x1, y1]
  for (let it = 0; it < iters; it++) {
    const amp = rough * Math.pow(0.58, it)
    const next = [pts[0], pts[1]]
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i]
      const ay = pts[i + 1]
      const bx = pts[i + 2]
      const by = pts[i + 3]
      const dx = bx - ax
      const dy = by - ay
      const len = Math.hypot(dx, dy) || 1
      // Slight bias toward jagged hooks rather than pure sine-wave meander.
      const j = (Math.random() * 2 - 1) * amp * (0.7 + Math.random() * 0.6)
      next.push(ax + dx * 0.5 + (-dy / len) * j, ay + dy * 0.5 + (dx / len) * j, bx, by)
    }
    pts = next
  }
  return pts
}

/** Vertices the bolt buffer is sized for (main channel + primary + secondary forks). */
// Three stacked passes down a 128-segment channel plus forks and twigs. Sized
// generously because pushSeg silently drops anything past the cap, and the
// things pushed last are the forks — the first thing you would notice missing.
const BOLT_MAX_VERTS = 9500

/**
 * Live weather FX: rain, squalls, lightning.
 * Call `update(dt, simTime, aspect)` every frame; draw via `render(renderer)` after post.
 */
export function createWeather() {
  const quad = new THREE.PlaneGeometry(2, 2)

  // WebGPU: full TSL rain / glow / bolt (no GLSL ShaderMaterial).
  const uRain = uniform(0)
  const uRainTime = uniform(0)
  const uRainAspect = uniform(1.6)
  const uRainWind = uniform(0.22)
  const uRainFlash = uniform(0)
  const uRainLens = uniform(0)
  const uRainHorizon = uniform(HORIZON_NDC)

  const hash32 = Fn(([p]) => {
    const q = vec3(
      p.dot(vec2(127.1, 311.7)),
      p.dot(vec2(269.5, 183.3)),
      p.dot(vec2(419.2, 371.9))
    )
    return fract(sin(q).mul(43758.5453))
  })

  const rot2 = Fn(([v, a]) => {
    const c = cos(a)
    const s = sin(a)
    return vec2(c.mul(v.x).sub(s.mul(v.y)), s.mul(v.x).add(c.mul(v.y)))
  })

  // One streak layer — hashed grid of falling needles.
  const rainLayer = Fn(
    ([p, cells, speed, len, wid, dens, seed, shear, time, windSign]) => {
      const q = rot2(p, shear)
      const g = vec2(
        q.x.mul(cells.x).add(time.mul(speed).mul(0.035).mul(windSign).add(seed.mul(0.17))),
        q.y.mul(cells.y).add(time.mul(speed).add(seed))
      )
      const id = floor(g)
      const f = fract(g)
      const r = hash32(id.add(vec2(seed, seed.mul(1.7))))
      const head = r.y.mul(float(1).sub(len))
      const dy = f.y.sub(head)
      const t = clamp(dy.div(max(len, float(1e-4))), float(0), float(1))
      const inSeg = smoothstep(float(0), float(0.002), dy).mul(oneMinus(smoothstep(len.sub(0.002), len, dy)))
      const along = float(1)
        .sub(t)
        .mul(float(1).sub(t))
        .mul(smoothstep(float(0), float(0.08), t))
        .mul(inSeg)
      const widT = wid.mul(mix(float(1.15), float(0.55), t))
      const dx = f.x.sub(float(0.08).add(r.x.mul(0.84)))
      const across = smoothstep(widT, widT.mul(0.18), abs(dx))
      const vary = float(0.45).add(float(0.55).mul(fract(r.x.mul(7.31).add(r.y.mul(3.77)))))
      const live = oneMinus(smoothstep(dens.sub(0.04), dens.add(0.04), r.z))
      return along.mul(across).mul(vary).mul(live)
    }
  )

  const rainMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    // Store straight colour + alpha in the low-resolution target. Blending is
    // applied once, when that texture is composited over the finished frame.
    blending: THREE.NoBlending
  })
  rainMat.colorNode = Fn(() => {
    // Full-screen quad UV → NDC
    const ndc = uv().mul(2).sub(1)
    const aspect = uRainAspect
    const vSq = vec2(ndc.x.mul(aspect), ndc.y)
    const rain = uRain
    const windSign = float(1) // simplified; wind lean still applied
    const p = rot2(vSq, uRainWind.mul(0.55))

    let acc = float(0)
    // Far mist layers (always when raining)
    acc = acc.add(
      rainLayer(
        p,
        vec2(155, 46),
        float(86),
        float(0.38),
        float(0.18),
        float(0.88),
        float(11.3),
        uRainWind.mul(0.12),
        uRainTime,
        windSign
      ).mul(0.062)
    )
    acc = acc.add(
      rainLayer(
        p,
        vec2(105, 30),
        float(70),
        float(0.42),
        float(0.13),
        float(0.78),
        float(19.7),
        uRainWind.mul(0.22),
        uRainTime,
        windSign
      ).mul(0.088)
    )
    acc = acc.add(
      rainLayer(
        p,
        vec2(70, 19),
        float(56),
        float(0.48),
        float(0.105),
        float(0.66),
        float(27.9),
        uRainWind.mul(0.38),
        uRainTime,
        windSign
      ).mul(0.112)
    )
    // Heavier mid/near layers scale with intensity
    const mid = rainLayer(
      p,
      vec2(42, 12),
      float(44),
      float(0.54),
      float(0.088),
      float(0.54),
      float(53.1),
      uRainWind.mul(0.55),
      uRainTime,
      windSign
    ).mul(0.135)
    const near = rainLayer(
      p,
      vec2(26, 7.5),
      float(36),
      float(0.6),
      float(0.07),
      float(0.38),
      float(71.7),
      uRainWind.mul(0.78),
      uRainTime,
      windSign
    ).mul(0.155)
    const close = rainLayer(
      p,
      vec2(15, 4.4),
      float(28),
      float(0.66),
      float(0.052),
      float(0.24),
      float(91.4),
      uRainWind.mul(1.05),
      uRainTime,
      windSign
    ).mul(0.165)
    acc = acc.add(mid.mul(smoothstep(float(0.1), float(0.35), rain)))
    acc = acc.add(near.mul(smoothstep(float(0.25), float(0.55), rain)))
    acc = acc.add(close.mul(smoothstep(float(0.45), float(0.75), rain)))
    acc = acc.mul(float(0.34).add(rain.mul(0.72)))

    // Horizon veil
    const band = exp(negate(pow(ndc.y.sub(uRainHorizon).mul(2.15), 2)))
    acc = acc.add(band.mul(0.1).mul(rain))

    // Wet lens film on edges
    const edge = smoothstep(float(0.32), float(0.95), length(vec2(ndc.x.mul(1.08), ndc.y.mul(0.9))))
    acc = acc.add(edge.mul(uRainLens).mul(0.055))

    acc = acc.mul(float(1).add(uRainFlash.mul(1.5)))
    acc = clamp(acc, float(0), float(0.64))
    const tint = mix(vec3(0.55, 0.61, 0.68), vec3(0.85, 0.9, 0.97), clamp(uRainFlash, float(0), float(1)).mul(0.5))
    // Gate when dry
    const wet = max(rain, uRainLens)
    acc = acc.mul(smoothstep(float(0.005), float(0.04), wet))
    return vec4(tint, acc)
  })()
  rainMat.uniforms = {
    uTime: uRainTime,
    uAspect: uRainAspect,
    uRain,
    uWind: uRainWind,
    uFlash: uRainFlash,
    uLens: uRainLens,
    uHorizon: uRainHorizon
  }
  const rainMesh = new THREE.Mesh(quad, rainMat)
  rainMesh.frustumCulled = false
  rainMesh.renderOrder = 0

  const uGlowFlash = uniform(0)
  const uGlowSheet = uniform(0)
  const uGlowAspect = uniform(1.6)
  const uGlowPos = uniform(new THREE.Vector2(0, 0.5))
  const uGlowColor = uniform(new THREE.Color(0.68, 0.78, 1.0))
  const uGlowTitle = uniform(0)
  const glowMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  glowMat.colorNode = Fn(() => {
    const ndc = uv().mul(2).sub(1)
    const vSq = vec2(ndc.x.mul(uGlowAspect), ndc.y)
    const d = vSq.sub(uGlowPos)
    const de = d.mul(vec2(1, mix(float(1.15), float(0.85), uGlowSheet)))
    const r2 = de.dot(de)
    const core = exp(negate(r2.mul(mix(float(0.55), float(0.18), uGlowSheet))))
    const mid = exp(negate(r2.mul(mix(float(0.12), float(0.04), uGlowSheet))))
    const wide = exp(negate(r2.mul(mix(float(0.028), float(0.012), uGlowSheet))))
    const skyBias = smoothstep(float(-0.6), float(0.55), ndc.y)
    let a = uGlowFlash
      .mul(
        core
          .mul(mix(float(0.48), float(0.22), uGlowSheet))
          .add(mid.mul(mix(float(0.22), float(0.34), uGlowSheet)))
          .add(wide.mul(mix(float(0.08), float(0.18), uGlowSheet)))
      )
      .mul(mix(float(0.75), float(1), skyBias))
    // Title-safe soft hole over logo + menu column
    const logo = float(1).sub(
      smoothstep(float(0.2), float(0.48), length(vec2(ndc.x.mul(1.15), ndc.y.sub(0.22).mul(1.35))))
    )
    const menu = float(1).sub(
      smoothstep(float(0.14), float(0.38), length(vec2(ndc.x.mul(1.35), ndc.y.add(0.68).mul(2.1))))
    )
    const hole = max(logo, menu)
    const titleMask = float(1).sub(hole.mul(0.98))
    a = a.mul(mix(float(1), titleMask, uGlowTitle))
    const edge = smoothstep(float(0), float(0.35), a)
    const c = mix(uGlowColor.mul(0.55), uGlowColor, edge)
    return vec4(c, a)
  })()
  glowMat.uniforms = {
    uAspect: uGlowAspect,
    uFlash: uGlowFlash,
    uSheet: uGlowSheet,
    uFlashPos: uGlowPos,
    uFlashColor: uGlowColor,
    uTitleSafe: uGlowTitle
  }
  const glowMesh = new THREE.Mesh(quad, glowMat)
  glowMesh.frustumCulled = false
  glowMesh.renderOrder = 1
  glowMesh.visible = false

  // --- Lightning bolt ribbon ---
  const boltPos = new Float32Array(BOLT_MAX_VERTS * 3)
  const boltCross = new Float32Array(BOLT_MAX_VERTS)
  const boltFade = new Float32Array(BOLT_MAX_VERTS)
  const boltGeo = new THREE.BufferGeometry()
  boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPos, 3))
  boltGeo.setAttribute('aCross', new THREE.BufferAttribute(boltCross, 1))
  boltGeo.setAttribute('aFade', new THREE.BufferAttribute(boltFade, 1))
  boltGeo.setDrawRange(0, 0)
  const uBolt = uniform(0)
  const uBoltAspect = uniform(1.6)
  const uBoltColor = uniform(new THREE.Color(0.58, 0.72, 1.0))
  const uBoltTitle = uniform(0)
  const aCross = attribute('aCross', 'float')
  const aFade = attribute('aFade', 'float')
  const boltMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  })
  boltMat.colorNode = Fn(() => {
    // Cross-section. The old profile was `across^0.55`, which is almost flat
    // right out to the quad edge — that is what made every stroke a
    // uniform-width white band with a hard rim, i.e. a sticker. A real channel
    // is a very thin incandescent core inside a much wider, much dimmer glow,
    // and the width you perceive is nearly all glow.
    const across = clamp(oneMinus(abs(aCross)), float(0), float(1))
    const core = pow(across, float(7))
    const glow = pow(across, float(1.8)).mul(0.26)
    let a = uBolt.mul(aFade).mul(core.mul(1.35).add(glow))
    // Title-safe: dim bolts that sit in the centre column (positions are NDC-ish in xy).
    // Full path culling is done in JS for titleSafe; this is a soft residual.
    a = a.mul(mix(float(1), float(0.15), uBoltTitle.mul(0.5)))
    // Cool blue-violet in the glow, white-hot only in the core. A pure white
    // channel edge to edge is the other half of the sticker look.
    const c = mix(uBoltColor.mul(0.85), vec3(1, 0.98, 0.94), core)
    return vec4(c, a)
  })()
  boltMat.uniforms = {
    uAspect: uBoltAspect,
    uBolt,
    uBoltColor,
    uTitleSafe: uBoltTitle
  }
  const boltMesh = new THREE.Mesh(boltGeo, boltMat)
  boltMesh.frustumCulled = false
  boltMesh.renderOrder = 2
  boltMesh.visible = false

  const rainScene = new THREE.Scene()
  rainScene.add(rainMesh)
  const lightningScene = new THREE.Scene()
  lightningScene.add(glowMesh)
  lightningScene.add(boltMesh)
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10)

  // Rain is the costly pass: six procedural layers, each with a multi-value
  // hash, across every screen pixel. Render it at half width and height and
  // upscale once; the intentionally soft streaks and lens film mask the lower
  // resolution, while lightning keeps its sharp full-resolution path.
  const rainTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace
  })
  rainTarget.texture.minFilter = THREE.LinearFilter
  rainTarget.texture.magFilter = THREE.LinearFilter
  rainTarget.texture.generateMipmaps = false
  const rainCompositeMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending
  })
  rainCompositeMat.colorNode = texture(rainTarget.texture, screenUV)
  const rainComposite = new THREE.QuadMesh(rainCompositeMat)
  const drawingBufferSize = new THREE.Vector2()
  const savedClearColor = new THREE.Color()
  let rainTargetWidth = 0
  let rainTargetHeight = 0

  function render(renderer) {
    if (!rainMesh.visible && !glowMesh.visible && !boltMesh.visible) return

    if (rainMesh.visible) {
      renderer.getDrawingBufferSize(drawingBufferSize)
      const [width, height] = rainRenderSize(drawingBufferSize.x, drawingBufferSize.y)
      if (width !== rainTargetWidth || height !== rainTargetHeight) {
        rainTarget.setSize(width, height)
        rainTargetWidth = width
        rainTargetHeight = height
      }

      const previousTarget = renderer.getRenderTarget()
      const previousClearAlpha = renderer.getClearAlpha()
      renderer.getClearColor(savedClearColor)
      try {
        renderer.setRenderTarget(rainTarget)
        renderer.setClearColor(0x000000, 0)
        renderer.clear()
        renderer.render(rainScene, overlayCamera)
      } finally {
        renderer.setRenderTarget(previousTarget)
        renderer.setClearColor(savedClearColor, previousClearAlpha)
      }
      rainComposite.render(renderer)
    }

    if (glowMesh.visible || boltMesh.visible) {
      renderer.render(lightningScene, overlayCamera)
    }
  }

  // --- Sim state ---
  let fxT = 0
  let flash = 0
  /** Residual cloud afterglow after the hard hit dies — sells afterimage. */
  let afterglow = 0
  let boltLife = 0
  /** Soft residual bolt opacity after the main stroke (lingering ion path). */
  let boltAfter = 0
  let boltVerts = 0
  /** 1 when the current flash is distant sheet lightning (no path). */
  let sheetAmt = 0
  /** @type {null | { delay: number, volume: number, distanceKm: number }} */
  let pendingThunder = null
  let nextStrikeIn = 0
  /** Multi-stroke: a real strike flickers two or three times down the same path. */
  let strokesLeft = 0
  let strokeIn = 0
  let smoothRainGloom = 0
  let smoothStormGloom = 0
  let wetness = 0
  let seaState = 0
  let primed = false
  /**
   * Title / main menu: keep bolt paths and strike glow out of the logo + menu
   * column (DOM sits over a transparent canvas, so lightning would slash the art).
   */
  let titleSafe = false
  const flashDir = { x: 0, y: 0.4, z: 1 }
  let strikeAz = 0
  let lastWx = weatherAt(0)

  /** Push one ribbon segment pair (two triangles) into the bolt buffer. */
  function pushSeg(ax, ay, bx, by, halfW, fade) {
    if (boltVerts + 6 > BOLT_MAX_VERTS) return
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * halfW
    const ny = (dx / len) * halfW
    const v = [
      [ax - nx, ay - ny, -1],
      [ax + nx, ay + ny, 1],
      [bx + nx, by + ny, 1],
      [ax - nx, ay - ny, -1],
      [bx + nx, by + ny, 1],
      [bx - nx, by - ny, -1]
    ]
    for (const [x, y, c] of v) {
      boltPos[boltVerts * 3] = x
      boltPos[boltVerts * 3 + 1] = y
      boltPos[boltVerts * 3 + 2] = 0
      boltCross[boltVerts] = c
      boltFade[boltVerts] = fade
      boltVerts++
    }
  }

  /**
   * @param jitter 0..1 — how much the brightness varies segment to segment. A
   * real channel is not evenly lit along its length: the return stroke leaves
   * bright and dim stretches, and a perfectly even ribbon is the giveaway.
   */
  function pushPath(pts, baseW, fade, taper, jitter = 0) {
    const segs = pts.length / 2 - 1
    for (let i = 0; i < segs; i++) {
      const k = i / segs
      // Channels thin out as they run down and discharge.
      const w = baseW * (1 - taper * k)
      const f = jitter
        ? fade * (1 - jitter + jitter * (0.35 + 1.3 * hash01(i * 3.7 + baseW * 977)))
        : fade
      pushSeg(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], w, f)
    }
  }

  /** Rebuild the ribbon for a fresh strike at aspect-corrected NDC x `sx`. */
  function buildBolt(sx, aspect, forceSeed = null) {
    boltVerts = 0
    const rng = forceSeed != null ? () => {
      // Deterministic fallback for shot harness — still looks forked, just stable.
      forceSeed = (forceSeed * 16807 + 0.5) % 1
      return forceSeed
    } : Math.random
    const groundY = HORIZON_NDC + 0.01 + rng() * 0.06
    const endX = sx + (rng() * 2 - 1) * 0.32
    // Roughness 0.145 gave a zigzag whose first kink was a seventh of the
    // screen wide — a cartoon bolt. A real channel is close to straight with
    // small sharp deflections, so the amplitude drops and the iteration count
    // goes up to buy the fine kinks instead.
    const main = boltPath(sx, 1.15, endX, groundY, 0.062, 7)
    // Three passes down the same path: a thin incandescent core, a tight glow
    // and a wide bloom. Additive, so they stack into a hot centre with a soft
    // falloff instead of one flat band.
    // The fourth pass is not decoration. These meshes are drawn by
    // `setPostOverlay`, i.e. *after* the post chain, so the engine's bloom never
    // sees the channel — whatever halo it has, it has to draw itself. Three
    // passes topped out at a 35 px falloff, which at 1600x900 still reads as a
    // hard-edged stroke. The fourth is a ~95 px wash at 4% and is what makes it
    // look photographed rather than drawn.
    pushPath(main, 0.007, 1, 0.42, 0.4)
    pushPath(main, 0.026, 0.4, 0.5, 0.45)
    pushPath(main, 0.078, 0.13, 0.55)
    pushPath(main, 0.21, 0.042, 0.6)

    // Primary forks leave the channel and die before the water.
    const nBranch = 3 + ((rng() * 4) | 0)
    const pts = main.length / 2
    for (let b = 0; b < nBranch; b++) {
      const at = 3 + ((rng() * Math.max(1, pts - 8)) | 0)
      const bx = main[at * 2]
      const by = main[at * 2 + 1]
      const drop = (by - groundY) * (0.2 + rng() * 0.45)
      const side = rng() < 0.5 ? -1 : 1
      // Forks run mostly *down*. Letting the lateral offset outgrow the drop
      // gives near-horizontal streaks, which read as scratches on the lens.
      const ex = bx + side * (0.05 + rng() * 0.18)
      const ey = by - Math.max(0.14, drop)
      const sub = boltPath(bx, by, ex, ey, 0.032, 5)
      pushPath(sub, 0.0035, 0.55 + rng() * 0.25, 0.92, 0.5)
      pushPath(sub, 0.014, 0.11, 0.9)

      // Secondary twig on ~half the primaries — real bolts fork recursively.
      if (rng() < 0.55 && sub.length >= 8) {
        const mid = (sub.length / 2 / 2) | 0
        const tx = sub[mid * 2]
        const ty = sub[mid * 2 + 1]
        const twig = boltPath(
          tx,
          ty,
          tx + side * (0.04 + rng() * 0.14),
          ty - (0.04 + rng() * 0.12),
          0.02,
          3
        )
        pushPath(twig, 0.002, 0.32, 0.95, 0.6)
      }
    }
    boltGeo.attributes.position.needsUpdate = true
    boltGeo.attributes.aCross.needsUpdate = true
    boltGeo.attributes.aFade.needsUpdate = true
    boltGeo.setDrawRange(0, boltVerts)
    boltMat.uniforms.uAspect.value = aspect
  }

  function fireLightning(intensity, aspect, opts = {}) {
    // Area scaling: far strikes are far more common than near ones.
    // Shot harness forces a near bolt so QA frames actually catch a path.
    const dist = opts.forceNear ? 0.12 + Math.random() * 0.18 : Math.sqrt(Math.random())
    const km = STRIKE_KM[0] + dist * (STRIKE_KM[1] - STRIKE_KM[0])
    const near = 1 - dist

    // Close strikes are a hard directional hit; distant ones are sheet lightning
    // behind the cloud deck — a glow, no path, soft rumble.
    // Keep peak under ~1.0 so Neutral tonemap doesn't milk the whole frame.
    const hit = (0.22 + 0.72 * near * near) * (0.7 + 0.3 * intensity)
    flash = Math.max(flash, hit)
    afterglow = Math.max(afterglow, hit * (0.22 + 0.28 * (1 - near)))
    strokesLeft = opts.forceNear ? 2 : 1 + ((Math.random() * 3) | 0)
    strokeIn = 0.04 + Math.random() * 0.08

    // Where it is: a world azimuth for the key light, and a screen position for
    // the glow. Without the camera basis these are independent; over the ~0.3s
    // a strike lives, the eye cannot tell.
    strikeAz = opts.az ?? Math.random() * Math.PI * 2
    const el = 0.28 + Math.random() * 0.42
    const ch = Math.cos(el)
    flashDir.x = Math.cos(strikeAz) * ch
    flashDir.y = Math.sin(el)
    flashDir.z = Math.sin(strikeAz) * ch

    // Aspect-corrected NDC x. On the title screen pin strikes to the far sides
    // so the channel never runs through the logo / menu column.
    let sx = opts.sx ?? (Math.random() * 2 - 1) * aspect * 0.82
    if (titleSafe && opts.sx == null) {
      const side = Math.random() < 0.5 ? -1 : 1
      sx = side * aspect * (0.62 + Math.random() * 0.3)
    }
    const sy = titleSafe
      ? 0.55 + Math.random() * 0.35
      : 0.38 + Math.random() * 0.48
    glowMat.uniforms.uFlashPos.value.set(sx, sy)

    // Visible path for close strikes; distant = sheet (glow only).
    // Title: still allow side bolts, but more sheet so the centre stays clean.
    const drawBolt =
      opts.forceNear ||
      (near > 0.42 && Math.random() < (titleSafe ? 0.45 : 0.78))
    sheetAmt = drawBolt ? 0 : 0.75 + Math.random() * 0.25
    if (drawBolt) {
      buildBolt(sx, aspect, opts.seed ?? null)
      boltLife = (opts.forceNear ? 0.42 : 0.26) + near * 0.22
      boltAfter = 0.7 + near * 0.4
    } else {
      boltLife = 0
      boltAfter = 0
      boltVerts = 0
      boltGeo.setDrawRange(0, 0)
    }

    pendingThunder = {
      delay: km / SOUND_KMS,
      volume: Math.min(1, (0.3 + 0.7 * near * near) * (0.75 + intensity * 0.35)),
      distanceKm: km
    }
  }

  /**
   * @param {number} dt
   * @param {number} simTime
   * @param {number} [aspect]
   * @returns {{
   *   mode: string,
   *   rain: number,
   *   storm: number,
   *   rainGloom: number,
   *   stormGloom: number,
   *   cloudCover: number,
   *   sunMul: number,
   *   fogMul: number,
   *   hemiMul: number,
   *   flash: number,
   *   thunder: null | { delay: number, volume: number, distanceKm: number },
   *   squall: number,
   *   gust: number,
   *   windDir: number,
   *   windSpeed: number,
   *   seaState: number,
   *   wetness: number,
   *   lensWater: number,
   *   flashDir: { x: number, y: number, z: number },
   *   flashColor: number,
   *   bolt: boolean
   * }}
   */
  function update(dt, simTime, aspect = null) {
    const step = Math.min(0.1, Math.max(0, dt))
    fxT += step
    const asp = aspect || rainMat.uniforms.uAspect.value
    rainMat.uniforms.uAspect.value = asp
    glowMat.uniforms.uAspect.value = asp
    boltMat.uniforms.uAspect.value = asp
    const wx = weatherAt(simTime)

    // Lag gloom slightly so the deck never pops even at a slot boundary.
    const lag = 1 - Math.exp(-step * 0.85)
    if (!primed) {
      smoothRainGloom = wx.rainGloom
      smoothStormGloom = wx.stormGloom
    } else {
      smoothRainGloom += (wx.rainGloom - smoothRainGloom) * lag
      smoothStormGloom += (wx.stormGloom - smoothStormGloom) * lag
    }
    const rainGloom = smoothRainGloom
    const stormGloom = smoothStormGloom

    // --- Squalls and gusts -------------------------------------------------
    // Sheets of weather crossing you, not one constant value. Two slow bands
    // beating against each other so the pattern never obviously repeats.
    const squall =
      0.62 +
      0.26 * Math.sin(fxT * 0.085) +
      0.16 * Math.sin(fxT * 0.031 + 2.1) +
      0.08 * Math.sin(fxT * 0.21 + 0.7)
    const gust = Math.min(
      1,
      Math.max(0, 0.5 + 0.32 * Math.sin(fxT * 0.27 + 1.3) + 0.22 * Math.sin(fxT * 0.62))
    )

    // Cover / light from smoothed gloom, with a gentle squall beat on the fog
    // so a front visibly thickens and thins as it passes over.
    // uCloudCover is a threshold (higher = clearer). Fair ~0.60, storm ~0.10.
    const cloudCover = 0.6 - 0.18 * rainGloom - 0.32 * stormGloom
    const sunMul = 1 - 0.4 * rainGloom - 0.58 * stormGloom
    const fogMul =
      (1 + 0.42 * rainGloom + 0.95 * stormGloom) * (1 + 0.14 * (squall - 0.62) * stormGloom)
    const hemiMul = 1 - 0.14 * rainGloom - 0.36 * stormGloom

    // Floor squall a bit so storm never goes "light drizzle" mid-beat.
    const rainVis = Math.min(1.22, wx.rain * Math.max(0.72, squall) * 1.4)

    // --- Wind, sea state, wetness -----------------------------------------
    // Wind bearing is stable within a weather window so the sea has one
    // direction to build in, and drifts slowly rather than swinging about.
    const windDir = hash01(wx.slot * 7.71 + 1.4) * Math.PI * 2 + Math.sin(fxT * 0.017) * 0.25
    const windSpeed = 2.5 + 20 * seaState + gust * 5.5 * (0.3 + stormGloom)

    // Sea builds with the front (gloom leads precipitation) and takes far
    // longer to lie down than it took to get up.
    const seaTarget = Math.min(1, stormGloom * 0.88 + wx.storm * 0.12 + gust * 0.06 * stormGloom)
    if (!primed) seaState = seaTarget
    else seaState += (seaTarget - seaState) * (1 - Math.exp(-step * (seaTarget > seaState ? 0.22 : 0.05)))

    const wetTarget = wx.rain > 0.05 ? Math.min(1, 0.55 + wx.rain * 0.45) : 0
    if (!primed) wetness = wetTarget
    else wetness += (wetTarget - wetness) * (1 - Math.exp(-step * (wetTarget > wetness ? 0.16 : 0.013)))

    primed = true

    // --- Lightning ---------------------------------------------------------
    // Scheduled off the FX clock, not simTime: the shot harness pins simTime,
    // and a schedule that compares against a frozen clock never fires.
    if (wx.storm > 0.35) {
      nextStrikeIn -= step
      if (nextStrikeIn <= 0) {
        if (SHOT_MODE) {
          // Guaranteed near bolt so QA can catch a path. Keep residual short
          // enough that the deck stays dark between hits.
          fireLightning(wx.storm, asp, {
            forceNear: true,
            sx: asp * 0.28,
            az: 0.85,
            seed: 0.37
          })
          nextStrikeIn = 0.9
        } else {
          fireLightning(wx.storm, asp)
          // Storms cluster. Occasionally a second strike right on the first.
          if (Math.random() < 0.3) nextStrikeIn = 0.45 + Math.random() * 1.1
          else nextStrikeIn = 3.2 + Math.random() * 9.5
        }
      }
      // Shot harness: if the path fully died, re-fire so a capture almost always
      // sees either a stroke or its afterimage (not pure empty gloom).
      if (SHOT_MODE && boltVerts > 0 && boltLife <= 0 && boltAfter < 0.08 && nextStrikeIn > 0.2) {
        boltLife = 0.18
        boltAfter = 0.5
        flash = Math.max(flash, 0.35)
        afterglow = Math.max(afterglow, 0.2)
      }
    } else {
      nextStrikeIn = 0
      strokesLeft = 0
    }

    // Return strokes down the same channel, then multi-stage decay: hard hit,
    // residual afterglow in the cloud deck, lingering ion-path afterimage.
    if (strokesLeft > 0) {
      strokeIn -= step
      if (strokeIn <= 0) {
        strokesLeft--
        strokeIn = 0.035 + Math.random() * 0.09
        flash = Math.min(1.05, Math.max(flash, flash * 0.5 + 0.28 + Math.random() * 0.22))
        afterglow = Math.max(afterglow, flash * 0.35)
        if (boltVerts > 0) {
          boltLife = Math.max(boltLife, 0.1 + Math.random() * 0.1)
          boltAfter = Math.max(boltAfter, 0.4)
        }
      }
    }
    // Two-stage flash: hard crack dies fast, soft cloud glow lingers.
    // Shot mode slightly slower residual so a bolt/afterimage can still land in
    // the capture window without milking the frame white for seconds.
    const hardDecay = SHOT_MODE ? 4.2 : 5.6
    const softDecay = SHOT_MODE ? 1.35 : 1.7
    flash = Math.max(0, flash - step * (flash > 0.4 ? hardDecay : softDecay))
    afterglow = Math.max(0, afterglow - step * (SHOT_MODE ? 0.42 : 0.6))
    boltLife = Math.max(0, boltLife - step)
    if (boltLife <= 0) boltAfter = Math.max(0, boltAfter - step * (SHOT_MODE ? 0.55 : 0.9))

    // Combined light contribution for sky / key (directional flash + residual).
    // Cap hard — full-frame white is the clearest fake-lightning tell.
    const flashOut = Math.min(1.05, flash + afterglow * 0.4)

    // --- Push uniforms -----------------------------------------------------
    // Lens water builds earlier in a storm so wet-screen is always visible.
    const lensWater = Math.min(1, Math.max(0, (rainVis - 0.35) * 1.55)) * 0.92
    rainMat.uniforms.uTime.value = fxT
    rainMat.uniforms.uRain.value = rainVis
    rainMat.uniforms.uFlash.value = flashOut
    rainMat.uniforms.uLens.value = lensWater
    // Wind shear: a steady lean, gusting. Rain that falls straight down at sea
    // in a thunderstorm is the second-biggest tell after countable drops.
    rainMat.uniforms.uWind.value =
      (0.14 + 0.36 * stormGloom + 0.2 * gust * stormGloom) *
      (hash01(wx.slot * 3.3) > 0.5 ? 1 : -1)
    rainMesh.visible = rainVis > 0.005 || lensWater > 0.01

    glowMat.uniforms.uFlash.value = flashOut
    glowMat.uniforms.uSheet.value = sheetAmt
    glowMesh.visible = flashOut > 0.003

    // Bolt: hot stroke then soft afterimage on the same path.
    const boltAmt =
      boltLife > 0
        ? Math.min(1.4, 0.55 + boltLife * 5.5)
        : boltAfter > 0
          ? Math.min(0.55, boltAfter * 0.55)
          : 0
    boltMat.uniforms.uBolt.value = boltAmt
    boltMesh.visible = boltAmt > 0.01 && boltVerts > 0
    const titleSafeF = titleSafe ? 1 : 0
    boltMat.uniforms.uTitleSafe.value = titleSafeF
    glowMat.uniforms.uTitleSafe.value = titleSafeF

    const frame = {
      mode: wx.mode,
      rain: wx.rain,
      storm: wx.storm,
      rainGloom,
      stormGloom,
      cloudCover,
      sunMul,
      fogMul,
      hemiMul,
      flash: flashOut,
      thunder: pendingThunder,
      // --- added signals -----------------------------------------------
      /** 0.3–1.15 squall beat; multiply rain-driven effects by it. */
      squall,
      /** 0–1 gust envelope. */
      gust,
      /** World yaw the wind blows toward, radians. */
      windDir,
      /** Rough m/s — for wave build and sail/flag motion. */
      windSpeed,
      /** 0–1 how worked-up the sea should be. Leads and lags the rain. */
      seaState,
      /** 0–1 how wet exposed surfaces are. Rises in minutes, dries in ~90s. */
      wetness,
      /** 0–1 water on the camera's front element. */
      lensWater,
      /** Unit direction from the scene toward the strike (sun-light convention). */
      flashDir,
      /** Colour a strike lights the world with. */
      flashColor: 0xb8ceff,
      /** True while a bolt path is actually drawn on screen. */
      bolt: boltMesh.visible,
      /** 0–1 sheet-lightning blend (distant cloud flash vs near bolt). */
      sheet: sheetAmt,
      /** Cheap rain→water interaction strength for the ocean shader. */
      rainRipple: Math.min(1, rainVis * 0.85 + wetness * 0.25)
    }
    pendingThunder = null
    lastWx = frame
    return frame
  }

  function clear() {
    flash = 0
    afterglow = 0
    boltLife = 0
    boltAfter = 0
    boltVerts = 0
    sheetAmt = 0
    strokesLeft = 0
    nextStrikeIn = 0
    boltGeo.setDrawRange(0, 0)
    rainMat.uniforms.uRain.value = 0
    rainMat.uniforms.uFlash.value = 0
    rainMat.uniforms.uLens.value = 0
    glowMat.uniforms.uFlash.value = 0
    glowMat.uniforms.uSheet.value = 0
    boltMat.uniforms.uBolt.value = 0
    rainMesh.visible = false
    glowMesh.visible = false
    boltMesh.visible = false
    pendingThunder = null
    wetness = 0
    seaState = 0
    primed = false
  }

  /**
   * Pre-warm all WebGPU weather render pipelines, render targets, and shader passes
   * during game boot/session start to completely eliminate mid-gameplay hitches when storms roll in.
   */
  async function preload(renderer) {
    if (!renderer) return
    try {
      renderer.getDrawingBufferSize(drawingBufferSize)
      const w = Math.max(320, drawingBufferSize.x || 1600)
      const h = Math.max(180, drawingBufferSize.y || 900)
      const [rWidth, rHeight] = rainRenderSize(w, h)
      if (rWidth !== rainTargetWidth || rHeight !== rainTargetHeight) {
        rainTarget.setSize(rWidth, rHeight)
        rainTargetWidth = rWidth
        rainTargetHeight = rHeight
      }

      // Pre-populate dummy bolt vertices so bolt buffer pipeline compiles
      buildBolt(0, 1.6, 0.42)
      glowMesh.visible = true
      boltMesh.visible = true
      rainMesh.visible = true

      if (typeof renderer.compileAsync === 'function') {
        await renderer.compileAsync(rainScene, overlayCamera)
        await renderer.compileAsync(lightningScene, overlayCamera)
      } else if (typeof renderer.compile === 'function') {
        renderer.compile(rainScene, overlayCamera)
        renderer.compile(lightningScene, overlayCamera)
      }
      clear()
    } catch (err) {
      console.warn('[weather] pre-warm failed', err)
      clear()
    }
  }

  /**
   * Title / main-menu mode: keep bolt paths and strike bloom out of the logo
   * and menu text. In-game storms leave this off.
   */
  function setTitleSafe(on) {
    titleSafe = !!on
    const v = titleSafe ? 1 : 0
    boltMat.uniforms.uTitleSafe.value = v
    glowMat.uniforms.uTitleSafe.value = v
  }

  return {
    update,
    render,
    clear,
    preload,
    weatherAt,
    setTitleSafe,
    get visible() {
      return rainMesh.visible || glowMesh.visible || boltMesh.visible
    },
    /** Last weather sample (for lighting without re-running particles). */
    get state() {
      return lastWx
    }
  }
}
