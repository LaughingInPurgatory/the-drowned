import * as THREE from 'three'
import { mulberry32 } from '../procgen/prng.js'
import { starTypeForSystem } from '../procgen/starType.js'
import { getSurfaceTextures } from './textures.js'
import {
  createLightningGeometry,
  createLightningMaterial,
  rewriteLightningBolt
} from './lightningBolt.js'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const STAR_HUES = [45, 30, 55, 10, 200]

const BINARY_COMPONENT_TYPES = ['mainSequence', 'redDwarf', 'whiteDwarf']

/** Shortest separation between two hues on the 0-360 wheel. */
function hueDistance(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360)
  return Math.min(d, 360 - d)
}

// Hues a real star can actually be: the black-body track runs deep red →
// orange → yellow → white → blue-white. Nothing else exists — there is no
// green or purple sun. Sibling hue separation has to pick from THIS list
// rather than rotating freely round the wheel, which is how a red dwarf got
// nudged to hue 117 and came out lime green.
const STELLAR_HUES = [0, 14, 28, 42, 54, 200, 212, 224, 238]

// Cheap seeded "value noise" over the unit sphere (a sum of a few sine
// waves at seeded phases) — smooth blotches for plasma / granulation.
function surfaceNoise(nx, ny, nz, seed) {
  return Math.sin(nx * 3.7 + seed[0]) * Math.cos(ny * 4.1 + seed[1]) * Math.sin(nz * 3.3 + seed[2])
}

function surfaceNoiseFbm(nx, ny, nz, seed) {
  let n = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let o = 0; o < 4; o++) {
    n += amp * surfaceNoise(nx * freq, ny * freq, nz * freq, [
      seed[0] + o * 1.9,
      seed[1] + o * 2.4,
      seed[2] + o * 1.3
    ])
    norm += amp
    amp *= 0.5
    freq *= 2.15
  }
  return n / norm
}

// Higher tessellation so the disc stays round and granulation can read.
function detailForRadius(radius) {
  if (radius > 2000) return 7
  if (radius > 800) return 6
  if (radius > 300) return 5
  return 5
}

/**
 * Free procedural solar-granulation albedo (canvas). White-based so
 * material.color / vertexColors tint to each star's hue.
 * Looks like bright convection cells with darker lanes — similar to the
 * reference photosphere, without requiring external textures.
 */
let granulationTexture = null
function getGranulationTexture() {
  if (granulationTexture) return granulationTexture
  if (typeof document === 'undefined') return null
  const W = 1024
  const H = 512
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const img = ctx.createImageData(W, H)
  const d = img.data
  // Hash noise for cell fields
  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const smooth = (t) => t * t * (3 - 2 * t)
  const valueNoise = (x, y) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const xf = smooth(x - x0)
    const yf = smooth(y - y0)
    const a = hash(x0, y0)
    const b = hash(x0 + 1, y0)
    const c = hash(x0, y0 + 1)
    const d0 = hash(x0 + 1, y0 + 1)
    return a * (1 - xf) * (1 - yf) + b * xf * (1 - yf) + c * (1 - xf) * yf + d0 * xf * yf
  }
  const fbm = (x, y) => {
    let v = 0
    let a = 0.5
    let f = 1
    for (let i = 0; i < 5; i++) {
      v += a * valueNoise(x * f, y * f)
      a *= 0.5
      f *= 2.05
    }
    return v
  }
  // Cellular-ish: high-freq fbm + contrast for granule lanes
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W
      const v = y / H
      const n1 = fbm(u * 28, v * 14)
      const n2 = fbm(u * 64 + 3.1, v * 32 + 1.7)
      // Bright cells, darker boundaries (solar granulation)
      let g = n1 * 0.65 + n2 * 0.35
      g = Math.pow(Math.max(0, Math.min(1, g)), 0.85)
      const lane = Math.pow(1 - Math.abs(n2 - 0.5) * 2, 2)
      const bright = 0.55 + g * 0.45
      const dark = 0.22 + lane * 0.15
      const mix = g * 0.75 + (1 - lane) * 0.25
      const lum = dark * (1 - mix) + bright * mix
      // Slight warm bias in the texture (star color multiplies on top)
      const i = (y * W + x) * 4
      d[i] = Math.floor(Math.min(255, lum * 255 * 1.05))
      d[i + 1] = Math.floor(Math.min(255, lum * 255 * 1.02))
      d[i + 2] = Math.floor(Math.min(255, lum * 255 * 0.98))
      d[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  granulationTexture = new THREE.CanvasTexture(canvas)
  granulationTexture.wrapS = granulationTexture.wrapT = THREE.RepeatWrapping
  granulationTexture.repeat.set(3.2, 2.4)
  granulationTexture.anisotropy = 8
  granulationTexture.colorSpace = THREE.SRGBColorSpace
  granulationTexture.needsUpdate = true
  return granulationTexture
}

// Smooth sphere with subtle granulation-scale color noise (texture does most work).
// Mild radial jitter only — reference sun is a clean disc, not a lumpy polyball.
function buildTurbulentSurface(radius, offsets, coreColor, hotColor) {
  const geometry = new THREE.IcosahedronGeometry(radius, detailForRadius(radius))
  const pos = geometry.attributes.position
  const v = new THREE.Vector3()
  const colors = []
  const c = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize()
    const n = surfaceNoiseFbm(v.x, v.y, v.z, offsets)
    // Tiny limb relief — almost smooth sphere like the reference.
    const bump = 1 + n * 0.018
    v.multiplyScalar(radius * bump)
    pos.setXYZ(i, v.x, v.y, v.z)

    // Hot granules vs slightly cooler lanes — keep star hue in both ends.
    const t = Math.pow(Math.max(0, n * 0.5 + 0.5), 0.9)
    c.copy(coreColor).lerp(hotColor, t)
    // Only a whisper toward white. Bleaching the disc here (was 0.22) plus a
    // high-lightness palette plus the HDR overdrive below stacked up to make
    // every star render as the same white ball whatever its type.
    c.lerp(new THREE.Color(1, 1, 1), 0.07)
    colors.push(c.r, c.g, c.b)
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

// Per-type visual parameters. Radius/hue ranges give each type a distinct
// silhouette and color; corona opacity/scale drive the fire blaze intensity
// (e.g. white dwarf = tight hot blaze, giant = huge roaring corona).
const STAR_TYPE_PARAMS = {
  mainSequence: (rng) => ({
    radius: 70 + rng() * 60,
    hue: STAR_HUES[Math.floor(rng() * STAR_HUES.length)],
    // Brighter cores (toward white-hot) while keeping type hue for tints.
    coreSat: 0.85, coreLight: 0.58, hotSat: 0.62, hotLight: 0.78,
    // Corona shells hug the photosphere; keep opacity modest so additive
    // shells don't bleach granulation on the disc face.
    corona1Opacity: 0.22, corona2Opacity: 0.12, corona1Scale: 1.02, corona2Scale: 1.055
  }),
  redDwarf: (rng) => ({
    radius: 30 + rng() * 20,
    hue: 5 + rng() * 15,
    coreSat: 0.95, coreLight: 0.45, hotSat: 0.85, hotLight: 0.62,
    corona1Opacity: 0.2, corona2Opacity: 0.1, corona1Scale: 1.015, corona2Scale: 1.045
  }),
  whiteDwarf: (rng) => ({
    radius: 16 + rng() * 10,
    hue: 200 + rng() * 20,
    coreSat: 0.35, coreLight: 0.8, hotSat: 0.25, hotLight: 0.92,
    corona1Opacity: 0.28, corona2Opacity: 0.14, corona1Scale: 1.012, corona2Scale: 1.035
  }),
  giant: (rng) => {
    const blue = rng() < 0.5
    return {
      radius: 150 + rng() * 50,
      hue: blue ? 210 + rng() * 20 : 5 + rng() * 10,
      coreSat: 0.88, coreLight: 0.55, hotSat: 0.65, hotLight: 0.76,
      corona1Opacity: 0.2, corona2Opacity: 0.11, corona1Scale: 1.025, corona2Scale: 1.06
    }
  }
}

// Suns "400% bigger", then "another 200% bigger" (3x on top) per two rounds
// of user request — a single multiplier here (rather than editing every
// STAR_TYPE_PARAMS range) since corona scales are already relative to radius
// and grow with it automatically. (Was 2.5, then 12.5 — each pass still read
// as too small.)
// 6× prior scale (37.5) — suns "600% bigger" pass.
const STAR_SIZE_SCALE = 225

// Soft multi-stop radial blaze (lazy — tests import this module with no DOM).
// White-core gradient so SpriteMaterial.color fully tints the fire to the star.
// Strong inner disc + long soft falloff = blazing sun, not a faint coin glow.
let haloTexture = null
function getHaloTexture() {
  if (haloTexture) return haloTexture
  if (typeof document === 'undefined') return null
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const c = size / 2
  // Soft *ring* glow — centre stays mostly clear so additive sprites do not
  // bleach the granulation texture when they breathe. Energy sits in the mid
  // annulus (limb / corona), then falls off.
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0.0, 'rgba(255,255,255,0)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.04)')
  g.addColorStop(0.38, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.52, 'rgba(255,255,255,0.72)')
  g.addColorStop(0.68, 'rgba(255,255,255,0.28)')
  g.addColorStop(0.85, 'rgba(255,255,255,0.08)')
  g.addColorStop(1.0, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // Subtle turbulent flecks in the mid ring only (avoid the disc centre).
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2
    const r = c * (0.32 + Math.random() * 0.42)
    const x = c + Math.cos(a) * r
    const y = c + Math.sin(a) * r
    const s = 4 + Math.random() * 14
    const alpha = 0.03 + Math.random() * 0.08
    const gg = ctx.createRadialGradient(x, y, 0, x, y, s)
    gg.addColorStop(0, `rgba(255,255,255,${alpha})`)
    gg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gg
    ctx.beginPath()
    ctx.arc(x, y, s, 0, Math.PI * 2)
    ctx.fill()
  }
  haloTexture = new THREE.CanvasTexture(canvas)
  return haloTexture
}

