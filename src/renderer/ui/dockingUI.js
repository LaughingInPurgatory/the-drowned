import {
  GOODS,
  MINED_ORE_GOOD_IDS,
  SHIP_PARTS_GOOD_ID,
  SURVEY_DATA_GOOD_ID,
  getGood,
  isTradeListGood
} from '../data/goods.js'
import {
  getPrice, getMarketAvailable, buyGood, sellGood, sellMinedOre, buyMinedOre, buyShipParts, purchaseShip, repairCost, repairShip,
  activateStoredShip, sellStoredShip,
  renameActiveShip, renameStoredShip, buyWeapon, sellStoredWeapon, equipWeapon, sellCarriedWeapon,
  buyAccessory, sellStoredAccessory, equipAccessory, storageHasAssets, transferStorageItem,
  discardCargo, discardOre,
  buyDrone, sellStoredDrone, equipDrone, unequipDrone, sellShipDrone
} from '../game/economy.js'
import { DRONES, getDrone, DEFAULT_DRONE_ID } from '../data/drones.js'
import { freeDroneBayCount } from '../game/drones.js'
import {
  startCraft,
  transferBlueprintItem,
  retrieveBlueprints,
  jobsAtBody,
  craftRemainingS,
  ensureBlueprintMaps
} from '../game/crafting.js'
import {
  getBlueprint,
  oreCostForBlueprint,
  creditCostForBlueprint,
  craftDurationS,
  formatDuration,
  formatOreCost
} from '../data/blueprints.js'
import { purchasableShipClasses, getShipClass } from '../data/shipClasses.js'
import { WEAPONS, BASE_WEAPON_ID, ALIEN_BASE_WEAPON_ID, getWeapon, weaponsForCategory, allWeaponsForCategory } from '../data/weapons.js'
import {
  ACCESSORIES,
  getAccessory,
  accessorySlotCount,
  effectiveMiningCapacity,
  effectiveCargoCapacity,
  effectiveHardpoints,
  effectiveDroneBayCount,
  effectiveMaxShields,
  effectiveMaxArmor,
  effectiveMaxSpeed
} from '../data/accessories.js'
import { EXPLORER_PROBE_LOOT_BONUS } from '../game/probe.js'
import { playerSkillBonuses, scaleOreCost } from '../game/skills.js'
import { findBody, findSystemOfBody } from '../procgen/galaxy.js'
import { acceptMission } from '../game/missions.js'
import { refillMissionsIfExhausted } from '../data/missionTemplates.js'
import { escapeHtml } from './escapeHtml.js'
import { gameNotice, gamePrompt, gameConfirm } from './gameDialog.js'
import { goodIcon, itemIcon, itemNameCell, ITEM_ICON_CSS } from './itemIcons.js'
import { createShipyardPreview } from './shipyardPreview.js'
import {
  cloneListForUi,
  createClone,
  jumpToClone,
  discardClone,
  maxCloneCapacity,
  canCloneJump,
  ensureClones,
  ensureStationCloneBayFlag,
  CLONE_CREATE_COST,
  CLONE_JUMP_COST
} from '../game/clones.js'
import { getPlayerSkillLevel } from '../game/skills.js'

