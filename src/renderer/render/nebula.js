import * as THREE from 'three'

// A soft radial-gradient sprite, generated once via Canvas 2D (no image
// assets/textures anywhere else in the codebase, so this stays consistent —
// just a procedural circle instead of a procedural vertex-color pattern).
export function buildCloudTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

const NEBULA_HUES = [270, 205, 320, 190, 15, 350]

// Camera far plane is 2e6 (scene.js). A sprite centred beyond it is culled
// outright, so it would pop in and out as the camera moves. Cluster centre +
// puff scatter can otherwise reach ~2.3e6, so every sprite gets pulled back
// inside this radius after placement.
const MAX_SPRITE_DIST = 1_850_000
function clampToFarPlane(sprite) {
  const d = sprite.position.length()
  if (d > MAX_SPRITE_DIST) sprite.position.multiplyScalar(MAX_SPRITE_DIST / d)
}

// A handful of large, softly-glowing sprite clusters scattered around a few
// centers (rather than one uniform haze) so it reads as wispy cosmic dust
// clouds. Not seeded off the galaxy PRNG — this is a fixed decorative
// backdrop, same convention as starfield.js's plain Math.random().
export function createNebula(clusterCount = 15, puffsPerCluster = 22) {
  const texture = buildCloudTexture()
  const group = new THREE.Group()

  for (let c = 0; c < clusterCount; c++) {
    const hue = NEBULA_HUES[c % NEBULA_HUES.length]
    // Nebula is re-centered on the camera each frame (main.js) like the starfield.
    // Sit far past system play volume (~100k–600k) so depthTest keeps it behind
    // suns/planets, but inside the far plane (2e6).
    const angle = Math.random() * Math.PI * 2
    // Pushed out toward the far plane (2e6). Growing the clouds without also
    // moving them back just makes each one subtend more sky until it stops
    // reading as a cloud and becomes a coloured wash over everything.
    const centerDist = 1_300_000 + Math.random() * 600_000
    const center = new THREE.Vector3(Math.cos(angle) * centerDist, (Math.random() - 0.5) * 320_000, Math.sin(angle) * centerDist)
    // Per-cluster size multiplier, applied to both the puff scale and how far
    // puffs scatter — without it every cluster ends up the same apparent size
    // and the sky reads as nine interchangeable smudges. Wide range so a few
    // clusters dominate the sky and others are distant wisps.
    const clusterScale = 0.7 + Math.random() * 2.3

    for (let i = 0; i < puffsPerCluster; i++) {
      // Hue drifts slightly per puff (real emission nebulae aren't one flat
      // color), and each puff is stretched into a randomly-rotated ellipse —
      // overlapping elongated wisps at different angles read as filamentary
      // gas structure instead of a pile of circles.
      // Desaturated and darker than before: at 0.55–0.8 saturation the purple
      // and magenta hues read as coloured stage lighting washing over the whole
      // sky rather than distant gas, and additive stacking only intensifies it.
      const color = new THREE.Color().setHSL(((hue + (Math.random() - 0.5) * 40) % 360) / 360, 0.28 + Math.random() * 0.22, 0.32 + Math.random() * 0.12)
      const material = new THREE.SpriteMaterial({
        map: texture,
        color,
        transparent: true,
        // 20 puffs per cluster overlap heavily, and additive stacking pushed
        // the cluster cores past 1.0 — where they read as solid coloured blobs
        // sitting on top of the starfield instead of dust behind it (and now
        // trip the bloom threshold). Bigger clusters overlap more, so fade
        // per-puff opacity as the cluster grows or scaling one up just makes a
        // brighter wash instead of a wider, softer one.
        opacity: (0.016 + Math.random() * 0.026) / clusterScale,
        rotation: Math.random() * Math.PI * 2,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending
      })
      const sprite = new THREE.Sprite(material)
      // Spread grows slower than size (sqrt), or a large cluster stops being a
      // cluster and scatters its puffs right around the camera.
      const spread = Math.sqrt(clusterScale)
      sprite.position.set(
        center.x + (Math.random() - 0.5) * 240_000 * spread,
        center.y + (Math.random() - 0.5) * 110_000 * spread,
        center.z + (Math.random() - 0.5) * 240_000 * spread
      )
      // Scale with distance so angular size stays similar to the old close nebula.
      const scale = (150_000 + Math.random() * 260_000) * clusterScale
      clampToFarPlane(sprite)
      sprite.scale.set(scale * (1.4 + Math.random() * 1.2), scale * (0.4 + Math.random() * 0.5), 1)
      sprite.renderOrder = -90
      group.add(sprite)
    }
  }

  // A few huge, extremely faint neutral-grey veils spread wide — the "cosmic
  // dust" haze between the colored clusters, barely perceptible individually
  // but together they kill the pure-black emptiness between nebulae.
  for (let i = 0; i < 8; i++) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color().setHSL(220 / 360, 0.15, 0.5),
      transparent: true,
      opacity: 0.02 + Math.random() * 0.02,
      rotation: Math.random() * Math.PI * 2,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    })
    const sprite = new THREE.Sprite(material)
    const angle = Math.random() * Math.PI * 2
    const dist = 1_000_000 + Math.random() * 400_000
    sprite.position.set(Math.cos(angle) * dist, (Math.random() - 0.5) * 250_000, Math.sin(angle) * dist)
    clampToFarPlane(sprite)
    sprite.scale.set(350_000 + Math.random() * 200_000, 120_000 + Math.random() * 90_000, 1)
    sprite.renderOrder = -90
    group.add(sprite)
  }

  // ── Cosmic dust ──────────────────────────────────────────────────────────
  // Many small, very faint motes spread through the volume BETWEEN the coloured
  // clusters and the starfield shell. Individually invisible; collectively they
  // give deep space a sense of depth and grain instead of a clean black gap
  // between "nebula" and "stars". Deliberately near-neutral and low-opacity so
  // this reads as dust catching light, never as more coloured cloud.
  for (let i = 0; i < 260; i++) {
    // Cool grey-blue through faint dusty ochre — no saturated hues.
    const warm = Math.random() < 0.35
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: new THREE.Color().setHSL(
        warm ? (28 + Math.random() * 18) / 360 : (205 + Math.random() * 25) / 360,
        0.12 + Math.random() * 0.16,
        0.3 + Math.random() * 0.18
      ),
      transparent: true,
      opacity: 0.012 + Math.random() * 0.03,
      rotation: Math.random() * Math.PI * 2,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending
    })
    const sprite = new THREE.Sprite(material)
    const angle = Math.random() * Math.PI * 2
    // Spread across the full depth range so motes never all sit on one shell.
    const dist = 500_000 + Math.random() * 1_300_000
    sprite.position.set(
      Math.cos(angle) * dist,
      (Math.random() - 0.5) * 700_000,
      Math.sin(angle) * dist
    )
    clampToFarPlane(sprite)
    const s = 30_000 + Math.random() * 120_000
    sprite.scale.set(s * (1 + Math.random()), s * (0.5 + Math.random() * 0.7), 1)
    sprite.renderOrder = -90
    group.add(sprite)
  }

  group.userData.spinSpeed = 0.006
  group.renderOrder = -90
  return group
}

// Slow drift so the clouds read as swirling rather than a static painting —
// driven by dt like everything else (see updateStarMesh), not wall-clock time.
export function updateNebula(nebula, dt) {
  nebula.rotation.y += nebula.userData.spinSpeed * dt
}
