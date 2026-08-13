/**
 * The post chain. WebGPU / TSL only — no GLSL anywhere in here.
 *
 * Everything the player actually sees goes through `render()`. `scene.js` owns
 * the frame; this file owns what happens to the image after the scene pass has
 * drawn it.
 *
 * Order matters and is not arbitrary:
 *
 *   scene pass (2x supersampled, colour + depth)
 *     → GTAO            contact darkening, applied to the HDR beauty
 *     → DOF             very shallow, far field only
 *     → bloom           threshold above 1.0 — sun glitter and emissives only
 *     → renderOutput    tone map + sRGB  (everything below is display-referred)
 *     → look LUT        the filmic grade (baked 3D LUT, see buildLookLut)
 *     → chromatic ab.   lens colour fringe at the frame edge
 *     → SMAA            wants sRGB input, which is why it sits after the grade
 *     → sharpen         post-AA crispening, as every shipped title does
 *     → vignette+grain  final lens/film artefacts
 *
 * `RenderPipeline.outputColorTransform` is off precisely so the tone map lands
 * in the middle of that list rather than at the end: SMAA on linear HDR eats
 * highlights, and a LUT applied before the tone map is not a grade, it is a
 * guess.
 *
 * Two things about this stack you need to know before changing any of it:
 *
 * 1. The "TSL bloom greys the swapchain on Metal" note this replaces was a
 *    misdiagnosis. The pipeline is fine. What was actually broken was
 *    `captureFrame()`, which re-rendered the scene straight into an 8-bit
 *    target — so every visual-QA screenshot was of a frame with no MSAA, no
 *    post and no grade. See scene.js.
 *
 * 2. **No MRT.** This Electron's WebGPU adapter does not advertise
 *    `core-features-and-limits` (verified: neither the core nor the
 *    compatibility adapter lists it), so three decides it is in compatibility
 *    mode. That forces `renderer.samples = 0`, so hardware MSAA is simply not
 *    available here whatever `antialias: true` says, and it makes every MRT
 *    attachment inherit the material's blend mode — so the moment a transparent
 *    or additive object draws it blends into the normal buffer too. GTAO
 *    reconstructs its normals from depth instead; SSR is not viable here at all
 *    and is deliberately absent (the ocean does its own reflections
 *    analytically, and nothing else in frame is a mirror). Revisit if Electron
 *    ships a WebGPU device that reports core.
 *
 * 3. Every stage that samples the scene pass must agree with it about
 *    resolution. Two separate bugs came out of getting that wrong, and both
 *    looked like "the water is broken": a non-integer supersample ratio (a fine
 *    grid over the whole frame, sky included) and GTAO sizing its target off the
 *    drawing buffer while sampling supersampled depth (blocky streaks along the
 *    horizon). If you see a screen-locked artefact that does not care what is
 *    under it, suspect the resample chain before you suspect a shader.
 */
