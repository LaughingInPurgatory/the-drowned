// Buyable ship accessories — fitted into optional accessory slots (not
// hardpoints). Starter Light Runner has one slot; other hulls may have up to 4.

export const MAX_ACCESSORY_SLOTS = 4

/** +200% ore hold while fitted → capacity becomes 3× base. */
export const EXTRA_ORE_STORAGE_ID = 'extra_ore_storage'
export const EXTRA_ORE_STORAGE_BONUS_FRAC = 2

/** +200% cargo hold while fitted → capacity becomes 3× base. */
export const CARGO_UPGRADE_ID = 'cargo_upgrade'
export const CARGO_UPGRADE_BONUS_FRAC = 2

export const EXTRA_DRONE_BAY_ID = 'extra_drone_bay'
export const EXTRA_TURRET_HP_ID = 'extra_turret_hardpoint'
export const EXTRA_LAUNCHER_HP_ID = 'extra_launcher_hardpoint'
export const SHIELD_UPGRADE_ID = 'shield_upgrade'
export const ARMOUR_UPGRADE_ID = 'armour_upgrade'
export const SPEED_UPGRADE_ID = 'speed_upgrade'

/** Fraction added to base shield/armor/speed while upgrade is fitted. */
export const DEFENSE_UPGRADE_FRAC = 0.25
export const SPEED_UPGRADE_FRAC = 0.15

export const ACCESSORIES = [
  {
    id: 'autopilot',
    name: 'Autopilot',
    description:
      'When a multi-hop route is plotted, supercruises to each warp gate, jumps, and continues the chain until you arrive.',
    price: 10000
  },
  {
    id: EXTRA_ORE_STORAGE_ID,
    name: 'Extra Ore Storage',
    description: 'While equipped, expands the ore hold by 200% of the hull’s base capacity (3× total).',
    price: 12000
  },
  {
    id: CARGO_UPGRADE_ID,
    name: 'Cargo Upgrade',
    description: 'While equipped, expands cargo capacity by 200% of the hull’s base (3× total).',
    price: 14000
  },
  {
    id: EXTRA_DRONE_BAY_ID,
    name: 'Extra Drone Bay',
    description: 'Adds one drone bay while equipped (install a drone from storage).',
    price: 18000
  },
  {
    id: EXTRA_TURRET_HP_ID,
    name: 'Extra Turret Hardpoint',
    description:
      'Adds one laser hardpoint while equipped — even on hulls that have none. Removing it drops the mount; any fitted weapon returns to station storage.',
    price: 22000
  },
  {
    id: EXTRA_LAUNCHER_HP_ID,
    name: 'Extra Launcher Hardpoint',
    description:
      'Adds one missile hardpoint while equipped — even on hulls that have none. Removing it drops the mount; any fitted weapon returns to station storage.',
    price: 24000
  },
  {
    id: SHIELD_UPGRADE_ID,
    name: 'Shield Upgrade',
    description: 'Raises max shields by 25% of the hull’s base while equipped.',
    price: 16000
  },
  {
    id: ARMOUR_UPGRADE_ID,
    name: 'Armour Upgrade',
    description: 'Raises max armour by 25% of the hull’s base while equipped.',
    price: 16000
  },
  {
    id: SPEED_UPGRADE_ID,
    name: 'Speed Upgrade',
    description: 'Raises max speed by 15% of the hull’s base while equipped.',
    price: 15000
  }
]

export function getAccessory(id) {
  const acc = ACCESSORIES.find((a) => a.id === id)
  if (!acc) throw new Error(`Unknown accessory: ${id}`)
  return acc
}

export function accessorySlotCount(shipClass) {
  const n = shipClass?.accessorySlots ?? 0
  return Math.max(0, Math.min(MAX_ACCESSORY_SLOTS, Math.floor(n)))
}

/** Empty loadout array sized to the class's accessory slots. */
export function defaultAccessoriesFor(shipClass) {
  return Array(accessorySlotCount(shipClass)).fill(null)
}

