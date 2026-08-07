import * as THREE from 'three'
import { getShipClass } from '../data/shipClasses.js'
import { effectiveHardpoints } from '../data/accessories.js'
import { getSystem } from '../procgen/world.js'
import { snapToSea } from '../world/sea.js'
import { inHomeWaters } from '../procgen/world.js'
import { headingOf, applySeaAttitude } from './flight.js'
import { aimTurretAt, turretMuzzleWorld, turretAimPoint } from './turret.js'
import {
  clearPositionOfBodies,
  positionOverlapsBodies,
  NPC_FLIGHT_CLEARANCE,
  NPC_SPAWN_SHIP_RADIUS
} from './spawner.js'
import { mineRock, isRockAlive, mineYieldForWeapon } from './mining.js'
import { spawnWreckWithSkills } from './wrecks.js'
import { playerSkillBonuses } from './skills.js'
import { getAsteroidRocks } from '../render/asteroidFieldMesh.js'
import { rockCollisionRadius } from './collision.js'
import { getWeapon, BASE_WEAPON_ID, ALIEN_BASE_WEAPON_ID } from '../data/weapons.js'
import { damageDrone } from './drones.js'
import {
  applyLawPenaltyForAttack,
  applyLawBonusForPirateKill,
  policeHostileToPlayer,
  civiliansHostileToPlayer,
  lawPenaltyAppliesInSystem,
  getSystemSecurity
} from './security.js'

/**
 * Random destroy bounty for an NPC hull. Higher pay in lower-security systems
 * (same (6−sec) bias as alien base rewards). Police / free hulls use hull HP
 * as a stand-in for market price.
 *
 * @returns {number} credits awarded (always ≥ 100 when called with a class id)
 */
export function rollShipBounty(shipClassId, securityRating, rng = Math.random) {
  let price = 0
  let hull = 80
  try {
    const cls = getShipClass(shipClassId)
    price = Math.max(0, Number(cls?.price) || 0)
    hull = Math.max(40, Number(cls?.stats?.hull) || 80)
  } catch {
    /* unknown class — keep hull fallback */
  }
  // Paid hulls: % of market value. Free/police: ~hull×80 synthetic value.
  const valueBase = price > 0 ? price : hull * 80
  // ~1.5–5% of value, then security multiplier.
  const frac = 0.015 + rng() * 0.035
  const sec = Math.max(0, Math.min(6, Math.floor(Number(securityRating) || 0)))
  const secMult = 1 + (6 - sec) * 0.22
  return Math.max(100, Math.round(valueBase * frac * secMult))
}

/** Award destroy bounty credits + toast. Returns credits paid. */
export function applyShipBounty(gameState, target, securityRating, rng = Math.random) {
  if (!gameState?.player || !target) return 0
  const shipClassId = target.shipClassId ?? target.classId
  const credits = rollShipBounty(shipClassId, securityRating, rng)
  gameState.player.credits = (gameState.player.credits ?? 0) + credits
  gameState._pendingToasts = gameState._pendingToasts ?? []
  gameState._pendingToasts.push(`Bounty +${credits} BU`)
  return credits
}

/**
 * Track NPCs the player has shot or that have shot the player.
 * Drones only engage these — never tab-lock alone.
 */
export function markPlayerCombatEngagement(gameState, proj, target, isPlayerTarget) {
  if (!gameState?.player) return
  gameState.player.combatEngagedNpcIds ??= {}
  if (proj.ownerId === 'player' && !isPlayerTarget && target?.id) {
    const already = !!gameState.player.combatEngagedNpcIds[target.id]
    // Sticky flag + map: radar/AI flip with no per-frame system lookups.
    gameState.player.combatEngagedNpcIds[target.id] = true
    target.hostileToPlayer = true
    // Law penalty only in Sec 3–6 for first strike on non-hostiles.
    if (!already && target.faction !== 'pirate' && target.faction !== 'alien') {
      // Queue only — never touch security/DOM on the hit frame.
      gameState._pendingLawPenalties = (gameState._pendingLawPenalties ?? 0) + 1
      gameState._pendingLawNpcId = gameState.player.currentSystemId
    }
  }
  if (isPlayerTarget && proj.ownerId && proj.ownerId !== 'player') {
    gameState.player.combatEngagedNpcIds[proj.ownerId] = true
    // Shooter is now hostile if we can find them.
    const shooter = gameState.npcs?.find((n) => n.id === proj.ownerId)
    if (shooter) shooter.hostileToPlayer = true
  }
}

/** Apply deferred innocent-attack law penalties (call once per frame, after combat). */
export function flushPendingLawPenalties(gameState) {
  const n = gameState?._pendingLawPenalties | 0
  if (!n) return
  gameState._pendingLawPenalties = 0
  const system = gameState.galaxy
    ? getSystem(gameState.galaxy, gameState._pendingLawSystemId ?? gameState.player.currentSystemId)
    : null
  gameState._pendingLawSystemId = null
  // securityRating on the world is live local security, refreshed each frame
  // from the player's position by security.js applyLocalSecurity.
  if (system && !lawPenaltyAppliesInSystem(system)) return
  // One standing loss per first-strike even if multiple shots landed same frame.
  applyLawPenaltyForAttack(gameState, false)
}

export function isNpcEngagedWithPlayer(gameState, npcId) {
  return !!(gameState?.player?.combatEngagedNpcIds?.[npcId])
}

/** Drop dead / gone NPCs from the engagement set. */
export function pruneCombatEngagement(gameState) {
  const map = gameState?.player?.combatEngagedNpcIds
  if (!map) return
  const live = new Set()
  for (const n of gameState.npcs ?? []) {
    if (!n.destroyed && n.id) live.add(n.id)
  }
  for (const id of Object.keys(map)) {
    if (!live.has(id)) delete map[id]
  }
}

const HIT_RADIUS = 1.5
// Generous, not person-scale on purpose. A ship's aim is a single snapshot
// taken when it opens up (aimTurretAt), with no lead prediction; over a
// laser's ~0.1-1.3s flight time a walking/running target on foot can cover
// several metres, and a tight hitbox against that made every shot resolve
// as a terrain splash a stride short of the player instead of a hit — it
// "landed" (visible impact FX) but never actually connected.
const ON_FOOT_HIT_RADIUS = 6
// Mining lasers need a generous pad — pure geometric rock shells are easy to miss
// at speed / with wing parallax, and felt "broken" when reticle sat on a rock.
const MINE_HIT_PAD = 14
// Nothing on this sea has shields — armour absorbs, then the hull takes it, and
// steel does not grow back. Repairs are a yard job (game/economy.js repairShip).

