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
function loadMap(url, { srgb = false, repeatU, repeatV } = {}) {
  return loader.load(url, (tex) => {
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeatU, repeatV)
    // High anisotropy so dense station plating stays sharp at glancing angles.
    tex.anisotropy = 16
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
  })
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
// sets cover every surface on the sea. `sand` is generated instead (see above).
// Returns undefined only in a headless context with no canvas.
//
// These are island *surfaces*, not island archetypes. An island mixes two of these (see
// render/islandMesh.js), so a rocky headland can have a sandy beach and a
// grassy top without needing a texture per combination.
const ARCHETYPE_PREFIX = {
  rocky: 'rock',
  barren: 'rock',
  grass: 'lush',
  scrub: 'lush',
  ruin: 'plates',
  drowned: 'plates',
  works: 'darkmetal',
  industrial: 'darkmetal',
  volcanic: 'lava',
  ash: 'lava'
}

/**
 * Sand. There is no CC0 sand set in the pack, and every shore wants one, so it
 * is generated: fine grain, a few shell flecks, and the ripple the tide leaves.
 * Cheap enough to bake once at boot and share across every beach on the sea.
 */
function makeSandTextureSet() {
  const key = 'sand|proc|v1'
  if (cache[key]) return cache[key]
  const hasDom = typeof document !== 'undefined' && typeof document.createElement === 'function'
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined'
  if (!hasDom && !hasOffscreen) return undefined

  const S = 512
  const make = () => {
    const c = hasDom ? document.createElement('canvas') : new OffscreenCanvas(S, S)
    c.width = S
    c.height = S
    return c
  }

  const albedo = make()
  const ac = albedo.getContext('2d', { willReadFrequently: true })
  if (!ac) return undefined
  const img = ac.createImageData(S, S)
  const d = img.data
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      // Fine grain, plus a long low ripple across the beach.
      const grain = (Math.random() - 0.5) * 26
      const ripple = Math.sin(x * 0.09 + Math.sin(y * 0.021) * 2.2) * 7
      const v = 196 + grain + ripple
      d[i] = Math.max(0, Math.min(255, v))
      d[i + 1] = Math.max(0, Math.min(255, v - 12))
      d[i + 2] = Math.max(0, Math.min(255, v - 42))
      d[i + 3] = 255
    }
  }
  ac.putImageData(img, 0, 0)
  // Shell and pebble flecks.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * S
    const y = Math.random() * S
    const r = 0.4 + Math.random() * 1.5
    ac.fillStyle = Math.random() < 0.6 ? 'rgba(238,232,214,0.7)' : 'rgba(120,104,84,0.55)'
    ac.beginPath()
    ac.arc(x, y, r, 0, Math.PI * 2)
    ac.fill()
  }

  // Normal map from the albedo's luminance — the grain is the relief.
  const normal = make()
  const nc = normal.getContext('2d', { willReadFrequently: true })
  const src = ac.getImageData(0, 0, S, S).data
  const nImg = nc.createImageData(S, S)
  const nd = nImg.data
  const lum = (x, y) => {
    const i = ((((y % S) + S) % S) * S + (((x % S) + S) % S)) * 4
    return src[i] / 255
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      const dx = lum(x + 1, y) - lum(x - 1, y)
      const dy = lum(x, y + 1) - lum(x, y - 1)
      nd[i] = Math.max(0, Math.min(255, 128 - dx * 300))
      nd[i + 1] = Math.max(0, Math.min(255, 128 - dy * 300))
      nd[i + 2] = 255
      nd[i + 3] = 255
    }
  }
  nc.putImageData(nImg, 0, 0)

  const wrap = (src, srgb = false) => {
    const tex = new THREE.CanvasTexture(src)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1, 1)
    tex.anisotropy = 8
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    return tex
  }

  const set = { map: wrap(albedo, true), normalMap: wrap(normal, false) }
  cache[key] = set
  return set
}

export function getSurfaceTextures(archetype) {
  if (archetype === 'sand') return makeSandTextureSet()
  const prefix = ARCHETYPE_PREFIX[archetype]
  return prefix ? loadSet(prefix) : undefined
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
  // Ship-specific CC0 maps (ambientCG PaintedMetal001 / Metal021 / MetalPlates013 / Metal009).
  // Tint with MeshStandardMaterial.color — painted hull takes class color best.
  shipHull: { prefix: 'painted', repeatU: 2.4, repeatV: 1.6 },
  shipStructure: { prefix: 'shipmetal', repeatU: 2.0, repeatV: 1.4 },
  shipArmor: { prefix: 'armor', repeatU: 1.8, repeatV: 1.3 },
  shipTrim: { prefix: 'trim', repeatU: 2.2, repeatV: 1.5 },
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
