/**
 * Player law standing + local security helpers.
 *
 * securityRating 0–6: patrol response speed (0 = none).
 * Player lawStanding 0–10: reputation with authorities (start 10).
 *
 * Security is a property of *places*, not the world: each port and outpost
 * carries its own rating, and "how policed is it here" is whichever of them the
 * player is closest to. The open sea between them answers 0, which is why
 * pirates work out deep and harbourmasters do not. `applyLocalSecurity` writes
 * the answer onto the world object once a frame, so every existing caller that
 * asks the region how policed it is keeps working and now gets a local answer.
 */

export const MAX_LAW_STANDING = 10
export const STARTING_LAW_STANDING = 10

/** Shoot-on-sight by police in any 1–6 system. */
export const LAW_POLICE_SOS = 2
/** Also shoot-on-sight by all ships in 3–6 systems. */
export const LAW_TOTAL_SOS = 0
/** Below this, ports in Sec 3–6 waters refuse a berth (outposts still take you). */
export const LAW_STATION_DOCK_MIN = 5

export function ensureLawStanding(gameState) {
  if (gameState.player.lawStanding == null || !Number.isFinite(gameState.player.lawStanding)) {
    gameState.player.lawStanding = STARTING_LAW_STANDING
  }
  gameState.player.lawStanding = Math.max(
    0,
    Math.min(MAX_LAW_STANDING, Math.floor(gameState.player.lawStanding))
  )
  return gameState.player.lawStanding
}

export function getSystemSecurity(system) {
  if (!system) return 0
  const s = system.securityRating
  if (s == null || !Number.isFinite(s)) return 0
  return Math.max(0, Math.min(6, Math.floor(s)))
}

/** Home waters: the inner 30% of the sea (remoteness 0 → 0.3). */
export const CORE_FRAC_MAX = 0.3
/** The deep: outermost 10% of the sea (remoteness ≥ 0.9). */
export const OUTER_RIM_FRAC_MIN = 0.9

/** How far a harbour's patrols reach out to sea. Past this you are on your own. */
export const SECURITY_INFLUENCE_RANGE = 8000

/**
 * Roll security for a place from its remoteness (0 home waters → 1 the deep).
 * - The deep (≥0.9, outermost 10%): always 0
 * - Home waters (<0.3, inner 30%): 80% 3–6, 20% 1–2, never 0
 * - Between: 75% 1–2, remaining 25% split between 0 and 3–6
 */
export function rollSecurityRating(rng, coreFrac) {
  const f = Math.max(0, Math.min(1, Number(coreFrac) || 0))
  if (f >= OUTER_RIM_FRAC_MIN) return 0

  if (f < CORE_FRAC_MAX) {
    if (rng() < 0.8) return 3 + Math.floor(rng() * 4) // 3–6
    return 1 + Math.floor(rng() * 2) // 1–2
  }

  // Mid
  if (rng() < 0.75) return 1 + Math.floor(rng() * 2)
  // 25%: ~40% of that → 0, rest → 3–6
  if (rng() < 0.4) return 0
  return 3 + Math.floor(rng() * 4)
}

/** Law standing loss for attacking innocents only applies in Sec 3–6 waters. */
export function lawPenaltyAppliesInSystem(system) {
  return getSystemSecurity(system) >= 3
}

/**
 * Security rating of the nearest patrolled place, or 0 out on open water.
 * Falls off in steps rather than smoothly: a rating is a response tier, and
 * half a police boat is not a thing.
 */
export function localSecurityAt(world, position) {
  if (!world?.bodies || !position) return 0
  const x = position[0]
  const z = position[2]
  let best = 0
  let bestDistSq = Infinity
  for (const body of world.bodies) {
    const sec = body.securityRating
    if (!sec) continue
    const dx = body.position[0] - x
    const dz = body.position[2] - z
    const distSq = dx * dx + dz * dz
    if (distSq > SECURITY_INFLUENCE_RANGE * SECURITY_INFLUENCE_RANGE) continue
    if (distSq >= bestDistSq) continue
    bestDistSq = distSq
    // Full authority in the anchorage, tapering to nothing at the edge of the
    // patrol range, so running for open water genuinely gets you clear.
    const t = Math.sqrt(distSq) / SECURITY_INFLUENCE_RANGE
    best = Math.max(0, Math.round(sec * (1 - t * t)))
  }
  return Math.max(0, Math.min(6, best))
}

/**
 * Refresh the world's live security from where the player actually is. Called
 * once a frame; everything downstream reads `world.securityRating` exactly as
 * it always did.
 */
