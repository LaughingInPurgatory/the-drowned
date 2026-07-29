import * as THREE from 'three'

/**
 * Occasional rain and rarer full storms.
 *
 * Rain is a camera-space streak field (same idea as spray: drawn after the post
 * chain so it sits on the formed image). Storms thicken the deck (via
 * `cloudCover` / light multipliers returned each frame), flash the frame white
 * on a strike, and schedule thunder for the audio layer.
 *
 * Weather phases are driven off campaign time so a save reloads into the same
 * sort of weather window rather than a fresh roll every boot.
 */

/** Many fine streaks rather than a few huge dashes. */
const MAX_DROPS = 900

/** Seconds of clear / thunderstorm windows (campaign time). No plain rain. */
const CLEAR_RANGE = [140, 420]
const STORM_RANGE = [55, 140]

const VERTEX = `
attribute float aSize;
attribute float aAlpha;
attribute float aStretch;
varying float vAlpha;
varying float vStretch;
void main() {
  vAlpha = aAlpha;
  vStretch = aStretch;
  gl_Position = vec4(position.xy, 0.0, 1.0);
  gl_PointSize = aSize;
}
`

const FRAGMENT = `
uniform float uAspect;
varying float vAlpha;
varying float vStretch;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  // Thin streaks: narrow X, modest Y stretch — not giant rods.
  uv.x *= uAspect * (0.72 + vStretch * 0.08);
  uv.y *= 1.0 / max(vStretch, 0.65);
  float d = length(uv);
  float core = smoothstep(0.48, 0.06, d);
  float tip = smoothstep(0.52, 0.0, abs(uv.y + 0.1));
  float a = core * tip * vAlpha;
  if (a < 0.015) discard;
  gl_FragColor = vec4(0.86, 0.9, 0.96, a * 0.72);
}
`

