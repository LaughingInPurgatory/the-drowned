import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { updateFlight, headingOf } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

function freshShipState() {
  return { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

function noMouse() {
  return { dx: 0, dy: 0 }
}

/** Run the boat up to speed so the rudder has water flowing past it. */
function underway(shipState, shipClass, frames = 300) {
  for (let i = 0; i < frames; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW']), noMouse(), 1 / 60)
  }
}

function forwardOf(shipState) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(shipState.quaternion)
  )
}

// --- throttle: unchanged from the original engine model ---

test('holding W ramps the throttle up and makes way, respecting max speed', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass, 600)

  const speed = Math.hypot(...shipState.velocity)
  assert.equal(shipState.throttle, 1, 'throttle should ramp all the way up under sustained W')
  assert.ok(speed <= shipClass.stats.speed + 1e-6, 'speed should not exceed the class max speed')
  assert.ok(speed >= shipClass.stats.speed * 0.9, `expected near max speed, got ${speed.toFixed(1)}`)
  assert.ok(shipState.position[2] > 0, 'boat should have made way along +z')
})

test('releasing W slowly decays throttle toward zero (no hold-cruise)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass, 60)
  const throttleAfterThrust = shipState.throttle
  assert.ok(throttleAfterThrust > 0.3)

  for (let i = 0; i < 60; i++) updateFlight(shipState, shipClass, new Set(), noMouse(), 1 / 60)
  assert.ok(shipState.throttle < throttleAfterThrust, 'throttle should decay after release')
  assert.ok(shipState.throttle > 0, 'decay is gradual, not instant zero after 1s')
})

test('sustained S ramps throttle negative for astern, backing the boat up', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 300; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), noMouse(), 1 / 60)

  assert.ok(shipState.throttle < 0, 'sustained S should ramp throttle negative')
  assert.ok(shipState.position[2] < 0, 'boat should back along -z')
})

test('astern speed is capped at 25% of the ahead max', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 600; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), noMouse(), 1 / 60)

  const speed = Math.hypot(...shipState.velocity)
  assert.ok(speed <= shipClass.stats.speed * 0.25 + 1e-6, `astern speed ${speed} exceeded the cap`)
})

test('with no input the boat carries way and decays toward rest', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  shipState.velocity = [10, 0, 0]
  updateFlight(shipState, shipClass, new Set(), noMouse(), 1)

  assert.ok(Math.hypot(...shipState.velocity) < 10, 'velocity should decay when coasting')
})

// --- steering: heading is authoritative, rudder needs way on ---

test('a stopped boat cannot steer — the rudder has nothing to bite', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  const before = headingOf(shipState)
  for (let i = 0; i < 60; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyA']), { dx: 80, dy: 0 }, 1 / 60)
  }
  assert.ok(Math.abs(shipState.heading - before) < 1e-6, 'heading must not change with no way on')
})

test('mouse right turns to screen-right, mouse left to screen-left', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const right = freshShipState()
  const left = freshShipState()
  underway(right, shipClass)
  underway(left, shipClass)
  const start = right.heading

  updateFlight(right, shipClass, new Set(['KeyW']), { dx: 50, dy: 0 }, 1 / 60)
  updateFlight(left, shipClass, new Set(['KeyW']), { dx: -50, dy: 0 }, 1 / 60)

  // Chase cam sits astern: hull +X is screen-left, so a screen-right turn
  // decreases heading (the same reason radar negates x).
  assert.ok(right.heading < start, 'mouse right should turn to starboard-on-screen')
  assert.ok(left.heading > start, 'mouse left should turn the other way')
})

test('A and D steer, and steer opposite ways', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const a = freshShipState()
  const d = freshShipState()
  underway(a, shipClass)
  underway(d, shipClass)
  const start = a.heading

  for (let i = 0; i < 30; i++) {
    updateFlight(a, shipClass, new Set(['KeyW', 'KeyA']), noMouse(), 1 / 60)
    updateFlight(d, shipClass, new Set(['KeyW', 'KeyD']), noMouse(), 1 / 60)
  }
  assert.ok(a.heading > start, 'A should turn to screen-left')
  assert.ok(d.heading < start, 'D should turn to screen-right')
})

test('mouse aim delta is consumed, including the unused vertical axis', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  const mouseAim = { dx: 50, dy: -20 }
  updateFlight(shipState, shipClass, new Set(), mouseAim, 1 / 60)

  assert.deepEqual(mouseAim, { dx: 0, dy: 0 }, 'pitch input must not pile up unapplied')
})

// --- attitude: a boat cannot fly ---

test('there is no vertical input — the boat stays on its plane', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 120; i++) {
    // X/Z were vertical thrusters in the space build; they must do nothing now.
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyX', 'KeyZ']), { dx: 0, dy: -90 }, 1 / 60)
  }
  assert.equal(shipState.velocity[1], 0, 'no vertical velocity may accumulate')
  assert.equal(shipState.position[1], 0, 'flight must not lift the hull off its plane')
})

test('the hull never pitches past vertical, however long you hold the mouse up', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 400; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW']), { dx: 0, dy: -80 }, 1 / 60)
    const f = forwardOf(shipState)
    assert.ok(Math.abs(f.y) < 0.6, `bow pitched to y=${f.y} — boats do not loop`)
  }
})

test('quaternion heading agrees with the authoritative heading scalar', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 90; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyA']), noMouse(), 1 / 60)
  }
  const f = forwardOf(shipState)
  const fromQuat = Math.atan2(f.x, f.z)
  const delta = Math.atan2(Math.sin(fromQuat - shipState.heading), Math.cos(fromQuat - shipState.heading))
  // Wave tilt and trim perturb the bow slightly; the heading must still dominate.
  assert.ok(Math.abs(delta) < 0.2, `quaternion drifted ${delta} rad from heading`)
})

test('the boat heels into a sustained turn and rights itself afterward', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 90; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyA']), noMouse(), 1 / 60)
  }
  const heeled = Math.abs(shipState.bank)
  assert.ok(heeled > 0.02, `expected heel into the turn, got ${heeled}`)

  for (let i = 0; i < 180; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW']), noMouse(), 1 / 60)
  }
  assert.ok(Math.abs(shipState.bank) < heeled * 0.2, 'heel should ease off once the rudder centres')
})

test('headingOf recovers heading from a quaternion-only state', () => {
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1)
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: quat.toArray() }
  assert.ok(Math.abs(headingOf(shipState) - 1.1) < 1e-6)
})
