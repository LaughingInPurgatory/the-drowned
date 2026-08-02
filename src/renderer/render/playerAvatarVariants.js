import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

const UP = new THREE.Vector3(0, 1, 0)

export const HEAD_VARIATIONS = [
  { id: 'head-m1', name: 'Black crop', gender: 'male', skin: 0x9b654e, hair: 0x211d1a, eyes: 0x3d2118, style: 'crop', face: 1.02 },
  { id: 'head-m2', name: 'Ginger beard', gender: 'male', skin: 0xc48968, hair: 0x8a4127, eyes: 0x4c6d72, style: 'crop', beard: true, face: 1.04 },
  { id: 'head-m3', name: 'Shaved scar', gender: 'male', skin: 0x704735, hair: 0x393532, eyes: 0x25201c, style: 'shaved', scar: true, face: 1.08 },
  { id: 'head-m4', name: 'Silver crop', gender: 'male', skin: 0xd29b79, hair: 0x8d9692, eyes: 0x6d7778, style: 'silver', face: 1.0 },
  { id: 'head-m5', name: 'Dark curls', gender: 'male', skin: 0x5f382b, hair: 0x181514, eyes: 0x332019, style: 'curls', beard: true, face: 1.03 },
  { id: 'head-f1', name: 'Auburn bob', gender: 'female', skin: 0xd59b7b, hair: 0x793b2b, eyes: 0x4d626b, style: 'bob', freckles: true, face: 0.96, lashes: true },
  { id: 'head-f2', name: 'Black braid', gender: 'female', skin: 0x8e5a43, hair: 0x1d1818, eyes: 0x342019, style: 'braid', face: 0.98, lashes: true },
  { id: 'head-f3', name: 'Blonde ponytail', gender: 'female', skin: 0xf0bd95, hair: 0xb9783d, eyes: 0x5d777d, style: 'ponytail', freckles: true, face: 0.95, lashes: true },
  { id: 'head-f4', name: 'Silver buzz', gender: 'female', skin: 0x9f684f, hair: 0xb5bbb4, eyes: 0x342924, style: 'silver', scar: true, face: 0.99, lashes: true },
  { id: 'head-f5', name: 'Brown bun', gender: 'female', skin: 0xc47f61, hair: 0x4a251c, eyes: 0x4e2b21, style: 'bun', face: 0.97, lashes: true, earrings: true }
]

export const UPPER_BODY_VARIATIONS = [
  { id: 'upper-m1', name: 'Navy deck jacket', gender: 'male', torso: 0x293c42, trim: 0xc59c4e, accent: 0x17262b, accessory: 'backpack' },
  { id: 'upper-m2', name: 'Rust oilskin', gender: 'male', torso: 0x57392e, trim: 0xe09b4b, accent: 0x251d1a, accessory: 'scarf' },
  { id: 'upper-m3', name: 'Grey surveyor', gender: 'male', torso: 0x606a69, trim: 0xd0b45d, accent: 0x313838, accessory: 'radio' },
  { id: 'upper-m4', name: 'Green fisher', gender: 'male', torso: 0x3e5746, trim: 0xd47a3c, accent: 0x1e2d25, accessory: 'toolbelt' },
  { id: 'upper-m5', name: 'Black mechanic', gender: 'male', torso: 0x292d31, trim: 0x8d9a9b, accent: 0x15191b, accessory: 'harness' },
  { id: 'upper-f1', name: 'Teal deckhand', gender: 'female', torso: 0x2d5c60, trim: 0xe0a94a, accent: 0x17373a, accessory: 'backpack', chest: true },
  { id: 'upper-f2', name: 'Red salvager', gender: 'female', torso: 0x6b3630, trim: 0xe2a84d, accent: 0x311c1d, accessory: 'medkit', chest: true },
  { id: 'upper-f3', name: 'Mustard explorer', gender: 'female', torso: 0xa37632, trim: 0x283c43, accent: 0x4e381f, accessory: 'binoculars', chest: true },
  { id: 'upper-f4', name: 'Weather shell', gender: 'female', torso: 0x8b9b9a, trim: 0x51788c, accent: 0x394b50, accessory: 'slingpack', chest: true },
  { id: 'upper-f5', name: 'Plum engineer', gender: 'female', torso: 0x553b5e, trim: 0xd18a4a, accent: 0x292036, accessory: 'module', chest: true }
]

