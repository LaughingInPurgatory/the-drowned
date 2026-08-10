import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  updateTurretAim,
  aimTurretAt,
  turretDirection,
  turretAimPoint,
  turretMuzzleWorld,
  turretMountLocal,
  crosshairSightlineEnd,
  centreTurret,
  TURRET_MAX_TRAVERSE,
  TURRET_MIN_PITCH,
  TURRET_MAX_PITCH
} from './turret.js'
import { updateFlight } from './flight.js'
import { getShipClass, STARTER_SHIP_CLASS_ID } from '../data/shipClasses.js'

function ship(heading = 0) {
  return { position: [0, 0, 0], velocity: [0, 0, 0], quaternion: [0, 0, 0, 1], heading }
}

const cls = () => getShipClass(STARTER_SHIP_CLASS_ID)

test('close surface convergence stays beneath the displayed crosshair', () => {
  const camera = new THREE.Vector3(0, 12, -20)
  const displayedAim = new THREE.Vector3(3, 5, 100)
  const end = crosshairSightlineEnd(camera, displayedAim, 500, new THREE.Vector3())
  const reticleRay = displayedAim.clone().sub(camera).normalize()
  const resolvedRay = end.clone().sub(camera).normalize()
  assert.ok(reticleRay.distanceTo(resolvedRay) < 1e-9)
  assert.ok(Math.abs(end.distanceTo(camera) - 500) < 1e-9)
})

test('the mouse lays the turret and nothing else touches the hull', () => {
  const s = ship()
  const mouse = { dx: 120, dy: -40 }
  updateTurretAim(s, mouse)
  assert.ok(s.turretYaw !== 0, 'traverse should respond to horizontal movement')
  assert.ok(s.turretPitch > 0, 'a push forward should elevate')
  assert.equal(s.heading, 0, 'laying the guns must not turn the boat')
  assert.deepEqual(mouse, { dx: 0, dy: 0 }, 'the delta must be consumed, not left to pile up')
})

test('mouse right trains to starboard', () => {
  // Same convention as the chase camera and the radar: hull +X is screen-left,
  // so a screen-right lay is negative yaw.
  const s = ship()
  updateTurretAim(s, { dx: 200, dy: 0 })
  assert.ok(s.turretYaw < 0, 'mouse right should train to starboard')
  const dir = turretDirection(s, new THREE.Vector3())
  assert.ok(dir.x < 0, 'and the barrel should point that way in world space')
})

test('elevation is clamped; traverse free-spins a full 360°', () => {
  const s = ship()
  for (let i = 0; i < 200; i++) updateTurretAim(s, { dx: -400, dy: -400 })
  // Yaw stays normalised to (-π, π] — never stuck at a hard stop.
  assert.ok(Math.abs(s.turretYaw) <= Math.PI + 1e-9)
  assert.ok(s.turretPitch <= TURRET_MAX_PITCH + 1e-9)

  const t = ship()
  for (let i = 0; i < 200; i++) updateTurretAim(t, { dx: 400, dy: 400 })
  assert.ok(Math.abs(t.turretYaw) <= Math.PI + 1e-9)
  assert.ok(t.turretPitch >= TURRET_MIN_PITCH - 1e-9)

  // Continuous spin: further mouse still changes bearing (no ±π clamp).
  const a = s.turretYaw
  updateTurretAim(s, { dx: -80, dy: 0 })
  assert.notEqual(s.turretYaw, a, 'traverse must keep spinning past dead aft')
})

test('the mount can elevate high enough to engage something in the air', () => {
  // The whole reason the gun has a pitch axis at all.
  assert.ok(TURRET_MAX_PITCH > 0.8, `only ${TURRET_MAX_PITCH} rad of elevation`)
  const s = ship()
  for (let i = 0; i < 200; i++) updateTurretAim(s, { dx: 0, dy: -400 })
  const dir = turretDirection(s, new THREE.Vector3())
  assert.ok(dir.y > 0.6, `barrel only reaches y=${dir.y.toFixed(2)} at full elevation`)
})

test('bearing is held relative to the hull, so the boat turns under the guns', () => {
  // A turret stays trained where the gunner put it while the ship manoeuvres.
  // Storing an absolute bearing would make it swing with every course change.
  const shipClass = cls()
  const s = ship()
  updateTurretAim(s, { dx: 150, dy: 0 })
  const laid = s.turretYaw

  for (let i = 0; i < 90; i++) updateFlight(s, shipClass, new Set(['KeyW', 'KeyA']), 1 / 60)
  assert.equal(s.turretYaw, laid, 'relative bearing must survive a course change')
  assert.ok(Math.abs(s.heading) > 0.01, 'the boat really did turn')
})

