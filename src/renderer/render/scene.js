/**
 * WebGPU-only scene (no WebGL fallback).
 *
 * Custom GLSL ShaderMaterials are not supported by WebGPURenderer — sky/ocean
 * and overlays use NodeMaterial + TSL. The frame path is a TSL RenderPipeline
 * (see render/postFx.js), never `renderer.render(scene, camera)` directly.
 */
import * as THREE from 'three/webgpu'
import { Fn, texture, screenUV, vec2, vec3, vec4, max, uniform } from 'three/tsl'
import { createOcean } from './oceanNodeMaterial.js'
import { daylightAt } from './sky.js'
import { createSkyNodeMaterial } from './skyNodeMaterial.js'
import { createAreaLightPool } from './areaLightPool.js'
import { createWebGPURenderer } from './webgpuBoot.js'
import { createPostFx } from './postFx.js'
import { SHOT_MODE } from '../devShots.js'

/**
 * Everything about what time it is lives in `sky.js`. This file wires that one
 * answer into the key light, the sky dome, the fog, the environment map and the
 * water, so they can never disagree about where the sun is.
 */

/**
 * Image-based light. Hulls run metalness 0.85–0.92, and a metal with nothing to
 * reflect resolves to near-black under a single light. Baking the same sky the
 * player sees gives every wet plate and railing something to mirror, and the
 * horizon gradient makes highlights travel along a hull as it comes about.
 *
 * Exported because the boatyard preview runs its own WebGPU context, and a PMREM
 * texture belongs to the renderer that baked it — it needs its own copy.
 */
export function createSkyEnvironment(renderer) {
  // Must be called after `await renderer.init()`.
  const geometry = new THREE.SphereGeometry(1, 32, 16)
  const material = createSkyNodeMaterial()
  // Baked once at boot from the midday sky. Rebaking it every frame to follow
  // the day cycle is not worth the cost — `scene.environmentIntensity` is
  // driven from the same clock instead, which dims reflections into the night
  // convincingly enough.
  const envScene = new THREE.Scene()
  envScene.add(new THREE.Mesh(geometry, material))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(envScene)
  pmrem.dispose()
  geometry.dispose()
  material.dispose()
  return target.texture
}

// Scratch colours for weather grading (avoid per-frame allocations).
const _wxRainCloud = new THREE.Color(0x4e5864) // wet slate overcast
const _wxRainCloudLit = new THREE.Color(0x6a7684)
const _wxStormCloud = new THREE.Color(0x14181e) // near-black thunder deck
const _wxStormCloudLit = new THREE.Color(0x2a323c)
const _wxFlashZenith = new THREE.Color(0xb8cce8)
const _wxFlashHorizon = new THREE.Color(0xc4d4e8)
const _wxFlashCloud = new THREE.Color(0xdce8fc)
const _wxStormFog = new THREE.Color(0x3a444e) // cool wet-metal air
const _wxFlashFog = new THREE.Color(0xb8c8e0)
const _moonLightColor = new THREE.Color(0xa8bce0)
const _wxFlashKey = new THREE.Color(0xb8ceff)
const _flashDirScratch = new THREE.Vector3()
const _keyDirScratch = new THREE.Vector3()

/** Clamp to 0..1 and ease the ends — used for the day/night grade crossfade. */
const smoothstep01 = (x) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x
  return t * t * (3 - 2 * t)
}

/**
 * Build the game scene on WebGPU. Must be awaited — device init is async.
 * @param {HTMLElement} container
 */
