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
