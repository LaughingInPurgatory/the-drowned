import { getShipClass } from '../data/shipClasses.js'

// Flavour comms line for F5 "hail target" — no game-state effect, purely
// atmosphere. Picked deterministically from the NPC id + a line index so the
// same ship gives the same greeting within a session (re-hailing isn't a slot
// machine) while different ships/hails still vary.
function hashString(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function pick(arr, seed) {
  return arr[seed % arr.length]
}

const PIRATE_LINES = [
  'Cargo or plasma, drifter — your call.',
  "You're a long way from anywhere that can help you.",
  'Cut your engines and this stays civil.',
  "Nice hull. I'll be taking it apart shortly.",
  "Wrong lane, friend. This one's mine.",
  'Say goodbye to your cargo. Might let you keep the ship.',
  "I've got guns hot and nothing better to do today.",
  "Every lane out here's a toll road. Pay up or burn.",
  'You blinked first hailing me. Bad move.',
  "Load's light or heavy, doesn't matter — I'm taking a look either way.",
  "Cute ship. Won't stay that way long.",
  "Last chance to dump cargo and coast on out of here."
]

const POLICE_LINES = [
  'This is a routine hail. State your business in this system.',
  'Your transponder checks out. Fly safe out there.',
  'Keep your weapons stowed and we won’t have a problem.',
  'Patrol acknowledged. Nothing unusual to report on our end.',
  'If you’re seeing trouble, squawk it and we’ll respond.',
  'Scans clean. Carry on, pilot.',
  'We’ve had reports of pirate activity nearby — stay sharp.',
  'This sector’s well patrolled. Behave accordingly.',
  'Traffic’s light today. Makes our job easy.',
  'Copy your transponder. You’re clear to proceed.',
  'Standard hail acknowledged. No action required on our end.'
]

const ALIEN_LINES = [
  '[UNTRANSLATABLE HARMONIC RESPONSE]',
  '— signal resolves to overlapping tones, no words —',
  '[the channel carries only a low resonant hum]',
  '— your hail is answered with silence and a slow bearing change —',
  '[a burst of structured static, gone before it can be parsed]',
  '[a pattern of tones that almost forms a word, then doesn’t]',
  '— the response arrives already fading, as if sent long ago —',
  '[your own hail is echoed back, subtly altered]',
  '— something on the other end seems to be listening, not answering —',
  '[a single sustained frequency, then the channel goes dead]'
]

const TRADER_LINES = [
  "Full manifest, tight margins — you understand how it is.",
  'If you’re after a deal, dock up and we’ll talk business.',
  'Quiet run so far. Hoping it stays that way.',
  'Prices out here are murder. Present company excepted.',
  "Convoy's a day out. Until then, it's just me and the hold.",
  "Hold's half empty — heading back for more before prices shift.",
  'You buying or just passing through?',
  "Route's been quiet. I'll take quiet over quick any day.",
  'Watch yourself out here — insurance doesn’t cover everything.',
  "If the pirates don't get my margins, the fuel costs will.",
  'Good hail. Wish more pilots bothered.'
]

const EXPLORER_LINES = [
  'Charting this sector — nothing hostile on my scopes, for what it’s worth.',
  'Out here for the survey data, not the company.',
  'You’re the first hail I’ve had in a while. Everything reads fine on my end.',
  "Long way from the core. Signal's a bit thin, but I read you.",
  'Found something interesting a few jumps back. Still processing the data.',
  'Deep space plays tricks on the sensors out here — nothing to worry about, probably.',
  'Not much company this far out. Appreciate the hail.',
  'Survey’s going well. This system’s got some surprises in it.',
  'Fuel’s tight but the data’s worth it.'
]

const FIGHTER_LINES = [
  'Contract work. Nothing personal if our paths cross again.',
  'Running escort this trip — keep clear and we’re both fine.',
  'Hull’s patched and weapons are hot. Just so you know where I stand.',
  'Quiet skies today. Let’s keep it that way.',
  'Wingman’s a few klicks out, if you’re wondering.',
  'Not looking for trouble today. Doesn’t mean I can’t handle it.',
  'Contract’s simple: fly escort, collect pay, repeat.',
  'Systems green, weapons cold. Let’s keep it that way.',
  'Seen worse skies than this. Nothing to report.'
]

const DEFAULT_LINES = [
  'Signal received. Nothing further to report.',
  'Reading you five by five. Safe travels.',
  'Copy that. Holding current course.',
  'All systems nominal on this end.',
  'Nothing to report. Fly safe.',
  'Acknowledged. Proceeding as planned.'
]

function linesFor(npc, shipClass) {
  if (npc.isAlien || npc.faction === 'alien') return ALIEN_LINES
  if (npc.faction === 'pirate') return PIRATE_LINES
  if (npc.faction === 'police') return POLICE_LINES
  if (npc.faction === 'trader') return TRADER_LINES
  switch (shipClass?.role) {
    case 'explorer':
      return EXPLORER_LINES
    case 'fighter':
      return FIGHTER_LINES
    default:
      return DEFAULT_LINES
  }
}

/**
 * Build a one-line hail response for an NPC target. Pure function of the NPC's
 * own data (id/faction/pilotName/shipClassId) — no RNG state, no game-state
 * mutation, so it is safe to call from a UI handler with no side effects.
 * @param {object} npc
 * @returns {{ speaker: string, line: string }}
 */
export function buildHailResponse(npc) {
  const seed = hashString(String(npc.id ?? npc.pilotName ?? 'unknown'))
  let shipClass = null
  try {
    shipClass = getShipClass(npc.shipClassId)
  } catch {
    shipClass = null
  }
  const lines = linesFor(npc, shipClass)
  const line = pick(lines, seed)
  const speaker = npc.pilotName || (npc.isAlien ? 'Unknown Vessel' : 'Unidentified Pilot')
  return { speaker, line }
}
