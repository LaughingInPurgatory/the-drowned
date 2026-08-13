/**
 * The sea surface — the single source of truth for wave height.
 *
 * Both the buoyancy maths here and the ocean shader in
 * `render/oceanNodeMaterial.js` run off `SEA_COMPILED`, the *same* pre-multiplied
 * table, rather than each deriving one from `SEA_WAVES`. Two derivations is two
 * chances to drift, and drift here means boats float above or sink into the
 * visible water. Nothing else in the codebase may define waves.
 *
 * There is one deliberate split, and only one. `SEA_COMPILED` is the **shared
 * band**: every component in it displaces water on both the CPU and the GPU, so
 * hulls sit exactly on the surface you can see. `SEA_DETAIL_SLOPE` is a
 * **shader-only band** of capillary chop that contributes *slope only* — no
 * height, ever. It sharpens normals and feeds whitecap breakup at close range
 * and costs the CPU nothing, and because it displaces nothing it cannot move a
 * hull by so much as a millimetre. If you are tempted to give it an amplitude,
 * put the component in `SEA_WAVES` instead and pay for it on both sides.
 *
 * The field is **trochoidal (Gerstner)**, not a sum of sines. Each component
 * moves its water in a circle rather than up and down, which pulls the surface
 * toward the crests: peaks stand up sharp and troughs go long and flat. That
 * asymmetry is most of what separates "water" from "a shaded height field" —
 * no amount of shading rescues a pure sine sum, because sine crests are as
 * round as sine troughs and the eye reads that instantly as a cloth.
 *
 * The cost of trochoids is that the surface is a *parametric* one. A vertex
 * carries a parameter `p` and lands at `p + horizontal displacement`, so asking
 * "how high is the water at world XZ" means inverting that displacement first
 * (`seaParamAt`). The inversion is a short fixed-point loop and converges
 * because total steepness is held below 1 (see SEA_STEEPNESS).
 */

export const SEA_LEVEL = 0

/** Gravity, for the deep-water dispersion relation c = sqrt(gL / 2pi). */
const G = 9.81

/**
 * Mean wind bearing in radians (0 = +Z). The whole spectrum fans out around it,
 * so the sea has a prevailing direction the way a real one does — but no two
 * components share a bearing, which is what stops crests marching in step and
 * forming the corduroy rows a handful of summed sines always give you.
 */
export const WIND_BEARING = 0.42

/**
 * Total trochoidal steepness, summed over the spectrum. 1.0 is the point where
 * the surface folds through itself (the classic Gerstner loop); real breaking
 * happens well before that. This is the sharpness knob for the whole sea, and
 * it also sets how fast the parameter inversion below converges.
 *
 * ~0.68 keeps open-ocean crests without making hull attitude twitchy. Higher
 * and short-chop slopes dominate single-point sampling on every boat.
 */
export const SEA_STEEPNESS = 0.68

/** Fixed-point steps used to invert the horizontal displacement. */
const PARAM_ITERATIONS = 6

/** Global rate multiplier — a tuning knob, not physics. 1 is true dispersion. */
const SEA_TIME_SCALE = 1

/**
 * Hulls sample one point for height + attitude. Wavelengths shorter than a
 * working boat's beam make that sample jump around every frame — the visual
 * sea still gets the full spectrum via `seaDisplaceAtParam`, but buoyancy and
 * the one-shot `seaHeight`/`seaNormal` helpers fade short components so boats
 * ride the swell instead of twitching on every capillary.
 *
 * Full strength at/above HI; residual floor at/below LO (keeps a little life).
 */
const BUOYANCY_LEN_LO = 22
const BUOYANCY_LEN_HI = 48

function buoyancyWeight(len) {
  if (len >= BUOYANCY_LEN_HI) return 1
  if (len <= BUOYANCY_LEN_LO) return 0.12
  return 0.12 + (0.88 * (len - BUOYANCY_LEN_LO)) / (BUOYANCY_LEN_HI - BUOYANCY_LEN_LO)
}

