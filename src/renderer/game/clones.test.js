import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  maxCloneCapacity,
  canCloneJump,
  createClone,
  jumpToClone,
  ensureClones,
  stationHasCloneBay,
  CLONE_CREATE_COST,
  CLONE_JUMP_COST
} from './clones.js'

function makeGs(skills = {}) {
  return {
    simTime: 0,
    player: {
      credits: 500_000,
      currentSystemId: 'sys-a',
      dockedBodyId: null,
      dockedExteriorPosition: null,
      skills: { cloning: 0, ...skills },
      clones: [],
      ship: {
        position: [100, 0, 200],
        velocity: [1, 0, 0],
        throttle: 0.5
      }
    },
    galaxy: {
      systems: [
        { id: 'sys-a', name: 'Alpha', bodies: [] },
        { id: 'sys-b', name: 'Beta', bodies: [] }
      ]
    }
  }
}

test('capacity is 1 + Cloning skill', () => {
  assert.equal(maxCloneCapacity(makeGs({ cloning: 0 })), 1)
  assert.equal(maxCloneCapacity(makeGs({ cloning: 3 })), 4)
})

test('clone jump locked at Cloning 0', () => {
  assert.equal(canCloneJump(makeGs({ cloning: 0 })), false)
  assert.equal(canCloneJump(makeGs({ cloning: 1 })), true)
})

test('createClone costs credits and fills a slot', () => {
  const gs = makeGs({ cloning: 0 })
  const before = gs.player.credits
  createClone(gs)
  assert.equal(gs.player.clones.length, 1)
  assert.equal(gs.player.credits, before - CLONE_CREATE_COST)
  assert.throws(() => createClone(gs), /capacity full/i)
})

test('jumpToClone moves player, places origin clone, clears destination', () => {
  const gs = makeGs({ cloning: 1 })
  gs.player.clones = [
    {
      id: 'c1',
      systemId: 'sys-b',
      position: [9, 9, 9],
      stationId: null,
      label: 'Beta'
    }
  ]
  const before = gs.player.credits
  jumpToClone(gs, 'c1')
  assert.equal(gs.player.currentSystemId, 'sys-b')
  assert.deepEqual(gs.player.ship.position, [9, 9, 9])
  assert.equal(gs.player.credits, before - CLONE_JUMP_COST)
  // Destination cleared; origin has a new clone.
  assert.equal(gs.player.clones.length, 1)
  assert.equal(gs.player.clones[0].systemId, 'sys-a')
  assert.deepEqual(gs.player.clones[0].position, [100, 0, 200])
})

test('jump blocked without Cloning skill', () => {
  const gs = makeGs({ cloning: 0 })
  gs.player.clones = [
    { id: 'c1', systemId: 'sys-b', position: [1, 2, 3], stationId: null, label: 'x' }
  ]
  assert.throws(() => jumpToClone(gs, 'c1'), /Cloning skill/i)
})

test('stationHasCloneBay is deterministic', () => {
  assert.equal(stationHasCloneBay('body-1'), stationHasCloneBay('body-1'))
  // Roughly 30% — sample should not be all true or all false.
  let n = 0
  for (let i = 0; i < 200; i++) if (stationHasCloneBay(`body-${i}`)) n++
  assert.ok(n > 20 && n < 120, `expected ~30% hit rate, got ${n}/200`)
})

test('ensureClones initializes array', () => {
  const gs = { player: {} }
  ensureClones(gs)
  assert.deepEqual(gs.player.clones, [])
})
