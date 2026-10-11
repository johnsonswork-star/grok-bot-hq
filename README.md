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

## Layout: Dunder Mifflin Scranton (HQ #30 / #36)

North = the big window wall. You spawn at the south front door, facing Pam's reception. The floor plan follows The Office (Scranton branch); `LAYOUT` in `main.js` is bumped when it changes so a live reload drops you at the front door instead of inside a new wall.

| Spot (The Office) | Bot | Where |
|---|---|---|
| Michael's glass corner office | **Grok Bot** (hero desk, HQ chat monitor) | SE corner, blinds, door on the north side by Jim + Dwight |
| Pam's reception | **Family Inbox** | right inside the front door |
| Jim's desk | **Chief of Staff** | face-to-face pair outside Michael's door |
| Dwight's desk | **Family Assistance** | (bobblehead; Jim's stapler is in jello) |
| Andy's desk | **Icon Shop** | west of Jim + Dwight |
| Stanley's desk / Phyllis's desk | **App Builder** / **OnPad Chat** | face-to-face pair, middle of the bullpen |
| Angela / Oscar / Kevin (accounting) | **Faith Lands** / **Web Brokerage** / **Connectivity** | U-cluster under the ACCOUNTING sign |
| Creed's desk ("quality assurance") / Meredith's desk | **App Review** / **Kids Tech** | back of the bullpen by the windows |
| Kelly's desk (annex) | **Atom Family Designer** | the annex, NE corner |
| Toby's desk (annex, HR) | **Profile & Settings** | the annex |

Rooms: conference room west of reception (glass + blinds, long table, HQ Briefing TV on the west wall, live whiteboard on the south wall with clock / weather / markets / TEAM ON IT / BANK + REFRESH); kitchen + break room in the back west corner (counter, fridge, microwave, coffee, snack + soda machines, round tables); the annex in the back east corner with Ryan's closet; copier by reception; filing cabinets; water cooler on the west wall just outside the kitchen (the only place workers drink); warehouse = a labeled door on the west wall with pallets of paper (no downstairs floor, to keep iPad frame rate up).

Shots: `shots/scranton-*.png`.

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
- **Busy**: walks (A* around desks, walls, doorways, columns) to its own chair, sits and types. Its monitor switches to `WORKING` + the task line, and the desk panel (A / E) shows "Working at desk: <task>".
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

## Family Inbox desk (real inbox, encrypted)
The Family Inbox (FI) desk monitor shows Chris's newest emails: sender, subject, time, unread dot. Lead-generation and
job-alert mail (Thumbtack, Jobrapido, Indeed, ZipRecruiter, Glassdoor, LinkedIn jobs, Angi/HomeAdvisor, "your resume
stood out", "new leads", etc.) is filtered out, and the footer counts how many were hidden.

Privacy: nothing about the mail is on the public GitHub Pages site or in this repo. `tools/refresh-inbox-feed.mjs`
trims each email to sender label (brand/name, no address), subject (codes and long numbers masked, 70 chars), time, and
unread flag; no bodies, snippets, links or ids. It then encrypts that list to each HQ device's own key (the same key
the iPad uses for HQ chat replies) and posts it to that device's private ntfy topic `<device topic>_inbox`. ntfy only
sees ciphertext and drops it after ~12 h; the iPad keeps its last decrypted copy locally, polls every 60 s, and the
screen falls back to the normal task/idle view when there is no feed or it's older than 36 h.

Refreshing (Gmail lives in Grok Bot's Gmail connector, not on the box, so there's no idle cron burning AI allowance):
1. Grok Bot: Gmail `search_threads` `{query:"in:inbox -category:promotions -category:social", pageSize:40}` saved to a file.
2. `node tools/refresh-inbox-feed.mjs <file>` (`--dry` to preview). Local copy: `~/.config/grok-bot-hq/inbox-live.json`.
Do it whenever Grok Bot is already awake for HQ chat or a Gmail check, or when Chris asks.

## Whiteboard BANK panel (read-only balances)
Conference-room whiteboard, right column. Balances come from the Finance connector (Plaid, read-only) and are
**never committed to this public repo**: `tools/refresh-bank-feed.mjs` redacts them (institution, account name,
last 4, balances, totals; no ids, no transactions), encrypts them to each HQ device key, and posts them to that
device's private ntfy topic `<topic>_bank`. The iPad decrypts, keeps the last good copy, and shows
"read-only · updated h:mm CT" (marked stale / "bank feed offline" when the relay has nothing).
Refresh after each Finance pull (see the script header):
`node tools/refresh-bank-feed.mjs <accounts-file> <connections-file>` (or no args = reuse `~/.config/grok-bot-hq/bank-snapshot.json`).
Shape: `tools/bank-live.json.example` (fake numbers).

