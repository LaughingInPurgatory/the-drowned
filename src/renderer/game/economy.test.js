import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getPrice, getMarketAvailable, defaultMarketStock, buyGood, sellGood, sellMinedOre, buyMinedOre, purchaseShip, repairCost, repairShip,
  activateStoredShip, sellStoredShip, storeCargo, retrieveCargo, useShipPart,
  renameActiveShip, renameStoredShip, buyWeapon, sellStoredWeapon, equipWeapon,
  buyAccessory, sellStoredAccessory, equipAccessory, transferStorageItem,
  playerAssetBodyIds, storageHasAssets
} from './economy.js'
import { STARTER_SHIP_CLASS_ID, getShipClass } from '../data/shipClasses.js'
import { BASE_WEAPON_ID } from '../data/weapons.js'
import { defaultAccessoriesFor } from '../data/accessories.js'

function makeGameState() {
  return {
    player: {
      credits: 1000,
      ship: {
        classId: STARTER_SHIP_CLASS_ID,
        cargo: {},
        miningHold: {},
        shipParts: 0,
        equippedAccessories: defaultAccessoriesFor(getShipClass(STARTER_SHIP_CLASS_ID)),
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1]
      }
    },
    // One sea. Home waters at the centre, the deep out at the world's edge —
    // remoteness (procgen/world.js) reads straight off these positions.
    galaxy: {
      systems: [
        {
          id: 'sea-0',
          bodies: [
            { id: 'agri-world', kind: 'port', position: [0, 0, 0], economyTags: ['agricultural'] },
            { id: 'industrial-world', kind: 'port', position: [200, 0, 0], economyTags: ['industrial'] },
            { id: 'rim-station', kind: 'port', position: [1e6, 0, 0], economyTags: ['frontier', 'mining'] }
          ]
        }
      ]
    },
    economyOverrides: {},
    marketStock: {},
    stationStorage: {}
  }
}

test('the same good is cheaper where its tag matches a discount multiplier', () => {
  const gameState = makeGameState()
  const agriPrice = getPrice(gameState, 'agri-world', 'grain')
  const industrialPrice = getPrice(gameState, 'industrial-world', 'grain')
  assert.ok(agriPrice < industrialPrice, 'grain should be cheaper on an agricultural world than an industrial one')
})

test('buying and selling both use station storage, not ship cargo', () => {
  const gameState = makeGameState()
  const startCredits = gameState.player.credits
  const beforeAvail = getMarketAvailable(gameState, 'agri-world', 'grain')
  buyGood(gameState, 'agri-world', 'grain', 5)
  assert.equal(gameState.player.ship.cargo.grain, undefined, 'purchases do not go to ship cargo')
  assert.equal(gameState.stationStorage['agri-world'].cargo.grain, 5)
  assert.equal(getMarketAvailable(gameState, 'agri-world', 'grain'), beforeAvail - 5)
  assert.ok(gameState.player.credits < startCredits)

  sellGood(gameState, 'agri-world', 'grain', 5)
  assert.equal(gameState.stationStorage['agri-world'].cargo.grain, undefined)
  assert.equal(gameState.player.ship.cargo.grain, undefined)
  assert.equal(getMarketAvailable(gameState, 'agri-world', 'grain'), beforeAvail, 'selling restocks the bay')
})

test('buyGood rejects purchases beyond credits or bay stock', () => {
  const gameState = makeGameState()
  assert.throws(() => buyGood(gameState, 'agri-world', 'grain', 100000))
  gameState.player.credits = 0
  assert.throws(() => buyGood(gameState, 'agri-world', 'grain', 1))
})

test('selling ore raises market available; buying ore consumes it', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000
  gameState.stationStorage['agri-world'] = {
    cargo: {}, miningHold: { raw_ore: 4 }, shipParts: 0, ships: [], weapons: {}, accessories: {}, blueprints: {}
  }
  const before = getMarketAvailable(gameState, 'agri-world', 'raw_ore')
  sellMinedOre(gameState, 'agri-world', 'raw_ore', 4)
  assert.equal(getMarketAvailable(gameState, 'agri-world', 'raw_ore'), before + 4)
  buyMinedOre(gameState, 'agri-world', 'raw_ore', 2)
  assert.equal(getMarketAvailable(gameState, 'agri-world', 'raw_ore'), before + 2)
  assert.equal(gameState.stationStorage['agri-world'].miningHold.raw_ore, 2)
})

