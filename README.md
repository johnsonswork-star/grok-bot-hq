# Bot Office HQ (v1.2)

**Live, always-on URL: https://johnsonswork-star.github.io/grok-bot-hq/**
(hosted on GitHub Pages; works on iPad over Wi-Fi or cellular, no PC and no server on our side needed)

A 3D office you walk through with a game controller. It's the home base and visual system for the Grok Bot team. Each bot has its own desk, a monitor, and a floating nameplate.

Zero build: plain ES modules plus a local copy of three.js (`vendor/three.module.js`, r169). No CDN, no API keys, no login.

## Start

```bash
cd /workspace/bot-office && npm start
# open http://localhost:8080
```

If you don't want to use Node: `python3 -m http.server 8080` from this folder also works.
To use a different port: `PORT=9000 npm start`.

Use Chrome or Edge for the best gamepad support. Plug in or pair the controller, then **press any button** so the browser detects it. The bottom-right badge turns green.

## iPad setup (no PC needed)

1. **Pair the controller:** iPad Settings > Bluetooth. Put the pad in pairing mode (Xbox: hold the small pair button on top until the X flashes fast. PS5 DualSense: hold Create + PS until the light bar blinks. PS4: Share + PS). Tap it under Other Devices.
2. **Open the office:** Safari > https://johnsonswork-star.github.io/grok-bot-hq/
3. **Add to Home Screen:** Share button > Add to Home Screen > Add. Launch it from the "Bot HQ" icon so it opens full screen, with no Safari bars. Turn the iPad sideways (landscape).
4. **Press any button on the controller.** Safari only reveals a controller after a button press. The orange "Press any button on your controller" banner disappears and the bottom-right badge turns green. Then press **A** (Cross) to enter.

On iPad, mouse look and pointer lock are turned off. **Look uses the right stick only.**

**No controller? Touch works too.** Drag on the left half of the screen to move (a virtual stick appears under your thumb). Drag on the right half to look around. On-screen buttons: **Interact** (open or close a desk panel), **Next desk**, and **❚❚** (pause). The touch buttons hide automatically when a controller connects.

iPad tuning: the pixel ratio is capped at 1.25, the shadow map is lighter (1024, PCF), pinch zoom and scroll bounce are blocked, and the iPad notch and home-bar safe areas are respected. A small service worker keeps the last version cached, so the office still opens if the signal drops. It always loads the newest version when online.

## Hosting and updates

- The live site is the GitHub repo **johnsonswork-star/grok-bot-hq** (public), served by GitHub Pages from the `main` branch root.
- To publish a change: edit the files here, then run `./deploy.sh` (it commits and pushes to `main`). Pages rebuilds in about 1 minute, with the same URL. The iPad picks it up on the next launch. If it looks stale, close and reopen the app.
- Local testing still works: `npm start`, then http://localhost:8080.

## Controls

| Action | Gamepad (Xbox / PlayStation) | Keyboard + mouse |
|---|---|---|
| Move | Left stick | W A S D |
| Jog | Click left stick (L3) or hold RT / R2 | Shift |
| Look | Right stick (the only look control on iPad) | Mouse (click the scene to lock the pointer), or ←/→. Touch: drag on the right half |
| Interact (open bot panel) | A / Cross | E |
| Close panel | B / Circle | Q |
| Walk to next bot station | Y / Triangle or D-pad → (D-pad ← for previous) | Tab |
| **HQ chat (Grok Bot + team)** | **Hold View (⧉, two squares) ~0.5 s.** Short tap does nothing (small rumble + "Hold View to chat" hint) | Enter or T. Touch: 💬 Chat button (top left) |
| In chat | LB / RB switch bot · D-pad pick quick message · A send · R stick scroll · **B** or hold View again to close | Type + Enter · Esc closes |
| Pause menu | Start / Options | Esc or P |
| Enter from menu | A / Start | Click the menu |

Sticks have a 0.16 radial deadzone, and the look stick has a response curve so small movements are precise. Walk speed is 3.2 m/s and jog is 5.6 m/s. Collision keeps you out of walls, desks, glass, and furniture.

The center reticle lights up when you're looking at a bot desk. That desk's monitor gets a gold frame and its nameplate grows. Press A to open its panel.

## HQ chat

