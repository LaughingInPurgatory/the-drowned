import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createGullFlock, gullFlockActiveAt, tryHitGullFlock, updateGullFlock } from './seagullMesh.js'

test('gulls visit briefly rather than remaining overhead', () => {
  assert.equal(gullFlockActiveAt(4), true)
  assert.equal(gullFlockActiveAt(25), false)
  assert.equal(gullFlockActiveAt(74), true)
})

test('a shot through a nearby gull makes the flock scatter', () => {
  const flock = createGullFlock()
  updateGullFlock(flock, [0, 0, 0], 4)
  flock.updateWorldMatrix(true, true)
  const gullPosition = flock.children[0].getWorldPosition(new THREE.Vector3())
  const from = gullPosition.clone().add(new THREE.Vector3(0, 0, -3))
  const to = gullPosition.clone().add(new THREE.Vector3(0, 0, 3))

  assert.equal(tryHitGullFlock(flock, from, to, 4), true)
  assert.equal(flock.children[0].visible, false)
  assert.ok(flock.userData.fleeUntil > 4)
})

test('a shot through the flock centre scatters birds between individual gulls', () => {
  const flock = createGullFlock()
  updateGullFlock(flock, [0, 0, 0], 4)
  flock.updateWorldMatrix(true, true)
  const from = flock.position.clone().add(new THREE.Vector3(-4, 0, 0))
  const to = flock.position.clone().add(new THREE.Vector3(4, 0, 0))

  assert.equal(tryHitGullFlock(flock, from, to, 4), true)
  assert.ok(flock.userData.fleeUntil > 4)
  assert.equal(flock.userData.lastSquawkAt, 4)
})

test('a shot outside the flock envelope does not trigger a scatter', () => {
  const flock = createGullFlock()
  updateGullFlock(flock, [0, 0, 0], 4)
  flock.updateWorldMatrix(true, true)
  const from = flock.position.clone().add(new THREE.Vector3(0, 30, 0))
  const to = flock.position.clone().add(new THREE.Vector3(0, 40, 0))

  assert.equal(tryHitGullFlock(flock, from, to, 4), false)
  assert.equal(flock.userData.fleeUntil, -Infinity)
})
