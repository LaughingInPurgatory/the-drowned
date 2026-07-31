import { spawnNpc, spawnNpcWithClass, clearPositionOfBodies } from './spawner.js'
import { pick } from '../procgen/prng.js'
import { remoteness, findBody, getSystem } from '../procgen/world.js'
import { getGood } from '../data/goods.js'

const PROBEABLE_KINDS = ['island', 'wreckField']
// ponytail: hard cap so a lead chain always terminates; raise only if trails feel short
const MAX_INVESTIGATION_LEADS = 2
const LEAD_REWARD_MULT = 1.05
// Keep leads within the same "reasonable voyage" radius missionTemplates.js
// uses for the initial giver→target placement. Each lead hops off the PREVIOUS
// target, so without re-checking against the harbour that posted the contract a
// chain of hops could walk the player clean across the sea.
const MAX_LEAD_DISTANCE = 24000

/** @type {null|((info: object) => void)} */
let missionCompletedHandler = null

/** UI/audio hook when a mission pays out (floating text + chime in main.js). */
export function setMissionCompletedHandler(fn) {
  missionCompletedHandler = typeof fn === 'function' ? fn : null
}

function pushMissionLog(mission, gameState, kind, text) {
  mission.log ??= []
  mission.log.push({ kind, text, simTime: gameState.simTime ?? 0 })
}

/**
 * Pay out and remove an active mission immediately (no station turn-in).
 * @returns {object|null} summary for toast/UI
 */
export function finishMission(gameState, mission) {
  if (!gameState || !mission) return null
  if (mission.status === 'complete' || mission.status === 'dropped') return null
  if (!gameState.missions.active.some((m) => m.id === mission.id)) return null

  mission.objectiveComplete = true
  mission.status = 'complete'
  gameState.missions.active = gameState.missions.active.filter((m) => m.id !== mission.id)
  const reward = Math.max(0, Math.floor(Number(mission.reward) || 0))
  gameState.player.credits += reward
  gameState.player.reputation = (gameState.player.reputation ?? 0) + 1

  // Drop waypoint if it was locked on this mission's target / free-space hunt.
  const t = mission.target
  if (
    gameState.player.waypointBodyId != null &&
    (gameState.player.waypointBodyId === t?.bodyId ||
      gameState.player.waypointBodyId === mission.giverStationId ||
      gameState.player.waypointBodyId === mission.trade?.destBodyId ||
      gameState.player.waypointBodyId === mission.trade?.originBodyId)
  ) {
    gameState.player.waypointBodyId = null
  }
  if (Array.isArray(gameState.player.waypointPosition) && t?.kind === 'npcShip') {
    gameState.player.waypointPosition = null
  }

  const giverBody = findBody(gameState.galaxy, mission.giverStationId)
  const giverSystem = getSystem(gameState.galaxy, mission.giverSystemId)
  const info = {
    id: mission.id,
    type: mission.type,
    title: mission.title,
    reward,
    giverBodyName: giverBody?.name ?? 'mission board',
    giverSystemName: giverSystem?.name ?? 'unknown system',
    giverStationId: mission.giverStationId,
    giverSystemId: mission.giverSystemId
  }
  try {
    missionCompletedHandler?.(info)
  } catch {
    /* UI hook must not break sim */
  }
  return info
}

/** @deprecated Use finishMission — kept for older tests / callers. */
export function turnInMission(gameState, missionId) {
  const mission = gameState.missions.active.find((m) => m.id === missionId)
  if (!mission) throw new Error('Mission not active')
  return finishMission(gameState, mission)
}

/**
 * Place a probe-stirred hostile outside the surveyed body's shell, biased
 * toward the player so they show up on radar instead of inside the mesh.
 * body.radius can be thousands of units for scaled planets — a fixed offset
 * of tens of units is always buried.
 */
