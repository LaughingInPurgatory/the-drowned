import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  oreTierForSystem,
  mineRock,
  isRockAlive,
  rockDisplayName,
  mineYieldForWeapon,
  isFieldDepleted,
  fieldRespawnRemainingS,
  formatRespawnTime,
  rollMiningPirateAmbush,
  MINING_PIRATE_CHANCE,
  MINING_PIRATE_SPAWN_COOLDOWN_S
} from './mining.js'
import { GALAXY_MAX_RADIUS } from '../procgen/galaxy.js'
import { MINED_ORE_GOOD_IDS } from '../data/goods.js'
import { getWeapon } from '../data/weapons.js'

function systemAtRadius(radius) {
  return { galaxyPosition: [radius, 0, 0] }
}

test('systems near the galactic core only yield raw ore', () => {
  assert.equal(oreTierForSystem(systemAtRadius(0)), 'raw_ore')
})

test('systems out toward the rim yield the most valuable ore tier', () => {
  assert.equal(oreTierForSystem(systemAtRadius(GALAXY_MAX_RADIUS)), MINED_ORE_GOOD_IDS[MINED_ORE_GOOD_IDS.length - 1])
})

test('ore tier increases monotonically with distance from the core', () => {
  const tierIndex = (r) => MINED_ORE_GOOD_IDS.indexOf(oreTierForSystem(systemAtRadius(r)))
  let last = -1
  for (let r = 0; r <= GALAXY_MAX_RADIUS; r += GALAXY_MAX_RADIUS / 20) {
    const idx = tierIndex(r)
    assert.ok(idx >= last, 'tier index should never decrease as distance grows')
    last = idx
  }
})

test('default laser yields 1 ore, default missile yields 2, stronger guns scale up', () => {
  assert.equal(mineYieldForWeapon('pulse_laser'), 1)
  assert.equal(mineYieldForWeapon('rocket_pod'), 2)
  assert.equal(mineYieldForWeapon(getWeapon('pulse_laser')), 1)
  assert.equal(mineYieldForWeapon(getWeapon('rocket_pod')), 2)
  assert.ok(mineYieldForWeapon('plasma_cannon') > mineYieldForWeapon('pulse_laser'))
  assert.ok(mineYieldForWeapon('torpedo') > mineYieldForWeapon('rocket_pod'))
})

test('mining scoops until the hold is full, but still depletes the rock afterward', () => {
  const shipClass = { stats: { miningCapacity: 2 } }
  const gameState = { simTime: 0, player: { ship: { miningHold: {} } } }
  const system = systemAtRadius(0)

  assert.deepEqual(mineRock(gameState, shipClass, system, 'field-1', 0), {
    goodId: 'raw_ore', mined: true, scooped: true, scoopedAmount: 1, amount: 1, destroyed: false
  })
  assert.deepEqual(mineRock(gameState, shipClass, system, 'field-1', 0), {
    goodId: 'raw_ore', mined: true, scooped: true, scoopedAmount: 1, amount: 1, destroyed: false
  })
  assert.equal(gameState.player.ship.miningHold.raw_ore, 2)

  // Hold full: rock still loses ore, nothing is scooped.
  const full = mineRock(gameState, shipClass, system, 'field-1', 0)
  assert.equal(full.mined, true)
  assert.equal(full.scooped, false)
  assert.equal(full.amount, 1)
  assert.equal(gameState.player.ship.miningHold.raw_ore, 2, 'a full hold should not exceed capacity')
})

test('higher yield strips more ore and scoops up to capacity', () => {
  const shipClass = { stats: { miningCapacity: 5 } }
  const gameState = { simTime: 0, player: { ship: { miningHold: {} } } }
  const system = systemAtRadius(0)
  const r = mineRock(gameState, shipClass, system, 'field-hi', 0, 4)
  assert.equal(r.amount, 4)
  assert.equal(r.scoopedAmount, 4)
  assert.equal(gameState.player.ship.miningHold.raw_ore, 4)
})

test('a rock holds 10-200 ore, depletes, explodes, and stops being mineable until it respawns', () => {
  const shipClass = { stats: { miningCapacity: 100000 } }
  const gameState = { simTime: 0, player: { ship: { miningHold: {} } } }
  const system = systemAtRadius(0)

  let destroyedAt = null
  let mined = 0
  let destroyed = false
  while (!destroyed) {
    const result = mineRock(gameState, shipClass, system, 'field-2', 3)
    assert.equal(result.mined, true)
    assert.equal(result.scooped, true)
    mined++
    destroyed = result.destroyed
    if (destroyed) destroyedAt = gameState.simTime
    assert.ok(mined <= 200, 'rock should deplete within the documented 10-200 ore range')
  }
  assert.ok(mined >= 10 && mined <= 200)

  assert.equal(isRockAlive(gameState, 'field-2', 3), false, 'a depleted rock is not alive/mineable')
  assert.deepEqual(mineRock(gameState, shipClass, system, 'field-2', 3), {
    goodId: 'raw_ore', mined: false, scooped: false, scoopedAmount: 0, amount: 0, destroyed: false
  })

  gameState.simTime = destroyedAt + 24 * 3600 + 1 // past even the longest possible respawn delay
  assert.equal(isRockAlive(gameState, 'field-2', 3), true, 'the rock respawns after its delay elapses')
  assert.deepEqual(mineRock(gameState, shipClass, system, 'field-2', 3), {
    goodId: 'raw_ore', mined: true, scooped: true, scoopedAmount: 1, amount: 1, destroyed: false
  })
})

