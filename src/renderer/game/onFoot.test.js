import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  updateOnFootMovement,
  updateOnFootStamina,
  ON_FOOT_JUMP_SPEED,
  ON_FOOT_JUMP_TRAVEL_MULTIPLIER,
  ON_FOOT_MAX_WALKABLE_SLOPE,
  startOnFootJump,
  updateOnFootJump,
  updateOnFootFall,
  onFootFallDamage,
  boardingRangeForShip,
  withinBoardingRange,
  footstepSurfaceForIsland,
  advanceOnFootFootsteps
} from './onFoot.js'

test('on-foot movement follows WASD and stays on the supplied surface', () => {
  const state = {
    position: [0, 2, 0],
    velocity: [0, 0, 0],
    heading: 0
  }
  const keys = new Set(['KeyW', 'KeyA'])
  const moved = updateOnFootMovement(state, keys, 1, (x, z) => {
    if (x > 2.5 || z > 2.5) return null
    return 2 + x * 0.1 + z * 0.05
  }, 2)
  assert.equal(moved, true)
  assert.ok(state.position[0] > 0, 'A should strafe right in first person')
  assert.ok(state.position[2] > 0)
  assert.equal(state.position[1], 2 + state.position[0] * 0.1 + state.position[2] * 0.05)
})

test('on-foot strafe is a straight sidestep without forward drift', () => {
  const state = {
    position: [0, 2, 0],
    velocity: [0, 0, 0],
    heading: 0
  }
  const moved = updateOnFootMovement(state, new Set(['KeyA']), 1, () => 2, 2)
  assert.equal(moved, true)
  assert.equal(state.position[2], 0)
  assert.equal(state.position[0], 0.2)
})

test('boarding range ignores height and uses horizontal distance', () => {
  assert.equal(withinBoardingRange([0, 30, 0], [20, 0, 0], 24), true)
  assert.equal(withinBoardingRange([0, 0, 0], [25, 0, 0], 24), false)
})

test('boarding range expands for broad ships at the shoreline', () => {
  assert.equal(boardingRangeForShip(2), 24)
  assert.equal(boardingRangeForShip(40), 48)
})

test('on-foot stamina drains while running and locks briefly at empty', () => {
  const state = { stamina: 100, runLocked: false }
  assert.equal(updateOnFootStamina(state, 5, true), true)
  assert.equal(state.stamina, 90)

  state.stamina = 1
  assert.equal(updateOnFootStamina(state, 1, true), true)
  assert.equal(state.stamina, 0)
  assert.equal(state.runLocked, true)
  assert.equal(updateOnFootStamina(state, 5, true), false)
  assert.equal(state.stamina, 10)
  assert.equal(state.runLocked, false)
  assert.equal(updateOnFootStamina(state, 5, false), false)
  assert.equal(state.stamina, 20)
  updateOnFootStamina(state, 40, false)
  assert.equal(state.stamina, 100)
})

test('footsteps classify shore, hard islands, and living ground', () => {
  assert.equal(footstepSurfaceForIsland('scrub', 0.9), 'sand')
  assert.equal(footstepSurfaceForIsland('industrial', 0.4), 'stone')
  assert.equal(footstepSurfaceForIsland('drowned', 0.4), 'grass')
})

test('on-foot slope limit is 65 degrees', () => {
  assert.equal(Math.round(Math.atan(ON_FOOT_MAX_WALKABLE_SLOPE) * 180 / Math.PI), 65)
})

test('footstep cadence starts promptly and alternates feet', () => {
  const state = { footstepSide: 'L' }
  assert.deepEqual(advanceOnFootFootsteps(state, 0.1, { moving: true, grounded: true }), [])
  assert.deepEqual(advanceOnFootFootsteps(state, 0.1, { moving: true, grounded: true }), ['L'])
  assert.equal(state.footstepSide, 'R')
  assert.deepEqual(advanceOnFootFootsteps(state, 0.1, { moving: false, grounded: true }), [])
  assert.equal(state.footstepMoving, false)
})

test('on-foot jump rises and lands on the supplied surface', () => {
  const state = { position: [0, 3, 0], jumping: false }
  assert.equal(startOnFootJump(state), true)
  assert.equal(state.jumping, true)
  assert.equal(state.verticalVelocity, ON_FOOT_JUMP_SPEED)
  assert.ok(ON_FOOT_JUMP_SPEED < 9.6)
  assert.ok(ON_FOOT_JUMP_TRAVEL_MULTIPLIER > 1)
  updateOnFootJump(state, 0.2, 3)
  assert.ok(state.position[1] > 3)

  for (let i = 0; i < 20 && state.jumping; i++) updateOnFootJump(state, 0.1, 3)
  assert.equal(state.jumping, false)
  assert.equal(state.position[1], 3)
})

test('on-foot jump lands on its launch floor when shoreline sampling fails', () => {
  const state = { position: [0, 3, 0], jumping: false, grounded: true }
  assert.equal(startOnFootJump(state), true)
  for (let i = 0; i < 40 && state.jumping; i++) updateOnFootJump(state, 0.1, null)
  assert.equal(state.jumping, false)
  assert.equal(state.grounded, true)
  assert.equal(state.position[1], 3)
  assert.equal(startOnFootJump(state), true)
})

test('jumping down a large drop records fall distance for damage', () => {
  const state = { position: [0, 8, 0], jumping: false, grounded: true }
  assert.equal(startOnFootJump(state), true)
  for (let i = 0; i < 40 && state.jumping; i++) updateOnFootJump(state, 0.1, 0)
  assert.equal(state.jumping, false)
  assert.equal(state.jumpLandingDistance, 8)
  assert.equal(onFootFallDamage(state.jumpLandingDistance), 18)
})

test('walking off a ledge starts a fall instead of pinning to the edge', () => {
  const state = {
    position: [0, 4, 0],
    velocity: [0, 0, 0],
    heading: 0,
    grounded: true,
    falling: false
  }
  updateOnFootMovement(state, new Set(['KeyW']), 0.2, () => null, 5, false, () => true)
  assert.equal(state.falling, true)
  assert.ok(state.position[2] > 0)
})

test('falling lands with a modest distance-based damage amount', () => {
  const state = {
    position: [0, 8, 0],
    falling: true,
    fallStartY: 8,
    verticalVelocity: -12,
    grounded: false
  }
  let landing = { landed: false, fallDistance: 0 }
  for (let i = 0; i < 20 && !landing.landed; i++) landing = updateOnFootFall(state, 0.1, 0)
  assert.equal(landing.landed, true)
  assert.equal(landing.fallDistance, 8)
  assert.equal(onFootFallDamage(3), 0)
  assert.equal(onFootFallDamage(8), 18)
})
