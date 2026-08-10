import * as THREE from 'three'
import { getWeapon, BASE_WEAPON_ID } from '../data/weapons.js'

// Size scales with the weapon's own damage; shape comes from the catalog
// entry's `tracer` field (data/weapons.js).
//
// Nothing here glows on its own except a tracer element, because nothing here
// is energy — these are shells, slugs, rocks, harpoons and fish. The one thing
// that *is* additive is the burning tracer compound in the base of a round,
// which is the only part of real gunfire you can actually see in flight.

/**
 * Procedural guided ordnance. Everything points along local +Z, but each
 * launcher now has a readable silhouette: warhead, guidance collar, swept
 * tail fins, engine nozzle, and (for torpedoes) a propeller.
 */
function buildMissileModel(weapon) {
  // A depth charge is not a missile — it is a drum of explosive rolled off the
  // stern. No nose, fins, or steering surfaces.
  if (weapon.tracer === 'drum') return buildDepthCharge(weapon)

  const damage = Number(weapon.damage) || 30
  const torpedo = weapon.tracer === 'torpedo'
  const longRange = weapon.id === 'seeker_missile' || weapon.id === 'singularity_seed'
  const bodyLen = torpedo ? 4.4 + damage * 0.016 : longRange ? 4.0 + damage * 0.014 : 3.2 + damage * 0.016
  // Generous game-scale diameter: real ordnance vanishes at chase-camera
  // distance, while these still need to read as physical bodies in flight.
  const bodyR = torpedo ? 0.38 + damage * 0.0028 : 0.31 + damage * 0.0028
  const noseLen = torpedo ? bodyR * 1.65 : bodyLen * 0.3
  const finSpan = bodyR * (torpedo ? 1.75 : 2.1)
  const finLen = bodyLen * (torpedo ? 0.22 : 0.27)
  const color = new THREE.Color(weapon.color ?? 0xff8a3d)
  const hull = color.clone().lerp(new THREE.Color(0x26313a), 0.38)
  const noseColor = color.clone().lerp(new THREE.Color(0x141a20), 0.16)
  const trim = color.clone().lerp(new THREE.Color(0xe5e7dc), 0.3)
  const dark = new THREE.MeshStandardMaterial({ color: 0x151a1e, metalness: 0.88, roughness: 0.28 })
  const hullMat = new THREE.MeshStandardMaterial({
    color: hull,
    metalness: torpedo ? 0.58 : 0.2,
    roughness: torpedo ? 0.4 : 0.5,
    envMapIntensity: 0.55
  })
  const noseMat = new THREE.MeshStandardMaterial({
    color: noseColor,
    metalness: torpedo ? 0.48 : 0.16,
    roughness: 0.42,
    envMapIntensity: 0.5
  })
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, metalness: 0.5, roughness: 0.4 })
  const finMat = new THREE.MeshStandardMaterial({
    color: hull.clone().offsetHSL(0, 0, -0.1),
    metalness: 0.68,
    roughness: 0.38,
    side: THREE.DoubleSide
  })

  const group = new THREE.Group()
  group.frustumCulled = false

  // CylinderGeometry is Y-aligned; rotate it so every component shares +Z.
  const addCylinder = (frontRadius, rearRadius, depth, z, material, radial = 18) => {
    const geometry = new THREE.CylinderGeometry(frontRadius, rearRadius, depth, radial)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(0, 0, z + depth * 0.5)
    const mesh = new THREE.Mesh(geometry, material)
    group.add(mesh)
    return mesh
  }

  // Pressure hull and contrasting warhead collar.
  addCylinder(bodyR * 0.96, bodyR, bodyLen, 0, hullMat)
  addCylinder(bodyR * 1.04, bodyR * 1.04, bodyLen * 0.075, bodyLen * 0.58, trimMat)
  addCylinder(bodyR * 1.02, bodyR * 1.02, bodyLen * 0.055, bodyLen * 0.14, dark)

  if (torpedo) {
    // Rounded naval-torpedo nose: a hemisphere, not a blunt cone.
    const nose = new THREE.SphereGeometry(bodyR * 1.01, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    nose.rotateX(Math.PI / 2)
    nose.translate(0, 0, bodyLen)
    group.add(new THREE.Mesh(nose, noseMat))
  } else {
    // Guided rocket/harpoon nose: a tapered ogive with a small sensor cap.
    addCylinder(bodyR * 0.12, bodyR * 0.96, noseLen, bodyLen, noseMat)
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(bodyR * 0.15, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xc5d3d5, metalness: 0.9, roughness: 0.2 })
    )
    cap.position.z = bodyLen + noseLen
    group.add(cap)
  }

  // Rear engine and nozzle rim. The visible trail is supplied by missileTrailFx.
  const nozzleDepth = torpedo ? bodyR * 1.1 : bodyR * 1.35
  addCylinder(bodyR * 0.62, bodyR * 0.86, nozzleDepth, -nozzleDepth, dark, 10)
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(bodyR * 0.84, bodyR * 0.095, 6, 14),
    trimMat
  )
  rim.position.z = -nozzleDepth
  group.add(rim)

  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(bodyR * 0.66, bodyR * 0.7, 8),
    new THREE.MeshBasicMaterial({
      color: torpedo ? 0xdfe8ea : 0xffa43d,
      transparent: true,
      opacity: torpedo ? 0.22 : 0.48,
      depthWrite: false,
      blending: torpedo ? THREE.NormalBlending : THREE.AdditiveBlending
    })
  )
  exhaust.rotation.x = -Math.PI / 2
  exhaust.position.z = -nozzleDepth - bodyR * 0.32
  group.add(exhaust)

  const exhaustCore = addCylinder(bodyR * 0.48, bodyR * 0.48, bodyR * 0.08, -nozzleDepth - bodyR * 0.12, trimMat, 10)

  // Four swept stabilisers give the projectile its unmistakable missile shape.
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI * 0.5
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(finSpan, bodyR * 0.22, finLen),
      finMat
    )
    fin.position.set(
      Math.cos(angle) * (bodyR + finSpan * 0.46),
      Math.sin(angle) * (bodyR + finSpan * 0.46),
      bodyLen * 0.11
    )
    fin.rotation.set(0, torpedo ? 0.12 : 0.2, angle)
    group.add(fin)
  }

  if (torpedo) {
    // A torpedo's propeller is a useful silhouette cue at close range.
    const propMat = new THREE.MeshStandardMaterial({ color: 0x9a8d70, metalness: 0.9, roughness: 0.28 })
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(bodyR * 0.12, bodyR * 1.25, bodyR * 0.08), propMat)
      blade.position.z = -nozzleDepth - bodyR * 0.18
      blade.rotation.z = i * Math.PI * 0.5
      group.add(blade)
    }
  }

  group.userData.isMissile = true
  group.userData.exhaust = exhaust
  group.userData.exhaustCore = exhaustCore
  return group
}

