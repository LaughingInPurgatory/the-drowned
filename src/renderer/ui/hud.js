import { getUiPalette } from './uiTheme.js'

const STYLE = `
#hud { font-family: monospace; color: var(--ui-text); user-select: none; }

/*
 * Unified HUD chrome surface — square corners, thin border.
 * No coloured outer glow: black drop-shadow only. Radar is bare canvas.
 */
#hud .status-panel,
#hud .system-label,
#hud .target-panel {
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.92), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.82));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow:
    0 2px 4px rgba(0,0,0,0.85),
    0 6px 14px rgba(0,0,0,0.55);
  filter: none;
}

/* Status (top center): thin cyan on both sides */
#hud .status-panel {
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-right: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
}

/* Cockpit chrome: four corner braces plus a faint full-screen scanline wash,
   so gameplay reads as looking through a ship canopy HUD rather than a bare
   viewport. pointer-events: none throughout — pure decoration. */
#hud .cockpit-frame { position: fixed; inset: 10px; pointer-events: none; z-index: 5; }
#hud .cockpit-frame .corner {
  position: absolute; width: 34px; height: 34px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5);
  filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.95))
    drop-shadow(0 3px 6px rgba(0,0,0,0.7));
}
#hud .cockpit-frame .corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
#hud .cockpit-frame .corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
#hud .cockpit-frame .corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
#hud .cockpit-frame .corner.br { bottom: 0; right: 0; border-left: none; border-top: none; }
#hud .scanlines {
  position: fixed; inset: 0; pointer-events: none; z-index: 4; opacity: 0.35;
  background: repeating-linear-gradient(0deg, rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.025) 0px, rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.025) 1px, transparent 1px, transparent 4px);
}

/* Ship status + velocity — top center (floating prompts stack just below). */
#hud .status-panel {
  position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
  bottom: auto; right: auto;
  width: 280px;
  padding: 12px 18px 10px 20px;
  z-index: 8;
}
/* Plotted warp-gate route — floating text under the top-left system box. */
#hud .route-hud {
  position: fixed; left: 20px; top: 128px; z-index: 6;
  width: min(280px, 36vw); max-height: min(42vh, 360px);
  padding: 0;
  display: none;
  pointer-events: none;
  overflow: hidden;
  background: none;
  border: none;
  box-shadow: none;
  filter: none;
  color: #ffffff;
  text-shadow:
    0 1px 2px rgba(0,0,0,0.9),
    0 2px 6px rgba(0,0,0,0.75),
    0 0 10px rgba(0,0,0,0.45);
}
#hud .route-hud.visible { display: block; }
#hud .route-hud .rh-title {
  font-size: 11px; letter-spacing: 2.5px; text-transform: uppercase;
  color: #ffffff; opacity: 0.92; margin: 0 0 6px 0;
  text-shadow:
    0 1px 2px rgba(0,0,0,0.9),
    0 2px 6px rgba(0,0,0,0.75),
    0 0 10px rgba(0,0,0,0.45);
}
#hud .route-hud .rh-title .rh-count {
  opacity: 0.75; letter-spacing: 1px; font-size: 10px; margin-left: 6px;
  text-transform: none;
}
#hud .route-hud .rh-list {
  list-style: none; margin: 0; padding: 0;
  max-height: min(34vh, 300px); overflow: hidden;
}
#hud .route-hud .rh-list li {
  display: flex; align-items: baseline; gap: 8px;
  padding: 2px 0;
  margin: 0;
  font-size: 13px; letter-spacing: 0.3px; line-height: 1.45;
  background: none;
  border: none;
  color: #ffffff;
  opacity: 0.88;
  text-shadow:
    0 1px 2px rgba(0,0,0,0.9),
    0 2px 6px rgba(0,0,0,0.7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#hud .route-hud .rh-list li.next {
  opacity: 1;
  font-weight: 600;
}
#hud .route-hud .rh-list li.dest { opacity: 0.95; }
#hud .route-hud .rh-list .hop {
  opacity: 0.7; font-size: 11px; min-width: 1.4em; flex-shrink: 0;
}
#hud .route-hud .rh-list .name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
}
#hud .route-hud .rh-list .tag {
  font-size: 9px; letter-spacing: 1px; text-transform: uppercase;
  opacity: 0.7; color: #ffffff; flex-shrink: 0;
}
#hud.docked .route-hud {
  top: 100px;
}
#hud .panel-title {
  font-size: 10px; letter-spacing: 3px; opacity: 0.65; color: var(--ui-accent);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.75);
  margin-bottom: 8px;
}
#hud .row { margin-bottom: 7px; }
#hud .row-label {
  display: flex; justify-content: space-between; font-size: 10px;
  letter-spacing: 1.5px; opacity: 0.75; margin-bottom: 2px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.75);
}
#hud .row-label .value { opacity: 0.95; }

/* Compact status typography (matches shield/armour/hull labels). */
#hud .status-panel .sa-pair .row-label,
#hud .status-panel .velocity-row .row-label,
#hud .status-panel .drones-bay .row-label,
#hud .status-panel .drones-block .row-label,
#hud .status-panel .drones-block .panel-title {
  font-size: 8px; letter-spacing: 1px; margin-bottom: 1px;
}
#hud .status-panel .velocity-row .speed {
  font-size: 8px; letter-spacing: 1px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.75);
}

/* Shield + armour + hull side-by-side, compact bars. */
#hud .status-panel .sa-pair {
  display: flex; gap: 8px; margin-bottom: 6px;
}
#hud .status-panel .sa-pair .row {
  flex: 1; min-width: 0; margin-bottom: 0;
}
#hud .status-panel .sa-pair .bar {
  height: 5px;
}
#hud .status-panel .sa-pair .bar::after {
  background: repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.85) 5px, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.85) 6px);
}

/* Velocity bar ~half height of the old full bar (9px → 4.5px). */
#hud .status-panel .velocity-row {
  margin-bottom: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.28);
}
#hud .status-panel .velocity-row .bar.velocity {
  height: 4.5px;
}
#hud .status-panel .velocity-row .bar.velocity::after {
  background: repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.85) 5px, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.85) 6px);
}
#hud .status-panel .velocity-row .bar.velocity .zero-marker {
  top: -1px; bottom: -1px;
}
#hud .status-panel .drones-bay {
  margin-top: 2px; margin-bottom: 2px;
}
#hud .status-panel .drones-block {
  margin-top: 6px; padding-top: 6px;
}
#hud .status-panel .drones-block .panel-title {
  margin-bottom: 4px; opacity: 0.65;
}

#hud .bar {
  position: relative; width: 100%; height: 9px;
  background: #0c1424; border: 1px solid #2a3a55; overflow: hidden;
}
#hud .bar .fill { position: relative; height: 100%; transition: width 0.15s linear; }
/* Segment tick lines over every bar — the classic sci-fi cell-battery read
   instead of one smooth fill. Sits above the fill, so cells appear/disappear
   as the fill crosses each tick. */
#hud .bar::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(90deg, transparent 0px, transparent 9px, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.85) 9px, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.85) 11px);
}
#hud .bar .fill::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.35) 45%, transparent 70%);
  background-size: 220% 100%;
  animation: hud-shine 3.2s linear infinite;
}
#hud .shield .fill { background: linear-gradient(90deg, var(--ui-deep), var(--ui-accent)); box-shadow: none; }
#hud .armor .fill { background: linear-gradient(90deg, #8a6a2a, #d9b56a); box-shadow: none; }
#hud .hull .fill { background: linear-gradient(90deg, #7a2626, #c24a4a); box-shadow: none; }
#hud .hull .fill.critical { animation: hud-critical-pulse 0.6s ease-in-out infinite; }

#hud .bar.velocity { position: relative; }
#hud .bar.velocity .zero-marker { position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1px; background: rgba(207,227,255,0.4); }
#hud .bar.velocity .fill { position: absolute; top: 0; background: linear-gradient(90deg, #3a8f5c, #7fe0a0); box-shadow: none; }
#hud .bar.velocity .fill.reversing { background: linear-gradient(90deg, #8a6a2a, #d9b56a); box-shadow: none; }

/* Current system — top left; whole chip opens System Scan (B). */
#hud .system-label {
  position: fixed; top: 16px; left: 16px; transform: none;
  pointer-events: auto; cursor: pointer; z-index: 9;
  text-align: left; padding: 8px 16px 9px;
  max-width: min(360px, 40vw);
  border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-right: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
}
#hud .system-label:hover {
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.96), rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.12));
  border-color: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.65);
}
#hud .system-label:focus-visible {
  outline: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.7);
  outline-offset: 2px;
}
/* Docked: strip flight chrome; keep location chip top-left (not a scan button). */
#hud.docked .status-panel,
#hud.docked .target-panel,
#hud.docked #radar {
  display: none !important;
}
#hud.docked .system-label {
  cursor: default;
  pointer-events: none;
  max-width: min(420px, 48vw);
}
#hud.docked .system-label:hover {
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.92), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.82));
  border-color: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
}
#hud.docked .system-label .sys-tag { letter-spacing: 2px; }
#hud.docked .system-label .nearest-body.visible { display: block; }
#hud.docked .system-label .nearest-body .nb-tag { content: none; }
#hud.docked .system-label .sys-scan-hint { display: none; }
#hud .system-label .sys-tag {
  display: block; font-size: 9px; letter-spacing: 3px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.7;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  margin-bottom: 2px;
}
#hud .system-label .sys-name {
  display: block; font-size: 14px; letter-spacing: 1.5px; color: var(--ui-bright);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  white-space: nowrap; max-width: 42vw; overflow: hidden; text-overflow: ellipsis;
}
#hud .system-label .sys-name .sec-badge {
  display: inline-block; margin-left: 10px; padding: 1px 8px 2px;
  font-size: 11px; letter-spacing: 1px; vertical-align: middle;
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45); border-radius: 2px;
  color: var(--ui-accent); background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.1);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
}
#hud .system-label .sys-name .sec-badge.sec-high {
  color: #7fe0a0; border-color: rgba(127,224,160,0.5); background: rgba(127,224,160,0.1);
}
#hud .system-label .sys-name .sec-badge.sec-mid {
  color: #ffe08a; border-color: rgba(255,210,70,0.45); background: rgba(255,210,70,0.08);
}
#hud .system-label .sys-name .sec-badge.sec-low {
  color: #ff9a7a; border-color: rgba(224,90,90,0.4); background: rgba(224,90,90,0.1);
}
#hud .system-label .nearest-body {
  display: none; margin-top: 4px; font-size: 11px; letter-spacing: 1px;
  color: var(--ui-soft); opacity: 0.9;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  white-space: nowrap; max-width: 42vw; overflow: hidden; text-overflow: ellipsis;
}
#hud .system-label .nearest-body.visible { display: block; }
#hud .system-label .nearest-body .nb-tag {
  color: var(--ui-accent); opacity: 0.75; letter-spacing: 1.5px; text-transform: uppercase; font-size: 9px;
  margin-right: 6px;
}
#hud .system-label .nearest-body .nb-name { color: var(--ui-bright); }
#hud .system-label .sys-scan-hint {
  display: block; margin-top: 7px; padding-top: 6px;
  border-top: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.28);
  font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase;
  color: #c9e8ff; opacity: 0.9;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#hud .system-label:hover .sys-scan-hint { color: var(--ui-bright); opacity: 1; }

/* Tab-target readout — top right, left of system overview. */
#hud .target-panel {
  position: fixed; top: 16px; right: 272px; z-index: 6;
  width: 200px; padding: 10px 12px 10px 14px;
  pointer-events: none; display: none;
}
#hud .target-panel.visible { display: block; }
#hud .target-panel.hostile {
  border-color: rgba(224,90,90,0.55); border-left-color: #e05a5a;
  box-shadow:
    0 2px 4px rgba(0,0,0,0.85),
    0 6px 14px rgba(0,0,0,0.55);
}
#hud .target-panel .tp-tag {
  font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
  color: var(--ui-accent); opacity: 0.75; margin-bottom: 2px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.9);
}
#hud .target-panel.hostile .tp-tag { color: #ff9a7a; }
#hud .target-panel .tp-name {
  font-size: 13px; letter-spacing: 0.8px; color: var(--ui-bright);
  text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px;
}
#hud .target-panel .tp-meta {
  font-size: 10px; letter-spacing: 0.5px; color: var(--ui-dim); opacity: 0.9;
  margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#hud .target-panel .tp-row { margin-bottom: 5px; }
#hud .target-panel .tp-row:last-child { margin-bottom: 0; }
#hud .target-panel .tp-row-label {
  display: flex; justify-content: space-between; font-size: 9px;
  letter-spacing: 1px; opacity: 0.75; margin-bottom: 1px;
  text-shadow: 0 1px 2px rgba(0,0,0,0.75);
}
#hud .target-panel .tp-row-label .value { opacity: 0.95; }
#hud .target-panel .bar { height: 7px; }
#hud .target-panel .bar.ore .fill {
  background: linear-gradient(90deg, #6a5a2a, #d9b56a); box-shadow: none;
}



@keyframes hud-shine { 0% { background-position: 220% 0; } 100% { background-position: -20% 0; } }
@keyframes hud-critical-pulse {
  0%, 100% { opacity: 1; filter: none; }
  50% { opacity: 0.55; filter: brightness(1.35); }
}

/* Radar — flush to bottom of viewport; bare canvas (no panel chrome). */
#radar {
  position: fixed; left: 50%; bottom: 0; top: auto; transform: translateX(-50%);
  width: 420px; height: 160px;
  margin: 0; padding: 0;
  font-family: monospace; color: var(--ui-text); user-select: none;
  pointer-events: none;
  z-index: 8;
  background: none;
  border: none;
  box-shadow: none;
  filter: none;
}
#radar canvas {
  display: block;
  width: 100%; height: 100%;
  margin: 0; padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  box-shadow: none;
}
/* Shared soft ground shadow — kept in glitch rest frames so animation doesn't wipe it. */
/* Supercruise: stronger chromatic HUD glitch (still sparser than title ~6.5s). */
#hud.cruise-glitch .target-panel,
#hud.cruise-glitch .route-hud {
  animation: hudCruisePanelGlitch 12s steps(1) infinite;
}
#hud.cruise-glitch .cockpit-frame .corner {
  animation: hudCruiseCornerGlitch 12s steps(1) infinite;
}
#hud.cruise-glitch .status-panel,
#hud.cruise-glitch #radar {
  animation: hudCruisePanelGlitchCenter 12s steps(1) infinite;
}
#hud.cruise-glitch .system-label {
  animation: hudCruisePanelGlitch 12s steps(1) infinite;
}
#hud.cruise-glitch .scanlines {
  animation: hudCruiseScanGlitch 12s steps(1) infinite;
}
#hud.cruise-glitch .status-panel { animation-delay: 0s; }
#hud.cruise-glitch .system-label { animation-delay: 0.05s; }
#hud.cruise-glitch .target-panel { animation-delay: 0.04s; }
#hud.cruise-glitch .route-hud { animation-delay: 0.02s; }
#hud.cruise-glitch #radar { animation-delay: 0.1s; }
#hud.cruise-glitch .cockpit-frame .corner.tl { animation-delay: 0s; }
#hud.cruise-glitch .cockpit-frame .corner.tr { animation-delay: 0.03s; }
#hud.cruise-glitch .cockpit-frame .corner.bl { animation-delay: 0.06s; }
#hud.cruise-glitch .cockpit-frame .corner.br { animation-delay: 0.09s; }

/* Rest frames: no glow (panel box-shadow handles depth). Chromatic slices keep SC glitch. */
@keyframes hudCruisePanelGlitch {
  0%, 78%, 100% {
    filter: none;
    transform: none;
  }
  79% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(-5px 0 0 rgba(255, 40, 90, 0.85))
      drop-shadow(5px 0 0 rgba(40, 220, 255, 0.85));
    transform: translate(-5px, 0) skewX(-1.4deg);
  }
  80% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(6px 0 0 rgba(255, 40, 90, 0.75))
      drop-shadow(-4px 0 0 rgba(40, 220, 255, 0.75));
    transform: translate(6px, 2px) skewX(1.6deg);
  }
  81% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(-3px 1px 0 rgba(255, 80, 120, 0.7))
      drop-shadow(4px -1px 0 rgba(80, 200, 255, 0.7));
    transform: translate(-3px, -1px) skewX(0.8deg);
  }
  82% {
    filter: none;
    transform: none;
  }
  90% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(-4px 0 0 rgba(255, 50, 100, 0.7))
      drop-shadow(4px 0 0 rgba(50, 210, 255, 0.7));
    transform: translate(4px, 0) skewX(-1deg);
  }
  91% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(3px 0 0 rgba(255, 50, 100, 0.55))
      drop-shadow(-5px 0 0 rgba(50, 210, 255, 0.55));
    transform: translate(-4px, 1px);
  }
  92% {
    filter: none;
    transform: none;
  }
}
@keyframes hudCruisePanelGlitchCenter {
  0%, 78%, 100% {
    filter: none;
    transform: translateX(-50%);
  }
  79% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(-5px 0 0 rgba(255, 40, 90, 0.85))
      drop-shadow(5px 0 0 rgba(40, 220, 255, 0.85));
    transform: translateX(calc(-50% - 5px)) skewX(-1.4deg);
  }
  80% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(6px 0 0 rgba(255, 40, 90, 0.75))
      drop-shadow(-4px 0 0 rgba(40, 220, 255, 0.75));
    transform: translateX(calc(-50% + 6px)) translateY(2px) skewX(1.6deg);
  }
  81% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(-3px 1px 0 rgba(255, 80, 120, 0.7))
      drop-shadow(4px -1px 0 rgba(80, 200, 255, 0.7));
    transform: translateX(calc(-50% - 3px)) translateY(-1px) skewX(0.8deg);
  }
  82% {
    filter: none;
    transform: translateX(-50%);
  }
  90% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(-4px 0 0 rgba(255, 50, 100, 0.7))
      drop-shadow(4px 0 0 rgba(50, 210, 255, 0.7));
    transform: translateX(calc(-50% + 4px)) skewX(-1deg);
  }
  91% {
    filter:
      drop-shadow(0 2px 4px rgba(0,0,0,0.85))
      drop-shadow(3px 0 0 rgba(255, 50, 100, 0.55))
      drop-shadow(-5px 0 0 rgba(50, 210, 255, 0.55));
    transform: translateX(calc(-50% - 4px)) translateY(1px);
  }
  92% {
    filter: none;
    transform: translateX(-50%);
  }
}
@keyframes hudCruiseCornerGlitch {
  0%, 78%, 100% {
    filter:
      drop-shadow(0 1px 2px rgba(0,0,0,0.95))
      drop-shadow(0 3px 6px rgba(0,0,0,0.7));
  }
  79% {
    filter:
      drop-shadow(0 1px 2px rgba(0,0,0,0.95))
      drop-shadow(-4px 0 0 rgba(255, 40, 90, 0.9))
      drop-shadow(4px 0 0 rgba(40, 220, 255, 0.9));
  }
  80% {
    filter:
      drop-shadow(0 1px 2px rgba(0,0,0,0.95))
      drop-shadow(5px 0 0 rgba(255, 40, 90, 0.75))
      drop-shadow(-5px 0 0 rgba(40, 220, 255, 0.75));
  }
  81%, 82% {
    filter:
      drop-shadow(0 1px 2px rgba(0,0,0,0.95))
      drop-shadow(0 3px 6px rgba(0,0,0,0.7));
  }
  90% {
    filter:
      drop-shadow(0 1px 2px rgba(0,0,0,0.95))
      drop-shadow(-3px 0 0 rgba(255, 50, 100, 0.7))
      drop-shadow(3px 0 0 rgba(50, 210, 255, 0.7));
  }
  91%, 92% {
    filter:
      drop-shadow(0 1px 2px rgba(0,0,0,0.95))
      drop-shadow(0 3px 6px rgba(0,0,0,0.7));
  }
}
@keyframes hudCruiseScanGlitch {
  0%, 78%, 100% { opacity: 0.35; }
  79%, 81% { opacity: 0.95; }
  82% { opacity: 0.35; }
  90%, 91% { opacity: 0.8; }
  92% { opacity: 0.35; }
}

/* White-noise / static burst timed with the chromatic glitch windows. */
#hud .static-noise {
  position: fixed; inset: 0; pointer-events: none; z-index: 7;
  opacity: 0;
  mix-blend-mode: screen;
  /* SVG fractal noise — no texture files; re-tiled via background-size animation. */
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 180px 180px;
}
#hud.cruise-glitch .static-noise {
  animation: hudCruiseStatic 12s steps(1) infinite;
}
@keyframes hudCruiseStatic {
  0%, 78%, 100% {
    opacity: 0;
    background-position: 0 0;
  }
  79% {
    opacity: 0.42;
    background-position: -40px 12px;
  }
  80% {
    opacity: 0.55;
    background-position: 28px -22px;
  }
  81% {
    opacity: 0.28;
    background-position: -18px 36px;
  }
  82% {
    opacity: 0;
    background-position: 0 0;
  }
  90% {
    opacity: 0.32;
    background-position: 50px -30px;
  }
  91% {
    opacity: 0.2;
    background-position: -60px 20px;
  }
  92% {
    opacity: 0;
    background-position: 0 0;
  }
}
`

