import * as THREE from 'three'
import { waveHeight, SEA_MAX_AMPLITUDE } from '../world/sea.js'

/**
 * Wake — soft foam trail + thin Kelvin arms.
 *
 * Middle ground after two extremes: solid chalk ramp (too artificial) and
 * sparse low-lift foam (invisible under the sea). Sits clear of crests,
 * draws without depth-fighting the ocean, foam is ragged but not empty.
 */

const TRAIL_SEGMENTS = 56
const TRAIL_LIFETIME = 4.0
const TRAIL_MAX_HALF_WIDTH = 7.5
/**
 * Clear of crest mismatch so the sea does not bury foam when depth-tested.
 * Stay modest so it does not read as a floating deck.
 */
const WAKE_LIFT = Math.max(0.7, SEA_MAX_AMPLITUDE * 0.22)
const WAKE_THRESHOLD = 0.015
export const WAKE_FULL_SPEED = 13
const SAMPLE_SPACING = 1.85

const VERTEX = `
attribute float aFade;
varying float vFade;
varying vec2 vUv;
varying vec2 vWorld;
void main() {
  vFade = aFade;
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
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
  float edge = abs(vUv.x * 2.0 - 1.0);

  // World-space churn — pattern sits in the water, not glued to the ribbon.
  vec2 w = vWorld * 0.38;
  vec2 churn = vec2(uTime * 0.26, uTime * -0.2);
  float clumps = fbm(w + churn);
  float fine = valueNoise(w * 4.6 + churn * 2.8);

  // Soft ragged rim (no hard strip edge).
  float wander = fbm(w * 0.4 + churn * 0.5);
  float outer = 0.58 + wander * 0.32;
  float across = smoothstep(outer + 0.14, outer - 0.32, edge);
  // Mild hollow mid-channel without killing the sheet.
  across *= 0.4 + 0.6 * smoothstep(0.02, 0.42, edge);

  float age = vUv.y;
  // Near hull: denser foam. Far aft: more broken, still present.
  float breakup = mix(0.32, 0.14, age) + edge * 0.14;
  breakup += smoothstep(0.55, 1.0, edge) * 0.18;
  // Bias so average noise still produces foam (not empty).
  float foam = smoothstep(breakup - 0.08, breakup + 0.42, clumps * 0.65 + fine * 0.28 + 0.22);

  float a = across * foam * vFade * 1.45;
  if (a <= 0.02) discard;
  // Soft cool white — not chalk, not invisible.
  vec3 col = mix(uColor, vec3(0.94, 0.97, 0.99), 0.5);
  gl_FragColor = vec4(col, min(0.82, a));
}
`

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
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1e5, -50, -1e5),
    new THREE.Vector3(1e5, 50, 1e5)
  )
  return geometry
}

function wakeMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 }
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    // Depth-test so the hull occludes foam that would otherwise paint over the
    // deck/superstructure. depthWrite off so soft ribbons do not punch holes
    // in each other. Lift + polygonOffset keep the trail above the sea without
    // drawing on top of the boat.
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1.5,
    polygonOffsetUnits: -1.5,
    fog: false,
    toneMapped: false,
    side: THREE.DoubleSide
  })
}

function surfaceY(x, z, t) {
  return waveHeight(x, z, t) + WAKE_LIFT
}

