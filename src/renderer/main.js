import * as THREE from 'three'
import { createScene } from './render/scene.js'
import { createStarfield, updateStarfield, setStarfieldStarTint } from './render/starfield.js'
import { createMotionEffects, updateStarfieldMotion } from './render/motionFx.js'
import { createHyperspaceTunnel } from './render/hyperspaceTunnel.js'
import {
  buildWarpGateMesh,
  updateWarpGateMesh,
  orientWarpGateTowardOrigin
} from './render/warpGateMesh.js'
import { createNebula, updateNebula } from './render/nebula.js'
import { buildShipMesh, updatePoliceLights, getEngineNozzleLocals } from './render/shipMesh.js'
import { buildStationMeshForBody, updateStationMesh } from './render/stationMesh.js'
import { preloadStationModels, stationModelsReady } from './render/stationModels.js'
import { buildPlanetMesh, updatePlanetAtmosphere } from './render/planetMesh.js'
import { buildStarMesh, updateStarMesh } from './render/starMesh.js'
import { createLensFlare } from './render/lensFlare.js'
import { buildAsteroidFieldMesh, getAsteroidRocks } from './render/asteroidFieldMesh.js'
import { buildProjectileMesh, buildImpactFlash, preloadProjectileMeshes } from './render/projectileMesh.js'
import {
  buildStationInteriorMesh,
  updateStationInterior,
  INTERIOR_WORLD_SCALE
} from './render/stationInterior.js'
import { preloadInteriorModels } from './render/interiorModels.js'
import { buildWreckMesh, updateWreckMesh } from './render/wreckMesh.js'
import { buildProbeMesh, updateProbeMesh } from './render/probeMesh.js'
import {
  syncMeshToEntity,
  syncChaseCamera,
  snapChaseCamera,
  resetChaseCameraState,
  getShipAimPoint,
  AIM_LOOK_AHEAD,
  adjustChaseZoom,
  resetChaseZoom,
  setChaseFreeLook,
  addChaseFreeLookDelta,
  isChaseFreeLook,
  setChaseIdleOrbit
} from './render/sceneSync.js'
import { createThrusterEffects, createLiteThrusterEffects } from './render/thrusterParticles.js'
import { createDamageEffects } from './render/damageEffects.js'
import { createOreScoopEffects } from './render/oreScoopParticles.js'
import {
  spawnRockExplosion,
  spawnShipExplosion,
  updateRockExplosion,
  disposeRockExplosion
} from './render/rockExplosionFx.js'
import { spawnHitImpact, updateHitImpact, disposeHitImpact, preloadHitImpactFx } from './render/hitImpactFx.js'
import { createMissileTrailSystem } from './render/missileTrailFx.js'
import { createGameState } from './game/state.js'
import {
  CANONICAL_GALAXY_SEED,
  WHISPERS_SYSTEM_NAME,
  generateGalaxy
} from './procgen/galaxy.js'
import { DEV_TEST_SETUP, createDevTestGameState } from './game/devTestSetup.js'

import { advanceGameClock, reanchorGameClock } from './game/gameClock.js'
import { createInputState, createMouseAimState, updateFlight } from './game/flight.js'
import { effectiveMaxSpeed, effectiveMaxShields, effectiveMaxArmor } from './data/accessories.js'
import { updateSupercruise, ignoreBodyAsCruiseObstacle } from './game/supercruise.js'
import {
  spawnEncounterNear,
  spawnPoliceResponse,
  ensureStationPolicePatrols,
  spawnMiningPirateAmbush
} from './game/spawner.js'
import { playerSkillBonuses, ensureSkills, getSkillDef } from './game/skills.js'
import {
  fireProjectile,
  updateProjectiles,
  prunePlayerLasersOffBoresight,
  updateNpcAI,
  updateCombatFlag,
  prepareCombatFrame,
  regenShields,
  getShipCollisionRadius,
  truceActive,
  pruneCombatEngagement,
  playerFightingPirates,
  flushPendingLawPenalties
} from './game/combat.js'
import {
  ensureLawStanding,
  canDockWithLaw,
  policeHostileToPlayer,
  civiliansHostileToPlayer,
  getSystemSecurity,
  policeResponseDelayS,
  flushPendingToasts
} from './game/security.js'
import {
  resolveBodyCollisions,
  trySupercruiseTunnel,
  collisionRadiusFor,
  exteriorRadiusFor,
  rockCollisionRadius
} from './game/collision.js'
import {
  mineRock,
  isRockAlive,
  rockDisplayName,
  rockOreRemaining,
  rockOreMax,
  isFieldDepleted,
  fieldRespawnRemainingS,
  formatRespawnTime,
  rollMiningPirateAmbush
} from './game/mining.js'
import { pruneWrecks, lootWreck, spawnWreck } from './game/wrecks.js'
import { updateCraftingJobs, ensureBlueprintMaps } from './game/crafting.js'
import { getBlueprint } from './data/blueprints.js'
import {
  markBodyVisited,
  markBodyProbed,
  updateMissionProgress,
  missionMarkedBodyIds,
  resolveInvestigationProbe,
  setMissionCompletedHandler
} from './game/missions.js'
import {
  launchProbe,
  canProbeBody,
  recordProbeAttempt,
  isActiveMissionProbeTarget,
  isMissionOnlyReprobe,
  probeAttemptCount,
  probeSurveyReport,
  probeExhaustedMessage,
  MAX_PROBE_ATTEMPTS
} from './game/probe.js'
import { saveGame as persistSaveGame, loadGame as persistLoadGame, hasSave } from './game/save.js'
import {
  hyperspaceJump,
  warpArrivalNearExitGate,
  warpGateOutwardDir,
  quatFacingSun as quatFacingFromTo
} from './game/hyperspace.js'
import {
  getSystem,
  findBody,
  findSystemOfBody,
  coreFraction,
  canJumpTo,
  ensureSystemSecurity,
  ensureWarpGates,
  findWarpGateTo,
  findNearbyWarpGate,
  isNearWarpGate,
  WARP_GATE_ACTIVATION_RANGE,
  WHISPERS_STATION_NAME
} from './procgen/galaxy.js'
import { createHud } from './ui/hud.js'
import { createDockingUI } from './ui/dockingUI.js'
import { createMenu } from './ui/menu.js'
import { createPauseMenu } from './ui/pauseMenu.js'
import { createNavMap } from './ui/navMap.js'
import { createSystemOverview } from './ui/systemOverview.js'
import { createSystemScanMap } from './ui/systemScanMap.js'
import { createDatacoreMinigame } from './ui/datacoreMinigame.js'
import { createInventoryUI } from './ui/inventoryUI.js'
import { createMissionsUI } from './ui/missionsUI.js'
import { createCharacterUI } from './ui/characterUI.js'
import { createDeathScreen } from './ui/deathScreen.js'
import {
  ensureSystemAnomalies,
  getAnomaly,
  overviewAnomalies,
  pruneAnomalies,
  tickGalaxyAnomalies,
  isDatacoreType
} from './game/systemScan.js'
import {
  SITE_ACTIVATION_RANGE,
  NODULE_PROBE_RANGE,
  spawnAlienIncursionWave,
  spawnGuardWave,
  applyAlienBaseKill,
  applyDatacoreNoduleSuccess,
  applyDatacoreNoduleFail,
  grantLootToShip
} from './game/anomalySites.js'
import {
  buildDatacoreSiteMesh,
  updateDatacoreSiteMesh,
  buildAlienBaseMesh,
  updateAlienBaseMesh,
  disposeAnomalySiteMesh
} from './render/anomalySiteMesh.js'
import { gameConfirm, gameNotice } from './ui/gameDialog.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from './data/shipClasses.js'
import { getGood } from './data/goods.js'
import { getWeapon, WEAPONS } from './data/weapons.js'
import { shipHasAutopilot } from './data/accessories.js'
import {
  ensureDrones,
  summonDrones,
  recallDrones,
  teleportDronesToBay,
  updateDrones,
  damageDrone,
  livingDeployedDrones,
  hasDroneBays,
  DRONE_SHOT_SPEED_FALLBACK
} from './game/drones.js'
import { buildHailResponse } from './game/hail.js'
import { buildDroneMesh, updateDroneMesh, disposeDroneMesh } from './render/droneMesh.js'
import { droneBayCount } from './data/drones.js'
import * as audio from './audio.js'
import {
  applyLocalSoundCache,
  loadSoundPreference,
  applyLocalUiThemeCache,
  loadUiThemePreference
} from './preferences.js'

window.addEventListener('error', (e) => console.error('uncaught error:', e.message, e.error?.stack))

// Instant restore of last sound choice (localStorage) before title music starts;
// Electron settings.json is reconciled right after and is the long-term default.
applyLocalSoundCache()
// UI accent colour (localStorage) before first menu paint.
applyLocalUiThemeCache()

// Docking approach range for stations/settlements (metres from body origin).
// Docking approach range for stations/settlements (metres from body origin).
const DOCK_RANGE = 4000
const DOCK_RANGE_COLLISION_MARGIN = 12
// Probe "in orbit" shells (fixed body layout — no orbital carry/drag).
// Beyond collision shell for Tab-target planet/moon orbit probes (was 900 — too tight on large worlds).
const PROBE_ORBIT_MARGIN = 12000
const STAR_ORBITAL_CARRY_RADIUS = 168000
// Stations/settlements +50% on prior 11.25 scale; collision.js matches.
// Free-model stations are normalized to ~26–30 local units, then this
// multiplies them into world space. Large behemoths next to ships.
const STATION_SCALE = 190
// Settlements stay small surface bases (pre-behemoth station scale × 0.55).
const SETTLEMENT_SCALE = 16.875 * 0.55
// Surface-distance for flyby / belt probes (was 150 — required hugging the crust).
const PROBE_RANGE = 6000
const MINING_TOAST_DURATION_S = 1.6
const FACTION_TOAST_DURATION_S = 4
// Title-screen-style chromatic glitch for floating HUD text (no soft fades).
const HUD_GLITCH_EXIT_MS = 420
const HUD_GLITCH_STYLE = `
.hud-glitch-text {
  position: relative; display: inline-block; max-width: 100%;
}
.hud-glitch-text::before,
.hud-glitch-text::after {
  content: attr(data-text);
  position: absolute; left: 0; top: 0; width: 100%;
  color: inherit; font: inherit; letter-spacing: inherit;
  white-space: inherit; text-align: inherit; text-shadow: inherit;
  opacity: 0; pointer-events: none; overflow: hidden;
}
.hud-glitch-text::before {
  clip-path: polygon(0 0, 100% 0, 100% 42%, 0 42%);
  filter: hue-rotate(-55deg);
  animation: hudGlitchTop 5.8s steps(1) infinite;
}
.hud-glitch-text::after {
  clip-path: polygon(0 58%, 100% 58%, 100% 100%, 0 100%);
  filter: hue-rotate(160deg);
  animation: hudGlitchBottom 5.8s steps(1) infinite;
}
@keyframes hudGlitchTop {
  0%, 90%, 100% { opacity: 0; transform: translate(0, 0); }
  91% { opacity: 0.9; transform: translate(-4px, -1px); }
  92% { opacity: 0.85; transform: translate(5px, 1px); }
  93% { opacity: 0; transform: translate(0, 0); }
  96% { opacity: 0.7; transform: translate(3px, 0); }
  97% { opacity: 0; transform: translate(0, 0); }
}
@keyframes hudGlitchBottom {
  0%, 90%, 100% { opacity: 0; transform: translate(0, 0); }
  91% { opacity: 0.9; transform: translate(5px, 1px); }
  92% { opacity: 0.85; transform: translate(-4px, -1px); }
  93% { opacity: 0; transform: translate(0, 0); }
  96% { opacity: 0.7; transform: translate(-3px, 0); }
  97% { opacity: 0; transform: translate(0, 0); }
}
.hud-glitch-enter {
  animation: hudGlitchEnter 0.42s steps(2) both;
}
@keyframes hudGlitchEnter {
  0% { opacity: 0; transform: skewX(12deg) translateX(-7px); filter: blur(1px); }
  18% { opacity: 1; transform: skewX(-9deg) translateX(5px); filter: blur(0); }
  36% { opacity: 0.25; transform: skewX(6deg) translateX(-4px); }
  52% { opacity: 1; transform: skewX(-3deg) translateX(2px); }
  68% { opacity: 0.55; transform: skewX(2deg) translateX(-1px); }
  100% { opacity: 1; transform: none; filter: none; }
}
.hud-glitch-exit {
  animation: hudGlitchExit 0.4s steps(2) both;
}
@keyframes hudGlitchExit {
  0% { opacity: 1; transform: none; }
  22% { opacity: 1; transform: skewX(-11deg) translateX(6px); }
  44% { opacity: 0.15; transform: skewX(9deg) translateX(-9px); }
  62% { opacity: 0.8; transform: skewX(-5deg) translateX(3px); }
  100% { opacity: 0; transform: skewX(7deg) translateX(12px); filter: blur(1px); }
}
`
let hudGlitchStyleInjected = false
function ensureHudGlitchStyle() {
  if (hudGlitchStyleInjected) return
  const style = document.createElement('style')
  style.textContent = HUD_GLITCH_STYLE
  document.head.appendChild(style)
  hudGlitchStyleInjected = true
}

const hudGlitchHideTimers = new WeakMap()

function ensureHudGlitchSpan(el) {
  if (!el) return null
  ensureHudGlitchStyle()
  let span = el.querySelector(':scope > .hud-glitch-text')
  if (!span) {
    span = document.createElement('span')
    span.className = 'hud-glitch-text'
    while (el.firstChild) span.appendChild(el.firstChild)
    el.appendChild(span)
  }
  return span
}

function setHudGlitchText(el, text) {
  const span = ensureHudGlitchSpan(el)
  if (!span) return
  span.textContent = text
  span.dataset.text = text
}

function showHudGlitch(el) {
  if (!el) return
  ensureHudGlitchStyle()
  clearTimeout(hudGlitchHideTimers.get(el))
  el.style.display = 'block'
  // Keep probe-info opacity from .float-info-text (don't force full opacity).
  el.style.removeProperty('opacity')
  const span = ensureHudGlitchSpan(el)
  if (!span) return
  span.classList.remove('hud-glitch-exit', 'hud-glitch-enter')
  // Restart enter animation next frame — never force layout (offsetWidth) mid-combat.
  requestAnimationFrame(() => {
    if (!span.isConnected || el.style.display === 'none') return
    span.classList.add('hud-glitch-enter')
  })
}

function hideHudGlitch(el) {
  if (!el || el.style.display === 'none') return
  const span = ensureHudGlitchSpan(el)
  if (!span) {
    el.style.display = 'none'
    return
  }
  span.classList.remove('hud-glitch-enter', 'hud-glitch-exit')
  requestAnimationFrame(() => {
    if (!span.isConnected) return
    span.classList.add('hud-glitch-exit')
  })
  clearTimeout(hudGlitchHideTimers.get(el))
  const t = setTimeout(() => {
    el.style.display = 'none'
    span.classList.remove('hud-glitch-exit')
  }, HUD_GLITCH_EXIT_MS)
  hudGlitchHideTimers.set(el, t)
}

const AMBIENT_SPAWN_INTERVAL_S = 90
const AMBIENT_NPC_CAP = 3
// Ship/wreck/rock radar contacts (planets/waypoint may still paint farther).
// 10 km (1 unit = 1 m).
const RADAR_RANGE = 10000
// Floating prompts sit just under the top-center ship status panel.
// Fallback when the panel is hidden (docked) or not measured yet.
const FLOAT_HUD_BAND_FALLBACK_TOP_PX = 110
function getFloatHudBandTopPx() {
  const panel = document.querySelector('#hud .status-panel')
  if (panel) {
    const cs = getComputedStyle(panel)
    if (cs.display !== 'none' && cs.visibility !== 'hidden') {
      const bottom = panel.getBoundingClientRect().bottom
      if (Number.isFinite(bottom) && bottom > 0) return Math.round(bottom + 8)
    }
  }
  return FLOAT_HUD_BAND_FALLBACK_TOP_PX
}
const IMPACT_FLASH_TTL = 0.25
// Warp-gate jump: fly into origin aperture → spool/tunnel → emerge from dest aperture.
const JUMP_ENTER_GATE_S = 1.55
const JUMP_WINDUP_S = 1.15
const JUMP_STREAK_S = 3.6
const JUMP_EXIT_GATE_S = 1.45
const JUMP_TUNNEL_DURATION_S = JUMP_WINDUP_S + JUMP_STREAK_S
// Black veil: fade in before the system swap (streak s = 0–1), then hold until
// tunnel end — reveal during exit-gate flight, then arrival flash.
const JUMP_BLACK_FADE_IN_START = 0.28
const JUMP_BLACK_FADE_IN_END = 0.4
// Arrival flash (white/cyan) after the ship clears the destination gate.
const JUMP_ARRIVAL_FLASH_PEAK = 0.85
const JUMP_ARRIVAL_FLASH_DECAY_S = 0.55
const BASE_FOV = 60
// Supercruise FOV (degrees) — wider than base for speed read.
const CRUISE_FOV = 100

const CROSSHAIR_DISTANCE = 80

// Approach + bay glide; three-phase so approach / hang-align / park all read.
const DOCK_ANIM_DURATION_S = 4.4
// Extra clearance beyond the body's collision shell for the exterior hang
// point — the old flat 18 was deep *inside* station/planet radii (~100–200+).
const DOCK_EXTERIOR_MARGIN = 28
const UNDOCK_BACKOFF_MARGIN = 70
const DOCK_FLASH_FADE_S = 0.65
const HYPERSPACE_FLASH_COLOR = '#c8f0ff'
const DOCK_FLASH_COLOR = 'var(--ui-glow)'
// Min standoff past the collision shell when the dock bubble is large enough
// (stations/settlements have +2000m). Avoids bouncing off the body on drop-out.
const SUPERCRUISE_ARRIVAL_MIN_CLEAR = 220
// How far inside the dock shell to still count as "in range" after SC drop.
const SUPERCRUISE_DOCK_INNER_SLACK = 120
// A dedicated coordinate region for the docking-bay interior, far enough
// from any system-local coordinates (which top out around 2200) that it can
// never overlap real flight space.
const DOCKING_BAY_ORIGIN = new THREE.Vector3(2_000_000, 0, 0)
// Match stationInterior INTERIOR_WORLD_SCALE so park/entry stay inside the bay.
const BAY_ENTRY_OFFSET = new THREE.Vector3(0, 0, -55 * INTERIOR_WORLD_SCALE)
const BAY_PARK_OFFSET = new THREE.Vector3(0, 0, 20 * INTERIOR_WORLD_SCALE)
// Probe flight: fly out → scan 10s → return → yield results.
const PROBE_OUTBOUND_S = 2.6
const PROBE_SCAN_S = 10
const PROBE_RETURN_S = 2.4
const PROBE_SCAN_STANDOFF = 18

const appEl = document.getElementById('app')
const { scene, camera, renderer, render, setSunColor, setPostOverlay } = createScene(appEl)
const starfield = createStarfield()
scene.add(starfield)
const motionFx = createMotionEffects(appEl)
scene.add(motionFx.group)
const hyperspaceTunnel = createHyperspaceTunnel()
scene.add(hyperspaceTunnel.group)
const nebula = createNebula()
scene.add(nebula)

// Ortho HUD in NDC (-1..1). Circle must be scaled by aspect or it looks
// squashed wide on landscape viewports (equal NDC ≠ equal pixels).
const hudScene = new THREE.Scene()
const hudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10)
const _hudReticleMat = new THREE.MeshBasicMaterial({
  color: 0x7fe0a0,
  transparent: true,
  opacity: 0.92,
  depthTest: false,
  depthWrite: false,
  side: THREE.DoubleSide
})
// Unit ring; updateCrosshair sets scale for a round ~16px reticle (no drop-shadow).
const hudReticleRing = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), _hudReticleMat)
const hudReticleDot = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), _hudReticleMat.clone())
hudReticleRing.position.z = -1
hudReticleDot.position.z = -1
hudScene.add(hudReticleRing, hudReticleDot)
hudReticleRing.visible = false
hudReticleDot.visible = false

// Screen-space lens flare for the local sun, drawn after bloom/tone mapping
// (render/lensFlare.js explains why it is an overlay and not scene geometry).
const lensFlare = createLensFlare()
const _flareStarPos = new THREE.Vector3()
const _flareToStar = new THREE.Vector3()
const _flareToBody = new THREE.Vector3()

/**
 * 0 = sun fully blocked, 1 = clear line of sight. A ray/sphere test against the
 * system's own bodies, which is both cheaper and steadier than the GPU
 * occlusion probe the old three.js Lensflare did every frame.
 */
function starFlareOcclusion(starPos) {
  const toStar = _flareToStar.copy(starPos).sub(camera.position)
  const starDist = toStar.length()
  if (starDist < 1e-3) return 1
  toStar.divideScalar(starDist)
  let visibility = 1
  for (const [id, mesh] of bodyMeshes) {
    const body = findBody(gameState.galaxy, id)
    const radius = body?.radius
    if (!radius) continue
    const toBody = _flareToBody.copy(mesh.position).sub(camera.position)
    const along = toBody.dot(toStar)
    // Behind us, or further than the sun — cannot block it.
    if (along <= 0 || along >= starDist) continue
    const perp = Math.sqrt(Math.max(0, toBody.lengthSq() - along * along))
    // Soft edge so the flare fades across a limb instead of popping off.
    visibility = Math.min(visibility, THREE.MathUtils.smoothstep(perp, radius * 0.85, radius * 1.25))
    if (visibility <= 0) break
  }
  return visibility
}

function updateLensFlareOverlay() {
  const primary = starMesh?.userData?.stars?.[0]
  if (!primary || docked) {
    lensFlare.setVisible(false)
    return
  }
  primary.group.getWorldPosition(_flareStarPos)
  const el = renderer.domElement
  const aspect = Math.max(0.01, el.clientWidth / Math.max(1, el.clientHeight))
  lensFlare.update(
    _flareStarPos,
    camera,
    aspect,
    primary.color ?? null,
    gameState ? starFlareOcclusion(_flareStarPos) : 1
  )
}

// Recomputed inside the overlay rather than up in animate() so it always uses
// the exact camera pose this frame was rendered with — updating it earlier
// leaves the flare a frame behind and it visibly swims during fast turns.
setPostOverlay((r) => {
  updateLensFlareOverlay()
  if (!lensFlare.visible) return
  r.render(lensFlare.scene, lensFlare.camera)
})

// Escape while pointer-locked often only unlocks the cursor (keydown may not
// fire). Suppress auto-pause when we exit lock ourselves (menus / Space).
let suppressPointerUnlockPause = false
/** Alt held for free-look; free-look only activates once the mouse moves. */
let altHeldForFreeLook = false
/** Keep suppress true for N animation frames (WebGL dispose / re-lock churn). */
function suppressUnlockPauseForFrames(frames = 3) {
  suppressPointerUnlockPause = true
  let left = Math.max(1, frames | 0)
  const tick = () => {
    left -= 1
    if (left <= 0) suppressPointerUnlockPause = false
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
// Same Esc can unlock then deliver keydown — ignore the keydown unpause.
let pauseOpenedAtMs = 0
// After unpause: block auto-pause + never clear flightMode from unlock races.
let resumeFlightGraceUntilMs = 0
// Full-screen capture layer until Chromium grants pointer lock (cursor confined).
let pointerLockBridgeEl = null
let pointerLockRetryTimer = null

const keys = createInputState()
const mouseAim = createMouseAimState()
const EMPTY_KEYS = new Set()
// flightModeWanted = player intends to be in mouse-aim flight (Space / undock).
// flightMode = actually receiving mouse aim (pointer is locked). Tabbing out
// drops the lock and clears flightMode, but keeps wanted so focus/click can
// re-acquire without needing another Space press.
let flightMode = false
let flightModeWanted = false
let laserFireHeld = false
let missileFireHeld = false

/** True when the player may shoot (flight-mode lock, free-flying, no menus). */
function canPlayerFire() {
  return !!(
    gameState &&
    playerShipClass &&
    flightMode &&
    !docked &&
    !dockEffect &&
    !cruising &&
    !paused &&
    !navMapOpen &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen &&
    !jumpEffect
  )
}

const _playerAimPoint = new THREE.Vector3()

/** Fire once if allowed. Cooldowns live on the ship; safe to call every frame while held. */
function tryPlayerFire(weaponTypeFilter) {
  if (!canPlayerFire()) return
  try {
    // Seat first so click-to-fire between frames matches the reticle this frame.
    syncChaseCamera(camera, gameState.player.ship, { cruising })
    // Boresight only — lasers fly pure ship +Z (never home on a Tab-lock).
    getShipAimPoint(gameState.player.ship, _playerAimPoint, AIM_LOOK_AHEAD)
    fireProjectile(
      gameState,
      gameState.player.ship,
      playerShipClass,
      'player',
      onWeaponFired,
      weaponTypeFilter,
      null,
      _playerAimPoint.toArray()
    )
    // Pointerdown path doesn't wait for the late animate() mesh pass.
    syncProjectileMeshesNow()
  } catch (err) {
    console.error('fire failed:', err)
  }
}

/** Create meshes for any projectiles spawned after the mid-frame mesh pass. */
function syncProjectileMeshesNow() {
  for (const proj of gameState.projectiles) {
    let mesh = projectileMeshes.get(proj.id)
    if (!mesh) {
      mesh = buildProjectileMesh(proj.weaponId, proj.weaponType)
      projectileMeshes.set(proj.id, mesh)
      scene.add(mesh)
    }
    syncMeshToEntity(mesh, proj)
  }
  for (const [id, mesh] of projectileMeshes) {
    if (!gameState.projectiles.some((p) => p.id === id)) {
      scene.remove(mesh)
      projectileMeshes.delete(id)
    }
  }
}

// Capture fire buttons independently. Do NOT sync both from e.buttons —
// under pointer-lock, pressing RMB while LMB is held often delivers a
// spurious up / buttons mask that would clear the laser (or vice versa).
// Only the specific e.button that went down/up is toggled.
function setFireButton(button, down) {
  if (button === 0) laserFireHeld = down
  else if (button === 2) missileFireHeld = down
}
function onFireButtonDown(e) {
  if (e.button !== 0 && e.button !== 2) return
  // Ignore UI targets (menus, overview) so we don't steal clicks.
  const t = e.target
  if (t && t !== document && t !== document.body && t !== renderer?.domElement) {
    if (typeof t.closest === 'function' && t.closest('button, input, select, textarea, a, #nav-map, #inventory-ui, #missions-ui, #character-ui, #system-overview.interactive, #docking-ui, #pause-menu, #menu')) {
      return
    }
  }
  setFireButton(e.button, true)
  if (!canPlayerFire()) return
  if (e.button === 0) tryPlayerFire('laser')
  if (e.button === 2) tryPlayerFire('missile')
}
function onFireButtonUp(e) {
  if (e.button !== 0 && e.button !== 2) return
  setFireButton(e.button, false)
}
// Idle-orbit activity tracker. One capture-phase listener per event type
// rather than touching every existing handler — this only reads the clock, it
// never calls preventDefault/stopPropagation, so it can't change behaviour for
// anything else listening for the same events.
let lastInputAtMs = performance.now()
function markInputActivity() {
  lastInputAtMs = performance.now()
}
for (const type of ['keydown', 'mousedown', 'mousemove', 'wheel']) {
  window.addEventListener(type, markInputActivity, true)
}

// Prefer mouse events: more reliable multi-button under Electron pointer-lock
// than pointer* (which can cancel both buttons when the second is pressed).
window.addEventListener('mousedown', onFireButtonDown, true)
window.addEventListener('mouseup', onFireButtonUp, true)
// Pointer path as backup (tablets / some embeds).
document.addEventListener('pointerdown', onFireButtonDown, true)
document.addEventListener('pointerup', onFireButtonUp, true)
document.addEventListener('pointercancel', (e) => {
  // Only clear the cancelled button if reported; never wipe the other.
  if (e.button === 0 || e.button === 2) setFireButton(e.button, false)
  else if ((e.buttons ?? 0) === 0) {
    laserFireHeld = false
    missileFireHeld = false
  }
}, true)
// Right-click is used for missile fire, not the OS/browser context menu.
window.addEventListener('contextmenu', (e) => e.preventDefault())

function canUseFlightMode() {
  if (!gameState || paused || navMapOpen || inventoryOpen || missionsOpen || characterOpen || jumpEffect) return false
  // Parked at the docking UI: no flight. Mid undock animation is fine —
  // pointer lock is requested on the Undock click (needs a live gesture).
  if (docked && !dockEffect) return false
  return true
}

function exitFlightMode() {
  flightModeWanted = false
  flightMode = false
  laserFireHeld = false
  missileFireHeld = false
  altHeldForFreeLook = false
  setChaseFreeLook(false)
  hidePointerLockBridge()
  stopPointerLockRetries()
  if (crosshairEl) crosshairEl.style.display = 'none'
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'
  // Free mouse → overview HUD accepts waypoint clicks.
  if (!docked && !navMapOpen && !inventoryOpen && !missionsOpen && !characterOpen && !paused) {
    systemOverview?.setInteractive(true)
  }
  if (document.pointerLockElement === renderer.domElement) {
    suppressPointerUnlockPause = true
    document.exitPointerLock()
    setTimeout(() => {
      suppressPointerUnlockPause = false
    }, 400)
  }
}

function inResumeFlightGrace() {
  return performance.now() < resumeFlightGraceUntilMs
}

function isFlightPointerLocked() {
  return document.pointerLockElement === renderer.domElement
}

function stopPointerLockRetries() {
  if (pointerLockRetryTimer != null) {
    clearInterval(pointerLockRetryTimer)
    pointerLockRetryTimer = null
  }
}

/**
 * Full-screen layer: hides OS cursor and captures the next user gesture so we
 * can re-request pointer lock after Esc (Chromium blocks lock until a gesture).
 * Keyboard flight works while the bridge is up; mouse look needs the lock.
 */
function showPointerLockBridge() {
  if (isFlightPointerLocked() || paused || docked || !flightModeWanted) {
    hidePointerLockBridge()
    return
  }
  if (pointerLockBridgeEl) return
  const el = document.createElement('div')
  el.id = 'pointer-lock-bridge'
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:250000',
    'cursor:none',
    'background:transparent',
    'touch-action:none'
  ].join(';')
  const onGesture = (e) => {
    if (e.type === 'keydown' && e.code === 'Escape') return
    // Keep this synchronous with the user gesture for Chromium.
    requestFlightPointerLock()
  }
  el.addEventListener('pointerdown', onGesture, true)
  window.addEventListener('keydown', onGesture, true)
  el._onGesture = onGesture
  document.body.appendChild(el)
  document.body.style.cursor = 'none'
  pointerLockBridgeEl = el
}

function hidePointerLockBridge() {
  if (!pointerLockBridgeEl) {
    if (document.body.style.cursor === 'none' && !isFlightPointerLocked()) {
      document.body.style.cursor = ''
    }
    return
  }
  const el = pointerLockBridgeEl
  if (el._onGesture) {
    el.removeEventListener('pointerdown', el._onGesture, true)
    window.removeEventListener('keydown', el._onGesture, true)
  }
  el.remove()
  pointerLockBridgeEl = null
  if (!isFlightPointerLocked()) document.body.style.cursor = ''
}

/** Force flight flags on (keyboard). Pointer lock is required for confined mouse. */
function forceFlightControlsOn() {
  flightModeWanted = true
  flightMode = true
  laserFireHeld = false
  missileFireHeld = false
  setChaseFreeLook(false)
  systemOverview?.setInteractive(false)
  if (!isFlightPointerLocked()) showPointerLockBridge()
  else hidePointerLockBridge()
}

/** @returns {Promise<boolean>} whether lock is held after the attempt */
function requestFlightPointerLock() {
  if (isFlightPointerLocked()) {
    forceFlightControlsOn()
    hidePointerLockBridge()
    stopPointerLockRetries()
    return Promise.resolve(true)
  }
  try {
    renderer.domElement.focus?.({ preventScroll: true })
  } catch {
    /* */
  }
  let req
  try {
    // Prefer unadjusted movement when available (raw mouse, less OS accel).
    req = renderer.domElement.requestPointerLock?.({ unadjustedMovement: true })
    if (req === undefined) {
      req = renderer.domElement.requestPointerLock?.()
    }
  } catch {
    try {
      req = renderer.domElement.requestPointerLock?.()
    } catch (err) {
      console.error('Pointer lock request threw:', err)
      if (flightModeWanted && !paused && !docked) {
        forceFlightControlsOn()
        showPointerLockBridge()
      }
      return Promise.resolve(false)
    }
  }
  if (req && typeof req.then === 'function') {
    return req
      .then(() => {
        forceFlightControlsOn()
        hidePointerLockBridge()
        stopPointerLockRetries()
        return true
      })
      .catch(() => {
        if (flightModeWanted && !paused && !docked) {
          forceFlightControlsOn()
          showPointerLockBridge()
        }
        return false
      })
  }
  requestAnimationFrame(() => {
    if (isFlightPointerLocked()) {
      forceFlightControlsOn()
      hidePointerLockBridge()
      stopPointerLockRetries()
    } else if (flightModeWanted && !paused && !docked) {
      forceFlightControlsOn()
      showPointerLockBridge()
    }
  })
  return Promise.resolve(false)
}

/**
 * Unpause / post-modal path into flight controls.
 * Enables keyboard immediately and keeps a full-screen bridge until pointer
 * lock confines the cursor (required after Esc unlock).
 */
function resumeFlightAfterPause() {
  resumeFlightGraceUntilMs = performance.now() + 3000
  suppressPointerUnlockPause = true
  setTimeout(() => {
    suppressPointerUnlockPause = false
  }, 600)

  mouseAim.dx = 0
  mouseAim.dy = 0
  forceFlightControlsOn()
  showPointerLockBridge()
  requestFlightPointerLock()

  stopPointerLockRetries()
  let ticks = 0
  pointerLockRetryTimer = setInterval(() => {
    ticks += 1
    if (!flightModeWanted || paused || docked || ticks > 40) {
      stopPointerLockRetries()
      return
    }
    forceFlightControlsOn()
    if (isFlightPointerLocked()) {
      hidePointerLockBridge()
      stopPointerLockRetries()
      return
    }
    // Retries only succeed when a user gesture recently activated the page
    // (Resume click / key / bridge pointerdown). Still useful right after click.
    requestFlightPointerLock()
  }, 80)
}

/** Shut every gameplay overlay so pause is the only UI on top. */
function dismissOpenPanelsForPause() {
  // Galaxy map
  if (navMapOpen) {
    navMapOpen = false
    navMap?.hide()
  }
  // Inventory
  if (inventoryOpen) {
    inventoryOpen = false
    inventoryUI?.hide()
  }
  // Missions tracker
  if (missionsOpen) {
    missionsOpen = false
    missionsUI?.hide()
  }
  // Character sheet
  if (characterOpen || characterUI?.isOpen?.()) {
    characterOpen = false
    characterFlightRestoreToken += 1
    characterUI?.hide?.({ silent: true })
  }
  // System scan (B) — hide() may call onClose → reenterFlightMode; paused is already true so it no-ops.
  if (systemScanMap?.isOpen?.()) {
    systemScanMap.hide()
  }
  // Datacore nodule minigame
  if (datacoreMinigame?.isOpen?.()) {
    datacoreMinigame.hide()
  }
  // Station Services (docked) — keep docked chrome, just close the services panel
  if (dockingUI?.isServicesOpen?.()) {
    dockingUI.toggleServices()
  }
}

/** Pause / unpause. Keeps flight intent so Resume re-locks the pointer. */
function setGamePaused(next) {
  if (!gameState || !!next === paused) return
  // Mid dock/undock animation: don't open pause over the cutscene.
  if (next && dockEffect) return
  paused = !!next
  audio.setThrustState(null)
  if (paused) {
    // Freeze campaign clock at current simTime (wall time does not advance sim while paused).
    if (gameState.simClockOriginMs != null) {
      gameState.simTime = Math.max(0, (Date.now() - gameState.simClockOriginMs) / 1000)
    }
    // Drop any open panels under the pause menu.
    dismissOpenPanelsForPause()
    // Don't clear flightModeWanted — Resume should return to mouse-aim.
    flightMode = false
    laserFireHeld = false
    missileFireHeld = false
    setChaseFreeLook(false)
    hidePointerLockBridge()
    stopPointerLockRetries()
    mouseAim.dx = 0
    mouseAim.dy = 0
    if (crosshairEl) crosshairEl.style.display = 'none'
    if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
    if (targetDirEl) targetDirEl.style.display = 'none'
    if (isFlightPointerLocked()) {
      suppressPointerUnlockPause = true
      document.exitPointerLock()
      setTimeout(() => {
        suppressPointerUnlockPause = false
      }, 400)
    }
    pauseOpenedAtMs = performance.now()
    pauseMenu?.show()
  } else {
    // Resume: continue clock from frozen simTime (no offline jump for pause duration).
    reanchorGameClock(gameState)
    pauseMenu?.hide()
    // Free-flight: restore flight + confine pointer (bridge until lock sticks).
    if (!docked) resumeFlightAfterPause()
    else {
      flightMode = false
      hidePointerLockBridge()
    }
  }
}

function reenterFlightMode() {
  flightModeWanted = true
  if (!canUseFlightMode()) {
    if (inResumeFlightGrace() && !paused && !docked) {
      forceFlightControlsOn()
      showPointerLockBridge()
      requestFlightPointerLock()
      return
    }
    flightMode = false
    hidePointerLockBridge()
    return
  }
  forceFlightControlsOn()
  if (isFlightPointerLocked()) {
    hidePointerLockBridge()
    return
  }
  showPointerLockBridge()
  requestFlightPointerLock()
}

// After alt-tab / OS focus steal, Chromium drops pointer lock. Keep the
// player's intent (flightModeWanted) and re-request on focus or any click.
function tryRestoreFlightMode() {
  if (!flightModeWanted || paused || docked) return
  if (!canUseFlightMode() && !inResumeFlightGrace()) return
  forceFlightControlsOn()
  if (isFlightPointerLocked()) {
    hidePointerLockBridge()
    return
  }
  showPointerLockBridge()
  requestFlightPointerLock()
}

document.addEventListener('pointerlockchange', () => {
  if (isFlightPointerLocked()) {
    if (flightModeWanted && !paused && !characterOpen) {
      forceFlightControlsOn()
      hidePointerLockBridge()
      stopPointerLockRetries()
    }
    return
  }
  laserFireHeld = false
  missileFireHeld = false
  mouseAim.dx = 0
  mouseAim.dy = 0

  if (crosshairEl) crosshairEl.style.display = 'none'
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'

  // During post-unpause grace: never clear flightMode and never auto-pause.
  if (inResumeFlightGrace() && flightModeWanted && !paused && !docked) {
    forceFlightControlsOn()
    showPointerLockBridge()
    return
  }

  // Lost lock while still wanting flight.
  if (paused || characterOpen || navMapOpen || inventoryOpen || missionsOpen || docked) {
    flightMode = false
    hidePointerLockBridge()
    return
  }

  // Esc while locked often only unlocks (no keydown). Open pause so one Esc works.
  // Do NOT pause on alt-tab / focus loss — suppress + visibility handle that.
  const appStillFocused =
    document.visibilityState === 'visible' &&
    (typeof document.hasFocus !== 'function' || document.hasFocus())
  if (
    !suppressPointerUnlockPause &&
    appStillFocused &&
    gameState &&
    !paused &&
    flightModeWanted &&
    !docked &&
    !dockEffect &&
    !navMapOpen &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen
  ) {
    setGamePaused(true)
    return
  }

  // Tab-out / other unlock without pausing: keep flight intent, capture until re-lock.
  if (flightModeWanted) {
    forceFlightControlsOn()
    showPointerLockBridge()
  } else {
    flightMode = false
    hidePointerLockBridge()
  }
  if (
    !docked &&
    !navMapOpen &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen &&
    !paused &&
    !suppressPointerUnlockPause &&
    !flightModeWanted
  ) {
    systemOverview?.setInteractive(true)
  } else if (!docked) {
    systemOverview?.setInteractive(false)
  }
})

// Alt + mouse: orbit chase cam around the ship; release Alt snaps back to seat.
// Important: do NOT arm free-look on bare Alt keydown — that regresses Alt+Enter
// fullscreen (free-look sticks when the OS swallows Alt keyup mid-toggle).
function isAltKey(code) {
  return code === 'AltLeft' || code === 'AltRight'
}

function clearChaseFreeLook() {
  altHeldForFreeLook = false
  setChaseFreeLook(false)
}

function isAltEnterChord(e) {
  return (
    e.altKey &&
    (e.code === 'Enter' ||
      e.code === 'NumpadEnter' ||
      e.key === 'Enter' ||
      e.key === 'Return')
  )
}

window.addEventListener('blur', () => {
  keys.clear()
  laserFireHeld = false
  missileFireHeld = false
  clearChaseFreeLook()
})

window.addEventListener('focus', () => {
  tryRestoreFlightMode()
})

window.addEventListener('keydown', (e) => {
  // Alt+Enter → fullscreen. Never free-look. Dual-path: main before-input + IPC.
  if (isAltEnterChord(e)) {
    e.preventDefault()
    e.stopPropagation()
    clearChaseFreeLook()
    window.electronAPI?.toggleFullscreen?.()
    return
  }
  if (!isAltKey(e.code)) return
  if (!gameState || paused || docked || jumpEffect || navMapOpen || inventoryOpen || missionsOpen || characterOpen) {
    clearChaseFreeLook()
    return
  }
  // Hold only — free-look engages on mouse movement in the game loop.
  altHeldForFreeLook = true
})
window.addEventListener('keyup', (e) => {
  if (!isAltKey(e.code)) return
  clearChaseFreeLook()
})
// Fullscreen transition often drops Alt keyup while free-look would stick.
if (typeof window.electronAPI?.onFullscreenChanged === 'function') {
  window.electronAPI.onFullscreenChanged(() => clearChaseFreeLook())
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tryRestoreFlightMode()
})

