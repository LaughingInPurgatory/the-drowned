import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  launchProbe,
  SURVEY_DATA_GOOD_ID,
  canProbeBody,
  recordProbeAttempt,
  isActiveMissionProbeTarget,
  isMissionOnlyReprobe,
  MAX_PROBE_ATTEMPTS,
  PROBE_FIND_CHANCE,
  EXPLORER_PROBE_LOOT_BONUS,
  probeFindChance,
  probeBlueprintChance,
  probeExhaustedMessage,
  probeSurveyReport,
  planetArchetypeForBody
} from './probe.js'
import { PROBE_BLUEPRINT_DROP_CHANCE } from './crafting.js'
import { getShipClass, STARTER_SHIP_CLASS_ID, SHIP_CLASSES } from '../data/shipClasses.js'
import { generateGalaxy, TEST_GALAXY_OPTS } from '../procgen/galaxy.js'

function freshShip() {
  return { cargo: {} }
}

test('a lucky roll finds survey data and stores it in cargo', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const gameState = { player: { ship: freshShip() } }
  // First rng call is blueprint chance (skip with high value); second is survey find.
  let n = 0
  const rng = () => (++n === 1 ? 0.99 : 0)
  const result = launchProbe(gameState, shipClass, rng)
  assert.equal(result.found, true)
  assert.equal(result.stored, true)
  assert.equal(result.blueprint, null)
  assert.equal(gameState.player.ship.cargo[SURVEY_DATA_GOOD_ID], 1)
})

test('an unlucky roll finds nothing and leaves cargo untouched', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const gameState = { player: { ship: freshShip() } }
  // High values miss both rare blueprint and survey rolls.
  const result = launchProbe(gameState, shipClass, () => 0.5)
  assert.equal(result.found, false)
  assert.equal(result.stored, false)
  assert.equal(result.blueprint, null)
  assert.deepEqual(gameState.player.ship.cargo, {})
})

test('a find is lost if the cargo hold is already full', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const gameState = { player: { ship: { cargo: { ore: shipClass.stats.cargoCapacity } } } }
  let n = 0
  const rng = () => (++n === 1 ? 0.99 : 0)
  const result = launchProbe(gameState, shipClass, rng)
  assert.equal(result.found, true)
  assert.equal(result.stored, false)
  assert.equal(gameState.player.ship.cargo[SURVEY_DATA_GOOD_ID], undefined)
})

test('each body can be probed at most MAX_PROBE_ATTEMPTS times', () => {
  const gameState = { probeCounts: {} }
  assert.equal(canProbeBody(gameState, 'body-1'), true)
  for (let i = 0; i < MAX_PROBE_ATTEMPTS; i++) recordProbeAttempt(gameState, 'body-1')
  assert.equal(gameState.probeCounts['body-1'], MAX_PROBE_ATTEMPTS)
  assert.equal(canProbeBody(gameState, 'body-1'), false)
  assert.equal(canProbeBody(gameState, 'body-2'), true)
  assert.match(probeExhaustedMessage('Nyxara'), /Nyxara fully scanned/)
  assert.match(probeExhaustedMessage(''), /Target fully scanned/)
})

test('forceFind always yields a survey-data find when cargo has room', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const gameState = { player: { ship: freshShip() } }
  // Unlucky rng would normally miss — forceFind overrides for mission first probe.
  const result = launchProbe(gameState, shipClass, () => 0.99, { forceFind: true })
  assert.equal(result.found, true)
  assert.equal(result.stored, true)
})

test('explorer ships get a base +5% survey-data find chance and +5% blueprint odds', () => {
  const explorer = SHIP_CLASSES.find((c) => c.role === 'explorer')
  assert.ok(explorer, 'need at least one explorer hull in catalog')
  const fighter = SHIP_CLASSES.find((c) => c.role !== 'explorer') ?? getShipClass(STARTER_SHIP_CLASS_ID)

  assert.equal(probeFindChance(fighter), PROBE_FIND_CHANCE)
  assert.equal(probeFindChance(explorer), PROBE_FIND_CHANCE + EXPLORER_PROBE_LOOT_BONUS)
  assert.ok(
    Math.abs(probeBlueprintChance(explorer) - PROBE_BLUEPRINT_DROP_CHANCE * 1.05) < 1e-9
  )
  assert.equal(probeBlueprintChance(fighter), PROBE_BLUEPRINT_DROP_CHANCE)

  // Roll just above base chance but within explorer bonus → explorer finds, non-explorer misses.
  const edge = PROBE_FIND_CHANCE + EXPLORER_PROBE_LOOT_BONUS / 2
  const gameExplorer = { player: { ship: freshShip() } }
  const gameOther = { player: { ship: freshShip() } }
  // First rng = blueprint miss; second = survey roll
  const makeRng = (surveyRoll) => {
    let n = 0
    return () => (++n === 1 ? 0.99 : surveyRoll)
  }
  assert.equal(launchProbe(gameExplorer, explorer, makeRng(edge)).found, true)
  assert.equal(launchProbe(gameOther, fighter, makeRng(edge)).found, false)
})

