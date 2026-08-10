import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearPositionOfBodies,
  positionOverlapsBodies,
  spawnPointNearBody,
  spawnNpcWithClass,
  spawnAmbientTraffic,
  replenishAmbientTraffic,
  AMBIENT_TRAFFIC_COUNT,
  NPC_SPAWN_SHIP_RADIUS,
  NPC_SPAWN_CLEARANCE
} from './spawner.js'
import { collisionRadiusFor, npcExclusionRadiusFor } from './collision.js'
import { mulberry32 } from '../procgen/prng.js'

const island = (id, position, radius) => ({ kind: 'island', id, position, radius })
const flatDist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])

test('clearPositionOfBodies pushes a point out of an island', () => {
  const rock = island('i1', [0, 0, 0], 1000)
  const aground = [10, 0, 0]
  assert.equal(positionOverlapsBodies(aground, [rock]), true)
  const clear = clearPositionOfBodies(aground, [rock])
  // Islands are solid to their coastline, not their generated disc — see
  // render/islandMesh.js.
  const need = npcExclusionRadiusFor(rock) + NPC_SPAWN_SHIP_RADIUS + NPC_SPAWN_CLEARANCE
  assert.ok(flatDist(clear, [0, 0, 0]) >= need - 1e-6)
  assert.equal(positionOverlapsBodies(clear, [rock]), false)
})

test('clearing keeps everything on the water — it never lifts a hull over a rock', () => {
  const rock = island('i1', [0, 0, 0], 1000)
  const clear = clearPositionOfBodies([10, 0, 0], [rock])
  assert.equal(clear[1], 0, 'the sea owns Y; clearing must not use altitude to escape')
})

test('riding a crest does not let a boat clear an island', () => {
  // A vertical term in the overlap test would read wave bob as separation and
  // let hulls "pass over" a rock they are actually sitting on.
  const rock = island('i1', [0, 0, 0], 1000)
  assert.equal(positionOverlapsBodies([10, 3.5, 0], [rock]), true)
})

test('spawnPointNearBody never sits inside the host', () => {
  const rng = mulberry32(42)
  const rock = island('i1', [500, 0, -200], 2500)
  const port = { kind: 'port', id: 'p1', position: [500, 0, 500], radius: null }
  for (let i = 0; i < 20; i++) {
    const pos = spawnPointNearBody(rng, rock, [rock, port])
    assert.equal(positionOverlapsBodies(pos, [rock, port]), false)
    assert.ok(
      flatDist(pos, rock.position) >=
        npcExclusionRadiusFor(rock) + NPC_SPAWN_SHIP_RADIUS + NPC_SPAWN_CLEARANCE - 1e-6
    )
    assert.equal(pos[1], 0, 'spawn points are afloat')
  }
})

test('spawnNpcWithClass clears the body it was asked to spawn inside', () => {
  const rock = island('i1', [0, 0, 0], 800)
  const npc = spawnNpcWithClass(mulberry32(7), {
    shipClassId: 'raider_mk1',
    position: [0, 0, 0],
    faction: 'pirate',
    bodies: [rock]
  })
  assert.equal(positionOverlapsBodies(npc.position, [rock]), false)
  const need = collisionRadiusFor(rock) + NPC_SPAWN_SHIP_RADIUS + NPC_SPAWN_CLEARANCE
  assert.ok(flatDist(npc.position, [0, 0, 0]) >= need - 1e-6)
  assert.equal(npc.position[1], 0, 'a spawned boat starts afloat')
})

test('spawned NPCs always receive a readable pilot name', () => {
  const npc = spawnNpcWithClass(mulberry32(9), {
    shipClassId: 'raider_mk1',
    position: [0, 0, 0],
    faction: 'alien',
    species: { id: 'faction-1', name: 'Krova', leader: 'Mira Vale' }
  })
  assert.equal(npc.pilotName, 'Mira Vale')
  assert.equal(typeof npc.pilotName, 'string')
  assert.doesNotMatch(npc.pilotName, /\[object Object\]/)
})

test('wreck fields are not solid, so nothing is pushed out of one', () => {
  const field = { kind: 'wreckField', id: 'wf1', position: [0, 0, 0], radius: 300 }
  assert.equal(positionOverlapsBodies([0, 0, 0], [field]), false)
  assert.deepEqual(clearPositionOfBodies([0, 0, 0], [field]), [0, 0, 0])
})

test('ambient traffic is spread across open water and given hub destinations', () => {
  const bodies = [
    { kind: 'port', id: 'port-a', position: [0, 0, 0], radius: null },
    { kind: 'outpost', id: 'outpost-b', position: [4000, 0, -2500], radius: null },
    island('island-a', [1200, 0, 900], 500)
  ]
  const traffic = spawnAmbientTraffic(mulberry32(11), bodies, 40)
  assert.equal(traffic.length, 40)
  assert.ok(traffic.every((npc) => npc.ambientTraffic && npc.faction === 'trader'))
  assert.ok(traffic.every((npc) => ['port-a', 'outpost-b'].includes(npc.tradeDestinationId)))
  assert.ok(traffic.every((npc) => !positionOverlapsBodies(npc.position, bodies)))
  assert.ok(new Set(traffic.map((npc) => `${npc.position[0]}:${npc.position[2]}`)).size > 35)
})

test('ambient traffic replenishes only the civilian population shortfall', () => {
  const bodies = [
    { kind: 'port', id: 'port-a', position: [0, 0, 0], radius: null },
    { kind: 'outpost', id: 'outpost-b', position: [4000, 0, -2500], radius: null }
  ]
  const traffic = spawnAmbientTraffic(mulberry32(12), bodies, 5)
  traffic[0].destroyed = true
  const gameState = { npcs: traffic }
  const added = replenishAmbientTraffic(mulberry32(13), gameState, bodies, 5)
  assert.equal(added.length, 1)
  assert.equal(gameState.npcs.filter((npc) => npc.ambientTraffic && !npc.destroyed).length, 5)
  assert.equal(AMBIENT_TRAFFIC_COUNT, 400)
})