// Click the game view (canvas): docked → orbit hangar cam; free-mouse flight → re-lock.
// HUD chrome uses pointer-events:none so those clicks land here; interactive
// overlays (system overview, menus) sit above the canvas and keep the mouse free.
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (!gameState) return
  // Docked hangar: drag to orbit the parked ship.
  if (docked && !dockEffect && !paused && !navMapOpen && !inventoryOpen && !missionsOpen && !characterOpen) {
    dockOrbit.dragging = true
    dockOrbit.lastX = e.clientX
    dockOrbit.lastY = e.clientY
    dockOrbit.pointerId = e.pointerId
    try {
      renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    e.preventDefault()
    return
  }
  if (!canUseFlightMode()) return
  if (flightMode && document.pointerLockElement === renderer.domElement) return
  reenterFlightMode()
})

function endDockOrbitDrag(e) {
  if (!dockOrbit.dragging) return
  if (e?.pointerId != null && dockOrbit.pointerId != null && e.pointerId !== dockOrbit.pointerId) return
  dockOrbit.dragging = false
  if (dockOrbit.pointerId != null) {
    try {
      renderer.domElement.releasePointerCapture(dockOrbit.pointerId)
    } catch {
      /* ignore */
    }
  }
  dockOrbit.pointerId = null
}

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dockOrbit.dragging || !docked) return
  const dx = e.clientX - dockOrbit.lastX
  const dy = e.clientY - dockOrbit.lastY
  dockOrbit.lastX = e.clientX
  dockOrbit.lastY = e.clientY
  dockOrbit.yaw -= dx * DOCK_ORBIT_SENS
  dockOrbit.pitch = Math.max(
    DOCK_ORBIT_PITCH_MIN,
    Math.min(DOCK_ORBIT_PITCH_MAX, dockOrbit.pitch + dy * DOCK_ORBIT_SENS)
  )
})
renderer.domElement.addEventListener('pointerup', endDockOrbitDrag)
renderer.domElement.addEventListener('pointercancel', endDockOrbitDrag)
renderer.domElement.addEventListener('lostpointercapture', () => {
  dockOrbit.dragging = false
  dockOrbit.pointerId = null
})

// Chase-camera zoom (works with or without pointer lock). Scroll up = closer.
// Docked: orbit look-around only (click-drag) — no zoom.
window.addEventListener('wheel', (e) => {
  if (!gameState || dockEffect || jumpEffect || paused || navMapOpen || inventoryOpen || missionsOpen || characterOpen) return
  if (docked) return
  e.preventDefault()
  adjustChaseZoom(e.deltaY)
}, { passive: false })

let gameState = null
let playerShipClass = null
let playerMesh = null
let thrusterEffects = null
/** Ship-local engine nozzle points for multi-thruster exhaust (from hull layout). */
let playerEngineNozzles = null
let damageEffects = null
let oreScoopEffects = null
let missileTrail = null
let hud = null
let dockingUI = null
let pauseMenu = null
let navMap = null
let systemOverview = null
let systemScanMap = null
let datacoreMinigame = null
let inventoryUI = null
let missionsUI = null
let characterUI = null
/** Active alien-incursion site tracking: { anomalyId, position, hull, maxHull } */
let alienSiteRuntime = null
/** @type {Map<string, THREE.Object3D>} fully-scanned site world meshes (datacore / alien base) */
const anomalySiteMeshes = new Map()
/** Police backup timer: { systemId, fireAt } or null. */
let policeResponse = null
let dockPromptEl = null
let probePromptEl = null
let probeResultsEl = null
let probeResultsUntil = 0
let hailResultsEl = null
let hailResultsUntil = 0
// Floating probe scan text (left of ship); shown while in range of a scanned body.
let probeScanPanelEl = null
/** @type {Map<string, string[]>|null} */
let probeScanCache = null
let probeScanActiveBodyId = null
let wreckPromptEl = null
let miningToastEl = null
let miningToastUntil = 0
let lastOreFullToastAt = -Infinity
let craftToastEl = null
let craftToastHideTimer = null
let saveToastEl = null
let saveToastHideTimer = null
// Directional red edge vignette when player is hit by enemy fire.
let damageVignetteEl = null
const damageVignette = { left: 0, right: 0, top: 0, bottom: 0 }
const DAMAGE_VIGNETTE_DECAY = 1.85 // intensity units per second
const DAMAGE_VIGNETTE_PULSE = 0.72
const _vignetteRel = new THREE.Vector3()
const _vignetteInvQ = new THREE.Quaternion()
let factionToastEl = null
let factionToastUntil = 0
// Edge-detects "aliens just got wiped out/left while pirates were truced" —
// see the ambient-spawn block in animate() for the actual thank-you/cleanup.
let truceWasActive = false
let waypointEl = null
let crosshairEl = null
// In-scene reticle at the combat aim point (same WebGL pass as lasers — no DOM/CSS skew).
let combatReticle3d = null
let targetIndicatorEl = null
// Small arrow near the ship on-screen, pointing toward the Tab target.
let targetDirEl = null
// The player's current combat/scan target — { kind: 'npc'|'body'|'asteroid'|
// 'anomaly'|'nodule'|'alien_base'|…, id or (fieldId, index) } — set by Tab
// (see cycleTarget); never persisted (see resolveTarget).
let currentTarget = null
let cruiseIndicatorEl = null
let jumpFlashEl = null
/** Full-screen black overlay for hyperspace system-change fade. */
let jumpBlackEl = null
let jumpEffect = null
let dockEffect = null
let dockedApproach = null
let interiorMesh = null
const npcMeshes = new Map()
const bodyMeshes = new Map()
const wreckMeshes = new Map()
// Scratch for NPC thruster world pose (reused each frame).
const _npcThrustPos = new THREE.Vector3()
const _npcThrustQuat = new THREE.Quaternion()
const _npcThrustFwd = new THREE.Vector3()
const _npcThrustVel = new THREE.Vector3()

/** Build NPC hull + lite thruster FX (world-space exhaust, multi-nozzle). */
function addNpcMesh(npc) {
  if (!npc || npc.destroyed) return null
  let mesh = npcMeshes.get(npc.id)
  if (mesh) return mesh
  let shipClass
  try {
    shipClass = getShipClass(npc.shipClassId)
  } catch {
    return null
  }
  // Cache hit radius so first combat frame doesn't pay getShipClass for every bolt.
  if (npc._hitRadius == null) {
    try {
      npc._hitRadius = 1.5 + getShipCollisionRadius(shipClass)
    } catch {
      npc._hitRadius = 1.5 + 8
    }
  }
  mesh = buildShipMesh(shipClass, { lite: true })
  try {
    const thrusters = createLiteThrusterEffects()
    mesh.userData.thrusters = thrusters
    mesh.userData.engineNozzles = getEngineNozzleLocals(shipClass.hull)
    mesh.userData.hullLength = shipClass.hull?.length ?? 20
    scene.add(thrusters.group)
  } catch {
    /* thrusters optional */
  }
  npcMeshes.set(npc.id, mesh)
  scene.add(mesh)
  return mesh
}

function removeNpcMesh(npcId) {
  const mesh = npcMeshes.get(npcId)
  if (!mesh) return
  scene.remove(mesh)
  const thr = mesh.userData?.thrusters
  if (thr) {
    scene.remove(thr.group)
    try {
      thr.dispose?.()
    } catch {
      /* */
    }
    mesh.userData.thrusters = null
  }
  npcMeshes.delete(npcId)
}

function clearNpcMeshes() {
  for (const id of [...npcMeshes.keys()]) removeNpcMesh(id)
}

/** Update lite thruster trail for an on-screen NPC (forward thrust only). */
function updateNpcThrusters(mesh, npc, dt) {
  const thr = mesh?.userData?.thrusters
  if (!thr) return
  _npcThrustPos.fromArray(npc.position)
  _npcThrustQuat.fromArray(npc.quaternion).normalize()
  _npcThrustVel.fromArray(npc.velocity ?? [0, 0, 0])
  _npcThrustFwd.set(0, 0, 1).applyQuaternion(_npcThrustQuat)
  // Trail when nose-aligned motion is meaningful (patrol / attack / flee).
  const forwardSpeed = _npcThrustVel.dot(_npcThrustFwd)
  const speed = _npcThrustVel.length()
  const accelActive = forwardSpeed > 6 || (speed > 12 && forwardSpeed > 2)
  thr.update(dt, {
    accelActive,
    shipPos: _npcThrustPos,
    shipQuat: _npcThrustQuat,
    hullLength: mesh.userData.hullLength ?? 20,
    nozzles: mesh.userData.engineNozzles
  })
}
// Surface settlements ride a fixed offset on their parent (parents themselves
// are static — no orbital motion for planets/moons/fields/stations).
const surfaceSettlements = new Map()
let starMesh = null
const projectileMeshes = new Map()
const impactFlashes = []
const rockExplosions = []
const hitImpacts = []

function buildBodyMesh(body, system = null) {
  if (body.kind === 'planet' || body.kind === 'moon') return buildPlanetMesh(body)
  // Pass system so belt rocks tint by ore tier (coreFraction → raw/rich/exotic/quantum).
  if (body.kind === 'asteroidField') return buildAsteroidFieldMesh(body, system)
  if (body.kind === 'warpGate') {
    const mesh = buildWarpGateMesh(body)
    orientWarpGateTowardOrigin(mesh, body.position)
    return mesh
  }
  const mesh = buildStationMeshForBody(body)
  // Settlements keep a modest pre-behemoth size; only orbital stations are huge.
  const baseScale = body.kind === 'settlement' ? SETTLEMENT_SCALE : STATION_SCALE
  // Reuses the existing per-body hash (see hashStringForOrbit below) for a
  // touch of +/-15% size variety, so stations aren't all uniformly sized.
  const variance = 0.85 + (hashStringForOrbit(body.id) % 1000) / 1000 * 0.3
  mesh.scale.setScalar(baseScale * variance)
  return mesh
}

// Removes/clears whatever the previous system's bodies were, so this is
// safe to call on its own — callers don't have to remember to tear down the
// old system first (a caller that forgot was exactly how two systems' worth
// of stars/bodies could end up stacked in the same scene at once).
function loadBodiesForCurrentSystem() {
  if (starMesh) scene.remove(starMesh)
  for (const mesh of bodyMeshes.values()) scene.remove(mesh)
  bodyMeshes.clear()
  surfaceSettlements.clear()
  currentTarget = null

  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  starMesh = buildStarMesh(currentSystem)
  scene.add(starMesh)
  // Whisper of local-sun hue on the starfield (and a dimmer scene backdrop).
  applySystemStarAmbient()
  for (const body of currentSystem.bodies) {
    const mesh = buildBodyMesh(body, currentSystem)
    mesh.position.fromArray(body.position)
    bodyMeshes.set(body.id, mesh)
    scene.add(mesh)

    // Bodies stay at their generated positions (fixed orbits — no animation).
    // Settlements keep a surface offset + upright orientation on the host.
    if (body.kind === 'settlement' && body.parentId && body.surfaceOffset) {
      surfaceSettlements.set(body.id, {
        body,
        parentId: body.parentId,
        surfaceOffset: body.surfaceOffset
      })
      orientSettlementOnSurface(mesh, body.surfaceOffset)
    }
  }
  // Sec 3–6 station patrols; Sec 4–6 also cover warp gates.
  refreshStationPolicePatrols()
}

/** Spawn / top-up police patrols (stations Sec 3–6, warp gates Sec 4–6). */
function refreshStationPolicePatrols() {
  if (!gameState) return
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return
  ensureSystemSecurity(system)
  ensureStationPolicePatrols(Math.random, gameState, system, getSystemSecurity(system))
}

// Settlement meshes are built "upright" in local +Y; rotate so that axis
// points along the surface normal (away from the host center).
const _settlementUp = new THREE.Vector3()
const _worldUp = new THREE.Vector3(0, 1, 0)
function orientSettlementOnSurface(mesh, surfaceOffset) {
  _settlementUp.set(surfaceOffset[0], surfaceOffset[1], surfaceOffset[2])
  if (_settlementUp.lengthSq() < 1e-8) return
  _settlementUp.normalize()
  mesh.quaternion.setFromUnitVectors(_worldUp, _settlementUp)
}

function hashStringForOrbit(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Pick docking-bay theme from body + current system location.
 * - SerNub's Pleasure Palace → palace (fanciest)
 * - settlements → slightly dirty
 * - core stations (coreFraction < 0.3) → polished core
 * - mid stations → decent fancy
 * - outer rim stations (coreFraction ≥ 0.9) → rusty / gritty
 */
function resolveInteriorTheme(body) {
  if (body?.name === WHISPERS_STATION_NAME) return 'palace'
  if (body?.kind === 'settlement') return 'settlement'
  if (body?.kind !== 'station') return 'settlement'
  let f = 0.5
  if (gameState) {
    const system =
      findSystemOfBody(gameState.galaxy, body.id) ||
      getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (system) f = coreFraction(system)
  }
  if (f >= 0.9) return 'outer'
  if (f < 0.3) return 'core'
  return 'mid'
}

/** Rebuild bay mesh when theme or interior layout revision changes. */
const INTERIOR_MESH_REV = 8 // bump when hangar geometry changes mid-session
function ensureInteriorMesh(theme = 'mid') {
  if (
    !interiorMesh ||
    interiorMesh.userData.theme !== theme ||
    interiorMesh.userData.meshRev !== INTERIOR_MESH_REV
  ) {
    if (interiorMesh) {
      scene.remove(interiorMesh)
      interiorMesh.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.()
      })
    }
    interiorMesh = buildStationInteriorMesh({ theme })
    interiorMesh.userData.meshRev = INTERIOR_MESH_REV
    interiorMesh.position.copy(DOCKING_BAY_ORIGIN)
  }
  return interiorMesh
}

// Docking swaps the whole exterior scene out for the bay interior (and back).
function swapToInterior(body) {
  for (const mesh of bodyMeshes.values()) scene.remove(mesh)
  for (const mesh of npcMeshes.values()) {
    scene.remove(mesh)
    if (mesh.userData?.thrusters?.group) scene.remove(mesh.userData.thrusters.group)
  }
  for (const mesh of projectileMeshes.values()) scene.remove(mesh)
  for (const mesh of wreckMeshes.values()) scene.remove(mesh)
  for (const flash of impactFlashes) scene.remove(flash.mesh)
  if (starMesh) scene.remove(starMesh)
  if (thrusterEffects?.group) scene.remove(thrusterEffects.group)
  scene.add(ensureInteriorMesh(resolveInteriorTheme(body)))
}

function swapToExterior() {
  if (interiorMesh) scene.remove(interiorMesh)
  for (const mesh of bodyMeshes.values()) scene.add(mesh)
  for (const mesh of npcMeshes.values()) {
    scene.add(mesh)
    if (mesh.userData?.thrusters?.group) scene.add(mesh.userData.thrusters.group)
  }
  for (const mesh of projectileMeshes.values()) scene.add(mesh)
  for (const mesh of wreckMeshes.values()) scene.add(mesh)
  for (const flash of impactFlashes) scene.add(flash.mesh)
  if (starMesh) scene.add(starMesh)
  if (thrusterEffects?.group) scene.add(thrusterEffects.group)
}

function quatFacing(fromPos, towardPos) {
  // Matrix4.lookAt follows the camera convention (local +Z points away from
  // the target), but ship forward is +Z, so eye/target are swapped here —
  // same convention used in combat.js and supercruise.js.
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(towardPos, fromPos, new THREE.Vector3(0, 1, 0)))
}

let docked = false
/** Hangar camera orbit around the parked ship (click-drag on the view). */
const dockOrbit = {
  yaw: 0.55,
  pitch: 0.32,
  dist: 30,
  dragging: false,
  lastX: 0,
  lastY: 0,
  pointerId: null
}
const DOCK_ORBIT_PITCH_MIN = 0.08
const DOCK_ORBIT_PITCH_MAX = 1.25
const DOCK_ORBIT_DIST_MIN = 14
const DOCK_ORBIT_DIST_MAX = 70
const DOCK_ORBIT_SENS = 0.005

function resetDockOrbit() {
  dockOrbit.yaw = 0.55
  dockOrbit.pitch = 0.32
  dockOrbit.dist = 30
  dockOrbit.dragging = false
  dockOrbit.pointerId = null
}

function applyDockOrbitCamera() {
  if (!interiorMesh?.parent) return
  const park = DOCKING_BAY_ORIGIN.clone().add(BAY_PARK_OFFSET)
  const s = INTERIOR_WORLD_SCALE
  const dist = dockOrbit.dist * s
  const cp = Math.cos(dockOrbit.pitch)
  const sp = Math.sin(dockOrbit.pitch)
  const sy = Math.sin(dockOrbit.yaw)
  const cy = Math.cos(dockOrbit.yaw)
  // Spherical orbit: yaw around Y, pitch above the deck.
  camera.position.set(
    park.x + dist * cp * sy,
    park.y + Math.max(2 * s, dist * sp + 1.5 * s),
    park.z + dist * cp * cy
  )
  camera.lookAt(park.x, park.y + 1.2 * s, park.z)
}

let paused = false
let navMapOpen = false
let inventoryOpen = false
let missionsOpen = false
let characterOpen = false
let cruising = false
// Edge-detected in animate() to fire the supercruise engage/disengage voice
// callout exactly once per transition, regardless of whether cruising flips
// via the KeyC handler (manual) or the cruising block below (auto-arrival/
// combat-interrupt) — one check covers every trigger source.
let wasCruising = false
// Active probe flight: { phase, elapsed, body, mesh, launchPos, scanPos, ... }
let probeEffect = null
/** @type {Map<string, THREE.Object3D>} */
const droneMeshes = new Map()
// Ship/projectile local +Z is forward (see AGENTS.md coordinates note).
const FORWARD_Z = new THREE.Vector3(0, 0, 1)
const _droneShotDir = new THREE.Vector3()
const _droneShotQuat = new THREE.Quaternion()
let nextAmbientSpawnAt = 0

let menuStarMesh = null
/** @type {THREE.Object3D[]} */
let menuBodyMeshes = []
let menuAnimT = 0
let menuActive = false
/** Cached Whispers system from CANONICAL_GALAXY_SEED (same layout as New Game). */
let menuWhispersSystem = null
// Camera frames the real-scale system (companions + SerNub can sit ~0.5M out).
let menuOrbitRadius = 900000
let menuOrbitHeight = 180000

const MENU_ORBIT_PERIOD_S = 72
const MENU_LOOK_AT = new THREE.Vector3(0, 0, 0)

function getMenuWhispersSystem() {
  if (menuWhispersSystem) return menuWhispersSystem
  // Same seed / layout as createGameState — star id and bodies match in-game Whispers.
  const galaxy = generateGalaxy(CANONICAL_GALAXY_SEED)
  menuWhispersSystem =
    galaxy.systems.find((s) => s.name === WHISPERS_SYSTEM_NAME) ?? galaxy.systems[0]
  return menuWhispersSystem
}

function clearMenuBodies() {
  for (const mesh of menuBodyMeshes) scene.remove(mesh)
  menuBodyMeshes = []
}

function applyMenuStarAmbient() {
  const starColor = menuStarMesh?.userData?.stars?.[0]?.color
  setStarfieldStarTint(starfield, starColor ?? null)
  if (starColor?.clone) {
    const bg = starColor.clone().lerp(new THREE.Color(0x05070d), 0.94)
    bg.multiplyScalar(0.42)
    scene.background = bg
  } else {
    scene.background = new THREE.Color(0x05070d)
  }
}

/** Real-scale Whispers trinary + planets / moons / palace / gates for the title. */
function buildMenuSystemVisuals(system) {
  if (!system || !menuActive || gameState) return

  if (menuStarMesh) scene.remove(menuStarMesh)
  clearMenuBodies()

  // No forceType / fake id — same buildStarMesh path as loadBodiesForCurrentSystem.
  menuStarMesh = buildStarMesh(system)
  scene.add(menuStarMesh)
  applyMenuStarAmbient()

  for (const body of system.bodies) {
    const mesh = buildBodyMesh(body, system)
    mesh.position.fromArray(body.position)
    if (body.kind === 'settlement' && body.surfaceOffset) {
      orientSettlementOnSurface(mesh, body.surfaceOffset)
    }
    menuBodyMeshes.push(mesh)
    scene.add(mesh)
  }

  // Frame companions (halo) and outermost body so the whole system reads.
  let maxR = 0
  for (const star of menuStarMesh.userData.stars ?? []) {
    const reach = (star.radius ?? 0) * 3.6
    maxR = star.orbit ? Math.max(maxR, star.orbit.radius + reach) : Math.max(maxR, reach)
  }
  for (const body of system.bodies) {
    const r = Math.hypot(body.position[0], body.position[1], body.position[2])
    const shell =
      body.radius ??
      (body.kind === 'station' || body.kind === 'settlement' || body.kind === 'warpGate' ? 4000 : 0)
    maxR = Math.max(maxR, r + shell)
  }
  // Frame companions closely — title wants the trinary large, system still visible behind.
  menuOrbitRadius = Math.max(maxR * 0.42, 35000)
  menuOrbitHeight = menuOrbitRadius * 0.12
}

function startMenuBackground() {
  if (menuActive) return
  menuActive = true
  menuAnimT = 0
  setStarfieldStarTint(starfield, null)
  scene.background = new THREE.Color(0x05070d)
  audio.playTitleMusic()

  const mount = () => {
    if (!menuActive || gameState) return
    buildMenuSystemVisuals(getMenuWhispersSystem())
  }
  // Yield so the menu chrome can paint before ~2s galaxy gen on cold start.
  if (menuWhispersSystem) mount()
  else setTimeout(mount, 0)
}

function stopMenuBackground() {
  menuActive = false
  if (menuStarMesh) scene.remove(menuStarMesh)
  menuStarMesh = null
  clearMenuBodies()
  setStarfieldStarTint(starfield, null)
  scene.background = new THREE.Color(0x05070d)
  audio.stopTitleMusic()
}

function updateMenuBackground(dt) {
  if (!menuActive) return
  menuAnimT += dt
  if (menuStarMesh) updateStarMesh(menuStarMesh, menuAnimT, dt, camera)
  for (const mesh of menuBodyMeshes) {
    if (mesh.userData?.kind === 'warpGate') {
      updateWarpGateMesh(mesh, dt, menuAnimT)
    } else {
      updateStationMesh(mesh, menuAnimT, dt)
      updatePlanetAtmosphere(mesh, menuAnimT, dt)
    }
  }
  // Slow orbit around the real system origin (primary + companions at true scale).
  const angle = (menuAnimT / MENU_ORBIT_PERIOD_S) * Math.PI * 2
  camera.position.set(
    Math.cos(angle) * menuOrbitRadius,
    menuOrbitHeight,
    Math.sin(angle) * menuOrbitRadius
  )
  camera.lookAt(MENU_LOOK_AT)
  updateTitleGlowTint(dt)
}

const _tintRingPos = new THREE.Vector3()
const _tintStarPos = new THREE.Vector3()
// Current displayed glow colour, eased toward whatever updateTitleGlowTint
// picks each frame — see the fade comment below.
const _titleGlowCurrent = new THREE.Color(255 / 255, 70 / 255, 40 / 255)
let _titleGlowRgb = ''

/**
 * Tint the title's halo with the plasma ring nearest the orbiting menu camera.
 * Rings are bi-coloured (one hue per sun), so it also picks the end whose star
 * is closer — as the camera swings past each pairing the title takes on that
 * bridge's colour. Writes an "r,g,b" triplet to --title-glow; menu.js's
 * keyframes animate only radius/alpha, so the pulse is unaffected.
 *
 * The target colour itself changes in hard steps (nearest ring flips the
 * instant the camera crosses the midpoint), so the displayed colour is eased
 * toward it every frame rather than snapping — a quick fade reads as a
 * transition; an instant swap on a slow 72s orbit read as a jump cut.
 */
function updateTitleGlowTint(dt = 1 / 60) {
  const rings = menuStarMesh?.userData?.energyRings
  if (!rings?.length) return
  let best = null
  let bestDist = Infinity
  for (const ring of rings) {
    ring.group.getWorldPosition(_tintRingPos)
    const d = camera.position.distanceToSquared(_tintRingPos)
    if (d < bestDist) {
      bestDist = d
      best = ring
    }
  }
  // Mid layer carries the ring's body colour (halo is too dark, core too white).
  const ends = best?.layers?.[2]?.ends
  if (!ends) return
  // End A is the primary (theta = PI), end B the companion (theta = 0).
  const stars = menuStarMesh.userData.stars ?? []
  const primary = stars[0]
  const companion = stars[best.orbiterIndex ?? 1]
  let target = ends.hotA
  if (primary && companion) {
    primary.group.getWorldPosition(_tintStarPos)
    const dA = camera.position.distanceToSquared(_tintStarPos)
    companion.group.getWorldPosition(_tintStarPos)
    const dB = camera.position.distanceToSquared(_tintStarPos)
    target = dB < dA ? ends.hotB : ends.hotA
  }
  if (!target) return
  // Exponential ease, framerate-independent: ~90% of the way to the new
  // colour in about half a second regardless of dt.
  const t = 1 - Math.exp(-6 * Math.max(0, dt))
  _titleGlowCurrent.lerp(target, t)
  const rgb = `${Math.round(_titleGlowCurrent.r * 255)}, ${Math.round(_titleGlowCurrent.g * 255)}, ${Math.round(_titleGlowCurrent.b * 255)}`
  // Only touch the DOM when the rounded value actually changes.
  if (rgb === _titleGlowRgb) return
  _titleGlowRgb = rgb
  document.documentElement.style.setProperty('--title-glow', rgb)
}

function showGameSavedToast(durationMs = 2200) {
  if (!saveToastEl) return
  setHudGlitchText(saveToastEl, 'GAME SAVED')
  showHudGlitch(saveToastEl)
  clearTimeout(saveToastHideTimer)
  saveToastHideTimer = setTimeout(() => {
    hideHudGlitch(saveToastEl)
  }, durationMs)
}

/**
 * Pulse red vignette on screen edges toward the hit (camera-relative).
 * @param {number[]} worldPos - impact position
 * @param {number[]} [inboundDir] - optional world direction of the incoming shot
 */
function pulseDamageVignette(worldPos, inboundDir = null) {
  if (!damageVignetteEl || !gameState) return
  // Prefer inbound shot direction (where fire came from); else impact vs ship.
  if (inboundDir && inboundDir.length === 3) {
    _vignetteRel.set(inboundDir[0], inboundDir[1], inboundDir[2])
  } else {
    _vignetteRel
      .fromArray(worldPos)
      .sub(new THREE.Vector3().fromArray(gameState.player.ship.position))
  }
  if (_vignetteRel.lengthSq() < 1e-8) {
    // Head-on unknown — light all sides slightly.
    damageVignette.left = Math.min(1, damageVignette.left + DAMAGE_VIGNETTE_PULSE * 0.45)
    damageVignette.right = Math.min(1, damageVignette.right + DAMAGE_VIGNETTE_PULSE * 0.45)
    damageVignette.top = Math.min(1, damageVignette.top + DAMAGE_VIGNETTE_PULSE * 0.35)
    damageVignette.bottom = Math.min(1, damageVignette.bottom + DAMAGE_VIGNETTE_PULSE * 0.35)
    return
  }
  // Camera space: +X right, +Y up, -Z forward (matches what the player sees).
  _vignetteInvQ.copy(camera.quaternion).invert()
  _vignetteRel.applyQuaternion(_vignetteInvQ)
  const ax = Math.abs(_vignetteRel.x)
  const ay = Math.abs(_vignetteRel.y)
  // Bias toward the dominant screen axis; still bleed a little onto the other.
  const pulse = DAMAGE_VIGNETTE_PULSE
  if (ax >= ay * 0.55) {
    if (_vignetteRel.x > 0) damageVignette.right = Math.min(1, damageVignette.right + pulse)
    else damageVignette.left = Math.min(1, damageVignette.left + pulse)
  }
  if (ay >= ax * 0.55) {
    if (_vignetteRel.y > 0) damageVignette.top = Math.min(1, damageVignette.top + pulse)
    else damageVignette.bottom = Math.min(1, damageVignette.bottom + pulse)
  }
  // Nearly head-on (into the screen): bottom + slight sides (cockpit bashed).
  if (ax < 0.35 && ay < 0.35) {
    damageVignette.bottom = Math.min(1, damageVignette.bottom + pulse * 0.55)
    damageVignette.left = Math.min(1, damageVignette.left + pulse * 0.25)
    damageVignette.right = Math.min(1, damageVignette.right + pulse * 0.25)
  }
}

function updateDamageVignette(dt) {
  if (!damageVignetteEl) return
  const decay = DAMAGE_VIGNETTE_DECAY * dt
  for (const side of ['left', 'right', 'top', 'bottom']) {
    damageVignette[side] = Math.max(0, damageVignette[side] - decay)
    const el = damageVignetteEl.querySelector(`.dv-edge.${side}`)
    if (el) el.style.opacity = String(Math.min(1, damageVignette[side]))
  }
}

/** Write live docking / flight pose into player so serialize captures it. */
function snapshotPlayerPoseForSave() {
  if (!gameState) return
  if (docked && dockedApproach?.body) {
    gameState.player.dockedBodyId = dockedApproach.body.id
    gameState.player.dockedExteriorPosition = dockedApproach.exteriorPoint.toArray()
    gameState.player.dockedApproachDir = dockedApproach.approachDir.toArray()
    // Bay coords stay on the ship while docked (restored into the bay on load).
  } else {
    gameState.player.dockedBodyId = null
    gameState.player.dockedExteriorPosition = null
    gameState.player.dockedApproachDir = null
  }
}

function doSave() {
  snapshotPlayerPoseForSave()
  return persistSaveGame(gameState).then(
    () => {
      audio.playSaveChime()
      showGameSavedToast()
    },
    (err) => gameNotice('Save failed', err.message)
  )
}

function onWeaponFired(weaponId) {
  audio.playWeaponFire(weaponId)
}

/** Remember who last hurt the player (for the death screen). */
function notePlayerDamagedBy(ownerId, { ram = false } = {}) {
  if (!gameState?.player || !ownerId || ownerId === 'player') return
  const npc = gameState.npcs?.find((n) => n.id === ownerId)
  if (!npc) {
    gameState.player.lastKiller = {
      pilotName: 'Unknown pilot',
      shipName: 'Unknown vessel',
      method: ram ? 'ram' : 'fire'
    }
    return
  }
  let shipName = npc.shipClassId || 'Unknown vessel'
  try {
    shipName = getShipClass(npc.shipClassId).name
  } catch {
    /* */
  }
  gameState.player.lastKiller = {
    pilotName: npc.pilotName || 'Unknown pilot',
    shipName,
    shipClassId: npc.shipClassId,
    faction: npc.faction || null,
    method: ram ? 'ram' : 'fire'
  }
}

// Multi-laser volleys used to spawn N impact FX + N hit SFX on the same frame
// (first engagement hitch). Coalesce light ship chips to one FX/SFX per frame.
let _shipChipFxQueued = false
let _shipChipFxPos = null
let _shipChipFxMissile = false
let _shipChipFxTint = null

