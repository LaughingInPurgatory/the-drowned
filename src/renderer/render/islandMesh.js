import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  texture,
  attribute,
  uv,
  mix,
  Fn,
  float,
  vec2,
  vec3,
  positionLocal,
  fract,
  sin,
  floor,
  smoothstep,
  clamp,
  dot
} from 'three/tsl'
import { mulberry32, range, pick } from '../procgen/prng.js'
import { getSurfaceTextures, getPropTextures, getPlantTextures, retileUVsTriplanar } from './textures.js'
import { getTerrainMaterial, getRockPropMaterial } from './terrainMaterial.js'
import { planetArchetypeForBody } from '../game/probe.js'
import { SEA_MAX_AMPLITUDE } from '../world/sea.js'
import {
  getTreeProtos,
  getBushProtos,
  getGrassProtos,
  getGrassMeshData,
  getHeroTreeProtos,
  placePlantClone,
  isNatureReady
} from './natureModels.js'

/**
 * Islands — what is left standing above the water.
 *
 * Built from a displaced disc rather than a sphere: everything below the
 * waterline is invisible and would only cost triangles. The skirt runs a little
 * way under so the swell never reveals a hollow edge.
 *
 * Two things decide how one island differs from the next:
 *   - **archetype** (game/probe.js `planetArchetypeForBody`) sets what it is
 *     made of — bare rock, scrub, a drowned town, a works, fresh basalt — and
 *     therefore its palette, texture and whether ruins stand on it.
 *   - **landform** (below) sets its *shape* — a dome, a ridge, a flat-topped
 *     mesa, a sea stack, an atoll. Without this every island is the same hill
 *     at different sizes, which is what a single radial falloff gives you.
 */

/**
 * Surfaces an island can be made of. An island picks a **shore**, a **body**
 * and a **crown** from these, so a rocky headland can have a sandy beach and a
 * grassy top without needing a texture per combination — the shader blends two
 * of these maps by a per-vertex weight (see `applyBlendShader`).
 */
const SURFACES = {
  // Vertex colours *multiply* albedo maps — stay near-white so photo grain
  // survives; palette only nudges hue (dark greens were crushing maps into
  // a solid plastic blob on the title screen).
  sand: { color: 0xf0e4c8, tex: 'sand', rough: 0.96, metal: 0.0 },
  shingle: { color: 0xe4ddd4, tex: 'shingle', rough: 0.95, metal: 0.01 },
  rock: { color: 0xe2ddd6, tex: 'rocky', rough: 0.94, metal: 0.02 },
  darkRock: { color: 0xc8c2ba, tex: 'rocky', rough: 0.95, metal: 0.02 },
  // Slightly less pure lime so meadow does not read as a plastic green slab
  // under noon key light; soil/dry variation lives in the blend shader.
  grass: { color: 0xd2d6a8, tex: 'grass', rough: 0.93, metal: 0.0 },
  scrub: { color: 0xcfc8a0, tex: 'grass', rough: 0.94, metal: 0.0 },
  ash: { color: 0xb8b0aa, tex: 'ash', rough: 0.97, metal: 0.03 },
  // Concrete / weathered masonry albedo (ambientCG Concrete034 via textures.js).
  ruin: { color: 0xd8d6d0, tex: 'concrete', rough: 0.92, metal: 0.04 },
  works: { color: 0xc8c0b4, tex: 'works', rough: 0.85, metal: 0.18 }
}

/**
 * Archetype → the surfaces it is built from, as [shore, body, crown] options.
 * Most archetypes list sand first for the shore, because most islands on this
 * sea have a beach; the ones that do not have a reason.
 */
const ARCHETYPE_SURFACES = {
  barren: { shore: ['sand', 'sand', 'shingle'], body: ['rock', 'darkRock'], crown: ['rock', 'darkRock', 'scrub'] },
  scrub: { shore: ['sand', 'sand', 'shingle'], body: ['grass', 'scrub'], crown: ['scrub', 'rock', 'grass'] },
  drowned: { shore: ['sand', 'sand', 'shingle'], body: ['ruin', 'shingle'], crown: ['ruin', 'grass'] },
  industrial: { shore: ['sand', 'shingle'], body: ['works', 'darkRock'], crown: ['works', 'rock'] },
  // Fresh basalt has no beach yet — that is the point of it being fresh.
  volcanic: { shore: ['ash', 'ash', 'shingle'], body: ['ash', 'darkRock'], crown: ['ash', 'darkRock'] }
}

/** Wet rock at the waterline, under whatever the shore is made of. */
const TIDE_COLOR = new THREE.Color(0x343c34)
/** Dark algae-stained rock just above the splash — reads as a wet band. */
const WET_BAND_COLOR = new THREE.Color(0x252e26)
/** Bare rock on anything too steep to hold soil, sand or anything else. */
const CLIFF_COLOR = new THREE.Color(0x6b6660)
/** Damp sand just above the tide — cooler/darker than dry beach. */
const WET_SAND_COLOR = new THREE.Color(0xb8a888)
/** Dry beach sand — warm and pale so the shore separates from meadow. */
const DRY_SAND_COLOR = new THREE.Color(0xf2e6c8)

/** Common landforms — equal weight. Spire is rolled separately (rare). */
const LANDFORMS = ['dome', 'ridge', 'mesa', 'stack', 'atoll', 'cluster']
/** How tall each landform stands relative to its radius. */
const LANDFORM_HEIGHT = {
  // A bit taller overall so coasts read as banks, not drowned sandbars.
  dome: [0.18, 0.34],
  ridge: [0.2, 0.36],
  mesa: [0.24, 0.4],
  stack: [0.5, 0.9],
  atoll: [0.07, 0.14],
  cluster: [0.2, 0.38],
  // Tip of a drowned mountain — height often exceeds radius.
  spire: [1.35, 2.45]
}
// Haven is the player's first landfall; keep its silhouette broad and
// climbable rather than letting the home island dominate the horizon.
const HAVEN_HEIGHT_SCALE = 0.65
/** Chance a substantial island is a mountain spire (not a common pick). */
const SPIRE_CHANCE = 0.048

// A 64-segment ring is a 5.6° step, which on an 800 m island is a 78 m chord —
// that is the stair-stepped horizon silhouette, and no shader fixes it. At 192
// the outline reads as a coastline. ~19k vertices per island; main.js keeps
// about thirty resident, so this is well inside budget.
const RINGS = 160
const SEGMENTS = 256
/**
 * Radial ring packing exponent. Must stay identical between the mesh builders
 * and the analytic sampler (`meshGroundY`) or the faceted surface and
 * islandTerrainYAt disagree and feet/vegetation float above visible ground.
 */
const RING_T = 1.25
/** Rings of underwater shelf beyond the coast, so no edge stands proud. */
const SHELF_RINGS = 6
/**
 * How far past the coast the shelf reaches, as a fraction of the radius.
 * Kept short — a wide shallow shelf painted sand under the water looked like
 * a pale lagoon stretching halfway to the horizon.
 */
const SHELF_REACH = 0.04
/**
 * Where the final rim taper starts (fraction of disc radius). Late start =
 * land holds height longer, then drops hard at the waterline.
 */
const RIM_FADE_FROM = 0.97
/** How far the skirt runs below the surface, so no swell can undercut it. */
const SKIRT_DEPTH = SEA_MAX_AMPLITUDE + 14
/**
 * The post-waterline drop sits below the deepest wave trough. Keeping this
 * separate from the visible shoreline preserves beaches/props while hiding
 * the flat construction disc under the sea.
 */
const COAST_FOOT_Y = -SEA_MAX_AMPLITUDE - 2
/** Outer land band (in ring parameter 0..1) forced into the steep coastal bank. */
const COAST_BANK_FROM = 0.86

/** Value noise hash for relief and terrain functions. */
function reliefHash(x, y, s) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return v - Math.floor(v)
}

function reliefNoise(x, y, s) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = reliefHash(ix, iy, s)
  const b = reliefHash(ix + 1, iy, s)
  const c = reliefHash(ix, iy + 1, s)
  const d = reliefHash(ix + 1, iy + 1, s)
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
}

/** Multi-octave value noise for organic 2D relief. */
function reliefFbm(x, y, s, octaves = 3) {
  let f = 1
  let amp = 1
  let sum = 0
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += amp * reliefNoise(x * f, y * f, s + o * 17.3)
    norm += amp
    f *= 1.85
    amp *= 0.52
  }
  return sum / norm
}

/** smoothstep, clamped. */
function smooth01(x, a, b) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * Where a coastline sits between a shelving beach and a sheer cliff.
 *
 * This is the fiction doing geometry: the sea rose over an existing landscape,
 * so what used to be a hillside is now a headland dropping straight into deep
 * water, and what used to be a valley floor is now a bay with a beach in it.
 * One island therefore wants both, on different bearings — a single radial
 * falloff can only give you the same coast the whole way round.
 *
 * Returns `(theta) => 0..1`, 0 = beach, 1 = sheer.
 */
function makeCliffField(rng, landform, archetype) {
  // Some landforms have already decided. A sea stack is all cliff; an atoll is
  // a sand bar and cannot be anything else.
  const bias =
    landform === 'spire' ? 0.94
    : landform === 'stack' ? 0.86
    : landform === 'atoll' ? 0.04
    : landform === 'mesa' ? range(rng, 0.42, 0.78)
    : archetype === 'barren' ? range(rng, 0.34, 0.72)
    : archetype === 'volcanic' ? range(rng, 0.4, 0.8)
    : range(rng, 0.12, 0.55)
  // Few, broad lobes: headlands and bays, not a scalloped edge.
  const waves = []
  const n = 2 + Math.floor(rng() * 3)
  for (let i = 0; i < n; i++) {
    waves.push({
      freq: 1 + Math.floor(rng() * 4),
      phase: rng() * Math.PI * 2,
      amp: range(rng, 0.18, 0.48)
    })
  }
  // Erosion: gullies, chimneys and notches cut into the face itself.
  const notchSeed = rng() * 100
  const notchAmp = landform === 'atoll' ? 0 : range(rng, 0.3, 0.7)
  const field = (theta) => {
    let v = bias
    for (const w of waves) v += w.amp * Math.sin(theta * w.freq + w.phase)
    return Math.max(0, Math.min(1, v))
  }
  field.notch = (theta) => {
    // Natural broad gullies and inlets without high-frequency saw-tooth spikes.
    const a = Math.sin(theta * 4 + notchSeed)
    const b = Math.sin(theta * 6 - notchSeed * 1.5)
    const c = Math.sin(theta * 2 + notchSeed * 0.4)
    const v = a * 0.5 + b * 0.32 + c * 0.18
    return smooth01(v, 0.38, 0.85) * 0.35 * notchAmp
  }
  return field
}

/**
 * Height of one land vertex at ring parameter `t` on bearing `theta`,
 * including the coastal bank.
 *
 * The single definition of where the land stops. The rendered mesh, the props
 * that sit on it, the on-foot ground sample and the shoreline you run aground
 * on all come through here, so "right up to the beach" means the beach you can
 * actually see. Same rule as the sea: one definition, several consumers.
 */
function coastalGroundY(t, theta, height, heightAt, landform, cliffAt = heightAt?.coast) {
  const rr = Math.min(1, Math.max(0, t))
  const cliff = cliffAt ? cliffAt(theta) : landform === 'spire' ? 0.9 : 0.2
  // A cliff holds its ground almost to the waterline; a beach starts shelving
  // a long way out.
  const base = landform === 'spire' ? 0.9 : COAST_BANK_FROM
  const from = base + (0.972 - base) * cliff
  let y = heightAt(rr, theta) * height
  if (rr <= from || rr >= 1) {
    return rr >= 1 ? COAST_FOOT_Y : y
  }
  const bank = (rr - from) / (1 - from)
  const s = bank * bank * (3 - 2 * bank)
  // Sheer coasts stay up, then go over the edge: the exponent is what turns a
  // ramp into a face.
  const bankW = Math.pow(s, 1 + cliff * 5.5)
  const bankTop = heightAt(from, theta) * height
  const hold = (landform === 'spire' ? 0.55 : 0.35) * (1 - cliff * 0.85)
  const yField = Math.max(y, bankTop * Math.pow(1 - bank, hold))
  y = yField * (1 - bankW) + COAST_FOOT_Y * bankW
  // Erosion notches: cut into the top of the face so the silhouette is
  // broken rather than a clean extruded outline.
  if (cliffAt?.notch) {
    const notch = cliffAt.notch(theta) * cliff
    if (notch > 0) y -= notch * bankTop * 0.55 * (0.25 + s * 0.75)
  }
  return y
}
/**
 * World units per UV unit (before texture.repeat). Larger = coarser tiles that
 * still read from the title-screen orbit; too small mipmaps into plastic green.
 * Title camera is ~2.6 km out — 48 was averaging grass to a solid blob.
 */
const TEXTURE_SCALE = 120

