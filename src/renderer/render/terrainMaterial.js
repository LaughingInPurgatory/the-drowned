/**
 * Island terrain surface — one shared triplanar PBR material for the world.
 *
 * WebGPU only: `MeshStandardNodeMaterial` + TSL. Custom GLSL does not compile
 * on this renderer (see qa-shots/BRIEF.md).
 *
 * ## Why one material
 *
 * There are ~170 islands and up to about thirty are resident at once (main.js
 * streams anything inside 16 km). A material or a texture per island would be
 * the whole memory budget. Everything that makes one island differ from the
 * next travels on the geometry instead:
 *
 *   - `aTerrain` (vec4) — how much sand / shingle / turf / rock this vertex is
 *     made of, decided on the CPU from height, slope and archetype.
 *   - `color`    (vec3) — the island's palette tint (ash grey, works rust,
 *     drowned green), applied gently: it should say "this is the ash island",
 *     not repaint the rock.
 *
 * ## Why triplanar
 *
 * A drowned world means old coastlines are now cliffs, and a cliff is where
 * planar UVs fall apart — a world-XZ projection stretches one texel down the
 * whole face. Triplanar costs three fetches on the layers that actually appear
 * on steep ground (rock, turf) and one on the layers that only ever lie on
 * flats (sand, shingle).
 *
 * ## Why height blending
 *
 * Splatting by a straight lerp cross-dissolves two layers like a slide
 * projector. Blending on each layer's packed height instead lets gravel poke
 * through sand along the edges of the actual stones, which is the difference
 * between "two textures faded together" and "a beach".
 *
 * ## Aliasing
 *
 * Every fetch is a mipmapped, 16× anisotropic power-of-two texture. Nothing
 * high-frequency is computed per pixel — the only procedural terms are macro
 * noise measured in tens of metres, which cannot alias. Detail normals, mask
 * sharpness and strata all dissolve with distance, so a far headland resolves
 * to smooth albedo instead of a shimmering grid.
 *
 * The shared terms below are built once as a node graph and referenced by
 * colour, roughness and normal alike; `.toVar()` means the generated shader
 * evaluates the splat once, not three times.
 */
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  texture,
  attribute,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  mix,
  max,
  abs,
  pow,
  sin,
  fract,
  floor,
  dot,
  clamp,
  smoothstep,
  normalize,
  length,
  positionWorld,
  positionLocal,
  normalWorldGeometry,
  transformNormalToView,
  cameraPosition
} from 'three/tsl'
import { getTerrainLayerMaps } from './textures.js'

/**
 * World metres covered by one tile of a layer texture.
 *
 * Per layer, because the features inside them are not the same size. The rock
 * tile carries roughly a dozen bedding steps and the shingle tile carries
 * roughly seven cobbles, so a single shared tile puts one of them an order of
 * magnitude out — a 4 m shingle tile is a beach of one-metre boulders, which
 * from the water reads as snakeskin wrapped round the hill.
 *
 * Sanity check against the boat, which is about 20 m: a cobble should be a
 * hand's width, a bedding step should be knee-high.
 */
const TILE = { rock: 2.6, grass: 1.9, sand: 2.2, shingle: 1.35 }
/** World metres per tile of the micro-detail normal. */
const DETAIL_TILE = 0.55

/**
 * Triplanar blend sharpness.
 *
 * This is the single most important constant in the file, and 4 was what
 * wrapped every hillside in basketwork. The rock layer is *directional* — its
 * bedding planes are horizontal stripes, which is the point of it — and at
 * exponent 4 a surface 45° off vertical gets a clean 50/50 of two projections
 * whose stripes cross at right angles. Superimposing two perpendicular stripe
 * sets is plaid, and on a dome the 50/50 band is a concentric ring, so the
 * plaid arrives in rows that follow the contours. That was the diamond scale
 * pattern, and no amount of tile-scale tuning touches it.
 *
 * 12 was not enough either. Screenshot evidence: on the flat ground beside a
 * harbour, where the normal is +Y and only one projection contributes, the
 * surface is clean; on the slope thirty metres away, where two projections mix,
 * the same material is a woven crosshatch. That is the whole tell — the plaid
 * lives exactly where, and only where, the blend band is.
 *
 * At 26 the mix is inside about ±4° of the diagonal, which is a seam rather
 * than a field, and the seam hides because both sides are the same noisy rock.
 * It is pushed further still with distance (`PLANAR_SHARPNESS_FAR`): a far
 * hillside has no resolvable detail to lose by snapping to one projection, and
 * high mips keep the layers' *anisotropy* long after they have lost everything
 * else — a set of horizontal bedding stripes crossed with a vertical set is
 * plaid however faint each one is.
 */
const PLANAR_SHARPNESS = 26
const PLANAR_SHARPNESS_FAR = 64

/**
 * Range over which fine surface detail is dissolved away.
 *
 * Past `DETAIL_FAR` the material is albedo and macro shading only. This is not
 * an optimisation, it is the anti-aliasing: a 4 m tile seen from 600 m is
 * several tiles per pixel, and no amount of mip bias rescues a mask computed
 * on top of it.
 *
 * The numbers matter more than they look. At 60 m/520 m a 2.6 m tile on a
 * hillside 400 m out was still drawn at 37% strength, and 2.6 m at 400 m is
 * seven screen pixels — a 512-texel map crushed into seven pixels has nothing
 * left but its own repeat, so what survived the dissolve was pure lattice.
 * Detail now has to be genuinely resolvable to be drawn at all; past ~240 m the
 * variation comes from macro noise measured in tens of metres and from the
 * shape of the land, both of which still resolve at that range.
 */
const DETAIL_NEAR = 55
const DETAIL_FAR = 330
/** Range over which tiled albedo dissolves into the layer's own mean colour. */
const ALBEDO_NEAR = 200
const ALBEDO_FAR = 820

/**
 * Cheap value noise.
 *
 * The lattice cell is wrapped to a 128-cell period before hashing. A plain
 * `fract(sin(dot(cell, k)) * big)` hash is fine at shadertoy coordinates and
 * useless at ours: this sea is 80 km across, so a cell index can be in the
 * tens of thousands, the sine argument in the millions, and float32 has no
 * fractional phase left to hash. What comes out is not noise but a regular
 * lattice — which is exactly the diamond pattern that was being painted
 * across every hillside. Wrapping costs one subtraction and makes the noise
 * periodic at 128 cells, which nothing here is large enough to notice.
 */
