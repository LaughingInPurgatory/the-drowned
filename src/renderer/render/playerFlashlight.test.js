import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlayerFlashlight, setPlayerFlashlightOn } from './playerFlashlight.js'

test('player flashlight toggles its housing, beam, and lamp together', () => {
  const flashlight = buildPlayerFlashlight()
  assert.ok(flashlight.housing.geometry.parameters.radius <= 0.03)
  assert.ok(flashlight.glow.geometry.parameters.radius <= 0.06)
  assert.ok(flashlight.beam.geometry.parameters.radiusTop <= 1.4)
  assert.equal(flashlight.enabled, false)
  assert.equal(flashlight.beam.visible, false)
  assert.equal(setPlayerFlashlightOn(flashlight, true), true)
  assert.equal(flashlight.enabled, true)
  assert.equal(flashlight.beam.visible, true)
  assert.ok(flashlight.spot.intensity > 0)
  assert.equal(setPlayerFlashlightOn(flashlight, false), false)
  assert.equal(flashlight.beam.visible, false)
  assert.equal(flashlight.spot.intensity, 0)
})
