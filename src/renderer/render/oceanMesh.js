import * as THREE from 'three'
import { seaShaderChunk, SEA_MAX_AMPLITUDE } from '../world/sea.js'

// Radius the water reaches. Well past the fog wall — the surface must still be
// there when a crest lifts the camera, or you get a hole at the horizon.
const OCEAN_RADIUS = 24000
// Innermost ring. Geometric ring spacing from here out, so the tessellation is
// metres-fine around the hull and hundreds of metres wide at the horizon
// without paying for a uniform grid at either.
const INNER_RADIUS = 5
const RINGS = 180
const SEGMENTS = 220
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
  // Keep swell readable further out so the sea doesn't go plastic-flat.
  vDetail = 1.0 - smoothstep(900.0, 7000.0, dist);
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
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
// How strong the moon's track is relative to the sun's. A full moon is about
// 400,000 times dimmer than the sun; this is a game, so it is a track you can
// actually see — just never mistakable for daylight.
uniform float uMoonBright;
uniform vec3 uDeepColor;
uniform vec3 uCrestColor;
uniform vec3 uSkyColor;
uniform vec3 uZenithColor;
uniform vec3 uFoamColor;
uniform vec3 uAlgaeColor;
varying vec3 vWorldPos;
varying float vDetail;
#include <fog_pars_fragment>

${seaShaderChunk()}

// --- Ripple detail ------------------------------------------------------
// The wave field carries four terms, which is right for the swell the boat has
// to float on but leaves the surface glassy between crests. Everything below
// exists only as a *normal* — it is never displaced, never touches buoyancy,
// and costs nothing but arithmetic. This is the single biggest difference
// between "a shaded height field" and "water".

vec2 hash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

/** Gradient noise, returning value in .x and its 2D gradient in .yz. */
vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);

  vec2 ga = hash22(i + vec2(0.0, 0.0));
  vec2 gb = hash22(i + vec2(1.0, 0.0));
  vec2 gc = hash22(i + vec2(0.0, 1.0));
  vec2 gd = hash22(i + vec2(1.0, 1.0));

  float va = dot(ga, f - vec2(0.0, 0.0));
  float vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0));
  float vd = dot(gd, f - vec2(1.0, 1.0));

  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * (va - vb - vc + vd);
  vec2 g = ga
    + u.x * (gb - ga)
    + u.y * (gc - ga)
    + u.x * u.y * (ga - gb - gc + gd)
    + du * (u.yx * (va - vb - vc + vd) + vec2(vb, vc) - va);
  return vec3(v, g);
}

/**
 * Chop and ripple: four octaves of gradient noise drifting at different speeds
 * and angles. Returns the slope only.
 *
 * The fade argument kills the finest octaves with distance — at 2 km a centimetre ripple
 * is far below a pixel, and keeping it just makes the horizon crawl.
 */
vec2 rippleSlope(vec2 p, float t, float fade) {
  vec2 slope = vec2(0.0);
  float amp = 0.072;
  float freq = 0.09;
  // Each octave drifts on its own bearing *and* is sampled through its own
  // rotation. Without the rotation every octave shares one grid orientation and
  // the whole field lines up into rows — the same corduroy the swell used to
  // have, just finer.
  vec2 drift[6];
  drift[0] = vec2(0.31, 0.14);
  drift[1] = vec2(-0.21, 0.27);
  drift[2] = vec2(0.17, -0.33);
  drift[3] = vec2(-0.29, -0.11);
  drift[4] = vec2(0.09, 0.36);
  drift[5] = vec2(-0.38, 0.05);
  float ang[6];
  ang[0] = 0.0;
  ang[1] = 0.9;
  ang[2] = 1.9;
  ang[3] = 2.7;
  ang[4] = 3.8;
  ang[5] = 5.1;
  for (int i = 0; i < 6; i++) {
    float oct = 1.0 - smoothstep(0.0, 1.0, float(i) / 5.0) * (1.0 - fade);
    if (oct > 0.002) {
      float ca = cos(ang[i]);
      float sa = sin(ang[i]);
      mat2 rot = mat2(ca, -sa, sa, ca);
      vec2 q = rot * (p * freq) + drift[i] * t;
      vec3 n = noised(q);
      // Rotate the gradient back out of the octave's frame, or the slopes of
      // different octaves fight each other instead of adding.
      vec2 g = vec2(n.y * ca + n.z * sa, -n.y * sa + n.z * ca);
      slope += g * amp * freq * oct;
    }
    amp *= 0.66;
    freq *= 2.17;
  }
  return slope;
}

/**
 * Algae bloom mask, 0 outside a bloom and up to 1 in the thick of one.
 *
 * Two scales of noise multiplied together: a big slow one that decides *where*
 * a bloom is at all — they want to be rare and hundreds of metres across — and
 * a finer one that gives the patch a ragged, streaky edge instead of a blob.
 * The whole field drifts, very slowly, because a bloom moves with the water.
 *
 * Purely cosmetic. Nothing in the game logic knows these exist.
 */
