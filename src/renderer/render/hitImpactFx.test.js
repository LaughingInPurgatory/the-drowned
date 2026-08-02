import test from 'node:test'
import assert from 'node:assert/strict'
import { disposeHitImpact, spawnHitImpact, updateHitImpact } from './hitImpactFx.js'

test('laser impact burst expands and fades before cleanup', () => {
  const fx = spawnHitImpact([0, 0, 0], 'laser', 0xffd9a0)
  const startScale = fx.burst.flash.scale.x
  const startOpacity = fx.burst.flash.material.opacity
  const startSmokeScale = fx.smoke[0].mesh.scale.x

  assert.ok(fx.life <= 3)

  assert.equal(updateHitImpact(fx, 0.1), true)
  assert.ok(fx.burst.flash.scale.x > startScale)
  assert.ok(fx.burst.flash.material.opacity < startOpacity)
  assert.ok(fx.smoke[0].mesh.scale.x > startSmokeScale)
  assert.ok(fx.smoke[0].mesh.material.opacity > 0)
  assert.equal(updateHitImpact(fx, fx.ttl + 0.01), false)

  disposeHitImpact(fx)
})

test('impact scale is an instance size only', () => {
  const footFx = spawnHitImpact([0, 0, 0], 'laser', 0xffd9a0, { scale: 0.5 })
  const shipFx = spawnHitImpact([0, 0, 0], 'laser', 0xffd9a0)

  assert.equal(footFx.group.scale.x, 0.5)
  assert.equal(shipFx.group.scale.x, 1)

  disposeHitImpact(footFx)
  disposeHitImpact(shipFx)
})

test('missile impacts use a larger, longer-lived effect', () => {
  const laserFx = spawnHitImpact([0, 0, 0], 'laser')
  const missileFx = spawnHitImpact([0, 0, 0], 'missile')

  assert.ok(missileFx.group.scale.x > laserFx.group.scale.x)
  assert.ok(missileFx.life > laserFx.life * 0.25)
  assert.ok(missileFx.blast.flash.scale.x > 0.7)
  assert.ok(missileFx.blast.ring.scale.x > 0.6)

  disposeHitImpact(laserFx)
  disposeHitImpact(missileFx)
})
