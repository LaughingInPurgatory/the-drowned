/**
 * WebGPU-only renderer bootstrap.
 *
 * Import path is `three/webgpu` (nodes + WebGPURenderer). No WebGL fallback:
 * if the device cannot create a WebGPU device, init throws.
 */
import {
  WebGPURenderer,
  PMREMGenerator,
  NeutralToneMapping,
  PCFSoftShadowMap
} from 'three/webgpu'
import { SHOT_MODE } from '../devShots.js'

function refuseWebGLFallback(error) {
  const msg = error?.message || String(error || 'unknown error')
  throw new Error(`WebGPU is required and failed to initialize: ${msg}`)
}

/**
 * Shared WebGPURenderer construction. Always forceWebGL:false and no fallback.
 * @param {object} [parameters] extra WebGPURenderer parameters (canvas, alpha, …)
 */
function makeRenderer(parameters = {}) {
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error(
      'WebGPU is required (navigator.gpu is missing). Use a WebGPU-capable Electron/Chromium build.'
    )
  }

  const renderer = new WebGPURenderer({
    antialias: true,
    alpha: false,
    forceWebGL: false,
    getFallback: refuseWebGLFallback,
    ...parameters,
    // Keep these last so callers cannot re-enable WebGL.
    forceWebGL: false,
    getFallback: refuseWebGLFallback
  })

  // Belt-and-braces: three may still set an internal fallback in some builds.
  renderer._getFallback = refuseWebGLFallback

  return renderer
}

function assertWebGPUBackend(renderer) {
  if (renderer.backend?.isWebGPUBackend === false || renderer.backend?.isWebGLBackend === true) {
    throw new Error('WebGPU is required; renderer is not using the WebGPU backend.')
  }
}

/**
 * Create and initialize a WebGPU renderer. Must be awaited before any
 * render/PMREM/setSize that touches the backend.
 *
 * @param {HTMLElement} container
 * @param {{ preserveDrawingBuffer?: boolean, alpha?: boolean }} [opts]
 */
export async function createWebGPURenderer(container, opts = {}) {
  const renderer = makeRenderer({
    alpha: opts.alpha ?? false
  })

  await renderer.init()
  assertWebGPUBackend(renderer)

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.autoUpdate = true
  renderer.shadowMap.type = PCFSoftShadowMap

  const el = renderer.domElement
  el.style.display = 'block'
  el.style.width = '100%'
  el.style.height = '100%'
  if (SHOT_MODE || opts.preserveDrawingBuffer) {
    // No-op for WebGPU; capture uses render targets. Kept for call-site clarity.
  }
  container.appendChild(el)

  return renderer
}

/**
 * WebGPU renderer bound to an existing canvas (UI previews, maps).
 * Must be awaited before render/PMREM.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ alpha?: boolean, antialias?: boolean, shadows?: boolean, toneMapping?: number|null, exposure?: number }} [opts]
 */
export async function createWebGPURendererOnCanvas(canvas, opts = {}) {
  const renderer = makeRenderer({
    canvas,
    antialias: opts.antialias ?? true,
    alpha: opts.alpha ?? false
  })

  await renderer.init()
  assertWebGPUBackend(renderer)

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  if (opts.toneMapping != null) renderer.toneMapping = opts.toneMapping
  if (opts.exposure != null) renderer.toneMappingExposure = opts.exposure
  if (opts.shadows) {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = PCFSoftShadowMap
  }

  return renderer
}

/**
 * PMREM from a scene — requires an initialized WebGPU renderer.
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {import('three').Scene} envScene
 */
export function bakePmremFromScene(renderer, envScene) {
  const pmrem = new PMREMGenerator(renderer)
  const target = pmrem.fromScene(envScene)
  pmrem.dispose()
  return target.texture
}

export { SHOT_MODE }
