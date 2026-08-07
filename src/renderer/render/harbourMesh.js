import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mulberry32, range, intRange, pick } from '../procgen/prng.js'
import {
  getStationTextures,
  STATION_NORMAL_STRENGTH,
  retileUVsTriplanar,
  applySoftTriplanar,
  cloneStationMaps,
  getAlgaeAlbedoMap
} from './textures.js'
import {
  getCorrugatedMaps,
  getPlankMaps,
  getGrowthMaps,
  getRustStreakMap,
  getSoftDiscMap,
  getNetMap,
  getTarpNormalMap,
  catenaryMesh,
  ropeCoilMesh,
  contactShadow,
  mergeStatic
} from './harbourDetail.js'
import { remoteness } from '../procgen/world.js'
import { SEA_MAX_AMPLITUDE } from '../world/sea.js'

/**
 * Harbours and outposts.
 *
 * Built procedurally rather than from a model kit: a working harbour is a
 * handful of shapes repeated with intent — deck on piles, warehouses, tanks,
 * a crane, a breakwater, mooring posts, lights — and generating them means
 * every port on the sea is laid out differently without shipping 18 MB of
 * assets that were modelled for orbit.
 *
 * Everything is authored with the **waterline at y = 0** and the deck above it,
 * so these can be dropped straight at sea level (unlike the old orbital modules,
 * which needed lifting; see main.js `floatOnWaterline`).
 *
 * Surfaces mix soft-blended triplanar PBR station maps with procedural
 * waterfront detail (planks, corrugated cladding, barnacles, rust streaks)
 * from harbourDetail.js. Major slabs are slightly rounded so silhouettes read
 * as worn concrete/steel rather than plastic cubes.
 */

/** Deck height above the waterline. Clear of the swell, boardable from a boat. */
const DECK_HEIGHT = SEA_MAX_AMPLITUDE + 3.5
/** How far the piles run below the surface. */
const PILE_DEPTH = SEA_MAX_AMPLITUDE + 9
/** Barnacle / weed crust thickness straddling the waterline. */
const TIDE_BAND_H = Math.max(1.35, SEA_MAX_AMPLITUDE * 0.85)

/**
 * Register a lamp as an area-light *emitter* (no THREE.PointLight child).
 * The fixed pool in areaLightPool.js binds real lights each frame so adding a
 * harbour never changes NUM_POINT_LIGHTS (that recompile freezes the title).
 *
 * @param {THREE.Object3D} group harbour root
 * @param {'quay'|'beacon'|'tower'|'mole'} tier
 */
function registerAreaEmitter(group, x, y, z, tier = 'quay') {
  const specs = {
    quay: { color: 0xffc078, base: 9000, distance: 42, priority: 3 },
    beacon: { color: 0xffb257, base: 6500, distance: 38, priority: 4 },
    tower: { color: 0xffd9a0, base: 14000, distance: 70, priority: 6 },
    mole: { color: 0xffc078, base: 7500, distance: 40, priority: 3 }
  }
  const s = specs[tier] ?? specs.quay
  if (!group.userData.areaEmitters) group.userData.areaEmitters = []
  group.userData.areaEmitters.push({
    x,
    y,
    z,
    color: s.color,
    base: s.base,
    distance: s.distance,
    priority: s.priority,
    tier
  })
}

function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Soft-edged slab — corners blend into the lighting instead of knife edges. */
function roundedBox(w, h, d, radius = 0.12, segments = 2) {
  const r = Math.min(radius, w * 0.2, h * 0.2, d * 0.2)
  return new RoundedBoxGeometry(w, h, d, segments, Math.max(0.02, r))
}

/** Structural member between local points — used for timber frames and crane trusses. */
function addBeamBetween(group, material, from, to, radius = 0.14) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const delta = b.clone().sub(a)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), material)
  beam.position.copy(a).add(b).multiplyScalar(0.5)
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
  beam.castShadow = true
  beam.receiveShadow = true
  group.add(beam)
  return beam
}

/**
 * Textured PBR material with soft triplanar sampling so edges don't seam.
 * @param {string} role station texture role
 * @param {object} props MeshStandardMaterial props (color, roughness, …)
 * @param {{ scale?: number, sharpness?: number, offset?: boolean, rng?: () => number }} [tri]
 */
function texturedMat(role, props, tri = {}) {
  const base = getStationTextures(role) ?? {}
  const maps =
    tri.offset && tri.rng
      ? cloneStationMaps(base, {
          offsetU: tri.rng() * 4,
          offsetV: tri.rng() * 4,
          rot: tri.rng() * Math.PI * 0.15
        })
      : base
  // Strip undefined keys before Material() so three does not warn.
  const clean = {}
  for (const [k, v] of Object.entries(maps)) {
    if (v != null) clean[k] = v
  }
  const mat = new THREE.MeshStandardMaterial({
    ...clean,
    ...props,
    normalScale:
      props.normalScale ??
      new THREE.Vector2(STATION_NORMAL_STRENGTH * 0.75, STATION_NORMAL_STRENGTH * 0.75)
  })
  if (clean.map || clean.roughnessMap || clean.metalnessMap) {
    applySoftTriplanar(mat, {
      scale: tri.scale ?? 0.2,
      sharpness: tri.sharpness ?? 4.2,
      key: `harbour|${role}|${tri.scale ?? 0.2}`
    })
  }
  return mat
}

/**
 * Material from procedural harbourDetail maps (planks / cladding / growth).
 * Falls back to a solid material when canvas is unavailable (Node tests).
 * Optional `uvRepeat` clones maps so shared cache textures keep their defaults.
 */
