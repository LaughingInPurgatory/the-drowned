export const ON_FOOT_WALK_SPEED = 5.2
export const ON_FOOT_RUN_SPEED = 8.4
// Peak jump height is two-thirds of the previous jump. Horizontal travel is
// compensated in main.js so the shorter airtime does not shorten the leap.
export const ON_FOOT_JUMP_SPEED = 9.6 * Math.sqrt(2 / 3)
export const ON_FOOT_JUMP_TRAVEL_MULTIPLIER = Math.sqrt(3 / 2)
export const ON_FOOT_GRAVITY = 13
export const ON_FOOT_BOARD_RANGE = 24
export const ON_FOOT_BOARD_MARGIN = 8
export const ON_FOOT_STAMINA_DRAIN_S = 5
export const ON_FOOT_STAMINA_RECOVERY_S = 5
export const ON_FOOT_STAMINA_MIN_TO_RUN = 10
export const ON_FOOT_WALK_STEP_INTERVAL_S = 0.43
export const ON_FOOT_RUN_STEP_INTERVAL_S = 0.31

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

/**
 * Move a person across an island surface. `surfaceAt(x, z)` returns ground Y
 * or null outside the walkable land; failed moves slide along the valid axis.
 */
export function updateOnFootMovement(onFoot, keys, dt, surfaceAt, speed = ON_FOOT_WALK_SPEED, preserveY = false) {
  if (!onFoot || !Array.isArray(onFoot.position) || typeof surfaceAt !== 'function') return false
  const step = Math.min(0.1, Math.max(0, finite(dt)))
  const heading = finite(onFoot.heading)
  const forward = { x: Math.sin(heading), z: Math.cos(heading) }
  const right = { x: Math.cos(heading), z: -Math.sin(heading) }
  let forwardInput = 0
  let strafeInput = 0
  if (keys?.has?.('KeyW')) forwardInput += 1
  if (keys?.has?.('KeyS')) forwardInput -= 1
  // Camera/right handedness is opposite the ship's local convention: A is
  // screen-right in the current first-person view and D is screen-left.
  if (keys?.has?.('KeyA')) strafeInput += 1
  if (keys?.has?.('KeyD')) strafeInput -= 1

  let dx = forward.x * forwardInput + right.x * strafeInput
  let dz = forward.z * forwardInput + right.z * strafeInput
  const length = Math.hypot(dx, dz)
  if (length > 1e-6) {
    dx = (dx / length) * speed * step
    dz = (dz / length) * speed * step
  } else {
    dx = 0
    dz = 0
  }

  const x = finite(onFoot.position[0])
  const z = finite(onFoot.position[2])
  let nextX = x
  let nextZ = z
  let nextY = finite(onFoot.position[1])
  const trySurface = (candidateX, candidateZ) => {
    const y = surfaceAt(candidateX, candidateZ)
    return Number.isFinite(y) ? y : null
  }
  const fullY = trySurface(x + dx, z + dz)
  if (fullY != null) {
    nextX = x + dx
    nextZ = z + dz
    if (!preserveY) nextY = fullY
  } else {
    const xY = trySurface(x + dx, z)
    if (xY != null) {
      nextX = x + dx
      if (!preserveY) nextY = xY
    }
    const zY = trySurface(nextX, z + dz)
    if (zY != null) {
      nextZ = z + dz
      if (!preserveY) nextY = zY
    }
  }

  onFoot.position = [nextX, nextY, nextZ]
  onFoot.velocity = [step > 0 ? (nextX - x) / step : 0, 0, step > 0 ? (nextZ - z) / step : 0]
  return Math.hypot(nextX - x, nextZ - z) > 1e-5
}

/** Start a grounded jump. */
export function startOnFootJump(onFoot) {
  if (!onFoot || onFoot.jumping || onFoot.grounded === false) return false
  onFoot.jumping = true
  onFoot.verticalVelocity = ON_FOOT_JUMP_SPEED
  onFoot.jumpTime = 0
  // Keep a stable landing floor if the player travels over the shallow-water
  // boundary while airborne. The old fallback used the current airborne Y,
  // which made an invalid shoreline sample launch the player forever.
  onFoot.jumpGroundY = finite(onFoot.position[1])
  onFoot.grounded = false
  return true
}

