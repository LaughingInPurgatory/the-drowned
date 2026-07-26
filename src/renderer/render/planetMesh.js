import * as THREE from 'three'
import { mulberry32, range, pick } from '../procgen/prng.js'
import { getSurfaceTextures } from './textures.js'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Cheap seeded "value noise" over the unit sphere (a sum of a few sine
// waves at seeded phases) — smooth, continuous blotches for patchy surface
// features (craters, oceans, lava cracks), unlike per-vertex independent
// randomness which would look like uncorrelated static.
function surfaceNoise(nx, ny, nz, offsets) {
  return Math.sin(nx * 3.7 + offsets[0]) * Math.cos(ny * 4.1 + offsets[1]) * Math.sin(nz * 3.3 + offsets[2])
}

// Multi-octave noise for displacement so bumps are continuous ridges rather
// than each vertex flying off on its own (the old rng()-per-vertex jitter
// is what made large bodies look like shattered glass).
function surfaceNoiseFbm(nx, ny, nz, offsets) {
  let n = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < 3; o++) {
    n += amp * surfaceNoise(nx * freq, ny * freq, nz * freq, [
      offsets[0] + o * 1.7,
      offsets[1] + o * 2.3,
      offsets[2] + o * 1.1
    ])
    norm += amp
    amp *= 0.5
    freq *= 2.1
  }
  return n / norm
}

// Sphere segment counts scale with radius so silhouette facets stay small
// after PLANET_SIZE_SCALE. Caps keep GPU cost sane (few bodies live at once).
function sphereGeometryForRadius(radius) {
  const lat = Math.max(48, Math.min(96, Math.round(radius / 5)))
  const lon = lat * 2
  return new THREE.SphereGeometry(radius, lon, lat)
}

