import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDamage,
  fireProjectile,
  updateProjectiles,
  updateNpcAI,
  PLAYER_DAMAGE_TAKEN_MULT,
  rollShipBounty,
  applyShipBounty
} from './combat.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { flushPendingToasts } from './security.js'
import { getWeapon } from '../data/weapons.js'

const DT = 1 / 60

function step(gameState, times, fn) {
  for (let i = 0; i < times; i++) {
    gameState.simTime += DT
    fn()
  }
}

test('applyDamage takes armour first, then the hull', () => {
  // No shields on this sea, and nothing grows back — armour is a one-time
  // buffer that has to be welded on again at a yard.
  const entity = { armor: 15, hull: 100, destroyed: false }
  applyDamage(entity, 8)
  assert.equal(entity.armor, 7)
  assert.equal(entity.hull, 100)

  applyDamage(entity, 10)
  assert.equal(entity.armor, 0)
  assert.equal(entity.hull, 97)
})

test('armour does not come back on its own', () => {
  const entity = { armor: 0, hull: 50, destroyed: false, lastHitAt: 0 }
  applyDamage(entity, 5, 0)
  const before = { armor: entity.armor, hull: entity.hull }
  // Plenty of quiet time later, nothing has changed.
  applyDamage(entity, 0, 600)
  assert.deepEqual({ armor: entity.armor, hull: entity.hull }, before)
})

test('applyDamage marks entity destroyed when hull drops to zero or below', () => {
  const entity = { armor: 0, hull: 5, destroyed: false }
  applyDamage(entity, 20)
  assert.ok(entity.hull <= 0)
  assert.equal(entity.destroyed, true)
})

test('player takes 25% less damage than an NPC for the same hit', () => {
  const npc = { armor: 0, hull: 100, destroyed: false }
  const player = { armor: 0, hull: 100, destroyed: false }
  applyDamage(npc, 40)
  applyDamage(player, 40, null, { player: true })
  assert.equal(npc.hull, 60)
  assert.equal(player.hull, 100 - 40 * PLAYER_DAMAGE_TAKEN_MULT)
})

test('fireProjectile spawns a projectile per hardpoint that travels and can hit a target', () => {
  const shipClass = getShipClass('needle_dart')
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  const gameState = {
    simTime: 0,
    projectiles: [],
    npcs: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 50], quaternion: [0, 0, 0, 1], destroyed: false, armor: 0, hull: 100 } }
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
  // Read the expected damage from the catalogue rather than pinning a number —
  // the point of the test is the lookup, not the balance figure.
  assert.equal(
    gameState.projectiles[0].damage,
    getWeapon('plasma_cannon').damage,
    'should use the equipped weapon\'s damage, not a fixed per-type preset'
  )

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

test('a single gun fires from the turret muzzle, not the hull centreline', () => {
  // The guns are on a mount now. Where a round starts is the end of the barrel,
  // wherever the barrel happens to be trained — not a fixed point on the hull.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shooter = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    equippedWeapons: { fwd1: 'pulse_laser' }
  }
  const hp = { ...shipClass.hardpoints[0], position: [3, 2, 5] }
  const cls = { ...shipClass, hardpoints: [hp] }
  const gameState = { simTime: 0, projectiles: [] }
  const muzzle = [0, 4, 9]
  const aim = [0, 4, 400]
  fireProjectile(gameState, shooter, cls, 'player', null, 'laser', null, aim, muzzle)
  assert.equal(gameState.projectiles.length, 1)
  const p = gameState.projectiles[0]
  assert.ok(
    Math.hypot(p.position[0] - muzzle[0], p.position[1] - muzzle[1], p.position[2] - muzzle[2]) < 1,
    `round started at ${p.position}, not at the barrel ${muzzle}`
  )
  const speed = Math.hypot(...p.velocity)
  const dir = p.velocity.map((v) => v / speed)
  assert.ok(Math.abs(dir[2] - 1) < 1e-3, 'and flies at the point the gun is laid on')
})

