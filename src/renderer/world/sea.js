/**
 * The sea surface — the single source of truth for wave height.
 *
 * Both the buoyancy maths here and the ocean vertex shader in
 * `render/oceanMesh.js` derive from `SEA_WAVES`; the shader builds its GLSL
 * from this same array. If the two ever disagree, boats float above or sink
 * into the visible water, so nothing else in the codebase may define waves.
 */

export const SEA_LEVEL = 0

/**
 * Directional swell components, summed. `len` is crest-to-crest distance in
 * world units, `speed` is crest travel in units/sec, `dir` is the heading the
 * wave travels along (normalized on load). Long low swell first, short chop
 * last — the mix is what stops the surface reading as one repeating sine.
 */
export const SEA_WAVES = [
  { amp: 1.05, len: 310, speed: 15, dir: [1.0, 0.22], sharp: 0.30 },
  { amp: 0.72, len: 210, speed: 13, dir: [-0.62, 0.78], sharp: 0.28 },
  { amp: 0.55, len: 165, speed: 11.5, dir: [0.72, -0.7], sharp: 0.26 },
  { amp: 0.38, len: 118, speed: 9.5, dir: [0.18, 0.98], sharp: 0.24 },
  { amp: 0.30, len: 82, speed: 8.5, dir: [-0.35, 0.94], sharp: 0.20 },
  { amp: 0.22, len: 54, speed: 7.2, dir: [-0.88, -0.47], sharp: 0.18 },
  { amp: 0.16, len: 36, speed: 6.2, dir: [0.55, 0.84], sharp: 0.15 },
  { amp: 0.11, len: 22, speed: 5.2, dir: [0.93, -0.37], sharp: 0.12 }
]

/** Tallest possible crest — used for camera/cull margins, not per-frame maths. */
export const SEA_MAX_AMPLITUDE = SEA_WAVES.reduce((sum, w) => sum + w.amp, 0)

// Precomputed per wave: unit direction, angular wavenumber k, and phase rate.
const COMPILED = SEA_WAVES.flatMap(({ amp, len, speed, dir, sharp = 0 }) => {
  const mag = Math.hypot(dir[0], dir[1]) || 1
  const k = (Math.PI * 2) / len
  // A restrained second harmonic makes crests stand up and troughs broaden,
  // avoiding the endless perfect sine rolls that read as a simulation. The
  // normalization keeps the total possible height inside SEA_MAX_AMPLITUDE.
  const baseAmp = amp / (1 + sharp * 0.5)
  const common = { dx: dir[0] / mag, dz: dir[1] / mag }
  return [
    { amp: baseAmp, k, phaseRate: speed * k, ...common },
    ...(sharp > 0
      ? [{ amp: baseAmp * sharp * 0.5, k: k * 2, phaseRate: speed * k * 2, ...common }]
      : [])
  ]
})

/** Surface height at a world XZ position and time. */
export function waveHeight(x, z, t) {
  let h = SEA_LEVEL
  for (const w of COMPILED) {
    h += w.amp * Math.sin((w.dx * x + w.dz * z) * w.k - t * w.phaseRate)
  }
  return h
}

const _normal = { x: 0, y: 1, z: 0 }

/**
 * Unit surface normal at a world XZ position, from the analytic slope.
 * Returns a shared object — copy it if you need to hold on to the value.
 */
export function waveNormal(x, z, t, out = _normal) {
  let dhdx = 0
  let dhdz = 0
  for (const w of COMPILED) {
    // d/dx of amp*sin(phase) is amp*k*dirX*cos(phase); same for z.
    const slope = w.amp * w.k * Math.cos((w.dx * x + w.dz * z) * w.k - t * w.phaseRate)
    dhdx += slope * w.dx
    dhdz += slope * w.dz
  }
  const len = Math.hypot(dhdx, 1, dhdz)
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

/** GLSL float literal — always with a decimal point, or the shader won't compile. */
function glslFloat(n) {
  const s = Number(n).toPrecision(9)
  return s.includes('.') || s.includes('e') ? s : `${s}.0`
}

/**
 * The same waves as GLSL, unrolled from `SEA_WAVES`. The ocean shader includes
 * this rather than hardcoding anything, so the visible surface and `waveHeight`
 * are mathematically the same function — which is the only way boats stay
 * sitting on the water instead of hovering over it.
 *
 * Provides `seaHeight(vec2 worldXZ, float t)` and `seaNormal(vec2 worldXZ, float t)`.
 */
export function seaShaderChunk() {
  const heights = COMPILED.map(
    (w) =>
      `  h += ${glslFloat(w.amp)} * sin((${glslFloat(w.dx)} * p.x + ${glslFloat(w.dz)} * p.y) * ${glslFloat(w.k)} - t * ${glslFloat(w.phaseRate)});`
  ).join('\n')
  const slopes = COMPILED.map(
    (w) =>
      `  s = ${glslFloat(w.amp * w.k)} * cos((${glslFloat(w.dx)} * p.x + ${glslFloat(w.dz)} * p.y) * ${glslFloat(w.k)} - t * ${glslFloat(w.phaseRate)});\n` +
      `  d += vec2(s * ${glslFloat(w.dx)}, s * ${glslFloat(w.dz)});`
  ).join('\n')
  return `
float seaHeight(vec2 p, float t) {
  float h = ${glslFloat(SEA_LEVEL)};
${heights}
  return h;
}

vec3 seaNormal(vec2 p, float t) {
  vec2 d = vec2(0.0);
  float s;
${slopes}
  return normalize(vec3(-d.x, 1.0, -d.y));
}
`
}