/**
 * The wave spectrum: a rough Pierson-Moskowitz shape, eight components from
 * long distant swell down to short chop. Capillary sparkle lives in the
 * shader-only slope band, not here.
 *
 * - `len`    crest-to-crest distance in metres. Speed is *not* listed: deep
 *            water disperses, long waves outrun short ones, and hardcoding a
 *            speed per component is how a wave field ends up looking like a
 *            scrolling texture.
 * - `amp`    vertical half-height in metres.
 * - `spread` bearing offset from the wind, radians. Broad at the short end
 *            (wind chop is nearly isotropic) and narrow at the long end
 *            (swell arrives from where it was made).
 * - `q`      per-component trochoidal weight before normalisation. Short steep
 *            chop gets the sharp treatment; long swell stays rounded.
 *
 * Balance: long swell carries height, mid band carries the visible "sea state"
 * ridges, short end is mostly *shader* normal detail (kept modest so residual
 * buoyancy weight never reintroduces twitch).
 */
export const SEA_WAVES = [
  { len: 430, amp: 0.48, spread: -0.28, q: 0.48 },
  { len: 265, amp: 0.5, spread: 0.49, q: 0.55 },
  { len: 178, amp: 0.52, spread: -0.63, q: 0.62 },
  { len: 118, amp: 0.48, spread: 0.17, q: 0.72 },
  { len: 84, amp: 0.4, spread: -0.87, q: 0.82 },
  { len: 59, amp: 0.32, spread: 0.73, q: 0.9 },
  { len: 41, amp: 0.24, spread: -0.24, q: 0.96 },
  { len: 28, amp: 0.2, spread: 1.12, q: 1.0 }
]

/** Tallest possible crest — used for camera/cull margins, not per-frame maths. */
export const SEA_MAX_AMPLITUDE = SEA_WAVES.reduce((sum, w) => sum + w.amp, 0)

/**
 * Per component: unit bearing, angular wavenumber, angular frequency, and the
 * two amplitude products the maths keeps re-using.
 *
 * `qa` is the horizontal (trochoidal) amplitude. The whole set is scaled so the
 * summed steepness lands on SEA_STEEPNESS regardless of how the table above is
 * edited — a spectrum tweak can then never accidentally fold the surface
 * through itself or stall the inversion.
 */
export const SEA_COMPILED = (() => {
  const base = SEA_WAVES.map(({ len, amp, spread, q }) => {
    const bearing = WIND_BEARING + spread
    const k = (Math.PI * 2) / len
    return {
      len,
      amp,
      k,
      dx: Math.sin(bearing),
      dz: Math.cos(bearing),
      omega: Math.sqrt(G * k) * SEA_TIME_SCALE,
      q
    }
  })
  const raw = base.reduce((s, w) => s + w.q * w.amp * w.k, 0)
  const scale = raw > 0 ? SEA_STEEPNESS / raw : 0
  return base.map((w) => {
    const qa = w.q * w.amp * scale
    const bw = buoyancyWeight(w.len)
    return {
      len: w.len,
      dx: w.dx,
      dz: w.dz,
      k: w.k,
      omega: w.omega,
      amp: w.amp,
      qa,
      // Full-spectrum products for the visible mesh (displace / fold / foam).
      ak: w.amp * w.k,
      qak: qa * w.k,
      // Hull-sampled height + attitude fade short chop (see buoyancyWeight).
      bw,
      bAmp: w.amp * bw,
      bAk: w.amp * w.k * bw,
      bQak: qa * w.k * bw
    }
  })
})()

/**
 * Surface point for a *parameter* position: where the water that started at
 * `p` actually ends up. Returns `{ x, y, z }` in world units.
 */
const _surface = { x: 0, y: 0, z: 0 }
export function seaSurfaceAtParam(px, pz, t = 0, out = _surface) {
  let dx = 0
  let dz = 0
  let h = SEA_LEVEL
  for (const w of SEA_COMPILED) {
    const ph = (w.dx * px + w.dz * pz) * w.k - t * w.omega
    const c = Math.cos(ph)
    dx += w.qa * w.dx * c
    dz += w.qa * w.dz * c
    h += w.amp * Math.sin(ph)
  }
  out.x = px + dx
  out.y = h
  out.z = pz + dz
  return out
}

