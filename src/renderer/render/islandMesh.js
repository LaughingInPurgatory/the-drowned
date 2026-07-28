import * as THREE from 'three'
import { mulberry32, range, pick } from '../procgen/prng.js'
import { getSurfaceTextures } from './textures.js'
import { planetArchetypeForBody } from '../game/probe.js'
import { SEA_MAX_AMPLITUDE } from '../world/sea.js'

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
  sand: { color: 0xc3ab7e, tex: 'sand', rough: 0.96, metal: 0.0 },
  shingle: { color: 0x9c9184, tex: 'rocky', rough: 0.95, metal: 0.01 },
  rock: { color: 0x7a736a, tex: 'rocky', rough: 0.95, metal: 0.02 },
  darkRock: { color: 0x574f48, tex: 'rocky', rough: 0.96, metal: 0.02 },
  grass: { color: 0x5f7444, tex: 'grass', rough: 0.9, metal: 0.0 },
  scrub: { color: 0x6b6b45, tex: 'grass', rough: 0.92, metal: 0.0 },
  ash: { color: 0x3a3330, tex: 'ash', rough: 0.97, metal: 0.03 },
  ruin: { color: 0x8a8b86, tex: 'ruin', rough: 0.86, metal: 0.12 },
  works: { color: 0x6d645a, tex: 'works', rough: 0.82, metal: 0.24 }
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

const LANDFORMS = ['dome', 'ridge', 'mesa', 'stack', 'atoll', 'cluster']
/** How tall each landform stands relative to its radius. */
const LANDFORM_HEIGHT = {
  dome: [0.14, 0.28],
  ridge: [0.16, 0.30],
  mesa: [0.20, 0.34],
  stack: [0.45, 0.85],
  atoll: [0.05, 0.11],
  cluster: [0.16, 0.32]
}

const RINGS = 46
const SEGMENTS = 52
/** Rings of underwater shelf beyond the coast, so no edge stands proud. */
const SHELF_RINGS = 6
/** How far past the coast the shelf reaches, as a fraction of the radius. */
const SHELF_REACH = 0.22
/** How far the skirt runs below the surface, so no swell can undercut it. */
const SKIRT_DEPTH = SEA_MAX_AMPLITUDE + 12
/** World units per texture tile. Keeps a 300 m islet and a 3 km island looking
 *  like the same material rather than the same photograph stretched. */
const TEXTURE_SCALE = 70

