let ctx = null
/** Web Audio graph (SFX, thrusters, weapons, synth) + voice callouts. */
let sfxEnabled = true
let sfxVolume = 1
/** HTMLAudio title / ambient / death tracks. */
let musicEnabled = true
let musicVolume = 1
/** Sea wash/lapping has its own level so it can sit under the rest of the mix. */
let seaVolume = 1
let masterGain = null
let sfxBusGain = null
let seaBusGain = null

function clampVolume(value, fallback = 1) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback
}

function getContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

// Synthetic impulse response: noise under an exponential decay. Feeding a
// ConvolverNode this gives every one-shot a tail instead of stopping dead, and
// a dark, slow one reads as a big pressurised hull rather than a tiled room.
function makeImpulseResponse(audio, seconds, decay) {
  const len = Math.max(1, Math.floor(audio.sampleRate * seconds))
  const buf = audio.createBuffer(2, len, audio.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/**
 * Shared output so SFX mute can zero the whole Web Audio graph at once.
 *
 * Master bus is masterGain → [dry + dark reverb send] → compressor → out.
 * SFX and sea each feed a small level bus before the shared space/glue, so
 * their sliders remain independent without changing every sound call site.
 */
function getMasterDestination() {
  const audio = getContext()
  if (!masterGain) {
    masterGain = audio.createGain()
    masterGain.gain.value = 1
    sfxBusGain = audio.createGain()
    sfxBusGain.gain.value = sfxVolume
    seaBusGain = audio.createGain()
    seaBusGain.gain.value = seaVolume

    // Glue compressor: stops a missile volley + thrusters + hull hits from
    // summing into clipping, and holds a consistent perceived loudness.
    const comp = audio.createDynamicsCompressor()
    comp.threshold.value = -15
    comp.knee.value = 14
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.22
    // Makeup for what the compressor takes off.
    const makeup = audio.createGain()
    makeup.gain.value = 1.45
    comp.connect(makeup).connect(audio.destination)

    masterGain.connect(comp) // dry

    // Wet send: lowpassed so the tail is a distant rumble, not a bright slap.
    const send = audio.createGain()
    send.gain.value = 0.19
    const tone = audio.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 2100
    const verb = audio.createConvolver()
    verb.buffer = makeImpulseResponse(audio, 2.4, 3.4)
    masterGain.connect(send).connect(tone).connect(verb).connect(comp)
    sfxBusGain.connect(masterGain)
    seaBusGain.connect(masterGain)
  }
  return sfxBusGain
}

function getSeaDestination() {
  getMasterDestination()
  return seaBusGain
}

function applyMusicMute() {
  const muted = !musicEnabled || musicVolume <= 0
  if (titleMusic) titleMusic.muted = muted
  if (deathMusic) deathMusic.muted = muted
  if (ambientMusic) ambientMusic.muted = muted
}

function applySeaVolume() {
  if (seaBusGain) seaBusGain.gain.value = seaVolume
  if (seaAmbient) {
    try {
      const audio = getContext()
      const now = audio.currentTime
      seaAmbient.gain.gain.cancelScheduledValues(now)
      seaAmbient.gain.gain.setValueAtTime(Math.max(0.0001, seaAmbient.gain.gain.value), now)
      seaAmbient.gain.gain.linearRampToValueAtTime(SEA_AMBIENT_VOLUME * seaVolume, now + 0.12)
    } catch {
      /* */
    }
  }
}

function applySfxMute() {
  if (sfxBusGain) sfxBusGain.gain.value = sfxVolume
  if (!sfxEnabled && window.speechSynthesis) {
    try { window.speechSynthesis.cancel() } catch { /* */ }
    try { stopAnnounceBed() } catch { /* */ }
  }
}

export function isSfxEnabled() {
  return sfxVolume > 0
}

export function getSfxVolume() {
  return sfxVolume
}

export function setSfxVolume(value) {
  sfxVolume = clampVolume(value)
  sfxEnabled = sfxVolume > 0
  applySfxMute()
  return sfxVolume
}

export function isMusicEnabled() {
  return musicVolume > 0
}

export function getMusicVolume() {
  return musicVolume
}

export function setMusicVolume(value) {
  musicVolume = clampVolume(value)
  musicEnabled = musicVolume > 0
  applyMusicMute()
  for (const el of [titleMusic, deathMusic, ambientMusic]) {
    if (!el) continue
    const base = el._drownedBaseVolume ?? el.volume
    fadeMusicVolume(el, base * musicVolume, 0.08)
  }
  return musicVolume
}

export function getSeaVolume() {
  return seaVolume
}

export function setSeaVolume(value) {
  seaVolume = clampVolume(value)
  applySeaVolume()
  return seaVolume
}

/** @deprecated true if either channel is on */
export function isSoundEnabled() {
  return sfxEnabled || musicEnabled
}

export function setSfxEnabled(enabled) {
  setSfxVolume(enabled !== false ? (sfxVolume > 0 ? sfxVolume : 1) : 0)
}

export function setMusicEnabled(enabled) {
  setMusicVolume(enabled !== false ? (musicVolume > 0 ? musicVolume : 1) : 0)
}

/** Master on/off — sets both SFX and music (legacy). */
export function setSoundEnabled(enabled) {
  const on = enabled !== false
  setSfxEnabled(on)
  setMusicEnabled(on)
}

// Browsers/Electron require a user gesture before audio can start — this
// blocks both the Web Audio context above and any <audio> element's
// .play(), including the title music kicked off at module load (before any
// gesture has happened). Retrying whichever track is current once a gesture
// finally arrives unsticks that initial attempt; every subsequent music
// change already happens as the direct result of a button click, so it
// doesn't need this retry.
function resumeAudioOnGesture() {
  getContext()
  ensureSfx()
  titleMusic?.play().catch(() => {})
  deathMusic?.play().catch(() => {})
  ambientMusic?.play().catch(() => {})
}
window.addEventListener('keydown', resumeAudioOnGesture, { once: true })
window.addEventListener('click', resumeAudioOnGesture, { once: true })

// --- Sample SFX (Kenney Sci-Fi Sounds, CC0 — see public/audio/sfx/KENNEY_LICENSE.txt) ---
// Real engine/weapon recordings beat pure oscillators for "sounds like a ship".
// Loaded lazily on first user gesture; synth code remains as a fallback until
// (or if) decode finishes so nothing goes silent mid-frame.
const sfxBuffers = new Map()
let sfxLoadPromise = null

// No thrust.ogg and no laser_*.ogg any more: nothing on this sea runs on
// reaction mass or coherent light. The engine is a synthesised diesel (see
// setThrustState) and the guns are synthesised reports (WEAPON_SYNTH).
// Dock/undock are pure synth (mechanical mooring + water) — the old Kenney
// sci-fi dock samples are gone.
const SFX_FILES = [
  'engine_engage.ogg',
  'rocket.ogg', 'missile.ogg', 'torpedo.ogg',
  // Short CC0 metallic impact; see public/audio/sfx/SHIP_COLLISION_CREDITS.txt
  'ship_collision_clank.mp3',
  // CC0 OpenGameArt field recording; see public/audio/sfx/SEAGULL_CREDITS.txt
  'seagull_ambient_1.wav',
  // Sounding (P) — CC0 Freesound samples; see public/audio/sfx/SONAR_CREDITS.txt
  'sonar_ping.ogg', 'sonar_return.ogg'
]

// Fantozzi's CC0 pack gives the island two useful footstep families: the
// softer Sand takes grass, soil and leaf cover; Stone covers rock, shingle,
// concrete and ruined harbour ground. Keep the files as individual one-shots
// so each step can alternate feet and vary without a looping Foley bed.
const FOOTSTEP_FILES = [
  'footsteps/Fantozzi-SandL1.ogg', 'footsteps/Fantozzi-SandL2.ogg', 'footsteps/Fantozzi-SandL3.ogg',
  'footsteps/Fantozzi-SandR1.ogg', 'footsteps/Fantozzi-SandR2.ogg', 'footsteps/Fantozzi-SandR3.ogg',
  'footsteps/Fantozzi-StoneL1.ogg', 'footsteps/Fantozzi-StoneL2.ogg', 'footsteps/Fantozzi-StoneL3.ogg',
  'footsteps/Fantozzi-StoneR1.ogg', 'footsteps/Fantozzi-StoneR2.ogg', 'footsteps/Fantozzi-StoneR3.ogg'
]

function ensureSfx() {
  if (sfxLoadPromise) return sfxLoadPromise
  const audio = getContext()
  sfxLoadPromise = Promise.all([...SFX_FILES, ...FOOTSTEP_FILES].map(async (name) => {
    try {
      const res = await fetch(`audio/sfx/${name}`)
      if (!res.ok) throw new Error(res.statusText)
      const raw = await res.arrayBuffer()
      const buf = await audio.decodeAudioData(raw.slice(0))
      sfxBuffers.set(name, buf)
    } catch (err) {
      console.warn(`sfx load failed: ${name}`, err)
    }
  }))
  return sfxLoadPromise
}

// One-shot or looping sample. Returns { source, gain, volume } or null if not loaded.
function playSample(name, {
  volume = 0.5,
  rate = 1,
  loop = false,
  fadeIn = 0,
  delay = 0,
  duration = 0,
  lowpassHz = 0,
  lowpassQ = 0.6
} = {}) {
  const buf = sfxBuffers.get(name)
  if (!buf) return null
  const audio = getContext()
  const source = audio.createBufferSource()
  source.buffer = buf
  source.loop = loop
  source.playbackRate.value = rate
  const gain = audio.createGain()
  const now = audio.currentTime + delay
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(volume, now + fadeIn)
  } else {
    gain.gain.setValueAtTime(volume, audio.currentTime)
  }
  source.connect(gain)
  if (lowpassHz > 0) {
    const lowpass = audio.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = lowpassHz
    lowpass.Q.value = lowpassQ
    gain.connect(lowpass).connect(getMasterDestination())
    source.addEventListener('ended', () => {
      try { lowpass.disconnect() } catch { /* already disconnected */ }
    }, { once: true })
  } else {
    gain.connect(getMasterDestination())
  }
  source.start(now)
  if (duration > 0 && !loop) source.stop(now + duration)
  // Store target volume — AudioParam.value is unreliable after ramps, and
  // stopSampleNodes needs a real peak to fade from (not the 0.0001 floor).
  return { source, gain, volume }
}

/** A nearby flock call — the flock renderer controls when this is audible. */
export function playGullCall() {
  ensureSfx()
  return !!playSample('seagull_ambient_1.wav', {
    volume: 0.11,
    rate: 0.94 + Math.random() * 0.12
  })
}

/**
 * A sharp, alarmed gull protest when a stray shot catches the flock.
 *
 * This is deliberately a global UI/comedy cue: it connects straight to the
 * master SFX bus rather than any world-positioned emitter, so range never
 * attenuates it. The synth fallback makes the first hit audible even if the
 * sample is still decoding after the player's initial gesture.
 */
export function playGullSquawk() {
  ensureSfx()
  if (playSample('seagull_ambient_1.wav', {
    // Comedy hit: this must cut through the diesel and sea bed, unlike the
    // deliberately distant ambient flock call above.
    volume: 0.78,
    // Pitch the natural call up and cut it short so it reads as alarm, not
    // relaxed background ambience.
    rate: 1.34 + Math.random() * 0.16,
    duration: 0.72
  })) return true

  // Do not leave the gag silent while the OGG is loading.
  tone({ type: 'triangle', freq: 2100, freqEnd: 820, duration: 0.17, peak: 0.34 })
  tone({ type: 'triangle', freq: 2450, freqEnd: 980, duration: 0.15, peak: 0.3, delay: 0.12 })
  noiseBurst({ duration: 0.045, filterFreq: 3600, peak: 0.12, drive: 1.1, delay: 0.02 })
  return true
}

const FOOTSTEP_FAMILIES = {
  grass: ['SandL1', 'SandL2', 'SandL3', 'SandR1', 'SandR2', 'SandR3'],
  sand: ['SandL1', 'SandL2', 'SandL3', 'SandR1', 'SandR2', 'SandR3'],
  stone: ['StoneL1', 'StoneL2', 'StoneL3', 'StoneR1', 'StoneR2', 'StoneR3'],
  wood: ['StoneL1', 'StoneL2', 'StoneL3', 'StoneR1', 'StoneR2', 'StoneR3']
}

/** Play a close, unattenuated player footstep using the current terrain family. */
export function playFootstep(surface = 'grass', { running = false, side = 'L' } = {}) {
  ensureSfx()
  const family = FOOTSTEP_FAMILIES[surface] ?? FOOTSTEP_FAMILIES.grass
  const wantedSide = side === 'R' ? 'R' : 'L'
  const choices = family.filter((name) => name.includes(wantedSide))
  const stem = choices[Math.floor(Math.random() * choices.length)] ?? family[0]
  const familyName = stem.startsWith('Sand') ? 'Sand' : 'Stone'
  const file = `footsteps/Fantozzi-${familyName}${stem.slice(familyName.length)}.ogg`
  if (playSample(file, {
    volume: running ? 0.32 : 0.25,
    rate: (running ? 1.04 : 0.98) + Math.random() * 0.08
  })) return true

  // Audio decoding is lazy; a small fallback keeps the first step audible
  // while the real CC0 clip finishes decoding after the first key press.
  noiseBurst({
    duration: running ? 0.075 : 0.06,
    filterFreq: surface === 'stone' || surface === 'wood' ? 1800 : 1050,
    peak: running ? 0.16 : 0.12,
    drive: surface === 'stone' ? 1.4 : 0.7
  })
  return false
}

function stopSampleNodes(nodes, fadeOut = 0.12) {
  if (!nodes) return
  const audio = getContext()
  const now = audio.currentTime
  try {
    const from = Math.max(nodes.volume ?? nodes.gain.gain.value ?? 0.001, 0.0001)
    nodes.gain.gain.cancelScheduledValues(now)
    nodes.gain.gain.setValueAtTime(from, now)
    nodes.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut)
    nodes.source.stop(now + fadeOut + 0.02)
    // Hard-disconnect so a failed stop can't leave a loop leaking forever.
    const src = nodes.source
    const g = nodes.gain
    setTimeout(() => {
      try { src.disconnect() } catch { /* already */ }
      try { g.disconnect() } catch { /* already */ }
    }, (fadeOut + 0.05) * 1000)
  } catch {
    try { nodes.source.stop() } catch { /* already */ }
    try { nodes.source.disconnect() } catch { /* already */ }
    try { nodes.gain.disconnect() } catch { /* already */ }
  }
}