test('home waters are awash with scrap and short of the good stuff; the deep reverses', () => {
  const homePort = { id: 'c', kind: 'port', position: [0, 0, 0], economyTags: [] }
  const deepPort = { id: 'r', kind: 'port', position: [1e6, 0, 0], economyTags: [] }

  const homeRaw = defaultMarketStock(homePort, 'raw_ore')
  const homeQuantum = defaultMarketStock(homePort, 'quantum_ore')
  const deepRaw = defaultMarketStock(deepPort, 'raw_ore')
  const deepQuantum = defaultMarketStock(deepPort, 'quantum_ore')

  assert.ok(homeRaw > homeQuantum * 5, 'home: scrap shelves much deeper than pre-war cores')
  assert.ok(deepQuantum > deepRaw, 'the deep: rare salvage more available than scrap')
  assert.ok(homeRaw > deepRaw, 'home has more scrap than the deep')
  assert.ok(deepQuantum > homeQuantum, 'the deep has more pre-war cores than home')
})

test('rare salvage is ~20% cheaper out in the deep; scrap stays cheap', () => {
  const gameState = makeGameState()
  const coreQuantum = getPrice(gameState, 'agri-world', 'quantum_ore')
  const rimQuantum = getPrice(gameState, 'rim-station', 'quantum_ore')
  assert.ok(
    rimQuantum <= Math.round(coreQuantum * 0.85),
    `deep-water cores should be ~20% cheaper (home ${coreQuantum}, deep ${rimQuantum})`
  )

  const coreRaw = getPrice(gameState, 'agri-world', 'raw_ore')
  const rimRaw = getPrice(gameState, 'rim-station', 'raw_ore')
  // Scrap must not become valuable just because it is a long way out.
  assert.ok(rimRaw <= coreRaw * 1.15, `deep scrap should stay cheap (home ${coreRaw}, deep ${rimRaw})`)
})

test('goods in demand cost more; thin stock raises price further', () => {
  const gameState = makeGameState()
  // industrial demand for grain (tag +0.3) vs agricultural supply (−0.5)
  const demandPrice = getPrice(gameState, 'industrial-world', 'grain')
  const supplyPrice = getPrice(gameState, 'agri-world', 'grain')
  assert.ok(demandPrice > supplyPrice)

  // Drain stock at industrial bay → scarcity premium
  const before = getPrice(gameState, 'industrial-world', 'grain')
  const avail = getMarketAvailable(gameState, 'industrial-world', 'grain')
  gameState.marketStock['industrial-world'].grain = 0
  const after = getPrice(gameState, 'industrial-world', 'grain')
  assert.ok(after > before, `empty shelves raise price (${before} → ${after}, was ${avail} stock)`)
})

test('purchaseShip stores the new ship at that station rather than making it active', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000
  purchaseShip(gameState, 'agri-world', 'light_runner', 'Wanderer')
  assert.equal(gameState.player.ship.classId, STARTER_SHIP_CLASS_ID, 'buying alone should not swap the active ship')
  assert.ok(gameState.player.credits < 50000)
  const stored = gameState.stationStorage['agri-world'].ships
  assert.equal(stored.length, 1)
  assert.equal(stored[0].classId, 'light_runner')
  assert.equal(stored[0].instanceName, 'Wanderer')
})

