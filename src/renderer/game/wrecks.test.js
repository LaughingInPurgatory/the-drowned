import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnWreck, pruneWrecks, lootWreck, WRECK_DESPAWN_S, WEAPON_DROP_CHANCE } from './wrecks.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { WEAPONS } from '../data/weapons.js'

test('spawnWreck rolls a small cargo drop, and rarely a ship part', () => {
  const wreck = spawnWreck([1, 2, 3], 0, () => 0.99) // high roll: last good, no ship part
  assert.deepEqual(wreck.position, [1, 2, 3])
  assert.equal(Object.keys(wreck.loot.cargo).length, 1)
  assert.equal(wreck.loot.shipParts, undefined)

  const luckyWreck = spawnWreck([0, 0, 0], 0, () => 0.01) // low roll: first good, ship part drops
  assert.equal(luckyWreck.loot.shipParts, 1)
})

test('spawnWreck can drop a paid weapon matching the destroyed ship class', () => {
  // rng: first call cargo pick, second ship parts (>=0.15 skip), third weapon drop (<0.12), fourth pick weapon
  let i = 0
  const rolls = [0, 0.5, 0.01, 0.0]
  const rng = () => rolls[Math.min(i++, rolls.length - 1)]
  const wreck = spawnWreck([0, 0, 0], 0, rng, 'needle_dart')
  assert.ok(wreck.loot.weapons, 'expected weapon drop')
  const [weaponId] = Object.keys(wreck.loot.weapons)
  const weapon = WEAPONS.find((w) => w.id === weaponId)
  assert.ok(weapon && weapon.price > 0, 'salvaged weapon should be a paid model')
})

test('spawnWreck weapon drop is rare without a lucky roll', () => {
  // Always high rolls after cargo: no part, no weapon
  const wreck = spawnWreck([0, 0, 0], 0, () => 0.99, 'needle_dart')
  assert.equal(wreck.loot.weapons, undefined)
  assert.ok(WEAPON_DROP_CHANCE < 0.2)
})

test('pruneWrecks removes wrecks older than WRECK_DESPAWN_S', () => {
  const gameState = { simTime: WRECK_DESPAWN_S + 1, wrecks: [{ id: 'a', spawnedAt: 0 }, { id: 'b', spawnedAt: WRECK_DESPAWN_S + 0.5 }] }
  pruneWrecks(gameState)
  assert.deepEqual(gameState.wrecks.map((w) => w.id), ['b'])
})

test('lootWreck adds loot to cargo, spare weapons, and removes the wreck', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const gameState = {
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, cargo: {}, shipParts: 0, spareWeapons: {} } },
    wrecks: [{
      id: 'w-1',
      position: [0, 0, 0],
      spawnedAt: 0,
      loot: { cargo: { grain: 2 }, shipParts: 1, weapons: { rapid_laser: 1 } }
    }]
  }
  lootWreck(gameState, shipClass, 'w-1')
  assert.equal(gameState.player.ship.cargo.grain, 2)
  assert.equal(gameState.player.ship.shipParts, 1)
  assert.equal(gameState.player.ship.spareWeapons.rapid_laser, 1)
  assert.equal(gameState.wrecks.length, 0)

  assert.throws(() => lootWreck(gameState, shipClass, 'w-1'), /no longer there/)
})

test('alien wrecks only drop alien blueprints, never human industry BPs', () => {
  const rng = () => 0.001 // force rare rolls
  const wreck = spawnWreck([0, 0, 0], 0, rng, 'void_cyst')
  if (wreck.loot.blueprints) {
    for (const id of Object.keys(wreck.loot.blueprints)) {
      assert.ok(id.startsWith('ship:') || id.startsWith('weapon:'))
      assert.ok(
        id.includes('void_') || id.includes('spine_') || id.includes('chor_') ||
        id.includes('zealot_') || id.includes('neural_') || id.includes('singularity_') ||
        id.includes('phase_') || id.includes('spore_'),
        `unexpected BP ${id}`
      )
      assert.equal(id.includes('rapid_laser') || id.includes('bravia'), false)
    }
  }
  // Human wreck never gets alien BP from tryRollBlueprintDrop path
  let alienOnHuman = false
  for (let i = 0; i < 200; i++) {
    const w = spawnWreck([0, 0, 0], 0, () => Math.random() * 0.02, 'needle_dart')
    for (const id of Object.keys(w.loot.blueprints ?? {})) {
      if (id.includes('void_cyst') || id.includes('void_lance') || id.includes('singularity')) alienOnHuman = true
    }
  }
  assert.equal(alienOnHuman, false)
})