test('the guns follow the turret, not the bow', () => {
  // The behaviour this replaces: player shots used to be forced down the hull's
  // +Z whatever they were aimed at, because they were welded to it.
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shooter = {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    equippedWeapons: { fwd1: 'pulse_laser' }
  }
  const gameState = { simTime: 0, projectiles: [] }
  // Laid hard to starboard and elevated, while the bow still points down +Z.
  fireProjectile(gameState, shooter, shipClass, 'player', null, 'laser', null, [-300, 90, 40], [0, 4, 6])
  const p = gameState.projectiles[0]
  const speed = Math.hypot(...p.velocity)
  assert.ok(p.velocity[0] / speed < -0.7, 'the round should go where the gun is pointing')
  assert.ok(p.velocity[1] / speed > 0.1, 'including upward, for anything not on the surface')
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
  assert.ok(xs[0] < -0.5 && xs[1] > 0.5, 'muzzles fan left/right so both are visible')
  for (const p of gameState.projectiles) {
    assert.equal(p.weaponType, 'laser')
    const speed = Math.hypot(...p.velocity)
    const dir = p.velocity.map((v) => v / speed)
    // Every mount converges on the point the gun is laid on, rather than each
    // firing parallel down the hull axis.
    assert.ok(dir[2] > 0.99, 'rounds converge on the aim point')
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
  const asteroidField = { id: fieldId, kind: 'wreckField', position: [-rock.position[0], -rock.position[1], 100 - rock.position[2]], radius: 90 }
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

test('salvaging still chips wrecks with a hostile NPC nearby', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const fieldId = 'field-test-2'
  const rock = getAsteroidRocks({ id: fieldId, radius: 90 })[0]
  const asteroidField = { id: fieldId, kind: 'wreckField', position: [-rock.position[0], -rock.position[1], 100 - rock.position[2]], radius: 90 }
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
  assert.ok(hitPayload?.mined, 'nearby hostiles must not block salvage hits on wreck fields')
})

test('destroying an NPC with a player projectile leaves a lootable wreck at the impact point', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const shooter = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], lastFireAt: -Infinity }
  const npc = { id: 'npc-9', shipClassId: 'light_runner', faction: 'trader', position: [0, 0, 50], hull: 1, armor: 0, destroyed: false }
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
    hull: 90, armor: 25, aiState: 'patrol', patrolTarget: null,
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
    hull: 90, armor: 25, aiState: 'patrol', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], destroyed: false, armor: 0, hull: 100 } }
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
    hull: 10, armor: 0, aiState: 'attack', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 100, armor: 0 } }
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
      hull: 10, armor: 0, aiState: 'attack', patrolTarget: null,
      lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
    }
    const gameState = {
      simTime: 0,
      npcs: [npc], projectiles: [],
      player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 100, armor: 0 } }
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
    hull: 10, armor: 0, aiState: 'ram', patrolTarget: null,
    lastHitAt: -Infinity, lastFireAt: -Infinity, destroyed: false
  }
  const gameState = {
    simTime: 0,
    npcs: [npc], projectiles: [],
    player: { ship: { classId: STARTER_SHIP_CLASS_ID, position: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 100, armor: 0 } }
  }
  updateNpcAI(npc, gameState, DT)
  assert.ok(gameState.player.ship.hull < 100, 'ramming into contact range should damage the player')
  assert.equal(npc.destroyed, true, 'the rammer destroys itself on impact')
})

// --- NPCs are boats: they cannot climb, dive, or aim their bow at the sky ---

function seaState(npcs, playerPos = [0, 0, 0]) {
  return {
    simTime: 0,
    projectiles: [],
    npcs,
    player: {
      combatEngagedNpcIds: {},
      ship: { classId: STARTER_SHIP_CLASS_ID, position: playerPos, velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], hull: 200, armor: 20 }
    }
  }
}

function pirate(position, extra = {}) {
  const cls = getShipClass('raider_mk1')
  return {
    id: 'npc-sea', shipClassId: 'raider_mk1', faction: 'pirate',
    position, velocity: [0, 0, 0], quaternion: [0, 0, 0, 1],
    hull: cls.stats.hull, armor: cls.stats.armor,
    aiState: 'patrol', patrolTarget: null, lastHitAt: -Infinity, lastFireAt: -Infinity,
    destroyed: false, equippedWeapons: [], hostileToPlayer: true, ...extra
  }
}

