import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  updateSupercruise,
  aimAroundObstacles,
  ignoreBodyAsCruiseObstacle,
  SUPERCRUISE_MULTIPLIER,
  SUPERCRUISE_RAMP_UP_S,
  supercruiseRampUpFactor,
  supercruiseApproachFactor
} from './supercruise.js'
import { updateFlight } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

const DT = 1 / 60

test('updateSupercruise flies the ship toward the target and reports arrival', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], supercruiseElapsed: 0 }
  const target = [0, 0, 500]

  let arrived = false
  for (let i = 0; i < 6000 && !arrived; i++) {
    arrived = updateSupercruise(shipState, shipClass, target, DT)
  }

  assert.equal(arrived, true, 'ship should reach the arrival threshold within a reasonable number of steps')
  assert.ok(shipState.position[2] > 0, 'ship should have moved toward the target')
})

test('supercruise cruising speed is roughly SUPERCRUISE_MULTIPLIER times normal manual-flight cruising speed', () => {
  // The flight model's exponential damping means ships settle at a terminal
  // velocity well below their nominal stats.speed cap under sustained thrust
  // (that cap is a hard ceiling, not a value normal flight actually reaches).
  // So cruise ratio is measured against real cruising speed, not the cap.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)

  const manualState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  const keys = new Set(['KeyW'])
  for (let i = 0; i < 600; i++) updateFlight(manualState, shipClass, keys, { dx: 0, dy: 0 }, DT)
  const manualSpeed = Math.hypot(...manualState.velocity)

  // Far target + enough time past RAMP_UP so approach-factor never slows us.
  const cruiseState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], supercruiseElapsed: 0 }
  let peakCruise = 0
  for (let i = 0; i < 600; i++) {
    updateSupercruise(cruiseState, shipClass, [0, 0, 50_000_000], DT)
    peakCruise = Math.max(peakCruise, Math.hypot(...cruiseState.velocity))
  }

  const ratio = peakCruise / manualSpeed
  assert.ok(ratio > SUPERCRUISE_MULTIPLIER * 0.9 && ratio < SUPERCRUISE_MULTIPLIER * 1.1, `expected ~${SUPERCRUISE_MULTIPLIER}x, got ${ratio.toFixed(2)}x`)
})

test('supercruise ramps up over SUPERCRUISE_RAMP_UP_S and slows on approach', () => {
  assert.equal(supercruiseRampUpFactor(0), 0)
  assert.ok(supercruiseRampUpFactor(SUPERCRUISE_RAMP_UP_S / 2) > 0.4 && supercruiseRampUpFactor(SUPERCRUISE_RAMP_UP_S / 2) < 0.7)
  assert.equal(supercruiseRampUpFactor(SUPERCRUISE_RAMP_UP_S), 1)
  assert.equal(supercruiseRampUpFactor(SUPERCRUISE_RAMP_UP_S + 5), 1)

  const cruiseTop = 100 * SUPERCRUISE_MULTIPLIER
  assert.ok(supercruiseApproachFactor(1e9, 60, cruiseTop) > 0.99)
  assert.ok(supercruiseApproachFactor(80, 60, cruiseTop) < 0.35)
})

test('arriving within range on the first call returns true immediately without moving', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  const arrived = updateSupercruise(shipState, shipClass, [0, 0, 10], DT)
  assert.equal(arrived, true)
})

test('custom arrivalRange is respected (body-sized shells for large stations/planets)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  // 200 units out — default range would not count as arrived, body-sized range does.
  assert.equal(updateSupercruise(shipState, shipClass, [0, 0, 200], DT, 250), true)
  assert.equal(updateSupercruise(shipState, shipClass, [0, 0, 200], DT, 60), false)
})

test('aimAroundObstacles leaves a clear path alone', () => {
  const shipPos = new THREE.Vector3(0, 0, 0)
  const targetPos = new THREE.Vector3(0, 0, 1000)
  // Planet off to the side, well clear of the path.
  const bodies = [{ id: 'p1', kind: 'planet', position: [500, 0, 400], radius: 50 }]
  const aim = aimAroundObstacles(shipPos, targetPos, bodies, 5)
  assert.deepEqual(aim.toArray(), targetPos.toArray())
})

