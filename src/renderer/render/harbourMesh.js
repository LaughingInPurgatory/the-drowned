import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mulberry32, range, intRange, pick } from '../procgen/prng.js'
import {
  getStationTextures,
  STATION_NORMAL_STRENGTH,
  retileUVsTriplanar,
  applySoftTriplanar,
  cloneStationMaps
} from './textures.js'
import { remoteness } from '../procgen/world.js'
import { SEA_MAX_AMPLITUDE } from '../world/sea.js'

/**
 * Harbours and outposts.
 *
 * Built procedurally rather than from a model kit: a working harbour is a
 * handful of shapes repeated with intent — deck on piles, warehouses, tanks,
 * a crane, a breakwater, mooring posts, lights — and generating them means
 * every port on the sea is laid out differently without shipping 18 MB of
 * assets that were modelled for orbit.
 *
 * Everything is authored with the **waterline at y = 0** and the deck above it,
 * so these can be dropped straight at sea level (unlike the old orbital modules,
 * which needed lifting; see main.js `floatOnWaterline`).
 *
 * Surfaces use soft-blended triplanar PBR maps so box edges do not show hard
 * UV seams, and major slabs are slightly rounded so silhouettes read as worn
 * concrete/steel rather than plastic cubes.
 */

/** Deck height above the waterline. Clear of the swell, boardable from a boat. */
const DECK_HEIGHT = SEA_MAX_AMPLITUDE + 3.5
/** How far the piles run below the surface. */
const PILE_DEPTH = SEA_MAX_AMPLITUDE + 9

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Soft-edged slab — corners blend into the lighting instead of knife edges. */
function roundedBox(w, h, d, radius = 0.12, segments = 2) {
  const r = Math.min(radius, w * 0.2, h * 0.2, d * 0.2)
  return new RoundedBoxGeometry(w, h, d, segments, Math.max(0.02, r))
}

/**
 * Textured PBR material with soft triplanar sampling so edges don't seam.
 * @param {string} role station texture role
 * @param {object} props MeshStandardMaterial props (color, roughness, …)
 * @param {{ scale?: number, sharpness?: number, offset?: boolean, rng?: () => number }} [tri]
 */
function texturedMat(role, props, tri = {}) {
  const base = getStationTextures(role) ?? {}
  const maps =
    tri.offset && tri.rng
      ? cloneStationMaps(base, {
          offsetU: tri.rng() * 4,
          offsetV: tri.rng() * 4,
          rot: tri.rng() * Math.PI * 0.15
        })
      : base
  // Strip undefined keys before Material() so three does not warn.
  const clean = {}
  for (const [k, v] of Object.entries(maps)) {
    if (v != null) clean[k] = v
  }
  const mat = new THREE.MeshStandardMaterial({
    ...clean,
    ...props,
    normalScale:
      props.normalScale ??
      new THREE.Vector2(STATION_NORMAL_STRENGTH * 0.75, STATION_NORMAL_STRENGTH * 0.75)
  })
  if (clean.map || clean.roughnessMap || clean.metalnessMap) {
    applySoftTriplanar(mat, {
      scale: tri.scale ?? 0.2,
      sharpness: tri.sharpness ?? 4.2,
      key: `harbour|${role}|${tri.scale ?? 0.2}`
    })
  }
  return mat
}

