import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDamage,
  fireProjectile,
  updateProjectiles,
  updateNpcAI,
  regenShields,
  PLAYER_DAMAGE_TAKEN_MULT,
  rollShipBounty,
  applyShipBounty
} from './combat.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { flushPendingToasts } from './security.js'

const DT = 1 / 60

function step(gameState, times, fn) {
  for (let i = 0; i < times; i++) {
    gameState.simTime += DT
    fn()
  }
}

test('applyDamage layers shields then armor then hull', () => {
  const entity = { shields: 10, armor: 5, hull: 100, destroyed: false }
  applyDamage(entity, 8)
  assert.equal(entity.shields, 2)
  assert.equal(entity.armor, 5)
  assert.equal(entity.hull, 100)

  applyDamage(entity, 10)
  assert.equal(entity.shields, 0)
  assert.equal(entity.armor, 0)
  assert.equal(entity.hull, 97)
})

test('applyDamage marks entity destroyed when hull drops to zero or below', () => {
  const entity = { shields: 0, armor: 0, hull: 5, destroyed: false }
  applyDamage(entity, 20)
  assert.ok(entity.hull <= 0)
  assert.equal(entity.destroyed, true)
})

test('player takes 25% less damage than an NPC for the same hit', () => {
  const npc = { shields: 0, armor: 0, hull: 100, destroyed: false }
  const player = { shields: 0, armor: 0, hull: 100, destroyed: false }
  applyDamage(npc, 40)
  applyDamage(player, 40, null, { player: true })
  assert.equal(npc.hull, 60)
  assert.equal(player.hull, 100 - 40 * PLAYER_DAMAGE_TAKEN_MULT)
})

test('player shields regen ~1% of max per 10s out of combat', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const max = shipClass.stats.shields
  const ship = { shields: 0, lastHitAt: -Infinity }
  // 10 seconds of sim time
  for (let i = 0; i < 600; i++) {
    regenShields(ship, shipClass, 100 + i * DT, DT, { player: true, inCombat: false })
  }
  const expected = max * 0.01
  assert.ok(Math.abs(ship.shields - expected) < 0.05, `got ${ship.shields}, expected ~${expected}`)
})

test('player shields do not regen while in combat', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const ship = { shields: 0, lastHitAt: -Infinity }
  for (let i = 0; i < 600; i++) {
    regenShields(ship, shipClass, 100 + i * DT, DT, { player: true, inCombat: true })
  }
  assert.equal(ship.shields, 0)
})

test('fireProjectile spawns a projectile per hardpoint that travels and can hit a target', () => {
  const shipClass = getShipClass('needle_dart')
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  const gameState = {
    simTime: 0,
    projectiles: [],
    npcs: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 50], quaternion: [0, 0, 0, 1], destroyed: false, shields: 0, armor: 0, hull: 100 } }
  }
  fireProjectile(gameState, shooter, shipClass, 'enemy-1')
  assert.equal(gameState.projectiles.length, shipClass.hardpoints.length)

  step(gameState, 20, () => updateProjectiles(gameState, DT))
  assert.ok(gameState.player.ship.hull < 100, 'projectile should eventually hit the player ship')
})

test('fireProjectile with a weaponTypeFilter only fires matching hardpoints', () => {
  const shipClass = getShipClass('gun_barge') // one laser hardpoint, one missile hardpoint
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  const gameState = { simTime: 0, projectiles: [] }

  fireProjectile(gameState, shooter, shipClass, 'player', null, 'laser')
  assert.equal(gameState.projectiles.length, 1)
  assert.equal(gameState.projectiles[0].weaponType, 'laser')

  fireProjectile(gameState, shooter, shipClass, 'player', null, 'missile')
  assert.equal(gameState.projectiles.length, 2)
  assert.equal(gameState.projectiles[1].weaponType, 'missile')
})

