import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'

const VIEWMODEL_URL = 'models/fixo/pistol43/source/Glock_Anim.fbx'
const VIEWMODEL_TEXTURE_PATH = 'models/fixo/pistol43/textures/'
const VIEWMODEL_RENDER_ORDER = 100
export const FIXO_VIEWMODEL_LAYER = 2
const REST_POSITION = new THREE.Vector3(-8.0, -0.43, -0.78)
const REST_ROTATION = new THREE.Euler(
  THREE.MathUtils.degToRad(-2),
  0,
  THREE.MathUtils.degToRad(-14)
)
const MODEL_SCALE = 0.01
const MUZZLE_FLASH_DURATION = 0.11
const MUZZLE_SMOKE_DURATION = 0.18
const DAY_FILL_INTENSITY = 0.65
const NIGHT_FILL_INTENSITY = 0.22
const DAY_KEY_INTENSITY = 0.75
const NIGHT_KEY_INTENSITY = 0.14
const _muzzleWorld = new THREE.Vector3()

let assetPromise = null

function loadViewModelTextures() {
  const loader = new THREE.TextureLoader()
  const load = (name, color = false) => loader.loadAsync(`${VIEWMODEL_TEXTURE_PATH}${name}`).then((texture) => {
    if (color) texture.colorSpace = THREE.SRGBColorSpace
    return texture
  })
  return Promise.all([
    load('LP_TEX_Glock_Mat_BaseColor.png', true),
    load('LP_TEX_Glock_Mat_Normal.png'),
    load('LP_TEX_Glock_Mat_Roughness.png'),
    load('LP_TEX_Glock_Mat_Metallic.png'),
    load('Tex_0011_1.png', true),
    load('Tex_0012_1.png', true)
  ]).then(([gunColor, gunNormal, gunRoughness, gunMetalness, arms, gear]) => ({
    gunColor,
    gunNormal,
    gunRoughness,
    gunMetalness,
    arms,
    gear
  }))
}

/** Warm the author's original combined hand/pistol rig while the title is visible. */
export function preloadFixoViewModelAssets() {
  if (!assetPromise) {
    const loader = new FBXLoader()
    loader.setResourcePath(VIEWMODEL_TEXTURE_PATH)
    assetPromise = Promise.all([loader.loadAsync(VIEWMODEL_URL), loadViewModelTextures()]).then(([model, textures]) => ({
      model,
      textures
    })).catch((error) => {
      assetPromise = null
      throw error
    })
  }
  return assetPromise
}

function cloneOwnedAsset(source) {
  const clone = cloneSkeleton(source)
  clone.traverse((object) => {
    if (!object.isMesh) return
    object.geometry = object.geometry.clone()
  })
  return clone
}

function texturedMaterialFor(material, textures) {
  if (material.name === 'Glock_Mat') {
    return new THREE.MeshStandardMaterial({
      name: material.name,
      map: textures.gunColor,
      normalMap: textures.gunNormal,
      roughnessMap: textures.gunRoughness,
      metalnessMap: textures.gunMetalness,
      roughness: 1,
      metalness: 1
    })
  }
  if (material.name === 'Tex_0011_1.dds' || material.name === 'Tex_0012_1.dds') {
    return new THREE.MeshStandardMaterial({
      name: material.name,
      map: material.name === 'Tex_0011_1.dds' ? textures.arms : textures.gear,
      roughness: 0.88,
      metalness: 0
    })
  }
  return material.clone()
}