function materials(rng, weathered) {
  // Further out, everything is more rust than paint.
  const rust = new THREE.Color(0x6d4a33).lerp(new THREE.Color(0x8a5a38), rng())
  const plate = new THREE.Color(0x8a8680).lerp(rust, weathered * 0.5)
  // Warm weathered timber — rock maps read as rough plank grain under this tint.
  const timberTone = new THREE.Color(0x7a654c).lerp(new THREE.Color(0x4e3f30), weathered * 0.45)
  const wetPile = new THREE.Color(0x3a342c).lerp(rust, weathered * 0.35)
  return {
    // Quay deck: coarse grit (darkmetal) under timber tint, dense repeat.
    deck: texturedMat(
      'floor',
      {
        color: timberTone,
        roughness: 0.94,
        metalness: 0.04,
        normalScale: new THREE.Vector2(1.1, 1.1)
      },
      { scale: 0.18, sharpness: 5, offset: true, rng }
    ),
    // Sheet / tank / roof steel.
    plate: texturedMat(
      'hull',
      {
        color: plate,
        roughness: 0.72 + weathered * 0.12,
        metalness: 0.58 - weathered * 0.12,
        normalScale: new THREE.Vector2(1.35, 1.35)
      },
      { scale: 0.16, sharpness: 4.5, offset: true, rng }
    ),
    // Warehouse walls — painted plate gone chalky.
    wall: texturedMat(
      'panel',
      {
        color: new THREE.Color(0x918a7e).lerp(rust, weathered * 0.38),
        roughness: 0.86,
        metalness: 0.22,
        normalScale: new THREE.Vector2(1.2, 1.2)
      },
      { scale: 0.2, sharpness: 4.8, offset: true, rng }
    ),
    // Piles, crane legs, beams — dark structural steel.
    beam: texturedMat(
      'beam',
      {
        color: new THREE.Color(0x4a4640).lerp(rust, weathered * 0.55),
        roughness: 0.84,
        metalness: 0.55
      },
      { scale: 0.28, sharpness: 3.8 }
    ),
    // Wet lower piles / rust crust.
    pileWet: texturedMat(
      'beam',
      {
        color: wetPile,
        roughness: 0.92,
        metalness: 0.35
      },
      { scale: 0.32, sharpness: 3.5 }
    ),
    rust: texturedMat(
      'hull',
      {
        color: rust,
        roughness: 0.96,
        metalness: 0.28,
        normalScale: new THREE.Vector2(1.0, 1.0)
      },
      { scale: 0.24, sharpness: 3.6 }
    ),
    // Breakwater rock — coarser tile, softer blend for lumpy stone.
    rubble: texturedMat(
      'rubble',
      {
        color: new THREE.Color(0x7d7469).lerp(rust, weathered * 0.3),
        roughness: 1,
        metalness: 0.04,
        normalScale: new THREE.Vector2(1.55, 1.55)
      },
      { scale: 0.12, sharpness: 2.8 }
    ),
    accent: texturedMat(
      'accent',
      {
        color: pick(rng, [0xc4531c, 0xc9a227, 0x2f6f8f, 0xb03a2e]),
        roughness: 0.58,
        metalness: 0.28
      },
      { scale: 0.22, sharpness: 5 }
    ),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xffd9a0,
      emissive: 0xffb257,
      emissiveIntensity: 1.6,
      roughness: 0.4
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x2a3a3e,
      emissive: 0xffc27a,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.1
    })
  }
}

/** A deck slab on piles, with fenders down the working edge. */
function addJetty(group, mats, rng, { x, z, w, l, rot = 0 }) {
  const jetty = new THREE.Group()
  jetty.position.set(x, 0, z)
  jetty.rotation.y = rot

  // Slightly rounded deck — soft lip reads as worn concrete/timber, not a cube.
  const deck = new THREE.Mesh(roundedBox(w, 0.75, l, 0.14, 2), mats.deck)
  deck.position.y = DECK_HEIGHT
  deck.castShadow = true
  deck.receiveShadow = true
  jetty.add(deck)

  // Thin edge plank / kerb so the silhouette isn't a single slab.
  const kerb = new THREE.Mesh(
    roundedBox(w + 0.18, 0.22, l + 0.18, 0.06, 1),
    mats.beam
  )
  kerb.position.y = DECK_HEIGHT - 0.28
  kerb.castShadow = true
  kerb.receiveShadow = true
  jetty.add(kerb)

  // Piles. Spacing is by length so a long jetty gets more, not bigger, legs.
  // Split wet (lower) / dry (upper) so the waterline reads naturally.
  const rows = Math.max(2, Math.round(l / 7))
  const cols = Math.max(2, Math.round(w / 7))
  const pileH = DECK_HEIGHT + PILE_DEPTH
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const px = -w / 2 + (j + 0.5) * (w / cols)
      const pz = -l / 2 + (i + 0.5) * (l / rows)
      const wetH = PILE_DEPTH * 0.55
      const dryH = pileH - wetH
      const wet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.62, wetH, 8),
        mats.pileWet
      )
      wet.position.set(px, -PILE_DEPTH + wetH / 2, pz)
      wet.castShadow = true
      wet.receiveShadow = true
      jetty.add(wet)
      const dry = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.54, dryH, 8),
        mats.beam
      )
      dry.position.set(px, -PILE_DEPTH + wetH + dryH / 2, pz)
      dry.castShadow = true
      dry.receiveShadow = true
      jetty.add(dry)
    }
  }

  // Fenders and bollards down both long edges — this is where boats come in.
  const fenderCount = Math.max(2, Math.round(l / 9))
  for (let i = 0; i < fenderCount; i++) {
    const fz = -l / 2 + (i + 0.5) * (l / fenderCount)
    for (const sx of [-1, 1]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.28, 6, 10), mats.rust)
      tyre.position.set(sx * (w / 2 + 0.2), DECK_HEIGHT - 1.1, fz)
      tyre.rotation.y = Math.PI / 2
      jetty.add(tyre)
      if (i % 2 === 0) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.1, 8), mats.beam)
        bollard.position.set(sx * (w / 2 - 0.9), DECK_HEIGHT + 0.9, fz)
        bollard.castShadow = true
        jetty.add(bollard)
      }
    }
  }
  group.add(jetty)
  return jetty
}

