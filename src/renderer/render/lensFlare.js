import * as THREE from 'three/webgpu'
import {
  uniform,
  vec4,
  vec3,
  vec2,
  Fn,
  float,
  mix,
  abs,
  exp,
  pow,
  max,
  length,
  smoothstep,
  clamp,
  cos,
  atan,
  positionLocal,
  negate
} from 'three/tsl'

/**
 * Lens flare (WebGPU / TSL).
 *
 * Screen-space after post: glare, anamorphic streak, spikes, ghost chain, halo.
 * Drawn via scene.js `setPostOverlay` — not a world object.
 */

export function createLensFlare() {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
  )
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)

  const uSun = uniform(new THREE.Vector2(0, 0))
  const uIntensity = uniform(0)
  const uAspect = uniform(1)
  const uTint = uniform(new THREE.Color(0xfff0d8))
  const uLowSun = uniform(0)

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  })

  const blob = Fn(([p, at, radius, power, aspect]) => {
    const d = length(p.sub(at).mul(vec2(aspect, 1))).div(max(radius, float(1e-4)))
    return pow(max(float(0), float(1).sub(d)), power)
  })

  // Ghost table (compile-time constants).
  const GHOSTS = [
    { pos: 0.32, rad: 0.055, amp: 0.3, tint: [1.0, 0.82, 0.55] },
    { pos: 0.62, rad: 0.03, amp: 0.22, tint: [0.55, 0.85, 1.0] },
    { pos: 1.0, rad: 0.09, amp: 0.16, tint: [1.0, 0.55, 0.42] },
    { pos: 1.38, rad: 0.045, amp: 0.2, tint: [0.62, 1.0, 0.72] },
    { pos: 1.72, rad: 0.14, amp: 0.1, tint: [0.72, 0.62, 1.0] },
    { pos: 2.15, rad: 0.07, amp: 0.13, tint: [1.0, 0.95, 0.7] }
  ]

  material.colorNode = Fn(() => {
    // Full-screen triangle stores NDC in position.xy
    const p = positionLocal.xy
    const low = clamp(uLowSun, float(0), float(1))
    const intensity = uIntensity
    let c = vec3(0, 0, 0)

    // Glare on the sun
    c = c.add(
      uTint
        .mul(blob(p, uSun, float(0.09).add(low.mul(0.04)), float(3.2), uAspect))
        .mul(float(0.9).add(low.mul(0.25)))
    )
    c = c.add(
      uTint
        .mul(blob(p, uSun, float(0.38).add(low.mul(0.18)), float(2.1), uAspect))
        .mul(float(0.14).add(low.mul(0.12)))
    )

    // Anamorphic streak
    const d = p.sub(uSun).mul(vec2(uAspect, 1))
    const streak = exp(negate(abs(d.x).mul(float(3).sub(low.mul(0.7))))).mul(
      exp(negate(abs(d.y).mul(float(88).sub(low.mul(18)))))
    )
    const streakTint = mix(vec3(0.55, 0.72, 1.0), uTint.mul(0.9).add(vec3(0.15, 0.08, 0.0)), low)
    c = c.add(streakTint.mul(streak).mul(float(0.48).add(low.mul(0.35))))

    // Diffraction spikes
    const r = length(d)
    const ang = atan(d.y, d.x)
    const spike = pow(max(float(0), abs(cos(ang.mul(3)))), 26)
    c = c.add(uTint.mul(spike).mul(exp(negate(r.mul(7)))).mul(float(0.26).add(low.mul(0.18))))

    // Ghost chain along sun → centre axis
    const axis = negate(uSun)
    for (const g of GHOSTS) {
      const at = uSun.add(axis.mul(g.pos))
      const vig = float(1).sub(smoothstep(float(0.6), float(1.5), length(at)))
      const baseTint = vec3(g.tint[0], g.tint[1], g.tint[2])
      const gt = mix(baseTint, mix(baseTint, uTint, 0.45), low.mul(0.55))
      c = c.add(
        gt
          .mul(blob(p, at, float(g.rad).mul(float(1).add(low.mul(0.12))), float(2), uAspect))
          .mul(g.amp)
          .mul(float(1).add(low.mul(0.35)))
          .mul(vig)
      )
    }

    // Halo ring
    const hr = length(p.sub(uSun.mul(-0.15)).mul(vec2(uAspect, 1)))
    const ring = exp(negate(pow(hr.sub(0.55).mul(7), 2)))
    c = c.add(vec3(0.85, 0.72, 1.0).mul(ring).mul(float(0.1).add(low.mul(0.06))))

    c = c.mul(intensity)
    const a = max(max(c.x, c.y), c.z)
    return vec4(c, a.mul(smoothstep(float(0.001), float(0.01), intensity)))
  })()

  material.uniforms = { uSun, uIntensity, uAspect, uTint, uLowSun }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  const scene = new THREE.Scene()
  scene.add(mesh)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  const _sunWorld = new THREE.Vector3()
  const _sunView = new THREE.Vector3()
  let visible = false

  /**
   * @param {THREE.Camera} cam
   * @param {THREE.Vector3} sunDirection unit vector toward the sun
   * @param {object} opts
   */
  function update(
    cam,
    sunDirection,
    { aspect = 1, color = null, strength = 1, elevation = null } = {}
  ) {
    material.uniforms.uAspect.value = aspect
    if (color) material.uniforms.uTint.value.copy(color)

    const up = THREE.MathUtils.clamp((sunDirection.y + 0.04) / 0.14, 0, 1)
    if (up <= 0 || strength <= 0) {
      material.uniforms.uIntensity.value = 0
      material.uniforms.uLowSun.value = 0
      visible = false
      mesh.visible = false
      return
    }

    const elev = elevation != null ? elevation : sunDirection.y
    material.uniforms.uLowSun.value = THREE.MathUtils.clamp(1 - elev / 0.42, 0, 1)

    cam.updateMatrixWorld(true)
    _sunView.copy(sunDirection).transformDirection(cam.matrixWorldInverse)
    const behind = _sunView.z >= 0

    const reach = Number.isFinite(cam.far) && cam.far > 1 ? cam.far * 0.5 : 1000
    _sunWorld.copy(cam.position).addScaledVector(sunDirection, reach).project(cam)
    material.uniforms.uSun.value.set(_sunWorld.x, _sunWorld.y)

    const edge = Math.max(Math.abs(_sunWorld.x), Math.abs(_sunWorld.y))
    const onScreen = THREE.MathUtils.clamp(1.15 - edge * 0.55, 0, 1)
    const front = behind ? 0 : 1
    material.uniforms.uIntensity.value = strength * up * onScreen * front * 0.85
    visible = material.uniforms.uIntensity.value > 0.004
    mesh.visible = visible
  }

  return {
    scene,
    camera,
    update,
    get visible() {
      return visible
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    }
  }
}
