import * as THREE from 'three'

/**
 * Screen-space lens flare, drawn as an overlay AFTER the bloom/tone-mapping
 * chain (see scene.js setPostOverlay).
 *
 * Replaces three's Lensflare addon, which lived inside the scene and worked out
 * its own occlusion by rendering a probe quad into the framebuffer, copying it
 * back out, then blitting the saved pixels over the top. That round trip is
 * fine for a plain renderer.render() but fights an EffectComposer, and any
 * residue it left behind was then amplified by the bloom pass.
 *
 * It is also just the wrong place in the pipeline: a flare is an artifact of
 * the camera lens, so it belongs after the image is formed, not as geometry
 * inside the world being photographed. Rendering it here means no readback, no
 * interaction with bloom, and no depth games — visibility is passed in by the
 * caller, which can answer "is the sun behind a planet" far more cheaply with
 * a ray test than the GPU can with an occlusion probe.
 */

function createRadialTexture(stops) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [offset, color] of stops) gradient.addColorStop(offset, color)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

function createGlowTexture() {
  return createRadialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.2, 'rgba(255,255,255,0.85)'],
    [0.5, 'rgba(255,255,255,0.22)'],
    [1, 'rgba(255,255,255,0)']
  ])
}

function createDotTexture() {
  return createRadialTexture([
    [0, 'rgba(255,255,255,1)'],
    [0.6, 'rgba(255,255,255,0.45)'],
    [1, 'rgba(255,255,255,0)']
  ])
}

// A hollow ring — the wide, faint halo that sits past screen centre.
function createRingTexture() {
  return createRadialTexture([
    [0, 'rgba(255,255,255,0)'],
    [0.55, 'rgba(255,255,255,0)'],
    [0.64, 'rgba(255,255,255,0.75)'],
    [0.74, 'rgba(255,255,255,0)'],
    [1, 'rgba(255,255,255,0)']
  ])
}

// Soft-edged hexagon — the aperture-blade shape real internal-reflection
// ghosts take. Kept small and faint here; oversized hex ghosts are what made
// the previous flare read as a rendering fault rather than a lens.
function createHexTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const r = size * 0.42
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const x = size / 2 + Math.cos(a) * r
    const y = size / 2 + Math.sin(a) * r
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  }
  ctx.closePath()
  // Alpha has to reach ~zero BEFORE the hexagon path's own boundary. The fill
  // is clipped to that path, so any alpha left at the edge becomes a hard
  // machined rim — which reads as a blocky plate rather than a soft internal
  // reflection. Falls off early so the shape stays hexagonal but soft-edged.
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, r)
  g.addColorStop(0, 'rgba(255,255,255,0.30)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.20)')
  g.addColorStop(0.85, 'rgba(255,255,255,0.05)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}

// The anamorphic streak — the wide horizontal smear a bright light leaves on
// (especially cinema) lenses.
//
// Written per-pixel so the falloff lives in the ALPHA channel. The previous
// version drew a horizontal gradient and then multiplied a vertical one over
// it: canvas 'multiply' composites colour channels but leaves alpha alone, so
// the quad stayed opaque with merely-darkened pixels. Under additive blending
// that rendered as a hard-edged grey rectangle straddling the star — the most
// obvious "why is my flare square" artifact there is. Alpha now reaches true
// zero well inside the quad on both axes, so no edge can show.
function createStreakTexture() {
  const w = 256
  const h = 64
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    // -1..1 across the streak's thickness; tight gaussian = thin bright line.
    const t = (y / (h - 1)) * 2 - 1
    const across = Math.exp(-t * t * 11)
    for (let x = 0; x < w; x++) {
      // -1..1 along the streak; eased so the ends taper out rather than stop.
      const s = (x / (w - 1)) * 2 - 1
      const along = Math.pow(Math.max(0, 1 - Math.abs(s)), 1.7)
      const i = (y * w + x) * 4
      d[i] = 255
      d[i + 1] = 255
      d[i + 2] = 255
      d[i + 3] = Math.round(255 * along * across)
    }
  }
  ctx.putImageData(img, 0, 0)
  return new THREE.CanvasTexture(canvas)
}

