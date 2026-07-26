import * as THREE from 'three'

// Procedural forked lightning for hyperspace / supercruise tunnels.
// Bolts live in local +Y (length); callers rotate like the old plane streaks
// (rotX π/2 → length along view depth).
//
// "Thick" look: emit a bright core plus parallel glow offsets so it reads
// more like real lightning than a 1px wire. Optional curve/helix warp the
// trunk so bolts follow a tunnel cylinder instead of straight sticks.

/** Max line segments (each = 2 vertices) per bolt including forks + glow.
 *  Long corridor spirals need headroom: ~90 trunk segs × 3 (thick) + forks. */
export const LIGHTNING_MAX_SEGMENTS = 320
const MAX_FLOATS = LIGHTNING_MAX_SEGMENTS * 2 * 3

export function createLightningGeometry() {
  const positions = new Float32Array(MAX_FLOATS)
  const geo = new THREE.BufferGeometry()
  const attr = new THREE.BufferAttribute(positions, 3)
  attr.setUsage(THREE.DynamicDrawUsage)
  geo.setAttribute('position', attr)
  geo.setDrawRange(0, 0)
  return geo
}

export function createLightningMaterial(color, opacity = 0.9) {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    // depthTest on so the player ship (opaque) occludes bolts behind it;
    // depthWrite off so transparent bolts don't fight each other.
    depthWrite: false,
    depthTest: true
  })
}

/**
 * Rewrite `geometry` with a jagged trunk along +Y [0, length] plus side forks.
 * @param {THREE.BufferGeometry} geometry
 * @param {{ length?: number, jag?: number, forks?: number, curve?: number, helix?: number, thickness?: number, rng?: () => number }} opts
 * @returns {number} vertex count written
 */
