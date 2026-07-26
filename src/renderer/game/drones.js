import { getDrone, droneBayCount, DEFAULT_DRONE_ID } from '../data/drones.js'
import { getShipClass } from '../data/shipClasses.js'
import { getWeapon } from '../data/weapons.js'
import { playerSkillBonuses } from './skills.js'
import { effectiveDroneBayCount } from '../data/accessories.js'

// Combat drones are **player-only**. NPCs never summon, carry, or fire drones —
// even if they fly a hull class that has droneBays for the player shipyard.

const SHIELD_REGEN_DELAY_S = 4
const SHIELD_REGEN_RATE = 6 // points per second
/** Out-of-combat escort orbit radius (metres from player ship). */
export const ORBIT_DIST = 20
/** Seconds for one full escort orbit. */
const ORBIT_PERIOD_S = 12
/** Launch: bay → orbit */
const LAUNCH_S = 1.35
/** Recall: space → bay */
const RECALL_S = 1.2
// Shared with main.js's drone projectile spawn so the lead solution and the
// shot it predicts can never be computed at different speeds.
export const DRONE_SHOT_SPEED_FALLBACK = 400
// Deliberate aim scatter, as a fraction of range. Drones are meant to be a
// helpful escort, not an aimbot: the intercept solve below is near-exact, so
// without this they would land essentially every shot.
//
// Scaling with range makes them naturally reliable up close and sloppy far out.
// Against a typical ~13 unit hit radius this value works out at roughly:
//   150u -> ~100% hits,  300u -> ~54%,  450u -> ~36%
// Raise for sloppier drones, lower for deadlier ones.
export const DRONE_AIM_SPREAD = 0.08
const ATTACK_RANGE = 520
// How far a drone will pursue a target it has already committed to.
const ENGAGE_RANGE = 1150
// Drones defend proactively: anything hostile that closes inside this range of
// the PLAYER (radar distance, not drone distance — the drone is orbiting a few
// metres away) gets engaged whether or not it has opened fire yet. Previously
// they waited for shots to be exchanged, so a pirate could close to point-blank
// with the escort just sitting there.
export const DRONE_PROACTIVE_RANGE = 1000
const STRAFE_DIST = 55
const KEEP_DIST = 70
const FIRE_CONE = 0.72 // ~44° — slightly forgiving while strafing

/**
 * Ensure *player* ship.drones respects bay capacity (trim extras, reindex).
 * Does **not** auto-spawn drones — buy/install from Shipyard → Armoury.
 * Destroyed drones stay listed until repaired at a station.
 * Never call this for NPC ships.
 */
export function ensureDrones(ship, shipClass = null) {
  if (!ship) return []
  // NPCs / non-player entities must not get drone state.
  if (ship.faction != null || ship.npc === true) {
    ship.drones = []
    return ship.drones
  }
  const cls = shipClass ?? getShipClass(ship.classId)
  // Player ships may gain a bay from Extra Drone Bay accessory.
  const bays = effectiveDroneBayCount(ship, cls)
  ship.drones ??= []
  // Drop invalid entries and any past bay capacity (no free refill).
  ship.drones = ship.drones.filter((d) => d && typeof d === 'object')
  if (ship.drones.length > bays) ship.drones.length = bays
  for (let i = 0; i < ship.drones.length; i++) {
    ship.drones[i].bayIndex = i
    ship.drones[i].mode ??= ship.drones[i].deployed ? 'escort' : 'bay'
    ship.drones[i].typeId ??= DEFAULT_DRONE_ID
  }
  return ship.drones
}

/** Empty bay slots remaining on this hull (bays − installed drones). */
export function freeDroneBayCount(ship, shipClass = null) {
  if (!ship) return 0
  const cls = shipClass ?? getShipClass(ship.classId)
  const bays = effectiveDroneBayCount(ship, cls)
  ensureDrones(ship, cls)
  return Math.max(0, bays - ship.drones.length)
}

/**
 * Install one drone unit onto the ship (from purchase/equip).
 * @returns {object} the new drone state
 */
export function installDroneOnShip(ship, typeId = DEFAULT_DRONE_ID, shipClass = null) {
  if (!ship) throw new Error('No ship')
  const cls = shipClass ?? getShipClass(ship.classId)
  const bays = effectiveDroneBayCount(ship, cls)
  if (bays < 1) throw new Error('No drone bays on this hull')
  ensureDrones(ship, cls)
  if (ship.drones.length >= bays) throw new Error('All drone bays are full')
  const def = getDrone(typeId)
  const d = makeDroneState(def, ship.drones.length)
  ship.drones.push(d)
  return d
}