const ATTACK_RANGE = 800
// Anomaly-spawned guards/waves (tagged npc.anomalySiteId) hunt a bit further
// than normal contacts so a site fight starts as you approach the cluster —
// not the old space-era multi-km radius.
const ANOMALY_GUARD_ATTACK_RANGE = 550
const ANOMALY_GUARD_DISENGAGE_RANGE = 850
// Same 1.5x gap above ATTACK_RANGE as before the engagement range was
// raised — the buffer that stops a target sitting right at the boundary
// from flickering between attack and patrol every frame.
const DISENGAGE_RANGE = 1200
const FIRE_RANGE = 800
const FIRE_CONE_DOT = 0.9
const FLEE_HULL_FRACTION = 0.25
const COMBAT_COOLDOWN_S = 6

// Once an attacker closes within this range it may start circling rather
// than always closing head-on (see the `isOrbiter` coin-flip below).
const ORBIT_RANGE = 90
// A hit this recent makes an attacker break off and open the range for a
// moment before pressing the attack again, instead of tanking hits blindly.
const EVADE_WINDOW_S = 1.2
// Rolled once, the moment an NPC first drops below FLEE_HULL_FRACTION — a
// suicide run instead of fleeing. Never re-rolled per frame, or the "3%"
// would resolve to near-certain within a fraction of a second at 60fps.
const RAM_CHANCE = 0.03
const RAM_DAMAGE = 60
const RAM_QUOTES = ['Ramming speed!', "I'm taking you with me!", 'No surrender!']

let projectileCounter = 0

// All cooldown/regen timing below is driven by gameState.simTime (seconds
// accumulated from per-frame dt), never wall-clock time, so combat logic
// behaves identically whether it's run at 60fps or fast-forwarded in a test.

// Player ship takes less weapon damage than NPCs (same shot, less effect).
export const PLAYER_DAMAGE_TAKEN_MULT = 0.75

export function applyDamage(entity, amount, simTime = null, { player = false } = {}) {
  let remaining = amount
  if (player) remaining *= PLAYER_DAMAGE_TAKEN_MULT
  if (remaining > 0 && entity.armor > 0) {
    const absorbed = Math.min(entity.armor, remaining)
    entity.armor -= absorbed
    remaining -= absorbed
  }
  if (remaining > 0) entity.hull -= remaining
  if (simTime !== null) entity.lastHitAt = simTime
  if (entity.hull <= 0 && 'destroyed' in entity) entity.destroyed = true
}

// weaponTypeFilter (optional) restricts firing to hardpoints of that type —
// main.js: LMB = lasers, RMB = missiles (both may fire in the same frame).
// NPCs omit it and fire every hardpoint as before.
// targetRef (optional) is who this shot is actually aimed at — { kind:
// 'player' } or { kind: 'npc', id }. Only NPC shooters set it (see
// updateNpcAI/opponentsFor below); the player's own shots omit it and keep
// hitting any NPC in range, unchanged. updateProjectiles uses it to resolve
// NPC-vs-NPC hits (e.g. a pirate firing on an alien during a truce) without
// every NPC projectile defaulting to "hits the player".
//
// Each hardpoint's actual damage/speed/cooldown/ttl comes from whatever
// weapon is equipped there (shooter.equippedWeapons[hp.id], from
// data/weapons.js) rather than a fixed per-type preset — hp.type is only the
// hardpoint's *mount* kind (what category of weapon fits), not the weapon
// itself. Falls back to that category's free base weapon if nothing (or an
// NPC, which never shops) has equippedWeapons set for it.
// Default NPC aim: converge on ship +Z ahead. Player passes aimWorld = the
// shared chase/reticle aim point (ship +Z × AIM_LOOK_AHEAD from sceneSync).
const DEFAULT_AIM_DISTANCE = 400
const _aimPoint = new THREE.Vector3()
const _projDir = new THREE.Vector3()
const _projQuat = new THREE.Quaternion()
const _localForward = new THREE.Vector3(0, 0, 1)
// fireProjectile scratch — avoid per-hardpoint Vector3/Quaternion allocs.
const _fireQuat = new THREE.Quaternion()
const _firePos = new THREE.Vector3()
const _fireFwd = new THREE.Vector3()
const _fireMuzzle = new THREE.Vector3()
export const FIXO_PISTOL_WEAPON_ID = 'fixo_pistol'

/**
 * @param {string|null} weaponTypeFilter 'laser' | 'missile' | null (all)
 * @param {{ kind: string, id?: string }|null} targetRef NPC aim target
 * @param {number[]|null} aimWorld world point to aim each muzzle at (player reticle)
 */