test('fireProjectile uses the shooter\'s equipped weapon stats, not just a fixed per-type preset', () => {
  const shipClass = getShipClass('gun_barge') // hardpoints: wing1 (laser), wing2 (missile)
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], equippedWeapons: { wing1: 'plasma_cannon' } }
  const gameState = { simTime: 0, projectiles: [] }

  fireProjectile(gameState, shooter, shipClass, 'player', null, 'laser')
  assert.equal(gameState.projectiles[0].weaponId, 'plasma_cannon')
  assert.equal(gameState.projectiles[0].damage, 22, 'should use plasma_cannon\'s damage, not the old fixed laser preset')

  // The missile hardpoint has no explicit equippedWeapons entry, so it
  // should fall back to the category's free base weapon.
  fireProjectile(gameState, shooter, shipClass, 'player', null, 'missile')
  assert.equal(gameState.projectiles[1].weaponId, 'rocket_pod')
})

test('fireProjectile with a weaponTypeFilter the ship has no hardpoint for fires nothing', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID) // laser-only starter ship
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  const gameState = { simTime: 0, projectiles: [] }

  fireProjectile(gameState, shooter, shipClass, 'player', null, 'missile')
  assert.equal(gameState.projectiles.length, 0)
})

test('single player laser spawns on centerline and flies pure ship-forward', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shooter = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    equippedWeapons: { fwd1: 'pulse_laser' }
  }
  const hp = { ...shipClass.hardpoints[0], position: [3, 2, 5] }
  const cls = { ...shipClass, hardpoints: [hp] }
  const gameState = { simTime: 0, projectiles: [] }
  const aim = [0, 0, 200]
  fireProjectile(gameState, shooter, cls, 'player', null, 'laser', null, aim)
  assert.equal(gameState.projectiles.length, 1)
  const p = gameState.projectiles[0]
  assert.deepEqual(p.position, [0, 0, 8], 'single player laser uses centerline muzzle spawn')
  const speed = Math.hypot(...p.velocity)
  const dir = p.velocity.map((v) => v / speed)
  assert.ok(Math.abs(dir[0]) < 1e-5)
  assert.ok(Math.abs(dir[1]) < 1e-5)
  assert.ok(Math.abs(dir[2] - 1) < 1e-5)
})

test('multi-turret player LMB fires every laser with separated muzzles', () => {
  const shipClass = getShipClass('needle_dart') // two laser hardpoints
  const shooter = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    equippedWeapons: { fwd1: 'pulse_laser', fwd2: 'pulse_laser' }
  }
  const gameState = { simTime: 0, projectiles: [] }
  fireProjectile(gameState, shooter, shipClass, 'player', null, 'laser', null, [0, 0, 200])
  assert.equal(gameState.projectiles.length, 2, 'both laser hardpoints fire on LMB')
  const xs = gameState.projectiles.map((p) => p.position[0]).sort((a, b) => a - b)
  assert.ok(xs[0] < -0.5 && xs[1] > 0.5, 'laser muzzles fan left/right')
  for (const p of gameState.projectiles) {
    assert.equal(p.weaponType, 'laser')
    const speed = Math.hypot(...p.velocity)
    const dir = p.velocity.map((v) => v / speed)
    assert.ok(Math.abs(dir[2] - 1) < 1e-5, 'lasers still fly ship-forward')
  }
})

test('multi-launcher player RMB fires every missile hardpoint', () => {
  const shipClass = {
    ...getShipClass('gun_barge'),
    hardpoints: [
      { id: 'm1', position: [-1.2, 0, 6], type: 'missile' },
      { id: 'm2', position: [1.2, 0, 6], type: 'missile' }
    ]
  }
  const shooter = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    equippedWeapons: { m1: 'rocket_pod', m2: 'rocket_pod' }
  }
  const gameState = { simTime: 0, projectiles: [] }
  fireProjectile(gameState, shooter, shipClass, 'player', null, 'missile', null, [0, 0, 200])
  assert.equal(gameState.projectiles.length, 2, 'both missile hardpoints fire on RMB')
  const xs = gameState.projectiles.map((p) => p.position[0]).sort((a, b) => a - b)
  assert.ok(xs[0] < -0.5 && xs[1] > 0.5, 'missile muzzles are laterally separated')
  for (const p of gameState.projectiles) assert.equal(p.weaponType, 'missile')
})