function prepareModel(source, textures) {
  const model = cloneOwnedAsset(source)
  model.name = 'fixoTacticalFpsRig'
  // Sketchfab authors the view looking down +Z; Three cameras look down -Z.
  model.rotation.y = Math.PI
  model.scale.setScalar(MODEL_SCALE)
  // The FBX carries its author's preview lights and camera. They are useful in
  // a modelling package, but made the hands ignore the game's night lighting.
  const authoringObjects = []
  model.traverse((object) => {
    if (object.isLight || object.isCamera) authoringObjects.push(object)
    if (!object.isMesh) return
    if (object.name === 'BF3') {
      object.visible = false
      return
    }
    object.frustumCulled = false
    object.castShadow = false
    object.receiveShadow = false
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => texturedMaterialFor(material, textures))
      : texturedMaterialFor(object.material, textures)
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    object.renderOrder = VIEWMODEL_RENDER_ORDER
    for (const material of materials) {
      material.depthTest = true
      material.depthWrite = true
      // The viewmodel has its own restrained light rig. Do not let the outdoor
      // environment turn skin and metal white at noon or under the flashlight.
      if ('envMapIntensity' in material) material.envMapIntensity = 0.28
      material.needsUpdate = true
    }
  })
  for (const object of authoringObjects) object.removeFromParent()
  return model
}

function createMuzzleFlashTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  ctx.translate(64, 64)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4)
    const ray = ctx.createLinearGradient(0, 0, 56, 0)
    ray.addColorStop(0, 'rgba(255,245,205,0.95)')
    ray.addColorStop(0.3, 'rgba(255,160,45,0.65)')
    ray.addColorStop(1, 'rgba(255,80,10,0)')
    ctx.fillStyle = ray
    ctx.beginPath()
    ctx.moveTo(0, -5)
    ctx.lineTo(58, 0)
    ctx.lineTo(0, 5)
    ctx.fill()
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 30)
  core.addColorStop(0, 'rgba(255,255,245,1)')
  core.addColorStop(0.25, 'rgba(255,220,120,0.95)')
  core.addColorStop(1, 'rgba(255,95,15,0)')
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(0, 0, 30, 0, Math.PI * 2)
  ctx.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function addMuzzle(root, model) {
  const barrel = model.getObjectByName('Barrel_end') ?? model.getObjectByName('Barrel')
  if (!barrel) throw new Error('Fixo tactical rig is missing its barrel marker')

  const muzzle = new THREE.Object3D()
  muzzle.name = 'fixoPistolMuzzle'
  barrel.add(muzzle)

  // Camera-facing ignition card, anchored to the author's actual barrel-end
  // marker. It stays in the render tree at zero opacity so title warm-up also
  // compiles its sprite pipeline before the first shot.
  const billboardMaterial = new THREE.SpriteMaterial({
    map: createMuzzleFlashTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false
  })
  const billboard = new THREE.Sprite(billboardMaterial)
  billboard.name = 'fixoPistolMuzzleIgnition'
  // FBX/model units are centimetres below MODEL_SCALE.
  billboard.scale.set(15, 15, 1)
  billboard.renderOrder = VIEWMODEL_RENDER_ORDER + 2
  billboard.frustumCulled = false
  muzzle.add(billboard)

  const flash = new THREE.Group()
  flash.name = 'fixoPistolMuzzleFlash'
  flash.visible = false
  root.add(flash)

  const flashMaterial = (color, opacity, blending = THREE.AdditiveBlending) => new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: true,
    depthWrite: false,
    blending,
    side: THREE.DoubleSide,
    toneMapped: false
  })

  // Two tapered flames instead of an orange orb: hot white core, then the
  // wider amber gas envelope. Local -Z is camera-forward for this viewmodel.
  const cone = (radius, length, color, opacity) => {
    // Closed base matters here: the player views the flame almost directly
    // down its axis, where an open cone presents almost no visible surface.
    const geometry = new THREE.ConeGeometry(radius, length, 9)
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, 0, -length * 0.5)
    return new THREE.Mesh(geometry, flashMaterial(color, opacity))
  }
  const outer = cone(0.042, 0.14, 0xff7a18, 0.74)
  const core = cone(0.017, 0.19, 0xfff4cf, 1)

  // A thin irregular crown captures the one-frame radial burst visible in
  // real high-speed footage without turning the flash back into a glowing ball.
  const starShape = new THREE.Shape()
  const points = 16
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const radius = i % 2 ? 0.014 : i % 4 ? 0.043 : 0.066
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    if (i === 0) starShape.moveTo(x, y)
    else starShape.lineTo(x, y)
  }
  starShape.closePath()
  const crown = new THREE.Mesh(new THREE.ShapeGeometry(starShape), flashMaterial(0xffbd52, 0.82))
  crown.position.z = -0.018

  const smoke = new THREE.Group()
  const smokeMaterial = flashMaterial(0x6f747b, 0.22, THREE.NormalBlending)
  smokeMaterial.toneMapped = true
  for (const [x, y, scale] of [[0, 0, 1], [0.018, 0.008, 0.72], [-0.014, 0.015, 0.58]]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.026, 7, 5), smokeMaterial)
    puff.position.set(x, y, 0)
    puff.scale.setScalar(scale)
    smoke.add(puff)
  }
  smoke.position.z = -0.07

  const flashLight = new THREE.PointLight(0xff7a2d, 0, 1.4, 2)
  flash.add(outer, core, crown, smoke, flashLight)
  flash.traverse((object) => {
    object.renderOrder = VIEWMODEL_RENDER_ORDER + 1
    object.frustumCulled = false
  })
  flash.userData.outer = outer
  flash.userData.core = core
  flash.userData.crown = crown
  flash.userData.smoke = smoke
  flash.userData.smokeMaterial = smokeMaterial
  flash.userData.light = flashLight
  flash.userData.billboard = billboard

  root.userData.muzzle = muzzle
  root.userData.muzzleFlash = flash
  root.userData.muzzleFlashTime = Infinity
}