/**
 * Invert the displacement: the parameter whose water is sitting at world XZ.
 *
 * Plain fixed-point iteration. It contracts at roughly SEA_STEEPNESS per step,
 * so six steps leave a couple of centimetres in the worst case and far less in
 * practice — well under the scale at which a hull looks wrong.
 */
const _param = { x: 0, z: 0 }
export function seaParamAt(x, z, t = 0, out = _param) {
  let px = x
  let pz = z
  for (let i = 0; i < PARAM_ITERATIONS; i++) {
    let dx = 0
    let dz = 0
    for (const w of SEA_COMPILED) {
      const c = Math.cos((w.dx * px + w.dz * pz) * w.k - t * w.omega)
      dx += w.qa * w.dx * c
      dz += w.qa * w.dz * c
    }
    px = x - dx
    pz = z - dz
  }
  out.x = px
  out.z = pz
  return out
}

/**
 * Surface height at a world XZ position and time — **hull sample**.
 *
 * Short chop is faded (see `buoyancyWeight`) so boats ride the swell. The
 * ocean mesh still displaces the full spectrum via `seaDisplaceAtParam`.
 */
export function waveHeight(x, z, t = 0) {
  const p = seaParamAt(x, z, t)
  let h = SEA_LEVEL
  for (const w of SEA_COMPILED) {
    h += w.bAmp * Math.sin((w.dx * p.x + w.dz * p.z) * w.k - t * w.omega)
  }
  return h
}

const _normal = { x: 0, y: 1, z: 0 }

/**
 * Unit surface normal at a world XZ position — **hull attitude sample**.
 *
 * Finite difference of `waveHeight` (already short-chop faded). That is the
 * slope the hull actually rides, and it cannot drift from buoyancy the way a
 * separate analytic path can.
 *
 * Returns a shared object — copy it if you need to hold on to the value.
 */
export function waveNormal(x, z, t = 0, out = _normal) {
  const eps = 0.01
  const dhdx = (waveHeight(x + eps, z, t) - waveHeight(x - eps, z, t)) / (2 * eps)
  const dhdz = (waveHeight(x, z + eps, t) - waveHeight(x, z - eps, t)) / (2 * eps)
  const len = Math.hypot(dhdx, 1, dhdz) || 1
  out.x = -dhdx / len
  out.y = 1 / len
  out.z = -dhdz / len
  return out
}

/**
 * Sit an entity on the water: clamp Y to the surface and kill any vertical
 * velocity that flight/AI integration left behind. Every mover on the sea —
 * player, NPC, drone — goes through this, so nothing can drift off the
 * surface. `entityState.position` / `.velocity` are plain [x,y,z] arrays.
 */
export function snapToSea(entityState, t) {
  const pos = entityState.position
  pos[1] = waveHeight(pos[0], pos[2], t)
  const vel = entityState.velocity
  if (vel) vel[1] = 0
}

/**
 * Shader-only capillary band — **slope, never height**.
 *
 * The shared spectrum above stops at ~6 m because anything shorter is noise to
 * a hull and pure cost to every NPC's buoyancy sample. But a real sea from two
 * metres up is covered in chop that short, and without it the water reads as a
 * smooth shaded height field however good the lighting is.
 *
 * So these components exist on the GPU only, and they add a slope contribution
 * to the surface normal without displacing the surface at all. That is the
 * whole trick: a hull cannot ride a wave that has no height, so this band can
 * be as rich as the frame budget allows and buoyancy stays bit-identical.
 *
 * `slope` is the peak gradient the component contributes (what `amp * k` would
 * have been). Bearings deliberately fan much wider than the swell — capillary
 * chop is close to isotropic, which is what breaks up the directional streaking
 * the long components leave behind.
 */
export const SEA_DETAIL_SLOPE = [
  { len: 6.2, slope: 0.078, spread: 0.95 },
  { len: 2.6, slope: 0.058, spread: -1.9 },
  { len: 1.1, slope: 0.042, spread: 2.35 }
].map(({ len, slope, spread }) => {
  const bearing = WIND_BEARING + spread
  const k = (Math.PI * 2) / len
  return {
    len,
    slope,
    k,
    dx: Math.sin(bearing),
    dz: Math.cos(bearing),
    omega: Math.sqrt(G * k) * SEA_TIME_SCALE
  }
})
