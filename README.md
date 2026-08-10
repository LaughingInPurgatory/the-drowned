# The Drowned

<table align="center">
  <tr>
    <td align="center" valign="middle">
      <img src="logo.jpg" alt="The Drowned" width="560" />
    </td>
    <td align="center" valign="middle" width="220">
      <a href="https://ko-fi.com/laughinginpurgatory">
        <img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" alt="Support me on Ko-fi" height="36" />
      </a>
      <br/><br/>
      Please support me on KOFI, every bit helps!
    </td>
  </tr>
</table>

<p align="center">
  <strong>A procedural open-world sea of trade, salvage and combat</strong><br/>
  Electron + Three.js · one seamless ocean · boat handling · island exploration · persistent saves
</p>

<p align="center">
  <a href="https://github.com/LaughingInPurgatory/the-drowned/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/LaughingInPurgatory/the-drowned?style=flat-square" /></a>
</p>

---

## The world

The flood did not arrive as one clean ending. It came in broken coastlines, drowned roads, dead radio towers and ships that never found a port again. Decades later, the old continents are gone beneath one enormous sea. People live on the islands that remain, trade between half-working harbours, and go out every day to pull something useful from the wreckage.

You begin at **Port Haven**, the last dependable harbour in **Haven Reach**, with a patched-up light runner, a clean record and a sea full of reasons to leave. There is work close to home: haul cargo, chart a coast, recover salvage, follow a signal. There are better Barter Unit (**BU**) payouts farther out, where the patrol lights thin, the weather turns, and the deep still holds things that were never meant to be found.

Somewhere beyond the safe water, the old military order called **the Drowned** is still moving. Their hulls and weapons are not sold across a counter. They are recovered from Drowned wrecks and sealed sites, studied, and assembled piece by piece in harbour Industry. Every captain eventually decides whether the deep is worth the answer it might contain.

## What kind of game is it?

The Drowned is a small-boat open-world game about making a living on a flooded Earth. Sail by hand, line up the guns, take contracts, trade between harbours, strip wrecks, build a better vessel, and decide how much trouble you are willing to bring home.

