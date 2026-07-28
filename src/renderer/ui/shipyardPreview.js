/**
 * Interactive 3D ship preview for the shipyard (sits under Ship stats).
 * Click-drag to orbit; scroll to zoom.
 */
import * as THREE from 'three'
import { buildShipMesh } from '../render/shipMesh.js'
import { createSkyEnvironment } from '../render/scene.js'
import { getShipClass } from '../data/shipClasses.js'

const STYLE = `
#shipyard-preview {
  position: relative;
  width: 100%;
  height: 200px;
  display: none;
  flex-direction: column;
  pointer-events: auto;
  box-sizing: border-box;
  background: linear-gradient(160deg, rgba(10,16,28,0.94), rgba(6,10,18,0.92));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55), inset 0 0 16px rgba(0,0,0,0.4);
  overflow: hidden;
  user-select: none;
  touch-action: none;
}
#shipyard-preview.visible { display: flex; }
#shipyard-preview .sp-label {
  flex-shrink: 0;
  padding: 6px 10px 4px;
  font-family: monospace;
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--ui-accent);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#shipyard-preview .sp-canvas-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  cursor: grab;
}
#shipyard-preview .sp-canvas-wrap.dragging { cursor: grabbing; }
#shipyard-preview canvas {
  display: block;
  width: 100%;
  height: 100%;
}
#shipyard-preview .sp-hint {
  position: absolute;
  left: 8px;
  bottom: 6px;
  font-family: monospace;
  font-size: 9px;
  letter-spacing: 0.5px;
  color: var(--ui-dim);
  opacity: 0.65;
  pointer-events: none;
}
`

function disposeObject3D(root) {
  if (!root) return
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    const mat = obj.material
    if (!mat) return
    const list = Array.isArray(mat) ? mat : [mat]
    for (const m of list) {
      // Do not dispose shared textures (stationMaterialMaps cache).
      m.dispose?.()
    }
  })
}