function hashString(str) {
  const text = String(str ?? '')
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Deterministic landform for a body, independent of its material archetype. */
export function landformForBody(body) {
  const rng = mulberry32(hashString(`${body?.id ?? 'x'}:landform`))
  const radius = body?.radius ?? 500
  // Mountain tips: rare, only on land large enough to sell the scale.
  if (radius >= 580 && rng() < SPIRE_CHANCE) return 'spire'
  // Small rocks are stacks or bare domes far more often than they are atolls.
  if (radius < 420) return pick(rng, ['stack', 'dome', 'dome', 'cluster'])
  return pick(rng, LANDFORMS)
}

/**
 * Radial height field, 0 at the shore and 1-ish inland, shaped by landform.
 * Returns `(r, theta) => height in 0..1`, where r is 0 at the centre and 1 at
 * the coastline.
 */
function makeHeightField(rng, landform) {
  // Low-frequency lobes break the coastline out of a circle. Every landform
  // gets these; they are what stops two islands reading as the same island.
  const lobes = []
  const count = 3 + Math.floor(rng() * 3)
  for (let i = 0; i < count; i++) {
    lobes.push({
      freq: 1 + Math.floor(rng() * 4),
      phase: rng() * Math.PI * 2,
      amp: range(rng, 0.16, 0.58)
    })
  }
  const lobeAt = (theta) => {
    let v = 1
    for (const l of lobes) v += l.amp * Math.sin(theta * l.freq + l.phase)
    // Cap so lobes reshape the plan, not carve knife fins into the summit.
    return Math.max(0.42, Math.min(1.72, v))
  }

  const noiseSeed = rng() * 1000
  const roughness = range(rng, 0.03, 0.08)
  const detail = (r, theta) => {
    const x = r * Math.cos(theta)
    const z = r * Math.sin(theta)
    return (reliefFbm(x * 2.5, z * 2.5, noiseSeed % 97, 3) - 0.5) * roughness * 1.5 * (1 - r)
  }

  if (landform === 'ridge') {
    // A long spine: tall along one axis, falling away to either side.
    // Sharpness stays moderate — high powers made a knife-edge fin.
    const axis = rng() * Math.PI * 2
    const sharpness = range(rng, 1.2, 2.2)
    return (r, theta) => {
      const along = Math.cos(theta - axis)
      const spine = Math.pow(Math.abs(along), sharpness)
      // Low power → height holds, then the rim fade cuts the waterline hard.
      const base = Math.pow(Math.max(0, 1 - r), 0.38)
      return Math.max(0, base * (0.35 + 0.75 * spine) * lobeAt(theta) + detail(r, theta))
    }
  }

  if (landform === 'mesa') {
    // Flat top with a hard shoulder — a drowned plateau.
    const rim = range(rng, 0.45, 0.72)
    const top = range(rng, 0.82, 1.0)
    return (r, theta) => {
      const l = lobeAt(theta)
      const edge = rim * (0.75 + 0.25 * l)
      // Hard shoulder: little soft foot at the waterline.
      const h =
        r < edge
          ? top
          : top * Math.pow(Math.max(0, (1 - r) / Math.max(1e-3, 1 - edge)), 0.55)
      return Math.max(0, h * l * 0.85 + detail(r, theta) * 0.4)
    }
  }

  if (landform === 'stack') {
    // A sea stack: narrow, near-vertical, barely any shore.
    const waist = range(rng, 0.3, 0.55)
    return (r, theta) => {
      const l = lobeAt(theta)
      const core = Math.pow(Math.max(0, 1 - r / Math.max(0.1, waist * l)), 0.55)
      // Thin apron only — no broad sandy foot.
      const apron = Math.pow(Math.max(0, 1 - r), 5.5) * 0.06
      return Math.max(0, core + apron + detail(r, theta) * 0.3)
    }
  }

  if (landform === 'spire') {
    // Tip of a massive mountain rising from the depths: steep cone, broken
    // buttress ridges, craggy flanks, cliffs into deep water — not a thin
    // stack and not a gentle island hill.
    const peakOffR = range(rng, 0, 0.1)
    const peakOffTh = rng() * Math.PI * 2
    const style = rng()
    const steep = range(rng, style < 0.33 ? 1.25 : 1.65, style > 0.7 ? 3.1 : 2.45)
    const facetFreq = 3 + Math.floor(rng() * 6)
    const facetPhase = rng() * Math.PI * 2
    const secondary =
      style > 0.42
        ? { r: range(rng, 0.18, 0.48), theta: rng() * Math.PI * 2, amp: range(rng, 0.28, 0.72), width: range(rng, 0.12, 0.25) }
        : null
    const ridges = []
    const ridgeN = 3 + Math.floor(rng() * 7)
    for (let i = 0; i < ridgeN; i++) {
      ridges.push({
        theta: rng() * Math.PI * 2,
        amp: range(rng, 0.1, style > 0.65 ? 0.58 : 0.42),
        width: range(rng, 0.1, style < 0.35 ? 0.3 : 0.52)
      })
    }
    const scars = []
    const scarN = 1 + Math.floor(rng() * 4)
    for (let i = 0; i < scarN; i++) {
      scars.push({ theta: rng() * Math.PI * 2, width: range(rng, 0.04, 0.16), depth: range(rng, 0.08, 0.3) })
    }
    const crag = range(rng, 0.07, 0.14)
    return (r, theta) => {
      const l = lobeAt(theta)
      // Peak slightly off-centre so the silhouette is not a perfect cone.
      const px = peakOffR * Math.cos(peakOffTh)
      const pz = peakOffR * Math.sin(peakOffTh)
      const x = r * Math.cos(theta) - px
      const z = r * Math.sin(theta) - pz
      const d = Math.hypot(x, z)
      // Core cone — high power keeps a sharp summit and steep walls.
      let h = Math.pow(Math.max(0, 1 - d / Math.max(0.12, 0.92 * l)), steep)
      if (secondary) {
        let sd = Math.abs(r - secondary.r)
        const angular = Math.cos(theta - secondary.theta)
        sd = Math.hypot(sd, (angular - 1) * secondary.width)
        h += secondary.amp * Math.exp(-(sd * sd) / (2 * secondary.width * secondary.width)) * Math.pow(Math.max(0, 1 - r), 0.7)
      }
      // Buttresses / aretes running down the flanks.
      for (const ridge of ridges) {
        let dt = Math.abs(theta - ridge.theta) % (Math.PI * 2)
        if (dt > Math.PI) dt = Math.PI * 2 - dt
        const along = Math.exp(-(dt * dt) / (2 * ridge.width * ridge.width))
        h += ridge.amp * along * Math.pow(Math.max(0, 1 - r), 0.85)
      }
      // Faceted rock planes and vertical erosion scars break the radial cone
      // into irregular buttresses rather than a smooth mathematical surface.
      const facet = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(theta * facetFreq + facetPhase + r * 8))
      h *= facet
      for (const scar of scars) {
        let dt = Math.abs(theta - scar.theta) % (Math.PI * 2)
        if (dt > Math.PI) dt = Math.PI * 2 - dt
        h -= scar.depth * Math.exp(-(dt * dt) / (2 * scar.width * scar.width)) * Math.pow(Math.max(0, 1 - r), 0.55)
      }
      // High-frequency crag so the rock reads broken rather than smooth.
      h +=
        crag *
        Math.sin(theta * 13 + noiseSeed) *
        Math.sin(r * 19 + noiseSeed * 0.7) *
        Math.pow(Math.max(0, 1 - r), 0.4)
      h += detail(r, theta) * 1.6
      // No sandy apron — the mountain meets the sea as a cliff.
      return Math.max(0, h * (0.88 + 0.12 * l))
    }
  }

  if (landform === 'atoll') {
    // A ring with a lagoon inside it. The lagoon floor stays under water, so
    // the centre reads as enclosed water rather than land.
    const ringR = range(rng, 0.55, 0.78)
    const width = range(rng, 0.12, 0.2)
    return (r, theta) => {
      const l = lobeAt(theta)
      const d = Math.abs(r - ringR * (0.85 + 0.15 * l))
      const ring = Math.exp(-(d * d) / (2 * width * width * 0.2))
      // Break the ring so it is not a perfect donut.
      const gap = 0.55 + 0.45 * Math.sin(theta * 2 + ringR * 10)
      return Math.max(-0.4, ring * l * gap - 0.35 * Math.exp(-(r * r) / 0.08))
    }
  }

  if (landform === 'cluster') {
    // Several small summits — reads as a huddle of rocks rather than one hill.
    // Wider peaks + soft blend so neighbouring summits don't form a thin wall.
    const peaks = []
    const n = 2 + Math.floor(rng() * 3)
    for (let i = 0; i < n; i++) {
      peaks.push({
        r: range(rng, 0.1, 0.5),
        theta: rng() * Math.PI * 2,
        amp: range(rng, 0.5, 1),
        width: range(rng, 0.24, 0.42)
      })
    }
    return (r, theta) => {
      const x = r * Math.cos(theta)
      const z = r * Math.sin(theta)
      let h = 0
      for (const pk of peaks) {
        const px = pk.r * Math.cos(pk.theta)
        const pz = pk.r * Math.sin(pk.theta)
        const d2 = (x - px) ** 2 + (z - pz) ** 2
        h = Math.max(h, pk.amp * Math.exp(-d2 / (2 * pk.width * pk.width)))
      }
      // Soft plan variation (not full lobe multiply — that carved fins at the pole).
      const plan = 0.85 + 0.15 * lobeAt(theta)
      return Math.max(0, h * Math.pow(Math.max(0, 1 - r), 0.32) * plan + detail(r, theta) * 0.7)
    }
  }

  // dome — the plain case: highest inland, falling to the shore, with a ridge
  // line so bigger islands read as having a spine rather than being a bump.
  const ridgeAngle = rng() * Math.PI * 2
  const ridgeStrength = range(rng, 0, 0.32)
  return (r, theta) => {
    // Low power: banks stay high then the rim cut drops them at the waterline.
    const base = Math.pow(Math.max(0, 1 - r), 0.36)
    const ridge = 1 + ridgeStrength * Math.abs(Math.cos(theta - ridgeAngle))
    return Math.max(0, base * lobeAt(theta) * ridge + detail(r, theta))
  }
}

/**
 * Bearings sampled around an island when tracing its coastline. Deliberately a
 * multiple of SEGMENTS: the mesh evaluates the height field at its own
 * bearings, and if the trace samples fewer, land can stand up between two of
 * them — visible ground with no collision behind it.
 */
const SHORE_SAMPLES = 512
/** Radial steps per bearing. More is a tighter shoreline, at build cost only. */
const SHORE_STEPS = 48
/**
 * How far land must stand above mean water to count as "shore" for grounding.
 * Low enough that the collision line sits near the visual waterline (not metres
 * inland of sand you can see), high enough that wave troughs alone don't open
 * a hole through a headland.
 */
const GROUNDING_HEIGHT = Math.max(0.35, SEA_MAX_AMPLITUDE * 0.12)

/**
 * Small water buffer kept clear outside the traced waterline. The hull
 * collision radius supplies the real physical clearance around the visible
 * land, while this small buffer prevents visual z-fighting at the waterline.
 */
export const SHORE_KEEP_OUT = 0.25

/**
 * The island's shape, built once and cached on the body.
 *
 * Shared deliberately: the mesh you can see and the shoreline you run aground
 * on come from the same height field, so "right up to the beach" means the
 * actual beach rather than a circle drawn round the whole disc. Same rule as
 * the sea — one definition, two consumers.
 */
const islandProfiles = new WeakMap()