test('aimTurretAt lays the mount onto a world point', () => {
  const s = ship()
  // Dead abeam to starboard (-X), slightly above.
  aimTurretAt(s, [-100, 20, 0])
  const dir = turretDirection(s, new THREE.Vector3())
  assert.ok(dir.x < -0.7, 'should be looking to starboard')
  assert.ok(dir.y > 0.05, 'and elevated onto the target')
})

test('aimTurretAt can train dead aft (full 360° traverse)', () => {
  const s = ship()
  aimTurretAt(s, [0, 0, -500]) // dead astern
  assert.ok(Math.abs(s.turretYaw) >= Math.PI * 0.9, 'should nearly reverse onto the stern')
  assert.ok(Math.abs(s.turretYaw) <= Math.PI + 1e-9)
})

test('the muzzle sits at the end of the barrel, above the waterline', () => {
  const shipClass = cls()
  const s = ship()
  const mount = turretMountLocal(shipClass)
  const muzzle = turretMuzzleWorld(s, shipClass, new THREE.Vector3())
  assert.ok(muzzle.y > 0, 'a gun does not fire from under the sea')
  assert.ok(muzzle.z > 0, 'the mount is forward of amidships')
  // Trained dead ahead, the muzzle should be about a barrel ahead of the mount.
  assert.ok(
    Math.abs(muzzle.z - (mount.z + mount.barrel)) < 1e-6,
    'muzzle should be one barrel length ahead of the trunnion'
  )
})

test('the aim point is straight out along the barrel', () => {
  const shipClass = cls()
  const s = ship()
  updateTurretAim(s, { dx: 90, dy: -30 })
  const muzzle = turretMuzzleWorld(s, shipClass, new THREE.Vector3())
  const aim = turretAimPoint(s, shipClass, new THREE.Vector3())
  const dir = turretDirection(s, new THREE.Vector3())
  const toAim = aim.clone().sub(muzzle).normalize()
  assert.ok(toAim.distanceTo(dir) < 1e-6, 'the crosshair must sit on the gun line')
})

test('aim ignores wave tilt so the crosshair does not ride the swell', () => {
  // The mount is stabilised. If aim were taken from the hull quaternion the
  // reticle would bob up and down the screen with every wave, and the fall of
  // shot with it.
  const shipClass = cls()
  const level = ship()
  const pitched = ship()
  pitched.quaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(0.3, 0, 0.4, 'YXZ'))
    .toArray()

  const a = turretAimPoint(level, shipClass, new THREE.Vector3())
  const b = turretAimPoint(pitched, shipClass, new THREE.Vector3())
  assert.ok(a.distanceTo(b) < 1e-6, 'a hull heeled and pitched must aim identically')
})

test('the turret eases back to dead ahead when the helm is unmanned', () => {
  const s = ship()
  updateTurretAim(s, { dx: 300, dy: -200 })
  const laid = Math.abs(s.turretYaw)
  for (let i = 0; i < 120; i++) centreTurret(s, 1 / 60)
  assert.ok(Math.abs(s.turretYaw) < laid * 0.1, 'traverse should centre')
  assert.ok(Math.abs(s.turretPitch) < 0.02, 'and elevation should come down')
})

test('turret aim survives a structured clone — it has to be saveable', () => {
  const s = ship()
  updateTurretAim(s, { dx: 75, dy: -25 })
  const copy = structuredClone(s)
  assert.equal(copy.turretYaw, s.turretYaw)
  assert.equal(copy.turretPitch, s.turretPitch)
})

test('every hull in the roster gets a mount that sits on its deck', async () => {
  const { SHIP_CLASSES } = await import('../data/shipClasses.js')
  for (const c of SHIP_CLASSES) {
    const mount = turretMountLocal(c)
    assert.ok(Number.isFinite(mount.y) && mount.y > 0, `${c.id}: mount below the waterline`)
    assert.ok(mount.barrel > 0, `${c.id}: no barrel`)
    assert.ok(
      Math.abs(mount.z) < c.hull.length,
      `${c.id}: mount at z=${mount.z} is off the end of a ${c.hull.length} hull`
    )
  }
})