/**
 * Remove one installed drone (by bay index) and return its typeId for storage/sale.
 * Must be stowed (not deployed).
 */
export function removeDroneFromShip(ship, bayIndex) {
  if (!ship) throw new Error('No ship')
  ensureDrones(ship)
  const idx = Math.floor(Number(bayIndex))
  const d = ship.drones[idx]
  if (!d) throw new Error('No drone in that bay')
  if (d.deployed && d.mode !== 'bay') throw new Error('Recall drones before removing them')
  const typeId = d.typeId || DEFAULT_DRONE_ID
  ship.drones.splice(idx, 1)
  ensureDrones(ship)
  return typeId
}

export function makeDroneState(def, bayIndex) {
  const idSuffix = `${bayIndex}-${Math.random().toString(36).slice(2, 7)}`
  return {
    id: `drone-${idSuffix}`,
    typeId: def.id,
    bayIndex,
    hull: def.hull,
    shields: def.shields,
    armor: def.armor,
    maxHull: def.hull,
    maxShields: def.shields,
    maxArmor: def.armor,
    /** bay | launching | escort | combat | returning */
    mode: 'bay',
    deployed: false,
    destroyed: false,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    orbitPhase: bayIndex * Math.PI,
    animT: 0,
    launchFrom: null,
    launchTo: null,
    lastHitAt: null,
    lastFireAt: 0
  }
}

/** Visible in space (including launch/return transit). */
export function livingDeployedDrones(ship) {
  return (ship.drones ?? []).filter(
    (d) => d.deployed && !d.destroyed && d.hull > 0 && d.mode !== 'bay'
  )
}

export function hasDroneBays(ship) {
  try {
    return droneBayCount(getShipClass(ship.classId)) > 0
  } catch {
    return false
  }
}

/** World position of a drone bay hardpoint on the player hull. */
export function bayWorldPos(ship, bayIndex) {
  const side = bayIndex === 0 ? -1 : 1
  // Local: left/right of rear ventral area
  const [rx, ry, rz] = rotateOffset(side * 2.8, -0.4, -3.5, ship.quaternion)
  return [
    ship.position[0] + rx,
    ship.position[1] + ry,
    ship.position[2] + rz
  ]
}

function orbitWorldPos(shipPos, orbitPhase) {
  return [
    shipPos[0] + Math.cos(orbitPhase) * ORBIT_DIST,
    shipPos[1] + 2.5,
    shipPos[2] + Math.sin(orbitPhase) * ORBIT_DIST
  ]
}

function easeInOut(t) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/** Launch all non-destroyed drones: animate out of bays toward escort orbit. */
export function summonDrones(gameState) {
  const ship = gameState?.player?.ship
  if (!ship) return { ok: false, reason: 'No player ship' }
  const cls = getShipClass(ship.classId)
  ensureDrones(ship, cls)
  const bays = droneBayCount(cls)
  if (bays < 1) return { ok: false, reason: 'No drone bays on this hull' }
  if (ship.drones.length === 0) {
    return { ok: false, reason: 'No drones installed — buy from Shipyard → Armoury' }
  }

  let launched = 0
  const q = ship.quaternion
  for (const d of ship.drones) {
    if (d.destroyed || d.hull <= 0) continue
    // Already out or mid-launch
    if (d.deployed && d.mode !== 'returning' && d.mode !== 'bay') continue
    d.orbitPhase = d.orbitPhase ?? d.bayIndex * Math.PI
    const from = bayWorldPos(ship, d.bayIndex)
    const to = orbitWorldPos(ship.position, d.orbitPhase)
    d.launchFrom = from
    d.launchTo = to
    d.position = [...from]
    d.velocity = [0, 0, 0]
    d.quaternion = [...q]
    d.animT = 0
    d.mode = 'launching'
    d.deployed = true
    launched++
  }
  if (launched === 0) {
    const anyDestroyed = ship.drones.some((d) => d.destroyed || d.hull <= 0)
    if (anyDestroyed) return { ok: false, reason: 'Drones need station repair' }
    return { ok: false, reason: 'Drones already deployed' }
  }
  return { ok: true, launched }
}

/** Call drones back: animate into bays, then stow. */
export function recallDrones(gameState) {
  const ship = gameState.player.ship
  ensureDrones(ship)
  let n = 0
  for (const d of ship.drones) {
    if (!d.deployed || d.destroyed) continue
    if (d.mode === 'returning' || d.mode === 'bay') continue
    d.mode = 'returning'
    d.animT = 0
    d.launchFrom = [...d.position]
    d.launchTo = bayWorldPos(ship, d.bayIndex)
    d.velocity = [0, 0, 0]
    n++
  }
  return { ok: n > 0, recalled: n }
}

