import * as THREE from 'three'

// Tiny disposable survey probe: body + dish + thruster glow. Cheap geometry
// so many missions never pay for a full ship hull.
export function buildProbeMesh() {
  const group = new THREE.Group()

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x8a9bb0,
    metalness: 0.65,
    roughness: 0.35,
    flatShading: true
  })
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x3a4a5c,
    metalness: 0.5,
    roughness: 0.45,
    flatShading: true
  })
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x4fc3d9,
    transparent: true,
    opacity: 0.85
  })
  const dishMat = new THREE.MeshStandardMaterial({
    color: 0xc5d4e0,
    metalness: 0.7,
    roughness: 0.25,
    side: THREE.DoubleSide,
    flatShading: true
  })

  // Capsule-ish body (local +Z forward).
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 1.1, 8), hullMat)
  body.rotation.x = Math.PI / 2
  group.add(body)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 8), hullMat)
  nose.rotation.x = Math.PI / 2
  nose.position.z = 0.7
  group.add(nose)

  // Sensor dish on the belly — points at the scan target during hover.
  const dish = new THREE.Mesh(new THREE.CircleGeometry(0.45, 12), dishMat)
  dish.rotation.x = Math.PI / 2
  dish.position.set(0, -0.35, 0.05)
  group.add(dish)

  const dishRim = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.04, 6, 16), accentMat)
  dishRim.rotation.x = Math.PI / 2
  dishRim.position.copy(dish.position)
  group.add(dishRim)

  // Side fins.
  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.35), accentMat)
    fin.position.set(sx * 0.35, 0, -0.15)
    fin.rotation.z = sx * 0.35
    group.add(fin)
  }

  // Rear thruster glow.
  const thruster = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), glowMat)
  thruster.position.z = -0.65
  thruster.scale.set(0.7, 0.7, 1.2)
  group.add(thruster)

  // Scanning beam along local +Z (nose-forward toward the target). Stretched in update.
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.22, 1, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x66e0ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  )
  // Default cylinder is Y-up; rotate so length axis is +Z.
  beam.rotation.x = Math.PI / 2
  beam.visible = false
  group.add(beam)

  // Soft halo while scanning.
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0x4fc3d9,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  halo.visible = false
  group.add(halo)

  group.userData = { thruster, beam, halo, glowMat, spin: 0 }
  group.scale.setScalar(1.4)
  return group
}

/**
 * @param {THREE.Group} mesh
 * @param {number} dt
 * @param {{ scanning?: boolean, scanDist?: number, baseQuat?: THREE.Quaternion }} opts
 */
export function updateProbeMesh(mesh, dt, opts = {}) {
  const { thruster, beam, halo, glowMat } = mesh.userData
  mesh.userData.spin = (mesh.userData.spin ?? 0) + dt
  const t = mesh.userData.spin

  // Gentle idle roll around local +Z; applied on top of baseQuat so we don't
  // fight Three.js quaternion/euler (setting .rotation would wipe facing).
  if (opts.baseQuat) {
    const rollAmp = opts.scanning ? 0.35 : 0.12
    const roll = Math.sin(t * (opts.scanning ? 2.4 : 1.1)) * rollAmp
    const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)
    mesh.quaternion.copy(opts.baseQuat).multiply(rollQ)
  }

  if (thruster && glowMat) {
    glowMat.opacity = 0.55 + 0.35 * Math.sin(t * 14)
    thruster.scale.set(
      0.65 + 0.15 * Math.sin(t * 18),
      0.65 + 0.15 * Math.cos(t * 16),
      1.1 + 0.25 * Math.sin(t * 12)
    )
  }

  if (halo) {
    halo.visible = !!opts.scanning
    if (opts.scanning) {
      const pulse = 0.9 + 0.25 * Math.sin(t * 5)
      halo.scale.setScalar(pulse)
      halo.material.opacity = 0.08 + 0.1 * (0.5 + 0.5 * Math.sin(t * 6))
    }
  }

  if (beam) {
    if (opts.scanning) {
      const len = Math.max(2, opts.scanDist ?? 12)
      beam.visible = true
      // After rot.x = π/2, local Y is stretched along world +Z of the probe.
      beam.position.set(0, 0, 0.7 + len * 0.5)
      beam.scale.set(1, len, 1)
      beam.material.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(t * 8))
    } else {
      beam.visible = false
    }
  }
}
