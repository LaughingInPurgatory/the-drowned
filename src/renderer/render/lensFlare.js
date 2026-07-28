import * as THREE from 'three'

/**
 * Lens flare.
 *
 * Drawn over the formed image after the post chain (scene.js `setPostOverlay`),
 * because a flare is not in the world — it is light bouncing between the
 * elements of the lens you are looking through, which is why the ghosts march
 * along the line from the sun *through the centre of frame* and swing round as
 * you turn. Anything that draws it in world space gets that wrong.
 *
 * Five parts, which is roughly what a real dirty lens gives you:
 *
 *   - **glare**   a tight bloom right on the sun
 *   - **halo**    a faint ring at a fixed radius, the classic iris reflection
 *   - **ghosts**  a chain of coloured discs down the centre line, some inside
 *                 the frame and some past centre on the far side
 *   - **streak**  a horizontal anamorphic smear
 *   - **spikes**  faint diffraction lines off the aperture blades
 *
 * Everything scales with one intensity that the caller fades: the sun sinking,
 * going behind cloud, or leaving the frame should all take the flare with it.
 */

const VERTEX = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAGMENT = `
uniform vec2 uSun;        // sun position in NDC
uniform float uIntensity; // 0 = no flare
uniform float uAspect;
uniform vec3 uTint;
varying vec2 vNdc;

/** Soft radial blob: 1 at the centre, 0 by the given radius. */
float blob(vec2 p, vec2 at, float radius, float power) {
  float d = length((p - at) * vec2(uAspect, 1.0)) / max(radius, 1e-4);
  return pow(max(0.0, 1.0 - d), power);
}

void main() {
  if (uIntensity <= 0.001) discard;

  vec2 p = vNdc;
  // Ghosts run along the line from the sun through the centre of frame.
  vec2 axis = -uSun;
  vec3 c = vec3(0.0);

  // Glare on the sun itself: a tight core plus a wider, softer bloom.
  c += uTint * blob(p, uSun, 0.10, 3.0) * 0.85;
  c += uTint * blob(p, uSun, 0.42, 2.2) * 0.14;

  // Anamorphic streak — wide horizontally, tight vertically.
  {
    vec2 d = (p - uSun) * vec2(uAspect, 1.0);
    float streak = exp(-abs(d.x) * 3.2) * exp(-abs(d.y) * 90.0);
    c += vec3(0.55, 0.72, 1.0) * streak * 0.5;
  }

  // Diffraction spikes off the aperture blades. Faint, and only close in.
  {
    vec2 d = (p - uSun) * vec2(uAspect, 1.0);
    float r = length(d);
    float ang = atan(d.y, d.x);
    float spike = pow(max(0.0, abs(cos(ang * 3.0))), 26.0);
    c += uTint * spike * exp(-r * 7.0) * 0.28;
  }

  // Ghost chain. Each entry is (position along the axis, radius, brightness),
  // with its own tint — the colour fringing is what stops a row of grey discs
  // reading as a bug.
  const int GHOSTS = 6;
  float pos[GHOSTS];
  float rad[GHOSTS];
  float amp[GHOSTS];
  pos[0] = 0.32; rad[0] = 0.055; amp[0] = 0.30;
  pos[1] = 0.62; rad[1] = 0.030; amp[1] = 0.22;
  pos[2] = 1.00; rad[2] = 0.090; amp[2] = 0.16;
  pos[3] = 1.38; rad[3] = 0.045; amp[3] = 0.20;
  pos[4] = 1.72; rad[4] = 0.140; amp[4] = 0.10;
  pos[5] = 2.15; rad[5] = 0.070; amp[5] = 0.13;
  vec3 tints[GHOSTS];
  tints[0] = vec3(1.00, 0.82, 0.55);
  tints[1] = vec3(0.55, 0.85, 1.00);
  tints[2] = vec3(1.00, 0.55, 0.42);
  tints[3] = vec3(0.62, 1.00, 0.72);
  tints[4] = vec3(0.72, 0.62, 1.00);
  tints[5] = vec3(1.00, 0.95, 0.70);
  for (int i = 0; i < GHOSTS; i++) {
    vec2 at = uSun + axis * pos[i];
    // Ghosts dim toward the edge of frame, the way real ones vignette away.
    float vig = 1.0 - smoothstep(0.6, 1.5, length(at));
    c += tints[i] * blob(p, at, rad[i], 2.0) * amp[i] * vig;
  }

  // Halo: a ring centred on the frame, the iris reflected back at fixed radius.
  {
    float r = length((p - uSun * -0.15) * vec2(uAspect, 1.0));
    float ring = exp(-pow((r - 0.55) * 7.0, 2.0));
    c += vec3(0.85, 0.72, 1.0) * ring * 0.10;
  }

  c *= uIntensity;
  float a = max(max(c.r, c.g), c.b);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(c, 1.0);
}
`

/**
 * Create the flare overlay.
 *
 * Returns `{ scene, camera, update(camera, sunDirection, opts), visible }`.
 * Draw it with `renderer.render(flare.scene, flare.camera)` from the post
 * overlay, additively over the finished frame.
 */
export function createLensFlare() {
  // One oversized triangle rather than a quad: no seam down the diagonal, and
  // one fewer vertex to no real benefit but no cost either.
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3)
  )
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10)

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: new THREE.Vector2(0, 0) },
      uIntensity: { value: 0 },
      uAspect: { value: 1 },
      uTint: { value: new THREE.Color(0xfff0d8) }
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  })

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
   * @param {number} opts.aspect viewport width / height
   * @param {THREE.Color} [opts.color] sun colour, so the flare reddens at dusk
   * @param {number} [opts.strength] extra fade — cloud cover, dusk, and so on
   */
  function update(cam, sunDirection, { aspect = 1, color = null, strength = 1 } = {}) {
    material.uniforms.uAspect.value = aspect
    if (color) material.uniforms.uTint.value.copy(color)

    // Below the horizon there is no flare at all.
    const up = THREE.MathUtils.clamp((sunDirection.y + 0.02) / 0.12, 0, 1)
    if (up <= 0 || strength <= 0) {
      material.uniforms.uIntensity.value = 0
      visible = false
      return
    }

    cam.updateMatrixWorld(true)

    // Is the sun in front of us? Taken in view space, where the camera looks
    // down -Z. The obvious shortcut — project a point and test z > 1 — is
    // wrong: that condition is also true for anything beyond the far plane, so
    // a sun placed far enough away to be "at infinity" reads as being behind
    // you and the flare never appears at all.
    _sunView.copy(sunDirection).transformDirection(cam.matrixWorldInverse)
    const behind = _sunView.z >= 0

    // Project a point along the sun direction, comfortably inside the far
    // plane so the projection stays well conditioned.
    const reach = Number.isFinite(cam.far) && cam.far > 1 ? cam.far * 0.5 : 1000
    _sunWorld.copy(cam.position).addScaledVector(sunDirection, reach).project(cam)
    material.uniforms.uSun.value.set(_sunWorld.x, _sunWorld.y)

    // Fade out as the sun leaves the frame rather than cutting: a flare from a
    // sun just off the edge is real, one from a sun behind you is not.
    const offscreen = Math.max(Math.abs(_sunWorld.x), Math.abs(_sunWorld.y))
    const inFrame = 1 - THREE.MathUtils.clamp((offscreen - 1) / 0.6, 0, 1)

    const intensity = behind ? 0 : up * inFrame * strength
    material.uniforms.uIntensity.value = intensity
    visible = intensity > 0.002
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
