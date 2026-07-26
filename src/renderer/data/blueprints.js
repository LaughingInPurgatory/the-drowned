import { SHIP_CLASSES, getShipClass, isAlienShipClass } from './shipClasses.js'
import { WEAPONS, getWeapon, isAlienWeapon } from './weapons.js'
import { ACCESSORIES, getAccessory } from './accessories.js'
import { MINED_ORE_GOOD_IDS, getGood } from './goods.js'

// Blueprint ids: "ship:<classId>" | "weapon:<weaponId>" | "accessory:<id>"
// Crafted from raw mined ore at station Industry (game/crafting.js).

/**
 * Full manufacture cost (ore market value + bay fees) ≈ this fraction of shop
 * list price — always cheaper to build than buy if you pay for everything.
 *
 * Of that budget:
 *   - MANUFACTURE_ORE_SHARE (65%) is the ore materials (valued at base price).
 *     Mine the ore yourself → you skip this and only pay the bay fee.
 *   - Remainder (35%) is the station industry bay fee in credits.
 */
export const MANUFACTURE_COST_FRACTION = 0.75
/** Share of the manufacture budget represented by ore materials (base-price value). */
export const MANUFACTURE_ORE_SHARE = 0.65
/** Share of the manufacture budget paid as station bay credits (1 − ore share). */
export const MANUFACTURE_CREDIT_SHARE = 1 - MANUFACTURE_ORE_SHARE

export function blueprintIdForShip(classId) {
  return `ship:${classId}`
}

export function blueprintIdForWeapon(weaponId) {
  return `weapon:${weaponId}`
}

export function blueprintIdForAccessory(accessoryId) {
  return `accessory:${accessoryId}`
}

export function parseBlueprintId(blueprintId) {
  if (!blueprintId || typeof blueprintId !== 'string') return null
  const i = blueprintId.indexOf(':')
  if (i < 1) return null
  const kind = blueprintId.slice(0, i)
  const itemId = blueprintId.slice(i + 1)
  if ((kind !== 'ship' && kind !== 'weapon' && kind !== 'accessory') || !itemId) return null
  return { kind, itemId }
}

export function getBlueprint(blueprintId) {
  const parsed = parseBlueprintId(blueprintId)
  if (!parsed) throw new Error(`Unknown blueprint: ${blueprintId}`)
  if (parsed.kind === 'ship') {
    const shipClass = getShipClass(parsed.itemId)
    return {
      id: blueprintId,
      kind: 'ship',
      itemId: shipClass.id,
      name: `${shipClass.name} Blueprint`,
      itemName: shipClass.name,
      listPrice: shipClass.price
    }
  }
  if (parsed.kind === 'accessory') {
    const acc = getAccessory(parsed.itemId)
    return {
      id: blueprintId,
      kind: 'accessory',
      itemId: acc.id,
      name: `${acc.name} Blueprint`,
      itemName: acc.name,
      listPrice: acc.price
    }
  }
  const weapon = getWeapon(parsed.itemId)
  return {
    id: blueprintId,
    kind: 'weapon',
    itemId: weapon.id,
    name: `${weapon.name} Blueprint`,
    itemName: weapon.name,
    listPrice: weapon.price
  }
}

/** All craftable blueprints (ships + paid weapons + accessories). Free / unpriced excluded. */
export function allBlueprints() {
  const list = []
  for (const shipClass of SHIP_CLASSES) {
    // npcOnly police (price 0) is not a craft recipe.
    if (shipClass.price <= 0) continue
    list.push(getBlueprint(blueprintIdForShip(shipClass.id)))
  }
  for (const weapon of WEAPONS) {
    if (weapon.price <= 0) continue
    list.push(getBlueprint(blueprintIdForWeapon(weapon.id)))
  }
  for (const acc of ACCESSORIES) {
    if (acc.price <= 0) continue
    list.push(getBlueprint(blueprintIdForAccessory(acc.id)))
  }
  return list
}

