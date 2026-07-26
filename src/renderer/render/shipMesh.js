import * as THREE from 'three'
import { buildHullGeometry } from '../procgen/hull.js'
import { mulberry32 } from '../procgen/prng.js'
import { stationMaterialMaps, retileUVsTriplanar } from './textures.js'

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Ship-specific CC0 PBR (ambientCG) — tinted via material.color per class.
function shipHullMaps(normalStrength = 0.55) {
  return stationMaterialMaps('shipHull', normalStrength)
}
function shipStructureMaps(normalStrength = 0.5) {
  return stationMaterialMaps('shipStructure', normalStrength)
}
function shipArmorMaps(normalStrength = 0.62) {
  return stationMaterialMaps('shipArmor', normalStrength)
}
function shipTrimMaps(normalStrength = 0.45) {
  return stationMaterialMaps('shipTrim', normalStrength)
}
function alienHullMaps(normalStrength = 0.7) {
  return stationMaterialMaps('alienHull', normalStrength)
}
function alienPlateMaps(normalStrength = 0.65) {
  return stationMaterialMaps('alienPlate', normalStrength)
}

function makeDetailMaterials(hullTint) {
  const tint = hullTint?.clone?.() ?? new THREE.Color(0x8899aa)
  const darkTint = tint.clone().multiplyScalar(0.55)
  const lightTint = tint.clone().lerp(new THREE.Color(0xffffff), 0.25)
  return {
    hardpoint: new THREE.MeshStandardMaterial({
      color: 0x2a2e34,
      metalness: 0.9,
      roughness: 0.35,
      ...shipTrimMaps(0.5)
    }),
    canopy: new THREE.MeshStandardMaterial({
      color: 0x0c1a28,
      flatShading: false,
      transparent: true,
      opacity: 0.82,
      metalness: 0.12,
      roughness: 0.06,
      emissive: 0x0a3048,
      emissiveIntensity: 0.55,
      envMapIntensity: 1.2
    }),
    window: new THREE.MeshStandardMaterial({
      color: 0x143848,
      emissive: 0x3a90b0,
      emissiveIntensity: 0.65,
      metalness: 0.15,
      roughness: 0.12
    }),
    engineGlow: new THREE.MeshBasicMaterial({
      color: 0x7fe6ff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    }),
    engineCone: new THREE.MeshBasicMaterial({
      color: 0x4fc3d9,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    }),
    panel: new THREE.MeshStandardMaterial({
      color: darkTint,
      metalness: 0.86,
      roughness: 0.42,
      ...shipArmorMaps(0.58)
    }),
    structure: new THREE.MeshStandardMaterial({
      color: lightTint,
      metalness: 0.9,
      roughness: 0.38,
      ...shipStructureMaps(0.52)
    }),
    radiator: new THREE.MeshStandardMaterial({
      color: 0x4a3830,
      metalness: 0.88,
      roughness: 0.4,
      emissive: 0x1a1008,
      emissiveIntensity: 0.14,
      ...shipTrimMaps(0.4)
    }),
    accent: new THREE.MeshStandardMaterial({
      color: 0xc45a18,
      metalness: 0.5,
      roughness: 0.45,
      ...shipHullMaps(0.4)
    }),
    antenna: new THREE.MeshStandardMaterial({
      color: 0xa0b0c0,
      metalness: 0.92,
      roughness: 0.28,
      ...shipTrimMaps(0.35)
    }),
    nacelle: new THREE.MeshStandardMaterial({
      color: darkTint.clone().offsetHSL(0, 0, -0.05),
      metalness: 0.88,
      roughness: 0.4,
      ...shipStructureMaps(0.48)
    })
  }
}

const hardpointMarkerGeometry = new THREE.ConeGeometry(0.16, 0.4, 6)

function defaultStyle(hull, rng) {
  if (hull.style) return hull.style
  // Hand-crafted classes may omit style — invent a stable one from class seed.
  // Match roster policy: strong asymmetry is rare (~5%).
  return {
    asymmetric: rng() < 0.05,
    bridgeSide: 0,
    engineLayout: Math.max(...hull.stationWidths) > hull.length * 0.08 ? 'twin' : 'single',
    hasRadiator: rng() < 0.5,
    hasCargoPods: rng() < 0.25,
    hasSensorMast: true,
    // 'top' | 'bottom' — dorsal bridge vs ventral belly cockpit.
    cockpitMount: rng() < 0.18 ? 'bottom' : 'top',
    // Radar dish mounts: 'top' | 'bottom' | 'left' | 'right' | 'side' (both flanks).
    radarDishes: ['top'],
    hasDockingRing: rng() < 0.15,
    detailDensity: 1
  }
}

/**
 * Place a radar dish + short mast at a hull surface.
 * mount: 'top' | 'bottom' | 'left' | 'right' | 'side' (both flanks).
 * Optional zFrac (fraction of length along +Z) and size (relative to peakWidth).
 */
function addRadarDish(group, mats, peakWidth, peakHeight, length, mount, opts = {}) {
  const z = (opts.zFrac ?? 0.22) * length
  const size = peakWidth * (opts.size ?? 0.13)
  const mastH = peakHeight * (opts.mastScale ?? 0.35)
  const xOff = opts.x ?? 0
  const yOff = opts.y ?? 0

  const addOne = (mastPos, dishPos, dishRot) => {
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(peakWidth * 0.014, peakWidth * 0.022, mastH, 6),
      mats.antenna
    )
    mast.position.copy(mastPos)
    // Orient mast along the outward axis from root to dish.
    const dir = new THREE.Vector3().subVectors(dishPos, mastPos)
    if (dir.lengthSq() > 1e-8) {
      mast.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
      mast.position.lerpVectors(mastPos, dishPos, 0.45)
    }
    group.add(mast)

    const dish = new THREE.Mesh(new THREE.CircleGeometry(size, 16), mats.antenna)
    dish.position.copy(dishPos)
    dish.rotation.set(dishRot.x, dishRot.y, dishRot.z)
    group.add(dish)

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.98, size * 0.08, 4, 16),
      mats.structure
    )
    rim.position.copy(dish.position)
    rim.rotation.copy(dish.rotation)
    group.add(rim)
  }

  if (mount === 'top') {
    const root = new THREE.Vector3(xOff, peakHeight * 0.92, z)
    const tip = new THREE.Vector3(xOff, peakHeight * 0.92 + mastH, z)
    addOne(root, tip, { x: -Math.PI / 3, y: 0, z: 0 })
  } else if (mount === 'bottom') {
    const root = new THREE.Vector3(xOff, -peakHeight * 0.92, z)
    const tip = new THREE.Vector3(xOff, -peakHeight * 0.92 - mastH, z)
    addOne(root, tip, { x: Math.PI / 3, y: 0, z: 0 })
  } else if (mount === 'left' || mount === 'right' || mount === 'side') {
    const sides = mount === 'side' ? [-1, 1] : [mount === 'right' ? 1 : -1]
    for (const sx of sides) {
      const root = new THREE.Vector3(sx * peakWidth * 0.95, yOff || peakHeight * 0.08, z)
      const tip = new THREE.Vector3(sx * (peakWidth * 0.95 + mastH), yOff || peakHeight * 0.08, z)
      addOne(root, tip, { x: -0.25, y: sx * (Math.PI / 2 - 0.4), z: 0 })
    }
  }
}

/** Expand style.radarDishes into concrete mount tokens. */
function resolveRadarMounts(style, rng) {
  const list = style.radarDishes
  if (Array.isArray(list) && list.length > 0) {
    const out = []
    for (const m of list) {
      if (typeof m === 'string') {
        if (m === 'side') {
          out.push('left', 'right')
        } else {
          out.push(m)
        }
      } else if (m && typeof m === 'object' && m.mount) {
        if (m.mount === 'side') out.push({ ...m, mount: 'left' }, { ...m, mount: 'right' })
        else out.push(m)
      }
    }
    return out
  }
  // Legacy: hasSensorMast alone → single dorsal dish (previous look).
  if (style.hasSensorMast !== false) return ['top']
  return []
}

