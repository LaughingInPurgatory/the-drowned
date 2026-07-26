import * as THREE from 'three'

// Thin shell only — if stars fill a thick volume around the camera, ones
// between the camera and a planet draw *in front* of the planet (see-through
// starfield). Keep them at ~radius so depthTest can hide them behind solids.
function scatterPositions(count, radius) {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const r = radius * (0.94 + Math.random() * 0.06)
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
  }
  return positions
}

// A rough stellar-temperature palette (cool blue/white through warm
// yellow/orange) instead of uniform white, so the field reads as varied
// pinpricks of real stars rather than a flat wall of identical dots.
const STAR_TINTS = [0xffffff, 0xd8e6ff, 0xbcd8ff, 0xfff4e0, 0xffe0b0]

// Without a map, PointsMaterial renders each star as a hard square pixel
// block — a soft radial-gradient sprite (the same canvas technique
// nebula.js/thrusterParticles.js use) makes every star a round point of
// light instead. One shared texture for every layer.
let starSprite = null
function getStarSprite() {
  if (starSprite) return starSprite
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,255,255,0.8)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  starSprite = new THREE.CanvasTexture(canvas)
  return starSprite
}

function buildLayer(count, radius, size, brightnessMin = 0.5) {
  const colors = new Float32Array(count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < count; i++) {
    c.set(STAR_TINTS[(Math.random() * STAR_TINTS.length) | 0])
    const brightness = brightnessMin + Math.random() * (1 - brightnessMin)
    colors[i * 3] = c.r * brightness
    colors[i * 3 + 1] = c.g * brightness
    colors[i * 3 + 2] = c.b * brightness
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(scatterPositions(count, radius), 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const material = new THREE.PointsMaterial({
    size,
    sizeAttenuation: false,
    vertexColors: true,
    map: getStarSprite(),
    transparent: true,
    // depthTest so planets/stations occlude stars; no depthWrite so stars
    // don't punch holes in each other. Transparent + additive still draws
    // after opaques, but fails the depth test where a solid is nearer.
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })
  return new THREE.Points(geometry, material)
}

// Three size tiers — many small dim pinpricks, a sparser mid layer, and a
// handful of big soft "hero" glow stars — reads as a naturally varied field
// with depth instead of one uniform point cloud. ~2% of the field twinkles:
// those stars live in four small extra layers, each layer's whole-material
// opacity oscillating on its own phase/speed (see updateStarfield) — cheap
// per-layer uniform animation instead of a per-star shader, and with the
// stars scattered randomly across four out-of-phase groups it still reads
// as individual stars twinkling rather than a synchronized blink.
// Shell must sit beyond system play volume (bodies often 100k–600k out; suns
// tens of k across) but inside the camera far plane (2e6 in scene.js). When
// the field is re-centered on the camera, a short radius put stars *in front*
// of the sun/planets so depthTest never hid them (starfield "through" the sun).
export function createStarfield(count = 9000, radius = 1_600_000) {
  const group = new THREE.Group()
  // Draw before in-system meshes; depth buffer from suns/planets then occludes.
  group.renderOrder = -100
  group.add(buildLayer(Math.round(count * 0.85), radius, 2.2, 0.35))
  group.add(buildLayer(Math.round(count * 0.15), radius, 4.5, 0.6))
  group.add(buildLayer(60, radius, 11, 0.8))

  const twinkleLayers = []
  const perLayer = Math.round((count * 0.02) / 4)
  for (let i = 0; i < 4; i++) {
    const layer = buildLayer(perLayer, radius, 3.5, 0.85)
    group.add(layer)
    twinkleLayers.push({ layer, phase: (i / 4) * Math.PI * 2, speed: 1.5 + i * 0.7 })
  }
  group.userData.twinkleLayers = twinkleLayers
  group.userData.shellRadius = radius
  // Built lazily on first supercruise frame (samples star positions once).
  group.userData.cruiseBlur = null
  group.traverse((o) => {
    if (o.isPoints) o.renderOrder = -100
  })
  return group
}

/**
 * Build / return radial streak lines for supercruise motion blur.
 * Starfield group is always re-centered on the camera, so local origin = player.
 * Streaks run from the shell toward the origin (toward the player).
 */
function ensureCruiseBlur(starfield) {
  if (starfield.userData.cruiseBlur) return starfield.userData.cruiseBlur

  const MAX_STREAKS = 3200
  const samples = []
  starfield.traverse((obj) => {
    if (!obj.isPoints) return
    const pos = obj.geometry?.getAttribute('position')
    const col = obj.geometry?.getAttribute('color')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      samples.push({
        x: pos.getX(i),
        y: pos.getY(i),
        z: pos.getZ(i),
        r: col ? col.getX(i) : 1,
        g: col ? col.getY(i) : 1,
        b: col ? col.getZ(i) : 1
      })
    }
  })

  // Even subsample if denser than budget.
  const step = Math.max(1, Math.ceil(samples.length / MAX_STREAKS))
  const picked = []
  for (let i = 0; i < samples.length; i += step) picked.push(samples[i])
  const n = picked.length

  const dirs = new Float32Array(n * 3) // unit direction * radius (base position)
  const radii = new Float32Array(n)
  const baseCol = new Float32Array(n * 3)
  const linePos = new Float32Array(n * 2 * 3)
  const lineCol = new Float32Array(n * 2 * 3)
  const phase = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const s = picked[i]
    const len = Math.hypot(s.x, s.y, s.z) || 1
    radii[i] = len
    dirs[i * 3] = s.x / len
    dirs[i * 3 + 1] = s.y / len
    dirs[i * 3 + 2] = s.z / len
    baseCol[i * 3] = s.r
    baseCol[i * 3 + 1] = s.g
    baseCol[i * 3 + 2] = s.b
    phase[i] = Math.random()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(lineCol, 3))
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
  })
  const lines = new THREE.LineSegments(geometry, material)
  lines.visible = false
  lines.frustumCulled = false
  lines.renderOrder = -1
  starfield.add(lines)

  const blur = { lines, dirs, radii, baseCol, phase, count: n, linePos, lineCol }
  starfield.userData.cruiseBlur = blur
  return blur
}

