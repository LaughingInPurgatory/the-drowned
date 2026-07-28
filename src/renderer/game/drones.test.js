import test from 'node:test'
import assert from 'node:assert/strict'
import { solveInterceptPoint } from './drones.js'

// Fire at the aim point and check the shot and the target actually meet.
// This is the property that matters — not the intermediate flight-time value.
function missDistance(shooterPos, targetPos, targetVel, shotSpeed) {
  const aim = solveInterceptPoint(shooterPos, targetPos, targetVel, shotSpeed)
  const to = [aim[0] - shooterPos[0], aim[1] - shooterPos[1], aim[2] - shooterPos[2]]
  const dist = Math.hypot(...to)
  const flight = dist / shotSpeed
  // Where each ends up when the shot has flown for `flight` seconds.
  const shot = [
    shooterPos[0] + (to[0] / dist) * shotSpeed * flight,
    shooterPos[1] + (to[1] / dist) * shotSpeed * flight,
    shooterPos[2] + (to[2] / dist) * shotSpeed * flight
  ]
  const moved = [
    targetPos[0] + targetVel[0] * flight,
    targetPos[1] + targetVel[1] * flight,
    targetPos[2] + targetVel[2] * flight
  ]
  return Math.hypot(shot[0] - moved[0], shot[1] - moved[1], shot[2] - moved[2])
}

test('stationary target: aim point is the target itself', () => {
  const aim = solveInterceptPoint([0, 0, 0], [300, 0, 0], [0, 0, 0], 600)
  assert.deepEqual(aim, [300, 0, 0])
})

test('crossing target at max attack range is intercepted within a hull width', () => {
  // 520u out (ATTACK_RANGE), crossing at 150 u/s — the hard case.
  const miss = missDistance([0, 0, 0], [520, 0, 0], [0, 0, 150], 600)
  assert.ok(miss < 8, `crossing miss ${miss.toFixed(2)}u should be < 8u`)
})

test('iterating beats the naive one-step lead on a crossing target', () => {
  const shooter = [0, 0, 0]
  const target = [520, 0, 0]
  const vel = [0, 0, 150]
  const speed = 600
  // Naive: flight time to where the target is now.
  const naiveT = 520 / speed
  const naiveAim = [target[0], target[1], target[2] + vel[2] * naiveT]
  const naiveDist = Math.hypot(naiveAim[0], naiveAim[1], naiveAim[2])
  const naiveFlight = naiveDist / speed
  const naiveMiss = Math.hypot(
    (naiveAim[0] / naiveDist) * speed * naiveFlight - target[0],
    0,
    (naiveAim[2] / naiveDist) * speed * naiveFlight - (target[2] + vel[2] * naiveFlight)
  )
  const solvedMiss = missDistance(shooter, target, vel, speed)
  assert.ok(
    solvedMiss < naiveMiss,
    `solved ${solvedMiss.toFixed(2)}u should beat naive ${naiveMiss.toFixed(2)}u`
  )
})

test('receding target is led further out, not short', () => {
  const aim = solveInterceptPoint([0, 0, 0], [400, 0, 0], [120, 0, 0], 600)
  assert.ok(aim[0] > 400, 'aim point should lead past a target opening range')
  assert.ok(missDistance([0, 0, 0], [400, 0, 0], [120, 0, 0], 600) < 1)
})

test('zero or bogus shot speed falls back to the raw target position', () => {
  assert.deepEqual(solveInterceptPoint([0, 0, 0], [10, 2, 3], [5, 5, 5], 0), [10, 2, 3])
})

// --- proactive engagement -------------------------------------------------

import { updateDrones, DRONE_PROACTIVE_RANGE, makeDroneState } from './drones.js'
import { getDrone, DEFAULT_DRONE_ID } from '../data/drones.js'
// NOT the starter hull: Mudlark has 0 drone bays, and ensureDrones trims
// the drone list to bay capacity — a drone on it is deleted before the update
// loop ever sees it.
const DRONE_HULL_ID = 'wayfarer'

function stateWithHostileAt(distance) {
  const d = makeDroneState(getDrone(DEFAULT_DRONE_ID), 0)
  d.deployed = true
  d.mode = 'escort'
  d.position = [0, 0, 0]
  return {
    simTime: 100,
    player: {
      ship: {
        classId: DRONE_HULL_ID,
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        drones: [d]
      }
    },
    npcs: [
      { id: 'bandit', position: [distance, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1] }
    ],
    _drone: d
  }
}

test('drones engage a hostile that closes inside the proactive range unprovoked', () => {
  const gs = stateWithHostileAt(DRONE_PROACTIVE_RANGE * 0.8)
  // engagedNpcIds empty: nobody has traded fire yet.
  updateDrones(gs, 1 / 60, { isHostileNpc: () => true, engagedNpcIds: {} })
  assert.equal(gs._drone.mode, 'combat', 'should not wait to be shot at first')
})

test('drones ignore a hostile still outside the proactive range', () => {
  const gs = stateWithHostileAt(DRONE_PROACTIVE_RANGE * 2)
  updateDrones(gs, 1 / 60, { isHostileNpc: () => true, engagedNpcIds: {} })
  assert.equal(gs._drone.mode, 'escort', 'far hostiles must not pull the escort away')
})

test('a non-hostile ship inside the bubble is left alone', () => {
  const gs = stateWithHostileAt(DRONE_PROACTIVE_RANGE * 0.5)
  updateDrones(gs, 1 / 60, { isHostileNpc: () => false, engagedNpcIds: {} })
  assert.equal(gs._drone.mode, 'escort', 'drones must not open on neutrals')
})

test('an already-engaged attacker is still pursued beyond the proactive range', () => {
  const gs = stateWithHostileAt(DRONE_PROACTIVE_RANGE * 1.1)
  updateDrones(gs, 1 / 60, { isHostileNpc: () => false, engagedNpcIds: { bandit: true } })
  assert.equal(gs._drone.mode, 'combat', 'trading fire should keep them committed')
})
