import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createLensFlare } from './lensFlare.js'

/**
 * The flare's placement logic, which is the part that can be wrong in ways you
 * only notice as a smear hanging in the wrong half of the screen.
 */

function cameraLookingAt(dir) {
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 50000)
  cam.position.set(0, 10, 0)
  cam.lookAt(new THREE.Vector3().copy(cam.position).add(dir))
  cam.updateMatrixWorld(true)
  return cam
}

const AHEAD = new THREE.Vector3(0, 0, 1)

function sunAt(elevationY, x = 0) {
  return new THREE.Vector3(x, elevationY, 1).normalize()
}

test('a sun ahead and up puts a flare on screen', () => {
  const flare = createLensFlare()
  flare.update(cameraLookingAt(AHEAD), sunAt(0.3), { aspect: 16 / 9 })
  assert.ok(flare.visible, 'expected a flare with the sun in frame')
})

test('no flare once the sun is below the horizon', () => {
  const flare = createLensFlare()
  flare.update(cameraLookingAt(AHEAD), sunAt(-0.2), { aspect: 16 / 9 })
  assert.ok(!flare.visible, 'the sun has set; there is nothing to flare')
})

test('no flare from a sun behind the camera', () => {
  // The failure this guards: projecting a point behind the camera wraps it to
  // the opposite side of the screen, so a sun directly astern would hang a
  // bright smear in front of you.
  const flare = createLensFlare()
  const sunBehind = new THREE.Vector3(0, 0.3, -1).normalize()
  flare.update(cameraLookingAt(AHEAD), sunBehind, { aspect: 16 / 9 })
  assert.ok(!flare.visible, 'a sun astern must not flare')
})

test('the flare fades out as the sun leaves the frame rather than cutting', () => {
  const flare = createLensFlare()
  const cam = cameraLookingAt(AHEAD)

  const strengths = []
  for (const x of [0, 0.6, 1.4, 3.0]) {
    flare.update(cam, sunAt(0.25, x), { aspect: 16 / 9 })
    strengths.push(flare.visible)
  }
  assert.equal(strengths[0], true, 'dead ahead should flare')
  assert.equal(strengths[3], false, 'far off to the side should not')
})

test('turning away from the sun kills the flare', () => {
  const flare = createLensFlare()
  const sun = sunAt(0.3)
  flare.update(cameraLookingAt(AHEAD), sun, { aspect: 16 / 9 })
  assert.ok(flare.visible)
  flare.update(cameraLookingAt(new THREE.Vector3(0, 0, -1)), sun, { aspect: 16 / 9 })
  assert.ok(!flare.visible, 'the sun is now astern')
})

test('strength 0 disables it outright', () => {
  const flare = createLensFlare()
  flare.update(cameraLookingAt(AHEAD), sunAt(0.3), { aspect: 16 / 9, strength: 0 })
  assert.ok(!flare.visible)
})
