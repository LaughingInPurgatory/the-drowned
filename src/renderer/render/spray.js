import * as THREE from 'three/webgpu'
import {
  uniform,
  vec2,
  vec3,
  vec4,
  Fn,
  attribute,
  mix,
  float,
  uv,
  abs,
  max,
  min,
  pow,
  clamp,
  length,
  smoothstep,
  positionGeometry
} from 'three/tsl'
import { valueNoise } from './vfxParticles.js'

/**
 * Water on the lens, and the sense of speed.
 *
 * Drawn straight to the screen after the post chain (see scene.js
 * `setPostOverlay`) because both are artifacts of the camera rather than
 * things in the world.
 *
 * Two kinds of particle share one system, because they are the same primitive
 * with different spawn profiles:
 *
 *   - **droplets** — water that has come over the bow and landed on the glass.
 *   - **streaks** — the sense-of-speed lines.
 *
 * WebGPU path uses PointsNodeMaterial + TSL attributes (no GLSL ShaderMaterial).
 */

const MAX_DROPS = 128
/** Seconds a droplet lasts before it has run off or dried. */
const DROP_LIFETIME = [2.2, 5.8]
/** Seconds a speed streak lives. Short — it should tear past, not linger. */
const STREAK_LIFETIME = [0.14, 0.4]
/** How fast a droplet creeps down the glass, in NDC per second. */
const DROP_SAG = [0.006, 0.04]
/** Speed (as a fraction of the hull's top) below which nothing comes aboard. */
const SPRAY_THRESHOLD = 0.34
/**
 * Speed fraction at which streaks start.
 *
 * High on purpose. At cruising speed they read as scratches on the lens rather
 * than a sense of motion — this is an effect for when you are really moving,
 * and under autopilot, not for pottering about the harbour.
 */
const STREAK_THRESHOLD = 0.78
/** NDC/sec a droplet is dragged toward the edge, at full speed. */
const RADIAL_DRAG = 0.72
/** NDC/sec a streak travels outward, at full speed. */
const STREAK_SPEED = 2.7
/**
 * Extra lateral "wind" shear on droplets once under way — shears beads off
 * the vertical so spray does not only sag straight down the glass.
 */
const WIND_SHEAR = 0.38

/**
 * Create the spray overlay.
 *
 * Returns `{ scene, camera, update(dt, speedFraction, boost), splash(strength), clear() }`.
 * Register `draw` with `setPostOverlay` — see main.js.
 */
