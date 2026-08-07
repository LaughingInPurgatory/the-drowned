/**
 * Shared VFX primitives: TSL noise, and an instanced billboard sprite field.
 *
 * Why this exists: **`THREE.Points` is one pixel on WebGPU.** The backend maps
 * `isPoints` to `GPUPrimitiveTopology.PointList` (WebGPUUtils.js) and WebGPU
 * point primitives have no size — `PointsNodeMaterial` says so in its own
 * docstring. Every point-sprite particle system in this repo (bow spray, hit
 * sparks, damage smoke, scoop, missile trails) was therefore drawing a single
 * pixel per particle, which is why the sea and combat read as effect-free.
 *
 * The fix three itself recommends is a quad + instancing. `SpriteNodeMaterial`
 * already billboards `positionGeometry.xy` around `positionNode` with size
 * attenuation, so an `InstancedBufferGeometry` of one unit quad plus instanced
 * centre/size/rotation attributes gives real world-sized sprites in one draw
 * call.
 *
 * The simulator here is deliberately one ballistic integrator (velocity,
 * gravity, drag, growth, wind) because spray, sparks, embers, smoke and debris
 * are all that with different constants. Anything needing more than that should
 * drive the arrays itself rather than grow this.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  attribute,
  sin,
  cos,
  fract,
  floor,
  mix,
  smoothstep,
  clamp,
  max,
  min,
  abs,
  pow,
  exp,
  length,
  dot,
  negate,
  normalize,
  uv,
  cameraPosition,
  positionWorld
} from 'three/tsl'
import { seaParamAt, seaSurfaceAtParam } from '../world/sea.js'
import { daylightAt } from './sky.js'

/* ------------------------------------------------------------------ noise */

/** Cheap 2D hash. Same shape as the one in oceanNodeMaterial so foam matches. */
export const hash21 = Fn(([p]) => {
  const n = dot(p, vec2(127.1, 311.7))
  return fract(sin(n).mul(43758.5453123))
})

export const valueNoise = Fn(([p]) => {
  const i = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const a = hash21(i)
  const b = hash21(i.add(vec2(1, 0)))
  const c = hash21(i.add(vec2(0, 1)))
  const d = hash21(i.add(vec2(1, 1)))
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y)
})

/** Four-octave fBm. Rotated per octave so the lattice never shows through. */
export const fbm4 = Fn(([p0]) => {
  let p = p0
  let v = float(0)
  let a = float(0.5)
  for (let i = 0; i < 4; i++) {
    v = v.add(valueNoise(p).mul(a))
    // 2.03 + rotation: powers of two align octave lattices into visible grids.
    p = vec2(p.x.mul(1.62).sub(p.y.mul(1.21)), p.x.mul(1.21).add(p.y.mul(1.62))).add(
      vec2(17.1, 9.3)
    )
    a = a.mul(0.5)
  }
  return v
})

/** Two-octave fBm — for anything that only needs to look broken, not detailed. */
export const fbm2 = Fn(([p0]) => {
  const a = valueNoise(p0)
  const b = valueNoise(vec2(p0.x.mul(1.62).sub(p0.y.mul(1.21)), p0.x.mul(1.21).add(p0.y.mul(1.62))).mul(2.07))
  return a.mul(0.66).add(b.mul(0.34))
})

/**
 * Ridged noise — the crest lines you get in churned water and smoke rolls.
 */
export const ridged = Fn(([p]) => {
  return float(1).sub(abs(valueNoise(p).mul(2).sub(1)))
})

/* --------------------------------------------------------- sprite shading */

/**
 * A soft round droplet with a wet rim. `q` is the quad coordinate in [-1, 1].
 * Returns coverage 0..1 — no colour, so callers pick their own response.
 */
export const dropletMask = Fn(([q, seed]) => {
  const r = length(q)
  // Slight per-particle squash so a field of them is not a field of circles.
  const core = smoothstep(float(1), float(0.05), r)
  const rim = smoothstep(float(0.95), float(0.55), r).mul(smoothstep(float(0.25), float(0.7), r))
  const grain = valueNoise(q.mul(3.1).add(seed.mul(37.1))).mul(0.35).add(0.65)
  return clamp(pow(core, float(1.45)).mul(grain).add(rim.mul(0.25)), float(0), float(1))
})

