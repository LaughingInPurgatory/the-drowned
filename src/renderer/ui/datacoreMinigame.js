/**
 * Datacore nodule hack minigame — stop the moving cursor in the green zone.
 */
import { resolveDatacoreHack } from '../game/systemScan.js'
import { escapeHtml } from './escapeHtml.js'

const STYLE = `
#datacore-hack {
  position: fixed; inset: 0; z-index: 60; display: none;
  align-items: center; justify-content: center;
  background: rgba(4,8,16,0.75); font-family: monospace; color: var(--ui-text);
}
#datacore-hack.visible { display: flex; }
#datacore-hack .dh-panel {
  width: 420px; padding: 18px 20px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.96), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.92));
  border: 1px solid rgba(201,160,255,0.5); border-left: 3px solid #c9a0ff;
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#datacore-hack h2 {
  margin: 0 0 6px; font-weight: normal; letter-spacing: 2px; font-size: 15px; color: #e0c0ff;
}
#datacore-hack .dh-sub { font-size: 11px; opacity: 0.65; margin-bottom: 14px; }
#datacore-hack .dh-track {
  position: relative; height: 28px; background: #0c1424;
  border: 1px solid #3a2a55; margin: 12px 0 16px; overflow: hidden;
}
#datacore-hack .dh-window {
  position: absolute; top: 0; bottom: 0;
  background: rgba(127,224,160,0.35); border: 1px solid rgba(127,224,160,0.7);
}
#datacore-hack .dh-cursor {
  position: absolute; top: 0; bottom: 0; width: 3px;
  background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.9); left: 0%;
}
#datacore-hack .dh-actions { display: flex; gap: 8px; }
#datacore-hack button {
  flex: 1; font-family: monospace; padding: 10px; cursor: pointer; letter-spacing: 1px;
  background: rgba(201,160,255,0.12); border: 1px solid rgba(201,160,255,0.5); color: #e0c0ff;
}
#datacore-hack button.primary {
  background: rgba(127,224,160,0.15); border-color: rgba(127,224,160,0.55); color: #bdf5cf;
}
#datacore-hack .dh-result { min-height: 1.2em; font-size: 12px; margin-top: 10px; }
#datacore-hack .dh-result.ok { color: #7fe0a0; }
#datacore-hack .dh-result.bad { color: #ff8a7a; }
`

/**
 * @param {HTMLElement} container
 */
export function createDatacoreMinigame(container) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'datacore-hack'
  root.innerHTML = `
    <div class="dh-panel">
      <h2>Datacore Nodule</h2>
      <div class="dh-sub">Lock the signal — stop the cursor in the green band</div>
      <div class="dh-track">
        <div class="dh-window"></div>
        <div class="dh-cursor"></div>
      </div>
      <div class="dh-actions">
        <button type="button" class="primary dh-lock">Lock Signal</button>
        <button type="button" class="dh-abort">Abort</button>
      </div>
      <div class="dh-result"></div>
    </div>
  `
  container.appendChild(root)

  const track = root.querySelector('.dh-track')
  const winEl = root.querySelector('.dh-window')
  const curEl = root.querySelector('.dh-cursor')
  const resultEl = root.querySelector('.dh-result')

  let open = false
  let raf = 0
  let t0 = 0
  let pos = 0
  let dir = 1
  let speed = 0.55
  let windowCenter = 0.5
  let windowHalf = 0.11
  let resolved = false
  let onDone = null

  function layoutWindow() {
    const left = (windowCenter - windowHalf) * 100
    const width = windowHalf * 2 * 100
    winEl.style.left = `${left}%`
    winEl.style.width = `${width}%`
  }

  function tick(now) {
    if (!open || resolved) return
    const dt = Math.min(0.05, (now - t0) / 1000 || 0.016)
    t0 = now
    pos += dir * speed * dt
    if (pos >= 1) {
      pos = 1
      dir = -1
    } else if (pos <= 0) {
      pos = 0
      dir = 1
    }
    curEl.style.left = `${pos * 100}%`
    raf = requestAnimationFrame(tick)
  }

  function finish(success) {
    if (resolved) return
    resolved = true
    cancelAnimationFrame(raf)
    resultEl.className = `dh-result ${success ? 'ok' : 'bad'}`
    resultEl.textContent = success
      ? 'Access granted — nodule unlocked'
      : 'Lock failed — nodule overload!'
    setTimeout(() => {
      hide()
      onDone?.({ success })
    }, 700)
  }

  root.querySelector('.dh-lock').addEventListener('click', () => {
    if (resolved) return
    const { success } = resolveDatacoreHack(pos, windowCenter, windowHalf)
    finish(success)
  })
  root.querySelector('.dh-abort').addEventListener('click', () => {
    if (resolved) return
    resolved = true
    cancelAnimationFrame(raf)
    hide()
    onDone?.({ success: false, aborted: true })
  })

  // Space also locks
  function onKey(e) {
    if (!open || resolved) return
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      root.querySelector('.dh-lock').click()
    }
  }

  function show({ noduleName = 'Nodule', onComplete } = {}) {
    onDone = onComplete
    open = true
    resolved = false
    pos = Math.random()
    dir = Math.random() < 0.5 ? 1 : -1
    speed = 0.48 + Math.random() * 0.35
    windowCenter = 0.28 + Math.random() * 0.44
    windowHalf = 0.09 + Math.random() * 0.05
    layoutWindow()
    resultEl.textContent = ''
    resultEl.className = 'dh-result'
    root.querySelector('.dh-sub').textContent =
      `${escapeHtml(noduleName)} — stop the cursor in the green band (Space / Lock)`
    root.classList.add('visible')
    window.addEventListener('keydown', onKey)
    t0 = performance.now()
    raf = requestAnimationFrame(tick)
  }

  function hide() {
    open = false
    root.classList.remove('visible')
    cancelAnimationFrame(raf)
    window.removeEventListener('keydown', onKey)
  }

  return { show, hide, isOpen: () => open, element: root }
}
