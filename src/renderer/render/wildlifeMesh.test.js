import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWildlifeMesh, createWildlifeBloodPool, updateWildlifeMesh } from './wildlifeMesh.js'
import { createWildlife, damageWildlife } from '../game/wildlife.js'

test('wildlife still gets a visible stand-in when the authored model is not loaded', () => {
  const creature = createWildlife('w-1', 'rabbit', 'island-1', [0, 1, 0])
  const mesh = buildWildlifeMesh(creature)
  assert.ok(mesh)
  assert.equal(mesh.userData.wildlifeFallback, true)
  assert.ok(mesh.children.some((child) => child.isMesh))
})

test('a dead animal mesh rolls onto its side', () => {
  const creature = createWildlife('w-2', 'dog', 'island-1', [4, 1, 2], 0.4)
  damageWildlife(creature, 999, 1)
  const mesh = buildWildlifeMesh(creature)
  updateWildlifeMesh(mesh, creature, 0.016, 2)
  assert.ok(Math.abs(Math.abs(mesh.rotation.z) - Math.PI / 2) < 0.05)
})

test('ferret and stoat stand-ins are dedicated long-bodied silhouettes', () => {
  for (const species of ['ferret', 'stoat']) {
    const creature = createWildlife(`w-${species}`, species, 'island-1', [0, 1, 0])
    const mesh = buildWildlifeMesh(creature)
    assert.equal(mesh.userData.wildlifeFallback, true)
    assert.ok(mesh.children.length >= 1)
    let parts = 0
    mesh.traverse((child) => { if (child.isMesh) parts += 1 })
    assert.ok(parts >= 6, `${species} should have a full silhouette`)
  }
})

test('a rat stand-in is a dedicated silhouette, not a thin capsule', () => {
  const creature = createWildlife('w-rat', 'rat', 'island-1', [0, 1, 0])
  const mesh = buildWildlifeMesh(creature)
  assert.equal(mesh.userData.wildlifeFallback, true)
  assert.ok(mesh.getObjectByName('wildlifeRatTail'))
  assert.ok(mesh.getObjectByName('wildlifeRatEarL'))
  assert.ok(mesh.getObjectByName('wildlifeRatEarR'))
})

test('a corpse leaves several ground blood splatters', () => {
  const pool = createWildlifeBloodPool([1, 2, 3], 'deer')
  assert.ok(pool.pool)
  assert.ok(pool.group.children.length >= 5)
  assert.ok(pool.group.children.every((child) => Math.abs(child.rotation.x + Math.PI / 2) < 1e-6))
})
