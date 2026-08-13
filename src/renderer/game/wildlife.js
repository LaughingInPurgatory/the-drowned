/** Lightweight island wildlife simulation. Wildlife is ephemeral like NPCs. */

export const WILDLIFE_SPECIES = Object.freeze({
  rabbit: Object.freeze({
    height: 0.72, speed: 1.3, radius: 0.5, health: 12, stride: 0.38, label: 'Rabbit'
  }),
  cat: Object.freeze({
    height: 0.38, speed: 1.05, radius: 0.32, health: 12, stride: 0.32, label: 'Cat'
  }),
  dog: Object.freeze({
    height: 0.82, speed: 1.7, radius: 0.55, health: 22, stride: 0.56, label: 'Wild dog',
    alwaysHostile: true, attackRange: 2.15, attackDamage: 5, threat: 'bark'
  }),
  deer: Object.freeze({
    height: 1.55, speed: 2.05, radius: 0.72, health: 28, stride: 0.92, label: 'Deer'
  }),
  rat: Object.freeze({
    height: 0.55, speed: 1.35, radius: 0.4, health: 6, stride: 0.22, label: 'Rat'
  }),
  boar: Object.freeze({
    height: 0.88, speed: 1.6, radius: 0.7, health: 34, stride: 0.5, label: 'Wild boar',
    sometimesHostile: true, attackRange: 2.4, attackDamage: 7, threat: 'grunt'
  }),
  ferret: Object.freeze({
    height: 0.22, speed: 1.5, radius: 0.16, health: 8, stride: 0.18, label: 'Ferret'
  }),
  stoat: Object.freeze({
    height: 0.2, speed: 1.65, radius: 0.15, health: 8, stride: 0.16, label: 'Stoat'
  })
})

export const WILDLIFE_CORPSE_DURATION_S = 9
export const WILDLIFE_REPLACEMENT_DELAY_S = 24
export const WILDLIFE_DOG_ATTACK_RANGE = 2.15
export const WILDLIFE_DOG_ATTACK_INTERVAL_S = 2
export const WILDLIFE_DOG_BITE_CHANCE = 0.6
export const WILDLIFE_DOG_BITE_DAMAGE = 5

export function createWildlife(id, species, bodyId, position, heading = 0, now = 0, random = Math.random) {
  const def = WILDLIFE_SPECIES[species] ?? WILDLIFE_SPECIES.rabbit
  const hostile = !!def.alwaysHostile || (!!def.sometimesHostile && random() < 0.4)
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
    respawnAt: null,
    walkPhase: 0,
    moving: false,
    stepped: false,
    fallSide: 1,
    hostile
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
      creature.moving = false
      creature.stepped = false
      continue
    }
    creature.position[0] = nextX
    creature.position[1] = nextY + 0.015
    creature.position[2] = nextZ
    creature.moving = distance > 1e-4
    const stride = Math.max(0.16, def.stride || 0.4)
    const prevPhase = Number(creature.walkPhase) || 0
    creature.walkPhase = prevPhase + (distance / stride) * Math.PI * 2
    creature.stepped = Math.floor(prevPhase / Math.PI) !== Math.floor(creature.walkPhase / Math.PI)
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
  creature.walkPhase = 0
  creature.moving = false
}

export function damageWildlife(creature, damage, now) {
  if (!creature || creature.state !== 'alive') return false
  creature.health = Math.max(0, Number(creature.health) - Math.max(0, Number(damage) || 0))
  if (creature.health > 0) return false
  creature.state = 'dead'
  creature.deadAt = Number(now) || 0
  creature.moving = false
  creature.fallSide = Number(creature.heading) % 1 > 0.5 ? -1 : 1
  return true
}

export function wildlifeStepInterval(species) {
  const def = WILDLIFE_SPECIES[species] ?? WILDLIFE_SPECIES.rabbit
  return Math.max(0.22, (Number(def.stride) || 0.4) / Math.max(0.5, Number(def.speed) || 1))
}

export function wildlifeAttackRange(creature) {
  const def = WILDLIFE_SPECIES[creature?.species] ?? WILDLIFE_SPECIES.rabbit
  return Number(def.attackRange) || WILDLIFE_DOG_ATTACK_RANGE
}

export function updateWildlifeDogAttacks(creatures, playerPosition, now, random = Math.random) {
  if (!Array.isArray(playerPosition)) return []
  const time = Number(now) || 0
  const hits = []
  for (const creature of creatures ?? []) {
    if (creature.state !== 'alive' || !creature.hostile) continue
    const def = WILDLIFE_SPECIES[creature.species] ?? WILDLIFE_SPECIES.rabbit
    if (!def.attackRange) continue
    const dx = (Number(creature.position?.[0]) || 0) - (Number(playerPosition[0]) || 0)
    const dz = (Number(creature.position?.[2]) || 0) - (Number(playerPosition[2]) || 0)
    const range = wildlifeAttackRange(creature)
    if (dx * dx + dz * dz > range * range) continue
    if (time < (Number(creature.nextAttackAt) || -Infinity)) continue
    creature.nextAttackAt = time + WILDLIFE_DOG_ATTACK_INTERVAL_S
    hits.push({
      creature,
      threat: def.threat || 'bark',
      damage: random() < WILDLIFE_DOG_BITE_CHANCE ? (def.attackDamage || WILDLIFE_DOG_BITE_DAMAGE) : 0
    })
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

/** Hit living animals, or corpses that have not despawned yet. */
export function hitWildlifeSegment(creatures, from, to, damage, now) {
  let best = null
  for (const creature of creatures ?? []) {
    if (creature.state !== 'alive' && creature.state !== 'dead') continue
    const def = WILDLIFE_SPECIES[creature.species] ?? WILDLIFE_SPECIES.rabbit
    const point = closestPointOnSegment(from, to, creature.position)
    const dx = creature.position[0] - point.position[0]
    const dy = creature.position[1] - point.position[1]
    const dz = creature.position[2] - point.position[2]
    const radius = def.radius + (creature.state === 'dead' ? 0.55 : 0.28)
    if (dx * dx + dy * dy + dz * dz > radius * radius) continue
    if (!best || point.t < best.t) best = { creature, t: point.t, position: point.position }
  }
  if (!best) return null
  if (best.creature.state === 'dead') {
    best.killed = false
    best.corpse = true
    return best
  }
  best.killed = damageWildlife(best.creature, damage, now)
  best.corpse = false
  return best
}
