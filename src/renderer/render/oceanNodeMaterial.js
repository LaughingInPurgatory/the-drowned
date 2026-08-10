/**
 * The open sea — WebGPU / TSL surface for the camera-centred ocean disc.
 *
 * The shape of the water is not decided here. `world/sea.js` owns the wave
 * field, and this file sums `SEA_COMPILED` — the exact same pre-multiplied
 * table `waveHeight` sums for buoyancy — so the surface you can see and the
 * surface boats sit on are the same function of (x, z, t). The only thing this
 * file adds to the geometry is `SEA_DETAIL_SLOPE`, a capillary band that
 * contributes slope and no height whatsoever, which is why it can be GPU-only
 * without lifting a single hull.
 *
 * What this file *does* own is how that surface responds to light. In rough
 * order of how much each one matters to whether the result reads as water or as
 * blue plastic:
 *
 * 1. **Reflections that go below the horizon are not sky.** At the grazing
 *    angles you look at the sea from a boat, Fresnel says almost everything is
 *    mirror — and a naive shader duly reflects the bright sky over the whole
 *    frame and renders milk. In reality half of those reflected rays hit the
 *    back of the next wave, not the sky. Masking the reflection by the vertical
 *    component of the reflected ray is the single change that turns the plastic
 *    off.
 * 2. **Specular is a slope distribution, not a power of N·H.** `pow(ndh, 380)`
 *    is a mirror with one microfacet size, so it aliases into crawling glitter
 *    the moment a wave is smaller than a pixel. Here the roughness is the
 *    *variance of the wave slopes that are no longer resolved* at this distance
 *    (`mss` below), accumulated from the same spectrum, and fed to a Beckmann
 *    lobe. Far water therefore broadens into a smooth glare band instead of
 *    boiling, and it does so for the physically correct reason rather than
 *    because someone tuned a fade.
 * 3. **Whitecaps come from the Jacobian.** Where the trochoidal map compresses,
 *    water is piling into a crest and about to break. That determinant falls
 *    out of the tangent basis for free, and it is sampled at two times so foam
 *    trails behind the crest that made it rather than strobing on and off with
 *    it. Coverage then *thresholds a texture* rather than tinting one, which is
 *    what gives foam eroded, bubbly edges instead of a white wash.
 * 4. **Sub-surface scattering.** Light through the back of a thin crest, gated
 *    on a low sun behind the wave. This is the expensive-water tell, and it is
 *    cheap.
 * 5. **Depth extinction.** Red dies in the first metre of water, blue does not.
 *    Running Beer-Lambert over a path length that shrinks at thin crests and
 *    grows in troughs is what makes the body colour a *ramp* rather than a tint.
 *
 * Colour and time of day are not decided here either — `render/sky.js` supplies
 * every palette uniform through `scene.js updateEnvironment`, and this shader
 * only ever multiplies and mixes what it is handed.
 *
 * Shore and hull interaction (`setShores`/`setFloaters`, and the scene sweep in
 * `update`) is a small analytic distance field rather than a depth-buffer read:
 * the ocean draws before the islands do, so there is no scene depth to sample
 * at the point it is needed.
 */
import {
  MeshBasicNodeMaterial,
  Vector3,
  Vector4,
  Color,
  FrontSide,
  BufferGeometry,
  Float32BufferAttribute,
  Sphere,
  Mesh,
  DataTexture,
  RGBAFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Box3
} from 'three/webgpu'
import {
  uniform,
  varying,
  vec3,
  vec2,
  vec4,
  float,
  positionLocal,
  modelWorldMatrix,
  cameraPosition,
  normalize,
  max,
  min,
  mix,
  pow,
  smoothstep,
  sin,
  cos,
  abs,
  atan,
  length,
  exp,
  Fn,
  texture,
  cross,
  reflect,
  negate,
  saturate,
  oneMinus,
  clamp
} from 'three/tsl'
import {
  SEA_COMPILED,
  SEA_DETAIL_SLOPE,
  SEA_MAX_AMPLITUDE,
  WIND_BEARING
} from '../world/sea.js'
import { getWaterNormalMap } from './textures.js'

/** Unit wind vector in XZ — foam streaks and drift all hang off this. */
const WIND_X = Math.sin(WIND_BEARING)
const WIND_Z = Math.cos(WIND_BEARING)

/**
 * How far back in time the second Jacobian sample is taken, in seconds.
 *
 * Foam is not instantaneous: a crest breaks and the bubbles stay on the water
 * for a few seconds behind it. Sampling the fold at `t` and again at `t - LAG`
 * and taking the union costs no transcendentals — the phase shift per component
 * is a constant, so `sin(ph + w)` expands to the sines and cosines already in
 * hand — and it is the difference between foam that trails a breaking crest and
 * foam that flickers on top of one.
 */
const FOAM_LAG = 1.6

/**
 * Diagnostic channel isolator. `null` in every shipping build.
 *
 * Foam coverage cannot be tuned by looking at the finished frame: at midday the
 * sun glitter and the whitecaps are both small white dots, and the eye cannot
 * tell you which one is covering the sea. Setting this to `'foam'` / `'cover'` /
 * `'spec'` renders that term alone as greyscale, which `scripts/measure.cjs`
 * turns into an actual coverage percentage. Measure, then set the threshold.
 */
const DEBUG = null

// ---------------------------------------------------------------------------
// Foam / micro-detail texture
// ---------------------------------------------------------------------------

/**
 * One seamless four-channel noise sheet, generated once at module scope.
 *
 * A hash noise evaluated on world coordinates is not an option here: at 40 km
 * from the origin, `sin(dot(p, k)) * 43758` has lost every bit that mattered
 * and degenerates into bands — which is exactly the tiling the horizon shows.
 * A texture has no such problem, wraps exactly, and gets mipmapped, so the far
 * field filters itself instead of aliasing into noise.
 *
 * The repeat is hidden by sampling it at three incommensurate scales and by
 * multiplying against the wave-driven coverage mask, which never repeats.
 *
 *   R  fine bubbles      G  mid clumps      B  coarse blobs      A  decorrelated fine
 */