function detailMat(maps, props, tri = null, uvRepeat = null) {
  const clean = {}
  if (maps) {
    for (const [k, v] of Object.entries(maps)) {
      if (v == null) continue
      if (uvRepeat && v.isTexture) {
        const c = v.clone()
        c.wrapS = v.wrapS
        c.wrapT = v.wrapT
        c.repeat.set(uvRepeat[0], uvRepeat[1])
        c.needsUpdate = true
        clean[k] = c
      } else {
        clean[k] = v
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({
    ...clean,
    ...props,
    normalScale: props.normalScale ?? new THREE.Vector2(1.25, 1.25)
  })
  if (tri && (clean.map || clean.roughnessMap || clean.normalMap)) {
    applySoftTriplanar(mat, tri)
  }
  return mat
}

function materials(rng, weathered) {
  // Further out, everything is more rust than paint.
  const rust = new THREE.Color(0x6d4a33).lerp(new THREE.Color(0x8a5a38), rng())
  const plate = new THREE.Color(0x8a8680).lerp(rust, weathered * 0.5)
  // Warm weathered timber — plank maps carry groove/nail grain; tint ages them.
  // Slightly cooler/darker so damp edge patches in the map read as wet wood.
  const timberTone = new THREE.Color(0x8f7760).lerp(new THREE.Color(0x524232), weathered * 0.55)
  // Near-black wet timber — piles must go darker than dry upper legs or the
  // jetty reads as toothpicks stuck in a blue sheet.
  const wetPile = new THREE.Color(0x14120f).lerp(rust, weathered * 0.18)
  const soakPile = new THREE.Color(0x0a0908).lerp(new THREE.Color(0x1e1812), weathered * 0.28)
  const plank = getPlankMaps()
  const corrugated = getCorrugatedMaps()
  const growth = getGrowthMaps()
  const disc = getSoftDiscMap()
  const rustStreak = getRustStreakMap()
  const tarpN = getTarpNormalMap()
  const netMap = getNetMap()

  return {
    // Quay deck: procedural planks (grooves, nails, damp patches) — the single
    // biggest step from "one slab" to a worked waterfront. Slightly wetter
    // clearcoat-ish env so deck near the waterline does not read bone-dry.
    deck: detailMat(
      plank,
      {
        color: timberTone,
        roughness: 0.78 + weathered * 0.1,
        metalness: 0.03,
        envMapIntensity: 0.28,
        normalScale: new THREE.Vector2(1.55, 1.55)
      },
      plank.map ? { scale: 0.22, sharpness: 5.5, key: 'harbour|planks' } : null
    ),
    // Sheet / tank / roof steel — photo set + roughness variance so it is not
    // one plastic chrome value across every tank.
    plate: texturedMat(
      'hull',
      {
        color: plate,
        roughness: 0.62 + weathered * 0.22,
        metalness: 0.62 - weathered * 0.18,
        envMapIntensity: 0.55 - weathered * 0.15,
        normalScale: new THREE.Vector2(1.35, 1.35)
      },
      { scale: 0.16, sharpness: 4.5, offset: true, rng }
    ),
    // Warehouse walls — corrugated cladding with sheet overlaps and rust bloom.
    wall: detailMat(
      corrugated,
      {
        color: new THREE.Color(0xd2c4a8).lerp(rust, weathered * 0.38),
        roughness: 0.72 + weathered * 0.16,
        metalness: 0.28 - weathered * 0.1,
        envMapIntensity: 0.35,
        normalScale: new THREE.Vector2(1.55, 1.55)
      },
      // No triplanar here. Corrugated is *directional* — blending the same rib
      // pattern across three axes crosses the ribs with themselves and the wall
      // reads as a giant diamond quilt. Cladding gets a single per-face
      // projection (retileUVsTriplanar on the geometry) instead.
      null
    ),
    // Fallback chalky panel when canvas maps are missing (tests).
    wallFlat: texturedMat(
      'panel',
      {
        color: new THREE.Color(0xc8b79e).lerp(rust, weathered * 0.32),
        roughness: 0.86,
        metalness: 0.22,
        normalScale: new THREE.Vector2(1.2, 1.2)
      },
      { scale: 0.2, sharpness: 4.8, offset: true, rng }
    ),
    // Piles, crane legs, beams — dark structural steel.
    beam: texturedMat(
      'beam',
      {
        color: new THREE.Color(0x4a4640).lerp(rust, weathered * 0.55),
        roughness: 0.78 + weathered * 0.12,
        metalness: 0.52,
        envMapIntensity: 0.28
      },
      { scale: 0.28, sharpness: 3.8 }
    ),
    // Wet lower piles / rust crust — dark and slightly shiny so submerged
    // timber separates hard from dry upper legs and the open sea.
    pileWet: texturedMat(
      'beam',
      {
        color: wetPile,
        roughness: 0.38,
        metalness: 0.18,
        envMapIntensity: 0.62,
        normalScale: new THREE.Vector2(1.25, 1.25)
      },
      { scale: 0.32, sharpness: 3.5 }
    ),
    // Permanent soak ring just below mean water — darkest band on the pile.
    pileSoak: texturedMat(
      'beam',
      {
        color: soakPile,
        roughness: 0.32,
        metalness: 0.2,
        envMapIntensity: 0.7,
        normalScale: new THREE.Vector2(1.15, 1.15)
      },
      { scale: 0.4, sharpness: 3.2 }
    ),
    // Barnacle + weed crust for the intertidal band on piles and poles.
    // Kept chalky-light so the collar still reads at berth camera distance
    // against dark wet timber. UV repeat densifies shells around the pile.
    growth: detailMat(
      growth,
      {
        // Darker olive barnacle band — chalky-white collars floated the piles
        // against blue water at berth range.
        color: new THREE.Color(0x9a9278).lerp(new THREE.Color(0x4a5a32), weathered * 0.5),
        roughness: 0.92,
        metalness: 0.02,
        envMapIntensity: 0.1,
        normalScale: new THREE.Vector2(2.2, 2.2)
      },
      // UV on cylinders aligns V with height — skip triplanar so the crust wraps.
      null,
      growth.map ? [2.4, 1.4] : null
    ),
    rust: texturedMat(
      'hull',
      {
        color: rust,
        roughness: 0.94 + weathered * 0.04,
        metalness: 0.22,
        envMapIntensity: 0.2,
        normalScale: new THREE.Vector2(1.0, 1.0)
      },
      { scale: 0.24, sharpness: 3.6 }
    ),
    // Breakwater rock — coarser tile, softer blend for lumpy stone.
    rubble: texturedMat(
      'rubble',
      {
        color: new THREE.Color(0x625d55).lerp(rust, weathered * 0.24),
        roughness: 1,
        metalness: 0.04,
        normalScale: new THREE.Vector2(1.85, 1.85)
      },
      { scale: 0.12, sharpness: 2.8 }
    ),
    rubbleWet: texturedMat(
      'rubble',
      {
        color: new THREE.Color(0x39453e).lerp(rust, weathered * 0.16),
        roughness: 0.82,
        metalness: 0.02,
        envMapIntensity: 0.22,
        normalScale: new THREE.Vector2(2.05, 2.05)
      },
      { scale: 0.14, sharpness: 2.6 }
    ),
    seaweed: new THREE.MeshStandardMaterial({
      map: getAlgaeAlbedoMap() ?? null,
      color: 0x3f5b32,
      roughness: 1,
      metalness: 0,
      alphaTest: 0.02,
      side: THREE.DoubleSide
    }),
    accent: texturedMat(
      'accent',
      {
        color: pick(rng, [0xc4531c, 0xc9a227, 0x2f6f8f, 0xb03a2e]),
        roughness: 0.52 + weathered * 0.2,
        metalness: 0.32,
        envMapIntensity: 0.4
      },
      { scale: 0.22, sharpness: 5 }
    ),
    rope: new THREE.MeshStandardMaterial({
      color: new THREE.Color(0x8a7348).lerp(new THREE.Color(0x5a4a32), weathered * 0.4),
      roughness: 0.95,
      metalness: 0.02
    }),
    tarp: new THREE.MeshStandardMaterial({
      color: pick(rng, [0x3a5a48, 0x5a4838, 0x3a4a5a, 0x6a3a2a]),
      roughness: 0.9,
      metalness: 0.04,
      normalMap: tarpN ?? null,
      normalScale: new THREE.Vector2(0.9, 0.9),
      side: THREE.DoubleSide
    }),
    net: new THREE.MeshStandardMaterial({
      map: netMap ?? null,
      color: 0x6f6350,
      roughness: 0.95,
      metalness: 0.02,
      transparent: !!netMap,
      alphaTest: netMap ? 0.35 : 0,
      side: THREE.DoubleSide,
      depthWrite: true
    }),
    // Transparent vertical rust weep hung under fixings / tank bands.
    rustStreak: new THREE.MeshBasicMaterial({
      map: rustStreak ?? null,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide
    }),
    // Contact shadow disc — stops crates reading as pasted onto the deck.
    // Stronger opacity: weak blobs were the "floating prop" tell at berth cam.
    blobShadow: new THREE.MeshBasicMaterial({
      map: disc ?? null,
      color: 0x050403,
      transparent: true,
      opacity: disc ? 0.72 : 0.48,
      depthWrite: false
    }),
    // Warm pool under lamps — reads hard at night, soft amber kiss by day.
    lightPool: new THREE.MeshBasicMaterial({
      map: disc ?? null,
      color: 0xffc078,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xffd9a0,
      emissive: 0xffb257,
      emissiveIntensity: 1.6,
      roughness: 0.4
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x2a3a3e,
      emissive: 0xffc27a,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.1
    })
  }
}

/** A deck slab on piles, with fenders down the working edge. */
function addJetty(group, mats, rng, { x, z, w, l, rot = 0 }) {
  const jetty = new THREE.Group()
  jetty.position.set(x, 0, z)
  jetty.rotation.y = rot

  // Slightly rounded deck — soft lip reads as worn concrete/timber, not a cube.
  const deck = new THREE.Mesh(roundedBox(w, 0.75, l, 0.14, 2), mats.deck)
  deck.position.y = DECK_HEIGHT
  deck.castShadow = true
  deck.receiveShadow = true
  jetty.add(deck)

  // Thin edge plank / kerb so the silhouette isn't a single slab.
  const kerb = new THREE.Mesh(
    roundedBox(w + 0.18, 0.22, l + 0.18, 0.06, 1),
    mats.beam
  )
  kerb.position.y = DECK_HEIGHT - 0.28
  kerb.castShadow = true
  kerb.receiveShadow = true
  jetty.add(kerb)

  // Piles. Tighter spacing (was ~7 m) so the quay does not read as a table on
  // four toothpicks. Split into wet / permanent soak / tide crust / dry upper
  // so the waterline reads as lived-in marine surface rather than one painted pole.
  const rows = Math.max(3, Math.round(l / 5.2))
  const cols = Math.max(3, Math.round(w / 5.2))
  const tideH = TIDE_BAND_H
  const bollards = []
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const px = -w / 2 + (j + 0.5) * (w / cols)
      const pz = -l / 2 + (i + 0.5) * (l / rows)
      // Wet section bottoms out below the deepest trough; soak band straddles
      // mean water and climbs high enough that a crest still leaves a dark
      // wet collar on the pile (the COD waterline tell).
      const soakTop = tideH * 0.55
      const soakBot = -tideH * 1.15
      const wetTop = soakBot
      const wetBot = -PILE_DEPTH
      const wetH = Math.max(0.8, wetTop - wetBot)
      // Fatter legs — thin cylinders were the low-poly pier tell at range.
      const wet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.62, 0.78, wetH, 8),
        mats.pileWet
      )
      wet.position.set(px, wetBot + wetH / 2, pz)
      wet.castShadow = true
      wet.receiveShadow = true
      jetty.add(wet)

      // Permanent dark soak ring — fat, near-black, proud of the pile so it
      // silhouettes against the sea at berth camera distance.
      const soakH = Math.max(0.9, soakTop - soakBot)
      const soak = new THREE.Mesh(
        new THREE.CylinderGeometry(0.8, 0.9, soakH, 10),
        mats.pileSoak
      )
      soak.position.set(px, soakBot + soakH / 2, pz)
      soak.castShadow = true
      soak.receiveShadow = true
      jetty.add(soak)

      // Barnacle/weed collar at the intertidal — olive, fatter than the soak.
      const growthMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.88, 0.98, tideH * 1.05, 12),
        mats.growth
      )
      growthMesh.position.set(px, tideH * 0.28, pz)
      growthMesh.castShadow = true
      growthMesh.receiveShadow = true
      jetty.add(growthMesh)

      const dryBot = tideH * 0.7
      const dryH = Math.max(0.6, DECK_HEIGHT - 0.2 - dryBot)
      const dry = new THREE.Mesh(
        new THREE.CylinderGeometry(0.54, 0.6, dryH, 8),
        mats.beam
      )
      dry.position.set(px, dryBot + dryH / 2, pz)
      dry.castShadow = true
      dry.receiveShadow = true
      jetty.add(dry)
      // Note: no fixed-Y water discs under piles — ocean is opaque and waves
      // ±SEA_MAX_AMPLITUDE, so a y≈0 quad is buried or floating. Grounding
      // comes from the dark soak ring + growth collar geometry above.
    }
  }

  // Horizontal cross-braces between piles near the waterline. Sparse toothpicks
  // alone read as a floating table; a few wales plant the structure.
  // Deterministic pattern only — do NOT pull from `rng` here or the rest of the
  // harbour layout (fingers, sheds, tanks) desyncs from its seed.
  for (let i = 0; i < rows; i++) {
    const z = -l / 2 + (i + 0.5) * (l / rows)
    for (let j = 0; j < cols - 1; j++) {
      if ((i + j) % 2 !== 0) continue
      const x0 = -w / 2 + (j + 0.5) * (w / cols)
      const x1 = -w / 2 + (j + 1.5) * (w / cols)
      const y = ((i * 3 + j * 5) % 7) * 0.18 - 0.4
      addBeamBetween(jetty, mats.pileSoak ?? mats.beam, [x0, y, z], [x1, y, z], 0.11)
    }
  }
  for (let j = 0; j < cols; j++) {
    const x = -w / 2 + (j + 0.5) * (w / cols)
    for (let i = 0; i < rows - 1; i++) {
      if ((i + j) % 2 === 0) continue
      const z0 = -l / 2 + (i + 0.5) * (l / rows)
      const z1 = -l / 2 + (i + 1.5) * (l / rows)
      const y = ((i * 5 + j * 2) % 7) * 0.2 - 0.25
      addBeamBetween(jetty, mats.beam, [x, y, z0], [x, y, z1], 0.1)
    }
  }

  // Fenders and bollards down both long edges — this is where boats come in.
  const fenderCount = Math.max(2, Math.round(l / 9))
  for (let i = 0; i < fenderCount; i++) {
    const fz = -l / 2 + (i + 0.5) * (l / fenderCount)
    for (const sx of [-1, 1]) {
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.28, 6, 10), mats.rust)
      tyre.position.set(sx * (w / 2 + 0.2), DECK_HEIGHT - 1.1, fz)
      tyre.rotation.y = Math.PI / 2
      jetty.add(tyre)
      if (i % 2 === 0) {
        const bx = sx * (w / 2 - 0.9)
        const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.1, 8), mats.beam)
        bollard.position.set(bx, DECK_HEIGHT + 0.9, fz)
        bollard.castShadow = true
        jetty.add(bollard)
        // Contact disc so the bollard is grounded on the planks.
        jetty.add(contactShadow(mats.blobShadow, 1.45, bx, DECK_HEIGHT + 0.42, fz))
        bollards.push([bx, DECK_HEIGHT + 1.35, fz])
        // Short drooping mooring line to the fender post / water side.
        if (rng() < 0.55) {
          const line = catenaryMesh(
            [bx, DECK_HEIGHT + 1.2, fz],
            [sx * (w / 2 + 0.55), DECK_HEIGHT - 0.4, fz + range(rng, -0.4, 0.4)],
            range(rng, 0.45, 1.1),
            0.045,
            mats.rope,
            10
          )
          jetty.add(line)
        }
      }
    }
  }

  // Occasional rope coil on the deck — working harbour clutter, not ornament.
  if (bollards.length && rng() < 0.7) {
    const [bx, , bz] = bollards[Math.floor(rng() * bollards.length)]
    const coil = ropeCoilMesh(range(rng, 0.35, 0.55), mats.rope, intRange(rng, 2, 4))
    coil.position.set(bx + range(rng, -0.6, 0.6), DECK_HEIGHT + 0.4, bz + range(rng, 0.6, 1.4))
    jetty.add(coil)
    jetty.add(
      contactShadow(mats.blobShadow, 1.75, coil.position.x, DECK_HEIGHT + 0.41, coil.position.z)
    )
  }

  group.add(jetty)
  return jetty
}