export function createWake() {
  const group = new THREE.Group()
  group.frustumCulled = false
  // After opaque hulls (default 0), before UI overlays — depth test still
  // lets the ship win where ribbons cross the mesh.
  group.renderOrder = 5
  group.name = 'wake'

  const trailGeo = buildStrip(TRAIL_SEGMENTS)
  const trail = new THREE.Mesh(trailGeo, wakeMaterial(0xd0e0e8))
  trail.frustumCulled = false
  trail.renderOrder = 5
  trail.name = 'wake-trail'
  group.add(trail)

  const bowGeos = [buildStrip(12), buildStrip(12)]
  const bowMat = wakeMaterial(0xe2eef4)
  const bows = bowGeos.map((g, i) => {
    const m = new THREE.Mesh(g, bowMat)
    m.frustumCulled = false
    m.renderOrder = 5
    m.name = `wake-bow-${i}`
    group.add(m)
    return m
  })

  const samples = []
  let lastSample = null

  function reset() {
    samples.length = 0
    lastSample = null
    trail.visible = false
    for (const b of bows) b.visible = false
  }

  function update(position, travelHeading, speedFraction, hullLength, t, dt) {
    const speed = Math.max(0, Number(speedFraction) || 0)
    const active = speed > WAKE_THRESHOLD
    const px = Number(position?.[0]) || 0
    const pz = Number(position?.[2]) || 0
    const heading = Number.isFinite(travelHeading) ? travelHeading : 0
    const hLen = Math.max(4, Number(hullLength) || 16)
    const simT = Number.isFinite(t) ? t : 0
    const step = Math.max(1e-3, Number(dt) || 1 / 60)

    trail.material.uniforms.uTime.value = simT
    bowMat.uniforms.uTime.value = simT
    group.visible = true

    // Trail anchors slightly astern of the origin so foam starts behind the
    // hull rather than through the midships deck.
    const sternBack = hLen * 0.32
    const fx = Math.sin(heading)
    const fz = Math.cos(heading)
    const ax = px - fx * sternBack
    const az = pz - fz * sternBack

    if (active) {
      if (samples.length === 0) {
        for (let i = 12; i >= 0; i--) {
          samples.push({
            x: ax - fx * i * SAMPLE_SPACING,
            z: az - fz * i * SAMPLE_SPACING,
            heading,
            speed: Math.max(0.25, speed * (1 - i * 0.04)),
            age: i * (TRAIL_LIFETIME / 16)
          })
        }
        lastSample = samples[samples.length - 1]
      }
      const moved =
        !lastSample ||
        Math.hypot(ax - lastSample.x, az - lastSample.z) >= SAMPLE_SPACING
      if (moved) {
        samples.push({ x: ax, z: az, heading, speed, age: 0 })
        lastSample = samples[samples.length - 1]
        if (samples.length > TRAIL_SEGMENTS + 1) samples.shift()
      }
    }

    for (const s of samples) s.age += step
    while (samples.length && samples[0].age > TRAIL_LIFETIME) samples.shift()

    const pos = trailGeo.getAttribute('position')
    const uv = trailGeo.getAttribute('uv')
    const fade = trailGeo.getAttribute('aFade')
    const count = TRAIL_SEGMENTS + 1
    for (let i = 0; i < count; i++) {
      const s = samples[samples.length - 1 - i]
      const vi = i * 2
      if (!s) {
        for (const k of [vi, vi + 1]) {
          pos.setXYZ(k, px, -50, pz)
          fade.setX(k, 0)
        }
        continue
      }
      const k = s.age / TRAIL_LIFETIME
      const half = TRAIL_MAX_HALF_WIDTH * s.speed * (0.35 + Math.min(0.75, k * 1.15))
      const nx = Math.cos(s.heading)
      const nz = -Math.sin(s.heading)
      for (const [k2, sign] of [
        [vi, -1],
        [vi + 1, 1]
      ]) {
        const x = s.x + nx * half * sign
        const z = s.z + nz * half * sign
        pos.setXYZ(k2, x, surfaceY(x, z, simT), z)
        uv.setXY(k2, sign > 0 ? 1 : 0, i / count)
        fade.setX(k2, Math.pow(1 - k, 1.9) * Math.min(1, s.speed * 2.0))
      }
    }
    pos.needsUpdate = true
    uv.needsUpdate = true
    fade.needsUpdate = true
    trail.visible = samples.length > 1

    // Kelvin arms — visible but thinner than the old solid wedges.
    const tipX = px + Math.sin(heading) * hLen * 0.44
    const tipZ = pz + Math.cos(heading) * hLen * 0.44
    const armBase = heading + Math.PI
    const spread = 0.35
    const armLen = hLen * (0.35 + speed * 0.55)
    const armWidth = 0.28 + speed * 0.7
    for (let b = 0; b < 2; b++) {
      const sign = b === 0 ? -1 : 1
      const a = armBase + sign * spread
      const g = bowGeos[b]
      const p = g.getAttribute('position')
      const u = g.getAttribute('uv')
      const f = g.getAttribute('aFade')
      const segs = 12
      for (let i = 0; i <= segs; i++) {
        const alongDist = (i / segs) * armLen
        const cx = tipX + Math.sin(a) * alongDist
        const cz = tipZ + Math.cos(a) * alongDist
        const w = armWidth * (0.3 + (i / segs) * 1.25)
        const nx = Math.cos(a)
        const nz = -Math.sin(a)
        for (const [vi2, s2] of [
          [i * 2, -1],
          [i * 2 + 1, 1]
        ]) {
          const x = cx + nx * w * s2
          const z = cz + nz * w * s2
          p.setXYZ(vi2, x, surfaceY(x, z, simT), z)
          u.setXY(vi2, s2 > 0 ? 1 : 0, i / segs)
          const along = i / segs
          const shape = Math.min(1, along * 4) * Math.pow(1 - along, 1.65)
          f.setX(vi2, active ? shape * Math.min(0.9, speed * 2.0) : 0)
        }
      }
      p.needsUpdate = true
      u.needsUpdate = true
      f.needsUpdate = true
      bows[b].visible = active
    }

    group.visible = true
  }

  function dispose() {
    trailGeo.dispose()
    for (const g of bowGeos) g.dispose()
    trail.material.dispose()
    bowMat.dispose()
  }

  return { group, update, reset, dispose }
}
