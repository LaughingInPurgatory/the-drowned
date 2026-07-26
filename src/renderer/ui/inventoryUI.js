import { getGood } from '../data/goods.js'
import { getShipClass } from '../data/shipClasses.js'
import {
  useShipPart,
  storageHasAssets,
  discardCargo,
  discardOre,
  transferStorageItem,
  storeCarriedWeapons
} from '../game/economy.js'
import { findBody, findSystemOfBody } from '../procgen/galaxy.js'
import { getWeapon } from '../data/weapons.js'
import { getAccessory, effectiveMiningCapacity } from '../data/accessories.js'
import {
  craftRemainingS,
  transferBlueprintItem,
  storeBlueprints,
  ensureBlueprintMaps
} from '../game/crafting.js'
import { getBlueprint, formatDuration } from '../data/blueprints.js'
import {
  ensureSkills,
  useSkillbook,
  getSkillDef,
  skillLevel,
  MAX_SKILL_LEVEL
} from '../game/skills.js'
import { escapeHtml } from './escapeHtml.js'
import { gameNotice, gamePrompt } from './gameDialog.js'
import { goodIcon, itemIcon, itemNameCell, ITEM_ICON_CSS } from './itemIcons.js'
import {
  defaultPanelGeom,
  floatingPanelElevationCss,
  floatingResizeHandleCss,
  wireFloatingPanel
} from './floatingPanel.js'

/** Same MIME as dockingUI station transfers. */
const XFER_MIME = 'application/x-witv-storage'
const GEOM_LS_KEY = 'witv.inventoryPanel'

