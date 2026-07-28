import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBodyCollisions,
  collisionRadiusFor,
  exteriorRadiusFor,
  npcExclusionRadiusFor,
  rockCollisionRadius,
  PORT_EXTERIOR_RADIUS,
  OUTPOST_EXTERIOR_RADIUS
} from './collision.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { islandShorelineToward, islandMaxShoreline } from '../render/islandMesh.js'

test('a harbour undock shell clears its jetties, the approach shell stays tight', () => {
  const port = { kind: 'port', position: [0, 0, 0] }
  assert.equal(collisionRadiusFor(port), 120)
  assert.equal(exteriorRadiusFor(port), PORT_EXTERIOR_RADIUS)
  assert.ok(
    exteriorRadiusFor(port) > collisionRadiusFor(port),
    'leaving a berth must place you clear of the harbour mesh'
  )
})

test('an outpost is a smaller obstruction than a harbour', () => {
  const outpost = { kind: 'outpost', position: [0, 0, 0] }
  assert.equal(collisionRadiusFor(outpost), 40)
  assert.equal(exteriorRadiusFor(outpost), OUTPOST_EXTERIOR_RADIUS)
  assert.ok(exteriorRadiusFor(outpost) < PORT_EXTERIOR_RADIUS)
})

test('an island is solid out to its coastline, not its whole disc', () => {
  // The disc is the volume the shape was generated in; the land inside it can
  // be a fraction of that. Blocking the disc would hold a boat hundreds of
  // metres off a rock it can plainly see.
  const island = { id: 'i-shore', kind: 'island', position: [0, 0, 0], radius: 900 }
  const reach = islandMaxShoreline(island)
  assert.ok(reach > 0 && reach <= 900, `coastline ${reach} should sit inside the disc`)
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
  const shipState = { position: [0, 0, 20], velocity: [0, 0, 50] }
  const shipRadius = 5

  resolveBodyCollisions(shipState, [port], shipRadius)

  const dist = Math.hypot(shipState.position[0], shipState.position[2] - port.position[2])
  assert.ok(Math.abs(dist - 125) < 1e-6, 'hull should sit exactly on the collision circle')
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