// delay (seconds, from now) lets callers layer several tone()/noiseBurst()
// calls with a slight offset instead of all starting simultaneously — used
// by the dock/undock clunk-then-hiss sequencing below.
function tone({ type = 'sine', freq, freqEnd, duration, attack = 0.005, peak = 0.25, delay = 0 }) {
  const audio = getContext()
  const start = audio.currentTime + delay
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + duration)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(peak, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(getMasterDestination())
  osc.start(start)
  osc.stop(start + duration + 0.05)
}

// A tanh soft-clip curve for WaveShaperNode — cheap analog-style saturation
// that thickens a signal ("grit"/"crunch") instead of just making it louder.
function distortionCurve(amount) {
  const samples = 256
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(amount * x)
  }
  return curve
}

function noiseBurst({ duration, filterFreq = 800, peak = 0.4, drive = 0, delay = 0, destination = null }) {
  const audio = getContext()
  const start = audio.currentTime + delay
  const bufferSize = Math.floor(audio.sampleRate * duration)
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize)

  const source = audio.createBufferSource()
  source.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = filterFreq
  const gain = audio.createGain()
  gain.gain.setValueAtTime(peak, start)
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration)

  let tail = filter
  if (drive > 0) {
    const shaper = audio.createWaveShaper()
    shaper.curve = distortionCurve(drive)
    filter.connect(shaper)
    tail = shaper
  }
  source.connect(filter)
  tail.connect(gain).connect(destination ?? getMasterDestination())
  source.start(start)
}

// Weapon report, per weapon id in data/weapons.js.
//
// All synthesised, deliberately. There is no energy weapon on this sea, so the
// laser samples are gone; what is left is powder, hydraulics and counterweights.
// A gun report is a very short shaped noise transient over a low thump, which
// oscillators do well and a generic "zap" sample does not.
//
// The launcher samples (rocket/missile/torpedo) survive — they were already
// low whooshes rather than sci-fi, and they read fine as a harpoon or a fish
// leaving the tube.
const WEAPON_SAMPLES = {
  rocket_pod: { file: 'rocket.ogg', volume: 0.7, rate: 0.62 },
  seeker_missile: { file: 'missile.ogg', volume: 0.74, rate: 0.6 },
  torpedo: { file: 'torpedo.ogg', volume: 0.84, rate: 0.58 },
  singularity_seed: { file: 'torpedo.ogg', volume: 0.88, rate: 0.5 }
}

/**
 * A gun going off: a crack (the muzzle blast), a body thump (the breech and the
 * mount taking the recoil), and a tail (the report rolling away over water).
 *
 * @param {object} o
 * @param {number} o.crack   brightness of the muzzle blast, Hz
 * @param {number} o.body    fundamental of the thump, Hz
 * @param {number} o.punch   overall level
 * @param {number} o.tail    seconds of roll-off across the water
 */
function gunReport({ crack, body, punch = 0.4, tail = 0.35, drive = 2.4 }) {
  noiseBurst({ duration: 0.035, filterFreq: crack, peak: punch, drive })
  noiseBurst({ duration: tail, filterFreq: crack * 0.28, peak: punch * 0.55, drive: drive * 1.4, delay: 0.01 })
  tone({ type: 'sine', freq: body, freqEnd: body * 0.35, duration: tail * 0.8, peak: punch * 0.9 })
  tone({ type: 'square', freq: body * 2.4, freqEnd: body * 0.7, duration: 0.06, peak: punch * 0.35 })
}

