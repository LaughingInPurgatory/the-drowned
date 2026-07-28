import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACCESSORIES,
  getAccessory,
  accessorySlotCount,
  defaultAccessoriesFor,
  normalizeAccessories,
  shipHasAccessory,
  effectiveMiningCapacity,
  effectiveCargoCapacity,
  effectiveMaxArmor,
  effectiveMaxSpeed,
  effectiveHardpoints,
  effectiveDroneBayCount,
  EXTRA_ORE_STORAGE_ID,
  CARGO_UPGRADE_ID,
  EXTRA_DRONE_BAY_ID,
  EXTRA_TURRET_HP_ID,
  EXTRA_LAUNCHER_HP_ID,
  ARMOUR_UPGRADE_ID,
  SPEED_UPGRADE_ID,
  MAX_ACCESSORY_SLOTS
} from './accessories.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from './shipClasses.js'

test('catalog includes cargo / bay / hardpoint / defense / speed upgrades', () => {
  for (const id of [
    EXTRA_ORE_STORAGE_ID,
    CARGO_UPGRADE_ID,
    EXTRA_DRONE_BAY_ID,
    EXTRA_TURRET_HP_ID,
    EXTRA_LAUNCHER_HP_ID,
    ARMOUR_UPGRADE_ID,
    SPEED_UPGRADE_ID
  ]) {
    assert.ok(ACCESSORIES.some((a) => a.id === id), id)
    assert.ok(getAccessory(id).price > 0)
  }
})

test('Extra Ore Storage is +200% (3× total)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const base = shipClass.stats.miningCapacity
  assert.equal(
    effectiveMiningCapacity({ equippedAccessories: [EXTRA_ORE_STORAGE_ID] }, shipClass),
    base * 3
  )
})

test('Cargo Upgrade is +200% (3× total)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const base = shipClass.stats.cargoCapacity
  assert.equal(effectiveCargoCapacity({ equippedAccessories: [] }, shipClass), base)
  assert.equal(
    effectiveCargoCapacity({ equippedAccessories: [CARGO_UPGRADE_ID] }, shipClass),
    base * 3
  )
})

test('armour / speed upgrades scale base stats', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const ship = { equippedAccessories: [ARMOUR_UPGRADE_ID, SPEED_UPGRADE_ID] }
  assert.equal(effectiveMaxArmor(ship, shipClass), Math.round(shipClass.stats.armor * 1.25))
  assert.ok(Math.abs(effectiveMaxSpeed(ship, shipClass) - shipClass.stats.speed * 1.15) < 1e-6)
})

test('extra hardpoints and drone bay appear while fitted', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const bare = { equippedAccessories: [] }
  const fit = {
    equippedAccessories: [EXTRA_TURRET_HP_ID, EXTRA_LAUNCHER_HP_ID, EXTRA_DRONE_BAY_ID]
  }
  assert.equal(effectiveHardpoints(bare, shipClass).length, shipClass.hardpoints.length)
  assert.equal(effectiveHardpoints(fit, shipClass).length, shipClass.hardpoints.length + 2)
  assert.ok(effectiveHardpoints(fit, shipClass).some((h) => h.id === 'acc_turret'))
  assert.ok(effectiveHardpoints(fit, shipClass).some((h) => h.id === 'acc_launcher'))
  assert.equal(effectiveDroneBayCount(fit, shipClass), 1) // starter has 0 bays +1
})

test('Extra Launcher Hardpoint adds a missile mount on a laser-only hull', () => {
  // Light Runner is laser-only; accessory must still grant a launcher mount.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  assert.ok(
    shipClass.hardpoints.every((h) => h.type !== 'missile'),
    'fixture hull should have no native launchers'
  )
  const ship = { equippedAccessories: [EXTRA_LAUNCHER_HP_ID] }
  const hps = effectiveHardpoints(ship, shipClass)
  const launcher = hps.find((h) => h.id === 'acc_launcher')
  assert.ok(launcher, 'accessory launcher hardpoint present')
  assert.equal(launcher.type, 'missile')
  // Without accessory: gone.
  assert.equal(
    effectiveHardpoints({ equippedAccessories: [] }, shipClass).some((h) => h.id === 'acc_launcher'),
    false
  )
})

test('starter Light Runner has one accessory slot', () => {
  assert.equal(accessorySlotCount(getShipClass(STARTER_SHIP_CLASS_ID)), 1)
  assert.equal(defaultAccessoriesFor(getShipClass(STARTER_SHIP_CLASS_ID)).length, 1)
  for (const id of ['hold_runner', 'needle_dart', 'gun_barge', 'bravia_mk2', 'raider_mk1', 'swift_keel']) {
    const n = accessorySlotCount(getShipClass(id))
    assert.ok(n >= 1 && n <= MAX_ACCESSORY_SLOTS, `${id} slots ${n}`)
  }
})

test('normalizeAccessories pads and reports excess', () => {
  const { equipped, excess } = normalizeAccessories(['cargo_upgrade', 'cargo_upgrade', 'x'], {
    accessorySlots: 1
  })
  assert.deepEqual(equipped, ['cargo_upgrade'])
  assert.deepEqual(excess, ['cargo_upgrade', 'x'])
})

test('shipHasAccessory reads equippedAccessories', () => {
  assert.equal(shipHasAccessory({ equippedAccessories: [] }, 'cargo_upgrade'), false)
  assert.equal(shipHasAccessory({ equippedAccessories: [null, 'cargo_upgrade'] }, 'cargo_upgrade'), true)
})
