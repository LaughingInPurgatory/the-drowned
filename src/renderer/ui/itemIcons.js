/**
 * Compact inline SVG icons for inventory / bay item rows.
 * Sci-fi HUD palette — no external image assets.
 */
import { MINED_ORE_GOOD_IDS, SURVEY_DATA_GOOD_ID, SHIP_PARTS_GOOD_ID } from '../data/goods.js'
import { escapeHtml } from './escapeHtml.js'

const SZ = 18

function svg(body, color = 'var(--ui-accent)') {
  return `<svg class="item-icon" width="${SZ}" height="${SZ}" viewBox="0 0 18 18" aria-hidden="true" focusable="false" style="color:${color}">${body}</svg>`
}

// Shared stroke style for line icons
const S = 'fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"'
const F = 'fill="currentColor"'

/** Ore chunk — color by tier. */
function oreIcon(color) {
  return svg(
    `<path ${S} d="M9 2.5 L14.5 6.2 L13.2 13.5 L4.8 13.5 L3.5 6.2 Z"/>
     <path ${S} d="M6.2 7.5 L9 5.2 L11.8 7.5 L10.5 11.2 L7.5 11.2 Z" opacity="0.85"/>`,
    color
  )
}

const ORE_COLORS = {
  raw_ore: '#a89878',
  rich_ore: '#c4a35c',
  exotic_ore: '#3d9b78',
  quantum_ore: '#b35aff',
  ore: '#8a7a68'
}

function skillbookIcon() {
  return svg(
    `<path ${S} d="M4 3.5 h7.5 a1.5 1.5 0 0 1 1.5 1.5 v9 a1 1 0 0 1 -1 1 H4.5 a1 1 0 0 1 -1 -1 V4.5 A1 1 0 0 1 4.5 3.5"/>
     <path ${S} d="M6 6.5 h5 M6 9 h4.5 M6 11.5 h3.5"/>
     <circle ${F} cx="13.2" cy="5.2" r="1.1" opacity="0.9"/>`,
    '#c9a6ff'
  )
}

function weaponIcon(category = 'laser') {
  if (category === 'missile') {
    return svg(
      `<path ${S} d="M4 12.5 L8 4.5 L10 4.5 L14 12.5"/>
       <path ${S} d="M6.2 10.5 h5.6"/>
       <path ${S} d="M7.5 4.5 v-1.5 M10.5 4.5 v-1.5"/>
       <path ${S} d="M8.2 12.5 l0.8 2 M9.8 12.5 l-0.8 2"/>`,
      '#ff8a3d'
    )
  }
  return svg(
    `<path ${S} d="M3.5 11.5 L8 4.5 h2 L14.5 11.5"/>
     <path ${S} d="M6 9.5 h6"/>
     <path ${S} d="M9 4.5 V2.8"/>
     <path ${S} d="M7.5 13.5 h3" opacity="0.7"/>`,
    'var(--ui-accent)'
  )
}

function shipIcon(alien = false) {
  const color = alien ? '#9bff4a' : 'var(--ui-accent)'
  return svg(
    `<path ${S} d="M9 2.5 L14 8.5 L12.5 14.5 L5.5 14.5 L4 8.5 Z"/>
     <path ${S} d="M9 5.5 v5 M6.5 10.5 h5"/>
     <path ${S} d="M5 8.5 L2.5 10.5 M13 8.5 L15.5 10.5"/>`,
    color
  )
}

function blueprintIcon(kind = 'ship') {
  if (kind === 'weapon') {
    return svg(
      `<rect ${S} x="3.5" y="3" width="11" height="12" rx="1"/>
       <path ${S} d="M6 7 h6 M6 10 h4.5 M6 13 h3"/>
       <path ${S} d="M12 5.5 l1.5 -1.5 M12 5.5 l1.5 1.5" opacity="0.8"/>`,
      '#ffe066'
    )
  }
  if (kind === 'accessory') {
    return svg(
      `<rect ${S} x="3.5" y="3" width="11" height="12" rx="1"/>
       <circle ${S} cx="9" cy="9" r="2.8"/>
       <path ${S} d="M9 5.5 v1.2 M9 11.3 v1.2 M5.5 9 h1.2 M11.3 9 h1.2"/>`,
      '#7fe0a0'
    )
  }
  // ship / default blueprint
  return svg(
    `<rect ${S} x="3.5" y="3" width="11" height="12" rx="1"/>
     <path ${S} d="M6.5 12 L9 5.5 L11.5 12"/>
     <path ${S} d="M7.2 10 h3.6"/>
     <path ${S} d="M5 4.5 h2" opacity="0.7"/>`,
    'var(--ui-accent)'
  )
}