function engineOffsets(layout, peakWidth) {
  switch (layout) {
    case 'single':
      return [[0, 0]]
    case 'triple':
      return [
        [-peakWidth * 0.38, 0],
        [0, peakWidth * 0.12],
        [peakWidth * 0.38, 0]
      ]
    case 'quad':
      return [
        [-peakWidth * 0.4, peakWidth * 0.12],
        [peakWidth * 0.4, peakWidth * 0.12],
        [-peakWidth * 0.4, -peakWidth * 0.12],
        [peakWidth * 0.4, -peakWidth * 0.12]
      ]
    case 'twin':
    default:
      return [
        [-peakWidth * 0.35, 0],
        [peakWidth * 0.35, 0]
      ]
  }
}

/**
 * Local-space nozzle points matching addHullDetails engine glow positions.
 * Used by thruster FX so multi-engine hulls get one plume per nacelle.
 * @returns {{ x: number, y: number, z: number }[]}
 */
export function getEngineNozzleLocals(hull) {
  if (!hull) return [{ x: 0, y: 0, z: -10 }]
  const length = Number(hull.length) || 20
  const widths = hull.stationWidths?.length ? hull.stationWidths : [1.5]
  const heights = hull.stationHeights?.length ? hull.stationHeights : [1.2]
  const peakWidth = Math.max(...widths)
  const peakHeight = Math.max(...heights)
  const style = hull.style ?? defaultStyle(hull, () => 0.5)
  const layout = style.engineLayout ?? (peakWidth > length * 0.08 ? 'twin' : 'single')
  const offsets = engineOffsets(layout, peakWidth)
  // Match mesh glow disc: slightly aft of stern so exhaust sits in the bell.
  const z = -length / 2 - peakHeight * 0.22
  return offsets.map(([x, y]) => ({ x, y, z }))
}

/** Forward-pointing aerial at the tip of a ventral (underside) wing. */
function addVentralWingAerials(group, hull, mats) {
  const { length, stationWidths, stationHeights, wings = [], stationOffsetsX, stationOffsetsY } = hull
  const n = stationWidths.length
  for (const w of wings) {
    if (w.side !== 'bottom' && w.side !== 'ventral') continue
    if (!w.tipAerial) continue
    const i = Math.max(0, Math.min(n - 1, w.atStation ?? 0))
    const zc = -length / 2 + (length * i) / Math.max(1, n - 1)
    const rootH = stationHeights[i]
    const rootOy = stationOffsetsY?.[i] ?? 0
    const rootOx = stationOffsetsX?.[i] ?? 0
    const tipY = rootOy - rootH - (w.span ?? 1)
    const tipZ = zc + (w.sweep ?? 0)
    const tipX = rootOx + (w.tipOffsetX ?? 0)
    // Mast base at tip, boom aims +Z (ship forward / nose).
    const aerialLen = Math.max(1.2, length * 0.14)
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.05, aerialLen, 6),
      mats.antenna
    )
    boom.rotation.x = Math.PI / 2 // cylinder Y → +Z after rot
    boom.position.set(tipX, tipY, tipZ + aerialLen * 0.5)
    group.add(boom)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mats.antenna)
    tip.position.set(tipX, tipY, tipZ + aerialLen)
    group.add(tip)
    // Small root fairing where aerial meets the wing tip.
    const fairing = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.16, 0.28),
      mats.structure
    )
    fairing.position.set(tipX, tipY, tipZ)
    group.add(fairing)
  }
}

