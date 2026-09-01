import * as THREE from 'three'

let loader = null
const cache = {}
/** Optional hook fired after any map finishes loading (session can re-upload). */
let textureReadyHook = null
let textureReadyHookQueued = false

/**
 * Register a callback invoked (debounced) whenever a texture finishes loading.
 * Used by the session to re-upload maps that bound mid-flight on Continue.
 */
export function setTextureReadyHook(fn) {
  textureReadyHook = typeof fn === 'function' ? fn : null
}

function notifyTextureReady() {
  if (!textureReadyHook || textureReadyHookQueued) return
  textureReadyHookQueued = true
  // Coalesce a burst of JPEG completions into one refresh next frame.
  const run = () => {
    textureReadyHookQueued = false
    try {
      textureReadyHook?.()
    } catch {
      /* */
    }
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
  else setTimeout(run, 0)
}

// One shared, read-only texture triple (or quadruple with metalness) per
// surface prefix rather than a clone per body — keeps GPU memory bounded
// regardless of galaxy size (up to ~1500 planets / many stations, only ever
// a handful live at once since main.js tears down the previous system's
// meshes on jump/dock). Per-body variety still comes from material color
// tints (planets: vertex colors; stations: hullMaterials RNG colors).
//
// Lazy (only touches THREE.TextureLoader, and therefore `document`, the
// first time a given prefix is actually requested) rather than loaded
// eagerly at module import time — combat.js/missions.js's game/*.test.js
// suites transitively import this module (via asteroidFieldMesh.js's
// getAsteroidRocks) but run under plain Node with no DOM, and never
// actually build a mesh, so they must never trigger a real texture load.
//
// Never set needsUpdate on a texture that has no image yet — that spams
// "Texture marked for update but no image data found" every frame and can
// leave materials sampling empty maps until a hard reload.
function textureHasImage(tex) {
  const img = tex?.image
  if (!img) return false
  // HTMLImageElement: must be fully loaded — width alone can be non-zero on a
  // broken/incomplete decode and still triggers Three's empty-upload warning.
  if (typeof img.complete === 'boolean') {
    return img.complete && (img.naturalWidth > 0 || img.width > 0)
  }
  if (img.data && typeof img.width === 'number' && img.width > 0) return true
  if (typeof img.width === 'number' && img.width > 0 && typeof img.height === 'number' && img.height > 0) {
    return true
  }
  return false
}

/** Resolve public/ textures against the page origin (dev server + packaged). */
function resolveTextureUrl(relPath) {
  const clean = String(relPath || '').replace(/^\.\//, '')
  if (typeof window === 'undefined') return clean
  try {
    return new URL(clean, window.location.href).href
  } catch {
    return clean.startsWith('/') ? clean : `/${clean}`
  }
}

function applyMapSettings(tex, { srgb = false, repeatU = 1, repeatV = 1 } = {}, markUpdate = false) {
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatU, repeatV)
  // High anisotropy so dense plating / terrain stays sharp at glancing angles.
  tex.anisotropy = 16
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  if (markUpdate && textureHasImage(tex)) tex.needsUpdate = true
  return tex
}

/** Full configure once the image is present (load callback). */
function configureMap(tex, opts = {}) {
  return applyMapSettings(tex, opts, true)
}

function loadMap(url, opts = {}) {
  // Soft-configure the placeholder (wrap / colour space) without forcing a
  // GPU upload. needsUpdate only after the image actually arrives.
  // Clones made while the load is in-flight share this texture's Source; when
  // the image lands we re-configure those clones so they actually show up.
  const resolved = resolveTextureUrl(url)
  const tex = loader.load(
    resolved,
    (t) => {
      configureMap(t, opts)
      const clones = t.userData?._mapClones
      if (clones?.length) {
        for (const c of clones) configureMap(c, opts)
        clones.length = 0
      }
      notifyTextureReady()
    },
    undefined,
    () => console.warn('[textures] failed to load', resolved)
  )
  // WebGPU Textures.updateTexture crashes on Texture.DEFAULT_IMAGE (null) when
  // version > 0 — Texture's constructor always bumps version once. Hold the
  // GPU upload until the JPEG lands (configureMap sets needsUpdate then).
  tex.version = 0
  tex.userData = tex.userData ?? {}
  tex.userData._mapClones = []
  tex.userData._srcUrl = resolved
  return applyMapSettings(tex, opts, false)
}

// Which ambientCG sets actually ship a `_metalness.jpg`. Asking for one that
// does not exist (rock, used by the `rubble` station role) 404s on every load
// and leaves a permanently image-less texture bound to the material.
const METALNESS_SETS = new Set([
  'alienbio',
  'alienplate',
  'armor',
  'darkmetal',
  'painted',
  'plates',
  'shipmetal',
  'trim'
])

function loadSet(prefix, { repeatU = 4, repeatV = 2, withMetalness = false } = {}) {
  const wantMetal = withMetalness && METALNESS_SETS.has(prefix)
  const key = `${prefix}|${repeatU}x${repeatV}|m${wantMetal ? 1 : 0}`
  if (cache[key]) return cache[key]
  // Headless (node --test): there is no image pipeline to load into. Return no
  // maps rather than throwing, so mesh builders stay callable in tests.
  if (typeof document === 'undefined') return undefined
  loader ??= new THREE.TextureLoader()
  // Prefer absolute-from-origin paths so Electron file:// and Vite dev both hit
  // public/textures without depending on the current route fragment.
  const opts = { repeatU, repeatV }
  const map = loadMap(`textures/${prefix}_color.jpg`, { ...opts, srgb: true })
  const normalMap = loadMap(`textures/${prefix}_normal.jpg`, opts)
  const roughnessMap = loadMap(`textures/${prefix}_roughness.jpg`, opts)
  const set = { map, normalMap, roughnessMap }
  // Only bind metalness when the set actually ships a map — otherwise rock/grass
  // etc. 404 forever and leave an empty texture bound to the material.
  if (wantMetal) {
    set.metalnessMap = loadMap(`textures/${prefix}_metalness.jpg`, opts)
  }
  cache[key] = set
  return set
}

// CC0 (public domain, no attribution required) PBR photo textures from
// ambientCG (ambientcg.com), tiled via RepeatWrapping so a handful of source
// sets cover every surface on the sea. See public/textures/AMBIENTCG_CC0.txt.
//
// These are island *surfaces*, not island archetypes. An island mixes two of
// these (see render/islandMesh.js), so a rocky headland can have a sandy beach
// and a grassy top without needing a texture per combination.
//
//   sand    ← Ground037   gravel/shingle ← Gravel025
//   grass   ← Grass003    rock/rocky     ← Rock048
//   concrete ← Concrete034  brick ← Bricks075A  boulder ← Rock051
const ARCHETYPE_PREFIX = {
  sand: 'sand',
  shingle: 'gravel',
  rocky: 'rock',
  barren: 'rock',
  grass: 'grass',
  scrub: 'grass',
  ruin: 'concrete',
  drowned: 'concrete',
  works: 'darkmetal',
  industrial: 'darkmetal',
  volcanic: 'lava',
  ash: 'lava',
  concrete: 'concrete',
  brick: 'brick',
  boulder: 'boulder'
}

/**
 * Island / terrain surface maps by surface key (see islandMesh SURFACES.tex).
 * Returns undefined only headless (tests) or for unknown keys.
 */
export function getSurfaceTextures(archetype) {
  const prefix = ARCHETYPE_PREFIX[archetype]
  if (!prefix) return undefined
  // Island UVs are world XZ / TEXTURE_SCALE. Keep texture.repeat modest so
  // tiles stay large enough to read from the title-orbit distance (~2–3 km),
  // not fine noise that mipmaps into a solid plastic colour.
  if (prefix === 'sand') return loadSet(prefix, { repeatU: 0.85, repeatV: 0.85 })
  if (prefix === 'gravel') return loadSet(prefix, { repeatU: 0.9, repeatV: 0.9 })
  if (prefix === 'grass') return loadSet(prefix, { repeatU: 0.75, repeatV: 0.75 })
  if (prefix === 'rock') return loadSet(prefix, { repeatU: 0.7, repeatV: 0.7 })
  if (prefix === 'concrete') return loadSet(prefix, { repeatU: 0.85, repeatV: 0.85 })
  if (prefix === 'brick') return loadSet(prefix, { repeatU: 0.9, repeatV: 0.9 })
  if (prefix === 'boulder') return loadSet(prefix, { repeatU: 0.65, repeatV: 0.65 })
  return loadSet(prefix)
}

/**
 * Prop-scale maps (shore boulders, ruin walls, tree bark). Coarse enough that
 * masonry still reads from a few hundred metres, not a solid grey face.
 */
export function getPropTextures(kind) {
  if (kind === 'boulder') return loadSet('boulder', { repeatU: 1.1, repeatV: 1.1 })
  if (kind === 'concrete') return loadSet('concrete', { repeatU: 1.2, repeatV: 1.2 })
  if (kind === 'brick') return loadSet('brick', { repeatU: 1.35, repeatV: 1.35 })
  if (kind === 'rock') return loadSet('rock', { repeatU: 1.0, repeatV: 1.0 })
  // Tree trunks — ambientCG Bark012. Tighter tile than terrain so bark reads
  // on ~2-unit baked protos that are later scaled up at placement.
  if (kind === 'bark') return loadSet('bark', { repeatU: 1.6, repeatV: 1.6 })
  return getSurfaceTextures(kind)
}

/**
 * Vegetation maps: foliage reuses island grass; trunks use bark.
 * Shared across every plant clone (maps are read-only).
 */
export function getPlantTextures(kind) {
  if (kind === 'foliage' || kind === 'grass') {
    // Slightly denser than island ground so canopies keep leaf grain after scale.
    return loadSet('grass', { repeatU: 1.4, repeatV: 1.4 })
  }
  if (kind === 'bark' || kind === 'trunk') return getPropTextures('bark')
  return undefined
}

// ── Procedural terrain layers ───────────────────────────────────────────────
//
// Four tileable PBR layers the island shader splats between (render/
// terrainMaterial.js). Generated here rather than loaded, so there is one set
// for the whole world — ~170 islands share these nine textures and allocate
// nothing per body.
//
// Two maps per layer, four channels of data each, so the shader gets
// everything it needs in two fetches per plane:
//
//   map        RGB albedo (sRGB)          A  roughness
//   normalMap  RGB tangent normal (GL)    A  height
//
// The height in the normal map's alpha is the important one: it drives the
// height-blend mask, which is what makes gravel poke through sand along a
// ragged natural edge instead of the two cross-fading like a slide dissolve.

/** Layer tile resolution. At the ~5.5 m world tile this is ~1 cm / texel. */
const TERRAIN_LAYER_SIZE = 512
/** Micro-detail normal — tiled far denser, so it can be smaller. */
const TERRAIN_DETAIL_SIZE = 256

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  return null
}

