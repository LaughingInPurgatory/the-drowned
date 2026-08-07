/**
 * Procedural PBR surfaces for vessels.
 *
 * `render/textures.js` owns the photographic ambientCG sets. Those are fine for
 * a station wall but wrong for a boat: a photo of plate has no idea where the
 * waterline is, which way is down, or where a fixing is that could weep rust.
 * Everything a hull needs is *positional*, so it is generated here instead.
 *
 * Two halves:
 *
 *  1. **Baked tiling maps** (`getPlateMaps`). Steel plating with real strake
 *     seams, weld beads, rivet rows, per-plate tone variation, dents, chipped
 *     paint over red-oxide primer, oil wash and rust blooms that *run downward*
 *     from their source. Generated once per kind into a module cache — a hull
 *     is re-meshed every time the streamer brings a contact into range, so
 *     per-build canvas work would be a stutter every few hundred metres.
 *
 *  2. **A TSL hull material** (`makeHullMaterial`). The maps carry everything
 *     that is the same everywhere on the plate; the node graph carries what
 *     depends on *where on the boat you are* — antifouling below the waterline,
 *     the boot-top band, the salt-and-scale bloom that blooms just above it, and
 *     the extra corrosion that collects along the sheer. `snapToSea` puts the
 *     hull origin exactly on the water surface, so hull-local y = 0 **is** the
 *     waterline and the whole band structure comes for free on any hull.
 *
 * WebGPU only: NodeMaterial + TSL. Custom GLSL does not compile on this stack.
 */
import * as THREE from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import {
  texture,
  uv,
  uniform,
  positionLocal,
  vec3,
  float,
  mix,
  smoothstep,
  Fn
} from 'three/tsl'
import {
  hasDom,
  canvas2d,
  finish,
  seamlessFbm,
  normalFromHeight,
  clamp01
} from './harbourDetail.js'

const cache = {}

/**
 * Linear 0–1 → sRGB byte.
 *
 * Albedo canvases are uploaded as `SRGBColorSpace`, so three decodes them on
 * sample. Writing the linear value straight into the byte therefore darkens
 * everything by roughly a stop and a half — a mid grey lands at 0.21 linear
 * instead of 0.5, which is exactly how a painted hull ends up reading as a
 * black cut-out under a high metalness.
 */