/** Force-bay all drones instantly (supercruise / hyperspace). */
export function teleportDronesToBay(ship) {
  if (!ship?.drones) return
  for (const d of ship.drones) {
    if (d.destroyed) continue
    d.deployed = false
    d.mode = 'bay'
    d.animT = 0
    d.velocity = [0, 0, 0]
    d.launchFrom = null
    d.launchTo = null
  }
}

/**
 * Station repair restores drone hull/armor/shields (destroyed drones revived).
 * Ship parts do NOT repair drones.
 */
export function repairDrones(ship) {
  if (!ship) return
  ensureDrones(ship)
  for (const d of ship.drones) {
    const def = getDrone(d.typeId)
    d.maxHull = def.hull
    d.maxShields = def.shields
    d.maxArmor = def.armor
    d.hull = def.hull
    d.shields = def.shields
    d.armor = def.armor
    d.destroyed = false
    d.deployed = false
    d.mode = 'bay'
    d.animT = 0
    d.lastHitAt = null
  }
}

/**
 * Apply damage to a drone (shields → armor → hull). Returns true if destroyed.
 */
export function damageDrone(drone, amount, simTime) {
  if (!drone || drone.destroyed) return true
  // Invulnerable while still leaving the bay hatch.
  if (drone.mode === 'launching' || drone.mode === 'bay') return false
  let rem = amount
  drone.lastHitAt = simTime
  if (drone.shields > 0) {
    const take = Math.min(drone.shields, rem)
    drone.shields -= take
    rem -= take
  }
  if (rem > 0 && drone.armor > 0) {
    const take = Math.min(drone.armor, rem)
    drone.armor -= take
    rem -= take
  }
  if (rem > 0) drone.hull -= rem
  if (drone.hull <= 0) {
    drone.hull = 0
    drone.destroyed = true
    drone.deployed = false
    drone.mode = 'bay'
    return true
  }
  return false
}

function rotateOffset(x, y, z, quat) {
  const qx = quat[0]
  const qy = quat[1]
  const qz = quat[2]
  const qw = quat[3]
  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx
  ]
}

function forwardFromQuat(q) {
  const [x, y, z, w] = q
  return [
    2 * (x * z + w * y),
    2 * (y * z - w * x),
    1 - 2 * (x * x + y * y)
  ]
}

function len3(v) {
  return Math.hypot(v[0], v[1], v[2])
}