export function getIslandProfile(body) {
  const cached = islandProfiles.get(body)
  if (cached) return cached

  const seed = body.shapeSeed ?? hashString(body.id)
  const rng = mulberry32(seed)
  const archetype = planetArchetypeForBody(body) ?? 'barren'
  const landform = landformForBody(body)
  // Pick this island's three surfaces. Deterministic, so the beach you
  // remember is the beach you come back to.
  // Spire: always craggy rock — the tip of a drowned mountain, not a beach.
  let surfaces
  if (landform === 'spire') {
    surfaces = {
      shore: SURFACES[pick(rng, ['rock', 'darkRock', 'shingle'])],
      body: SURFACES[pick(rng, ['darkRock', 'rock', 'darkRock'])],
      crown: SURFACES[pick(rng, ['rock', 'darkRock'])]
    }
  } else {
    const opts = ARCHETYPE_SURFACES[archetype] ?? ARCHETYPE_SURFACES.barren
    surfaces = {
      shore: SURFACES[pick(rng, opts.shore)],
      body: SURFACES[pick(rng, opts.body)],
      crown: SURFACES[pick(rng, opts.crown)]
    }
  }
  const radius = Math.max(60, body.radius ?? 400)
  const heightBand = LANDFORM_HEIGHT[landform] ?? LANDFORM_HEIGHT.dome
  const heightScale = body?.name === 'Haven Reach' ? HAVEN_HEIGHT_SCALE : 1
  const height = radius * range(rng, heightBand[0], heightBand[1]) * heightScale
  const baseHeight = makeHeightField(rng, landform)
  const greenTerrain = archetype === 'scrub' || archetype === 'drowned'
  const reliefSeed = hashString(`${body?.id ?? 'island'}:rolling-ground`) * 0.001
  const roughnessSeed = hashString(`${body?.id ?? 'island'}:surface-roughness`) * 0.001
  // Relief amplitude as a fraction of island height. The old values were a
  // tenth of this and the mesh only had 52 rings to carry them, so every
  // island rendered as one smooth dome whatever was in the field.
  const surfaceRoughness =
    landform === 'atoll' ? 0.12
    : landform === 'mesa' ? 0.24
    : archetype === 'barren' || archetype === 'volcanic' ? 0.52
    : 0.38

  // ── Erosion relief ────────────────────────────────────────────────────────
  // What turns a dome into a coastline. The terms below are the two things a
  // radial falloff cannot give you, in the order they read from the water.
  //
  // **Terraces.** The sea did not stop where it is now. Every stillstand on the
  // way up cut a bench into the slope, and a bench is a flat tread under a
  // near-vertical riser. It is the strongest drowned-coastline cue there is,
  // and it does the splat's job as a side effect: treads are flat enough to
  // hold turf, risers are steep enough to stay bare rock, so the hillside stops
  // being one uniform grey wash. Warped in bearing so they follow the rock
  // instead of ringing the island like a contour line.
  //
  // **Tors.** A handful of resistant outcrops standing proud of the slope,
  // because a skyline with nothing breaking it reads as geometry, not land.
  //
  // The ceiling on all of this is the mesh: RINGS × SEGMENTS puts a vertex
  // every 6–10 m on a large island, so anything narrower than about 20 m cannot
  // be represented and only aliases against the ring grid.
  const reliefRng = mulberry32(seed ^ 0x9e3779b9)
  const terraceSeed = hashString(`${body?.id ?? 'island'}:terraces`) * 0.001
  // Steps across the island's full height. Few and tall on bare rock (big
  // cliffs), more and shallower on soft green ground.
  // Deliberately few. The mesh is the constraint again: a riser is only a
  // cliff if the grid can put two vertices on it, and at fifteen steps across
  // a 70 m island the riser was under ten metres of ground run — narrower than
  // the vertex spacing, so `computeVertexNormals` averaged the whole staircase
  // straight back into the smooth slope it was cut from. Half as many steps
  // makes each one twice as tall and twice as wide, and it survives.
  const terraceCount =
    landform === 'atoll' ? 0
    : archetype === 'barren' || archetype === 'volcanic' ? Math.round(range(reliefRng, 4, 7))
    : Math.round(range(reliefRng, 5, 9))
  // How much of the slope the terracing replaces. 1 would be a perfect
  // staircase; leaving some of the smooth field in keeps the treads reading as
  // ground rather than as a wedding cake.
  const terraceBite =
    landform === 'atoll' ? 0
    : landform === 'spire' ? 0.42
    : archetype === 'barren' || archetype === 'volcanic' ? 0.88
    : 0.74
  const tors = []
  if (landform !== 'atoll' && landform !== 'stack' && landform !== 'spire') {
    const n = 2 + Math.floor(reliefRng() * 4)
    for (let i = 0; i < n; i++) {
      tors.push({
        r: range(reliefRng, 0.1, 0.74),
        theta: reliefRng() * Math.PI * 2,
        amp: range(reliefRng, 0.12, 0.34),
        w: range(reliefRng, 0.08, 0.16)
      })
    }
  }

  const rawHeight = (r, theta) => {
    const base = baseHeight(r, theta)
    const rr = Math.max(0, Math.min(1, r))
    // Relief has to survive out to the coast — the old envelope went to zero at
    // both ends, so every gully died before it reached the sea and every island
    // met the water as a clean unbroken curve.
    const envelope = (0.34 + 0.66 * Math.sin(Math.PI * rr)) * Math.pow(Math.max(0, 1 - rr), 0.3)
    const px = rr * Math.cos(theta)
    const pz = rr * Math.sin(theta)
    let h = base
    if (landform !== 'spire') {
      // Shared macro/mid/fine breakup for every surface: bare rock gets more
      // bite, atolls stay comparatively calm, and the rim fades back to the
      // same bank used by the shoreline and placeable sampler.
      const macro =
        Math.sin(px * 5.2 + roughnessSeed) * Math.cos(pz * 4.4 - roughnessSeed * 0.7) * 0.56 +
        Math.sin((px + pz) * 8.4 + roughnessSeed * 1.3) * 0.24 +
        Math.cos(theta * 15.0 + rr * 23.0 - roughnessSeed * 0.4) * 0.2
      // Ridges and gullies. Ridged noise (1 - |sin|) cuts V-shaped valleys and
      // leaves sharp spurs between them; plain sines only ever give you
      // rolling swells, which is the shape that reads as a hill made of clay.
      //
      // `1 - |sin|` doubles the bearing frequency, so these are capped at 12,
      // not 24: SEGMENTS is 192, |sin(theta * 12)| repeats every 8 samples, and
      // anything faster only aliases into a zigzag along the ring grid. The old
      // 27 was three and a half samples a cycle and got three times louder when
      // the relief amplitude went up.
      const spur = 1 - Math.abs(Math.sin(theta * 5 + roughnessSeed + rr * 3.1))
      const gully = 1 - Math.abs(Math.sin(theta * 9 - roughnessSeed * 1.7 + rr * 6.4))
      const fine = 1 - Math.abs(Math.sin(theta * 12 + roughnessSeed * 0.9 - rr * 11))
      const cut = spur * spur * 0.55 + gully * gully * 0.3 + fine * fine * 0.15
      // Weight the cuts toward the flanks: valleys run down to the sea, they
      // do not carve through the summit.
      const flank = Math.pow(rr, 0.6)
      h += (macro * 0.7 - cut * 0.65 * flank) * surfaceRoughness * envelope
      // Non-radial relief. The terms above are all functions of (r, theta), so
      // whatever they do they do it symmetrically about the summit — which is
      // exactly what makes an island read as a smooth dome from the water.
      // `reliefFbm` is the only thing in the field that can put a shoulder on
      // one side and a hollow on the other.
      const fbm = reliefFbm(px * 1.9 + 3.7, pz * 1.9 - 1.3, roughnessSeed) - 0.5
      // Ridged noise on top: sharp crests, rounded hollows. Squared so the
      // crests stay narrow — plain fBm only ever gives rolling swells, which is
      // the shape that reads as a hill made of clay.
      const crest = 1 - Math.abs(reliefNoise(px * 3.4 + 8.1, pz * 3.4 - 5.2, roughnessSeed + 41) * 2 - 1)
      h += (fbm * 1.15 + (crest * crest - 0.33) * 0.5) * surfaceRoughness * envelope
    }
    // Tors. Flat-topped rather than Gaussian — an outcrop is a block that
    // resisted, not a mound that accumulated.
    for (const tor of tors) {
      const dx = px - tor.r * Math.cos(tor.theta)
      const dz = pz - tor.r * Math.sin(tor.theta)
      const d2 = dx * dx + dz * dz
      const w2 = tor.w * tor.w
      h += tor.amp * Math.exp(-(d2 * d2) / (2 * w2 * w2)) * Math.pow(Math.max(0, 1 - rr), 0.5)
    }
    // Terraces. `smooth01(f, 0.72, 1)` is the whole trick: seven tenths of each
    // step is a level tread and the last three tenths carries the entire rise,
    // so the riser is roughly three and a half times the slope it was cut into
    // — a cliff on a hillside, not a gentler hillside.
    if (terraceCount > 0 && h > 0.03) {
      const warp =
        Math.sin(theta * 3 + terraceSeed) * 0.34 +
        Math.sin(theta * 7 - terraceSeed * 1.7) * 0.19 +
        Math.sin(px * 6.1 + pz * 4.7 + terraceSeed) * 0.15
      const t = h * terraceCount + warp
      const k = Math.floor(t)
      // 86% level tread, 14% riser — the riser is therefore about seven times
      // the slope it replaced. At 0.78 it was four and a half, which on a
      // 1-in-6 hillside is a 37° bank, i.e. a slightly steeper hillside.
      const stepped = (k + smooth01(t - k, 0.86, 1)) / terraceCount
      // Little bite at the summit (a plateau does not need cutting), full bite
      // on the flanks where the sea actually worked.
      const bite = terraceBite * (0.3 + 0.7 * Math.min(1, rr * 1.7))
      h = h * (1 - bite) + Math.max(0, stepped) * bite
    }
    if (greenTerrain && landform !== 'spire' && landform !== 'stack') {
      // Grassy islands also get broader meadow folds so their surface does
      // not read as a single smooth green dome from the water.
      const rolling =
        Math.sin(px * 3.4 + reliefSeed) * Math.cos(pz * 4.6 - reliefSeed * 0.7) * 0.58 +
        Math.sin(px * 7.8 - pz * 5.9 + reliefSeed * 0.9) * 0.24 +
        Math.sin(theta * 5.0 + rr * 12.0 + reliefSeed * 1.4) * 0.18
      const gullies = Math.cos((px - pz) * 13.0 + reliefSeed * 0.35) * 0.035
      h += (rolling * 0.105 + gullies) * envelope
    }
    return Math.max(0, h)
  }
  // Independent coastline warp: deterministic per island, and separate from
  // the summit height field so every island gets a different footprint.
  const shapeRng = mulberry32(seed ^ 0x6d2b79f5)
  const coastAxis = shapeRng() * Math.PI * 2
  const coastStretch = range(shapeRng, -0.28, 0.34)
  const coastWaves = []
  const coastWaveN = 2 + Math.floor(shapeRng() * 4)
  for (let i = 0; i < coastWaveN; i++) {
    coastWaves.push({
      freq: 1 + Math.floor(shapeRng() * 5),
      phase: shapeRng() * Math.PI * 2,
      amp: range(shapeRng, 0.05, 0.18)
    })
  }
  const isHaven = body?.name === 'Haven Reach'
  const havenAxis = isHaven ? shapeRng() * Math.PI * 2 : 0
  const havenCoveAxis = isHaven ? havenAxis + range(shapeRng, 0.85, 1.2) : 0
  const havenBackCoveAxis = isHaven ? havenAxis + Math.PI + range(shapeRng, -0.35, 0.35) : 0
  const warpedRadius = (r, theta) => {
    let scale = 1 + coastStretch * Math.cos(theta - coastAxis) ** 2
    for (const wave of coastWaves) scale += wave.amp * Math.sin(theta * wave.freq + wave.phase)
    if (isHaven) {
      // Haven grew around an old settlement, not a volcanic plug: one broad
      // headland, a deep harbour-side bite, and a smaller lee-side cove give
      // its shoreline a readable silhouette from the title orbit.
      const headland = Math.max(0, Math.cos(theta - havenAxis))
      const harbourCove = Math.max(0, Math.cos(theta - havenCoveAxis))
      const backCove = Math.max(0, Math.cos(theta - havenBackCoveAxis))
      scale += 0.24 * headland ** 4
      scale -= 0.28 * harbourCove ** 6
      scale -= 0.14 * backCove ** 8
      scale += 0.06 * Math.sin(theta * 3 - havenAxis * 0.7)
    }
    return Math.max(0, Math.min(1.18, r * scale))
  }
  // Disc mesh collapses every theta to one XZ point at r = 0. Height fields
  // still vary with angle there (lobes, ridge spines, detail noise), which
  // stacks different Ys on the same pole and grows a vertical fin / knife edge
  // on the silhouette. Pin a single centre height and blend out to angular
  // variation over a short radius so the summit is a dome, not a blade.
  let poleH = 0
  for (let i = 0; i < 12; i++) poleH += rawHeight(0, (i / 12) * Math.PI * 2)
  poleH /= 12
  const POLE_BLEND = 0.1
  // Force every landform to reach nothing by the disc edge. Some of them (mesa,
  // atoll, cluster) can still be above water at r = 1, and the shelf beyond
  // that starts from wherever the land finished — so land ended up standing
  // proud *outside* the traced coastline, which is water you can sail through.
  // Rim fade is short and quadratic so the last few metres drop hard rather
  // than feathering into a wide sandbar.
  const heightAt = (r, theta) => {
    if (r >= 1) return 0
    if (r <= 1e-5) return poleH
    const fieldR = warpedRadius(r, theta)
    let h = rawHeight(fieldR, theta)
    if (r < POLE_BLEND) {
      // smoothstep so the pole is one height and flanks open smoothly
      const t = r / POLE_BLEND
      const s = t * t * (3 - 2 * t)
      h = poleH * (1 - s) + h * s
    }
    if (r > RIM_FADE_FROM) {
      const u = (r - RIM_FADE_FROM) / (1 - RIM_FADE_FROM)
      // Hard front-loaded cut — most of the height dies in the first third of
      // the rim band so boats meet a bank, not a long sand ramp.
      const rim = Math.pow(1 - u, 2.6)
      h *= rim
    }
    return h
  }

  // Which bearings are cliff and which are bay. Its own stream, so changing
  // the summit shape does not reshuffle the coast.
  const cliffAt = makeCliffField(mulberry32(seed ^ 0x9e3779b9), landform, archetype)
  // The coast field rides on the height field rather than being threaded
  // through ten prop-placement signatures. They are one description of the
  // island's shape and every ground sample needs both, so they travel
  // together — see `coastalGroundY`, which defaults to picking it up here.
  heightAt.coast = cliffAt

  // Trace the coastline: per bearing, the furthest point still standing above
  // the waterline. Everything beyond that is open water you can sail into —
  // which for a sea stack or a broken atoll is most of the disc.
  //
  // Tested against the *banked* ground, not the raw height field: a cliff
  // bearing carries its height a long way further out than the field alone
  // says, and grounding on the field would let a hull sail into a visible
  // headland.
  const shore = new Float32Array(SHORE_SAMPLES)
  let maxShore = 0
  const isLand = (r, theta) =>
    coastalGroundY(r, theta, height, heightAt, landform, cliffAt) > GROUNDING_HEIGHT
  for (let i = 0; i < SHORE_SAMPLES; i++) {
    const theta = (i / SHORE_SAMPLES) * Math.PI * 2
    // Coarse scan inward for the outermost step that is still land...
    let lo = 0
    let hi = 0
    for (let sIdx = SHORE_STEPS; sIdx >= 1; sIdx--) {
      if (isLand(sIdx / SHORE_STEPS, theta)) {
        lo = sIdx / SHORE_STEPS
        hi = Math.min(1, (sIdx + 1) / SHORE_STEPS)
        break
      }
    }
    // ...then bisect for the waterline itself. Without this the coastline
    // quantises to the scan step, and on a shallow shore every bearing lands on
    // the same step — a circle again, which is the whole thing we are avoiding.
    if (lo > 0) {
      for (let b = 0; b < 14; b++) {
        const mid = (lo + hi) / 2
        if (isLand(mid, theta)) lo = mid
        else hi = mid
      }
    }
    shore[i] = lo * radius
    if (shore[i] > maxShore) maxShore = shore[i]
  }
  // A hair of slack, so the outermost mesh vertex is never outside the shell
  // that the cheap reject in resolveBodyCollisions tests against.
  maxShore *= 1.01

  // No live rng on the profile — mesh props re-seed from body id so rebuilds
  // (title → game, collision probe → mesh) stay bit-identical.
  const profile = { archetype, surfaces, landform, radius, height, heightAt, cliffAt, shore, maxShore }
  // A WeakMap, not a field on the body. The world is structured-cloned to the
  // main process on every save, and this profile holds closures — parking it on
  // the body made saving throw "object could not be cloned".
  islandProfiles.set(body, profile)
  return profile
}

/**
 * Distance from an island's centre to its shoreline on the bearing of a world
 * point. This is what a hull grounds on (includes SHORE_KEEP_OUT).
 */
export function islandShorelineToward(body, x, z) {
  const profile = getIslandProfile(body)
  const theta = Math.atan2(z - body.position[2], x - body.position[0])
  const t = ((theta / (Math.PI * 2)) % 1 + 1) % 1
  // Take the *outer* of the two bracketing samples rather than blending them.
  // Between bearings the true coast can bulge past a linear interpolation, and
  // erring outward means you ground a metre early somewhere rather than sailing
  // through a headland you can see.
  const f = t * SHORE_SAMPLES
  const i0 = Math.floor(f) % SHORE_SAMPLES
  const i1 = (i0 + 1) % SHORE_SAMPLES
  return Math.max(profile.shore[i0], profile.shore[i1]) + SHORE_KEEP_OUT
}

/** Furthest the land reaches — the shell for targeting, arrival, and cheap culls. */
export function islandMaxShoreline(body) {
  return getIslandProfile(body).maxShore + SHORE_KEEP_OUT
}

const terrainHash = Fn(([p]) => {
  const n = p.dot(vec2(127.1, 311.7))
  return fract(sin(n).mul(43758.5453))
})

const terrainNoise = Fn(([p]) => {
  const i = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const a = terrainHash(i)
  const b = terrainHash(i.add(vec2(1, 0)))
  const c = terrainHash(i.add(vec2(0, 1)))
  const d = terrainHash(i.add(vec2(1, 1)))
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y)
})

/**
 * WebGPU island surface: MeshStandardNodeMaterial with dual-map blend + meadow
 * detail (replaces onBeforeCompile GLSL which WebGPU cannot run).
 *
 * Vertex `aBlend` weight mixes shore sand over body; meadow islands also get
 * multi-scale soil/dry patches that stay off the beach band.
 */
