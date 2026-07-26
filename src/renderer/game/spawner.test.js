import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearPositionOfBodies,
  positionOverlapsBodies,
  spawnPointNearBody,
  spawnNpcWithClass,
  NPC_SPAWN_SHIP_RADIUS,
  NPC_SPAWN_CLEARANCE
} from './spawner.js'
import { collisionRadiusFor } from './collision.js'
import { mulberry32 } from '../procgen/prng.js'

test('clearPositionOfBodies pushes a point out of a planet shell', () => {
  const planet = { kind: 'planet', id: 'p1', position: [0, 0, 0], radius: 1000 }
  const buried = [10, 0, 0]
  assert.equal(positionOverlapsBodies(buried, [planet]), true)
  const clear = clearPositionOfBodies(buried, [planet])
  const need = 1000 + NPC_SPAWN_SHIP_RADIUS + NPC_SPAWN_CLEARANCE
  const d = Math.hypot(clear[0], clear[1], clear[2])
  assert.ok(d >= need - 1e-6, `expected dist ${d} >= ${need}`)
  assert.equal(positionOverlapsBodies(clear, [planet]), false)
})

test('spawnPointNearBody never sits inside the host body', () => {
  const rng = mulberry32(42)
  const planet = { kind: 'planet', id: 'p1', position: [500, 0, -200], radius: 2500 }
  const station = { kind: 'station', id: 's1', position: [500, 0, 500], radius: null }
  for (let i = 0; i < 20; i++) {
    const pos = spawnPointNearBody(rng, planet, [planet, station])
    assert.equal(positionOverlapsBodies(pos, [planet, station]), false)
    const dPlanet = Math.hypot(
      pos[0] - planet.position[0],
      pos[1] - planet.position[1],
      pos[2] - planet.position[2]
    )
    assert.ok(dPlanet >= planet.radius + NPC_SPAWN_SHIP_RADIUS + NPC_SPAWN_CLEARANCE - 1e-6)
  }
})

test('spawnNpcWithClass clears body centers when bodies are provided', () => {
  const planet = { kind: 'planet', id: 'p1', position: [0, 0, 0], radius: 800 }
  const npc = spawnNpcWithClass(mulberry32(7), {
    shipClassId: 'raider_mk1',
    position: [0, 0, 0],
    faction: 'pirate',
    bodies: [planet]
  })
  assert.equal(positionOverlapsBodies(npc.position, [planet]), false)
  const need = collisionRadiusFor(planet) + NPC_SPAWN_SHIP_RADIUS + NPC_SPAWN_CLEARANCE
  assert.ok(Math.hypot(...npc.position) >= need - 1e-6)
})
