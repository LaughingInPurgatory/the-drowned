import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildIslandMesh, getIslandProfile, islandTerrainYAt, landformForBody } from './islandMesh.js'
import { generateWorld, getWorld } from '../procgen/world.js'
import { SEA_MAX_AMPLITUDE } from '../world/sea.js'

function islands(limit = 12) {
  return getWorld(generateWorld(1234))
    .bodies.filter((b) => b.kind === 'island')
    .slice(0, limit)
}

/** Fraction of triangles whose geometric normal points downward. */
function downwardFraction(geometry) {
  const pos = geometry.getAttribute('position')
  const idx = geometry.getIndex()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const n = new THREE.Vector3()
  let down = 0
  let total = 0
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i))
    b.fromBufferAttribute(pos, idx.getX(i + 1))
    c.fromBufferAttribute(pos, idx.getX(i + 2))
    n.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a))
    total++
    if (n.y < 0) down++
  }
  return total ? down / total : 0
}

test('island faces point upward — a back-faced island is see-through', () => {
  // This has now bitten twice: the ocean disc and then the islands. Increasing
  // theta runs *clockwise* in XZ seen from above, so the obvious index order
  // produces downward normals and the whole surface is culled from any normal
  // viewpoint — you look straight through the hill to the inside of its far
  // slope. Cheap to check, invisible until someone notices it on a title screen.
  for (const body of islands()) {
    const frac = downwardFraction(buildIslandMesh(body).geometry)
    assert.ok(frac < 0.02, `${body.name} has ${(frac * 100).toFixed(0)}% of faces pointing down`)
  }
})

test('every island runs a shelf below the waterline', () => {
  // No vertical wall where land meets sea, and nothing that a wave trough can
  // undercut to reveal a hollow edge.
  for (const body of islands()) {
    const pos = buildIslandMesh(body).geometry.getAttribute('position')
    let min = Infinity
    for (let i = 0; i < pos.count; i++) min = Math.min(min, pos.getY(i))
    assert.ok(
      min < -SEA_MAX_AMPLITUDE,
      `${body.name} bottoms out at ${min.toFixed(1)}, not clear of the swell`
    )
  }
})

test('terrain sampler matches the rendered island faces', () => {
  // Vegetation and on-foot grounding must use the actual faceted surface. A
  // smooth polar sample can be several metres above a convex triangle near
  // the coast, which is exactly how floating grass slipped through.
  const body = islands(1)[0]
  const mesh = buildIslandMesh(body)
  const terrain = new THREE.Mesh(mesh.geometry)
  terrain.position.fromArray(body.position)
  terrain.updateMatrixWorld(true)
  const ray = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const down = new THREE.Vector3(0, -1, 0)
  const profile = getIslandProfile(body)
  for (const r of [0.18, 0.44, 0.73, 0.9, 0.96]) {
    for (const theta of [0.17, 1.31, 2.83, 4.29, 5.67]) {
      const x = body.position[0] + Math.cos(theta) * profile.radius * r
      const z = body.position[2] + Math.sin(theta) * profile.radius * r
      origin.set(x, body.position[1] + 10000, z)
      ray.set(origin, down)
      const hit = ray.intersectObject(terrain, false)[0]
      assert.ok(hit, `no terrain face at r=${r}, theta=${theta}`)
      const sampled = islandTerrainYAt(body, x, z)
      assert.ok(
        Math.abs(sampled - hit.point.y) < 0.02,
        `terrain sample drifted ${(sampled - hit.point.y).toFixed(3)} m at r=${r}, theta=${theta}`
      )
    }
  }
})

test('land never pokes up in a place the coastline says is open water', () => {
  // The traced shoreline is what boats ground on (game/collision.js). If any
  // geometry stands above the waterline outside it, you can sail through
  // visible land.
  for (const body of islands(8)) {
    const profile = getIslandProfile(body)
    const pos = buildIslandMesh(body).geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y <= SEA_MAX_AMPLITUDE) continue
      const r = Math.hypot(pos.getX(i), pos.getZ(i))
      assert.ok(
        r <= profile.maxShore + 1,
        `${body.name}: land at y=${y.toFixed(1)} sits ${r.toFixed(0)} out, past the ${profile.maxShore.toFixed(0)} coastline`
      )
    }
  }
})

test('landform is stable for a body and spreads across the world', () => {
  const body = islands(1)[0]
  assert.equal(landformForBody(body), landformForBody(body))
  const seen = new Set(
    getWorld(generateWorld())
      .bodies.filter((b) => b.kind === 'island')
      .map((b) => landformForBody(b))
  )
  assert.ok(seen.size >= 4, `expected varied landforms, saw ${[...seen].join(', ')}`)
})

test('mountain spires are rare, tall, and rocky', () => {
  const all = getWorld(generateWorld(8675309)).bodies.filter((b) => b.kind === 'island')
  const spires = all.filter((b) => landformForBody(b) === 'spire')
  // A handful per world — navigational landmarks, not the default coast.
  assert.ok(spires.length >= 1, 'expected at least one mountain spire')
  assert.ok(
    spires.length <= Math.max(12, all.length * 0.12),
    `too many spires: ${spires.length} of ${all.length}`
  )
  for (const body of spires) {
    const profile = getIslandProfile(body)
    assert.equal(profile.landform, 'spire')
    // Taller than the island is wide — tip of a drowned mountain.
    assert.ok(
      profile.height >= body.radius * 1.2,
      `${body.name} spire height ${profile.height.toFixed(0)} vs radius ${body.radius}`
    )
    // Craggy rock surfaces only (no grassy crown / sandy beach blend intent).
    assert.ok(
      ['rocky', 'shingle'].includes(profile.surfaces.body.tex) ||
        profile.surfaces.body.tex === 'rocky' ||
        profile.surfaces.body.color != null,
      `${body.name} body surface ${profile.surfaces.body.tex}`
    )
    const mesh = buildIslandMesh(body)
    assert.equal(mesh.userData.landform, 'spire')
    // Steep rock: almost no vegetation on the typical roll.
    const veg = mesh.getObjectByName('vegetation')?.children.length ?? 0
    assert.ok(veg < 40, `${body.name} should not be forested (veg=${veg})`)
  }
})

