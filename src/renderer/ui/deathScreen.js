import { escapeHtml } from './escapeHtml.js'
import { wreckedTypeCSS } from './wreckedType.js'

const TEXT_SHADOW =
  '0 1px 2px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.55)'

/**
 * Same smoke filter as the title screen (menu.js), unique id so both can coexist
 * in the DOM. SVG displacement tears a solid black silhouette into rising wisps.
 */
const SMOKE_FILTER_SVG = `
<svg class="smoke-defs" width="0" height="0" aria-hidden="true" focusable="false">
  <!-- Wide filter region so displaced wisps are not clipped into a hard box. -->
  <filter id="drowned-smoke-death" x="-120%" y="-100%" width="340%" height="320%"
          filterUnits="objectBoundingBox"
          color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.02 0.045" numOctaves="5"
                  seed="7" result="noise">
      <animate attributeName="baseFrequency"
               dur="16s" repeatCount="indefinite"
               values="0.02 0.045; 0.034 0.062; 0.02 0.045"/>
    </feTurbulence>
    <feOffset in="noise" dx="0" dy="0" result="noiseShifted">
      <animate attributeName="dy" dur="6s" repeatCount="indefinite" values="0; -140"/>
    </feOffset>
    <!-- Blur first so displacement tears a cloud, not a sharp letter plate. -->
    <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="mass"/>
    <feDisplacementMap in="mass" in2="noiseShifted" scale="110"
                       xChannelSelector="R" yChannelSelector="G" result="torn"/>
    <feGaussianBlur in="torn" stdDeviation="5" result="soft"/>
    <!-- Pull alpha down so residual fill never reads as a solid panel. -->
    <feColorMatrix in="soft" type="matrix" values="
      0 0 0 0 0
      0 0 0 0 0
      0 0 0 0 0
      0 0 0 1.15 -0.22"/>
  </filter>
</svg>
`

