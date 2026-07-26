import { getShipClass } from '../data/shipClasses.js'
import { accessorySlotCount, effectiveMiningCapacity, getAccessory } from '../data/accessories.js'
import { getWeapon, BASE_WEAPON_ID, ALIEN_BASE_WEAPON_ID } from '../data/weapons.js'
import { ensureLawStanding, MAX_LAW_STANDING } from '../game/security.js'
import { SKILLS, MAX_SKILL_LEVEL, ensureSkills, skillLevel } from '../game/skills.js'
import { escapeHtml } from './escapeHtml.js'
import { isPortraitImageFile, resizeImageToDataUrl } from './portrait.js'
import {
  defaultPanelGeom,
  floatingPanelElevationCss,
  floatingResizeHandleCss,
  wireFloatingPanel
} from './floatingPanel.js'

const GEOM_LS_KEY = 'witv.characterPanel'

const SHIP_STAT_ROWS = [
  ['hull', 'Hull'],
  ['shields', 'Shields'],
  ['armor', 'Armour'],
  ['cargoCapacity', 'Cargo'],
  ['miningCapacity', 'Mining'],
  ['speed', 'Speed'],
  ['turnRate', 'Turn'],
  ['accel', 'Accel']
]

const STYLE = `
/* Floating character sheet — above docking chrome; click-through root. */
#character-ui {
  position: fixed; inset: 0; z-index: 58;
  display: none;
  pointer-events: none;
  background: transparent;
  font-family: monospace; color: var(--ui-text);
}
#character-ui.is-open { display: block; }
#character-ui .panel {
  pointer-events: auto;
  position: fixed;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: 360px; min-height: 320px;
  max-width: 96vw; max-height: 92vh;
  padding: 0;
  overflow: hidden;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.96), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.92));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.42); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
${floatingPanelElevationCss('#character-ui .panel')}
#character-ui .char-header {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; flex-shrink: 0;
  padding: 12px 16px 10px;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  cursor: grab; user-select: none; touch-action: none;
}
#character-ui .char-header.dragging { cursor: grabbing; }
#character-ui .char-header h2 {
  margin: 0; font-weight: normal; letter-spacing: 2px; font-size: 15px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#character-ui .char-header-right {
  display: flex; align-items: center; gap: 8px; flex-shrink: 0; cursor: default;
}
#character-ui .char-body {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  padding: 16px 18px 14px;
}
#character-ui .layout {
  display: grid;
  grid-template-columns: 168px 1fr;
  gap: 20px 24px;
  align-items: start;
}
${floatingResizeHandleCss('#character-ui .float-resize')}
@media (max-width: 560px) {
  #character-ui .layout { grid-template-columns: 1fr; }
  #character-ui .identity { align-items: center; }
  #character-ui .portrait-actions { width: 160px; }
}
#character-ui .identity {
  display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
}
#character-ui .portrait-frame {
  width: 160px; height: 160px;
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5);
  box-shadow: 0 2px 6px rgba(0,0,0,0.85), 0 6px 14px rgba(0,0,0,0.5), inset 0 0 14px rgba(0,0,0,0.4);
  background: rgba(8,12,22,0.9);
  overflow: hidden; position: relative;
}
#character-ui .portrait-frame img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
#character-ui .portrait-frame .placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  font-size: 52px; color: var(--ui-muted); letter-spacing: 0;
}
#character-ui .portrait-actions {
  display: flex; flex-direction: column; gap: 5px; width: 160px;
}
#character-ui .portrait-actions button,
#character-ui button.upload-btn {
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  color: var(--ui-pale); padding: 5px 8px; cursor: pointer; font-family: monospace;
  font-size: 10px; letter-spacing: 0.5px; width: 100%;
}
#character-ui .portrait-actions button:hover,
#character-ui button.upload-btn:hover {
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.2); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#character-ui .portrait-actions button.danger {
  border-color: rgba(224,90,90,0.45); color: #ffb3b3; background: rgba(224,90,90,0.08);
}
#character-ui .stats {
  display: flex; flex-direction: column; gap: 10px; min-width: 0;
}
#character-ui .stat-row {
  display: flex; flex-direction: column; gap: 5px;
  padding: 10px 12px;
  background: rgba(8,12,22,0.55); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
}
#character-ui .stat-row.inline {
  flex-direction: row; justify-content: space-between; align-items: baseline;
}
#character-ui .stat-row .label {
  font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ui-dim);
}
#character-ui .stat-row .value {
  font-size: 14px; color: var(--ui-bright); letter-spacing: 0.5px; text-align: right;
}
#character-ui .stat-row .value.credits { color: #ffe08a; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#character-ui .stat-row .value.law-good { color: #7fe0a0; }
#character-ui .stat-row .value.law-mid { color: #ffe08a; }
#character-ui .stat-row .value.law-bad { color: #ff8a7a; text-shadow: 0 1px 2px rgba(0,0,0,0.9); }
#character-ui .stat-row .ship-class {
  font-size: 11px; color: var(--ui-dim); opacity: 0.85; margin-top: 2px;
}
#character-ui .name-field {
  display: flex; gap: 8px; align-items: center; width: 100%;
}
#character-ui .name-field input {
  flex: 1; min-width: 0;
  background: rgba(6,10,18,0.9); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35);
  color: var(--ui-bright); font-family: monospace; font-size: 13px; letter-spacing: 0.5px;
  padding: 6px 10px; outline: none;
}
#character-ui .name-field input:focus {
  border-color: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.7); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#character-ui .name-field button.apply {
  flex-shrink: 0;
  background: rgba(127,224,160,0.12); border: 1px solid rgba(127,224,160,0.5); color: #bdf5cf;
  padding: 6px 12px; cursor: pointer; font-family: monospace; font-size: 11px; letter-spacing: 1px;
}
#character-ui .name-field button.apply:hover {
  background: rgba(127,224,160,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#character-ui .name-field button.apply:disabled {
  opacity: 0.4; cursor: not-allowed; box-shadow: none;
}
#character-ui .rename-msg {
  font-size: 10px; letter-spacing: 0.5px; min-height: 14px; margin-top: 2px;
}
#character-ui .rename-msg.ok { color: #7fe0a0; }
#character-ui .rename-msg.err { color: #ff9a7a; }
#character-ui .footer {
  margin-top: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px;
}
#character-ui .hint { font-size: 11px; opacity: 0.55; letter-spacing: 0.5px; }
#character-ui button.close {
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5); color: #ffb3b3;
  padding: 7px 16px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
}
#character-ui button.close:hover { background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#character-ui input[type=file] { display: none; }
#character-ui .upload-err {
  font-size: 10px; color: #ff9a7a; max-width: 160px; text-align: center; margin-top: 2px;
}
/* Ship stats under portrait — compact read of current hull */
#character-ui .ship-stats-panel {
  width: 160px; box-sizing: border-box;
  margin-top: 4px; padding: 8px 8px 7px;
  background: rgba(8,12,22,0.55);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5);
}
#character-ui .ship-stats-panel .ss-title {
  font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.9; margin: 0 0 6px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#character-ui .ship-stats-panel .ss-name {
  font-size: 11px; color: var(--ui-bright); letter-spacing: 0.3px;
  margin: 0 0 2px; line-height: 1.25;
  word-break: break-word;
}
#character-ui .ship-stats-panel .ss-class {
  font-size: 10px; color: var(--ui-dim); opacity: 0.85; margin: 0 0 7px;
}
#character-ui .ship-stats-panel .ss-row {
  display: flex; justify-content: space-between; align-items: baseline;
  gap: 6px; font-size: 10px; line-height: 1.45;
  border-bottom: 1px solid rgba(42,58,85,0.35);
  padding: 1px 0;
}
#character-ui .ship-stats-panel .ss-row:last-child { border-bottom: none; }
#character-ui .ship-stats-panel .ss-row .ss-label {
  color: var(--ui-dim); letter-spacing: 0.4px; text-transform: uppercase; font-size: 9px;
}
#character-ui .ship-stats-panel .ss-row .ss-val {
  color: var(--ui-text); text-align: right; white-space: nowrap;
}
#character-ui .ship-stats-panel .ss-section {
  margin-top: 6px; padding-top: 5px;
  border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.85; margin-bottom: 3px;
}
/* Equipped hardpoint / accessory lines under Fit */
#character-ui .ship-stats-panel .ss-fit-line {
  display: flex; flex-direction: column; gap: 1px;
  font-size: 10px; line-height: 1.35;
  border-bottom: 1px solid rgba(42,58,85,0.3);
  padding: 3px 0;
}
#character-ui .ship-stats-panel .ss-fit-line:last-child { border-bottom: none; }
#character-ui .ship-stats-panel .ss-fit-line .ss-slot {
  color: var(--ui-dim); letter-spacing: 0.3px; text-transform: uppercase; font-size: 8px;
}
#character-ui .ship-stats-panel .ss-fit-line .ss-item {
  color: var(--ui-bright); word-break: break-word;
}
#character-ui .ship-stats-panel .ss-fit-line .ss-item.empty {
  color: #6a8098; font-style: italic;
}
`