function hashString(str) {
  const text = String(str ?? '')
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Deterministic landform for a body, independent of its material archetype. */
export function landformForBody(body) {
  const rng = mulberry32(hashString(`${body?.id ?? 'x'}:landform`))
  // Small rocks are stacks or bare domes far more often than they are atolls.
  const small = (body?.radius ?? 500) < 420
  if (small) return pick(rng, ['stack', 'dome', 'dome', 'cluster'])
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
      amp: range(rng, 0.1, 0.4)
    })
  }
  const lobeAt = (theta) => {
    let v = 1
    for (const l of lobes) v += l.amp * Math.sin(theta * l.freq + l.phase)
    return v
  }

  const noiseSeed = rng() * 1000
  const roughness = range(rng, 0.03, 0.1)
  const detail = (r, theta) =>
    Math.sin(theta * 7 + noiseSeed) * Math.cos(r * 9 + noiseSeed) * roughness * (1 - r)

  if (landform === 'ridge') {
    // A long spine: tall along one axis, falling away sharply to either side.
    const axis = rng() * Math.PI * 2
    const sharpness = range(rng, 1.6, 3.4)
    return (r, theta) => {
      const along = Math.cos(theta - axis)
      const spine = Math.pow(Math.abs(along), sharpness)
      const base = Math.pow(Math.max(0, 1 - r), 0.9)
      return Math.max(0, base * (0.25 + 0.95 * spine) * lobeAt(theta) + detail(r, theta))
    }
  }

  if (landform === 'mesa') {
    // Flat top with a hard shoulder — a drowned plateau.
    const rim = range(rng, 0.45, 0.72)
    const top = range(rng, 0.82, 1.0)
    return (r, theta) => {
      const l = lobeAt(theta)
      const edge = rim * (0.75 + 0.25 * l)
      const h = r < edge ? top : top * Math.pow(Math.max(0, (1 - r) / Math.max(1e-3, 1 - edge)), 1.4)
      return Math.max(0, h * l * 0.85 + detail(r, theta) * 0.4)
    }
  }

  if (landform === 'stack') {
    // A sea stack: narrow, near-vertical, barely any shore.
    const waist = range(rng, 0.3, 0.55)
    return (r, theta) => {
      const l = lobeAt(theta)
      const core = Math.pow(Math.max(0, 1 - r / Math.max(0.1, waist * l)), 0.55)
      const apron = Math.pow(Math.max(0, 1 - r), 3.5) * 0.18
      return Math.max(0, core + apron + detail(r, theta) * 0.3)
    }
  }

  if (landform === 'atoll') {
    // A ring with a lagoon inside it. The lagoon floor stays under water, so
    // the centre reads as enclosed water rather than land.
    const ringR = range(rng, 0.55, 0.78)
    const width = range(rng, 0.16, 0.3)
    return (r, theta) => {
      const l = lobeAt(theta)
      const d = Math.abs(r - ringR * (0.85 + 0.15 * l))
      const ring = Math.exp(-(d * d) / (2 * width * width * 0.25))
      // Break the ring so it is not a perfect donut.
      const gap = 0.55 + 0.45 * Math.sin(theta * 2 + ringR * 10)
      return Math.max(-0.4, ring * l * gap - 0.35 * Math.exp(-(r * r) / 0.08))
    }
  }

  if (landform === 'cluster') {
    // Several small summits — reads as a huddle of rocks rather than one hill.
    const peaks = []
    const n = 2 + Math.floor(rng() * 3)
    for (let i = 0; i < n; i++) {
      peaks.push({
        r: range(rng, 0.1, 0.55),
        theta: rng() * Math.PI * 2,
        amp: range(rng, 0.5, 1),
        width: range(rng, 0.18, 0.36)
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
      // Still has to come down to nothing at the coast.
      return Math.max(0, h * Math.pow(Math.max(0, 1 - r), 0.5) * lobeAt(theta) + detail(r, theta))
    }
  }

  // dome — the plain case: highest inland, falling to the shore, with a ridge
  // line so bigger islands read as having a spine rather than being a bump.
  const ridgeAngle = rng() * Math.PI * 2
  const ridgeStrength = range(rng, 0, 0.45)
  return (r, theta) => {
    const base = Math.pow(Math.max(0, 1 - r), 0.85)
    const ridge = 1 + ridgeStrength * Math.abs(Math.cos(theta - ridgeAngle))
    return Math.max(0, base * lobeAt(theta) * ridge + detail(r, theta))
  }
}

/** Bearings sampled around an island when tracing its coastline. */
const SHORE_SAMPLES = 96
/** Radial steps per bearing. More is a tighter shoreline, at build cost only. */
const SHORE_STEPS = 48
/**
 * How far land must stand above mean water to ground a hull on. Low, so a boat
 * can nose right into the shallows and lie under a beach — but not zero, or a
 * wave trough would let it slide through ground it can plainly see.
 */
const GROUNDING_HEIGHT = SEA_MAX_AMPLITUDE * 0.4

/**
 * The island's shape, built once and cached on the body.
 *
 * Shared deliberately: the mesh you can see and the shoreline you run aground
 * on come from the same height field, so "right up to the beach" means the
 * actual beach rather than a circle drawn round the whole disc. Same rule as
 * the sea — one definition, two consumers.
 */
export function getIslandProfile(body) {
  if (body._islandProfile) return body._islandProfile

  const seed = body.shapeSeed ?? hashString(body.id)
  const rng = mulberry32(seed)
  const archetype = planetArchetypeForBody(body) ?? 'barren'
  // Pick this island's three surfaces. Deterministic, so the beach you
  // remember is the beach you come back to.
  const opts = ARCHETYPE_SURFACES[archetype] ?? ARCHETYPE_SURFACES.barren
  const surfaces = {
    shore: SURFACES[pick(rng, opts.shore)],
    body: SURFACES[pick(rng, opts.body)],
    crown: SURFACES[pick(rng, opts.crown)]
  }
  const landform = landformForBody(body)
  const radius = Math.max(60, body.radius ?? 400)
  const heightBand = LANDFORM_HEIGHT[landform] ?? LANDFORM_HEIGHT.dome
  const height = radius * range(rng, heightBand[0], heightBand[1])
  const heightAt = makeHeightField(rng, landform)

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

  const profile = { archetype, surfaces, landform, radius, height, heightAt, shore, maxShore, rng }
  body._islandProfile = profile
  return profile
}

/**
 * Distance from an island's centre to its shoreline on the bearing of a world
 * point. This is what a hull grounds on.
 */
export function islandShorelineToward(body, x, z) {
  const profile = getIslandProfile(body)
  const theta = Math.atan2(z - body.position[2], x - body.position[0])
  const t = ((theta / (Math.PI * 2)) % 1 + 1) % 1
  // Interpolate between samples so the coast is a curve, not 96 flat facets.
  const f = t * SHORE_SAMPLES
  const i0 = Math.floor(f) % SHORE_SAMPLES
  const i1 = (i0 + 1) % SHORE_SAMPLES
  const k = f - Math.floor(f)
  return profile.shore[i0] * (1 - k) + profile.shore[i1] * k
}

/** Furthest the land reaches — the shell for targeting and arrival ranges. */
export function islandMaxShoreline(body) {
  return getIslandProfile(body).maxShore
}

/**
 * Blend two texture sets across the surface using a per-vertex weight.
 *
 * MeshStandardMaterial only takes one map, so the second is injected with
 * `onBeforeCompile` — that keeps all of three's lighting, shadows and fog and
 * costs one extra sample. Without it every island is one material, and a rocky
 * headland with a sandy beach is not expressible.
 */
function applyBlendShader(material, accentMaps) {
  if (!accentMaps?.map) return material
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAccentMap = { value: accentMaps.map }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBlend;\nvarying float vBlend;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBlend = aBlend;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uAccentMap;\nvarying float vBlend;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // The accent map carries SRGBColorSpace, so the sample is already
          // linear — no manual decode (and no dependency on a three internal
          // that has been renamed twice).
          vec4 accent = texture2D(uAccentMap, vMapUv);
          diffuseColor = mix(diffuseColor, vec4(accent.rgb * vColor, diffuseColor.a), vBlend);
        }`
      )
  }
  // Force a recompile if this material was already used somewhere.
  material.customProgramCacheKey = () => 'islandBlend'
  return material
}

export function buildIslandMesh(body) {
  const { archetype, surfaces, landform, radius, height, heightAt, rng } = getIslandProfile(body)

  const positions = []
  const uvs = []
  const colors = []
  const blends = []
  const shore = new THREE.Color(surfaces.shore.color)
  const mid = new THREE.Color(surfaces.body.color)
  const high = new THREE.Color(surfaces.crown.color)
  const tmp = new THREE.Color()

  // The land runs out to r = 1 and then a shelf continues under the water, so
  // the coast never ends in a vertical wall standing proud of the sea. A hard
  // skirt ring was exactly the "weird geometry poking out" — this slopes away
  // instead, and is under the swell everywhere by the time it stops.
  const rings = RINGS
  const shelfRings = SHELF_RINGS
  const total = rings + shelfRings
  const heights = []
  for (let i = 0; i <= total; i++) {
    const onLand = i <= rings
    const t = onLand ? i / rings : 1
    // Past the coast the shelf keeps widening as it drops away.
    const shelfK = onLand ? 0 : (i - rings) / shelfRings
    const rr = t + shelfK * SHELF_REACH
    for (let s = 0; s <= SEGMENTS; s++) {
      const theta = (s / SEGMENTS) * Math.PI * 2
      const x = Math.cos(theta) * radius * rr
      const z = Math.sin(theta) * radius * rr
      let y = heightAt(Math.min(1, t), theta) * height
      if (!onLand) {
        // Ease from wherever the coast finished down to the shelf floor, so
        // there is no step where land meets water.
        const edge = heightAt(1, theta) * height
        y = edge + (-SKIRT_DEPTH - edge) * (shelfK * shelfK * (3 - 2 * shelfK))
      }
      positions.push(x, y, z)
      heights.push(y)
      // World-scale planar UVs. The old (angle, radius) mapping pinched to a
      // point at the centre and stretched the outer rings, so the same rock
      // texture read as smeared paint on anything but a mid-size island.
      uvs.push(x / TEXTURE_SCALE, z / TEXTURE_SCALE)
      colors.push(0, 0, 0) // filled below, once slopes are known
      blends.push(0)
    }
  }

  const indices = []
  const row = SEGMENTS + 1
  for (let i = 0; i < total; i++) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = i * row + s
      const b = a + row
      indices.push(a, b, a + 1)
      indices.push(a + 1, b, b + 1)
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
  // The beach: everything within a wave or two of the waterline.
  const beachTop = Math.max(SEA_MAX_AMPLITUDE * 2.2, height * 0.09)
  const tideBand = Math.max(SEA_MAX_AMPLITUDE * 1.3, height * 0.04)
  for (let i = 0; i < color.count; i++) {
    const y = heights[i]
    const steep = 1 - Math.max(0, normal.getY(i))

    // Shore → body → crown, by height.
    let accent = 0
    if (y < beachTop) {
      const k = Math.max(0, y) / beachTop
      tmp.copy(shore).lerp(mid, k)
      // A beach only forms where it is flat enough to hold; steep ground at the
      // waterline is a cliff foot, not sand.
      accent = (1 - k) * Math.max(0, 1 - steep * 3.5)
    } else {
      const f = Math.max(0, Math.min(1, (y - beachTop) / Math.max(1e-3, height - beachTop)))
      if (f < 0.55) tmp.copy(mid).lerp(high, f / 0.55)
      else tmp.copy(high)
      accent = 0
    }

    if (steep > 0.3) {
      const cliff = Math.min(1, (steep - 0.3) / 0.4)
      tmp.lerp(CLIFF_COLOR, cliff * 0.8)
      accent *= 1 - cliff
    }
    if (y < tideBand) tmp.lerp(TIDE_COLOR, 1 - Math.max(0, y) / tideBand)

    color.setXYZ(i, tmp.r, tmp.g, tmp.b)
    blend.setX(i, Math.max(0, Math.min(1, accent)))
  }
  color.needsUpdate = true
  blend.needsUpdate = true
  geometry.computeBoundingSphere()

  // Body texture is the base; the shore's is blended in over the beach.
  const baseMaps = getSurfaceTextures(surfaces.body.tex) ?? {}
  const shoreMaps = getSurfaceTextures(surfaces.shore.tex) ?? {}
  const material = applyBlendShader(
    new THREE.MeshStandardMaterial({
      ...baseMaps,
      vertexColors: true,
      roughness: surfaces.body.rough,
      metalness: surfaces.body.metal
    }),
    surfaces.shore.tex === surfaces.body.tex ? null : shoreMaps
  )

  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.kind = 'island'
  mesh.userData.archetype = archetype
  mesh.userData.landform = landform

  // Drowned towns keep their rooftops above water; works keep their gantries.
  // Both are what makes an island read as "someone lived here".
  if (archetype === 'drowned' || archetype === 'industrial') {
    mesh.add(buildRuins(rng, radius, height, heightAt, archetype, landform))
  }
  // Loose rock at the foot of anything steep.
  if (landform === 'stack' || landform === 'mesa' || rng() < 0.5) {
    mesh.add(buildTalus(rng, radius, height, heightAt, surfaces.body))
  }
  return mesh
}

/** Blocky remains standing on the high ground — rooftops, sheds, gantry legs. */
function buildRuins(rng, radius, height, heightAt, archetype, landform) {
  const group = new THREE.Group()
  const maps = getSurfaceTextures(archetype === 'industrial' ? 'industrial' : 'drowned') ?? {}
  const material = new THREE.MeshStandardMaterial({
    ...maps,
    color: archetype === 'industrial' ? 0x6b6259 : 0x8f8d86,
    roughness: 0.82,
    metalness: archetype === 'industrial' ? 0.35 : 0.14
  })
  // A stack has no room to build on; an atoll has no high ground at all.
  const count = landform === 'stack' ? 3 : landform === 'atoll' ? 4 : 6 + Math.floor(rng() * 10)
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2
    const r = range(rng, 0.15, landform === 'atoll' ? 0.85 : 0.75)
    const ground = heightAt(r, theta) * height
    if (ground < 1) continue
    const w = range(rng, radius * 0.02, radius * 0.07)
    const d = range(rng, radius * 0.02, radius * 0.07)
    const h = range(rng, height * 0.12, height * 0.42)
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
    box.position.set(Math.cos(theta) * radius * r, ground + h * 0.35, Math.sin(theta) * radius * r)
    // Everything here has been standing in the weather for a long time.
    box.rotation.set(range(rng, -0.06, 0.06), rng() * Math.PI, range(rng, -0.06, 0.06))
    box.castShadow = true
    box.receiveShadow = true
    group.add(box)
  }
  return group
}

/** Boulders piled where the slope runs out — breaks the shoreline silhouette. */
function buildTalus(rng, radius, height, heightAt, surface) {
  const group = new THREE.Group()
  const maps = getSurfaceTextures(surface.tex) ?? {}
  const material = new THREE.MeshStandardMaterial({
    ...maps,
    color: new THREE.Color(surface.color).multiplyScalar(0.85),
    roughness: 0.96,
    metalness: 0.02,
    flatShading: true
  })
  const geo = new THREE.IcosahedronGeometry(1, 0)
  const count = 5 + Math.floor(rng() * 8)
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2
    const r = range(rng, 0.7, 1.02)
    const ground = heightAt(r, theta) * height
    const s = range(rng, radius * 0.012, radius * 0.045)
    const rock = new THREE.Mesh(geo, material)
    rock.position.set(Math.cos(theta) * radius * r, ground * 0.7, Math.sin(theta) * radius * r)
    rock.scale.set(s, s * range(rng, 0.5, 0.9), s * range(rng, 0.7, 1.2))
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    rock.castShadow = true
    rock.receiveShadow = true
    group.add(rock)
  }
  return group
}

/** Per-frame island work. Land does not move — kept so main.js has one call. */
export function updateIslandMesh() {}