const STYLE = `
/* Transparent centre — wreck orbit shows through; red only at the rim.
   !important beats the global metallic plate theme in index.html. */
#death-screen {
  position: fixed; inset: 0; background: transparent !important; font-family: monospace; color: #f0d0d0;
  display: none; flex-direction: column; align-items: center; justify-content: space-between;
  overflow: hidden;
  pointer-events: none;
  /* Room under the pinned headline for killer/summary. */
  padding: 0 20px 6vh;
  box-sizing: border-box;
  /* Prevent outside HUD stacking contexts from slipping between our layers. */
  isolation: isolate;
}
/* Vignette sits under UI chrome so the headline + smoke stay clear of the blood rim. */
#death-screen::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  z-index: 0;
  /* Deep arterial / dried-blood red at the rim — not bright fire-engine red. */
  background: radial-gradient(
    ellipse at center,
    transparent 38%,
    rgba(48, 0, 4, 0.28) 62%,
    rgba(62, 0, 8, 0.55) 78%,
    rgba(28, 0, 2, 0.88) 100%
  );
  animation: vignettePulse 2.2s ease-in-out infinite;
}
@keyframes vignettePulse { 0%, 100% { opacity: 0.82; } 50% { opacity: 1; } }

/* Top stack: wordmark at the very top, details just under — open water below. */
html #death-screen .panel-top,
#death-screen .panel-top {
  position: relative; z-index: 10; text-align: center; width: 100%;
  max-width: min(92vw, 720px);
  margin: 2.5vh auto 0;
  pointer-events: none;
  background: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  outline: none !important;
  filter: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  /* Smoke plume is wider/taller than the headline — do not box-clip it. */
  overflow: visible;
}

/* This stack sits above all death UI. Smoke is directly below the live title. */
#death-screen .death-title {
  position: relative;
  z-index: 20;
  isolation: isolate;
  width: 100%;
  margin: 0 0 1.1rem;
  padding: 0 8px;
  text-align: center;
  pointer-events: none;
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  overflow: visible;
}

/* --- Smoke (same idea as the title screen) ----------------------------------
   SVG filter on solid type turns each layer into a *rectangular* filter
   surface. Soft radial masks kill that plate edge so only wisps remain;
   multiply blend so residual fill never reads as frosted glass. */
#death-screen .death-smoke-field {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 100vw;
  height: 120vh;
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 1;
  overflow: visible;
  /* Fade only at the very bottom so nothing sits under the live type as a bar. */
  -webkit-mask-image: linear-gradient(to top, transparent 0%, #000 12%, #000 100%);
  mask-image: linear-gradient(to top, transparent 0%, #000 12%, #000 100%);
}
#death-screen .death-smoke {
  position: absolute; left: 0; right: 0; bottom: 0;
  text-align: center;
  pointer-events: none;
  transform-origin: 50% 100%;
  will-change: transform, opacity;
  animation: deathSmokeRise 13s linear infinite;
  /* Kill the rectangular filter plate; keep the centre plume. */
  -webkit-mask-image: radial-gradient(
    ellipse 55% 70% at 50% 85%,
    #000 0%,
    #000 35%,
    transparent 72%
  );
  mask-image: radial-gradient(
    ellipse 55% 70% at 50% 85%,
    #000 0%,
    #000 35%,
    transparent 72%
  );
  mix-blend-mode: multiply;
}
#death-screen .death-smoke.r1 { animation-delay: 0s; }
#death-screen .death-smoke.r2 { animation-delay: -3.25s; }
#death-screen .death-smoke.r3 { animation-delay: -6.5s; }
#death-screen .death-smoke.r4 { animation-delay: -9.75s; }
#death-screen .death-smoke.core {
  animation: deathSmoulder 7s ease-in-out infinite;
  /* Core sits on the letters — keep it wispy, never a filled plate. */
  opacity: 0.55;
}
#death-screen .death-smoke .smoke-text {
  display: block;
  margin: 0;
  padding: 0.08em 0.06em;
  font-family: "Impact", "Haettenschweiler", "Arial Narrow Bold", "Helvetica Neue", sans-serif;
  font-weight: 900;
  font-size: clamp(36px, 7.5vw, 64px);
  letter-spacing: 0.14em;
  line-height: 1.05;
  text-transform: uppercase;
  color: #1a0c08;
  -webkit-text-fill-color: #1a0c08;
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  filter: url(#drowned-smoke-death);
}
@keyframes deathSmoulder {
  0%   { opacity: 0.1;  transform: translate(0, 2px) scale(1.01, 1.02); }
  50%  { opacity: 0.2;  transform: translate(2px, -8px) scale(1.04, 1.08); }
  100% { opacity: 0.1;  transform: translate(4px, -14px) scale(1.06, 1.12); }
}
@keyframes deathSmokeRise {
  0%   { opacity: 0;    transform: translate(0, 0) scale(1.02, 1.04); }
  8%   { opacity: 0.34; transform: translate(3px, -5vh) scale(1.05, 1.12); }
  25%  { opacity: 0.28; transform: translate(8px, -16vh) scale(1.1, 1.28); }
  50%  { opacity: 0.18; transform: translate(14px, -32vh) scale(1.18, 1.55); }
  75%  { opacity: 0.1;  transform: translate(20px, -48vh) scale(1.26, 1.78); }
  100% { opacity: 0;    transform: translate(26px, -64vh) scale(1.35, 2.0); }
}
@media (prefers-reduced-motion: reduce) {
  #death-screen .death-smoke { animation: none; opacity: 0.12; transform: none; }
  #death-screen .death-smoke.r2,
  #death-screen .death-smoke.r3,
  #death-screen .death-smoke.r4 { display: none; }
}

/* Bottom block: pun + return button */
html #death-screen .panel-bottom,
#death-screen .panel-bottom {
  position: relative; z-index: 2; text-align: center; max-width: 520px; width: 100%;
  pointer-events: none;
  display: flex; flex-direction: column; align-items: center;
  background: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  margin-top: auto;
}

/*
 * "YOU HAVE DIED" — as close to the painted title wordmark as CSS can get:
 * scorched metal + ember gradient, heavy erosion, dark rim lift, fire halo.
 */
/* Never put CSS filter on this h1: it flattens to a rectangular surface over
   the smoke (reads as a transparent plate). Glow uses text-shadow instead. */
#death-screen h1 {
  position: relative;
  z-index: 2;
  margin: 0;
  padding: 0.08em 0.06em;
  font-size: clamp(36px, 7.5vw, 64px);
  letter-spacing: 0.14em;
  line-height: 1.05;
  text-transform: uppercase;
  /* Never a plate behind the glyphs — only the letters paint. */
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
  filter: none !important;
  /* Solid fallback if clip fails */
  color: #c45a3a;
  /* Charred iron through rust into dying fire — echoes title-drowned.png */
  background-image:
    linear-gradient(
      168deg,
      #2a2420 0%,
      #5a4034 18%,
      #8a4a32 38%,
      #c45a28 55%,
      #e87830 68%,
      #a04028 82%,
      #3a2820 100%
    );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  /* Glyph-shaped halo — no filter surface, no transparent box over the smoke. */
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.95),
    0 0 14px rgba(255, 70, 40, 0.45),
    0 0 28px rgba(255, 70, 40, 0.22);
}
${wreckedTypeCSS('#death-screen h1', { heavy: true })}
/* wreckedType overwrites font; keep metal fill on the clipped text */
#death-screen h1 {
  font-family: "Impact", "Haettenschweiler", "Arial Narrow Bold", "Helvetica Neue", sans-serif;
  font-weight: 900;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  background-color: transparent !important;
  filter: none !important;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.95),
    0 0 14px rgba(255, 70, 40, 0.45),
    0 0 28px rgba(255, 70, 40, 0.22);
  /* wreckedType sets animation: wreckDrift — keep that; no filter glow pulse. */
}
#death-screen.shake .death-title { animation: shake 0.5s ease-in-out; }
@keyframes shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-6px, 2px); }
  40% { transform: translate(5px, -3px); }
  60% { transform: translate(-4px, 3px); }
  80% { transform: translate(3px, -2px); }
}

#death-screen .killer,
#death-screen .summary,
#death-screen .pun {
  position: relative;
  z-index: 1;
  background: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
  outline: none !important;
}

#death-screen .killer {
  display: block;
  margin: 0 auto 18px;
  padding: 0;
  max-width: min(420px, 100%);
  text-align: center;
  line-height: 1.45;
  opacity: 0;
  font-size: 13px;
}
#death-screen.reveal .killer { animation: fadeUp 0.6s ease-out 0.25s forwards; }

#death-screen .summary {
  margin-bottom: 0; line-height: 1.7; opacity: 0;
  text-shadow: ${TEXT_SHADOW};
}
#death-screen .summary .cause {
  color: #ffb08c;
  letter-spacing: 0.3px;
}
#death-screen.reveal .summary { animation: fadeUp 0.6s ease-out 0.4s forwards; }
#death-screen .killer .k-line {
  color: #f0d0d0;
  text-shadow: ${TEXT_SHADOW};
}
#death-screen .killer .k-name { color: #ffe0e0; font-size: 15px; letter-spacing: 0.5px; }
#death-screen .killer .k-ship { color: var(--ui-accent); }
#death-screen .killer .k-method { margin-top: 6px; opacity: 0.9; font-size: 12px; }
#death-screen .killer .k-faction {
  display: block; margin-top: 4px; font-size: 11px; letter-spacing: 1px;
  text-transform: uppercase; color: #c09090; opacity: 0.85;
  text-shadow: ${TEXT_SHADOW};
}

#death-screen .pun {
  margin: 0 auto 18px; font-size: 13px; letter-spacing: 0.4px; line-height: 1.45;
  color: #d0b0b0; font-style: italic; opacity: 0; max-width: 420px;
  text-shadow: ${TEXT_SHADOW};
}
#death-screen.reveal .pun { animation: fadeUp 0.6s ease-out 0.5s forwards; }

/* Only the return control keeps a plate so it stays obvious and clickable. */
html #death-screen button.return,
#death-screen button.return {
  position: relative;
  z-index: 2;
  background: rgba(42, 20, 20, 0.88) !important;
  background-image:
    linear-gradient(180deg, rgba(255,255,255,0.08), transparent 50%),
    linear-gradient(180deg, rgba(42, 20, 20, 0.95), rgba(28, 12, 12, 0.95)) !important;
  border: 1px solid #8a3a3a !important;
  color: #f0d0d0;
  padding: 10px 20px;
  cursor: pointer;
  font-family: monospace;
  letter-spacing: 1px;
  opacity: 0;
  border-radius: 6px;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  pointer-events: auto !important;
  box-shadow: 0 2px 10px rgba(0,0,0,0.55);
}
#death-screen.reveal button.return { animation: fadeUp 0.6s ease-out 0.65s forwards; }
html #death-screen button.return:hover,
#death-screen button.return:hover {
  background: rgba(58, 26, 26, 0.95) !important;
  border-color: #d94f4f !important;
  box-shadow: 0 2px 12px rgba(0,0,0,0.65);
  filter: none;
}
@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`

