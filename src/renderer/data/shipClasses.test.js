import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHIP_CLASSES, STARTER_SHIP_CLASS_ID, purchasableShipClasses } from './shipClasses.js'
import { MIN_SHIP_BUY_PRICE } from '../procgen/shipRoster.js'

test('every ship class has a positive mining hold capacity', () => {
  for (const c of SHIP_CLASSES) assert.ok(c.stats.miningCapacity > 0, `${c.id} should have a mining hold`)
})

test('the starter ship has the smallest mining hold of any ship class', () => {
  const starter = SHIP_CLASSES.find((c) => c.id === STARTER_SHIP_CLASS_ID)
  for (const c of SHIP_CLASSES) {
    if (c.id === STARTER_SHIP_CLASS_ID) continue
    assert.ok(
      c.stats.miningCapacity > starter.stats.miningCapacity,
      `${c.id} (${c.stats.miningCapacity}) should have a bigger mining hold than the starter ship (${starter.stats.miningCapacity})`
    )
  }
})

test('lowest purchasable ship costs at least 8500 credits', () => {
  assert.equal(MIN_SHIP_BUY_PRICE, 8500)
  const prices = purchasableShipClasses().map((c) => c.price)
  assert.ok(Math.min(...prices) >= MIN_SHIP_BUY_PRICE)
  assert.equal(Math.min(...prices), 8500, 'Starter Light Runner should set the 8500 floor')
})
