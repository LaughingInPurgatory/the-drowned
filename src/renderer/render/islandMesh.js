import * as THREE from 'three'
import { mulberry32, range, pick } from '../procgen/prng.js'
import { getSurfaceTextures, getPropTextures, getPlantTextures, retileUVsTriplanar } from './textures.js'
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
  grass: { color: 0xd8e4b8, tex: 'grass', rough: 0.92, metal: 0.0 },
  scrub: { color: 0xd4d4b0, tex: 'grass', rough: 0.93, metal: 0.0 },
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
const TIDE_COLOR = new THREE.Color(0x4a4740)
/** Bare rock on anything too steep to hold soil, sand or anything else. */
const CLIFF_COLOR = new THREE.Color(0x6b6660)

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
/** Chance a substantial island is a mountain spire (not a common pick). */
const SPIRE_CHANCE = 0.048

const RINGS = 52
const SEGMENTS = 64
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
  const roughness = range(rng, 0.03, 0.1)
  const detail = (r, theta) =>
    Math.sin(theta * 7 + noiseSeed) * Math.cos(r * 9 + noiseSeed) * roughness * (1 - r)

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
const SHORE_SAMPLES = 208
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
 * Extra metres of water kept clear outside the traced waterline.
 * Keel/draft + a short beach the hull should not sit on top of.
 */