/** A rusted drum with hoops. Sinks, then goes off. */
function buildDepthCharge(weapon) {
  const r = 0.55 + (weapon.damage ?? 40) * 0.008
  const len = r * 2.6
  const group = new THREE.Group()
  group.frustumCulled = false
  const drumGeo = new THREE.CylinderGeometry(r, r, len, 12)
  drumGeo.rotateX(Math.PI / 2)
  group.add(
    new THREE.Mesh(
      drumGeo,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(weapon.color ?? 0x5f6b62),
        metalness: 0.5,
        roughness: 0.85
      })
    )
  )
  const hoopMat = new THREE.MeshStandardMaterial({ color: 0x3a352e, metalness: 0.7, roughness: 0.6 })
  for (const z of [-len * 0.3, len * 0.3]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(r * 1.04, r * 0.09, 6, 14), hoopMat)
    hoop.position.z = z
    group.add(hoop)
  }
  group.userData.isMissile = true
  return group
}

// Shared round geometry/materials — new shots clone the mesh, no per-shot alloc.
const _laserTemplates = new Map()
const _missileTemplates = new Map()
const _onFootTemplates = new Map()
let _flashGeo = null

/**
 * Weapons draw through harbour mesh (hulls still block navigation).
 * depthTest off = rounds stay visible past quays and gantries.
 */