/**
 * Seamless value noise on an integer lattice.
 *
 * Every octave wraps its lattice at its own frequency, so the result tiles
 * exactly at UV 1.0 — which is the whole point, since these maps repeat every
 * few metres of coastline and any seam would draw a grid across the island.
 */
function makeTileableNoise(seed) {
  // Periods are per-axis. A single shared period silently breaks the seam on
  // any anisotropic noise — which is most of them here, since bedding planes
  // and grass blades are exactly the case where the two axes differ.
  const hash = (ix, iy, perX, perY) => {
    const x = ((ix % perX) + perX) % perX
    const y = ((iy % perY) + perY) % perY
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2654435761)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const value = (x, y, perX, perY) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const u = fx * fx * (3 - 2 * fx)
    const v = fy * fy * (3 - 2 * fy)
    const a = hash(x0, y0, perX, perY)
    const b = hash(x0 + 1, y0, perX, perY)
    const c = hash(x0, y0 + 1, perX, perY)
    const d = hash(x0 + 1, y0 + 1, perX, perY)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  /** @param bx,by integer lattice cells across the tile (keeps octaves tileable) */
  const fbm = (x, y, bx, by, octaves, gain = 0.5) => {
    let amp = 1
    let sum = 0
    let norm = 0
    let fx = bx
    let fy = by
    for (let i = 0; i < octaves; i++) {
      sum += value(x * fx, y * fy, fx, fy) * amp
      norm += amp
      amp *= gain
      fx *= 2
      fy *= 2
    }
    return sum / norm
  }
  /** Sharp creases — cracks, fracture lines, blade edges. */
  const ridged = (x, y, bx, by, octaves, gain = 0.5) => {
    let amp = 1
    let sum = 0
    let norm = 0
    let fx = bx
    let fy = by
    for (let i = 0; i < octaves; i++) {
      const v = 1 - Math.abs(value(x * fx, y * fy, fx, fy) * 2 - 1)
      sum += v * v * amp
      norm += amp
      amp *= gain
      fx *= 2
      fy *= 2
    }
    return sum / norm
  }
  /**
   * Tileable Worley. Pebbles and rock cells need real cell boundaries;
   * thresholded fbm gives blobs, not stones. `id` is a stable per-cell random
   * so every cobble can be a different stone rather than the same grey dome.
   */
  const worley = (x, y, cellsX, cellsY = cellsX) => {
    const cx = Math.floor(x * cellsX)
    const cy = Math.floor(y * cellsY)
    let f1 = 9
    let f2 = 9
    let id = 0
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const gx = cx + i
        const gy = cy + j
        const jx = hash(gx, gy, cellsX, cellsY)
        const jy = hash(gx + 71, gy + 33, cellsX, cellsY)
        const dx = x - (gx + jx) / cellsX
        const dy = y - (gy + jy) / cellsY
        const d = Math.hypot(dx * cellsX, dy * cellsY)
        if (d < f1) {
          f2 = f1
          f1 = d
          id = hash(gx + 17, gy + 91, cellsX, cellsY)
        } else if (d < f2) {
          f2 = d
        }
      }
    }
    return { f1, f2, id }
  }
  return { hash, value, fbm, ridged, worley }
}

/**
 * Turn a height function + a shading function into the packed map pair.
 *
 * The normal is derived from the same height field the shader later blends on,
 * so a chip in the albedo, the bump you see, and the mask that decides whether
 * gravel wins over sand there are all the same feature.
 */
/**
 * Wrap-aware separable box blur, run twice so the kernel is roughly Gaussian.
 * A single box leaves its own square footprint in the result, which on a
 * tiling map is another artefact to explain. Running sums, so O(texels).
 */
function blurWrap(src, size, radius) {
  const n = size * size
  const w = radius * 2 + 1
  // One padded line, wrapped at both ends, so the running sum never needs a
  // modulo in the inner loop. These maps are 512² × 5 channels × 5 layers and
  // this runs on the main thread at first landfall.
  const line = new Float32Array(size + 2 * radius + 1)
  let a = src
  let b = new Float32Array(n)
  for (let pass = 0; pass < 4; pass++) {
    const stride = pass % 2 === 0 ? 1 : size
    const step = pass % 2 === 0 ? size : 1
    for (let j = 0; j < size; j++) {
      const base = j * step
      for (let k = 0; k < line.length; k++) {
        line[k] = a[base + ((k - radius + size) % size) * stride]
      }
      let sum = 0
      for (let k = 0; k < w; k++) sum += line[k]
      for (let k = 0; k < size; k++) {
        b[base + k * stride] = sum / w
        sum += line[k + w] - line[k]
      }
    }
    const t = a
    a = b
    b = t === src ? new Float32Array(n) : t
  }
  return a
}

