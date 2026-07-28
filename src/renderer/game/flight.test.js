import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { updateFlight, headingOf } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

/**
 * Handling.
 *
 * The helm is entirely on the keyboard — W/S ahead and astern, A/D put the
 * rudder over, Q/E work the bow and stern thrusters. `updateFlight` takes no
 * mouse input at all, by design: the mouse lays the turret (game/turret.js),
 * and two consumers of the same accumulated delta would each get half of it.
 */

function freshShipState() {
  return { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
}

/** Run the boat up to speed so the rudder has water flowing past it. */
function underway(shipState, shipClass, frames = 300) {
  for (let i = 0; i < frames; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW']), 1 / 60)
  }
}

function forwardOf(shipState) {
  return new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(shipState.quaternion)
  )
}

// --- throttle ---

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

  for (let i = 0; i < 60; i++) updateFlight(shipState, shipClass, new Set(), 1 / 60)
  assert.ok(shipState.throttle < throttleAfterThrust, 'throttle should decay after release')
  assert.ok(shipState.throttle > 0, 'decay is gradual, not instant zero after 1s')
})

test('sustained S ramps throttle negative for astern, backing the boat up', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 300; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), 1 / 60)

  assert.ok(shipState.throttle < 0, 'sustained S should ramp throttle negative')
  assert.ok(shipState.position[2] < 0, 'boat should back along -z')
})

test('astern speed is capped at 25% of the ahead max', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  for (let i = 0; i < 600; i++) updateFlight(shipState, shipClass, new Set(['KeyS']), 1 / 60)

  const speed = Math.hypot(...shipState.velocity)
  assert.ok(speed <= shipClass.stats.speed * 0.25 + 1e-6, `astern speed ${speed} exceeded the cap`)
})

test('with no input the boat carries way and decays toward rest', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  shipState.velocity = [10, 0, 0]
  updateFlight(shipState, shipClass, new Set(), 1)

  assert.ok(Math.hypot(...shipState.velocity) < 10, 'velocity should decay when coasting')
})

// --- steering: A and D put the helm over ---

test('A turns to port on screen, D to starboard', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const port = freshShipState()
  const starboard = freshShipState()
  underway(port, shipClass)
  underway(starboard, shipClass)
  const start = port.heading

  for (let i = 0; i < 60; i++) {
    updateFlight(port, shipClass, new Set(['KeyW', 'KeyA']), 1 / 60)
    updateFlight(starboard, shipClass, new Set(['KeyW', 'KeyD']), 1 / 60)
  }

  // Chase cam sits astern: hull +X is screen-left, so a screen-right turn
  // decreases heading (the same reason radar negates x).
  assert.ok(port.heading > start, 'A should come round to port')
  assert.ok(starboard.heading < start, 'D should come round to starboard')
})

test('a stopped boat can still be walked round, just not as fast', () => {
  // Arcade handling: dead in the water you can kick the stern round on the
  // screws. Slower than with way on, but not zero — being unable to turn while
  // stopped is the thing that made coming alongside miserable.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)

  const stopped = freshShipState()
  for (let i = 0; i < 60; i++) updateFlight(stopped, shipClass, new Set(['KeyA']), 1 / 60)
  const turnedStopped = Math.abs(stopped.heading)
  assert.ok(turnedStopped > 0.02, `a stopped boat should still come round, got ${turnedStopped}`)

  const moving = freshShipState()
  underway(moving, shipClass)
  const before = moving.heading
  for (let i = 0; i < 60; i++) {
    updateFlight(moving, shipClass, new Set(['KeyW', 'KeyA']), 1 / 60)
  }
  assert.ok(
    Math.abs(moving.heading - before) > turnedStopped,
    'the rudder should still bite harder under way'
  )
})

test('nothing but A and D moves the helm', () => {
  // The regression this guards: if steering ever reads the mouse again, aiming
  // the guns would drag the boat round with them.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  const before = shipState.heading
  for (let i = 0; i < 60; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyQ', 'KeyE']), 1 / 60)
  }
  assert.ok(Math.abs(shipState.heading - before) < 1e-9, 'heading must only change on A/D')
})

// --- thrusters: Q and E crab the hull sideways ---

