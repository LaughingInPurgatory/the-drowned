import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Cross-section loft between two elliptical stations, with optional lateral
// offsets so the centerline can snake (asymmetry / "bolted-on module" look).
// Super-ellipse exponent k > 2 → boxier industrial sections; k≈2 → rounder.
function ringBetween(w0, h0, z0, ox0, oy0, w1, h1, z1, ox1, oy1, sides, k = 2) {
  const positions = []
  const invK = 1 / Math.max(0.5, k)
  const point = (w, h, a, ox, oy, z) => {
    const c = Math.cos(a)
    const s = Math.sin(a)
    // Superellipse: |cos|^k / |sin|^k form scaled to axes.
    const rx = Math.sign(c) * Math.pow(Math.abs(c), invK) * w
    const ry = Math.sign(s) * Math.pow(Math.abs(s), invK) * h
    return [rx + ox, ry + oy, z]
  }
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const p00 = point(w0, h0, a0, ox0, oy0, z0)
    const p01 = point(w0, h0, a1, ox0, oy0, z0)
    const p10 = point(w1, h1, a0, ox1, oy1, z1)
    const p11 = point(w1, h1, a1, ox1, oy1, z1)
    positions.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geom
}

function cap(w, h, z, ox, oy, sides, flip, k = 2) {
  const positions = []
  const center = [ox, oy, z]
  const invK = 1 / Math.max(0.5, k)
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const c0 = Math.cos(a0)
    const s0 = Math.sin(a0)
    const c1 = Math.cos(a1)
    const s1 = Math.sin(a1)
    const p0 = [
      Math.sign(c0) * Math.pow(Math.abs(c0), invK) * w + ox,
      Math.sign(s0) * Math.pow(Math.abs(s0), invK) * h + oy,
      z
    ]
    const p1 = [
      Math.sign(c1) * Math.pow(Math.abs(c1), invK) * w + ox,
      Math.sign(s1) * Math.pow(Math.abs(s1), invK) * h + oy,
      z
    ]
    positions.push(...center, ...(flip ? p1 : p0), ...(flip ? p0 : p1))
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geom
}

// Thick slab wings.
// side: 'both' | 'left' | 'right' | 'bottom'/'ventral' | 'top'/'dorsal'/'tail'
// Optional tipOffsetY for anhedral/dihedral (lateral) or tipOffsetX (vert wings).
// Top/tail fins are usually placed near the aft (low atStation) for a rear stabilizer look.
function wingGeometries(spec, stations, i) {
  const { span, sweep, thickness, side = 'both', tipOffsetY = 0, tipOffsetX = 0, chordScale = 1 } = spec
  const rootW = stations.widths[i]
  const rootH = stations.heights[i]
  const rootOx = stations.offsetsX[i] ?? 0
  const rootOy = stations.offsetsY[i] ?? 0
  const zc = stations.z[i]
  const chordRoot = rootH * 1.6 * chordScale
  const chordTip = chordRoot * 0.38
  const halfT = Math.max(0.06, thickness * 0.5)

  const tri = (corners, ...keys) => {
    const positions = []
    for (const k of keys) positions.push(...corners[k])
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geom
  }
  const faces = (corners) => [
    tri(corners, 'r1', 't1', 't2', 'r1', 't2', 'r2'),
    tri(corners, 'r1b', 'r2b', 't2b', 'r1b', 't2b', 't1b'),
    tri(corners, 'r1', 'r1b', 't1b', 'r1', 't1b', 't1'),
    tri(corners, 'r2', 't2', 't2b', 'r2', 't2b', 'r2b'),
    tri(corners, 't1', 't1b', 't2b', 't1', 't2b', 't2'),
    tri(corners, 'r1', 'r2', 'r2b', 'r1', 'r2b', 'r1b')
  ]

  // Underside keel wing: spans in -Y from the hull belly, thickness in X.
  if (side === 'bottom' || side === 'ventral') {
    const rootY = rootOy - rootH
    const tipY = rootY - span
    const corners = {
      r1: [rootOx - halfT, rootY, zc - chordRoot / 2],
      r2: [rootOx - halfT, rootY, zc + chordRoot / 2],
      t1: [rootOx - halfT + tipOffsetX, tipY, zc + sweep - chordTip / 2],
      t2: [rootOx - halfT + tipOffsetX, tipY, zc + sweep + chordTip / 2],
      r1b: [rootOx + halfT, rootY, zc - chordRoot / 2],
      r2b: [rootOx + halfT, rootY, zc + chordRoot / 2],
      t1b: [rootOx + halfT + tipOffsetX, tipY, zc + sweep - chordTip / 2],
      t2b: [rootOx + halfT + tipOffsetX, tipY, zc + sweep + chordTip / 2]
    }
    return faces(corners)
  }

  // Dorsal / tail wing: spans in +Y from the hull spine, thickness in X.
  // Prefer aft stations (low atStation) for a rear stabilizer silhouette.
  if (side === 'top' || side === 'dorsal' || side === 'tail') {
    const rootY = rootOy + rootH
    const tipY = rootY + span
    const corners = {
      r1: [rootOx - halfT, rootY, zc - chordRoot / 2],
      r2: [rootOx - halfT, rootY, zc + chordRoot / 2],
      t1: [rootOx - halfT + tipOffsetX, tipY, zc + sweep - chordTip / 2],
      t2: [rootOx - halfT + tipOffsetX, tipY, zc + sweep + chordTip / 2],
      r1b: [rootOx + halfT, rootY, zc - chordRoot / 2],
      r2b: [rootOx + halfT, rootY, zc + chordRoot / 2],
      t1b: [rootOx + halfT + tipOffsetX, tipY, zc + sweep - chordTip / 2],
      t2b: [rootOx + halfT + tipOffsetX, tipY, zc + sweep + chordTip / 2]
    }
    return faces(corners)
  }

  const yRoot = rootOy
  const sides = []
  if (side === 'both' || side === 'right') sides.push(1)
  if (side === 'both' || side === 'left') sides.push(-1)

  const geoms = []
  for (const sign of sides) {
    const rootX = sign * rootW + rootOx
    const tipX = sign * (rootW + span) + rootOx
    const corners = {
      r1: [rootX, yRoot + halfT, zc - chordRoot / 2],
      r2: [rootX, yRoot + halfT, zc + chordRoot / 2],
      t1: [tipX, yRoot + halfT + tipOffsetY, zc + sweep - chordTip / 2],
      t2: [tipX, yRoot + halfT + tipOffsetY, zc + sweep + chordTip / 2],
      r1b: [rootX, yRoot - halfT, zc - chordRoot / 2],
      r2b: [rootX, yRoot - halfT, zc + chordRoot / 2],
      t1b: [tipX, yRoot - halfT + tipOffsetY, zc + sweep - chordTip / 2],
      t2b: [tipX, yRoot - halfT + tipOffsetY, zc + sweep + chordTip / 2]
    }
    geoms.push(...faces(corners))
  }
  return geoms
}