export const LOWER_BODY_VARIATIONS = [
  { id: 'lower-m1', name: 'Dark work trousers', gender: 'male', kind: 'trousers', cloth: 0x30383a, boot: 0x202628, detail: 'knee' },
  { id: 'lower-m2', name: 'Slate cargo trousers', gender: 'male', kind: 'trousers', cloth: 0x4d5756, boot: 0x353638, detail: 'cargo' },
  { id: 'lower-m3', name: 'Sand deck shorts', gender: 'male', kind: 'shorts', cloth: 0x927452, boot: 0x513e32, detail: 'pocket' },
  { id: 'lower-m4', name: 'Oilskin bibs', gender: 'male', kind: 'trousers', cloth: 0x283735, boot: 0x1f2929, detail: 'bib' },
  { id: 'lower-m5', name: 'Navy utility trousers', gender: 'male', kind: 'trousers', cloth: 0x29394a, boot: 0x1d252b, detail: 'strap' },
  { id: 'lower-f1', name: 'Rust cargo trousers', gender: 'female', kind: 'trousers', cloth: 0x70423a, boot: 0x302526, detail: 'cargo' },
  { id: 'lower-f2', name: 'Teal utility shorts', gender: 'female', kind: 'shorts', cloth: 0x356367, boot: 0x263a3c, detail: 'pocket' },
  { id: 'lower-f3', name: 'Denim work skirt', gender: 'female', kind: 'skirt', cloth: 0x3b5360, boot: 0x2b3032, detail: 'hem' },
  { id: 'lower-f4', name: 'Grey expedition skirt', gender: 'female', kind: 'skirt', cloth: 0x676b69, boot: 0x3a4140, detail: 'belt' },
  { id: 'lower-f5', name: 'Plum cut-offs', gender: 'female', kind: 'shorts', cloth: 0x613e64, boot: 0x302331, detail: 'strap' }
]

export function normalizeAvatarSelection(value = null) {
  const pickIndex = (key) => {
    const n = Number(value?.[key])
    return Number.isFinite(n) ? Math.max(0, Math.min(9, Math.floor(n))) : 0
  }
  return {
    headId: pickIndex('headId'),
    upperBodyId: pickIndex('upperBodyId'),
    lowerBodyId: pickIndex('lowerBodyId')
  }
}

export function randomAvatarSelection(rng = Math.random) {
  const roll = () => Math.floor(Math.max(0, Math.min(0.999999, Number(rng()) || 0)) * 10)
  return { headId: roll(), upperBodyId: roll(), lowerBodyId: roll() }
}

function material(color, roughness = 0.86, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function pick(list, value) {
  if (typeof value === 'string') return list.find((item) => item.id === value) ?? list[0]
  return list[Math.max(0, Math.min(list.length - 1, Number(value) || 0))]
}

function addMesh(group, geometry, mat, name, position, scale) {
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.name = name
  if (position) mesh.position.copy(position)
  if (scale) mesh.scale.copy(scale)
  group.add(mesh)
  return mesh
}

function limbSegment(parent, start, end, radius, mat, name) {
  const direction = end.clone().sub(start)
  const pivot = new THREE.Group()
  pivot.name = name
  pivot.position.copy(start)
  parent.add(pivot)
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.86, radius, direction.length(), 10, 1),
    mat
  )
  mesh.name = `${name}Mesh`
  mesh.position.copy(direction).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize())
  pivot.add(mesh)
  return pivot
}

