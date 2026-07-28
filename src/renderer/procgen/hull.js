import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Boat sections.
 *
 * The old lofter swept a closed super-ellipse along the length axis. That is a
 * fuselage: symmetric top to bottom, round all the way over, and no matter what
 * you bolt to the top of it the silhouette still reads as an aircraft floating
 * in water. Retuning the station bands could not fix it, because the problem
 * was never the proportions — it was the section.
 *
 * A ship's cross-section is not a closed curve. It is, from the middle out:
 *
 *      deck  ┌───────────────┐   flat, slightly cambered, open to the sky
 *            │               │   topsides, near vertical, flared at the edge
 *            \              /    turn of the bilge
 *             \____________/     bottom, rising from a narrow keel
 *
 * Three parts, and each is what makes a boat look like a boat: the flat deck
 * kills the tube read outright, the bilge decides whether she is a round-bilge
 * displacement hull or a hard-chine planing boat, and the narrow keel gives her
 * something to sit on instead of a belly.
 *
 * The `hull` contract is unchanged, so the roster and every detail-placement
 * helper in shipMesh keep working:
 *   - `stationWidths[i]`     half-beam at station i
 *   - `stationHeights[i]`    half-depth (keel to deck is 2h)
 *   - `stationOffsetsY[i]`   vertical centre, so deck = oy + h and keel = oy - h
 *   - `superellipseExponent` now means bilge hardness: ~1.5 a deep V, 2 a round
 *                            bilge, 4+ a flat-bottomed barge
 */

/** Where the turn of the bilge sits, as a fraction of the way down from deck. */
const BILGE_FRACTION = 0.56
/** How far the deck edge stands outboard of the max beam. */
const DECK_FLARE = 1.06
/** Half-beam of the keel, as a fraction of the station's half-beam. */
const KEEL_FRACTION = 0.1
/** Crown on the deck, as a fraction of the station's half-depth. */
const DECK_CAMBER = 0.1
/** Points across the deck. More than two so the camber actually shows. */
const DECK_POINTS = 4

/**
 * One station's section, as an ordered closed ring of [x, y].
 *
 * Starts at the starboard deck edge, runs down to the keel, up the port side,
 * and back across the deck. Every station returns the same number of points in
 * the same order, which is what lets `ringBetween` loft between any two of them.
 */
function sectionRing(w, h, ox, oy, sides, k) {
  const perSide = Math.max(3, Math.floor(sides / 2))
  const deckY = oy + h
  const keelY = oy - h
  const bilgeY = deckY - 2 * h * BILGE_FRACTION
  const deckHalf = w * DECK_FLARE
  const keelHalf = Math.max(w * KEEL_FRACTION, 1e-3)
  // Exponent of the bottom's super-ellipse quadrant. Clamped because below ~1
  // the bottom turns concave and above ~6 it is a flat plate with corners that
  // shade badly.
  const e = Math.min(6, Math.max(1, k))
  const inv = 2 / e

  /** Outboard profile, u = 0 at the deck edge, u = 1 at the keel. */
  const sidePoint = (u) => {
    if (u <= BILGE_FRACTION) {
      // Topsides: nearly straight, flaring out to the deck edge.
      const t = u / BILGE_FRACTION
      return [deckHalf + (w - deckHalf) * t, deckY + (bilgeY - deckY) * t]
    }
    // Bottom: a super-ellipse quadrant from the bilge down to the keel.
    const t = (u - BILGE_FRACTION) / (1 - BILGE_FRACTION)
    const theta = (t * Math.PI) / 2
    const x = keelHalf + (w - keelHalf) * Math.pow(Math.cos(theta), inv)
    const y = bilgeY + (keelY - bilgeY) * Math.pow(Math.sin(theta), inv)
    return [x, y]
  }

  const ring = []
  // Starboard side, deck edge down to (but not including) the keel.
  for (let i = 0; i < perSide; i++) {
    const [x, y] = sidePoint(i / perSide)
    ring.push([ox + x, y])
  }
  // The keel itself — one point, shared by both sides.
  {
    const [x, y] = sidePoint(1)
    ring.push([ox + x * 0, y])
    // Give the keel a little width so the bottom is a plank, not a knife edge.
    ring[ring.length - 1] = [ox, y]
  }
  // Port side, keel back up to the deck edge.
  for (let i = perSide - 1; i >= 0; i--) {
    const [x, y] = sidePoint(i / perSide)
    ring.push([ox - x, y])
  }
  // Across the deck, port to starboard, skipping both edges (already placed).
  for (let i = 1; i < DECK_POINTS; i++) {
    const t = i / DECK_POINTS
    const x = -deckHalf + 2 * deckHalf * t
    // Crown, so water runs off and the deck is not a mirror-flat plane.
    const camber = DECK_CAMBER * h * (1 - Math.pow(x / Math.max(deckHalf, 1e-3), 2))
    ring.push([ox + x, deckY + camber])
  }
  return ring
}

/**
 * Loft between two stations' rings. Rings must be the same length and in the
 * same order — `sectionRing` guarantees both.
 *
 * `rake` shifts a point forward in z with its height, which is what gives the
 * bow a raked stem instead of a vertical cliff.
 */
