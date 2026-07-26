import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHailResponse } from './hail.js'

test('same NPC id always returns the same line (no slot-machine re-hailing)', () => {
  const npc = { id: 'pirate-42', faction: 'pirate', pilotName: 'Rax' }
  const a = buildHailResponse(npc)
  const b = buildHailResponse(npc)
  assert.deepEqual(a, b)
})

test('faction routes to the matching line pool', () => {
  const { line } = buildHailResponse({ id: 'x', faction: 'police', pilotName: 'Warden' })
  assert.equal(typeof line, 'string')
  assert.ok(line.length > 0)
})

test('alien NPCs never fall back to a human line pool', () => {
  const { speaker, line } = buildHailResponse({ id: 'alien-1', isAlien: true })
  assert.equal(speaker, 'Unknown Vessel')
  // Alien lines are all bracketed/em-dash flavour text, never plain human dialogue.
  assert.ok(/[[—]/.test(line), `expected alien flavour text, got: ${line}`)
})

test('unnamed non-alien NPC falls back to a generic speaker label', () => {
  const { speaker } = buildHailResponse({ id: 'unknown-npc' })
  assert.equal(speaker, 'Unidentified Pilot')
})

test('an unknown/invalid shipClassId does not throw', () => {
  assert.doesNotThrow(() => buildHailResponse({ id: 'y', shipClassId: 'not-a-real-class' }))
})