function onProjectileHit({
  position,
  rockPosition,
  destroyed,
  mined,
  hitPlayer,
  hitWreck,
  inboundDir,
  fieldId,
  rockIndex,
  targetNpcId,
  weaponType,
  weaponId,
  ownerId
}) {
  if (hitPlayer && ownerId) notePlayerDamagedBy(ownerId, { ram: false })

  // Defer non-critical hit FX one frame so first-engagement (law + AI flip)
  // never pays geometry/material cost on the same frame as damage.
  const isMissile = weaponType === 'missile'
  const skipLightHitFx = !!(mined?.destroyed || (destroyed && !hitPlayer && !hitWreck))
  const flashColor = mined ? 0xc2a35c : hitWreck ? 0x8a7a60 : destroyed ? 0xff8a3d : 0xffcc66
  const bigFlash = !!(mined?.destroyed || (hitWreck && destroyed))
  const hitPos = rockPosition ?? position
  let tint = null
  try {
    if (weaponId && !skipLightHitFx) tint = getWeapon(weaponId).color
  } catch { /* */ }

  // Light chip on a ship (not mine/kill/wreck): coalesce multi-turret hits.
  const isShipChip =
    !mined && !hitWreck && !destroyed && !hitPlayer && Array.isArray(position)
  if (isShipChip) {
    if (!_shipChipFxQueued) {
      _shipChipFxQueued = true
      _shipChipFxPos = position.slice()
      _shipChipFxMissile = isMissile
      _shipChipFxTint = tint
      requestAnimationFrame(() => {
        _shipChipFxQueued = false
        if (!gameState || !_shipChipFxPos) return
        const flash = buildImpactFlash(0xffcc66)
        flash.position.fromArray(_shipChipFxPos)
        scene.add(flash)
        impactFlashes.push({ mesh: flash, ttl: IMPACT_FLASH_TTL })
        const hitFx = spawnHitImpact(
          _shipChipFxPos,
          _shipChipFxMissile ? 'missile' : 'laser',
          _shipChipFxTint
        )
        scene.add(hitFx.group)
        hitImpacts.push(hitFx)
        try {
          audio.playHit()
        } catch {
          /* */
        }
        _shipChipFxPos = null
      })
    }
    // Vignette only for player damage (below). Chip SFX handled in rAF above.
    if (hitPlayer) pulseDamageVignette(position, inboundDir)
    return
  }

  const spawnFx = () => {
    if (!gameState) return
    const flash = buildImpactFlash(flashColor)
    flash.position.fromArray(position)
    if (bigFlash) flash.scale.setScalar(2.2)
    scene.add(flash)
    impactFlashes.push({ mesh: flash, ttl: IMPACT_FLASH_TTL })
    if (!skipLightHitFx) {
      const hitFx = spawnHitImpact(hitPos, isMissile ? 'missile' : 'laser', tint)
      scene.add(hitFx.group)
      hitImpacts.push(hitFx)
    }
  }
  // Rock mine / death bursts stay immediate for feedback; other hits defer.
  if (mined || (destroyed && !hitPlayer) || hitWreck) spawnFx()
  else requestAnimationFrame(spawnFx)

  if (hitWreck && destroyed) {
    try {
      audio.playRockExplosion()
    } catch {
      audio.playClick()
    }
    flashToast('Wreck destroyed', 1.6)
  }

  // Alien incursion base (after waves) — any hit near base applies damage.
  if (position && alienSiteRuntime) {
    tryDamageAlienBase(position, weaponType === 'missile' ? 90 : 35)
  }

  if (mined) {
    if (mined.destroyed) {
      // Fracture burst + beefy rock rumble (not the ship combat boom).
      const origin = rockPosition ?? position
      let rockR = 14
      if (fieldId != null && rockIndex != null) {
        const field = getSystem(gameState.galaxy, gameState.player.currentSystemId)?.bodies
          ?.find((b) => b.id === fieldId)
        const rock = field ? getAsteroidRocks(field)[rockIndex] : null
        if (rock) rockR = rockCollisionRadius(rock)
      }
      const fx = spawnRockExplosion(origin, rockR)
      scene.add(fx.group)
      rockExplosions.push(fx)
      audio.playRockExplosion()
      setHudGlitchText(miningToastEl, `${getGood(mined.goodId).name} deposit destroyed!`)
      showHudGlitch(miningToastEl)
      miningToastUntil = gameState.simTime + MINING_TOAST_DURATION_S * 1.4
      // If the whole belt is empty, show when it comes back.
      maybeToastFieldDepleted(fieldId)
    } else {
      audio.playMiningPing()
    }
    // Scoop trail only when ore actually entered the hold.
    if (mined.scooped) {
      const from = rockPosition ?? position
      oreScoopEffects?.burst(new THREE.Vector3(...from), 5 + Math.floor(Math.random() * 4))
      if (!mined.destroyed) {
        const n = mined.scoopedAmount ?? mined.amount ?? 1
        setHudGlitchText(miningToastEl, `Mined ${n} ${getGood(mined.goodId).name}`)
        showHudGlitch(miningToastEl)
        miningToastUntil = gameState.simTime + MINING_TOAST_DURATION_S
      }
    } else if (!mined.destroyed) {
      // Stripped ore but hold is full — warn the pilot (throttled).
      if (gameState.simTime - lastOreFullToastAt > 1.25) {
        flashToast('Ore Hold Full')
        lastOreFullToastAt = gameState.simTime
      }
    }
    // Sec 0–3: 10% chance mining attracts a pirate (cooldown inside roll helper).
    maybeSpawnMiningPirateAmbush()
  } else if (destroyed && !hitPlayer) {
    // NPC kill via projectile — mark so mesh teardown doesn't double-play.
    const killed = targetNpcId
      ? gameState.npcs.find((n) => n.id === targetNpcId)
      : gameState.npcs.find((n) => n.destroyed && !n.deathFxPlayed)
    if (killed && !killed.deathFxPlayed) {
      killed.deathFxPlayed = true
      const r = getShipCollisionRadius(getShipClass(killed.shipClassId))
      playShipDeathFx(killed.position ?? position, r)
    } else if (!killed) {
      playShipDeathFx(position, 14)
    }
  } else if (!destroyed) {
    // Chip hit SFX — defer so WebAudio node/buffer work is not on the hit frame.
    // (Ship chips already play via coalesced path above.)
    requestAnimationFrame(() => {
      try {
        audio.playHit()
      } catch {
        /* */
      }
    })
  }
  // Player ship destroyed: handlePlayerDeath() plays combat boom + FX.

  // Red edge vignette toward the side of the screen the fire came from.
  if (hitPlayer) pulseDamageVignette(position, inboundDir)
}

/** Hull-plate explosion for destroyed ships (NPCs / player death). */
function playShipDeathFx(position, radius = 12, { sound = true } = {}) {
  if (!position) return
  const fx = spawnShipExplosion(position, Math.max(8, radius))
  scene.add(fx.group)
  rockExplosions.push(fx)
  if (sound) audio.playExplosion()
}

/** Probe a sealed Datacore nodule with P (opens minigame). */
function tryDatacoreNoduleHack() {
  if (!gameState || datacoreMinigame?.isOpen?.()) return false
  const best = findNearbyDatacoreNodule()
  if (!best) return false
  exitFlightMode()
  datacoreMinigame.show({
    noduleName: 'Datacore nodule',
    onComplete: ({ success, aborted }) => {
      if (aborted) {
        if (!docked) reenterFlightMode()
        return
      }
      if (success) {
        const loot = applyDatacoreNoduleSuccess(
          gameState,
          best.anomaly,
          best.nodule,
          Math.random
        )
        let msg = `Nodule unlocked — recovered ${formatLootSummary(loot)}`
        if (best.anomaly.status === 'completed') {
          removeAnomalySiteMesh(best.anomaly.id)
          msg += ' · site complete'
        }
        flashToast(msg, 5.5)
        try {
          audio.playProbeFind()
        } catch {
          /* */
        }
      } else {
        applyDatacoreNoduleFail(best.anomaly, best.nodule, gameState.simTime)
        playShipDeathFx(best.nodule.position, 28)
        flashToast('Nodule destroyed!', 2.8)
        if (best.anomaly.status === 'completed') {
          removeAnomalySiteMesh(best.anomaly.id)
        }
      }
      if (!docked) reenterFlightMode()
    }
  })
  return true
}

function removeAnomalySiteMesh(id) {
  const mesh = anomalySiteMeshes.get(id)
  if (!mesh) return
  scene.remove(mesh)
  disposeAnomalySiteMesh(mesh)
  anomalySiteMeshes.delete(id)
}

function clearAnomalySiteMeshes() {
  for (const id of [...anomalySiteMeshes.keys()]) removeAnomalySiteMesh(id)
}

/**
 * Ensure world meshes exist for fully scanned sites in the current system.
 */
function syncAnomalySiteMeshes(system, dt) {
  const live = new Set()
  for (const a of system.spatialAnomalies ?? []) {
    if (!a.fullyScanned) continue
    if (a.status === 'completed' || a.status === 'despawning') {
      removeAnomalySiteMesh(a.id)
      if (a.type === 'alien_incursion') removeAnomalySiteMesh(`${a.id}-base`)
      continue
    }
    if (isDatacoreType(a.type)) {
      live.add(a.id)
      let mesh = anomalySiteMeshes.get(a.id)
      if (!mesh) {
        mesh = buildDatacoreSiteMesh(a)
        anomalySiteMeshes.set(a.id, mesh)
        scene.add(mesh)
      }
      updateDatacoreSiteMesh(mesh, a, gameState.simTime, dt)
    } else if (a.type === 'alien_incursion' && !a.baseDestroyed && alienSiteRuntime?.anomalyId === a.id) {
      const baseId = `${a.id}-base`
      live.add(baseId)
      let mesh = anomalySiteMeshes.get(baseId)
      if (!mesh) {
        mesh = buildAlienBaseMesh(a.position)
        anomalySiteMeshes.set(baseId, mesh)
        scene.add(mesh)
      }
      updateAlienBaseMesh(mesh, gameState.simTime, dt)
    }
  }
  for (const id of [...anomalySiteMeshes.keys()]) {
    if (!live.has(id)) removeAnomalySiteMesh(id)
  }
}

/** Nearest sealed datacore nodule within probe range, if any. */
function findNearbyDatacoreNodule() {
  if (!gameState) return null
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return null
  ensureSystemAnomalies(system, gameState.galaxy)
  const ship = gameState.player.ship.position
  let best = null
  let bestD = NODULE_PROBE_RANGE
  for (const a of system.spatialAnomalies ?? []) {
    if (!isDatacoreType(a.type) || !a.fullyScanned) continue
    if (a.status === 'completed' || a.status === 'despawning') continue
    for (const n of a.nodules ?? []) {
      if (n.status !== 'sealed') continue
      const d = Math.hypot(
        ship[0] - n.position[0],
        ship[1] - n.position[1],
        ship[2] - n.position[2]
      )
      if (d < bestD) {
        bestD = d
        best = { anomaly: a, nodule: n, dist: d }
      }
    }
  }
  return best
}

/**
 * Activate scanned sites in range: alien waves / base combat tracking.
 * Also keeps datacore relic + nodule meshes visible in the system.
 */
function updateAnomalySites(dt) {
  if (!gameState || docked || jumpEffect) {
    if (docked || jumpEffect) clearAnomalySiteMeshes()
    return
  }
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return
  ensureSystemAnomalies(system, gameState.galaxy)
  pruneAnomalies(system, gameState.simTime)
  const ship = gameState.player.ship.position
  const core = coreFraction(system)

  // Always show fully-scanned site geometry while undocked in-system.
  syncAnomalySiteMeshes(system, dt)

  for (const a of system.spatialAnomalies ?? []) {
    if (!a.fullyScanned) continue
    if (a.status === 'completed' || a.status === 'despawning') continue
    const d = Math.hypot(ship[0] - a.position[0], ship[1] - a.position[1], ship[2] - a.position[2])
    if (d > SITE_ACTIVATION_RANGE) continue

    if (a.type === 'alien_incursion' && !a.baseDestroyed) {
      a.status = 'active'
      // Spawn wave 0 if not started
      if ((a.waveIndex ?? 0) === 0 && (a.waveCleared ?? 0) === 0) {
        const live = gameState.npcs.filter(
          (n) => !n.destroyed && n.anomalySiteId === a.id
        ).length
        if (live === 0 && a._waveSpawned == null) {
          a._waveSpawned = 0
          a.waveIndex = 0
          const wave = spawnAlienIncursionWave(Math.random, a, 0, system.bodies, core)
          for (const n of wave) {
            // Hostile on arrival but hold fire for 10s (see combat.js updateNpcAI).
            n.combatDelayUntil = gameState.simTime + 10
            gameState.npcs.push(n)
            addNpcMesh(n)
          }
          flashToast(`Alien Incursion — wave 1/${a.wavesTotal}`, 3.2)
        }
      }
      // Advance waves when site ships dead
      const siteLive = gameState.npcs.filter(
        (n) => !n.destroyed && n.anomalySiteId === a.id
      )
      if (siteLive.length === 0 && a._waveSpawned != null) {
        const next = a._waveSpawned + 1
        if (next < (a.wavesTotal ?? 3)) {
          a._waveSpawned = next
          a.waveIndex = next
          const wave = spawnAlienIncursionWave(Math.random, a, next, system.bodies, core)
          for (const n of wave) {
            n.combatDelayUntil = gameState.simTime + 10
            gameState.npcs.push(n)
            addNpcMesh(n)
          }
          flashToast(`Alien Incursion — wave ${next + 1}/${a.wavesTotal}`, 3.2)
        } else if (!a.baseDestroyed && !alienSiteRuntime) {
          // Base becomes targetable (virtual HP entity tracked as runtime)
          alienSiteRuntime = {
            anomalyId: a.id,
            position: [...a.position],
            hull: 420,
            maxHull: 420
          }
          flashToast('Alien base exposed — destroy it!', 3.5)
        }
      }
    }

    if (a.type === 'datacore' && (a.status === 'scanned' || a.status === 'hidden')) {
      a.status = 'active'
      if (!a._enteredToast) {
        a._enteredToast = true
        flashToast('Datacore Relic — Tab-target a nodule and press F to hack', 4.2)
      }
    }

    if (a.type === 'datacore_takeover' || a.type === 'alien_datacore') {
      a.status = 'active'
      if (!a._enteredToast) {
        a._enteredToast = true
        flashToast(`${a.displayName} — hack the nodules, guards incoming!`, 4.2)
      }
      if (!a._guardsSpawned) {
        a._guardsSpawned = true
        const guards = spawnGuardWave(
          Math.random,
          a,
          (a.nodules?.length ?? 0) * 2,
          system.bodies,
          core,
          a.guardFaction ?? 'pirate'
        )
        for (const n of guards) {
          gameState.npcs.push(n)
          addNpcMesh(n)
        }
      }
    }

    if (a.type === 'ore_anomaly') {
      a.status = 'active'
      if (!a._enteredToast) {
        a._enteredToast = true
        flashToast(`${a.displayName} — mine the exposed asteroids`, 4.2)
      }
      if (a.ambush && !a._ambushSpawned) {
        a._ambushSpawned = true
        const count = 2 + Math.floor(Math.random() * 4)
        // Spawn clear of the rock cluster + combat.js's mining/combat skip
        // radius (380m) — any closer and a loitering guard permanently blocks
        // mining hit-tests (rocks never lose mass) even before it engages.
        const guards = spawnGuardWave(Math.random, a, count, system.bodies, core, 'pirate', {
          minDist: 900,
          maxDist: 1600
        })
        for (const n of guards) {
          gameState.npcs.push(n)
          addNpcMesh(n)
        }
        flashToast('Pirates ambush the ore field!', 3.5)
      }
    }
  }
}

/** Apply damage to exposed alien base if projectiles hit near it. */
function tryDamageAlienBase(hitPos, damage = 40) {
  if (!alienSiteRuntime || !gameState) return false
  const d = Math.hypot(
    hitPos[0] - alienSiteRuntime.position[0],
    hitPos[1] - alienSiteRuntime.position[1],
    hitPos[2] - alienSiteRuntime.position[2]
  )
  if (d > 350) return false
  alienSiteRuntime.hull -= damage
  if (alienSiteRuntime.hull <= 0) {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const a = getAnomaly(system, alienSiteRuntime.anomalyId, gameState.galaxy)
    if (a) {
      const { credits, loot } = applyAlienBaseKill(gameState, a, Math.random, gameState.simTime)
      gameState.wrecks.push(
        spawnWreck(alienSiteRuntime.position, gameState.simTime, Math.random, null)
      )
      // Site loot lands in the wreck (standard goods always; valuable rolled in loot).
      const w = gameState.wrecks[gameState.wrecks.length - 1]
      if (w?.loot) {
        w.loot.cargo ??= {}
        for (const [id, qty] of Object.entries(loot.cargo ?? {})) {
          w.loot.cargo[id] = (w.loot.cargo[id] ?? 0) + qty
        }
        if (loot.shipParts) w.loot.shipParts = (w.loot.shipParts ?? 0) + loot.shipParts
        if (loot.blueprints) {
          w.loot.blueprints ??= {}
          for (const [id, qty] of Object.entries(loot.blueprints)) {
            w.loot.blueprints[id] = (w.loot.blueprints[id] ?? 0) + qty
          }
        }
        if (loot.skillbooks) {
          w.loot.skillbooks ??= {}
          for (const [id, qty] of Object.entries(loot.skillbooks)) {
            w.loot.skillbooks[id] = (w.loot.skillbooks[id] ?? 0) + qty
          }
        }
      }
      playShipDeathFx(alienSiteRuntime.position, 40)
      let baseMsg = `Alien base destroyed — +${credits} cr (site despawns in 5 min)`
      if (loot?.blueprints || loot?.skillbooks) baseMsg += ' · rare salvage in wreck!'
      flashToast(baseMsg, 4.5)
    }
    alienSiteRuntime = null
  }
  return true
}

/** Toast when every rock in a field is gone (and remaining time until next respawn). */
function maybeToastFieldDepleted(fieldId) {
  if (!fieldId || !gameState) return
  const field = getSystem(gameState.galaxy, gameState.player.currentSystemId)?.bodies
    ?.find((b) => b.id === fieldId && b.kind === 'asteroidField')
  if (!field) return
  const rocks = getAsteroidRocks(field)
  if (!isFieldDepleted(gameState, field.id, rocks.length)) return
  const rem = fieldRespawnRemainingS(gameState, field.id, rocks.length)
  const label = field.name || 'Asteroid field'
  flashToast(
    rem > 0
      ? `${label} depleted · respawns in ${formatRespawnTime(rem)}`
      : `${label} depleted`,
    4.5
  )
}

/** SC / approach: warn if the destination belt is fully mined out. */
function toastIfDepletedField(bodyId) {
  if (!bodyId || !gameState) return
  const field = getSystem(gameState.galaxy, gameState.player.currentSystemId)?.bodies
    ?.find((b) => b.id === bodyId && b.kind === 'asteroidField')
  if (!field) return
  const rocks = getAsteroidRocks(field)
  if (!isFieldDepleted(gameState, field.id, rocks.length)) return
  const rem = fieldRespawnRemainingS(gameState, field.id, rocks.length)
  flashToast(
    rem > 0
      ? `${field.name} depleted · respawns in ${formatRespawnTime(rem)}`
      : `${field.name} depleted`,
    4.5
  )
}

/** Sec 0–3 mining: 10% chance a pirate drops out of the dark. */
function maybeSpawnMiningPirateAmbush() {
  if (!gameState || docked || jumpEffect) return
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return
  ensureSystemSecurity(system)
  if (!rollMiningPirateAmbush(Math.random, gameState, system)) return
  const npc = spawnMiningPirateAmbush(
    Math.random,
    gameState.player.ship.position,
    coreFraction(system),
    system.bodies
  )
  gameState.npcs.push(npc)
  if (factionToastEl) {
    setHudGlitchText(factionToastEl, 'Pirates attracted by your mining!')
    showHudGlitch(factionToastEl)
    factionToastUntil = gameState.simTime + FACTION_TOAST_DURATION_S
  }
}

const deathScreen = createDeathScreen(appEl, () => returnToMenu())
const menu = createMenu(appEl, {
  onNewGame: ({ characterName, shipInstanceName, portraitDataUrl }) => {
    // Career seed only diversifies missions; galaxy + home system are fixed.
    const seed = Math.floor(Math.random() * 1e9)
    const gameState = DEV_TEST_SETUP
      ? createDevTestGameState({ characterName, shipInstanceName, seed })
      : createGameState({
          characterName,
          shipInstanceName,
          portraitDataUrl: portraitDataUrl || null,
          shipClassId: STARTER_SHIP_CLASS_ID,
          seed,
          galaxySeed: CANONICAL_GALAXY_SEED
        })
    if (DEV_TEST_SETUP && portraitDataUrl) {
      gameState.player.portraitDataUrl = portraitDataUrl
    }
    // Begin the campaign parked in a Terra Prime bay rather than adrift in
    // open space. Setting dockedBodyId is enough: startSession's
    // restoreSessionLocation() already owns the whole docked entry path
    // (interior swap, bay park pose, docked HUD, station services), which is
    // the same route a save-load takes. Starting law is 10, so the Sec 6 dock
    // check passes. Falls through to the old free-flight start if the home
    // system somehow has no station.
    const homeSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const homeStation = homeSystem?.bodies?.find((b) => b.kind === 'station')
    if (homeStation) gameState.player.dockedBodyId = homeStation.id
    startSession(gameState, { enterFlightMode: true })
  },
  onLoadGame: async () => {
    const loaded = await persistLoadGame()
    if (loaded) startSession(loaded)
    else menu.show(await hasSave())
  }
})

function clearSession() {
  if (playerMesh) scene.remove(playerMesh)
  clearDroneMeshes()
  probeScanCache = null
  probeScanActiveBodyId = null
  if (thrusterEffects) scene.remove(thrusterEffects.group)
  thrusterEffects = null
  playerEngineNozzles = null
  if (damageEffects) scene.remove(damageEffects.group)
  damageEffects = null
  if (oreScoopEffects) scene.remove(oreScoopEffects.group)
  oreScoopEffects = null
  if (missileTrail) {
    missileTrail.clear()
    scene.remove(missileTrail.group)
    missileTrail = null
  }
  clearNpcMeshes()
  for (const mesh of bodyMeshes.values()) scene.remove(mesh)
  bodyMeshes.clear()
  surfaceSettlements.clear()
  if (starMesh) scene.remove(starMesh)
  starMesh = null
  for (const mesh of projectileMeshes.values()) scene.remove(mesh)
  projectileMeshes.clear()
  for (const mesh of wreckMeshes.values()) scene.remove(mesh)
  wreckMeshes.clear()
  for (const flash of impactFlashes) scene.remove(flash.mesh)
  impactFlashes.length = 0
  for (const fx of rockExplosions) {
    scene.remove(fx.group)
    disposeRockExplosion(fx)
  }
  rockExplosions.length = 0
  for (const fx of hitImpacts) {
    scene.remove(fx.group)
    disposeHitImpact(fx)
  }
  hitImpacts.length = 0
  hud?.element.remove()
  dockingUI?.element.remove()
  pauseMenu?.element.remove()
  navMap?.element.remove()
  systemScanMap?.hide?.()
  systemScanMap?.element?.remove?.()
  systemScanMap = null
  datacoreMinigame?.hide?.()
  datacoreMinigame?.element?.remove?.()
  datacoreMinigame = null
  alienSiteRuntime = null
  clearAnomalySiteMeshes()
  systemOverview?.element.remove()
  systemOverview = null
  inventoryUI?.element.remove()
  missionsUI?.element.remove()
  characterUI?.element.remove()
  characterUI = null
  policeResponse = null
  dockPromptEl?.remove()
  probePromptEl?.remove()
  probeResultsEl?.remove()
  probeResultsEl = null
  probeResultsUntil = 0
  hailResultsEl?.remove()
  hailResultsEl = null
  hailResultsUntil = 0
  probeScanPanelEl?.remove()
  probeScanPanelEl = null
  probeScanCache = null
  probeScanActiveBodyId = null
  wreckPromptEl?.remove()
  for (const item of toastQueue) item.el.remove()
  toastQueue.length = 0
  miningToastEl?.remove()
  craftToastEl?.remove()
  craftToastEl = null
  clearTimeout(craftToastHideTimer)
  craftToastHideTimer = null
  saveToastEl?.remove()
  saveToastEl = null
  clearTimeout(saveToastHideTimer)
  saveToastHideTimer = null
  damageVignetteEl?.remove()
  damageVignetteEl = null
  damageVignette.left = damageVignette.right = damageVignette.top = damageVignette.bottom = 0
  factionToastEl?.remove()
  truceWasActive = false
  waypointEl?.remove()
  crosshairEl?.remove()
  if (combatReticle3d) {
    scene.remove(combatReticle3d)
    combatReticle3d = null
  }
  targetIndicatorEl?.remove()
  targetDirEl?.remove()
  targetDirEl = null
  currentTarget = null
  cruiseIndicatorEl?.remove()
  jumpFlashEl?.remove()
  jumpBlackEl?.remove()
  jumpBlackEl = null
  if (interiorMesh) scene.remove(interiorMesh)
  audio.setThrustState(null)
  audio.setSupercruiseActive(false)
  audio.stopAmbientMusic()
  camera.fov = BASE_FOV
  camera.updateProjectionMatrix()
  resetChaseZoom()
  resetChaseCameraState()
  docked = false
  hud?.setDocked(false)
  paused = false
  navMapOpen = false
  inventoryOpen = false
  missionsOpen = false
  characterOpen = false
  cruising = false
  wasCruising = false
  jumpEffect = null
  hyperspaceTunnel.stop()
  audio.stopHyperspaceAudio()
  dockEffect = null
  dockedApproach = null
  clearProbeEffect()
  exitFlightMode()
}

function clearProbeEffect() {
  if (probeEffect?.mesh) scene.remove(probeEffect.mesh)
  probeEffect = null
  audio.setProbeScanActive(false)
}

function clearDroneMeshes() {
  for (const mesh of droneMeshes.values()) {
    scene.remove(mesh)
    if (mesh.userData.trail?.mesh) scene.remove(mesh.userData.trail.mesh)
    disposeDroneMesh(mesh)
  }
  droneMeshes.clear()
}

function syncDroneMeshes() {
  if (!gameState) return
  const ship = gameState.player.ship
  ensureDrones(ship)
  const live = new Set()
  for (const d of ship.drones ?? []) {
    if (!d.deployed || d.destroyed || d.hull <= 0 || d.mode === 'bay') continue
    live.add(d.id)
    let mesh = droneMeshes.get(d.id)
    if (!mesh) {
      mesh = buildDroneMesh(d.typeId)
      droneMeshes.set(d.id, mesh)
      scene.add(mesh)
      if (mesh.userData.trail?.mesh) scene.add(mesh.userData.trail.mesh)
    }
    mesh.visible = true
    updateDroneMesh(mesh, d, 0)
  }
  for (const [id, mesh] of [...droneMeshes.entries()]) {
    if (live.has(id)) continue
    scene.remove(mesh)
    if (mesh.userData.trail?.mesh) scene.remove(mesh.userData.trail.mesh)
    disposeDroneMesh(mesh)
    droneMeshes.delete(id)
  }
}

function updatePlayerDrones(dt) {
  if (!gameState || docked || cruising || jumpEffect) return
  ensureDrones(gameState.player.ship)
  // Drones only engage after shots exchanged (not Tab-lock alone).
  pruneCombatEngagement(gameState)
  const hostility = buildHostilityContext()
  const targetNpcId =
    currentTarget?.kind === 'npc' ? currentTarget.id : null
  updateDrones(gameState, dt, {
    isHostileNpc: (npc) => isHostileToPlayer(npc, hostility),
    engagedNpcIds: gameState.player.combatEngagedNpcIds ?? {},
    playerTargetNpcId: targetNpcId,
    fireLaser: (drone, targetPos, weapon) => {
      // Fire as player-owned projectile from drone position toward target.
      const origin = drone.position
      const to = [
        targetPos[0] - origin[0],
        targetPos[1] - origin[1],
        targetPos[2] - origin[2]
      ]
      const len = Math.hypot(to[0], to[1], to[2]) || 1
      const dir = [to[0] / len, to[1] / len, to[2] / len]
      // Same fallback drones.js leads with — a mismatch here would aim the
      // shot at a speed it is not actually fired at.
      const speed = weapon.speed ?? DRONE_SHOT_SPEED_FALLBACK
      let dmg = weapon.damage ?? 8
      try {
        dmg *= playerSkillBonuses(gameState).droneMult
      } catch {
        /* */
      }
      // Orientation is NOT optional: sceneSync's syncMeshToEntity does
      // mesh.quaternion.fromArray(entity.quaternion) unconditionally, so a
      // projectile without one threw in the middle of animate() and killed the
      // rest of that frame (targeting, HUD, render) for as long as the shot was
      // alive. Ships local +Z is forward, same convention combat.js uses when
      // it builds its own projectiles.
      _droneShotDir.set(dir[0], dir[1], dir[2])
      _droneShotQuat.setFromUnitVectors(FORWARD_Z, _droneShotDir)
      const proj = {
        id: `drone-shot-${drone.id}-${Math.floor(gameState.simTime * 1000)}-${Math.random().toString(36).slice(2, 7)}`,
        ownerId: 'player',
        weaponId: weapon.id,
        weaponType: 'laser',
        position: [...origin],
        quaternion: [_droneShotQuat.x, _droneShotQuat.y, _droneShotQuat.z, _droneShotQuat.w],
        velocity: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
        damage: dmg,
        ttl: weapon.ttl ?? 2.5,
        spawnedAt: gameState.simTime,
        fromDrone: true
      }
      gameState.projectiles.push(proj)
      try {
        audio.playWeaponFire(weapon.id)
      } catch {
        /* */
      }
    }
  })
  // Sync meshes + thruster trails
  for (const d of gameState.player.ship.drones ?? []) {
    if (!d.deployed || d.destroyed || d.mode === 'bay') {
      const m = droneMeshes.get(d.id)
      if (m) {
        scene.remove(m)
        if (m.userData.trail?.mesh) scene.remove(m.userData.trail.mesh)
        disposeDroneMesh(m)
        droneMeshes.delete(d.id)
      }
      continue
    }
    let mesh = droneMeshes.get(d.id)
    if (!mesh) {
      mesh = buildDroneMesh(d.typeId)
      droneMeshes.set(d.id, mesh)
      scene.add(mesh)
      if (mesh.userData.trail?.mesh) scene.add(mesh.userData.trail.mesh)
    }
    updateDroneMesh(mesh, d, dt)
  }
}

/** Swap the visible player hull when classId changes (shipyard Activate). */
function rebuildPlayerShipMesh() {
  if (!gameState) return
  playerShipClass = getShipClass(gameState.player.ship.classId)
  if (playerMesh) {
    scene.remove(playerMesh)
    playerMesh = null
  }
  playerMesh = buildShipMesh(playerShipClass)
  scene.add(playerMesh)
  syncMeshToEntity(playerMesh, gameState.player.ship)
  // Match thruster FX to this hull's engine nacelles (single/twin/triple/quad).
  try {
    playerEngineNozzles = getEngineNozzleLocals(playerShipClass.hull)
  } catch {
    playerEngineNozzles = null
  }
}

/** Open/toggle System Scan (HUD button + B). */
function openSystemScanPanel() {
  if (!gameState || !systemScanMap) return
  if (docked || dockEffect || jumpEffect || cruising) {
    flashToast('System Scan unavailable right now')
    return
  }
  if (
    paused ||
    navMapOpen ||
    inventoryOpen ||
    missionsOpen ||
    characterOpen ||
    datacoreMinigame?.isOpen?.()
  ) {
    return
  }
  if (systemScanMap.isOpen?.()) {
    systemScanMap.hide()
    return
  }
  exitFlightMode()
  const sys = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (sys) ensureSystemAnomalies(sys, gameState.galaxy)
  systemScanMap.show()
}

