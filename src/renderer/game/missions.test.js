import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptMission,
  dropMission,
  missionNavTarget,
  missionMarkedSystemIds,
  setWaypointForMission,
  updateMissionProgress,
  resolveInvestigationProbe,
  ensureBountyNpcsForSystem,
  markBodyProbed,
  noteTradePurchase,
  noteTradeSale,
  finishMission
} from './missions.js'
import { generateTradeMission } from '../data/missionTemplates.js'
import { createGameState } from './state.js'
import { TEST_WORLD_OPTS } from '../procgen/world.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { findBody } from '../procgen/world.js'

function freshState(seed = 7) {
  return createGameState({
    characterName: 'Pilot',
    shipInstanceName: 'Ship',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed,
    galaxyOpts: TEST_WORLD_OPTS
  })
}

function acceptInvestigation(gs) {
  const mission = gs.missions.available.find((m) => m.type === 'investigation')
  assert.ok(mission, 'need an investigation mission in seed')
  acceptMission(gs, mission.id, Math.random)
  return mission
}

test('missionNavTarget points at objective body', () => {
  const gs = freshState()
  const mission = gs.missions.available.find(
    (m) => m.target?.kind === 'body' && m.type !== 'trade'
  )
  assert.ok(mission, 'need a body-target mission in seed')
  acceptMission(gs, mission.id, Math.random)

  const before = missionNavTarget(mission, gs)
  assert.equal(before.phase, 'objective')
  assert.equal(before.bodyId, mission.target.bodyId)
  assert.equal(before.systemId, mission.target.systemId)
})

test('missionMarkedSystemIds follows active objective only', () => {
  const gs = freshState(9)
  const mission = gs.missions.available.find(
    (m) => m.target?.kind === 'body' && m.type !== 'trade'
  )
  assert.ok(mission, 'need a non-trade body mission')
  acceptMission(gs, mission.id, Math.random)

  assert.ok(missionMarkedSystemIds(gs).has(mission.target.systemId))
  finishMission(gs, mission)
  const ids = missionMarkedSystemIds(gs)
  assert.equal(ids.has(mission.target.systemId), false)
})

test('setWaypointForMission tracks body objectives', () => {
  const gs = freshState(11)
  const mission = gs.missions.available.find((m) => m.target?.kind === 'body')
  acceptMission(gs, mission.id, Math.random)
  setWaypointForMission(gs, mission.id)
  assert.equal(gs.player.waypointBodyId, mission.target.bodyId)
  assert.equal(gs.player.waypointPosition, null)

  // Waypoint stays on the body objective while the mission is active.
  assert.equal(gs.player.waypointBodyId, mission.target.bodyId)
})

test('probe mission completes when target body is marked probed', () => {
  const gs = freshState(21)
  const mission = gs.missions.available.find((m) => m.type === 'probe')
  assert.ok(mission, 'need a probe mission in seed')
  acceptMission(gs, mission.id, Math.random)
  const creditsBefore = gs.player.credits
  markBodyProbed(gs, mission.target.bodyId)
  assert.equal(mission.status, 'complete', 'markBodyProbed should finish open probe contracts')
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
  assert.ok(gs.player.credits > creditsBefore)
  assert.ok(gs.probedBodyIds.map(String).includes(String(mission.target.bodyId)))
})

test('accepting a probe mission on an already-scanned body does not auto-complete', () => {
  const gs = freshState(21)
  const mission = gs.missions.available.find((m) => m.type === 'probe')
  assert.ok(mission, 'need a probe mission in seed')
  // Prior survey of the target (before the contract exists).
  markBodyProbed(gs, mission.target.bodyId)
  acceptMission(gs, mission.id, Math.random)
  assert.equal(mission.status, 'active', 'prior probe must not finish a freshly accepted contract')
  assert.ok(gs.missions.active.some((m) => m.id === mission.id))
  // Must re-probe while the mission is active.
  markBodyProbed(gs, mission.target.bodyId)
  assert.equal(mission.status, 'complete')
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
})

test('exploration survey completes when the target body is probed', () => {
  const gs = freshState(21)
  const mission = gs.missions.available.find((m) => m.type === 'exploration')
  assert.ok(mission, 'need an exploration mission in seed')
  acceptMission(gs, mission.id, Math.random)
  markBodyProbed(gs, mission.target.bodyId)
  assert.equal(mission.status, 'complete', 'probing the survey target should finish exploration')
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
})

test('investigation intel probe completes the objective', () => {
  const gs = freshState(13)
  const mission = acceptInvestigation(gs)
  const bodyId = mission.target.bodyId
  // Always intel: roll 0 with leads=0 → intel branch
  const result = resolveInvestigationProbe(gs, bodyId, () => 0)
  assert.equal(result.kind, 'intel')
  assert.equal(mission.status, 'complete')
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
})

