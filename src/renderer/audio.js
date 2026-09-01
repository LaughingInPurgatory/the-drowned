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
let drySfxGain = null
let seaBusGain = null
/** Shared glue compressor + makeup — refined under combat density. */
let masterComp = null
let masterMakeup = null
/** Dark hull reverb send gain (one-shots punch into space). */
let reverbSendGain = null
/** Optional bright slap send for close weapon cracks only. */
let slapSendGain = null
/** Weather-driven music duck amount 0..1 (rain/storm). */
let weatherMusicDuck = 0
/** Target for weatherMusicDuck ramps (applied each rain/thunder update). */
let weatherMusicDuckTarget = 0

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
// `brightness` (0..1) keeps a little early high end for crackle before the dark tail.
function makeImpulseResponse(audio, seconds, decay, brightness = 0.15) {
  const len = Math.max(1, Math.floor(audio.sampleRate * seconds))
  const buf = audio.createBuffer(2, len, audio.sampleRate)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) {
      const t = i / len
      // Early reflections a touch brighter / denser, then pure dark decay.
      const env = Math.pow(1 - t, decay)
      const early = t < 0.08 ? 1 + brightness * (1 - t / 0.08) : 1
      // Stereo decorrelation so the tail feels like open water, not mono dust.
      const decor = ch === 0 ? 1 : (i % 3 === 0 ? -0.85 : 0.92)
      d[i] = (Math.random() * 2 - 1) * env * early * decor
    }
  }
  return buf
}

/**
 * Shared output so SFX mute can zero the whole Web Audio graph at once.
 *
 * Master bus is masterGain → [dry + dark reverb + slap send] → compressor → out.
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

    // Glue compressor: tighter threshold so missile volleys + diesel + sea
    // sum into a controlled punch instead of a hard clip, with a soft knee
    // so quiet ambience is barely touched.
    masterComp = audio.createDynamicsCompressor()
    masterComp.threshold.value = -18
    masterComp.knee.value = 18
    masterComp.ratio.value = 6
    masterComp.attack.value = 0.003
    masterComp.release.value = 0.28
    // Makeup for what the compressor takes off — slightly hotter but safe.
    masterMakeup = audio.createGain()
    masterMakeup.gain.value = 1.52
    // Soft ceiling so stacked one-shots never hard-clip the DAC.
    const ceiling = audio.createDynamicsCompressor()
    ceiling.threshold.value = -3
    ceiling.knee.value = 4
    ceiling.ratio.value = 12
    ceiling.attack.value = 0.001
    ceiling.release.value = 0.08
    masterComp.connect(masterMakeup).connect(ceiling).connect(audio.destination)

    masterGain.connect(masterComp) // dry

    // Wet send: lowpassed so the tail is a distant rumble over water.
    reverbSendGain = audio.createGain()
    reverbSendGain.gain.value = 0.22
    const tone = audio.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 1850
    const verb = audio.createConvolver()
    verb.buffer = makeImpulseResponse(audio, 2.9, 3.1, 0.18)
    masterGain.connect(reverbSendGain).connect(tone).connect(verb).connect(masterComp)

    // Short bright slap for close cracks (guns / near thunder) — pre-delay-ish
    // presence without washing out the low end of the main verb.
    slapSendGain = audio.createGain()
    slapSendGain.gain.value = 0.08
    const slapHp = audio.createBiquadFilter()
    slapHp.type = 'highpass'
    slapHp.frequency.value = 900
    const slapVerb = audio.createConvolver()
    slapVerb.buffer = makeImpulseResponse(audio, 0.55, 4.2, 0.45)
    masterGain.connect(slapSendGain).connect(slapHp).connect(slapVerb).connect(masterComp)

    sfxBusGain.connect(masterGain)
    seaBusGain.connect(masterGain)
    // Close animal vocals skip the sea-hall send so cries stay dry.
    drySfxGain = audio.createGain()
    drySfxGain.gain.value = sfxVolume
    drySfxGain.connect(masterComp)
  }
  return sfxBusGain
}

function getDrySfxDestination() {
  getMasterDestination()
  return drySfxGain ?? sfxBusGain
}

function getSeaDestination() {
  getMasterDestination()
  return seaBusGain
}

/**
 * Effective music volume multiplier under weather (rain ducks the bed slightly
 * so storm layers and thunder read — CoD-style ambient duck, not a hard mute).
 */
function musicWeatherMul() {
  return 1 - weatherMusicDuck * 0.38
}

function applyWeatherMusicDuck(target, rampS = 1.2) {
  weatherMusicDuckTarget = Math.min(1, Math.max(0, target))
  if (Math.abs(weatherMusicDuckTarget - weatherMusicDuck) < 0.02) return
  weatherMusicDuck = weatherMusicDuckTarget
  const mul = musicWeatherMul()
  for (const el of [titleMusic, deathMusic, ambientMusic]) {
    if (!el) continue
    const base = el._drownedBaseVolume ?? el.volume
    fadeMusicVolume(el, base * musicVolume * mul, rampS)
  }
}

function applyMusicMute() {
  const muted = !musicEnabled || musicVolume <= 0
  if (titleMusic) titleMusic.muted = muted
  if (deathMusic) deathMusic.muted = muted
  if (ambientMusic) ambientMusic.muted = muted
}

function applySeaVolume() {
  if (seaBusGain) seaBusGain.gain.value = seaVolume
  if (seaAmbient) applySeaLayerGains(0.12)
}

