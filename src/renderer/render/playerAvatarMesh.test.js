import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  buildPlayerAvatarMesh,
  updatePlayerAvatarMesh,
  PLAYER_AVATAR_HEIGHT,
  HEAD_VARIATIONS,
  UPPER_BODY_VARIATIONS,
  LOWER_BODY_VARIATIONS
} from './playerAvatarMesh.js'

test('player avatar has human scale and recognisable body parts', () => {
  const avatar = buildPlayerAvatarMesh()
  const bounds = new THREE.Box3().setFromObject(avatar)
  assert.ok(Math.abs(bounds.max.y - bounds.min.y - PLAYER_AVATAR_HEIGHT) < 0.08)
  const shadowMeshes = []
  avatar.traverse((child) => {
    if (child.isMesh) shadowMeshes.push(child)
  })
  assert.ok(shadowMeshes.length > 0)
  assert.ok(shadowMeshes.every((child) => child.castShadow && child.receiveShadow))
  for (const name of ['head', 'leftBoot', 'rightBoot', 'backpack']) {
    assert.ok(avatar.getObjectByName(name), `missing avatar part: ${name}`)
  }
})

test('all avatar components are ten-way interchangeable at the same anchors', () => {
  assert.equal(HEAD_VARIATIONS.length, 10)
  assert.equal(UPPER_BODY_VARIATIONS.length, 10)
  assert.equal(LOWER_BODY_VARIATIONS.length, 10)
  for (let i = 0; i < 10; i++) {
    const avatar = buildPlayerAvatarMesh({ headId: i, upperBodyId: i, lowerBodyId: i })
    const bounds = new THREE.Box3().setFromObject(avatar)
    assert.ok(Math.abs(bounds.max.y - bounds.min.y - PLAYER_AVATAR_HEIGHT) < 0.08, `variation ${i} drifted in height`)
    assert.ok(avatar.getObjectByName('head'))
    assert.ok(avatar.getObjectByName('jacketBody'))
    assert.ok(avatar.getObjectByName('leftBoot'))
  }
})

test('walking drives jointed arms, legs, hands, and boots', () => {
  const avatar = buildPlayerAvatarMesh()
  const hand = avatar.getObjectByName('leftHand')
  const boot = avatar.getObjectByName('leftBoot')
  avatar.updateWorldMatrix(true, true)
  const handAtRest = hand.getWorldPosition(new THREE.Vector3()).clone()
  const bootAtRest = boot.getWorldPosition(new THREE.Vector3()).clone()
  updatePlayerAvatarMesh(avatar, {
    position: [0, 2, 0],
    velocity: [2, 0, 0],
    heading: 0,
    walkPhase: Math.PI / 2
  }, 0)
  avatar.updateWorldMatrix(true, true)
  const handWalking = hand.getWorldPosition(new THREE.Vector3())
  const bootWalking = boot.getWorldPosition(new THREE.Vector3())
  assert.ok(handWalking.distanceTo(handAtRest) > 0.02)
  assert.ok(bootWalking.distanceTo(bootAtRest) > 0.02)
})

test('running uses a larger limb swing than walking', () => {
  const avatar = buildPlayerAvatarMesh()
  const thigh = avatar.getObjectByName('leftThigh')
  const state = {
    position: [0, 2, 0],
    velocity: [5.2, 0, 0],
    heading: 0,
    walkPhase: Math.PI / 2,
    running: false
  }
  updatePlayerAvatarMesh(avatar, state, 0)
  const walkingSwing = thigh.quaternion.angleTo(thigh.userData.avatarRestQuaternion)
  state.velocity[0] = 8.4
  state.running = true
  updatePlayerAvatarMesh(avatar, state, 0)
  const runningSwing = thigh.quaternion.angleTo(thigh.userData.avatarRestQuaternion)
  assert.ok(runningSwing > walkingSwing)
})

test('jumping uses an airborne pose instead of the walking pose', () => {
  const avatar = buildPlayerAvatarMesh()
  const arm = avatar.getObjectByName('leftUpperArm')
  updatePlayerAvatarMesh(avatar, {
    position: [0, 2, 0],
    velocity: [0, 0, 0],
    heading: 0,
    walkPhase: 0,
    jumping: true,
    jumpTime: 0.36
  }, 0)
  const jumpSwing = arm.quaternion.angleTo(arm.userData.avatarRestQuaternion)
  assert.ok(jumpSwing > 0.5)
})

test('jumping bends the knees forward instead of backwards', () => {
  const avatar = buildPlayerAvatarMesh()
  updatePlayerAvatarMesh(avatar, {
    position: [0, 2, 0],
    velocity: [0, 0, 0],
    heading: 0,
    walkPhase: 0,
    jumping: true,
    jumpTime: 0.36
  }, 0)
  avatar.updateWorldMatrix(true, true)
  const hip = avatar.getObjectByName('leftThigh').getWorldPosition(new THREE.Vector3())
  const knee = avatar.getObjectByName('leftShin').getWorldPosition(new THREE.Vector3())
  const foot = avatar.getObjectByName('leftBoot').getWorldPosition(new THREE.Vector3())
  assert.ok(knee.z > hip.z, 'the knee should come forward during a jump')
  assert.ok(foot.z < knee.z, 'the lower leg should fold back from the knee')
})

test('on-foot animation remains upright while walking', () => {
  const avatar = buildPlayerAvatarMesh()
  const state = {
    position: [0, 2, 0],
    velocity: [2, 0, 0],
    heading: 0,
    walkPhase: Math.PI / 2
  }
  updatePlayerAvatarMesh(avatar, state, 0)
  assert.ok(Math.abs(avatar.rotation.x) < 0.001)
})
