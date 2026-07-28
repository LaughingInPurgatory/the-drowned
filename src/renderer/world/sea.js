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
  { amp: 0.88, len: 260, speed: 14, dir: [1.0, 0.22] },
  { amp: 0.59, len: 187, speed: 12, dir: [-0.62, 0.78] },
  { amp: 0.46, len: 155, speed: 11, dir: [0.72, -0.7] },
  { amp: 0.30, len: 108, speed: 9, dir: [0.18, 0.98] },
  { amp: 0.25, len: 78, speed: 8, dir: [-0.35, 0.94] },
  { amp: 0.18, len: 52, speed: 7, dir: [-0.88, -0.47] },
  { amp: 0.13, len: 34, speed: 6, dir: [0.55, 0.84] },
  { amp: 0.09, len: 21, speed: 5, dir: [0.93, -0.37] }
]

/** Tallest possible crest — used for camera/cull margins, not per-frame maths. */
export const SEA_MAX_AMPLITUDE = SEA_WAVES.reduce((sum, w) => sum + w.amp, 0)

// Precomputed per wave: unit direction, angular wavenumber k, and phase rate.
const COMPILED = SEA_WAVES.map(({ amp, len, speed, dir }) => {
  const mag = Math.hypot(dir[0], dir[1]) || 1
  const k = (Math.PI * 2) / len
  return { amp, k, dx: dir[0] / mag, dz: dir[1] / mag, phaseRate: speed * k }
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