test('activateStoredShip swaps the active ship with one in storage, and sellStoredShip removes it for credits', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000
  purchaseShip(gameState, 'agri-world', 'light_runner', 'Wanderer')

  activateStoredShip(gameState, 'agri-world', 0)
  assert.equal(gameState.player.ship.classId, 'light_runner', 'the stored ship should now be active')
  const stored = gameState.stationStorage['agri-world'].ships
  assert.equal(stored.length, 1)
  assert.equal(stored[0].classId, STARTER_SHIP_CLASS_ID, 'the old active ship should now be the one in storage')

  const creditsBeforeSale = gameState.player.credits
  sellStoredShip(gameState, 'agri-world', 0)
  assert.equal(gameState.stationStorage['agri-world'].ships.length, 0)
  assert.ok(gameState.player.credits > creditsBeforeSale, 'selling a stored ship should pay out credits')
})

test('unequipping Extra Launcher returns fitted missile weapon to station storage', () => {
  const gameState = makeGameState()
  gameState.player.credits = 200000
  // Laser-only starter + launcher accessory → can fit a missile.
  const ship = gameState.player.ship
  ship.equippedAccessories = [null]
  // Pad slots if needed.
  const slots = ship.equippedAccessories.length || 1
  ship.equippedAccessories = Array(slots).fill(null)
  gameState.stationStorage['agri-world'] ??= {
    cargo: {}, miningHold: {}, shipParts: 0, ships: [], weapons: {}, accessories: {}, blueprints: {}, drones: {}
  }
  const st = gameState.stationStorage['agri-world']
  st.accessories.extra_launcher_hardpoint = 1
  st.weapons.rocket_pod = 0
  equipAccessory(gameState, 'agri-world', 0, 'extra_launcher_hardpoint')
  assert.equal(ship.equippedWeapons.acc_launcher, undefined, 'accessory mount has no free weapon')
  // Fit a missile, then remove accessory — weapon returns to storage.
  ship.equippedWeapons.acc_launcher = 'torpedo'
  equipAccessory(gameState, 'agri-world', 0, null)
  assert.equal(ship.equippedWeapons.acc_launcher, undefined, 'hardpoint removed with accessory')
  assert.ok((st.weapons.torpedo ?? 0) >= 1, 'weapon returned to station storage')
  assert.ok((st.accessories.extra_launcher_hardpoint ?? 0) >= 1, 'accessory back in storage')
})

test('sellStoredShip moves fitted upgrades into station storage', () => {
  const gameState = makeGameState()
  gameState.player.credits = 200000
  purchaseShip(gameState, 'agri-world', 'light_runner', 'Fitted')
  const stored = gameState.stationStorage['agri-world'].ships[0]
  stored.equippedWeapons = { fwd1: 'beam_laser' }
  stored.equippedAccessories = ['cargo_upgrade']
  stored.drones = [{ typeId: 'stinger_light', bayIndex: 0 }]
  stored.spareWeapons = { rapid_laser: 1 }
  sellStoredShip(gameState, 'agri-world', 0)
  const st = gameState.stationStorage['agri-world']
  assert.equal(st.ships.length, 0)
  assert.ok((st.weapons.beam_laser ?? 0) >= 1, 'equipped weapon returned to storage')
  assert.ok((st.weapons.rapid_laser ?? 0) >= 1, 'spare weapon returned to storage')
  assert.ok((st.accessories.cargo_upgrade ?? 0) >= 1, 'accessory returned to storage')
  assert.ok((st.drones.stinger_light ?? 0) >= 1, 'drone returned to storage')
})

test('storeCargo/retrieveCargo round-trip cargo through per-station storage', () => {
  const gameState = makeGameState()
  gameState.player.ship.cargo = { grain: 5 }
  storeCargo(gameState, 'agri-world')
  assert.deepEqual(gameState.player.ship.cargo, {}, 'cargo should leave the ship once stored')
  assert.equal(gameState.stationStorage['agri-world'].cargo.grain, 5)

  retrieveCargo(gameState, 'agri-world')
  assert.equal(gameState.player.ship.cargo.grain, 5)
  assert.deepEqual(gameState.stationStorage['agri-world'].cargo, {}, 'storage should be emptied once retrieved')
})

