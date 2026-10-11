# Bot Office HQ (v1.3)

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

**Delivery (real, instant, no login, no token on the iPad):** tap Send (or A) and the message is delivered in-app in about a second. The status reads "✓ Delivered to Grok Bot & team". No GitHub page opens and nothing has to be set up on the device.

How it works (v2, end-to-end encrypted):

1. `hq-link.js` encrypts the message in the browser (WebCrypto ECDH P-256 + AES-256-GCM, `hq-crypto.js`) to the HQ inbox **public** key and POSTs the ciphertext to a long random topic on the free public relay **ntfy.sh** (no account). Only public keys are in the site code; the relay only ever sees ciphertext.
2. The **HQ bridge** on Grok Bot's box (`tools/hq-bridge.mjs watch`) streams that topic, decrypts with the private key (`~/.config/grok-bot-hq/inbox-key.json`, mode 600, never published) and files a GitHub issue (label `hq-chat`) in the **private** repo `johnsonswork-star/grok-bot-hq-inbox` within ~2 s.
3. Each device creates its own keypair + private reply topic on first use (localStorage `hq.device`). The public half rides inside the encrypted message and is stored in a hidden `hq-meta` comment in the issue.
4. Replies are issue comments. They're encrypted to that device's key and posted to its reply topic, both by `hq-inbox.sh reply` (immediately) and by the bridge's comment sweep (every 20 s; this also catches comments made on github.com). The chat panel polls its reply topic every 15 s while open and decrypts locally.

Grok Bot side: `tools/hq-inbox.sh` (list / read / reply / shot / done / bridge). `list` also restarts the bridge if it isn't running and does a catch-up pass. The relay keeps messages for 12 h, so a bridge restart within 12 h loses nothing. Bridge log: `~/.config/grok-bot-hq/bridge.log`.

If a send fails (no signal), the message shows "⚠ Not sent. Tap to retry".

**📸 View screenshot rides along (automatic, no button).** Every typed send grabs the current 3D view (the WebGL canvas only, no HUD or chat panel), scaled to max 1280 px wide as a JPEG at quality 0.7 (usually 60 to 150 KB). Canned quick-chip messages ("Status update?" etc.) skip it since they never need visuals. It goes inside the same encrypted envelope as the text. An envelope over 4 KB arrives at ntfy as an attachment (kept about 3 h); the bridge downloads and decrypts it. The bridge then:
- saves it to `~/.config/grok-bot-hq/shots/<mid>.jpg` on Grok Bot's box (Grok Bot opens it with Read),
- commits a copy to `shots/` in the private inbox repo and embeds it in the issue body, so it shows inline on github.com,
- adds the path to the Slack `#hq-chat` ping and to `queue.jsonl` (`shot` field).

`tools/hq-inbox.sh shot <n>` prints the screenshot path for issue n (and pulls it from the inbox repo if the local copy is gone). The chat shows "✓ Delivered · 📸 view attached". If capture fails or the big send is refused, the text is sent alone ("no view shot") and nothing blocks. In `chat.js`/`main.js`, `snapshot()` renders a fresh frame and copies it in the same task, so `preserveDrawingBuffer` isn't needed. The scene uses only same-origin, procedural textures, so the canvas is never tainted.

Swap transports by replacing `hq-link.js` (`send()` / `fetchReplies()`); the UI in `chat.js` doesn't change.

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

### Instant wake (webhook)
After filing each new HQ issue, the bridge POSTs `{source, event:"hq-chat", issue, url, to, text, ts, filedAt}` to the Grok Bot webhook routine `hq-chat-instant-wake`. Put `WEBHOOK_URL` / `WEBHOOK_KEY` (copied from the Grok Bot app: Routines → hq-chat-instant-wake → Webhook trigger) in `~/.config/grok-bot-hq/hq-webhook.env` (see `tools/hq-webhook.env.example`), then restart the bridge (`pkill -f "hq-bridge.mjs watch"; tools/hq-inbox.sh bridge`). Without it the bridge just skips the POST. Test: `node tools/hq-bridge.mjs webhook-test`.

## HQ auto-reply watcher (full AI replies, no app routine)