/**
 * Take everything slower than a few cycles per tile out of a tiling map.
 *
 * A tiling texture has to be *flat at its own tile size*. Any structure as
 * large as the tile survives every mip level, so every copy carries the same
 * blob in the same place, and a blob on a grid is wallpaper — this is what
 * wrapped every hillside in fish scales, and it is not fixable in the shader:
 * a single planar fetch of one of these tiles latticed on its own, with no
 * triplanar and no domain warp involved.
 *
 * Subtracting the tile's own low-pass keeps every crack, blade and cobble and
 * throws away the patch they sat in. Large-scale variation is not lost, it
 * moves to where it belongs — `terrainMaterial.js` puts it back from macro
 * noise measured in tens of metres, which is not on a grid.
 */
function flattenTile(buf, size, strength = 0.92) {
  // size/16 puts the cutoff at roughly six cycles per tile. Measured, not
  // guessed: a 2.6 m tile at the distance the repeat was still visible covers
  // 26 screen pixels, which is mip level four or five, and what survives at
  // that mip is the five-to-eight-cycle band. A gentler cutoff (size/8) left
  // exactly that band intact and the repeat with it.
  const radius = Math.max(2, Math.round(size / 16))
  const lp = blurWrap(buf, size, radius)
  let mean = 0
  for (let i = 0; i < buf.length; i++) mean += buf[i]
  mean /= buf.length
  for (let i = 0; i < buf.length; i++) buf[i] -= (lp[i] - mean) * strength
}

/** Rescale in place to 0..1. */
function normalise01(buf) {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] < lo) lo = buf[i]
    if (buf[i] > hi) hi = buf[i]
  }
  const span = hi - lo || 1
  for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] - lo) / span
}

function encodeTerrainLayer(size, heightFn, shadeFn, bump) {
  const albedoCanvas = makeCanvas(size, size)
  const normalCanvas = makeCanvas(size, size)
  if (!albedoCanvas || !normalCanvas) return null
  const actx = albedoCanvas.getContext('2d', { willReadFrequently: true })
  const nctx = normalCanvas.getContext('2d', { willReadFrequently: true })
  if (!actx || !nctx) return null

  const px = size * size
  const H = new Float32Array(px)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) H[y * size + x] = heightFn(x / size, y / size)
  }
  normalise01(H)
  // Relief is flattened too, not just colour: a metre-wide swell in the height
  // map is a metre-wide swell in the normal map and in the splat mask, and it
  // tiles just as visibly as a colour patch does.
  flattenTile(H, size)
  normalise01(H)

  // Shade into float channels first so the same high-pass can be applied to
  // albedo and roughness before anything is quantised to 8 bits.
  const chan = [new Float32Array(px), new Float32Array(px), new Float32Array(px), new Float32Array(px)]
  const rgba = [0, 0, 0, 0]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      shadeFn(H[i], x / size, y / size, rgba)
      for (let c = 0; c < 4; c++) chan[c][i] = rgba[c]
    }
  }
  for (let c = 0; c < 4; c++) flattenTile(chan[c], size)

  const aimg = actx.createImageData(size, size)
  const nimg = nctx.createImageData(size, size)
  const ad = aimg.data
  const nd = nimg.data
  const at = (x, y) => H[(((y % size) + size) % size) * size + ((((x % size) + size) % size))]
  // Running mean, in the linear space the sampler returns — this is the colour
  // the layer resolves to once it is too far away to see any of its detail.
  // Without it, terrain a few hundred metres out still draws a metre-scale tile
  // at full strength and the repeat reads as woven wallpaper. See
  // terrainMaterial.js `far`.
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const sum = [0, 0, 0, 0]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const o = i * 4
      const h = H[i]
      for (let c = 0; c < 4; c++) rgba[c] = Math.max(0, Math.min(1, chan[c][i]))
      for (let c = 0; c < 3; c++) sum[c] += toLinear(rgba[c])
      sum[3] += rgba[3]
      ad[o] = Math.round(rgba[0] * 255)
      ad[o + 1] = Math.round(rgba[1] * 255)
      ad[o + 2] = Math.round(rgba[2] * 255)
      ad[o + 3] = Math.round(rgba[3] * 255)

      // Sobel on the wrapped height field — a central difference alone leaves a
      // visible ridge of noise on grainy layers like sand.
      const gx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
      let nx = -gx * bump
      let ny = -gy * bump
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      nd[o] = Math.round((nx * 0.5 + 0.5) * 255)
      nd[o + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      nd[o + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      nd[o + 3] = Math.round(h * 255)
    }
  }
  actx.putImageData(aimg, 0, 0)
  nctx.putImageData(nimg, 0, 0)

  const wrap = (canvasEl, srgb) => {
    const tex = new THREE.CanvasTexture(canvasEl)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 16
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    return tex
  }
  return {
    map: wrap(albedoCanvas, true),
    normalMap: wrap(normalCanvas, false),
    mean: [sum[0] / px, sum[1] / px, sum[2] / px],
    meanRough: sum[3] / px
  }
}

const mixc = (a, b, t) => a + (b - a) * t
const sstep = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * Weathered sedimentary rock — the cliff layer.
 *
 * Bedding planes are the primary structure, not a fracture honeycomb: a
 * drowned coastline exposes strata, and horizontal banding is the single
 * strongest cue that a face is rock and not a brown hill. Cross-fracture,
 * spall and grain sit on top of it.
 */