test('prunePlayerLasersOffBoresight drops turn-spray but keeps on-axis bolts', async () => {
  const { prunePlayerLasersOffBoresight } = await import('./combat.js')
  const gameState = {
    player: { ship: { quaternion: [0, 0, 0, 1] } },
    projectiles: [
      { id: 'a', ownerId: 'player', weaponType: 'laser', velocity: [0, 0, 600] },
      { id: 'b', ownerId: 'player', weaponType: 'laser', velocity: [600, 0, 0] }, // 90° off
      { id: 'c', ownerId: 'player', weaponType: 'missile', velocity: [100, 0, 0] },
      { id: 'd', ownerId: 'npc-1', weaponType: 'laser', velocity: [0, 100, 0] }
    ]
  }
  prunePlayerLasersOffBoresight(gameState)
  assert.deepEqual(
    gameState.projectiles.map((p) => p.id),
    ['a', 'c', 'd'],
    'only the off-boresight player laser is removed'
  )
})

test('prunePlayerLasersOffBoresight spares drone bolts fired off the ship axis', async () => {
  const { prunePlayerLasersOffBoresight } = await import('./combat.js')
  const gameState = {
    player: { ship: { quaternion: [0, 0, 0, 1] } },
    projectiles: [
      // A drone sits off to one side and engages its own target, so its bolts
      // are almost never aligned with the player's nose. They must survive, or
      // drones can never land a hit.
      { id: 'drone', ownerId: 'player', weaponType: 'laser', velocity: [600, 0, 0], fromDrone: true },
      { id: 'spray', ownerId: 'player', weaponType: 'laser', velocity: [600, 0, 0] }
    ]
  }
  prunePlayerLasersOffBoresight(gameState)
  assert.deepEqual(
    gameState.projectiles.map((p) => p.id),
    ['drone'],
    'drone bolt kept, player turn-spray at the same angle still culled'
  )
})

test('NPC lasers keep full hardpoint offsets when aiming at aimWorld', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shooter = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    equippedWeapons: { fwd1: 'pulse_laser' }
  }
  const hp = { ...shipClass.hardpoints[0], position: [3, 2, 5] }
  const cls = { ...shipClass, hardpoints: [hp] }
  const gameState = { simTime: 0, projectiles: [] }
  const aim = [0, 0, 200]
  fireProjectile(gameState, shooter, cls, 'npc-1', null, 'laser', null, aim)
  assert.equal(gameState.projectiles.length, 1)
  assert.deepEqual(gameState.projectiles[0].position, [3, 2, 5])
})

test('a player laser hitting an asteroid field mines ore instead of dealing damage', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const fieldId = 'field-test'
  const rock = getAsteroidRocks({ id: fieldId, radius: 90 })[0]
  // Places the field so this specific rock sits exactly on the shooter's
  // straight-ahead flight path (matching the starter ship's single, centered
  // hardpoint), since per-rock hit detection needs actual alignment rather
  // than the old field-wide bounding sphere.
  const asteroidField = { id: fieldId, kind: 'asteroidField', position: [-rock.position[0], -rock.position[1], 100 - rock.position[2]], radius: 90 }
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  const gameState = {
    simTime: 0,
    projectiles: [],
    npcs: [],
    galaxy: { systems: [{ id: 'sys-0', galaxyPosition: [0, 0, 0], bodies: [asteroidField] }] },
    player: {
      currentSystemId: 'sys-0',
      ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], miningHold: {} }
    }
  }
  fireProjectile(gameState, shooter, shipClass, 'player')
  assert.equal(gameState.projectiles.length, shipClass.hardpoints.length)

  let hitPayload = null
  step(gameState, 20, () => updateProjectiles(gameState, DT, (payload) => { hitPayload = payload }))

  assert.equal(gameState.projectiles.length, 0, 'the projectile should be consumed by the asteroid field, not pass through')
  assert.ok(hitPayload?.mined, 'onHit should report a mining result')
  const totalOre = Object.values(gameState.player.ship.miningHold).reduce((a, b) => a + b, 0)
  assert.equal(totalOre, 1, 'a successful mining hit should add exactly one unit of ore')
})

