/**
 * World meshes for fully-scanned Spatial Anomaly sites.
 * Datacore: central relic + locked-crate nodules (Tab-target + F to hack).
 * Alien base: organic habitat cluster once waves clear.
 */
import * as THREE from 'three'
import { stationMaterialMaps } from './textures.js'

const BASE_MAT = new THREE.MeshStandardMaterial({
  color: 0x3a6a40,
  emissive: 0x1a3a20,
  emissiveIntensity: 0.55,
  metalness: 0.1,
  roughness: 0.65
})

// Nodule swing-open angle (radians) once a hack succeeds.
const LID_OPEN_ANGLE = 1.95
const LID_OPEN_DURATION_S = 0.8

// Crate body/lid stay a neutral metal sheen regardless of status — only the
// front lock + beacon marker change colour (dims once unsealed) so the tell
// is the lock, not a cyan-tinted crate.
// No 'destroyed' entry — a failed hack removes the nodule outright (see
// applyDatacoreNoduleFail) rather than leaving inert debris behind.
const HUMAN_PALETTE = {
  sealed: { marker: 0x60f0ff, markerOpacity: 0.55 },
  open: { marker: 0x80ffb0, markerOpacity: 0.18 }
}
const ALIEN_PALETTE = {
  sealed: { marker: 0xd0a0ff, markerOpacity: 0.55 },
  open: { marker: 0x90ffb0, markerOpacity: 0.18 }
}

/**
 * @param {object} anomaly fully-scanned datacore-family site
 * @returns {THREE.Group}
 */
export function buildDatacoreSiteMesh(anomaly) {
  const alien = anomaly.type === 'alien_datacore'
  const group = new THREE.Group()
  group.userData.kind = 'datacore'
  group.userData.anomalyId = anomaly.id
  group.userData.noduleMeshes = new Map()

  const origin = anomaly.position
  group.position.set(origin[0], origin[1], origin[2])

  // No central relic beacon — just the cluster of hackable crate nodules;
  // a big glowing centerpiece read as an unwanted "purple blob" from range.
  for (const n of anomaly.nodules ?? []) {
    const nGroup = buildNoduleMesh(n, alien)
    // Positions are world-space; convert to local relative to site origin.
    nGroup.position.set(
      n.position[0] - origin[0],
      n.position[1] - origin[1],
      n.position[2] - origin[2]
    )
    group.add(nGroup)
    group.userData.noduleMeshes.set(n.id, nGroup)
  }

  return group
}

/** Locked-crate nodule — hinge-lid pops open with an animation on hack success. */
function buildNoduleMesh(nodule, alien = false) {
  const g = new THREE.Group()
  g.userData.noduleId = nodule.id
  g.userData.alien = alien

  // Reuse the station plating role for a real metal (or alien chitin-plate)
  // texture instead of a flat-shaded material; palette tint still layers on
  // top via material.color, which multiplies the map.
  // Neutral metal sheen, not status-tinted — the lock/beacon carry the sealed
  // vs. open colour instead of dyeing the whole crate.
  const maps = stationMaterialMaps(alien ? 'alienPlate' : 'floor', 0.9)
  const matOpts = {
    color: alien ? 0x9aa8a0 : 0x9aa0a8,
    metalness: alien ? 0.35 : 0.55,
    roughness: alien ? 0.55 : 0.5,
    ...maps
  }

  // Small enough to read as a hackable object, not a shipping container.
  const bodyGeo = alien ? new THREE.DodecahedronGeometry(13, 0) : new THREE.BoxGeometry(22, 18, 22)
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial(matOpts))
  g.add(body)

  // Edge frame reads as a machined, locked crate — organic pods skip it.
  if (!alien) {
    body.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(bodyGeo),
        new THREE.LineBasicMaterial({ color: 0x203040, transparent: true, opacity: 0.8 })
      )
    )
  }

  // Lid hinges open on hack success — pivot sits at the back edge so it
  // swings up rather than spinning around the crate's own centre.
  const lidPivot = new THREE.Group()
  lidPivot.position.set(0, alien ? 5 : 8, alien ? -5 : -10)
  const lidGeo = alien ? new THREE.ConeGeometry(9, 10, 6) : new THREE.BoxGeometry(22, 5, 22)
  const lid = new THREE.Mesh(lidGeo, new THREE.MeshStandardMaterial(matOpts))
  lid.position.set(0, alien ? 5 : 2.5, alien ? 5 : 10)
  if (alien) lid.rotation.x = Math.PI / 2
  lidPivot.add(lid)
  g.add(lidPivot)

  // Front lock indicator — the visible "sealed" tell.
  const lock = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 10, 8),
    new THREE.MeshBasicMaterial({ transparent: true })
  )
  lock.position.set(0, 0, alien ? 13 : 12)
  g.add(lock)
  // Thin marker beacon so the nodule reads from a distance among the cluster.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 45, 6),
    new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
  )
  beacon.position.y = alien ? 17 : 20
  g.add(beacon)

  g.userData.body = body
  g.userData.lid = lid
  g.userData.lidPivot = lidPivot
  g.userData.lock = lock
  g.userData.beacon = beacon
  // Already-open nodules (revisiting a site after hacking it earlier) skip
  // the animation and start in their final open pose.
  g.userData.openT = nodule.status === 'open' ? 1 : 0
  if (nodule.status === 'open') lidPivot.rotation.x = -LID_OPEN_ANGLE
  applyNoduleStatus(g, nodule.status ?? 'sealed')
  return g
}

