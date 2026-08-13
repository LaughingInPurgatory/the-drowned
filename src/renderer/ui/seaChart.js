import { getWorld, WORLD_RADIUS, remoteness } from '../procgen/world.js'
import { missionMarkedBodyIds } from '../game/missions.js'
import { playerAssetBodyIds } from '../game/economy.js'
import { escapeHtml } from './escapeHtml.js'
import { getIslandProfile } from '../render/islandMesh.js'
import {
  floatingResizeHandleCss,
  floatingPanelElevationCss,
  defaultPanelGeom,
  wireFloatingPanel
} from './floatingPanel.js'

/**
 * The sea chart.
 *
 * The sea chart is a plan view of the whole world while aboard. On foot it
 * switches to a local plan of the current island so the player can navigate
 * terrain and nearby facilities without zooming the entire ocean down to a
 * postage stamp.
 */

const STYLE = `
#sea-chart {
  position: fixed; inset: 0; display: none; z-index: 44;
  pointer-events: none; font-family: monospace;
}
#sea-chart.open { display: block; }
#sea-chart .sc-panel {
  position: fixed; display: flex; flex-direction: column; pointer-events: auto;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.96), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.92));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  color: var(--ui-text); overflow: hidden;
}
${floatingPanelElevationCss('#sea-chart .sc-panel')}
#sea-chart .sc-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 14px; cursor: move; user-select: none;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3);
  background: repeating-linear-gradient(108deg, transparent 0 17px, rgba(255,230,200,0.025) 17px 18px, transparent 18px 41px);
}
#sea-chart .sc-title { font-size: 15px; letter-spacing: 2px; color: var(--ui-accent); }
#sea-chart .sc-sub { font-size: 11px; opacity: 0.65; letter-spacing: 0.5px; }
#sea-chart .sc-close {
  display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5);
  color: #ffb3b3; font-family: monospace; font-size: 18px; line-height: 1; cursor: pointer;
}
#sea-chart .sc-close:hover { background: rgba(224,90,90,0.24); }
#sea-chart .sc-body { flex: 1; display: flex; min-height: 0; }
#sea-chart canvas { flex: 1; display: block; cursor: crosshair; min-width: 0; }
#sea-chart .sc-side {
  width: 220px; border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3);
  padding: 10px 12px; overflow-y: auto; font-size: 11px; line-height: 1.5;
  background: linear-gradient(180deg, rgba(0,0,0,0.2), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.35));
}
#sea-chart .sc-side h4 {
  margin: 0 0 6px 0; font-size: 11px; letter-spacing: 1.5px; color: var(--ui-accent); font-weight: normal;
}
#sea-chart .sc-sel { margin-bottom: 12px; }
#sea-chart .sc-sel .name { color: var(--ui-text); font-size: 13px; }
#sea-chart .sc-sel .meta { opacity: 0.7; }
#sea-chart .sc-wp {
  width: 100%; margin-top: 8px; padding: 6px; cursor: pointer; font-family: monospace; font-size: 11px;
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.16);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5); color: var(--ui-text);
}
#sea-chart .sc-wp:hover { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3); }
#sea-chart .sc-wp[disabled] { opacity: 0.35; cursor: default; }
#sea-chart .sc-key div { display: flex; align-items: center; gap: 7px; opacity: 0.8; }
#sea-chart .sc-key i { width: 9px; height: 9px; display: inline-block; border-radius: 50%; }
#sea-chart .sc-hint { margin-top: 10px; opacity: 0.5; font-size: 10px; line-height: 1.5; }
${floatingResizeHandleCss('#sea-chart .sc-resize')}
`

/** Chart colours. Kept in step with the radar so one reads as the other. */
const KIND_COLOR = {
  port: '#4aa8ff',
  outpost: '#7fd4ff',
  island: '#5ee08a',
  wreckField: '#b5763a'
}
const KIND_LABEL = {
  port: 'Harbour',
  outpost: 'Outpost',
  island: 'Island',
  wreckField: 'Wreck field'
}

const MIN_ZOOM = 0.55
const MAX_ZOOM = 26

