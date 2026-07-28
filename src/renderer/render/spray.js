import * as THREE from 'three'

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
 *     They sag under their own weight, and at speed they are also dragged
 *     *outward* from the centre of the screen and stretched along that
 *     direction, which is what the airflow actually does to a bead on a
 *     windscreen. The faster you go the harder they run for the edges.
 *   - **streaks** — the sense-of-speed lines. Spawned near the centre, thin,
 *     dim, and stretched hard along their radial direction. These are what
 *     used to be the hyperspace motion FX; on the water they read as spray
 *     and rain tearing past.
 *
 * One system, one draw call, and a droplet at full speed is already halfway to
 * being a streak — so the two blend into each other instead of fighting.
 */

const MAX_DROPS = 96
/** Seconds a droplet lasts before it has run off or dried. */
const DROP_LIFETIME = [2.6, 6.5]
/** Seconds a speed streak lives. Short — it should tear past, not linger. */
const STREAK_LIFETIME = [0.16, 0.42]
/** How fast a droplet creeps down the glass, in NDC per second. */
const DROP_SAG = [0.005, 0.035]
/** Speed (as a fraction of the hull's top) below which nothing comes aboard. */
const SPRAY_THRESHOLD = 0.35
/**
 * Speed fraction at which streaks start.
 *
 * High on purpose. At cruising speed they read as scratches on the lens rather
 * than a sense of motion — this is an effect for when you are really moving,
 * and under autopilot, not for pottering about the harbour.
 */
const STREAK_THRESHOLD = 0.72
/** NDC/sec a droplet is dragged toward the edge, at full speed. */
const RADIAL_DRAG = 0.55
/** NDC/sec a streak travels outward, at full speed. */
const STREAK_SPEED = 2.4

const VERTEX = `
attribute float aSize;
attribute float aAlpha;
attribute float aStretch;
attribute vec2 aDir;
attribute float aKind;
varying float vAlpha;
varying float vStretch;
varying vec2 vDir;
varying float vKind;
void main() {
  vAlpha = aAlpha;
  vStretch = aStretch;
  vDir = aDir;
  vKind = aKind;
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = aSize;
}
`

