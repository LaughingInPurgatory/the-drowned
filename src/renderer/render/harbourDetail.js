/**
 * Procedural detail maps and shared props for harbours, outposts and wreck
 * fields.
 *
 * `render/textures.js` owns the photographic PBR sets. This file owns the
 * *specific* surfaces a working waterfront needs and no photo set provides:
 * corrugated cladding with sheet overlaps, a planked deck with grooves and
 * nail bleed, barnacle crust for the tide band, rust streaks that run down
 * from a fixing, and the cheap grounding tricks (blob shadows, light pools)
 * that stop everything looking pasted on top of the world.
 *
 * Everything is generated once into a module cache: a harbour is rebuilt every
 * time the streamer brings one back in range, so per-build canvas work would
 * be a stutter every few hundred metres of sailing.
 *
 * Nothing here knows about layout — see harbourMesh.js for that.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

const cache = {}
export const hasDom = () =>
  typeof document !== 'undefined' && typeof document.createElement === 'function'

export function canvas2d(size, height = size) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = height
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) }
}

export function finish(canvas, { srgb = false, repeat = 1, aniso = 16 } = {}) {
  const tex = new THREE.CanvasTexture(canvas)
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(repeat, repeat)
  tex.anisotropy = aniso
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

/**
 * Seamless value-noise FBM on a torus. `base` is lattice cells across the
 * whole tile, and every octave doubles it, so the result wraps exactly.
 */
export function seamlessFbm(seed) {
  const hash = (ix, iy, period) => {
    const x = ((ix % period) + period) % period
    const y = ((iy % period) + period) % period
    const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
    return n - Math.floor(n)
  }
  const value = (fx, fy, period) => {
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const u = tx * tx * (3 - 2 * tx)
    const v = ty * ty * (3 - 2 * ty)
    const a = hash(x0, y0, period)
    const b = hash(x0 + 1, y0, period)
    const c = hash(x0, y0 + 1, period)
    const d = hash(x0 + 1, y0 + 1, period)
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
  }
  return (u, v, base, octaves = 4) => {
    let amp = 0.5
    let sum = 0
    let norm = 0
    let p = base
    for (let i = 0; i < octaves; i++) {
      sum += value(u * p, v * p, p) * amp
      norm += amp
      amp *= 0.5
      p *= 2
    }
    return sum / norm
  }
}