/** Light grief + salt-grade dad jokes. */
const DEATH_PUNS = [
  'Your career has gone down with all hands.',
  'You weren’t out of your depth. You are now.',
  'Hull integrity? More like hull “integri-whoops.”',
  'That’s not a keel over. That’s the keel, over.',
  'You were told to watch your draught. This is worse.',
  'The sea is large. Your freeboard, unfortunately, was not.',
  'They say the ocean keeps what it takes. It has excellent taste.',
  'Congratulations: you are now officially part of the seabed.',
  'Final position logged. Salvage rights: pending.',
  'That wasn’t a close shave — that was a full careening.',
  'Never bring a trawler to a gunfight. Or… whatever that was.',
  'Your boat has left the chat. It is going down with it.',
  'Rest in pieces. We’ll mark the spot on the chart. Roughly.',
  'Plot twist: the water was the real final boss. Also that captain.',
  'You aimed for the horizon and found the bottom. Committed, at least.',
  'The autopilot says “destination reached.” We disagree on the meaning.',
  'Armour holed, spirits lower, and now everything else too.',
  'Don’t take it personally — the sea is equally cold to everyone.',
  'Your last log entry: “Hold my grog.”',
  'You didn’t get lost at sea. The sea found you first.',
  'All hands, abandon — oh. Never mind.',
  'Somewhere a harbourmaster is quietly crossing you off a list.',
  'That’s one way to trim the bow down.',
  'You have joined the rest of the world underwater.',
  'Water always wins. It has been undefeated since the war.',
  'You went from captain to contender for reef status.',
  'Full fathom five… give or take a few metres of poor judgment.',
  'The bilge is no longer your problem. The whole ship is the bilge.',
  'You’ve made a permanent port call. At the bottom.',
  'Sonar contact: one new wreck. It’s you.',
  'Your freeboard is now a theoretical concept.',
  'The insurance form has a box for this. It’s not a fun box.',
  'You were the main character. The sea preferred an ensemble cast.',
  'Dead reckoning completed. Emphasis on dead.',
  'You’ve achieved maximum displacement. Downwards.',
  'The Coast Guard regrets to inform you. Or celebrates. Hard to say.',
  'Your wake has ended. So has everything else.',
  'Not going down with the ship. You *are* the ship. Was.',
  'You’ve set a new personal best for depth.',
  'The chart will get a little cross. Or an X. Same thing.',
  'You ran out of freeboard, hull, and second chances.',
  'Abandon ship was the plan. The ship abandoned you first.',
  'You’ve joined the convoy of the permanently docked.',
  'That was less “battle damage” and more “total conversion to scrap.”',
  'Your reputation survives. Your displacement does not.',
  'The fish are holding a memorial. Brief. Hungry.',
  'You’ve proven the ocean is not a metaphor. It’s a workplace hazard.',
  'Keel-hauled by reality.',
  'Your last heading was “down.” Bold choice.',
  'The salvage teams thank you for the donation.',
  'You left a beautiful oil slick. Artistic, if fatal.',
  'From bridge to brine in record time.',
  'The black box will make for uncomfortable listening.',
  'You’ve been promoted: permanent bottom-feeder.',
  'Not every captain gets a reef named after them. Unofficially.',
  'Your compass still works. It’s just underwater.',
  'The swell has accepted your resignation.',
  'You fought the sea. The sea filed a countersuit and won.',
  'Life jacket optional. Apparently so was surviving.',
  'You’ve completed the campaign: sink everything, including yourself.',
  'The horizon was optional. Gravity was not.',
  'Your log ends mid-sentence. So does your pulse.',
  'You’ve become a navigational hazard. Congrats.',
  'The drones floated. You didn’t. Priorities.',
  'Somewhere a shipyard just lost a customer. Permanently.',
  'You stacked the deck. Then the deck stacked you.',
  'Final berth assigned. No shipyard required.',
  'The radar is blank. So is your calendar. Forever.',
  'You’ve gone from “underway” to “under.” Efficient.',
  'The pirates will toast you. With your grog. From your wreck.',
  'You didn’t fail. You submerged. There’s a difference. Barely.',
  'Your last order was unclear. The sea’s was not.',
  'Anchors aweigh? More like anchors away, forever.',
  'You’ve made peace with the deep. It did not make peace with you.',
  'The tide took you out. It will not bring you back.',
  'You were warned about lee shores. You found a lee floor.',
  'May your salvage be meagre and your legend slightly exaggerated.'
]