function enc(v) {
  const c = v < 0 ? 0 : v > 1 ? 1 : v
  return (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255
}

/** Deterministic 0–1 from two ints — plate tone, joint offsets, bloom seeds. */
function hash2(a, b, salt = 0) {
  const n = Math.sin(a * 127.1 + b * 311.7 + salt * 74.7) * 43758.5453
  return n - Math.floor(n)
}

/**
 * Smooth pulse of half-width `w` around 0 on a wrapped axis.
 * Used for seams and weld beads so they have a profile rather than a hard step.
 */
function ridge(t, w) {
  const d = Math.abs(t) / w
  if (d >= 1) return 0
  const k = 1 - d
  return k * k * (3 - 2 * k)
}

/**
 * Per-kind plating recipe.
 *
 * `strakes` / `butts` set the plate grid, and the plate grid is the single
 * thing that makes a metal surface read at its real size — a boat with 3 m
 * strakes and a deckhouse with 1 m panels cannot be the same texture.
 */
const KINDS = {
  // Shell plating: long welded strakes. Two to the tile at ~3.5 m of hull, so
  // a strake is about 1.7 m deep and a plate runs the best part of four metres
  // — which is what stops the topsides reading as brickwork.
  hull: { strakes: 2, butts: 1, rivets: 0.3, rust: 1, chip: 0.85, base: 0.68, oil: 0.5 },
  // Deckhouse / superstructure: smaller painted panels, cleaner, more bolts.
  super: { strakes: 3, butts: 2, rivets: 0.75, rust: 0.6, chip: 1, base: 0.76, oil: 0.35 },
  // Machinery, bollards, gun shields: dark, greasy, less paint to lose.
  trim: { strakes: 4, butts: 3, rivets: 0.6, rust: 0.85, chip: 0.4, base: 0.44, oil: 1 },
  // Deck: checker/tread plate, walked on, salt-bleached.
  deck: { strakes: 0, butts: 0, rivets: 0, rust: 0.7, chip: 0.5, base: 0.6, oil: 0.7, tread: true }
}

/**
 * Steel plating maps for one `kind`.
 *
 * @returns {{
 *   map: THREE.Texture, mapWorn: THREE.Texture, wearMap: THREE.Texture,
 *   normalMap: THREE.Texture, roughnessMap: THREE.Texture,
 *   metalnessMap: THREE.Texture, aoMap: THREE.Texture
 * }|{}} empty headless (node --test has no canvas).
 */
export function getPlateMaps(kind = 'hull') {
  const key = `ship|plate|${kind}|v7`
  if (cache[key]) return cache[key]
  if (!hasDom()) return {}
  const cfg = KINDS[kind] ?? KINDS.hull
  // 512 is ~4x the bake cost of 256 and ~1/4 of 1024. At the tile sizes below
  // that is 200+ texels per metre of hull — an order of magnitude more than the
  // screen ever asks for, and the bake happens on the frame a hull first meshes.
  const S = 512
  const fbm = seamlessFbm(kind.length * 7.3 + 2.1)
  const fbm2 = seamlessFbm(kind.length * 3.9 + 51.7)

  const height = new Float32Array(S * S)
  const rust = new Float32Array(S * S)
  const chip = new Float32Array(S * S)
  const oil = new Float32Array(S * S)
  const cavity = new Float32Array(S * S)
  const tone = new Float32Array(S * S)
  const bare = new Float32Array(S * S)

  // —— Pass 1: plate grid, welds, fixings, dents ————————————————————
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x

      // Dents and rolling waviness in the plate itself. Ships are not flat.
      const dent = (fbm(u, v, 5, 4) - 0.5) * 1.0 + (fbm2(u, v, 17, 3) - 0.5) * 0.35
      let h = dent * 0.22
      let cav = 0
      let riv = 0
      let plateTone = 0.5
      let weld = 0

      if (cfg.tread) {
        // Non-slip: raised lozenges in two alternating directions.
        const cu = u * 26
        const cv = v * 26
        const cellRow = Math.floor(cv)
        const dir = cellRow % 2 === 0 ? 1 : -1
        const su = (cu + dir * (cv - cellRow) * 0.65) % 1
        const sv = cv - cellRow
        const lozenge =
          Math.abs(su - 0.5) < 0.3 && sv > 0.18 && sv < 0.72
            ? 1 - Math.abs(su - 0.5) / 0.3
            : 0
        h += lozenge * 0.75
        cav = 1 - lozenge
        plateTone = 0.5 + hash2(Math.floor(u * 4), Math.floor(v * 4), 9) * 0.1
      } else {
        // Strakes run fore-and-aft (horizontal in the tile), butt joints
        // stagger by plate so the grid never lines up into a chequerboard.
        const rowF = v * cfg.strakes
        const row = Math.floor(rowF)
        const rowV = rowF - row
        // Seam at rowV = 0 — wrapped distance so the tile stays seamless.
        const dRow = Math.min(rowV, 1 - rowV)
        const seam = ridge(dRow, 0.05)
        // Weld bead: a proud, slightly wandering sausage on the seam.
        const wander = (fbm(u * 3, v, 30, 2) - 0.5) * 0.012
        weld = ridge(dRow + wander, 0.028)

        // Butt joints are vertical welds between plates in the same strake.
        // They are shorter and much less pronounced than the strake seam —
        // making them equal partners is what turns plating into brickwork.
        const colF = u * cfg.butts + hash2(row, 0, 3) * 1.7
        const col = Math.floor(colF)
        const colU = colF - col
        const dCol = Math.min(colU, 1 - colU)
        const buttSeam = ridge(dCol, 0.012)
        const buttWeld = ridge(dCol, 0.008)

        // Each plate came off a different part of the mill. This is doing more
        // work for the eye than the seams are.
        plateTone = 0.24 + hash2(row, col, 11) * 0.58
        cav = clamp01(seam * 0.7 + buttSeam * 0.4)
        h += weld * 0.45 + buttWeld * 0.3 - cav * 0.4
        // Slight per-plate proudness so light breaks along the seams.
        h += (hash2(row, col, 23) - 0.5) * 0.22

        // A single row of fixings along the strake seam. Only the seam — a
        // rivet grid on every edge reads as a dot screen at any distance.
        if (cfg.rivets > 0) {
          const pitch = cfg.tread ? 0 : 22
          const ru = (u * pitch) % 1
          const nearRow = Math.abs(dRow - 0.075) < 0.024
          const rvU = Math.abs(ru - 0.5)
          if (nearRow && rvU < 0.18) {
            riv = (1 - rvU / 0.18) * cfg.rivets
            h += riv * 0.5
          }
        }
      }

      height[i] = h
      cavity[i] = cav
      tone[i] = plateTone
      // Rivets and weld crowns are where paint goes first.
      bare[i] = clamp01(riv * 0.9 + weld * 0.5 + Math.max(0, h) * 0.35)
    }
  }

  // —— Pass 2: rust sources, then let them run downhill ————————————
  // A rust source is a fixing, a seam or a scupper. What sells it is that the
  // oxide is *carried* down the plate by rain, so this is a vertical scan
  // rather than another noise field. CanvasTexture flips Y, so image row 0 is
  // the top of the tile and increasing y is downhill.
  const source = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x
      // Where oxide has broken through: a few real blooms, plus a little at
      // fixings and seam crowns. Gated by a large-scale mask so most of the
      // plate is still paint — a uniformly rusty hull is just brown paint.
      const region = clamp01((fbm(u * 0.4, v * 0.4, 1, 3) - 0.36) * 3.0)
      const bloom = clamp01((fbm(u * 1.2, v * 1.2, 3, 4) - 0.52) * 3.2)
      const seeded =
        clamp01(bare[i] * 0.85 + cavity[i] * 0.25) *
        clamp01((fbm2(u * 4, v * 4, 9, 3) - 0.46) * 2.8)
      source[i] = clamp01((bloom * 0.95 + seeded * 0.7) * (0.14 + region * 1.5) * cfg.rust)
    }
  }
  // Two wrapped passes so the carry converges across the tile seam.
  const streak = new Float32Array(S * S)
  for (let pass = 0; pass < 2; pass++) {
    for (let x = 0; x < S; x++) {
      let carry = streak[x] // last pass' value at the top row
      for (let y = 0; y < S; y++) {
        const i = y * S + x
        // Sideways wander so runs are not perfectly plumb pinstripes.
        const drift = (fbm2(x / S, y / S, 12, 2) - 0.5) * 0.4
        const nx = (x + Math.round(drift * 3) + S) % S
        const neighbour = streak[y * S + nx]
        carry = Math.max(source[i], carry * 0.988, neighbour * 0.972)
        streak[i] = carry
      }
    }
  }
  for (let i = 0; i < S * S; i++) {
    const u = (i % S) / S
    const v = Math.floor(i / S) / S
    // Break the runs into ribbons — a wall of uniform rust is just brown paint.
    const ribbon = clamp01((fbm(u * 3.5, v * 0.35, 9, 3) - 0.3) * 2.6)
    rust[i] = clamp01(Math.max(source[i], streak[i] * ribbon * 0.95) * 1.05)
  }

  // —— Pass 3: paint chipped to primer, oil wash ————————————————————
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x
      // Chips cluster on proud geometry: weld crowns, rivets, plate edges.
      const flake = clamp01((fbm2(u * 6, v * 6, 14, 3) - 0.5) * 3.2)
      chip[i] = clamp01(bare[i] * flake * 1.8 * cfg.chip)
      // Oil / exhaust wash pools in the cavities and drags down.
      oil[i] = clamp01((fbm(u * 2.2, v * 0.7, 7, 4) - 0.5) * 2.2) * cfg.oil * (0.4 + cavity[i] * 0.9)
    }
  }

  // —— Bake ————————————————————————————————————————————————————————
  const { canvas: cClean, ctx: xClean } = canvas2d(S)
  const { canvas: cWorn, ctx: xWorn } = canvas2d(S)
  const { canvas: cWear, ctx: xWear } = canvas2d(S)
  const { canvas: cRough, ctx: xRough } = canvas2d(S)
  const { canvas: cMetal, ctx: xMetal } = canvas2d(S)
  const { canvas: cAo, ctx: xAo } = canvas2d(S)
  const iClean = xClean.createImageData(S, S)
  const iWorn = xWorn.createImageData(S, S)
  const iWear = xWear.createImageData(S, S)
  const iRough = xRough.createImageData(S, S)
  const iMetal = xMetal.createImageData(S, S)
  const iAo = xAo.createImageData(S, S)

  for (let i = 0; i < S * S; i++) {
    const j = i * 4
    const ao = clamp01(1 - cavity[i] * 0.62 - Math.max(0, -height[i]) * 0.3)
    // Clean paint layer — near-neutral so material.color carries the livery.
    const paint = cfg.base * (0.78 + tone[i] * 0.44) * (0.86 + Math.max(0, height[i]) * 0.2)
    const shaded = clamp01(paint * (0.34 + ao * 0.66))
    iClean.data[j] = enc(shaded)
    iClean.data[j + 1] = enc(shaded * 0.99)
    iClean.data[j + 2] = enc(shaded * 0.977)
    iClean.data[j + 3] = 255

    // Wear channels: R rust, G chip-to-primer, B oil/grime, A cavity AO.
    iWear.data[j] = rust[i] * 255
    iWear.data[j + 1] = chip[i] * 255
    iWear.data[j + 2] = oil[i] * 255
    iWear.data[j + 3] = ao * 255

    // Pre-composited worn albedo for the classic-material path (fittings).
    let r = shaded
    let g = shaded * 0.985
    let b = shaded * 0.965
    const c = chip[i]
    if (c > 0) {
      // Red-oxide primer under the topcoat.
      r = r * (1 - c) + 0.42 * c
      g = g * (1 - c) + 0.2 * c
      b = b * (1 - c) + 0.15 * c
    }
    const rz = rust[i]
    if (rz > 0) {
      const warm = 0.7 + tone[i] * 0.6
      r = r * (1 - rz) + 0.44 * warm * rz
      g = g * (1 - rz) + 0.21 * warm * rz
      b = b * (1 - rz) + 0.1 * warm * rz
    }
    const ol = oil[i]
    r *= 1 - ol * 0.45
    g *= 1 - ol * 0.44
    b *= 1 - ol * 0.4
    iWorn.data[j] = enc(r)
    iWorn.data[j + 1] = enc(g)
    iWorn.data[j + 2] = enc(b)
    iWorn.data[j + 3] = 255

    // Rust is matte, fresh paint is not, oil is slick, cavities hold dirt.
    const rough = clamp01(
      0.34 + rust[i] * 0.55 + cavity[i] * 0.2 + chip[i] * 0.22 - oil[i] * 0.16 + (tone[i] - 0.5) * 0.14
    )
    const gr = rough * 255
    iRough.data[j] = gr
    iRough.data[j + 1] = gr
    iRough.data[j + 2] = gr
    iRough.data[j + 3] = 255

    // Paint is a dielectric; bare metal and chips are not. Oxide is not either.
    const metal = clamp01(0.22 + bare[i] * 0.7 + chip[i] * 0.55 - rust[i] * 0.75)
    const gm = metal * 255
    iMetal.data[j] = gm
    iMetal.data[j + 1] = gm
    iMetal.data[j + 2] = gm
    iMetal.data[j + 3] = 255

    const ga = ao * 255
    iAo.data[j] = ga
    iAo.data[j + 1] = ga
    iAo.data[j + 2] = ga
    iAo.data[j + 3] = 255
  }
  xClean.putImageData(iClean, 0, 0)
  xWorn.putImageData(iWorn, 0, 0)
  xWear.putImageData(iWear, 0, 0)
  xRough.putImageData(iRough, 0, 0)
  xMetal.putImageData(iMetal, 0, 0)
  xAo.putImageData(iAo, 0, 0)

  const maps = {
    map: finish(cClean, { srgb: true }),
    mapWorn: finish(cWorn, { srgb: true }),
    wearMap: finish(cWear),
    normalMap: finish(normalFromHeight(height, S, cfg.tread ? 4.2 : 3.6)),
    roughnessMap: finish(cRough),
    metalnessMap: finish(cMetal),
    aoMap: finish(cAo)
  }
  cache[key] = maps
  return maps
}