const STYLE = `
${ITEM_ICON_CSS}
/* Floating inventory — above docking chrome (z 50). Root is click-through so
   Station Services stays usable while Inventory is open for drag transfers. */
#inventory-ui {
  position: fixed; inset: 0; z-index: 55;
  display: none;
  pointer-events: none;
  background: transparent;
  font-family: monospace; color: var(--ui-text);
}
#inventory-ui.is-open { display: block; }
#inventory-ui .panel {
  pointer-events: auto;
  position: fixed;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  min-width: 320px; min-height: 240px;
  max-width: 96vw; max-height: 92vh;
  padding: 14px 16px 18px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.96), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.92));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
  overflow: hidden;
}
${floatingPanelElevationCss('#inventory-ui .panel')}
#inventory-ui .inv-float-toast {
  position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%);
  pointer-events: none; z-index: 70; font-family: monospace; font-size: 14px;
  letter-spacing: 1px; color: #ffe08a;
  text-shadow: 0 1px 3px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.75);
  opacity: 0; transition: opacity 0.2s ease;
}
#inventory-ui .inv-float-toast.show { opacity: 1; }

#inventory-ui h2 { font-weight: normal; letter-spacing: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); margin: 0; font-size: 16px; }
#inventory-ui h3 { font-weight: normal; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--ui-accent); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); margin: 0 0 10px; }
#inventory-ui .header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; gap: 12px;
  flex-shrink: 0; cursor: grab; user-select: none;
  touch-action: none;
}
#inventory-ui .header.dragging { cursor: grabbing; }
#inventory-ui .header-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; cursor: default; }
#inventory-ui .credits-display {
  font-size: 13px; letter-spacing: 1px; color: #ffe08a;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
  white-space: nowrap;
}
#inventory-ui .tabs {
  display: flex; gap: 2px; margin-bottom: 10px;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  flex-wrap: nowrap;
  overflow-x: auto;
  flex-shrink: 0;
}
#inventory-ui .tab {
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: var(--ui-dim); padding: 7px 10px; cursor: pointer; font-family: monospace;
  font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
  white-space: nowrap; flex-shrink: 0;
  transition: color 0.15s ease, border-color 0.15s ease;
}
#inventory-ui .tab:hover { color: var(--ui-text); }
#inventory-ui .tab.active {
  color: var(--ui-accent); border-bottom-color: var(--ui-accent-mid);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#inventory-ui .content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}
#inventory-ui table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
#inventory-ui th { text-align: left; padding: 6px 8px; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ui-dim); font-weight: normal; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3); white-space: nowrap; }
#inventory-ui td { text-align: left; padding: 5px 8px; border-bottom: 1px solid rgba(42,58,85,0.5); }
#inventory-ui td:not(:first-child) { white-space: nowrap; }
#inventory-ui button.close {
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5); color: #ffb3b3;
  padding: 7px 16px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#inventory-ui button.close:hover { background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#inventory-ui button.repair-btn {
  background: rgba(127,224,160,0.12); border: 1px solid rgba(127,224,160,0.5); color: #bdf5cf;
  padding: 7px 14px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#inventory-ui button.repair-btn:not(:disabled):hover {
  background: rgba(127,224,160,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#inventory-ui button.repair-btn:disabled { opacity: 0.35; cursor: not-allowed; }
#inventory-ui .parts-badge {
  font-size: 12px; letter-spacing: 0.5px; color: #bdf5cf; opacity: 0.95;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#inventory-ui .parts-badge.none { color: var(--ui-dim); opacity: 0.65; }
#inventory-ui .empty { opacity: 0.5; font-size: 12px; }
#inventory-ui button.discard-item {
  background: rgba(224,90,90,0.1); border: 1px solid rgba(224,90,90,0.45); color: #ffb3b3;
  padding: 2px 8px; cursor: pointer; font-family: monospace; font-size: 11px;
}
#inventory-ui button.discard-item:hover {
  background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#inventory-ui button.use-skillbook,
#inventory-ui button.dock-action {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 3px 10px; cursor: pointer; font-family: monospace; font-size: 11px;
}
#inventory-ui button.dock-action:hover,
#inventory-ui button.use-skillbook:hover {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22);
}
#inventory-ui .tab-meta {
  font-size: 12px; opacity: 0.75; margin: 0 0 12px 0; line-height: 1.4;
}
#inventory-ui .hull-status {
  font-size: 12px; opacity: 0.9; margin-bottom: 10px;
}
#inventory-ui .xfer-hint {
  font-size: 11px; opacity: 0.65; line-height: 1.4; margin: 0 0 10px 0;
}
#inventory-ui .xfer-item {
  cursor: grab; user-select: none;
}
#inventory-ui .xfer-item:active { cursor: grabbing; }
#inventory-ui tr.xfer-item td { transition: background 0.12s ease; }
#inventory-ui tr.xfer-item:hover td { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); }
#inventory-ui .xfer-item.xfer-dragging { opacity: 0.45; }
#inventory-ui .panel.xfer-drop-target.drag-over {
  outline: 1px solid rgba(127,224,160,0.55);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#inventory-ui .xfer-parts {
  display: inline-block; padding: 2px 8px; margin-top: 2px;
  border: 1px dashed rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35); border-radius: 2px;
}
#inventory-ui .remote-station {
  margin-bottom: 12px; padding: 10px 12px;
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.05); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35);
}
#inventory-ui .remote-station h4 { margin: 0 0 2px 0; font-size: 13px; color: var(--ui-accent); font-weight: normal; }
#inventory-ui .remote-station .location {
  font-size: 11px; opacity: 0.75; margin-bottom: 6px; letter-spacing: 0.3px;
}
#inventory-ui .remote-station .location .sys { color: #ffe08a; }
#inventory-ui .remote-station .location .here {
  color: #7fe0a0; margin-left: 6px; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
}
#inventory-ui .remote-station .assets { font-size: 12px; line-height: 1.45; opacity: 0.95; }
#inventory-ui .job-row {
  margin-bottom: 12px; padding: 10px 12px;
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.05); border-left: 2px solid rgba(127,224,160,0.45);
}
#inventory-ui .job-row .job-name { color: var(--ui-text); margin-bottom: 4px; }
#inventory-ui .job-row .job-meta { font-size: 11px; opacity: 0.75; margin-bottom: 6px; line-height: 1.4; }
#inventory-ui .job-row .job-loc { color: #ffe08a; }
#inventory-ui .craft-progress {
  height: 8px; background: #0c1424; border: 1px solid #2a3a55; overflow: hidden;
}
#inventory-ui .craft-progress .fill {
  height: 100%; background: linear-gradient(90deg, var(--ui-deep), var(--ui-accent));
}
${floatingResizeHandleCss('#inventory-ui .float-resize')}
`