function ringBetween(ring0, z0, ring1, z1, rake0, rake1, oy0, oy1, h0, h1) {
  const positions = []
  const n = ring0.length
  const zOf = (p, z, rake, oy, h) => z + (rake * (p[1] - oy)) / Math.max(h, 1e-3)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const a0 = [ring0[i][0], ring0[i][1], zOf(ring0[i], z0, rake0, oy0, h0)]
    const a1 = [ring0[j][0], ring0[j][1], zOf(ring0[j], z0, rake0, oy0, h0)]
    const b0 = [ring1[i][0], ring1[i][1], zOf(ring1[i], z1, rake1, oy1, h1)]
    const b1 = [ring1[j][0], ring1[j][1], zOf(ring1[j], z1, rake1, oy1, h1)]
    positions.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1)
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geom
}

/**
 * Close off an end station — the transom aft, the stem forward. A fan from the
 * section's centroid, which is safe because every section is star-shaped about
 * its own middle.
 */
function cap(ring, z, rake, oy, h, flip) {
  const positions = []
  let cx = 0
  let cy = 0
  for (const p of ring) {
    cx += p[0]
    cy += p[1]
  }
  cx /= ring.length
  cy /= ring.length
  const zOf = (p) => z + (rake * (p[1] - oy)) / Math.max(h, 1e-3)
  const centre = [cx, cy, z + (rake * (cy - oy)) / Math.max(h, 1e-3)]
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    const p0 = [ring[i][0], ring[i][1], zOf(ring[i])]
    const p1 = [ring[j][0], ring[j][1], zOf(ring[j])]
    positions.push(...centre, ...(flip ? p1 : p0), ...(flip ? p0 : p1))
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
 * Translate a wing spec into something a boat can carry.
 *
 * The lofter's "wing" primitive is a flat slab attached at a station. The
 * generated roster already only asks for level, unswept sponsons, but the 31
 * hand-authored classes in data/shipClasses.js were drawn for spacecraft and
 * every one of them still mounts dorsal or ventral fins — the single most
 * aircraft-like thing left on the hull once the sections became boat-shaped.
 *
 * Fixing it here rather than editing thirty-one data blocks means anything
 * added later is covered too:
 *
 *   - **dorsal / tail fins are dropped.** There is no boat equivalent. A fin
 *     standing off the spine reads as a tailplane whatever else is going on.
 *   - **ventral fins become a skeg**: short, thin, unswept, on the centreline.
 *     That is a real thing a hull has, and it is what the slab already almost
 *     was.
 *   - **lateral wings become sponsons**: any dihedral or sweep is flattened, so
 *     they sit level with the hull as a rubbing strake or a gun platform
 *     instead of angling away like a wing.
 */
function toBoatFitting(spec) {
  const side = spec.side ?? 'both'
  if (side === 'top' || side === 'dorsal' || side === 'tail') return null
  if (side === 'bottom' || side === 'ventral') {
    return {
      ...spec,
      span: Math.min(spec.span, 0.9),
      sweep: 0,
      thickness: Math.min(spec.thickness ?? 0.2, 0.22),
      tipOffsetX: 0,
      tipOffsetY: 0,
      chordScale: Math.max(spec.chordScale ?? 1, 1.4)
    }
  }
  return { ...spec, sweep: 0, tipOffsetY: 0, tipOffsetX: 0 }
}

/** How far the stem rakes forward, as a fraction of overall length. */
const STEM_RAKE = 0.06
/** How far the transom overhangs aft. Smaller — a counter, not a clipper bow. */
const TRANSOM_RAKE = 0.02

/**
 * Build the lofted hull. More stations → a smoother sheer; `crossSectionSides`
 * sets how many points go down each side.
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
  const last = n - 1
  const z = stationWidths.map((_, i) => -length / 2 + (length * i) / last)
  const ox = stationOffsetsX ?? stationWidths.map(() => 0)
  const oy = stationOffsetsY ?? stationHeights.map(() => 0)
  const k = superellipseExponent

  // Rake. The deck at the bow stands forward of the keel below it, and the
  // transom overhangs a little aft — without this the stem is a vertical cliff
  // and the whole boat looks like it was cut from a block.
  const rake = stationWidths.map((_, i) => {
    const t = i / last
    return length * (STEM_RAKE * Math.pow(t, 3) - TRANSOM_RAKE * Math.pow(1 - t, 3))
  })

  const rings = stationWidths.map((w, i) =>
    sectionRing(w, stationHeights[i], ox[i], oy[i], sides, k)
  )

  const parts = []
  for (let i = 0; i < last; i++) {
    parts.push(
      ringBetween(
        rings[i],
        z[i],
        rings[i + 1],
        z[i + 1],
        rake[i],
        rake[i + 1],
        oy[i],
        oy[i + 1],
        stationHeights[i],
        stationHeights[i + 1]
      )
    )
  }
  parts.push(cap(rings[0], z[0], rake[0], oy[0], stationHeights[0], true))
  parts.push(cap(rings[last], z[last], rake[last], oy[last], stationHeights[last], false))

  for (const raw of wings) {
    const w = toBoatFitting(raw)
    if (!w) continue
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