const WEAPON_SYNTH_FALLBACK = {
  // --- Guns ---
  // Deck gun: a single heavy shell. Slow, loud, and it rolls.
  pulse_laser: () => gunReport({ crack: 2600, body: 78, punch: 0.5, tail: 0.55, drive: 3 }),
  // Autocannon: fast and dry, no time for a tail before the next round.
  rapid_laser: () => gunReport({ crack: 3600, body: 150, punch: 0.3, tail: 0.12, drive: 1.8 }),
  // Chain gun: faster still, brighter, mechanical.
  burst_laser: () => {
    gunReport({ crack: 4200, body: 190, punch: 0.26, tail: 0.09, drive: 1.6 })
    // The action cycling — this is what separates a chain gun from a rifle.
    tone({ type: 'square', freq: 620, freqEnd: 380, duration: 0.04, peak: 0.1, delay: 0.02 })
  },
  // Rivet gun: a compressed-air slam driving a steel bolt. More clang than bang.
  beam_laser: () => {
    noiseBurst({ duration: 0.06, filterFreq: 1400, peak: 0.36, drive: 2 })
    tone({ type: 'square', freq: 210, freqEnd: 60, duration: 0.18, peak: 0.34 })
    tone({ type: 'triangle', freq: 1250, freqEnd: 700, duration: 0.22, peak: 0.14, delay: 0.01 })
    tone({ type: 'sine', freq: 52, freqEnd: 24, duration: 0.3, peak: 0.3 })
  },
  // Stone catapult: rope, timber and a counterweight. No powder at all — a
  // creak, the arm slamming its stop, and the rock leaving.
  plasma_cannon: () => {
    tone({ type: 'sawtooth', freq: 90, freqEnd: 130, duration: 0.28, peak: 0.1 })
    noiseBurst({ duration: 0.09, filterFreq: 900, peak: 0.4, drive: 2.6, delay: 0.26 })
    tone({ type: 'sine', freq: 62, freqEnd: 28, duration: 0.5, peak: 0.5, delay: 0.26 })
    tone({ type: 'square', freq: 140, freqEnd: 48, duration: 0.2, peak: 0.2, delay: 0.27 })
  },
  // The Fixo Pistol deliberately shares the basic Deck Gun report.
  fixo_pistol: () => WEAPON_SYNTH_FALLBACK.pulse_laser(),

  // --- Launchers ---
  // Harpoon gun: the charge, then line running off the drum behind it.
  rocket_pod: () => {
    noiseBurst({ duration: 0.05, filterFreq: 2200, peak: 0.42, drive: 2.4 })
    tone({ type: 'sine', freq: 95, freqEnd: 40, duration: 0.3, peak: 0.4 })
    noiseBurst({ duration: 0.7, filterFreq: 1700, peak: 0.14, delay: 0.05 })
  },
  seeker_missile: () => {
    noiseBurst({ duration: 0.06, filterFreq: 2600, peak: 0.46, drive: 2.6 })
    tone({ type: 'sine', freq: 80, freqEnd: 34, duration: 0.38, peak: 0.46 })
    noiseBurst({ duration: 0.95, filterFreq: 1500, peak: 0.16, delay: 0.06 })
  },
  torpedo: () => {
    // Compressed air slamming a fish out of the tube, then it swims.
    noiseBurst({ duration: 0.22, filterFreq: 480, peak: 0.5, drive: 3.4 })
    tone({ type: 'sine', freq: 38, freqEnd: 17, duration: 0.9, peak: 0.55 })
    noiseBurst({ duration: 1.1, filterFreq: 300, peak: 0.2, delay: 0.15 })
  },

  // --- The Drowned: pre-war military ordnance, salvaged and refitted ---
  phase_spit: () => gunReport({ crack: 3900, body: 165, punch: 0.34, tail: 0.14, drive: 2 }),
  // Railgun: not a chemical propellant — a capacitor bank dumping, then a
  // supersonic slug tearing the air. The one weapon allowed an electrical edge.
  void_lance: () => {
    tone({ type: 'sawtooth', freq: 2400, freqEnd: 120, duration: 0.05, peak: 0.2 })
    noiseBurst({ duration: 0.05, filterFreq: 6000, peak: 0.45, drive: 1.4 })
    noiseBurst({ duration: 0.45, filterFreq: 900, peak: 0.3, drive: 2.6, delay: 0.02 })
    tone({ type: 'sine', freq: 60, freqEnd: 26, duration: 0.6, peak: 0.42 })
  },
  neural_sear: () => gunReport({ crack: 5200, body: 240, punch: 0.22, tail: 0.07, drive: 1.4 }),
  // Depth charge: a drum rolled off the stern. Barely a sound until it goes.
  spore_pod: () => {
    noiseBurst({ duration: 0.12, filterFreq: 700, peak: 0.24, drive: 2 })
    tone({ type: 'square', freq: 120, freqEnd: 70, duration: 0.16, peak: 0.16 })
    noiseBurst({ duration: 0.5, filterFreq: 260, peak: 0.2, drive: 3, delay: 0.1 })
  }
}

export function playWeaponFire(weaponId) {
  ensureSfx()
  const sample = WEAPON_SAMPLES[weaponId]
  // Slight rate jitter so rapid fire doesn't sound like a stuck sample.
  if (sample) {
    const rate = sample.rate * (0.97 + Math.random() * 0.06)
    if (playSample(sample.file, { volume: sample.volume, rate })) return
  }
  const fallback = WEAPON_SYNTH_FALLBACK[weaponId] ?? WEAPON_SYNTH_FALLBACK.pulse_laser
  fallback()
}

export function playHit() {
  ensureSfx()
  const impactTone = [150, 175, 205, 240, 285, 330][Math.floor(Math.random() * 6)]
  const impactRate = 0.7 + Math.random() * 0.2
  const lowpassHz = 1050 + Math.random() * 750

  if (playSample('ship_collision_clank.mp3', {
    volume: 0.48 + Math.random() * 0.12,
    rate: impactRate,
    lowpassHz,
    lowpassQ: 0.55
  })) {
    // The recording supplies the metal; this shifting low body makes rapid
    // laser hits land as individual impacts instead of one repeated clank.
    tone({
      type: 'sine',
      freq: impactTone * 0.55,
      freqEnd: impactTone * 0.28,
      duration: 0.16,
      peak: 0.06
    })
    return
  }

  // Matching fallback while the sample is decoding or unavailable.
  noiseBurst({ duration: 0.05, filterFreq: lowpassHz * 0.7, peak: 0.12, drive: 1.3 })
  tone({ type: 'triangle', freq: impactTone * 1.45, freqEnd: impactTone * 0.72, duration: 0.18, peak: 0.17 })
  tone({ type: 'sine', freq: impactTone * 0.5, freqEnd: impactTone * 0.25, duration: 0.16, peak: 0.08 })
}

/** A short, low impact on dirt, timber, or masonry from the Fixo Pistol. */
export function playFixoImpact() {
  playDullImpact()
}

/** A short, low impact on terrain or harbour structures from a ship round. */
export function playTerrainImpact() {
  playDullImpact()
}

function playDullImpact() {
  ensureSfx()
  noiseBurst({ duration: 0.045, filterFreq: 620, peak: 0.2, drive: 1.2 })
  tone({ type: 'sine', freq: 92, freqEnd: 48, duration: 0.16, peak: 0.22 })
}

/** A soft, low splash/blob when a ship round punches into open water. */
export function playWaterImpact() {
  ensureSfx()
  noiseBurst({ duration: 0.12, filterFreq: 720, peak: 0.13, drive: 1.1 })
  noiseBurst({ duration: 0.32, filterFreq: 300, peak: 0.09, drive: 1.2, delay: 0.025 })
  tone({ type: 'sine', freq: 150, freqEnd: 62, duration: 0.2, peak: 0.1 })
}

/** Heavy, low explosive impact for a missile striking a solid target. */
export function playMissileImpact() {
  ensureSfx()
  noiseBurst({ duration: 0.1, filterFreq: 1250, peak: 0.34, drive: 2.8 })
  tone({ type: 'triangle', freq: 92, freqEnd: 26, duration: 0.72, peak: 0.42 })
  noiseBurst({ duration: 1.05, filterFreq: 190, peak: 0.36, drive: 3.4, delay: 0.04 })
  tone({ type: 'sine', freq: 48, freqEnd: 16, duration: 1.0, peak: 0.28, delay: 0.08 })
}

let lastShipCollisionAtMs = -Infinity

/** Short, weighty hull impact. Rate-limited so resting against another ship does not loop. */
export function playShipCollision() {
  ensureSfx()
  const nowMs = globalThis.performance?.now?.() ?? Date.now()
  if (nowMs - lastShipCollisionAtMs < 220) return false
  lastShipCollisionAtMs = nowMs

  if (playSample('ship_collision_clank.mp3', {
    volume: 0.78,
    // Slow the recording down and remove its bright edge: this should feel
    // like a heavy hull meeting another hull, not a dropped piece of pipe.
    rate: 0.78 + Math.random() * 0.08,
    lowpassHz: 1350,
    lowpassQ: 0.55
  })) {
    // A quiet sub/body layer gives the softened recording some physical weight.
    tone({ type: 'sine', freq: 92, freqEnd: 48, duration: 0.2, peak: 0.1 })
    return true
  }

  // Keep collisions audible while the sample is still decoding, or if it fails to load.
  noiseBurst({ duration: 0.06, filterFreq: 900, peak: 0.18, drive: 1.6 })
  tone({ type: 'triangle', freq: 240, freqEnd: 120, duration: 0.22, peak: 0.2 })
  tone({ type: 'sine', freq: 85, freqEnd: 46, duration: 0.2, peak: 0.11 })
  return true
}

// Chunkier, multi-layer boom: a sharp high-passed crack for the initial
// transient, a big driven low-passed rumble for the body, and a deep
// pitch-dropping sub layer underneath for weight — a single lowpassed noise
// burst read as a thin "hiss" rather than an actual explosion.
export function playExplosion() {
  noiseBurst({ duration: 0.08, filterFreq: 3200, peak: 0.35 })
  noiseBurst({ duration: 0.9, filterFreq: 500, peak: 0.65, drive: 3 })
  tone({ type: 'sine', freq: 110, freqEnd: 30, duration: 0.8, peak: 0.5 })
  tone({ type: 'square', freq: 55, freqEnd: 25, duration: 0.6, peak: 0.25 })
}

export function playClick() {
  tone({ type: 'square', freq: 700, duration: 0.05, peak: 0.08 })
}

/** Soft industrial "order accepted" chime when a craft job starts. */
export function playCraftStart() {
  tone({ type: 'sine', freq: 392, duration: 0.12, peak: 0.11 })
  tone({ type: 'sine', freq: 523, duration: 0.16, peak: 0.13, delay: 0.09 })
  tone({ type: 'triangle', freq: 659, duration: 0.22, peak: 0.09, delay: 0.18 })
}

/** Brighter success chime when a craft job finishes. */
export function playCraftComplete() {
  tone({ type: 'sine', freq: 523, duration: 0.14, peak: 0.13 })
  tone({ type: 'sine', freq: 659, duration: 0.16, peak: 0.15, delay: 0.11 })
  tone({ type: 'sine', freq: 784, duration: 0.22, peak: 0.16, delay: 0.22 })
  tone({ type: 'triangle', freq: 1047, duration: 0.32, peak: 0.1, delay: 0.34 })
}

/** Soft confirmation chime for successful game save. */
export function playSaveChime() {
  tone({ type: 'sine', freq: 660, duration: 0.1, peak: 0.12 })
  tone({ type: 'sine', freq: 880, duration: 0.14, peak: 0.14, delay: 0.08 })
  tone({ type: 'triangle', freq: 1320, duration: 0.22, peak: 0.1, delay: 0.18 })
  tone({ type: 'sine', freq: 1760, duration: 0.28, peak: 0.06, delay: 0.28 })
}