function startSession(newGameState, { enterFlightMode = false } = {}) {
  clearSession()
  stopMenuBackground()
  gameState = newGameState
  ensureBlueprintMaps(gameState)
  // Offline craft completions from deserialize (wall-clock) — toast after HUD exists.
  const offlineCraftDone = gameState._craftingJustCompleted ?? []
  delete gameState._craftingJustCompleted
  const anomaliesRefreshedOffline = !!gameState._anomaliesRefreshedOffline
  delete gameState._anomaliesRefreshedOffline
  rebuildPlayerShipMesh()
  ensureDrones(gameState.player.ship)
  clearDroneMeshes()
  thrusterEffects = createThrusterEffects()
  scene.add(thrusterEffects.group)
  damageEffects = createDamageEffects()
  scene.add(damageEffects.group)
  oreScoopEffects = createOreScoopEffects()
  scene.add(oreScoopEffects.group)
  missileTrail = createMissileTrailSystem()
  scene.add(missileTrail.group)

  // Warm projectile + hit FX so first combat shot/hit is not a hitch.
  // Full catalog so NPC return fire doesn't compile templates mid-fight.
  try {
    const equipped = Object.values(gameState.player.ship.equippedWeapons ?? {})
    const allIds = [...new Set([...equipped, ...WEAPONS.map((w) => w.id)])]
    preloadProjectileMeshes(allIds)
  } catch {
    preloadProjectileMeshes()
  }
  try {
    preloadHitImpactFx(renderer, scene, camera)
  } catch {
    /* non-fatal */
  }
  // Warm impact flash material templates (shader compile) without playing SFX.
  try {
    const w1 = buildImpactFlash(0xffcc66)
    const w2 = buildImpactFlash(0xff8a3d)
    const w3 = buildImpactFlash(0xc2a35c)
    scene.add(w1, w2, w3)
    renderer.compile?.(scene, camera)
    scene.remove(w1, w2, w3)
  } catch {
    /* non-fatal */
  }
  for (const npc of gameState.npcs) {
    addNpcMesh(npc)
  }
  // Kenney free-model stations (3 types). Preload GLBs; rebuild bodies when
  // ready so free models replace any procedural fallbacks from first paint.
  const sessionToken = gameState
  loadBodiesForCurrentSystem()
  preloadStationModels().then(() => {
    if (gameState !== sessionToken) return
    if (stationModelsReady()) loadBodiesForCurrentSystem()
  })
  preloadInteriorModels()

  hud = createHud(appEl)
  dockingUI = createDockingUI(appEl, gameState, Math.random, {
    onCraftStarted: (msg) => {
      showCraftToast(msg, 5000)
      audio.playCraftStart()
    },
    // Bought ships only become active via Storage activate — rebuild the
    // visual hull so a class swap doesn't keep looking like the previous ship.
    onPlayerShipChanged: () => rebuildPlayerShipMesh(),
    onStorageChanged: () => inventoryUI?.refresh?.(),
    onCloneTravel: (result) => {
      // Leave bay UI / interior if we jumped while docked.
      if (docked || dockEffect) {
        dockEffect = null
        docked = false
        dockedApproach = null
        clearDockedSaveFields()
        try {
          swapToExterior()
        } catch {
          /* already exterior */
        }
      }
      if (result?.systemChanged) {
        loadBodiesForCurrentSystem()
        // Re-seed ambient traffic / missions for the destination system.
        try {
          ensureBountyNpcsForSystem(gameState, gameState.player.currentSystemId, Math.random)
        } catch {
          /* */
        }
      }
      if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
      snapChaseCamera(camera, gameState.player.ship)
      hud?.setDocked(false)
      systemOverview?.show()
      flashToast('Clone jump complete', 3.5)
      reenterFlightMode()
    }
  })
  pauseMenu = createPauseMenu(appEl, {
    onResume: () => {
      // Called from Resume pointerdown — still in a user-activation gesture.
      // Unpause + lock request must stay synchronous with that gesture.
      setGamePaused(false)
    },
    onSave: () => doSave(),
    onRestart: async () => {
      const ok = await gameConfirm(
        'Return to Menu',
        'Return to main menu?\nUnsaved progress will be lost.',
        { okLabel: 'Return', cancelLabel: 'Cancel', danger: true }
      )
      if (!ok) return
      pauseMenu.hide()
      returnToMenu()
    },
    onQuit: () => window.electronAPI.quitApp()
  })
  navMap = createNavMap(appEl, gameState)
  systemScanMap = createSystemScanMap(appEl, gameState, {
    getShipClassId: () => gameState.player.ship.classId,
    onFullyScanned: (a) => {
      flashToast(`${a.displayName} locked — now on Overview`, 3.5)
      try {
        audio.playProbeFind()
      } catch {
        /* */
      }
    },
    onClose: () => {
      if (!docked && !navMapOpen) reenterFlightMode()
    }
  })
  datacoreMinigame = createDatacoreMinigame(appEl)
  systemOverview = createSystemOverview(appEl, gameState, {
    canSetWaypoint: () => {
      if (cruising) {
        flashToast('Unable to set a waypoint during Supercruise.')
        return false
      }
      return true
    },
    onWaypointChange: ({ name, set }) => {
      if (set) {
        audio.playWaypointSet()
        flashToast(`Waypoint set: ${name ?? 'body'}`)
      } else {
        audio.playWaypointClear()
        flashToast(name ? `Waypoint cleared: ${name}` : 'Waypoint cleared')
      }
    }
  })
  systemOverview.show()
  systemOverview.setInteractive(!flightMode)
  hud?.onSystemScan?.(openSystemScanPanel)
  inventoryUI = createInventoryUI(appEl, gameState, {
    onStorageChanged: () => dockingUI?.refreshStorage?.()
  })
  missionsUI = createMissionsUI(appEl, gameState, {
    canSetWaypoint: () => {
      if (cruising) {
        flashToast('Unable to set a waypoint during Supercruise.')
        return false
      }
      return true
    }
  })
  characterUI = createCharacterUI(appEl, gameState)
  ensureLawStanding(gameState)
  const startSys = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (startSys) ensureSystemSecurity(startSys)

  // Shared look for probe classification + all floating HUD copy (prompts, toasts, labels).
  if (!document.getElementById('float-info-text-style')) {
    const floatInfoStyle = document.createElement('style')
    floatInfoStyle.id = 'float-info-text-style'
    floatInfoStyle.textContent = `
.float-info-text {
  font-family: monospace;
  font-size: 12px;
  line-height: 1.45;
  letter-spacing: 0.4px;
  color: rgba(255,255,255,0.94);
  opacity: 0.96;
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  text-shadow: 0 1px 4px rgba(0,0,0,1), 0 2px 8px rgba(0,0,0,1), 0 0 16px rgba(0,0,0,0.95), 0 3px 14px rgba(0,0,0,0.85);
}
/* Waypoint / target-dir arrows + Tab-lock reticle box */
.hud-dir-shadow {
  filter:
    drop-shadow(0 1px 2px rgba(0,0,0,1))
    drop-shadow(0 2px 5px rgba(0,0,0,0.95))
    drop-shadow(0 0 8px rgba(0,0,0,0.75));
}
.float-info-text .hud-glitch-text {
  color: inherit;
  text-shadow: inherit;
  font: inherit;
  letter-spacing: inherit;
}
#probe-scan-panel {
  position: fixed; left: 56px; top: 50%; transform: translateY(-50%);
  width: min(300px, 30vw); max-height: min(55vh, 420px);
  display: none; flex-direction: column;
  z-index: 12; pointer-events: none;
  text-align: left;
  opacity: 1; /* lines carry the fade */
}
#probe-scan-panel .psp-body {
  padding: 0; overflow-y: auto;
  scrollbar-width: none;
}
#probe-scan-panel .psp-body .psp-line { margin: 0 0 5px; opacity: 0.94; }
#probe-scan-panel .psp-body .psp-line.kicker {
  color: rgba(255,255,255,0.98); letter-spacing: 0.5px; margin-bottom: 8px;
  font-size: 12px; opacity: 0.98;
}
`
    document.head.appendChild(floatInfoStyle)
  }
  const floatBandTop = getFloatHudBandTopPx()
  const belowStatusCss = `position:fixed;left:50%;top:${floatBandTop}px;transform:translateX(-50%);display:none;white-space:nowrap;z-index:20;text-align:center;`

  // Interaction prompts — stacked just below the top-center ship status panel.
  dockPromptEl = document.createElement('div')
  dockPromptEl.id = 'dock-prompt'
  dockPromptEl.className = 'float-info-text'
  dockPromptEl.style.cssText = belowStatusCss
  appEl.appendChild(dockPromptEl)

  probePromptEl = document.createElement('div')
  probePromptEl.id = 'probe-prompt'
  probePromptEl.className = 'float-info-text'
  probePromptEl.style.cssText = belowStatusCss
  appEl.appendChild(probePromptEl)

  // Floating multi-line probe return readout (not a blocking alert dialog).
  probeResultsEl = document.createElement('div')
  probeResultsEl.id = 'probe-results'
  probeResultsEl.className = 'float-info-text'
  probeResultsEl.style.cssText = [
    'position:fixed',
    `top:${floatBandTop}px`,
    'left:50%',
    'transform:translateX(-50%)',
    'max-width:min(520px,90vw)',
    'text-align:center',
    'display:none',
    'pointer-events:none',
    'z-index:20',
    'white-space:pre-line'
  ].join(';')
  appEl.appendChild(probeResultsEl)

  // F5 hail response — same floating-band styling as probe results, its own
  // element so a hail and a probe return can't clobber each other's timer.
  hailResultsEl = document.createElement('div')
  hailResultsEl.id = 'hail-results'
  hailResultsEl.className = 'float-info-text'
  hailResultsEl.style.cssText = [
    'position:fixed',
    `top:${floatBandTop}px`,
    'left:50%',
    'transform:translateX(-50%)',
    'max-width:min(520px,90vw)',
    'text-align:center',
    'display:none',
    'pointer-events:none',
    'z-index:20',
    'white-space:pre-line'
  ].join(';')
  appEl.appendChild(hailResultsEl)

  // Probe classification as floating faded-white text on the left of the screen
  // (inset from the border). Visible only in probe range of a scanned body.
  probeScanPanelEl = document.createElement('div')
  probeScanPanelEl.id = 'probe-scan-panel'
  probeScanPanelEl.className = 'float-info-text'
  probeScanPanelEl.innerHTML = `<div class="psp-body"></div>`
  appEl.appendChild(probeScanPanelEl)
  // bodyId → classification lines (cached after first successful probe)
  probeScanCache = new Map()
  probeScanActiveBodyId = null

  wreckPromptEl = document.createElement('div')
  wreckPromptEl.id = 'wreck-prompt'
  wreckPromptEl.className = 'float-info-text'
  wreckPromptEl.style.cssText = belowStatusCss
  wreckPromptEl.textContent = 'Press F to salvage wreck'
  appEl.appendChild(wreckPromptEl)

  // Mining / salvage toasts — same under-status-panel band / probe-info look.
  miningToastEl = document.createElement('div')
  miningToastEl.id = 'mining-toast'
  miningToastEl.className = 'float-info-text'
  // No z-index override — shares belowStatusCss's z-index:20 with every other
  // stacked prompt so none of them can render on top of another mid-transition.
  miningToastEl.style.cssText =
    `${belowStatusCss}max-width:min(640px,92vw);white-space:normal;pointer-events:none;`
  appEl.appendChild(miningToastEl)

  // Craft start/complete floating text — just below ship status.
  // Wall-clock hide so it works while docked (simTime freezes in the bay).
  craftToastEl = document.createElement('div')
  craftToastEl.id = 'craft-toast'
  craftToastEl.className = 'float-info-text'
  craftToastEl.style.cssText =
    `${belowStatusCss}max-width:min(720px,90vw);white-space:normal;pointer-events:none;`
  appEl.appendChild(craftToastEl)

  // "GAME SAVED" — under status panel (probe-info style). Saving from the
  // pause menu (z-index 60, blurred backdrop) is the common case, so this
  // needs to sit above that blur rather than share the other below-status
  // toasts' z-index:20 or it renders invisible behind the menu.
  saveToastEl = document.createElement('div')
  saveToastEl.id = 'save-toast'
  saveToastEl.className = 'float-info-text'
  // Bigger + glowing — inline style overrides .float-info-text's font-size/
  // text-shadow on this element only (the child .hud-glitch-text span inherits
  // whatever is set here, per its own `font: inherit; text-shadow: inherit`).
  saveToastEl.style.cssText =
    `${belowStatusCss}pointer-events:none;z-index:65;` +
    'font-size:24px;text-shadow:0 0 6px rgba(255,255,255,0.95),0 0 14px rgba(120,220,255,0.9),' +
    '0 0 26px rgba(120,220,255,0.65),0 0 44px rgba(120,220,255,0.35),0 2px 6px rgba(0,0,0,0.9);'
  appEl.appendChild(saveToastEl)

  // Combat: red edge vignettes for incoming fire direction (screen-relative).
  damageVignetteEl = document.createElement('div')
  damageVignetteEl.id = 'damage-vignette'
  damageVignetteEl.innerHTML = `
    <div class="dv-edge left"></div>
    <div class="dv-edge right"></div>
    <div class="dv-edge top"></div>
    <div class="dv-edge bottom"></div>
  `
  const dvStyle = document.createElement('style')
  dvStyle.textContent = `
#damage-vignette {
  position: fixed; inset: 0; pointer-events: none; z-index: 9;
}
#damage-vignette .dv-edge {
  position: absolute; opacity: 0;
  transition: opacity 0.04s linear;
}
#damage-vignette .dv-edge.left {
  left: 0; top: 0; bottom: 0; width: 32%;
  background: linear-gradient(to right,
    rgba(160, 12, 22, 0.78) 0%,
    rgba(120, 8, 16, 0.35) 45%,
    transparent 100%);
}
#damage-vignette .dv-edge.right {
  right: 0; top: 0; bottom: 0; width: 32%;
  background: linear-gradient(to left,
    rgba(160, 12, 22, 0.78) 0%,
    rgba(120, 8, 16, 0.35) 45%,
    transparent 100%);
}
#damage-vignette .dv-edge.top {
  top: 0; left: 0; right: 0; height: 26%;
  background: linear-gradient(to bottom,
    rgba(160, 12, 22, 0.7) 0%,
    rgba(120, 8, 16, 0.3) 50%,
    transparent 100%);
}
#damage-vignette .dv-edge.bottom {
  bottom: 0; left: 0; right: 0; height: 26%;
  background: linear-gradient(to top,
    rgba(160, 12, 22, 0.7) 0%,
    rgba(120, 8, 16, 0.3) 50%,
    transparent 100%);
}
`
  document.head.appendChild(dvStyle)
  appEl.appendChild(damageVignetteEl)

  factionToastEl = document.createElement('div')
  factionToastEl.id = 'faction-toast'
  factionToastEl.className = 'float-info-text'
  factionToastEl.style.cssText =
    `${belowStatusCss}max-width:min(640px,92vw);white-space:normal;`
  appEl.appendChild(factionToastEl)

  // Reticles keep coloured geometry; labels match probe-info floating text.
  // Direction arrows + target box share .hud-dir-shadow for a hard black drop shadow.
  waypointEl = document.createElement('div')
  waypointEl.id = 'waypoint-indicator'
  waypointEl.style.cssText = 'position:fixed;pointer-events:none;display:none;'
  waypointEl.innerHTML = `
    <div class="wp-arrow hud-dir-shadow" style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:16px solid #7fe0a0;margin:0 auto;"></div>
    <div class="wp-label float-info-text" style="margin-top:4px;white-space:nowrap;text-align:center;"></div>
  `
  appEl.appendChild(waypointEl)

  crosshairEl = document.createElement('div')
  crosshairEl.id = 'crosshair'
  crosshairEl.style.cssText =
    'position:fixed;pointer-events:none;display:none;transform:translate(-50%,-50%);width:16px;height:16px;'
  crosshairEl.innerHTML = `
    <div style="position:absolute;inset:0;border:1.5px solid #7fe0a0;border-radius:50%;opacity:0.85;"></div>
    <div style="position:absolute;left:50%;top:50%;width:3px;height:3px;background:#7fe0a0;transform:translate(-50%,-50%);border-radius:50%;"></div>
  `
  appEl.appendChild(crosshairEl)

  targetIndicatorEl = document.createElement('div')
  targetIndicatorEl.id = 'target-indicator'
  targetIndicatorEl.style.cssText =
    'position:fixed;pointer-events:none;display:none;transform:translate(-50%,-50%);width:56px;height:56px;'
  targetIndicatorEl.innerHTML = `
    <div class="target-box hud-dir-shadow" style="position:absolute;inset:0;border:2px solid var(--ui-text);"></div>
    <div class="target-label float-info-text" style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;white-space:nowrap;text-align:center;"></div>
  `
  appEl.appendChild(targetIndicatorEl)

  // Direction cue anchored near the projected ship (not on the target itself).
  // Hidden when nothing is Tab-targeted. Arrow keeps reticle colour.
  targetDirEl = document.createElement('div')
  targetDirEl.id = 'target-dir-indicator'
  targetDirEl.style.cssText =
    'position:fixed;pointer-events:none;display:none;transform:translate(-50%,-50%);z-index:6;'
  targetDirEl.innerHTML = `
    <div class="tdir-arrow hud-dir-shadow" style="width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:14px solid var(--ui-text);"></div>
  `
  appEl.appendChild(targetDirEl)

  // Drive status (supercruise / hyperdrive) — under ship status panel.
  // Glitch enter/exit + chromatic slices.
  cruiseIndicatorEl = document.createElement('div')
  cruiseIndicatorEl.id = 'cruise-indicator'
  cruiseIndicatorEl.className = 'float-info-text'
  cruiseIndicatorEl.style.cssText = belowStatusCss
  setHudGlitchText(cruiseIndicatorEl, 'SUPERCRUISE ENGAGED')
  appEl.appendChild(cruiseIndicatorEl)

  // Reused for both the hyperspace punch and the dock/undock transition —
  // background color is set explicitly wherever each effect triggers.
  jumpFlashEl = document.createElement('div')
  jumpFlashEl.id = 'jump-flash'
  jumpFlashEl.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;display:none;z-index:38;'
  appEl.appendChild(jumpFlashEl)

  // Opaque black veil across the system swap (fade in → hold → fade out).
  jumpBlackEl = document.createElement('div')
  jumpBlackEl.id = 'jump-black'
  jumpBlackEl.style.cssText =
    'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;display:none;z-index:39;'
  appEl.appendChild(jumpBlackEl)

  nextAmbientSpawnAt = gameState.simTime + AMBIENT_SPAWN_INTERVAL_S
  audio.startAmbientMusic()

  if (offlineCraftDone.length) toastCraftCompleted(offlineCraftDone)
  if (anomaliesRefreshedOffline) {
    flashToast('Spatial anomalies refreshed while you were away', 4.5)
  }

  // Restore free-flight pose or re-dock at the station saved in the file.
  restoreSessionLocation()

  // Brand-new games enter flight mode; loads keep docked/space state from save
  // and do not force pointer lock.
  if (enterFlightMode && !docked) reenterFlightMode()
}

function returnToMenu() {
  clearSession()
  gameState = null
  startMenuBackground()
  hasSave().then((exists) => menu.show(exists))
}

// Only stations and settlements are dockable — never bare planets/moons.
function isDockable(body) {
  return body.kind === 'station' || body.kind === 'settlement'
}

// Dock when within DOCK_RANGE of the body centre, but never inside the
// collision shell / visual bulk (so large stations stay reachable and
// undock exits remain re-dockable without diving back into the mesh).
function dockRangeFor(body) {
  const bodyRadius = collisionRadiusFor(body) ?? 0
  const shipR = getShipCollisionRadius(playerShipClass)
  const shell = bodyRadius + shipR + DOCK_RANGE_COLLISION_MARGIN
  if (body.kind === 'station' || body.kind === 'settlement') {
    const visual = exteriorRadiusFor(body) ?? bodyRadius
    const outsideVisual = visual + shipR + DOCK_RANGE_COLLISION_MARGIN + 80
    return Math.max(DOCK_RANGE, shell, outsideVisual)
  }
  return Math.max(DOCK_RANGE, shell)
}

/**
 * Where supercruise should drop out around a waypoint body.
 * Stations/settlements: inside dockRange for F-to-dock.
 * Asteroid fields: near field centre (fraction of scatter radius), not at the edge.
 */
function supercruiseArrivalRangeFor(body) {
  const shipR = getShipCollisionRadius(playerShipClass)

  // Belts: rocks fill body.radius around the field origin — drop well inside.
  if (body.kind === 'asteroidField') {
    const fieldR = Math.max(40, body.radius ?? 120)
    return Math.max(60, Math.min(fieldR * 0.28, fieldR - 25) + shipR * 0.25)
  }

  // Warp gates: drop well inside the 2 km F-activate bubble.
  if (body.kind === 'warpGate') {
    return Math.max(400, Math.min(900, WARP_GATE_ACTIVATION_RANGE * 0.4 + shipR))
  }

  const bodyRadius = collisionRadiusFor(body) ?? 0
  const shell = bodyRadius + shipR
  const dockR = dockRangeFor(body)
  const span = Math.max(0, dockR - shell)
  // Prefer ~half the dock bubble (or a modest clear past the shell) — never
  // near the outer dock edge, where tiny overshoot left players unable to F-dock.
  let preferred
  if (span > SUPERCRUISE_ARRIVAL_MIN_CLEAR * 2) {
    preferred = shell + Math.max(SUPERCRUISE_ARRIVAL_MIN_CLEAR, span * 0.45)
  } else {
    preferred = Math.max(shell + 12, dockR - SUPERCRUISE_DOCK_INNER_SLACK)
  }
  // Always leave a solid margin inside dock range (and outside the shell).
  const minR = shell + Math.min(SUPERCRUISE_ARRIVAL_MIN_CLEAR, Math.max(12, span * 0.25))
  const maxR = Math.max(minR, dockR - Math.max(SUPERCRUISE_DOCK_INNER_SLACK, span * 0.2))
  return Math.min(maxR, Math.max(minR, preferred))
}

// Special waypoint id for the system star (local origin) — not a real body.
const SYSTEM_STAR_WAYPOINT_ID = 'system-star'

function findNearbyDockableBody() {
  const playerPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  let nearest = null
  let nearestDist = Infinity
  for (const body of currentSystem.bodies) {
    if (!isDockable(body)) continue
    const dist = playerPos.distanceTo(new THREE.Vector3().fromArray(body.position))
    if (dist < dockRangeFor(body) && dist < nearestDist) {
      nearest = body
      nearestDist = dist
    }
  }
  return nearest
}

// Surface-distance window for the top-center "Nearest Body" HUD line.
// Wide enough to catch approach before dock/probe range; uses shell radius so
// huge planets don't stay "far" until you're already on the crust.
const NEAREST_BODY_HUD_RANGE = 3500
const HUD_NEAREST_KINDS = new Set(['planet', 'moon', 'station', 'settlement'])

/** Closest planet / moon / station / settlement / star within surface range. */
function findNearestHudBody() {
  if (!gameState) return null
  const playerPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!currentSystem) return null

  let nearest = null
  let nearestSurface = Infinity

  for (const body of currentSystem.bodies) {
    if (!HUD_NEAREST_KINDS.has(body.kind)) continue
    const dist = playerPos.distanceTo(new THREE.Vector3().fromArray(body.position))
    const surfaceDist = Math.max(0, dist - (collisionRadiusFor(body) ?? 0))
    if (surfaceDist < NEAREST_BODY_HUD_RANGE && surfaceDist < nearestSurface) {
      nearest = body
      nearestSurface = surfaceDist
    }
  }

  // System sun at local origin (not a body in the list).
  const starDist = playerPos.length()
  const starR = starShellRadius()
  const starSurface = Math.max(0, starDist - starR)
  if (starSurface < NEAREST_BODY_HUD_RANGE && starSurface < nearestSurface) {
    nearest = {
      id: SYSTEM_STAR_WAYPOINT_ID,
      name: currentSystem.name,
      kind: 'star'
    }
  }

  return nearest
}

// Salvage (F) range from wreck origin (1 km).
const LOOT_RANGE = 1000

function findNearbyWreck() {
  const playerPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  let nearest = null
  let nearestDist = Infinity
  for (const wreck of gameState.wrecks) {
    const dist = playerPos.distanceTo(new THREE.Vector3().fromArray(wreck.position))
    if (dist < LOOT_RANGE && dist < nearestDist) {
      nearest = wreck
      nearestDist = dist
    }
  }
  return nearest
}

/** Human-readable loot list for floating toasts (cargo, parts, weapons, BPs, books). */
function formatLootSummary(loot) {
  if (!loot) return 'nothing'
  const bits = []
  for (const [id, qty] of Object.entries(loot.cargo ?? {})) {
    if (!qty) continue
    try {
      bits.push(`${qty} ${getGood(id).name}`)
    } catch {
      bits.push(`${qty} cargo`)
    }
  }
  if (loot.shipParts) {
    bits.push(`${loot.shipParts} Ship Part${loot.shipParts > 1 ? 's' : ''}`)
  }
  for (const [id, qty] of Object.entries(loot.weapons ?? {})) {
    if (!qty) continue
    try {
      bits.push(`${qty}× ${getWeapon(id).name}`)
    } catch {
      bits.push(`${qty}× weapon`)
    }
  }
  for (const [id, qty] of Object.entries(loot.blueprints ?? {})) {
    if (!qty) continue
    try {
      bits.push(`${qty}× ${getBlueprint(id).name}`)
    } catch {
      bits.push(`${qty}× blueprint`)
    }
  }
  for (const [id, qty] of Object.entries(loot.skillbooks ?? {})) {
    if (!qty) continue
    try {
      bits.push(`${qty}× ${getSkillDef(id).bookName}`)
    } catch {
      bits.push(loot.skillbookName ? `${qty}× ${loot.skillbookName}` : `${qty}× skillbook`)
    }
  }
  if (!bits.length) return 'nothing'
  if (bits.length === 1) return bits[0]
  if (bits.length === 2) return `${bits[0]} and ${bits[1]}`
  return `${bits.slice(0, -1).join(', ')}, and ${bits[bits.length - 1]}`
}

function lootNearbyWreck(wreck) {
  try {
    const loot = lootWreck(gameState, playerShipClass, wreck.id)
    audio.playClick()
    setHudGlitchText(miningToastEl, `Salvaged ${formatLootSummary(loot)} from the wreck`)
    showHudGlitch(miningToastEl)
    miningToastUntil = gameState.simTime + MINING_TOAST_DURATION_S
  } catch {
    flashToast('Wreck no longer there', 1.4)
  }
}


// Ad-hoc event toasts (wave clears, hacks, target-lock, etc.) each get their
// own element instead of sharing one — back-to-back calls in the same frame
// (e.g. entering a guarded anomaly fires an "entered" toast and an "ambush"
// toast together) used to clobber each other on a single shared div. Newest
// stacks in below the persistent status toasts; updateBelowRadarPrompts()
// pushes older ones further down and prunes expired ones every frame.
const MAX_STACKED_TOASTS = 4
const toastQueue = []

function flashToast(text, durationS = MINING_TOAST_DURATION_S) {
  if (!gameState) return
  const el = document.createElement('div')
  el.className = 'float-info-text'
  el.style.cssText =
    'position:fixed;left:50%;transform:translateX(-50%);display:none;z-index:20;text-align:center;max-width:min(640px,92vw);white-space:normal;pointer-events:none;'
  appEl.appendChild(el)
  setHudGlitchText(el, text)
  showHudGlitch(el)
  toastQueue.push({ el, until: gameState.simTime + durationS })
  while (toastQueue.length > MAX_STACKED_TOASTS) {
    const oldest = toastQueue.shift()
    expireToast(oldest)
  }
}

function expireToast(item) {
  hideHudGlitch(item.el)
  setTimeout(() => item.el.remove(), HUD_GLITCH_EXIT_MS)
}

/** Drop toasts past their timer — called once per frame from updateBelowRadarPrompts. */
function pruneToastQueue() {
  if (!gameState) return
  for (let i = toastQueue.length - 1; i >= 0; i--) {
    if (gameState.simTime >= toastQueue[i].until) {
      expireToast(toastQueue[i])
      toastQueue.splice(i, 1)
    }
  }
}

// F5: hail the current Tab-lock target. Flavour only — no gameplay effect,
// matches AGENTS.md's "gameNotice/gamePrompt over browser dialogs" but here a
// blocking modal would be wrong too: it would freeze flight input mid-hail,
// so this reuses the non-blocking floating-band pattern probe results use.
function hailCurrentTarget() {
  if (!gameState || docked || paused) return
  if (currentTarget?.kind !== 'npc') {
    flashToast('No target locked to hail')
    return
  }
  const npc = gameState.npcs.find((n) => n.id === currentTarget.id && !n.destroyed)
  if (!npc) {
    flashToast('No response — target lost')
    return
  }
  const { speaker, line } = buildHailResponse(npc)
  if (!hailResultsEl) return
  setHudGlitchText(hailResultsEl, `${speaker}:\n"${line}"`)
  const span = hailResultsEl.querySelector('.hud-glitch-text')
  if (span) span.style.whiteSpace = 'pre-line'
  showHudGlitch(hailResultsEl)
  hailResultsUntil = gameState.simTime + 6
  audio.playClick()
}

// Missions pay out on objective complete (no station turn-in).
setMissionCompletedHandler((info) => {
  // Probe contracts chime when floating probe results show (finishProbeResults),
  // so the sound lands with the "Mission complete" line — not mid-scan.
  if (info?.type !== 'probe') audio.playMissionComplete()
  const title = info?.title || 'Contract'
  const where = info?.giverBodyName
    ? `${info.giverBodyName}${info.giverSystemName ? ` · ${info.giverSystemName}` : ''}`
    : 'mission board'
  const reward = Math.max(0, Math.floor(Number(info?.reward) || 0))
  flashToast(`Mission complete: ${title} · +${reward}cr · from ${where}`, 5.5)
})

function showCraftToast(text, durationMs = 5500) {
  if (!craftToastEl) return
  setHudGlitchText(craftToastEl, text)
  showHudGlitch(craftToastEl)
  clearTimeout(craftToastHideTimer)
  craftToastHideTimer = setTimeout(() => {
    hideHudGlitch(craftToastEl)
  }, durationMs)
}

function toastCraftCompleted(jobs) {
  if (!jobs.length) return
  audio.playCraftComplete()
  // One floating line — last job if several finished the same tick (rare).
  const job = jobs[jobs.length - 1]
  let item = job.blueprintId
  try {
    item = getBlueprint(job.blueprintId).itemName
  } catch { /* */ }
  const extra = jobs.length > 1 ? ` (+${jobs.length - 1} more)` : ''
  showCraftToast(
    `Assembly complete: ${item} ready at ${job.stationName} (${job.systemName})${extra}`,
    6500
  )
}

function isProbeable(body) {
  return body.kind === 'planet' || body.kind === 'moon' || body.kind === 'asteroidField'
}

function probeScanRadius(body) {
  if (body.kind === 'star') return starShellRadius()
  return collisionRadiusFor(body) ?? 20
}

// Near enough to a planet/moon to probe from "orbit".
function isInOrbitOfBody(body) {
  if (!body || (body.kind !== 'planet' && body.kind !== 'moon')) return false
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const bodyPos = new THREE.Vector3().fromArray(body.position)
  const capture = (collisionRadiusFor(body) ?? 0) + PROBE_ORBIT_MARGIN
  return shipPos.distanceTo(bodyPos) < capture
}

// Near enough to the system sun for solar probe.
function isInSolarOrbit() {
  const [x, , z] = gameState.player.ship.position
  const r = Math.hypot(x, z)
  return r >= 3000 && r <= STAR_ORBITAL_CARRY_RADIUS
}

function makeStarProbeBody() {
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  // Per-system probe key so exhausting one sun doesn't block every system star,
  // and counts stay stable (not a shared global 'system-star' bucket).
  const starProbeId = `${gameState.player.currentSystemId}:${SYSTEM_STAR_WAYPOINT_ID}`
  return {
    id: starProbeId,
    name: currentSystem?.name ?? 'System',
    kind: 'star',
    position: [0, 0, 0]
  }
}

// Close-range probe (belts / flyby): surface distance for large worlds.
function findNearbyProbeableBody() {
  const playerPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  let nearest = null
  let nearestDist = Infinity
  for (const body of currentSystem.bodies) {
    if (!isProbeable(body)) continue
    const dist = playerPos.distanceTo(new THREE.Vector3().fromArray(body.position))
    const surfaceDist = Math.max(0, dist - (collisionRadiusFor(body) ?? 0))
    if (surfaceDist < PROBE_RANGE && surfaceDist < nearestDist) {
      nearest = body
      nearestDist = surfaceDist
    }
  }
  return nearest
}

// Prefer: Tab-target planet/moon/star while in its orbit. Else nearby belt/body.
function getProbeLaunchTarget() {
  if (currentTarget?.kind === 'star' && isInSolarOrbit()) {
    return { body: makeStarProbeBody(), viaOrbit: true }
  }
  if (currentTarget?.kind === 'body') {
    const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const body = currentSystem.bodies.find((b) => b.id === currentTarget.id)
    if (body && (body.kind === 'planet' || body.kind === 'moon') && isInOrbitOfBody(body)) {
      return { body, viaOrbit: true }
    }
  }
  const nearby = findNearbyProbeableBody()
  return nearby ? { body: nearby, viaOrbit: false } : null
}

// Launch a tiny probe mesh that flies to the body, scans for PROBE_SCAN_S,
// returns, then yields results (missions / survey data). Instant results
// felt weightless; the flight + 10s scan sells "actually surveying".
// Cap: MAX_PROBE_ATTEMPTS per body — further launches get a floating denial.
// Attempts are reserved at launch (not return) so aborted probes still consume a slot.
function probeBody(body) {
  if (probeEffect) return

  // Ensure the map exists even on older in-memory states / partial loads.
  gameState.probeCounts ??= {}
  if (!canProbeBody(gameState, body.id)) {
    showFloatingProbeResults([probeExhaustedMessage(body.name)])
    return
  }

  // Snapshot before record: fully scanned + open mission → one free re-probe.
  const missionOnlyReprobe = isMissionOnlyReprobe(gameState, body.id)
  const n = recordProbeAttempt(gameState, body.id)

  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const bodyPos = new THREE.Vector3().fromArray(body.position)
  const toShip = shipPos.clone().sub(bodyPos)
  if (toShip.lengthSq() < 1e-6) toShip.set(0, 0, 1)
  else toShip.normalize()
  const bodyRadius = probeScanRadius(body)
  const scanPos = bodyPos.clone().addScaledVector(toShip, bodyRadius + PROBE_SCAN_STANDOFF)

  // Eject slightly ahead of the ship nose so the probe doesn't spawn inside hull.
  const shipQuat = new THREE.Quaternion().fromArray(gameState.player.ship.quaternion)
  const launchPos = shipPos.clone().add(new THREE.Vector3(0, 0, 4).applyQuaternion(shipQuat))

  const mesh = buildProbeMesh()
  mesh.position.copy(launchPos)
  mesh.quaternion.copy(quatFacing(launchPos, scanPos))
  scene.add(mesh)

  probeEffect = {
    phase: 'outbound',
    elapsed: 0,
    body,
    mesh,
    launchPos: launchPos.clone(),
    scanPos,
    bodyPos,
    returnStart: null,
    // Snapshot at launch — scan phase completes the mission before return, so
    // finishProbeResults cannot re-detect "open mission target" on the way back.
    attemptNumber: n,
    missionTargetAtLaunch: isActiveMissionProbeTarget(gameState, body.id),
    missionOnlyReprobe
  }
  audio.playProbeLaunch()
  if (missionOnlyReprobe) {
    flashToast(`Mission re-scan of ${body.name}… (no additional finds)`, 2.4)
  } else {
    flashToast(`Probe launched toward ${body.name}… (${n}/${MAX_PROBE_ATTEMPTS})`, 2.2)
  }
}

function showFloatingProbeResults(messages) {
  if (!probeResultsEl || !messages.length) return
  // Single glitch line (joined) so enter/exit + chromatic slices match other HUD text.
  setHudGlitchText(probeResultsEl, messages.join('\n'))
  const span = probeResultsEl.querySelector('.hud-glitch-text')
  if (span) span.style.whiteSpace = 'pre-line'
  showHudGlitch(probeResultsEl)
  // Stay long enough to read multi-line mission results; dismiss with glitch (no fade).
  const hold = Math.min(14, 5.5 + messages.length * 1.4)
  probeResultsUntil = (gameState?.simTime ?? 0) + hold
}

function showProbeScanPanel(lines, bodyId = null) {
  if (!probeScanPanelEl || !lines?.length) return
  if (bodyId && probeScanCache) probeScanCache.set(String(bodyId), lines)
  const bodyEl = probeScanPanelEl.querySelector('.psp-body')
  bodyEl.innerHTML = lines
    .map((line, i) => `<div class="psp-line${i === 0 ? ' kicker' : ''}">${escapeHtmlProbe(line)}</div>`)
    .join('')
  probeScanPanelEl.style.display = 'flex'
  if (bodyId) probeScanActiveBodyId = String(bodyId)
}

/** True if ship is within probe range of body (orbit margin or surface distance). */
function isInProbeDisplayRange(body) {
  if (!body || !gameState) return false
  if (body.kind === 'star') return isInSolarOrbit()
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const bodyPos = new THREE.Vector3().fromArray(body.position)
  const dist = shipPos.distanceTo(bodyPos)
  const shell = collisionRadiusFor(body) ?? 0
  if (body.kind === 'planet' || body.kind === 'moon') {
    return dist < shell + PROBE_ORBIT_MARGIN
  }
  // Asteroid belts: show while inside the field or near the outer edge.
  if (body.kind === 'asteroidField') {
    return dist < shell + PROBE_RANGE
  }
  return Math.max(0, dist - shell) < PROBE_RANGE
}

/** Whether this body was previously probed (persists across sessions). */
function hasBeenProbed(bodyId) {
  if (!gameState || bodyId == null) return false
  const key = String(bodyId)
  if ((gameState.probeCounts?.[key] ?? 0) > 0) return true
  if ((gameState.probeCounts?.[bodyId] ?? 0) > 0) return true
  return (gameState.probedBodyIds ?? []).some((id) => String(id) === key)
}

/**
 * Cached or regenerated survey lines for a body that was already probed.
 * Regenerates from probeSurveyReport so re-entry works after load / cache clear.
 */
function getOrRebuildProbeScanLines(body, system) {
  if (!body) return null
  const key = String(body.id)
  if (probeScanCache?.has(key)) return probeScanCache.get(key)
  if (!hasBeenProbed(body.id)) return null
  const report = probeSurveyReport(body, system)
  if (report?.length && probeScanCache) probeScanCache.set(key, report)
  return report?.length ? report : null
}

/**
 * Floating scan text on the left of the screen (inset from the border).
 * Shown only while in probe range of a body that has already been scanned;
 * hides when you leave that range and reappears when you return.
 */
function updateProbeScanFloat() {
  if (!probeScanPanelEl || !gameState || docked) {
    if (probeScanPanelEl) probeScanPanelEl.style.display = 'none'
    return
  }
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  let showBody = null
  let lines = null

  // Prefer Tab-target if scanned + in range
  if (currentTarget?.kind === 'body' && currentSystem) {
    const b = currentSystem.bodies.find((x) => x.id === currentTarget.id)
    if (b && isInProbeDisplayRange(b)) {
      const report = getOrRebuildProbeScanLines(b, currentSystem)
      if (report) {
        showBody = b
        lines = report
      }
    }
  }
  if (!showBody && currentTarget?.kind === 'star' && isInSolarOrbit()) {
    const starBody = makeStarProbeBody()
    if (isInProbeDisplayRange(starBody)) {
      const report = getOrRebuildProbeScanLines(starBody, currentSystem)
      if (report) {
        showBody = starBody
        lines = report
      }
    }
  }
  // Else any nearby scanned probeable (planet / moon / belt / star)
  if (!showBody && currentSystem) {
    // Star first if in solar orbit
    if (isInSolarOrbit()) {
      const starBody = makeStarProbeBody()
      const report = getOrRebuildProbeScanLines(starBody, currentSystem)
      if (report) {
        showBody = starBody
        lines = report
      }
    }
  }
  if (!showBody && currentSystem) {
    let best = Infinity
    for (const b of currentSystem.bodies) {
      if (!isProbeable(b)) continue
      if (!isInProbeDisplayRange(b)) continue
      const report = getOrRebuildProbeScanLines(b, currentSystem)
      if (!report) continue
      const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
      const dist = shipPos.distanceTo(new THREE.Vector3().fromArray(b.position))
      if (dist < best) {
        best = dist
        showBody = b
        lines = report
      }
    }
  }

  if (!showBody || !lines?.length) {
    probeScanPanelEl.style.display = 'none'
    probeScanActiveBodyId = null
    return
  }

  if (probeScanActiveBodyId !== String(showBody.id)) {
    showProbeScanPanel(lines, showBody.id)
  } else {
    probeScanPanelEl.style.display = 'flex'
  }

  // Fixed left of screen — inset from border, vertically mid-view (not flush to edge).
  const leftInset = Math.max(48, Math.round(window.innerWidth * 0.045))
  probeScanPanelEl.style.left = `${leftInset}px`
  probeScanPanelEl.style.top = '50%'
  probeScanPanelEl.style.transform = 'translateY(-50%)'
}

