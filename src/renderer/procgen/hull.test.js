import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildHullGeometry } from './hull.js'
import { SHIP_CLASSES } from '../data/shipClasses.js'

/**
 * What makes a hull a hull.
 *
 * The lofter used to sweep a closed super-ellipse, which is a fuselage: round
 * over the top, symmetric about its own centreline, and no amount of deck
 * furniture bolted on afterwards stopped it reading as an aircraft sitting in
 * water. These pin the three properties that fixed it, so nobody has to notice
 * by eye that the sections have gone back to tubes.
 */

function sample(limit = 24) {
  // Spread across the roster rather than taking the first N, which would all be
  // the same role.
  const step = Math.max(1, Math.floor(SHIP_CLASSES.length / limit))
  return SHIP_CLASSES.filter((_, i) => i % step === 0).slice(0, limit)
}

/**
 * The bare hull, without sponsons and rubbing strakes.
 *
 * Those are flat slabs bolted on at a station — they stand outboard of the deck
 * and hang below the bottom, so leaving them in makes a hull look both wider at
 * the rail and blunter at the keel than its sections actually are. What is
 * under test here is the section shape.
 */
function bareHull(cls) {
  return buildHullGeometry({ ...cls.hull, wings: [] })
}

/**
 * Vertices in a thin slice at a fraction along the hull.
 *
 * Every measurement here is per-station rather than over the whole hull,
 * because the sheer line means the globally highest point of a boat is one
 * corner of the stemhead — measuring against that says nothing about whether
 * there is a deck amidships.
 */
function stationSlice(geometry, hull, frac) {
  const pos = geometry.getAttribute('position')
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < pos.count; i++) {
    minZ = Math.min(minZ, pos.getZ(i))
    maxZ = Math.max(maxZ, pos.getZ(i))
  }
  const at = minZ + (maxZ - minZ) * frac
  const band = (maxZ - minZ) * 0.06
  const verts = []
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getZ(i) - at) <= band) {
      verts.push([pos.getX(i), pos.getY(i), pos.getZ(i)])
    }
  }
  return verts
}

test('every hull has a flat deck spanning most of its beam', () => {
  // The tube test. A lofted ellipse has exactly one highest point per station,
  // so its "deck" is a ridge down the centreline — a boat's is a surface you
  // could stand on, running out to both rails.
  for (const cls of sample()) {
    const verts = stationSlice(bareHull(cls), cls.hull, 0.45)
    assert.ok(verts.length > 6, `${cls.id}: no midship section found`)
    const top = Math.max(...verts.map((v) => v[1]))
    const depth = top - Math.min(...verts.map((v) => v[1]))
    const onDeck = verts.filter((v) => v[1] > top - depth * 0.14)
    const spread = Math.max(...onDeck.map((v) => v[0])) - Math.min(...onDeck.map((v) => v[0]))
    const beam = Math.max(...verts.map((v) => v[0])) - Math.min(...verts.map((v) => v[0]))
    assert.ok(
      spread > beam * 0.75,
      `${cls.id}: deck spans ${spread.toFixed(2)} of a ${beam.toFixed(2)} beam — that is a ridge, not a deck`
    )
  }
})

test('every hull narrows toward the keel', () => {
  // A boat sits on something. The bottom does not have to come to a point — a
  // barge is nearly flat — but it must be appreciably narrower than the deck,
  // which is what a symmetric tube never is.
  for (const cls of sample()) {
    const verts = stationSlice(bareHull(cls), cls.hull, 0.45)
    const lo = Math.min(...verts.map((v) => v[1]))
    const hi = Math.max(...verts.map((v) => v[1]))
    const depth = hi - lo
    const halfAt = (yFrac, tol = 0.1) => {
      const y = lo + depth * yFrac
      const near = verts.filter((v) => Math.abs(v[1] - y) < depth * tol)
      return near.length ? Math.max(...near.map((v) => Math.abs(v[0]))) : 0
    }
    const keel = halfAt(0.04)
    const deck = halfAt(0.98)
    assert.ok(deck > 0, `${cls.id}: no deck-level section found`)
    assert.ok(
      keel < deck * 0.9,
      `${cls.id}: bottom is ${(keel / deck).toFixed(2)} of the deck beam — no keel, that is a tube`
    )
  }
})

test('the stem rakes forward of the forefoot', () => {
  // The bow's deck stands ahead of the keel below it. Without the rake the
  // stem is a vertical cliff and the whole boat looks milled from a block.
  for (const cls of sample(12)) {
    const verts = stationSlice(bareHull(cls), cls.hull, 0.97)
    assert.ok(verts.length > 4, `${cls.id}: no bow section found`)
    const lo = Math.min(...verts.map((v) => v[1]))
    const hi = Math.max(...verts.map((v) => v[1]))
    const mid = (lo + hi) / 2
    const meanZ = (rows) => rows.reduce((a, v) => a + v[2], 0) / rows.length
    const upper = verts.filter((v) => v[1] >= mid)
    const lower = verts.filter((v) => v[1] < mid)
    assert.ok(
      meanZ(upper) > meanZ(lower),
      `${cls.id}: stemhead at z=${meanZ(upper).toFixed(2)} sits behind the forefoot at ${meanZ(lower).toFixed(2)}`
    )
  }
})

test('hull proportions stay in boat territory, not aircraft', () => {
  const box = new THREE.Box3()
  for (const cls of sample()) {
    box.setFromBufferAttribute(bareHull(cls).getAttribute('position'))
    const size = box.getSize(new THREE.Vector3())
    const lengthToBeam = size.z / size.x
    assert.ok(
      lengthToBeam > 1.8 && lengthToBeam < 11,
      `${cls.id}: length/beam ${lengthToBeam.toFixed(1)} is not a vessel`
    )
    assert.ok(size.y < size.z, `${cls.id} is deeper than it is long`)
  }
})

test('deck line sheers up at bow and stern', () => {
  // A boat's deck is lowest around the working midships and lifts toward the
  // stem (and a little at the counter). Space-era station bands tapered the
  // ends so hard the deck *dropped* there — pin the opposite.
  for (const cls of sample()) {
    const h = cls.hull.stationHeights
    const oy = cls.hull.stationOffsetsY ?? h.map(() => 0)
    const deck = h.map((hh, i) => hh + oy[i])
    const a = Math.floor(h.length * 0.3)
    const b = Math.ceil(h.length * 0.7)
    let work = deck[a]
    for (let i = a; i <= b; i++) work = Math.min(work, deck[i])
    const bowRise = deck[deck.length - 1] - work
    const aftRise = deck[0] - work
    assert.ok(
      bowRise > work * 0.08,
      `${cls.id}: bow deck only ${bowRise.toFixed(2)} above mid (${work.toFixed(2)}) — no sheer`
    )
    assert.ok(
      aftRise > -work * 0.02,
      `${cls.id}: transom deck ${aftRise.toFixed(2)} below mid — stern droops`
    )
  }
})
