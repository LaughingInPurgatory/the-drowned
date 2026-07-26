import { escapeHtml } from './escapeHtml.js'

const STYLE = `
#death-screen {
  position: fixed; inset: 0; background: #060102; font-family: monospace; color: #f0d0d0;
  display: none; align-items: center; justify-content: center; overflow: hidden;
}
#death-screen::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 35%, rgba(120,10,10,0.55) 100%);
  animation: vignettePulse 2.2s ease-in-out infinite;
}
@keyframes vignettePulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }

#death-screen .panel { position: relative; z-index: 1; text-align: center; max-width: 520px; padding: 0 20px; }

#death-screen h1 {
  position: relative; color: #ff5050; font-size: 40px; letter-spacing: 6px; margin: 0 0 24px 0;
  animation: glitchShadow 2.4s infinite steps(1);
}
#death-screen.shake .panel { animation: shake 0.5s ease-in-out; }
@keyframes shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-6px, 2px); }
  40% { transform: translate(5px, -3px); }
  60% { transform: translate(-4px, 3px); }
  80% { transform: translate(3px, -2px); }
}
@keyframes glitchShadow {
  0%, 18% { text-shadow: 2px 0 var(--ui-accent), -2px 0 #ff4d4d; }
  20% { text-shadow: -4px 1px var(--ui-accent), 4px -1px #ff4d4d; }
  22%, 48% { text-shadow: 2px 0 var(--ui-accent), -2px 0 #ff4d4d; }
  50% { text-shadow: 4px -2px var(--ui-accent), -4px 2px #ff4d4d; }
  52%, 100% { text-shadow: 2px 0 var(--ui-accent), -2px 0 #ff4d4d; }
}

#death-screen .killer {
  display: inline-block;
  margin: 0 auto 20px;
  padding: 10px 18px 11px;
  width: fit-content;
  max-width: min(420px, 100%);
  box-sizing: border-box;
  background: rgba(40, 8, 8, 0.65);
  border: 1px solid rgba(217, 79, 79, 0.45);
  border-left: 3px solid #e05a5a;
  text-align: center;
  line-height: 1.4;
  opacity: 0;
  font-size: 13px;
}
#death-screen.reveal .killer { animation: fadeUp 0.6s ease-out 0.25s forwards; }

#death-screen .summary { margin-bottom: 18px; line-height: 1.7; opacity: 0; }
#death-screen.reveal .summary { animation: fadeUp 0.6s ease-out 0.4s forwards; }
#death-screen .killer .k-tag {
  display: block; font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
  color: #ff8a7a; opacity: 0.85; margin-bottom: 4px;
}
#death-screen .killer .k-line { color: #f0d0d0; }
#death-screen .killer .k-name { color: #ffe0e0; font-size: 15px; letter-spacing: 0.5px; }
#death-screen .killer .k-ship { color: var(--ui-accent); }
#death-screen .killer .k-method { margin-top: 4px; opacity: 0.85; font-size: 12px; }
#death-screen .killer .k-faction {
  display: block; margin-top: 3px; font-size: 11px; letter-spacing: 1px;
  text-transform: uppercase; color: #c09090; opacity: 0.8;
}
#death-screen .killer.unknown { opacity: 0.85; border-left-color: #8a5050; }

#death-screen .pun {
  margin: 0 0 16px; font-size: 13px; letter-spacing: 0.4px; line-height: 1.45;
  color: #c8a0a0; font-style: italic; opacity: 0; max-width: 420px; margin-left: auto; margin-right: auto;
}
#death-screen.reveal .pun { animation: fadeUp 0.6s ease-out 0.5s forwards; }

#death-screen button {
  background: #2a1414; border: 1px solid #6a2a2a; color: #f0d0d0; padding: 10px 20px; cursor: pointer;
  font-family: monospace; letter-spacing: 1px; opacity: 0;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
#death-screen.reveal button { animation: fadeUp 0.6s ease-out 0.65s forwards; }
#death-screen button:hover { background: #3a1a1a; border-color: #d94f4f; box-shadow: 0 2px 6px rgba(0,0,0,0.65); }
@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
`