`tools/hq-watcher.mjs` runs on Grok Bot's box and answers every new HQ chat message within seconds.

- `tools/hq-inbox.sh watcher start|stop|status|log` (`bridge` also restarts it unless stopped on purpose).
- Polls `hq-inbox.sh pending` every 3 s (gh only, free). Each new message = one LLM call, posted with `hq-inbox.sh reply`.
- LLM order: `XAI_API_KEY` / `OPENAI_API_KEY` in `~/.config/grok-bot-hq/llm.env` if present (pennies/month at chat volume),
  else a private local model on the box (llama.cpp + Qwen2.5-3B-Instruct in `~/.local/share/grok-bot-hq/llm`, free,
  ~5-15 s per reply, loaded on demand and unloaded after 15 idle minutes), else a contextual fallback.
- Background facts the replies may use: `~/.config/grok-bot-hq/hq-context.md`.
- Approval asks (buy/send/delete/...) get a "reply yes to confirm" answer plus a line in `~/.config/grok-bot-hq/needs-chris.jsonl`.
- Every handled message is logged to `~/.config/grok-bot-hq/tasks.jsonl` so the full Grok Bot session can do the real work.

## Worker characters (one per bot)
`workers.js` gives every station in `stations.js` a low-poly worker (shirt = bot color, short-name tag over the head).
- **Idle**: roams the floor: coffee at the kitchenette, windows, phone calls, thinking, chatting with another idle worker. Glances at you when you walk up.
- **Busy**: walks (A* around desks, pods, columns) to its own chair, sits and types. Its monitor switches to `WORKING` + the task line, and the desk panel (A / E) shows "Working at desk: <task>".
- Looking at a worker focuses that bot, so A / E or Hold View works on people too.

**What counts as busy:** `tasks.json` at the site root (polled every 20 s, never cached):
```json
{ "busy": { "grok": "HQ chat on duty", "builder": { "task": "Ship login fix", "until": "2026-10-10T22:00:00-05:00" } } }
```
Mark bots from the box: `tools/set-busy.sh builder "Ship login fix" [minutes]`, `tools/set-busy.sh builder off`, `tools/set-busy.sh list` (commits + pushes just tasks.json; live in ~1 min). Test without deploying: `?busy=builder,review` (or `?busy=all`) on the URL, or `__office.workers.setBusy('builder', 'task')` in the console.

## Live reload
`deploy.sh` writes `version.json` with a build id. The open office polls it every 20 s; on a new build it waits until no HQ message is sending and you aren't typing, then reloads and restores your spot, view, open chat, and draft text. Pages files are revalidated by the service worker (no 10-minute stale cache).

## Live desk monitors (monitors.js)
- **Grok Bot's monitor** = the HQ chat, live: your messages and Grok Bot/team replies, newest at the bottom, auto-scrolling, with a footer ("Grok Bot is on it (#n)…", "Waiting for your next message").
- **Every other monitor** = that bot's real status from `tasks.json`: **WORKING** + task text + "at desk N min" (+ "until" time), or **Idle · roaming the floor**. Nothing invented.
- Look at a desk and press **A / E** to open its panel: the monitor is shown full-size there (same live canvas).
- **Where the chat feed comes from (privacy):** no public transcript. The monitor mirrors this device's own HQ chat log (localStorage) plus replies pulled from the end-to-end encrypted ntfy relay (decrypted on the iPad). The app now polls for replies every 15 s even with the chat closed, so the monitor updates while you play.
- **Bridge wiring:** when `tools/hq-bridge.mjs` files a new HQ message as an issue, it sends an encrypted `ack` (issue #) to the sending iPad; the chat shows "#n" and Grok's monitor shows "Grok Bot is on it (#n)". Replies via `tools/hq-inbox.sh reply` arrive the same encrypted way and appear on the monitor within ~15 s.
- Other bots: `tools/set-busy.sh <id> "task" [minutes]` (now also records `since`) → their monitor flips to WORKING within ~1–2 min.
- iPad perf: screens redraw only on change or ≤3 fps (cursor/scroll), and only for desks within ~16 m of you.
- Limitation: transcript is per device (another device shows its own HQ history).
