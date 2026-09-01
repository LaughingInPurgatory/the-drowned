/**
 * Clean-slate WebGPU Ocean Rendering Engine
 *
 * Lightweight, high-performance TSL NodeMaterial and radial disc ocean mesh.
 * Pure vertical displacement with crest sharpening, exact closed-form normal
 * gradients, Fresnel sky reflections with below-horizon blocking, sun/moon
 * specular highlights, slope-driven whitecaps, cloud reflection, and low-sun
 * subsurface glow. Fragment additions are all distance-gated so the far field
 * stays one cheap pass.
 */
import {
  MeshBasicNodeMaterial,
  Vector3,
  Color,
  DoubleSide,
  BufferGeometry,
  Float32BufferAttribute,
  Sphere,
  Mesh,
  DataTexture,
  RGBAFormat,
  RepeatWrapping,
  LinearFilter
} from 'three/webgpu'
import {
  uniform,
  varying,
  vec3,
  vec2,
  vec4,
  float,
  positionLocal,
  positionWorld,
  modelWorldMatrix,
  cameraPosition,
  normalize,
  max,
  clamp,
  dot,
  length,
  mix,
  pow,
  smoothstep,
  sin,
  cos,
  Fn,
  texture,
  reflect,
  negate,
  saturate,
  oneMinus
} from 'three/tsl'
import {
  SEA_COMPILED,
  SEA_DETAIL_SLOPE,
  SEA_MAX_AMPLITUDE,
  CREST_SHARPEN
} from '../world/sea.js'
import { getWaterNormalMap } from './textures.js'

// ---------------------------------------------------------------------------
// Procedural Foam / breakup noise sheet
// ---------------------------------------------------------------------------

function buildNoiseTexture(size = 128) {
  const hash = (ix, iy, period, seed) => {
    const x = ((ix % period) + period) % period
    const y = ((iy % period) + period) % period
    let h = x * 374761393 + y * 668265263 + seed * 1442695041
    h = (h ^ (h >>> 13)) >>> 0
    h = Math.imul(h, 1274126177) >>> 0
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
  }
  const noise = (x, y, period, seed) => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const a = hash(x0, y0, period, seed)
    const b = hash(x0 + 1, y0, period, seed)
    const c = hash(x0, y0 + 1, period, seed)
    const d = hash(x0 + 1, y0 + 1, period, seed)
    return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy
  }
  const fbm = (u, v, cells, octaves, seed) => {
    let sum = 0
    let amp = 1
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      const p = cells << o
      sum += amp * noise(u * p, v * p, p, seed + o * 71)
      norm += amp
      amp *= 0.5
    }
    return sum / norm
  }
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = (y * size + x) * 4
      // R fine bubbles, G mid clumps, B coarse blobs (cloud mottling).
      data[i] = Math.round(fbm(u, v, 16, 3, 11) * 255)
      data[i + 1] = Math.round(fbm(u, v, 6, 3, 907) * 255)
      data[i + 2] = Math.round(fbm(u, v, 3, 2, 5501) * 255)
      data[i + 3] = 255
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.needsUpdate = true
  return tex
}

let noiseTexture = null
function getNoiseTexture() {
  if (!noiseTexture) noiseTexture = buildNoiseTexture()
  return noiseTexture
}

// ---------------------------------------------------------------------------
// Ocean NodeMaterial
// ---------------------------------------------------------------------------

