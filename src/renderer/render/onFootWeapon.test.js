import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { kickFixoPistolViewModel, updateFixoPistolViewModel } from './onFootWeapon.js'

test('Fixo authored shot animation starts and returns to its resting frame', () => {
  const root = new THREE.Group()
  const times = []
  root.userData.shotDuration = 0.28
  root.userData.shotTime = 0.28
  root.userData.restPosition = new THREE.Vector3()
  root.userData.mixer = { setTime: (time) => times.push(time) }

  kickFixoPistolViewModel(root)
  updateFixoPistolViewModel(root, 0.1, 0)
  updateFixoPistolViewModel(root, 0.2, 0)

  assert.deepEqual(times, [0.1, 0])
})

test('Fixo muzzle flash is brief and clears its light', () => {
  const root = new THREE.Group()
  const flash = new THREE.Group()
  flash.userData.light = { intensity: 2 }
  root.userData.muzzleFlash = flash
  root.userData.muzzleFlashTime = Infinity
  root.userData.restPosition = new THREE.Vector3()

  kickFixoPistolViewModel(root)
  assert.equal(flash.visible, true)
  updateFixoPistolViewModel(root, 0.2, 0)
  assert.equal(flash.visible, false)
  assert.equal(flash.userData.light.intensity, 0)
})

test('Fixo viewmodel darkens at night but retains a readable fill', () => {
  const root = new THREE.Group()
  root.userData.restPosition = new THREE.Vector3()
  root.userData.viewModelFill = { intensity: 0 }
  root.userData.viewModelKey = { intensity: 0 }

  updateFixoPistolViewModel(root, 0, 0, 0)
  const dayFill = root.userData.viewModelFill.intensity
  const dayKey = root.userData.viewModelKey.intensity
  updateFixoPistolViewModel(root, 0, 0, 1)

  assert.ok(root.userData.viewModelFill.intensity > 0)
  assert.ok(root.userData.viewModelKey.intensity > 0)
  assert.ok(root.userData.viewModelFill.intensity < dayFill)
  assert.ok(root.userData.viewModelKey.intensity < dayKey)
})