export function createHud(container) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const hud = document.createElement('div')
  hud.id = 'hud'
  hud.innerHTML = `
    <div class="scanlines"></div>
    <div class="static-noise" aria-hidden="true"></div>
    <div class="cockpit-frame">
      <div class="corner tl"></div><div class="corner tr"></div>
      <div class="corner bl"></div><div class="corner br"></div>
    </div>
    <div class="system-label" role="button" tabindex="0" title="System Scan (B)" aria-label="System Scan">
      <span class="sys-tag">System</span>
      <span class="sys-name">—</span>
      <span class="nearest-body"><span class="nb-tag">Nearest Body</span><span class="nb-name"></span></span>
      <span class="sys-scan-hint">System Scan (B)</span>
    </div>
    <div class="target-panel" aria-live="polite">
      <div class="tp-tag">Target</div>
      <div class="tp-name">—</div>
      <div class="tp-meta"></div>
      <div class="tp-bars"></div>
    </div>
    <div class="status-panel">
      <div class="row velocity-row">
        <div class="row-label"><span>Velocity</span><span class="speed"></span></div>
        <div class="bar velocity"><div class="zero-marker"></div><div class="fill"></div></div>
      </div>
      <div class="sa-pair">
        <div class="row shield">
          <div class="row-label"><span>Shield</span><span class="value"></span></div>
          <div class="bar"><div class="fill"></div></div>
        </div>
        <div class="row armor">
          <div class="row-label"><span>Armour</span><span class="value"></span></div>
          <div class="bar"><div class="fill"></div></div>
        </div>
        <div class="row hull">
          <div class="row-label"><span>Hull</span><span class="value"></span></div>
          <div class="bar"><div class="fill"></div></div>
        </div>
      </div>
      <div class="row drones-bay" style="display:none;margin-top:4px">
        <div class="row-label"><span>Drones</span><span class="value drones-bay-count"></span></div>
      </div>
      <div class="drones-block" style="display:none;margin-top:10px;padding-top:8px;border-top:1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.25)">
        <div class="panel-title" style="margin-bottom:6px">Drones (deployed)</div>
        <div class="drone-rows"></div>
      </div>
    </div>
    <div class="route-hud" aria-live="polite">
      <div class="rh-title">Route <span class="rh-count"></span></div>
      <ol class="rh-list"></ol>
    </div>
  `
  container.appendChild(hud)

  const radar = document.createElement('div')
  radar.id = 'radar'
  // Bare canvas only — 3D rectangular grid drawn in updateRadar (no panel chrome).
  const radarCanvas = document.createElement('canvas')
  radarCanvas.width = 420
  radarCanvas.height = 160
  radar.appendChild(radarCanvas)
  // Nested inside hud (position:fixed makes placement independent of parent)
  // so removing hud.element also cleans up the radar — no separate tracking.
  hud.appendChild(radar)
  const radarCtx = radarCanvas.getContext('2d')
  const radarW = radarCanvas.width
  const radarH = radarCanvas.height
  const systemLabelEl = hud.querySelector('.system-label')

  // Ships: neutral yellow, hostile flashing red. Stations blue, worlds green,
  // gates + datacores purple, asteroids brown.
  const contactColor = (kind) => {
    const PURPLE = '#b070ff'
    const fixed = {
      // Ships
      neutral: '#f0d24a',
      hostile: '#ff3030',
      // Stations / docks
      station: '#4aa8ff',
      // Planets, moons, sun
      planet: '#5ee08a',
      moon: '#5ee08a',
      sun: '#5ee08a',
      body: '#5ee08a',
      // Warp gates + datacore anomalies
      gate: PURPLE,
      anomaly: PURPLE,
      datacore: PURPLE,
      // Other contacts — rocks are brown; belt kind unused (fields not on radar).
      belt: '#8B5A2B',
      asteroid: '#8B5A2B',
      waypoint: '#7fe0a0',
      mission: '#ff8a3d',
      wreck: '#c27a3a',
      nodule: '#60f0ff',
      alien_base: '#ff6040'
    }
    return fixed[kind] ?? fixed.body
  }
  // Below this fraction the hull bar pulses red as an urgent low-hull cue.
  const CRITICAL_HULL_FRACTION = 0.25

  const shieldFill = hud.querySelector('.shield .fill')
  const armorFill = hud.querySelector('.armor .fill')
  const hullFill = hud.querySelector('.hull .fill')
  const shieldValue = hud.querySelector('.shield .value')
  const armorValue = hud.querySelector('.armor .value')
  const hullValue = hud.querySelector('.hull .value')
  const velocityFill = hud.querySelector('.velocity .fill')
  const speedEl = hud.querySelector('.speed')
  const systemNameEl = hud.querySelector('.system-label .sys-name')
  const nearestBodyEl = hud.querySelector('.system-label .nearest-body')
  const nearestBodyNameEl = hud.querySelector('.system-label .nearest-body .nb-name')
  const targetPanel = hud.querySelector('.target-panel')
  const targetNameEl = hud.querySelector('.target-panel .tp-name')
  const targetMetaEl = hud.querySelector('.target-panel .tp-meta')
  const targetBarsEl = hud.querySelector('.target-panel .tp-bars')
  const routeHudEl = hud.querySelector('.route-hud')
  const routeCountEl = hud.querySelector('.route-hud .rh-count')
  const routeListEl = hud.querySelector('.route-hud .rh-list')
  let lastSystemLabelKey = null
  let lastNearestBodyName = undefined
  let lastRouteKey = null

  function pct(value, max) {
    return Math.max(0, Math.min(100, (value / max) * 100))
  }

  function barRow(label, value, max, kind) {
    const p = max > 0 ? pct(value, max) : 0
    return `<div class="tp-row">
      <div class="tp-row-label"><span>${label}</span><span class="value">${p.toFixed(0)}%</span></div>
      <div class="bar ${kind}"><div class="fill" style="width:${p}%"></div></div>
    </div>`
  }

  function formatSystemLabel(systemName, securityRating) {
    const name = systemName || '—'
    if (securityRating == null || !Number.isFinite(securityRating)) return name
    const sec = Math.max(0, Math.min(6, Math.floor(securityRating)))
    let cls = 'sec-low'
    if (sec >= 4) cls = 'sec-high'
    else if (sec >= 2) cls = 'sec-mid'
    return `${name} <span class="sec-badge ${cls}" title="System security ${sec}/6">Sec ${sec}</span>`
  }

  return {
    // forwardSpeed is signed (negative while reversing), unlike speed which
    // is the overall (unsigned) velocity magnitude shown in the text readout.
    // nearestBodyName: string when within HUD proximity of a planet/moon/star/
    // station/settlement; null/undefined hides the line.
    // securityRating: 0–6 system security shown beside the name.
    update(shipState, shipClass, speed, forwardSpeed, systemName = null, nearestBodyName = null, securityRating = null) {
      const maxSh = (typeof shipState.maxShields === 'number' && shipState.maxShields > 0)
        ? shipState.maxShields
        : shipClass.stats.shields
      const maxAr = (typeof shipState.maxArmor === 'number' && shipState.maxArmor > 0)
        ? shipState.maxArmor
        : shipClass.stats.armor
      const shieldPct = pct(shipState.shields, maxSh)
      const armorPct = pct(shipState.armor, maxAr)
      const hullPct = pct(shipState.hull, shipClass.stats.hull)
      shieldFill.style.width = `${shieldPct}%`
      armorFill.style.width = `${armorPct}%`
      hullFill.style.width = `${hullPct}%`
      hullFill.classList.toggle('critical', hullPct / 100 < CRITICAL_HULL_FRACTION)
      shieldValue.textContent = `${shieldPct.toFixed(0)}%`
      armorValue.textContent = `${armorPct.toFixed(0)}%`
      hullValue.textContent = `${hullPct.toFixed(0)}%`

      // Installed drones / bay capacity — under hull whenever the hull has bays.
      const dronesBayRow = hud.querySelector('.drones-bay')
      const dronesBayCount = hud.querySelector('.drones-bay-count')
      const bayCount = Math.max(0, Math.floor(Number(shipClass?.droneBays) || 0))
      if (dronesBayRow && dronesBayCount) {
        if (bayCount > 0) {
          dronesBayRow.style.display = 'block'
          const installed = (shipState.drones ?? []).length
          dronesBayCount.textContent = `${installed}/${bayCount}`
        } else {
          dronesBayRow.style.display = 'none'
        }
      }

      const frac = Math.max(-1, Math.min(1, forwardSpeed / shipClass.stats.speed))
      velocityFill.classList.toggle('reversing', frac < 0)
      velocityFill.style.left = `${50 + Math.min(0, frac) * 50}%`
      velocityFill.style.width = `${Math.abs(frac) * 50}%`

      speedEl.textContent = `${speed.toFixed(0)} m/s`

      const sysKey = `${systemName ?? ''}|${securityRating ?? ''}`
      if (systemName != null && sysKey !== lastSystemLabelKey) {
        lastSystemLabelKey = sysKey
        systemNameEl.innerHTML = formatSystemLabel(systemName, securityRating)
      }

      const nb = nearestBodyName || null
      if (nb !== lastNearestBodyName) {
        lastNearestBodyName = nb
        if (nb) {
          nearestBodyNameEl.textContent = nb
          nearestBodyEl.classList.add('visible')
        } else {
          nearestBodyNameEl.textContent = ''
          nearestBodyEl.classList.remove('visible')
        }
      }

      // Deployed drones: live S/A/H under ship bars
      const dronesBlock = hud.querySelector('.drones-block')
      const droneRows = hud.querySelector('.drone-rows')
      const deployed = (shipState.drones ?? []).filter(
        (d) => d.deployed && !d.destroyed && d.hull > 0 && d.mode !== 'bay'
      )
      if (dronesBlock && droneRows) {
        if (deployed.length) {
          dronesBlock.style.display = 'block'
          droneRows.innerHTML = deployed
            .map((d, i) => {
              const h = pct(d.hull, d.maxHull || d.hull || 1)
              const s = pct(d.shields, d.maxShields || d.shields || 1)
              const a = pct(d.armor, d.maxArmor || d.armor || 1)
              return `<div class="row" style="margin-bottom:6px">
                <div class="row-label"><span>Drone ${i + 1}</span><span class="value">S${s.toFixed(0)} A${a.toFixed(0)} H${h.toFixed(0)}</span></div>
                <div class="bar hull" style="height:5px"><div class="fill" style="width:${h}%"></div></div>
              </div>`
            })
            .join('')
        } else {
          dronesBlock.style.display = 'none'
          droneRows.innerHTML = ''
        }
      }
    },
    /**
     * Tab-lock target panel (top right, left of system overview).
     * @param {null|{
     *   name:string, hostile?:boolean, meta?:string,
     *   shields?:number, maxShields?:number,
     *   armor?:number, maxArmor?:number,
     *   hull?:number, maxHull?:number,
     *   oreLeft?:number, oreMax?:number,
     *   kind?:string
     * }} info
     */
    updateTarget(info) {
      if (!targetPanel) return
      if (!info) {
        targetPanel.classList.remove('visible', 'hostile')
        targetPanel.dataset.barsKey = ''
        return
      }
      targetPanel.classList.add('visible')
      targetPanel.classList.toggle('hostile', !!info.hostile)
      targetNameEl.textContent = info.name || '—'
      targetMetaEl.textContent = info.meta || ''
      targetMetaEl.style.display = info.meta ? 'block' : 'none'

      // Only rebuild bar HTML when values change (was every frame → layout thrash).
      const barsKey = [
        info.shields | 0,
        info.maxShields | 0,
        info.armor | 0,
        info.maxArmor | 0,
        info.hull | 0,
        info.maxHull | 0,
        info.oreLeft | 0,
        info.oreMax | 0
      ].join('|')
      if (targetPanel.dataset.barsKey === barsKey) return
      targetPanel.dataset.barsKey = barsKey

      const parts = []
      if (info.maxShields != null && info.maxShields > 0) {
        parts.push(barRow('Shield', info.shields ?? 0, info.maxShields, 'shield'))
      }
      if (info.maxArmor != null && info.maxArmor > 0) {
        parts.push(barRow('Armour', info.armor ?? 0, info.maxArmor, 'armor'))
      }
      if (info.maxHull != null && info.maxHull > 0) {
        parts.push(barRow('Hull', info.hull ?? 0, info.maxHull, 'hull'))
      }
      if (info.oreMax != null && info.oreMax > 0) {
        parts.push(barRow('Ore', info.oreLeft ?? 0, info.oreMax, 'ore'))
      }
      targetBarsEl.innerHTML = parts.join('')
    },
    /**
     * Warp-gate plotted route on the far left.
     * @param {null|Array<{ id?: string, name: string }|string>} hops remaining systems (dest last)
     */
    updatePlottedRoute(hops) {
      if (!routeHudEl || !routeListEl) return
      const list = Array.isArray(hops) ? hops : []
      if (!list.length) {
        if (lastRouteKey !== '') {
          lastRouteKey = ''
          routeHudEl.classList.remove('visible')
          routeListEl.innerHTML = ''
          if (routeCountEl) routeCountEl.textContent = ''
        }
        return
      }
      const rows = list.map((h) => {
        if (h && typeof h === 'object') {
          return { id: String(h.id ?? h.name ?? ''), name: String(h.name ?? h.id ?? '—') }
        }
        return { id: String(h), name: String(h) }
      })
      const key = rows.map((r) => r.id || r.name).join('\0')
      if (key === lastRouteKey) return
      lastRouteKey = key
      routeHudEl.classList.add('visible')
      const n = rows.length
      if (routeCountEl) {
        routeCountEl.textContent = `· ${n} jump${n === 1 ? '' : 's'}`
      }
      // Escape names for safety (system names are generated, but keep consistent).
      const esc = (s) =>
        String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      routeListEl.innerHTML = rows
        .map((r, i) => {
          const isNext = i === 0
          const isDest = i === n - 1
          const tags = [
            isNext ? '<span class="tag">next</span>' : '',
            isDest ? '<span class="tag">dest</span>' : ''
          ].join('')
          return `<li class="${isNext ? 'next' : ''} ${isDest ? 'dest' : ''}">
            <span class="hop">${i + 1}.</span>
            <span class="name">${esc(r.name)}</span>
            ${tags}
          </li>`
        })
        .join('')
    },
    // contacts: [{ x, y, z, kind }] ship-local (x=right, y=up, z=forward).
    // 3D rectangular floor grid (heading-up) — rotates with ship via local frame.
    // Bare canvas (no panel chrome). elapsed: gameState.simTime.
    updateRadar(contacts, range, elapsed = 0) {
      radarCtx.clearRect(0, 0, radarW, radarH)
      const { accentRgb } = getUiPalette()
      const ar = (a) => `rgba(${accentRgb.r},${accentRgb.g},${accentRgb.b},${a})`
      const invRange = 1 / Math.max(1, range)

      // Forward-tilted plane: bow (+z) toward top of canvas; pin to top edge.
      const mapX = (x, _y, z) => x * (0.92 + 0.08 * (1 - z))
      const mapY = (_x, y, z) => z * 0.42 + y * 0.9
      const U = 1
      // Bounds for floor + a little height so blips/stems aren't clipped.
      let minIx = Infinity
      let maxIx = -Infinity
      let minIy = Infinity
      let maxIy = -Infinity
      for (const x of [-U, U]) {
        for (const z of [-U, U]) {
          for (const y of [0, 0.35]) {
            const ix = mapX(x, y, z)
            const iy = mapY(x, y, z)
            if (ix < minIx) minIx = ix
            if (ix > maxIx) maxIx = ix
            if (iy < minIy) minIy = iy
            if (iy > maxIy) maxIy = iy
          }
        }
      }
      const padX = 6
      const padTop = 2
      const padBot = 4
      // Stretch to fill the full canvas (no empty gap under the title bar).
      const scaleX = (radarW - padX * 2) / Math.max(1e-6, maxIx - minIx)
      const scaleY = (radarH - padTop - padBot) / Math.max(1e-6, maxIy - minIy)
      // Pin highest projected point to the top of the canvas.
      const ox = radarW * 0.5 - ((minIx + maxIx) * 0.5) * scaleX
      const oy = padTop + maxIy * scaleY
      const project = (x, y, z) => ({
        sx: ox + mapX(x, y, z) * scaleX,
        sy: oy - mapY(x, y, z) * scaleY,
        depth: -z + y * 0.25
      })
      const line = (a, b, stroke, width = 1) => {
        radarCtx.strokeStyle = stroke
        radarCtx.lineWidth = width
        radarCtx.beginPath()
        radarCtx.moveTo(a.sx, a.sy)
        radarCtx.lineTo(b.sx, b.sy)
        radarCtx.stroke()
      }

      // Soft rectangular floor fill (y = 0).
      {
        const c0 = project(-U, 0, -U)
        const c1 = project(U, 0, -U)
        const c2 = project(U, 0, U)
        const c3 = project(-U, 0, U)
        radarCtx.beginPath()
        radarCtx.moveTo(c0.sx, c0.sy)
        radarCtx.lineTo(c1.sx, c1.sy)
        radarCtx.lineTo(c2.sx, c2.sy)
        radarCtx.lineTo(c3.sx, c3.sy)
        radarCtx.closePath()
        radarCtx.fillStyle = 'rgba(6,12,22,0.4)'
        radarCtx.fill()
        radarCtx.strokeStyle = ar(0.4)
        radarCtx.lineWidth = 1.2
        radarCtx.stroke()
      }

      // Floor grid lines (ship-local — whole plane turns with hull via contacts).
      radarCtx.strokeStyle = ar(0.18)
      radarCtx.lineWidth = 1
      const divs = 4
      for (let i = 0; i <= divs; i++) {
        const t = -U + (2 * U * i) / divs
        const a0 = project(-U, 0, t)
        const a1 = project(U, 0, t)
        const b0 = project(t, 0, -U)
        const b1 = project(t, 0, U)
        radarCtx.beginPath()
        radarCtx.moveTo(a0.sx, a0.sy)
        radarCtx.lineTo(a1.sx, a1.sy)
        radarCtx.moveTo(b0.sx, b0.sy)
        radarCtx.lineTo(b1.sx, b1.sy)
        radarCtx.stroke()
      }
      // Stronger ship axes on the floor.
      line(project(0, 0, -U), project(0, 0, U), ar(0.5), 1.3)
      line(project(-U, 0, 0), project(U, 0, 0), ar(0.32), 1)

      // Sweep wedge on the floor plane.
      {
        const sweep = elapsed * 1.5
        radarCtx.save()
        radarCtx.globalAlpha = 0.3
        radarCtx.beginPath()
        const o = project(0, 0, 0)
        radarCtx.moveTo(o.sx, o.sy)
        const steps = 12
        for (let i = 0; i <= steps; i++) {
          const a = sweep - 0.55 + (0.55 * i) / steps
          // Clamp ray to square edge.
          const sx = Math.sin(a)
          const cz = Math.cos(a)
          const m = Math.max(Math.abs(sx), Math.abs(cz)) || 1
          const p = project((sx / m) * U * 0.98, 0, (cz / m) * U * 0.98)
          radarCtx.lineTo(p.sx, p.sy)
        }
        radarCtx.closePath()
        radarCtx.fillStyle = ar(0.28)
        radarCtx.fill()
        radarCtx.restore()
      }

      // Own ship — nose along +Z (forward).
      const origin = project(0, 0, 0)
      const nose = project(0, 0, 0.14)
      const ndx = nose.sx - origin.sx
      const ndy = nose.sy - origin.sy
      const nlen = Math.hypot(ndx, ndy) || 1
      const fx = ndx / nlen
      const fy = ndy / nlen
      const px = -fy
      const py = fx
      const palette = getUiPalette()
      // Black drop-shadow under ship marker (no coloured glow).
      radarCtx.shadowColor = 'rgba(0,0,0,0.9)'
      radarCtx.shadowBlur = 4
      radarCtx.shadowOffsetX = 1
      radarCtx.shadowOffsetY = 2
      radarCtx.fillStyle = palette.bright
      radarCtx.beginPath()
      radarCtx.moveTo(origin.sx + fx * 5, origin.sy + fy * 5)
      radarCtx.lineTo(origin.sx - fx * 3 + px * 3.2, origin.sy - fy * 3 + py * 3.2)
      radarCtx.lineTo(origin.sx - fx * 1.2, origin.sy - fy * 1.2)
      radarCtx.lineTo(origin.sx - fx * 3 - px * 3.2, origin.sy - fy * 3 - py * 3.2)
      radarCtx.closePath()
      radarCtx.fill()
      radarCtx.shadowBlur = 0
      radarCtx.shadowOffsetX = 0
      radarCtx.shadowOffsetY = 0

      // Contacts (ship-local → grid rotates with ship); height stems off floor.
      const plotted = []
      for (const c of contacts) {
        let x = Math.max(-1, Math.min(1, c.x * invRange))
        const y = Math.max(-1, Math.min(1, (c.y ?? 0) * invRange))
        let z = Math.max(-1, Math.min(1, c.z * invRange))
        const foot = project(x * U, 0, z * U)
        const blip = project(x * U, y * 0.9, z * U)
        plotted.push({ blip, foot, kind: c.kind, y, depth: blip.depth, targeted: !!c.targeted })
      }
      plotted.sort((a, b) => b.depth - a.depth)

      // Precompute hostile blink once per frame (cheap; avoids per-blip string churn).
      const hostileBlink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(elapsed * 10))
      const hostileFill = `rgba(255,48,48,${hostileBlink.toFixed(3)})`
      const hostileStem = `rgba(255,48,48,${(0.35 + 0.45 * hostileBlink).toFixed(3)})`

      for (const c of plotted) {
        const isHostile = c.kind === 'hostile'
        const color = isHostile ? hostileStem : contactColor(c.kind)
        radarCtx.strokeStyle = color
        radarCtx.globalAlpha = isHostile ? 0.55 : 0.5
        radarCtx.lineWidth = 1
        radarCtx.beginPath()
        radarCtx.moveTo(c.foot.sx, c.foot.sy)
        radarCtx.lineTo(c.blip.sx, c.blip.sy)
        radarCtx.stroke()
        radarCtx.globalAlpha = isHostile ? 0.6 : 0.55
        radarCtx.beginPath()
        radarCtx.arc(c.foot.sx, c.foot.sy, 1.5, 0, Math.PI * 2)
        radarCtx.stroke()
        radarCtx.globalAlpha = 1
        // Hostile: soft size pulse only (no per-frame shadowBlur — that hitching on engage).
        const pulse = isHostile ? 1 + 0.28 * Math.sin(elapsed * 10) : 1
        const r = (isHostile ? 3.2 : 2.4) * pulse
        radarCtx.fillStyle = isHostile ? hostileFill : color
        radarCtx.beginPath()
        radarCtx.arc(c.blip.sx, c.blip.sy, r, 0, Math.PI * 2)
        radarCtx.fill()
        if (Math.abs(c.y) > 0.08) {
          radarCtx.strokeStyle = color
          radarCtx.globalAlpha = isHostile ? hostileBlink : 1
          radarCtx.lineWidth = 1.2
          const dy = c.y > 0 ? -r - 2 : r + 2
          radarCtx.beginPath()
          radarCtx.moveTo(c.blip.sx - 2.2, c.blip.sy + dy + (c.y > 0 ? 2.5 : -2.5))
          radarCtx.lineTo(c.blip.sx, c.blip.sy + dy)
          radarCtx.lineTo(c.blip.sx + 2.2, c.blip.sy + dy + (c.y > 0 ? 2.5 : -2.5))
          radarCtx.stroke()
          radarCtx.globalAlpha = 1
        }
        // Tab-lock: pure red flashing square border on the radar blip.
        if (c.targeted) {
          const flash = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 12))
          const br = r + 4
          radarCtx.strokeStyle = `rgba(255, 0, 0, ${flash})`
          radarCtx.lineWidth = 2.25
          radarCtx.strokeRect(c.blip.sx - br, c.blip.sy - br, br * 2, br * 2)
        }
      }
      radarCtx.shadowBlur = 0
      radarCtx.shadowOffsetX = 0
      radarCtx.shadowOffsetY = 0
      radarCtx.globalAlpha = 1
    },
    /** Sparse chromatic glitch on all HUD chrome while supercruising. */
    setCruiseGlitch(active) {
      hud.classList.toggle('cruise-glitch', !!active)
    },
    /**
     * System-name chip opens System Scan (replaces the old dedicated button).
     * @param {() => void} fn
     */
    onSystemScan(fn) {
      const open = () => fn?.()
      systemLabelEl.onclick = (e) => {
        e.preventDefault()
        if (hud.classList.contains('docked')) return
        open()
      }
      systemLabelEl.onkeydown = (e) => {
        if (hud.classList.contains('docked')) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }
    },
    /**
     * While docked: hide flight HUD (stats, velocity, radar, target).
     * Keep system name + station/settlement on the top-left.
     * @param {boolean} docked
     * @param {{ systemName?: string|null, locationName?: string|null, securityRating?: number|null }} [info]
     */
    setDocked(docked, info = {}) {
      hud.classList.toggle('docked', !!docked)
      if (!docked) {
        // Restore default nearest-body tag wording.
        const tag = nearestBodyEl.querySelector('.nb-tag')
        if (tag) tag.textContent = 'Nearest Body'
        return
      }
      const tag = nearestBodyEl.querySelector('.nb-tag')
      if (tag) tag.textContent = 'Docked'
      const systemName = info.systemName ?? null
      const securityRating = info.securityRating ?? null
      const locationName = info.locationName ?? null
      const sysKey = `${systemName ?? ''}|${securityRating ?? ''}|dock`
      if (systemName != null && sysKey !== lastSystemLabelKey) {
        lastSystemLabelKey = sysKey
        systemNameEl.innerHTML = formatSystemLabel(systemName, securityRating)
      }
      const loc = locationName || null
      if (loc !== lastNearestBodyName) {
        lastNearestBodyName = loc
        if (loc) {
          nearestBodyNameEl.textContent = loc
          nearestBodyEl.classList.add('visible')
        } else {
          nearestBodyNameEl.textContent = ''
          nearestBodyEl.classList.remove('visible')
        }
      }
    },
    element: hud
  }
}
