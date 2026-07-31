import * as THREE from 'three'

const FLOCK_PERIOD_S = 70
const FLOCK_DURATION_S = 19
const HIT_RADIUS = 1.25
const _segment = new THREE.Vector3()
const _toGull = new THREE.Vector3()
const _closest = new THREE.Vector3()
const _gullWorldPosition = new THREE.Vector3()

export function gullFlockActiveAt(simTime) {
  return ((Number(simTime) || 0) % FLOCK_PERIOD_S) < FLOCK_DURATION_S
}

/** A small, procedural flock: two wing triangles and a dark body per gull. */
export function createGullFlock() {
  const group = new THREE.Group()
  group.name = 'seagull-flock'
  group.visible = false
  group.userData.fleeUntil = -Infinity
  group.userData.lastSquawkAt = -Infinity
  const wingGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-1.15, 0, 0), new THREE.Vector3(0, 0.08, 0.16), new THREE.Vector3(0.96, 0, 0)
  ])
  wingGeo.setIndex([0, 1, 2])
  const wingMat = new THREE.MeshBasicMaterial({ color: 0xe9e6db, side: THREE.DoubleSide, fog: true })
  const bodyGeo = new THREE.ConeGeometry(0.08, 0.42, 4)
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0x44423d, fog: true })

  for (let i = 0; i < 7; i++) {
    const gull = new THREE.Group()
    gull.add(new THREE.Mesh(wingGeo, wingMat))
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.rotation.x = Math.PI / 2
    body.position.y = -0.035
    gull.add(body)
    gull.userData.phase = i * 1.71
    gull.userData.radius = 8 + (i % 3) * 5
    group.add(gull)
  }
  return group
}

/** Returns true while the flock is close enough for its calls to be audible. */
export function updateGullFlock(group, playerPosition, simTime) {
  const active = gullFlockActiveAt(simTime)
  group.visible = active
  if (!active) return false

  const t = Number(simTime) || 0
  const cycle = Math.floor(t / FLOCK_PERIOD_S)
  const px = playerPosition?.[0] ?? 0
  const pz = playerPosition?.[2] ?? 0
  const bearing = cycle * 2.41
  const fleeing = t < group.userData.fleeUntil
  const flockDistance = fleeing ? 420 : 145
  group.position.set(px + Math.sin(bearing) * flockDistance, 58 + Math.sin(t * 0.19) * 8, pz + Math.cos(bearing) * flockDistance)
  for (const gull of group.children) {
    gull.visible = t >= (gull.userData.goneUntil ?? -Infinity)
    if (!gull.visible) continue
    const phase = gull.userData.phase
    const radius = gull.userData.radius
    const orbit = t * (fleeing ? 0.56 : 0.22) + phase
    gull.position.set(Math.cos(orbit) * radius, Math.sin(t * 0.9 + phase) * 2, Math.sin(orbit) * radius)
    gull.rotation.set(Math.sin(t * (fleeing ? 12 : 7.5) + phase) * 0.42, -orbit, 0)
  }
  return true
}

/**
 * Ambient gulls are deliberately not game entities. A shot only gives the
 * flock a reaction: one bird disappears and the rest fly farther away.
 */
export function tryHitGullFlock(group, from, to, simTime) {
  if (!group?.visible) return false
  const t = Number(simTime) || 0
  if (t < (group.userData.lastSquawkAt ?? -Infinity) + 0.15) return false

  _segment.subVectors(to, from)
  const lengthSq = _segment.lengthSq()
  if (lengthSq === 0) return false
  group.updateWorldMatrix(true, true)

  for (const gull of group.children) {
    if (!gull.visible || t < (gull.userData.goneUntil ?? -Infinity)) continue
    gull.getWorldPosition(_gullWorldPosition)
    _toGull.subVectors(_gullWorldPosition, from)
    const along = THREE.MathUtils.clamp(_toGull.dot(_segment) / lengthSq, 0, 1)
    _closest.copy(_segment).multiplyScalar(along).add(from)
    if (_closest.distanceToSquared(_gullWorldPosition) > HIT_RADIUS * HIT_RADIUS) continue

    gull.visible = false
    gull.userData.goneUntil = t + 7
    group.userData.fleeUntil = t + 5
    group.userData.lastSquawkAt = t
    return true
  }
  return false
}
