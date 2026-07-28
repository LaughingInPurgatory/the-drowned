import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGameState } from './state.js'
import {
  CANONICAL_WORLD_SEED,
  TEST_WORLD_OPTS,
  HOME_ARCHIPELAGO_NAME,
  getWorld,
  remoteness
} from '../procgen/world.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

test('every New Game opens on the same sea, tied up at the same harbour', () => {
  const a = createGameState({
    characterName: 'A',
    shipInstanceName: 'ShipA',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed: 111,
    galaxyOpts: TEST_WORLD_OPTS
  })
  const b = createGameState({
    characterName: 'B',
    shipInstanceName: 'ShipB',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed: 999999,
    galaxyOpts: TEST_WORLD_OPTS
  })

  assert.equal(a.galaxySeed, CANONICAL_WORLD_SEED)
  assert.equal(b.galaxySeed, CANONICAL_WORLD_SEED)
  assert.equal(a.galaxy.seed, CANONICAL_WORLD_SEED)
  assert.equal(b.galaxy.seed, CANONICAL_WORLD_SEED)
  assert.equal(a.player.startingSystemId, b.player.startingSystemId)
  assert.equal(a.player.currentSystemId, a.player.startingSystemId)
  assert.equal(a.galaxy.systems.length, 1, 'one sea, no regions to travel between')

  // Both skippers start at Haven Reach, the last harbour with any authority left.
  assert.equal(a.player.homePortId, b.player.homePortId)
  const world = getWorld(a.galaxy)
  const homePort = world.bodies.find((x) => x.id === a.player.homePortId)
  assert.ok(homePort, 'the home harbour must exist')
  assert.equal(homePort.kind, 'port')
  assert.equal(homePort.securityRating, 6)
  assert.equal(homePort.name, 'Port Haven')
  assert.ok(world.bodies.some((x) => x.name === HOME_ARCHIPELAGO_NAME))

  // The boat starts at the harbour, on the water, and near the centre.
  assert.deepEqual(a.player.ship.position, [...homePort.position])
  assert.equal(a.player.ship.position[1], 0)
  assert.ok(remoteness(a.player.ship.position) < 0.15, 'a new skipper starts in home waters')
})
