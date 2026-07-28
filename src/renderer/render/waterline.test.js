import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { buildHarbourMesh } from './harbourMesh.js'
import { getAsteroidRocks } from './asteroidFieldMesh.js'
import { generateWorld, getWorld } from '../procgen/world.js'
import { SEA_MAX_AMPLITUDE } from '../world/sea.js'

/**
 * Nothing floats.
 *
 * Everything in this world is placed against a waterline at y = 0, and the one
 * failure that keeps recurring is a piece positioned by its *centre* rather
 * than by the part of it that is supposed to be wet: the object then hangs
 * clear of the sea, with daylight under it, at whatever size the RNG happened
 * to roll. It has now bitten the wreck-field hulks and the harbour breakwaters
 * independently, so it is worth a standing check.
 */

function bodies(kind, limit = 10) {
  return getWorld(generateWorld(4242))
    .bodies.filter((b) => b.kind === kind)
    .slice(0, limit)
}

test('no wreck hulk hangs clear of the water', () => {
  for (const body of bodies('wreckField')) {
    for (const rock of getAsteroidRocks(body)) {
      const bottom = rock.position[1] - rock.collisionRadius
      assert.ok(
        bottom < -SEA_MAX_AMPLITUDE,
        `${body.name}: a hulk bottoms out at ${bottom.toFixed(1)}, above the deepest trough`
      )
    }
  }
})

test('every wreck field still has hulks breaking the surface', () => {
  // The opposite failure: settling everything so deep the field becomes an
  // invisible patch of open water you cannot find, let alone salvage.
  for (const body of bodies('wreckField')) {
    const proud = getAsteroidRocks(body).filter(
      (r) => r.position[1] + r.collisionRadius > SEA_MAX_AMPLITUDE
    )
    assert.ok(proud.length >= 3, `${body.name} shows only ${proud.length} hulks above the swell`)
  }
})

test('no part of a harbour hangs in the air over the sea', () => {
  // Deliberately narrow: a lamp on a post or a crane jib is *meant* to be up
  // there. What must not exist is a piece sitting entirely between the highest
  // crest and the deck — that band is water, and anything floating in it reads
  // as a bug however good the rest looks.
  const box = new THREE.Box3()
  for (const body of bodies('port', 8).concat(bodies('outpost', 8))) {
    const mesh = buildHarbourMesh(body)
    mesh.traverse((obj) => {
      if (!obj.isMesh) return
      box.setFromObject(obj)
      if (!Number.isFinite(box.min.y)) return
      const floating = box.min.y > SEA_MAX_AMPLITUDE && box.max.y < 3
      assert.ok(
        !floating,
        `${body.name}: a part floats between y=${box.min.y.toFixed(1)} and ${box.max.y.toFixed(1)}`
      )
    })
  }
})