// Cosmetic details on the parametric hull — canopy, engines, radiators,
// greebles, cargo. Seeded per class id so every ship of a class matches.
// style.visualKit (0–31) + platingStyle branch layout so same-role hulls diverge.
function addHullDetails(group, hull, mats) {
  const rng = mulberry32(hashString(group.name))
  const { length, stationWidths, stationHeights } = hull
  const peakWidth = Math.max(...stationWidths)
  const peakHeight = Math.max(...stationHeights)
  const style = defaultStyle(hull, rng)
  const kit = Number.isFinite(style.visualKit)
    ? style.visualKit
    : hashString(group.name) % 32
  const plating =
    style.platingStyle ||
    ['belts', 'sparse', 'spine', 'sponsons', 'scales', 'ribs', 'clamshell', 'lattice'][kit % 8]
  addVentralWingAerials(group, hull, mats)
  // Asymmetric: full bridge offset. Symmetric: stay centered (or tiny noise only never).
  const bridgeX = style.asymmetric ? style.bridgeSide * peakWidth * 0.32 : 0
  const density = (style.detailDensity ?? 1) * (0.75 + (kit % 7) * 0.07)

  // —— Plating families: structural identity within a role ——
  if (plating === 'belts' || plating === 'sparse') {
    const bandCount = Math.round(
      (plating === 'sparse' ? 2 + (kit % 3) : 4 + (kit % 5) + Math.floor(rng() * 4)) * density
    )
    for (let i = 0; i < bandCount; i++) {
      const z = -length * 0.38 + (i / Math.max(1, bandCount - 1)) * length * 0.76
      const yOff = (i % 3 === 0 ? 0.35 : i % 3 === 1 ? 0.12 : -0.28) * peakHeight
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(peakWidth * (1.05 + (i % 2) * 0.08), peakHeight * 0.05, length * 0.032),
        i % 2 === 0 ? mats.panel : mats.structure
      )
      band.position.set(bridgeX * 0.12, yOff, z)
      group.add(band)
    }
  }
  if (plating === 'spine' || plating === 'ribs') {
    // Dorsal spine ridge.
    const spine = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.18, peakHeight * (0.35 + (kit % 4) * 0.08), length * 0.7),
      mats.structure
    )
    spine.position.set(bridgeX * 0.2, peakHeight * 0.55, length * 0.02)
    group.add(spine)
    if (plating === 'ribs') {
      const ribN = 5 + (kit % 5)
      for (let i = 0; i < ribN; i++) {
        const z = -length * 0.3 + (i / Math.max(1, ribN - 1)) * length * 0.6
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(peakWidth * 1.08, peakHeight * 0.12, length * 0.04),
          mats.panel
        )
        rib.position.set(0, peakHeight * 0.15, z)
        group.add(rib)
      }
    }
  }
  if (plating === 'sponsons' || plating === 'clamshell') {
    for (const sx of [-1, 1]) {
      const spo = new THREE.Mesh(
        new THREE.BoxGeometry(
          peakWidth * (0.35 + (kit % 3) * 0.08),
          peakHeight * (plating === 'clamshell' ? 0.55 : 0.4),
          length * (0.35 + (kit % 4) * 0.06)
        ),
        mats.panel
      )
      spo.position.set(
        sx * peakWidth * (0.75 + (kit % 3) * 0.05),
        plating === 'clamshell' ? peakHeight * 0.05 : -peakHeight * 0.1,
        length * (0.05 - (kit % 5) * 0.02)
      )
      group.add(spo)
    }
  }
  if (plating === 'scales') {
    const rows = 3 + (kit % 3)
    const cols = 4 + (kit % 4)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const scale = new THREE.Mesh(
          new THREE.BoxGeometry(peakWidth * 0.22, peakHeight * 0.06, length * 0.08),
          r % 2 === 0 ? mats.panel : mats.structure
        )
        scale.position.set(
          (c - (cols - 1) / 2) * peakWidth * 0.28,
          peakHeight * (0.35 + r * 0.12),
          -length * 0.25 + r * length * 0.12 + c * length * 0.02
        )
        group.add(scale)
      }
    }
  }
  if (plating === 'lattice') {
    for (let i = 0; i < 6 + (kit % 4); i++) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(peakWidth * 0.04, peakHeight * 0.04, length * 0.55),
        mats.structure
      )
      beam.position.set(
        (i % 2 === 0 ? -1 : 1) * peakWidth * (0.4 + (i % 3) * 0.15),
        (Math.floor(i / 2) - 1) * peakHeight * 0.25,
        length * 0.05
      )
      beam.rotation.y = (i % 3 - 1) * 0.12
      group.add(beam)
    }
  }
  // Side keel rails (always — subtle structure).
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(
        peakWidth * (0.05 + (kit % 3) * 0.015),
        peakHeight * 0.08,
        length * (0.45 + (kit % 4) * 0.05)
      ),
      mats.structure
    )
    rail.position.set(sx * peakWidth * 0.92, -peakHeight * (0.1 + (kit % 3) * 0.05), length * 0.02)
    group.add(rail)
  }

  // Bridge / cockpit canopy — dorsal (top) or ventral (bottom) mount.
  // Bottom cockpits flip the dome under the belly for a gunship/dropship look.
  const cockpitBottom = style.cockpitMount === 'bottom' || style.cockpitMount === 'ventral'
  const cockpitYSign = cockpitBottom ? -1 : 1
  const canopyScale =
    kit % 4 === 0 ? [1.35, 0.42, 1.5] : kit % 4 === 1 ? [0.9, 0.65, 2.2] : kit % 4 === 2 ? [1.15, 0.55, 1.7] : [1.08, 0.52, 1.9]
  const canopyZ = length * (0.16 + (kit % 5) * 0.02)
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(peakWidth * (0.28 + (kit % 3) * 0.04), 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    mats.canopy
  )
  canopy.scale.set(canopyScale[0], canopyScale[1], canopyScale[2])
  if (cockpitBottom) canopy.rotation.z = Math.PI // dome faces down
  canopy.position.set(bridgeX, cockpitYSign * peakHeight * 0.8, canopyZ)
  group.add(canopy)
  // Canopy frame ribs.
  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.02, peakHeight * 0.28, peakWidth * 0.35),
      mats.structure
    )
    rib.position.set(
      bridgeX + (i - 1.5) * peakWidth * 0.12,
      cockpitYSign * peakHeight * 0.78,
      length * 0.22
    )
    group.add(rib)
  }

  // Framed window strip near the canopy (reads as a bridge).
  const windowCount = 5 + Math.floor(rng() * 5)
  for (let i = 0; i < windowCount; i++) {
    const w = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.07, peakHeight * 0.06, peakWidth * 0.05),
      mats.window
    )
    w.position.set(
      bridgeX + (i - (windowCount - 1) / 2) * peakWidth * 0.095,
      cockpitYSign * peakHeight * 0.64,
      length * 0.28
    )
    group.add(w)
  }
  // Second window row aft of bridge.
  if (rng() < 0.75) {
    for (let i = 0; i < 3; i++) {
      const w = new THREE.Mesh(
        new THREE.BoxGeometry(peakWidth * 0.06, peakHeight * 0.05, peakWidth * 0.04),
        mats.window
      )
      w.position.set(
        bridgeX + (i - 1) * peakWidth * 0.1,
        cockpitYSign * peakHeight * 0.55,
        length * 0.12
      )
      group.add(w)
    }
  }

  // Raised (or lowered) bridge tower for freighter / gunship silhouettes.
  if (style.asymmetric || rng() < 0.4 || cockpitBottom) {
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.38, peakHeight * 0.6, peakWidth * 0.55),
      mats.structure
    )
    tower.position.set(bridgeX, cockpitYSign * peakHeight * 0.98, length * 0.04)
    group.add(tower)
    // Tower sensor blister.
    const blister = new THREE.Mesh(
      new THREE.SphereGeometry(peakWidth * 0.1, 10, 8),
      mats.antenna
    )
    blister.position.set(bridgeX, cockpitYSign * peakHeight * 1.28, length * 0.04)
    group.add(blister)
  }

  // Engine nacelles + glow — real housings, not floating discs.
  const layout = style.engineLayout ?? 'twin'
  const offsets = engineOffsets(layout, peakWidth)
  const engineR = peakHeight * (layout === 'quad' ? 0.26 : layout === 'single' ? 0.42 : 0.36) * (0.9 + (kit % 3) * 0.06)
  const finCount = 5 + (kit % 5)
  for (const [ox, oy] of offsets) {
    const nacelle = new THREE.Mesh(
      new THREE.CylinderGeometry(engineR * 0.95, engineR * 1.08, peakHeight * (0.85 + (kit % 4) * 0.06), 12),
      mats.nacelle
    )
    nacelle.rotation.x = Math.PI / 2
    nacelle.position.set(ox, oy, -length / 2 + peakHeight * 0.38)
    group.add(nacelle)

    // Cooling fins around nacelle (count varies by visual kit).
    for (let f = 0; f < finCount; f++) {
      const ang = (f / finCount) * Math.PI * 2 + 0.15
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(engineR * 0.07, engineR * (0.45 + (kit % 3) * 0.1), peakHeight * 0.55),
        mats.panel
      )
      fin.position.set(
        ox + Math.cos(ang) * engineR * 0.98,
        oy + Math.sin(ang) * engineR * 0.98,
        -length / 2 + peakHeight * 0.4
      )
      fin.rotation.z = ang
      group.add(fin)
    }
    // Nacelle ring clamps.
    for (const zOff of [0.15, 0.55]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(engineR * 1.05, engineR * 0.08, 6, 16),
        mats.structure
      )
      ring.rotation.y = Math.PI / 2
      ring.position.set(ox, oy, -length / 2 + peakHeight * zOff)
      group.add(ring)
    }

    const bell = new THREE.Mesh(
      new THREE.CylinderGeometry(engineR * 1.2, engineR * 0.7, peakHeight * 0.4, 14),
      mats.structure
    )
    bell.rotation.x = Math.PI / 2
    bell.position.set(ox, oy, -length / 2 - 0.06)
    group.add(bell)

    const glow = new THREE.Mesh(new THREE.CircleGeometry(engineR * 0.9, 20), mats.engineGlow)
    glow.position.set(ox, oy, -length / 2 - peakHeight * 0.22)
    glow.rotation.y = Math.PI
    group.add(glow)

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(engineR * 0.6, peakHeight * 1.2, 12, 1, true),
      mats.engineCone
    )
    cone.rotation.x = -Math.PI / 2
    cone.position.set(ox, oy, -length / 2 - peakHeight * 0.58)
    group.add(cone)

    if (Math.abs(ox) > 0.05 || Math.abs(oy) > 0.05) {
      const strutLen = Math.hypot(ox, oy)
      const strut = new THREE.Mesh(
        new THREE.BoxGeometry(strutLen, peakHeight * 0.14, peakHeight * 0.22),
        mats.structure
      )
      strut.position.set(ox * 0.5, oy * 0.5, -length / 2 + peakHeight * 0.52)
      strut.rotation.z = Math.atan2(oy, ox)
      group.add(strut)
      // Strut brace plates.
      const brace = new THREE.Mesh(
        new THREE.BoxGeometry(strutLen * 0.45, peakHeight * 0.08, peakHeight * 0.35),
        mats.panel
      )
      brace.position.set(ox * 0.35, oy * 0.35, -length / 2 + peakHeight * 0.62)
      brace.rotation.z = Math.atan2(oy, ox)
      group.add(brace)
    }
  }

  // Heat radiators — flat dark panels (very "human spacecraft").
  if (style.hasRadiator) {
    const side = style.asymmetric ? (style.bridgeSide !== 0 ? style.bridgeSide : rng() < 0.5 ? -1 : 1) : 1
    const radW = peakWidth * (0.95 + rng() * 0.65)
    const radH = peakHeight * (0.07 + rng() * 0.06)
    const radL = length * (0.3 + rng() * 0.22)
    const rad = new THREE.Mesh(new THREE.BoxGeometry(radW, radH, radL), mats.radiator)
    rad.position.set(side * (peakWidth * 0.55 + radW * 0.45), peakHeight * 0.15, -length * 0.05)
    rad.rotation.z = side * 0.12
    group.add(rad)
    for (let i = 0; i < 9; i++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(radW * 0.95, radH * 1.55, radL * 0.022),
        mats.panel
      )
      rib.position.set(
        side * (peakWidth * 0.55 + radW * 0.45),
        peakHeight * 0.15,
        -length * 0.05 + (i - 4) * (radL * 0.1)
      )
      group.add(rib)
    }
    // Second radiator plane (common on industrial hulls).
    if (rng() < 0.55 || density > 1.5) {
      const rad2 = new THREE.Mesh(
        new THREE.BoxGeometry(radW * 0.7, radH * 0.9, radL * 0.65),
        mats.radiator
      )
      rad2.position.set(
        -side * (peakWidth * 0.5 + radW * 0.3),
        peakHeight * 0.05,
        -length * 0.12
      )
      rad2.rotation.z = -side * 0.1
      group.add(rad2)
    }
  }

  // Cargo pods / ISO containers bolted under freighters.
  if (style.hasCargoPods) {
    const pods = 4 + Math.floor(rng() * 5)
    for (let i = 0; i < pods; i++) {
      const pw = peakWidth * (0.32 + rng() * 0.28)
      const ph = peakHeight * (0.32 + rng() * 0.22)
      const pl = length * (0.11 + rng() * 0.12)
      const pod = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pl), mats.panel)
      const side =
        style.asymmetric && i === 0 ? (rng() < 0.5 ? -1 : 1) : i % 2 === 0 ? -1 : 1
      pod.position.set(
        side * peakWidth * (0.55 + rng() * 0.22),
        -peakHeight * (0.55 + rng() * 0.18),
        (rng() - 0.5) * length * 0.38
      )
      group.add(pod)
      // Pod clamp.
      const clamp = new THREE.Mesh(
        new THREE.BoxGeometry(pw * 1.05, ph * 0.12, pl * 0.15),
        mats.structure
      )
      clamp.position.copy(pod.position)
      clamp.position.y += ph * 0.45
      group.add(clamp)
    }
  }

  // Hazard / identity accent stripe(s) — placement varies by kit.
  if (kit % 5 !== 4) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(
        peakWidth * (0.08 + (kit % 3) * 0.03),
        peakHeight * 0.055,
        length * (0.35 + (kit % 4) * 0.08)
      ),
      mats.accent
    )
    const stripeY =
      kit % 3 === 0 ? peakHeight * 0.5 : kit % 3 === 1 ? -peakHeight * 0.35 : peakHeight * 0.15
    stripe.position.set(bridgeX * 0.35, stripeY, length * (0.02 - (kit % 4) * 0.03))
    group.add(stripe)
  }
  if (kit % 4 === 1) {
    // Second chevron stripe on the opposite side.
    const stripe2 = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.07, peakHeight * 0.04, length * 0.28),
      mats.accent
    )
    stripe2.position.set(-bridgeX * 0.4 - peakWidth * 0.35, peakHeight * 0.2, -length * 0.1)
    group.add(stripe2)
  }

  // Radar dishes — top, bottom, and/or side mounts (see style.radarDishes).
  const radarMounts = resolveRadarMounts(style, rng)
  const asymX =
    style.asymmetric
      ? peakWidth * (0.18 + rng() * 0.2) * (style.bridgeSide || (rng() < 0.5 ? -1 : 1))
      : peakWidth * 0.08
  let dishIdx = 0
  for (const entry of radarMounts) {
    const mount = typeof entry === 'string' ? entry : entry.mount
    const zFrac = (typeof entry === 'object' && entry.zFrac != null)
      ? entry.zFrac
      : 0.18 + dishIdx * 0.08 + (rng() - 0.5) * 0.06
    const size = typeof entry === 'object' && entry.size != null ? entry.size : 0.11 + rng() * 0.05
    addRadarDish(group, mats, peakWidth, peakHeight, length, mount, {
      x: mount === 'top' || mount === 'bottom' ? asymX * (dishIdx % 2 === 0 ? 1 : -0.6) : 0,
      zFrac,
      size,
      mastScale: 0.28 + rng() * 0.2
    })
    dishIdx++
  }
  // Legacy whip antenna near the primary dorsal dish when sensors are on.
  if ((style.hasSensorMast !== false || radarMounts.length > 0) && rng() < 0.65) {
    const whip = new THREE.Mesh(
      new THREE.CylinderGeometry(peakWidth * 0.009, peakWidth * 0.009, peakHeight * 0.95, 5),
      mats.antenna
    )
    whip.position.set(-asymX * 0.7, peakHeight * 1.12, length * 0.15)
    whip.rotation.z = 0.18
    group.add(whip)
  }

  // Docking collar ring near nose (freighters / explorers).
  if (style.hasDockingRing) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(peakWidth * 0.55, peakWidth * 0.055, 8, 20),
      mats.nacelle
    )
    ring.position.set(0, 0, length * 0.35)
    group.add(ring)
  }

  // RCS thruster blocks (four corners of mid-body).
  for (const [sx, sy] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ]) {
    const rcs = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.1, peakHeight * 0.1, peakWidth * 0.12),
      mats.nacelle
    )
    rcs.position.set(sx * peakWidth * 0.88, sy * peakHeight * 0.55, length * 0.05)
    group.add(rcs)
    // Tiny thruster nozzle.
    const noz = new THREE.Mesh(
      new THREE.CylinderGeometry(peakWidth * 0.025, peakWidth * 0.03, peakWidth * 0.06, 6),
      mats.structure
    )
    noz.rotation.z = sx > 0 ? Math.PI / 2 : -Math.PI / 2
    noz.position.set(sx * peakWidth * 0.95, sy * peakHeight * 0.55, length * 0.05)
    group.add(noz)
  }

  // Surface plating / greeble panels — density/shape varies by visual kit.
  const greebleCount = Math.round((18 + (kit % 6) * 3 + Math.floor(rng() * 18)) * density)
  for (let i = 0; i < greebleCount; i++) {
    const w = peakWidth * (0.035 + rng() * 0.13)
    const h = peakHeight * (0.03 + rng() * 0.1)
    const d = peakWidth * (0.06 + rng() * 0.26)
    const greeble = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      rng() < 0.45 ? mats.panel : mats.structure
    )
    const sideBias = style.asymmetric && rng() < 0.55 ? (style.bridgeSide || 1) * 0.35 : 0
    greeble.position.set(
      (rng() - 0.5 + sideBias) * peakWidth * 1.6,
      (rng() - 0.35) * peakHeight * 1.2,
      (rng() - 0.5) * length * 0.74
    )
    greeble.rotation.y = rng() * Math.PI * 0.4
    if (rng() < 0.25) greeble.rotation.z = (rng() - 0.5) * 0.4
    group.add(greeble)
  }

  // Conduit / cable trunks.
  const conduitCount = Math.round((4 + Math.floor(rng() * 4)) * density)
  for (let i = 0; i < conduitCount; i++) {
    const conduit = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.04, peakHeight * 0.05, length * (0.15 + rng() * 0.2)),
      mats.structure
    )
    conduit.position.set(
      (rng() - 0.5) * peakWidth * 1.1,
      (rng() - 0.2) * peakHeight * 0.9,
      (rng() - 0.5) * length * 0.4
    )
    group.add(conduit)
  }

  // Pipe runs along the spine + flanks.
  const pipeCount = Math.round((5 + Math.floor(rng() * 5)) * density)
  for (let i = 0; i < pipeCount; i++) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(peakWidth * 0.018, peakWidth * 0.018, length * (0.3 + rng() * 0.3), 8),
      mats.antenna
    )
    pipe.rotation.x = Math.PI / 2
    if (rng() < 0.3) pipe.rotation.z = (rng() - 0.5) * 0.5
    pipe.position.set(
      (rng() - 0.5) * peakWidth * 0.85 + bridgeX * 0.2,
      peakHeight * (0.35 + rng() * 0.35),
      (rng() - 0.5) * length * 0.2
    )
    group.add(pipe)
    // Pipe joint sphere.
    if (rng() < 0.5) {
      const joint = new THREE.Mesh(
        new THREE.SphereGeometry(peakWidth * 0.035, 8, 6),
        mats.structure
      )
      joint.position.copy(pipe.position)
      joint.position.z += length * 0.08
      group.add(joint)
    }
  }

  // Vent / grille blocks.
  const ventCount = Math.round((3 + Math.floor(rng() * 4)) * density)
  for (let i = 0; i < ventCount; i++) {
    const vent = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.2, peakHeight * 0.04, peakWidth * 0.25),
      mats.panel
    )
    vent.position.set(
      (rng() - 0.5) * peakWidth * 1.2,
      peakHeight * (0.3 + rng() * 0.4),
      (rng() - 0.5) * length * 0.5
    )
    group.add(vent)
    for (let g = 0; g < 3; g++) {
      const grill = new THREE.Mesh(
        new THREE.BoxGeometry(peakWidth * 0.18, peakHeight * 0.01, peakWidth * 0.02),
        mats.structure
      )
      grill.position.set(vent.position.x, vent.position.y + peakHeight * 0.03, vent.position.z + (g - 1) * peakWidth * 0.05)
      group.add(grill)
    }
  }

  // Underside cargo bay / heat shield plates (segmented).
  for (let i = 0; i < 3; i++) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.82, peakHeight * 0.055, length * 0.12),
      mats.panel
    )
    plate.position.set(
      style.asymmetric ? peakWidth * 0.1 * (style.bridgeSide || 1) : 0,
      -peakHeight * 0.52,
      -length * 0.15 + i * length * 0.12
    )
    group.add(plate)
  }

  // Side airlock / hatch (often off-center on asymmetric ships).
  const hatchSide = style.asymmetric
    ? style.bridgeSide !== 0
      ? -style.bridgeSide
      : 1
    : rng() < 0.5
      ? -1
      : 1
  const hatch = new THREE.Mesh(
    new THREE.CylinderGeometry(peakHeight * 0.22, peakHeight * 0.22, peakWidth * 0.08, 14),
    mats.nacelle
  )
  hatch.rotation.z = Math.PI / 2
  hatch.position.set(hatchSide * peakWidth * 0.95, 0, length * 0.1)
  group.add(hatch)
  const hatchRing = new THREE.Mesh(
    new THREE.TorusGeometry(peakHeight * 0.24, peakWidth * 0.02, 6, 16),
    mats.structure
  )
  hatchRing.rotation.y = Math.PI / 2
  hatchRing.position.copy(hatch.position)
  group.add(hatchRing)
  // Second hatch opposite side (common industrial detail).
  if (density > 1.4) {
    const hatch2 = hatch.clone()
    hatch2.position.x *= -1
    group.add(hatch2)
    const ring2 = hatchRing.clone()
    ring2.position.x *= -1
    group.add(ring2)
  }

  // Dorsal sensor ridge / spine armor.
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(peakWidth * 0.18, peakHeight * 0.12, length * 0.4),
    mats.structure
  )
  spine.position.set(bridgeX * 0.3, peakHeight * 0.72, length * 0.05)
  group.add(spine)
  for (let i = 0; i < 4; i++) {
    const tile = new THREE.Mesh(
      new THREE.BoxGeometry(peakWidth * 0.22, peakHeight * 0.04, length * 0.06),
      mats.panel
    )
    tile.position.set(bridgeX * 0.3, peakHeight * 0.8, -length * 0.1 + i * length * 0.1)
    group.add(tile)
  }
}