export function fireProjectile(
  gameState,
  shooter,
  shooterShipClass,
  ownerId,
  onFire,
  weaponTypeFilter = null,
  targetRef = null,
  aimWorld = null,
  muzzleWorld = null
) {
  shooter.hardpointCooldowns ??= {}
  shooter.equippedWeapons ??= {}

  // Reuse scratch vectors — fire is called every held-frame / multi-hardpoint.
  _fireQuat.fromArray(shooter.quaternion).normalize()
  _firePos.fromArray(shooter.position)
  _fireFwd.copy(_localForward).applyQuaternion(_fireQuat)
  if (_fireFwd.lengthSq() < 1e-8) _fireFwd.set(0, 0, 1)
  else _fireFwd.normalize()

  if (Array.isArray(aimWorld) && aimWorld.length === 3) {
    _aimPoint.fromArray(aimWorld)
  } else {
    _aimPoint.copy(_firePos).addScaledVector(_fireFwd, DEFAULT_AIM_DISTANCE)
  }

  // Player: include accessory-granted mounts; NPCs use class hardpoints only.
  const hardpoints =
    ownerId === 'player'
      ? effectiveHardpoints(shooter, shooterShipClass)
      : shooterShipClass?.hardpoints
  if (!hardpoints?.length) return

  // Stable indices among all mounts of each type (not just those ready this frame).
  const laserHps = hardpoints.filter((h) => h.type !== 'missile')
  const missileHps = hardpoints.filter((h) => h.type === 'missile')

  // Skill mult once per fire call (not per hardpoint).
  let gunneryMult = 1
  let launchersMult = 1
  if (ownerId === 'player') {
    try {
      const b = playerSkillBonuses(gameState)
      gunneryMult = b.gunneryMult
      launchersMult = b.launchersMult
    } catch {
      /* */
    }
  }

  // One fire SFX per mount type per call (multi-turret used to stack N samples).
  let firedLaserSfx = false
  let firedMissileSfx = false

  for (const hp of hardpoints) {
    const mountType = hp.type === 'missile' ? 'missile' : 'laser'
    if (weaponTypeFilter && mountType !== weaponTypeFilter) continue
    const alienHull = !!shooterShipClass?.alien
    const baseIds = alienHull ? ALIEN_BASE_WEAPON_ID : BASE_WEAPON_ID
    // Accessory hardpoints never get a free default — must equip a weapon.
    let weaponId = shooter.equippedWeapons?.[hp.id]
    if (!weaponId) {
      if (hp.accessory) continue
      weaponId = baseIds[mountType]
    }
    let weapon
    try {
      weapon = getWeapon(weaponId)
    } catch {
      if (hp.accessory) continue
      weaponId = baseIds[mountType]
      weapon = getWeapon(weaponId)
    }
    const readyAt = shooter.hardpointCooldowns[hp.id] ?? -Infinity
    if (gameState.simTime < readyAt) continue
    shooter.hardpointCooldowns[hp.id] = gameState.simTime + weapon.cooldownS

    const hpPos = hp.position ?? [0, 0, 0]
    let localX = Number(hpPos[0]) || 0
    let localY = Number(hpPos[1]) || 0
    let localZ = Number(hpPos[2]) || 0

    // Player lasers always fly pure ship +Z (Tab-lock does not bend the beam).
    // Single turret: centerline muzzle for chase-cam readability.
    // Multi turret: keep hardpoint lateral offsets (with a minimum fan) so
    // LMB visibly fires every laser. Missiles use hardpoint offsets similarly.
    if (ownerId === 'player' && mountType === 'laser') {
      localZ = Math.max(localZ, 7)
      if (laserHps.length <= 1) {
        localX = 0
        localY = 0
        localZ = Math.max(localZ, 8)
      } else {
        const idx = Math.max(0, laserHps.findIndex((h) => h.id === hp.id))
        // Ensure wing pairs (and stacked gen hardpoints) separate slightly.
        const minLat = 0.65
        if (Math.hypot(localX, localY) < minLat) {
          // Fan left/right (±) then a bit of Y for 3+ guns.
          const side = idx % 2 === 0 ? -1 : 1
          const rank = Math.floor(idx / 2)
          localX = side * (minLat + rank * 0.35)
          localY = (rank % 2 === 1 ? 0.25 : 0) + (idx >= 2 ? 0.12 : 0)
        } else {
          // Emphasize existing wing mounts a little so bolts don't hide in the hull.
          localX *= 1.12
          localY *= 1.05
        }
      }
    } else if (ownerId === 'player' && mountType === 'missile') {
      localZ = Math.max(localZ, 5)
      if (missileHps.length > 1) {
        const idx = Math.max(0, missileHps.findIndex((h) => h.id === hp.id))
        const minLat = 0.55
        if (Math.hypot(localX, localY) < minLat) {
          const side = idx % 2 === 0 ? -1 : 1
          const rank = Math.floor(idx / 2)
          localX = side * (minLat + rank * 0.4)
          localY = rank * 0.2
        } else {
          localX *= 1.1
        }
      }
    }

    if (Array.isArray(muzzleWorld) && muzzleWorld.length === 3) {
      // Fired from a turret: the barrel is the origin, wherever it is trained.
      // Multi-mount fans still spread, but around the muzzle rather than the
      // hull centreline.
      _fireMuzzle.set(localX * 0.35, localY * 0.35, 0).applyQuaternion(_fireQuat)
      _fireMuzzle.x += muzzleWorld[0]
      _fireMuzzle.y += muzzleWorld[1]
      _fireMuzzle.z += muzzleWorld[2]
    } else {
      _fireMuzzle.set(localX, localY, localZ).applyQuaternion(_fireQuat).add(_firePos)
    }
    // Everything now aims at the point it was given. The old special case that
    // forced player guns down the hull's +Z existed because they were welded to
    // it; with a turret that would fire straight ahead no matter where the
    // player had laid the mount.
    _projDir.copy(_aimPoint).sub(_fireMuzzle)
    if (_projDir.lengthSq() < 1e-8) _projDir.copy(_fireFwd)
    else _projDir.normalize()
    _projQuat.setFromUnitVectors(_localForward, _projDir)

    const dmg =
      weapon.damage * (ownerId === 'player' ? (mountType === 'missile' ? launchersMult : gunneryMult) : 1)

    gameState.projectiles.push({
      id: `proj-${projectileCounter++}`,
      ownerId,
      targetRef,
      weaponType: mountType,
      weaponId,
      position: [_fireMuzzle.x, _fireMuzzle.y, _fireMuzzle.z],
      quaternion: [_projQuat.x, _projQuat.y, _projQuat.z, _projQuat.w],
      velocity: [
        _projDir.x * weapon.speed,
        _projDir.y * weapon.speed,
        _projDir.z * weapon.speed
      ],
      damage: dmg,
      ttl: weapon.ttl
    })
    // One SFX per weapon category so multi-turret volleys don't N× audio work.
    if (mountType === 'laser') {
      if (!firedLaserSfx) {
        firedLaserSfx = true
        try {
          onFire?.(weaponId, mountType)
        } catch (err) {
          console.error('onFire callback failed:', err)
        }
      }
    } else if (!firedMissileSfx) {
      firedMissileSfx = true
      try {
        onFire?.(weaponId, mountType)
      } catch (err) {
        console.error('onFire callback failed:', err)
      }
    }
  }
}

/** Fire the player's handheld Fixo Pistol while on foot. */
export function fireOnFootProjectile(gameState, onFoot, origin, direction, onFire) {
  if (!gameState?.projectiles || !onFoot || !Array.isArray(origin) || !Array.isArray(direction)) return false
  const weapon = getWeapon(FIXO_PISTOL_WEAPON_ID)
  const now = Number(gameState.simTime) || 0
  if (now < (Number(onFoot.fixoPistolReadyAt) || -Infinity)) return false

  _fireMuzzle.fromArray(origin)
  _projDir.fromArray(direction)
  if (_projDir.lengthSq() < 1e-8) return false
  _projDir.normalize()
  _projQuat.setFromUnitVectors(_localForward, _projDir)
  onFoot.fixoPistolReadyAt = now + weapon.cooldownS
  gameState.projectiles.push({
    id: `proj-${projectileCounter++}`,
    ownerId: 'player',
    onFoot: true,
    weaponType: 'laser',
    weaponId: weapon.id,
    position: [_fireMuzzle.x, _fireMuzzle.y, _fireMuzzle.z],
    quaternion: [_projQuat.x, _projQuat.y, _projQuat.z, _projQuat.w],
    velocity: [_projDir.x * weapon.speed, _projDir.y * weapon.speed, _projDir.z * weapon.speed],
    damage: weapon.damage,
    ttl: weapon.ttl
  })
  try {
    onFire?.(weapon.id, 'laser')
  } catch (err) {
    console.error('on-foot fire callback failed:', err)
  }
  return true
}

