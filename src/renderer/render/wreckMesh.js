import * as THREE from 'three'
import { waveHeight } from '../world/sea.js'

/**
 * Floating combat wreck — debris big enough to read as a sunk boat on the sea,
 * not a handful of pebbles. Half-submerged, bobbing with the swell.
 */

const hullMat = new THREE.MeshStandardMaterial({
  color: 0x3a3834,
  roughness: 0.88,
  metalness: 0.35,
  flatShading: true
})
const rustMat = new THREE.MeshStandardMaterial({
  color: 0x6a3e28,
  roughness: 0.95,
  metalness: 0.2,
  flatShading: true
})
const darkMat = new THREE.MeshStandardMaterial({
  color: 0x1c1c1a,
  roughness: 0.9,
  metalness: 0.15,
  flatShading: true
})
const emberMat = new THREE.MeshBasicMaterial({
  color: 0xff6a2a,
  transparent: true,
  opacity: 0.75
})

/**
 * @param {{ length?: number } | null} [shipClass] sizes debris off the hull that died
 */
export function buildWreckMesh(shipClass = null) {
  const group = new THREE.Group()
  const L = Math.max(10, Math.min(36, shipClass?.hull?.length ?? 16))
  const scale = L / 16

  // Keeled hull slab — main mass, half under the waterline.
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(L * 0.22, L * 0.12, L * 0.85),
    hullMat
  )
  hull.position.set(0, -L * 0.02, 0)
  hull.rotation.z = (Math.random() - 0.5) * 0.35
  hull.rotation.x = (Math.random() - 0.5) * 0.2
  hull.castShadow = true
  hull.receiveShadow = true
  group.add(hull)

  // Broken superstructure / cabin chunk.
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(L * 0.14, L * 0.1, L * 0.22),
    darkMat
  )
  cabin.position.set(
    (Math.random() - 0.5) * L * 0.08,
    L * 0.04,
    (Math.random() - 0.35) * L * 0.2
  )
  cabin.rotation.y = (Math.random() - 0.5) * 0.8
  cabin.castShadow = true
  group.add(cabin)

  // Scattered plating / spars around the hulk.
  const scraps = 4 + Math.floor(Math.random() * 4)
  for (let i = 0; i < scraps; i++) {
    const r = (0.6 + Math.random() * 1.4) * scale
    const piece = new THREE.Mesh(
      new THREE.IcosahedronGeometry(r, 0),
      Math.random() < 0.45 ? rustMat : hullMat
    )
    piece.position.set(
      (Math.random() - 0.5) * L * 0.55,
      (Math.random() - 0.6) * L * 0.08,
      (Math.random() - 0.5) * L * 0.7
    )
    piece.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    piece.scale.set(1 + Math.random(), 0.35 + Math.random() * 0.5, 0.7 + Math.random())
    piece.castShadow = true
    group.add(piece)
  }

  // Mast / spar sticking up.
  if (Math.random() < 0.7) {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, L * 0.45, 5),
      rustMat
    )
    mast.position.set(L * 0.02, L * 0.12, -L * 0.1)
    mast.rotation.z = 0.4 + Math.random() * 0.5
    mast.rotation.x = (Math.random() - 0.5) * 0.4
    mast.castShadow = true
    group.add(mast)
  }

  const embers = []
  for (let i = 0; i < 3; i++) {
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.35 * scale, 6, 4),
      emberMat.clone()
    )
    ember.position.set(
      (Math.random() - 0.5) * L * 0.25,
      L * 0.02 + Math.random() * L * 0.06,
      (Math.random() - 0.5) * L * 0.3
    )
    group.add(ember)
    embers.push({ mesh: ember, phase: Math.random() * Math.PI * 2 })
  }

  group.userData.embers = embers
  group.userData.bobPhase = Math.random() * Math.PI * 2
  group.userData.bobAmp = 0.25 + Math.random() * 0.2
  group.userData.rollAmp = 0.04 + Math.random() * 0.05
  group.userData.spinSpeed = (Math.random() - 0.5) * 0.04
  group.rotation.y = Math.random() * Math.PI * 2

  return group
}

/**
 * Bob on the swell and pulse embers.
 * @param {THREE.Object3D} mesh
 * @param {number} elapsed sim time
 * @param {number} dt
 * @param {number[]|null} [worldPos] wreck [x,y,z] — y is overwritten to sea height
 */
export function updateWreckMesh(mesh, elapsed, dt, worldPos = null) {
  const ud = mesh.userData
  if (worldPos) {
    const x = worldPos[0]
    const z = worldPos[2]
    const seaY = waveHeight(x, z, elapsed)
    worldPos[1] = seaY
    mesh.position.set(
      x,
      seaY + Math.sin(elapsed * 1.1 + ud.bobPhase) * (ud.bobAmp ?? 0.3),
      z
    )
    mesh.rotation.z = Math.sin(elapsed * 0.7 + ud.bobPhase) * (ud.rollAmp ?? 0.05)
    mesh.rotation.x = Math.sin(elapsed * 0.55 + ud.bobPhase * 1.3) * (ud.rollAmp ?? 0.05) * 0.6
  }
  mesh.rotation.y += (ud.spinSpeed ?? 0) * dt
  for (const ember of ud.embers ?? []) {
    ember.mesh.material.opacity =
      0.35 + 0.45 * Math.max(0, Math.sin(elapsed * 2.4 + ember.phase))
  }
}