// Tiny local escape so the panel can show probe text without importing UI helpers early.
function escapeHtmlProbe(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function finishProbeResults(
  body,
  attemptNumber = null,
  missionTargetAtLaunch = null,
  missionOnlyReprobe = false
) {
  // Attempt was already reserved at launch — do not double-count here.
  const attempt = attemptNumber ?? probeAttemptCount(gameState, body.id)
  // Prefer launch snapshot: scan phase may already have completed the mission.
  const wasMissionTarget =
    missionTargetAtLaunch != null
      ? !!missionTargetAtLaunch
      : isActiveMissionProbeTarget(gameState, body.id)
  // First probe on a mission body resolves the contract; later probes are normal loot only.
  // Mission re-probe on an already fully scanned body also resolves the contract (no loot).
  const missionFirstProbe = wasMissionTarget && (attempt === 1 || missionOnlyReprobe)
  // Classification dossier only on the first probe of this body (attempt 1).
  const showClassification = attempt === 1 && !missionOnlyReprobe

  // Idempotent if already marked at end of scan phase — completes probe/exploration on first hit.
  markBodyProbed(gameState, body.id)
  // Investigation outcome only on the first probe of an open investigation body.
  // Stars are never investigation targets; re-probes skip mission resolution.
  // Note: if scan already markBodyProbed'd, investigation body phase may still be open
  // until we resolve it here (investigation is not completed by markBodyProbed).
  let investigation = null
  if (body.kind !== 'star' && missionFirstProbe) {
    investigation = resolveInvestigationProbe(gameState, body.id, Math.random)
  }
  updateMissionProgress(gameState)

  // Mission re-probe on a fully scanned body: contract only — no survey/BP/skillbook rolls.
  const result = launchProbe(gameState, playerShipClass, Math.random, {
    forceFind: false,
    noLoot: missionOnlyReprobe
  })

  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)

  // Classification floating text — always cache; show while in probe range.
  const report = probeSurveyReport(body, system)
  if (report?.length) {
    if (probeScanCache) probeScanCache.set(String(body.id), report)
    // First attempt opens immediately; later re-entry also shows via updateProbeScanFloat.
    if (showClassification || isInProbeDisplayRange(body)) {
      showProbeScanPanel(report, body.id)
    }
  }

  // Floating center HUD: mission beat (first hit only) + loot / exhausted.
  const messages = []
  let missionCompleteLine = null
  if (missionFirstProbe) {
    if (investigation?.kind === 'intel') {
      missionCompleteLine = 'Mission complete: Investigation data recovered.'
    } else if (investigation?.kind === 'hostile') {
      messages.push('Probe stirred a hostile contact! Eliminate them to finish the investigation.')
    } else if (investigation?.kind === 'lead') {
      messages.push(
        `The signal traces further — new fix on ${investigation.bodyName} in ${investigation.systemName}.`
      )
    } else {
      // Probe (and exploration) contracts finish on survey; toast already fired at scan end.
      missionCompleteLine = 'Mission complete'
    }
  }

  if (missionCompleteLine) {
    messages.push(missionCompleteLine)
    // Probe contracts skip the scan-end chime; play it with this floating line.
    // Investigation intel already chimed via finishMission → handler.
    if (investigation?.kind !== 'intel') audio.playMissionComplete()
  }

  // Loot lines below mission complete when both apply (never for mission-only re-probe).
  const lootLines = []
  if (!missionOnlyReprobe) {
    if (result.found && result.stored) {
      lootLines.push(
        `Probe found Survey Data at ${body.name}! Added to cargo — transfer to station storage (Storage tab) to sell.`
      )
    } else if (result.found) {
      lootLines.push(`Probe found valuable survey data at ${body.name}, but your cargo hold is full!`)
    }
    if (result.blueprint) {
      lootLines.push(
        `Rare find: ${result.blueprint.name}! Stored in ship blueprints — craft at a station Industry bay.`
      )
    }
    if (result.skillbook) {
      lootLines.push(
        `Skillbook found: ${result.skillbook.name}! Read it under Inventory → Skillbooks.`
      )
    }
  }
  for (const line of lootLines) messages.push(line)

  // "No Data Found" only when this wasn't a mission-complete return and nothing was found.
  if (!missionCompleteLine && lootLines.length === 0 && investigation?.kind !== 'hostile' && investigation?.kind !== 'lead') {
    messages.push('No Data Found')
  }

  if (lootLines.length > 0) {
    audio.playProbeFind()
  }

  if (attempt >= MAX_PROBE_ATTEMPTS) {
    messages.push(probeExhaustedMessage(body.name))
  }

  showFloatingProbeResults(messages)
}

function updateProbeEffect(dt) {
  if (!probeEffect) return
  probeEffect.elapsed += dt
  const { mesh, body } = probeEffect

  // Keep scan hold point tracking the body if it orbits while we wait.
  const liveBodyPos = new THREE.Vector3().fromArray(body.position)
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const toShip = shipPos.clone().sub(liveBodyPos)
  if (toShip.lengthSq() < 1e-6) toShip.set(0, 0, 1)
  else toShip.normalize()
  const bodyRadius = probeScanRadius(body)
  const liveScanPos = liveBodyPos.clone().addScaledVector(toShip, bodyRadius + PROBE_SCAN_STANDOFF)
  probeEffect.scanPos = liveScanPos
  probeEffect.bodyPos = liveBodyPos

  if (probeEffect.phase === 'outbound') {
    const t = Math.min(1, probeEffect.elapsed / PROBE_OUTBOUND_S)
    const lt = easeInOutCubic(t)
    mesh.position.copy(probeEffect.launchPos).lerp(liveScanPos, lt)
    const face = quatFacing(probeEffect.launchPos, liveScanPos)
    updateProbeMesh(mesh, dt, { scanning: false, baseQuat: face })
    if (t >= 1) {
      probeEffect.phase = 'scanning'
      probeEffect.elapsed = 0
      audio.setProbeScanActive(true)
      flashToast(`Scanning ${body.name}…`, PROBE_SCAN_S)
    }
  } else if (probeEffect.phase === 'scanning') {
    mesh.position.copy(liveScanPos)
    // Face the body (+Z toward center) so the nose beam paints the surface.
    const face = quatFacing(liveScanPos, liveBodyPos)
    const scanDist = mesh.position.distanceTo(liveBodyPos)
    // Cap beam visual length; huge worlds would stretch a unit cylinder forever.
    const beamCap = body.kind === 'star' ? 80 : 40
    updateProbeMesh(mesh, dt, { scanning: true, scanDist: Math.min(scanDist, beamCap), baseQuat: face })
    if (probeEffect.elapsed >= PROBE_SCAN_S) {
      // Count the survey as soon as the scan finishes — not only after the
      // probe docks back — so jump/dock/abort mid-return can't strand a probe
      // mission in "in progress" after a successful scan.
      if (!probeEffect.surveyLogged) {
        probeEffect.surveyLogged = true
        markBodyProbed(gameState, body.id)
        updateMissionProgress(gameState)
      }
      probeEffect.phase = 'returning'
      probeEffect.elapsed = 0
      probeEffect.returnStart = mesh.position.clone()
      audio.setProbeScanActive(false)
      audio.playProbeReturn()
      flashToast('Probe returning…', 2.2)
    }
  } else if (probeEffect.phase === 'returning') {
    const t = Math.min(1, probeEffect.elapsed / PROBE_RETURN_S)
    const lt = easeInOutCubic(t)
    // Home on the ship's live position (player may have drifted).
    const home = shipPos.clone().add(
      new THREE.Vector3(0, 0, 3).applyQuaternion(
        new THREE.Quaternion().fromArray(gameState.player.ship.quaternion)
      )
    )
    mesh.position.copy(probeEffect.returnStart).lerp(home, lt)
    const face = quatFacing(probeEffect.returnStart, home)
    updateProbeMesh(mesh, dt, { scanning: false, baseQuat: face })
    if (t >= 1) {
      const finishedBody = body
      const attemptNumber = probeEffect.attemptNumber
      const missionTargetAtLaunch = probeEffect.missionTargetAtLaunch
      const missionOnlyReprobe = !!probeEffect.missionOnlyReprobe
      clearProbeEffect()
      finishProbeResults(finishedBody, attemptNumber, missionTargetAtLaunch, missionOnlyReprobe)
    }
  }
}

/** Surface settlements sit on a planet/moon — radar shows the host only. */
function isPlanetSurfaceSettlement(body) {
  if (body.kind !== 'settlement') return false
  if (body.inAsteroidField) return false
  return !!body.parentId || !!body.surfaceOffset
}

function radarKindForBody(body, isWaypoint, isMission) {
  // Warp gates always paint purple (not mission/waypoint overrides).
  if (body.kind === 'warpGate') return 'gate'
  if (isWaypoint) return 'waypoint'
  if (isMission) return 'mission'
  if (body.kind === 'station') return 'station'
  if (body.kind === 'planet') return 'planet'
  if (body.kind === 'moon') return 'moon'
  if (body.kind === 'asteroidField') return 'belt'
  if (body.kind === 'settlement') return 'station'
  return 'body'
}

// Cap individual belt rocks painted on radar (nearest first).
const RADAR_MAX_ASTEROID_ROCKS = 48

// Scratch for ship-relative radar (heading-up: rotates with the ship).
const _radarShipPos = new THREE.Vector3()
const _radarRel = new THREE.Vector3()
const _radarQuatInv = new THREE.Quaternion()

/**
 * Heading-up radar: contacts in ship-local space so the view turns with the hull.
 * Ship +Z = forward (F), +Y = up, +X = right; negate x for on-screen right.
 * @param {boolean} [targeted] Tab-lock highlight on radar
 */
function pushRadarContact(contacts, worldPos, kind, maxRange = RADAR_RANGE, targeted = false) {
  _radarRel.fromArray(worldPos).sub(_radarShipPos)
  if (_radarRel.length() > maxRange) return false
  _radarRel.applyQuaternion(_radarQuatInv)
  contacts.push({ x: -_radarRel.x, y: _radarRel.y, z: _radarRel.z, kind, targeted: !!targeted })
  return true
}

function computeRadarContacts() {
  const ship = gameState.player.ship
  _radarShipPos.fromArray(ship.position)
  _radarQuatInv.fromArray(ship.quaternion).invert()
  const contacts = []
  const t = currentTarget

  // Ships / NPCs (neutral yellow, hostile red) — one hostility context for all.
  const hostility = buildHostilityContext()
  for (const npc of gameState.npcs) {
    if (npc.destroyed) continue
    const targeted = t?.kind === 'npc' && t.id === npc.id
    pushRadarContact(
      contacts,
      npc.position,
      isHostileToPlayer(npc, hostility) ? 'hostile' : 'neutral',
      RADAR_RANGE,
      targeted
    )
  }

  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!currentSystem) return contacts

  // System star / sun at origin (green with planets/moons)
  {
    const isStarWp = gameState.player.waypointBodyId === SYSTEM_STAR_WAYPOINT_ID
    const targeted = t?.kind === 'star'
    if (isStarWp || targeted || _radarShipPos.length() <= RADAR_RANGE) {
      pushRadarContact(
        contacts,
        [0, 0, 0],
        isStarWp ? 'waypoint' : 'sun',
        isStarWp || targeted ? Infinity : RADAR_RANGE,
        targeted
      )
    }
  }

  const missionBodies = missionMarkedBodyIds(gameState, currentSystem.id)
  const waypointBodyId = gameState.player.waypointBodyId

  // Planets, moons, stations, gates — not surface settlements (host only).
  // Asteroid fields: never show the field centroid; only individual rocks (brown).
  for (const body of currentSystem.bodies) {
    if (isPlanetSurfaceSettlement(body)) continue

    if (body.kind === 'asteroidField') {
      const rocks = getAsteroidRocks(body)
      if (!rocks?.length) continue
      const near = []
      for (let i = 0; i < rocks.length; i++) {
        if (!isRockAlive(gameState, body.id, i)) continue
        const wp = asteroidWorldPosition(body, rocks[i])
        const d = Math.hypot(
          wp[0] - _radarShipPos.x,
          wp[1] - _radarShipPos.y,
          wp[2] - _radarShipPos.z
        )
        const rockTargeted = t?.kind === 'asteroid' && t.fieldId === body.id && t.index === i
        if (d > RADAR_RANGE && !rockTargeted) continue
        near.push({ wp, d, i, rockTargeted })
      }
      near.sort((a, b) => a.d - b.d)
      // Always include locked rock even if beyond the nearest-N cap.
      const picked = near.slice(0, RADAR_MAX_ASTEROID_ROCKS)
      if (t?.kind === 'asteroid' && t.fieldId === body.id) {
        const locked = near.find((n) => n.i === t.index)
        if (locked && !picked.some((n) => n.i === locked.i)) picked.push(locked)
      }
      for (const n of picked) {
        pushRadarContact(contacts, n.wp, 'asteroid', Infinity, n.rockTargeted)
      }
      continue
    }

    const isWaypoint = body.id === waypointBodyId
    const targeted = t?.kind === 'body' && t.id === body.id
    pushRadarContact(
      contacts,
      body.position,
      radarKindForBody(body, isWaypoint, missionBodies.has(body.id)),
      isWaypoint || targeted ? Infinity : RADAR_RANGE,
      targeted
    )
  }

  // Free-space mission waypoint (bounty hunt marker) when no body is set.
  if (gameState.player.waypointPosition && !gameState.player.waypointBodyId) {
    const targeted = t?.kind === 'navpoint'
    pushRadarContact(contacts, gameState.player.waypointPosition, 'mission', Infinity, targeted)
  }

  for (const wreck of gameState.wrecks) {
    const targeted = t?.kind === 'wreck' && t.id === wreck.id
    pushRadarContact(contacts, wreck.position, 'wreck', targeted ? Infinity : RADAR_RANGE, targeted)
  }

  // Fully scanned Spatial Anomaly sites (relic, nodules, exposed alien base).
  ensureSystemAnomalies(currentSystem, gameState.galaxy)
  for (const a of currentSystem.spatialAnomalies ?? []) {
    if (!a.fullyScanned) continue
    if (a.status === 'completed' || a.status === 'despawning') continue
    if (isDatacoreType(a.type)) {
      const targeted = t?.kind === 'anomaly' && t.id === a.id
      pushRadarContact(contacts, a.position, 'datacore', targeted ? Infinity : RADAR_RANGE, targeted)
      for (const n of a.nodules ?? []) {
        if (n.status === 'destroyed') continue
        pushRadarContact(contacts, n.position, 'nodule')
      }
    } else if (a.type === 'alien_incursion' && alienSiteRuntime?.anomalyId === a.id) {
      const targeted = t?.kind === 'anomaly' && t.id === a.id
      pushRadarContact(contacts, a.position, 'alien_base', targeted ? Infinity : RADAR_RANGE, targeted)
    }
  }

  return contacts
}

// Route autopilot: SC → gate → wait 10s (F to skip) → jump → next gate…
const ROUTE_AUTOPILOT_GATE_PAUSE_S = 10
/** @type {{ phase: 'to_gate' | 'gate_wait' | 'jumping', pauseRemaining?: number, nextId?: string, gateId?: string } | null} */
let routeAutopilot = null

function isRouteAutopilotActive() {
  return !!routeAutopilot
}

/**
 * Abort autopilot sequence only — plotted route is kept so the player can
 * resume later (manual F or re-engage autopilot).
 */
function cancelRouteAutopilot(reason) {
  if (!routeAutopilot) return
  routeAutopilot = null
  if (cruiseIndicatorEl) {
    cruiseIndicatorEl.style.display = 'none'
    cruiseIndicatorEl.style.opacity = '0'
  }
  if (reason) flashToast(reason)
}

/** After SC drop (or already in range): 10s pause before auto-jump; F skips. */
function armRouteAutopilotGateWait(nextId, gate) {
  if (cruising) {
    cruising = false
    gameState.player.ship.velocity = [0, 0, 0]
    gameState.player.ship.throttle = 0
  }
  gameState.player.waypointBodyId = null
  gameState.player.waypointPosition = null
  routeAutopilot = {
    phase: 'gate_wait',
    pauseRemaining: ROUTE_AUTOPILOT_GATE_PAUSE_S,
    nextId,
    gateId: gate.id
  }
  const destSys = getSystem(gameState.galaxy, nextId)
  flashToast(
    `Autopilot: jump in ${ROUTE_AUTOPILOT_GATE_PAUSE_S}s — press F to jump now`,
    3.2
  )
  setHudGlitchText(
    cruiseIndicatorEl,
    destSys
      ? `AUTOPILOT · JUMP ${ROUTE_AUTOPILOT_GATE_PAUSE_S}s · ${destSys.name}`
      : `AUTOPILOT · JUMP ${ROUTE_AUTOPILOT_GATE_PAUSE_S}s`
  )
  showHudGlitch(cruiseIndicatorEl)
}

/** Set waypoint on the gate for the next plotted hop and engage supercruise. */
function startRouteAutopilotCruiseToGate() {
  ensureWarpGates(gameState.galaxy)
  const rem = gameState.player.plottedRoute
  if (!Array.isArray(rem) || rem.length === 0) {
    cancelRouteAutopilot('Route complete')
    return false
  }
  if (!shipHasAutopilot(gameState.player.ship)) {
    cancelRouteAutopilot('Autopilot cancelled — module not fitted')
    return false
  }
  const nextId = rem[0]
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!canJumpTo(currentSystem, nextId)) {
    cancelRouteAutopilot('Autopilot cancelled — no warp lane')
    return false
  }
  const gate = findWarpGateTo(currentSystem, nextId)
  if (!gate) {
    cancelRouteAutopilot('Autopilot cancelled — missing warp gate')
    return false
  }
  // Already in activation range → wait, then jump (F skips wait).
  if (isNearWarpGate(gameState.player.ship.position, gate)) {
    armRouteAutopilotGateWait(nextId, gate)
    return true
  }
  gameState.player.waypointBodyId = gate.id
  gameState.player.waypointPosition = null
  routeAutopilot = { phase: 'to_gate' }
  try {
    teleportDronesToBay(gameState.player.ship)
    clearDroneMeshes()
  } catch { /* */ }
  clearTargetLock()
  cruising = true
  gameState.player.ship.supercruiseElapsed = 0
  const destSys = getSystem(gameState.galaxy, nextId)
  flashToast(`Route autopilot → ${gate.name}`)
  setHudGlitchText(
    cruiseIndicatorEl,
    destSys ? `AUTOPILOT · ${destSys.name}` : 'ROUTE AUTOPILOT'
  )
  showHudGlitch(cruiseIndicatorEl)
  audio.announce('Route autopilot engaged')
  return true
}

function jumpEaseInOut(t) {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function jumpLerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ]
}

/**
 * Camera for gate approach / exit: sit on the portal axis so the ring face
 * is centered on screen (not a side-on silhouette).
 * @param {'in'|'out'} mode in = looking into aperture; out = looking out of gate
 */
function syncGateFaceCamera(camera, shipPos, gatePos, lookDir, mode = 'in') {
  const ship = new THREE.Vector3().fromArray(shipPos)
  const gate = new THREE.Vector3().fromArray(gatePos)
  const dir = new THREE.Vector3().fromArray(lookDir)
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1)
  else dir.normalize()
  // Behind the ship relative to the look direction.
  const back = dir.clone().multiplyScalar(mode === 'in' ? -1 : -1)
  const up = new THREE.Vector3(0, 1, 0)
  // Prefer a stable screen-up that isn't parallel to the portal axis.
  const camUp = up.clone().sub(dir.clone().multiplyScalar(up.dot(dir)))
  if (camUp.lengthSq() < 1e-6) camUp.set(1, 0, 0)
  else camUp.normalize()
  const dist = 58
  const lift = 14
  camera.position.copy(ship).addScaledVector(back, dist).addScaledVector(camUp, lift)
  // Look at a point through the aperture so the ring is framed face-on.
  const lookTarget =
    mode === 'in'
      ? gate.clone().addScaledVector(dir, 40)
      : ship.clone().addScaledVector(dir, 120)
  camera.up.copy(camUp)
  camera.lookAt(lookTarget)
  camera.updateMatrixWorld(true)
}

/**
 * Begin the warp-gate jump VFX + system swap. Caller must validate proximity.
 * Sequence: enter origin gate → tunnel → exit destination gate.
 */
function beginWarpJump(targetSystemId, opts = {}) {
  navMapOpen = false
  navMap?.hide()
  // Probe can't follow a warp jump — abort mid-survey cleanly.
  clearProbeEffect()
  clearTargetLock()
  // Jump sequence owns input until arrival flash ends (resumeFlightAfterPause).
  flightModeWanted = true
  flightMode = false
  laserFireHeld = false
  missileFireHeld = false
  setChaseFreeLook(false)
  // Keep pointer lock through the cutscene when possible so post-jump re-lock is easier.
  if (document.pointerLockElement !== renderer.domElement) {
    renderer.domElement.requestPointerLock().catch(() => {})
  }
  if (opts.routeAutopilot) {
    routeAutopilot = { phase: 'jumping' }
  } else {
    routeAutopilot = null
  }

  ensureWarpGates(gameState.galaxy)
  const fromSystemId = gameState.player.currentSystemId
  const currentSystem = getSystem(gameState.galaxy, fromSystemId)
  const originGate =
    opts.originGate ||
    findWarpGateTo(currentSystem, targetSystemId) ||
    findNearbyWarpGate(currentSystem, gameState.player.ship.position)
  const originGatePos = originGate?.position
    ? [...originGate.position]
    : [...gameState.player.ship.position]
  const enterFromPos = [...gameState.player.ship.position]
  const enterFromQuat = [...gameState.player.ship.quaternion]
  // Portal +Z faces the star; approach along that axis so the ring face fills the screen.
  const outward = warpGateOutwardDir(originGatePos)
  // Direction the camera/ship looks to see the gate face (from star-side toward the aperture).
  const gateLookDir = [-outward[0], -outward[1], -outward[2]]
  // Prefer starting approach on the portal axis (face-on), not a lateral skim.
  const approachDist = Math.max(
    380,
    Math.hypot(
      enterFromPos[0] - originGatePos[0],
      enterFromPos[1] - originGatePos[1],
      enterFromPos[2] - originGatePos[2]
    )
  )
  const axialStart = [
    originGatePos[0] + outward[0] * approachDist,
    originGatePos[1] + outward[1] * approachDist,
    originGatePos[2] + outward[2] * approachDist
  ]
  // Blend current position toward the axial approach so we don't teleport hard.
  const startPos = jumpLerp3(enterFromPos, axialStart, 0.72)
  const enterToQuat = quatFacingFromTo(startPos, originGatePos)

  gameState.player.ship.velocity = [0, 0, 0]
  gameState.player.ship.position = [...startPos]
  gameState.player.ship.quaternion = [...enterToQuat]

  jumpEffect = {
    phase: 'enterGate',
    elapsed: 0,
    targetSystemId,
    fromSystemId,
    jumped: false,
    originGatePos,
    enterFromPos: [...startPos],
    enterFromQuat: [...enterToQuat],
    enterToQuat,
    gateLookDir,
    gateOutward: outward
  }
  jumpFlashEl.style.background = HYPERSPACE_FLASH_COLOR
  jumpFlashEl.style.display = 'block'
  jumpFlashEl.style.opacity = '0'
  setJumpBlackOpacity(0)
  // Tunnel starts when the ship reaches the aperture (end of enterGate).
  try {
    teleportDronesToBay(gameState.player.ship)
    clearDroneMeshes()
  } catch { /* */ }
  audio.announce(opts.routeAutopilot ? 'Warp gate engaged' : 'Warp gate engaged')
  setHudGlitchText(cruiseIndicatorEl, opts.routeAutopilot ? 'ROUTE AUTOPILOT' : 'ENTERING GATE')
  showHudGlitch(cruiseIndicatorEl)
}

/**
 * Galaxy-map "Engage Autopilot": chain SC → gate → wait → jump along plottedRoute.
 * Call again while active to cancel (route is preserved).
 */
function engageRouteAutopilot(nextHopSystemId) {
  // Toggle off while running — keep plottedRoute for later resume.
  if (routeAutopilot) {
    cancelRouteAutopilot('Autopilot cancelled — route kept')
    return
  }
  if (docked || dockEffect) {
    flashToast('Undock before engaging autopilot')
    return
  }
  if (gameState.inCombat) {
    flashToast('Cannot autopilot while in combat')
    return
  }
  if (!shipHasAutopilot(gameState.player.ship)) {
    flashToast('Fit an Autopilot module first')
    return
  }
  if (!nextHopSystemId || nextHopSystemId === gameState.player.currentSystemId) {
    flashToast('Plot a multi-system route first')
    return
  }
  ensureWarpGates(gameState.galaxy)
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!canJumpTo(currentSystem, nextHopSystemId)) {
    flashToast('No warp lane to the next hop — replot the route')
    return
  }
  const gate = findWarpGateTo(currentSystem, nextHopSystemId)
  if (!gate) {
    flashToast('No warp gate to that system')
    return
  }
  const rem = gameState.player.plottedRoute
  if (!Array.isArray(rem) || rem[0] !== nextHopSystemId) {
    if (!Array.isArray(rem) || rem.length === 0) {
      gameState.player.plottedRoute = [nextHopSystemId]
    }
  }
  navMapOpen = false
  navMap?.hide()
  if (!docked) reenterFlightMode()
  startRouteAutopilotCruiseToGate()
}

function updateRouteAutopilot(dt) {
  if (!routeAutopilot) return
  if (docked || dockEffect) {
    cancelRouteAutopilot('Autopilot cancelled — docked (route kept)')
    return
  }
  if (jumpEffect) return
  if (gameState.inCombat) {
    cancelRouteAutopilot('Autopilot cancelled — combat (route kept)')
    return
  }
  if (!shipHasAutopilot(gameState.player.ship)) {
    cancelRouteAutopilot('Autopilot cancelled — module not fitted (route kept)')
    return
  }
  const rem = gameState.player.plottedRoute
  if (!Array.isArray(rem) || rem.length === 0) {
    cancelRouteAutopilot('Route complete')
    return
  }

  // Hold at gate after SC: countdown, F jumps early.
  if (routeAutopilot.phase === 'gate_wait') {
    const nextId = routeAutopilot.nextId ?? rem[0]
    const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const gate =
      (routeAutopilot.gateId &&
        currentSystem.bodies.find((b) => b.id === routeAutopilot.gateId)) ||
      findWarpGateTo(currentSystem, nextId)
    if (!gate || !isNearWarpGate(gameState.player.ship.position, gate)) {
      // Drifted away — resume SC to the gate.
      routeAutopilot = { phase: 'to_gate' }
      return
    }
    routeAutopilot.pauseRemaining =
      (routeAutopilot.pauseRemaining ?? ROUTE_AUTOPILOT_GATE_PAUSE_S) - dt
    const sec = Math.max(1, Math.ceil(routeAutopilot.pauseRemaining))
    const destSys = getSystem(gameState.galaxy, nextId)
    const label = destSys
      ? `AUTOPILOT · JUMP ${sec}s · ${destSys.name} (F)`
      : `AUTOPILOT · JUMP ${sec}s (F)`
    setHudGlitchText(cruiseIndicatorEl, label)
    if (cruiseIndicatorEl) {
      cruiseIndicatorEl.style.display = 'block'
      cruiseIndicatorEl.style.opacity = '1'
    }
    if (routeAutopilot.pauseRemaining <= 0) {
      beginWarpJump(nextId, { routeAutopilot: true, originGate: gate })
    }
    return
  }

  if (routeAutopilot.phase !== 'to_gate') return

  const nextId = rem[0]
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const gate = findWarpGateTo(currentSystem, nextId)
  if (!gate) {
    cancelRouteAutopilot('Autopilot cancelled — missing warp gate (route kept)')
    return
  }
  if (gameState.player.waypointBodyId !== gate.id) {
    gameState.player.waypointBodyId = gate.id
    gameState.player.waypointPosition = null
  }
  // Near the portal → drop SC and start the 10s jump pause.
  if (isNearWarpGate(gameState.player.ship.position, gate)) {
    armRouteAutopilotGateWait(nextId, gate)
    return
  }
  // Keep supercruise engaged toward the gate.
  if (!cruising) {
    try {
      teleportDronesToBay(gameState.player.ship)
      clearDroneMeshes()
    } catch { /* */ }
    clearTargetLock()
    cruising = true
    gameState.player.ship.supercruiseElapsed = 0
  }
  // Live status on cruise indicator.
  if (cruiseIndicatorEl) {
    const destSys = getSystem(gameState.galaxy, nextId)
    const label = destSys
      ? `AUTOPILOT · ${destSys.name} (${rem.length} left)`
      : `AUTOPILOT · ${rem.length} left`
    setHudGlitchText(cruiseIndicatorEl, label)
    cruiseIndicatorEl.style.display = 'block'
    cruiseIndicatorEl.style.opacity = '1'
  }
}

/** Smoothstep 0–1 (for black-fade ramps). */
function jumpSmoothstep(t) {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

function setJumpBlackOpacity(opacity) {
  if (!jumpBlackEl) return
  const v = Math.max(0, Math.min(1, opacity))
  if (v <= 0.001) {
    jumpBlackEl.style.opacity = '0'
    jumpBlackEl.style.display = 'none'
  } else {
    jumpBlackEl.style.display = 'block'
    jumpBlackEl.style.opacity = String(v)
  }
}

/**
 * Black fade opacity for hyperspace streak phase s ∈ [0,1].
 * Fades in before the system swap, then stays fully black until jump end.
 * Reveal is handled separately (arrival flash after jump completes).
 */
function jumpBlackOpacityForStreak(s, jumped) {
  if (jumped) return 1
  if (s < JUMP_BLACK_FADE_IN_START) return 0
  if (s < JUMP_BLACK_FADE_IN_END) {
    return jumpSmoothstep(
      (s - JUMP_BLACK_FADE_IN_START) / (JUMP_BLACK_FADE_IN_END - JUMP_BLACK_FADE_IN_START)
    )
  }
  return 1
}

function clearJumpVisuals() {
  if (jumpFlashEl) {
    jumpFlashEl.style.opacity = '0'
    jumpFlashEl.style.display = 'none'
  }
  setJumpBlackOpacity(0)
}

function slerpShipQuat(fromArr, toArr, t, outShip) {
  const a = new THREE.Quaternion().fromArray(fromArr)
  const b = new THREE.Quaternion().fromArray(toArr)
  a.slerp(b, Math.max(0, Math.min(1, t)))
  outShip.quaternion = a.toArray()
}

function performWarpSystemSwap() {
  hyperspaceJump(gameState, jumpEffect.targetSystemId, Math.random)
  policeResponse = null
  clearNpcMeshes()
  for (const mesh of bodyMeshes.values()) scene.remove(mesh)
  bodyMeshes.clear()
  if (starMesh) scene.remove(starMesh)
  starMesh = null
  for (const mesh of projectileMeshes.values()) scene.remove(mesh)
  projectileMeshes.clear()
  missileTrail?.clear()
  for (const mesh of wreckMeshes.values()) scene.remove(mesh)
  wreckMeshes.clear()
  for (const flash of impactFlashes) scene.remove(flash.mesh)
  impactFlashes.length = 0
  for (const fx of rockExplosions) {
    scene.remove(fx.group)
    disposeRockExplosion(fx)
  }
  rockExplosions.length = 0
  for (const fx of hitImpacts) {
    scene.remove(fx.group)
    disposeHitImpact(fx)
  }
  hitImpacts.length = 0
  for (const npc of gameState.npcs) {
    addNpcMesh(npc)
  }
  loadBodiesForCurrentSystem()
  if (playerMesh) {
    playerMesh.scale.setScalar(1)
    syncMeshToEntity(playerMesh, gameState.player.ship)
  }
}

function beginJumpExitGatePhase() {
  hyperspaceTunnel.stop()
  if (playerMesh) playerMesh.scale.setScalar(1)
  camera.fov = BASE_FOV
  camera.updateProjectionMatrix()

  const dest = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const fromId = jumpEffect.fromSystemId
  const exitFrom = [...gameState.player.ship.position]
  const exitTo = warpArrivalNearExitGate(dest, fromId)
  const exitFromQuat = [...gameState.player.ship.quaternion]
  const exitToQuat = quatFacingFromTo(exitFrom, exitTo)
  const exitOut = warpGateOutwardDir(exitFrom)
  // Looking out through the face of the gate as we leave.
  const exitLookDir = [...exitOut]

  jumpEffect = {
    phase: 'exitGate',
    elapsed: 0,
    targetSystemId: jumpEffect.targetSystemId,
    fromSystemId: fromId,
    exitFromPos: exitFrom,
    exitToPos: exitTo,
    exitFromQuat,
    exitToQuat,
    exitGatePos: [...exitFrom],
    exitLookDir
  }
  setJumpBlackOpacity(0)
  jumpFlashEl.style.opacity = '0.15'
  setHudGlitchText(cruiseIndicatorEl, 'EXITING GATE')
  showHudGlitch(cruiseIndicatorEl)
  audio.playHyperspaceArrival()
  audio.announce('Warp tunnel exit')
}

function finishJumpSequence() {
  if (playerMesh) playerMesh.scale.setScalar(1)
  camera.fov = BASE_FOV
  camera.updateProjectionMatrix()
  const ship = gameState.player.ship
  // Snap to final standoff pose if exit phase completed.
  if (jumpEffect?.exitToPos) {
    ship.position = [...jumpEffect.exitToPos]
    if (jumpEffect.exitToQuat) ship.quaternion = [...jumpEffect.exitToQuat]
  }
  ship.velocity = [0, 0, 0]
  if (playerMesh) syncMeshToEntity(playerMesh, ship)

  setJumpBlackOpacity(0)
  jumpFlashEl.style.background = HYPERSPACE_FLASH_COLOR
  jumpFlashEl.style.display = 'block'
  jumpFlashEl.style.opacity = String(JUMP_ARRIVAL_FLASH_PEAK)
  jumpEffect = {
    phase: 'arrivalFlash',
    elapsed: 0,
    flashPeak: JUMP_ARRIVAL_FLASH_PEAK
  }
  setHudGlitchText(cruiseIndicatorEl, 'WARP TUNNEL EXIT')
  showHudGlitch(cruiseIndicatorEl)
  hideHudGlitch(cruiseIndicatorEl)
  // Keep flight intent during the arrival flash. Do NOT call reenterFlightMode
  // yet — canUseFlightMode() is false while jumpEffect is set, which would clear
  // flightMode. Real re-entry happens when arrivalFlash ends (updateJumpEffect).
  flightModeWanted = true
  flightMode = false
  // Next leg: supercruise to the following warp gate (or finish).
  if (routeAutopilot) {
    const rem = gameState.player.plottedRoute
    if (shipHasAutopilot(gameState.player.ship) && Array.isArray(rem) && rem.length > 0) {
      flashToast(`Autopilot: next gate (${rem.length} jump${rem.length === 1 ? '' : 's'} left)`)
      startRouteAutopilotCruiseToGate()
    } else {
      routeAutopilot = null
      if (!rem?.length) flashToast('Autopilot: route complete')
    }
  }
}

function updateJumpEffect(dt) {
  jumpEffect.elapsed += dt
  const e = jumpEffect.elapsed
  const ship = gameState.player.ship

  // Post-arrival screen flash (new system already revealed during exit).
  if (jumpEffect.phase === 'arrivalFlash') {
    syncChaseCamera(camera, ship)
    if (playerMesh) syncMeshToEntity(playerMesh, ship)
    const t = e / JUMP_ARRIVAL_FLASH_DECAY_S
    const op = Math.max(0, jumpEffect.flashPeak * (1 - t) * (1 - t))
    jumpFlashEl.style.opacity = String(op)
    if (t >= 1) {
      jumpEffect = null
      clearJumpVisuals()
      // Jump fully done — restore mouse-aim flight (same path as unpause).
      if (!docked && !paused) resumeFlightAfterPause()
    }
    return
  }

  // Hull suck-in / spit-out scale (visual only — game state pose stays authoritative).
  const applyShipJumpScale = (scale, forwardPull = 0) => {
    if (!playerMesh) return
    playerMesh.scale.setScalar(Math.max(0.02, scale))
    if (forwardPull !== 0) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(playerMesh.quaternion)
      playerMesh.position.addScaledVector(fwd, forwardPull)
    }
  }

  // ——— Phase 1: fly into the origin gate aperture ———
  if (jumpEffect.phase === 'enterGate') {
    const t = Math.min(1, e / JUMP_ENTER_GATE_S)
    const ease = jumpEaseInOut(t)
    ship.position = jumpLerp3(jumpEffect.enterFromPos, jumpEffect.originGatePos, ease)
    slerpShipQuat(jumpEffect.enterFromQuat, jumpEffect.enterToQuat, ease, ship)
    ship.velocity = [0, 0, 0]
    // Slight FOV tighten + glow as we dive into the ring.
    camera.fov = BASE_FOV - ease * 10
    camera.updateProjectionMatrix()
    jumpFlashEl.style.opacity = String(Math.min(0.35, ease * 0.28 + (t > 0.7 ? (t - 0.7) * 0.4 : 0)))
    setJumpBlackOpacity(t > 0.85 ? jumpEaseInOut((t - 0.85) / 0.15) * 0.35 : 0)
    if (playerMesh) {
      playerMesh.scale.setScalar(1 - ease * 0.2)
      syncMeshToEntity(playerMesh, ship)
    }
    // Face-on framing: ring fills the screen, not a side silhouette.
    syncGateFaceCamera(
      camera,
      ship.position,
      jumpEffect.originGatePos,
      jumpEffect.gateLookDir,
      'in'
    )

    if (t >= 1) {
      // Lock in the aperture and start the tunnel.
      ship.position = [...jumpEffect.originGatePos]
      if (playerMesh) playerMesh.scale.setScalar(0.75)
      hyperspaceTunnel.start({ warpMode: true })
      audio.playHyperspace()
      setHudGlitchText(cruiseIndicatorEl, 'WARP TUNNEL')
      showHudGlitch(cruiseIndicatorEl)
      jumpEffect.phase = 'tunnel'
      jumpEffect.elapsed = 0
      jumpEffect.jumped = false
    }
    return
  }

  // ——— Phase 3: fly out of the destination gate ———
  if (jumpEffect.phase === 'exitGate') {
    const t = Math.min(1, e / JUMP_EXIT_GATE_S)
    const ease = jumpEaseInOut(t)
    ship.position = jumpLerp3(jumpEffect.exitFromPos, jumpEffect.exitToPos, ease)
    slerpShipQuat(jumpEffect.exitFromQuat, jumpEffect.exitToQuat, ease, ship)
    ship.velocity = [0, 0, 0]
    camera.fov = BASE_FOV + (1 - ease) * 8
    camera.updateProjectionMatrix()
    // Fade residual tunnel flash; keep scene fully visible.
    setJumpBlackOpacity(0)
    jumpFlashEl.style.opacity = String(Math.max(0, 0.2 * (1 - ease)))
    if (playerMesh) {
      // Scale back up as we leave the aperture.
      playerMesh.scale.setScalar(0.55 + ease * 0.45)
      syncMeshToEntity(playerMesh, ship)
    }
    // Early exit: still frame the gate face; later blend to chase.
    if (ease < 0.55 && jumpEffect.exitGatePos && jumpEffect.exitLookDir) {
      syncGateFaceCamera(
        camera,
        ship.position,
        jumpEffect.exitGatePos,
        jumpEffect.exitLookDir,
        'out'
      )
    } else {
      syncChaseCamera(camera, ship)
    }

    if (t >= 1) {
      if (playerMesh) playerMesh.scale.setScalar(1)
      finishJumpSequence()
    }
    return
  }

  // ——— Phase 2: windup + tunnel (system swap mid-pass under black) ———
  syncChaseCamera(camera, ship)
  if (playerMesh) syncMeshToEntity(playerMesh, ship)

  if (e < JUMP_WINDUP_S) {
    // Gate spool: FOV tightens, bright aperture flash, ship at aperture centre.
    const w = e / JUMP_WINDUP_S
    const ease = w * w
    const throb = 0.5 + 0.5 * Math.sin(e * 14)
    camera.fov = BASE_FOV - ease * 12 + throb * w * 4
    camera.updateProjectionMatrix()
    jumpFlashEl.style.opacity = String(Math.min(0.55, ease * 0.35 + throb * 0.08))
    setJumpBlackOpacity(0)
    hyperspaceTunnel.update(dt, Math.max(0.15, ease * 0.85), camera, getCrosshairAimWorld())
    applyShipJumpScale(0.75 - ease * 0.25, ease * 12)
  } else {
    const s = (e - JUMP_WINDUP_S) / JUMP_STREAK_S
    const punch = Math.sin(Math.min(1, s) * Math.PI)
    camera.fov = BASE_FOV + 18 + punch * 42
    camera.updateProjectionMatrix()
    const black = jumpBlackOpacityForStreak(s, jumpEffect.jumped)
    setJumpBlackOpacity(black)
    if (!jumpEffect.jumped) {
      jumpFlashEl.style.opacity = String(
        Math.min(0.4, (0.12 + punch * 0.22) * (1 - black * 0.9))
      )
    } else {
      jumpFlashEl.style.opacity = '0'
    }
    const tunnelStr = s < 0.12 ? s / 0.12 : s > 0.88 ? (1 - s) / 0.12 : 1
    hyperspaceTunnel.update(dt, Math.min(1, 0.85 + tunnelStr * 0.2), camera, getCrosshairAimWorld())

    if (!jumpEffect.jumped) {
      const suckT = Math.min(1, s / 0.4)
      const ease = suckT * suckT
      applyShipJumpScale(0.5 - ease * 0.4, ease * 28)
    } else if (playerMesh) {
      playerMesh.scale.setScalar(0.55)
    }

    if (!jumpEffect.jumped && s >= 0.4) {
      jumpEffect.jumped = true
      setJumpBlackOpacity(1)
      jumpFlashEl.style.opacity = '0'
      if (playerMesh) playerMesh.scale.setScalar(0.1)
      try {
        performWarpSystemSwap()
      } catch (err) {
        gameNotice('Hyperspace failed', err.message)
        jumpEffect = null
        hyperspaceTunnel.stop()
        if (playerMesh) playerMesh.scale.setScalar(1)
        audio.playHyperspaceArrival()
        clearJumpVisuals()
        camera.fov = BASE_FOV
        camera.updateProjectionMatrix()
        if (!docked && !paused) resumeFlightAfterPause()
        return
      }
    }
  }

  if (jumpEffect && jumpEffect.phase === 'tunnel' && jumpEffect.elapsed >= JUMP_TUNNEL_DURATION_S) {
    // Destination system already loaded under black — reveal while flying out.
    beginJumpExitGatePhase()
  }
}