function spawnHostileNearProbedBody(body, playerPosition, rng) {
  const center = body?.position ?? playerPosition
  // Clear exterior / surface shell, then a short combat-standoff so they aren't
  // flush against the crust (and match ambient spawn "just past engagement").
  // Prefer body.radius for planets/moons/belts; stations would use exterior via clearPositionOfBodies.
  const shell = (body?.radius ?? 0) + 200
  let dx = playerPosition[0] - center[0]
  let dy = playerPosition[1] - center[1]
  let dz = playerPosition[2] - center[2]
  let len = Math.hypot(dx, dy, dz)
  if (len < 1e-3) {
    const theta = rng() * Math.PI * 2
    dx = Math.cos(theta)
    dy = 0.15
    dz = Math.sin(theta)
    len = Math.hypot(dx, dy, dz)
  }
  dx /= len
  dy /= len
  dz /= len
  // Small lateral jitter so the contact isn't exactly on the probe-return line.
  const j = (rng() - 0.5) * 0.5
  const jx = -dz * j
  const jz = dx * j
  dx += jx
  dz += jz
  len = Math.hypot(dx, dy, dz) || 1
  dx /= len
  dy /= len
  dz /= len
  const standOff = shell + 100 + rng() * 200
  return [
    center[0] + dx * standOff,
    center[1] + dy * standOff,
    center[2] + dz * standOff
  ]
}

export function acceptMission(gameState, missionId, rng) {
  const mission = gameState.missions.available.find((m) => m.id === missionId)
  if (!mission) throw new Error('Mission not available')

  mission.status = 'active'
  gameState.missions.available = gameState.missions.available.filter((m) => m.id !== missionId)
  gameState.missions.active.push(mission)

  if (mission.type === 'bounty') {
    const system = getSystem(gameState.galaxy, mission.target.systemId)
    const bodies = system?.bodies ?? []
    // Clear of planets/stations (old saves may still have center-of-body hints).
    const position = clearPositionOfBodies(mission.target.locationHint, bodies)
    mission.target.locationHint = position
    const npc = spawnNpcWithClass(rng, {
      shipClassId: mission.target.shipClassId,
      position,
      faction: 'pirate',
      bodies
    })
    npc.missionId = mission.id
    gameState.npcs.push(npc)
    mission.target.npcId = npc.id
  }

  if (mission.type === 'trade') {
    mission.trade ??= {}
    mission.trade.purchased = mission.trade.purchased ?? 0
    mission.trade.sold = mission.trade.sold ?? 0
    const q = mission.trade.quantity ?? 0
    let goodName = mission.trade.goodId ?? 'goods'
    try {
      goodName = getGood(mission.trade.goodId).name
    } catch {
      /* keep id */
    }
    pushMissionLog(
      mission,
      gameState,
      'intel',
      `Buy ${q}× ${goodName} at origin (with your Barter Units), haul to the destination bay and sell. Multiple trips are fine — the contract completes when bought and sold totals reach ${q}.`
    )
  }

  // Exploration can complete if the site was already visited; probe contracts
  // must be re-probed while active (see updateMissionProgress — no prior-probe
  // auto-complete on accept).
  updateMissionProgress(gameState)
}

function refreshTradeMissionComplete(mission, gameState) {
  if (!mission || mission.type !== 'trade' || mission.status === 'complete') return false
  const need = Math.max(0, Math.floor(Number(mission.trade?.quantity) || 0))
  if (need < 1) return false
  const purchased = Math.floor(Number(mission.trade.purchased) || 0)
  const sold = Math.floor(Number(mission.trade.sold) || 0)
  if (purchased < need || sold < need) return false
  pushMissionLog(mission, gameState, 'intel', 'Trade cargo delivered and sold — contract complete')
  finishMission(gameState, mission)
  return true
}

/**
 * Call after the player buys cargo at a bay — advances active trade missions.
 */
/** Sync trade mission nav target for multi-trip buy → haul → sell loops. */
function syncTradeMissionTarget(mission, gameState) {
  if (!mission?.trade) return
  const tr = mission.trade
  const need = Math.max(0, Math.floor(Number(tr.quantity) || 0))
  const purchased = Math.floor(Number(tr.purchased) || 0)
  const sold = Math.floor(Number(tr.sold) || 0)
  // Prefer destination while there is still bought cargo to deliver/sell;
  // otherwise return to origin until the buy quota is filled.
  const goDest = sold < need && purchased > sold
  const next = goDest
    ? { kind: 'body', systemId: tr.destSystemId, bodyId: tr.destBodyId }
    : { kind: 'body', systemId: tr.originSystemId, bodyId: tr.originBodyId }
  mission.target = next
  advanceMissionWaypoint(gameState, mission)
}

