import * as THREE from 'three'
import {
  HEAD_VARIATIONS,
  UPPER_BODY_VARIATIONS,
  LOWER_BODY_VARIATIONS,
  buildAvatarHead,
  buildAvatarUpperBody,
  buildAvatarLowerBody,
  headSkinColor
} from './playerAvatarVariants.js'

export { HEAD_VARIATIONS, UPPER_BODY_VARIATIONS, LOWER_BODY_VARIATIONS }

export const PLAYER_AVATAR_HEIGHT = 1.8
const BUILT_AVATAR_HEIGHT = 2.02
const WALK_STRIDE_METRES = 1.35
const RUN_STRIDE_METRES = 1.65
const _avatarAnimQ = new THREE.Quaternion()
const _avatarAnimAxis = new THREE.Vector3(1, 0, 0)

/**
 * Compose one interchangeable on-foot avatar from a head, upper body and
 * lower body. Every component uses the same neck, waist and foot anchors.
 */
export function buildPlayerAvatarMesh({
  height = PLAYER_AVATAR_HEIGHT,
  headId = 0,
  upperBodyId = 0,
  lowerBodyId = 0
} = {}) {
  const root = new THREE.Group()
  root.name = 'playerAvatar'
  root.userData.avatarHeight = height
  root.userData.avatarParts = { headId, upperBodyId, lowerBodyId }
  root.scale.setScalar(height / BUILT_AVATAR_HEIGHT)

  const skinColor = headSkinColor(headId)
  root.add(buildAvatarLowerBody(lowerBodyId, { skinColor }))
  root.add(buildAvatarUpperBody(upperBodyId, { skinColor }))
  root.add(buildAvatarHead(headId))
  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
    }
  })
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  // The terrain sample is the avatar's foot plane, not the model origin.
  // Store the authored offset once so every interchangeable lower body seats
  // from its actual boot sole rather than guessing a universal origin.
  root.userData.groundOffset = -bounds.min.y + 0.015
  return root
}

/**
 * Animate the interchangeable avatar without changing its attachment points.
 * The limbs keep their authored alignment and swing around their local X axis;
 * the root owns heading, so the model always faces its travel direction.
 */
export function updatePlayerAvatarMesh(mesh, onFootState, dt = 1 / 60) {
  if (!mesh || !onFootState) return
  const vx = Number(onFootState.velocity?.[0]) || 0
  const vz = Number(onFootState.velocity?.[2]) || 0
  const speed = Math.hypot(vx, vz)
  const moving = speed > 0.08
  const jumping = !!onFootState.jumping
  const running = moving && !!onFootState.running
  const phase = Number(onFootState.walkPhase) || 0
  const seconds = Math.max(0, Number(dt) || 0)
  const walkSwing = moving ? Math.sin(phase) * (running ? 0.68 : 0.42) : 0
  const leftArm = mesh.getObjectByName('leftUpperArm')
  const rightArm = mesh.getObjectByName('rightUpperArm')
  const leftForearm = mesh.getObjectByName('leftForearm')
  const rightForearm = mesh.getObjectByName('rightForearm')
  const leftThigh = mesh.getObjectByName('leftThigh')
  const rightThigh = mesh.getObjectByName('rightThigh')
  const leftShin = mesh.getObjectByName('leftShin')
  const rightShin = mesh.getObjectByName('rightShin')
  const animated = [leftArm, rightArm, leftForearm, rightForearm, leftThigh, rightThigh, leftShin, rightShin].filter(Boolean)
  for (const part of animated) {
    part.userData.avatarRestQuaternion ??= part.quaternion.clone()
  }
  const jumpPose = jumping
    ? Math.sin(Math.min(1, Math.max(0, Number(onFootState.jumpTime) || 0) / 0.72) * Math.PI)
    : 0
  const walkPose = [
    [leftArm, walkSwing * (running ? 1.12 : 1)],
    [rightArm, -walkSwing * (running ? 1.12 : 1)],
    [leftForearm, walkSwing * (running ? 0.28 : 0.18)],
    [rightForearm, -walkSwing * (running ? 0.28 : 0.18)],
    [leftThigh, -walkSwing * (running ? 1.18 : 0.95)],
    [rightThigh, walkSwing * (running ? 1.18 : 0.95)],
    [leftShin, walkSwing * (running ? 0.72 : 0.42)],
    [rightShin, -walkSwing * (running ? 0.72 : 0.42)]
  ]
  const pose = jumping ? [
    [leftArm, -0.85 * jumpPose],
    [rightArm, -0.85 * jumpPose],
    [leftForearm, -0.24 * jumpPose],
    [rightForearm, -0.24 * jumpPose],
    [leftThigh, -0.5 * jumpPose],
    [rightThigh, -0.5 * jumpPose],
    [leftShin, 0.8 * jumpPose],
    [rightShin, 0.8 * jumpPose]
  ] : walkPose
  for (const [part, amount] of pose) {
    if (!part) continue
    part.quaternion.copy(part.userData.avatarRestQuaternion)
    part.quaternion.multiply(_avatarAnimQ.setFromAxisAngle(_avatarAnimAxis, amount))
  }
  const bob = jumping
    ? 0
    : moving ? Math.abs(Math.sin(phase * 2)) * (running ? 0.04 : 0.018) : 0
  mesh.position.set(
    Number(onFootState.position?.[0]) || 0,
    (Number(onFootState.position?.[1]) || 0) + (Number(mesh.userData.groundOffset) || 0) + bob,
    Number(onFootState.position?.[2]) || 0
  )
  mesh.rotation.order = 'YXZ'
  mesh.rotation.set(0, Number(onFootState.heading) || 0, 0)
  // Advance one full gait cycle per physical stride, so the feet keep pace
  // with the distance travelled instead of sliding at different speeds.
  const strideLength = running ? RUN_STRIDE_METRES : WALK_STRIDE_METRES
  const animationRate = speed * (Math.PI * 2 / strideLength)
  onFootState.walkPhase = (phase + animationRate * Math.max(0, dt)) % (Math.PI * 2)
}
