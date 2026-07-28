import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ensureSystemAnomalies,
  computeProbeSignal,
  updateSystemScan,
  systemScanBonuses,
  resolveDatacoreHack,
  rollSiteLoot,
  tickGalaxyAnomalies,
  anomalyEpochAt,
  isDatacoreType,
  rareOreTierForSystem,
  SITE_BLUEPRINT_CHANCE,
  SITE_SKILLBOOK_CHANCE,
  SYSTEM_SCAN_PROBE_COUNT,
  ANOMALY_REFRESH_INTERVAL_S
} from './systemScan.js'
import { oreTierForField } from './mining.js'
import { MINED_ORE_GOOD_IDS } from '../data/goods.js'

function fakeSystem(id = 'sys-test', securityRating = 1) {
  // galaxyPosition: ore_anomaly sites roll a rarer ore tier via coreFraction(system),
  // which reads this — real galaxy systems always have it.
  return { id, securityRating, spatialAnomalies: undefined, bodies: [], galaxyPosition: [0, 0, 0] }
}

test('anomaly epoch change re-rolls presence and type (not like-for-like)', () => {
  const s = fakeSystem('sys-reshuffle', 0)
  const a0 = ensureSystemAnomalies(s, 0)
  // Force wipe as tickGalaxyAnomalies does.
  delete s.spatialAnomalies
  delete s.anomalyEpoch
  const a1 = ensureSystemAnomalies(s, 1)
  // Either list can be empty; if both non-empty, types may differ — seed changes with epoch.
  assert.ok(Array.isArray(a0) && Array.isArray(a1))
  // Deterministic: same epoch returns same list.
  const again = ensureSystemAnomalies(s, 1)
  assert.equal(again, s.spatialAnomalies)
  assert.deepEqual(
    again.map((x) => x.type),
    a1.map((x) => x.type)
  )
})

test('ensureSystemAnomalies is idempotent and rolls 0 or 1–4 sites', () => {
  let any = false
  for (let i = 0; i < 40; i++) {
    const s = fakeSystem(`sys-${i}`, i % 7)
    const a = ensureSystemAnomalies(s)
    assert.ok(Array.isArray(a))
    assert.ok(a.length === 0 || (a.length >= 1 && a.length <= 4))
    if (a.length) any = true
    // second call same reference
    assert.equal(ensureSystemAnomalies(s), s.spatialAnomalies)
  }
  assert.ok(any, 'at least one system in sample should have anomalies')
})

test('all 5 anomaly types roll across a large sample, each shaped per spec', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) {
    const s = fakeSystem(`sys-type-${i}`, i % 7)
    for (const a of ensureSystemAnomalies(s, i)) {
      seen.add(a.type)
      if (a.type === 'datacore_takeover' || a.type === 'alien_datacore') {
        assert.ok(a.nodules.length >= 3 && a.nodules.length <= 8, `${a.type} nodules ${a.nodules.length}`)
        assert.equal(a.guardFaction, a.type === 'alien_datacore' ? 'alien' : 'pirate')
      }
      if (a.type === 'ore_anomaly') {
        assert.equal(typeof a.ambush, 'boolean')
        const field = s.bodies.find((b) => b.id === a.oreFieldId)
        assert.ok(field, 'ore_anomaly should register a synthetic asteroidField body')
        assert.equal(field.kind, 'wreckField')
        assert.equal(field.anomalySiteId, a.id)
        assert.ok(field.rockCount >= 6 && field.rockCount <= 15, `rockCount ${field.rockCount}`)
        assert.equal(field.oreOverride, rareOreTierForSystem(s))
      }
    }
  }
  assert.deepEqual(
    [...seen].sort(),
    ['alien_datacore', 'alien_incursion', 'datacore', 'datacore_takeover', 'ore_anomaly'].sort()
  )
})

test('a rich patch grades one better than the water around it, capped at the top', () => {
  const homeWaters = { id: 'site-home', kind: 'wreckField', position: [0, 0, 0] }
  const base = MINED_ORE_GOOD_IDS.indexOf(oreTierForField(homeWaters))
  const rare = MINED_ORE_GOOD_IDS.indexOf(rareOreTierForSystem(homeWaters))
  assert.equal(rare, Math.min(MINED_ORE_GOOD_IDS.length - 1, base + 1))

  // Already the best grade the sea offers — a rich patch cannot beat the cap.
  const deep = { id: 'site-deep', kind: 'wreckField', position: [1e9, 0, 1e9] }
  assert.equal(rareOreTierForSystem(deep), MINED_ORE_GOOD_IDS[MINED_ORE_GOOD_IDS.length - 1])
})

test('tickGalaxyAnomalies also sweeps synthetic ore_anomaly bodies on reshuffle', () => {
  const galaxy = { anomalyEpoch: 0, systems: [fakeSystem('sys-sweep', 0)] }
  const system = galaxy.systems[0]
  // Force an ore_anomaly onto this system regardless of the presence roll.
  let anomalies = []
  for (let epoch = 0; epoch < 50 && !anomalies.some((a) => a.type === 'ore_anomaly'); epoch++) {
    delete system.spatialAnomalies
    delete system.anomalyEpoch
    system.bodies = []
    anomalies = ensureSystemAnomalies(system, epoch)
  }
  const oreSite = anomalies.find((a) => a.type === 'ore_anomaly')
  assert.ok(oreSite, 'expected to roll an ore_anomaly within 50 epochs')
  assert.ok(system.bodies.some((b) => b.anomalySiteId === oreSite.id))

  const { refreshed } = tickGalaxyAnomalies(galaxy, ANOMALY_REFRESH_INTERVAL_S)
  assert.ok(refreshed)
  assert.ok(!system.bodies.some((b) => b.anomalySiteId), 'synthetic ore body should be swept on reshuffle')
})