test('NPC AI: an attacking boat never leaves the surface, however high the target', () => {
  // The player used to be able to climb away; nothing on the water can follow.
  const npc = pirate([0, 0, 120])
  const gameState = seaState([npc], [0, 400, 0])
  step(gameState, 400, () => updateNpcAI(npc, gameState, DT, () => {}, () => {}))
  assert.ok(Math.abs(npc.position[1]) < 6, `boat reached altitude ${npc.position[1]}`)
  assert.equal(npc.velocity[1], 0, 'no vertical way may accumulate')
})

test('NPC AI: a fleeing boat runs across the water, not upward', () => {
  const cls = getShipClass('raider_mk1')
  const npc = pirate([0, 0, 60], { hull: cls.stats.hull * 0.1, aiState: 'flee' })
  const gameState = seaState([npc], [0, -300, 0])
  step(gameState, 300, () => updateNpcAI(npc, gameState, DT, () => {}, () => {}))
  assert.ok(Math.abs(npc.position[1]) < 6, `fled to altitude ${npc.position[1]}`)
  assert.ok(Math.hypot(npc.position[0], npc.position[2] - 60) > 1, 'it should actually get away')
})

test('NPC AI: a patrolling boat stays on the water', () => {
  const npc = pirate([500, 0, 500], { hostileToPlayer: false })
  const gameState = seaState([npc], [40000, 0, 40000])
  step(gameState, 600, () => updateNpcAI(npc, gameState, DT, () => {}, () => {}))
  assert.ok(Math.abs(npc.position[1]) < 6, `patrol drifted to ${npc.position[1]}`)
  assert.ok(npc.patrolTarget, 'it should have picked somewhere to go')
  assert.equal(npc.patrolTarget[1], 0, 'patrol waypoints are on the surface')
})

test('NPC AI: the bow stays level — a boat aims by heading, not by pitching', () => {
  const npc = pirate([0, 0, 150])
  const gameState = seaState([npc], [0, 250, 0])
  step(gameState, 200, () => updateNpcAI(npc, gameState, DT, () => {}, () => {}))
  const q = npc.quaternion
  // Recover the hull's forward axis and check it is close to horizontal; wave
  // tilt is allowed, pointing the gun at the sky is not.
  const fy = 2 * (q[1] * q[2] + q[3] * q[0])
  assert.ok(Math.abs(fy) < 0.35, `bow pitched to ${fy}`)
})

test('a moored boat cannot be attacked', () => {
  // Tied up under a harbour's guns: raiders lose interest, shots already in the
  // air pass through, and a ram run cannot connect.
  const npc = pirate([0, 0, 40])
  const gameState = seaState([npc])
  gameState.player.dockedBodyId = 'body-1'
  const cls = getShipClass(STARTER_SHIP_CLASS_ID)
  gameState.player.ship.hull = cls.stats.hull

  step(gameState, 400, () => updateNpcAI(npc, gameState, DT, () => {}, () => {}))
  assert.notEqual(npc.aiState, 'attack', 'a moored boat is not a target')

  // A shot already in flight, aimed at the player, must not land.
  gameState.projectiles.push({
    id: 'p1', ownerId: npc.id, position: [0, 0, 6], velocity: [0, 0, -400],
    damage: 50, ttl: 2, weaponType: 'laser', targetRef: { kind: 'player' }
  })
  step(gameState, 20, () => updateProjectiles(gameState, DT, () => {}))
  assert.equal(gameState.player.ship.hull, cls.stats.hull, 'no damage while moored')

  // Slip the mooring and the same pirate engages again.
  gameState.player.dockedBodyId = null
  step(gameState, 200, () => updateNpcAI(npc, gameState, DT, () => {}, () => {}))
  assert.equal(npc.aiState, 'attack', 'once under way it is fair game again')
})