/**
 * Horizontal bump radius for a hull.
 *
 * LOA/2 was far too fat — boats ghost-bumped with a clear lane of water between
 * them. Use midships half-beam (plus a short length factor) so side-swipes match
 * the visible beam while bow-on contacts still register.
 */
function hullRadiusParts(shipClass) {
  const hull = shipClass?.hull
  const length = Math.max(6, Number(hull?.length) || 16)
  const widths = hull?.stationWidths
  let halfBeam = 0
  if (widths?.length) {
    for (const w of widths) {
      const n = Number(w)
      if (Number.isFinite(n) && n > halfBeam) halfBeam = n
    }
  }
  if (halfBeam < 0.4) halfBeam = length * 0.07
  return { length, halfBeam }
}

export function getShipCollisionRadius(shipClass) {
  const { length, halfBeam } = hullRadiusParts(shipClass)
  // Combat and hull-to-hull hit envelopes stay slightly generous so enlarged
  // ships do not visually overlap before a collision or projectile hit.
  const r = halfBeam * 1.25 + length * 0.1
  return Math.max(2.4, Math.min(length * 0.32, r))
}

/** Tighter island shell so the visible hull can lie right against a beach. */
export function getShorelineCollisionRadius(shipClass) {
  const { length, halfBeam } = hullRadiusParts(shipClass)
  const r = halfBeam * 1.05 + length * 0.04
  return Math.max(2.4, Math.min(length * 0.3, r))
}

// Scratch vectors — closestDistanceToSegment used to clone 3–4 Vector3s per
// ship/projectile test (GC hitch on first combat volley in busy systems).
const _seg = new THREE.Vector3()
const _toStart = new THREE.Vector3()
const _closest = new THREE.Vector3()
const _projPrev = new THREE.Vector3()
const _projNext = new THREE.Vector3()
const _projVel = new THREE.Vector3()
const _targetPos = new THREE.Vector3()
const _inbound = new THREE.Vector3()

function closestDistanceToSegment(point, segStart, segEnd) {
  _seg.subVectors(segEnd, segStart)
  const len2 = _seg.lengthSq()
  if (len2 === 0) return point.distanceTo(segStart)
  _toStart.subVectors(point, segStart)
  const t = Math.max(0, Math.min(1, _toStart.dot(_seg) / len2))
  _closest.copy(segStart).addScaledVector(_seg, t)
  return point.distanceTo(_closest)
}

// Player lasers that no longer track current ship +Z (fired during a turn) are
// dropped so a stationary burst isn't painted over by the old spray for ~1s.


// Scratch for NPC turret lay — updateNpcAI runs for every contact every frame.
const _npcMuzzle = new THREE.Vector3()
const _npcAim = new THREE.Vector3()

// Debris field collision size (world units) — large enough to hit when aimed.
const WRECK_HIT_RADIUS = 22
// ~few laser hits / one missile to scrap a wreck instead of looting.
const WRECK_DEFAULT_HULL = 90

