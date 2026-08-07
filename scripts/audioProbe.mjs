/**
 * Offline audio probe — renderer half.
 *
 * Loaded by scripts/audioProbe.cjs into a hidden Electron window. Renders every
 * SFX and every layered bed state through the REAL master chain into an
 * OfflineAudioContext, then draws a waveform + log-frequency spectrogram and
 * measures the signal. Nothing here ever plays out of a speaker — there is no
 * realtime AudioContext in this file at all.
 *
 * Not shipped with the game. Dev QA only.
 */

import * as S from '/src/renderer/audioSynth.js'

const SR = 48000

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/** In-place iterative radix-2 FFT. */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]
        const ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr
        im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr
        im[i + k + len / 2] = ui - vi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

const WIN = 2048
const HOP = 256
const HANN = (() => {
  const w = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1))
  return w
})()

function spectrogram(mono) {
  const frames = Math.max(1, Math.floor((mono.length - WIN) / HOP))
  const out = []
  const re = new Float64Array(WIN)
  const im = new Float64Array(WIN)
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    for (let i = 0; i < WIN; i++) {
      re[i] = (mono[off + i] || 0) * HANN[i]
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float32Array(WIN / 2)
    for (let k = 0; k < WIN / 2; k++) mag[k] = Math.hypot(re[k], im[k]) / (WIN / 4)
    out.push(mag)
  }
  return out
}

const db = (x) => 20 * Math.log10(Math.max(1e-7, x))

