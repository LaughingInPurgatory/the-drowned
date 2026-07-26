import * as THREE from 'three'
import { stationMaterialMaps } from './textures.js'

/**
 * Warp gate: ring-station structure with a hollow aperture
 * and spatial distortion in the middle. Unit radius ≈ 1; scaled by body.radius.
 * Local +Z is the portal axis (faces system origin when oriented).
 */

function glowTexture(coreRgba, midRgba, edgeRgba) {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, coreRgba)
  g.addColorStop(0.28, midRgba)
  g.addColorStop(0.62, edgeRgba)
  g.addColorStop(1, 'rgba(20,8,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Worn industrial plating — technical sci-fi, aged and scored.
 * Uses shared station PBR maps with muted tints + high roughness.
 */
function wornMetalMat(color, maps, { metalness = 0.55, roughness = 0.78, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive,
    emissiveIntensity,
    flatShading: false,
    ...maps
  })
}

function plainMetalMat(color, { metalness = 0.85, roughness = 0.42, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive,
    emissiveIntensity,
    flatShading: false
  })
}

function addMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  })
}

/** Soft-edged module: capsule + slight squash (rounded, not boxy). */
function makeModuleMesh(r, mat) {
  const g = new THREE.Group()
  // Capsule reads as a rounded hardpoint without going fully organic.
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(r * 0.075, r * 0.14, 4, 8),
    mat
  )
  body.scale.set(1.15, 0.95, 1.35)
  g.add(body)
  return g
}

/**
 * @param {object|null} body
 */
