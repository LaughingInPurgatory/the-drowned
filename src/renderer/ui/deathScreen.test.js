import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACIDIC_SEA_DEATH_PUNS,
  formatDeathCause,
  formatFaction,
  pickDeathPun,
  shouldShowDeathContact
} from './deathScreen.js'

/**
 * Faction ids are internal and several of them are left over from the space
 * build. `police` is the one that matters: there is no police force on this
 * sea, and being told one sank you breaks the setting at the exact moment the
 * player is paying most attention.
 */

test('internal faction ids are never shown to the player raw', () => {
  assert.equal(formatFaction('police'), 'Coast Guard')
  assert.equal(formatFaction('pirate'), 'Corsair')
  assert.equal(formatFaction('trader'), 'Merchant')
  assert.equal(formatFaction('alien'), 'The Drowned')
})

test('an unmapped faction still reads as a name, not an id', () => {
  assert.equal(formatFaction('smuggler'), 'Smuggler')
})

test('no faction shows nothing rather than the word null', () => {
  assert.equal(formatFaction(null), null)
  assert.equal(formatFaction(undefined), null)
  assert.equal(formatFaction(''), null)
})

test('acidic seawater gets a clear death-screen label', () => {
  assert.equal(formatDeathCause('Killed by acidic seawater'), 'Acidic seawater exposure')
  assert.equal(formatDeathCause('Ship destroyed in combat'), 'Ship destroyed in combat')
  assert.equal(formatDeathCause(null), null)
})

test('acidic seawater deaths do not show a contact attribution', () => {
  assert.equal(shouldShowDeathContact('Killed by acidic seawater'), false)
  assert.equal(shouldShowDeathContact('Acidic seawater exposure'), false)
  assert.equal(shouldShowDeathContact('Ship destroyed in combat'), true)
})

test('acidic seawater deaths choose from twenty dedicated puns', () => {
  assert.equal(ACIDIC_SEA_DEATH_PUNS.length, 20)
  for (let i = 0; i < 20; i++) {
    assert.ok(ACIDIC_SEA_DEATH_PUNS.includes(pickDeathPun('Killed by acidic seawater')))
  }
})