export function updateProjectiles(gameState, dt, onHit, onWorldImpact) {
  const alive = []
  // Only the player can salvage wrecks, and only if galaxy/currentSystemId are present
  // (test fixtures often omit them — no field check happens in that case).
  const currentSystem = gameState.galaxy ? getSystem(gameState.galaxy, gameState.player.currentSystemId) : null
  const npcs = gameState.npcs
  // Wreck fields always take hits when aimed — hostiles nearby must not freeze salvage.

  for (const proj of gameState.projectiles) {
    proj.ttl -= dt
    if (proj.ttl <= 0) continue

    _projPrev.fromArray(proj.position)
    _projVel.fromArray(proj.velocity)
    _projNext.copy(_projPrev).addScaledVector(_projVel, dt)
    proj.position[0] = _projNext.x
    proj.position[1] = _projNext.y
    proj.position[2] = _projNext.z

    let hit = false
    if (proj.ownerId === 'player') {
      for (const target of npcs) {
        if (target.destroyed) continue
        // Cache hit radius on the NPC (class stats are fixed).
        if (target._hitRadius == null) {
          try {
            target._hitRadius =
              HIT_RADIUS + getShipCollisionRadius(getShipClass(target.shipClassId))
          } catch {
            target._hitRadius = HIT_RADIUS + 8
          }
        }
        _targetPos.fromArray(target.position)
        const dist = closestDistanceToSegment(_targetPos, _projPrev, _projNext)
        if (dist >= target._hitRadius) continue
        applyDamage(target, proj.damage, gameState.simTime, { player: false })
        markPlayerCombatEngagement(gameState, proj, target, false)
        // Firing on honest traffic inside Haven Reach's patrol area ends the
        // peace there permanently — the harbour remembers.
        if (target.faction === 'trader' && inHomeWaters(gameState.player.ship.position)) {
          gameState.flags ??= {}
          gameState.flags.startingSystemPeaceBroken = true
        }
        if (target.destroyed) {
          gameState.wrecks.push(
            spawnWreckWithSkills(
              proj.position.slice(),
              gameState.simTime,
              Math.random,
              target.shipClassId,
              gameState
            )
          )
          if (target.faction === 'pirate') {
            applyLawBonusForPirateKill(gameState)
          }
          applyShipBounty(gameState, target, getSystemSecurity(currentSystem), Math.random)
        }
        _inbound.subVectors(_projPrev, _projNext)
        onHit?.({
          position: proj.position.slice(),
          weaponType: proj.weaponType,
          weaponId: proj.weaponId,
          destroyed: !!target.destroyed,
          hitPlayer: false,
          ownerId: 'player',
          inboundDir: [_inbound.x, _inbound.y, _inbound.z],
          targetNpcId: target.id ?? null
        })
        hit = true
        break
      }
    } else if (proj.targetRef?.kind !== 'npc' && gameState.player.onFoot?.active) {
      // Ashore, a shot aimed "at the player" means the actual body, not the
      // abandoned hull — human-scale hit radius, straight to onFoot.health
      // (no armour/hull to absorb it the way a ship has). Full weapon
      // damage, unscaled: a boat's gun hitting a person on a beach is
      // supposed to be dangerous, not a ship-combat tickle.
      const onFoot = gameState.player.onFoot
      _targetPos.fromArray(onFoot.position)
      if (closestDistanceToSegment(_targetPos, _projPrev, _projNext) < ON_FOOT_HIT_RADIUS) {
        onFoot.health = Math.max(0, Number(onFoot.health) - proj.damage)
        markPlayerCombatEngagement(gameState, proj, gameState.player.ship, true)
        _inbound.subVectors(_projPrev, _projNext)
        onHit?.({
          position: proj.position.slice(),
          weaponType: proj.weaponType,
          weaponId: proj.weaponId,
          destroyed: false,
          hitPlayer: true,
          onFootHit: true,
          ownerId: proj.ownerId ?? null,
          inboundDir: [_inbound.x, _inbound.y, _inbound.z],
          targetNpcId: null
        })
        hit = true
      }
    } else {
      // NPC projectile — hit player or specific NPC target. Shots already in
      // the air when the player ties up pass harmlessly.
      const targets =
        proj.targetRef?.kind === 'npc'
          ? npcs.filter((n) => n.id === proj.targetRef.id)
          : gameState.player.dockedBodyId
            ? []
            : [gameState.player.ship]
      for (const target of targets) {
        if (target.destroyed) continue
        const targetShipClass = getShipClass(target.shipClassId ?? target.classId)
        _targetPos.fromArray(target.position)
        const hitDistance = HIT_RADIUS + getShipCollisionRadius(targetShipClass)
        if (closestDistanceToSegment(_targetPos, _projPrev, _projNext) >= hitDistance) continue
        const isPlayer = target === gameState.player.ship
        applyDamage(target, proj.damage, gameState.simTime, { player: isPlayer })
        markPlayerCombatEngagement(gameState, proj, target, isPlayer)
        _inbound.subVectors(_projPrev, _projNext)
        onHit?.({
          position: proj.position.slice(),
          weaponType: proj.weaponType,
          weaponId: proj.weaponId,
          destroyed: !!target.destroyed,
          hitPlayer: isPlayer,
          ownerId: proj.ownerId ?? null,
          inboundDir: [_inbound.x, _inbound.y, _inbound.z],
          targetNpcId: !isPlayer && target.id ? target.id : null
        })
        hit = true
        break
      }
    }

    // Enemy shots can destroy deployed *player* combat drones only (NPCs have none).
    if (!hit && proj.ownerId !== 'player') {
      const drones = gameState.player?.ship?.drones ?? []
      for (const drone of drones) {
        if (!drone.deployed || drone.destroyed || drone.hull <= 0) continue
        _targetPos.fromArray(drone.position)
        if (closestDistanceToSegment(_targetPos, _projPrev, _projNext) < HIT_RADIUS + 4) {
          const destroyed = damageDrone(drone, proj.damage, gameState.simTime)
          // Hitting a player drone counts as engaging the player.
          if (proj.ownerId && proj.ownerId !== 'player') {
            gameState.player.combatEngagedNpcIds ??= {}
            gameState.player.combatEngagedNpcIds[proj.ownerId] = true
          }
          _inbound.subVectors(_projPrev, _projNext)
          onHit?.({
            position: proj.position.slice(),
            weaponType: proj.weaponType,
            weaponId: proj.weaponId,
            destroyed,
            hitPlayer: false,
            hitDrone: true,
            droneId: drone.id,
            inboundDir: [_inbound.x, _inbound.y, _inbound.z]
          })
          hit = true
          break
        }
      }
    }

    // Hit-tests individual hulks (matching per-hulk Tab-targeting in main.js).
    // Salvage still chips mass with a full hold and with hostiles nearby.
    if (!hit && proj.ownerId === 'player' && currentSystem) {
      fieldLoop: for (const body of currentSystem.bodies) {
        if (body.kind !== 'wreckField') continue
        // Skip whole field if projectile is nowhere near its scatter volume.
        const fr = (body.radius ?? 0) + 120
        const fdx = body.position[0] - _projNext.x
        const fdy = body.position[1] - _projNext.y
        const fdz = body.position[2] - _projNext.z
        if (fdx * fdx + fdy * fdy + fdz * fdz > fr * fr) continue
        const rocks = getAsteroidRocks(body)
        for (let i = 0; i < rocks.length; i++) {
          if (!isRockAlive(gameState, body.id, i)) continue
          const rock = rocks[i]
          _targetPos.set(
            body.position[0] + rock.position[0],
            body.position[1] + rock.position[1],
            body.position[2] + rock.position[2]
          )
          const hitR = rockCollisionRadius(rock) + MINE_HIT_PAD
          if (closestDistanceToSegment(_targetPos, _projPrev, _projNext) < hitR) {
            const shipClass = getShipClass(gameState.player.ship.classId)
            // Stronger guns chip more ore (pulse laser 1, rocket pod 2, …).
            const yieldAmt = mineYieldForWeapon(proj.weaponId ?? proj.weaponType)
            const mined = mineRock(gameState, shipClass, body, body.id, i, yieldAmt, body.oreOverride)
            onHit?.({
              position: proj.position.slice(),
              rockPosition: [_targetPos.x, _targetPos.y, _targetPos.z],
              weaponType: proj.weaponType,
              weaponId: proj.weaponId,
              destroyed: !!mined.destroyed,
              mined,
              fieldId: body.id,
              rockIndex: i
            })
            hit = true
            break fieldLoop
          }
        }
      }
    }

    // Player can destroy wrecks instead of looting (F) — scrap is lost.
    if (!hit && proj.ownerId === 'player' && gameState.wrecks?.length) {
      for (let wi = 0; wi < gameState.wrecks.length; wi++) {
        const wreck = gameState.wrecks[wi]
        _targetPos.fromArray(wreck.position)
        if (closestDistanceToSegment(_targetPos, _projPrev, _projNext) >= WRECK_HIT_RADIUS) continue
        wreck.hull = (wreck.hull ?? WRECK_DEFAULT_HULL) - (proj.damage ?? 10)
        const destroyed = wreck.hull <= 0
        if (destroyed) {
          gameState.wrecks.splice(wi, 1)
        }
        onHit?.({
          position: proj.position.slice(),
          weaponType: proj.weaponType,
          weaponId: proj.weaponId,
          destroyed,
          hitWreck: true,
          wreckId: wreck.id
        })
        hit = true
        break
      }
    }

    if (!hit && typeof onWorldImpact === 'function') {
      const impact = onWorldImpact({
        projectile: proj,
        from: _projPrev.toArray(),
        to: _projNext.toArray()
      })
      if (impact) {
        const impactPosition = Array.isArray(impact)
          ? impact
          : Array.isArray(impact.position) ? impact.position : proj.position.slice()
        onHit?.({
          position: impactPosition,
          weaponType: proj.weaponType,
          weaponId: proj.weaponId,
          onFootImpact: !!proj.onFoot,
          worldImpact: true,
          waterImpact: !!impact.waterImpact,
          silentImpact: !!proj.gullHit,
          ownerId: proj.ownerId
        })
        hit = true
      }
    }

    if (!hit) alive.push(proj)
  }
  gameState.projectiles = alive
}

