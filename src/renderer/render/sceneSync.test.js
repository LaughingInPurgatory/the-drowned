import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  AIM_LOOK_AHEAD,
  getShipAimPoint,
  getReticleAimPoint,
  syncChaseCamera,
  resetChaseCameraState,
  orientCameraToward
} from './sceneSync.js'

test('getReticleAimPoint matches ship boresight when chase cam is synced', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 2e6)
  // Yaw only. The seat now follows heading rather than the full hull pose, so
  // the two agree exactly for a hull sitting level — which is the case the
  // reticle contract is actually about.
  const ship = {
    position: [10, 0, -30],
    quaternion: new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.5)
      .toArray()
  }
  resetChaseCameraState()
  syncChaseCamera(camera, ship, { forceSnap: true })

  const bore = getShipAimPoint(ship, new THREE.Vector3(), AIM_LOOK_AHEAD)
  const reticle = getReticleAimPoint(camera, ship, new THREE.Vector3(), AIM_LOOK_AHEAD)
  assert.ok(bore.distanceTo(reticle) < 1e-4, 'reticle ray aim must equal boresight under synced seat')

  const ndc = reticle.clone().project(camera)
  assert.ok(Math.abs(ndc.x) < 1e-5, 'reticle aim projects to screen center X')
  assert.ok(Math.abs(ndc.y) < 1e-5, 'reticle aim projects to screen center Y')
})

test('getReticleAimPoint does not clobber shared temps across calls', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2e6)
  const ship = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  resetChaseCameraState()
  syncChaseCamera(camera, ship, { forceSnap: true })

  const a = getReticleAimPoint(camera, ship, new THREE.Vector3(), AIM_LOOK_AHEAD)
  const b = getShipAimPoint(ship, new THREE.Vector3(), AIM_LOOK_AHEAD)
  const c = getReticleAimPoint(camera, ship, new THREE.Vector3(), AIM_LOOK_AHEAD)
  assert.ok(a.distanceTo(b) < 1e-4)
  assert.ok(c.distanceTo(b) < 1e-4)
})

test('orientCameraToward keeps aim on screen center even when up ≈ view axis', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 2e6)
  // Eye above target with world-up nearly along the view (classic lookAt gimbal case).
  camera.position.set(0, 100, 0)
  const target = new THREE.Vector3(0, 0, 0)
  const up = new THREE.Vector3(0, 1, 0)
  orientCameraToward(camera, target, up)
  camera.updateMatrixWorld(true)
  const ndc = target.clone().project(camera)
  assert.ok(Math.abs(ndc.x) < 1e-4, `expected center X, got ${ndc.x}`)
  assert.ok(Math.abs(ndc.y) < 1e-4, `expected center Y, got ${ndc.y}`)
})

test('wave tilt moves the boresight off centre, but never far', () => {
  // A hull riding a sea is pitched and heeled every frame. The seat follows
  // heading only, deliberately — chasing the full pose would shake the camera
  // with the swell. So the boresight does wander off the reticle a little, and
  // the thing worth pinning is that it stays a *little*: aim must not be
  // thrown across the screen every time the bow lifts.
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 2e6)
  const worst = { x: 0, y: 0 }
  // Realistic hull attitudes: trim under power is capped at 0.09 rad and the
  // wave tilt on top of it is small; heel into a hard turn is the big one, and
  // heel does not move the bow off the reticle at all.
  for (const pitch of [-0.14, 0, 0.14]) {
    for (const roll of [-0.42, 0, 0.42]) {
      const ship = {
        position: [0, 0, 0],
        quaternion: new THREE.Quaternion()
          .setFromEuler(new THREE.Euler(pitch, 0.3, roll, 'YXZ'))
          .toArray()
      }
      resetChaseCameraState()
      syncChaseCamera(camera, ship, { forceSnap: true })
      const ndc = getShipAimPoint(ship, new THREE.Vector3(), AIM_LOOK_AHEAD).project(camera)
      worst.x = Math.max(worst.x, Math.abs(ndc.x))
      worst.y = Math.max(worst.y, Math.abs(ndc.y))
    }
  }
  assert.ok(worst.x < 0.25, `boresight wandered ${worst.x} across screen`)
  assert.ok(worst.y < 0.25, `boresight wandered ${worst.y} up screen`)
  // And it does not matter much anyway: the player fires at the reticle point,
  // not down the bow. This test is a guard on the camera staying sane, not on
  // where the shells go.
})