/** Light grief + vacuum-grade dad jokes. */
const SPACE_PUNS = [
  'Looks like your career just hit peak orbit… and re-entered.',
  'You weren’t just outgunned — you were out of this world (in the bad way).',
  'That went supernova faster than your thrusters.',
  'Hull integrity? More like hull “integri-whoops.”',
  'You played among the stars. The stars played harder.',
  'Space is big. Your hitbox, unfortunately, was not.',
  'They say in space no one can hear you scream. Your black box can.',
  'Congratulations: you’ve achieved escape velocity from the living.',
  'Your final status: permanently offline, still overdrawn on luck.',
  'That wasn’t a close shave — it was a full orbital haircut.',
  'Remember: never bring a cargo barge to a plasma fight. Or… whatever you just did.',
  'Your ship has left the chat. Permanently.',
  'Rest in pieces. We’ll scatter the wreck along a nice elliptical orbit.',
  'Plot twist: the void was the real final boss. Also that pilot.',
  'You aimed for the stars and scored a crater. Respect the commitment.',
  'Nav computer says “destination reached.” We disagree on the meaning.',
  'Shields down, spirits lower. At least the view was cosmic.',
  'Don’t take it personally — the vacuum is equally cold to everyone.',
  'Your last log entry: “Hold my thruster fuel.”',
  'In the end, you weren’t lost in space. Space found you first.'
]

function pickPun() {
  return SPACE_PUNS[Math.floor(Math.random() * SPACE_PUNS.length)]
}

function formatFaction(faction) {
  if (!faction) return null
  const f = String(faction)
  return f.charAt(0).toUpperCase() + f.slice(1)
}

export function createDeathScreen(container, onReturnToMenu) {
  const style = document.createElement('style')
  style.textContent = STYLE
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = 'death-screen'
  root.innerHTML = `
    <div class="panel">
      <h1>YOU HAVE DIED</h1>
      <div class="killer"></div>
      <div class="summary"></div>
      <div class="pun"></div>
      <button class="return">Return to Main Menu</button>
    </div>
  `
  container.appendChild(root)

  root.querySelector('.return').addEventListener('click', () => {
    root.style.display = 'none'
    root.classList.remove('reveal', 'shake')
    onReturnToMenu()
  })

  return {
    show({
      characterName,
      credits,
      reputation,
      killerPilot = null,
      killerShip = null,
      killerFaction = null,
      killerMethod = null
    }) {
      const name = escapeHtml(characterName || 'Pilot')

      const killerEl = root.querySelector('.killer')
      if (killerPilot || killerShip) {
        const method =
          killerMethod === 'ram'
            ? 'Finished you with a ramming run'
            : 'Fired the killing blow'
        const faction = formatFaction(killerFaction)
        killerEl.classList.remove('unknown')
        killerEl.innerHTML = `
          <span class="k-tag">Killed by</span>
          <div class="k-line"><span class="k-name">${escapeHtml(killerPilot || 'Unknown pilot')}</span></div>
          <div class="k-line">Ship: <span class="k-ship">${escapeHtml(killerShip || 'Unknown vessel')}</span></div>
          <div class="k-line k-method">${escapeHtml(method)}</div>
          ${faction ? `<span class="k-faction">${escapeHtml(faction)}</span>` : ''}
        `
        killerEl.style.display = 'inline-block'
      } else {
        killerEl.classList.add('unknown')
        killerEl.innerHTML = `
          <span class="k-tag">Killed by</span>
          <div class="k-line"><span class="k-name">Unknown contact</span></div>
          <div class="k-line">Ship: <span class="k-ship">No positive ID</span></div>
        `
        killerEl.style.display = 'inline-block'
      }

      root.querySelector('.summary').innerHTML = `
        Final credits: ${Math.floor(credits || 0)}cr<br/>
        Reputation earned: ${reputation ?? 0}<br/>
        ${name} is gone. Load your last save — or jump to a clone if you left one at a Clone Bay.
      `

      root.querySelector('.pun').textContent = pickPun()

      root.style.display = 'flex'
      root.classList.remove('reveal', 'shake')
      void root.offsetWidth
      root.classList.add('reveal', 'shake')
    }
  }
}