function hash01(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function pickRange(seed, [lo, hi]) {
  return lo + hash01(seed) * (hi - lo)
}

/**
 * Which weather mode a campaign-time window starts with.
 * Fair weather most of the time; occasional full thunderstorms (rain + lightning).
 * Plain rain without thunder is not a mode.
 */
function modeForSlot(slot) {
  const r = hash01(slot * 19.17 + 3.1)
  // ~14% storm windows — rare enough to feel special.
  return r < 0.86 ? 'clear' : 'storm'
}

function durationFor(mode, slot) {
  if (mode === 'storm') return pickRange(slot * 11.1 + 2, STORM_RANGE)
  return pickRange(slot * 5.9 + 4, CLEAR_RANGE)
}

// Cursor for weather windows — advanced frame-to-frame so long campaigns
// never re-walk from slot 0.
let _wxSlot = 0
let _wxStart = 0
let _wxMode = modeForSlot(0)
let _wxDur = durationFor(_wxMode, 0)

/** Clouds start going grey this long before rain/storm actually begins. */
const PRELUDE_S = 55
/** Residual gloom after wet weather ends. */
const AFTERMATH_S = 65
/** Soft edges on the wet window itself (visual + precipitation). */
const WET_EDGE_S = 22
/** Longer edge for cloud gloom so the deck does not snap. */
const GLOOM_EDGE_S = 36

function smoothstep01(x) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/**
 * Resolve weather mode + blend at campaign time `t`.
 *
 * Precipitation snaps to the wet window (with short edges). Cloud gloom and
 * light dimming lead the weather by PRELUDE_S and lag after by AFTERMATH_S so
 * the deck darkens before the first drop and recovers slowly after.
 */
export function weatherAt(t) {
  const time = Math.max(0, t)
  // Rewind if time jumped backward (new game / load).
  if (time + 0.001 < _wxStart) {
    _wxSlot = 0
    _wxStart = 0
    _wxMode = modeForSlot(0)
    _wxDur = durationFor(_wxMode, 0)
  }
  let guard = 0
  while (_wxStart + _wxDur <= time && guard++ < 10000) {
    _wxStart += _wxDur
    _wxSlot += 1
    _wxMode = modeForSlot(_wxSlot)
    _wxDur = durationFor(_wxMode, _wxSlot)
  }
  const mode = _wxMode
  const dur = _wxDur
  const local = time - _wxStart
  const remain = dur - local
  const nextMode = modeForSlot(_wxSlot + 1)
  const prevMode = _wxSlot > 0 ? modeForSlot(_wxSlot - 1) : 'clear'

  // Precipitation strength — thunderstorms only, short blend at window edges.
  let wetStr = 0
  if (mode === 'storm') {
    wetStr = 1
    if (local < WET_EDGE_S) wetStr = smoothstep01(local / WET_EDGE_S)
    else if (remain < WET_EDGE_S) wetStr = smoothstep01(remain / WET_EDGE_S)
  }
  // Storms always bring rain; there is no plain-rain mode.
  const rain = mode === 'storm' ? 0.75 + 0.25 * wetStr : 0
  const storm = mode === 'storm' ? wetStr : 0

  // Visual gloom for the cloud deck / lighting.
  // While storming: stay fully dark (prelude already brought us up — do not
  // re-zero at the first drop). Fade only as the front leaves.
  let rainGloom = 0
  let stormGloom = 0
  if (mode === 'storm') {
    rainGloom = 0.95
    stormGloom = 1
    if (remain < GLOOM_EDGE_S) {
      const e = smoothstep01(remain / GLOOM_EDGE_S)
      rainGloom *= e
      stormGloom *= e
    }
  }

  // Before a storm: sky loads up while it is still "clear".
  if (mode === 'clear' && remain < PRELUDE_S && nextMode === 'storm') {
    const p = smoothstep01(1 - remain / PRELUDE_S)
    rainGloom = Math.max(rainGloom, p * 0.6)
    stormGloom = Math.max(stormGloom, p * 0.95)
  }

  // After a storm: deck bleeds back to fair-weather colour slowly.
  if (mode === 'clear' && local < AFTERMATH_S && prevMode === 'storm') {
    const a = smoothstep01(1 - local / AFTERMATH_S)
    rainGloom = Math.max(rainGloom, a * 0.55)
    stormGloom = Math.max(stormGloom, a * 0.82)
  }

  // Cover / light from gloom so everything eases with the deck.
  const cloudCover = 0.52 - 0.2 * rainGloom - 0.24 * stormGloom
  const sunMul = 1 - 0.32 * rainGloom - 0.42 * stormGloom
  const fogMul = 1 + 0.32 * rainGloom + 0.55 * stormGloom
  const hemiMul = 1 - 0.1 * rainGloom - 0.22 * stormGloom

  return {
    mode,
    rain: Math.min(1, rain),
    storm,
    rainGloom: Math.min(1, rainGloom),
    stormGloom: Math.min(1, stormGloom),
    cloudCover,
    sunMul,
    fogMul,
    hemiMul,
    slot: _wxSlot,
    localT: local
  }
}

/**
 * Live weather FX: rain drops + lightning flash overlay.
 * Call `update(dt, simTime)` every frame; draw via scene/camera after post.
 */
export function createWeather() {
  // --- Rain points ---
  const positions = new Float32Array(MAX_DROPS * 3)
  const sizes = new Float32Array(MAX_DROPS)
  const alphas = new Float32Array(MAX_DROPS)
  const stretch = new Float32Array(MAX_DROPS)
  const drops = Array.from({ length: MAX_DROPS }, () => ({
    life: 0,
    maxLife: 1,
    vy: -1.2,
    vx: 0
  }))
  let nextIndex = 0
  let spawnCarry = 0

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))
  geometry.setAttribute('aStretch', new THREE.BufferAttribute(stretch, 1))

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uAspect: { value: 1.6 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT
  })
  const points = new THREE.Points(geometry, material)
  points.frustumCulled = false

  // --- Lightning flash (full-screen white quad) ---
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xddeeff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  const flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), flashMat)
  flashMesh.position.z = -0.5
  flashMesh.frustumCulled = false

  const overlayScene = new THREE.Scene()
  overlayScene.add(points)
  overlayScene.add(flashMesh)
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10)

  let flash = 0
  /** @type {null | { delay: number, volume: number }} */
  let pendingThunder = null
  let nextStrikeAt = 0
  // Smoothed gloom so cover never hard-steps even if a window boundary is sharp.
  let smoothRainGloom = 0
  let smoothStormGloom = 0
  let lastWx = weatherAt(0)

  function spawnDrop(intensity) {
    const d = drops[nextIndex]
    const i = nextIndex
    nextIndex = (nextIndex + 1) % MAX_DROPS
    d.maxLife = 0.4 + Math.random() * 0.65
    d.life = d.maxLife
    // Wind shear slightly to the side in storms.
    d.vx = (Math.random() - 0.5) * 0.22 * intensity
    d.vy = -(1.35 + Math.random() * 1.7) * (0.8 + intensity * 0.6)
    positions[i * 3] = (Math.random() * 2 - 1) * 1.08
    positions[i * 3 + 1] = 1.05 + Math.random() * 0.25
    positions[i * 3 + 2] = 0
    // Small, dense drops (was 16–50px rods that read as fat rain).
    sizes[i] = 3.5 + Math.random() * 5.5 * (0.55 + intensity * 0.45)
    stretch[i] = 1.35 + Math.random() * 1.6 * (0.6 + intensity * 0.4)
    alphas[i] = 0
  }

  function fireLightning(intensity) {
    // Hard white hit, then a secondary flicker.
    flash = Math.max(flash, 0.85 + Math.random() * 0.35 * intensity)
    // Distant strike: longer delay, quieter. Close: near-instant, heavy.
    const dist = 0.15 + Math.random() * 0.85
    pendingThunder = {
      delay: 0.12 + dist * 2.4,
      volume: (0.55 + (1 - dist) * 0.55) * (0.75 + intensity * 0.35)
    }
  }

  /**
   * @param {number} dt
   * @param {number} simTime
   * @param {number} [aspect]
   * @returns {{
   *   mode: string,
   *   rain: number,
   *   storm: number,
   *   rainGloom: number,
   *   stormGloom: number,
   *   cloudCover: number,
   *   sunMul: number,
   *   fogMul: number,
   *   hemiMul: number,
   *   flash: number,
   *   thunder: null | { delay: number, volume: number }
   * }}
   */
  function update(dt, simTime, aspect = null) {
    if (aspect) material.uniforms.uAspect.value = aspect
    const wx = weatherAt(simTime)

    // Lag gloom slightly so the deck never pops even at a slot boundary.
    const lag = 1 - Math.exp(-Math.max(0, dt) * 0.85)
    smoothRainGloom += (wx.rainGloom - smoothRainGloom) * lag
    smoothStormGloom += (wx.stormGloom - smoothStormGloom) * lag

    // Re-derive cover/light from smoothed gloom so lighting tracks the deck.
    const rainGloom = smoothRainGloom
    const stormGloom = smoothStormGloom
    const cloudCover = 0.52 - 0.2 * rainGloom - 0.24 * stormGloom
    const sunMul = 1 - 0.32 * rainGloom - 0.42 * stormGloom
    const fogMul = 1 + 0.32 * rainGloom + 0.55 * stormGloom
    const hemiMul = 1 - 0.1 * rainGloom - 0.22 * stormGloom

    lastWx = {
      ...wx,
      rainGloom,
      stormGloom,
      cloudCover,
      sunMul,
      fogMul,
      hemiMul
    }

    // Rain spawn rate — denser field of small drops in storms.
    if (wx.rain > 0.02) {
      const rate = wx.rain * wx.rain * (wx.storm > 0.2 ? 520 : 280)
      spawnCarry += rate * dt
      while (spawnCarry >= 1) {
        spawnCarry -= 1
        spawnDrop(wx.rain)
      }
    } else {
      spawnCarry = 0
    }

    // Lightning schedule during storms.
    if (wx.storm > 0.35) {
      if (nextStrikeAt <= 0) {
        // First strike soon after entering the storm.
        nextStrikeAt = simTime + 2 + Math.random() * 6
      }
      if (simTime >= nextStrikeAt) {
        fireLightning(wx.storm)
        // Claps cluster: sometimes a second within a second, else a longer gap.
        if (Math.random() < 0.28) nextStrikeAt = simTime + 0.35 + Math.random() * 0.9
        else nextStrikeAt = simTime + 3.5 + Math.random() * 11
      }
    } else {
      nextStrikeAt = 0
    }

    // Flash decay + occasional double-flicker.
    if (flash > 0.55 && Math.random() < 0.08) flash = Math.min(1.15, flash + 0.25)
    flash = Math.max(0, flash - dt * 2.8)
    flashMat.opacity = flash * 0.72
    flashMesh.visible = flash > 0.02

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
      positions[i * 3] += d.vx * dt
      positions[i * 3 + 1] += d.vy * dt
      const u = Math.max(0, d.life / d.maxLife)
      alphas[i] = Math.pow(u, 0.85) * (0.55 + wx.rain * 0.55)
      if (d.life <= 0 || positions[i * 3 + 1] < -1.15) {
        d.life = 0
        alphas[i] = 0
        sizes[i] = 0
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aStretch.needsUpdate = true
    points.visible = live

    const thunder = pendingThunder
    pendingThunder = null

    return {
      mode: wx.mode,
      rain: wx.rain,
      storm: wx.storm,
      rainGloom,
      stormGloom,
      cloudCover,
      sunMul,
      fogMul,
      hemiMul,
      flash,
      thunder
    }
  }

  function clear() {
    for (let i = 0; i < MAX_DROPS; i++) {
      drops[i].life = 0
      alphas[i] = 0
      sizes[i] = 0
    }
    flash = 0
    flashMat.opacity = 0
    flashMesh.visible = false
    points.visible = false
    spawnCarry = 0
    pendingThunder = null
  }

  return {
    update,
    clear,
    weatherAt,
    get scene() {
      return overlayScene
    },
    get camera() {
      return overlayCamera
    },
    get visible() {
      return points.visible || flashMesh.visible
    },
    /** Last weather sample (for lighting without re-running particles). */
    get state() {
      return lastWx
    }
  }
}