function applySfxMute() {
  if (sfxBusGain) sfxBusGain.gain.value = sfxVolume
  if (drySfxGain) drySfxGain.gain.value = sfxVolume
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
  const mul = musicWeatherMul()
  for (const el of [titleMusic, deathMusic, ambientMusic]) {
    if (!el) continue
    const base = el._drownedBaseVolume ?? el.volume
    fadeMusicVolume(el, base * musicVolume * mul, 0.08)
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
const THUNDER_FILES = [
  'thunder/thunder_clap.wav',
  'thunder/thunder_roll_1.ogg', 'thunder/thunder_roll_2.ogg', 'thunder/thunder_roll_3.ogg'
]
const ON_FOOT_LANDING_FILES = [
  'onfoot/jump_land.wav',
  'onfoot/jump_land_2.wav',
  'onfoot/jump_land_3.wav',
  'onfoot/fall_land.wav'
]

// No thrust.ogg and no laser_*.ogg any more: nothing on this sea runs on
// reaction mass or coherent light. The engine is a synthesised diesel (see
// setThrustState) and the guns are synthesised reports (WEAPON_SYNTH).
// Dock/undock are pure synth (mechanical mooring + water) — the old Kenney
// sci-fi dock samples are gone.
const SFX_FILES = [
  'engine_engage.ogg',
  'rocket.ogg', 'missile.ogg', 'torpedo.ogg',
  // CC0 single-shot .22 pistol recording; used by the handheld Fixo only.
  'fixo_pistol.wav',
  // Short CC0 metallic impact; see public/audio/sfx/SHIP_COLLISION_CREDITS.txt
  'ship_collision_clank.mp3',
  // CC0 OpenGameArt field recording; see public/audio/sfx/SEAGULL_CREDITS.txt
  'seagull_ambient_1.wav',
  // Sounding (P) — CC0 Freesound samples; see public/audio/sfx/SONAR_CREDITS.txt
  'sonar_ping.ogg', 'sonar_return.ogg',
  ...THUNDER_FILES,
  ...ON_FOOT_LANDING_FILES,
  'wildlife/dog_bark.mp3',
  'wildlife/dog_bark_angry.mp3',
  'wildlife/dog_whimper.mp3',
  'wildlife/cat_cry.mp3',
  'wildlife/cat_yowl.mp3',
  'wildlife/pig_grunt.mp3',
  'wildlife/pig_squeal.mp3',
  'wildlife/squeak.mp3',
  'wildlife/squeak2.mp3',
  'wildlife/animal_bleat.mp3',
  'wildlife/deer_bark.mp3',
  'wildlife/boar_growl.mp3',
  'wildlife/boar_snarl.mp3',
  'wildlife/beast_growl.mp3',
  'wildlife/flesh_hit.mp3',
  'wildlife/impact_thud.mp3',
  'wildlife/flesh_chunk.mp3',
  'wildlife/flesh_wet.mp3',
  'wildlife/flesh_body.mp3',
  'wildlife/punch_hit.mp3',
  'wildlife/crunch_hit.mp3',
  'wildlife/body_hit.mp3',
  'wildlife/dog_bite.mp3',
  'wildlife/bite_crunch.mp3'
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

const sfxFileLoads = new Map()

function loadSfxFile(name) {
  if (sfxBuffers.has(name)) return Promise.resolve()
  if (sfxFileLoads.has(name)) return sfxFileLoads.get(name)
  const load = (async () => {
    try {
      const res = await fetch(`audio/sfx/${name}`)
      if (!res.ok) throw new Error(res.statusText)
      const raw = await res.arrayBuffer()
      const buf = await getContext().decodeAudioData(raw.slice(0))
      sfxBuffers.set(name, buf)
    } catch (err) {
      console.warn(`sfx load failed: ${name}`, err)
    } finally {
      sfxFileLoads.delete(name)
    }
  })()
  sfxFileLoads.set(name, load)
  return load
}

function ensureSfx() {
  if (sfxLoadPromise) return sfxLoadPromise
  sfxLoadPromise = Promise.all([...SFX_FILES, ...FOOTSTEP_FILES, ...THUNDER_FILES].map(loadSfxFile))
  return sfxLoadPromise
}

/** Begin decoding thunder before the first storm can trigger it. */
export function preloadThunderSounds() {
  return Promise.all(THUNDER_FILES.map(loadSfxFile))
}

/** Decode wildlife, weapons, footsteps and thunder on the title / session start. */
export function preloadGameSounds() {
  try {
    ensureRainBed()
  } catch {
    /* */
  }
  return ensureSfx()
}

// One-shot or looping sample. Returns { source, gain, volume } or null if not loaded.
function playSample(name, {
  volume = 0.5,
  rate = 1,
  loop = false,
  fadeIn = 0,
  delay = 0,
  duration = 0,
  offset = 0,
  lowpassHz = 0,
  lowpassQ = 0.6,
  highpassHz = 0,
  dry = false
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
  const playFor = duration > 0 && !loop ? duration : 0
  const fadeOut = playFor > 0 ? Math.min(0.07, playFor * 0.28) : 0
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(volume, now + fadeIn)
  } else {
    gain.gain.setValueAtTime(volume, now)
  }
  if (fadeOut > 0) {
    gain.gain.setValueAtTime(volume, now + playFor - fadeOut)
    gain.gain.linearRampToValueAtTime(0.0001, now + playFor)
  }
  source.connect(gain)
  const dest = dry ? getDrySfxDestination() : getMasterDestination()
  let node = gain
  const filters = []
  if (highpassHz > 0) {
    const highpass = audio.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = highpassHz
    node.connect(highpass)
    node = highpass
    filters.push(highpass)
  }
  if (lowpassHz > 0) {
    const lowpass = audio.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = lowpassHz
    lowpass.Q.value = lowpassQ
    node.connect(lowpass)
    node = lowpass
    filters.push(lowpass)
  }
  node.connect(dest)
  if (filters.length) {
    source.addEventListener('ended', () => {
      for (const filter of filters) {
        try { filter.disconnect() } catch { /* already disconnected */ }
      }
    }, { once: true })
  }
  const startOffset = Math.max(0, Math.min(Number(offset) || 0, Math.max(0, buf.duration - 0.01)))
  if (playFor > 0) source.start(now, startOffset, playFor)
  else source.start(now, startOffset)
  if (playFor > 0 && startOffset === 0) source.stop(now + playFor)
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

function wildlifeDistanceGain(distance, fullRange, silentRange) {
  const d = Math.max(0, Number(distance) || 0)
  if (d >= silentRange) return 0
  if (d <= fullRange) return 1
  return 1 - (d - fullRange) / (silentRange - fullRange)
}

/** A close wild-dog bark — the original Mixkit bark, dry, one full yap. */
export function playDogBark({ distance = 4 } = {}) {
  const gain = wildlifeDistanceGain(distance, 7, 30)
  if (gain <= 0) return false
  ensureSfx()
  if (playSample('wildlife/dog_bark.mp3', {
    volume: 0.66 * gain,
    rate: 0.96 + Math.random() * 0.08,
    duration: 0.75,
    dry: true
  })) return true
  tone({ type: 'sawtooth', freq: 270, freqEnd: 128, duration: 0.17, peak: 0.22 * gain, destination: getDrySfxDestination() })
  return true
}

export function playWildlifeThreat(species, { distance = 4 } = {}) {
  if (species === 'dog') return playDogBark({ distance })
  const gain = wildlifeDistanceGain(distance, 7, 28)
  if (gain <= 0) return false
  ensureSfx()
  const file = Math.random() < 0.55 ? 'wildlife/boar_growl.mp3' : 'wildlife/beast_growl.mp3'
  if (playSample(file, {
    volume: 0.56 * gain,
    rate: 0.78 + Math.random() * 0.12,
    offset: 0.08,
    duration: 0.85,
    dry: true
  })) return true
  tone({ type: 'sawtooth', freq: 160, freqEnd: 80, duration: 0.22, peak: 0.18 * gain, destination: getDrySfxDestination() })
  return true
}

/** Species death cry — sampled. Windows skip the silent Mixkit lead-ins. */
export function playWildlifeDeath(species, { distance = 4 } = {}) {
  const gain = wildlifeDistanceGain(distance, 8, 34)
  if (gain <= 0) return false
  ensureSfx()
  const files = {
    dog: ['wildlife/dog_whimper.mp3', 0.82, 0.98, 0, 0.9],
    cat: ['wildlife/cat_yowl.mp3', 0.7, 1.0, 0.14, 0.9],
    deer: ['wildlife/deer_bark.mp3', 0.78, 0.94, 0, 0.82],
    boar: ['wildlife/boar_snarl.mp3', 0.72, 0.84, 0.12, 0.9],
    rabbit: ['wildlife/squeak2.mp3', 0.62, 1.12, 0, 0.55],
    rat: ['wildlife/squeak2.mp3', 0.6, 1.28, 0, 0.5],
    ferret: ['wildlife/squeak.mp3', 0.6, 1.22, 0.08, 0.5],
    stoat: ['wildlife/squeak2.mp3', 0.6, 1.32, 0, 0.5]
  }
  const [file, volume, rate, offset, duration] = files[species] ?? files.rabbit
  if (playSample(file, {
    volume: volume * gain,
    rate: rate + Math.random() * 0.06,
    offset,
    duration,
    dry: true
  })) return true
  tone({ type: 'triangle', freq: 900, freqEnd: 280, duration: 0.16, peak: 0.16 * gain, destination: getDrySfxDestination() })
  return true
}

/** Dull body hit when a bullet strikes an animal or its corpse. */
export function playWildlifeFleshHit({ distance = 4 } = {}) {
  const gain = wildlifeDistanceGain(distance, 12, 40)
  if (gain <= 0) return false
  ensureSfx()
  playSample('wildlife/flesh_body.mp3', {
    volume: 0.55 * gain,
    rate: 0.9 + Math.random() * 0.08,
    dry: true
  })
  // A hint of wet, cut short so it does not read as a gore squelch.
  playSample('wildlife/flesh_wet.mp3', {
    volume: 0.16 * gain,
    rate: 0.84 + Math.random() * 0.06,
    duration: 0.07,
    lowpassHz: 700,
    dry: true
  })
  return true
}

/** Actual teeth closing — Mixkit bite, dry, no metal punch. */
export function playDogBite({ distance = 2 } = {}) {
  const gain = wildlifeDistanceGain(distance, 5, 16)
  if (gain <= 0) return false
  ensureSfx()
  playSample('wildlife/dog_bite.mp3', {
    volume: 0.7 * gain,
    rate: 0.92 + Math.random() * 0.08,
    dry: true
  })
  playSample('wildlife/bite_crunch.mp3', {
    volume: 0.28 * gain,
    rate: 0.86 + Math.random() * 0.08,
    dry: true
  })
  return true
}

/** Paw/hoof on soil — same samples as the player, audible when close. */
export function playWildlifeFootstep(species, { distance = 4, surface = 'grass' } = {}) {
  const gain = wildlifeDistanceGain(distance, 8, 18)
  if (gain <= 0) return false
  ensureSfx()
  const small = species === 'rabbit' || species === 'cat' || species === 'rat' || species === 'ferret' || species === 'stoat'
  const family = surface === 'stone' || surface === 'wood' ? 'Stone' : 'Sand'
  const side = Math.random() < 0.5 ? 'L' : 'R'
  const index = 1 + Math.floor(Math.random() * 3)
  const file = `footsteps/Fantozzi-${family}${side}${index}.ogg`
  // Same bus as player footsteps. Volume sits at or above a player walk when
  // the animal is within a few metres.
  if (playSample(file, {
    volume: (small ? 0.208 : 0.325) * gain,
    rate: (small ? 1.28 : 0.96) + Math.random() * 0.1
  })) return true
  noiseBurst({
    duration: small ? 0.04 : 0.055,
    filterFreq: small ? 1100 : 1400,
    peak: (small ? 0.091 : 0.143) * gain,
    drive: 0.6
  })
  return true
}

const FOOTSTEP_FAMILIES = {
  grass: ['SandL1', 'SandL2', 'SandL3', 'SandR1', 'SandR2', 'SandR3'],
  sand: ['SandL1', 'SandL2', 'SandL3', 'SandR1', 'SandR2', 'SandR3'],
  stone: ['StoneL1', 'StoneL2', 'StoneL3', 'StoneR1', 'StoneR2', 'StoneR3'],
  wood: ['StoneL1', 'StoneL2', 'StoneL3', 'StoneR1', 'StoneR2', 'StoneR3']
}

// Landing uses the same CC0 surface recordings as footsteps, but with a
// shorter, lower-passed contact layer. That keeps sand/grass soft and gives
// rock a crisp heel strike instead of making every surface sound like wood.
const LANDING_SURFACE_SETTINGS = {
  grass: { family: 'Sand', jumpVolume: 0.34, fallVolume: 0.42, jumpFilter: 1350, fallFilter: 1700, noiseFilter: 720 },
  sand: { family: 'Sand', jumpVolume: 0.38, fallVolume: 0.46, jumpFilter: 1050, fallFilter: 1350, noiseFilter: 560 },
  stone: { family: 'Stone', jumpVolume: 0.36, fallVolume: 0.5, jumpFilter: 2850, fallFilter: 3400, noiseFilter: 1800 }
}

function landingSurfaceSample(surface) {
  const setting = LANDING_SURFACE_SETTINGS[surface] ?? LANDING_SURFACE_SETTINGS.grass
  const side = Math.random() < 0.5 ? 'L' : 'R'
  const index = 1 + Math.floor(Math.random() * 3)
  return {
    setting,
    file: `footsteps/Fantozzi-${setting.family}${side}${index}.ogg`
  }
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

/** Terrain-aware body-impact cue for jumps and falls. */
export function playOnFootLanding({ fallDistance = 0, surface = 'grass' } = {}) {
  ensureSfx()
  const distance = Math.max(0, Number(fallDistance) || 0)
  const isFall = distance > 0.5
  const impact = Math.min(0.55, 0.16 + distance * 0.035)
  const { setting, file } = landingSurfaceSample(surface)
  const contact = playSample(file, {
    volume: (isFall ? setting.fallVolume : setting.jumpVolume) * Math.min(1.8, 1 + distance * 0.035),
    rate: isFall ? 0.88 + Math.random() * 0.16 : 0.9 + Math.random() * 0.18,
    duration: isFall ? 0.42 : 0.24,
    lowpassHz: isFall ? setting.fallFilter : setting.jumpFilter,
    lowpassQ: 0.65
  })
  // Do not layer the old generic jump sample over the terrain cue: its hard
  // transient is what made grass and sand read like a wooden floor. Falls get
  // only a restrained, low-passed body rumble; the surface contact stays first.
  const body = isFall ? playSample('onfoot/fall_land.wav', {
    volume: Math.min(0.28, 0.12 + distance * 0.01),
    rate: 0.82 + Math.random() * 0.12,
    duration: Math.min(1.25, 0.55 + distance * 0.05),
    lowpassHz: setting.family === 'Stone' ? 1850 : 950,
    lowpassQ: 0.8
  }) : null
  const synthImpact = contact || body ? 0.28 : 1
  tone({
    type: 'sine',
    freq: (setting.family === 'Stone' ? 138 : 96) - impact * 32,
    freqEnd: 54,
    duration: 0.18,
    attack: 0.004,
    peak: impact * 0.55 * synthImpact
  })
  noiseBurst({
    duration: 0.075,
    filterFreq: setting.noiseFilter,
    peak: impact * synthImpact,
    drive: setting.family === 'Stone' ? 1.45 : 0.9,
    highpassHz: 55
  })
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
function tone({
  type = 'sine',
  freq,
  freqEnd,
  duration,
  attack = 0.005,
  peak = 0.25,
  delay = 0,
  destination = null
}) {
  const audio = getContext()
  const start = audio.currentTime + delay
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(0.01, freqEnd), start + duration)
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(peak, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(destination ?? getMasterDestination())
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

/**
 * Shaped noise burst.
 * @param {'lowpass'|'bandpass'|'highpass'} [filterType]
 * @param {number} [q] filter resonance
 * @param {number} [highpassHz] optional pre-HP so tails stay dark without mud
 */
function noiseBurst({
  duration,
  filterFreq = 800,
  peak = 0.4,
  drive = 0,
  delay = 0,
  destination = null,
  filterType = 'lowpass',
  q = 0.7,
  highpassHz = 0
} = {}) {
  const audio = getContext()
  const start = audio.currentTime + delay
  const bufferSize = Math.max(1, Math.floor(audio.sampleRate * duration))
  const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate)
  const data = buffer.getChannelData(0)
  // Mild pink tilt + exponential envelope — less "static gate", more physical.
  let b0 = 0
  let b1 = 0
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.997 * b0 + white * 0.029
    b1 = 0.985 * b1 + white * 0.1
    const env = Math.pow(1 - i / bufferSize, 1.15)
    data[i] = (white * 0.35 + b0 * 0.55 + b1 * 0.45) * env
  }

  const source = audio.createBufferSource()
  source.buffer = buffer
  const filter = audio.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = filterFreq
  filter.Q.value = q
  const gain = audio.createGain()
  gain.gain.setValueAtTime(peak, start)
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration)

  let head = source
  if (highpassHz > 0) {
    const hp = audio.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = highpassHz
    source.connect(hp)
    head = hp
  }

  let tail = filter
  if (drive > 0) {
    const shaper = audio.createWaveShaper()
    shaper.curve = distortionCurve(drive)
    filter.connect(shaper)
    tail = shaper
  }
  head.connect(filter)
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
  // Handheld weapon only — ship weapons keep their existing sample/synth
  // mappings below and never use this recording.
  fixo_pistol: { file: 'fixo_pistol.wav', volume: 0.72, rate: 0.94 },
  rocket_pod: { file: 'rocket.ogg', volume: 0.7, rate: 0.62 },
  seeker_missile: { file: 'missile.ogg', volume: 0.74, rate: 0.6 },
  torpedo: { file: 'torpedo.ogg', volume: 0.84, rate: 0.58 },
  singularity_seed: { file: 'torpedo.ogg', volume: 0.88, rate: 0.5 }
}

/**
 * A gun going off: transient crack, body thump (breech + mount), mid body, and
 * a long water-borne report tail. Shared master reverb + slap send add the
 * outdoor space so each layer can stay short and punchy dry.
 *
 * @param {object} o
 * @param {number} o.crack   brightness of the muzzle blast, Hz
 * @param {number} o.body    fundamental of the thump, Hz
 * @param {number} o.punch   overall level
 * @param {number} o.tail    seconds of roll-off across the water
 */
function gunReport({ crack, body, punch = 0.4, tail = 0.35, drive = 2.4 }) {
  // Knife-edge transient — highpass so it reads as muzzle snap, not fizz.
  noiseBurst({
    duration: 0.022,
    filterFreq: crack * 1.35,
    peak: punch * 1.05,
    drive: drive * 1.15,
    filterType: 'highpass',
    q: 0.55,
    highpassHz: crack * 0.35
  })
  // Mid blast body (propellant / muzzle brake).
  noiseBurst({
    duration: 0.055,
    filterFreq: crack * 0.55,
    peak: punch * 0.72,
    drive,
    delay: 0.006,
    highpassHz: 120
  })
  // Rolling report over open water — darker, longer, pink-ish.
  noiseBurst({
    duration: tail * 1.15,
    filterFreq: crack * 0.22,
    peak: punch * 0.48,
    drive: drive * 1.25,
    delay: 0.018,
    highpassHz: 60
  })
  // Distant second bounce (hull / sea surface).
  noiseBurst({
    duration: tail * 0.85,
    filterFreq: crack * 0.14,
    peak: punch * 0.22,
    drive: drive * 0.9,
    delay: 0.09 + tail * 0.12,
    highpassHz: 40
  })
  // Sub thump — mount taking recoil into the deck.
  tone({ type: 'sine', freq: body, freqEnd: body * 0.32, duration: tail * 0.95, peak: punch * 0.95 })
  tone({ type: 'sine', freq: body * 0.55, freqEnd: body * 0.22, duration: tail * 1.1, peak: punch * 0.45, delay: 0.01 })
  // Mechanical edge of the breech.
  tone({ type: 'square', freq: body * 2.4, freqEnd: body * 0.7, duration: 0.055, peak: punch * 0.32 })
  // Soft shell-eject / linkage click so rapid fire doesn't feel like pure noise.
  if (tail < 0.2) {
    noiseBurst({
      duration: 0.018,
      filterFreq: 2800,
      peak: punch * 0.12,
      drive: 1.5,
      delay: 0.04,
      filterType: 'bandpass',
      q: 1.4
    })
  }
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
    noiseBurst({ duration: 0.04, filterFreq: 2800, peak: 0.48, drive: 2.6, filterType: 'highpass', highpassHz: 900 })
    noiseBurst({ duration: 0.08, filterFreq: 1800, peak: 0.4, drive: 2.4, delay: 0.01 })
    tone({ type: 'sine', freq: 95, freqEnd: 40, duration: 0.35, peak: 0.42 })
    tone({ type: 'sine', freq: 48, freqEnd: 22, duration: 0.45, peak: 0.22, delay: 0.02 })
    noiseBurst({ duration: 0.85, filterFreq: 1500, peak: 0.16, delay: 0.05, highpassHz: 200 })
  },
  seeker_missile: () => {
    noiseBurst({ duration: 0.045, filterFreq: 3200, peak: 0.5, drive: 2.8, filterType: 'highpass', highpassHz: 1000 })
    noiseBurst({ duration: 0.09, filterFreq: 2100, peak: 0.42, drive: 2.6, delay: 0.012 })
    tone({ type: 'sine', freq: 80, freqEnd: 34, duration: 0.42, peak: 0.48 })
    tone({ type: 'sine', freq: 42, freqEnd: 18, duration: 0.55, peak: 0.26, delay: 0.02 })
    noiseBurst({ duration: 1.05, filterFreq: 1400, peak: 0.17, delay: 0.06, highpassHz: 180 })
  },
  torpedo: () => {
    // Compressed air slamming a fish out of the tube, then it swims.
    noiseBurst({ duration: 0.08, filterFreq: 900, peak: 0.42, drive: 2.8, filterType: 'highpass', highpassHz: 200 })
    noiseBurst({ duration: 0.28, filterFreq: 420, peak: 0.52, drive: 3.4, delay: 0.02 })
    tone({ type: 'sine', freq: 38, freqEnd: 17, duration: 1.0, peak: 0.55 })
    tone({ type: 'sine', freq: 22, freqEnd: 12, duration: 1.2, peak: 0.3, delay: 0.04 })
    noiseBurst({ duration: 1.25, filterFreq: 260, peak: 0.22, delay: 0.15 })
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
  // Short bright droplet at the front, followed by the existing low glob. The
  // same helper is used by ship and Fixo rounds, so both impacts stay matched.
  noiseBurst({ duration: 0.045, filterFreq: 1650, peak: 0.1, drive: 0.9, delay: 0.012 })
  tone({ type: 'triangle', freq: 410, freqEnd: 185, duration: 0.13, peak: 0.1, delay: 0.008 })
  noiseBurst({ duration: 0.12, filterFreq: 720, peak: 0.13, drive: 1.1 })
  noiseBurst({ duration: 0.32, filterFreq: 300, peak: 0.09, drive: 1.2, delay: 0.025 })
  tone({ type: 'sine', freq: 150, freqEnd: 62, duration: 0.2, peak: 0.1 })
}

/** Heavy, low explosive impact for a missile striking a solid target. */
export function playMissileImpact() {
  ensureSfx()
  noiseBurst({
    duration: 0.05,
    filterFreq: 3600,
    peak: 0.36,
    drive: 2.2,
    filterType: 'highpass',
    highpassHz: 1000
  })
  noiseBurst({ duration: 0.12, filterFreq: 1200, peak: 0.36, drive: 2.8, delay: 0.01, highpassHz: 150 })
  tone({ type: 'triangle', freq: 92, freqEnd: 26, duration: 0.85, peak: 0.44 })
  noiseBurst({ duration: 1.2, filterFreq: 180, peak: 0.38, drive: 3.4, delay: 0.04 })
  tone({ type: 'sine', freq: 48, freqEnd: 16, duration: 1.15, peak: 0.3, delay: 0.08 })
  noiseBurst({
    duration: 0.55,
    filterFreq: 900,
    peak: 0.14,
    drive: 1.5,
    delay: 0.15,
    filterType: 'bandpass',
    q: 0.9
  })
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

// Chunkier multi-layer boom: crack → driven mid body → long low rumble + sub.
// Shared bus reverb supplies the outdoor tail so dry layers stay impactful.
export function playExplosion() {
  noiseBurst({
    duration: 0.05,
    filterFreq: 4500,
    peak: 0.38,
    drive: 1.8,
    filterType: 'highpass',
    q: 0.6,
    highpassHz: 1200
  })
  noiseBurst({ duration: 0.12, filterFreq: 1800, peak: 0.42, drive: 2.4, delay: 0.01, highpassHz: 200 })
  noiseBurst({ duration: 1.05, filterFreq: 420, peak: 0.62, drive: 3.2, delay: 0.02, highpassHz: 40 })
  noiseBurst({ duration: 1.55, filterFreq: 140, peak: 0.4, drive: 2.6, delay: 0.08 })
  tone({ type: 'sine', freq: 95, freqEnd: 24, duration: 1.15, peak: 0.52 })
  tone({ type: 'sine', freq: 52, freqEnd: 18, duration: 1.4, peak: 0.36, delay: 0.03 })
  tone({ type: 'square', freq: 48, freqEnd: 22, duration: 0.55, peak: 0.18, delay: 0.01 })
  // Debris scatter after the main shock.
  noiseBurst({
    duration: 0.45,
    filterFreq: 2200,
    peak: 0.14,
    drive: 1.4,
    delay: 0.18,
    filterType: 'bandpass',
    q: 0.8
  })
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

// ── Ambient sea bed (layered open-water wash) ───────────────────────────────
// Always-on while a session is live. Three continuous layers + irregular laps:
//   low rumble  — deep swell / hull pressure
//   mid splash  — main water body
//   high spray  — bow wake / surface hiss (rises with speed)
// Sits under diesel / combat; never loud.
let seaAmbient = null
let seaLapTimer = null
/** 0 idle … 1 full hull speed — drives spray and mid wash energy. */
let seaMotion = 0
/** Peak gain for the continuous wash master — keep low so dialogue/engines win. */
const SEA_AMBIENT_VOLUME = 0.072

/** Fill a looping buffer with brown / pink / white mix + slow breath. */
function fillSeaNoiseBuffer(audio, seconds, { brownAmt = 1, pinkAmt = 0.3, whiteAmt = 0.15, breathHz = 1.7 } = {}) {
  const n = Math.floor(audio.sampleRate * seconds)
  const buf = audio.createBuffer(1, n, audio.sampleRate)
  const data = buf.getChannelData(0)
  let brown = 0
  let b0 = 0
  let b1 = 0
  let b2 = 0
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.014 * white) / 1.014
    // Paul Kellet pink approximation.
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    const pink = b0 + b1 + b2 + white * 0.3
    const breath = 0.82 + 0.18 * Math.sin((i / audio.sampleRate) * Math.PI * 2 * breathHz + i * 0.00001)
    data[i] = (brown * 3.8 * brownAmt + pink * 0.55 * pinkAmt + white * whiteAmt) * breath
  }
  return buf
}

function scheduleSeaLap() {
  if (!seaAmbient) return
  // Soft irregular lapping — denser when moving (wake).
  const motion = seaMotion
  const wait = (1600 + Math.random() * 2800) * (1 - motion * 0.45)
  seaLapTimer = setTimeout(() => {
    seaLapTimer = null
    if (!seaAmbient || seaVolume <= 0) {
      scheduleSeaLap()
      return
    }
    const peak = (0.018 + Math.random() * 0.02) * (1 + motion * 0.55)
    noiseBurst({
      duration: 0.35 + Math.random() * 0.5,
      filterFreq: 240 + Math.random() * 320,
      peak,
      drive: 0.5 + Math.random() * 0.7,
      destination: getSeaDestination(),
      highpassHz: 60
    })
    // Occasional deeper wash under the pile.
    if (Math.random() < 0.4 + motion * 0.25) {
      noiseBurst({
        duration: 0.65 + Math.random() * 0.45,
        filterFreq: 110 + Math.random() * 90,
        peak: peak * 0.75,
        drive: 1.15,
        delay: 0.06,
        destination: getSeaDestination()
      })
    }
    // Bow slap when underway.
    if (motion > 0.35 && Math.random() < 0.45) {
      noiseBurst({
        duration: 0.12 + Math.random() * 0.1,
        filterFreq: 900 + Math.random() * 600,
        peak: peak * 0.55 * motion,
        drive: 1.6,
        delay: Math.random() * 0.2,
        destination: getSeaDestination(),
        filterType: 'bandpass',
        q: 0.9,
        highpassHz: 200
      })
    }
    scheduleSeaLap()
  }, wait)
}

function applySeaLayerGains(rampS = 0.45) {
  if (!seaAmbient) return
  const audio = getContext()
  const now = audio.currentTime
  const m = Math.min(1, Math.max(0, seaMotion))
  const master = SEA_AMBIENT_VOLUME * seaVolume
  // Low always present; mid opens with motion; spray is mostly motion.
  const low = master * (0.55 + 0.2 * m)
  const mid = master * (0.42 + 0.55 * m)
  const spray = master * (0.04 + 0.72 * m * m)
  const at = (g, v) => {
    try {
      g.gain.cancelScheduledValues(now)
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now)
      g.gain.linearRampToValueAtTime(Math.max(0.0001, v), now + rampS)
    } catch { /* */ }
  }
  at(seaAmbient.gain, master)
  at(seaAmbient.lowG, low)
  at(seaAmbient.midG, mid)
  at(seaAmbient.sprayG, spray)
}

/**
 * Quiet multi-layer open-water bed.
 * Start when a game session is active; stop on the title screen.
 */
export function startSeaAmbient() {
  ensureSfx()
  if (seaAmbient) {
    applySeaLayerGains(0.6)
    return
  }
  const audio = getContext()
  const now = audio.currentTime
  const dest = getSeaDestination()

  const lowBuf = fillSeaNoiseBuffer(audio, 7.5, { brownAmt: 1.2, pinkAmt: 0.15, whiteAmt: 0.02, breathHz: 0.55 })
  const midBuf = fillSeaNoiseBuffer(audio, 5.5, { brownAmt: 0.55, pinkAmt: 0.7, whiteAmt: 0.2, breathHz: 1.9 })
  const sprayBuf = fillSeaNoiseBuffer(audio, 3.8, { brownAmt: 0.15, pinkAmt: 0.45, whiteAmt: 0.75, breathHz: 2.8 })

  const master = audio.createGain()
  master.gain.setValueAtTime(0.0001, now)
  master.gain.linearRampToValueAtTime(SEA_AMBIENT_VOLUME * seaVolume, now + 2.8)
  master.connect(dest)

  // --- Low rumble: swell pressure under the hull ---
  const lowSrc = audio.createBufferSource()
  lowSrc.buffer = lowBuf
  lowSrc.loop = true
  const lowHp = audio.createBiquadFilter()
  lowHp.type = 'highpass'
  lowHp.frequency.value = 35
  const lowLp = audio.createBiquadFilter()
  lowLp.type = 'lowpass'
  lowLp.frequency.value = 160
  const lowG = audio.createGain()
  lowG.gain.value = 0.0001
  lowSrc.connect(lowHp).connect(lowLp).connect(lowG).connect(master)

  // --- Mid splash: main water body ---
  const midSrc = audio.createBufferSource()
  midSrc.buffer = midBuf
  midSrc.loop = true
  const midHp = audio.createBiquadFilter()
  midHp.type = 'highpass'
  midHp.frequency.value = 90
  const midBp = audio.createBiquadFilter()
  midBp.type = 'bandpass'
  midBp.frequency.value = 380
  midBp.Q.value = 0.48
  const midLp = audio.createBiquadFilter()
  midLp.type = 'lowpass'
  midLp.frequency.value = 1100
  const midG = audio.createGain()
  midG.gain.value = 0.0001
  midSrc.connect(midHp).connect(midBp).connect(midLp).connect(midG).connect(master)

  // --- High spray: surface hiss / bow wake ---
  const spraySrc = audio.createBufferSource()
  spraySrc.buffer = sprayBuf
  spraySrc.loop = true
  const sprayHp = audio.createBiquadFilter()
  sprayHp.type = 'highpass'
  sprayHp.frequency.value = 1200
  const sprayBp = audio.createBiquadFilter()
  sprayBp.type = 'bandpass'
  sprayBp.frequency.value = 3200
  sprayBp.Q.value = 0.55
  const sprayLp = audio.createBiquadFilter()
  sprayLp.type = 'lowpass'
  sprayLp.frequency.value = 7800
  const sprayG = audio.createGain()
  sprayG.gain.value = 0.0001
  spraySrc.connect(sprayHp).connect(sprayBp).connect(sprayLp).connect(sprayG).connect(master)

  lowSrc.start(now)
  midSrc.start(now + 0.03)
  spraySrc.start(now + 0.07)

  seaAmbient = {
    source: lowSrc,
    sources: [lowSrc, midSrc, spraySrc],
    gain: master,
    lowG,
    midG,
    sprayG
  }
  applySeaLayerGains(2.6)
  scheduleSeaLap()
}

/**
 * Hull speed fraction 0..1 — lifts mid wash and high spray (bow wake).
 * Safe to call every frame; only reschedules when the value moves.
 */
export function setSeaMotion(fraction) {
  const next = Math.min(1, Math.max(0, Number(fraction) || 0))
  if (Math.abs(next - seaMotion) < 0.03) return
  seaMotion = next
  if (seaAmbient) applySeaLayerGains(0.35)
}

export function stopSeaAmbient(fadeOut = 1.4) {
  if (seaLapTimer != null) {
    clearTimeout(seaLapTimer)
    seaLapTimer = null
  }
  if (!seaAmbient) return
  const nodes = seaAmbient
  seaAmbient = null
  seaMotion = 0
  const audio = getContext()
  const now = audio.currentTime
  try {
    const from = Math.max(nodes.gain.gain.value, 0.0001)
    nodes.gain.gain.cancelScheduledValues(now)
    nodes.gain.gain.setValueAtTime(from, now)
    nodes.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut)
    const stopAt = now + fadeOut + 0.05
    for (const s of nodes.sources ?? [nodes.source]) {
      try { s.stop(stopAt) } catch { /* */ }
    }
    setTimeout(() => {
      for (const s of nodes.sources ?? [nodes.source]) {
        try { s.disconnect() } catch { /* */ }
      }
      try { nodes.gain.disconnect() } catch { /* */ }
    }, (fadeOut + 0.1) * 1000)
  } catch {
    for (const s of nodes.sources ?? [nodes.source]) {
      try { s.stop() } catch { /* */ }
    }
  }
}

// --- Rain bed + distance-aware thunder --------------------------------------
// Rain is multi-layer filtered noise + sparse deck-drop impulses (not pure
// white hiss). Thunder uses distanceKm: near = crack + boom, far = rumble.

let rainBed = null
let rainLevel = 0
let rainDropTimer = null

function fillRainBuffer(audio, seconds, { dropRate = 0.005, brownMix = 1.2, whiteMix = 0.5 } = {}) {
  const n = Math.floor(audio.sampleRate * seconds)
  const buf = audio.createBuffer(1, n, audio.sampleRate)
  const data = buf.getChannelData(0)
  let brown = 0
  let b0 = 0
  let b1 = 0
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    brown = (brown + 0.018 * white) / 1.018
    b0 = 0.997 * b0 + white * 0.04
    b1 = 0.985 * b1 + white * 0.09
    // Sparse “fat drops” baked into the loop for density without a metronome.
    const drop = Math.random() < dropRate ? (Math.random() * 2 - 1) * (0.55 + Math.random() * 0.45) : 0
    // Occasional micro-cluster (sheet of rain).
    const sheet = Math.random() < dropRate * 0.15 ? white * 0.7 : 0
    data[i] = white * whiteMix + brown * brownMix + b0 * 0.35 + b1 * 0.25 + drop + sheet
  }
  return buf
}

function scheduleRainDrops() {
  if (!rainBed || rainLevel < 0.08) return
  const wait = (90 + Math.random() * 180) / (0.35 + rainLevel)
  rainDropTimer = setTimeout(() => {
    rainDropTimer = null
    if (!rainBed || rainLevel < 0.08 || !sfxEnabled) {
      scheduleRainDrops()
      return
    }
    // Individual drops on metal deck / glass — short band-passed ticks.
    const n = 1 + (Math.random() < rainLevel * 0.7 ? 1 : 0) + (Math.random() < rainLevel * 0.35 ? 1 : 0)
    for (let i = 0; i < n; i++) {
      noiseBurst({
        duration: 0.018 + Math.random() * 0.03,
        filterFreq: 1800 + Math.random() * 3200,
        peak: (0.012 + Math.random() * 0.02) * (0.55 + rainLevel * 0.55),
        drive: 0.8,
        delay: Math.random() * 0.08,
        filterType: 'bandpass',
        q: 1.6 + Math.random(),
        highpassHz: 600
      })
    }
    scheduleRainDrops()
  }, wait)
}

function ensureRainBed() {
  if (rainBed) return rainBed
  const audio = getContext()
  const now = audio.currentTime
  const dest = getMasterDestination()

  // Three independent loops so the bed never reads as one locked texture.
  const hissBuf = fillRainBuffer(audio, 2.9, { dropRate: 0.006, brownMix: 0.55, whiteMix: 0.7 })
  const midBuf = fillRainBuffer(audio, 4.1, { dropRate: 0.0035, brownMix: 1.1, whiteMix: 0.35 })
  const bodyBuf = fillRainBuffer(audio, 5.2, { dropRate: 0.001, brownMix: 1.6, whiteMix: 0.12 })

  // High hiss — dense rain on canvas/glass.
  const hissSrc = audio.createBufferSource()
  hissSrc.buffer = hissBuf
  hissSrc.loop = true
  const hissHp = audio.createBiquadFilter()
  hissHp.type = 'highpass'
  hissHp.frequency.value = 1400
  const hissBp = audio.createBiquadFilter()
  hissBp.type = 'bandpass'
  hissBp.frequency.value = 3800
  hissBp.Q.value = 0.42
  const hissLp = audio.createBiquadFilter()
  hissLp.type = 'lowpass'
  hissLp.frequency.value = 9000
  const hissG = audio.createGain()
  hissG.gain.value = 0.0001
  hissSrc.connect(hissHp).connect(hissBp).connect(hissLp).connect(hissG).connect(dest)

  // Mid patter — main body of rain in air.
  const midSrc = audio.createBufferSource()
  midSrc.buffer = midBuf
  midSrc.loop = true
  const midHp = audio.createBiquadFilter()
  midHp.type = 'highpass'
  midHp.frequency.value = 380
  const midBp = audio.createBiquadFilter()
  midBp.type = 'bandpass'
  midBp.frequency.value = 1600
  midBp.Q.value = 0.5
  const midLp = audio.createBiquadFilter()
  midLp.type = 'lowpass'
  midLp.frequency.value = 4800
  const midG = audio.createGain()
  midG.gain.value = 0.0001
  midSrc.connect(midHp).connect(midBp).connect(midLp).connect(midG).connect(dest)

  // Low storm air / wind-in-rain.
  const bodySrc = audio.createBufferSource()
  bodySrc.buffer = bodyBuf
  bodySrc.loop = true
  const bodyLp = audio.createBiquadFilter()
  bodyLp.type = 'lowpass'
  bodyLp.frequency.value = 260
  const bodyG = audio.createGain()
  bodyG.gain.value = 0.0001
  bodySrc.connect(bodyLp).connect(bodyG).connect(dest)

  hissSrc.start(now)
  midSrc.start(now + 0.04)
  bodySrc.start(now + 0.09)

  rainBed = {
    source: midSrc,
    bodySrc,
    sources: [hissSrc, midSrc, bodySrc],
    gain: midG,
    hissG,
    midG,
    bodyG
  }
  return rainBed
}

function stopRainBedNodes(fadeS = 1.2) {
  if (rainDropTimer != null) {
    clearTimeout(rainDropTimer)
    rainDropTimer = null
  }
  if (!rainBed) return
  const audio = getContext()
  const now = audio.currentTime
  const bed = rainBed
  rainBed = null
  const gains = [bed.hissG, bed.midG, bed.bodyG, bed.gain].filter(Boolean)
  try {
    for (const g of gains) {
      g.gain.cancelScheduledValues(now)
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now)
      g.gain.linearRampToValueAtTime(0.0001, now + fadeS)
    }
    const stopAt = now + fadeS + 0.15
    for (const s of bed.sources ?? [bed.source, bed.bodySrc]) {
      try { s.stop(stopAt) } catch { /* */ }
    }
  } catch { /* */ }
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
  // Duck music under wet weather so rain/thunder read over the bed.
  applyWeatherMusicDuck(next > 0.05 ? Math.min(1, next * 0.85 + 0.15) : 0, 1.4)
  if (next < 0.02) {
    stopRainBedNodes(1.2)
    return
  }
  const bed = ensureRainBed()
  const audio = getContext()
  const now = audio.currentTime
  // Layered levels — denser than the old single hiss, still under diesel.
  const hissPeak = 0.012 + next * 0.055
  const midPeak = 0.018 + next * 0.07
  const bodyPeak = next > 0.4 ? (next - 0.4) * 0.09 : 0.0001
  const ramp = (g, v, t) => {
    try {
      g.gain.cancelScheduledValues(now)
      g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), now)
      g.gain.linearRampToValueAtTime(Math.max(0.0001, v), now + t)
    } catch { /* */ }
  }
  ramp(bed.hissG, hissPeak, 0.55)
  ramp(bed.midG, midPeak, 0.65)
  ramp(bed.bodyG, bodyPeak, 0.9)
  if (!rainDropTimer) scheduleRainDrops()
}