function makeRockLayer() {
  const n = makeTileableNoise(1471)

  // Gentle organic flow — sedimentary drift without harsh parallel stripes
  const bedU = (x, y) => y + n.fbm(x * 1.5, y * 0.8, 3, 2, 3) * 0.08 + n.fbm(x * 3, y * 2, 7, 5, 2) * 0.03
  /** Multi-scale rock grain and mineral structure. */
  const stonePattern = (x, y) => {
    const u = bedU(x, y)
    const grain = n.fbm(x * 4, u * 6, 4, 6, 3)
    const crag = n.ridged(x * 2.5 + u * 0.5, u * 3.5, 8, 8, 3, 0.45)
    const micro = n.fbm(x * 12, y * 12, 12, 12, 2)
    return { grain, crag, micro }
  }

  /**
   * Multi-scale rock fracture: primary joint blocks, edge spall, and fissure cracks.
   */
  const joints = (x, y) => {
    const a = n.worley(x, y, 16, 14)
    const b = n.worley(x + 0.41, y + 0.53, 36, 32)
    const c = n.worley(x * 2 + 0.17, y * 2 + 0.82, 64, 56)
    return {
      major: 1 - sstep(0, 0.18, a.f2 - a.f1),
      minor: 1 - sstep(0, 0.22, b.f2 - b.f1),
      crack: 1 - sstep(0, 0.12, c.f2 - c.f1),
      idA: a.id,
      idB: b.id,
      domeA: Math.min(1, a.f1),
      domeB: Math.min(1, b.f1)
    }
  }

  const heightFn = (x, y) => {
    const s = stonePattern(x, y)
    const j = joints(x, y)
    // Layered cliff relief: broad rock shelves, craggy facets, and surface grain
    const shelf = s.grain * 0.22 + s.crag * 0.28
    const block = (1 - j.domeA) * 0.14 + (1 - j.domeB) * 0.08
    const spall = n.ridged(x, y, 42, 38, 3) * 0.22
    const chip = n.ridged(x + 1.3, y - 0.7, 96, 88, 2) * 0.12
    const grain = s.micro * 0.14
    return shelf + block + spall + chip + grain - j.major * 0.22 - j.minor * 0.12 - j.crack * 0.08
  }

  const shadeFn = (h, x, y, out) => {
    const s = stonePattern(x, y)
    const j = joints(x, y)
    // Facet-to-facet tonal variety so cliffs read as fractured stone
    const facetTone = j.idA * 0.6 + j.idB * 0.4
    const iron = n.fbm(x + 0.31, y - 0.17, 10, 8, 3)
    const lich = sstep(0.58, 0.88, n.fbm(x + 3.7, y - 2.1, 14, 14, 3)) * sstep(0.35, 0.8, h)
    const soot = sstep(0.38, 0.82, n.fbm(x - 1.5, y + 2.8, 6, 16, 3))
    const quartz = sstep(0.65, 0.93, n.fbm(x + 2.2, y + 5.1, 160, 140, 2))

    // Base rock luminance: rich, tactile natural stone range (not muddy black)
    const v = mixc(0.22, 0.76, h * 0.7 + s.crag * 0.3) * mixc(0.88, 1.12, facetTone)

    // Warm sedimentary and cool slate stone tones
    let r = v * mixc(0.94, 1.08, s.grain)
    let g = v * mixc(0.92, 1.04, s.grain)
    let bl = v * mixc(0.88, 1.02, s.grain)

    // Mineral oxidation and iron tinting in weathered pockets
    const rust = sstep(0.55, 0.88, iron) * (1 - h * 0.35)
    r = mixc(r, r * 1.35 + 0.08, rust * 0.4)
    g = mixc(g, g * 1.05 + 0.02, rust * 0.4)
    bl = mixc(bl, bl * 0.75, rust * 0.4)

    // Weathering stains and runoff down the cliff
    r *= mixc(1, 0.78, soot * 0.4)
    g *= mixc(1, 0.8, soot * 0.4)
    bl *= mixc(1, 0.82, soot * 0.4)

    // Sparkling quartz / crystalline mineral grain
    r += quartz * 0.12
    g += quartz * 0.12
    bl += quartz * 0.11

    // Moss / lichen in sheltered crannies
    r = mixc(r, 0.28, lich * 0.45)
    g = mixc(g, 0.35, lich * 0.45)
    bl = mixc(bl, 0.22, lich * 0.45)

    out[0] = r
    out[1] = g
    out[2] = bl
    // Fractured crevices are slightly damper/darker; exposed stone is dry matte
    out[3] = mixc(0.72, 0.94, h) - lich * 0.06
  }
  return encodeTerrainLayer(TERRAIN_LAYER_SIZE, heightFn, shadeFn, 2.2)
}

/** Beach sand: wind ripples, grain, shell fleck, the odd buried pebble. */
function makeSandLayer() {
  const n = makeTileableNoise(9137)
  const heightFn = (x, y) => {
    const warp = n.fbm(x, y, 3, 3, 3) * 0.5
    // Ripple crests run across the prevailing wind and wander with it.
    const ripple = Math.sin((x * 2 + y * 1 + warp) * Math.PI * 2 * 5) * 0.5 + 0.5
    const ripple2 = Math.sin((x * 1 - y * 2 + warp * 1.4) * Math.PI * 2 * 7) * 0.5 + 0.5
    const drift = n.fbm(x, y, 5, 5, 4)
    const grain = n.fbm(x, y, 96, 96, 2)
    const pebble = Math.max(0, 1 - n.worley(x + 0.4, y + 0.7, 7, 7).f1 * 2.6)
    return (
      ripple * 0.28 * sstep(0.3, 0.8, drift) +
      ripple2 * 0.12 +
      drift * 0.3 +
      grain * 0.1 +
      pebble * pebble * 0.3
    )
  }
  const shadeFn = (h, x, y, out) => {
    const grain = n.fbm(x + 1.7, y - 0.9, 128, 128, 2)
    const patch = n.fbm(x, y, 4, 4, 3)
    const dark = n.fbm(x + 5.5, y + 2.2, 24, 24, 3)
    // Pale warm quartz, darker mineral streaks, bright shell grit on the crests.
    let r = mixc(0.44, 0.87, h) * mixc(0.92, 1.07, patch)
    let g = mixc(0.37, 0.79, h) * mixc(0.94, 1.05, patch)
    let b = mixc(0.27, 0.62, h) * mixc(1.0, 0.98, patch)
    const speck = sstep(0.74, 0.96, grain)
    r = mixc(r, 0.95, speck * 0.5)
    g = mixc(g, 0.92, speck * 0.5)
    b = mixc(b, 0.85, speck * 0.5)
    const heavy = sstep(0.62, 0.88, dark)
    r = mixc(r, r * 0.5, heavy * 0.5)
    g = mixc(g, g * 0.5, heavy * 0.5)
    b = mixc(b, b * 0.58, heavy * 0.5)
    out[0] = r
    out[1] = g
    out[2] = b
    out[3] = 0.93 - speck * 0.12
  }
  return encodeTerrainLayer(TERRAIN_LAYER_SIZE, heightFn, shadeFn, 1.5)
}

/** Shingle: rounded storm-beach cobbles, wet-dark grit in the gaps between. */
function makeShingleLayer() {
  const n = makeTileableNoise(5521)
  /** Nearest cobble at a given cobble scale: dome height + which stone it is. */
  const stone = (x, y, cells, offX, offY) => {
    const c = n.worley(x + offX, y + offY, cells, cells)
    // Per-stone radius so the beach is not a lattice of identical marbles.
    const rad = 0.42 + c.id * 0.34
    const d = Math.min(1, c.f1 / rad)
    return { h: Math.sqrt(Math.max(0, 1 - d * d)), id: c.id, edge: d }
  }
  /** Whichever cobble scale wins here — that stone owns the pixel's colour. */
  const top = (x, y) => {
    const a = stone(x, y, 7, 0, 0)
    const b = stone(x, y, 12, 0.37, 0.11)
    const c = stone(x, y, 20, 0.71, 0.53)
    a.h *= 1.0
    b.h *= 0.74
    c.h *= 0.5
    let best = a
    if (b.h > best.h) best = b
    if (c.h > best.h) best = c
    return best
  }
  const heightFn = (x, y) => {
    const t = top(x, y)
    const grit = n.fbm(x, y, 70, 70, 3) * 0.1
    // Cube the dome so stones sit on a floor of grit rather than merging into
    // one lumpy sheet — the gaps are what makes shingle read as loose stones.
    return t.h * t.h * 0.9 + grit
  }
  const shadeFn = (h, x, y, out) => {
    const t = top(x, y)
    const id = t.id
    const streak = n.fbm(x + 2.2, y, 30, 26, 3)
    const grit = n.fbm(x, y, 70, 70, 3)
    // Flint, granite, sandstone, slate — sampled per stone.
    let r
    let g
    let b
    if (id < 0.3) {
      r = 0.2 + id * 0.5
      g = 0.19 + id * 0.45
      b = 0.19 + id * 0.4
    } else if (id < 0.62) {
      r = 0.42 + (id - 0.3) * 1.1
      g = 0.4 + (id - 0.3) * 1.0
      b = 0.36 + (id - 0.3) * 0.85
    } else if (id < 0.85) {
      r = 0.5 + (id - 0.62) * 0.9
      g = 0.42 + (id - 0.62) * 0.75
      b = 0.3 + (id - 0.62) * 0.5
    } else {
      r = 0.22
      g = 0.25
      b = 0.29
    }
    // Light falls off toward the stone's edge — a lit dome, not a flat disc.
    const lit = mixc(0.5, 1.18, t.h)
    r *= lit
    g *= lit
    b *= lit
    const vein = sstep(0.66, 0.9, streak) * t.h
    r = mixc(r, r * 1.4 + 0.14, vein * 0.5)
    g = mixc(g, g * 1.38 + 0.13, vein * 0.5)
    b = mixc(b, b * 1.3 + 0.11, vein * 0.5)
    // Wet dark grit packed into the gaps between the cobbles.
    const gap = 1 - sstep(0.02, 0.4, h)
    r = mixc(r, 0.11 + grit * 0.1, gap * 0.85)
    g = mixc(g, 0.11 + grit * 0.1, gap * 0.85)
    b = mixc(b, 0.12 + grit * 0.1, gap * 0.85)
    out[0] = r
    out[1] = g
    out[2] = b
    // Water sits in the gaps between cobbles — glossier down there.
    out[3] = mixc(0.42, 0.9, h)
  }
  return encodeTerrainLayer(TERRAIN_LAYER_SIZE, heightFn, shadeFn, 3.0)
}