export function createOceanNodeMaterial({ sunDirection, skyColor, fogColor } = {}) {
  const uTime = uniform(0)
  const uSunDir = uniform(new Vector3().copy(sunDirection || new Vector3(0.4, 0.8, 0.3)).normalize())
  const uSunColor = uniform(new Color(0xfff0d8))
  const uMoonDir = uniform(new Vector3(0, 1, 0))
  const uMoonBright = uniform(1)
  const uDeepColor = uniform(new Color(0x061a2c))
  const uCrestColor = uniform(new Color(0x1a6a7a))
  const uSkyColor = uniform(new Color(skyColor ?? 0x8a9499))
  const uZenithColor = uniform(new Color(0x3a6e96))
  const uCloudColor = uniform(new Color(0x9a94a0))
  const uCloudLit = uniform(new Color(0xffe0c0))
  const uCloudCover = uniform(0.52)
  const uFoamColor = uniform(new Color(0xeef4f6))
  const uShallowColor = uniform(new Color(0x2f9c92))
  const uSearchPos = uniform(new Vector3())
  const uSearchDir = uniform(new Vector3(0, -1, 0))
  const uSearchColor = uniform(new Color(0xfff0d0))
  const uSearchIntensity = uniform(0)
  const uSearchRange = uniform(140)
  const uSearchCosOuter = uniform(Math.cos(0.22))
  const uSearchCosInner = uniform(Math.cos(0.1))
  const uRainRipple = uniform(0)
  const uSeaState = uniform(0)
  const fogColorU = uniform(
    fogColor instanceof Color ? fogColor.clone() : new Color(fogColor ?? 0x6a7a88)
  )

  const noiseTex = getNoiseTexture()
  const waterNormal = getWaterNormalMap()

  // Raw (pre-sharpening) visible height, interpolated from the vertex stage so
  // the fragment can apply the same crest-sharpening derivative as the CPU.
  const vRawH = varying(float(0), 'vOceanRawH')

  const material = new MeshBasicNodeMaterial({ side: DoubleSide, fog: true })

  // -- Vertex Shader: Crest-Sharpened Vertical Wave Elevation ----------------

  material.positionNode = Fn(() => {
    const wp = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz
    const dist = length(positionLocal.xz)
    const fade = float(1).sub(smoothstep(float(3500), float(14000), dist))

    const dy = float(0).toVar()
    for (const w of SEA_COMPILED) {
      const ph = wp.x.mul(w.dx).add(wp.z.mul(w.dz)).mul(w.k).sub(uTime.mul(w.omega))
      dy.addAssign(sin(ph).mul(w.amp))
    }
    // Identical transform to world/sea.js crestSharpen — hulls and wake sit on
    // the crests you see, and the raw height travels down for the normals.
    vRawH.assign(dy)
    const c = clamp(dy.div(SEA_MAX_AMPLITUDE), float(0), float(1))
    dy.addAssign(float(CREST_SHARPEN).mul(SEA_MAX_AMPLITUDE).mul(c.mul(c)))
    dy.mulAssign(fade)

    return vec3(positionLocal.x, dy, positionLocal.z)
  })()

  // -- Fragment Shader: High-Res Optics, Reflections & Foam -----------------

  material.colorNode = Fn(() => {
    const wp = positionWorld
    const xz = positionWorld.xz
    const dist = length(xz.sub(vec2(cameraPosition.x, cameraPosition.z)))
    const nearFade = oneMinus(smoothstep(float(60), float(900), dist))

    // Exact closed-form surface gradient of the raw visible sum, scaled by the
    // crest-sharpening derivative so normals follow the surface you can see.
    const g = vec2(0, 0).toVar()
    for (const w of SEA_COMPILED) {
      const ph = xz.x.mul(w.dx).add(xz.y.mul(w.dz)).mul(w.k).sub(uTime.mul(w.omega))
      g.addAssign(vec2(w.ak * w.dx, w.ak * w.dz).mul(cos(ph)))
    }
    const m = float(1).add(
      clamp(vRawH.div(SEA_MAX_AMPLITUDE), float(0), float(1)).mul(float(2 * CREST_SHARPEN))
    )
    const Nwave = normalize(vec3(negate(g.x).mul(m), float(1), negate(g.y).mul(m)))
    const steep = length(g.mul(m))

    // Capillary micro-normal slope contribution
    const ds = vec2(0, 0).toVar()
    for (const w of SEA_DETAIL_SLOPE) {
      const ph = xz.x.mul(w.dx).add(xz.y.mul(w.dz)).mul(w.k).sub(uTime.mul(w.omega))
      ds.addAssign(vec2(w.dx * w.slope, w.dz * w.slope).mul(cos(ph)))
    }

    // Photographic micro-normal near the hull — the "wet liquid" detail that
    // a pure analytic surface always reads as missing.
    const tn = waterNormal
      ? texture(waterNormal, xz.mul(0.055).add(vec2(uTime.mul(0.014), uTime.mul(-0.011)))).xyz
          .mul(2)
          .sub(1)
      : vec3(0, 0, 0)
    const N = normalize(
      vec3(
        Nwave.x.sub(ds.x.mul(0.6)).sub(tn.x.mul(0.5).mul(nearFade)),
        float(1),
        Nwave.z.sub(ds.y.mul(0.6)).sub(tn.y.mul(0.5).mul(nearFade))
      )
    )

    // View vector, Fresnel, and reflection that waves block below the horizon.
    // A reflected ray that points under the horizon hits the back of the next
    // wave, not the sky — unblocked, the whole sea mirrors bright sky and reads
    // as milk. This is the single cheapest realism win on the surface.
    const V = normalize(cameraPosition.sub(wp))
    const NdV = saturate(max(N.dot(V), float(1e-3)))
    const fresBase = float(0.04).add(float(0.96).mul(pow(float(1).sub(NdV), 4.5)))
    const R = reflect(negate(V), N)
    const rough = float(0.04).add(steep.mul(0.45)).toVar()
    const block = smoothstep(float(-0.03).sub(rough.mul(0.5)), float(0.12).add(rough), R.y)
    const fresnel = fresBase.mul(mix(float(0.18), float(1), block))

    // Body colour: deep ocean blue in troughs to radiant emerald on crests.
    const crest = smoothstep(float(-0.8), float(1.0), wp.y)
    const deepScatter = mix(uDeepColor.mul(1.5), uCrestColor.mul(2.2), crest.mul(0.65).add(0.2))
    const body = deepScatter.add(uSkyColor.mul(0.25))

    // Sky reflection with cloud mottling (softened-plane projection — a true
    // plane blows up at the horizon, and from a boat everything near it is).
    const skyRefl = mix(uSkyColor, uZenithColor, pow(saturate(R.y), float(0.45))).mul(1.2).toVar()
    const cloudUv = vec2(R.x, R.z).div(max(R.y, float(0.06)).add(0.35)).mul(0.05)
    const cloudN = texture(noiseTex, cloudUv.add(vec2(uTime.mul(0.0016), uTime.mul(0.001)))).z
    const cloudAmt = smoothstep(uCloudCover.mul(0.9), uCloudCover.mul(0.9).add(0.3), cloudN)
      .mul(smoothstep(float(0.02), float(0.4), R.y))
      .mul(uCloudCover)
    skyRefl.assign(mix(skyRefl, mix(uCloudColor, uCloudLit, float(0.4)), cloudAmt.mul(0.75)))

    let col = mix(body, skyRefl, fresnel).toVar()

    // Sun specular glitter
    const sunUp = smoothstep(float(-0.05), float(0.12), uSunDir.y)
    const Hsun = normalize(uSunDir.add(V))
    const NdHsun = saturate(N.dot(Hsun))
    const sunSpec = pow(NdHsun, float(96.0)).mul(2.5).add(pow(NdHsun, float(18.0)).mul(0.35))
    col.addAssign(uSunColor.mul(sunSpec).mul(fresnel).mul(sunUp).mul(1.4))

    // Moon specular reflection
    const Hmoon = normalize(uMoonDir.add(V))
    const NdHmoon = saturate(N.dot(Hmoon))
    const moonSpec = pow(NdHmoon, float(48.0)).mul(1.2)
    const moonUp = smoothstep(float(-0.05), float(0.12), uMoonDir.y)
    col.addAssign(vec3(0.7, 0.8, 1.0).mul(moonSpec).mul(fresnel).mul(moonUp).mul(uMoonBright).mul(0.5))

    // Whitecaps: steep crests break (not just tall water), broken up by noise
    // so foam reads as aerated bubbles rather than a painted band.
    const capCover = smoothstep(float(0.15), float(0.4), steep).mul(
      smoothstep(float(0.05), float(0.9), crest)
    )
    const foamPattern = texture(
      noiseTex,
      xz.mul(0.034).add(vec2(uTime.mul(0.25), uTime.mul(-0.12)))
    )
      .x.mul(0.58)
      .add(
        texture(noiseTex, xz.mul(0.011).add(vec2(uTime.mul(0.07), uTime.mul(0.09)))).y.mul(0.42)
      )
      .sub(0.5)
      .mul(1.7)
      .add(0.5)
    const foamEdge = mix(float(0.85), float(0.12), capCover)
    const foamMask = smoothstep(foamEdge.sub(0.1), foamEdge.add(0.32), foamPattern).mul(capCover)
    const foamCol = uFoamColor.mul(uSunColor.mul(0.4).add(uSkyColor.mul(0.6)))
    col.assign(mix(col, foamCol, foamMask.mul(0.85)))

    // Sub-surface scattering: a low sun behind a crest lights the water
    // through it — the "expensive water" tell, cheap.
    const L = uSunDir
    const backDir = normalize(L.add(N.mul(0.35)))
    const through = pow(saturate(V.dot(negate(backDir))), float(2.6))
    const steepFace = smoothstep(float(0.16), float(0.45), steep)
    const lowSun = oneMinus(smoothstep(float(0.02), float(0.55), L.y))
    const sss = through.mul(crest).mul(steepFace).mul(lowSun.mul(1.7).add(0.3))
    col.addAssign(uSunColor.mul(vec3(1.0, 0.62, 0.3)).mul(sss).mul(0.7))

    // Searchlight illumination
    const toLight = uSearchPos.sub(wp)
    const sDist = length(toLight)
    const SL = toLight.div(max(sDist, float(0.05)))
    const cone = smoothstep(uSearchCosOuter, uSearchCosInner, negate(SL).dot(uSearchDir))
    const mask = cone
      .mul(oneMinus(smoothstep(uSearchRange.mul(0.4), uSearchRange, sDist)))
      .mul(float(1).div(float(1).add(sDist.mul(float(2.0).div(max(uSearchRange, float(1)))))))
      .mul(uSearchIntensity)
    const Hsl = normalize(SL.add(V))
    const slSpec = pow(saturate(N.dot(Hsl)), float(32.0)).mul(1.5)
    col.addAssign(uSearchColor.mul(slSpec).mul(mask).mul(fresnel))

    return col
  })()

  material.userData.oceanUniforms = {
    uTime,
    uSunDir,
    uSunColor,
    uMoonDir,
    uMoonBright,
    uDeepColor,
    uCrestColor,
    uSkyColor,
    uZenithColor,
    uCloudColor,
    uCloudLit,
    uCloudCover,
    uFoamColor,
    uShallowColor,
    uSearchPos,
    uSearchDir,
    uSearchColor,
    uSearchIntensity,
    uSearchRange,
    uSearchCosOuter,
    uSearchCosInner,
    uRainRipple,
    uSeaState,
    fogColor: fogColorU
  }
  material.uniforms = material.userData.oceanUniforms

  return material
}