const _steerOut = new THREE.Vector3()

/**
 * Come round toward a point on the water. Heading only, rate-limited: a hull
 * has a maximum rate of turn, and it aims its bow rather than tipping its nose
 * up at something riding a crest. `npc.heading` is the authoritative attitude
 * — pitch and roll come from the sea (see applySeaAttitude).
 *
 * Returns the flat forward vector, so thrust can never drive a boat upward.
 */
function faceToward(npc, fromPos, toPos, turnRate, dt) {
  let heading = headingOf(npc)
  const dx = toPos.x - fromPos.x
  const dz = toPos.z - fromPos.z
  if (dx * dx + dz * dz > 1e-8) {
    const target = Math.atan2(dx, dz)
    // Shortest way round, so a boat never turns 350° to make 10°.
    const delta = Math.atan2(Math.sin(target - heading), Math.cos(target - heading))
    const maxTurn = turnRate * dt
    heading += Math.max(-maxTurn, Math.min(maxTurn, delta))
    npc.heading = heading
  }
  return _steerOut.set(Math.sin(heading), 0, Math.cos(heading))
}

// A pirate/alien encounter turns three-way the moment an alien is present:
// aliens are hostile to both the player and pirates, and pirates call a
// truce with the player to fight the aliens instead (main.js detects when
// this ends — no more live aliens — to have the survivors thank the player
// and leave the system).
export function truceActive(gameState) {
  return gameState.npcs.some((n) => !n.destroyed && n.faction === 'alien')
}

/**
 * Per-frame combat context — built once before the NPC AI loop so we do not
 * re-walk the galaxy / re-roll law checks for every ship (was a combat hitch).
 */
export function prepareCombatFrame(gameState) {
  const system = gameState.galaxy
    ? getSystem(gameState.galaxy, gameState.player.currentSystemId)
    : null
  const truce = truceActive(gameState)
  // Pre-index live hostiles by faction for O(1) opponent lists.
  const pirates = []
  const aliens = []
  const police = []
  for (const n of gameState.npcs) {
    if (n.destroyed) continue
    if (n.faction === 'pirate') pirates.push(n)
    else if (n.faction === 'alien') aliens.push(n)
    else if (n.faction === 'police') police.push(n)
  }
  const onFootActive = !!gameState.player.onFoot?.active
  return {
    system,
    bodies: system?.bodies ?? [],
    // Ashore, anyone allowed to target the player at all (see opponentsFor)
    // aims at the actual body, not the abandoned hull sitting by the shore.
    playerPos: onFootActive ? gameState.player.onFoot.position : gameState.player.ship.position,
    // Moored alongside: nobody starts anything with a boat tied up under a
    // harbour's guns, and nothing can reach it if they try.
    playerMoored: !!gameState.player.dockedBodyId,
    playerOnFoot: onFootActive,
    truce,
    policeSos: policeHostileToPlayer(gameState, system),
    civSos: civiliansHostileToPlayer(gameState, system),
    pirates,
    aliens,
    police,
    engagedMap: gameState.player.combatEngagedNpcIds ?? {}
  }
}

// The nearest hostile candidate for this NPC to engage, as { id, position }
// (id is 'player' or another NPC's id) — or null if this faction never
// fights (traders). Kept separate from updateNpcAI so both the AI loop and
// tests/future callers can reason about "who is X currently at war with"
// without re-deriving it.
function opponentsFor(npc, gameState, frame = null) {
  const ctx = frame ?? prepareCombatFrame(gameState)
  // A moored boat is not a target. Without this, raiders queue up off the quay
  // and open fire on something that cannot answer or leave.
  if (ctx.playerMoored) return []
  const opponents = opponentsForShip(npc, ctx)
  if (!ctx.playerOnFoot) return opponents
  // Ashore, the player's own ship is a protected placeholder — nobody goes
  // looking for a fight with someone who isn't there. The one exception: an
  // NPC the player just shot at (hostileToPlayer, set by
  // markPlayerCombatEngagement) fires back if it gets a shot — everyone
  // else leaves the player alone. And even a hostile NPC drops the player
  // the instant terrain blocks the shot (hasLineOfSightToOnFootPlayer, main
  // process only — no scene access here); this reuses the same "opponent
  // vanished" disengage path range loss already goes through, so it picks
  // the target back up the moment sight is clear again with no extra state.
  if (
    !npc.hostileToPlayer ||
    (ctx.hasLineOfSightToOnFootPlayer && !ctx.hasLineOfSightToOnFootPlayer(npc.position))
  ) {
    return opponents.filter((o) => o.id !== 'player')
  }
  return opponents
}

/** The pre-on-foot-filter opponent list, by faction. See opponentsFor. */
function opponentsForShip(npc, ctx) {
  const playerPos = ctx.playerPos
  const engaged = !!ctx.engagedMap[npc.id]

  if (npc.faction === 'alien') {
    const opponents = [{ id: 'player', position: playerPos }]
    for (const other of ctx.pirates) {
      if (other.id !== npc.id) opponents.push({ id: other.id, position: other.position })
    }
    for (const other of ctx.police) {
      opponents.push({ id: other.id, position: other.position })
    }
    return opponents
  }
  if (npc.faction === 'pirate') {
    if (ctx.truce) {
      return ctx.aliens.map((n) => ({ id: n.id, position: n.position }))
    }
    const opponents = [{ id: 'player', position: playerPos }]
    for (const other of ctx.police) {
      opponents.push({ id: other.id, position: other.position })
    }
    return opponents
  }
  if (npc.faction === 'police') {
    const opponents = []
    for (const other of ctx.pirates) {
      opponents.push({ id: other.id, position: other.position })
    }
    for (const other of ctx.aliens) {
      opponents.push({ id: other.id, position: other.position })
    }
    if (ctx.policeSos || engaged) {
      opponents.push({ id: 'player', position: playerPos })
    }
    return opponents
  }
  // Traders / civilians: only fight when engaged or system-wide outlaw SOS.
  if (npc.faction === 'trader' || !npc.faction) {
    if (engaged || ctx.civSos) {
      return [{ id: 'player', position: playerPos }]
    }
  }
  return []
}

