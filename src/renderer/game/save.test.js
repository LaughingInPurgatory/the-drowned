import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGameState } from './state.js'
import { TEST_WORLD_OPTS, getWorld } from '../procgen/world.js'
import { getIslandProfile } from '../render/islandMesh.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { serializeGameState, deserializeGameState, SAVE_VERSION } from './save.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

function makeState(overrides = {}) {
  return createGameState({
    characterName: 'Nova',
    shipInstanceName: 'Wanderer',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed: 5,
    galaxyOpts: TEST_WORLD_OPTS,
    ...overrides
  })
}

test('serialize writes captain and assets only — not the sea or missions', () => {
  const gameState = makeState()
  const json = serializeGameState(gameState)
  assert.equal(json.version, SAVE_VERSION)
  assert.equal(json.galaxy, undefined)
  assert.equal(json.missions, undefined)
  assert.equal(json.marketStock, undefined)
  assert.equal(json.asteroids, undefined)
  assert.ok(json.player)
  assert.ok(json.stationStorage)
})

test('serialize then deserialize round-trips the captain and drops encounters', () => {
  const gameState = makeState()
  gameState.player.credits = 4321
  gameState.player.ship.position = [10, 0, 30]
  gameState.player.ship.quaternion = [0, 0.1, 0, 0.995]
  gameState.player.ship.velocity = [1, 0, -5]
  gameState.player.dockedBodyId = null

  const json = JSON.parse(JSON.stringify(serializeGameState(gameState)))
  const restored = deserializeGameState(json)

  assert.equal(restored.player.credits, 4321)
  assert.deepEqual(restored.player.ship.position, [10, 0, 30])
  assert.deepEqual(restored.player.ship.velocity, [1, 0, -5])
  assert.equal(restored.player.dockedBodyId, null)
  assert.equal(restored.galaxy.systems.length, 1)
  assert.equal(restored.npcs.length, 0, 'no ordinary encounter state should persist')
  assert.equal(restored.inCombat, false)
  assert.ok(restored.missions.available.length > 0, 'fresh contract boards on load')
  assert.equal(restored.missions.active.length, 0)
})

test('harbour storage and parked ships survive a save', () => {
  const gameState = makeState()
  const port = getWorld(gameState.galaxy).bodies.find((b) => b.kind === 'port')
  gameState.stationStorage[port.id] = {
    cargo: { scrap: 12 },
    miningHold: { iron: 4 },
    shipParts: 2,
    ships: [{ classId: STARTER_SHIP_CLASS_ID, instanceName: 'Spare' }],
    weapons: {},
    accessories: {},
    blueprints: { 'ship:light_runner': 1 },
    drones: {}
  }
  const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(gameState))))
  const stored = restored.stationStorage[port.id]
  assert.equal(stored.cargo.scrap, 12)
  assert.equal(stored.miningHold.iron, 4)
  assert.equal(stored.shipParts, 2)
  assert.equal(stored.ships[0].instanceName, 'Spare')
  assert.equal(stored.blueprints['ship:light_runner'], 1)
})

test('a saved altitude is discarded — the sea decides where the hull sits', () => {
  const gameState = makeState()
  gameState.player.ship.position = [10, 900, 30]
  const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(gameState))))
  assert.equal(restored.player.ship.position[1], 0)
})

test('heading survives a save so a loaded boat still points where it was left', () => {
  const gameState = makeState()
  gameState.player.ship.heading = 2.35
  const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(gameState))))
  assert.equal(restored.player.ship.heading, 2.35)
})