function analyse(buf) {
  const L = buf.getChannelData(0)
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const n = L.length
  let peak = 0
  let sum = 0
  let clipped = 0
  let maxStep = 0
  let maxStepAt = 0
  let sl = 0
  let sr2 = 0
  let slr = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(L[i])
    const b = Math.abs(R[i])
    if (a > peak) peak = a
    if (b > peak) peak = b
    if (a >= 0.999 || b >= 0.999) clipped++
    sum += L[i] * L[i] + R[i] * R[i]
    sl += L[i] * L[i]
    sr2 += R[i] * R[i]
    slr += L[i] * R[i]
    if (i > 0) {
      const step = Math.max(Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1]))
      if (step > maxStep) { maxStep = step; maxStepAt = i / SR }
    }
  }
  const rms = Math.sqrt(sum / (2 * n))
  const corr = slr / Math.max(1e-9, Math.sqrt(sl * sr2))

  // Click / loop-seam detector.
  //
  // Raw max sample step is useless as a click metric: a loud 12 kHz component
  // legitimately moves ~0.8 per sample at 48 kHz, so bright content trips it.
  // What actually identifies a discontinuity is an ISOLATED spike in the
  // differentiated signal — huge next to the surrounding material. So: first
  // difference (a 6 dB/oct HF tilt), 1 ms peak envelope, then peak against the
  // median. Steady beds should sit near 1; a buffer seam spikes it hard.
  const step = Math.floor(SR * 0.001)
  const dEnv = new Float32Array(Math.max(1, Math.floor(n / step)))
  for (let e = 0; e < dEnv.length; e++) {
    let m = 0
    const a = Math.max(1, e * step)
    const b = Math.min(n, a + step)
    for (let i = a; i < b; i++) {
      const d0 = Math.abs(L[i] - L[i - 1])
      const d1 = Math.abs(R[i] - R[i - 1])
      if (d0 > m) m = d0
      if (d1 > m) m = d1
    }
    dEnv[e] = m
  }
  const sorted = Float32Array.from(dEnv).sort()
  // Floor the reference against the 95th percentile: cases that are mostly
  // silence between events have a median of ~0, which made the ratio explode
  // into six-figure nonsense.
  const median = Math.max(
    sorted[Math.floor(sorted.length * 0.5)] || 0,
    (sorted[Math.floor(sorted.length * 0.95)] || 0) * 0.05,
    1e-5
  )
  let clickScore = 0
  let clickAt = 0
  for (let e = 0; e < dEnv.length; e++) {
    const s = dEnv[e] / Math.max(median, 1e-6)
    if (s > clickScore) { clickScore = s; clickAt = e / 1000 }
  }

  // Envelope (mono, 1 ms) for attack timing and decay shape.
  const mono = new Float32Array(n)
  for (let i = 0; i < n; i++) mono[i] = (L[i] + R[i]) * 0.5
  const envN = Math.floor(n / (SR * 0.001))
  const env = new Float32Array(Math.max(1, envN))
  for (let e = 0; e < env.length; e++) {
    const a = e * Math.floor(SR * 0.001)
    const b = Math.min(n, a + Math.floor(SR * 0.001))
    let m = 0
    for (let i = a; i < b; i++) m = Math.max(m, Math.abs(mono[i]))
    env[e] = m
  }
  let peakIdx = 0
  for (let e = 0; e < env.length; e++) if (env[e] > env[peakIdx]) peakIdx = e
  const pv = env[peakIdx] || 1
  let i10 = peakIdx
  let i90 = peakIdx
  for (let e = peakIdx; e >= 0; e--) { if (env[e] <= pv * 0.9) { i90 = e; break } }
  for (let e = i90; e >= 0; e--) { if (env[e] <= pv * 0.1) { i10 = e; break } }
  const attackMs = Math.max(0, i90 - i10)
  // How much of the peak is already present 3 ms after onset. This is what
  // "sharp" actually means. The 10%->90%-of-global-peak timing above lies on
  // dense signals whose absolute maximum lands well after a perfect attack.
  let onset = 0
  for (let e = 0; e < env.length; e++) { if (env[e] > pv * 0.1) { onset = e; break } }
  const peakDelayMs = Math.max(0, peakIdx - onset)
  // -20 dB decay time after the peak.
  let decayMs = -1
  for (let e = peakIdx; e < env.length; e++) {
    if (env[e] <= pv * 0.1) { decayMs = e - peakIdx; break }
  }

  // Band energy split from the average spectrum.
  const spec = spectrogram(mono)
  const avg = new Float64Array(WIN / 2)
  for (const fr of spec) for (let k = 0; k < fr.length; k++) avg[k] += fr[k] * fr[k]
  const EDGES = [20, 120, 500, 2000, 8000, 20000]
  const bands = new Array(EDGES.length - 1).fill(0)
  let total = 0
  let centNum = 0
  let centDen = 0
  for (let k = 1; k < avg.length; k++) {
    const f = (k * SR) / WIN
    const e = avg[k]
    total += e
    centNum += f * e
    centDen += e
    for (let b = 0; b < bands.length; b++) {
      if (f >= EDGES[b] && f < EDGES[b + 1]) { bands[b] += e; break }
    }
  }
  const bandPct = bands.map((b) => (total > 0 ? (b / total) * 100 : 0))
  const centroid = centDen > 0 ? centNum / centDen : 0

  // Whole-file band energy under-weights transients: a brilliant 10 ms crack is
  // a rounding error next to a 2 s rumble, so a perfectly bright gunshot reads
  // as "no top end".
  //
  // The main spectrogram cannot answer this either — a 2048-point window is
  // 43 ms wide, so it smears the transient together with the body it is being
  // compared against. Use a dedicated short window (512 = 10.7 ms) starting at
  // onset. Coarse in frequency, but that is the correct trade here.
  const AW = 512
  const atkAvg = new Float64Array(AW / 2)
  const onsetSample = Math.min(Math.max(0, n - AW - 1), Math.floor(onset * (SR / 1000)))
  {
    const re = new Float64Array(AW)
    const im = new Float64Array(AW)
    for (let i = 0; i < AW; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (AW - 1))
      re[i] = (mono[onsetSample + i] || 0) * w
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < AW / 2; k++) atkAvg[k] = (re[k] * re[k] + im[k] * im[k])
  }
  const atkBands = new Array(EDGES.length - 1).fill(0)
  let atkTotal = 0
  for (let k = 1; k < atkAvg.length; k++) {
    const f = (k * SR) / AW
    atkTotal += atkAvg[k]
    for (let b = 0; b < atkBands.length; b++) {
      if (f >= EDGES[b] && f < EDGES[b + 1]) { atkBands[b] += atkAvg[k]; break }
    }
  }
  const atkBandPct = atkBands.map((b) => (atkTotal > 0 ? (b / atkTotal) * 100 : 0))

  return {
    peak, peakDb: db(peak), rms, rmsDb: db(rms), crest: db(peak) - db(rms),
    clipped, maxStep, maxStepAt, attackMs, decayMs, corr, centroid, bandPct,
    clickScore, clickAt, peakDelayMs, atkBandPct, durationS: n / SR, spec
  }
}