/** Mission contract completed — distinct success fanfare (auto-complete payout). */
export function playMissionComplete() {
  tone({ type: 'sine', freq: 494, duration: 0.12, peak: 0.14 })
  tone({ type: 'sine', freq: 622, duration: 0.14, peak: 0.15, delay: 0.1 })
  tone({ type: 'triangle', freq: 740, duration: 0.18, peak: 0.14, delay: 0.2 })
  tone({ type: 'sine', freq: 988, duration: 0.28, peak: 0.12, delay: 0.32 })
  tone({ type: 'sine', freq: 1245, duration: 0.35, peak: 0.08, delay: 0.42 })
}

/** Probe recovered survey data / blueprint / skillbook — short discovery ping. */
export function playProbeFind() {
  tone({ type: 'sine', freq: 880, duration: 0.07, peak: 0.12 })
  tone({ type: 'triangle', freq: 1175, duration: 0.1, peak: 0.14, delay: 0.06 })
  tone({ type: 'sine', freq: 1568, duration: 0.16, peak: 0.11, delay: 0.14 })
  tone({ type: 'sine', freq: 2093, duration: 0.22, peak: 0.07, delay: 0.24 })
}

/** Nav waypoint set — short two-tone ping (clear / distinct from save). */
export function playWaypointSet() {
  tone({ type: 'sine', freq: 880, duration: 0.08, peak: 0.12 })
  tone({ type: 'triangle', freq: 1175, duration: 0.14, peak: 0.14, delay: 0.07 })
  tone({ type: 'sine', freq: 1480, duration: 0.18, peak: 0.08, delay: 0.16 })
}

/** Nav waypoint cleared — softer descending tone. */
export function playWaypointClear() {
  tone({ type: 'sine', freq: 740, duration: 0.08, peak: 0.1 })
  tone({ type: 'triangle', freq: 554, duration: 0.14, peak: 0.09, delay: 0.08 })
}

// Side thruster chirp while strafing.
let strafeNodes = null
let strafeWanted = false

export function setStrafeActive(active) {
  ensureSfx()
  if (active === strafeWanted) return
  strafeWanted = active
  if (!active) {
    if (strafeNodes) {
      stopSampleNodes(strafeNodes, 0.08)
      strafeNodes = null
    }
    return
  }
  const nodes = playSample('engine_engage.ogg', { volume: 0.2, rate: 0.55, loop: true, fadeIn: 0.06 })
  if (nodes) {
    strafeNodes = nodes
    return
  }
  // Synth fallback: short bright thruster hum.
  const audioCtx = getContext()
  const source = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  source.type = 'square'
  source.frequency.value = 110
  gain.gain.setValueAtTime(0, audioCtx.currentTime)
  gain.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 0.05)
  source.connect(gain).connect(getMasterDestination())
  source.start()
  strafeNodes = { source, gain, volume: 0.04 }
}

// Continuous faint propeller buzz while combat drones are airborne.
let droneBuzzNodes = null
let droneBuzzCount = -1

/**
 * Prop buzz for deployed escort drones. Pass how many are in the air (0 = off).
 * Layered band-limited noise + blade-rate hum; deliberately quiet under engines.
 */
export function setDroneBuzz(count) {
  ensureSfx()
  const n = Math.max(0, Math.floor(Number(count) || 0))
  // Peak for one drone; extra drones only nudge a little (not linear).
  // Kept soft under engines — bump carefully if it starts to dominate.
  const peak = n <= 0 ? 0 : 0.02 + Math.min(2, n - 1) * 0.006

  const audio = getContext()
  const now = audio.currentTime

  if (n <= 0) {
    if (droneBuzzCount === 0 && !droneBuzzNodes) return
    droneBuzzCount = 0
    if (droneBuzzNodes) {
      const { gain, sources } = droneBuzzNodes
      try {
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now)
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.28)
      } catch {
        /* */
      }
      const stopAt = now + 0.32
      for (const s of sources) {
        try {
          s.stop(stopAt)
        } catch {
          /* */
        }
      }
      droneBuzzNodes = null
    }
    return
  }

  droneBuzzCount = n
  if (droneBuzzNodes) {
    // Already running — retarget volume (count change or live level tweak).
    if (Math.abs((droneBuzzNodes.volume ?? 0) - peak) < 0.0005) return
    try {
      const g = droneBuzzNodes.gain
      g.gain.cancelScheduledValues(now)
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now)
      g.gain.linearRampToValueAtTime(peak, now + 0.2)
      droneBuzzNodes.volume = peak
    } catch {
      /* */
    }
    return
  }

  // Soft multi-layer prop bed — start once, hold open until all drones bay.
  const master = audio.createGain()
  master.gain.setValueAtTime(0.0001, now)
  master.gain.linearRampToValueAtTime(peak, now + 0.4)
  master.connect(getMasterDestination())

  const sources = []

  // Air through rotors — mild brown noise, band-passed (not white static).
  const noiseLen = Math.floor(audio.sampleRate * 1.25)
  const noiseBuf = audio.createBuffer(1, noiseLen, audio.sampleRate)
  const data = noiseBuf.getChannelData(0)
  let brown = 0
  for (let i = 0; i < noiseLen; i++) {
    brown = (brown + (Math.random() * 2 - 1) * 0.02) * 0.985
    data[i] = brown * 3.2
  }
  const noise = audio.createBufferSource()
  noise.buffer = noiseBuf
  noise.loop = true
  const bp = audio.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 900
  bp.Q.value = 0.8
  const airGain = audio.createGain()
  airGain.gain.value = 0.58
  noise.connect(bp).connect(airGain).connect(master)
  noise.start()
  sources.push(noise)

  // Blade-rate hum — detuned saws, heavily low-passed so they read as motors.
  for (const [freq, detune, level] of [
    [55, -8, 0.24],
    [59, 11, 0.18],
    [112, 0, 0.09]
  ]) {
    const osc = audio.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq
    osc.detune.value = detune
    const lp = audio.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 340
    lp.Q.value = 0.35
    const og = audio.createGain()
    og.gain.value = level
    osc.connect(lp).connect(og).connect(master)
    osc.start()
    sources.push(osc)
  }

  droneBuzzNodes = { gain: master, sources, volume: peak }
}

/**
 * Metal strike with a ringing tail (bollard, hook, cleat).
 * Bright attack + inharmonic partials so it reads as iron, not a bass thump.
 */
function metalClank({ freq = 480, peak = 0.26, delay = 0 } = {}) {
  // Knife-edge scrape/click (high, short).
  noiseBurst({ duration: 0.045, filterFreq: 3200, peak: peak * 0.85, drive: 4.5, delay })
  noiseBurst({ duration: 0.07, filterFreq: 1400, peak: peak * 0.45, drive: 2.5, delay: delay + 0.01 })
  // Ringing body — triangle partials (not a pure low sine).
  tone({ type: 'triangle', freq, freqEnd: freq * 0.88, duration: 0.28, attack: 0.001, peak: peak * 0.72, delay })
  tone({
    type: 'triangle',
    freq: freq * 1.72,
    freqEnd: freq * 1.35,
    duration: 0.2,
    attack: 0.001,
    peak: peak * 0.32,
    delay: delay + 0.004
  })
  tone({
    type: 'square',
    freq: freq * 0.55,
    freqEnd: freq * 0.42,
    duration: 0.1,
    attack: 0.001,
    peak: peak * 0.18,
    delay
  })
}

/** Quick chain / shackle rattle — several tiny metal hits in a row. */
function chainRattle({ delay = 0, count = 6, peak = 0.14 } = {}) {
  for (let i = 0; i < count; i++) {
    const t = delay + i * 0.045
    const f = 620 + (i % 3) * 180 + (i * 37) % 120
    noiseBurst({ duration: 0.028, filterFreq: 2100 + i * 120, peak: peak * (0.75 - i * 0.06), drive: 3.8, delay: t })
    tone({ type: 'triangle', freq: f, duration: 0.035, attack: 0.001, peak: peak * 0.35, delay: t })
  }
}

/** Hand-winch / ratchet clicks as a line is hauled or paid out. */
function winchRatchet({ delay = 0, steps = 5, peak = 0.12 } = {}) {
  for (let i = 0; i < steps; i++) {
    const t = delay + i * 0.07
    noiseBurst({ duration: 0.022, filterFreq: 2600 - i * 180, peak: peak * (0.9 - i * 0.08), drive: 5, delay: t })
    tone({ type: 'square', freq: 340 - i * 28, duration: 0.028, attack: 0.001, peak: peak * 0.4, delay: t })
  }
}

/**
 * Mooring — chunky ironwork and chain, light water underlay.
 * Not a sci-fi bay, and not just a rubber thump.
 */
export function playDock() {
  ensureSfx()
  // Quiet water underlay (background only).
  noiseBurst({ duration: 0.9, filterFreq: 320, peak: 0.06, drive: 0.8, delay: 0 })
  // Winch hauls the line in.
  winchRatchet({ delay: 0.08, steps: 6, peak: 0.13 })
  // Chain runs over the fairlead.
  chainRattle({ delay: 0.18, count: 7, peak: 0.12 })
  // Hook takes the bollard — primary mechanical hit.
  metalClank({ freq: 520, peak: 0.3, delay: 0.48 })
  metalClank({ freq: 310, peak: 0.18, delay: 0.55 })
  // Second line / cleat.
  chainRattle({ delay: 0.78, count: 4, peak: 0.1 })
  metalClank({ freq: 440, peak: 0.22, delay: 0.95 })
  // Metal settle + a little water against the piles.
  tone({ type: 'triangle', freq: 180, freqEnd: 95, duration: 0.35, peak: 0.08, delay: 1.1 })
  noiseBurst({ duration: 0.55, filterFreq: 400, peak: 0.05, delay: 1.15 })
}

/**
 * Casting off — ratchet free, shackle open, lines clear, then a soft push-off.
 */
export function playUndock() {
  ensureSfx()
  // Shackle / pin free.
  metalClank({ freq: 680, peak: 0.22, delay: 0 })
  chainRattle({ delay: 0.06, count: 5, peak: 0.13 })
  // Winch pays out a little, then free.
  winchRatchet({ delay: 0.22, steps: 4, peak: 0.11 })
  metalClank({ freq: 390, peak: 0.2, delay: 0.42 })
  // Line slips the bollard — scrape + final clank.
  noiseBurst({ duration: 0.12, filterFreq: 2400, peak: 0.16, drive: 3.5, delay: 0.55 })
  metalClank({ freq: 540, peak: 0.16, delay: 0.62 })
  // Soft water push as she eases clear (under the metal, not the star).
  noiseBurst({ duration: 0.7, filterFreq: 280, peak: 0.08, drive: 1.2, delay: 0.7 })
  tone({ type: 'sawtooth', freq: 70, freqEnd: 48, duration: 0.3, peak: 0.06, delay: 0.78 })
}

