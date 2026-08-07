/**
 * Context-agnostic synthesis core.
 *
 * **STATUS: not wired up yet — nothing imports this file.** It is the
 * foundation for a future audio pass, kept deliberately rather than deleted.
 * The shipping game still runs the older synthesis in `audio.js`; because no
 * import reaches this module, it is tree-shaken out of the bundle and costs
 * nothing at runtime. To adopt it, route `audio.js` at these builders instead
 * of its own and grade the result with `scripts/audioProbe.cjs` first.
 *
 * Every builder here takes `(ctx, dest, t0, opts)` and only schedules nodes on
 * the context it is handed. Nothing touches `window`, a module-level
 * AudioContext, or wall time. That is deliberate: `scripts/audioProbe.cjs`
 * renders each of these into an `OfflineAudioContext` and writes WAV +
 * spectrogram/waveform PNGs, so the signal can actually be graded instead of
 * assumed. If you add a voice here and it reaches for a global, the probe
 * cannot see it and it does not exist.
 *
 * Real-time rules that apply to everything below:
 *   - Noise comes from a handful of long buffers cached per context and played
 *     from a random offset. No per-shot buffer allocation.
 *   - Envelopes are scheduled ramps, never `setValueCurveAtTime` (which needs a
 *     fresh Float32Array per shot).
 *   - Waveshaper curves are cached per context by drive amount.
 *   - Continuous beds allocate once at construction and are then parameter-driven.
 */

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function next() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let rnd = Math.random

/**
 * Pin the jitter so the probe renders the same signal twice and A/B plots mean
 * something. Pass null to go back to `Math.random` for gameplay.
 */
export function seedRandom(seed) {
  rnd = seed == null ? Math.random : mulberry32(seed)
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a, b, t) => a + (b - a) * t
/** Jitter helper: 1 ± amount. */
const jitter = (amount) => 1 + (rnd() * 2 - 1) * amount

// ---------------------------------------------------------------------------
// Per-context cache (noise buffers, shaper curves, click impulses)
// ---------------------------------------------------------------------------

const CACHE = new WeakMap()

function cacheFor(ctx) {
  let c = CACHE.get(ctx)
  if (!c) {
    c = { noise: new Map(), curves: new Map(), impulse: new Map() }
    CACHE.set(ctx, c)
  }
  return c
}

/**
 * Long stereo noise bed, deterministic per colour so two runs of the probe
 * produce comparable plots. Channels are generated from independent streams,
 * which is what gives every noise layer real stereo width for free.
 *
 * @param {'white'|'pink'|'brown'|'grain'} colour
 */
export function noiseBuffer(ctx, colour = 'white') {
  const cache = cacheFor(ctx)
  const hit = cache.noise.get(colour)
  if (hit) return hit
  const seconds = colour === 'brown' ? 8 : 6
  const n = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const gen = mulberry32(0x9e37 + ch * 7919 + colour.length * 131)
    const d = buf.getChannelData(ch)
    let brown = 0
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    for (let i = 0; i < n; i++) {
      const w = gen() * 2 - 1
      if (colour === 'white') {
        d[i] = w * 0.7
        continue
      }
      if (colour === 'brown') {
        brown = (brown + 0.017 * w) / 1.017
        d[i] = clamp(brown * 6.2, -1, 1)
        continue
      }
      if (colour === 'grain') {
        // Sparse impulsive texture — debris, gravel, rain on a steel deck.
        // Mostly silence with occasional fat hits, so the transient density is
        // in the source instead of being faked with an LFO later.
        const hitNow = gen() < 0.004
        d[i] = hitNow ? (gen() * 2 - 1) * (0.5 + gen() * 0.5) : w * 0.04
        continue
      }
      // Paul Kellet pink — flat-ish per octave, the honest bed for water/air.
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      d[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362) * 0.16, -1, 1)
    }
  }
  // Seamless loop. Every bed below plays these with `loop = true`; without a
  // crossfade the buffer's end butting onto its start is a sample-level step,
  // i.e. a broadband click on a fixed period — the single most obvious "this is
  // a loop" artefact there is, and it shows up as a vertical stripe on a
  // spectrogram. Equal-power (not linear) so the noise floor does not dip 3 dB
  // through the join.
  const xf = Math.min(Math.floor(ctx.sampleRate * 0.12), Math.floor(n / 4))
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < xf; i++) {
      const t = i / xf
      const a = Math.cos(t * Math.PI * 0.5)
      const b = Math.sin(t * Math.PI * 0.5)
      // Blend the pre-roll (which is about to be discarded) into the head.
      d[i] = d[i] * b + d[n - xf + i] * a
    }
    // The tail now duplicates the head's source material, so end the buffer at
    // the crossfade point by fading what remains into the (identical) head.
    for (let i = 0; i < xf; i++) d[n - xf + i] = d[i]
  }
  cache.noise.set(colour, buf)
  return buf
}

/** tanh soft clip, cached by drive. Thickens without the fizz of hard clipping. */
function shaperCurve(ctx, amount) {
  const cache = cacheFor(ctx)
  const key = Math.round(amount * 8)
  const hit = cache.curves.get(key)
  if (hit) return hit
  const n = 1024
  const curve = new Float32Array(n)
  const k = Math.max(0.001, amount)
  const norm = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  cache.curves.set(key, curve)
  return curve
}

function saturator(ctx, amount) {
  const ws = ctx.createWaveShaper()
  ws.curve = shaperCurve(ctx, amount)
  ws.oversample = '2x'
  return ws
}

/**
 * Master ceiling curve: transparent below -6 dBFS, bending to a hard 0.965 at
 * and beyond full scale. WaveShaper clamps its input to [-1, 1], so anything
 * hotter than unity lands on the last table entry and cannot get through.
 */
function ceilingCurve(ctx) {
  const cache = cacheFor(ctx)
  const hit = cache.curves.get('ceiling')
  if (hit) return hit
  const n = 2048
  const curve = new Float32Array(n)
  const knee = 0.5
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    const a = Math.abs(x)
    let y
    if (a <= knee) y = a
    else y = knee + (0.965 - knee) * Math.tanh((a - knee) / (0.965 - knee))
    curve[i] = Math.sign(x) * y
  }
  cache.curves.set('ceiling', curve)
  return curve
}

/**
 * A near-dirac click. This is the single most important layer in any gunshot or
 * impact: it is what puts a full-bandwidth vertical stripe on the spectrogram
 * and reads as "sharp" rather than "a whoosh". Filtered noise alone never gets
 * there because its energy is spread over milliseconds.
 */
function clickBuffer(ctx) {
  const cache = cacheFor(ctx)
  const hit = cache.impulse.get('click')
  if (hit) return hit
  const n = Math.max(16, Math.floor(ctx.sampleRate * 0.0025))
  // ~0.12 ms rise. A literal one-sample dirac measures as a full-scale step,
  // which is a DAC pop rather than a transient, and it is not what a muzzle
  // blast does either — the pressure front has a finite rise. This is short
  // enough to still put energy across the whole band.
  const rise = Math.max(3, Math.floor(ctx.sampleRate * 0.00012))
  const buf = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const gen = mulberry32(4242 + ch * 17)
    const d = buf.getChannelData(ch)
    for (let i = 0; i < n; i++) {
      const t = i / n
      const attack = i < rise ? Math.sin((i / rise) * Math.PI * 0.5) : 1
      d[i] = (0.35 + gen() * 0.65) * attack * Math.pow(1 - t, 5) * (ch === 0 ? 1 : 0.88)
    }
  }
  cache.impulse.set('click', buf)
  return buf
}

// ---------------------------------------------------------------------------
// Scheduling primitives
// ---------------------------------------------------------------------------

/**
 * Percussive gain envelope: fast linear attack (so the transient survives),
 * optional hold, exponential decay (so the tail is natural, not a gate).
 */
function envGain(ctx, t0, { peak = 1, attack = 0.0012, hold = 0, decay = 0.2 }) {
  const g = ctx.createGain()
  const p = Math.max(1e-4, peak)
  g.gain.setValueAtTime(1e-4, t0)
  g.gain.linearRampToValueAtTime(p, t0 + attack)
  if (hold > 0) g.gain.setValueAtTime(p, t0 + attack + hold)
  g.gain.exponentialRampToValueAtTime(1e-4, t0 + attack + hold + Math.max(0.005, decay))
  g.gain.setValueAtTime(0, t0 + attack + hold + Math.max(0.005, decay) + 0.001)
  return g
}

function biquad(ctx, type, freq, q = 0.7, gainDb = 0) {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = clamp(freq, 10, Math.min(20000, ctx.sampleRate * 0.48))
  f.Q.value = q
  if (gainDb) f.gain.value = gainDb
  return f
}

/**
 * One shaped noise layer. `chain` is an ordered list of filters to run it
 * through. Returns the tail node so callers can add a send.
 */
function noiseLayer(ctx, dest, t0, {
  colour = 'pink',
  duration = 0.1,
  peak = 0.4,
  attack = 0.0012,
  hold = 0,
  drive = 0,
  chain = [],
  playbackRate = 1
}) {
  const src = ctx.createBufferSource()
  const buf = noiseBuffer(ctx, colour)
  src.buffer = buf
  src.loop = true
  src.playbackRate.value = playbackRate
  const env = envGain(ctx, t0, { peak, attack, hold, decay: duration })
  let node = src
  for (const f of chain) {
    node.connect(f)
    node = f
  }
  if (drive > 0) {
    const ws = saturator(ctx, drive)
    node.connect(ws)
    node = ws
  }
  node.connect(env)
  env.connect(dest)
  const offset = rnd() * (buf.duration - duration - 0.05)
  src.start(t0, Math.max(0, offset))
  src.stop(t0 + attack + hold + duration + 0.06)
  return env
}

/** Pitched layer with an optional exponential glide — sub thumps and bodies. */
function toneLayer(ctx, dest, t0, {
  type = 'sine',
  freq = 80,
  freqEnd = null,
  duration = 0.3,
  peak = 0.4,
  attack = 0.002,
  hold = 0,
  detune = 0,
  drive = 0
}) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.detune.value = detune
  osc.frequency.setValueAtTime(clamp(freq, 8, 18000), t0)
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(
      clamp(freqEnd, 8, 18000),
      t0 + attack + hold + duration
    )
  }
  const env = envGain(ctx, t0, { peak, attack, hold, decay: duration })
  let node = osc
  if (drive > 0) {
    const ws = saturator(ctx, drive)
    osc.connect(ws)
    node = ws
  }
  node.connect(env)
  env.connect(dest)
  osc.start(t0)
  osc.stop(t0 + attack + hold + duration + 0.06)
  return env
}

/** The full-band snap. Level here is what "sharp" means on a spectrogram. */
function transientClick(ctx, dest, t0, { peak = 0.8, highpassHz = 0, drive = 0 }) {
  const src = ctx.createBufferSource()
  src.buffer = clickBuffer(ctx)
  let node = src
  if (highpassHz > 0) {
    const hp = biquad(ctx, 'highpass', highpassHz, 0.6)
    node.connect(hp)
    node = hp
  }
  if (drive > 0) {
    const ws = saturator(ctx, drive)
    node.connect(ws)
    node = ws
  }
  const g = ctx.createGain()
  g.gain.value = peak
  node.connect(g)
  g.connect(dest)
  src.start(t0)
  src.stop(t0 + 0.02)
}

// ---------------------------------------------------------------------------
// Distance model
// ---------------------------------------------------------------------------

const SPEED_OF_SOUND = 343

/**
 * Air absorption as a lowpass corner. Roughly matches ISO 9613 attenuation over
 * humid sea air: it takes ~10 kHz off by 400 m and leaves a sub-1 kHz thud past
 * 2 km. This is what makes a distant gun read as distance and not as volume.
 */
export function airAbsorptionHz(distanceM) {
  return clamp(19000 * Math.exp(-Math.max(0, distanceM) / 620), 320, 19000)
}

/** Inverse-square-ish falloff with a reference distance so close is not infinite. */
export function distanceGain(distanceM, refM = 22) {
  const d = Math.max(0, distanceM)
  return refM / (refM + d)
}

/** Seconds the report takes to arrive. */
export function arrivalDelay(distanceM) {
  return Math.max(0, distanceM) / SPEED_OF_SOUND
}

// ---------------------------------------------------------------------------
// Reverb — a 4-line Householder FDN
// ---------------------------------------------------------------------------

/**
 * Feedback-delay-network reverb whose delay times, damping and feedback are all
 * ramped, so "open sea → harbour → interior" is a continuous morph with no
 * click and no convolver buffer swap mid-tail.
 *
 * Householder feedback (y_i = x_i - 2/N * sum(x)) is orthogonal, which is why
 * the tail stays dense instead of collapsing into a flutter echo.
 */