// ---------------------------------------------------------------------------
// Camera-Centred Radial Disc Geometry
// ---------------------------------------------------------------------------

const OCEAN_RADIUS = 24000
const INNER_RADIUS = 3.5
const RINGS = 64
const SEGMENTS = 96

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
  const indices = []
  for (let s = 0; s < SEGMENTS; s++) {
    indices.push(0, 1 + s, 1 + ((s + 1) % SEGMENTS))
  }
  for (let i = 0; i < RINGS; i++) {
    const a = 1 + i * SEGMENTS
    const b = 1 + (i + 1) * SEGMENTS
    for (let s = 0; s < SEGMENTS; s++) {
      const n = (s + 1) % SEGMENTS
      indices.push(a + s, b + s, b + n)
      indices.push(a + s, b + n, a + n)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.boundingSphere = new Sphere(new Vector3(), OCEAN_RADIUS + SEA_MAX_AMPLITUDE)
  return geometry
}

/** Camera-centred ocean disc with WebGPU NodeMaterial */
export function createOcean(opts = {}) {
  const material = createOceanNodeMaterial(opts)
  const mesh = new Mesh(buildDiscGeometry(), material)
  mesh.name = 'ocean'
  mesh.frustumCulled = false
  mesh.receiveShadow = false
  mesh.renderOrder = -1

  const u = material.userData.oceanUniforms

  mesh.update = (camera, t) => {
    u.uTime.value = t
    u.uSeaState.value = u.uRainRipple.value
    mesh.position.set(camera.position.x, 0, camera.position.z)
  }

  mesh.setSearchlight = (state) => {
    if (!state || !(state.intensity > 0)) {
      u.uSearchIntensity.value = 0
      return
    }
    u.uSearchPos.value.copy(state.position)
    u.uSearchDir.value.copy(state.direction).normalize()
    u.uSearchIntensity.value = state.intensity
    if (state.range != null) u.uSearchRange.value = state.range
    if (state.color != null) {
      if (state.color.isColor) u.uSearchColor.value.copy(state.color)
      else u.uSearchColor.value.set(state.color)
    }
    if (state.angle != null) {
      u.uSearchCosOuter.value = Math.cos(state.angle + (state.penumbra ?? 0.4) * state.angle)
      u.uSearchCosInner.value = Math.cos(state.angle * 0.55)
    }
  }

  return mesh
}
