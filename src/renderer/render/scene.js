import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// Image-based light. Ships/stations run metalness 0.85–0.92, and a metal with
// no environment to reflect resolves to near-black under a single light — that
// flat "plastic toy" read was the biggest gap between this and a real-looking
// space sim. A dim Milky-Way-ish band (bright around the galactic plane, fading
// to near-black at the poles) gives every metal surface something to mirror,
// and the gradient makes highlights travel across a hull as it turns.
// Env luminance stays well under 0.2 so it never doubles as a fill light.
// Exported because the shipyard preview runs its own WebGL context, and a
// PMREM texture belongs to the renderer that baked it — it needs its own copy.
export function createSpaceEnvironment(renderer) {
  const geometry = new THREE.SphereGeometry(1, 32, 16)
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        // Galactic plane: tight bright band at the equator of the env sphere.
        float band = pow(1.0 - abs(vDir.y), 7.0);
        // Gentle side-to-side lift so a rotating hull sweeps through it.
        float sweep = 0.55 + 0.45 * vDir.x;
        vec3 c = mix(vec3(0.016, 0.021, 0.040), vec3(0.115, 0.120, 0.180), band);
        c += vec3(0.055, 0.038, 0.022) * band * sweep;  // warm core-ward dust
        c += vec3(0.010, 0.016, 0.030) * (1.0 - band);  // faint cold sky floor
        gl_FragColor = vec4(c, 1.0);
      }`
  })
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
  scene.background = new THREE.Color(0x05070d)

  // Far plane must clear a full system diameter (local scatter up to ~300k+
  // after the large sun/planet system scale-up) so the star stays visible
  // from the rim / arrival point.
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2_000_000)

  // A 0.5 near / 2e6 far range leaves a normal depth buffer with almost no
  // precision far out: at ~300 km it can only separate surfaces ~10,000 units
  // apart, so the star's corona shells and streamers won per-pixel coin flips
  // against the photosphere and the sun visibly boiled with z-fighting.
  // Log depth spreads precision across the whole range and settles it.
  // Custom ShaderMaterials must opt in with the logdepthbuf chunks or they
  // render at the wrong depth — see planetMesh.js and warpGateMesh.js.
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    logarithmicDepthBuffer: true
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  // Khronos PBR Neutral, not ACES. This game's VFX (star halos, engine plumes,
  // laser bolts, nebula) are additive sprites authored in LDR — ACES pulls
  // in-range colour down and desaturates it, which turned the blue nebula grey
  // and veiled the whole frame in milk. Neutral leaves anything under 1.0
  // essentially untouched and only rolls off what actually overflows, so
  // existing art survives and the new hot pixels still get a filmic shoulder.
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.0
  container.appendChild(renderer.domElement)
  // Fill the container; size from client rect so aspect matches the pixels the
  // player actually sees (window.inner* can disagree with the canvas box).
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'

  // environment only — scene.background stays the per-system star tint.
  scene.environment = createSpaceEnvironment(renderer)

  // The star is the light source, and main.js parks every system's star group
  // at world origin, so the key light belongs there too. The old fixed
  // DirectionalLight lit every body from (300,400,500) regardless of where the
  // sun actually was, which is why terminators never lined up with the star.
  // decay 0 = no inverse-square falloff, so a body 600k units out is lit the
  // same as one at 5k.
  // ponytail: single light for binaries too — companions orbit close enough to
  // origin that it reads fine; give each entry in starMesh.userData.stars its
  // own light only if wide binaries start looking wrong.
  // Built at boot, never at runtime: a light added mid-session recompiles every
  // MeshStandardMaterial (the combat hitch shipMesh.js warns about).
  // Intensity is deliberately close to the old directional 1.5: with decay 0
  // there is no falloff, so this lands at full strength on a hull 20 m away.
  // Higher values clipped ship plating to flat white before bloom even ran.
  const sun = new THREE.PointLight(0xfff2df, 1.7, 0, 0)
  scene.add(sun)
  // Starlight/zodiacal fill so night sides read as dark rather than pure black.
  scene.add(new THREE.AmbientLight(0x232a3d, 0.55))

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  // Threshold at 1.0: only pixels that actually overflow LDR bloom (star cores,
  // engine plumes, weapon fire). Anything lower catches the big additive halo
  // sprites whole and fogs the entire frame.
  // Strength/radius are deliberately small. A glossy canopy (roughness 0.06)
  // throws a specular highlight far above 1.0, and at higher settings the pass
  // smeared that single glint into a white blob covering the player's own ship.
  // Low and tight reads as a glint that blooms, which is the point.
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

  // Overlays drawn straight to the screen after the post chain — currently the
  // lens flare, which is a camera artifact and so must sit on top of the formed
  // image rather than inside the world being photographed. Registered once here
  // instead of at each render() call site (there are six across animate()).
  let postOverlay = null

  /** @param {((renderer: THREE.WebGLRenderer) => void)|null} fn */
  function setPostOverlay(fn) {
    postOverlay = fn
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

  /**
   * Tint the key light with the local star (main.js already derives this for
   * the starfield/background). null resets to neutral sunlight.
   * @param {THREE.Color|number|null} starColor
   */
  function setSunColor(starColor) {
    if (starColor == null) {
      sun.color.set(0xfff2df)
      return
    }
    const c = starColor.isColor ? starColor.clone() : new THREE.Color(starColor)
    // Keep most of the neutral white — a fully saturated red dwarf key light
    // makes every hull read as one flat colour.
    sun.color.set(0xfff2df).lerp(c, 0.45)
  }

  return { scene, camera, renderer, render, setSunColor, setPostOverlay }
}