test('renameActiveShip and renameStoredShip rename ships (and reject blank names)', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000
  purchaseShip(gameState, 'agri-world', 'light_runner', 'Mudlark')

  renameActiveShip(gameState, '  Nova Runner  ')
  assert.equal(gameState.player.ship.instanceName, 'Nova Runner', 'should trim whitespace')
  assert.throws(() => renameActiveShip(gameState, '   '), /cannot be empty/)

  renameStoredShip(gameState, 'agri-world', 0, 'Backup Ship')
  assert.equal(gameState.stationStorage['agri-world'].ships[0].instanceName, 'Backup Ship')
  assert.throws(() => renameStoredShip(gameState, 'agri-world', 5, 'X'), /No such stored ship/)
})

test('useShipPart heals 10% of max hull/armor and consumes one part', () => {
  const gameState = makeGameState()
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  gameState.player.ship.hull = 0
  gameState.player.ship.armor = 0
  gameState.player.ship.shipParts = 2

  useShipPart(gameState)
  assert.ok(Math.abs(gameState.player.ship.hull - shipClass.stats.hull * 0.1) < 1e-6)
  assert.ok(Math.abs(gameState.player.ship.armor - shipClass.stats.armor * 0.1) < 1e-6)
  assert.equal(gameState.player.ship.shipParts, 1)

  gameState.player.ship.shipParts = 0
  assert.throws(() => useShipPart(gameState), /No ship parts/)
})

test('useShipPart does not consume a part when already at full hull and armour', () => {
  const gameState = makeGameState()
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  gameState.player.ship.shipParts = 3
  gameState.player.ship.hull = shipClass.stats.hull
  gameState.player.ship.armor = shipClass.stats.armor
  assert.throws(() => useShipPart(gameState), /No repair needed/)
  assert.equal(gameState.player.ship.shipParts, 3)
})

test('repairCost is zero for a fully-healthy ship and positive for a damaged one', () => {
  const gameState = makeGameState()
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  gameState.player.ship.hull = shipClass.stats.hull
  gameState.player.ship.armor = shipClass.stats.armor
  assert.equal(repairCost(gameState), 0)

  gameState.player.ship.hull = shipClass.stats.hull - 10
  gameState.player.ship.armor = shipClass.stats.armor - 2
  assert.ok(repairCost(gameState) > 0)
})

test('repairShip restores hull/armor to max and deducts credits; throws if already full or unaffordable', () => {
  const gameState = makeGameState()
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID)
  gameState.player.ship.hull = shipClass.stats.hull - 20
  gameState.player.ship.armor = shipClass.stats.armor - 5
  gameState.player.credits = 1000

  const cost = repairCost(gameState)
  repairShip(gameState)
  assert.equal(gameState.player.ship.hull, shipClass.stats.hull)
  assert.equal(gameState.player.ship.armor, shipClass.stats.armor)
  assert.equal(gameState.player.credits, 1000 - cost)

  assert.throws(() => repairShip(gameState), /already fully repaired/)

  gameState.player.ship.hull -= 50
  gameState.player.credits = 0
  assert.throws(() => repairShip(gameState), /Not enough credits/)
})

test('sellMinedOre pays out from station ore storage, not the ship mining hold', () => {
  const gameState = makeGameState()
  gameState.player.ship.miningHold.raw_ore = 5
  gameState.stationStorage['agri-world'] = {
    cargo: {}, miningHold: { raw_ore: 5 }, shipParts: 0, ships: [], weapons: {}, accessories: {}, blueprints: {}
  }
  const startCredits = gameState.player.credits

  sellMinedOre(gameState, 'agri-world', 'raw_ore', 3)
  assert.equal(gameState.stationStorage['agri-world'].miningHold.raw_ore, 2)
  assert.equal(gameState.player.ship.miningHold.raw_ore, 5, 'ship hold untouched')
  assert.ok(gameState.player.credits > startCredits)

  assert.throws(() => sellMinedOre(gameState, 'agri-world', 'raw_ore', 10))
})