export async function createScene(container) {
  const scene = new THREE.Scene()
  const day0 = daylightAt(0)
  // Fog is what sells the horizon. Everything past the fog wall dissolves into
  // the sky, so islands can fade in instead of popping. Colour and density both
  // follow the time of day.
  scene.fog = new THREE.FogExp2(day0.fog.getHex(), day0.fogDensity)

  // Far plane covers the ocean disc with room to spare. The space build needed
  // 2e6 for a whole star system; at sea, 60k is generous — and staying inside a
  // normal depth buffer means no logarithmicDepthBuffer, which in turn means
  // custom ShaderMaterials no longer need the logdepthbuf chunks.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 60_000)

  const renderer = await createWebGPURenderer(container, { preserveDrawingBuffer: SHOT_MODE })

  scene.environment = createSkyEnvironment(renderer)

  // Sky dome, drawn first and never depth-written, repositioned onto the camera
  // in render() so it can never be sailed out of. Kept out of the fog: fogging
  // the sky with a colour sampled from the sky is a flat grey screen.
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyNodeMaterial())
  skyDome.scale.setScalar(camera.far * 0.4)
  skyDome.renderOrder = -1000
  skyDome.frustumCulled = false
  scene.add(skyDome)

  const ocean = createOcean({
    sunDirection: day0.sunDirection,
    skyColor: day0.horizon.getHex(),
    fogColor: day0.fog
  })
  scene.add(ocean)

  // Real sunlight now, not a point light at a star. Built at boot and never at
  // runtime: a light added mid-session recompiles every MeshStandardMaterial
  // (the combat hitch shipMesh.js warns about).
  // One pooled directional light supplies the only large-area shadow map. It
  // follows the sun by day and the moon at night, so night shadows use the
  // visible light source without paying for two concurrent shadow maps.
  const sun = new THREE.DirectionalLight(day0.sunColor.getHex(), day0.sunIntensity)
  // Key light sits close enough that the ortho depth range is tight — far-away
  // lights with near=0.5/far=2000 waste precision and make acne/peter-pan worse.
  sun.position.copy(day0.sunDirection).multiplyScalar(720)
  sun.castShadow = true
  sun.shadow.autoUpdate = false
  // The shadow box travels with the player (see updateEnvironment()). It only
  // has to cover the boat and whatever it is moored against — an ocean-wide
  // shadow map would be all texel and no detail.
  // 2048, and the resolution is what decides whether contact shadows exist at
  // all. The box is 96 m at a berth and 120 m in open water, so at 1024 one
  // texel is ~19 cm on the ground — and the normal bias that a 19 cm texel
  // needs to stay acne-free is larger than most of the props casting the
  // shadow. Everything smaller than a fuel drum simply stopped casting
  // (verified: at 1024 the drums, the gantry and the lamp post threw nothing
  // onto the harbour deck at noon). At 2048 the texel halves and so does the
  // bias it needs. The pass is depth-only and runs on a 2-8 frame cadence
  // (see updateEnvironment), so the extra fill is affordable; drop it back to
  // 1024 in the `low` tier if a weak GPU ever needs it.
  sun.shadow.mapSize.set(2048, 2048)
  const shadowCam = sun.shadow.camera
  // Layer 1 is reserved for the local first-person body: it is excluded from
  // the view camera, but included in the sun's shadow pass so the survivor's
  // shadow still lands on terrain while the body stays out of the lens.
  shadowCam.layers.enable(1)
  shadowCam.near = 40
  shadowCam.far = 1400
  shadowCam.left = -120
  shadowCam.right = 120
  shadowCam.top = 120
  shadowCam.bottom = -120
  // Small constant bias + modest normal bias: enough to kill acne on flat
  // decks without lifting hull shadows off the waterline (peter-panning).
  sun.shadow.bias = -0.00008
  sun.shadow.normalBias = 0.018
  // PCFSoft radius in texels — keep penumbra tight so harbour piles and
  // fittings read as contact shadows, not soft grey blobs.
  sun.shadow.radius = 1.15
  sun.shadow.intensity = 1
  scene.add(sun)
  scene.add(sun.target)
  // Sky above, sea bounce below — the standard outdoor fill. Without the sea
  // term the undersides of hulls and jetties go pure black.
  const hemi = new THREE.HemisphereLight(day0.hemiSky.getHex(), day0.hemiGround.getHex(), day0.hemiIntensity)
  scene.add(hemi)

  // Fixed PointLight pool — see areaLightPool.js. Must exist before any
  // MeshStandardMaterial is first rendered so NUM_POINT_LIGHTS never changes.
  const areaLightPool = createAreaLightPool(scene)

  // Every practical lamp in the game — nav lights, quay heads, beacons — is
  // offered to that pool, and every one of them was authored in the wrong unit.
  // A PointLight with decay 2 delivers `intensity / d²`, so the 420 cd a nav
  // lamp offers puts the deck a metre away at linear ~400 and the far end of its
  // own 14 m cutoff still at 2.1 — the entire useful range of the fixture sits
  // above white. That is why night harbours read as flat white blobs with no
  // fitting detail: the surface is not lit, it is clipped.
  //
  // One scale here rather than in each mesh builder, because this is the single
  // point every practical routes through and the meshes are not this file's to
  // edit. `LAMP_GAIN` puts a lamp's own fixture around 2-4x white (a bright but
  // resolvable core) and the deck under it just below 1, which is what leaves
  // the woodwork and the fenders readable.
  //
  // The decay matters as much as the gain. A real quay lantern is a ~250 mm
  // frosted globe, not a point: close in it behaves like an area source and
  // falls off far slower than r⁻², and it is only in the far field that inverse
  // square is a good approximation. Modelling it as a strict point put the
  // entire near field above white while leaving the drums six metres away as
  // black silhouettes — clipped where it should be shaped, and dead where there
  // should be a pool. `LAMP_DECAY` below 2 is the cheap standard dodge for a
  // finite-size emitter (an area light per practical is not affordable here —
  // the pool exists because adding lights mid-session recompiles every
  // material). Calibrated so a lamp puts ~1 unit on a surface 3 m away.
  const LAMP_GAIN = 0.0025
  const LAMP_DECAY = 1.35
  for (const o of scene.children) {
    if (o.isPointLight && o.name.startsWith('area-light-pool-')) o.decay = LAMP_DECAY
  }
  const areaLights = {
    ...areaLightPool,
    offer(x, y, z, color, intensity, distance, priority) {
      areaLightPool.offer(x, y, z, color, intensity * LAMP_GAIN, distance, priority)
    }
  }

  renderer.setClearColor(0x0a1520, 1)

  // AA / AO / DOF / bloom / grade / lens — all of it lives in postFx.js.
  // Tone mapping stays Neutral on the renderer because the camera-space
  // overlays (lens flare, spray, rain) are drawn after the pipeline and are
  // authored against it; the filmic response is in the grade LUT instead.
  const postFx = createPostFx(renderer, scene, camera, { quality: 'high' })
  // Base (daylight) exposure. updateEnvironment retimes this across the day —
  // always through setExposure, never `renderer.toneMappingExposure` directly,
  // because the bloom threshold and clamp are authored in display units and
  // have to move with it.
  const DAY_EXPOSURE = 1.05
  // Night is graded a stop and a half up, the way a real night scene is shot:
  // the ambient below is cut by more than that, so the moonlit world gets *less*
  // light but is exposed to read — which is the difference between "dark" and
  // "crushed". A flat exposure with a lifted ambient is what made the hillside
  // read as a sunlit tan slope at 21:00.
  const NIGHT_EXPOSURE = 1.7
  postFx.setExposure(DAY_EXPOSURE)

  // --- Live AA + bloom -----------------------------------------------------
  // Deliberately not postFx/RenderPipeline: that machinery is confirmed (by
  // hand, in the packaged app) to leave the swapchain blank on this machine,
  // for a reason that was never pinned down — see the long comment on
  // render() below before touching any of this. What follows reuses only the
  // two draw patterns already confirmed to actually reach the screen here: a
  // plain `renderer.render(scene, camera)`, and a plain `renderer.render()`
  // of a full-screen quad via `THREE.QuadMesh` — a bare geometry+camera
  // helper, not RenderPipeline; its own `.render()` is nothing but
  // `renderer.render(this, camera)`. The scene renders into an offscreen
  // supersampled target exactly like the confirmed-working raw path always
  // did, just at 2x size; a second, ordinary quad draw box-filters that down
  // (the antialiasing) and adds a handful of bright-weighted wide taps of the
  // same texture (the bloom) in one pass, straight to the swapchain.
  const AA_SCALE = 2
  const superTarget = new THREE.RenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    colorSpace: THREE.LinearSRGBColorSpace
  })
  const uTexel = uniform(new THREE.Vector2(1, 1))
  const compositeMat = new THREE.MeshBasicNodeMaterial()
  compositeMat.colorNode = Fn(() => {
    const uv = screenUV
    // 2x2 box downsample of the supersampled buffer — this *is* the AA.
    const s00 = texture(superTarget.texture, uv.add(uTexel.mul(vec2(-0.25, -0.25))))
    const s10 = texture(superTarget.texture, uv.add(uTexel.mul(vec2(0.25, -0.25))))
    const s01 = texture(superTarget.texture, uv.add(uTexel.mul(vec2(-0.25, 0.25))))
    const s11 = texture(superTarget.texture, uv.add(uTexel.mul(vec2(0.25, 0.25))))
    const base = s00.add(s10).add(s01).add(s11).mul(0.25)

    // Cheap bloom: a scattered handful of wide taps of the same texture,
    // bright-pass thresholded and summed — not a real blur, but at this
    // budget a blur is just a bloom kernel with the honesty removed.
    const taps = [
      [0, 0], [3, 0], [-3, 0], [0, 3], [0, -3],
      [2, 2], [-2, 2], [2, -2], [-2, -2],
      [6, 0], [-6, 0], [0, 6], [0, -6]
    ]
    const bloomSum = taps
      .map(([tx, ty]) => {
        const s = texture(superTarget.texture, uv.add(uTexel.mul(vec2(tx, ty)))).rgb
        const luma = s.dot(vec3(0.2126, 0.7152, 0.0722))
        const bright = max(luma.sub(1.0), 0)
        return s.mul(bright)
      })
      .reduce((a, b) => a.add(b))
    const bloom = bloomSum.mul(1 / taps.length)
    return vec4(base.rgb.add(bloom.mul(0.55)), 1)
  })()
  const compositeQuad = new THREE.QuadMesh(compositeMat)

  function resize() {
    const w = Math.max(1, container.clientWidth || window.innerWidth)
    const h = Math.max(1, container.clientHeight || window.innerHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    superTarget.setSize(w * AA_SCALE, h * AA_SCALE)
    uTexel.value.set(1 / (w * AA_SCALE), 1 / (h * AA_SCALE))
  }
  resize()
  window.addEventListener('resize', resize)
  // Belt-and-braces: a `ResizeObserver` on the container catches real layout
  // changes that a `window` resize event can miss (e.g. a display change or
  // DPI switch that doesn't resize the OS window itself).
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(resize)
    ro.observe(container)
  }

  // Overlays drawn after the post chain (rain, lens flare, spray).
  let postOverlay = null

  /** @param {((renderer: import('three/webgpu').WebGPURenderer) => void)|null} fn */
  function setPostOverlay(fn) {
    postOverlay = fn
  }

  /**
   * Advance the sea and keep the sky, sun and shadow box attached to the
   * camera. Call once per frame before render(), with the same `t` the
   * buoyancy maths uses — the ocean shader and `waveHeight` share it.
   */
  /**
   * @param {number} t campaign / menu time
   * @param {{
   *   cloudCover?: number,
   *   sunMul?: number,
   *   fogMul?: number,
   *   hemiMul?: number,
   *   flash?: number,
   *   storm?: number,
   *   rain?: number,
   *   rainGloom?: number,
   *   stormGloom?: number
   * } | null} [weather] optional rain/storm modifiers from render/weather.js
   * @param {{ shadowExtent?: number, normalBias?: number, bias?: number }} [shadow]
   *   view-specific shadow tuning; on-foot / berth use a tighter box for
   *   contact detail, open water a wider one for long hull shadows.
   */
  let shadowFrame = 0
  let lastShadowMapFrame = -Infinity
  let lastShadowCameraTarget = new THREE.Vector3()
  let lastShadowDirection = new THREE.Vector3()
  let lastEnvironmentTarget = new THREE.Vector3()
  let lastShadowExtent = -1
  let lastCelestialMode = ''
  let lastShadowEnabled = false
  let haveShadowHistory = false

  function updateEnvironment(t, weather = null, shadow = null) {
    const day = daylightAt(t)
    const cloudCover = weather?.cloudCover ?? 0.52
    const sunMul = weather?.sunMul ?? 1
    const fogMul = weather?.fogMul ?? 1
    const hemiMul = weather?.hemiMul ?? 1
    const flash = weather?.flash ?? 0
    const storm = weather?.storm ?? 0
    // Gloom leads/lags precipitation so the deck darkens before drops start
    // and recovers after the front has passed (see weather.js PRELUDE/AFTERMATH).
    const rainGloom = weather?.rainGloom ?? weather?.rain ?? 0
    const stormGloom = weather?.stormGloom ?? weather?.storm ?? 0

    // Sky dome + cloud deck.
    const su = skyDome.material.uniforms
    su.uSunDir.value.copy(day.sunDirection)
    su.uMoonDir.value.copy(day.moonDirection)
    su.uMoonPhase.value = day.moonPhase
    su.uZenith.value.copy(day.zenith)
    su.uHorizon.value.copy(day.horizon)
    su.uSunColor.value.copy(day.sunColor)
    su.uCloudColor.value.copy(day.cloudColor)
    su.uCloudLit.value.copy(day.cloudLit)
    // Procedural deck: wet slate in rain, near-black in thunderstorms.
    // Driven by *gloom* (gradual), not raw precipitation (which starts later).
    if (rainGloom > 0.02 || stormGloom > 0.02) {
      const rainW = Math.min(1, rainGloom) * (1 - stormGloom * 0.35)
      const stormW = Math.min(1, stormGloom)
      if (rainW > 0.02) {
        su.uCloudColor.value.lerp(_wxRainCloud, 0.6 * rainW)
        su.uCloudLit.value.lerp(_wxRainCloudLit, 0.55 * rainW)
        su.uCloudColor.value.multiplyScalar(1 - 0.32 * rainW)
        su.uCloudLit.value.multiplyScalar(1 - 0.26 * rainW)
      }
      if (stormW > 0.02) {
        // Heavy thunder deck: charcoal body, muted cold rims, crushed sky.
        su.uCloudColor.value.lerp(_wxStormCloud, 0.88 * stormW)
        su.uCloudLit.value.lerp(_wxStormCloudLit, 0.78 * stormW)
        su.uCloudColor.value.multiplyScalar(1 - 0.55 * stormW)
        su.uCloudLit.value.multiplyScalar(1 - 0.48 * stormW)
        su.uZenith.value.multiplyScalar(1 - 0.5 * stormW)
        su.uHorizon.value.multiplyScalar(1 - 0.48 * stormW)
        // Cool the remaining sky toward wet steel (not just dimmed noon blue).
        // Crush the bright horizon band that otherwise reads as fair weather.
        su.uZenith.value.lerp(_wxStormFog, 0.42 * stormW)
        su.uHorizon.value.lerp(_wxStormFog, 0.55 * stormW)
      } else if (rainW > 0.02) {
        su.uZenith.value.multiplyScalar(1 - 0.14 * rainW)
        su.uHorizon.value.multiplyScalar(1 - 0.12 * rainW)
      }
    }
    // Lightning: directional lift of the dome — brighter toward the strike side,
    // never a uniform white-out of the whole sky.
    if (flash > 0.05) {
      const sheet = weather?.sheet ?? 0
      // Soft lift only — full-dome whiteout is the fake-lightning tell.
      const lift = flash * (0.38 - 0.12 * sheet)
      su.uZenith.value.lerp(_wxFlashZenith, lift * 0.7)
      su.uHorizon.value.lerp(_wxFlashHorizon, lift * (0.4 + 0.25 * sheet))
      su.uCloudLit.value.lerp(_wxFlashCloud, lift * (0.75 + 0.2 * sheet))
      // Underlit cloud belly on a near bolt (hot core on the lit face).
      if (sheet < 0.5) su.uCloudColor.value.lerp(_wxFlashCloud, lift * 0.16)
    }
    su.uCloudCover.value = cloudCover
    su.uStars.value = day.starOpacity * (storm > 0.3 ? 1 - storm * 0.7 : 1)
    su.uTime.value = t
    skyDome.position.copy(camera.position)

    // Fog follows the sky, or the horizon reads as a different time of day
    // from the dome above it.
    scene.fog.color.copy(day.fog)
    if (rainGloom > 0.05 && stormGloom < 0.05) scene.fog.color.lerp(_wxStormFog, 0.22 * rainGloom)
    if (stormGloom > 0.05) scene.fog.color.lerp(_wxStormFog, 0.55 * stormGloom)
    if (flash > 0.05) scene.fog.color.lerp(_wxFlashFog, flash * 0.35)
    scene.fog.density = day.fogDensity * fogMul

    // Key light. The shadow box travels with the player — an ocean-wide shadow
    // map would be all texel and no detail. At night the same light becomes a
    // cool moon key, keeping one shadow map instead of rendering both lights.
    // The sun stays the key well after it has set. It is what lights the
    // underside of the cloud deck and the whole western sky through dusk, and
    // cutting it the instant `y` crosses zero replaced a low warm raking key
    // with a flat 0.48 zenith fill — a hard lighting cliff at sunset, which is
    // the lighting half of the "there is no twilight" report. -0.16 is roughly
    // civil twilight and is where `sky.js` starts calling it night.
    const sunUp = day.sunDirection.y > -0.16
    const moonAltitude = Math.max(0, day.moonDirection.y)
    const moonUp = moonAltitude > 0.02 && day.moonPhase > 0.03
    const useMoonKey = !sunUp && moonUp
    // Scratch — never mutate daylightAt's shared direction vectors.
    // If neither body is up, keep the key aimed at the last celestial bearing
    // but nearly dark — never park the directional light *under* the sea
    // (sunDirection.y < 0 would light hulls from below).
    if (useMoonKey) {
      _keyDirScratch.copy(day.moonDirection)
    } else if (sunUp) {
      _keyDirScratch.copy(day.sunDirection)
    } else {
      // Both below the horizon: prefer a moon-side residual if any elevation
      // remains, otherwise a soft zenith fill so the scene is not key-less.
      if (day.moonDirection.y > day.sunDirection.y) {
        _keyDirScratch.copy(day.moonDirection)
        if (_keyDirScratch.y < 0.08) _keyDirScratch.y = 0.08
      } else {
        _keyDirScratch.set(0.15, 0.95, 0.2)
      }
      _keyDirScratch.normalize()
    }
    const keyMode = useMoonKey ? 'moon' : 'sun'
    // How far into night we are: 0 with the sun up, 1 at full dark.
    //
    // This has to ride the *sky's* twilight curve, not a window of its own.
    // `sky.js` deliberately stretches dusk — its blue hour sits at elevation
    // -0.20 and full night does not arrive until -0.72 — while this was a 0.2
    // wide ramp starting at the horizon, so it reached 0.92 with the sun only
    // 1.4° down. Measured at hour 18: elevation -0.025 and nightF 0.92, i.e.
    // the exposure was already a stop and a half up and the ambient already
    // halved while the sunset band was still burning across the sky. That is
    // why 18:00 came back as a black sea with blown-white specular: night
    // exposure applied to daylight-range highlights.
    const nightF = smoothstep01((0.02 - day.elevation) / 0.74)
    // Expose *up* at night and light *down*, instead of flat exposure with a
    // lifted ambient. The old floors (moon key 1.45, hemi 0.9, env 0.72 — half
    // a noon sun) are why the hillside at 21:00 read as a tan daylit slope while
    // the sea, whose colour comes from the sky palette and not from these
    // lights, stayed nearly black. Net on screen: terrain roughly halves, the
    // water roughly doubles.
    const moonIntensity =
      (0.2 + 0.3 * day.moonPhase) * Math.min(1, 0.2 + moonAltitude * 2.8)
    // During a flash, swing the key toward the strike so the world is lit
    // directionally (hull rims, waves) instead of just getting brighter.
    const flashW = flash > 0.05 ? Math.min(1, flash * 0.85) : 0
    if (flashW > 0.01 && weather?.flashDir) {
      _flashDirScratch.set(weather.flashDir.x, weather.flashDir.y, weather.flashDir.z)
      if (_flashDirScratch.lengthSq() > 1e-6) {
        _flashDirScratch.normalize()
        _keyDirScratch.lerp(_flashDirScratch, flashW * 0.92).normalize()
      }
    }
    sun.color.copy(useMoonKey ? _moonLightColor : day.sunColor)
    if (flashW > 0.01) sun.color.lerp(_wxFlashKey, flashW * 0.75)
    // Weather sunMul still dims the moon under heavy cloud (overcast nights).
    const keyBase = useMoonKey
      ? moonIntensity
      : sunUp
        ? // Full strength while it is genuinely up; fades to nothing across
          // civil twilight so the key dies with the light instead of snapping
          // off at the horizon. Exactly 1 for any y >= 0.02, so daylight is
          // untouched.
          day.sunIntensity * smoothstep01((day.sunDirection.y + 0.16) / 0.18)
        : Math.max(0.04, day.sunIntensity * 0.35)
    sun.intensity = keyBase * sunMul + (flash > 0.05 ? flash * 3.2 : 0)
    sun.target.position.set(camera.position.x, 0, camera.position.z)
    // Distance scales with the shadow box so the ortho depth range stays tight
    // (better precision → less acne, crisper contact at the waterline).
    const shadowExtent = Math.max(24, Number(shadow?.shadowExtent) || 112)
    // Low sun stretches the depth range of the ortho frustum — sit the key
    // farther out and widen near/far so casters are not clipped. Cap distance
    // so we do not throw away depth precision again.
    const elevAbs = Math.max(0.12, Math.abs(_keyDirScratch.y))
    const keyDist = Math.min(
      1600,
      Math.max(340, (380 + shadowExtent * 2.2) / elevAbs * 0.5)
    )
    sun.position.copy(sun.target.position).addScaledVector(_keyDirScratch, keyDist)
    shadowCam.left = -shadowExtent
    shadowCam.right = shadowExtent
    shadowCam.top = shadowExtent
    shadowCam.bottom = -shadowExtent
    // Depth slab: low sun needs more pad; high sun stays tight for precision.
    const depthPad = shadowExtent * (1.35 + 1.1 * (1 - elevAbs)) + 70
    shadowCam.near = Math.max(4, keyDist - depthPad)
    shadowCam.far = keyDist + depthPad
    // Shadow bias in the only unit that means anything: shadow-map texels.
    //
    // The box is resized every frame (24 on foot, ~120 in open water), so one
    // absolute normalBias cannot be correct for both — at the wide end a fixed
    // 0.014 is a sixteenth of a texel, which is no bias at all, and broad lit
    // surfaces self-shadow into a fine screen-wide moiré. One texel here is
    // `2 * extent / mapSize`, and ~1.6 of them is what actually clears acne on
    // a sloped deck without lifting hull shadows off the waterline.
    //
    // The caller's `normalBias` / `bias` are deliberately ignored. Every value
    // main.js passes is in the old absolute unit and is an order of magnitude
    // too small once the box opens up; `shadowExtent` is the knob that still
    // matters and it is honoured above.
    const shadowTexel = (2 * shadowExtent) / (sun.shadow.mapSize.x || 1024)
    // 0.7 of a texel, not 1.6. `normalBias` slides the *receiver* along its own
    // normal, so it is also exactly the knob that detaches a shadow from the
    // thing casting it — every centimetre of it is peter-panning bought to pay
    // for acne. 1.6 texels at 1024 was 30 cm and deleted the contact shadow of
    // every prop in the harbour. Sub-texel is enough here because the constant
    // depth bias below carries the flat-surface case and PCF blurs the rest.
    sun.shadow.normalBias = shadowTexel * 0.7
    // Constant depth bias, expressed against the actual depth slab rather than
    // as a magic constant — a wide slab means each depth unit is coarser.
    const shadowSlab = Math.max(1, shadowCam.far - shadowCam.near)
    sun.shadow.bias = -Math.min(0.002, (shadowTexel / shadowSlab) * 2)
    // Slightly softer penumbra at night (moon) / harder by day.
    sun.shadow.radius = useMoonKey ? 1.55 : 1.05
    shadowCam.updateProjectionMatrix()
    // No point paying for a shadow pass when neither celestial source is up.
    // Lightning still changes illumination, but it is not a stable shadow key.
    const shadowEnabled = sunUp || useMoonKey
    sun.castShadow = shadowEnabled

    // Static world geometry does not need a new depth map every render. Moving
    // actors still get responsive shadows: refresh every two frames while the
    // camera is moving, and every eight frames while it is settled. This keeps
    // the shadow pass bounded without leaving a visibly stale avatar/ship.
    const cameraMoved =
      !haveShadowHistory || sun.target.position.distanceToSquared(lastEnvironmentTarget) > 0.0025
    const shadowCadence = cameraMoved ? 2 : 8
    const modeChanged = keyMode !== lastCelestialMode || shadowEnabled !== lastShadowEnabled
    const extentChanged = Math.abs(shadowExtent - lastShadowExtent) > 0.01
    const shadowDue = shadowFrame - lastShadowMapFrame >= shadowCadence
    const shadowDirectionChanged =
      !haveShadowHistory || _keyDirScratch.dot(lastShadowDirection) < 0.9998
    const shadowTargetMoved =
      !haveShadowHistory || sun.target.position.distanceToSquared(lastShadowCameraTarget) > 0.01
    if (shadowEnabled && (modeChanged || extentChanged || shadowDirectionChanged || shadowTargetMoved || shadowDue)) {
      sun.shadow.needsUpdate = true
      lastShadowMapFrame = shadowFrame
      lastShadowCameraTarget.copy(sun.target.position)
      lastShadowDirection.copy(_keyDirScratch)
    } else if (!shadowEnabled) {
      sun.shadow.needsUpdate = false
    }
    lastEnvironmentTarget.copy(sun.target.position)
    lastShadowExtent = shadowExtent
    lastCelestialMode = keyMode
    lastShadowEnabled = shadowEnabled
    haveShadowHistory = true
    shadowFrame++

    hemi.color.copy(day.hemiSky)
    hemi.groundColor.copy(day.hemiGround)
    // Cool the fill under storm so metal reads wet rather than lit grey.
    if (stormGloom > 0.05) {
      hemi.color.lerp(_wxStormFog, 0.35 * stormGloom)
      hemi.groundColor.lerp(_wxStormFog, 0.25 * stormGloom)
    }
    // Moon nights: a cool sky fill so decks/hulls get bounce rather than pure
    // black, but a *small* one — see the exposure note above. The floor exists
    // only so a new moon is not literally unlit.
    let hemiI = day.hemiIntensity * hemiMul * (1 - 0.5 * nightF)
    if (useMoonKey) {
      hemiI = Math.max(hemiI, 0.16 + 0.14 * day.moonPhase * Math.min(1, moonAltitude * 2.2))
      // Only a whisper toward the moon tint. `day.hemiSky` at night is already
      // 0x18212f — cold and dark, which is right. Lerping it half way to the
      // moon's 0xa8bce0 does not "cool" it, it *triples* its luminance, and a
      // HemisphereLight multiplies colour by intensity: that lerp was a hidden
      // 3x on the night fill.
      hemi.color.lerp(_moonLightColor, 0.1 + 0.1 * day.moonPhase)
    }
    hemi.intensity = hemiI + flash * 1.25
    // IBL fills metal plates the key light misses. Bias slightly above the
    // raw daylight env so wet hulls read sky/sea instead of black voids under
    // Neutral (which leaves sub-1.0 values alone). Storm still kills bounce.
    let envI =
      day.envIntensity * (0.55 + 0.45 * sunMul) * (1 - 0.45 * stormGloom) * (1 - 0.5 * nightF) +
      flash * 0.4
    if (useMoonKey) {
      // Deliberately tiny. `scene.environment` is a PMREM of the *midday* sky,
      // baked once at boot (rebaking per frame is not affordable) — so every
      // unit of it is warm daylight irradiance with a sun disc in it. That is
      // the entire reason night terrain read as warm olive rather than as a
      // cold moonlit slope: the hemisphere fill is correctly cold, and this was
      // quietly adding daylight on top of it. It stays non-zero only so wet
      // metal keeps something to reflect.
      envI = Math.min(envI, 0.05 + 0.05 * day.moonPhase * Math.min(1, moonAltitude * 2))
    }
    scene.environmentIntensity = envI

    // Grade. Done here rather than at boot because it has to follow the same
    // clock as everything else, and because postFx's bloom threshold and clamp
    // are display-referred and are derived from it.
    postFx.setExposure(DAY_EXPOSURE + (NIGHT_EXPOSURE - DAY_EXPOSURE) * nightF)

    // Water. Its colour and its sun track come from the same clock as the sky.
    const ou = ocean.material.uniforms
    ou.uSunDir.value.copy(day.sunDirection)
    // During flash, water specular also comes from the strike direction.
    if (flashW > 0.01) ou.uSunDir.value.copy(_keyDirScratch)
    ou.uDeepColor.value.copy(day.seaDeep)
    ou.uCrestColor.value.copy(day.seaCrest)
    ou.uSkyColor.value.copy(day.horizon)
    ou.uZenithColor.value.copy(day.zenith)
    ou.uCloudColor.value.copy(su.uCloudColor.value)
    ou.uCloudLit.value.copy(su.uCloudLit.value)
    ou.uCloudCover.value = cloudCover
    if (rainGloom > 0.05 || stormGloom > 0.05) {
      // Darker, greyer sea under wet weather — wet metal mood on the water too.
      const g = Math.max(rainGloom * 0.45, stormGloom)
      ou.uDeepColor.value.multiplyScalar(1 - 0.22 * g)
      ou.uCrestColor.value.multiplyScalar(1 - 0.16 * g)
      ou.uDeepColor.value.lerp(_wxStormFog, 0.12 * g)
    }
    ou.uSunColor.value.copy(day.sunColor)
    if (flashW > 0.01) ou.uSunColor.value.lerp(_wxFlashKey, flashW)
    ou.uMoonDir.value.copy(day.moonDirection)
    // Water moon path: phase * altitude so a high full moon tracks hard, a
    // low crescent stays a faint line (not a missing one).
    ou.uMoonBright.value =
      day.moonPhase * Math.min(1.15, 0.35 + moonAltitude * 2.4) * (useMoonKey ? 1.25 : 0.85)
    ou.fogColor.value.copy(scene.fog.color)
    // Rain pockmarks the near water (cheap ripple boost) — see oceanMesh.
    if (ou.uRainRipple) ou.uRainRipple.value = weather?.rainRipple ?? 0
    ocean.update(camera, t)
    // Handed back so callers can drive camera-space effects (the lens flare)
    // from the same clock, rather than calling daylightAt again and risking a
    // different `t`. Note this is daylightAt's shared object — use it now, do
    // not hold on to it.
    return day
  }

  /**
   * Draw a frame on the WebGPU backend, then camera-space overlays.
   *
   * Renders the scene into an offscreen supersampled target, then a plain
   * quad draw box-filters that down to the swapchain (AA) and adds a cheap
   * bright-tap bloom in the same pass — bypassing `postFx` (AO/DOF/grade/
   * SMAA/sharpen/vignette/grain) entirely. On the packaged app, presenting
   * `postFx`'s output to *this machine's real, on-screen swapchain* produced
   * a blank, washed-out frame — every time, at boot and after undock —
   * regardless of scene population, camera position, window sizing/timing,
   * or window geometry, all individually confirmed correct at the moment of
   * failure; the shot harness and dev server never reproduced it, because
   * neither ever presents to a real, shown window (see qa-shots/BRIEF.md). A
   * bare `renderer.render(scene, camera)`, and separately a bare
   * `renderer.render()` of a `THREE.QuadMesh`, were each confirmed by hand,
   * in the packaged app, to present correctly where `postFx.render()` did
   * not — this function uses only those two, never `RenderPipeline`. The
   * mechanism is still unknown; a shader-compile/output-color-space theory
   * that would explain it did not hold up (see git history on this line and
   * webgpuBoot.js).
   *
   * `postFx` is still fully built and is what `captureFrame()` below uses —
   * unaffected, since real play never calls it (only the `?shot=` harness
   * does). Do not "fix" this by routing captureFrame() through this function
   * or vice versa: interleaving the two in one session was observed to leave
   * the WebGPU backend producing solid black afterward, in a way a full
   * revert of *both* was needed to clear. Whoever revisits the swapchain bug
   * itself needs the actual packaged app (`npm run build && npx electron .`).
   */
  function render() {
    const prevTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(superTarget)
    renderer.render(scene, camera)
    renderer.setRenderTarget(prevTarget)
    compositeQuad.render(renderer)
    if (!postOverlay) return
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false
    try {
      postOverlay(renderer)
    } catch (err) {
      if (!render._overlayWarned) {
        render._overlayWarned = true
        console.warn('[scene] postOverlay failed', err)
      }
    }
    renderer.autoClear = prevAutoClear
  }

  /**
   * Capture one finished frame as RGBA bytes (shot harness).
   * WebGPU readback is async — callers must await this.
   *
   * This runs the *same* pipeline as render(), into an offscreen target rather
   * than the swapchain. It used to call `renderer.render(scene, camera)`
   * instead, which quietly handed every visual-QA screenshot a frame with no
   * MSAA, no AO, no grade and no AA — i.e. everyone was grading an image the
   * player never sees. If you change render(), change this in lockstep.
   */
  async function captureFrame() {
    const size = new THREE.Vector2()
    renderer.getDrawingBufferSize(size)
    // Linear-tagged on purpose: the pipeline has already tone-mapped and sRGB
    // encoded by this point, so the target must not encode a second time.
    const target = new THREE.RenderTarget(size.x, size.y, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.LinearSRGBColorSpace
    })
    const prevTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(target)
    postFx.render()
    if (postOverlay) {
      renderer.autoClear = false
      postOverlay(renderer)
      renderer.autoClear = true
    }
    const buffer = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size.x, size.y)
    renderer.setRenderTarget(prevTarget)
    target.dispose()
    const pixels = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    return { width: size.x, height: size.y, pixels }
  }

  return {
    scene,
    camera,
    renderer,
    render,
    captureFrame,
    updateEnvironment,
    setPostOverlay,
    ocean,
    sun,
    areaLights,
    postFx
  }
}
