import * as THREE from 'three'
import { makeSearchlightBeamMaterial, makeSearchlightCookie } from './shipMesh.js'

/** Small handheld beam used by the on-foot survivor. */
export function buildPlayerFlashlight({ beamLen = 26, farRadius = 1.35 } = {}) {
  const root = new THREE.Group()
  root.name = 'playerFlashlight'

  const housing = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xfff4d7, toneMapped: false })
  )
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 8, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffdf9b,
      transparent: true,
      opacity: 0.38,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  )
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(farRadius, 0.014, beamLen, 16, 1, true),
    makeSearchlightBeamMaterial(beamLen)
  )
  beam.rotation.x = Math.PI / 2
  beam.position.z = beamLen * 0.5
  beam.renderOrder = 2
  beam.frustumCulled = false
  root.add(housing, glow, beam)

  const spot = new THREE.SpotLight(0xfff4df, 0, 500, 0.22, 0.7, 1.25)
  spot.map = makeSearchlightCookie()
  spot.visible = true
  spot.castShadow = false
  root.add(spot)
  spot.target.position.z = 28
  root.add(spot.target)

  housing.visible = false
  glow.visible = false
  beam.visible = false
  return { root, housing, glow, beam, spot, enabled: false }
}

export function setPlayerFlashlightOn(flashlight, on) {
  if (!flashlight) return false
  const enabled = !!on
  flashlight.enabled = enabled
  // The lamp is worn beside the player's head and sits outside first-person
  // view; only its projected beam should be visible.
  flashlight.housing.visible = false
  flashlight.glow.visible = false
  flashlight.beam.visible = false
  if (flashlight.beam.material?.uniforms?.uOpacity) {
    flashlight.beam.material.uniforms.uOpacity.value = 0
  }
  flashlight.spot.intensity = enabled ? 35000 : 0
  flashlight.spot.visible = true
  return enabled
}
