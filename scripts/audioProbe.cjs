#!/usr/bin/env node
/**
 * Offline audio QA harness.
 *
 * Renders every SFX and every layered bed state through the game's real master
 * chain inside an OfflineAudioContext, and writes a WAV plus a waveform +
 * log-frequency spectrogram PNG for each. Nothing is ever routed to an output
 * device: an OfflineAudioContext has no speaker, and the window is launched
 * muted as well. This is how audio work gets graded — by looking at the plots,
 * not by claiming a sound is good.
 *
 *   npx electron scripts/audioProbe.cjs
 *   npx electron scripts/audioProbe.cjs --only=engine
 *   npx electron scripts/audioProbe.cjs --out=/abs/dir --list
 *
 * Serves the repo over loopback on an ephemeral port so the page can import
 * src/renderer/audioSynth.js as a real ES module (file:// module imports are
 * blocked by CORS). No dev server and no build step required.
 */

const { app, BrowserWindow } = require('electron')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

// This tool must never make a sound. The renders are offline, and the window is
// muted on top of that.
app.commandLine.appendSwitch('mute-audio')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')

const ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const out = {}
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (m) out[m[1]] = m[2] === undefined ? 'true' : m[2]
  }
  return out
}
const args = parseArgs(process.argv.slice(2))
const outDir = path.resolve(args.out || path.join(ROOT, 'qa-shots', 'audio'))
const only = args.only ? String(args.only) : null

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.html': 'text/html', '.json': 'application/json'
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>audio probe</title>
<body style="background:#0b0d12"><script type="module" src="/scripts/audioProbe.mjs"></script>`

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/' || url.pathname === '/probe.html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(PAGE)
    return
  }
  // Loopback-only dev server; still refuse to walk out of the repo.
  const file = path.join(ROOT, path.normalize(url.pathname).replace(/^([/\\])+/, ''))
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

let code = 0
function finish(c, msg) {
  if (msg) console[c === 0 ? 'log' : 'error'](msg)
  code = c
  try { server.close() } catch { /* */ }
  app.exit(c)
}

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port

  const win = new BrowserWindow({
    width: 900, height: 600, show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error(`[probe] ${message}`)
  })

  try {
    await win.loadURL(`http://127.0.0.1:${port}/probe.html`)
    await win.webContents.executeJavaScript(
      `new Promise((res, rej) => {
         const t0 = Date.now()
         const tick = () => {
           if (window.__probe && window.__probe.ready) return res(true)
           if (Date.now() - t0 > 20000) return rej(new Error('probe module never loaded — check the console above'))
           setTimeout(tick, 60)
         }
         tick()
       })`, true)

    const names = await win.webContents.executeJavaScript('window.__probe.names', true)
    if (args.list) {
      console.log(names.join('\n'))
      return finish(0)
    }
    fs.mkdirSync(outDir, { recursive: true })

    const rows = []
    for (let i = 0; i < names.length; i++) {
      if (only && !names[i].includes(only)) continue
      const r = await win.webContents.executeJavaScript(`window.__probe.render(${i})`, true)
      fs.writeFileSync(path.join(outDir, `${r.name}.png`), Buffer.from(r.png, 'base64'))
      fs.writeFileSync(path.join(outDir, `${r.name}.wav`), Buffer.from(r.wav, 'base64'))
      rows.push({ name: r.name, ...r.stats })
      const s = r.stats
      const faults = r.faults || []
      console.log(
        `${r.name.padEnd(24)} peak ${String(s.peakDb).padStart(7)}  rms ${String(s.rmsDb).padStart(7)}` +
        `  crest ${String(s.crest).padStart(5)}  atk ${String(s.attackMs).padStart(4)}ms` +
        `  corr ${String(s.corr).padStart(6)}  clk ${String(s.clickScore).padStart(5)}  bands ${s.bands.join('/')}` +
        (faults.length ? `  << ${faults.join(' ')}` : '')
      )
    }
    fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(rows, null, 2))
    finish(0, `\naudioProbe: wrote ${rows.length} case(s) to ${outDir}`)
  } catch (err) {
    finish(1, `audioProbe: ${err && err.message ? err.message : err}`)
  }
})

app.on('window-all-closed', () => finish(code, null))