export function createReverb(ctx, dest) {
  const input = ctx.createGain()
  const preDelay = ctx.createDelay(0.25)
  preDelay.delayTime.value = 0.012
  const inHp = biquad(ctx, 'highpass', 190, 0.6)
  const inLp = biquad(ctx, 'lowpass', 7200, 0.6)
  input.connect(preDelay).connect(inHp).connect(inLp)

  const wet = ctx.createGain()
  wet.gain.value = 1
  const merger = ctx.createChannelMerger(2)

  // Early reflections: a handful of hard taps give the space a size before the
  // diffuse tail arrives. Without these an FDN sounds like a wash, not a room.
  const early = [
    [0.0071, 0.62, 0],
    [0.0113, -0.5, 1],
    [0.0189, 0.42, 1],
    [0.0271, -0.34, 0],
    [0.0397, 0.26, 1],
    [0.0532, -0.2, 0]
  ]
  const earlyDelays = []
  for (const [time, gain, ch] of early) {
    const d = ctx.createDelay(0.4)
    d.delayTime.value = time
    const g = ctx.createGain()
    g.gain.value = gain * 0.55
    inLp.connect(d).connect(g).connect(merger, 0, ch)
    earlyDelays.push({ delay: d, base: time })
  }

  // Prime sample counts / 1e6: the ratios are as far from small integers as
  // practical, so no two lines reinforce the same frequency.
  const BASE = [0.029717, 0.037013, 0.044087, 0.052291]
  const N = BASE.length
  const sum = ctx.createGain()
  sum.gain.value = 1
  const house = ctx.createGain()
  house.gain.value = -2 / N
  sum.connect(house)

  // Slow, tiny, mutually incommensurate delay modulation. Without it a 4-line
  // FDN rings on its modes and sounds like a metal pipe; this is the standard
  // fix and costs 4 oscillators.
  const modOscs = []
  const lines = []
  for (let i = 0; i < N; i++) {
    const delay = ctx.createDelay(1.2)
    delay.delayTime.value = BASE[i]
    const mod = ctx.createOscillator()
    mod.type = 'sine'
    mod.frequency.value = 0.11 + i * 0.083
    const modDepth = ctx.createGain()
    modDepth.gain.value = 0.00035 + i * 0.00012
    mod.connect(modDepth).connect(delay.delayTime)
    mod.start(0)
    modOscs.push(mod)
    const damp = biquad(ctx, 'lowpass', 4200, 0.5)
    const lowCut = biquad(ctx, 'highpass', 150, 0.5)
    const fb = ctx.createGain()
    fb.gain.value = 0.72
    const mix = ctx.createGain() // line input summing node

    inLp.connect(mix)
    mix.connect(delay).connect(damp).connect(lowCut)
    lowCut.connect(sum)
    // Householder: own signal + (-2/N)·sum, scaled by feedback.
    lowCut.connect(fb)
    house.connect(fb)
    fb.connect(mix)
    lowCut.connect(merger, 0, i % 2)
    lines.push({ delay, damp, fb, base: BASE[i] })
  }

  merger.connect(wet).connect(dest)

  const ramp = (param, value, tc = 0.35) => {
    const now = ctx.currentTime
    try {
      param.cancelScheduledValues(now)
      param.setTargetAtTime(value, now, tc)
    } catch {
      param.value = value
    }
  }

  /**
   * @param {{ size:number, decay:number, damping:number, preDelay:number,
   *           wet:number, earlyScale:number }} p
   */
  function set(p, tc = 0.6) {
    for (const line of lines) {
      ramp(line.delay.delayTime, line.base * p.size, tc)
      ramp(line.damp.frequency, p.damping, tc)
      ramp(line.fb.gain, clamp(p.decay, 0, 0.93), tc)
    }
    // Early reflections move with the room. This is most of what tells a
    // listener "small" from "big" before the tail even arrives.
    for (const e of earlyDelays) ramp(e.delay.delayTime, clamp(e.base * p.size, 0.001, 0.38), tc)
    ramp(preDelay.delayTime, clamp(p.preDelay, 0, 0.24), tc)
    ramp(wet.gain, p.wet, tc)
  }

  return { input, set, output: wet }
}

/** Named spaces. Interiors are small, dark and close; open water is a long, dark, sparse wash. */
export const REVERB_SPACES = {
  open: { size: 2.35, decay: 0.6, damping: 2800, preDelay: 0.035, wet: 0.55 },
  harbour: { size: 1.35, decay: 0.78, damping: 3400, preDelay: 0.018, wet: 0.9 },
  interior: { size: 0.42, decay: 0.66, damping: 2100, preDelay: 0.004, wet: 1.25 },
  storm: { size: 2.6, decay: 0.5, damping: 900, preDelay: 0.045, wet: 0.42 }
}

// ---------------------------------------------------------------------------
// Master chain
// ---------------------------------------------------------------------------

/**
 * The whole output stage in one place so the probe grades exactly what the game
 * plays: named buses → glue compressor → makeup → brickwall limiter →
 * safety soft clip. Nothing downstream of the limiter can exceed unity, so the
 * master bus cannot clip the DAC however many voices stack.
 */
/** Static bus balance. Everything else in the mix is relative to these. */
export const BUS_LEVELS = {
  weapon: 1.0,
  impact: 1.0,
  engine: 0.42,
  sea: 0.3,
  weather: 0.3,
  ui: 0.7,
  voice: 0.95,
  music: 0.5
}

export function createMaster(ctx, destination = ctx.destination) {
  // Final ceiling. `oversample` is deliberately off here: the 2x resampling
  // filters ring, and that overshoot is exactly what pushed the bus above
  // 0 dBFS. This runs after the limiter and should barely engage, so aliasing
  // is not a concern; a hard guarantee of headroom is.
  const softClip = ctx.createWaveShaper()
  softClip.curve = ceilingCurve(ctx)
  softClip.oversample = 'none'
  softClip.connect(destination)

  // Brickwall: fast attack, low threshold, high ratio. Followed by the
  // waveshaper above, which catches the few samples the compressor's attack
  // cannot.
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -1.5
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.0008
  limiter.release.value = 0.09
  limiter.connect(softClip)

  const makeup = ctx.createGain()
  makeup.gain.value = 1.45
  makeup.connect(limiter)

  // Glue: soft knee, moderate ratio. Holds the mix together without pumping the
  // ambience every time a gun goes off.
  const glue = ctx.createDynamicsCompressor()
  glue.threshold.value = -16
  glue.knee.value = 14
  glue.ratio.value = 4
  glue.attack.value = 0.004
  glue.release.value = 0.22
  glue.connect(makeup)

  const master = ctx.createGain()
  master.connect(glue)

  const reverb = createReverb(ctx, master)
  reverb.set(REVERB_SPACES.open, 0.001)

  const reverbSend = ctx.createGain()
  reverbSend.gain.value = 1
  reverbSend.connect(reverb.input)

  /**
   * Buses. Each has a `level` (static mix balance + user volume) and a `duck`
   * (dynamic, driven by what is happening). Beds sit well below the events they
   * are supposed to sit under — an ambient bed voiced at the same level as a
   * gunshot leaves the gunshot nowhere to go.
   */
  const buses = {}
  for (const [name, lvl] of Object.entries(BUS_LEVELS)) {
    const duck = ctx.createGain()
    const level = ctx.createGain()
    level.gain.value = lvl
    duck.connect(level).connect(master)
    buses[name] = { input: duck, duck: duck.gain, level: level.gain, node: level }
  }

  // Per-bus reverb send amounts: guns and impacts want the space, the sea bed
  // already *is* the space and would turn to mush if sent to it.
  const sends = { weapon: 0.34, impact: 0.4, engine: 0.09, sea: 0, weather: 0.05, ui: 0, voice: 0.14, music: 0 }
  for (const [name, amt] of Object.entries(sends)) {
    if (amt <= 0) continue
    const s = ctx.createGain()
    s.gain.value = amt
    buses[name].node.connect(s).connect(reverbSend)
  }

  return { master, buses, reverb, reverbSend, limiter, glue, makeup, destination: master }
}

// ---------------------------------------------------------------------------
// Weapons
// ---------------------------------------------------------------------------

/**
 * Per-class voicing. `crack` is the muzzle blast band, `body` the propellant
 * roar, `sub` the mount taking recoil into the deck, `mech` the action.
 * Everything else is derived so adding a class is one row, not a new function.
 */
export const WEAPON_CLASSES = {
  deckgun: {
    crackHz: 3000, crackDecay: 0.028, bodyHz: 620, bodyDecay: 0.13,
    subHz: 88, subEnd: 34, subDecay: 0.42, drive: 3.4, level: 1.0,
    mech: 'breech', tail: 0.9, casing: 0.11
  },
  autocannon: {
    crackHz: 4200, crackDecay: 0.016, bodyHz: 900, bodyDecay: 0.06,
    subHz: 130, subEnd: 58, subDecay: 0.16, drive: 2.4, level: 0.62,
    mech: 'bolt', tail: 0.4, casing: 0.08
  },
  chaingun: {
    crackHz: 5200, crackDecay: 0.011, bodyHz: 1250, bodyDecay: 0.04,
    subHz: 175, subEnd: 82, subDecay: 0.1, drive: 1.9, level: 0.5,
    mech: 'servo', tail: 0.26, casing: 0.055
  },
  rivet: {
    crackHz: 1700, crackDecay: 0.03, bodyHz: 420, bodyDecay: 0.1,
    subHz: 70, subEnd: 30, subDecay: 0.3, drive: 2.8, level: 0.7,
    mech: 'ram', tail: 0.5, casing: 0
  },
  railgun: {
    crackHz: 7200, crackDecay: 0.035, bodyHz: 1150, bodyDecay: 0.19,
    subHz: 70, subEnd: 30, subDecay: 0.26, drive: 2.2, level: 0.85,
    mech: 'coil', tail: 0.5, casing: 0
  },
  sidearm: {
    crackHz: 3800, crackDecay: 0.018, bodyHz: 800, bodyDecay: 0.055,
    subHz: 120, subEnd: 52, subDecay: 0.14, drive: 2.2, level: 0.45,
    mech: 'bolt', tail: 0.3, casing: 0.07
  }
}

/** Mechanical layers — breech, casing, servo. Cheap, and they sell the machine. */
function mechLayer(ctx, dest, t0, kind, level) {
  if (kind === 'breech') {
    noiseLayer(ctx, dest, t0 + 0.026 * jitter(0.15), {
      colour: 'white', duration: 0.02, peak: level * 0.3, drive: 2,
      chain: [biquad(ctx, 'bandpass', 1500 * jitter(0.1), 5)]
    })
    toneLayer(ctx, dest, t0 + 0.028, {
      type: 'square', freq: 320, freqEnd: 210, duration: 0.03, peak: level * 0.14
    })
    // Breech closing again — the second, softer clack.
    noiseLayer(ctx, dest, t0 + 0.085 * jitter(0.2), {
      colour: 'white', duration: 0.028, peak: level * 0.2, drive: 1.6,
      chain: [biquad(ctx, 'bandpass', 1050 * jitter(0.12), 4)]
    })
  } else if (kind === 'bolt') {
    noiseLayer(ctx, dest, t0 + 0.018, {
      colour: 'white', duration: 0.014, peak: level * 0.26, drive: 2.4,
      chain: [biquad(ctx, 'bandpass', 2400 * jitter(0.14), 6)]
    })
    noiseLayer(ctx, dest, t0 + 0.042, {
      colour: 'white', duration: 0.018, peak: level * 0.18, drive: 1.8,
      chain: [biquad(ctx, 'bandpass', 1400 * jitter(0.14), 5)]
    })
  } else if (kind === 'servo') {
    // Feed motor whirr — a short pitched buzz, the thing that separates a
    // chain gun from a rifle firing quickly.
    toneLayer(ctx, dest, t0 + 0.012, {
      type: 'sawtooth', freq: 720 * jitter(0.08), freqEnd: 520, duration: 0.05,
      peak: level * 0.075, drive: 1.4
    })
    noiseLayer(ctx, dest, t0 + 0.014, {
      colour: 'white', duration: 0.03, peak: level * 0.13,
      chain: [biquad(ctx, 'bandpass', 3100, 7)]
    })
  } else if (kind === 'ram') {
    toneLayer(ctx, dest, t0 + 0.004, {
      type: 'triangle', freq: 1350, freqEnd: 780, duration: 0.16, peak: level * 0.2
    })
    noiseLayer(ctx, dest, t0 + 0.05, {
      colour: 'white', duration: 0.05, peak: level * 0.16, drive: 2.2,
      chain: [biquad(ctx, 'bandpass', 1900, 3)]
    })
  } else if (kind === 'coil') {
    // Capacitor bank dumping, then the field collapsing.
    toneLayer(ctx, dest, t0 - 0.03, {
      type: 'sawtooth', freq: 130, freqEnd: 2600, duration: 0.032, peak: level * 0.14, attack: 0.02
    })
    toneLayer(ctx, dest, t0 + 0.01, {
      type: 'sawtooth', freq: 2200, freqEnd: 240, duration: 0.12, peak: level * 0.1, drive: 1.5
    })
  }
}

