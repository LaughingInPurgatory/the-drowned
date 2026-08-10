/** Lightweight island wildlife simulation. Wildlife is ephemeral like NPCs. */

export const WILDLIFE_SPECIES = Object.freeze({
  rabbit: Object.freeze({ height: 0.42, speed: 1.35, radius: 0.34, health: 12 }),
  cat: Object.freeze({ height: 0.38, speed: 1.05, radius: 0.32, health: 12 }),
  dog: Object.freeze({ height: 0.62, speed: 1.55, radius: 0.48, health: 18 }),
  deer: Object.freeze({ height: 1.55, speed: 2.05, radius: 0.72, health: 28 })
})

export const WILDLIFE_CORPSE_DURATION_S = 9
export const WILDLIFE_REPLACEMENT_DELAY_S = 24
export const WILDLIFE_DOG_ATTACK_RANGE = 10
export const WILDLIFE_DOG_ATTACK_INTERVAL_S = 2
export const WILDLIFE_DOG_BITE_CHANCE = 0.6
export const WILDLIFE_DOG_BITE_DAMAGE = 4

export function createWildlife(id, species, bodyId, position, heading = 0, now = 0) {
  const def = WILDLIFE_SPECIES[species] ?? WILDLIFE_SPECIES.rabbit
  return {
    id,
    species: WILDLIFE_SPECIES[species] ? species : 'rabbit',
    bodyId,
    position: [...position],
    heading,
    health: def.health,
    state: 'alive',
    lastTurnAt: now,
    deadAt: null,
    respawnAt: null
  }
}

export function updateWildlife(creatures, dt, now, surfaceAt, random = Math.random) {
  const seconds = Math.max(0, Number(dt) || 0)
  const time = Number(now) || 0
  for (const creature of creatures ?? []) {
    if (creature.state === 'dead') {
      if (time >= (Number(creature.deadAt) || time) + WILDLIFE_CORPSE_DURATION_S) {
        creature.state = 'respawning'
        creature.respawnAt = time + WILDLIFE_REPLACEMENT_DELAY_S + random() * 12
      }
      continue
    }
    if (creature.state !== 'alive') continue

    if (time >= (Number(creature.lastTurnAt) || 0) + 1.5 + random() * 3.5) {
      creature.heading += (random() - 0.5) * 1.7
      creature.lastTurnAt = time
    }
    const def = WILDLIFE_SPECIES[creature.species] ?? WILDLIFE_SPECIES.rabbit
    const distance = def.speed * seconds
    const x = Number(creature.position?.[0]) || 0
    const z = Number(creature.position?.[2]) || 0
    const nextX = x + Math.sin(creature.heading) * distance
    const nextZ = z + Math.cos(creature.heading) * distance
    const nextY = typeof surfaceAt === 'function' ? surfaceAt(nextX, nextZ) : null
    if (!Number.isFinite(nextY)) {
      creature.heading += Math.PI * (0.7 + random() * 0.6)
      creature.lastTurnAt = time
      continue
    }
    creature.position[0] = nextX
    creature.position[1] = nextY + 0.015
    creature.position[2] = nextZ
  }
}

export function respawnWildlife(creature, position, heading, now) {
  const def = WILDLIFE_SPECIES[creature.species] ?? WILDLIFE_SPECIES.rabbit
  creature.position = [...position]
  creature.heading = heading
  creature.health = def.health
  creature.state = 'alive'
  creature.lastTurnAt = Number(now) || 0
  creature.deadAt = null
  creature.respawnAt = null
}

export function damageWildlife(creature, damage, now) {
  if (!creature || creature.state !== 'alive') return false
  creature.health = Math.max(0, Number(creature.health) - Math.max(0, Number(damage) || 0))
  if (creature.health > 0) return false
  creature.state = 'dead'
  creature.deadAt = Number(now) || 0
  return true
}

export function updateWildlifeDogAttacks(creatures, playerPosition, now, random = Math.random) {
  if (!Array.isArray(playerPosition)) return []
  const time = Number(now) || 0
  const hits = []
  for (const creature of creatures ?? []) {
    if (creature.species !== 'dog' || creature.state !== 'alive') continue
    const dx = (Number(creature.position?.[0]) || 0) - (Number(playerPosition[0]) || 0)
    const dz = (Number(creature.position?.[2]) || 0) - (Number(playerPosition[2]) || 0)
    if (dx * dx + dz * dz > WILDLIFE_DOG_ATTACK_RANGE ** 2) continue
    if (time < (Number(creature.nextAttackAt) || -Infinity)) continue
    creature.nextAttackAt = time + WILDLIFE_DOG_ATTACK_INTERVAL_S
    if (random() < WILDLIFE_DOG_BITE_CHANCE) {
      hits.push({ creature, damage: WILDLIFE_DOG_BITE_DAMAGE })
    }
  }
  return hits
}

function closestPointOnSegment(from, to, target) {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const lengthSq = dx * dx + dy * dy + dz * dz
  const tx = target[0] - from[0]
  const ty = target[1] - from[1]
  const tz = target[2] - from[2]
  const t = lengthSq > 1e-9
    ? Math.max(0, Math.min(1, (tx * dx + ty * dy + tz * dz) / lengthSq))
    : 0
  return {
    t,
    position: [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t]
  }
}

/** Return the nearest living creature crossed by a projectile segment. */
export function hitWildlifeSegment(creatures, from, to, damage, now) {
  let best = null
  for (const creature of creatures ?? []) {
    if (creature.state !== 'alive') continue
    const def = WILDLIFE_SPECIES[creature.species] ?? WILDLIFE_SPECIES.rabbit
    const point = closestPointOnSegment(from, to, creature.position)
    const dx = creature.position[0] - point.position[0]
    const dy = creature.position[1] - point.position[1]
    const dz = creature.position[2] - point.position[2]
    const radius = def.radius + 0.28
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue
    if (!best || point.t < best.t) best = { creature, t: point.t, position: point.position }
  }
  if (!best) return null
  best.killed = damageWildlife(best.creature, damage, now)
  return best
}
