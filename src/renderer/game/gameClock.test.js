import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  initGameClock,
  advanceGameClock,
  applyOfflineTime,
  reanchorGameClock
} from './gameClock.js'

test('initGameClock starts at simTime 0 anchored to wall now', () => {
  const gs = {}
  const now = 1_700_000_000_000
  initGameClock(gs, now)
  assert.equal(gs.simTime, 0)
  assert.equal(gs.simClockOriginMs, now)
  assert.equal(advanceGameClock(gs, now + 5000), 5)
})

test('applyOfflineTime adds wall seconds since save', () => {
  const gs = { simTime: 100 }
  const savedAt = 1_700_000_000_000
  const now = savedAt + 3600 * 1000 // +1 hour
  const offline = applyOfflineTime(gs, now, savedAt)
  assert.equal(offline, 3600)
  assert.equal(gs.simTime, 3700)
  assert.ok(Math.abs(advanceGameClock(gs, now) - 3700) < 0.001)
})

test('reanchorGameClock freezes simTime across wall jumps until advance', () => {
  const gs = { simTime: 50 }
  reanchorGameClock(gs, 1000)
  assert.equal(gs.simClockOriginMs, 1000 - 50_000)
  // Pause-like freeze: advance not called; simTime stays 50
  assert.equal(gs.simTime, 50)
  // Resume later: reanchor then advance
  reanchorGameClock(gs, 999_000)
  assert.equal(advanceGameClock(gs, 999_000 + 2000), 52)
})
