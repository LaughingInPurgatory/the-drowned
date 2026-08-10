import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildProjectileMesh } from './projectileMesh.js'

test('missiles are substantial opaque world geometry', () => {
  const missile = buildProjectileMesh('torpedo', 'missile')
  const bounds = new THREE.Box3().setFromObject(missile)
  assert.ok(bounds.max.x - bounds.min.x > 1)
  assert.ok(bounds.max.z - bounds.min.z > 5)

  let opaqueMeshes = 0
  missile.traverse((part) => {
    if (!part.isMesh || part.material.transparent) return
    opaqueMeshes += 1
    assert.equal(part.material.depthTest, true)
    assert.equal(part.material.depthWrite, true)
  })
  assert.ok(opaqueMeshes >= 8)
})