test('isDatacoreType covers all three datacore-family types only', () => {
  assert.ok(isDatacoreType('datacore'))
  assert.ok(isDatacoreType('datacore_takeover'))
  assert.ok(isDatacoreType('alien_datacore'))
  assert.ok(!isDatacoreType('alien_incursion'))
  assert.ok(!isDatacoreType('ore_anomaly'))
})

test('probe signal rises when probes are near the anomaly', () => {
  const s = fakeSystem('sys-sig', 0)
  s.spatialAnomalies = [
    {
      id: 'a1',
      type: 'datacore',
      position: [10000, 0, 0],
      signal: 0,
      scanProgress: 0,
      fullyScanned: false,
      status: 'hidden'
    }
  ]
  const far = Array.from({ length: SYSTEM_SCAN_PROBE_COUNT }, (_, i) => ({
    active: true,
    position: [200000 + i * 100, 0, 0]
  }))
  const near = Array.from({ length: SYSTEM_SCAN_PROBE_COUNT }, (_, i) => {
    const a = (i / 4) * Math.PI * 2
    return {
      active: true,
      position: [10000 + Math.cos(a) * 2000, 0, Math.sin(a) * 2000]
    }
  })
  assert.ok(computeProbeSignal(s.spatialAnomalies[0], near) > computeProbeSignal(s.spatialAnomalies[0], far))
})

test('explorer ships get scan speed and signal bonuses', () => {
  assert.equal(systemScanBonuses({ role: 'fighter' }).scanSpeed, 1)
  assert.ok(systemScanBonuses({ role: 'explorer' }).scanSpeed > 1)
  assert.ok(systemScanBonuses({ role: 'explorer' }).signalBonus > 0)
})

test('updateSystemScan can fully lock a nearby anomaly', () => {
  const s = fakeSystem('sys-lock', 0)
  s.spatialAnomalies = [
    {
      id: 'a1',
      type: 'alien_incursion',
      position: [5000, 0, 0],
      signal: 0,
      scanProgress: 0,
      fullyScanned: false,
      status: 'hidden',
      displayName: 'Anomalous Signal'
    }
  ]
  const probes = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI * 2
    return { active: true, position: [5000 + Math.cos(a) * 1500, 0, Math.sin(a) * 1500] }
  })
  let done = []
  for (let i = 0; i < 200; i++) {
    const r = updateSystemScan(s, probes, { role: 'explorer' }, 0.25)
    done = done.concat(r.fullyScanned)
    if (s.spatialAnomalies[0].fullyScanned) break
  }
  assert.equal(s.spatialAnomalies[0].fullyScanned, true)
  assert.equal(s.spatialAnomalies[0].displayName, 'Drowned Incursion')
  assert.ok(done.length >= 1)
})

test('datacore hack minigame resolves by cursor window', () => {
  assert.equal(resolveDatacoreHack(0.5, 0.5, 0.12).success, true)
  assert.equal(resolveDatacoreHack(0.9, 0.5, 0.12).success, false)
})

test('site loot always has cargo; rare BP/skillbook chances are very small', () => {
  assert.ok(SITE_BLUEPRINT_CHANCE > 0 && SITE_BLUEPRINT_CHANCE < 0.05)
  assert.ok(SITE_SKILLBOOK_CHANCE > 0 && SITE_SKILLBOOK_CHANCE < 0.05)
  // High rng misses rare rolls but still yields trade goods.
  const loot = rollSiteLoot(() => 0.99, { valuableChance: 0, gameState: null })
  assert.ok(Object.keys(loot.cargo ?? {}).length > 0)
  assert.equal(loot.blueprints, undefined)
  assert.equal(loot.skillbooks, undefined)
})

test('anomaly epoch advances every 4 hours of simTime', () => {
  assert.equal(anomalyEpochAt(0), 0)
  assert.equal(anomalyEpochAt(ANOMALY_REFRESH_INTERVAL_S - 1), 0)
  assert.equal(anomalyEpochAt(ANOMALY_REFRESH_INTERVAL_S), 1)
  assert.equal(anomalyEpochAt(ANOMALY_REFRESH_INTERVAL_S * 2.5), 2)
})

test('tickGalaxyAnomalies reshuffles systems when the 4h window rolls', () => {
  const s = fakeSystem('sys-refresh', 0)
  const galaxy = { systems: [s] }
  // First touch initializes without wipe
  const init = tickGalaxyAnomalies(galaxy, 100)
  assert.equal(init.refreshed, false)
  assert.equal(galaxy.anomalyEpoch, 0)
  const a1 = ensureSystemAnomalies(s, galaxy)
  assert.ok(Array.isArray(a1))
  const snapshot = JSON.stringify(s.spatialAnomalies)

  // Still same window — no refresh
  assert.equal(tickGalaxyAnomalies(galaxy, ANOMALY_REFRESH_INTERVAL_S - 10).refreshed, false)
  assert.equal(JSON.stringify(s.spatialAnomalies), snapshot)

  // Cross the 4h boundary — sites cleared for re-roll
  const rolled = tickGalaxyAnomalies(galaxy, ANOMALY_REFRESH_INTERVAL_S + 5)
  assert.equal(rolled.refreshed, true)
  assert.equal(galaxy.anomalyEpoch, 1)
  assert.equal(s.spatialAnomalies, undefined)

  const a2 = ensureSystemAnomalies(s, galaxy)
  assert.ok(Array.isArray(a2))
  assert.equal(s.anomalyEpoch, 1)
  // New epoch uses a different seed; same system may or may not have sites,
  // but the roll is independent of the previous array reference.
  assert.notEqual(s.spatialAnomalies, a1)
})
