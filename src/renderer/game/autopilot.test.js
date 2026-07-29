import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  updateCruiseControl,
  updateAutopilot,
  aimAroundObstacles,
  ignoreBodyAsCruiseObstacle,
  cruiseCancelKeysHeld,
  AUTOPILOT_SPEED_MULTIPLIER,
  AUTOPILOT_RAMP_UP_S,
  autopilotRampUpFactor,
  autopilotApproachFactor
} from './autopilot.js'
import { updateFlight } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

const DT = 1 / 60

function afloat(position = [0, 0, 0]) {
  return { position, velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], supercruiseElapsed: 0, heading: 0 }
}

test('cruise control has no speed boost over hand-steered full ahead', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)

  const manualState = afloat()
  for (let i = 0; i < 600; i++) {
    updateFlight(manualState, shipClass, new Set(['KeyW']), DT)
  }
  const manualSpeed = Math.hypot(...manualState.velocity)

  const cruiseState = afloat()
  cruiseState.heading = 0
  let peakCruise = 0
  for (let i = 0; i < 600; i++) {
    updateCruiseControl(cruiseState, shipClass, DT)
    peakCruise = Math.max(peakCruise, Math.hypot(...cruiseState.velocity))
  }

  const ratio = peakCruise / manualSpeed
  assert.ok(
    ratio > 0.85 && ratio < 1.15,
    `expected ~1x hand speed, got ${ratio.toFixed(2)}x (multiplier constant is ${AUTOPILOT_SPEED_MULTIPLIER})`
  )
})

test('cruise spools up over AUTOPILOT_RAMP_UP_S', () => {
  assert.equal(autopilotRampUpFactor(0), 0)
  assert.ok(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S / 2) > 0.4)
  assert.ok(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S / 2) < 0.7)
  assert.equal(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S), 1)
  assert.equal(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S + 5), 1)

  // Approach helper still defined for callers; cruise itself does not decelerate.
  const cruiseTop = 100
  assert.ok(autopilotApproachFactor(1e9, 60, cruiseTop) > 0.99)
  assert.ok(autopilotApproachFactor(80, 60, cruiseTop) < 0.35)
})

test('cruise control never lifts the hull off the water or pitches the bow', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat([0, 0, 0])
  shipState.heading = 0
  for (let i = 0; i < 900; i++) {
    updateCruiseControl(shipState, shipClass, DT, null, 0, null, i * DT)
    assert.equal(shipState.velocity[1], 0, 'no vertical way under cruise')
  }
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(shipState.quaternion)
  )
  assert.ok(Math.abs(f.y) < 0.4, `bow pitched to ${f.y} under cruise`)
})

test('cruise control holds the engaged heading (no waypoint seek)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat([0, 0, 0])
  // Point south-east and engage — should keep going that way, not turn to origin.
  shipState.heading = Math.PI / 4
  for (let i = 0; i < 400; i++) {
    updateCruiseControl(shipState, shipClass, DT)
  }
  assert.ok(shipState.position[0] > 20, 'should make way on the engaged heading (+X)')
  assert.ok(shipState.position[2] > 20, 'should make way on the engaged heading (+Z)')
  // Heading should stay near the engaged course (avoidance may nudge slightly).
  const err = Math.abs(
    Math.atan2(Math.sin(shipState.heading - Math.PI / 4), Math.cos(shipState.heading - Math.PI / 4))
  )
  assert.ok(err < 0.35, `heading drifted too far: ${shipState.heading}`)
})

test('cruiseCancelKeysHeld is true for thrust/strafe, false for helm A/D', () => {
  assert.equal(cruiseCancelKeysHeld(new Set(['KeyW'])), true)
  assert.equal(cruiseCancelKeysHeld(new Set(['KeyS'])), true)
  assert.equal(cruiseCancelKeysHeld(new Set(['KeyQ'])), true)
  assert.equal(cruiseCancelKeysHeld(new Set(['KeyE'])), true)
  assert.equal(cruiseCancelKeysHeld(new Set(['KeyA'])), false)
  assert.equal(cruiseCancelKeysHeld(new Set(['KeyD'])), false)
  assert.equal(cruiseCancelKeysHeld(new Set()), false)
})