/** Build the authored right-hand, pistol, sleeve and animation as one rig. */
export async function buildFixoPistolViewModel() {
  const asset = await preloadFixoViewModelAssets()
  const root = new THREE.Group()
  root.name = 'fixoPistolViewModel'
  root.position.copy(REST_POSITION)
  root.rotation.copy(REST_ROTATION)
  root.renderOrder = VIEWMODEL_RENDER_ORDER
  root.frustumCulled = false

  const model = prepareModel(asset.model, asset.textures)
  root.add(model)

  const shotClip = THREE.AnimationClip.findByName(asset.model.animations, 'Hands|Shot')
  if (!shotClip) throw new Error('Fixo tactical rig is missing Hands|Shot')
  const mixer = new THREE.AnimationMixer(model)
  mixer.clipAction(shotClip).play()
  mixer.setTime(0)

  root.userData.mixer = mixer
  root.userData.shotDuration = shotClip.duration
  root.userData.shotTime = shotClip.duration
  root.userData.restPosition = REST_POSITION.clone()
  addMuzzle(root, model)

  // Viewmodel-only lighting keeps exposure stable across noon, night and the
  // player's flashlight. These lights share the isolated viewmodel layer, so
  // they never add work or brightness to the world scene.
  const fill = new THREE.HemisphereLight(0xb9c7d8, 0x241b18, DAY_FILL_INTENSITY)
  const key = new THREE.DirectionalLight(0xffe1c4, DAY_KEY_INTENSITY)
  key.position.set(-1.5, 2.4, 1.8)
  key.target.position.set(0, -0.1, -1)
  root.add(fill, key, key.target)
  root.userData.viewModelFill = fill
  root.userData.viewModelKey = key
  root.traverse((object) => object.layers.set(FIXO_VIEWMODEL_LAYER))
  return root
}

function placeMuzzleFlash(root, flash) {
  const muzzle = root.userData.muzzle
  if (!muzzle) return
  muzzle.getWorldPosition(_muzzleWorld)
  root.worldToLocal(_muzzleWorld)
  flash.position.copy(_muzzleWorld)
  flash.position.z -= 0.018
}