import * as THREE from 'three/webgpu'
import {
  Fn,
  float,
  hash,
  luminance,
  max,
  min,
  mix,
  pass,
  renderOutput,
  screenCoordinate,
  screenUV,
  smoothstep,
  texture3D,
  time,
  uniform,
  vec2,
  vec3,
  vec4
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'

/**
 * Quality knobs. Every stage that costs real time is switchable, because this
 * is a game and not a still-life renderer. `low` is what a weak GPU should get.
 */
/** QA bisect: true renders the scene pass tone-mapped and skips the whole chain. */
const BYPASS_CHAIN = false

export const POST_QUALITY = {
  // `ssaa` must be a whole number — see the note in createPostFx. 1 plus
  // sharpen is the default; 2 costs 4x the fragment work.
  ultra: { ssaa: 1, ao: true, aoScale: 0.5, dof: true, sharpen: true },
  high: { ssaa: 1, ao: true, aoScale: 0.5, dof: true, sharpen: true },
  medium: { ssaa: 1, ao: true, aoScale: 0.5, dof: false, sharpen: true },
  low: { ssaa: 1, ao: false, aoScale: 0.5, dof: false, sharpen: false }
}

const SRGB_TO_LINEAR = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const LINEAR_TO_SRGB = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * The look, baked into a 3D LUT.
 *
 * Doing this on the CPU once at boot instead of as a stack of TSL maths costs
 * one 33³ texture fetch a pixel at runtime and — much more usefully — lets the
 * whole grade be read in one place as ordinary arithmetic.
 *
 * The chain is the standard colourist order: CDL (slope/offset/power) for the
 * primary balance, a pivoted S-curve for contrast that rolls off instead of
 * clipping, saturation with a highlight desaturation so speculars go white the
 * way film does, then a split-tone that pushes shadows cool and highlights
 * warm. That last step is what stops a grey-blue sea from reading as untextured.
 *
 * Input and output are display-referred (post tone map, sRGB encoded).
 */
export function buildLookLut(size = 33) {
  const data = new Uint8Array(size * size * size * 4)

  // Primary balance. Warm the top end, cool and lift the bottom — the classic
  // "blacks are never black" film response, which is also what keeps a night
  // scene from turning into a pit of pure #000.
  const slope = [1.045, 1.0, 0.955]
  const offset = [0.004, 0.009, 0.021]
  const power = [1.0, 0.995, 0.965]

  // Contrast. Pivot slightly below mid so the sea gains separation without the
  // sky blowing out.
  const pivot = 0.435
  const contrast = 1.3

  const sat = 1.2
  const highlightSat = 0.78

  // Split tone, as multipliers.
  const shadowTint = [0.9, 0.985, 1.1]
  const highlightTint = [1.05, 1.005, 0.93]

  const scurve = (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    return x < pivot
      ? pivot * Math.pow(x / pivot, contrast)
      : 1 - (1 - pivot) * Math.pow((1 - x) / (1 - pivot), contrast)
  }

  let i = 0
  const c = [0, 0, 0]
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        c[0] = r / (size - 1)
        c[1] = g / (size - 1)
        c[2] = b / (size - 1)

        // CDL, then S-curve, both in display-referred space.
        for (let k = 0; k < 3; k++) {
          const v = clamp01(c[k] * slope[k] + offset[k])
          c[k] = scurve(Math.pow(v, power[k]))
        }

        // Saturation. Film loses colour as it approaches the shoulder, so the
        // amount of saturation falls off with luminance.
        let luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        const shoulder = clamp01((luma - 0.68) / 0.32)
        const s = sat + (highlightSat - sat) * shoulder * shoulder
        for (let k = 0; k < 3; k++) c[k] = clamp01(luma + (c[k] - luma) * s)

        // Split tone. Weighted at the ends only, so mid-tones keep their hue.
        luma = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        const lowW = (1 - luma) * (1 - luma) * 0.55
        const highW = luma * luma * 0.45
        for (let k = 0; k < 3; k++) {
          const tint = 1 + (shadowTint[k] - 1) * lowW + (highlightTint[k] - 1) * highW
          c[k] = clamp01(c[k] * tint)
        }

        // A gentle toe in linear light: keeps deep shadows off the floor
        // without greying the whole frame the way an sRGB-space lift does.
        for (let k = 0; k < 3; k++) {
          const lin = SRGB_TO_LINEAR(c[k])
          c[k] = clamp01(LINEAR_TO_SRGB(lin + 0.0007 * (1 - lin)))
        }

        data[i++] = Math.round(c[0] * 255)
        data[i++] = Math.round(c[1] * 255)
        data[i++] = Math.round(c[2] * 255)
        data[i++] = 255
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, size, size, size)
  tex.format = THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.wrapR = THREE.ClampToEdgeWrapping
  tex.colorSpace = THREE.NoColorSpace
  tex.generateMipmaps = false
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return { texture: tex, size }
}

/**
 * Build the post chain for a scene/camera pair.
 *
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {{ quality?: keyof typeof POST_QUALITY }} [opts]
 */