const hash21 = /*@__PURE__*/ Fn(([p]) => {
  const q = p.sub(floor(p.div(128)).mul(128))
  return fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453123))
})

const vnoise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const a = hash21(i)
  const b = hash21(i.add(vec2(1, 0)))
  const c = hash21(i.add(vec2(0, 1)))
  const d = hash21(i.add(vec2(1, 1)))
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y)
})

/**
 * Triplanar blend weights from a world normal. See `PLANAR_SHARPNESS`.
 *
 * The division normalises against the *largest* component before raising to the
 * power, and that is not a style preference — it is the whole correctness of the
 * function at these exponents. `pow(abs(n), s)` on its own underflows: a unit
 * normal's largest component is at worst 0.577, and 0.577^26 is 6e-7, which is
 * a hundred and sixty times below the 1e-4 floor the old divisor guard clamped
 * at. Anything below that floor was divided by the floor instead of by its own
 * sum, so the three weights came out summing to a few percent instead of to one
 * — and a triplanar fetch weighted by 0.02 returns almost nothing.
 *
 * Measured: at exponent 26 every surface whose largest normal component is under
 * about 0.70 collapsed, and the exponent rises to 64 with distance, which lifts
 * that threshold to 0.85 — i.e. very nearly every sloped surface in the game.
 * That was the smeared seaward cliff: with the tiled layers returning zero, all
 * that was left of the albedo was `far * mean`, a flat wash, and the collapse
 * threshold tracks surface orientation so the wash arrived in bands following
 * the contours. It also moved with range, because the exponent does.
 *
 * Dividing by the max first is exactly equivalent for any weight set that did
 * *not* underflow (the m^-s factor cancels in the normalise), so `26` and `64`
 * keep the meaning the comment above gives them. The sum is now at least 1, so
 * no divisor guard is needed.
 */
function planarWeights(n, sharpness = float(PLANAR_SHARPNESS)) {
  const a = abs(n)
  const m = max(max(a.x, a.y), max(a.z, float(1e-5)))
  const w = pow(a.div(m), sharpness)
  return w.div(dot(w, vec3(1, 1, 1))).toVar()
}

/**
 * Wet band, weed collar and dry berm around the waterline.
 *
 * Shared by the ground and by loose rock so a boulder sitting in the surf is
 * wet in exactly the band the beach behind it is. The sea owns Y and the
 * waterline is 0, so world Y is the only input it needs.
 */
function shoreline(P) {
  const xz = vec2(P.x, P.z)
  const noise = vnoise(xz.mul(0.09)).mul(0.6).add(vnoise(xz.mul(0.021)).mul(0.4))
  const top = float(1.7).add(noise.mul(2.6))
  return {
    wet: float(1).sub(smoothstep(float(-0.4), top, P.y)).toVar(),
    collar: float(1)
      .sub(smoothstep(float(-1.2), float(1.1).add(noise.mul(1.4)), P.y))
      .mul(smoothstep(float(-4.5), float(-1), P.y))
      .toVar(),
    berm: smoothstep(top, top.add(float(1.1)), P.y)
      .mul(float(1).sub(smoothstep(top.add(float(0.9)), top.add(float(3.2)), P.y)))
      .toVar(),
    // Below the swell. The underwater shelf is a ring of long thin triangles
    // diving to the skirt, and giving it the wet band's near-mirror roughness
    // lit every one of those facets individually — a field of bright diamonds
    // in the shallows next to every island. Drowned ground is dark and matte.
    sub: float(1).sub(smoothstep(float(-3.5), float(-0.3), P.y)).toVar()
  }
}

/**
 * Temporary isolation switch. `null` in anything you commit — a non-null value
 * replaces the whole surface with a diagnostic. 'weights' = the vertex splat
 * attribute alone, 'rock' = the raw triplanar rock fetch, 'planes' = the
 * projection weights, anything else = the geometric normal's Y.
 */
const DEBUG = null

let _material = null

/**
 * The island surface material. Built once; every island mesh shares it.
 * Returns null headless or before the procedural layers exist.
 */
