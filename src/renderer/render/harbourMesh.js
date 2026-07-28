import * as THREE from 'three'
import { mulberry32, range, intRange, pick } from '../procgen/prng.js'
import { getStationTextures, STATION_NORMAL_STRENGTH, retileUVsTriplanar } from './textures.js'
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

function materials(rng, weathered) {
  const maps = (role) => getStationTextures(role) ?? {}
  // Further out, everything is more rust than paint.
  const rust = new THREE.Color(0x6d4a33).lerp(new THREE.Color(0x8a5a38), rng())
  const plate = new THREE.Color(0x7d7a72).lerp(rust, weathered * 0.55)
  const timberTone = new THREE.Color(0x6a5741).lerp(new THREE.Color(0x4a3d2e), weathered * 0.5)
  return {
    deck: new THREE.MeshStandardMaterial({
      ...maps('floor'),
      color: timberTone,
      roughness: 0.92,
      metalness: 0.06,
      normalScale: new THREE.Vector2(STATION_NORMAL_STRENGTH, STATION_NORMAL_STRENGTH)
    }),
    plate: new THREE.MeshStandardMaterial({
      ...maps('hull'),
      color: plate,
      roughness: 0.78,
      metalness: 0.55
    }),
    wall: new THREE.MeshStandardMaterial({
      ...maps('panel'),
      color: new THREE.Color(0x8b8477).lerp(rust, weathered * 0.4),
      roughness: 0.85,
      metalness: 0.25
    }),
    beam: new THREE.MeshStandardMaterial({
      ...maps('beam'),
      color: new THREE.Color(0x4e4a44).lerp(rust, weathered * 0.6),
      roughness: 0.8,
      metalness: 0.6
    }),
    rust: new THREE.MeshStandardMaterial({
      color: rust,
      roughness: 0.95,
      metalness: 0.3
    }),
    accent: new THREE.MeshStandardMaterial({
      // The one bit of maintained paint anywhere on the sea.
      color: pick(rng, [0xc4531c, 0xc9a227, 0x2f6f8f, 0xb03a2e]),
      roughness: 0.6,
      metalness: 0.2
    }),
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

  const deck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.7, l), mats.deck)
  deck.position.y = DECK_HEIGHT
  deck.castShadow = true
  deck.receiveShadow = true
  retileUVsTriplanar(deck.geometry, 0.35)
  jetty.add(deck)

  // Piles. Spacing is by length so a long jetty gets more, not bigger, legs.
  const rows = Math.max(2, Math.round(l / 7))
  const cols = Math.max(2, Math.round(w / 7))
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const pile = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.6, DECK_HEIGHT + PILE_DEPTH, 6),
        mats.beam
      )
      pile.position.set(
        -w / 2 + (j + 0.5) * (w / cols),
        (DECK_HEIGHT - PILE_DEPTH) / 2,
        -l / 2 + (i + 0.5) * (l / rows)
      )
      pile.castShadow = true
      jetty.add(pile)
    }
  }

  // Fenders and bollards down both long edges — this is where boats come in.
  const fenderCount = Math.max(2, Math.round(l / 9))
  for (let i = 0; i < fenderCount; i++) {
    const fz = -l / 2 + (i + 0.5) * (l / fenderCount)
    for (const sx of [-1, 1]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.28, 5, 9), mats.rust)
      tyre.position.set(sx * (w / 2 + 0.2), DECK_HEIGHT - 1.1, fz)
      tyre.rotation.y = Math.PI / 2
      jetty.add(tyre)
      if (i % 2 === 0) {
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.1, 6), mats.beam)
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

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.wall)
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  retileUVsTriplanar(body.geometry, 0.3)
  shed.add(body)

  // Pitched roof, as two slabs — corrugated sheet over a ridge.
  const pitch = h * 0.28
  for (const sx of [-1, 1]) {
    const slope = new THREE.Mesh(new THREE.BoxGeometry(w * 0.56, 0.25, d * 1.06), mats.plate)
    slope.position.set(sx * w * 0.25, h + pitch * 0.5, 0)
    slope.rotation.z = sx * -Math.atan2(pitch, w * 0.5)
    slope.castShadow = true
    shed.add(slope)
  }

  // Roller door on the long face, and windows if anyone still works here.
  const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, h * 0.6, 0.2), mats.accent)
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
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mats.plate)
    const tx = x + (i - (count - 1) / 2) * r * 2.4
    tank.position.set(tx, DECK_HEIGHT + h / 2, z)
    tank.castShadow = true
    tank.receiveShadow = true
    group.add(tank)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, h * 0.06, 14), mats.rust)
    cap.position.set(tx, DECK_HEIGHT + h, z)
    group.add(cap)
    // Banding, so a plain cylinder reads as riveted plate.
    for (const f of [0.3, 0.65]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.04, 4, 14), mats.beam)
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
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, h, 0.7), mats.beam)
      leg.position.set(sx * 3, h / 2, sz * 3)
      leg.castShadow = true
      crane.add(leg)
    }
  }
  const jib = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, reach), mats.accent)
  jib.position.set(0, h, reach * 0.28)
  jib.castShadow = true
  crane.add(jib)
  const counterweight = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.4), mats.rust)
  counterweight.position.set(0, h, -reach * 0.22)
  crane.add(counterweight)
  // Hook block on its cable.
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h * 0.55, 4), mats.beam)
  cable.position.set(0, h - h * 0.28, reach * 0.42)
  crane.add(cable)
  const hook = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mats.beam)
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
  const geo = new THREE.IcosahedronGeometry(1, 0)
  for (let i = 0; i < segs; i++) {
    const a = start + (i / (segs - 1)) * arc
    // Two staggered rows so it reads as a tipped bank with width, not a line.
    for (const lane of [-1, 1]) {
      if (lane > 0 && rng() < 0.35) continue
      const block = new THREE.Mesh(geo, mats.rust)
      const r = radius * range(rng, 0.97, 1.03) + lane * radius * 0.035
      const s = range(rng, radius * 0.035, radius * 0.07)
      block.position.set(
        Math.cos(a) * r + range(rng, -s, s) * 0.4,
        // Crest just above the swell, troughs awash.
        range(rng, -1.2, 1.6) + SEA_MAX_AMPLITUDE * 0.5,
        Math.sin(a) * r + range(rng, -s, s) * 0.4
      )
      block.scale.set(s, s * range(rng, 0.5, 0.95), s * range(rng, 0.8, 1.25))
      block.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
      block.castShadow = true
      block.receiveShadow = true
      group.add(block)
    }
  }
  // Light on the head of the mole.
  const headA = start + arc
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 7, 6), mats.plate)
  post.position.set(Math.cos(headA) * radius, DECK_HEIGHT + 2.5, Math.sin(headA) * radius)
  group.add(post)
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mats.lamp)
  lamp.position.set(Math.cos(headA) * radius, DECK_HEIGHT + 6.4, Math.sin(headA) * radius)
  lamp.userData.beacon = true
  group.add(lamp)
}