function limbChain(parent, a, b, c, upperRadius, upperMat, upperName, lowerRadius, lowerMat, lowerName) {
  const upper = limbSegment(parent, a, b, upperRadius, upperMat, upperName)
  const lower = limbSegment(
    upper,
    b.clone().sub(a),
    c.clone().sub(a),
    lowerRadius,
    lowerMat,
    lowerName
  )
  return { upper, lower }
}

function addLimbEnd(parent, position, mat, name) {
  return addMesh(
    parent,
    new THREE.SphereGeometry(0.075, 12, 8),
    mat,
    name,
    position
  )
}

function addHair(group, cfg, hairMat) {
  const crown = addMesh(
    group,
    new THREE.SphereGeometry(0.155, 20, 12),
    hairMat,
    'hair',
    new THREE.Vector3(0, 1.93, 0.005),
    new THREE.Vector3(1.02, 0.58, 0.96)
  )
  addMesh(group, new THREE.SphereGeometry(0.15, 18, 12), hairMat, 'backHair', new THREE.Vector3(0, 1.81, -0.085), new THREE.Vector3(1, 0.76, 0.58))

  if (cfg.style === 'shaved') {
    crown.scale.set(0.98, 0.42, 0.9)
  } else if (cfg.style === 'curls') {
    for (let i = 0; i < 7; i++) {
      const angle = (i / 7) * Math.PI * 2
      addMesh(group, new THREE.SphereGeometry(0.052, 10, 8), hairMat, `curl${i}`, new THREE.Vector3(Math.cos(angle) * 0.12, 1.91 + (i % 2) * 0.025, Math.sin(angle) * 0.08), new THREE.Vector3(1, 1.1, 0.8))
    }
  } else if (cfg.style === 'bob') {
    addMesh(group, new THREE.SphereGeometry(0.105, 14, 10), hairMat, 'leftBob', new THREE.Vector3(-0.13, 1.80, -0.01), new THREE.Vector3(0.7, 1.1, 0.78))
    addMesh(group, new THREE.SphereGeometry(0.105, 14, 10), hairMat, 'rightBob', new THREE.Vector3(0.13, 1.80, -0.01), new THREE.Vector3(0.7, 1.1, 0.78))
  } else if (cfg.style === 'braid') {
    for (let i = 0; i < 4; i++) {
      addMesh(group, new THREE.SphereGeometry(0.047, 10, 8), hairMat, `braid${i}`, new THREE.Vector3(0.145, 1.80 - i * 0.065, -0.12 - i * 0.012), new THREE.Vector3(0.82, 1, 0.72))
    }
  } else if (cfg.style === 'ponytail') {
    addMesh(group, new THREE.SphereGeometry(0.075, 14, 10), hairMat, 'ponytail', new THREE.Vector3(0.02, 1.79, -0.17), new THREE.Vector3(0.8, 1.55, 0.8))
  } else if (cfg.style === 'bun') {
    addMesh(group, new THREE.SphereGeometry(0.085, 14, 10), hairMat, 'bun', new THREE.Vector3(0, 2.01, -0.08), new THREE.Vector3(1, 0.9, 0.85))
  }
}

