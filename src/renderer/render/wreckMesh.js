import * as THREE from 'three'

// A small scattered cluster of dark, jagged chunks — the same "cheap
// icosahedron debris" technique asteroidFieldMesh.js uses for rocks, just a
// tighter/darker cluster so it reads as broken hull plating rather than a
// rock. Not seeded off the body id (wrecks aren't persisted bodies), so each
// one's exact shape is just whatever Math.random() gives it at spawn time —
// fine since nothing needs to reproduce a specific wreck's look later.
const material = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, flatShading: true })
const emberMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a2a, transparent: true, opacity: 0.8 })

export function buildWreckMesh() {
  const group = new THREE.Group()
  const chunkCount = 5 + Math.floor(Math.random() * 4)

  for (let i = 0; i < chunkCount; i++) {
    const radius = 0.8 + Math.random() * 1.8
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 0), material)
    mesh.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4)
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
    mesh.scale.y = 0.5 + Math.random() * 0.8
    group.add(mesh)
  }

  // A couple of small glowing embers for a "still smoldering" read, pulsed
  // in updateWreckMesh below.
  const embers = []
  for (let i = 0; i < 2; i++) {
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), emberMaterial.clone())
    ember.position.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3)
    group.add(ember)
    embers.push({ mesh: ember, phase: Math.random() * Math.PI * 2 })
  }
  group.userData.embers = embers
  group.userData.spinSpeed = (Math.random() - 0.5) * 0.15

  return group
}

export function updateWreckMesh(mesh, elapsed, dt) {
  mesh.rotation.y += mesh.userData.spinSpeed * dt
  for (const ember of mesh.userData.embers) {
    ember.mesh.material.opacity = 0.4 + 0.4 * Math.max(0, Math.sin(elapsed * 3 + ember.phase))
  }
}