test('investigation hostile probe requires a kill', () => {
  const gs = freshState(17)
  const mission = acceptInvestigation(gs)
  const bodyId = mission.target.bodyId
  const body = findBody(gs.galaxy, bodyId)
  // Match objective system so waypoint can bind to the hostile's world position.
  gs.player.currentSystemId = mission.target.systemId
  // Place the player near the body so spawn direction is well-defined.
  gs.player.ship.position = [
    body.position[0] + (body.radius ?? 0) + 500,
    body.position[1],
    body.position[2]
  ]
  // roll in [0.4, 0.7) → hostile
  const result = resolveInvestigationProbe(gs, bodyId, () => 0.5)
  assert.equal(result.kind, 'hostile')
  assert.equal(mission.objectiveComplete, false)
  assert.equal(mission.target.kind, 'npcShip')
  assert.ok(gs.npcs.some((n) => n.id === mission.target.npcId))

  const npc = gs.npcs.find((n) => n.id === mission.target.npcId)
  const dist = Math.hypot(
    npc.position[0] - body.position[0],
    npc.position[1] - body.position[1],
    npc.position[2] - body.position[2]
  )
  // Must not be buried inside the surveyed body mesh.
  assert.ok(
    dist >= (body.radius ?? 0) + 200 - 1e-3,
    `hostile should spawn outside body shell (dist ${dist}, radius ${body.radius})`
  )
  assert.ok(npc.destroyed === false)
  assert.deepEqual(gs.player.waypointPosition, npc.position)

  updateMissionProgress(gs)
  assert.equal(mission.objectiveComplete, false)

  npc.destroyed = true
  updateMissionProgress(gs)
  assert.equal(mission.status, 'complete')
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
})

test('investigation lead retargets to another probeable body', () => {
  const gs = freshState(19)
  const mission = acceptInvestigation(gs)
  const oldBodyId = mission.target.bodyId
  const oldReward = mission.reward
  // roll >= 0.7 → lead
  const result = resolveInvestigationProbe(gs, oldBodyId, () => 0.85)
  assert.equal(result.kind, 'lead')
  assert.equal(mission.objectiveComplete, false)
  assert.equal(mission.target.kind, 'body')
  assert.notEqual(mission.target.bodyId, oldBodyId)
  assert.ok(findBody(gs.galaxy, mission.target.bodyId))
  assert.equal(mission.leads, 1)
  assert.equal(mission.reward, Math.round(oldReward * 1.05))
  assert.ok(mission.log?.some((e) => e.kind === 'lead'))
})

test('investigation leads stay in reach of the harbour that posted the contract', () => {
  // A chain of "spill to somewhere nearby" hops must not walk the player clean
  // across the sea one lead at a time — every lead re-anchors on the giver.
  const MAX_LEAD_DISTANCE = 14000
  let chased = 0
  for (let seed = 1; seed < 30; seed++) {
    const gs = freshState(seed)
    const mission = gs.missions.available.find((m) => m.type === 'investigation')
    if (!mission) continue
    acceptMission(gs, mission.id, Math.random)
    const giver = findBody(gs.galaxy, mission.giverStationId)
    if (!giver) continue
    // Force the 'lead' branch (roll >= 0.7) up to the mission's lead cap.
    for (let i = 0; i < 3 && mission.status !== 'complete'; i++) {
      resolveInvestigationProbe(gs, mission.target.bodyId, () => 0.85)
      if (mission.status === 'complete') break
      const target = findBody(gs.galaxy, mission.target.bodyId)
      if (!target) continue
      chased++
      const d = Math.hypot(
        target.position[0] - giver.position[0],
        target.position[2] - giver.position[2]
      )
      // The fallback picks the nearest thing outside the band when nothing is
      // inside it, so allow a margin rather than a hard cutoff.
      assert.ok(
        d <= MAX_LEAD_DISTANCE * 2,
        `lead ${i} landed ${Math.round(d)} out from ${giver.name}`
      )
    }
  }
  assert.ok(chased > 0, 'at least one seed should have produced a lead to check')
})

test('investigation hostiles re-materialize after system re-entry', () => {
  const gs = freshState(23)
  const mission = acceptInvestigation(gs)
  resolveInvestigationProbe(gs, mission.target.bodyId, () => 0.5)
  assert.equal(mission.target.kind, 'npcShip')
  const systemId = mission.target.systemId
  gs.npcs = []
  ensureBountyNpcsForSystem(gs, systemId, Math.random)
  assert.ok(gs.npcs.some((n) => n.id === mission.target.npcId))
})