/** Coastal turf: blade clumps, bare soil scars, dead thatch, moss. */
function makeGrassLayer() {
  const n = makeTileableNoise(3313)
  const bareAt = (x, y) => sstep(0.55, 0.84, n.fbm(x + 3.1, y - 1.4, 3, 3, 3))
  const heightFn = (x, y) => {
    // Clumps first, then individual blades inside them. Blades are strongly
    // anisotropic — isotropic ridged noise reads as lichen, not grass.
    const clump = n.fbm(x, y, 6, 6, 3)
    const lean = n.fbm(x, y, 4, 4, 2) * 0.1
    const blade = n.ridged(x + lean, y, 90, 22, 3, 0.42)
    const blade2 = n.ridged(x - lean * 1.4 + 0.31, y + 0.17, 54, 14, 2, 0.4)
    const fine = n.ridged(x, y, 160, 40, 2)
    return (
      (clump * 0.3 + blade * 0.32 + blade2 * 0.24 + fine * 0.14) * (1 - bareAt(x, y) * 0.8)
    )
  }
  const shadeFn = (h, x, y, out) => {
    const bare = bareAt(x, y)
    const dry = n.fbm(x - 2.3, y + 4.7, 5, 5, 4)
    const moss = sstep(0.7, 0.93, n.fbm(x, y + 6.1, 14, 14, 3))
    // Deep shadowed litter at the base of the clump, lit blade tips above.
    let r = mixc(0.035, 0.3, h)
    let g = mixc(0.06, 0.42, h)
    let b = mixc(0.025, 0.14, h)
    // Sun-bleached straw. Coastal turf is never one saturated green, and a
    // saturated green terrain layer is exactly what reads as plastic.
    const bleach = sstep(0.34, 0.8, dry)
    r = mixc(r, mixc(0.13, 0.66, h), bleach)
    g = mixc(g, mixc(0.12, 0.58, h), bleach)
    b = mixc(b, mixc(0.05, 0.25, h), bleach)
    r = mixc(r, 0.04, moss * 0.4)
    g = mixc(g, 0.19, moss * 0.4)
    b = mixc(b, 0.05, moss * 0.4)
    // Soil scars — dry earth showing through, not a darker green.
    const soilN = n.fbm(x, y + 8.3, 30, 30, 3)
    const grit = sstep(0.72, 0.95, n.fbm(x + 6.7, y, 90, 90, 2))
    r = mixc(r, mixc(0.16, 0.36, soilN) + grit * 0.2, bare)
    g = mixc(g, mixc(0.11, 0.26, soilN) + grit * 0.18, bare)
    b = mixc(b, mixc(0.07, 0.17, soilN) + grit * 0.14, bare)
    out[0] = r
    out[1] = g
    out[2] = b
    out[3] = mixc(0.99, 0.84, h) - bleach * 0.06
  }
  return encodeTerrainLayer(TERRAIN_LAYER_SIZE, heightFn, shadeFn, 2.4)
}

/**
 * Micro-detail normal. Tiled ~40× denser than the layers so the ground still
 * has surface under your feet at a metre; faded out with distance by the
 * shader so it never becomes a shimmering noise field on a far headland.
 */
function makeDetailNormal() {
  const n = makeTileableNoise(7717)
  const heightFn = (x, y) =>
    n.fbm(x, y, 12, 12, 4) * 0.5 + n.ridged(x, y, 30, 30, 3) * 0.3 + n.fbm(x, y, 80, 80, 2) * 0.2
  const shadeFn = (h, x, y, out) => {
    out[0] = out[1] = out[2] = h
    out[3] = 1
  }
  const pair = encodeTerrainLayer(TERRAIN_DETAIL_SIZE, heightFn, shadeFn, 2.2)
  return pair?.normalMap ?? null
}

/**
 * The island splat set. Built once, shared by every island in the world.
 * Returns undefined headless (node --test has no canvas).
 */
export function getTerrainLayerMaps() {
  const key = 'terrainLayers|proc|v1'
  if (cache[key] !== undefined) return cache[key]
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
    cache[key] = undefined
    return undefined
  }
  const rock = makeRockLayer()
  const sand = makeSandLayer()
  const shingle = makeShingleLayer()
  const grass = makeGrassLayer()
  if (!rock || !sand || !shingle || !grass) {
    cache[key] = undefined
    return undefined
  }
  const set = { rock, sand, shingle, grass, detailNormal: makeDetailNormal() }
  cache[key] = set
  return set
}

/**
 * Ocean micro-detail normal (Foam001 NormalGL, CC0). Not an albedo — used only
 * as high-frequency normal detail that fades with distance so the open sea
 * does not tile into a repeating photo.
 */
export function getWaterNormalMap() {
  const key = 'water|normal|v1'
  if (cache[key]) return cache[key]
  if (typeof document === 'undefined') return undefined
  loader ??= new THREE.TextureLoader()
  const waterUrl = resolveTextureUrl('textures/water_normal.jpg')
  const tex = loader.load(
    waterUrl,
    (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(1, 1)
      t.anisotropy = 8
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.generateMipmaps = true
      t.needsUpdate = true
      notifyTextureReady()
    },
    undefined,
    () => console.warn('[textures] failed to load', waterUrl)
  )
  // Placeholder wrap only — no needsUpdate until the image lands.
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  cache[key] = tex
  return tex
}

/**
 * Seamless organic algae / phytoplankton film for ocean surface slicks.
 *
 * Procedural (no extra asset): green-brown mottling, soft filaments, and
 * density holes so blooms read as living scum rather than a flat tint.
 * G.channel ≈ density (shader uses it as a mask); R/B carry olive–rust variety.
 */
export function getAlgaeAlbedoMap() {
  const key = 'algae|albedo|v1'
  if (cache[key]) return cache[key]
  if (typeof document === 'undefined') return undefined

  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(size, size)
  const d = img.data

  // Seamless value noise via torus wrap.
  const hash = (x, y) => {
    const ix = ((x % size) + size) % size
    const iy = ((y % size) + size) % size
    const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453
    return n - Math.floor(n)
  }
  const smoothNoise = (x, y) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const u = fx * fx * (3 - 2 * fx)
    const v = fy * fy * (3 - 2 * fy)
    const a = hash(x0, y0)
    const b = hash(x0 + 1, y0)
    const c = hash(x0, y0 + 1)
    const d0 = hash(x0 + 1, y0 + 1)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d0) * u * v
  }
  const fbm = (x, y, octaves = 5) => {
    let amp = 0.5
    let freq = 1
    let sum = 0
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += smoothNoise(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2.03
    }
    return sum / norm
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // World-space-ish UVs in [0, size) — wrap seamlessly via hash.
      const nx = x * 0.035
      const ny = y * 0.035
      // Broad density clumps (slick thickness).
      let dens = fbm(nx * 0.55, ny * 0.55, 4)
      // Filament streaks — elongated along one axis then another.
      const filA = fbm(nx * 2.4 + ny * 0.35, ny * 0.9, 3)
      const filB = fbm(nx * 0.8, ny * 2.6 - nx * 0.4, 3)
      dens = dens * 0.55 + filA * 0.28 + filB * 0.17
      // Speckle / holes so it isn't a solid paint slab.
      const holes = fbm(nx * 6.5, ny * 6.2, 2)
      dens *= 0.55 + holes * 0.55
      dens = Math.max(0, Math.min(1, (dens - 0.22) / 0.62))

      // Colour: olive–emerald live film → yellow-brown dying scum in thin areas.
      const live = dens
      const r = Math.floor(28 + live * 55 + (1 - live) * 70)
      const g = Math.floor(48 + live * 110 + (1 - live) * 40)
      const b = Math.floor(22 + live * 35)
      const i = (y * size + x) * 4
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      // Alpha unused by sampler as albedo — still pack density for debugging.
      d[i + 3] = Math.floor(dens * 255)
    }
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1, 1)
  tex.anisotropy = 8
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  cache[key] = tex
  return tex
}

