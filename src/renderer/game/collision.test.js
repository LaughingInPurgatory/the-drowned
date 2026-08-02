import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBodyCollisions,
  resolveShipCollisions,
  collisionRadiusFor,
  exteriorRadiusFor,
  npcExclusionRadiusFor,
  rockCollisionRadius,
  PORT_EXTERIOR_RADIUS,
  OUTPOST_EXTERIOR_RADIUS,
  SHIP_BOUNCE_SPEED
} from './collision.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { islandShorelineToward, islandMaxShoreline } from '../render/islandMesh.js'

test('a harbour undock shell clears its jetties, the approach shell stays tight', () => {
  const port = { kind: 'port', position: [0, 0, 0] }
  assert.equal(collisionRadiusFor(port), 28)
  assert.equal(exteriorRadiusFor(port), PORT_EXTERIOR_RADIUS)
  assert.ok(
    exteriorRadiusFor(port) > collisionRadiusFor(port),
    'leaving a berth must place you clear of the harbour mesh'
  )
})

test('an outpost is a smaller obstruction than a harbour', () => {
  const outpost = { kind: 'outpost', position: [0, 0, 0] }
  assert.equal(collisionRadiusFor(outpost), 12)
  assert.equal(exteriorRadiusFor(outpost), OUTPOST_EXTERIOR_RADIUS)
  assert.ok(exteriorRadiusFor(outpost) < PORT_EXTERIOR_RADIUS)
})

test('an island is solid out to its coastline, not its whole disc', () => {
  // The disc is the volume the shape was generated in; the land inside it can
  // be a fraction of that. Blocking the disc would hold a boat hundreds of
  // metres off a rock it can plainly see. The shaped coastline can extend
  // beyond the nominal disc radius on a headland.
  const island = { id: 'i-shore', kind: 'island', position: [0, 0, 0], radius: 900 }
  const reach = islandMaxShoreline(island)
  assert.ok(reach > 0 && reach <= island.radius * 1.2, `coastline ${reach} should stay within the shaped island`)
  assert.equal(collisionRadiusFor(island), reach)
  assert.equal(exteriorRadiusFor(island), reach)
  assert.equal(npcExclusionRadiusFor(island), reach)
})

test('the coastline varies with bearing, so you can nose into a bay', () => {
  const island = { id: 'i-bay', kind: 'island', position: [0, 0, 0], radius: 900 }
  const samples = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    samples.push(islandShorelineToward(island, Math.cos(a) * 1000, Math.sin(a) * 1000))
  }
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  assert.ok(max - min > 1, 'a coastline that is the same on every bearing is a circle')
})

test('grounding uses the coastline on the bearing you approach from', () => {
  const island = { id: 'i-ground', kind: 'island', position: [0, 0, 0], radius: 900 }
  const shipRadius = 5
  // Come in from due east and drive at the middle.
  const shipState = { position: [40, 0, 0], velocity: [-60, 0, 0] }
  resolveBodyCollisions(shipState, [island], shipRadius)
  const shore = islandShorelineToward(island, shipState.position[0], shipState.position[2])
  const dist = Math.hypot(shipState.position[0], shipState.position[2])
  assert.ok(Math.abs(dist - (shore + shipRadius)) < 1e-3, 'should rest exactly on the beach')
  assert.ok(shipState.velocity[0] >= 0, 'way driving into the shore must be cancelled')
})

test('running onto a shore sheers the hull off it and kills the way into it', () => {
  const port = { kind: 'port', position: [0, 0, 100] }
  const shipState = { position: [0, 0, 70], velocity: [0, 0, 50] }
  const shipRadius = 5

  resolveBodyCollisions(shipState, [port], shipRadius)

  const dist = Math.hypot(shipState.position[0], shipState.position[2] - port.position[2])
  assert.ok(Math.abs(dist - 33) < 1e-6, 'hull should sit exactly on the tight harbour collision circle')
  assert.ok(shipState.velocity[2] <= 0, 'way driving into it must be cancelled')
})

test('grounding never lifts the hull off the water', () => {
  // The sea owns Y (world/sea.js snapToSea). A collision that nudged Y would
  // fight the buoyancy clamp and make the boat judder against every shore.
  const island = { id: 'i-y', kind: 'island', position: [0, 0, 100], radius: 200 }
  const shipState = { position: [0, 1.7, 0], velocity: [0, 0, 50] }
  resolveBodyCollisions(shipState, [island], 5)
  assert.equal(shipState.position[1], 1.7, 'collision must not touch Y')
  assert.equal(shipState.velocity[1], 0)
})

test('a hull well clear of everything is left alone', () => {
  const island = { id: 'i-far', kind: 'island', position: [0, 0, 5000], radius: 200 }
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 10] }
  resolveBodyCollisions(shipState, [island], 5)
  assert.deepEqual(shipState.position, [0, 0, 0])
  assert.deepEqual(shipState.velocity, [0, 0, 10])
})

test('way carried along a shore is kept — only the inward component goes', () => {
  const port = { kind: 'port', position: [0, 0, 0] }
  const shipState = { position: [122, 0, 0], velocity: [0, 0, 30] }
  resolveBodyCollisions(shipState, [port], 5)
  assert.deepEqual(shipState.velocity, [0, 0, 30], 'velocity along the shore is untouched')
})

test('kinds with no collision radius are skipped safely', () => {
  const weird = { kind: 'unknown', position: [0, 0, 0] }
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 1] }
  resolveBodyCollisions(shipState, [weird], 5)
  assert.deepEqual(shipState.position, [0, 0, 0])
})

