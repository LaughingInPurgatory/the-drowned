import * as THREE from 'three'
import { waveHeight } from '../world/sea.js'

/**
 * Wake.
 *
 * A boat does not leave a plume of hot gas — it leaves disturbed water. Two
 * parts, because that is what you actually see from astern:
 *
 *   - the **Kelvin arms**, a pair of foam arms off the leading end (stem ahead,
 *     transom when going astern), growing with fore/aft speed
 *   - the **wake trail**, a widening band of churned water behind the motion
 *     that fades as it settles
 *
 * Driven by **travel direction + way speed** (not hull max speed). Reverse is
 * free: pass the velocity heading and the leading end is the end going first.
 * Callers suppress pure strafe if they want. Both strips use the same
 * `waveHeight` everything else does, so they sit *on* the swell.
 */

/** Segments along the trail. More is a longer-lived, smoother wake. */
const TRAIL_SEGMENTS = 48
/** Seconds a patch of disturbed water takes to settle. */
const TRAIL_LIFETIME = 4.5
/** Widest the trail gets at full speed, in world units. */
const TRAIL_MAX_HALF_WIDTH = 9
/**
 * Sits just above the surface so it is never z-fought by the water.
 *
 * Deliberately tiny. Anything you can actually see lifting reads as a sheet
 * hovering over the sea rather than foam in it — and because the ribbon
 * samples `waveHeight` at every vertex, it already follows the swell.
 */
const WAKE_LIFT = 0.06
/** Below this intensity (0–1), a hull barely disturbs anything. */
const WAKE_THRESHOLD = 0.04
/**
 * Absolute horizontal speed that reads as a full wake. AI hulls cruise far
 * below stats.speed (heavy drag), so scaling by top speed made patrols silent.
 */
export const WAKE_FULL_SPEED = 28
/** How far apart trail samples are dropped, in world units. */
const SAMPLE_SPACING = 3.5

const VERTEX = `
attribute float aFade;
varying float vFade;
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vFade = aFade;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // World XZ, so the foam pattern can be anchored to the *water* rather than
  // to the ribbon. See the fragment shader.
  vWorld = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAGMENT = `
uniform vec3 uColor;
uniform float uTime;
varying float vFade;
varying vec2 vUv;
varying vec2 vWorld;

// Smooth value noise. The first version of this used a blocky floor()-based
// hash, which at wake scale showed up as a grid of grey squares astern —
// unmistakably a texture rather than water.
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += valueNoise(p) * amp;
    p *= 2.07;
    amp *= 0.5;
  }
  return v;
}