const FRAGMENT = `
uniform float uAspect;
varying float vAlpha;
varying float vStretch;
varying vec2 vDir;
varying float vKind;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  // Rotate into the particle's own frame so "stretch" runs along the direction
  // it is travelling — outward from the bow — instead of always vertically.
  //
  // Two conversions are needed to get that angle right, and missing them is
  // why the streaks used to lean vertical while visibly travelling sideways:
  //
  //   - the direction is stored in NDC, where x and y have different pixel
  //     scales on any non-square viewport, so x has to be multiplied by the
  //     aspect ratio to become a screen-space direction
  //   - gl_PointCoord has y running *down* the sprite while NDC y runs up, so
  //     the y component flips
  vec2 d = normalize(vec2(vDir.x * uAspect, -vDir.y) + vec2(1e-5, 0.0));
  vec2 local = vec2(dot(uv, vec2(d.y, -d.x)), dot(uv, d));
  // Stretch by *narrowing across* the direction of travel, never by widening
  // along it. Dividing local.y by the stretch shrank the coordinate until
  // nothing exceeded the cutoff any more, so the discard never fired and every
  // droplet drew as a solid square the size of its whole point sprite.
  local.x *= max(1.0, vStretch);
  float r = length(local);
  if (r > 0.5) discard;

  if (vKind > 0.5) {
    // Speed streak: a soft line, brightest along its spine, tapering at both
    // ends so it has no hard cap.
    float spine = smoothstep(0.5, 0.0, abs(local.x) * 2.0);
    float along = smoothstep(0.5, 0.12, abs(local.y));
    float a = spine * along * vAlpha * 0.28;
    if (a <= 0.002) discard;
    gl_FragColor = vec4(vec3(0.82, 0.9, 0.94), a);
    return;
  }

  // A lens droplet is mostly a bright rim and a dark middle — it refracts what
  // is behind it rather than glowing. Additive would read as a firefly.
  float edge = smoothstep(0.5, 0.34, r);
  float rim = smoothstep(0.28, 0.5, r) * edge;
  float body = edge * 0.28;
  // Highlight where the light catches the lifting edge of the bead.
  float spec = pow(max(0.0, 1.0 - length(local - vec2(-0.12, 0.16)) * 3.4), 3.0);

  float a = (rim * 0.55 + body + spec * 0.7) * vAlpha;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(vec3(0.78, 0.86, 0.9), a);
}
`

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

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aStretch', new THREE.BufferAttribute(stretch, 1))
  geometry.setAttribute('aDir', new THREE.BufferAttribute(dirs, 2))
  geometry.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1))
  // Always drawn — it lives in clip space, so there is nothing to cull against.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)

  const material = new THREE.ShaderMaterial({
    uniforms: { uAspect: { value: 1 } },
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

  // Per-particle state, parallel to the attribute arrays.
  const drops = []
  for (let i = 0; i < MAX_DROPS; i++) {
    drops.push({ life: 0, maxLife: 0, sag: 0, size: 0, streak: false, vx: 0, vy: 0 })
  }
  let nextIndex = 0
  let carry = 0
  let streakCarry = 0

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
    d.size = (6 + Math.random() * 22) * (0.6 + strength * 0.6)
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
    d.size = (14 + Math.random() * 26) * (0.5 + strength * 0.9)
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
   * @param {number} boost extra sense-of-speed on top, 0–1. Autopilot passes 1:
   *   you are going faster than the hull's own top speed, so the streaks should
   *   not be capped by it.
   * @param {number[]} [emitFrom] the bow's position in NDC, so spray radiates
   *   from where it is actually being thrown up rather than from screen centre.
   */
  function update(dt, speedFraction = 0, boost = 0, emitFrom = null, aspect = null) {
    // Needed to turn an NDC travel direction into a screen angle — see the
    // fragment shader. Falls back to the canvas if the caller does not say.
    if (aspect) material.uniforms.uAspect.value = aspect
    if (emitFrom) {
      // Clamp: once the bow swings off-screen (hard turn, free-look) an
      // unbounded origin sends every droplet across the frame in one direction.
      origin[0] = Math.max(-0.8, Math.min(0.8, emitFrom[0]))
      origin[1] = Math.max(-0.9, Math.min(0.6, emitFrom[1]))
    }
    // Accumulate spray with speed. Below the threshold the bow is not throwing
    // anything up, so nothing lands and what is there dries off.
    const over = Math.max(0, speedFraction - SPRAY_THRESHOLD) / (1 - SPRAY_THRESHOLD)
    if (over > 0 || boost > 0) {
      const rate = Math.max(over, boost * 0.8)
      carry += rate * rate * 9 * dt
      while (carry >= 1) {
        carry -= 1
        spawn(rate)
      }
    } else {
      carry = 0
    }

    // Streaks come in earlier and much faster, and autopilot adds to them.
    const rush = Math.min(
      1,
      Math.max(0, speedFraction - STREAK_THRESHOLD) / (1 - STREAK_THRESHOLD) + boost
    )
    if (rush > 0.01) {
      streakCarry += rush * rush * rush * 34 * dt
      while (streakCarry >= 1) {
        streakCarry -= 1
        spawnStreak(rush)
      }
    } else {
      streakCarry = 0
    }

    // How hard the airflow is tearing at what is already on the glass.
    const drag = Math.min(1, speedFraction + boost)

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

      // Fade in fast on landing, then a long slow dry-off.
      alphas[i] = Math.min(1, (1 - k) * 6) * Math.pow(k, 0.6)
      sizes[i] = d.size
      // Gravity: run-off accelerates as the bead gains mass from what it
      // passes through.
      positions[i * 3 + 1] -= d.sag * dt * (1 + (1 - k) * 1.6)
      // Airflow: at speed it wins over gravity and drags the bead at the
      // nearest edge, stretching it as it goes.
      if (drag > 0.05) {
        const pull = RADIAL_DRAG * drag * drag * dt
        positions[i * 3] += d.vx * pull
        positions[i * 3 + 1] += d.vy * pull
        dirs[i * 2] = d.vx
        dirs[i * 2 + 1] = d.vy
        stretch[i] = 1 + (1 - k) * 0.8 + drag * 3.5
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

    geometry.attributes.position.needsUpdate = true
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