## Tap-to-refresh (HQ #29): BANK panel + Family Inbox monitor
Both screens have a big **⟳ REFRESH** button: a red marker box at the bottom of the whiteboard BANK panel, and an orange button at the bottom-right of the Family Inbox monitor.
- **iPad touch:** tap the button in the 3D view. **Controller:** aim the reticle at it (the hint reads "⟳ Refresh …  ·  A / E / tap") and press **A**. In the Family Inbox desk panel, use the REFRESH button or press **X**. **Keyboard/mouse:** E or click while aiming.
- What it does: `hq-link.requestRefresh(kind)` seals `{type:'refresh', kind:'bank'|'inbox'}` to the HQ inbox key and posts it on the normal HQ relay. The bridge (`tools/hq-bridge.mjs`) sees `type:'refresh'`. It files **no** GitHub issue and puts no bubble in chat. It appends the request to `~/.config/grok-bot-hq/refresh-requests.jsonl` and posts to Slack `#hq-chat` (":arrows_counterclockwise: HQ refresh request: BANK …" with the exact steps). That wakes Grok Bot through the Slack routine. At most one ping per kind every 3 min; old catch-up requests (over 30 min) don't ping.
- Grok Bot then pulls with its connector and pushes the feed. Bank: Finance `finance_list_accounts` + `finance_list_connections` → `node tools/refresh-bank-feed.mjs <a> <c>`. Inbox: Gmail `search_threads` → `node tools/refresh-inbox-feed.mjs <file>`.
- **When Grok Bot is already awake:** `tools/hq-inbox.sh pending` (or `refreshes`) lists any open requests (newer than the last `bank-live.json` / `inbox-live.json` push) with the command to run.
- iPad side: the button shows **ASKED GROK…**. The feed is polled every 15 s for 10 min and the button flips to **FRESH ✓** when a newer feed lands (or **NOT SENT · TAP** with no signal). There is a 60 s cooldown, so double taps don't spam.
- No timer routines are needed. Test without Slack: `SLACK_WEBHOOK_URL=http://localhost:9/x node tools/hq-bridge.mjs refresh-test bank`.
- Fix shipped with this: the bank poll URL had `&t=<timestamp>`, which ntfy reads as a filter, so it always came back empty ("bank feed offline"). Never add `t=` to ntfy poll URLs.

## Live work on desk screens (HQ #31)
While a bot is busy (tasks.json) and has a live feed under 3 h old, its monitor switches to **LIVE · <bot>**. It shows the task, the current step, the file (▸), a terminal of the last output lines that scroll up as new ones arrive with a blinking cursor, and up to 4 thumbnails of its newest images (the newest is outlined in gold). Without a feed it shows the old CURRENT TASK card.
- Source: `~/.config/grok-bot-hq/work/<botId>.json` on the box, written by `tools/work-live.mjs`:
  - `set <bot> --task T --step S --file F --line L --image P --dir DIR --log-file MD --clear-lines`
  - `log <bot> "line"`, `<cmd> | node tools/work-live.mjs pipe <bot>` (streams a command's output onto the monitor), `image <bot> <png>`, `clear <bot>`, `show [--thumbs]`, `push`
  - `--dir` watches a folder (recursive) and new images become thumbnails plus a "new image:" line. `--log-file` follows a bot's markdown progress log ("Current step:", "watching folder:", and the bullets under "## Last progress lines").
- Publisher: `node tools/work-live.mjs watch` (started by `tools/hq-inbox.sh bridge` / `pending`, log `~/.config/grok-bot-hq/work-live.log`). It's plain node with no AI. It checks every 4 s and pushes on change, at most every 15 s, plus a keep-alive every 2.5 h. The bundle (thumbnails are ~220 px JPEGs) is **encrypted to each HQ device** and posted to `<device topic>_work`, the same privacy model as the inbox and bank feeds. Nothing goes in this public repo. Feeds over 4 KB ride as an ntfy attachment (CORS-open, about 3 h). The iPad reads only `since=latest`, keeps its last copy, and polls every 12 s.
- Wired now: **Atom Family Designer** follows `atom-family-clothing-co/DESIGNER_DESK_LOG.md` and watches `designs/mascot/desk-options-oct10/` (badge options + contact sheet). **App Builder** gets a line on every `./deploy.sh`.

## Dunder Mifflin cast (HQ #37)
The office is skinned as Dunder Mifflin Scranton. Each desk keeps its stable bot `id` (tasks.json, work-live, inbox/bank feeds)
but shows an Office character as `name`; `bot` is the real bot behind it, and HQ chat still routes to `bot` (Grok Bot answers as Grok Bot).

| id | character | bot |
|---|---|---|
| grok | Michael Scott (office, SE corner) | Grok Bot |
| inbox | Pam Beesly (reception) | Family Inbox |
| cos / assist | Jim Halpert / Dwight Schrute (outside Michael's office) | Chief of Staff / Family Assistance |
| icons | Andy Bernard | Icon Shop |
| onpad / builder | Phyllis Vance / Stanley Hudson | OnPad Chat / App Builder |
| faith / broker / conn | Angela / Oscar / Kevin (accounting) | Faith Lands / Web Brokerage / Connectivity |
| review / kids | Creed / Meredith | App Review / Kids Tech |
| designer / profile | Kelly / Toby (annex) | Atom Family Designer / Profile & Settings |

Layout `scranton-2`: conference room now shares a wall with Michael's office (whiteboard on that wall), west bullpen door is the
emergency exit (the warehouse is downstairs, signed by the front door), supply closet front-west.