test('full mining hold can still exhaust a rock to destruction', () => {
  const shipClass = { stats: { miningCapacity: 0 } }
  const gameState = { simTime: 0, player: { ship: { miningHold: {} } } }
  const system = systemAtRadius(0)
  let hits = 0
  let destroyed = false
  while (!destroyed && hits < 250) {
    const r = mineRock(gameState, shipClass, system, 'field-full', 1)
    assert.equal(r.mined, true)
    assert.equal(r.scooped, false)
    destroyed = r.destroyed
    hits++
  }
  assert.equal(destroyed, true)
  assert.equal(Object.keys(gameState.player.ship.miningHold).length, 0)
})

test('rockDisplayName names the deposit after the ore it yields', () => {
  assert.equal(rockDisplayName(systemAtRadius(0)), 'Raw Ore Deposit')
})

test('destroyed rocks revive after offline simTime catch-up', () => {
  const shipClass = { stats: { miningCapacity: 0 } }
  const gameState = { simTime: 0, player: { ship: { miningHold: {} } } }
  const system = systemAtRadius(0)
  let hits = 0
  while (isRockAlive(gameState, 'belt-offline', 0) && hits < 300) {
    mineRock(gameState, shipClass, system, 'belt-offline', 0, 50)
    hits++
  }
  assert.equal(isRockAlive(gameState, 'belt-offline', 0), false)
  // Simulate loading after 25h of wall-clock offline (past max 24h respawn).
  gameState.simTime += 25 * 3600
  assert.equal(isRockAlive(gameState, 'belt-offline', 0), true)
})

test('isFieldDepleted and fieldRespawnRemainingS track a fully mined belt', () => {
  const shipClass = { stats: { miningCapacity: 0 } }
  const gameState = { simTime: 0, player: { ship: { miningHold: {} } } }
  const system = systemAtRadius(0)
  const fieldId = 'belt-empty'
  const rockCount = 3
  for (let i = 0; i < rockCount; i++) {
    let hits = 0
    while (isRockAlive(gameState, fieldId, i) && hits < 300) {
      mineRock(gameState, shipClass, system, fieldId, i, 50)
      hits++
    }
  }
  assert.equal(isFieldDepleted(gameState, fieldId, rockCount), true)
  const rem = fieldRespawnRemainingS(gameState, fieldId, rockCount)
  assert.ok(rem > 0, 'depleted field should report time until next rock respawns')
  assert.ok(formatRespawnTime(rem).length > 0)
  assert.equal(formatRespawnTime(3661), '1h 1m')
  assert.equal(formatRespawnTime(90), '1m 30s')
})

test('mining pirate ambush only rolls in security 0–3', () => {
  const always = () => 0 // always succeed the 10% roll
  const base = {
    simTime: 100,
    flags: {},
    player: { currentSystemId: 'a', startingSystemId: 'home' }
  }
  assert.equal(rollMiningPirateAmbush(always, base, { securityRating: 0 }), true)
  base.flags = {}
  assert.equal(rollMiningPirateAmbush(always, base, { securityRating: 3 }), true)
  base.flags = {}
  assert.equal(rollMiningPirateAmbush(always, base, { securityRating: 4 }), false)
  base.flags = {}
  assert.equal(rollMiningPirateAmbush(always, base, { securityRating: 6 }), false)
})

test('mining pirate ambush is 10% and stamps cooldown on success', () => {
  assert.equal(MINING_PIRATE_CHANCE, 0.1)
  const gs = {
    simTime: 50,
    flags: {},
    player: { currentSystemId: 'rim', startingSystemId: 'home' }
  }
  const system = { securityRating: 1 }
  assert.equal(rollMiningPirateAmbush(() => 0.099, gs, system), true)
  assert.equal(gs.flags.lastMiningPirateAmbushAt, 50)
  // Still inside cooldown — no second spawn even with a guaranteed roll.
  gs.simTime = 50 + MINING_PIRATE_SPAWN_COOLDOWN_S - 1
  assert.equal(rollMiningPirateAmbush(() => 0, gs, system), false)
  // After cooldown, can roll again.
  gs.simTime = 50 + MINING_PIRATE_SPAWN_COOLDOWN_S
  assert.equal(rollMiningPirateAmbush(() => 0, gs, system), true)
  // Failed roll does not stamp cooldown.
  gs.flags = {}
  gs.simTime = 200
  assert.equal(rollMiningPirateAmbush(() => 0.5, gs, system), false)
  assert.equal(gs.flags?.lastMiningPirateAmbushAt, undefined)
})

test('mining pirate ambush respects unbroken home-system peace', () => {
  const always = () => 0
  const gs = {
    simTime: 10,
    flags: {},
    player: { currentSystemId: 'home', startingSystemId: 'home' }
  }
  // Even if someone forced low security on home, peace blocks hostiles.
  assert.equal(rollMiningPirateAmbush(always, gs, { securityRating: 0 }), false)
  gs.flags.startingSystemPeaceBroken = true
  assert.equal(rollMiningPirateAmbush(always, gs, { securityRating: 0 }), true)
})