/** A billowing puff — fbm-eroded disc. Used for smoke, mist and fireballs. */
export const puffMask = Fn(([q, seed, erode]) => {
  const r = length(q)
  const n = fbm4(q.mul(1.35).add(vec2(seed.mul(19.7), seed.mul(-11.3))))
  // Erosion eats the puff from the outside in as it ages, so smoke shreds.
  const edge = smoothstep(float(1.02), float(0.15), r.add(n.mul(0.45).sub(0.18)))
  return clamp(edge.sub(erode.mul(smoothstep(float(0.2), float(0.95), n))), float(0), float(1))
})

/* ------------------------------------------------------------ sprite field */

const _v3 = new THREE.Vector3()

/**
 * Instanced billboard particle pool.
 *
 * @param {object} opts
 * @param {number} opts.capacity max live sprites
 * @param {(nodes: {q: any, uvNode: any, life: any, seed: any, tint: any, aux: any, time: any}) => any}
 *   opts.shade TSL fragment: takes quad coord in [-1,1] and per-instance data,
 *   returns vec4 (rgb, alpha).
 * @param {THREE.Blending} [opts.blending]
 * @param {boolean} [opts.fog]
 * @param {boolean} [opts.depthTest]
 * @param {number} [opts.renderOrder]
 * @param {string} [opts.name]
 */
export function createSpriteMaterial({
  shade,
  blending = THREE.NormalBlending,
  fog = false,
  depthTest = true
} = {}) {
  const uTime = uniform(0)
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest,
    blending,
    fog,
    sizeAttenuation: true
  })
  const nLife = attribute('iLife', 'float')
  const nSeed = attribute('iSeed', 'float')
  const nTint = attribute('iTint', 'vec3')
  const nAux = attribute('iAux', 'float')
  material.positionNode = attribute('iPos', 'vec3')
  material.scaleNode = attribute('iSize', 'float')
  material.rotationNode = attribute('iRot', 'float')
  material.colorNode = Fn(() =>
    shade({
      q: uv().sub(0.5).mul(2),
      uvNode: uv(),
      life: nLife,
      seed: nSeed,
      tint: nTint,
      aux: nAux,
      time: uTime
    })
  )()
  material.uniforms = { uTime }
  return material
}