// Station / settlement / bay-interior surface roles — ambientCG CC0 plus the
// generated harbourwood set, tiled on Three.js primitives. Shared across every
// archetype; per-body color still comes from hullMaterials. High tile density
// keeps large station surfaces from stretching one plate across a whole wall.
//
//   hull        → armor (busy rivets/plates)
//   panel/wall  → plates
//   floor/beam  → darkmetal
//   radiator    → darkmetal
const STATION_ROLE = {
  // Dense plating — stations are huge in world space after scale-up.
  hull: { prefix: 'armor', repeatU: 14, repeatV: 12 },
  accent: { prefix: 'trim', repeatU: 11, repeatV: 10 },
  panel: { prefix: 'plates', repeatU: 16, repeatV: 14 },
  wall: { prefix: 'plates', repeatU: 15, repeatV: 12 },
  floor: { prefix: 'darkmetal', repeatU: 12, repeatV: 12 },
  beam: { prefix: 'darkmetal', repeatU: 10, repeatV: 8 },
  // Broad salt-weathered boards for the small waterfront warehouses. Kept at
  // one source tile per UV tile; harbourMesh owns the real-world board scale.
  harbourWood: { prefix: 'harbourwood', repeatU: 1, repeatV: 1 },
  // Heavy top-down quay boards; harbourMesh applies real-world plank scale.
  harbourDeck: { prefix: 'harbourdeck', repeatU: 1, repeatV: 1 },
  radiator: { prefix: 'darkmetal', repeatU: 12, repeatV: 10 },
  settlementHull: { prefix: 'armor', repeatU: 12, repeatV: 10 },
  // Tipped rock: breakwaters and shoals. Coarse repeat — these are boulders,
  // not gravel, and a tight tile makes them read as sandpaper.
  rubble: { prefix: 'rock', repeatU: 2.2, repeatV: 2.2 },
  settlementPanel: { prefix: 'plates', repeatU: 14, repeatV: 12 },
  // Ship hulls — neutral/grey photo metals that tint cleanly with class color.
  // `painted` is baked bright orange and muddies every tint; rust-streaked
  // armor / freckled shipmetal / mottled darkmetal read as worn plate instead.
  // Slightly denser repeats so panel seams / plate freckles read from chase-cam
  // range without turning into a fine noise field.
  shipHull: { prefix: 'armor', repeatU: 3.6, repeatV: 2.6 },
  shipStructure: { prefix: 'shipmetal', repeatU: 3.2, repeatV: 2.3 },
  shipArmor: { prefix: 'darkmetal', repeatU: 2.9, repeatV: 2.15 },
  shipTrim: { prefix: 'trim', repeatU: 3.2, repeatV: 2.3 },
  // Cleaner plate for police / fresher paint jobs.
  shipPaint: { prefix: 'plates', repeatU: 3.3, repeatV: 2.4 },
  // Alien hulls — ambientCG Rock035 (organic) + MetalPlates006 (chitin plates), CC0.
  alienHull: { prefix: 'alienbio', repeatU: 1.8, repeatV: 1.4 },
  alienPlate: { prefix: 'alienplate', repeatU: 2.2, repeatV: 1.6 }
}

/** Default normal intensity for exterior station / settlement materials. */
export const STATION_NORMAL_STRENGTH = 1.85

/**
 * High-contrast worn hull albedo: dense panel grid + rivets + soot streaks.
 * Primary exterior map so stations never read as solid plastic.
 */
function makeStationWornAlbedo() {
  const key = 'stationWornAlbedo|proc|v4'
  if (cache[key]) return cache[key]
  const hasDom = typeof document !== 'undefined' && typeof document.createElement === 'function'
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined'
  if (!hasDom && !hasOffscreen) return undefined

  const W = 1024
  const H = 1024
  const canvas =
    hasDom ? document.createElement('canvas') : new OffscreenCanvas(W, H)
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined

  const n2 = (x, y, s = 1) => {
    const v =
      Math.sin(x * 1.9 * s + y * 2.4 * s) * 0.4 +
      Math.sin(x * 4.7 * s - y * 3.1 * s + 1.3) * 0.28 +
      Math.sin(x * 11 * s + y * 8.5 * s + 0.9) * 0.18 +
      Math.sin(x * 29 * s - y * 23 * s + 2.1) * 0.14
    return v * 0.5 + 0.5
  }

  const img = ctx.createImageData(W, H)
  const d = img.data
  const panelPx = 80 // plate size readable at station flyby range
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W
      const v = y / H
      const broad = n2(u * 5, v * 5)
      const mid = n2(u * 14 + 2, v * 11)
      const fine = n2(u * 40, v * 38)
      const streak = Math.pow(Math.abs(Math.sin(u * 18 + v * 2.5 + mid * 3)), 2.2)
      // Secondary hatch seams (half-cell offset) for extra breakup
      const hatch = Math.pow(Math.abs(Math.sin(u * 52 + mid) * Math.sin(v * 48)), 4)

      const gx = x % panelPx
      const gy = y % panelPx
      // Panel seams (less crushing than v3 so overall albedo stays readable)
      const seam =
        gx < 3 || gy < 3 || gx > panelPx - 4 || gy > panelPx - 4 ? 0.55 : 1
      const lip =
        (gx === 5 || gy === 5 || gx === panelPx - 6 || gy === panelPx - 6) ? 0.88 : 1
      const rx = Math.min(gx, panelPx - 1 - gx)
      const ry = Math.min(gy, panelPx - 1 - gy)
      const rivet = rx < 5 && ry < 5 && (rx + ry) > 2 && (rx + ry) < 8 ? 0.72 : 1
      const bolt =
        ((gx > 16 && gx < 22 && (gy < 4 || gy > panelPx - 5)) ||
          (gy > 16 && gy < 22 && (gx < 4 || gx > panelPx - 5)))
          ? 0.78
          : 1

      // Brighter dirty metal so map×color doesn't go pure black under fill light
      let lum = 0.52 + broad * 0.28 + mid * 0.12 - streak * 0.22 - fine * 0.08 - hatch * 0.08
      lum *= seam * lip * rivet * bolt
      lum = Math.max(0.22, Math.min(0.92, lum))

      const warm = 1.1 + mid * 0.1
      const cool = 0.88 - streak * 0.12
      const r = Math.floor(lum * 255 * warm)
      const g = Math.floor(lum * 255 * (0.94 + fine * 0.05))
      const b = Math.floor(lum * 255 * cool)
      const i = (y * W + x) * 4
      d[i] = Math.min(255, r)
      d[i + 1] = Math.min(255, g)
      d[i + 2] = Math.min(255, b)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // Roughness companion (seams / soot = rougher)
  const rCanvas =
    hasDom ? document.createElement('canvas') : new OffscreenCanvas(W, H)
  rCanvas.width = W
  rCanvas.height = H
  const rctx = rCanvas.getContext('2d', { willReadFrequently: true })
  const rimg = rctx.createImageData(W, H)
  const rd = rimg.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W
      const v = y / H
      const mid = n2(u * 14 + 2, v * 11)
      const fine = n2(u * 40, v * 38)
      const streak = Math.pow(Math.abs(Math.sin(u * 18 + v * 2.5 + mid * 3)), 2.2)
      const gx = x % panelPx
      const gy = y % panelPx
      const seam = gx < 3 || gy < 3 || gx > panelPx - 4 || gy > panelPx - 4 ? 0.92 : 0.48
      let rough = seam + streak * 0.3 + fine * 0.18
      rough = Math.max(0.35, Math.min(0.99, rough))
      const i = (y * W + x) * 4
      const g = Math.floor(rough * 255)
      rd[i] = g
      rd[i + 1] = g
      rd[i + 2] = g
      rd[i + 3] = 255
    }
  }
  rctx.putImageData(rimg, 0, 0)

  // Normal bump from albedo luminance (stronger slopes for distant read)
  const nCanvas =
    hasDom ? document.createElement('canvas') : new OffscreenCanvas(W, H)
  nCanvas.width = W
  nCanvas.height = H
  const nctx = nCanvas.getContext('2d', { willReadFrequently: true })
  const nimg = nctx.createImageData(W, H)
  const nd = nimg.data
  const sampleL = (x, y) => {
    const i = (((y + H) % H) * W + ((x + W) % W)) * 4
    return d[i] / 255
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = sampleL(x + 1, y) - sampleL(x - 1, y)
      const dy = sampleL(x, y + 1) - sampleL(x, y - 1)
      let nx = -dx * 7
      let ny = -dy * 7
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const i = (y * W + x) * 4
      nd[i] = Math.floor((nx * 0.5 + 0.5) * 255)
      nd[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255)
      nd[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255)
      nd[i + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)

  const wrap = (canvasEl, srgb = false) => {
    const tex = new THREE.CanvasTexture(canvasEl)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    // Dense tiling in local mesh units after triplanar re-UV
    tex.repeat.set(1, 1)
    tex.anisotropy = 16
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    return tex
  }

  const set = {
    map: wrap(canvas, true),
    roughnessMap: wrap(rCanvas),
    normalMap: wrap(nCanvas),
    aoMap: wrap(canvas) // luminance mottle doubles as AO
  }
  cache[key] = set
  return set
}