function dock(body) {
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (system) ensureSystemSecurity(system)
  if (!canDockWithLaw(gameState, body, system)) {
    flashToast(
      body.kind === 'station'
        ? 'Docking refused — security standing too low for this station (Sec 3–6)'
        : 'Docking refused'
    )
    return
  }
  cancelRouteAutopilot(routeAutopilot ? 'Autopilot cancelled — docked' : null)
  docked = true
  resetDockOrbit()
  audio.setThrustState(null)
  markBodyVisited(gameState, body.id)
  // Catch up mission flags (e.g. probe already in probedBodyIds) before the
  // board renders Turn In / In progress.
  updateMissionProgress(gameState)
  // Shields regenerate on their own anyway (see combat.js's regenShields) —
  // docking just tops them off instantly and for free, since only hull/armor
  // repair costs credits in the shipyard.
  gameState.player.ship.shields = playerShipClass.stats.shields
  gameState.player.dockedBodyId = body.id
  if (dockedApproach) {
    gameState.player.dockedExteriorPosition = dockedApproach.exteriorPoint.toArray()
    gameState.player.dockedApproachDir = dockedApproach.approachDir.toArray()
  }
  dockPromptEl.style.display = 'none'
  applyDockedHud(body)
  dockingUI.show(body, () => beginUndocking())
}

/** Flight HUD off; top-left system + bay name while parked. */
function applyDockedHud(body = null) {
  if (!hud) return
  if (!docked) {
    hud.setDocked(false)
    return
  }
  const bay =
    body ||
    (gameState?.player?.dockedBodyId
      ? findBody(gameState.galaxy, gameState.player.dockedBodyId)
      : null)
  const sys = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (sys) ensureSystemSecurity(sys)
  hud.setDocked(true, {
    systemName: sys?.name ?? null,
    locationName: bay?.name ?? null,
    securityRating: getSystemSecurity(sys)
  })
  systemOverview?.hide()
}

function clearDockedSaveFields() {
  if (!gameState) return
  gameState.player.dockedBodyId = null
  gameState.player.dockedExteriorPosition = null
  gameState.player.dockedApproachDir = null
}

/**
 * After load: put the player back in space at their saved pose, or re-enter
 * the docking bay + UI at the station/settlement they saved at.
 */
function restoreSessionLocation() {
  if (!gameState) return
  const bodyId = gameState.player.dockedBodyId
  if (bodyId) {
    const body = findBody(gameState.galaxy, bodyId)
    const bodySystem = findSystemOfBody(gameState.galaxy, bodyId)
    if (
      body &&
      bodySystem &&
      bodySystem.id === gameState.player.currentSystemId &&
      (body.kind === 'station' || body.kind === 'settlement')
    ) {
      let exteriorPoint
      let approachDir
      if (
        Array.isArray(gameState.player.dockedExteriorPosition) &&
        gameState.player.dockedExteriorPosition.length === 3
      ) {
        exteriorPoint = new THREE.Vector3(...gameState.player.dockedExteriorPosition)
      } else {
        exteriorPoint = dockExteriorPoint(
          body,
          new THREE.Vector3().fromArray(
            // Fallback hang: approach from system arrival side of the body.
            gameState.player.ship.position?.[0] > 1e5
              ? [0, 400, -800]
              : gameState.player.ship.position
          )
        ).exteriorPoint
      }
      if (
        Array.isArray(gameState.player.dockedApproachDir) &&
        gameState.player.dockedApproachDir.length === 3
      ) {
        approachDir = new THREE.Vector3(...gameState.player.dockedApproachDir)
        if (approachDir.lengthSq() < 1e-8) approachDir.set(0, 0, 1)
        else approachDir.normalize()
      } else {
        approachDir = new THREE.Vector3(...body.position).sub(exteriorPoint)
        if (approachDir.lengthSq() < 1e-8) approachDir.set(0, 0, 1)
        else approachDir.normalize()
      }
      dockedApproach = { body, exteriorPoint, approachDir }
      swapToInterior(body)
      gameState.player.ship.position = DOCKING_BAY_ORIGIN.clone().add(BAY_PARK_OFFSET).toArray()
      gameState.player.ship.quaternion = [0, 0, 0, 1]
      gameState.player.ship.velocity = [0, 0, 0]
      gameState.player.ship.throttle = 0
      if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
      exitFlightMode()
      flightModeWanted = false
      dock(body) // sets docked HUD (system + bay name top-left)
      return
    }
    // Stale dock id — fall through to free flight at saved pose.
    clearDockedSaveFields()
  }

  docked = false
  dockedApproach = null
  // Space: ship.position / quaternion / velocity already restored from save.
  if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
}

// Smoothstep-ish ease so docking approaches decelerate into the hang point
// instead of a robotic linear slide.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// Hang point just outside the body's flight collision shell, on the approach
// line. Dock approach uses this (tight shell so you can fly in close). Undock
// recomputes a farther hang via undockExteriorPoint so the ship clears mesh.
function dockExteriorPoint(body, shipPos) {
  const bodyPos = new THREE.Vector3(...body.position)
  const approachDir = bodyPos.clone().sub(shipPos)
  if (approachDir.lengthSq() < 1e-6) approachDir.set(0, 0, 1)
  else approachDir.normalize()
  const bodyRadius = collisionRadiusFor(body) ?? 0
  const standoff = bodyRadius + getShipCollisionRadius(playerShipClass) + DOCK_EXTERIOR_MARGIN
  const exteriorPoint = bodyPos.clone().addScaledVector(approachDir, -standoff)
  return { bodyPos, approachDir, exteriorPoint, standoff }
}

// Undock hang: outside station/settlement *visual* bulk along the stored
// approach direction. Flight collision (500m stations) is intentionally smaller
// than the mesh so you can dock close — but leaving must clear geometry.
function undockExteriorPoint(body, approachDir) {
  const bodyPos = new THREE.Vector3(...body.position)
  const dir = approachDir.clone()
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
  else dir.normalize()
  const bodyRadius = exteriorRadiusFor(body) ?? collisionRadiusFor(body) ?? 0
  const standoff = bodyRadius + getShipCollisionRadius(playerShipClass) + DOCK_EXTERIOR_MARGIN
  const exteriorPoint = bodyPos.clone().addScaledVector(dir, -standoff)
  return { bodyPos, approachDir: dir, exteriorPoint, standoff }
}

// Docking/undocking is a scripted multi-phase animation:
//   approach hang → brief align settle → flash into bay → park glide.
// Undocking reverses: unpark → flash out → back away. dockedApproach
// remembers the original approach so the reverse trip lines up.
function beginDocking(body) {
  // Docking freezes the flight loop — resolve or abort any in-flight probe so
  // survey missions don't stay "in progress" after a completed scan.
  if (probeEffect) {
    if (probeEffect.surveyLogged || probeEffect.phase === 'returning') {
      const b = probeEffect.body
      const attemptNumber = probeEffect.attemptNumber
      const missionTargetAtLaunch = probeEffect.missionTargetAtLaunch
      const missionOnlyReprobe = !!probeEffect.missionOnlyReprobe
      clearProbeEffect()
      finishProbeResults(b, attemptNumber, missionTargetAtLaunch, missionOnlyReprobe)
    } else {
      clearProbeEffect()
      flashToast('Probe aborted — docking')
    }
  }

  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const { bodyPos, approachDir, exteriorPoint } = dockExteriorPoint(body, shipPos)

  // Align hang: slightly closer than exterior, nose locked on bay.
  const alignPoint = exteriorPoint.clone().lerp(bodyPos, 0.12)
  const facingQuat = quatFacing(exteriorPoint, bodyPos)
  // Slight bank into the approach so the glide feels less robotic.
  const bankedFacing = facingQuat.clone().multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.22)
  )
  const alignQuat = quatFacing(alignPoint, bodyPos)

  dockedApproach = { body, exteriorPoint, approachDir }
  dockEffect = {
    undocking: false,
    elapsed: 0,
    body,
    swapped: false,
    thrusterPulsed: false,
    baySettled: false,
    fromPos: shipPos.clone(),
    fromQuat: new THREE.Quaternion().fromArray(gameState.player.ship.quaternion),
    exteriorPoint,
    alignPoint,
    facingQuat: bankedFacing,
    alignQuat
  }
  gameState.player.ship.velocity = [0, 0, 0]
  audio.setThrustState(null)
  // Drop supercruise cleanly (sound + flag) — dockEffect early-returns from
  // animate() so the usual edge-detect path won't run this frame.
  if (cruising || wasCruising) {
    cruising = false
    wasCruising = false
    setHudGlitchText(cruiseIndicatorEl, 'SUPERCRUISE DISENGAGED')
    showHudGlitch(cruiseIndicatorEl)
    hideHudGlitch(cruiseIndicatorEl)
    hud?.setCruiseGlitch(false)
    gameState.player.ship.velocity = [0, 0, 0]
    gameState.player.ship.throttle = 0
    motionFx.stopCruiseStreaks()
    thrusterEffects?.stopCruiseStreaks()
    updateStarfieldMotion(starfield, 0, false)
    audio.setSupercruiseActive(false)
    // Phonetic TTS spelling only — HUD already shows SUPERCRUISE DISENGAGED.
    audio.announce('Supercrews disengaged')
  }
  exitFlightMode()
  dockPromptEl.style.display = 'none'
  probePromptEl.style.display = 'none'
  // Black out during the approach → bay cut (cyan flash was confusing).
  jumpFlashEl.style.background = '#000'
  jumpFlashEl.style.opacity = '0'
  jumpFlashEl.style.display = 'block'
  audio.playDock()
}

function beginUndocking() {
  if (!dockedApproach) {
    docked = false
    hud?.setDocked(false)
    return
  }
  const { approachDir, body } = dockedApproach
  // Recompute hang from current body pose + visual bulk shell. Dock approach
  // hang used the tight flight collision and sits inside station mesh.
  const { exteriorPoint } = undockExteriorPoint(body, approachDir)
  dockedApproach.exteriorPoint = exteriorPoint
  // Always normalize — loaded saves may have slightly off-unit approach dirs.
  const awayDir = approachDir.clone()
  if (awayDir.lengthSq() < 1e-8) awayDir.set(0, 0, 1)
  else awayDir.normalize()
  const backAwayPoint = exteriorPoint.clone().addScaledVector(
    awayDir,
    -(getShipCollisionRadius(playerShipClass) + UNDOCK_BACKOFF_MARGIN)
  )
  // Face along the back-away vector (out of the station).
  const awayQuat = quatFacing(exteriorPoint, backAwayPoint)
  awayQuat.normalize()
  dockEffect = {
    undocking: true,
    elapsed: 0,
    body,
    swapped: false,
    thrusterPulsed: false,
    exteriorPoint,
    awayQuat,
    backAwayPoint
  }
  jumpFlashEl.style.background = '#000'
  jumpFlashEl.style.opacity = '0'
  jumpFlashEl.style.display = 'block'
  audio.playUndock()
  // Wipe chase-cam / mouse state left over from the bay or a prior free-look
  // (load-from-docked is especially prone to a skewed seat vs boresight).
  resetChaseCameraState()
  mouseAim.dx = 0
  mouseAim.dy = 0
  // Requested here (immediately, as a direct continuation of the Undock
  // button click) rather than when the animation finishes a couple seconds
  // later — flightMode is harmless while dockEffect is active (updateFlight
  // never runs during it), and Chromium's pointer-lock grant needs a live
  // user gesture, which a requestAnimationFrame callback well after the
  // click no longer has.
  reenterFlightMode()
}

function updateDockEffect(dt) {
  dockEffect.elapsed += dt
  // Exterior half is slightly longer than bay half so the approach reads.
  const approachEnd = DOCK_ANIM_DURATION_S * 0.42
  const alignEnd = DOCK_ANIM_DURATION_S * 0.55
  const swapAt = alignEnd
  // Longer black hold through the scene swap, then fade back as motion ends.
  const fadeInEnd = DOCK_ANIM_DURATION_S * 0.22
  const blackHoldEnd = DOCK_ANIM_DURATION_S * 0.72
  const flashWindow = DOCK_FLASH_FADE_S

  if (!dockEffect.undocking) {
    if (dockEffect.elapsed < approachEnd) {
      // Phase 1: banked glide to hang point outside the shell.
      const lt = easeInOutCubic(dockEffect.elapsed / approachEnd)
      gameState.player.ship.position = dockEffect.fromPos.clone().lerp(dockEffect.exteriorPoint, lt).toArray()
      gameState.player.ship.quaternion = dockEffect.fromQuat.clone().slerp(dockEffect.facingQuat, lt).toArray()
      if (!dockEffect.thrusterPulsed && dockEffect.elapsed > 0.15) {
        dockEffect.thrusterPulsed = true
        audio.playDockThrusterPulse()
      }
    } else if (dockEffect.elapsed < alignEnd) {
      // Phase 2: nose settle / slight nudge toward bay before the cut.
      const lt = easeInOutCubic((dockEffect.elapsed - approachEnd) / (alignEnd - approachEnd))
      gameState.player.ship.position = dockEffect.exteriorPoint.clone().lerp(dockEffect.alignPoint, lt).toArray()
      gameState.player.ship.quaternion = dockEffect.facingQuat.clone().slerp(dockEffect.alignQuat, lt).toArray()
    } else {
      // Phase 3: flash into bay, then ease into the park slot with a soft settle.
      if (!dockEffect.swapped) {
        dockEffect.swapped = true
        swapToInterior(dockEffect.body)
        gameState.player.ship.position = DOCKING_BAY_ORIGIN.clone().add(BAY_ENTRY_OFFSET).toArray()
        gameState.player.ship.quaternion = [0, 0, 0, 1] // bay local +Z into the bay
        audio.playDockThrusterPulse()
      }
      const bayT = Math.min(1, (dockEffect.elapsed - swapAt) / (DOCK_ANIM_DURATION_S - swapAt))
      const lt = easeInOutCubic(bayT)
      const entry = DOCKING_BAY_ORIGIN.clone().add(BAY_ENTRY_OFFSET)
      const park = DOCKING_BAY_ORIGIN.clone().add(BAY_PARK_OFFSET)
      gameState.player.ship.position = entry.lerp(park, lt).toArray()
      // Soft roll-out of residual bank as we settle into the pad.
      const settleRoll = (1 - lt) * 0.12
      gameState.player.ship.quaternion = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), settleRoll)
        .toArray()
      if (!dockEffect.baySettled && bayT > 0.85) {
        dockEffect.baySettled = true
      }
    }
  } else {
    const half = DOCK_ANIM_DURATION_S / 2
    if (dockEffect.elapsed < half) {
      const lt = easeInOutCubic(dockEffect.elapsed / half)
      const park = DOCKING_BAY_ORIGIN.clone().add(BAY_PARK_OFFSET)
      const entry = DOCKING_BAY_ORIGIN.clone().add(BAY_ENTRY_OFFSET)
      gameState.player.ship.position = park.clone().lerp(entry, lt).toArray()
      // Pitch up slightly as we leave the pad.
      const pitch = lt * 0.18
      gameState.player.ship.quaternion = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch)
        .toArray()
    } else {
      if (!dockEffect.swapped) {
        dockEffect.swapped = true
        swapToExterior()
        gameState.player.ship.position = dockEffect.exteriorPoint.toArray()
        gameState.player.ship.quaternion = dockEffect.awayQuat.clone().normalize().toArray()
        audio.playDockThrusterPulse()
        // Leaving the bay: hard-reset chase seat so the interior camera pose
        // (2e6 world) cannot leave a lateral skew vs ship boresight/crosshair.
        mouseAim.dx = 0
        mouseAim.dy = 0
        if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
        snapChaseCamera(camera, gameState.player.ship)
      }
      const lt = easeInOutCubic(Math.min(1, (dockEffect.elapsed - half) / half))
      gameState.player.ship.position = dockEffect.exteriorPoint.clone().lerp(dockEffect.backAwayPoint, lt).toArray()
      // Level out while backing away — keep a unit quat for boresight/camera.
      gameState.player.ship.quaternion = dockEffect.awayQuat.clone().normalize().toArray()
      if (!dockEffect.thrusterPulsed && lt > 0.2) {
        dockEffect.thrusterPulsed = true
        audio.playDockThrusterPulse()
      }
    }
  }

  syncMeshToEntity(playerMesh, gameState.player.ship)
  // During exterior undock we already snapped once; keep hard snaps so the
  // seat can't lerp from the bay. Dock approach still uses normal chase.
  if (dockEffect.undocking && dockEffect.swapped) {
    snapChaseCamera(camera, gameState.player.ship, { resetState: false })
  } else {
    syncChaseCamera(camera, gameState.player.ship)
  }

  // Full black veil: fade in → hold across interior/exterior swap → fade out.
  {
    const t = dockEffect.elapsed
    const total = DOCK_ANIM_DURATION_S
    let op = 0
    if (t < fadeInEnd) {
      op = easeInOutCubic(t / Math.max(1e-6, fadeInEnd))
    } else if (t < blackHoldEnd) {
      op = 1
    } else if (t < total) {
      op = 1 - easeInOutCubic((t - blackHoldEnd) / Math.max(1e-6, total - blackHoldEnd))
    }
    jumpFlashEl.style.background = '#000'
    jumpFlashEl.style.opacity = String(Math.max(0, Math.min(1, op)))
  }

  if (dockEffect.elapsed >= DOCK_ANIM_DURATION_S) {
    jumpFlashEl.style.opacity = '0'
    jumpFlashEl.style.display = 'none'
    if (!dockEffect.undocking) {
      const finishedBody = dockEffect.body
      dockEffect = null
      dock(finishedBody)
    } else {
      gameState.player.ship.velocity = [0, 0, 0]
      // Ensure a clean unit orientation for boresight/camera after undock
      // (especially load-from-docked where awayQuat is rebuilt from save).
      const q = new THREE.Quaternion().fromArray(gameState.player.ship.quaternion).normalize()
      gameState.player.ship.quaternion = q.toArray()
      mouseAim.dx = 0
      mouseAim.dy = 0
      if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
      // Final hard reset: bay → space handoff must leave a neutral chase seat.
      snapChaseCamera(camera, gameState.player.ship)
      dockEffect = null
      docked = false
      dockedApproach = null
      clearDockedSaveFields()
      hud?.setDocked(false)
      systemOverview?.show()
      // Re-place reticle immediately on the bolt path (don't wait a frame).
      if (flightMode) updateCrosshair()
    }
  }
}

function handlePlayerDeath() {
  const killer = gameState.player.lastKiller ?? null
  let cause = 'Ship destroyed in combat'
  if (killer?.method === 'ram') {
    cause = `Rammed by ${killer.pilotName} flying a ${killer.shipName}`
  } else if (killer?.pilotName) {
    cause = `Destroyed by ${killer.pilotName} flying a ${killer.shipName}`
  }
  const summary = {
    characterName: gameState.player.name,
    credits: gameState.player.credits,
    reputation: gameState.player.reputation,
    cause,
    killerPilot: killer?.pilotName ?? null,
    killerShip: killer?.shipName ?? null,
    killerFaction: killer?.faction ?? null,
    killerMethod: killer?.method ?? null
  }
  // Combat boom only — no rock/ice crack. Scene is cleared next; FX is for
  // consistency if we ever delay the wipe.
  const pos = gameState.player.ship.position
  const r = getShipCollisionRadius(playerShipClass)
  playShipDeathFx(pos, r, { sound: true })
  clearSession()
  audio.playDeathMusic()
  gameState = null
  deathScreen.show(summary)
}

window.addEventListener('keydown', (e) => {
  if (!gameState) return
  if (e.code === 'KeyF' && !docked && !dockEffect && !cruising && !jumpEffect && !paused) {
    // Every F action now requires the object to be Tab-locked first — being
    // merely in range no longer triggers dock / gate / salvage / hack, so the
    // prompt and the keypress always agree on what F is about to do.
    // Wreck salvage always wins while a wreck is in range (1 km) — overrides
    // gate / dock / nodule F binds so salvage is never blocked by a station.
    // (Menus still block F via inventory/missions/character/nav checks below.)
    if (!navMapOpen && !inventoryOpen && !missionsOpen && !characterOpen) {
      const wreck = findNearbyWreck()
      if (wreck && currentTarget?.kind === 'wreck' && currentTarget.id === wreck.id) {
        lootNearbyWreck(wreck)
        return
      }
      ensureWarpGates(gameState.galaxy)
      const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
      const gate = findNearbyWarpGate(currentSystem, gameState.player.ship.position)
      if (gate?.destinationSystemId && currentTarget?.kind === 'body' && currentTarget.id === gate.id) {
        if (gameState.inCombat) {
          flashToast('Cannot use warp gates while in combat')
        } else {
          // F during autopilot gate wait (or anytime near a gate) jumps now;
          // if AP is active it continues the route after arrival.
          beginWarpJump(gate.destinationSystemId, {
            routeAutopilot: !!routeAutopilot,
            originGate: gate
          })
        }
        return
      }
      const nodule = findNearbyDatacoreNodule()
      if (nodule && currentTarget?.kind === 'nodule' && currentTarget.id === nodule.nodule.id) {
        tryDatacoreNoduleHack()
        return
      }
      const body = findNearbyDockableBody()
      if (body && currentTarget?.kind === 'body' && currentTarget.id === body.id) beginDocking(body)
    }
  } else if (e.code === 'KeyP' && !docked && !dockEffect && !cruising && !probeEffect && !navMapOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen && !systemScanMap?.isOpen?.() && !datacoreMinigame?.isOpen?.()) {
    // Planetary/body probing only — datacore nodules hack via F (Tab-targeted).
    const launch = getProbeLaunchTarget()
    if (launch) probeBody(launch.body)
  } else if (
    e.code === 'KeyB' &&
    !docked &&
    !dockEffect &&
    !jumpEffect &&
    !cruising &&
    !probeEffect &&
    !navMapOpen &&
    !paused &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen &&
    !datacoreMinigame?.isOpen?.()
  ) {
    e.preventDefault()
    openSystemScanPanel()
  } else if (e.code === 'F5') {
    e.preventDefault()
    hailCurrentTarget()
  } else if (e.code === 'Escape') {
    // Esc only *opens* pause (Resume button to continue). Open panels are closed
    // inside setGamePaused → dismissOpenPanelsForPause.
    e.preventDefault()
    if (paused || dockEffect) return
    // Pointer-lock may unlock first (pointerlockchange opens pause); ignore
    // a same-tick keydown bounce after auto-pause from unlock.
    if (performance.now() - pauseOpenedAtMs < 280) return
    setGamePaused(true)
  } else if (e.code === 'Backspace' && flightMode && !paused && !dockEffect) {
    // Dedicated clear-target key — Shift+Tab already does this too, this is
    // just the one-handed version players reach for without leaving WASD.
    e.preventDefault()
    if (currentTarget) {
      clearTargetLock()
      flashToast('Target lock cleared')
    }
  } else if (
    e.code === 'KeyS' &&
    docked &&
    !dockEffect &&
    !paused &&
    !navMapOpen &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen
  ) {
    // Docked only: S toggles Station Services (flight uses S for reverse thrust).
    e.preventDefault()
    dockingUI?.toggleServices?.()
  } else if (e.code === 'KeyM' && !paused && !inventoryOpen && !missionsOpen && !characterOpen && !dockEffect) {
    // Galaxy map: flight or docked (plot routes from a bay). Autopilot engage is
    // disabled while docked — see navMap + engageRouteAutopilot.
    navMapOpen = !navMapOpen
    audio.setThrustState(null)
    if (navMapOpen) {
      exitFlightMode()
      navMap.show({
        onEngageAutopilot: engageRouteAutopilot,
        onCancelAutopilot: () => {
          cancelRouteAutopilot('Autopilot cancelled — route kept')
        },
        isAutopilotActive: isRouteAutopilotActive,
        onClose: () => {
          navMapOpen = false
          if (!docked) reenterFlightMode()
        },
        inCombat: !!gameState.inCombat,
        docked: !!docked
      })
    } else {
      navMap.hide()
      if (!docked) reenterFlightMode()
    }
  } else if (e.code === 'KeyC' && !docked && !navMapOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen) {
    if (cruising) {
      cruising = false
    } else if (!getActiveWaypoint()) {
      flashToast('Set a waypoint first (Navigation, Ctrl+Tab on a body, or J for missions)')
    } else if (gameState.inCombat) {
      flashToast('Cannot engage supercruise while in combat')
    } else {
      // Drones ride the hyperplane home before SC engages.
      teleportDronesToBay(gameState.player.ship)
      clearDroneMeshes()
      clearTargetLock() // keep waypoint; drop combat/tab lock for cruise
      cruising = true
      gameState.player.ship.supercruiseElapsed = 0
    }
  } else if (
    (e.code === 'KeyG' || e.code === 'KeyH') &&
    !docked &&
    !dockEffect &&
    !navMapOpen &&
    !paused &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen &&
    !jumpEffect &&
    !cruising
  ) {
    if (!hasDroneBays(gameState.player.ship)) {
      flashToast('No drone bays on this hull')
    } else if (e.code === 'KeyG') {
      const r = summonDrones(gameState)
      if (!r.ok) flashToast(r.reason || 'Cannot launch drones')
      else {
        flashToast(`Drones launching (${r.launched})`)
        syncDroneMeshes()
      }
    } else {
      const r = recallDrones(gameState)
      if (!r.ok) flashToast('No drones to recall')
      else flashToast('Drones returning to bay')
      // Meshes stay until return animation finishes (updatePlayerDrones).
    }
  } else if (e.code === 'Space' && !docked && !dockEffect && !navMapOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen) {
    // If locked in flight, Space exits. If wanted-but-lost (tab-out) or off,
    // Space (re)enters — so tabbing out then Space re-acquires cleanly.
    if (flightMode && document.pointerLockElement === renderer.domElement) {
      exitFlightMode()
    } else {
      reenterFlightMode()
    }
  } else if (e.code === 'Tab' && !docked && !navMapOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+Tab: set waypoint on body under the crosshair.
      setWaypointFromCrosshair()
    } else if (e.shiftKey) {
      // Shift+Tab: clear lock (plain Tab still cycles).
      clearTargetLock()
    } else {
      cycleTarget()
    }
  } else if (e.code === 'KeyI' && !navMapOpen && !paused && !missionsOpen && !characterOpen && !dockEffect) {
    // Inventory is available in flight and while docked (same as Map / Missions).
    inventoryOpen = !inventoryOpen
    audio.setThrustState(null)
    if (inventoryOpen) {
      exitFlightMode()
      inventoryUI.show(() => {
        inventoryOpen = false
        if (!docked) reenterFlightMode()
      })
    } else {
      inventoryUI.hide()
      if (!docked) reenterFlightMode()
    }
  } else if (e.code === 'KeyJ' && !navMapOpen && !paused && !inventoryOpen && !characterOpen && !dockEffect) {
    // Missions tracker is available in flight and while docked.
    missionsOpen = !missionsOpen
    audio.setThrustState(null)
    if (missionsOpen) {
      exitFlightMode()
      missionsUI.show(() => {
        missionsOpen = false
        if (!docked) reenterFlightMode()
      })
    } else {
      missionsUI.hide()
      if (!docked) reenterFlightMode()
    }
  } else if (e.code === 'F1') {
    // Character screen anytime in-session (flight, docked, cruise).
    e.preventDefault()
    e.stopPropagation()
    if (!gameState || paused) return
    // Use both flag and DOM so a desynced state cannot turn F1 into flight toggle.
    if (characterOpen || characterUI?.isOpen?.()) closeCharacterScreen()
    else openCharacterScreen()
  }
})

/** Cancels a pending post-close reenterFlightMode when F1 opens again quickly. */
let characterFlightRestoreToken = 0

/**
 * Open Character (F1). Soft-unlocks the pointer without clearing flight intent,
 * and keeps unlock→pause suppressed the whole time the screen is open so a
 * delayed pointerlockchange cannot open the pause menu.
 */
function openCharacterScreen() {
  if (!gameState || paused || !characterUI) return
  // Cancel any delayed re-lock from a previous close — that was stealing the
  // second F1 open and making it look like flight-mode toggle only.
  characterFlightRestoreToken += 1

  // Already visibly open — leave as-is (close is handled by F1 caller).
  if (characterOpen && characterUI.isOpen?.()) {
    characterUI.refresh?.()
    return
  }

  // Close competing overlays so F1 always works.
  if (navMapOpen) {
    navMap?.hide()
    navMapOpen = false
  }
  if (inventoryOpen) {
    inventoryUI?.hide()
    inventoryOpen = false
  }
  if (missionsOpen) {
    missionsUI?.hide()
    missionsOpen = false
  }

  characterOpen = true
  audio.setThrustState(null)
  // Soft unlock: free the mouse but keep flightModeWanted so close re-locks.
  // Holding suppress the entire time character is open blocks auto-pause.
  suppressPointerUnlockPause = true
  flightMode = false
  laserFireHeld = false
  missileFireHeld = false
  setChaseFreeLook(false)
  if (crosshairEl) crosshairEl.style.display = 'none'
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'
  // Overview stays visible while undocked; only disable clicks under the modal.
  systemOverview?.setInteractive(false)
  if (document.pointerLockElement === renderer.domElement) {
    document.exitPointerLock()
  }

  try {
    characterUI.show(() => {
      // Close button / backdrop click.
      closeCharacterScreen()
    })
  } catch (err) {
    console.error('Character screen failed to open:', err)
    characterOpen = false
    suppressUnlockPauseForFrames(2)
  }
  // If show did not actually display, clear the flag so the next F1 retries open.
  if (!characterUI.isOpen?.()) {
    characterOpen = false
  }
}

/**
 * Close Character (F1 / Esc / Close). Silent-hide so onClose does not re-enter,
 * then restore flight after portrait WebGL dispose settles.
 */
function closeCharacterScreen() {
  if (!characterOpen && !characterUI?.isOpen?.()) return
  characterOpen = false
  // Stay suppressed through dispose + pointer re-lock (otherwise unlock
  // after reenterFlightMode opens the pause menu).
  suppressPointerUnlockPause = true
  characterUI?.hide({ silent: true })
  // Overview remains shown (undocked); animate loop restores interactivity.

  if (!docked && !cruising && !paused && !navMapOpen && !inventoryOpen && !missionsOpen && !jumpEffect) {
    const token = ++characterFlightRestoreToken
    // Next frame: portrait WebGL is fully torn down before we re-lock.
    requestAnimationFrame(() => {
      if (token !== characterFlightRestoreToken) return
      if (characterOpen || paused || docked) {
        suppressUnlockPauseForFrames(2)
        return
      }
      reenterFlightMode()
      suppressUnlockPauseForFrames(4)
    })
  } else {
    characterFlightRestoreToken += 1
    suppressUnlockPauseForFrames(2)
  }
}

