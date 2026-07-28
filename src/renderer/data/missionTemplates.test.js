import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../procgen/prng.js'
import { createGameState } from '../game/state.js'
import { TEST_WORLD_OPTS } from '../procgen/world.js'
import { acceptMission, dropMission, finishMission } from '../game/missions.js'
import { STARTER_SHIP_CLASS_ID } from './shipClasses.js'
import {
  generateBountyMission,
  generateExplorationMission,
  generateInvestigationMission,
  generateProbeMission,
  generateMissionsForBody,
  refillMissionsIfExhausted,
  seedMissionsForGalaxy
} from './missionTemplates.js'

function freshState(seed = 42) {
  return createGameState({
    characterName: 'Pilot',
    shipInstanceName: 'Ship',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed,
    galaxyOpts: TEST_WORLD_OPTS
  })
}

function missionBody(gs) {
  // Prefer a body that actually received a board seed.
  const withBoard = gs.missions.available[0]?.giverStationId
  if (withBoard) {
    for (const system of gs.galaxy.systems) {
      const body = system.bodies.find((b) => b.id === withBoard)
      if (body) return { system, body }
    }
  }
  for (const system of gs.galaxy.systems) {
    const body = system.bodies.find((b) => b.hasMissions)
    if (body) return { system, body }
  }
  return null
}

test('mission ids never collide across separate generation batches (simulated app restart)', () => {
  // The whole galaxy's initial board (seedMissionsForGalaxy) and a later
  // board refill after loading a save used to share one in-memory counter
  // that reset to 0 on every app launch — a refill during a loaded session
  // could then hand out an id that was already baked into that save,
  // corrupting whichever mission acceptMission's id lookup found first.
  // Ids must stay unique regardless of how many times generation "restarts".
  const gs = freshState(11)
  const original = [...gs.missions.available]
  const { system, body } = missionBody(gs)
  const rebooted = generateMissionsForBody(mulberry32(1), gs.galaxy, system.id, body.id, 3)
  const ids = new Set(original.map((m) => m.id))
  for (const m of rebooted) {
    assert.ok(!ids.has(m.id), `id collision: ${m.id}`)
    ids.add(m.id)
  }
})

test('missions never target an anomaly-owned synthetic body', () => {
  // Anomaly sites (e.g. a Rare Ore Deposit) register a synthetic asteroidField
  // body directly into system.bodies (see systemScan.js), tagged anomalySiteId,
  // so mining/targeting reuse the normal pipeline — but it can vanish on the
  // next epoch reshuffle, and anomalies should only ever be found by scanning.
  const gs = freshState(3)
  const { system, body: giverBody } = missionBody(gs)
  const decoy = {
    id: 'decoy-anomaly-field',
    name: 'Rare Ore Deposit',
    kind: 'wreckField',
    position: [1000, 0, 500],
    radius: 260,
    anomalySiteId: 'anomaly-test'
  }
  system.bodies.push(decoy)

  const generators = [generateBountyMission, generateExplorationMission, generateInvestigationMission, generateProbeMission]
  for (let seed = 0; seed < 100; seed++) {
    const rng = mulberry32(seed)
    for (const gen of generators) {
      const mission = gen(rng, gs.galaxy, system.id, giverBody.id)
      if (!mission) continue
      assert.notEqual(mission.target?.bodyId, decoy.id)
      assert.ok(!mission.title?.includes(decoy.name), `title referenced the anomaly body: ${mission.title}`)
    }
  }
})

test('generateMissionsForBody posts 1–3 contracts for a mission body', () => {
  const gs = freshState(7)
  const hit = missionBody(gs)
  assert.ok(hit, 'need a hasMissions body')
  const missions = generateMissionsForBody(mulberry32(99), gs.galaxy, hit.system.id, hit.body.id)
  assert.ok(missions.length >= 1 && missions.length <= 3)
  assert.ok(missions.every((m) => m.giverStationId === hit.body.id))
  assert.ok(missions.every((m) => m.status === 'available'))
})

