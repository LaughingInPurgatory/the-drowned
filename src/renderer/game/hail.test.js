import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCollisionResponse, buildHailResponse } from './hail.js'

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

test('Drowned NPCs use pre-war military hail lines, not corsair banter', () => {
  const { speaker, line } = buildHailResponse({ id: 'alien-1', isAlien: true })
  assert.equal(speaker, 'Drowned Contact')
  assert.ok(line.length > 0)
  // Old sci-fi harmonic lines are gone; corsair banter is a different pool.
  assert.ok(!/UNTRANSLATABLE|resonant hum|structured static/i.test(line), line)
  assert.ok(!/Cargo or plasma|toll road/i.test(line), line)
  // Same path via faction id.
  const byFaction = buildHailResponse({ id: 'alien-2', faction: 'alien' })
  assert.equal(byFaction.speaker, 'Drowned Contact')
  assert.ok(byFaction.line.length > 0)
})

test('unnamed non-alien NPC falls back to a generic speaker label', () => {
  const { speaker } = buildHailResponse({ id: 'unknown-npc' })
  assert.equal(speaker, 'Unidentified Pilot')
})

test('an unknown/invalid shipClassId does not throw', () => {
  assert.doesNotThrow(() => buildHailResponse({ id: 'y', shipClassId: 'not-a-real-class' }))
})

test('every collision faction has twenty random, faction-specific puns', () => {
  for (const faction of ['pirate', 'police', 'trader', 'alien']) {
    const lines = new Set()
    for (let index = 0; index < 20; index++) {
      lines.add(buildCollisionResponse({ faction }, () => (index + 0.1) / 20).line)
    }
    assert.equal(lines.size, 20, `${faction} needs twenty distinct collision lines`)
  }
})
