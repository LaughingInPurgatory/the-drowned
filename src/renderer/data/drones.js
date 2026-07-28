// Player airborne combat drones only — small hover gunships that orbit above
// the parent hull and fire projectile guns from altitude. Run off drone bays
// (max 2). NPCs never receive, summon, or operate drones (even on hulls that
// list droneBays). Hulls with drone bays do NOT include drones — buy from the
// Boatyard Armoury.

export const DEFAULT_DRONE_ID = 'stinger_light'

export const DRONES = [
  {
    id: 'stinger_light',
    name: 'Light Combat Drone',
    // Airborne escort: ducted fans, twin chin guns, thin-skinned and fast.
    // Fights above the waterline alongside you — not a second boat.
    armor: 100,
    hull: 40,
    weaponId: 'pulse_laser',
    speed: 145,
    turnRate: 2.9,
    accel: 55,
    // Visual scale relative to a full ship hull mesh.
    meshScale: 0.22,
    color: '#8ab4c8',
    // Bought separately (not free with the hull).
    price: 18500
  }
]

/** Buyable drone types for the shipyard Armoury. */
export function purchasableDrones() {
  return DRONES.filter((d) => (d.price ?? 0) > 0)
}

/** Saves may still store pre-rename drone type ids. */
export const DRONE_ID_ALIASES = {
  asp_light: 'stinger_light'
}

export function resolveDroneId(id) {
  if (id == null || id === '') return id
  return DRONE_ID_ALIASES[id] ?? id
}

export function getDrone(id = DEFAULT_DRONE_ID) {
  const resolved = resolveDroneId(id)
  const d = DRONES.find((x) => x.id === resolved)
  if (!d) throw new Error(`Unknown drone: ${id}`)
  return d
}

/** How many drone bays this hull has (0–2). Use effectiveDroneBayCount for accessories. */
export function droneBayCount(shipClass) {
  const n = Math.floor(Number(shipClass?.droneBays) || 0)
  return Math.max(0, Math.min(2, n))
}
