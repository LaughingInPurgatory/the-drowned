import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from './prng.js'
import { generateShipClassRoster, STRONG_ASYMMETRY_CHANCE, MIN_SHIP_BUY_PRICE } from './shipRoster.js'

test('generates the requested count of ship classes with unique ids and names', () => {
  const classes = generateShipClassRoster(mulberry32(1), 43)
  assert.equal(classes.length, 43)
  assert.equal(new Set(classes.map((c) => c.id)).size, 43)
  assert.equal(new Set(classes.map((c) => c.name)).size, 43)
})

test('every generated class has valid hull, stats, hardpoints, and price', () => {
  const classes = generateShipClassRoster(mulberry32(2), 43)
  for (const c of classes) {
    assert.ok(['trader', 'fighter', 'explorer'].includes(c.role))
    assert.ok(c.price >= MIN_SHIP_BUY_PRICE, `${c.id} price ${c.price} < min ${MIN_SHIP_BUY_PRICE}`)
    assert.equal(c.hull.stationWidths.length, c.hull.stationHeights.length)
    assert.ok(c.hull.stationWidths.length >= 12, '12 loft stations for complex hulls')
    assert.ok(c.hull.stationWidths.every((w) => w > 0))
    // 6, not 10: fighter/trader cross-section pools were widened to include
    // 6/8 for low-poly variety (v3.0.0) — 6 is the real floor across all roles.
    assert.ok(c.hull.crossSectionSides >= 6)
    assert.ok(c.hardpoints.length >= 1)
    for (const hp of c.hardpoints) assert.ok(['laser', 'missile'].includes(hp.type))
    for (const stat of Object.values(c.stats)) assert.ok(stat > 0)
    assert.ok(
      Number.isInteger(c.accessorySlots) && c.accessorySlots >= 0 && c.accessorySlots <= 4,
      `${c.id} accessorySlots should be 0–4`
    )
  }
})

test('all three roles appear across a large sample', () => {
  const classes = generateShipClassRoster(mulberry32(3), 43)
  const roles = new Set(classes.map((c) => c.role))
  assert.ok(roles.has('trader') && roles.has('fighter') && roles.has('explorer'))
})

test('strong asymmetry is uncommon (~23%) across a large roster', () => {
  // Raised from 0.05 to 0.14 in v3.0.0 ("enough oddballs that fleets don't
  // look mirrored clones") — still far below the old ~40%, just not as rare
  // as the original 1-in-20 tuning.
  assert.equal(STRONG_ASYMMETRY_CHANCE, 0.14)
  // The measured rate lands well above 14%, not because the constant lied,
  // but because `asymmetric` is also forced true for two archetypes
  // regardless of the roll (catamaran for traders, split for fighters) — see
  // the `archetype === 'catamaran' || archetype === 'split' || rng() < ...`
  // line in shipRoster.js. Seed+count here are fixed, so this is a
  // deterministic value (92/400), not a statistical sample — the tolerance
  // band exists to absorb incidental RNG-consumption drift from unrelated
  // future edits, not run-to-run variance.
  const classes = generateShipClassRoster(mulberry32(99), 400)
  const asym = classes.filter((c) => c.hull.style?.asymmetric).length
  const rate = asym / classes.length
  assert.ok(rate >= 0.15 && rate <= 0.32, `expected ~23% asymmetric, got ${(rate * 100).toFixed(1)}%`)
  // Symmetric hulls keep bridge centered.
  for (const c of classes) {
    if (!c.hull.style?.asymmetric) {
      assert.equal(c.hull.style.bridgeSide, 0)
    }
  }
})