export function createShipyardPreview(container) {
  if (!document.getElementById('shipyard-preview-style')) {
    const style = document.createElement('style')
    style.id = 'shipyard-preview-style'
    style.textContent = STYLE
    document.head.appendChild(style)
  }

  const root = document.createElement('div')
  root.id = 'shipyard-preview'
  root.innerHTML = `
    <div class="sp-label">Hull preview</div>
    <div class="sp-canvas-wrap">
      <canvas></canvas>
      <div class="sp-hint">Drag to rotate</div>
    </div>
  `
  container.appendChild(root)

  const labelEl = root.querySelector('.sp-label')
  const wrap = root.querySelector('.sp-canvas-wrap')
  const canvas = root.querySelector('canvas')

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power'
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2

  const scene = new THREE.Scene()
  // Same IBL as the world, or hulls read flat here and shiny in flight.
  scene.environment = createSkyEnvironment(renderer)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.2, 500)
  camera.position.set(0, 0, 40)

  const amb = new THREE.AmbientLight(0x7080a0, 0.85)
  scene.add(amb)
  const key = new THREE.DirectionalLight(0xffffff, 1.35)
  key.position.set(40, 55, 70)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x6fd8f2, 0.35)
  fill.position.set(-50, 20, -40)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffe08a, 0.25)
  rim.position.set(10, -30, -50)
  scene.add(rim)

  const pivot = new THREE.Object3D()
  scene.add(pivot)

  let mesh = null
  let currentClassId = null
  let visible = false
  let raf = 0
  let yaw = 0.55
  let pitch = 0.28
  let distance = 28

  // Drag state
  let dragging = false
  let lastX = 0
  let lastY = 0

  function resize() {
    const w = Math.max(1, wrap.clientWidth)
    const h = Math.max(1, wrap.clientHeight)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }

  function applyOrbit() {
    const cp = Math.cos(pitch)
    camera.position.set(
      Math.sin(yaw) * cp * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * cp * distance
    )
    camera.lookAt(0, 0, 0)
  }

  function fitMesh(object3d) {
    const box = new THREE.Box3().setFromObject(object3d)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    // Center the model in pivot space.
    object3d.position.sub(center)
    const maxDim = Math.max(size.x, size.y, size.z, 1)
    const fov = (camera.fov * Math.PI) / 180
    distance = (maxDim * 0.55) / Math.tan(fov / 2)
    distance = Math.max(8, Math.min(120, distance * 1.35))
    applyOrbit()
  }

  function clearMesh() {
    if (!mesh) return
    pivot.remove(mesh)
    disposeObject3D(mesh)
    mesh = null
    currentClassId = null
  }

  function setClass(classId) {
    if (!classId) {
      clearMesh()
      labelEl.textContent = 'Hull preview'
      return
    }
    if (classId === currentClassId && mesh) return
    let shipClass
    try {
      shipClass = getShipClass(classId)
    } catch {
      clearMesh()
      labelEl.textContent = 'Hull preview'
      return
    }
    clearMesh()
    currentClassId = classId
    labelEl.textContent = shipClass.name || classId
    try {
      mesh = buildShipMesh(shipClass, { lite: false })
    } catch (err) {
      console.warn('Shipyard preview mesh failed', err)
      mesh = null
      return
    }
    pivot.add(mesh)
    // Reset orbit gently on class change.
    yaw = 0.55
    pitch = 0.28
    fitMesh(mesh)
  }

  function frame() {
    raf = 0
    if (!visible) return
    applyOrbit()
    // Slow idle spin when not dragging.
    if (!dragging && mesh) {
      yaw += 0.004
    }
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }

  function startLoop() {
    if (raf) return
    raf = requestAnimationFrame(frame)
  }

  function stopLoop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  function onPointerDown(e) {
    if (e.button != null && e.button !== 0) return
    dragging = true
    wrap.classList.add('dragging')
    lastX = e.clientX
    lastY = e.clientY
    wrap.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e) {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    yaw -= dx * 0.01
    pitch += dy * 0.008
    pitch = Math.max(-1.2, Math.min(1.2, pitch))
    e.preventDefault()
  }

  function onPointerUp(e) {
    if (!dragging) return
    dragging = false
    wrap.classList.remove('dragging')
    try {
      wrap.releasePointerCapture?.(e.pointerId)
    } catch {
      /* */
    }
  }

  wrap.addEventListener('pointerdown', onPointerDown)
  wrap.addEventListener('pointermove', onPointerMove)
  wrap.addEventListener('pointerup', onPointerUp)
  wrap.addEventListener('pointercancel', onPointerUp)
  wrap.addEventListener('pointerleave', onPointerUp)

  // Prevent page scroll while dragging on trackpads.
  wrap.addEventListener(
    'wheel',
    (e) => {
      if (!visible) return
      distance *= e.deltaY > 0 ? 1.08 : 0.92
      distance = Math.max(6, Math.min(160, distance))
      e.preventDefault()
    },
    { passive: false }
  )

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null
  ro?.observe(wrap)

  return {
    /**
     * Show preview for a ship class id (null hides).
     * @param {string|null} classId
     */
    show(classId) {
      if (!classId) {
        this.hide()
        return
      }
      root.classList.add('visible')
      visible = true
      resize()
      setClass(classId)
      startLoop()
    },
    hide() {
      visible = false
      root.classList.remove('visible')
      stopLoop()
      dragging = false
      wrap.classList.remove('dragging')
      // Keep mesh cached for re-open same class; dispose when leaving dock entirely.
    },
    /** Tear down WebGL resources (call on undock / dock UI hide). */
    dispose() {
      this.hide()
      clearMesh()
      ro?.disconnect()
      wrap.removeEventListener('pointerdown', onPointerDown)
      wrap.removeEventListener('pointermove', onPointerMove)
      wrap.removeEventListener('pointerup', onPointerUp)
      wrap.removeEventListener('pointercancel', onPointerUp)
      wrap.removeEventListener('pointerleave', onPointerUp)
      renderer.dispose()
      root.remove()
    },
    element: root
  }
}