test('a nearby hostile NPC suppresses mining on a normal field (ship-combat disambiguation)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const fieldId = 'field-test-2'
  const rock = getAsteroidRocks({ id: fieldId, radius: 90 })[0]
  const asteroidField = { id: fieldId, kind: 'asteroidField', position: [-rock.position[0], -rock.position[1], 100 - rock.position[2]], radius: 90 }
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  // Off to the side (not on the flight path) but well within the mining/combat
  // skip radius of the player.
  const nearbyPirate = { id: 'npc-near', faction: 'pirate', position: [100, 0, 0], destroyed: false }
  const gameState = {
    simTime: 0,
    projectiles: [],
    npcs: [nearbyPirate],
    galaxy: { systems: [{ id: 'sys-0', galaxyPosition: [0, 0, 0], bodies: [asteroidField] }] },
    player: {
      currentSystemId: 'sys-0',
      combatEngagedNpcIds: {},
      ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], miningHold: {} }
    }
  }
  fireProjectile(gameState, shooter, shipClass, 'player')
  let hitPayload = null
  step(gameState, 20, () => updateProjectiles(gameState, DT, (payload) => { hitPayload = payload }))
  assert.ok(!hitPayload?.mined, 'a nearby hostile should suppress the rock hit-test on a normal field')
})

test('an ore_anomaly-tagged field keeps mining even with a hostile NPC nearby (ambush guards)', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const fieldId = 'field-test-3'
  const rock = getAsteroidRocks({ id: fieldId, radius: 90 })[0]
  const asteroidField = {
    id: fieldId,
    kind: 'asteroidField',
    position: [-rock.position[0], -rock.position[1], 100 - rock.position[2]],
    radius: 90,
    anomalySiteId: 'anomaly-1'
  }
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  const nearbyPirate = { id: 'npc-near', faction: 'pirate', position: [100, 0, 0], destroyed: false }
  const gameState = {
    simTime: 0,
    projectiles: [],
    npcs: [nearbyPirate],
    galaxy: { systems: [{ id: 'sys-0', galaxyPosition: [0, 0, 0], bodies: [asteroidField] }] },
    player: {
      currentSystemId: 'sys-0',
      combatEngagedNpcIds: {},
      ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], miningHold: {} }
    }
  }
  fireProjectile(gameState, shooter, shipClass, 'player')
  let hitPayload = null
  step(gameState, 20, () => updateProjectiles(gameState, DT, (payload) => { hitPayload = payload }))
  assert.ok(hitPayload?.mined, 'an ore_anomaly field should mine normally regardless of nearby guards')
})

test('destroying an NPC with a player projectile leaves a lootable wreck at the impact point', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  const npc = { id: 'npc-9', shipClassId: 'light_runner', faction: 'trader', position: [0, 0, 50], hull: 1, shields: 0, armor: 0, destroyed: false }
  const gameState = {
    simTime: 0,
    projectiles: [],
    npcs: [npc],
    wrecks: [],
    player: {
      credits: 0,
      currentSystemId: 'sys-0',
      startingSystemId: null,
      ship: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
    }
  }
  fireProjectile(gameState, shooter, shipClass, 'player')
  step(gameState, 20, () => updateProjectiles(gameState, DT))

  assert.equal(npc.destroyed, true)
  assert.equal(gameState.wrecks.length, 1)
  assert.ok(gameState.wrecks[0].loot.cargo, 'wreck should carry some lootable cargo')
  // No galaxy/system in fixture → security 0; still pays a random bounty.
  assert.ok(gameState.player.credits >= 100, 'player kill should award bounty credits')
  const toasts = flushPendingToasts(gameState)
  assert.ok(toasts.some((t) => /Bounty \+\d+ cr/.test(t)), 'bounty toast should be queued')
})

test('rollShipBounty pays more in lower security systems', () => {
  // Fixed mid-roll for frac so only security multiplier differs.
  const mid = () => 0.5
  const lowSec = rollShipBounty('light_runner', 0, mid)
  const highSec = rollShipBounty('light_runner', 6, mid)
  assert.ok(lowSec > highSec, `sec0 (${lowSec}) should beat sec6 (${highSec})`)
  assert.ok(lowSec >= 100)
  assert.ok(highSec >= 100)
})