function applyNoduleStatus(mesh, status) {
  const palette = ((mesh.userData.alien ? ALIEN_PALETTE : HUMAN_PALETTE)[status]) ?? HUMAN_PALETTE.sealed
  if (mesh.userData.lock?.material) {
    mesh.userData.lock.material.color.setHex(palette.marker)
    mesh.userData.lock.material.opacity = palette.markerOpacity
  }
  if (mesh.userData.beacon?.material) {
    mesh.userData.beacon.material.color.setHex(palette.marker)
    mesh.userData.beacon.material.opacity = palette.markerOpacity
  }
  mesh.userData.status = status
}

/**
 * @param {THREE.Group} group
 * @param {object} anomaly
 * @param {number} simTime
 * @param {number} dt
 */
export function updateDatacoreSiteMesh(group, anomaly, simTime, dt) {
  if (!group || group.userData.kind !== 'datacore') return
  const t = simTime ?? 0
  // A failed hack removes the nodule from anomaly.nodules entirely (it blew
  // up) — drop and dispose any mesh whose nodule is no longer in the list.
  const liveIds = new Set((anomaly.nodules ?? []).map((n) => n.id))
  for (const [id, nm] of group.userData.noduleMeshes) {
    if (liveIds.has(id)) continue
    group.remove(nm)
    disposeAnomalySiteMesh(nm)
    group.userData.noduleMeshes.delete(id)
  }
  for (const n of anomaly.nodules ?? []) {
    const nm = group.userData.noduleMeshes?.get(n.id)
    if (!nm) continue
    if (nm.userData.status !== n.status) applyNoduleStatus(nm, n.status)
    if (n.status === 'sealed') {
      nm.rotation.y += dt * 0.9
      const pulse = 1 + 0.15 * Math.sin(t * 3 + (nm.userData.phase ?? 0))
      if (nm.userData.lock) nm.userData.lock.scale.setScalar(pulse)
    } else if (n.status === 'open' && nm.userData.openT < 1) {
      nm.userData.openT = Math.min(1, nm.userData.openT + dt / LID_OPEN_DURATION_S)
      const e = nm.userData.openT * (2 - nm.userData.openT) // ease-out
      nm.userData.lidPivot.rotation.x = -LID_OPEN_ANGLE * e
    }
  }
}

/**
 * Alien base — organic habitat cluster (shown when waves cleared / base exposed).
 * @param {number[]} position world pos
 */
export function buildAlienBaseMesh(position) {
  const group = new THREE.Group()
  group.userData.kind = 'alien_base'
  group.position.set(position[0], position[1], position[2])

  // Irregular cluster of bulbous pods rather than one machined hull — reads
  // as grown, not manufactured.
  const podSeeds = [
    [0, 0, 0, 95],
    [70, 20, 40, 55],
    [-60, -15, 55, 48],
    [30, 55, -50, 42],
    [-45, 40, -30, 50]
  ]
  const pods = []
  for (const [x, y, z, r] of podSeeds) {
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), BASE_MAT)
    pod.position.set(x, y, z)
    group.add(pod)
    pods.push(pod)
  }

  // Vein overlay — organic wireframe instead of a machined spike shell.
  const veins = new THREE.Mesh(
    new THREE.IcosahedronGeometry(150, 1),
    new THREE.MeshBasicMaterial({ color: 0x50ff90, wireframe: true, transparent: true, opacity: 0.35 })
  )
  group.add(veins)
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(140, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x50ff90, transparent: true, opacity: 0.18, depthWrite: false })
  )
  group.add(glow)
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 18, 500, 8),
    new THREE.MeshBasicMaterial({ color: 0x70ffb0, transparent: true, opacity: 0.4, depthWrite: false })
  )
  beam.position.y = 200
  group.add(beam)

  // Bioluminescent pulse points on each pod.
  const spores = []
  for (const pod of pods) {
    const spore = new THREE.Mesh(
      new THREE.SphereGeometry(pod.geometry.parameters.radius * 0.18, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x90ffb0, transparent: true, opacity: 0.8 })
    )
    spore.position.copy(pod.position).multiplyScalar(1.02)
    group.add(spore)
    spores.push(spore)
  }

  group.userData.pods = pods
  group.userData.veins = veins
  group.userData.spores = spores
  return group
}

export function updateAlienBaseMesh(group, simTime, dt) {
  if (!group || group.userData.kind !== 'alien_base') return
  const t = simTime ?? 0
  const pods = group.userData.pods ?? []
  for (let i = 0; i < pods.length; i++) {
    // Slow organic breathing — pods swell/shrink slightly out of phase.
    const s = 1 + 0.05 * Math.sin(t * 1.1 + i * 1.7)
    pods[i].scale.setScalar(s)
  }
  if (group.userData.veins) group.userData.veins.rotation.y += dt * 0.08
  const spores = group.userData.spores ?? []
  for (let i = 0; i < spores.length; i++) {
    spores[i].material.opacity = 0.5 + 0.4 * Math.sin(t * 2.4 + i * 2.1)
  }
}

export function disposeAnomalySiteMesh(group) {
  if (!group) return
  const shared = [BASE_MAT]
  group.traverse((c) => {
    c.geometry?.dispose?.()
    if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.())
    else if (c.material && !shared.includes(c.material)) {
      c.material.dispose?.()
    }
  })
}
