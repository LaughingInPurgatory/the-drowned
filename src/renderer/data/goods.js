export const GOODS = [
  { id: 'grain', name: 'Grain', basePrice: 12, tagMultipliers: { agricultural: -0.5, industrial: 0.3, poor: -0.2 } },
  // Legacy bulk "ore" — no longer on the Trade goods table (mining uses raw_ore…).
  { id: 'ore', name: 'Ore', basePrice: 40, tagMultipliers: { mining: -0.4, industrial: 0.2, tech: 0.1 } },
  { id: 'machinery', name: 'Machinery', basePrice: 150, tagMultipliers: { industrial: -0.3, tech: -0.1, frontier: 0.4 } },
  { id: 'electronics', name: 'Electronics', basePrice: 220, tagMultipliers: { tech: -0.4, frontier: 0.5, wealthy: -0.1 } },
  { id: 'medicine', name: 'Medicine', basePrice: 90, tagMultipliers: { tech: -0.2, poor: 0.3, frontier: 0.2 } },
  { id: 'luxury_goods', name: 'Luxury Goods', basePrice: 500, tagMultipliers: { wealthy: -0.3, poor: 0.6, frontier: 0.3 } },
  { id: 'weapons', name: 'Weapons', basePrice: 300, tagMultipliers: { military: -0.3, pirate: -0.2, frontier: 0.3 } },
  { id: 'fuel', name: 'Fuel', basePrice: 20, tagMultipliers: { industrial: -0.2, mining: -0.1, frontier: 0.3 } },
  { id: 'textiles', name: 'Textiles', basePrice: 35, tagMultipliers: { agricultural: -0.2, wealthy: 0.1 } },
  { id: 'narcotics', name: 'Narcotics', basePrice: 400, tagMultipliers: { pirate: -0.4, wealthy: 0.2, military: 0.5 } },
  { id: 'survey_data', name: 'Survey Data', basePrice: 1000, tagMultipliers: { tech: 0.5, wealthy: 0.2 } },
  { id: 'raw_ore', name: 'Raw Ore', basePrice: 60, tagMultipliers: { mining: -0.2, industrial: 0.2, tech: 0.1 } },
  { id: 'rich_ore', name: 'Rich Ore', basePrice: 200, tagMultipliers: { mining: -0.15, industrial: 0.2, tech: 0.15 } },
  { id: 'exotic_ore', name: 'Exotic Ore', basePrice: 550, tagMultipliers: { tech: 0.3, wealthy: 0.15 } },
  { id: 'quantum_ore', name: 'Quantum Ore', basePrice: 1400, tagMultipliers: { tech: 0.5, wealthy: 0.25 } },
  { id: 'ship_parts', name: 'Ship Parts', basePrice: 800, tagMultipliers: { tech: -0.2, frontier: 0.3, industrial: -0.1 } }
]

// A rare consumable, not a bulk trade good — kept out of the regular cargo
// listing (see MINED_ORE_GOOD_IDS below) and sold at only a small fraction
// of stations/settlements (see hasShipParts in procgen/galaxy.js). Held as a
// simple count on the ship (game/economy.js's useShipPart), not a cargo slot.
export const SHIP_PARTS_GOOD_ID = 'ship_parts'

// Obtained only by probing (game/probe.js). Stations will buy it, never sell it.
export const SURVEY_DATA_GOOD_ID = 'survey_data'

// Ids mined from asteroid fields (game/mining.js), kept distinct from the
// pre-existing 'ore' good (an ordinary bulk trade commodity) so the two
// never share a cargo pool: mined ore lives in ship.miningHold, not cargo.
export const MINED_ORE_GOOD_IDS = ['raw_ore', 'rich_ore', 'exotic_ore', 'quantum_ore']

// Not station-stocked (no Buy). Survey data is sell-only after transfer to storage.
// Skillbooks are never goods — they live on ship.skillbooks and are loot/train only.
export function isBuyableTradeGood(id) {
  const s = String(id ?? '')
  if (s.startsWith('skillbook') || s.startsWith('skill_book')) return false
  return (
    id !== SHIP_PARTS_GOOD_ID &&
    id !== SURVEY_DATA_GOOD_ID &&
    id !== 'ore' &&
    !MINED_ORE_GOOD_IDS.includes(id)
  )
}

/** Goods shown on the Trade → Goods table (not mined ore / parts / skillbooks). */
export function isTradeListGood(id) {
  const s = String(id ?? '')
  if (s.startsWith('skillbook') || s.startsWith('skill_book')) return false
  return id !== SHIP_PARTS_GOOD_ID && id !== 'ore' && !MINED_ORE_GOOD_IDS.includes(id)
}

export function getGood(id) {
  const good = GOODS.find((g) => g.id === id)
  if (!good) throw new Error(`Unknown good: ${id}`)
  return good
}
