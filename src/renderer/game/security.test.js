import test from 'node:test'
import assert from 'node:assert/strict'
import {
  localSecurityAt,
  applyLocalSecurity,
  canDockWithLaw,
  SECURITY_INFLUENCE_RANGE,
  LAW_STATION_DOCK_MIN
} from './security.js'

function seaWith(bodies) {
  return { id: 'sea-0', bodies, securityRating: 0 }
}

const harbour = { id: 'p1', kind: 'port', position: [0, 0, 0], securityRating: 6 }
const backwater = { id: 'p2', kind: 'port', position: [30000, 0, 0], securityRating: 2 }

test('sitting in a patrolled anchorage reports that harbour rating', () => {
  assert.equal(localSecurityAt(seaWith([harbour]), [0, 0, 0]), 6)
})

test('security falls off with distance and is gone past patrol range', () => {
  const world = seaWith([harbour])
  const near = localSecurityAt(world, [1000, 0, 0])
  const mid = localSecurityAt(world, [SECURITY_INFLUENCE_RANGE * 0.6, 0, 0])
  assert.ok(near >= mid, 'closer water should be no worse policed')
  assert.ok(mid > 0, 'inside patrol range something should still respond')
  assert.equal(localSecurityAt(world, [SECURITY_INFLUENCE_RANGE + 10, 0, 0]), 0)
})

test('the open sea between harbours is lawless', () => {
  const world = seaWith([harbour, backwater])
  assert.equal(localSecurityAt(world, [15000, 0, 15000]), 0)
})

test('the nearest harbour wins, not the strongest', () => {
  const world = seaWith([harbour, { ...backwater, position: [2000, 0, 0] }])
  assert.equal(localSecurityAt(world, [2000, 0, 0]), 2)
})

test('unpoliced places do not suppress a nearby patrolled one', () => {
  const lawless = { id: 'p3', kind: 'port', position: [100, 0, 0], securityRating: 0 }
  assert.equal(localSecurityAt(seaWith([lawless, harbour]), [120, 0, 0]), 6)
})

test('applyLocalSecurity writes onto the world so old call sites keep working', () => {
  const world = seaWith([harbour])
  applyLocalSecurity(world, [0, 0, 0])
  assert.equal(world.securityRating, 6)
  applyLocalSecurity(world, [40000, 0, 40000])
  assert.equal(world.securityRating, 0, 'sailing away must actually drop the law')
})

test('a high-security harbour refuses an outlaw, an outpost does not', () => {
  const world = seaWith([harbour])
  const outlaw = { player: { lawStanding: LAW_STATION_DOCK_MIN - 1 } }
  const honest = { player: { lawStanding: LAW_STATION_DOCK_MIN } }
  const outpost = { id: 'o1', kind: 'outpost', position: [0, 0, 0], securityRating: 4 }

  assert.equal(canDockWithLaw(outlaw, harbour, world), false)
  assert.equal(canDockWithLaw(honest, harbour, world), true)
  assert.equal(canDockWithLaw(outlaw, outpost, world), true, 'outposts take anyone')
})

test('a lawless harbour takes an outlaw', () => {
  const world = seaWith([])
  const smugglersDen = { id: 'p9', kind: 'port', position: [0, 0, 0], securityRating: 0 }
  assert.equal(canDockWithLaw({ player: { lawStanding: 0 } }, smugglersDen, world), true)
})