/**
 * Supercruise motion blur: stretch starfield pinpricks into streaks aimed at
 * the player (camera / local origin). intensity 0 hides streaks and restores dots.
 * @param {THREE.Group} starfield
 * @param {number} intensity 0–1
 * @param {boolean} cruising
 * @param {number} [elapsedS] wall-clock seconds for rush animation
 */
export function updateStarfieldCruiseBlur(starfield, intensity, cruising, elapsedS = 0) {
  if (!starfield) return
  const on = cruising && intensity > 0.02
  const twinkle = starfield.userData.twinkleLayers ?? []

  // Dim / restore original point layers.
  for (const child of starfield.children) {
    if (!child.isPoints || !child.material) continue
    child.userData.baseSize ??= child.material.size
    child.userData.baseOpacity ??= child.material.opacity
    if (on) {
      child.material.size = child.userData.baseSize * (0.55 + intensity * 0.15)
      // Twinkle layers keep their own opacity path in updateStarfield when not cruising.
      if (!twinkle.some((t) => t.layer === child)) {
        child.material.opacity = Math.max(0.12, 0.45 - intensity * 0.28)
      } else {
        child.material.opacity = Math.max(0.08, 0.25 * (1 - intensity * 0.5))
      }
    } else {
      child.material.size = child.userData.baseSize
      if (!twinkle.some((t) => t.layer === child)) {
        child.material.opacity = child.userData.baseOpacity ?? 1
      }
    }
  }

  if (!on) {
    const existing = starfield.userData.cruiseBlur
    if (existing) {
      existing.lines.visible = false
      existing.lines.material.opacity = 0
    }
    return
  }

  const blur = ensureCruiseBlur(starfield)
  const { dirs, radii, baseCol, phase, count, linePos, lineCol, lines } = blur
  const t = elapsedS
  // How far streaks reach toward the camera (fraction of shell radius).
  const stretch = 0.035 + intensity * 0.16
  // Rush speed along each ray (cycles per second).
  const rushHz = 0.35 + intensity * 1.1
  const opacity = 0.35 + intensity * 0.55

  for (let i = 0; i < count; i++) {
    const dx = dirs[i * 3]
    const dy = dirs[i * 3 + 1]
    const dz = dirs[i * 3 + 2]
    const R = radii[i]
    // Per-star phase so the field shimmers rather than pulsing in lockstep.
    const p = (phase[i] + t * rushHz * (0.75 + phase[i] * 0.5)) % 1
    // Head (near player) and tail (outer shell) along the radial ray.
    // Motion: both slide inward; head leads, tail trails → blur toward player.
    const headFrac = 1 - stretch * (0.55 + p * 0.85)
    const tailFrac = 1 + stretch * (0.12 + (1 - p) * 0.35)
    const headR = R * Math.max(0.35, headFrac)
    const tailR = R * Math.min(1.25, tailFrac)

    const i0 = i * 6
    // Outer endpoint (tail)
    linePos[i0] = dx * tailR
    linePos[i0 + 1] = dy * tailR
    linePos[i0 + 2] = dz * tailR
    // Inner endpoint (toward player / camera)
    linePos[i0 + 3] = dx * headR
    linePos[i0 + 4] = dy * headR
    linePos[i0 + 5] = dz * headR

    // Brighter at the head (closer to player), soft at the tail.
    const cr = baseCol[i * 3]
    const cg = baseCol[i * 3 + 1]
    const cb = baseCol[i * 3 + 2]
    const boost = 0.75 + intensity * 0.55
    lineCol[i0] = cr * 0.35 * boost
    lineCol[i0 + 1] = cg * 0.4 * boost
    lineCol[i0 + 2] = cb * 0.55 * boost
    lineCol[i0 + 3] = Math.min(1.4, cr * 1.15 * boost)
    lineCol[i0 + 4] = Math.min(1.4, cg * 1.2 * boost)
    lineCol[i0 + 5] = Math.min(1.5, cb * 1.35 * boost)
  }

  lines.geometry.attributes.position.needsUpdate = true
  lines.geometry.attributes.color.needsUpdate = true
  lines.material.opacity = opacity
  lines.visible = true
}