/** A weathered gabled warehouse, with loading doors and exposed timber framing. */
function addShed(group, mats, rng, { x, z, w, d, h, rot = 0, lit = true }) {
  const shed = new THREE.Group()
  shed.position.set(x, DECK_HEIGHT + 0.35, z)
  shed.rotation.y = rot
  const roofH = Math.max(1.2, h * 0.32)
  const wallShape = new THREE.Shape()
  wallShape.moveTo(-w / 2, 0)
  wallShape.lineTo(w / 2, 0)
  wallShape.lineTo(w / 2, h)
  wallShape.lineTo(0, h + roofH)
  wallShape.lineTo(-w / 2, h)
  wallShape.lineTo(-w / 2, 0)
  const wallGeo = new THREE.ExtrudeGeometry(wallShape, {
    depth: d,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: Math.min(0.12, w * 0.025),
    bevelThickness: 0.08
  })
  wallGeo.translate(0, 0, -d / 2)
  // Prefer corrugated cladding; fall back to chalky panel maps in headless tests.
  const wallMat = mats.wall?.map ? mats.wall : mats.wallFlat
  // World-scale UVs, one projection per face: sheets stay ~1.6 m wide however
  // the shed was sized, and the ribs run vertically like real cladding.
  const body = new THREE.Mesh(retileUVsTriplanar(wallGeo, 0.62), wallMat)
  body.castShadow = true
  body.receiveShadow = true
  shed.add(body)

  // Contact shadow under the shed footprint.
  shed.add(contactShadow(mats.blobShadow, Math.max(w, d) * 1.35, 0, 0.02, 0))

  for (const sx of [-1, 1]) {
    const slope = new THREE.Mesh(roundedBox(w * 0.56, 0.22, d * 1.06, 0.05, 1), mats.plate)
    slope.position.set(sx * w * 0.25, h + roofH * 0.5, 0)
    slope.rotation.z = sx * -Math.atan2(roofH, w * 0.5)
    slope.castShadow = true
    slope.receiveShadow = true
    shed.add(slope)
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, d * 1.1, 8), mats.rust)
  ridge.rotation.x = Math.PI / 2
  ridge.position.y = h + roofH
  shed.add(ridge)

  const doorW = w * 0.36
  const doorH = h * 0.58
  const door = new THREE.Mesh(roundedBox(doorW, doorH, 0.16, 0.03, 1), mats.accent)
  door.position.set(0, doorH / 2, d / 2 + 0.08)
  shed.add(door)
  addBeamBetween(shed, mats.beam, [-doorW * 0.56, 0, d / 2 + 0.16], [-doorW * 0.56, h, d / 2 + 0.16], 0.11)
  addBeamBetween(shed, mats.beam, [doorW * 0.56, 0, d / 2 + 0.16], [doorW * 0.56, h, d / 2 + 0.16], 0.11)
  addBeamBetween(shed, mats.beam, [-w * 0.48, h, d / 2 + 0.16], [w * 0.48, h, d / 2 + 0.16], 0.11)

  // Rust weeps under the eaves and door lintel — oxide run-off from fixings.
  if (mats.rustStreak?.map) {
    const streaks = intRange(rng, 2, 5)
    for (let i = 0; i < streaks; i++) {
      const sw = range(rng, 0.18, 0.42)
      const sh = range(rng, h * 0.28, h * 0.7)
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), mats.rustStreak)
      const side = rng() < 0.55 ? 1 : -1
      if (side > 0) {
        streak.position.set(range(rng, -w * 0.4, w * 0.4), h - sh * 0.35, d / 2 + 0.12)
      } else {
        streak.position.set(range(rng, -w * 0.4, w * 0.4), h - sh * 0.4, -d / 2 - 0.12)
        streak.rotation.y = Math.PI
      }
      streak.renderOrder = 2
      shed.add(streak)
    }
  }

  if (lit) {
    const winCount = intRange(rng, 2, 4)
    for (let i = 0; i < winCount; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.12, h * 0.2, 0.15), mats.glass)
      win.position.set(-w * 0.3 + (i / Math.max(1, winCount - 1)) * w * 0.6, h * 0.7, d / 2 + 0.05)
      shed.add(win)
      // Small rust weep under each window sill.
      if (mats.rustStreak?.map && rng() < 0.7) {
        const weep = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.1, h * 0.22),
          mats.rustStreak
        )
        weep.position.set(win.position.x, win.position.y - h * 0.22, d / 2 + 0.13)
        weep.renderOrder = 2
        shed.add(weep)
      }
    }
  }
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, h * 0.32, 8), mats.beam)
  vent.position.set(w * range(rng, -0.22, 0.22), h + roofH + h * 0.16, -d * 0.18)
  shed.add(vent)
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.24, 8), mats.rust)
  cap.position.copy(vent.position)
  cap.position.y += h * 0.17
  shed.add(cap)
  const awning = new THREE.Mesh(roundedBox(doorW * 1.2, 0.13, d * 0.16, 0.03, 1), mats.plate)
  awning.position.set(0, h * 0.74, d * 0.58)
  awning.rotation.x = -0.16
  shed.add(awning)

  // Occasional tarp draped over a crate stack beside the door — breaks the
  // clean gable silhouette and sells "people work here".
  if (rng() < 0.55) {
    const tarp = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW * range(rng, 0.7, 1.1), d * range(rng, 0.22, 0.4)),
      mats.tarp
    )
    tarp.position.set(range(rng, -w * 0.15, w * 0.15), 0.35, d * 0.42)
    tarp.rotation.x = -Math.PI / 2 + range(rng, -0.12, 0.08)
    tarp.rotation.z = range(rng, -0.2, 0.2)
    tarp.castShadow = true
    shed.add(tarp)
  }

  group.add(shed)
  return shed
}