export function createSprayOverlay() {
  const positions = new Float32Array(MAX_DROPS * 3)
  const sizes = new Float32Array(MAX_DROPS)
  const alphas = new Float32Array(MAX_DROPS)
  const stretch = new Float32Array(MAX_DROPS)
  const dirs = new Float32Array(MAX_DROPS * 2)
  const kinds = new Float32Array(MAX_DROPS)
  // Never leave a zero direction in the pool — see the normalize guard below.
  for (let i = 0; i < MAX_DROPS; i++) dirs[i * 2 + 1] = -1

  // Instanced quads, not `THREE.Points`.
  //
  // `THREE.Points` is `GPUPrimitiveTopology.PointList` on WebGPU and WebGPU
  // point primitives are always **one pixel** — `sizeNode`, `sizeAttenuation`
  // and every shaped falloff below were silently discarded, so the whole lens
  // overlay was drawing 128 single pixels. Nothing on the glass was visible.
  //
  // The overlay lives in NDC under an orthographic camera spanning [-1, 1], so
  // there is no billboarding to do: the quad corner is added to the particle's
  // NDC position directly, and aspect only has to correct the x axis.
  const quad = new THREE.PlaneGeometry(1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = quad.index
  geometry.setAttribute('position', quad.getAttribute('position'))
  geometry.setAttribute('uv', quad.getAttribute('uv'))
  geometry.instanceCount = MAX_DROPS
  quad.dispose()

  const iPos = new THREE.InstancedBufferAttribute(positions, 3)
  const iSize = new THREE.InstancedBufferAttribute(sizes, 1)
  const iAlpha = new THREE.InstancedBufferAttribute(alphas, 1)
  const iStretch = new THREE.InstancedBufferAttribute(stretch, 1)
  const iDir = new THREE.InstancedBufferAttribute(dirs, 2)
  const iKind = new THREE.InstancedBufferAttribute(kinds, 1)
  geometry.setAttribute('aPos', iPos)
  geometry.setAttribute('aSize', iSize)
  geometry.setAttribute('aAlpha', iAlpha)
  geometry.setAttribute('aStretch', iStretch)
  geometry.setAttribute('aDir', iDir)
  geometry.setAttribute('aKind', iKind)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)

  const uAspect = uniform(1)
  const uTime = uniform(0)
  const aPos = attribute('aPos', 'vec3')
  const aSize = attribute('aSize', 'float')
  const aAlpha = attribute('aAlpha', 'float')
  const aKind = attribute('aKind', 'float')
  const aStretch = attribute('aStretch', 'float')
  const aDir = attribute('aDir', 'vec2')

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false
  })

  // Screen sizes are in NDC; ~0.004 NDC per nominal size unit keeps the old
  // numbers meaningful.
  material.positionNode = Fn(() => {
    const corner = positionGeometry.xy
    const s = aSize.mul(0.004)
    // Streaks and wind-dragged beads elongate along their travel; the bead's
    // own direction is the long axis, so build a frame from it.
    // A dead bead carries a zero direction; normalize(0) is NaN and one NaN
    // vertex takes the whole instanced draw with it.
    const along = aDir.add(vec2(0, 1e-4)).normalize()
    const across = vec2(along.y.negate(), along.x)
    const stretchAmt = max(float(1), aStretch)
    const offset = along
      .mul(corner.y.mul(s).mul(stretchAmt))
      .add(across.mul(corner.x.mul(s)))
    return vec3(aPos.x.add(offset.x.div(uAspect)), aPos.y.add(offset.y), float(0))
  })()

  material.colorNode = Fn(() => {
    const q = uv().sub(0.5).mul(2)
    const r = length(q)
    // A bead of water on glass: bright meniscus rim, lensed centre.
    const body = smoothstep(float(1), float(0.1), r)
    const rim = smoothstep(float(1.0), float(0.72), r).mul(smoothstep(float(0.35), float(0.85), r))
    const drop = pow(body, float(1.6)).mul(0.55).add(rim.mul(0.9))
    // A streak is a soft capsule, not a disc.
    const streak = pow(smoothstep(float(1), float(0), abs(q.x)), float(1.5)).mul(
      smoothstep(float(1), float(0.2), abs(q.y))
    )
    const mask = mix(drop, streak, aKind)

    const dropCol = vec3(0.78, 0.86, 0.92)
    const streakCol = vec3(0.82, 0.9, 0.95)
    const col = mix(dropCol, streakCol, aKind)
    const a = mix(aAlpha.mul(0.5), aAlpha.mul(0.3), aKind).mul(mask)
    return vec4(col, clamp(a, float(0), float(1)))
  })()
  material.uniforms = { uAspect, uTime }

  const points = new THREE.Mesh(geometry, material)
  points.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(points)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // Per-particle state, parallel to the attribute arrays.
  const drops = []
  for (let i = 0; i < MAX_DROPS; i++) {
    drops.push({ life: 0, maxLife: 0, sag: 0, size: 0, streak: false, vx: 0, vy: 0 })
  }
  let nextIndex = 0
  let carry = 0
  let streakCarry = 0
  let rainCarry = 0

  // Where the water is coming *from*, in NDC. Under the chase camera the bow is
  // a little below screen centre, and everything thrown up by it flies out past
  // the lens from there — not from the middle of the frame. The frame loop
  // projects the stem each frame and hands it over; this is the fallback for
  // anything that does not.
  const origin = [0, -0.25]

  /** Unit vector from the emission point to (x, y), guarding coincidence. */
  function outward(x, y) {
    const dx = x - origin[0]
    const dy = y - origin[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-4) {
      const a = Math.random() * Math.PI * 2
      return [Math.cos(a), Math.sin(a)]
    }
    return [dx / len, dy / len]
  }

  function spawn(strength = 1) {
    const d = drops[nextIndex]
    const i = nextIndex
    nextIndex = (nextIndex + 1) % MAX_DROPS
    d.streak = false
    d.maxLife = DROP_LIFETIME[0] + Math.random() * (DROP_LIFETIME[1] - DROP_LIFETIME[0])
    d.life = d.maxLife
    d.sag = DROP_SAG[0] + Math.random() * (DROP_SAG[1] - DROP_SAG[0])
    d.size = (3.5 + Math.random() * 10) * (0.5 + strength * 0.45)
    // Landing spread over the glass, but biased toward the bow — that is where
    // it is being thrown from, so that is where most of it hits.
    const x = origin[0] * 0.5 + (Math.random() - 0.5) * 1.95
    const y = origin[1] * 0.5 + (Math.random() - 0.5) * 1.5
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = 0
    const [dx, dy] = outward(x, y)
    d.vx = dx
    d.vy = dy
    dirs[i * 2] = 0
    dirs[i * 2 + 1] = 1
    stretch[i] = 1
    kinds[i] = 0
  }

  /** A speed streak: born near the middle, gone before it crosses the frame. */
  function spawnStreak(strength) {
    const d = drops[nextIndex]
    const i = nextIndex
    nextIndex = (nextIndex + 1) % MAX_DROPS
    d.streak = true
    d.maxLife = STREAK_LIFETIME[0] + Math.random() * (STREAK_LIFETIME[1] - STREAK_LIFETIME[0])
    d.life = d.maxLife
    d.sag = 0
    d.size = (8 + Math.random() * 14) * (0.4 + strength * 0.55)
    // Born at the bow and thrown outward past the lens. Starting them close to
    // the stem and letting the radial motion carry them to the edges is what
    // makes it read as water coming *at* you off the bow rather than a pattern
    // drifting across the screen.
    const angle = Math.random() * Math.PI * 2
    const r = 0.04 + Math.random() * 0.34
    const x = origin[0] + Math.cos(angle) * r * 1.6
    const y = origin[1] + Math.sin(angle) * r
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = 0
    const [dx, dy] = outward(x, y)
    d.vx = dx * STREAK_SPEED * strength
    d.vy = dy * STREAK_SPEED * strength
    dirs[i * 2] = dx
    dirs[i * 2 + 1] = dy
    stretch[i] = 2.5 + strength * 5
    kinds[i] = 1
  }

  /**
   * Rain on the glass. Two things at once, because that is what rain looks
   * like: fast near-vertical streaks tearing down the lens, and the beads they
   * leave behind. Both are raked backwards by the boat's own speed.
   */
  function spawnRain(strength, drag) {
    const d = drops[nextIndex]
    const i = nextIndex
    nextIndex = (nextIndex + 1) % MAX_DROPS
    const streak = Math.random() < 0.62
    d.streak = streak
    d.maxLife = streak ? 0.12 + Math.random() * 0.18 : 0.7 + Math.random() * 1.6
    d.life = d.maxLife
    d.sag = streak ? 0 : 0.05 + Math.random() * 0.12
    d.size = streak
      ? (5 + Math.random() * 9) * (0.5 + strength * 0.6)
      : (2.5 + Math.random() * 5) * (0.5 + strength * 0.5)
    const x = (Math.random() - 0.5) * 2.4
    const y = (Math.random() - 0.5) * 2.2
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = 0
    const vx = drag * (0.45 + Math.random() * 0.5)
    const vy = -(1.6 + Math.random() * 1.9)
    d.vx = streak ? vx * 1.4 : vx * 0.2
    d.vy = streak ? vy : -d.sag
    const len = Math.hypot(d.vx, d.vy) || 1
    dirs[i * 2] = d.vx / len
    dirs[i * 2 + 1] = d.vy / len
    stretch[i] = streak ? 7 + Math.random() * 9 + strength * 6 : 1.2
    kinds[i] = streak ? 1 : 0
  }

  /** A hard hit of water — a wave over the bow, a near miss, a shell splash. */
  function splash(strength = 1) {
    const n = Math.round(6 + strength * 14)
    for (let i = 0; i < n; i++) spawn(strength)
  }

  /** Wipe every bead and streak immediately (docked, stopped, death, menus). */
  function clear() {
    for (let i = 0; i < MAX_DROPS; i++) {
      drops[i].life = 0
      alphas[i] = 0
      sizes[i] = 0
      stretch[i] = 1
      kinds[i] = 0
    }
    carry = 0
    streakCarry = 0
    rainCarry = 0
    geometry.attributes.aAlpha.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aStretch.needsUpdate = true
    geometry.attributes.aKind.needsUpdate = true
    points.visible = false
  }

  /**
   * @param {number} dt seconds
   * @param {number} speedFraction 0–1 of the hull's top speed
   * @param {number} boost extra sense-of-speed on top, 0–1. Autopilot passes 1:
   *   you are going faster than the hull's own top speed, so the streaks should
   *   not be capped by it.
   * @param {number[]} [emitFrom] the bow's position in NDC, so spray radiates
   *   from where it is actually being thrown up rather than from screen centre.
   * @param {number|null} [aspect]
   * @param {{ forceClear?: boolean }} [opts] forceClear wipes glass now (docked /
   *   dead / menus). Slowing also dries the glass quickly without a hard cut.
   */
  function update(dt, speedFraction = 0, boost = 0, emitFrom = null, aspect = null, opts = null) {
    if (opts?.forceClear) {
      clear()
      return
    }
    // Needed for screen-space direction math if a full TSL port returns later.
    if (aspect) material.uniforms.uAspect.value = aspect
    if (emitFrom) {
      // Clamp: once the bow swings off-screen (hard turn) an unbounded origin
      // sends every droplet across the frame in one direction.
      origin[0] = Math.max(-0.8, Math.min(0.8, emitFrom[0]))
      origin[1] = Math.max(-0.9, Math.min(0.6, emitFrom[1]))
    }
    // Accumulate spray with speed. Below the threshold the bow is not throwing
    // anything up, so nothing lands and what is there dries off.
    // Rate is denser once under way so cruise throws a real bow sheet on the lens.
    const over = Math.max(0, speedFraction - SPRAY_THRESHOLD) / (1 - SPRAY_THRESHOLD)
    const moving = over > 0 || boost > 0
    if (moving) {
      const rate = Math.max(over, boost * 0.85)
      // Sparse beads — cruise should not salt the sky with rice grains.
      carry += (0.35 * rate + 7 * rate * rate) * dt
      while (carry >= 1) {
        carry -= 1
        spawn(rate)
      }
    } else {
      carry = 0
    }

    // Streaks only at real rush / autopilot boost — not ordinary cruise dashes.
    const rush = Math.min(
      1,
      Math.max(0, speedFraction - STREAK_THRESHOLD) / (1 - STREAK_THRESHOLD) + boost
    )
    if (rush > 0.01) {
      streakCarry += rush * rush * rush * 18 * dt
      while (streakCarry >= 1) {
        streakCarry -= 1
        spawnStreak(rush)
      }
    } else {
      streakCarry = 0
    }

    // Rain. main.js does not pass this yet (see qa-shots/CROSSTALK.md); it
    // arrives on `opts.rain`, so no call site has to change when it does.
    const rain = Math.max(0, Math.min(1, Number(opts?.rain) || 0))
    // How hard the airflow is tearing at what is already on the glass.
    const drag = Math.min(1, speedFraction + boost)
    if (rain > 0.01) {
      rainCarry += rain * rain * 95 * dt
      while (rainCarry >= 1) {
        rainCarry -= 1
        spawnRain(rain, drag)
      }
    } else {
      rainCarry = 0
    }
    // At a crawl or stopped: streaks vanish; beads dry off fast (not linger for seconds).
    const nearlyStopped = !moving && rain < 0.01 && speedFraction < SPRAY_THRESHOLD * 0.85
    const dryMul = nearlyStopped ? 5.5 : 1

    let live = false
    for (let i = 0; i < MAX_DROPS; i++) {
      const d = drops[i]
      if (d.life <= 0) {
        alphas[i] = 0
        sizes[i] = 0
        continue
      }
      // Speed lines have no business sitting on the glass when you are still.
      if (nearlyStopped && d.streak) {
        d.life = 0
        alphas[i] = 0
        sizes[i] = 0
        continue
      }
      live = true
      d.life -= dt * dryMul
      if (d.life <= 0) {
        alphas[i] = 0
        sizes[i] = 0
        continue
      }
      const k = Math.max(0, d.life / d.maxLife)

      if (d.streak) {
        // Accelerating outward: the apparent motion of anything you pass grows
        // the further off-axis it gets.
        const accel = 1 + (1 - k) * 2.2
        positions[i * 3] += d.vx * accel * dt
        positions[i * 3 + 1] += d.vy * accel * dt
        // Fade in over the first fifth, then out — no popping at either end.
        alphas[i] = Math.min(1, (1 - k) * 5) * Math.pow(k, 0.35)
        sizes[i] = d.size
        const px = positions[i * 3]
        const py = positions[i * 3 + 1]
        // Keep the streak pointing along its own travel as it goes, so a long
        // one curves out of the frame rather than staying on its birth bearing.
        const [ndx, ndy] = outward(px, py)
        dirs[i * 2] = ndx
        dirs[i * 2 + 1] = ndy
        if (Math.abs(px) > 1.35 || Math.abs(py) > 1.35) d.life = 0
        continue
      }

      // Fade in fast on landing, then a long slow dry-off (or quick when stopped).
      alphas[i] = Math.min(1, (1 - k) * 6) * Math.pow(k, 0.6)
      sizes[i] = d.size
      // Gravity: run-off accelerates as the bead gains mass from what it
      // passes through. When stopped, sag harder so beads leave the frame.
      const sagMul = nearlyStopped ? 3.2 : 1
      positions[i * 3 + 1] -= d.sag * sagMul * dt * (1 + (1 - k) * 1.6)
      // Airflow: at speed it wins over gravity and drags the bead at the
      // nearest edge, stretching it as it goes. Extra lateral wind shear keeps
      // beads from only reading as vertical rain on the glass.
      if (drag > 0.05) {
        const pull = RADIAL_DRAG * drag * drag * dt
        const wind = WIND_SHEAR * drag * drag * dt
        // Prefer the particle's own radial outward, plus a small constant
        // screen-right bias that scales with speed (apparent relative wind).
        positions[i * 3] += d.vx * pull + wind * (0.55 + Math.abs(d.vx) * 0.45)
        positions[i * 3 + 1] += d.vy * pull
        dirs[i * 2] = d.vx + wind * 0.35
        dirs[i * 2 + 1] = d.vy - 0.15 * (1 - drag)
        stretch[i] = 1 + (1 - k) * 0.9 + drag * 4.2
      } else {
        // Slow enough that it just sags — stretch straight down the glass.
        dirs[i * 2] = 0
        dirs[i * 2 + 1] = -1
        stretch[i] = 1 + (1 - k) * 0.8
      }
      const px = positions[i * 3]
      const py = positions[i * 3 + 1]
      if (py < -1.15 || Math.abs(px) > 1.3 || py > 1.2) d.life = 0
    }

    geometry.attributes.aPos.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true
    geometry.attributes.aStretch.needsUpdate = true
    geometry.attributes.aDir.needsUpdate = true
    geometry.attributes.aKind.needsUpdate = true
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