export function updateNpcAI(npc, gameState, dt, onFire, onPlayerHit, combatFrame = null) {
  if (npc.destroyed) return
  // The player's own ship is a protected placeholder while the captain is
  // ashore — handled by opponentsFor() below (ctx.playerOnFoot), the same
  // way a moored boat is excluded, so an NPC that was hunting the player
  // simply finds no opponent. Traffic itself must keep moving: this used to
  // additionally zero every NPC's velocity here, which froze the entire sea,
  // not just the player's boat.
  const npcShipClass = getShipClass(npc.shipClassId)

  const npcPos = new THREE.Vector3().fromArray(npc.position)
  const playerPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const hullFraction = npc.hull / npcShipClass.stats.hull
  const stats = npcShipClass.stats
  const velocity = new THREE.Vector3().fromArray(npc.velocity)

  let opponent = null
  let distance = Infinity
  for (const candidate of opponentsFor(npc, gameState, combatFrame)) {
    const d = npcPos.distanceTo(new THREE.Vector3().fromArray(candidate.position))
    if (d < distance) {
      distance = d
      opponent = candidate
    }
  }

  if (hullFraction < FLEE_HULL_FRACTION) {
    // A one-time decision the moment it first drops this low — not re-rolled
    // every frame while it stays there (see RAM_CHANCE above).
    if (npc.aiState !== 'flee' && npc.aiState !== 'ram') {
      if (Math.random() < RAM_CHANCE) {
        npc.aiState = 'ram'
        npc.ramQuote = RAM_QUOTES[Math.floor(Math.random() * RAM_QUOTES.length)]
      } else {
        npc.aiState = 'flee'
      }
    }
  } else if (
    opponent &&
    distance < (npc.anomalySiteId != null ? ANOMALY_GUARD_ATTACK_RANGE : ATTACK_RANGE) &&
    // Alien incursion waves spawn already-hostile but hold fire briefly (see
    // main.js's spawnAlienIncursionWave call sites) rather than opening up
    // the instant the wave appears.
    !(npc.combatDelayUntil != null && gameState.simTime < npc.combatDelayUntil)
  ) {
    npc.aiState = 'attack'
  }
  else if (
    npc.aiState === 'attack' &&
    distance >= (npc.anomalySiteId != null ? ANOMALY_GUARD_DISENGAGE_RANGE : DISENGAGE_RANGE)
  ) {
    npc.aiState = 'patrol'
  }

  let forward
  if (npc.aiState === 'attack' && opponent) {
    const opponentPos = new THREE.Vector3().fromArray(opponent.position)
    forward = faceToward(npc, npcPos, opponentPos, stats.turnRate, dt)
    // Flat bearing to the target. Keeping the vertical component would make the
    // firing cone below flicker every time either boat rode a crest.
    const toOpponent = opponentPos.clone().sub(npcPos).setY(0).normalize()

    // Coin-flipped once per NPC so only some attackers orbit — the rest keep
    // closing head-on as before, for variety.
    npc.isOrbiter ??= Math.random() < 0.5
    npc.orbitDir ??= Math.random() < 0.5 ? 1 : -1
    const recentlyHit = gameState.simTime - (npc.lastHitAt ?? -Infinity) < EVADE_WINDOW_S

    if (recentlyHit) {
      // Took a hit — break off and open the range for a moment rather than
      // pressing in blindly. Still faces the opponent (see forward above),
      // so it can keep firing back while it retreats.
      velocity.addScaledVector(forward, -stats.accel * dt)
    } else if (npc.isOrbiter && distance < ORBIT_RANGE) {
      // Circle rather than close head-on: thrust mostly tangential to the
      // opponent (facing still tracks them, so guns stay on target), with a
      // small radial nudge to roughly hold ORBIT_RANGE.
      const tangent = new THREE.Vector3(-toOpponent.z, 0, toOpponent.x).multiplyScalar(npc.orbitDir)
      const radial = toOpponent.clone().multiplyScalar(distance < ORBIT_RANGE * 0.7 ? -1 : 0.4)
      velocity.addScaledVector(tangent.multiplyScalar(0.85).add(radial).normalize(), stats.accel * dt)
    } else {
      velocity.addScaledVector(forward, stats.accel * dt)
    }

    // Keep the mount trained whenever there is someone to train it on, not
    // only on the frames a round goes off — otherwise the barrel snaps to the
    // target at the instant of firing and sits dead between rounds.
    aimTurretAt(npc, opponent.position)

    if (distance < FIRE_RANGE && forward.dot(toOpponent) > FIRE_CONE_DOT) {
      const targetRef = opponent.id === 'player' ? { kind: 'player' } : { kind: 'npc', id: opponent.id }
      // Fire from the barrel. The hull still has to have them roughly ahead
      // (FIRE_CONE_DOT above) — the turret gives fine lay within that arc, not
      // a 360° broadside.
      turretMuzzleWorld(npc, npcShipClass, _npcMuzzle)
      turretAimPoint(npc, npcShipClass, _npcAim)
      fireProjectile(
        gameState,
        npc,
        npcShipClass,
        npc.id,
        onFire,
        null,
        targetRef,
        _npcAim.toArray(),
        _npcMuzzle.toArray()
      )
    }
  } else if (npc.aiState === 'ram') {
    if (gameState.player?.onFoot?.active) {
      // A committed ram run bypasses opponentsFor by design (see below), so
      // it does not get the free pass the rest of the AI gets from the
      // player going ashore — it would otherwise still cross the finish
      // line and damage a boat that is supposed to be a protected
      // placeholder. Abort the run rather than let it complete.
      npc.aiState = 'patrol'
    } else {
      // A suicide run is aimed squarely at the player regardless of whatever
      // opponentsFor would otherwise pick (e.g. an alien, if this pirate was
      // truced) — turns and accelerates harder than a normal attack run for a
      // dramatic charge, and destroys itself on impact alongside the damage.
      forward = faceToward(npc, npcPos, playerPos, stats.turnRate * 1.6, dt)
      velocity.addScaledVector(forward, stats.accel * 1.6 * dt)
      const hitDistance = getShipCollisionRadius(npcShipClass) + getShipCollisionRadius(getShipClass(gameState.player.ship.classId))
      if (!gameState.player.dockedBodyId && npcPos.distanceTo(playerPos) < hitDistance) {
        applyDamage(gameState.player.ship, RAM_DAMAGE, gameState.simTime, { player: true })
        npc.hull = 0
        npc.destroyed = true
        onPlayerHit?.(npc.position)
      }
    }
  } else if (npc.aiState === 'flee') {
    const fleeFromPos = opponent ? new THREE.Vector3().fromArray(opponent.position) : playerPos
    // Run on the surface — flattened, or a boat being shot at from a wave
    // trough would try to escape upward.
    const away = npcPos.clone().sub(fleeFromPos).setY(0)
    if (away.lengthSq() < 1e-8) away.set(0, 0, 1)
    const fleeTarget = npcPos.clone().add(away.normalize())
    forward = faceToward(npc, npcPos, fleeTarget, stats.turnRate, dt)
    velocity.addScaledVector(forward, stats.accel * dt)
  } else {
    // Harbour patrols: circle outside the moles; everything else wanders.
    // Every waypoint is on the water — the sea decides the height, not the AI.
    if (!npc.patrolTarget || npcPos.distanceTo(new THREE.Vector3().fromArray(npc.patrolTarget)) < 20) {
      if (npc.patrolAnchor && Array.isArray(npc.patrolAnchor)) {
        const minR = Math.max(80, npc.patrolMinRadius ?? npc.patrolRadius ?? 280)
        const maxR = Math.max(minR + 40, npc.patrolMaxRadius ?? minR + 200)
        const a = Math.random() * Math.PI * 2
        const dist = minR + Math.random() * (maxR - minR)
        let target = [
          npc.patrolAnchor[0] + Math.cos(a) * dist,
          0,
          npc.patrolAnchor[2] + Math.sin(a) * dist
        ]
        // Never pick a patrol waypoint inside solid geometry.
        if (combatFrame?.bodies) {
          target = clearPositionOfBodies(
            target,
            combatFrame.bodies,
            NPC_SPAWN_SHIP_RADIUS,
            NPC_FLIGHT_CLEARANCE
          )
        }
        npc.patrolTarget = target
      } else {
        let target = npcPos
          .clone()
          .add(new THREE.Vector3((Math.random() - 0.5) * 200, 0, (Math.random() - 0.5) * 200))
          .toArray()
        target[1] = 0
        if (combatFrame?.bodies) {
          target = clearPositionOfBodies(
            target,
            combatFrame.bodies,
            NPC_SPAWN_SHIP_RADIUS,
            NPC_FLIGHT_CLEARANCE
          )
        }
        npc.patrolTarget = target
      }
    }
    forward = faceToward(npc, npcPos, new THREE.Vector3().fromArray(npc.patrolTarget), stats.turnRate * 0.5, dt)
    velocity.addScaledVector(forward, stats.accel * 0.3 * dt)
  }

  velocity.multiplyScalar(Math.pow(0.35, dt))
  // Nothing on the water makes way vertically. Thrust is already flat (see
  // faceToward), but evade/orbit nudges and the push-out below can still leave
  // a vertical component — drop it before it integrates into altitude.
  velocity.y = 0
  if (velocity.length() > stats.speed) velocity.setLength(stats.speed)
  let position = npcPos.clone().addScaledVector(velocity, dt).toArray()

  // Keep NPCs outside solid shells — fast overlap check first (skip clear cost).
  if (
    combatFrame?.bodies &&
    positionOverlapsBodies(position, combatFrame.bodies, NPC_SPAWN_SHIP_RADIUS, NPC_FLIGHT_CLEARANCE)
  ) {
    const before = position
    position = clearPositionOfBodies(
      position,
      combatFrame.bodies,
      NPC_SPAWN_SHIP_RADIUS,
      NPC_FLIGHT_CLEARANCE
    )
    const pushX = position[0] - before[0]
    const pushY = position[1] - before[1]
    const pushZ = position[2] - before[2]
    if (pushX * pushX + pushY * pushY + pushZ * pushZ > 1e-6) {
      const v = velocity
      const inward = v.x * -pushX + v.y * -pushY + v.z * -pushZ
      if (inward > 0) {
        const plen = Math.hypot(pushX, pushY, pushZ) || 1
        v.x += (pushX / plen) * inward
        v.y += (pushY / plen) * inward
        v.z += (pushZ / plen) * inward
      }
    }
  }

  npc.position = position
  npc.velocity = velocity.toArray()
  // Every mover on the sea goes through the same clamp as the player, so an
  // NPC can never drift above or below the surface it is supposed to be on.
  snapToSea(npc, gameState.simTime)
  applySeaAttitude(npc, headingOf(npc), gameState.simTime, 0, 0, dt)
}

