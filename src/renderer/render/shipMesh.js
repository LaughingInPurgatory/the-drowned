import * as THREE from 'three'
import { turretMountLocal } from '../game/turret.js'
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
  const z = opts.zAbs ?? (opts.zFrac ?? 0.22) * length
  const size = peakWidth * (opts.size ?? 0.13)
  const mastH = peakHeight * (opts.mastScale ?? 0.35)
  const xOff = opts.x ?? 0
  const yOff = opts.y ?? 0
  // yAbs mounts the dish at a given height instead of on the hull surface —
  // used to put it on the crosstrees where a boat's radar actually lives.
  const topY = opts.yAbs ?? peakHeight * 0.92

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
    const root = new THREE.Vector3(xOff, topY, z)
    const tip = new THREE.Vector3(xOff, topY + mastH, z)
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


// Cosmetic details on the parametric hull — canopy, engines, radiators,
// greebles, cargo. Seeded per class id so every ship of a class matches.
// style.visualKit (0–31) + platingStyle branch layout so same-role hulls diverge.
/**
 * Everything above the sheer line.
 *
 * The hull itself is lofted from station lines (procgen/hull.js) and already
 * reads as a boat. What makes it read as a *working* boat is what is bolted to
 * the deck: a wheelhouse, a stack, a mast with a radar on it, railings you
 * could fall over, and whatever gear the trade calls for. That is all this is.
 *
 * Everything here is positioned relative to the sheer (the top of the hull at
 * that station), so it sits on the deck regardless of how the hull was lofted.
 */