/** A shed / warehouse with a pitched roof, sitting on the deck. */
function addShed(group, mats, rng, { x, z, w, d, h, rot = 0, lit = true }) {
  const shed = new THREE.Group()
  shed.position.set(x, DECK_HEIGHT + 0.35, z)
  shed.rotation.y = rot

  const body = new THREE.Mesh(roundedBox(w, h, d, Math.min(0.2, w * 0.04), 2), mats.wall)
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  shed.add(body)

  // Pitched roof, as two slabs — corrugated sheet over a ridge.
  const pitch = h * 0.28
  for (const sx of [-1, 1]) {
    const slope = new THREE.Mesh(
      roundedBox(w * 0.56, 0.22, d * 1.06, 0.05, 1),
      mats.plate
    )
    slope.position.set(sx * w * 0.25, h + pitch * 0.5, 0)
    slope.rotation.z = sx * -Math.atan2(pitch, w * 0.5)
    slope.castShadow = true
    slope.receiveShadow = true
    shed.add(slope)
  }

  // Roller door on the long face, and windows if anyone still works here.
  const door = new THREE.Mesh(roundedBox(w * 0.4, h * 0.6, 0.18, 0.04, 1), mats.accent)
  door.position.set(0, h * 0.3, d / 2 + 0.05)
  shed.add(door)
  if (lit) {
    const winCount = intRange(rng, 2, 4)
    for (let i = 0; i < winCount; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.12, h * 0.2, 0.15), mats.glass)
      win.position.set(-w * 0.3 + (i / Math.max(1, winCount - 1)) * w * 0.6, h * 0.7, d / 2 + 0.05)
      shed.add(win)
    }
  }
  group.add(shed)
  return shed
}

/** Fuel / water tanks — the most recognisable thing on any working waterfront. */
function addTanks(group, mats, rng, { x, z, count, r, h }) {
  for (let i = 0; i < count; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mats.plate)
    const tx = x + (i - (count - 1) / 2) * r * 2.4
    tank.position.set(tx, DECK_HEIGHT + h / 2, z)
    tank.castShadow = true
    tank.receiveShadow = true
    group.add(tank)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, h * 0.06, 20), mats.rust)
    cap.position.set(tx, DECK_HEIGHT + h, z)
    group.add(cap)
    // Banding, so a plain cylinder reads as riveted plate.
    for (const f of [0.3, 0.65]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.04, 5, 18), mats.beam)
      band.position.set(tx, DECK_HEIGHT + h * f, z)
      band.rotation.x = Math.PI / 2
      group.add(band)
    }
  }
}