/** Fuel / water tanks — the most recognisable thing on any working waterfront. */
function addTanks(group, mats, rng, { x, z, count, r, h }) {
  for (let i = 0; i < count; i++) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), mats.plate)
    const tx = x + (i - (count - 1) / 2) * r * 2.4
    tank.position.set(tx, DECK_HEIGHT + h / 2, z)
    tank.castShadow = true
    tank.receiveShadow = true
    group.add(tank)
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, h * 0.06, 20), mats.rust)
    cap.position.set(tx, DECK_HEIGHT + h, z)
    group.add(cap)
    // Banding, so a plain cylinder reads as riveted plate.
    for (const f of [0.3, 0.65]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r * 1.02, r * 0.04, 5, 18), mats.beam)
      band.position.set(tx, DECK_HEIGHT + h * f, z)
      band.rotation.x = Math.PI / 2
      group.add(band)
    }
    // Ground the tank and paint oxide weeps down the shell from each band.
    group.add(contactShadow(mats.blobShadow, r * 3.1, tx, DECK_HEIGHT + 0.4, z))
    if (mats.rustStreak?.map) {
      const weeps = intRange(rng, 2, 4)
      for (let s = 0; s < weeps; s++) {
        const ang = rng() * Math.PI * 2
        const sh = h * range(rng, 0.35, 0.75)
        const streak = new THREE.Mesh(
          new THREE.PlaneGeometry(r * range(rng, 0.18, 0.35), sh),
          mats.rustStreak
        )
        streak.position.set(
          tx + Math.cos(ang) * (r + 0.04),
          DECK_HEIGHT + h * range(rng, 0.45, 0.85),
          z + Math.sin(ang) * (r + 0.04)
        )
        streak.lookAt(tx, streak.position.y, z)
        streak.rotateY(Math.PI)
        streak.renderOrder = 2
        group.add(streak)
      }
    }
  }
}