export const ACIDIC_SEA_DEATH_PUNS = [
  'That water had a mean pH.',
  'You went from wading to fading.',
  'The sea was salty. The chemistry was worse.',
  'The coast was clear. The acidity was not.',
  'You found the ocean’s most corrosive current.',
  'The tide turned terminal.',
  'Your last shore leave was dissolved.',
  'The deep was shallow on mercy.',
  'You made a splash. The sea made a point.',
  'The water was fine. The pH was not.',
  'A bad day to be made of meat.',
  'You got a saltwater discharge.',
  'Your expedition reached a highly reactive conclusion.',
  'No amount of Barter Units could buy that pH.',
  'The sea took your hull’s protection personally.',
  'You were sunk by a solution.',
  'The ocean gave you a corrosive welcome.',
  'You have been returned to the water cycle — slightly pickled.',
  'The shoreline was only waist-deep. The consequences were not.',
  'You and the sea had an irreversible reaction.'
]

export function pickDeathPun(cause = null) {
  const pool = shouldShowDeathContact(cause) ? DEATH_PUNS : ACIDIC_SEA_DEATH_PUNS
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Faction ids are internal; these are what the player is told sank them.
 * `police` in particular has to read as the Coast Guard, not as police.
 */
const FACTION_LABEL = {
  police: 'Coast Guard',
  pirate: 'Corsair',
  trader: 'Merchant',
  alien: 'The Drowned'
}

export function formatFaction(faction) {
  if (!faction) return null
  const f = String(faction)
  return FACTION_LABEL[f] ?? f.charAt(0).toUpperCase() + f.slice(1)
}

export function formatDeathCause(cause) {
  if (!cause) return null
  if (cause === 'Killed by acidic seawater') return 'Acidic seawater exposure'
  return String(cause)
}

export function shouldShowDeathContact(cause) {
  return cause !== 'Killed by acidic seawater' && cause !== 'Acidic seawater exposure'
}

export function createDeathScreen(container, onReturnToMenu) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'death-screen'
  const smokeLayers = ['core', 'r1', 'r2', 'r3', 'r4']
    .map(
      (k) =>
        `<div class="death-smoke ${k}"><span class="smoke-text">YOU HAVE DIED</span></div>`
    )
    .join('')
  root.innerHTML = `
    ${SMOKE_FILTER_SVG}
    <div class="panel-top">
      <div class="death-title">
        <div class="death-smoke-field" aria-hidden="true">${smokeLayers}</div>
        <h1>YOU HAVE DIED</h1>
      </div>
      <div class="killer"></div>
      <div class="summary"></div>
    </div>
    <div class="panel-bottom">
      <div class="pun"></div>
      <button class="return">Return to Main Menu</button>
    </div>
  `
  container.appendChild(root)

  function hide() {
    root.style.display = 'none'
    root.style.pointerEvents = 'none'
    root.classList.remove('reveal', 'shake')
  }

  root.querySelector('.return').addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    hide()
    onReturnToMenu()
  })

  return {
    hide,
    show({
      characterName,
      credits,
      reputation,
      killerPilot = null,
      killerName = null,
      killerShip = null,
      killerFaction = null,
      killerMethod = null,
      cause = null
    }) {
      const pilot = killerPilot || killerName

      const killerEl = root.querySelector('.killer')
      if (!shouldShowDeathContact(cause)) {
        killerEl.classList.remove('unknown')
        killerEl.innerHTML = ''
        killerEl.style.display = 'none'
      } else if (pilot || killerShip) {
        const method =
          killerMethod === 'ram'
            ? 'Finished you with a ramming run'
            : 'Fired the killing blow'
        const faction = formatFaction(killerFaction)
        killerEl.classList.remove('unknown')
        killerEl.innerHTML = `
          <div class="k-line"><span class="k-name">${escapeHtml(pilot || 'Unknown captain')}</span></div>
          <div class="k-line">Vessel: <span class="k-ship">${escapeHtml(killerShip || 'Unknown vessel')}</span></div>
          <div class="k-line k-method">${escapeHtml(method)}</div>
          ${faction ? `<span class="k-faction">${escapeHtml(faction)}</span>` : ''}
        `
        killerEl.style.display = 'block'
      } else {
        killerEl.classList.add('unknown')
        killerEl.innerHTML = `
          <div class="k-line"><span class="k-name">Unknown contact</span></div>
          <div class="k-line">Vessel: <span class="k-ship">No positive ID</span></div>
        `
        killerEl.style.display = 'block'
      }

      const deathCause = formatDeathCause(cause)
      root.querySelector('.summary').innerHTML = `
        Final Barter Units: ${Math.floor(credits || 0)} BU<br/>
        Reputation earned: ${reputation ?? 0}<br/>
        ${deathCause ? `<span class="cause">Cause of death: ${escapeHtml(deathCause)}</span>` : ''}
      `

      root.querySelector('.pun').textContent = pickDeathPun(cause)

      root.style.display = 'flex'
      root.style.pointerEvents = 'none' /* only .return re-enables */
      // Above pointer-lock bridge (250000) so Return stays clickable if bridge races in.
      root.style.zIndex = '300000'
      document.body.style.cursor = ''
      root.classList.remove('reveal', 'shake')
      void root.offsetWidth
      root.classList.add('reveal', 'shake')
    }
  }
}