test('dropMission removes an active mission and its bounty NPC without paying out', () => {
  const gs = freshState(31)
  const mission = gs.missions.available.find((m) => m.type === 'bounty')
  assert.ok(mission, 'need a bounty mission in seed')
  const creditsBefore = gs.player.credits
  const repBefore = gs.player.reputation
  acceptMission(gs, mission.id, Math.random)
  assert.ok(gs.missions.active.some((m) => m.id === mission.id))
  assert.ok(gs.npcs.some((n) => n.missionId === mission.id))

  dropMission(gs, mission.id)
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
  assert.equal(gs.npcs.some((n) => n.missionId === mission.id), false)
  assert.equal(gs.player.credits, creditsBefore, 'dropping should not award credits')
  assert.equal(gs.player.reputation, repBefore, 'dropping should not award reputation')
  assert.equal(mission.status, 'dropped')
})

test('dropMission rejects unknown or already-removed missions', () => {
  const gs = freshState(33)
  assert.throws(() => dropMission(gs, 'no-such-mission'), /not active/)
})

test('trade mission turns in at destination after buy+sell progress', () => {
  const gs = freshState(42)
  let mission = gs.missions.available.find((m) => m.type === 'trade')
  if (!mission) {
    // Force-generate one if seed board had none.
    const board = gs.missions.available[0]
    assert.ok(board, 'need at least one board mission for giver')
    mission = generateTradeMission(Math.random, gs.galaxy, board.giverSystemId, board.giverStationId)
    assert.ok(mission, 'generateTradeMission should find a viable route')
    gs.missions.available.push(mission)
  }
  acceptMission(gs, mission.id, Math.random)
  assert.equal(mission.type, 'trade')
  assert.ok(mission.trade.quantity >= 50)
  assert.ok(mission.trade.quantity <= 700)

  // A haul has to be worth the hold space — the destination is a long run away.
  const origin = findBody(gs.galaxy, mission.trade.originBodyId)
  const dest = findBody(gs.galaxy, mission.trade.destBodyId)
  const haul = Math.hypot(dest.position[0] - origin.position[0], dest.position[2] - origin.position[2])
  assert.ok(haul >= 11000, `haul should be a real voyage, got ${Math.round(haul)}`)
  assert.ok(mission.trade.destSellPrice > mission.trade.originBuyPrice)

  // Incomplete: nav at origin buy bay.
  let nav = missionNavTarget(mission, gs)
  assert.equal(nav.phase, 'objective')
  assert.equal(nav.bodyId, mission.trade.originBodyId)

  noteTradePurchase(gs, mission.trade.originBodyId, mission.trade.goodId, mission.trade.quantity)
  nav = missionNavTarget(mission, gs)
  assert.equal(nav.bodyId, mission.trade.destBodyId)
  assert.equal(mission.status, 'active')

  const creditsBefore = gs.player.credits
  noteTradeSale(gs, mission.trade.destBodyId, mission.trade.goodId, mission.trade.quantity)
  assert.equal(mission.status, 'complete')
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
  assert.ok(gs.player.credits > creditsBefore, 'reward paid on auto-complete')
})

test('trade mission can complete over multiple partial buy/sell trips', () => {
  const gs = freshState(99)
  let mission = gs.missions.available.find((m) => m.type === 'trade')
  if (!mission) {
    const board = gs.missions.available[0]
    mission = generateTradeMission(Math.random, gs.galaxy, board.giverSystemId, board.giverStationId)
    gs.missions.available.push(mission)
  }
  acceptMission(gs, mission.id, Math.random)
  const need = mission.trade.quantity
  const chunk = Math.max(1, Math.floor(need / 3))
  assert.ok(chunk < need, 'need a multi-leg haul')

  // Trip 1: buy a partial load, sell it at dest.
  noteTradePurchase(gs, mission.trade.originBodyId, mission.trade.goodId, chunk)
  assert.equal(mission.status, 'active')
  let nav = missionNavTarget(mission, gs)
  assert.equal(nav.bodyId, mission.trade.destBodyId, 'after partial buy, nav should point to dest')
  noteTradeSale(gs, mission.trade.destBodyId, mission.trade.goodId, chunk)
  assert.equal(mission.status, 'active')
  assert.equal(mission.trade.sold, chunk)
  nav = missionNavTarget(mission, gs)
  assert.equal(nav.bodyId, mission.trade.originBodyId, 'after selling the load, nav returns to origin')

  // Remaining legs until quota is filled.
  let left = need - chunk
  while (left > 0) {
    const n = Math.min(chunk, left)
    noteTradePurchase(gs, mission.trade.originBodyId, mission.trade.goodId, n)
    noteTradeSale(gs, mission.trade.destBodyId, mission.trade.goodId, n)
    left -= n
  }
  assert.equal(mission.status, 'complete')
  assert.equal(mission.trade.purchased >= need, true)
  assert.equal(mission.trade.sold >= need, true)
  assert.equal(gs.missions.active.some((m) => m.id === mission.id), false)
})