const STYLE = `
${ITEM_ICON_CSS}
/* Docked chrome: actions stay clickable; full menu only when .services-open.
   Top-aligned so Trade / Shipyard / etc. keep the same header Y when side
   boxes appear or content height changes. */
#docking-ui {
  position: fixed; inset: 0; background: transparent; backdrop-filter: none;
  font-family: monospace; color: var(--ui-text); display: none;
  align-items: flex-start; justify-content: center;
  padding-top: 6vh; box-sizing: border-box; z-index: 50;
  pointer-events: none;
}
#docking-ui.services-open {
  background: rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b),0.38); backdrop-filter: blur(1.5px);
  pointer-events: auto;
}
#docking-ui .docked-layout {
  display: none; gap: 16px; align-items: flex-start;
  max-height: calc(100vh - 6vh - 2vh); min-height: 0;
  pointer-events: auto;
}
#docking-ui.services-open .docked-layout { display: flex; }
#docking-ui .panel, #docking-ui .side-panel {
  max-height: calc(100vh - 6vh - 2vh); overflow-y: auto; padding: 18px 22px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.95), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.9));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#docking-ui .panel { width: 720px; }
#docking-ui .side-column {
  display: flex; flex-direction: column; gap: 12px; width: 260px; flex-shrink: 0;
  max-height: calc(100vh - 6vh - 2vh); overflow-y: auto; min-height: 0;
}
#docking-ui .side-column.shipyard-left-column { width: 240px; }
/* Industry: ore box closer to main panel, 60px inset from left screen side */
#docking-ui.industry-layout .docked-layout {
  gap: 8px; /* default is 16px */
}
#docking-ui .side-column.shipyard-left-column.industry-ore-col {
  padding-top: 78px;
  margin-left: 60px;
  box-sizing: border-box;
}
/* Shipyard: loadout on the right column, above stored ships */
#docking-ui.shipyard-layout .side-column.dock-right-column {
  width: 280px;
}
#docking-ui .side-panel { width: 100%; max-height: none; box-sizing: border-box; }
#docking-ui .side-panel.preview-side {
  padding: 0;
  overflow: hidden;
  background: transparent;
  border: none;
  border-left: none;
  box-shadow: none;
  max-height: none;
}
#docking-ui .side-panel.ships-side { max-height: none; }
#docking-ui .side-panel.jobs-side { max-height: none; }
#docking-ui .side-panel.loadout-side {
  max-height: min(48vh, calc(100vh - 6vh - 2vh - 120px));
  overflow-y: auto;
}
/* Loadout rows — same vocabulary as holds / inventory / HUD status rows */
#docking-ui .side-panel.loadout-side .lo-ship {
  font-size: 12px; color: var(--ui-accent); margin: 0 0 10px 0;
  letter-spacing: 0.3px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#docking-ui .side-panel.loadout-side .lo-class {
  opacity: 0.65; font-size: 11px; margin-left: 4px;
}
#docking-ui .side-panel.loadout-side .lo-section {
  margin: 12px 0 6px; padding-top: 8px;
  border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.9;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#docking-ui .side-panel.loadout-side .lo-section:first-of-type {
  margin-top: 4px; padding-top: 0; border-top: none;
}
#docking-ui .side-panel.loadout-side .lo-row {
  margin-bottom: 10px;
  padding: 8px 10px;
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.05);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35);
}
#docking-ui .side-panel.loadout-side .lo-row:last-child { margin-bottom: 0; }
#docking-ui .side-panel.loadout-side .lo-row-head {
  display: flex; justify-content: space-between; align-items: center;
  gap: 8px; margin-bottom: 5px;
  font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase;
  opacity: 0.75; color: var(--ui-dim);
}
#docking-ui .side-panel.loadout-side .lo-row-head .lo-mount {
  color: var(--ui-accent); opacity: 0.9;
}
#docking-ui .side-panel.loadout-side .lo-row-head .lo-tag {
  font-size: 9px; letter-spacing: 1px; opacity: 0.7;
  color: var(--ui-dim);
}
#docking-ui .side-panel.loadout-side .lo-equipped {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--ui-text); margin-bottom: 6px;
  line-height: 1.3;
}
#docking-ui .side-panel.loadout-side .lo-equipped .lo-meta {
  font-size: 10px; opacity: 0.6; margin-left: auto; white-space: nowrap;
}
#docking-ui .side-panel.loadout-side .lo-empty-slot {
  font-size: 11px; opacity: 0.5; margin-bottom: 6px;
}
#docking-ui .side-panel.loadout-side .lo-hint {
  font-size: 11px; opacity: 0.6; line-height: 1.4; margin: 6px 0 0;
}
#docking-ui .side-panel.loadout-side .lo-badge {
  display: inline-block; font-size: 9px; letter-spacing: 0.8px;
  text-transform: uppercase; padding: 1px 5px; margin-left: 4px;
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35); color: var(--ui-accent);
  opacity: 0.85;
}
#docking-ui .side-panel.loadout-side .lo-badge.warn {
  border-color: rgba(224,90,90,0.45); color: #ffb3b3;
}
/* Native <select> chrome — match panel buttons / theme (not OS grey). */
#docking-ui select,
#docking-ui .side-panel.loadout-side select.equip-select,
#docking-ui .side-panel.loadout-side select.equip-accessory,
#docking-ui .side-panel.loadout-side select.equip-drone {
  width: 100%; max-width: 100%; box-sizing: border-box;
  appearance: none;
  -webkit-appearance: none;
  background-color: rgba(var(--ui-bg-track-r),var(--ui-bg-track-g),var(--ui-bg-track-b),0.95);
  background-image: linear-gradient(45deg, transparent 50%, var(--ui-accent) 50%),
    linear-gradient(135deg, var(--ui-accent) 50%, transparent 50%);
  background-position: calc(100% - 14px) calc(50% - 2px), calc(100% - 9px) calc(50% - 2px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-radius: var(--ui-radius-sm, 6px);
  color: var(--ui-text);
  padding: 7px 28px 7px 10px;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.3px;
  color-scheme: dark;
  cursor: pointer;
}
#docking-ui select:focus,
#docking-ui .side-panel.loadout-side select.equip-select:focus,
#docking-ui .side-panel.loadout-side select.equip-accessory:focus,
#docking-ui .side-panel.loadout-side select.equip-drone:focus {
  outline: none;
  border-color: var(--ui-accent-mid);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#docking-ui select:disabled,
#docking-ui .side-panel.loadout-side select:disabled {
  opacity: 0.4; cursor: not-allowed;
}
#docking-ui select option {
  background: rgb(var(--ui-bg-r), var(--ui-bg-g), var(--ui-bg-b));
  color: var(--ui-text);
}
#docking-ui .side-panel.loadout-side button.unequip-drone {
  width: 100%; box-sizing: border-box;
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1);
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  color: var(--ui-text);
  padding: 5px 10px;
  cursor: pointer;
  font-family: monospace;
  font-size: 11px;
  letter-spacing: 0.5px;
  margin-top: 2px;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#docking-ui .side-panel.loadout-side button.unequip-drone:hover {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22);
  box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#docking-ui .side-panel.ore-side {
  max-height: min(52vh, calc(100vh - 6vh - 2vh - 100px)); overflow-y: auto;
}
#docking-ui .side-panel.ore-side > h3:first-child { margin-top: 0; }
#docking-ui .side-panel.ore-side table { margin-bottom: 0; }
#docking-ui .side-panel.ore-side .xfer-hint { margin-top: 0; }
#docking-ui .side-panel h3 { margin: 0 0 8px 0; }
#docking-ui .side-panel h3 + h3 { margin-top: 14px; }
#docking-ui .side-panel .panel-kicker {
  font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.75; margin: 0 0 10px 0;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#docking-ui .side-panel .meta-line {
  font-size: 11px; opacity: 0.75; margin: 0 0 8px 0;
}
#docking-ui .side-panel .holds-actions {
  display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 4px;
}
#docking-ui .side-panel .holds-actions button {
  margin-right: 0; padding: 3px 8px; font-size: 11px;
}
#docking-ui .side-panel .empty { opacity: 0.5; font-size: 12px; }
/* Storage drag-and-drop transfers */
#docking-ui .xfer-item {
  cursor: grab; user-select: none;
}
#docking-ui .xfer-item:active { cursor: grabbing; }
#docking-ui tr.xfer-item td { transition: background 0.12s ease; }
#docking-ui tr.xfer-item:hover td { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); }
#docking-ui .xfer-item.xfer-dragging { opacity: 0.45; }
#docking-ui .xfer-drop-target.drag-over {
  outline: 1px solid rgba(127,224,160,0.55);
  box-shadow: 0 2px 6px rgba(0,0,0,0.55);
  background: rgba(127,224,160,0.06);
}
#docking-ui .xfer-hint {
  font-size: 11px; opacity: 0.65; line-height: 1.4; margin: 0 0 10px 0;
}
#docking-ui .xfer-parts {
  display: inline-block; padding: 2px 8px; margin-top: 2px;
  border: 1px dashed rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35); border-radius: 2px;
}
#docking-ui .bp-section { margin-top: 4px; }
#docking-ui .bp-header {
  display: flex; align-items: center; gap: 8px; margin: 0 0 6px 0;
}
#docking-ui .bp-header h3 { margin: 0; flex: 1; }
#docking-ui .bp-toggle {
  background: transparent; border: none; color: var(--ui-accent); cursor: pointer;
  font-family: monospace; font-size: 11px; letter-spacing: 1.5px;
  text-transform: uppercase; padding: 0; text-align: left;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#docking-ui .bp-toggle:hover { color: var(--ui-text); }
#docking-ui .bp-toggle .chev { opacity: 0.7; margin-right: 4px; display: inline-block; width: 0.9em; }
#docking-ui button.store-all-bps {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 2px 8px; cursor: pointer; font-family: monospace; font-size: 11px;
  margin-right: 0;
}
#docking-ui button.store-all-bps:hover {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#docking-ui .bp-body { margin-top: 4px; }
#docking-ui .side-panel .job-row { font-size: 12px; margin-bottom: 10px; }
#docking-ui .side-panel .job-row .job-name { color: var(--ui-text); margin-bottom: 2px; }
#docking-ui .side-panel .job-row .job-meta { opacity: 0.7; font-size: 11px; margin-bottom: 4px; }
#docking-ui .side-panel .ship-row {
  font-size: 12px; margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.15);
}
#docking-ui .side-panel .ship-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
#docking-ui .side-panel .ship-row .ship-name { color: var(--ui-text); margin-bottom: 2px; }
#docking-ui .side-panel .ship-row .ship-class { opacity: 0.65; font-size: 11px; margin-bottom: 6px; }
#docking-ui .side-panel .ship-row .ship-actions { display: flex; flex-wrap: wrap; gap: 4px; }
#docking-ui .side-panel .ship-row .ship-actions button {
  margin-right: 0; padding: 3px 8px; font-size: 11px;
}
#docking-ui h2 { font-weight: normal; letter-spacing: 2px; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#docking-ui h3 { font-weight: normal; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--ui-accent); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); margin: 18px 0 8px; }
#docking-ui .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; gap: 12px; }
#docking-ui .header .body-name { flex: 1; min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#docking-ui .header-credits {
  flex-shrink: 0; font-size: 13px; letter-spacing: 1px; color: #ffe08a;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9); white-space: nowrap;
}
#docking-ui .tabs { display: flex; gap: 2px; margin-bottom: 16px; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25); }
#docking-ui .tab {
  background: transparent; border: none; border-bottom: 2px solid transparent; color: var(--ui-dim);
  padding: 8px 16px; cursor: pointer; font-family: monospace; font-size: 11px;
  letter-spacing: 1.5px; text-transform: uppercase; transition: color 0.15s ease, border-color 0.15s ease;
}
#docking-ui .tab:hover { color: var(--ui-text); }
#docking-ui .tab.active { color: var(--ui-accent); border-bottom-color: var(--ui-accent-mid); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#docking-ui table { width: 100%; border-collapse: collapse; }
#docking-ui th { text-align: left; padding: 6px 8px; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--ui-dim); font-weight: normal; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.3); }
#docking-ui td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(42,58,85,0.5); }
#docking-ui tbody tr:hover td { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.05); }
#docking-ui .credits { margin-bottom: 10px; opacity: 0.85; font-size: 12px; letter-spacing: 0.5px; }
/* Lower-center action row. */
#docking-ui .dock-actions {
  position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%); z-index: 55;
  display: flex; flex-direction: row; gap: 14px; align-items: center; justify-content: center;
  pointer-events: auto;
}
#docking-ui button.services-btn {
  background: linear-gradient(180deg, rgba(255,210,70,0.42), rgba(180,120,20,0.55));
  border: 2px solid #ffe08a;
  color: #fff6c8;
  padding: 13px 26px; cursor: pointer; font-family: monospace; letter-spacing: 2px;
  font-size: 13px; font-weight: 600; text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.75);
  box-shadow:
    0 3px 8px rgba(0,0,0,0.85),
    0 8px 18px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.25);
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease, filter 0.12s ease;
}
#docking-ui button.services-btn:hover {
  background: linear-gradient(180deg, rgba(255,220,90,0.58), rgba(210,150,30,0.65));
  box-shadow:
    0 4px 10px rgba(0,0,0,0.85),
    0 10px 20px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.35);
  transform: translateY(-1px);
  filter: brightness(1.06);
}
#docking-ui.services-open button.services-btn {
  background: linear-gradient(180deg, rgba(255,220,100,0.55), rgba(200,140,25,0.62));
  box-shadow:
    0 2px 8px rgba(0,0,0,0.85),
    0 6px 16px rgba(0,0,0,0.5),
    inset 0 1px 0 rgba(255,255,255,0.2);
}
#docking-ui button.undock-btn {
  background: linear-gradient(180deg, rgba(224,90,90,0.45), rgba(140,30,30,0.62));
  border: 2px solid #ff9a9a;
  color: #ffe0e0;
  padding: 13px 28px; cursor: pointer; font-family: monospace; letter-spacing: 2px;
  font-size: 13px; font-weight: 600; text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.75);
  box-shadow:
    0 3px 8px rgba(0,0,0,0.85),
    0 8px 18px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.2);
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease, filter 0.12s ease;
}
#docking-ui button.undock-btn:hover {
  background: linear-gradient(180deg, rgba(240,110,110,0.58), rgba(170,40,40,0.7));
  box-shadow:
    0 4px 10px rgba(0,0,0,0.85),
    0 10px 20px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(255,255,255,0.28);
  transform: translateY(-1px);
  filter: brightness(1.06);
}
#docking-ui button.buy, #docking-ui button.sell, #docking-ui button.buy-ore, #docking-ui button.sell-ore,
#docking-ui button.buy-parts, #docking-ui button.buy-ship, #docking-ui button.accept-mission, #docking-ui button.turnin,
#docking-ui button.repair-btn,
#docking-ui button.activate-ship, #docking-ui button.sell-ship, #docking-ui button.sell-ship-class,
#docking-ui button.rename-active, #docking-ui button.rename-stored,
#docking-ui button.buy-weapon, #docking-ui button.sell-weapon,
#docking-ui button.buy-accessory, #docking-ui button.sell-accessory,
#docking-ui button.buy-drone, #docking-ui button.sell-drone, #docking-ui button.install-drone,
#docking-ui button.store-weapons, #docking-ui button.store-all-bps,
#docking-ui button.assemble-btn {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 4px 10px; cursor: pointer; margin-right: 4px; font-family: monospace;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#docking-ui button.discard-item {
  background: rgba(224,90,90,0.1); border: 1px solid rgba(224,90,90,0.45); color: #ffb3b3;
  padding: 2px 8px; cursor: pointer; font-family: monospace; font-size: 11px;
  margin-left: 6px; line-height: 1.2;
}
#docking-ui button.discard-item:hover {
  background: rgba(224,90,90,0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#docking-ui button.buy:hover, #docking-ui button.sell:hover, #docking-ui button.buy-ore:hover, #docking-ui button.sell-ore:hover,
#docking-ui button.buy-parts:hover, #docking-ui button.buy-ship:hover, #docking-ui button.accept-mission:hover, #docking-ui button.turnin:hover,
#docking-ui button.repair-btn:not(:disabled):hover,
#docking-ui button.activate-ship:hover, #docking-ui button.sell-ship:hover, #docking-ui button.sell-ship-class:hover,
#docking-ui button.rename-active:hover, #docking-ui button.rename-stored:hover,
#docking-ui button.buy-weapon:hover, #docking-ui button.sell-weapon:hover,
#docking-ui button.buy-accessory:hover, #docking-ui button.sell-accessory:hover,
#docking-ui button.buy-drone:hover, #docking-ui button.sell-drone:hover, #docking-ui button.install-drone:hover,
#docking-ui button.store-weapons:hover, #docking-ui button.store-all-bps:hover,
#docking-ui button.assemble-btn:hover:not(:disabled) {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#docking-ui button.assemble-btn:disabled,
#docking-ui button.buy:disabled,
#docking-ui button.buy-ore:disabled,
#docking-ui button.buy-weapon:disabled,
#docking-ui button.buy-drone:disabled,
#docking-ui button.buy-accessory:disabled,
#docking-ui button.install-drone:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
#docking-ui .armoury-section-title {
  margin: 16px 0 8px; font-weight: normal; letter-spacing: 2px; text-transform: uppercase;
  color: var(--ui-accent); font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#docking-ui .armoury-section-title:first-child { margin-top: 0; }
#docking-ui .armoury-actions { white-space: nowrap; }
#docking-ui .craft-progress {
  height: 8px; background: #0c1424; border: 1px solid #2a3a55; margin-top: 4px; overflow: hidden;
}
#docking-ui .craft-progress .fill { height: 100%; background: linear-gradient(90deg, var(--ui-deep), var(--ui-accent)); }
#docking-ui button.repair-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
#docking-ui .repair-row { margin-bottom: 10px; }
/* Nested service sub-tabs (Trade / Shipyard / Missions / Storage) */
#docking-ui .svc-subtabs {
  display: flex; gap: 2px; margin-bottom: 12px;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
}
#docking-ui .svc-subtab {
  background: transparent; border: none; border-bottom: 2px solid transparent;
  color: var(--ui-dim); padding: 7px 12px; cursor: pointer; font-family: monospace;
  font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
  transition: color 0.15s ease, border-color 0.15s ease;
}
#docking-ui .svc-subtab:hover { color: var(--ui-text); }
#docking-ui .svc-subtab.active {
  color: var(--ui-accent); border-bottom-color: var(--ui-accent-mid);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
/* Shipyard: current ship header + sub-tabs */
#docking-ui .shipyard-current {
  margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  font-size: 13px; opacity: 0.95;
}
#docking-ui .shipyard-current .ship-name { color: var(--ui-accent); }
#docking-ui .shipyard-main {
  min-width: 0; max-height: 52vh; overflow-y: auto;
}
#docking-ui .shipyard-main h3 { margin-top: 0; }
#docking-ui .shipyard-main tr[data-class] { cursor: pointer; }
#docking-ui .shipyard-main tr[data-class]:hover td { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.08); }
#docking-ui .shipyard-main tr[data-class].selected td { color: #7fe0a0; text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7); }
#docking-ui .shipyard-main .acc-desc {
  font-size: 11px; opacity: 0.65; max-width: 280px; line-height: 1.35;
}
/* Industry main panel: blueprints fill the content area (ore is a left side box) */
#docking-ui .industry-main {
  min-width: 0; max-height: 52vh; overflow-y: auto;
}
#docking-ui .industry-bp-header {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: 0 0 8px 0;
}
#docking-ui .industry-bp-header h3 { margin: 0; }
#docking-ui button.move-all-bps {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 4px 10px; cursor: pointer; font-family: monospace; font-size: 11px;
  letter-spacing: 0.5px; flex-shrink: 0;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#docking-ui button.move-all-bps:hover:not(:disabled) {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#docking-ui button.move-all-bps:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
#docking-ui .bp-kind {
  margin-bottom: 10px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  background: rgba(var(--ui-bg-track-r),var(--ui-bg-track-g),var(--ui-bg-track-b),0.45);
}
#docking-ui .bp-kind-toggle {
  width: 100%; box-sizing: border-box; text-align: left;
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.06); border: none; border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.15);
  color: var(--ui-accent); cursor: pointer; font-family: monospace; font-size: 11px;
  letter-spacing: 1.5px; text-transform: uppercase; padding: 8px 10px;
}
#docking-ui .bp-kind-toggle:hover { background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.12); color: var(--ui-text); }
#docking-ui .bp-kind-toggle .chev { opacity: 0.7; margin-right: 6px; display: inline-block; width: 0.9em; }
#docking-ui .bp-kind-body { padding: 6px 8px 10px; }
#docking-ui .bp-kind-body table { margin-bottom: 0; }
#docking-ui .remote-asset {
  margin-bottom: 12px; padding: 10px 12px;
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.05); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.35);
}
#docking-ui .remote-asset h4 { margin: 0 0 2px 0; font-size: 13px; color: var(--ui-accent); font-weight: normal; }
#docking-ui .remote-asset .location {
  font-size: 11px; opacity: 0.75; margin-bottom: 6px;
}
#docking-ui .remote-asset .location .sys { color: #ffe08a; }
#docking-ui .remote-asset .assets { font-size: 12px; line-height: 1.45; }
#docking-ui .side-panel.stats-side .stat { font-size: 12px; margin-bottom: 4px; opacity: 0.9; }
#docking-ui .side-panel.stats-side .stat-section {
  margin-top: 12px; padding-top: 8px;
  border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.2);
  font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.9; margin-bottom: 6px;
}
#docking-ui .side-panel.stats-side .stat.bonus {
  color: #a8e6c8; opacity: 0.95; padding-left: 2px;
}
#docking-ui .side-panel.stats-side .stat.bonus-none { opacity: 0.45; font-size: 11px; }
#docking-ui .side-panel.stats-side .stat.hardpoint-line {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 5px; opacity: 0.95;
}
#docking-ui .side-panel.stats-side .stat.hardpoint-line .hp-id {
  font-size: 11px; opacity: 0.65; letter-spacing: 0.2px;
}
#docking-ui select.equip-select option:disabled,
#docking-ui select.equip-accessory option:disabled,
#docking-ui select.equip-drone option:disabled { color: #4a5a75; }
`