void main() {
  // Soft everywhere. A wake has no edge — it thins out until it is water
  // again — so both axes get a smooth falloff and nothing is ever drawn at
  // full opacity. The hard-edged version read as a grey ramp bolted to the
  // hull, which is the single thing that made it look like geometry.
  float edge = abs(vUv.x * 2.0 - 1.0);

  // Everything textural is sampled in **world space**, not in the ribbon's own
  // UVs. Sampling in UV space glues the foam to the boat: the pattern slides
  // along with the hull and never appears to be sitting in the water, which is
  // the single thing that stopped this reading as a wake however soft its
  // edges were. Anchored to the world, the ribbon travels through a foam field
  // that stays put, exactly as broken water does.
  vec2 w = vWorld * 0.35;
  // A slow drift and evolution on top, so the churn is alive rather than a
  // stencil the boat drags across a fixed pattern.
  vec2 churn = vec2(uTime * 0.25, uTime * -0.19);
  float clumps = fbm(w + churn);
  float fine = valueNoise(w * 4.5 + churn * 3.1);

  // Ragged outer boundary. The ribbon is a strip of quads, so its edge is a
  // dead-straight line, and a straight line is exactly what read as fake —
  // real white water has a torn, wandering margin. Wobbling the cutoff with a
  // low-frequency world-space noise removes the ruled edge, and because it is
  // world-space the ragged edge crawls as you pass instead of being painted on.
  float wander = fbm(w * 0.42 + churn * 0.6);
  float outer = 0.62 + wander * 0.42;
  // Hollow: the churn is thrown outward and the middle closes over first.
  float across = smoothstep(outer + 0.16, outer - 0.30, edge)
    * (0.3 + 0.7 * smoothstep(0.06, 0.55, edge));

  // Older water is more broken up: the sheet turns into scattered patches, and
  // the further outboard it is the sooner that happens — the middle of a wake
  // stays a solid sheet far longer than its shoulders do.
  float age = vUv.y;
  float breakup = mix(0.58, 0.10, age) + edge * 0.22;
  // The outermost shoulder is the thinnest, most broken water there is: raise
  // its threshold hard so it survives only where the noise is genuinely high,
  // and it dissolves into scattered patches instead of a continuous fringe.
  breakup += smoothstep(0.55, 1.0, edge) * 0.3;
  float foam = smoothstep(breakup, breakup + 0.40, clumps * 0.78 + fine * 0.3);

  float a = across * foam * vFade * 0.85;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`

/** A ribbon of quads whose vertices are rewritten each frame. */
function buildStrip(segments) {
  const verts = (segments + 1) * 2
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2))
  geometry.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(verts), 1))
  const indices = []
  for (let i = 0; i < segments; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  geometry.setIndex(indices)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return geometry
}

function wakeMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 }
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity
  })
}

/**
 * One boat's wake. Cheap enough to give every visible hull its own — the
 * player's and each NPC's.
 */
export function createWake() {
  const group = new THREE.Group()
  group.frustumCulled = false

  const trailGeo = buildStrip(TRAIL_SEGMENTS)
  const trail = new THREE.Mesh(trailGeo, wakeMaterial(0xe8f1f2, 0.85))
  trail.frustumCulled = false
  trail.renderOrder = 2
  group.add(trail)

  // Bow arms: two short strips angled off the stem.
  const bowGeos = [buildStrip(10), buildStrip(10)]
  const bowMat = wakeMaterial(0xf2f8f8, 0.9)
  const bows = bowGeos.map((g) => {
    const m = new THREE.Mesh(g, bowMat)
    m.frustumCulled = false
    m.renderOrder = 2
    group.add(m)
    return m
  })

  // Ring buffer of where the boat has been, with how fast it was going.
  const samples = []
  let lastSample = null

  function reset() {
    samples.length = 0
    lastSample = null
  }

  /**
   * @param {number[]} position boat position
   * @param {number} travelHeading radians — direction of travel (not necessarily bow)
   * @param {number} speedFraction 0–1 intensity (see WAKE_FULL_SPEED). 0 = no wake.
   * @param {number} hullLength for scaling the Kelvin arms
   * @param {number} t sim time, shared with the sea
   */
  function update(position, travelHeading, speedFraction, hullLength, t, dt) {
    const speed = Math.max(0, speedFraction)
    const active = speed > WAKE_THRESHOLD
    // The foam now animates in the shader, so both materials need the clock.
    trail.material.uniforms.uTime.value = t
    bowMat.uniforms.uTime.value = t

    // Drop a sample when we have moved far enough. Distance-based, not
    // time-based, so a slow boat leaves a short wake and a fast one a long
    // one without the geometry bunching up at low speed.
    if (active) {
      const moved =
        !lastSample ||
        Math.hypot(position[0] - lastSample.x, position[2] - lastSample.z) >= SAMPLE_SPACING
      if (moved) {
        samples.push({
          x: position[0],
          z: position[2],
          heading: travelHeading,
          speed,
          age: 0
        })
        lastSample = samples[samples.length - 1]
        if (samples.length > TRAIL_SEGMENTS + 1) samples.shift()
      }
    }

    for (const s of samples) s.age += dt
    while (samples.length && samples[0].age > TRAIL_LIFETIME) samples.shift()

    // --- Trail ---
    // Ribbon follows position history (behind the motion). Width is across the
    // travel direction so reverse/orbit still leave a coherent band.
    const pos = trailGeo.getAttribute('position')
    const uv = trailGeo.getAttribute('uv')
    const fade = trailGeo.getAttribute('aFade')
    const count = TRAIL_SEGMENTS + 1
    for (let i = 0; i < count; i++) {
      // Newest sample at the hull end; run backwards through history.
      const s = samples[samples.length - 1 - i]
      const vi = i * 2
      if (!s) {
        // No history here — collapse the quad so it draws nothing.
        for (const k of [vi, vi + 1]) {
          pos.setXYZ(k, position[0], -9999, position[2])
          fade.setX(k, 0)
        }
        continue
      }
      const k = s.age / TRAIL_LIFETIME
      // Widens as it spreads out behind the motion, then the edges lose definition.
      const half = TRAIL_MAX_HALF_WIDTH * s.speed * (0.45 + Math.min(0.75, k * 1.3))
      const nx = Math.cos(s.heading)
      const nz = -Math.sin(s.heading)
      for (const [k2, sign] of [
        [vi, -1],
        [vi + 1, 1]
      ]) {
        const x = s.x + nx * half * sign
        const z = s.z + nz * half * sign
        pos.setXYZ(k2, x, waveHeight(x, z, t) + WAKE_LIFT, z)
        uv.setXY(k2, sign > 0 ? 1 : 0, i / count)
        // Brightest at the hull, gone well before the ribbon runs out.
        fade.setX(k2, Math.pow(1 - k, 2.1) * Math.min(1, s.speed * 2.2))
      }
    }
    pos.needsUpdate = true
    uv.needsUpdate = true
    fade.needsUpdate = true

    // --- Kelvin arms ---
    // Off the *leading* end of the motion (bow ahead, stern when going astern,
    // beam when orbiting). Arms trail opposite travel.
    const tipX = position[0] + Math.sin(travelHeading) * hullLength * 0.45
    const tipZ = position[2] + Math.cos(travelHeading) * hullLength * 0.45
    const armBase = travelHeading + Math.PI
    const spread = 0.33
    const armLen = hullLength * (0.45 + speed * 0.85)
    const armWidth = 0.35 + speed * 1.1
    for (let b = 0; b < 2; b++) {
      const sign = b === 0 ? -1 : 1
      const a = armBase + sign * spread
      const g = bowGeos[b]
      const p = g.getAttribute('position')
      const u = g.getAttribute('uv')
      const f = g.getAttribute('aFade')
      const segs = 10
      for (let i = 0; i <= segs; i++) {
        const alongDist = (i / segs) * armLen
        const cx = tipX + Math.sin(a) * alongDist
        const cz = tipZ + Math.cos(a) * alongDist
        const w = armWidth * (0.3 + (i / segs) * 1.5)
        const nx = Math.cos(a)
        const nz = -Math.sin(a)
        for (const [vi2, s2] of [
          [i * 2, -1],
          [i * 2 + 1, 1]
        ]) {
          const x = cx + nx * w * s2
          const z = cz + nz * w * s2
          p.setXYZ(vi2, x, waveHeight(x, z, t) + WAKE_LIFT, z)
          u.setXY(vi2, s2 > 0 ? 1 : 0, i / segs)
          // Fade in off the tip as well as out along the arm.
          const along = i / segs
          const shape = Math.min(1, along * 4) * Math.pow(1 - along, 1.6)
          f.setX(vi2, active ? shape * Math.min(1, speed * 2.6) : 0)
        }
      }
      p.needsUpdate = true
      u.needsUpdate = true
      f.needsUpdate = true
      bows[b].visible = active
    }

    trail.visible = samples.length > 1
  }

  function dispose() {
    trailGeo.dispose()
    for (const g of bowGeos) g.dispose()
    trail.material.dispose()
    bowMat.dispose()
  }

  return { group, update, reset, dispose }
}