/** Lamp posts down the quay — how a harbour reads at night. */
function addQuayLights(group, mats, positions) {
  for (const [x, z] of positions) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 6, 5), mats.beam)
    post.position.set(x, DECK_HEIGHT + 3, z)
    post.castShadow = true
    group.add(post)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), mats.plate)
    head.position.set(x, DECK_HEIGHT + 6.1, z)
    group.add(head)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 7, 5), mats.lamp)
    lamp.position.set(x, DECK_HEIGHT + 5.85, z)
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
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.16, towerH, size * 0.16),
      mats.wall
    )
    tower.position.set(quayW * 0.3, DECK_HEIGHT + towerH / 2, -quayL * 0.34)
    tower.castShadow = true
    retileUVsTriplanar(tower.geometry, 0.3)
    group.add(tower)
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.22, size * 0.11, size * 0.22),
      mats.glass
    )
    cab.position.set(quayW * 0.3, DECK_HEIGHT + towerH + size * 0.05, -quayL * 0.34)
    group.add(cab)
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(size * 0.26, size * 0.02, size * 0.26),
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
  const crateGeo = new THREE.BoxGeometry(1, 1, 1)
  const drumGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 8)
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
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, size * 0.5, 6), mats.beam)
    mast.position.set(0, DECK_HEIGHT + size * 0.25, -quayL * 0.35)
    mast.castShadow = true
    group.add(mast)
    const light = new THREE.Mesh(new THREE.SphereGeometry(size * 0.035, 8, 6), mats.lamp)
    light.position.set(0, DECK_HEIGHT + size * 0.52, -quayL * 0.35)
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
