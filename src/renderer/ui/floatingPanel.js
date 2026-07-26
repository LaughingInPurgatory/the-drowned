/**
 * Shared move / resize / persist for floating game panels (Inventory, Galaxy Map, System Scan).
 */

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

/** Shared CSS for the bottom-right resize grip (scope with a parent selector). */
export function floatingResizeHandleCss(selector) {
  return `
${selector} {
  position: absolute;
  right: 2px; bottom: 2px;
  width: 18px; height: 18px;
  cursor: nwse-resize;
  touch-action: none;
  z-index: 5;
  background:
    linear-gradient(135deg, transparent 50%, rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.55) 50%, rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.55) 58%, transparent 58%),
    linear-gradient(135deg, transparent 68%, rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4) 68%, rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4) 76%, transparent 76%);
  opacity: 0.85;
}
${selector}:hover { opacity: 1; }
`
}

/**
 * Subtle depth under floating panels (filter drop-shadow, independent of box-shadow).
 * @param {string} selector CSS selector for the panel element
 */
export function floatingPanelElevationCss(selector) {
  return `
${selector} {
  filter:
    drop-shadow(0 3px 6px rgba(0,0,0,0.85))
    drop-shadow(0 10px 22px rgba(0,0,0,0.55));
}
`
}

/**
 * Default geometry helpers for ~60% viewport panels (maps) or compact side panels.
 * @param {{ fracW?: number, fracH?: number, maxW?: number, maxH?: number, minW?: number, minH?: number, align?: 'center'|'right' }} opts
 */
export function defaultPanelGeom(opts = {}) {
  const {
    fracW = 0.6,
    fracH = 0.6,
    maxW = 1100,
    maxH = 720,
    minW = 360,
    minH = 280,
    align = 'center'
  } = opts
  const w = clamp(Math.round(window.innerWidth * fracW), minW, Math.min(maxW, window.innerWidth - 24))
  const h = clamp(Math.round(window.innerHeight * fracH), minH, Math.min(maxH, window.innerHeight - 24))
  const left =
    align === 'right'
      ? Math.max(12, window.innerWidth - w - 28)
      : Math.max(12, Math.round((window.innerWidth - w) / 2))
  const top = Math.max(40, Math.round((window.innerHeight - h) / 2))
  return { w, h, left, top }
}

function loadGeom(storageKey, fallback, minW, minH) {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { ...fallback }
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return { ...fallback }
    const w = clamp(Number(o.w) || fallback.w, minW, window.innerWidth)
    const h = clamp(Number(o.h) || fallback.h, minH, window.innerHeight)
    let left = Number(o.left)
    let top = Number(o.top)
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return { w, h, left: fallback.left, top: fallback.top }
    }
    left = clamp(left, 0, Math.max(0, window.innerWidth - 80))
    top = clamp(top, 0, Math.max(0, window.innerHeight - 60))
    return { w, h, left, top }
  } catch {
    return { ...fallback }
  }
}

function saveGeom(storageKey, geom) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(geom))
  } catch {
    /* private mode */
  }
}

/**
 * Wire a fixed-position panel for drag-to-move (header) and resize (handle).
 *
 * @param {{
 *   panelEl: HTMLElement,
 *   headerEl: HTMLElement,
 *   resizeEl: HTMLElement,
 *   storageKey: string,
 *   defaultGeom: () => { w: number, h: number, left: number, top: number },
 *   minW?: number,
 *   minH?: number,
 *   isActive?: () => boolean,
 *   onGeomChange?: (geom: { w: number, h: number, left: number, top: number }) => void
 * }} opts
 */
