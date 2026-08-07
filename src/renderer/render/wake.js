import * as THREE from 'three/webgpu'
import {
  uniform,
  attribute,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  mix,
  max,
  min,
  abs,
  pow,
  exp,
  sin,
  clamp,
  smoothstep,
  length,
  dot,
  negate,
  normalize,
  uv,
  positionWorld,
  cameraPosition
} from 'three/tsl'
import { seaParamAt, seaSurfaceAtParam } from '../world/sea.js'
import {
  createSpriteField,
  createSpriteMaterial,
  valueNoise,
  fbm4,
  ridged,
  dropletMask,
  puffMask,
  foamResponse,
  updateVfxLight,
  vfxLight,
  seaSurface
} from './vfxParticles.js'

/**
 * Kelvin wake.
 *
 * Three things happen behind a hull and they are not the same thing:
 *
 *  1. **Turbulent churn** directly astern — the screws aerate the water into
 *     near-opaque white froth. Narrow, violent, short-lived.
 *  2. **The Kelvin arms** — the cusp lines. Deep water puts them at a *constant*
 *     19.47° from the track whatever the speed, which is why a wake reads as a
 *     wake at any speed and why an angle that widens with the throttle reads as
 *     wrong even to people who could not tell you why.
 *  3. **Aerated water** — a broad pale band of bubbles between and behind the
 *     other two. Not foam. It has no white in it, it just lightens and
 *     desaturates the water it is suspended in, and it outlives both.
 *
 * ### Sitting *in* the water rather than on it
 *
 * `sea.js waveHeight` is the **hull** sample: it fades short chop so boats ride
 * the swell instead of twitching on capillaries. The ocean *shader* displaces
 * the full spectrum. Anything that reads `waveHeight` and calls that the water
 * surface is therefore up to half a metre out, and the old wake papered over
 * that with a 0.75 m lift — which is exactly why it read as a sheet of
 * geometry hovering above the sea.
 *
 * Here every vertex is laid out in sea *parameter* space (invert the trochoid
 * once per row, then step laterally in parameter space like the ocean disc
 * does) and lands on `seaSurfaceAtParam` — the same function the ocean's vertex
 * stage runs. The strip is then the water surface, to the metre, and needs only
 * a 12 cm bias to win the depth test. Cross-strip tessellation exists for the
 * same reason: a two-vertex ribbon chords straight across a wave.
 *
 * No depth texture is available on this pipeline (scene.js renders direct,
 * `usePost = false`), so soft-particle blending against the water is done
 * analytically: strips are coincident with the surface and feather in the
 * shader, and spray sprites fade on their clearance above it.
 */

/* -------------------------------------------------------------- constants */

/** Deep-water Kelvin half-angle. arcsin(1/3) = 19.47°, independent of speed. */
const KELVIN_TAN = Math.tan(Math.asin(1 / 3))

const SAMPLE_SPACING = 1.35
/** Rows of the churn/aeration strips. 130 rows ≈ 175 m of trail. */
const TRAIL_SEGMENTS = 130
const VEIL_SEGMENTS = 96
/** Arms are shorter — past this the cusp is too wide to read as one wake. */
const ARM_SEGMENTS = 74
/** Vertices across each strip. Two would chord straight across a wave crest. */
const TRAIL_COLS = 7
const VEIL_COLS = 9
const ARM_COLS = 5

const TRAIL_LIFETIME = 9.5
const VEIL_LIFETIME = 16
const ARM_LIFETIME = 7.5

/**
 * Depth bias. The strip is the water surface now, so this only has to beat the
 * chord error between the wake's tessellation and the ocean disc's — centimetres.
 */
const WAKE_LIFT = 0.12

/**
 * Dev only: 'cover' | 'noise' | null. Renders coverage or the raw noise field
 * opaquely so the shape can be graded without the lighting on top. **Must ship
 * as null** — left on, it paints the wake as a flat opaque slab.
 */