/**
 * Call after the player buys cargo at a bay — advances active trade missions.
 * Partial buys count; multi-trip hauls are supported.
 */
export function noteTradePurchase(gameState, bodyId, goodId, quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0))
  if (!gameState || !bodyId || !goodId || qty < 1) return
  for (const mission of [...(gameState.missions?.active ?? [])]) {
    if (mission.type !== 'trade' || mission.status === 'complete') continue
    if (String(mission.trade?.originBodyId) !== String(bodyId)) continue
    if (mission.trade?.goodId !== goodId) continue
    mission.trade.purchased = (mission.trade.purchased ?? 0) + qty
    const need = mission.trade.quantity ?? 0
    const have = mission.trade.purchased
    pushMissionLog(
      mission,
      gameState,
      'intel',
      `Purchased ${qty} at origin (${Math.min(have, need)}/${need}) — multi-trip hauls OK`
    )
    syncTradeMissionTarget(mission, gameState)
    refreshTradeMissionComplete(mission, gameState)
  }
}

/**
 * Call after the player sells cargo at a bay — completes trade missions when
 * cumulative bought (at origin) and sold (at dest) reach the quota.
 * Partial sales count toward multi-trip deliveries.
 */
export function noteTradeSale(gameState, bodyId, goodId, quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0))
  if (!gameState || !bodyId || !goodId || qty < 1) return
  for (const mission of [...(gameState.missions?.active ?? [])]) {
    if (mission.type !== 'trade' || mission.status === 'complete') continue
    if (String(mission.trade?.destBodyId) !== String(bodyId)) continue
    if (mission.trade?.goodId !== goodId) continue
    mission.trade.sold = (mission.trade.sold ?? 0) + qty
    const need = mission.trade.quantity ?? 0
    const have = mission.trade.sold
    pushMissionLog(
      mission,
      gameState,
      'intel',
      `Sold ${qty} at destination (${Math.min(have, need)}/${need})`
    )
    syncTradeMissionTarget(mission, gameState)
    refreshTradeMissionComplete(mission, gameState)
  }
}

// Re-materialize any incomplete mission with an npcShip target in this system
// (bounties + investigation hostiles). NPCs are never persisted.
export function ensureBountyNpcsForSystem(gameState, systemId, rng) {
  const system = getSystem(gameState.galaxy, systemId)
  const bodies = system?.bodies ?? []
  for (const mission of gameState.missions.active) {
    if (mission.objectiveComplete) continue
    if (mission.target.kind !== 'npcShip') continue
    if (mission.target.systemId !== systemId) continue
    if (gameState.npcs.some((n) => n.id === mission.target.npcId)) continue

    const position = clearPositionOfBodies(mission.target.locationHint, bodies)
    mission.target.locationHint = position
    const npc = spawnNpcWithClass(rng, {
      shipClassId: mission.target.shipClassId,
      position,
      faction: 'pirate',
      bodies
    })
    npc.missionId = mission.id
    gameState.npcs.push(npc)
    mission.target.npcId = npc.id
  }
}

export function markBodyVisited(gameState, bodyId) {
  if (!bodyId) return
  const id = String(bodyId)
  gameState.visitedBodyIds ??= []
  if (!gameState.visitedBodyIds.some((x) => String(x) === id)) {
    gameState.visitedBodyIds.push(id)
  }
  // Exploration contracts complete on visit (dock / proximity / probe).
  const done = []
  for (const mission of gameState.missions.active) {
    if (mission.objectiveComplete || mission.status === 'complete') continue
    if (mission.type !== 'exploration') continue
    if (String(mission.target?.bodyId) === id) {
      pushMissionLog(mission, gameState, 'intel', 'Survey site visited — contract complete')
      done.push(mission)
    }
  }
  for (const mission of done) finishMission(gameState, mission)
}