/**
 * Painted hull livery decal sheet: draught marks, a name band and stencilled
 * numerals. Alpha-cut, hung on a quad against the topsides.
 */
export function getDecalMap(text = '', numerals = '') {
  const key = `ship|decal|${text}|${numerals}|v2`
  if (cache[key]) return cache[key]
  if (!hasDom()) return null
  const W = 512
  const H = 128
  const { canvas, ctx } = canvas2d(W, H)
  ctx.clearRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Stencilled, half-eaten by the weather — full-strength white reads as a
  // sticker, so paint it thin and let the alpha be eroded by noise below.
  ctx.fillStyle = '#e8e2d2'
  ctx.font = 'bold 62px "Helvetica Neue", Helvetica, Arial, sans-serif'
  if (text) ctx.fillText(text.toUpperCase(), W / 2, H * 0.38)
  ctx.font = 'bold 44px "Helvetica Neue", Helvetica, Arial, sans-serif'
  ctx.fillStyle = '#d8cfb8'
  if (numerals) ctx.fillText(numerals, W / 2, H * 0.76)

  // Erode: knock holes in the paint so the lettering has age.
  const img = ctx.getImageData(0, 0, W, H)
  const fbm = seamlessFbm(88.1)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      if (img.data[i + 3] === 0) continue
      const n = fbm(x / W, y / H, 22, 3)
      img.data[i + 3] *= clamp01((n - 0.28) * 2.6)
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = finish(canvas, { srgb: true })
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  cache[key] = tex
  return tex
}

