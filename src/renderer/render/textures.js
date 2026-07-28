import * as THREE from 'three'

let loader = null
const cache = {}

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
// Configure wrap/colorSpace only in the load callback. Setting those on an
// empty Texture marks needsUpdate before image data exists, which spams
// "Texture marked for update but no image data found" every frame until load.
function configureMap(tex, { srgb = false, repeatU = 1, repeatV = 1 } = {}) {
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeatU, repeatV)
  // High anisotropy so dense plating / terrain stays sharp at glancing angles.
  tex.anisotropy = 16
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

function loadMap(url, opts = {}) {
  // Configure the placeholder immediately so wrap/colorSpace are right the
  // moment the image arrives (and so we never leave a 0-size default that
  // reads as a solid tint when multiplied by vertex colour).
  const tex = loader.load(
    url,
    (t) => configureMap(t, opts),
    undefined,
    () => console.warn('[textures] failed to load', url)
  )
  return configureMap(tex, opts)
}

function loadSet(prefix, { repeatU = 4, repeatV = 2, withMetalness = false } = {}) {
  const key = `${prefix}|${repeatU}x${repeatV}|m${withMetalness ? 1 : 0}`
  if (cache[key]) return cache[key]
  // Headless (node --test): there is no image pipeline to load into. Return no
  // maps rather than throwing, so mesh builders stay callable in tests.
  if (typeof document === 'undefined') return undefined
  loader ??= new THREE.TextureLoader()
  const opts = { repeatU, repeatV }
  const map = loadMap(`textures/${prefix}_color.jpg`, { ...opts, srgb: true })
  const normalMap = loadMap(`textures/${prefix}_normal.jpg`, opts)
  const roughnessMap = loadMap(`textures/${prefix}_roughness.jpg`, opts)
  const set = { map, normalMap, roughnessMap }
  if (withMetalness) {
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
  const tex = loader.load('textures/water_normal.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(1, 1)
    t.anisotropy = 8
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.generateMipmaps = true
    t.needsUpdate = true
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  cache[key] = tex
  return tex
}

// Station / settlement / bay-interior surface roles — ambientCG CC0, tiled
// on Three.js primitives. Shared across every archetype; per-body color still
// comes from hullMaterials. High tile density so STATION_SCALE (~190×) still
// reads as fine plating rather than one stretched plate per wall.
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
  radiator: { prefix: 'darkmetal', repeatU: 12, repeatV: 10 },
  settlementHull: { prefix: 'armor', repeatU: 12, repeatV: 10 },
  // Tipped rock: breakwaters and shoals. Coarse repeat — these are boulders,
  // not gravel, and a tight tile makes them read as sandpaper.
  rubble: { prefix: 'rock', repeatU: 2.2, repeatV: 2.2 },
  settlementPanel: { prefix: 'plates', repeatU: 14, repeatV: 12 },
  // Ship hulls — neutral/grey photo metals that tint cleanly with class color.
  // `painted` is baked bright orange and muddies every tint; rust-streaked
  // armor / freckled shipmetal / mottled darkmetal read as worn plate instead.
  shipHull: { prefix: 'armor', repeatU: 3.0, repeatV: 2.2 },
  shipStructure: { prefix: 'shipmetal', repeatU: 2.6, repeatV: 1.9 },
  shipArmor: { prefix: 'darkmetal', repeatU: 2.4, repeatV: 1.8 },
  shipTrim: { prefix: 'trim', repeatU: 2.8, repeatV: 2.0 },
  // Cleaner plate for police / fresher paint jobs.
  shipPaint: { prefix: 'plates', repeatU: 2.8, repeatV: 2.0 },
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
    c.needsUpdate = true
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
  return {
    map: t.map,
    normalMap: t.normalMap,
    roughnessMap: t.roughnessMap,
    metalnessMap: t.metalnessMap,
    aoMap: wear?.aoMap ?? wear?.map,
    aoMapIntensity: wear?.aoMap || wear?.map ? 0.45 : undefined,
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