test('isActiveMissionProbeTarget detects open probe and investigation targets', () => {
  const gameState = {
    missions: {
      active: [
        { type: 'probe', objectiveComplete: false, target: { bodyId: 'a' } },
        { type: 'investigation', objectiveComplete: false, target: { kind: 'body', bodyId: 'b' } },
        { type: 'probe', objectiveComplete: true, target: { bodyId: 'c' } }
      ]
    }
  }
  assert.equal(isActiveMissionProbeTarget(gameState, 'a'), true)
  assert.equal(isActiveMissionProbeTarget(gameState, 'b'), true)
  assert.equal(isActiveMissionProbeTarget(gameState, 'c'), false)
  assert.equal(isActiveMissionProbeTarget(gameState, 'x'), false)
})

test('fully probed body allows one mission re-probe without raising count or loot', () => {
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  const gameState = {
    probeCounts: { 'body-1': MAX_PROBE_ATTEMPTS },
    missions: {
      active: [{ type: 'probe', objectiveComplete: false, target: { bodyId: 'body-1' } }]
    },
    player: { ship: freshShip() }
  }

  assert.equal(canProbeBody(gameState, 'body-1'), true)
  assert.equal(isMissionOnlyReprobe(gameState, 'body-1'), true)

  // Re-probe does not consume another slot — count stays exhausted.
  const n = recordProbeAttempt(gameState, 'body-1')
  assert.equal(n, MAX_PROBE_ATTEMPTS)
  assert.equal(gameState.probeCounts['body-1'], MAX_PROBE_ATTEMPTS)

  // Lucky rng would normally yield survey data + rare rolls; noLoot suppresses all.
  const result = launchProbe(gameState, shipClass, () => 0, { forceFind: true, noLoot: true })
  assert.equal(result.found, false)
  assert.equal(result.stored, false)
  assert.equal(result.blueprint, null)
  assert.equal(result.skillbook, null)
  assert.deepEqual(gameState.player.ship.cargo, {})
})

test('fully probed body without an open mission cannot be re-probed', () => {
  const gameState = {
    probeCounts: { 'body-1': MAX_PROBE_ATTEMPTS },
    missions: { active: [] }
  }
  assert.equal(canProbeBody(gameState, 'body-1'), false)
  assert.equal(isMissionOnlyReprobe(gameState, 'body-1'), false)
  // record still no-ops at max even without a mission
  assert.equal(recordProbeAttempt(gameState, 'body-1'), MAX_PROBE_ATTEMPTS)
  assert.equal(gameState.probeCounts['body-1'], MAX_PROBE_ATTEMPTS)
})

test('mission re-probe is blocked once the probe contract is complete', () => {
  const gameState = {
    probeCounts: { 'body-1': MAX_PROBE_ATTEMPTS },
    missions: {
      active: [{ type: 'probe', objectiveComplete: true, target: { bodyId: 'body-1' } }]
    }
  }
  assert.equal(isActiveMissionProbeTarget(gameState, 'body-1'), false)
  assert.equal(canProbeBody(gameState, 'body-1'), false)
  assert.equal(isMissionOnlyReprobe(gameState, 'body-1'), false)
})

test('probeSurveyReport classifies planets, moons, stars, and asteroid fields', () => {
  const galaxy = generateGalaxy(42, TEST_GALAXY_OPTS)
  const system = galaxy.systems.find((s) => s.bodies.some((b) => b.kind === 'planet')) ?? galaxy.systems[0]
  const planet = system.bodies.find((b) => b.kind === 'planet')
  const moon = system.bodies.find((b) => b.kind === 'moon')
  const field = galaxy.systems.flatMap((s) => s.bodies).find((b) => b.kind === 'asteroidField')

  const planetLines = probeSurveyReport(planet, system)
  assert.ok(planetLines.some((l) => /Body type: Planet/.test(l)))
  assert.ok(planetLines.some((l) => /Atmosphere:/.test(l)))
  assert.ok(planetLines.some((l) => /Life:|Flora|Fauna|biosignatures/i.test(l)))
  assert.equal(planetArchetypeForBody(planet), planetArchetypeForBody(planet))

  if (moon) {
    const moonLines = probeSurveyReport(moon, system)
    assert.ok(moonLines.some((l) => /Moon/.test(l)))
    assert.equal(planetArchetypeForBody(moon), 'rocky')
  }

  const starLines = probeSurveyReport(
    { id: `${system.id}:star`, name: system.name, kind: 'star' },
    system
  )
  assert.ok(starLines.some((l) => /Star/.test(l)))

  if (field) {
    const fieldSys = galaxy.systems.find((s) => s.bodies.includes(field))
    const fieldLines = probeSurveyReport(field, fieldSys)
    assert.ok(fieldLines.some((l) => /Asteroid/.test(l)))
    assert.ok(fieldLines.some((l) => /Ore survey:/.test(l)))
  }
})