/** Gantry crane over the quay. */
function addCrane(group, mats, rng, { x, z, h, reach }) {
  const crane = new THREE.Group()
  crane.position.set(x, DECK_HEIGHT, z)
  crane.rotation.y = rng() * Math.PI * 2

  const half = 2.6
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) addBeamBetween(crane, mats.beam, [sx * half, 0, sz * half], [sx * half, h, sz * half], 0.24)
  }
  // Cross-braced portal: open lattice rather than a single solid black block.
  for (const sx of [-1, 1]) {
    addBeamBetween(crane, mats.beam, [sx * half, 0.3, -half], [sx * half, h * 0.72, half], 0.14)
    addBeamBetween(crane, mats.beam, [sx * half, 0.3, half], [sx * half, h * 0.72, -half], 0.14)
  }
  for (const sx of [-1, 1]) {
    const railX = sx * 0.54
    addBeamBetween(crane, mats.accent, [railX, h, -reach * 0.28], [railX, h, reach * 0.72], 0.18)
    addBeamBetween(crane, mats.beam, [railX, h + 0.78, -reach * 0.18], [railX, h + 0.78, reach * 0.68], 0.13)
    for (let i = 0; i < 5; i++) {
      const a = -reach * 0.18 + i * reach * 0.17
      addBeamBetween(crane, mats.beam, [railX, h, a], [railX, h + 0.78, a + reach * 0.17], 0.1)
      addBeamBetween(crane, mats.beam, [railX, h + 0.78, a], [railX, h, a + reach * 0.17], 0.1)
    }
  }
  const counterweight = new THREE.Mesh(roundedBox(2.2, 1.6, 2.4, 0.1, 1), mats.rust)
  counterweight.position.set(0, h, -reach * 0.22)
  crane.add(counterweight)
  // Hook block on its cable.
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, h * 0.55, 5), mats.beam)
  cable.position.set(0, h - h * 0.28, reach * 0.42)
  crane.add(cable)
  const hook = new THREE.Mesh(roundedBox(0.8, 0.8, 0.8, 0.06, 1), mats.beam)
  hook.position.set(0, h - h * 0.55, reach * 0.42)
  crane.add(hook)
  group.add(crane)
}

/** Octagonal harbour-control tower, visible from sea without reading as a monolith. */
function addHarbourTower(group, mats, { x, z, h, radius }) {
  const tower = new THREE.Group()
  tower.userData.lighthouse = true
  tower.position.set(x, DECK_HEIGHT, z)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.72, radius, h, 8), mats.wall)
  shaft.position.y = h / 2
  shaft.castShadow = true
  shaft.receiveShadow = true
  tower.add(shaft)
  const balcony = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.3, radius * 1.3, 0.22, 8), mats.beam)
  balcony.position.y = h * 0.86
  tower.add(balcony)
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, h * 0.2, 8), mats.glass)
  cab.position.y = h * 0.96
  cab.userData.lighthouseWindow = true
  tower.add(cab)
  const roof = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.28, h * 0.16, 8), mats.plate)
  roof.position.y = h * 1.14
  tower.add(roof)
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, h * 0.38, 6), mats.beam)
  antenna.position.y = h * 1.3
  tower.add(antenna)
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.16, 8, 6), mats.lamp)
  beacon.position.y = h * 1.5
  beacon.userData.beacon = true
  tower.add(beacon)
  // Tower top flood — brightest waterfront light (port landmark).
  // Emitter is in tower-local space; offerHarbourAreaLights transforms it.
  registerAreaEmitter(tower, 0, h * 1.5, 0, 'tower')
  group.add(tower)
}

