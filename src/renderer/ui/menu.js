import { STARTER_SHIP_CLASS_ID, getShipClass } from '../data/shipClasses.js'
import {
  SETTINGS_VIEW_CSS,
  settingsViewHTML,
  uiColourViewHTML,
  bindSettingsView,
  bindUiColourView
} from './settingsView.js'
import { controlsListHTML } from './controlsList.js'
import { escapeHtml } from './escapeHtml.js'
import { isPortraitImageFile, resizeImageToDataUrl } from './portrait.js'

const STYLE = `
/* Light dark halo for legibility over the sun — keep it modest so type stays bright. */
#main-menu {
  position: fixed; inset: 0;
  background: radial-gradient(ellipse at center, rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.35) 0%, rgba(var(--ui-bg-scrim-r),var(--ui-bg-scrim-g),var(--ui-bg-scrim-b),0.8) 100%);
  font-family: monospace; color: var(--ui-text);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
  text-shadow:
    0 1px 2px rgba(0,0,0,0.75),
    0 2px 6px rgba(0,0,0,0.45);
}
#main-menu::before {
  content: ''; position: absolute; inset: -20%; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.03) 0px, rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.03) 1px, transparent 1px, transparent 3px);
  animation: scan 10s linear infinite;
}
@keyframes scan { from { transform: translateY(0); } to { transform: translateY(60px); } }

#main-menu .panel {
  display: flex; flex-direction: column; gap: 10px; width: 560px; position: relative; z-index: 1;
  padding: 28px 32px;
}
/* Full-screen main view: title up above the star; menu row above lower HUD. */
#main-menu .main-view {
  width: min(92vw, 720px);
  height: 100%;
  max-height: 100%;
  padding: 0;
  align-items: center;
  justify-content: center;
  text-align: center;
  pointer-events: none; /* only interactive children re-enable */
}
/* Horizontal strip a bit above the footer / lower HUD band (footer ~26px). */
#main-menu .main-view .menu-links {
  pointer-events: auto;
  position: absolute;
  left: 50%;
  bottom: max(64px, 8.5vh);
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px 36px;
  width: min(94vw, 920px);
  z-index: 2;
}
#main-menu .title-block {
  position: absolute;
  top: max(36px, 7vh);
  left: 50%;
  transform: translateX(-50%);
  width: min(92vw, 780px);
  text-align: center;
  pointer-events: none;
  z-index: 2;
}

/* Cinematic vignette so the 3D backdrop darkens toward the edges and the
   title pops. Corner braces match the in-game HUD's cockpit frame, so menu
   and gameplay read as one visual system. */
#main-menu::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(2,4,8,0.75) 100%);
}
#main-menu .frame { position: absolute; inset: 14px; pointer-events: none; z-index: 2; }
#main-menu .frame .corner { position: absolute; width: 44px; height: 44px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.9)) drop-shadow(0 6px 12px rgba(0,0,0,0.55)); }
#main-menu .frame .corner.tl { top: 0; left: 0; border-right: none; border-bottom: none; }
#main-menu .frame .corner.tr { top: 0; right: 0; border-left: none; border-bottom: none; }
#main-menu .frame .corner.bl { bottom: 0; left: 0; border-right: none; border-top: none; }
#main-menu .frame .corner.br { bottom: 0; right: 0; border-left: none; border-top: none; }

#main-menu .footer {
  position: absolute; bottom: 26px; left: 0; right: 0; text-align: center; z-index: 2;
  font-size: 10px; letter-spacing: 3px; color: var(--ui-muted); pointer-events: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5);
}
/* Same monospace / cyan HUD type as in-game panels. */
#main-menu .copyright {
  position: absolute; bottom: 22px; right: 28px; z-index: 2;
  font-family: monospace; font-size: 10px; letter-spacing: 2px;
  color: var(--ui-text); opacity: 0.65; pointer-events: none; user-select: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5);
}

#main-menu h1 { margin: 0 0 8px 0; }
:root { --title-glow: 255, 70, 40; }
/* One-shot cinematic entrance — the title resolves out of a blur — replayed
   whenever the menu (re)shows via the same .reveal class the buttons use. */
@keyframes titleEntrance {
  from { opacity: 0; transform: translateX(-50%) scale(1.08); filter: blur(14px); }
  to { opacity: 1; transform: translateX(-50%) scale(1); filter: blur(0); }
}
/* Each line of the (now two-line) title is its own box with the gradient/
   glitch applied per-line, rather than once across the whole h1 — the
   glitch clip-path bands below are percentages of a single line's height,
   so splitting them over a taller multi-line block would slice across the
   gap between lines instead of through each line's own glyphs. */
/* Bright gradient fill — avoid stacking opaque black drop-shadows on
   background-clip:text (they eat the fill and leave a dark outline). */
#main-menu h1 .line {
  display: block; position: relative; font-size: 69px; letter-spacing: 6px;
  font-weight: 600; text-transform: uppercase;
  /* Accent-tinted title wash so UI Colour retints the logo text too. */
  background: linear-gradient(90deg, var(--ui-accent), var(--ui-bright), var(--ui-soft), var(--ui-accent));
  background-size: 300% auto;
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  animation: titleShift 6s linear infinite, titleGlow 5s ease-in-out infinite;
}
/* Second line sits under DROWNED a bit smaller so the hierarchy reads clearly. */
#main-menu h1 .line.line-sub {
  font-size: 42px; letter-spacing: 8px; margin-top: 6px;
  opacity: 1;
}
@keyframes titleShift { to { background-position: 300% center; } }
/* Soft dark lift + wide, low-opacity halo so it dissolves into the starfield
   rather than sitting as a hard neon outline.
   Hue comes from --title-glow (an "r,g,b" triplet) which main.js retargets each
   frame to whichever plasma ring is nearest the menu camera — the keyframes
   only animate radius and alpha, so the pulse survives any colour. */
@keyframes titleGlow {
  0%   { filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.55))
    drop-shadow(0 0 14px rgba(var(--title-glow), 0.35))
    drop-shadow(0 0 42px rgba(var(--title-glow), 0.18))
    drop-shadow(0 0 72px rgba(var(--title-glow), 0.1)); }
  25%  { filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.55))
    drop-shadow(0 0 16px rgba(var(--title-glow), 0.38))
    drop-shadow(0 0 48px rgba(var(--title-glow), 0.16))
    drop-shadow(0 0 80px rgba(var(--title-glow), 0.09)); }
  50%  { filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.55))
    drop-shadow(0 0 18px rgba(var(--title-glow), 0.4))
    drop-shadow(0 0 52px rgba(var(--title-glow), 0.18))
    drop-shadow(0 0 88px rgba(var(--title-glow), 0.1)); }
  75%  { filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.55))
    drop-shadow(0 0 16px rgba(var(--title-glow), 0.36))
    drop-shadow(0 0 48px rgba(var(--title-glow), 0.15))
    drop-shadow(0 0 80px rgba(var(--title-glow), 0.09)); }
  100% { filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.55))
    drop-shadow(0 0 14px rgba(var(--title-glow), 0.35))
    drop-shadow(0 0 42px rgba(var(--title-glow), 0.18))
    drop-shadow(0 0 72px rgba(var(--title-glow), 0.1)); }
}

/* Brief chromatic-aberration glitch slices, sparse (~93-97% of the loop is
   quiet) so it reads as an occasional signal hiccup rather than constant
   noise. content: attr(data-text) mirrors whatever's in each .line's
   data-text attribute, so the glitch layer can never drift out of sync with
   the line's real text. */
#main-menu h1 .line::before, #main-menu h1 .line::after {
  content: attr(data-text); position: absolute; inset: 0;
  background: inherit; -webkit-background-clip: text; background-clip: text; color: transparent;
  opacity: 0; mix-blend-mode: screen;
}
#main-menu h1 .line::before { clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%); filter: hue-rotate(-50deg); animation: glitchTop 6.5s steps(1) infinite; }
#main-menu h1 .line::after { clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%); filter: hue-rotate(170deg); animation: glitchBottom 6.5s steps(1) infinite; }
@keyframes glitchTop {
  0%, 91%, 100% { opacity: 0; transform: translate(0, 0); }
  92% { opacity: 0.85; transform: translate(-5px, -1px); }
  93% { opacity: 0.85; transform: translate(4px, 1px); }
  94% { opacity: 0; transform: translate(0, 0); }
  96% { opacity: 0.7; transform: translate(3px, 0); }
  97% { opacity: 0; transform: translate(0, 0); }
}
@keyframes glitchBottom {
  0%, 91%, 100% { opacity: 0; transform: translate(0, 0); }
  92% { opacity: 0.85; transform: translate(5px, 1px); }
  93% { opacity: 0.85; transform: translate(-4px, -1px); }
  94% { opacity: 0; transform: translate(0, 0); }
  96% { opacity: 0.7; transform: translate(-3px, 0); }
  97% { opacity: 0; transform: translate(0, 0); }
}

/* Thin glowing rule lines flanking the subtitle — cheap cinematic framing. */
#main-menu .subtitle {
  margin: 0; font-size: 11px; letter-spacing: 5px; color: var(--ui-soft);
  display: flex; align-items: center; justify-content: center; gap: 14px;
  animation: flicker 5s ease-in-out infinite;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5),
    0 2px 4px rgba(0,0,0,0.75);
}
#main-menu .subtitle::before, #main-menu .subtitle::after {
  content: ''; height: 1px; width: 70px;
  background: linear-gradient(90deg, transparent, rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.6));
  box-shadow: 0 1px 3px rgba(0,0,0,0.7);
}
#main-menu .subtitle::after { background: linear-gradient(90deg, rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.6), transparent); }
@keyframes flicker {
  0%, 92%, 100% { opacity: 0.7; }
  93%, 95% { opacity: 0.2; }
}

#main-menu h2 {
  margin: 0 0 10px 0;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5);
}
#main-menu label {
  display: flex; flex-direction: column; gap: 4px; font-size: 13px; text-align: left;
  text-shadow: 0 1px 2px rgba(0,0,0,0.75), 0 2px 5px rgba(0,0,0,0.45);
}
#main-menu input[type="text"],
#main-menu input:not([type]) {
  background: var(--ui-bg-solid); border: 1px solid #2a3a55; color: var(--ui-text); padding: 8px; font-family: monospace;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
#main-menu input[type="text"]:focus,
#main-menu input:not([type]):focus { outline: none; border-color: var(--ui-glow); box-shadow: 0 1px 3px rgba(0,0,0,0.7); }

/* Create Pilot — portrait upload (matches Character sheet). */
#main-menu .new-game-view {
  width: min(480px, 92vw);
  padding: 28px 32px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.92), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.88));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#main-menu .new-game-view h2 {
  margin: 0 0 14px 0; text-align: center; font-weight: normal; letter-spacing: 4px;
  text-transform: uppercase; color: var(--ui-accent); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#main-menu .new-game-layout {
  display: grid;
  grid-template-columns: 132px 1fr;
  gap: 16px 20px;
  align-items: start;
  width: 100%;
}
@media (max-width: 480px) {
  #main-menu .new-game-layout { grid-template-columns: 1fr; justify-items: center; }
  #main-menu .new-game-fields { width: 100%; }
}
#main-menu .new-game-identity {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
#main-menu .new-game-portrait {
  width: 120px; height: 120px;
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.5);
  box-shadow: 0 2px 6px rgba(0,0,0,0.85), 0 6px 14px rgba(0,0,0,0.5), inset 0 0 14px rgba(0,0,0,0.4);
  background: rgba(8,12,22,0.9);
  overflow: hidden; position: relative;
}
#main-menu .new-game-portrait img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
#main-menu .new-game-portrait .placeholder {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  font-size: 42px; color: var(--ui-muted); letter-spacing: 0;
}
#main-menu .new-game-portrait-actions {
  display: flex; flex-direction: column; gap: 5px; width: 120px;
}
#main-menu .new-game-view button.upload-btn,
#main-menu .new-game-view button.clear-portrait {
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4);
  color: var(--ui-pale); padding: 5px 8px; cursor: pointer; font-family: monospace;
  font-size: 10px; letter-spacing: 0.5px; width: 100%;
  opacity: 1 !important; transform: none !important;
}
#main-menu .new-game-view button.upload-btn:hover,
#main-menu .new-game-view button.clear-portrait:hover {
  background: rgba(var(--ui-gr),var(--ui-gg),var(--ui-gb),0.2); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
  transform: none !important;
}
#main-menu .new-game-view button.clear-portrait {
  border-color: rgba(224,90,90,0.45); color: #ffb3b3; background: rgba(224,90,90,0.08);
}
#main-menu .new-game-view button.clear-portrait:hover {
  background: rgba(224,90,90,0.18); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#main-menu .new-game-view input[type=file] { display: none; }
#main-menu .new-game-fields {
  display: flex; flex-direction: column; gap: 10px; min-width: 0; width: 100%;
}
#main-menu .new-game-actions {
  display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 4px;
}
#main-menu .new-game-view .upload-err {
  font-size: 10px; color: #ff9a7a; max-width: 120px; text-align: center; margin-top: 2px;
}
#main-menu .new-game-view .portrait-hint {
  font-size: 10px; opacity: 0.55; margin: 0; letter-spacing: 0.3px; text-align: center;
  max-width: 120px; line-height: 1.3;
}
/* Nested controls are not panel > button — force visible (riseIn only hits direct kids). */
#main-menu .new-game-view button {
  opacity: 1 !important; transform: none !important;
}
#main-menu .new-game-view button.confirm-new-game,
#main-menu .new-game-view button.back {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 11px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  width: 100%; box-sizing: border-box;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#main-menu .new-game-view button.confirm-new-game:hover,
#main-menu .new-game-view button.back:hover {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
  transform: none !important;
}

#main-menu button {
  background: var(--ui-bg-solid-mid); border: 1px solid #2a3a55; color: var(--ui-text); padding: 12px; cursor: pointer; font-family: monospace;
  letter-spacing: 1px; opacity: 0; transform: translateY(8px);
  transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
#main-menu button:disabled { opacity: 0.35 !important; cursor: not-allowed; }
#main-menu button.quit { border-color: #a13a3a; }
/* Boxed hover only for form buttons — not .menu-link (see overrides below). */
#main-menu button:not(.menu-link):hover:not(:disabled) {
  background: #223252; border-color: var(--ui-key); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
  transform: translateY(8px) scale(1.02);
}
#main-menu button:not(.menu-link).quit:hover:not(:disabled) {
  border-color: #d94f4f; box-shadow: 0 2px 6px rgba(0,0,0,0.65);
}
#main-menu button:not(.menu-link):active:not(:disabled) { transform: translateY(9px) scale(0.99); }

/* Top-level New Game / Load / Quit — plain text only, never a hover box. */
#main-menu button.menu-link {
  background: transparent !important; border: none !important; padding: 6px 4px; margin: 0;
  color: var(--ui-pale); font-size: 17px; letter-spacing: 3px; text-transform: uppercase;
  cursor: pointer; font-family: monospace;
  white-space: nowrap;
  opacity: 0; transform: translateY(8px);
  transition: color 0.2s ease, filter 0.2s ease;
  box-shadow: none !important; outline: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8), 0 2px 6px rgba(0,0,0,0.5);
}
#main-menu button.menu-link:disabled { opacity: 0.35 !important; cursor: not-allowed; }
#main-menu button.menu-link:hover:not(:disabled),
#main-menu button.menu-link:focus-visible:not(:disabled) {
  color: #ffffff;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  transform: translateY(8px); /* no scale — keeps hit area from looking boxed */
}
#main-menu button.menu-link .glitch-text {
  position: relative; display: inline-block; padding-bottom: 3px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.7));
}
/* Underline sweep only — no chrome. */
#main-menu button.menu-link::after {
  content: ''; display: block; margin: 2px auto 0; height: 1px; width: 0%;
  background: currentColor; box-shadow: 0 0 8px currentColor;
  transition: width 0.25s ease;
}
#main-menu button.menu-link:hover:not(:disabled)::after,
#main-menu button.menu-link:focus-visible:not(:disabled)::after { width: 60%; }
#main-menu button.menu-link:hover:not(:disabled) .glitch-text,
#main-menu button.menu-link:focus-visible:not(:disabled) .glitch-text {
  filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.7))
    drop-shadow(0 2px 4px rgba(0,0,0,0.9))
    drop-shadow(0 6px 12px rgba(0,0,0,0.55));
}
#main-menu button.menu-link.quit:hover:not(:disabled) .glitch-text,
#main-menu button.menu-link.quit:focus-visible:not(:disabled) .glitch-text {
  filter:
    drop-shadow(0 1px 2px rgba(0,0,0,0.7))
    drop-shadow(0 2px 4px rgba(0,0,0,0.9))
    drop-shadow(0 6px 12px rgba(0,0,0,0.55));
}
#main-menu button.menu-link .glitch-text::before, #main-menu button.menu-link .glitch-text::after {
  content: attr(data-text); position: absolute; inset: 0; color: inherit;
  opacity: 0; mix-blend-mode: screen;
}
#main-menu button.menu-link .glitch-text::before { clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%); filter: hue-rotate(-50deg); animation: menuGlitchTop 7s steps(1) infinite; }
#main-menu button.menu-link .glitch-text::after { clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%); filter: hue-rotate(170deg); animation: menuGlitchBottom 7s steps(1) infinite; }
/* Staggered per item (nth-of-type) so menu links don't glitch in sync. */
#main-menu button.menu-link:nth-of-type(2) .glitch-text::before, #main-menu button.menu-link:nth-of-type(2) .glitch-text::after { animation-delay: 1.4s; }
#main-menu button.menu-link:nth-of-type(3) .glitch-text::before, #main-menu button.menu-link:nth-of-type(3) .glitch-text::after { animation-delay: 2.8s; }
#main-menu button.menu-link:nth-of-type(4) .glitch-text::before, #main-menu button.menu-link:nth-of-type(4) .glitch-text::after { animation-delay: 4.2s; }
@keyframes menuGlitchTop {
  0%, 91%, 100% { opacity: 0; transform: translate(0, 0); }
  92% { opacity: 0.85; transform: translate(-4px, -1px); }
  93% { opacity: 0.85; transform: translate(3px, 1px); }
  94% { opacity: 0; transform: translate(0, 0); }
  96% { opacity: 0.7; transform: translate(2px, 0); }
  97% { opacity: 0; transform: translate(0, 0); }
}
@keyframes menuGlitchBottom {
  0%, 91%, 100% { opacity: 0; transform: translate(0, 0); }
  92% { opacity: 0.85; transform: translate(4px, 1px); }
  93% { opacity: 0.85; transform: translate(-3px, -1px); }
  94% { opacity: 0; transform: translate(0, 0); }
  96% { opacity: 0.7; transform: translate(-2px, 0); }
  97% { opacity: 0; transform: translate(0, 0); }
}

#main-menu.reveal .title-block { animation: titleEntrance 1.1s ease-out; }
#main-menu.reveal .menu-links > button,
#main-menu.reveal .panel > button,
#main-menu.reveal .panel > label,
#main-menu.reveal .panel > h2 {
  animation: riseIn 0.4s ease-out forwards; opacity: 0;
}
#main-menu.reveal .menu-links > button:nth-of-type(1) { animation-delay: 0s; }
#main-menu.reveal .menu-links > button:nth-of-type(2) { animation-delay: 0.08s; }
#main-menu.reveal .menu-links > button:nth-of-type(3) { animation-delay: 0.16s; }
#main-menu.reveal .menu-links > button:nth-of-type(4) { animation-delay: 0.24s; }
#main-menu.reveal .panel > button:nth-of-type(1), #main-menu.reveal .panel > label:nth-of-type(1) { animation-delay: 0s; }
#main-menu.reveal .panel > button:nth-of-type(2), #main-menu.reveal .panel > label:nth-of-type(2) { animation-delay: 0.08s; }
#main-menu.reveal .panel > button:nth-of-type(3), #main-menu.reveal .panel > label:nth-of-type(3) { animation-delay: 0.16s; }
#main-menu.reveal .panel > button:nth-of-type(4) { animation-delay: 0.24s; }
#main-menu.reveal .panel > button:nth-of-type(5) { animation-delay: 0.32s; }
/* Settings panel (same shell as Create Pilot). */
#main-menu .settings-view,
#main-menu .controls-view,
#main-menu .ui-colour-view {
  width: min(360px, 92vw);
  padding: 28px 32px;
  background: linear-gradient(135deg, rgba(var(--ui-bg-r),var(--ui-bg-g),var(--ui-bg-b),0.92), rgba(var(--ui-bg2-r),var(--ui-bg2-g),var(--ui-bg2-b),0.88));
  border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); border-left: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  box-shadow: 0 3px 8px rgba(0,0,0,0.85), 0 10px 24px rgba(0,0,0,0.55);
}
#main-menu .controls-view { width: min(460px, 92vw); max-height: min(80vh, 640px); overflow: hidden; }
#main-menu .settings-view h2,
#main-menu .controls-view h2,
#main-menu .ui-colour-view h2 {
  margin: 0 0 14px 0; text-align: center; font-weight: normal; letter-spacing: 4px;
  text-transform: uppercase; color: var(--ui-accent); text-shadow: 0 1px 2px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.7);
}
#main-menu .settings-view button,
#main-menu .controls-view button,
#main-menu .ui-colour-view button {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1); border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.4); color: var(--ui-text);
  padding: 11px; cursor: pointer; font-family: monospace; letter-spacing: 1px;
  opacity: 1; transform: none;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
#main-menu .settings-view button:hover:not(:disabled),
#main-menu .controls-view button:hover:not(:disabled),
#main-menu .ui-colour-view button:hover:not(:disabled) {
  background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.22); box-shadow: 0 2px 6px rgba(0,0,0,0.65);
  transform: none;
}
#main-menu .ui-colour-view .ui-colour-presets button:hover {
  background: inherit;
}
#main-menu .controls-list {
  display: flex; flex-direction: column; gap: 6px;
  overflow-y: auto; max-height: min(52vh, 420px);
  margin: 0 0 12px 0; padding-right: 4px;
}
#main-menu .controls-list .row {
  display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: baseline;
  font-size: 12px; line-height: 1.35;
}
#main-menu .controls-list .key {
  display: inline-block; padding: 2px 7px; border: 1px solid rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.45);
  border-radius: 3px; color: var(--ui-key); background: rgba(var(--ui-ar),var(--ui-ag),var(--ui-ab),0.1);
  font-size: 11px; letter-spacing: 0.5px; text-align: center; white-space: nowrap;
}
#main-menu .controls-list .label { opacity: 0.85; color: var(--ui-text); }
${SETTINGS_VIEW_CSS}
@keyframes riseIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
`