// Hull + EdgesGeometry are expensive (especially EdgesGeometry). Cache per class.
const _hullCache = new Map()
function getCachedHullGeometries(shipClass) {
  const id = shipClass.id
  let entry = _hullCache.get(id)
  if (entry) return entry
  const geometry = buildHullGeometry(shipClass.hull)
  // EdgesGeometry is the big hitch when many NPC meshes build mid-combat.
  const seams = new THREE.EdgesGeometry(geometry, 24)
  const rim = new THREE.EdgesGeometry(geometry, 38)
  entry = { geometry, seams, rim }
  _hullCache.set(id, entry)
  return entry
}

/**
 * Heavy industrial mining rig kit — ore hoppers, scoops, drill boom, pipes.
 * Used for role: miner hulls (not the generic freighter cargo-pod look).
 */
function addMinerDetails(group, hull, mats) {
  const rng = mulberry32(hashString(group.name + ':miner'))
  const length = hull.length ?? 20
  const peakW = Math.max(...(hull.stationWidths ?? [1.5]))
  const peakH = Math.max(...(hull.stationHeights ?? [1.2]))
  const dens = Math.max(1, (hull.style?.detailDensity ?? 1.8))
  const kit = Number.isFinite(hull.style?.visualKit) ? hull.style.visualKit : hashString(group.name) % 32
  const arch = hull.style?.archetype || 'skiff'

  // Rust / ore-stained panels for a working industrial read — kit-tinted.
  const rustHueShift = ((kit % 8) - 4) * 0.04
  const rust = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x6a4a32).offsetHSL(rustHueShift, 0, (kit % 5) * 0.02 - 0.04),
    metalness: 0.55,
    roughness: 0.72,
    ...shipArmorMaps(0.7)
  })
  const hazard = new THREE.MeshStandardMaterial({
    color: kit % 3 === 0 ? 0xd4a020 : kit % 3 === 1 ? 0xc06030 : 0x80a040,
    metalness: 0.35,
    roughness: 0.55,
    ...shipHullMaps(0.35)
  })
  const oreDust = new THREE.MeshStandardMaterial({
    color: 0x5a4838,
    metalness: 0.4,
    roughness: 0.85,
    ...shipStructureMaps(0.55)
  })

  // —— Forward ore scoop — layout varies by miner archetype / kit ——
  const scoopScale = arch === 'strip' ? 1.35 : arch === 'skiff' ? 0.85 : arch === 'silo' ? 0.9 : 1.15
  const scoopY = arch === 'silo' ? -peakH * 0.45 : arch === 'prospector' ? -peakH * 0.15 : -peakH * 0.25
  const scoopW = peakW * scoopScale
  const scoopH = peakH * (arch === 'strip' ? 0.35 : 0.55)
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(scoopW, scoopH, length * (0.08 + (kit % 4) * 0.015)), rust)
  scoop.position.set(0, scoopY, length * 0.42)
  group.add(scoop)
  // Jaw lips.
  for (const sy of [1, -1]) {
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(scoopW * 1.05, peakH * 0.08, length * 0.04),
      mats.structure
    )
    lip.position.set(0, -peakH * 0.25 + sy * scoopH * 0.48, length * 0.48)
    group.add(lip)
  }
  // Side scoop plates.
  for (const sx of [-1, 1]) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(peakW * 0.12, scoopH * 0.9, length * 0.14),
      mats.panel
    )
    plate.position.set(sx * scoopW * 0.52, -peakH * 0.25, length * 0.42)
    plate.rotation.y = sx * 0.15
    group.add(plate)
  }

  // —— Drill / mining boom under the nose ——
  const boomLen = length * (0.28 + rng() * 0.08)
  const boom = new THREE.Mesh(
    new THREE.CylinderGeometry(peakW * 0.06, peakW * 0.09, boomLen, 8),
    mats.nacelle
  )
  boom.rotation.x = Math.PI / 2
  boom.position.set(0, -peakH * 0.55, length * 0.28)
  group.add(boom)
  // Drill bit (spiral read = stacked cones).
  for (let i = 0; i < 4; i++) {
    const bit = new THREE.Mesh(
      new THREE.ConeGeometry(peakW * (0.1 - i * 0.015), peakW * 0.12, 7),
      mats.structure
    )
    bit.rotation.x = -Math.PI / 2
    bit.position.set(0, -peakH * 0.55, length * 0.28 + boomLen * 0.5 + i * peakW * 0.1)
    group.add(bit)
  }
  // Boom support struts.
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(
      new THREE.BoxGeometry(peakW * 0.05, peakH * 0.35, peakW * 0.05),
      mats.structure
    )
    strut.position.set(sx * peakW * 0.35, -peakH * 0.35, length * 0.22)
    strut.rotation.z = sx * 0.35
    group.add(strut)
  }

  // —— Ventral ore hoppers (main silhouette identity) ——
  const hopperCount = 2 + Math.floor(dens * 1.5) + Math.floor(rng() * 2)
  for (let i = 0; i < hopperCount; i++) {
    const t = hopperCount === 1 ? 0 : (i / (hopperCount - 1)) * 0.55 - 0.22
    const hw = peakW * (0.75 + rng() * 0.2)
    const hh = peakH * (0.55 + rng() * 0.25)
    const hl = length * (0.14 + rng() * 0.06)
    // Trapezoid hopper: wide box + tapered bottom dump.
    const body = new THREE.Mesh(new THREE.BoxGeometry(hw, hh * 0.65, hl), oreDust)
    body.position.set(0, -peakH * 0.75, t * length)
    group.add(body)
    const dump = new THREE.Mesh(
      new THREE.CylinderGeometry(hw * 0.22, hw * 0.45, hh * 0.45, 6),
      rust
    )
    dump.position.set(0, -peakH * 0.75 - hh * 0.45, t * length)
    group.add(dump)
    // Clamp frames.
    for (const sx of [-1, 1]) {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(hw * 0.08, hh * 0.7, hl * 1.05),
        mats.structure
      )
      frame.position.set(sx * hw * 0.48, -peakH * 0.72, t * length)
      group.add(frame)
    }
    // Hazard band on hopper face.
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(hw * 0.92, hh * 0.08, hl * 0.08),
      hazard
    )
    band.position.set(0, -peakH * 0.55, t * length + hl * 0.48)
    group.add(band)
  }

  // —— Side ore transfer ducts / conveyor casings ——
  for (const sx of [-1, 1]) {
    const duct = new THREE.Mesh(
      new THREE.CylinderGeometry(peakW * 0.1, peakW * 0.1, length * 0.55, 8),
      mats.panel
    )
    duct.rotation.z = Math.PI / 2
    duct.rotation.y = Math.PI / 2
    duct.position.set(sx * peakW * 0.95, -peakH * 0.15, length * 0.02)
    group.add(duct)
    // Duct joints.
    for (let j = 0; j < 3; j++) {
      const joint = new THREE.Mesh(
        new THREE.TorusGeometry(peakW * 0.11, peakW * 0.03, 6, 10),
        mats.structure
      )
      joint.rotation.y = Math.PI / 2
      joint.position.set(
        sx * peakW * 0.95,
        -peakH * 0.15,
        -length * 0.15 + j * length * 0.14
      )
      group.add(joint)
    }
  }

  // —— Stacked exhaust / vent stacks mid-dorsal ——
  const stacks = 2 + Math.floor(rng() * 2)
  for (let i = 0; i < stacks; i++) {
    const stackH = peakH * (0.45 + rng() * 0.35)
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(peakW * 0.07, peakW * 0.09, stackH, 8),
      mats.nacelle
    )
    stack.position.set(
      (i - (stacks - 1) / 2) * peakW * 0.28,
      peakH * 0.85 + stackH * 0.4,
      -length * 0.08 + i * length * 0.04
    )
    group.add(stack)
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(peakW * 0.11, peakW * 0.08, peakH * 0.08, 8),
      rust
    )
    cap.position.copy(stack.position)
    cap.position.y += stackH * 0.48
    group.add(cap)
  }

  // —— Pipe runs along the spine ——
  for (let p = 0; p < 3; p++) {
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(peakW * 0.03, peakW * 0.03, length * 0.5, 6),
      mats.antenna
    )
    pipe.rotation.x = Math.PI / 2
    pipe.position.set(
      (p - 1) * peakW * 0.18,
      peakH * (0.55 + (p % 2) * 0.12),
      length * 0.02
    )
    group.add(pipe)
  }

  // —— Crane / derrick on larger hulls ——
  if (length >= 28) {
    const mastH = peakH * 1.4
    const mast = new THREE.Mesh(
      new THREE.BoxGeometry(peakW * 0.1, mastH, peakW * 0.1),
      mats.structure
    )
    mast.position.set(peakW * 0.15, peakH * 0.9 + mastH * 0.35, -length * 0.05)
    group.add(mast)
    const jib = new THREE.Mesh(
      new THREE.BoxGeometry(peakW * 0.08, peakW * 0.08, length * 0.32),
      mats.structure
    )
    jib.position.set(peakW * 0.15, peakH * 0.9 + mastH * 0.7, length * 0.08)
    jib.rotation.x = -0.35
    group.add(jib)
    // Cable
    const cable = new THREE.Mesh(
      new THREE.CylinderGeometry(peakW * 0.012, peakW * 0.012, peakH * 0.8, 5),
      mats.antenna
    )
    cable.position.set(peakW * 0.15, peakH * 0.5, length * 0.18)
    group.add(cable)
    const hook = new THREE.Mesh(new THREE.TorusGeometry(peakW * 0.06, peakW * 0.02, 6, 10), rust)
    hook.position.set(peakW * 0.15, peakH * 0.12, length * 0.18)
    group.add(hook)
  }

  // —— Hazard chevron stripes along flanks ——
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(peakW * 0.04, peakH * 0.35, length * 0.04),
        hazard
      )
      stripe.position.set(
        sx * peakW * 0.98,
        -peakH * 0.05,
        -length * 0.25 + i * length * 0.1
      )
      stripe.rotation.z = sx * 0.08
      group.add(stripe)
    }
  }

  // —— Landing skids / gear (grounded industrial craft) ——
  for (const sx of [-1, 1]) {
    for (const zf of [-0.2, 0.15]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(peakW * 0.08, peakH * 0.5, peakW * 0.12),
        mats.structure
      )
      leg.position.set(sx * peakW * 0.55, -peakH * 1.05, zf * length)
      group.add(leg)
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(peakW * 0.28, peakH * 0.08, peakW * 0.35),
        rust
      )
      pad.position.set(sx * peakW * 0.55, -peakH * 1.32, zf * length)
      group.add(pad)
    }
  }

  // —— Aft dump chute ——
  const chute = new THREE.Mesh(
    new THREE.CylinderGeometry(peakW * 0.2, peakW * 0.35, length * 0.15, 6),
    oreDust
  )
  chute.rotation.x = 0.6
  chute.position.set(0, -peakH * 0.6, -length * 0.38)
  group.add(chute)
}