// Mid-sequence nudge — short mechanical winch tick + diesel bite, not a thump.
export function playDockThrusterPulse() {
  ensureSfx()
  winchRatchet({ delay: 0, steps: 2, peak: 0.08 })
  tone({ type: 'sawtooth', freq: 72, freqEnd: 50, duration: 0.22, peak: 0.07 })
  noiseBurst({ duration: 0.25, filterFreq: 500, peak: 0.07, drive: 1.4, delay: 0.03 })
}

// ── Ambient sea bed (quiet water lapping) ───────────────────────────────────
// Always-on while a session is live. Sits under diesel / combat; never loud.
let seaAmbient = null
let seaLapTimer = null
/** Peak gain for the continuous wash — keep low so dialogue/engines win. */
const SEA_AMBIENT_VOLUME = 0.058

function scheduleSeaLap() {
  if (!seaAmbient) return
  // Soft irregular lapping — not a metronome.
  const wait = 2200 + Math.random() * 3200
  seaLapTimer = setTimeout(() => {
    seaLapTimer = null
    if (!seaAmbient || seaVolume <= 0) {
      scheduleSeaLap()
      return
    }
    const peak = 0.024 + Math.random() * 0.024
    noiseBurst({
      duration: 0.4 + Math.random() * 0.55,
      filterFreq: 220 + Math.random() * 280,
      peak,
      drive: 0.6 + Math.random() * 0.8,
      destination: getSeaDestination()
    })
    // Occasional deeper wash under the pile.
    if (Math.random() < 0.35) {
      noiseBurst({
        duration: 0.7 + Math.random() * 0.4,
        filterFreq: 120 + Math.random() * 80,
        peak: peak * 0.7,
        drive: 1.2,
        delay: 0.08,
        destination: getSeaDestination()
      })
    }
    scheduleSeaLap()
  }, wait)
}

/**
 * Quiet open-water bed: brown-ish wash through a soft bandpass.
 * Start when a game session is active; stop on the title screen.
 */
export function startSeaAmbient() {
  ensureSfx()
  if (seaAmbient) {
    // Already running (e.g. HMR volume tweak) — ease to the current constant.
    try {
      const audio = getContext()
      const now = audio.currentTime
      const g = seaAmbient.gain
      g.gain.cancelScheduledValues(now)
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now)
      g.gain.linearRampToValueAtTime(SEA_AMBIENT_VOLUME * seaVolume, now + 0.6)
    } catch {
      /* */
    }
    return
  }
  const audio = getContext()
  // 6 s loop of filtered brown noise — reads as continuous water, not static.
  const seconds = 6
  const n = Math.floor(audio.sampleRate * seconds)
  const buf = audio.createBuffer(1, n, audio.sampleRate)
  const data = buf.getChannelData(0)
  let brown = 0
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.015 * white) / 1.015
    // Mild slow amplitude breathing so it does not sound like a stuck loop.
    const breath = 0.85 + 0.15 * Math.sin((i / n) * Math.PI * 2 * 1.7)
    data[i] = brown * 4.2 * breath
  }
  const source = audio.createBufferSource()
  source.buffer = buf
  source.loop = true
  const band = audio.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 340
  band.Q.value = 0.55
  const low = audio.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 780
  const high = audio.createBiquadFilter()
  high.type = 'highpass'
  high.frequency.value = 80
  const gain = audio.createGain()
  const now = audio.currentTime
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(SEA_AMBIENT_VOLUME * seaVolume, now + 2.8)
  source.connect(high).connect(band).connect(low).connect(gain).connect(getSeaDestination())
  source.start()
  seaAmbient = { source, gain }
  scheduleSeaLap()
}

export function stopSeaAmbient(fadeOut = 1.4) {
  if (seaLapTimer != null) {
    clearTimeout(seaLapTimer)
    seaLapTimer = null
  }
  if (!seaAmbient) return
  const { source, gain } = seaAmbient
  seaAmbient = null
  const audio = getContext()
  const now = audio.currentTime
  try {
    const from = Math.max(gain.gain.value, 0.0001)
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(from, now)
    gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut)
    source.stop(now + fadeOut + 0.05)
    setTimeout(() => {
      try { source.disconnect() } catch { /* */ }
      try { gain.disconnect() } catch { /* */ }
    }, (fadeOut + 0.1) * 1000)
  } catch {
    try { source.stop() } catch { /* */ }
  }
}

// --- Rain bed + deep thunder -------------------------------------------------
// Rain is filtered noise (not a sample): high-mid hiss for drops, low rumble
// under it in a storm. Thunder is a one-shot: sub boom + rolling body, no
// bright crack so it reads as distance over water.

let rainBed = null
let rainLevel = 0

function ensureRainBed() {
  if (rainBed) return rainBed
  const audio = getContext()
  const seconds = 3.2
  const n = Math.floor(audio.sampleRate * seconds)
  const buf = audio.createBuffer(1, n, audio.sampleRate)
  const data = buf.getChannelData(0)
  // White-ish rain with mild brown undercurrent so it is not pure static.
  let brown = 0
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.02 * white) / 1.02
    // Sparse louder “fat drops”.
    const drop = Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.9 : 0
    data[i] = white * 0.55 + brown * 1.4 + drop
  }
  const source = audio.createBufferSource()
  source.buffer = buf
  source.loop = true
  const hip = audio.createBiquadFilter()
  hip.type = 'highpass'
  hip.frequency.value = 420
  const band = audio.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 2400
  band.Q.value = 0.45
  const low = audio.createBiquadFilter()
  low.type = 'lowpass'
  low.frequency.value = 6200
  // Separate low “storm air” bus — only heard when raining hard.
  const bodySrc = audio.createBufferSource()
  bodySrc.buffer = buf
  bodySrc.loop = true
  const bodyLp = audio.createBiquadFilter()
  bodyLp.type = 'lowpass'
  bodyLp.frequency.value = 280
  const bodyG = audio.createGain()
  bodyG.gain.value = 0.0001
  const gain = audio.createGain()
  gain.gain.value = 0.0001
  source.connect(hip).connect(band).connect(low).connect(gain).connect(getMasterDestination())
  bodySrc.connect(bodyLp).connect(bodyG).connect(getMasterDestination())
  const now = audio.currentTime
  source.start(now)
  bodySrc.start(now)
  rainBed = { source, bodySrc, gain, bodyG }
  return rainBed
}

/**
 * Continuous rain on the hull / cabin glass.
 * @param {number} level 0 silent … 1 full storm rain
 */
export function setRainLevel(level) {
  ensureSfx()
  const next = Math.min(1, Math.max(0, level))
  if (Math.abs(next - rainLevel) < 0.02 && (next === 0 || rainBed)) {
    rainLevel = next
    return
  }
  rainLevel = next
  if (next < 0.02) {
    if (!rainBed) return
    const audio = getContext()
    const now = audio.currentTime
    const { gain, bodyG, source, bodySrc } = rainBed
    try {
      gain.gain.cancelScheduledValues(now)
      bodyG.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now)
      bodyG.gain.setValueAtTime(Math.max(bodyG.gain.value, 0.0001), now)
      gain.gain.linearRampToValueAtTime(0.0001, now + 1.2)
      bodyG.gain.linearRampToValueAtTime(0.0001, now + 1.2)
      source.stop(now + 1.35)
      bodySrc.stop(now + 1.35)
    } catch { /* */ }
    rainBed = null
    return
  }
  const bed = ensureRainBed()
  const audio = getContext()
  const now = audio.currentTime
  // Quiet under diesel / sea bed — rain is atmosphere, not a wash-out.
  const peak = 0.022 + next * 0.065
  const bodyPeak = next > 0.55 ? (next - 0.55) * 0.07 : 0
  try {
    bed.gain.gain.cancelScheduledValues(now)
    bed.bodyG.gain.cancelScheduledValues(now)
    bed.gain.gain.setValueAtTime(Math.max(bed.gain.gain.value, 0.0001), now)
    bed.bodyG.gain.setValueAtTime(Math.max(bed.bodyG.gain.value, 0.0001), now)
    bed.gain.gain.linearRampToValueAtTime(peak, now + 0.6)
    bed.bodyG.gain.linearRampToValueAtTime(Math.max(0.0001, bodyPeak), now + 0.8)
  } catch { /* */ }
}

/**
 * Deep bassy thunderclap — pressure boom + rolling body, not a bright crack.
 * @param {{ delay?: number, volume?: number }} [opts]
 */
export function playThunder(opts = {}) {
  ensureSfx()
  if (!sfxEnabled) return
  const delay = opts.delay ?? 0
  const volume = opts.volume ?? 1
  // Sub pressure — the part you feel more than hear.
  tone({
    type: 'sine',
    freq: 48,
    freqEnd: 22,
    duration: 2.8,
    attack: 0.02,
    peak: 0.42 * volume,
    delay
  })
  tone({
    type: 'sine',
    freq: 72,
    freqEnd: 28,
    duration: 2.2,
    attack: 0.015,
    peak: 0.28 * volume,
    delay: delay + 0.02
  })
  tone({
    type: 'triangle',
    freq: 95,
    freqEnd: 36,
    duration: 1.6,
    attack: 0.01,
    peak: 0.16 * volume,
    delay: delay + 0.04
  })
  // Body roll — low filtered noise, long.
  noiseBurst({
    duration: 2.4,
    filterFreq: 160,
    peak: 0.48 * volume,
    drive: 2.4,
    delay
  })
  noiseBurst({
    duration: 1.8,
    filterFreq: 90,
    peak: 0.38 * volume,
    drive: 3.2,
    delay: delay + 0.05
  })
  // Distant secondary roll.
  noiseBurst({
    duration: 2.6,
    filterFreq: 70,
    peak: 0.22 * volume,
    drive: 1.8,
    delay: delay + 0.35
  })
  // Soft mid grumble so it is not pure sub-woofer.
  noiseBurst({
    duration: 1.1,
    filterFreq: 320,
    peak: 0.12 * volume,
    drive: 1.2,
    delay: delay + 0.08
  })
}