// Distinct from visitedBodyIds: a probe mission requires actually launching a
// probe at the body (main.js's probeBody), not just flying near or docking.
export function markBodyProbed(gameState, bodyId) {
  if (!bodyId) return
  const id = String(bodyId)
  gameState.probedBodyIds ??= []
  if (!gameState.probedBodyIds.some((x) => String(x) === id)) {
    gameState.probedBodyIds.push(id)
  }
  // Probing also counts as visiting for exploration-style survey contracts.
  markBodyVisited(gameState, id)
  // Complete any matching open probe missions right here (don't rely solely on
  // a later updateMissionProgress call that can be skipped while menus/docked).
  const done = []
  for (const mission of gameState.missions.active) {
    if (mission.objectiveComplete || mission.status === 'complete') continue
    if (mission.type !== 'probe') continue
    const targetId = mission.target?.bodyId
    if (targetId != null && String(targetId) === id) {
      pushMissionLog(mission, gameState, 'intel', 'Survey complete — contract complete')
      done.push(mission)
    }
  }
  for (const mission of done) finishMission(gameState, mission)
  // Catch-all for bounties / other progress while menus/docked.
  updateMissionProgress(gameState)
}

function pickInvestigationLead(gameState, mission, rng) {
  const currentSystem = getSystem(gameState.galaxy, mission.target.systemId)
  if (!currentSystem) return null

  // Anchor every lead to where the contract was picked up, not to the previous
  // hop — a chain of "spill to somewhere nearby" moves could otherwise walk the
  // player clean across the sea one lead at a time.
  const anchorBody = findBody(gameState.galaxy, mission.giverStationId)
  const anchor = anchorBody?.position ?? gameState.player.ship.position
  const withinLeadRange = (body) =>
    Math.hypot(body.position[0] - anchor[0], body.position[2] - anchor[2]) <= MAX_LEAD_DISTANCE

  const candidates = []
  const spares = []
  for (const body of currentSystem.bodies) {
    // Anomaly-owned bodies (e.g. a rich salvage patch's synthetic wreck field —
    // see systemScan.js) are scan-only finds, never a mission destination, and
    // one can vanish on the next epoch reshuffle while a mission still points
    // at it.
    if (body.anomalySiteId) continue
    if (!PROBEABLE_KINDS.includes(body.kind)) continue
    if (body.id === mission.target.bodyId) continue
    if (withinLeadRange(body)) candidates.push({ system: currentSystem, body })
    else spares.push({ system: currentSystem, body })
  }

  // Nothing in range of the posting harbour — rather than drop the trail, take
  // the nearest thing outside it.
  if (!candidates.length) {
    if (!spares.length) return null
    spares.sort(
      (a, b) =>
        Math.hypot(a.body.position[0] - anchor[0], a.body.position[2] - anchor[2]) -
        Math.hypot(b.body.position[0] - anchor[0], b.body.position[2] - anchor[2])
    )
    return spares[0]
  }
  return pick(rng, candidates)
}

// Probe hit an active investigation body objective. Outcomes: intel (done),
// hostile (kill to finish), or lead (retarget body). Returns null if this
// body isn't an open investigation target.
export function resolveInvestigationProbe(gameState, bodyId, rng) {
  const mission = gameState.missions.active.find(
    (m) =>
      m.type === 'investigation' &&
      !m.objectiveComplete &&
      m.target.kind === 'body' &&
      String(m.target.bodyId) === String(bodyId)
  )
  if (!mission) return null

  const leads = mission.leads ?? 0
  const roll = rng()
  // After the lead cap, always terminate (intel or hostile).
  let kind
  if (leads >= MAX_INVESTIGATION_LEADS) {
    kind = roll < 0.5 ? 'intel' : 'hostile'
  } else if (roll < 0.4) {
    kind = 'intel'
  } else if (roll < 0.7) {
    kind = 'hostile'
  } else {
    kind = 'lead'
  }

  if (kind === 'lead') {
    const next = pickInvestigationLead(gameState, mission, rng)
    if (!next) {
      kind = 'intel' // nowhere left to trail
    } else {
      mission.leads = leads + 1
      mission.reward = Math.round(mission.reward * LEAD_REWARD_MULT)
      mission.target = { kind: 'body', systemId: next.system.id, bodyId: next.body.id }
      mission.title = `Investigate the signal near ${next.body.name} in ${next.system.name}`
      pushMissionLog(
        mission,
        gameState,
        'lead',
        `Signal relocated → ${next.body.name} · ${next.system.name} (+5% reward)`
      )
      advanceMissionWaypoint(gameState, mission)
      return {
        kind: 'lead',
        mission,
        bodyName: next.body.name,
        systemName: next.system.name
      }
    }
  }

  if (kind === 'hostile') {
    const system = getSystem(gameState.galaxy, mission.target.systemId)
    const body = findBody(gameState.galaxy, bodyId)
    // Must sit outside the body's physical radius — a flat +80 offset used to
    // bury the contact inside scaled planets/moons (radii of thousands).
    let position = spawnHostileNearProbedBody(
      body,
      gameState.player.ship.position,
      rng
    )
    if (system?.bodies?.length) {
      position = clearPositionOfBodies(position, system.bodies)
    }
    const npc = spawnNpc(rng, {
      position,
      faction: 'pirate',
      coreFraction: remoteness(position),
      bodies: system?.bodies
    })
    npc.missionId = mission.id
    gameState.npcs.push(npc)
    mission.target = {
      kind: 'npcShip',
      systemId: mission.target.systemId,
      locationHint: [...position],
      npcId: npc.id,
      shipClassId: npc.shipClassId
    }
    pushMissionLog(mission, gameState, 'hostile', 'Hostile contact stirred by the probe — eliminate to proceed')
    advanceMissionWaypoint(gameState, mission)
    return { kind: 'hostile', mission, npcId: npc.id, position: [...position] }
  }

  pushMissionLog(mission, gameState, 'intel', 'Investigation data recovered — contract complete')
  finishMission(gameState, mission)
  return { kind: 'intel', mission }
}