// How far a flame tongue's root is sunk BELOW the photosphere, as a fraction
// of its own length. The star is opaque and writes depth, so the buried part is
// properly occluded and the tongue reads as erupting out of the surface rather
// than being stuck on top of it.
const FLAME_ROOT_SINK = 0.18

// Elongated soft streak for coronal streamers (drawn once, reused).
// White so star color multiplies cleanly into fire streamers.
let streamerTexture = null
function getStreamerTexture() {
  if (streamerTexture) return streamerTexture
  if (typeof document === 'undefined') return null
  const w = 96
  const h = 256
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  // An actual flame silhouette, not a soft column. Earlier versions were a
  // gaussian bar of constant width — no amount of resizing makes a straight
  // sided blob read as fire, which is why the tongues looked like spikes and
  // then like dashes. A flame is defined by its OUTLINE: flared near the base,
  // tapering to a point, with a wavy edge and a hotter root.
  //
  // v runs 0 at the base (anchored on the photosphere) to 1 at the tip; the
  // sprite's local +Y is aimed radially outward, and texture v increases with
  // +Y, so v maps directly to "distance out from the star".
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    // Canvas row 0 is the TOP, but texture v=0 is the BOTTOM — so this has to
    // be flipped or the flared root gets written at the outer tip and every
    // tongue comes out club-shaped instead of tapered.
    const v = 1 - y / (h - 1)
    // Taper: rises quickly off the root, then narrows to nothing at the tip.
    let halfWidth = Math.pow(1 - v, 0.9) * (0.34 + 0.66 * Math.min(1, v / 0.18))
    // Wavy edge — this is what makes the outline lick rather than sit straight.
    halfWidth *= 1 + 0.42 * Math.sin(v * 6.0 + 1.3) + 0.22 * Math.sin(v * 13.0 + 0.4)
    halfWidth = Math.max(0, halfWidth)
    // Hotter and denser at the root, thinning out toward the tip.
    const intensity = Math.pow(1 - v, 0.7)
    for (let x = 0; x < w; x++) {
      const sx = Math.abs((x / (w - 1)) * 2 - 1)
      let a = 0
      if (halfWidth > 1e-4) {
        // 1 in the core of the tongue, fading to 0 at its wavy edge.
        const e = sx / halfWidth
        a = e >= 1 ? 0 : Math.pow(1 - e * e, 1.7)
      }
      const i = (y * w + x) * 4
      d[i] = 255
      d[i + 1] = 255
      d[i + 2] = 255
      d[i + 3] = Math.round(255 * a * intensity)
    }
  }
  ctx.putImageData(img, 0, 0)
  streamerTexture = new THREE.CanvasTexture(canvas)
  return streamerTexture
}

/**
 * Animated corona flame material.
 *
 * The shells used to be static vertex-coloured geometry that only breathed in
 * scale, so a corona read as a soft gas balloon rather than something burning.
 * The turbulence now lives in the fragment shader and is driven by uTime, which
 * means real licking flame motion for zero CPU cost per frame (the alternative
 * was re-displacing four shells of geometry every frame like the plasma rings
 * do). Colour is passed in from the star's own hue, so a red dwarf burns red
 * and a blue giant burns blue.
 *
 * Drawn BackSide: the opaque photosphere occludes the near hemisphere, leaving
 * only the limb, which is exactly where a corona belongs.
 */
