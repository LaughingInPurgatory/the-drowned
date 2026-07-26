import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGameState } from './state.js'
import {
  CANONICAL_GALAXY_SEED,
  TEST_GALAXY_OPTS,
  STARTING_SYSTEM_NAME,
  coreFraction
} from '../procgen/galaxy.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

test('every New Game uses the canonical galaxy seed and the same central home system', () => {
  const a = createGameState({
    characterName: 'A',
    shipInstanceName: 'ShipA',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed: 111,
    galaxyOpts: TEST_GALAXY_OPTS
  })
  const b = createGameState({
    characterName: 'B',
    shipInstanceName: 'ShipB',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed: 999999,
    galaxyOpts: TEST_GALAXY_OPTS
  })

  assert.equal(a.galaxySeed, CANONICAL_GALAXY_SEED)
  assert.equal(b.galaxySeed, CANONICAL_GALAXY_SEED)
  assert.equal(a.galaxy.seed, CANONICAL_GALAXY_SEED)
  assert.equal(b.galaxy.seed, CANONICAL_GALAXY_SEED)
  assert.equal(a.player.startingSystemId, b.player.startingSystemId)
  assert.equal(a.player.currentSystemId, a.player.startingSystemId)

  const home = a.galaxy.systems.find((s) => s.id === a.player.startingSystemId)
  assert.ok(home)
  // Home is the closest (or tied-closest non-exotic) system to galactic centre.
  const minCore = Math.min(...a.galaxy.systems.map((s) => coreFraction(s)))
  assert.ok(coreFraction(home) <= minCore + 1e-12)
  assert.equal(home.securityRating, 6)
  assert.equal(home.name, STARTING_SYSTEM_NAME)
  assert.equal(home.name, 'Terra Prime')
})