export function updateMissionProgress(gameState) {
  const probed = (gameState.probedBodyIds ?? []).map(String)
  const visited = (gameState.visitedBodyIds ?? []).map(String)
  const toFinish = []
  // Snapshot — finishMission mutates active mid-loop.
  for (const mission of [...(gameState.missions?.active ?? [])]) {
    if (mission.status === 'complete' || mission.objectiveComplete) continue
    const prevBody = mission.target?.bodyId
    const prevNpc = mission.target?.npcId
    let justDone = false
    if (mission.target?.kind === 'npcShip') {
      const npc = gameState.npcs.find((n) => n.id === mission.target.npcId)
      if (npc?.destroyed) justDone = true
    } else if (mission.type === 'probe') {
      // Do NOT complete from historical probedBodyIds alone — that made accepting
      // a contract on an already-scanned body finish instantly. Completion is only
      // via markBodyProbed() when a probe scan finishes while the mission is active.
    } else if (mission.type === 'exploration') {
      const bodyId = mission.target?.bodyId
      if (bodyId != null && (visited.includes(String(bodyId)) || probed.includes(String(bodyId)))) {
        justDone = true
      }
    }
    // investigation body phase: only resolveInvestigationProbe finishes
    // trade: only noteTradeSale → refreshTradeMissionComplete finishes
    if (justDone) {
      toFinish.push(mission)
      continue
    }
    if (prevBody !== mission.target?.bodyId || prevNpc !== mission.target?.npcId) {
      advanceMissionWaypoint(gameState, mission)
    }
  }
  for (const mission of toFinish) {
    if (mission.type === 'probe' || mission.type === 'exploration') {
      pushMissionLog(mission, gameState, 'intel', 'Objective complete — contract finished')
    } else if (mission.target?.kind === 'npcShip') {
      pushMissionLog(mission, gameState, 'intel', 'Target eliminated — contract complete')
    }
    finishMission(gameState, mission)
  }
}

/**
 * Refresh waypoint when the objective target moves (lead / hostile retarget).
 * Only retargets if the player was tracking this mission (or has no waypoint).
 */
export function advanceMissionWaypoint(gameState, mission) {
  if (!mission || !gameState?.player) return
  if (mission.status === 'complete' || mission.objectiveComplete) return
  const wpBody = gameState.player.waypointBodyId
  const wpPos = gameState.player.waypointPosition
  const hadNoWaypoint = wpBody == null && (wpPos == null || !wpPos.length)
  // Related if waypoint was on prior objective body / free-space hunt.
  const related =
    hadNoWaypoint ||
    wpBody === mission.target?.bodyId ||
    wpBody === mission.giverStationId ||
    wpBody === mission.trade?.originBodyId ||
    wpBody === mission.trade?.destBodyId ||
    mission.target?.kind === 'npcShip' ||
    (Array.isArray(wpPos) && mission.target?.kind === 'npcShip')
  if (!related) return
  try {
    setWaypointForMission(gameState, mission.id)
  } catch {
    // No trackable location — clear stale marker.
    gameState.player.waypointBodyId = null
    gameState.player.waypointPosition = null
  }
}

