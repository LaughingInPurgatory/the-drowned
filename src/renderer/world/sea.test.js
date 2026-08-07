import test from 'node:test'
import assert from 'node:assert/strict'
import {
  waveHeight,
  waveNormal,
  snapToSea,
  SEA_MAX_AMPLITUDE,
  SEA_COMPILED,
  SEA_DETAIL_SLOPE,
  seaParamAt
} from './sea.js'

test('waveHeight is deterministic for the same inputs', () => {
  assert.equal(waveHeight(120, -40, 3.5), waveHeight(120, -40, 3.5))
})

test('waveHeight stays within the summed amplitude', () => {
  for (let i = 0; i < 400; i++) {
    const h = waveHeight(i * 37.1, i * -19.7, i * 0.83)
    assert.ok(Math.abs(h) <= SEA_MAX_AMPLITUDE + 1e-9, `height ${h} exceeded ${SEA_MAX_AMPLITUDE}`)
  }
})

test('waveHeight actually moves with time', () => {
  assert.notEqual(waveHeight(0, 0, 0), waveHeight(0, 0, 2.7))
})

test('waveNormal matches a finite difference of waveHeight', () => {
  // The shader and the buoyancy slope must agree; an analytic derivative that
  // has drifted from waveHeight is exactly how boats end up leaning wrong.
  const eps = 0.01
  for (const [x, z, t] of [[0, 0, 0], [83, -217, 4.2], [-1900, 640, 11.5]]) {
    const n = waveNormal(x, z, t)
    const dhdx = (waveHeight(x + eps, z, t) - waveHeight(x - eps, z, t)) / (2 * eps)
    const dhdz = (waveHeight(x, z + eps, t) - waveHeight(x, z - eps, t)) / (2 * eps)
    const len = Math.hypot(dhdx, 1, dhdz)
    assert.ok(Math.abs(n.x - -dhdx / len) < 1e-4, `normal.x at ${x},${z}`)
    assert.ok(Math.abs(n.y - 1 / len) < 1e-4, `normal.y at ${x},${z}`)
    assert.ok(Math.abs(n.z - -dhdz / len) < 1e-4, `normal.z at ${x},${z}`)
  }
})

test('waveNormal is unit length and points up', () => {
  for (let i = 0; i < 100; i++) {
    const n = waveNormal(i * 13.3, i * 41.9, i * 0.31)
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9)
    assert.ok(n.y > 0)
  }
})

test('snapToSea puts the entity on the surface and kills vertical drift', () => {
  const npc = { position: [140, 900, -60], velocity: [3, -22, 1] }
  snapToSea(npc, 2)
  assert.equal(npc.position[1], waveHeight(140, -60, 2))
  assert.equal(npc.velocity[1], 0)
  // Horizontal motion is untouched.
  assert.deepEqual([npc.velocity[0], npc.velocity[2]], [3, 1])
})

test('snapToSea tolerates an entity with no velocity array', () => {
  const buoy = { position: [10, 5, 10] }
  snapToSea(buoy, 1)
  assert.equal(buoy.position[1], waveHeight(10, 10, 1))
})

test('the table the ocean shader reads reproduces waveHeight exactly', () => {
  // SEA_COMPILED is the shared band: render/oceanNodeMaterial.js sums these
  // same numbers on the GPU, and waveHeight sums them here for buoyancy. This
  // re-derives the hull sample straight off the exported table, so any edit
  // that leaves the two summing different things fails before a boat visibly
  // hovers over the water.
  const fromTable = (x, z, t) => {
    const q = seaParamAt(x, z, t)
    return SEA_COMPILED.reduce(
      (h, w) => h + w.bAmp * Math.sin((w.dx * q.x + w.dz * q.z) * w.k - t * w.omega),
      0
    )
  }
  for (const [x, z, t] of [[0, 0, 0], [412, -88, 6.25], [-3300, 1750, 40]]) {
    assert.ok(
      Math.abs(fromTable(x, z, t) - waveHeight(x, z, t)) < 1e-12,
      `shader table and buoyancy disagree at ${x},${z},${t}`
    )
  }
})

test('the shared band carries every product the shader needs, finite', () => {
  assert.ok(SEA_COMPILED.length >= 8, 'spectrum lost components')
  for (const w of SEA_COMPILED) {
    for (const key of ['len', 'dx', 'dz', 'k', 'omega', 'amp', 'qa', 'ak', 'qak', 'bAmp']) {
      assert.ok(Number.isFinite(w[key]), `${key} is not finite`)
    }
    // Unit bearing — the shader relies on this to build tangents.
    assert.ok(Math.abs(Math.hypot(w.dx, w.dz) - 1) < 1e-12)
    // Deep-water dispersion, not a hardcoded speed.
    assert.ok(Math.abs(w.omega - Math.sqrt(9.81 * w.k)) < 1e-9)
  }
})

test('the shader-only detail band contributes slope but never height', () => {
  // The whole reason this band is allowed to exist on the GPU alone is that it
  // displaces nothing, so it cannot move a hull. Guard the shape of the data:
  // an `amp` sneaking in here is a boat hovering by that much.
  for (const w of SEA_DETAIL_SLOPE) {
    assert.equal(w.amp, undefined, 'detail components must not carry an amplitude')
    assert.ok(w.slope > 0 && w.slope < 0.2, 'detail slope out of sane range')
    assert.ok(Math.abs(Math.hypot(w.dx, w.dz) - 1) < 1e-12)
    assert.ok(Math.abs(w.omega - Math.sqrt(9.81 * w.k)) < 1e-9)
  }
  // Total added slope stays well under the point where normals invert.
  const total = SEA_DETAIL_SLOPE.reduce((s, w) => s + w.slope, 0)
  assert.ok(total < 0.5, `detail band slope ${total} is too steep to stay stable`)
})