// ---------------------------------------------------------------------------
// Plotting
// ---------------------------------------------------------------------------

/** Perceptually-ordered ramp so weak partials stay visible against the floor. */
function heat(t) {
  const stops = [
    [0, 0, 0], [12, 8, 60], [60, 10, 110], [130, 20, 110],
    [200, 50, 70], [244, 110, 30], [252, 190, 60], [255, 255, 235]
  ]
  const x = Math.max(0, Math.min(0.999, t)) * (stops.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = stops[i]
  const b = stops[i + 1]
  return `rgb(${(a[0] + (b[0] - a[0]) * f) | 0},${(a[1] + (b[1] - a[1]) * f) | 0},${(a[2] + (b[2] - a[2]) * f) | 0})`
}

/**
 * Automatic faults. Thresholds differ by case kind: a shot 1.8 km away is
 * SUPPOSED to be quiet, and a one-shot's own transient is supposed to spike the
 * click detector — only steady beds are held to a seamless-loop standard.
 */
function checkFaults(st, opts = {}) {
  const f = []
  if (st.clipped > 0) f.push(`CLIPPED x${st.clipped}`)
  if (!opts.quietOk && st.peakDb < -20) f.push('QUIET')
  if (opts.steady) {
    if (st.clickScore > 9) f.push(`SEAM ${st.clickScore.toFixed(0)}x@${st.clickAt.toFixed(2)}s`)
    if (st.crest > 26) f.push('BED SPIKY')
  }
  if (!opts.lowOk && st.bandPct[0] + st.bandPct[1] < 8) f.push('NO LOW END')
  if (!opts.subOk && st.bandPct[0] > 78) f.push(`SUB HEAVY ${st.bandPct[0].toFixed(0)}%`)
  // Brightness is judged on the transient, not the whole file.
  if (!opts.brightOk && st.atkBandPct[3] + st.atkBandPct[4] < 2.5) f.push('DULL ATTACK')
  if (opts.impulsive && st.peakDelayMs > 10) f.push(`SOFT ONSET ${st.peakDelayMs}ms`)
  if (opts.bedLevel && st.rmsDb > opts.bedLevel) f.push(`BED HOT ${st.rmsDb.toFixed(1)}dB`)
  if (st.corr > 0.985) f.push('MONO')
  return f
}

const W = 1280
const H_HEAD = 30
const H_WAVE = 190
const H_SPEC = 420
const H_FOOT = 116
const H = H_HEAD + H_WAVE + H_SPEC + H_FOOT

function draw(name, buf, st, opts = {}) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  g.fillStyle = '#0b0d12'
  g.fillRect(0, 0, W, H)
  g.font = '13px ui-monospace, Menlo, monospace'
  g.textBaseline = 'top'

  // --- header ---
  g.fillStyle = '#e8ecf4'
  g.fillText(name, 10, 8)
  g.fillStyle = st.clipped > 0 ? '#ff5555' : '#8fe08f'
  g.fillText(
    `peak ${st.peakDb.toFixed(1)}dBFS  rms ${st.rmsDb.toFixed(1)}  crest ${st.crest.toFixed(1)}dB  ` +
    `clip ${st.clipped}  atk ${st.attackMs}ms  ` +
    `dec ${st.decayMs < 0 ? '>len' : st.decayMs + 'ms'}  corr ${st.corr.toFixed(2)}  ` +
    `centroid ${(st.centroid / 1000).toFixed(2)}k  click ${st.clickScore.toFixed(1)}  ` +
    `peak@+${st.peakDelayMs}ms`,
    260, 8
  )

  // --- waveform, L over R, shared clip guides ---
  const L = buf.getChannelData(0)
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L
  const half = H_WAVE / 2
  for (let ch = 0; ch < 2; ch++) {
    const data = ch === 0 ? L : R
    const top = H_HEAD + ch * half
    const mid = top + half / 2
    g.fillStyle = '#11141c'
    g.fillRect(0, top, W, half - 1)
    // ±1.0 clip rails and ±0.5 guide
    g.strokeStyle = '#5a1f1f'
    g.beginPath()
    g.moveTo(0, top + 1); g.lineTo(W, top + 1)
    g.moveTo(0, top + half - 2); g.lineTo(W, top + half - 2)
    g.stroke()
    g.strokeStyle = '#22283a'
    g.beginPath()
    g.moveTo(0, mid); g.lineTo(W, mid)
    g.stroke()
    g.strokeStyle = ch === 0 ? '#6fd0ff' : '#ffb56f'
    g.beginPath()
    const per = data.length / W
    for (let x = 0; x < W; x++) {
      let lo = 1
      let hi = -1
      const a = Math.floor(x * per)
      const b = Math.min(data.length, Math.floor((x + 1) * per))
      for (let i = a; i < b; i++) {
        if (data[i] < lo) lo = data[i]
        if (data[i] > hi) hi = data[i]
      }
      if (b <= a) { lo = 0; hi = 0 }
      g.moveTo(x + 0.5, mid - hi * (half / 2 - 2))
      g.lineTo(x + 0.5, mid - lo * (half / 2 - 2))
    }
    g.stroke()
    g.fillStyle = '#7a8296'
    g.fillText(ch === 0 ? 'L' : 'R', 4, top + 3)
  }

  // --- spectrogram, log frequency ---
  const specTop = H_HEAD + H_WAVE
  const frames = st.spec.length
  const F_MIN = 20
  const F_MAX = 20000
  const logMin = Math.log(F_MIN)
  const logMax = Math.log(F_MAX)
  const DB_FLOOR = -96
  for (let x = 0; x < W; x++) {
    const f0 = Math.floor((x / W) * frames)
    const f1 = Math.max(f0 + 1, Math.floor(((x + 1) / W) * frames))
    for (let y = 0; y < H_SPEC; y++) {
      // top of the panel = F_MAX
      const fHi = Math.exp(logMax - ((y) / H_SPEC) * (logMax - logMin))
      const fLo = Math.exp(logMax - ((y + 1) / H_SPEC) * (logMax - logMin))
      const kLo = Math.max(1, Math.round((fLo * WIN) / SR))
      const kHi = Math.max(kLo, Math.min(WIN / 2 - 1, Math.round((fHi * WIN) / SR)))
      let m = 0
      for (let f = f0; f < f1 && f < frames; f++) {
        const fr = st.spec[f]
        for (let k = kLo; k <= kHi; k++) if (fr[k] > m) m = fr[k]
      }
      const d = db(m)
      if (d <= DB_FLOOR) continue
      g.fillStyle = heat((d - DB_FLOOR) / -DB_FLOOR)
      g.fillRect(x, specTop + y, 1, 1)
    }
  }
  // frequency gridlines
  g.strokeStyle = 'rgba(255,255,255,0.14)'
  g.fillStyle = '#9aa3b8'
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = specTop + ((logMax - Math.log(f)) / (logMax - logMin)) * H_SPEC
    g.beginPath()
    g.moveTo(0, y); g.lineTo(W, y)
    g.stroke()
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 3, y - 14)
  }
  // time gridlines
  for (let s = 1; s < st.durationS; s++) {
    const x = (s / st.durationS) * W
    g.beginPath()
    g.moveTo(x, specTop); g.lineTo(x, specTop + H_SPEC)
    g.stroke()
    g.fillText(`${s}s`, x + 3, specTop + H_SPEC - 16)
  }

  // --- footer: band balance ---
  const footTop = specTop + H_SPEC
  g.fillStyle = '#11141c'
  g.fillRect(0, footTop, W, H_FOOT)
  const labels = ['20-120 sub', '120-500 low', '500-2k mid', '2k-8k hi', '8k-20k air']
  const colours = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7']
  const bw = 150
  for (let i = 0; i < labels.length; i++) {
    const x = 14 + i * (bw + 18)
    const pct = st.bandPct[i]
    const h = Math.min(64, (pct / 100) * 190)
    g.fillStyle = colours[i]
    g.fillRect(x, footTop + 76 - h, bw, h)
    g.fillStyle = '#c9d1e2'
    g.fillText(`${labels[i]}`, x, footTop + 82)
    g.fillText(`${pct.toFixed(1)}%  atk ${st.atkBandPct[i].toFixed(1)}%`, x, footTop + 98)
  }
  // Verdict strip — the things I keep having to re-check by eye.
  const faults = checkFaults(st, opts)
  g.fillStyle = faults.length ? '#ff6b6b' : '#8fe08f'
  g.fillText(faults.length ? `FAULTS: ${faults.join('  ')}` : 'no automatic faults', 820, footTop + 82)
  return c
}