/**
 * Build lofted hull mesh. More stations → smoother silhouette; higher sides →
 * rounder (or boxier with superellipseExponent).
 */
export function buildHullGeometry(hull) {
  const {
    length,
    stationWidths,
    stationHeights,
    crossSectionSides: sides,
    wings = [],
    stationOffsetsX = null,
    stationOffsetsY = null,
    superellipseExponent = 2.2
  } = hull
  const n = stationWidths.length
  const z = stationWidths.map((_, i) => -length / 2 + (length * i) / (n - 1))
  const ox = stationOffsetsX ?? stationWidths.map(() => 0)
  const oy = stationOffsetsY ?? stationHeights.map(() => 0)
  const k = superellipseExponent
  const parts = []
  for (let i = 0; i < n - 1; i++) {
    parts.push(
      ringBetween(
        stationWidths[i],
        stationHeights[i],
        z[i],
        ox[i],
        oy[i],
        stationWidths[i + 1],
        stationHeights[i + 1],
        z[i + 1],
        ox[i + 1],
        oy[i + 1],
        sides,
        k
      )
    )
  }
  parts.push(cap(stationWidths[0], stationHeights[0], z[0], ox[0], oy[0], sides, true, k))
  parts.push(
    cap(stationWidths[n - 1], stationHeights[n - 1], z[n - 1], ox[n - 1], oy[n - 1], sides, false, k)
  )
  for (const w of wings) {
    parts.push(
      ...wingGeometries(
        w,
        {
          widths: stationWidths,
          heights: stationHeights,
          z,
          offsetsX: ox,
          offsetsY: oy
        },
        w.atStation
      )
    )
  }
  const merged = mergeGeometries(parts, false)
  merged.computeVertexNormals()
  // Cylindrical UVs for tiling hull PBR maps (ships use +Z as length axis).
  addCylindricalUVs(merged, length)
  return merged
}

/** u = angle around the hull, v = length along local +Z (nose→tail). */
function addCylindricalUVs(geometry, length) {
  const pos = geometry.getAttribute('position')
  if (!pos) return
  const uvs = new Float32Array(pos.count * 2)
  const invLen = length > 1e-6 ? 1 / length : 1
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    // Angle around longitudinal axis; wings get usable UVs from the same map.
    const u = (Math.atan2(y, x) / (Math.PI * 2) + 1) % 1
    const v = z * invLen + 0.5
    // Tighter tile so painted/armor normals read as plates, not giant blobs.
    uvs[i * 2] = u * 3.4
    uvs[i * 2 + 1] = v * 2.4
  }
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
}