export function buildWarpGateMesh(body = null) {
  const group = new THREE.Group()
  group.userData.kind = 'warpGate'
  group.userData.bodyId = body?.id ?? null

  const r = 1
  // Plates + darkmetal: scored hull and soot-dark understructure.
  const plateMaps = stationMaterialMaps('panel', 0.72)
  const darkMaps = stationMaterialMaps('floor', 0.85)
  const armorMaps = stationMaterialMaps('shipArmor', 0.65)

  const hull = wornMetalMat(0x7a828c, plateMaps, { metalness: 0.48, roughness: 0.82 })
  const dark = wornMetalMat(0x3a4048, darkMaps, { metalness: 0.42, roughness: 0.88 })
  const accent = wornMetalMat(0x6a5a50, armorMaps, {
    metalness: 0.5,
    roughness: 0.72,
    emissive: 0x201208,
    emissiveIntensity: 0.12
  })
  // Edge beacons — deep red, pulsed in updateWarpGateMesh.
  const lightMat = plainMetalMat(0xff6040, {
    metalness: 0.15,
    roughness: 0.4,
    emissive: 0xff2200,
    emissiveIntensity: 1.1
  })

  // Main structural torus (station ring) — worn plated surface.
  const mainRing = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, r * 0.11, 16, 72), hull)
  group.add(mainRing)

  // Inner track (rail around aperture).
  const innerTrack = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.035, 10, 64), accent)
  group.add(innerTrack)

  // Outer armor lip — darker soot-stained metal.
  const outerLip = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * 0.045, 10, 64), dark)
  group.add(outerLip)

  // Secondary scar ring (thin) for technical detail.
  const scarRing = new THREE.Mesh(new THREE.TorusGeometry(r * 0.98, r * 0.018, 8, 64), dark)
  group.add(scarRing)

  // Hab / module pods around the ring — slightly rounded, not hard boxes.
  const modules = new THREE.Group()
  modules.userData.spin = 0.035
  const moduleCount = 10
  const beacons = []
  for (let i = 0; i < moduleCount; i++) {
    const ang = (i / moduleCount) * Math.PI * 2
    const pod = makeModuleMesh(r, i % 3 === 0 ? accent : hull)
    const rr = r * 0.92
    pod.position.set(Math.cos(ang) * rr, Math.sin(ang) * rr, 0)
    pod.lookAt(0, 0, 0)
    pod.rotateX(Math.PI / 2)
    pod.position.multiplyScalar(1.08)
    modules.add(pod)

    // Red pulse beacons between modules.
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(r * 0.032, 10, 10), lightMat.clone())
    const br = r * 1.04
    beacon.position.set(
      Math.cos(ang + Math.PI / moduleCount) * br,
      Math.sin(ang + Math.PI / moduleCount) * br,
      r * 0.06
    )
    beacon.userData.beaconPhase = ang
    beacon.userData.redBeacon = true
    modules.add(beacon)
    beacons.push(beacon)
  }
  group.add(modules)

  // Cross struts — cylinders already round.
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2 + Math.PI / 8
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.028, r * 0.022, r * 0.55, 8), dark)
    strut.position.set(Math.cos(ang) * r * 0.45, Math.sin(ang) * r * 0.45, 0)
    strut.lookAt(0, 0, 0)
    strut.rotateX(Math.PI / 2)
    group.add(strut)
  }

  // Control spine — capsule stack (soft corners).
  const spine = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.09, r * 0.38, 4, 8), hull)
  spine.position.set(0, r * 0.98, 0)
  group.add(spine)
  const spineCap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 12, 10), accent)
  spineCap.scale.set(1.2, 0.7, 1.2)
  spineCap.position.set(0, r * 1.28, 0)
  group.add(spineCap)

  // ——— Aperture disc — yellow / orange energy well ———
  const discGeo = new THREE.CircleGeometry(r * 0.68, 64)
  const discMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 1 }
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        float rad = length(p.xy);
        float ang = atan(p.y, p.x);
        p.z += sin(rad * 16.0 - uTime * 5.0) * 0.04 * (1.0 - rad);
        p.x += cos(ang * 5.0 + uTime * 2.2) * 0.02 * rad;
        p.y += sin(ang * 4.0 - uTime * 1.8) * 0.02 * rad;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec2 vUv;
      uniform float uTime;
      uniform float uPulse;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        float a = atan(c.y, c.x);
        float swirl = sin(a * 7.0 + r * 11.0 - uTime * 4.0);
        float rings = 0.5 + 0.5 * sin(r * 26.0 - uTime * 6.5);
        float flicker = 0.85 + 0.15 * sin(uTime * 17.0 + a * 3.0);
        float core = smoothstep(1.05, 0.06, r);
        float rim = smoothstep(1.0, 0.72, r) * smoothstep(0.4, 0.9, r);
        // Amber / molten orange well
        vec3 deep = vec3(0.35, 0.06, 0.0);
        vec3 mid = vec3(1.0, 0.42, 0.05);
        vec3 hot = vec3(1.0, 0.92, 0.45);
        vec3 col = mix(deep, mid, core * (0.5 + 0.5 * swirl));
        col = mix(col, hot, rings * 0.45 * core * flicker);
        float alpha = core * (0.5 + 0.35 * rings + 0.2 * swirl) * uPulse * flicker;
        alpha += rim * 0.75 * uPulse;
        alpha *= smoothstep(1.08, 0.86, r);
        gl_FragColor = vec4(col * (0.8 + 0.5 * uPulse), clamp(alpha, 0.0, 1.0));
      }
    `
  })
  const disc = new THREE.Mesh(discGeo, discMat)
  disc.userData.distortion = true
  group.add(disc)

  // Soft aperture corona — amber.
  const glowMap = glowTexture(
    'rgba(255,240,180,1)',
    'rgba(255,140,40,0.75)',
    'rgba(180,50,0,0.3)'
  )
  const corona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xffaa40,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  corona.scale.set(2.4, 2.4, 1)
  corona.userData.corona = true
  group.add(corona)

  // Aperture rim light ring (warm).
  const rimGlow = new THREE.Mesh(new THREE.TorusGeometry(r * 0.68, r * 0.022, 8, 48), addMat(0xff9020, 0.7))
  rimGlow.userData.spin = 0.55
  group.add(rimGlow)

  // Heat haze shell — soft limb fade so the sphere silhouette dissolves.
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 1 }
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      uniform float uTime;
      void main() {
        vLocal = position;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        // Soft wobble for heat-haze (keep amplitude low so edges don't crawl hard).
        vec3 p = position;
        float wob =
          sin(uTime * 2.8 + position.x * 6.0 + position.y * 5.0) * 0.008 +
          cos(uTime * 3.4 + position.z * 7.0 + position.y * 4.0) * 0.006;
        p += normal * wob;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vLocal;
      uniform float uTime;
      uniform float uPulse;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(vNormal);
        vec3 v = normalize(vView);
        float ndotv = abs(dot(n, v));
        // Grazing angle 0..1 (0 = face-on, 1 = silhouette).
        float graze = 1.0 - ndotv;
        // Soft rim band: rises then falls before the hard sphere limb.
        float rim = smoothstep(0.08, 0.42, graze) * smoothstep(0.98, 0.52, graze);
        rim = pow(rim, 1.15);
        // Break up the perfect sphere with low-frequency shimmer (not harsh noise).
        float ang = atan(vLocal.y, vLocal.x);
        float shimmer =
          0.55 + 0.45 * sin(uTime * 3.2 + ang * 3.0 + vLocal.z * 8.0) *
          sin(uTime * 2.1 + length(vLocal.xy) * 10.0);
        float band = 0.5 + 0.5 * sin(uTime * 5.5 + graze * 9.0 + ang * 2.0);
        vec3 col = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.82, 0.38), band * shimmer);
        // Low peak alpha + rim falloff = dissolves into the scene.
        float a = rim * (0.055 + 0.05 * band) * shimmer * uPulse;
        // Extra fade when nearly face-on or at extreme edge.
        a *= smoothstep(0.05, 0.22, graze);
        if (a < 0.004) discard;
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.22));
      }
    `
  })
  const haze = new THREE.Mesh(new THREE.SphereGeometry(r * 1.48, 36, 24), hazeMat)
  haze.userData.heatHaze = true
  group.add(haze)

  // Outer heat corona sprite — wide soft bloom (already radial-faded texture).
  const heatCorona = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      color: 0xff7020,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  )
  heatCorona.scale.set(4.2, 4.2, 1)
  heatCorona.userData.heatCorona = true
  group.add(heatCorona)

  // Static discharge arcs — thin additive segments (updated each frame).
  const arcGroup = new THREE.Group()
  arcGroup.userData.discharges = true
  const ARC_COUNT = 8
  const arcs = []
  for (let i = 0; i < ARC_COUNT; i++) {
    const geo = new THREE.BufferGeometry()
    const pts = 7
    const positions = new Float32Array(pts * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: 0xffe080,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    )
    line.userData.arc = {
      phase: Math.random() * Math.PI * 2,
      period: 0.35 + Math.random() * 0.55,
      life: 0,
      active: false
    }
    arcGroup.add(line)
    arcs.push(line)
  }
  group.add(arcGroup)
  group.userData.arcs = arcs

  // Orbiting energy motes — amber sparks.
  const emberCount = 48
  const emberGeo = new THREE.BufferGeometry()
  const positions = new Float32Array(emberCount * 3)
  const phases = new Float32Array(emberCount)
  for (let i = 0; i < emberCount; i++) {
    const t = (i / emberCount) * Math.PI * 2
    const rr = 0.52 + (i % 5) * 0.04
    positions[i * 3] = Math.cos(t) * rr
    positions[i * 3 + 1] = Math.sin(t) * rr
    positions[i * 3 + 2] = 0
    phases[i] = t
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  emberGeo.setAttribute('phase', new THREE.BufferAttribute(phases, 1))
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({
      color: 0xffc060,
      size: 0.055,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    })
  )
  embers.userData.embers = true
  group.add(embers)

  group.userData.baseScale = body?.radius ?? 140
  group.scale.setScalar(group.userData.baseScale)
  group.userData.modules = modules
  group.userData.beacons = beacons

  return group
}

