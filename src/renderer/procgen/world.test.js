import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generateWorld,
  getWorld,
  getSystem,
  findBody,
  findSystemOfBody,
  remoteness,
  isDockable,
  bodyShellRadius,
  WORLD_RADIUS,
  TEST_WORLD_OPTS
} from './world.js'

function world(opts = TEST_WORLD_OPTS) {
  return generateWorld(1234, opts)
}

test('the world is one region — there is no galaxy to get lost in', () => {
  const galaxy = world()
  assert.equal(galaxy.systems.length, 1)
  assert.equal(getWorld(galaxy), galaxy.systems[0])
  // Every legacy getSystem call site, including one holding a stale id, must
  // still land on the world rather than returning null.
  assert.equal(getSystem(galaxy, galaxy.systems[0].id), galaxy.systems[0])
  assert.equal(getSystem(galaxy, 'sys-not-a-thing'), galaxy.systems[0])
  assert.equal(getSystem(galaxy, null), galaxy.systems[0])
})

test('generation is deterministic for a seed', () => {
  const a = generateWorld(99, TEST_WORLD_OPTS)
  const b = generateWorld(99, TEST_WORLD_OPTS)
  assert.deepEqual(
    getWorld(a).bodies.map((x) => [x.id, x.kind, x.name, x.position]),
    getWorld(b).bodies.map((x) => [x.id, x.kind, x.name, x.position])
  )
})

test('every body floats at sea level inside the world edge', () => {
  for (const body of getWorld(world()).bodies) {
    assert.equal(body.position[1], 0, `${body.name} is not at sea level`)
    const d = Math.hypot(body.position[0], body.position[2])
    assert.ok(d <= WORLD_RADIUS * 1.05, `${body.name} is ${d} out, past the world edge`)
  }
})

test('body ids are unique and names do not repeat', () => {
  const bodies = getWorld(world()).bodies
  assert.equal(new Set(bodies.map((b) => b.id)).size, bodies.length)
  const names = bodies.map((b) => b.name.toLowerCase())
  assert.equal(new Set(names).size, names.length)
})

test('every island name is unique and facilities never reuse a bare island name', () => {
  for (const seed of [1, 42, 99, 8675309]) {
    const bodies = getWorld(generateWorld(seed, TEST_WORLD_OPTS)).bodies
    const islands = bodies.filter((b) => b.kind === 'island')
    const islandNames = islands.map((b) => b.name.toLowerCase())
    assert.equal(new Set(islandNames).size, islandNames.length, `seed ${seed}: island names collide`)
    const all = bodies.map((b) => b.name.toLowerCase())
    assert.equal(new Set(all).size, all.length, `seed ${seed}: body names collide`)
    // No facility is literally named the same as an island (ports may contain the name).
    for (const fac of bodies.filter((b) => b.kind !== 'island')) {
      assert.ok(
        !islandNames.includes(fac.name.toLowerCase()),
        `seed ${seed}: ${fac.kind} "${fac.name}" equals an island name`
      )
    }
  }
})

test('coastal ports can inherit their host island into the name', () => {
  // Across a few seeds, some hosted ports should include the host name.
  let inherited = 0
  for (let seed = 1; seed < 40; seed++) {
    const bodies = getWorld(generateWorld(seed, TEST_WORLD_OPTS)).bodies
    for (const port of bodies.filter((b) => b.kind === 'port' && b.parentId)) {
      const host = bodies.find((b) => b.id === port.parentId)
      if (!host) continue
      if (port.name.toLowerCase().includes(host.name.toLowerCase())) inherited++
    }
  }
  assert.ok(inherited > 0, 'expected at least one port to inherit its island name')
})

test('nothing solid overlaps anything else solid', () => {
  const bodies = getWorld(world()).bodies
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]
      const b = bodies[j]
      // A harbour sits deliberately against its own island's shore.
      if (a.parentId === b.id || b.parentId === a.id) continue
      const d = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])
      const need = bodyShellRadius(a) + bodyShellRadius(b)
      assert.ok(d >= need, `${a.name} and ${b.name} overlap (${d.toFixed(0)} < ${need.toFixed(0)})`)
    }
  }
})