function buildFoamTexture(size = 256) {
  const hash = (ix, iy, period, seed) => {
    const x = ((ix % period) + period) % period
    const y = ((iy % period) + period) % period
    let h = x * 374761393 + y * 668265263 + seed * 1442695041
    h = (h ^ (h >>> 13)) >>> 0
    h = Math.imul(h, 1274126177) >>> 0
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
  }
  const noise = (x, y, period, seed) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const a = hash(x0, y0, period, seed)
    const b = hash(x0 + 1, y0, period, seed)
    const c = hash(x0, y0 + 1, period, seed)
    const d = hash(x0 + 1, y0 + 1, period, seed)
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
  }
  // Octaves stay on the torus: every frequency is an integer cell count over
  // the sheet, so the whole stack wraps and no seam survives the tiling.
  const fbm = (u, v, cells, octaves, seed) => {
    let sum = 0
    let amp = 1
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      const p = cells << o
      sum += amp * noise(u * p, v * p, p, seed + o * 71)
      norm += amp
      amp *= 0.5
    }
    return sum / norm
  }
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // Bubbles want contrast: raw fBm is a cloud, and foam is not a cloud.
      const fine = fbm(u, v, 16, 4, 11)
      const mid = fbm(u, v, 6, 3, 907)
      const coarse = fbm(u, v, 3, 3, 5501)
      const alt = fbm(u, v, 24, 3, 31337)
      const i = (y * size + x) * 4
      const punch = (n, c) => Math.max(0, Math.min(1, (n - 0.5) * c + 0.5))
      data[i] = punch(fine, 2.1) * 255
      data[i + 1] = punch(mid, 1.7) * 255
      data[i + 2] = punch(coarse, 1.35) * 255
      data[i + 3] = punch(alt, 2.4) * 255
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

let foamTexture = null
function getFoamTexture() {
  if (!foamTexture) foamTexture = buildFoamTexture()
  return foamTexture
}

// ---------------------------------------------------------------------------
// Shoreline table
// ---------------------------------------------------------------------------

/** Angular bins in the per-island polar coastline table. */
const SHORE_BINS = 64
/** Island slots the shader carries. Two is plenty from a boat. */
const SHORE_SLOTS = 2

/**
 * Distance from an island's centre to its waterline, per bearing, read straight
 * off the island mesh's own vertices.
 *
 * Deriving it from the geometry rather than importing the island's height field
 * keeps the coupling at "whatever is in the scene has a coastline", which is
 * true of anything that might ever need shore foam, and means this cannot go
 * stale against a change in how islands are built.
 */