function createIslandSurfaceMaterial(baseMaps, accentMaps, terrainMaps, meadowSurface) {
  const hasAccent = Boolean(accentMaps?.map)
  const hasTerrain = Boolean(terrainMaps?.map)
  const baseMap = baseMaps?.map ?? null
  const normalMap = baseMaps?.normalMap ?? null

  const material = new MeshStandardNodeMaterial({
    map: hasAccent || hasTerrain ? null : baseMap,
    normalMap: normalMap,
    roughnessMap: null,
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    envMapIntensity: 0.06,
    normalScale: new THREE.Vector2(meadowSurface ? 1.55 : 1.25, meadowSurface ? 1.55 : 1.25)
  })

  if (!hasAccent && !hasTerrain) return material

  // Manual albedo: base + optional shore accent + optional meadow rock patches.
  // Vertex colours still multiply via NodeMaterial setupDiffuseColor.
  const aBlend = attribute('aBlend', 'float')
  const uv0 = uv()
  const pos = positionLocal

  material.colorNode = Fn(() => {
    let body = baseMap ? texture(baseMap, uv0).rgb : vec3(1, 1, 1)
    const shoreMask = hasAccent ? clamp(aBlend, float(0), float(1)) : float(0)
    const accent = hasAccent ? texture(accentMaps.map, uv0).rgb : body

    if (hasTerrain) {
      // Meadow detail inland — never overwrites pure beach sand.
      const detailUv = uv0.mul(3.2).add(vec2(7.31, -11.17))
      const closeGrass = baseMap ? texture(baseMap, detailUv).rgb : body
      const xz = vec2(pos.x, pos.z)
      const broad = terrainNoise(xz.mul(0.0024).add(vec2(3.0, 8.0)))
      const medium = terrainNoise(xz.mul(0.008).add(vec2(-4.0, 2.0)))
      const fine = terrainNoise(xz.mul(0.022).add(vec2(9.0, -3.0)))
      const patchNoise = broad.mul(0.55).add(medium.mul(0.3)).add(fine.mul(0.15))
      const exposedSoil = smoothstep(float(0.42), float(0.68), patchNoise)
      const dryPatch = smoothstep(float(0.28), float(0.5), float(1).sub(patchNoise)).mul(
        float(1).sub(exposedSoil)
      )
      const rock = texture(terrainMaps.map, uv0.mul(0.72).add(vec2(-4.0, 5.0))).rgb
      const soil = mix(rock.mul(vec3(0.88, 0.9, 0.86)), vec3(0.28, 0.18, 0.09), 0.68)
      const dry = mix(vec3(0.42, 0.38, 0.22), rock.mul(vec3(0.95, 0.92, 0.8)), 0.35)
      const luma = closeGrass.dot(vec3(0.3, 0.5, 0.2))
      const closeTint = mix(closeGrass, vec3(luma), 0.22)
      let grass = mix(body, body.mul(float(0.55).add(closeTint.mul(0.9))), 0.52)
      grass = grass.mul(
        mix(vec3(0.62, 0.68, 0.42), vec3(1.05, 1.02, 0.72), medium.mul(0.85).add(fine.mul(0.2)))
      )
      grass = mix(grass, dry, dryPatch.mul(0.55))
      body = mix(grass, soil, exposedSoil.mul(0.78))
    }

    // Shore sand wins on beach vertices (aBlend high).
    return mix(body, accent, shoreMask)
  })()

  return material
}

/**
 * Per-archetype palette tint. Deliberately close to white: the layers carry
 * the look, and this only says which island you are standing on.
 */
const ARCHETYPE_TINT = {
  barren: [1.0, 0.98, 0.94],
  scrub: [0.99, 1.0, 0.95],
  drowned: [0.95, 0.99, 0.95],
  industrial: [1.06, 0.97, 0.87],
  volcanic: [0.72, 0.7, 0.72]
}

/**
 * Author the splat weights the shared terrain material blends between, plus
 * the island's palette tint.
 *
 * This is the terrain logic — the shader only executes it. Sand collects where
 * it is low and flat, shingle where the wash reaches but sand cannot hold,
 * turf where soil could survive, rock everywhere too steep for any of it.
 * Getting this wrong shows up as grass growing on a vertical cliff.
 */
function paintTerrainWeights({
  geometry,
  heights,
  positions,
  radius,
  height,
  landform,
  archetype,
  meadowSurface,
  seed
}) {
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const terrain = geometry.getAttribute('aTerrain')

  // How much green this island could support at all. Bare rock islands must
  // not sprout turf just because a slope happens to be gentle.
  const vegetation =
    landform === 'spire' || landform === 'stack' ? 0.02
    : archetype === 'volcanic' ? 0.1
    : archetype === 'barren' ? 0.28
    : archetype === 'industrial' ? 0.5
    : meadowSurface ? 1
    : 0.72
  // Sand needs somewhere to accumulate. A sea stack has nowhere.
  const sandiness =
    landform === 'spire' || landform === 'stack' ? 0.05
    : landform === 'atoll' ? 1.2
    : archetype === 'volcanic' ? 0.35
    : 0.9

  // Beach band scales with the island, floored above the swell so a wave
  // trough never exposes dry sand below the waterline.
  // Capped in absolute metres, not just as a fraction of the island. A beach is
  // a few metres of vertical range whatever the hill behind it is doing, and
  // `height * 0.05` on a 400 m island put dry sand 20 m up the slope and the
  // storm beach at 50 — which is why a coast read as a desert dune rolling into
  // the sea rather than as a shoreline.
  const beachTop = Math.min(7, Math.max(SEA_MAX_AMPLITUDE * 1.35, height * 0.04))
  // A storm beach is the line of shingle the biggest sea of the year throws up.
  // It is a couple of metres above the tide, not fourteen: at 2.6× a 5.4 m
  // beach the cobbles reached 14 m, and 14 m of vertical range on a coastal
  // bank that is nearly edge-on from the water is most of the island you can
  // actually see — which is why every island had a wide pale collar round it.
  const stormTop = beachTop * 1.75

  const s0 = (seed % 997) * 0.031
  const s1 = ((seed >> 7) % 991) * 0.017
  const tintBase = ARCHETYPE_TINT[archetype] ?? ARCHETYPE_TINT.barren
  // Per-island hue jitter so two scrub islands are not the same green.
  const jr = 0.94 + ((seed % 89) / 89) * 0.14
  const jg = 0.94 + (((seed >> 5) % 83) / 83) * 0.14
  const jb = 0.94 + (((seed >> 11) % 79) / 79) * 0.14

  for (let i = 0; i < terrain.count; i++) {
    const y = heights[i]
    const px = positions[i * 3]
    const pz = positions[i * 3 + 2]
    const slope = Math.max(0, Math.min(1, 1 - normal.getY(i)))
    const f = Math.max(0, Math.min(1, y / Math.max(1, height)))

    // Cover patchiness on a scale of tens of metres. The shader adds its own
    // macro noise on top; this one exists so the *logic* varies across the
    // island rather than being a set of perfect contour bands.
    //
    // The four sines this replaces ran at 0.0042–0.024 rad/m — wavelengths of
    // 260 m to 1.5 km. On a 400 m island that is less than one full cycle of
    // the loudest term, so "multi-scale patchiness" evaluated to very nearly a
    // single constant across the whole landform: whatever it decided, it
    // decided for the entire island. That is most of why every island came out
    // as one uniform wash of one colour.
    const p = reliefFbm(px / 115 + s0, pz / 115 - s1, seed % 61)

    // Rock: anything too steep to hold anything else, plus exposed summits.
    // Underwater is rock too — sand under the sea is what made the old coasts
    // read as pale shallows stretching to the horizon.
    let rock = smooth01(slope, 0.12, 0.4)
    rock = Math.max(rock, y < 0 ? 1 : 0)
    rock = Math.max(rock, smooth01(f, 0.62, 0.95) * (1 - vegetation * 0.7))
    // Bedrock breaking through the cover, on a scale of tens of metres and
    // independent of slope. Without it an island is soil and turf all the way
    // down and reads as parkland: the mesh on a large island is too coarse to
    // carry a face steep enough for the slope rule alone to expose any stone,
    // so the geology has to be stated rather than derived.
    // Same wavelength bug as `patch`, same consequence: at 0.0083 rad/m one
    // cycle is 757 m, so on most islands this was a constant and the island was
    // either all bedrock or none. 60 m outcrops with 17 m detail on them is
    // what a hillside actually shows, and the mesh carries it (a vertex every
    // 6–13 m).
    const bedrock = reliefFbm(px / 64 - s1, pz / 64 + s0, (seed >> 3) % 53)
    rock = Math.max(
      rock,
      smooth01(bedrock, 0.5, 0.7) * smooth01(y, beachTop * 0.7, beachTop * 2) * (1 - vegetation * 0.35)
    )

    // Sand: low, flat, and only where there is a beach to be had.
    const lowBand = 1 - smooth01(y, beachTop * 0.35, beachTop)
    let sand = lowBand * (1 - smooth01(slope, 0.1, 0.3)) * sandiness
    if (y < -1) sand *= 0.15 // a little bar just under the surface, then rock

    // Shingle: the storm beach above the sand, and the wash on shores too
    // steep for sand to stay on. It belongs to the coast and nowhere else —
    // a general "scree on moderate slopes" term wraps the whole hill in
    // cobbles, and because the shingle height field peaks at 1 on every stone
    // it then wins the height blend everywhere it is allowed to exist.
    const stormBand =
      smooth01(y, beachTop * 0.2, beachTop * 0.8) * (1 - smooth01(y, beachTop, stormTop))
    let shingle = stormBand * (1 - smooth01(slope, 0.3, 0.62))
    shingle = Math.max(shingle, lowBand * smooth01(slope, 0.12, 0.4) * 0.9)

    // Turf: above the wash, off the cliffs, and thicker in the sheltered
    // patches than on the exposed ones.
    let grass =
      vegetation *
      smooth01(y, beachTop * 0.7, beachTop * 2.2) *
      (1 - smooth01(slope, 0.24, 0.55)) *
      (0.45 + p * 0.75)
    // Thin out toward an exposed summit — wind kills cover before altitude does.
    grass *= 1 - smooth01(f, 0.55, 0.92) * 0.75

    // Rock wins outright where it is genuinely steep; nothing else clings on.
    const bare = smooth01(slope, 0.42, 0.68)
    sand *= 1 - bare
    shingle *= 1 - bare * 0.85
    grass *= 1 - bare

    // Sharpen before normalising. A vertex is mostly made of one thing; the
    // raw terms above all stay slightly nonzero everywhere, and four slightly
    // nonzero weights is four textures averaged together, which is beige. Cubed
    // and renormalised, 0.40/0.30/0.20/0.10 becomes 0.64/0.27/0.08/0.01 — the
    // dominant layer actually wins and the second is still there to blend
    // against. This is what "hard transitions" means on the CPU side; the
    // shader's macro noise is what stops those transitions following the mesh
    // rings.
    const k3 = (v) => v * v * v
    const cs = k3(sand)
    const ch = k3(shingle)
    const cg = k3(grass)
    const cr = k3(rock)
    const sum = cs + ch + cg + cr || 1
    terrain.setXYZW(i, cs / sum, ch / sum, cg / sum, cr / sum)

    // Tint: archetype base, jittered per island, with a slight extra darkening
    // in the low ground so hollows read as damper than the ridges.
    // Macro value drift baked into the vertex tint. This is the one variation
    // that cannot be smeared by grazing incidence or dissolved by a distance
    // fade, because it is interpolated across the mesh rather than sampled from
    // a texture — so it is the right place to carry "drier crest, greener
    // hollow" over a whole hillside. 0.16 was too narrow to see.
    const shade = 0.84 + p * 0.3
    color.setXYZ(
      i,
      Math.min(1.4, tintBase[0] * jr * shade),
      Math.min(1.4, tintBase[1] * jg * shade),
      Math.min(1.4, tintBase[2] * jb * shade)
    )
  }
  terrain.needsUpdate = true
  color.needsUpdate = true
}