// Radial displacement from continuous noise (amount is peak ± fraction of
// radius). Always recompute normals so lighting follows the new surface.
function displaceWithNoise(geometry, radius, offsets, amount) {
  if (amount <= 0) return
  const pos = geometry.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
    const n = surfaceNoiseFbm(v.x, v.y, v.z, offsets)
    v.multiplyScalar(radius * (1 + n * amount))
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

// blend(noiseValue, normalizedVertex) -> 0..1 lerp factor from base to accent.
function paintVertexColors(geometry, base, accent, offsets, blend) {
  const pos = geometry.attributes.position
  const colors = []
  const v = new THREE.Vector3()
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
    const n = surfaceNoise(v.x, v.y, v.z, offsets)
    c.copy(base).lerp(accent, Math.max(0, Math.min(1, blend(n, v))))
    colors.push(c.r, c.g, c.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
}

function seededOffsets(rng) {
  return [rng() * 10, rng() * 10, rng() * 10]
}

// Cratered rock — continuous noise hills, muted browns/greys.
function buildRocky(radius, rng) {
  const geometry = sphereGeometryForRadius(radius)
  const offsets = seededOffsets(rng)
  displaceWithNoise(geometry, radius, offsets, 0.045)
  const base = new THREE.Color().setHSL(range(rng, 10, 45) / 360, 0.3, range(rng, 0.35, 0.5))
  const accent = base.clone().multiplyScalar(0.55)
  paintVertexColors(geometry, base, accent, offsets, (n) => (n > 0.2 ? 0.7 : 0))
  return geometry
}

// Gas giant — smooth sphere; cloud belts come from free procedural PBR maps
// (textures.js makeGasGiantTextureSet). Mild vertex tint for per-body variety.
function buildGasGiant(radius, rng) {
  const geometry = sphereGeometryForRadius(radius)
  const hue = range(rng, 0, 360) / 360
  const base = new THREE.Color().setHSL(hue, range(rng, 0.25, 0.45), range(rng, 0.52, 0.68))
  const accent = base.clone().offsetHSL(range(rng, -0.06, 0.08), 0.05, range(rng, -0.08, 0.1))
  // Soft large-scale tint only — fine cloud detail is in the albedo map.
  paintVertexColors(geometry, base, accent, seededOffsets(rng), (n) =>
    Math.max(0, Math.min(1, n * 0.35 + 0.35))
  )
  return geometry
}

// Ice world — mostly smooth, pale base with brighter cracks and whiter poles.
function buildIce(radius, rng) {
  const geometry = sphereGeometryForRadius(radius)
  const offsets = seededOffsets(rng)
  displaceWithNoise(geometry, radius, offsets, 0.02)
  const hue = range(rng, 190, 215) / 360
  const base = new THREE.Color().setHSL(hue, 0.3, 0.72)
  const accent = new THREE.Color().setHSL(hue, 0.1, 0.94)
  paintVertexColors(geometry, base, accent, offsets, (n, v) => Math.max(n, 0) * 0.7 + Math.abs(v.y) * 0.4)
  return geometry
}

// Lush world — ocean/continent patches.
function buildLush(radius, rng) {
  const geometry = sphereGeometryForRadius(radius)
  const ocean = new THREE.Color().setHSL(range(rng, 200, 225) / 360, 0.55, 0.4)
  const land = new THREE.Color().setHSL(range(rng, 85, 140) / 360, 0.45, 0.38)
  paintVertexColors(geometry, ocean, land, seededOffsets(rng), (n) => (n > 0.05 ? 1 : 0))
  return geometry
}

// Volcanic world — charred crust with glowing lava cracks (gentle relief).
function buildVolcanic(radius, rng) {
  const geometry = sphereGeometryForRadius(radius)
  const offsets = seededOffsets(rng)
  displaceWithNoise(geometry, radius, offsets, 0.05)
  const base = new THREE.Color().setHSL(range(rng, 0, 20) / 360, 0.3, 0.12)
  const lava = new THREE.Color().setHSL(range(rng, 10, 30) / 360, 0.9, 0.55)
  paintVertexColors(geometry, base, lava, offsets, (n) => (n > 0.35 ? 1 : 0))
  return geometry
}

// Named rather than a plain array of functions so buildPlanetMesh can look up
// the matching getSurfaceTextures() entry (gas giants use free procedural
// cloud-band maps — same material path as rocky/ice/lush/volcanic).
const PLANET_ARCHETYPES = {
  rocky: buildRocky,
  gasGiant: buildGasGiant,
  ice: buildIce,
  lush: buildLush,
  volcanic: buildVolcanic
}
const PLANET_ARCHETYPE_NAMES = Object.keys(PLANET_ARCHETYPES)

// A thin, tilted debris ring — MeshBasicMaterial (self-lit) rather than
// Lambert, since a paper-thin disc only catches directional light at very
// specific angles under normal shading and would flicker dark from most
// viewpoints. Banded coloring reuses the "vary color by radial distance"
// trick, giving it visible structure instead of a flat tinted disc.
function buildRing(radius, rng) {
  const inner = radius * (1.5 + rng() * 0.3)
  const outer = inner + radius * (0.6 + rng() * 0.7)
  const geometry = new THREE.RingGeometry(inner, outer, 64, 6)
  const hue = range(rng, 25, 50) / 360
  const bandFreq = range(rng, 10, 22)

  const pos = geometry.attributes.position
  const colors = []
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i))
    const t = (r - inner) / (outer - inner)
    const band = Math.sin(t * bandFreq) * 0.5 + 0.5
    c.setHSL(hue, 0.3, 0.3 + band * 0.3)
    colors.push(c.r, c.g, c.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
  const ring = new THREE.Mesh(geometry, material)
  ring.rotation.x = Math.PI / 2 + (rng() - 0.5) * 0.6
  ring.rotation.z = rng() * Math.PI * 2
  return ring
}

// Atmosphere colour + shell thickness + glow strength per archetype. Airless
// bodies (rocky worlds, every moon) are absent on purpose — a bare rock with a
// limb glow reads as fake immediately.
const ATMOSPHERES = {
  lush: { color: 0x5a9dff, thickness: 0.028, strength: 1.5 },
  ice: { color: 0x9fd8ff, thickness: 0.022, strength: 1.0 },
  gasGiant: { color: 0xffc98a, thickness: 0.038, strength: 1.25 },
  volcanic: { color: 0xff7842, thickness: 0.024, strength: 0.9 }
}

/**
 * Thin atmosphere shell: a back-face fresnel rim that brightens toward the
 * limb and fades out across the terminator. Cheapest cue that a sphere is a
 * world with air rather than a painted ball, and it gives the bloom pass an
 * edge to catch. BackSide + no depth write so the planet's own depth occludes
 * the middle, leaving only the halo past the silhouette.
 *
 * Sun direction comes free: main.js parks every system's star at world origin,
 * so the vector from a surface point toward the light is just -normalize(pos).
 */
function buildAtmosphere(radius, { color, thickness, strength }) {
  const geometry = new THREE.SphereGeometry(radius * (1 + thickness), 64, 32)
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength }
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormalW;
      varying vec3 vViewW;
      varying vec3 vPosW;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPosW = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      varying vec3 vPosW;
      void main() {
        #include <logdepthbuf_fragment>

        vec3 n = normalize(vNormalW);
        // Back faces point away from the camera, so flip for a limb term that
        // peaks at the silhouette edge.
        float rim = 1.0 - abs(dot(n, normalize(vViewW)));
        float glow = pow(clamp(rim, 0.0, 1.0), 3.2);
        // System star sits at world origin.
        float lit = dot(-n, normalize(-vPosW));
        // Wide falloff keeps a thin sliver of scatter just past the terminator.
        float day = smoothstep(-0.35, 0.45, lit);
        float a = glow * day * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    depthWrite: false
  })
  const shell = new THREE.Mesh(geometry, material)
  shell.renderOrder = 1
  return shell
}