export function createSpriteField({
  capacity = 128,
  shade,
  material: sharedMaterial = null,
  blending = THREE.NormalBlending,
  fog = false,
  depthTest = true,
  renderOrder = 3,
  name = 'vfx-sprites'
} = {}) {
  const quad = new THREE.PlaneGeometry(1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = quad.index
  geometry.setAttribute('position', quad.getAttribute('position'))
  geometry.setAttribute('uv', quad.getAttribute('uv'))
  geometry.instanceCount = capacity
  quad.dispose()

  const iPos = new Float32Array(capacity * 3)
  const iSize = new Float32Array(capacity)
  const iLife = new Float32Array(capacity)
  const iSeed = new Float32Array(capacity)
  const iTint = new Float32Array(capacity * 3)
  const iAux = new Float32Array(capacity)
  const iRot = new Float32Array(capacity)
  for (let i = 0; i < capacity; i++) {
    iLife[i] = 1
    iSeed[i] = Math.random()
    iTint[i * 3] = 1
    iTint[i * 3 + 1] = 1
    iTint[i * 3 + 2] = 1
    iAux[i] = 1
  }

  const aPos = new THREE.InstancedBufferAttribute(iPos, 3)
  const aSize = new THREE.InstancedBufferAttribute(iSize, 1)
  const aLife = new THREE.InstancedBufferAttribute(iLife, 1)
  const aSeed = new THREE.InstancedBufferAttribute(iSeed, 1)
  const aTint = new THREE.InstancedBufferAttribute(iTint, 3)
  const aAux = new THREE.InstancedBufferAttribute(iAux, 1)
  const aRot = new THREE.InstancedBufferAttribute(iRot, 1)
  geometry.setAttribute('iPos', aPos)
  geometry.setAttribute('iSize', aSize)
  geometry.setAttribute('iLife', aLife)
  geometry.setAttribute('iSeed', aSeed)
  geometry.setAttribute('iTint', aTint)
  geometry.setAttribute('iAux', aAux)
  geometry.setAttribute('iRot', aRot)
  // World-space pool: never cull, the instances move without the mesh.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7)

  const material =
    sharedMaterial || createSpriteMaterial({ shade, blending, fog, depthTest })
  const ownsMaterial = !sharedMaterial

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.frustumCulled = false
  mesh.renderOrder = renderOrder
  mesh.visible = false
  // Sprites are positioned in world space by the instance attribute.
  mesh.matrixAutoUpdate = false

  // Per-particle CPU state, parallel to the instance arrays.
  const vel = new Float32Array(capacity * 3)
  const ttl = new Float32Array(capacity)
  const maxTtl = new Float32Array(capacity)
  const grav = new Float32Array(capacity)
  const drag = new Float32Array(capacity)
  const grow = new Float32Array(capacity)
  const baseSize = new Float32Array(capacity)
  const windMul = new Float32Array(capacity)
  const riseA = new Float32Array(capacity)
  let cursor = 0
  let live = 0

  /**
   * @param {object} p
   * @param {number[]|THREE.Vector3} p.position
   * @param {number[]} [p.velocity]
   * @param {number} [p.size] world diameter at birth
   * @param {number} [p.grow] metres/sec of diameter growth
   * @param {number} [p.life] seconds
   * @param {number|THREE.Color} [p.tint]
   * @param {number} [p.gravity] m/s^2 (positive pulls down)
   * @param {number} [p.drag] per-second exponential velocity decay
   * @param {number} [p.wind] 0..1 how much ambient wind moves it
   * @param {number} [p.buoyancy] m/s^2 upward (hot smoke / fire)
   * @param {number} [p.aux] free per-particle shader parameter
   * @param {number} [p.rotation] radians
   */
  function emit(p) {
    const i = cursor
    cursor = (cursor + 1) % capacity
    const pos = p.position
    const x = pos.isVector3 ? pos.x : pos[0]
    const y = pos.isVector3 ? pos.y : pos[1]
    const z = pos.isVector3 ? pos.z : pos[2]
    iPos[i * 3] = x
    iPos[i * 3 + 1] = y
    iPos[i * 3 + 2] = z
    const v = p.velocity
    vel[i * 3] = v ? v[0] : 0
    vel[i * 3 + 1] = v ? v[1] : 0
    vel[i * 3 + 2] = v ? v[2] : 0
    const size = p.size ?? 1
    baseSize[i] = size
    iSize[i] = size
    grow[i] = p.grow ?? 0
    maxTtl[i] = Math.max(0.02, p.life ?? 1)
    ttl[i] = maxTtl[i]
    iLife[i] = 0
    iSeed[i] = Math.random()
    iAux[i] = p.aux ?? 1
    iRot[i] = p.rotation ?? Math.random() * Math.PI * 2
    grav[i] = p.gravity ?? 0
    drag[i] = p.drag ?? 0
    windMul[i] = p.wind ?? 0
    riseA[i] = p.buoyancy ?? 0
    const tint = p.tint
    if (tint == null) {
      iTint[i * 3] = 1
      iTint[i * 3 + 1] = 1
      iTint[i * 3 + 2] = 1
    } else {
      const c = tint.isColor ? tint : _tint.set(tint)
      iTint[i * 3] = c.r
      iTint[i * 3 + 1] = c.g
      iTint[i * 3 + 2] = c.b
    }
    return i
  }
  const _tint = new THREE.Color()

  /**
   * @param {number} dt
   * @param {object} [env]
   * @param {number[]} [env.wind] world wind vector
   * @param {number} [env.seaTime] when set, particles fade out as they reach the
   *   water surface instead of punching a hard line through it, and die under it
   * @param {number} [env.spin] radians/sec of sprite roll
   */
  function update(dt, env = null) {
    const step = Math.max(1e-4, dt)
    const wx = env?.wind ? env.wind[0] : 0
    const wy = env?.wind ? env.wind[1] : 0
    const wz = env?.wind ? env.wind[2] : 0
    const seaT = env?.seaTime
    const spin = env?.spin ?? 0
    live = 0
    for (let i = 0; i < capacity; i++) {
      if (ttl[i] <= 0) {
        if (iSize[i] !== 0) iSize[i] = 0
        continue
      }
      ttl[i] -= step
      if (ttl[i] <= 0) {
        iSize[i] = 0
        iLife[i] = 1
        continue
      }
      live++
      const k = 1 - ttl[i] / maxTtl[i]
      iLife[i] = k
      const d = drag[i] > 0 ? Math.exp(-drag[i] * step) : 1
      let vx = vel[i * 3] * d
      let vy = (vel[i * 3 + 1] - grav[i] * step + riseA[i] * step) * d
      let vz = vel[i * 3 + 2] * d
      if (windMul[i] > 0) {
        const w = windMul[i] * step
        vx += (wx - vx) * Math.min(1, w)
        vy += (wy - vy) * Math.min(1, w * 0.35)
        vz += (wz - vz) * Math.min(1, w)
      }
      vel[i * 3] = vx
      vel[i * 3 + 1] = vy
      vel[i * 3 + 2] = vz
      const px = (iPos[i * 3] += vx * step)
      const py = (iPos[i * 3 + 1] += vy * step)
      const pz = (iPos[i * 3 + 2] += vz * step)
      iSize[i] = Math.max(0, baseSize[i] + grow[i] * (maxTtl[i] - ttl[i]))
      if (spin) iRot[i] += spin * step * (iSeed[i] - 0.5) * 2

      // Soft against the sea: no depth texture is available on this pipeline
      // (scene.js renders direct, usePost = false), so the water intersection is
      // resolved analytically instead — clearance above the surface drives the
      // shader's fade, which is what a depth-soft particle buys you here.
      if (seaT !== undefined) {
        const surf = seaSurface(px, pz, seaT)
        const clearance = py - surf
        if (clearance < -0.35) {
          ttl[i] = 0
          iSize[i] = 0
          continue
        }
        iAux[i] = Math.max(0, Math.min(1, (clearance + 0.35) / 0.9))
      }
    }
    aPos.needsUpdate = true
    aSize.needsUpdate = true
    aLife.needsUpdate = true
    aSeed.needsUpdate = true
    aTint.needsUpdate = true
    aAux.needsUpdate = true
    aRot.needsUpdate = true
    material.uniforms.uTime.value = (material.uniforms.uTime.value + step) % 10000
    mesh.visible = live > 0
    return live
  }

  function reset() {
    for (let i = 0; i < capacity; i++) {
      ttl[i] = 0
      iSize[i] = 0
      iLife[i] = 1
    }
    aSize.needsUpdate = true
    aLife.needsUpdate = true
    mesh.visible = false
    live = 0
  }

  return {
    mesh,
    material,
    capacity,
    emit,
    update,
    reset,
    get live() {
      return live
    },
    setTime(t) {
      material.uniforms.uTime.value = t
    },
    dispose() {
      geometry.dispose()
      if (ownsMaterial) material.dispose()
    }
  }
}

/**
 * Visible ocean height at a world XZ.
 *
 * `waveHeight` in sea.js is the **hull** sample: it fades short chop so boats
 * ride the swell instead of twitching. The ocean *shader* displaces the full
 * spectrum, so anything that has to sit exactly on the water you can see — foam,
 * spray, splashes — must evaluate the full field, or it floats up to half a
 * metre above the surface and reads as a decal. Inverting the trochoid then
 * evaluating `seaSurfaceAtParam` is the same maths the ocean's vertex stage runs
 * and costs no more than `waveHeight` did.
 */
export function seaSurface(x, z, t) {
  const p = seaParamAt(x, z, t)
  return seaSurfaceAtParam(p.x, p.z, t).y
}

/** As above, but hands back the parameter too — callers laying out a strip in
 * parameter space want to invert once per row, not once per vertex. */
export function seaParam(x, z, t, out) {
  const p = seaParamAt(x, z, t)
  out.x = p.x
  out.z = p.z
  return out
}

export { seaSurfaceAtParam }

/* ---------------------------------------------------------------- lighting */

/**
 * One shared daylight block for every VFX material, so foam, spray, smoke and
 * fire all agree with `sky.js` about where the sun is and what colour it is.
 * Materials pull the uniforms; `updateVfxLight(t)` is called once a frame by
 * whoever gets there first.
 */
const light = {
  uSunDir: uniform(new THREE.Vector3(0.4, 0.8, 0.3)),
  uSunColor: uniform(new THREE.Color(0xfff0d8)),
  uSunLevel: uniform(1),
  uSkyColor: uniform(new THREE.Color(0x9fb4c4)),
  uAmbient: uniform(0.5),
  uFogColor: uniform(new THREE.Color(0x8fa0ad)),
  uTime: uniform(0),
  uWetness: uniform(0)
}

let lightStamp = -1

/**
 * Pull sun/sky from `sky.js` for the same clock the sea uses. Guarded on `t`, so
 * every wake, spray and fire in the frame can call it and only the first pays.
 * @param {number} t campaign time
 */
export function updateVfxLight(t) {
  if (t === lightStamp || !Number.isFinite(t)) return light
  lightStamp = t
  light.uTime.value = t
  const daylight = daylightAt(t)
  light.uSunDir.value.copy(daylight.sunDirection)
  light.uSunColor.value.copy(daylight.sunColor)
  light.uSunLevel.value = Math.max(0, Math.min(1.6, daylight.sunIntensity ?? 1))
  light.uSkyColor.value.copy(daylight.hemiSky)
  light.uAmbient.value = Math.max(0.06, Math.min(1.4, daylight.hemiIntensity ?? 0.5))
  light.uFogColor.value.copy(daylight.fog)
  return light
}

export function vfxLight() {
  return light
}

/**
 * Standard water-foam response: white froth is a diffuse, slightly translucent
 * medium. It takes the sun on top, the sky from every direction, and when the
 * sun is low and behind it, it glows — which is the single cue that separates
 * spray that looks photographed from spray that looks like a decal.
 *
 * @param {any} viewDirNode unit vector from surface toward the camera
 * @param {any} thickness 0..1 optical depth through the froth
 */
export const foamResponse = Fn(([viewDir, thickness]) => {
  const sun = light.uSunDir
  const sunUp = smoothstep(float(-0.12), float(0.16), sun.y)
  // Diffuse: foam is close to a Lambertian white, lit from above.
  const diffuse = light.uSunColor.mul(max(sun.y, float(0)).mul(0.85).add(0.15)).mul(light.uSunLevel)
  const ambient = light.uSkyColor.mul(light.uAmbient.mul(0.9).add(0.1))
  // Backlit transmission: sun behind the froth, seen through it.
  const back = pow(max(dot(viewDir, negate(sun)), float(0)), float(3.0))
  const lowSun = clamp(float(1.25).sub(sun.y.mul(1.6)), float(0), float(1))
  const glow = light.uSunColor
    .mul(back)
    .mul(thickness)
    .mul(sunUp)
    .mul(float(0.35).add(lowSun.mul(1.35)))
  const lit = diffuse.mul(0.62).add(ambient.mul(0.55)).add(glow)
  // Foam is a dense diffuse scatterer — millions of air/water interfaces. Even
  // with no sun on it at all it is *brighter* than the water it sits in. Without
  // this floor the whole wake goes darker than the sea after sunset, which is
  // the one thing foam can never do.
  const floor = light.uSkyColor.mul(0.3).add(vec3(0.025, 0.035, 0.045))
  return max(lit, floor)
})

export { uv, positionWorld, cameraPosition, normalize, negate, min, max, abs, exp, cos, sin }