function shoreTableFor(geometry) {
  const cached = geometry.userData.oceanShoreTable
  if (cached) return cached
  const pos = geometry.getAttribute('position')
  const bins = new Float32Array(SHORE_BINS)
  let maxR = 0
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    // Only land counts. Island meshes carry a deep underwater skirt, and a
    // coastline traced through that is a coastline out in open water.
    if (y <= 0.2) continue
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const r = Math.hypot(x, z)
    if (r <= 0) continue
    const bin =
      (Math.floor(((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * SHORE_BINS) + SHORE_BINS) %
      SHORE_BINS
    if (r > bins[bin]) bins[bin] = r
    if (r > maxR) maxR = r
  }
  // One smoothing pass over the ring. A bin that caught a single tall spur is a
  // spike in the foam band, and a spike in a foam band reads as a bug.
  const smoothed = new Float32Array(SHORE_BINS)
  for (let i = 0; i < SHORE_BINS; i++) {
    const a = bins[(i - 1 + SHORE_BINS) % SHORE_BINS]
    const b = bins[i]
    const c = bins[(i + 1) % SHORE_BINS]
    smoothed[i] = a * 0.25 + b * 0.5 + c * 0.25
  }
  const table = { bins: smoothed, maxR: maxR || 1 }
  geometry.userData.oceanShoreTable = table
  return table
}

/**
 * The two nearest coastlines, packed one per row.
 *
 * Eight bits per bin quantises the radius to maxR/255 — about two metres on a
 * five-hundred-metre island, against a foam band tens of metres wide that is
 * then broken up by noise. Nothing that survives to the screen.
 */
function buildShoreTexture() {
  const data = new Uint8Array(SHORE_BINS * SHORE_SLOTS * 4)
  const tex = new DataTexture(data, SHORE_BINS, SHORE_SLOTS, RGBAFormat)
  // Wrap in u so bearing 359° blends into bearing 0° instead of clamping into
  // a visible seam running out from every island.
  tex.wrapS = RepeatWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return { tex, data }
}

// ---------------------------------------------------------------------------
// Material
// ---------------------------------------------------------------------------

/** Floating hulls the surface reacts to (foam collar + local darkening). */
const FLOAT_SLOTS = 5

export function createOceanNodeMaterial({ sunDirection, skyColor, fogColor } = {}) {
  const uTime = uniform(0)
  const uSunDir = uniform(new Vector3().copy(sunDirection || new Vector3(0.4, 0.8, 0.3)).normalize())
  const uSunColor = uniform(new Color(0xfff0d8))
  const uMoonDir = uniform(new Vector3(0, 1, 0))
  const uMoonBright = uniform(1)
  const uDeepColor = uniform(new Color(0x061a2c))
  const uCrestColor = uniform(new Color(0x1a6a7a))
  const uSkyColor = uniform(new Color(skyColor ?? 0x8a9499))
  const uZenithColor = uniform(new Color(0x3a6e96))
  const uCloudColor = uniform(new Color(0x9a94a0))
  const uCloudLit = uniform(new Color(0xffe0c0))
  const uCloudCover = uniform(0.52)
  const uFoamColor = uniform(new Color(0xeef4f6))
  const uShallowColor = uniform(new Color(0x2f9c92))
  const uSearchPos = uniform(new Vector3())
  const uSearchDir = uniform(new Vector3(0, -1, 0))
  const uSearchColor = uniform(new Color(0xfff0d0))
  const uSearchIntensity = uniform(0)
  const uSearchRange = uniform(140)
  const uSearchCosOuter = uniform(Math.cos(0.22))
  const uSearchCosInner = uniform(Math.cos(0.1))
  const uRainRipple = uniform(0)
  /**
   * 0 = glassy, 1 = full gale. Nobody owns this uniform outside this file yet,
   * so `update()` tracks it off `uRainRipple` (which `scene.js` already drives
   * from the weather sim) and it can be driven directly the day someone wants
   * a sea state that is not the weather's.
   */
  const uSeaState = uniform(0)
  const uWaterNormalStrength = uniform(0.6)
  const uShoreA = uniform(new Vector4(0, 0, 1, 0))
  const uShoreB = uniform(new Vector4(0, 0, 1, 0))
  const uFloaters = []
  for (let i = 0; i < FLOAT_SLOTS; i++) uFloaters.push(uniform(new Vector4(0, 0, 1, 0)))
  const fogColorU = uniform(
    fogColor instanceof Color ? fogColor.clone() : new Color(fogColor ?? 0x6a7a88)
  )

  const waterNormal = getWaterNormalMap()
  const foamTex = getFoamTexture()
  const shore = buildShoreTexture()

  const vWorldPos = varying(vec3(0, 0, 0), 'vOceanWorld')
  const vParam = varying(vec2(0, 0), 'vOceanParam')

  const material = new MeshBasicNodeMaterial({ side: FrontSide, fog: true })

  // -- geometry -------------------------------------------------------------

  material.positionNode = Fn(() => {
    const wp4 = modelWorldMatrix.mul(vec4(positionLocal, 1))
    const base = wp4.xyz
    const xz = vec2(base.x, base.z)
    const dist = length(xz.sub(vec2(cameraPosition.x, cameraPosition.z)))
    // Shortest wavelength worth displacing at this triangle size. Pushing a
    // 200 m triangle around with a 6 m wave is noise, not detail.
    const cut = mix(float(0), float(70), pow(smoothstep(float(60), float(4200), dist), 0.78))
    // Past the fog wall the surface flattens out entirely; anything else is
    // paying for geometry nobody can resolve.
    const detail = float(1).sub(smoothstep(float(2500), float(11000), dist))

    const d = vec3(0, 0, 0).toVar()
    for (const w of SEA_COMPILED) {
      const gate = float(1).sub(smoothstep(float(w.len * 0.85), float(w.len * 1.6), cut))
      const ph = xz.x.mul(w.dx).add(xz.y.mul(w.dz)).mul(w.k).sub(uTime.mul(w.omega))
      const s = sin(ph).mul(gate)
      const c = cos(ph).mul(gate)
      d.addAssign(vec3(c.mul(w.qa * w.dx), s.mul(w.amp), c.mul(w.qa * w.dz)))
    }
    d.mulAssign(detail)

    vWorldPos.assign(base.add(d))
    vParam.assign(xz)
    // Mesh is recentred on the camera each frame, so local Y is world Y.
    return vec3(positionLocal.x.add(d.x), d.y, positionLocal.z.add(d.z))
  })()

  // -- shading --------------------------------------------------------------

  material.colorNode = Fn(() => {
    const wp = vWorldPos
    const xz = vec2(wp.x, wp.z)
    const dist = length(xz.sub(vec2(cameraPosition.x, cameraPosition.z)))
    const storm = saturate(max(uSeaState, uRainRipple))

    // Distance bands. Everything expensive rides one of these to zero, and the
    // roughness picks up what they drop so nothing simply vanishes.
    const nearFade = float(1).sub(smoothstep(float(80), float(1100), dist))
    const texFade = float(1).sub(smoothstep(float(140), float(2600), dist))
    const foamFade = float(1).sub(smoothstep(float(300), float(2600), dist))
    const shadeFade = float(1).sub(smoothstep(float(7000), float(19000), dist))

    // Normal LOD cut runs a little finer than the geometry's — the shading can
    // resolve slope the tessellation cannot.
    const nCut = mix(float(0), float(48), pow(smoothstep(float(90), float(5200), dist), 0.8))

    // ---- wave field: exact tangents, Jacobian now and a moment ago ---------
    //
    // e is the derivative of the horizontal (trochoidal) offset, g the height
    // gradient. Both come out of one pass over the spectrum, which is a third
    // of the cost of finite-differencing the displacement and is exact rather
    // than approximate — and the Jacobian determinant, the whitecap mask, is
    // then free.
    const e = vec3(0, 0, 0).toVar()
    const eOld = vec3(0, 0, 0).toVar()
    const g = vec2(0, 0).toVar()
    // Mean square slope of everything the LOD has dropped. This is the shader's
    // roughness: the waves are still there, they are just smaller than a pixel,
    // so they belong in the specular lobe instead of in the normal.
    const mss = float(0.0016).toVar()
    for (const w of SEA_COMPILED) {
      const gate = float(1).sub(smoothstep(float(w.len * 0.85), float(w.len * 1.6), nCut))
      const ph = vParam.x.mul(w.dx).add(vParam.y.mul(w.dz)).mul(w.k).sub(uTime.mul(w.omega))
      const s = sin(ph).mul(gate)
      const c = cos(ph).mul(gate)
      // sin(ph + omega*LAG) without a second transcendental.
      const cw = Math.cos(w.omega * FOAM_LAG)
      const sw = Math.sin(w.omega * FOAM_LAG)
      const sOld = s.mul(cw).add(c.mul(sw))
      const jac = vec3(w.qak * w.dx * w.dx, w.qak * w.dx * w.dz, w.qak * w.dz * w.dz)
      e.addAssign(jac.mul(s))
      eOld.addAssign(jac.mul(sOld))
      g.addAssign(vec2(w.ak * w.dx, w.ak * w.dz).mul(c))
      mss.addAssign(float(0.5 * w.ak * w.ak).mul(float(1).sub(gate.mul(gate))))
    }

    const tx = vec3(float(1).sub(e.x), g.x, negate(e.y))
    const tz = vec3(negate(e.y), g.y, float(1).sub(e.z))
    const Nwave = normalize(cross(tz, tx))
    const fold = float(1).sub(e.x).mul(float(1).sub(e.z)).sub(e.y.mul(e.y))
    const foldOld = float(1).sub(eOld.x).mul(float(1).sub(eOld.z)).sub(eOld.y.mul(eOld.y))

    // ---- capillary band: slope only, so buoyancy never sees it ------------
    const ds = vec2(0, 0).toVar()
    for (const w of SEA_DETAIL_SLOPE) {
      const ph = wp.x.mul(w.dx).add(wp.z.mul(w.dz)).mul(w.k).sub(uTime.mul(w.omega))
      ds.addAssign(vec2(w.dx * w.slope, w.dz * w.slope).mul(cos(ph)))
    }
    const detailAmt = nearFade.mul(float(1).add(storm.mul(0.55)))
    // Whatever the capillary band stops contributing as a normal, it keeps
    // contributing as roughness. That continuity is why the transition from
    // "sharp chop" to "broad glare" has no visible edge in it.
    const detailMss = SEA_DETAIL_SLOPE.reduce((s, w) => s + 0.5 * w.slope * w.slope, 0)
    mss.addAssign(float(detailMss).mul(float(1).sub(detailAmt.mul(detailAmt))))

    let N = normalize(vec3(Nwave.x.sub(ds.x.mul(detailAmt)), Nwave.y, Nwave.z.sub(ds.y.mul(detailAmt))))

    // ---- photographic micro-normal, two scales, counter-drifting ----------
    const driftA = xz.mul(0.075).add(vec2(uTime.mul(0.016), uTime.mul(0.011)))
    const driftB = xz.mul(0.021).sub(vec2(uTime.mul(0.009), uTime.mul(-0.013)))
    const tnA = texture(waterNormal, driftA).xyz.mul(2).sub(1)
    const tnB = texture(waterNormal, driftB).xyz.mul(2).sub(1)
    const tn = tnA.mul(0.65).add(tnB.mul(0.5))
    const ns = uWaterNormalStrength.mul(texFade)
    N = normalize(vec3(N.x.sub(tn.x.mul(ns)), N.y, N.z.sub(tn.y.mul(ns))))
    mss.addAssign(float(0.004).mul(float(1).sub(texFade.mul(texFade))))

    // Rain stipples the near water; a squall is visibly rougher than a shower.
    const rainNear = float(1).sub(smoothstep(float(20), float(240), dist)).mul(uRainRipple)
    const rp = xz.mul(0.9).add(vec2(uTime.mul(0.7), uTime.mul(-0.9)))
    const rn = texture(foamTex, rp).xyz.mul(2).sub(1)
    N = normalize(vec3(N.x.sub(rn.x.mul(rainNear.mul(0.35))), N.y, N.z.sub(rn.y.mul(rainNear.mul(0.35)))))

    // Past the last detail band the surface is a plane and the roughness owns
    // everything. Without this the horizon crawls.
    N = normalize(mix(vec3(0, 1, 0), N, shadeFade))
    mss.addAssign(float(0.012).mul(float(1).sub(shadeFade)))
    // A gale is not just taller water, it is rougher water at every scale.
    mss.mulAssign(float(1).add(storm.mul(1.6)))
    const sigma2 = clamp(mss.mul(2), float(0.0022), float(0.35))

    const V = normalize(cameraPosition.sub(wp))
    const NdV = max(N.dot(V), float(1e-3))
    const crest = smoothstep(float(-SEA_MAX_AMPLITUDE * 0.55), float(SEA_MAX_AMPLITUDE * 0.6), wp.y)
    // The Jacobian below 1 means water piling up: thin, translucent, about to
    // break. It is the same number the whitecaps read.
    //
    // Every threshold against `fold` on this surface is calibrated to where the
    // number actually lands, which is nowhere near the textbook 0. Sampling
    // this spectrum over 200k points: min 0.50, 1% 0.68, 5% 0.76, 25% 0.89,
    // median 0.99. A classic `fold < 0` breaking test fires on precisely
    // nothing here and the sea comes out with no whitecaps at all — which is
    // the trap this comment exists to stop you walking back into. Re-measure
    // before you retune: the distribution moves if SEA_WAVES or SEA_STEEPNESS
    // move.
    //
    // Note the shape of this and every other falling ramp on this surface:
    // `1 - smoothstep(lo, hi, x)`, never `smoothstep(hi, lo, x)`. WGSL leaves
    // smoothstep *undefined* when edge0 >= edge1, and Dawn is free to return
    // anything at all — which on this shader meant a foam mask that measured
    // 4% offline and covered half the sea on screen.
    const thin = oneMinus(smoothstep(float(0.7), float(1.0), fold))

    // ---- shore + hull proximity ------------------------------------------
    //
    // No scene depth is available to this pass (the ocean draws first), so the
    // shoreline is an analytic distance field read from a polar table of the
    // real coastline. `shoreGap` is metres to the *coastline curve*, unsigned.
    //
    // Unsigned is the whole point, and it is worth knowing why. The radial form
    // `|p - centre| - R(bearing)` is only a distance function outside a
    // star-convex shape. Islands are not star-convex — they have bays, and a
    // harbour sits in one — so every water point inside the polar radius comes
    // out strongly *negative*, and a band test written as "gap below X" then
    // fires over the entire bay. That is not a subtle error: measured on the
    // `open` preset it put full-strength surf foam over roughly half the near
    // field and ran the shoaling tint over all of it, which is what made a calm
    // midday sea read as a breaking one under tropical water. Taking `abs` costs
    // one instruction and confines both effects to a band about the coast, which
    // is the only place the polar table is meaningful anyway.
    const shoreGap = float(1e6).toVar()
    for (const [slot, u] of [[0, uShoreA], [1, uShoreB]]) {
      const rel = vec2(wp.x.sub(u.x), wp.z.sub(u.y))
      const bearing = atan(rel.y, rel.x).div(Math.PI * 2).add(0.5)
      const v = float((slot + 0.5) / SHORE_SLOTS)
      const coast = texture(shore.tex, vec2(bearing, v)).x.mul(u.z)
      // Slot inactive (w = 0) parks the coastline at infinity.
      const gap = abs(length(rel).sub(coast)).add(float(1e6).mul(float(1).sub(u.w)))
      shoreGap.assign(min(shoreGap, gap))
    }
    // Hulls: a collar of disturbed water hugging anything floating. Tight on
    // purpose — the wake proper is `render/wake.js`, and this is only the ring
    // of aerated water against the plating. Reaching 3x the hull radius (as it
    // used to) is not a collar, it is a pond.
    const hullNear = float(0).toVar()
    for (const u of uFloaters) {
      const d2 = length(vec2(wp.x.sub(u.x), wp.z.sub(u.y)))
      hullNear.assign(max(hullNear, oneMinus(smoothstep(u.z.mul(0.8), u.z.mul(1.55), d2)).mul(u.w)))
    }

    // ---- body colour: Beer-Lambert over a wave-relative path length -------
    //
    // The eye looking into a trough is looking through metres of water; looking
    // at a thin crest it is looking through centimetres. Red is gone by the
    // first metre and blue is not, so running the same absorption over that
    // varying path is what turns a flat tint into a depth ramp.
    const upFace = smoothstep(float(0.55), float(0.995), N.y)
    const path = mix(float(3.4), float(0.35), saturate(crest.mul(0.55).add(thin.mul(0.45))))
    const absorb = exp(vec3(-0.36, -0.052, -0.03).mul(path))
    let body = uDeepColor.add(uCrestColor.mul(absorb).mul(0.9))
    // Shoaling water: the bottom comes up, the path collapses, and the colour
    // runs to the shallow tint. Same physics, different reason for the depth.
    // 70 m, not 140: the polar coastline table is a coarse approximation of the
    // real waterline, so a wide ramp smears a bright turquoise wash a long way
    // out into water that is not remotely shallow. That was the other half of
    // the "inshore sea is tropical cyan" report.
    const shoal = saturate(float(1).sub(smoothstep(float(0), float(70), shoreGap)))
    body = mix(body, mix(body, uShallowColor.mul(uSkyColor.add(0.25)), float(0.45)), shoal.mul(shoal))
    // Sky bounce into the body, and a touch of direct sun through the surface.
    body = body.add(uSkyColor.mul(0.045).mul(upFace.mul(0.5).add(0.5)))
    body = body.add(uSunColor.mul(saturate(N.dot(uSunDir))).mul(0.028))
    body = body.mul(float(1).sub(storm.mul(0.22)))
    // A storm sea is not a calm sea turned down. The water is aerated to some
    // depth, carries suspended sediment, and reflects a sky with no blue left
    // in it — so it loses saturation and goes grey-green, which is the colour
    // people actually mean by "angry water". Darkening alone (which is all
    // `scene.js` can do from outside, by scaling uDeepColor/uCrestColor) keeps
    // the hue and lands on a tropical blue at low light, which is how a
    // thunderstorm ended up looking like a holiday brochure.
    const lum = body.dot(vec3(0.3, 0.59, 0.11))
    body = mix(body, vec3(lum.mul(0.78), lum.mul(1.0), lum.mul(0.84)), storm.mul(0.72))

    // ---- Fresnel, and the reason the sea is not a mirror of milk ----------
    const R = reflect(negate(V), N)
    const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(NdV), 5)))
    // A reflected ray heading below the horizon does not reach the sky; it hits
    // the back of the next wave. Rougher water blocks more of them, which is
    // why this widens with sea state.
    const block = smoothstep(float(-0.02).sub(sigma2.mul(0.6)), float(0.11).add(sigma2), R.y)
    const fresnel = fres.mul(mix(float(0.16), float(1), block))

    // ---- sky the surface reflects ----------------------------------------
    let skyRefl = mix(uSkyColor, uZenithColor, pow(saturate(R.y), float(0.45)))
    // Clouds on a softened plane projection — a true plane blows up at the
    // horizon, and from a boat nearly everything you look at is near it.
    const cloudUv = vec2(R.x, R.z).div(max(R.y, float(0.06)).add(0.35)).mul(0.06)
    const cloudN = texture(foamTex, cloudUv.add(vec2(uTime.mul(0.0016), uTime.mul(0.001)))).z
    const cloudAmt = smoothstep(uCloudCover.mul(0.9), uCloudCover.mul(0.9).add(0.3), cloudN)
      .mul(smoothstep(float(0.02), float(0.35), R.y))
      .mul(uCloudCover)
    skyRefl = mix(skyRefl, mix(uCloudColor, uCloudLit, 0.4), cloudAmt.mul(0.7))
    // Water is not a perfect mirror: what comes back is tinted and dimmed.
    skyRefl = skyRefl.mul(vec3(0.84, 0.93, 1.0)).mul(float(1).sub(storm.mul(0.25)))

    let col = mix(body, skyRefl, fresnel).toVar()

    // ---- sub-surface scattering ------------------------------------------
    //
    // The expensive-water tell: a low sun behind a crest lights the water
    // *through* it. Needs all three of a thin crest, a steep face, and the sun
    // on the far side — take any one away and it reads as a glow, not glass.
    const L = uSunDir
    const backDir = normalize(L.add(N.mul(0.32)))
    const through = pow(saturate(V.dot(negate(backDir))), float(2.4))
    // Wave-scale face, not the capillary normal: light transmits through the
    // body of a crest, and a ripple on its flank is not a thickness. Range is
    // the measured one — 1 - Nwave.y runs 0.002 median to 0.011 at the 99th.
    const steepFace = smoothstep(float(0.0015), float(0.008), float(1).sub(Nwave.y))
    const lowSun = oneMinus(smoothstep(float(0.02), float(0.72), L.y))
    const thickness = crest.mul(float(0.35).add(thin.mul(0.65))).mul(steepFace)
    const sss = through.mul(thickness).mul(float(0.5).add(lowSun.mul(1.6))).mul(shadeFade)
    // Daylight scatter is the crest colour driven hard; a low sun drags it warm.
    const sssTint = mix(
      uCrestColor.mul(2.6).add(vec3(0.02, 0.12, 0.09)),
      uSunColor.mul(vec3(1.0, 0.62, 0.3)).mul(1.6).add(uCrestColor),
      lowSun
    )
    col.addAssign(sssTint.mul(sss).mul(1.25))
    // Wrap term: even a high sun bleeds a little light through a crest edge.
    col.addAssign(
      uCrestColor.mul(uSunColor).mul(crest.mul(thin).mul(saturate(L.y)).mul(0.35)).mul(shadeFade)
    )

    // ---- specular: a slope distribution, not a shininess ------------------
    //
    // Beckmann over the unresolved slope variance. Near the boat sigma2 is
    // small and this is a tight sun glint; at the horizon sigma2 has absorbed
    // the whole short end of the spectrum and it broadens into the smooth glare
    // band a real sea shows — with no noise left to alias.
    const specLobe = (dir) => {
      const H = normalize(dir.add(V))
      const NdH = max(N.dot(H), float(1e-3))
      const c2 = NdH.mul(NdH)
      const tan2 = float(1).sub(c2).div(c2)
      const d = exp(negate(tan2).div(sigma2)).div(sigma2.mul(Math.PI).mul(c2).mul(c2))
      // Smith-ish masking; without it grazing angles fire off arbitrarily.
      return min(d.mul(saturate(dir.dot(N))).div(NdV.mul(4).add(0.05)), float(24))
    }
    const sunUp = smoothstep(float(-0.07), float(0.10), uSunDir.y)
    col.addAssign(uSunColor.mul(specLobe(uSunDir)).mul(fresnel).mul(sunUp).mul(1.5))
    const moonTint = vec3(0.66, 0.76, 0.95)
    col.addAssign(
      moonTint
        .mul(specLobe(uMoonDir))
        .mul(fresnel)
        .mul(smoothstep(float(-0.05), float(0.10), uMoonDir.y))
        .mul(uMoonBright)
        .mul(0.5)
    )

    // ---- whitecaps --------------------------------------------------------
    //
    // Coverage is the Jacobian: below 1 the trochoidal map is compressing water
    // into a crest, below 0 it has folded through itself and the crest has
    // broken. Unioning the value from a moment ago leaves foam trailing behind
    // the crest that threw it rather than blinking with it.
    // Thresholds sit where the distribution measured above actually is: a calm
    // sea whitecaps on roughly its steepest 3%, a gale on a third of itself.
    //
    // The storm offset is large because whitecap coverage is extremely
    // non-linear in wind: Monahan's relation goes as U^3.4, so a force-5 sea
    // whitecaps on about 1% of its area and a force-9 gale on about 20% — a
    // twentyfold change over a range the eye reads as "windy" to "very windy".
    // A modest threshold nudge produces a gale that measures 1.4x a calm day,
    // which is what this was doing, and which is why storms looked placid.
    // Against the measured fold distribution (1% at 0.68, 25% at 0.89, median
    // 0.99) a full-storm threshold of 1.21 puts most of the sea somewhere on
    // the ramp, and the gust mask below is what keeps that from being uniform.
    const breakThresh = float(0.792).add(storm.mul(0.42))
    const breakWidth = float(0.15).add(storm.mul(0.14))
    const breaking = oneMinus(smoothstep(breakThresh.sub(breakWidth), breakThresh, fold))
    const trailing = oneMinus(
      smoothstep(breakThresh.sub(breakWidth), breakThresh.sub(0.02), foldOld)
    ).mul(0.55)
    // Shoreline surf. Not a constant ring: it is waves *breaking on the shore*,
    // so it surges with the crest arriving and drains back in the trough.
    const surf = oneMinus(smoothstep(float(0), float(26), shoreGap)).mul(
      smoothstep(float(0.18), float(0.72), crest).mul(0.62).add(0.38)
    )
    // How new this foam is. A cap that is breaking right now is dense, opaque
    // and white; what is left of one a second later is thin, holed and mostly
    // the water's colour showing through. Without that distinction the whole
    // field renders at one flat alpha, which is what a stipple looks like.
    //
    // Surf counts as fresh, and that inclusion is the fix for a real defect:
    // the dissipation noise further down only spares foam that is fresh, so
    // shore surf — which was never marked fresh — came out as solid white
    // eroded into a grid of round holes. From a quay a metre above it that read
    // as a bed of pearls, and it was the brightest thing in a night storm.
    const fresh = saturate(max(breaking.sub(trailing.mul(0.55)).mul(1.7), surf))
    let cover = max(breaking, trailing)
      // Wave-scale steepness, not the detail-band normal — capillary chop does
      // not break. 1 - Nwave.y tops out around 0.011 on this spectrum, so this
      // gate leans rather than gates.
      .mul(smoothstep(float(0.002), float(0.009), float(1).sub(Nwave.y)).mul(0.55).add(0.45))
      .mul(smoothstep(float(0.15), float(0.72), crest).mul(0.7).add(0.3))
    // Gusts. Whitecaps do not spread themselves evenly over a sea: they run in
    // streaks down the wind with open water between, because the wind that
    // raises them is itself in streaks. Sampled long along the wind and narrow
    // across it, which is the shape of a real gust front on water.
    const along = xz.dot(vec2(WIND_X, WIND_Z))
    const across = xz.dot(vec2(-WIND_Z, WIND_X))
    const gust = texture(
      foamTex,
      vec2(along.mul(0.0012).sub(uTime.mul(0.0032)), across.mul(0.0052))
    ).z
    // The gaps between gusts fill in as it blows harder — at force 9 there is no
    // unbroken water left, only more and less broken.
    cover = cover.mul(
      mix(float(0.1).add(storm.mul(0.45)), float(1.5), smoothstep(float(0.36), float(0.7), gust))
    )
    const capCover = cover
    // Surf and the collar around a hull are foam too, and they are foam
    // wherever the water happens to be — not only on a breaking crest.
    cover = saturate(max(cover, max(surf.mul(0.62), hullNear.mul(0.45))))

    // Threshold a texture with the coverage rather than tinting one: erosion is
    // what makes a foam edge look like bubbles instead of an alpha ramp.
    //
    // Sampled in **wind space**, stretched about 3-4x along the wind. Foam on a
    // real sea is not isotropic: bubbles are gathered into long downwind
    // streaks (Langmuir circulation makes literal windrows, and a breaking
    // crest leaves a trail rather than a spot). Sampling this in world XZ gives
    // round blobs of one size, which is most of what makes a foam field read as
    // a stipple rather than as foam.
    const drift = uTime.mul(1.1)
    const wa = along.sub(drift)
    const fa = texture(foamTex, vec2(wa.mul(0.034), across.mul(0.125)))
    const fb = texture(foamTex, vec2(wa.mul(0.011), across.mul(0.044)).add(vec2(0.37, 0.11)))
    const fc = texture(foamTex, vec2(wa.mul(0.15), across.mul(0.44)).add(vec2(0.71, 0.53)))
    // Weighted-averaging decorrelated noise pulls hard toward 0.5, and a
    // threshold sweeping a distribution that narrow snaps from bare water to
    // full cover over a few percent of coverage. Stretch it back out.
    const pattern = fa.x
      .mul(0.42)
      .add(fb.y.mul(0.34))
      .add(fc.w.mul(0.24))
      .sub(0.5)
      .mul(1.7)
      .add(0.5)
    // Where to cut it. `1 - cover` looks like the obvious threshold and is not:
    // the pattern above is a weighted mix of three decorrelated noises and,
    // measured off a debug shot, essentially all of its mass lands inside
    // [0.12, 0.88]. A threshold sweeping [0, 1] therefore spends its whole top
    // half above anything the pattern ever reaches — coverage under about 0.12
    // renders literally nothing, and everything above it arrives in a rush.
    // That is why a calm sea and a full gale looked equally foamy: both were
    // riding the same narrow usable slice.
    //
    // Mapping the cut across the range the pattern actually occupies makes foam
    // *area* track coverage over the whole range. The `pow` biases the travel
    // toward the low end, where every calm-weather frame lives.
    const edge = mix(float(0.90), float(0.06), pow(cover, float(0.9)))
    let foam = smoothstep(edge.sub(0.06), edge.add(0.26), pattern)
    // Dissipation. Old foam is filaments and holes, so a second finer noise
    // eats into it — but only where the cap is no longer fresh, or breaking
    // crests would come out moth-eaten too.
    foam = foam.mul(mix(smoothstep(float(0.18), float(0.72), fc.z), float(1), fresh))
    // Individual caps go sub-pixel long before the sea does. Converge on a
    // dimmed mean rather than carrying full-strength speckle to the horizon.
    foam = mix(cover.mul(cover).mul(0.45), foam, foamFade).mul(shadeFade)
    foam = saturate(foam)

    // Foam is a bright diffuse solid sitting on the water, not an emissive
    // wash: it takes sun and sky like snow, and it is dark on its shaded side.
    let foamLight = uSunColor
      .mul(saturate(N.dot(uSunDir)).mul(0.55).add(0.12))
      .mul(sunUp)
      .add(uSkyColor.mul(0.42))
      .add(uCrestColor.mul(0.22))
    // Under a storm the sky and crest colours this is built from are a strongly
    // tinted twilight violet, and foam duly came out lilac. Foam is a dense
    // scatterer — it is close to neutral under almost any illuminant, and a
    // field of violet whitecaps is one of the loudest tells that the water is
    // being tinted rather than lit.
    const flLum = foamLight.dot(vec3(0.3, 0.59, 0.11))
    foamLight = mix(foamLight, vec3(flLum.mul(0.97), flLum, flLum.mul(0.99)), storm.mul(0.8))
    // Thin foam is water with bubbles in it and takes the sea's colour; only a
    // thick fresh cap is actually white. One colour for both is the "dotty"
    // look — a field of identical white pixels.
    const foamCol = mix(
      uFoamColor.mul(foamLight).mul(0.6).add(body.mul(0.4)),
      uFoamColor.mul(foamLight),
      saturate(fresh.mul(0.65).add(foam.mul(0.35)))
    ).mul(float(1).sub(storm.mul(0.16)))
    // Bubbles trapped under the surface, not on it — the fringe of a whitecap
    // is water with foam in it before it is foam.
    const subFoam = mix(col, foamCol.mul(0.55).add(body.mul(0.45)), saturate(foam.mul(1.6)).mul(0.5))
    col.assign(mix(subFoam, foamCol, foam.mul(foam)))

    if (DEBUG === 'foam') return vec3(foam)
    if (DEBUG === 'cover') return vec3(cover)
    if (DEBUG === 'break') return vec3(breaking)
    if (DEBUG === 'storm') return vec3(storm)
    // R = surf band (0-26 m), G = shoaling ramp, B = hull collar.
    if (DEBUG === 'shore') return vec3(surf, shoal, hullNear)
    // R = breaking crests, G = shoreline surf, B = hull collar. One shot says
    // which of the three is painting the sea, which is otherwise a guess.
    if (DEBUG === 'split') return vec3(capCover, surf, hullNear)
    if (DEBUG === 'fold') return vec3(fold)
    if (DEBUG === 'pattern') return vec3(pattern)
    if (DEBUG === 'spec') return uSunColor.mul(specLobe(uSunDir)).mul(fresnel).mul(sunUp).mul(1.5)

    // ---- searchlight ------------------------------------------------------
    const toLight = uSearchPos.sub(wp)
    const sDist = length(toLight)
    const SL = toLight.div(max(sDist, float(0.05)))
    const beamNoise = texture(foamTex, wp.xz.mul(0.0047).add(vec2(13.7, 4.1))).w
    const raggedOuter = uSearchCosOuter.add(beamNoise.sub(0.5).mul(0.004))
    const cone = smoothstep(raggedOuter, uSearchCosInner, negate(SL).dot(uSearchDir))
    const mask = cone
      .mul(float(1).sub(smoothstep(uSearchRange.mul(0.4), uSearchRange, sDist)))
      .mul(float(1).div(float(1).add(sDist.mul(float(2.2).div(max(uSearchRange, float(1)))))))
      .mul(uSearchIntensity)
      .mul(smoothstep(float(0.05), float(0.5), sDist))
    col.addAssign(uSearchColor.mul(specLobe(SL)).mul(mask).mul(mix(float(0.6), float(1.6), fresnel)).mul(2.2))
    col.addAssign(uSearchColor.mul(mask).mul(foam).mul(0.35))

    return col
  })()

  material.userData.oceanUniforms = {
    uTime,
    uSunDir,
    uSunColor,
    uMoonDir,
    uMoonBright,
    uDeepColor,
    uCrestColor,
    uSkyColor,
    uZenithColor,
    uCloudColor,
    uCloudLit,
    uCloudCover,
    uFoamColor,
    uShallowColor,
    uSearchPos,
    uSearchDir,
    uSearchColor,
    uSearchIntensity,
    uSearchRange,
    uSearchCosOuter,
    uSearchCosInner,
    uRainRipple,
    uSeaState,
    uWaterNormalStrength,
    uShoreA,
    uShoreB,
    uFloaters,
    fogColor: fogColorU
  }
  material.uniforms = material.userData.oceanUniforms
  material.userData.shoreTexture = shore

  return material
}