/**
 * The hull skin.
 *
 * Everything below is expressed against **hull-local y**, which `snapToSea`
 * guarantees is measured from the actual water surface:
 *
 *   y < 0            antifouling — dull oxide red, matte, non-metallic,
 *                    fouled with weed the further down you go
 *   0 … bootTop      boot-top — the black band that hides the ripple
 *   just above       salt and scale bloom, brightest at the band and dying
 *                    out a metre up
 *   sheer            extra corrosion where the deck edge sheds water
 *
 * @param {{ color: THREE.Color, depth: number, kind?: string, premium?: boolean,
 *           rust?: number, metalness?: number, fouling?: number }} opts
 */
export function makeHullMaterial(opts) {
  const {
    color,
    depth = 2,
    kind = 'hull',
    premium = true,
    rust = 1,
    metalness = 0.88,
    fouling = 1,
    antifouling = 0x53211a
  } = opts
  const maps = getPlateMaps(kind)
  const mat = new MeshPhysicalNodeMaterial({
    side: THREE.DoubleSide,
    metalness,
    roughness: 0.5,
    envMapIntensity: premium ? 1.35 : 1.0,
    clearcoat: premium ? 0.42 : 0.14,
    clearcoatRoughness: premium ? 0.22 : 0.45
  })
  if (!maps.map) {
    mat.color = color.clone()
    return mat
  }
  mat.normalMap = maps.normalMap
  mat.normalScale = new THREE.Vector2(premium ? 1.5 : 1.1, premium ? 1.5 : 1.1)

  const uTint = uniform(color.clone())
  const uRust = uniform(rust)
  const uBoot = uniform(Math.max(0.18, depth * 0.22))
  const uFoul = uniform(fouling)
  const uAnti = uniform(new THREE.Color(antifouling))
  const uSheer = uniform(depth * 0.92)

  const plate = texture(maps.map, uv())
  const wear = texture(maps.wearMap, uv())
  const roughTex = texture(maps.roughnessMap, uv()).r
  const metalTex = texture(maps.metalnessMap, uv()).r

  // Bands. `y` is metres above the waterline.
  const y = positionLocal.y
  const boot = uBoot
  const below = smoothstep(float(0.16), float(-0.12), y)
  const bootBand = smoothstep(boot.add(0.14), boot.sub(0.02), y).sub(below).clamp(0, 1)
  // Salt bloom: strongest just over the boot-top, gone a metre or so up.
  const saltBand = smoothstep(boot.add(float(1.15).mul(uFoul)), boot, y).mul(float(0.85)).sub(below)
  // Weep from the sheer — the deck edge sheds every sea that comes aboard.
  const sheerWeep = smoothstep(uSheer.mul(0.35), uSheer, y).mul(0.55)
  // Depth below water: fouling gets heavier toward the keel.
  const deep = smoothstep(float(-0.05), float(-1).mul(uFoul).sub(0.2), y)

  const rustAmt = wear.r.mul(uRust).mul(float(1).add(sheerWeep)).clamp(0, 1)
  const chipAmt = wear.g
  const oilAmt = wear.b
  const ao = wear.a

  mat.colorNode = Fn(() => {
    // Topside paint, tinted by the class livery.
    const paint = plate.rgb.mul(uTint)
    // Chipped through to red-oxide primer on the proud edges.
    const primer = vec3(0.4, 0.19, 0.14).mul(float(0.7).add(plate.r.mul(0.6)))
    let out = mix(paint, primer, chipAmt.mul(0.9))
    // Oxide over the top, warm and variegated.
    const oxide = vec3(0.47, 0.22, 0.1).mul(float(0.55).add(plate.r.mul(0.9)))
    out = mix(out, oxide, rustAmt)
    // Oil / exhaust wash.
    out = out.mul(float(1).sub(oilAmt.mul(0.42)))
    // Salt and scale — chalky, slightly green where weed has started.
    const salt = vec3(0.72, 0.74, 0.66).mul(float(0.7).add(plate.r.mul(0.5)))
    out = mix(out, salt, saltBand.clamp(0, 1).mul(float(0.34).add(wear.b.mul(0.3))))
    // Boot-top: near-black band right on the ripple.
    out = mix(out, vec3(0.055, 0.055, 0.06).mul(float(0.6).add(plate.r.mul(0.8))), bootBand)
    // Antifouling below, going green and furred toward the keel.
    const anti = uAnti.mul(float(0.5).add(plate.r.mul(0.9)))
    const weed = mix(anti, vec3(0.11, 0.16, 0.1), deep.mul(0.75).mul(uFoul))
    out = mix(out, weed, below)
    // Baked cavity occlusion — seams and rivet rows hold their own shadow.
    return out.mul(float(0.55).add(ao.mul(0.45)))
  })()

  mat.roughnessNode = Fn(() => {
    let r = roughTex.mul(1.25).clamp(0.12, 1)
    r = mix(r, float(0.92), saltBand.clamp(0, 1).mul(0.7))
    r = mix(r, float(0.86), below.mul(0.8))
    r = mix(r, float(0.3), bootBand.mul(0.55))
    return r
  })()

  mat.metalnessNode = Fn(() => {
    const m = metalTex.mul(float(metalness).div(0.6)).clamp(0, 1)
    // Neither antifouling nor salt scale is a metal.
    return m.mul(float(1).sub(below.mul(0.9))).mul(float(1).sub(saltBand.clamp(0, 1).mul(0.6)))
  })()

  // Wet sheen dies out the further you get from the water; keeps the topsides
  // from reading as a showroom respray while the boot-top stays glossy.
  if (premium) {
    mat.clearcoatNode = Fn(() =>
      float(0.62)
        .mul(smoothstep(uSheer.mul(1.6), float(0), y).mul(0.7).add(0.3))
        .mul(float(1).sub(rustAmt.mul(0.85)))
    )()
    mat.clearcoatRoughnessNode = Fn(() => float(0.12).add(rustAmt.mul(0.5)).add(saltBand.clamp(0, 1).mul(0.4)))()
  }

  // Marker so the UV retiler knows this material is textured even though it
  // never sets `.map` (colorNode samples the plate itself).
  mat.userData.shipTextured = true
  mat.userData.tint = uTint
  return mat
}