function addHullDetails(group, hull, mats, role = 'trader') {
  const rng = mulberry32(hashString(group.name))
  const { length, stationWidths, stationHeights } = hull
  const beam = Math.max(...stationWidths)
  const depth = Math.max(...stationHeights)
  const style = defaultStyle(hull, rng)
  const kit = Number.isFinite(style.visualKit) ? style.visualKit : hashString(group.name) % 32
  const last = stationWidths.length - 1

  const add = (mesh) => {
    mesh.castShadow = true
    group.add(mesh)
    return mesh
  }

  /** Station index (0 = transom, last = bow) for a fraction along the hull. */
  const stationAt = (f) => Math.max(0, Math.min(last, Math.round(f * last)))
  /** Z of a fraction along the hull; -length/2 is the transom. */
  const zAt = (f) => -length / 2 + f * length
  /** Half-beam at a fraction along the hull. */
  const halfBeamAt = (f) => stationWidths[stationAt(f)]
  /** Deck height at a fraction along the hull — the top of the hull there. */
  const deckAt = (f) => {
    const i = stationAt(f)
    const off = hull.stationOffsetsY?.[i] ?? 0
    return stationHeights[i] + off
  }

  // No deck slab here any more. The hull lofter builds a real cambered deck as
  // part of the section (see procgen/hull.js), so laying another one on top of
  // it just z-fights.

  // —— Wheelhouse ——————————————————————————————————————————————————
  // Where it sits is most of a vessel's silhouette: a trawler works its deck
  // forward of an aft house; a freighter keeps the house right aft over the
  // engine; a fast boat puts it amidships.
  const housePos =
    role === 'trader' ? 0.22 : role === 'fighter' ? 0.44 : role === 'miner' ? 0.26 : 0.38
  const houseZ = zAt(housePos)
  const houseDeck = deckAt(housePos)
  const houseW = halfBeamAt(housePos) * (1.05 + rng() * 0.3)
  const houseL = length * (0.1 + rng() * 0.07)
  const houseH = depth * (0.85 + rng() * 0.6)

  const house = add(
    new THREE.Mesh(new THREE.BoxGeometry(houseW * 2, houseH, houseL), mats.structure)
  )
  house.position.set(0, houseDeck + houseH * 0.5, houseZ)

  // Bridge windows — a band right round the front and sides.
  {
    const bandH = houseH * 0.3
    const bandY = houseDeck + houseH * 0.74
    const front = add(
      new THREE.Mesh(new THREE.BoxGeometry(houseW * 1.92, bandH, houseL * 0.06), mats.window)
    )
    front.position.set(0, bandY, houseZ + houseL * 0.5)
    for (const sx of [-1, 1]) {
      const sideWin = add(
        new THREE.Mesh(new THREE.BoxGeometry(houseW * 0.06, bandH, houseL * 0.72), mats.window)
      )
      sideWin.position.set(sx * houseW, bandY, houseZ)
    }
  }

  // Cabin roof — a lip over the windows, and a step-down upper deck on bigger
  // hulls so the house is not one plain block.
  {
    const roof = add(
      new THREE.Mesh(
        new THREE.BoxGeometry(houseW * 2.15, houseH * 0.07, houseL * 1.12),
        mats.panel
      )
    )
    roof.position.set(0, houseDeck + houseH, houseZ)
    if (beam > length * 0.06 || rng() < 0.5) {
      const upper = add(
        new THREE.Mesh(
          new THREE.BoxGeometry(houseW * 1.25, houseH * 0.5, houseL * 0.6),
          mats.structure
        )
      )
      upper.position.set(0, houseDeck + houseH * 1.25, houseZ - houseL * 0.08)
    }
  }

  // —— Funnel ——————————————————————————————————————————————————————
  // Aft of the house, raked back. Diesel has to go somewhere.
  {
    const fz = houseZ - houseL * (0.75 + rng() * 0.4)
    const fr = depth * (0.16 + rng() * 0.1)
    const fh = depth * (0.7 + rng() * 0.7)
    const funnel = add(
      new THREE.Mesh(new THREE.CylinderGeometry(fr * 0.86, fr, fh, 10), mats.nacelle)
    )
    funnel.position.set(0, deckAt(housePos) + fh * 0.5, fz)
    funnel.rotation.x = -0.1
    // Painted band — the one bit of colour most working boats carry.
    const band = add(
      new THREE.Mesh(new THREE.CylinderGeometry(fr * 1.04, fr * 1.04, fh * 0.2, 10), mats.accent)
    )
    band.position.set(0, deckAt(housePos) + fh * 0.78, fz + fh * 0.03)
    band.rotation.x = -0.1
    // Soot-black cap.
    const cap = add(
      new THREE.Mesh(new THREE.CylinderGeometry(fr * 0.9, fr * 0.9, fh * 0.06, 10), mats.hardpoint)
    )
    cap.position.set(0, deckAt(housePos) + fh, fz - fh * 0.05)
  }

  // —— Mast ————————————————————————————————————————————————————————
  // Stepped just forward of the house, with crosstrees and a masthead light.
  const mastZ = houseZ + houseL * 0.5
  const mastBase = deckAt(housePos) + houseH * 1.05
  const mastH = depth * (1.5 + rng() * 1.2)
  {
    const mast = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(beam * 0.022, beam * 0.03, mastH, 6),
        mats.antenna
      )
    )
    mast.position.set(0, mastBase + mastH * 0.5, mastZ)
    const cross = add(
      new THREE.Mesh(
        new THREE.BoxGeometry(beam * 0.9, beam * 0.03, beam * 0.05),
        mats.antenna
      )
    )
    cross.position.set(0, mastBase + mastH * 0.62, mastZ)
    // Stays running down to the deck — cheap, and they read as rigging.
    for (const sx of [-1, 1]) {
      const stay = add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(beam * 0.006, beam * 0.006, mastH * 0.92, 4),
          mats.antenna
        )
      )
      stay.position.set(sx * beam * 0.3, mastBase + mastH * 0.42, mastZ - beam * 0.1)
      stay.rotation.z = sx * 0.32
      stay.rotation.x = 0.14
    }
    // Masthead and sidelights.
    const masthead = add(
      new THREE.Mesh(new THREE.SphereGeometry(beam * 0.035, 8, 6), mats.window)
    )
    masthead.position.set(0, mastBase + mastH, mastZ)
    for (const sx of [-1, 1]) {
      const nav = add(new THREE.Mesh(new THREE.SphereGeometry(beam * 0.028, 6, 5), mats.window))
      nav.position.set(sx * beam * 0.45, mastBase + mastH * 0.62, mastZ)
    }
  }

  // Radar on the crosstrees, where it belongs.
  addRadarDish(group, mats, beam, depth, length, 'top', {
    x: 0,
    yAbs: mastBase + mastH * 0.66,
    zAbs: mastZ,
    size: 0.5 + rng() * 0.25,
    mastScale: 0.06
  })

  // —— Bulwark ————————————————————————————————————————————————————
  // A solid wall standing up from the deck edge, following the sheer.
  //
  // This is the single detail that stops a hull reading as a raft. Seen from
  // the chase camera you look *down* at a boat, and with a bare flat deck there
  // is no side to see — the water meets the deck and the whole thing looks
  // awash. Thin stanchions do not fix that at any distance; a solid strake
  // does, because it gives the deck an edge that stands proud of the sea.
  const bulwarkH = depth * 0.34
  {
    const segs = 16
    const thickness = Math.max(0.06, beam * 0.05)
    for (const sx of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const f0 = 0.04 + (i / segs) * 0.9
        const f1 = 0.04 + ((i + 1) / segs) * 0.9
        const x0 = sx * halfBeamAt(f0) * 0.97
        const x1 = sx * halfBeamAt(f1) * 0.97
        const z0 = zAt(f0)
        const z1 = zAt(f1)
        const dx = x1 - x0
        const dz = z1 - z0
        const run = Math.hypot(dx, dz)
        if (run < 1e-4) continue
        // The sheer rises toward the bow, so each segment sits at its own
        // deck height rather than one level all the way along.
        const y = (deckAt(f0) + deckAt(f1)) * 0.5
        const panel = add(
          new THREE.Mesh(new THREE.BoxGeometry(thickness, bulwarkH, run * 1.06), mats.panel)
        )
        panel.position.set((x0 + x1) * 0.5, y + bulwarkH * 0.42, (z0 + z1) * 0.5)
        panel.rotation.y = Math.atan2(dx, dz)
      }
    }
    // Capping rail along the top of the strake — segmented so it follows the
    // sheer. A single long box at midships beam stuck out past bow and stern
    // on every tapered hull (read as random girders).
    for (const sx of [-1, 1]) {
      for (let i = 0; i < segs; i++) {
        const f0 = 0.04 + (i / segs) * 0.9
        const f1 = 0.04 + ((i + 1) / segs) * 0.9
        const x0 = sx * halfBeamAt(f0) * 0.97
        const x1 = sx * halfBeamAt(f1) * 0.97
        const z0 = zAt(f0)
        const z1 = zAt(f1)
        const dx = x1 - x0
        const dz = z1 - z0
        const run = Math.hypot(dx, dz)
        if (run < 1e-4) continue
        const y = (deckAt(f0) + deckAt(f1)) * 0.5 + bulwarkH * 0.9
        const cap = add(
          new THREE.Mesh(
            new THREE.BoxGeometry(thickness * 1.5, depth * 0.05, run * 1.04),
            mats.accent
          )
        )
        cap.position.set((x0 + x1) * 0.5, y, (z0 + z1) * 0.5)
        cap.rotation.y = Math.atan2(dx, dz)
      }
    }
  }

  // —— Railings ————————————————————————————————————————————————————
  // Stanchions + rails on top of the bulwark, also segmented to the sheer so
  // they never poke past the ends of a pinching hull.
  {
    const posts = 9 + (kit % 5)
    const stanchionH = depth * 0.3
    for (let i = 0; i < posts; i++) {
      const f = 0.06 + (i / (posts - 1)) * 0.86
      const hb = halfBeamAt(f) * 0.94
      if (hb < beam * 0.12) continue
      const railY = deckAt(f) * 0.96 + bulwarkH
      for (const sx of [-1, 1]) {
        const post = add(
          new THREE.Mesh(
            new THREE.CylinderGeometry(beam * 0.012, beam * 0.012, stanchionH, 4),
            mats.antenna
          )
        )
        post.position.set(sx * hb, railY + stanchionH * 0.5, zAt(f))
      }
    }
    // Two horizontal rails per side — short runs between stanchion stations.
    const railSegs = posts - 1
    for (const sx of [-1, 1]) {
      for (const h of [0.55, 1.0]) {
        for (let i = 0; i < railSegs; i++) {
          const f0 = 0.06 + (i / (posts - 1)) * 0.86
          const f1 = 0.06 + ((i + 1) / (posts - 1)) * 0.86
          const x0 = sx * halfBeamAt(f0) * 0.94
          const x1 = sx * halfBeamAt(f1) * 0.94
          const z0 = zAt(f0)
          const z1 = zAt(f1)
          const dx = x1 - x0
          const dz = z1 - z0
          const run = Math.hypot(dx, dz)
          if (run < 1e-4) continue
          if (halfBeamAt(f0) < beam * 0.12 || halfBeamAt(f1) < beam * 0.12) continue
          const y0 = deckAt(f0) * 0.96 + bulwarkH + stanchionH * h
          const y1 = deckAt(f1) * 0.96 + bulwarkH + stanchionH * h
          const rail = add(
            new THREE.Mesh(
              new THREE.BoxGeometry(beam * 0.018, beam * 0.018, run * 1.02),
              mats.antenna
            )
          )
          rail.position.set((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5)
          rail.rotation.y = Math.atan2(dx, dz)
          // Pitch the rail a little with the sheer so it sits on the stanchions.
          const rise = y1 - y0
          if (Math.abs(rise) > 1e-4 && run > 1e-4) {
            rail.rotation.x = -Math.atan2(rise, run)
          }
        }
      }
    }
  }

  // —— Bow gear ————————————————————————————————————————————————————
  {
    const bowF = 0.9
    const bowDeck = deckAt(bowF)
    // Anchor windlass.
    const windlass = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(beam * 0.09, beam * 0.09, beam * 0.22, 8),
        mats.nacelle
      )
    )
    windlass.rotation.z = Math.PI / 2
    windlass.position.set(0, bowDeck + beam * 0.09, zAt(bowF))
    // Anchor stowed against the bow.
    const anchor = add(
      new THREE.Mesh(new THREE.BoxGeometry(beam * 0.06, depth * 0.3, depth * 0.1), mats.hardpoint)
    )
    anchor.position.set(halfBeamAt(0.95) * 0.9, bowDeck * 0.35, zAt(0.95))
    // Bollards, fore and aft.
    for (const f of [0.84, 0.14]) {
      for (const sx of [-1, 1]) {
        const bol = add(
          new THREE.Mesh(
            new THREE.CylinderGeometry(beam * 0.03, beam * 0.035, depth * 0.18, 6),
            mats.nacelle
          )
        )
        bol.position.set(sx * halfBeamAt(f) * 0.7, deckAt(f) + depth * 0.09, zAt(f))
      }
    }
  }

  // —— Fenders ——————————————————————————————————————————————————————
  // Old tyres and rope bundles down the side. Nothing says "this boat comes
  // alongside a lot" more cheaply.
  {
    const count = 3 + (kit % 3)
    for (let i = 0; i < count; i++) {
      const f = 0.3 + (i / Math.max(1, count - 1)) * 0.4
      for (const sx of [-1, 1]) {
        const fender = add(
          new THREE.Mesh(
            new THREE.TorusGeometry(depth * 0.16, depth * 0.055, 5, 9),
            mats.hardpoint
          )
        )
        fender.position.set(sx * halfBeamAt(f) * 1.0, deckAt(f) * 0.35, zAt(f))
        fender.rotation.y = Math.PI / 2
      }
    }
  }

  // —— Trade gear ——————————————————————————————————————————————————
  if (role === 'trader') {
    // Deck cargo: stacked containers, lashed down forward of the house.
    const rows = 2 + (kit % 3)
    const cw = halfBeamAt(0.6) * 0.42
    for (let r = 0; r < rows; r++) {
      const f = 0.5 + r * 0.13
      if (f > 0.82) break
      const stack = 1 + (rng() < 0.45 ? 1 : 0)
      for (let sIdx = 0; sIdx < stack; sIdx++) {
        for (const sx of [-1, 1]) {
          const box = add(
            new THREE.Mesh(
              new THREE.BoxGeometry(cw, depth * 0.42, length * 0.085),
              sIdx % 2 === 0 ? mats.panel : mats.accent
            )
          )
          box.position.set(
            sx * cw * 0.55,
            deckAt(f) * 0.96 + depth * 0.21 + sIdx * depth * 0.44,
            zAt(f)
          )
        }
      }
    }
    // Deck crane on the bigger hulls.
    if (beam > length * 0.055) {
      const craneBase = add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(beam * 0.09, beam * 0.11, depth * 0.5, 8),
          mats.structure
        )
      )
      craneBase.position.set(0, deckAt(0.42) + depth * 0.25, zAt(0.42))
      const jib = add(
        new THREE.Mesh(
          new THREE.BoxGeometry(beam * 0.06, beam * 0.06, length * 0.2),
          mats.structure
        )
      )
      jib.position.set(0, deckAt(0.42) + depth * 0.62, zAt(0.5))
      jib.rotation.x = -0.42
    }
  }

  // —— Gun boat gear ————————————————————————————————————————————————
  if (role === 'fighter') {
    // Forward gun tub — a ring of plate around a mount.
    const tubF = 0.72
    const tub = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(beam * 0.42, beam * 0.42, depth * 0.32, 10, 1, true),
        mats.panel
      )
    )
    tub.position.set(0, deckAt(tubF) + depth * 0.16, zAt(tubF))
    const mount = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(beam * 0.16, beam * 0.2, depth * 0.3, 8),
        mats.nacelle
      )
    )
    mount.position.set(0, deckAt(tubF) + depth * 0.28, zAt(tubF))
    // Ammo lockers along the deck.
    for (let i = 0; i < 3; i++) {
      for (const sx of [-1, 1]) {
        const locker = add(
          new THREE.Mesh(
            new THREE.BoxGeometry(beam * 0.16, depth * 0.22, length * 0.06),
            mats.hardpoint
          )
        )
        locker.position.set(
          sx * halfBeamAt(0.55) * 0.62,
          deckAt(0.55) * 0.96 + depth * 0.11,
          zAt(0.5 + i * 0.07)
        )
      }
    }
    // Splinter plating around the house.
    const splinterPlate = add(
      new THREE.Mesh(new THREE.BoxGeometry(houseW * 2.3, depth * 0.4, houseL * 1.25), mats.panel)
    )
    splinterPlate.position.set(0, houseDeck + depth * 0.2, houseZ)
  }

  // —— Explorer gear ————————————————————————————————————————————————
  if (role === 'explorer') {
    // Davits with a boat slung between them.
    for (const sx of [-1, 1]) {
      for (const dz of [-0.05, 0.07]) {
        const davit = add(
          new THREE.Mesh(
            new THREE.CylinderGeometry(beam * 0.02, beam * 0.025, depth * 0.7, 5),
            mats.antenna
          )
        )
        davit.position.set(sx * halfBeamAt(0.35) * 0.95, deckAt(0.35) + depth * 0.35, zAt(0.35 + dz))
        davit.rotation.z = sx * 0.25
      }
      const tender = add(
        new THREE.Mesh(new THREE.BoxGeometry(beam * 0.16, depth * 0.2, length * 0.11), mats.panel)
      )
      tender.position.set(sx * halfBeamAt(0.35) * 1.05, deckAt(0.35) + depth * 0.42, zAt(0.36))
    }
    // Survey winch on the afterdeck.
    const winch = add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(beam * 0.11, beam * 0.11, beam * 0.26, 10),
        mats.nacelle
      )
    )
    winch.rotation.z = Math.PI / 2
    winch.position.set(0, deckAt(0.12) + beam * 0.11, zAt(0.12))
  }

  // —— Salvage gear ————————————————————————————————————————————————
  if (role === 'miner') {
    // A-frame over the transom — the whole point of a salvage boat.
    for (const sx of [-1, 1]) {
      const leg = add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(beam * 0.045, beam * 0.055, depth * 1.5, 6),
          mats.structure
        )
      )
      leg.position.set(sx * halfBeamAt(0.1) * 0.8, deckAt(0.1) + depth * 0.75, zAt(0.1))
      leg.rotation.z = sx * 0.2
      leg.rotation.x = -0.16
    }
    const head = add(
      new THREE.Mesh(new THREE.BoxGeometry(beam * 1.3, beam * 0.07, beam * 0.09), mats.structure)
    )
    head.position.set(0, deckAt(0.1) + depth * 1.5, zAt(0.07))
    // Dive platform off the transom.
    const platform = add(
      new THREE.Mesh(
        new THREE.BoxGeometry(halfBeamAt(0.05) * 1.5, depth * 0.06, length * 0.07),
        mats.panel
      )
    )
    platform.position.set(0, deckAt(0.05) * 0.35, zAt(-0.01))
    // Spoil bins amidships.
    for (const sx of [-1, 1]) {
      const bin = add(
        new THREE.Mesh(
          new THREE.BoxGeometry(halfBeamAt(0.4) * 0.5, depth * 0.4, length * 0.16),
          mats.radiator
        )
      )
      bin.position.set(sx * halfBeamAt(0.4) * 0.5, deckAt(0.4) * 0.96 + depth * 0.2, zAt(0.4))
    }

    // Deck crane — the thing that actually makes it a salvage boat. Slewing
    // pedestal, lattice jib out over the working deck, hook on its fall.
    {
      const cf = 0.55
      const base = deckAt(cf) * 0.96
      const pedestal = add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(beam * 0.13, beam * 0.17, depth * 0.55, 10),
          mats.structure
        )
      )
      pedestal.position.set(0, base + depth * 0.28, zAt(cf))

      const house = add(
        new THREE.Mesh(
          new THREE.BoxGeometry(beam * 0.34, depth * 0.42, length * 0.07),
          mats.nacelle
        )
      )
      house.position.set(0, base + depth * 0.72, zAt(cf))

      // Jib, raked up and out over the transom where the work happens.
      const jibLen = length * 0.4
      const jib = add(
        new THREE.Mesh(new THREE.BoxGeometry(beam * 0.1, beam * 0.1, jibLen), mats.accent)
      )
      jib.position.set(0, base + depth * 1.05, zAt(cf) - jibLen * 0.38)
      jib.rotation.x = 0.34
      // Lattice bracing, so it does not read as one solid bar.
      for (let i = 0; i < 5; i++) {
        const brace = add(
          new THREE.Mesh(
            new THREE.BoxGeometry(beam * 0.16, beam * 0.03, beam * 0.03),
            mats.antenna
          )
        )
        const t = (i / 4 - 0.5) * jibLen * 0.8
        brace.position.set(0, base + depth * 1.05 + t * 0.34, zAt(cf) - jibLen * 0.38 - t)
        brace.rotation.x = 0.34
      }
      // Fall and hook block hanging over the after deck.
      const tipZ = zAt(cf) - jibLen * 0.86
      const tipY = base + depth * 1.05 + jibLen * 0.32
      const fall = add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(beam * 0.012, beam * 0.012, depth * 1.1, 4),
          mats.antenna
        )
      )
      fall.position.set(0, tipY - depth * 0.55, tipZ)
      const hook = add(
        new THREE.Mesh(new THREE.BoxGeometry(beam * 0.11, depth * 0.16, beam * 0.11), mats.hardpoint)
      )
      hook.position.set(0, tipY - depth * 1.1, tipZ)
    }

    // Dive compressor and gas racks against the house.
    for (let i = 0; i < 4; i++) {
      const bottle = add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(beam * 0.05, beam * 0.05, depth * 0.45, 8),
          i % 2 === 0 ? mats.accent : mats.nacelle
        )
      )
      bottle.position.set(
        (i - 1.5) * beam * 0.13,
        deckAt(0.3) * 0.96 + depth * 0.22,
        zAt(0.3)
      )
    }
  }
}