const _combatFlagPlayer = new THREE.Vector3()
const _combatFlagNpc = new THREE.Vector3()

export function updateCombatFlag(gameState, combatFrame = null) {
  const ctx = combatFrame ?? prepareCombatFrame(gameState)
  _combatFlagPlayer.fromArray(ctx.playerPos)
  // Aliens always hostile; pirates unless truced; police when wanted/engaged;
  // civilians when outlaw SOS or engaged.
  const attackRangeSq = ATTACK_RANGE * ATTACK_RANGE
  let hostileNearby = false
  for (const n of gameState.npcs) {
    if (n.destroyed) continue
    let isHostile = !!n.hostileToPlayer
    if (!isHostile) {
      if (n.faction === 'alien') isHostile = true
      else if (n.faction === 'pirate' && !ctx.truce) isHostile = true
      else if (n.faction === 'police' && (ctx.policeSos || ctx.engagedMap[n.id])) isHostile = true
      else if ((n.faction === 'trader' || !n.faction) && (ctx.civSos || ctx.engagedMap[n.id])) {
        isHostile = true
      }
    }
    if (!isHostile) continue
    _combatFlagNpc.fromArray(n.position)
    if (_combatFlagPlayer.distanceToSquared(_combatFlagNpc) < attackRangeSq) {
      hostileNearby = true
      break
    }
  }
  if (hostileNearby) {
    gameState.inCombat = true
    gameState.lastCombatContactAt = gameState.simTime
  } else if (gameState.inCombat && gameState.simTime - (gameState.lastCombatContactAt ?? 0) > COMBAT_COOLDOWN_S) {
    gameState.inCombat = false
  }
}

/** True when the player has exchanged fire with a live pirate nearby (police response). */
export function playerFightingPirates(gameState) {
  if (!gameState?.npcs?.length) return false
  const engagedMap = gameState.player.combatEngagedNpcIds
  if (!engagedMap) return false
  const playerPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  return gameState.npcs.some((n) => {
    if (n.destroyed || n.faction !== 'pirate') return false
    if (!engagedMap[n.id]) return false
    return new THREE.Vector3().fromArray(n.position).distanceTo(playerPos) < ATTACK_RANGE * 1.4
  })
}