/** Human industry loot pool — never rolls alien tech. */
export function humanBlueprints() {
  return allBlueprints().filter((bp) => {
    if (bp.kind === 'ship') return !isAlienShipClass(bp.itemId)
    if (bp.kind === 'weapon') return !isAlienWeapon(bp.itemId)
    return true
  })
}

/** Alien-only craftables (ships + paid alien weapons). ONLY from alien wrecks. */
export function alienBlueprints() {
  return allBlueprints().filter((bp) => {
    if (bp.kind === 'ship') return isAlienShipClass(bp.itemId)
    if (bp.kind === 'weapon') return isAlienWeapon(bp.itemId)
    return false
  })
}

function weightedPickBlueprintId(list, rng) {
  if (!list.length) return null
  const weights = list.map((bp) => 1 / Math.sqrt(Math.max(1, bp.listPrice)))
  const sum = weights.reduce((a, b) => a + b, 0)
  let r = rng() * sum
  for (let i = 0; i < list.length; i++) {
    r -= weights[i]
    if (r <= 0) return list[i].id
  }
  return list[list.length - 1].id
}

// Craft duration bands: weapons/accessories low; ships upper band.
export const WEAPON_COMPLEXITY_MAX = 0.2
export const ACCESSORY_COMPLEXITY_MAX = 0.25
export const SHIP_COMPLEXITY_MIN = 0.62

function relativePriceWithinKind(kind, listPrice) {
  let min = Infinity
  let max = 0
  for (const bp of allBlueprints()) {
    if (bp.kind !== kind) continue
    const c = Math.max(1, bp.listPrice)
    if (c < min) min = c
    if (c > max) max = c
  }
  max = Math.max(min + 1, max)
  const c = Math.max(1, listPrice)
  return (Math.log(c) - Math.log(min)) / (Math.log(max) - Math.log(min))
}

/**
 * 0–1 craft complexity. Weapons/accessories in the low band; ships high.
 */
export function blueprintComplexity(blueprintId) {
  const bp = getBlueprint(blueprintId)
  const r = relativePriceWithinKind(bp.kind, bp.listPrice)
  if (bp.kind === 'weapon') return r * WEAPON_COMPLEXITY_MAX
  if (bp.kind === 'accessory') return r * ACCESSORY_COMPLEXITY_MAX
  return SHIP_COMPLEXITY_MIN + r * (1 - SHIP_COMPLEXITY_MIN)
}

// Craft duration: 1 minute (tiny weapon) → 4 hours (largest ships), wall-clock.
export const CRAFT_DURATION_MIN_S = 60
export const CRAFT_DURATION_MAX_S = 4 * 60 * 60

export function craftDurationS(blueprintId) {
  const t = blueprintComplexity(blueprintId)
  return Math.round(CRAFT_DURATION_MIN_S + t * (CRAFT_DURATION_MAX_S - CRAFT_DURATION_MIN_S))
}

// Ship relative price (0–1 within ship roster) thresholds for rim ores.
export const SHIP_EXOTIC_ORE_FROM_R = 0.55
export const SHIP_QUANTUM_ORE_FROM_R = 0.78

/** Total manufacture budget (credits + ore value at base prices). */
export function manufactureBudget(listPrice) {
  return Math.max(0, Math.round(Math.max(0, listPrice) * MANUFACTURE_COST_FRACTION))
}

/** Ore materials target (base-price value): 65% of the 75% manufacture budget. */
export function oreBudgetForBlueprint(listPrice) {
  return Math.max(0, Math.round(manufactureBudget(listPrice) * MANUFACTURE_ORE_SHARE))
}

/**
 * Station bay fee: 35% of the 75% manufacture budget (~26.25% of list price).
 * This is the only cash cost if you mined the ore yourself.
 */
export function creditCostForBlueprint(blueprintId) {
  const bp = getBlueprint(blueprintId)
  if (bp.listPrice <= 0) return 0
  const budget = manufactureBudget(bp.listPrice)
  return Math.max(1, Math.round(budget * MANUFACTURE_CREDIT_SHARE))
}