/**
 * A rubble mole enclosing the anchorage — what makes it a harbour rather than a
 * pier. Tipped rock, not masonry: small, irregular, and mostly awash, so the
 * swell breaks over it instead of it standing up like a wall.
 */
function addBreakwater(group, mats, rng, radius) {
  const arc = range(rng, 1.4, 2.4)
  const start = rng() * Math.PI * 2
  const segs = Math.max(18, Math.round(arc * 22))
  const seaweedMatrices = []
  const seaweedDummy = new THREE.Object3D()
  // Render-local rock centres are copied into world-space collision data by
  // main.js after the harbour's scale and seaward rotation are applied.
  group.userData.breakwaterRocks = []
  // One subdivision plus a per-vertex wobble. A bare icosahedron has twenty
  // identical faces and reads as a cut gem; this gives the lumpy, weathered
  // silhouette of tipped stone for a handful more triangles. Built once and
  // shared — the per-block scale and rotation do the variety.
  let geo = new THREE.IcosahedronGeometry(1, 1)
  {
    const pos = geo.getAttribute('position')
    const v = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      // Hash off the direction so shared vertices always agree and the surface
      // stays closed.
      const h = Math.sin(v.x * 91.17 + v.y * 47.31 + v.z * 63.73) * 43758.5453
      v.multiplyScalar(0.86 + (h - Math.floor(h)) * 0.26)
      pos.setXYZ(i, v.x, v.y, v.z)
    }
    geo.computeVertexNormals()
    // Soft triplanar material samples in local position — UVs are fallback only.
    geo = retileUVsTriplanar(geo, 0.45)
  }
  for (let i = 0; i < segs; i++) {
    const a = start + (i / (segs - 1)) * arc
    // Two staggered rows so it reads as a tipped bank with width, not a line.
    for (const lane of [-1, 1]) {
      if (lane > 0 && rng() < 0.35) continue
      const r = radius * range(rng, 0.97, 1.03) + lane * radius * 0.035
      let s = range(rng, radius * 0.035, radius * 0.07)
      let sy = s * range(rng, 0.5, 0.95)
      // Position by the block's *underside*, not its centre. Placing the centre
      // near the waterline left the smaller blocks hanging clear of the water
      // with daylight under them — a mole is tipped rock resting on the bottom,
      // so every block has to run well below the surface whatever its size.
      const crest = range(rng, -1.2, 1.6) + SEA_MAX_AMPLITUDE * 0.5
      const wetRock = crest < 0.8 || rng() < 0.28
      const block = new THREE.Mesh(geo, wetRock ? mats.rubbleWet : mats.rubble)
      // Guarantee the bottom clears the deepest trough. Positioning by the
      // underside is not enough on its own — a small block with a high crest
      // still ends up hanging in the air.
      const needDepth = SEA_MAX_AMPLITUDE + 2
      const minSy = (crest + needDepth) * 0.5
      if (sy < minSy) {
        // Growing only the vertical axis turned the small blocks into shark
        // fins. Boulders are roughly as wide as they are tall, so take the
        // footprint up with the height.
        s = Math.max(s, minSy * 0.85)
        sy = minSy
      }
      block.position.set(
        Math.cos(a) * r + range(rng, -s, s) * 0.4,
        // Top of the block lands at the crest height; the rest of it goes down.
        crest - sy,
        Math.sin(a) * r + range(rng, -s, s) * 0.4
      )
      const horizontalScale = s * range(rng, 0.8, 1.25)
      block.scale.set(s, sy, horizontalScale)
      block.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
      block.castShadow = true
      block.receiveShadow = true
      group.add(block)
      group.userData.breakwaterRocks.push({
        x: block.position.x,
        z: block.position.z,
        radius: Math.max(s, horizontalScale) * 0.95
      })

      // Seaweed takes hold on the sheltered, damp sides of the mole. Keep it
      // as one instanced draw after placement so a little coastal life does
      // not turn every harbour into dozens of extra render calls.
      if (rng() < 0.72) {
        const outward = new THREE.Vector3(block.position.x, 0, block.position.z)
        if (outward.lengthSq() < 1e-4) outward.set(Math.cos(a), 0, Math.sin(a))
        else outward.normalize()
        const tangent = new THREE.Vector3(-outward.z, 0, outward.x)
        const blades = 1 + (rng() < 0.48 ? 1 : 0) + (rng() < 0.16 ? 1 : 0)
        for (let w = 0; w < blades; w++) {
          const h = range(rng, 1.1, 3.8)
          const sideOffset = range(rng, -s * 0.62, s * 0.62)
          const outOffset = range(rng, s * 0.62, s * 1.05)
          const baseY = range(rng, -1.65, 0.65)
          seaweedDummy.position.set(
            block.position.x + outward.x * outOffset + tangent.x * sideOffset,
            baseY + h * 0.5,
            block.position.z + outward.z * outOffset + tangent.z * sideOffset
          )
          seaweedDummy.rotation.set(
            range(rng, -0.24, 0.24),
            rng() * Math.PI * 2,
            range(rng, -0.28, 0.28)
          )
          const width = range(rng, 0.7, 1.25)
          seaweedDummy.scale.set(width, h, width)
          seaweedDummy.updateMatrix()
          seaweedMatrices.push(seaweedDummy.matrix.clone())
        }
      }
    }
  }
  if (seaweedMatrices.length) {
    const weed = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.16, 1, 5),
      mats.seaweed,
      seaweedMatrices.length
    )
    weed.name = 'tidal-seaweed'
    weed.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    for (let i = 0; i < seaweedMatrices.length; i++) weed.setMatrixAt(i, seaweedMatrices[i])
    weed.instanceMatrix.needsUpdate = true
    weed.castShadow = true
    weed.receiveShadow = true
    group.add(weed)
  }
  // Light on the head of the mole — pole planted through the waterline.
  const headA = start + arc
  const lampY = DECK_HEIGHT + 6.4
  const botY = -PILE_DEPTH * 0.5
  const postH = lampY - botY
  const postX = Math.cos(headA) * radius
  const postZ = Math.sin(headA) * radius
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.75, postH, 6), mats.plate)
  post.position.set(postX, (lampY + botY) / 2, postZ)
  post.castShadow = true
  post.receiveShadow = true
  group.add(post)
  if (mats.pileSoak) {
    const soak = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.72, TIDE_BAND_H * 0.9, 8),
      mats.pileSoak
    )
    soak.position.set(postX, 0, postZ)
    soak.castShadow = true
    group.add(soak)
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mats.lamp)
  lamp.position.set(postX, lampY, postZ)
  lamp.userData.beacon = true
  group.add(lamp)
  registerAreaEmitter(group, postX, lampY, postZ, 'mole')
}