/**
 * Classic-material path for deck fittings.
 *
 * Fittings are small, numerous and never straddle the waterline, so they do not
 * need the node graph — the pre-composited worn albedo carries the rust and the
 * chipping for free at zero shader cost.
 */
export function makeFittingMaterial(kind, props = {}) {
  const maps = getPlateMaps(kind)
  const { physical = false, ...rest } = props
  const base = {
    metalness: 0.85,
    roughness: 0.55,
    envMapIntensity: 1.0,
    ...rest
  }
  if (maps.mapWorn) {
    base.map = maps.mapWorn
    base.normalMap = maps.normalMap
    base.roughnessMap = maps.roughnessMap
    base.metalnessMap = maps.metalnessMap
    base.aoMap = maps.aoMap
    base.aoMapIntensity = 0.85
    base.normalScale = new THREE.Vector2(rest.normalStrength ?? 1.25, rest.normalStrength ?? 1.25)
  }
  delete base.normalStrength
  const mat = physical
    ? new THREE.MeshPhysicalMaterial(base)
    : new THREE.MeshStandardMaterial(base)
  mat.userData.shipTextured = true
  return mat
}

/**
 * Weathered marine timber — fenders, gratings, dunnage, hatch boards.
 * Ships carry as much wood as steel and it must not read as brown plastic.
 */