export function buildAvatarHead(value = 0) {
  const cfg = pick(HEAD_VARIATIONS, value)
  const group = new THREE.Group()
  group.name = `headVariation:${cfg.id}`
  group.userData.variation = cfg

  const skin = material(cfg.skin, 0.9)
  const skinShadow = material(new THREE.Color(cfg.skin).multiplyScalar(0.74), 0.94)
  const hair = material(cfg.hair, 0.96)
  const eye = material(0x171718, 0.55)
  const eyeWhite = material(0xcac4b7, 0.86)
  const lip = material(cfg.gender === 'female' ? 0x8d5551 : 0x794c45, 0.9)

  const headProfile = [
    new THREE.Vector2(0.052, 0.00),
    new THREE.Vector2(0.105, 0.018),
    new THREE.Vector2(0.132, 0.075),
    new THREE.Vector2(0.146, 0.15),
    new THREE.Vector2(0.148, 0.245),
    new THREE.Vector2(0.139, 0.32),
    new THREE.Vector2(0.112, 0.375),
    new THREE.Vector2(0.055, 0.405),
    new THREE.Vector2(0, 0.405)
  ]
  addMesh(group, new THREE.LatheGeometry(headProfile, 20), skin, 'head', new THREE.Vector3(0, 1.58, 0), new THREE.Vector3(cfg.face, 1, 0.9))
  addHair(group, cfg, hair)
  addMesh(group, new THREE.BoxGeometry(0.028, 0.09, 0.025), hair, 'leftSideburn', new THREE.Vector3(-0.135, 1.77, 0.02))
  addMesh(group, new THREE.BoxGeometry(0.028, 0.09, 0.025), hair, 'rightSideburn', new THREE.Vector3(0.135, 1.77, 0.02))
  addMesh(group, new THREE.SphereGeometry(0.035, 12, 8), skinShadow, 'leftEar', new THREE.Vector3(-0.145, 1.78, 0.01), new THREE.Vector3(0.7, 1, 0.75))
  addMesh(group, new THREE.SphereGeometry(0.035, 12, 8), skinShadow, 'rightEar', new THREE.Vector3(0.145, 1.78, 0.01), new THREE.Vector3(0.7, 1, 0.75))

  addMesh(group, new THREE.SphereGeometry(0.021, 10, 8), skinShadow, 'leftEyeSocket', new THREE.Vector3(-0.05 * cfg.face, 1.80, 0.127), new THREE.Vector3(1.15, 0.75, 0.42))
  addMesh(group, new THREE.SphereGeometry(0.021, 10, 8), skinShadow, 'rightEyeSocket', new THREE.Vector3(0.05 * cfg.face, 1.80, 0.127), new THREE.Vector3(1.15, 0.75, 0.42))
  addMesh(group, new THREE.SphereGeometry(0.011, 10, 8), eyeWhite, 'leftEyeWhite', new THREE.Vector3(-0.05 * cfg.face, 1.80, 0.139))
  addMesh(group, new THREE.SphereGeometry(0.011, 10, 8), eyeWhite, 'rightEyeWhite', new THREE.Vector3(0.05 * cfg.face, 1.80, 0.139))
  addMesh(group, new THREE.SphereGeometry(0.005, 8, 6), eye, 'leftPupil', new THREE.Vector3(-0.05 * cfg.face, 1.80, 0.149))
  addMesh(group, new THREE.SphereGeometry(0.005, 8, 6), eye, 'rightPupil', new THREE.Vector3(0.05 * cfg.face, 1.80, 0.149))
  const leftBrow = addMesh(group, new THREE.BoxGeometry(0.034, 0.006, 0.008), hair, 'leftBrow', new THREE.Vector3(-0.05 * cfg.face, 1.832, 0.14))
  const rightBrow = addMesh(group, new THREE.BoxGeometry(0.034, 0.006, 0.008), hair, 'rightBrow', new THREE.Vector3(0.05 * cfg.face, 1.832, 0.14))
  leftBrow.rotation.z = -0.1
  rightBrow.rotation.z = 0.1
  addMesh(group, new THREE.BoxGeometry(0.018, 0.06, 0.018), skin, 'noseBridge', new THREE.Vector3(0, 1.765, 0.14))
  addMesh(group, new THREE.SphereGeometry(0.021, 10, 8), skinShadow, 'noseTip', new THREE.Vector3(0, 1.735, 0.164), new THREE.Vector3(0.9, 0.8, 0.8))
  addMesh(group, new THREE.SphereGeometry(0.006, 8, 6), eye, 'leftNostril', new THREE.Vector3(-0.009, 1.731, 0.18))
  addMesh(group, new THREE.SphereGeometry(0.006, 8, 6), eye, 'rightNostril', new THREE.Vector3(0.009, 1.731, 0.18))
  addMesh(group, new THREE.SphereGeometry(0.026, 10, 8), lip, 'upperLip', new THREE.Vector3(0, 1.695, 0.145), new THREE.Vector3(1.1, 0.35, 0.4))
  addMesh(group, new THREE.SphereGeometry(0.023, 10, 8), skin, 'lowerLip', new THREE.Vector3(0, 1.678, 0.147), new THREE.Vector3(1.05, 0.36, 0.42))

  if (cfg.beard) {
    addMesh(group, new THREE.SphereGeometry(0.12, 16, 10), hair, 'beard', new THREE.Vector3(0, 1.69, 0.105), new THREE.Vector3(0.92, 0.7, 0.4))
    addMesh(group, new THREE.BoxGeometry(0.025, 0.02, 0.012), hair, 'moustacheLeft', new THREE.Vector3(-0.018, 1.70, 0.155))
    addMesh(group, new THREE.BoxGeometry(0.025, 0.02, 0.012), hair, 'moustacheRight', new THREE.Vector3(0.018, 1.70, 0.155))
  }
  if (cfg.freckles) {
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1
      addMesh(group, new THREE.SphereGeometry(0.004, 6, 4), skinShadow, `freckle${i}`, new THREE.Vector3(side * (0.065 + (i % 3) * 0.012), 1.735 + (i % 2) * 0.018, 0.145))
    }
  }
  if (cfg.scar) {
    const scar = addMesh(group, new THREE.BoxGeometry(0.009, 0.055, 0.012), skinShadow, 'scar', new THREE.Vector3(0.075, 1.75, 0.14))
    scar.rotation.z = -0.35
  }
  if (cfg.lashes) {
    addMesh(group, new THREE.BoxGeometry(0.042, 0.006, 0.008), hair, 'leftLashes', new THREE.Vector3(-0.05, 1.818, 0.14))
    addMesh(group, new THREE.BoxGeometry(0.042, 0.006, 0.008), hair, 'rightLashes', new THREE.Vector3(0.05, 1.818, 0.14))
  }
  if (cfg.earrings) {
    const metal = material(0xd1a75c, 0.35, 0.7)
    addMesh(group, new THREE.SphereGeometry(0.012, 8, 6), metal, 'leftEarring', new THREE.Vector3(-0.15, 1.74, 0.025))
    addMesh(group, new THREE.SphereGeometry(0.012, 8, 6), metal, 'rightEarring', new THREE.Vector3(0.15, 1.74, 0.025))
  }
  return group
}