/** Sobel a wrapped height field into a tangent-space normal canvas. */
export function normalFromHeight(height, size, strength) {
  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const d = img.data
  const at = (x, y) =>
    height[(((y % size) + size) % size) * size + (((x % size) + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * size + x) * 4
      d[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255)
      d[i + 1] = Math.round((dy * inv * 0.5 + 0.5) * 255)
      d[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function greyCanvas(size, sample) {
  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(255, Math.round(sample(x, y) * 255)))
      const i = (y * size + x) * 4
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// ——— Corrugated cladding ————————————————————————————————————————————
/**
 * Painted corrugated steel: vertical ribs, a horizontal sheet overlap every
 * half tile with its line of fixings, rust blooming out of the fixings and
 * bleeding down. The albedo stays high-key so `material.color` can carry the
 * per-building paint job.
 */
export function getCorrugatedMaps() {
  const key = 'harbour|corrugated|v2'
  if (cache[key]) return cache[key]
  if (!hasDom()) return {}
  const size = 512
  const fbm = seamlessFbm(3.1)
  const ribs = 11
  const height = new Float32Array(size * size)
  const rust = new Float32Array(size * size)
  const dent = new Float32Array(size * size)

  for (let y = 0; y < size; y++) {
    const v = y / size
    // Two sheet courses per tile; the overlap is a small step + shadow line.
    const courseV = (v * 2) % 1
    const overlap = courseV < 0.035 ? 1 - courseV / 0.035 : 0
    for (let x = 0; x < size; x++) {
      const u = x / size
      const i = y * size + x
      // Rib profile — trapezoidal rather than a pure sine so the crowns read
      // as flat metal catching the sun and the valleys hold shadow.
      const phase = (u * ribs) % 1
      const rib = Math.pow(Math.abs(Math.sin(phase * Math.PI)), 0.65)
      const d = (fbm(u, v, 6, 3) - 0.5) * 0.9 + (fbm(u, v, 22, 2) - 0.5) * 0.22
      dent[i] = d
      height[i] = rib * 1.0 + overlap * 0.55 + d * 0.35
      // Rust: patches biased to the overlap lines and the rib valleys, then
      // pulled downward so it streaks like water carrying oxide. Stronger and
      // more vertical so cladding reads weathered at boat distance.
      const bleed = fbm(u * 0.7, v * 0.35, 6, 4)
      let r = fbm(u * 1.0, v, 4, 4) * 0.55 + bleed * 0.45
      r += overlap * 0.28 + (1 - rib) * 0.14
      // Long vertical oxide runs from random start heights.
      const column = fbm(u * 8, 0.2, 10, 2)
      const run = clamp01((column - 0.48) * 2.8) * clamp01(1.1 - v * 0.95)
      r += run * 0.55
      rust[i] = clamp01((r - 0.42) * 3.6)
    }
  }

  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const px = img.data
  for (let y = 0; y < size; y++) {
    const v = y / size
    const courseV = (v * 2) % 1
    for (let x = 0; x < size; x++) {
      const u = x / size
      const i = y * size + x
      // Per-sheet paint variation so a wall is not one flat panel of colour.
      const sheet = Math.floor(u * 3.5) + Math.floor(v * 2) * 7
      const sheetTint = 0.86 + ((Math.sin(sheet * 12.9898) * 43758.5453) % 1) * 0.2
      let base = 214 * sheetTint * (0.9 + dent[i] * 0.18)
      // Fixing washers on the overlap line.
      const boltU = (u * ribs + 0.5) % 1
      const onBolt = courseV < 0.02 && boltU > 0.42 && boltU < 0.58
      if (onBolt) base *= 0.72
      let r = base
      let g = base * 0.985
      let b = base * 0.96
      const rz = rust[i]
      if (rz > 0) {
        r = r * (1 - rz) + (128 + dent[i] * 60) * rz
        g = g * (1 - rz) + (68 + dent[i] * 30) * rz
        b = b * (1 - rz) + (40 + dent[i] * 18) * rz
      }
      const j = i * 4
      px[j] = clamp01(r / 255) * 255
      px[j + 1] = clamp01(g / 255) * 255
      px[j + 2] = clamp01(b / 255) * 255
      px[j + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const maps = {
    map: finish(canvas, { srgb: true }),
    normalMap: finish(normalFromHeight(height, size, 2.6)),
    roughnessMap: finish(
      greyCanvas(size, (x, y) => {
        const i = y * size + x
        // Rust is matte; clean crowns catch more light (lower roughness).
        return 0.42 + rust[i] * 0.52 + (1 - height[i]) * 0.08 + dent[i] * 0.05
      })
    )
  }
  cache[key] = maps
  return maps
}

// ——— Planked deck ——————————————————————————————————————————————————
/**
 * Weathered deck planking: eight boards to the tile, grooves between them,
 * end joints, cupped surfaces, nails with rust bleed, and a bleached-to-warm
 * per-board tint spread. This is what stops the quay reading as one slab.
 */
export function getPlankMaps() {
  const key = 'harbour|planks|v3'
  if (cache[key]) return cache[key]
  if (!hasDom()) return {}
  const size = 512
  const fbm = seamlessFbm(8.7)
  const boards = 8
  const height = new Float32Array(size * size)
  const wear = new Float32Array(size * size)

  const boardRand = (n, salt) => {
    const s = Math.sin(n * 37.31 + salt * 91.7) * 43758.5453
    return s - Math.floor(s)
  }

  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const px = img.data
  for (let y = 0; y < size; y++) {
    const v = y / size
    for (let x = 0; x < size; x++) {
      const u = x / size
      const i = y * size + x
      const bi = Math.floor(u * boards)
      const bu = u * boards - bi
      // Groove between boards + a hint of cupping across each board.
      const edge = Math.min(bu, 1 - bu)
      const groove = edge < 0.045 ? 1 - edge / 0.045 : 0
      const cup = Math.cos((bu - 0.5) * Math.PI) * 0.12
      // End joints: each board is butt-jointed at its own offset.
      const jointV = (v * 2 + boardRand(bi, 3)) % 1
      const joint = jointV < 0.018 ? 1 - jointV / 0.018 : 0
      // Grain runs along the board (V), so noise is stretched hard in V.
      const grain = fbm(u * 3.0, v * 0.35, 16, 3)
      const rot = fbm(u, v, 3, 4)
      const h = cup + grain * 0.16 - groove * 1.0 - joint * 0.6 - rot * 0.1
      height[i] = h
      wear[i] = rot

      // Nails: two per board per joint course.
      const nailV = Math.abs(jointV - 0.05) < 0.012 || Math.abs(jointV - 0.95) < 0.012
      const nail = nailV && Math.abs(bu - 0.25) < 0.03
      const nail2 = nailV && Math.abs(bu - 0.75) < 0.03
      if (nail || nail2) height[i] -= 0.35

      // Colour: bleached silver-grey through to damp warm timber.
      const tint = boardRand(bi, 11)
      const warm = 0.35 + tint * 0.6 - rot * 0.25
      let r = 128 + warm * 58 + grain * 32
      let g = 114 + warm * 40 + grain * 28
      let b = 96 + warm * 22 + grain * 24
      // Grooves and joints are dark and damp.
      const dark = clamp01(groove * 0.9 + joint * 0.7)
      r *= 1 - dark * 0.68
      g *= 1 - dark * 0.68
      b *= 1 - dark * 0.6
      // Rust bleed around fixings.
      if (nail || nail2) {
        r = r * 0.5 + 96
        g = g * 0.5 + 46
        b = b * 0.5 + 28
      } else if (nailV && (Math.abs(bu - 0.25) < 0.1 || Math.abs(bu - 0.75) < 0.1)) {
        const t = 0.35
        r = r * (1 - t) + 112 * t
        g = g * (1 - t) + 62 * t
        b = b * (1 - t) + 38 * t
      }
      // Damp/algae patches — stronger and more frequent so deck near water
      // does not read as a dry timber slab. Two octaves: broad soak + flecks.
      const dampBroad = clamp01((fbm(u * 0.55, v * 0.55, 3, 3) - 0.48) * 3.4)
      const dampFleck = clamp01((fbm(u * 1.6, v * 1.4, 6, 2) - 0.58) * 4.5)
      const damp = clamp01(dampBroad * 0.75 + dampFleck * 0.55)
      r = r * (1 - damp * 0.62) + 36 * damp * 0.55
      g = g * (1 - damp * 0.58) + 52 * damp * 0.55
      b = b * (1 - damp * 0.55) + 42 * damp * 0.55
      // Wet planks also go a touch cooler/darker overall in low spots.
      if (h < -0.15) {
        const puddle = clamp01((-h - 0.15) * 2.2)
        r *= 1 - puddle * 0.22
        g *= 1 - puddle * 0.18
        b *= 1 - puddle * 0.1
      }

      const j = i * 4
      px[j] = clamp01(r / 255) * 255
      px[j + 1] = clamp01(g / 255) * 255
      px[j + 2] = clamp01(b / 255) * 255
      px[j + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const maps = {
    map: finish(canvas, { srgb: true }),
    normalMap: finish(normalFromHeight(height, size, 3.4)),
    // Grooves and damp patches stay rough; bleached crowns a touch smoother so
    // the deck is not one uniform plastic roughness. Wet spots drop roughness
    // slightly so sky env skates across soaked timber.
    roughnessMap: finish(
      greyCanvas(size, (x, y) => {
        const i = y * size + x
        const u = x / size
        const v = y / size
        const dampBroad = clamp01((seamlessFbm(8.7)(u * 0.55, v * 0.55, 3, 3) - 0.48) * 3.4)
        const dampFleck = clamp01((seamlessFbm(8.7)(u * 1.6, v * 1.4, 6, 2) - 0.58) * 4.5)
        const damp = clamp01(dampBroad * 0.75 + dampFleck * 0.55)
        // Base rough; wet patches a little glossier (lower grey = smoother).
        return 0.7 + wear[i] * 0.22 - damp * 0.28 - height[i] * 0.05
      })
    )
  }
  cache[key] = maps
  return maps
}

// ——— Marine growth ————————————————————————————————————————————————
/**
 * The barnacle-and-weed crust that forms on anything standing in the tide.
 * Used as its own band of geometry on piles, hulls and mole blocks.
 */
export function getGrowthMaps() {
  const key = 'harbour|growth|v2'
  if (cache[key]) return cache[key]
  if (!hasDom()) return {}
  const size = 256
  const fbm = seamlessFbm(19.4)
  const height = new Float32Array(size * size)
  const shell = new Float32Array(size * size)

  // Barnacle cones stamped on a wrapped lattice.
  const cones = []
  for (let i = 0; i < 240; i++) {
    const s = Math.sin(i * 12.9898) * 43758.5453
    const t = Math.sin(i * 78.233) * 43758.5453
    const r = Math.sin(i * 45.164) * 43758.5453
    cones.push([
      (s - Math.floor(s)) * size,
      (t - Math.floor(t)) * size,
      2.5 + (r - Math.floor(r)) * 5.5
    ])
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const u = x / size
      const v = y / size
      let h = fbm(u, v, 8, 4) * 0.45
      let sh = 0
      for (const [cx, cy, cr] of cones) {
        let dx = x - cx
        let dy = y - cy
        if (dx > size / 2) dx -= size
        if (dx < -size / 2) dx += size
        if (dy > size / 2) dy -= size
        if (dy < -size / 2) dy += size
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < cr) {
          const k = 1 - d / cr
          h += k * k * 0.9
          sh = Math.max(sh, k)
        }
      }
      height[i] = h
      shell[i] = sh
    }
  }

  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const px = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const u = x / size
      const v = y / size
      const weed = fbm(u * 1.4, v * 0.5, 5, 3)
      // Dark olive weed base, chalky barnacle caps punching through.
      let r = 34 + weed * 44
      let g = 46 + weed * 52
      let b = 30 + weed * 30
      const s = clamp01((shell[i] - 0.15) * 1.6)
      r = r * (1 - s) + 176 * s
      g = g * (1 - s) + 168 * s
      b = b * (1 - s) + 148 * s
      const j = i * 4
      px[j] = r
      px[j + 1] = g
      px[j + 2] = b
      px[j + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const maps = {
    map: finish(canvas, { srgb: true }),
    normalMap: finish(normalFromHeight(height, size, 3.0)),
    roughnessMap: finish(greyCanvas(size, (x, y) => 0.9 - shell[y * size + x] * 0.25))
  }
  cache[key] = maps
  return maps
}

// ——— Decals ————————————————————————————————————————————————————————
/** Vertical rust weep, transparent — a quad hung under any steel fixing. */
export function getRustStreakMap() {
  const key = 'harbour|ruststreak|v2'
  if (cache[key]) return cache[key]
  if (!hasDom()) return null
  const size = 256
  const fbm = seamlessFbm(41.2)
  const { canvas, ctx } = canvas2d(size)
  const img = ctx.createImageData(size, size)
  const px = img.data
  for (let y = 0; y < size; y++) {
    const v = y / size
    for (let x = 0; x < size; x++) {
      const u = x / size
      // Streaks are noise stretched hard in V, gated by a per-column mask so
      // the weep starts at a few points rather than the whole width.
      const columns = fbm(u * 5, 0.5, 14, 2)
      const run = fbm(u * 2.4, v * 0.18, 20, 3)
      let a = clamp01((columns - 0.38) * 3.5) * clamp01((run - 0.28) * 2.8)
      // Strong at the top, thinning downward; keep enough body mid-streak.
      a *= clamp01(1.35 - v * 1.15) * (0.55 + (1 - v) * 0.55)
      // Slight edge falloff so the quad does not read as a rectangle.
      const edge = clamp01(Math.min(u, 1 - u) * 6)
      a *= edge
      const shade = 0.55 + run * 0.75
      const j = (y * size + x) * 4
      px[j] = clamp01(0.5 * shade) * 255
      px[j + 1] = clamp01(0.24 * shade) * 255
      px[j + 2] = clamp01(0.1 * shade) * 255
      px[j + 3] = clamp01(a * 1.15) * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = finish(canvas, { srgb: true })
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  cache[key] = tex
  return tex
}

/**
 * Radial falloff used two ways: multiplied dark for a contact shadow, added
 * warm for the pool of light under a lamp. Both are the cheapest possible
 * version of the cue and both read correctly at this camera distance.
 */
export function getSoftDiscMap() {
  const key = 'harbour|softdisc|v2'
  if (cache[key]) return cache[key]
  if (!hasDom()) return null
  const size = 128
  const { canvas, ctx } = canvas2d(size)
  // Hotter core + slower falloff so contact blobs still read after mip filter
  // and at berth camera distance (v1 washed out to a faint grey smear).
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.92)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.82, 'rgba(255,255,255,0.14)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = finish(canvas, { srgb: true })
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  cache[key] = tex
  return tex
}

/** Diamond-mesh fishing net, alpha-cut. */
export function getNetMap() {
  const key = 'harbour|net|v1'
  if (cache[key]) return cache[key]
  if (!hasDom()) return null
  const size = 128
  const { canvas, ctx } = canvas2d(size)
  ctx.clearRect(0, 0, size, size)
  ctx.strokeStyle = '#6f6350'
  ctx.lineWidth = 2.4
  const cells = 8
  const step = size / cells
  ctx.beginPath()
  for (let i = -cells; i <= cells * 2; i++) {
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step + size, size)
    ctx.moveTo(i * step, 0)
    ctx.lineTo(i * step - size, size)
  }
  ctx.stroke()
  const tex = finish(canvas, { srgb: true })
  cache[key] = tex
  return tex
}

/** Tarpaulin weave — normal only; colour comes from the material. */
export function getTarpNormalMap() {
  const key = 'harbour|tarp|v1'
  if (cache[key]) return cache[key]
  if (!hasDom()) return null
  const size = 128
  const fbm = seamlessFbm(66.6)
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave =
        Math.sin((x / size) * Math.PI * 2 * 24) * 0.5 + Math.sin((y / size) * Math.PI * 2 * 24) * 0.5
      h[y * size + x] = weave * 0.18 + fbm(x / size, y / size, 5, 3) * 0.8
    }
  }
  const tex = finish(normalFromHeight(h, size, 1.6))
  cache[key] = tex
  return tex
}

// ——— Shared props ————————————————————————————————————————————————
/**
 * A rope or cable hanging between two points. Real mooring lines and power
 * drops sag; a straight cylinder between two posts is the single most
 * obvious "programmer art" tell on a waterfront.
 */
export function catenaryMesh(from, to, sag, radius, material, segments = 12) {
  const a = new THREE.Vector3().fromArray(from)
  const b = new THREE.Vector3().fromArray(to)
  const pts = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const p = a.clone().lerp(b, t)
    // Parabola is close enough to a catenary at these spans and much cheaper.
    p.y -= sag * 4 * t * (1 - t)
    pts.push(p)
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, radius, 5, false),
    material
  )
  mesh.castShadow = true
  return mesh
}

/** Coil of rope lying on the deck. */
export function ropeCoilMesh(radius, material, turns = 3) {
  const group = new THREE.Group()
  for (let i = 0; i < turns; i++) {
    const r = radius * (1 - i * 0.16)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, radius * 0.13, 5, 14), material)
    ring.rotation.x = Math.PI / 2
    ring.position.y = radius * 0.13 * (i * 1.7)
    ring.rotation.z = i * 0.6
    ring.castShadow = true
    group.add(ring)
  }
  return group
}

/** Length of stud-link chain, laid along +Z. */
export function chainMesh(length, linkR, material) {
  const group = new THREE.Group()
  const step = linkR * 1.35
  const proto = new THREE.TorusGeometry(linkR, linkR * 0.3, 4, 8)
  for (let i = 0; i * step < length; i++) {
    const link = new THREE.Mesh(proto, material)
    link.position.z = i * step - length / 2
    link.rotation.y = i % 2 ? Math.PI / 2 : 0
    link.rotation.x = Math.PI / 2
    group.add(link)
  }
  return group
}

/**
 * Contact shadow. A soft dark disc laid just above whatever the object is
 * standing on. Shadow maps at harbour scale miss the small stuff entirely,
 * and objects with no darkening where they meet the deck are the clearest
 * "pasted on" tell there is.
 */
export function contactShadow(material, size, x, y, z, rot = 0) {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  quad.rotation.x = -Math.PI / 2
  quad.rotation.z = rot
  quad.position.set(x, y, z)
  quad.renderOrder = 1
  return quad
}

/**
 * Collapse a static group into one mesh per material.
 *
 * A harbour with real construction detail is several hundred small meshes.
 * Merging drops it to a dozen or so draw calls, which is what makes the
 * density affordable with several harbours streamed in at once. Anything the
 * frame loop touches (beacons, flags, the lighthouse window) is skipped via
 * `keep`.
 *
 * The soft-triplanar materials sample *local* position, so merging actually
 * improves them: the projection becomes harbour-local and neighbouring parts
 * stop repeating the same patch of texture.
 */
export function mergeStatic(root, keep = () => false) {
  root.updateMatrixWorld(true)
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const buckets = new Map()
  const skip = new Set()

  root.traverse((obj) => {
    if (obj.userData?.noMerge) skip.add(obj)
    if (skip.has(obj.parent)) skip.add(obj)
    if (!obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh) return
    if (skip.has(obj) || keep(obj)) return
    if (Array.isArray(obj.material) || !obj.material || !obj.geometry?.attributes?.position) return
    const list = buckets.get(obj.material) ?? []
    list.push(obj)
    buckets.set(obj.material, list)
  })

  const matrix = new THREE.Matrix4()
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue
    const geos = []
    for (const mesh of meshes) {
      matrix.multiplyMatrices(rootInverse, mesh.matrixWorld)
      const src = mesh.geometry
      const g = src.index ? src.toNonIndexed() : src.clone()
      if (!g.attributes.normal) g.computeVertexNormals()
      if (!g.attributes.uv) {
        g.setAttribute(
          'uv',
          new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)
        )
      }
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
      }
      g.morphAttributes = {}
      g.clearGroups()
      g.applyMatrix4(matrix)
      geos.push(g)
    }
    let merged = null
    try {
      merged = mergeGeometries(geos, false)
    } catch {
      merged = null
    }
    for (const g of geos) g.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    const batch = new THREE.Mesh(merged, material)
    batch.castShadow = true
    batch.receiveShadow = true
    // Transparent decals must still draw after the surfaces they sit on.
    if (material.transparent) batch.renderOrder = 2
    for (const mesh of meshes) mesh.parent?.remove(mesh)
    root.add(batch)
  }
  return root
}