/** Brass on steel deck — three staggered inharmonic pings with a random pitch. */
function casingBounce(ctx, dest, t0, level) {
  const base = 2600 * jitter(0.25)
  // Irregular spacing and a steep drop: brass tumbling, not a triplet. Evenly
  // spaced pings read as a rhythm and show up on a spectrogram as three
  // identical bars, which is a dead giveaway that it was sequenced.
  let t = t0 + 0.13 + rnd() * 0.09
  for (let i = 0; i < 3; i++) {
    t += i === 0 ? 0 : 0.05 + rnd() * 0.16
    const f = base * (1 + i * 0.11) * jitter(0.06)
    const amp = level * (0.5 - i * 0.17)
    toneLayer(ctx, dest, t, { type: 'triangle', freq: f, freqEnd: f * 0.94, duration: 0.05, peak: amp, attack: 0.0006 })
    toneLayer(ctx, dest, t, { type: 'sine', freq: f * 1.67, duration: 0.035, peak: amp * 0.45, attack: 0.0006 })
    noiseLayer(ctx, dest, t, {
      colour: 'white', duration: 0.008, peak: amp * 0.7, drive: 3,
      chain: [biquad(ctx, 'highpass', 2200, 0.7)]
    })
  }
}

/**
 * A gun going off.
 *
 * @param {object} o
 * @param {keyof typeof WEAPON_CLASSES} [o.weaponClass]
 * @param {number} [o.distance]  metres. Drives air absorption, arrival delay,
 *   the crack/body balance (near = crack, far = thud) and the number of
 *   returning reflections.
 * @param {number} [o.level]
 * @param {AudioNode} [o.sendTo] reverb send tap
 */
export function gunShot(ctx, dest, t0, o = {}) {
  const spec = WEAPON_CLASSES[o.weaponClass] ?? WEAPON_CLASSES.deckgun
  const dist = Math.max(0, o.distance ?? 0)
  const near = clamp(1 - dist / 900, 0, 1)
  const level = (o.level ?? 1) * spec.level * distanceGain(dist, 30)
  if (level < 0.0015) return

  // One air-absorption filter for the whole shot, then per-layer shaping. A
  // single filter is both cheaper and physically right: the air does not filter
  // the crack and the body differently.
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(dist), 0.5)
  const out = ctx.createGain()
  out.gain.value = 1
  air.connect(out).connect(dest)
  const t = t0 + arrivalDelay(dist)

  // Snap. Falls away with distance far faster than the body does — that is the
  // entire "near shots crack, far shots thud" mechanism.
  const crackAmt = level * (0.4 + near * 1.05)
  transientClick(ctx, air, t, { peak: crackAmt * 0.95, highpassHz: 700, drive: 1.4 })
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: spec.crackDecay, peak: crackAmt * 1.05, drive: spec.drive * 1.2,
    chain: [
      biquad(ctx, 'highpass', spec.crackHz * 0.34, 0.7),
      biquad(ctx, 'peaking', spec.crackHz, 1.1, 9)
    ]
  })
  // Top octave. Without a layer that lives above 6 kHz the shot reads as a
  // muffled thump no matter how loud the crack band is — this is the "edge".
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: spec.crackDecay * 0.55, peak: crackAmt * 0.5, drive: 1.2,
    chain: [biquad(ctx, 'highpass', 6200, 0.6), biquad(ctx, 'peaking', 11000, 0.9, 6)]
  })
  // Muzzle blast body — propellant, brake, the "boom" under the crack.
  noiseLayer(ctx, air, t + 0.0015, {
    colour: 'pink', duration: spec.bodyDecay, peak: level * 1.15, drive: spec.drive,
    chain: [
      biquad(ctx, 'highpass', 110, 0.6),
      biquad(ctx, 'lowpass', spec.bodyHz * 3.4, 0.8),
      biquad(ctx, 'peaking', spec.bodyHz, 0.9, 8)
    ]
  })
  // Upper-mid bite: the band that actually survives across a room, and the one
  // that keeps a gun audible over a diesel.
  noiseLayer(ctx, air, t + 0.001, {
    colour: 'pink', duration: spec.bodyDecay * 0.6, peak: level * 0.7, drive: spec.drive * 0.8,
    chain: [biquad(ctx, 'bandpass', spec.crackHz * 0.42, 0.8)]
  })
  // Sub: the mount loading the deck. Two glides so the low end has movement.
  // Kept deliberately under the body — a gunshot is punch, not a sub test.
  toneLayer(ctx, air, t, {
    type: 'sine', freq: spec.subHz, freqEnd: spec.subEnd, duration: spec.subDecay,
    peak: level * 0.5, attack: 0.0022, drive: 0.7
  })
  toneLayer(ctx, air, t + 0.006, {
    type: 'sine', freq: spec.subHz * 0.52, freqEnd: spec.subEnd * 0.55,
    duration: spec.subDecay * 1.35, peak: level * 0.22, attack: 0.004
  })
  // Rolling report over open water. Longer and louder the further you are.
  const tailLen = spec.tail * (0.7 + dist / 700)
  noiseLayer(ctx, air, t + 0.02, {
    colour: 'brown', duration: tailLen, peak: level * (0.11 + (1 - near) * 0.42), drive: 1.6,
    chain: [biquad(ctx, 'highpass', 45, 0.6), biquad(ctx, 'lowpass', 420 + near * 500, 0.7)]
  })

  mechLayer(ctx, out, t, spec.mech, level)
  if (spec.casing > 0 && near > 0.5) casingBounce(ctx, out, t, level * spec.casing)

  // Discrete returns off the water and whatever land is out there. Only
  // meaningful at range; up close the reverb bus covers it.
  if (dist > 180) {
    const echoes = dist > 900 ? 3 : 2
    for (let i = 0; i < echoes; i++) {
      const et = t + 0.26 + i * (0.31 + rnd() * 0.22) + dist / 4200
      noiseLayer(ctx, out, et, {
        colour: 'brown', duration: 0.5 + i * 0.35, peak: level * (0.3 - i * 0.08) * (1 - near),
        drive: 1.2,
        chain: [biquad(ctx, 'highpass', 50, 0.6), biquad(ctx, 'lowpass', 320 - i * 70, 0.7)]
      })
    }
  }
  if (o.sendTo) out.connect(o.sendTo)
}

/** Tube launch: pressure, the fish leaving, then motor burn receding. */
export function launcherFire(ctx, dest, t0, o = {}) {
  const kind = o.kind ?? 'missile' // 'harpoon' | 'missile' | 'torpedo'
  const dist = Math.max(0, o.distance ?? 0)
  const level = (o.level ?? 1) * distanceGain(dist, 30)
  if (level < 0.0015) return
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(dist), 0.5)
  air.connect(dest)
  const t = t0 + arrivalDelay(dist)

  const deep = kind === 'torpedo'
  const subHz = deep ? 44 : kind === 'harpoon' ? 96 : 74

  transientClick(ctx, air, t, { peak: level * (deep ? 0.85 : 0.7), highpassHz: 300, drive: 1.2 })
  // Tube pressure release — bright enough to be an event, not a fade-in.
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: 0.03, peak: level * 0.5, drive: 2,
    chain: [biquad(ctx, 'highpass', 2600, 0.6), biquad(ctx, 'peaking', 6000, 0.9, 5)]
  })
  // Gas / compressed air slamming it out of the tube.
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: deep ? 0.11 : 0.07, peak: level * 0.6, drive: 2.6,
    chain: [biquad(ctx, 'highpass', deep ? 180 : 500, 0.7), biquad(ctx, 'lowpass', deep ? 1600 : 4200, 0.7)]
  })
  toneLayer(ctx, air, t, {
    type: 'sine', freq: subHz, freqEnd: subHz * 0.4, duration: deep ? 0.9 : 0.45,
    peak: level * 0.8, attack: 0.003
  })
  // Motor burn / line running out, receding via a falling filter.
  const burn = ctx.createBufferSource()
  burn.buffer = noiseBuffer(ctx, 'brown')
  burn.loop = true
  const burnBp = biquad(ctx, 'bandpass', deep ? 380 : 900, 0.8)
  const burnLp = biquad(ctx, 'lowpass', 3000, 0.7)
  burnLp.frequency.setValueAtTime(3200, t)
  burnLp.frequency.exponentialRampToValueAtTime(deep ? 300 : 600, t + 1.5)
  const burnG = envGain(ctx, t + 0.03, { peak: level * 0.34, attack: 0.05, hold: 0.25, decay: 1.3 })
  const burnSat = saturator(ctx, 1.8)
  burn.connect(burnBp).connect(burnSat).connect(burnLp).connect(burnG).connect(air)
  burn.start(t, rnd() * 4)
  burn.stop(t + 1.9)

  if (deep) {
    // Water entry and screw bite.
    waterImpact(ctx, dest, t + 0.16, { level: level * 0.32, distance: dist })
  }
}

// ---------------------------------------------------------------------------
// Impacts and explosions
// ---------------------------------------------------------------------------

/** Steel taking a round: bright shear, ringing plate, dull structural thud. */
export function hullImpact(ctx, dest, t0, o = {}) {
  const dist = Math.max(0, o.distance ?? 0)
  const level = (o.level ?? 1) * distanceGain(dist, 24)
  if (level < 0.0015) return
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(dist), 0.5)
  air.connect(dest)
  const t = t0 + arrivalDelay(dist)

  transientClick(ctx, air, t, { peak: level * 0.95, highpassHz: 1200, drive: 1.6 })
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: 0.02, peak: level * 0.95, drive: 3,
    chain: [biquad(ctx, 'bandpass', 3400 * jitter(0.2), 1.4)]
  })
  // Shear off the plate — the bright edge that says "steel", not "wood".
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: 0.012, peak: level * 0.6, drive: 1.6,
    chain: [biquad(ctx, 'highpass', 6500, 0.6), biquad(ctx, 'peaking', 10500, 0.9, 6)]
  })
  // Plate ring — inharmonic partials, otherwise it is a bell and not a bulkhead.
  const f0 = (280 + rnd() * 220)
  for (const [mul, amp, dec] of [[1, 0.42, 0.22], [1.59, 0.26, 0.16], [2.41, 0.16, 0.11], [3.77, 0.09, 0.07]]) {
    toneLayer(ctx, air, t + 0.001, {
      type: 'triangle', freq: f0 * mul, freqEnd: f0 * mul * 0.985,
      duration: dec, peak: level * amp, attack: 0.0008
    })
  }
  noiseLayer(ctx, air, t + 0.004, {
    colour: 'pink', duration: 0.09, peak: level * 0.4, drive: 2.2,
    chain: [biquad(ctx, 'lowpass', 900, 0.8), biquad(ctx, 'peaking', 420, 0.9, 6)]
  })
  toneLayer(ctx, air, t, {
    type: 'sine', freq: 96, freqEnd: 42, duration: 0.2, peak: level * 0.5, attack: 0.002
  })
  // Debris off the plate.
  noiseLayer(ctx, air, t + 0.03, {
    colour: 'grain', duration: 0.3, peak: level * 0.2,
    chain: [biquad(ctx, 'bandpass', 2600, 0.9)]
  })
}