export function buildAvatarUpperBody(value = 0, { skinColor = 0xb98268 } = {}) {
  const cfg = pick(UPPER_BODY_VARIATIONS, value)
  const group = new THREE.Group()
  group.name = `upperBodyVariation:${cfg.id}`
  group.userData.variation = cfg
  const torso = material(cfg.torso, 0.88)
  const trim = material(cfg.trim, 0.7)
  const accent = material(cfg.accent, 0.92)
  const skin = material(skinColor, 0.9)

  addMesh(group, new THREE.CylinderGeometry(0.23, 0.275, 0.68, 12), torso, 'jacketBody', new THREE.Vector3(0, 1.14, 0), new THREE.Vector3(1, 1, 0.72))
  addMesh(group, new THREE.CylinderGeometry(0.105, 0.12, 0.13, 12), accent, 'collar', new THREE.Vector3(0, 1.50, 0))
  addMesh(group, new THREE.BoxGeometry(0.035, 0.48, 0.025), trim, 'jacketZip', new THREE.Vector3(0, 1.16, 0.178))
  addMesh(group, new THREE.BoxGeometry(0.41, 0.045, 0.025), trim, 'jacketStripe', new THREE.Vector3(0, 1.12, 0.178))
  addMesh(group, new THREE.BoxGeometry(0.13, 0.18, 0.025), accent, 'chestPocket', new THREE.Vector3(-0.14, 1.31, 0.18))
  addMesh(group, new THREE.BoxGeometry(0.17, 0.08, 0.32), torso, 'leftShoulder', new THREE.Vector3(-0.20, 1.47, 0))
  addMesh(group, new THREE.BoxGeometry(0.17, 0.08, 0.32), torso, 'rightShoulder', new THREE.Vector3(0.20, 1.47, 0))

  if (cfg.chest) {
    addMesh(group, new THREE.SphereGeometry(0.13, 16, 12), torso, 'leftChest', new THREE.Vector3(-0.11, 1.27, 0.19), new THREE.Vector3(0.95, 0.9, 0.75))
    addMesh(group, new THREE.SphereGeometry(0.13, 16, 12), torso, 'rightChest', new THREE.Vector3(0.11, 1.27, 0.19), new THREE.Vector3(0.95, 0.9, 0.75))
  }

  const leftShoulder = new THREE.Vector3(-0.29, 1.47, 0.01)
  const leftElbow = new THREE.Vector3(-0.39, 1.17, 0.055)
  const leftHand = new THREE.Vector3(-0.43, 0.91, 0.11)
  const rightShoulder = new THREE.Vector3(0.29, 1.47, 0.01)
  const rightElbow = new THREE.Vector3(0.38, 1.19, 0.02)
  const rightHand = new THREE.Vector3(0.42, 0.92, 0.09)
  const leftArm = limbChain(group, leftShoulder, leftElbow, leftHand, 0.075, torso, 'leftUpperArm', 0.06, torso, 'leftForearm')
  const rightArm = limbChain(group, rightShoulder, rightElbow, rightHand, 0.075, torso, 'rightUpperArm', 0.06, torso, 'rightForearm')
  addLimbEnd(leftArm.lower, leftHand.clone().sub(leftElbow), skin, 'leftHand')
  addLimbEnd(rightArm.lower, rightHand.clone().sub(rightElbow), skin, 'rightHand')

  if (cfg.accessory === 'backpack') {
    addMesh(group, new THREE.BoxGeometry(0.27, 0.38, 0.14), accent, 'backpack', new THREE.Vector3(0, 1.20, -0.19))
  } else if (cfg.accessory === 'scarf') {
    addMesh(group, new THREE.CylinderGeometry(0.115, 0.12, 0.22, 10), trim, 'scarf', new THREE.Vector3(0, 1.48, 0.01))
  } else if (cfg.accessory === 'radio') {
    addMesh(group, new RoundedBoxGeometry(0.11, 0.16, 0.07, 2, 0.02), accent, 'radio', new THREE.Vector3(0.22, 1.29, 0.19))
  } else if (cfg.accessory === 'toolbelt') {
    addMesh(group, new THREE.BoxGeometry(0.48, 0.055, 0.04), accent, 'toolbelt', new THREE.Vector3(0, 0.91, 0.16))
    addMesh(group, new THREE.BoxGeometry(0.08, 0.14, 0.08), accent, 'toolPouch', new THREE.Vector3(-0.25, 0.86, 0.14))
  } else if (cfg.accessory === 'harness') {
    addMesh(group, new THREE.BoxGeometry(0.035, 0.45, 0.025), trim, 'harnessLeft', new THREE.Vector3(-0.16, 1.18, 0.18))
    addMesh(group, new THREE.BoxGeometry(0.035, 0.45, 0.025), trim, 'harnessRight', new THREE.Vector3(0.16, 1.18, 0.18))
  } else if (cfg.accessory === 'medkit') {
    addMesh(group, new RoundedBoxGeometry(0.15, 0.16, 0.06, 2, 0.02), accent, 'medkit', new THREE.Vector3(-0.22, 1.02, 0.18))
    addMesh(group, new THREE.BoxGeometry(0.018, 0.08, 0.01), trim, 'medkitCrossV', new THREE.Vector3(-0.22, 1.02, 0.214))
    addMesh(group, new THREE.BoxGeometry(0.08, 0.018, 0.01), trim, 'medkitCrossH', new THREE.Vector3(-0.22, 1.02, 0.214))
  } else if (cfg.accessory === 'binoculars') {
    addMesh(group, new THREE.CylinderGeometry(0.027, 0.027, 0.12, 8), accent, 'binoculars', new THREE.Vector3(0.13, 1.21, 0.19), new THREE.Vector3(1, 1, 1))
  } else if (cfg.accessory === 'slingpack') {
    addMesh(group, new RoundedBoxGeometry(0.18, 0.24, 0.09, 2, 0.025), accent, 'slingpack', new THREE.Vector3(0.19, 1.06, 0.17))
  } else if (cfg.accessory === 'module') {
    addMesh(group, new RoundedBoxGeometry(0.13, 0.18, 0.06, 2, 0.02), accent, 'module', new THREE.Vector3(0.14, 1.24, 0.19))
    addMesh(group, new THREE.SphereGeometry(0.012, 8, 6), trim, 'moduleLight', new THREE.Vector3(0.14, 1.29, 0.225))
  }
  return group
}