/**
 * Free procedural space-weathering maps (AO mottle + blotchy roughness).
 * Multiplies with plate albedos via aoMap; darkens grime, dulls specular patches.
 */
function makeStationWearTextures() {
  // Worn albedo set is the primary exterior look now.
  return makeStationWornAlbedo()
}

export function getStationWearTextures() {
  return makeStationWearTextures()
}

export function getStationTextures(role) {
  const cfg = STATION_ROLE[role]
  if (!cfg) return undefined
  return loadSet(cfg.prefix, {
    repeatU: cfg.repeatU,
    repeatV: cfg.repeatV,
    withMetalness: true
  })
}

/**
 * Kick every map set a session is likely to need so JPEG decode starts before
 * (or as) world/ship meshes are built. Safe to call on New Game and Continue.
 */
export function preloadCommonTextures() {
  if (typeof document === 'undefined') return
  for (const key of Object.keys(ARCHETYPE_PREFIX)) {
    try {
      getSurfaceTextures(key)
    } catch {
      /* */
    }
  }
  for (const role of Object.keys(STATION_ROLE)) {
    try {
      getStationTextures(role)
    } catch {
      /* */
    }
  }
  try {
    getPropTextures('bark')
    getPropTextures('boulder')
    getPropTextures('concrete')
    getPlantTextures('foliage')
    getWaterNormalMap()
    getAlgaeAlbedoMap()
    getTerrainLayerMaps()
  } catch {
    /* */
  }
}

/**
 * Force GPU re-upload of every cached map that already has image data.
 * Call after loading a save / building meshes so materials that bound maps
 * mid-flight still light up when the JPEGs finish, and so Continue reuses
 * title-screen textures cleanly.
 */
export function reuploadReadyTextures() {
  const touch = (tex) => {
    if (tex && textureHasImage(tex)) tex.needsUpdate = true
  }
  for (const entry of Object.values(cache)) {
    if (!entry) continue
    // Water normal is stored as a raw Texture; map sets are plain objects.
    if (entry.isTexture) {
      touch(entry)
      continue
    }
    touch(entry.map)
    touch(entry.normalMap)
    touch(entry.roughnessMap)
    touch(entry.metalnessMap)
    touch(entry.aoMap)
  }
}

// Note: do not clear the global texture cache on session start.
// force-reloading every JPEG + regenerating procedural maps (algae, wear)
// on the main thread froze Continue for seconds and left a black frame.
// reuploadReadyTextures() is enough to push already-decoded maps to the GPU.

/**
 * Clone station maps so each mesh can have its own offset/rotation without
 * fighting the shared GPU image. Image data stays shared.
 */
export function cloneStationMaps(maps, { offsetU = 0, offsetV = 0, rot = 0 } = {}) {
  if (!maps?.map && !maps?.aoMap) return maps ?? {}
  const cloneOne = (tex) => {
    if (!tex) return null
    const c = tex.clone()
    c.wrapS = tex.wrapS
    c.wrapT = tex.wrapT
    if (tex.repeat) c.repeat.copy(tex.repeat)
    c.offset.set(offsetU, offsetV)
    if (rot) c.rotation = rot
    c.center.set(0.5, 0.5)
    c.anisotropy = Math.max(tex.anisotropy || 1, 16)
    if (textureHasImage(tex)) {
      c.needsUpdate = true
    } else {
      // Load still in flight — queue for the original's onLoad to configure us.
      // version=0: WebGPU must not try to upload DEFAULT_IMAGE (null).
      c.version = 0
      tex.userData = tex.userData ?? {}
      tex.userData._mapClones = tex.userData._mapClones ?? []
      tex.userData._mapClones.push(c)
    }
    return c
  }
  // Only include defined maps — spreading undefined keys into Material warns.
  const out = {}
  const map = cloneOne(maps.map)
  const normalMap = cloneOne(maps.normalMap)
  const roughnessMap = cloneOne(maps.roughnessMap)
  const metalnessMap = cloneOne(maps.metalnessMap)
  const aoMap = cloneOne(maps.aoMap)
  if (map) out.map = map
  if (normalMap) out.normalMap = normalMap
  if (roughnessMap) out.roughnessMap = roughnessMap
  if (metalnessMap) out.metalnessMap = metalnessMap
  if (aoMap) {
    out.aoMap = aoMap
    if (maps.aoMapIntensity != null) out.aoMapIntensity = maps.aoMapIntensity
  }
  out.normalScale = maps.normalScale
    ? maps.normalScale.clone()
    : new THREE.Vector2(STATION_NORMAL_STRENGTH, STATION_NORMAL_STRENGTH)
  return out
}

/**
 * Exterior station maps: high-contrast worn panel albedo (primary) so surfaces
 * never read as featureless solid color even with poor source UVs.
 * Plate/armor photos still feed metalness when available.
 */
export function stationMaterialMaps(role, normalStrength = STATION_NORMAL_STRENGTH) {
  const t = getStationTextures(role)
  const wear = getStationWearTextures()
  if (!wear?.map && !t) return {}
  return {
    map: wear?.map ?? t?.map,
    normalMap: wear?.normalMap ?? t?.normalMap,
    roughnessMap: wear?.roughnessMap ?? t?.roughnessMap,
    metalnessMap: t?.metalnessMap,
    aoMap: wear?.aoMap,
    aoMapIntensity: wear?.aoMap ? 0.9 : undefined,
    normalScale: new THREE.Vector2(normalStrength * 0.85, normalStrength * 0.85)
  }
}