/** Round into open water: no crack at all — a cavity, a slap, then droplets. */
export function waterImpact(ctx, dest, t0, o = {}) {
  const dist = Math.max(0, o.distance ?? 0)
  const level = (o.level ?? 1) * distanceGain(dist, 24)
  if (level < 0.0015) return
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(dist), 0.5)
  air.connect(dest)
  const t = t0 + arrivalDelay(dist)

  // Surface slap: broadband but soft-fronted. Deliberately no click layer —
  // that is the whole difference between water and steel.
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: 0.05, peak: level * 0.62, attack: 0.004, drive: 1.3,
    chain: [biquad(ctx, 'highpass', 500, 0.6), biquad(ctx, 'lowpass', 9000, 0.7)]
  })
  // Fine spray leaving the surface. Still soft-fronted: no click layer, because
  // the absence of a hard transient is exactly what makes water read as water.
  noiseLayer(ctx, air, t + 0.002, {
    colour: 'white', duration: 0.035, peak: level * 0.3, attack: 0.005,
    chain: [biquad(ctx, 'highpass', 5000, 0.6)]
  })
  // The cavity: a resonance that drops as the hole opens. This is the "gloop".
  const cav = biquad(ctx, 'bandpass', 900, 6)
  cav.frequency.setValueAtTime(1100 * jitter(0.2), t)
  cav.frequency.exponentialRampToValueAtTime(180, t + 0.28)
  noiseLayer(ctx, air, t + 0.006, {
    colour: 'pink', duration: 0.3, peak: level * 0.75, attack: 0.006, chain: [cav]
  })
  // Body of displaced water.
  noiseLayer(ctx, air, t + 0.01, {
    colour: 'brown', duration: 0.42, peak: level * 0.5, attack: 0.01, drive: 1.2,
    chain: [biquad(ctx, 'lowpass', 480, 0.7)]
  })
  toneLayer(ctx, air, t + 0.008, {
    type: 'sine', freq: 190, freqEnd: 62, duration: 0.26, peak: level * 0.32, attack: 0.008
  })
  // Spray coming back down.
  noiseLayer(ctx, air, t + 0.14, {
    colour: 'grain', duration: 0.75, peak: level * 0.24, attack: 0.05,
    chain: [biquad(ctx, 'highpass', 1800, 0.6), biquad(ctx, 'bandpass', 4200, 0.6)]
  })
}

/** Round into rock, timber or concrete: dust and mass, no ring. */
export function terrainImpact(ctx, dest, t0, o = {}) {
  const dist = Math.max(0, o.distance ?? 0)
  const level = (o.level ?? 1) * distanceGain(dist, 24)
  if (level < 0.0015) return
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(dist), 0.5)
  air.connect(dest)
  const t = t0 + arrivalDelay(dist)

  transientClick(ctx, air, t, { peak: level * 0.7, highpassHz: 500, drive: 1.2 })
  // Stone chips and dust leaving the surface.
  noiseLayer(ctx, air, t, {
    colour: 'white', duration: 0.018, peak: level * 0.45, drive: 2,
    chain: [biquad(ctx, 'highpass', 3800, 0.6), biquad(ctx, 'peaking', 7200, 0.9, 5)]
  })
  noiseLayer(ctx, air, t, {
    colour: 'pink', duration: 0.06, peak: level * 0.72, drive: 2.4,
    chain: [biquad(ctx, 'lowpass', 1400, 0.8), biquad(ctx, 'peaking', 520, 1, 6)]
  })
  toneLayer(ctx, air, t, {
    type: 'sine', freq: 110, freqEnd: 44, duration: 0.24, peak: level * 0.6, attack: 0.0025
  })
  noiseLayer(ctx, air, t + 0.02, {
    colour: 'grain', duration: 0.55, peak: level * 0.28,
    chain: [biquad(ctx, 'bandpass', 1700, 0.8)]
  })
  noiseLayer(ctx, air, t + 0.01, {
    colour: 'brown', duration: 0.5, peak: level * 0.3, drive: 1.4,
    chain: [biquad(ctx, 'lowpass', 260, 0.7)]
  })
}

/**
 * Explosion.
 *
 * @param {object} o
 * @param {number} [o.size] 0.4 small charge … 1.6 magazine going up
 * @param {'air'|'water'|'hull'} [o.medium]
 * @param {number} [o.distance]
 */
export function explosion(ctx, dest, t0, o = {}) {
  const size = clamp(o.size ?? 1, 0.25, 2)
  const dist = Math.max(0, o.distance ?? 0)
  const medium = o.medium ?? 'air'
  const level = (o.level ?? 1) * distanceGain(dist, 42)
  if (level < 0.0015) return
  const near = clamp(1 - dist / 1400, 0, 1)
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(dist), 0.5)
  const out = ctx.createGain()
  air.connect(out).connect(dest)
  const t = t0 + arrivalDelay(dist)

  if (medium !== 'water') {
    transientClick(ctx, air, t, { peak: level * 0.9 * near, highpassHz: 400, drive: 1.5 })
    noiseLayer(ctx, air, t, {
      colour: 'white', duration: 0.035 * size, peak: level * 1.0 * (0.3 + near * 0.8), drive: 3.2,
      chain: [biquad(ctx, 'highpass', 900, 0.7), biquad(ctx, 'peaking', 3200, 1, 8)]
    })
    // Top octave of the flash.
    noiseLayer(ctx, air, t, {
      colour: 'white', duration: 0.02 * size, peak: level * 0.55 * near, drive: 1.4,
      chain: [biquad(ctx, 'highpass', 7000, 0.6), biquad(ctx, 'peaking', 12000, 0.8, 6)]
    })
  }
  // The rip. Debris and gas tearing through the mid band — the layer that makes
  // an explosion sound violent rather than merely large.
  noiseLayer(ctx, air, t + 0.001, {
    colour: 'white', duration: 0.22 * size, peak: level * 0.8, attack: 0.0018, drive: 3.4,
    chain: [
      biquad(ctx, 'bandpass', 1100, 0.5),
      biquad(ctx, 'peaking', 2600, 0.9, 7),
      biquad(ctx, 'highpass', 380, 0.6)
    ]
  })
  noiseLayer(ctx, air, t + 0.004, {
    colour: 'pink', duration: 0.95 * size, peak: level * 0.55, attack: 0.006, drive: 2.4,
    chain: [biquad(ctx, 'bandpass', 700, 0.55)]
  })
  // Blast body — the loud part. Heavily driven pink through a falling lowpass.
  const bodyLp = biquad(ctx, 'lowpass', 2200, 0.8)
  bodyLp.frequency.setValueAtTime(2600, t)
  bodyLp.frequency.exponentialRampToValueAtTime(220, t + 0.5 * size)
  noiseLayer(ctx, air, t + 0.002, {
    colour: 'pink', duration: 0.42 * size, peak: level * 1.0, attack: 0.0025, drive: 3.6,
    chain: [biquad(ctx, 'highpass', 60, 0.6), bodyLp]
  })
  // Low-end body: the pressure wave. Long glide, this is the chest hit.
  toneLayer(ctx, air, t, {
    type: 'sine', freq: 108 * size, freqEnd: 22, duration: 0.95 * size, peak: level * 0.8, attack: 0.004
  })
  toneLayer(ctx, air, t + 0.02, {
    type: 'sine', freq: 62 * size, freqEnd: 17, duration: 1.0 * size, peak: level * 0.45, attack: 0.01
  })
  toneLayer(ctx, air, t + 0.008, {
    type: 'triangle', freq: 150 * size, freqEnd: 36, duration: 0.5 * size, peak: level * 0.3,
    attack: 0.003, drive: 1.6
  })
  // Rumble tail — brown noise under a long decay.
  noiseLayer(ctx, air, t + 0.04, {
    colour: 'brown', duration: 1.05 * size, peak: level * 0.34, attack: 0.02, drive: 2.2,
    chain: [biquad(ctx, 'highpass', 32, 0.6), biquad(ctx, 'lowpass', 180, 0.7)]
  })
  // Debris: sparse grain scatter well after the shock, plus a few discrete
  // metal pieces if it was a hull.
  noiseLayer(ctx, out, t + 0.12, {
    colour: 'grain', duration: 1.5 * size, peak: level * 0.3, attack: 0.06,
    chain: [biquad(ctx, 'highpass', 900, 0.6), biquad(ctx, 'bandpass', 2400, 0.5)]
  })
  if (medium === 'hull') {
    for (let i = 0; i < 5; i++) {
      const dt = t + 0.25 + rnd() * 1.3
      const f = 900 + rnd() * 2600
      toneLayer(ctx, out, dt, {
        type: 'triangle', freq: f, freqEnd: f * 0.93, duration: 0.09, peak: level * 0.13 * near, attack: 0.0008
      })
    }
    // Structure groaning as it fails.
    toneLayer(ctx, out, t + 0.5, {
      type: 'sawtooth', freq: 118, freqEnd: 74, duration: 1.1, peak: level * 0.09, attack: 0.15, drive: 1.4
    })
  }
  if (medium === 'water') {
    // Muffled: water swallows the crack and returns a plume.
    noiseLayer(ctx, air, t + 0.05, {
      colour: 'brown', duration: 0.9 * size, peak: level * 0.55, attack: 0.02, drive: 1.8,
      chain: [biquad(ctx, 'lowpass', 320, 0.8)]
    })
    waterImpact(ctx, out, t + 0.22, { level: level * 0.9, distance: 0 })
    noiseLayer(ctx, out, t + 0.45, {
      colour: 'grain', duration: 1.8, peak: level * 0.22, attack: 0.12,
      chain: [biquad(ctx, 'highpass', 1200, 0.6)]
    })
  }
  // Distant returns.
  if (dist > 250) {
    for (let i = 0; i < 3; i++) {
      const et = t + 0.4 + i * (0.42 + rnd() * 0.3) + dist / 3800
      noiseLayer(ctx, out, et, {
        colour: 'brown', duration: 0.9 + i * 0.5, peak: level * (0.34 - i * 0.09) * (1 - near * 0.6),
        attack: 0.05, drive: 1.2,
        chain: [biquad(ctx, 'highpass', 40, 0.6), biquad(ctx, 'lowpass', 260 - i * 55, 0.7)]
      })
    }
  }
}

