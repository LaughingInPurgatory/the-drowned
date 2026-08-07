import * as THREE from 'three'

/**
 * Fixed pool of PointLights added once at boot.
 *
 * Adding lights mid-session recompiles every MeshStandardMaterial (combat /
 * title hitch). A constant pool size keeps NUM_POINT_LIGHTS stable: emitters
 * only update colour / intensity / world position each frame.
 *
 * Intensity 0 slots still sit in the scene graph (stable shader defines) but
 * contribute nothing optically.
 */

/** Hard cap — enough for a lit quay + a few ships nearby without thrashing. */
const POOL_SIZE = 12

/**
 * @param {THREE.Scene} scene
 */
export function createAreaLightPool(scene) {
  /** @type {THREE.PointLight[]} */
  const pool = []
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 40, 2)
    light.castShadow = false
    // Always present so the light count never changes after first compile.
    light.visible = true
    light.name = `area-light-pool-${i}`
    scene.add(light)
    pool.push(light)
  }

  /** @type {{ x: number, y: number, z: number, color: number, intensity: number, distance: number, priority: number, score?: number }[]} */
  const emitters = []

  return {
    get size() {
      return POOL_SIZE
    },

    begin() {
      emitters.length = 0
    },

    /**
     * Queue a local glow for this frame.
     * @param {number} x world
     * @param {number} y world
     * @param {number} z world
     * @param {number} color hex
     * @param {number} intensity candela
     * @param {number} distance metres
     * @param {number} [priority] higher wins when over budget
     */
    offer(x, y, z, color, intensity, distance, priority = 1) {
      if (!(intensity > 0.5) || !(distance > 0.5)) return
      emitters.push({ x, y, z, color, intensity, distance, priority })
    },

    /**
     * Bind the strongest nearby emitters to pool slots.
     * @param {THREE.Camera} camera
     */
    flush(camera) {
      const cx = camera.position.x
      const cy = camera.position.y
      const cz = camera.position.z
      for (let i = 0; i < emitters.length; i++) {
        const e = emitters[i]
        const dx = e.x - cx
        const dy = e.y - cy
        const dz = e.z - cz
        // Prefer high-priority (harbour towers) then closer lamps.
        e.score = e.priority * 1e7 - (dx * dx + dy * dy + dz * dz)
      }
      emitters.sort((a, b) => b.score - a.score)

      for (let i = 0; i < pool.length; i++) {
        const light = pool[i]
        const e = emitters[i]
        if (!e) {
          light.intensity = 0
          continue
        }
        light.color.setHex(e.color)
        light.intensity = e.intensity
        light.distance = e.distance
        light.position.set(e.x, e.y, e.z)
      }
    }
  }
}
