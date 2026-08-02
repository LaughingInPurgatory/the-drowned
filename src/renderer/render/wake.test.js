import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createWake } from './wake.js'

test('wake stays visible for a moving enlarged saved hull', () => {
  const wake = createWake()

  wake.update([0, 0, 0], 0, 1, 51, 4.6, 0, 1 / 60)

  const trail = wake.group.getObjectByName('wake-trail-foam')
  const bowLeft = wake.group.getObjectByName('wake-bow-0')
  const bowRight = wake.group.getObjectByName('wake-bow-1')
  assert.ok(trail)
  assert.ok(bowLeft)
  assert.ok(bowRight)
  assert.equal(trail.material.type, 'ShaderMaterial')
  assert.equal(trail.material.depthTest, true)
  assert.equal(trail.material.depthWrite, false)
  assert.equal(trail.material.depthFunc, THREE.LessDepth)
  assert.equal(wake.group.renderOrder, 0.5)
  assert.equal(trail.visible, true)
  assert.equal(bowLeft.visible, true)
  assert.equal(bowRight.visible, true)
  const fade = trail.geometry.getAttribute('aFade').array
  assert.ok(fade[0] > fade[fade.length - 2])
  assert.ok(trail.geometry.index.count > 0)

  wake.dispose()
})