const DEBUG = null

const WAKE_THRESHOLD = 0.012
export const WAKE_FULL_SPEED = 13

/* --------------------------------------------------------------- materials */

/**
 * Foam / aeration shader. `mode` specialises the graph at build time — one
 * pipeline each, shared by every hull in the world, rather than a runtime
 * branch that pays for all three.
 *
 * @param {'churn'|'veil'|'arm'} mode
 */
function buildFoamMaterial(mode) {
  const light = vfxLight()
  const uSoft = uniform(mode === 'veil' ? 1 : 0)
  const uTime = light.uTime

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    side: THREE.DoubleSide
  })

  const aFade = attribute('aFade', 'float')
  const aLocal = attribute('aLocal', 'vec2')

  material.colorNode = Fn(() => {
    const u = uv().x.mul(2).sub(1)
    const v = uv().y
    const wp = positionWorld
    const V = normalize(cameraPosition.sub(wp))

    // Noise domain is **wake-local metres**, never world XZ.
    //
    // The world is 80 km across, so world coordinates reach ~2e4. `hash21` ends
    // up doing sin(~1e7) * 43758 in fp32, which has no bits left and collapses
    // the whole field into flat blocks — that is why the first pass rendered as
    // untextured polygons however good the maths above it was. `aLocal` is
    // (metres across the track, metres along it, wrapped) and is water-fixed:
    // it is written from the sample's own birth odometer, not its row index, so
    // foam stays with the water instead of conveyor-belting with the hull.
    const P = aLocal
    // Foam drifts slowly within the churn as bubbles circulate.
    const drift = vec2(uTime.mul(0.06), uTime.mul(-0.11))

    // Dispersion: as foam ages, bubbles coalesce into larger, softer, lower
    // contrast patches. Sampling coarser with age is what sells that.
    const spread = mix(float(1.0), float(0.28), pow(v, 0.6))
    const nBroad = fbm4(P.mul(spread.mul(0.13)).add(drift.mul(0.35)))
    const nMid = fbm4(P.mul(spread.mul(0.42)).sub(drift.mul(0.7)))
    const nFine = valueNoise(P.mul(spread.mul(1.6)).add(drift))

    let cover
    let thickness
    let whiteness
    let tint

    if (mode === 'churn') {
      // Screw wash: violent, rolling, near-opaque at the transom.
      const roll = ridged(P.mul(0.55).add(vec2(uTime.mul(0.35), uTime.mul(-1.4))))
      const boil = ridged(P.mul(1.35).sub(vec2(uTime.mul(0.9), uTime.mul(2.1))))
      const n = nBroad.mul(0.36).add(nMid.mul(0.26)).add(roll.mul(0.22)).add(boil.mul(0.16))
      // Two prop races either side of the centreline, merging with distance.
      const race = exp(negate(pow(abs(u).sub(mix(float(0.45), float(0.05), v)).div(0.36), 2)))
      const body = max(race, exp(negate(pow(u.div(mix(float(0.6), float(1.05), v)), 2))).mul(0.8))
      // Born dense, tears apart with age.
      const thresh = mix(float(-0.05), float(0.56), pow(v, 0.62))
      cover = smoothstep(thresh, thresh.add(mix(float(0.1), float(0.34), v)), n).mul(body)
      thickness = mix(float(1), float(0.25), v)
      whiteness = mix(float(1), float(0.45), pow(v, 0.75))
      tint = vec3(1, 1, 1)
    } else if (mode === 'arm') {
      // Cusp line: a raised, breaking crest. Bright, thin, with a lit face.
      const n = nBroad.mul(0.42).add(nMid.mul(0.36)).add(nFine.mul(0.22))

      // Feathering. The cusp is not a smooth ribbon — the diverging wave system
      // leaves a row of discrete overlapping crests set *en echelon* along it,
      // each one a wave that broke and got left behind. It is the most
      // recognisable thing about a real wake and the first thing missing from a
      // fake one, which always draws the cusp as a ruled line.
      // `P.y` is along-track metres, so the spacing is in world units and does
      // not swim as the boat moves.
      // Two beat frequencies so the crests do not march in step — a single sine
      // reads as a scallop pattern, which is its own kind of fake.
      const feather = sin(P.y.mul(0.5)).mul(0.7).add(sin(P.y.mul(0.19).add(1.7)).mul(0.3))
      const echelon = feather.mul(0.42)
      const crest = smoothstep(float(-0.35), float(0.8), feather)

      // Profile across the arm — steep outboard face, gentle inboard tail.
      const face = exp(negate(pow(u.add(0.2).sub(echelon).div(0.4), 2)))
      const tail = smoothstep(float(1), float(-0.3), u).mul(0.28)
      const thresh = mix(float(0.02), float(0.55), pow(v, 0.5))
      cover = smoothstep(thresh, thresh.add(0.2), n)
        .mul(max(face, tail))
        .mul(float(0.18).add(crest.mul(0.82)))
      thickness = mix(float(0.9), float(0.3), v)
      whiteness = mix(float(1), float(0.6), v)
      tint = vec3(1, 1, 1)
    } else {
      // Aerated water: a cloud of bubbles in suspension. It has no white in it,
      // but it is emphatically **brighter** than the sea it is suspended in —
      // the first pass tinted it with the (dark) hemisphere colour and painted
      // a navy triangle across the water instead.
      const n = nBroad.mul(0.6).add(nMid.mul(0.3)).add(nFine.mul(0.1))
      const body = float(1).sub(smoothstep(float(0.15), float(1), abs(u)))
      const thresh = mix(float(0.05), float(0.46), v)
      cover = smoothstep(thresh, thresh.add(0.36), n).mul(body)
      thickness = float(0.45)
      whiteness = mix(float(0.55), float(0.2), v)
      tint = vec3(0.82, 0.95, 1.0)
    }

    // Feather the geometry edge in every direction. A visible polygon boundary
    // is the single loudest tell that a wake is a decal.
    const rim = float(1)
      .sub(smoothstep(float(0.5), float(1), abs(u)))
      .mul(smoothstep(float(0), float(0.04), v))
      .mul(float(1).sub(smoothstep(float(0.6), float(1), v)))
    cover = clamp(cover.mul(rim).mul(aFade), float(0), float(1))

    // Relief: froth is not flat, and unshaded foam reads as paint. The slope
    // comes from the same noise field the coverage was built from, so the lit
    // face always lines up with the lump it belongs to. This is also the
    // "perturb the water rather than decal it" term — the foam has a normal of
    // its own and takes the sun with it.
    const eps = float(0.6)
    const nScale = spread.mul(0.42)
    const hC = nMid
    const hX = fbm4(P.add(vec2(eps, 0)).mul(nScale).sub(drift.mul(0.7)))
    const hZ = fbm4(P.add(vec2(0, eps)).mul(nScale).sub(drift.mul(0.7)))
    const relief = mix(float(1.5), float(0.35), v)
    const N = normalize(vec3(hC.sub(hX).mul(relief), float(1), hC.sub(hZ).mul(relief)))
    const sun = light.uSunDir
    const ndl = max(dot(N, sun), float(0))

    const lit = foamResponse(V, thickness)
    // Wet white is never 1.0 white, but it is always brighter than the water.
    const froth = vec3(0.94, 0.96, 0.98).mul(lit).mul(float(0.62).add(ndl.mul(0.55)))
    // Aerated water: the same light, scattered through blue-green water.
    const aerated = froth.mul(vec3(0.62, 0.86, 0.95)).mul(0.85)

    let col = mix(aerated, froth, whiteness).mul(tint)

    // Wet sheen off the crest of the churn — small, but it is what stops white
    // foam flattening into a paper cut-out at midday.
    const H = normalize(sun.add(V))
    const spec = pow(max(dot(N, H), float(0)), float(30)).mul(
      smoothstep(float(-0.05), float(0.2), sun.y)
    )
    col = col.add(
      light.uSunColor.mul(spec).mul(light.uSunLevel).mul(mix(float(0.5), float(0.05), v))
    )

    // Alpha. Real screw wash is opaque at the transom; the old code capped it at
    // 0.22, which is why the wake read as a ghost whatever it was shaded.
    let alpha
    if (mode === 'churn') alpha = cover.mul(mix(float(0.97), float(0.22), pow(v, 0.5)))
    else if (mode === 'arm') alpha = cover.mul(mix(float(0.9), float(0.16), pow(v, 0.55)))
    else alpha = cover.mul(mix(float(0.62), float(0.08), pow(v, 0.8)))

    if (DEBUG === 'cover') return vec4(vec3(cover), float(1))
    if (DEBUG === 'noise') return vec4(vec3(nBroad, nMid, nFine), float(1))
    return vec4(col, alpha)
  })()

  material.uniforms = { uSoft, uTime, uColor: uniform(new THREE.Color(0xffffff)) }
  return material
}