export function buildIslandTerrainMesh(body) {
  const { archetype, surfaces, landform, radius, height, heightAt, cliffAt } = getIslandProfile(body)

  const positions = []
  const uvs = []
  const colors = []
  const blends = []
  const terrain = []
  const meadowSurface =
    archetype === 'scrub' || surfaces.body.tex === 'grass' || surfaces.crown.tex === 'grass'

  // Land rings are distributed smoothly across the island with subtle packing at coast
  const rings = RINGS
  const shelfRings = SHELF_RINGS
  const total = rings + shelfRings
  // Mountain tips dive deeper under the swell so the rock reads as rising
  // from the abyss rather than sitting on a shallow shelf.
  const skirtDepth = landform === 'spire' ? SKIRT_DEPTH + 90 : SKIRT_DEPTH
  const shelfReach = landform === 'spire' ? SHELF_REACH * 0.55 : SHELF_REACH
  const texScale =
    landform === 'spire' ? TEXTURE_SCALE * 0.72 : meadowSurface ? TEXTURE_SCALE * 0.62 : TEXTURE_SCALE
  const heights = []
  for (let i = 0; i <= total; i++) {
    const onLand = i <= rings
    const u = onLand ? i / rings : 1
    const t = onLand ? 1 - Math.pow(1 - u, RING_T) : 1
    const shelfK = onLand ? 0 : (i - rings) / shelfRings
    const rr = t + shelfK * shelfReach
    for (let s = 0; s <= SEGMENTS; s++) {
      const theta = (s / SEGMENTS) * Math.PI * 2
      const x = Math.cos(theta) * radius * rr
      const z = Math.sin(theta) * radius * rr
      let y = coastalGroundY(Math.min(1, t), theta, height, heightAt, landform, cliffAt)
      if (!onLand) {
        // First shelf ring already under the swell; dive hard to the skirt floor.
        // Spires dive faster so walls continue down into the dark.
        const drop = Math.pow(shelfK, landform === 'spire' ? 0.28 : 0.38)
        y = COAST_FOOT_Y + (-skirtDepth - COAST_FOOT_Y) * drop
      }
      positions.push(x, y, z)
      heights.push(y)
      // World-scale planar UVs. The old (angle, radius) mapping pinched to a
      // point at the centre and stretched the outer rings, so the same rock
      // texture read as smeared paint on anything but a mid-size island.
      uvs.push(x / texScale, z / texScale)
      colors.push(1, 1, 1) // island tint, filled below
      blends.push(0)
      terrain.push(0, 0, 0, 0) // splat weights, filled below once slopes exist
    }
  }

  // Winding matters. Seen from above, increasing theta runs clockwise in the
  // XZ plane, so the naive order puts every face's normal *downward* — the
  // island is then back-faced from any normal viewpoint and you see straight
  // through it to the inside of the far slope. Emit reversed. (The ocean disc
  // had exactly this bug; see render/oceanMesh.js.)
  const indices = []
  const row = SEGMENTS + 1
  for (let i = 0; i < total; i++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = i * row + s
      const b = a + row
      indices.push(a, a + 1, b)
      indices.push(a + 1, b + 1, b)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('aBlend', new THREE.Float32BufferAttribute(blends, 1))
  geometry.setAttribute('aTerrain', new THREE.Float32BufferAttribute(terrain, 4))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  paintTerrainWeights({
    geometry,
    heights,
    positions,
    radius,
    height,
    landform,
    archetype,
    meadowSurface,
    seed: hashString(`${body?.id ?? 'island'}:cover`)
  })
  geometry.computeBoundingSphere()

  // One material for the whole world (render/terrainMaterial.js). The old
  // per-island dual-map blend is kept only as the headless fallback — node
  // --test has no canvas, so the procedural layers do not exist there.
  const material =
    getTerrainMaterial() ??
    createIslandSurfaceMaterial(
      getSurfaceTextures(surfaces.body.tex) ?? {},
      surfaces.shore.tex === surfaces.body.tex ? null : getSurfaceTextures(surfaces.shore.tex) ?? {},
      meadowSurface ? getSurfaceTextures('rocky') : null,
      meadowSurface
    )

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  // Terrain has to receive. With this off nothing on an island cast a shadow
  // onto the island — no tree, no ruin, no boulder, and no part of the land
  // onto another part of it — which is most of why a hillside read as painted
  // rather than lit. `scene.js` derives `normalBias` from the shadow texel
  // footprint, so the usual reason to switch it off (acne across a 5× range of
  // ortho box sizes) no longer applies.
  mesh.receiveShadow = true
  mesh.userData.kind = "island"
  mesh.userData.archetype = archetype
  mesh.userData.landform = landform
  mesh.userData.dressed = false
  return mesh
}

/** Vegetation, ruins, talus and stacks — the expensive second pass. */
export function dressIslandMesh(mesh, body) {
  if (!mesh || mesh.userData.dressed) return mesh
  const { archetype, surfaces, landform, radius, height, heightAt, cliffAt } = getIslandProfile(body)
  const rng = mulberry32(hashString(`${body?.id ?? body?.name ?? 'island'}:props`))
  mesh.add(
    buildVegetation(rng, radius, height, heightAt, archetype, landform, body?.name === 'Haven Reach')
  )
  mesh.add(buildRuins(rng, radius, height, heightAt, archetype, landform, body?.name === 'Haven Reach'))
  if (landform === 'stack' || landform === 'mesa' || landform === 'spire' || rng() < 0.5) {
    mesh.add(buildTalus(rng, radius, height, heightAt, surfaces.body, landform))
  }
  mesh.add(buildSeaStacks(rng, radius, height, heightAt, landform, cliffAt))
  mesh.userData.dressed = true
  return mesh
}

export function buildIslandMesh(body) {
  return dressIslandMesh(buildIslandTerrainMesh(body), body)
}

/** Cheap distant stand-in: same height field, few triangles, no props. */
export function buildIslandLodMesh(body) {
  const { archetype, landform, radius, height, heightAt, cliffAt } = getIslandProfile(body)
  const rings = 64
  const segs = 128
  const positions = []
  const uvs = []
  const colors = []
  const blends = []
  const terrain = []
  const heights = []
  const meadowSurface = archetype === 'scrub'
  for (let i = 0; i <= rings + 2; i++) {
    const onLand = i <= rings
    const u = onLand ? i / rings : 1
    const t = onLand ? 1 - Math.pow(1 - u, RING_T) : 1
    const shelfK = onLand ? 0 : (i - rings) / 2
    const rr = t + shelfK * 0.04
    for (let s = 0; s <= segs; s++) {
      const theta = (s / segs) * Math.PI * 2
      const x = Math.cos(theta) * radius * rr
      const z = Math.sin(theta) * radius * rr
      let y = coastalGroundY(Math.min(1, t), theta, height, heightAt, landform, cliffAt)
      if (!onLand) y = COAST_FOOT_Y + (-80 - COAST_FOOT_Y) * shelfK
      positions.push(x, y, z)
      heights.push(y)
      uvs.push(x / 80, z / 80)
      colors.push(1, 1, 1)
      blends.push(0)
      terrain.push(0, 0, 0, 0)
    }
  }
  const indices = []
  const row = segs + 1
  for (let i = 0; i < rings + 2; i++) {
    for (let s = 0; s < segs; s++) {
      const a = i * row + s
      const b = a + row
      indices.push(a, a + 1, b)
      indices.push(a + 1, b + 1, b)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setAttribute('aBlend', new THREE.Float32BufferAttribute(blends, 1))
  geometry.setAttribute('aTerrain', new THREE.Float32BufferAttribute(terrain, 4))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  paintTerrainWeights({
    geometry,
    heights,
    positions,
    radius,
    height,
    landform,
    archetype,
    meadowSurface,
    seed: hashString(`${body?.id ?? 'island'}:lod`)
  })
  geometry.computeBoundingSphere()
  const material = getTerrainMaterial() ?? new THREE.MeshStandardMaterial({ color: 0x4a5c3c, roughness: 0.92 })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.kind = 'island'
  mesh.userData.archetype = archetype
  mesh.userData.landform = landform
  mesh.userData.lod = true
  return mesh
}

/**
 * Sea stacks — the pillars a collapsing cliff leaves standing offshore.
 *
 * They are the cheapest silhouette in the whole scene: a headland that ends in
 * a clean curve reads as a hill, and the same headland with three broken
 * columns off its point reads as a coast that the sea has been working on.
 * Placed only off cliff bearings, because that is the only place they form.
 */
function buildSeaStacks(rng, radius, height, heightAt, landform, cliffAt) {
  const group = new THREE.Group()
  group.name = 'seaStacks'
  if (landform === 'atoll' || radius < 150) return group
  const mat = getRockPropMaterial() ?? propMaterials().boulder
  const count = 2 + Math.floor(rng() * 4)
  let placed = 0
  for (let attempt = 0; attempt < count * 8 && placed < count; attempt++) {
    const theta = rng() * Math.PI * 2
    const cliff = cliffAt ? cliffAt(theta) : 0.3
    // Stacks are eroded cliff. No cliff, no stack.
    if (cliff < 0.45 || rng() > cliff) continue
    // Just off the coast, standing in water.
    const r = range(rng, 1.005, 1.055)
    const x = Math.cos(theta) * radius * r
    const z = Math.sin(theta) * radius * r
    const localCliffTop = Math.max(
      10,
      coastalGroundY(0.95, theta, height, heightAt, landform, cliffAt)
    )
    const h = range(rng, 0.35, 1.05) * Math.min(localCliffTop * 1.3, height * 0.55) + 8
    const w = h * range(rng, 0.16, 0.42)
    const stack = new THREE.Mesh(stackGeometry(rng, w, h), mat)
    // Foot buried well under the swell so no stack shows a flat cut base.
    stack.position.set(x, -SEA_MAX_AMPLITUDE - 6, z)
    stack.rotation.y = rng() * Math.PI * 2
    // A slight lean; a plumb column reads as a placed prop.
    stack.rotation.z = range(rng, -0.09, 0.09)
    stack.castShadow = true
    stack.receiveShadow = true
    group.add(stack)
    placed++
  }
  return group
}

/**
 * One eroded rock column: tapered, bitten into at the waterline where the sea
 * has been undercutting it, and stepped where harder beds have resisted.
 * Sits with its base at y = 0 so the caller only has to sink the foot.
 */
function stackGeometry(rng, width, height) {
  const sides = 20 + Math.floor(rng() * 8)
  const rings = 24
  const lean = range(rng, 0.02, 0.12)
  const leanDir = rng() * Math.PI * 2
  // Per-bearing profile so the column is not a lathe.
  const lobes = []
  for (let i = 0; i < 4; i++) {
    lobes.push({ freq: 1 + Math.floor(rng() * 4), phase: rng() * Math.PI * 2, amp: range(rng, 0.08, 0.22) })
  }
  // Per-bed radius so harder layers stand proud.
  const beds = []
  for (let i = 0; i <= rings; i++) beds.push(range(rng, 0.92, 1.08))

  const positions = []
  const indices = []
  for (let i = 0; i <= rings; i++) {
    const v = i / rings
    // Taper, with an undercut notch where the swell works at it.
    const taper = 1 - Math.pow(v, 1.6) * range(rng, 0.35, 0.7)
    const undercut = 1 - 0.28 * Math.exp(-Math.pow((v - 0.08) / 0.07, 2))
    const y = v * height
    const cx = Math.cos(leanDir) * lean * height * v * v
    const cz = Math.sin(leanDir) * lean * height * v * v
    for (let s = 0; s <= sides; s++) {
      const theta = (s / sides) * Math.PI * 2
      let k = 1
      for (const l of lobes) k += l.amp * Math.sin(theta * l.freq + l.phase + v * 1.5)
      const crag = 1 + (Math.sin(theta * 6 + v * 14) + Math.cos(theta * 11 - v * 7)) * 0.035
      const r = width * taper * undercut * beds[i] * Math.max(0.35, k) * crag
      positions.push(cx + Math.cos(theta) * r, y, cz + Math.sin(theta) * r)
    }
  }
  // Cap the top so the silhouette does not end in an open tube.
  const apex = positions.length / 3
  positions.push(
    Math.cos(leanDir) * lean * height,
    height * 1.04,
    Math.sin(leanDir) * lean * height
  )
  const row = sides + 1
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * row + s
      const b = a + row
      indices.push(a, b, a + 1)
      indices.push(a + 1, b, b + 1)
    }
  }
  for (let s = 0; s < sides; s++) {
    indices.push(rings * row + s, rings * row + s + 1, apex)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

// ── Shared low-poly props (one set for every island) ─────────────────────────
let _propGeo = null
function propGeometries() {
  if (_propGeo) return _propGeo
  _propGeo = {
    trunk: new THREE.CylinderGeometry(0.35, 0.55, 1, 5),
    canopy: new THREE.ConeGeometry(1, 1.6, 6),
    canopyRound: new THREE.IcosahedronGeometry(1, 0),
    bush: new THREE.IcosahedronGeometry(1, 0),
    rebar: new THREE.CylinderGeometry(0.12, 0.12, 1, 6)
  }
  // Trunk sits on y=0 with top at 1; canopy centres will be placed above.
  _propGeo.trunk.translate(0, 0.5, 0)
  return _propGeo
}

/**
 * Irregular boulder meshes — not smooth icosahedrons. A few prototypes are
 * shared so every island does not allocate unique geometry.
 */
let _boulderGeos = null
function boulderGeometries() {
  if (_boulderGeos) return _boulderGeos
  _boulderGeos = []
  for (let n = 0; n < 7; n++) {
    const detail = n % 3 === 0 ? 1 : 0
    const geo = new THREE.IcosahedronGeometry(1, detail)
    const pos = geo.attributes.position
    // Radial jitter + squash so they read as weathered rock, not gemstones.
    // IcosahedronGeometry is non-indexed: a corner appears once per adjoining
    // face. Its displacement must therefore be a function of its position,
    // not a fresh random draw, or the shared-looking corners pull apart into
    // the long triangular shards seen from the water.
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i)
      let y = pos.getY(i)
      let z = pos.getZ(i)
      const len = Math.hypot(x, y, z) || 1
      x /= len
      y /= len
      z /= len
      const noise = (offset) => {
        const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + n * 19.19 + offset) * 43758.5453
        return value - Math.floor(value)
      }
      const lobe =
        1 +
        Math.sin(x * 4.2 + n) * 0.12 +
        Math.cos(z * 5.1 + n * 1.7) * 0.1 +
        (noise(0) - 0.5) * 0.22
      const flat = 0.55 + noise(1) * 0.45
      pos.setXYZ(i, x * lobe, y * lobe * flat, z * lobe * (0.85 + noise(2) * 0.25))
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    // Prop-scale UVs so rock albedo tiles across the surface, not one face.
    _boulderGeos.push(retileUVsTriplanar(geo, 0.95))
  }
  return _boulderGeos
}

/** Box at final size with triplanar UVs — ruins must not stretch one photo face. */
function ruinBoxGeometry(w, h, d, tiles = 0.28) {
  return retileUVsTriplanar(new THREE.BoxGeometry(w, h, d), tiles)
}

function propMapMaterial(maps, color, { rough = 0.94, metal = 0.02, normal = 1.6 } = {}) {
  return new THREE.MeshStandardMaterial({
    map: maps?.map ?? null,
    normalMap: maps?.normalMap ?? null,
    roughnessMap: maps?.roughnessMap ?? null,
    // Near-white tint so albedo maps actually show (grey × map = grey mush).
    color: new THREE.Color(color),
    roughness: rough,
    metalness: metal,
    envMapIntensity: 0.12,
    normalScale: new THREE.Vector2(normal, normal)
  })
}

let _propMats = null
function propMaterials() {
  if (_propMats) return _propMats
  const concrete = getPropTextures('concrete') ?? {}
  const brick = getPropTextures('brick') ?? {}
  const boulder = getPropTextures('boulder') ?? getPropTextures('rock') ?? {}
  const bark = getPlantTextures('bark') ?? {}
  const foliage = getPlantTextures('foliage') ?? {}
  _propMats = {
    // Fallback trees (nature pack not ready) — same PBR as Quaternius path.
    trunk: propMapMaterial(bark, 0xc8a888, { rough: 0.94, metal: 0.0, normal: 1.15 }),
    canopy: propMapMaterial(foliage, 0xc4d49a, { rough: 0.93, metal: 0.0, normal: 0.9 }),
    canopyDry: propMapMaterial(foliage, 0xc4c090, { rough: 0.94, metal: 0.0, normal: 0.85 }),
    bush: propMapMaterial(foliage, 0xb8cc88, { rough: 0.93, metal: 0.0, normal: 0.9 }),
    bushDry: propMapMaterial(foliage, 0xb0a868, { rough: 0.94, metal: 0.0, normal: 0.85 }),
    // Weathered concrete / plaster — darkened so ruins do not read as clean
    // white blocks against the island. The concrete PBR map still supplies
    // the chips and pores; this tint supplies the drowned-world grime.
    ruin: propMapMaterial(concrete, 0xa6a199, { rough: 0.98, metal: 0.02, normal: 2.0 }),
    // Charcoal structural concrete for cores, columns and shadowed remnants.
    ruinDark: propMapMaterial(concrete, 0x6b6863, { rough: 0.99, metal: 0.04, normal: 2.1 }),
    // Brick / blockwork fragments — warm but subdued beside the dark concrete.
    ruinBrick: propMapMaterial(brick, 0xa17f6b, { rough: 0.98, metal: 0.01, normal: 2.0 }),
    // Exposed reinforcement in broken slabs and facade edges.
    rebar: new THREE.MeshStandardMaterial({
      color: 0x5a4f43,
      roughness: 0.78,
      metalness: 0.5,
      envMapIntensity: 0.08
    }),
    // Shore boulders
    boulder: propMapMaterial(boulder, 0xe4ddd4, { rough: 0.98, metal: 0.02, normal: 2.0 }),
    boulderDark: propMapMaterial(boulder, 0xc0b8ae, { rough: 0.98, metal: 0.02, normal: 1.85 })
  }
  return _propMats
}

/** Human-scale building sizes — not radius×0.05 skyscraper slabs. */
function ruinFootprint(rng, sizeK) {
  const k = Math.min(1.35, Math.max(0.75, sizeK))
  return {
    w: range(rng, 7, 22) * k,
    d: range(rng, 5, 16) * k,
    h: range(rng, 5, 16) * k,
    wallT: range(rng, 1.2, 2.8) * k
  }
}

/** Min ground height for props — clear of the wet foot / swell. */
function propMinGround() {
  return SEA_MAX_AMPLITUDE * 1.15 + 1.2
}

/** Height of one rendered land vertex, including the final coastal bank. */
function meshVertexGroundY(t, theta, height, heightAt, landform = 'dome') {
  return coastalGroundY(t, theta, height, heightAt, landform)
}

function triangleHeightAt(px, pz, a, b, c, ya, yb, yc) {
  const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
  if (Math.abs(denominator) < 1e-8) return null
  const wa = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / denominator
  const wb = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / denominator
  const wc = 1 - wa - wb
  if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) return null
  return wa * ya + wb * yb + wc * yc
}

