import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SKILLS,
  MAX_SKILL_LEVEL,
  WRECK_SKILLBOOK_CHANCE,
  PROBE_SKILLBOOK_CHANCE,
  ensureSkills,
  useSkillbook,
  addSkillbook,
  tryRollSkillbookDrop,
  playerSkillBonuses,
  tradingBuyMult,
  tradingSellMult,
  industryCostMult,
  weaponSkillDamageMult,
  manoeuvringMult,
  thrustSpeedMult,
  thrustCruiseMult,
  droneSkillMult,
  scaleOreCost
} from './skills.js'
import { emptySkills } from '../data/skills.js'

function mockState(skills = {}) {
  return {
    player: {
      skills: { ...emptySkills(), ...skills },
      ship: { skillbooks: {}, classId: 'light_runner' }
    }
  }
}

test('skill constants and catalog', () => {
  assert.equal(MAX_SKILL_LEVEL, 20)
  assert.equal(WRECK_SKILLBOOK_CHANCE, 0.005)
  assert.equal(PROBE_SKILLBOOK_CHANCE, 0.0005)
  // 9, not 8: cloning (clone bay capacity + jumps) is a real, wired-up skill
  // (game/clones.js, ui/dockingUI.js) — this count just hadn't been bumped
  // when it was added to the catalog.
  assert.equal(SKILLS.length, 9)
})

test('alien wrecks use base + 1% skillbook chance', async () => {
  const { ALIEN_WRECK_SKILLBOOK_BONUS, tryRollWreckSkillbook } = await import('./skills.js')
  assert.equal(ALIEN_WRECK_SKILLBOOK_BONUS, 0.01)
  const gs = mockState()
  // Human wreck: chance 0.5% — roll 0.006 should miss
  assert.equal(tryRollWreckSkillbook(() => 0.006, gs, false), null)
  // Alien wreck: chance 1.5% — same roll should hit, then pick skill
  let n = 0
  const rng = () => (n++ === 0 ? 0.006 : 0)
  assert.ok(tryRollWreckSkillbook(rng, gs, true))
})

test('bonus formulas at level 0 and 20', () => {
  assert.equal(tradingBuyMult(0), 1)
  assert.equal(tradingBuyMult(20), 0.8)
  assert.equal(tradingSellMult(20), 1.2)
  assert.equal(industryCostMult(20), 0.6)
  assert.equal(weaponSkillDamageMult(10), 1.2)
  assert.equal(manoeuvringMult(5), 1.1)
  assert.equal(thrustSpeedMult(4), 1.2)
  assert.equal(thrustCruiseMult(5), 1.2)
  assert.equal(droneSkillMult(10), 1.1)
})

test('useSkillbook trains until max and consumes books', () => {
  const gs = mockState()
  addSkillbook(gs, 'gunnery', 3)
  assert.equal(useSkillbook(gs, 'gunnery').ok, true)
  assert.equal(gs.player.skills.gunnery, 1)
  assert.equal(gs.player.ship.skillbooks.gunnery, 2)
  gs.player.skills.gunnery = 20
  addSkillbook(gs, 'gunnery', 1)
  const r = useSkillbook(gs, 'gunnery')
  assert.equal(r.ok, false)
  assert.match(r.reason, /maximum/i)
})

test('skillbook drops skip maxed skills', () => {
  const gs = mockState()
  // Max every skill except trading
  for (const s of SKILLS) {
    if (s.id !== 'trading') gs.player.skills[s.id] = 20
  }
  ensureSkills(gs)
  // Always succeed the chance roll; only trading remains.
  let i = 0
  const rng = () => {
    // first call = chance (0), second = pick index
    return i++ === 0 ? 0 : 0.5
  }
  const id = tryRollSkillbookDrop(rng, gs, 1)
  assert.equal(id, 'trading')

  gs.player.skills.trading = 20
  assert.equal(tryRollSkillbookDrop(() => 0, gs, 1), null)
})

test('playerSkillBonuses reflects levels', () => {
  const gs = mockState({ gunnery: 5, trading: 10, thrust: 2 })
  const b = playerSkillBonuses(gs)
  assert.equal(b.gunneryMult, 1.1)
  assert.ok(Math.abs(b.buyMult - 0.9) < 1e-9)
  assert.equal(b.speedMult, 1.1)
  assert.ok(Math.abs(b.cruiseMult - 1.08) < 1e-9)
})

test('scaleOreCost applies industry mult', () => {
  const cost = scaleOreCost({ raw_ore: 100, rich_ore: 10 }, 0.5)
  assert.equal(cost.raw_ore, 50)
  assert.equal(cost.rich_ore, 5)
})
