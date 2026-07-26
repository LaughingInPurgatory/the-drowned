import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGameState } from '../game/state.js'
import { TEST_GALAXY_OPTS } from '../procgen/galaxy.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { generateGalaxy, WHISPERS_SYSTEM_NAME } from './galaxy.js'
import { starTypeForSystem, isExoticStarType } from './starType.js'

test('new games never start in a binary star system (unless forced to Whispers trinary for dev)', () => {
  for (let seed = 0; seed < 25; seed++) {
    const gs = createGameState({
    characterName: 'Pilot',
      shipInstanceName: 'Ship',
      shipClassId: STARTER_SHIP_CLASS_ID,
      seed,
    galaxyOpts: TEST_GALAXY_OPTS
  })
    const system = gs.galaxy.systems.find((s) => s.id === gs.player.startingSystemId)
    assert.ok(system, `missing starting system for seed ${seed}`)
    const type = starTypeForSystem(system)
    // Default home pick excludes binary/trinary; START_IN_WHISPERS may land on trinary.
    assert.notEqual(type, 'binary', `seed ${seed} started in binary system ${system.id}`)
  }
})

test('trinary is exclusive to Whispers and never rolled for other systems', () => {
  for (const seed of [1, 42, 99]) {
    const galaxy = generateGalaxy(seed, TEST_GALAXY_OPTS)
    let trinaryCount = 0
    for (const system of galaxy.systems) {
      const type = starTypeForSystem(system)
      if (type === 'trinary') {
        trinaryCount++
        assert.equal(system.name, WHISPERS_SYSTEM_NAME)
        assert.equal(system.starType, 'trinary')
      }
      if (system.name !== WHISPERS_SYSTEM_NAME) {
        assert.notEqual(type, 'trinary')
      }
    }
    assert.equal(trinaryCount, 1, `seed ${seed}: exactly one trinary`)
  }
  assert.equal(isExoticStarType('trinary'), true)
  assert.equal(isExoticStarType('binary'), true)
  assert.equal(isExoticStarType('mainSequence'), false)
})