/**
 * The cheapest superstructure that still reads as a boat: a wheelhouse, a roof,
 * a stack and a mast. Four meshes, no per-station work, no railings — used for
 * NPC contacts where the full `addHullDetails` pass is too expensive to run a
 * dozen times on one frame.
 */
function addLiteSuperstructure(group, hull, mats) {
  const { length, stationWidths, stationHeights } = hull
  const beam = Math.max(...stationWidths)
  const depth = Math.max(...stationHeights)
  const mid = Math.round(stationWidths.length * 0.35)
  const deck = stationHeights[mid] + (hull.stationOffsetsY?.[mid] ?? 0)
  const z = -length / 2 + length * 0.35

  const houseH = depth * 1.05
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(stationWidths[mid] * 2.1, houseH, length * 0.13),
    mats.structure
  )
  house.position.set(0, deck + houseH * 0.5, z)
  house.castShadow = true
  group.add(house)

  const win = new THREE.Mesh(
    new THREE.BoxGeometry(stationWidths[mid] * 2.0, houseH * 0.3, length * 0.012),
    mats.window
  )
  win.position.set(0, deck + houseH * 0.72, z + length * 0.066)
  group.add(win)

  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(depth * 0.16, depth * 0.19, depth * 0.85, 8),
    mats.nacelle
  )
  funnel.position.set(0, deck + depth * 0.42, z - length * 0.1)
  funnel.castShadow = true
  group.add(funnel)

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(beam * 0.025, beam * 0.03, depth * 1.8, 5),
    mats.antenna
  )
  mast.position.set(0, deck + houseH + depth * 0.9, z + length * 0.05)
  group.add(mast)
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
/**
 * The gun mount.
 *
 * Every vessel carries one, on the centreline forward of the house. It is a
 * two-part gimbal so the barrel can be laid independently of the hull:
 *
 *   `yawGroup`   trains left and right, relative to the hull
 *   `pitchGroup` elevates, nested inside the yaw group so it inherits bearing
 *
 * Both are exposed through `group.userData.turret` for render/sceneSync.js to
 * drive each frame. The geometry is built from the same `turretMountLocal`
 * numbers game/turret.js fires from, so the shells leave the barrel you can
 * see rather than the middle of the boat.
 */
