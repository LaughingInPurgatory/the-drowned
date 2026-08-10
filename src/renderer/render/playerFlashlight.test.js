import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlayerFlashlight, setPlayerFlashlightOn } from './playerFlashlight.js'

test('player headlamp uses light without visible first-person geometry', () => {
  const flashlight = buildPlayerFlashlight()
  assert.ok(flashlight.housing.geometry.parameters.radius <= 0.03)
  assert.ok(flashlight.glow.geometry.parameters.radius <= 0.06)
  assert.ok(flashlight.beam.geometry.parameters.radiusTop <= 1.4)
  assert.equal(flashlight.enabled, false)
  assert.equal(flashlight.beam.visible, false)
  assert.equal(setPlayerFlashlightOn(flashlight, true), true)
  assert.equal(flashlight.enabled, true)
  assert.equal(flashlight.housing.visible, false)
  assert.equal(flashlight.glow.visible, false)
  assert.equal(flashlight.beam.visible, false)
  assert.ok(flashlight.spot.intensity > 0)
  assert.ok(flashlight.spot.distance >= 500)
  assert.ok(flashlight.spot.penumbra >= 0.6)
  assert.ok(flashlight.spot.map?.isDataTexture)
  assert.ok(new Set(flashlight.spot.map.image.data).size > 8)
  assert.equal(setPlayerFlashlightOn(flashlight, false), false)
  assert.equal(flashlight.beam.visible, false)
  assert.equal(flashlight.spot.intensity, 0)
})
