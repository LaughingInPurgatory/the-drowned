import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WEAPONS, BASE_WEAPON_ID, getWeapon, weaponsForCategory, defaultLoadoutFor } from './weapons.js'

test('every weapon has a unique id and a valid category', () => {
  const ids = new Set()
  for (const w of WEAPONS) {
    assert.ok(!ids.has(w.id), `duplicate weapon id ${w.id}`)
    ids.add(w.id)
    assert.ok(['laser', 'missile'].includes(w.category))
    assert.ok(w.price >= 0)
    assert.ok(w.damage > 0 && w.speed > 0 && w.cooldownS > 0 && w.ttl > 0)
  }
})

test('base weapons are free and match their category', () => {
  assert.equal(getWeapon(BASE_WEAPON_ID.laser).price, 0)
  assert.equal(getWeapon(BASE_WEAPON_ID.laser).category, 'laser')
  assert.equal(getWeapon(BASE_WEAPON_ID.missile).price, 0)
  assert.equal(getWeapon(BASE_WEAPON_ID.missile).category, 'missile')
})

test('weaponsForCategory only returns matching weapons', () => {
  for (const w of weaponsForCategory('missile')) assert.equal(w.category, 'missile')
  assert.ok(weaponsForCategory('laser').length > 1)
})

test('defaultLoadoutFor equips every hardpoint with its category base weapon', () => {
  const shipClass = { hardpoints: [{ id: 'fwd1', type: 'laser' }, { id: 'fwd2', type: 'missile' }] }
  const loadout = defaultLoadoutFor(shipClass)
  assert.equal(loadout.fwd1, BASE_WEAPON_ID.laser)
  assert.equal(loadout.fwd2, BASE_WEAPON_ID.missile)
})

test('getWeapon throws on an unknown id', () => {
  assert.throws(() => getWeapon('nonexistent'), /Unknown weapon/)
})

test('alien weapons are never sold in market helpers', async () => {
  const { WEAPONS, purchasableWeapons, weaponsForCategory, isAlienWeapon, defaultLoadoutFor } = await import('./weapons.js')
  const { ALIEN_SHIP_CLASSES } = await import('./shipClasses.js')
  assert.ok(WEAPONS.some((w) => w.alien))
  assert.equal(purchasableWeapons().some((w) => w.alien), false)
  assert.equal(weaponsForCategory('laser').some((w) => w.alien), false)
  assert.equal(isAlienWeapon('void_lance'), true)
  const load = defaultLoadoutFor(ALIEN_SHIP_CLASSES[0])
  assert.equal(load.fwd1, 'phase_spit')
})