let _churnMat = null
let _veilMat = null
let _armMat = null
let _sprayMat = null
let _mistMat = null

function foamMaterials() {
  if (!_churnMat) {
    _churnMat = buildFoamMaterial('churn')
    _veilMat = buildFoamMaterial('veil')
    _armMat = buildFoamMaterial('arm')
  }
  return { churn: _churnMat, veil: _veilMat, arm: _armMat }
}

/**
 * Water thrown clear of the hull. Two populations from one pool:
 * `aux < 0.5` in the tint slot picks mist, otherwise a droplet.
 */
function sprayMaterials() {
  if (_sprayMat) return { drop: _sprayMat, mist: _mistMat }
  const light = vfxLight()

  _sprayMat = createSpriteMaterial({
    fog: true,
    shade: ({ q, life, seed, aux }) => {
      const mask = dropletMask(q, seed)
      // Born as a sheet, breaks into beads, dries to nothing.
      const birth = smoothstep(float(0), float(0.08), life)
      const death = float(1).sub(smoothstep(float(0.55), float(1), life))
      const V = normalize(cameraPosition.sub(positionWorld))
      const lit = foamResponse(V, float(0.75))
      const col = vec3(0.95, 0.97, 1).mul(lit)
      // aux is clearance above the water — spray dissolves into the surface
      // rather than clipping through it.
      const soft = smoothstep(float(0), float(0.55), aux)
      return vec4(col, mask.mul(birth).mul(death).mul(soft).mul(0.85))
    }
  })

  _mistMat = createSpriteMaterial({
    fog: true,
    shade: ({ q, life, seed, aux }) => {
      const mask = puffMask(q, seed, life.mul(0.55))
      const birth = smoothstep(float(0), float(0.14), life)
      const death = float(1).sub(smoothstep(float(0.3), float(1), life))
      const V = normalize(cameraPosition.sub(positionWorld))
      // Mist is optically thin, so it is mostly forward-scattered light. At a
      // low sun this is the effect that glows.
      const lit = foamResponse(V, float(1.35))
      const col = vec3(0.9, 0.94, 0.98).mul(lit)
      const soft = smoothstep(float(0), float(0.7), aux)
      return vec4(col, mask.mul(birth).mul(death).mul(soft).mul(0.3))
    }
  })
  void light
  return { drop: _sprayMat, mist: _mistMat }
}