/** Rock / hulk breaking apart — grinding fracture rather than a chemical boom. */
export function rockBurst(ctx, dest, t0, o = {}) {
  const level = o.level ?? 1
  explosion(ctx, dest, t0, { size: 1.15, medium: 'air', level: level * 0.7, distance: o.distance ?? 0 })
  // Stone shear: mid-band grinding, slower than powder.
  noiseLayer(ctx, dest, t0 + 0.03, {
    colour: 'pink', duration: 0.9, peak: level * 0.42, attack: 0.02, drive: 2.6,
    chain: [biquad(ctx, 'bandpass', 900, 0.6), biquad(ctx, 'peaking', 2200, 1.2, 5)]
  })
  for (let i = 0; i < 7; i++) {
    const dt = t0 + 0.18 + rnd() * 1.5
    noiseLayer(ctx, dest, dt, {
      colour: 'white', duration: 0.05 + rnd() * 0.08, peak: level * 0.16, drive: 2,
      chain: [biquad(ctx, 'bandpass', 700 + rnd() * 2600, 2.4)]
    })
  }
  noiseLayer(ctx, dest, t0 + 0.5, {
    colour: 'grain', duration: 2.2, peak: level * 0.26, attack: 0.15,
    chain: [biquad(ctx, 'bandpass', 1400, 0.7)]
  })
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

/**
 * Thunder. Distance drives everything: pre-delay before the report arrives, how
 * much crack survives the air, how long the roll runs, and how many returns
 * come back off the water.
 */
export function thunder(ctx, dest, t0, o = {}) {
  const km = clamp(o.distanceKm ?? 1.5, 0.08, 12)
  const level = (o.level ?? 1) * clamp(1.35 / (0.35 + km * 0.55), 0.05, 1.4)
  const near = clamp(1 - (km - 0.1) / 3.2, 0, 1)
  const air = biquad(ctx, 'lowpass', airAbsorptionHz(km * 1000 * 0.55), 0.5)
  air.connect(dest)
  // Real pre-delay: sound takes ~3 s/km. Callers that already staggered the
  // flash pass `skipPreDelay`.
  const t = t0 + (o.skipPreDelay ? 0 : (km * 1000) / SPEED_OF_SOUND)

  if (near > 0.25) {
    // The rip: a close strike is a tearing crack, not a boom.
    transientClick(ctx, air, t, { peak: level * near * 1.3, highpassHz: 1500, drive: 1.4 })
    for (let i = 0; i < 5; i++) {
      noiseLayer(ctx, air, t + i * (0.012 + rnd() * 0.03), {
        colour: 'white', duration: 0.03 + rnd() * 0.05, peak: level * near * (1.15 - i * 0.19), drive: 2.6,
        chain: [biquad(ctx, 'highpass', 1100, 0.7), biquad(ctx, 'peaking', 2600 + rnd() * 2600, 1.2, 7)]
      })
    }
    // Top of the strike. A close lightning crack is genuinely brilliant; the
    // rumble underneath is the part that survives distance, not this.
    noiseLayer(ctx, air, t, {
      colour: 'white', duration: 0.045, peak: level * near * 0.8, drive: 1.6,
      chain: [biquad(ctx, 'highpass', 5500, 0.6), biquad(ctx, 'peaking', 9500, 0.9, 6)]
    })
  }
  // Pressure boom.
  toneLayer(ctx, air, t + 0.01, {
    type: 'sine', freq: 52 + near * 22, freqEnd: 16, duration: 1.6 + (1 - near) * 1.4,
    peak: level * (0.9 - near * 0.32), attack: 0.012 + (1 - near) * 0.06
  })
  toneLayer(ctx, air, t + 0.05, {
    type: 'sine', freq: 34, freqEnd: 13, duration: 2.4 + (1 - near) * 1.6, peak: level * 0.55, attack: 0.05
  })
  // Rolling body: several overlapping brown swells at drifting delays, which is
  // what makes thunder roll instead of just decaying.
  const rollLen = 2.4 + (1 - near) * 2.6
  for (let i = 0; i < 4; i++) {
    const dt = t + 0.06 + i * (0.28 + rnd() * 0.45)
    noiseLayer(ctx, air, dt, {
      colour: 'brown', duration: rollLen * (0.55 + rnd() * 0.5),
      peak: level * (0.62 - i * 0.11), attack: 0.06 + rnd() * 0.14, drive: 2,
      chain: [biquad(ctx, 'highpass', 28, 0.6), biquad(ctx, 'lowpass', 190 - i * 26 + near * 120, 0.7)]
    })
  }
  // Long dying rumble across the sea surface.
  noiseLayer(ctx, air, t + 0.6, {
    colour: 'brown', duration: rollLen * 1.5, peak: level * 0.3, attack: 0.3, drive: 1.4,
    chain: [biquad(ctx, 'lowpass', 90, 0.7)]
  })
}

/**
 * Rain: two independent beds. On-deck is transient-rich and bright (drops on
 * steel and glass), on-water is a smooth broadband hiss with no transients at
 * all. Mixing both is what stops rain sounding like tape hiss.
 */
export function createRainBed(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 0
  out.connect(dest)

  const mk = (colour, chain, gainVal, rate = 1) => {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, colour)
    src.loop = true
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = gainVal
    let node = src
    for (const f of chain) {
      node.connect(f)
      node = f
    }
    node.connect(g).connect(out)
    return { src, gain: g, chain }
  }

  // On water — smooth, no discrete drops, slightly dark.
  const waterHp = biquad(ctx, 'highpass', 300, 0.6)
  const waterLp = biquad(ctx, 'lowpass', 4200, 0.5)
  const water = mk('pink', [waterHp, waterLp], 0.9)
  // On deck — bright and grainy.
  const deckHp = biquad(ctx, 'highpass', 1400, 0.6)
  const deckPk = biquad(ctx, 'peaking', 5200, 0.8, 6)
  const deck = mk('grain', [deckHp, deckPk], 0.55, 1.4)
  // Individual fat drops on steel, baked into a second grain layer at a slower
  // rate so the two never phase-lock into a rhythm.
  const dropBp = biquad(ctx, 'bandpass', 2600, 1.6)
  const drops = mk('grain', [dropBp], 0.4, 0.55)
  // Storm air underneath.
  const bodyLp = biquad(ctx, 'lowpass', 220, 0.7)
  const body = mk('brown', [bodyLp], 0.0001)

  for (const l of [water, deck, drops, body]) l.src.start(0, rnd() * 3)

  return {
    output: out,
    /** @param {number} level 0..1 @param {number} onDeck 0 = at sea, 1 = under cover */
    set(level, onDeck = 0.55, tc = 0.5) {
      const now = ctx.currentTime
      const l = clamp(level, 0, 1)
      const set = (p, v) => p.setTargetAtTime(Math.max(1e-4, v), now, tc)
      set(out.gain, l * 0.55)
      set(water.gain.gain, lerp(1.0, 0.35, onDeck))
      set(deck.gain.gain, lerp(0.12, 0.85, onDeck) * (0.4 + l * 0.6))
      set(drops.gain.gain, lerp(0.08, 0.6, onDeck) * (0.3 + l * 0.7))
      set(body.gain.gain, l > 0.4 ? (l - 0.4) * 0.85 : 1e-4)
      // Heavier rain is brighter and denser, not just louder.
      set(waterLp.frequency, 2600 + l * 5200)
      set(deckPk.gain, 3 + l * 6)
    },
    stop(fade = 1.2) {
      const now = ctx.currentTime
      out.gain.setTargetAtTime(1e-4, now, fade / 3)
      for (const l of [water, deck, drops, body]) {
        try { l.src.stop(now + fade + 0.3) } catch { /* already stopped */ }
      }
    }
  }
}

/**
 * Wind. Broadband air plus two resonant howls through rigging — those
 * resonances are what makes wind sound like wind rather than a noise floor.
 * Gusts are LFO-driven so the bed never sits still.
 */
