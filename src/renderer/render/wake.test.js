import test from 'node:test'
import assert from 'node:assert/strict'
import { createWake } from './wake.js'
import { seaParamAt, seaSurfaceAtParam, waveHeight } from '../world/sea.js'

/** Peak value down column 0 of a per-vertex attribute, and the row it peaked on. */
function peakRow(geo, name, cols) {
  const a = geo.getAttribute(name).array
  let best = -Infinity
  let at = -1
  for (let r = 0; r < a.length / cols; r++) {
    const v = a[r * cols]
    if (v > best) {
      best = v
      at = r
    }
  }
  return { best, at }
}

test('wake stays visible for a moving enlarged saved hull', () => {
  const wake = createWake()

  wake.update([0, 0, 0], 0, 1, 51, 4.6, 0, 1 / 60)

  const trail = wake.group.getObjectByName('wake-trail-foam')
  const veil = wake.group.getObjectByName('wake-trail-veil')
  const spray = wake.group.getObjectByName('wake-bow-spray')
  const bowLeft = wake.group.getObjectByName('wake-bow-0')
  const bowRight = wake.group.getObjectByName('wake-bow-1')
  assert.ok(trail)
  assert.ok(veil)
  assert.ok(spray)
  assert.ok(bowLeft)
  assert.ok(bowRight)
  // WebGPU path: NodeMaterial (GLSL ShaderMaterial does not compile here).
  assert.ok(
    trail.material.isMeshBasicNodeMaterial || trail.material.type === 'MeshBasicNodeMaterial'
  )
  assert.equal(trail.material.depthTest, true)
  assert.equal(trail.material.depthWrite, false)
  assert.equal(wake.group.renderOrder, 0.5)
  assert.equal(trail.visible, true)
  assert.equal(veil.visible, true)
  assert.equal(bowLeft.visible, true)
  assert.equal(bowRight.visible, true)
  assert.ok(trail.geometry.index.count > 0)
  // Soft veil is the wide aerated band; the trail is the screw churn.
  assert.equal(veil.material.uniforms.uSoft.value, 1)
  assert.equal(trail.material.uniforms.uSoft.value, 0)

  wake.dispose()
})

test('churn starts aft of the transom and decays along the trail', () => {
  // Row 0 is the *stem*: the wake is anchored at the bow so the Kelvin arms have
  // something to start from. Water under the forefoot has not been through the
  // screws yet, so churn is zero there, peaks aft of the transom, then decays.
  // (The old assertion `fade[0] > fade[last]` encoded the stern-anchored model,
  // where row 0 *was* the transom.)
  const wake = createWake()
  const hullLen = 40
  wake.update([0, 0, 0], 0, 1, hullLen, 4.6, 0, 1 / 60)
  const trail = wake.group.getObjectByName('wake-trail-foam')
  const cols = 7
  const fade = trail.geometry.getAttribute('aFade').array
  const rows = fade.length / cols

  assert.equal(fade[0], 0, 'no churn at the stem')
  const { best, at } = peakRow(trail.geometry, 'aFade', cols)
  assert.ok(best > 0.5, `churn should reach full strength, peaked at ${best}`)
  assert.ok(at > 0, 'churn peak must be aft of the stem')
  assert.ok(at * 1.35 < hullLen * 2.5, `churn peak too far aft (row ${at})`)
  // ...and it dissipates rather than running as a uniform road to the horizon.
  assert.ok(fade[(rows - 2) * cols] < best * 0.9, 'trail must dissipate with age')

  wake.dispose()
})

test('foam rides the visible ocean surface, not the buoyancy sample', () => {
  // The ocean shader displaces the full shared spectrum; `waveHeight` fades short
  // chop for hulls. Foam that trusts `waveHeight` floats above the water you can
  // actually see, which is what made the old wake read as a decal.
  const wake = createWake()
  const t = 12.5
  wake.update([120, 0, -80], 0.7, 1, 24, 4, t, 1 / 60)
  const trail = wake.group.getObjectByName('wake-trail-foam')
  const pos = trail.geometry.getAttribute('position')

  let checked = 0
  let maxErr = 0
  for (let i = 0; i < pos.count; i += 13) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (y < -100) continue // parked row
    const p = seaParamAt(x, z, t)
    const surf = seaSurfaceAtParam(p.x, p.z, t)
    maxErr = Math.max(maxErr, Math.abs(y - surf.y))
    checked++
  }
  assert.ok(checked > 20, 'expected live vertices to check')
  // Only the deliberate depth bias should separate them.
  assert.ok(maxErr < 0.2, `foam drifted ${maxErr.toFixed(3)}m off the visible surface`)

  // ...and that is genuinely a different answer from the hull sample, or this
  // test would be proving nothing.
  const p0 = seaParamAt(120, -80, t)
  assert.notEqual(seaSurfaceAtParam(p0.x, p0.z, t).y, waveHeight(120, -80, t))

  wake.dispose()
})

test('noise domain stays small and water-fixed as the hull travels', () => {
  // World coordinates run to ±20000 here. Feeding those to a sin-based hash in
  // fp32 collapses the noise into flat blocks — the bug that made the wake
  // render as untextured polygons. `aLocal` must stay in local metres.
  const wake = createWake()
  const trail = wake.group.getObjectByName('wake-trail-foam')
  let t = 0
  for (let i = 0; i < 30; i++) {
    t += 1 / 30
    wake.update([18000 + i * 2, 0, -17000], 0, 1, 20, 4, t, 1 / 30)
  }
  const local = trail.geometry.getAttribute('aLocal').array
  let maxAbs = 0
  for (let i = 0; i < local.length; i++) maxAbs = Math.max(maxAbs, Math.abs(local[i]))
  assert.ok(maxAbs < 4200, `noise coordinate reached ${maxAbs}, fp32 hash will band`)

  wake.dispose()
})

test('premium player hull uses wet clearcoat; lite NPC stays Standard', async () => {
  const { getShipClass, STARTER_SHIP_CLASS_ID } = await import('../data/shipClasses.js')
  const { buildShipMesh } = await import('./shipMesh.js')
  const cls = getShipClass(STARTER_SHIP_CLASS_ID)
  const player = buildShipMesh(cls, { searchlight: true })
  const npc = buildShipMesh(cls, { lite: true })
  const playerHull = player.getObjectByName('hull-skin')
  const npcHull = npc.getObjectByName('hull-skin')
  assert.ok(playerHull?.material?.isMeshPhysicalMaterial)
  assert.ok((playerHull.material.clearcoat ?? 0) > 0.2)
  assert.ok(npcHull?.material?.isMeshStandardMaterial)
  assert.equal(player.userData.premiumHull, true)
  assert.equal(npc.userData.premiumHull, false)
})