/** Kill rain bed (title screen / mute path). */
export function stopWeatherAudio(fadeOut = 0.8) {
  if (!rainBed) {
    rainLevel = 0
    return
  }
  setRainLevel(0)
  void fadeOut
}

/**
 * Active sounding ping (P key).
 *
 * Prefers a real CC0 sample (classic submarine ping with reverb). Falls back
 * to the old oscillator stack if the buffer is not loaded yet.
 */
export function playSonarPing(index = 0) {
  ensureSfx()
  // Slight pitch step per ring in a sounding burst.
  const rate = 1.0 - (index % 5) * 0.035
  if (playSample('sonar_ping.ogg', { volume: 0.55, rate: rate * (0.98 + Math.random() * 0.04) })) {
    return
  }
  playSonarPingSynth(index)
}

/** Synth fallback — knife-edge sine with underwater bandpass + echo. */
function playSonarPingSynth(index = 0) {
  const audio = getContext()
  const freq = 880 - (index % 5) * 45
  const start = audio.currentTime
  const duration = 2.4

  const master = audio.createGain()
  master.gain.setValueAtTime(1, start)
  master.connect(getMasterDestination())

  const band = audio.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.setValueAtTime(freq, start)
  band.Q.setValueAtTime(2.2, start)

  const low = audio.createBiquadFilter()
  low.type = 'lowshelf'
  low.frequency.setValueAtTime(400, start)
  low.gain.setValueAtTime(2.5, start)

  const dryGain = audio.createGain()
  dryGain.gain.setValueAtTime(0.0001, start)
  dryGain.gain.exponentialRampToValueAtTime(0.22, start + 0.008)
  dryGain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  const osc = audio.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, start)
  osc.frequency.exponentialRampToValueAtTime(freq * 0.92, start + duration)

  const harm = audio.createOscillator()
  harm.type = 'sine'
  harm.frequency.setValueAtTime(freq * 2, start)
  harm.frequency.exponentialRampToValueAtTime(freq * 2 * 0.92, start + duration)
  const harmGain = audio.createGain()
  harmGain.gain.setValueAtTime(0.0001, start)
  harmGain.gain.exponentialRampToValueAtTime(0.035, start + 0.01)
  harmGain.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.55)

  osc.connect(dryGain)
  harm.connect(harmGain)
  dryGain.connect(low)
  harmGain.connect(low)
  low.connect(band)
  band.connect(master)

  const delay = audio.createDelay(2.5)
  delay.delayTime.setValueAtTime(0.95 + (index % 3) * 0.08, start)
  const echoFilter = audio.createBiquadFilter()
  echoFilter.type = 'lowpass'
  echoFilter.frequency.setValueAtTime(freq * 0.85, start)
  const echoGain = audio.createGain()
  echoGain.gain.setValueAtTime(0.0001, start)
  echoGain.gain.exponentialRampToValueAtTime(0.09, start + 0.95)
  echoGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.95 + duration * 0.85)
  band.connect(delay)
  delay.connect(echoFilter)
  echoFilter.connect(echoGain)
  echoGain.connect(master)

  const delay2 = audio.createDelay(3)
  delay2.delayTime.setValueAtTime(1.7, start)
  const echo2Gain = audio.createGain()
  echo2Gain.gain.setValueAtTime(0.0001, start)
  echo2Gain.gain.exponentialRampToValueAtTime(0.04, start + 1.7)
  echo2Gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.7 + duration * 0.6)
  band.connect(delay2)
  delay2.connect(echo2Gain)
  echo2Gain.connect(master)

  osc.start(start)
  harm.start(start)
  osc.stop(start + duration + 0.05)
  harm.stop(start + duration + 0.05)
}

/** Whatever came back. Soft contact ping. */
export function playSonarReturn() {
  ensureSfx()
  if (playSample('sonar_return.ogg', { volume: 0.42, rate: 1.05 + Math.random() * 0.08 })) {
    return
  }
  // Synth fallback — soft double tone.
  const audio = getContext()
  const start = audio.currentTime
  for (const [delay, freq, peak] of [
    [0, 720, 0.12],
    [0.14, 960, 0.1]
  ]) {
    const osc = audio.createOscillator()
    const g = audio.createGain()
    const bp = audio.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = 3
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, start + delay)
    g.gain.setValueAtTime(0.0001, start + delay)
    g.gain.exponentialRampToValueAtTime(peak, start + delay + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.55)
    osc.connect(g).connect(bp).connect(getMasterDestination())
    osc.start(start + delay)
    osc.stop(start + delay + 0.6)
  }
}

let probeScanOsc = null
let probeScanGain = null
let probeScanLFO = null
let probeScanPing = null

// Sounding pings are driven by main.js (one per ring). This only clears any
// leftover schedule if a previous version left a timer running.
export function setProbeScanActive(active) {
  if (!active && probeScanPing) {
    clearTimeout(probeScanPing)
    probeScanPing = null
  }
}

export function playMiningPing() {
  tone({ type: 'triangle', freq: 900, freqEnd: 1400, duration: 0.12, peak: 0.14 })
}

/**
 * Asteroid rock destroyed — slow deep rumble + ice/stone fracture
 * (distinct from ship combat explosions).
 */
export function playRockExplosion() {
  ensureSfx()
  // Ice-like crystalline cracks (brittle high shards, staggered).
  noiseBurst({ duration: 0.08, filterFreq: 5200, peak: 0.38, drive: 1.6 })
  noiseBurst({ duration: 0.12, filterFreq: 3800, peak: 0.32, drive: 2, delay: 0.05 })
  noiseBurst({ duration: 0.16, filterFreq: 2400, peak: 0.28, drive: 2.2, delay: 0.12 })
  tone({ type: 'triangle', freq: 2400, freqEnd: 400, duration: 0.22, peak: 0.14, delay: 0.02 })
  tone({ type: 'sine', freq: 1800, freqEnd: 220, duration: 0.28, peak: 0.1, delay: 0.08 })
  tone({ type: 'triangle', freq: 1100, freqEnd: 180, duration: 0.35, peak: 0.12, delay: 0.16 })
  // Stone fracture mid-layer (slower than before).
  noiseBurst({ duration: 0.35, filterFreq: 1100, peak: 0.4, drive: 2.6, delay: 0.06 })
  noiseBurst({ duration: 0.55, filterFreq: 700, peak: 0.32, drive: 2.4, delay: 0.18 })
  // Deep rolling body — dragged out.
  noiseBurst({ duration: 1.85, filterFreq: 220, peak: 0.78, drive: 4, delay: 0.04 })
  noiseBurst({ duration: 2.2, filterFreq: 100, peak: 0.62, drive: 3.5, delay: 0.12 })
  // Sub thump + long grit tail.
  tone({ type: 'sine', freq: 42, freqEnd: 14, duration: 1.9, peak: 0.62 })
  tone({ type: 'square', freq: 28, freqEnd: 12, duration: 1.5, peak: 0.32, delay: 0.05 })
  tone({ type: 'triangle', freq: 70, freqEnd: 22, duration: 1.1, peak: 0.2, delay: 0.1 })
  // Secondary gravel / ice scatter after the main boom.
  noiseBurst({ duration: 0.9, filterFreq: 1400, peak: 0.2, drive: 1.6, delay: 0.35 })
  noiseBurst({ duration: 1.1, filterFreq: 600, peak: 0.18, drive: 1.4, delay: 0.55 })
}

// Speech-synthesized voice callouts ("Hyperdrive engaged", "Supercruise
// disengaged", etc.) — gracefully a no-op wherever the Web Speech API isn't
// available, rather than throwing, since this is a nice-to-have layered on
// top of the existing synthesized SFX above, not a required system.
//
// OS TTS cannot be routed into the Web Audio graph, so robot/reverb character
// is: (1) pitch/rate tuned for a cooler female synth voice, plus (2) a wet
// multi-tap bloom and soft formant pad under the phrase (not a true wet
// process of the voice itself).
let femaleVoice = null
/** Active robot-bed nodes so a new announce can cut the previous pad cleanly. */
let announceBedNodes = null

function refreshFemaleVoice() {
  if (!window.speechSynthesis) return
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return
  const en = voices.filter((v) => /^en\b/i.test(v.lang))
  const pool = en.length ? en : voices
  // Prefer clearer female system voices; compact/neural often read more "synth".
  const prefer =
    /samantha|victoria|karen|moira|tessa|fiona|veena|zira|hazel|susan|linda|heather|serena|catherine|google us english female|microsoft zira|female|woman|siri|allison|ava|nicky|salli|joanna|ivy|kimberly/i
  const avoidMale = /david|mark|daniel|alex|fred|jorge|male|\bman\b|guy|tom|bruce|rishi|aaron|james|brian|guy/i
  femaleVoice =
    pool.find((v) => prefer.test(v.name)) ??
    pool.find((v) => !avoidMale.test(v.name)) ??
    pool[0]
}

if (typeof window !== 'undefined' && window.speechSynthesis) {
  refreshFemaleVoice()
  window.speechSynthesis.addEventListener('voiceschanged', refreshFemaleVoice)
}

function stopAnnounceBed() {
  if (!announceBedNodes) return
  const audio = getContext()
  const now = audio.currentTime
  try {
    if (announceBedNodes.gain) {
      announceBedNodes.gain.gain.cancelScheduledValues(now)
      announceBedNodes.gain.gain.setValueAtTime(Math.max(0.0001, announceBedNodes.gain.gain.value), now)
      announceBedNodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12)
    }
    for (const n of announceBedNodes.stops ?? []) {
      try {
        n.stop(now + 0.15)
      } catch {
        /* already stopped */
      }
    }
  } catch {
    /* */
  }
  announceBedNodes = null
}

