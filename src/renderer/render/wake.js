import * as THREE from 'three'
import { waveHeight } from '../world/sea.js'

/**
 * Wake.
 *
 * A boat does not leave a plume of hot gas — it leaves disturbed water. Two
 * parts, because that is what you actually see from astern:
 *
 *   - the **bow wave**, a pair of foam arms spreading off the stem at a fixed
 *     angle, growing with speed
 *   - the **wake trail**, a widening band of churned water behind the transom
 *     that fades as it settles
 *
 * Both are built from a strip of quads laid on the sea surface, using the same
 * `waveHeight` everything else does, so they sit *on* the swell rather than
 * slicing through it.
 */

/** Segments along the trail. More is a longer-lived, smoother wake. */
const TRAIL_SEGMENTS = 48
/** Seconds a patch of disturbed water takes to settle. */
const TRAIL_LIFETIME = 4.5
/** Widest the trail gets at full speed, in world units. */
const TRAIL_MAX_HALF_WIDTH = 9
/** Sits just above the surface so it is never z-fought by the water. */
const WAKE_LIFT = 0.22
/** Below this fraction of top speed, a hull barely disturbs anything. */
const WAKE_THRESHOLD = 0.06
/** How far apart trail samples are dropped, in world units. */
const SAMPLE_SPACING = 3.5

const VERTEX = `
attribute float aFade;
varying float vFade;
varying vec2 vUv;
void main() {
  vFade = aFade;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAGMENT = `
uniform vec3 uColor;
uniform float uTime;
varying float vFade;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  // Denser foam along the edges of the band than down the middle — the churn
  // is thrown outward, and the centre closes over first.
  float edge = abs(vUv.x * 2.0 - 1.0);
  float band = smoothstep(0.15, 0.95, edge) * 0.75 + 0.25;
  // Break it up so it reads as foam rather than a painted stripe.
  float speck = hash21(floor(vUv * vec2(26.0, 220.0)));
  float foam = band * (0.55 + 0.45 * speck);
  float a = foam * vFade;
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
  const trail = new THREE.Mesh(trailGeo, wakeMaterial(0xdfeae8, 0.85))
  trail.frustumCulled = false
  trail.renderOrder = 2
  group.add(trail)

  // Bow arms: two short strips angled off the stem.
  const bowGeos = [buildStrip(10), buildStrip(10)]
  const bowMat = wakeMaterial(0xf0f6f4, 0.9)
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
   * @param {number} heading radians
   * @param {number} speedFraction 0–1 of top speed
   * @param {number} hullLength for scaling the bow wave
   * @param {number} t sim time, shared with the sea
   */
  function update(position, heading, speedFraction, hullLength, t, dt) {
    const active = speedFraction > WAKE_THRESHOLD

    // Drop a sample when we have moved far enough. Distance-based, not
    // time-based, so a slow boat leaves a short wake and a fast one a long
    // one without the geometry bunching up at low speed.
    if (active) {
      const moved =
        !lastSample ||
        Math.hypot(position[0] - lastSample.x, position[2] - lastSample.z) >= SAMPLE_SPACING
      if (moved) {
        samples.push({ x: position[0], z: position[2], heading, speed: speedFraction, age: 0 })
        lastSample = samples[samples.length - 1]
        if (samples.length > TRAIL_SEGMENTS + 1) samples.shift()
      }
    }

    for (const s of samples) s.age += dt
    while (samples.length && samples[0].age > TRAIL_LIFETIME) samples.shift()

    // --- Trail ---
    const pos = trailGeo.getAttribute('position')
    const uv = trailGeo.getAttribute('uv')
    const fade = trailGeo.getAttribute('aFade')
    const count = TRAIL_SEGMENTS + 1
    for (let i = 0; i < count; i++) {
      // Newest sample at the transom end; run backwards through history.
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
      // Widens as it spreads out behind, then the edges lose definition.
      const half = TRAIL_MAX_HALF_WIDTH * s.speed * (0.35 + k * 0.9)
      const nx = Math.cos(s.heading)
      const nz = -Math.sin(s.heading)
      for (const [k2, sign] of [[vi, -1], [vi + 1, 1]]) {
        const x = s.x + nx * half * sign
        const z = s.z + nz * half * sign
        pos.setXYZ(k2, x, waveHeight(x, z, t) + WAKE_LIFT, z)
        uv.setXY(k2, sign > 0 ? 1 : 0, i / count)
        // Bright at the transom, gone by the time the water has settled.
        fade.setX(k2, Math.pow(1 - k, 1.4) * Math.min(1, s.speed * 2.2))
      }
    }
    pos.needsUpdate = true
    uv.needsUpdate = true
    fade.needsUpdate = true

    // --- Bow wave ---
    // Two arms off the stem at the classic ~19° Kelvin angle, thrown wider and
    // brighter the harder she is driven.
    const bowX = position[0] + Math.sin(heading) * hullLength * 0.45
    const bowZ = position[2] + Math.cos(heading) * hullLength * 0.45
    const spread = 0.34
    const armLen = hullLength * (0.7 + speedFraction * 1.9)
    const armWidth = 0.7 + speedFraction * 2.4
    for (let b = 0; b < 2; b++) {
      const sign = b === 0 ? -1 : 1
      const a = heading + Math.PI + sign * spread
      const g = bowGeos[b]
      const p = g.getAttribute('position')
      const u = g.getAttribute('uv')
      const f = g.getAttribute('aFade')
      const segs = 10
      for (let i = 0; i <= segs; i++) {
        const along = (i / segs) * armLen
        const cx = bowX + Math.sin(a) * along
        const cz = bowZ + Math.cos(a) * along
        const w = armWidth * (0.35 + (i / segs) * 1.0)
        const nx = Math.cos(a)
        const nz = -Math.sin(a)
        for (const [vi2, s2] of [[i * 2, -1], [i * 2 + 1, 1]]) {
          const x = cx + nx * w * s2
          const z = cz + nz * w * s2
          p.setXYZ(vi2, x, waveHeight(x, z, t) + WAKE_LIFT, z)
          u.setXY(vi2, s2 > 0 ? 1 : 0, i / segs)
          f.setX(vi2, active ? (1 - i / segs) * Math.min(1, speedFraction * 2.6) : 0)
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