export function applyLocalSecurity(world, position) {
  if (!world) return 0
  world.securityRating = localSecurityAt(world, position)
  return world.securityRating
}

/** Seconds until police respond when pirates are fighting the player. */
export function policeResponseDelayS(securityRating) {
  const s = Math.max(0, Math.min(6, securityRating | 0))
  if (s <= 0) return Infinity
  // High security = fast backup; 1–2 arrive late (fight may be over).
  const table = {
    1: 75,
    2: 55,
    3: 32,
    4: 22,
    5: 14,
    6: 8
  }
  return table[s] ?? 40
}

/**
 * Lose law standing for attacking a non-aggressor (they never shot you first).
 * @returns {number} new standing
 */
export function penalizeInnocentAttack(gameState, npcId) {
  ensureLawStanding(gameState)
  // If they already engaged the player, no penalty.
  if (gameState.player.combatEngagedNpcIds?.[npcId]) {
    // Still mark engagement from our shot (combat.js already does).
    return gameState.player.lawStanding
  }
  // Check if they shot us first — combatEngaged is set when they hit us OR we hit them.
  // So for first player shot on innocent, they're not in the map yet when we call this
  // AFTER marking engagement... Call BEFORE marking, or check aggressor flag on NPC.
  return gameState.player.lawStanding
}

/**
 * @param {boolean} theyAttackedFirst — true if NPC already engaged player
 */
export function applyLawPenaltyForAttack(gameState, theyAttackedFirst) {
  ensureLawStanding(gameState)
  if (theyAttackedFirst) return gameState.player.lawStanding
  const prev = gameState.player.lawStanding
  gameState.player.lawStanding = Math.max(0, gameState.player.lawStanding - 1)
  if (gameState.player.lawStanding !== prev) {
    queueLawToast(gameState, -1)
  }
  return gameState.player.lawStanding
}

export function applyLawBonusForPirateKill(gameState) {
  ensureLawStanding(gameState)
  const prev = gameState.player.lawStanding
  gameState.player.lawStanding = Math.min(MAX_LAW_STANDING, gameState.player.lawStanding + 1)
  if (gameState.player.lawStanding !== prev) {
    queueLawToast(gameState, +1)
  }
  return gameState.player.lawStanding
}

/** One-shot toast strings for main.js (flushed each frame). */
function queueLawToast(gameState, delta) {
  const s = gameState.player.lawStanding
  let msg =
    delta < 0
      ? `Security standing −1 → ${s}/${MAX_LAW_STANDING}`
      : `Security standing +1 → ${s}/${MAX_LAW_STANDING}`
  if (delta < 0 && s <= LAW_TOTAL_SOS) {
    msg += ' · OUTLAW (shoot-on-sight in Sec 3–6)'
  } else if (delta < 0 && s <= LAW_POLICE_SOS) {
    msg += ' · police will engage on sight'
  } else if (delta < 0 && s < LAW_STATION_DOCK_MIN) {
    msg += ' · stations in Sec 3–6 will refuse docking'
  }
  gameState._pendingToasts = gameState._pendingToasts ?? []
  gameState._pendingToasts.push(msg)
}

/** Pop queued toast messages (returns array, clears queue). */
export function flushPendingToasts(gameState) {
  const list = gameState?._pendingToasts
  if (!list?.length) return []
  gameState._pendingToasts = []
  return list
}

/** Can the player berth here, given local security + law standing? */
export function canDockWithLaw(gameState, body, system) {
  ensureLawStanding(gameState)
  if (!body) return false
  // Outposts take anyone's money; only a proper harbour checks your papers.
  if (body.kind !== 'port') return true
  const sec = body.securityRating ?? getSystemSecurity(system)
  if (sec < 3) return true
  return gameState.player.lawStanding >= LAW_STATION_DOCK_MIN
}

/** Are police hostile to the player in this system? */
export function policeHostileToPlayer(gameState, system) {
  ensureLawStanding(gameState)
  const sec = getSystemSecurity(system)
  if (sec <= 0) return false
  return gameState.player.lawStanding <= LAW_POLICE_SOS
}

/** Are civilian/pirate/alien NPCs auto-hostile due to outlaw status? */
export function civiliansHostileToPlayer(gameState, system) {
  ensureLawStanding(gameState)
  const sec = getSystemSecurity(system)
  if (sec < 3) return false
  return gameState.player.lawStanding <= LAW_TOTAL_SOS
}