function buildCoronaFlameMaterial(deepColor, hotColor, opacity, seed, speed, radial) {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: deepColor.clone() },
      uHot: { value: hotColor.clone() },
      uOpacity: { value: opacity },
      uSeed: { value: seed },
      uRadial: { value: radial },
      uSpeed: { value: speed }
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        vLocal = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uHot;
      uniform float uOpacity;
      uniform float uSeed;
      uniform float uSpeed;
      uniform float uRadial;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vViewW;

      float hash(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
      }
      float vnoise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
              mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
              mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
          f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * vnoise(p);
          p *= 2.07;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        #include <logdepthbuf_fragment>
        vec3 dir = normalize(vLocal);
        float t = uTime * uSpeed;
        vec3 q = dir * 7.5 + uSeed;
        // Domain warp: turbulence dragged through another turbulence field is
        // what separates rolling flame from a wobbling sphere.
        vec3 warp = vec3(fbm(q * 0.8 - t * 0.22), fbm(q * 0.8 + t * 0.19), fbm(q * 0.9 - t * 0.15));
        float body = fbm(q + warp * 1.9 + vec3(0.0, t * 0.55, 0.0));
        // smoothstep, NOT pow. A pow curve never actually reaches zero, so the
        // extra detail octaves laid a constant haze across the whole shell and
        // four of them stacked into a solid brown husk. smoothstep produces
        // true gaps, and the gaps are what read as separate tongues of flame.
        //
        // The threshold rises with uRadial, so a tongue has to burn hotter to
        // still show at the outer shells — that taper across the stack is the
        // flame silhouette.
        // Range matters: this fbm is 4 octaves of value noise with amplitudes
        // summing to 0.94 and a mean near 0.47, so it rarely passes ~0.65. An
        // outer threshold of 0.70 was effectively never reached and those
        // shells never drew at all. These bounds sit inside the real range.
        float thresh = mix(0.34, 0.54, uRadial);
        float tongue = smoothstep(thresh, thresh + 0.20, body);
        // Fast licks gated INSIDE existing tongues, so they add flicker rather
        // than a second layer of haze over the gaps.
        float licks = smoothstep(0.52, 0.72, fbm(q * 3.4 - t * 1.15));
        float flame = tongue * (1.0 + 0.9 * licks);
        // BackSide normals face inward; abs() gives a limb term either way.
        float rim = 1.0 - abs(dot(normalize(vNormalW), normalize(vViewW)));
        // Low power: a high exponent squeezed the flame into a razor rim, so
        // the tongues had nowhere to show and it read as a smooth halo.
        float limb = pow(clamp(rim, 0.0, 1.0), 1.5);
        float a = clamp(flame, 0.0, 1.6) * limb * uOpacity;
        // Hot cores in the tongues, deep star hue in the gaps.
        vec3 col = mix(uDeep, uHot, clamp(pow(flame, 0.4), 0.0, 1.0));
        col *= 1.0 + flame * 0.85; // tips run over 1.0 so bloom ignites them
        gl_FragColor = vec4(col * a, a);
      }`
  })
}

// Builds one star's core + corona shells inside its own group (so a binary
// pair can position/spin each component independently). Returns the group
// plus the bits updateStarMesh needs to animate it each frame.
function buildSingleStar(type, rng, avoidHues = []) {
  const params = STAR_TYPE_PARAMS[type](rng)
  // In a binary/trinary, shove this component's hue clear of its siblings.
  // Component types are drawn without replacement, but a main-sequence star can
  // still roll the blue end of STAR_HUES and land on top of a white dwarf — so
  // the hues themselves get separated too, or the system reads as two or three
  // identical suns.
  if (avoidHues.length && avoidHues.some((h) => hueDistance(h, params.hue) < 35)) {
    // Move to whichever plausible stellar hue sits furthest from the siblings,
    // tie-broken toward this star's own type hue so a red dwarf stays reddish
    // if anything red is still free.
    let best = params.hue
    let bestScore = -1
    for (const cand of STELLAR_HUES) {
      const clearance = Math.min(...avoidHues.map((h) => hueDistance(h, cand)))
      const score = clearance - hueDistance(cand, params.hue) * 0.25
      if (score > bestScore) {
        bestScore = score
        best = cand
      }
    }
    params.hue = best
  }
  const radius = params.radius * STAR_SIZE_SCALE
  const offsets = [rng() * 10, rng() * 10, rng() * 10]
  const coreColor = new THREE.Color().setHSL(params.hue / 360, params.coreSat, params.coreLight)
  const hotColor = new THREE.Color().setHSL(params.hue / 360, params.hotSat, params.hotLight)
  const color = new THREE.Color().setHSL(params.hue / 360, 0.9, 0.6)

  const group = new THREE.Group()

  // Granulation map (free procedural) + star-tinted vertex colors.
  // Clone so each star can scroll offset independently (boiling surface).
  const granSrc = getGranulationTexture()
  const coreMap = granSrc ? granSrc.clone() : getSurfaceTextures('volcanic').map.clone()
  if (coreMap.repeat) coreMap.repeat.set(3.2, 2.4)
  // Surface tint keeps the star's hue while pushing toward white-hot blaze.
  // Deliberately driven past 1.0: the corona shells are BackSide now, so they
  // no longer lay additive brightness over the disc face, and without this the
  // photosphere renders as a dull grey rock. The composer target is HDR, so
  // over-range values survive to the bloom pass (threshold 1.0) and get rolled
  // back to white-hot by tone mapping — a star that blazes and blooms on its
  // own merits rather than borrowing it from a veil in front of it.
  // Overdrive a SATURATED colour, not a near-white one. Scaling (1,.95,.85) by
  // 2.4 clips every channel and tone-maps to flat white; scaling a saturated
  // hue keeps the channel ratios, so the star stays bright AND coloured.
  const surfaceTint = hotColor.clone().lerp(new THREE.Color(1, 1, 1), 0.12).multiplyScalar(1.8)
  const core = new THREE.Mesh(
    buildTurbulentSurface(radius, offsets, coreColor, hotColor),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: coreMap,
      color: surfaceTint,
      // Must write depth so the starfield shell (far, additive) fails depth
      // where the photosphere covers the sky.
      depthWrite: true,
      depthTest: true
    })
  )
  core.frustumCulled = false
  core.renderOrder = 0
  group.add(core)

  // Corona / limb palette — star hue, pushed bright for a solar rim look.
  // Corona is the star's own outer atmosphere, so it must carry the star's
  // hue — it was washing to white at 0.55/0.25 and made every corona identical.
  const fireHot = hotColor.clone().lerp(new THREE.Color(1, 1, 1), 0.28)
  const fireMid = color.clone().lerp(hotColor, 0.35).lerp(new THREE.Color(1, 1, 1), 0.1)
  const fireOuter = color.clone().lerp(new THREE.Color().setHSL(params.hue / 360, 0.55, 0.55), 0.35)

  const haloMap = getHaloTexture()

  // Limb-only glow sprites (halo map is a soft ring — centre is clear so the
  // photosphere texture stays sharp). Opacity of *outer* layers may breathe;
  // the tight rim stays steady so granulation never washes out.
  const haloCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloMap,
    color: fireHot,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  }))
  // Slightly larger than the disc so the bright ring sits on the limb.
  const haloCoreBase = radius * 2.08
  haloCore.scale.setScalar(haloCoreBase)
  haloCore.frustumCulled = false
  group.add(haloCore)

  // Soft atmospheric glow just outside the photosphere.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloMap,
    color: fireMid,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  }))
  const haloBase = radius * 2.45
  halo.scale.setScalar(haloBase)
  halo.frustumCulled = false
  group.add(halo)

  // Thin outer corona haze (still close to the limb).
  const haloOuter = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloMap,
    color: fireOuter,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  }))
  const haloOuterBase = radius * 2.9
  haloOuter.scale.setScalar(haloOuterBase)
  haloOuter.frustumCulled = false
  group.add(haloOuter)

  // Very soft far bloom.
  const haloFar = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloMap,
    color: fireOuter.clone().lerp(fireHot, 0.3),
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  }))
  const haloFarBase = radius * 3.4
  haloFar.scale.setScalar(haloFarBase)
  haloFar.frustumCulled = false
  group.add(haloFar)

  // Distant pinprick (angular-size floor applied in updateStarMesh).
  const distantSpot = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloMap,
    color: fireHot,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  }))
  const distantSpotBase = radius * 1.7
  distantSpot.scale.setScalar(distantSpotBase)
  distantSpot.frustumCulled = false
  group.add(distantSpot)

  // Soft volumetric shells near the surface (subtle limb structure).
  const coronaDetail = Math.max(5, detailForRadius(radius))
  const coronaSeed = rng() * 20
  // radial: 0 at the innermost shell, 1 at the outermost — drives how hard a
  // tongue has to burn to still show this far out, which is what tapers it.
  function buildCoronaShell(scale, opacity, shellColor, radial = 0) {
    const geo = new THREE.IcosahedronGeometry(radius * scale, coronaDetail)
    const pos = geo.attributes.position
    const colors = []
    const v = new THREE.Vector3()
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
      const n = surfaceNoiseFbm(v.x / radius, v.y / radius, v.z / radius, offsets)
      // Gentle irregular limb only (reference corona is soft, not spiky).
      const bump = 1 + n * 0.045
      v.multiplyScalar(bump)
      pos.setXYZ(i, v.x, v.y, v.z)
      c.copy(shellColor).lerp(fireHot, Math.pow(Math.max(0, n * 0.5 + 0.5), 1.2) * 0.6)
      colors.push(c.r, c.g, c.b)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    // Each shell gets its own seed/speed so the four layers churn against each
    // other instead of flickering in unison.
    const mat = buildCoronaFlameMaterial(
      shellColor,
      fireHot,
      opacity,
      // ONE seed shared by all four shells. Per-shell seeds made each layer an
      // independent noise field, so a tongue at a given direction never lined
      // up between radii and the stack averaged into a featureless husk.
      // Sharing it means a hot direction is hot at every radius — that
      // correlation IS the radial tongue.
      coronaSeed,
      0.85 + rng() * 0.3,
      radial
    )
    return new THREE.Mesh(geo, mat)
  }

  // Spread the shells well clear of the photosphere. They used to sit inside
  // 1.13x radius, which left the flame shader no room — the tongues were
  // clipped into a thin rim and read as a smooth halo. Multipliers stay
  // relative to the type's own corona scale so a white dwarf keeps its tight
  // blaze and a giant its big roaring one. Opacities up to match, since the
  // flame term is sparse (it is mostly transparent between tongues).
  const corona1 = buildCoronaShell(params.corona1Scale, params.corona1Opacity * 2.8, fireMid, 0)
  group.add(corona1)
  const corona2 = buildCoronaShell(params.corona2Scale * 1.14, params.corona2Opacity * 3.2, fireMid, 0.34)
  group.add(corona2)
  const corona3 = buildCoronaShell(params.corona2Scale * 1.34, params.corona2Opacity * 2.4, fireMid, 0.67)
  group.add(corona3)
  const corona4 = buildCoronaShell(params.corona2Scale * 1.6, params.corona2Opacity * 1.6, fireOuter, 1)
  group.add(corona4)

  // Prominence / filament streamers around the full limb (like the reference).
  const streamers = []
  // Flame tongues licking off the limb. These are what actually *emanate* from
  // the star — the corona shells are closed spheres and so can only ever
  // produce a bubble around it, never anything reaching outward.
  const streamerCount = 58 + Math.floor(rng() * 24)
  for (let i = 0; i < streamerCount; i++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getStreamerTexture(),
      // Biased toward the mid fire tone: fireHot is lerped toward white, so
      // leading with it made the tongues read as pale needles rather than fire.
      color: fireMid.clone().lerp(fireHot, rng() * 0.2),
      transparent: true,
      opacity: 0.3 + rng() * 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }))
    // Spherical distribution so filaments ring the whole disc.
    const theta = rng() * Math.PI * 2
    const phi = Math.acos(2 * rng() - 1)
    const dir = new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    )
    // Aspect matters more than size: at 14:1 these were needles. Flame
    // tongues are stubby, roughly 1.5-4x as long as they are wide.
    const width = radius * (0.24 + rng() * 0.26)
    const length = radius * (0.12 + rng() * 0.19)
    spr.scale.set(width, length, 1)
    // A sprite is positioned by its CENTRE, so a tongue of length L sits at
    // radius + L/2 to stand on the surface — less FLAME_ROOT_SINK so the root
    // starts just inside the star. (The original code placed the centre at
    // ~1.01x radius, burying the whole inner half and leaving only a stub.)
    spr.position.copy(dir).multiplyScalar(radius + length * (0.5 - FLAME_ROOT_SINK))
    group.add(spr)
    streamers.push({
      mesh: spr,
      dir,
      width,
      baseLength: length,
      phase: rng() * Math.PI * 2,
      speed: 0.5 + rng() * 0.9
    })
  }

  // Coronal mass ejections — pooled, launched occasionally (see updateStarCmes).
  const cmes = buildCmePool(group, radius, color, rng)

  group.frustumCulled = false
  return {
    group,
    radius,
    hue: params.hue,
    color,
    spinSpeed: 0.015 + rng() * 0.02,
    pulsePhase: rng() * Math.PI * 2,
    corona1,
    corona2,
    corona3,
    corona4,
    streamers,
    haloCore,
    halo,
    haloOuter,
    haloFar,
    distantSpot,
    haloCoreBase,
    haloBase,
    haloOuterBase,
    haloFarBase,
    distantSpotBase,
    coreMap,
    // Slow, slightly diagonal texture drift — see updateStarMesh.
    mapDrift: [0.004 + rng() * 0.004, 0.002 + rng() * 0.003],
    cmes
  }
}

// Prebuild a few reusable CME groups per star (never allocate mid-flight).
// Each is a short plasma loop/jet: root blob + expanding arc puffs + leading ribbon.
function buildCmePool(starGroup, radius, starColor, rng) {
  const pool = []
  const poolSize = 3
  // Ejected material is the star's own plasma, so both ends of the ramp come
  // from its hue. The old `mid` lerped toward a fixed orange, which made a
  // blue giant throw orange gas.
  const cmeHsl = { h: 0.08, s: 1, l: 0.5 }
  starColor.getHSL(cmeHsl)
  const hot = new THREE.Color().setHSL(cmeHsl.h, 0.45, 0.85)
  const mid = new THREE.Color().setHSL(cmeHsl.h, 0.95, 0.5)

  for (let i = 0; i < poolSize; i++) {
    const g = new THREE.Group()
    g.visible = false

    // Root flare at the surface (bright lift-off). A soft billboard, not a
    // sphere: lit gas has no silhouette, and the old shaded spheres read as
    // solid bubbles being lobbed off the star.
    const root = new THREE.Sprite(new THREE.SpriteMaterial({
      map: plasmaPuffTexture(),
      color: hot,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }))
    g.add(root)

    // Plasma along the erupting loop. Many small billboards beat a few big
    // spheres — overlapping soft sprites are what makes it read as gas.
    const puffs = []
    const PUFF_N = 18
    for (let p = 0; p < PUFF_N; p++) {
      const t = p / (PUFF_N - 1)
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: plasmaPuffTexture(),
        // Hottest at the apex, cooling toward the anchored footpoints.
        color: mid.clone().lerp(hot, Math.sin(t * Math.PI)),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }))
      puff.frustumCulled = false
      g.add(puff)
      puffs.push(puff)
    }

    // Leading ribbon / streamer sprite (camera-facing gas sheet).
    const ribbon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getStreamerTexture(),
      color: hot,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }))
    g.add(ribbon)

    // Soft halo around the front of the mass.
    const frontHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getHaloTexture(),
      color: mid,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }))
    g.add(frontHalo)

    starGroup.add(g)
    pool.push({
      group: g,
      root,
      puffs,
      ribbon,
      frontHalo,
      active: false,
      age: 0,
      duration: 6,
      // Local unit direction of ejection (from star center).
      dir: new THREE.Vector3(1, 0, 0),
      speed: radius * 0.35,
      // ~⅔ of previous scale (user: reduce CME size by a third).
      size: radius * 0.2 * (2 / 3),
      // Angular half-separation of the loop's two footpoints on the surface.
      span: 0.5,
      phase: 0,
      peak: 1
    })
  }

  return {
    pool,
    // First CME after a short settle so menu/load isn't an instant blast.
    nextAt: 12 + rng() * 28,
    // Mean ~38s between ejections; jitter keeps them irregular.
    meanInterval: 32 + rng() * 18,
    rngSeed: rng() * 1e6
  }
}

// Cheap deterministic-ish float from a seed + salt (no need to re-seed mulberry).
function cmeRand(seed, salt) {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

function launchCme(star, elapsed) {
  const cmes = star.cmes
  if (!cmes) return
  const slot = cmes.pool.find((c) => !c.active)
  if (!slot) return

  const seed = cmes.rngSeed + elapsed * 17.13
  // Random direction on the sphere (slightly prefer mid-latitudes — real CMEs).
  const u = cmeRand(seed, 1)
  const v = cmeRand(seed, 2)
  const theta = u * Math.PI * 2
  const phi = Math.acos(2 * v - 1) * 0.75 + Math.PI * 0.125 // avoid pure poles a bit
  slot.dir.set(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  ).normalize()

  slot.active = true
  slot.age = 0
  slot.duration = 5 + cmeRand(seed, 3) * 4.5
  // Size ~⅔ of original (reduce CMEs by a third).
  const sizeScale = 2 / 3
  slot.speed = star.radius * (0.28 + cmeRand(seed, 4) * 0.35) * sizeScale
  slot.size = star.radius * (0.12 + cmeRand(seed, 5) * 0.18) * sizeScale
  slot.peak = 0.85 + cmeRand(seed, 6) * 0.35
  // Angular half-separation of the loop's footpoints (radians on the surface).
  // Narrow = a tight jet, wide = a broad prominence arch.
  slot.span = 0.22 + cmeRand(seed, 8) * 0.5
  slot.phase = cmeRand(seed, 9) * Math.PI * 2
  slot.group.visible = true
  slot.group.position.set(0, 0, 0)

  // Schedule next: rare-ish but regular enough to notice in a play session.
  const gap = cmes.meanInterval * (0.55 + cmeRand(seed, 7) * 0.9)
  cmes.nextAt = elapsed + Math.max(18, gap)
}

function updateStarCmes(star, elapsed, dt, camera) {
  const cmes = star.cmes
  if (!cmes) return

  if (elapsed >= cmes.nextAt) launchCme(star, elapsed)

  for (const cme of cmes.pool) {
    if (!cme.active) continue
    cme.age += dt
    const u = Math.min(1, cme.age / cme.duration)
    // Ease-out expansion: fast launch, then coast / disperse.
    const travel = cme.speed * (cme.age * (0.55 + 0.45 * (1 - u * u)))
    const front = star.radius * 1.02 + travel
    // Opacity: bright rise, long fade.
    const fade = u < 0.12 ? u / 0.12 : Math.pow(1 - (u - 0.12) / 0.88, 1.35)
    const opacity = Math.max(0, fade * cme.peak)

    // Root sits on the photosphere, flaring as the mass lifts off.
    cme.root.position.copy(cme.dir).multiplyScalar(star.radius * 1.02)
    const rootScale = cme.size * (1.2 + u * 2.5) * (u < 0.2 ? 1.4 : 1 - u * 0.5)
    cme.root.scale.setScalar(Math.max(0.01, rootScale))
    cme.root.material.opacity = opacity * (u < 0.35 ? 1 : 1 - (u - 0.35) * 1.2)

    // Erupting magnetic loop, which is what a CME actually is: a filament
    // anchored at two footpoints on the photosphere whose apex balloons
    // outward and finally tears free. The old version flew a helix of beads
    // straight out along one axis, which is why it read as a thrown object
    // rather than the star's own atmosphere lifting off.
    //
    // Frame is rebuilt per CME (not per puff) into scratch vectors — this runs
    // for every puff of every active CME of every star, every frame.
    const ax = Math.abs(cme.dir.y) < 0.9 ? 0 : 1
    _cmeSide.set(ax, 1 - ax, 0).cross(cme.dir).normalize()
    _cmeUp.crossVectors(cme.dir, _cmeSide).normalize()
    // Footpoints spread apart as the loop inflates.
    const halfSpan = cme.span * (0.55 + u * 0.75)
    // Apex height above the surface — this is the actual ejection.
    const apex = travel * 1.15
    for (let i = 0; i < cme.puffs.length; i++) {
      const puff = cme.puffs[i]
      const t = i / (cme.puffs.length - 1)
      const arch = Math.sin(t * Math.PI) // 0 at both feet, 1 at apex
      // Sweep from one footpoint to the other around the star.
      const a = (t * 2 - 1) * halfSpan
      // Rise from the surface to the apex along the arch.
      const r = star.radius * 1.01 + apex * arch
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      _cmeTmp
        .copy(cme.dir).multiplyScalar(ca)
        .addScaledVector(_cmeSide, sa)
        .multiplyScalar(r)
      // Wispiness: slow per-puff drift out of the loop plane so the filament
      // frays instead of staying a clean wire.
      const wob = cme.size * (0.5 + u * 2.2)
      const ph = cme.phase + i * 1.7
      _cmeTmp
        .addScaledVector(_cmeUp, Math.sin(elapsed * 0.7 + ph) * wob * arch)
        .addScaledVector(_cmeSide, Math.sin(elapsed * 0.53 + ph * 1.3) * wob * 0.5 * arch)
      puff.position.copy(_cmeTmp)
      // Fat at the apex, pinched at the anchored feet.
      const puffScale = cme.size * (0.45 + arch * 1.5) * (1 + u * 3.2)
      puff.scale.setScalar(Math.max(0.01, puffScale))
      // Feet fade first — the loop detaches and the apex sails on.
      const detach = Math.max(0, 1 - Math.max(0, u - 0.45) / 0.55)
      puff.material.opacity =
        opacity * (0.3 + 0.7 * arch) * (arch < 0.35 ? detach : 1)
    }

    // Ribbon points along the jet (sprite is camera-facing; stretch length).
    const tip = front * 1.05
    cme.ribbon.position.copy(cme.dir).multiplyScalar(tip * 0.72)
    cme.ribbon.scale.set(
      cme.size * (1.5 + u * 4),
      cme.size * (4 + u * 10),
      1
    )
    cme.ribbon.material.opacity = opacity * 0.65
    // Sprite rotation is SCREEN space. This used to be set from
    // atan2(dir.x, dir.z) — a WORLD-space XZ heading, which has no relation to
    // the screen angle, so the ribbon pointed off in an arbitrary direction.
    // Harmless while the texture was a symmetric blur; now that it is a
    // directional flame (flared root, tapered tip) it read as an errant flame
    // firing sideways out of the ejection. Aim it by projecting instead.
    if (camera) {
      star.group.getWorldPosition(_flameCentre)
      cme.ribbon.getWorldPosition(_flameWorld)
      _flameWorld.project(camera)
      _flameProj.copy(_flameCentre).project(camera)
      const dx = _flameWorld.x - _flameProj.x
      const dy = _flameWorld.y - _flameProj.y
      if (dx * dx + dy * dy > 1e-12) {
        cme.ribbon.material.rotation = Math.atan2(-dx, dy)
      }
    }

    cme.frontHalo.position.copy(cme.dir).multiplyScalar(tip)
    const haloS = cme.size * (3 + u * 8)
    cme.frontHalo.scale.setScalar(Math.max(0.01, haloS))
    cme.frontHalo.material.opacity = opacity * 0.45

    // Peak corona swell from the youngest active CME (applied once after loop).
    if (u < 0.18) {
      cmes.coronaPunch = Math.max(cmes.coronaPunch ?? 0, (1 - u / 0.18) * 0.12)
    }

    if (u >= 1) {
      cme.active = false
      cme.group.visible = false
    }
  }
}

// Soft radial-gradient sprite for gaseous plasma puffs (shared).
let _plasmaPuffTex = null
function plasmaPuffTexture() {
  if (_plasmaPuffTex) return _plasmaPuffTex
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,220,140,1)')
  grd.addColorStop(0.25, 'rgba(255,120,40,0.7)')
  grd.addColorStop(0.55, 'rgba(180,30,20,0.3)')
  grd.addColorStop(1, 'rgba(40,0,10,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  _plasmaPuffTex = new THREE.CanvasTexture(c)
  return _plasmaPuffTex
}

// Fire ramp generated from one star's hue: dark saturated smoke climbing to a
// near-white core. Only the ramp is fixed, so any hue reads as "burning".
function ringPalette(starColor) {
  const hsl = { h: 0.05, s: 1, l: 0.5 }
  if (starColor) (starColor.isColor ? starColor : new THREE.Color(starColor)).getHSL(hsl)
  const h = hsl.h
  return {
    h,
    deepOuter: new THREE.Color().setHSL(h, 1, 0.15),
    hotOuter: new THREE.Color().setHSL(h, 0.95, 0.42),
    deepMid: new THREE.Color().setHSL(h, 1, 0.3),
    hotMid: new THREE.Color().setHSL(h, 0.85, 0.62),
    deepCore: new THREE.Color().setHSL(h, 0.55, 0.74),
    hotCore: new THREE.Color().setHSL(h, 0.22, 1)
  }
}

// Centerline of the plasma bridge: imperfect ellipse + multi-harmonic warp
// so it never reads as a clean torus, while still roughly linking both suns
// (radius ≈ separation/2, center at the pair midpoint).
function energyRingPathPoint(theta, radius, t, warp) {
  const w1 = Math.sin(2 * theta + t * warp.flow1 + warp.p1)
  const w2 = Math.sin(3 * theta - t * warp.flow2 + warp.p2)
  const w3 = Math.sin(5 * theta + t * warp.flow3 + warp.p3)
  // Fourth, fastest harmonic: fine crenellation so the silhouette licks and
  // gutters like flame instead of undulating as a smooth ribbon.
  const w4 = Math.sin(9 * theta - t * warp.flow4 + warp.p4)
  // Both suns sit on the ring's major axis at theta 0 and PI, so displacement
  // has to fall to nothing there or the bridge misses the stars it is meant to
  // link. |sin| pins both ends and lets the thrash peak across the mid-span.
  const anchor = Math.abs(Math.sin(theta))
  const radial = 1 + (warp.a1 * w1 + warp.a2 * w2 + warp.a3 * w3 + warp.a4 * w4) * anchor
  // Mild ellipse that breathes over time.
  // Only breathe across the minor axis; stretching x would slide the ring's
  // ends off the two stars again.
  const ex = 1
  const ez = 1 - warp.ellipse * 0.85 * Math.sin(t * warp.ellipseSpeed + 0.8)
  const r = radius * radial
  const y =
    radius * anchor * (warp.y1 * Math.sin(2 * theta + t * warp.yFlow1 + warp.py1)
      + warp.y2 * Math.sin(3 * theta - t * warp.yFlow2 + warp.py2)
      + warp.y3 * Math.sin(4 * theta + t * warp.yFlow3))
  return {
    x: Math.cos(theta) * r * ex,
    y,
    z: Math.sin(theta) * r * ez
  }
}

// Build a soft tube along the warped path (not a perfect TorusGeometry).
// tubularSegs along the loop, radialSegs around the tube cross-section.
function buildWarpedTubeGeometry(radius, tubeR, tubularSegs, radialSegs, warp, t = 0, ends, noiseOffsets) {
  const positions = []
  const colors = []
  const indices = []
  const c = new THREE.Color()
  const deepA = ends.deepA
  const hotA = ends.hotA
  const deepB = ends.deepB
  const hotB = ends.hotB
  const deep = new THREE.Color()
  const hot = new THREE.Color()

  const centers = []
  for (let i = 0; i <= tubularSegs; i++) {
    const theta = (i / tubularSegs) * Math.PI * 2
    centers.push(energyRingPathPoint(theta, radius, t, warp))
  }

  for (let i = 0; i <= tubularSegs; i++) {
    const p = centers[i]
    const prev = centers[(i - 1 + tubularSegs) % tubularSegs]
    const next = centers[(i + 1) % tubularSegs]
    // Tangent along the path.
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    let tz = next.z - prev.z
    const tlen = Math.hypot(tx, ty, tz) || 1
    tx /= tlen; ty /= tlen; tz /= tlen
    // Build a frame (N, B) perpendicular to tangent.
    let nx = -ty, ny = tx, nz = 0
    let nlen = Math.hypot(nx, ny, nz)
    if (nlen < 1e-4) { nx = 0; ny = -tz; nz = ty; nlen = Math.hypot(nx, ny, nz) || 1 }
    nx /= nlen; ny /= nlen; nz /= nlen
    // B = T × N
    let bx = ty * nz - tz * ny
    let by = tz * nx - tx * nz
    let bz = tx * ny - ty * nx
    const blen = Math.hypot(bx, by, bz) || 1
    bx /= blen; by /= blen; bz /= blen

    // Tube radius also breathes irregularly along the path.
    const theta = (i / tubularSegs) * Math.PI * 2
    // Wide, fast thickness variation — the bridge should bulge and neck down
    // violently along its length rather than read as an even-bore pipe.
    // Flare the bore where the bridge meets each sun (theta 0 and PI) so it
    // plunges into the photosphere instead of poking at it with a thin wire.
    const endFlare = 1 + 1.5 * Math.pow(Math.abs(Math.cos(theta)), 6)
    const tubeScale =
      endFlare *
      (1 +
        0.42 * Math.sin(3 * theta + t * 1.1) +
        0.26 * Math.sin(7 * theta - t * 0.7) +
        0.15 * Math.sin(13 * theta + t * 1.9))
    const tr = tubeR * tubeScale

    for (let j = 0; j <= radialSegs; j++) {
      const phi = (j / radialSegs) * Math.PI * 2
      const cp = Math.cos(phi)
      const sp = Math.sin(phi)
      const px = p.x + (nx * cp + bx * sp) * tr
      const py = p.y + (ny * cp + by * sp) * tr
      const pz = p.z + (nz * cp + bz * sp) * tr
      positions.push(px, py, pz)

      const nNoise = surfaceNoise(px / radius, py / radius, pz / radius, noiseOffsets)
      // Hotter toward tube center (lower |phi variation| is wrong — use radial
      // ring angle + noise for fire blotches).
      const heat = Math.pow(Math.max(0, 0.45 + nNoise * 0.7 + 0.25 * Math.sin(theta * 4 + phi * 2)), 0.75)
      // Each end of the bridge takes its own star's colour, and the two fight
      // over the middle. The boundary is not a fixed midpoint: it surges back
      // and forth on two out-of-step periods, so one star's plasma drives deep
      // into the other's half and then gets pushed back. Averaging the hues
      // instead would invent a third colour belonging to neither star.
      const q = (1 - Math.cos(theta)) * 0.5 // 0 at end B, 1 at end A
      // Front position: slow surge + a faster counter-swing.
      let front = 0.5 + 0.3 * Math.sin(t * 0.45) + 0.12 * Math.sin(t * 0.77 + 1.1)
      // Ragged, churning interface rather than a clean sweep line.
      front += 0.07 * Math.sin(theta * 9 + t * 1.9) + 0.04 * Math.sin(theta * 17 - t * 2.6)
      const width = 0.16
      let f = Math.max(0, Math.min(1, (q - front) / width + 0.5))
      f = f * f * (3 - 2 * f)
      deep.copy(deepB).lerp(deepA, f)
      hot.copy(hotB).lerp(hotA, f)
      c.copy(deep).lerp(hot, Math.min(1, heat))
      // Shock front: where the two plasmas actually collide, brighten. Scaled
      // by how different the hues are, so a matched pair stays calm.
      if (ends.contest > 0.01) {
        const clash = Math.max(0, 1 - Math.abs(q - front) / width)
        c.multiplyScalar(1 + clash * clash * 1.5 * ends.contest)
      }
      colors.push(c.r, c.g, c.b)
    }
  }

  const stride = radialSegs + 1
  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * stride + j
      const b = a + stride
      const c0 = a + 1
      const d = b + 1
      indices.push(a, b, c0, b, d, c0)
    }
  }

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

// Tube tessellation. A fat bore needs far more segments than the old thin one:
// at these radii 72x10 left visible flat facets, so the bridge read as folded
// orange paper instead of gas. Shared by the initial build and the ~28 Hz
// remesh below so the two can never drift apart.
const RING_TUBULAR_SEGS = 112
const RING_RADIAL_SEGS = 16

// Ember streak: a hard bright core with a short soft tail. Drawn on a stretched
// sprite so embers read as flecks of moving material rather than little suns.
let _sparkTex = null
function sparkTexture() {
  if (_sparkTex) return _sparkTex
  if (typeof document === 'undefined') return null
  const W = 64
  const H = 16
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  const g = ctx.createLinearGradient(0, 0, W, 0)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.55, 'rgba(255,240,210,0.55)')
  g.addColorStop(0.78, 'rgba(255,255,255,1)')
  g.addColorStop(0.9, 'rgba(255,235,200,0.5)')
  g.addColorStop(1, 'rgba(255,200,150,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // Vertical falloff so it is a thin filament, not a bar.
  const v = ctx.createLinearGradient(0, 0, 0, H)
  v.addColorStop(0, 'rgba(0,0,0,1)')
  v.addColorStop(0.5, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(0,0,0,1)')
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
  _sparkTex = new THREE.CanvasTexture(c)
  return _sparkTex
}

// Plasma bridge between a binary pair: warped / weaving multi-layer fire-gas
// tube (not a perfect torus). Geometry path is rebuilt each frame so the
// ring thrashs and breathes while the group still tracks the star midpoint.
//
// Geometry: nominal radius = separation/2, centered on the pair midpoint so
// it roughly threads both stars; harmonics + out-of-plane waves keep it from
// reading as a clean circle. updateStarMesh re-centers/yaws/rolls the group
// and remeshes the warp.
function buildEnergyRing(separation, rng, colorA = null, colorB = null) {
  const radius = separation / 2
  // Ring radius stays separation/2 (it has to thread both suns), so "epic" has
  // to come from girth, not span: a much fatter bore turns a glowing wire into
  // a river of plasma the size of a star.
  const tubeRadius = Math.max(5, radius * 0.058)
  const noiseOffsets = [rng() * 10, rng() * 10, rng() * 10]
  const group = new THREE.Group()
  group.rotation.order = 'YXZ'

  // Roughly double the old displacement amplitudes and speed them up: the
  // bridge should look like it is being torn between two suns, not gently
  // waving. Out-of-plane (y*) terms get the same treatment so it churns in
  // three dimensions instead of staying a flat-ish hoop.
  const warp = {
    a1: 0.3 + rng() * 0.2,
    a2: 0.2 + rng() * 0.14,
    a3: 0.11 + rng() * 0.1,
    a4: 0.055 + rng() * 0.055,
    p1: rng() * Math.PI * 2,
    p2: rng() * Math.PI * 2,
    p3: rng() * Math.PI * 2,
    p4: rng() * Math.PI * 2,
    flow1: 0.6 + rng() * 0.4,
    flow2: 0.8 + rng() * 0.5,
    flow3: 1.0 + rng() * 0.45,
    flow4: 1.35 + rng() * 0.6,
    ellipse: 0.11 + rng() * 0.1,
    ellipseSpeed: 0.26 + rng() * 0.18,
    y1: 0.3 + rng() * 0.2,
    y2: 0.2 + rng() * 0.14,
    y3: 0.11 + rng() * 0.09,
    yFlow1: 0.7 + rng() * 0.4,
    yFlow2: 0.95 + rng() * 0.5,
    yFlow3: 1.2 + rng() * 0.45,
    py1: rng() * Math.PI * 2,
    py2: rng() * Math.PI * 2
  }

  // Angrier palette: near-black blood red in the smoke, furnace orange through
  // the body, and a core driven past white so the bloom pass ignites it. The
  // wider deep→hot spread is what reads as "burning" rather than "glowing".
  // The bridge is made of the stars' own light: one palette per end, blended
  // across the span in buildWarpedTubeGeometry so each half carries the colour
  // of the sun it is anchored to.
  const palA = ringPalette(colorA)
  const palB = ringPalette(colorB ?? colorA)
  const h = palA.h
  const deepOuter = palA.deepOuter
  const hotOuter = palA.hotOuter
  const deepMid = palA.deepMid
  const hotMid = palA.hotMid
  const deepCore = palA.deepCore
  const hotCore = palA.hotCore

  // key names into ringPalette so each layer can pull the matching ramp from
  // both ends' palettes.
  // Shortest hue distance between the two suns, 0 (identical) .. 1 (opposite).
  const dh = Math.abs(palA.h - palB.h)
  const contest = Math.min(dh, 1 - dh) * 2

  function endsFor(deepKey, hotKey) {
    return {
      deepA: palA[deepKey], hotA: palA[hotKey],
      deepB: palB[deepKey], hotB: palB[hotKey],
      contest
    }
  }

  function makeLayer(tubeScale, deepKey, hotKey, opacity) {
    const geom = buildWarpedTubeGeometry(
      radius, tubeRadius * tubeScale,
      RING_TUBULAR_SEGS, RING_RADIAL_SEGS,
      warp, 0, endsFor(deepKey, hotKey), noiseOffsets
    )
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(geom, mat)
    mesh.frustumCulled = false
    group.add(mesh)
    return mesh
  }

  // Four nested shells: a huge smoke halo, smoky outer gas, fire mid, and a
  // thin white-hot filament. The extra outer shell is what gives the bridge
  // volume at a distance — without it the thing has a hard edge and reads as
  // a solid object rather than something burning.
  const halo = makeLayer(2.4, 'deepOuter', 'hotOuter', 0.1)
  const gas = makeLayer(1.6, 'deepOuter', 'hotOuter', 0.24)
  const mid = makeLayer(1.15, 'deepMid', 'hotMid', 0.5)
  const core = makeLayer(0.32, 'deepCore', 'hotCore', 0.95)

  // Soft gaseous puffs drifting along the bridge.
  const puffs = []
  const puffTex = plasmaPuffTexture()
  const puffCount = 44
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: puffTex,
      color: new THREE.Color().setHSL(h, 0.85 + rng() * 0.15, 0.5 + rng() * 0.22),
      transparent: true,
      opacity: 0.35 + rng() * 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const sprite = new THREE.Sprite(mat)
    const size = tubeRadius * (2.5 + rng() * 4)
    sprite.scale.set(size, size, 1)
    group.add(sprite)
    puffs.push({
      mesh: sprite,
      phase: rng() * Math.PI * 2,
      speed: 0.15 + rng() * 0.35,
      size,
      radialJitter: 0.04 + rng() * 0.1,
      yJitter: tubeRadius * (0.5 + rng() * 2)
    })
  }

  // Ember sparks — chaotic, not locked to a perfect circle.
  const sparks = []
  const sparkCount = 38
  for (let i = 0; i < sparkCount; i++) {
    const color = new THREE.Color().setHSL(h, 0.4 + rng() * 0.4, 0.7 + rng() * 0.3)
    // Sized off the tube but far smaller than it: these were spheres scaled at
    // 0.25-0.95x the bore, so widening the bore turned every ember into a ball.
    const size = tubeRadius * (0.05 + rng() * 0.13)
    const spark = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: sparkTexture(),
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        rotation: rng() * Math.PI * 2
      })
    )
    // Long and thin — the streak is what makes it read as a spark.
    const stretch = 3.5 + rng() * 4
    spark.scale.set(size * stretch, size, 1)
    group.add(spark)
    sparks.push({
      mesh: spark,
      phase: rng() * Math.PI * 2,
      speed: 0.25 + rng() * 0.65,
      wobble: tubeRadius * (0.8 + rng() * 2.2),
      wobbleFreq: 1.5 + rng() * 3.5,
      trail: rng() * Math.PI * 2,
      size,
      stretch,
      spin: (rng() - 0.5) * 1.6
    })
  }

  // Slow arc discharges crawling along the bridge. Reuses the tunnel/hyperspace
  // bolt builder rather than a second lightning implementation — bolts are
  // authored along local +Y, so each one is positioned at a point on the plasma
  // path and rotated to follow the tangent from there.
  const bolts = []
  for (let i = 0; i < 3; i++) {
    const mat = createLightningMaterial(
      new THREE.Color().setHSL(h, 0.35 + rng() * 0.3, 0.85),
      0
    )
    const line = new THREE.LineSegments(createLightningGeometry(), mat)
    line.frustumCulled = false
    line.visible = false
    group.add(line)
    bolts.push({
      line,
      mat,
      // Stagger first strikes so all three never fire together.
      cooldown: rng() * 5,
      alive: 0,
      duration: 0,
      theta0: 0,
      span: 0,
      rejag: 0
    })
  }

  return {
    group,
    bolts,
    layers: [
      { mesh: halo, tubeScale: 2.4, ends: endsFor('deepOuter', 'hotOuter'), baseOpacity: 0.1, pulse: 2.2 },
      { mesh: gas, tubeScale: 1.6, ends: endsFor('deepOuter', 'hotOuter'), baseOpacity: 0.24, pulse: 3.1 },
      { mesh: mid, tubeScale: 1.15, ends: endsFor('deepMid', 'hotMid'), baseOpacity: 0.5, pulse: 4.2 },
      { mesh: core, tubeScale: 0.32, ends: endsFor('deepCore', 'hotCore'), baseOpacity: 0.95, pulse: 5.5 }
    ],
    radius,
    tubeRadius,
    warp,
    noiseOffsets,
    puffs,
    sparks,
    // Group roll / thrash around the star-to-star axis.
    weaveSpeed: 0.35 + rng() * 0.25,
    weaveAmplitude: 0.55 + rng() * 0.4,
    weaveSpeed2: 0.55 + rng() * 0.35,
    weaveAmplitude2: 0.2 + rng() * 0.2,
    // How often we rebuild warped mesh (every N frames worth of time).
    morphAccum: 0,
    morphInterval: 1 / 28 // ~28 Hz morph — smooth enough, cheap enough
  }
}

// A star (or multi-star system) always sits at a system's local origin.
// Each star's core is self-lit (MeshBasicMaterial ignores scene lighting)
// with a turbulent, mottled surface so it reads as a roiling ball of plasma
// rather than a flat gem; corona shells give it a soft, pulsing halo.
// Soft glow (haloFar) extends this far past the core radius — companion orbits
// must clear primary + each other by at least this multiple or the stars look
// like they merge / pass through each other.
const STAR_HALO_REACH = 3.5
const STAR_ORBIT_GAP = 4000

/**
 * Orbital radius for companion `companionR` around `primaryR`, outside
 * `prevSep`/`prevCompanionR` so secondary and tertiary never intersect
 * (including soft halos) at any angle.
 */
export function companionOrbitRadius(primaryR, companionR, prevSep = 0, prevCompanionR = 0) {
  // Clear primary core + halo (and a classic packing factor).
  let separation = Math.max(
    (primaryR + companionR) * 2.2,
    primaryR * STAR_HALO_REACH + companionR * STAR_HALO_REACH + STAR_ORBIT_GAP
  )
  if (prevSep > 0) {
    // Coplanar min distance between companions = |sep - prevSep|.
    // Need that ≥ sum of halo reaches so they never clip each other.
    const clearSibling =
      prevSep + prevCompanionR * STAR_HALO_REACH + companionR * STAR_HALO_REACH + STAR_ORBIT_GAP
    separation = Math.max(separation, clearSibling)
  }
  return separation
}

// Binary / trinary: biggest component stays at the origin (primary + system
// anchor); companions orbit it with plasma energy rings bridging each pair
// (see updateStarMesh). Trinary only exists on Whispers (system.starType).
// forceType (optional) skips the hashed random pick — used by main.js's
// main-menu flyby to always get Whispers' trinary rather than leaving it to luck.
export function buildStarMesh(system, forceType = null) {
  const hash = hashString(system.id)
  const rng = mulberry32(hash)
  // Same source of truth as starting-system pick / Whispers override.
  const type = forceType ?? starTypeForSystem(system)

  const group = new THREE.Group()
  group.userData.stars = []
  group.userData.energyRings = []

  if (type === 'binary' || type === 'trinary') {
    const count = type === 'trinary' ? 3 : 2
    // Draw component types WITHOUT replacement (shuffled), so a trinary gets one
    // of each rather than potentially three of the same kind. Previously each
    // component rolled independently, which is why Whispers could come up as
    // three matching blue-white suns.
    const shuffled = BINARY_COMPONENT_TYPES.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const componentTypes = Array.from({ length: count }, (_, i) => shuffled[i % shuffled.length])
    // Built in sequence so each star can be told which hues are already taken.
    const usedHues = []
    const stars = componentTypes.map((componentType) => {
      const star = buildSingleStar(componentType, rng, usedHues)
      usedHues.push(star.hue)
      return star
    })
    // Primary = largest; companions orbit it (same stationary-anchor rule as binary).
    const order = stars
      .map((s, i) => i)
      .sort((a, b) => stars[b].radius - stars[a].radius)
    const primary = stars[order[0]]
    group.add(primary.group)
    group.userData.stars.push(primary)

    // Companions: each separation clears primary + prior companion (incl. glow).
    let prevSep = 0
    let prevCompanionR = 0
    for (let c = 1; c < order.length; c++) {
      const companion = stars[order[c]]
      const separation = companionOrbitRadius(
        primary.radius,
        companion.radius,
        prevSep,
        prevCompanionR
      )
      prevSep = separation
      prevCompanionR = companion.radius
      // 10x slower than before: companions used to visibly race around the
      // primary, which broke the sense of scale for objects this size.
      const orbitSpeed = (0.0035 + rng() * 0.004) * (c === 1 ? 1 : 0.72)
      const orbit = {
        radius: separation,
        angle0: rng() * Math.PI * 2,
        speed: orbitSpeed
      }
      companion.group.position.set(
        Math.cos(orbit.angle0) * orbit.radius,
        0,
        Math.sin(orbit.angle0) * orbit.radius
      )
      group.add(companion.group)
      const orbiterEntry = { ...companion, orbit }
      group.userData.stars.push(orbiterEntry)

      // Plasma bridge threads primary (origin) ↔ this companion.
      // orbit.radius = separation; ring radius = separation/2 (buildEnergyRing).
      const energyRing = buildEnergyRing(
        orbit.radius,
        rng,
        // Each end takes the colour of the sun it anchors to. Do NOT average
        // the two: blue and yellow average to green in RGB, which is a colour
        // belonging to neither star.
        primary.color,
        companion.color
      )
      // Index into userData.stars of the companion this ring follows.
      energyRing.orbiterIndex = group.userData.stars.length - 1
      group.add(energyRing.group)
      group.userData.energyRings.push(energyRing)
    }

    // Legacy single-ring handle (binary tools / older call sites).
    group.userData.energyRing = group.userData.energyRings[0] ?? null
  } else {
    const star = buildSingleStar(type, rng)
    group.add(star.group)
    group.userData.stars.push(star)
  }

  group.frustumCulled = false
  return group
}

// Scratch objects reused every frame in updateStarMesh's distance sizing
// (see below) rather than allocated per star per frame.
const starWorldPos = new THREE.Vector3()
// Scratch for flame-tongue placement / screen-space aiming.
const _flameCentre = new THREE.Vector3()
const _flameTip = new THREE.Vector3()
const _flameWorld = new THREE.Vector3()
const _flameProj = new THREE.Vector3()
const _flameDirW = new THREE.Vector3()
const _flameView = new THREE.Vector3()
const _flameQuat = new THREE.Quaternion()
// Scratch for ring lightning placement (avoid per-frame allocation).
const _boltUp = new THREE.Vector3(0, 1, 0)
const _boltA = new THREE.Vector3()
const _boltB = new THREE.Vector3()
const _boltDir = new THREE.Vector3()
// Scratch for CME loop placement (per puff, per CME, per star, per frame).
const _cmeSide = new THREE.Vector3()
const _cmeUp = new THREE.Vector3()
const _cmeTmp = new THREE.Vector3()
// Minimum angular size (radians) for the distant-sun spot so a star never
// shrinks below a readable bright pinprick at the system rim.
const DISTANT_SUN_MIN_ANGLE = 0.014

// Slow rotation plus a gentle breathing pulse on the corona shells for every
// star in the system (1, 2 binary, or 3 trinary) — driven by gameState.simTime
// (via the elapsed param), never wall-clock time. Companions carry `orbit`;
// the primary stays at the origin. Each energy ring threads primary↔one
// companion and is re-centered on that pair's midpoint each frame.
// camera (optional) drives the distance-based angular-size floor so a far sun
// still reads as a bright pinprick rather than vanishing.
export function updateStarMesh(mesh, elapsed, dt, camera) {
  for (const star of mesh.userData.stars) {
    star.group.rotation.y += star.spinSpeed * dt
    // CME corona swell is layered on after updateStarCmes (below).
    if (star.cmes) star.cmes.coronaPunch = 0
    // Corona shells are free to breathe again. Scale animation was pinned off
    // because the shells were DoubleSide and their near hemisphere shimmered
    // over the photosphere, "melting" the granulation. They are BackSide now,
    // so the opaque disc occludes all of that and only the limb moves — which
    // is exactly where a real corona churns.
    //
    // Each shell gets its own rate, phase and axis so they slide against each
    // other instead of pumping in unison; layered together that reads as
    // convection rather than one throbbing balloon.
    const coronaShells = [
      { mesh: star.corona1, sway: 0.030, rate: 0.34, spin: 0.020, phase: 0 },
      { mesh: star.corona2, sway: 0.045, rate: 0.27, spin: -0.014, phase: 1.7 },
      { mesh: star.corona3, sway: 0.060, rate: 0.21, spin: 0.011, phase: 3.1 },
      { mesh: star.corona4, sway: 0.080, rate: 0.16, spin: -0.008, phase: 4.6 }
    ]
    for (const shell of coronaShells) {
      const mesh = shell.mesh
      if (!mesh) continue
      const t = elapsed * shell.rate + star.pulsePhase + shell.phase
      // Two out-of-step sines so the swell never settles into an obvious loop.
      const swell = 1 + shell.sway * (Math.sin(t) * 0.65 + Math.sin(t * 1.61 + 0.9) * 0.35)
      // Squash across one axis as it swells — a sphere scaling uniformly reads
      // as a balloon; anisotropy reads as gas being thrown around.
      mesh.scale.set(swell, 1 + (swell - 1) * 0.45, swell * (1 - (swell - 1) * 0.3))
      mesh.rotation.y += shell.spin * dt
      mesh.rotation.z = Math.sin(t * 0.5) * 0.05
      // Corona shells are flame ShaderMaterials — the turbulence is driven by
      // uTime in the fragment shader, and uOpacity carries the slow pulse.
      const u = mesh.material?.uniforms
      if (u?.uTime) {
        u.uTime.value = elapsed
        const base = mesh.userData.baseOpacity ?? u.uOpacity.value
        mesh.userData.baseOpacity = base
        u.uOpacity.value = base * (0.78 + 0.22 * Math.sin(t * 1.9 + 0.4))
      } else if (mesh.material) {
        const base = mesh.userData.baseOpacity ?? mesh.material.opacity
        mesh.userData.baseOpacity = base
        mesh.material.opacity = base * (0.78 + 0.22 * Math.sin(t * 1.9 + 0.4))
      }
    }
    // Boiling-surface motion: this star's own cloned map drifts slowly, on
    // top of the group's spin — the two motions layered read as convecting
    // plasma rather than a static skin rotating.
    if (star.coreMap) {
      star.coreMap.offset.x = elapsed * star.mapDrift[0]
      star.coreMap.offset.y = elapsed * star.mapDrift[1]
    }
    // Glow pulse only on outer limb rings — never the tight rim / disc fill
    // (that was bleaching and “melting” the surface texture).
    if (star.haloCore) {
      star.haloCore.material.opacity = 0.62
    }
    if (star.halo) {
      star.halo.material.opacity = 0.36 + 0.025 * Math.sin(elapsed * 0.55 + star.pulsePhase)
    }
    if (star.haloOuter) {
      star.haloOuter.material.opacity = 0.16 + 0.03 * Math.sin(elapsed * 0.4 + star.pulsePhase + 1)
    }
    if (star.haloFar) {
      star.haloFar.material.opacity = 0.07 + 0.02 * Math.sin(elapsed * 0.28 + star.pulsePhase + 1.7)
    }
    if (star.streamers) {
      star.group.getWorldPosition(_flameCentre)
      star.group.getWorldQuaternion(_flameQuat)
      if (camera) _flameView.copy(_flameCentre).sub(camera.position).normalize()
      for (const s of star.streamers) {
        // How close this tongue sits to the visible limb: 1 at the silhouette,
        // 0 when it points straight at (or away from) the camera.
        //
        // These are billboards, so a tongue on the near face of the star still
        // renders at full size and lies flat across the disc instead of rising
        // off the surface — that is the misalignment. Only tongues near the
        // silhouette are genuinely aligned with the surface on screen, so the
        // rest are faded out and foreshortened.
        //
        // s.dir is in the star group's local frame and the group spins, so it
        // has to be rotated into world space before comparing with the view.
        let limb = 1
        if (camera) {
          _flameDirW.copy(s.dir).applyQuaternion(_flameQuat)
          limb = 1 - Math.abs(_flameDirW.dot(_flameView))
        }

        // Lick: the tongue surges out and draws back rather than sitting static.
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * s.speed + s.phase)
        // Foreshortening: a tongue angled toward the camera projects shorter,
        // which is also what stops it reading as lying on top of the disc.
        const len = s.baseLength * (0.6 + pulse * 0.7) * (0.45 + 0.55 * limb)
        s.mesh.scale.set(s.width, len, 1)
        // Re-anchor as it grows so the root stays sunk in the photosphere.
        _flameTip.copy(s.dir).multiplyScalar(star.radius + len * (0.5 - FLAME_ROOT_SINK))
        s.mesh.position.copy(_flameTip)

        // Sprite rotation is SCREEN space, so a fixed build-time angle only
        // pointed outward from one camera position — from anywhere else the
        // tongues lay across the limb at random angles. Project the centre and
        // the tongue each frame and aim it along the outward screen direction.
        if (camera) {
          s.mesh.getWorldPosition(_flameWorld)
          _flameWorld.project(camera)
          _flameProj.copy(_flameCentre).project(camera)
          const dx = _flameWorld.x - _flameProj.x
          const dy = _flameWorld.y - _flameProj.y
          if (dx * dx + dy * dy > 1e-12) {
            // Local +Y maps to (-sin, cos) under a CCW rotation of theta.
            s.mesh.material.rotation = Math.atan2(-dx, dy)
          }
        }
        // Fade toward the front/back of the sphere where a billboard cannot
        // align with the surface anyway.
        s.mesh.material.opacity = (0.34 + 0.5 * pulse) * Math.min(1, limb * 1.7)
      }
    }
    // Occasional coronal mass ejections (rare but not vanishingly rare).
    updateStarCmes(star, elapsed, dt, camera)
    if (star.cmes?.coronaPunch > 0) {
      // CME swell only on outer glow — avoid scaling shells over the disc.
      const p = star.cmes.coronaPunch
      if (star.haloOuter) {
        star.haloOuter.material.opacity = Math.min(0.45, (star.haloOuter.material.opacity ?? 0.18) + p * 0.25)
      }
      if (star.haloFar) {
        star.haloFar.material.opacity = Math.min(0.22, (star.haloFar.material.opacity ?? 0.08) + p * 0.18)
      }
    }
    if (star.orbit) {
      const angle = star.orbit.angle0 + elapsed * star.orbit.speed
      star.group.position.x = Math.cos(angle) * star.orbit.radius
      star.group.position.z = Math.sin(angle) * star.orbit.radius
    }

    if (camera) {
      star.group.getWorldPosition(starWorldPos)
      const dist = Math.max(1, camera.position.distanceTo(starWorldPos))
      // Grow the distant spot so angular size never drops below the floor —
      // reads as a bright pinprick that swells as you approach.
      if (star.distantSpot) {
        const minSize = dist * DISTANT_SUN_MIN_ANGLE
        const size = Math.max(star.distantSpotBase ?? star.radius * 1.6, minSize)
        star.distantSpot.scale.setScalar(size)
        // This layer exists to keep a far sun visible as a bright pinprick. Up
        // close it is a radius*1.7 additive blob sitting on the disc, so it has
        // to get out of the way almost entirely or the photosphere never reads
        // as a solid surface — it bottomed out at 0.69 before.
        const close = Math.min(1, (star.radius * 8) / dist)
        star.distantSpot.material.opacity = 0.1 + 0.9 * (1 - close)
      }
      // Soft floor on blaze layers so the star never becomes a cold pin.
      if (star.haloCore && star.haloCoreBase) {
        const minCore = dist * DISTANT_SUN_MIN_ANGLE * 1.2
        star.haloCore.scale.setScalar(Math.max(star.haloCoreBase, minCore))
      }
      if (star.halo && star.haloBase) {
        const minHalo = dist * DISTANT_SUN_MIN_ANGLE * 1.9
        star.halo.scale.setScalar(Math.max(star.haloBase, minHalo))
      }
      if (star.haloOuter && star.haloOuterBase) {
        const minOuter = dist * DISTANT_SUN_MIN_ANGLE * 2.6
        star.haloOuter.scale.setScalar(Math.max(star.haloOuterBase, minOuter))
      }
      if (star.haloFar && star.haloFarBase) {
        const minFar = dist * DISTANT_SUN_MIN_ANGLE * 3.4
        star.haloFar.scale.setScalar(Math.max(star.haloFarBase, minFar))
      }

    }
  }

  // Binary: one ring. Trinary: one ring per companion (primary ↔ each orbiter).
  const energyRings =
    mesh.userData.energyRings?.length
      ? mesh.userData.energyRings
      : mesh.userData.energyRing
        ? [mesh.userData.energyRing]
        : []

  for (const energyRing of energyRings) {
    // Midpoint between primary (origin) and its companion; yaw so local X ≈
    // star axis, then thrash roll so the bridge weaves out of the orbital plane.
    const orbiter =
      energyRing.orbiterIndex != null
        ? mesh.userData.stars[energyRing.orbiterIndex]
        : mesh.userData.stars.find((s) => s.orbit)
    if (!orbiter?.orbit) continue
    const angle = orbiter.orbit.angle0 + elapsed * orbiter.orbit.speed
    energyRing.group.position.set(Math.cos(angle) * energyRing.radius, 0, Math.sin(angle) * energyRing.radius)
    energyRing.group.rotation.y = -angle
    // Roll ONLY about local X. rotation.y aligns local X with the star-to-star
    // axis and the ring's two ends sit exactly on that axis, so rolling about it
    // weaves the mid-span while leaving both ends welded to their suns.
    // rotation.z used to swing those ends up to ~23 degrees off the stars, which
    // is what made the bridge look like it missed them.
    energyRing.group.rotation.x =
      Math.sin(elapsed * energyRing.weaveSpeed) * energyRing.weaveAmplitude
      + Math.sin(elapsed * energyRing.weaveSpeed2 * 1.7 + 1.1) * energyRing.weaveAmplitude2
    energyRing.group.rotation.z = 0

    // Remesh warped tubes on a timer so the fire/gas path lives without
    // rebuilding every frame (still ~28 Hz — reads as continuous thrash).
    energyRing.morphAccum = (energyRing.morphAccum ?? 0) + dt
    if (energyRing.morphAccum >= energyRing.morphInterval) {
      energyRing.morphAccum = 0
      for (const layer of energyRing.layers) {
        const next = buildWarpedTubeGeometry(
          energyRing.radius,
          energyRing.tubeRadius * layer.tubeScale,
          RING_TUBULAR_SEGS,
          RING_RADIAL_SEGS,
          energyRing.warp,
          elapsed,
          layer.ends,
          energyRing.noiseOffsets
        )
        layer.mesh.geometry.dispose()
        layer.mesh.geometry = next
        const pulse = layer.baseOpacity * (0.75 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * layer.pulse)))
        layer.mesh.material.opacity = pulse
      }
    } else {
      // Opacity still breathes between remeshes.
      for (const layer of energyRing.layers) {
        layer.mesh.material.opacity =
          layer.baseOpacity * (0.75 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * layer.pulse)))
      }
    }

    // Gaseous puffs ride the warped centerline and pulse.
    for (const puff of energyRing.puffs) {
      const theta = elapsed * puff.speed + puff.phase
      const p = energyRingPathPoint(theta, energyRing.radius, elapsed, energyRing.warp)
      const j = puff.radialJitter * energyRing.radius * Math.sin(elapsed * 1.3 + puff.phase)
      puff.mesh.position.set(
        p.x * (1 + j / Math.max(1, energyRing.radius)),
        p.y + Math.sin(elapsed * 2.1 + puff.phase) * puff.yJitter,
        p.z * (1 + j / Math.max(1, energyRing.radius))
      )
      const breathe = 0.85 + 0.35 * Math.sin(elapsed * 2.4 + puff.phase)
      puff.mesh.scale.setScalar(puff.size * breathe)
      puff.mesh.material.opacity = 0.2 + 0.35 * (0.5 + 0.5 * Math.sin(elapsed * 3 + puff.phase))
    }

    // Slow arc discharges. "Slow" is the whole point: long lives, long gaps,
    // and a re-jag only ~8x a second, so a bolt reads as a sustained arc being
    // dragged along the stream rather than the usual one-frame strobe.
    for (const bolt of energyRing.bolts ?? []) {
      if (bolt.alive > 0) {
        bolt.alive -= dt
        const a = energyRingPathPoint(bolt.theta0, energyRing.radius, elapsed, energyRing.warp)
        const b = energyRingPathPoint(bolt.theta0 + bolt.span, energyRing.radius, elapsed, energyRing.warp)
        _boltA.set(a.x, a.y, a.z)
        _boltB.set(b.x, b.y, b.z)
        const len = Math.max(1, _boltA.distanceTo(_boltB))
        bolt.line.position.copy(_boltA)
        _boltDir.copy(_boltB).sub(_boltA).normalize()
        bolt.line.quaternion.setFromUnitVectors(_boltUp, _boltDir)

        bolt.rejag -= dt
        if (bolt.rejag <= 0) {
          bolt.rejag = 0.12
          rewriteLightningBolt(bolt.line.geometry, {
            length: len,
            jag: energyRing.tubeRadius * 0.55,
            forks: 3,
            thickness: energyRing.tubeRadius * 0.14
          })
        }
        // Ease in and out over the life so it never pops on or off.
        const k = Math.max(0, Math.min(1, bolt.alive / Math.max(0.001, bolt.duration)))
        bolt.mat.opacity = 0.9 * Math.sin(Math.PI * k)
        bolt.line.visible = true
        if (bolt.alive <= 0) {
          bolt.line.visible = false
          bolt.cooldown = 2.5 + Math.random() * 5.5
        }
      } else {
        bolt.cooldown -= dt
        if (bolt.cooldown <= 0) {
          bolt.duration = 1.3 + Math.random() * 1.8
          bolt.alive = bolt.duration
          bolt.theta0 = Math.random() * Math.PI * 2
          // Signed span so bolts crawl both ways around the loop.
          bolt.span = (0.22 + Math.random() * 0.45) * (Math.random() < 0.5 ? 1 : -1)
          bolt.rejag = 0
        }
      }
    }

    // Embers thrash off the bridge rather than skating a perfect circle.
    for (const spark of energyRing.sparks) {
      const sparkAngle = elapsed * spark.speed + spark.phase
      const p = energyRingPathPoint(sparkAngle, energyRing.radius, elapsed, energyRing.warp)
      const wobble = Math.sin(elapsed * spark.wobbleFreq + spark.phase) * spark.wobble
      const wobble2 = Math.cos(elapsed * spark.wobbleFreq * 0.7 + spark.trail) * spark.wobble * 0.7
      spark.mesh.position.set(p.x + wobble, p.y + wobble2, p.z + wobble * 0.5)
      spark.mesh.material.opacity = 0.45 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed * 6 + spark.phase))
      // Scale the streak, never setScalar — uniform scaling would square it back
      // up into the blob this replaced.
      const s = 0.7 + 0.5 * Math.sin(elapsed * 5 + spark.trail)
      spark.mesh.scale.set(spark.size * spark.stretch * s, spark.size * s, 1)
      spark.mesh.material.rotation += spark.spin * dt
    }
  }
}
