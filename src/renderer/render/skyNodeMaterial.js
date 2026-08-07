/**
 * Sky dome — atmosphere, procedural clouds, sun, moon, night sky (WebGPU / TSL).
 *
 * WebGPURenderer cannot compile a custom GLSL ShaderMaterial, so all of this is
 * NodeMaterial + TSL. It is one draw: a camera-locked back-faced sphere with no
 * depth write, rendered first.
 *
 * What is in here, roughly in the order the fragment builds it:
 *
 *  1. **Atmosphere.** Preetham analytic Rayleigh + Mie (the same formulation
 *     three ships in `SkyMesh`, which is known to compile on this backend), so
 *     the horizon warm-up, the blue falloff and the sun's halo come out of an
 *     actual scattering model rather than a hand-picked ramp. The result is
 *     then *tint-matched* to `uHorizon` — the palette colour `sky.js` hands the
 *     fog — so the physical sky and the fog wall meet at the same colour and
 *     the sea/sky join stays invisible. Physics gives the shape; the palette
 *     keeps art direction and stops the horizon seam.
 *  2. **High cirrus** and **cumulus**, each one analytic shell (9 km and
 *     1.6 km) sampled once per pixel with a two-octave FBM and thresholded
 *     into coverage — no raymarch, no self-shadowing, no per-step light loop.
 *     A raymarched volumetric deck lived here before; it read as busier and
 *     wispier than a boat game needs and cost a great deal more per frame for
 *     it. "Simple procedural clouds, cheap, good enough" is the brief this
 *     shape follows now. Shell curvature still converges the deck into a band
 *     at the horizon rather than shooting off to infinity the way a flat plane
 *     projection does, and each layer still fades out at its own tangent so
 *     neither one draws the hard bright bar across the sky that motivated that
 *     fade in the first place.
 *  3. **Rain curtains** in the horizon band during storms.
 *  4. Sun disc with limb darkening; moon with phase, terminator, mare and
 *     earthshine; a magnitude-distributed star field with colour variation, a
 *     milky way band with dust lanes, all wheeling about a celestial pole.
 *
 * The PMREM environment bake (`scene.js createSkyEnvironment`) runs this same
 * material once at boot over six 256px cube faces — about a quarter of one
 * 1600x900 frame's worth of pixels, so it needs no cheap analytic variant.
 */
import { MeshBasicNodeMaterial, BackSide } from 'three/webgpu'
import {
  uniform,
  varying,
  vec2,
  vec3,
  float,
  positionLocal,
  modelViewProjection,
  cameraPosition,
  normalize,
  cross,
  max,
  sign,
  mix,
  pow,
  exp,
  sqrt,
  acos,
  cos,
  sin,
  clamp,
  smoothstep,
  fract,
  floor,
  oneMinus,
  negate,
  Fn,
  If,
  mx_noise_float
} from 'three/tsl'
import { daylightAt, DAY_LENGTH_S } from './sky.js'

// ---------------------------------------------------------------------------
// Tunables — the entire performance surface of this file.
// ---------------------------------------------------------------------------

/**
 * Fake planet radius, metres. Not Earth's: at 6371 km a cloud deck stays
 * overhead for 140 km and the horizon band never compresses. 260 km puts the
 * cloud-base horizon about 25 km out, which is the scale of this world's fog
 * and its 80 km sea, so the deck stacks up into a band right where the eye
 * expects it from a boat.
 */
const PLANET_R = 260_000
/** Cumulus shell, metres above sea level — single analytic layer, no march. */
const CUMULUS_H = 1600
/** Cirrus shell. Higher and thinner, its own layer. */
const CIRRUS_H = 9000

/** Cloud drift, metres/second. Layers move at their own rate and bearing. */
const WIND_CUMULUS = [7.5, 3.1]
const WIND_CIRRUS = [26.0, -9.0]

// ---------------------------------------------------------------------------
// Noise. All layout functions so they compile to real GPU functions instead of
// inlining a few hundred times into the march.
// ---------------------------------------------------------------------------