export function rewriteLightningBolt(geometry, opts = {}) {
  const length = opts.length ?? 20
  const jag = opts.jag ?? 1.2
  const forks = opts.forks ?? 4
  const curve = opts.curve ?? 0
  const helix = opts.helix ?? 0
  const thickness = opts.thickness ?? 0.22
  const rng = opts.rng ?? Math.random
  const pos = geometry.attributes.position.array
  let w = 0

  function emitSeg(x0, y0, z0, x1, y1, z1) {
    if (w + 6 > pos.length) return false
    pos[w++] = x0
    pos[w++] = y0
    pos[w++] = z0
    pos[w++] = x1
    pos[w++] = y1
    pos[w++] = z1
    return true
  }

  /** Warp a local (x,z) sample by curve (arc in +X) and helix around +Y. */
  function warp(x, y, z) {
    const t = length > 1e-6 ? y / length : 0
    // Arc bend: stronger mid-bolt, like energy following the tunnel wall.
    const bend = Math.sin(t * Math.PI) * curve
    let wx = x + bend
    let wz = z
    if (helix !== 0) {
      const a = t * helix
      const c = Math.cos(a)
      const s = Math.sin(a)
      const rx = wx * c - wz * s
      const rz = wx * s + wz * c
      wx = rx
      wz = rz
    }
    return [wx, y, wz]
  }

  // Main trunk: more segments than before for a real lightning crawl.
  const segs = 14 + Math.floor(rng() * 12)
  const pts = new Float32Array((segs + 1) * 3)
  let x = 0
  let z = 0
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    if (i > 0) {
      // Occasional sharp kinks (real lightning isn't smooth noise).
      const spike = rng() < 0.18 ? 2.4 : 1
      x += (rng() - 0.5) * 2.6 * jag * spike
      z += (rng() - 0.5) * 2.6 * jag * spike
      x *= 0.62
      z *= 0.62
    }
    const [wx, wy, wz] = warp(x, t * length, z)
    pts[i * 3] = wx
    pts[i * 3 + 1] = wy
    pts[i * 3 + 2] = wz
  }

  // Glow sheath: parallel copies offset perpendicular to the segment.
  function emitThick(x0, y0, z0, x1, y1, z1, thick) {
    if (!emitSeg(x0, y0, z0, x1, y1, z1)) return false
    if (thick <= 0) return true
    // Perp in XZ (cross with length axis approx +Y).
    let dx = x1 - x0
    let dz = z1 - z0
    const lenH = Math.hypot(dx, dz) || 1
    dx /= lenH
    dz /= lenH
    // Rotate 90° in XZ: (dx,dz) → (-dz, dx)
    const ox = -dz * thick
    const oz = dx * thick
    if (!emitSeg(x0 + ox, y0, z0 + oz, x1 + ox, y1, z1 + oz)) return false
    if (!emitSeg(x0 - ox, y0, z0 - oz, x1 - ox, y1, z1 - oz)) return false
    // Second thinner sheath for a fatter bolt.
    const o2x = ox * 1.85
    const o2z = oz * 1.85
    if (!emitSeg(x0 + o2x, y0, z0 + o2z, x1 + o2x, y1, z1 + o2z)) return false
    if (!emitSeg(x0 - o2x, y0, z0 - o2z, x1 - o2x, y1, z1 - o2z)) return false
    return true
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 3
    const b = (i + 1) * 3
    if (!emitThick(pts[a], pts[a + 1], pts[a + 2], pts[b], pts[b + 1], pts[b + 2], thickness)) break
  }

  // Side forks (and sub-forks) — more aggressive branching.
  const forkN = Math.max(2, forks)
  for (let f = 0; f < forkN; f++) {
    const start = 1 + Math.floor(rng() * Math.max(1, segs - 2))
    let fx = pts[start * 3]
    let fy = pts[start * 3 + 1]
    let fz = pts[start * 3 + 2]
    // Unwarp approximation: treat current as already warped and step in local jag.
    const fSegs = 3 + Math.floor(rng() * 5)
    let dx = (rng() - 0.5) * jag * 2.8
    let dy = (0.1 + rng() * 0.55) * (length / segs)
    let dz = (rng() - 0.5) * jag * 2.8
    for (let s = 0; s < fSegs; s++) {
      const nx = fx + dx + (rng() - 0.5) * jag * 0.75
      const ny = fy + dy
      const nz = fz + dz + (rng() - 0.5) * jag * 0.75
      // Light thickness on forks (core + one sheath).
      if (!emitSeg(fx, fy, fz, nx, ny, nz)) break
      const ox = (rng() - 0.5) * thickness * 0.9
      const oz = (rng() - 0.5) * thickness * 0.9
      emitSeg(fx + ox, fy, fz + oz, nx + ox, ny, nz + oz)
      fx = nx
      fy = ny
      fz = nz
      dx *= 0.78
      dy *= 0.86
      dz *= 0.78

      if (s === 1 && rng() > 0.35) {
        let sx = fx
        let sy = fy
        let sz = fz
        let sdx = (rng() - 0.5) * jag * 1.8
        let sdy = dy * 0.6
        let sdz = (rng() - 0.5) * jag * 1.8
        for (let k = 0; k < 2 + Math.floor(rng() * 3); k++) {
          const nx2 = sx + sdx
          const ny2 = sy + sdy
          const nz2 = sz + sdz
          if (!emitSeg(sx, sy, sz, nx2, ny2, nz2)) break
          sx = nx2
          sy = ny2
          sz = nz2
          sdx *= 0.78
          sdy *= 0.82
          sdz *= 0.78
        }
      }
    }
  }

  geometry.attributes.position.needsUpdate = true
  geometry.setDrawRange(0, w / 3)
  if (geometry.boundingSphere) geometry.boundingSphere.radius = length * 1.8 + Math.abs(curve) * 2
  else geometry.computeBoundingSphere()
  return w / 3
}

/**
 * Helical lightning streamer for the supercruise tunnel.
 * Runs from zStart (far, more negative) toward zEnd (nearer the ship),
 * twisting around the cylinder as it comes forward — never at the camera.
 *
 * Geometry is written in tunnel local space (X/Y radial, Z depth) so callers
 * only need to position the mesh at the origin and spin angleOffset over time.
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{
 *   zStart?: number,
 *   zEnd?: number,
 *   radius?: number,
 *   angle0?: number,
 *   twists?: number,
 *   jag?: number,
 *   forks?: number,
 *   thickness?: number,
 *   rng?: () => number
 * }} opts
 */
/**
 * @param {{
 *   zStart?: number, zEnd?: number, radius?: number, angle0?: number,
 *   twists?: number, jag?: number, forks?: number, thickness?: number,
 *   radiusFn?: (theta: number) => number,
 *   rng?: () => number
 * }} opts
 * radiusFn: optional unit-radius multiplier vs angle (1 = circle; star tunnels
 * pass a star-envelope function so streamers ride the star wall).
 */