test('Haven Reach is at the centre with a max-security home harbour', () => {
  const galaxy = world()
  const bodies = getWorld(galaxy).bodies
  const home = bodies.find((b) => b.isHome)
  assert.ok(home, 'a home harbour must exist')
  assert.equal(home.id, galaxy.homePortId)
  assert.equal(home.kind, 'port')
  assert.equal(home.securityRating, 6)
  assert.ok(home.hasBerth, 'you must be able to respawn where you started')
  assert.ok(Math.hypot(home.position[0], home.position[2]) < 4000, 'home must be near the centre')
})

test('a new game can reach work and salvage without crossing the world', () => {
  const bodies = getWorld(world()).bodies
  const home = bodies.find((b) => b.isHome)
  const near = (kind, maxDist) =>
    bodies.filter(
      (b) =>
        b.kind === kind &&
        b !== home &&
        Math.hypot(b.position[0] - home.position[0], b.position[2] - home.position[2]) < maxDist
    )
  assert.ok(near('wreckField', 12000).length > 0, 'salvage must be in reach of the start')
  assert.ok(near('outpost', 12000).length > 0, 'a second port of call must be in reach')
})

test('ports and outposts give out work; islands and wreck fields do not', () => {
  for (const body of getWorld(world()).bodies) {
    assert.equal(body.hasMissions, isDockable(body), `${body.kind} mission flag is wrong`)
    if (isDockable(body)) {
      assert.ok(Number.isFinite(body.securityRating), `${body.name} has no security rating`)
      assert.ok(body.securityRating >= 0 && body.securityRating <= 6)
    }
  }
})

test('only ports have a boatyard', () => {
  for (const body of getWorld(world()).bodies) {
    assert.equal(body.hasShipyard, body.kind === 'port')
  }
})

test('a coastal port records the offset to its island so it can sit on the shore', () => {
  const bodies = getWorld(world()).bodies
  const coastal = bodies.filter((b) => b.kind === 'port' && b.parentId)
  assert.ok(coastal.length > 0, 'some harbours should hug a coast')
  for (const port of coastal) {
    const host = bodies.find((b) => b.id === port.parentId)
    assert.ok(host, `${port.name} points at a missing island`)
    assert.equal(host.kind, 'island')
    assert.equal(port.surfaceOffset[0], port.position[0] - host.position[0])
    assert.equal(port.surfaceOffset[2], port.position[2] - host.position[2])
  }
})

test('remoteness runs 0 at home to 1 at the edge', () => {
  assert.equal(remoteness([0, 0, 0]), 0)
  assert.ok(Math.abs(remoteness([WORLD_RADIUS, 0, 0]) - 1) < 1e-9)
  assert.equal(remoteness([WORLD_RADIUS * 4, 0, 0]), 1, 'must clamp past the edge')
  assert.ok(remoteness([WORLD_RADIUS / 2, 0, 0]) > remoteness([WORLD_RADIUS / 4, 0, 0]))
  assert.equal(remoteness(null), 0)
})

test('the deep sea is lawless and the middle is not', () => {
  const bodies = getWorld(generateWorld(7, { ...TEST_WORLD_OPTS, portCount: 40, outpostCount: 40 })).bodies
  const dockable = bodies.filter(isDockable)
  const inner = dockable.filter((b) => remoteness(b.position) < 0.3)
  const outer = dockable.filter((b) => remoteness(b.position) >= 0.9)
  const mean = (list) => list.reduce((s, b) => s + b.securityRating, 0) / Math.max(1, list.length)
  assert.ok(outer.every((b) => b.securityRating === 0), 'the far sea keeps no law at all')
  if (inner.length) assert.ok(mean(inner) > mean(outer), 'the centre must be better policed')
})

test('findBody and findSystemOfBody resolve within the one world', () => {
  const galaxy = world()
  const body = getWorld(galaxy).bodies[3]
  assert.equal(findBody(galaxy, body.id), body)
  assert.equal(findSystemOfBody(galaxy, body.id), getWorld(galaxy))
  assert.equal(findBody(galaxy, 'body-nope'), null)
  assert.equal(findSystemOfBody(galaxy, 'body-nope'), null)
})