export function createPostFx(renderer, scene, camera, opts = {}) {
  const q = POST_QUALITY[opts.quality] || POST_QUALITY.high

  // Anti-aliasing is supersampling, not MSAA, and that is forced rather than
  // chosen: an MSAA scene pass hands out a `texture_multisampled_2d` depth
  // buffer, which WebGPU will not let anything sample, so GTAO and DOF fail to
  // compile outright. Supersampling also does what MSAA never could — the
  // worst aliasing in this game is the sun's specular glitter on the water,
  // which is shading aliasing, invisible to a coverage-based resolve.
  //
  // The ratio MUST be a whole number, and that is not fussiness. Everything
  // downstream samples this target with a bilinear filter at output resolution.
  // At an integer ratio each output pixel lands exactly on a texel boundary, so
  // bilinear returns the exact box average of the block — a real downsample. At
  // 1.35 it lands somewhere different every pixel, and the weighting repeats
  // with period 1/0.35 ≈ 3 px, which paints a fine regular grid over the entire
  // frame, sky included, whatever the content. That grid is not noise and no
  // amount of denoise or grain tuning removes it.
  //
  // The scale is against total sample density, not the window: on a 2x display
  // the panel is already supersampling and adding more is just heat.
  const ssaa = renderer.getPixelRatio() >= 1.5 ? 1 : Math.max(1, Math.round(q.ssaa))
  const scenePass = pass(scene, camera)
  if (ssaa > 1) scenePass.setResolutionScale(ssaa)

  const colorNode = scenePass.getTextureNode('output')
  const depthNode = scenePass.getTextureNode('depth')
  const viewZNode = scenePass.getViewZNode()

  let beauty = colorNode

  // --- Ambient occlusion -------------------------------------------------
  // Contact darkening where hulls meet water, where jetty piles meet decking,
  // and in every corner of the harbour clutter. Without it geometry looks
  // pasted onto the frame rather than sitting in it.
  //
  // Normals come from depth (null normal node) — see the MRT note at the top.
  // The radius is in view-space metres, so it is sized against a jetty pile,
  // not against the 40 km world.
  const aoPass = q.ao ? ao(depthNode, null, camera) : null
  const aoStrength = uniform(0.7)
  if (aoPass) {
    // AO must run at the same resolution as the depth buffer it reconstructs
    // normals from. GTAO sizes its own target off the *drawing buffer* while
    // sampling the supersampled pass depth, so at ssaa 2 it was doing geometry
    // in one pixel space and sampling in another — which is the blocky
    // screen-space streaking along the horizon, worst where the water is most
    // grazing and the depth gradient per pixel is largest.
    aoPass.resolutionScale = q.aoScale * ssaa
    aoPass.radius.value = 0.9
    // A hard distance falloff is what keeps AO off the open sea. Grazing water
    // 5 km out has almost no usable depth precision, and an unbounded GTAO
    // reads that noise as occlusion — the blocky bands along the horizon.
    aoPass.distanceExponent.value = 2.2
    aoPass.distanceFallOff.value = 0.6
    aoPass.thickness.value = 1.0
    aoPass.scale.value = 1.1
    aoPass.samples.value = 16
    const aoTex = aoPass.getTextureNode()
    // Occlusion belongs to ambient light only. We cannot separate that in post,
    // so scale the effect back rather than multiplying direct sun by it.
    beauty = beauty.mul(vec4(vec3(mix(float(1), aoTex.r, aoStrength)), 1))
  }

  // --- Depth of field -----------------------------------------------------
  // Deliberately almost nothing: enough to soften the very near foreground and
  // put a whisper of separation on the far horizon. A boat game that blurs its
  // own horizon has thrown away the only thing on screen worth looking at.
  const dofFocus = uniform(60)
  const dofLength = uniform(0.02)
  const dofBokeh = uniform(0.5)
  if (q.dof) beauty = dof(beauty, viewZNode, dofFocus, dofLength, dofBokeh)

  // --- Bloom --------------------------------------------------------------
  // Two things had to change here, and neither is a number that was "too high".
  //
  // 1. The threshold is **exposure-relative**. Bloom runs before `renderOutput`,
  //    so it sees scene-referred linear light, but what the player perceives as
  //    "too bright to hold" is display-referred — i.e. after `toneMappingExposure`.
  //    A fixed scene-referred threshold therefore means a different perceptual
  //    cut at every exposure: tuned at noon it is correct, and the moment the
  //    night exposure lifts it starts catching things the eye does not read as
  //    blinding. Both knobs below are authored in display units and divided by
  //    the live exposure, so "blooms above 1.05x white" means the same thing at
  //    every hour.
  //
  // 2. There is a **clamp**, which is the actual fix for the night blow-out.
  //    The practical lamps are PointLights in candela with inverse-square decay:
  //    a metre from the bulb the surface is at linear ~50-100, i.e. fifty times
  //    over white. Unclamped, the high pass hands all fifty of those units to a
  //    five-mip Gaussian pyramid, which spreads them across a couple of hundred
  //    pixels — a solid green disc over the boat, from one small nav lamp. The
  //    clamp caps what any single pixel may contribute, so a brighter source
  //    makes a brighter *core* and not a wider *blob*, which is how a real lens
  //    behaves and how every shipped title with practical lights does it.
  //    (Same mechanism as UE's "bloom clamp" / a firefly clamp in a path tracer.)
  const exposure = uniform(1.05)
  // "Bleeds above 90% of display white." Sun glitter, lamp bulbs, muzzle flash.
  // Slightly under 1 rather than over it because the practicals in this game are
  // authored LDR (`MeshBasicMaterial`, colour ≤ 1.0, `toneMapped: false` — a
  // flag that a post-chain tone map cannot honour), so a lamp bulb never gets
  // anywhere near 1.0 in scene-referred light and a threshold above white left
  // every fixture in the game with no glare at all.
  const bloomThreshold = uniform(0.9)
  // The clamp is a guard rail, not a look knob: it exists to stop one pathological
  // pixel painting a disc across the frame. Set it well above the threshold so
  // legitimately bright things still get a hot core — the failure mode of a tight
  // clamp is a night frame where nothing reaches white and every light reads as a
  // flat sticker.
  const bloomClamp = uniform(9.0)
  const thresholdNode = bloomThreshold.div(exposure)
  const clampNode = bloomClamp.div(exposure)
  // Strength up / radius down against the old 0.42 / 0.62: a tight bright halo
  // rather than a wide faint one. Radius here mixes in the coarser mips of the
  // pyramid, so it is the knob that decides *blob* — keep it low and let strength
  // carry the intensity.
  const bloomPass = bloom(beauty, 0.62, 0.36, thresholdNode)
  // Soft knee — the stock 0.01 is a hard cut, which pops as a lamp crosses the
  // threshold while the boat rides a swell.
  bloomPass.smoothWidth = thresholdNode.mul(0.45)
  bloomPass.highPassFn = Fn(({ input, threshold, smoothWidth }) => {
    const v = luminance(input.rgb)
    const alpha = smoothstep(threshold, threshold.add(smoothWidth), v)
    // Scale the whole pixel down rather than clamping per channel, so a clamped
    // nav light keeps its hue instead of drifting to white.
    const capped = input.rgb.mul(min(float(1), clampNode.div(max(v, float(1e-4)))))
    return mix(vec4(0), vec4(capped, input.a), alpha)
  })
  const composite = beauty.add(bloomPass)

  // --- Tone map + sRGB ----------------------------------------------------
  // Everything from here down is display-referred.
  const ldr = renderOutput(composite)

  // --- The grade ----------------------------------------------------------
  const look = buildLookLut(33)
  const lutIntensity = uniform(1)
  let graded = lut3D(ldr, texture3D(look.texture), look.size, lutIntensity)

  // --- Lens ---------------------------------------------------------------
  // Barely there, and quadratic in radius so the centre of frame is untouched:
  // ~1 px of red/blue separation in the corners, a third of a pixel at the
  // rule-of-thirds line, nothing at all under the crosshair. The node's two
  // terms are a linear scale (`scale`) and a quadratic radial offset
  // (`strength`); leaning on the quadratic one is what keeps it off the middle
  // of the picture. Anything an order of magnitude above this reads as a broken
  // display, not as a lens.
  const caStrength = uniform(0.09)
  // `center` is documented as optional. It is not — a null centre reaches the
  // Fn layout as a null input and the whole node graph fails to build.
  graded = chromaticAberration(graded, caStrength, vec2(0.5, 0.5), 0.3)

  // --- Anti-aliasing ------------------------------------------------------
  // SMAA rather than TRAA: the ocean is vertex-displaced in the shader, so its
  // velocity buffer is a lie and a temporal resolve smears every wave crest.
  let aa = smaa(graded)
  // NOTE the inverted scale: SharpenNode takes 0 as *maximum* RCAS sharpening
  // and 2 as none. A "0.35" that looks like a gentle number is in fact almost
  // full strength, and it turns the supersample resample beat into a visible
  // grid over the whole frame. Denoise on, so it leaves the water speckle and
  // the film grain alone.
  if (q.sharpen) aa = sharpen(aa, 1.35, true)

  // --- Vignette + grain ---------------------------------------------------
  const vignette = uniform(0.34)
  // ~±1 code value. Any more and it stops reading as film stock and starts
  // moiréing the moment the frame is scaled to anything but 1:1.
  const grain = uniform(0.013)
  const finalNode = Fn(() => {
    const src = aa
    const d = screenUV.sub(vec2(0.5, 0.5))
    const r2 = d.dot(d).mul(2.2)
    const vig = float(1).sub(r2.mul(vignette)).max(0)

    // Grain, weighted toward the shadows the way real film stock is, and
    // hashed off the pixel index so it does not crawl with the UVs.
    const n = hash(
      screenCoordinate.x.mul(3.71).add(screenCoordinate.y.mul(1731.7)).add(time.mul(613.0))
    ).sub(0.5)
    const l = luminance(src.rgb)
    // Weighted toward the mid-shadows, not the blacks. Weighting it at the very
    // bottom of the curve puts ±3 code values on a night sky whose whole signal
    // is ~33, which is a tenth of the signal and boils in motion.
    const g = n
      .mul(grain)
      .mul(smoothstep(float(0.0), float(0.09), l))
      .mul(mix(float(1.2), float(0.35), smoothstep(float(0.05), float(0.7), l)))

    return vec4(src.rgb.mul(vig).add(g), src.a)
  })()

  const pipeline = new THREE.RenderPipeline(renderer)
  if (BYPASS_CHAIN) {
    // Bisect switch. Flip the const at the top of this file to render the scene
    // pass tone-mapped and nothing else, so a regression can be pinned on this
    // chain or on somebody else's scene change without guessing.
    pipeline.outputColorTransform = false
    pipeline.outputNode = renderOutput(colorNode)
    return { pipeline, render: () => pipeline.render(), params: {}, dispose: () => pipeline.dispose() }
  }
  // We already ran renderOutput ourselves, half way down the chain.
  pipeline.outputColorTransform = false
  pipeline.outputNode = finalNode

  return {
    pipeline,
    render: () => pipeline.render(),
    /**
     * Set the display exposure. Goes through here rather than straight to
     * `renderer.toneMappingExposure` because the bloom threshold and clamp are
     * authored in display units and have to track it — set one without the
     * other and the night blow-out comes straight back.
     * @param {number} e
     */
    setExposure(e) {
      const v = Math.max(0.05, e)
      renderer.toneMappingExposure = v
      exposure.value = v
    },
    /** Live knobs — everything a tuning pass or a settings menu would want. */
    params: {
      exposure,
      bloomThreshold,
      bloomClamp,
      aoStrength,
      dofFocus,
      dofLength,
      dofBokeh,
      lutIntensity,
      caStrength,
      vignette,
      grain,
      bloom: bloomPass
    },
    dispose() {
      pipeline.dispose()
      look.texture.dispose()
    }
  }
}