export function wireFloatingPanel(opts) {
  const {
    panelEl,
    headerEl,
    resizeEl,
    storageKey,
    defaultGeom,
    minW = 320,
    minH = 240,
    isActive = () => true,
    onGeomChange
  } = opts

  let geom = loadGeom(storageKey, defaultGeom(), minW, minH)

  function applyGeom() {
    panelEl.style.position = 'fixed'
    panelEl.style.boxSizing = 'border-box'
    panelEl.style.width = `${Math.round(geom.w)}px`
    panelEl.style.height = `${Math.round(geom.h)}px`
    panelEl.style.left = `${Math.round(geom.left)}px`
    panelEl.style.top = `${Math.round(geom.top)}px`
    panelEl.style.right = 'auto'
    panelEl.style.bottom = 'auto'
    panelEl.style.maxWidth = '96vw'
    panelEl.style.maxHeight = '92vh'
    onGeomChange?.(geom)
  }

  function clampGeomOnScreen() {
    geom.w = clamp(geom.w, minW, window.innerWidth)
    geom.h = clamp(geom.h, minH, window.innerHeight)
    geom.left = clamp(geom.left, 0, Math.max(0, window.innerWidth - 80))
    geom.top = clamp(geom.top, 0, Math.max(0, window.innerHeight - 60))
    if (geom.left + geom.w < 80) geom.left = 80 - geom.w
    if (geom.top + 40 > window.innerHeight) geom.top = window.innerHeight - 40
    applyGeom()
  }

  function captureGeomFromDom() {
    const r = panelEl.getBoundingClientRect()
    geom = {
      w: clamp(r.width, minW, window.innerWidth),
      h: clamp(r.height, minH, window.innerHeight),
      left: clamp(r.left, 0, Math.max(0, window.innerWidth - 80)),
      top: clamp(r.top, 0, Math.max(0, window.innerHeight - 60))
    }
    applyGeom()
    saveGeom(storageKey, geom)
  }

  function restore() {
    geom = loadGeom(storageKey, defaultGeom(), minW, minH)
    clampGeomOnScreen()
  }

  applyGeom()

  const onWinResize = () => {
    if (!isActive()) return
    clampGeomOnScreen()
    saveGeom(storageKey, geom)
  }
  window.addEventListener('resize', onWinResize)

  headerEl.style.cursor = 'grab'
  headerEl.style.userSelect = 'none'
  headerEl.style.touchAction = 'none'

  headerEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (e.target.closest('button, a, input, select, textarea, label')) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const origLeft = geom.left
    const origTop = geom.top
    headerEl.classList.add('dragging')
    headerEl.style.cursor = 'grabbing'
    headerEl.setPointerCapture(e.pointerId)

    function onMove(ev) {
      geom.left = origLeft + (ev.clientX - startX)
      geom.top = origTop + (ev.clientY - startY)
      clampGeomOnScreen()
    }
    function onUp(ev) {
      headerEl.classList.remove('dragging')
      headerEl.style.cursor = 'grab'
      try {
        headerEl.releasePointerCapture(ev.pointerId)
      } catch {
        /* */
      }
      headerEl.removeEventListener('pointermove', onMove)
      headerEl.removeEventListener('pointerup', onUp)
      headerEl.removeEventListener('pointercancel', onUp)
      captureGeomFromDom()
    }
    headerEl.addEventListener('pointermove', onMove)
    headerEl.addEventListener('pointerup', onUp)
    headerEl.addEventListener('pointercancel', onUp)
  })

  resizeEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const origW = geom.w
    const origH = geom.h
    resizeEl.setPointerCapture(e.pointerId)

    function onMove(ev) {
      geom.w = origW + (ev.clientX - startX)
      geom.h = origH + (ev.clientY - startY)
      clampGeomOnScreen()
    }
    function onUp(ev) {
      try {
        resizeEl.releasePointerCapture(ev.pointerId)
      } catch {
        /* */
      }
      resizeEl.removeEventListener('pointermove', onMove)
      resizeEl.removeEventListener('pointerup', onUp)
      resizeEl.removeEventListener('pointercancel', onUp)
      captureGeomFromDom()
    }
    resizeEl.addEventListener('pointermove', onMove)
    resizeEl.addEventListener('pointerup', onUp)
    resizeEl.addEventListener('pointercancel', onUp)
  })

  return {
    restore,
    apply: applyGeom,
    getGeom: () => ({ ...geom }),
    dispose() {
      window.removeEventListener('resize', onWinResize)
    }
  }
}