export function createWindBed(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 1e-4
  out.connect(dest)

  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx, 'brown')
  src.loop = true
  const airLp = biquad(ctx, 'lowpass', 700, 0.6)
  const airHp = biquad(ctx, 'highpass', 60, 0.6)
  const airG = ctx.createGain()
  airG.gain.value = 0.75
  src.connect(airHp).connect(airLp).connect(airG).connect(out)

  // Rigging / superstructure resonances.
  const howls = []
  for (const [f, q, g] of [[420, 9, 0.16], [780, 12, 0.1], [1450, 14, 0.05]]) {
    const hs = ctx.createBufferSource()
    hs.buffer = noiseBuffer(ctx, 'white')
    hs.loop = true
    const bp = biquad(ctx, 'bandpass', f, q)
    const hg = ctx.createGain()
    hg.gain.value = g
    hs.connect(bp).connect(hg).connect(out)
    howls.push({ src: hs, bp, gain: hg, baseF: f, baseG: g })
  }

  // Gust LFOs — two incommensurate rates so gusts never repeat on a bar line.
  const gustDepth = ctx.createGain()
  gustDepth.gain.value = 0.32
  const gust = ctx.createOscillator()
  gust.type = 'sine'
  gust.frequency.value = 0.083
  const gust2 = ctx.createOscillator()
  gust2.type = 'triangle'
  gust2.frequency.value = 0.037
  const gust2Depth = ctx.createGain()
  gust2Depth.gain.value = 0.19
  const level = ctx.createGain()
  level.gain.value = 0.5
  gust.connect(gustDepth).connect(level.gain)
  gust2.connect(gust2Depth).connect(level.gain)
  out.disconnect()
  out.connect(level).connect(dest)

  src.start(0, rnd() * 4)
  for (const h of howls) h.src.start(0, rnd() * 4)
  gust.start(0)
  gust2.start(0)

  return {
    output: level,
    /** @param {number} strength 0 calm … 1 storm */
    set(strength, tc = 1.2) {
      const now = ctx.currentTime
      const s = clamp(strength, 0, 1)
      out.gain.setTargetAtTime(Math.max(1e-4, s * 0.34), now, tc)
      level.gain.setTargetAtTime(0.42 + s * 0.4, now, tc)
      airLp.frequency.setTargetAtTime(380 + s * 2600, now, tc)
      gustDepth.gain.setTargetAtTime(0.18 + s * 0.4, now, tc)
      for (const h of howls) {
        h.bp.frequency.setTargetAtTime(h.baseF * (0.8 + s * 0.5), now, tc)
        h.gain.gain.setTargetAtTime(h.baseG * s * s * 1.6 + 1e-4, now, tc)
      }
    },
    stop(fade = 1.5) {
      const now = ctx.currentTime
      level.gain.setTargetAtTime(1e-4, now, fade / 3)
      try { src.stop(now + fade + 0.3) } catch { /* */ }
      for (const h of howls) { try { h.src.stop(now + fade + 0.3) } catch { /* */ } }
      try { gust.stop(now + fade + 0.3); gust2.stop(now + fade + 0.3) } catch { /* */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Sea bed
// ---------------------------------------------------------------------------

/**
 * The water. Four continuous layers plus scheduled hull slaps:
 *   swell  — the ocean under everything, level from sea state
 *   wash   — mid body, opens with sea state
 *   rush   — water past the hull, level AND brightness from speed
 *   bow    — spray sheet off the bow at speed
 * Hull slaps are individual one-shots fired at the wave encounter rate, so they
 * track the sea the player can actually see rather than running on a timer.
 */
export function createSeaBed(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 1
  // Bed trim. The layers below are voiced at full scale for headroom during
  // synthesis; this is the level the ocean actually sits at under everything
  // else. Measured solo the bed lands near -22 dBFS RMS, which leaves the hull
  // slaps and the rest of the mix somewhere to go.
  const trim = ctx.createGain()
  trim.gain.value = 0.22
  out.connect(trim).connect(dest)

  const layer = (colour, chain, rate = 1) => {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, colour)
    src.loop = true
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = 1e-4
    let node = src
    for (const f of chain) {
      node.connect(f)
      node = f
    }
    node.connect(g).connect(out)
    return { src, gain: g }
  }

  const swellLp = biquad(ctx, 'lowpass', 170, 0.7)
  const swell = layer('brown', [biquad(ctx, 'highpass', 28, 0.6), swellLp], 0.85)
  const washBp = biquad(ctx, 'bandpass', 420, 0.5)
  const washLp = biquad(ctx, 'lowpass', 1300, 0.7)
  const wash = layer('pink', [biquad(ctx, 'highpass', 110, 0.6), washBp, washLp])
  const rushBp = biquad(ctx, 'bandpass', 900, 0.45)
  const rushLp = biquad(ctx, 'lowpass', 3400, 0.6)
  const rush = layer('pink', [biquad(ctx, 'highpass', 260, 0.6), rushBp, rushLp], 1.15)
  const bowHp = biquad(ctx, 'highpass', 2200, 0.6)
  const bow = layer('white', [bowHp, biquad(ctx, 'peaking', 5200, 0.8, 5)], 1.05)

  // Swell. Two incommensurate periods so the sea rises and falls without ever
  // repeating on a bar line — a bed with no long-term motion reads as a texture
  // loop no matter how good the spectrum is.
  const breathe = ctx.createOscillator()
  breathe.type = 'sine'
  breathe.frequency.value = 0.075
  const breatheDepth = ctx.createGain()
  breatheDepth.gain.value = 0.4
  breathe.connect(breatheDepth)
  breatheDepth.connect(swell.gain.gain)
  breatheDepth.connect(wash.gain.gain)
  const breathe2 = ctx.createOscillator()
  breathe2.type = 'triangle'
  breathe2.frequency.value = 0.041
  const breathe2Depth = ctx.createGain()
  breathe2Depth.gain.value = 0.26
  breathe2.connect(breathe2Depth)
  breathe2Depth.connect(swell.gain.gain)
  breathe2Depth.connect(rush.gain.gain)
  breathe.start(0)
  breathe2.start(0)

  for (const l of [swell, wash, rush, bow]) l.src.start(0, rnd() * 3)

  const slapOut = ctx.createGain()
  slapOut.gain.value = 0.5
  slapOut.connect(dest)

  let state = { speed: 0, waveHeight: 0.35, submerged: 0 }

  return {
    output: out,
    /**
     * @param {{speed?:number, waveHeight?:number, submerged?:number}} p
     *   speed 0..1 hull speed fraction; waveHeight 0..1 sea state;
     *   submerged 0..1 for below-decks muffling.
     */
    set(p, tc = 0.4) {
      state = { ...state, ...p }
      const now = ctx.currentTime
      const sp = clamp(state.speed, 0, 1)
      const wv = clamp(state.waveHeight, 0, 1)
      const sub = clamp(state.submerged, 0, 1)
      const set = (param, v) => param.setTargetAtTime(Math.max(1e-4, v), now, tc)
      set(swell.gain.gain, (0.4 + wv * 0.75) * (1 + sub * 0.5))
      set(wash.gain.gain, (0.18 + wv * 0.5 + sp * 0.22) * (1 - sub * 0.5))
      set(rush.gain.gain, sp * sp * 0.85 * (1 - sub * 0.35))
      set(bow.gain.gain, Math.max(0, sp - 0.25) * 0.6 * (1 - sub * 0.85))
      // Faster water is brighter and moves up the band, not just louder.
      set(rushBp.frequency, 520 + sp * 1500)
      set(rushLp.frequency, 1400 + sp * 5200)
      set(washBp.frequency, 300 + wv * 420)
      set(swellLp.frequency, 120 + wv * 170)
      set(out.gain, 1 - sub * 0.55)
    },
    /**
     * One wave meeting the hull. Routed past the bed trim deliberately — a slap
     * is an event, not part of the wash, and at bed level it is inaudible.
     * @param {number} strength 0..1
     */
    slap(strength = 0.5, when = ctx.currentTime) {
      const s = clamp(strength, 0, 1)
      if (s < 0.03) return
      const out = slapOut
      // Body of water hitting steel: a soft-fronted thump plus a spray hiss.
      noiseLayer(ctx, out, when, {
        colour: 'brown', duration: 0.16 + s * 0.2, peak: s * 0.55, attack: 0.008, drive: 1.3,
        chain: [biquad(ctx, 'highpass', 55, 0.6), biquad(ctx, 'lowpass', 300 + s * 340, 0.8)]
      })
      noiseLayer(ctx, out, when + 0.004, {
        colour: 'pink', duration: 0.1 + s * 0.16, peak: s * 0.38, attack: 0.005, drive: 1.6,
        chain: [biquad(ctx, 'bandpass', 700 + rnd() * 700, 0.8)]
      })
      // Water breaking over steel — the bright half of the slap.
      noiseLayer(ctx, out, when + 0.002, {
        colour: 'white', duration: 0.06 + s * 0.1, peak: s * 0.3, attack: 0.003,
        chain: [biquad(ctx, 'highpass', 2200, 0.6), biquad(ctx, 'peaking', 5000, 0.8, 4)]
      })
      if (s > 0.45) {
        noiseLayer(ctx, out, when + 0.03, {
          colour: 'grain', duration: 0.3 + s * 0.4, peak: (s - 0.45) * 0.5, attack: 0.03,
          chain: [biquad(ctx, 'highpass', 2400, 0.6)]
        })
        toneLayer(ctx, out, when, {
          type: 'sine', freq: 68, freqEnd: 34, duration: 0.22, peak: (s - 0.45) * 0.55, attack: 0.006
        })
      }
    },
    stop(fade = 1.4) {
      const now = ctx.currentTime
      out.gain.setTargetAtTime(1e-4, now, fade / 3)
      for (const l of [swell, wash, rush, bow]) {
        try { l.src.stop(now + fade + 0.4) } catch { /* */ }
      }
      try { breathe.stop(now + fade + 0.4); breathe2.stop(now + fade + 0.4) } catch { /* */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const DIESEL_IDLE_HZ = 8.5
const DIESEL_MAX_HZ = 34

/**
 * Marine diesel, four crossfaded state layers.
 *
 * A single looping tone whose gain follows the throttle is the thing this
 * replaces. What actually changes between idle and full ahead is *timbre*: at
 * idle you hear cylinder slap and injector clatter, at cruise the exhaust
 * stack, at full the blower and the block distorting. So there are four
 * separate voicings crossfaded on a triangular basis over rev, all sharing one
 * firing-rate LFO so they stay phase-coherent through the blend.
 *
 * Extra inputs beyond rev:
 *   load   — throttle demand vs actual way through the water. High load at low
 *            rev is lugging: more drive, a slow beat, opened low mids.
 *   cavitation — prop breaking the surface. Fired as bursts, not a bed.
 */
export function createEngine(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 1e-4
  const bodyShelf = biquad(ctx, 'lowshelf', 150, 0.7, 1)
  // Nothing musical lives below 28 Hz here; without this the block's sub-octave
  // dominated the whole spectrum and left no room for the mechanical detail.
  const rumbleCut = biquad(ctx, 'highpass', 30, 0.6)
  const roomLp = biquad(ctx, 'lowpass', 9000, 0.6)
  out.connect(rumbleCut).connect(bodyShelf).connect(roomLp).connect(dest)

  // Firing-rate gate — the chug. Most of the diesel character lives here.
  const chug = ctx.createOscillator()
  chug.type = 'triangle'
  chug.frequency.value = DIESEL_IDLE_HZ
  const chugDepth = ctx.createGain()
  chugDepth.gain.value = 0.55
  const gate = ctx.createGain()
  gate.gain.value = 0.45
  chug.connect(chugDepth).connect(gate.gain)
  gate.connect(out)

  // Ungated path for the layers that should not pulse (blower, stack roar).
  const steady = ctx.createGain()
  steady.gain.value = 1
  steady.connect(out)

  const sources = [chug]

  // A real diesel never holds an exact rpm. Without this wander every layer is
  // phase-locked forever and the bed reads as a synth pad however good the
  // timbre is. One LFO, summed into every oscillator's frequency in Hz.
  const wander = ctx.createOscillator()
  wander.type = 'sine'
  wander.frequency.value = 0.13
  const wanderDepth = ctx.createGain()
  wanderDepth.gain.value = 0.3
  wander.connect(wanderDepth)
  sources.push(wander)

  const mkOsc = (type, freq, target, gainVal, filters = [], pan = 0) => {
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    wanderDepth.connect(osc.frequency)
    const g = ctx.createGain()
    g.gain.value = gainVal
    let node = osc
    for (const f of filters) {
      node.connect(f)
      node = f
    }
    node.connect(g)
    if (pan !== 0) {
      const p = ctx.createStereoPanner()
      p.pan.value = pan
      g.connect(p).connect(target)
    } else {
      g.connect(target)
    }
    sources.push(osc)
    return { osc, gain: g, filters }
  }
  const mkNoise = (colour, target, gainVal, filters = [], rate = 1) => {
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(ctx, colour)
    src.loop = true
    src.playbackRate.value = rate
    const g = ctx.createGain()
    g.gain.value = gainVal
    let node = src
    for (const f of filters) {
      node.connect(f)
      node = f
    }
    node.connect(g).connect(target)
    sources.push(src)
    return { src, gain: g, filters }
  }

  // --- Layer weights (crossfaded by rev) ---
  const wIdle = ctx.createGain()
  const wLow = ctx.createGain()
  const wCruise = ctx.createGain()
  const wFull = ctx.createGain()
  for (const w of [wIdle, wLow, wCruise, wFull]) {
    w.gain.value = 1e-4
    w.connect(gate)
  }
  const wCruiseSteady = ctx.createGain()
  const wFullSteady = ctx.createGain()
  for (const w of [wCruiseSteady, wFullSteady]) {
    w.gain.value = 1e-4
    w.connect(steady)
  }

  // Each block layer is a detuned pair panned apart. Oscillators are mono by
  // definition and they dominate this bed; a single one per layer measured at
  // 0.96 channel correlation, i.e. the engine was effectively mono.
  const twin = (o, cents) => { o.osc.detune.value = cents; return o }

  // IDLE: heavy slow cylinder slap, loud injector clatter, almost no stack.
  const idleBlock = mkOsc('sawtooth', DIESEL_IDLE_HZ, wIdle, 0.8, [biquad(ctx, 'lowpass', 150, 1.1)], -0.5)
  const idleBlockB = twin(mkOsc('sawtooth', DIESEL_IDLE_HZ, wIdle, 0.68, [biquad(ctx, 'lowpass', 172, 1.1)], 0.5), 11)
  const idleSub = mkOsc('sine', DIESEL_IDLE_HZ * 0.5, wIdle, 0.24)
  const idleClatter = mkNoise('grain', wIdle, 0.44, [
    biquad(ctx, 'highpass', 900, 0.6), biquad(ctx, 'bandpass', 1700, 1.6)
  ], 0.8)
  // Tappets / injector ticks — the detail that lives above 3 kHz and is the
  // difference between "idling diesel" and "low hum".
  const idleTappet = mkNoise('grain', wIdle, 0.24, [
    biquad(ctx, 'highpass', 2600, 0.6), biquad(ctx, 'peaking', 5200, 1.2, 7)
  ], 1.35)

  // LOW: fundamental firming up, some second order.
  const lowBlock = mkOsc('sawtooth', DIESEL_IDLE_HZ, wLow, 0.72, [biquad(ctx, 'lowpass', 300, 1)], -0.45)
  const lowBlockB = twin(mkOsc('sawtooth', DIESEL_IDLE_HZ, wLow, 0.6, [biquad(ctx, 'lowpass', 330, 1)], 0.45), -13)
  const lowGrowl = mkOsc('square', DIESEL_IDLE_HZ * 2, wLow, 0.36, [biquad(ctx, 'lowpass', 520, 2.6)])
  const lowStack = mkNoise('brown', wLow, 0.5, [biquad(ctx, 'lowpass', 900, 0.7)])
  const lowClatter = mkNoise('grain', wLow, 0.4, [
    biquad(ctx, 'highpass', 1400, 0.6), biquad(ctx, 'peaking', 3800, 1.1, 6)
  ], 1.1)

  // CRUISE: stack opens, harmonics fill in, turbo enters (ungated).
  const cruiseBlock = mkOsc('sawtooth', DIESEL_IDLE_HZ, wCruise, 0.58, [
    biquad(ctx, 'lowpass', 700, 0.9), biquad(ctx, 'peaking', 260, 1.1, 6)
  ], -0.4)
  const cruiseBlockB = twin(mkOsc('sawtooth', DIESEL_IDLE_HZ, wCruise, 0.5, [
    biquad(ctx, 'lowpass', 760, 0.9), biquad(ctx, 'peaking', 290, 1.1, 6)
  ], 0.4), 9)
  const cruiseGrowl = mkOsc('square', DIESEL_IDLE_HZ * 2, wCruise, 0.4, [biquad(ctx, 'lowpass', 1100, 2.2)])
  const cruiseStack = mkNoise('brown', wCruiseSteady, 1.0, [
    biquad(ctx, 'highpass', 110, 0.6), biquad(ctx, 'lowpass', 2200, 0.7)
  ])
  const cruiseAir = mkNoise('pink', wCruiseSteady, 0.42, [
    biquad(ctx, 'highpass', 1800, 0.6), biquad(ctx, 'peaking', 4200, 0.9, 5)
  ])
  const turboA = mkOsc('sawtooth', 130, wCruiseSteady, 0.2, [biquad(ctx, 'bandpass', 300, 2.4)], -0.35)
  const turboB = mkOsc('sawtooth', 134, wCruiseSteady, 0.17, [biquad(ctx, 'bandpass', 320, 2.4)], 0.35)

  // FULL: the block distorting, exhaust roar, blower singing.
  const fullSat = saturator(ctx, 3.2)
  const fullPan = ctx.createStereoPanner()
  fullPan.pan.value = -0.45
  fullSat.connect(fullPan).connect(wFull)
  const fullBlock = mkOsc('sawtooth', DIESEL_IDLE_HZ, fullSat, 0.62, [
    biquad(ctx, 'lowpass', 1300, 0.8), biquad(ctx, 'peaking', 420, 1, 7)
  ])
  const fullBlockB = twin(mkOsc('sawtooth', DIESEL_IDLE_HZ, wFull, 0.4, [
    biquad(ctx, 'lowpass', 1500, 0.8), biquad(ctx, 'peaking', 470, 1, 7)
  ], 0.5), -15)
  const fullHarm = mkOsc('square', DIESEL_IDLE_HZ * 3, fullSat, 0.26, [biquad(ctx, 'bandpass', 900, 1.6)])
  const fullRoar = mkNoise('pink', wFullSteady, 1.15, [
    biquad(ctx, 'highpass', 180, 0.6), biquad(ctx, 'bandpass', 900, 0.45), biquad(ctx, 'lowpass', 5200, 0.7)
  ])
  const fullAir = mkNoise('white', wFullSteady, 0.3, [
    biquad(ctx, 'highpass', 3200, 0.6), biquad(ctx, 'peaking', 7000, 0.8, 5)
  ])
  const blower = mkOsc('sawtooth', 240, wFullSteady, 0.13, [
    biquad(ctx, 'bandpass', 900, 6), biquad(ctx, 'lowpass', 3400, 0.7)
  ], -0.3)

  // Lugging beat — a slow amplitude wobble that appears only under strain.
  const lug = ctx.createOscillator()
  lug.type = 'sine'
  lug.frequency.value = 3.1
  const lugDepth = ctx.createGain()
  lugDepth.gain.value = 0
  lug.connect(lugDepth).connect(gate.gain)
  sources.push(lug)

  for (const s of sources) {
    try { s.start(0, s.buffer ? rnd() * 3 : undefined) } catch { s.start(0) }
  }

  let rev = 0
  let load = 0
  let running = false

  /** Triangular crossfade basis over rev at knots 0 / 0.3 / 0.65 / 1. */
  function weights(r) {
    const knots = [0, 0.3, 0.65, 1.0]
    const w = [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) {
      const prev = knots[i - 1] ?? knots[0] - 0.3
      const next = knots[i + 1] ?? knots[3] + 0.3
      if (r <= knots[i]) w[i] = clamp((r - prev) / (knots[i] - prev), 0, 1)
      else w[i] = clamp((next - r) / (next - knots[i]), 0, 1)
    }
    return w
  }

  function apply(tc = 0.18) {
    const now = ctx.currentTime
    const set = (p, v, k = tc) => {
      try { p.setTargetAtTime(v, now, k) } catch { p.value = v }
    }
    const r = clamp(rev, 0, 1)
    const strain = clamp(load - r, 0, 1)
    const hz = DIESEL_IDLE_HZ + (DIESEL_MAX_HZ - DIESEL_IDLE_HZ) * r

    for (const o of [idleBlock, idleBlockB, lowBlock, lowBlockB,
      cruiseBlock, cruiseBlockB, fullBlock, fullBlockB]) set(o.osc.frequency, hz, 0.25)
    set(idleSub.osc.frequency, hz * 0.5, 0.25)
    set(lowGrowl.osc.frequency, hz * 2, 0.25)
    set(cruiseGrowl.osc.frequency, hz * 2, 0.25)
    set(fullHarm.osc.frequency, hz * 3, 0.25)
    set(chug.frequency, hz, 0.2)

    const w = weights(r)
    set(wIdle.gain, Math.max(1e-4, w[0] * 0.85))
    set(wLow.gain, Math.max(1e-4, w[1] * 0.95))
    set(wCruise.gain, Math.max(1e-4, w[2]))
    set(wFull.gain, Math.max(1e-4, w[3]))
    set(wCruiseSteady.gain, Math.max(1e-4, w[2] * 0.9 + w[3] * 0.4))
    set(wFullSteady.gain, Math.max(1e-4, w[3]))

    // Chug depth: heavy at idle (you hear individual cylinders), shallow at
    // speed (the firings blur into a note).
    set(chugDepth.gain, 0.62 - 0.38 * r + strain * 0.12)
    set(gate.gain, 0.42 + 0.12 * r)

    // Strain: opens the filters, drives the block harder, adds the lug beat.
    set(cruiseBlock.filters[1].gain, 4 + strain * 9, 0.3)
    set(fullBlock.filters[1].gain, 5 + strain * 10, 0.3)
    set(lugDepth.gain, strain * strain * 0.2, 0.4)
    set(lug.frequency, 2.4 + r * 3.5, 0.4)

    // Turbo/blower track rev with a lag, as a real turbo does.
    const turboHz = 118 + 240 * r
    set(turboA.osc.frequency, turboHz, 0.55)
    set(turboB.osc.frequency, turboHz * 1.028, 0.55)
    set(turboA.filters[0].frequency, 260 + 620 * r, 0.5)
    set(turboB.filters[0].frequency, 275 + 640 * r, 0.5)
    set(blower.osc.frequency, 200 + 520 * r, 0.5)
    set(blower.filters[0].frequency, 700 + 1900 * r, 0.5)

    set(fullRoar.filters[1].frequency, 700 + 1900 * r, 0.35)
    set(cruiseStack.filters[1].frequency, 1200 + 2400 * r, 0.35)
    set(idleClatter.filters[1].frequency, 1400 + 1600 * r, 0.35)
    set(lowClatter.filters[1].frequency, 3200 + 2600 * r, 0.35)
    set(idleTappet.filters[1].frequency, 4600 + 3400 * r, 0.35)
    set(roomLp.frequency, 6200 + 6000 * r, 0.4)

    if (running) set(out.gain, 0.2 + 0.32 * r + strain * 0.08, 0.25)
  }

  return {
    output: out,
    get running() { return running },
    /** Cranking, catch, settle to idle. */
    /**
     * @param {number} when
     * @param {{crank?:boolean}} [o] crank:false brings it up already running
     *   (loading a save alongside, or probing a steady state).
     */
    start(when = ctx.currentTime, o = {}) {
      if (running) return
      running = true
      rev = 0
      if (o.crank === false) {
        // Let apply() own out.gain outright. Scheduling a linear ramp here as
        // well left two automation events on one param and stepped where the
        // ramp ended.
        apply(0.03)
        return
      }
      // Starter motor: rising whine plus the flywheel being dragged over.
      const starter = ctx.createOscillator()
      starter.type = 'sawtooth'
      const sg = envGain(ctx, when, { peak: 0.16, attack: 0.08, hold: 0.5, decay: 0.35 })
      starter.frequency.setValueAtTime(90, when)
      starter.frequency.linearRampToValueAtTime(320, when + 0.75)
      const sbp = biquad(ctx, 'bandpass', 700, 3)
      starter.connect(sbp).connect(sg).connect(dest)
      starter.start(when)
      starter.stop(when + 1.3)
      // Compression knocks as it turns over.
      for (let i = 0; i < 7; i++) {
        const t = when + 0.12 + i * (0.13 - i * 0.008)
        noiseLayer(ctx, dest, t, {
          colour: 'brown', duration: 0.07, peak: 0.28 + i * 0.03, attack: 0.003, drive: 2,
          chain: [biquad(ctx, 'lowpass', 260 + i * 30, 1.2)]
        })
      }
      // Catch: it fires, overshoots, then settles.
      out.gain.cancelScheduledValues(when)
      out.gain.setValueAtTime(1e-4, when)
      out.gain.linearRampToValueAtTime(0.18, when + 0.55)
      out.gain.linearRampToValueAtTime(0.62, when + 0.95)
      out.gain.setTargetAtTime(0.3, when + 1.05, 0.5)
      chug.frequency.setValueAtTime(DIESEL_IDLE_HZ * 0.35, when + 0.4)
      chug.frequency.linearRampToValueAtTime(DIESEL_IDLE_HZ * 1.6, when + 1.0)
      chug.frequency.setTargetAtTime(DIESEL_IDLE_HZ, when + 1.1, 0.6)
      rev = 0.16
      apply(0.5)
      rev = 0
    },
    /** Fuel cut: revs fall away, a couple of last knocks, then nothing. */
    shutdown(when = ctx.currentTime) {
      if (!running) return
      running = false
      const set = (p, v, tc) => { try { p.setTargetAtTime(v, when, tc) } catch { p.value = v } }
      set(chug.frequency, DIESEL_IDLE_HZ * 0.25, 0.45)
      set(out.gain, 1e-4, 0.42)
      set(chugDepth.gain, 0.95, 0.4)
      for (let i = 0; i < 3; i++) {
        noiseLayer(ctx, dest, when + 0.35 + i * 0.36, {
          colour: 'brown', duration: 0.12, peak: 0.16 - i * 0.045, attack: 0.004, drive: 1.8,
          chain: [biquad(ctx, 'lowpass', 200, 1.2)]
        })
      }
    },
    /** @param {number} r 0 idle … 1 full ahead @param {number} l throttle demand */
    set(r, l = r, tc = 0.18) {
      rev = clamp(r, 0, 1)
      load = clamp(l, 0, 1)
      apply(tc)
    },
    /**
     * Prop ventilating. A gulp of air down the blades: the note drops out, the
     * revs flare, and the water boils.
     */
    cavitate(strength = 0.6, when = ctx.currentTime) {
      const s = clamp(strength, 0, 1)
      // Bubbles: band-limited noise with fast random amplitude flutter.
      const bp = biquad(ctx, 'bandpass', 620, 1.1)
      bp.frequency.setValueAtTime(1100, when)
      bp.frequency.exponentialRampToValueAtTime(340, when + 0.4)
      noiseLayer(ctx, out, when, {
        colour: 'grain', duration: 0.45 * s + 0.15, peak: s * 0.55, attack: 0.01, drive: 2.2,
        chain: [bp, biquad(ctx, 'highpass', 180, 0.6)], playbackRate: 1.7
      })
      noiseLayer(ctx, out, when + 0.02, {
        colour: 'brown', duration: 0.35, peak: s * 0.4, attack: 0.015, drive: 2.4,
        chain: [biquad(ctx, 'lowpass', 420, 0.9)]
      })
      // The rev flare — load falls off the prop, so the engine runs away briefly.
      try {
        chug.frequency.cancelScheduledValues(when)
        const hz = DIESEL_IDLE_HZ + (DIESEL_MAX_HZ - DIESEL_IDLE_HZ) * clamp(rev, 0, 1)
        chug.frequency.setValueAtTime(hz, when)
        chug.frequency.linearRampToValueAtTime(hz * (1 + 0.28 * s), when + 0.12)
        chug.frequency.setTargetAtTime(hz, when + 0.16, 0.18)
      } catch { /* param busy */ }
    },
    /** Muffle for below decks / interior. @param {number} amount 0..1 */
    setEnclosure(amount, tc = 0.5) {
      const now = ctx.currentTime
      const a = clamp(amount, 0, 1)
      roomLp.frequency.setTargetAtTime(4200 - a * 3400, now, tc)
      bodyShelf.gain.setTargetAtTime(3 + a * 7, now, tc)
    },
    stop(fade = 0.4) {
      running = false
      const now = ctx.currentTime
      out.gain.cancelScheduledValues(now)
      out.gain.setTargetAtTime(1e-4, now, fade / 3)
      for (const s of sources) {
        try { s.stop(now + fade + 0.3) } catch { /* */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Music bed (state-driven, synthesised)
// ---------------------------------------------------------------------------

/**
 * Combat / tension underscore.
 *
 * The streamed ambient tracks stay as they are for calm; this sits under them
 * and takes over when things go wrong, because a state-reactive layer has to
 * start in under a second and a streamed file cannot.
 *
 * Three crossfaded stems, all from the same root so transitions are consonant:
 *   drone   — detuned low saws through a slow filter (always present > calm)
 *   pulse   — gated eighth-note sub, tension and above
 *   swell   — high dissonant bed + a struck low hit, combat only
 */
export function createMusicBed(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 1e-4
  out.connect(dest)

  const ROOT = 55 // A1
  const sources = []

  // Drone
  const droneG = ctx.createGain()
  droneG.gain.value = 1e-4
  // A BiquadFilter is per-channel, so the panned voices above stay panned
  // through it. Only a merge/sum node would collapse them.
  const droneLp = biquad(ctx, 'lowpass', 300, 2.5)
  const droneSat = saturator(ctx, 1.4)
  droneG.connect(droneSat).connect(out)
  droneLp.connect(droneG)
  for (const [mul, det, g, pan] of [
    [1, -7, 0.5, -0.55], [1, 9, 0.45, 0.55], [1.5, 4, 0.22, 0.35], [2, -11, 0.16, -0.35]
  ]) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = ROOT * mul
    o.detune.value = det
    const og = ctx.createGain()
    og.gain.value = g
    const pn = ctx.createStereoPanner()
    pn.pan.value = pan
    o.connect(og).connect(pn).connect(droneLp)
    sources.push(o)
  }
  // Slow filter movement so the drone breathes.
  const droneLfo = ctx.createOscillator()
  droneLfo.type = 'sine'
  droneLfo.frequency.value = 0.047
  const droneLfoD = ctx.createGain()
  droneLfoD.gain.value = 140
  droneLfo.connect(droneLfoD).connect(droneLp.frequency)
  sources.push(droneLfo)

  // Pulse: a sub pumped by a square LFO. Reads as a heartbeat under tension.
  const pulseG = ctx.createGain()
  pulseG.gain.value = 1e-4
  pulseG.connect(out)
  const pulseOsc = ctx.createOscillator()
  pulseOsc.type = 'sine'
  pulseOsc.frequency.value = ROOT * 0.5
  const pulseVca = ctx.createGain()
  pulseVca.gain.value = 0
  const pulseLfo = ctx.createOscillator()
  pulseLfo.type = 'square'
  pulseLfo.frequency.value = 1.55
  const pulseLfoD = ctx.createGain()
  pulseLfoD.gain.value = 0.5
  const pulseBias = ctx.createConstantSource()
  pulseBias.offset.value = 0.5
  pulseLfo.connect(pulseLfoD).connect(pulseVca.gain)
  pulseBias.connect(pulseVca.gain)
  pulseOsc.connect(pulseVca).connect(pulseG)
  sources.push(pulseOsc, pulseLfo, pulseBias)

  // Swell: high cluster, dissonant fifth+minor second, combat only.
  const swellG = ctx.createGain()
  swellG.gain.value = 1e-4
  const swellLp = biquad(ctx, 'lowpass', 2600, 0.8)
  swellG.connect(swellLp).connect(out)
  for (const [mul, g, pan] of [[6, 0.1, -0.7], [9.03, 0.07, 0.6], [12.7, 0.05, 0.8], [18.1, 0.03, -0.85]]) {
    const o = ctx.createOscillator()
    o.type = 'triangle'
    o.frequency.value = ROOT * mul
    const og = ctx.createGain()
    og.gain.value = g
    const pn = ctx.createStereoPanner()
    pn.pan.value = pan
    o.connect(og).connect(pn).connect(swellG)
    sources.push(o)
  }
  const swellLfo = ctx.createOscillator()
  swellLfo.type = 'triangle'
  swellLfo.frequency.value = 0.19
  const swellLfoD = ctx.createGain()
  swellLfoD.gain.value = 900
  swellLfo.connect(swellLfoD).connect(swellLp.frequency)
  sources.push(swellLfo)

  for (const s of sources) {
    try { s.start(0) } catch { /* */ }
  }

  const LEVELS = {
    calm: { out: 1e-4, drone: 1e-4, pulse: 1e-4, swell: 1e-4, pulseHz: 1.1 },
    tension: { out: 0.34, drone: 0.3, pulse: 0.07, swell: 0.06, pulseHz: 1.35 },
    combat: { out: 0.6, drone: 0.36, pulse: 0.16, swell: 0.5, pulseHz: 2.1 }
  }
  let stateName = 'calm'

  return {
    output: out,
    get state() { return stateName },
    /** @param {'calm'|'tension'|'combat'} name */
    set(name, fade = 2.2) {
      const s = LEVELS[name] ? name : 'calm'
      if (s === stateName) return
      stateName = s
      const p = LEVELS[s]
      const now = ctx.currentTime
      const tc = Math.max(0.05, fade / 3)
      out.gain.setTargetAtTime(p.out, now, tc)
      droneG.gain.setTargetAtTime(p.drone, now, tc)
      pulseG.gain.setTargetAtTime(p.pulse, now, tc)
      swellG.gain.setTargetAtTime(p.swell, now, tc)
      pulseLfo.frequency.setTargetAtTime(p.pulseHz, now, tc * 2)
      // A struck low hit marks the transition into combat so it lands on a
      // beat rather than just fading up.
      if (s === 'combat') {
        toneLayer(ctx, out, now + 0.02, {
          type: 'sine', freq: ROOT * 2, freqEnd: ROOT * 0.5, duration: 1.6, peak: 0.5, attack: 0.004
        })
        noiseLayer(ctx, out, now + 0.02, {
          colour: 'brown', duration: 1.1, peak: 0.3, attack: 0.006, drive: 2,
          chain: [biquad(ctx, 'lowpass', 220, 0.8)]
        })
      }
    },
    stop(fade = 1.5) {
      const now = ctx.currentTime
      out.gain.setTargetAtTime(1e-4, now, fade / 3)
      for (const s of sources) {
        try { s.stop(now + fade + 0.4) } catch { /* */ }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Small mechanical / UI voices
// ---------------------------------------------------------------------------

/** Iron struck: bright scrape, inharmonic ring, short body. */
export function metalClank(ctx, dest, t0, { freq = 480, level = 0.6, pan = null } = {}) {
  if (pan == null) pan = (rnd() * 2 - 1) * 0.5
  const p = ctx.createStereoPanner()
  p.pan.value = pan
  p.connect(dest)
  dest = p
  transientClick(ctx, dest, t0, { peak: level * 0.55, highpassHz: 1800, drive: 2 })
  noiseLayer(ctx, dest, t0, {
    colour: 'white', duration: 0.03, peak: level * 0.45, drive: 3.5,
    chain: [biquad(ctx, 'bandpass', 3400, 1.2)]
  })
  for (const [mul, amp, dec] of [[1, 0.6, 0.34], [1.63, 0.32, 0.24], [2.53, 0.17, 0.15], [4.1, 0.08, 0.09]]) {
    toneLayer(ctx, dest, t0, {
      type: 'triangle', freq: freq * mul * jitter(0.02), freqEnd: freq * mul * 0.99,
      duration: dec, peak: level * amp, attack: 0.0007
    })
  }
  toneLayer(ctx, dest, t0, { type: 'sine', freq: freq * 0.28, freqEnd: freq * 0.2, duration: 0.11, peak: level * 0.25 })
}

/** Chain over a fairlead. */
export function chainRattle(ctx, dest, t0, { count = 7, level = 0.3 } = {}) {
  for (let i = 0; i < count; i++) {
    const t = t0 + i * (0.035 + rnd() * 0.035)
    const f = 620 + rnd() * 900
    // Links scatter across the fairlead rather than arriving from one point.
    // Each gets its own panner off `dest`; chaining them would stack panners.
    const p = ctx.createStereoPanner()
    p.pan.value = (rnd() * 2 - 1) * 0.65
    p.connect(dest)
    noiseLayer(ctx, p, t, {
      colour: 'white', duration: 0.02, peak: level * (0.9 - i * 0.07), drive: 3,
      chain: [biquad(ctx, 'bandpass', 2200 + rnd() * 2200, 3)]
    })
    toneLayer(ctx, p, t, { type: 'triangle', freq: f, duration: 0.045, peak: level * 0.4, attack: 0.0007 })
  }
}

/** Hand winch pawl. */
export function winchRatchet(ctx, dest, t0, { steps = 6, level = 0.28, pan = null } = {}) {
  const p = ctx.createStereoPanner()
  p.pan.value = pan == null ? (rnd() * 2 - 1) * 0.4 : pan
  p.connect(dest)
  dest = p
  for (let i = 0; i < steps; i++) {
    const t = t0 + i * (0.062 + rnd() * 0.02)
    transientClick(ctx, dest, t, { peak: level * 0.5, highpassHz: 1200, drive: 2 })
    noiseLayer(ctx, dest, t, {
      colour: 'white', duration: 0.016, peak: level * (0.85 - i * 0.07), drive: 4,
      chain: [biquad(ctx, 'bandpass', 2600 - i * 140, 4)]
    })
    toneLayer(ctx, dest, t, { type: 'square', freq: 340 - i * 22, duration: 0.022, peak: level * 0.3, attack: 0.0006 })
  }
}

/** Footstep. `surface` picks the band and the amount of grit. */
export function footstep(ctx, dest, t0, { surface = 'grass', running = false, level = 1, side = 'L' } = {}) {
  const hard = surface === 'stone' || surface === 'wood'
  const pan = ctx.createStereoPanner()
  pan.pan.value = (side === 'R' ? 0.22 : -0.22) + (rnd() * 2 - 1) * 0.08
  pan.connect(dest)
  dest = pan
  const l = level * (running ? 0.9 : 0.62)
  transientClick(ctx, dest, t0, { peak: l * (hard ? 0.4 : 0.14), highpassHz: hard ? 900 : 400, drive: 1.2 })
  noiseLayer(ctx, dest, t0, {
    colour: hard ? 'white' : 'pink', duration: hard ? 0.045 : 0.075,
    peak: l * 0.55, attack: 0.0015, drive: hard ? 2 : 1.1,
    chain: hard
      ? [biquad(ctx, 'bandpass', 1800 * jitter(0.15), 1.1), biquad(ctx, 'peaking', 4200, 1, 4)]
      : [biquad(ctx, 'lowpass', 1400 * jitter(0.15), 0.8), biquad(ctx, 'peaking', 500, 1, 4)]
  })
  toneLayer(ctx, dest, t0, {
    type: 'sine', freq: hard ? 130 : 95, freqEnd: hard ? 62 : 45, duration: 0.1, peak: l * 0.35, attack: 0.002
  })
  if (surface === 'wood') {
    toneLayer(ctx, dest, t0 + 0.002, {
      type: 'triangle', freq: 210 * jitter(0.1), freqEnd: 170, duration: 0.14, peak: l * 0.2, attack: 0.001
    })
  }
  // Grit / debris scatter after the weight lands.
  noiseLayer(ctx, dest, t0 + 0.02, {
    colour: 'grain', duration: hard ? 0.09 : 0.14, peak: l * (hard ? 0.16 : 0.24),
    chain: [biquad(ctx, hard ? 'highpass' : 'bandpass', hard ? 2600 : 1100, 0.8)]
  })
}

/** Active sounding — a struck sine with an underwater band and two returns. */
export function sonarPing(ctx, dest, t0, { index = 0, level = 0.6 } = {}) {
  const f = 900 - (index % 5) * 42
  const bp = biquad(ctx, 'bandpass', f, 2.4)
  // A tiny spread on the transducer keeps it from being a dead-centre point.
  const bpPan = ctx.createStereoPanner()
  bpPan.pan.value = -0.12
  bp.connect(bpPan).connect(dest)
  transientClick(ctx, bp, t0, { peak: level * 0.35, highpassHz: 400 })
  toneLayer(ctx, bp, t0, { type: 'sine', freq: f, freqEnd: f * 0.93, duration: 1.5, peak: level * 0.55, attack: 0.0018 })
  const harmPan = ctx.createStereoPanner()
  harmPan.pan.value = 0.34
  harmPan.connect(dest)
  toneLayer(ctx, harmPan, t0, { type: 'sine', freq: f * 2, duration: 0.5, peak: level * 0.14, attack: 0.0015 })
  for (const [dt, g, damp, pan] of [[0.62, 0.34, 0.75, -0.5], [1.31, 0.16, 0.5, 0.65]]) {
    const echoBp = biquad(ctx, 'bandpass', f * damp, 2)
    const echoPan = ctx.createStereoPanner()
    echoPan.pan.value = pan
    echoBp.connect(echoPan).connect(dest)
    toneLayer(ctx, echoBp, t0 + dt, {
      type: 'sine', freq: f * 0.985, freqEnd: f * 0.93, duration: 1.1, peak: level * g * 0.5, attack: 0.006
    })
  }
}

/** UI: a struck, slightly inharmonic chime rather than a bare sine beep. */
export function uiChime(ctx, dest, t0, { notes = [880], level = 0.3, spacing = 0.09, decay = 0.4 } = {}) {
  notes.forEach((f, i) => {
    const t = t0 + i * spacing
    // Partials alternate across the stereo field so a chime is not a mono blip.
    const pan = ctx.createStereoPanner()
    pan.pan.value = (i % 2 ? 0.3 : -0.3)
    pan.connect(dest)
    transientClick(ctx, pan, t, { peak: level * 0.12, highpassHz: 3000 })
    toneLayer(ctx, pan, t, { type: 'sine', freq: f, duration: decay, peak: level, attack: 0.0025 })
    const wide = ctx.createStereoPanner()
    wide.pan.value = (i % 2 ? -0.6 : 0.6)
    wide.connect(dest)
    toneLayer(ctx, wide, t, { type: 'sine', freq: f * 2.76, duration: decay * 0.35, peak: level * 0.16, attack: 0.0015 })
    toneLayer(ctx, wide, t, { type: 'triangle', freq: f * 5.4, duration: decay * 0.14, peak: level * 0.07, attack: 0.001 })
  })
}

/** Low prop buzz for escort drones. Returns a controller so count can change. */
export function createDroneBuzz(ctx, dest) {
  const out = ctx.createGain()
  out.gain.value = 1e-4
  out.connect(dest)
  const sources = []
  const air = ctx.createBufferSource()
  air.buffer = noiseBuffer(ctx, 'pink')
  air.loop = true
  const airBp = biquad(ctx, 'bandpass', 950, 0.8)
  const airG = ctx.createGain()
  airG.gain.value = 0.5
  air.connect(airBp).connect(airG).connect(out)
  sources.push(air)
  const blades = []
  for (const [f, det, g, pan] of [[62, -9, 0.28, -0.6], [67, 12, 0.2, 0.6], [126, 0, 0.1, 0.2]]) {
    const o = ctx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.value = f
    o.detune.value = det
    const lp = biquad(ctx, 'lowpass', 380, 0.4)
    const og = ctx.createGain()
    og.gain.value = g
    const pn = ctx.createStereoPanner()
    pn.pan.value = pan
    o.connect(lp).connect(og).connect(pn).connect(out)
    sources.push(o)
    blades.push(o)
  }
  for (const s of sources) {
    try { s.start(0, s.buffer ? rnd() * 3 : undefined) } catch { s.start(0) }
  }
  return {
    output: out,
    set(count) {
      const n = Math.max(0, Math.floor(count))
      const now = ctx.currentTime
      out.gain.setTargetAtTime(n <= 0 ? 1e-4 : 0.1 + Math.min(2, n - 1) * 0.03, now, 0.2)
      // Extra drones beat against each other rather than just being louder.
      blades.forEach((o, i) => o.detune.setTargetAtTime(-9 + i * 11 + n * 3.5, now, 0.4))
    },
    stop(fade = 0.4) {
      const now = ctx.currentTime
      out.gain.setTargetAtTime(1e-4, now, fade / 3)
      for (const s of sources) { try { s.stop(now + fade + 0.3) } catch { /* */ } }
    }
  }
}