/**
 * Ground Y at normalised radius r / bearing theta, sampled from the same
 * radial/angular triangles emitted by buildIslandMesh. Props used to sample
 * the smooth field before this would hover over convex faces by several metres.
 */
function meshGroundY(r, theta, height, heightAt, landform = 'dome') {
  const rr = Math.min(1, Math.max(0, r))
  const tau = Math.PI * 2
  const bearing = ((theta % tau) + tau) % tau

  const segmentF = bearing / tau * SEGMENTS
  const segment = Math.min(SEGMENTS - 1, Math.floor(segmentF))
  const segmentK = segmentF - segment
  const a0 = segment / SEGMENTS * tau
  const a1 = (segment + 1) / SEGMENTS * tau
  // The rendered rings are regular polygons, not circles. Their chord edges
  // sit slightly inside the analytic radius, so choose the ring from the
  // polygon edge crossed by this bearing or props can sample the wrong face.
  const sectorHalf = Math.PI / SEGMENTS
  const sectorMid = (segment + 0.5) / SEGMENTS * tau
  const chordScale = Math.cos(sectorHalf) / Math.cos(bearing - sectorMid)
  const ringT = (index) => 1 - Math.pow(1 - index / RINGS, RING_T)
  const ringRadius = (index) => ringT(index) * chordScale
  if (rr >= ringRadius(RINGS)) return COAST_FOOT_Y
  let ring = 0
  while (ring < RINGS - 1 && rr > ringRadius(ring + 1)) ring++
  const innerRadius = ringRadius(ring)
  const outerRadius = ringRadius(ring + 1)
  const ringK = (rr - innerRadius) / Math.max(1e-8, outerRadius - innerRadius)
  const t0 = ringT(ring)
  const t1 = ringT(ring + 1)
  const p = { x: rr * Math.cos(bearing), z: rr * Math.sin(bearing) }
  const inner0 = { x: t0 * Math.cos(a0), z: t0 * Math.sin(a0) }
  const inner1 = { x: t0 * Math.cos(a1), z: t0 * Math.sin(a1) }
  const outer0 = { x: t1 * Math.cos(a0), z: t1 * Math.sin(a0) }
  const outer1 = { x: t1 * Math.cos(a1), z: t1 * Math.sin(a1) }
  const yInner0 = meshVertexGroundY(t0, a0, height, heightAt, landform)
  const yInner1 = meshVertexGroundY(t0, a1, height, heightAt, landform)
  const yOuter0 = meshVertexGroundY(t1, a0, height, heightAt, landform)
  const yOuter1 = meshVertexGroundY(t1, a1, height, heightAt, landform)

  // Match the two indexed triangles: (inner0, inner1, outer0) then
  // (inner1, outer1, outer0). The radial fallback only covers the degenerate
  // centre fan, where all inner vertices share the same XZ position.
  return triangleHeightAt(p.x, p.z, inner0, inner1, outer0, yInner0, yInner1, yOuter0)
    ?? triangleHeightAt(p.x, p.z, inner1, outer1, outer0, yInner1, yOuter1, yOuter0)
    ?? yInner0 + (yOuter0 - yInner0) * ringK +
      (yInner1 - yInner0 + (yOuter1 - yOuter0 - yInner1 + yInner0) * ringK) * segmentK
}

/** Ground Y from island-local XZ (same field the mesh samples). */
function groundAtXZ(x, z, radius, height, heightAt, landform = 'dome') {
  const r = Math.hypot(x, z) / Math.max(1, radius)
  if (r >= 1) return COAST_FOOT_Y
  const theta = Math.atan2(z, x)
  return meshGroundY(r, theta, height, heightAt, landform)
}

/**
 * World-space terrain sample including the short submerged shelf around an
 * island. On-foot movement uses this to wade below the waterline without
 * making the whole ocean a walkable surface.
 */
export function islandTerrainYAt(body, x, z) {
  const profile = getIslandProfile(body)
  const localX = Number(x) - Number(body.position?.[0] ?? 0)
  const localZ = Number(z) - Number(body.position?.[2] ?? 0)
  const r = Math.hypot(localX, localZ) / Math.max(1, profile.radius)
  const shelfReach = profile.landform === 'spire' ? SHELF_REACH * 0.55 : SHELF_REACH
  if (r > 1 + shelfReach) return null
  return Number(body.position?.[1] ?? 0) + groundAtXZ(
    localX,
    localZ,
    profile.radius,
    profile.height,
    profile.heightAt,
    profile.landform
  )
}

/** World-space ground sample for on-foot movement and placeable alignment. */
export function islandGroundYAt(body, x, z) {
  const y = islandTerrainYAt(body, x, z)
  return y != null && y > GROUNDING_HEIGHT ? y : null
}

/**
 * Bury plant roots slightly so continuous height samples seat into the
 * triangulated mesh (domes are convex — chords sit below the curve, so
 * un-sunk plants float above the faces).
 */
function seatPlantY(groundY, plantHeight) {
  // The analytic field is sampled between rendered triangle vertices. A deeper
  // root seat keeps grass and small props from hovering on convex faces.
  return groundY - Math.max(0.7, plantHeight * 0.08)
}

/**
 * Sample a plantable point on the island. Returns null if underwater, too
 * steep (approximate via height vs neighbours), or on the outer beach.
 */
function samplePlantSpot(rng, radius, height, heightAt, { rMin = 0.12, rMax = 0.78, landform = 'dome' } = {}) {
  const theta = rng() * Math.PI * 2
  const r = range(rng, rMin, rMax)
  const ground = meshGroundY(r, theta, height, heightAt, landform)
  if (ground < propMinGround()) return null
  // Reject near-vertical faces: compare to a small radial step.
  const dr = 0.04
  const g2 = meshGroundY(Math.min(0.98, r + dr), theta, height, heightAt, landform)
  const slope = Math.abs(g2 - ground) / (radius * dr)
  if (slope > 1.35) return null
  return {
    x: Math.cos(theta) * radius * r,
    y: ground,
    z: Math.sin(theta) * radius * r,
    theta,
    r
  }
}

/**
 * How much green an island holds, 0 = none … 1 = thick cover.
 * Archetype biases the roll; the final draw is per-island so two scrub
 * islands can still look different (one wooded, one bare).
 */
function rollVegetationCover(rng, archetype, landform) {
  if (landform === 'stack') return 0 // no soil on a sea stack
  // Mountain tips: bare rock almost always; rare wind-killed scrub high up.
  if (landform === 'spire') return rng() < 0.12 ? range(rng, 0.08, 0.22) : 0
  // Base chance of having any trees/scrub at all.
  let bareChance =
    archetype === 'volcanic' ? 0.5
    : archetype === 'barren' ? 0.35
    : archetype === 'industrial' ? 0.24
    : archetype === 'scrub' ? 0.05
    : archetype === 'drowned' ? 0.09
    : 0.14
  if (landform === 'atoll') bareChance += 0.08
  if (rng() < bareChance) return 0

  // Among vegetated islands: sparse → medium → lush.
  const u = rng()
  if (archetype === 'scrub' || archetype === 'drowned') {
    if (u < 0.15) return range(rng, 0.28, 0.48)
    if (u < 0.5) return range(rng, 0.5, 0.75)
    return range(rng, 0.8, 1)
  }
  if (archetype === 'volcanic' || archetype === 'barren') {
    return range(rng, 0.14, 0.5)
  }
  if (archetype === 'industrial') return range(rng, 0.18, 0.58)
  return range(rng, 0.32, 0.85)
}

/**
 * How many pre-flood buildings remain, 0 = none … 1 = dense ruins.
 * Independent of vegetation — a green island can still be empty of buildings.
 */
function rollRuinCover(rng, archetype, landform) {
  let bareChance =
    archetype === 'volcanic' ? 0.55
    : archetype === 'barren' ? 0.3
    : archetype === 'scrub' ? 0.2
    : archetype === 'industrial' ? 0.08
    : archetype === 'drowned' ? 0.05
    : 0.3
  if (landform === 'stack') bareChance += 0.15
  if (landform === 'spire') bareChance = 0.65 // maybe a summit hut or beacon
  if (landform === 'atoll') bareChance += 0.08
  if (rng() < bareChance) return 0

  const u = rng()
  if (landform === 'spire') return range(rng, 0.1, 0.28)
  if (archetype === 'drowned') {
    if (u < 0.25) return range(rng, 0.35, 0.55)
    if (u < 0.6) return range(rng, 0.55, 0.8)
    return range(rng, 0.8, 1)
  }
  if (archetype === 'industrial') return range(rng, 0.4, 0.95)
  if (archetype === 'volcanic') return range(rng, 0.12, 0.35)
  return range(rng, 0.28, 0.78)
}

/** Area scale for prop counts — larger islands get more props, hard-capped. */
function propAreaScale(radius) {
  return Math.min(2.4, Math.max(0.45, Math.pow(radius / 420, 0.95)))
}

// Denser islands should feel alive from the boat, but lush islands can have
// hundreds of individual prop clones. Double the normal targets, then allow
// only 50% more than the old per-layer ceiling as a memory/draw-call budget
// (the home island gets the full twofold ceiling). Grass stays instanced, and
// hero trees keep their separate small cap below.
const VEGETATION_DENSITY_MULTIPLIER = 2.35
const VEGETATION_CAP_HEADROOM = 1.65
const VEGETATION_HOME_CAP_HEADROOM = 2.1
const vegetationCap = (oldCap, isHome = false) =>
  Math.ceil(oldCap * (isHome ? VEGETATION_HOME_CAP_HEADROOM : VEGETATION_CAP_HEADROOM))

/** Prop silhouette scale so trees/ruins read from a boat near shore. */
function propSizeScale(radius) {
  // Cap hard — large islands were growing 100 m grey walls that read as toys
  // from the title orbit, not buildings.
  return Math.min(1.35, Math.max(0.7, radius / 520))
}

/**
 * Trees + scrub + shore grass.
 * Prefers Quaternius Ultimate Nature (CC0) when preloaded; falls back to
 * simple low-poly shapes if assets are not ready yet (tests / cold load).
 */