/* --------------------------------------------------------------- geometry */

function buildStrip(rows, cols) {
  const verts = rows * cols
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2))
  geometry.setAttribute('aFade', new THREE.BufferAttribute(new Float32Array(verts), 1))
  // Water-fixed local metres (across, along) — the foam shader's noise domain.
  geometry.setAttribute('aLocal', new THREE.BufferAttribute(new Float32Array(verts * 2), 2))
  const indices = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c
      const b = a + 1
      const d = a + cols
      const e = d + 1
      indices.push(a, d, b, b, d, e)
    }
  }
  geometry.setIndex(indices)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)
  return geometry
}

const _p = { x: 0, z: 0 }

/**
 * Lay a strip on the visible sea surface.
 *
 * Rows walk back along the track (row 0 = the stem, newest water). Each row
 * inverts the trochoid **once** and then steps laterally in parameter space,
 * which is both cheaper than inverting per vertex and exactly what the ocean
 * disc does — so the two surfaces agree by construction.
 *
 * @param {(s: object, k: number, alongDist: number) => number} widthFn half-width
 * @param {(s: object, k: number, alongDist: number) => number} [offsetFn] centre
 *   offset across the track — the Kelvin arms use it to diverge at 19.47°.
 */
function writeStrip(geo, samples, rows, cols, lifetime, widthFn, simT, offsetFn, fadeFn) {
  const pos = geo.getAttribute('position')
  const uvA = geo.getAttribute('uv')
  const fade = geo.getAttribute('aFade')
  const local = geo.getAttribute('aLocal')
  const n = samples.length
  for (let r = 0; r < rows; r++) {
    const s = samples[n - 1 - r]
    const base = r * cols
    if (!s) {
      for (let c = 0; c < cols; c++) {
        pos.setXYZ(base + c, 0, -900, 0)
        fade.setX(base + c, 0)
        uvA.setXY(base + c, c / (cols - 1), r / (rows - 1))
      }
      continue
    }
    const k = Math.min(1, s.age / lifetime)
    const alongDist = r * SAMPLE_SPACING
    const half = widthFn(s, k, alongDist)
    const centre = offsetFn ? offsetFn(s, k, alongDist) : 0
    const nx = Math.cos(s.heading)
    const nz = -Math.sin(s.heading)
    // One trochoid inversion per row; lateral steps stay in parameter space.
    seaParamAt(s.x, s.z, simT, _p)
    const px = _p.x
    const pz = _p.z
    const f = fadeFn(s, k, alongDist)
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1)
      const lat = centre + (u * 2 - 1) * half
      const surf = seaSurfaceAtParam(px + nx * lat, pz + nz * lat, simT)
      const i = base + c
      pos.setXYZ(i, surf.x, surf.y + WAKE_LIFT, surf.z)
      uvA.setXY(i, u, r / (rows - 1))
      fade.setX(i, f)
      // Water-fixed noise domain: `s.odo` is the odometer reading when this
      // patch of water was disturbed, so it never changes as rows shift back.
      // Using the row index here instead would conveyor-belt the foam texture
      // forward under the hull.
      local.setXY(i, lat, s.odo)
    }
  }
  pos.needsUpdate = true
  uvA.needsUpdate = true
  fade.needsUpdate = true
  local.needsUpdate = true
}

