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
 * Procedural missile: tube body, nose cone, cruciform fins, nozzle + glow.
 * Length along local +Z (same convention as ship forward / laser bolts).
 */
function buildMissileModel(weapon) {
  // A depth charge is not a missile — it is a drum of explosive rolled off the
  // stern. No nose, no fins, nothing that steers.
  if (weapon.tracer === 'drum') return buildDepthCharge(weapon)
  const dmg = weapon.damage ?? 30
  // Scale by tier: rocket_pod ~30, seeker ~42, torpedo ~65
  const tier = Math.min(1.35, 0.75 + dmg / 80)
  const bodyLen = (2.4 + dmg * 0.028) * tier
  const bodyR = (0.18 + dmg * 0.004) * tier
  const noseLen = bodyLen * 0.32
  const finSpan = bodyR * 2.8
  const color = new THREE.Color(weapon.color ?? 0xff8a3d)
  const hull = color.clone().lerp(new THREE.Color(0x2a2e34), 0.55)
  const trim = color.clone().lerp(new THREE.Color(0xffffff), 0.15)

  const group = new THREE.Group()
  group.frustumCulled = false

  // --- Main body (cylinder along +Z) ---
  const bodyGeo = new THREE.CylinderGeometry(bodyR * 0.92, bodyR, bodyLen, 10)
  bodyGeo.rotateX(Math.PI / 2)
  bodyGeo.translate(0, 0, bodyLen * 0.5)
  const bodyMat = new THREE.MeshStandardMaterial({
    color: hull,
    metalness: 0.65,
    roughness: 0.35,
    flatShading: false
  })
  group.add(new THREE.Mesh(bodyGeo, bodyMat))

  // Accent band near mid-body (warhead ring)
  const bandGeo = new THREE.CylinderGeometry(bodyR * 1.06, bodyR * 1.06, bodyLen * 0.12, 10)
  bandGeo.rotateX(Math.PI / 2)
  bandGeo.translate(0, 0, bodyLen * 0.55)
  const bandMat = new THREE.MeshStandardMaterial({
    color: trim,
    metalness: 0.5,
    roughness: 0.4
  })
  group.add(new THREE.Mesh(bandGeo, bandMat))

  // --- Nose cone (point toward +Z) ---
  const noseGeo = new THREE.ConeGeometry(bodyR * 0.95, noseLen, 10)
  noseGeo.rotateX(Math.PI / 2)
  noseGeo.translate(0, 0, bodyLen + noseLen * 0.5)
  const noseMat = new THREE.MeshStandardMaterial({
    color: color.clone().lerp(new THREE.Color(0x111111), 0.25),
    metalness: 0.4,
    roughness: 0.45
  })
  group.add(new THREE.Mesh(noseGeo, noseMat))

  // Tip highlight
  const tipGeo = new THREE.SphereGeometry(bodyR * 0.28, 8, 6)
  tipGeo.translate(0, 0, bodyLen + noseLen * 0.92)
  group.add(
    new THREE.Mesh(
      tipGeo,
      new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.25 })
    )
  )

  // --- Tail nozzle ---
  const nozzleLen = bodyLen * 0.14
  const nozzleGeo = new THREE.CylinderGeometry(bodyR * 0.7, bodyR * 1.05, nozzleLen, 10)
  nozzleGeo.rotateX(Math.PI / 2)
  nozzleGeo.translate(0, 0, -nozzleLen * 0.35)
  group.add(
    new THREE.Mesh(
      nozzleGeo,
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1e,
        metalness: 0.8,
        roughness: 0.3
      })
    )
  )

  // Prop wash, not rocket exhaust. A torpedo is screw-driven and leaves a
  // bubble trail (missileTrailFx does that part) — nothing burns.
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(bodyR * 0.8, bodyLen * 0.3, 8),
    new THREE.MeshBasicMaterial({
      color: 0xdfe8ea,
      transparent: true,
      opacity: 0.3,
      depthWrite: false
    })
  )
  exhaust.rotation.x = -Math.PI / 2
  exhaust.position.z = -bodyLen * 0.2
  group.add(exhaust)

  // Counter-rotating screws: two small discs where the nozzle was.
  const exhaustCore = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyR * 0.75, bodyR * 0.75, bodyR * 0.1, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a7c5e, metalness: 0.8, roughness: 0.4 })
  )
  exhaustCore.rotation.x = Math.PI / 2
  exhaustCore.position.z = -bodyLen * 0.08
  group.add(exhaustCore)

  // --- Cruciform fins near the tail ---
  const finMat = new THREE.MeshStandardMaterial({
    color: hull.clone().offsetHSL(0, 0, -0.08),
    metalness: 0.55,
    roughness: 0.4,
    side: THREE.DoubleSide
  })
  const finLen = bodyLen * 0.28
  const finThick = bodyR * 0.18
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(finThick, finSpan, finLen),
      finMat
    )
    // Root of fin at body surface, extending outward.
    fin.position.set(
      Math.cos(ang) * (bodyR + finSpan * 0.35),
      Math.sin(ang) * (bodyR + finSpan * 0.35),
      finLen * 0.35
    )
    fin.rotation.z = ang
    // Slight rearward sweep
    fin.rotation.y = Math.cos(ang) * 0.15
    fin.rotation.x = Math.sin(ang) * 0.15
    group.add(fin)
  }

  // Torpedo: extra thruster ring for bulk.
  if (dmg >= 55) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(bodyR * 1.15, bodyR * 0.12, 6, 14),
      new THREE.MeshStandardMaterial({ color: 0x444850, metalness: 0.7, roughness: 0.35 })
    )
    ring.rotation.y = Math.PI / 2
    ring.position.z = bodyLen * 0.2
    group.add(ring)
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
    tpl = markWeaponPassThrough(buildMissileModel(weapon))
    _missileTemplates.set(key, tpl)
  }
  return tpl
}

export function buildProjectileMesh(weaponId, mountType = 'laser') {
  const weapon = getWeapon(weaponId ?? BASE_WEAPON_ID[mountType])
  // Clone cached templates so combat open-fire does not rebuild geometry/materials.
  if (weapon.category === 'missile') {
    return markWeaponPassThrough(missileTemplate(weapon).clone(true))
  }
  return markWeaponPassThrough(laserTemplate(weapon).clone(true))
}

/** Warm round/launcher templates so the first shot of a fight is not a hitch. */
export function preloadProjectileMeshes(weaponIds = []) {
  for (const id of weaponIds) {
    try {
      const w = getWeapon(id)
      if (w.category === 'missile') missileTemplate(w)
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
    'torpedo'
  ]) {
    try {
      const w = getWeapon(id)
      if (w.category === 'missile') missileTemplate(w)
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