// Tab-lock range for ships/wrecks/rocks/bodies (surface dist for celestials).
// Radar draws farther so contacts appear before they are lockable.
const TARGET_RANGE = 60000
// Fallback star shell when mesh isn't built yet (giants are far larger — see starShellRadius).
const STAR_TARGET_RADIUS = 13200
// Clear past the primary photosphere when dropping SC at the system sun.
const STAR_SUPERCRUISE_STANDOFF = 3500

/** Photosphere + corona reach for the local sun (binary companions included). */
function starShellRadius() {
  const stars = starMesh?.userData?.stars
  if (!stars?.length) return STAR_TARGET_RADIUS
  let shell = 0
  for (const s of stars) {
    const core = s.radius ?? 0
    // Outer corona shells hug the photosphere (~1.06× core + soft glow).
    const corona = core * 1.35
    const orbitR = s.orbit?.radius ?? 0
    shell = Math.max(shell, orbitR + corona)
  }
  return Math.max(STAR_TARGET_RADIUS, shell)
}

/**
 * SC arrival for the system star — outside the *primary* photosphere/corona.
 * Does not use the full binary envelope (that made arrival ~90km+ and SC crawl).
 */
function starSupercruiseArrivalRange() {
  const shipR = getShipCollisionRadius(playerShipClass)
  const primary = starMesh?.userData?.stars?.[0]
  // Primary is always the largest / origin component (see buildStarMesh).
  const coreR = primary?.radius ?? STAR_TARGET_RADIUS * 0.45
  // ~corona1 scale past the photosphere, plus a fixed standoff.
  return coreR * 1.35 + shipR + STAR_SUPERCRUISE_STANDOFF
}

const TARGETABLE_BODY_KINDS = new Set(['planet', 'moon', 'station', 'settlement', 'warpGate'])

function asteroidWorldPosition(field, rock) {
  return [field.position[0] + rock.position[0], field.position[1] + rock.position[1], field.position[2] + rock.position[2]]
}

/**
 * Per-frame hostility context — avoid getSystem/truce/security work per NPC
 * (radar + drones used to re-run those for every contact; first engage felt hitchy).
 */
function buildHostilityContext() {
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (system) ensureSystemSecurity(system)
  return {
    system,
    truce: truceActive(gameState),
    engagedMap: gameState.player.combatEngagedNpcIds ?? {},
    policeSos: policeHostileToPlayer(gameState, system),
    civSos: civiliansHostileToPlayer(gameState, system)
  }
}

// Aliens are always hostile to the player; pirates are too, except while
// truced against a shared alien threat (see combat.js's truceActive) — used
// for both the radar dot color and the target-indicator reticle tint.
// Police SOS at law ≤2 (sec 1–6); civilians SOS at law ≤0 in sec 3–6.
// Anyone you've exchanged fire with also counts as hostile.
function isHostileToPlayer(npc, ctx = null) {
  if (!npc || npc.destroyed) return false
  // Sticky flag set on first exchange of fire — O(1) radar/drone path.
  if (npc.hostileToPlayer) return true
  if (npc.faction === 'alien') return true
  const c = ctx ?? buildHostilityContext()
  if (npc.faction === 'pirate' && !c.truce) return true
  if (npc.faction === 'police') {
    return c.policeSos || !!c.engagedMap[npc.id]
  }
  if (npc.faction === 'trader' || !npc.faction) {
    return c.civSos || !!c.engagedMap[npc.id]
  }
  return !!c.engagedMap[npc.id]
}

function bodyKindLabel(kind) {
  if (kind === 'asteroidField') return 'belt'
  if (kind === 'warpGate') return 'warp gate'
  return kind
}

function getTargetableEntities() {
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const entities = []

  for (const npc of gameState.npcs) {
    if (npc.destroyed) continue
    const dist = shipPos.distanceTo(new THREE.Vector3().fromArray(npc.position))
    if (dist <= TARGET_RANGE) entities.push({ kind: 'npc', id: npc.id, position: npc.position, dist, radius: 0 })
  }

  for (const wreck of gameState.wrecks) {
    const dist = shipPos.distanceTo(new THREE.Vector3().fromArray(wreck.position))
    if (dist <= TARGET_RANGE) entities.push({ kind: 'wreck', id: wreck.id, position: wreck.position, dist, radius: 0 })
  }

  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)

  // System star (always at local origin).
  {
    const starPos = [0, 0, 0]
    const starR = starShellRadius()
    const dist = shipPos.distanceTo(new THREE.Vector3(...starPos))
    const surfaceDist = Math.max(0, dist - starR)
    if (surfaceDist <= TARGET_RANGE) {
      entities.push({
        kind: 'star',
        id: SYSTEM_STAR_WAYPOINT_ID,
        position: starPos,
        dist: surfaceDist,
        radius: starR,
        name: currentSystem?.name ?? 'System'
      })
    }
  }

  for (const body of currentSystem.bodies) {
    if (TARGETABLE_BODY_KINDS.has(body.kind)) {
      const bodyPos = new THREE.Vector3().fromArray(body.position)
      const dist = shipPos.distanceTo(bodyPos)
      const radius = collisionRadiusFor(body) ?? 0
      // Surface distance: large planets stay targetable from outside the shell.
      const surfaceDist = Math.max(0, dist - radius)
      if (surfaceDist <= TARGET_RANGE) {
        entities.push({
          kind: 'body',
          id: body.id,
          position: body.position,
          dist: surfaceDist,
          radius,
          bodyKind: body.kind,
          name: body.name
        })
      }
    } else if (body.kind === 'asteroidField') {
      getAsteroidRocks(body).forEach((rock, index) => {
        if (!isRockAlive(gameState, body.id, index)) return
        const position = asteroidWorldPosition(body, rock)
        const dist = shipPos.distanceTo(new THREE.Vector3(...position))
        if (dist <= TARGET_RANGE) entities.push({ kind: 'asteroid', fieldId: body.id, index, position, dist, radius: 0 })
      })
    }
  }

  // Fully scanned Spatial Anomaly sites — central relic, nodules, alien base.
  if (currentSystem) {
    ensureSystemAnomalies(currentSystem, gameState.galaxy)
    for (const a of currentSystem.spatialAnomalies ?? []) {
      if (!a.fullyScanned) continue
      if (a.status === 'completed' || a.status === 'despawning') continue
      if (isDatacoreType(a.type)) {
        const siteDist = shipPos.distanceTo(new THREE.Vector3().fromArray(a.position))
        if (siteDist <= TARGET_RANGE) {
          entities.push({
            kind: 'anomaly',
            id: a.id,
            position: a.position,
            dist: siteDist,
            radius: 90,
            name: a.displayName || 'Datacore Relic'
          })
        }
        for (const n of a.nodules ?? []) {
          if (n.status === 'destroyed') continue
          const nd = shipPos.distanceTo(new THREE.Vector3().fromArray(n.position))
          if (nd > TARGET_RANGE) continue
          entities.push({
            kind: 'nodule',
            id: n.id,
            anomalyId: a.id,
            position: n.position,
            dist: nd,
            radius: 30,
            status: n.status,
            name:
              n.status === 'open'
                ? 'Datacore nodule (unlocked)'
                : 'Datacore nodule'
          })
        }
      } else if (
        a.type === 'alien_incursion' &&
        !a.baseDestroyed &&
        alienSiteRuntime?.anomalyId === a.id
      ) {
        const bd = shipPos.distanceTo(new THREE.Vector3().fromArray(a.position))
        if (bd <= TARGET_RANGE) {
          entities.push({
            kind: 'alien_base',
            id: a.id,
            position: a.position,
            dist: bd,
            radius: 110,
            name: 'Alien base'
          })
        }
      }
    }
  }

  return entities
}

// Asteroid entries are identified by (fieldId, index) rather than a single
// id, since one field body produces many targetable rocks.
function sameTarget(a, b) {
  if (!a || !b || a.kind !== b.kind) return false
  return a.kind === 'asteroid' ? a.fieldId === b.fieldId && a.index === b.index : a.id === b.id
}

function toTargetRef(entity) {
  return entity.kind === 'asteroid' ? { kind: 'asteroid', fieldId: entity.fieldId, index: entity.index } : { kind: entity.kind, id: entity.id }
}

// How well the ship's forward boresight lines up with an entity. Small targets
// use a pure cone; large bodies also score high if the aim ray clips their shell
// (looking at a planet's limb still locks the planet).
function aimScore(entity, shipPos, forward) {
  const pos = new THREE.Vector3().fromArray(entity.position)
  const to = pos.clone().sub(shipPos)
  const dist = to.length()
  if (dist < 1e-4) return 1
  const dir = to.clone().multiplyScalar(1 / dist)
  let score = dir.dot(forward)
  const radius = entity.radius ?? 0
  if (radius > 2) {
    const along = to.dot(forward)
    if (along > 0) {
      const missSq = Math.max(0, to.lengthSq() - along * along)
      if (missSq <= radius * radius) score = Math.max(score, 0.995)
    }
  }
  return score
}

// Bodies that can be locked as a navigation waypoint via Ctrl+Tab (fields as
// a whole, not individual rocks — rocks are combat/mining targets only).
const WAYPOINTABLE_BODY_KINDS = new Set([
  'planet',
  'moon',
  'station',
  'settlement',
  'asteroidField',
  'warpGate'
])

// Ctrl+Tab: set (or clear) a waypoint on whatever body is under the crosshair.
// No range limit — any body in the system whose aim cone / limb is under the
// reticle counts (distant planets included). Combat Tab targeting still uses TARGET_RANGE.
function setWaypointFromCrosshair() {
  if (!gameState) return
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(gameState.player.ship.quaternion)
  )
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const candidates = []

  // System star at origin — always eligible; aimScore decides if it's under reticle.
  candidates.push({
    id: SYSTEM_STAR_WAYPOINT_ID,
    position: [0, 0, 0],
    radius: starShellRadius(),
    name: currentSystem?.name ?? 'System'
  })

  for (const body of currentSystem.bodies) {
    if (!WAYPOINTABLE_BODY_KINDS.has(body.kind)) continue
    const radius = collisionRadiusFor(body) ?? (body.kind === 'asteroidField' ? (body.radius ?? 80) : 0)
    candidates.push({
      id: body.id,
      position: body.position,
      radius,
      name: body.name
    })
  }

  // Prefer strongest aim; limb-hit on large shells scores ~0.995 (see aimScore).
  // Threshold only filters "not actually under the crosshair" — never distance.
  let best = null
  let bestScore = 0.9
  for (const c of candidates) {
    const score = aimScore(c, shipPos, forward)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }

  if (!best) {
    flashToast('No body under crosshair — aim at a planet, moon, star, station, settlement, or belt')
    return
  }

  // Clearing the current waypoint is always allowed; setting a new one is not
  // during supercruise (would redirect the SC autopilot mid-flight).
  if (gameState.player.waypointBodyId === best.id) {
    gameState.player.waypointBodyId = null
    gameState.player.waypointPosition = null
    audio.playWaypointClear()
    flashToast(`Waypoint cleared: ${best.name}`)
    return
  }

  if (cruising) {
    flashToast('Unable to set a waypoint during Supercruise.')
    return
  }

  gameState.player.waypointBodyId = best.id
  gameState.player.waypointPosition = best.id === SYSTEM_STAR_WAYPOINT_ID ? [0, 0, 0] : null
  audio.playWaypointSet()
  flashToast(`Waypoint set: ${best.name}`)
}

// Primary star tint for VFX (cruise tunnel). Binary uses the larger component
// (first entry in starMesh.userData.stars — see buildStarMesh).
function getCurrentStarColor() {
  const primary = starMesh?.userData?.stars?.[0]?.color
  return primary?.clone?.() ?? primary ?? null
}

/** Subtle starfield + scene-background tint from the system sun. */
function applySystemStarAmbient() {
  const starColor = getCurrentStarColor()
  setStarfieldStarTint(starfield, starColor)
  // Key light takes the local star's hue too, so a red dwarf system actually
  // lights hulls warm instead of only tinting the backdrop.
  setSunColor(starColor)
  if (starColor) {
    const bg = starColor.clone().lerp(new THREE.Color(0x05070d), 0.94)
    bg.multiplyScalar(0.42)
    scene.background = bg
  } else {
    scene.background = new THREE.Color(0x05070d)
    setStarfieldStarTint(starfield, null)
  }
}

// Host shells that contain the active waypoint (surface settlements etc.) —
// tunnel must not fling the player to the far side of the parent planet.
function cruiseTunnelIgnoreIds(wp, bodies) {
  if (!wp || !bodies?.length) return null
  const ids = new Set()
  for (const body of bodies) {
    if (ignoreBodyAsCruiseObstacle(body, wp.position, wp.bodyId, wp.arrivalRange)) {
      ids.add(body.id)
    }
  }
  return ids.size ? ids : null
}

/** Clear Tab-lock target only — does not touch waypoints / plotted routes. */
function clearTargetLock() {
  currentTarget = null
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'
}

// Tab targeting: anything under the crosshair always wins first. If that
// object is already locked (or nothing is under the reticle), cycle by
// distance to the next entity, wrapping around.
function cycleTarget() {
  const entities = getTargetableEntities()
  if (entities.length === 0) {
    currentTarget = null
    return
  }

  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    new THREE.Quaternion().fromArray(gameState.player.ship.quaternion)
  )
  // Strongest aim under a ~20° cone around boresight / crosshair.
  let underCrosshair = null
  let bestScore = 0.94
  for (const e of entities) {
    const score = aimScore(e, shipPos, forward)
    if (score > bestScore) {
      bestScore = score
      underCrosshair = e
    }
  }

  // Priority: always lock under-crosshair if it isn't the current target.
  if (underCrosshair && !sameTarget(underCrosshair, currentTarget)) {
    currentTarget = toTargetRef(underCrosshair)
    return
  }

  const stillValid = currentTarget && entities.some((e) => sameTarget(e, currentTarget))
  if (!stillValid) {
    // Nothing under reticle and no valid lock — clear (don't surprise-lock farthest hostiles).
    currentTarget = null
    return
  }

  entities.sort((a, b) => a.dist - b.dist)
  const idx = entities.findIndex((e) => sameTarget(e, currentTarget))
  const next = entities[(idx + 1) % entities.length]
  currentTarget = toTargetRef(next)
}

// Looks the current target up fresh each frame (never cached), so a
// destroyed NPC target correctly resolves to null instead of a stale
// position. isAsteroid drives both the mining-beam auto-fire eligibility
// Reticle amber tint for asteroids (updateTargetIndicator).
function resolveTarget() {
  if (!currentTarget) return null
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (currentTarget.kind === 'npc') {
    const npc = gameState.npcs.find((n) => n.id === currentTarget.id && !n.destroyed)
    if (!npc) return null
    const shipClass = getShipClass(npc.shipClassId)
    const maxHull = shipClass.stats.hull
    const maxShields = shipClass.stats.shields
    const maxArmor = shipClass.stats.armor
    const faction = npc.faction || 'unknown'
    return {
      position: npc.position,
      name: shipClass.name,
      pilotName: npc.pilotName || null,
      faction,
      hostile: isHostileToPlayer(npc),
      hullPct: Math.max(0, npc.hull / maxHull),
      shields: npc.shields ?? 0,
      maxShields,
      armor: npc.armor ?? 0,
      maxArmor,
      hull: npc.hull ?? 0,
      maxHull,
      isAsteroid: false,
      reticle: 'hostile'
    }
  }
  if (currentTarget.kind === 'wreck') {
    const wreck = gameState.wrecks.find((w) => w.id === currentTarget.id)
    return wreck
      ? {
          position: wreck.position,
          name: 'Wreck',
          hostile: false,
          hullPct: null,
          isAsteroid: false,
          reticle: 'wreck',
          kindLabel: 'wreck'
        }
      : null
  }
  if (currentTarget.kind === 'asteroid') {
    const field = currentSystem.bodies.find((b) => b.id === currentTarget.fieldId)
    if (!field) return null
    const rock = getAsteroidRocks(field)[currentTarget.index]
    if (!rock || !isRockAlive(gameState, field.id, currentTarget.index)) return null
    const oreLeft = rockOreRemaining(gameState, field.id, currentTarget.index)
    const oreMax = rockOreMax(field.id, currentTarget.index)
    return {
      position: asteroidWorldPosition(field, rock),
      name: `${rockDisplayName(currentSystem, field.oreOverride)} (${field.name})`,
      hostile: false,
      hullPct: null,
      oreLeft,
      oreMax,
      isAsteroid: true,
      reticle: 'asteroid',
      kindLabel: 'asteroid'
    }
  }
  if (currentTarget.kind === 'star') {
    return {
      position: [0, 0, 0],
      name: currentSystem?.name ?? 'System',
      hostile: false,
      hullPct: null,
      isAsteroid: false,
      reticle: 'star',
      kindLabel: 'star'
    }
  }
  // Free-space nav point (e.g. after supercruise drop on a mission marker).
  if (currentTarget.kind === 'navpoint') {
    if (!currentTarget.position) return null
    return {
      position: currentTarget.position,
      name: currentTarget.name || 'Destination',
      hostile: false,
      hullPct: null,
      isAsteroid: false,
      reticle: 'nav',
      kindLabel: 'nav'
    }
  }
  if (currentTarget.kind === 'anomaly') {
    ensureSystemAnomalies(currentSystem, gameState.galaxy)
    const a = (currentSystem.spatialAnomalies ?? []).find((x) => x.id === currentTarget.id)
    if (!a?.fullyScanned || a.status === 'completed' || a.status === 'despawning') return null
    return {
      position: a.position,
      name: a.displayName || 'Datacore Relic',
      hostile: false,
      hullPct: null,
      isAsteroid: false,
      reticle: 'anomaly',
      kindLabel: isDatacoreType(a.type) ? 'datacore relic' : 'anomaly'
    }
  }
  if (currentTarget.kind === 'nodule') {
    ensureSystemAnomalies(currentSystem, gameState.galaxy)
    for (const a of currentSystem.spatialAnomalies ?? []) {
      if (a.type !== 'datacore' || !a.fullyScanned) continue
      if (a.status === 'completed' || a.status === 'despawning') continue
      const n = (a.nodules ?? []).find((x) => x.id === currentTarget.id)
      if (!n || n.status === 'destroyed') return null
      return {
        position: n.position,
        name: n.status === 'open' ? 'Datacore nodule (unlocked)' : 'Datacore nodule',
        hostile: false,
        hullPct: null,
        isAsteroid: false,
        reticle: 'nodule',
        kindLabel: n.status === 'sealed' ? 'sealed · hack with F' : 'unlocked',
        noduleStatus: n.status
      }
    }
    return null
  }
  if (currentTarget.kind === 'alien_base') {
    if (!alienSiteRuntime || alienSiteRuntime.anomalyId !== currentTarget.id) return null
    const a = getAnomaly(currentSystem, currentTarget.id, gameState.galaxy)
    if (!a || a.baseDestroyed) return null
    const maxHull = alienSiteRuntime.maxHull ?? 420
    const hull = Math.max(0, alienSiteRuntime.hull ?? 0)
    return {
      position: alienSiteRuntime.position,
      name: 'Alien base',
      hostile: true,
      hullPct: maxHull > 0 ? hull / maxHull : 0,
      hull,
      maxHull,
      isAsteroid: false,
      reticle: 'alien_base',
      kindLabel: 'alien base'
    }
  }
  if (currentTarget.kind !== 'body') return null
  const body = currentSystem.bodies.find((b) => b.id === currentTarget.id)
  if (!body) return null
  // Whole belts are waypoint-only — Tab-lock individual rocks instead.
  if (body.kind === 'asteroidField') return null
  return {
    position: body.position,
    name: body.name,
    hostile: false,
    hullPct: null,
    isAsteroid: false,
    reticle: body.kind === 'station' || body.kind === 'settlement' ? 'facility' : 'world',
    kindLabel: bodyKindLabel(body.kind)
  }
}

function targetReticleColor(target) {
  if (target.hostile) return '#e05a5a'
  if (target.reticle === 'asteroid') return '#ffb347'
  if (target.reticle === 'star') return '#ffd27a'
  if (target.reticle === 'facility') return 'var(--ui-accent)'
  if (target.reticle === 'world') return 'var(--ui-soft)'
  if (target.reticle === 'wreck') return '#c0a070'
  if (target.reticle === 'nav') return '#7fe0a0'
  if (target.reticle === 'anomaly') return '#d080ff'
  if (target.reticle === 'nodule') return '#60f0ff'
  if (target.reticle === 'alien_base') return '#ff6040'
  return 'var(--ui-text)'
}

function updateTargetIndicator() {
  const target = resolveTarget()
  if (!target) {
    currentTarget = null
    targetIndicatorEl.style.display = 'none'
    return
  }

  const projected = new THREE.Vector3(...target.position).project(camera)
  if (projected.z > 1) {
    targetIndicatorEl.style.display = 'none'
    return
  }

  targetIndicatorEl.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`
  targetIndicatorEl.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`
  targetIndicatorEl.style.display = 'block'
  const color = targetReticleColor(target)
  targetIndicatorEl.querySelector('.target-box').style.borderColor = color
  const label = targetIndicatorEl.querySelector('.target-label')
  // Reticle keeps faction/type colour; label uses probe-info look via class.
  const dist = new THREE.Vector3().fromArray(gameState.player.ship.position).distanceTo(new THREE.Vector3(...target.position))
  const kindBit = target.kindLabel ? ` · ${target.kindLabel}` : ''
  if (target.hullPct !== null) {
    label.textContent = `${target.name} · ${Math.round(dist)}m · ${Math.round(target.hullPct * 100)}%`
  } else if (target.isAsteroid && target.oreLeft != null) {
    // Show remaining ore so you know when the rock will explode.
    const maxBit = target.oreMax != null ? `/${target.oreMax}` : ''
    label.textContent = `${target.name} · ${Math.round(dist)}m · ${target.oreLeft}${maxBit} ore`
  } else {
    label.textContent = `${target.name}${kindBit} · ${Math.round(dist)}m`
  }
}

// Arrow sitting next to the ship's screen position, aimed at the current
// Tab target. Off when nothing is locked — complement to the on-target reticle.
// Distance from the projected ship to the direction chevron (px).
// Higher = further from dead-center / the hull silhouette.
const TARGET_DIR_OFFSET_PX = 96
const _tdirShip = new THREE.Vector3()
const _tdirTarget = new THREE.Vector3()
const _tdirTo = new THREE.Vector3()
const _tdirRight = new THREE.Vector3()
const _tdirUp = new THREE.Vector3()
const _tdirShipProj = new THREE.Vector3()

function updateTargetDirectionIndicator() {
  if (!targetDirEl) return
  const target = resolveTarget()
  if (!target || !gameState || docked) {
    targetDirEl.style.display = 'none'
    return
  }

  // Must match the camera used for project() this frame (chase seat already synced).
  camera.updateMatrixWorld(true)
  _tdirShip.fromArray(gameState.player.ship.position)
  _tdirTarget.fromArray(target.position)

  // World direction ship → target (not camera → target: chase offset made the
  // old camLocal-position approach point the wrong way, especially off-boresight
  // and in free-look).
  _tdirTo.subVectors(_tdirTarget, _tdirShip)
  if (_tdirTo.lengthSq() < 1e-10) {
    targetDirEl.style.display = 'none'
    return
  }
  _tdirTo.normalize()

  // Camera world axes (column-major matrixWorld).
  const me = camera.matrixWorld.elements
  _tdirRight.set(me[0], me[1], me[2])
  _tdirUp.set(me[4], me[5], me[6])
  if (_tdirRight.lengthSq() < 1e-10 || _tdirUp.lengthSq() < 1e-10) {
    targetDirEl.style.display = 'none'
    return
  }
  _tdirRight.normalize()
  _tdirUp.normalize()

  // Screen: +X right, +Y down (CSS). Camera +Y is up → flip.
  let dirX = _tdirTo.dot(_tdirRight)
  let dirY = -_tdirTo.dot(_tdirUp)
  // Nearly along the view axis — (x,y) vanishes; keep a stable “ahead” cue.
  if (Math.abs(dirX) < 1e-5 && Math.abs(dirY) < 1e-5) {
    dirX = 0
    dirY = -1
  }
  const len = Math.hypot(dirX, dirY) || 1
  dirX /= len
  dirY /= len

  // Anchor on the ship's projected screen position (chase cam: lower-center).
  _tdirShipProj.copy(_tdirShip).project(camera)
  const w = window.innerWidth
  const h = window.innerHeight
  // NDC z outside ~[-1,1] can mean behind / clipped — still place using center
  // fallback so the chevron remains usable during extreme free-look.
  let sx
  let sy
  if (!Number.isFinite(_tdirShipProj.x) || !Number.isFinite(_tdirShipProj.y)) {
    sx = w * 0.5
    sy = h * 0.62
  } else {
    sx = (_tdirShipProj.x * 0.5 + 0.5) * w
    sy = (-_tdirShipProj.y * 0.5 + 0.5) * h
    // Clamp so the cue stays on-screen if projection goes wild.
    sx = Math.max(24, Math.min(w - 24, sx))
    sy = Math.max(24, Math.min(h - 24, sy))
  }

  targetDirEl.style.left = `${Math.round(sx + dirX * TARGET_DIR_OFFSET_PX)}px`
  targetDirEl.style.top = `${Math.round(sy + dirY * TARGET_DIR_OFFSET_PX)}px`
  targetDirEl.style.display = 'block'
  const color = targetReticleColor(target)
  const arrow = targetDirEl.querySelector('.tdir-arrow')
  // Triangle points "up" (border-bottom); +π/2 maps atan2(screenY_down, screenX) to it.
  arrow.style.transform = `rotate(${Math.atan2(dirY, dirX) + Math.PI / 2}rad)`
  arrow.style.borderBottomColor = color
}

// Shared with chase cam + guns: ship +Z × AIM_LOOK_AHEAD (see sceneSync).
const _boresightAim = new THREE.Vector3()
const _boresightFwd = new THREE.Vector3()
const _boresightQuat = new THREE.Quaternion()

function getShipForwardWorld(out = _boresightFwd) {
  const ship = gameState.player.ship
  _boresightQuat.fromArray(ship.quaternion).normalize()
  out.set(0, 0, 1).applyQuaternion(_boresightQuat)
  if (out.lengthSq() < 1e-8) out.set(0, 0, 1)
  else out.normalize()
  return out
}

/** Tunnel FX / short helpers — same axis as combat aim, shorter distance. */
function getCrosshairAimWorld(out = _boresightAim) {
  out.fromArray(gameState.player.ship.position)
  return out.addScaledVector(getShipForwardWorld(_boresightFwd), CROSSHAIR_DISTANCE)
}

/**
 * Reticle always marks the projected combat aim point (same point guns use).
 * Scale X/Y separately so the ring is round in pixels (not NDC-squashed).
 */
function updateCrosshair() {
  if (crosshairEl) crosshairEl.style.display = 'none'
  if (combatReticle3d) combatReticle3d.visible = false
  // Hide while Alt free-look frames the hull (reticle would sit on the ship).
  const on = !!(flightMode && gameState && !docked && !paused && !isChaseFreeLook())
  hudReticleRing.visible = on
  hudReticleDot.visible = on
  if (!on) return

  // ~16px outer radius in screen pixels → NDC half-extents (aspect-correct).
  const w = Math.max(1, renderer.domElement.clientWidth)
  const h = Math.max(1, renderer.domElement.clientHeight)
  const outerPx = 8
  const sx = (outerPx / w) * 2
  const sy = (outerPx / h) * 2
  hudReticleRing.scale.set(sx, sy, 1)
  hudReticleDot.scale.set(sx, sy, 1)

  camera.updateMatrixWorld(true)
  getShipAimPoint(gameState.player.ship, _boresightAim, AIM_LOOK_AHEAD)
  const p = _boresightAim.project(camera)
  if (Number.isFinite(p.x) && Number.isFinite(p.y) && p.z <= 1) {
    hudReticleRing.position.set(p.x, p.y, -1)
    hudReticleDot.position.set(p.x, p.y, -1)
  } else {
    hudReticleRing.position.set(0, 0, -1)
    hudReticleDot.position.set(0, 0, -1)
  }
}

/** After SC drops the waypoint, lock Tab-target on the destination for a reticle. */
function setTargetFromSupercruiseArrival(wp) {
  if (!wp) return
  if (wp.bodyId === SYSTEM_STAR_WAYPOINT_ID) {
    currentTarget = { kind: 'star', id: SYSTEM_STAR_WAYPOINT_ID }
    return
  }
  if (wp.bodyId) {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const body = system?.bodies?.find((b) => b.id === wp.bodyId)
    // Belts stay waypointable for SC, but are not Tab-lock targets as a whole.
    if (body?.kind === 'asteroidField') {
      currentTarget = null
      return
    }
    currentTarget = { kind: 'body', id: wp.bodyId }
    return
  }
  // Free-space marker (e.g. bounty hunt) — fixed point, not a body.
  if (wp.position) {
    currentTarget = {
      kind: 'navpoint',
      id: 'sc-arrival',
      position: [...wp.position],
      name: wp.name || 'Destination'
    }
  }
}

// Body waypoint, system star, or free-space mission marker (bounty location).
function getActiveWaypoint() {
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (gameState.player.waypointBodyId === SYSTEM_STAR_WAYPOINT_ID) {
    return {
      position: [0, 0, 0],
      name: currentSystem?.name ?? 'System',
      bodyId: SYSTEM_STAR_WAYPOINT_ID,
      isMission: false,
      // Drop SC outside the photosphere / corona (not inside the sun).
      arrivalRange: starSupercruiseArrivalRange()
    }
  }
  if (gameState.player.waypointBodyId) {
    const body = currentSystem.bodies.find((b) => b.id === gameState.player.waypointBodyId)
    if (body) {
      const missionBodies = missionMarkedBodyIds(gameState, currentSystem.id)
      return {
        position: body.position,
        name: body.name,
        bodyId: body.id,
        isMission: missionBodies.has(body.id),
        arrivalRange: supercruiseArrivalRangeFor(body)
      }
    }
    // Fully scanned Spatial Anomaly (overview waypoint)
    const anomaly = getAnomaly(currentSystem, gameState.player.waypointBodyId, gameState.galaxy)
    if (anomaly?.fullyScanned && anomaly.position) {
      return {
        position: anomaly.position,
        name: anomaly.displayName || 'Spatial Anomaly',
        bodyId: anomaly.id,
        isMission: true,
        arrivalRange: 900
      }
    }
  }
  if (gameState.player.waypointPosition) {
    return {
      position: gameState.player.waypointPosition,
      name: 'Mission Target',
      bodyId: null,
      isMission: true,
      arrivalRange: 80
    }
  }
  return null
}

const _wpTarget = new THREE.Vector3()
const _wpShip = new THREE.Vector3()
const _wpCamLocal = new THREE.Vector3()
const _wpProj = new THREE.Vector3()
/**
 * Stack floating messages just below the top-center ship status panel (white text).
 * Probe classification panel stays left-side — not included here.
 */
function updateBelowRadarPrompts() {
  pruneToastQueue()
  const visible = [
    cruiseIndicatorEl,
    craftToastEl,
    saveToastEl,
    factionToastEl,
    miningToastEl,
    // Ad-hoc event toasts (flashToast) — oldest first so the newest lands
    // closest to the action prompts below and older ones get pushed down.
    ...toastQueue.map((t) => t.el),
    dockPromptEl,
    probePromptEl,
    wreckPromptEl,
    probeResultsEl,
    // hailResultsEl was styled with a ONE-TIME top offset captured at HUD
    // build time — the same starting y this stacker uses — so it sat directly
    // on top of whichever prompt (most often "Dock with...") happened to
    // already occupy that band instead of stacking below it.
    hailResultsEl
  ].filter((el) => el && el.style.display === 'block')
  if (!visible.length) return

  let y = getFloatHudBandTopPx()
  for (const el of visible) {
    // Match probe-info soft white (class + clear any temporary tint).
    el.classList.add('float-info-text')
    el.style.color = 'rgba(255,255,255,0.94)'
    el.style.removeProperty('opacity')
    el.style.left = '50%'
    el.style.top = `${y}px`
    el.style.bottom = 'auto'
    el.style.transform = 'translateX(-50%)'
    y += (el.offsetHeight || 18) + 6
  }
}

function updateWaypointIndicator() {
  const wp = getActiveWaypoint()
  if (!wp || !waypointEl) {
    if (waypointEl) waypointEl.style.display = 'none'
    return
  }

  const color = wp.isMission ? '#ff8a3d' : '#7fe0a0'
  _wpTarget.fromArray(wp.position)
  _wpShip.fromArray(gameState.player.ship.position)
  const distance = _wpShip.distanceTo(_wpTarget)

  // Behind test in camera space (Three: look = -Z). Don't use project().z —
  // points past camera.far looked "behind" even when in front (hid far WPs).
  camera.updateMatrixWorld(true)
  _wpCamLocal.copy(_wpTarget).applyMatrix4(camera.matrixWorldInverse)
  const behind = _wpCamLocal.z >= 0
  _wpProj.copy(_wpTarget).project(camera)

  const w = window.innerWidth
  const h = window.innerHeight
  const cx = w / 2
  const cy = h / 2
  const margin = 60

  // Screen-pixel direction from view center toward waypoint.
  // Scale NDC by (w,h) so diagonals are aspect-correct (raw NDC unit vectors
  // treat the viewport as square and skew edge placement on widescreen).
  // Behind: project() already flips via negative w; camLocal fallback flips
  // explicitly and applies projection scale for the same aspect correction.
  let dirX
  let dirY
  if (Number.isFinite(_wpProj.x) && Number.isFinite(_wpProj.y)) {
    dirX = _wpProj.x * w
    dirY = -_wpProj.y * h // NDC +Y up → screen Y down
  } else {
    // Rare non-finite project: camera-local lateral × projection scale.
    const pe = camera.projectionMatrix.elements
    dirX = _wpCamLocal.x * pe[0] * w
    dirY = -_wpCamLocal.y * pe[5] * h
    if (behind) {
      dirX = -dirX
      dirY = -dirY
    }
  }
  if (Math.abs(dirX) < 1e-8 && Math.abs(dirY) < 1e-8) {
    dirX = 0
    dirY = behind ? 1 : -1
  }

  const onScreen =
    !behind &&
    Number.isFinite(_wpProj.x) &&
    Number.isFinite(_wpProj.y) &&
    _wpProj.x >= -1 &&
    _wpProj.x <= 1 &&
    _wpProj.y >= -1 &&
    _wpProj.y <= 1

  let dx
  let dy
  if (onScreen) {
    // Sit on the projected waypoint (center of view → marker offset).
    dx = (_wpProj.x * 0.5 + 0.5) * w - cx
    dy = (-_wpProj.y * 0.5 + 0.5) * h - cy
  } else {
    // Clamp to screen edge along the aspect-correct screen direction.
    const len = Math.hypot(dirX, dirY) || 1
    dirX /= len
    dirY /= len
    const sx = (w / 2 - margin) / Math.max(1e-6, Math.abs(dirX))
    const sy = (h / 2 - margin) / Math.max(1e-6, Math.abs(dirY))
    const edge = Math.min(sx, sy)
    dx = dirX * edge
    dy = dirY * edge
  }

  // Triangle points up; +π/2 maps atan2(screenY_down, screenX) like target cue.
  const angle = Math.atan2(dy, dx) + Math.PI / 2
  waypointEl.style.left = `${cx + dx}px`
  waypointEl.style.top = `${cy + dy}px`
  waypointEl.style.transform = 'translate(-50%, -50%)'
  waypointEl.style.display = 'block'
  const arrow = waypointEl.querySelector('.wp-arrow')
  arrow.style.transform = `rotate(${angle}rad)`
  arrow.style.borderBottomColor = color
  const label = waypointEl.querySelector('.wp-label')
  // Arrow keeps mission/nav colour; name text uses probe-info look via class.
  const distLabel = distance >= 10000 ? `${(distance / 1000).toFixed(1)}km` : `${Math.round(distance)}m`
  label.textContent = `${wp.name} · ${distLabel}`
}