function cargoIcon() {
  return svg(
    `<path ${S} d="M3.5 6.5 L9 3.5 L14.5 6.5 V13 L9 15.5 L3.5 13 Z"/>
     <path ${S} d="M3.5 6.5 L9 9.5 L14.5 6.5 M9 9.5 V15.5"/>`,
    '#9ab0cc'
  )
}

function shipPartsIcon() {
  return svg(
    `<circle ${S} cx="9" cy="9" r="5.5"/>
     <path ${S} d="M9 5.5 V3.5 M9 14.5 V12.5 M5.5 9 H3.5 M14.5 9 H12.5"/>
     <path ${S} d="M6.2 6.2 L4.8 4.8 M11.8 11.8 L13.2 13.2 M11.8 6.2 L13.2 4.8 M6.2 11.8 L4.8 13.2"/>`,
    '#bdf5cf'
  )
}

function surveyDataIcon() {
  return svg(
    `<circle ${S} cx="9" cy="9" r="5.8"/>
     <ellipse ${S} cx="9" cy="9" rx="2.4" ry="5.8"/>
     <path ${S} d="M3.2 9 h11.6 M4.2 6.2 h9.6 M4.2 11.8 h9.6"/>`,
    '#a8d4ff'
  )
}

function accessoryIcon() {
  return svg(
    `<rect ${S} x="4" y="4" width="10" height="10" rx="1.5"/>
     <path ${S} d="M7 9 h4 M9 7 v4"/>
     <circle ${F} cx="9" cy="9" r="1.1"/>`,
    '#7fe0a0'
  )
}

function droneIcon() {
  return svg(
    `<circle ${S} cx="9" cy="9" r="3.2"/>
     <path ${S} d="M9 2.5 v2.2 M9 13.3 v2.2 M2.5 9 h2.2 M13.3 9 h2.2"/>
     <path ${S} d="M4.2 4.2 l1.6 1.6 M12.2 12.2 l1.6 1.6 M12.2 4.2 l1.6 -1.6 M4.2 12.2 l1.6 -1.6" opacity="0.85"/>`,
    '#8ab4c8'
  )
}

/**
 * @param {'ore'|'skillbook'|'weapon'|'ship'|'blueprint'|'cargo'|'parts'|'survey'|'accessory'|'good'|'drone'} kind
 * @param {{ oreId?: string, weaponCategory?: string, blueprintKind?: string, alien?: boolean }} [opts]
 */
export function itemIcon(kind, opts = {}) {
  switch (kind) {
    case 'ore':
      return oreIcon(ORE_COLORS[opts.oreId] ?? ORE_COLORS.ore)
    case 'skillbook':
      return skillbookIcon()
    case 'weapon':
      return weaponIcon(opts.weaponCategory === 'missile' ? 'missile' : 'laser')
    case 'ship':
      return shipIcon(!!opts.alien)
    case 'blueprint':
      return blueprintIcon(opts.blueprintKind || 'ship')
    case 'parts':
      return shipPartsIcon()
    case 'survey':
      return surveyDataIcon()
    case 'accessory':
      return accessoryIcon()
    case 'drone':
      return droneIcon()
    case 'cargo':
    case 'good':
    default:
      return cargoIcon()
  }
}

/** Icon for a trade/cargo good id. */
export function goodIcon(goodId) {
  if (MINED_ORE_GOOD_IDS.includes(goodId) || goodId === 'ore') {
    return itemIcon('ore', { oreId: goodId })
  }
  if (goodId === SURVEY_DATA_GOOD_ID) return itemIcon('survey')
  if (goodId === SHIP_PARTS_GOOD_ID) return itemIcon('parts')
  return itemIcon('good')
}

/**
 * Name cell: icon + label (escaped).
 * @param {string} iconHtml from itemIcon / goodIcon
 * @param {string} label plain text
 */
export function itemNameCell(iconHtml, label) {
  return `<span class="item-name">${iconHtml}<span class="item-label">${escapeHtml(label)}</span></span>`
}

/** Shared CSS for icon rows — inject once into inventory / docking styles. */
export const ITEM_ICON_CSS = `
.item-name {
  display: inline-flex; align-items: center; gap: 8px;
  min-width: 0; vertical-align: middle;
}
.item-name .item-icon {
  flex-shrink: 0; display: block;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.85));
}
.item-name .item-label {
  min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
`