/**
 * Thunder over water. Near strikes crack; distant ones are pure rumble.
 * @param {{ delay?: number, volume?: number, distanceKm?: number }} [opts]
 */
export function playThunder(opts = {}) {
  ensureSfx()
  if (!sfxEnabled) return
  const delay = opts.delay ?? 0
  // Give the storm its requested extra presence without changing rain, music,
  // weapons, or any other SFX bus levels.
  const volume = Math.min(2.1, Math.max(0.05, (opts.volume ?? 1) * 1.5))
  // Weather already supplies distanceKm (0.2–3.1). Infer nearness if missing.
  const km = Number.isFinite(opts.distanceKm)
    ? opts.distanceKm
    : Math.max(0.25, 2.4 - volume * 2.0)
  // 0 at ~3 km, 1 at 0.2 km — crack only when close.
  const near = Math.min(1, Math.max(0, 1 - (km - 0.2) / 2.9))
  const far = 1 - near * 0.65

  // Real field recordings carry the irregular crack/roll envelope that a
  // handful of oscillators cannot fake. Pick a different take and playback
  // rate each strike; keep the procedural version below as the instant-load
  // fallback for the first storm after boot.
  const rollFiles = [
    'thunder/thunder_roll_1.ogg',
    'thunder/thunder_roll_2.ogg',
    'thunder/thunder_roll_3.ogg'
  ]
  const sampleFile = near > 0.58
    ? 'thunder/thunder_clap.wav'
    : rollFiles[Math.floor(Math.random() * rollFiles.length)]
  const sampleVolume = volume * (near > 0.58 ? 0.78 + near * 0.42 : 0.9 + far * 0.45)
  const sampleDuration = near > 0.58 ? 2.2 + far * 1.5 : 3.8 + far * 2.4
  const samplePlayed = !!playSample(sampleFile, {
    volume: sampleVolume,
    rate: (near > 0.58 ? 0.9 : 0.82) + Math.random() * (near > 0.58 ? 0.22 : 0.18),
    delay,
    duration: sampleDuration,
    lowpassHz: near > 0.58 ? 4200 + near * 2800 : 900 + near * 850,
    lowpassQ: 0.45
  })
  // Keep a restrained procedural bed under the recording. It guarantees an
  // audible strike on decoders that play a field take unusually quietly.
  const synthVolume = samplePlayed ? 0.35 : 1

  // --- Crack (close strikes only) ---
  if (near > 0.35) {
    const crackPeak = volume * near * near * 0.55 * synthVolume
    noiseBurst({
      duration: 0.04,
      filterFreq: 5500,
      peak: crackPeak,
      drive: 2.2,
      delay,
      filterType: 'highpass',
      q: 0.7,
      highpassHz: 1800
    })
    noiseBurst({
      duration: 0.09,
      filterFreq: 2400,
      peak: crackPeak * 0.7,
      drive: 2.8,
      delay: delay + 0.012,
      highpassHz: 400
    })
    // Brief mid slap so it isn't pure white.
    noiseBurst({
      duration: 0.16,
      filterFreq: 900,
      peak: crackPeak * 0.45,
      drive: 2,
      delay: delay + 0.02,
      highpassHz: 120
    })
  }

  // --- Pressure boom + rolling body (all distances) ---
  const subMul = volume * (0.55 + far * 0.55) * synthVolume
  const rollLen = 2.2 + far * 1.4
  tone({
    type: 'sine',
    freq: 46 + near * 12,
    freqEnd: 18,
    duration: rollLen * 1.05,
    attack: 0.02 + far * 0.04,
    peak: 0.4 * subMul,
    delay: delay + near * 0.01
  })
  tone({
    type: 'sine',
    freq: 68,
    freqEnd: 24,
    duration: rollLen * 0.85,
    attack: 0.018,
    peak: 0.26 * subMul,
    delay: delay + 0.025
  })
  tone({
    type: 'triangle',
    freq: 92,
    freqEnd: 32,
    duration: rollLen * 0.55,
    attack: 0.012,
    peak: 0.14 * subMul * (0.5 + near * 0.5),
    delay: delay + 0.04
  })
  noiseBurst({
    duration: rollLen,
    filterFreq: 150 + near * 80,
    peak: 0.46 * subMul,
    drive: 2.4,
    delay: delay + (near > 0.5 ? 0.03 : 0)
  })
  noiseBurst({
    duration: rollLen * 0.85,
    filterFreq: 85,
    peak: 0.36 * subMul,
    drive: 3.1,
    delay: delay + 0.06
  })
  // Distant secondary roll across the sea surface.
  noiseBurst({
    duration: rollLen * 1.1,
    filterFreq: 60 + far * 20,
    peak: 0.2 * subMul * far,
    drive: 1.7,
    delay: delay + 0.28 + far * 0.25
  })
  noiseBurst({
    duration: 1.0 + far * 0.4,
    filterFreq: 280 + near * 120,
    peak: 0.11 * volume * (0.4 + near * 0.6) * synthVolume,
    drive: 1.2,
    delay: delay + 0.08,
    highpassHz: 50
  })
}

