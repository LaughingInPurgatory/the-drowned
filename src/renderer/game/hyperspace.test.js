import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGameState } from './state.js'
import { TEST_GALAXY_OPTS } from '../procgen/galaxy.js'
import { hyperspaceJump } from './hyperspace.js'
import { acceptMission, ensureBountyNpcsForSystem } from './missions.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import {
  getSystem,
  findWarpGateTo,
  WARP_GATE_ACTIVATION_RANGE,
  ensureWarpGates
} from '../procgen/galaxy.js'
import { warpArrivalNearExitGate } from './hyperspace.js'

function freshState() {
  return createGameState({
    characterName: 'Nova', shipInstanceName: 'Wanderer', shipClassId: STARTER_SHIP_CLASS_ID, seed: 11,
    galaxyOpts: TEST_GALAXY_OPTS
  })
}

// Bypasses hyperspaceJump's neighbor-range check entirely — used only to set
// up test fixtures for mission/NPC persistence logic that isn't itself about
// jump range, mirroring the same "reach in and set state directly" pattern
// save.test.js already uses for the same reason.
function travelTo(gameState, systemId, rng) {
  gameState.player.currentSystemId = systemId
  gameState.npcs = []
  gameState.projectiles = []
  ensureBountyNpcsForSystem(gameState, systemId, rng)
}

test('hyperspaceJump places the ship in the destination gate aperture facing out', () => {
  const gameState = freshState()
  ensureWarpGates(gameState.galaxy)
  const startSystemId = gameState.player.currentSystemId
  gameState.player.ship.position = [40, 5, -30]
  gameState.player.ship.velocity = [10, 0, 0]
  gameState.player.ship.quaternion = [0, 0.7071, 0, 0.7071]
  const targetSystemId = getSystem(gameState.galaxy, startSystemId).neighborIds[0]

  hyperspaceJump(gameState, targetSystemId, Math.random)

  assert.equal(gameState.player.currentSystemId, targetSystemId)
  assert.deepEqual(gameState.player.ship.velocity, [0, 0, 0])
  assert.equal(gameState.npcs.length, 0)

  const dest = getSystem(gameState.galaxy, targetSystemId)
  const exitGate = findWarpGateTo(dest, startSystemId)
  assert.ok(exitGate, 'destination system should have a gate back to origin')
  const pos = gameState.player.ship.position
  // Jump lands in the aperture centre; flight VFX then flies out to standoff.
  assert.deepEqual(pos, [...exitGate.position])
  const standoff = warpArrivalNearExitGate(dest, startSystemId)
  const dStand = Math.hypot(
    standoff[0] - exitGate.position[0],
    standoff[1] - exitGate.position[1],
    standoff[2] - exitGate.position[2]
  )
  assert.ok(
    dStand <= WARP_GATE_ACTIVATION_RANGE && dStand > 100,
    `standoff should sit outside the gate within 2 km, got ${dStand.toFixed(1)}m`
  )

  // Local +Z should aim into the system (out of the gate toward the star).
  const q = gameState.player.ship.quaternion
  const forward = [
    2 * (q[0] * q[2] + q[3] * q[1]),
    2 * (q[1] * q[2] - q[3] * q[0]),
    1 - 2 * (q[0] * q[0] + q[1] * q[1])
  ]
  const out = [
    standoff[0] - pos[0],
    standoff[1] - pos[1],
    standoff[2] - pos[2]
  ]
  const toLen = Math.hypot(...out)
  const fLen = Math.hypot(...forward)
  const dot =
    (forward[0] * out[0] + forward[1] * out[1] + forward[2] * out[2]) / (toLen * fLen)
  assert.ok(dot > 0.999, `ship forward should face out of the exit gate, dot=${dot}`)
})

test('hyperspaceJump refuses to jump to the current system or while in combat', () => {
  const gameState = freshState()
  assert.throws(() => hyperspaceJump(gameState, gameState.player.currentSystemId, Math.random))

  const neighborId = getSystem(gameState.galaxy, gameState.player.currentSystemId).neighborIds[0]
  gameState.inCombat = true
  assert.throws(() => hyperspaceJump(gameState, neighborId, Math.random))
})

test('hyperspaceJump refuses a system that is not a hyperspace neighbor', () => {
  const gameState = freshState()
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const farSystem = gameState.galaxy.systems.find(
    (s) => s.id !== currentSystem.id && !currentSystem.neighborIds.includes(s.id)
  )
  assert.throws(() => hyperspaceJump(gameState, farSystem.id, Math.random))
})

test('jumping into a bounty target system re-materializes its target NPC', () => {
  const gameState = freshState()
  const bounty = gameState.missions.available.find((m) => m.type === 'bounty')
  acceptMission(gameState, bounty.id, Math.random)
  assert.ok(gameState.npcs.some((n) => n.id === bounty.target.npcId))

  const elsewhere = gameState.galaxy.systems.find(
    (s) => s.id !== gameState.player.currentSystemId && s.id !== bounty.target.systemId
  ).id
  travelTo(gameState, elsewhere, Math.random)
  assert.equal(gameState.npcs.length, 0, 'bounty target should not follow the player into an unrelated system')

  travelTo(gameState, bounty.target.systemId, Math.random)
  assert.ok(gameState.npcs.some((n) => n.id === bounty.target.npcId), 'bounty target should reappear back in its own system')
})