function buildVegetation(rng, radius, height, heightAt, archetype, landform, isHome = false) {
  const group = new THREE.Group()
  group.name = 'vegetation'
  // Horizontal trunk colliders are deliberately kept as cheap data rather
  // than mesh physics. On-foot movement can use these to stop at tree bases
  // without making every leaf or grass blade part of the collision scene.
  group.userData.treeColliders = []
  const cover = rollVegetationCover(rng, archetype, landform)
  if (cover <= 0) return group

  const dry = archetype === 'barren' || archetype === 'volcanic'
  const areaK = propAreaScale(radius)
  const sizeK = propSizeScale(radius)
  const spotOpts = (extra = {}) => ({ landform, ...extra })

  // Layout character: scatter, a few copses, or a small forest of dense clumps.
  // Higher cover and green archetypes favour wooded islands.
  const woodRoll = rng()
  const green =
    archetype === 'scrub' || archetype === 'drowned' || (archetype !== 'volcanic' && archetype !== 'barren')
  let layout = 'scatter' // scatter | copses | forest
  if (green && cover >= 0.35 && woodRoll < 0.22 + cover * 0.28) layout = 'forest'
  else if (cover >= 0.25 && woodRoll < 0.55 + cover * 0.2) layout = 'copses'

  let treeTarget = Math.floor((4 + cover * 28) * areaK)
  let bushTarget = Math.floor((10 + cover * 48) * areaK)
  if (layout === 'copses') treeTarget = Math.floor(treeTarget * 1.85)
  if (layout === 'forest') treeTarget = Math.floor(treeTarget * 3.1)
  if (landform === 'atoll') {
    treeTarget = Math.floor(treeTarget * 0.5)
    bushTarget = Math.floor(bushTarget * 0.75)
  }
  if (archetype === 'industrial') {
    treeTarget = Math.floor(treeTarget * 0.4)
    bushTarget = Math.floor(bushTarget * 0.55)
  }
  // Double ordinary prop density. Barren islands returned above never enter
  // this path, while the cap keeps the biggest forests from becoming a wall
  // of clones when many nearby islands are streamed at once.
  treeTarget = Math.floor(treeTarget * VEGETATION_DENSITY_MULTIPLIER)
  bushTarget = Math.floor(bushTarget * VEGETATION_DENSITY_MULTIPLIER)
  // Forests need room for real clumps; keep a little headroom over the old
  // caps rather than allowing the density multiplier to grow without bound.
  treeTarget = Math.min(
    vegetationCap(layout === 'forest' ? 160 : layout === 'copses' ? 94 : 54, isHome),
    treeTarget
  )
  if (layout === 'forest') bushTarget = Math.floor(bushTarget * 1.55)
  else if (layout === 'copses') bushTarget = Math.floor(bushTarget * 1.25)
  bushTarget = Math.min(
    vegetationCap(layout === 'forest' ? 150 : layout === 'copses' ? 118 : 100, isHome),
    bushTarget
  )
  const tryLimit = (n) => n * 6 + 10

  const treeProtos = getTreeProtos()
  const heroTreeProtos = getHeroTreeProtos()
  const bushProtos = getBushProtos()
  const useNature = isNatureReady() && treeProtos.length > 0
  const useHeroTrees = isNatureReady() && heroTreeProtos.length > 0 && !dry
  const heroTreeLimit = layout === 'forest' ? 24 : layout === 'copses' ? 14 : 7
  let heroTrees = 0
  const woodlandPatches = []
  const treePoints = []
  // Keep trunks readable as individual trees instead of letting a successful
  // random run stack several models on the same few square metres.
  const treeSpacing = Math.max(4.5, Math.min(18, radius * 0.012))

  // Per-island growth character: some shores are scrub, some carry tall timber.
  const islandTreeBias = range(rng, 0.7, 1.45)
  // Trees used to stop at 0.72 of the radius, which on a landform whose whole
  // seaward face lives between 0.8 and 1.0 meant every tree on the island was
  // hidden behind the ridge: from the water the place read as bare. The slope
  // reject in `placeTreeAt` still keeps them off the cliffs.
  const rTreeMax = landform === 'atoll' ? 0.9 : 0.87

  const rollTreeHeight = () => {
    const u = rng()
    if (u < 0.18) return range(rng, 12, 22)
    if (u < 0.82) return range(rng, 22, 40)
    return range(rng, 40, 58)
  }

  const placeTreeAt = (x, z, yaw) => {
    if (treePoints.some((point) => Math.hypot(point.x - x, point.z - z) < treeSpacing)) return false
    const ground = groundAtXZ(x, z, radius, height, heightAt, landform)
    if (ground < propMinGround()) return false
    const rLocal = Math.hypot(x, z) / Math.max(1, radius)
    if (rLocal < 0.12 || rLocal > (landform === 'atoll' ? 0.94 : 0.92)) return false
    // Slope check at this exact seat.
    const theta = Math.atan2(z, x)
    const g2 = meshGroundY(Math.min(0.98, rLocal + 0.04), theta, height, heightAt, landform)
    if (Math.abs(g2 - ground) / (radius * 0.04) > 1.35) return false

    const baseH = rollTreeHeight()
    if (useNature) {
      // Detailed alpha-cut canopies carry the near shore silhouette; the
      // lightweight pack fills the deeper woodland without a draw-call spike.
      const hero = useHeroTrees && heroTrees < heroTreeLimit && rng() < 0.28
      const proto = hero ? pick(rng, heroTreeProtos) : pick(rng, treeProtos)
      const targetH = baseH * sizeK * islandTreeBias * (dry ? 0.8 : 1)
      const scale = targetH / Math.max(0.2, proto.height)
      const y = seatPlantY(ground, targetH)
      group.add(placePlantClone(proto, x, y, z, scale, yaw, { dry }))
      group.userData.treeColliders.push({
        x,
        z,
        radius: Math.max(0.9, Math.min(3.1, targetH * 0.09))
      })
      if (hero) heroTrees++
    } else {
      const geo = propGeometries()
      const mats = propMaterials()
      const scale = (baseH / 30) * sizeK * islandTreeBias * (dry ? 0.78 : 1)
      const trunkH = range(rng, 14, 28) * scale
      const y = seatPlantY(ground, trunkH)
      const trunk = new THREE.Mesh(geo.trunk, mats.trunk)
      trunk.position.set(x, y, z)
      trunk.scale.set(scale * 1.2, trunkH, scale * 1.2)
      trunk.rotation.y = yaw
      trunk.castShadow = true
      group.add(trunk)
      const canopy = new THREE.Mesh(geo.canopy, dry ? mats.canopyDry : mats.canopy)
      const cs = range(rng, 7, 14) * scale
      canopy.position.set(x, y + trunkH * 0.85, z)
      canopy.scale.set(cs, cs * 1.1, cs)
      canopy.castShadow = true
      group.add(canopy)
      group.userData.treeColliders.push({
        x,
        z,
        radius: Math.max(0.9, Math.min(3.1, scale * 1.55))
      })
    }
    treePoints.push({ x, z })
    return true
  }

  // —— Trees: scatter and/or clustered copses / small forests ——
  let trees = 0
  let scatterShare = 1
  if (layout === 'copses') scatterShare = 0.35
  else if (layout === 'forest') scatterShare = 0.18
  const scatterTarget = Math.floor(treeTarget * scatterShare)
  const clumpTreeBudget = treeTarget - scatterTarget

  for (let attempt = 0; attempt < tryLimit(scatterTarget) && trees < scatterTarget; attempt++) {
    const spot = samplePlantSpot(rng, radius, height, heightAt, spotOpts({
      rMin: 0.14,
      rMax: rTreeMax
    }))
    if (!spot) continue
    if (placeTreeAt(spot.x, spot.z, rng() * Math.PI * 2)) trees++
  }

  if (clumpTreeBudget > 0 && layout !== 'scatter') {
    // Copse count: a couple of thickets, or several for a forested island.
    let copseCount =
      layout === 'forest'
        ? 2 + Math.floor(rng() * 3) + (cover > 0.7 ? 1 : 0)
        : 2 + Math.floor(rng() * 2)
    copseCount = Math.min(6, copseCount)
    const perCopse = Math.max(4, Math.ceil(clumpTreeBudget / copseCount))
    for (let c = 0; c < copseCount && trees < treeTarget; c++) {
      // Choose the footprint before the centre so candidate patches can be
      // rejected when they overlap an earlier one.
      const copseR =
        layout === 'forest'
          ? range(rng, 22, 54) * Math.min(1.2, areaK)
          : range(rng, 12, 32) * Math.min(1.15, areaK)
      let centre = null
      for (let t = 0; t < 28 && !centre; t++) {
        const candidate = samplePlantSpot(rng, radius, height, heightAt, spotOpts({
          rMin: 0.16,
          rMax: rTreeMax * 0.95
        }))
        if (!candidate) continue
        const overlapsPatch = woodlandPatches.some((patch) =>
          Math.hypot(patch.x - candidate.x, patch.z - candidate.z) <
          patch.radius + copseR + Math.max(8, radius * 0.06)
        )
        if (!overlapsPatch) centre = candidate
      }
      if (!centre) continue
      woodlandPatches.push({ x: centre.x, z: centre.z, radius: copseR })
      const want = Math.min(perCopse + Math.floor(rng() * 4), treeTarget - trees)
      let placed = 0
      for (let a = 0; a < want * 8 && placed < want; a++) {
        // Cluster near centre (gaussian-ish via average of uniforms).
        const ang = rng() * Math.PI * 2
        const dist = copseR * Math.pow(rng() * rng(), 0.55)
        const x = centre.x + Math.cos(ang) * dist
        const z = centre.z + Math.sin(ang) * dist
        if (placeTreeAt(x, z, rng() * Math.PI * 2)) {
          placed++
          trees++
        }
      }
    }
  }

  // —— Bushes / plants / flowers (Quaternius foliage) ——
  let bushes = 0
  for (let attempt = 0; attempt < tryLimit(bushTarget) && bushes < bushTarget; attempt++) {
    let spot = null
    // Forest floors should read as a layered habitat, not trees placed over a
    // bare island. Most undergrowth belongs to the same woodland patches.
    if (woodlandPatches.length && rng() < (layout === 'forest' ? 0.72 : 0.5)) {
      const patch = pick(rng, woodlandPatches)
      const angle = rng() * Math.PI * 2
      const distance = patch.radius * Math.sqrt(rng()) * 1.18
      const x = patch.x + Math.cos(angle) * distance
      const z = patch.z + Math.sin(angle) * distance
      const rLocal = Math.hypot(x, z) / Math.max(1, radius)
      if (rLocal >= 0.14 && rLocal <= 0.9) {
        const y = groundAtXZ(x, z, radius, height, heightAt, landform)
        if (y >= propMinGround()) spot = { x, y, z }
      }
    }
    if (!spot) {
      spot = samplePlantSpot(rng, radius, height, heightAt, spotOpts({
        rMin: 0.18,
        rMax: 0.9
      }))
    }
    if (!spot) continue
    const yaw = rng() * Math.PI * 2
    if (useNature && bushProtos.length) {
      const proto = pick(rng, bushProtos)
      // Plants/flowers sit lower than bulky bushes (all protos baked ~1.2 tall).
      // ~2× prior heights so scrub reads next to the larger trees.
      const short = proto.radius < 0.45 || proto.height < 0.9
      // Scrub reads as dirt on the lens below about six screen pixels, and from
      // a boat three hundred metres off a 1.6 m plant is three. Sized up so the
      // undergrowth resolves as vegetation at the range you actually see an
      // island from — gorse and marram on an exposed coast run this big anyway.
      const targetH =
        range(rng, short ? 2.2 : 4.2, short ? 5.4 : 10.5) * sizeK * (dry ? 0.75 : 1)
      const scale = targetH / Math.max(0.15, proto.height)
      const y = seatPlantY(spot.y, targetH)
      group.add(placePlantClone(proto, spot.x, y, spot.z, scale, yaw, { dry }))
    } else {
      const geo = propGeometries()
      const mats = propMaterials()
      const s = range(rng, 4, 10) * sizeK
      const y = seatPlantY(spot.y, s)
      const bush = new THREE.Mesh(geo.bush, dry ? mats.bushDry : mats.bush)
      bush.position.set(spot.x, y + s * 0.35, spot.z)
      bush.scale.set(s, s * 0.7, s)
      bush.rotation.y = yaw
      group.add(bush)
    }
    bushes++
  }

  // —— Grass: denser, larger clumps (shore band + inland) ——
  if (useNature && !dry && landform !== 'stack' && landform !== 'spire') {
    const grassData = getGrassMeshData()
    if (grassData.length) {
      let grassTarget = Math.floor((140 + cover * 280) * Math.min(1.8, areaK))
      if (layout === 'forest') grassTarget = Math.floor(grassTarget * 1.25)
      if (landform === 'atoll') grassTarget = Math.floor(grassTarget * 0.75)
      if (archetype === 'industrial') grassTarget = Math.floor(grassTarget * 0.45)
      grassTarget = Math.floor(grassTarget * VEGETATION_DENSITY_MULTIPLIER)
      grassTarget = Math.min(vegetationCap(520, isHome), Math.max(80, grassTarget))

      const perType = Math.ceil(grassTarget / grassData.length)
      const _m = new THREE.Matrix4()
      const _p = new THREE.Vector3()
      const _q = new THREE.Quaternion()
      const _s = new THREE.Vector3()
      const _e = new THREE.Euler()

      for (const gd of grassData) {
        const dummy = []
        for (let a = 0; a < perType * 7 && dummy.length < perType; a++) {
          // Shore denser, but plenty of inland cover too.
          const nearShore = rng() < 0.55
          const spot = samplePlantSpot(rng, radius, height, heightAt, spotOpts({
            rMin: nearShore ? 0.48 : 0.22,
            rMax: nearShore ? 0.96 : 0.78
          }))
          if (!spot) continue
          // Larger clumps so they read from a boat (was 0.35–1.7 m).
          const targetH = range(rng, 2.0, 5.4) * sizeK
          const sc = targetH / Math.max(0.05, gd.height)
          const y = seatPlantY(spot.y, targetH)
          _p.set(spot.x, y, spot.z)
          _e.set(0, rng() * Math.PI * 2, 0)
          _q.setFromEuler(_e)
          _s.set(sc * range(rng, 0.9, 1.35), sc, sc * range(rng, 0.9, 1.35))
          _m.compose(_p, _q, _s)
          dummy.push(_m.clone())
        }
        if (!dummy.length) continue
        const inst = new THREE.InstancedMesh(gd.geometry, gd.material, dummy.length)
        inst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
        // Grass is receive-only: individual blades are too small to produce
        // useful silhouettes, but they still benefit from tree/structure
        // shadows landing across the ground cover.
        inst.castShadow = false
        inst.receiveShadow = true
        for (let i = 0; i < dummy.length; i++) inst.setMatrixAt(i, dummy[i])
        inst.instanceMatrix.needsUpdate = true
        // Instance transforms are authored after construction; refresh the
        // aggregate bounds so both the main and shadow cameras see the real
        // grass patch rather than the source geometry at the origin.
        inst.computeBoundingSphere()
        inst.name = 'shoreGrass'
        group.add(inst)
      }
    }

    // Full grass Object3D clones for multi-material detail / denser patches.
    const grassProtos = getGrassProtos()
    if (grassProtos.length) {
      let clumpTarget = Math.floor((22 + cover * 40) * Math.min(1.4, areaK))
      if (layout === 'forest') clumpTarget = Math.floor(clumpTarget * 1.3)
      clumpTarget = Math.floor(clumpTarget * VEGETATION_DENSITY_MULTIPLIER)
      clumpTarget = Math.min(vegetationCap(70, isHome), Math.max(12, clumpTarget))
      let clumps = 0
      for (let a = 0; a < clumpTarget * 6 && clumps < clumpTarget; a++) {
        const spot = samplePlantSpot(rng, radius, height, heightAt, spotOpts({
          rMin: 0.28,
          rMax: 0.92
        }))
        if (!spot) continue
        const proto = pick(rng, grassProtos)
        const targetH = range(rng, 2.2, 5.0) * sizeK
        const scale = targetH / Math.max(0.08, proto.height)
        const yaw = rng() * Math.PI * 2
        const y = seatPlantY(spot.y, targetH)
        group.add(
          placePlantClone(proto, spot.x, y, spot.z, scale, yaw, {
            dry: false,
            noShadow: true
          })
        )
        clumps++
      }
    }
  }

  return group
}

/**
 * Place a ruin mesh piece at a world spot with yaw/lean. Geometry is already
 * sized; only rotation is applied so textures keep correct scale.
 */
function placeRuinPiece(group, geo, mat, x, y, z, rotX, rotY, rotZ) {
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(x, y, z)
  mesh.rotation.set(rotX, rotY, rotZ)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
  return mesh
}

/**
 * Ruined buildings — human-scale, clustered into a few shoreline hamlets.
 * (Radius-scaled walls read as grey billboards from the title orbit.)
 */