function norm3(v) {
  const L = len3(v) || 1
  return [v[0] / L, v[1] / L, v[2] / L]
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * Per-frame drone AI for the **player** only.
 * Handles launch/return animations, escort orbit, combat.
 */
/**
 * Where to aim so a shot and a moving target arrive at the same place.
 *
 * Solved by fixed-point iteration rather than in one step. A single
 * `distance / shotSpeed` estimate is the flight time to where the target is
 * NOW, but the shot must reach where it WILL BE, which is further for anything
 * crossing or opening range — so one step systematically under-leads. Two
 * refinements converge to within a hull width at this game's speeds.
 *
 * @param {number[]} shooterPos
 * @param {number[]} targetPos
 * @param {number[]} targetVel world-frame; projectiles here inherit no shooter velocity
 * @param {number} shotSpeed
 * @returns {number[]} world-space aim point
 */
export function solveInterceptPoint(shooterPos, targetPos, targetVel, shotSpeed) {
  if (!(shotSpeed > 0)) return targetPos
  let t = len3(sub3(targetPos, shooterPos)) / shotSpeed
  for (let k = 0; k < 2; k++) {
    const predicted = add3(targetPos, scale3(targetVel, t))
    t = len3(sub3(predicted, shooterPos)) / shotSpeed
  }
  return add3(targetPos, scale3(targetVel, t))
}

export function updateDrones(gameState, dt, hooks = {}) {
  const ship = gameState?.player?.ship
  if (!ship) return
  ensureDrones(ship)
  const simTime = gameState.simTime ?? 0
  const shipPos = ship.position
  const shipQuat = ship.quaternion
  let droneMult = 1
  try {
    droneMult = playerSkillBonuses(gameState).droneMult
  } catch {
    droneMult = 1
  }

  for (const d of ship.drones) {
    if (d.destroyed || !d.deployed) continue
    const def = getDrone(d.typeId)

    // —— Launch animation: hatch → orbit slot ——
    if (d.mode === 'launching') {
      d.animT = (d.animT ?? 0) + dt / LAUNCH_S
      // Keep bay origin tracking the moving ship; destination = current orbit slot
      d.orbitPhase = d.orbitPhase ?? d.bayIndex * Math.PI
      const from = bayWorldPos(ship, d.bayIndex)
      const to = orbitWorldPos(shipPos, d.orbitPhase)
      const t = easeInOut(d.animT)
      // Slight arc outward
      const mid = add3(lerp3(from, to, 0.5), [0, 4, 0])
      const p1 = lerp3(from, mid, t)
      const p2 = lerp3(mid, to, t)
      const prev = d.position
      d.position = lerp3(p1, p2, t)
      const move = sub3(d.position, prev)
      d.velocity = scale3(move, 1 / Math.max(dt, 1e-4))
      if (len3(move) > 1e-4) d.quaternion = lookQuat(norm3(move))
      else d.quaternion = [...shipQuat]
      if (d.animT >= 1) {
        d.mode = 'escort'
        d.animT = 0
        d.position = to
        d.velocity = [0, 0, 0]
      }
      continue
    }

    // —— Return animation: space → bay hatch ——
    if (d.mode === 'returning') {
      d.animT = (d.animT ?? 0) + dt / RECALL_S
      const from = d.launchFrom ?? d.position
      const to = bayWorldPos(ship, d.bayIndex)
      const t = easeInOut(d.animT)
      const mid = add3(lerp3(from, to, 0.45), [0, 3, 0])
      const p1 = lerp3(from, mid, t)
      const p2 = lerp3(mid, to, t)
      const prev = d.position
      d.position = lerp3(p1, p2, t)
      const move = sub3(d.position, prev)
      d.velocity = scale3(move, 1 / Math.max(dt, 1e-4))
      if (len3(move) > 1e-4) d.quaternion = lookQuat(norm3(move))
      if (d.animT >= 1) {
        d.deployed = false
        d.mode = 'bay'
        d.animT = 0
        d.velocity = [0, 0, 0]
        d.launchFrom = null
        d.launchTo = null
      }
      continue
    }

    // Shield regen (escort / combat only)
    if (d.shields < d.maxShields) {
      const sinceHit = d.lastHitAt == null ? Infinity : simTime - d.lastHitAt
      if (sinceHit >= SHIELD_REGEN_DELAY_S) {
        d.shields = Math.min(d.maxShields, d.shields + SHIELD_REGEN_RATE * dt)
      }
    }

    // Only engage ships that exchanged fire with the player (not mere Tab-lock).
    const engaged = hooks.engagedNpcIds ?? null
    let targetNpc = null
    let targetPos = null
    let best = Infinity
    for (const npc of gameState.npcs) {
      if (npc.destroyed || !npc.id) continue
      const hostile = hooks.isHostileNpc?.(npc) ?? false
      const alreadyEngaged = engaged ? !!engaged[npc.id] : false
      // Either it has traded fire with us, or it is hostile and inside the
      // proactive bubble measured from the player.
      const nearPlayer = len3(sub3(npc.position, shipPos)) <= DRONE_PROACTIVE_RANGE
      if (!alreadyEngaged && !(hostile && nearPlayer)) continue
      const dist = len3(sub3(npc.position, d.position))
      // Prefer the player's current lock if that lock is engaged.
      const lockBonus =
        hooks.playerTargetNpcId && npc.id === hooks.playerTargetNpcId ? -200 : 0
      const score = dist + lockBonus
      if (score < best && dist < ENGAGE_RANGE) {
        best = score
        targetNpc = npc
        targetPos = npc.position
      }
    }

    d.mode = targetPos ? 'combat' : 'escort'

    let desired
    if (targetPos && targetNpc) {
      // Smart combat: keep standoff, strafe sideways, lead with velocity.
      const toMe = sub3(d.position, targetPos)
      const dist = len3(toMe) || 1
      const radial = scale3(toMe, 1 / dist)
      // Prefer KEEP_DIST ring
      const ring = add3(targetPos, scale3(radial, KEEP_DIST))
      // Strafe perpendicular (horizontal) — unique phase per bay
      d.strafePhase = (d.strafePhase ?? d.bayIndex * 2.1) + dt * 1.8
      const side = [
        -radial[2] * Math.cos(d.strafePhase) + radial[0] * 0.05,
        0.15 * Math.sin(d.strafePhase * 0.7 + d.bayIndex),
        radial[0] * Math.cos(d.strafePhase) + radial[2] * 0.05
      ]
      desired = add3(ring, scale3(norm3(side), STRAFE_DIST))
      // Don't fly through the player
      const toShip = len3(sub3(desired, shipPos))
      if (toShip < 12) desired = add3(desired, scale3(radial, 15))
    } else {
      d.orbitPhase = (d.orbitPhase ?? d.bayIndex * Math.PI) + (dt * (Math.PI * 2)) / ORBIT_PERIOD_S
      desired = orbitWorldPos(shipPos, d.orbitPhase)
    }

    const toDes = sub3(desired, d.position)
    const distDes = len3(toDes)
    const dir = distDes > 1e-4 ? scale3(toDes, 1 / distDes) : forwardFromQuat(d.quaternion)
    // Match player speed when escorting; push hard in combat.
    const shipSpeed = len3(ship.velocity ?? [0, 0, 0])
    const maxSpeed =
      (targetPos
        ? Math.max(def.speed, 160)
        : Math.max(def.speed, shipSpeed + 30, 90)) * droneMult
    const speed = Math.min(maxSpeed, (distDes * 4 + (targetPos ? 40 : 18)) * droneMult)
    d.velocity = scale3(dir, speed)
    d.position = add3(d.position, scale3(d.velocity, dt))

    // Lead aim: shoot where the target will be.
    //
    // Solved iteratively, not in one step. A single `dist / shotSpeed` estimate
    // measures flight time to where the target is NOW, but the shot actually
    // has to travel to where it WILL BE — which is further out for anything
    // crossing or opening range. At this weapon's 600 u/s over a 520 u attack
    // range that is nearly a second of flight, so the one-step solution
    // consistently trailed behind moving targets. Two refinements converge
    // close enough that the residual error is well inside the target's hull.
    let aimPos = targetPos
    if (targetPos && targetNpc?.velocity) {
      const weapon = getWeapon(def.weaponId)
      aimPos = solveInterceptPoint(
        d.position,
        targetPos,
        targetNpc.velocity,
        weapon.speed ?? DRONE_SHOT_SPEED_FALLBACK
      )
    }

    let faceDir
    if (aimPos) {
      faceDir = norm3(sub3(aimPos, d.position))
    } else if (distDes > 6) {
      faceDir = dir
    } else {
      faceDir = [-Math.sin(d.orbitPhase), 0, Math.cos(d.orbitPhase)]
    }
    d.quaternion = lookQuat(faceDir)

    if (aimPos && hooks.fireLaser) {
      const weapon = getWeapon(def.weaponId)
      const cooldown = weapon.cooldownS ?? 0.35
      if (simTime - (d.lastFireAt ?? 0) >= cooldown) {
        const fwd = forwardFromQuat(d.quaternion)
        const toT = norm3(sub3(aimPos, d.position))
        const range = len3(sub3(targetPos, d.position))
        // Never take a shot the projectile cannot physically complete: it dies
        // at speed x ttl. Firing past that is pure noise and looks stupid.
        const reach = (weapon.speed ?? DRONE_SHOT_SPEED_FALLBACK) * (weapon.ttl ?? 1.2) * 0.9
        if (dot3(fwd, toT) >= FIRE_CONE && range < Math.min(ATTACK_RANGE, reach)) {
          d.lastFireAt = simTime
          // Scatter applied HERE, not in the intercept solve, so the aiming
          // maths stays exact and testable and the inaccuracy is one explicit
          // knob. sqrt-free radial bias (spread * random) clusters shots toward
          // the centre rather than on a shell, so near-misses are common and
          // wild misses are rare.
          const spread = range * DRONE_AIM_SPREAD
          const jx = Math.random() * 2 - 1
          const jy = Math.random() * 2 - 1
          const jz = Math.random() * 2 - 1
          const jl = Math.hypot(jx, jy, jz) || 1
          const mag = spread * Math.random()
          const shotAt = [
            aimPos[0] + (jx / jl) * mag,
            aimPos[1] + (jy / jl) * mag,
            aimPos[2] + (jz / jl) * mag
          ]
          hooks.fireLaser(d, shotAt, weapon)
        }
      }
    }
  }
}

function lookQuat(dir) {
  const f = norm3(dir)
  const yaw = Math.atan2(f[0], f[2])
  const pitch = -Math.asin(Math.max(-1, Math.min(1, f[1])))
  const cy = Math.cos(yaw * 0.5)
  const sy = Math.sin(yaw * 0.5)
  const cp = Math.cos(pitch * 0.5)
  const sp = Math.sin(pitch * 0.5)
  return [sy * cp, cy * sp, sy * sp, cy * cp]
}