test('applyShipBounty adds credits and queues a toast', () => {
  const gs = { player: { credits: 500 } }
  const paid = applyShipBounty(gs, { shipClassId: 'light_runner' }, 3, () => 0.5)
  assert.ok(paid >= 100)
  assert.equal(gs.player.credits, 500 + paid)
  assert.deepEqual(flushPendingToasts(gs), [`Bounty +${paid} cr`])
})

test('NPC AI: a pirate close to the player transitions from patrol to attack', () => {
  const npc = {
    id: 'npc-0', shipClassId: 'raider_mk1', faction: 'pirate',
    position: [0, 0, 50], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1],
    hull: 90, shields: 60, armor: 25, aiState: 'patrol', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] } }
  }
  updateNpcAI(npc, gameState, DT)
  assert.equal(npc.aiState, 'attack')
})

test('NPC AI: an attacking pirate closes distance on the player and eventually fires', () => {
  const npc = {
    id: 'npc-2', shipClassId: 'raider_mk1', faction: 'pirate',
    position: [15, 0, 120], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1],
    hull: 90, shields: 60, armor: 25, aiState: 'patrol', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], destroyed: false, shields: 0, armor: 0, hull: 100 } }
  }
  const startDistance = Math.hypot(...npc.position)

  step(gameState, 300, () => {
    updateNpcAI(npc, gameState, DT)
    updateProjectiles(gameState, DT)
  })

  const endDistance = Math.hypot(...npc.position)
  assert.ok(endDistance < startDistance, 'attacking pirate should close distance on the player, not flee from it')
  assert.ok(gameState.player.ship.hull < 100, 'pirate should eventually get in range/cone and land a hit')
})

test('NPC AI: low hull fraction forces flee (or, rarely, a suicide ram)', () => {
  // A ~3% chance rolls 'ram' instead of 'flee' the moment hull first drops
  // this low (see RAM_CHANCE) — both are valid "this ship is desperate" outcomes.
  const npc = {
    id: 'npc-1', shipClassId: 'raider_mk1', faction: 'pirate',
    position: [0, 0, 50], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1],
    hull: 10, shields: 0, armor: 0, aiState: 'attack', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 100, shields: 0, armor: 0 } }
  }
  updateNpcAI(npc, gameState, DT)
  assert.ok(['flee', 'ram'].includes(npc.aiState))
})

test('NPC AI: a desperate ship almost always flees, but sometimes commits to a suicide ram on the player', () => {
  const outcomes = { flee: 0, ram: 0 }
  for (let i = 0; i < 500; i++) {
    const npc = {
      id: `npc-${i}`, shipClassId: 'raider_mk1', faction: 'pirate',
      position: [0, 0, 50], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1],
      hull: 10, shields: 0, armor: 0, aiState: 'attack', patrolTarget: null,
      lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
    }
    const gameState = {
      simTime: 0,
      npcs: [npc], projectiles: [],
      player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 100, shields: 0, armor: 0 } }
    }
    updateNpcAI(npc, gameState, DT)
    outcomes[npc.aiState]++
  }
  assert.ok(outcomes.flee > 400, `expected fleeing to dominate, got ${JSON.stringify(outcomes)}`)
  assert.ok(outcomes.ram > 0, 'expected at least one suicide ram across 500 trials')
})

test('NPC AI: a ramming ship charges the player and deals damage (and destroys itself) on impact', () => {
  const npc = {
    id: 'npc-3', shipClassId: 'raider_mk1', faction: 'pirate',
    position: [0, 0, 5], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1],
    hull: 10, shields: 0, armor: 0, aiState: 'ram', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 100, shields: 0, armor: 0 } }
  }
  updateNpcAI(npc, gameState, DT)
  assert.ok(gameState.player.ship.hull < 100, 'ramming into contact range should damage the player')
  assert.equal(npc.destroyed, true, 'the rammer destroys itself on impact')
})