function markWeaponPassThrough(root) {
  root.traverse((obj) => {
    obj.renderOrder = 20
    obj.frustumCulled = false
    if (!obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      m.depthTest = false
      m.depthWrite = false
      m.needsUpdate = true
    }
  })
  return root
}

/** Opaque launcher rounds obey world depth so they read as physical objects. */
function markSolidOrdnance(root) {
  root.traverse((obj) => {
    obj.renderOrder = 0
    obj.frustumCulled = false
    if (!obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of mats) {
      material.depthTest = true
      material.depthWrite = !material.transparent
      material.needsUpdate = true
    }
  })
  return root
}

/** Handgun rounds use normal depth so the held pistol can occlude the shot. */
function markOnFootRound(root) {
  root.traverse((obj) => {
    obj.renderOrder = 0
    obj.frustumCulled = false
    if (!obj.material) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const material of mats) {
      material.depthTest = true
      material.depthWrite = false
      material.needsUpdate = true
    }
  })
  return root
}

/** A tumbling lump of masonry — jitter an icosahedron so no two faces match. */
function buildRockGeometry(radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 1)
  const pos = geo.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    // Deterministic per-vertex wobble: cheap hash off the direction so the
    // template is stable and every clone of it matches.
    const h = Math.sin(v.x * 12.9898 + v.y * 78.233 + v.z * 37.719) * 43758.5453
    v.multiplyScalar(0.78 + (h - Math.floor(h)) * 0.44)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

/**
 * A round in flight.
 *
 * The `tracer` field on the weapon picks the shape. Solid rounds are lit
 * normally (they are metal, they are not on fire); only the burning tracer
 * compound in the base is additive.
 */