export const SHORE_KEEP_OUT = 14

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
  const height = radius * range(rng, heightBand[0], heightBand[1])
  const baseHeight = makeHeightField(rng, landform)
  const greenTerrain = archetype === 'scrub' || archetype === 'drowned'
  const reliefSeed = hashString(`${body?.id ?? 'island'}:rolling-ground`) * 0.001
  const roughnessSeed = hashString(`${body?.id ?? 'island'}:surface-roughness`) * 0.001
  const surfaceRoughness =
    landform === 'atoll' ? 0.022
    : landform === 'mesa' ? 0.038
    : archetype === 'barren' || archetype === 'volcanic' ? 0.072
    : 0.052
  const rawHeight = (r, theta) => {
    const base = baseHeight(r, theta)
    const rr = Math.max(0, Math.min(1, r))
    const envelope = Math.sin(Math.PI * rr) * Math.pow(Math.max(0, 1 - rr), 0.45)
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
      h += macro * surfaceRoughness * envelope
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

  // Trace the coastline: per bearing, the furthest point still standing above
  // the waterline. Everything beyond that is open water you can sail into —
  // which for a sea stack or a broken atoll is most of the disc.
  const shore = new Float32Array(SHORE_SAMPLES)
  let maxShore = 0
  const isLand = (r, theta) => heightAt(r, theta) * height > GROUNDING_HEIGHT
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
  const profile = { archetype, surfaces, landform, radius, height, heightAt, shore, maxShore }
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

/**
 * Blend two texture sets across the surface using a per-vertex weight.
 *
 * MeshStandardMaterial only takes one map, so the second is injected with
 * `onBeforeCompile` — that keeps all of three's lighting, shadows and fog and
 * costs one extra sample. Without it every island is one material, and a rocky
 * headland with a sandy beach is not expressible.
 */
function applyBlendShader(material, accentMaps, terrainMaps = null) {
  const hasAccent = Boolean(accentMaps?.map)
  const hasTerrain = Boolean(terrainMaps?.map)
  if (!hasAccent && !hasTerrain) return material
  material.onBeforeCompile = (shader) => {
    if (hasAccent) shader.uniforms.uAccentMap = { value: accentMaps.map }
    if (hasTerrain) shader.uniforms.uTerrainRockMap = { value: terrainMaps.map }
    const vertexDecl = [
      hasAccent ? 'attribute float aBlend;\nvarying float vBlend;' : '',
      hasTerrain ? 'varying vec3 vTerrainPosition;' : ''
    ].filter(Boolean).join('\n')
    const vertexAssign = [
      hasAccent ? 'vBlend = aBlend;' : '',
      hasTerrain ? 'vTerrainPosition = transformed;' : ''
    ].filter(Boolean).join('\n')
    const fragmentDecl = [
      hasAccent ? 'uniform sampler2D uAccentMap;\nvarying float vBlend;' : '',
      hasTerrain
        ? `uniform sampler2D uTerrainRockMap;
varying vec3 vTerrainPosition;
float terrainHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float terrainNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = terrainHash(i);
  float b = terrainHash(i + vec2(1.0, 0.0));
  float c = terrainHash(i + vec2(0.0, 1.0));
  float d = terrainHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`
        : ''
    ].filter(Boolean).join('\n')
    const surfaceCode = [
      hasAccent
        ? `{
          // Accent (shore sand etc.) already in linear via SRGBColorSpace.
          // Mix full accent albedo, then let color_fragment tint both layers.
          vec4 accent = texture2D(uAccentMap, vMapUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, accent.rgb, clamp(vBlend, 0.0, 1.0));
        }`
        : '',
      hasTerrain
        ? `{
          // The grass photo map is useful up close but averages to one green
          // plane at range. Keep the broad texture, then layer a second
          // sampling scale and exposed-soil patches over it. This is cheap
          // fragment work and costs no additional terrain geometry.
          vec2 detailUv = vMapUv * 3.2 + vec2(7.31, -11.17);
          vec3 closeGrass = texture2D(map, detailUv).rgb;
          float broad = terrainNoise(vTerrainPosition.xz * 0.0024 + vec2(3.0, 8.0));
          float medium = terrainNoise(vTerrainPosition.xz * 0.008 + vec2(-4.0, 2.0));
          float patchNoise = broad * 0.72 + medium * 0.28;
          float exposedSoil = smoothstep(0.48, 0.72, patchNoise);
          vec3 rock = texture2D(uTerrainRockMap, vMapUv * 0.72 + vec2(-4.0, 5.0)).rgb;
          vec3 soil = mix(rock * vec3(0.88, 0.9, 0.86), vec3(0.24, 0.16, 0.075), 0.62);
          vec3 grass = mix(diffuseColor.rgb, diffuseColor.rgb * (0.62 + closeGrass * 0.94), 0.46);
          grass *= mix(vec3(0.7, 0.77, 0.48), vec3(1.12, 1.06, 0.76), medium * 0.9);
          diffuseColor.rgb = mix(grass, soil, exposedSoil * 0.7);
        }`
        : ''
    ].filter(Boolean).join('\n')
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexDecl}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexAssign}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentDecl}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${surfaceCode}`)
  }
  // Unique key so three doesn't reuse an un-patched program.
  material.customProgramCacheKey = () => `islandBlend_v3_${hasAccent ? 1 : 0}_${hasTerrain ? 1 : 0}`
  return material
}

export function buildIslandMesh(body) {
  const { archetype, surfaces, landform, radius, height, heightAt } = getIslandProfile(body)
  // Fresh stream per build, keyed only by the island — vegetation/ruins must
  // match whether this mesh is for the title orbit or the sailing world.
  const rng = mulberry32(hashString(`${body?.id ?? body?.name ?? 'island'}:props`))

  const positions = []
  const uvs = []
  const colors = []
  const blends = []
  const shore = new THREE.Color(surfaces.shore.color)
  const mid = new THREE.Color(surfaces.body.color)
  const high = new THREE.Color(surfaces.crown.color)
  const tmp = new THREE.Color()
  const meadowSurface =
    archetype === 'scrub' || surfaces.body.tex === 'grass' || surfaces.crown.tex === 'grass'
  const meadowDry = new THREE.Color(0x817548)
  const meadowSoil = new THREE.Color(0x6b4f2e)
  const meadowFresh = new THREE.Color(0x9eaa58)
  const meadowSeed = hashString(`${body?.id ?? 'island'}:meadow-colour`) * 0.001

  // Land rings are denser near the coast (nonlinear t) so the bank that waves
  // actually hit is not a handful of huge flat triangles. Outer land is forced
  // into a steep bank that ends under mean water, then a short shelf dives away.
  const rings = RINGS
  const shelfRings = SHELF_RINGS
  const total = rings + shelfRings
  // Mountain tips dive deeper under the swell so the rock reads as rising
  // from the abyss rather than sitting on a shallow shelf.
  const skirtDepth = landform === 'spire' ? SKIRT_DEPTH + 90 : SKIRT_DEPTH
  const shelfReach = landform === 'spire' ? SHELF_REACH * 0.55 : SHELF_REACH
  const coastBankFrom = landform === 'spire' ? 0.9 : COAST_BANK_FROM
  const texScale =
    landform === 'spire' ? TEXTURE_SCALE * 0.72 : meadowSurface ? TEXTURE_SCALE * 0.62 : TEXTURE_SCALE
  const heights = []
  for (let i = 0; i <= total; i++) {
    const onLand = i <= rings
    // Pack samples toward the waterline: t rises slowly at first, then packs.
    const u = onLand ? i / rings : 1
    const t = onLand ? 1 - Math.pow(1 - u, 1.65) : 1
    const shelfK = onLand ? 0 : (i - rings) / shelfRings
    const rr = t + shelfK * shelfReach
    for (let s = 0; s <= SEGMENTS; s++) {
      const theta = (s / SEGMENTS) * Math.PI * 2
      const x = Math.cos(theta) * radius * rr
      const z = Math.sin(theta) * radius * rr
      let y = heightAt(Math.min(1, t), theta) * height
      if (onLand && t > coastBankFrom) {
        // Steep bank into a submerged foot — swell always covers the edge so
        // lapping does not leave a dry polygonal sand apron.
        const bank = (t - coastBankFrom) / (1 - coastBankFrom)
        const bankW = bank * bank * (3 - 2 * bank) // smoothstep
        // Sample inland height at the bank start so we drop from a real bank,
        // not from whatever the rim fade already crushed to zero.
        const bankTop = heightAt(coastBankFrom, theta) * height
        // Spires hold cliff height longer before the final plunge.
        const hold = landform === 'spire' ? 0.55 : 0.35
        const yField = Math.max(y, bankTop * Math.pow(1 - bank, hold))
        y = yField * (1 - bankW) + COAST_FOOT_Y * bankW
      }
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
      colors.push(0, 0, 0) // filled below, once slopes are known
      blends.push(0)
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
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  // Colour and texture-blend by height *and* slope, now that normals exist.
  // Slope is what sells it: soil and sand sit on the flats, bare rock shows
  // wherever it is steep, and everything within reach of the swell is wet.
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  const blend = geometry.getAttribute('aBlend')
  // Beach band is intentionally thin — a wide band painted sand under the
  // waterline is what made coasts look like endless pale shallows.
  // Spires barely have a beach — wet rock climbs almost to the cliff.
  const beachTop =
    landform === 'spire'
      ? Math.max(SEA_MAX_AMPLITUDE * 0.6, height * 0.012)
      : Math.max(SEA_MAX_AMPLITUDE * 0.9, height * 0.035)
  const tideBand = Math.max(SEA_MAX_AMPLITUDE * 0.55, height * 0.018)
  // Wet zone extends slightly above mean water so the lapping band is dark rock
  // even when a crest has just fallen away.
  const wetAbove = SEA_MAX_AMPLITUDE * 0.35
  for (let i = 0; i < color.count; i++) {
    const y = heights[i]
    const steep = 1 - Math.max(0, normal.getY(i))

    // Shore → body → crown, by height.
    let accent = 0
    if (y < wetAbove) {
      // Submerged + splash zone: wet rock only — never dry sand under the sea.
      const under = y < 0 ? 1 : 1 - y / Math.max(1e-3, wetAbove)
      tmp.copy(TIDE_COLOR).lerp(CLIFF_COLOR, Math.min(1, steep * 1.2) * 0.65)
      tmp.multiplyScalar(0.72 + 0.28 * (1 - under))
      accent = 0
    } else if (y < beachTop) {
      const k = (y - wetAbove) / Math.max(1e-3, beachTop - wetAbove)
      tmp.copy(shore).lerp(mid, k)
      // Beach only on ground flat enough to hold sand (almost never on spires).
      const sandOk = landform === 'spire' ? 0.15 : 1
      accent = (1 - k) * Math.max(0, 1 - steep * 4.0) * sandOk
    } else {
      const f = Math.max(0, Math.min(1, (y - beachTop) / Math.max(1e-3, height - beachTop)))
      if (f < 0.55) tmp.copy(mid).lerp(high, f / 0.55)
      else tmp.copy(high)
      accent = 0
    }

    if (y >= wetAbove && steep > 0.25) {
      const cliff = Math.min(1, (steep - 0.25) / 0.35)
      tmp.lerp(CLIFF_COLOR, cliff * 0.85)
      accent *= 1 - cliff
    }
    if (y >= wetAbove && y < tideBand) {
      tmp.lerp(TIDE_COLOR, 1 - (y - wetAbove) / Math.max(1e-3, tideBand - wetAbove))
    }

    if (meadowSurface && y >= wetAbove && steep < 0.82) {
      const px = positions[i * 3]
      const pz = positions[i * 3 + 2]
      const signal =
        Math.sin(px * 0.0042 + meadowSeed) * 0.5 +
        Math.cos(pz * 0.0051 - meadowSeed * 0.8) * 0.3 +
        Math.sin((px - pz) * 0.008 + meadowSeed * 1.7) * 0.2
      const patch = Math.max(0, Math.min(1, signal * 0.5 + 0.5))
      tmp.multiplyScalar(0.72 + patch * 0.46)
      if (patch < 0.34) tmp.lerp(meadowDry, (0.34 - patch) * 0.38)
      else if (patch > 0.86) tmp.lerp(meadowFresh, (patch - 0.86) * 0.5)
      else if (patch > 0.68) tmp.lerp(meadowSoil, (patch - 0.68) * 0.72)
    }

    // Keep enough of the terrain palette for broad meadow/soil variation to
    // survive distance lighting; the texture shader supplies the fine grain.
    const paletteLift = meadowSurface ? 0.42 : 0.52
    tmp.r = paletteLift + tmp.r * (1 - paletteLift)
    tmp.g = paletteLift + tmp.g * (1 - paletteLift)
    tmp.b = paletteLift + tmp.b * (1 - paletteLift)
    color.setXYZ(i, tmp.r, tmp.g, tmp.b)
    blend.setX(i, Math.max(0, Math.min(1, accent)))
  }
  color.needsUpdate = true
  blend.needsUpdate = true
  geometry.computeBoundingSphere()

  // Body texture is the base; the shore's is blended in over the beach.
  const baseMaps = getSurfaceTextures(surfaces.body.tex) ?? {}
  const shoreMaps = getSurfaceTextures(surfaces.shore.tex) ?? {}
  const terrainMaps = meadowSurface ? getSurfaceTextures('rocky') : null
  const material = applyBlendShader(
    new THREE.MeshStandardMaterial({
      map: baseMaps.map ?? null,
      normalMap: baseMaps.normalMap ?? null,
      // Skip roughnessMap — dark patches in ambientCG maps were reading as
      // wet specular flecks under the sky env map.
      roughnessMap: null,
      vertexColors: true,
      // Dead matte ground — no glitter / wet-plastic specular.
      roughness: 0.97,
      metalness: 0,
      envMapIntensity: 0.02,
      normalScale: new THREE.Vector2(meadowSurface ? 1.45 : 1.15, meadowSurface ? 1.45 : 1.15)
    }),
    surfaces.shore.tex === surfaces.body.tex ? null : shoreMaps,
    terrainMaps
  )

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.kind = 'island'
  mesh.userData.archetype = archetype
  mesh.userData.landform = landform

  // Props on every island mesh (title orbit and in-game share this builder).
  // Cover is rolled per island: some rocks are bare, some hold a few trees,
  // some still have buildings, and a few are both wooded and ruined.
  mesh.add(
    buildVegetation(rng, radius, height, heightAt, archetype, landform, body?.name === 'Haven Reach')
  )
  mesh.add(buildRuins(rng, radius, height, heightAt, archetype, landform, body?.name === 'Haven Reach'))
  // Loose rock at the foot of anything steep (always for mountain tips).
  if (landform === 'stack' || landform === 'mesa' || landform === 'spire' || rng() < 0.5) {
    mesh.add(buildTalus(rng, radius, height, heightAt, surfaces.body, landform))
  }
  return mesh
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

/**
 * Mesh-matching ground Y at normalised radius r / bearing theta.
 * Mirrors the coast-bank drop in buildIslandMesh so plants don't sit on the
 * pre-bank height field while the rendered surface has already plunged.
 */
function meshGroundY(r, theta, height, heightAt, landform = 'dome') {
  const rr = Math.min(1, Math.max(0, r))
  const coastBankFrom = landform === 'spire' ? 0.9 : COAST_BANK_FROM
  let y = heightAt(rr, theta) * height
  if (rr > coastBankFrom && rr < 1) {
    const bank = (rr - coastBankFrom) / (1 - coastBankFrom)
    const bankW = bank * bank * (3 - 2 * bank) // smoothstep
    const bankTop = heightAt(coastBankFrom, theta) * height
    const hold = landform === 'spire' ? 0.55 : 0.35
    const yField = Math.max(y, bankTop * Math.pow(1 - bank, hold))
    y = yField * (1 - bankW) + COAST_FOOT_Y * bankW
  }
  return y
}

/** Ground Y from island-local XZ (same field the mesh samples). */
function groundAtXZ(x, z, radius, height, heightAt, landform = 'dome') {
  const r = Math.hypot(x, z) / Math.max(1, radius)
  if (r >= 1) return COAST_FOOT_Y
  const theta = Math.atan2(z, x)
  return meshGroundY(r, theta, height, heightAt, landform)
}

/**
 * Bury plant roots slightly so continuous height samples seat into the
 * triangulated mesh (domes are convex — chords sit below the curve, so
 * un-sunk plants float above the faces).
 */
function seatPlantY(groundY, plantHeight) {
  return groundY - Math.max(0.45, plantHeight * 0.04)
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
    archetype === 'volcanic' ? 0.55
    : archetype === 'barren' ? 0.4
    : archetype === 'industrial' ? 0.28
    : archetype === 'scrub' ? 0.08
    : archetype === 'drowned' ? 0.12
    : 0.2
  if (landform === 'atoll') bareChance += 0.1
  if (rng() < bareChance) return 0

  // Among vegetated islands: sparse → medium → lush.
  const u = rng()
  if (archetype === 'scrub' || archetype === 'drowned') {
    if (u < 0.2) return range(rng, 0.2, 0.4)
    if (u < 0.55) return range(rng, 0.45, 0.7)
    return range(rng, 0.75, 1)
  }
  if (archetype === 'volcanic' || archetype === 'barren') {
    return range(rng, 0.12, 0.45)
  }
  if (archetype === 'industrial') return range(rng, 0.15, 0.55)
  return range(rng, 0.25, 0.75)
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
const VEGETATION_DENSITY_MULTIPLIER = 2
const VEGETATION_CAP_HEADROOM = 1.5
const VEGETATION_HOME_CAP_HEADROOM = 2
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

  // Per-island growth character: some shores are scrub, some carry tall timber.
  const islandTreeBias = range(rng, 0.7, 1.45)
  const rTreeMax = landform === 'atoll' ? 0.88 : 0.72

  const rollTreeHeight = () => {
    const u = rng()
    if (u < 0.18) return range(rng, 12, 22)
    if (u < 0.82) return range(rng, 22, 40)
    return range(rng, 40, 58)
  }

  const placeTreeAt = (x, z, yaw) => {
    const ground = groundAtXZ(x, z, radius, height, heightAt, landform)
    if (ground < propMinGround()) return false
    const rLocal = Math.hypot(x, z) / Math.max(1, radius)
    if (rLocal < 0.12 || rLocal > (landform === 'atoll' ? 0.92 : 0.78)) return false
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
    }
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
        : 1 + Math.floor(rng() * 2)
    copseCount = Math.min(6, copseCount)
    const perCopse = Math.max(4, Math.ceil(clumpTreeBudget / copseCount))
    for (let c = 0; c < copseCount && trees < treeTarget; c++) {
      let centre = null
      for (let t = 0; t < 28 && !centre; t++) {
        centre = samplePlantSpot(rng, radius, height, heightAt, spotOpts({
          rMin: 0.16,
          rMax: rTreeMax * 0.95
        }))
      }
      if (!centre) continue
      // Copse radius in metres — small thicket vs small wood.
      const copseR =
        layout === 'forest' ? range(rng, 22, 54) * Math.min(1.2, areaK) : range(rng, 12, 32) * Math.min(1.15, areaK)
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
      const targetH =
        range(rng, short ? 1.6 : 3.2, short ? 4.5 : 8.5) * sizeK * (dry ? 0.75 : 1)
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
          const targetH = range(rng, 1.4, 4.2) * sizeK
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
        inst.castShadow = false
        inst.receiveShadow = true
        for (let i = 0; i < dummy.length; i++) inst.setMatrixAt(i, dummy[i])
        inst.instanceMatrix.needsUpdate = true
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
        const targetH = range(rng, 1.6, 3.8) * sizeK
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
  const sizeK = propSizeScale(radius)

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
  const mats = propMaterials()
  const geos = boulderGeometries()
  // Tint slightly toward the island body colour so ash/volcanic shores match.
  const tint = new THREE.Color(surface?.color ?? 0xc4beb4)
  const matLight = mats.boulder.clone()
  const matDark = mats.boulderDark.clone()
  matLight.color.multiply(tint.clone().multiplyScalar(0.55).addScalar(0.45))
  matDark.color.multiply(tint.clone().multiplyScalar(0.5).addScalar(0.4))

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
