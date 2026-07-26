import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveBodyCollisions,
  trySupercruiseTunnel,
  collisionRadiusFor,
  exteriorRadiusFor,
  rockCollisionRadius,
  STATION_EXTERIOR_RADIUS,
  SETTLEMENT_EXTERIOR_RADIUS
} from './collision.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'

test('station exterior shell is far larger than tight flight collision (undock clearance)', () => {
  const station = { kind: 'station', position: [0, 0, 0] }
  assert.equal(collisionRadiusFor(station), 500)
  assert.equal(exteriorRadiusFor(station), STATION_EXTERIOR_RADIUS)
  assert.ok(
    exteriorRadiusFor(station) > collisionRadiusFor(station) * 4,
    'undock shell must clear visual bulk well beyond the 500m fly-in sphere'
  )
})

test('settlement exterior shell clears mesh while flight collision stays modest', () => {
  const settlement = { kind: 'settlement', position: [0, 0, 0] }
  assert.equal(collisionRadiusFor(settlement), 72)
  assert.equal(exteriorRadiusFor(settlement), SETTLEMENT_EXTERIOR_RADIUS)
  assert.ok(exteriorRadiusFor(settlement) > collisionRadiusFor(settlement))
})

test('exteriorRadiusFor falls back to body radius for planets', () => {
  const planet = { kind: 'planet', position: [0, 0, 0], radius: 900 }
  assert.equal(exteriorRadiusFor(planet), 900)
  assert.equal(exteriorRadiusFor(planet), collisionRadiusFor(planet))
})

test('flying into a planet pushes the ship back to the surface and cancels inward velocity', () => {
  const planet = { kind: 'planet', position: [0, 0, 100], radius: 20 }
  const shipState = { position: [0, 0, 85], velocity: [0, 0, 50] }
  const shipRadius = 5

  resolveBodyCollisions(shipState, [planet], shipRadius)

  const dist = Math.hypot(...shipState.position.map((v, i) => v - planet.position[i]))
  assert.ok(Math.abs(dist - (planet.radius + shipRadius)) < 1e-6, 'ship should sit exactly at the collision surface')
  assert.ok(shipState.velocity[2] <= 0, 'velocity flying into the planet should be cancelled, not pass through')
})

test('a ship well clear of every body is left untouched', () => {
  const planet = { kind: 'planet', position: [0, 0, 1000], radius: 20 }
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 10] }
  resolveBodyCollisions(shipState, [planet], 5)
  assert.deepEqual(shipState.position, [0, 0, 0])
  assert.deepEqual(shipState.velocity, [0, 0, 10])
})

test('sliding tangent to a body is not affected (only the inward component is cancelled)', () => {
  const planet = { kind: 'planet', position: [0, 0, 0], radius: 20 }
  const shipState = { position: [22, 0, 0], velocity: [0, 0, 30] }
  resolveBodyCollisions(shipState, [planet], 5)
  assert.deepEqual(shipState.velocity, [0, 0, 30], 'velocity tangential to the surface should be untouched')
})

test('kinds without a defined collision radius (e.g. asteroid fields missing radius) are skipped safely', () => {
  const weird = { kind: 'unknown', position: [0, 0, 0] }
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 1] }
  resolveBodyCollisions(shipState, [weird], 5)
  assert.deepEqual(shipState.position, [0, 0, 0])
})

test('asteroid fields do not use a whole-field collision shell', () => {
  // Field center with large body.radius — ship inside the scatter extent but
  // not necessarily on a rock. Must not be pushed to the field surface.
  const field = {
    id: 'belt-1',
    kind: 'asteroidField',
    position: [0, 0, 0],
    radius: 100
  }
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 20] }
  resolveBodyCollisions(shipState, [field], 5)
  // Either still at origin (no rock at center) or pushed off a rock — never
  // to the field shell (radius 100 + ship 5 = 105).
  const dist = Math.hypot(...shipState.position)
  assert.ok(dist < 50, `should not bounce off field shell (dist=${dist})`)
})

test('asteroid fields push the ship off an individual rock', () => {
  const field = {
    id: 'belt-collide',
    kind: 'asteroidField',
    position: [1000, 0, 0],
    radius: 80
  }
  const rocks = getAsteroidRocks(field)
  assert.ok(rocks.length > 0)
  const rock = rocks[0]
  const cx = field.position[0] + rock.position[0]
  const cy = field.position[1] + rock.position[1]
  const cz = field.position[2] + rock.position[2]
  // Bury the ship inside the first rock.
  const shipState = { position: [cx, cy, cz], velocity: [10, 0, 0] }
  resolveBodyCollisions(shipState, [field], 2)
  const dist = Math.hypot(
    shipState.position[0] - cx,
    shipState.position[1] - cy,
    shipState.position[2] - cz
  )
  const need = rockCollisionRadius(rock) + 2
  assert.ok(dist >= need - 1e-3, `ship should sit outside rock (dist=${dist}, need=${need})`)
})

test('supercruise tunnel exits the far side of a body along travel direction', () => {
  const planet = { id: 'p1', kind: 'planet', position: [0, 0, 100], radius: 40 }
  const shipState = {
    position: [0, 0, 70],
    velocity: [0, 0, 80],
    quaternion: [0, 0, 0, 1]
  }
  const event = trySupercruiseTunnel(shipState, [planet], 5)
  assert.ok(event, 'should tunnel when overlapping')
  assert.ok(shipState.position[2] > planet.position[2], 'exit should be past the body center')
  const dist = Math.hypot(...shipState.position.map((v, i) => v - planet.position[i]))
  assert.ok(dist >= planet.radius + 5, 'exit should clear the collision shell')
})

test('supercruise tunnel ignores the destination body', () => {
  const planet = { id: 'dest', kind: 'planet', position: [0, 0, 100], radius: 40 }
  const shipState = { position: [0, 0, 70], velocity: [0, 0, 80], quaternion: [0, 0, 0, 1] }
  const event = trySupercruiseTunnel(shipState, [planet], 5, 'dest')
  assert.equal(event, null)
  assert.deepEqual(shipState.position, [0, 0, 70])
})

test('supercruise tunnel ignores explicit host body ids (surface settlement parent)', () => {
  const planet = { id: 'host', kind: 'planet', position: [0, 0, 100], radius: 40 }
  const shipState = { position: [0, 0, 70], velocity: [0, 0, 80], quaternion: [0, 0, 0, 1] }
  const event = trySupercruiseTunnel(shipState, [planet], 5, 'settlement', new Set(['host']))
  assert.equal(event, null)
  assert.deepEqual(shipState.position, [0, 0, 70])
})