export function getTerrainMaterial() {
  if (_material) return _material
  const L = getTerrainLayerMaps()
  if (!L) return null

  const material = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 1,
    // The blend applies the island tint itself; letting three multiply the
    // vertex colour in as well would land the palette twice.
    vertexColors: false,
    envMapIntensity: 0.35
  })

  const aTerrain = attribute('aTerrain', 'vec4')
  const aTint = attribute('color', 'vec3')

  // Islands carry no rotation or scale (main.js buildBodyMesh sets position
  // only), so local and world directions coincide — which is what lets the
  // world-space normal go straight back out through transformNormalToView.
  //
  // Shade in *island-local* XZ, not world XZ. A body can sit 40 km from the
  // origin, and a texture coordinate of 15,000 has lost enough float32
  // precision to make a 512-texel tile step visibly. Local XZ never leaves
  // ±1200. Y stays world: every body sits at y = 0, so island-local Y already
  // is height above the sea, which is what the shoreline needs.
  const P = vec3(positionLocal.x, positionWorld.y, positionLocal.z).toVar()
  const Nw = normalize(normalWorldGeometry).toVar()
  const xz = vec2(P.x, P.z)

  /** Distance dissolve for everything fine enough to alias. */
  // Real world distance — `P` is island-local and would put every island the
  // same near distance from the camera.
  const camDist = length(cameraPosition.sub(positionWorld))
  /**
   * Distance corrected for grazing incidence — the fades below run on this,
   * not on `camDist`.
   *
   * From a boat the eye is at sea level and a hillside slopes away from it, so
   * almost every square metre of terrain in frame is seen at ten or twenty
   * degrees. The texel footprint is a long thin sliver at that angle, and the
   * hardware answer is anisotropic filtering, which is set to 16 — except that
   * this renderer runs in WebGPU *compatibility mode*, so what it actually gets
   * is whatever the adapter allows, and 16:1 is barely enough anyway. What the
   * player sees is the tile smeared along the fall line: parallel streaks down
   * the whole slope, which reads as a combed texture rather than as ground.
   *
   * So the fades below run on a distance inflated by however much *more*
   * anisotropy the footprint needs than the sampler can supply. That "more than"
   * is the whole correction, and the version this replaces did not have it: it
   * was a flat `camDist / max(cos, 0.35)`, which inflates by 2x at 60° off
   * normal and by 2.9x at its floor. 60° is a 2:1 footprint. The sampler is
   * asked for 16:1 on every terrain layer (`textures.js`) and gets at least 8:1
   * on any adapter that runs this game, so at 2:1 it is not remotely in trouble
   * — the old correction fired hardest exactly where nothing was wrong.
   *
   * What that cost: measured on `qa-shots/terrain/c2c-dist.png` (R = camDist
   * past DETAIL_FAR, G = viewDist past DETAIL_FAR), the seaward cliff and most
   * of the near hillside came back cyan — genuinely inside 330 m, but pushed
   * past the fade by the correction alone. Detail there was not reduced, it was
   * *off*: no tiled normal, no micro-detail normal, no cavity AO, packed heights
   * pinned flat. Smooth albedo on a smooth mesh is exactly the smeared cliff.
   *
   * `ANISO_TAPS` is the calibration knob, and it is deliberately half of the 16
   * requested: compatibility mode may hand back less than it is asked for, and
   * an adapter that quietly gives 8 should not start smearing.
   */
  const ANISO_TAPS = 8
  const incidence = max(abs(dot(normalize(cameraPosition.sub(positionWorld)), Nw)), float(1 / 64))
  const viewDist = camDist
    .mul(max(float(1), float(1).div(incidence.mul(float(ANISO_TAPS)))))
    .toVar()
  const detail = float(1).sub(smoothstep(float(DETAIL_NEAR), float(DETAIL_FAR), viewDist)).toVar()
  // Albedo outlives relief. Fine relief has to go early — a bumped normal and a
  // mask cut on a sub-metre feature are the two things that alias — but killing
  // the colour on the same schedule leaves a mid-distance hillside as one flat
  // wash, which is its own kind of wrong. Now that the tiles are flat at their
  // own scale (textures.js `flattenTile`) the colour can be carried much
  // further without the repeat reading.
  const far = smoothstep(float(ALBEDO_NEAR), float(ALBEDO_FAR), viewDist).toVar()
  // Strata are a *landform* feature, not a texture one. The bedding bands
  // below are a few metres deep, which is fifteen screen pixels on a cliff
  // three hundred metres away — they cannot alias there and they are most of
  // what makes rock read as rock at that range. Gating them on `detail` (which
  // is gone by 330 m, because it governs sub-metre tiles) deleted the geology
  // from precisely the distance band that has nothing else left.
  const strata = float(1).sub(smoothstep(float(700), float(1800), camDist)).toVar()

  const bw = planarWeights(Nw, mix(float(PLANAR_SHARPNESS), float(PLANAR_SHARPNESS_FAR), far))

  // Domain warp — this is what hides the repeat, now that the second octave is
  // gone. Two bands: a broad one that slides whole neighbourhoods of tiles
  // relative to each other, and a tighter one at roughly the tile's own size
  // that shears the grid so no two repeats line up edge to edge.
  //
  // Amplitude has to be of the order of the tile to do anything at all — the
  // 1.6 m/59 m warp this replaces was a tenth of a tile and moved nothing.
  // It also has to stay under about a quarter of its own wavelength or the
  // domain folds and the texture visibly smears; 6 m at 60 m and 2.4 m at 13 m
  // are both comfortably inside that.
  const warp = vec2(
    vnoise(xz.mul(0.0165)).sub(0.5).mul(6).add(vnoise(xz.mul(0.077)).sub(0.5).mul(2.4)),
    vnoise(xz.mul(0.0165).add(vec2(19.7, 5.3))).sub(0.5).mul(6)
      .add(vnoise(xz.mul(0.077).add(vec2(4.3, 31.1))).sub(0.5).mul(2.4))
  ).toVar()
  const Pw = vec3(P.x.add(warp.x), P.y, P.z.add(warp.y)).toVar()

  /**
   * Slowly drifting tile size — the other half of hiding the repeat.
   *
   * Translating the domain (the warp above) slides the grid but leaves its
   * *pitch* constant, so the lattice is still a lattice: a texture that repeats
   * every 26 screen pixels reads as wallpaper however far you slide it. Varying
   * the pitch instead means there is no single repeat period anywhere in frame.
   *
   * ±22% over about 110 m. The shear this introduces is 0.22/27 ≈ 0.008, i.e.
   * under a percent of visible stretch across a tile, and the tangent normals
   * do not care about a uniform scale, so nothing else has to compensate.
   */
  const tileJitter = vnoise(xz.mul(0.0091).add(vec2(5.5, -2.2))).mul(0.44).add(0.78).toVar()
  const planes = (tile) => {
    const t = tileJitter.mul(tile)
    return {
      x: vec2(Pw.z, Pw.y).div(t).toVar(),
      y: vec2(Pw.x, Pw.z).div(t).toVar(),
      z: vec2(Pw.x, Pw.y).div(t).toVar()
    }
  }
  const pRock = planes(TILE.rock)
  const pGrass = planes(TILE.grass)
  const pSandY = vec2(Pw.x, Pw.z).div(tileJitter.mul(TILE.sand)).toVar()
  const pShinY = vec2(Pw.x, Pw.z).div(tileJitter.mul(TILE.shingle)).toVar()

  /** Full triplanar fetch — layers that appear on steep ground. */
  const tri = (tex, p) =>
    texture(tex, p.x).mul(bw.x).add(texture(tex, p.y).mul(bw.y)).add(texture(tex, p.z).mul(bw.z))

  // Deliberately one octave per layer.
  //
  // The version this replaces cross-faded a second sample of the *same* map at
  // a non-harmonic scale, on the theory that one scale is always wallpaper.
  // With a directional map that is worse than wallpaper: two stripe sets at
  // different pitches beat against each other, and the beat period is longer
  // than either tile, which is why the resulting weave read at boat scale
  // rather than at the 2.6 m tile it was supposedly made of. Repeat is broken
  // by warping the domain and by macro colour drift instead — neither of which
  // superimposes anything on anything.

  /**
   * How far the tiled detail has dissolved into the layer's own average.
   *
   * This is the term that was missing, and its absence was the whole defect.
   * The normal, the mask sharpness and the AO all faded with range already; the
   * *albedo* did not, so a hillside 500 m away still drew a 2.6 m tile at full
   * strength. A tile drawn at 14 screen pixels is not texture, it is a motif,
   * and a motif repeated on a grid is wallpaper — which is exactly how it read.
   *
   * Fading to the mean is not giving up detail: past a few hundred metres there
   * is no detail to have, and what should vary at that range is the geology —
   * macro drift, strata, lichen, and the shape of the land itself.
   */
  const meanOf = (layer) => vec3(layer.mean[0], layer.mean[1], layer.mean[2])
  const dissolve = (c, layer) => vec4(mix(c.rgb, meanOf(layer), far), mix(c.w, float(layer.meanRough), far))
  /**
   * The packed height of a layer, faded to flat with range.
   *
   * This was the last lattice standing. Everything else dissolved with distance
   * — albedo, normals, mask sharpness — but the four packed heights were
   * sampled at full strength at any range, and they drive both the splat
   * boundary and the cavity AO. So a hillside whose colour had gone completely
   * flat still had its blend edges and its ambient occlusion cut on a 2.6 m
   * grid, and that grid is what was still visible as a fine hex weave in an
   * otherwise featureless wash. A height that is not resolvable must not
   * decide anything.
   */
  const flatten = (h) => mix(h, float(0.5), float(1).sub(detail))

  // map:       rgb albedo, a roughness
  // normalMap: rgb tangent normal, a height (this is what drives the mask)
  const sandC = dissolve(texture(L.sand.map, pSandY), L.sand).toVar()
  const shinC = dissolve(texture(L.shingle.map, pShinY), L.shingle).toVar()
  const grasC = dissolve(tri(L.grass.map, pGrass), L.grass).toVar()
  const rockC = dissolve(tri(L.rock.map, pRock), L.rock).toVar()
  const sandH = flatten(texture(L.sand.normalMap, pSandY).w).toVar()
  const shinH = flatten(texture(L.shingle.normalMap, pShinY).w).toVar()
  const grasH = flatten(tri(L.grass.normalMap, pGrass).w).toVar()
  const rockH = flatten(tri(L.rock.normalMap, pRock).w).toVar()

  // ── Macro variation ──────────────────────────────────────────────────────
  // Tens of metres across, so it breaks the 4 m tile without ever being small
  // enough to alias. This is what stops an island reading as one photograph
  // repeated across a hillside.
  //
  // A cliff face fifty metres tall covers almost no XZ distance, so an XZ-only
  // macro term is constant all the way down it — the coastal bank came out a
  // smooth pale wash while the gentle ground above it was properly mottled.
  //
  // The fix this replaces was a *shear*: `mxz = xz + P.y * vFace * (1.55, -1.15)`.
  // Do not go back to it. A shear along a fixed world direction is exactly the
  // "domain folds and the texture visibly smears" failure the warp comment above
  // warns about, at fifteen times the amplitude. Two things go wrong at once.
  // The shear is rank-one in Y, so on the face there is always a direction along
  // which the domain barely moves and the noise is *constant* — a streak. And
  // `vFace` itself ramps across the face, so the streak direction rotates with
  // it and the streaks curve. Measured directly: `DEBUG = 'macro'` on
  // `qa-shots/terrain/x5-macro.png` renders the bare macro field as long curved
  // filaments combing round the hill, pixel-for-pixel the smeared-paint band
  // that was being blamed on the tiled layers. It survives `normalNode = null`
  // (`x4-nonormal.png`), so it was never a lighting term.
  //
  // Triplanar it instead, the same as every texture in this file. No shear, no
  // preferred direction, and Y is a real axis on a face rather than a bias on a
  // horizontal one. Weights are linear rather than `bw`'s power-26: value noise
  // is not directional, so there is no plaid to avoid, and a soft blend is what
  // keeps the field continuous across the diagonal.
  //
  // Only the two octaves that need it. `macroA` (118 m) and `macroC` (455 m) are
  // regional drift — a whole cliff sits inside one of their cells whatever domain
  // they are sampled in — so they stay one lookup each in plain XZ.
  const vFace = float(1).sub(smoothstep(float(0.2), float(0.8), abs(Nw.y))).toVar()
  /**
   * Steepness gate for bedding — gentler than `vFace`, which is only fully on
   * past 78°.
   *
   * Bedding is banded in world Y. On a *face* that draws horizontal courses,
   * which is geology. On the shelving apron at the foot of the cliff — which is
   * near-flat, 100% rock (`qa-shots/terrain/x6-splat.png` is solid red the whole
   * way down), and seen from a boat at an incidence of a few degrees — the same
   * band becomes a contour ribbon smeared across half the frame, because tens of
   * metres of ground compress into one pixel row. Constant-Y content and a
   * shallow slope viewed edge-on is the definition of a streak.
   */
  const steep = float(1).sub(smoothstep(float(0.55), float(0.9), abs(Nw.y))).toVar()
  const mAbs = abs(Nw)
  const mw = mAbs.div(max(mAbs.x.add(mAbs.y).add(mAbs.z), float(1e-4))).toVar()
  const mnoise = (f, off) => {
    const q = P.mul(f)
    return vnoise(vec2(q.z, q.y).add(off))
      .mul(mw.x)
      .add(vnoise(vec2(q.x, q.z).add(off)).mul(mw.y))
      .add(vnoise(vec2(q.x, q.y).add(off)).mul(mw.z))
  }
  const macroA = vnoise(xz.mul(0.0085)).toVar()
  const macroB = mnoise(0.031, vec2(11.3, -4.7)).toVar()
  const macroC = vnoise(xz.mul(0.0022).add(vec2(-3.1, 7.9))).toVar()
  // ~9 m. Sits in the gap the tighter dissolve opened up: too big to alias
  // anywhere you can see it, small enough to still be structure at half a
  // kilometre, where the tiled layers have already gone to their mean. Held
  // back beyond a kilometre and a half, past which 9 m is a few pixels.
  const macroD = mnoise(0.11, vec2(-8.4, 2.6))
    .mul(float(1).sub(smoothstep(float(700), float(1700), camDist)))
    .toVar()
  const macro = macroA
    .mul(0.34)
    .add(macroB.mul(0.2))
    .add(macroC.mul(0.31))
    .add(macroD.mul(0.15))
    .toVar()

  // ── Height blend ─────────────────────────────────────────────────────────
  // Vertex weights are the terrain logic; macro noise perturbs the boundary so
  // transitions do not follow the mesh rings. `depth` opens the blend band up
  // with distance — sharp masks read as detail up close and as speckle
  // aliasing at range, so the far field deliberately relaxes to an average.
  //
  // The height term is deliberately small against the blend depth, and that is
  // the fix for the last lattice standing. At 0.55 against a depth of 0.14 the
  // packed heights *were* the mask: whichever layer's tile happened to be
  // highest won outright. Those tiles are 1.35, 1.9, 2.2 and 2.6 m, so the
  // boundary between any two of them moved on the beat between two lattices —
  // sand against shingle beats at 3.5 m, grass against rock at 7 m — and two
  // interfering lattices is precisely a weave. It showed on mixed ground and
  // nowhere else: the flat beach beside the harbour, which is pure sand with
  // nothing to beat against, was clean in the same frame.
  //
  // Now the vertex weights and the macro noise decide, and the packed height
  // only roughens the edge they draw.
  // Blend depth is now flat with range, and that is a correction, not a tweak.
  // It used to open out to 0.55 in the far field on the grounds that a sharp
  // mask speckles once it stops being resolvable. But 0.55 is wider than the
  // whole spread of the four weights, so *every* layer survived at distance and
  // the shader averaged sand, shingle, turf and rock together — which is a flat
  // beige wash, and that wash was the mid-distance hillside. The thing that
  // could actually speckle is the packed height, and `flatten()` already pins
  // that to a constant 0.5 by the time detail is gone; what is left deciding
  // the mask is the vertex weights and macro noise, neither of which has any
  // high-frequency content to alias.
  //
  // Sand and shingle are held off steep ground, and that is a *rendering*
  // requirement before it is a geological one. Both are fetched through a single
  // top-down projection (`pSandY` / `pShinY`) on the stated grounds that they
  // "only ever lie on flats" — but the vertex painter puts a storm-beach band on
  // the coastal bank, and the bank is near-vertical. A top-down fetch on a
  // vertical face is the exact failure triplanar exists to prevent: one texel
  // smeared down the whole thing. Verified by `qa-shots/terrain/c8-splat.png`,
  // where the sand/shingle band sits precisely under the pale streak left on the
  // cliff in `c6-fix2.png`. Geology agrees — loose shingle does not cling to a
  // cliff — so the weight is handed to rock rather than merely deleted, which
  // also keeps `bSum` off its floor and puts stone on the cliffs where it
  // belongs. `vFace` is the same steepness ramp the macro domain already uses.
  const onFace = float(1).sub(vFace)
  const depth = float(0.28)
  const kSand = sandH
    .mul(0.22)
    .add(max(aTerrain.x.add(macroB.sub(0.5).mul(0.22)), float(0)))
    .mul(onFace)
  const kShin = shinH
    .mul(0.22)
    .add(max(aTerrain.y.add(macroA.sub(0.5).mul(0.3)), float(0)))
    .mul(onFace)
  // Two scales of perturbation on the turf/rock boundary, not one. With a
  // single 30 m band the grass line is a smooth curve running round the island
  // at a constant width, which is what an `if (height > x)` split looks like.
  // The 9 m band on top of it is what puts grass fingers down the gullies and
  // lets rock ledges poke through the turf.
  const edge = macro.sub(0.5).mul(0.5).add(macroD.sub(0.5).mul(0.26))
  const kGras = grasH.mul(0.22).add(max(aTerrain.z.add(edge), float(0)))
  const kRock = rockH
    .mul(0.22)
    .add(max(aTerrain.w.sub(edge.mul(0.8)), float(0)))
    .add(vFace.mul(0.55))
  const peak = max(max(kSand, kShin), max(kGras, kRock)).sub(depth).toVar()
  const bSand = max(kSand.sub(peak), float(0)).toVar()
  const bShin = max(kShin.sub(peak), float(0)).toVar()
  const bGras = max(kGras.sub(peak), float(0)).toVar()
  const bRock = max(kRock.sub(peak), float(0)).toVar()
  const bSum = max(bSand.add(bShin).add(bGras).add(bRock), float(1e-4)).toVar()

  const splat = (s, h, g, r) =>
    s.mul(bSand).add(h.mul(bShin)).add(g.mul(bGras)).add(r.mul(bRock)).div(bSum)

  /** Packed height of whichever layer won here — doubles as cavity AO. */
  const cavity = splat(sandH, shinH, grasH, rockH).toVar()
  const rockShare = bRock.div(bSum).toVar()
  const sandShare = bSand.add(bShin).div(bSum).toVar()

  const shore = shoreline(P)

  // ── Lichen and weathering in the crevices ────────────────────────────────
  // Sheltered ledges hold moisture, so they hold growth. Keyed on flatness and
  // the packed cavity so it settles into the low ground of the rock.
  const lichen = smoothstep(float(0.42), float(0.78), vnoise(xz.mul(0.055).add(vec2(4, 9))))
    .mul(smoothstep(float(0.45), float(0.92), Nw.y))
    .mul(float(1).sub(cavity).mul(0.7).add(0.3))
    .mul(rockShare)
    .mul(0.55)
    .toVar()

  // ── Bedding ──────────────────────────────────────────────────────────────
  //
  // Courses of rock, banded in world Y and warped so they follow the ground
  // instead of ringing the island like a contour line. Landform scale, not
  // texture scale: ~6 m beds are fifteen screen pixels on a cliff three hundred
  // metres away, so they carry the geology at ranges where the tiled layers have
  // already dissolved to their mean.
  //
  // Hoisted out here because **colour and relief have to come from the same band
  // function**, and that is the fix, not a tidy-up. They used to be two unrelated
  // fields — albedo on a 6.25 m band, the `gy` normal on `bedQ`'s 4.5 m noise —
  // so the albedo drew a course exactly where the lighting drew nothing. A band
  // of different colour on a smooth surface with no light response is paint, and
  // that is precisely what the seaward cliff looked like: horizontal filaments
  // smeared along the contour, no stone anywhere in them.
  //
  // Measured, not argued. `qa-shots/terrain/xc-nobed.png` is the whole material
  // with this one term zeroed and nothing else changed, and the face is
  // completely clean — every remaining filament in `f1-island.png` was this.
  // (`xa-splatonly.png` / `xb-macroonly.png` bracket it from the other side: the
  // splat and the macro drift are clean on their own.)
  //
  // The warp total stays under one bed (0.62 + 0.22). At 1.45 the broad octave
  // alone crossed a course boundary, so which bed you were in was decided by an
  // 83 m noise field and the courses wandered up and down with it — long sinuous
  // ribbons rather than bedding.
  //
  // Vertical jointing is the other half, and it is what stops the courses being
  // a contour map. With the smooth warp alone every trace runs unbroken from one
  // end of the headland to the other and hugs the dome exactly, which no sea
  // cliff does and which announces the shader far louder than under-detail does:
  // joint sets cut the beds every few tens of metres and the trace *steps*
  // across each one. `floor` of a low-frequency noise gives irregular blocks
  // with curved boundaries, and each block gets its own phase, so the courses
  // are offset at the joint rather than merely bent. The discontinuity is only
  // in XZ, so `gy` — which differences in Y — never sees it.
  const joint = floor(vnoise(xz.mul(0.017).add(vec2(2.5, 8.1))).mul(6))
  const bandWarp = vnoise(xz.mul(0.012))
    .mul(0.62)
    .add(vnoise(xz.mul(0.05)).mul(0.22))
    .add(hash21(vec2(joint, 17.3)))
    .toVar()
  /**
   * Signed standoff of the course at height `y`, about -0.5..0.5.
   *
   * Each course gets its own hardness, and the profile goes to zero at both
   * course boundaries so neighbours meet at a joint instead of stepping. The
   * derivative of this is the relief; the value of it is the tone.
   */
  const bedAt = (y) => {
    const t = y.mul(0.16).add(bandWarp)
    const f = fract(t)
    return hash21(vec2(floor(t), 3.7))
      .sub(0.5)
      .mul(smoothstep(float(0), float(0.2), f))
      .mul(float(1).sub(smoothstep(float(0.8), float(1), f)))
  }
  const bed = bedAt(P.y).toVar()
  /** Metres a hard course stands proud of a soft one. */
  const BED_RELIEF = 0.9

  // ── Colour ───────────────────────────────────────────────────────────────
  if (DEBUG) {
    // Emissive, not albedo: a lit diagnostic is unreadable. The sun, the sky
    // fill and the shadow map all multiply into a `colorNode`, so a face turned
    // away from the sun crushes every channel to near-black at the same ratio
    // and the value you are trying to read is gone. This cost one wasted round.
    const dbg =
      DEBUG === 'weights' ? vec3(aTerrain.w, aTerrain.z, aTerrain.x.add(aTerrain.y))
      : DEBUG === 'rock' ? rockC.rgb
      : DEBUG === 'planes' ? bw
      : DEBUG === 'uv' ? vec3(fract(P.x.div(TILE.rock)), fract(P.z.div(TILE.rock)), 0)
      : DEBUG === 'flat' ? texture(L.rock.map, vec2(P.x, P.z).div(TILE.rock)).rgb
      : DEBUG === 'triraw' ? tri(L.rock.map, planes(TILE.rock)).rgb
      : DEBUG === 'diag' ? vec3(detail, incidence, macro)
      : DEBUG === 'dist' ? vec3(
          smoothstep(float(DETAIL_FAR - 1), float(DETAIL_FAR), camDist),
          smoothstep(float(DETAIL_FAR - 1), float(DETAIL_FAR), viewDist),
          smoothstep(float(DETAIL_NEAR - 1), float(DETAIL_NEAR), camDist))
      : DEBUG === 'macro' ? vec3(macro)
      : DEBUG === 'splat' ? vec3(bRock.div(bSum), bGras.div(bSum), bSand.add(bShin).div(bSum))
      : vec3(Nw.y)
    material.colorNode = vec3(0)
    material.emissiveNode = dbg
    material.normalNode = null
    material.roughnessNode = null
    _material = material
    return material
  }
  material.colorNode = Fn(() => {
    let albedo = splat(sandC.rgb, shinC.rgb, grasC.rgb, rockC.rgb)

    // Bedding tone. A proud course is scoured pale, a recessed one holds shade
    // and damp — so this is the same sign as the relief `gy` gives it, and the
    // two are the same field by construction. See the `bedAt` block.
    //
    // `steep` as well as `rockShare`: banding in world Y draws horizontal
    // courses on a face, but on the near-flat shelving apron at the foot of the
    // cliff — 100% rock, seen from a boat at a few degrees of incidence — the
    // same band spreads into a contour ribbon across half the frame. Constant-Y
    // content on a shallow slope viewed edge-on is a streak by definition.
    const bedTone = float(1).add(bed.mul(0.5))
    albedo = albedo.mul(mix(float(1), bedTone, rockShare.mul(strata).mul(steep)))

    // Macro drift in value and in temperature. Value alone reads as the same
    // colour with the brightness turned up and down.
    // Wider than it looks safe: once the tiled layers dissolve to a flat mean
    // at a few hundred metres, this is the only thing left varying, and a
    // hillside with no variation reads as a painted backdrop.
    albedo = albedo.mul(mix(float(0.66), float(1.36), macro))
    albedo = albedo.mul(mix(vec3(0.9, 0.97, 1.09), vec3(1.12, 1.03, 0.86), macroC))
    albedo = albedo.mul(mix(vec3(1.04, 1.0, 0.95), vec3(0.96, 1.0, 1.05), macroB))

    albedo = mix(albedo, vec3(0.19, 0.24, 0.13), lichen)

    // Shoreline. Wet sand is darker and far glossier than dry, and that
    // specular sheen at the waterline is most of what sells a beach.
    albedo = albedo.mul(mix(float(1), float(0.34), shore.wet))
    albedo = mix(albedo, albedo.mul(vec3(0.86, 1, 1.02)), shore.wet.mul(0.6))
    // Weed / algae collar right at mean water.
    albedo = mix(albedo, vec3(0.055, 0.075, 0.05), shore.collar.mul(0.75))
    // Dried salt and shell at the top of the wash. Not conditioned on sand any
    // more — a rock coast gets a splash line too, and the light band above the
    // dark wet band is most of what makes a waterline read as a shore rather
    // than as a place where two materials happen to meet.
    albedo = mix(
      albedo,
      albedo.mul(1.18).add(vec3(0.03, 0.028, 0.023)),
      shore.berm.mul(mix(float(0.34), float(0.72), sandShare))
    )
    // Everything under the swell goes dark and drinks light.
    albedo = albedo.mul(mix(float(1), float(0.42), shore.sub))

    albedo = albedo.mul(mix(vec3(1, 1, 1), aTint, float(0.85)))

    // Cavity AO — the packed height of whichever layer won, so it darkens the
    // same crevices the normal map is bending light into.
    const ao = mix(float(0.52), float(1), cavity).mul(mix(float(1), float(0.85), lichen))
    return albedo.mul(mix(float(1), ao, detail))
  })()

  // ── Roughness ────────────────────────────────────────────────────────────
  material.roughnessNode = Fn(() => {
    const rough = splat(sandC.w, shinC.w, grasC.w, rockC.w)
    // Distant terrain relaxes toward matte: glossy speckle a kilometre out is
    // just sparkle noise once the normals have been faded away.
    const wet = mix(mix(rough, float(0.9), float(1).sub(detail)), float(0.13), shore.wet.mul(0.9))
    return clamp(mix(wet, float(0.86), shore.sub), float(0.06), float(1))
  })()

  // ── Normal ───────────────────────────────────────────────────────────────
  material.normalNode = Fn(() => {
    const decode = (tex, uvp) => texture(tex, uvp).xyz.mul(2).sub(1)
    // Blend the layers inside each projection plane, then blend the planes.
    const plane = (gp, rp) =>
      decode(L.sand.normalMap, pSandY)
        .mul(bSand)
        .add(decode(L.shingle.normalMap, pShinY).mul(bShin))
        .add(decode(L.grass.normalMap, gp).mul(bGras))
        .add(decode(L.rock.normalMap, rp).mul(bRock))
        .div(bSum)
    const nX = plane(pGrass.x, pRock.x)
    const nY = plane(pGrass.y, pRock.y)
    const nZ = plane(pGrass.z, pRock.z)

    // Whiteout blend (Golus): reorient each plane's tangent normal against the
    // surface normal before combining, so a cliff face does not get its bumps
    // lit as though it were the ground.
    const tX = vec3(nX.x.add(Nw.z), nX.y.add(Nw.y), abs(nX.z).mul(Nw.x))
    const tY = vec3(nY.x.add(Nw.x), nY.y.add(Nw.z), abs(nY.z).mul(Nw.y))
    const tZ = vec3(nZ.x.add(Nw.x), nZ.y.add(Nw.y), abs(nZ.z).mul(Nw.z))
    let n = normalize(
      vec3(tX.z, tX.y, tX.x)
        .mul(bw.x)
        .add(vec3(tY.x, tY.z, tY.y).mul(bw.y))
        .add(tZ.mul(bw.z))
    )

    // Micro-detail at ~0.55 m per tile, near camera only. This is the term
    // that would otherwise turn a distant hillside into crawling noise.
    const dScale = float(1 / DETAIL_TILE)
    const dNear = float(1).sub(smoothstep(float(6), float(85), camDist))
    const dN = decode(L.detailNormal, vec2(P.z, P.y).mul(dScale))
      .mul(bw.x)
      .add(decode(L.detailNormal, vec2(P.x, P.z).mul(dScale)).mul(bw.y))
      .add(decode(L.detailNormal, vec2(P.x, P.y).mul(dScale)).mul(bw.z))
    n = normalize(n.add(dN.mul(dNear.mul(0.55))))

    // Flatten back toward the geometric normal with range: everything above is
    // a sub-metre feature, and past a few hundred metres it can only alias.
    const flat = normalize(mix(Nw, n, detail))

    // ── Metre-scale ground relief, carried at every distance ────────────────
    //
    // This is the answer to "the hillside is over-soft at mid distance", and it
    // is deliberately not "fade the tiled normals out more slowly". Those maps
    // repeat every couple of metres; drawing them at four screen pixels is how
    // the lattice got here in the first place. What a hillside three hundred
    // metres away actually shows is relief measured in *metres* — the lumps and
    // hollows the mesh is far too coarse to carry (a vertex every 6–13 m) and
    // the tiles far too fine. Nothing else in the material occupies that band.
    //
    // It is a height field differenced into a slope, not a normal map, so it
    // has no tile and therefore no repeat to hide. The shortest wavelength is
    // ~3.7 m, which is still eight screen pixels at half a kilometre and cannot
    // alias anywhere it is drawn.
    // Two bands, and the finer one is on a leash. Anything sampled in an XZ
    // domain is stretched along the fall line when the ground slopes and
    // stretched again when you look at it from a boat at sea level, so a fine
    // band turns into parallel filaments combing down the hillside — the same
    // failure mode as an unfiltered tile at grazing incidence, arrived at from
    // the other direction. An 18 m lump is forty-odd screen pixels at three
    // hundred metres and reads as form; a 5 m one has to be let go before it
    // reads as smear. There was a 1.6 m octave here too; it was the streaks.
    const fineK = float(1).sub(smoothstep(float(240), float(680), viewDist)).toVar()
    const groundH = (q) =>
      vnoise(q.mul(0.055)).mul(0.86)
        .add(vnoise(q.mul(0.19).add(vec2(31.7, 12.3))).mul(float(0.34).mul(fineK)))
    const eps = 1.2
    // Plain XZ, and the Y-folded domain this used is not missed: every use of
    // the gradient below is multiplied by `onGround`, so the term is already
    // zero on exactly the faces the fold existed to serve. All the fold did
    // there was smear (see the macro block).
    const h0 = groundH(xz).toVar()
    // Amplitude in metres, over the difference step: this is a slope directly.
    // Four metres of relief across an eighteen-metre lump is about a 1-in-6
    // hillside, which is what ground looks like. Half a metre — the first
    // number tried here — worked out to a three degree tilt and was invisible.
    // Amplitude fades on `viewDist`, not `camDist`, and the distinction is the
    // whole point of the term. The finer octave above is already on `viewDist`;
    // this one was on raw range, so on the shelving apron below the cliff — which
    // is near *flat*, and therefore seen from a boat at an incidence around 0.05
    // — an 18 m lump was still drawn at full 4 m amplitude while compressed into
    // a couple of screen pixels of height. That is a high-contrast light/dark
    // edge every two pixels, i.e. the brush-stroke streaking that survived both
    // the weight and the fade fixes. Relief nobody can resolve must not be lit.
    const k = float(4 / eps).mul(
      float(1).sub(smoothstep(float(700), float(1800), viewDist))
    )
    const gx = groundH(xz.add(vec2(eps, 0))).sub(h0).mul(k)
    const gz = groundH(xz.add(vec2(0, eps))).sub(h0).mul(k)
    // Only meaningful where the ground is ground. On a steep face the XZ
    // gradient of an XZ height field is the wrong quantity entirely — it tilts
    // the face sideways, which draws vertical combing down a cliff.
    const onGround = smoothstep(float(0.3), float(0.8), abs(Nw.y)).toVar()

    // What a cliff actually has instead is bedding: harder courses standing
    // proud and softer ones cut back, which is *horizontal* relief and comes
    // from differencing in Y rather than in XZ. Perturbing the normal straight
    // along world up is enough — on a near-vertical face that is the in-plane up
    // direction to within a few degrees, and the term is gated on `steep` long
    // before the face is flat enough for that to stop being true.
    //
    // This is the derivative of `bedAt`, the *same* field the albedo is toned
    // by, which is the whole repair: a course that is lighter is now also a
    // course that stands proud and catches the sun on its underside. It used to
    // be an unrelated 4.5 m noise, so the colour bands and the lit bands did not
    // line up and the two decorrelated into paint.
    //
    // `steep`, not `1 - onGround`, so the relief exists on exactly the surfaces
    // the tone does. Two gates that nearly agree is how they came apart before.
    const bedEps = 0.7
    const gy = bedAt(P.y.add(float(bedEps)))
      .sub(bed)
      .mul(float(BED_RELIEF / bedEps))
      .mul(steep)
      .mul(strata)

    const bumped = normalize(
      flat
        .add(vec3(gx.negate(), float(0), gz.negate()).mul(onGround))
        .sub(vec3(float(0), gy, float(0)))
    )
    return transformNormalToView(bumped)
  })()

  _material = material
  return material
}