test('A/D under cruise turns the boat without needing a waypoint', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat([0, 0, 0])
  shipState.heading = 0
  shipState.supercruiseElapsed = AUTOPILOT_RAMP_UP_S
  // Build a little way first so rudder has authority.
  for (let i = 0; i < 120; i++) {
    updateCruiseControl(shipState, shipClass, DT)
  }
  const before = shipState.heading
  for (let i = 0; i < 180; i++) {
    updateCruiseControl(shipState, shipClass, DT, null, 0, null, i * DT, new Set(['KeyA']))
  }
  // Port helm should increase heading (turn left / toward +X from north).
  const delta = Math.atan2(Math.sin(shipState.heading - before), Math.cos(shipState.heading - before))
  assert.ok(delta > 0.15, `expected port turn, delta=${delta}`)
})

test('legacy updateAutopilot is cruise control (ignores target, never arrives)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat()
  shipState.heading = 0
  // Close “target” used to mean arrival; cruise never reports arrived.
  assert.equal(updateAutopilot(shipState, shipClass, [0, 0, 10], DT), false)
  for (let i = 0; i < 120; i++) {
    assert.equal(updateAutopilot(shipState, shipClass, [0, 0, 10], DT), false)
  }
  assert.ok(shipState.position[2] > 5, 'should keep going past the old arrival ring')
})

test('aimAroundObstacles leaves a clear track alone', () => {
  const bodies = [{ id: 'i1', kind: 'island', position: [500, 0, 400], radius: 50 }]
  const target = new THREE.Vector3(0, 0, 1000)
  assert.deepEqual(aimAroundObstacles(new THREE.Vector3(), target, bodies, 5).toArray(), target.toArray())
})

test('aimAroundObstacles steers around something on the track', () => {
  const bodies = [{ id: 'blocker', kind: 'island', position: [0, 0, 400], radius: 80 }]
  const target = new THREE.Vector3(0, 0, 3000)
  const aim = aimAroundObstacles(new THREE.Vector3(), target, bodies, 5)
  assert.notDeepEqual(aim.toArray(), target.toArray(), 'should not aim straight at the target')
  assert.ok(Math.abs(aim.x) > 80, `aim should swing wide of the island, got x=${aim.x}`)
  assert.equal(aim.y, 0, 'the aim point stays on the water')
})

test('aimAroundObstacles commits to the approach once close in (with a dest)', () => {
  const bodies = [{ id: 'blocker', kind: 'island', position: [0, 0, 150], radius: 80 }]
  const target = new THREE.Vector3(0, 0, 300)
  assert.deepEqual(
    aimAroundObstacles(new THREE.Vector3(), target, bodies, 5, null, target, 60).toArray(),
    target.toArray()
  )
})

test('aimAroundObstacles does not avoid the place it is heading for', () => {
  const bodies = [{ id: 'dest', kind: 'island', position: [0, 0, 500], radius: 100 }]
  const target = new THREE.Vector3(0, 0, 500)
  assert.deepEqual(
    aimAroundObstacles(new THREE.Vector3(), target, bodies, 5, 'dest').toArray(),
    target.toArray()
  )
})

test('the island a coastal harbour sits against is not treated as an obstruction', () => {
  const island = { id: 'island-1', kind: 'island', position: [0, 0, 0], radius: 1000 }
  const harbourPos = [1040, 0, 0]
  assert.equal(ignoreBodyAsCruiseObstacle(island, harbourPos, 'port-1', 120), true)
  const elsewhere = { id: 'island-2', kind: 'island', position: [9000, 0, 0], radius: 200 }
  assert.equal(ignoreBodyAsCruiseObstacle(elsewhere, harbourPos, 'port-1', 120), false)
})

test('cruise control does not auto-steer around islands (hold course only)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipRadius = shipClass.hull.length / 2
  const shipState = afloat([0, 0, 0])
  shipState.heading = 0
  const blocker = { id: 'blocker', kind: 'island', position: [0, 0, 800], radius: 120 }
  for (let i = 0; i < 4000; i++) {
    updateCruiseControl(shipState, shipClass, DT, [blocker], shipRadius, null, i * DT)
  }
  // Dead-ahead course — no lateral dodge from obstacle avoidance.
  assert.ok(shipState.position[2] > 400, `z=${shipState.position[2]}`)
  assert.ok(Math.abs(shipState.position[0]) < 5, `x drifted to ${shipState.position[0]}`)
  assert.ok(Math.abs(shipState.heading) < 0.05, `heading drifted to ${shipState.heading}`)
})
