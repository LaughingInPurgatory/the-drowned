import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { updateFlight } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

function freshShipState() {
  return { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function noMouse() {
  return { dx: 0, dy: 0 }
}

test('holding W ramps the throttle up and accelerates the ship, respecting max speed', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  const keys = new Set(['KeyW'])
  for (let i = 0; i < 600; i++) updateFlight(shipState, shipClass, keys, noMouse(), 1 / 60)

  const speed = Math.hypot(...shipState.velocity)
  assert.equal(shipState.throttle, 1, 'throttle should ramp all the way up under sustained W')
  assert.ok(speed > 0, 'ship should be moving after sustained thrust')
  assert.ok(speed <= shipClass.stats.speed + 1e-6, 'speed should not exceed the class max speed')
  // Full throttle must actually approach class max — no Shift boost needed.
  assert.ok(speed >= shipClass.stats.speed * 0.9, `expected near max speed, got ${speed.toFixed(1)} / ${shipClass.stats.speed}`)
  assert.ok(shipState.position[2] > 0, 'ship should have moved forward along +z')
})

test('Shift does not increase top speed', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const noShift = freshShipState()
  const withShift = freshShipState()
  for (let i = 0; i < 600; i++) {
    updateFlight(noShift, shipClass, new Set(['KeyW']), noMouse(), 1 / 60)
    updateFlight(withShift, shipClass, new Set(['KeyW', 'ShiftLeft']), noMouse(), 1 / 60)
  }
  const a = Math.hypot(...noShift.velocity)
  const b = Math.hypot(...withShift.velocity)
  assert.ok(Math.abs(a - b) < 1e-3, `Shift must not boost speed (${a} vs ${b})`)
})

test('releasing W slowly decays throttle toward zero (no hold-cruise)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 60; i++) updateFlight(shipState, shipClass, new Set(['KeyW']), noMouse(), 1 / 60)
  const throttleAfterThrust = shipState.throttle
  assert.ok(throttleAfterThrust > 0.3)

  for (let i = 0; i < 60; i++) updateFlight(shipState, shipClass, new Set(), noMouse(), 1 / 60)
  assert.ok(shipState.throttle < throttleAfterThrust, 'throttle should decay after release')
  assert.ok(shipState.throttle > 0, 'decay is gradual, not instant zero after 1s')
})

test('S ramps the throttle back down', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 60; i++) updateFlight(shipState, shipClass, new Set(['KeyW']), noMouse(), 1 / 60)
  const throttleAfterThrust = shipState.throttle

  for (let i = 0; i < 60; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), noMouse(), 1 / 60)
  assert.ok(shipState.throttle < throttleAfterThrust, 'S should reduce the throttle')
})

test('sustained S ramps throttle negative for reverse thrust, moving the ship backward', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 300; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), noMouse(), 1 / 60)

  assert.ok(shipState.throttle < 0, 'sustained S should ramp throttle negative')
  assert.ok(shipState.position[2] < 0, 'ship should move backward along -z')
})

test('releasing S decays reverse throttle toward zero so the ship coasts to a stop', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 300; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), noMouse(), 1 / 60)
  assert.ok(shipState.throttle < 0)
  const speedWhileReversing = Math.hypot(...shipState.velocity)
  const throttleWhileReversing = shipState.throttle

  for (let i = 0; i < 30; i++) updateFlight(shipState, shipClass, new Set(), noMouse(), 1 / 60)
  assert.ok(shipState.throttle > throttleWhileReversing, 'reverse throttle should ease toward 0')
  assert.ok(shipState.throttle <= 0, 'should not overshoot into forward throttle')

  for (let i = 0; i < 360; i++) updateFlight(shipState, shipClass, new Set(), noMouse(), 1 / 60)
  const speedAfter = Math.hypot(...shipState.velocity)
  assert.ok(Math.abs(shipState.throttle) < 0.02, 'throttle should settle near 0')
  assert.ok(speedAfter < speedWhileReversing, 'ship should slow after releasing reverse')
  assert.ok(speedAfter < 0.5, `should nearly stop, got speed ${speedAfter}`)
})

test('reverse speed is capped at 25% of the forward max speed', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 600; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), noMouse(), 1 / 60)

  const speed = Math.hypot(...shipState.velocity)
  assert.ok(speed <= shipClass.stats.speed * 0.25 + 1e-6, `reverse speed ${speed} should not exceed 25% of max speed`)
})

test('mouse movement (aim) rotates the ship quaternion away from identity', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  updateFlight(shipState, shipClass, new Set(), { dx: 50, dy: 0 }, 1 / 60)

  assert.notDeepEqual(shipState.quaternion, [0, 0, 0, 1])
})

test('mouse right yaws toward screen-right (ship local -X)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  updateFlight(shipState, shipClass, new Set(), { dx: 50, dy: 0 }, 1 / 60)
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(shipState.quaternion)
  )
  // Chase cam: ship +X is screen-left, so screen-right turn is forward.x < 0.
  assert.ok(forward.x < 0, `mouse right should yaw toward local -X, got forward.x=${forward.x}`)
})

test('vertical mouse axis is inverted: moving the mouse up (negative dy) pitches the nose up', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  updateFlight(shipState, shipClass, new Set(), { dx: 0, dy: -50 }, 1 / 60)

  const quat = new THREE.Quaternion().fromArray(shipState.quaternion)
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat)
  assert.ok(forward.y > 0, 'moving the mouse up should pitch the nose upward (+y)')
})

test('mouse pitch can complete a full loop (no zenith stop)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  let sawNegativeZ = false
  let sawPositiveZAgain = false
  for (let i = 0; i < 400; i++) {
    updateFlight(shipState, shipClass, new Set(), { dx: 0, dy: -80 }, 1 / 60)
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion().fromArray(shipState.quaternion)
    )
    if (f.z < -0.5) sawNegativeZ = true
    if (sawNegativeZ && f.z > 0.5) sawPositiveZAgain = true
  }
  assert.ok(sawNegativeZ, 'should pitch past inverted (forward.z < 0)')
  assert.ok(sawPositiveZAgain, 'should complete the loop back toward +Z')
})

test('mouse aim delta is consumed (reset to zero) after being applied', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  const mouseAim = { dx: 50, dy: -20 }
  updateFlight(shipState, shipClass, new Set(), mouseAim, 1 / 60)

  assert.deepEqual(mouseAim, { dx: 0, dy: 0 })
})

test('A/D strafe sideways without changing ship orientation', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  updateFlight(shipState, shipClass, new Set(['KeyD']), noMouse(), 1 / 60)

  assert.deepEqual(shipState.quaternion, [0, 0, 0, 1], 'strafing should not rotate the ship')
  // Chase cam: ship +X is screen-left, so D (screen-right) thrusts local -X.
  assert.ok(shipState.velocity[0] < 0, 'D should thrust screen-right (local -x)')
})

test('X/Z vertical thrusters translate on local up without rotating', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  updateFlight(shipState, shipClass, new Set(['KeyX']), noMouse(), 1 / 60)
  assert.deepEqual(shipState.quaternion, [0, 0, 0, 1])
  assert.ok(shipState.velocity[1] > 0, 'X should thrust up (local +y)')
  assert.equal(shipState.strafeY, 1)
})

test('with no input the ship coasts and decays toward zero velocity', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  shipState.velocity = [10, 0, 0]
  updateFlight(shipState, shipClass, new Set(), noMouse(), 1)

  const speed = Math.hypot(...shipState.velocity)
  assert.ok(speed < 10, 'velocity should decay when coasting')
})