test('missing heading is recovered from the saved quaternion on load', () => {
  const gameState = makeState()
  const yaw = 1.1
  gameState.player.ship.quaternion = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]
  delete gameState.player.ship.heading
  const json = JSON.parse(JSON.stringify(serializeGameState(gameState)))
  delete json.player.ship.heading
  const restored = deserializeGameState(json)
  assert.ok(Number.isFinite(restored.player.ship.heading), 'heading must be a number')
  const err = Math.abs(
    Math.atan2(
      Math.sin(restored.player.ship.heading - yaw),
      Math.cos(restored.player.ship.heading - yaw)
    )
  )
  assert.ok(err < 0.05, `heading ${restored.player.ship.heading} should match yaw ${yaw}`)
  assert.equal(restored.player.ship.velocity[1], 0)
})

test('docked pose fields round-trip through a slim save', () => {
  const gameState = makeState()
  const station = getWorld(gameState.galaxy).bodies.find((b) => b.kind === 'port')
  assert.ok(station)
  gameState.player.dockedBodyId = station.id
  gameState.player.dockedExteriorPosition = [100, 50, -200]
  gameState.player.dockedApproachDir = [0, 0, 1]
  gameState.player.ship.position = [2_000_000, 0, 20]

  const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(gameState))))
  assert.equal(restored.player.dockedBodyId, station.id)
  assert.deepEqual(restored.player.dockedExteriorPosition, [100, 50, -200])
  assert.deepEqual(restored.player.dockedApproachDir, [0, 0, 1])
})

test('on-foot position and the parked ship both survive a slim save', () => {
  const gameState = makeState()
  const island = getWorld(gameState.galaxy).bodies.find((body) => body.kind === 'island')
  gameState.player.onFoot = {
    ...gameState.player.onFoot,
    active: true,
    bodyId: island.id,
    position: [123.5, 7.25, -456.75],
    heading: 1.4,
    pitch: -0.2,
    flashlightOn: true,
    health: 73
  }
  gameState.player.ship.position = [88, 0, -390]
  gameState.player.ship.heading = 2.2

  const restored = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(gameState))))

  assert.equal(restored.player.onFoot.active, true)
  assert.equal(restored.player.onFoot.bodyId, island.id)
  assert.deepEqual(restored.player.onFoot.position, [123.5, 7.25, -456.75])
  assert.equal(restored.player.onFoot.heading, 1.4)
  assert.equal(restored.player.onFoot.pitch, -0.2)
  assert.equal(restored.player.onFoot.flashlightOn, true)
  assert.equal(restored.player.onFoot.health, 73)
  assert.deepEqual(restored.player.ship.position, [88, 0, -390])
  assert.equal(restored.player.ship.heading, 2.2)
})

test('load clears hardpoint cooldowns so weapons work after a docked save', () => {
  const gameState = makeState()
  gameState.player.ship.hardpointCooldowns = { fwd1: 12_345.67 }
  gameState.player.ship.lastHitAt = 12_340
  gameState.simTime = 12_400

  const json = JSON.parse(JSON.stringify(serializeGameState(gameState)))
  json.savedAtWallMs = Date.now()
  const restored = deserializeGameState(json)
  assert.ok(restored.simTime >= 0, `expected a finite campaign clock, got ${restored.simTime}`)
  assert.deepEqual(restored.player.ship.hardpointCooldowns, {})
  assert.equal(restored.player.ship.lastHitAt, undefined)
})

