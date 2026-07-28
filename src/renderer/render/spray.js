import * as THREE from 'three'

/**
 * Water on the lens.
 *
 * Drawn straight to the screen after the post chain (see scene.js
 * `setPostOverlay`) because it is an artifact of the camera, not something in
 * the world — the same reason a lens flare belongs there. Droplets land, sag
 * under their own weight, and dry off.
 *
 * They accumulate with speed: the faster the boat, the more comes over the
 * bow. Nothing else on screen tells you you are moving quite as directly.
 */

const MAX_DROPS = 48
/** Seconds a droplet lasts before it has run off or dried. */
const DROP_LIFETIME = [2.6, 6.5]
/** How fast a droplet creeps down the glass, in NDC per second. */
const DROP_SAG = [0.005, 0.035]
/** Speed (as a fraction of the hull's top) below which nothing comes aboard. */
const SPRAY_THRESHOLD = 0.35

const VERTEX = `
attribute float aSize;
attribute float aAlpha;
attribute float aSquash;
varying float vAlpha;
varying float vSquash;
void main() {
  vAlpha = aAlpha;
  vSquash = aSquash;
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = aSize;
}
`

const FRAGMENT = `
varying float vAlpha;
varying float vSquash;
void main() {
  // Droplets are elongated by the run-off, so stretch the point sprite.
  vec2 uv = gl_PointCoord - 0.5;
  uv.y /= max(0.35, vSquash);
  float r = length(uv);
  if (r > 0.5) discard;

  // A lens droplet is mostly a bright rim and a dark middle — it refracts what
  // is behind it rather than glowing. Additive would read as a firefly.
  float edge = smoothstep(0.5, 0.34, r);
  float rim = smoothstep(0.28, 0.5, r) * edge;
  float body = edge * 0.28;
  // Highlight where the light catches the top of the bead.
  float spec = pow(max(0.0, 1.0 - length(uv - vec2(-0.12, -0.16)) * 3.4), 3.0);

  float a = (rim * 0.55 + body + spec * 0.7) * vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vec3(0.78, 0.86, 0.9), a);
}
`

/**
 * Create the spray overlay.
 *
 * Returns `{ scene, camera, update(dt, speedFraction), splash(strength), clear() }`.
 * Register `draw` with `setPostOverlay` — see main.js.
 */
export function createSprayOverlay() {
  const positions = new Float32Array(MAX_DROPS * 3)
  const sizes = new Float32Array(MAX_DROPS)
  const alphas = new Float32Array(MAX_DROPS)
  const squash = new Float32Array(MAX_DROPS)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aSquash', new THREE.BufferAttribute(squash, 1))
  // Always drawn — it lives in clip space, so there is nothing to cull against.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false
  })

  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(points)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // Per-droplet state, parallel to the attribute arrays.
  const drops = []
  for (let i = 0; i < MAX_DROPS; i++) {
    drops.push({ life: 0, maxLife: 0, sag: 0, size: 0 })
  }
  let nextIndex = 0
  let carry = 0

  function spawn(strength = 1) {
    const d = drops[nextIndex]
    const i = nextIndex
    nextIndex = (nextIndex + 1) % MAX_DROPS
    d.maxLife = DROP_LIFETIME[0] + Math.random() * (DROP_LIFETIME[1] - DROP_LIFETIME[0])
    d.life = d.maxLife
    d.sag = DROP_SAG[0] + Math.random() * (DROP_SAG[1] - DROP_SAG[0])
    d.size = (6 + Math.random() * 22) * (0.6 + strength * 0.6)
    positions[i * 3] = (Math.random() - 0.5) * 1.95
    // Weighted toward the lower half, where spray off the bow actually lands.
    positions[i * 3 + 1] = -0.15 + (Math.random() - 0.5) * 1.5
    positions[i * 3 + 2] = 0
    squash[i] = 1
  }

  /** A hard hit of water — a wave over the bow, a near miss, a shell splash. */
  function splash(strength = 1) {
    const n = Math.round(4 + strength * 10)
    for (let i = 0; i < n; i++) spawn(strength)
  }

  function clear() {
    for (const d of drops) d.life = 0
  }

  /**
   * @param {number} dt seconds
   * @param {number} speedFraction 0–1 of the hull's top speed
   */
  function update(dt, speedFraction = 0) {
    // Accumulate spray with speed. Below the threshold the bow is not throwing
    // anything up, so nothing lands and what is there dries off.
    const over = Math.max(0, speedFraction - SPRAY_THRESHOLD) / (1 - SPRAY_THRESHOLD)
    if (over > 0) {
      carry += over * over * 9 * dt
      while (carry >= 1) {
        carry -= 1
        spawn(over)
      }
    } else {
      carry = 0
    }

    let live = false
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = drops[i]
      if (d.life <= 0) {
        alphas[i] = 0
        sizes[i] = 0
        continue
      }
      live = true
      d.life -= dt
      const k = Math.max(0, d.life / d.maxLife)
      // Fade in fast on landing, then a long slow dry-off.
      alphas[i] = Math.min(1, (1 - k) * 6) * Math.pow(k, 0.6)
      sizes[i] = d.size
      // Run-off accelerates as the bead gains mass from what it passes through.
      positions[i * 3 + 1] -= d.sag * dt * (1 + (1 - k) * 1.6)
      squash[i] = 1 + (1 - k) * 0.8
      if (positions[i * 3 + 1] < -1.1) d.life = 0
    }

    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true
    geometry.attributes.aSquash.needsUpdate = true
    points.visible = live
  }

  return {
    scene,
    camera,
    update,
    splash,
    clear,
    get visible() {
      return points.visible
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    }
  }
}