// Moons are always small barren rock — cratered, muted, no atmosphere-driven
// variety (bands/oceans/lava wouldn't make sense at that scale).
function buildMoon(radius, rng) {
  const geometry = sphereGeometryForRadius(radius)
  const offsets = seededOffsets(rng)
  displaceWithNoise(geometry, radius, offsets, 0.055)
  const base = new THREE.Color().setHSL(range(rng, 20, 60) / 360, 0.12, 0.42)
  const accent = base.clone().multiplyScalar(0.6)
  paintVertexColors(geometry, base, accent, offsets, (n) => (n > 0.15 ? 0.6 : 0))
  return geometry
}

// Seeded archetype (rocky/gas/ice/lush/volcanic for planets, always cratered
// rock for moons). Radius is the body's real (generation-time, collision)
// size. Geometry is a high-segment SphereGeometry so silhouettes stay round
// at current PLANET_SIZE_SCALE; relief uses continuous noise, not per-vertex RNG.
export function buildPlanetMesh(body) {
  const rng = mulberry32(hashString(body.id))
  const radius = body.radius

  // Moons always reuse the 'rocky' texture set (barren cratered rock, same
  // as an asteroid) rather than picking their own archetype.
  const archetypeName = body.kind === 'moon' ? 'rocky' : pick(rng, PLANET_ARCHETYPE_NAMES)
  const geometry = body.kind === 'moon' ? buildMoon(radius, rng) : PLANET_ARCHETYPES[archetypeName](radius, rng)

  // Real free textures (ambientCG CC0 for rock/ice/lush/lava; procedural
  // cloud belts for gas giants) layered under per-body vertex-color tint.
  // Smooth shading only — flatShading made bodies read as shattered polyhedra.
  const textures = getSurfaceTextures(archetypeName)
  const isGas = body.kind === 'planet' && archetypeName === 'gasGiant'
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: false,
    roughness: isGas ? 0.78 : 0.9,
    metalness: 0,
    depthWrite: true,
    depthTest: true,
    ...(textures
      ? {
          map: textures.map,
          normalMap: textures.normalMap,
          roughnessMap: textures.roughnessMap,
          normalScale: new THREE.Vector2(isGas ? 0.55 : 0.75, isGas ? 0.55 : 0.75)
        }
      : {})
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 0
  if (isGas) {
    // Mark for spin only — cloud detail is on the surface map now (no extra shell).
    mesh.userData.hasAtmosphere = false
    mesh.userData.stormyAtmosphere = rng() < 0.38
  }

  // Limb haze for worlds that would actually hold an atmosphere (never moons,
  // never bare rock). Static shader — no per-frame update needed.
  const air = body.kind === 'planet' ? ATMOSPHERES[archetypeName] : null
  if (air) mesh.add(buildAtmosphere(radius, air))

  // ~3% of planets (never moons) get a ring — purely cosmetic, so it's
  // decided from the same per-body rng rather than a persisted field, same
  // convention as archetype/color selection above.
  if (body.kind === 'planet' && rng() < 0.03) mesh.add(buildRing(radius, rng))

  // Axial tilt (some worlds spin well off the system plane).
  const axialTilt = body.kind === 'planet' ? range(rng, 0, 0.55) * (rng() < 0.5 ? 1 : -1) : range(rng, 0, 0.2) * (rng() < 0.5 ? 1 : -1)
  mesh.rotation.z = axialTilt
  mesh.userData.axialTilt = axialTilt

  // ~55% of moons are tidally locked (main.js aims them at their parent);
  // the rest and all planets get a visible axial spin. Body positions stay
  // fixed in the system (no orbital motion) — only rotation about the axis.
  const tidallyLocked = body.kind === 'moon' && rng() < 0.55
  mesh.userData.tidallyLocked = tidallyLocked
  mesh.userData.parentId = body.parentId
  // rad/s — readable day cycle without looking frantic (~4–12 min/turn).
  mesh.userData.spinSpeed = tidallyLocked
    ? 0
    : range(rng, 0.008, 0.024) * (rng() < 0.5 ? 1 : -1)

  return mesh
}

/** Animate gas-giant cloud shells (time + relative spin). */
export function updatePlanetAtmosphere(mesh, elapsed, dt) {
  if (!mesh?.userData?.hasAtmosphere) return
  mesh.traverse((child) => {
    if (!child.userData?.atmosphere) return
    if (child.material?.uniforms?.uTime) {
      child.material.uniforms.uTime.value = elapsed
    }
    if (child.userData.atmosphereSpin) {
      child.rotation.y += child.userData.atmosphereSpin * dt
    }
  })
}