const OCEAN_RADIUS = 24000
const INNER_RADIUS = 3.5
const RINGS = 200
const SEGMENTS = 240
// Recentring the disc every frame makes each vertex sample a different world
// point each frame, which shimmers. Snapping the centre holds them still.
const CENTER_SNAP = 4

/**
 * Camera-centred radial disc: rings spaced geometrically out from the middle,
 * so the tessellation is metres-fine around the hull and hundreds of metres
 * wide at the horizon without paying for a uniform grid at either.
 */
function buildDiscGeometry() {
  const positions = [0, 0, 0]
  const growth = Math.pow(OCEAN_RADIUS / INNER_RADIUS, 1 / RINGS)
  const radii = []
  for (let i = 0; i <= RINGS; i++) radii.push(INNER_RADIUS * Math.pow(growth, i))
  for (const r of radii) {
    for (let s = 0; s < SEGMENTS; s++) {
      const a = (s / SEGMENTS) * Math.PI * 2
      positions.push(Math.cos(a) * r, 0, Math.sin(a) * r)
    }
  }
  // Winding matters: seen from above, increasing angle runs clockwise in XZ, so
  // the naive order puts the water's back face upward and the whole sea
  // vanishes except a sliver at the horizon. Emit reversed.
  const indices = []
  for (let s = 0; s < SEGMENTS; s++) {
    indices.push(0, 1 + ((s + 1) % SEGMENTS), 1 + s)
  }
  for (let i = 0; i < RINGS; i++) {
    const a = 1 + i * SEGMENTS
    const b = 1 + (i + 1) * SEGMENTS
    for (let s = 0; s < SEGMENTS; s++) {
      const n = (s + 1) % SEGMENTS
      indices.push(a + s, b + n, b + s)
      indices.push(a + s, a + n, b + n)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  // Displacement happens in the vertex shader, so CPU-side bounds are flat.
  geometry.boundingSphere = new Sphere(new Vector3(), OCEAN_RADIUS + SEA_MAX_AMPLITUDE)
  return geometry
}

/** Farthest a coastline can be and still put foam on screen worth uploading. */
const SHORE_RANGE = 4200
/** Same, for hulls. Their collar is small and close. */
const FLOAT_RANGE = 900

/** Camera-centred ocean disc with the node-material water above. */
export function createOcean(opts = {}) {
  const material = createOceanNodeMaterial(opts)
  const mesh = new Mesh(buildDiscGeometry(), material)
  mesh.name = 'ocean'
  mesh.frustumCulled = false
  mesh.receiveShadow = false
  mesh.renderOrder = -1

  const u = material.userData.oceanUniforms
  const shore = material.userData.shoreTexture
  let explicitFloaters = null

  /**
   * Feed the surface the hulls it should react to, as
   * `[{ x, z, radius, strength }]`. Optional: `update()` sweeps the scene for
   * anything that looks like a vessel if nobody calls this.
   */
  mesh.setFloaters = (list) => {
    explicitFloaters = Array.isArray(list) ? list : null
  }

  /** Same, for coastlines: `[{ x, z, bins: Float32Array, maxR }]`. */
  mesh.setShores = (list) => {
    writeShores(Array.isArray(list) ? list : [])
  }

  function writeShores(list) {
    const slots = [u.uShoreA, u.uShoreB]
    for (let i = 0; i < slots.length; i++) {
      const s = list[i]
      if (!s) {
        slots[i].value.set(0, 0, 1, 0)
        continue
      }
      slots[i].value.set(s.x, s.z, s.maxR, 1)
      const row = i * SHORE_BINS * 4
      for (let b = 0; b < SHORE_BINS; b++) {
        shore.data[row + b * 4] = Math.round((s.bins[b] / (s.norm ?? s.maxR)) * 255)
      }
    }
    shore.tex.needsUpdate = true
  }

  const _shoreScratch = []
  const _floatScratch = []
  const _box = new Box3()
  const _size = new Vector3()

  /**
   * Sweep the scene for coastlines and hulls.
   *
   * Nothing hands the ocean the world, and the depth buffer is not available to
   * a pass that draws before the islands do — so the surface finds what it has
   * to react to by looking at what is in the scene with it. Island coastlines
   * come off their own vertices (cached per geometry); vessels are recognised
   * by the render-side rigging every ship group carries.
   */
  function sweepScene(camera) {
    const scene = mesh.parent
    if (!scene) return
    _shoreScratch.length = 0
    _floatScratch.length = 0
    const cx = camera.position.x
    const cz = camera.position.z
    for (const child of scene.children) {
      if (!child.visible) continue
      const dx = child.position.x - cx
      const dz = child.position.z - cz
      const d2 = dx * dx + dz * dz
      if (child.userData?.kind === 'island') {
        if (d2 > SHORE_RANGE * SHORE_RANGE || !child.geometry) continue
        const table = shoreTableFor(child.geometry)
        // Geometry radii are local; an island placed with a scale would put its
        // surf ring in open water.
        const sc = child.scale.x || 1
        _shoreScratch.push({
          x: child.position.x,
          z: child.position.z,
          bins: table.bins,
          norm: table.maxR,
          maxR: table.maxR * sc,
          d2
        })
      } else if (
        child.userData?.turret ||
        child.userData?.runningLights ||
        child.userData?.premiumHull !== undefined
      ) {
        if (d2 > FLOAT_RANGE * FLOAT_RANGE) continue
        let radius = child.userData.oceanFoamRadius
        if (radius === undefined) {
          // Roughly a half-beam — the collar is a disc, and one sized off the
          // longest axis swells and shrinks as the boat turns under it.
          // Measured once per vessel and cached; Box3 over a whole ship group
          // is not a per-frame cost.
          _box.setFromObject(child)
          _box.getSize(_size)
          // Two things make this a heuristic rather than a measurement, and
          // both err *large* — hence the coefficient well under a half, and the
          // cap:
          //
          //  - Box3 is axis-aligned in **world** space, so a hull on a diagonal
          //    heading reports `min(x, z)` of about 0.7x its *length*, not its
          //    beam. Measured on the `open` preset: two 44 m boats came back
          //    with 24 m "beams".
          //  - A ship group is not only its hull. Masts, rigging and
          //    running-light glows all land in the same box.
          //
          // The collar reaches a multiple of this radius, so an over-read
          // throws a disc of foam tens of metres across open water — which is
          // what it was doing, and which was the actual cause of the "sea
          // covered edge to edge in whitecaps" defect. The Jacobian whitecaps
          // were never the problem; a `vec3(breaking, surf, hullNear)` debug
          // split showed the near field solid blue and the crests sparse.
          //
          // ponytail: heuristic, not a beam. A hull wanting an exact collar can
          // publish `userData.oceanFoamRadius` itself — this respects it.
          radius = Math.min(9, Math.max(1.5, Math.min(_size.x, _size.z) * 0.35))
          child.userData.oceanFoamRadius = radius
        }
        _floatScratch.push({ x: child.position.x, z: child.position.z, radius, strength: 1, d2 })
      }
    }
    _shoreScratch.sort((a, b) => a.d2 - b.d2)
    writeShores(_shoreScratch)
    const floats = explicitFloaters ?? _floatScratch.sort((a, b) => a.d2 - b.d2)
    for (let i = 0; i < u.uFloaters.length; i++) {
      const f = floats[i]
      if (f) u.uFloaters[i].value.set(f.x, f.z, f.radius ?? 6, f.strength ?? 1)
      // Radius 1, not 0: an empty slot still evaluates smoothstep(r*0.9, r*3, d),
      // and a zero radius makes that a divide by zero. NaN * 0 is NaN, so a
      // parked slot would poison every pixel it touched.
      else u.uFloaters[i].value.set(0, 0, 1, 0)
    }
  }

  mesh.update = (camera, t) => {
    u.uTime.value = t
    // Nobody drives sea state directly yet; the weather already drives rain, and
    // a squall that pockmarks the water is a squall that whitecaps it.
    u.uSeaState.value = u.uRainRipple.value
    mesh.position.set(
      Math.round(camera.position.x / CENTER_SNAP) * CENTER_SNAP,
      0,
      Math.round(camera.position.z / CENTER_SNAP) * CENTER_SNAP
    )
    sweepScene(camera)
  }

  mesh.setSearchlight = (state) => {
    if (!state || !(state.intensity > 0)) {
      u.uSearchIntensity.value = 0
      return
    }
    u.uSearchPos.value.copy(state.position)
    u.uSearchDir.value.copy(state.direction).normalize()
    u.uSearchIntensity.value = state.intensity
    if (state.range != null) u.uSearchRange.value = state.range
    if (state.color != null) {
      if (state.color.isColor) u.uSearchColor.value.copy(state.color)
      else u.uSearchColor.value.set(state.color)
    }
    if (state.angle != null) {
      u.uSearchCosOuter.value = Math.cos(state.angle + (state.penumbra ?? 0.4) * state.angle)
      u.uSearchCosInner.value = Math.cos(state.angle * 0.55)
    }
  }

  return mesh
}