/** Aim portal +Z toward system origin. */
export function orientWarpGateTowardOrigin(mesh, position) {
  if (!mesh || !position) return
  const from = new THREE.Vector3().fromArray(position)
  const to = new THREE.Vector3(0, 0, 0)
  const dir = to.clone().sub(from)
  if (dir.lengthSq() < 1e-8) return
  dir.normalize()
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
  mesh.quaternion.copy(quat)
  const up = new THREE.Vector3(0, 1, 0)
  const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion)
  const yDesired = up.clone().sub(zAxis.clone().multiplyScalar(up.dot(zAxis)))
  if (yDesired.lengthSq() > 1e-6) {
    yDesired.normalize()
    const yNow = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion)
    const align = new THREE.Quaternion().setFromUnitVectors(yNow, yDesired)
    mesh.quaternion.premultiply(align)
  }
}

function fillDischargeArc(line, t) {
  const data = line.userData.arc
  if (!data?.active) {
    line.material.opacity = 0
    return
  }
  const pos = line.geometry.attributes.position
  const n = pos.count
  // From a random rim point outward into space (local gate space).
  const a0 = data.a0
  const a1 = data.a1
  const r0 = 0.7
  const r1 = 1.15 + data.reach
  const zJit = data.zSign * (0.08 + data.reach * 0.12)
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    const ang = a0 + (a1 - a0) * u
    const rr = r0 + (r1 - r0) * u
    // Jagged polyline — static crackle.
    const jag = (Math.sin(u * 19.0 + t * 40.0 + data.phase) + Math.sin(u * 31.0 - t * 55.0)) * 0.035 * (1 - u * 0.3)
    const j2 = Math.cos(u * 23.0 + t * 33.0) * 0.028 * (1 - u)
    pos.setXYZ(
      i,
      Math.cos(ang) * rr + jag,
      Math.sin(ang) * rr + j2,
      zJit * u + Math.sin(u * 12 + t * 28) * 0.04
    )
  }
  pos.needsUpdate = true
  // Bright flash then fade.
  const lifeT = data.life / data.period
  const flash = lifeT < 0.15 ? lifeT / 0.15 : 1 - (lifeT - 0.15) / 0.85
  line.material.opacity = Math.max(0, flash) * 0.95
  line.material.color.setHex(lifeT < 0.2 ? 0xfff0c0 : 0xffb040)
}

