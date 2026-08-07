#!/usr/bin/env node
/**
 * Offscreen screenshot tool for visual QA.
 *
 * Loads the renderer in a hidden Electron window against the running Vite dev
 * server, waits for the `?shot=` harness (src/renderer/devShots.js) to report
 * ready, and writes a PNG. Each invocation is its own process and its own
 * window, so any number of agents can grade their own work in parallel without
 * fighting over one shared browser tab.
 *
 *   npx electron scripts/shot.cjs --shot=open --hour=13 --out=/tmp/noon.png
 *
 * Flags mirror the harness query params: --shot --hour --weather --settle --hud
 * plus --out (required), --w / --h (default 1600x900) and --port (default 5174).
 */

const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

/**
 * Minimal RGBA -> PNG encoder.
 *
 * Neither of the obvious routes works here. `capturePage()` composites the
 * window, and a window that is hidden (or transparent enough to stay out of the
 * way) composites to black. `canvas.toDataURL()` unpremultiplies against a
 * drawing buffer whose alpha channel is zero, which blows every colour out into
 * a pastel wash. Reading the GL buffer back and writing the file here sidesteps
 * both: the bytes that reach disk are the bytes the GPU produced.
 */
function encodePng(rgba, width, height) {
  // PNG wants a filter byte per scanline; 0 (None) keeps this simple and zlib
  // still compresses the result fine.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    // WebGPU's readRenderTargetPixelsAsync hands back rows top-down already,
    // which is the order PNG wants. (The WebGL path used to read bottom-up and
    // needed a flip here — reinstating that now renders every shot upside down.)
    const src = y * stride
    const dst = y * (stride + 1)
    raw[dst] = 0
    rgba.copy(raw, dst + 1, src, src + stride)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0, 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ -1
}

// Software-GL fallbacks off; we want the real pipeline. Hidden windows still
// throttle rAF on some platforms, so disable that explicitly.
// Screenshots grade the picture, never the soundtrack, and a dozen agents each
// booting the game to grab a frame otherwise means a dozen overlapping copies
// of the music playing out of the machine's speakers.
app.commandLine.appendSwitch('mute-audio')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (m) out[m[1]] = m[2] === undefined ? 'true' : m[2]
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const outPath = args.out
if (!outPath) {
  console.error('shot.cjs: --out=<file.png> is required')
  process.exit(2)
}

const port = args.port || '5174'
const width = Number(args.w || 1600)
const height = Number(args.h || 900)
const timeoutMs = Number(args.timeout || 60000)

const query = new URLSearchParams()
query.set('shot', args.shot || 'open')
if (args.hour !== undefined) query.set('hour', args.hour)
if (args.weather !== undefined) query.set('weather', args.weather)
if (args.settle !== undefined) query.set('settle', args.settle)
// Screenshots default to no HUD — this tool grades the render, not the overlay.
query.set('hud', args.hud === undefined ? '0' : args.hud)
// `--url=` points the harness at something other than the dev server — chiefly
// the built bundle under `out/`, via a file:// URL. Worth having: the dev
// server and the production build are different module graphs, and a renderer
// that works under Vite can still fail once rolled up and minified. The query
// string is appended either way so the `?shot=` harness still arms.
const url = args.url
  ? `${args.url}${args.url.includes('?') ? '&' : '?'}${query}`
  : `http://localhost:${port}/?${query}`

let done = false
function finish(code, msg) {
  if (done) return
  done = true
  if (msg) console[code === 0 ? 'log' : 'error'](msg)
  app.exit(code)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    // Stays hidden: the frame is read back out of the GL buffer, not composited
    // off the window, so nothing has to be on screen. That matters when a dozen
    // agents are grabbing shots at once.
    show: false,
    // Match the canvas to the requested pixels exactly.
    useContentSize: true,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const failTimer = setTimeout(
    () => finish(1, `shot.cjs: timed out after ${timeoutMs}ms waiting for ${url}`),
    timeoutMs
  )

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    clearTimeout(failTimer)
    finish(1, `shot.cjs: load failed (${code}) ${desc} — is the dev server up on :${port}?`)
  })

  // Surface renderer errors; a black frame with a stack trace in the log is far
  // easier to diagnose than a black frame alone.
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`)
  })

  try {
    await win.loadURL(url)
    // The harness flips this once the game has started, the clock and weather
    // are pinned, and the settle window has elapsed.
    await win.webContents.executeJavaScript(
      `new Promise((resolve, reject) => {
         const started = Date.now()
         const tick = () => {
           if (window.__shot && window.__shot.ready) return resolve(true)
           if (Date.now() - started > ${timeoutMs - 5000}) return reject(new Error('harness never became ready'))
           setTimeout(tick, 150)
         }
         tick()
       })`,
      true
    )
    // One more beat so the frame after the overlay strip has been presented.
    await new Promise((r) => setTimeout(r, 400))
    const shot = await win.webContents.executeJavaScript('window.__shot.capture()', true)
    const rgba = Buffer.from(shot.b64, 'base64')
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
    fs.writeFileSync(outPath, encodePng(rgba, shot.width, shot.height))
    clearTimeout(failTimer)
    finish(0, `shot.cjs: wrote ${outPath} (${width}x${height}) from ${url}`)
  } catch (err) {
    clearTimeout(failTimer)
    finish(1, `shot.cjs: ${err && err.message ? err.message : err}`)
  }
})

app.on('window-all-closed', () => finish(1, 'shot.cjs: window closed before capture'))
