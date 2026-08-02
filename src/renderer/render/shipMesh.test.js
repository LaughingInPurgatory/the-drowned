import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { buildShipMesh } from './shipMesh.js'

test('ship hulls and lit superstructure participate in shadows', () => {
  const ship = buildShipMesh(getShipClass(STARTER_SHIP_CLASS_ID))
  const shadowMeshes = []
  ship.traverse((child) => {
    if (child.isMesh && child.material?.isMeshStandardMaterial) shadowMeshes.push(child)
  })
  assert.ok(shadowMeshes.length > 5, 'expected hull and fittings in the shadow pass')
  assert.ok(shadowMeshes.every((child) => child.castShadow && child.receiveShadow))
})
