/**
 * Game clock driven by the host machine's wall clock (Date.now).
 *
 * simTime is seconds since the campaign epoch. While playing unpaused, it
 * tracks real time. On save/load, offline elapsed wall time is added so
 * asteroid respawns, cooldowns, and other simTime-based systems catch up.
 * Industry crafts already use wall-clock timestamps directly.
 */

/** Set simClockOriginMs so current simTime matches wall now. */
export function reanchorGameClock(gameState, nowMs = Date.now()) {
  const t = Math.max(0, gameState.simTime ?? 0)
  gameState.simTime = t
  gameState.simClockOriginMs = nowMs - t * 1000
}

/** New campaign: simTime 0 at wall now. */
export function initGameClock(gameState, nowMs = Date.now()) {
  gameState.simTime = 0
  gameState.simClockOriginMs = nowMs
}

/**
 * While the sim is running (not pause menu), keep simTime = wall elapsed
 * since the campaign epoch. Call once per frame.
 */
export function advanceGameClock(gameState, nowMs = Date.now()) {
  if (gameState.simClockOriginMs == null || !Number.isFinite(gameState.simClockOriginMs)) {
    reanchorGameClock(gameState, nowMs)
  }
  gameState.simTime = Math.max(0, (nowMs - gameState.simClockOriginMs) / 1000)
  return gameState.simTime
}

/**
 * After loading a save: add offline wall seconds to simTime, then re-anchor.
 * @returns {number} offline seconds applied
 */
export function applyOfflineTime(gameState, nowMs = Date.now(), savedAtWallMs = null) {
  const base = Math.max(0, gameState.simTime ?? 0)
  let offlineS = 0
  if (savedAtWallMs != null && Number.isFinite(savedAtWallMs)) {
    offlineS = Math.max(0, (nowMs - savedAtWallMs) / 1000)
  }
  gameState.simTime = base + offlineS
  reanchorGameClock(gameState, nowMs)
  return offlineS
}