test('buyWeapon deducts credits and adds one to station storage; sellStoredWeapon reverses it for a resale cut', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000

  buyWeapon(gameState, 'agri-world', 'beam_laser')
  assert.equal(gameState.stationStorage['agri-world'].weapons.beam_laser, 1)
  assert.ok(gameState.player.credits < 50000)

  const creditsBeforeSale = gameState.player.credits
  sellStoredWeapon(gameState, 'agri-world', 'beam_laser')
  assert.equal(gameState.stationStorage['agri-world'].weapons.beam_laser, undefined)
  assert.ok(gameState.player.credits > creditsBeforeSale)

  assert.throws(() => sellStoredWeapon(gameState, 'agri-world', 'beam_laser'), /No such weapon/)
})

test('equipWeapon swaps a hardpoint\'s weapon with one in storage, returning the old one to storage', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000
  const shipClass = getShipClass(STARTER_SHIP_CLASS_ID) // one laser hardpoint: fwd1
  const hardpointId = shipClass.hardpoints[0].id

  buyWeapon(gameState, 'agri-world', 'burst_laser')
  equipWeapon(gameState, 'agri-world', hardpointId, 'burst_laser')

  assert.equal(gameState.player.ship.equippedWeapons[hardpointId], 'burst_laser')
  assert.equal(gameState.stationStorage['agri-world'].weapons.burst_laser, undefined, 'the equipped weapon should leave storage')
  assert.equal(gameState.stationStorage['agri-world'].weapons[BASE_WEAPON_ID.laser], 1, 'the previously equipped base weapon should return to storage')

  // Equipping a weapon that doesn't fit the hardpoint's mount category throws.
  buyWeapon(gameState, 'agri-world', 'rocket_pod')
  assert.throws(() => equipWeapon(gameState, 'agri-world', hardpointId, 'rocket_pod'), /does not fit/)

  // Equipping something not in storage or salvage throws.
  assert.throws(() => equipWeapon(gameState, 'agri-world', hardpointId, 'plasma_cannon'), /not available/)
})

test('storageHasAssets is true only when something of value is parked', () => {
  assert.equal(storageHasAssets(null), false)
  assert.equal(storageHasAssets({ ships: [], cargo: {}, miningHold: {}, shipParts: 0, weapons: {}, accessories: {}, blueprints: {} }), false)
  assert.equal(storageHasAssets({ ships: [{ classId: 'x' }], cargo: {}, miningHold: {}, shipParts: 0, weapons: {}, accessories: {}, blueprints: {} }), true)
  assert.equal(storageHasAssets({ ships: [], cargo: { grain: 2 }, miningHold: {}, shipParts: 0, weapons: {}, accessories: {}, blueprints: {} }), true)
  assert.equal(storageHasAssets({ ships: [], cargo: {}, miningHold: {}, shipParts: 3, weapons: {}, accessories: {}, blueprints: {} }), true)
  assert.equal(storageHasAssets({ ships: [], cargo: {}, miningHold: {}, shipParts: 0, weapons: {}, accessories: { cargo_upgrade: 1 }, blueprints: {} }), true)
})

test('buyAccessory / equipAccessory / unequip an upgrade on a hull with slots', () => {
  const gameState = makeGameState()
  gameState.player.credits = 50000
  // The starter Mudlark has 1 slot — equip from storage works.
  buyAccessory(gameState, 'agri-world', 'cargo_upgrade')
  assert.equal(gameState.stationStorage['agri-world'].accessories.cargo_upgrade, 1)
  equipAccessory(gameState, 'agri-world', 0, 'cargo_upgrade')
  assert.equal(gameState.player.ship.equippedAccessories[0], 'cargo_upgrade')
  assert.equal(gameState.stationStorage['agri-world'].accessories.cargo_upgrade, undefined)

  // Unequip returns to storage.
  equipAccessory(gameState, 'agri-world', 0, null)
  assert.equal(gameState.player.ship.equippedAccessories[0], null)
  assert.equal(gameState.stationStorage['agri-world'].accessories.cargo_upgrade, 1)

  // Out-of-range slot index must fail.
  assert.throws(() => equipAccessory(gameState, 'agri-world', 9, 'cargo_upgrade'), /No such accessory slot/)

  const creditsBefore = gameState.player.credits
  sellStoredAccessory(gameState, 'agri-world', 'cargo_upgrade')
  assert.ok(gameState.player.credits > creditsBefore)
})