export function createDockingUI(container, gameState, rng, hooks = {}) {
  const { onCraftStarted, onPlayerShipChanged, onStorageChanged, onCloneTravel } = hooks
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'docking-ui'
  root.innerHTML = `
    <div class="docked-layout">
      <div class="side-column shipyard-left-column" style="display:none">
        <div class="side-panel stats-side"></div>
        <div class="side-panel preview-side" style="display:none"></div>
        <div class="side-panel ore-side" style="display:none"></div>
      </div>
      <div class="panel">
        <div class="header">
          <h2 class="body-name"></h2>
          <span class="header-credits"></span>
        </div>
        <div class="tabs">
          <button data-tab="trade" class="tab active">Trade</button>
          <button data-tab="shipyard" class="tab">Shipyard</button>
          <button data-tab="missions" class="tab">Missions</button>
          <button data-tab="storage" class="tab">Storage</button>
          <button data-tab="industry" class="tab">Industry</button>
          <button data-tab="clones" class="tab tab-clones" style="display:none">Clones</button>
        </div>
        <div class="tab-content"></div>
      </div>
      <div class="side-column dock-right-column">
        <div class="side-panel loadout-side" style="display:none"></div>
        <div class="side-panel ships-side" style="display:none"></div>
        <div class="side-panel jobs-side" style="display:none"></div>
      </div>
    </div>
    <div class="dock-actions">
      <button type="button" class="services-btn">Station Services</button>
      <button type="button" class="undock-btn">Undock</button>
    </div>
  `
  container.appendChild(root)

  const previewSideEl = root.querySelector('.preview-side')
  const shipPreview = createShipyardPreview(previewSideEl)

  const bodyNameEl = root.querySelector('.body-name')
  const headerCreditsEl = root.querySelector('.header-credits')
  const contentEl = root.querySelector('.tab-content')

  function updateHeaderCredits() {
    const n = Math.max(0, Math.floor(Number(gameState.player.credits) || 0))
    headerCreditsEl.textContent = `${n.toLocaleString()} cr`
  }
  const shipyardLeftCol = root.querySelector('.shipyard-left-column')
  const statsSideEl = root.querySelector('.stats-side')
  const loadoutSideEl = root.querySelector('.loadout-side')
  const oreSideEl = root.querySelector('.ore-side')
  const shipsSideEl = root.querySelector('.ships-side')
  const jobsSideEl = root.querySelector('.jobs-side')
  const tabButtons = [...root.querySelectorAll('.tab')]

  // Shared in-game dialogs (Electron blocks window.alert/confirm/prompt).
  function askText(title, defaultValue = '') {
    return gamePrompt(title, defaultValue, { okLabel: 'Rename', cancelLabel: 'Cancel' })
  }

  function showNotice(title, body, okLabel = 'OK') {
    return gameNotice(title, body, okLabel)
  }

  const XFER_MIME = 'application/x-witv-storage'

  function xferEnabled() {
    // Any open Station Services tab — drop routes by item kind/source, not by which tab is open.
    if (!currentBody || (currentBody.kind !== 'station' && currentBody.kind !== 'settlement')) {
      return false
    }
    return root.classList.contains('services-open')
  }

  /** data-* + draggable for transfer rows (caller adds class="xfer-item"). */
  function xferAttrs(from, kind, id, qty) {
    if (!xferEnabled() || qty <= 0) return ''
    return ` draggable="true" data-from="${from}" data-kind="${kind}" data-id="${escapeHtml(String(id))}" data-qty="${qty}"`
  }

  function xferClass(qty) {
    return xferEnabled() && qty > 0 ? ' xfer-item' : ''
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

  /** Prompt how many units to permanently discard (default = all). */
  async function planDiscardQty(label, available) {
    const max = Math.max(0, Math.floor(available))
    if (max < 1) return 0
    if (max === 1) {
      const ok = await gamePrompt(
        'Jettison item',
        '1',
        {
          body: `Permanently destroy 1× ${label}? This cannot be undone.`,
          okLabel: 'Destroy',
          cancelLabel: 'Cancel',
          maxLength: 4
        }
      )
      return ok == null ? 0 : 1
    }
    const ans = await gamePrompt(
      'Jettison item',
      String(max),
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

  function wireDiscardButtons(rootEl) {
    if (!rootEl) return
    rootEl.querySelectorAll('button.discard-item').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const kind = btn.getAttribute('data-kind') // cargo | ore
        const where = btn.getAttribute('data-where') // ship | station
        const id = btn.getAttribute('data-id')
        const max = Math.max(0, Math.floor(Number(btn.getAttribute('data-qty')) || 0))
        if (!kind || !where || !id || max < 1) return
        let label = id
        try {
          label = getGood(id).name
        } catch {
          /* */
        }
        const qty = await planDiscardQty(label, max)
        if (qty < 1) return
        try {
          if (kind === 'ore') {
            discardOre(
              gameState,
              id,
              qty,
              where,
              where === 'station' ? currentBody.id : null
            )
          } else {
            discardCargo(
              gameState,
              id,
              qty,
              where,
              where === 'station' ? currentBody.id : null
            )
          }
          await showNotice('Jettisoned', `Destroyed ${qty}× ${label}.`)
          refreshStorageViews()
          renderSidePanel()
          if (currentTab === 'trade') renderTrade()
        } catch (err) {
          await showNotice('Cannot jettison', err?.message || String(err))
        }
      })
    })
  }

  function discardBtn(where, kind, id, qty) {
    return `<button type="button" class="discard-item" data-where="${where}" data-kind="${kind}" data-id="${escapeHtml(String(id))}" data-qty="${qty}" title="Permanently destroy">✕</button>`
  }

  /**
   * Buy/Sell quantity dialog with afford / stock limits.
   * Buy defaults to 1; sell defaults to max held in station storage.
   * @param {'buy'|'sell'} side
   * @returns {Promise<number>} 0 if cancelled
   */
  async function planTradeQty({ side, label, unitPrice, maxQty, credits }) {
    const max = Math.max(0, Math.floor(maxQty))
    if (max < 1) {
      await showNotice(
        side === 'buy' ? 'Cannot buy' : 'Cannot sell',
        side === 'buy'
          ? `Not enough credits for one ${label} (${unitPrice}cr each; you have ${credits}cr).`
          : `No ${label} in station storage to sell.`
      )
      return 0
    }
    const defaultQty = side === 'buy' ? 1 : max
    const ans = await gamePrompt(
      side === 'buy' ? `Buy — ${label}` : `Sell — ${label}`,
      String(defaultQty),
      {
        body:
          side === 'buy'
            ? `${unitPrice}cr each · max ${max} (credits & bay stock)\nGoes into station storage.`
            : `${unitPrice}cr each · ${max} in your station storage\nSells into the bay (raises Available).`,
        okLabel: side === 'buy' ? 'Buy' : 'Sell',
        cancelLabel: 'Cancel',
        maxLength: 10
      }
    )
    if (ans == null) return 0
    const n = Math.floor(Number(String(ans).trim()))
    if (!Number.isFinite(n) || n < 1) return 0
    return Math.min(max, n)
  }

  function refreshStorageViews({ notify = true } = {}) {
    renderSidePanel()
    if (currentTab === 'storage') renderStorage()
    else if (currentTab === 'industry') renderIndustry()
    else if (currentTab === 'shipyard') renderShipyard()
    else if (currentTab === 'trade') renderTrade()
    else if (currentTab === 'clones') renderClones()
    if (notify) onStorageChanged?.()
  }

  function updateCloneTabVisibility() {
    const tab = root.querySelector('.tab-clones')
    if (!tab) return
    const show =
      currentBody?.kind === 'station' && ensureStationCloneBayFlag(currentBody)
    tab.style.display = show ? '' : 'none'
    if (!show && currentTab === 'clones') {
      currentTab = 'trade'
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'trade'))
    }
  }

  function renderClones() {
    ensureClones(gameState)
    updateHeaderCredits()
    const clones = cloneListForUi(gameState)
    const max = maxCloneCapacity(gameState)
    const used = clones.length
    const cloningLv = getPlayerSkillLevel(gameState, 'cloning')
    const jumpOk = canCloneJump(gameState)
    const credits = gameState.player.credits ?? 0

    contentEl.innerHTML = `
      <div class="credits">Clone Bay · Capacity ${used}/${max} · Cloning skill L${cloningLv} · Credits: ${credits.toLocaleString()} cr</div>
      <p style="opacity:0.7;font-size:12px;margin:0 0 12px;line-height:1.4">
        Create a clone here for <strong>${CLONE_CREATE_COST.toLocaleString()} cr</strong> (uses a capacity slot).
        Jumping to a clone costs <strong>${CLONE_JUMP_COST.toLocaleString()} cr</strong>, leaves a clone where you are now,
        and clears the destination clone (place a new one there later). Jump requires <strong>Cloning ≥ 1</strong>.
      </p>
      <button type="button" class="clone-create" ${used >= max || credits < CLONE_CREATE_COST ? 'disabled' : ''}>
        Create clone here (${CLONE_CREATE_COST.toLocaleString()} cr)
      </button>
      <h3 style="margin-top:16px">Your clones</h3>
      ${clones.length
        ? `<table>
            <thead><tr><th>Location</th><th></th></tr></thead>
            <tbody>
              ${clones.map((c) => `
                <tr>
                  <td>
                    ${escapeHtml(c.label || c.systemId)}
                    ${c.isCurrentSystem ? ' <span style="opacity:0.55">(this system)</span>' : ''}
                  </td>
                  <td style="white-space:nowrap">
                    <button type="button" class="clone-jump" data-id="${escapeHtml(c.id)}"
                      ${!jumpOk || credits < CLONE_JUMP_COST ? 'disabled' : ''}
                      title="${!jumpOk ? 'Requires Cloning skill level 1+' : 'Jump to this clone'}">
                      Jump (${CLONE_JUMP_COST.toLocaleString()} cr)
                    </button>
                    <button type="button" class="clone-discard" data-id="${escapeHtml(c.id)}">Discard</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>`
        : '<p class="empty" style="opacity:0.55">No clones placed yet.</p>'}
      ${!jumpOk ? '<p style="opacity:0.55;font-size:11px;margin-top:10px">Train Cloning (skillbooks) to unlock multi-clone jumps.</p>' : ''}
    `

    contentEl.querySelector('.clone-create')?.addEventListener('click', async () => {
      try {
        const { clone } = createClone(gameState)
        await showNotice('Clone created', `Body backup at ${clone.label}. Capacity ${gameState.player.clones.length}/${maxCloneCapacity(gameState)}.`)
      } catch (err) {
        await showNotice('Clone bay', err.message)
      }
      renderClones()
    })

    contentEl.querySelectorAll('.clone-jump').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id
        const ok = await gameConfirm(
          'Clone jump',
          `Spend ${CLONE_JUMP_COST.toLocaleString()} cr?\nA clone is left where you are now; the destination clone is consumed.`,
          { okLabel: 'Jump', cancelLabel: 'Cancel' }
        )
        if (!ok) return
        try {
          const result = jumpToClone(gameState, id)
          setServicesOpen(false)
          root.style.display = 'none'
          onUndock = null
          onCloneTravel?.(result)
        } catch (err) {
          await showNotice('Clone jump failed', err.message)
          renderClones()
        }
      })
    )

    contentEl.querySelectorAll('.clone-discard').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          discardClone(gameState, btn.dataset.id)
        } catch (err) {
          await showNotice('Discard failed', err.message)
        }
        renderClones()
      })
    )
  }

  function liveAvailable(payload, direction) {
    if (!currentBody || !payload) return 0
    const { kind, id, from } = payload
    // direction toStation ← ship; toShip ← station
    const fromShip = direction === 'toStation' || from === 'ship'
    const ship = gameState.player.ship
    const storage = gameState.stationStorage[currentBody.id] ?? {}
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
    if (!currentBody || !payload) return
    const { kind, id } = payload
    const available = liveAvailable(payload, direction)
    const label = itemLabel(kind, id)
    const want = await resolveTransferQty(available, shiftKey, label)
    if (want < 1) return

    let result
    if (kind === 'blueprint') {
      result = transferBlueprintItem(gameState, currentBody.id, id, want, direction)
    } else {
      result = transferStorageItem(gameState, currentBody.id, kind, id, want, direction)
    }

    if (result.capacityLimited) {
      const hold = kind === 'ore' ? 'ore hold' : 'cargo hold'
      await showNotice(
        'Hold full',
        result.moved > 0
          ? `Your ${hold} is full. Transferred ${result.moved} of ${want} ${label}; the rest stays where it was.`
          : `Your ${hold} is full — nothing transferred.`
      )
    }
    refreshStorageViews()
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
        // Remember shift at drop time via drag event (shift can change; read on drop).
        e.dataTransfer.setData('application/x-witv-shift', e.shiftKey ? '1' : '0')
      })
      el.addEventListener('dragend', () => {
        el.classList.remove('xfer-dragging')
        root.querySelectorAll('.xfer-drop-target.drag-over').forEach((n) => n.classList.remove('drag-over'))
        document.querySelectorAll('#inventory-ui .xfer-drop-target.drag-over').forEach((n) => n.classList.remove('drag-over'))
      })
    })
  }

  /**
   * Drop target for ship↔station transfers. Direction is always derived from
   * the drag payload (ship → station bay, station → ship), so drops work on
   * any wired surface — including the whole Station Services layout.
   */
  function wireDropZone(el) {
    if (!el) return
    el.classList.add('xfer-drop-target')
    // Element is stable across re-renders — bind listeners only once.
    if (el._xferDropWired) return
    el._xferDropWired = true
    el.addEventListener('dragover', (e) => {
      if (!xferEnabled()) return
      const types = [...(e.dataTransfer?.types ?? [])]
      if (types.includes(XFER_MIME) || types.includes('text/plain') || types.includes('Text')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        el.classList.add('drag-over')
      }
    })
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over')
    })
    el.addEventListener('drop', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      el.classList.remove('drag-over')
      // Clear parent layout highlight if a nested zone handled the drop.
      dockedLayoutEl?.classList.remove('drag-over')
      if (!xferEnabled()) return
      let payload = null
      try {
        payload = JSON.parse(e.dataTransfer.getData(XFER_MIME) || e.dataTransfer.getData('text/plain') || 'null')
      } catch {
        return
      }
      if (!payload || (payload.from !== 'ship' && payload.from !== 'station')) return
      const direction = payload.from === 'ship' ? 'toStation' : 'toShip'
      const shiftKey = e.shiftKey || e.dataTransfer.getData('application/x-witv-shift') === '1'
      await performStorageTransfer(payload, direction, shiftKey)
    })
  }

  const dockedLayoutEl = root.querySelector('.docked-layout')
  // Whole Station Services surface accepts drops; item kind/source pick the bay.
  wireDropZone(dockedLayoutEl)

  // Right column: stored ships + industry jobs. Ship cargo lives in Inventory (I).
  function renderSidePanel() {
    updateHeaderCredits()
    ensureBlueprintMaps(gameState)
    const atBay =
      currentBody &&
      (currentBody.kind === 'station' || currentBody.kind === 'settlement')

    if (!atBay) {
      shipsSideEl.style.display = 'none'
      shipsSideEl.innerHTML = ''
      jobsSideEl.style.display = 'none'
      jobsSideEl.innerHTML = ''
      return
    }

    const storage = gameState.stationStorage[currentBody.id] ?? { ships: [] }
    storage.ships ??= []
    shipsSideEl.style.display = 'block'
    shipsSideEl.innerHTML = `
      <h3>Ships stored here</h3>
      ${storage.ships.length
        ? storage.ships.map((s, i) => {
          let className = s.classId
          let sellPrice = 0
          try {
            const sc = getShipClass(s.classId)
            className = sc.name
            sellPrice = Math.round(sc.price * 0.5)
          } catch { /* */ }
          return `
            <div class="ship-row">
              <div class="ship-name">${escapeHtml(s.instanceName)}</div>
              <div class="ship-class">${escapeHtml(className)}</div>
              <div class="ship-actions">
                <button type="button" class="rename-stored" data-index="${i}">Rename</button>
                <button type="button" class="activate-ship" data-index="${i}">Activate</button>
                ${currentTab === 'shipyard'
                  ? `<button type="button" class="sell-ship" data-index="${i}">Sell (${sellPrice}cr)</button>`
                  : ''}
              </div>
            </div>`
        }).join('')
        : '<div class="empty">None — buy at Shipyard or craft at Industry</div>'}
    `
    shipsSideEl.querySelectorAll('.rename-stored').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const index = Number(btn.dataset.index)
        const current = storage.ships[index]
        const name = await askText('Rename ship', current?.instanceName ?? '')
        if (name == null) return
        try {
          renameStoredShip(gameState, currentBody.id, index, name)
        } catch (err) {
          await showNotice('Cannot rename', err.message)
        }
        renderSidePanel()
        if (currentTab === 'shipyard') renderShipyard()
      })
    )
    shipsSideEl.querySelectorAll('.activate-ship').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          activateStoredShip(gameState, currentBody.id, Number(btn.dataset.index))
          onPlayerShipChanged?.()
          await showNotice(
            'Ship activated',
            `${gameState.player.ship.instanceName} is now your active vessel.`
          )
        } catch (err) {
          await showNotice('Cannot activate', err.message)
        }
        renderSidePanel()
        renderCurrentTab()
      })
    )
    shipsSideEl.querySelectorAll('.sell-ship').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          const index = Number(btn.dataset.index)
          const sold = storage.ships[index]
          const label = sold ? `${sold.instanceName}` : 'Ship'
          sellStoredShip(gameState, currentBody.id, index)
          await showNotice('Ship sold', `${label} sold from station storage.`)
        } catch (err) {
          await showNotice('Cannot sell', err.message)
        }
        renderSidePanel()
        if (currentTab === 'shipyard') renderShipyard()
        else if (currentTab === 'storage') renderStorage()
      })
    )

    const jobs = jobsAtBody(gameState, currentBody.id)
    const now = Date.now()
    jobsSideEl.style.display = 'block'
    jobsSideEl.innerHTML = `
      <h3>Jobs at this bay</h3>
      ${jobs.length
        ? jobs.map((job) => {
          let name = job.blueprintId
          try { name = getBlueprint(job.blueprintId).itemName } catch { /* */ }
          const rem = craftRemainingS(job, now)
          const pct = Math.min(100, Math.round((1 - rem / Math.max(1, job.durationS)) * 100))
          return `
            <div class="job-row">
              <div class="job-name">${escapeHtml(name)}</div>
              <div class="job-meta">${formatDuration(rem)} remaining</div>
              <div class="craft-progress"><div class="fill" style="width:${pct}%"></div></div>
            </div>`
        }).join('')
        : '<div class="empty">No active builds</div>'}
    `
  }

  let currentBody = null
  let currentTab = 'trade'
  let onUndock = null

  function renderTrade() {
    const shipClass = getShipClass(gameState.player.ship.classId)
    const ship = gameState.player.ship
    const cargoUsed = Object.values(ship.cargo).reduce((a, b) => a + b, 0)
    const miningHold = ship.miningHold
    const miningUsed = Object.values(miningHold).reduce((a, b) => a + b, 0)
    const sub = tradeSubTab === 'ore' ? 'ore' : 'goods'
    tradeSubTab = sub

    let bodyHtml = ''
    const credits = gameState.player.credits
    const stationBay = gameState.stationStorage[currentBody.id] ?? {}
    const stationCargo = stationBay.cargo ?? {}
    const stationOre = stationBay.miningHold ?? {}
    if (sub === 'goods') {
      bodyHtml = `
        <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Buy and sell use <strong>station storage</strong> — transfer cargo (including Survey Data) to the bay on Storage, then sell here.</p>
        <div class="credits">Station cargo bay · Credits: ${credits}cr · Ship hold: ${cargoUsed}/${shipClass.stats.cargoCapacity}</div>
        <table>
          <thead><tr><th>Good</th><th>Price</th><th>Available</th><th>Stored</th><th></th></tr></thead>
          <tbody>${GOODS.filter((g) => isTradeListGood(g.id))
            .map((g) => ({ g, price: getPrice(gameState, currentBody.id, g.id) }))
            .sort((a, b) => (a.price - b.price) || a.g.name.localeCompare(b.g.name))
            .map(({ g, price }) => {
            const held = stationCargo[g.id] ?? 0
            const available = getMarketAvailable(gameState, currentBody.id, g.id)
            if (g.id === SURVEY_DATA_GOOD_ID) {
              if (held <= 0) return ''
              return `<tr>
                <td>${itemNameCell(goodIcon(g.id), g.name)}</td><td>${price}cr</td><td>—</td><td>${held}</td>
                <td><button class="sell" data-good="${g.id}" data-price="${price}" data-held="${held}">Sell</button></td>
              </tr>`
            }
            return `<tr>
              <td>${itemNameCell(goodIcon(g.id), g.name)}</td><td>${price}cr</td><td>${available}</td><td>${held}</td>
              <td>
                <button class="buy" data-good="${g.id}" data-price="${price}" data-available="${available}" ${available < 1 ? 'disabled' : ''}>Buy</button>
                <button class="sell" data-good="${g.id}" data-price="${price}" data-held="${held}">Sell</button>
              </td>
            </tr>`
          }).join('')}</tbody>
        </table>
        ${currentBody.hasShipParts ? `
        <h3>${itemNameCell(itemIcon('parts'), 'Ship Parts')}</h3>
        <p>Bought parts go to station storage. Transfer to ship for repairs (I).</p>
        <button class="buy-parts" data-price="${getPrice(gameState, currentBody.id, SHIP_PARTS_GOOD_ID)}">Buy</button>` : ''}
      `
    } else {
      bodyHtml = `
        <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Buy and sell use <strong>station ore storage</strong> — transfer ore on Storage or Industry. Selling restocks the bay.</p>
        <div class="credits">Station ore bay · Credits: ${credits}cr · Ship ore: ${miningUsed}/${effectiveMiningCapacity(ship, shipClass)}</div>
        <table>
          <thead><tr><th>Ore</th><th>Price</th><th>Available</th><th>Stored</th><th></th></tr></thead>
          <tbody>${MINED_ORE_GOOD_IDS
            .map((goodId) => ({
              goodId,
              good: getGood(goodId),
              price: getPrice(gameState, currentBody.id, goodId)
            }))
            .sort((a, b) => (a.price - b.price) || a.good.name.localeCompare(b.good.name))
            .map(({ goodId, good, price }) => {
            const held = stationOre[goodId] ?? 0
            const available = getMarketAvailable(gameState, currentBody.id, goodId)
            return `<tr>
              <td>${itemNameCell(goodIcon(goodId), good.name)}</td><td>${price}cr</td><td>${available}</td><td>${held}</td>
              <td>
                <button class="buy-ore" data-good="${goodId}" data-price="${price}" data-available="${available}" ${available < 1 ? 'disabled' : ''}>Buy</button>
                <button class="sell-ore" data-good="${goodId}" data-price="${price}" data-held="${held}">Sell</button>
              </td>
            </tr>`
          }).join('')}</tbody>
        </table>
      `
    }

    contentEl.innerHTML = `
      <div class="svc-subtabs">
        <button type="button" class="svc-subtab ${sub === 'goods' ? 'active' : ''}" data-subtab="goods">Goods</button>
        <button type="button" class="svc-subtab ${sub === 'ore' ? 'active' : ''}" data-subtab="ore">Ore</button>
      </div>
      ${bodyHtml}
    `
    contentEl.querySelectorAll('.svc-subtab').forEach((btn) =>
      btn.addEventListener('click', () => {
        tradeSubTab = btn.dataset.subtab
        renderTrade()
      })
    )
    contentEl.querySelector('.buy-parts')?.addEventListener('click', async () => {
      const price = Number(contentEl.querySelector('.buy-parts').dataset.price)
      const maxBuy = price > 0 ? Math.floor(gameState.player.credits / price) : 0
      const qty = await planTradeQty({
        side: 'buy',
        label: 'Ship Parts',
        unitPrice: price,
        maxQty: maxBuy,
        credits: gameState.player.credits
      })
      if (qty < 1) return
      try {
        buyShipParts(gameState, currentBody.id, qty)
        await showNotice('Purchased', `${qty} ship part(s) in station storage.`)
      } catch (err) {
        await showNotice('Purchase failed', err.message)
      }
      renderTrade()
    })
    contentEl.querySelectorAll('.buy').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const goodId = btn.dataset.good
        const price = Number(btn.dataset.price)
        const available = getMarketAvailable(gameState, currentBody.id, goodId)
        const affordable = price > 0 ? Math.floor(gameState.player.credits / price) : 0
        const maxBuy = Math.min(available, affordable)
        const name = getGood(goodId).name
        const qty = await planTradeQty({
          side: 'buy',
          label: name,
          unitPrice: price,
          maxQty: maxBuy,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          buyGood(gameState, currentBody.id, goodId, qty)
          await showNotice('Purchased', `${qty}× ${name} in station storage.`)
        } catch (err) {
          await showNotice('Purchase failed', err.message)
        }
        renderTrade()
      })
    )
    contentEl.querySelectorAll('.sell').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const goodId = btn.dataset.good
        const price = Number(btn.dataset.price)
        const held = Number(btn.dataset.held)
        const name = getGood(goodId).name
        const qty = await planTradeQty({
          side: 'sell',
          label: name,
          unitPrice: price,
          maxQty: held,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          sellGood(gameState, currentBody.id, goodId, qty)
        } catch (err) {
          await showNotice('Sale failed', err.message)
        }
        renderTrade()
      })
    )
    contentEl.querySelectorAll('.buy-ore').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const goodId = btn.dataset.good
        const price = Number(btn.dataset.price)
        const available = getMarketAvailable(gameState, currentBody.id, goodId)
        const affordable = price > 0 ? Math.floor(gameState.player.credits / price) : 0
        const maxBuy = Math.min(available, affordable)
        const name = getGood(goodId).name
        const qty = await planTradeQty({
          side: 'buy',
          label: name,
          unitPrice: price,
          maxQty: maxBuy,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          buyMinedOre(gameState, currentBody.id, goodId, qty)
          await showNotice('Purchased', `${qty}× ${name} in station ore storage.`)
        } catch (err) {
          await showNotice('Purchase failed', err.message)
        }
        renderTrade()
      })
    )
    contentEl.querySelectorAll('.sell-ore').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const goodId = btn.dataset.good
        const price = Number(btn.dataset.price)
        const held = Number(btn.dataset.held)
        const name = getGood(goodId).name
        const qty = await planTradeQty({
          side: 'sell',
          label: name,
          unitPrice: price,
          maxQty: held,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          sellMinedOre(gameState, currentBody.id, goodId, qty)
        } catch (err) {
          await showNotice('Sale failed', err.message)
        }
        renderTrade()
      })
    )
    renderSidePanel()
  }

  // [key, label, formatter] rows shown in the Shipyard's stats panel — shared
  // between "browsing a ship for sale" and "the ship you currently fly" so
  // both read identically.
  const SHIP_STAT_ROWS = [
    ['hull', 'Hull'], ['shields', 'Shields'], ['armor', 'Armour'],
    ['cargoCapacity', 'Cargo Capacity'], ['miningCapacity', 'Mining Capacity'],
    ['speed', 'Speed'], ['turnRate', 'Turn Rate'], ['accel', 'Acceleration']
  ]

  /** Capitalise words for shipyard list labels (roles, class titles). */
  function capitalizeLabel(s) {
    return String(s ?? '')
      .split(/(\s+)/)
      .map((part) => (/^\s+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
      .join('')
  }

  /** Hull/role bonuses shown under shipyard stats (not accessory loadout). */
  function shipRoleBonusLines(shipClass) {
    const lines = []
    if (shipClass?.role === 'explorer') {
      const pct = Math.round(EXPLORER_PROBE_LOOT_BONUS * 100)
      lines.push(`+${pct}% chance of good loot when probing`)
    }
    if (shipClass?.role === 'miner') {
      const ore = Math.floor(Number(shipClass.stats?.miningCapacity) || 0)
      const cargo = Math.floor(Number(shipClass.stats?.cargoCapacity) || 0)
      lines.push(`Mining specialist — ore hold ${ore} (cargo max ${cargo})`)
      lines.push('Low defences & speed — not built for combat')
    }
    return lines
  }

  // Which ship class's stats the left panel shows — defaults to the
  // player's own current ship, and resets to that every time the Shipyard
  // tab (re)opens (see show() below), rather than persisting a stale
  // selection from a previous docking.
  let selectedShipClassId = null
  // Sub-tabs inside Shipyard: ships | armoury | accessories
  let shipyardSubTab = 'ships'
  let tradeSubTab = 'goods'
  let missionsSubTab = 'available'
  let storageSubTab = 'local'

  /** Industry blueprint kind dropdowns — closed by default. */
  const industryBpOpen = { ship: false, accessory: false, weapon: false }

  function hideLeftSideBoxes() {
    shipyardLeftCol.style.display = 'none'
    shipyardLeftCol.classList.remove('industry-ore-col')
    root.classList.remove('industry-layout')
    root.classList.remove('shipyard-layout')
    statsSideEl.style.display = 'none'
    loadoutSideEl.style.display = 'none'
    previewSideEl.style.display = 'none'
    oreSideEl.style.display = 'none'
    statsSideEl.innerHTML = ''
    loadoutSideEl.innerHTML = ''
    oreSideEl.innerHTML = ''
    shipPreview.hide()
  }

  function hideShipyardSideBoxes() {
    // Keep industry ore box if that tab is active; otherwise clear side boxes.
    if (currentTab === 'industry') {
      statsSideEl.style.display = 'none'
      loadoutSideEl.style.display = 'none'
      previewSideEl.style.display = 'none'
      statsSideEl.innerHTML = ''
      loadoutSideEl.innerHTML = ''
      root.classList.remove('shipyard-layout')
      shipPreview.hide()
      return
    }
    hideLeftSideBoxes()
  }

  /** Stats + preview left; loadout on the right (same chrome as cargo/jobs). */
  function renderShipyardSideBoxes() {
    if (!currentBody?.hasShipyard || currentTab !== 'shipyard') {
      hideShipyardSideBoxes()
      return
    }
    shipyardLeftCol.classList.remove('industry-ore-col')
    root.classList.remove('industry-layout')
    root.classList.add('shipyard-layout')
    oreSideEl.style.display = 'none'
    oreSideEl.innerHTML = ''
    statsSideEl.style.display = 'block'
    previewSideEl.style.display = 'block'
    loadoutSideEl.style.display = 'block'
    const ship = gameState.player.ship
    const activeClass = getShipClass(ship.classId)
    selectedShipClassId ??= ship.classId
    const selectedClass = getShipClass(selectedShipClassId)
    const storageWeapons = gameState.stationStorage[currentBody.id]?.weapons ?? {}
    const storageAccessories = gameState.stationStorage[currentBody.id]?.accessories ?? {}
    const storageDrones = gameState.stationStorage[currentBody.id]?.drones ?? {}
    const spareWeapons = ship.spareWeapons ?? {}
    const accSlots = accessorySlotCount(activeClass)
    const equippedAcc = Array.isArray(ship.equippedAccessories) ? ship.equippedAccessories : []
    const droneBays = effectiveDroneBayCount(ship, activeClass)
    const shipDrones = ship.drones ?? []

    const roleLabel = selectedClass.role ? capitalizeLabel(selectedClass.role) : '—'
    const bonusLines = shipRoleBonusLines(selectedClass)
    const selectedHps = Array.isArray(selectedClass.hardpoints) ? selectedClass.hardpoints : []
    let turretCount = 0
    let launcherCount = 0
    for (const hp of selectedHps) {
      if (hp?.type === 'missile') launcherCount++
      else turretCount++
    }
    const viewingActive = selectedShipClassId === ship.classId
    const hardpointLines = selectedHps.length
      ? selectedHps.map((hp, i) => {
          const mountType = hp.type === 'missile' ? 'missile' : 'laser'
          const mountLabel = mountType === 'missile' ? 'Launcher' : 'Turret'
          let equippedBit = ''
          if (viewingActive) {
            const baseIds = selectedClass.alien ? ALIEN_BASE_WEAPON_ID : BASE_WEAPON_ID
            const equippedId = ship.equippedWeapons?.[hp.id] ?? baseIds[mountType]
            try {
              const w = getWeapon(equippedId)
              equippedBit = ` · ${w.name}`
            } catch {
              equippedBit = equippedId ? ` · ${equippedId}` : ''
            }
          }
          return `<div class="stat hardpoint-line">${itemNameCell(itemIcon('weapon', { weaponCategory: mountType }), `${mountLabel} ${i + 1}`)}<span class="hp-id">${escapeHtml(hp.id)}${escapeHtml(equippedBit)}</span></div>`
        }).join('')
      : '<div class="stat bonus-none">None</div>'

    const selectedDroneBays = Math.max(0, Math.floor(Number(selectedClass.droneBays) || 0))
    let droneBayLines = ''
    if (selectedDroneBays > 0) {
      const activeDrones = viewingActive ? (ship.drones ?? []) : []
      droneBayLines = `
        <div class="stat-section">Drone bays (${selectedDroneBays})</div>
        ${Array.from({ length: selectedDroneBays }, (_, bay) => {
          let status = 'Empty — buy in Armoury'
          if (viewingActive) {
            const d = activeDrones[bay]
            if (d) {
              let name = d.typeId || DEFAULT_DRONE_ID
              try { name = getDrone(d.typeId).name } catch { /* */ }
              const destroyed = d.destroyed || d.hull <= 0
              status = destroyed ? `${name} (destroyed)` : name
            } else {
              status = 'Empty'
            }
          }
          return `<div class="stat hardpoint-line">${itemNameCell(itemIcon('drone'), `Bay ${bay + 1}`)}<span class="hp-id">${escapeHtml(status)}</span></div>`
        }).join('')}
      `
    }

    // Active hull with a custom instance name → show that instead of the model.
    const modelName = selectedClass.name
    const instanceName = String(ship.instanceName ?? '').trim()
    const hasCustomShipName =
      viewingActive && instanceName.length > 0 && instanceName !== modelName
    const statsTitle = hasCustomShipName ? instanceName : capitalizeLabel(modelName)

    shipyardLeftCol.style.display = 'flex'
    statsSideEl.innerHTML = `
      <h3>Ship stats</h3>
      <div class="stat" style="font-size:13px;color:var(--ui-accent);margin-bottom:8px">${escapeHtml(statsTitle)}</div>
      <div class="stat">Role: ${escapeHtml(roleLabel)}</div>
      <div class="stat">Price: ${selectedClass.price}cr</div>
      <div class="stat">Accessory slots: ${accessorySlotCount(selectedClass)}</div>
      <div class="stat">Hardpoints: ${selectedHps.length}${selectedHps.length ? ` <span style="opacity:0.6">(${turretCount} turret${turretCount === 1 ? '' : 's'}, ${launcherCount} launcher${launcherCount === 1 ? '' : 's'})</span>` : ''}</div>
      ${selectedDroneBays > 0 ? `<div class="stat">Drone bays: ${selectedDroneBays}</div>` : ''}
      ${SHIP_STAT_ROWS.map(([key, label]) => {
        let val = selectedClass.stats[key]
        // Active hull: show live stats with accessories.
        if (selectedShipClassId === ship.classId) {
          if (key === 'miningCapacity') val = effectiveMiningCapacity(ship, selectedClass)
          if (key === 'cargoCapacity') val = effectiveCargoCapacity(ship, selectedClass)
          if (key === 'shields') val = effectiveMaxShields(ship, selectedClass)
          if (key === 'armor') val = effectiveMaxArmor(ship, selectedClass)
          if (key === 'speed') val = Math.round(effectiveMaxSpeed(ship, selectedClass))
          if (val !== selectedClass.stats[key]) {
            return `<div class="stat">${label}: ${val} <span style="opacity:0.55">(base ${selectedClass.stats[key]})</span></div>`
          }
        }
        return `<div class="stat">${label}: ${val}</div>`
      }).join('')}
      <div class="stat-section">Weapon hardpoints</div>
      ${hardpointLines}
      ${droneBayLines}
      <div class="stat-section">Bonus</div>
      ${bonusLines.length
        ? bonusLines.map((line) => `<div class="stat bonus">${escapeHtml(line)}</div>`).join('')
        : '<div class="stat bonus-none">None</div>'}
    `
    const loadoutHardpoints = effectiveHardpoints(ship, activeClass)
    const weaponBlocks = loadoutHardpoints.map((hp, hpIndex) => {
      const mountType = hp.type === 'missile' ? 'missile' : 'laser'
      const mountLabel = mountType === 'missile' ? 'Launcher' : 'Turret'
      const baseIds = activeClass.alien ? ALIEN_BASE_WEAPON_ID : BASE_WEAPON_ID
      // Accessory mounts never imply a free stock weapon.
      const equippedId = ship.equippedWeapons?.[hp.id] ?? (hp.accessory ? null : baseIds[mountType])
      // Shop list is human-only; equip list includes owned/equipped alien tech.
      const catalog = allWeaponsForCategory(mountType).filter((w) => {
        if (!w.alien) return true
        const inStorage = storageWeapons[w.id] ?? 0
        const onShip = spareWeapons[w.id] ?? 0
        return w.id === equippedId || inStorage > 0 || onShip > 0
      })
      let equippedName = equippedId
      let equippedMeta = ''
      let equippedAlien = false
      if (equippedId) {
        try {
          const ew = getWeapon(equippedId)
          equippedName = ew.name
          equippedAlien = !!ew.alien
          equippedMeta = `Dmg ${ew.damage}`
        } catch { /* */ }
      }
      const emptyOpt = hp.accessory
        ? `<option value="" ${!equippedId ? 'selected' : ''}>— empty (fit a weapon) —</option>`
        : ''
      const options = emptyOpt + catalog.map((w) => {
        const isEquipped = w.id === equippedId
        const inStorage = storageWeapons[w.id] ?? 0
        const onShip = spareWeapons[w.id] ?? 0
        const owned = isEquipped || inStorage > 0 || onShip > 0
        const bits = []
        if (isEquipped) bits.push('eq')
        if (inStorage > 0) bits.push(`${inStorage} st`)
        if (onShip > 0) bits.push(`${onShip} sal`)
        const label = bits.length ? `${w.name} (${bits.join(', ')})` : `${w.name}`
        return `<option value="${w.id}" ${isEquipped ? 'selected' : ''} ${!owned ? 'disabled' : ''}>${escapeHtml(label)}</option>`
      }).join('')
      const accBadge = hp.accessory ? '<span class="lo-badge">Accessory</span>' : ''
      return `
        <div class="lo-row">
          <div class="lo-row-head">
            <span class="lo-mount">${escapeHtml(mountLabel)} ${hpIndex + 1}</span>
            <span class="lo-tag">${escapeHtml(hp.id)}</span>
            ${accBadge}
          </div>
          ${equippedId
            ? `<div class="lo-equipped">
            ${itemNameCell(itemIcon('weapon', { weaponCategory: mountType, alien: equippedAlien }), equippedName)}
            ${equippedAlien ? '<span class="lo-badge">Alien</span>' : ''}
            ${equippedMeta ? `<span class="lo-meta">${escapeHtml(equippedMeta)}</span>` : ''}
          </div>`
            : '<div class="lo-empty-slot">No weapon fitted</div>'}
          <select class="equip-select" data-hardpoint="${hp.id}" aria-label="${escapeHtml(mountLabel)} ${hpIndex + 1}">${options}</select>
        </div>`
    }).join('')

    let accessoryBlocks = ''
    if (accSlots <= 0) {
      accessoryBlocks = `
        <div class="lo-section">Accessories</div>
        <div class="empty">No accessory slots on this hull</div>`
    } else {
      accessoryBlocks = `
        <div class="lo-section">Accessories (${accSlots})</div>
        ${Array.from({ length: accSlots }, (_, slot) => {
          const equippedId = equippedAcc[slot] ?? null
          let equippedName = null
          let equippedDesc = ''
          if (equippedId) {
            try {
              const acc = getAccessory(equippedId)
              equippedName = acc.name
              equippedDesc = acc.description || ''
            } catch {
              equippedName = equippedId
            }
          }
          const options = [
            `<option value="" ${!equippedId ? 'selected' : ''}>— empty —</option>`,
            ...ACCESSORIES.map((a) => {
              const isEquippedHere = a.id === equippedId
              const fittedElsewhere = equippedAcc.some((id, i) => id === a.id && i !== slot)
              const inStorage = storageAccessories[a.id] ?? 0
              const owned = isEquippedHere || inStorage > 0
              const bits = []
              if (isEquippedHere) bits.push('eq')
              if (inStorage > 0) bits.push(`${inStorage} st`)
              if (fittedElsewhere) bits.push('fitted')
              const label = bits.length ? `${a.name} (${bits.join(', ')})` : a.name
              const disabled = !owned || fittedElsewhere
              return `<option value="${a.id}" ${isEquippedHere ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</option>`
            })
          ].join('')
          return `
            <div class="lo-row">
              <div class="lo-row-head">
                <span class="lo-mount">Slot ${slot + 1}</span>
                <span class="lo-tag">Accessory</span>
              </div>
              ${equippedName
                ? `<div class="lo-equipped" title="${escapeHtml(equippedDesc)}">
                    ${itemNameCell(itemIcon('accessory'), equippedName)}
                  </div>`
                : '<div class="lo-empty-slot">Empty</div>'}
              <select class="equip-accessory" data-slot="${slot}" aria-label="Accessory slot ${slot + 1}">${options}</select>
            </div>`
        }).join('')}
      `
    }

    let droneBlocks = ''
    if (droneBays <= 0) {
      droneBlocks = ''
    } else {
      const freeBays = freeDroneBayCount(ship, activeClass)
      droneBlocks = `
        <div class="lo-section">Drone bays (${shipDrones.length}/${droneBays})</div>
        ${Array.from({ length: droneBays }, (_, bay) => {
          const d = shipDrones[bay]
          if (d) {
            let name = d.typeId || DEFAULT_DRONE_ID
            let meta = ''
            try {
              const def = getDrone(d.typeId)
              name = def.name
              meta = `S${def.shields} A${def.armor} H${def.hull}`
            } catch { /* */ }
            const destroyed = d.destroyed || d.hull <= 0
            return `
              <div class="lo-row">
                <div class="lo-row-head">
                  <span class="lo-mount">Bay ${bay + 1}</span>
                  <span class="lo-tag">Drone</span>
                </div>
                <div class="lo-equipped">
                  ${itemNameCell(itemIcon('drone'), name)}
                  ${destroyed ? '<span class="lo-badge warn">Destroyed</span>' : ''}
                  ${meta && !destroyed ? `<span class="lo-meta">${escapeHtml(meta)}</span>` : ''}
                </div>
                <button type="button" class="unequip-drone" data-bay="${bay}">Stow to storage</button>
              </div>`
          }
          // Empty bay — install from storage if any.
          const options = [
            `<option value="">— empty —</option>`,
            ...DRONES.map((def) => {
              const st = storageDrones[def.id] ?? 0
              return `<option value="${def.id}" ${st < 1 ? 'disabled' : ''}>${escapeHtml(def.name)}${st > 0 ? ` (${st} st)` : ''}</option>`
            })
          ].join('')
          return `
            <div class="lo-row">
              <div class="lo-row-head">
                <span class="lo-mount">Bay ${bay + 1}</span>
                <span class="lo-tag">Empty</span>
              </div>
              <div class="lo-empty-slot">No drone installed</div>
              <select class="equip-drone" data-bay="${bay}" ${freeBays < 1 ? 'disabled' : ''} aria-label="Drone bay ${bay + 1}">${options}</select>
            </div>`
        }).join('')}
        <p class="lo-hint">Buy drones in Armoury, then equip here. Launch with G / recall with H in flight.</p>
      `
    }

    loadoutSideEl.innerHTML = `
      <div class="panel-kicker">Ship Loadout</div>
      <div class="lo-ship">${escapeHtml(ship.instanceName)}<span class="lo-class">· ${escapeHtml(activeClass.name)}</span></div>
      <div class="lo-section">Hardpoints (${loadoutHardpoints.length})</div>
      ${weaponBlocks || '<div class="empty">No hardpoints</div>'}
      ${accessoryBlocks}
      ${droneBlocks}
    `
    loadoutSideEl.querySelectorAll('.equip-select').forEach((select) =>
      select.addEventListener('change', async () => {
        try {
          const wid = select.value
          if (!wid) {
            // Accessory mount: clear fitted weapon back to storage.
            const ship = gameState.player.ship
            const hpId = select.dataset.hardpoint
            const prev = ship.equippedWeapons?.[hpId]
            if (prev) {
              const st = gameState.stationStorage[currentBody.id] ??= {
                cargo: {}, miningHold: {}, shipParts: 0, ships: [], weapons: {}, accessories: {}, blueprints: {}, drones: {}
              }
              st.weapons ??= {}
              st.weapons[prev] = (st.weapons[prev] ?? 0) + 1
              delete ship.equippedWeapons[hpId]
            }
          } else {
            equipWeapon(gameState, currentBody.id, select.dataset.hardpoint, wid)
          }
        } catch (err) {
          await showNotice('Equip failed', err.message)
        }
        renderShipyard()
      })
    )
    loadoutSideEl.querySelectorAll('.equip-accessory').forEach((select) =>
      select.addEventListener('change', async () => {
        try {
          equipAccessory(gameState, currentBody.id, Number(select.dataset.slot), select.value || null)
        } catch (err) {
          await showNotice('Equip failed', err.message)
        }
        renderShipyard()
      })
    )
    loadoutSideEl.querySelectorAll('.equip-drone').forEach((select) =>
      select.addEventListener('change', async () => {
        const droneId = select.value
        if (!droneId) return
        try {
          equipDrone(gameState, currentBody.id, droneId)
        } catch (err) {
          await showNotice('Equip failed', err.message)
        }
        renderShipyard()
      })
    )
    loadoutSideEl.querySelectorAll('.unequip-drone').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          unequipDrone(gameState, currentBody.id, Number(btn.dataset.bay))
        } catch (err) {
          await showNotice('Cannot stow drone', err.message)
        }
        renderShipyard()
      })
    )
  }

  function updateShipPreview() {
    // Preview under stats while Shipyard is open (any sub-tab uses selected hull).
    const open = root.classList.contains('services-open')
    if (
      open &&
      currentTab === 'shipyard' &&
      currentBody?.hasShipyard &&
      selectedShipClassId
    ) {
      previewSideEl.style.display = 'block'
      shipPreview.show(selectedShipClassId)
    } else {
      previewSideEl.style.display = 'none'
      shipPreview.hide()
    }
  }

  function renderShipyard() {
    const shipClass = getShipClass(gameState.player.ship.classId)
    const ship = gameState.player.ship
    selectedShipClassId ??= ship.classId
    // Repair (hull/armor only — shields already regenerate on their own, see
    // combat.js) is offered at both stations and settlements. Full shipyard
    // (buy/sell ships + armoury) is station-only — every station has one.
    const canRepairHere = currentBody.kind === 'station' || currentBody.kind === 'settlement'
    const repairCostHere = canRepairHere ? repairCost(gameState, currentBody) : 0
    const repairSection = canRepairHere
      ? `<div class="repair-row">
          Hull: ${Math.round(ship.hull)}/${shipClass.stats.hull} | Armour: ${Math.round(ship.armor)}/${shipClass.stats.armor}
          <button class="repair-btn" ${repairCostHere === 0 ? 'disabled' : ''}>${repairCostHere === 0 ? 'Fully Repaired' : `Repair Ship (${repairCostHere}cr)`}</button>
        </div>`
      : ''

    const storageWeapons = currentBody.hasShipyard ? (gameState.stationStorage[currentBody.id]?.weapons ?? {}) : {}
    const storageAccessories = currentBody.hasShipyard
      ? (gameState.stationStorage[currentBody.id]?.accessories ?? {})
      : {}

    if (!currentBody.hasShipyard) {
      hideShipyardSideBoxes()
      contentEl.innerHTML = `${repairSection}<p>No shipyard at this location.</p>`
      shipPreview.hide()
    } else {
      const sub = shipyardSubTab === 'armoury' || shipyardSubTab === 'accessories' ? shipyardSubTab : 'ships'
      shipyardSubTab = sub

      const storedShips = gameState.stationStorage[currentBody.id]?.ships ?? []
      const storedShipCountByClass = {}
      for (const s of storedShips) {
        storedShipCountByClass[s.classId] = (storedShipCountByClass[s.classId] ?? 0) + 1
      }

      let catalogHtml = ''
      if (sub === 'ships') {
        catalogHtml = `
          <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Buy parks a hull in station storage. Sell sells one stored ship of that class (half list price).</p>
          <table>
            <thead><tr><th>Ship</th><th>Role</th><th>Acc</th><th>Price</th><th>Stored</th><th>Buy</th><th>Sell</th></tr></thead>
            <tbody>${purchasableShipClasses().map((c) => {
              const stored = storedShipCountByClass[c.id] ?? 0
              const sellPrice = Math.round(c.price * 0.5)
              return `
              <tr data-class="${c.id}" class="${c.id === selectedShipClassId ? 'selected' : ''}">
                <td>${itemNameCell(itemIcon('ship', { alien: !!c.alien }), capitalizeLabel(c.name))}</td><td>${escapeHtml(capitalizeLabel(c.role))}</td><td>${accessorySlotCount(c)}</td><td>${c.price}cr</td>
                <td>${stored}</td>
                <td><button class="buy-ship" data-class="${c.id}">Buy</button></td>
                <td>${stored > 0
                  ? `<button class="sell-ship-class" data-class="${c.id}" data-price="${sellPrice}">Sell (${sellPrice}cr)</button>`
                  : ''}</td>
              </tr>`
            }).join('')}</tbody>
          </table>
          ${storedShips.length
            ? `<h3 style="margin-top:16px">Stored here</h3>
              <table>
                <thead><tr><th>Name</th><th>Class</th><th>Sell</th></tr></thead>
                <tbody>${storedShips.map((s, i) => {
                  let className = s.classId
                  let sellPrice = 0
                  let alien = false
                  try {
                    const sc = getShipClass(s.classId)
                    className = capitalizeLabel(sc.name)
                    sellPrice = Math.round(sc.price * 0.5)
                    alien = !!sc.alien
                  } catch { /* */ }
                  return `<tr>
                    <td>${itemNameCell(itemIcon('ship', { alien }), s.instanceName)}</td>
                    <td>${escapeHtml(className)}</td>
                    <td><button class="sell-ship" data-index="${i}">Sell (${sellPrice}cr)</button></td>
                  </tr>`
                }).join('')}</tbody>
              </table>`
            : ''}`
      } else if (sub === 'armoury') {
        const spareWeapons = ship.spareWeapons ?? {}
        const storageDrones = gameState.stationStorage[currentBody.id]?.drones ?? {}
        const shipDrones = ship.drones ?? []
        const freeBays = freeDroneBayCount(ship)

        const weaponRow = (w) => {
          const st = storageWeapons[w.id] ?? 0
          const sal = spareWeapons[w.id] ?? 0
          const unitSell = Math.round(w.price * 0.5)
          const canBuy = !w.alien && w.price > 0
          return `
            <tr>
              <td>${itemNameCell(itemIcon('weapon', { weaponCategory: w.category }), w.name)}${w.alien ? ' <span style="color:#9bff4a">◆</span>' : ''}</td>
              <td>${w.damage}</td>
              <td>${w.alien ? '—' : `${w.price}cr`}</td>
              <td>${st}</td>
              <td class="armoury-actions">${canBuy
                ? `<button type="button" class="buy-weapon" data-weapon="${w.id}" data-price="${w.price}">Buy</button>`
                : '<span style="opacity:0.4">—</span>'}</td>
              <td class="armoury-actions">
                ${st > 0
                  ? `<button type="button" class="sell-weapon" data-weapon="${w.id}" data-held="${st}" data-src="storage" data-price="${unitSell}">Sell</button>`
                  : ''}
                ${sal > 0
                  ? `<button type="button" class="sell-weapon" data-weapon="${w.id}" data-held="${sal}" data-src="spare" data-price="${unitSell}">Sell salv</button>`
                  : ''}
                ${st < 1 && sal < 1 ? '<span style="opacity:0.35">—</span>' : ''}
              </td>
            </tr>`
        }

        const listWeapons = (category) =>
          WEAPONS.filter(
            (w) =>
              w.category === category &&
              (!w.alien || (storageWeapons[w.id] ?? 0) > 0 || (spareWeapons[w.id] ?? 0) > 0)
          )
            .slice()
            .sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name))

        const turrets = listWeapons('laser')
        const launchers = listWeapons('missile')

        const weaponTable = (rows) =>
          rows.length
            ? `<table>
                <thead><tr><th>Weapon</th><th>Dmg</th><th>Price</th><th>St</th><th>Buy</th><th>Sell</th></tr></thead>
                <tbody>${rows.map(weaponRow).join('')}</tbody>
              </table>`
            : '<p class="empty" style="opacity:0.5">None listed</p>'

        catalogHtml = `
          <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Buy into station storage. Sell from storage (or salvage). Equip from Loadout (left).</p>
          <h3 class="armoury-section-title">Turrets</h3>
          <p style="opacity:0.55;font-size:11px;margin:0 0 8px">Laser hardpoints</p>
          ${weaponTable(turrets)}
          <h3 class="armoury-section-title">Launchers</h3>
          <p style="opacity:0.55;font-size:11px;margin:0 0 8px">Missile hardpoints</p>
          ${weaponTable(launchers)}
          <h3 class="armoury-section-title">Combat drones</h3>
          <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Hulls with drone bays start empty. Buy here, Install into a free bay (or equip from Loadout).</p>
          <table>
            <thead><tr><th>Drone</th><th>S/A/H</th><th>Price</th><th>St</th><th>On ship</th><th>Buy</th><th>Install</th><th>Sell</th></tr></thead>
            <tbody>${DRONES.slice()
              .sort((a, b) => ((a.price ?? 0) - (b.price ?? 0)) || a.name.localeCompare(b.name))
              .map((d) => {
              const st = storageDrones[d.id] ?? 0
              const onShip = shipDrones.filter((x) => (x.typeId || DEFAULT_DRONE_ID) === d.id).length
              const unitSell = Math.round((d.price ?? 0) * 0.5)
              const canBuy = (d.price ?? 0) > 0
              const canInstall = st > 0 && freeBays > 0
              return `
              <tr>
                <td>${itemNameCell(itemIcon('drone'), d.name)}</td>
                <td>${d.shields}/${d.armor}/${d.hull}</td>
                <td>${d.price}cr</td>
                <td>${st}</td>
                <td>${onShip}</td>
                <td class="armoury-actions">${canBuy
                  ? `<button type="button" class="buy-drone" data-drone="${d.id}" data-price="${d.price}">Buy</button>`
                  : '<span style="opacity:0.4">—</span>'}</td>
                <td class="armoury-actions">${canInstall
                  ? `<button type="button" class="install-drone" data-drone="${d.id}">Install</button>`
                  : '<span style="opacity:0.35">—</span>'}</td>
                <td class="armoury-actions">
                  ${st > 0
                    ? `<button type="button" class="sell-drone" data-drone="${d.id}" data-held="${st}" data-src="storage" data-price="${unitSell}">Sell</button>`
                    : ''}
                  ${onShip > 0
                    ? `<button type="button" class="sell-drone" data-drone="${d.id}" data-held="${onShip}" data-src="ship" data-price="${unitSell}">Sell ship</button>`
                    : ''}
                  ${st < 1 && onShip < 1 ? '<span style="opacity:0.35">—</span>' : ''}
                </td>
              </tr>`
            }).join('')}</tbody>
          </table>`
      } else {
        catalogHtml = `
          <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Buy and sell use station storage.</p>
          <table>
            <thead><tr><th>Accessory</th><th>Price</th><th>St</th><th>Buy</th><th>Sell</th></tr></thead>
            <tbody>${ACCESSORIES.slice()
              .sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name))
              .map((a) => {
              const st = storageAccessories[a.id] ?? 0
              return `
              <tr>
                <td>
                  <div>${itemNameCell(itemIcon('accessory'), a.name)}</div>
                  <div class="acc-desc">${escapeHtml(a.description)}</div>
                </td>
                <td>${a.price}cr</td>
                <td>${st}</td>
                <td><button class="buy-accessory" data-accessory="${a.id}" data-price="${a.price}">Buy</button></td>
                <td>${st > 0
                  ? `<button class="sell-accessory" data-accessory="${a.id}" data-held="${st}">Sell</button>`
                  : ''}</td>
              </tr>`
            }).join('')}</tbody>
          </table>`
      }

      contentEl.innerHTML = `
        ${repairSection}
        <div class="shipyard-current">
          Current: <span class="ship-name">${escapeHtml(ship.instanceName)}</span>
          (${escapeHtml(shipClass.name)})
          <button class="rename-active">Rename</button>
        </div>
        <div class="svc-subtabs">
          <button type="button" class="svc-subtab ${sub === 'ships' ? 'active' : ''}" data-subtab="ships">Ships</button>
          <button type="button" class="svc-subtab ${sub === 'armoury' ? 'active' : ''}" data-subtab="armoury">Armoury</button>
          <button type="button" class="svc-subtab ${sub === 'accessories' ? 'active' : ''}" data-subtab="accessories">Accessories</button>
        </div>
        <div class="shipyard-main">
          ${catalogHtml}
        </div>
      `
      renderShipyardSideBoxes()
    }
    updateShipPreview()
    contentEl.querySelector('.repair-btn')?.addEventListener('click', async () => {
      try {
        repairShip(gameState, currentBody)
      } catch (err) {
        await showNotice('Repair failed', err.message)
      }
      renderShipyard()
    })
    contentEl.querySelector('.rename-active')?.addEventListener('click', async () => {
      const name = await askText('Rename your ship', ship.instanceName)
      if (name == null) return
      try {
        renameActiveShip(gameState, name)
      } catch (err) {
        await showNotice('Cannot rename', err.message)
      }
      renderShipyard()
    })
    contentEl.querySelectorAll('.svc-subtab').forEach((btn) =>
      btn.addEventListener('click', () => {
        shipyardSubTab = btn.dataset.subtab
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('tr[data-class]').forEach((row) =>
      row.addEventListener('click', () => {
        const classId = row.dataset.class
        if (!classId || classId === selectedShipClassId) {
          // Still refresh preview if same row re-clicked after tab weirdness.
          if (classId) updateShipPreview()
          return
        }
        selectedShipClassId = classId
        // Update selection highlight in-place — do not rebuild the table
        // (that would reset scroll position in the catalog).
        contentEl.querySelectorAll('tr[data-class]').forEach((r) => {
          r.classList.toggle('selected', r.dataset.class === selectedShipClassId)
        })
        renderShipyardSideBoxes()
        updateShipPreview()
      })
    )
    contentEl.querySelectorAll('.buy-ship').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const classId = btn.dataset.class
        selectedShipClassId = classId
        const shipClassBought = getShipClass(classId)
        try {
          purchaseShip(gameState, currentBody.id, classId, shipClassBought.name)
          await showNotice(
            'Ship purchased',
            `${shipClassBought.name} is in station storage (right panel). Activate it there to fly it — the hull will match the class you bought.`
          )
        } catch (err) {
          await showNotice('Purchase failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.sell-ship-class').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const classId = btn.dataset.class
        const ships = gameState.stationStorage[currentBody.id]?.ships ?? []
        const index = ships.findIndex((s) => s.classId === classId)
        if (index < 0) {
          await showNotice('Cannot sell', 'No ship of that class in station storage.')
          return
        }
        try {
          const sold = ships[index]
          const label = sold?.instanceName ?? 'Ship'
          sellStoredShip(gameState, currentBody.id, index)
          await showNotice('Ship sold', `${label} sold from station storage.`)
        } catch (err) {
          await showNotice('Cannot sell', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.sell-ship').forEach((btn) =>
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const index = Number(btn.dataset.index)
        const ships = gameState.stationStorage[currentBody.id]?.ships ?? []
        try {
          const sold = ships[index]
          const label = sold?.instanceName ?? 'Ship'
          sellStoredShip(gameState, currentBody.id, index)
          await showNotice('Ship sold', `${label} sold from station storage.`)
        } catch (err) {
          await showNotice('Cannot sell', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.buy-weapon').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const weaponId = btn.dataset.weapon
        const price = Number(btn.dataset.price)
        const w = getWeapon(weaponId)
        const maxBuy = price > 0 ? Math.floor(gameState.player.credits / price) : 0
        const qty = await planTradeQty({
          side: 'buy',
          label: w.name,
          unitPrice: price,
          maxQty: maxBuy,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          buyWeapon(gameState, currentBody.id, weaponId, qty)
          await showNotice(
            'Weapon purchased',
            `${qty}× ${w.name} in station storage. Equip from Loadout (left).`
          )
        } catch (err) {
          await showNotice('Purchase failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.sell-weapon').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const weaponId = btn.dataset.weapon
        const held = Number(btn.dataset.held)
        const src = btn.dataset.src
        const w = getWeapon(weaponId)
        const unit = Math.round(w.price * 0.5)
        const qty = await planTradeQty({
          side: 'sell',
          label: w.name,
          unitPrice: unit,
          maxQty: held,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          if (src === 'spare') sellCarriedWeapon(gameState, weaponId, qty)
          else sellStoredWeapon(gameState, currentBody.id, weaponId, qty)
        } catch (err) {
          await showNotice('Sale failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.buy-accessory').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const accessoryId = btn.dataset.accessory
        const price = Number(btn.dataset.price)
        const a = getAccessory(accessoryId)
        const maxBuy = price > 0 ? Math.floor(gameState.player.credits / price) : 0
        const qty = await planTradeQty({
          side: 'buy',
          label: a.name,
          unitPrice: price,
          maxQty: maxBuy,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          buyAccessory(gameState, currentBody.id, accessoryId, qty)
          await showNotice(
            'Accessory purchased',
            `${qty}× ${a.name} in station storage. Equip from Loadout (left).`
          )
        } catch (err) {
          await showNotice('Purchase failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.sell-accessory').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const accessoryId = btn.dataset.accessory
        const held = Number(btn.dataset.held)
        const a = getAccessory(accessoryId)
        const unit = Math.round(a.price * 0.5)
        const qty = await planTradeQty({
          side: 'sell',
          label: a.name,
          unitPrice: unit,
          maxQty: held,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          sellStoredAccessory(gameState, currentBody.id, accessoryId, qty)
        } catch (err) {
          await showNotice('Sale failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.buy-drone').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const droneId = btn.dataset.drone
        const price = Number(btn.dataset.price)
        const d = getDrone(droneId)
        const maxBuy = price > 0 ? Math.floor(gameState.player.credits / price) : 0
        const qty = await planTradeQty({
          side: 'buy',
          label: d.name,
          unitPrice: price,
          maxQty: maxBuy,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          buyDrone(gameState, currentBody.id, droneId, qty)
          await showNotice(
            'Drone purchased',
            `${qty}× ${d.name} in station storage. Equip from Loadout (left) or Install if a bay is free.`
          )
        } catch (err) {
          await showNotice('Purchase failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.install-drone').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          equipDrone(gameState, currentBody.id, btn.dataset.drone)
          await showNotice('Drone installed', 'Drone fitted into a free bay. Launch with G in flight.')
        } catch (err) {
          await showNotice('Install failed', err.message)
        }
        renderShipyard()
      })
    )
    contentEl.querySelectorAll('.sell-drone').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const droneId = btn.dataset.drone
        const held = Number(btn.dataset.held)
        const src = btn.dataset.src
        const d = getDrone(droneId)
        const unit = Math.round((d.price ?? 0) * 0.5)
        if (src === 'ship') {
          // Sell one installed unit of this type (first matching bay).
          const ship = gameState.player.ship
          const bay = (ship.drones ?? []).findIndex((x) => (x.typeId || DEFAULT_DRONE_ID) === droneId)
          if (bay < 0) {
            await showNotice('Sale failed', 'No matching drone on ship')
            return
          }
          try {
            sellShipDrone(gameState, bay)
          } catch (err) {
            await showNotice('Sale failed', err.message)
          }
          renderShipyard()
          return
        }
        const qty = await planTradeQty({
          side: 'sell',
          label: d.name,
          unitPrice: unit,
          maxQty: held,
          credits: gameState.player.credits
        })
        if (qty < 1) return
        try {
          sellStoredDrone(gameState, currentBody.id, droneId, qty)
        } catch (err) {
          await showNotice('Sale failed', err.message)
        }
        renderShipyard()
      })
    )
    renderSidePanel()
  }

  function formatRemoteStorageBits(s) {
    const bits = []
    const cargoRows = Object.entries(s.cargo ?? {}).filter(([, q]) => q > 0)
    const oreRows = Object.entries(s.miningHold ?? {}).filter(([, q]) => q > 0)
    if (cargoRows.length) {
      bits.push(`Cargo: ${cargoRows.map(([id, q]) => `${q} ${getGood(id).name}`).join(', ')}`)
    }
    if (oreRows.length) {
      bits.push(`Ore: ${oreRows.map(([id, q]) => `${q} ${getGood(id).name}`).join(', ')}`)
    }
    if ((s.shipParts ?? 0) > 0) bits.push(`${s.shipParts} Ship Part(s)`)
    if (s.ships?.length) {
      bits.push(
        `${s.ships.length} ship(s): ${s.ships.map((sh) => escapeHtml(sh.instanceName)).join(', ')}`
      )
    }
    const droneRows = Object.entries(s.drones ?? {}).filter(([, q]) => q > 0)
    if (droneRows.length) {
      bits.push(
        `Drones: ${droneRows.map(([id, q]) => {
          try { return `${q} ${getDrone(id).name}` } catch { return `${q} ${id}` }
        }).join(', ')}`
      )
    }
    const weaponRows = Object.entries(s.weapons ?? {}).filter(([, q]) => q > 0)
    if (weaponRows.length) {
      bits.push(
        `Weapons: ${weaponRows.map(([id, q]) => {
          try { return `${q} ${getWeapon(id).name}` } catch { return `${q} ${id}` }
        }).join(', ')}`
      )
    }
    const accRows = Object.entries(s.accessories ?? {}).filter(([, q]) => q > 0)
    if (accRows.length) {
      bits.push(
        `Accessories: ${accRows.map(([id, q]) => {
          try { return `${q} ${getAccessory(id).name}` } catch { return `${q} ${id}` }
        }).join(', ')}`
      )
    }
    const bpRows = Object.entries(s.blueprints ?? {}).filter(([, q]) => q > 0)
    if (bpRows.length) bits.push(`Blueprints: ${bpRows.reduce((a, [, q]) => a + q, 0)}`)
    return bits.join(' · ') || '—'
  }

  function renderStorage() {
    ensureBlueprintMaps(gameState)
    const sub = storageSubTab === 'remote' ? 'remote' : 'local'
    storageSubTab = sub

    let bodyHtml = ''
    if (sub === 'local') {
      const storage = gameState.stationStorage[currentBody.id] ?? {
        cargo: {}, miningHold: {}, shipParts: 0, ships: [], weapons: {}, accessories: {}, blueprints: {}
      }
      storage.blueprints ??= {}
      storage.accessories ??= {}
      storage.miningHold ??= {}
      storage.cargo ??= {}
      const cargoRows = Object.entries(storage.cargo).filter(([, qty]) => qty > 0)
      const cargoStored = cargoRows.reduce((a, [, qty]) => a + qty, 0)
      const oreRows = Object.entries(storage.miningHold).filter(([, qty]) => qty > 0)
      const oreStored = oreRows.reduce((a, [, qty]) => a + qty, 0)
      const stationParts = storage.shipParts ?? 0
      bodyHtml = `
        <p class="xfer-hint">Open <strong>Inventory (I)</strong> and drag cargo, ore, ship parts, or blueprints onto any Station Services surface (or reverse onto Inventory).</p>
        <h3>Cargo</h3>
        <div class="credits">${cargoStored} unit${cargoStored === 1 ? '' : 's'} stored</div>
        ${cargoRows.length
          ? `<table><tbody>${cargoRows.map(([id, qty]) =>
              `<tr class="${xferClass(qty).trim()}"${xferAttrs('station', 'cargo', id, qty)}><td>${itemNameCell(goodIcon(id), getGood(id).name)}</td><td>${qty} ${discardBtn('station', 'cargo', id, qty)}</td></tr>`
            ).join('')}</tbody></table>`
          : '<p class="empty" style="opacity:0.5">Empty</p>'}
        <h3>Ore</h3>
        <div class="credits">${oreStored} unit${oreStored === 1 ? '' : 's'} stored</div>
        ${oreRows.length
          ? `<table><tbody>${oreRows.map(([id, qty]) =>
              `<tr class="${xferClass(qty).trim()}"${xferAttrs('station', 'ore', id, qty)}><td>${itemNameCell(goodIcon(id), getGood(id).name)}</td><td>${qty} ${discardBtn('station', 'ore', id, qty)}</td></tr>`
            ).join('')}</tbody></table>`
          : '<p class="empty" style="opacity:0.5">Empty — drag from ship or buy on Trade → Ore</p>'}
        <h3>Ship Parts</h3>
        ${stationParts > 0
          ? `<div class="credits xfer-parts${xferClass(stationParts)}"${xferAttrs('station', 'parts', 'ship_parts', stationParts)}>${itemNameCell(itemIcon('parts'), `${stationParts} in bay`)}</div>`
          : '<div class="credits">0 in bay</div>'}
        <p style="opacity:0.6;font-size:11px;margin-top:14px">Weapons &amp; accessories: buy/sell on Shipyard. Blueprints: Industry. ✕ jettisons permanently.</p>
      `
    } else {
      const remoteEntries = Object.entries(gameState.stationStorage ?? {})
        .filter(([bodyId, s]) => bodyId !== currentBody.id && storageHasAssets(s))
      bodyHtml = `
        <p style="opacity:0.7;font-size:12px;">Assets left at other stations and settlements. Travel there to retrieve them.</p>
        ${remoteEntries.length
          ? remoteEntries.map(([bodyId, s]) => {
            const body = findBody(gameState.galaxy, bodyId)
            const system = findSystemOfBody(gameState.galaxy, bodyId)
            const kind =
              body?.kind === 'station' ? 'Station' : body?.kind === 'settlement' ? 'Settlement' : body?.kind || 'Facility'
            return `<div class="remote-asset">
              <h4>${escapeHtml(body?.name ?? bodyId)} <span style="opacity:0.55;font-size:11px">(${escapeHtml(kind)})</span></h4>
              <div class="location">System: <span class="sys">${escapeHtml(system?.name ?? 'Unknown')}</span></div>
              <div class="assets">${formatRemoteStorageBits(s)}</div>
            </div>`
          }).join('')
          : '<p class="empty" style="opacity:0.5">No remote assets — leave cargo, ships, or gear at other bays to see them here.</p>'}
      `
    }

    contentEl.innerHTML = `
      <div class="svc-subtabs">
        <button type="button" class="svc-subtab ${sub === 'local' ? 'active' : ''}" data-subtab="local">Local storage</button>
        <button type="button" class="svc-subtab ${sub === 'remote' ? 'active' : ''}" data-subtab="remote">Remote</button>
      </div>
      ${bodyHtml}
    `
    contentEl.querySelectorAll('.svc-subtab').forEach((btn) =>
      btn.addEventListener('click', () => {
        storageSubTab = btn.dataset.subtab
        renderStorage()
      })
    )
    if (sub === 'local') {
      wireDiscardButtons(contentEl)
      if (xferEnabled()) {
        wireXferItems(contentEl)
        wireDropZone(contentEl)
      }
    }
    renderSidePanel()
  }

  /**
   * @param {{ tryRefill?: boolean }} [opts]
   * tryRefill: when opening the tab after boards clear — never after Accept
   * (accepting must not restock the board while contracts are still open).
   * Missions auto-complete on objective (no turn-in).
   */
  function renderMissions(opts = {}) {
    const tryRefill = opts.tryRefill !== false
    if (tryRefill) {
      refillMissionsIfExhausted(gameState, currentBody.id, rng)
    }
    const bodyId = String(currentBody.id)
    const boardMissions = gameState.missions.available.filter((m) => String(m.giverStationId) === bodyId)

    contentEl.innerHTML = `
      <p style="opacity:0.7;font-size:12px;margin:0 0 10px">Accept contracts here. Objectives complete automatically when finished (reward paid immediately) — track active work with <strong>J</strong>.</p>
      <table>
        <thead><tr><th>Type</th><th>Title</th><th>Reward</th><th></th></tr></thead>
        <tbody>${boardMissions.length
          ? boardMissions.map((m) => `
          <tr>
            <td>${m.type ? m.type.charAt(0).toUpperCase() + m.type.slice(1) : ''}</td><td>${m.title}</td><td>${m.reward}cr</td>
            <td><button class="accept-mission" data-id="${m.id}">Accept</button></td>
          </tr>`).join('')
          : '<tr><td colspan="4" style="opacity:0.5">No contracts available.</td></tr>'}</tbody>
      </table>
    `
    contentEl.querySelectorAll('.accept-mission').forEach((btn) =>
      btn.addEventListener('click', () => {
        try {
          acceptMission(gameState, btn.dataset.id, rng)
        } catch (err) {
          showNotice('Accept failed', err.message)
          return
        }
        renderMissions({ tryRefill: false })
      })
    )
    renderSidePanel()
  }

  /** Ore in storage — left side box on Industry (mirrors shipyard stats column). */
  function renderIndustryOreSide() {
    if (currentTab !== 'industry' || !currentBody) {
      oreSideEl.style.display = 'none'
      oreSideEl.innerHTML = ''
      return
    }
    if (currentBody.kind !== 'station' && currentBody.kind !== 'settlement') {
      hideLeftSideBoxes()
      return
    }
    const storage = gameState.stationStorage[currentBody.id] ?? {}
    storage.miningHold ??= {}
    const oreRows = Object.entries(storage.miningHold).filter(([, qty]) => qty > 0)

    statsSideEl.style.display = 'none'
    loadoutSideEl.style.display = 'none'
    previewSideEl.style.display = 'none'
    statsSideEl.innerHTML = ''
    loadoutSideEl.innerHTML = ''
    shipPreview.hide()
    shipyardLeftCol.style.display = 'flex'
    shipyardLeftCol.classList.add('industry-ore-col')
    root.classList.add('industry-layout')
    root.classList.remove('shipyard-layout')
    oreSideEl.style.display = 'block'
    oreSideEl.innerHTML = `
      <h3>Ore in storage</h3>
      <p class="xfer-hint">Drag ore from <strong>Inventory (I)</strong> here (or reverse onto Inventory). Used by Assemble.</p>
      ${oreRows.length
        ? `<table><tbody>${oreRows.map(([id, qty]) =>
            `<tr class="${xferClass(qty).trim()}"${xferAttrs('station', 'ore', id, qty)}><td>${itemNameCell(goodIcon(id), getGood(id).name)}</td><td>${qty} ${discardBtn('station', 'ore', id, qty)}</td></tr>`
          ).join('')}</tbody></table>`
        : '<div class="empty">Empty — drag from ship or buy on Trade → Ore</div>'}
    `
    wireDiscardButtons(oreSideEl)
    if (xferEnabled()) {
      wireXferItems(oreSideEl)
      wireDropZone(oreSideEl)
    }
  }

  function renderIndustry() {
    ensureBlueprintMaps(gameState)
    if (currentBody.kind !== 'station' && currentBody.kind !== 'settlement') {
      contentEl.innerHTML = '<p>Industry bays are only available at stations and settlements.</p>'
      hideLeftSideBoxes()
      renderSidePanel()
      return
    }
    const storage = gameState.stationStorage[currentBody.id] ?? {
      cargo: {}, miningHold: {}, shipParts: 0, ships: [], weapons: {}, blueprints: {}
    }
    storage.blueprints ??= {}
    storage.miningHold ??= {}
    const credits = gameState.player.credits

    const byKind = { ship: [], accessory: [], weapon: [] }
    for (const [id, qty] of Object.entries(storage.blueprints)) {
      if (qty <= 0) continue
      let bp
      try {
        bp = getBlueprint(id)
      } catch {
        continue
      }
      if (byKind[bp.kind]) byKind[bp.kind].push([id, qty, bp])
    }
    for (const list of Object.values(byKind)) {
      list.sort((a, b) => craftDurationS(a[0]) - craftDurationS(b[0]))
    }

    const kindMeta = [
      { key: 'ship', label: 'Ships' },
      { key: 'accessory', label: 'Accessories' },
      { key: 'weapon', label: 'Weapons' }
    ]

    function bpKindSection(key, label, rows) {
      const open = !!industryBpOpen[key]
      const count = rows.length
      const body =
        count === 0
          ? `<p style="opacity:0.5;font-size:11px;margin:4px 0 0">None in storage</p>`
          : `<table>
            <thead><tr><th>Blueprint</th><th>Qty</th><th>Ore</th><th>Fee</th><th>Time</th><th></th></tr></thead>
            <tbody>${rows
              .map(([id, qty, bp]) => {
                let industryMult = 1
                try {
                  industryMult = playerSkillBonuses(gameState).industryMult
                } catch {
                  industryMult = 1
                }
                const cost = scaleOreCost(oreCostForBlueprint(id), industryMult)
                const fee = Math.max(0, Math.round(creditCostForBlueprint(id) * industryMult))
                const dur = craftDurationS(id)
                const enoughOre = Object.entries(cost).every(
                  ([oid, need]) => (storage.miningHold[oid] ?? 0) >= need
                )
                const canAssemble = enoughOre && credits >= fee
                return `
              <tr class="${xferClass(qty).trim()}"${xferAttrs('station', 'blueprint', id, qty)}>
                <td>${itemNameCell(itemIcon('blueprint', { blueprintKind: key }), bp.itemName)}</td>
                <td>${qty}</td>
                <td style="font-size:10px;opacity:0.85">${formatOreCost(cost)}</td>
                <td>${fee}cr</td>
                <td>${formatDuration(dur)}</td>
                <td><button class="assemble-btn" data-bp="${escapeHtml(id)}" ${canAssemble ? '' : 'disabled'}>Assemble</button></td>
              </tr>`
              })
              .join('')}</tbody>
          </table>`
      return `
        <div class="bp-kind" data-kind="${key}">
          <button type="button" class="bp-kind-toggle" data-kind="${key}" aria-expanded="${open}">
            <span class="chev">${open ? '▼' : '▶'}</span>${label}${count ? ` (${count})` : ''}
          </button>
          <div class="bp-kind-body" style="display:${open ? 'block' : 'none'}">${body}</div>
        </div>`
    }

    const totalBps = byKind.ship.length + byKind.accessory.length + byKind.weapon.length

    contentEl.innerHTML = `
      <p style="opacity:0.75;font-size:12px;">
        Assemble from <strong>station-stored</strong> blueprints and ore (1 blueprint per build, consumed on start).
        Ore bay is on the <strong>left</strong>; drag BPs from <strong>Inventory (I)</strong> onto this panel.
      </p>
      <div class="industry-main industry-bp-drop">
        <div class="industry-bp-header">
          <h3>Blueprints</h3>
          <button type="button" class="move-all-bps" ${totalBps ? '' : 'disabled'} title="Transfer all station blueprints to your ship">Move All</button>
        </div>
        ${totalBps
          ? kindMeta.map(({ key, label }) => bpKindSection(key, label, byKind[key])).join('')
          : '<p style="opacity:0.55;font-size:12px">No blueprints. Drag from ship or find via wrecks/probes. Not sellable.</p>'}
      </div>
    `

    contentEl.querySelector('.move-all-bps')?.addEventListener('click', () => {
      if (!totalBps) return
      retrieveBlueprints(gameState, currentBody.id)
      renderIndustry()
    })
    contentEl.querySelectorAll('.bp-kind-toggle').forEach((btn) =>
      btn.addEventListener('click', () => {
        const k = btn.dataset.kind
        industryBpOpen[k] = !industryBpOpen[k]
        renderIndustry()
      })
    )
    contentEl.querySelectorAll('.assemble-btn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          startCraft(gameState, currentBody.id, btn.dataset.bp)
          onCraftStarted?.('Build commenced - Will be informed when build complete.')
        } catch (err) {
          await showNotice('Assembly failed', err.message)
        }
        renderIndustry()
      })
    )
    if (xferEnabled()) {
      wireXferItems(contentEl)
      wireDropZone(contentEl)
    }
    renderIndustryOreSide()
    renderSidePanel()
  }

  const renderers = {
    trade: renderTrade,
    shipyard: renderShipyard,
    missions: renderMissions,
    storage: renderStorage,
    industry: renderIndustry,
    clones: renderClones
  }

  function renderCurrentTab() {
    updateHeaderCredits()
    updateCloneTabVisibility()
    if (currentTab !== 'shipyard' && currentTab !== 'industry') hideLeftSideBoxes()
    else if (currentTab !== 'shipyard') hideShipyardSideBoxes()
    const fn = renderers[currentTab]
    if (fn) fn()
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab
      tabButtons.forEach((b) => b.classList.toggle('active', b === btn))
      renderCurrentTab()
      updateShipPreview()
    })
  )

  const servicesBtn = root.querySelector('.services-btn')
  let servicesOpen = false

  function setServicesOpen(open) {
    servicesOpen = !!open
    root.classList.toggle('services-open', servicesOpen)
    servicesBtn.textContent = servicesOpen ? 'Close Services' : 'Station Services'
    servicesBtn.setAttribute('aria-pressed', servicesOpen ? 'true' : 'false')
    if (servicesOpen) {
      updateHeaderCredits()
      renderCurrentTab()
    } else {
      shipPreview.hide()
    }
  }

  servicesBtn.addEventListener('click', () => {
    setServicesOpen(!servicesOpen)
  })

  root.querySelector('.undock-btn').addEventListener('click', () => {
    setServicesOpen(false)
    shipPreview.hide()
    root.style.display = 'none'
    onUndock?.()
  })

  return {
    show(body, undockCallback) {
      currentBody = body
      onUndock = undockCallback
      // Station/settlement names are generated already ending in "Station"/
      // "Settlement" (see procgen/names.js) — appending "(kind)" on top of
      // that said it twice ("Dunell Settlement (settlement)"). Only append it
      // for kinds (planet/moon) whose name doesn't already spell it out.
      const kindLabel = body.kind.charAt(0).toUpperCase() + body.kind.slice(1)
      bodyNameEl.textContent = body.name.endsWith(kindLabel) ? body.name : `${body.name} (${body.kind})`
      updateHeaderCredits()
      selectedShipClassId = null
      shipyardSubTab = 'ships'
      tradeSubTab = 'goods'
      missionsSubTab = 'available'
      storageSubTab = 'local'
      currentTab = 'trade'
      tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === 'trade'))
      updateCloneTabVisibility()
      // Menu closed by default — only Station Services + Undock until opened.
      setServicesOpen(false)
      root.style.display = 'flex'
    },
    hide() {
      setServicesOpen(false)
      shipPreview.hide()
      root.style.display = 'none'
    },
    /** Re-render station bay lists without re-notifying inventory (avoids loops). */
    refreshStorage() {
      if (!currentBody) return
      refreshStorageViews({ notify: false })
    },
    /** Toggle Station Services panel (used by docked hotkey S). */
    toggleServices() {
      if (root.style.display === 'none' || !currentBody) return false
      setServicesOpen(!servicesOpen)
      return servicesOpen
    },
    isServicesOpen: () => servicesOpen,
    element: root
  }
}