export function getTimberMaps() {
  const key = 'ship|timber|v1'
  if (cache[key]) return cache[key]
  if (!hasDom()) return {}
  const S = 512
  const fbm = seamlessFbm(12.7)
  const height = new Float32Array(S * S)
  const { canvas, ctx } = canvas2d(S)
  const img = ctx.createImageData(S, S)
  const rough = new Float32Array(S * S)
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x
      // Grain stretched hard along U, plus splits and a checked surface.
      const grain = fbm(u * 0.3, v * 5.0, 20, 4)
      const split = clamp01((fbm(u * 0.5, v * 9, 26, 2) - 0.62) * 5)
      const rot = fbm(u * 1.2, v * 1.2, 4, 3)
      height[i] = grain * 0.5 - split * 1.1
      rough[i] = 0.72 + rot * 0.24 - grain * 0.1
      // Silvered, salt-bleached oak going green in the damp.
      const warm = 0.5 + rot * 0.4
      let r = 96 + grain * 62 + warm * 26
      let g = 88 + grain * 54 + warm * 18
      let b = 76 + grain * 42 + warm * 8
      const algae = clamp01((fbm(u * 2.1, v * 2.4, 6, 3) - 0.56) * 3.4)
      r = r * (1 - algae * 0.55) + 34 * algae * 0.6
      g = g * (1 - algae * 0.45) + 58 * algae * 0.7
      b = b * (1 - algae * 0.5) + 40 * algae * 0.6
      const dark = split * 0.8
      const j = i * 4
      img.data[j] = clamp01((r * (1 - dark)) / 255) * 255
      img.data[j + 1] = clamp01((g * (1 - dark)) / 255) * 255
      img.data[j + 2] = clamp01((b * (1 - dark)) / 255) * 255
      img.data[j + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const maps = {
    map: finish(canvas, { srgb: true }),
    normalMap: finish(normalFromHeight(height, S, 3.0)),
    roughnessMap: finish(
      (() => {
        const { canvas: rc, ctx: rx } = canvas2d(S)
        const ri = rx.createImageData(S, S)
        for (let i = 0; i < S * S; i++) {
          const g = clamp01(rough[i]) * 255
          ri.data[i * 4] = g
          ri.data[i * 4 + 1] = g
          ri.data[i * 4 + 2] = g
          ri.data[i * 4 + 3] = 255
        }
        rx.putImageData(ri, 0, 0)
        return rc
      })()
    )
  }
  cache[key] = maps
  return maps
}

/**
 * Perished rubber — tyre fenders, hoses, gaiters. Almost no spec, heavy dust.
 */
export function getRubberMaps() {
  const key = 'ship|rubber|v1'
  if (cache[key]) return cache[key]
  if (!hasDom()) return {}
  const S = 256
  const fbm = seamlessFbm(31.9)
  const height = new Float32Array(S * S)
  const { canvas, ctx } = canvas2d(S)
  const img = ctx.createImageData(S, S)
  for (let y = 0; y < S; y++) {
    const v = y / S
    for (let x = 0; x < S; x++) {
      const u = x / S
      const i = y * S + x
      // Tread blocks around the circumference plus perishing cracks.
      const tread = Math.abs(((u * 14) % 1) - 0.5) < 0.3 ? 0.6 : 0
      const crack = clamp01((fbm(u * 4, v * 4, 18, 3) - 0.6) * 6)
      height[i] = tread - crack * 0.8 + (fbm(u, v, 12, 2) - 0.5) * 0.2
      const grime = fbm(u * 2, v * 2, 5, 3)
      const l = 0.13 + grime * 0.11 + tread * 0.05 - crack * 0.06
      const j = i * 4
      img.data[j] = clamp01(l * 1.02) * 255
      img.data[j + 1] = clamp01(l) * 255
      img.data[j + 2] = clamp01(l * 0.96) * 255
      img.data[j + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  const maps = {
    map: finish(canvas, { srgb: true }),
    normalMap: finish(normalFromHeight(height, S, 2.4))
  }
  cache[key] = maps
  return maps
}

/** Kick every ship map so the first hull built does not stall on canvas work. */
export function preloadShipSurfaces() {
  if (!hasDom()) return
  for (const kind of Object.keys(KINDS)) getPlateMaps(kind)
  getTimberMaps()
  getRubberMaps()
}