/**
 * Organic alien add-ons — cysts, tendrils, glow nodules (not industrial plates).
 */
function addAlienDetails(group, hull, mats, baseColor) {
  const length = hull.length ?? 18
  const peakW = Math.max(...(hull.stationWidths ?? [1]))
  const peakH = Math.max(...(hull.stationHeights ?? [1]))
  const glowCol = baseColor.clone().offsetHSL(0.08, 0.4, 0.15)

  const glowMat = new THREE.MeshBasicMaterial({
    color: glowCol,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })

  // Mid-body cysts / blisters.
  for (let i = 0; i < 5; i++) {
    const u = (i / 4) * 0.7 - 0.15
    const side = i % 2 === 0 ? 1 : -1
    const blister = new THREE.Mesh(
      new THREE.SphereGeometry(peakH * (0.18 + (i % 3) * 0.05), 10, 8),
      mats.panel
    )
    blister.scale.set(1.1, 0.75, 1.3)
    blister.position.set(side * peakW * 0.55, peakH * (0.2 + (i % 2) * 0.15), u * length)
    group.add(blister)
    const node = new THREE.Mesh(new THREE.SphereGeometry(peakH * 0.08, 8, 6), glowMat)
    node.position.copy(blister.position).add(new THREE.Vector3(side * peakW * 0.12, peakH * 0.08, 0))
    group.add(node)
  }

  // Forward sensory stalks.
  for (const side of [-1, 1]) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(peakW * 0.04, peakW * 0.07, peakH * 0.9, 6),
      mats.structure
    )
    stalk.rotation.z = side * 0.55
    stalk.rotation.x = 0.4
    stalk.position.set(side * peakW * 0.35, peakH * 0.45, length * 0.28)
    group.add(stalk)
    const eye = new THREE.Mesh(new THREE.SphereGeometry(peakH * 0.1, 8, 6), glowMat)
    eye.position.set(side * peakW * 0.55, peakH * 0.85, length * 0.38)
    group.add(eye)
  }

  // Aft organic thruster orifices (not human engine cones).
  for (let i = 0; i < 3; i++) {
    const ang = ((i - 1) / 2) * 0.9
    const orifice = new THREE.Mesh(
      new THREE.TorusGeometry(peakW * 0.12, peakW * 0.04, 6, 12),
      mats.engineGlow ?? glowMat
    )
    orifice.position.set(Math.sin(ang) * peakW * 0.35, Math.cos(ang) * peakH * 0.2, -length * 0.42)
    orifice.rotation.y = Math.PI / 2
    group.add(orifice)
    const jet = new THREE.Mesh(
      new THREE.ConeGeometry(peakW * 0.1, peakH * 0.5, 8),
      mats.engineCone ?? glowMat
    )
    jet.rotation.x = Math.PI / 2
    jet.position.set(orifice.position.x, orifice.position.y, -length * 0.52)
    group.add(jet)
  }

  // Lateral tendril fins (extra weirdness beyond hull.wings).
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const t = new THREE.Mesh(
        new THREE.CapsuleGeometry(peakW * 0.06, peakW * (0.6 + k * 0.15), 4, 6),
        mats.structure
      )
      t.rotation.z = side * (0.9 + k * 0.15)
      t.rotation.y = k * 0.2
      t.position.set(side * peakW * 0.7, -peakH * 0.1 + k * 0.12, -length * 0.05 + k * length * 0.08)
      group.add(t)
    }
  }
}

