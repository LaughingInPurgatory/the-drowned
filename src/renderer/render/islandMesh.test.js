import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildIslandMesh, getIslandProfile, landformForBody } from './islandMesh.js'
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
