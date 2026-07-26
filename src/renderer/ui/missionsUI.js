import { findBody, getSystem } from '../procgen/galaxy.js'
import { dropMission, missionNavTarget, setWaypointForMission } from '../game/missions.js'
import { escapeHtml } from './escapeHtml.js'
import { gameConfirm, gameNotice } from './gameDialog.js'

const STYLE = `
/* Above docking chrome (z 50) so the tracker opens while docked. */
#missions-ui { position: fixed; inset: 0; background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b),0.75); backdrop-filter: blur(2px); font-family: monospace; color: var(--ui-text); display: none; align-items: center; justify-content: center; z-index: 55; }
#missions-ui .panel {
  width: 700px; max-height: 80vh; overflow-y: auto; padding: 18px 22px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.95), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.9));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 3px solid #ff8a3d;
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#missions-ui h2 { font-weight: normal; letter-spacing: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#missions-ui h3 { font-weight: normal; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #ffb07a; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); margin: 4px 0 12px; }
#missions-ui .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
#missions-ui .empty { opacity: 0.5; font-size: 13px; line-height: 1.5; }
#missions-ui .mission {
  margin-bottom: 14px; padding: 12px 14px;
  background: rgba(8,12,22,0.55); border: 1px solid rgba(255,138,61,0.25);
  border-left: 3px solid #ff8a3d;
}
#missions-ui .mission.ready { border-left-color: #7fe0a0; border-color: rgba(127,224,160,0.3); }
#missions-ui .mission .title { font-size: 14px; color: #ffe0c2; margin-bottom: 6px; }
#missions-ui .mission .meta { font-size: 12px; opacity: 0.85; margin-bottom: 4px; }
#missions-ui .mission .status { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 8px 0; }
#missions-ui .mission .status.progress { color: #ffb07a; }
#missions-ui .mission .status.ready { color: #7fe0a0; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#missions-ui .log {
  margin: 10px 0 6px; padding: 8px 0 8px 12px;
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25);
  position: relative;
}
#missions-ui .log-title {
  font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--ui-accent-mid); opacity: 0.85; margin-bottom: 8px;
}
#missions-ui .log-entry {
  position: relative; font-size: 11px; line-height: 1.45;
  margin: 0 0 8px; padding-left: 14px; color: #b8d0e8;
}
#missions-ui .log-entry::before {
  content: ''; position: absolute; left: -13px; top: 5px;
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--ui-glow); box-shadow: 0 1px 2px rgba(0,0,0,0.85);
}
#missions-ui .log-entry.lead::before { background: #ffb07a; box-shadow: 0 1px 2px rgba(0,0,0,0.85); }
#missions-ui .log-entry.hostile::before { background: #e05a5a; box-shadow: 0 1px 2px rgba(0,0,0,0.85); }
#missions-ui .log-entry.intel::before { background: #7fe0a0; box-shadow: 0 1px 2px rgba(0,0,0,0.85); }
#missions-ui .log-entry .tag {
  display: inline-block; font-size: 9px; letter-spacing: 1px; text-transform: uppercase;
  margin-right: 6px; opacity: 0.7;
}
#missions-ui .chain-badge {
  display: inline-block; margin-left: 8px; padding: 1px 7px;
  font-size: 10px; letter-spacing: 1px; color: #ffd0a8;
  border: 1px solid rgba(255,138,61,0.45); border-radius: 2px;
  background: rgba(255,138,61,0.1);
}
#missions-ui button.close {
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.5); color: #ffb3b3;
  padding: 7px 16px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#missions-ui button.close:hover { background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#missions-ui button.track {
  background: rgba(255,138,61,0.12); border: 1px solid rgba(255,138,61,0.5); color: #ffd0a8;
  padding: 5px 12px; cursor: pointer; font-family: monospace; margin-top: 4px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#missions-ui button.track:hover { background: rgba(255,138,61,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#missions-ui button.drop {
  background: rgba(224,90,90,0.1); border: 1px solid rgba(224,90,90,0.45); color: #ffb3b3;
  padding: 5px 12px; cursor: pointer; font-family: monospace; margin-top: 4px; margin-left: 8px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#missions-ui button.drop:hover { background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
#missions-ui .mission-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0; }
#missions-ui .footer-note { margin-top: 14px; font-size: 11px; opacity: 0.55; line-height: 1.4; }
`