const hash21 = Fn(([p]) => fract(sin(p.dot(vec2(127.1, 311.7))).mul(43758.5453)))
  .setLayout({ name: 'skyHash21', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

const hash31 = Fn(([p]) => fract(sin(p.dot(vec3(127.1, 311.7, 74.7))).mul(43758.5453)))
  .setLayout({ name: 'skyHash31', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] })

const vnoise2 = Fn(([p]) => {
  const i = floor(p)
  const f = fract(p)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const a = hash21(i)
  const b = hash21(i.add(vec2(1, 0)))
  const c = hash21(i.add(vec2(0, 1)))
  const d = hash21(i.add(vec2(1, 1)))
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y)
}).setLayout({ name: 'skyVNoise2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

/** Four-octave 2D FBM, 0..1. Weather maps, cirrus, rain curtains. */
const fbm2 = Fn(([p]) => {
  const a = vnoise2(p).mul(0.5)
  const b = vnoise2(p.mul(2.04).add(vec2(17.3, 9.1))).mul(0.25)
  const c = vnoise2(p.mul(4.11).add(vec2(3.7, 11.2))).mul(0.125)
  const d = vnoise2(p.mul(8.23).add(vec2(9.1, 2.4))).mul(0.0625)
  return a.add(b).add(c).add(d).div(0.9375)
}).setLayout({ name: 'skyFbm2', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] })

/** Three-octave 3D Perlin FBM, 0..1. Cloud bodies. */
const fbm3 = Fn(([p]) => {
  const a = mx_noise_float(p).mul(0.5)
  const b = mx_noise_float(p.mul(2.03).add(vec3(11.3, 5.7, 3.1))).mul(0.25)
  const c = mx_noise_float(p.mul(4.09).add(vec3(3.9, 17.1, 8.4))).mul(0.125)
  return a.add(b).add(c).div(0.875).mul(0.5).add(0.5)
}).setLayout({ name: 'skyFbm3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] })

// ---------------------------------------------------------------------------
// Atmosphere — Preetham analytic Rayleigh + Mie.
// ---------------------------------------------------------------------------

/**
 * Sky radiance along `dir`. Same constants three's `SkyMesh` uses, minus its
 * solar disc (we draw our own, with limb darkening) and minus its night floor
 * (the palette owns night). Returns linear radiance, roughly 0..4.
 */
const atmosphere = Fn(([dir, sunDir, turbidity, rayleighAmt]) => {
  const up = vec3(0, 1, 0)
  const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5)
  const mieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14)
  const cutoffAngle = float(1.6110731556870734)
  const steepness = float(1.5)
  const EE = float(1000)

  const zenithCos = clamp(sunDir.dot(up), -1, 1)
  const sunE = EE.mul(
    max(float(0), oneMinus(exp(negate(cutoffAngle.sub(acos(zenithCos)).div(steepness)))))
  )
  // Preetham fades rayleigh out as the sun drops below the horizon.
  const sunfade = oneMinus(clamp(oneMinus(exp(sunDir.y.mul(450000).div(450000))), 0, 1))
  const betaR = totalRayleigh.mul(rayleighAmt.sub(oneMinus(sunfade)))
  const c = float(0.2).mul(turbidity).mul(1e-17)
  const betaM = float(0.434).mul(c).mul(mieConst).mul(0.008)

  const rayleighZenith = float(8.4e3)
  const mieZenith = float(1.25e3)
  const zenithAngle = acos(max(float(0), up.dot(dir)))
  const inverse = float(1).div(
    cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithAngle.mul(57.29577951)), -1.253)))
  )
  const sR = rayleighZenith.mul(inverse)
  const sM = mieZenith.mul(inverse)
  const Fex = exp(negate(betaR.mul(sR).add(betaM.mul(sM))))

  const cosTheta = dir.dot(sunDir)
  const cc = cosTheta.mul(0.5).add(0.5)
  const rPhase = float(0.05968310365946075).mul(float(1).add(pow(cc, 2)))
  const betaRTheta = betaR.mul(rPhase)
  const g = float(0.8)
  const g2 = g.mul(g)
  const mPhase = float(0.07957747154594767)
    .mul(oneMinus(g2))
    .div(pow(oneMinus(float(2).mul(g).mul(cosTheta)).add(g2), 1.5))
  const betaMTheta = betaM.mul(mPhase)

  const ratio = betaRTheta.add(betaMTheta).div(betaR.add(betaM))
  const Lin = pow(sunE.mul(ratio).mul(oneMinus(Fex)), vec3(1.5)).toVar()
  Lin.mulAssign(
    mix(
      vec3(1),
      pow(sunE.mul(ratio).mul(Fex), vec3(0.5)),
      clamp(pow(oneMinus(up.dot(sunDir)), 5), 0, 1)
    )
  )
  return Lin.mul(0.04)
}).setLayout({
  name: 'skyAtmosphere',
  type: 'vec3',
  inputs: [
    { name: 'dir', type: 'vec3' },
    { name: 'sunDir', type: 'vec3' },
    { name: 'turbidity', type: 'float' },
    { name: 'rayleighAmt', type: 'float' }
  ]
})