export function updateWarpGateMesh(mesh, dt, simTime = 0) {
  if (!mesh) return
  const t = simTime
  // Stronger, irregular red pulse.
  const pulse = 0.75 + 0.25 * Math.sin(t * 3.1) * Math.sin(t * 1.7)
  const redPulse = 0.45 + 0.55 * Math.max(0, Math.sin(t * 4.2)) ** 2

  mesh.traverse((child) => {
    if (child.userData?.spin) {
      child.rotation.z += child.userData.spin * dt
    }
    if (child.userData?.distortion && child.material?.uniforms) {
      child.material.uniforms.uTime.value = t
      child.material.uniforms.uPulse.value = pulse
    }
    if (child.userData?.heatHaze && child.material?.uniforms) {
      child.material.uniforms.uTime.value = t
      child.material.uniforms.uPulse.value = 0.85 + 0.15 * Math.sin(t * 2.8)
      child.rotation.y += dt * 0.08
      child.rotation.x = Math.sin(t * 0.7) * 0.04
    }
    if (child.userData?.corona) {
      const s = 2.15 + 0.32 * Math.sin(t * 2.1)
      child.scale.set(s, s, 1)
      if (child.material) child.material.opacity = 0.42 + 0.28 * pulse
    }
    if (child.userData?.heatCorona) {
      const s = 3.9 + 0.35 * Math.sin(t * 1.4 + 1.0)
      child.scale.set(s, s, 1)
      if (child.material) child.material.opacity = 0.1 + 0.1 * pulse
    }
    if (child.userData?.redBeacon && child.material) {
      const phase = child.userData.beaconPhase ?? 0
      // Staggered red blink / pulse around the ring.
      const p = 0.25 + 0.75 * Math.max(0, Math.sin(t * 5.5 + phase * 1.7)) ** 3
      child.material.emissiveIntensity = 0.35 + p * 1.4 * redPulse
      child.material.color.setHex(0xff5030)
      child.material.emissive.setHex(0xff1800)
      const sc = 0.9 + p * 0.35
      child.scale.setScalar(sc)
    }
    if (child.userData?.embers) {
      const pos = child.geometry.attributes.position
      const phase = child.geometry.attributes.phase
      for (let i = 0; i < pos.count; i++) {
        const p = phase.getX(i) + t * (0.65 + (i % 5) * 0.05)
        const rr = 0.52 + (i % 5) * 0.04
        // Occasional outward spit (static discharge motes).
        const spit = Math.max(0, Math.sin(t * 9 + i * 1.7)) ** 8 * 0.12
        pos.setXYZ(
          i,
          Math.cos(p) * (rr + spit),
          Math.sin(p) * (rr + spit),
          Math.sin(p * 3 + t * 1.4) * 0.07 + spit * 0.2
        )
      }
      pos.needsUpdate = true
    }
  })

  // Static discharges — random arcs from rim into space.
  const arcs = mesh.userData.arcs
  if (arcs?.length) {
    for (const line of arcs) {
      const data = line.userData.arc
      if (!data) continue
      data.life += dt
      if (!data.active) {
        // Chance to fire a new arc.
        if (Math.random() < dt * 2.8) {
          data.active = true
          data.life = 0
          data.period = 0.12 + Math.random() * 0.22
          data.a0 = Math.random() * Math.PI * 2
          data.a1 = data.a0 + (Math.random() - 0.5) * 0.9
          data.reach = 0.15 + Math.random() * 0.55
          data.zSign = Math.random() < 0.5 ? -1 : 1
          data.phase = Math.random() * 10
        }
      } else if (data.life >= data.period) {
        data.active = false
        line.material.opacity = 0
      }
      fillDischargeArc(line, t)
    }
  }

  if (mesh.userData.modules?.userData?.spin) {
    mesh.userData.modules.rotation.z += mesh.userData.modules.userData.spin * dt
  }
}