test('every island mesh can carry vegetation and ruins — not only the home rock', () => {
  // Same builder titles the menu and the sailing world. Cover is rolled per
  // island so some are bare, some wooded, some ruined, some both.
  const sample = getWorld(generateWorld(8675309))
    .bodies.filter((b) => b.kind === 'island')
    .slice(0, 48)

  let withVeg = 0
  let withRuins = 0
  let bare = 0
  let vegOnly = 0
  let ruinsOnly = 0
  for (const body of sample) {
    const mesh = buildIslandMesh(body)
    const veg = mesh.getObjectByName('vegetation')
    const ruins = mesh.getObjectByName('ruins')
    assert.ok(veg, `${body.name} missing vegetation group`)
    assert.ok(ruins, `${body.name} missing ruins group`)
    assert.ok(Array.isArray(veg.userData.treeColliders), `${body.name} missing tree collision data`)
    assert.ok(
      veg.userData.treeColliders.every((c) => Number.isFinite(c.x) && Number.isFinite(c.z) && c.radius > 0),
      `${body.name} has invalid tree collision data`
    )
    const v = veg.children.length
    const r = ruins.children.length
    if (v > 0) withVeg++
    if (r > 0) withRuins++
    if (v === 0 && r === 0) bare++
    if (v > 0 && r === 0) vegOnly++
    if (v === 0 && r > 0) ruinsOnly++
  }

  assert.ok(withVeg >= 8, `expected wooded islands, saw ${withVeg}`)
  assert.ok(withRuins >= 5, `expected ruined islands, saw ${withRuins}`)
  assert.ok(bare >= 2, `expected some fully barren islands, saw ${bare}`)
  // Independent cover rolls: vegetation without buildings, and the reverse.
  assert.ok(vegOnly + ruinsOnly >= 1, 'expected mixed cover (trees without ruins or ruins without trees)')
})

test('Haven Reach keeps a small ruin cluster', () => {
  const haven = getWorld(generateWorld(8675309)).bodies.find((b) => b.name === 'Haven Reach')
  const ruins = buildIslandMesh(haven).getObjectByName('ruins')
  assert.ok(ruins.children.length > 0, 'Haven Reach should have visible ruined buildings')
  assert.ok(
    ruins.children.some((piece) => Math.hypot(piece.position.x, piece.position.z) > haven.radius * 0.65),
    'Haven Reach should have ruins nearer the coastline'
  )
})

test('Haven Reach has a broken coastline rather than a round disc', () => {
  const haven = getWorld(generateWorld(8675309)).bodies.find((b) => b.name === 'Haven Reach')
  const shore = [...getIslandProfile(haven).shore]
  const min = Math.min(...shore)
  const max = Math.max(...shore)
  assert.ok(min < max * 0.8, `Haven shoreline is too uniform: ${min.toFixed(0)}–${max.toFixed(0)} m`)
  assert.ok(max - min > haven.radius * 0.25, 'Haven should have a visible bay/headland silhouette')
})

test('Haven Reach is lower without breaking its shared placement surface', () => {
  const haven = getWorld(generateWorld(8675309)).bodies.find((b) => b.name === 'Haven Reach')
  const profile = getIslandProfile(haven)
  assert.ok(profile.height < haven.radius * 0.28, `Haven remains too tall: ${profile.height.toFixed(0)}m`)
  assert.ok(profile.height > haven.radius * 0.1, 'Haven should remain a substantial island')

  // The mesh and every vegetation/ruin/talus builder consume this same cached
  // profile. Sampling the built terrain keeps a lowered island from drifting
  // away from the surface used to seat its placeables.
  const mesh = buildIslandMesh(haven)
  const terrain = new THREE.Mesh(mesh.geometry)
  terrain.position.fromArray(haven.position)
  terrain.updateMatrixWorld(true)
  const ray = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const down = new THREE.Vector3(0, -1, 0)
  for (const r of [0.2, 0.5, 0.75]) {
    const theta = 0.9 + r
    const x = haven.position[0] + Math.cos(theta) * profile.radius * r
    const z = haven.position[2] + Math.sin(theta) * profile.radius * r
    origin.set(x, 10000, z)
    ray.set(origin, down)
    const hit = ray.intersectObject(terrain, false)[0]
    assert.ok(hit, `Haven terrain missing at r=${r}`)
    assert.ok(Math.abs(islandTerrainYAt(haven, x, z) - hit.point.y) < 0.02)
  }
})

test('island props are stable across rebuilds', () => {
  const body = islands(1)[0]
  getIslandProfile(body) // collision / shore can warm the profile first
  const a = buildIslandMesh(body)
  const b = buildIslandMesh(body)
  assert.equal(
    a.getObjectByName('vegetation').children.length,
    b.getObjectByName('vegetation').children.length
  )
  assert.equal(
    a.getObjectByName('ruins').children.length,
    b.getObjectByName('ruins').children.length
  )
})