// ---------------------------------------------------------------------------

/** Rodrigues rotation — used to wheel the stars about the celestial pole. */
const rotAxis = (v, axis, ang) =>
  v
    .mul(cos(ang))
    .add(cross(axis, v).mul(sin(ang)))
    .add(axis.mul(axis.dot(v)).mul(oneMinus(cos(ang))))

export function createSkyNodeMaterial() {
  const day = daylightAt(0)

  // --- Uniforms scene.js writes every frame. Names are load-bearing. --------
  const uSunDir = uniform(day.sunDirection.clone())
  const uMoonDir = uniform(day.moonDirection.clone())
  const uMoonPhase = uniform(day.moonPhase)
  const uZenith = uniform(day.zenith.clone())
  const uHorizon = uniform(day.horizon.clone())
  const uSunColor = uniform(day.sunColor.clone())
  const uCloudColor = uniform(day.cloudColor.clone())
  const uCloudLit = uniform(day.cloudLit.clone())
  const uCloudCover = uniform(0.52)
  const uStars = uniform(day.starOpacity)
  const uTime = uniform(0)
  // Optional, written only if a future scene.js chooses to (see
  // qa-shots/CROSSTALK.md). Both have a derived fallback below, so leaving them
  // at zero costs nothing.
  const uStorm = uniform(0)
  const uFlash = uniform(0)

  const vDir = varying(vec3(0, 1, 0), 'vSkyDir')

  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  })

  material.vertexNode = Fn(() => {
    vDir.assign(normalize(positionLocal))
    return modelViewProjection
  })()

  material.colorNode = Fn(() => {
    const d = normalize(vDir)
    const elev = d.y
    const sunDir = normalize(uSunDir)
    const sunAlt = sunDir.y
    const dayAmt = smoothstep(-0.12, 0.16, sunAlt)
    const nightAmt = oneMinus(dayAmt)

    // Weather, inferred from the one uniform that carries it. scene.js drives
    // uCloudCover from 0.60 (fair) down toward 0.10 (socked in), so the
    // threshold *is* the storm signal — no extra uniform needed.
    const storm = max(smoothstep(0.44, 0.14, uCloudCover), uStorm)
    // Fair weather over warm water is *scattered* cumulus with big blue gaps.
    // The old base of 0.56 put a fair day at near-overcast, and the underside of
    // an overcast deck is a flat grey ceiling however good the volumetrics are —
    // that is what made every daylight shot read as one airbrushed sheet. The
    // gain is raised to compensate so a storm still socks the sky in.
    const coverAmt = clamp(float(0.5).add(float(0.6).sub(uCloudCover).mul(0.95)), 0.05, 0.97)
    // Lightning: under a storm deck scene.js lerps uCloudLit toward near-white
    // for the duration of a strike. Nothing else makes a storm sky's lit colour
    // bright, so that is a reliable read on "a bolt is firing right now".
    const litLuma = uCloudLit.dot(vec3(0.299, 0.587, 0.114))
    // The window matters: scene.js darkens uCloudLit by ~half under a storm and
    // then lerps it only ~0.29 of the way toward white for a strike, so the
    // luma it actually reaches is around 0.36. Reading that against a 0.24-0.70
    // window returned 0.13 and the deck barely lit at all — the bolt hung on a
    // dark sky with nothing behind it, which is the one thing that always reads
    // as an overlay.
    const flash = max(storm.mul(smoothstep(0.16, 0.44, litLuma)), uFlash)

    // --- 1. Base sky: art-directed gradient, physically shaped ------------
    const grad = mix(uHorizon, uZenith, pow(clamp(elev, 0, 1), 0.42))
    // Reference direction: on the horizon, a quarter turn away from the sun.
    // Whatever the scattering model says *there* is what the fog colour has to
    // be, so match the physical sky to the palette at that one point and every
    // other direction inherits the model's shape for free.
    // Anchored at *both* ends: match the model to uHorizon down at the skyline
    // and to uZenith overhead, interpolating between. A single horizon anchor
    // multiplies the whole dome by the horizon's tint, which at midday drags a
    // dusty tan skyline all the way to the zenith and makes noon read as dusk.
    const perp = normalize(vec3(sunDir.z.negate(), 0, sunDir.x).add(vec3(1e-4, 0, 0)))
    const refDir = normalize(perp.add(vec3(0, 0.07, 0)))
    const turb = float(3.4)
    const rayAmt = float(2.1)
    const tone = (x) => oneMinus(exp(x.mul(-1.65)))
    const physRef = tone(atmosphere(refDir, sunDir, turb, rayAmt))
    const physZen = tone(atmosphere(vec3(0, 1, 0), sunDir, turb, rayAmt))
    const physDir = tone(atmosphere(d, sunDir, turb, rayAmt))
    const tintH = clamp(uHorizon.div(max(physRef, vec3(0.015))), 0.2, 4.5)
    const tintZ = clamp(uZenith.div(max(physZen, vec3(0.015))), 0.2, 4.5)
    const tint = mix(tintH, tintZ, pow(clamp(elev, 0, 1), 0.5))
    const physSky = physDir.mul(tint)
    // Physics leads by day; the palette owns twilight and night, where Preetham
    // has nothing to say.
    const c = mix(grad, physSky, dayAmt.mul(0.72)).toVar()

    // --- 2. Night sky: stars, milky way, damaged-atmosphere gas -----------
    const openSky = uStars.mul(smoothstep(0.0, 0.14, elev)).toVar()
    If(openSky.greaterThan(0.01), () => {
      // Wheel the whole celestial sphere about a tilted pole, one turn a day.
      const pole = normalize(vec3(0.36, 0.86, -0.36))
      const sd = normalize(rotAxis(d, pole, uTime.mul((Math.PI * 2) / DAY_LENGTH_S)))

      // Milky way: a band about the galactic plane, with structure and dust.
      // The band is narrow, silver-grey and faint. There used to be broad
      // multi-hue "nebulae" here, inherited from the space build this game was
      // converted from; on a flooded Earth they read as a sci-fi skybox and
      // they are gone. What you can see from a dark sea is unresolved
      // starlight, and it is not colourful.
      const gn = normalize(vec3(0.42, 0.55, -0.72))
      const b = sd.dot(gn)
      const band = exp(b.mul(b).mul(-42))
      const bandN = fbm3(sd.mul(5.5))
      const bandFine = fbm3(sd.mul(15.0).add(vec3(9.1, 2.2, 4.4)))
      const milky = band.mul(smoothstep(0.36, 0.80, bandN.mul(0.6).add(bandFine.mul(0.4))))
      // Squared on uStars: the band is a deep-night object, not a dusk one.
      const milkyVis = openSky.mul(uStars)
      c.addAssign(vec3(0.62, 0.66, 0.80).mul(milky).mul(milkyVis).mul(0.30))
      c.addAssign(vec3(0.80, 0.74, 0.62).mul(milky).mul(bandFine).mul(milkyVis).mul(0.085))
      // Dust lanes: dark rifts through the brightest part of the band.
      const rift = band.mul(smoothstep(0.62, 0.30, bandN)).mul(smoothstep(0.2, 0.6, band))
      c.mulAssign(mix(vec3(1), vec3(0.52, 0.50, 0.54), rift.mul(milkyVis).mul(0.7)))

      // Stars. Three tiers of 3D cell hashing on the sphere — no plane
      // projection, so no smeared pole and no pile-up at the horizon.
      const starTier = (k, mag, thresh, size) => {
        const cell = floor(sd.mul(k))
        const h = hash31(cell)
        const jx = hash31(cell.add(vec3(3.7, 1.3, 9.2)))
        const jy = hash31(cell.add(vec3(7.1, 4.4, 2.8)))
        const jz = hash31(cell.add(vec3(1.9, 8.6, 5.5)))
        const pos = normalize(cell.add(vec3(jx, jy, jz)))
        const ang = oneMinus(sd.dot(pos)).mul(k * k)
        // Magnitude: many dim, few bright. `size` is calibrated so the core is
        // roughly a pixel and a half across at this field of view — a star that
        // covers eight pixels is a blob, not a star, and reads as noise the
        // moment the bloom pass gets hold of it. Only the brightest carry an
        // extra soft halo, which is the eye's own glare and is what makes a
        // magnitude difference visible at all at sub-pixel sizes.
        const bright = pow(clamp(h.sub(thresh).mul(1 / (1 - thresh)), 0, 1), 2.6).mul(mag)
        const core = exp(ang.mul(negate(float(size)))).add(
          exp(ang.mul(negate(float(size * 0.12)))).mul(0.10).mul(clamp(bright, 0, 1.5))
        )
        // Colour by a stand-in for B-V: cool blue-white through to orange.
        const heat = hash31(cell.add(vec3(19.3, 23.1, 5.9)))
        const tintS = mix(
          mix(vec3(0.70, 0.80, 1.0), vec3(1.0, 0.99, 0.96), smoothstep(0.15, 0.55, heat)),
          vec3(1.0, 0.78, 0.55),
          smoothstep(0.72, 1.0, heat)
        )
        // Scintillation: strong low down where the air is thick, calm at zenith.
        const tw = float(1).sub(
          smoothstep(0.5, 0.0, elev).mul(0.42).mul(sin(uTime.mul(2.7).add(h.mul(97))).mul(0.5).add(0.5))
        )
        return tintS.mul(core).mul(bright).mul(tw)
      }
      // Brightest first: the sparse bright tier is already visible while the
      // sky is still blue, the dense faint tiers only arrive once it is dark.
      // That staggering is what makes dusk read as dusk instead of a switch.
      // `size` is an inverse area: core 1/e half-angle is 1/sqrt(size*k^2/2), and
      // this camera is 1.047 rad over 900 px, so 78 at k=58 was a 3.2 px radius —
      // a 6 px disc, which is a dot, not a star. Trebled, so the bright tier is
      // sub-two-pixel and the faint tiers are genuinely sub-pixel; magnitudes go
      // up to pay for the lost area, and the faint thresholds drop so the sky
      // gains the thousands of barely-there points that make a field read deep
      // instead of sprinkled.
      const starVis = openSky.mul(smoothstep(0.0, 0.2, elev))
      c.addAssign(starTier(58, 2.3, 0.9885, 240).mul(starVis))
      c.addAssign(starTier(120, 1.05, 0.964, 190).mul(starVis).mul(smoothstep(0.05, 0.4, uStars)))
      c.addAssign(
        starTier(240, 0.5, 0.925, 110)
          .mul(starVis)
          .mul(smoothstep(0.0, 0.18, elev))
          .mul(smoothstep(0.35, 0.8, uStars))
      )
    })

    // --- 3. Sun disc ------------------------------------------------------
    const sunUp = smoothstep(-0.06, 0.04, sunAlt)
    const sunCos = d.dot(sunDir)
    const SUN_R = 0.028
    const sunAng = acos(clamp(sunCos, -1, 1))
    const disc = oneMinus(smoothstep(float(SUN_R * 0.94), float(SUN_R), sunAng))
    // Limb darkening: the rim of a star is cooler and dimmer than its centre.
    const mu = sqrt(clamp(oneMinus(pow(sunAng.div(SUN_R), 2)), 0, 1))
    const limb = float(0.42).add(float(0.58).mul(mu))
    const discLow = vec3(1.0, 0.42, 0.16)
    const discHigh = vec3(1.0, 0.96, 0.88)
    const discTint = mix(discLow, discHigh, smoothstep(0.0, 0.3, sunAlt))
    const discCol = mix(discTint.mul(vec3(1.0, 0.72, 0.46)), discTint, limb).mul(
      mix(float(1.4), float(4.2), limb.mul(limb))
    )
    c.assign(mix(c, discCol, disc.mul(sunUp)))

    // --- 4. Moon ----------------------------------------------------------
    const moonDir = normalize(uMoonDir)
    const moonUp = smoothstep(-0.05, 0.05, moonDir.y)
    const MOON_R = 0.036
    const moonAng = acos(clamp(d.dot(moonDir), -1, 1))
    const mDisc = oneMinus(smoothstep(float(MOON_R * 0.96), float(MOON_R), moonAng))
    If(mDisc.mul(moonUp).greaterThan(0.001), () => {
      const right = normalize(cross(vec3(0, 1, 0), moonDir))
      const upv = cross(moonDir, right)
      const sp = vec2(d.dot(right), d.dot(upv)).div(MOON_R)
      const toSun = normalize(sunDir.sub(moonDir.mul(sunDir.dot(moonDir)))).dot(right)
      const phaseOff = uMoonPhase.mul(2).sub(1)
      const term = smoothstep(-0.2, 0.36, sp.x.mul(sign(toSun.add(1e-4))).add(phaseOff))
      const earthshine = oneMinus(term).mul(0.12).mul(float(0.55).add(uMoonPhase.mul(0.45)))
      // Mare and crater blotching, plus a limb-darkened sphere.
      const mare = fbm2(sp.mul(1.5).add(vec2(31.7, 12.1)))
      const crat = fbm2(sp.mul(6.2).add(vec2(4.3, 8.8)))
      const shade = mix(float(0.52), float(1.0), smoothstep(0.3, 0.72, mare)).mul(
        mix(float(0.86), float(1.05), crat)
      )
      const sphere = sqrt(clamp(oneMinus(sp.dot(sp)), 0, 1))
      const lit = vec3(0.94, 0.93, 0.87).mul(shade).mul(float(0.5).add(sphere.mul(0.5)))
      const dark = vec3(0.16, 0.20, 0.30).mul(shade).mul(float(0.4).add(sphere.mul(0.35)))
      const moonCol = mix(dark, lit, clamp(term.add(earthshine), 0, 1))
      // A daytime moon is a pale disc, not a lamp.
      const vis = mix(float(0.45), float(1), uStars).mul(mix(float(0.5), float(1), nightAmt))
      c.assign(mix(c, moonCol.mul(1.5), mDisc.mul(moonUp).mul(vis)))
    })

    // --- 5. High cirrus ---------------------------------------------------
    // One analytic shell rather than a second march: cirrus are optically thin,
    // so a raymarch buys nothing a stretched FBM does not already sell.
    const camXZ = vec2(cameraPosition.x, cameraPosition.z)
    const h0 = max(cameraPosition.y, float(2))
    const apex = float(PLANET_R).mul(elev)
    const discC = apex.mul(apex).sub(float(2 * PLANET_R).mul(float(CIRRUS_H).sub(h0)))
    If(discC.greaterThan(0), () => {
      const tC = apex.sub(sqrt(discC))
      const cxz = camXZ
        .add(vec2(d.x, d.z).mul(tC))
        .add(vec2(uTime.mul(WIND_CIRRUS[0]), uTime.mul(WIND_CIRRUS[1])))
      // Stretched along the wind — cirrus are sheared out by the jet, never
      // round.
      const q = vec2(cxz.x.mul(1 / 16000), cxz.y.mul(1 / 4200))
      const n = fbm2(q)
      const fib = fbm2(vec2(cxz.x.mul(1 / 2600), cxz.y.mul(1 / 900)).add(vec2(11.1, 3.3)))
      // Fade out as the ray goes tangent to the shell. Right at the tangent the
      // sampled point sweeps arbitrarily fast and the layer terminates in one
      // pixel, which draws a razor-sharp bright bar clean across the sky. The
      // root over the apex is a dimensionless "how far from grazing" that fades
      // it out before it can do that.
      const grazeC = smoothstep(0.0, 0.34, sqrt(discC).div(max(apex, float(1))))
      const a = smoothstep(0.52, 0.82, n.mul(0.72).add(fib.mul(0.28)))
        .mul(oneMinus(storm))
        .mul(smoothstep(0.02, 0.12, elev))
        .mul(exp(tC.mul(-1 / 90000)))
        .mul(grazeC)
        .mul(0.55)
      const fwd = pow(clamp(sunCos, 0, 1), 6)
      const cirrusCol = mix(uCloudColor.mul(1.3), uCloudLit, clamp(float(0.55).add(fwd.mul(0.5)), 0, 1))
      c.assign(mix(c, mix(cirrusCol, uHorizon, smoothstep(0.0, 0.16, oneMinus(elev)).mul(0.35)), a))
    })

    // --- 6. Cumulus ---------------------------------------------------------
    // One analytic shell, one FBM sample per pixel — the same cheap pattern
    // as the cirrus layer above, just tuned for puffy low cloud instead of
    // sheared high cloud. No raymarch, no self-shadow, no per-step light
    // loop: "simple procedural clouds" was the brief, this is what cheap
    // actually buys, and a sky dome covering half the screen every frame is
    // exactly where that trade pays for itself.
    const discCu = apex.mul(apex).sub(float(2 * PLANET_R).mul(float(CUMULUS_H).sub(h0)))
    If(discCu.greaterThan(0).and(elev.greaterThan(0)), () => {
      const tCu = apex.sub(sqrt(discCu))
      const cuxz = camXZ
        .add(vec2(d.x, d.z).mul(tCu))
        .add(vec2(uTime.mul(WIND_CUMULUS[0]), uTime.mul(WIND_CUMULUS[1])))
      // Two octaves at a few-km scale: big soft billows, not a fine weave.
      const n = fbm2(cuxz.mul(1 / 3400)).mul(0.7).add(
        fbm2(cuxz.mul(1 / 1100).add(vec2(21.3, 8.6))).mul(0.3)
      )
      // Same grazing-fade trick the cirrus layer uses, at the cumulus shell's
      // own tangent — without it the shell terminates in one pixel at the
      // horizon and draws a bright bar across the frame.
      const grazeCu = smoothstep(0.0, 0.34, sqrt(discCu).div(max(apex, float(1))))
      const thresh = oneMinus(coverAmt)
      const cov = smoothstep(thresh.sub(0.16), thresh.add(0.16), n)
        .mul(exp(tCu.mul(-1 / 34000)))
        .mul(grazeCu)
      // Soft-lit top, cooler shaded base — the classic two-tone painted look
      // — plus a cheap forward-scatter brightening near the sun, no phase
      // function required.
      const fwd = pow(clamp(sunCos, 0, 1), 8)
      const litCol = mix(uCloudColor, uCloudLit, 0.85).add(uCloudLit.mul(0.18).mul(fwd).mul(sunUp))
      const shadowCol = uCloudColor.mul(0.62)
      const shade = smoothstep(0.3, 0.78, n)
      const cuCol = mix(shadowCol, litCol, shade).mul(mix(float(1), float(1.25), flash))
      c.assign(mix(c, mix(cuCol, uHorizon, smoothstep(0.0, 0.14, oneMinus(elev)).mul(0.35)), cov))
    })

    // --- 7. Rain curtains --------------------------------------------------
    // Distant precipitation hanging out of the deck. Lives in the band between
    // the sea horizon and the cloud-base horizon, which is where you actually
    // see a squall from a boat.
    If(storm.greaterThan(0.05).and(elev.greaterThan(0)).and(elev.lessThan(0.13)), () => {
      const rxz = camXZ.add(vec2(d.x, d.z).mul(26000)).add(vec2(uTime.mul(6), uTime.mul(2.4)))
      const where = fbm2(rxz.mul(1 / 7000))
      const streak = fbm2(vec2(rxz.x.mul(1 / 700), elev.mul(26).add(rxz.y.mul(1 / 2400))))
      const mask = smoothstep(0.46, 0.74, where)
        .mul(smoothstep(0.0, 0.018, elev))
        .mul(oneMinus(smoothstep(0.06, 0.13, elev)))
        .mul(storm)
      const veil = mask.mul(float(0.45).add(streak.mul(0.55)))
      c.assign(mix(c, mix(uCloudColor, uHorizon, 0.4).mul(0.72), veil.mul(0.82)))
    })

    // --- 8. Below the waterline -------------------------------------------
    // The sea covers this on screen, but the PMREM bake samples it for the
    // underside of every hull. Dull, not black, and following the time of day.
    c.assign(mix(uHorizon.mul(0.22), c, smoothstep(-0.14, 0.02, elev)))

    return c
  })()

  material.userData.skyUniforms = {
    uSunDir,
    uMoonDir,
    uMoonPhase,
    uZenith,
    uHorizon,
    uSunColor,
    uCloudColor,
    uCloudLit,
    uCloudCover,
    uStars,
    uTime,
    uStorm,
    uFlash
  }
  // Back-compat alias used by scene.js.
  material.uniforms = material.userData.skyUniforms

  return material
}