float algaeMask(vec2 p, float t) {
  vec2 drift = vec2(t * 0.06, t * -0.035);
  // Where. Threshold high so most of the sea is clear water.
  float region = noised(p * 0.0016 + drift * 0.1).x;
  // ('patch' is a GLSL reserved word — hence 'slick'.)
  // Rarer blooms so most of the sea stays clear water.
  float slick = smoothstep(0.28, 0.52, region);
  if (slick <= 0.001) return 0.0;
  // Shape. Streaks pulled out along the drift, the way a slick actually lies.
  float streak = noised(p * vec2(0.006, 0.018) + drift).x;
  streak += noised(p * vec2(0.021, 0.058) - drift * 1.7).x * 0.5;
  return slick * smoothstep(-0.18, 0.34, streak);
}

void main() {
  // Shading detail runs much further out than the geometry does. Displacement
  // has to fade or huge far triangles turn the swell into noise, but the normal
  // is analytic and per-pixel, so the water keeps its texture right out to the
  // fog wall instead of going glassy a few hundred metres from the boat.
  float dist = length(vWorldPos.xz - cameraPosition.xz);
  float shadeDetail = 1.0 - smoothstep(3500.0, 14000.0, dist);
  vec3 N = seaNormal(vWorldPos.xz, uTime);

  // Two normals, not one.
  //
  // The ripple field is microfacet detail. Feeding it into the *body* shading
  // makes the surface grainy — light and dark speckle across the colour, which
  // is exactly what sand looks like. Real water shows its ripples as
  // **sparkle**: the facets are far too small to shade individually, but they
  // catch the sun and the sky and glitter.
  //
  // So the swell normal drives colour, fresnel and reflection, and the detailed
  // normal drives only the specular lobes. That one split is the difference
  // between a wet beach and open water.
  float rippleFade = 1.0 - smoothstep(80.0, 3200.0, dist);
  vec2 rs = rippleSlope(vWorldPos.xz, uTime, rippleFade);
  vec3 Ndetail = normalize(vec3(N.x - rs.x * 1.15, N.y, N.z - rs.y * 1.15));
  Ndetail = normalize(mix(vec3(0.0, 1.0, 0.0), Ndetail, shadeDetail));
  // Trace of ripple in body only — too much reads as wet plastic, not water.
  N = normalize(mix(N, Ndetail, 0.14));
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, shadeDetail));

  vec3 V = normalize(cameraPosition - vWorldPos);
  float NdV = clamp(dot(N, V), 0.0, 1.0);

  // Schlick, with water's real F0 of about 0.02. The old fixed exponent made
  // every surface either mirror or matte; this gives the proper gradient of
  // dark water underfoot to bright sky at the horizon.
  float fresnel = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  // From a low seat almost everything is near-grazing — clamp far sky or the
  // whole sea bleaches into a mirror sheet (un-water-like general reflection).
  fresnel = mix(fresnel, min(fresnel, 0.48), smoothstep(350.0, 2800.0, dist));

  // Body colour: deep teal underfoot, greener/lighter on tilted faces where
  // the light path through the water is short. Slightly clearer than the old
  // silt-ash palette so it still reads as water, not mud.
  float depthFace = smoothstep(0.78, 1.0, N.y);
  vec3 body = mix(uCrestColor * 0.95, uDeepColor, depthFace) * 0.88;
  // Near the boat, a hint of green-blue absorption (shallow/near column).
  float near = 1.0 - smoothstep(40.0, 420.0, dist);
  body = mix(body, body * vec3(0.90, 1.04, 1.06), near * 0.18);

  // Subsurface scattering. A wave lit from behind glows through its own crest —
  // this is most of why real water looks alive and a shaded height field does
  // not. Strongest where the surface is steep, facing away from us, and the sun
  // is low and behind it.
  float backlight = pow(clamp(dot(V, -normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0), 3.0);
  float steep = smoothstep(0.02, 0.20, 1.0 - N.y);
  float sss = backlight * steep * clamp(1.0 - uSunDir.y, 0.0, 1.0);
  vec3 scatter = uCrestColor * 1.8 + vec3(0.01, 0.11, 0.09) + uSunColor * 0.18;

  // Reflect the *sky*, not a single colour.
  //
  // This is the difference between water and wet sand. Mixing one flat horizon
  // colour by fresnel gives a uniformly tinted matte surface; sampling the sky
  // gradient along the reflected ray means every facet returns the part of the
  // sky it is actually pointed at, so the surface varies across the frame the
  // way a reflective one does. Same curve the sky dome uses, so the two agree.
  vec3 R = reflect(-V, N);
  vec3 skyRefl = mix(uSkyColor, uZenithColor, pow(max(R.y, 0.0), 0.45));
  // Cool + darken the reflection so the body colour still reads as water.
  skyRefl = mix(skyRefl, skyRefl * vec3(0.78, 0.90, 1.02), 0.38);
  skyRefl *= 0.82;
  vec3 col = mix(body, skyRefl, fresnel);
  col += scatter * sss * 0.45 * shadeDetail;

  // Specular. Tight sun *trail* stays visible; broad sheen / glitter stay quiet
  // so the sea doesn't look like foil under the general sky.
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(Ndetail, H), 0.0);
  float sunUp = smoothstep(-0.08, 0.12, uSunDir.y);
  // Trail (the path on the water) — keep this.
  col += uSunColor * pow(ndh, 380.0) * 3.0 * sunUp;
  // Broad general sheen — dialled way down (was washing the whole surface).
  col += uSunColor * pow(ndh, 28.0) * 0.12 * sunUp;
  // Sparse sparkle only near the boat, not a field of hot pixels.
  float sparkle = pow(max(dot(Ndetail, H), 0.0), 140.0) * rippleFade;
  col += uSunColor * sparkle * 0.18 * sunUp;

  // Moonlight. The same two-lobe treatment as the sun — a tight track and a
  // broad sheen — because a moon path on water is the same phenomenon, just
  // far dimmer and colder. Without it a night sea is a flat black sheet.
  vec3 MH = normalize(uMoonDir + V);
  float ndmh = max(dot(Ndetail, MH), 0.0);
  float moonUp = smoothstep(-0.06, 0.10, uMoonDir.y);
  vec3 moonTint = vec3(0.72, 0.80, 0.95);
  col += moonTint * pow(ndmh, 340.0) * 1.1 * moonUp * uMoonBright;
  col += moonTint * pow(ndmh, 26.0) * 0.055 * moonUp * uMoonBright;

  // Algae. Ash and run-off feed it, so the drowned world is thick with the
  // stuff — scattered slicks of green sitting on top of the water rather than
  // in it, which is why this tints the surface *after* the fresnel and
  // scattering and before open-sea whitecaps.
  float algae = algaeMask(vWorldPos.xz, uTime) * shadeDetail;
  // Algae is not bioluminescent. Without tying it to the light level the slicks
  // glow bright green in the middle of the night, which is the one thing on the
  // whole sea that was lighting itself.
  float dayLight = clamp(uSunDir.y * 1.7 + 0.22, 0.06, 1.0);
  if (algae > 0.001) {
    // Thicker in the middle of a slick: it stops looking like water at all and
    // starts looking like a skin on it.
    vec3 bloom = mix(uAlgaeColor, uAlgaeColor * 1.18 + vec3(0.02, 0.04, 0.0), algae) * dayLight;
    col = mix(col, bloom, algae * 0.7);
    // A slick damps the chop and kills the sun track — that flat, dead patch
    // is most of how you spot one from a distance.
    col += uSunColor * pow(ndh, 60.0) * 0.06 * sunUp * (1.0 - algae);
  }

  // Whitecaps only on steeper crests — no object-tied shoreline "surf foam"
  // (that path was more trouble than it was worth).
  float steepness = 1.0 - seaNormal(vWorldPos.xz, uTime).y;
  float foamMask = smoothstep(0.11, 0.26, steepness);
  float breakup = noised(vWorldPos.xz * 0.55 + vec2(uTime * 0.22, uTime * -0.16)).x;
  breakup += noised(vWorldPos.xz * 1.9 - vec2(uTime * 0.4)).x * 0.5;
  // Algae holds the surface together, so a slick foams far less than clear
  // water at the same steepness.
  float foam = foamMask * smoothstep(-0.05, 0.35, breakup) * shadeDetail * (1.0 - algae * 0.75);
  col = mix(col, uFoamColor, clamp(foam, 0.0, 0.38));

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
        // Tinted by the clock — the sun track has to go red at dusk with
        // everything else, or the water reads as lit from a second sky.
        uSunColor: { value: new THREE.Color(0xfff0d8) },
        uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
        uMoonBright: { value: 1 },
        // Open-ocean teal: deep, clear enough to read as water, still not pool-blue.
        uDeepColor: { value: new THREE.Color(0x061a2c) },
        uCrestColor: { value: new THREE.Color(0x1a6a7a) },
        uSkyColor: { value: new THREE.Color(skyColor ?? 0x8a9499) },
        uZenithColor: { value: new THREE.Color(0x3a6e96) },
        uFoamColor: { value: new THREE.Color(0xd8e6ec) },
        // Thin coastal slicks — kept muted so they don't muddy the whole sea.
        uAlgaeColor: { value: new THREE.Color(0x2c4a32) }
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
