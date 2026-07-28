import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { createOcean } from './oceanMesh.js'
import { daylightAt, SKY_SHADER, skyUniforms } from './sky.js'

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
 * Exported because the boatyard preview runs its own WebGL context, and a PMREM
 * texture belongs to the renderer that baked it — it needs its own copy.
 */
export function createSkyEnvironment(renderer) {
  const geometry = new THREE.SphereGeometry(1, 32, 16)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms(),
    vertexShader: SKY_SHADER.vertex,
    fragmentShader: SKY_SHADER.fragment
  })
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

export function createScene(container) {
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

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  // Khronos PBR Neutral, not ACES. The VFX here (spray, muzzle flash, tracer
  // fire, burning wrecks) are additive sprites authored in LDR — ACES pulls
  // in-range colour down and desaturates it, veiling the whole frame in milk.
  // Neutral leaves anything under 1.0 essentially untouched and only rolls off
  // what actually overflows, so existing art survives and the hot pixels still
  // get a filmic shoulder.
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)
  // Fill the container; size from client rect so aspect matches the pixels the
  // player actually sees (window.inner* can disagree with the canvas box).
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'

  scene.environment = createSkyEnvironment(renderer)

  // Sky dome, drawn first and never depth-written, repositioned onto the camera
  // in render() so it can never be sailed out of. Kept out of the fog: fogging
  // the sky with a colour sampled from the sky is a flat grey screen.
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: skyUniforms(),
      vertexShader: SKY_SHADER.vertex,
      fragmentShader: SKY_SHADER.fragment
    })
  )
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
  const sun = new THREE.DirectionalLight(day0.sunColor.getHex(), day0.sunIntensity)
  sun.position.copy(day0.sunDirection).multiplyScalar(1200)
  sun.castShadow = true
  // The shadow box travels with the player (see render()). It only has to cover
  // the boat and whatever it is moored against — an ocean-wide shadow map would
  // be all texel and no detail.
  sun.shadow.mapSize.set(2048, 2048)
  const shadowCam = sun.shadow.camera
  shadowCam.near = 1
  shadowCam.far = 3000
  shadowCam.left = -320
  shadowCam.right = 320
  shadowCam.top = 320
  shadowCam.bottom = -320
  sun.shadow.bias = -0.0006
  sun.shadow.normalBias = 0.6
  scene.add(sun)
  scene.add(sun.target)
  // Sky above, sea bounce below — the standard outdoor fill. Without the sea
  // term the undersides of hulls and jetties go pure black.
  const hemi = new THREE.HemisphereLight(day0.hemiSky.getHex(), day0.hemiGround.getHex(), day0.hemiIntensity)
  scene.add(hemi)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  // Threshold at 1.0: only pixels that actually overflow LDR bloom (sun track
  // on the water, muzzle flash, weapon fire, fires on a burning hull). Anything
  // lower catches the big additive sprites whole and fogs the entire frame.
  // Strength/radius stay small — glossy wet surfaces throw specular highlights
  // far above 1.0, and at higher settings the pass smears a single glint into a
  // white blob covering the player's own boat.
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.28, 1.0)
  composer.addPass(bloom)
  // OutputPass owns tone mapping + sRGB encode once composer is in the path.
  composer.addPass(new OutputPass())

  const bufferSize = new THREE.Vector2()
  function resize() {
    const w = Math.max(1, container.clientWidth || window.innerWidth)
    const h = Math.max(1, container.clientHeight || window.innerHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
    // Composer targets are drawing-buffer sized, not CSS sized, or the whole
    // post chain runs at 1/pixelRatio and the frame comes back soft.
    renderer.getDrawingBufferSize(bufferSize)
    composer.setSize(bufferSize.x, bufferSize.y)
  }
  resize()
  window.addEventListener('resize', resize)

  // Overlays drawn straight to the screen after the post chain, for camera
  // artifacts that must sit on the formed image rather than inside the world
  // being photographed. Registered once here instead of at each render() call
  // site (there are six across animate()).
  let postOverlay = null

  /** @param {((renderer: THREE.WebGLRenderer) => void)|null} fn */
  function setPostOverlay(fn) {
    postOverlay = fn
  }

  /**
   * Advance the sea and keep the sky, sun and shadow box attached to the
   * camera. Call once per frame before render(), with the same `t` the
   * buoyancy maths uses — the ocean shader and `waveHeight` share it.
   */
  function updateEnvironment(t) {
    const day = daylightAt(t)

    // Sky dome + cloud deck.
    const su = skyDome.material.uniforms
    su.uSunDir.value.copy(day.sunDirection)
    su.uZenith.value.copy(day.zenith)
    su.uHorizon.value.copy(day.horizon)
    su.uCloudColor.value.copy(day.cloudColor)
    su.uCloudLit.value.copy(day.cloudLit)
    su.uStars.value = day.starOpacity
    su.uTime.value = t
    skyDome.position.copy(camera.position)

    // Fog follows the sky, or the horizon reads as a different time of day
    // from the dome above it.
    scene.fog.color.copy(day.fog)
    scene.fog.density = day.fogDensity

    // Key light. The shadow box travels with the player — an ocean-wide shadow
    // map would be all texel and no detail.
    sun.color.copy(day.sunColor)
    sun.intensity = day.sunIntensity
    sun.target.position.set(camera.position.x, 0, camera.position.z)
    sun.position.copy(sun.target.position).addScaledVector(day.sunDirection, 1200)
    // No point paying for a shadow pass once the sun is down.
    sun.castShadow = day.sunDirection.y > 0.02

    hemi.color.copy(day.hemiSky)
    hemi.groundColor.copy(day.hemiGround)
    hemi.intensity = day.hemiIntensity
    scene.environmentIntensity = day.envIntensity

    // Water. Its colour and its sun track come from the same clock as the sky.
    const ou = ocean.material.uniforms
    ou.uSunDir.value.copy(day.sunDirection)
    ou.uDeepColor.value.copy(day.seaDeep)
    ou.uCrestColor.value.copy(day.seaCrest)
    ou.uSkyColor.value.copy(day.horizon)
    ou.uSunColor.value.copy(day.sunColor)
    ou.fogColor.value.copy(day.fog)
    ocean.update(camera, t)
  }

  /** Draw a frame through the post chain. Swap-in for renderer.render(scene, camera). */
  function render() {
    composer.render()
    if (!postOverlay) return
    // OutputPass left us on the default framebuffer; keep its colour and just
    // draw over it.
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false
    postOverlay(renderer)
    renderer.autoClear = prevAutoClear
  }

  return {
    scene,
    camera,
    renderer,
    render,
    updateEnvironment,
    setPostOverlay,
    ocean,
    sun
  }
}