let _rockMaterial = null

/**
 * Terrain-shaded material for loose rock — talus, sea stacks, boulders.
 * Same rock layer and same waterline treatment as the ground, at a tighter
 * tile because a boulder is not a hillside.
 */
export function getRockPropMaterial() {
  if (_rockMaterial) return _rockMaterial
  const L = getTerrainLayerMaps()
  if (!L) return null

  const material = new MeshStandardNodeMaterial({
    metalness: 0,
    roughness: 1,
    vertexColors: false,
    envMapIntensity: 0.3
  })

  // Loose rock is a child mesh with its own transform, so there is no useful
  // local space to shade in — but world XZ out at the rim of an 80 km sea has
  // no float32 precision left for a 1.6 m tile. Wrap it to a whole number of
  // tiles instead: seamless, and the coordinate never leaves 0..205.
  const W = 1.6 * 128
  const wrapped = positionWorld.sub(floor(positionWorld.div(W)).mul(W))
  const P = vec3(wrapped.x, positionWorld.y, wrapped.z).toVar()
  const Nw = normalize(normalWorldGeometry).toVar()
  const xz = vec2(P.x, P.z)
  const detail = float(1)
    .sub(smoothstep(float(40), float(400), length(cameraPosition.sub(positionWorld))))
    .toVar()
  const bw = planarWeights(Nw)
  const S = float(1 / 1.6)
  const uvX = vec2(P.z, P.y).mul(S).toVar()
  const uvY = vec2(P.x, P.z).mul(S).toVar()
  const uvZ = vec2(P.x, P.y).mul(S).toVar()
  const tri = (tex) =>
    texture(tex, uvX)
      .mul(bw.x)
      .add(texture(tex, uvY).mul(bw.y))
      .add(texture(tex, uvZ).mul(bw.z))

  const rockC = tri(L.rock.map).toVar()
  const rockH = tri(L.rock.normalMap).w.toVar()
  const shore = shoreline(P)

  material.colorNode = Fn(() => {
    const macro = vnoise(xz.mul(0.02)).mul(0.6).add(vnoise(xz.mul(0.004)).mul(0.4))
    let albedo = rockC.rgb.mul(mix(float(0.74), float(1.18), macro))
    albedo = albedo.mul(mix(float(1), float(0.4), shore.wet))
    albedo = mix(albedo, vec3(0.05, 0.07, 0.045), shore.collar.mul(0.7))
    const lichen = smoothstep(float(0.45), float(0.8), vnoise(xz.mul(0.4)))
      .mul(smoothstep(float(0.35), float(0.9), Nw.y))
      .mul(float(1).sub(shore.wet))
    albedo = mix(albedo, vec3(0.2, 0.25, 0.14), lichen.mul(0.4))
    return albedo.mul(mix(float(0.6), float(1), rockH)).mul(mix(float(1), float(0.42), shore.sub))
  })()

  material.roughnessNode = Fn(() =>
    clamp(
      mix(mix(rockC.w, float(0.14), shore.wet.mul(0.9)), float(0.86), shore.sub),
      float(0.08),
      float(1)
    )
  )()

  material.normalNode = Fn(() => {
    const decode = (uvp) => texture(L.rock.normalMap, uvp).xyz.mul(2).sub(1)
    const nX = decode(uvX)
    const nY = decode(uvY)
    const nZ = decode(uvZ)
    const tX = vec3(nX.x.add(Nw.z), nX.y.add(Nw.y), abs(nX.z).mul(Nw.x))
    const tY = vec3(nY.x.add(Nw.x), nY.y.add(Nw.z), abs(nY.z).mul(Nw.y))
    const tZ = vec3(nZ.x.add(Nw.x), nZ.y.add(Nw.y), abs(nZ.z).mul(Nw.z))
    const n = normalize(
      vec3(tX.z, tX.y, tX.x)
        .mul(bw.x)
        .add(vec3(tY.x, tY.z, tY.y).mul(bw.y))
        .add(tZ.mul(bw.z))
    )
    return transformNormalToView(normalize(mix(Nw, n, detail.mul(0.9).add(0.1))))
  })()

  _rockMaterial = material
  return material
}
