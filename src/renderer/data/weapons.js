/**
 * Hardpoint weapons.
 *
 * Nothing here is energy. Everything on this sea throws something solid —
 * shells, slugs, harpoons, rocks — because the people who built these boats
 * were scavenging a flooded world, not fabricating coherent light.
 *
 * The two mount categories are still `laser` and `missile` internally: those
 * ids are baked into hull hardpoint data, saves, and the LMB/RMB fire filter.
 * They mean **gun** (flat-trajectory, fast, cheap) and **launcher** (slow,
 * heavy, expensive) — see `MOUNT_LABEL` for what the player is told.
 *
 * `deck_gun` / `harpoon_gun` are the free defaults every mount starts with.
 *
 * Drowned weapons (alien: true) are never sold. Craft only from a rare
 * blueprint off a sunken warship (game/wrecks.js).
 */

/** What each mount type is called in the UI. */
export const MOUNT_LABEL = { laser: 'Gun', missile: 'Launcher' }
/** Plural, for tab headings and fire prompts. */
export const MOUNT_LABEL_PLURAL = { laser: 'Guns', missile: 'Launchers' }

export const WEAPONS = [
  // —— Guns: flat trajectory, high rate, low damage per hit ——
  // `tracer` drives the projectile look (render/projectileMesh.js): a lit
  // tracer round, a dull solid slug, or a tumbling lump of rock.
  { id: 'pulse_laser', name: 'Deck Gun', category: 'laser', damage: 8, speed: 420, cooldownS: 0.42, ttl: 1.6, price: 0, color: '#ffd9a0', tracer: 'shell', report: 'heavy' },
  // Handheld sidearm — same round, report, cadence, and damage as the free
  // ship gun, kept separate so future on-foot weapons have their own ids.
  { id: 'fixo_pistol', name: 'Fixo Pistol', category: 'laser', damage: 8, speed: 420, cooldownS: 0.42, ttl: 1.6, price: 0, color: '#ffd9a0', tracer: 'shell', report: 'heavy', handheld: true },
  { id: 'rapid_laser', name: 'Autocannon', category: 'laser', damage: 5, speed: 480, cooldownS: 0.12, ttl: 1.3, price: 4200, color: '#ffc266', tracer: 'tracer', report: 'rapid' },
  { id: 'burst_laser', name: 'Chain Gun', category: 'laser', damage: 7, speed: 500, cooldownS: 0.09, ttl: 1.2, price: 7800, color: '#ffe0a0', tracer: 'tracer', report: 'rapid' },
  { id: 'beam_laser', name: 'Rivet Gun', category: 'laser', damage: 16, speed: 380, cooldownS: 0.5, ttl: 1.5, price: 13500, color: '#c9b48a', tracer: 'slug', report: 'heavy' },
  { id: 'plasma_cannon', name: 'Stone Catapult', category: 'laser', damage: 34, speed: 190, cooldownS: 1.1, ttl: 3.2, price: 24000, color: '#8a8378', tracer: 'rock', report: 'thump' },

  // —— Launchers: slow, heavy, expensive ——
  { id: 'rocket_pod', name: 'Harpoon Gun', category: 'missile', damage: 30, speed: 200, cooldownS: 0.95, ttl: 4, price: 0, color: '#b9b0a0', tracer: 'harpoon', report: 'launch' },
  { id: 'seeker_missile', name: 'Whaling Harpoon', category: 'missile', damage: 46, speed: 230, cooldownS: 1.1, ttl: 4.5, price: 9500, color: '#d0c4ad', tracer: 'harpoon', report: 'launch' },
  { id: 'torpedo', name: 'Torpedo', category: 'missile', damage: 72, speed: 150, cooldownS: 1.8, ttl: 7, price: 19500, color: '#7d8a92', tracer: 'torpedo', report: 'launch' },

  // —— The Drowned: pre-war military ordnance, salvage-only ——
  { id: 'phase_spit', name: 'Naval Autocannon', category: 'laser', damage: 11, speed: 560, cooldownS: 0.14, ttl: 1.4, price: 0, color: '#e8f0ff', tracer: 'tracer', report: 'rapid', alien: true },
  { id: 'void_lance', name: 'Railgun', category: 'laser', damage: 40, speed: 900, cooldownS: 0.85, ttl: 2.0, price: 28000, color: '#bfe6ff', tracer: 'slug', report: 'crack', alien: true },
  { id: 'neural_sear', name: 'Flechette Battery', category: 'laser', damage: 9, speed: 520, cooldownS: 0.08, ttl: 0.9, price: 16000, color: '#cddbe6', tracer: 'tracer', report: 'rapid', alien: true },
  { id: 'spore_pod', name: 'Depth Charge', category: 'missile', damage: 40, speed: 120, cooldownS: 1.0, ttl: 4.2, price: 0, color: '#5f6b62', tracer: 'drum', report: 'thump', alien: true },
  { id: 'singularity_seed', name: 'Guided Torpedo', category: 'missile', damage: 95, speed: 210, cooldownS: 2.0, ttl: 7.5, price: 42000, color: '#8fa3b0', tracer: 'torpedo', report: 'launch', alien: true }
]

export const BASE_WEAPON_ID = { laser: 'pulse_laser', missile: 'rocket_pod' }
export const ALIEN_BASE_WEAPON_ID = { laser: 'phase_spit', missile: 'spore_pod' }

/** Display name for a mount category. */
export function mountLabel(category, plural = false) {
  const table = plural ? MOUNT_LABEL_PLURAL : MOUNT_LABEL
  return table[category] ?? category
}

export function getWeapon(id) {
  const weapon = WEAPONS.find((w) => w.id === id)
  if (!weapon) throw new Error(`Unknown weapon: ${id}`)
  return weapon
}

export function isAlienWeapon(weaponOrId) {
  if (!weaponOrId) return false
  if (typeof weaponOrId === 'string') {
    try {
      return !!getWeapon(weaponOrId).alien
    } catch {
      return false
    }
  }
  return !!weaponOrId.alien
}

/** Shop / market lists — never includes alien tech. */
export function weaponsForCategory(category) {
  return WEAPONS.filter((w) => w.category === category && !w.alien && !w.handheld)
}

/** All weapons of a mount type including alien (equip / salvage). */
export function allWeaponsForCategory(category) {
  return WEAPONS.filter((w) => w.category === category && !w.handheld)
}

export function purchasableWeapons() {
  return WEAPONS.filter((w) => !w.alien && !w.handheld && w.price > 0)
}

// Every hardpoint starts mounted with its category's free base weapon —
// used for a brand-new/purchased ship's initial ship.equippedWeapons map.
export function defaultLoadoutFor(shipClass) {
  const base = shipClass?.alien ? ALIEN_BASE_WEAPON_ID : BASE_WEAPON_ID
  const loadout = {}
  for (const hp of shipClass.hardpoints) {
    loadout[hp.id] = base[hp.type] ?? base.laser
  }
  return loadout
}
