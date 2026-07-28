import * as THREE from 'three'
import { createScene } from './render/scene.js'
import {
  buildShipMesh,
  updatePoliceLights,
  updateShipNightLights,
  nightLightFactorFromDay
} from './render/shipMesh.js'
import { buildHarbourMesh, updateHarbourMesh } from './render/harbourMesh.js'
import { buildIslandMesh, islandMaxShoreline } from './render/islandMesh.js'
import { buildAsteroidFieldMesh, getAsteroidRocks } from './render/asteroidFieldMesh.js'
import { buildProjectileMesh, buildImpactFlash, preloadProjectileMeshes } from './render/projectileMesh.js'
import { buildWreckMesh, updateWreckMesh } from './render/wreckMesh.js'
import { createSonarPulse } from './render/sonarPulse.js'
import { createSprayOverlay } from './render/spray.js'
import { createWeather } from './render/weather.js'
import { createLensFlare } from './render/lensFlare.js'
import {
  updateTurretAim,
  centreTurret,
  aimTurretAt,
  turretAimPoint,
  turretMuzzleWorld,
  turretDirection
} from './game/turret.js'
import {
  syncMeshToEntity,
  syncChaseCamera,
  snapChaseCamera,
  resetChaseCameraState,
  adjustChaseZoom,
  resetChaseZoom,
  setChaseIdleOrbit
} from './render/sceneSync.js'
import { createWake } from './render/wake.js'
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
import { CANONICAL_WORLD_SEED, generateWorld } from './procgen/world.js'
import { DEV_TEST_SETUP, createDevTestGameState } from './game/devTestSetup.js'

import { advanceGameClock, reanchorGameClock } from './game/gameClock.js'
import {
  createInputState,
  createMouseAimState,
  updateFlight,
  headingOf,
  applySeaAttitude
} from './game/flight.js'
import { waveHeight, snapToSea, SEA_MAX_AMPLITUDE } from './world/sea.js'
import { effectiveMaxSpeed, effectiveMaxArmor } from './data/accessories.js'
import { updateAutopilot, ignoreBodyAsCruiseObstacle } from './game/autopilot.js'
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
  updateNpcAI,
  updateCombatFlag,
  prepareCombatFrame,
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
  applyLocalSecurity,
  policeResponseDelayS,
  flushPendingToasts
} from './game/security.js'
import {
  resolveBodyCollisions,
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
import { pruneWrecks, lootWreck, spawnWreck, spawnWreckWithSkills } from './game/wrecks.js'
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
  getSystem,
  getWorld,
  findBody,
  findSystemOfBody,
  remoteness,
  inHomeWaters,
  isDockable,
  WORLD_RADIUS
} from './procgen/world.js'
import { createHud } from './ui/hud.js'
import { createDockingUI } from './ui/dockingUI.js'
import { createMenu } from './ui/menu.js'
import { createPauseMenu } from './ui/pauseMenu.js'
import { createSystemOverview } from './ui/systemOverview.js'
import { createSystemScanMap } from './ui/systemScanMap.js'
import { createSeaChart } from './ui/seaChart.js'
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

// How close you must come alongside before a harbour will take a line (metres).
const DOCK_RANGE = 900
const DOCK_RANGE_COLLISION_MARGIN = 12
// How far offshore a sonar drone can still work an island from.
const PROBE_ORBIT_MARGIN = 1200
// Harbour meshes are built at roughly 34–52 local units across (see
// render/harbourMesh.js); this brings them into world scale beside a ~20-unit
// boat, so a quay is something you come alongside rather than a landmass.
const STATION_SCALE = 1.7
// Outposts are a jetty and a shed — far smaller than a working harbour.
const SETTLEMENT_SCALE = 1.5
// Standoff for sounding a wreck field or running past a coast.
const PROBE_RANGE = 900
const MINING_TOAST_DURATION_S = 1.6
const FACTION_TOAST_DURATION_S = 4
// Floating HUD text: a clean fade in and out.
//
// This used to be a chromatic-aberration glitch — split colour layers jittering
// on a timer. It read as a broken display rather than a piece of information,
// and on a boat there is no screen between you and the sea for it to be
// breaking. The API is unchanged so every call site still works; only the
// presentation is different.
const HUD_TOAST_EXIT_MS = 300
const HUD_TOAST_STYLE = `
.hud-toast-text {
  position: relative; display: inline-block; max-width: 100%;
}
.hud-toast-enter {
  animation: hudToastEnter 0.24s ease-out both;
}
@keyframes hudToastEnter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
.hud-toast-exit {
  animation: hudToastExit 0.28s ease-in both;
}
@keyframes hudToastExit {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(-3px); }
}
@media (prefers-reduced-motion: reduce) {
  .hud-toast-enter, .hud-toast-exit { animation-duration: 0.01s; }
}
`
let hudToastStyleInjected = false
function ensureHudToastStyle() {
  if (hudToastStyleInjected) return
  const style = document.createElement('style')
  style.textContent = HUD_TOAST_STYLE
  document.head.appendChild(style)
  hudToastStyleInjected = true
}

const hudToastHideTimers = new WeakMap()

function ensureHudToastSpan(el) {
  if (!el) return null
  ensureHudToastStyle()
  let span = el.querySelector(':scope > .hud-toast-text')
  if (!span) {
    span = document.createElement('span')
    span.className = 'hud-toast-text'
    while (el.firstChild) span.appendChild(el.firstChild)
    el.appendChild(span)
  }
  return span
}

function setHudToastText(el, text) {
  const span = ensureHudToastSpan(el)
  if (!span) return
  span.textContent = text
  span.dataset.text = text
}

function showHudToast(el) {
  if (!el) return
  ensureHudToastStyle()
  clearTimeout(hudToastHideTimers.get(el))
  el.style.display = 'block'
  // Keep probe-info opacity from .float-info-text (don't force full opacity).
  el.style.removeProperty('opacity')
  const span = ensureHudToastSpan(el)
  if (!span) return
  span.classList.remove('hud-toast-exit', 'hud-toast-enter')
  // Restart enter animation next frame — never force layout (offsetWidth) mid-combat.
  requestAnimationFrame(() => {
    if (!span.isConnected || el.style.display === 'none') return
    span.classList.add('hud-toast-enter')
  })
}

function hideHudToast(el) {
  if (!el || el.style.display === 'none') return
  const span = ensureHudToastSpan(el)
  if (!span) {
    el.style.display = 'none'
    return
  }
  span.classList.remove('hud-toast-enter', 'hud-toast-exit')
  requestAnimationFrame(() => {
    if (!span.isConnected) return
    span.classList.add('hud-toast-exit')
  })
  clearTimeout(hudToastHideTimers.get(el))
  const t = setTimeout(() => {
    el.style.display = 'none'
    span.classList.remove('hud-toast-exit')
  }, HUD_TOAST_EXIT_MS)
  hudToastHideTimers.set(el, t)
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
const BASE_FOV = 60
/** Extra FOV at full speed — enough to feel the boat come up on the plane. */
const SPEED_FOV_MAX = 5

const CROSSHAIR_DISTANCE = 80

// Approach + bay glide; three-phase so approach / hang-align / park all read.
const DOCK_ANIM_DURATION_S = 4.4
// Extra clearance beyond the body's collision shell for the exterior hang
// point — the old flat 18 was deep *inside* station/planet radii (~100–200+).
const DOCK_EXTERIOR_MARGIN = 28
const UNDOCK_BACKOFF_MARGIN = 70
const HYPERSPACE_FLASH_COLOR = '#c8f0ff'
const DOCK_FLASH_COLOR = 'var(--ui-glow)'
// Min standoff past the collision shell when the dock bubble is large enough
// (stations/settlements have +2000m). Avoids bouncing off the body on drop-out.
const AUTOPILOT_ARRIVAL_MIN_CLEAR = 220
// How far inside the dock shell to still count as "in range" after SC drop.
const AUTOPILOT_DOCK_INNER_SLACK = 120
// A dedicated coordinate region for the docking-bay interior, far enough
// from any system-local coordinates (which top out around 2200) that it can
// never overlap real flight space.
/** How far off the harbour's shell a moored boat lies. */
const MOORING_STANDOFF = 14
// Probe flight: fly out → scan 10s → return → yield results.
/** How long a sounding takes from first ping to reading the return. */
const PROBE_SCAN_S = 6.5
/** Pings per sounding, and the gap between them. Matches render/sonarPulse.js. */
// Spaced for a long movie-style ping tail (see audio.playSonarPing).
const SONAR_PING_COUNT = 4
const SONAR_PING_INTERVAL_S = 1.55

const appEl = document.getElementById('app')
const { scene, camera, renderer, render, updateEnvironment, setPostOverlay, ocean } = createScene(appEl)
// Sonar rings — the boat sounds from where it is; there is nothing to launch.
const sonarPulse = createSonarPulse()
scene.add(sonarPulse.group)

// Water on the lens. An artifact of the camera, so it is drawn over the formed
// image rather than into the world (see render/scene.js setPostOverlay).
const spray = createSprayOverlay()
const weatherFx = createWeather()
// Scratch for projecting the stem to screen each frame (see the frame loop).
const _sprayOrigin = new THREE.Vector3()
const _sprayShipPos = new THREE.Vector3()
const _sprayQuat = new THREE.Quaternion()
// Lens flare. Drawn before the droplets: the water is on the front element,
// so it sits over the flare, not under it.
const lensFlare = createLensFlare()

/** Latest weather sample — lighting + audio. */
let weatherFrame = {
  mode: 'clear',
  rain: 0,
  storm: 0,
  cloudCover: 0.52,
  sunMul: 1,
  fogMul: 1,
  hemiMul: 1,
  flash: 0,
  thunder: null
}
/** 0 day … 1 night — drives running lights + player searchlight. */
let _nightLightFactor = 0

/** Fair-weather frame — title screen never rolls rain/storm. */
const CLEAR_WEATHER_FRAME = Object.freeze({
  mode: 'clear',
  rain: 0,
  storm: 0,
  rainGloom: 0,
  stormGloom: 0,
  cloudCover: 0.52,
  sunMul: 1,
  fogMul: 1,
  hemiMul: 1,
  flash: 0,
  thunder: null
})

/**
 * Step rain/storm FX + audio for this frame, then drive the sky from the result.
 * Title / menu always stays clear — weather only runs in an active session.
 * @param {number} dt
 * @param {number} t campaign or menu time
 */
function tickWeather(dt, t) {
  // No rain or thunderstorms on the title screen.
  if (!gameState) {
    weatherFx.clear()
    weatherFrame = CLEAR_WEATHER_FRAME
    audio.setRainLevel(0)
    return
  }
  const aspect =
    renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight)
  weatherFrame = weatherFx.update(dt, t, aspect)
  audio.setRainLevel(weatherFrame.rain)
  if (weatherFrame.thunder) audio.playThunder(weatherFrame.thunder)
}

/**
 * Advance the sky and the camera-space effects that hang off it.
 *
 * The flare has to be fed the same instant the sky was built from, so this
 * pairs them rather than letting call sites drift apart.
 * Call `tickWeather` earlier in the frame when `dt` is available.
 */
function refreshEnvironment(t) {
  const day = updateEnvironment(t, weatherFrame)
  const sunStrength = Math.min(1, (day.sunIntensity * (weatherFrame.sunMul ?? 1)) / 2.0) * 0.85
  // Storm cover kills the flare; a lightning flash briefly restores a white glint.
  const flareMul =
    (1 - Math.min(0.95, (weatherFrame.storm ?? 0) * 0.9 + (weatherFrame.rain ?? 0) * 0.35)) +
    (weatherFrame.flash ?? 0) * 0.8
  lensFlare.update(camera, day.sunDirection, {
    aspect: renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight),
    color: day.sunColor,
    strength: sunStrength * Math.max(0, flareMul)
  })
  return day
}
setPostOverlay((r) => {
  if (lensFlare.visible) r.render(lensFlare.scene, lensFlare.camera)
  if (spray.visible) r.render(spray.scene, spray.camera)
  if (weatherFx.visible) r.render(weatherFx.scene, weatherFx.camera)
})

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

// Escape while pointer-locked often only unlocks the cursor (keydown may not
// fire). Suppress auto-pause when we exit lock ourselves (menus / Space).
let suppressPointerUnlockPause = false
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
// Slow camera orbit after death — must be set BEFORE unlock so pointerlockchange
// / stale lock promises cannot re-arm flight or the full-screen bridge.
let deathOrbit = null

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
    !chartOpen &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen 
  )
}