/** Gantry crane over the quay. */
function addCrane(group, mats, rng, { x, z, h, reach }) {
  const crane = new THREE.Group()
  crane.position.set(x, DECK_HEIGHT, z)
  crane.rotation.y = rng() * Math.PI * 2

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(roundedBox(0.7, h, 0.7, 0.08, 1), mats.beam)
      leg.position.set(sx * 3, h / 2, sz * 3)
      leg.castShadow = true
      crane.add(leg)
    }
  }
  const jib = new THREE.Mesh(roundedBox(1.0, 0.9, reach, 0.08, 1), mats.accent)
  jib.position.set(0, h, reach * 0.28)
  jib.castShadow = true
  crane.add(jib)
  const counterweight = new THREE.Mesh(roundedBox(2.2, 1.6, 2.4, 0.1, 1), mats.rust)
  counterweight.position.set(0, h, -reach * 0.22)
  crane.add(counterweight)
  // Hook block on its cable.
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h * 0.55, 5), mats.beam)
  cable.position.set(0, h - h * 0.28, reach * 0.42)
  crane.add(cable)
  const hook = new THREE.Mesh(roundedBox(0.8, 0.8, 0.8, 0.06, 1), mats.beam)
  hook.position.set(0, h - h * 0.55, reach * 0.42)
  crane.add(hook)
  group.add(crane)
}

/**
 * A rubble mole enclosing the anchorage — what makes it a harbour rather than a
 * pier. Tipped rock, not masonry: small, irregular, and mostly awash, so the
 * swell breaks over it instead of it standing up like a wall.
 */
function addBreakwater(group, mats, rng, radius) {
  const arc = range(rng, 1.4, 2.4)
  const start = rng() * Math.PI * 2
  const segs = Math.max(18, Math.round(arc * 22))
  // One subdivision plus a per-vertex wobble. A bare icosahedron has twenty
  // identical faces and reads as a cut gem; this gives the lumpy, weathered
  // silhouette of tipped stone for a handful more triangles. Built once and
  // shared — the per-block scale and rotation do the variety.
  let geo = new THREE.IcosahedronGeometry(1, 1)
  {
    const pos = geo.getAttribute('position')
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      // Hash off the direction so shared vertices always agree and the surface
      // stays closed.
      const h = Math.sin(v.x * 91.17 + v.y * 47.31 + v.z * 63.73) * 43758.5453
      v.multiplyScalar(0.86 + (h - Math.floor(h)) * 0.26)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    // Soft triplanar material samples in local position — UVs are fallback only.
    geo = retileUVsTriplanar(geo, 0.45)
  }
  for (let i = 0; i < segs; i++) {
    const a = start + (i / (segs - 1)) * arc
    // Two staggered rows so it reads as a tipped bank with width, not a line.
    for (const lane of [-1, 1]) {
      if (lane > 0 && rng() < 0.35) continue
      const block = new THREE.Mesh(geo, mats.rubble)
      const r = radius * range(rng, 0.97, 1.03) + lane * radius * 0.035
      let s = range(rng, radius * 0.035, radius * 0.07)
      let sy = s * range(rng, 0.5, 0.95)
      // Position by the block's *underside*, not its centre. Placing the centre
      // near the waterline left the smaller blocks hanging clear of the water
      // with daylight under them — a mole is tipped rock resting on the bottom,
      // so every block has to run well below the surface whatever its size.
      const crest = range(rng, -1.2, 1.6) + SEA_MAX_AMPLITUDE * 0.5
      // Guarantee the bottom clears the deepest trough. Positioning by the
      // underside is not enough on its own — a small block with a high crest
      // still ends up hanging in the air.
      const needDepth = SEA_MAX_AMPLITUDE + 2
      const minSy = (crest + needDepth) * 0.5
      if (sy < minSy) {
        // Growing only the vertical axis turned the small blocks into shark
        // fins. Boulders are roughly as wide as they are tall, so take the
        // footprint up with the height.
        s = Math.max(s, minSy * 0.85)
        sy = minSy
      }
      block.position.set(
        Math.cos(a) * r + range(rng, -s, s) * 0.4,
        // Top of the block lands at the crest height; the rest of it goes down.
        crest - sy,
        Math.sin(a) * r + range(rng, -s, s) * 0.4
      )
      block.scale.set(s, sy, s * range(rng, 0.8, 1.25))
      block.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
      block.castShadow = true
      block.receiveShadow = true
      group.add(block)
    }
  }
  // Light on the head of the mole — pole planted through the waterline.
  const headA = start + arc
  const lampY = DECK_HEIGHT + 6.4
  const botY = -PILE_DEPTH * 0.5
  const postH = lampY - botY
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, postH, 6), mats.plate)
  post.position.set(Math.cos(headA) * radius, (lampY + botY) / 2, Math.sin(headA) * radius)
  group.add(post)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mats.lamp)
  lamp.position.set(Math.cos(headA) * radius, lampY, Math.sin(headA) * radius)
  lamp.userData.beacon = true
  group.add(lamp)
}