/* ------------------------------------------------------------------- spray */

function createWakeSpray() {
  const { drop, mist } = sprayMaterials()
  const drops = createSpriteField({
    capacity: 96,
    material: drop,
    renderOrder: 4,
    name: 'wake-bow-spray'
  })
  const mists = createSpriteField({
    capacity: 64,
    material: mist,
    renderOrder: 3.9,
    name: 'wake-bow-mist'
  })

  let dropCarry = 0
  let mistCarry = 0
  let washCarry = 0

  /**
   * @param {number} speed 0..1 of top speed
   * @param {number} sea 0..1 sea state — a hull punching into a swell throws
   *   far more water than the same hull on a flat day.
   */
  function update(dt, active, stem, heading, speed, hBeam, hLen, simT, sea) {
    const fx = Math.sin(heading)
    const fz = Math.cos(heading)
    const nx = Math.cos(heading)
    const nz = -Math.sin(heading)
    const drive = Math.max(0, speed - 0.1)

    if (active && drive > 0) {
      const power = Math.pow(drive, 1.5) * (0.7 + sea * 0.9)
      // Bow sheet: dense fast beads off both cheeks of the stem.
      dropCarry += power * 150 * dt
      while (dropCarry >= 1) {
        dropCarry -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        const along = (Math.random() - 0.25) * hLen * 0.22
        const lat = side * (hBeam * (0.35 + Math.random() * 0.55))
        const x = stem[0] + fx * along + nx * lat
        const z = stem[2] + fz * along + nz * lat
        const y = seaSurface(x, z, simT) + 0.05 + Math.random() * 0.35
        // Thrown out and forward, then gravity takes it back into the sea.
        const out = side * (2.4 + drive * 7 + Math.random() * 3)
        const up = 1.6 + drive * 5.5 + Math.random() * 2.6 + sea * 3
        const fwd = drive * 3.5 + Math.random() * 1.6
        drops.emit({
          position: [x, y, z],
          velocity: [fx * fwd + nx * out, up, fz * fwd + nz * out],
          size: 0.1 + Math.random() * 0.3 + drive * 0.22,
          grow: 0.12,
          life: 0.45 + Math.random() * 0.7,
          gravity: 15.5,
          drag: 1.1
        })
      }
      // Mist torn off the sheet — slow, wind-borne, and what actually catches
      // a low sun.
      mistCarry += power * 26 * dt
      while (mistCarry >= 1) {
        mistCarry -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        const lat = side * hBeam * (0.5 + Math.random() * 1.1)
        const along = (Math.random() - 0.4) * hLen * 0.3
        const x = stem[0] + fx * along + nx * lat
        const z = stem[2] + fz * along + nz * lat
        const y = seaSurface(x, z, simT) + 0.2 + Math.random() * 0.7
        mists.emit({
          position: [x, y, z],
          velocity: [
            nx * side * (1.2 + Math.random() * 2.2) + fx * drive * 1.5,
            0.9 + Math.random() * 1.4,
            nz * side * (1.2 + Math.random() * 2.2) + fz * drive * 1.5
          ],
          size: 0.7 + Math.random() * 1.5,
          grow: 2.6,
          life: 0.9 + Math.random() * 1.1,
          gravity: 1.4,
          drag: 1.5,
          wind: 0.6
        })
      }
      // Hull wash: water shouldering along the topsides, well aft of the stem.
      washCarry += power * 44 * dt
      while (washCarry >= 1) {
        washCarry -= 1
        const side = Math.random() < 0.5 ? -1 : 1
        const along = -Math.random() * hLen * 0.75
        const lat = side * hBeam * (0.85 + Math.random() * 0.3)
        const x = stem[0] + fx * along + nx * lat
        const z = stem[2] + fz * along + nz * lat
        const y = seaSurface(x, z, simT) + 0.03
        drops.emit({
          position: [x, y, z],
          velocity: [nx * side * (1 + drive * 2.2), 0.7 + drive * 1.6, nz * side * (1 + drive * 2.2)],
          size: 0.18 + Math.random() * 0.4,
          grow: 0.5,
          life: 0.5 + Math.random() * 0.5,
          gravity: 9,
          drag: 2.2
        })
      }
    } else {
      dropCarry = 0
      mistCarry = 0
      washCarry = 0
    }

    const env = { seaTime: simT, wind: [1.6, 0.2, 0.9] }
    drops.update(dt, env)
    mists.update(dt, { ...env, spin: 0.35 })
  }

  return {
    meshes: [drops.mesh, mists.mesh],
    update,
    reset() {
      drops.reset()
      mists.reset()
      dropCarry = mistCarry = washCarry = 0
    },
    dispose() {
      drops.dispose()
      mists.dispose()
    }
  }
}