test('Q and E crab the hull sideways without turning it', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const q = freshShipState()
  const e = freshShipState()

  for (let i = 0; i < 60; i++) {
    updateFlight(q, shipClass, new Set(['KeyQ']), 1 / 60)
    updateFlight(e, shipClass, new Set(['KeyE']), 1 / 60)
  }
  // Heading 0 means the bow is along +Z and up is +Y, so starboard — forward
  // crossed with up — is -X, and port is +X.
  assert.ok(q.position[0] > 0.5, `Q should move to port, got x=${q.position[0]}`)
  assert.ok(e.position[0] < -0.5, `E should move to starboard, got x=${e.position[0]}`)
  assert.ok(Math.abs(q.heading ?? 0) < 1e-6, 'crabbing must not turn the hull')
  assert.ok(Math.abs(e.heading ?? 0) < 1e-6, 'crabbing must not turn the hull')
})

test('crabbing works dead in the water — that is the point of it', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const s = freshShipState()
  for (let i = 0; i < 60; i++) updateFlight(s, shipClass, new Set(['KeyE']), 1 / 60)
  assert.ok(s.position[0] < -0.5, 'you must be able to come alongside from a standstill')
})

test('sideways way dies almost immediately once you stop crabbing', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const s = freshShipState()
  for (let i = 0; i < 60; i++) updateFlight(s, shipClass, new Set(['KeyE']), 1 / 60)
  const drifting = Math.abs(s.velocity[0])
  assert.ok(drifting > 0.1)
  for (let i = 0; i < 60; i++) updateFlight(s, shipClass, new Set(), 1 / 60)
  assert.ok(Math.abs(s.velocity[0]) < drifting * 0.1, 'a hull does not slide sideways for long')
})

test('A/D and Q/E are independent — you can turn while crabbing', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const s = freshShipState()
  for (let i = 0; i < 60; i++) updateFlight(s, shipClass, new Set(['KeyA', 'KeyE']), 1 / 60)
  assert.ok(s.heading > 0.01, 'the helm should still bite while the thrusters run')
  assert.ok(Math.hypot(s.position[0], s.position[2]) > 0.3, 'and the hull should still move bodily')
})

// --- attitude: a boat cannot fly ---

test('there is no vertical input — the boat stays on its plane', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 120; i++) {
    // X/Z were vertical thrusters in the space build; they must do nothing now.
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyX', 'KeyZ']), 1 / 60)
  }
  assert.equal(shipState.velocity[1], 0, 'no vertical velocity may accumulate')
  assert.equal(shipState.position[1], 0, 'flight must not lift the hull off its plane')
})

test('the hull never pitches past vertical, however long you hold the helm', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 400; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyA']), 1 / 60)
    const f = forwardOf(shipState)
    assert.ok(Math.abs(f.y) < 0.6, `bow pitched to y=${f.y} — boats do not loop`)
  }
})

test('quaternion heading agrees with the authoritative heading scalar', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 90; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyD']), 1 / 60)
  }
  const f = forwardOf(shipState)
  const fromQuat = Math.atan2(f.x, f.z)
  const delta = Math.atan2(
    Math.sin(fromQuat - shipState.heading),
    Math.cos(fromQuat - shipState.heading)
  )
  // Wave tilt and trim perturb the bow slightly; heading must still dominate.
  assert.ok(Math.abs(delta) < 0.2, `quaternion drifted ${delta} rad from heading`)
})

test('the boat heels into a sustained turn and rights itself afterward', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = freshShipState()
  underway(shipState, shipClass)
  for (let i = 0; i < 90; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW', 'KeyD']), 1 / 60)
  }
  const heeled = Math.abs(shipState.bank)
  assert.ok(heeled > 0.02, `expected heel into the turn, got ${heeled}`)

  for (let i = 0; i < 180; i++) {
    updateFlight(shipState, shipClass, new Set(['KeyW']), 1 / 60)
  }
  assert.ok(Math.abs(shipState.bank) < heeled * 0.2, 'heel should ease off once the rudder centres')
})

test('headingOf recovers heading from a quaternion-only state', () => {
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1)
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: quat.toArray() }
  assert.ok(Math.abs(headingOf(shipState) - 1.1) < 1e-6)
})