/** Kill rain bed (title screen / mute path). */
export function stopWeatherAudio(fadeOut = 0.8) {
  rainLevel = 0
  applyWeatherMusicDuck(0, fadeOut)
  if (!rainBed) return
  stopRainBedNodes(fadeOut)
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
 * Main engine — industrial marine diesel + turbo/turbine hybrid, not a thruster.
 *
 * Synthesised rather than sampled because the character that makes a diesel a
 * diesel is the *chug*: the amplitude pulsing at the cylinder firing rate. A
 * looped sample locks that rate to one engine speed, and then opening the
 * throttle just makes the same loop louder. Driving an LFO from the throttle
 * gives revs that actually rise and fall.
 *
 * Layers:
 *   - `block`   low sawtooth, firing-order fundamental
 *   - `growl`   octave-up square through a load-open filter
 *   - `stack`   brown exhaust noise
 *   - `clatter` mechanical injection / rocker grit pulsed by the chug
 *   - `turbo`   low blower/spool hum under load (kept below the diesel)
 *   - `chug`    LFO at firing rate gating the diesel body
 */
let engine = null
/** Where the mode/revs sit, so a re-arm after a context resume matches. */
let thrustMode = null
let engineRevs = 0

/** Cylinder firing rate, Hz, at idle and at full ahead. */
const DIESEL_IDLE_HZ = 20
const DIESEL_MAX_HZ = 56

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
  gain.gain.linearRampToValueAtTime(0.15, now + 0.65)
  // Mild low shelf so the diesel sits under weapons without vanishing.
  const bodyShelf = audio.createBiquadFilter()
  bodyShelf.type = 'lowshelf'
  bodyShelf.frequency.value = 180
  bodyShelf.gain.value = 2.5
  const engineLp = audio.createBiquadFilter()
  engineLp.type = 'lowpass'
  engineLp.frequency.value = 4200
  gain.connect(bodyShelf).connect(engineLp).connect(getMasterDestination())

  // The chug: a slow triangle whose depth is most of the signal. This is the
  // whole trick — without it the layers below are just a synth pad.
  const chugDepth = audio.createGain()
  chugDepth.gain.value = 0.58
  const chug = audio.createOscillator()
  chug.type = 'triangle'
  chug.frequency.value = DIESEL_IDLE_HZ
  const chugGain = audio.createGain()
  chugGain.gain.value = 0.42 // the floor the chug modulates around
  chug.connect(chugDepth).connect(chugGain.gain)
  chugGain.connect(gain)

  // Sub-harmonic thump — heavy industrial block mass.
  const sub = audio.createOscillator()
  sub.type = 'sine'
  sub.frequency.value = DIESEL_IDLE_HZ * 0.5
  const subGain = audio.createGain()
  subGain.gain.value = 0.35
  sub.connect(subGain).connect(chugGain)

  const block = audio.createOscillator()
  block.type = 'sawtooth'
  block.frequency.value = DIESEL_IDLE_HZ
  const blockFilter = audio.createBiquadFilter()
  blockFilter.type = 'lowpass'
  blockFilter.frequency.value = 220
  blockFilter.Q.value = 0.9
  const blockGain = audio.createGain()
  blockGain.gain.value = 0.82
  block.connect(blockFilter).connect(blockGain).connect(chugGain)

  const growl = audio.createOscillator()
  growl.type = 'square'
  growl.frequency.value = DIESEL_IDLE_HZ * 2
  const growlFilter = audio.createBiquadFilter()
  growlFilter.type = 'lowpass'
  growlFilter.frequency.value = 400
  growlFilter.Q.value = 3.2
  const growlGain = audio.createGain()
  growlGain.gain.value = 0.22
  growl.connect(growlFilter).connect(growlGain).connect(chugGain)

  // Exhaust stack: brown noise, band-limited, level rising with load.
  const noiseBuf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate)
  const data = noiseBuf.getChannelData(0)
  let brown = 0
  for (let i = 0; i < data.length; i++) {
    brown = (brown + (Math.random() * 2 - 1) * 0.06) * 0.985
    data[i] = brown * 3
  }
  const stack = audio.createBufferSource()
  stack.buffer = noiseBuf
  stack.loop = true
  const stackFilter = audio.createBiquadFilter()
  stackFilter.type = 'lowpass'
  stackFilter.frequency.value = 650
  const stackGain = audio.createGain()
  stackGain.gain.value = 0.16
  stack.connect(stackFilter).connect(stackGain).connect(chugGain)

  // Mechanical clatter — injection / rocker grit, also under the chug gate.
  const clatter = audio.createBufferSource()
  clatter.buffer = noiseBuf
  clatter.loop = true
  const clatterBp = audio.createBiquadFilter()
  clatterBp.type = 'bandpass'
  clatterBp.frequency.value = 1400
  clatterBp.Q.value = 1.8
  const clatterHp = audio.createBiquadFilter()
  clatterHp.type = 'highpass'
  clatterHp.frequency.value = 700
  const clatterGain = audio.createGain()
  clatterGain.gain.value = 0.05
  clatter.connect(clatterHp).connect(clatterBp).connect(clatterGain).connect(chugGain)

  // Turbo / blower load tone — low industrial spool under load, not a jet whine.
  const turbo = audio.createOscillator()
  turbo.type = 'sawtooth'
  turbo.frequency.value = 95
  const turboDetune = audio.createOscillator()
  turboDetune.type = 'sawtooth'
  turboDetune.frequency.value = 98
  const turboMix = audio.createGain()
  turboMix.gain.value = 0.5
  const turboFilter = audio.createBiquadFilter()
  turboFilter.type = 'bandpass'
  turboFilter.frequency.value = 280
  turboFilter.Q.value = 2.2
  const turboLp = audio.createBiquadFilter()
  turboLp.type = 'lowpass'
  turboLp.frequency.value = 900
  const turboGain = audio.createGain()
  turboGain.gain.value = 0.0001
  turbo.connect(turboMix)
  turboDetune.connect(turboMix)
  turboMix.connect(turboFilter).connect(turboLp).connect(turboGain).connect(gain)

  // Soft blower hum (sine) — stays mid/low so it does not scream over the diesel.
  const whistle = audio.createOscillator()
  whistle.type = 'sine'
  whistle.frequency.value = 160
  const whistleGain = audio.createGain()
  whistleGain.gain.value = 0.0001
  whistle.connect(whistleGain).connect(gain)

  for (const node of [chug, sub, block, growl, stack, clatter, turbo, turboDetune, whistle]) {
    node.start(now)
  }
  engine = {
    gain,
    sources: [chug, sub, block, growl, stack, clatter, turbo, turboDetune, whistle],
    chug,
    sub,
    block,
    growl,
    turbo,
    turboDetune,
    whistle,
    blockFilter,
    growlFilter,
    stackGain,
    stackFilter,
    clatterGain,
    clatterBp,
    turboFilter,
    turboGain,
    whistleGain,
    chugDepth
  }
  applyEngineRevs()
}