const _playerAimPoint = new THREE.Vector3()
const _playerMuzzle = new THREE.Vector3()

/** Fire once if allowed. Cooldowns live on the ship; safe to call every frame while held. */
function tryPlayerFire(weaponTypeFilter) {
  if (!canPlayerFire()) return
  try {
    // Seat first so click-to-fire between frames matches the reticle this frame.
    syncChaseCamera(camera, gameState.player.ship, { cruising })
    // Guns go where the turret is laid, not where the bow is pointing — the
    // crosshair is the projection of this same point, so what you see is what
    // you hit. Never homes on a Tab-lock.
    turretAimPoint(gameState.player.ship, playerShipClass, _playerAimPoint)
    turretMuzzleWorld(gameState.player.ship, playerShipClass, _playerMuzzle)
    fireProjectile(
      gameState,
      gameState.player.ship,
      playerShipClass,
      'player',
      onWeaponFired,
      weaponTypeFilter,
      null,
      _playerAimPoint.toArray(),
      _playerMuzzle.toArray()
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

/**
 * MMB hands the mouse back to the UI without leaving the helm.
 *
 * With the guns on the mouse there is no spare cursor for the contacts list,
 * the chart or a menu, and leaving flight entirely just to click something is
 * heavy-handed. Middle-click releases pointer lock but keeps W/A/S/D driving
 * the boat; the turret simply stops tracking, because mouseAim only
 * accumulates while locked. Middle-click again takes the guns back.
 */
let mouseFreedForUI = false

function toggleTurretMouseLock() {
  if (isFlightPointerLocked()) {
    mouseFreedForUI = true
    // Without this the unlock is read as an Esc and opens the pause menu.
    suppressPointerUnlockPause = true
    document.exitPointerLock()
    setTimeout(() => {
      suppressPointerUnlockPause = false
    }, 400)
    return
  }
  mouseFreedForUI = false
  systemOverview?.setInteractive(false)
  requestFlightPointerLock()
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
  if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
  // Ignore UI targets (menus, overview) so we don't steal clicks.
  const t = e.target
  if (t && t !== document && t !== document.body && t !== renderer?.domElement) {
    if (typeof t.closest === 'function' && t.closest('button, input, select, textarea, a, #nav-map, #inventory-ui, #missions-ui, #character-ui, #system-overview.interactive, #docking-ui, #pause-menu, #menu')) {
      return
    }
  }
  if (e.button === 1) {
    // Middle-click is never a fire button — and the default is autoscroll.
    e.preventDefault()
    if (gameState && !paused && !docked) toggleTurretMouseLock()
    return
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
  if (!gameState || deathOrbit || paused || chartOpen || inventoryOpen || missionsOpen || characterOpen) {
    return false
  }
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
  hidePointerLockBridge()
  stopPointerLockRetries()
  if (crosshairEl) crosshairEl.style.display = 'none'
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'
  // Free mouse → overview HUD accepts waypoint clicks.
  if (!docked && !chartOpen && !inventoryOpen && !missionsOpen && !characterOpen && !paused) {
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
  if (isFlightPointerLocked() || paused || docked || deathOrbit || !flightModeWanted) {
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

/** Death owns the cursor — never re-arm helm or the lock bridge over the Return button. */
function deathBlocksPointerLock() {
  return !!deathOrbit
}

/** Force flight flags on (keyboard). Pointer lock is required for confined mouse. */
function forceFlightControlsOn() {
  // Never re-arm helm after death — stale lock promises used to do this.
  if (deathBlocksPointerLock()) {
    flightModeWanted = false
    flightMode = false
    hidePointerLockBridge()
    stopPointerLockRetries()
    return
  }
  flightModeWanted = true
  flightMode = true
  mouseFreedForUI = false
  laserFireHeld = false
  missileFireHeld = false
  systemOverview?.setInteractive(false)
  if (!isFlightPointerLocked()) showPointerLockBridge()
  else hidePointerLockBridge()
}

/** @returns {Promise<boolean>} whether lock is held after the attempt */
function requestFlightPointerLock() {
  if (deathBlocksPointerLock() || !flightModeWanted || paused) {
    hidePointerLockBridge()
    stopPointerLockRetries()
    return Promise.resolve(false)
  }
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
      if (flightModeWanted && !deathBlocksPointerLock() && !paused && !docked) {
        forceFlightControlsOn()
        showPointerLockBridge()
      }
      return Promise.resolve(false)
    }
  }
  if (req && typeof req.then === 'function') {
    return req
      .then(() => {
        // Grant can arrive after death — drop it immediately.
        if (deathBlocksPointerLock() || !flightModeWanted || paused) {
          try {
            if (document.pointerLockElement) document.exitPointerLock()
          } catch {
            /* */
          }
          hidePointerLockBridge()
          stopPointerLockRetries()
          return false
        }
        forceFlightControlsOn()
        hidePointerLockBridge()
        stopPointerLockRetries()
        return true
      })
      .catch(() => {
        if (flightModeWanted && !deathBlocksPointerLock() && !paused && !docked) {
          forceFlightControlsOn()
          showPointerLockBridge()
        }
        return false
      })
  }
  requestAnimationFrame(() => {
    if (deathBlocksPointerLock() || !flightModeWanted || paused) {
      hidePointerLockBridge()
      stopPointerLockRetries()
      return
    }
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
  if (deathOrbit) return
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
    if (!flightModeWanted || deathBlocksPointerLock() || paused || docked || ticks > 40) {
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
  if (chartOpen) {
    chartOpen = false
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
  // Services (docked) — keep docked chrome, just close the services panel
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
  if (deathOrbit) {
    flightModeWanted = false
    flightMode = false
    hidePointerLockBridge()
    stopPointerLockRetries()
    return
  }
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
  if (!flightModeWanted || paused || docked || deathOrbit) return
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
    // Stale grant after death: drop immediately so the Return button stays usable.
    if (deathOrbit || !flightModeWanted) {
      try {
        document.exitPointerLock()
      } catch {
        /* */
      }
      hidePointerLockBridge()
      stopPointerLockRetries()
      return
    }
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

  // Death: free cursor, never re-arm bridge or pause.
  if (deathOrbit) {
    flightMode = false
    flightModeWanted = false
    hidePointerLockBridge()
    stopPointerLockRetries()
    document.body.style.cursor = ''
    return
  }

  // During post-unpause grace: never clear flightMode and never auto-pause.
  if (inResumeFlightGrace() && flightModeWanted && !paused && !docked) {
    forceFlightControlsOn()
    showPointerLockBridge()
    return
  }

  // Lost lock while still wanting flight.
  if (paused || characterOpen || chartOpen || inventoryOpen || missionsOpen || docked) {
    flightMode = false
    hidePointerLockBridge()
    return
  }

  // Deliberate MMB release: stay at the helm, hand the cursor to the UI. No
  // bridge overlay — the whole point is that things underneath are clickable.
  if (mouseFreedForUI && flightModeWanted && !paused && !docked && !dockEffect) {
    flightMode = true
    laserFireHeld = false
    missileFireHeld = false
    hidePointerLockBridge()
    document.body.style.cursor = ''
    systemOverview?.setInteractive(true)
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
    !deathOrbit &&
    !paused &&
    flightModeWanted &&
    !docked &&
    !dockEffect &&
    !chartOpen &&
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
    !chartOpen &&
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
})

window.addEventListener('focus', () => {
  tryRestoreFlightMode()
})

// Alt+Enter → fullscreen (dual-path: main before-input + IPC backup).
window.addEventListener('keydown', (e) => {
  if (!isAltEnterChord(e)) return
  e.preventDefault()
  e.stopPropagation()
  window.electronAPI?.toggleFullscreen?.()
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tryRestoreFlightMode()
})

// Click the game view (canvas): docked → orbit hangar cam; free-mouse flight → re-lock.
// HUD chrome uses pointer-events:none so those clicks land here; interactive
// overlays (system overview, menus) sit above the canvas and keep the mouse free.
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  if (!gameState || deathOrbit) return
  // Docked hangar: drag to orbit the parked ship.
  if (docked && !dockEffect && !paused && !chartOpen && !inventoryOpen && !missionsOpen && !characterOpen) {
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
  if (!gameState || dockEffect || paused || chartOpen || inventoryOpen || missionsOpen || characterOpen) return
  if (docked) return
  e.preventDefault()
  adjustChaseZoom(e.deltaY)
}, { passive: false })

let gameState = null
let playerShipClass = null
let playerMesh = null
let playerWake = null
/** Ship-local engine nozzle points for multi-thruster exhaust (from hull layout). */
let damageEffects = null
let oreScoopEffects = null
let missileTrail = null
let hud = null
let dockingUI = null
let pauseMenu = null
let systemOverview = null
let systemScanMap = null
let seaChart = null
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
/** Full-screen black overlay for hyperspace system-change fade. */
let dockEffect = null
let dockedApproach = null
const npcMeshes = new Map()
const bodyMeshes = new Map()
const wreckMeshes = new Map()
// Scratch for NPC thruster world pose (reused each frame).

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
    const wake = createWake()
    mesh.userData.wake = wake
    mesh.userData.hullLength = shipClass.hull?.length ?? 20
    mesh.userData.topSpeed = shipClass.stats?.speed ?? 40
    scene.add(wake.group)
  } catch {
    /* a wake is decoration — never block a spawn on it */
  }
  npcMeshes.set(npc.id, mesh)
  scene.add(mesh)
  return mesh
}

function removeNpcMesh(npcId) {
  const mesh = npcMeshes.get(npcId)
  if (!mesh) return
  scene.remove(mesh)
  const wake = mesh.userData?.wake
  if (wake) {
    scene.remove(wake.group)
    try {
      wake.dispose?.()
    } catch {
      /* */
    }
    mesh.userData.wake = null
  }
  npcMeshes.delete(npcId)
}

function clearNpcMeshes() {
  for (const id of [...npcMeshes.keys()]) removeNpcMesh(id)
}

/** Water displaced by an on-screen NPC. Same wake the player leaves. */
function updateNpcThrusters(mesh, npc, dt) {
  const wake = mesh?.userData?.wake
  if (!wake) return
  const speed = Math.hypot(npc.velocity?.[0] ?? 0, npc.velocity?.[2] ?? 0)
  wake.update(
    npc.position,
    headingOf(npc),
    speed / Math.max(1e-3, mesh.userData.topSpeed ?? 40),
    mesh.userData.hullLength ?? 20,
    gameState.simTime,
    dt
  )
}
// Coastal harbours ride a fixed offset from their island.
const surfaceSettlements = new Map()
const projectileMeshes = new Map()
const impactFlashes = []
const rockExplosions = []
const hitImpacts = []

function buildBodyMesh(body) {
  if (body.kind === 'island') return buildIslandMesh(body)
  // Hulk grade (and so its tint) comes from where the field lies — see
  // game/mining.js oreTierForField.
  if (body.kind === 'wreckField') return buildAsteroidFieldMesh(body)
  // Harbours are authored with the waterline at y = 0 already, so they need no
  // lifting — see render/harbourMesh.js.
  const mesh = buildHarbourMesh(body)
  const baseScale = body.kind === 'outpost' ? SETTLEMENT_SCALE : STATION_SCALE
  // Per-body hash for +/-15% size variety, so harbours aren't all one plan.
  const variance = 0.85 + (hashStringForOrbit(body.id) % 1000) / 1000 * 0.3
  mesh.scale.setScalar(baseScale * variance)
  return mesh
}

/**
 * Sit a structure on the water rather than through it. Harbour modules were
 * authored centred on the origin for a station hanging in space; dropped at sea
 * level as-is, half of every jetty is underwater. Lift so the base rides just
 * below the surface, with enough draught that the swell never exposes a gap.
 */
const _floatBounds = new THREE.Box3()
const _floatSize = new THREE.Vector3()
function floatOnWaterline(mesh) {
  _floatBounds.setFromObject(mesh)
  if (!Number.isFinite(_floatBounds.min.y)) return
  _floatBounds.getSize(_floatSize)
  // Draught scales with the structure, floored at the wave amplitude so a small
  // jetty still never lifts clear of a trough.
  const draught = Math.max(SEA_MAX_AMPLITUDE * 1.5, _floatSize.y * 0.18)
  mesh.position.y = -_floatBounds.min.y - draught
}

/**
 * Build the whole world's meshes once. One sea, so this runs on New Game and on
 * load and never again — there is no region to swap. Everything past the fog
 * wall is hidden per-frame by updateBodyVisibility rather than unloaded.
 */
function loadBodiesForCurrentSystem() {
  for (const mesh of bodyMeshes.values()) scene.remove(mesh)
  bodyMeshes.clear()
  surfaceSettlements.clear()
  currentTarget = null

  const currentSystem = getWorld(gameState.galaxy)
  for (const body of currentSystem.bodies) {
    const mesh = buildBodyMesh(body)
    // buildBodyMesh already set Y for structures that float; only place in XZ.
    mesh.position.set(body.position[0], mesh.position.y, body.position[2])
    bodyMeshes.set(body.id, mesh)
    scene.add(mesh)

    // A coastal harbour keeps a fixed offset from its island and faces seaward.
    // Nothing in the world moves, so this is set once here rather than
    // re-derived every frame.
    if (body.parentId && body.surfaceOffset) {
      surfaceSettlements.set(body.id, {
        body,
        parentId: body.parentId,
        surfaceOffset: body.surfaceOffset
      })
      orientSettlementOnSurface(mesh, body.surfaceOffset)
    }
  }
  refreshStationPolicePatrols()
}

/**
 * Everything is in one coordinate space, so the whole world is in the scene at
 * once. Hiding what the fog has already swallowed keeps the draw-call count to
 * the handful of places actually in sight.
 */
const BODY_CULL_DISTANCE = 16000
const _cullPos = new THREE.Vector3()
function updateBodyVisibility() {
  for (const [id, mesh] of bodyMeshes) {
    const body = findBody(gameState.galaxy, id)
    if (!body) continue
    _cullPos.fromArray(body.position)
    const d = Math.hypot(_cullPos.x - camera.position.x, _cullPos.z - camera.position.z)
    // Big islands are visible from further off than a buoy is.
    mesh.visible = d < BODY_CULL_DISTANCE + (body.radius ?? 0) * 1.5
  }
}

/** Spawn / top-up police patrols (stations Sec 3–6, warp gates Sec 4–6). */
function refreshStationPolicePatrols() {
  if (!gameState) return
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return
  ensureStationPolicePatrols(Math.random, gameState, system, getSystemSecurity(system))
}

// Harbours are built upright and stay upright — the sea is flat, so the only
// thing worth orienting is which way the jetties face, which is out to sea.
function orientSettlementOnSurface(mesh, surfaceOffset) {
  const x = surfaceOffset[0]
  const z = surfaceOffset[2]
  if (x * x + z * z < 1e-8) return
  mesh.rotation.set(0, Math.atan2(x, z), 0)
}

function hashStringForOrbit(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

const _dockPos = new THREE.Vector3()
const _dockCamFrom = new THREE.Vector3()

function quatFacing(fromPos, towardPos) {
  // Matrix4.lookAt follows the camera convention (local +Z points away from
  // the target), but ship forward is +Z, so eye/target are swapped here —
  // same convention used in combat.js and autopilot.js.
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(towardPos, fromPos, new THREE.Vector3(0, 1, 0)))
}

let docked = false
/** Camera orbit around the moored boat (click-drag on the view). */
const dockOrbit = {
  yaw: 0.55,
  pitch: 0.28,
  dist: 46,
  dragging: false,
  lastX: 0,
  lastY: 0,
  pointerId: null
}
const DOCK_ORBIT_PITCH_MIN = 0.08
const DOCK_ORBIT_PITCH_MAX = 1.25
const DOCK_ORBIT_DIST_MIN = 18
const DOCK_ORBIT_DIST_MAX = 140
const DOCK_ORBIT_SENS = 0.005

/**
 * Reset the berth camera. `facing` is the bearing from the boat toward the
 * harbour — the seat swings round to put the quay behind the boat, because a
 * berth view that does not show what you are tied up to is just a boat.
 */
function resetDockOrbit(facing = null) {
  dockOrbit.yaw = facing != null ? Math.atan2(-facing.x, -facing.z) : 0.55
  dockOrbit.pitch = 0.34
  dockOrbit.dist = 52
  dockOrbit.dragging = false
  dockOrbit.pointerId = null
}

/**
 * While moored, the camera orbits the boat where it actually lies — alongside
 * the harbour, on the water. Drag to swing round it; the harbour, the swell and
 * whatever else is in the anchorage all stay in shot, which is the whole point
 * of berthing outside instead of cutting to an interior.
 */
const _dockLook = new THREE.Vector3()
function applyDockOrbitCamera() {
  if (!gameState) return
  _dockLook.fromArray(gameState.player.ship.position)
  const dist = dockOrbit.dist
  const cp = Math.cos(dockOrbit.pitch)
  const sp = Math.sin(dockOrbit.pitch)
  const sy = Math.sin(dockOrbit.yaw)
  const cy = Math.cos(dockOrbit.yaw)
  camera.position.set(
    _dockLook.x + dist * cp * sy,
    // Never drop the eye below the waterline — you would be looking up through
    // the sea, which renders as a solid wall of water.
    Math.max(SEA_MAX_AMPLITUDE + 2, _dockLook.y + dist * sp + 3),
    _dockLook.z + dist * cp * cy
  )
  camera.lookAt(_dockLook.x, _dockLook.y + 2.5, _dockLook.z)
  camera.updateMatrixWorld(true)
}

let paused = false
let chartOpen = false
let inventoryOpen = false
let missionsOpen = false
let characterOpen = false
let cruising = false
// Edge-detected in animate() to fire the autopilot engage/disengage voice
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

/** @type {THREE.Object3D[]} */
let menuBodyMeshes = []
let menuAnimT = 0
let menuActive = false
/** Cached world from CANONICAL_WORLD_SEED (same layout as New Game). */
let menuWorld = null

// The title view drifts over the water off Haven Reach — the same sea the
// player is about to sail, at the same scale, rather than a separate showpiece.
const MENU_ORBIT_RADIUS = 2600
const MENU_ORBIT_HEIGHT = 190
const MENU_ORBIT_PERIOD_S = 96
const MENU_LOOK_AT = new THREE.Vector3(0, 0, 0)
/** How far from the title camera a body is worth building at all. */
const MENU_BODY_RANGE = 9000

function getMenuWorld() {
  if (menuWorld) return menuWorld
  // Same seed / layout as createGameState — the islands on the title screen are
  // the islands you sail past in the first ten minutes.
  menuWorld = getWorld(generateWorld(CANONICAL_WORLD_SEED))
  return menuWorld
}

function clearMenuBodies() {
  for (const mesh of menuBodyMeshes) scene.remove(mesh)
  menuBodyMeshes = []
}

/** Haven Reach and its neighbours, for the title. */
function buildMenuSystemVisuals(world) {
  if (!world || !menuActive || gameState) return
  clearMenuBodies()

  for (const body of world.bodies) {
    if (Math.hypot(body.position[0], body.position[2]) > MENU_BODY_RANGE) continue
    const mesh = buildBodyMesh(body)
    const floatY = mesh.position.y
    mesh.position.set(body.position[0], floatY, body.position[2])
    if (body.surfaceOffset) orientSettlementOnSurface(mesh, body.surfaceOffset)
    menuBodyMeshes.push(mesh)
    scene.add(mesh)
  }
}

function startMenuBackground() {
  if (menuActive) return
  menuActive = true
  menuAnimT = 0
  weatherFx.clear()
  weatherFrame = CLEAR_WEATHER_FRAME
  audio.setRainLevel(0)
  audio.playTitleMusic()

  const mount = () => {
    if (!menuActive || gameState) return
    buildMenuSystemVisuals(getMenuWorld())
  }
  // Yield so the menu chrome can paint before world gen on a cold start.
  if (menuWorld) mount()
  else setTimeout(mount, 0)
}

function stopMenuBackground() {
  menuActive = false
  clearMenuBodies()
  audio.stopTitleMusic()
}

function updateMenuBackground(dt) {
  if (!menuActive) return
  menuAnimT += dt
  for (const mesh of menuBodyMeshes) updateHarbourMesh(mesh, menuAnimT)
  // Slow circuit of the home archipelago, low over the water.
  const angle = (menuAnimT / MENU_ORBIT_PERIOD_S) * Math.PI * 2
  camera.position.set(
    Math.cos(angle) * MENU_ORBIT_RADIUS,
    MENU_ORBIT_HEIGHT,
    Math.sin(angle) * MENU_ORBIT_RADIUS
  )
  camera.lookAt(MENU_LOOK_AT)
  refreshEnvironment(menuAnimT)
}


function showGameSavedToast(durationMs = 2200) {
  if (!saveToastEl) return
  setHudToastText(saveToastEl, 'GAME SAVED')
  showHudToast(saveToastEl)
  clearTimeout(saveToastHideTimer)
  saveToastHideTimer = setTimeout(() => {
    hideHudToast(saveToastEl)
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
      pilotName: 'Unknown captain',
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
    pilotName: npc.pilotName || 'Unknown captain',
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
    if (hitPlayer) {
      pulseDamageVignette(position, inboundDir)
      // Water thrown up the lens by a near hit.
      spray.splash(0.9)
    }
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
      setHudToastText(miningToastEl, `${getGood(mined.goodId).name} wreck cleared!`)
      showHudToast(miningToastEl)
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
        setHudToastText(miningToastEl, `Salvaged ${n} ${getGood(mined.goodId).name}`)
        showHudToast(miningToastEl)
        miningToastUntil = gameState.simTime + MINING_TOAST_DURATION_S
      }
    } else if (!mined.destroyed) {
      // Stripped ore but hold is full — warn the pilot (throttled).
      if (gameState.simTime - lastOreFullToastAt > 1.25) {
        flashToast('Salvage Hold Full')
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
  if (hitPlayer) {
    pulseDamageVignette(position, inboundDir)
    spray.splash(0.9)
  }
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
  if (!gameState || docked) {
    if (docked) clearAnomalySiteMeshes()
    return
  }
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return
  ensureSystemAnomalies(system, gameState.galaxy)
  pruneAnomalies(system, gameState.simTime)
  const ship = gameState.player.ship.position
  const core = remoteness(gameState.player.ship.position)

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
          flashToast(`Drowned Incursion — wave 1/${a.wavesTotal}`, 3.2)
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
          flashToast(`Drowned Incursion — wave ${next + 1}/${a.wavesTotal}`, 3.2)
        } else if (!a.baseDestroyed && !alienSiteRuntime) {
          // Base becomes targetable (virtual HP entity tracked as runtime)
          alienSiteRuntime = {
            anomalyId: a.id,
            position: [...a.position],
            hull: 420,
            maxHull: 420
          }
          flashToast('Drowned base exposed — destroy it!', 3.5)
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
      let baseMsg = `Drowned base destroyed — +${credits} cr (site despawns in 5 min)`
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
    ?.find((b) => b.id === fieldId && b.kind === 'wreckField')
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
    ?.find((b) => b.id === bodyId && b.kind === 'wreckField')
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
  if (!gameState || docked) return
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!system) return
  if (!rollMiningPirateAmbush(Math.random, gameState, system)) return
  const npc = spawnMiningPirateAmbush(
    Math.random,
    gameState.player.ship.position,
    remoteness(gameState.player.ship.position),
    system.bodies
  )
  gameState.npcs.push(npc)
  if (factionToastEl) {
    setHudToastText(factionToastEl, 'Pirates attracted by your salvaging!')
    showHudToast(factionToastEl)
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
          galaxySeed: CANONICAL_WORLD_SEED
        })
    if (DEV_TEST_SETUP && portraitDataUrl) {
      gameState.player.portraitDataUrl = portraitDataUrl
    }
    // Begin the campaign tied up at Port Haven rather than adrift. Setting
    // dockedBodyId is enough: startSession's restoreSessionLocation() owns the
    // whole berthed entry path (berth pose, berthed HUD, harbour services),
    // which is the same route a save-load takes. Starting law is 10, so the
    // Sec 6 berth check passes.
    const world = getWorld(gameState.galaxy)
    const homePort =
      world?.bodies?.find((b) => b.id === gameState.player.homePortId) ??
      world?.bodies?.find((b) => b.kind === 'port')
    if (homePort) gameState.player.dockedBodyId = homePort.id
    // Berthed, so do not grab the helm on entry — Undock hands it back.
    startSession(gameState, { enterFlightMode: !homePort })
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
  if (playerWake) {
    scene.remove(playerWake.group)
    playerWake.dispose()
  }
  playerWake = null
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
  systemScanMap?.hide?.()
  systemScanMap?.element?.remove?.()
  systemScanMap = null
  seaChart = null
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
  audio.setThrustState(null)
  audio.stopAmbientMusic()
  audio.stopSeaAmbient()
  audio.stopWeatherAudio()
  weatherFx.clear()
  camera.fov = BASE_FOV
  camera.updateProjectionMatrix()
  resetChaseZoom()
  resetChaseCameraState()
  docked = false
  hud?.setDocked(false)
  paused = false
  chartOpen = false
  inventoryOpen = false
  missionsOpen = false
  characterOpen = false
  cruising = false
  wasCruising = false
  dockEffect = null
  dockedApproach = null
  clearProbeEffect()
  exitFlightMode()
}

function clearProbeEffect() {
  probeEffect = null
  audio.setProbeScanActive(false)
  sonarPulse?.stop()
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
  if (!gameState || docked || cruising) return
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
  // searchlight: one SpotLight on the player turret (night only).
  playerMesh = buildShipMesh(playerShipClass, { searchlight: true })
  scene.add(playerMesh)
  syncMeshToEntity(playerMesh, gameState.player.ship)
  // A different hull leaves a different wake — drop the old trail rather than
  // dragging it across from the boat that was just sold.
  playerWake?.reset()
}

/** Open/toggle Region Sonar Scan (HUD button + B). */
function openSystemScanPanel() {
  if (!gameState || !systemScanMap) return
  if (docked || dockEffect || cruising) {
    flashToast('Region Sonar Scan unavailable right now')
    return
  }
  if (
    paused ||
    chartOpen ||
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
  const sys = getWorld(gameState.galaxy)
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
  playerWake = createWake()
  scene.add(playerWake.group)
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
  loadBodiesForCurrentSystem()

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
  seaChart = createSeaChart(appEl, gameState, {
    canSetWaypoint: () => {
      if (cruising) {
        flashToast('Unable to set a waypoint with the autopilot engaged.')
        return false
      }
      return true
    },
    onWaypointChange: ({ name, set }) => {
      if (set) {
        audio.playWaypointSet()
        flashToast(`Waypoint set: ${name ?? 'mark'}`)
      } else {
        flashToast('Waypoint cleared')
      }
    },
    onClose: () => {
      chartOpen = false
      if (!docked) reenterFlightMode()
    }
  })
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
      chartOpen = false
      if (!docked) reenterFlightMode()
    }
  })
  datacoreMinigame = createDatacoreMinigame(appEl)
  systemOverview = createSystemOverview(appEl, gameState, {
    canSetWaypoint: () => {
      if (cruising) {
        flashToast('Unable to set a waypoint with the autopilot engaged.')
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
        flashToast('Unable to set a waypoint with the autopilot engaged.')
        return false
      }
      return true
    }
  })
  characterUI = createCharacterUI(appEl, gameState)
  ensureLawStanding(gameState)
  const startSys = getSystem(gameState.galaxy, gameState.player.currentSystemId)

  // Shared look for survey readouts + all floating HUD copy (prompts, toasts, labels).
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
.float-info-text .hud-toast-text {
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
  // text-shadow on this element only (the child .hud-toast-text span inherits
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

  // Autopilot status — under the boat status panel.
  // Fade in and out.
  cruiseIndicatorEl = document.createElement('div')
  cruiseIndicatorEl.id = 'cruise-indicator'
  cruiseIndicatorEl.className = 'float-info-text'
  cruiseIndicatorEl.style.cssText = belowStatusCss
  setHudToastText(cruiseIndicatorEl, 'AUTOPILOT ENGAGED')
  appEl.appendChild(cruiseIndicatorEl)

  // Reused for both the hyperspace punch and the dock/undock transition —
  // background color is set explicitly wherever each effect triggers.

  nextAmbientSpawnAt = gameState.simTime + AMBIENT_SPAWN_INTERVAL_S
  audio.startAmbientMusic()
  // Quiet water bed under diesel / combat for the whole session.
  audio.startSeaAmbient()

  if (offlineCraftDone.length) toastCraftCompleted(offlineCraftDone)
  if (anomaliesRefreshedOffline) {
    flashToast('Anomalous signals refreshed while you were away', 4.5)
  }

  // Restore free-flight pose or re-dock at the station saved in the file.
  restoreSessionLocation()

  // Brand-new games enter flight mode; loads keep docked/space state from save
  // and do not force pointer lock.
  if (enterFlightMode && !docked) reenterFlightMode()
}

/** Fully free the cursor — death / menu must never leave pointer-lock half-armed. */
function releaseMouseFully() {
  flightModeWanted = false
  flightMode = false
  laserFireHeld = false
  missileFireHeld = false
  mouseFreedForUI = false
  hidePointerLockBridge()
  stopPointerLockRetries()
  suppressPointerUnlockPause = true
  try {
    if (document.pointerLockElement) document.exitPointerLock()
  } catch {
    /* ignore */
  }
  // Chromium sometimes needs a second tick after exit during combat input.
  requestAnimationFrame(() => {
    try {
      if (document.pointerLockElement) document.exitPointerLock()
    } catch {
      /* ignore */
    }
    document.body.style.cursor = ''
  })
  document.body.style.cursor = ''
  // Keep suppress long enough that a delayed unlock cannot open pause.
  setTimeout(() => {
    suppressPointerUnlockPause = false
    // If death is still up and something re-locked, force free again.
    if (deathOrbit && document.pointerLockElement) {
      try {
        document.exitPointerLock()
      } catch {
        /* */
      }
      document.body.style.cursor = ''
    }
  }, 800)
}

function returnToMenu() {
  deathOrbit = null
  releaseMouseFully()
  try {
    deathScreen?.hide?.()
  } catch {
    /* */
  }
  clearSession()
  gameState = null
  // Ensure death overlay is gone and menu is on top for clicks.
  const ds = document.getElementById('death-screen')
  if (ds) {
    ds.style.display = 'none'
    ds.style.pointerEvents = 'none'
  }
  startMenuBackground()
  hasSave().then((exists) => {
    menu.show(exists)
    // Menu chrome must receive clicks; canvas sits underneath.
    if (menu?.element) {
      menu.element.style.pointerEvents = 'auto'
      menu.element.style.zIndex = '50'
    }
  })
}

// Dock when within DOCK_RANGE of the body centre, but never inside the
// collision shell / visual bulk (so large stations stay reachable and
// undock exits remain re-dockable without diving back into the mesh).
function dockRangeFor(body) {
  const bodyRadius = collisionRadiusFor(body) ?? 0
  const shipR = getShipCollisionRadius(playerShipClass)
  const shell = bodyRadius + shipR + DOCK_RANGE_COLLISION_MARGIN
  if (body.kind === 'port' || body.kind === 'outpost') {
    const visual = exteriorRadiusFor(body) ?? bodyRadius
    const outsideVisual = visual + shipR + DOCK_RANGE_COLLISION_MARGIN + 80
    return Math.max(DOCK_RANGE, shell, outsideVisual)
  }
  return Math.max(DOCK_RANGE, shell)
}

/**
 * Where the autopilot should hand back around a waypoint.
 * Stations/settlements: inside dockRange for F-to-dock.
 * Asteroid fields: near field centre (fraction of scatter radius), not at the edge.
 */
function autopilotArrivalRangeFor(body) {
  const shipR = getShipCollisionRadius(playerShipClass)

  // Belts: rocks fill body.radius around the field origin — drop well inside.
  if (body.kind === 'wreckField') {
    const fieldR = Math.max(40, body.radius ?? 120)
    return Math.max(60, Math.min(fieldR * 0.28, fieldR - 25) + shipR * 0.25)
  }

  const bodyRadius = collisionRadiusFor(body) ?? 0
  const shell = bodyRadius + shipR
  const dockR = dockRangeFor(body)
  const span = Math.max(0, dockR - shell)
  // Prefer ~half the dock bubble (or a modest clear past the shell) — never
  // near the outer dock edge, where tiny overshoot left players unable to F-dock.
  let preferred
  if (span > AUTOPILOT_ARRIVAL_MIN_CLEAR * 2) {
    preferred = shell + Math.max(AUTOPILOT_ARRIVAL_MIN_CLEAR, span * 0.45)
  } else {
    preferred = Math.max(shell + 12, dockR - AUTOPILOT_DOCK_INNER_SLACK)
  }
  // Always leave a solid margin inside dock range (and outside the shell).
  const minR = shell + Math.min(AUTOPILOT_ARRIVAL_MIN_CLEAR, Math.max(12, span * 0.25))
  const maxR = Math.max(minR, dockR - Math.max(AUTOPILOT_DOCK_INNER_SLACK, span * 0.2))
  return Math.min(maxR, Math.max(minR, preferred))
}

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
const HUD_NEAREST_KINDS = new Set(['island', 'port', 'outpost'])

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
    setHudToastText(miningToastEl, `Salvaged ${formatLootSummary(loot)} from the wreck`)
    showHudToast(miningToastEl)
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
  setHudToastText(el, text)
  showHudToast(el)
  toastQueue.push({ el, until: gameState.simTime + durationS })
  while (toastQueue.length > MAX_STACKED_TOASTS) {
    const oldest = toastQueue.shift()
    expireToast(oldest)
  }
}

function expireToast(item) {
  hideHudToast(item.el)
  setTimeout(() => item.el.remove(), HUD_TOAST_EXIT_MS)
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
  setHudToastText(hailResultsEl, `${speaker}:\n"${line}"`)
  const span = hailResultsEl.querySelector('.hud-toast-text')
  if (span) span.style.whiteSpace = 'pre-line'
  showHudToast(hailResultsEl)
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
  setHudToastText(craftToastEl, text)
  showHudToast(craftToastEl)
  clearTimeout(craftToastHideTimer)
  craftToastHideTimer = setTimeout(() => {
    hideHudToast(craftToastEl)
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
  return body.kind === 'island' || body.kind === 'wreckField'
}

// Close enough inshore to work a sonar drone off the boat.
function isInOrbitOfBody(body) {
  if (!body || body.kind !== 'island') return false
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const bodyPos = new THREE.Vector3().fromArray(body.position)
  const capture = (collisionRadiusFor(body) ?? 0) + PROBE_ORBIT_MARGIN
  return shipPos.distanceTo(bodyPos) < capture
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

// Prefer whatever is Tab-locked while lying close inshore; else the nearest
// thing worth sounding.
function getProbeLaunchTarget() {
  if (currentTarget?.kind === 'body') {
    const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const body = currentSystem.bodies.find((b) => b.id === currentTarget.id)
    if (body && body.kind === 'island' && isInOrbitOfBody(body)) {
      return { body, viaOrbit: true }
    }
  }
  const nearby = findNearbyProbeableBody()
  return nearby ? { body: nearby, viaOrbit: false } : null
}

/**
 * Sound the water around a place.
 *
 * There is no probe to launch any more — the boat carries sonar, so this is a
 * burst of pings from where you are, a wait while the returns come back, and
 * then the survey. Cap: MAX_PROBE_ATTEMPTS per place; attempts are reserved at
 * the first ping, so breaking off still costs a slot.
 */
function probeBody(body) {
  if (probeEffect) return

  // Ensure the map exists even on older in-memory states / partial loads.
  gameState.probeCounts ??= {}
  if (!canProbeBody(gameState, body.id)) {
    showFloatingProbeResults([probeExhaustedMessage(body.name)])
    return
  }

  // Snapshot before record: fully scanned + open contract → one free re-sound.
  const missionOnlyReprobe = isMissionOnlyReprobe(gameState, body.id)
  const n = recordProbeAttempt(gameState, body.id)

  sonarPulse.ping(gameState.player.ship.position)
  probeEffect = {
    elapsed: 0,
    body,
    pingsFired: 0,
    surveyLogged: false,
    // Snapshot now — the sounding completes the contract objective before the
    // results panel opens, so finishProbeResults cannot re-detect it later.
    attemptNumber: n,
    missionTargetAtLaunch: isActiveMissionProbeTarget(gameState, body.id),
    missionOnlyReprobe
  }
  audio.playSonarPing(0)
  audio.setProbeScanActive(true)
  if (missionOnlyReprobe) {
    flashToast(`Sonar pulse re-scan of ${body.name} for the contract… (no additional finds)`, 2.4)
  } else {
    flashToast(`Sounding ${body.name}… (${n}/${MAX_PROBE_ATTEMPTS})`, 2.2)
  }
}

function showFloatingProbeResults(messages) {
  if (!probeResultsEl || !messages.length) return
  // Single line (joined) so the fade matches every other floating HUD toast.
  setHudToastText(probeResultsEl, messages.join('\n'))
  const span = probeResultsEl.querySelector('.hud-toast-text')
  if (span) span.style.whiteSpace = 'pre-line'
  showHudToast(probeResultsEl)
  // Stay long enough to read multi-line mission results, then fade out.
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
  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const bodyPos = new THREE.Vector3().fromArray(body.position)
  const dist = shipPos.distanceTo(bodyPos)
  const shell = collisionRadiusFor(body) ?? 0
  if (body.kind === 'island') {
    return dist < shell + PROBE_ORBIT_MARGIN
  }
  // Asteroid belts: show while inside the field or near the outer edge.
  if (body.kind === 'wreckField') {
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
  // Else whatever nearby has already been sounded (island or wreck field).
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
      // Survey (and charting) contracts finish on the sounding; toast already fired.
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

  // Fire the rest of the burst on the same cadence the rings expand at.
  const due = Math.min(
    SONAR_PING_COUNT - 1,
    Math.floor(probeEffect.elapsed / SONAR_PING_INTERVAL_S)
  )
  while (probeEffect.pingsFired < due) {
    probeEffect.pingsFired += 1
    audio.playSonarPing(probeEffect.pingsFired)
  }

  if (probeEffect.elapsed < PROBE_SCAN_S) return

  // Log the survey the moment the returns are in, so berthing or breaking off
  // right afterwards cannot strand a contract in "in progress".
  const body = probeEffect.body
  if (!probeEffect.surveyLogged) {
    probeEffect.surveyLogged = true
    markBodyProbed(gameState, body.id)
    updateMissionProgress(gameState)
  }
  const attemptNumber = probeEffect.attemptNumber
  const missionTargetAtLaunch = probeEffect.missionTargetAtLaunch
  const missionOnlyReprobe = !!probeEffect.missionOnlyReprobe
  clearProbeEffect()
  audio.playSonarReturn()
  finishProbeResults(body, attemptNumber, missionTargetAtLaunch, missionOnlyReprobe)
}

/** Surface settlements sit on a planet/moon — radar shows the host only. */
/**
 * A coastal outpost is drawn as part of its island rather than as a separate
 * blip — otherwise every island with a jetty paints twice on the radar.
 */
function isPlanetSurfaceSettlement(body) {
  if (body.kind !== 'outpost') return false
  return !!body.parentId
}

function radarKindForBody(body, isWaypoint, isMission) {
  if (isWaypoint) return 'waypoint'
  if (isMission) return 'mission'
  if (body.kind === 'port' || body.kind === 'outpost') return 'port'
  if (body.kind === 'island') return 'island'
  if (body.kind === 'wreckField') return 'wreckField'
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

  const missionBodies = missionMarkedBodyIds(gameState, currentSystem.id)
  const waypointBodyId = gameState.player.waypointBodyId

  // Islands and harbours — coastal outposts paint as their island.
  // Wreck fields never show the field centre; only individual hulks.
  for (const body of currentSystem.bodies) {
    if (isPlanetSurfaceSettlement(body)) continue

    if (body.kind === 'wreckField') {
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

  // Fully scanned Anomalous Signal sites (relic, nodules, exposed alien base).
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

function dock(body) {
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!canDockWithLaw(gameState, body, system)) {
    flashToast(
      body.kind === 'port'
        ? 'Docking refused — security standing too low for this station (Sec 3–6)'
        : 'Docking refused'
    )
    return
  }
  docked = true
  resetDockOrbit(dockedApproach?.approachDir ?? null)
  audio.setThrustState(null)
  markBodyVisited(gameState, body.id)
  // Catch up mission flags (e.g. probe already in probedBodyIds) before the
  // board renders Turn In / In progress.
  updateMissionProgress(gameState)
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
  hud.setDocked(true, {
    // The berth itself, not the region — same rule as the flight HUD.
    systemName: bay?.name ?? 'Alongside',
    locationName: null,
    securityRating: bay?.securityRating ?? getSystemSecurity(getWorld(gameState.galaxy))
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
 * After load: put the boat back where it was left — under way at its saved
 * pose, or lying on its berth with harbour services open.
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
      (body.kind === 'port' || body.kind === 'outpost')
    ) {
      let exteriorPoint
      let approachDir
      if (
        Array.isArray(gameState.player.dockedExteriorPosition) &&
        gameState.player.dockedExteriorPosition.length === 3
      ) {
        exteriorPoint = new THREE.Vector3(...gameState.player.dockedExteriorPosition)
      } else {
        // No stored berth (new game, or an older save): come in from seaward.
        exteriorPoint = dockExteriorPoint(
          body,
          new THREE.Vector3().fromArray(gameState.player.ship.position)
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
      // Put the boat back on its berth, lying alongside as it was left.
      gameState.player.ship.position = [exteriorPoint.x, 0, exteriorPoint.z]
      gameState.player.ship.velocity = [0, 0, 0]
      gameState.player.ship.throttle = 0
      const heading = mooringHeading(approachDir)
      gameState.player.ship.heading = heading
      snapToSea(gameState.player.ship, gameState.simTime)
      applySeaAttitude(gameState.player.ship, heading, gameState.simTime)
      if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
      exitFlightMode()
      flightModeWanted = false
      dock(body) // sets the berthed HUD + harbour services
      applyDockOrbitCamera()
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

/**
 * A berth alongside the harbour, on whichever side the boat came in from.
 *
 * `approachDir` points from the berth toward the harbour — kept because undock
 * reverses along it, and because a save records it so a reloaded game puts the
 * boat back on the same side it tied up on.
 */
function dockExteriorPoint(body, shipPos) {
  const bodyPos = new THREE.Vector3(...body.position)
  const approachDir = bodyPos.clone().sub(shipPos)
  approachDir.y = 0
  if (approachDir.lengthSq() < 1e-6) approachDir.set(0, 0, 1)
  else approachDir.normalize()
  const bodyRadius = collisionRadiusFor(body) ?? 0
  const standoff = bodyRadius + getShipCollisionRadius(playerShipClass) + MOORING_STANDOFF
  const exteriorPoint = bodyPos.clone().addScaledVector(approachDir, -standoff)
  exteriorPoint.y = 0
  return { bodyPos, approachDir, exteriorPoint, standoff }
}

/**
 * Heading for a boat lying alongside: beam-on to the harbour, not bow-on. A
 * moored boat is parallel to the quay, which is also what puts its whole
 * broadside in frame for the berth camera.
 */
function mooringHeading(approachDir) {
  // Perpendicular to the approach, in the horizontal plane.
  return Math.atan2(approachDir.z, -approachDir.x)
}

// Where to slip to: outside the harbour's *visual* bulk along the stored
// approach bearing. The running collision shell is deliberately tighter than
// the mesh so you can come right alongside — but leaving has to clear the
// jetties.
function undockExteriorPoint(body, approachDir) {
  const bodyPos = new THREE.Vector3(...body.position)
  const dir = approachDir.clone()
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1)
  else dir.normalize()
  const bodyRadius = exteriorRadiusFor(body) ?? collisionRadiusFor(body) ?? 0
  const standoff = bodyRadius + getShipCollisionRadius(playerShipClass) + DOCK_EXTERIOR_MARGIN
  const exteriorPoint = bodyPos.clone().addScaledVector(dir, -standoff)
  exteriorPoint.y = 0
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
      flashToast('Sounding broken off — coming alongside')
    }
  }

  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  const { approachDir, exteriorPoint } = dockExteriorPoint(body, shipPos)

  dockedApproach = { body, exteriorPoint, approachDir }
  dockEffect = {
    undocking: false,
    elapsed: 0,
    body,
    thrusterPulsed: false,
    fromPos: shipPos.clone(),
    fromHeading: headingOf(gameState.player.ship),
    exteriorPoint,
    // Swing the bow round to lie parallel with the quay on the way in.
    toHeading: mooringHeading(approachDir)
  }
  gameState.player.ship.velocity = [0, 0, 0]
  audio.setThrustState(null)
  // Drop the autopilot cleanly (sound + flag) — dockEffect early-returns from
  // animate() so the usual edge-detect path won't run this frame.
  if (cruising || wasCruising) {
    cruising = false
    wasCruising = false
    setHudToastText(cruiseIndicatorEl, 'AUTOPILOT DISENGAGED')
    showHudToast(cruiseIndicatorEl)
    hideHudToast(cruiseIndicatorEl)
    gameState.player.ship.velocity = [0, 0, 0]
    gameState.player.ship.throttle = 0
  }
  exitFlightMode()
  dockPromptEl.style.display = 'none'
  probePromptEl.style.display = 'none'
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
  // Turn seaward as we come off the berth.
  dockEffect = {
    undocking: true,
    elapsed: 0,
    body,
    thrusterPulsed: false,
    fromPos: new THREE.Vector3().fromArray(gameState.player.ship.position),
    fromHeading: headingOf(gameState.player.ship),
    exteriorPoint,
    toHeading: Math.atan2(-awayDir.x, -awayDir.z),
    backAwayPoint
  }
  audio.playUndock()
  // Wipe chase-cam / mouse state left over from the bay
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

/**
 * Coming alongside, and slipping the berth again.
 *
 * There is no cut and no interior. The boat glides to a berth beside the
 * harbour, swinging its bow round to lie parallel with the quay, and stays
 * there in the world — riding the same swell, in the same weather, with the
 * anchorage in shot. Undocking reverses it and hands the helm back.
 */
function updateDockEffect(dt) {
  dockEffect.elapsed += dt
  const t = Math.min(1, dockEffect.elapsed / DOCK_ANIM_DURATION_S)
  const lt = easeInOutCubic(t)
  const ship = gameState.player.ship

  const to = dockEffect.undocking ? dockEffect.backAwayPoint : dockEffect.exteriorPoint
  _dockPos.copy(dockEffect.fromPos).lerp(to, lt)
  ship.position = [_dockPos.x, _dockPos.y, _dockPos.z]

  // Shortest way round, so a boat never spins the long way onto its berth.
  const delta = Math.atan2(
    Math.sin(dockEffect.toHeading - dockEffect.fromHeading),
    Math.cos(dockEffect.toHeading - dockEffect.fromHeading)
  )
  const heading = dockEffect.fromHeading + delta * lt
  ship.heading = heading
  ship.velocity = [0, 0, 0]
  ship.throttle = 0
  // Still afloat the whole way in — the berth is on the water, not in a hangar.
  snapToSea(ship, gameState.simTime)
  applySeaAttitude(ship, heading, gameState.simTime)

  if (!dockEffect.thrusterPulsed && dockEffect.elapsed > 0.2) {
    dockEffect.thrusterPulsed = true
    audio.playDockThrusterPulse()
  }

  syncMeshToEntity(playerMesh, gameState.player.ship)
  if (dockEffect.undocking) {
    // Ease the chase seat back in from wherever the berth camera left it.
    syncChaseCamera(camera, gameState.player.ship, { forceSnap: t > 0.6, dt })
  } else {
    // Ease from the chase seat out to the berth orbit as the boat settles.
    syncChaseCamera(camera, gameState.player.ship, { dt })
    if (t > 0.55) {
      _dockCamFrom.copy(camera.position)
      applyDockOrbitCamera()
      const blend = easeInOutCubic((t - 0.55) / 0.45)
      camera.position.lerpVectors(_dockCamFrom, camera.position, blend)
      camera.lookAt(_dockPos.x, _dockPos.y + 2.5, _dockPos.z)
      camera.updateMatrixWorld(true)
    }
  }

  if (dockEffect.elapsed >= DOCK_ANIM_DURATION_S) {
    if (!dockEffect.undocking) {
      const finishedBody = dockEffect.body
      dockEffect = null
      dock(finishedBody)
    } else {
      ship.velocity = [0, 0, 0]
      const body = dockEffect.body
      dockEffect = null
      docked = false
      dockedApproach = null
      clearDockedSaveFields()
      applyDockedHud()
      systemOverview?.show()
      resetChaseCameraState()
      snapChaseCamera(camera, gameState.player.ship)
      markBodyVisited(gameState, body.id)
    }
  }
}

function handlePlayerDeath() {
  if (deathOrbit) return
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
    // deathScreen accepts both names; pass both so neither path goes blank.
    killerName: killer?.pilotName ?? null,
    killerPilot: killer?.pilotName ?? null,
    killerShip: killer?.shipName ?? null,
    killerFaction: killer?.faction ?? null,
    killerMethod: killer?.method ?? null
  }
  const pos = [...gameState.player.ship.position]
  const r = getShipCollisionRadius(playerShipClass)
  // Arm death flag first — every pointer-lock path checks this before re-locking.
  deathOrbit = {
    center: pos,
    yaw: headingOf(gameState.player.ship) + Math.PI * 0.35,
    pitch: 0.32,
    dist: Math.max(42, r * 4.5),
    t: 0
  }
  playShipDeathFx(pos, r, { sound: true })
  const wreck = spawnWreckWithSkills(
    pos,
    gameState.simTime,
    Math.random,
    gameState.player.ship.classId,
    gameState
  )
  gameState.wrecks ??= []
  gameState.wrecks.push(wreck)
  if (playerMesh) playerMesh.visible = false
  gameState.player.ship.velocity = [0, 0, 0]
  gameState.player.ship.throttle = 0
  cruising = false
  // Free the mouse completely so death UI + later title menu stay clickable.
  releaseMouseFully()
  exitFlightMode()
  // Clear combat HUD so only the red vignette + death text + Return button remain.
  hideCombatHudForDeath()
  // Fade diesel / cruise / thrusters under the death screen (don't hard-cut).
  audio.fadeShipAudio(1.1)
  audio.playDeathMusic()
  deathScreen.show(summary)
}

/** Strip all in-world HUD chrome for the death orbit view. */
function hideCombatHudForDeath() {
  if (hud?.element) hud.element.style.display = 'none'
  systemOverview?.hide?.()
  if (crosshairEl) crosshairEl.style.display = 'none'
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'
  if (typeof hudReticleRing !== 'undefined' && hudReticleRing) hudReticleRing.visible = false
  if (typeof hudReticleDot !== 'undefined' && hudReticleDot) hudReticleDot.visible = false
  for (const el of [
    miningToastEl,
    factionToastEl,
    probePromptEl,
    probeResultsEl,
    hailResultsEl,
    dockPromptEl,
    wreckPromptEl,
    cruiseIndicatorEl
  ]) {
    if (el) el.style.display = 'none'
  }
}

window.addEventListener('keydown', (e) => {
  if (!gameState || deathOrbit) return
  if (e.code === 'KeyF' && !docked && !dockEffect && !cruising && !paused) {
    // Every F action now requires the object to be Tab-locked first — being
    // merely in range no longer triggers dock / gate / salvage / hack, so the
    // prompt and the keypress always agree on what F is about to do.
    // Wreck salvage always wins while a wreck is in range (1 km) — overrides
    // gate / dock / nodule F binds so salvage is never blocked by a station.
    // (Menus still block F via inventory/missions/character/nav checks below.)
    if (!chartOpen && !inventoryOpen && !missionsOpen && !characterOpen) {
      const wreck = findNearbyWreck()
      if (wreck && currentTarget?.kind === 'wreck' && currentTarget.id === wreck.id) {
        lootNearbyWreck(wreck)
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
  } else if (e.code === 'KeyP' && !docked && !dockEffect && !cruising && !probeEffect && !chartOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen && !systemScanMap?.isOpen?.() && !datacoreMinigame?.isOpen?.()) {
    // Planetary/body probing only — datacore nodules hack via F (Tab-targeted).
    const launch = getProbeLaunchTarget()
    if (launch) probeBody(launch.body)
  } else if (
    e.code === 'KeyB' &&
    !docked &&
    !dockEffect &&
    !cruising &&
    !probeEffect &&
    !chartOpen &&
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
    !chartOpen &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen
  ) {
    // Docked only: S toggles Services (flight uses S for reverse thrust).
    e.preventDefault()
    dockingUI?.toggleServices?.()
  } else if (e.code === 'KeyM' && !paused && !inventoryOpen && !missionsOpen && !characterOpen && !dockEffect) {
    // The sea chart — under way or alongside. One sea, so this is the only map
    // there is; it sets a waypoint rather than plotting a route between regions.
    chartOpen = !chartOpen
    audio.setThrustState(null)
    if (chartOpen) {
      exitFlightMode()
      seaChart?.show()
    } else {
      seaChart?.hide()
      if (!docked) reenterFlightMode()
    }
  } else if (e.code === 'KeyC' && !docked && !chartOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen) {
    if (cruising) {
      cruising = false
    } else if (!getActiveWaypoint()) {
      flashToast('Set a waypoint first (Navigation, Ctrl+Tab on a body, or J for missions)')
    } else if (gameState.inCombat) {
      flashToast('Cannot hand over the helm while under fire')
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
    !chartOpen &&
    !paused &&
    !inventoryOpen &&
    !missionsOpen &&
    !characterOpen &&
    !cruising
  ) {
    if (!hasDroneBays(gameState.player.ship)) {
      flashToast('No drone bays on this hull')
    } else if (e.code === 'KeyG') {
      const r = summonDrones(gameState)
      if (!r.ok) flashToast(r.reason || 'Cannot launch support drones')
      else {
        flashToast(`Support drones away (${r.launched})`)
        syncDroneMeshes()
      }
    } else {
      const r = recallDrones(gameState)
      if (!r.ok) flashToast('No drones to recall')
      else flashToast('Support drones returning to bay')
      // Meshes stay until return animation finishes (updatePlayerDrones).
    }
  } else if (e.code === 'Space' && !docked && !dockEffect && !chartOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen) {
    // If locked in flight, Space exits. If wanted-but-lost (tab-out) or off,
    // Space (re)enters — so tabbing out then Space re-acquires cleanly.
    if (flightMode && document.pointerLockElement === renderer.domElement) {
      exitFlightMode()
    } else {
      reenterFlightMode()
    }
  } else if (e.code === 'Tab' && !docked && !chartOpen && !paused && !inventoryOpen && !missionsOpen && !characterOpen) {
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
  } else if (e.code === 'KeyI' && !chartOpen && !paused && !missionsOpen && !characterOpen && !dockEffect) {
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
  } else if (e.code === 'KeyJ' && !chartOpen && !paused && !inventoryOpen && !characterOpen && !dockEffect) {
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
  if (chartOpen) {
    chartOpen = false
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

  if (!docked && !cruising && !paused && !chartOpen && !inventoryOpen && !missionsOpen) {
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
const TARGET_RANGE = 2000
const TARGETABLE_BODY_KINDS = new Set(['island', 'port', 'outpost'])

function asteroidWorldPosition(field, rock) {
  return [field.position[0] + rock.position[0], field.position[1] + rock.position[1], field.position[2] + rock.position[2]]
}

/**
 * Per-frame hostility context — avoid getSystem/truce/security work per NPC
 * (radar + drones used to re-run those for every contact; first engage felt hitchy).
 */
function buildHostilityContext() {
  const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
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
  if (kind === 'wreckField') return 'wreck field'
  if (kind === 'port') return 'harbour'
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
    } else if (body.kind === 'wreckField') {
      getAsteroidRocks(body).forEach((rock, index) => {
        if (!isRockAlive(gameState, body.id, index)) return
        const position = asteroidWorldPosition(body, rock)
        const dist = shipPos.distanceTo(new THREE.Vector3(...position))
        if (dist <= TARGET_RANGE) entities.push({ kind: 'asteroid', fieldId: body.id, index, position, dist, radius: 0 })
      })
    }
  }

  // Fully scanned Anomalous Signal sites — central relic, nodules, alien base.
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
            name: 'Drowned base'
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

// World direction the crosshair / turret is laid on (not hull boresight).
// Tab-lock and Ctrl+Tab waypoints both use this so aiming left of the bow
// still selects what is under the reticle.
const _aimFwd = new THREE.Vector3()
function crosshairAimDirection(out = _aimFwd) {
  return turretDirection(gameState.player.ship, out)
}

// How well the aim ray lines up with an entity. Small targets use a pure cone;
// large bodies also score high if the ray clips their shell (looking at an
// island's limb still locks the island).
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

/** Aim shell used for Ctrl+Tab waypoint pick (not collision / grounding). */
function waypointAimRadius(body) {
  if (body.kind === 'island') {
    // Full generation disc — maxShore is only for grounding and is far too
    // tight to aim at a headland or distant mass under the reticle.
    const shore = collisionRadiusFor(body) ?? 0
    return Math.max(body.radius ?? 0, shore, 60)
  }
  if (body.kind === 'wreckField') return body.radius ?? 80
  return collisionRadiusFor(body) ?? exteriorRadiusFor(body) ?? 40
}

// Bodies that can be locked as a navigation waypoint via Ctrl+Tab (fields as
// a whole, not individual rocks — rocks are combat/mining targets only).
const WAYPOINTABLE_BODY_KINDS = new Set([
  'island',
  'port',
  'outpost',
  'wreckField',
  'warpGate'
])

// Scratch for unlimited-range screen pick (Ctrl+Tab).
const _wpPickWorld = new THREE.Vector3()
const _wpPickNdc = new THREE.Vector3()
const _wpPickCam = new THREE.Vector3()
/** NDC distance from reticle — ~0.35 covers a generous “under the cursor” patch. */
const WAYPOINT_PICK_NDC = 0.38

/**
 * Ctrl+Tab: set (or clear) a waypoint on whatever is under the reticle.
 *
 * **No range limit.** If the body projects onto the screen near the reticle,
 * it is fair game — horizon islands included. Combat Tab still uses TARGET_RANGE.
 */
function setWaypointFromCrosshair() {
  if (!gameState) return
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (!currentSystem) return

  camera.updateMatrixWorld(true)
  camera.getWorldPosition(_wpPickCam)

  // Reticle NDC: project the turret aim point so waypoint pick matches the
  // guns, not bare screen centre.
  const aimDir = crosshairAimDirection()
  _wpPickWorld.copy(_wpPickCam).addScaledVector(aimDir, 800)
  _wpPickNdc.copy(_wpPickWorld).project(camera)
  const retX = _wpPickNdc.x
  const retY = _wpPickNdc.y

  let best = null
  let bestDist = Infinity

  for (const body of currentSystem.bodies) {
    if (!WAYPOINTABLE_BODY_KINDS.has(body.kind)) continue
    const radius = waypointAimRadius(body)
    _wpPickWorld.fromArray(body.position)
    // Behind the camera → not on screen.
    _wpPickNdc.subVectors(_wpPickWorld, _wpPickCam)
    if (_wpPickNdc.dot(aimDir) <= 0) continue

    const distWorld = _wpPickCam.distanceTo(_wpPickWorld)
    _wpPickNdc.copy(_wpPickWorld).project(camera)
    // Outside clip (behind or far plane glitch).
    if (!Number.isFinite(_wpPickNdc.x) || !Number.isFinite(_wpPickNdc.y)) continue
    if (_wpPickNdc.z < -1.05 || _wpPickNdc.z > 1.05) continue

    // Angular size in NDC so aiming at any part of a large island counts,
    // and a distant speck still has a small but usable pick radius.
    const halfFovY = ((camera.fov ?? 55) * Math.PI) / 360
    const ang = distWorld > 1e-3 ? Math.atan2(radius, distWorld) : Math.PI / 2
    const ndcRadius = Math.max(0.012, Math.min(0.9, ang / halfFovY))

    let dx = _wpPickNdc.x - retX
    let dy = _wpPickNdc.y - retY
    let d = Math.hypot(dx, dy) - ndcRadius
    if (d < 0) d = 0

    // Must be somewhere on / near the visible frame (reticle-relative).
    if (d > WAYPOINT_PICK_NDC) continue

    // Prefer tighter reticle hit; near-tie prefers larger mass (island > quay).
    if (
      d < bestDist - 1e-4 ||
      (Math.abs(d - bestDist) <= 1e-4 && best && radius > (best.radius ?? 0) * 1.15)
    ) {
      bestDist = d
      best = { id: body.id, name: body.name, radius, kind: body.kind }
    }
  }

  if (!best) {
    flashToast('No place under crosshair — aim at an island, harbour, outpost, or wreck field')
    return
  }

  // Clearing the current waypoint is always allowed; setting a new one is not
  // with the autopilot engaged (it would redirect mid-passage).
  if (gameState.player.waypointBodyId === best.id) {
    gameState.player.waypointBodyId = null
    gameState.player.waypointPosition = null
    audio.playWaypointClear()
    flashToast(`Waypoint cleared: ${best.name}`)
    return
  }

  if (cruising) {
    flashToast('Unable to set a waypoint with the autopilot engaged.')
    return
  }

  gameState.player.waypointBodyId = best.id
  gameState.player.waypointPosition = null
  audio.playWaypointSet()
  flashToast(`Waypoint set: ${best.name}`)
}


/** Clear Tab-lock target only — does not touch waypoints / plotted routes. */
function clearTargetLock() {
  currentTarget = null
  if (targetIndicatorEl) targetIndicatorEl.style.display = 'none'
  if (targetDirEl) targetDirEl.style.display = 'none'
}

// Tab targeting: anything under the crosshair (turret aim) always wins first.
// If that object is already locked (or nothing is under the reticle), cycle by
// distance to the next entity, wrapping around.
function cycleTarget() {
  const entities = getTargetableEntities()
  if (entities.length === 0) {
    currentTarget = null
    return
  }

  const shipPos = new THREE.Vector3().fromArray(gameState.player.ship.position)
  // Turret / crosshair direction — not hull forward (camera and guns track the gun).
  const forward = crosshairAimDirection()
  // Strongest aim under a ~20° cone around the reticle.
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
    const maxArmor = shipClass.stats.armor
    const faction = npc.faction || 'unknown'
    return {
      position: npc.position,
      name: shipClass.name,
      pilotName: npc.pilotName || null,
      faction,
      hostile: isHostileToPlayer(npc),
      hullPct: Math.max(0, npc.hull / maxHull),
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
          name: 'Floating wreckage',
          hostile: false,
          hullPct: null,
          isAsteroid: false,
          reticle: 'wreck',
          kindLabel: 'wreckage'
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
      name: `${rockDisplayName(field, field.oreOverride)} (${field.name})`,
      hostile: false,
      hullPct: null,
      oreLeft,
      oreMax,
      isAsteroid: true,
      reticle: 'asteroid',
      kindLabel: 'sunken hull'
    }
  }
  // Open-water mark (e.g. where the autopilot handed back on a contract).
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
      name: 'Drowned base',
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
  if (body.kind === 'wreckField') return null
  return {
    position: body.position,
    name: body.name,
    hostile: false,
    hullPct: null,
    isAsteroid: false,
    reticle: body.kind === 'port' || body.kind === 'outpost' ? 'facility' : 'world',
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
    // Remaining salvage on the hulk — when it hits zero the wreck breaks up.
    const maxBit = target.oreMax != null ? `/${target.oreMax}` : ''
    label.textContent = `${target.name} · ${Math.round(dist)}m · ${target.oreLeft}${maxBit} salvage`
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

// Where the guns are laid — the crosshair is this point projected (see game/turret.js).
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
  const on = !!(flightMode && gameState && !docked && !paused)
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
  // The crosshair is wherever the turret is trained — it moves around the
  // screen as the mount traverses and elevates, and it is the same point the
  // guns fire at.
  turretAimPoint(gameState.player.ship, playerShipClass, _boresightAim)
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
function setTargetFromAutopilotArrival(wp) {
  if (!wp) return
  if (wp.bodyId) {
    const system = getSystem(gameState.galaxy, gameState.player.currentSystemId)
    const body = system?.bodies?.find((b) => b.id === wp.bodyId)
    // Wreck fields stay waypointable for cruise, but the field as a whole is
    // not a Tab-lock target — the individual hulks are.
    if (body?.kind === 'wreckField') {
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

// A place on the chart, or an open-water mark (a bounty's last known position).
function getActiveWaypoint() {
  const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  if (gameState.player.waypointBodyId) {
    const body = currentSystem.bodies.find((b) => b.id === gameState.player.waypointBodyId)
    if (body) {
      const missionBodies = missionMarkedBodyIds(gameState, currentSystem.id)
      return {
        position: body.position,
        name: body.name,
        bodyId: body.id,
        isMission: missionBodies.has(body.id),
        arrivalRange: autopilotArrivalRangeFor(body)
      }
    }
    // Fully scanned Anomalous Signal (overview waypoint)
    const anomaly = getAnomaly(currentSystem, gameState.player.waypointBodyId, gameState.galaxy)
    if (anomaly?.fullyScanned && anomaly.position) {
      return {
        position: anomaly.position,
        name: anomaly.displayName || 'Anomalous Signal',
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
  if (!gameState) {
    spray.clear()
    updateMenuBackground(dt)
    tickWeather(dt, menuAnimT)
    refreshEnvironment(menuAnimT)
    render()
    return
  }

  // Rain / storms keep rolling while docked, paused, or dead.
  tickWeather(dt, gameState.simTime)

  // Death: freeze the fight, keep the sea running, orbit the wreck slowly.
  if (deathOrbit) {
    spray.clear()
    deathOrbit.t += dt
    deathOrbit.yaw += dt * 0.18
    const [cx, cy, cz] = deathOrbit.center
    const cosP = Math.cos(deathOrbit.pitch)
    camera.position.set(
      cx + Math.sin(deathOrbit.yaw) * cosP * deathOrbit.dist,
      cy + 10 + Math.sin(deathOrbit.pitch) * deathOrbit.dist * 0.85,
      cz + Math.cos(deathOrbit.yaw) * cosP * deathOrbit.dist
    )
    camera.lookAt(cx, cy + 2, cz)
    const liveWreckIds = new Set()
    for (const wreck of gameState.wrecks ?? []) {
      liveWreckIds.add(wreck.id)
      let mesh = wreckMeshes.get(wreck.id)
      if (!mesh) {
        let cls = null
        try { cls = wreck.shipClassId ? getShipClass(wreck.shipClassId) : null } catch { /* */ }
        mesh = buildWreckMesh(cls)
        mesh.position.fromArray(wreck.position)
        wreckMeshes.set(wreck.id, mesh)
        scene.add(mesh)
      }
      updateWreckMesh(mesh, gameState.simTime + deathOrbit.t, dt, wreck.position)
    }
    for (const [id, mesh] of wreckMeshes) {
      if (!liveWreckIds.has(id)) {
        scene.remove(mesh)
        wreckMeshes.delete(id)
      }
    }
    for (const mesh of bodyMeshes.values()) updateHarbourMesh(mesh, gameState.simTime + deathOrbit.t)
    refreshEnvironment(gameState.simTime + deathOrbit.t)
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
        flashToast('Anomalous signals refreshed across the region', 4.5)
      }
    }
  }

  // Checked before the `docked` early-return below: docked stays true for
  // the whole undocking animation (it only flips false once the animation
  // completes), so this branch must run regardless of `docked`.
  if (dockEffect) {
    spray.clear()
    updateDockEffect(dt)
    refreshEnvironment(gameState?.simTime ?? menuAnimT)
    render()
    return
  }

  // Only the pause menu freezes the sim. Map / Inventory / Missions leave the
  // world running (flight input stays off while those UIs hold the cursor).
  if (paused) {
    spray.clear()
    audio.setStrafeActive(false)
    if (targetDirEl) targetDirEl.style.display = 'none'
    if (docked) applyDockOrbitCamera()
    refreshEnvironment(gameState?.simTime ?? menuAnimT)
    render()
    return
  }

  if (docked) {
    spray.clear()
    audio.setStrafeActive(false)
    if (targetDirEl) targetDirEl.style.display = 'none'
    applyDockedHud()
    // Moored, so the boat still rides the swell and the harbour still lives
    // around it — but nothing can touch you and there is no helm to hold.
    snapToSea(gameState.player.ship, gameState.simTime)
    applySeaAttitude(gameState.player.ship, headingOf(gameState.player.ship), gameState.simTime)
    syncMeshToEntity(playerMesh, gameState.player.ship)
    for (const mesh of bodyMeshes.values()) updateHarbourMesh(mesh, gameState.simTime)
    updateBodyVisibility()
    applyDockOrbitCamera()
    {
      const day = refreshEnvironment(gameState.simTime)
      _nightLightFactor = nightLightFactorFromDay(day)
      if (playerMesh) updateShipNightLights(playerMesh, _nightLightFactor)
    }
    render()
    return
  }

  updateAnomalySites(dt)

  // Probe flight runs in normal play (ship can still fly while it works).
  if (probeEffect) updateProbeEffect(dt)
  sonarPulse.update(dt, gameState.simTime)
  updateProbeScanFloat()
  updatePlayerDrones(dt)

  let thrustState = null
  if (cruising) {
    const wp = getActiveWaypoint()
    if (!wp || gameState.inCombat) {
      cruising = false
    } else {
      const currentSystem = getSystem(gameState.galaxy, gameState.player.currentSystemId)
      const shipRadius = getShipCollisionRadius(playerShipClass)
      // Steer around other bodies on the way; destination body is not avoided
      // so arrival still works (see autopilot.aimAroundObstacles).
      const skillB = playerSkillBonuses(gameState)
      if (updateAutopilot(
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
        },
        gameState.simTime
      )) {
        cruising = false
        // Kill residual cruise speed immediately so we don't coast into the shell.
        gameState.player.ship.velocity = [0, 0, 0]
        gameState.player.ship.throttle = 0
        // Snap facing onto the destination so you're lined up to dock/approach.
        const shipPos = gameState.player.ship.position
        const dx = wp.position[0] - shipPos[0]
        const dz = wp.position[2] - shipPos[2]
        if (dx * dx + dz * dz > 1e-4) {
          gameState.player.ship.heading = Math.atan2(dx, dz)
        }
        // Keep a reticle on the destination after the waypoint is cleared.
        setTargetFromAutopilotArrival(wp)
        // Clear the nav lock on arrival — you are already there.
        gameState.player.waypointBodyId = null
        gameState.player.waypointPosition = null
        // Arriving at a stripped wreck field — show the settle-again countdown.
        toastIfDepletedField(wp.bodyId)
      }
    }
    // Autopilot uses the same diesel as the helm — no separate cruise bed.
    audio.setThrustState('accel')
    const apSpeed = Math.hypot(
      gameState.player.ship.velocity[0] ?? 0,
      gameState.player.ship.velocity[2] ?? 0
    )
    const skillAp = playerSkillBonuses(gameState)
    const apTop = Math.max(
      1e-3,
      (playerShipClass.stats?.speed ?? 1) *
        (skillAp.speedMult ?? 1) *
        (skillAp.cruiseMult ?? 1)
    )
    // Rev with actual speed (ramp-up / approach), never silent while under way.
    audio.setEngineRevs(Math.min(1, Math.max(0.2, apSpeed / apTop)))
  } else {
    // Lay the turret first: it is the only consumer of the accumulated mouse
    // delta, and doing it before the hull moves keeps a click-to-fire between
    // frames matching the crosshair drawn this frame.
    if (flightMode) updateTurretAim(gameState.player.ship, mouseAim)
    else centreTurret(gameState.player.ship, dt)
    {
      const skillB = playerSkillBonuses(gameState)
      updateFlight(
        gameState.player.ship,
        playerShipClass,
        flightMode ? keys : EMPTY_KEYS,
        dt,
        {
          speedMult: skillB.speedMult,
          turnMult: skillB.turnMult,
          maxSpeed: effectiveMaxSpeed(gameState.player.ship, playerShipClass)
        },
        gameState.simTime
      )
    }
    // The engine idles whenever the helm is manned — a diesel does not cut out
    // because you eased the throttle. `null` only when nobody is driving.
    thrustState = !flightMode ? null : keys.has('KeyW') ? 'accel' : keys.has('KeyS') ? 'brake' : 'idle'
    audio.setThrustState(thrustState)
    if (thrustState) audio.setEngineRevs(Math.abs(gameState.player.ship.throttle ?? 0))
  }
  // The sea has the final say on where the hull sits — after handling, before
  // anything reads the pose. Every other mover goes through the same clamp
  // (see world/sea.js snapToSea).
  snapToSea(gameState.player.ship, gameState.simTime)
  // How policed this patch of water is, from the nearest harbour. Everything
  // downstream still asks the world object, and now gets a local answer.
  applyLocalSecurity(getWorld(gameState.galaxy), gameState.player.ship.position)

  // Keep mesh + chase seat in sync with the post-handling pose *before* weapons
  // and reticles so undock/load can't leave a one-frame cam/gun skew.
  if (playerMesh) syncMeshToEntity(playerMesh, gameState.player.ship)
  syncChaseCamera(camera, gameState.player.ship, { cruising, dt })

  // Edge-detect engage/disengage for HUD + residual speed cleanup.
  if (cruising !== wasCruising) {
    if (cruising) {
      // Ramp starts at 0 every engage (see autopilot.AUTOPILOT_RAMP_UP_S).
      gameState.player.ship.supercruiseElapsed = 0
    } else {
      // Drop all residual cruise speed so normal flight doesn't inherit a huge v.
      gameState.player.ship.velocity = [0, 0, 0]
      gameState.player.ship.throttle = 0
      gameState.player.ship.supercruiseElapsed = 0
      // Kill the wake immediately rather than waiting a frame.
    }
    // HUD toast only — no TTS callout for engage/disengage.
    if (cruising) {
      setHudToastText(cruiseIndicatorEl, 'AUTOPILOT ENGAGED')
      showHudToast(cruiseIndicatorEl)
    } else {
      // Brief yellow callout (same style as engage), then fade out.
      setHudToastText(cruiseIndicatorEl, 'AUTOPILOT DISENGAGED')
      showHudToast(cruiseIndicatorEl)
      hideHudToast(cruiseIndicatorEl)
    }
    wasCruising = cruising
  }

  const currentBodies = getSystem(gameState.galaxy, gameState.player.currentSystemId).bodies
  const shipRadius = getShipCollisionRadius(playerShipClass)
  // The autopilot steers around land rather than through it (see
  // game/autopilot.js aimAroundObstacles), so collision stays on under it —
  // running aground on autopilot is a real outcome, not a teleport.
  resolveBodyCollisions(gameState.player.ship, currentBodies, shipRadius, {
    isRockAlive: (fieldId, index) => isRockAlive(gameState, fieldId, index)
  })

  const shipSpeed = Math.hypot(...gameState.player.ship.velocity)
  // Water over the bow and speed streaks, scaled by how hard you are driving
  // her. Autopilot boosts both: it runs above the hull's own top speed, so
  // speedFraction alone would understate it. Stopped / docked / dead clear the glass.
  //
  // The stem is projected to screen each frame so the spray radiates from where
  // it is actually being thrown up — off the bow, past the chase camera —
  // rather than from the middle of the frame.
  const speedFrac = shipSpeed / Math.max(1e-3, playerShipClass.stats.speed)
  if (shipSpeed < 0.35 && !cruising) {
    spray.clear()
  } else {
    _sprayOrigin
      .set(0, 0, playerShipClass.hull.length * 0.5)
      .applyQuaternion(_sprayQuat.fromArray(gameState.player.ship.quaternion))
      .add(_sprayShipPos.fromArray(gameState.player.ship.position))
      .project(camera)
    spray.update(
      dt,
      speedFrac,
      cruising ? 1 : 0,
      [_sprayOrigin.x, _sprayOrigin.y],
      renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight)
    )
  }
  // Speed FOV: widens a little as the boat comes up onto the plane, fixed under
  // cruise. Snap when close or nearly stopped so the settle can't smear aim.
  const speedFovBoost =
    SPEED_FOV_MAX * Math.min(1, shipSpeed / Math.max(1e-3, playerShipClass.stats.speed))
  const targetFov = BASE_FOV + speedFovBoost
  const fovErr = Math.abs(camera.fov - targetFov)
  if (fovErr < 0.08 || (shipSpeed < 2 && speedFovBoost < 0.05)) {
    if (camera.fov !== targetFov) {
      camera.fov = targetFov
      camera.updateProjectionMatrix()
    }
  } else {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 6)
    camera.updateProjectionMatrix()
  }
  // AUTOPILOT ENGAGED: faded in and out on the wasCruising edge.
  // Player mesh + chase cam are re-synced after orbital carry (see below).
  syncMeshToEntity(playerMesh, gameState.player.ship)
  const strafeX = cruising ? 0 : (gameState.player.ship.strafeX ?? 0)
  const strafeY = cruising ? 0 : (gameState.player.ship.strafeY ?? 0)
  audio.setStrafeActive(!cruising && flightMode && (strafeX !== 0 || strafeY !== 0))
  // Water displaced by the hull, not exhaust. Grows with speed.
  playerWake.update(
    gameState.player.ship.position,
    headingOf(gameState.player.ship),
    shipSpeed / Math.max(1e-3, playerShipClass.stats.speed),
    playerShipClass.hull.length,
    gameState.simTime,
    dt
  )
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
      setHudToastText(factionToastEl, npc.ramQuote)
      showHudToast(factionToastEl)
      factionToastUntil = gameState.simTime + FACTION_TOAST_DURATION_S
    }
  }
  updateProjectiles(gameState, dt, onProjectileHit)
  updateCombatFlag(gameState, combatFrame)
  updateDamageVignette(dt)
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
      setHudToastText(factionToastEl, 'The pirates thank you for the assist, and hyperspace away.')
      showHudToast(factionToastEl)
      factionToastUntil = gameState.simTime + FACTION_TOAST_DURATION_S
    }
  }
  truceWasActive = truceNowActive

  // Busy shipping lanes in home waters, empty sea further out —
  // spawnEncounterNear separately biases what you meet by the same remoteness.
  const spawnSystem = getWorld(gameState.galaxy)
  const core = remoteness(gameState.player.ship.position)
  const ambientCap = Math.max(1, Math.round(AMBIENT_NPC_CAP + 1 - core * 3))
  // Honest traffic only while inside the Haven Reach patrol area and the player
  // has not started anything (see combat.js). Contract targets still spawn.
  const atPeacefulHome =
    inHomeWaters(gameState.player.ship.position) && !gameState.flags.startingSystemPeaceBroken
  const forceNeutralAmbient = atPeacefulHome
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
      // lite hull + wake (EdgesGeometry skipped — hitch when meshing mid-fight)
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
    // Nav lights share the same night factor as the player (set below).
    if (_nightLightFactor > 0.05 || mesh.userData.runningLights?.lastNight !== 0) {
      updateShipNightLights(mesh, _nightLightFactor)
    }
  }

  // Police response: when fighting pirates in a secured system, backup arrives
  // after a delay based on security rating (higher = faster).
  {
    const sys = getSystem(gameState.galaxy, gameState.player.currentSystemId)
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
      let cls = null
      try { cls = wreck.shipClassId ? getShipClass(wreck.shipClassId) : null } catch { /* */ }
      mesh = buildWreckMesh(cls)
      mesh.position.fromArray(wreck.position)
      wreckMeshes.set(wreck.id, mesh)
      scene.add(mesh)
    }
    updateWreckMesh(mesh, gameState.simTime, dt, wreck.position)
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

  // Harbour beacons pulse. Land does not animate.
  for (const mesh of bodyMeshes.values()) updateHarbourMesh(mesh, gameState.simTime)
  updateBodyVisibility()
  // Depleted rocks "explode" (see onProjectileHit) and stay hidden until
  // their own respawn delay passes — isRockAlive is the single source of
  // truth for that, shared with targeting (getTargetableEntities/resolveTarget).
  for (const body of getSystem(gameState.galaxy, gameState.player.currentSystemId).bodies) {
    if (body.kind !== 'wreckField') continue
    const mesh = bodyMeshes.get(body.id)
    if (!mesh) continue
    mesh.children.forEach((child, i) => { child.visible = isRockAlive(gameState, body.id, i) })
  }
  syncMeshToEntity(playerMesh, gameState.player.ship)
  // 60s with no input: let the chase seat drift around the ship.
  // Never on autopilot — idle drift fighting the passage camera looks broken.
  setChaseIdleOrbit(!cruising && performance.now() - lastInputAtMs > 60_000)
  syncChaseCamera(camera, gameState.player.ship, { cruising, dt })

  // Fire after final pose + camera; mesh-sync again so new bolts draw this frame.
  // Independent: hold LMB + RMB to fire lasers and missiles at the same time.
  if (laserFireHeld) tryPlayerFire('laser')
  if (missileFireHeld) tryPlayerFire('missile')
  syncProjectileMeshesNow()

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
      !chartOpen &&
      !inventoryOpen &&
      !missionsOpen &&
      !characterOpen &&
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
  // Where you are, not what region you are in — one sea, so the region name is
  // the same every frame and tells you nothing. The nearest place does.
  const nearestHudBody = findNearestHudBody()
  {
    const ps = gameState.player.ship
    ps.maxArmor = effectiveMaxArmor(ps, playerShipClass)
  }
  hud.update(
    gameState.player.ship,
    playerShipClass,
    speed,
    forwardSpeed,
    nearestHudBody?.name ?? 'Open water',
    null,
    getSystemSecurity(hudSystem)
  )
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
      if (t.isAsteroid) metaParts.push('sunken hull')
      metaParts.push(`${Math.round(dist)} m`)
      hud.updateTarget({
        name: t.name,
        hostile: !!t.hostile,
        meta: metaParts.join(' · '),
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

  // Berth / sounding / salvage prompts are helm-only — on autopilot
  // you skim past shells so constantly that those toasts just spam the HUD.
  // F priority: wreck → warp gate (2 km) → nodule → dock. Each also requires
  // the object to be Tab-locked — otherwise the prompt would promise an F
  // action that the keydown handler (gated the same way) won't perform.
  const isTargeted = (kind, id) => currentTarget?.kind === kind && currentTarget.id === id
  const nearbyWreckRaw = !cruising ? findNearbyWreck() : null
  const nearbyWreck = nearbyWreckRaw && isTargeted('wreck', nearbyWreckRaw.id) ? nearbyWreckRaw : null
  const currentSysForPrompt = getSystem(gameState.galaxy, gameState.player.currentSystemId)
  const nearbyNoduleRaw =
    !cruising && !nearbyWreck && !probeEffect && !datacoreMinigame?.isOpen?.()
      ? findNearbyDatacoreNodule()
      : null
  const nearbyNodule =
    nearbyNoduleRaw && isTargeted('nodule', nearbyNoduleRaw.nodule.id) ? nearbyNoduleRaw : null
  const nearbyBodyRaw =
    !cruising && !nearbyWreck && !nearbyNodule ? findNearbyDockableBody() : null
  const nearbyBody = nearbyBodyRaw && isTargeted('body', nearbyBodyRaw.id) ? nearbyBodyRaw : null
  wreckPromptEl.style.display = nearbyWreck ? 'block' : 'none'
  if (nearbyWreck) {
    wreckPromptEl.textContent = 'Press F to salvage wreck (or destroy with weapons)'
  }

  dockPromptEl.style.display = nearbyNodule || nearbyBody ? 'block' : 'none'
  if (nearbyNodule) {
    dockPromptEl.textContent = `Press F to hack Datacore nodule (within ${NODULE_PROBE_RANGE}m)`
  } else if (nearbyBody) {
    const dockSys = currentSysForPrompt
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
        probePromptEl.textContent = `Press P to re-sound ${probeLaunch.body.name} (contract) · no additional finds`
      } else {
        probePromptEl.textContent = probeExhaustedMessage(probeLaunch.body.name)
      }
    } else {
      const base = probeLaunch.viaOrbit
        ? `Press P for sonar pulse around ${probeLaunch.body.name}`
        : `Press P for sonar pulse on ${probeLaunch.body.name}`
      probePromptEl.textContent = `${base} · ${left} left`
    }
  }

  if (
    miningToastEl.style.display === 'block' &&
    gameState.simTime > miningToastUntil &&
    !miningToastEl.querySelector('.hud-toast-exit')
  ) {
    hideHudToast(miningToastEl)
  }
  if (
    factionToastEl.style.display === 'block' &&
    gameState.simTime > factionToastUntil &&
    !factionToastEl.querySelector('.hud-toast-exit')
  ) {
    hideHudToast(factionToastEl)
  }
  if (
    probeResultsEl &&
    probeResultsEl.style.display === 'block' &&
    gameState.simTime > probeResultsUntil &&
    !probeResultsEl.querySelector('.hud-toast-exit')
  ) {
    hideHudToast(probeResultsEl)
  }
  if (
    hailResultsEl &&
    hailResultsEl.style.display === 'block' &&
    gameState.simTime > hailResultsUntil &&
    !hailResultsEl.querySelector('.hud-toast-exit')
  ) {
    hideHudToast(hailResultsEl)
  }

  // Dock / probe / wreck / faction / cruise / craft lines sit under ship status.
  updateBelowRadarPrompts()

  updateWaypointIndicator()
  updateCrosshair()
  updateTargetIndicator()
  updateTargetDirectionIndicator()

  // Sea, sky and the sun's shadow box all ride the camera — advance them with
  // the same clock the buoyancy uses, or the water the boat sits on and the
  // water you can see stop being the same surface.
  const day = refreshEnvironment(gameState.simTime)
  _nightLightFactor = nightLightFactorFromDay(day)
  if (playerMesh) updateShipNightLights(playerMesh, _nightLightFactor)
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

// Intro/menu — apply saved sound + UI colour defaults, then title screen.
// Display mode is already applied by the main process on window create.
void Promise.all([loadSoundPreference(), loadUiThemePreference()]).finally(() => {
  startMenuBackground()
  hasSave().then((exists) => menu.show(exists))
})
