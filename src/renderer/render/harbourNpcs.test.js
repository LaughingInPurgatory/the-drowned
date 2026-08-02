import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildHarbourMesh } from './harbourMesh.js'
import { buildHarbourNpcGroup, updateHarbourNpcGroup, HARBOUR_NPC_LIMITS } from './harbourNpcs.js'

function port(id) {
  return { id, kind: 'port', position: [0, 0, 0] }
}

test('ports get deterministic 2–4 varied, animated pedestrian avatars', () => {
  const body = port('port-test-pedestrians')
  const harbour = buildHarbourMesh(body)
  harbour.scale.setScalar(1.7)
  const first = buildHarbourNpcGroup(body, harbour)
  const second = buildHarbourNpcGroup(body, harbour)
  assert.ok(first)
  assert.equal(first.userData.npcs.length, second.userData.npcs.length)
  assert.ok(first.userData.npcs.length >= HARBOUR_NPC_LIMITS.min)
  assert.ok(first.userData.npcs.length <= HARBOUR_NPC_LIMITS.max)
  assert.deepEqual(
    first.userData.npcs.map((npc) => npc.userData.avatarParts),
    second.userData.npcs.map((npc) => npc.userData.avatarParts)
  )
  const materials = []
  first.userData.npcs[0].traverse((child) => {
    if (child.isMesh && child.material) materials.push(child.material)
  })
  assert.ok(materials.length > 0)
  assert.ok(materials.every((material) => material.type === 'MeshStandardMaterial' && material.toneMapped !== false))
  harbour.add(first)
  const before = first.userData.npcs.map((npc) => [...npc.userData.harbourNpcState.position])
  updateHarbourNpcGroup(first, 0.1)
  assert.ok(first.userData.npcs.some((npc, i) => npc.userData.harbourNpcState.position[0] !== before[i][0] || npc.userData.harbourNpcState.position[2] !== before[i][2]))
  for (const npc of first.userData.npcs) {
    const state = npc.userData.harbourNpcState
    const routeVelocity = Math.hypot(state.velocity[0], state.velocity[2])
    assert.ok(Math.abs(routeVelocity - state.routeSpeed) < 1e-6)
  }
})

test('outposts do not receive harbour-deck pedestrian groups', () => {
  const body = { id: 'outpost-test-pedestrians', kind: 'outpost', position: [0, 0, 0] }
  const harbour = buildHarbourMesh(body)
  assert.equal(buildHarbourNpcGroup(body, harbour), null)
})