function buildGunRound(weapon) {
  const dmg = weapon.damage ?? 8
  const color = new THREE.Color(weapon.color ?? 0xffd9a0)
  const group = new THREE.Group()
  group.frustumCulled = false

  const steel = () =>
    new THREE.MeshStandardMaterial({ color: 0x8d8b86, metalness: 0.85, roughness: 0.35 })
  /** The bit that actually burns. Short, so it reads as a spark not a beam. */
  const addTracer = (length, radius, opacity = 0.9) => {
    const geo = new THREE.CylinderGeometry(radius * 0.35, radius, length, 6)
    geo.rotateX(Math.PI / 2)
    geo.translate(0, 0, -length * 0.5)
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    group.add(mesh)
  }

  switch (weapon.tracer) {
    case 'rock': {
      // Catapult shot: a lump of pre-war concrete, no tracer, no shine.
      const r = 0.5 + dmg * 0.022
      const rock = new THREE.Mesh(
        buildRockGeometry(r),
        new THREE.MeshStandardMaterial({
          color: color.clone().lerp(new THREE.Color(0x4a453d), 0.45),
          metalness: 0.05,
          roughness: 0.95,
          flatShading: true
        })
      )
      group.add(rock)
      break
    }

    case 'harpoon': {
      // Shaft, barbed head, and the line still paying out behind it.
      const len = 3.2 + dmg * 0.03
      const r = 0.1 + dmg * 0.002
      const shaftGeo = new THREE.CylinderGeometry(r, r, len, 7)
      shaftGeo.rotateX(Math.PI / 2)
      group.add(new THREE.Mesh(shaftGeo, steel()))

      const headGeo = new THREE.ConeGeometry(r * 2.6, len * 0.22, 7)
      headGeo.rotateX(Math.PI / 2)
      headGeo.translate(0, 0, len * 0.55)
      group.add(
        new THREE.Mesh(
          headGeo,
          new THREE.MeshStandardMaterial({ color: 0xb9b3a6, metalness: 0.9, roughness: 0.25 })
        )
      )
      // Two barbs swept back off the head.
      for (const sign of [-1, 1]) {
        const barb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 3.2, len * 0.18), steel())
        barb.position.set(0, sign * r * 1.7, len * 0.38)
        barb.rotation.x = sign * 0.35
        group.add(barb)
      }
      // Line: a thin dark trailer, so you can see where the shot came from.
      const lineGeo = new THREE.CylinderGeometry(r * 0.16, r * 0.16, len * 1.6, 4)
      lineGeo.rotateX(Math.PI / 2)
      lineGeo.translate(0, 0, -len * 1.1)
      group.add(
        new THREE.Mesh(
          lineGeo,
          new THREE.MeshBasicMaterial({ color: 0x2b2721, transparent: true, opacity: 0.55 })
        )
      )
      break
    }

    case 'slug': {
      // Rivet gun / railgun: one dense bolt of steel. Barely visible, which is
      // the point — a short tracer keeps it trackable.
      const len = 1.4 + dmg * 0.02
      const r = 0.14 + dmg * 0.006
      const geo = new THREE.CylinderGeometry(r * 0.8, r, len, 8)
      geo.rotateX(Math.PI / 2)
      group.add(new THREE.Mesh(geo, steel()))
      addTracer(len * 2.2, r * 0.7, 0.55)
      break
    }

    case 'shell': {
      // Deck gun: a real shell — ogive nose, driving band, burning base.
      const len = 1.8 + dmg * 0.05
      const r = 0.22 + dmg * 0.012
      const bodyGeo = new THREE.CylinderGeometry(r, r, len * 0.62, 9)
      bodyGeo.rotateX(Math.PI / 2)
      bodyGeo.translate(0, 0, -len * 0.19)
      group.add(
        new THREE.Mesh(
          bodyGeo,
          new THREE.MeshStandardMaterial({ color: 0x6f6a60, metalness: 0.7, roughness: 0.45 })
        )
      )
      const noseGeo = new THREE.ConeGeometry(r, len * 0.42, 9)
      noseGeo.rotateX(Math.PI / 2)
      noseGeo.translate(0, 0, len * 0.33)
      group.add(
        new THREE.Mesh(
          noseGeo,
          new THREE.MeshStandardMaterial({ color: 0x8a7f6a, metalness: 0.75, roughness: 0.4 })
        )
      )
      const bandGeo = new THREE.CylinderGeometry(r * 1.12, r * 1.12, len * 0.1, 9)
      bandGeo.rotateX(Math.PI / 2)
      bandGeo.translate(0, 0, -len * 0.42)
      group.add(
        new THREE.Mesh(
          bandGeo,
          new THREE.MeshStandardMaterial({ color: 0xa8823c, metalness: 0.85, roughness: 0.3 })
        )
      )
      addTracer(len * 2.6, r * 0.75, 0.8)
      break
    }

    default: {
      // Autocannon / chain gun / flechette: too small to model, so this is
      // almost entirely its own tracer with a dark core to give it mass.
      const len = 0.9 + dmg * 0.05
      const r = 0.1 + dmg * 0.012
      const coreGeo = new THREE.CylinderGeometry(r * 0.7, r, len, 6)
      coreGeo.rotateX(Math.PI / 2)
      group.add(
        new THREE.Mesh(
          coreGeo,
          new THREE.MeshStandardMaterial({ color: 0x5c574e, metalness: 0.8, roughness: 0.4 })
        )
      )
      addTracer(len * 4.5, r * 0.9, 0.85)
      break
    }
  }

  return group
}

