import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CRAFT_DURATION_MIN_S,
  CRAFT_DURATION_MAX_S,
  craftDurationS,
  oreCostForBlueprint,
  creditCostForBlueprint,
  totalManufactureCost,
  manufactureBudget,
  oreBudgetForBlueprint,
  oreCostValue,
  MANUFACTURE_COST_FRACTION,
  MANUFACTURE_ORE_SHARE,
  MANUFACTURE_CREDIT_SHARE,
  blueprintIdForShip,
  blueprintIdForWeapon,
  blueprintIdForAccessory,
  allBlueprints,
  getBlueprint,
  SHIP_EXOTIC_ORE_FROM_R,
  SHIP_QUANTUM_ORE_FROM_R
} from '../data/blueprints.js'
import {
  startCraft,
  updateCraftingJobs,
  storeBlueprints,
  retrieveBlueprints,
  ensureBlueprintMaps,
  WRECK_BLUEPRINT_DROP_CHANCE,
  PROBE_BLUEPRINT_DROP_CHANCE
} from './crafting.js'
import { createGameState } from './state.js'
import { TEST_GALAXY_OPTS } from '../procgen/galaxy.js'
import { STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'
import { WEAPONS } from '../data/weapons.js'
import { ACCESSORIES } from '../data/accessories.js'

function freshState() {
  return createGameState({
    characterName: 'Crafter',
    shipInstanceName: 'Rig',
    shipClassId: STARTER_SHIP_CLASS_ID,
    seed: 42,
    galaxyOpts: TEST_GALAXY_OPTS
  })
}

test('blueprint catalog covers ships, paid weapons, and accessories', () => {
  const bps = allBlueprints()
  assert.ok(bps.some((b) => b.kind === 'ship'))
  assert.ok(bps.some((b) => b.kind === 'weapon'))
  assert.ok(bps.some((b) => b.kind === 'accessory'))
  assert.ok(!bps.some((b) => b.itemId === 'pulse_laser'), 'free pulse laser has no craftable BP')
  for (const a of ACCESSORIES) {
    assert.ok(bps.some((b) => b.kind === 'accessory' && b.itemId === a.id))
  }
})

test('craft duration spans ~1 minute to ~4 hours', () => {
  const durations = allBlueprints().map((b) => craftDurationS(b.id))
  const min = Math.min(...durations)
  const max = Math.max(...durations)
  assert.ok(min >= CRAFT_DURATION_MIN_S - 1)
  assert.ok(min <= CRAFT_DURATION_MIN_S + 120)
  assert.ok(max >= CRAFT_DURATION_MAX_S * 0.85)
  assert.ok(max <= CRAFT_DURATION_MAX_S + 1)
})

test('weapons and accessories craft faster than ships', () => {
  const modules = allBlueprints().filter((b) => b.kind === 'weapon' || b.kind === 'accessory')
  const ships = allBlueprints().filter((b) => b.kind === 'ship')
  const maxModDur = Math.max(...modules.map((b) => craftDurationS(b.id)))
  const minShipDur = Math.min(...ships.map((b) => craftDurationS(b.id)))
  assert.ok(maxModDur < minShipDur, 'slowest weapon/accessory faster than fastest ship')
  assert.ok(minShipDur >= CRAFT_DURATION_MAX_S * 0.55)
})

test('manufacture cost is ~75% of list; 65% of that is ore value, 35% bay fee', () => {
  assert.equal(MANUFACTURE_COST_FRACTION, 0.75)
  assert.equal(MANUFACTURE_ORE_SHARE, 0.65)
  assert.equal(MANUFACTURE_CREDIT_SHARE, 0.35)

  for (const bp of allBlueprints()) {
    const budget = manufactureBudget(bp.listPrice)
    const fee = creditCostForBlueprint(bp.id)
    const oreVal = oreCostValue(oreCostForBlueprint(bp.id))
    const total = totalManufactureCost(bp.id)
    const oreTarget = oreBudgetForBlueprint(bp.listPrice)
    const feeTarget = Math.round(budget * MANUFACTURE_CREDIT_SHARE)

    // Bay fee hits 35% of budget exactly (integer round).
    assert.equal(fee, Math.max(1, feeTarget))

    // Ore value ≈ 65% of budget (unit quantisation drift).
    const oreTol = Math.max(400, oreTarget * 0.15)
    assert.ok(
      Math.abs(oreVal - oreTarget) <= oreTol,
      `${bp.id}: ore value ${oreVal} vs target ${oreTarget}`
    )

    // Total ≈ 75% of list if you bought the ore.
    const totalTol = Math.max(400, budget * 0.12)
    assert.ok(
      Math.abs(total - budget) <= totalTol,
      `${bp.id}: manufacture ${total} vs budget ${budget} (list ${bp.listPrice})`
    )
    assert.ok(total < bp.listPrice, `${bp.id} must be cheaper to craft than buy`)
    // Bay-only path (mined ore) is much cheaper than full buy.
    assert.ok(fee < bp.listPrice * 0.4, `${bp.id}: bay fee should be well under list`)
    // Ore is the larger share of the craft bill.
    assert.ok(oreVal > fee * 0.9, `${bp.id}: ore share should dominate bay fee`)
  }
})

test('Autopilot and Extra Ore Storage prices and craft budgets', () => {
  assert.equal(getBlueprint(blueprintIdForAccessory('autopilot')).listPrice, 10000)
  assert.equal(getBlueprint(blueprintIdForAccessory('extra_ore_storage')).listPrice, 12000)
  // 75% of list
  assert.equal(manufactureBudget(10000), 7500)
  assert.equal(manufactureBudget(12000), 9000)
  // 65% of that budget is ore materials
  assert.equal(oreBudgetForBlueprint(10000), Math.round(7500 * 0.65)) // 4875
  assert.equal(oreBudgetForBlueprint(12000), Math.round(9000 * 0.65)) // 5850
  // 35% bay fee
  assert.equal(creditCostForBlueprint(blueprintIdForAccessory('autopilot')), Math.round(7500 * 0.35)) // 2625
  assert.equal(creditCostForBlueprint(blueprintIdForAccessory('extra_ore_storage')), Math.round(9000 * 0.35)) // 3150
})

test('ore cost is higher for expensive items', () => {
  const cheapWeapon = WEAPONS.find((w) => w.price > 0)
  const cheapId = blueprintIdForWeapon(cheapWeapon.id)
  const ships = allBlueprints().filter((b) => b.kind === 'ship').sort((a, b) => b.listPrice - a.listPrice)
  const expensiveId = ships[0].id
  const cheapTotal = Object.values(oreCostForBlueprint(cheapId)).reduce((a, b) => a + b, 0)
  const expTotal = Object.values(oreCostForBlueprint(expensiveId)).reduce((a, b) => a + b, 0)
  assert.ok(expTotal > cheapTotal * 2)
})

test('only upper-tier ships need exotic/quantum (rim) ore; weapons/accessories never do', () => {
  const modules = allBlueprints().filter((b) => b.kind === 'weapon' || b.kind === 'accessory')
  for (const w of modules) {
    const c = oreCostForBlueprint(w.id)
    assert.equal(c.exotic_ore, undefined, `${w.itemName} should not need exotic ore`)
    assert.equal(c.quantum_ore, undefined, `${w.itemName} should not need quantum ore`)
    assert.ok((c.raw_ore ?? 0) > 0)
  }

  const ships = allBlueprints().filter((b) => b.kind === 'ship').sort((a, b) => a.listPrice - b.listPrice)
  const prices = ships.map((s) => s.listPrice)
  const logMin = Math.log(prices[0])
  const logMax = Math.log(prices[prices.length - 1])
  const rel = (price) => (Math.log(price) - logMin) / (logMax - logMin)

  let anyExotic = false
  let anyQuantum = false
  for (const s of ships) {
    const c = oreCostForBlueprint(s.id)
    const r = rel(s.listPrice)
    if (r < SHIP_EXOTIC_ORE_FROM_R - 0.02) {
      assert.equal(c.exotic_ore, undefined, `cheap ship ${s.itemName} (r=${r.toFixed(2)}) needs no exotic`)
      assert.equal(c.quantum_ore, undefined, `cheap ship ${s.itemName} needs no quantum`)
    }
    if (r < SHIP_QUANTUM_ORE_FROM_R - 0.02) {
      assert.equal(c.quantum_ore, undefined, `mid ship ${s.itemName} (r=${r.toFixed(2)}) needs no quantum`)
    }
    if ((c.exotic_ore ?? 0) > 0) anyExotic = true
    if ((c.quantum_ore ?? 0) > 0) anyQuantum = true
  }
  assert.ok(anyExotic, 'some high-end ships should need exotic ore')
  assert.ok(anyQuantum, 'top ships should need quantum ore')
  const top = ships[ships.length - 1]
  assert.ok((oreCostForBlueprint(top.id).quantum_ore ?? 0) > 0)
})

test('credit fee is 35% of manufacture budget (~26% of list) — the cash-only path if you mined ore', () => {
  for (const bp of allBlueprints()) {
    const fee = creditCostForBlueprint(bp.id)
    const budget = manufactureBudget(bp.listPrice)
    assert.ok(fee > 0)
    assert.equal(fee, Math.max(1, Math.round(budget * 0.35)))
    // ~26.25% of list; keep under 30% with rounding
    assert.ok(fee <= bp.listPrice * 0.3 + 1)
  }
})

test('startCraft consumes station BP+ore+credits and delivers after wall-clock duration', () => {
  const gs = freshState()
  ensureBlueprintMaps(gs)
  const station = gs.galaxy.systems
    .flatMap((s) => s.bodies)
    .find((b) => b.kind === 'station')
  assert.ok(station)
  gs.player.currentSystemId = gs.galaxy.systems.find((s) => s.bodies.some((b) => b.id === station.id)).id

  const bpId = blueprintIdForWeapon('rapid_laser')
  const cost = oreCostForBlueprint(bpId)
  const fee = creditCostForBlueprint(bpId)
  const storage = (gs.stationStorage[station.id] ??= {
    cargo: {},
    miningHold: {},
    shipParts: 0,
    ships: [],
    weapons: {},
    accessories: {},
    blueprints: {}
  })
  storage.blueprints[bpId] = 1
  for (const [id, qty] of Object.entries(cost)) storage.miningHold[id] = (storage.miningHold[id] ?? 0) + qty
  gs.player.credits = Math.max(gs.player.credits, fee + 1000)

  const job = startCraft(gs, station.id, bpId, 1_000_000)
  assert.equal(storage.blueprints[bpId], undefined)
  assert.equal(gs.player.credits >= 1000, true)

  const done = updateCraftingJobs(gs, job.completesAtWallMs)
  assert.equal(done.length, 1)
  assert.equal(storage.weapons.rapid_laser, 1)
})

test('crafting an accessory delivers into station accessories storage', () => {
  const gs = freshState()
  ensureBlueprintMaps(gs)
  const station = gs.galaxy.systems.flatMap((s) => s.bodies).find((b) => b.kind === 'station')
  gs.player.currentSystemId = gs.galaxy.systems.find((s) => s.bodies.some((b) => b.id === station.id)).id
  const bpId = blueprintIdForAccessory('autopilot')
  const cost = oreCostForBlueprint(bpId)
  const fee = creditCostForBlueprint(bpId)
  const storage = (gs.stationStorage[station.id] ??= {
    cargo: {}, miningHold: {}, shipParts: 0, ships: [], weapons: {}, accessories: {}, blueprints: {}
  })
  storage.blueprints[bpId] = 1
  for (const [id, qty] of Object.entries(cost)) storage.miningHold[id] = (storage.miningHold[id] ?? 0) + qty
  gs.player.credits = fee + 5000
  const job = startCraft(gs, station.id, bpId, 2_000_000)
  updateCraftingJobs(gs, job.completesAtWallMs)
  assert.equal(storage.accessories.autopilot, 1)
})

test('blueprint transfer helpers and drop chances stay sensible', () => {
  assert.ok(WRECK_BLUEPRINT_DROP_CHANCE > 0 && WRECK_BLUEPRINT_DROP_CHANCE < 0.1)
  assert.ok(PROBE_BLUEPRINT_DROP_CHANCE > 0 && PROBE_BLUEPRINT_DROP_CHANCE < 0.05)
  const gs = freshState()
  ensureBlueprintMaps(gs)
  const station = gs.galaxy.systems.flatMap((s) => s.bodies).find((b) => b.kind === 'station')
  gs.player.ship.blueprints[blueprintIdForShip(STARTER_SHIP_CLASS_ID)] = 2
  storeBlueprints(gs, station.id)
  assert.equal(gs.player.ship.blueprints[blueprintIdForShip(STARTER_SHIP_CLASS_ID)], undefined)
  assert.equal(gs.stationStorage[station.id].blueprints[blueprintIdForShip(STARTER_SHIP_CLASS_ID)], 2)
  retrieveBlueprints(gs, station.id)
  assert.equal(gs.player.ship.blueprints[blueprintIdForShip(STARTER_SHIP_CLASS_ID)], 2)
})