- **A whole sea, not a chain of levels.** The canonical world is one seamless **80 km-wide** ocean. It has roughly **140 islands**, **50 harbours**, **60 outposts** and **80 wreck fields**, all in one coordinate space with no loading seam. The same seeded world is generated for every New Game.
- **Boats that feel like boats.** W/S controls throttle, A/D puts the helm over, and Q/E use the bow and stern thrusters to crab sideways onto a berth. The hull carries way when you come off the throttle, heels into a turn and follows the living wave field beneath it.
- **A sea with a clock.** A full day lasts **25 minutes**. Sunlight, cloud, rain, thunder, fog, running lights and harbour lamps all move with the campaign clock. Wreck fields recover and Industry jobs keep running while you are away.
- **Distance is the difficulty curve.** Haven Reach is watched. Farther out, security falls away, hostile ships become more dangerous and the salvage gets better. Open water between patrol zones belongs to whoever is strong enough to claim it.
- **A working captain’s economy.** Buy and sell goods, survey data, mined material and ship parts through harbour Services. Storage is local, so cargo left behind stays where you put it. Outposts are leaner; harbours offer the full Trade, Shipyard, Armoury and Industry spread.
- **100+ vessel classes.** Buy, salvage or assemble hulls ranging from fast runners and workboats to heavy freighters, gunboats, explorers and salvage craft. Fit weapons, accessories and drone bays to make a ship that suits the way you actually play.
- **Combat drones.** Ships with drone bays can carry small airborne combat drones. Buy them in the Armoury, install them in the loadout, then launch with **G** and recall with **H**. They are support craft that fight alongside your boat; they are not extra player-controlled ships.
- **Step ashore.** Bring the ship right up to an island shoreline and press **F** when the prompt appears. On land, use **W/A/S/D** to move, mouse look to turn, **Shift** to run, **Space** to jump and **F** near the boat to board again. The ship stays alongside as a protected placeholder while you explore.
- **Explore a living island.** Rabbits, deer, cats and dogs wander across streamed islands. Wildlife can be killed, leaves a short-lived corpse, and is replaced later; wild dogs alone attack when approached. Terrain limits steep climbs, falling can hurt, and landing sounds vary with the ground.
- **A first-person sidearm.** On foot, the default **Fixo Pistol** is rendered with a first-person viewmodel, muzzle flash, flashlight support, physical projectiles and impact effects. It is not sold in the shipyard.
- **Target contacts on foot.** **Tab** uses the same range and cycling rules at sea and ashore, following the camera crosshair. Ships, wrecks, rocks and facilities can be targeted; the island itself is not a target.
- **Local island mapping.** Press **M** ashore for a detailed north-up map of the current island, including its shoreline, player position and attached facilities. Aboard, **M** remains the full sea chart.
- **The law remembers.** Local security runs from **0–6** and changes with your position. Your **Notoriety** rises when you attack non-aggressors in watched water. Lose enough standing and police respond faster, high-security harbours refuse a berth, and eventually every patrol sees you as a target.
- **Salvage with consequences.** Wreck fields hold finite material and recover on the campaign clock. In low-security water, successful salvage hits can attract a pirate ambush. The farther out you go, the more valuable the wrecks become—and the more likely someone else is already watching them.
- **Signals in the empty water.** Use the boat’s sonar pulse to survey nearby islands and wreck fields. Use **Region Sonar** to deploy scan probes and hunt Anomalous Signals: Drowned incursions, datacores, sealed sites and rare salvage caches.
- **Contracts that pull you outward.** Take bounty, charting, survey, signal and haulage work from harbour boards. Objectives complete in the field, so a good contract can turn into the beginning of a longer voyage.
- **A living weather deck.** Procedural islands, cloud cover, rain, storms, sea state, wakes and night lighting make the same route feel different on the second crossing. At night, a searchlight and a few distant lamps may be all you have.
- **A populated sea.** Four hundred civilian ships are distributed across the world and travel between ports, outposts and harbours. Distant traffic uses a lightweight route simulation while nearby and engaged ships retain full AI behaviour.
- **Smooth first contact.** Model, texture and shader pipelines are warmed behind an animated loading screen before a session begins. The renderer also precompiles multiple camera headings to reduce the hitch when first looking around.

Harbours are generated from the same world seed as the islands around them: quays, jetties, warehouses, tanks, cranes, towers, moles and working lights. Come alongside to tie up and open the dockside Services UI; the water remains the centre of the game.

## Your first voyage

1. Start a New Game at Port Haven and choose **Undock**.
2. Press **Space** to take the helm. Use **W/S** for throttle, **A/D** to steer and **Q/E** to move sideways.
3. Use **Tab** to lock a contact under the crosshair. Press **P** to survey a nearby island or wreck field, and **F** to use a locked contact when the HUD says it is in range.
4. Bring the ship alongside an island until **Press F to disembark** appears. Explore with **W/A/S/D**, use **Tab** to target nearby contacts, and press **M** for the local island map.
5. Return to the boat and press **F** to board, then come alongside a harbour and press **S** to open Services. Transfer cargo through **Inventory (I)** before buying or selling; harbour storage is local.
6. Open **M** aboard for the sea chart, **B** for Region Sonar and **J** for your missions. The yellow waypoint is guidance, not autopilot.

## Controls

You take the helm with **Space**. While the helm is active, the pointer is locked for turret aiming. On foot, the pointer is locked for mouse look instead. Open a panel or press Space again to free the pointer. After alt-tab, click the game canvas or press Space to take control back. **Settings → Controls** in the main menu and pause menu uses the same bindings.