function laserTemplate(weapon) {
  const key = `${weapon.id}|${weapon.tracer}|${weapon.damage}`
  let tpl = _laserTemplates.get(key)
  if (!tpl) {
    tpl = markWeaponPassThrough(buildGunRound(weapon))
    _laserTemplates.set(key, tpl)
  }
  return tpl
}

function missileTemplate(weapon) {
  const key = weapon.id
  let tpl = _missileTemplates.get(key)
  if (!tpl) {
    tpl = markSolidOrdnance(buildMissileModel(weapon))
    _missileTemplates.set(key, tpl)
  }
  return tpl
}

function onFootTemplate(weapon) {
  const key = `${weapon.id}|on-foot`
  let template = _onFootTemplates.get(key)
  if (template) return template

  // A real handgun bullet is too small and fast to read at game resolution.
  // Keep a 9 mm-sized core, then add the short luminous streak that makes its
  // flight legible without turning it into a ship-scale energy bolt.
  const group = new THREE.Group()
  group.frustumCulled = false
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xfff1bd,
      depthWrite: false,
      depthTest: true,
      toneMapped: false
    })
  )
  head.position.z = 0.015
  head.renderOrder = 20
  head.frustumCulled = false

  const streak = (radius, length, opacity) => {
    const geometry = new THREE.CylinderGeometry(radius * 0.45, radius, length, 6, 1, true)
    geometry.rotateX(Math.PI / 2)
    geometry.translate(0, 0, -length * 0.5)
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: weapon.color ?? 0xffd9a0,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    )
  }
  group.add(head, streak(0.014, 0.55, 0.9), streak(0.034, 0.82, 0.28))
  group.userData.onFootProjectile = true
  template = markOnFootRound(group)
  _onFootTemplates.set(key, template)
  return template
}

export function buildProjectileMesh(weaponId, mountType = 'laser', onFoot = false) {
  const weapon = getWeapon(weaponId ?? BASE_WEAPON_ID[mountType])
  if (onFoot) {
    const projectile = markOnFootRound(onFootTemplate(weapon).clone(true))
    return projectile
  }
  // Clone cached templates so combat open-fire does not rebuild geometry/materials.
  if (weapon.category === 'missile') {
    return markSolidOrdnance(missileTemplate(weapon).clone(true))
  }
  return markWeaponPassThrough(laserTemplate(weapon).clone(true))
}

/** Warm round/launcher templates so the first shot of a fight is not a hitch. */
export function preloadProjectileMeshes(weaponIds = []) {
  for (const id of weaponIds) {
    try {
      const w = getWeapon(id)
      if (w.handheld) onFootTemplate(w)
      else if (w.category === 'missile') missileTemplate(w)
      else laserTemplate(w)
    } catch {
      /* ignore unknown */
    }
  }
  // Common catalog weapons
  for (const id of [
    'pulse_laser',
    'burst_laser',
    'beam_laser',
    'plasma_cannon',
    'rapid_laser',
    'rocket_pod',
    'seeker_missile',
    'torpedo',
    'fixo_pistol'
  ]) {
    try {
      const w = getWeapon(id)
      if (w.handheld) onFootTemplate(w)
      else if (w.category === 'missile') missileTemplate(w)
      else laserTemplate(w)
    } catch {
      /* */
    }
  }
}

// Template materials by color — clone per flash so opacity anim is independent,
// but shaders compile once (avoids first-hit GPU hitch).
const _flashMatByColor = new Map()

export function buildImpactFlash(color = 0xffcc66) {
  if (!_flashGeo) _flashGeo = new THREE.SphereGeometry(1, 8, 8)
  const key = typeof color === 'number' ? color : String(color)
  let template = _flashMatByColor.get(key)
  if (!template) {
    template = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
    _flashMatByColor.set(key, template)
  }
  const mesh = new THREE.Mesh(_flashGeo, template.clone())
  mesh.scale.setScalar(0.5)
  return mesh
}