test('aimAroundObstacles flies straight through a body on the path', () => {
  const shipPos = new THREE.Vector3(0, 0, 0)
  const targetPos = new THREE.Vector3(0, 0, 1000)
  // Planet dead ahead — SC tunnels through, no skirting.
  const bodies = [{ id: 'blocker', kind: 'planet', position: [0, 0, 400], radius: 80 }]
  const aim = aimAroundObstacles(shipPos, targetPos, bodies, 5)
  assert.deepEqual(aim.toArray(), targetPos.toArray())
})

test('aimAroundObstacles does not avoid the destination body', () => {
  const shipPos = new THREE.Vector3(0, 0, 0)
  const targetPos = new THREE.Vector3(0, 0, 500)
  const bodies = [{ id: 'dest', kind: 'planet', position: [0, 0, 500], radius: 100 }]
  const aim = aimAroundObstacles(shipPos, targetPos, bodies, 5, 'dest')
  assert.deepEqual(aim.toArray(), targetPos.toArray())
})

test('ignoreBodyAsCruiseObstacle treats host planet of a surface settlement as non-blocking', () => {
  const planet = { id: 'planet-1', kind: 'planet', position: [0, 0, 0], radius: 1000 }
  // Settlement sits on the crust.
  const settlementPos = [0, 1005, 0]
  assert.equal(ignoreBodyAsCruiseObstacle(planet, settlementPos, 'settlement-1', 120), true)
  // Unrelated far planet is still a blocker.
  const other = { id: 'planet-2', kind: 'planet', position: [5000, 0, 0], radius: 200 }
  assert.equal(ignoreBodyAsCruiseObstacle(other, settlementPos, 'settlement-1', 120), false)
})

test('aimAroundObstacles does not skirt the host planet of a surface destination', () => {
  const shipPos = new THREE.Vector3(0, 0, -5000)
  const settlementPos = new THREE.Vector3(0, 1005, 0)
  const bodies = [
    { id: 'planet-1', kind: 'planet', position: [0, 0, 0], radius: 1000 },
    { id: 'settlement-1', kind: 'settlement', position: [0, 1005, 0] }
  ]
  const aim = aimAroundObstacles(shipPos, settlementPos, bodies, 5, 'settlement-1', settlementPos.toArray(), 120)
  // Must aim at the settlement, not off to the side around the planet.
  assert.deepEqual(aim.toArray(), settlementPos.toArray())
})

test('supercruise reaches a surface settlement sitting on a large host planet', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipRadius = shipClass.hull.length / 2
  const shipState = {
    position: [0, 0, -8000],
    velocity: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    supercruiseElapsed: SUPERCRUISE_RAMP_UP_S
  }
  const planet = { id: 'planet-1', kind: 'planet', position: [0, 0, 0], radius: 1000 }
  const settlement = { id: 'settlement-1', kind: 'settlement', position: [0, 1005, 0] }
  const target = settlement.position
  // Settlement dock bubble is large (+2000); SC should stop well short of the mesh.
  const settlementShell = 72 + shipRadius
  const arrivalRange = settlementShell + 220
  const bodies = [planet, settlement]

  let arrived = false
  for (let i = 0; i < 120000 && !arrived; i++) {
    arrived = updateSupercruise(
      shipState,
      shipClass,
      target,
      DT,
      arrivalRange,
      bodies,
      shipRadius,
      'settlement-1'
    )
  }
  assert.equal(arrived, true, 'should arrive at surface settlement without orbit-locking on the host')
  const dist = Math.hypot(...shipState.position.map((v, i) => v - target[i]))
  assert.ok(dist >= arrivalRange * 0.9, 'should drop out near the arrival standoff, not on the mesh')
})

test('updateSupercruise with a blocker still reaches the target (tunnels through)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shipRadius = shipClass.hull.length / 2
  const shipState = { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], supercruiseElapsed: 0 }
  const target = [0, 0, 25000]
  const blocker = { id: 'blocker', kind: 'planet', position: [40, 0, 8000], radius: 100 }
  const dest = { id: 'dest', kind: 'planet', position: [0, 0, 25000], radius: 30 }
  const bodies = [blocker, dest]
  const arrivalRange = 30 + shipRadius + 220

  let arrived = false
  for (let i = 0; i < 180000 && !arrived; i++) {
    arrived = updateSupercruise(shipState, shipClass, target, DT, arrivalRange, bodies, shipRadius, 'dest')
  }

  assert.equal(arrived, true, 'should arrive even with a body on the path')
})