// Called each frame from main.js right after the starfield is re-centered
// on the camera — elapsed is wall-clock-ish accumulated time (the twinkle is
// pure decoration, so it doesn't need gameState.simTime discipline).
export function updateStarfield(starfield, elapsed) {
  for (const t of starfield.userData.twinkleLayers) {
    t.layer.material.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * t.speed + t.phase))
  }
}

/**
 * Subtle ambient hue from the system sun. Vertex colors stay; material.color
 * multiplies them so the field shifts slightly toward a darkened star tint
 * (mostly neutral — only a whisper of the local star).
 * @param {THREE.Group} starfield
 * @param {THREE.Color|number|null} starColor - primary star; null resets to white
 */
export function setStarfieldStarTint(starfield, starColor) {
  if (!starfield) return
  const tint = new THREE.Color(1, 1, 1)
  if (starColor != null) {
    const c = starColor.isColor ? starColor.clone() : new THREE.Color(starColor)
    // Keep most of the field neutral, pull gently toward a dimmer star hue.
    tint.lerp(c, 0.12)
    tint.multiplyScalar(0.72)
  }
  starfield.traverse((obj) => {
    if (obj.isPoints && obj.material?.isPointsMaterial) {
      obj.material.color.copy(tint)
    }
  })
  // Cruise streak lines share the same ambient tint multiplier.
  const blur = starfield.userData.cruiseBlur
  if (blur?.lines?.material) {
    blur.lines.material.color.copy(tint)
  }
}
