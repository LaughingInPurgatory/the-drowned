import * as THREE from 'three'
import { seaShaderChunk, SEA_MAX_AMPLITUDE } from '../world/sea.js'

// Radius the water reaches. Well past the fog wall — the surface must still be
// there when a crest lifts the camera, or you get a hole at the horizon.
const OCEAN_RADIUS = 12000
// Innermost ring. Geometric ring spacing from here out, so the tessellation is
// metres-fine around the hull and hundreds of metres wide at the horizon
// without paying for a uniform grid at either.
const INNER_RADIUS = 6
const RINGS = 150
const SEGMENTS = 200
// Recentring the disc every frame makes each vertex sample a different world
// point each frame, which shimmers. Snapping the centre to a quantum holds the
// sample points still between steps.
const CENTER_SNAP = 4

/**
 * Camera-centred radial disc: a ring of vertices every `RINGS` steps out from
 * the middle, dense near the viewer. A plain grid would either be too coarse
 * underfoot or ruinously dense at the horizon.
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

  // Winding matters: seen from above, increasing angle runs clockwise in the
  // XZ plane, so the naive order puts the water's back face upward and the
  // whole sea vanishes except a sliver at the horizon. Emit reversed.
  const indices = []
  // Fan from the centre vertex to the first ring.
  for (let s = 0; s < SEGMENTS; s++) {
    indices.push(0, 1 + ((s + 1) % SEGMENTS), 1 + s)
  }
  // Quads between successive rings.
  for (let i = 0; i < RINGS; i++) {
    const a = 1 + i * SEGMENTS
    const b = 1 + (i + 1) * SEGMENTS
    for (let s = 0; s < SEGMENTS; s++) {
      const n = (s + 1) % SEGMENTS
      indices.push(a + s, b + n, b + s)
      indices.push(a + s, a + n, b + n)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  // Displacement happens in the vertex shader, so the CPU-side bounds are flat.
  // Pad by the tallest crest and skip culling — the disc always wraps the camera.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), OCEAN_RADIUS + SEA_MAX_AMPLITUDE)
  return geometry
}

const VERTEX = `
uniform float uTime;
varying vec3 vWorldPos;
varying float vDetail;
#include <fog_pars_vertex>

${seaShaderChunk()}

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // Far rings span hundreds of units per triangle; displacing them by a wave
  // sampled at one corner reads as noise, so the swell fades out with distance
  // and the horizon settles flat under the fog.
  float dist = length(wp.xz - cameraPosition.xz);
  vDetail = 1.0 - smoothstep(600.0, 4200.0, dist);
  wp.y = seaHeight(wp.xz, uTime) * vDetail;
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const FRAGMENT = `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uCrestColor;
uniform vec3 uSkyColor;
uniform vec3 uFoamColor;
varying vec3 vWorldPos;
varying float vDetail;
#include <fog_pars_fragment>

${seaShaderChunk()}

void main() {
  // Shading detail runs much further out than the geometry does. Displacement
  // has to fade or huge far triangles turn the swell into noise, but the normal
  // is analytic and per-pixel, so the water keeps its texture right out to the
  // fog wall instead of going glassy a few hundred metres from the boat.
  float dist = length(vWorldPos.xz - cameraPosition.xz);
  float shadeDetail = 1.0 - smoothstep(2500.0, 9000.0, dist);
  vec3 N = seaNormal(vWorldPos.xz, uTime);
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, shadeDetail));

  vec3 V = normalize(cameraPosition - vWorldPos);
  // Steep exponent: only genuinely grazing water mirrors the sky. A softer
  // falloff turns the whole surface into a sheet of pale haze, because from a
  // low chase seat almost all visible water is near-grazing.
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 6.0);

  // Face-on water is the dark column beneath; tilted faces catch more sky.
  vec3 col = mix(uCrestColor, uDeepColor, smoothstep(0.90, 1.0, N.y));
  col = mix(col, uSkyColor, fresnel * 0.45);

  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  col += vec3(1.0, 0.94, 0.80) * pow(ndh, 300.0) * 3.0;   // sun track
  col += vec3(1.0, 0.90, 0.74) * pow(ndh, 20.0) * 0.14;   // broad glitter

  // Whitecaps where the surface pitches hardest.
  col = mix(col, uFoamColor, smoothstep(0.05, 0.13, 1.0 - N.y) * 0.5 * shadeDetail);

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`

/**
 * The sea surface. Sits under everything and follows the camera, so the world
 * only ever needs one of these however far the player sails.
 *
 * Returns the mesh with an `update(camera, t)` on it — call it every frame,
 * before rendering, with the same `t` the buoyancy maths is using.
 */
export function createOcean({ sunDirection, skyColor, fogColor }) {
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3().copy(sunDirection).normalize() },
        // Drowned-world water: silt and ash, not holiday blue.
        uDeepColor: { value: new THREE.Color(0x0d1a1c) },
        uCrestColor: { value: new THREE.Color(0x27453f) },
        uSkyColor: { value: new THREE.Color(skyColor ?? 0x8a9499) },
        uFoamColor: { value: new THREE.Color(0xc9d2cf) }
      }
    ]),
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    fog: true
  })
  if (fogColor) material.uniforms.fogColor.value = new THREE.Color().copy(fogColor)

  const mesh = new THREE.Mesh(buildDiscGeometry(), material)
  mesh.name = 'ocean'
  mesh.frustumCulled = false
  mesh.receiveShadow = false // a flat-shaded shadow on open water reads as a smear
  mesh.renderOrder = -1

  mesh.update = (camera, t) => {
    material.uniforms.uTime.value = t
    mesh.position.set(
      Math.round(camera.position.x / CENTER_SNAP) * CENTER_SNAP,
      0,
      Math.round(camera.position.z / CENTER_SNAP) * CENTER_SNAP
    )
  }

  return mesh
}