| Input | Action |
| --- | --- |
| **Space** | Take / leave the helm; jump on land |
| **Mouse movement** | Aim the turret at sea; look around on foot |
| **Mouse wheel** | Chase-camera zoom at sea |
| **Mouse wheel over Overview** | Scroll the body list |
| **Alt + Enter** | Toggle fullscreen |
| **Left click** | Fire ship gun mounts, or the Fixo Pistol on foot; can be held with RMB at sea |
| **Right click** | Fire ship launchers; unavailable on foot |
| **W / S** | Ahead / astern at sea; move forward / back on foot |
| **Shift (on foot)** | Hold while moving to run; uses stamina |
| **L (on foot)** | Toggle handheld flashlight |
| **S (alongside)** | Open / close dockside Services |
| **A / D** | Helm to port / starboard at sea; strafe left / right on foot |
| **Q / E** | Bow and stern thrusters — crab sideways to port / starboard |
| **Tab** | Lock the contact under the crosshair, or cycle nearby contacts — at sea and on foot |
| **Shift + Tab** | Clear target lock |
| **Ctrl/Cmd + Tab** | Clear target lock |
| **Backspace** | Clear target lock and waypoint |
| **C** | Cruise Control — holds heading and speed; A/D steer; W/S/Q/E cancel |
| **M** | Open the sea chart aboard, or the current island map on foot |
| **B** | Open Region Sonar; deploy scan probes and investigate signals |
| **F** | Use the locked contact — salvage, dock or hack when in range; disembark / board when prompted |
| **P** | Sonar pulse — survey a nearby island or wreck field |
| **G** | Launch installed combat drones; requires drone bays and drones aboard |
| **H** | Recall combat drones |
| **L** | Bow searchlight on / off at sea |
| **I** | Inventory |
| **J** | Missions journal |
| **F1** | Character sheet |
| **Esc** | Pause / resume; back out of open panels |
| **F5** | Hail the locked target |
| **Free mouse** | Click Overview, the sea chart or Region Sonar to set waypoints; scroll Overview with the wheel |

There is no roll, pitch or vertical thrust input for the boat. You are driving a surface vessel: throttle, helm, thrusters, guns and the water under the hull. On foot, the camera is first-person and the avatar cannot enter the acidic sea beyond shallow wading depth.

## Settings and saves

The main menu and pause menu both include **Settings** with separate **Sound & Volume**, **UI Colour** and **Controls** panels. Sound & Volume has independent Sound Effects, Music and Sea Sound sliders; each updates live, and moving a volume to 0 mutes that channel. Preferences are saved for the next launch.

Saves are manual and persistent. They remember your ship, local harbour storage, market stock, crafting jobs, depleted wreck material, campaign time, waypoints, notoriety and on-foot state. Saving while ashore restores both the player’s island position and the ship’s parked position. NPCs, projectiles and temporary combat wrecks are not saved. The ocean world is a new-game world, so old space-era saves are not compatible.

## Development

The game is an Electron desktop app with a plain DOM UI and a Three.js renderer. The renderer is split into procedural world generation, pure game logic, Three.js scene builders and small UI modules. The sea’s wave field is shared by simulation and rendering so boats sit on the water they appear to be floating on.

### Run locally

```sh
npm install
npm run dev
```

This starts Electron with hot module reloading. Editing `src/renderer/main.js` during `npm run dev` resets the current session to the main menu; that is expected. GitHub Actions uses Node.js 24 for builds and releases.

### Build and package

```sh
npm run build      # electron-vite build
npm run package    # build + unpacked electron-builder app
npm run make       # macOS arm64 DMG, unsigned
npm run make:linux # Linux AppImage, x64 + arm64
npm run make:win   # Windows NSIS installer, x64 + arm64
```

Build output goes to `release/`. The app is unsigned, so macOS may require right-clicking the app and choosing **Open** the first time.

### Tests

Tests use Node’s built-in runner and live beside the modules they cover:

```sh
node --test src/renderer/game/*.test.js src/renderer/procgen/*.test.js src/renderer/data/*.test.js src/renderer/world/*.test.js
```

There is no `npm test` script. Releases are built by `.github/workflows/release.yml` and publish macOS arm64, Linux x64/arm64 and Windows x64/arm64 artifacts.

## Attributions

- [Electron](https://www.electronjs.org/) and [electron-vite](https://electron-vite.org/)
- [Three.js](https://threejs.org/)
- [Kenney Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) (CC0)
- [ambientCG](https://ambientcg.com/) PBR textures (CC0)
- [Kenney](https://kenney.nl/) and [Quaternius](https://quaternius.com/) environment assets (CC0)

## License

© Laughing In Purgatory 2026