/**
 * Wet multi-tap bloom + soft formant pad under TTS — female ship-computer vibe.
 * Feed-forward delays only (no feedback loops that can self-oscillate).
 */
function playAnnounceRobotBed(durationS = 1.65) {
  stopAnnounceBed()
  const audio = getContext()
  const now = audio.currentTime
  const stops = []

  // Burst of filtered noise → multi-tap delays (fake early reflections / reverb).
  const length = Math.ceil(audio.sampleRate * 0.06)
  const buffer = audio.createBuffer(1, length, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length)

  const src = audio.createBufferSource()
  src.buffer = buffer
  stops.push(src)

  const band = audio.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = 1450
  band.Q.value = 0.85

  const bloom = audio.createGain()
  bloom.gain.setValueAtTime(0.0001, now)
  bloom.gain.exponentialRampToValueAtTime(0.055, now + 0.04)
  bloom.gain.exponentialRampToValueAtTime(0.0001, now + Math.min(durationS, 1.1))

  src.connect(band)
  // Longer feed-forward taps for a roomier, slightly synthetic trail.
  for (const [delayS, g] of [
    [0.04, 0.42],
    [0.09, 0.34],
    [0.15, 0.26],
    [0.24, 0.18],
    [0.36, 0.12]
  ]) {
    const delay = audio.createDelay(1)
    delay.delayTime.value = delayS
    const lp = audio.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200 - delayS * 1800
    const tap = audio.createGain()
    tap.gain.value = g
    band.connect(delay)
    delay.connect(lp)
    lp.connect(tap)
    tap.connect(bloom)
  }
  bloom.connect(getMasterDestination())
  src.start(now)
  src.stop(now + 0.09)

  // Soft formant pad (vocoder-ish) under the phrase — triangle + sine stack.
  const padGain = audio.createGain()
  padGain.gain.setValueAtTime(0.0001, now)
  padGain.gain.exponentialRampToValueAtTime(0.028, now + 0.08)
  padGain.gain.setValueAtTime(0.028, now + durationS * 0.55)
  padGain.gain.exponentialRampToValueAtTime(0.0001, now + durationS)

  const formants = [
    { f: 520, type: 'sine', g: 0.45 },
    { f: 920, type: 'triangle', g: 0.32 },
    { f: 1480, type: 'sine', g: 0.22 },
    { f: 2100, type: 'triangle', g: 0.12 }
  ]
  for (const { f, type, g } of formants) {
    const osc = audio.createOscillator()
    osc.type = type
    osc.frequency.value = f
    // Slow detune wobble → less pure tone, more "synth voice" bed.
    const lfo = audio.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.7 + f * 0.0004
    const lfoG = audio.createGain()
    lfoG.gain.value = 4 + f * 0.004
    lfo.connect(lfoG)
    lfoG.connect(osc.frequency)
    lfo.start(now)
    lfo.stop(now + durationS + 0.05)
    stops.push(lfo)

    const og = audio.createGain()
    og.gain.value = g
    const hp = audio.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 180
    osc.connect(og)
    og.connect(hp)
    hp.connect(padGain)
    osc.start(now)
    osc.stop(now + durationS + 0.05)
    stops.push(osc)
  }

  // Thin metallic shimmer (very low level) — robot chassis ring.
  const shimmer = audio.createOscillator()
  shimmer.type = 'sawtooth'
  shimmer.frequency.value = 3100
  const shG = audio.createGain()
  shG.gain.setValueAtTime(0.0001, now)
  shG.gain.exponentialRampToValueAtTime(0.008, now + 0.05)
  shG.gain.exponentialRampToValueAtTime(0.0001, now + durationS * 0.7)
  const shBp = audio.createBiquadFilter()
  shBp.type = 'bandpass'
  shBp.frequency.value = 3400
  shBp.Q.value = 6
  shimmer.connect(shBp)
  shBp.connect(shG)
  shG.connect(padGain)
  shimmer.start(now)
  shimmer.stop(now + durationS)
  stops.push(shimmer)

  padGain.connect(getMasterDestination())
  announceBedNodes = { gain: padGain, stops }
}

export function announce(text) {
  if (!sfxEnabled || !window.speechSynthesis) return
  window.speechSynthesis.cancel() // don't queue up stale callouts behind a new one
  if (!femaleVoice) refreshFemaleVoice()

  // Estimate phrase length so the robot bed covers the utterance.
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length
  const bedS = Math.min(2.4, Math.max(1.35, 0.85 + words * 0.28))
  playAnnounceRobotBed(bedS)

  const utterance = new SpeechSynthesisUtterance(text)
  if (femaleVoice) utterance.voice = femaleVoice
  // Cooler, flatter ship computer — lower pitch (was 1.32; default TTS is 1.0).
  utterance.rate = 0.78
  utterance.pitch = 0.88
  utterance.volume = 0.8
  window.speechSynthesis.speak(utterance)
}

/**
 * Main engine — a salvaged marine diesel, not a thruster.
 *
 * Synthesised rather than sampled because the character that makes a diesel a
 * diesel is the *chug*: the amplitude pulsing at the cylinder firing rate. A
 * looped sample locks that rate to one engine speed, and then opening the
 * throttle just makes the same loop louder. Driving an LFO from the throttle
 * gives revs that actually rise and fall.
 *
 * Four layers:
 *   - `block`  low sawtooth, the fundamental of the firing order
 *   - `growl`  an octave up through a filter that opens under load
 *   - `stack`  filtered noise: exhaust out of the stack, turbo when pushed
 *   - `chug`   an LFO at the firing rate gating all of the above
 */
let engine = null
/** Where the mode/revs sit, so a re-arm after a context resume matches. */
let thrustMode = null
let engineRevs = 0

/** Cylinder firing rate, Hz, at idle and at full ahead. */
const DIESEL_IDLE_HZ = 22
const DIESEL_MAX_HZ = 58

function stopThrustAudio(fadeOut = 0.35) {
  if (!engine) return
  const audio = getContext()
  const now = audio.currentTime
  const fade = Math.max(0.05, fadeOut)
  engine.gain.gain.cancelScheduledValues(now)
  engine.gain.gain.setValueAtTime(Math.max(engine.gain.gain.value, 0.0001), now)
  engine.gain.gain.linearRampToValueAtTime(0.0001, now + fade)
  for (const node of engine.sources) {
    try { node.stop(now + fade + 0.05) } catch { /* already stopped */ }
  }
  engine = null
}

function startEngine() {
  const audio = getContext()
  const now = audio.currentTime
  const gain = audio.createGain()
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(0.16, now + 0.6)
  gain.connect(getMasterDestination())

  // The chug: a slow triangle whose depth is most of the signal. This is the
  // whole trick — without it the layers below are just a synth pad.
  const chugDepth = audio.createGain()
  chugDepth.gain.value = 0.55
  const chug = audio.createOscillator()
  chug.type = 'triangle'
  chug.frequency.value = DIESEL_IDLE_HZ
  const chugGain = audio.createGain()
  chugGain.gain.value = 0.45 // the floor the chug modulates around
  chug.connect(chugDepth).connect(chugGain.gain)
  chugGain.connect(gain)

  const block = audio.createOscillator()
  block.type = 'sawtooth'
  block.frequency.value = DIESEL_IDLE_HZ
  const blockFilter = audio.createBiquadFilter()
  blockFilter.type = 'lowpass'
  blockFilter.frequency.value = 240
  const blockGain = audio.createGain()
  blockGain.gain.value = 0.85
  block.connect(blockFilter).connect(blockGain).connect(chugGain)

  const growl = audio.createOscillator()
  growl.type = 'square'
  growl.frequency.value = DIESEL_IDLE_HZ * 2
  const growlFilter = audio.createBiquadFilter()
  growlFilter.type = 'lowpass'
  growlFilter.frequency.value = 420
  growlFilter.Q.value = 3
  const growlGain = audio.createGain()
  growlGain.gain.value = 0.25
  growl.connect(growlFilter).connect(growlGain).connect(chugGain)

  // Exhaust: looping noise, band-limited, level rising with load.
  const noiseBuf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate)
  const data = noiseBuf.getChannelData(0)
  let brown = 0
  for (let i = 0; i < data.length; i++) {
    // Brown-ish rather than white — an exhaust stack is all low end.
    brown = (brown + (Math.random() * 2 - 1) * 0.06) * 0.985
    data[i] = brown * 3
  }
  const stack = audio.createBufferSource()
  stack.buffer = noiseBuf
  stack.loop = true
  const stackFilter = audio.createBiquadFilter()
  stackFilter.type = 'lowpass'
  stackFilter.frequency.value = 700
  const stackGain = audio.createGain()
  stackGain.gain.value = 0.17
  stack.connect(stackFilter).connect(stackGain).connect(chugGain)

  for (const node of [chug, block, growl, stack]) node.start(now)
  engine = {
    gain,
    sources: [chug, block, growl, stack],
    chug,
    block,
    growl,
    blockFilter,
    growlFilter,
    stackGain,
    stackFilter
  }
  applyEngineRevs()
}

/** Push the current rev fraction into the running engine's nodes. */
function applyEngineRevs() {
  if (!engine) return
  const audio = getContext()
  const now = audio.currentTime
  // Ramp rather than set: a diesel has a flywheel, it does not step.
  const at = (param, value) => {
    param.cancelScheduledValues(now)
    param.setTargetAtTime(value, now, 0.25)
  }
  const rev = Math.min(1, Math.max(0, engineRevs))
  const hz = DIESEL_IDLE_HZ + (DIESEL_MAX_HZ - DIESEL_IDLE_HZ) * rev
  at(engine.chug.frequency, hz)
  at(engine.block.frequency, hz)
  at(engine.growl.frequency, hz * 2)
  // Under load the note opens up and the stack gets loud — that is "working".
  at(engine.blockFilter.frequency, 240 + 460 * rev)
  at(engine.growlFilter.frequency, 420 + 900 * rev)
  at(engine.stackFilter.frequency, 700 + 1500 * rev)
  at(engine.stackGain.gain, 0.17 + 0.36 * rev)
  // Master diesel level — kept a touch under the old mix so sea + guns read.
  at(engine.gain.gain, 0.11 + 0.14 * rev)
}

