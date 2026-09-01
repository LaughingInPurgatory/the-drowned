/**
 * Clean-slate Ocean Physics & Buoyancy Model
 *
 * Single authoritative source of truth for ocean wave height, attitude,
 * and dispersion across CPU buoyancy physics and WebGPU NodeMaterial rendering.
 */

export const SEA_LEVEL = 0

/** Gravity constant for deep-water dispersion: omega = sqrt(g * k) * SEA_TIME_SCALE */
const G = 9.81

/** Prevailing wind bearing in radians (0 = +Z). Waves fan around this bearing. */
export const WIND_BEARING = 0.42

/** Global time rate multiplier for realistic, active ocean wave speed. */
export const SEA_TIME_SCALE = 1.75

/**
 * 5-Band Harmonic Ocean Wave Spectrum:
 * Combines distant deep swell, cross swell, prevailing wind seas, and surface chop.
 */
export const SEA_WAVES = [
  { len: 175, amp: 0.60, spread: 0.04, q: 0.65 },   // Primary ocean swell
  { len: 115, amp: 0.42, spread: -0.38, q: 0.60 },  // Secondary cross-swell
  { len: 72,  amp: 0.28, spread: 0.18, q: 0.55 },   // Prevailing wind sea
  { len: 40,  amp: 0.18, spread: -0.25, q: 0.50 },  // Rolling chop
  { len: 20,  amp: 0.10, spread: 0.45, q: 0.45 }   // Surface undulation
]

/** Maximum possible wave crest peak above sea level (raw spectrum sum). */
export const SEA_MAX_AMPLITUDE = SEA_WAVES.reduce((sum, w) => sum + w.amp, 0)

/**
 * Crest sharpening — how much the peaks pull up into sharp ridges above the
 * raw sine sum. A real sea is asymmetric: crests stand up and troughs lie
 * long and flat, and no amount of shading rescues a pure sine field (round
 * crests read as a cloth). Applied to the *same* function on the CPU
 * (buoyancy + visible surface) and the GPU vertex stage so hulls and wake sit
 * exactly on the crests you can see.
 *
 * The transform is `h + k*A*c(c)` with c = clamp(h/A, 0, 1): below sea level
 * nothing changes, at a crest the peak rises toward (1+k)*A, and the
 * zero-crossings are lifted a little — which is exactly the trough-wide /
 * crest-narrow asymmetry a sine sum lacks.
 */
export const CREST_SHARPEN = 0.55

/** Tallest possible *sharpened* crest above sea level. */
export const SEA_MAX_CREST = SEA_MAX_AMPLITUDE * (1 + CREST_SHARPEN)

/** Crest-sharpen a raw height. `A` is the normaliser (SEA_MAX_AMPLITUDE). */
export function crestSharpen(h, A = SEA_MAX_AMPLITUDE) {
  const c = Math.min(1, Math.max(0, h / A))
  return h + CREST_SHARPEN * A * c * c
}

/** d/dh of crestSharpen — the factor the raw surface gradient is scaled by. */
export function crestSharpenDeriv(h, A = SEA_MAX_AMPLITUDE) {
  if (h <= 0) return 1
  const c = Math.min(1, h / A)
  return 1 + 2 * CREST_SHARPEN * c
}

/** Short chop buoyancy attenuation thresholds (metres). */
const BUOYANCY_LEN_LO = 20
const BUOYANCY_LEN_HI = 45

function buoyancyWeight(len) {
  if (len >= BUOYANCY_LEN_HI) return 1
  if (len <= BUOYANCY_LEN_LO) return 0.15
  return 0.15 + (0.85 * (len - BUOYANCY_LEN_LO)) / (BUOYANCY_LEN_HI - BUOYANCY_LEN_LO)
}