// ---------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------

function wavBase64(buf) {
  const n = buf.length
  const ch = Math.min(2, buf.numberOfChannels)
  const bytes = 44 + n * ch * 2
  const ab = new ArrayBuffer(bytes)
  const v = new DataView(ab)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, ch, true); v.setUint32(24, SR, true)
  v.setUint32(28, SR * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * ch * 2, true)
  const chans = []
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      o += 2
    }
  }
  let bin = ''
  const u8 = new Uint8Array(ab)
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/** Drop leading silence so distance pre-delay does not blank half the plot. */
function trimLead(ctxBuf, offlineCtx) {
  const L = ctxBuf.getChannelData(0)
  const R = ctxBuf.numberOfChannels > 1 ? ctxBuf.getChannelData(1) : L
  const thresh = 10 ** (-75 / 20)
  let start = 0
  for (let i = 0; i < L.length; i++) {
    if (Math.abs(L[i]) > thresh || Math.abs(R[i]) > thresh) { start = i; break }
  }
  start = Math.max(0, start - Math.floor(SR * 0.02))
  if (start < SR * 0.05) return ctxBuf
  const n = ctxBuf.length - start
  const out = offlineCtx.createBuffer(ctxBuf.numberOfChannels, n, SR)
  for (let c = 0; c < ctxBuf.numberOfChannels; c++) {
    out.getChannelData(c).set(ctxBuf.getChannelData(c).subarray(start))
  }
  return out
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** @type {[string, number, (ctx:BaseAudioContext, m:any)=>void][]} */
const CASES = [
  // --- weapons, by class ---
  ['weapon-deckgun-near', 3.0, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.02, { weaponClass: 'deckgun', distance: 8 }), { impulsive: true }],
  ['weapon-deckgun-mid', 4.0, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.02, { weaponClass: 'deckgun', distance: 420 })],
  ['weapon-deckgun-far', 6.0, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.02, { weaponClass: 'deckgun', distance: 1800 }), { quietOk: true, brightOk: true }],
  ['weapon-autocannon', 2.0, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.02, { weaponClass: 'autocannon', distance: 8 }), { impulsive: true }],
  ['weapon-autocannon-burst', 3.0, (c, m) => {
    for (let i = 0; i < 9; i++) S.gunShot(c, m.buses.weapon.input, 0.02 + i * 0.13, { weaponClass: 'autocannon', distance: 8 })
  }],
  ['weapon-chaingun-burst', 2.5, (c, m) => {
    for (let i = 0; i < 22; i++) S.gunShot(c, m.buses.weapon.input, 0.02 + i * 0.062, { weaponClass: 'chaingun', distance: 8 })
  }],
  ['weapon-rivet', 2.0, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.02, { weaponClass: 'rivet', distance: 8 }), { impulsive: true }],
  ['weapon-railgun', 3.0, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.06, { weaponClass: 'railgun', distance: 8 }), { impulsive: true }],
  ['weapon-sidearm', 1.6, (c, m) => S.gunShot(c, m.buses.weapon.input, 0.02, { weaponClass: 'sidearm', distance: 4 })],
  ['launcher-missile', 3.0, (c, m) => S.launcherFire(c, m.buses.weapon.input, 0.02, { kind: 'missile' })],
  ['launcher-torpedo', 3.5, (c, m) => S.launcherFire(c, m.buses.weapon.input, 0.02, { kind: 'torpedo' })],
  ['launcher-harpoon', 2.6, (c, m) => S.launcherFire(c, m.buses.weapon.input, 0.02, { kind: 'harpoon' })],

  // --- impacts ---
  ['impact-hull', 1.6, (c, m) => S.hullImpact(c, m.buses.impact.input, 0.02, {}), { impulsive: true }],
  ['impact-water', 2.0, (c, m) => S.waterImpact(c, m.buses.impact.input, 0.02, {})],
  ['impact-terrain', 1.6, (c, m) => S.terrainImpact(c, m.buses.impact.input, 0.02, {}), { impulsive: true }],
  ['explosion-hull', 4.5, (c, m) => S.explosion(c, m.buses.impact.input, 0.02, { size: 1.2, medium: 'hull' }), { impulsive: true }],
  ['explosion-air-small', 3.0, (c, m) => S.explosion(c, m.buses.impact.input, 0.02, { size: 0.55, medium: 'air' }), { impulsive: true }],
  ['explosion-water', 4.5, (c, m) => S.explosion(c, m.buses.impact.input, 0.02, { size: 1.0, medium: 'water' })],
  ['explosion-distant', 6.0, (c, m) => S.explosion(c, m.buses.impact.input, 0.02, { size: 1.4, medium: 'hull', distance: 1600 }), { quietOk: true, brightOk: true }],
  ['rock-burst', 5.0, (c, m) => S.rockBurst(c, m.buses.impact.input, 0.02, {})],

  // --- weather ---
  ['thunder-near', 7.0, (c, m) => S.thunder(c, m.buses.weather.input, 0.02, { distanceKm: 0.25, skipPreDelay: true })],
  ['thunder-far', 9.0, (c, m) => S.thunder(c, m.buses.weather.input, 0.02, { distanceKm: 4.5, skipPreDelay: true })],
  ['rain-light', 6.0, (c, m) => { const r = S.createRainBed(c, m.buses.weather.input); r.set(0.3, 0.5, 0.001) }, { steady: true, quietOk: true, lowOk: true, bedLevel: -21 }],
  ['rain-storm', 6.0, (c, m) => { const r = S.createRainBed(c, m.buses.weather.input); r.set(1.0, 0.6, 0.001) }, { steady: true, quietOk: true, lowOk: true, bedLevel: -21 }],
  ['wind-calm', 6.0, (c, m) => { const w = S.createWindBed(c, m.buses.weather.input); w.set(0.2, 0.001) }, { steady: true, quietOk: true, brightOk: true, bedLevel: -21 }],
  ['wind-storm', 8.0, (c, m) => { const w = S.createWindBed(c, m.buses.weather.input); w.set(1.0, 0.001) }, { steady: true, quietOk: true, brightOk: true, bedLevel: -21 }],

  // --- sea ---
  ['sea-becalmed', 8.0, (c, m) => { const s = S.createSeaBed(c, m.buses.sea.input); s.set({ speed: 0, waveHeight: 0.2 }, 0.001) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['sea-cruise', 8.0, (c, m) => {
    const s = S.createSeaBed(c, m.buses.sea.input)
    s.set({ speed: 0.8, waveHeight: 0.5 }, 0.001)
    for (let i = 0; i < 7; i++) s.slap(0.35 + (i % 3) * 0.2, 0.4 + i * 1.05)
  }, { steady: true, quietOk: true, subOk: true, bedLevel: -21 }],
  ['sea-heavy', 8.0, (c, m) => {
    const s = S.createSeaBed(c, m.buses.sea.input)
    s.set({ speed: 0.65, waveHeight: 1.0 }, 0.001)
    for (let i = 0; i < 9; i++) s.slap(0.7 + (i % 2) * 0.3, 0.3 + i * 0.82)
  }, { steady: true, quietOk: true, subOk: true, bedLevel: -21 }],
  ['sea-slap-single', 1.6, (c, m) => { const s = S.createSeaBed(c, m.buses.sea.input); s.set({ speed: 0, waveHeight: 0 }, 0.001); s.slap(0.95, 0.05) }],

  // --- engine states ---
  ['engine-start', 6.0, (c, m) => { const e = S.createEngine(c, m.buses.engine.input); e.start(0.05); e.set(0.06, 0.06, 0.4) }],
  ['engine-idle', 6.0, (c, m) => { const e = S.createEngine(c, m.buses.engine.input); e.start(0, { crank: false }); e.set(0.0, 0.0, 0.001) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['engine-low', 6.0, (c, m) => { const e = S.createEngine(c, m.buses.engine.input); e.start(0, { crank: false }); e.set(0.3, 0.3, 0.001) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['engine-cruise', 6.0, (c, m) => { const e = S.createEngine(c, m.buses.engine.input); e.start(0, { crank: false }); e.set(0.65, 0.65, 0.001) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['engine-full', 6.0, (c, m) => { const e = S.createEngine(c, m.buses.engine.input); e.start(0, { crank: false }); e.set(1.0, 1.0, 0.001) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['engine-strain', 6.0, (c, m) => { const e = S.createEngine(c, m.buses.engine.input); e.start(0, { crank: false }); e.set(0.35, 1.0, 0.001) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['engine-cavitation', 4.0, (c, m) => {
    const e = S.createEngine(c, m.buses.engine.input)
    e.start(0, { crank: false }); e.set(0.8, 1.0, 0.001)
    e.cavitate(0.8, 0.8); e.cavitate(0.6, 2.0); e.cavitate(0.9, 2.9)
  }],
  ['engine-shutdown', 5.0, (c, m) => {
    const e = S.createEngine(c, m.buses.engine.input)
    e.start(0, { crank: false }); e.set(0.4, 0.4, 0.001)
    e.shutdown(1.2)
  }],

  // --- reverb spaces, same source ---
  ['space-open', 4.0, (c, m) => { m.reverb.set(S.REVERB_SPACES.open, 0.001); S.gunShot(c, m.buses.weapon.input, 0.05, { weaponClass: 'deckgun', distance: 8 }) }],
  ['space-harbour', 4.0, (c, m) => { m.reverb.set(S.REVERB_SPACES.harbour, 0.001); S.gunShot(c, m.buses.weapon.input, 0.05, { weaponClass: 'deckgun', distance: 8 }) }],
  ['space-interior', 4.0, (c, m) => { m.reverb.set(S.REVERB_SPACES.interior, 0.001); S.gunShot(c, m.buses.weapon.input, 0.05, { weaponClass: 'deckgun', distance: 8 }) }],

  // --- music ---
  ['music-tension', 10.0, (c, m) => { const b = S.createMusicBed(c, m.buses.music.input); b.set('tension', 0.02) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['music-combat', 10.0, (c, m) => { const b = S.createMusicBed(c, m.buses.music.input); b.set('combat', 0.02) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }],
  ['music-transition', 14.0, (c, m) => {
    const b = S.createMusicBed(c, m.buses.music.input)
    b.set('tension', 0.02)
    // Offline contexts have no wall clock, so schedule the change via suspend.
    if (c.suspend) {
      c.suspend(5).then(() => { b.set('combat', 1.2); c.resume() })
      c.suspend(10).then(() => { b.set('calm', 2.5); c.resume() })
    }
  }],

  // --- mix behaviour ---
  ['mix-gun-over-engine', 4.0, (c, m) => {
    const e = S.createEngine(c, m.buses.engine.input)
    e.start(0, { crank: false }); e.set(0.95, 1.0, 0.001)
    const s = S.createSeaBed(c, m.buses.sea.input)
    s.set({ speed: 0.9, waveHeight: 0.6 }, 0.001)
    for (let i = 0; i < 5; i++) S.gunShot(c, m.buses.weapon.input, 0.8 + i * 0.55, { weaponClass: 'deckgun', distance: 8 })
  }],
  ['mix-full-combat', 6.0, (c, m) => {
    const e = S.createEngine(c, m.buses.engine.input)
    e.start(0, { crank: false }); e.set(0.85, 1.0, 0.001)
    const s = S.createSeaBed(c, m.buses.sea.input)
    s.set({ speed: 0.8, waveHeight: 0.8 }, 0.001)
    const w = S.createWindBed(c, m.buses.weather.input); w.set(0.8, 0.001)
    const r = S.createRainBed(c, m.buses.weather.input); r.set(0.8, 0.5, 0.001)
    for (let i = 0; i < 14; i++) S.gunShot(c, m.buses.weapon.input, 0.4 + i * 0.29, { weaponClass: 'autocannon', distance: 8 })
    S.explosion(c, m.buses.impact.input, 2.2, { size: 1.3, medium: 'hull' })
    S.explosion(c, m.buses.impact.input, 4.1, { size: 0.9, medium: 'water', distance: 120 })
    S.thunder(c, m.buses.weather.input, 3.0, { distanceKm: 0.6, skipPreDelay: true })
  }],

  // --- mechanical / UI ---
  ['dock-mooring', 3.0, (c, m) => {
    S.winchRatchet(c, m.buses.ui.input, 0.05, { steps: 6, level: 0.5 })
    S.chainRattle(c, m.buses.ui.input, 0.35, { count: 7, level: 0.45 })
    S.metalClank(c, m.buses.ui.input, 0.85, { freq: 520, level: 0.8 })
    S.metalClank(c, m.buses.ui.input, 1.5, { freq: 330, level: 0.5 })
  }],
  ['footsteps', 3.0, (c, m) => {
    for (let i = 0; i < 6; i++) {
      S.footstep(c, m.buses.ui.input, 0.1 + i * 0.42, { surface: i < 3 ? 'stone' : 'grass', running: false })
    }
  }],
  ['sonar-ping', 4.0, (c, m) => S.sonarPing(c, m.buses.ui.input, 0.05, { index: 0 }), { lowOk: true, quietOk: true }],
  ['ui-chime', 2.0, (c, m) => S.uiChime(c, m.buses.ui.input, 0.05, { notes: [523, 659, 784, 1047], level: 0.5 }), { lowOk: true, quietOk: true }],
  ['drone-buzz', 5.0, (c, m) => { const d = S.createDroneBuzz(c, m.buses.ui.input); d.set(2) }, { steady: true, quietOk: true, brightOk: true, subOk: true, bedLevel: -21 }]
]

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function render(index) {
  const [name, seconds, build, opts = {}] = CASES[index]
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * seconds), SR)
  S.seedRandom(1337 + index)
  const master = S.createMaster(ctx, ctx.destination)
  build(ctx, master)
  const raw = await ctx.startRendering()
  const buf = trimLead(raw, ctx)
  const st = analyse(buf)
  const canvas = draw(name, buf, st, opts)
  return {
    name,
    faults: checkFaults(st, opts),
    png: canvas.toDataURL('image/png').split(',')[1],
    wav: wavBase64(buf),
    stats: {
      peakDb: +st.peakDb.toFixed(2), rmsDb: +st.rmsDb.toFixed(2), crest: +st.crest.toFixed(2),
      clipped: st.clipped, maxStep: +st.maxStep.toFixed(4), maxStepAt: +st.maxStepAt.toFixed(3),
      attackMs: st.attackMs, decayMs: st.decayMs, corr: +st.corr.toFixed(3),
      clickScore: +st.clickScore.toFixed(1), clickAt: +st.clickAt.toFixed(3),
      peakDelayMs: st.peakDelayMs, atkBands: st.atkBandPct.map((b) => +b.toFixed(1)),
      centroid: Math.round(st.centroid), bands: st.bandPct.map((b) => +b.toFixed(1))
    }
  }
}

window.__probe = {
  ready: true,
  names: CASES.map((c) => c[0]),
  render
}