test('a legacy world-save is ported to Port Haven with assets intact', () => {
  const gameState = makeState()
  const world = getWorld(gameState.galaxy)
  const home = world.bodies.find((b) => b.name === 'Port Haven') ?? world.bodies.find((b) => b.kind === 'port')
  const other = world.bodies.find((b) => b.kind === 'port' && b.id !== home.id)
  assert.ok(home)
  gameState.player.credits = 8800
  gameState.player.ship.classId = STARTER_SHIP_CLASS_ID
  gameState.player.ship.cargo = { scrap: 7 }
  gameState.player.ship.blueprints = { 'ship:light_runner': 1 }
  gameState.player.ship.position = [40_000, 0, -12_000]
  gameState.player.dockedBodyId = other?.id ?? null
  gameState.player.onFoot.active = true
  gameState.player.onFoot.bodyId = world.bodies.find((b) => b.kind === 'island')?.id
  const farKey = other?.id ?? home.id
  gameState.stationStorage[farKey] = {
    cargo: { scrap: 30 },
    miningHold: {},
    shipParts: 1,
    ships: [{ classId: STARTER_SHIP_CLASS_ID, instanceName: 'Kept' }],
    weapons: { pulse_laser: 2 },
    accessories: {},
    blueprints: {},
    drones: {}
  }
  gameState.stationStorage['body-does-not-exist'] = {
    cargo: { cloth: 5 },
    miningHold: {},
    shipParts: 3,
    ships: [{ classId: STARTER_SHIP_CLASS_ID, instanceName: 'Orphan' }],
    weapons: {},
    accessories: {},
    blueprints: {},
    drones: {}
  }

  const legacy = {
    version: 1,
    seed: gameState.seed,
    galaxySeed: gameState.galaxySeed,
    galaxyOpts: TEST_WORLD_OPTS,
    createdAt: gameState.createdAt,
    player: gameState.player,
    galaxy: gameState.galaxy,
    missions: gameState.missions,
    stationStorage: gameState.stationStorage,
    craftingJobs: [],
    simTime: 12,
    flags: gameState.flags
  }

  const restored = deserializeGameState(JSON.parse(JSON.stringify(legacy)))
  assert.equal(restored._portedFromLegacySave, true)
  assert.equal(restored.player.dockedBodyId, home.id)
  assert.deepEqual(restored.player.ship.position, [home.position[0], 0, home.position[2]])
  assert.equal(restored.player.onFoot.active, false)
  assert.equal(restored.player.credits, 8800)
  assert.equal(restored.player.ship.cargo.scrap, 7)
  assert.equal(restored.player.ship.blueprints['ship:light_runner'], 1)
  assert.equal(restored.stationStorage[farKey].ships[0].instanceName, 'Kept')
  assert.equal(restored.stationStorage[farKey].cargo.scrap, 30)
  assert.equal(restored.stationStorage[home.id].ships.some((s) => s.instanceName === 'Orphan'), true)
  assert.equal(restored.stationStorage[home.id].cargo.cloth, 5)
  assert.equal(restored.stationStorage[home.id].shipParts, 3)
  assert.equal(restored.stationStorage['body-does-not-exist'], undefined)
  assert.equal(restored.missions.active.length, 0)
  assert.ok(restored.missions.available.length > 0)
})

test('a second save after a legacy import is slim and does not re-port', () => {
  const gameState = makeState()
  const home = getWorld(gameState.galaxy).bodies.find((b) => b.kind === 'port')
  const legacy = {
    version: 1,
    seed: 5,
    galaxyOpts: TEST_WORLD_OPTS,
    player: gameState.player,
    galaxy: gameState.galaxy,
    missions: gameState.missions,
    stationStorage: {},
    flags: gameState.flags
  }
  const imported = deserializeGameState(JSON.parse(JSON.stringify(legacy)))
  imported.player.ship.position = [55, 0, 80]
  imported.player.dockedBodyId = null
  const again = deserializeGameState(JSON.parse(JSON.stringify(serializeGameState(imported))))
  assert.equal(again._portedFromLegacySave, undefined)
  assert.deepEqual(again.player.ship.position, [55, 0, 80])
  assert.equal(again.player.dockedBodyId, null)
  assert.notEqual(again.player.dockedBodyId, home.id)
})

test('a save survives structuredClone — it crosses an IPC boundary', () => {
  const gameState = makeState()
  const world = gameState.galaxy.systems[0]
  for (const body of world.bodies) {
    if (body.kind === 'island') getIslandProfile(body)
    if (body.kind === 'wreckField') getAsteroidRocks(body)
  }

  assert.doesNotThrow(() => structuredClone(serializeGameState(gameState)))
})
