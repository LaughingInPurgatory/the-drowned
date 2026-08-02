import * as THREE from 'three'
import { escapeHtml } from './escapeHtml.js'
import {
  HEAD_VARIATIONS,
  UPPER_BODY_VARIATIONS,
  LOWER_BODY_VARIATIONS,
  normalizeAvatarSelection
} from '../render/playerAvatarVariants.js'
import { buildPlayerAvatarMesh } from '../render/playerAvatarMesh.js'

export const AVATAR_PICKER_CSS = `
.avatar-picker { display:flex; flex-direction:column; gap:7px; margin-top:4px; }
.avatar-picker .avatar-picker-row { display:grid; grid-template-columns:92px 1fr; gap:8px; align-items:center; }
.avatar-picker .avatar-picker-row > span { color:var(--ui-dim); font-size:10px; letter-spacing:1px; text-transform:uppercase; }
.avatar-picker .avatar-part-button { min-width:0; width:100%; display:flex; justify-content:space-between; gap:8px; padding:6px 8px; cursor:pointer; background:var(--ui-bg-solid); border:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35); color:var(--ui-bright); font:11px monospace; text-align:left; }
.avatar-picker .avatar-part-button:hover, .avatar-picker .avatar-part-button:focus { outline:none; border-color:var(--ui-glow); box-shadow:0 1px 3px rgba(0,0,0,0.7); }
.avatar-picker .avatar-part-button::after { content:'▸'; color:var(--ui-accent); }
.avatar-picker-modal { position:fixed; inset:0; z-index:260000; display:grid; place-items:center; padding:20px; background:rgba(3,7,12,0.72); font-family:monospace; color:var(--ui-text); }
.avatar-picker-modal .avatar-picker-window { width:min(780px,96vw); max-height:min(680px,94vh); overflow:auto; padding:14px; background:linear-gradient(135deg,rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),.98),rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),.98)); border:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),.55); box-shadow:0 12px 40px rgba(0,0,0,.85); }
.avatar-picker-modal .avatar-picker-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:10px; color:var(--ui-accent); letter-spacing:1.5px; font-size:12px; text-transform:uppercase; }
.avatar-picker-modal .avatar-picker-close { width:26px; height:26px; padding:0; cursor:pointer; color:var(--ui-pale); background:rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),.12); border:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),.4); font:18px monospace; }
.avatar-picker-modal .avatar-picker-close:hover { background:rgba(224,90,90,.2); }
.avatar-picker-modal canvas { display:block; width:100%; height:390px; cursor:pointer; background:linear-gradient(#172a31,#0c161b); border:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),.24); }
.avatar-picker-modal .avatar-option-grid { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:6px; margin-top:8px; }
.avatar-picker-modal .avatar-option { min-height:38px; padding:5px 3px; cursor:pointer; color:var(--ui-dim); background:rgba(8,12,22,.62); border:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),.22); font:9px monospace; line-height:1.25; }
.avatar-picker-modal .avatar-option:hover, .avatar-picker-modal .avatar-option.selected { color:var(--ui-bright); border-color:var(--ui-accent); background:rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),.2); }
@media (max-width:560px) { .avatar-picker-modal { padding:8px; } .avatar-picker-modal canvas { height:330px; } .avatar-picker-modal .avatar-option-grid { gap:3px; } .avatar-picker-modal .avatar-option { font-size:8px; } }
`

const PARTS = [
  ['headId', 'Head', HEAD_VARIATIONS],
  ['upperBodyId', 'Upper body', UPPER_BODY_VARIATIONS],
  ['lowerBodyId', 'Lower body', LOWER_BODY_VARIATIONS]
]

function optionLabel(item) {
  return `${item.gender === 'female' ? 'F' : 'M'} · ${item.name}`
}

let activeAvatarPickerModal = null

function closeAvatarPickerModal() {
  activeAvatarPickerModal?.close?.()
  activeAvatarPickerModal = null
}