/* -------------------------------------------------------------------- wake */

export function createWake() {
  const group = new THREE.Group()
  group.frustumCulled = false
  group.renderOrder = 0.5
  group.name = 'wake'

  const mats = foamMaterials()

  const veilGeo = buildStrip(VEIL_SEGMENTS, VEIL_COLS)
  const veil = new THREE.Mesh(veilGeo, mats.veil)
  veil.frustumCulled = false
  veil.renderOrder = 0.45
  veil.name = 'wake-trail-veil'
  group.add(veil)

  const trailGeo = buildStrip(TRAIL_SEGMENTS, TRAIL_COLS)
  const trail = new THREE.Mesh(trailGeo, mats.churn)
  trail.frustumCulled = false
  trail.renderOrder = 0.55
  trail.name = 'wake-trail-foam'
  group.add(trail)

  const armGeos = [buildStrip(ARM_SEGMENTS, ARM_COLS), buildStrip(ARM_SEGMENTS, ARM_COLS)]
  const arms = armGeos.map((g, i) => {
    const m = new THREE.Mesh(g, mats.arm)
    m.frustumCulled = false
    m.renderOrder = 0.5
    m.name = `wake-bow-${i}`
    group.add(m)
    return m
  })

  const spray = createWakeSpray()
  for (const m of spray.meshes) group.add(m)

  /** @type {{x:number,z:number,heading:number,speed:number,age:number,odo:number}[]} */
  const samples = []
  let lastSample = null
  /**
   * Distance travelled, metres, wrapped. Stamped onto each sample at birth and
   * never revised, so the foam noise stays pinned to the water. Wrapping keeps
   * it inside fp32's useful range for a noise coordinate; the seam it causes is
   * one row wide, once every 4 km.
   */
  let odometer = 0

  function reset() {
    samples.length = 0
    lastSample = null
    odometer = 0
    trail.visible = false
    veil.visible = false
    for (const a of arms) a.visible = false
    spray.reset()
  }

  function update(position, travelHeading, speedFraction, hullLength, hullHalfBeam, t, dt) {
    const speed = Math.max(0, Number(speedFraction) || 0)
    const active = speed > WAKE_THRESHOLD
    const px = Number(position?.[0]) || 0
    const pz = Number(position?.[2]) || 0
    const heading = Number.isFinite(travelHeading) ? travelHeading : 0
    const hLen = Math.max(4, Number(hullLength) || 16)
    const hBeam = Math.max(1.2, Number(hullHalfBeam) || 4)
    const simT = Number.isFinite(t) ? t : 0
    const step = Math.max(1e-3, Number(dt) || 1 / 60)

    updateVfxLight(simT)
    group.visible = true

    // The whole wake is anchored at the **stem**, not the transom: the Kelvin
    // arms are generated by the bow, and the churn simply starts a hull-length
    // further back along the same track. Anchoring astern made the arms start
    // mid-wake with nothing joining them to the boat.
    const fx = Math.sin(heading)
    const fz = Math.cos(heading)
    const ax = px + fx * hLen * 0.5
    const az = pz + fz * hLen * 0.5

    if (active) {
      if (samples.length === 0) {
        // Seed a track behind a boat that has just started moving, so undock /
        // Continue does not show a hull with no history behind it.
        for (let i = 40; i >= 0; i--) {
          samples.push({
            x: ax - fx * i * SAMPLE_SPACING,
            z: az - fz * i * SAMPLE_SPACING,
            heading,
            speed: Math.max(0.2, speed),
            age: (i * SAMPLE_SPACING) / Math.max(1, speed * WAKE_FULL_SPEED),
            odo: (odometer - i * SAMPLE_SPACING + 4096) % 4096
          })
        }
        lastSample = samples[samples.length - 1]
      }
      if (!lastSample || Math.hypot(ax - lastSample.x, az - lastSample.z) >= SAMPLE_SPACING) {
        odometer = (odometer + SAMPLE_SPACING) % 4096
        samples.push({ x: ax, z: az, heading, speed, age: 0, odo: odometer })
        lastSample = samples[samples.length - 1]
        if (samples.length > TRAIL_SEGMENTS + 1) samples.shift()
      }
    }

    for (const s of samples) s.age += step
    while (samples.length && samples[0].age > VEIL_LIFETIME) samples.shift()

    const hasTrack = samples.length > 1
    // Rows before the transom carry no churn — that water has not been through
    // the screws yet. `alongDist` is measured from the stem, so this is exact.
    const transom = hLen
    // Seconds between the stem and the transom passing the same patch of water.
    const transitT = hLen / Math.max(1.5, speed * WAKE_FULL_SPEED)

    // Sea state modulates everything: the same hull throws far more water in a
    // swell. Sampled from the actual surface the boat is sitting on.
    const seaState = Math.min(
      1,
      Math.abs(seaSurface(ax, az, simT) - seaSurface(ax - fx * 14, az - fz * 14, simT)) / 1.4
    )

    // --- aerated water: the broad pale band, longest-lived -----------------
    writeStrip(
      veilGeo,
      samples,
      VEIL_SEGMENTS,
      VEIL_COLS,
      VEIL_LIFETIME,
      (s, k, d) => (hBeam * 1.05 + d * 0.075) * (0.5 + s.speed * 0.5),
      simT,
      null,
      (s, k, d) =>
        Math.pow(1 - k, 1.15) *
        Math.min(1, s.speed * 2.4) *
        Math.min(1, Math.max(0, (d - transom * 0.35) / (transom * 0.6)))
    )
    veil.visible = hasTrack

    // --- turbulent churn: narrow, violent, from the transom aft ------------
    writeStrip(
      trailGeo,
      samples,
      TRAIL_SEGMENTS,
      TRAIL_COLS,
      TRAIL_LIFETIME,
      (s, k, d) =>
        Math.max(1.1, hBeam * 0.9) * (0.55 + s.speed * 0.5) * (1 + Math.min(1.6, d * 0.012)),
      simT,
      null,
      // Churn ages from the moment the water went through the **screws**, not
      // from when the stem passed it. Without that offset the froth at the
      // transom is already a hull-length old and can never reach full strength.
      (s, k, d) =>
        Math.pow(1 - Math.min(1, Math.max(0, s.age - transitT) / TRAIL_LIFETIME), 1.35) *
        Math.min(1, s.speed * 2.6) *
        Math.min(1, Math.max(0, (d - transom * 0.82) / (transom * 0.35)))
    )
    trail.visible = hasTrack

    // --- Kelvin arms: constant 19.47° from the track, both sides -----------
    for (let a = 0; a < 2; a++) {
      const sign = a === 0 ? -1 : 1
      writeStrip(
        armGeos[a],
        samples,
        ARM_SEGMENTS,
        ARM_COLS,
        ARM_LIFETIME,
        (s, k, d) => Math.max(0.6, hBeam * 0.42) + d * 0.028,
        simT,
        // The cusp diverges linearly from the track. Speed does not change the
        // angle — it changes how far along the arms stay legible.
        (s, k, d) => sign * (hBeam * 0.55 + d * KELVIN_TAN),
        (s, k, d) =>
          Math.pow(1 - k, 1.3) *
          Math.min(1, s.speed * 2.8) *
          Math.min(1, d / (hLen * 0.35)) *
          (0.35 + 0.65 * Math.min(1, s.speed * 1.6))
      )
      // Mirror the shader's outboard-face profile for the port arm.
      arms[a].scale.x = 1
      arms[a].visible = hasTrack && active
    }

    // --- spray -------------------------------------------------------------
    spray.update(step, active, [ax, 0, az], heading, speed, hBeam, hLen, simT, seaState)
  }

  function dispose() {
    trailGeo.dispose()
    veilGeo.dispose()
    for (const g of armGeos) g.dispose()
    spray.dispose()
    // Foam / spray materials are module-level singletons shared by every hull
    // in the world — one pipeline each instead of one per NPC. Not ours to free.
  }

  return { group, update, reset, dispose }
}
