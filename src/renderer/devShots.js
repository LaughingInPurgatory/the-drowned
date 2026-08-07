/**
 * Dev-only screenshot harness. Not wired into a shipping build path — it only
 * installs when the page is loaded with `?shot`.
 *
 * Visual work on this game is graded by looking at it, and "look at it" needs
 * the same frame every time or two screenshots are not comparable. This gives
 * the visual-QA loop a URL it can navigate to: skip the menu, start a game,
 * pin the clock and the weather, park the boat somewhere known.
 *
 *   http://localhost:5174/?shot=open&hour=13
 *   http://localhost:5174/?shot=harbour&hour=19&weather=storm
 *
 * Presets (`shot=`):
 *   menu      title screen (no game)
 *   berth     new game, tied up at Port Haven
 *   open      undocked, out in open water
 *   island    undocked, parked off the nearest island
 *   foot      on-foot, ashore
 *
 * `hour` is 0–24 game clock. `weather` is `clear` or `storm`.
 */

import { DAY_LENGTH_S } from './render/sky.js'

/**
 * True when the page was loaded for a screenshot. `scene.js` reads this to turn
 * on `preserveDrawingBuffer`, which is what lets the capture tool read the
 * canvas back directly — an offscreen Electron window composites to black, so
 * `capturePage()` is not an option. It costs a frame copy, so it stays off for
 * every normal run.
 */
export const SHOT_MODE =
  typeof location !== 'undefined' && new URLSearchParams(location.search).has('shot')

/** Inverse of sky.js `clockLabel`: game hour → the simTime that shows it. */
export function simTimeForHour(hour) {
  // clockLabel: phase = (t/DAY + 0.2) % 1 ; hours = (phase * 24 + 6) % 24
  const phase = (((hour - 6) / 24) % 1 + 1) % 1
  return (((phase - 0.2) % 1) + 1) % 1 * DAY_LENGTH_S
}

/**
 * A campaign time that lands inside a thunderstorm window. weather.js walks
 * fixed-length slots from t=0, so this is stable across runs; main.js feeds it
 * to the weather sim independently of the sky clock.
 */
export const STORM_WEATHER_T = 4750

export function shotParams() {
  const p = new URLSearchParams(location.search)
  if (!p.has('shot')) return null
  return {
    preset: p.get('shot') || 'open',
    hour: p.has('hour') ? Number(p.get('hour')) : null,
    weather: p.get('weather') || 'clear',
    // `hud=0` strips the DOM overlays so a shot grades the render alone.
    hud: p.get('hud') !== '0',
    // Seconds to settle (asset streaming, wave warm-up) before `__shot.ready`.
    settle: p.has('settle') ? Number(p.get('settle')) : 2.5
  }
}

/**
 * @param {object} api handles from main.js — see the call site there.
 * @returns {object|null} the control object, also parked on `window.__shot`.
 */
export function installShotHarness(api) {
  const params = shotParams()
  if (!params) return null

  const ctl = {
    params,
    ready: false,
    /** Set the game clock so the sky reads `hour` (0–24). */
    setHour(hour) {
      api.setSimTime(simTimeForHour(hour))
    },
    /** 'clear' | 'storm' — independent of the sky clock. */
    setWeather(kind) {
      api.setWeatherTime(kind === 'storm' ? STORM_WEATHER_T : null)
    },
    /** Move the hull in the XZ plane; the sea owns Y. */
    teleport(x, z) {
      api.teleport(x, z)
    },
    /** Point the boat at a compass heading in degrees. */
    heading(deg) {
      api.setHeading((deg * Math.PI) / 180)
    },
    undock: () => api.undock(),
    state: () => api.getState(),
    /**
     * Finished frame as base64 RGBA, bottom-up (GL order). `scripts/shot.cjs`
     * turns this into a PNG. Reading the canvas or the window instead gives a
     * black or colour-mangled frame on this stack — see scene.js captureFrame.
     */
    async capture() {
      // WebGPU readback is async (readRenderTargetPixelsAsync).
      const { width, height, pixels } = await api.captureFrame()
      // Nothing here is meant to be see-through; the buffer's alpha is simply
      // never written, and a zero alpha reads as a fully transparent PNG.
      for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255
      let s = ''
      const CHUNK = 0x8000
      for (let i = 0; i < pixels.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, pixels.subarray(i, i + CHUNK))
      }
      return { width, height, b64: btoa(s) }
    },
    /** Distance to the nearest island / port, for framing checks. */
    nearest: (kind) => api.nearest(kind)
  }

  window.__shot = ctl

  const run = async () => {
    if (params.preset !== 'menu') {
      api.hideMenu()
      api.startNewGame()
      await frames(4)
      if (params.hour != null) ctl.setHour(params.hour)
      ctl.setWeather(params.weather)
      if (params.preset !== 'berth') {
        ctl.undock()
        await sleep(1200) // undock animation hands the helm back
      }
      if (params.preset === 'open') {
        const p = api.getState().player.ship.position
        // Clear of the harbour clutter, still inside the lit part of the world.
        api.teleport(p[0] + 900, p[2] + 900)
        api.setHeading(Math.PI * 0.75)
        // Seed forward motion so wake / bow spray have a chance to appear in a
        // frozen frame. Visual QA cannot wait for player throttle.
        api.nudgeUnderway?.()
      } else if (params.preset === 'island') {
        const isle = api.nearest('island')
        if (isle) {
          api.teleport(isle.position[0] + 620, isle.position[2] + 620)
          api.setHeading(Math.PI * 1.25)
        }
      } else if (params.preset === 'foot') {
        api.goAshore()
      }
    } else if (params.hour != null) {
      api.setMenuHour(simTimeForHour(params.hour))
    }
    await sleep(params.settle * 1000)
    if (!params.hud) api.hideOverlays()
    ctl.ready = true
    document.documentElement.setAttribute('data-shot-ready', '1')
  }
  void run()

  return ctl
}

function frames(n) {
  return new Promise((resolve) => {
    let left = n
    const step = () => (left-- <= 0 ? resolve() : requestAnimationFrame(step))
    step()
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