/**
 * Resize / pad an equippedAccessories array to match the class slot count.
 * Returns { equipped, excess } where excess are accessory ids that no longer fit.
 */
export function normalizeAccessories(equipped, shipClass) {
  const n = accessorySlotCount(shipClass)
  const prev = Array.isArray(equipped) ? equipped : []
  const next = Array(n).fill(null)
  const excess = []
  for (let i = 0; i < prev.length; i++) {
    const id = prev[i]
    if (!id) continue
    if (i < n) next[i] = id
    else excess.push(id)
  }
  return { equipped: next, excess }
}

export function shipHasAccessory(ship, accessoryId) {
  if (!ship || !accessoryId) return false
  const eq = ship.equippedAccessories
  if (!Array.isArray(eq)) return false
  return eq.includes(accessoryId)
}

export function shipHasAutopilot(ship) {
  return shipHasAccessory(ship, 'autopilot')
}

/**
 * Ore hold capacity with accessories applied.
 * Extra Ore Storage: +200% of base while equipped (3× total).
 */
export function effectiveMiningCapacity(ship, shipClass) {
  const base = shipClass?.stats?.miningCapacity ?? 0
  if (shipHasAccessory(ship, EXTRA_ORE_STORAGE_ID)) {
    return Math.round(base * (1 + EXTRA_ORE_STORAGE_BONUS_FRAC))
  }
  return base
}

/** Cargo capacity with Cargo Upgrade (+200% → 3× base). */
export function effectiveCargoCapacity(ship, shipClass) {
  const base = shipClass?.stats?.cargoCapacity ?? 0
  if (shipHasAccessory(ship, CARGO_UPGRADE_ID)) {
    return Math.round(base * (1 + CARGO_UPGRADE_BONUS_FRAC))
  }
  return base
}

export function effectiveMaxShields(ship, shipClass) {
  const base = shipClass?.stats?.shields ?? 0
  if (shipHasAccessory(ship, SHIELD_UPGRADE_ID)) {
    return Math.round(base * (1 + DEFENSE_UPGRADE_FRAC))
  }
  return base
}

export function effectiveMaxArmor(ship, shipClass) {
  const base = shipClass?.stats?.armor ?? 0
  if (shipHasAccessory(ship, ARMOUR_UPGRADE_ID)) {
    return Math.round(base * (1 + DEFENSE_UPGRADE_FRAC))
  }
  return base
}

export function effectiveMaxSpeed(ship, shipClass) {
  const base = shipClass?.stats?.speed ?? 0
  if (shipHasAccessory(ship, SPEED_UPGRADE_ID)) {
    return base * (1 + SPEED_UPGRADE_FRAC)
  }
  return base
}

/** Base drone bays from hull + optional Extra Drone Bay accessory. */
export function effectiveDroneBayCount(ship, shipClass) {
  const base = Math.max(0, Math.floor(Number(shipClass?.droneBays) || 0))
  const bonus = shipHasAccessory(ship, EXTRA_DRONE_BAY_ID) ? 1 : 0
  // Hulls max 2 intrinsic; accessory may push to 3.
  return Math.min(3, base + bonus)
}

/**
 * Hardpoints for combat/equip: class mounts + optional accessory turrets/launchers.
 * Synthetic mounts use stable ids so equippedWeapons survives equip/unequip.
 */
export function effectiveHardpoints(ship, shipClass) {
  const base = Array.isArray(shipClass?.hardpoints) ? shipClass.hardpoints : []
  const extra = []
  if (shipHasAccessory(ship, EXTRA_TURRET_HP_ID)) {
    extra.push({
      id: 'acc_turret',
      type: 'laser',
      position: [1.1, 0.35, 6.5],
      accessory: true
    })
  }
  if (shipHasAccessory(ship, EXTRA_LAUNCHER_HP_ID)) {
    extra.push({
      id: 'acc_launcher',
      type: 'missile',
      position: [-1.1, 0.2, 5.5],
      accessory: true
    })
  }
  return extra.length ? [...base, ...extra] : base
}