// kind: which texture. size: height in NDC (2 = full screen height).
// dist: position along the light→screen-centre axis (0 = on the light, 1 =
// screen centre, >1 = past it). tint: null means "take the star's colour".
// aspectLock: streaks stay wide regardless of the element's round shape.
const ELEMENTS = [
  { kind: 'glow', size: 0.42, dist: 0, tint: null, opacity: 0.5 },
  { kind: 'streak', size: 0.1, dist: 0, tint: [0.55, 0.72, 1.0], opacity: 0.32, wide: 7 },
  { kind: 'hex', size: 0.05, dist: 0.32, tint: [0.45, 0.85, 0.75], opacity: 0.16 },
  { kind: 'dot', size: 0.028, dist: 0.5, tint: [0.6, 0.9, 0.55], opacity: 0.2 },
  { kind: 'hex', size: 0.075, dist: 0.72, tint: [0.6, 0.5, 0.95], opacity: 0.13 },
  { kind: 'dot', size: 0.04, dist: 0.95, tint: null, opacity: 0.16 },
  { kind: 'ring', size: 0.34, dist: 1.18, tint: [0.85, 0.6, 0.4], opacity: 0.1 },
  { kind: 'hex', size: 0.11, dist: 1.45, tint: [0.5, 0.65, 1.0], opacity: 0.09 }
]

/**
 * @returns {{scene: THREE.Scene, camera: THREE.Camera, update: Function, setVisible: Function}}
 */
export function createLensFlare() {
  const textures = {
    glow: createGlowTexture(),
    dot: createDotTexture(),
    ring: createRingTexture(),
    hex: createHexTexture(),
    streak: createStreakTexture()
  }

  const scene = new THREE.Scene()
  // NDC space: x/y run -1..1 across the viewport regardless of resolution.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10)
  camera.position.z = 1

  const quad = new THREE.PlaneGeometry(1, 1)
  const parts = ELEMENTS.map((def) => {
    const mesh = new THREE.Mesh(
      quad,
      new THREE.MeshBasicMaterial({
        map: textures[def.kind],
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        // Already past tone mapping when this draws — mapping it again would
        // double-darken it against the image it sits on.
        toneMapped: false,
        opacity: 0
      })
    )
    mesh.frustumCulled = false
    scene.add(mesh)
    return { def, mesh }
  })

  const ndc = new THREE.Vector3()
  const baseColor = new THREE.Color()
  let visible = false

  /**
   * @param {THREE.Vector3} worldPos star position
   * @param {THREE.Camera} viewCamera the scene camera
   * @param {number} aspect viewport width / height
   * @param {THREE.Color|number|null} color star colour
   * @param {number} occlusion 0 = fully blocked, 1 = clear line of sight
   */
  function update(worldPos, viewCamera, aspect, color, occlusion) {
    ndc.copy(worldPos).project(viewCamera)
    // project() mirrors x/y for points behind the camera, so reject on z.
    const behind = ndc.z > 1
    const radial = Math.hypot(ndc.x, ndc.y)
    // Fade out as the light leaves frame; a flare with the source off-screen
    // still exists in reality but reads as an unexplained smear in a game.
    const onScreen = 1 - THREE.MathUtils.smoothstep(radial, 0.85, 1.6)
    const strength = behind ? 0 : onScreen * Math.max(0, Math.min(1, occlusion))
    visible = strength > 0.002
    if (!visible) return

    baseColor.set(color ?? 0xffffff)
    for (const { def, mesh } of parts) {
      // Ghosts march from the light through screen centre and out the far side.
      mesh.position.set(ndc.x * (1 - def.dist), ndc.y * (1 - def.dist), 0)
      const h = def.size
      // Keep round elements round: NDC is square but the viewport is not.
      const w = (h * (def.wide ?? 1)) / aspect
      mesh.scale.set(w, h, 1)
      const tint = def.tint
      mesh.material.color.copy(baseColor)
      if (tint) mesh.material.color.multiply(new THREE.Color(tint[0], tint[1], tint[2]))
      mesh.material.opacity = def.opacity * strength
    }
  }

  function setVisible(on) {
    visible = on
  }

  return {
    scene,
    camera,
    update,
    setVisible,
    get visible() {
      return visible
    }
  }
}