export function createSeaChart(container, gameState, hooks = {}) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'sea-chart'
  root.innerHTML = `
    <div class="sc-panel">
      <div class="sc-header">
        <div>
          <div class="sc-title">SEA CHART</div>
          <div class="sc-sub">North-up · opens on you · drag to pan · scroll to zoom · click a mark for a waypoint</div>
        </div>
        <button type="button" class="sc-close" aria-label="Close sea chart" title="Close sea chart">×</button>
      </div>
      <div class="sc-body">
        <canvas></canvas>
        <div class="sc-side">
          <div class="sc-sel"><h4>SELECTED</h4><div class="sc-sel-body">Nothing selected.</div></div>
          <h4>KEY</h4>
          <div class="sc-key">
            <div><i style="background:${KIND_COLOR.port}"></i> Harbour</div>
            <div><i style="background:${KIND_COLOR.outpost}"></i> Outpost</div>
            <div><i style="background:${KIND_COLOR.island}"></i> Island</div>
            <div><i style="background:${KIND_COLOR.wreckField}"></i> Wreck field</div>
            <div><i style="background:#ff8a3d"></i> Contract</div>
            <div><i style="background:#c9a227"></i> Your goods</div>
            <div><i style="background:#7fe0a0"></i> Waypoint</div>
            <div><i style="background:#ffe14a; box-shadow:0 0 6px #ffe14a; border-radius:2px"></i> You (heading)</div>
          </div>
          <div class="sc-hint">Faint marks are places you have not been to yet.<br/>Double-click the chart to recentre on you.</div>
        </div>
      </div>
      <div class="sc-resize"></div>
    </div>`
  container.appendChild(root)

  const panel = root.querySelector('.sc-panel')
  const header = root.querySelector('.sc-header')
  const titleEl = root.querySelector('.sc-title')
  const subEl = root.querySelector('.sc-sub')
  const canvas = root.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const selBody = root.querySelector('.sc-sel-body')

  // Declared before wireFloatingPanel: it applies the stored geometry during
  // construction, which calls back into resize() → draw() straight away.
  let open = false
  let zoom = 1.6
  // Chart centre in world units.
  let centreX = 0
  let centreZ = 0
  let selected = null
  let localIslandId = null
  const drag = { active: false, x: 0, y: 0, moved: 0 }

  wireFloatingPanel({
    panelEl: panel,
    headerEl: header,
    resizeEl: root.querySelector('.sc-resize'),
    storageKey: 'seaChartGeom',
    defaultGeom: () => defaultPanelGeom({ fracW: 0.68, fracH: 0.72, maxW: 1180, maxH: 820 }),
    minW: 520,
    minH: 360,
    isActive: () => root.classList.contains('open'),
    onGeomChange: () => resize()
  })

  function resize() {
    const rect = canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }

  /** World units per chart pixel at the current zoom. */
  function scale() {
    const rect = canvas.getBoundingClientRect()
    const span = Math.min(rect.width, rect.height)
    const island = localIsland()
    const mapSpan = island
      ? Math.max(320, (Number(island.radius) || 400) * 2.55)
      : WORLD_RADIUS * 2
    return span > 0 ? (span * 0.92 * zoom) / mapSpan : 1
  }

  function worldToScreen(x, z) {
    const rect = canvas.getBoundingClientRect()
    const k = scale()
    // North-up: +Z is north (up). +X is west in this world (port when the bow
    // is north), so X is mirrored to keep west on the left and east on the right.
    return [rect.width / 2 - (x - centreX) * k, rect.height / 2 - (z - centreZ) * k]
  }

  function screenToWorld(px, py) {
    const rect = canvas.getBoundingClientRect()
    const k = scale()
    return [centreX - (px - rect.width / 2) / k, centreZ - (py - rect.height / 2) / k]
  }

  function bodies() {
    return getWorld(gameState.galaxy)?.bodies ?? []
  }

  function localIsland() {
    if (!localIslandId) return null
    return bodies().find((body) => body.id === localIslandId && body.kind === 'island') ?? null
  }

  function playerPosition() {
    return gameState.player?.onFoot?.active
      ? gameState.player.onFoot.position
      : gameState.player?.ship?.position
  }

  function playerHeading() {
    return gameState.player?.onFoot?.active
      ? gameState.player.onFoot.heading
      : gameState.player?.ship?.heading
  }

  function centreOnPlayer() {
    const p = playerPosition()
    if (!p) return
    centreX = Number(p[0]) || 0
    centreZ = Number(p[2]) || 0
  }

  function centreOnIsland() {
    const island = localIsland()
    if (!island) return centreOnPlayer()
    centreX = Number(island.position[0]) || 0
    centreZ = Number(island.position[2]) || 0
  }

  function draw() {
    if (!open) return
    const island = localIsland()
    // Pan/zoom free while open; only show() recentres on the boat.
    const rect = canvas.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    if (w <= 0 || h <= 0) return
    const k = scale()

    ctx.clearRect(0, 0, w, h)
    // Open water.
    ctx.fillStyle = '#0a1216'
    ctx.fillRect(0, 0, w, h)

    // Grid, in 5 km squares at sea or 100 m squares on an island.
    const step = (island ? 100 : 5000) * k
    if (step > 14) {
      ctx.strokeStyle = 'rgba(120,180,190,0.10)'
      ctx.lineWidth = 1
      const [ox, oy] = worldToScreen(0, 0)
      ctx.beginPath()
      for (let x = ox % step; x < w; x += step) {
        ctx.moveTo(Math.round(x) + 0.5, 0)
        ctx.lineTo(Math.round(x) + 0.5, h)
      }
      for (let y = oy % step; y < h; y += step) {
        ctx.moveTo(0, Math.round(y) + 0.5)
        ctx.lineTo(w, Math.round(y) + 0.5)
      }
      ctx.stroke()
    }

    // The edge of the surveyed world is not useful on a local island map.
    if (!island) {
      const [cx, cy] = worldToScreen(0, 0)
      ctx.strokeStyle = 'rgba(140,200,210,0.22)'
      ctx.setLineDash([6, 6])
      ctx.beginPath()
      ctx.arc(cx, cy, WORLD_RADIUS * k, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Fixed world directions: this is a north-up navigation chart, unlike the
    // heading-up radar below the helm.
    ctx.save()
    ctx.fillStyle = 'rgba(205,225,230,0.78)'
    ctx.font = 'bold 11px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', w * 0.5, 12)
    ctx.fillText('S', w * 0.5, h - 12)
    ctx.fillText('E', w - 12, h * 0.5)
    ctx.fillText('W', 12, h * 0.5)
    ctx.restore()

    const visited = new Set((gameState.visitedBodyIds ?? []).map(String))
    const world = getWorld(gameState.galaxy)
    const missionIds = world ? missionMarkedBodyIds(gameState, world.id) : new Set()
    const assetIds = playerAssetBodyIds(gameState)
    const waypointId = gameState.player.waypointBodyId

    // Islands first — they are the ground everything else sits on. The local
    // map uses the same deterministic shoreline profile as the 3D terrain.
    for (const body of bodies()) {
      if (body.kind !== 'island') continue
      if (island && body.id !== island.id) continue
      const [x, y] = worldToScreen(body.position[0], body.position[2])
      const profile = island ? getIslandProfile(body) : null
      const r = Math.max(1.5, (body.radius ?? 400) * k)
      if (x < -r - 40 || x > w + r + 40 || y < -r - 40 || y > h + r + 40) continue
      const seen = visited.has(String(body.id))
      ctx.fillStyle = island ? 'rgba(94,224,138,0.28)' : seen ? 'rgba(94,224,138,0.20)' : 'rgba(94,224,138,0.07)'
      ctx.strokeStyle = island ? 'rgba(125,240,170,0.82)' : seen ? 'rgba(94,224,138,0.55)' : 'rgba(94,224,138,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      if (profile) {
        for (let i = 0; i < profile.shore.length; i++) {
          const theta = (i / profile.shore.length) * Math.PI * 2
          const px = body.position[0] + Math.cos(theta) * profile.shore[i]
          const pz = body.position[2] + Math.sin(theta) * profile.shore[i]
          const [sx, sy] = worldToScreen(px, pz)
          if (i === 0) ctx.moveTo(sx, sy)
          else ctx.lineTo(sx, sy)
        }
        ctx.closePath()
      } else {
        ctx.arc(x, y, r, 0, Math.PI * 2)
      }
      ctx.fill()
      ctx.stroke()
      if (island) {
        ctx.fillStyle = 'rgba(180,220,150,0.28)'
        ctx.font = '11px monospace'
        ctx.textAlign = 'center'
        ctx.fillText(body.name, x, y + r + 18)
        ctx.textAlign = 'start'
      }
    }

    // Then everything you can go to or work.
    for (const body of bodies()) {
      if (body.kind === 'island') continue
      if (island && body.parentId !== island.id) continue
      const [x, y] = worldToScreen(body.position[0], body.position[2])
      if (x < -30 || x > w + 30 || y < -30 || y > h + 30) continue
      const seen = visited.has(String(body.id))
      const isPort = body.kind === 'port'
      const size = isPort ? 5.5 : body.kind === 'outpost' ? 4 : 3.5
      ctx.globalAlpha = seen ? 1 : 0.4

      ctx.fillStyle = KIND_COLOR[body.kind] ?? '#8899aa'
      if (body.kind === 'wreckField') {
        // A cross, so salvage never reads as somewhere you can tie up.
        ctx.strokeStyle = ctx.fillStyle
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(x - size, y - size)
        ctx.lineTo(x + size, y + size)
        ctx.moveTo(x + size, y - size)
        ctx.lineTo(x - size, y + size)
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      // Rings for the things you care about, outermost first.
      let ring = size + 3
      if (assetIds.has(String(body.id))) {
        ctx.strokeStyle = '#c9a227'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(x, y, ring, 0, Math.PI * 2)
        ctx.stroke()
        ring += 3
      }
      if (missionIds.has(body.id)) {
        ctx.strokeStyle = '#ff8a3d'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.arc(x, y, ring, 0, Math.PI * 2)
        ctx.stroke()
        ring += 3
      }
      if (body.id === waypointId) {
        ctx.strokeStyle = '#7fe0a0'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(x, y, ring, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (selected && body.id === selected.id) {
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1
        ctx.strokeRect(x - size - 6, y - size - 6, (size + 6) * 2, (size + 6) * 2)
      }
      ctx.globalAlpha = 1

      // Names only once the chart is zoomed enough to read them.
      if (seen && (isPort ? k > 0.0009 : k > 0.004)) {
        ctx.fillStyle = 'rgba(210,225,225,0.75)'
        ctx.font = '10px monospace'
        ctx.fillText(body.name, x + size + 4, y + 3)
      }
    }

    // You — bright yellow mark with heading.
    // +Z / heading 0 is north (up). X is mirrored, so canvas yaw is -heading.
    {
      const p = playerPosition()
      const [x, y] = worldToScreen(p[0], p[2])
      const heading = Number(playerHeading())
      const yaw = Number.isFinite(heading) ? -heading : 0
      ctx.save()
      // Soft glow under the arrow
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 16)
      glow.addColorStop(0, 'rgba(255, 225, 74, 0.9)')
      glow.addColorStop(0.4, 'rgba(255, 200, 40, 0.35)')
      glow.addColorStop(1, 'rgba(255, 200, 40, 0)')
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, 16, 0, Math.PI * 2)
      ctx.fill()
      // Directional arrow (tip = bow / heading)
      ctx.translate(x, y)
      ctx.rotate(yaw)
      ctx.fillStyle = '#ffe14a'
      ctx.strokeStyle = '#1a1200'
      ctx.lineWidth = 1.6
      ctx.beginPath()
      ctx.moveTo(0, -11) // tip forward (+Z / north when heading 0)
      ctx.lineTo(7, 8)
      ctx.lineTo(0, 4)
      ctx.lineTo(-7, 8)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      // Bright core so it still reads as “you” when zoomed out
      ctx.beginPath()
      ctx.arc(0, -1, 3.2, 0, Math.PI * 2)
      ctx.fillStyle = '#fff6a8'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }

    // Scale bar — a chart without one is a picture.
    {
      const targetPx = 110
      const rawUnits = targetPx / k / (island ? 1 : 1000)
      const nice = (island ? [50, 100, 200, 500, 1000] : [1, 2, 5, 10, 20, 50])
        .find((n) => n >= rawUnits) ?? 50
      const px = nice * (island ? 1 : 1000) * k
      const bx = 14
      const by = h - 18
      ctx.strokeStyle = 'rgba(210,225,225,0.7)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(bx, by)
      ctx.lineTo(bx + px, by)
      ctx.moveTo(bx, by - 4)
      ctx.lineTo(bx, by + 4)
      ctx.moveTo(bx + px, by - 4)
      ctx.lineTo(bx + px, by + 4)
      ctx.stroke()
      ctx.fillStyle = 'rgba(210,225,225,0.7)'
      ctx.font = '10px monospace'
      const scaleLabel = island
        ? nice < 1000 ? `${nice} m` : '1 km'
        : `${nice} km`
      ctx.fillText(scaleLabel, bx + px + 6, by + 3)
    }
  }

  /** Nearest mark to a screen point, within grab distance. */
  function pick(px, py) {
    let best = null
    let bestD = 16
    const island = localIsland()
    for (const body of bodies()) {
      if (island && body.kind !== 'island' && body.parentId !== island.id) continue
      const [x, y] = worldToScreen(body.position[0], body.position[2])
      const d = Math.hypot(x - px, y - py)
      // Islands are big targets; only take one if nothing smaller is closer.
      const grab = body.kind === 'island' ? Math.max(8, (body.radius ?? 400) * scale()) : 12
      if (d < grab && d < bestD) {
        bestD = d
        best = body
      }
    }
    return best
  }

  function describe(body) {
    if (!body) {
      selBody.innerHTML = 'Nothing selected.'
      return
    }
    const p = playerPosition()
    const dist = Math.hypot(body.position[0] - p[0], body.position[2] - p[2])
    const seen = (gameState.visitedBodyIds ?? []).map(String).includes(String(body.id))
    const isWaypoint = gameState.player.waypointBodyId === body.id
    const bits = [
      `<div class="name">${escapeHtml(body.name)}</div>`,
      `<div class="meta">${KIND_LABEL[body.kind] ?? body.kind}</div>`,
      `<div class="meta">${(dist / 1000).toFixed(1)} km away</div>`
    ]
    if (body.securityRating != null) {
      bits.push(`<div class="meta">Security ${body.securityRating}</div>`)
    }
    if (body.kind === 'island' || body.kind === 'wreckField') {
      bits.push(`<div class="meta">Remoteness ${(remoteness(body.position) * 100).toFixed(0)}%</div>`)
    }
    if (!seen) bits.push('<div class="meta">Not yet visited</div>')
    bits.push(
      `<button class="sc-wp">${isWaypoint ? 'Clear waypoint' : 'Set waypoint'}</button>`
    )
    selBody.innerHTML = bits.join('')
    const btn = selBody.querySelector('.sc-wp')
    btn.onclick = () => {
      if (isWaypoint) {
        gameState.player.waypointBodyId = null
        gameState.player.waypointPosition = null
        hooks.onWaypointChange?.({ id: null, name: body.name, set: false })
      } else {
        if (hooks.canSetWaypoint && !hooks.canSetWaypoint()) return
        gameState.player.waypointBodyId = body.id
        gameState.player.waypointPosition = null
        hooks.onWaypointChange?.({ id: body.id, name: body.name, set: true })
      }
      describe(body)
      draw()
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    drag.active = true
    drag.x = e.clientX
    drag.y = e.clientY
    drag.moved = 0
    canvas.setPointerCapture?.(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drag.active) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    drag.x = e.clientX
    drag.y = e.clientY
    drag.moved += Math.abs(dx) + Math.abs(dy)
    const k = scale()
    centreX += dx / k
    centreZ += dy / k
    draw()
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!drag.active) return
    drag.active = false
    canvas.releasePointerCapture?.(e.pointerId)
    // A drag is a pan, not a click.
    if (drag.moved > 4) return
    const rect = canvas.getBoundingClientRect()
    selected = pick(e.clientX - rect.left, e.clientY - rect.top)
    describe(selected)
    draw()
  })
  canvas.addEventListener('dblclick', () => {
    centreOnPlayer()
    draw()
  })
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      // Zoom about the cursor so you can drill into a coast without chasing it.
      const [wx, wz] = screenToWorld(px, py)
      const factor = Math.exp(-e.deltaY * 0.0016)
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor))
      const [nx, nz] = screenToWorld(px, py)
      centreX += wx - nx
      centreZ += wz - nz
      draw()
    },
    { passive: false }
  )

  root.querySelector('.sc-close').onclick = () => hide()
  window.addEventListener('resize', () => {
    if (open) resize()
  })

  function show({ islandBodyId = null } = {}) {
    open = true
    localIslandId = islandBodyId
    const island = localIsland()
    if (island) {
      titleEl.textContent = 'ISLAND MAP'
      subEl.textContent = `Local survey · ${island.name} · North-up · drag to pan · scroll to zoom`
      zoom = 1.05
      centreOnIsland()
    } else {
      titleEl.textContent = 'SEA CHART'
      subEl.textContent = 'North-up · opens on you · drag to pan · scroll to zoom · click a mark for a waypoint'
      zoom = 1.6
      centreOnPlayer()
    }
    root.classList.add('open')
    selected = null
    describe(null)
    // Layout has to settle before the canvas can be sized from its rect.
    requestAnimationFrame(resize)
  }

  /**
   * @param {{ silent?: boolean }} [opts] silent: close without onClose (e.g. pause
   *   already owns flight mode / must not reenter helm).
   */
  function hide(opts = {}) {
    if (!open) return
    open = false
    localIslandId = null
    titleEl.textContent = 'SEA CHART'
    subEl.textContent = 'North-up · opens on you · drag to pan · scroll to zoom · click a mark for a waypoint'
    root.classList.remove('open')
    if (!opts.silent) hooks.onClose?.()
  }

  return {
    element: root,
    show,
    hide,
    isOpen: () => open,
    refresh: () => draw()
  }
}
