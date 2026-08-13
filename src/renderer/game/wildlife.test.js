import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createWildlife,
  damageWildlife,
  hitWildlifeSegment,
  updateWildlifeDogAttacks,
  updateWildlife,
  wildlifeStepInterval,
  WILDLIFE_CORPSE_DURATION_S
} from './wildlife.js'

test('wildlife step interval follows stride over speed', () => {
  assert.ok(wildlifeStepInterval('rabbit') > 0.2)
  assert.ok(wildlifeStepInterval('deer') > wildlifeStepInterval('rat'))
})

test('wildlife wanders on a valid island surface', () => {
  const animal = createWildlife('rabbit-1', 'rabbit', 'island-1', [0, 2, 0], 0)
  updateWildlife([animal], 1, 1, () => 4, () => 0.5)
  assert.equal(animal.position[1], 4.015)
  assert.ok(animal.position[2] > 0)
  assert.equal(animal.moving, true)
  assert.ok(animal.walkPhase > 0)
  assert.equal(animal.stepped, true)
})

test('wildlife turns around instead of walking into water', () => {
  const animal = createWildlife('dog-1', 'dog', 'island-1', [0, 2, 0], 0)
  updateWildlife([animal], 1, 1, () => null, () => 0.5)
  assert.deepEqual(animal.position, [0, 2, 0])
  assert.notEqual(animal.heading, 0)
})

test('a kill lays the animal on a side', () => {
  const animal = createWildlife('deer-1', 'deer', 'island-1', [0, 1, 0], 2.2)
  assert.equal(damageWildlife(animal, 999, 4), true)
  assert.equal(animal.state, 'dead')
  assert.ok(animal.fallSide === 1 || animal.fallSide === -1)
})

test('projectile segment damages the nearest creature and kills it', () => {
  const near = createWildlife('near', 'rabbit', 'island-1', [0, 1, 5], 0)
  const far = createWildlife('far', 'deer', 'island-1', [0, 1, 8], 0)
  const hit = hitWildlifeSegment([near, far], [0, 1, 0], [0, 1, 20], 100, 3)
  assert.equal(hit.creature.id, 'near')
  assert.equal(hit.killed, true)
  assert.equal(hit.corpse, false)
  assert.equal(near.state, 'dead')
  assert.equal(far.state, 'alive')
})

test('a corpse still takes shots until it despawns', () => {
  const animal = createWildlife('body-1', 'rabbit', 'island-1', [0, 1, 4], 0)
  damageWildlife(animal, 999, 1)
  const hit = hitWildlifeSegment([animal], [0, 1, 0], [0, 1, 20], 10, 2)
  assert.equal(hit.corpse, true)
  assert.equal(hit.killed, false)
  assert.equal(animal.state, 'dead')
  animal.state = 'respawning'
  assert.equal(hitWildlifeSegment([animal], [0, 1, 0], [0, 1, 20], 10, 3), null)
})

test('dead wildlife becomes eligible for delayed replacement after corpse time', () => {
  const animal = createWildlife('cat-1', 'cat', 'island-1', [0, 1, 0])
  assert.equal(damageWildlife(animal, 999, 2), true)
  updateWildlife([animal], WILDLIFE_CORPSE_DURATION_S + 0.1, 2 + WILDLIFE_CORPSE_DURATION_S + 0.1, () => 1)
  assert.equal(animal.state, 'respawning')
})

test('only nearby dogs make one 60% bite attempt every two seconds', () => {
  const dog = createWildlife('dog-1', 'dog', 'island-1', [0, 1, 1.4])
  const other = createWildlife('cat-1', 'cat', 'island-1', [0, 1, 1.4])
  assert.equal(updateWildlifeDogAttacks([dog, other], [0, 1, 0], 0, () => 0.5).length, 1)
  assert.equal(updateWildlifeDogAttacks([dog], [0, 1, 0], 1, () => 0).length, 0)
  assert.equal(updateWildlifeDogAttacks([dog], [0, 1, 0], 2, () => 0).length, 1)
  assert.equal(updateWildlifeDogAttacks([dog], [20, 1, 0], 4, () => 0).length, 0)
})

test('a dog still lunges when the bite misses', () => {
  const dog = createWildlife('dog-2', 'dog', 'island-1', [0, 1, 1.4])
  const attacks = updateWildlifeDogAttacks([dog], [0, 1, 0], 0, () => 0.95)
  assert.equal(attacks.length, 1)
  assert.equal(attacks[0].damage, 0)
})

test('dogs do not bite from five metres away', () => {
  const dog = createWildlife('dog-3', 'dog', 'island-1', [0, 1, 5])
  assert.equal(updateWildlifeDogAttacks([dog], [0, 1, 0], 0, () => 0).length, 0)
})

test('some boars are hostile and can attack up close', () => {
  const boar = createWildlife('boar-1', 'boar', 'island-1', [0, 1, 1.5], 0, 0, () => 0.1)
  assert.equal(boar.hostile, true)
  const attacks = updateWildlifeDogAttacks([boar], [0, 1, 0], 0, () => 0.5)
  assert.equal(attacks.length, 1)
  assert.equal(attacks[0].threat, 'grunt')
})