/** Lamp posts planted in the water along the quay edge (not floating mid-air). */
function addQuayLights(group, mats, positions) {
  const lampY = DECK_HEIGHT + 5.85
  const botY = -PILE_DEPTH * 0.45
  const postH = lampY - botY
  for (const [x, z] of positions) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, postH, 5), mats.beam)
    post.position.set(x, (lampY + botY) / 2, z)
    post.castShadow = true
    post.receiveShadow = true
    group.add(post)
    // Dark soak + tide crust on the light pole so legs do not float mid-water.
    if (mats.pileSoak) {
      const soak = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, TIDE_BAND_H * 0.85, 8),
        mats.pileSoak
      )
      soak.position.set(x, -TIDE_BAND_H * 0.15, z)
      soak.castShadow = true
      group.add(soak)
    }
    // Tide crust on the light pole too.
    const growth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.34, TIDE_BAND_H, 8),
      mats.growth
    )
    growth.position.set(x, TIDE_BAND_H * 0.1, z)
    growth.castShadow = true
    group.add(growth)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.9), mats.plate)
    head.position.set(x, DECK_HEIGHT + 6.1, z)
    head.castShadow = true
    group.add(head)
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 7, 5), mats.lamp)
    lamp.position.set(x, lampY, z)
    group.add(lamp)
    // Soft light pool on the deck / water under the lamp.
    const pool = contactShadow(mats.lightPool, 7.5, x, DECK_HEIGHT + 0.4, z)
    pool.renderOrder = 3
    group.add(pool)
    // Real glow — warms deck timber and nearby hulls at night (pooled lights).
    registerAreaEmitter(group, x, lampY, z, 'quay')
  }
}

/**
 * Build a harbour or an outpost.
 *
 * Layout is seeded from the body id, so a given port always looks the same, and
 * scaled by kind: a port is a working waterfront with a mole around it, an
 * outpost is a jetty, a shed, and a light.
 */
export function buildHarbourMesh(body) {
  const rng = mulberry32(hashString(body.id))
  const isPort = body.kind === 'port'
  const weathered = Math.min(1, remoteness(body.position) * 1.1)
  const mats = materials(rng, weathered)
  const group = new THREE.Group()
  group.userData.kind = body.kind

  // Overall footprint. These are local units; main.js scales the group up.
  const size = isPort ? range(rng, 34, 52) : range(rng, 14, 22)

  // —— Main quay ——————————————————————————————————————————————————
  const quayW = size * range(rng, 0.5, 0.75)
  const quayL = size * range(rng, 0.75, 1.0)
  // Ambient pedestrians use the main quay as a small, deterministic walking
  // loop. Keep this metadata on the harbour so their feet follow its scale and
  // surface orientation without adding a second navigation system.
  group.userData.npcDeck = isPort
    ? { width: quayW, length: quayL, y: DECK_HEIGHT + 0.38 }
    : null
  addJetty(group, mats, rng, { x: 0, z: 0, w: quayW, l: quayL })

  // Finger jetties off the quay for boats to lie alongside.
  const fingers = isPort ? intRange(rng, 2, 4) : 1
  for (let i = 0; i < fingers; i++) {
    const side = i % 2 === 0 ? 1 : -1
    const fz = -quayL * 0.3 + (i / Math.max(1, fingers - 1)) * quayL * 0.6
    addJetty(group, mats, rng, {
      x: side * (quayW / 2 + size * 0.22),
      z: fz,
      w: size * range(rng, 0.32, 0.5),
      l: size * range(rng, 0.1, 0.16),
      rot: 0
    })
  }

  // —— Buildings ————————————————————————————————————————————————————
  const sheds = isPort ? intRange(rng, 2, 4) : 1
  for (let i = 0; i < sheds; i++) {
    addShed(group, mats, rng, {
      x: range(rng, -quayW * 0.28, quayW * 0.28),
      z: -quayL * 0.34 + (i / Math.max(1, sheds - 1)) * quayL * 0.56,
      w: size * range(rng, 0.2, 0.32),
      d: size * range(rng, 0.16, 0.26),
      h: size * range(rng, 0.12, 0.22),
      rot: range(rng, -0.1, 0.1),
      lit: rng() < 0.85
    })
  }

  // Harbourmaster's tower — the tallest thing here, and how you spot a port
  // from open water before anything else resolves.
  if (isPort) {
    addHarbourTower(group, mats, {
      x: quayW * 0.3,
      z: -quayL * 0.34,
      h: size * range(rng, 0.42, 0.56),
      radius: size * 0.09
    })
  }

  // —— Waterfront plant ——————————————————————————————————————————————
  if (isPort) {
    addTanks(group, mats, rng, {
      x: -quayW * 0.3,
      z: quayL * 0.3,
      count: intRange(rng, 2, 4),
      r: size * 0.06,
      h: size * range(rng, 0.14, 0.22)
    })
    addCrane(group, mats, rng, {
      x: quayW * range(rng, -0.2, 0.2),
      z: quayL * range(rng, 0.1, 0.3),
      h: size * range(rng, 0.28, 0.42),
      reach: size * range(rng, 0.3, 0.45)
    })
    if (rng() < 0.7) {
      addCrane(group, mats, rng, {
        x: quayW * range(rng, -0.3, 0.3),
        z: -quayL * range(rng, 0.1, 0.3),
        h: size * range(rng, 0.22, 0.34),
        reach: size * range(rng, 0.24, 0.36)
      })
    }
    addBreakwater(group, mats, rng, size * range(rng, 0.9, 1.15))
  }

  // Stacked crates and drums — the deck should look worked, not swept.
  const clutter = isPort ? intRange(rng, 8, 16) : intRange(rng, 3, 6)
  const crateGeo = roundedBox(1, 1, 1, 0.06, 1)
  const drumGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 10)
  for (let i = 0; i < clutter; i++) {
    const isDrum = rng() < 0.35
    const item = new THREE.Mesh(isDrum ? drumGeo : crateGeo, rng() < 0.3 ? mats.accent : mats.rust)
    const s = size * range(rng, 0.025, 0.055)
    const sy = s * range(rng, 0.8, 1.4)
    item.scale.set(s, sy, s)
    const ix = range(rng, -quayW * 0.42, quayW * 0.42)
    const iz = range(rng, -quayL * 0.42, quayL * 0.42)
    item.position.set(ix, DECK_HEIGHT + 0.35 + sy / 2, iz)
    item.rotation.y = rng() * Math.PI
    item.castShadow = true
    item.receiveShadow = true
    group.add(item)
    // Blob shadow under every prop — the cheapest "grounded" cue there is.
    group.add(
      contactShadow(
        mats.blobShadow,
        s * (isDrum ? 3.0 : 3.4),
        ix,
        DECK_HEIGHT + 0.4,
        iz,
        item.rotation.y
      )
    )
    // Small stacks: occasional second crate on top.
    if (!isDrum && rng() < 0.28) {
      const top = new THREE.Mesh(crateGeo, rng() < 0.4 ? mats.accent : mats.rust)
      const ts = s * range(rng, 0.7, 0.95)
      top.scale.set(ts, ts * 0.9, ts)
      top.position.set(ix + range(rng, -0.1, 0.1), DECK_HEIGHT + 0.35 + sy + ts * 0.45, iz)
      top.rotation.y = rng() * Math.PI
      top.castShadow = true
      group.add(top)
    }
  }

  // Drying nets on a simple frame along the quay — fishing-port tell.
  if (isPort && rng() < 0.75 && mats.net?.map) {
    const nx = quayW * range(rng, -0.3, 0.3)
    const nz = quayL * range(rng, -0.35, 0.35)
    const nw = size * range(rng, 0.12, 0.2)
    const nh = size * range(rng, 0.08, 0.14)
    for (const sx of [-1, 1]) {
      addBeamBetween(
        group,
        mats.beam,
        [nx + sx * nw * 0.5, DECK_HEIGHT + 0.4, nz],
        [nx + sx * nw * 0.5, DECK_HEIGHT + 0.4 + nh, nz],
        0.08
      )
    }
    addBeamBetween(
      group,
      mats.beam,
      [nx - nw * 0.5, DECK_HEIGHT + 0.4 + nh, nz],
      [nx + nw * 0.5, DECK_HEIGHT + 0.4 + nh, nz],
      0.07
    )
    const net = new THREE.Mesh(new THREE.PlaneGeometry(nw, nh), mats.net)
    net.position.set(nx, DECK_HEIGHT + 0.4 + nh * 0.5, nz + 0.05)
    net.castShadow = true
    group.add(net)
  }

  // —— Lights ————————————————————————————————————————————————————————
  // Cap visual posts + area emitters: the shared pool only has ~12 slots for
  // the whole scene, so ports should not register six equal quay floods.
  const lampPositions = []
  const lamps = isPort ? 4 : 2
  for (let i = 0; i < lamps; i++) {
    const t = i / Math.max(1, lamps - 1)
    lampPositions.push([
      (i % 2 === 0 ? -1 : 1) * quayW * 0.42,
      -quayL * 0.42 + t * quayL * 0.84
    ])
  }
  addQuayLights(group, mats, lampPositions)

  // Outposts get a light on a pole and nothing else — a mark, not a port.
  if (!isPort) {
    const lampY = DECK_HEIGHT + size * 0.52
    const botY = -PILE_DEPTH * 0.4
    const mastH = lampY - botY
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, mastH, 6), mats.beam)
    mast.position.set(0, (lampY + botY) / 2, -quayL * 0.35)
    mast.castShadow = true
    group.add(mast)
    const growth = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.36, TIDE_BAND_H, 8),
      mats.growth
    )
    growth.position.set(0, 0, -quayL * 0.35)
    group.add(growth)
    const light = new THREE.Mesh(new THREE.SphereGeometry(size * 0.035, 8, 6), mats.lamp)
    light.position.set(0, lampY, -quayL * 0.35)
    light.userData.beacon = true
    group.add(light)
    const pool = contactShadow(mats.lightPool, 6, 0, DECK_HEIGHT + 0.4, -quayL * 0.35)
    pool.renderOrder = 3
    group.add(pool)
    registerAreaEmitter(group, 0, lampY, -quayL * 0.35, 'beacon')
  }

  // Collapse static geometry into one mesh per material so the detail density
  // stays affordable with several harbours streamed in at once. Beacons and
  // the lighthouse window keep animating after the merge.
  mergeStatic(
    group,
    (obj) =>
      !!(
        obj.userData?.beacon ||
        obj.userData?.lighthouseWindow ||
        obj.userData?.lighthouse ||
        obj.userData?.noMerge ||
        obj.isInstancedMesh
      )
  )

  return group
}