function describeTarget(mission, gameState) {
  const t = missionNavTarget(mission, gameState)
  const system = getSystem(gameState.galaxy, t.systemId)
  const systemName = system?.name ?? t.systemId
  if (mission.type === 'trade' && mission.trade) {
    const tr = mission.trade
    const need = tr.quantity ?? 0
    const bought = tr.purchased ?? 0
    const sold = tr.sold ?? 0
    const body = findBody(gameState.galaxy, t.bodyId)
    const goDest = sold < need && bought > sold
    if (goDest || (bought >= need && sold < need)) {
      return `Sell ${sold}/${need} at ${body?.name ?? 'destination'} · ${systemName} (bought ${bought}/${need})`
    }
    return `Buy ${bought}/${need} at ${body?.name ?? 'origin'} · ${systemName} (sold ${sold}/${need})`
  }
  if (t.bodyId) {
    const body = findBody(gameState.galaxy, t.bodyId)
    return `Objective: ${body?.name ?? t.bodyId} · ${systemName}`
  }
  return `Objective: hostile target · ${systemName}`
}

function renderLog(mission) {
  const log = mission.log
  if (!log?.length) return ''
  return `
    <div class="log">
      <div class="log-title">Mission log</div>
      ${log.map((e) => `
        <div class="log-entry ${escapeHtml(e.kind)}">
          <span class="tag">${escapeHtml(e.kind)}</span>${escapeHtml(e.text)}
        </div>
      `).join('')}
    </div>
  `
}

export function createMissionsUI(container, gameState, hooks = {}) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'missions-ui'
  root.innerHTML = `
    <div class="panel">
      <div class="header">
        <h2>Missions</h2>
        <button class="close">Close</button>
      </div>
      <div class="content"></div>
    </div>
  `
  container.appendChild(root)

  const contentEl = root.querySelector('.content')

  function render() {
    const active = gameState.missions.active
    if (!active.length) {
      contentEl.innerHTML = `
        <div class="empty">No active missions.<br/>Accept contracts from station and settlement mission boards while docked.</div>
        <div class="footer-note">Orange rings on the galaxy map mark systems with an active objective. Green rings mark remote systems where you have stored assets. Set Waypoint only works while you are in the objective system. Missions complete automatically when the objective is done.</div>
      `
      return
    }

    contentEl.innerHTML = `
      <h3>Active (${active.length})</h3>
      ${active.map((m) => {
        const leads = m.leads ?? 0
        const chain = m.type === 'investigation' && leads > 0
          ? `<span class="chain-badge">Chain ×${leads}</span>`
          : ''
        const progress =
          m.type === 'trade' && m.trade
            ? (() => {
                const need = m.trade.quantity ?? 0
                const bought = m.trade.purchased ?? 0
                const sold = m.trade.sold ?? 0
                return `Trade progress · bought ${bought}/${need} · sold ${sold}/${need} (multi-trip OK)`
              })()
            : 'In progress'
        return `
          <div class="mission">
            <div class="title">${escapeHtml(m.title)}${chain}</div>
            <div class="meta">${escapeHtml(m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : '')} · Reward ${m.reward}cr</div>
            <div class="meta">${escapeHtml(describeTarget(m, gameState))}</div>
            ${renderLog(m)}
            <div class="status progress">${progress}</div>
            <div class="mission-actions">
              <button class="track" data-id="${m.id}">Set Waypoint</button>
              <button class="drop" data-id="${m.id}">Drop Mission</button>
            </div>
          </div>
        `
      }).join('')}
      <div class="footer-note">Drop Mission abandons the contract with no reward. Completing the objective pays the reward immediately (no station turn-in). Investigations: probe the target (P). Logs track leads, hostiles, and intel. Each lead raises the payout 5%.</div>
    `

    contentEl.querySelectorAll('.track').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          if (hooks.canSetWaypoint && !hooks.canSetWaypoint()) return
          setWaypointForMission(gameState, btn.dataset.id)
          render()
        } catch (err) {
          await gameNotice('Waypoint', err.message)
        }
      })
    )
    contentEl.querySelectorAll('.drop').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const mission = gameState.missions.active.find((m) => m.id === btn.dataset.id)
        const title = mission?.title ?? 'this mission'
        const ok = await gameConfirm(
          'Drop Mission',
          `Drop "${title}"?\nYou will receive no reward.`,
          { okLabel: 'Drop', cancelLabel: 'Cancel', danger: true }
        )
        if (!ok) return
        try {
          dropMission(gameState, btn.dataset.id)
          render()
        } catch (err) {
          await gameNotice('Drop failed', err.message)
        }
      })
    )
  }

  root.querySelector('.close').addEventListener('click', () => {
    root.style.display = 'none'
    onCloseCallback?.()
  })

  let onCloseCallback = null

  return {
    show(onClose) {
      onCloseCallback = onClose
      render()
      root.style.display = 'flex'
    },
    hide() {
      root.style.display = 'none'
    },
    element: root
  }
}