let lastTime = performance.now()
function animate() {
  requestAnimationFrame(animate)
  const now = performance.now()
  const dt = Math.min((now - lastTime) / 1000, 0.1)
  lastTime = now
  // Both are fixed-radius point/sprite clouds scattered around world origin
  // at creation time — recentering them on the camera every frame turns them
  // into a proper skybox that always surrounds the viewer, rather than a
  // patch of decoration the camera can fly outside of once it's traveled
  // far enough from the origin (now routine given how large systems are).
  starfield.position.copy(camera.position)
  nebula.position.copy(camera.position)
  updateNebula(nebula, dt)
  updateStarfield(starfield, now / 1000)

  if (!gameState) {
    motionFx.hide()
    updateMenuBackground(dt)
    render()
    return
  }

  // Wall-clock industry jobs (run even while docked / in menus / mid-jump UI).
  {
    const done = updateCraftingJobs(gameState, Date.now())
    if (done.length) toastCraftCompleted(done)
  }

  // Campaign clock tracks real time while not on the pause menu (asteroids, etc.).
  if (!paused) {
    advanceGameClock(gameState)
    // Every 4 sim-hours, reshuffle spatial anomalies galaxy-wide.
    if (gameState.galaxy) {
      const { refreshed } = tickGalaxyAnomalies(gameState.galaxy, gameState.simTime)
      if (refreshed) {
        alienSiteRuntime = null
        if (Array.isArray(gameState.npcs)) {
          gameState.npcs = gameState.npcs.filter((n) => !n.anomalySiteId)
        }
        // Drop waypoint if it pointed at a cleared anomaly site.
        const wp = gameState.player?.waypointBodyId
        if (wp && String(wp).startsWith('anomaly-')) {
          gameState.player.waypointBodyId = null
        }
        // ore_anomaly sites own a synthetic asteroidField body in system.bodies
        // (added/removed by ensureSystemAnomalies/tickGalaxyAnomalies) — the
        // scene only snapshots system.bodies into meshes on system entry, so
        // rebuild now for whichever system we're currently sitting in.
        const cur = getSystem(gameState.galaxy, gameState.player.currentSystemId)
        if (cur) {
          ensureSystemAnomalies(cur, gameState.galaxy)
          loadBodiesForCurrentSystem()
        }
        flashToast('Spatial anomalies refreshed across the galaxy', 4.5)
      }
    }
  }

  if (jumpEffect) {
    motionFx.hide()
    updateJumpEffect(dt)
    // Same reason as the dock branch: the warp camera swings hard, so the
    // corona must keep re-aiming or it freezes mid-manoeuvre.
    if (starMesh) updateStarMesh(starMesh, gameState.simTime, dt, camera)
    render()
    return
  }

  // Checked before the `docked` early-return below: docked stays true for
  // the whole undocking animation (it only flips false once the animation
  // completes), so this branch must run regardless of `docked`.
  if (dockEffect) {
    cancelRouteAutopilot(routeAutopilot ? 'Autopilot cancelled — docked' : null)
    motionFx.hide()
    updateDockEffect(dt)
    // The star has to keep updating through the dock/undock animation. Its
    // corona flames are billboards aimed in SCREEN space and faded by their
    // angle to the viewer, so skipping this while the camera swings out of the
    // bay left every tongue oriented for the camera pose from before docking —
    // the corona looked scrambled until the first normal frame corrected it.
    if (starMesh) updateStarMesh(starMesh, gameState.simTime, dt, camera)
    // Bay activity runs as soon as the interior is swapped in.
    if (interiorMesh?.parent) updateStationInterior(interiorMesh, dt)
    render()
    return
  }

  // Only the pause menu freezes the sim. Map / Inventory / Missions leave the
  // world running (flight input stays off while those UIs hold the cursor).
  if (paused) {
    audio.setStrafeActive(false)
    motionFx.hide()
    if (targetDirEl) targetDirEl.style.display = 'none'
    updateStarfieldMotion(starfield, 0, false)
    if (docked && interiorMesh?.parent) {
      // Hangar still ticks visually under the pause overlay.
      updateStationInterior(interiorMesh, dt)
      applyDockOrbitCamera()
    }
    render()
    return
  }

  if (docked) {
    cancelRouteAutopilot(routeAutopilot ? 'Autopilot cancelled — docked' : null)
    audio.setStrafeActive(false)
    motionFx.hide()
    if (targetDirEl) targetDirEl.style.display = 'none'
    updateStarfieldMotion(starfield, 0, false)
    applyDockedHud()
    // Keep the hangar alive behind station services (loaders, drones, lights).
    if (interiorMesh?.parent) {
      updateStationInterior(interiorMesh, dt)
      applyDockOrbitCamera()
    }
    // Clock already advanced above; no flight / combat while parked.
    render()
    return
  }

  // Multi-hop Jump Route: 10s pause after each arrival, then auto-jump next hop.
  updateRouteAutopilot(dt)
  updateAnomalySites(dt)

  // Probe flight runs in normal play (ship can still fly while it works).
  if (probeEffect) updateProbeEffect(dt)
  updateProbeScanFloat()
  updatePlayerDrones(dt)

  let thrustState = null
  // Alt free-look works in normal flight and supercruise — consume mouse so
  // it never steers the ship while panning the camera.
  // Engage only once Alt is held AND the mouse actually moves (not bare Alt).
  if (altHeldForFreeLook && (flightMode || cruising)) {
    if (!isChaseFreeLook() && (mouseAim.dx !== 0 || mouseAim.dy !== 0)) {
      setChaseFreeLook(true)
    }
    if (isChaseFreeLook()) {
      addChaseFreeLookDelta(mouseAim.dx, mouseAim.dy)
      mouseAim.dx = 0
      mouseAim.dy = 0
    }
  } else if (isChaseFreeLook()) {
    // Failsafe if alt flag was cleared without setChaseFreeLook(false).
    setChaseFreeLook(false)
  }
  if (cruising) {
    const wp = getActiveWaypoint()
    if (!wp || gameState.inCombat) {
      cruising = false
    } else {
      const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
      const shipRadius = getShipCollisionRadius(playerShipClass)
      // Steer around other bodies on the way; destination body is not avoided
      // so arrival still works (see supercruise.aimAroundObstacles).
      const skillB = playerSkillBonuses(gameState)
      if (updateSupercruise(
        gameState.player.ship,
        playerShipClass,
        wp.position,
        dt,
        wp.arrivalRange,
        currentSystem.bodies,
        shipRadius,
        wp.bodyId,
        {
          speedMult: skillB.speedMult,
          cruiseMult: skillB.cruiseMult,
          turnMult: skillB.turnMult
        }
      )) {
        cruising = false
        // Kill residual cruise speed immediately so we don't coast into the shell.
        gameState.player.ship.velocity = [0, 0, 0]
        gameState.player.ship.throttle = 0
        // Snap facing onto the destination so you're lined up to dock/approach.
        const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
        const targetPos = new THREE.Vector3(...wp.position)
        if (shipPos.distanceToSquared(targetPos) > 1e-4) {
          gameState.player.ship.quaternion = quatFacing(shipPos, targetPos).toArray()
        }
        // Route autopilot: arrival at a warp gate → 10s pause (F to jump early).
        const arrivedBody = wp.bodyId
          ? currentSystem.bodies.find((b) => b.id === wp.bodyId)
          : null
        if (
          routeAutopilot &&
          arrivedBody?.kind === 'warpGate' &&
          arrivedBody.destinationSystemId &&
          shipHasAutopilot(gameState.player.ship)
        ) {
          armRouteAutopilotGateWait(arrivedBody.destinationSystemId, arrivedBody)
        } else {
          // Keep a reticle on the destination after the waypoint is cleared.
          setTargetFromSupercruiseArrival(wp)
          // Clear nav lock on arrival — you're already there.
          gameState.player.waypointBodyId = null
          gameState.player.waypointPosition = null
          // Arriving at a fully mined belt — show respawn countdown.
          toastIfDepletedField(wp.bodyId)
        }
      }
    }
    audio.setThrustState(null)
  } else {
    {
      const skillB = playerSkillBonuses(gameState)
      updateFlight(
        gameState.player.ship,
        playerShipClass,
        flightMode ? keys : EMPTY_KEYS,
        mouseAim,
        dt,
        {
          speedMult: skillB.speedMult,
          turnMult: skillB.turnMult,
          maxSpeed: effectiveMaxSpeed(gameState.player.ship, playerShipClass)
        }
      )
    }
    thrustState = !flightMode ? null : keys.has('KeyW') ? 'accel' : keys.has('KeyS') ? 'brake' : null
    audio.setThrustState(thrustState)
    // Drop laser bolts from the last turn so a stationary burst isn't buried
    // under ~1s of off-boresight trail (ttl 1.2s otherwise).
    prunePlayerLasersOffBoresight(gameState)
  }
  // Keep mesh + chase seat in sync with the post-flight pose *before* weapons
  // and reticles so undock/load can't leave a one-frame cam/gun skew.
  if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
  syncChaseCamera(camera, gameState.player.ship, { cruising, dt })

  // Edge-detect engage/disengage so sample spool-down + voice callout both
  // fire on auto-arrival, combat interrupt, and manual KeyC alike.
  audio.setSupercruiseActive(cruising)
  if (cruising !== wasCruising) {
    if (cruising) {
      // Spool ramp starts at 0 every engage (see supercruise.SUPERCRUISE_RAMP_UP_S).
      gameState.player.ship.supercruiseElapsed = 0
    } else {
      // Drop all residual cruise speed so normal flight doesn't inherit a huge v.
      gameState.player.ship.velocity = [0, 0, 0]
      gameState.player.ship.throttle = 0
      gameState.player.ship.supercruiseElapsed = 0
      // Kill cyan velocity streaks / starfield stretch immediately (don't wait a frame).
      motionFx.stopCruiseStreaks()
      thrusterEffects?.stopCruiseStreaks()
      updateStarfieldMotion(starfield, 0, false)
    }
    // TTS says "supercrews" so speech synthesis hits the right phonetics;
    // on-screen HUD text stays SUPERCRUISE …
    audio.announce(cruising ? 'Supercrews engaged' : 'Supercrews disengaged')
    if (cruising) {
      setHudGlitchText(cruiseIndicatorEl, 'SUPERCRUISE ENGAGED')
      showHudGlitch(cruiseIndicatorEl)
      hud?.setCruiseGlitch(true)
    } else {
      // Brief yellow callout (same style as engage), then glitch-out.
      setHudGlitchText(cruiseIndicatorEl, 'SUPERCRUISE DISENGAGED')
      showHudGlitch(cruiseIndicatorEl)
      hideHudGlitch(cruiseIndicatorEl)
      hud?.setCruiseGlitch(false)
    }
    wasCruising = cruising
  }

  const currentBodies = getSystem(gameState.galaxy, gameState.player.currentSystemId).bodies
  const shipRadius = getShipCollisionRadius(playerShipClass)
  if (cruising) {
    // Tunnel through non-destination bodies with warp FX instead of bouncing.
    // Also skip host shells that contain the waypoint (settlement on a planet).
    const wp = getActiveWaypoint()
    const tunnel = trySupercruiseTunnel(
      gameState.player.ship,
      currentBodies,
      shipRadius,
      wp?.bodyId ?? null,
      cruiseTunnelIgnoreIds(wp, currentBodies)
    )
    if (tunnel) {
      // Visual only — no tunnel whoosh SFX (felt weird punching through worlds).
      thrusterEffects?.playTunnelBurst(tunnel.from, tunnel.to)
    }
  } else {
    // Belts: collide with individual rocks only (not the field bounding shell).
    resolveBodyCollisions(gameState.player.ship, currentBodies, shipRadius, {
      isRockAlive: (fieldId, index) => isRockAlive(gameState, fieldId, index)
    })
  }

  const shipSpeed = Math.hypot(...gameState.player.ship.velocity)
  const motion = motionFx.update(dt, {
    speed: shipSpeed,
    refSpeed: playerShipClass.stats.speed,
    cruising,
    throttle: cruising ? 1 : (gameState.player.ship.throttle ?? 0),
    shipPos: gameState.player.ship.position,
    shipQuat: gameState.player.ship.quaternion,
    camera,
    starColor: cruising ? getCurrentStarColor() : null,
    // Corridor vanishes through the crosshair aim point (ship forward).
    aimWorld: cruising ? getCrosshairAimWorld() : null
  })
  // Skybox stays unwarped; cruise uses motionFx full-screen star tunnel.
  updateStarfieldMotion(starfield, motion.intensity, cruising)
  // Speed FOV: mild in normal flight; cruise uses a fixed +5% FOV only.
  // Snap when close / nearly stopped so FOV settle doesn't smear projected aim.
  const targetFov = cruising ? CRUISE_FOV : BASE_FOV + motion.fovBoost
  const fovErr = Math.abs(camera.fov - targetFov)
  if (fovErr < 0.08 || (!cruising && shipSpeed < 2 && motion.fovBoost < 0.05)) {
    if (camera.fov !== targetFov) {
      camera.fov = targetFov
      camera.updateProjectionMatrix()
    }
  } else {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6)
    camera.updateProjectionMatrix()
  }
  // SUPERCRUISE ENGAGED: shown/hidden with glitch enter/exit on wasCruising edge.
  // Player mesh + chase cam are re-synced after orbital carry (see below).
  syncMeshToEntity(playerMesh, gameState.player.ship)
  const strafeX = cruising ? 0 : (gameState.player.ship.strafeX ?? 0)
  const strafeY = cruising ? 0 : (gameState.player.ship.strafeY ?? 0)
  audio.setStrafeActive(!cruising && flightMode && (strafeX !== 0 || strafeY !== 0))
  thrusterEffects.update(dt, {
    accelActive: thrustState === 'accel',
    brakeActive: thrustState === 'brake',
    cruiseActive: cruising,
    strafeX,
    strafeY,
    shipPos: new THREE.Vector3().fromArray(gameState.player.ship.position),
    shipQuat: new THREE.Quaternion().fromArray(gameState.player.ship.quaternion),
    hullLength: playerShipClass.hull.length,
    nozzles: playerEngineNozzles
  })
  damageEffects.update(dt, {
    armorFraction: gameState.player.ship.armor / Math.max(1, effectiveMaxArmor(gameState.player.ship, playerShipClass)),
    hullFraction: gameState.player.ship.hull / playerShipClass.stats.hull,
    shipPos: new THREE.Vector3().fromArray(gameState.player.ship.position),
    shipQuat: new THREE.Quaternion().fromArray(gameState.player.ship.quaternion),
    hullLength: playerShipClass.hull.length
  })

  oreScoopEffects?.update(dt, new THREE.Vector3().fromArray(gameState.player.ship.position))

  // One security / faction pass for the whole AI loop (avoids combat hitch).
  const combatFrame = prepareCombatFrame(gameState)
  for (const npc of gameState.npcs) {
    if (npc.destroyed) continue
    updateNpcAI(
      npc,
      gameState,
      dt,
      onWeaponFired,
      (fromPos) => {
        notePlayerDamagedBy(npc.id, { ram: true })
        pulseDamageVignette(fromPos)
      },
      combatFrame
    )
    // Shown once, the frame an NPC commits to a suicide run (see combat.js's
    // RAM_CHANCE) — ramQuote is set exactly once, alongside aiState, so this
    // flag just guards against re-showing it every subsequent frame.
    if (npc.aiState === 'ram' && !npc.ramAnnounced) {
      npc.ramAnnounced = true
      setHudGlitchText(factionToastEl, npc.ramQuote)
      showHudGlitch(factionToastEl)
      factionToastUntil = gameState.simTime + FACTION_TOAST_DURATION_S
    }
  }
  updateProjectiles(gameState, dt, onProjectileHit)
  updateCombatFlag(gameState, combatFrame)
  updateDamageVignette(dt)
  // Player shields: 1% of max every 10s while out of combat (see combat.js).
  regenShields(gameState.player.ship, playerShipClass, gameState.simTime, dt, {
    player: true,
    inCombat: gameState.inCombat
  })
  updateMissionProgress(gameState)

  // A pirate truce (see combat.js's truceActive) lasts only as long as a live
  // alien is around to justify it. The moment it lapses — the aliens are all
  // destroyed or have left — any pirates who were part of it thank the player
  // and hyperspace out, rather than turning back to attack the player they
  // were just fighting alongside.
  const truceNowActive = truceActive(gameState)
  if (truceWasActive && !truceNowActive) {
    const departingIds = gameState.npcs.filter((n) => n.faction === 'pirate' && !n.destroyed).map((n) => n.id)
    if (departingIds.length) {
      for (const id of departingIds) {
        removeNpcMesh(id)
      }
      gameState.npcs = gameState.npcs.filter((n) => !departingIds.includes(n.id))
      setHudGlitchText(factionToastEl, 'The pirates thank you for the assist, and hyperspace away.')
      showHudGlitch(factionToastEl)
      factionToastUntil = gameState.simTime + FACTION_TOAST_DURATION_S
    }
  }
  truceWasActive = truceNowActive

  // Busier (higher cap, shorter interval) near the galactic core, quieter
  // toward the rim — spawnEncounterNear separately biases alien vs.
  // pirate/trader odds by the same coreFraction, toward the rim.
  const spawnSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const core = coreFraction(spawnSystem)
  const ambientCap = Math.max(1, Math.round(AMBIENT_NPC_CAP + 1 - core * 3))
  // Neutral-only ambient traffic:
  //  - home system until the player breaks peace (see combat.js)
  //  - Whispers (outer rim landmark) permanently — mission NPCs still spawn
  const atPeacefulHome = gameState.player.currentSystemId === gameState.player.startingSystemId && !gameState.flags.startingSystemPeaceBroken
  const forceNeutralAmbient = atPeacefulHome || !!spawnSystem.noAmbientHostiles
  // Station police don't count toward ambient traffic cap (they're fixtures).
  const ambientCount = gameState.npcs.filter(
    (n) => !n.destroyed && n.faction !== 'police'
  ).length
  if (gameState.simTime > nextAmbientSpawnAt && ambientCount < ambientCap) {
    gameState.npcs.push(
      spawnEncounterNear(
        Math.random,
        gameState.player.ship.position,
        gameState.galaxy,
        core,
        forceNeutralAmbient,
        spawnSystem.bodies
      )
    )
    nextAmbientSpawnAt = gameState.simTime + AMBIENT_SPAWN_INTERVAL_S * (0.7 + core * 0.6)
    // Occasionally replace killed station / warp-gate patrols.
    refreshStationPolicePatrols()
  }

  for (const npc of gameState.npcs) {
    let mesh = npcMeshes.get(npc.id)
    if (!mesh && !npc.destroyed) {
      // lite hull + thrusters (EdgesGeometry skipped — hitch when meshing mid-fight)
      mesh = addNpcMesh(npc)
    }
    if (!mesh) continue
    if (npc.destroyed) {
      // First frame we see a dead NPC: ship fragment burst (covers projectile
      // kills already flagged in onProjectileHit via deathFxPlayed, and rams).
      if (!npc.deathFxPlayed) {
        npc.deathFxPlayed = true
        const r = getShipCollisionRadius(getShipClass(npc.shipClassId))
        playShipDeathFx(npc.position, r)
      }
      removeNpcMesh(npc.id)
      continue
    }
    syncMeshToEntity(mesh, npc)
    updateNpcThrusters(mesh, npc, dt)
    // Animate emergency lights on any mesh that has police livery (faction or flag).
    if (npc.faction === 'police' || mesh.userData?.policeLights) {
      updatePoliceLights(mesh, gameState.simTime)
    }
  }

  // Police response: when fighting pirates in a secured system, backup arrives
  // after a delay based on security rating (higher = faster).
  {
    const sys = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    if (sys) ensureSystemSecurity(sys)
    const sec = getSystemSecurity(sys)
    const livePolice = gameState.npcs.filter((n) => !n.destroyed && n.faction === 'police').length
    const fightingPirates = playerFightingPirates(gameState)
    if (sec <= 0 || !fightingPirates) {
      // Cancel pending response if fight ends or you're in lawless space.
      if (policeResponse && (!fightingPirates || sec <= 0 || policeResponse.systemId !== sys?.id)) {
        policeResponse = null
      }
    } else if (livePolice === 0) {
      if (!policeResponse || policeResponse.systemId !== sys.id) {
        const delay = policeResponseDelayS(sec)
        if (Number.isFinite(delay)) {
          policeResponse = { systemId: sys.id, fireAt: gameState.simTime + delay }
        }
      } else if (gameState.simTime >= policeResponse.fireAt) {
        const playerPos = gameState.player.ship.position
        const angle = Math.random() * Math.PI * 2
        const dist = 180 + Math.random() * 80
        const spawnPos = [
          playerPos[0] + Math.cos(angle) * dist,
          playerPos[1] + (Math.random() - 0.5) * 40,
          playerPos[2] + Math.sin(angle) * dist
        ]
        const count = sec >= 4 ? 2 : 1
        for (let i = 0; i < count; i++) {
          const offset = i === 0 ? [0, 0, 0] : [(Math.random() - 0.5) * 40, 10, (Math.random() - 0.5) * 40]
          const pos = [spawnPos[0] + offset[0], spawnPos[1] + offset[1], spawnPos[2] + offset[2]]
          gameState.npcs.push(spawnPoliceResponse(Math.random, { position: pos, bodies: sys.bodies }))
        }
        policeResponse = null
        flashToast(count > 1 ? 'System Patrol inbound (2)' : 'System Patrol inbound')
      }
    } else {
      policeResponse = null
    }
  }

  // Law penalties + standing toasts — deferred so the hit frame stays smooth.
  // (flushPendingLawPenalties queues toast strings; flushPendingToasts shows them.)
  if (
    (gameState._pendingLawPenalties | 0) > 0 ||
    gameState._pendingToasts?.length
  ) {
    if (!gameState._toastFlushScheduled) {
      gameState._toastFlushScheduled = true
      const gs = gameState
      requestAnimationFrame(() => {
        gs._toastFlushScheduled = false
        if (gs !== gameState) return
        flushPendingLawPenalties(gs)
        for (const msg of flushPendingToasts(gs)) {
          flashToast(msg, 3.2)
        }
      })
    }
  }

  const liveProjectileIds = new Set()
  const liveMissileIds = new Set()
  for (const proj of gameState.projectiles) {
    liveProjectileIds.add(proj.id)
    let mesh = projectileMeshes.get(proj.id)
    if (!mesh) {
      mesh = buildProjectileMesh(proj.weaponId, proj.weaponType)
      projectileMeshes.set(proj.id, mesh)
      scene.add(mesh)
    }
    syncMeshToEntity(mesh, proj)
    if (proj.weaponType === 'missile' && missileTrail) {
      liveMissileIds.add(proj.id)
      let scale = 1
      try {
        const dmg = getWeapon(proj.weaponId).damage
        scale = 0.85 + Math.min(0.55, dmg / 100)
      } catch { /* */ }
      missileTrail.track(
        proj.id,
        proj.position,
        proj.quaternion,
        proj.velocity,
        dt,
        scale
      )
    }
  }
  for (const [id, mesh] of projectileMeshes) {
    if (!liveProjectileIds.has(id)) {
      scene.remove(mesh)
      projectileMeshes.delete(id)
      missileTrail?.release(id)
    }
  }
  missileTrail?.prune(liveMissileIds)
  missileTrail?.update(dt)

  pruneWrecks(gameState)
  const liveWreckIds = new Set()
  for (const wreck of gameState.wrecks) {
    liveWreckIds.add(wreck.id)
    let mesh = wreckMeshes.get(wreck.id)
    if (!mesh) {
      mesh = buildWreckMesh()
      mesh.position.fromArray(wreck.position)
      wreckMeshes.set(wreck.id, mesh)
      scene.add(mesh)
    }
    updateWreckMesh(mesh, gameState.simTime, dt)
  }
  for (const [id, mesh] of wreckMeshes) {
    if (!liveWreckIds.has(id)) {
      scene.remove(mesh)
      wreckMeshes.delete(id)
    }
  }

  for (let i = impactFlashes.length - 1; i >= 0; i--) {
    const flash = impactFlashes[i]
    flash.ttl -= dt
    const t = Math.max(0, flash.ttl / IMPACT_FLASH_TTL)
    flash.mesh.scale.setScalar(0.5 + (1 - t) * 2)
    flash.mesh.material.opacity = t
    if (flash.ttl <= 0) {
      scene.remove(flash.mesh)
      impactFlashes.splice(i, 1)
    }
  }
  for (let i = rockExplosions.length - 1; i >= 0; i--) {
    const fx = rockExplosions[i]
    if (!updateRockExplosion(fx, dt)) {
      scene.remove(fx.group)
      disposeRockExplosion(fx)
      rockExplosions.splice(i, 1)
    }
  }
  for (let i = hitImpacts.length - 1; i >= 0; i--) {
    const fx = hitImpacts[i]
    if (!updateHitImpact(fx, dt)) {
      scene.remove(fx.group)
      disposeHitImpact(fx)
      hitImpacts.splice(i, 1)
    }
  }

  if (starMesh) updateStarMesh(starMesh, gameState.simTime, dt, camera)
  // Axial spin for planets/moons (spinSpeed) + station beacons; warp-gate swirl;
  // gas-giant cloud shells.
  for (const mesh of bodyMeshes.values()) {
    if (mesh.userData?.kind === 'warpGate') {
      updateWarpGateMesh(mesh, dt, gameState.simTime)
    } else {
      updateStationMesh(mesh, gameState.simTime, dt)
      updatePlanetAtmosphere(mesh, gameState.simTime, dt)
    }
  }
  // Depleted rocks "explode" (see onProjectileHit) and stay hidden until
  // their own respawn delay passes — isRockAlive is the single source of
  // truth for that, shared with targeting (getTargetableEntities/resolveTarget).
  for (const body of getSystem(gameState.galaxy, gameState.player.currentSystemId).bodies) {
    if (body.kind !== 'asteroidField') continue
    const mesh = bodyMeshes.get(body.id)
    if (!mesh) continue
    mesh.children.forEach((child, i) => { child.visible = isRockAlive(gameState, body.id, i) })
  }
  const sysBodies = getSystem(gameState.galaxy, gameState.player.currentSystemId).bodies
  // Fixed layout: bodies keep generated positions. Settlements stay on host surface.
  for (const entry of surfaceSettlements.values()) {
    const parent = sysBodies.find((b) => b.id === entry.parentId)
    if (!parent) continue
    const o = entry.surfaceOffset
    entry.body.position[0] = parent.position[0] + o[0]
    entry.body.position[1] = parent.position[1] + o[1]
    entry.body.position[2] = parent.position[2] + o[2]
    const mesh = bodyMeshes.get(entry.body.id)
    if (mesh) {
      mesh.position.fromArray(entry.body.position)
      orientSettlementOnSurface(mesh, entry.surfaceOffset)
    }
  }

  syncMeshToEntity(playerMesh, gameState.player.ship)
  // 60s with no input: let the chase seat drift around the ship. Free-look
  // (isChaseFreeLook) always wins inside syncChaseCamera itself, so this only
  // needs to gate the idle SIDE — no need to check it's not already active.
  // Never during supercruise: the idle drift fighting the cruise FOV/streak
  // camera work would look broken, and cruise already has its own motion.
  setChaseIdleOrbit(!cruising && performance.now() - lastInputAtMs > 60_000)
  syncChaseCamera(camera, gameState.player.ship, { cruising, dt })

  // Fire after final pose + camera; mesh-sync again so new bolts draw this frame.
  // Independent: hold LMB + RMB to fire lasers and missiles at the same time.
  if (laserFireHeld) tryPlayerFire('laser')
  if (missileFireHeld) tryPlayerFire('missile')
  syncProjectileMeshesNow()

  // Tidally locked moons face their parent; others keep spinning via updateStationMesh.
  for (const [id, mesh] of bodyMeshes) {
    if (!mesh.userData.tidallyLocked || !mesh.userData.parentId) continue
    const parent = sysBodies.find((b) => b.id === mesh.userData.parentId)
    if (!parent) continue
    const body = sysBodies.find((b) => b.id === id)
    if (!body) continue
    const dx = parent.position[0] - body.position[0]
    const dz = parent.position[2] - body.position[2]
    mesh.rotation.y = Math.atan2(dx, dz)
  }

  // System overview: always visible while undocked (not a toggle with F1 / menus).
  // Clickable only when the mouse is free and no modal is eating input.
  if (!docked) {
    systemOverview?.show()
    const overviewClickable =
      !flightMode &&
      !paused &&
      !navMapOpen &&
      !inventoryOpen &&
      !missionsOpen &&
      !characterOpen &&
      !jumpEffect &&
      !dockEffect
    systemOverview?.setInteractive(overviewClickable)
    // Distances only — full rebuild would cancel pointer events mid-click.
    systemOverview?.update()
  } else {
    systemOverview?.hide()
  }
  const shipVelocity = new THREE.Vector3().fromArray(gameState.player.ship.velocity)
  const shipForward = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(gameState.player.ship.quaternion))
  const speed = shipVelocity.length()
  const forwardSpeed = shipVelocity.dot(shipForward)
  const hudSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (hudSystem) ensureSystemSecurity(hudSystem)
  const nearestHudBody = findNearestHudBody()
  {
    const ps = gameState.player.ship
    ps.maxShields = effectiveMaxShields(ps, playerShipClass)
    ps.maxArmor = effectiveMaxArmor(ps, playerShipClass)
  }
  hud.update(
    gameState.player.ship,
    playerShipClass,
    speed,
    forwardSpeed,
    hudSystem?.name ?? null,
    nearestHudBody?.name ?? null,
    getSystemSecurity(hudSystem)
  )
  // Plotted warp-gate route (far left) — remaining hops; clears at destination.
  {
    const rem = gameState.player.plottedRoute
    if (Array.isArray(rem) && rem.length > 0) {
      hud.updatePlottedRoute(
        rem.map((id) => {
          const sys = getSystem(gameState.galaxy, id)
          return { id, name: sys?.name ?? String(id) }
        })
      )
    } else {
      hud.updatePlottedRoute(null)
    }
  }
  // Tab-target detail panel (top right, left of system overview).
  {
    const t = resolveTarget()
    if (!t) {
      hud.updateTarget(null)
    } else {
      const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
      const dist = shipPos.distanceTo(new THREE.Vector3().fromArray(t.position))
      const metaParts = []
      if (t.pilotName) metaParts.push(t.pilotName)
      if (t.faction) metaParts.push(t.faction)
      if (t.kindLabel) metaParts.push(t.kindLabel)
      if (t.isAsteroid) metaParts.push('asteroid')
      metaParts.push(`${Math.round(dist)} m`)
      hud.updateTarget({
        name: t.name,
        hostile: !!t.hostile,
        meta: metaParts.join(' · '),
        shields: t.shields,
        maxShields: t.maxShields,
        armor: t.armor,
        maxArmor: t.maxArmor,
        hull: t.hull,
        maxHull: t.maxHull,
        oreLeft: t.oreLeft,
        oreMax: t.oreMax
      })
    }
  }
  hud.updateRadar(computeRadarContacts(), RADAR_RANGE, gameState.simTime)

  // Dock / probe / wreck / gate prompts are normal-space only — in supercruise
  // you skim past shells so constantly that those toasts just spam the HUD.
  // F priority: wreck → warp gate (2 km) → nodule → dock. Each also requires
  // the object to be Tab-locked — otherwise the prompt would promise an F
  // action that the keydown handler (gated the same way) won't perform.
  const isTargeted = (kind, id) => currentTarget?.kind === kind && currentTarget.id === id
  const nearbyWreckRaw = !cruising ? findNearbyWreck() : null
  const nearbyWreck = nearbyWreckRaw && isTargeted('wreck', nearbyWreckRaw.id) ? nearbyWreckRaw : null
  const currentSysForPrompt = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const nearbyGateRaw =
    !cruising && !nearbyWreck && !jumpEffect
      ? findNearbyWarpGate(currentSysForPrompt, gameState.player.ship.position)
      : null
  const nearbyGate = nearbyGateRaw && isTargeted('body', nearbyGateRaw.id) ? nearbyGateRaw : null
  const nearbyNoduleRaw =
    !cruising && !nearbyWreck && !nearbyGate && !probeEffect && !datacoreMinigame?.isOpen?.()
      ? findNearbyDatacoreNodule()
      : null
  const nearbyNodule =
    nearbyNoduleRaw && isTargeted('nodule', nearbyNoduleRaw.nodule.id) ? nearbyNoduleRaw : null
  const nearbyBodyRaw =
    !cruising && !nearbyWreck && !nearbyGate && !nearbyNodule ? findNearbyDockableBody() : null
  const nearbyBody = nearbyBodyRaw && isTargeted('body', nearbyBodyRaw.id) ? nearbyBodyRaw : null
  wreckPromptEl.style.display = nearbyWreck ? 'block' : 'none'
  if (nearbyWreck) {
    wreckPromptEl.textContent = 'Press F to salvage wreck (or destroy with weapons)'
  }

  dockPromptEl.style.display = nearbyGate || nearbyNodule || nearbyBody ? 'block' : 'none'
  if (nearbyGate) {
    const originName = currentSysForPrompt?.name ?? 'here'
    const dest = getSystem(gameState.galaxy, nearbyGate.destinationSystemId)
    const destName = dest?.name ?? 'unknown system'
    dockPromptEl.textContent = `Press F to activate Warp Gate: ${originName} → ${destName}`
  } else if (nearbyNodule) {
    dockPromptEl.textContent = `Press F to hack Datacore nodule (within ${NODULE_PROBE_RANGE}m)`
  } else if (nearbyBody) {
    const dockSys = currentSysForPrompt
    if (dockSys) ensureSystemSecurity(dockSys)
    if (!canDockWithLaw(gameState, nearbyBody, dockSys)) {
      dockPromptEl.textContent = `${nearbyBody.name} — docking refused (security standing)`
    } else {
      dockPromptEl.textContent = `Press F to dock with ${nearbyBody.name}`
    }
  }

  const probeLaunch = !cruising && !probeEffect ? getProbeLaunchTarget() : null
  probePromptEl.style.display = probeLaunch ? 'block' : 'none'
  if (probeLaunch) {
    const left = MAX_PROBE_ATTEMPTS - probeAttemptCount(gameState, probeLaunch.body.id)
    if (left <= 0) {
      // Fully scanned, but an open probe/investigation mission still needs one re-scan.
      if (canProbeBody(gameState, probeLaunch.body.id)) {
        probePromptEl.textContent = `Press P to re-scan ${probeLaunch.body.name} (mission) · no additional finds`
      } else {
        probePromptEl.textContent = probeExhaustedMessage(probeLaunch.body.name)
      }
    } else {
      const base = probeLaunch.viaOrbit
        ? `Press P to probe ${probeLaunch.body.name} (in orbit)`
        : `Press P to launch a probe at ${probeLaunch.body.name}`
      probePromptEl.textContent = `${base} · ${left} left`
    }
  }

  if (
    miningToastEl.style.display === 'block' &&
    gameState.simTime > miningToastUntil &&
    !miningToastEl.querySelector('.hud-glitch-exit')
  ) {
    hideHudGlitch(miningToastEl)
  }
  if (
    factionToastEl.style.display === 'block' &&
    gameState.simTime > factionToastUntil &&
    !factionToastEl.querySelector('.hud-glitch-exit')
  ) {
    hideHudGlitch(factionToastEl)
  }
  if (
    probeResultsEl &&
    probeResultsEl.style.display === 'block' &&
    gameState.simTime > probeResultsUntil &&
    !probeResultsEl.querySelector('.hud-glitch-exit')
  ) {
    hideHudGlitch(probeResultsEl)
  }
  if (
    hailResultsEl &&
    hailResultsEl.style.display === 'block' &&
    gameState.simTime > hailResultsUntil &&
    !hailResultsEl.querySelector('.hud-glitch-exit')
  ) {
    hideHudGlitch(hailResultsEl)
  }

  // Dock / probe / wreck / faction / cruise / craft lines sit under ship status.
  updateBelowRadarPrompts()

  updateWaypointIndicator()
  updateCrosshair()
  updateTargetIndicator()
  updateTargetDirectionIndicator()

  render()
  // HUD reticle on top in true framebuffer NDC (same space as camera.project).
  if (hudReticleRing.visible) {
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(hudScene, hudCamera)
    renderer.autoClear = prevAutoClear
  }

  if (gameState.player.ship.hull <= 0) handlePlayerDeath()
}
animate()

// Kick station + interior GLB preload early so New Game / Load hit ready models.
preloadStationModels().then(() => {
  // Title uses free-model stations too — rebuild once Kenney GLBs are ready.
  if (gameState || !menuActive || !menuWhispersSystem) return
  if (stationModelsReady()) buildMenuSystemVisuals(menuWhispersSystem)
})
preloadInteriorModels().then(() => {
  // If already docked on a procedural-only bay, rebuild with kit props.
  if (!gameState || !docked || !interiorMesh) return
  const bodyId = gameState.player.dockedBodyId
  const body = bodyId ? findBody(gameState.galaxy, bodyId) : null
  if (!body) return
  const theme = resolveInteriorTheme(body)
  if (interiorMesh.parent) scene.remove(interiorMesh)
  interiorMesh = null
  scene.add(ensureInteriorMesh(theme))
})

// Intro/menu — apply saved sound + UI colour defaults, then title screen.
// Display mode is already applied by the main process on window create.
void Promise.all([loadSoundPreference(), loadUiThemePreference()]).finally(() => {
  startMenuBackground()
  hasSave().then((exists) => menu.show(exists))
})