/** Push the current rev fraction into the running engine's nodes. */
function applyEngineRevs() {
  if (!engine) return
  const audio = getContext()
  const now = audio.currentTime
  // Ramp rather than set: a diesel has a flywheel, it does not step.
  const at = (param, value, timeConst = 0.22) => {
    param.cancelScheduledValues(now)
    param.setTargetAtTime(value, now, timeConst)
  }
  const rev = Math.min(1, Math.max(0, engineRevs))
  const hz = DIESEL_IDLE_HZ + (DIESEL_MAX_HZ - DIESEL_IDLE_HZ) * rev
  at(engine.chug.frequency, hz)
  at(engine.sub.frequency, hz * 0.5)
  at(engine.block.frequency, hz)
  at(engine.growl.frequency, hz * 2)
  // Under load the note opens up and the stack gets loud — that is "working".
  at(engine.blockFilter.frequency, 210 + 520 * rev)
  at(engine.growlFilter.frequency, 380 + 980 * rev)
  at(engine.stackFilter.frequency, 620 + 1600 * rev)
  at(engine.stackGain.gain, 0.15 + 0.38 * rev)
  at(engine.clatterBp.frequency, 1100 + 1600 * rev)
  at(engine.clatterGain.gain, 0.035 + 0.11 * rev)
  // Chug deepens slightly at idle (heavier cylinder slap), thins under scream.
  at(engine.chugDepth.gain, 0.62 - 0.18 * rev)
  // Turbo / blower spool — low range only (was a piercing 2–3 kHz whine).
  const turboHz = 85 + 220 * rev
  at(engine.turbo.frequency, turboHz, 0.4)
  at(engine.turboDetune.frequency, turboHz * 1.03, 0.4)
  at(engine.turboFilter.frequency, 220 + 380 * rev, 0.35)
  // Almost silent at idle; mild under load — supports the diesel, not a jet.
  const turboLevel = rev < 0.12 ? 0.0001 : (rev - 0.12) * (rev - 0.12) * 0.14
  at(engine.turboGain.gain, turboLevel, 0.45)
  at(engine.whistle.frequency, 140 + 260 * rev, 0.42)
  at(engine.whistleGain.gain, rev < 0.25 ? 0.0001 : (rev - 0.25) * 0.028, 0.45)
  // Master diesel level — sits under sea + guns; opens with revs.
  at(engine.gain.gain, 0.1 + 0.145 * rev)
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
  // Title screen is clear weather; reset any lingering storm duck.
  weatherMusicDuck = 0
  weatherMusicDuckTarget = 0
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
  fadeMusicVolume(deathMusic, DEATH_VOLUME * musicVolume * musicWeatherMul(), MUSIC_FADE_S)
}

// fadeIn only applies to the FIRST track of a session (the title -> ambient
// entry); automatic hops between ambient tracks stay a plain cut — the user
// asked for a fade on session entry/exit and death, not on the playlist's own
// internal track changes.
function playNextAmbientTrack(fadeIn = false) {
  const track = AMBIENT_TRACKS[ambientTrackIndex % AMBIENT_TRACKS.length]
  ambientTrackIndex++
  ambientMusic = playFile(track, { loop: false, volume: AMBIENT_VOLUME })
  // Apply current weather duck so a mid-storm track hop does not jump loud.
  ambientMusic.volume = AMBIENT_VOLUME * musicVolume * musicWeatherMul()
  ambientMusic.onended = () => playNextAmbientTrack(false)
  if (fadeIn) {
    ambientMusic.volume = 0
    fadeMusicVolume(ambientMusic, AMBIENT_VOLUME * musicVolume * musicWeatherMul(), MUSIC_FADE_S)
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