/**
 * Abandon an active mission: no reward, no rep, remove any mission-bound NPCs
 * (bounty / investigation hostiles).
 */
export function dropMission(gameState, missionId) {
  const mission = gameState.missions.active.find((m) => m.id === missionId)
  if (!mission) throw new Error('Mission not active')

  const npcId = mission.target?.npcId
  gameState.npcs = (gameState.npcs ?? []).filter(
    (n) => n.missionId !== mission.id && n.id !== npcId
  )

  gameState.missions.active = gameState.missions.active.filter((m) => m.id !== missionId)
  mission.status = 'dropped'
}

// Where the player should go next for an active mission (objective only —
// completed contracts are removed immediately, no turn-in phase).
// Bounty / investigation-hostile objectives have no body — only a system +
// world position (live NPC if spawned, else the original locationHint).
export function missionNavTarget(mission, gameState) {
  if (mission.type === 'trade' && mission.trade) {
    const tr = mission.trade
    const need = Math.max(0, Math.floor(Number(tr.quantity) || 0))
    const purchased = Math.floor(Number(tr.purchased) || 0)
    const sold = Math.floor(Number(tr.sold) || 0)
    // Multi-trip: go sell whenever bought > sold; otherwise buy more at origin.
    const goDest = sold < need && purchased > sold
    if (goDest || (purchased >= need && sold < need)) {
      return {
        phase: 'objective',
        systemId: tr.destSystemId,
        bodyId: tr.destBodyId,
        position: null
      }
    }
    return {
      phase: 'objective',
      systemId: tr.originSystemId,
      bodyId: tr.originBodyId,
      position: null
    }
  }

  if (mission.target?.kind === 'body') {
    return {
      phase: 'objective',
      systemId: mission.target.systemId,
      bodyId: mission.target.bodyId,
      position: null
    }
  }
  // npcShip (bounty or investigation hostile)
  let position = mission.target?.locationHint
  if (mission.target?.npcId && gameState.player.currentSystemId === mission.target.systemId) {
    const npc = gameState.npcs.find((n) => n.id === mission.target.npcId && !n.destroyed)
    if (npc) position = npc.position
  }
  return {
    phase: 'objective',
    systemId: mission.target?.systemId,
    bodyId: null,
    position: position ? [...position] : null
  }
}

// Galaxy-map system ids that currently need an orange objective ring.
export function missionMarkedSystemIds(gameState) {
  const ids = new Set()
  for (const mission of gameState.missions.active) {
    if (mission.status === 'complete') continue
    ids.add(missionNavTarget(mission, gameState).systemId)
  }
  return ids
}

// Body ids in a given system that are active mission markers.
export function missionMarkedBodyIds(gameState, systemId) {
  const ids = new Set()
  for (const mission of gameState.missions.active) {
    if (mission.status === 'complete') continue
    const t = missionNavTarget(mission, gameState)
    if (t.systemId === systemId && t.bodyId) ids.add(t.bodyId)
  }
  return ids
}

// Point the player's waypoint at a mission's current nav target.
// Free-space positions (bounty hunts) are only set while already in that
// system — local coords from another system would point at nothing useful.
export function setWaypointForMission(gameState, missionId) {
  const mission = gameState.missions.active.find((m) => m.id === missionId)
  if (!mission) throw new Error('Mission not active')
  const t = missionNavTarget(mission, gameState)
  if (t.bodyId) {
    gameState.player.waypointBodyId = t.bodyId
    gameState.player.waypointPosition = null
    return
  }
  if (t.position && t.systemId === gameState.player.currentSystemId) {
    gameState.player.waypointBodyId = null
    gameState.player.waypointPosition = t.position
    return
  }
  if (t.systemId !== gameState.player.currentSystemId) {
    // Clear local markers; galaxy map orange ring is the cross-system cue.
    gameState.player.waypointBodyId = null
    gameState.player.waypointPosition = null
    return
  }
  throw new Error('Mission has no trackable location')
}