test('wreck fields have no whole-field shell — you sail into them', () => {
  const field = { id: 'wf-1', kind: 'wreckField', position: [0, 0, 0], radius: 100 }
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 20] }
  resolveBodyCollisions(shipState, [field], 5)
  const dist = Math.hypot(shipState.position[0], shipState.position[2])
  assert.ok(dist < 50, `should not bounce off the field extent (dist=${dist})`)
})

test('harbour breakwater rocks collide individually without making a solid ring', () => {
  const port = {
    kind: 'port',
    position: [0, 0, 0],
    breakwaterRocks: [{ x: 40, z: 0, radius: 4 }]
  }
  const shipState = { position: [40, 0, 0], velocity: [-10, 0, 0] }
  resolveBodyCollisions(shipState, [port], 2)
  assert.ok(Math.abs(shipState.position[0] - 46) < 1e-6, 'rock should push the hull clear')
  assert.ok(shipState.velocity[0] >= 0, 'rock contact should cancel inward way')

  const gapState = { position: [0, 0, 34], velocity: [0, 0, 1] }
  resolveBodyCollisions(gapState, [port], 2)
  assert.ok(Math.abs(gapState.position[2] - 34) < 1e-6, 'open water between quay and mole should stay open')
})

test('wreck fields push the hull off an individual hulk', () => {
  const field = { id: 'wf-collide', kind: 'wreckField', position: [1000, 0, 0], radius: 80 }
  const rocks = getAsteroidRocks(field)
  assert.ok(rocks.length > 0)
  const rock = rocks[0]
  const cx = field.position[0] + rock.position[0]
  const cz = field.position[2] + rock.position[2]
  const shipState = { position: [cx, 0, cz], velocity: [10, 0, 0] }
  resolveBodyCollisions(shipState, [field], 2)
  const dist = Math.hypot(shipState.position[0] - cx, shipState.position[2] - cz)
  assert.ok(dist > 0, 'a hull buried in a hulk must be pushed clear of it')
})

test('overlapping ships are pushed apart without damage fields', () => {
  const a = { position: [0, 1.5, 0], velocity: [0, 0, 0], hull: 100 }
  const b = { position: [2, 1.5, 0], velocity: [0, 0, 0], hull: 100 }
  resolveShipCollisions([
    { ship: a, radius: 5 },
    { ship: b, radius: 5 }
  ])
  const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])
  assert.ok(Math.abs(dist - 10) < 1e-5, `should rest exactly on each other (dist=${dist})`)
  assert.equal(a.hull, 100)
  assert.equal(b.hull, 100)
  assert.equal(a.position[1], 1.5, 'Y is the sea’s — do not lift on impact')
})

test('ship collision callback reports an actual hull contact once', () => {
  const a = { position: [0, 0, 0], velocity: [0, 0, 0] }
  const b = { position: [2, 0, 0], velocity: [0, 0, 0] }
  const contacts = []
  resolveShipCollisions([{ ship: a, radius: 5 }, { ship: b, radius: 5 }], (first, second) => {
    contacts.push([first.ship, second.ship])
  })
  assert.deepEqual(contacts, [[a, b]])
})

test('a slow scrape kills the closing way (ships stop into each other)', () => {
  const a = { position: [0, 0, 0], velocity: [4, 0, 0] } // closing under bounce threshold
  const b = { position: [8, 0, 0], velocity: [-4, 0, 0] }
  assert.ok(4 + 4 < SHIP_BOUNCE_SPEED * 2 || 8 < SHIP_BOUNCE_SPEED + 1)
  resolveShipCollisions([
    { ship: a, radius: 5 },
    { ship: b, radius: 5 }
  ])
  // Relative normal velocity should be nearly zero / separating, not still closing hard.
  const vrel = a.velocity[0] - b.velocity[0]
  assert.ok(vrel >= -0.5, `slow contact should stop the close (vrel=${vrel})`)
  assert.ok(a.velocity[0] < 4, 'A should lose way into B')
  assert.ok(b.velocity[0] > -4, 'B should lose way into A')
})

test('a hard hit bounces the hulls apart', () => {
  const a = { position: [0, 0, 0], velocity: [30, 0, 0] }
  const b = { position: [8, 0, 0], velocity: [-30, 0, 0] }
  resolveShipCollisions([
    { ship: a, radius: 5 },
    { ship: b, radius: 5 }
  ])
  // After a bounce, A should be going left-ish and B right-ish (reversed).
  assert.ok(a.velocity[0] < 0, `A should rebound (vx=${a.velocity[0]})`)
  assert.ok(b.velocity[0] > 0, `B should rebound (vx=${b.velocity[0]})`)
  const dist = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])
  assert.ok(dist >= 10 - 1e-5, 'still separated after bounce')
})

test('ships that are clear of each other are left alone', () => {
  const a = { position: [0, 0, 0], velocity: [5, 0, 0] }
  const b = { position: [100, 0, 0], velocity: [-5, 0, 0] }
  resolveShipCollisions([
    { ship: a, radius: 5 },
    { ship: b, radius: 5 }
  ])
  assert.deepEqual(a.position, [0, 0, 0])
  assert.deepEqual(a.velocity, [5, 0, 0])
  assert.deepEqual(b.position, [100, 0, 0])
  assert.deepEqual(b.velocity, [-5, 0, 0])
})