/** Precompiled wave parameters shared between CPU buoyancy and WebGPU shader. */
export const SEA_COMPILED = (() => {
  return SEA_WAVES.map(({ len, amp, spread, q }) => {
    const bearing = WIND_BEARING + spread
    const k = (Math.PI * 2) / len
    const dx = Math.sin(bearing)
    const dz = Math.cos(bearing)
    const omega = Math.sqrt(G * k) * SEA_TIME_SCALE
    const bw = buoyancyWeight(len)
    return {
      len,
      amp,
      k,
      dx,
      dz,
      omega,
      q,
      ak: amp * k,
      bw,
      bAmp: amp * bw
    }
  })
})()

/**
 * Shader-only capillary micro-normal band. Contributes slope only (never height),
 * enhancing fine liquid surface facets without moving hulls.
 */
export const SEA_DETAIL_SLOPE = [
  { len: 5.2, slope: 0.045, spread: 0.60 },
  { len: 2.4, slope: 0.030, spread: -1.20 }
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

const _param = { x: 0, z: 0 }
export function seaParamAt(x, z, t = 0, out = _param) {
  out.x = x
  out.z = z
  return out
}

/**
 * Visible surface elevation — the full shared spectrum, crest-sharpened,
 * exactly what the ocean shader's vertex stage displaces. `waveHeight` fades
 * short chop for hull buoyancy; render-side water riders (wake, spray,
 * floating structures) must sample this instead so they sit on the water you
 * can see.
 */
export function waveHeightVisible(x, z, t = 0) {
  let h = SEA_LEVEL
  for (const w of SEA_COMPILED) {
    h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.k - t * w.omega)
  }
  return crestSharpen(h)
}

const _surface = { x: 0, y: 0, z: 0 }
export function seaSurfaceAtParam(px, pz, t = 0, out = _surface) {
  out.x = px
  out.y = waveHeightVisible(px, pz, t)
  out.z = pz
  return out
}

/**
 * Evaluates the exact surface elevation at world coordinate (x, z) at time t.
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} t - Sim time (seconds)
 * @returns {number} Surface height Y
 */
export function waveHeight(x, z, t = 0) {
  let h = SEA_LEVEL
  for (const w of SEA_COMPILED) {
    h += w.bAmp * Math.sin((w.dx * x + w.dz * z) * w.k - t * w.omega)
  }
  return crestSharpen(h)
}

const _normal = { x: 0, y: 1, z: 0 }

/**
 * Evaluates the unit surface normal vector at world coordinate (x, z) at time t.
 * @param {number} x - World X position
 * @param {number} z - World Z position
 * @param {number} t - Sim time (seconds)
 * @param {{x: number, y: number, z: number}} [out] - Output normal object
 * @returns {{x: number, y: number, z: number}} Unit normal
 */
export function waveNormal(x, z, t = 0, out = _normal) {
  let h = SEA_LEVEL
  let dhdx = 0
  let dhdz = 0
  for (const w of SEA_COMPILED) {
    const ph = (w.dx * x + w.dz * z) * w.k - t * w.omega
    const c = Math.cos(ph)
    h += w.bAmp * Math.sin(ph)
    const ak = w.bAmp * w.k
    dhdx += ak * w.dx * c
    dhdz += ak * w.dz * c
  }
  // The hull rides the crest-sharpened surface, so its attitude must be the
  // derivative of that same function — otherwise boats lean wrong on the very
  // crests the sharpening creates.
  const m = crestSharpenDeriv(h)
  dhdx *= m
  dhdz *= m
  const len = Math.hypot(dhdx, 1, dhdz) || 1
  out.x = -dhdx / len
  out.y = 1 / len
  out.z = -dhdz / len
  return out
}

/**
 * Positions an entity directly onto the sea surface and zeroes vertical velocity.
 * @param {{ position: number[], velocity?: number[] }} entityState
 * @param {number} t - Sim time (seconds)
 */
export function snapToSea(entityState, t) {
  const pos = entityState.position
  pos[1] = waveHeight(pos[0], pos[2], t)
  const vel = entityState.velocity
  if (vel) vel[1] = 0
}