export function buildAvatarLowerBody(value = 0, { skinColor = 0xb98268 } = {}) {
  const cfg = pick(LOWER_BODY_VARIATIONS, value)
  const group = new THREE.Group()
  group.name = `lowerBodyVariation:${cfg.id}`
  group.userData.variation = cfg
  const cloth = material(cfg.cloth, 0.93)
  const boot = material(cfg.boot, 0.84, 0.08)
  const skin = material(skinColor, 0.9)

  addMesh(group, new THREE.CylinderGeometry(0.19, 0.23, 0.22, 12), cloth, 'trouserWaist', new THREE.Vector3(0, 0.80, 0), new THREE.Vector3(1, 1, 0.72))
  const leftHip = new THREE.Vector3(-0.14, 0.83, 0)
  const leftKnee = new THREE.Vector3(-0.15, 0.48, 0.045)
  const leftAnkle = new THREE.Vector3(-0.16, 0.16, 0.075)
  const rightHip = new THREE.Vector3(0.14, 0.83, 0)
  const rightKnee = new THREE.Vector3(0.15, 0.48, -0.015)
  const rightAnkle = new THREE.Vector3(0.16, 0.16, 0.035)

  if (cfg.kind === 'skirt') {
    addMesh(group, new THREE.CylinderGeometry(0.23, 0.31, 0.30, 12), cloth, 'skirt', new THREE.Vector3(0, 0.68, 0), new THREE.Vector3(1, 1, 0.78))
    const leftShin = limbSegment(group, leftKnee, leftAnkle, 0.075, skin, 'leftShin')
    const rightShin = limbSegment(group, rightKnee, rightAnkle, 0.075, skin, 'rightShin')
    addMesh(leftShin, new RoundedBoxGeometry(0.21, 0.145, 0.37, 3, 0.035), boot, 'leftBoot', leftAnkle.clone().sub(leftKnee).add(new THREE.Vector3(0, -0.085, 0.055)))
    addMesh(rightShin, new RoundedBoxGeometry(0.21, 0.145, 0.37, 3, 0.035), boot, 'rightBoot', rightAnkle.clone().sub(rightKnee).add(new THREE.Vector3(0, -0.085, 0.055)))
  } else if (cfg.kind === 'shorts') {
    const leftLeg = limbChain(group, leftHip, leftKnee, leftAnkle, 0.09, cloth, 'leftThigh', 0.075, skin, 'leftShin')
    const rightLeg = limbChain(group, rightHip, rightKnee, rightAnkle, 0.09, cloth, 'rightThigh', 0.075, skin, 'rightShin')
    addMesh(leftLeg.lower, new RoundedBoxGeometry(0.21, 0.145, 0.37, 3, 0.035), boot, 'leftBoot', leftAnkle.clone().sub(leftKnee).add(new THREE.Vector3(0, -0.085, 0.055)))
    addMesh(rightLeg.lower, new RoundedBoxGeometry(0.21, 0.145, 0.37, 3, 0.035), boot, 'rightBoot', rightAnkle.clone().sub(rightKnee).add(new THREE.Vector3(0, -0.085, 0.055)))
  } else {
    const leftLeg = limbChain(group, leftHip, leftKnee, leftAnkle, 0.09, cloth, 'leftThigh', 0.075, cloth, 'leftShin')
    const rightLeg = limbChain(group, rightHip, rightKnee, rightAnkle, 0.09, cloth, 'rightThigh', 0.075, cloth, 'rightShin')
    addMesh(leftLeg.lower, new RoundedBoxGeometry(0.21, 0.145, 0.37, 3, 0.035), boot, 'leftBoot', leftAnkle.clone().sub(leftKnee).add(new THREE.Vector3(0, -0.085, 0.055)))
    addMesh(rightLeg.lower, new RoundedBoxGeometry(0.21, 0.145, 0.37, 3, 0.035), boot, 'rightBoot', rightAnkle.clone().sub(rightKnee).add(new THREE.Vector3(0, -0.085, 0.055)))
  }

  if (cfg.detail === 'cargo') {
    addMesh(group, new RoundedBoxGeometry(0.11, 0.16, 0.035, 2, 0.01), cloth, 'leftCargoPocket', new THREE.Vector3(-0.22, 0.55, 0.10))
    addMesh(group, new RoundedBoxGeometry(0.11, 0.16, 0.035, 2, 0.01), cloth, 'rightCargoPocket', new THREE.Vector3(0.22, 0.55, 0.10))
  } else if (cfg.detail === 'knee') {
    addMesh(group, new THREE.BoxGeometry(0.12, 0.04, 0.025), cloth, 'leftKneePatch', new THREE.Vector3(-0.15, 0.48, 0.075))
    addMesh(group, new THREE.BoxGeometry(0.12, 0.04, 0.025), cloth, 'rightKneePatch', new THREE.Vector3(0.15, 0.48, 0.015))
  } else if (cfg.detail === 'bib') {
    addMesh(group, new THREE.BoxGeometry(0.28, 0.26, 0.025), cloth, 'bib', new THREE.Vector3(0, 0.98, 0.18))
    addMesh(group, new THREE.BoxGeometry(0.025, 0.28, 0.02), cloth, 'bibStrapLeft', new THREE.Vector3(-0.14, 1.03, 0.17))
    addMesh(group, new THREE.BoxGeometry(0.025, 0.28, 0.02), cloth, 'bibStrapRight', new THREE.Vector3(0.14, 1.03, 0.17))
  } else if (cfg.detail === 'pocket') {
    addMesh(group, new THREE.BoxGeometry(0.12, 0.09, 0.025), cloth, 'pocket', new THREE.Vector3(0.17, 0.63, 0.16))
  } else if (cfg.detail === 'strap') {
    addMesh(group, new THREE.BoxGeometry(0.035, 0.28, 0.025), cloth, 'legStrap', new THREE.Vector3(0.22, 0.42, 0.08))
  } else if (cfg.detail === 'hem') {
    addMesh(group, new THREE.BoxGeometry(0.26, 0.022, 0.025), cloth, 'skirtHem', new THREE.Vector3(0, 0.54, 0.19))
  } else if (cfg.detail === 'belt') {
    addMesh(group, new THREE.BoxGeometry(0.44, 0.04, 0.04), cloth, 'skirtBelt', new THREE.Vector3(0, 0.82, 0.17))
  }

  return group
}

export function headSkinColor(value = 0) {
  return pick(HEAD_VARIATIONS, value).skin
}
