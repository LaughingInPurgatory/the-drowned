import { escapeHtml } from './escapeHtml.js'

// Shared in-game modal dialogs. Electron often blocks window.alert / confirm /
// prompt — every UI path should use these instead.

const STYLE_ID = 'game-dialog-style'
const OVERLAY_CLASS = 'game-dialog-overlay'

const STYLE = `
.${OVERLAY_CLASS} {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b),0.62);
  font-family: monospace; color: var(--ui-text);
  pointer-events: auto;
}
.${OVERLAY_CLASS} .game-dialog {
  width: min(420px, 92vw); padding: 18px 20px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.98), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.95));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
.${OVERLAY_CLASS} .game-dialog .prompt-title {
  font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--ui-accent); margin-bottom: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
.${OVERLAY_CLASS} .game-dialog .prompt-body {
  font-size: 13px; line-height: 1.45; color: var(--ui-text); opacity: 0.92;
  margin-bottom: 14px; white-space: pre-wrap;
}
.${OVERLAY_CLASS} .game-dialog input {
  width: 100%; box-sizing: border-box; margin-bottom: 12px;
  background: rgba(var(--ui-bg-track-r),var(--ui-bg-track-g),var(--ui-bg-track-b),0.95); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  color: var(--ui-text); padding: 8px 10px; font-family: monospace; font-size: 13px;
}
.${OVERLAY_CLASS} .game-dialog input:focus {
  outline: none; border-color: var(--ui-accent); box-shadow: 0 1px 3px rgba(0,0,0,0.7);
}
.${OVERLAY_CLASS} .game-dialog .prompt-actions {
  display: flex; justify-content: flex-end; gap: 8px;
}
.${OVERLAY_CLASS} .game-dialog button.prompt-ok {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.15); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5); color: var(--ui-text);
  padding: 6px 14px; cursor: pointer; font-family: monospace; letter-spacing: 0.5px;
}
.${OVERLAY_CLASS} .game-dialog button.prompt-cancel {
  background: rgba(224,90,90,0.12); border: 1px solid rgba(224,90,90,0.45); color: #ffb3b3;
  padding: 6px 14px; cursor: pointer; font-family: monospace; letter-spacing: 0.5px;
}
.${OVERLAY_CLASS} .game-dialog button.prompt-ok:hover { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.28); }
.${OVERLAY_CLASS} .game-dialog button.prompt-cancel:hover { background: rgba(224,90,90,0.22); }
.${OVERLAY_CLASS} .game-dialog.danger { border-left-color: #e05a5a; }
.${OVERLAY_CLASS} .game-dialog.danger .prompt-title { color: #ffb3b3; text-shadow: 0 1px 2px rgba(0,0,0,0.9); }
.${OVERLAY_CLASS} .game-dialog.danger button.prompt-ok {
  background: rgba(224,90,90,0.15); border-color: rgba(224,90,90,0.55); color: #ffb3b3;
}
.${OVERLAY_CLASS} .game-dialog.danger button.prompt-ok:hover { background: rgba(224,90,90,0.28); }
`

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.appendChild(style)
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.body]
 * @param {string|null} [opts.defaultValue] - null = no input; string = text prompt
 * @param {string} [opts.okLabel]
 * @param {string|null} [opts.cancelLabel] - null = notice (OK only)
 * @param {number} [opts.maxLength]
 * @param {boolean} [opts.danger]
 * @param {HTMLElement} [opts.parent]
 * @returns {Promise<string|boolean|null>}
 *   notice: true
 *   confirm: true (ok) / false (cancel)
 *   prompt: string (ok) / null (cancel)
 */
export function openGameDialog({
  title,
  body = '',
  defaultValue = null,
  okLabel = 'OK',
  cancelLabel = null,
  maxLength = 40,
  danger = false,
  parent = document.body
} = {}) {
  ensureStyle()
  // One modal at a time — drop any prior overlay.
  document.querySelector(`.${OVERLAY_CLASS}`)?.remove()

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = OVERLAY_CLASS
    const hasInput = defaultValue !== null
    const hasCancel = cancelLabel != null
    overlay.innerHTML = `
      <div class="game-dialog${danger ? ' danger' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="prompt-title">${escapeHtml(title)}</div>
        ${body ? `<div class="prompt-body">${escapeHtml(body)}</div>` : ''}
        ${hasInput ? `<input type="text" maxlength="${maxLength}" />` : ''}
        <div class="prompt-actions">
          ${hasCancel ? `<button type="button" class="prompt-cancel">${escapeHtml(cancelLabel)}</button>` : ''}
          <button type="button" class="prompt-ok">${escapeHtml(okLabel)}</button>
        </div>
      </div>
    `
    parent.appendChild(overlay)

    const input = overlay.querySelector('input')
    if (input) {
      input.value = defaultValue ?? ''
      input.focus()
      input.select()
    } else {
      overlay.querySelector('.prompt-ok')?.focus()
    }

    const finish = (value) => {
      document.removeEventListener('keydown', onKeyCapture, true)
      overlay.remove()
      resolve(value)
    }

    const accept = () => finish(hasInput ? input.value : true)
    const cancel = () => finish(hasInput ? null : hasCancel ? false : true)

    overlay.querySelector('.prompt-ok').addEventListener('click', accept)
    overlay.querySelector('.prompt-cancel')?.addEventListener('click', cancel)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel()
    })

    // Capture so Enter isn't eaten by flight handlers. Esc does not dismiss —
    // use OK / Cancel buttons (same rule as other game windows).
    function onKeyCapture(e) {
      if (!overlay.isConnected) return
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        accept()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKeyCapture, true)
  })
}

/** Blocking-style notice. Resolves when the player dismisses. */
export function gameNotice(title, body = '', okLabel = 'OK') {
  return openGameDialog({ title, body, okLabel, cancelLabel: null })
}

/** Yes/no. Resolves true on confirm, false on cancel. */
export function gameConfirm(title, body = '', { okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return openGameDialog({ title, body, okLabel, cancelLabel, danger }).then((v) => v === true)
}

/** Text input. Resolves string on OK, null on cancel. */
export function gamePrompt(title, defaultValue = '', { body = '', okLabel = 'OK', cancelLabel = 'Cancel', maxLength = 40 } = {}) {
  return openGameDialog({
    title,
    body,
    defaultValue: defaultValue ?? '',
    okLabel,
    cancelLabel,
    maxLength
  })
}
