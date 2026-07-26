import * as THREE from 'three'
import {
  createLightningGeometry,
  createLightningMaterial,
  rewriteSpiralLightningBolt
} from './lightningBolt.js'
import { updateStarfieldCruiseBlur } from './starfield.js'
import { buildCloudTexture } from './nebula.js'

// Screen-space motion wash (CSS) + 3D speed streaks. Intensity 0–1; supercruise
// should pass ~0.85–1 so the effect reads as a different flight mode.

const STREAK_COUNT = 48
const STREAK_COUNT_CRUISE = 96

function buildStreakTexture() {
  const w = 32
  const h = 128
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const g = ctx.createLinearGradient(w / 2, 0, w / 2, h)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.35, 'rgba(200,240,255,0.9)')
  g.addColorStop(0.7, 'rgba(140,210,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  return new THREE.CanvasTexture(canvas)
}

function createStreakPool(count, texture, colorHex) {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: colorHex,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const meshes = []
  const group = new THREE.Group()
  group.visible = false
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geometry, material.clone())
    m.visible = false
    group.add(m)
    meshes.push({
      mesh: m,
      // Ship-local start position (offset from ship)
      lx: 0,
      ly: 0,
      lz: 0,
      speed: 1,
      life: 0,
      maxLife: 1
    })
  }
  return { group, meshes, material }
}

function respawnStreak(s, intensity, cruise) {
  // Normal: short amber trails. Supercruise: long cyan rush.
  const spread = cruise ? 55 : 22
  const depth = cruise ? 180 : 55
  s.lx = (Math.random() - 0.5) * spread * 2
  s.ly = (Math.random() - 0.5) * spread * 1.2
  s.lz = cruise ? 20 + Math.random() * depth : 6 + Math.random() * depth * 0.5
  s.speed = (cruise ? 220 : 70) * (0.6 + Math.random() * 0.8) * (0.5 + intensity)
  s.maxLife = cruise ? 0.55 + Math.random() * 0.45 : 0.28 + Math.random() * 0.25
  s.life = s.maxLife
  const len = (cruise ? 18 : 5) * (0.5 + intensity * 0.85) * (0.6 + Math.random())
  const thick = cruise ? 0.35 + Math.random() * 0.45 : 0.12 + Math.random() * 0.16
  s.mesh.scale.set(thick, len, 1)
  s.mesh.material.opacity = (cruise ? 0.55 : 0.42) * intensity * (0.55 + Math.random() * 0.45)
  s.mesh.visible = true
}

// Full-screen 3D star tunnel for supercruise — parented to the camera.
// Helical lightning grows from the far mouth toward the ship (pinned at the
// opposite end), then holds a full-span bolt while spinning. Depth rings +
// haze sell the tube; colors follow the system star (see setTint).
// All geometry stays past the chase-camera ship (~44u) so the hull stays clear.
const TUNNEL_STREAMERS = 14
const TUNNEL_RINGS = 8
const TUNNEL_RADIUS = 22
const TUNNEL_WISPS = 10
const TUNNEL_FLASHES = 6
const DEFAULT_TUNNEL_TINT = new THREE.Color(0x6ec4ff)
// Streamer depth range (camera at 0 looking down -Z).
// Z_NEAR past the ship so bolts/haze sit behind the hull, not over it.
const Z_FAR = -260
const Z_NEAR = -58
// Rings recycle before they reach the ship plane.
const Z_RECYCLE = Z_NEAR + 4
// grow: 0 → 1 bolts from far mouth toward ship; >1 holds full span, then recycle.
const GROW_HOLD = 1.35