/**
 * Ship PBR maps: use the ambientCG photo sets as the albedo.
 *
 * `stationMaterialMaps` swaps in a procedural panel grid so huge station walls
 * never read as plastic. On a 20 m boat that grid is the whole silhouette and
 * kills the worn-metal look. Ships keep the photo color / normal / roughness /
 * metalness and only borrow the wear set as soft AO grime.
 */
export function shipMaterialMaps(role, normalStrength = 1.15) {
  const t = getStationTextures(role)
  if (!t?.map && !t?.normalMap) return {}
  const wear = getStationWearTextures()
  // Stronger AO grime in panel recesses + punchier normals so edge wear and
  // rivet rows read through class colour tint and wet clearcoat.
  return {
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    metalnessMap: t.metalnessMap,
    aoMap: wear?.aoMap ?? wear?.map,
    aoMapIntensity: wear?.aoMap || wear?.map ? 0.62 : undefined,
    normalScale: new THREE.Vector2(normalStrength, normalStrength)
  }
}

/**
 * Soft-blended world/local triplanar sampling for MeshStandardMaterial.
 *
 * Hard per-face UV projection leaves visible seams at box edges (the “janky
 * plating” look). Sampling the albedo/roughness/metalness three ways and
 * blending by |normal|^sharpness hides those edges while keeping mipmaps and
 * three’s lighting stack.
 *
 * @param {THREE.MeshStandardMaterial} material
 * @param {{ scale?: number, sharpness?: number, key?: string }} [opts]
 *   scale — world units of texture repeat (smaller = denser)
 *   sharpness — blend power; 1 = soft, 8 = almost hard-axis
 */
export function applySoftTriplanar(material, opts = {}) {
  if (!material) return material
  const scale = opts.scale ?? 0.22
  const sharpness = opts.sharpness ?? 4.5
  const key = opts.key ?? `softTri|${scale}|${sharpness}`
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTriScale = { value: scale }
    shader.uniforms.uTriSharp = { value: sharpness }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTriPos;
varying vec3 vTriN;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTriPos = position;
vTriN = normal;`
      )
    // Soft weights + three planar samples. Used for colour / roughness / metal.
    const triHelper = `
uniform float uTriScale;
uniform float uTriSharp;
varying vec3 vTriPos;
varying vec3 vTriN;
vec3 triWeights(vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(uTriSharp));
  return w / (w.x + w.y + w.z + 1e-5);
}
vec4 triSample(sampler2D tex, vec3 p, vec3 n) {
  vec3 w = triWeights(n);
  vec3 tp = p * uTriScale;
  return texture2D(tex, tp.zy) * w.x
       + texture2D(tex, tp.xz) * w.y
       + texture2D(tex, tp.xy) * w.z;
}
`
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${triHelper}`)
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
	vec4 sampledDiffuseColor = triSample(map, vTriPos, vTriN);
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = triSample(roughnessMap, vTriPos, vTriN);
	// Channel G — ORM-compatible
	roughnessFactor *= texelRoughness.g;
#endif`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = triSample(metalnessMap, vTriPos, vTriN);
	// Channel B — ORM-compatible
	metalnessFactor *= texelMetalness.b;
#endif`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_OBJECTSPACE
	// View-space object normals are not available here the same way as in
	// three's stock path — fall back to blended tangent samples.
	{
		vec3 w = triWeights(vTriN);
		vec3 tp = vTriPos * uTriScale;
		vec3 mapN = normalize(
			(texture2D(normalMap, tp.zy).xyz * 2.0 - 1.0) * w.x +
			(texture2D(normalMap, tp.xz).xyz * 2.0 - 1.0) * w.y +
			(texture2D(normalMap, tp.xy).xyz * 2.0 - 1.0) * w.z
		);
		mapN.xy *= normalScale;
		normal = normalize( tbn * mapN );
	}
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	// Soft-blend planar normal samples so hard UV seams do not show as ridges.
	// Stay in tangent space then apply tbn (normalMatrix is vertex-only).
	{
		vec3 w = triWeights(vTriN);
		vec3 tp = vTriPos * uTriScale;
		vec3 mapN = normalize(
			(texture2D(normalMap, tp.zy).xyz * 2.0 - 1.0) * w.x +
			(texture2D(normalMap, tp.xz).xyz * 2.0 - 1.0) * w.y +
			(texture2D(normalMap, tp.xy).xyz * 2.0 - 1.0) * w.z
		);
		mapN.xy *= normalScale;
		normal = normalize( tbn * mapN );
	}
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`
      )
  }
  material.customProgramCacheKey = () => key
  // Ensure standard map flags stay on even if UVs are junk — we ignore vMapUv.
  material.needsUpdate = true
  return material
}

/**
 * Rewrite mesh UVs with triplanar projection in local space so tiled station
 * maps always cover surfaces densely (Kenney atlas UVs do not tile).
 *
 * Projection axis is chosen PER FACE, not per vertex. Choosing it per vertex
 * meant any triangle straddling an axis boundary got its three corners from
 * three different projections, and the texture was stretched across the gap
 * between them — measured at ~15% of all triangles on a station, which is what
 * read as smeared / misaligned plating. Indexed geometry is split first so
 * every triangle owns its corners and can carry one consistent projection.
 *
 * Returns the geometry to use: splitting produces a NEW BufferGeometry, so
 * callers must assign the result rather than relying on in-place mutation.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {number} tilesPerUnit denser = more panels per metre of mesh
 * @returns {THREE.BufferGeometry}
 */
export function retileUVsTriplanar(geometry, tilesPerUnit = 1.25) {
  if (!geometry?.attributes?.position) return geometry
  // One triangle per 3 vertices, so a whole face can share a projection.
  const geo = geometry.index ? geometry.toNonIndexed() : geometry
  if (!geo.attributes.normal) geo.computeVertexNormals()
  const pos = geo.attributes.position
  const n = pos.count
  const uvs = new Float32Array(n * 2)
  const dens = Math.max(0.05, tilesPerUnit)

  for (let t = 0; t + 2 < n; t += 3) {
    // Geometric face normal from the triangle itself — independent of any
    // smoothed vertex normals, which are what disagreed in the first place.
    const ax0 = pos.getX(t)
    const ay0 = pos.getY(t)
    const az0 = pos.getZ(t)
    const ex1 = pos.getX(t + 1) - ax0
    const ey1 = pos.getY(t + 1) - ay0
    const ez1 = pos.getZ(t + 1) - az0
    const ex2 = pos.getX(t + 2) - ax0
    const ey2 = pos.getY(t + 2) - ay0
    const ez2 = pos.getZ(t + 2) - az0
    const nx = Math.abs(ey1 * ez2 - ez1 * ey2)
    const ny = Math.abs(ez1 * ex2 - ex1 * ez2)
    const nz = Math.abs(ex1 * ey2 - ey1 * ex2)
    // 0 = project along X, 1 = along Y, 2 = along Z.
    const axis = nx >= ny && nx >= nz ? 0 : ny >= nx && ny >= nz ? 1 : 2

    for (let k = 0; k < 3; k++) {
      const i = t + k
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      let u
      let v
      if (axis === 0) {
        u = z * dens
        v = y * dens
      } else if (axis === 1) {
        u = x * dens
        v = z * dens
      } else {
        u = x * dens
        v = y * dens
      }
      uvs[i * 2] = u
      uvs[i * 2 + 1] = v
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setAttribute('uv2', geo.attributes.uv)
  return geo
}
