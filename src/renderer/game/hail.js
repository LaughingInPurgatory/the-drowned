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

// The Drowned — pre-war hulls still answering. Clipped military radio, wet
// static, orders from a navy that never stood down.
const DROWNED_LINES = [
  'This channel is reserved. Clear the water.',
  'Negative contact. You are not on our board.',
  'Hold your course and keep weapons cold. We will not warn twice.',
  'You hail like a civilian. That is not a compliment out here.',
  'Old war, old hull, same rules: do not approach.',
  'We do not take contracts. We take what we need.',
  'Your transponder reads soft. Ours does not.',
  'Shore stations forgot us. The sea did not.',
  'If you are lost, stay lost somewhere else.',
  'We ran these lanes before the flood. We still do.',
  'Copy your hail. Reply is: keep clear of the formation.',
  'Salvage rights claimed. Move off or join the wrecks.',
  'Comms are short-range and unfriendly. Make it count next time.',
  'You sound dry. That will not last.'
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

const PIRATE_COLLISION_LINES = [
  'That was a hull of a greeting.',
  'Watch it, or I’ll make you walk the plankton.',
  'You’ve got some nerve ramming a pirate — and some barnacles.',
  'That bump cost you a piece of eight knots.',
  'Easy there, matey — this lane is under my buoy-risdiction.',
  'One more hit and I’ll keel-haul your insurance premiums.',
  'That was no small wake-up call.',
  'You ram like a landlubber with a grudge.',
  'Mind the paint — it’s the only honest thing on this ship.',
  'I’ve seen gentler waves in a bathtub.',
  'Was that a broadside or just broad driving?',
  'Keep bumping me and I’ll call it piracy of personal space.',
  'You nearly turned my ship into a stern lesson.',
  'That scrape was a little too close for corsair comfort.',
  'Steady on — you’re making my crew seasick by proxy.',
  'You hit like a cannonball with stage fright.',
  'That’s one way to make a splash in pirate territory.',
  'Your steering has gone overboard, hasn’t it?',
  'Next time send a warning shot, not a warning yacht.',
  'Careful, captain — I charge extra for unsolicited boarding.'
]

const POLICE_COLLISION_LINES = [
  'Collision noted. That was a buoy-law violation.',
  'Ease off, captain. You’re in a no-ram zone.',
  'That manoeuvre was a little too close for harbour work.',
  'Mind your wake — we enforce personal buoy-ndaries.',
  'You’ve been cited for reckless hull-gating.',
  'Please keep your vessel in its proper lane of longitude.',
  'That impact was out of line. Literally.',
  'Careful: repeated bumping may lead to a stern warning.',
  'This patrol prefers a civil port-to-port conversation.',
  'Your navigation needs a course correction, captain.',
  'That was an unauthorised exchange of hull information.',
  'No harm done, but your seamanship is under review.',
  'You cannot just dock and roll, captain.',
  'Maintain separation. We do not run a bumper-boat service.',
  'Another scrape and I’ll book you for assault and battery-powered travel.',
  'That was a clear breach of the right of wave.',
  'Watch the rudder. It’s not a warrant for contact.',
  'You’re making this patrol feel a little boarded.',
  'That was a poor showing of due course.',
  'Consider this your first and buoy-official warning.'
]

const TRADER_COLLISION_LINES = [
  'Careful! My margins are already thin enough to scrape.',
  'That bump just added hull repair to the manifest.',
  'Easy there — this cargo is not packed for impact.',
  'You dent it, you buy it. That’s maritime retail.',
  'That was a costly way to say hello.',
  'Mind the hull — it’s carrying my entire quarterly forecast.',
  'You’ve knocked my profit right into the drink.',
  'Please don’t make my cargo hold a crash market.',
  'Steady, captain — I’m transporting goods, not bump stocks.',
  'That scrape was outside my operating budget.',
  'You’re putting the dent in independent commerce.',
  'My insurer will have a field day. A flooded field day.',
  'That was a hostile takeover of my personal space.',
  'I sell freight, not fender-benders.',
  'Please steer clear; my ledger cannot absorb another hit.',
  'That impact was not in the terms of trade.',
  'You’re making waves in all the wrong markets.',
  'Take it easy — my cargo has enough baggage already.',
  'That was a bad deal for both our hulls.',
  'You nearly turned this run into a loss at sea.'
]

const DROWNED_COLLISION_LINES = [
  'Collision logged. You have breached the old line.',
  'Maintain distance. Our hull remembers the depth charges.',
  'Your contact is noted. Your course is not forgiven.',
  'Stand off. This formation does not make room for amateurs.',
  'That was an unscheduled joining of the fleet.',
  'You struck a warship. Consider that a sinking feeling.',
  'Clear the water. We are not taking on new wrecks.',
  'Your hull touched ours. It will remember.',
  'Maintain station, civilian. Preferably not inside ours.',
  'That impact was not in the old navy’s standing orders.',
  'You drift like a mine with poor discipline.',
  'Contact report: one careless captain, still afloat.',
  'Cease bumping. The flood already took enough.',
  'You are too close to becoming part of the wreckage.',
  'Your seamanship has gone under.',
  'Do not test our hull. It has survived worse centuries.',
  'That was a grave manoeuvre. Stay clear of the graveyard.',
  'Formation integrity compromised by civilian enthusiasm.',
  'Keep clear, or we will make this a deep-water lesson.',
  'You have crossed our wake. Do not cross it again.'
]

function collisionLinesFor(npc) {
  if (npc.isAlien || npc.faction === 'alien') return DROWNED_COLLISION_LINES
  if (npc.faction === 'pirate') return PIRATE_COLLISION_LINES
  if (npc.faction === 'police') return POLICE_COLLISION_LINES
  return TRADER_COLLISION_LINES
}

function linesFor(npc, shipClass) {
  if (npc.isAlien || npc.faction === 'alien') return DROWNED_LINES
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
  const speaker =
    npc.pilotName ||
    (npc.isAlien || npc.faction === 'alien' ? 'Drowned Contact' : 'Unidentified Pilot')
  return { speaker, line }
}

/** One-off, random flavour comms for a player–NPC hull collision. */
export function buildCollisionResponse(npc, random = Math.random) {
  const lines = collisionLinesFor(npc)
  const line = lines[Math.floor(random() * lines.length)]
  const speaker =
    npc.pilotName ||
    (npc.isAlien || npc.faction === 'alien' ? 'Drowned Contact' : 'Unidentified Pilot')
  return { speaker, line }
}