test('purchaseShip stores empty equippedAccessories sized to class slots', () => {
  const gameState = makeGameState()
  gameState.player.credits = 100000
  purchaseShip(gameState, 'agri-world', 'hold_runner', 'Probe Runner')
  const stored = gameState.stationStorage['agri-world'].ships[0]
  assert.deepEqual(stored.equippedAccessories, defaultAccessoriesFor(getShipClass('hold_runner')))
})

test('transferStorageItem moves cargo ship↔station and capacity-limits retrieve', () => {
  const gameState = makeGameState()
  gameState.player.ship.cargo = { grain: 10 }
  let r = transferStorageItem(gameState, 'agri-world', 'cargo', 'grain', 4, 'toStation')
  assert.equal(r.moved, 4)
  assert.equal(gameState.player.ship.cargo.grain, 6)
  assert.equal(gameState.stationStorage['agri-world'].cargo.grain, 4)

  // Fill ship cargo to capacity then try to retrieve more than free space.
  const cap = getShipClass(STARTER_SHIP_CLASS_ID).stats.cargoCapacity
  gameState.player.ship.cargo = { grain: cap - 1 }
  gameState.stationStorage['agri-world'].cargo = { grain: 20 }
  r = transferStorageItem(gameState, 'agri-world', 'cargo', 'grain', 20, 'toShip')
  assert.equal(r.moved, 1)
  assert.equal(r.capacityLimited, true)
  assert.equal(gameState.player.ship.cargo.grain, cap)
  assert.equal(gameState.stationStorage['agri-world'].cargo.grain, 19)
})

test('transferStorageItem moves ship parts both ways', () => {
  const gameState = makeGameState()
  gameState.player.ship.shipParts = 5
  const r = transferStorageItem(gameState, 'agri-world', 'parts', 'ship_parts', 3, 'toStation')
  assert.equal(r.moved, 3)
  assert.equal(gameState.player.ship.shipParts, 2)
  assert.equal(gameState.stationStorage['agri-world'].shipParts, 3)
  transferStorageItem(gameState, 'agri-world', 'parts', 'ship_parts', 2, 'toShip')
  assert.equal(gameState.player.ship.shipParts, 4)
  assert.equal(gameState.stationStorage['agri-world'].shipParts, 1)
})

test('playerAssetBodyIds marks the harbours holding your boats and goods', () => {
  const gameState = {
    player: { currentSystemId: 'sea-0', credits: 0, ship: { cargo: {} } },
    galaxy: { systems: [{ id: 'sea-0', bodies: [{ id: 'port-a' }, { id: 'port-b' }, { id: 'port-c' }] }] },
    stationStorage: {
      'port-a': { ships: [{ classId: 'a' }], cargo: {}, miningHold: {}, shipParts: 0, weapons: {}, blueprints: {} },
      'port-b': { ships: [], cargo: { grain: 10 }, miningHold: {}, shipParts: 0, weapons: {}, blueprints: {} },
      'port-c': { ships: [], cargo: {}, miningHold: {}, shipParts: 0, weapons: {}, blueprints: {} }
    },
    craftingJobs: []
  }
  const ids = playerAssetBodyIds(gameState)
  assert.equal(ids.has('port-a'), true, 'a laid-up boat counts')
  assert.equal(ids.has('port-b'), true, 'cargo left ashore counts')
  assert.equal(ids.has('port-c'), false, 'an empty locker is not an asset')
})

test('playerAssetBodyIds includes harbours with work still in the yard', () => {
  const gameState = {
    player: { currentSystemId: 'sea-0', credits: 0, ship: { cargo: {} } },
    galaxy: { systems: [{ id: 'sea-0', bodies: [{ id: 'port-a' }] }] },
    stationStorage: {},
    craftingJobs: [{ bodyId: 'port-a', completesAtWallMs: Date.now() + 60_000 }]
  }
  assert.equal(playerAssetBodyIds(gameState).has('port-a'), true)
})