function createCruiseStarTunnel() {
  const group = new THREE.Group()
  group.visible = false
  group.frustumCulled = false
  // Below default ship order so opaque hull wins when depths are close.
  group.renderOrder = 1

  // Live tint (system sun color). Bolts store a per-bolt lightness jitter.
  const tint = DEFAULT_TUNNEL_TINT.clone()
  const tmpColor = new THREE.Color()

  function makeStreamer(lightJitter) {
    const geo = createLightningGeometry()
    const coreMat = createLightningMaterial(
      tmpColor.copy(tint).offsetHSL(0, -0.05, 0.35 + lightJitter),
      0.95
    )
    const glowMat = createLightningMaterial(
      tmpColor.copy(tint).offsetHSL(0.02, 0.15, lightJitter * 0.5),
      0.42
    )
    const core = new THREE.LineSegments(geo, coreMat)
    const glow = new THREE.LineSegments(geo, glowMat)
    core.frustumCulled = false
    glow.frustumCulled = false
    // Geometry is already in tunnel space — mesh stays at origin.
    core.position.set(0, 0, 0)
    glow.position.set(0, 0, 0)
    group.add(glow)
    group.add(core)
    return {
      mesh: core,
      glow,
      lightJitter,
      angle0: 0,
      radius: TUNNEL_RADIUS,
      twists: 1.2,
      // How fast the whole spiral rotates (rad/s).
      spin: 0.35,
      // How fast the bolt grows far→near (grow units / s).
      advance: 0.12,
      phase: Math.random(),
      flickerT: 0,
      grow: 0
    }
  }

  const streaks = []
  for (let i = 0; i < TUNNEL_STREAMERS; i++) {
    streaks.push(makeStreamer(0.06 + Math.random() * 0.16))
  }

  // Concentric rings rushing toward the camera — strong tunnel depth cue.
  // depthTest so the ship occludes rings behind it; recycle past ship plane.
  const rings = []
  const ringGeo = new THREE.RingGeometry(0.92, 1.08, 64)
  for (let i = 0; i < TUNNEL_RINGS; i++) {
    const mesh = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: tint.clone().multiplyScalar(1.05),
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      })
    )
    mesh.frustumCulled = false
    group.add(mesh)
    rings.push({
      mesh,
      z: Z_NEAR - 8 - i * (Math.abs(Z_FAR - Z_NEAR) * 0.9 / TUNNEL_RINGS),
      speed: 70 + i * 8,
      baseScale: TUNNEL_RADIUS * (0.95 + (i % 3) * 0.04),
      wobblePhase: Math.random() * Math.PI * 2,
      wobbleSeed: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.6 + Math.random() * 1.8
    })
  }

  // Soft cylindrical haze = tunnel walls. Span Z_NEAR→Z_FAR (past the ship).
  const hazeDepth = Math.abs(Z_FAR - Z_NEAR)
  const hazeMid = (Z_FAR + Z_NEAR) * 0.5
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(TUNNEL_RADIUS * 1.15, TUNNEL_RADIUS * 1.05, hazeDepth, 40, 1, true),
    new THREE.MeshBasicMaterial({
      color: tint.clone().multiplyScalar(0.22),
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    })
  )
  haze.rotation.x = Math.PI / 2
  haze.position.z = hazeMid
  haze.frustumCulled = false
  group.add(haze)

  // Second tighter haze for layered corridor.
  const hazeInner = new THREE.Mesh(
    new THREE.CylinderGeometry(
      TUNNEL_RADIUS * 0.55,
      TUNNEL_RADIUS * 0.5,
      hazeDepth * 0.9,
      32,
      1,
      true
    ),
    new THREE.MeshBasicMaterial({
      color: tint.clone().multiplyScalar(0.35),
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    })
  )
  hazeInner.rotation.x = Math.PI / 2
  hazeInner.position.z = hazeMid * 0.95
  hazeInner.frustumCulled = false
  group.add(hazeInner)

  // Vanishing-point core at the far mouth (where lightning originates).
  const coreCanvas = document.createElement('canvas')
  coreCanvas.width = coreCanvas.height = 64
  {
    const ctx = coreCanvas.getContext('2d')
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.2, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.25)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  const core = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(coreCanvas),
      color: tint.clone().lerp(new THREE.Color(1, 1, 1), 0.45),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    })
  )
  core.position.set(0, 0, Z_FAR * 0.92)
  core.scale.setScalar(28)
  core.frustumCulled = false
  group.add(core)

  // Streaming nebula wisps — soft glowing gas drifting past inside the
  // corridor, same reused cloud-puff texture as the backdrop nebula, but
  // tunnel-tinted and rushing toward the ship like the rings.
  const wispTexture = buildCloudTexture()
  const wisps = []
  for (let i = 0; i < TUNNEL_WISPS; i++) {
    const mesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: wispTexture,
        color: tint.clone(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      })
    )
    mesh.frustumCulled = false
    group.add(mesh)
    wisps.push({
      mesh,
      z: Z_FAR + Math.random() * (Z_NEAR - Z_FAR),
      angle: Math.random() * Math.PI * 2,
      radius: TUNNEL_RADIUS * (0.25 + Math.random() * 0.75),
      rotSpeed: (Math.random() - 0.5) * 0.5,
      baseScale: 45 + Math.random() * 75,
      phase: Math.random() * Math.PI * 2
    })
  }

  // Light flashes — brief bright pops in the tunnel walls, like static
  // discharge; reuses the same soft radial texture as the vanishing-point core.
  const flashes = []
  for (let i = 0; i < TUNNEL_FLASHES; i++) {
    const mesh = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: core.material.map,
        color: tint.clone().lerp(new THREE.Color(1, 1, 1), 0.6),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      })
    )
    mesh.visible = false
    mesh.frustumCulled = false
    group.add(mesh)
    flashes.push({ mesh, life: 0, maxLife: 0.22 + Math.random() * 0.1, cooldown: Math.random() * 2 })
  }

  function applyTint(color) {
    if (!color) return
    const c = color.isColor ? color : new THREE.Color(color)
    // Skip redundant updates (called every frame while cruising).
    if (tint.getHex() === c.getHex()) return
    tint.copy(c)
    for (const s of streaks) {
      s.mesh.material.color.copy(tint).offsetHSL(0, -0.05, 0.35 + s.lightJitter)
      if (s.glow) s.glow.material.color.copy(tint).offsetHSL(0.03, 0.2, s.lightJitter * 0.4)
    }
    for (const r of rings) {
      r.mesh.material.color.copy(tint).multiplyScalar(1.05)
    }
    haze.material.color.copy(tint).multiplyScalar(0.22)
    hazeInner.material.color.copy(tint).multiplyScalar(0.35)
    core.material.color.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.45)
    for (const w of wisps) w.mesh.material.color.copy(tint)
    for (const f of flashes) f.mesh.material.color.copy(tint).lerp(new THREE.Color(1, 1, 1), 0.6)
  }

  /**
   * Rebuild streamer as a helix from the fixed far mouth toward a near tip.
   * `grow` in [0,1]: tip advances from far→near; at 1 the bolt spans the corridor.
   */
  function reshapeStreamer(s) {
    // Wide, uneven ranges (was a narrow band) — a uniform helix reads as
    // machined; scattering jag/twist/thickness per rebuild makes each bolt
    // its own erratic shape instead of the same spiral traced N times.
    const twists = (0.6 + Math.random() * 2.3) * (s.spin >= 0 ? 1 : -1)
    s.twists = twists
    // Far end always pinned at Z_FAR; tip crawls toward Z_NEAR as grow → 1.
    const g = Math.min(1, Math.max(0.04, s.grow ?? 1))
    const zTip = Z_FAR + (Z_NEAR - Z_FAR) * g
    rewriteSpiralLightningBolt(s.mesh.geometry, {
      zStart: Z_FAR,
      zEnd: zTip,
      radius: s.radius,
      angle0: 0,
      twists,
      jag: 0.5 + Math.random() * 2.2,
      forks: 1 + Math.floor(Math.random() * 4),
      thickness: 0.1 + Math.random() * 0.32
    })
    s.flickerT = 0.08 + Math.random() * 0.22
  }

  function reset(s, intensity) {
    s.angle0 = Math.random() * Math.PI * 2
    s.spin = (0.12 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1)
    // Growth speed: reaches the opposite end in ~1.2–2.2s at nominal rush.
    s.advance = (0.55 + Math.random() * 0.35) * (0.75 + intensity * 0.45)
    s.radius = TUNNEL_RADIUS * (0.6 + Math.random() * 0.6)
    s.phase = Math.random()
    // Per-bolt wobble kick so the spin isn't a perfectly steady rotation.
    s.wobbleFreq = 1.5 + Math.random() * 3.5
    s.wobbleAmp = 0.15 + Math.random() * 0.55
    s.wobbleSeed = Math.random() * Math.PI * 2
    // Stagger start so not every bolt is mid-corridor at once.
    s.grow = Math.random() * 0.35
    reshapeStreamer(s)
  }

  for (const s of streaks) reset(s, 0.75)
  // Running clock for haze/ring wobble noise (update() only gets dt).
  let elapsed = 0

  const _aim = new THREE.Vector3()
  const _eye = new THREE.Vector3()
  const _up = new THREE.Vector3()
  const _lookMat = new THREE.Matrix4()

  return {
    group,
    setTint: applyTint,
    /**
     * @param {THREE.Camera} camera
     * @param {THREE.Color|number|null} sunColor
     * @param {THREE.Vector3|number[]|null} aimWorld - crosshair aim point; tunnel
     *   vanishing point sits on the camera→aim ray (not screen center).
     */
    update(dt, intensity, camera, sunColor = null, aimWorld = null) {
      if (sunColor) applyTint(sunColor)
      if (intensity < 0.05 || !camera) {
        group.visible = false
        return
      }
      group.visible = true
      // Origin at camera; -Z toward crosshair (camera convention).
      // Do NOT use Object3D.lookAt — for non-cameras it aims +Z at the target,
      // which put the whole tunnel behind the lens.
      group.position.copy(camera.position)
      if (aimWorld) {
        if (aimWorld.isVector3) _aim.copy(aimWorld)
        else _aim.fromArray(aimWorld)
        _eye.copy(camera.position)
        if (_eye.distanceToSquared(_aim) > 1e-4) {
          _up.copy(camera.up)
          _lookMat.lookAt(_eye, _aim, _up)
          group.quaternion.setFromRotationMatrix(_lookMat)
        } else {
          group.quaternion.copy(camera.quaternion)
        }
      } else {
        group.quaternion.copy(camera.quaternion)
      }

      const rush = 0.55 + intensity * 1.1
      const i = Math.min(1, Math.max(0.25, intensity))
      elapsed += dt

      for (const s of streaks) {
        // Spin helix + grow tip from far mouth toward the ship (far end stays put),
        // plus an irregular wobble so the rotation isn't a perfectly steady spin.
        const wobble = Math.sin(elapsed * s.wobbleFreq + s.wobbleSeed) * s.wobbleAmp
        s.angle0 += (s.spin + wobble) * rush * dt
        s.grow = (s.grow || 0) + s.advance * rush * dt
        if (s.grow > GROW_HOLD) {
          reset(s, intensity)
          continue
        }

        s.flickerT -= dt
        // Rebuild often while growing so the tip visibly crawls; slower when full.
        if (s.flickerT <= 0) reshapeStreamer(s)

        // Mesh fixed at origin — geometry itself spans far→tip in tunnel space.
        s.mesh.rotation.set(0, 0, s.angle0)
        s.mesh.position.set(0, 0, 0)
        s.mesh.scale.set(1, 1, 1)
        if (s.glow) {
          s.glow.rotation.copy(s.mesh.rotation)
          s.glow.position.copy(s.mesh.position)
          s.glow.scale.set(1.1, 1.1, 1.1)
        }

        // Brighter once the bolt has reached the opposite (near) end.
        const reach = Math.min(1, s.grow)
        const holdFade = s.grow > 1 ? Math.max(0, 1 - (s.grow - 1) / (GROW_HOLD - 1)) : 1
        const crackle = 0.62 + 0.38 * Math.sin(s.phase * 40 + s.angle0 * 2.5)
        const baseOp =
          0.9 * (0.5 + i * 0.7) * (0.55 + s.phase * 0.45) * (0.4 + reach * 0.6) * holdFade * crackle
        s.mesh.material.opacity = Math.max(0, baseOp)
        if (s.glow) s.glow.material.opacity = Math.max(0, baseOp * 0.48)
      }

      for (const r of rings) {
        r.z += r.speed * rush * dt
        r.wobblePhase = (r.wobblePhase ?? 0) + dt * r.wobbleSpeed
        // Recycle before the ship plane — never fly through the hull.
        if (r.z > Z_RECYCLE) {
          r.z = Z_FAR * 0.95 - Math.random() * 40
          r.baseScale = TUNNEL_RADIUS * (0.9 + Math.random() * 0.2)
          r.wobbleSeed = Math.random() * Math.PI * 2
          r.wobbleSpeed = 0.6 + Math.random() * 1.8
        }
        const span = Math.abs(Z_FAR - Z_NEAR)
        const depthT = Math.min(1, Math.max(0, (r.z - Z_FAR) / span))
        const sc = r.baseScale * (1 + depthT * 0.9) * (0.85 + i * 0.25)
        // Organic wobble: uneven ellipse + off-axis drift instead of a
        // perfectly circular ring dead-centered on the tunnel axis.
        const seed = r.wobbleSeed ?? 0
        const scX = sc * (1 + 0.16 * Math.sin(r.wobblePhase + seed))
        const scY = sc * (1 + 0.16 * Math.sin(r.wobblePhase * 1.4 + seed + 2.4))
        r.mesh.scale.set(scX, scY, 1)
        r.mesh.position.set(
          Math.sin(r.wobblePhase * 0.7 + seed) * sc * 0.08,
          Math.cos(r.wobblePhase * 0.9 + seed) * sc * 0.08,
          r.z
        )
        r.mesh.material.opacity = (0.05 + i * 0.16) * Math.min(1, (-r.z - 40) / 50 + 0.25)
      }

      // Streaming nebula wisps — drift/rotate while rushing toward the ship,
      // recycling at the far mouth like the rings.
      for (const w of wisps) {
        w.z += (w.speed ?? 55) * rush * dt
        w.angle += w.rotSpeed * dt
        w.phase += dt * 1.6
        if (w.z > Z_RECYCLE) {
          w.z = Z_FAR - Math.random() * 60
          w.angle = Math.random() * Math.PI * 2
          w.radius = TUNNEL_RADIUS * (0.25 + Math.random() * 0.75)
          w.baseScale = 45 + Math.random() * 75
          w.speed = 40 + Math.random() * 60
        }
        const span = Math.abs(Z_FAR - Z_NEAR)
        const depthT = Math.min(1, Math.max(0, (w.z - Z_FAR) / span))
        const sc = w.baseScale * (1 + depthT * 1.3)
        w.mesh.position.set(Math.cos(w.angle) * w.radius, Math.sin(w.angle) * w.radius, w.z)
        w.mesh.scale.set(sc * 1.3, sc, 1)
        w.mesh.material.rotation = w.angle
        const fade = Math.min(1, (-w.z - 30) / 50 + 0.2)
        w.mesh.material.opacity = (0.05 + i * 0.1) * (0.6 + 0.4 * Math.sin(w.phase)) * Math.max(0, fade)
      }

      // Light flashes — occasional brief pops, like static discharge along
      // the tunnel walls. Each sprite idles invisibly on a cooldown, then
      // flares in/out over a fraction of a second at a fresh random spot.
      for (const f of flashes) {
        if (f.life <= 0) {
          f.cooldown -= dt
          if (f.cooldown <= 0 && Math.random() < 0.05 * rush) {
            f.life = f.maxLife
            const ang = Math.random() * Math.PI * 2
            const rad = TUNNEL_RADIUS * (0.2 + Math.random() * 0.9)
            const z = Z_FAR + Math.random() * (Z_NEAR - Z_FAR) * 0.85
            f.mesh.position.set(Math.cos(ang) * rad, Math.sin(ang) * rad, z)
            const s = 10 + Math.random() * 16
            f.mesh.scale.set(s, s, 1)
            f.mesh.visible = true
            f.cooldown = 0.35 + Math.random() * 1.5
          }
        } else {
          f.life -= dt
          const t = Math.max(0, f.life / f.maxLife)
          f.mesh.material.opacity = Math.sin(t * Math.PI) * (0.5 + i * 0.5)
          if (f.life <= 0) {
            f.mesh.visible = false
            f.mesh.material.opacity = 0
          }
        }
      }

      // Haze cylinders breathe unevenly (independent x/y noise) rather than a
      // uniform circular pulse, so the tunnel wall feels turbulent, not machined.
      haze.material.opacity = 0.1 + i * 0.22
      haze.scale.set(
        (0.95 + i * 0.12) * (1 + 0.05 * Math.sin(elapsed * 0.9)),
        (0.95 + i * 0.12) * (1 + 0.05 * Math.sin(elapsed * 1.3 + 2.1)),
        1
      )
      hazeInner.material.opacity = 0.04 + i * 0.1
      hazeInner.scale.set(
        (0.9 + i * 0.15) * (1 + 0.06 * Math.sin(elapsed * 1.1 + 0.8)),
        (0.9 + i * 0.15) * (1 + 0.06 * Math.sin(elapsed * 0.7 + 3.4)),
        1
      )

      core.position.z = Z_FAR * 0.92
      core.scale.setScalar(18 + i * 32)
      core.material.opacity = 0.28 + i * 0.5
    },
    stop() {
      group.visible = false
    }
  }
}

