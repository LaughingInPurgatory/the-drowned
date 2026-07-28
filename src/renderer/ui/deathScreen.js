import { escapeHtml } from './escapeHtml.js'
import { wreckedTypeCSS } from './wreckedType.js'

const TEXT_SHADOW =
  '0 1px 2px rgba(0,0,0,0.95), 0 2px 8px rgba(0,0,0,0.85), 0 0 16px rgba(0,0,0,0.55)'

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
}
#death-screen::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
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
  position: relative; z-index: 1; text-align: center; width: 100%;
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
}

#death-screen .death-title {
  position: relative; z-index: 2;
  width: 100%;
  margin: 0 0 1.1rem;
  padding: 0 8px;
  text-align: center;
  pointer-events: none;
  background: none !important;
  border: none !important;
  box-shadow: none !important;
}

/* Bottom block: pun + return button */
html #death-screen .panel-bottom,
#death-screen .panel-bottom {
  position: relative; z-index: 1; text-align: center; max-width: 520px; width: 100%;
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
#death-screen h1 {
  position: relative;
  margin: 0;
  padding: 0.08em 0.06em;
  font-size: clamp(36px, 7.5vw, 64px);
  letter-spacing: 0.14em;
  line-height: 1.05;
  text-transform: uppercase;
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
  /* Rim + ember halo (same family as #main-menu .title-art drop-shadows) */
  filter:
    drop-shadow(0 2px 3px rgba(0, 0, 0, 0.95))
    drop-shadow(0 0 10px rgba(0, 0, 0, 0.75))
    drop-shadow(0 0 22px rgba(255, 70, 40, 0.35))
    drop-shadow(0 0 48px rgba(255, 70, 40, 0.14));
}
${wreckedTypeCSS('#death-screen h1', { heavy: true })}
/* wreckedType overwrites font; keep metal fill on the clipped text */
#death-screen h1 {
  font-family: "Impact", "Haettenschweiler", "Arial Narrow Bold", "Helvetica Neue", sans-serif;
  font-weight: 900;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  /* re-apply after wreckedType so glow isn't lost */
  filter:
    drop-shadow(0 2px 3px rgba(0, 0, 0, 0.95))
    drop-shadow(0 0 10px rgba(0, 0, 0, 0.75))
    drop-shadow(0 0 22px rgba(255, 70, 40, 0.35))
    drop-shadow(0 0 48px rgba(255, 70, 40, 0.14));
}
/* Pulse the wrapper so it doesn't fight the erosion crawl on the h1 */
#death-screen .death-title {
  animation: deathTitleGlow 5s ease-in-out infinite;
}
@keyframes deathTitleGlow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.12); }
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
  'Water always wins. It has been undefeated since the war.'
]

function pickPun() {
  return DEATH_PUNS[Math.floor(Math.random() * DEATH_PUNS.length)]
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

export function createDeathScreen(container, onReturnToMenu) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'death-screen'
  root.innerHTML = `
    <div class="panel-top">
      <div class="death-title">
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
      killerMethod = null
    }) {
      const name = escapeHtml(characterName || 'Captain')
      const pilot = killerPilot || killerName

      const killerEl = root.querySelector('.killer')
      if (pilot || killerShip) {
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

      root.querySelector('.summary').innerHTML = `
        Final credits: ${Math.floor(credits || 0)}cr<br/>
        Reputation earned: ${reputation ?? 0}<br/>
        ${name} is gone. Load your last save.
      `

      root.querySelector('.pun').textContent = pickPun()

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
