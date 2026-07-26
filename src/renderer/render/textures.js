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
// ambientCG (ambientcg.com) — tiled across each body's low-poly sphere via
// RepeatWrapping rather than a single fixed equirectangular image, so four
// source textures can cover every rocky/ice/lush/volcanic planet, every
// moon and asteroid (all reuse `rocky`), and every star's surface (reuses
// `volcanic`) in the galaxy. Gas giants use free procedural cloud-band
// maps (no third-party license) that tile the same way.
// Returns undefined only when an archetype has no maps and we are in a
// headless context that cannot build canvas textures.
const ARCHETYPE_PREFIX = {
  rocky: 'rock',
  ice: 'ice',
  lush: 'lush',
  volcanic: 'lava'
  // gasGiant → makeGasGiantTextureSet() (procedural)
}

/**
 * Free procedural gas-giant cloud belts (albedo + normal + roughness).
 * Horizontal banding + soft storms; tiles with RepeatWrapping like ambientCG sets.
 * Built once via OffscreenCanvas / canvas when a DOM is available.
 */
function makeGasGiantTextureSet() {
  const key = 'gasGiant|proc|v1'
  if (cache[key]) return cache[key]
  // Headless tests: no canvas — skip maps (vertex color alone).
  const hasDom = typeof document !== 'undefined' && typeof document.createElement === 'function'
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined'
  if (!hasDom && !hasOffscreen) return undefined

  const W = 1024
  const H = 512
  const canvas =
    hasDom
      ? document.createElement('canvas')
      : new OffscreenCanvas(W, H)
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined

  // Soft noise helper (value noise via layered sin — free, deterministic).
  const n2 = (x, y) => {
    const s =
      Math.sin(x * 1.7 + y * 2.3) * 0.5 +
      Math.sin(x * 3.1 - y * 1.9 + 1.4) * 0.3 +
      Math.sin(x * 6.4 + y * 5.2 + 2.7) * 0.2
    return s * 0.5 + 0.5
  }

  const img = ctx.createImageData(W, H)
  const d = img.data
  // Warm amber / ochre cloud palette (Jupiter-like, free / original).
  const deep = [92, 48, 28]
  const mid = [168, 112, 62]
  const bright = [228, 196, 150]
  const storm = [48, 32, 36]

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1) // 0..1 latitude-ish for equirect tile
    const lat = (v - 0.5) * 2 // -1..1
    for (let x = 0; x < W; x++) {
      const u = x / W
      // Cloud belts: many horizontal bands + longitudinal streaks.
      const bands =
        Math.sin(lat * Math.PI * 7.5) * 0.45 +
        Math.sin(lat * Math.PI * 15.2 + 0.7) * 0.25 +
        Math.sin(lat * Math.PI * 3.1 + u * Math.PI * 2) * 0.12
      const swirl =
        n2(u * 8 + lat * 2, lat * 10) * 0.55 +
        n2(u * 18 - lat * 3, lat * 22) * 0.35 +
        n2(u * 40, lat * 40) * 0.15
      // Great-spot style ovals (a few soft dark storms).
      const sx = ((u + 0.18) % 1) - 0.5
      const sy = lat - 0.22
      const oval1 = Math.exp(-(sx * sx * 28 + sy * sy * 55)) * 0.85
      const sx2 = ((u + 0.62) % 1) - 0.5
      const sy2 = lat + 0.35
      const oval2 = Math.exp(-(sx2 * sx2 * 40 + sy2 * sy2 * 70)) * 0.55
      let t = bands * 0.5 + 0.5
      t = t * 0.65 + swirl * 0.35
      t = Math.max(0, Math.min(1, t - oval1 * 0.45 - oval2 * 0.3))
      // Pole darkening
      const pole = Math.pow(Math.abs(lat), 2.2)
      t *= 1 - pole * 0.25

      let r, g, b
      if (oval1 > 0.35 || oval2 > 0.4) {
        const o = Math.max(oval1, oval2)
        const tr = Math.min(1, o)
        r = mid[0] * (1 - tr) + storm[0] * tr
        g = mid[1] * (1 - tr) + storm[1] * tr
        b = mid[2] * (1 - tr) + storm[2] * tr
      } else if (t < 0.45) {
        const k = t / 0.45
        r = deep[0] + (mid[0] - deep[0]) * k
        g = deep[1] + (mid[1] - deep[1]) * k
        b = deep[2] + (mid[2] - deep[2]) * k
      } else {
        const k = (t - 0.45) / 0.55
        r = mid[0] + (bright[0] - mid[0]) * k
        g = mid[1] + (bright[1] - mid[1]) * k
        b = mid[2] + (bright[2] - mid[2]) * k
      }
      const i = (y * W + x) * 4
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  // Roughness from luminance (bright tops smoother).
  const roughCanvas =
    hasDom ? document.createElement('canvas') : new OffscreenCanvas(W, H)
  roughCanvas.width = W
  roughCanvas.height = H
  const rctx = roughCanvas.getContext('2d', { willReadFrequently: true })
  const rimg = rctx.createImageData(W, H)
  const rd = rimg.data
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255
    const rv = Math.floor((0.35 + (1 - lum) * 0.5) * 255)
    rd[i] = rd[i + 1] = rd[i + 2] = rv
    rd[i + 3] = 255
  }
  rctx.putImageData(rimg, 0, 0)

  // Fake normal from height (band derivative) — subtle relief on belt edges.
  const nCanvas =
    hasDom ? document.createElement('canvas') : new OffscreenCanvas(W, H)
  nCanvas.width = W
  nCanvas.height = H
  const nctx = nCanvas.getContext('2d', { willReadFrequently: true })
  const nimg = nctx.createImageData(W, H)
  const nd = nimg.data
  const heightAt = (x, y) => {
    const xx = ((x % W) + W) % W
    const yy = Math.max(0, Math.min(H - 1, y))
    const i = (yy * W + xx) * 4
    return (d[i] + d[i + 1] + d[i + 2]) / (3 * 255)
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = heightAt(x + 1, y) - heightAt(x - 1, y)
      const dy = heightAt(x, y + 1) - heightAt(x, y - 1)
      const nx = Math.max(0, Math.min(255, Math.floor((-dx * 4.5 + 0.5) * 255)))
      const ny = Math.max(0, Math.min(255, Math.floor((-dy * 4.5 + 0.5) * 255)))
      const i = (y * W + x) * 4
      nd[i] = nx
      nd[i + 1] = ny
      nd[i + 2] = 255
      nd[i + 3] = 255
    }
  }
  nctx.putImageData(nimg, 0, 0)

  const wrapTex = (src, srgb = false) => {
    const tex = new THREE.CanvasTexture(src)
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    // Few horizontal repeats so belts stay wide on the sphere (not micro-stripes).
    tex.repeat.set(2, 1)
    tex.anisotropy = 8
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    tex.needsUpdate = true
    return tex
  }

  const set = {
    map: wrapTex(canvas, true),
    normalMap: wrapTex(nCanvas, false),
    roughnessMap: wrapTex(roughCanvas, false)
  }
  cache[key] = set
  return set
}