/** Lamp posts planted in the water along the quay edge (not floating mid-air). */
function addQuayLights(group, mats, positions) {
  const lampY = DECK_HEIGHT + 5.85
  const botY = -PILE_DEPTH * 0.45
  const postH = lampY - botY
  for (const [x, z] of positions) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, postH, 5), mats.beam)
    post.position.set(x, (lampY + botY) / 2, z)
    post.castShadow = true
    group.add(post)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), mats.plate)
    head.position.set(x, DECK_HEIGHT + 6.1, z)
    group.add(head)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 7, 5), mats.lamp)
    lamp.position.set(x, lampY, z)
    group.add(lamp)
  }
}

/**
 * Build a harbour or an outpost.
 *
 * Layout is seeded from the body id, so a given port always looks the same, and
 * scaled by kind: a port is a working waterfront with a mole around it, an
 * outpost is a jetty, a shed, and a light.
 */
export function buildHarbourMesh(body) {
  const rng = mulberry32(hashString(body.id))
  const isPort = body.kind === 'port'
  const weathered = Math.min(1, remoteness(body.position) * 1.1)
  const mats = materials(rng, weathered)
  const group = new THREE.Group()
  group.userData.kind = body.kind

  // Overall footprint. These are local units; main.js scales the group up.
  const size = isPort ? range(rng, 34, 52) : range(rng, 14, 22)

  // —— Main quay ——————————————————————————————————————————————————
  const quayW = size * range(rng, 0.5, 0.75)
  const quayL = size * range(rng, 0.75, 1.0)
  addJetty(group, mats, rng, { x: 0, z: 0, w: quayW, l: quayL })

  // Finger jetties off the quay for boats to lie alongside.
  const fingers = isPort ? intRange(rng, 2, 4) : 1
  for (let i = 0; i < fingers; i++) {
    const side = i % 2 === 0 ? 1 : -1
    const fz = -quayL * 0.3 + (i / Math.max(1, fingers - 1)) * quayL * 0.6
    addJetty(group, mats, rng, {
      x: side * (quayW / 2 + size * 0.22),
      z: fz,
      w: size * range(rng, 0.32, 0.5),
      l: size * range(rng, 0.1, 0.16),
      rot: 0
    })
  }

  // —— Buildings ————————————————————————————————————————————————————
  const sheds = isPort ? intRange(rng, 2, 4) : 1
  for (let i = 0; i < sheds; i++) {
    addShed(group, mats, rng, {
      x: range(rng, -quayW * 0.28, quayW * 0.28),
      z: -quayL * 0.34 + (i / Math.max(1, sheds - 1)) * quayL * 0.56,
      w: size * range(rng, 0.2, 0.32),
      d: size * range(rng, 0.16, 0.26),
      h: size * range(rng, 0.12, 0.22),
      rot: range(rng, -0.1, 0.1),
      lit: rng() < 0.85
    })
  }

  // Harbourmaster's tower — the tallest thing here, and how you spot a port
  // from open water before anything else resolves.
  if (isPort) {
    const towerH = size * range(rng, 0.4, 0.62)
    const tw = size * 0.16
    const tower = new THREE.Mesh(roundedBox(tw, towerH, tw, tw * 0.08, 2), mats.wall)
    tower.position.set(quayW * 0.3, DECK_HEIGHT + towerH / 2, -quayL * 0.34)
    tower.castShadow = true
    tower.receiveShadow = true
    group.add(tower)
    const cab = new THREE.Mesh(
      roundedBox(size * 0.22, size * 0.11, size * 0.22, 0.06, 1),
      mats.glass
    )
    cab.position.set(quayW * 0.3, DECK_HEIGHT + towerH + size * 0.05, -quayL * 0.34)
    group.add(cab)
    const cap = new THREE.Mesh(
      roundedBox(size * 0.26, size * 0.02, size * 0.26, 0.03, 1),
      mats.plate
    )
    cap.position.set(quayW * 0.3, DECK_HEIGHT + towerH + size * 0.11, -quayL * 0.34)
    group.add(cap)
    // Rotating beacon on the roof.
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(size * 0.022, 8, 6), mats.lamp)
    beacon.position.set(quayW * 0.3, DECK_HEIGHT + towerH + size * 0.14, -quayL * 0.34)
    beacon.userData.beacon = true
    group.add(beacon)
  }

  // —— Waterfront plant ——————————————————————————————————————————————
  if (isPort) {
    addTanks(group, mats, rng, {
      x: -quayW * 0.3,
      z: quayL * 0.3,
      count: intRange(rng, 2, 4),
      r: size * 0.06,
      h: size * range(rng, 0.14, 0.22)
    })
    addCrane(group, mats, rng, {
      x: quayW * range(rng, -0.2, 0.2),
      z: quayL * range(rng, 0.1, 0.3),
      h: size * range(rng, 0.28, 0.42),
      reach: size * range(rng, 0.3, 0.45)
    })
    if (rng() < 0.7) {
      addCrane(group, mats, rng, {
        x: quayW * range(rng, -0.3, 0.3),
        z: -quayL * range(rng, 0.1, 0.3),
        h: size * range(rng, 0.22, 0.34),
        reach: size * range(rng, 0.24, 0.36)
      })
    }
    addBreakwater(group, mats, rng, size * range(rng, 0.9, 1.15))
  }

  // Stacked crates and drums — the deck should look worked, not swept.
  const clutter = isPort ? intRange(rng, 8, 16) : intRange(rng, 3, 6)
  const crateGeo = roundedBox(1, 1, 1, 0.06, 1)
  const drumGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 10)
  for (let i = 0; i < clutter; i++) {
    const isDrum = rng() < 0.35
    const item = new THREE.Mesh(isDrum ? drumGeo : crateGeo, rng() < 0.3 ? mats.accent : mats.rust)
    const s = size * range(rng, 0.025, 0.055)
    item.scale.set(s, s * range(rng, 0.8, 1.4), s)
    item.position.set(
      range(rng, -quayW * 0.42, quayW * 0.42),
      DECK_HEIGHT + 0.35 + (s * range(rng, 0.8, 1.4)) / 2,
      range(rng, -quayL * 0.42, quayL * 0.42)
    )
    item.rotation.y = rng() * Math.PI
    item.castShadow = true
    item.receiveShadow = true
    group.add(item)
  }

  // —— Lights ————————————————————————————————————————————————————————
  const lampPositions = []
  const lamps = isPort ? 6 : 2
  for (let i = 0; i < lamps; i++) {
    const t = i / Math.max(1, lamps - 1)
    lampPositions.push([
      (i % 2 === 0 ? -1 : 1) * quayW * 0.42,
      -quayL * 0.42 + t * quayL * 0.84
    ])
  }
  addQuayLights(group, mats, lampPositions)

  // Outposts get a light on a pole and nothing else — a mark, not a port.
  if (!isPort) {
    const lampY = DECK_HEIGHT + size * 0.52
    const botY = -PILE_DEPTH * 0.4
    const mastH = lampY - botY
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, mastH, 6), mats.beam)
    mast.position.set(0, (lampY + botY) / 2, -quayL * 0.35)
    mast.castShadow = true
    group.add(mast)
    const light = new THREE.Mesh(new THREE.SphereGeometry(size * 0.035, 8, 6), mats.lamp)
    light.position.set(0, lampY, -quayL * 0.35)
    light.userData.beacon = true
    group.add(light)
  }

  return group
}

/** Pulse the beacons. Called per frame from main.js in place of the old station spin. */
export function updateHarbourMesh(mesh, elapsed) {
  if (!mesh?.traverse) return
  const pulse = 0.55 + 0.45 * Math.sin(elapsed * 1.6)
  mesh.traverse((child) => {
    if (!child.userData?.beacon || !child.material) return
    child.material.emissiveIntensity = 0.8 + pulse * 1.8
  })
}