Hold the Xbox **View** button (Standard Gamepad `buttons[8]`, a.k.a. Back/Select) for 500 ms to open a chat panel. A gold bar fills under the reticle while you hold, the pad rumbles when it opens. `buttons[6]` is LT in the standard map, so it only counts as View if the browser reports a non-standard mapping. Moving and looking are paused while chat is open.

Who you talk to: the open desk panel, else the desk you're looking at, else the last desk you used (A or Y), else **Grok Bot**. Change it with the dropdown or LB/RB.

**Delivery (real, no canned replies):** each message becomes a GitHub issue (label `hq-chat`) in the **private** repo `johnsonswork-star/grok-bot-hq-inbox`, which Grok Bot watches. Replies are issue comments and show up in the panel (polled every 15 s while it's open). Grok Bot side: `tools/hq-inbox.sh` (list / read / reply / done).

- **Linked device** (status line green, "Linked to Grok Bot + team"): sends instantly in-app and shows "✓ Delivered to Grok Bot & team". Needs a one-time HQ key on that device: open `https://johnsonswork-star.github.io/grok-bot-hq/#hqkey=<fine-grained GitHub token, Issues read/write on grok-bot-hq-inbox only>`. The page stores it in that device's localStorage and strips it from the URL. `#hqkey=clear` removes it. No key is ever in the public code.
- **Not linked** (orange status): Send opens a pre-filled GitHub "new issue" page; tap **Submit** there (must be signed in to GitHub as johnsonswork-star). The message shows "Tap here, then Submit, to deliver" until then.
- Swap transports by replacing `hq-link.js` (`send()` / `fetchReplies()`); the UI in `chat.js` doesn't change.

## Layout (north = the big window wall, you spawn at the south entry door)

- **Entry / reception (south):** glass doors, a reception desk, and a slatted walnut "GROK BOT HQ" logo wall.
- **Center:** **Grok Bot** sits on a raised round platform with a gold ring and a big monitor, facing the entrance. **Chief of Staff** is just to its left (west).
- **North window bench (left to right):** **Faith Lands**, **Web Brokerage**, **Connectivity**.
- **West pod, "family wing"** (back-to-back desks with a divider):
  - South-facing row: **Family Inbox**, **Family Assistance**
  - North-facing row: **Atom Family Designer**, **Kids Tech**
- **East pod, "build wing"** (back-to-back desks):
  - South-facing row: **App Builder**, **App Review**
  - North-facing row: **OnPad Chat**, **Icon Shop**
- **West wall, by the lounge:** **Profile & Settings**.
- **Southwest:** lounge (L-sofa, rug, coffee table) and a kitchenette.
- **Southeast:** glass-walled conference room with a table for 9 and an "HQ Briefing" display. Its door is on the west glass wall.
- North and east walls are floor-to-ceiling windows with daylight, trees, and a skyline outside.

## Files

- `index.html`: HUD (reticle, hint, pad status, fps), pause menu, and interact panel
- `main.js`: scene, lighting, furniture, collision, input (gamepad + keyboard/mouse), and interaction
- `chat.js`: HQ chat panel UI. `hq-link.js`: delivery transport (GitHub Issues inbox). `tools/hq-inbox.sh`: Grok Bot's inbox helper
- `stations.js`: **the bot roster.** Edit name, short label, color, position (x/z in meters), rotation, and role text here to add or move bots
- `serve.js`: tiny zero-dependency static server
- `manifest.webmanifest`, `icons/`, `sw.js`: Home Screen / PWA support (full screen, icon, offline fallback)
- `deploy.sh`: publish to the live GitHub Pages URL
- `vendor/three.module.js`: three.js r169 (MIT)

## Performance notes

The scene uses about 600 small meshes, one shadow-casting light (2048 shadow map), procedural canvas textures, instanced trees, and pixel ratio capped at 1.75. It should hold 60fps on a normal laptop GPU. The fps counter is top-right.

## What's next (v2 ideas)

- Hook each desk to the real bot: A opens that bot's chat or live status (busy / idle / last run)
- Show live activity on monitors (current task, unread mail count, PR status)
- Bot avatars sitting at desks, and walking to the conference room for handoffs
- Meeting mode in the conference room: summon several bots into one thread
- Haptics on interact, button remapping, and a sensitivity slider
- Optional VR / multiplayer later