export function createMenu(container, { onNewGame, onLoadGame }) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const starterShip = getShipClass(STARTER_SHIP_CLASS_ID)

  const root = document.createElement('div')
  root.id = 'main-menu'
  root.innerHTML = `
    <div class="frame">
      <div class="corner tl"></div><div class="corner tr"></div>
      <div class="corner bl"></div><div class="corner br"></div>
    </div>
    <div class="footer">HARBOURMASTER TERMINAL // CHARTS LOADED</div>
    <div class="copyright">© Laughing In Purgatory 2026</div>
    <div class="panel main-view">
      <div class="title-block">
        <h1><span class="line" data-text="DROWNED">DROWNED</span><span class="line line-sub" data-text="WORLD">WORLD</span></h1>
        <div class="subtitle">A PROCEDURALLY GENERATED SEA</div>
      </div>
      <div class="menu-links">
        <button class="new-game menu-link"><span class="glitch-text" data-text="New Game">New Game</span></button>
        <button class="load-game menu-link"><span class="glitch-text" data-text="Load Game">Load Game</span></button>
        <button class="settings menu-link"><span class="glitch-text" data-text="Settings">Settings</span></button>
        <button class="quit menu-link"><span class="glitch-text" data-text="Quit">Quit</span></button>
      </div>
    </div>
    <div class="panel new-game-view" style="display:none">
      <h2>Create Pilot</h2>
      <div class="new-game-layout">
        <div class="new-game-identity">
          <div class="new-game-portrait">
            <div class="placeholder">P</div>
          </div>
          <div class="new-game-portrait-actions">
            <button type="button" class="upload-btn">Upload photo</button>
            <button type="button" class="clear-portrait" style="display:none">Clear</button>
          </div>
          <input type="file" class="portrait-file" accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg" />
          <p class="portrait-hint">Optional PNG / JPG</p>
        </div>
        <div class="new-game-fields">
          <label>Character Name <input type="text" class="char-name" value="Pilot" maxlength="32" spellcheck="false" autocomplete="off" /></label>
          <label>Ship Name <input type="text" class="ship-name" value="${starterShip.name}" maxlength="32" spellcheck="false" autocomplete="off" /></label>
          <div class="new-game-actions">
            <button type="button" class="confirm-new-game">Launch</button>
            <button type="button" class="back">Back</button>
          </div>
        </div>
      </div>
    </div>
    <div class="panel settings-view" style="display:none">
      ${settingsViewHTML()}
    </div>
    <div class="panel ui-colour-view" style="display:none">
      ${uiColourViewHTML()}
    </div>
    <div class="panel controls-view" style="display:none">
      <h2>Controls</h2>
      <div class="controls-list">
        ${controlsListHTML()}
      </div>
      <button type="button" class="controls-back ui-btn-gold">Back</button>
    </div>
  `
  container.appendChild(root)

  const mainView = root.querySelector('.main-view')
  const newGameView = root.querySelector('.new-game-view')
  const settingsView = root.querySelector('.settings-view')
  const uiColourView = root.querySelector('.ui-colour-view')
  const controlsView = root.querySelector('.controls-view')
  const loadBtn = root.querySelector('.load-game')
  const portraitFrame = root.querySelector('.new-game-portrait')
  const portraitFile = root.querySelector('.portrait-file')
  const uploadPortraitBtn = root.querySelector('.upload-btn')
  const clearPortraitBtn = root.querySelector('.clear-portrait')
  const charNameInput = root.querySelector('.char-name')
  const identityCol = root.querySelector('.new-game-identity')

  /** @type {string|null} */
  let pendingPortraitDataUrl = null

  function replayEntrance() {
    root.classList.remove('reveal')
    void root.offsetWidth
    root.classList.add('reveal')
  }

  function renderCreatePortrait() {
    if (pendingPortraitDataUrl) {
      portraitFrame.innerHTML = `<img alt="Pilot portrait" src="${pendingPortraitDataUrl}" />`
      clearPortraitBtn.style.display = 'block'
    } else {
      const initial = (charNameInput.value || 'P').trim().charAt(0).toUpperCase() || 'P'
      portraitFrame.innerHTML = `<div class="placeholder">${escapeHtml(initial)}</div>`
      clearPortraitBtn.style.display = 'none'
    }
  }

  function portraitNotice(msg) {
    identityCol.querySelector('.upload-err')?.remove()
    const el = document.createElement('div')
    el.className = 'upload-err'
    el.textContent = msg
    identityCol.appendChild(el)
    setTimeout(() => el.remove(), 2500)
  }

  function resetNewGameForm() {
    pendingPortraitDataUrl = null
    charNameInput.value = 'Pilot'
    root.querySelector('.ship-name').value = starterShip.name
    renderCreatePortrait()
  }

  function hideSubpanels() {
    settingsView.style.display = 'none'
    if (controlsView) controlsView.style.display = 'none'
    if (uiColourView) uiColourView.style.display = 'none'
  }

  function showMain() {
    mainView.style.display = 'flex'
    newGameView.style.display = 'none'
    hideSubpanels()
    replayEntrance()
  }

  function showSettings() {
    mainView.style.display = 'none'
    newGameView.style.display = 'none'
    hideSubpanels()
    settingsView.style.display = 'flex'
    settingsApi.refresh()
    replayEntrance()
  }

  function showControls() {
    mainView.style.display = 'none'
    newGameView.style.display = 'none'
    hideSubpanels()
    if (controlsView) controlsView.style.display = 'flex'
    replayEntrance()
  }

  function showUiColour() {
    mainView.style.display = 'none'
    newGameView.style.display = 'none'
    hideSubpanels()
    if (uiColourView) {
      uiColourView.style.display = 'flex'
      uiColourApi.refresh()
    }
    replayEntrance()
  }

  function showNewGame() {
    mainView.style.display = 'none'
    hideSubpanels()
    newGameView.style.display = 'flex'
    resetNewGameForm()
    replayEntrance()
  }

  root.querySelector('.new-game').addEventListener('click', () => showNewGame())
  root.querySelector('.back').addEventListener('click', () => showMain())

  charNameInput.addEventListener('input', () => {
    if (!pendingPortraitDataUrl) renderCreatePortrait()
  })
  uploadPortraitBtn.addEventListener('click', () => portraitFile.click())
  clearPortraitBtn.addEventListener('click', () => {
    pendingPortraitDataUrl = null
    renderCreatePortrait()
  })
  portraitFile.addEventListener('change', async () => {
    const file = portraitFile.files?.[0]
    portraitFile.value = ''
    if (!file) return
    if (!isPortraitImageFile(file)) {
      portraitNotice('Use a PNG or JPG image')
      return
    }
    try {
      pendingPortraitDataUrl = await resizeImageToDataUrl(file)
      renderCreatePortrait()
    } catch {
      portraitNotice('Could not load that image')
    }
  })

  root.querySelector('.confirm-new-game').addEventListener('click', () => {
    const characterName = charNameInput.value.trim() || 'Pilot'
    const shipInstanceName = root.querySelector('.ship-name').value.trim() || starterShip.name
    const portraitDataUrl = pendingPortraitDataUrl
    hide()
    onNewGame({ characterName, shipInstanceName, portraitDataUrl })
  })
  loadBtn.addEventListener('click', () => {
    hide()
    onLoadGame()
  })
  root.querySelector('.settings').addEventListener('click', () => showSettings())
  root.querySelector('.quit').addEventListener('click', () => window.electronAPI.quitApp())
  root.querySelector('.controls-back')?.addEventListener('click', () => showSettings())

  const settingsApi = bindSettingsView(settingsView, {
    onBack: showMain,
    onShowControls: showControls,
    onShowUiColour: showUiColour
  })
  const uiColourApi = bindUiColourView(uiColourView, {
    onBack: showSettings
  })

  function hide() {
    root.style.display = 'none'
  }

  return {
    show(hasSaveGame) {
      loadBtn.disabled = !hasSaveGame
      mainView.style.display = 'flex'
      newGameView.style.display = 'none'
      hideSubpanels()
      root.style.display = 'flex'
      replayEntrance()
    },
    hide,
    element: root
  }
}