function buildRuins(rng, radius, height, heightAt, archetype, landform, isHome = false) {
  const group = new THREE.Group()
  group.name = 'ruins'
  // Port Haven grew around the remains of the old island settlement. Keep a
  // small ruin cluster on Haven Reach even though its seeded archetype is scrub.
  const cover = isHome
    ? Math.max(0.42, rollRuinCover(rng, archetype, landform))
    : rollRuinCover(rng, archetype, landform)
  if (cover <= 0) return group

  const mats = propMaterials()
  const industrial = archetype === 'industrial'
  const drowned = archetype === 'drowned'
  const pickMat = () => {
    if (industrial) return rng() < 0.65 ? mats.ruinDark : mats.ruin
    if (drowned) return rng() < 0.5 ? mats.ruinBrick : mats.ruin
    return rng() < 0.4 ? mats.ruinBrick : mats.ruin
  }
  // Ruins are meant to read as substantial remnants from offshore and on
  // foot, so keep their existing island-scale variation but double the model
  // dimensions consistently across walls, towers, rubble, and rebar.
  const sizeK = propSizeScale(radius) * 2

  // A few settlement clusters, not freckles across the whole island.
  let hamlets = 1 + Math.floor(cover * 4.5)
  if (drowned) hamlets += 1
  if (industrial) hamlets += 1
  if (landform === 'atoll' || landform === 'spire') hamlets = Math.max(1, hamlets - 1)
  hamlets = Math.min(7, hamlets)

  for (let h = 0; h < hamlets; h++) {
    // Keep one Haven cluster on the lower coastal slope; the others stay
    // inland so the settlement still has a natural spread.
    const coastal = isHome && h === hamlets - 1
    const rMin = coastal ? 0.7 : 0.2
    const rMax = coastal
      ? landform === 'atoll' ? 0.92 : 0.88
      : landform === 'atoll' ? 0.88 : 0.68
    let centre = null
    for (let t = 0; t < (coastal ? 48 : 24) && !centre; t++) {
      centre = samplePlantSpot(rng, radius, height, heightAt, {
        rMin,
        rMax,
        landform
      })
    }
    if (!centre) continue

    const buildings = 3 + Math.floor(rng() * (drowned ? 6 : 5))
    for (let b = 0; b < buildings; b++) {
      // Jitter around the hamlet centre (local metres, not island radius).
      const ang = rng() * Math.PI * 2
      const dist = range(rng, 4, 28)
      const x = centre.x + Math.cos(ang) * dist
      const z = centre.z + Math.sin(ang) * dist
      const rLocal = Math.hypot(x, z) / Math.max(1, radius)
      if (rLocal > 0.92) continue
      const ground = groundAtXZ(x, z, radius, height, heightAt, landform)
      if (ground < propMinGround()) continue

      const mat = pickMat()
      const yaw = rng() * Math.PI * 2
      const fp = ruinFootprint(rng, sizeK)
      const kind = rng()
      const highRiseChance = industrial || drowned ? 0.2 : 0.08

      if (kind < highRiseChance) {
        // A flooded-city remnant: thin floor plates, broken facade sections,
        // exposed columns and missing levels. Full-height slabs read as a
        // stack of floating blocks from the sea, so the floor plate is only a
        // structural lip and the walls do the architectural work.
        const towerW = range(rng, 16, 26) * sizeK
        const towerD = range(rng, 14, 23) * sizeK
        const floors = 4 + Math.floor(rng() * 4)
        const floorH = range(rng, 4.2, 6.3) * sizeK
        const damageStart = Math.max(2, Math.ceil(floors * 0.5))
        const missing = new Set()
        for (let damagedFloor = damageStart; damagedFloor < floors; damagedFloor++) {
          if (rng() < 0.42) missing.add(damagedFloor)
        }
        if (missing.size === 0 && damageStart < floors) missing.add(damageStart)

        // A ruin needs a believable foot. The old version started with
        // isolated floor plates, which read as floating blocks from offshore.
        const footingH = floorH * range(rng, 0.22, 0.35)
        placeRuinPiece(
          group,
          ruinBoxGeometry(towerW * 0.74, footingH, towerD * 0.74),
          mat,
          x,
          ground + footingH * 0.5,
          z,
          range(rng, -0.06, 0.06),
          yaw,
          range(rng, -0.06, 0.06)
        )

        // The lift/stair core is the spine that keeps a gutted tower reading
        // as one building after its rooms and facade have fallen away.
        const coreW = towerW * range(rng, 0.14, 0.2)
        const coreD = towerD * range(rng, 0.14, 0.2)
        const coreFloors = Math.max(2, floors - (rng() < 0.35 ? 1 : 0))
        for (let coreFloor = 0; coreFloor < coreFloors; coreFloor++) {
          if (coreFloor > 0 && missing.has(coreFloor) && rng() < 0.65) continue
          const coreH = floorH * range(rng, 0.78, 1.05)
          placeRuinPiece(
            group,
            ruinBoxGeometry(coreW, coreH, coreD),
            rng() < 0.72 ? mats.ruinDark : mat,
            x + (rng() - 0.5) * towerW * 0.04 * coreFloor,
            ground + coreFloor * floorH + coreH * 0.5,
            z + (rng() - 0.5) * towerD * 0.04 * coreFloor,
            range(rng, -0.06, 0.06),
            yaw,
            range(rng, -0.06, 0.06)
          )
        }

        for (let floor = 0; floor < floors; floor++) {
          if (missing.has(floor)) continue
          const upper = floor >= damageStart
          const lean = upper ? (floor - damageStart + 1) / Math.max(1, floors - damageStart) : 0
          const dx = upper ? (rng() - 0.5) * towerW * 0.18 * lean : 0
          const dz = upper ? (rng() - 0.5) * towerD * 0.18 * lean : 0
          const slabH = floorH * (upper ? range(rng, 0.1, 0.22) : range(rng, 0.18, 0.28))
          const slabMat = rng() < 0.62 ? mat : rng() < 0.55 ? mats.ruinDark : mats.ruinBrick
          placeRuinPiece(
            group,
            ruinBoxGeometry(towerW * range(rng, 0.82, 1.05), slabH, towerD * range(rng, 0.82, 1.05)),
            slabMat,
            x + dx,
            ground + slabH * 0.5 + floor * floorH,
            z + dz,
            range(rng, -0.05, 0.05) + lean * range(rng, -0.08, 0.08),
            yaw + lean * range(rng, -0.12, 0.12),
            range(rng, -0.05, 0.05) + lean * range(rng, -0.1, 0.1)
          )

          // Leave a few structural stubs under surviving upper floors. They
          // are deliberately incomplete, but stop a missing level looking
          // like a perfectly suspended concrete tile.
          if (floor < damageStart || missing.has(floor - 1) || rng() < 0.7) {
            const columnH = floorH * range(rng, 0.72, 1.02)
            const columnW = towerW * range(rng, 0.055, 0.1)
            const columnD = towerD * range(rng, 0.055, 0.1)
            const floorBase = ground + floor * floorH
            const corners = [
              [-1, -1],
              [1, -1],
              [-1, 1],
              [1, 1]
            ]
            const count = floor < damageStart ? 4 : 2 + Math.floor(rng() * 2)
            for (let c = 0; c < count; c++) {
              const [side, front] = corners[(c + Math.floor(rng() * corners.length)) % corners.length]
              if (upper && rng() < 0.18) continue
              const column = placeRuinPiece(
                group,
                ruinBoxGeometry(columnW, columnH, columnD),
                rng() < 0.75 ? mats.ruinDark : mat,
                x + side * towerW * 0.34 + dx,
                floor === 0 ? floorBase + columnH * 0.5 : floorBase - columnH * 0.5,
                z + front * towerD * 0.34 + dz,
                range(rng, -0.12, 0.12),
                yaw + lean * range(rng, -0.08, 0.08),
                range(rng, -0.12, 0.12)
              )
              column.scale.x *= range(rng, 0.7, 1.15)
            }
          }

          // Broken wall panels leave recognisable rooms/facades between the
          // frame members. Keep them partial so the missing floors stay open.
          const panelCount = floor < damageStart ? 3 : 2 + Math.floor(rng() * 2)
          for (let panel = 0; panel < panelCount; panel++) {
            if (upper && panel > 0 && rng() < 0.28) continue
            const wallH = floorH * (upper ? range(rng, 0.28, 0.64) : range(rng, 0.52, 0.82))
            const wallW = towerW * range(rng, 0.2, 0.52)
            const wallT = Math.max(0.7, towerD * range(rng, 0.07, 0.13))
            const front = panel % 2 === 0
            const side = rng() < 0.5 ? -1 : 1
            const offset = (rng() - 0.5) * towerW * 0.38
            const floorBase = ground + floor * floorH
            const panelMat = rng() < 0.58 ? mat : rng() < 0.5 ? mats.ruinDark : mats.ruinBrick
            placeRuinPiece(
              group,
              front
                ? ruinBoxGeometry(wallW, wallH, wallT)
                : ruinBoxGeometry(wallT, wallH, wallW),
              panelMat,
              front ? x + offset : x + side * towerW * 0.38,
              floorBase + wallH * 0.5,
              front ? z + side * towerD * 0.42 : z + offset,
              range(rng, -0.16, 0.16),
              yaw + lean * range(rng, -0.1, 0.1),
              range(rng, -0.16, 0.16)
            )
          }

          // Short rusty rods break the clean wall edges where the facade has
          // sheared away. They are sparse, but readable as reinforcement.
          if (upper && rng() < 0.78) {
            const rods = 1 + Math.floor(rng() * 3)
            for (let rodIndex = 0; rodIndex < rods; rodIndex++) {
              const rodLength = range(rng, 1.4, 3.6) * sizeK
              const rod = new THREE.Mesh(propGeometries().rebar, mats.rebar)
              rod.position.set(
                x + dx + (rng() - 0.5) * towerW * 0.72,
                ground + floor * floorH + slabH + rodLength * 0.35,
                z + dz + (rng() < 0.5 ? -1 : 1) * towerD * 0.43
              )
              rod.scale.set(0.7, rodLength, 0.7)
              rod.rotation.set(range(rng, -0.38, 0.38), yaw, range(rng, -0.38, 0.38))
              rod.castShadow = true
              group.add(rod)
            }
          }
        }

        // Concrete chunks at the foot tie the building into the slope and
        // soften the clean rectangular silhouette at boat distance.
        const rubbleGeos = boulderGeometries()
        const rubbleCount = 4 + Math.floor(rng() * 4)
        for (let rubble = 0; rubble < rubbleCount; rubble++) {
          const angle = rng() * Math.PI * 2
          const distance = range(rng, 0.35, 0.85) * Math.max(towerW, towerD)
          const size = range(rng, 1.8, 4.8) * sizeK
          const chunk = new THREE.Mesh(pick(rng, rubbleGeos), mat)
          chunk.position.set(
            x + Math.cos(angle) * distance,
            ground + size * range(rng, 0.2, 0.45),
            z + Math.sin(angle) * distance
          )
          chunk.scale.set(
            size * range(rng, 0.8, 1.5),
            size * range(rng, 0.5, 1.05),
            size * range(rng, 0.8, 1.4)
          )
          chunk.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
          chunk.castShadow = true
          chunk.receiveShadow = true
          group.add(chunk)
        }

        // A broken side wall makes the missing floors legible in silhouette.
        if (rng() < 0.8) {
          const sideH = floorH * range(rng, 1.2, 2.8)
          const sideBase = ground + damageStart * floorH
          placeRuinPiece(
            group,
            ruinBoxGeometry(towerW * 0.18, sideH, towerD * range(rng, 0.7, 1.1)),
            mat,
            x + towerW * range(rng, -0.45, 0.45),
            sideBase + sideH * 0.5,
            z + towerD * range(rng, -0.35, 0.35),
            range(rng, -0.18, 0.18),
            yaw,
            range(rng, -0.18, 0.18)
          )
        }
        continue
      }

      if (kind < 0.38) {
        // Standing wall / broken facade
        const mainH = fp.h * range(rng, 0.65, 1)
        placeRuinPiece(
          group,
          ruinBoxGeometry(fp.w, mainH, fp.wallT),
          mat,
          x,
          ground + mainH * 0.48,
          z,
          range(rng, -0.08, 0.08),
          yaw,
          range(rng, -0.06, 0.06)
        )
        if (rng() < 0.55) {
          const topH = fp.h * range(rng, 0.2, 0.4)
          placeRuinPiece(
            group,
            ruinBoxGeometry(fp.w * range(rng, 0.4, 0.7), topH, fp.wallT * 0.95),
            mat,
            x + Math.cos(yaw) * fp.w * 0.1,
            ground + mainH + topH * 0.4,
            z + Math.sin(yaw) * fp.w * 0.1,
            range(rng, -0.25, 0.1),
            yaw,
            range(rng, -0.12, 0.12)
          )
        }
      } else if (kind < 0.72) {
        // Collapsed shed + roof slab
        const hBox = fp.h * range(rng, 0.45, 0.75)
        placeRuinPiece(
          group,
          ruinBoxGeometry(fp.w, hBox, fp.d),
          mat,
          x,
          ground + hBox * 0.42,
          z,
          range(rng, -0.12, 0.1),
          yaw,
          range(rng, -0.1, 0.1)
        )
        if (rng() < 0.65) {
          const rh = hBox * range(rng, 0.12, 0.22)
          placeRuinPiece(
            group,
            ruinBoxGeometry(fp.w * 1.05, rh, fp.d * 1.05),
            mat,
            x + Math.cos(yaw) * 1.5,
            ground + hBox * 0.85,
            z + Math.sin(yaw) * 1.5,
            range(rng, -0.55, -0.12),
            yaw + range(rng, -0.25, 0.25),
            range(rng, -0.15, 0.15)
          )
        }
      } else {
        // L-footprint foundations
        const hWall = fp.h * range(rng, 0.5, 0.85)
        placeRuinPiece(
          group,
          ruinBoxGeometry(fp.w, hWall, fp.wallT),
          mat,
          x,
          ground + hWall * 0.48,
          z,
          range(rng, -0.08, 0.08),
          yaw,
          0
        )
        const ca = Math.cos(yaw)
        const sa = Math.sin(yaw)
        placeRuinPiece(
          group,
          ruinBoxGeometry(fp.wallT, hWall * range(rng, 0.7, 1), fp.d * 0.7),
          mat,
          x + fp.w * 0.35 * ca,
          ground + hWall * 0.42,
          z + fp.w * 0.35 * sa,
          range(rng, -0.1, 0.08),
          yaw,
          0
        )
      }
    }
  }
  return group
}

/**
 * Boulders piled on the shore and lower slopes — irregular rock meshes with
 * boulder albedo, not smooth plastic icosahedrons.
 */
function buildTalus(rng, radius, height, heightAt, surface, landform = 'dome') {
  const group = new THREE.Group()
  group.name = 'talus'
  const geos = boulderGeometries()
  // Loose rock takes the same shared rock material as the ground, so a boulder
  // in the wash is wet in the same band the beach behind it is. One material
  // for every island's talus — never a clone per island.
  const rockMat = getRockPropMaterial()
  let matLight = rockMat
  let matDark = rockMat
  if (!rockMat) {
    const mats = propMaterials()
    const tint = new THREE.Color(surface?.color ?? 0xc4beb4)
    matLight = mats.boulder.clone()
    matDark = mats.boulderDark.clone()
    matLight.color.multiply(tint.clone().multiplyScalar(0.55).addScalar(0.45))
    matDark.color.multiply(tint.clone().multiplyScalar(0.5).addScalar(0.4))
  }

  // Human-scale boulders on the shore — not radius×0.05 megaton slabs.
  const sizeK = propSizeScale(radius)
  const count = 10 + Math.floor(rng() * 12)
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2
    // Prefer the waterline band; a few further inland as fall debris.
    // Keep talus on the rendered land surface. Sampling beyond r=1 and then
    // applying a minimum Y made occasional boulders hover outside the coast.
    const r = rng() < 0.72 ? range(rng, 0.78, 0.96) : range(rng, 0.55, 0.78)
    const ground = meshGroundY(r, theta, height, heightAt, landform)
    const s = range(rng, 3.5, 12) * sizeK
    const rock = new THREE.Mesh(pick(rng, geos), rng() < 0.55 ? matLight : matDark)
    const y = ground + s * range(rng, 0.15, 0.4)
    rock.position.set(Math.cos(theta) * radius * r, y, Math.sin(theta) * radius * r)
    // Flatten into the beach / stack like real talus, not floating orbs.
    rock.scale.set(
      s * range(rng, 0.85, 1.25),
      s * range(rng, 0.4, 0.75),
      s * range(rng, 0.8, 1.3)
    )
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    rock.castShadow = true
    rock.receiveShadow = true
    group.add(rock)
  }

  // Small pebble clusters near the larger stones
  const pebbles = 6 + Math.floor(rng() * 8)
  for (let i = 0; i < pebbles; i++) {
    const theta = rng() * Math.PI * 2
    const r = range(rng, 0.82, 0.96)
    const ground = meshGroundY(r, theta, height, heightAt, landform)
    const s = range(rng, 1.2, 4) * sizeK
    const rock = new THREE.Mesh(pick(rng, geos), matDark)
    rock.position.set(
      Math.cos(theta) * radius * r,
      ground + s * 0.25,
      Math.sin(theta) * radius * r
    )
    rock.scale.set(s, s * range(rng, 0.35, 0.6), s * range(rng, 0.7, 1.1))
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    group.add(rock)
  }
  return group
}

/** Per-frame island work. Land does not move — kept so main.js has one call. */
export function updateIslandMesh() {}