function createAvatarPickerModal({ key, current, onSelect }) {
  closeAvatarPickerModal()
  const part = PARTS.find(([partKey]) => partKey === key)
  if (!part) return
  const [, label, list] = part
  const modal = document.createElement('div')
  modal.className = 'avatar-picker-modal'
  modal.innerHTML = `<section class="avatar-picker-window" role="dialog" aria-modal="true" aria-label="Choose ${escapeHtml(label)}">
    <div class="avatar-picker-head"><span>Choose ${escapeHtml(label)}</span><button type="button" class="avatar-picker-close" aria-label="Close">×</button></div>
    <canvas aria-label="Clickable ${escapeHtml(label)} model previews"></canvas>
    <div class="avatar-option-grid"></div>
  </section>`
  document.body.appendChild(modal)

  const canvas = modal.querySelector('canvas')
  const optionGrid = modal.querySelector('.avatar-option-grid')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(Math.max(1, canvas.clientWidth), 390, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x102027)
  scene.add(new THREE.HemisphereLight(0xd9e5e5, 0x18201f, 2.4))
  const keyLight = new THREE.DirectionalLight(0xffe1ab, 3.0)
  keyLight.position.set(-5, 8, 9)
  keyLight.castShadow = true
  scene.add(keyLight)
  const fill = new THREE.DirectionalLight(0x79a9bd, 1.2)
  fill.position.set(5, 4, -8)
  scene.add(fill)

  const camera = new THREE.OrthographicCamera(-6.2, 6.2, 2.4, -3.4, 0.1, 30)
  camera.position.set(0, 0, 14)
  camera.lookAt(0, -0.75, 0)
  const choices = []
  for (let index = 0; index < list.length; index++) {
    const selection = { ...current, [key]: index }
    const avatar = buildPlayerAvatarMesh(selection)
    avatar.position.set((index % 5 - 2) * 2.35, index < 5 ? -0.45 : -2.82, 0)
    avatar.scale.multiplyScalar(0.92)
    avatar.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    scene.add(avatar)
    choices.push(avatar)

    const button = document.createElement('button')
    button.type = 'button'
    button.className = `avatar-option${index === current[key] ? ' selected' : ''}`
    button.textContent = optionLabel(list[index])
    button.addEventListener('click', () => onSelect(index))
    optionGrid.appendChild(button)
  }

  const pickAtCanvas = (event) => {
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width - 1, event.clientX - rect.left))
    const y = Math.max(0, Math.min(rect.height - 1, event.clientY - rect.top))
    const col = Math.max(0, Math.min(4, Math.floor((x / rect.width) * 5)))
    const row = y < rect.height * 0.5 ? 0 : 1
    const index = row * 5 + col
    if (list[index]) onSelect(index)
  }
  canvas.addEventListener('click', pickAtCanvas)
  modal.querySelector('.avatar-picker-close').addEventListener('click', closeAvatarPickerModal)
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAvatarPickerModal()
  })

  let raf = 0
  const render = () => {
    if (!modal.isConnected) return
    const turn = Math.sin(performance.now() * 0.00045) * 0.12
    for (const avatar of choices) avatar.rotation.y = turn
    renderer.render(scene, camera)
    raf = requestAnimationFrame(render)
  }
  render()

  const close = () => {
    cancelAnimationFrame(raf)
    for (const avatar of choices) {
      avatar.traverse((child) => {
        child.geometry?.dispose?.()
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        for (const material of materials) material?.dispose?.()
      })
    }
    renderer.dispose()
    modal.remove()
  }
  activeAvatarPickerModal = { close }
}

export function avatarPickerHTML(prefix = 'avatar') {
  return `<div class="avatar-picker" data-avatar-picker="${escapeHtml(prefix)}">
    ${PARTS.map(([key, label]) => `
      <div class="avatar-picker-row">
        <span>${escapeHtml(label)}</span>
        <button type="button" class="avatar-part-button" data-avatar-part="${key}" aria-label="Choose ${escapeHtml(label)}"><span data-avatar-part-value="${key}"></span></button>
      </div>
    `).join('')}
  </div>`
}

export function bindAvatarPicker(root, value, onChange = null) {
  const picker = root?.querySelector?.('.avatar-picker')
  if (!picker) return { refresh() {}, getValue: () => normalizeAvatarSelection(value) }
  const buttons = Object.fromEntries(PARTS.map(([key]) => [key, picker.querySelector(`[data-avatar-part="${key}"]`)]))
  let current = normalizeAvatarSelection(value)
  const refresh = (next = current) => {
    current = normalizeAvatarSelection(next)
    for (const [key, button] of Object.entries(buttons)) {
      const item = PARTS.find(([partKey]) => partKey === key)?.[2]?.[current[key]]
      const valueEl = button?.querySelector(`[data-avatar-part-value="${key}"]`)
      if (valueEl) valueEl.textContent = item ? optionLabel(item) : 'Select'
    }
  }
  for (const [key, button] of Object.entries(buttons)) {
    button?.addEventListener('click', () => {
      createAvatarPickerModal({
        key,
        current,
        onSelect: (index) => {
          current = normalizeAvatarSelection({ ...current, [key]: index })
          refresh(current)
          onChange?.(current)
          closeAvatarPickerModal()
        }
      })
    })
  }
  refresh(current)
  return { refresh, getValue: () => ({ ...current }) }
}