test('refillMissionsIfExhausted does nothing while the board still has work', () => {
  const gs = freshState(11)
  const hit = missionBody(gs)
  assert.ok(hit)
  const before = gs.missions.available.filter((m) => m.giverStationId === hit.body.id)
  assert.ok(before.length > 0, 'seeded board should have missions')
  const added = refillMissionsIfExhausted(gs, hit.body.id, mulberry32(1))
  assert.equal(added.length, 0)
  assert.equal(
    gs.missions.available.filter((m) => m.giverStationId === hit.body.id).length,
    before.length
  )
})

test('refillMissionsIfExhausted waits while active missions from that body remain', () => {
  const gs = freshState(13)
  const hit = missionBody(gs)
  assert.ok(hit)
  const board = gs.missions.available.filter((m) => m.giverStationId === hit.body.id)
  // Strip board and leave one accepted active contract.
  gs.missions.available = gs.missions.available.filter((m) => m.giverStationId !== hit.body.id)
  gs.missions.available.push(board[0])
  acceptMission(gs, board[0].id, Math.random)
  assert.equal(gs.missions.available.filter((m) => m.giverStationId === hit.body.id).length, 0)
  assert.ok(gs.missions.active.some((m) => m.giverStationId === hit.body.id))

  const blocked = refillMissionsIfExhausted(gs, hit.body.id, mulberry32(5))
  assert.equal(blocked.length, 0, 'must not refill while active contracts remain')
})

test('accepting every available contract never restocks until complete/drop', () => {
  const gs = freshState(41)
  const hit = missionBody(gs)
  assert.ok(hit)
  const bodyId = hit.body.id
  // Accept the entire board one by one; refill after each accept must be empty.
  for (let guard = 0; guard < 10; guard++) {
    const board = gs.missions.available.filter((m) => String(m.giverStationId) === String(bodyId))
    if (!board.length) break
    acceptMission(gs, board[0].id, Math.random)
    const added = refillMissionsIfExhausted(gs, bodyId, mulberry32(guard + 3))
    assert.equal(added.length, 0, `accept step ${guard}: board must not restock`)
  }
  assert.ok(gs.missions.active.some((m) => String(m.giverStationId) === String(bodyId)))
  assert.equal(
    gs.missions.available.filter((m) => String(m.giverStationId) === String(bodyId)).length,
    0
  )
})

test('refillMissionsIfExhausted rolls a new board only after complete or drop of all contracts', () => {
  const gs = freshState(17)
  const hit = missionBody(gs)
  assert.ok(hit)
  const board = gs.missions.available.filter((m) => m.giverStationId === hit.body.id)
  // Leave a single mission, accept it, then drop — fully exhaust that body.
  gs.missions.available = gs.missions.available.filter((m) => m.giverStationId !== hit.body.id)
  gs.missions.available.push(board[0])
  acceptMission(gs, board[0].id, Math.random)
  dropMission(gs, board[0].id)
  assert.equal(gs.missions.available.filter((m) => m.giverStationId === hit.body.id).length, 0)
  assert.equal(gs.missions.active.filter((m) => m.giverStationId === hit.body.id).length, 0)

  const added = refillMissionsIfExhausted(gs, hit.body.id, mulberry32(21))
  assert.ok(added.length >= 1)
  assert.ok(added.every((m) => m.id !== board[0].id))
})

test('refill after auto-complete of a mission also works', () => {
  const gs = freshState(23)
  const hit = missionBody(gs)
  assert.ok(hit)
  const board = gs.missions.available.filter((m) => m.giverStationId === hit.body.id)
  gs.missions.available = gs.missions.available.filter((m) => m.giverStationId !== hit.body.id)
  gs.missions.available.push(board[0])
  acceptMission(gs, board[0].id, Math.random)
  const creditsBefore = gs.player.credits
  finishMission(gs, board[0])
  assert.ok(gs.player.credits > creditsBefore)
  assert.equal(gs.missions.active.some((m) => m.id === board[0].id), false)

  const added = refillMissionsIfExhausted(gs, hit.body.id, mulberry32(29))
  assert.ok(added.length >= 1)
})

test('seedMissionsForGalaxy still produces galaxy-wide boards', () => {
  const gs = freshState(19)
  const seeded = seedMissionsForGalaxy(mulberry32(3), gs.galaxy)
  assert.ok(seeded.length > 10)
  assert.ok(seeded.every((m) => m.status === 'available'))
})