const NAME_MAX_LEN = 32

function lawClass(standing) {
  if (standing <= 2) return 'law-bad'
  if (standing < 5) return 'law-mid'
  return 'law-good'
}

/** Sanitize a display name; returns null if empty after trim. */
function sanitizeName(raw) {
  const s = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, NAME_MAX_LEN)
  return s.length ? s : null
}

export function createCharacterUI(container, gameState) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'character-ui'
  root.innerHTML = `
    <div class="panel">
      <div class="char-header">
        <h2>Character</h2>
        <div class="char-header-right">
          <button type="button" class="close">Close</button>
        </div>
      </div>
      <div class="char-body">
        <div class="layout">
          <div class="identity">
            <div class="portrait-frame">
              <div class="placeholder">?</div>
            </div>
            <div class="portrait-actions">
              <button type="button" class="upload-btn">Upload photo</button>
              <button type="button" class="clear-btn danger" style="display:none">Clear</button>
            </div>
            <input type="file" class="file-input" accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg" />
            <div class="ship-stats-panel" aria-label="Current ship stats"></div>
          </div>
          <div class="stats">
            <div class="stat-row">
              <span class="label">Pilot name</span>
              <div class="name-field">
                <input type="text" class="char-name-input" maxlength="${NAME_MAX_LEN}" spellcheck="false" autocomplete="off" />
                <button type="button" class="apply apply-char">Rename</button>
              </div>
              <div class="rename-msg char-rename-msg"></div>
            </div>
            <div class="stat-row">
              <span class="label">Ship name</span>
              <div class="name-field">
                <input type="text" class="ship-name-input" maxlength="${NAME_MAX_LEN}" spellcheck="false" autocomplete="off" />
                <button type="button" class="apply apply-ship">Rename</button>
              </div>
              <div class="ship-class ship-class-label"></div>
              <div class="rename-msg ship-rename-msg"></div>
            </div>
            <div class="stat-row inline">
              <span class="label">Credits</span>
              <span class="value credits">0 cr</span>
            </div>
            <div class="stat-row inline">
              <span class="label">Security standing</span>
              <span class="value law-value">10 / 10</span>
            </div>
            <div class="stat-row inline law-hint-row" style="display:none">
              <span class="label">Status</span>
              <span class="value law-status" style="font-size:12px"></span>
            </div>
            <div class="stat-row skills-block">
              <span class="label">Skills</span>
              <div class="skills-list" style="font-size:11px;line-height:1.45;margin-top:4px;color:#b8d4e8"></div>
              <div style="font-size:10px;opacity:0.55;margin-top:6px">Read skillbooks from Inventory → Skillbooks. Max ${MAX_SKILL_LEVEL} each.</div>
            </div>
          </div>
        </div>
        <div class="footer">
          <span class="hint">Kill pirates to rebuild standing · Close button or F1 to close · Drag header to move</span>
        </div>
      </div>
      <div class="float-resize" title="Resize" aria-label="Resize character panel"></div>
    </div>
  `
  container.appendChild(root)

  const panelEl = root.querySelector('.panel')
  const headerEl = root.querySelector('.char-header')
  const portraitFrame = root.querySelector('.portrait-frame')
  const fileInput = root.querySelector('.file-input')
  const uploadBtn = root.querySelector('.upload-btn')
  const clearBtn = root.querySelector('.clear-btn')
  const closeBtn = root.querySelector('.close')
  const identityCol = root.querySelector('.identity')
  const charNameInput = root.querySelector('.char-name-input')
  const shipNameInput = root.querySelector('.ship-name-input')
  const applyCharBtn = root.querySelector('.apply-char')
  const applyShipBtn = root.querySelector('.apply-ship')
  const charRenameMsg = root.querySelector('.char-rename-msg')
  const shipRenameMsg = root.querySelector('.ship-rename-msg')
  const shipClassLabel = root.querySelector('.ship-class-label')
  // Cache nodes once — refresh must not depend on class names that get restyled.
  const lawValueEl = root.querySelector('.law-value')
  const lawStatusEl = root.querySelector('.law-status')
  const creditsEl = root.querySelector('.credits')
  const lawHintRow = root.querySelector('.law-hint-row')
  const skillsListEl = root.querySelector('.skills-list')
  const shipStatsPanel = root.querySelector('.ship-stats-panel')

  let onClose = null
  let open = false

  const floating = wireFloatingPanel({
    panelEl,
    headerEl,
    resizeEl: root.querySelector('.float-resize'),
    storageKey: GEOM_LS_KEY,
    minW: 360,
    minH: 320,
    isActive: () => open,
    defaultGeom: () =>
      defaultPanelGeom({
        fracW: 0.48,
        fracH: 0.7,
        maxW: 680,
        maxH: 760,
        minW: 360,
        minH: 320,
        align: 'center'
      })
  })

  function flashMsg(el, text, ok, timerRef) {
    el.textContent = text
    el.className = `rename-msg ${ok ? 'ok' : 'err'}`
    clearTimeout(timerRef.id)
    timerRef.id = setTimeout(() => {
      el.textContent = ''
      el.className = 'rename-msg'
    }, 2200)
  }
  const charTimer = { id: 0 }
  const shipTimer = { id: 0 }

  function renderPortrait() {
    const url = gameState.player.portraitDataUrl
    if (url) {
      portraitFrame.innerHTML = `<img alt="Pilot portrait" src="${url}" />`
      clearBtn.style.display = 'block'
    } else {
      const initial = (gameState.player.name || '?').trim().charAt(0).toUpperCase() || '?'
      portraitFrame.innerHTML = `<div class="placeholder">${escapeHtml(initial)}</div>`
      clearBtn.style.display = 'none'
    }
  }

  function refreshStats() {
    ensureLawStanding(gameState)
    ensureSkills(gameState)
    const shipClass = getShipClass(gameState.player.ship.classId)
    const law = gameState.player.lawStanding

    // Don't clobber name fields while the player is typing.
    if (document.activeElement !== charNameInput) {
      charNameInput.value = gameState.player.name || ''
    }
    if (document.activeElement !== shipNameInput) {
      shipNameInput.value = gameState.player.ship.instanceName || ''
    }
    shipClassLabel.textContent = shipClass?.name ? `Hull: ${shipClass.name}` : ''

    if (creditsEl) {
      creditsEl.textContent =
        `${Math.floor(gameState.player.credits || 0).toLocaleString()} cr`
    }
    if (lawValueEl) {
      lawValueEl.textContent = `${law} / ${MAX_LAW_STANDING}`
      lawValueEl.classList.remove('law-good', 'law-mid', 'law-bad')
      lawValueEl.classList.add(lawClass(law))
    }

    let status = ''
    if (law <= 0) status = 'Outlaw — shoot-on-sight (Sec 3–6) + all police'
    else if (law <= 2) status = 'Wanted — police engage on sight (Sec 1–6)'
    else if (law < 5) status = 'Stations in Sec 3–6 refuse docking'
    if (status && lawHintRow && lawStatusEl) {
      lawHintRow.style.display = 'flex'
      lawStatusEl.textContent = status
      lawStatusEl.classList.remove('law-good', 'law-mid', 'law-bad')
      lawStatusEl.classList.add(lawClass(law))
    } else if (lawHintRow) {
      lawHintRow.style.display = 'none'
    }

    if (skillsListEl) {
      const books = gameState.player.ship.skillbooks ?? {}
      skillsListEl.innerHTML = SKILLS.map((s) => {
        const lv = skillLevel(gameState.player.skills, s.id)
        const b = books[s.id] ?? 0
        const bookBit = b > 0 ? ` · <span style="color:#ffe08a">${b} book${b > 1 ? 's' : ''}</span>` : ''
        return `<div>${escapeHtml(s.name)}: <strong style="color:var(--ui-bright)">${lv}</strong>/${MAX_SKILL_LEVEL}${bookBit}</div>`
      }).join('')
    }

    if (shipStatsPanel && shipClass) {
      const ship = gameState.player.ship
      const hps = Array.isArray(shipClass.hardpoints) ? shipClass.hardpoints : []
      const accSlots = accessorySlotCount(shipClass)
      const role = shipClass.role
        ? String(shipClass.role).charAt(0).toUpperCase() + String(shipClass.role).slice(1)
        : '—'
      const statLines = SHIP_STAT_ROWS.map(([key, label]) => {
        let val = shipClass.stats[key]
        if (key === 'miningCapacity') {
          const live = effectiveMiningCapacity(ship, shipClass)
          const base = shipClass.stats.miningCapacity
          val = live !== base ? `${live}` : String(base)
        } else if (key === 'turnRate') {
          val = Number(val).toFixed(2)
        } else {
          val = String(val ?? '—')
        }
        // Live hull/shields/armour from the ship when damaged.
        if (key === 'hull' || key === 'shields' || key === 'armor') {
          const cur = Math.round(Number(ship[key]) || 0)
          const max = Math.round(Number(shipClass.stats[key]) || 0)
          val = `${cur}/${max}`
        }
        return `<div class="ss-row"><span class="ss-label">${label}</span><span class="ss-val">${escapeHtml(val)}</span></div>`
      }).join('')

      // Custom instance name → show that alone; otherwise model only (not both).
      const modelName = shipClass.name || '—'
      const instanceName = String(ship.instanceName ?? '').trim()
      const hasCustomName = instanceName.length > 0 && instanceName !== modelName
      const displayName = hasCustomName ? instanceName : modelName

      const baseIds = shipClass.alien ? ALIEN_BASE_WEAPON_ID : BASE_WEAPON_ID
      let laserN = 0
      let missileN = 0
      const hardpointFitLines = hps
        .map((hp) => {
          const mountType = hp?.type === 'missile' ? 'missile' : 'laser'
          if (mountType === 'missile') missileN++
          else laserN++
          const slotLabel =
            mountType === 'missile' ? `Launcher ${missileN}` : `Turret ${laserN}`
          const equippedId = ship.equippedWeapons?.[hp.id] ?? baseIds[mountType]
          let itemName = 'Empty'
          let empty = true
          if (equippedId) {
            try {
              itemName = getWeapon(equippedId).name
              empty = false
            } catch {
              itemName = String(equippedId)
              empty = false
            }
          }
          return `<div class="ss-fit-line">
            <span class="ss-slot">${escapeHtml(slotLabel)}</span>
            <span class="ss-item${empty ? ' empty' : ''}">${escapeHtml(itemName)}</span>
          </div>`
        })
        .join('')

      const equippedAcc = Array.isArray(ship.equippedAccessories)
        ? ship.equippedAccessories
        : []
      const accessoryFitLines = Array.from({ length: accSlots }, (_, i) => {
        const id = equippedAcc[i] ?? null
        let itemName = 'Empty'
        let empty = true
        if (id) {
          try {
            itemName = getAccessory(id).name
            empty = false
          } catch {
            itemName = String(id)
            empty = false
          }
        }
        return `<div class="ss-fit-line">
          <span class="ss-slot">Accessory ${i + 1}</span>
          <span class="ss-item${empty ? ' empty' : ''}">${escapeHtml(itemName)}</span>
        </div>`
      }).join('')

      const fitBody = [
        hardpointFitLines,
        accessoryFitLines
      ]
        .filter(Boolean)
        .join('') || '<div class="ss-fit-line"><span class="ss-item empty">No fit slots</span></div>'

      shipStatsPanel.innerHTML = `
        <div class="ss-title">Ship stats</div>
        <div class="ss-name">${escapeHtml(displayName)}</div>
        <div class="ss-class">${escapeHtml(role)}</div>
        ${statLines}
        <div class="ss-section">Fit</div>
        ${fitBody}
      `
    } else if (shipStatsPanel) {
      shipStatsPanel.innerHTML = '<div class="ss-title">Ship stats</div><div class="ss-class">Unknown hull</div>'
    }
  }

  function applyCharacterName() {
    const next = sanitizeName(charNameInput.value)
    if (!next) {
      flashMsg(charRenameMsg, 'Enter a name', false, charTimer)
      charNameInput.value = gameState.player.name || ''
      return
    }
    gameState.player.name = next
    charNameInput.value = next
    renderPortrait()
    flashMsg(charRenameMsg, 'Pilot renamed', true, charTimer)
  }

  function applyShipName() {
    const next = sanitizeName(shipNameInput.value)
    if (!next) {
      flashMsg(shipRenameMsg, 'Enter a name', false, shipTimer)
      shipNameInput.value = gameState.player.ship.instanceName || ''
      return
    }
    gameState.player.ship.instanceName = next
    shipNameInput.value = next
    flashMsg(shipRenameMsg, 'Ship renamed', true, shipTimer)
  }

  applyCharBtn.addEventListener('click', applyCharacterName)
  applyShipBtn.addEventListener('click', applyShipName)
  charNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyCharacterName()
    }
  })
  shipNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      applyShipName()
    }
  })

  uploadBtn.addEventListener('click', () => fileInput.click())
  clearBtn.addEventListener('click', () => {
    gameState.player.portraitDataUrl = null
    renderPortrait()
  })
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    if (!isPortraitImageFile(file)) {
      statusNotice('Use a PNG or JPG image')
      return
    }
    try {
      gameState.player.portraitDataUrl = await resizeImageToDataUrl(file)
      renderPortrait()
    } catch {
      statusNotice('Could not load that image')
    }
  })

  function statusNotice(msg) {
    identityCol.querySelector('.upload-err')?.remove()
    const el = document.createElement('div')
    el.className = 'upload-err'
    el.textContent = msg
    identityCol.appendChild(el)
    setTimeout(() => el.remove(), 2500)
  }

  /**
   * @param {{ silent?: boolean }} [opts] silent skips onClose (caller owns state).
   */
  function hide(opts = {}) {
    open = false
    root.classList.remove('is-open')
    root.style.display = 'none'
    if (opts.silent) {
      onClose = null
      return
    }
    const cb = onClose
    onClose = null
    cb?.()
  }

  closeBtn.addEventListener('click', () => hide())

  return {
    element: root,
    show(closeCb) {
      onClose = closeCb ?? null
      open = true
      floating.restore()
      root.classList.add('is-open')
      root.style.display = 'block'
      try {
        refreshStats()
        renderPortrait()
      } catch (err) {
        console.error('Character screen content failed:', err)
      }
    },
    hide,
    isOpen() {
      return open
    },
    refresh() {
      if (open) {
        refreshStats()
        renderPortrait()
      }
    }
  }
}