/**
 * Ore recipe valued (at base prices) so that:
 *   oreValue ≈ 65% of manufacture budget (≈ 48.75% of list price)
 *   creditCost ≈ 35% of manufacture budget (≈ 26.25% of list price)
 *   total ≈ 75% of list price if you buy the ore; ~bay fee only if you mined it.
 * Mix: weapons/accessories use raw+rich; high-tier ships add exotic/quantum.
 */
export function oreCostForBlueprint(blueprintId) {
  const bp = getBlueprint(blueprintId)
  if (bp.listPrice <= 0) return {}
  const oreBudget = oreBudgetForBlueprint(bp.listPrice)
  const r = relativePriceWithinKind(bp.kind, bp.listPrice)

  // Weighted mix of ore types (value allocation before converting to units).
  const mix = []
  if (bp.kind === 'weapon' || bp.kind === 'accessory') {
    mix.push({ id: 'raw_ore', w: 0.72 - r * 0.22 })
    mix.push({ id: 'rich_ore', w: 0.28 + r * 0.22 })
  } else {
    // Ships
    let rawW = 0.48 - r * 0.12
    let richW = 0.32 + r * 0.08
    let exoticW = 0
    let quantumW = 0
    if (r >= SHIP_EXOTIC_ORE_FROM_R) {
      const e = (r - SHIP_EXOTIC_ORE_FROM_R) / (1 - SHIP_EXOTIC_ORE_FROM_R)
      exoticW = e * e * 0.28
    }
    if (r >= SHIP_QUANTUM_ORE_FROM_R) {
      const q = (r - SHIP_QUANTUM_ORE_FROM_R) / (1 - SHIP_QUANTUM_ORE_FROM_R)
      quantumW = q * q * 0.32
    }
    const premium = exoticW + quantumW
    rawW = Math.max(0.12, rawW - premium * 0.55)
    richW = Math.max(0.12, richW - premium * 0.45)
    mix.push({ id: 'raw_ore', w: rawW })
    mix.push({ id: 'rich_ore', w: richW })
    if (exoticW > 0) mix.push({ id: 'exotic_ore', w: exoticW })
    if (quantumW > 0) mix.push({ id: 'quantum_ore', w: quantumW })
  }

  const totalW = mix.reduce((a, m) => a + m.w, 0) || 1
  const cost = {}
  let spent = 0
  for (const m of mix) {
    const share = oreBudget * (m.w / totalW)
    const unitPrice = getGood(m.id).basePrice
    let qty = Math.round(share / unitPrice)
    if (m.id === 'raw_ore') qty = Math.max(1, qty)
    if (qty > 0) {
      cost[m.id] = qty
      spent += qty * unitPrice
    }
  }

  // Nudge raw ore so total ore value lands near oreBudget.
  const rawPrice = getGood('raw_ore').basePrice
  const gap = oreBudget - spent
  if (Math.abs(gap) >= rawPrice * 0.5) {
    const adj = Math.round(gap / rawPrice)
    cost.raw_ore = Math.max(1, (cost.raw_ore ?? 0) + adj)
  }

  return cost
}

/** Base-price value of an ore cost map (for tests / UI). */
export function oreCostValue(cost) {
  let v = 0
  for (const [id, qty] of Object.entries(cost ?? {})) {
    if (qty > 0) v += getGood(id).basePrice * qty
  }
  return v
}

/** creditCost + ore base value for a blueprint. */
export function totalManufactureCost(blueprintId) {
  return creditCostForBlueprint(blueprintId) + oreCostValue(oreCostForBlueprint(blueprintId))
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.ceil(seconds))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatOreCost(cost) {
  return MINED_ORE_GOOD_IDS.filter((id) => (cost[id] ?? 0) > 0)
    .map((id) => `${cost[id]} ${id.replace(/_/g, ' ')}`)
    .join(', ')
}

/** Weighted random human blueprint for probe / ordinary wreck loot. */
export function rollRandomBlueprintId(rng = Math.random) {
  return weightedPickBlueprintId(humanBlueprints(), rng)
}

/** Weighted random alien blueprint — only used by alien wreck drops. */
export function rollAlienBlueprintId(rng = Math.random) {
  return weightedPickBlueprintId(alienBlueprints(), rng)
}
