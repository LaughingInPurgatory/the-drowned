import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  updateAutopilot,
  aimAroundObstacles,
  ignoreBodyAsCruiseObstacle,
  AUTOPILOT_SPEED_MULTIPLIER,
  AUTOPILOT_RAMP_UP_S,
  autopilotRampUpFactor,
  autopilotApproachFactor
} from './autopilot.js'
import { updateFlight } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

const DT = 1 / 60

function afloat(position = [0, 0, 0]) {
  return { position, velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], supercruiseElapsed: 0 }
}

test('autopilot runs the boat toward the waypoint and reports arrival', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat()

  let arrived = false
  for (let i = 0; i < 6000 && !arrived; i++) {
    arrived = updateAutopilot(shipState, shipClass, [0, 0, 500], DT)
  }

  assert.equal(arrived, true, 'should reach the arrival threshold in reasonable time')
  assert.ok(shipState.position[2] > 0, 'should have made way toward the waypoint')
})

test('autopilot speed is about AUTOPILOT_SPEED_MULTIPLIER times normal handling speed', () => {
  // The handling model's damping means a boat settles well below its nominal
  // stats.speed cap (that cap is a ceiling, not a speed it reaches), so the
  // ratio is measured against real cruising speed rather than the cap.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)

  const manualState = afloat()
  for (let i = 0; i < 600; i++) {
    updateFlight(manualState, shipClass, new Set(['KeyW']), { dx: 0, dy: 0 }, DT)
  }
  const manualSpeed = Math.hypot(...manualState.velocity)

  const cruiseState = afloat()
  let peakCruise = 0
  for (let i = 0; i < 600; i++) {
    updateAutopilot(cruiseState, shipClass, [0, 0, 50_000_000], DT)
    peakCruise = Math.max(peakCruise, Math.hypot(...cruiseState.velocity))
  }

  const ratio = peakCruise / manualSpeed
  assert.ok(
    ratio > AUTOPILOT_SPEED_MULTIPLIER * 0.9 && ratio < AUTOPILOT_SPEED_MULTIPLIER * 1.1,
    `expected ~${AUTOPILOT_SPEED_MULTIPLIER}x, got ${ratio.toFixed(2)}x`
  )
})

test('autopilot spools up over AUTOPILOT_RAMP_UP_S and eases off on approach', () => {
  assert.equal(autopilotRampUpFactor(0), 0)
  assert.ok(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S / 2) > 0.4)
  assert.ok(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S / 2) < 0.7)
  assert.equal(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S), 1)
  assert.equal(autopilotRampUpFactor(AUTOPILOT_RAMP_UP_S + 5), 1)

  const cruiseTop = 100 * AUTOPILOT_SPEED_MULTIPLIER
  assert.ok(autopilotApproachFactor(1e9, 60, cruiseTop) > 0.99)
  assert.ok(autopilotApproachFactor(80, 60, cruiseTop) < 0.35)
})

test('already inside the arrival ring returns true without moving', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  assert.equal(updateAutopilot(afloat(), shipClass, [0, 0, 10], DT), true)
})

test('a custom arrival range is respected, for big harbours and islands', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  assert.equal(updateAutopilot(afloat(), shipClass, [0, 0, 200], DT, 250), true)
  assert.equal(updateAutopilot(afloat(), shipClass, [0, 0, 200], DT, 60), false)
})

test('autopilot never lifts the hull off the water or pitches the bow', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat([0, 0, 0])
  for (let i = 0; i < 900; i++) {
    updateAutopilot(shipState, shipClass, [4000, 0, 9000], DT, 60, null, 0, null, null, i * DT)
    assert.equal(shipState.velocity[1], 0, 'no vertical way under cruise')
  }
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(shipState.quaternion)
  )
  assert.ok(Math.abs(f.y) < 0.4, `bow pitched to ${f.y} under autopilot`)
})

test('autopilot steers toward a waypoint off the beam and gets there', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = afloat([0, 0, 0])
  const target = [6000, 0, -6000]
  let arrived = false
  for (let i = 0; i < 200000 && !arrived; i++) {
    arrived = updateAutopilot(shipState, shipClass, target, DT, 120)
  }
  assert.equal(arrived, true, 'should come round onto a waypoint abaft the beam')
})

test('aimAroundObstacles leaves a clear track alone', () => {
  const bodies = [{ id: 'i1', kind: 'island', position: [500, 0, 400], radius: 50 }]
  const target = new THREE.Vector3(0, 0, 1000)
  assert.deepEqual(aimAroundObstacles(new THREE.Vector3(), target, bodies, 5).toArray(), target.toArray())
})

test('aimAroundObstacles steers around something on the track', () => {
  // The autopilot is slow enough that carrying straight through an island would
  // read as sailing through land — it has to actually give way.
  const bodies = [{ id: 'blocker', kind: 'island', position: [0, 0, 400], radius: 80 }]
  const target = new THREE.Vector3(0, 0, 3000)
  const aim = aimAroundObstacles(new THREE.Vector3(), target, bodies, 5)
  assert.notDeepEqual(aim.toArray(), target.toArray(), 'should not aim straight at the target')
  assert.ok(Math.abs(aim.x) > 80, `aim should swing wide of the island, got x=${aim.x}`)
  assert.equal(aim.y, 0, 'the aim point stays on the water')
})

test('aimAroundObstacles commits to the approach once close in', () => {
  // Near the destination its own surroundings look like obstructions; without
  // this the boat circles the harbour instead of coming alongside.
  const bodies = [{ id: 'blocker', kind: 'island', position: [0, 0, 150], radius: 80 }]
  const target = new THREE.Vector3(0, 0, 300)
  assert.deepEqual(aimAroundObstacles(new THREE.Vector3(), target, bodies, 5).toArray(), target.toArray())
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

test('autopilot reaches a harbour tucked against its own island', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipRadius = shipClass.hull.length / 2
  const shipState = { ...afloat([0, 0, -8000]), supercruiseElapsed: AUTOPILOT_RAMP_UP_S }
  const island = { id: 'island-1', kind: 'island', position: [0, 0, 0], radius: 1000 }
  const harbour = { id: 'port-1', kind: 'port', position: [1300, 0, 0] }
  const arrivalRange = 260 + shipRadius + 220

  let arrived = false
  for (let i = 0; i < 200000 && !arrived; i++) {
    arrived = updateAutopilot(
      shipState,
      shipClass,
      harbour.position,
      DT,
      arrivalRange,
      [island, harbour],
      shipRadius,
      'port-1'
    )
  }
  assert.equal(arrived, true, 'should arrive without circling the island forever')
})

test('autopilot still arrives with something on the track (it runs through)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipRadius = shipClass.hull.length / 2
  const shipState = afloat()
  const blocker = { id: 'blocker', kind: 'island', position: [40, 0, 8000], radius: 100 }
  const dest = { id: 'dest', kind: 'island', position: [0, 0, 25000], radius: 30 }
  const arrivalRange = 30 + shipRadius + 220

  let arrived = false
  for (let i = 0; i < 200000 && !arrived; i++) {
    arrived = updateAutopilot(shipState, shipClass, [0, 0, 25000], DT, arrivalRange, [blocker, dest], shipRadius, 'dest')
  }
  assert.equal(arrived, true, 'should arrive even with an island on the track')
})
