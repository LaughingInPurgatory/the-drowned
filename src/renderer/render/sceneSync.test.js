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
  const ship = {
    position: [10, 20, -30],
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.5, 0.1)).toArray()
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

test('chase cam after pitch loop still projects boresight to center', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 2e6)
  // Nose nearly straight up — ship up nearly parallel to cam→aim.
  const ship = {
    position: [0, 0, 0],
    quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(1.4, 0.3, 0.5, 'YXZ')).toArray()
  }
  resetChaseCameraState()
  syncChaseCamera(camera, ship, { forceSnap: true })
  const aim = getShipAimPoint(ship, new THREE.Vector3(), AIM_LOOK_AHEAD)
  const ndc = aim.project(camera)
  assert.ok(Math.abs(ndc.x) < 1e-3, `boresight X after pitch: ${ndc.x}`)
  assert.ok(Math.abs(ndc.y) < 1e-3, `boresight Y after pitch: ${ndc.y}`)
})