// Cargo / ore / stored assets / industry jobs — tabbed inventory.
// Ship-part repair is in the header (consumes one part via useShipPart).
// While docked, cargo/ore/parts/blueprints drag onto Station Services.
export function createInventoryUI(container, gameState, hooks = {}) {
  const { onStorageChanged } = hooks
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'inventory-ui'
  root.innerHTML = `
    <div class="panel">
      <div class="header">
        <h2>Inventory</h2>
        <div class="header-right">
          <span class="credits-display"></span>
          <span class="parts-badge none">Parts: 0</span>
          <button type="button" class="repair-btn" disabled>Repair</button>
          <button type="button" class="close">Close</button>
        </div>
      </div>
      <div class="tabs">
        <button type="button" class="tab active" data-tab="cargo">Cargo</button>
        <button type="button" class="tab" data-tab="ore">Ore</button>
        <button type="button" class="tab" data-tab="parts">Ship parts</button>
        <button type="button" class="tab" data-tab="blueprints">Blueprints</button>
        <button type="button" class="tab" data-tab="skills">Skillbooks</button>
        <button type="button" class="tab" data-tab="stored">Stored assets</button>
        <button type="button" class="tab" data-tab="industry">Industry</button>
      </div>
      <div class="content"></div>
      <div class="float-resize" title="Resize" aria-label="Resize inventory"></div>
    </div>
  `
  container.appendChild(root)

  const panelEl = root.querySelector('.panel')
  const headerEl = root.querySelector('.header')
  const contentEl = root.querySelector('.content')
  const creditsEl = root.querySelector('.credits-display')
  const partsBadgeEl = root.querySelector('.parts-badge')
  const repairBtn = root.querySelector('.repair-btn')
  const resizeEl = root.querySelector('.float-resize')
  const tabButtons = [...root.querySelectorAll('.tab')]
  let currentTab = 'cargo'
  let isOpen = false

  const floating = wireFloatingPanel({
    panelEl,
    headerEl,
    resizeEl,
    storageKey: GEOM_LS_KEY,
    minW: 320,
    minH: 240,
    isActive: () => isOpen,
    defaultGeom: () =>
      defaultPanelGeom({
        fracW: 0.38,
        fracH: 0.62,
        maxW: 560,
        maxH: 640,
        minW: 320,
        minH: 240,
        align: 'right'
      })
  })

  function formatCredits(n) {
    return `${Math.max(0, Math.floor(Number(n) || 0)).toLocaleString()} cr`
  }

  function formatBodyKind(kind) {
    if (kind === 'station') return 'Station'
    if (kind === 'settlement') return 'Settlement'
    return kind || 'Facility'
  }

  function dockedBayId() {
    const id = gameState.player.dockedBodyId
    if (!id) return null
    const body = findBody(gameState.galaxy, id)
    if (!body || (body.kind !== 'station' && body.kind !== 'settlement')) return null
    return id
  }

  function xferEnabled() {
    return dockedBayId() != null
  }

  function xferAttrs(kind, id, qty) {
    if (!xferEnabled() || qty <= 0) return ''
    return ` draggable="true" data-from="ship" data-kind="${kind}" data-id="${escapeHtml(String(id))}" data-qty="${qty}"`
  }

  function xferClass(qty) {
    return xferEnabled() && qty > 0 ? ' xfer-item' : ''
  }

  function qtyMapBits(map, label, nameOf) {
    const rows = Object.entries(map ?? {}).filter(([, q]) => q > 0)
    if (!rows.length) return null
    return `${label}: ${rows.map(([id, q]) => {
      let name = id
      try { name = nameOf(id) } catch { /* keep id */ }
      return `${q} ${name}`
    }).join(', ')}`
  }

  function shipNeedsRepair(ship, shipClass) {
    return ship.hull < shipClass.stats.hull || ship.armor < shipClass.stats.armor
  }

  function updatePartsAndRepair() {
    const ship = gameState.player.ship
    const shipClass = getShipClass(ship.classId)
    const parts = ship.shipParts ?? 0
    const needsRepair = shipNeedsRepair(ship, shipClass)
    partsBadgeEl.textContent = `Parts: ${parts}`
    partsBadgeEl.classList.toggle('none', parts <= 0)
    partsBadgeEl.title = 'Ship parts on board'
    repairBtn.disabled = parts <= 0 || !needsRepair
    if (parts <= 0) repairBtn.title = 'No ship parts on board'
    else if (!needsRepair) repairBtn.title = 'No repair needed — hull and armour are full'
    else repairBtn.title = `Use 1 ship part (${parts} on board) — restores 10% hull/armour`
  }

  async function planDiscardQty(label, available) {
    const max = Math.max(0, Math.floor(available))
    if (max < 1) return 0
    const ans = await gamePrompt(
      'Jettison item',
      String(max === 1 ? 1 : max),
      {
        body: `Permanently destroy “${label}”? Enter quantity (max ${max}). Cannot be undone.`,
        okLabel: 'Destroy',
        cancelLabel: 'Cancel',
        maxLength: 10
      }
    )
    if (ans == null) return 0
    const n = Math.floor(Number(String(ans).trim()))
    if (!Number.isFinite(n) || n < 1) return 0
    return Math.min(max, n)
  }

  function itemLabel(kind, id) {
    if (kind === 'parts') return 'Ship Parts'
    if (kind === 'blueprint') {
      try { return getBlueprint(id).name } catch { return id }
    }
    if (kind === 'cargo' || kind === 'ore') {
      try { return getGood(id).name } catch { return id }
    }
    return id
  }

  async function resolveTransferQty(available, shiftKey, label) {
    if (available <= 0) return 0
    if (shiftKey || available === 1) return available
    const ans = await gamePrompt(
      'Transfer quantity',
      String(available),
      {
        body: `How many “${label}” to transfer? (max ${available})`,
        okLabel: 'Transfer',
        cancelLabel: 'Cancel',
        maxLength: 10
      }
    )
    if (ans == null) return 0
    const n = Math.floor(Number(String(ans).trim()))
    if (!Number.isFinite(n) || n < 1) return 0
    return Math.min(available, n)
  }

  function liveAvailable(payload, direction) {
    const bodyId = dockedBayId()
    if (!bodyId || !payload) return 0
    const { kind, id, from } = payload
    const fromShip = direction === 'toStation' || from === 'ship'
    const ship = gameState.player.ship
    const storage = gameState.stationStorage[bodyId] ?? {}
    if (kind === 'parts') {
      return fromShip ? (ship.shipParts ?? 0) : (storage.shipParts ?? 0)
    }
    if (kind === 'blueprint') {
      const map = fromShip ? (ship.blueprints ?? {}) : (storage.blueprints ?? {})
      return map[id] ?? 0
    }
    if (kind === 'cargo') {
      const map = fromShip ? (ship.cargo ?? {}) : (storage.cargo ?? {})
      return map[id] ?? 0
    }
    if (kind === 'ore') {
      const map = fromShip ? (ship.miningHold ?? {}) : (storage.miningHold ?? {})
      return map[id] ?? 0
    }
    return 0
  }

  async function performStorageTransfer(payload, direction, shiftKey) {
    const bodyId = dockedBayId()
    if (!bodyId || !payload) return
    const { kind, id } = payload
    const available = liveAvailable(payload, direction)
    const label = itemLabel(kind, id)
    const want = await resolveTransferQty(available, shiftKey, label)
    if (want < 1) return

    let result
    if (kind === 'blueprint') {
      result = transferBlueprintItem(gameState, bodyId, id, want, direction)
    } else {
      result = transferStorageItem(gameState, bodyId, kind, id, want, direction)
    }

    if (result.capacityLimited) {
      const hold = kind === 'ore' ? 'ore hold' : 'cargo hold'
      await gameNotice(
        'Hold full',
        result.moved > 0
          ? `Your ${hold} is full. Transferred ${result.moved} of ${want} ${label}; the rest stays where it was.`
          : `Your ${hold} is full — nothing transferred.`
      )
    }
    render()
    onStorageChanged?.()
  }

  function wireXferItems(rootEl) {
    rootEl.querySelectorAll('.xfer-item[draggable="true"]').forEach((el) => {
      el.addEventListener('dragstart', (e) => {
        const payload = {
          from: el.dataset.from,
          kind: el.dataset.kind,
          id: el.dataset.id,
          qty: Number(el.dataset.qty)
        }
        e.dataTransfer.setData(XFER_MIME, JSON.stringify(payload))
        e.dataTransfer.setData('text/plain', JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'move'
        el.classList.add('xfer-dragging')
        e.dataTransfer.setData('application/x-witv-shift', e.shiftKey ? '1' : '0')
      })
      el.addEventListener('dragend', () => {
        el.classList.remove('xfer-dragging')
        panelEl.classList.remove('drag-over')
      })
    })
  }

  function wireDropZone() {
    if (panelEl._xferDropWired) return
    panelEl._xferDropWired = true
    panelEl.classList.add('xfer-drop-target')
    panelEl.addEventListener('dragover', (e) => {
      if (!xferEnabled()) return
      const types = [...(e.dataTransfer?.types ?? [])]
      if (types.includes(XFER_MIME) || types.includes('text/plain') || types.includes('Text')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        panelEl.classList.add('drag-over')
      }
    })
    panelEl.addEventListener('dragleave', (e) => {
      if (!panelEl.contains(e.relatedTarget)) panelEl.classList.remove('drag-over')
    })
    panelEl.addEventListener('drop', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      panelEl.classList.remove('drag-over')
      if (!xferEnabled()) return
      let payload = null
      try {
        payload = JSON.parse(e.dataTransfer.getData(XFER_MIME) || e.dataTransfer.getData('text/plain') || 'null')
      } catch {
        return
      }
      // Only accept station → ship on the inventory panel.
      if (!payload || payload.from !== 'station') return
      const shiftKey = e.shiftKey || e.dataTransfer.getData('application/x-witv-shift') === '1'
      await performStorageTransfer(payload, 'toShip', shiftKey)
    })
  }
  wireDropZone()

  function wireInventoryDiscard(kind) {
    contentEl.querySelectorAll('button.discard-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id')
        const max = Math.max(0, Math.floor(Number(btn.getAttribute('data-qty')) || 0))
        let label = id
        try {
          label = getGood(id).name
        } catch {
          /* */
        }
        const qty = await planDiscardQty(label, max)
        if (qty < 1) return
        try {
          if (kind === 'ore') discardOre(gameState, id, qty, 'ship')
          else discardCargo(gameState, id, qty, 'ship')
          await gameNotice(`Destroyed ${qty}× ${label}.`)
          render()
          onStorageChanged?.()
        } catch (err) {
          await gameNotice(err?.message || String(err))
        }
      })
    })
  }

  function dockedXferHint(extra = '') {
    if (!xferEnabled()) return ''
    return `<p class="xfer-hint">Docked — drag items onto Station Services to store (or drop station items here).${extra ? ` ${extra}` : ''}</p>`
  }

  function renderCargoTab(ship, shipClass) {
    const cargoRows = Object.entries(ship.cargo).filter(([, qty]) => qty > 0)
    const used = cargoRows.reduce((a, [, q]) => a + q, 0)
    contentEl.innerHTML = `
      ${dockedXferHint()}
      <div class="hull-status" style="margin-bottom:10px;opacity:0.7">${used}/${shipClass.stats.cargoCapacity}</div>
      ${cargoRows.length
        ? `<table>
            <thead><tr><th>Good</th><th>Qty</th><th></th></tr></thead>
            <tbody>${cargoRows.map(([id, qty]) =>
              `<tr class="${xferClass(qty).trim()}"${xferAttrs('cargo', id, qty)}><td>${itemNameCell(goodIcon(id), getGood(id).name)}</td><td>${qty}</td><td><button type="button" class="discard-item" data-id="${escapeHtml(id)}" data-qty="${qty}">✕</button></td></tr>`
            ).join('')}</tbody>
          </table>`
        : '<div class="empty">Empty</div>'}
    `
    wireInventoryDiscard('cargo')
    if (xferEnabled()) wireXferItems(contentEl)
  }

  function renderPartsTab(ship, shipClass) {
    const parts = ship.shipParts ?? 0
    const hull = Math.round(ship.hull)
    const armor = Math.round(ship.armor)
    const spareWeaponRows = Object.entries(ship.spareWeapons ?? {}).filter(([, qty]) => qty > 0)
    const bodyId = dockedBayId()
    contentEl.innerHTML = `
      ${dockedXferHint('Ship parts transfer to bay storage.')}
      <div class="hull-status">${parts} part${parts === 1 ? '' : 's'} · Hull ${hull}/${shipClass.stats.hull} · Armour ${armor}/${shipClass.stats.armor}</div>
      ${parts > 0
        ? `<div class="xfer-parts${xferClass(parts)}"${xferAttrs('parts', 'ship_parts', parts)}>${itemNameCell(itemIcon('parts'), `${parts} on board`)} — drag to station</div>`
        : ''}
      ${bodyId && spareWeaponRows.length
        ? `<p class="tab-meta" style="margin-top:14px">Salvaged weapons (×${spareWeaponRows.reduce((a, [, q]) => a + q, 0)}) — store at this bay or sell in Shipyard → Armoury.
            <button type="button" class="dock-action store-weapons">Store at bay</button></p>`
        : spareWeaponRows.length
          ? `<p class="tab-meta" style="margin-top:14px">Salvaged weapons: sell or store when docked (Shipyard → Armoury).</p>`
          : ''}
    `
    contentEl.querySelector('.store-weapons')?.addEventListener('click', () => {
      const id = dockedBayId()
      if (!id) return
      storeCarriedWeapons(gameState, id)
      render()
      onStorageChanged?.()
    })
    if (xferEnabled()) wireXferItems(contentEl)
  }

  function renderOreTab(ship, shipClass) {
    const oreRows = Object.entries(ship.miningHold).filter(([, qty]) => qty > 0)
    const used = oreRows.reduce((a, [, q]) => a + q, 0)
    const cap = effectiveMiningCapacity(ship, shipClass)
    contentEl.innerHTML = `
      ${dockedXferHint()}
      <div class="hull-status" style="margin-bottom:10px;opacity:0.7">${used}/${cap}</div>
      ${oreRows.length
        ? `<table>
            <thead><tr><th>Ore</th><th>Qty</th><th></th></tr></thead>
            <tbody>${oreRows.map(([id, qty]) =>
              `<tr class="${xferClass(qty).trim()}"${xferAttrs('ore', id, qty)}><td>${itemNameCell(goodIcon(id), getGood(id).name)}</td><td>${qty}</td><td><button type="button" class="discard-item" data-id="${escapeHtml(id)}" data-qty="${qty}">✕</button></td></tr>`
            ).join('')}</tbody>
          </table>`
        : '<div class="empty">Empty</div>'}
    `
    wireInventoryDiscard('ore')
    if (xferEnabled()) wireXferItems(contentEl)
  }

  function renderSkillsTab(ship) {
    ensureSkills(gameState)
    const skills = gameState.player.skills
    // Only books currently on board — not the full skill tree.
    const bookRows = Object.entries(ship.skillbooks ?? {})
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => {
        try {
          return getSkillDef(a[0]).name.localeCompare(getSkillDef(b[0]).name)
        } catch {
          return String(a[0]).localeCompare(String(b[0]))
        }
      })
    contentEl.innerHTML = bookRows.length
      ? `<table>
            <thead><tr><th>Skillbook</th><th>Qty</th><th>Level</th><th></th></tr></thead>
            <tbody>
              ${bookRows.map(([skillId, qty]) => {
                let def
                try {
                  def = getSkillDef(skillId)
                } catch {
                  def = { name: skillId, bookName: skillId, description: '' }
                }
                const lv = skillLevel(skills, skillId)
                const maxed = lv >= MAX_SKILL_LEVEL
                return `<tr>
                  <td>
                    <div>${itemNameCell(itemIcon('skillbook'), def.bookName || def.name)}</div>
                    <div style="opacity:0.55;font-size:10px;max-width:320px;padding-left:26px">${escapeHtml(def.description || '')}</div>
                  </td>
                  <td>×${qty}</td>
                  <td>${lv} / ${MAX_SKILL_LEVEL}</td>
                  <td>${
                    maxed
                      ? '<span style="opacity:0.5">Maxed</span>'
                      : `<button type="button" class="use-skillbook" data-skill="${escapeHtml(skillId)}">Read</button>`
                  }</td>
                </tr>`
              }).join('')}
            </tbody>
          </table>`
      : '<div class="empty">Empty</div>'
    contentEl.querySelectorAll('.use-skillbook').forEach((btn) => {
      btn.addEventListener('click', () => {
        const skillId = btn.getAttribute('data-skill')
        const r = useSkillbook(gameState, skillId)
        if (!r.ok) {
          gameNotice(r.reason || 'Cannot read skillbook')
          return
        }
        gameNotice(`Read skillbook — ${r.name} is now level ${r.level}.`)
        render()
      })
    })
  }

  function renderBlueprintsTab(ship) {
    ensureBlueprintMaps(gameState)
    const bpRows = Object.entries(ship.blueprints ?? {}).filter(([, qty]) => qty > 0)
    const total = bpRows.reduce((a, [, q]) => a + q, 0)
    const byKind = { ship: [], accessory: [], weapon: [], other: [] }
    for (const [id, qty] of bpRows) {
      let bp
      try {
        bp = getBlueprint(id)
      } catch {
        byKind.other.push({ id, qty, name: id, kind: 'unknown' })
        continue
      }
      const bucket = byKind[bp.kind] ? bp.kind : 'other'
      byKind[bucket].push({ id, qty, name: bp.name ?? bp.itemName ?? id, itemName: bp.itemName, kind: bp.kind })
    }
    for (const list of Object.values(byKind)) {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name)))
    }
    const bodyId = dockedBayId()
    function section(title, rows, blueprintKind) {
      if (!rows.length) return ''
      return `
        <h3 style="margin-top:14px">${escapeHtml(title)}</h3>
        <table>
          <thead><tr><th>Blueprint</th><th>Builds</th><th>Qty</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr class="${xferClass(r.qty).trim()}"${xferAttrs('blueprint', r.id, r.qty)}>
              <td>${itemNameCell(itemIcon('blueprint', { blueprintKind }), r.name)}</td>
              <td>${escapeHtml(r.itemName ?? '—')}</td>
              <td>×${r.qty}</td>
            </tr>`).join('')}</tbody>
        </table>`
    }
    contentEl.innerHTML = total
      ? `${dockedXferHint('Blueprints assemble from station Industry storage.')}
           ${bodyId
             ? `<p class="tab-meta"><button type="button" class="dock-action store-all-bps">Store all at bay</button></p>`
             : ''}
           ${section('Ships', byKind.ship, 'ship')}
           ${section('Accessories', byKind.accessory, 'accessory')}
           ${section('Weapons', byKind.weapon, 'weapon')}
           ${section('Other', byKind.other, 'ship')}`
      : `<div class="empty">Empty</div>${dockedXferHint()}`
    contentEl.querySelector('.store-all-bps')?.addEventListener('click', () => {
      const id = dockedBayId()
      if (!id) return
      storeBlueprints(gameState, id)
      render()
      onStorageChanged?.()
    })
    if (xferEnabled()) wireXferItems(contentEl)
  }

  function renderStoredTab() {
    const dockedBodyId = gameState.player.dockedBodyId ?? null
    const remoteEntries = Object.entries(gameState.stationStorage ?? {}).filter(([, s]) =>
      storageHasAssets(s)
    )
    contentEl.innerHTML = remoteEntries.length
      ? remoteEntries
            .map(([bodyId, s]) => {
              const body = findBody(gameState.galaxy, bodyId)
              const system = findSystemOfBody(gameState.galaxy, bodyId)
              const bodyName = body?.name ?? bodyId
              const kindLabel = formatBodyKind(body?.kind)
              const systemName = system?.name ?? 'Unknown system'
              const isHere = dockedBodyId != null && bodyId === dockedBodyId
              const bits = []
              const cargoBit = qtyMapBits(s.cargo, 'Cargo', (id) => getGood(id).name)
              const oreBit = qtyMapBits(s.miningHold, 'Ore', (id) => getGood(id).name)
              if (cargoBit) bits.push(cargoBit)
              if (oreBit) bits.push(oreBit)
              if ((s.shipParts ?? 0) > 0) bits.push(`${s.shipParts} Ship Part(s)`)
              if (s.ships?.length) {
                bits.push(
                  `${s.ships.length} stored ship(s): ${s.ships.map((sh) => escapeHtml(sh.instanceName)).join(', ')}`
                )
              }
              const weaponBit = qtyMapBits(s.weapons, 'Weapons', (id) => getWeapon(id).name)
              const accBit = qtyMapBits(s.accessories, 'Accessories', (id) => getAccessory(id).name)
              if (weaponBit) bits.push(weaponBit)
              if (accBit) bits.push(accBit)
              const bpRows = Object.entries(s.blueprints ?? {}).filter(([, q]) => q > 0)
              if (bpRows.length) {
                bits.push(`Blueprints: ${bpRows.reduce((a, [, q]) => a + q, 0)}`)
              }
              return `<div class="remote-station">
          <h4>${escapeHtml(bodyName)} <span style="opacity:0.55;font-size:11px">(${escapeHtml(kindLabel)})</span></h4>
          <div class="location">System: <span class="sys">${escapeHtml(systemName)}</span>${isHere ? '<span class="here">· docked here</span>' : ''}</div>
          <div class="assets">${bits.join(' · ') || '—'}</div>
        </div>`
            })
            .join('')
      : '<div class="empty">Empty</div>'
  }

  function renderIndustryTab() {
    const now = Date.now()
    // In-progress jobs only (finished ones are removed after delivery).
    const jobs = gameState.craftingJobs ?? []
    contentEl.innerHTML = jobs.length
      ? jobs
            .map((job) => {
              let name = job.blueprintId
              try {
                name = getBlueprint(job.blueprintId).itemName
              } catch {
                /* */
              }
              const rem = craftRemainingS(job, now)
              const pct = Math.min(
                100,
                Math.round((1 - rem / Math.max(1, job.durationS)) * 100)
              )
              const systemName = job.systemName ?? 'Unknown system'
              const stationName = job.stationName ?? job.bodyId ?? 'Unknown bay'
              return `
            <div class="job-row">
              <div class="job-name">${escapeHtml(name)}</div>
              <div class="job-meta">
                <span class="job-loc">${escapeHtml(systemName)}</span>
                · ${escapeHtml(stationName)}
                · ${formatDuration(rem)} remaining
              </div>
              <div class="craft-progress"><div class="fill" style="width:${pct}%"></div></div>
            </div>`
            })
            .join('')
      : '<div class="empty">Empty</div>'
  }

  function render() {
    if (!isOpen) return
    creditsEl.textContent = formatCredits(gameState.player.credits)
    updatePartsAndRepair()
    const ship = gameState.player.ship
    const shipClass = getShipClass(ship.classId)
    tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === currentTab))

    if (currentTab === 'cargo') renderCargoTab(ship, shipClass)
    else if (currentTab === 'ore') renderOreTab(ship, shipClass)
    else if (currentTab === 'parts') renderPartsTab(ship, shipClass)
    else if (currentTab === 'blueprints') renderBlueprintsTab(ship)
    else if (currentTab === 'skills') renderSkillsTab(ship)
    else if (currentTab === 'stored') renderStoredTab()
    else renderIndustryTab()
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab
      render()
    })
  )

  let floatToastTimer = null
  function showFloatToast(msg) {
    let el = root.querySelector('.inv-float-toast')
    if (!el) {
      el = document.createElement('div')
      el.className = 'inv-float-toast'
      root.appendChild(el)
    }
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(floatToastTimer)
    floatToastTimer = setTimeout(() => el.classList.remove('show'), 2200)
  }

  repairBtn.addEventListener('click', async () => {
    const ship = gameState.player.ship
    const shipClass = getShipClass(ship.classId)
    if ((ship.shipParts ?? 0) <= 0 || !shipNeedsRepair(ship, shipClass)) return
    try {
      useShipPart(gameState)
      const hull = Math.round(ship.hull)
      const armor = Math.round(ship.armor)
      showFloatToast(`Repaired · ${ship.shipParts ?? 0} parts left · H${hull} A${armor}`)
    } catch (err) {
      if (err?.message === 'No repair needed') showFloatToast('No repair needed')
      else await gameNotice('Repair failed', err.message)
    }
    render()
  })

  let onCloseCallback = null

  function hidePanel() {
    isOpen = false
    root.classList.remove('is-open')
    root.style.display = 'none'
  }

  root.querySelector('.close').addEventListener('click', () => {
    hidePanel()
    onCloseCallback?.()
  })

  return {
    show(onClose) {
      onCloseCallback = onClose
      currentTab = 'cargo'
      isOpen = true
      floating.restore()
      root.classList.add('is-open')
      root.style.display = 'block'
      render()
    },
    hide: hidePanel,
    refresh() {
      if (isOpen) render()
    },
    isOpen() {
      return isOpen
    },
    element: root
  }
}
