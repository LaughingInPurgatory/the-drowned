import test from 'node:test'
import assert from 'node:assert/strict'
import { waveHeight, waveNormal, snapToSea, SEA_MAX_AMPLITUDE, seaShaderChunk } from './sea.js'

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

test('the emitted GLSL computes the same surface as waveHeight', () => {
  // The shader source is the visible water and waveHeight is where the boats
  // sit. Re-evaluating the emitted literals in JS is the only check available
  // without a GL context, and it catches the failure that matters: a precision
  // or formatting slip that would leave hulls hovering or half-sunk.
  const src = seaShaderChunk()
  const num = String.raw`(-?[\d.]+(?:e[-+]?\d+)?)`
  const re = new RegExp(
    String.raw`h \+= ${num} \* sin\(\(${num} \* p\.x \+ ${num} \* p\.y\) \* ${num} - t \* ${num}\);`,
    'g'
  )
  const terms = [...src.matchAll(re)].map((m) => m.slice(1).map(Number))
  assert.ok(terms.length >= 3, `expected wave terms in the emitted GLSL, found ${terms.length}`)

  const fromShader = (x, z, t) =>
    terms.reduce((h, [amp, dx, dz, k, rate]) => h + amp * Math.sin((dx * x + dz * z) * k - t * rate), 0)

  for (const [x, z, t] of [[0, 0, 0], [412, -88, 6.25], [-3300, 1750, 40]]) {
    assert.ok(
      Math.abs(fromShader(x, z, t) - waveHeight(x, z, t)) < 1e-6,
      `shader and buoyancy disagree at ${x},${z},${t}`
    )
  }
})

test('the emitted GLSL declares the functions the ocean shader calls', () => {
  const src = seaShaderChunk()
  assert.match(src, /float seaHeight\(vec2 p, float t\)/)
  assert.match(src, /vec3 seaNormal\(vec2 p, float t\)/)
  assert.ok(!/undefined|NaN/.test(src), 'emitted GLSL must not contain undefined/NaN literals')
})