export function kickFixoPistolViewModel(root) {
  if (!root) return
  root.userData.shotTime = 0
  root.userData.muzzleFlashTime = 0
  const flash = root.userData.muzzleFlash
  if (flash) {
    placeMuzzleFlash(root, flash)
    flash.visible = true
    flash.rotation.z = Math.random() * Math.PI * 2
    flash.scale.setScalar(0.88 + Math.random() * 0.24)
    if (flash.userData.outer) flash.userData.outer.material.opacity = 0.74
    if (flash.userData.core) flash.userData.core.material.opacity = 1
    if (flash.userData.crown) flash.userData.crown.material.opacity = 0.82
    if (flash.userData.smoke) flash.userData.smoke.visible = false
    if (flash.userData.light) flash.userData.light.intensity = 2.4
    if (flash.userData.billboard) {
      flash.userData.billboard.material.opacity = 1
      flash.userData.billboard.material.rotation = Math.random() * Math.PI * 2
    }
  }
}

/** Advance the authored shot animation and add only a restrained idle drift. */
export function updateFixoPistolViewModel(root, dt, timeSeconds, nightFactor = 0) {
  if (!root) return
  const night = THREE.MathUtils.clamp(Number(nightFactor) || 0, 0, 1)
  if (root.userData.viewModelFill) {
    root.userData.viewModelFill.intensity = THREE.MathUtils.lerp(
      DAY_FILL_INTENSITY,
      NIGHT_FILL_INTENSITY,
      night
    )
  }
  if (root.userData.viewModelKey) {
    root.userData.viewModelKey.intensity = THREE.MathUtils.lerp(
      DAY_KEY_INTENSITY,
      NIGHT_KEY_INTENSITY,
      night
    )
  }
  const duration = Number(root.userData.shotDuration) || 0
  const shotTime = Math.min(duration, (Number(root.userData.shotTime) || 0) + Math.max(0, dt))
  root.userData.shotTime = shotTime
  const poseTime = shotTime < duration ? shotTime : 0
  root.userData.mixer?.setTime(poseTime)

  const breath = Math.sin(timeSeconds * 1.65)
  root.position.copy(root.userData.restPosition ?? REST_POSITION)
  root.position.x += breath * 0.0025
  root.position.y += Math.cos(timeSeconds * 1.2) * 0.002
  root.rotation.copy(REST_ROTATION)

  const flash = root.userData.muzzleFlash
  if (!flash) return
  const flashTime = (Number(root.userData.muzzleFlashTime) || 0) + Math.max(0, dt)
  root.userData.muzzleFlashTime = flashTime
  if (flashTime >= MUZZLE_SMOKE_DURATION) {
    flash.visible = false
    flash.userData.light.intensity = 0
    if (flash.userData.billboard) flash.userData.billboard.material.opacity = 0
    return
  }

  // Keep the effect on the animated barrel while orienting it toward the
  // centre ray, independent of the imported FBX bone-axis convention.
  placeMuzzleFlash(root, flash)

  const flame = Math.max(0, 1 - flashTime / MUZZLE_FLASH_DURATION)
  flash.userData.outer.material.opacity = 0.74 * flame
  flash.userData.core.material.opacity = flame
  flash.userData.crown.material.opacity = 0.82 * flame
  if (flash.userData.billboard) flash.userData.billboard.material.opacity = flame
  flash.userData.outer.scale.set(1 + flashTime * 4, 1 + flashTime * 4, 0.9 + flame * 0.35)
  flash.userData.core.scale.set(1, 1, 0.8 + flame * 0.45)
  flash.userData.crown.scale.setScalar(0.85 + (1 - flame) * 0.65)
  flash.userData.light.intensity = 2.4 * flame

  const smokeT = Math.min(1, flashTime / MUZZLE_SMOKE_DURATION)
  flash.userData.smoke.visible = flashTime > 0.018
  flash.userData.smoke.position.z = -0.07 - smokeT * 0.08
  flash.userData.smoke.scale.setScalar(0.65 + smokeT * 1.35)
  flash.userData.smokeMaterial.opacity = Math.sin(smokeT * Math.PI) * 0.18
}