/** Integrate the airborne arc and land on the sampled surface height. */
export function updateOnFootJump(onFoot, dt, groundY) {
  if (!onFoot?.jumping || !Array.isArray(onFoot.position)) return false
  const seconds = Math.min(0.1, Math.max(0, finite(dt)))
  const velocity = finite(onFoot.verticalVelocity, ON_FOOT_JUMP_SPEED)
  const floorY = groundY != null && Number.isFinite(Number(groundY))
    ? Number(groundY)
    : finite(onFoot.jumpGroundY, finite(onFoot.position[1]))
  onFoot.position[1] = finite(onFoot.position[1]) + velocity * seconds
  onFoot.verticalVelocity = velocity - ON_FOOT_GRAVITY * seconds
  onFoot.jumpTime = finite(onFoot.jumpTime) + seconds
  if (onFoot.position[1] <= floorY) {
    onFoot.position[1] = floorY
    onFoot.verticalVelocity = 0
    onFoot.jumpTime = 0
    onFoot.jumping = false
    onFoot.grounded = true
    return false
  }
  return true
}

export function withinBoardingRange(onFootPosition, shipPosition, range = ON_FOOT_BOARD_RANGE) {
  if (!Array.isArray(onFootPosition) || !Array.isArray(shipPosition)) return false
  return Math.hypot(
    finite(onFootPosition[0]) - finite(shipPosition[0]),
    finite(onFootPosition[2]) - finite(shipPosition[2])
  ) <= range
}

/** Keep the beach boarding point reachable even beside a broad hull. */
export function boardingRangeForShip(shipRadius) {
  return Math.max(ON_FOOT_BOARD_RANGE, finite(shipRadius) + ON_FOOT_BOARD_MARGIN)
}

/** Return whether this frame may run, including the exhausted recovery lock. */
export function updateOnFootStamina(onFoot, dt, wantsToRun) {
  if (!onFoot) return false
  const seconds = Math.max(0, finite(dt))
  let stamina = Math.max(0, Math.min(100, finite(onFoot.stamina, 100)))
  let running = false
  if (onFoot.runLocked) {
    stamina = Math.min(100, stamina + (10 / ON_FOOT_STAMINA_RECOVERY_S) * seconds)
    if (stamina >= ON_FOOT_STAMINA_MIN_TO_RUN) onFoot.runLocked = false
  } else if (wantsToRun && stamina > 0) {
    running = true
    stamina -= (10 / ON_FOOT_STAMINA_DRAIN_S) * seconds
    if (stamina <= 0) {
      stamina = 0
      onFoot.runLocked = true
    }
  } else {
    stamina = Math.min(100, stamina + (10 / ON_FOOT_STAMINA_RECOVERY_S) * seconds)
  }
  onFoot.stamina = stamina
  onFoot.running = running
  return running
}

/** Choose the small library of Foley families from the island's simple terrain classification. */
export function footstepSurfaceForIsland(archetype, edgeFraction = 0) {
  if (Number(edgeFraction) >= 0.8) return 'sand'
  if (archetype === 'barren' || archetype === 'volcanic' || archetype === 'industrial') return 'stone'
  return 'grass'
}

/** Return the foot sides due this frame; movement code owns playback. */
export function advanceOnFootFootsteps(onFoot, dt, { moving = false, grounded = true, running = false } = {}) {
  if (!onFoot) return []
  const seconds = Math.min(0.1, Math.max(0, finite(dt)))
  const interval = running ? ON_FOOT_RUN_STEP_INTERVAL_S : ON_FOOT_WALK_STEP_INTERVAL_S
  if (!moving || !grounded) {
    onFoot.footstepTimer = 0
    onFoot.footstepMoving = false
    return []
  }
  if (!onFoot.footstepMoving) {
    // Put the first step close to the first stride instead of making the player
    // walk in silence for half a second after pressing W.
    onFoot.footstepTimer = interval * 0.72
    onFoot.footstepMoving = true
  }
  let timer = Math.max(0, finite(onFoot.footstepTimer)) + seconds
  const sides = []
  while (timer >= interval && sides.length < 2) {
    timer -= interval
    sides.push(onFoot.footstepSide === 'R' ? 'R' : 'L')
    onFoot.footstepSide = onFoot.footstepSide === 'R' ? 'L' : 'R'
  }
  onFoot.footstepTimer = timer
  return sides
}
