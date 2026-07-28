import test from 'node:test'
import assert from 'node:assert/strict'
import { formatFaction } from './deathScreen.js'

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