export function rewriteSpiralLightningBolt(geometry, opts = {}) {
  const zStart = opts.zStart ?? -130
  const zEnd = opts.zEnd ?? -28
  const radius = opts.radius ?? 20
  const angle0 = opts.angle0 ?? 0
  const twists = opts.twists ?? 1.25
  const jag = opts.jag ?? 1.1
  const forks = opts.forks ?? 3
  const thickness = opts.thickness ?? 0.2
  const radiusFn = opts.radiusFn ?? (() => 1)
  const rng = opts.rng ?? Math.random
  const pos = geometry.attributes.position.array
  let w = 0

  function emitSeg(x0, y0, z0, x1, y1, z1) {
    if (w + 6 > pos.length) return false
    pos[w++] = x0
    pos[w++] = y0
    pos[w++] = z0
    pos[w++] = x1
    pos[w++] = y1
    pos[w++] = z1
    return true
  }

  // Dense samples on long corridors so the far mouth stays continuous and
  // the bolt clearly reaches the opposite (near) end without sparse gaps.
  const depth = Math.abs(zEnd - zStart)
  const segs = Math.min(120, 48 + Math.floor(depth / 3.5) + Math.floor(rng() * 16))
  const pts = new Float32Array((segs + 1) * 3)
  let rJ = 0
  let aJ = 0
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    // Ease-in (was smoothstep, which flattens to zero rate at BOTH ends) so
    // the twist keeps accelerating all the way to the near end instead of
    // straightening out into a radial line just before the tip.
    const twistT = t * t
    const a = angle0 + twists * Math.PI * 2 * twistT + aJ
    if (i > 0) {
      rJ += (rng() - 0.5) * 0.55 * jag
      aJ += (rng() - 0.5) * 0.12 * jag
      rJ *= 0.72
      aJ *= 0.72
    }
    // Occasional sharp lightning kink.
    if (rng() < 0.12) {
      rJ += (rng() - 0.5) * jag * 1.4
      aJ += (rng() - 0.5) * 0.25
    }
    const unit = Math.max(0.2, radiusFn(a))
    const r = Math.max(radius * 0.3 * unit, radius * unit + rJ * unit)
    const z = zStart + (zEnd - zStart) * t
    pts[i * 3] = Math.cos(a) * r
    pts[i * 3 + 1] = Math.sin(a) * r
    pts[i * 3 + 2] = z
  }

  function emitThick(x0, y0, z0, x1, y1, z1, thick) {
    if (!emitSeg(x0, y0, z0, x1, y1, z1)) return false
    if (thick <= 0) return true
    // Offset roughly radial from mid-point for a fatter bolt read.
    const mx = (x0 + x1) * 0.5
    const my = (y0 + y1) * 0.5
    const mlen = Math.hypot(mx, my) || 1
    const ox = (mx / mlen) * thick
    const oy = (my / mlen) * thick
    if (!emitSeg(x0 + ox, y0 + oy, z0, x1 + ox, y1 + oy, z1)) return false
    if (!emitSeg(x0 - ox, y0 - oy, z0, x1 - ox, y1 - oy, z1)) return false
    return true
  }

  for (let i = 0; i < segs; i++) {
    const a = i * 3
    const b = (i + 1) * 3
    if (!emitThick(pts[a], pts[a + 1], pts[a + 2], pts[b], pts[b + 1], pts[b + 2], thickness)) break
  }

  // Forks peel off along the full span (including near the far mouth) so the
  // bolt reads as reaching both ends of the corridor, not just the mid-tube.
  const forkN = Math.max(1, forks)
  for (let f = 0; f < forkN; f++) {
    const start = 1 + Math.floor(rng() * Math.max(1, segs - 2))
    let fx = pts[start * 3]
    let fy = pts[start * 3 + 1]
    let fz = pts[start * 3 + 2]
    const fSegs = 3 + Math.floor(rng() * 5)
    // Peel outward + slightly forward.
    let dx = fx * 0.08 * (0.5 + rng())
    let dy = fy * 0.08 * (0.5 + rng())
    let dz = (zEnd - zStart) / segs * (0.4 + rng() * 0.5)
    for (let s = 0; s < fSegs; s++) {
      const nx = fx + dx + (rng() - 0.5) * jag * 0.8
      const ny = fy + dy + (rng() - 0.5) * jag * 0.8
      const nz = fz + dz
      if (!emitSeg(fx, fy, fz, nx, ny, nz)) break
      fx = nx
      fy = ny
      fz = nz
      dx *= 0.8
      dy *= 0.8
      dz *= 0.88
    }
  }

  geometry.attributes.position.needsUpdate = true
  geometry.setDrawRange(0, w / 3)
  const span = Math.abs(zEnd - zStart) + radius * 2
  if (geometry.boundingSphere) geometry.boundingSphere.radius = span
  else geometry.computeBoundingSphere()
  return w / 3
}