/**
 * Engine state.
 *
 * @param {'accel'|'brake'|'idle'|null} mode  null shuts the engine down
 *   entirely (docked, dead, paused). Anything else keeps it turning over —
 *   a diesel does not stop because you eased the throttle.
 */
/**
 * Shut down thrusters / mining beam with a fade.
 * Used on death so the diesel doesn't keep chugging under the death music.
 * @param {number} [fadeOut=1.0] seconds for engine gain to drop
 */
export function fadeShipAudio(fadeOut = 1.0) {
  ensureSfx()
  thrustMode = null
  engineRevs = 0
  stopThrustAudio(fadeOut)
  setStrafeActive(false)
  setMiningBeamActive(false)
  // Leave sea lapping under the death orbit — only the boat systems die.
}

export function setThrustState(mode) {
  ensureSfx()
  if (mode === thrustMode) return
  thrustMode = mode
  if (!mode) {
    stopThrustAudio()
    engineRevs = 0
    return
  }
  if (!engine) startEngine()
  // Fallback revs for callers that only know the three old states. Anything
  // driving the throttle properly calls setEngineRevs every frame after this.
  if (mode === 'accel') engineRevs = 0.85
  else if (mode === 'brake') engineRevs = 0.4
  else engineRevs = 0
  applyEngineRevs()
}

/**
 * Continuous revs, 0 (idle) to 1 (full ahead). Called every frame from the
 * flight loop so the note tracks the actual throttle instead of snapping
 * between three fixed settings.
 */
export function setEngineRevs(fraction) {
  const next = Math.min(1, Math.max(0, fraction))
  // Web Audio params are not free to reschedule at 60 Hz.
  if (Math.abs(next - engineRevs) < 0.02) return
  engineRevs = next
  applyEngineRevs()
}

let miningBeamOsc = null
let miningBeamGain = null
let miningBeamLFO = null

// Continuous warbling hum for the mining beam — not a one-shot weapon sample.
export function setMiningBeamActive(active) {
  const audio = getContext()
  if (active && !miningBeamOsc) {
    miningBeamOsc = audio.createOscillator()
    miningBeamGain = audio.createGain()
    miningBeamOsc.type = 'triangle'
    miningBeamOsc.frequency.value = 340
    miningBeamGain.gain.setValueAtTime(0, audio.currentTime)
    miningBeamGain.gain.linearRampToValueAtTime(0.08, audio.currentTime + 0.15)

    miningBeamLFO = audio.createOscillator()
    miningBeamLFO.type = 'sine'
    miningBeamLFO.frequency.value = 7
    const lfoGain = audio.createGain()
    lfoGain.gain.value = 15
    miningBeamLFO.connect(lfoGain).connect(miningBeamOsc.frequency)
    miningBeamLFO.start()

    miningBeamOsc.connect(miningBeamGain).connect(getMasterDestination())
    miningBeamOsc.start()
  } else if (!active && miningBeamOsc) {
    miningBeamGain.gain.linearRampToValueAtTime(0, audio.currentTime + 0.1)
    miningBeamOsc.stop(audio.currentTime + 0.15)
    miningBeamLFO.stop(audio.currentTime + 0.15)
    miningBeamOsc = null
    miningBeamGain = null
    miningBeamLFO = null
  }
}

// File-based music (title/death/ambient) — plain <audio> elements rather than
// decoding through the Web Audio graph above, since these are long streamed
// tracks (not short synthesized one-shots) and the browser already handles
// looping/streaming/volume for free.
let titleMusic = null
let deathMusic = null
let ambientMusic = null
// Persists across sessions (not reset per game) so replaying "New Game"
// continues cycling forward through the playlist rather than always
// restarting at the first track.
let ambientTrackIndex = 0

const AMBIENT_TRACKS = [
  'soundscape.mp3',
  'soundscape_1.mp3', 'soundscape_2.mp3', 'soundscape_3.mp3', 'soundscape_4.mp3',
  'soundscape_5.mp3', 'soundscape_6.mp3', 'soundscape_7.mp3', 'soundscape_8.mp3',
  'soundscape_9.mp3'
]
const TITLE_VOLUME = 0.5
const DEATH_VOLUME = 0.55
const AMBIENT_VOLUME = 0.15 // deliberately quiet — background gameplay music, not foreground

// A relative path (not "/audio/...") — the packaged app loads index.html via
// `file://`, where a root-absolute path resolves against the filesystem root
// instead of the app's own out/renderer directory, silently failing to find
// any track. A relative path resolves against the document's own location in
// both the dev server (served at "/") and the packaged file:// build alike.
function playFile(name, { loop = false, volume = 0.5 } = {}) {
  const el = new Audio(`audio/${name}`)
  el.loop = loop
  el._drownedBaseVolume = volume
  el.volume = volume * musicVolume
  el.muted = !musicEnabled || musicVolume <= 0
  el.play().catch(() => {}) // blocked without a user gesture; the existing
  // click/keydown listeners above already resume the Web Audio context on
  // first interaction, and the menu/game is always reached via a click.
  return el
}

// Title <-> ambient <-> death all crossfade rather than cut. Title/death/
// ambient are mutually exclusive (every entry point clears the others first),
// so "crossfade" here means: detach whichever track is currently playing and
// let it fade itself out and pause in the background, while the new track
// fades in from silence — both ramps run concurrently since nothing awaits
// the old one before starting the new one.
const MUSIC_FADE_S = 0.5

// In-flight volume ramps, keyed by element — so a second fade issued against
// the same element (e.g. a fast double quit-to-title) cancels the first
// rather than the two rAF loops fighting over .volume every frame.
const musicFades = new WeakMap()

function fadeMusicVolume(el, to, seconds, onComplete) {
  if (!el) {
    onComplete?.()
    return
  }
  const prevFrame = musicFades.get(el)
  if (prevFrame != null) cancelAnimationFrame(prevFrame)
  const from = el.volume
  const start = performance.now()
  const durMs = Math.max(1, seconds * 1000)
  function step(now) {
    // Clamp BOTH ends. `now` is the rAF timestamp, not a fresh performance.now()
    // call, and after the main thread has been busy for a while (scene/shader
    // setup during startSession() routinely blocks for seconds) Chromium can
    // dispatch a callback's first frame with a timestamp that predates the
    // `start` captured just above — `now < start`, negative elapsed time. That
    // produced an out-of-range `el.volume` write, which THROWS (IndexSizeError)
    // and kills this step() permanently — the fade never reschedules itself and
    // freezes forever at whatever volume it had. That is what surfaced as
    // "ambient never starts" / "title just keeps playing": whichever fade's
    // first frame landed on a stale timestamp silently died mid-transition.
    const t = Math.max(0, Math.min(1, (now - start) / durMs))
    el.volume = Math.max(0, Math.min(1, from + (to - from) * t))
    if (t < 1) {
      musicFades.set(el, requestAnimationFrame(step))
    } else {
      musicFades.delete(el)
      onComplete?.()
    }
  }
  musicFades.set(el, requestAnimationFrame(step))
}

/**
 * Detach + fade out whichever of title/death/ambient is currently playing.
 * Clears the module-level ref immediately (so callers' "is X playing" checks
 * are accurate right away) while the actual <audio> element keeps sounding
 * out its fade in the background, then pauses itself when silent.
 */
function fadeOutCurrentMusic(seconds = MUSIC_FADE_S) {
  if (titleMusic) {
    const el = titleMusic
    titleMusic = null
    fadeMusicVolume(el, 0, seconds, () => el.pause())
  }
  if (deathMusic) {
    const el = deathMusic
    deathMusic = null
    fadeMusicVolume(el, 0, seconds, () => el.pause())
  }
  if (ambientMusic) {
    const el = ambientMusic
    el.onended = null // break the playlist chain — this track is on its way out
    ambientMusic = null
    fadeMusicVolume(el, 0, seconds, () => el.pause())
  }
}

export function playTitleMusic() {
  fadeOutCurrentMusic()
  titleMusic = playFile('intro.mp3', { loop: true, volume: TITLE_VOLUME })
  titleMusic.volume = 0
  fadeMusicVolume(titleMusic, TITLE_VOLUME * musicVolume, MUSIC_FADE_S)
}

export function stopTitleMusic() {
  if (!titleMusic) return
  const el = titleMusic
  titleMusic = null
  fadeMusicVolume(el, 0, MUSIC_FADE_S, () => el.pause())
}

export function playDeathMusic() {
  fadeOutCurrentMusic()
  deathMusic = playFile('ded.mp3', { loop: true, volume: DEATH_VOLUME })
  deathMusic.volume = 0
  fadeMusicVolume(deathMusic, DEATH_VOLUME * musicVolume, MUSIC_FADE_S)
}

// fadeIn only applies to the FIRST track of a session (the title -> ambient
// entry); automatic hops between ambient tracks stay a plain cut — the user
// asked for a fade on session entry/exit and death, not on the playlist's own
// internal track changes.
function playNextAmbientTrack(fadeIn = false) {
  const track = AMBIENT_TRACKS[ambientTrackIndex % AMBIENT_TRACKS.length]
  ambientTrackIndex++
  ambientMusic = playFile(track, { loop: false, volume: AMBIENT_VOLUME })
  ambientMusic.onended = () => playNextAmbientTrack(false)
  if (fadeIn) {
    ambientMusic.volume = 0
    fadeMusicVolume(ambientMusic, AMBIENT_VOLUME * musicVolume, MUSIC_FADE_S)
  }
}

export function startAmbientMusic() {
  if (ambientMusic) return
  fadeOutCurrentMusic()
  // Random entry point, then advance in list order so sessions don't always
  // open on the first track — still a continuous cycle after the first pick.
  ambientTrackIndex = Math.floor(Math.random() * AMBIENT_TRACKS.length)
  playNextAmbientTrack(true)
}

export function stopAmbientMusic() {
  if (!ambientMusic) return
  const el = ambientMusic
  el.onended = null
  ambientMusic = null
  fadeMusicVolume(el, 0, MUSIC_FADE_S, () => el.pause())
}