export function getSurfaceTextures(archetype) {
  if (archetype === 'gasGiant') return makeGasGiantTextureSet()
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
//   solar / radiator as named
const STATION_ROLE = {
  // Dense plating — stations are huge in world space after scale-up.
  hull: { prefix: 'armor', repeatU: 14, repeatV: 12 },
  accent: { prefix: 'trim', repeatU: 11, repeatV: 10 },
  panel: { prefix: 'plates', repeatU: 16, repeatV: 14 },
  wall: { prefix: 'plates', repeatU: 15, repeatV: 12 },
  floor: { prefix: 'darkmetal', repeatU: 12, repeatV: 12 },
  beam: { prefix: 'darkmetal', repeatU: 10, repeatV: 8 },
  solar: { prefix: 'solar', repeatU: 8, repeatV: 5 },
  radiator: { prefix: 'darkmetal', repeatU: 12, repeatV: 10 },
  settlementHull: { prefix: 'armor', repeatU: 12, repeatV: 10 },
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
    if (!tex) return tex
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
  return {
    map: cloneOne(maps.map),
    normalMap: cloneOne(maps.normalMap),
    roughnessMap: cloneOne(maps.roughnessMap),
    metalnessMap: cloneOne(maps.metalnessMap),
    aoMap: cloneOne(maps.aoMap),
    aoMapIntensity: maps.aoMapIntensity,
    normalScale: maps.normalScale
      ? maps.normalScale.clone()
      : new THREE.Vector2(STATION_NORMAL_STRENGTH, STATION_NORMAL_STRENGTH)
  }
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