function addTurret(group, shipClass, mats) {
  const mount = turretMountLocal(shipClass)

  const yawGroup = new THREE.Group()
  yawGroup.position.set(mount.x, mount.y, mount.z)
  group.add(yawGroup)

  // Barbette: the fixed ring the mount sits in.
  const ringR = Math.max(0.32, mount.height * 0.85)
  const barbette = new THREE.Mesh(
    new THREE.CylinderGeometry(ringR * 1.12, ringR * 1.22, mount.height * 0.32, 12),
    mats.structure
  )
  barbette.position.y = mount.height * 0.16
  barbette.castShadow = true
  yawGroup.add(barbette)

  // Gunhouse: a squat shield, flat-backed so the bearing is readable at a
  // glance from the chase camera.
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(ringR * 1.9, mount.height * 0.78, ringR * 2.1),
    mats.panel
  )
  house.position.y = mount.height * 0.62
  house.castShadow = true
  yawGroup.add(house)

  const pitchGroup = new THREE.Group()
  pitchGroup.position.y = mount.height
  yawGroup.add(pitchGroup)

  // Barrel along +Z, so elevating is a rotation about local X.
  const barrelR = Math.max(0.055, mount.barrel * 0.045)
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(barrelR * 0.82, barrelR, mount.barrel, 8),
    mats.hardpoint
  )
  barrel.rotation.x = Math.PI / 2
  barrel.position.z = mount.barrel * 0.5
  barrel.castShadow = true
  pitchGroup.add(barrel)

  // Muzzle brake — reads as a gun rather than a pipe.
  const brake = new THREE.Mesh(
    new THREE.CylinderGeometry(barrelR * 1.5, barrelR * 1.5, mount.barrel * 0.1, 8),
    mats.hardpoint
  )
  brake.rotation.x = Math.PI / 2
  brake.position.z = mount.barrel * 0.94
  pitchGroup.add(brake)

  // Recoil cradle, so the barrel has something to pivot in.
  const cradle = new THREE.Mesh(
    new THREE.BoxGeometry(barrelR * 4.2, barrelR * 3.4, mount.barrel * 0.3),
    mats.structure
  )
  cradle.position.z = mount.barrel * 0.12
  pitchGroup.add(cradle)

  group.userData.turret = { yawGroup, pitchGroup }
  return group.userData.turret
}

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
      // Shared superstructure first, then the salvage rig on top of it.
      addHullDetails(group, shipClass.hull, mats, 'miner')
      addMinerDetails(group, shipClass.hull, mats)
    } else addHullDetails(group, shipClass.hull, mats, shipClass.role ?? 'trader')
  } else {
    // Lite NPCs skip the full superstructure — it is the main cost when a dozen
    // contacts mesh on one combat frame — but a bare lofted hull reads as a
    // floating tube. A wheelhouse and a mast are four meshes and buy back most
    // of the silhouette.
    addLiteSuperstructure(group, shipClass.hull, mats)
    if (isAlien) {
      // Lite Drowned hulls still get a glow node so they read as not-ours.
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
  }

  for (const hp of shipClass.hardpoints ?? []) {
    const marker = new THREE.Mesh(hardpointMarkerGeometry, mats.hardpoint)
    marker.position.set(...hp.position)
    marker.rotation.x = Math.PI / 2
    group.add(marker)
  }

  // Every vessel carries a gun mount, lite NPCs included — it is four meshes
  // and it is the thing the player is aiming at and being shot by.
  addTurret(group, shipClass, mats)

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