/**
 * @param {object} shipClass
 * @param {{ lite?: boolean }} [opts] lite=true for NPCs: skip edge overlays (big CPU save).
 */
export function buildShipMesh(shipClass, opts = {}) {
  const group = new THREE.Group()
  group.name = shipClass.id
  const lite = !!opts.lite

  const isPolice =
    shipClass.faction === 'police' || !!shipClass.hull?.style?.policeLivery
  const isAlien = !!(shipClass.alien || shipClass.hull?.style?.alien)
  const isMiner =
    shipClass.role === 'miner' || !!shipClass.hull?.style?.miningRig

  // Police: bright white hull (skip heavy PBR maps — they mute pure white).
  // Miners: dirtier bronze / ore-stained industrial paint.
  const baseColor = isPolice
    ? new THREE.Color(0xf4f7fb)
    : isMiner
      ? new THREE.Color(shipClass.hull.color).offsetHSL(0.02, 0.05, -0.04)
      : new THREE.Color(shipClass.hull.color)
  const mats = makeDetailMaterials(isPolice ? new THREE.Color(0x1a1c20) : baseColor)

  if (isMiner && !isAlien) {
    // Worked metal — less polished than combat hulls.
    mats.panel = new THREE.MeshStandardMaterial({
      color: baseColor.clone().multiplyScalar(0.65),
      metalness: 0.78,
      roughness: 0.58,
      ...shipArmorMaps(0.7)
    })
    mats.structure = new THREE.MeshStandardMaterial({
      color: baseColor.clone().offsetHSL(-0.02, -0.05, -0.08),
      metalness: 0.82,
      roughness: 0.52,
      ...shipStructureMaps(0.62)
    })
    mats.accent = new THREE.MeshStandardMaterial({
      color: 0xe0a010,
      metalness: 0.4,
      roughness: 0.5,
      ...shipHullMaps(0.4)
    })
  }

  // Alien detail mats: organic rock + plate PBR, emissive green/violet sheen.
  if (isAlien) {
    mats.panel = new THREE.MeshStandardMaterial({
      color: baseColor.clone().multiplyScalar(0.75),
      metalness: 0.35,
      roughness: 0.62,
      emissive: baseColor.clone().multiplyScalar(0.12),
      emissiveIntensity: 0.35,
      ...alienPlateMaps(0.72)
    })
    mats.structure = new THREE.MeshStandardMaterial({
      color: baseColor.clone().offsetHSL(0.05, 0.1, -0.1),
      metalness: 0.28,
      roughness: 0.7,
      ...alienHullMaps(0.8)
    })
    mats.engineGlow = new THREE.MeshBasicMaterial({
      color: 0x9bff4a,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    mats.engineCone = new THREE.MeshBasicMaterial({
      color: 0xc44bff,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  }

  const { geometry, seams, rim: rimGeo } = getCachedHullGeometries(shipClass)
  const material = isPolice
    ? new THREE.MeshStandardMaterial({
        color: baseColor,
        side: THREE.DoubleSide,
        metalness: 0.28,
        roughness: 0.48,
        envMapIntensity: 0.85
      })
    : isAlien
      ? new THREE.MeshStandardMaterial({
          color: baseColor,
          side: THREE.DoubleSide,
          metalness: 0.32,
          roughness: 0.58,
          emissive: baseColor.clone().multiplyScalar(0.08),
          emissiveIntensity: 0.28,
          envMapIntensity: 0.7,
          ...alienHullMaps(0.75)
        })
      : isMiner
        ? new THREE.MeshStandardMaterial({
            color: baseColor,
            side: THREE.DoubleSide,
            metalness: 0.62,
            roughness: 0.58,
            envMapIntensity: 0.75,
            ...shipHullMaps(0.72)
          })
        : new THREE.MeshStandardMaterial({
            color: baseColor,
            side: THREE.DoubleSide,
            metalness: 0.72,
            roughness: 0.42,
            envMapIntensity: 1.05,
            ...shipHullMaps(0.58)
          })
  const hullMesh = new THREE.Mesh(geometry, material)
  group.add(hullMesh)

  // Edge overlays are cosmetic; skip for NPCs to avoid combat-spawn hitches.
  if (!lite) {
    group.add(
      new THREE.LineSegments(
        seams,
        new THREE.LineBasicMaterial({
          color: isPolice ? 0x1a2030 : isAlien ? 0x1a3020 : isMiner ? 0x1a1208 : 0x0a0c10,
          transparent: true,
          opacity: isPolice ? 0.55 : isAlien ? 0.45 : isMiner ? 0.5 : 0.35
        })
      )
    )
    group.add(
      new THREE.LineSegments(
        rimGeo,
        new THREE.LineBasicMaterial({
          color: isPolice ? 0xc8d4e8 : isAlien ? 0x7fff6a : isMiner ? 0xc4a060 : 0x6a8aaa,
          transparent: true,
          opacity: isPolice ? 0.35 : isAlien ? 0.28 : isMiner ? 0.22 : 0.16
        })
      )
    )
  }

  // Full bolted-on detail for the player ship only — NPC detail is a major
  // cost when many contacts mesh on the same combat frame.
  if (!lite) {
    if (isAlien) addAlienDetails(group, shipClass.hull, mats, baseColor)
    else if (isMiner) {
      // Shared industrial plates first, then mining-specific hoppers / scoops.
      addHullDetails(group, shipClass.hull, mats)
      addMinerDetails(group, shipClass.hull, mats)
    } else addHullDetails(group, shipClass.hull, mats)
  } else if (isAlien) {
    // Lite alien NPCs still get a couple glow nodes so they read as non-human.
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 6, 6),
      new THREE.MeshBasicMaterial({
        color: 0x9bff4a,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    glow.position.set(0, 0.8, 2)
    group.add(glow)
  }

  for (const hp of shipClass.hardpoints ?? []) {
    const marker = new THREE.Mesh(hardpointMarkerGeometry, mats.hardpoint)
    marker.position.set(...hp.position)
    marker.rotation.x = Math.PI / 2
    group.add(marker)
  }

  // Police: bold black/white livery + red/blue emergency flashers.
  if (isPolice) {
    addPoliceDetails(group, shipClass.hull, geometry)
  }

  retileShipUVs(group)
  return group
}

/**
 * Give every plated part of a hull a consistent texel density.
 *
 * Ship parts are primitives, so each one carried the default 0..1 UV per face
 * while the plating maps tile at repeat(1,1). A 0.3-unit fin and a 12-unit hull
 * therefore each received exactly ONE copy of the texture — the plating scale
 * jumped between neighbouring parts and stretched on any non-square face, which
 * is what read as misaligned. Projecting per face in local space ties the tile
 * size to real geometry instead, so plates match across the whole ship.
 *
 * Per FACE, not per vertex — a per-vertex axis choice tears any triangle whose
 * corners disagree (see retileUVsTriplanar).
 *
 * Skips anything without a colour map: canopies, engine glow and other emissive
 * bits are untextured and only pay the cost.
 */
function retileShipUVs(group) {
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    if (o.geometry.userData.shipRetiled) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    if (!mats.some((m) => m?.map)) return
    // ~1 plate per world unit: hulls run 15-30 units, so this gives plating
    // that reads at cockpit range without turning into noise from outside.
    const retiled = retileUVsTriplanar(o.geometry, 1.1)
    retiled.userData.shipRetiled = true
    o.geometry = retiled
  })
}

// Shared materials for all police ships — avoids per-instance alloc + hitch.
// No PointLights: adding dynamic lights recompiles every MeshStandardMaterial
// in the scene (large hitch when the first patrol mesh is created / combat starts near stations).
let _policeMats = null
function policeMaterials() {
  if (_policeMats) return _policeMats
  _policeMats = {
    black: new THREE.MeshStandardMaterial({
      color: 0x0a0c10,
      metalness: 0.55,
      roughness: 0.55
    }),
    white: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.2,
      roughness: 0.4
    }),
    red: new THREE.MeshBasicMaterial({
      color: 0xff2040,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }),
    blue: new THREE.MeshBasicMaterial({
      color: 0x2090ff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }),
    redGlow: new THREE.MeshBasicMaterial({
      color: 0xff2040,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }),
    blueGlow: new THREE.MeshBasicMaterial({
      color: 0x2090ff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  }
  return _policeMats
}

/**
 * High-contrast black/white authority livery + red/blue light bars.
 * Emissive-only flashers (no PointLights) so combat near stations stays smooth.
 */
function addPoliceDetails(group, hull, hullGeometry) {
  hullGeometry.computeBoundingBox()
  const box = hullGeometry.boundingBox
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const len = Math.max(size.z, hull?.length ?? 20)
  const width = Math.max(size.x, 4)
  const height = Math.max(size.y, 2)
  const topY = box.max.y
  const mats = policeMaterials()

  // Wide dorsal black racing stripe (nose → tail).
  const dorsal = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.55, width * 0.14), Math.max(0.18, height * 0.08), len * 0.72),
    mats.black
  )
  dorsal.position.set(center.x, topY + height * 0.04, center.z * 0.15)
  group.add(dorsal)

  // Nose cone black cap.
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.55, height * 0.55, len * 0.12),
    mats.black
  )
  nose.position.set(center.x, center.y * 0.3, box.max.z - len * 0.04)
  group.add(nose)

  // Rear black band.
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.7, height * 0.5, len * 0.1),
    mats.black
  )
  tail.position.set(center.x, center.y * 0.2, box.min.z + len * 0.05)
  group.add(tail)

  // Side black panels + wing tips.
  for (const side of [-1, 1]) {
    const sidePanel = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.2, width * 0.06), height * 0.45, len * 0.4),
      mats.black
    )
    sidePanel.position.set(side * width * 0.42, center.y * 0.15, center.z)
    group.add(sidePanel)

    const tip = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.22, height * 0.12, len * 0.14),
      mats.black
    )
    tip.position.set(side * width * 0.55, center.y * 0.1, center.z - len * 0.05)
    group.add(tip)
  }

  // Checker-style mid-hull blocks.
  for (let i = 0; i < 3; i++) {
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.18, height * 0.14, len * 0.08),
      i % 2 === 0 ? mats.black : mats.white
    )
    block.position.set(
      ((i % 2) * 2 - 1) * width * 0.2,
      topY + height * 0.02,
      center.z - len * 0.12 + i * len * 0.1
    )
    group.add(block)
  }

  // Light bar housing.
  const barY = topY + height * 0.12
  const barZ = center.z + len * 0.08
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.42, height * 0.1, len * 0.1),
    mats.black
  )
  housing.position.set(center.x, barY, barZ)
  group.add(housing)

  // Large light lenses (read at range) — MeshBasic only, no scene lights.
  const lensR = Math.max(0.35, width * 0.09)
  const red = new THREE.Mesh(new THREE.SphereGeometry(lensR, 10, 8), mats.red)
  red.position.set(center.x - width * 0.12, barY + height * 0.06, barZ)
  red.name = 'police-light-red'
  const blue = new THREE.Mesh(new THREE.SphereGeometry(lensR, 10, 8), mats.blue)
  blue.position.set(center.x + width * 0.12, barY + height * 0.06, barZ)
  blue.name = 'police-light-blue'
  const redGlow = new THREE.Mesh(new THREE.SphereGeometry(lensR * 1.55, 8, 6), mats.redGlow)
  redGlow.position.copy(red.position)
  const blueGlow = new THREE.Mesh(new THREE.SphereGeometry(lensR * 1.55, 8, 6), mats.blueGlow)
  blueGlow.position.copy(blue.position)

  group.add(red, blue, redGlow, blueGlow)
  group.userData.policeLights = { red, blue, redGlow, blueGlow, lastPhase: -1 }
}

/** Alternate red/blue emergency flashers (scale only — shared materials flash in sync). */
export function updatePoliceLights(mesh, elapsed) {
  const lights = mesh?.userData?.policeLights
  if (!lights) return
  // Discrete phase 0/1 so we skip work when state unchanged.
  const phase = ((elapsed * 6.5) / Math.PI) | 0
  if (phase === lights.lastPhase) return
  lights.lastPhase = phase
  const redOn = phase % 2 === 0
  const rs = redOn ? 1.25 : 0.7
  const bs = redOn ? 0.7 : 1.25
  lights.red.scale.setScalar(rs)
  lights.blue.scale.setScalar(bs)
  lights.redGlow.scale.setScalar(rs * 1.15)
  lights.blueGlow.scale.setScalar(bs * 1.15)
  lights.red.visible = true
  lights.blue.visible = true
  lights.redGlow.visible = redOn
  lights.blueGlow.visible = !redOn
}
