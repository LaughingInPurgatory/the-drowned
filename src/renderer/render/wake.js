import * as THREE from 'three'
import { waveHeight, SEA_MAX_AMPLITUDE } from '../world/sea.js'

/**
 * Wake — soft foam trail + thin Kelvin arms.
 *
 * A conservative foam overlay keeps the shape readable without turning the
 * whole wake into a flat translucent triangle.
 */

const TRAIL_SEGMENTS = 56
const TRAIL_LIFETIME = 4.0
const TRAIL_MAX_HALF_WIDTH = 7.5
// A modest lift keeps the foam on top of the camera-facing water triangles.
// The visible water is displaced in the ocean vertex shader, so a ribbon that
// is only a few centimetres above the CPU wave sample can disappear into a
// neighbouring ocean triangle at low chase-camera angles.
const WAKE_LIFT = Math.max(1.15, SEA_MAX_AMPLITUDE * 0.28)
const WAKE_THRESHOLD = 0.015
export const WAKE_FULL_SPEED = 13
const SAMPLE_SPACING = 1.85

const FOAM_VERTEX = `
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

const FOAM_FRAGMENT = `
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

void main() {
  float edge = abs(vUv.x * 2.0 - 1.0);
  float age = vUv.y;
  vec2 drift = vec2(uTime * 0.08, -uTime * 0.06);
  float broad = valueNoise(vWorld * 0.18 + drift);
  float detail = valueNoise(vWorld * 0.72 - drift * 1.7);

  // Foam favours the two churn channels at the ribbon's shoulders; the
  // middle is only a broken wash instead of a painted triangular sheet.
  float channels = 0.48 + 0.52 * smoothstep(0.08, 0.28, edge);
  float rim = 1.0 - smoothstep(0.34, 0.96, edge);
  float breakup = valueNoise(vWorld * 1.65 + drift * 2.2);
  float flecks = smoothstep(0.30, 0.78, broad * 0.46 + detail * 0.34 + breakup * 0.20);
  float foam = mix(0.18, 1.0, flecks) * channels * rim;
  foam *= mix(1.0, 0.64, smoothstep(0.18, 1.0, age));

  float alpha = foam * vFade * 1.08;
  if (alpha <= 0.015) discard;
  vec3 colour = mix(uColor, vec3(0.98, 0.995, 1.0), 0.48 + detail * 0.18);
  gl_FragColor = vec4(colour, min(0.78, alpha));
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

function foamMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 }
    },
    vertexShader: FOAM_VERTEX,
    fragmentShader: FOAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: THREE.LessDepth,
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
  // Transparent wake is drawn after the opaque ocean and hull. Depth testing
  // then lets the hull's depth win wherever a bow arm crosses the ship.
  group.renderOrder = 0.5
  group.name = 'wake'

  const trailGeo = buildStrip(TRAIL_SEGMENTS)
  const trail = new THREE.Mesh(trailGeo, foamMaterial(0xd0e0e8))
  trail.frustumCulled = false
  trail.renderOrder = 0.5
  trail.name = 'wake-trail-foam'
  group.add(trail)

  const bowGeos = [buildStrip(12), buildStrip(12)]
  const bowFoamMat = foamMaterial(0xe2eef4)
  const bows = []
  for (const [i, g] of bowGeos.entries()) {
    const foam = new THREE.Mesh(g, bowFoamMat)
    foam.frustumCulled = false
    foam.renderOrder = 0.5
    foam.name = `wake-bow-${i}`
    group.add(foam)
    bows.push(foam)
  }

  const samples = []
  let lastSample = null

  function reset() {
    samples.length = 0
    lastSample = null
    trail.visible = false
    for (const b of bows) b.visible = false
  }

  function update(position, travelHeading, speedFraction, hullLength, hullHalfBeam, t, dt) {
    const speed = Math.max(0, Number(speedFraction) || 0)
    const active = speed > WAKE_THRESHOLD
    const px = Number(position?.[0]) || 0
    const pz = Number(position?.[2]) || 0
    const heading = Number.isFinite(travelHeading) ? travelHeading : 0
    const hLen = Math.max(4, Number(hullLength) || 16)
    // Ship classes are now materially wider than the original space-era
    // roster. Scale foam from the current rendered hull instead of letting a
    // large saved ship swallow its own wake.
    const hBeam = Math.max(1.5, Number(hullHalfBeam) || 4)
    const wakeWidth = Math.max(TRAIL_MAX_HALF_WIDTH, hBeam * 1.35)
    const simT = Number.isFinite(t) ? t : 0
    const step = Math.max(1e-3, Number(dt) || 1 / 60)

    trail.material.uniforms.uTime.value = simT
    bowFoamMat.uniforms.uTime.value = simT
    group.visible = true

    // Trail anchors slightly astern of the origin so foam starts behind the
    // hull rather than through the midships deck.
    // The hull geometry runs roughly from -length/2 to +length/2. Start just
    // beyond the transom so the first foam is not buried inside a long hull.
    const sternBack = hLen * 0.53
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
      const half = wakeWidth * s.speed * (0.35 + Math.min(0.75, k * 1.15))
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
    const tipX = px + Math.sin(heading) * hLen * 0.5
    const tipZ = pz + Math.cos(heading) * hLen * 0.5
    const armBase = heading + Math.PI
    const spread = 0.35
    const armLen = hLen * (0.35 + speed * 0.55)
    const armWidth = Math.max(0.28 + speed * 0.7, hBeam * 0.12)
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
    bowFoamMat.dispose()
  }

  return { group, update, reset, dispose }
}