/**
 * @param {HTMLElement} container - usually #app
 */
export function createMotionEffects(container) {
  const texture = buildStreakTexture()
  // Amber/orange for normal thrust; cyan for supercruise — reads as different modes.
  const normal = createStreakPool(STREAK_COUNT, texture, 0xffa040)
  const cruise = createStreakPool(STREAK_COUNT_CRUISE, texture, 0xc8f0ff)
  const cruiseTunnel = createCruiseStarTunnel()
  // Pre-seed lives so first frame isn't empty.
  for (const s of normal.meshes) respawnStreak(s, 0.2, false)
  for (const s of cruise.meshes) respawnStreak(s, 0.5, true)

  const group = new THREE.Group()
  group.add(normal.group, cruise.group, cruiseTunnel.group)

  const overlay = document.createElement('div')
  overlay.id = 'motion-fx-overlay'
  // Radial vignette + soft edge glow only — no vertical line streaks
  // (those read as a scanline cage, not motion). 3D speed lines handle rush.
  // Supercruise HUD glitch lives on #hud (see ui/hud.js), not full-screen here.
  overlay.innerHTML = `
    <div class="mf-radial"></div>
    <div class="mf-chroma"></div>
  `
  const style = document.createElement('style')
  style.textContent = `
#motion-fx-overlay {
  position: fixed; inset: 0; pointer-events: none; z-index: 8;
  opacity: 0; transition: opacity 0.12s linear;
}
#motion-fx-overlay.cruise { transition: opacity 0.08s linear; }
#motion-fx-overlay .mf-radial {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center,
    transparent 28%,
    rgba(8, 20, 40, 0.12) 55%,
    rgba(4, 10, 24, 0.45) 100%);
}
#motion-fx-overlay .mf-chroma {
  position: absolute; inset: 0;
  box-shadow:
    inset 0 0 80px rgba(80, 180, 255, 0.1),
    inset 0 0 160px rgba(40, 100, 200, 0.14);
  opacity: 0;
}
#motion-fx-overlay.cruise .mf-chroma { opacity: 1; }
#motion-fx-overlay.cruise .mf-radial {
  background: radial-gradient(ellipse at center,
    transparent 22%,
    rgba(10, 40, 70, 0.18) 50%,
    rgba(5, 12, 30, 0.55) 100%);
}
`
  document.head.appendChild(style)
  container.appendChild(overlay)

  const localPos = new THREE.Vector3()
  const worldPos = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const quat = new THREE.Quaternion()

  function clearPool(pool) {
    pool.group.visible = false
    for (const s of pool.meshes) {
      s.mesh.visible = false
      s.life = 0
    }
  }

  function updatePool(pool, dt, intensity, isCruise, shipPos, shipQuat) {
    if (intensity <= 0.04) {
      clearPool(pool)
      return
    }
    const activeCount = Math.floor(pool.meshes.length * Math.min(1, intensity * (isCruise ? 1.1 : 0.9)))
    pool.group.visible = true
    for (let i = 0; i < pool.meshes.length; i++) {
      const s = pool.meshes[i]
      if (i >= activeCount) {
        s.mesh.visible = false
        continue
      }
      s.life -= dt
      s.lz -= s.speed * dt
      if (s.life <= 0 || s.lz < -(isCruise ? 40 : 18)) {
        respawnStreak(s, intensity, isCruise)
      }
      localPos.set(s.lx, s.ly, s.lz)
      worldPos.copy(localPos).applyQuaternion(shipQuat).add(shipPos)
      s.mesh.position.copy(worldPos)
      // Align plane long-axis with travel (ship -Z is aft; streaks run along forward).
      s.mesh.quaternion.copy(shipQuat)
      s.mesh.rotateX(Math.PI / 2)
      const fade = Math.max(0, s.life / s.maxLife)
      s.mesh.material.opacity = (isCruise ? 0.65 : 0.45) * intensity * fade
    }
  }

  return {
    group,
    overlay,
    // Kill cruise (and optionally all) streaks immediately — call on supercruise exit.
    stopCruiseStreaks() {
      clearPool(cruise)
      cruiseTunnel.stop()
      overlay.classList.remove('cruise')
    },
    /**
     * @param {number} speed - current speed magnitude
     * @param {number} refSpeed - ship class max (normal) speed for 0–1 norm
     * @param {boolean} cruising
     * @param {number} [throttle] - -1..1 main throttle (drives thrust streaks)
     * @param {THREE.Camera} [camera] - for full-screen cruise star tunnel
     * @param {THREE.Color|number} [starColor] - system sun tint for the cruise tunnel
     * @param {THREE.Vector3|number[]} [aimWorld] - crosshair world aim (tunnel origin axis)
     */
    update(dt, { speed, refSpeed, cruising, throttle = 0, shipPos, shipQuat, camera = null, starColor = null, aimWorld = null }) {
      quat.fromArray(shipQuat)
      const shipP = new THREE.Vector3().fromArray(shipPos)
      const speedNorm = Math.min(1, speed / Math.max(1, refSpeed))
      const thrust = Math.min(1, Math.abs(throttle))
      // Supercruise: strong cyan. Normal: milder amber, throttle/speed driven.
      const intensity = cruising
        ? 0.55 + 0.45 * Math.min(1, speed / Math.max(1, refSpeed * 3.5))
        : Math.min(1, Math.max(speedNorm * 0.55, thrust * 0.65))

      if (cruising) {
        updatePool(normal, dt, 0, false, shipP, quat)
        // Ship-local streaks stay mild; the full-screen tunnel is the main read.
        // Tint ship streaks toward the sun color too so the whole wash matches.
        if (starColor) {
          const c = starColor.isColor ? starColor : new THREE.Color(starColor)
          for (const s of cruise.meshes) {
            if (s.mesh.material?.color) s.mesh.material.color.copy(c).lerp(new THREE.Color(1, 1, 1), 0.35)
          }
        }
        updatePool(cruise, dt, intensity * 0.45, true, shipP, quat)
        cruiseTunnel.update(dt, intensity, camera, starColor, aimWorld)
      } else {
        updatePool(normal, dt, intensity, false, shipP, quat)
        updatePool(cruise, dt, 0, true, shipP, quat)
        cruiseTunnel.stop()
      }

      overlay.style.opacity = String(cruising ? Math.min(1, intensity * 1.05) : intensity * 0.35)
      overlay.classList.toggle('cruise', cruising)

      // Cruise FOV boost kept tiny (was 3+intensity*4 — still too much zoom-out).
      return { intensity, speedNorm, fovBoost: cruising ? intensity * 1.5 : intensity * 4 }
    },
    hide() {
      overlay.style.opacity = '0'
      overlay.classList.remove('cruise')
      clearPool(normal)
      clearPool(cruise)
      cruiseTunnel.stop()
    },
    dispose() {
      overlay.remove()
      style.remove()
    }
  }
}

/**
 * Warp the real starfield during supercruise: radial motion-blur streaks
 * aimed at the player (camera). Intensity comes from motionFx.update().
 */
export function updateStarfieldMotion(starfield, intensity, cruising, _shipQuat = null) {
  if (!starfield) return
  starfield.scale.set(1, 1, 1)
  starfield.quaternion.identity()
  updateStarfieldCruiseBlur(starfield, intensity ?? 0, !!cruising, performance.now() / 1000)
}