/**
 * Pulse beacons and cache night level for the area-light pool.
 * @param {THREE.Object3D} mesh
 * @param {number} elapsed sim time (for beacon pulse)
 * @param {number} [nightFactor] 0 day … 1 night (default 1 so menu/title stays lit)
 */
export function updateHarbourMesh(mesh, elapsed, nightFactor = 1) {
  if (!mesh?.traverse) return
  const pulse = 0.55 + 0.45 * Math.sin(elapsed * 1.6)
  // Strict night ramp — day residual was lighting titles with dozens of lamps.
  const n = Math.min(1, Math.max(0, nightFactor))
  const nightLevel = n * n
  mesh.userData.areaLightLevel = nightLevel
  mesh.userData.areaLightPulse = pulse
  mesh.traverse((child) => {
    if (child.userData?.beacon && child.material) {
      child.material.emissiveIntensity = 0.8 + pulse * 1.8
    }
  })
}

const _emitWorld = new THREE.Vector3()

/**
 * Push this harbour's lamps into the shared area-light pool for the frame.
 * @param {THREE.Object3D} mesh harbour root
 * @param {{ offer: Function }} pool from createAreaLightPool
 */
export function offerHarbourAreaLights(mesh, pool) {
  if (!mesh || !pool) return
  const level = mesh.userData.areaLightLevel ?? 0
  if (level < 0.04) return
  const pulse = mesh.userData.areaLightPulse ?? 1
  mesh.updateWorldMatrix(true, false)

  // Emitters may live on the root or on child groups (tower local space).
  const roots = [mesh]
  mesh.traverse((child) => {
    if (child !== mesh && child.userData?.areaEmitters) roots.push(child)
  })

  for (const root of roots) {
    const list = root.userData.areaEmitters
    if (!list?.length) continue
    root.updateWorldMatrix(true, false)
    for (const e of list) {
      _emitWorld.set(e.x, e.y, e.z).applyMatrix4(root.matrixWorld)
      const breathe =
        e.tier === 'beacon' || e.tier === 'tower' || e.tier === 'mole'
          ? 0.82 + 0.28 * pulse
          : 1
      pool.offer(
        _emitWorld.x,
        _emitWorld.y,
        _emitWorld.z,
        e.color,
        e.base * level * breathe,
        e.distance,
        e.priority
      )
    }
  }
}
