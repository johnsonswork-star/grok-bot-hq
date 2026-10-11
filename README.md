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
3. **Add to Home Screen:** Share button > Add to Home Screen > Add. Launch it from the "Dunder Mifflin" icon so it opens full screen, with no Safari bars. Turn the iPad sideways (landscape).
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

## Direct tab: 1:1 with one teammate, no Michael (HQ #63)

The chat panel now has three tabs (tap them, or press **X** on the controller to cycle):

- **★ Michael (Grok Bot)**: the real Grok Bot only. Real orders, questions, builds (same HQ issue + Slack wake as before).
- **📣 Office**: the #59 whole-office stream (small talk + moves = free office bot, real orders = Michael). Direct threads never show here.
- **💬 Direct**: pick ONE person from the people row (or LB / RB) and talk to them 1:1. Michael is not in this path: no HQ issue, no Slack wake.

What happens to a Direct message (`direct: { bot }` in the encrypted envelope; `tools/hq-bridge.mjs` hands it to `tools/direct.mjs`):
1. Moves ("get out of the way", "go to the water cooler") run instantly on the iPad and the person answers in character (bubble over their head).
2. The person's **office stand-in** answers right away in character (free built-in lines, or a FREE model if `~/.config/grok-bot-hq/llm.env` has an OpenRouter/Gemini key). Labeled "🎭 office stand-in".
3. If a **real teammate agent** sits behind that desk (✓ in the people row; `teammate: true` in stations.js), every non-move message is queued for it in `~/.config/grok-bot-hq/teammate-inbox/<botId>.jsonl` (private, never in git). The teammate answers with `node tools/direct.mjs reply <botId> "text"` and the line lands in Chris's Direct thread labeled "✓ real <teammate>".
4. Worker memory (HQ #58) records what Chris said to them and what they answered. The thread is filed as `thread: "dm:<botId>"` in `office-chat.jsonl` (Michael's desk monitor only mirrors the Office stream, not Direct threads).

Character -> teammate map (agent ids only in `~/.config/grok-bot-hq/teammates.json`, see `tools/teammates.json.example`):
Andy Bernard -> Icon Shop, Kelly Kapoor -> Atom Family Designer, Toby Flenderson -> Profile & Settings. Everyone else is an office character (chats + moves, says real work goes to Michael) until a teammate agent is added to teammates.json and `teammate: true` is set on that station. Michael Scott = Grok Bot, main tab only.

Forward path: the box cannot wake another agent by itself. Whoever has agent messaging (Grok Bot's SendToAgent, a routine) runs `tools/direct.mjs pending` (also shown by `tools/hq-inbox.sh pending`), sends each line to its agentId with the reply command, then `tools/direct.mjs forwarded <bot> all`.
CLI: `node tools/direct.mjs map | test <bot> "text" | thread <bot> | pending [bot] | forwarded <bot> <id|all> | reply <bot> "text"` (or `tools/hq-inbox.sh direct ...`).

## Tap-to-pick on desk screens (HQ #50)

When a bot is waiting on Chris to choose between options, its desk screen turns into **pick cards** (image + letter, 3 x 2 grid, last cell = contact sheet). First use: Kelly's (Atom Family Designer) badge options H–L.

- **Pick:** tap a card on the 3D monitor (iPad), or aim the reticle at it and press A / E / click. In the open desk panel (A at the desk) tap the big screen, or D-pad ←/→ to move the highlight and X to press. Multi-select: tap again to unpick. Gold border + ✓ = selected (kept on the device until sent).
- **Submit:** the SUBMIT PICKS button sends `{type:'pick', bot, id, issue, picks}` through the same encrypted HQ relay as chat / REFRESH (`hq-link.requestPick`). The bridge (`handlePick` in `tools/hq-bridge.mjs`) logs it to `~/.config/grok-bot-hq/picks.jsonl`, runs `work-live.mjs picked` (feed + the bot's desk log move from review to working, next step, "Chris's picks" section), comments the picks on the HQ issue (so `hq-inbox.sh pending` lists it and the note shows in Chris's chat), and pings Slack #hq-chat. Within ~30 s the screen flips to "✓ YOU PICKED …".
- **Set up cards:** `node tools/work-live.mjs pick <bot> --id ID --issue N --title T --opt "H|Title|sub|/abs/path.png" ... [--sheet /abs/contact.jpg]` (real files only; missing paths are refused). `unpick <bot>` removes them.
- **Same cards on the Team Board TV (HQ #52):** while a pick is open (and for 3 h after it's sent), the conference Team Board shows a pick panel above the task list with the same cards + contact sheet + SUBMIT. Tap the TV, or aim the crosshair and press A / E / click. It shares the desk's selection and send state (`monitors.pickTap` → `requestPick`), so it's one pick path; after SUBMIT the panel turns green "✓ YOU PICKED … · Kelly is on it".
- **Waiting on Chris everywhere:** a feed with open pick cards, `work-live.mjs waiting <bot> Chris`, a review/blocked step that mentions Chris, or `"waiting": "Chris"` on a tasks.json entry shows an amber **⏳ WAITING ON YOU** banner on the desk and sorts first on the conference Team Board (amber row, YOUR CALL pill, header count).

## Layout: Dunder Mifflin Scranton, set-scale floor plan (HQ #30 / #36 / #38 / #42)

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

Layout `scranton-5-set` (HQ #42): floor shrunk again to 18 x 12 m with a 3 m drop ceiling (was 26 x 18). Michael's glass office 4.5 x 4 m in the south-east corner, conference room 4.5 x 4 m right behind it, the annex (Kelly, Toby, Ryan's closet) past that, kitchen + break room crammed into the back west corner, reception about 2 m inside the front door. Desks touch like the TV set: Jim/Dwight and Phyllis/Stanley face-to-face pairs, Angela + Oscar side by side with Kevin facing, Creed + Meredith side by side at the back windows. Signs are show-style plaques: Icon Shop's PNGs in `assets/signs/png` (reception counter, company sign on the front wall + hung over reception, CONFERENCE ROOM door plate, SALES over Jim/Dwight) and `plate()` door plates in the same cream/brown/green style (MICHAEL SCOTT · REGIONAL MANAGER, CONFERENCE ROOM, THE ANNEX, KITCHEN, BREAK ROOM, SUPPLY CLOSET, ACCOUNTING, WAREHOUSE ↓ STAIRS, RYAN HOWARD · TEMP). Every desk's stand spot and every worker idle spot is checked to be reachable from the front door.

Layout `scranton-6-roomy` (HQ #43): floor grown to 22 x 15 m because a few walkways were too tight to walk through. The extra room went into the aisles: >= 1 m between every desk cluster (Andy | reception 1.4 m, Jim/Dwight | Michael's glass ~1.4 m, accounting | files ~1.1 m), Michael's office 4.5 x 5 m with a walkway all the way round his desk (couch moved to the south wall), conference + annex 4.5 x 5 m, wider kitchen/break/closet doors (1.1-1.2 m). Desk pairs still touch like the show. Headless check: every desk stand spot, idle spot and room is reachable from the front door with 0.9 m clearance (only the two closets are tighter). Props/rooms keep their shapes: `moved(dx, dz, fn)` in main.js slides a block of old-layout props rigidly.

Previous: Layout `scranton-3-compact` (HQ #38): floor shrunk from 40 x 28 m to 26 x 18 m and desks packed like the show's bullpen. Jim/Dwight face-to-face right outside Michael's door, Phyllis/Stanley right behind them, accounting (Angela + Oscar side by side, Kevin facing) packed under the sign, Creed/Meredith by the back windows, reception about 3 m inside the front door. Every desk's stand spot and every worker idle spot is checked to be reachable from the front door. Pressing Y picks the first clear spot behind each desk (`freeStand`).

Shots: `shots/s38/*.png` (compact), older `shots/scranton-*.png`.

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

## Live progress stages on desk screens (HQ #46)
Every busy desk screen now shows **how far along** the work is, live (12 s feed poll, no page reload):
- A stage track **QUEUED → WORKING → REVIEW → DONE** (BLOCKED turns the WORKING pill red). The current stage pulses, and a stage change flashes white for ~2 s.
- A progress bar with % when known (it eases to the new value). The label is the current step ("Step 4/5 · Chris reviews…"), else the free-text step. With no %, a stripe sweeps while working.
- A step checklist (✓ done, ▶ now, ○ todo) showing a window around the current step, above the output terminal and thumbnails.
- `review`, `queued` and `blocked` feeds stay on the screen for up to 48 h (24 h for blocked) even while the character roams, because they wait on people. `working` feeds still need the bot busy in tasks.json and expire after 3 h.
- Plain busy desks with no feed show the track as WORKING. tasks.json entries may also carry `"stage"` and `"pct"`.

How a teammate sets it (`tools/work-live.mjs`, the running watcher publishes within ~15 s):
```
node tools/work-live.mjs set <bot> --task "Badge set v2" --steps "Sketch|Vector|Print check|Review" --now 1   # starts WORKING, step 1
node tools/work-live.mjs next <bot>                     # tick current step, move on (after the last step -> REVIEW)
node tools/work-live.mjs stage <bot> working 40 "vectoring badge M"   # stage + optional % + optional note line
node tools/work-live.mjs stage <bot> review | done | blocked | queued
node tools/work-live.mjs set <bot> --pct 75             # just the %
```
Bots that keep a markdown log (Atom Family Designer: `atom-family-clothing-co/DESIGNER_DESK_LOG.md`) can set it from the log instead: `**Stage:** working`, optional `**Progress:** 40%` (or `3/5`), and a `## Steps` checklist (`- [x]` done, `- [>]` now, `- [ ]` todo). The % comes from the checklist when there's no Progress line. With no Stage line, the stage is guessed from Status / Current step ("awaiting review" → REVIEW, "done" → DONE, etc.).

## Conference-room TV = live Team Board (HQ #48)
The north-wall TV in the conference room (it was a static "All-staff meeting" slide) is now **Dunder Mifflin · Team Board · LIVE**. It lists every open task: who owns it (character + real bot), the task, the current step or "since" time, a stage pill (BLOCKED / WORKING / REVIEW / QUEUED / DONE) and a % bar. Counts per stage are at the top. It reads the same data as the desk screens (tasks.json busy entries plus the encrypted work-live feed), so it updates within the same 12–20 s polls with no reload. It redraws when anything changes, and animates only while you're within ~9 m. Rows are sorted blocked → working → review → queued → done, newest first. Over 7 rows, the last line says "+ N more".

## The Office cast at Dunder Mifflin (HQ #37 / #39 / #40)
Company branding is **Dunder Mifflin** (HQ #40 replaced the HQ #39 Johnson Co · Bot HQ branding: page title, logo board, reception sign, whiteboard, meeting TV, softball sign, sticky note, welcome toast). People keep The Office character names. Each desk keeps its stable bot `id` (tasks.json, work-live, inbox/bank feeds)
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

## Needs you (HQ #53, moved to the Team Board in HQ #55)

The **Needs you** list lives on the **conference-room Team Board TV**, right under the picks row (or under the stage counts when no pick panel is up): one live list of everything waiting on Chris.
Each row: what it is, who's asking (+ how long it's been waiting), and what to do ("➜ Tap your favorite H–L on Kelly's desk or the conference TV, then SUBMIT"). Up to 3 rows fit; more shows "+N more" in the panel header. Empty: a green strip "✓ NEEDS YOU · nothing waiting on you right now" (with the last handled ask on the right when no pick strip is showing).
Once a pick is submitted, the TV's pick cards fold into one green "✓ PICKS IN · … you picked H, I, K" strip (for 3 h) so Needs you and the task rows fit under it. Open picks still show the full tappable cards.

Toby's desk (**Profile & Settings**) is a normal desk screen again, with one line at the bottom: "⏳ N need you · see conference board" or "✓ Nothing needs you · list is on the conference board".

One shared list (`needsList()` in `monitors.js`) feeds the board panel, the header's WAITING ON YOU count, and Toby's pointer, so they never disagree. Sources:
- live work feeds waiting on Chris (`work-live.mjs waiting <bot> Chris`, an open pick card, or review/blocked with a step naming Chris)
- `tasks.json` entries with `"waiting": "Chris"` (when that bot has no live feed)
- anything else: `node tools/work-live.mjs need add <id> --title "Approve X" --who "Andy · Shop" --do "Reply yes in HQ chat (#44)" [--bot <station>] [--issue N]`, closed with `need done <id>` (`need list` shows the open ones). Stored in `~/.config/grok-bot-hq/needs-chris.jsonl` on the box, sent only inside the encrypted work feed.

Live: rides the existing work-feed publisher (`work-live.mjs watch`, pushes within ~15 s of a change) and the iPad's 12 s poll. No reload.

## Speech bubbles + teammates talking in character (HQ #54)

`talk.js` + `voices.js`. When someone has something to say, a speech bubble (their name in their color, white card, tail
pointing at them) floats above their head, fades in, holds 3.5–8.5 s depending on length, and fades out. It works seated or
standing, scales up a little with distance so it stays readable on the iPad, and stacks above a neighbour who's already talking.
One bubble per person, at most 3 on screen at once, the rest wait in a short queue (lines older than 90 s are dropped).
If the speaker is off-screen or more than 12 m away, the line also shows as a small caption at the bottom of the screen.

**When they talk (real events only):**
- tasks.json: sits down on a new task, stage changes (queued / working / review / done / blocked), starts waiting on you, gets up free
- live work feed: stage change, pick cards go up ("ask"), your picks land ("picked", e.g. Kelly: "OMG, H, I and K?! You have SUCH good taste."), waiting on Chris
- you tap SUBMIT on pick cards: that teammate reacts right away (once, not again when the feed confirms)
- Needs you: a new item -> its owner asks for you; an item cleared -> a thank-you
- HQ chat: you message someone -> they acknowledge in character; a reply attributed to them (`hq-inbox.sh reply N "text" "Kelly Kapoor"`, or Grok Bot -> Michael) -> they say the first ~120 characters, sometimes with an in-character opener
- `node tools/work-live.mjs say <bot> "line"`: a bot's own custom line for a real event (rides the encrypted work feed, shown once per device, only if < 10 min old)
- idle: very rare (4–8 min apart) one-liner from an idle teammate within 9 m of you. Full random banter is HQ #56.

Guards: nothing speaks in the first 6 s after load (it seeds from the current state, so a reload doesn't replay old news),
feed events older than 10 min are ignored, one line per person per 25 s for routine status, same line never twice in 2 min.

**Cost: zero.** Every line is a local template from `voices.js` (14 characters x 13 events, written in each character's
show voice: Michael, Pam, Jim, Dwight, Andy, Phyllis, Stanley, Angela, Oscar, Kevin, Creed, Meredith, Kelly, Toby).
The office makes no AI calls. We deliberately did NOT wire the llm.env API key in here: the only "AI" lines are ones a bot
writes while it's already working on the real event (`work-live.mjs say`), so no extra allowance is ever spent and an idle office costs nothing.
Turn bubbles off on a device: add `?quiet=1` to the URL or `localStorage.setItem('hq.talk','off')` (HQ chat replies still show).
Console: `__office.talk.say('designer', 'Hi!')`, `__office.talk.react('assist', 'done', { task: 'resume' }, { force: true })`.

## Random office banter (HQ #56 / #57)

Teammates who are free now and then wander over to each other and have a short in-character chat (2–4 lines) as speech bubbles.

**Who writes the lines:** a FREE model, called from the box (never from the iPad). `tools/banter.mjs` picks the first provider it has a key for:
1. **OpenRouter free models** (`OPENROUTER_API_KEY` in `~/.config/grok-bot-hq/llm.env`): `openrouter/free` (OpenRouter's free-model router), then `google/gemma-4-31b-it:free`. Override with `BANTER_MODEL`; any id that isn't `:free` / `openrouter/free` is refused, so it can't spend money.
2. **Gemini Flash free tier** (`GEMINI_API_KEY` or `GOOGLE_API_KEY`): `gemini-flash-lite-latest` (override `GEMINI_MODEL`).
3. **No key:** a local writer (per-character openers / comebacks / sign-offs for all 14 cast members + hand-written pair scenes: Jim/Dwight stapler, Kevin/Angela granola, Stanley/Phyllis pretzel day, Toby/Meredith "fruit drink"…). Free, offline. If a model call fails it falls back to this too.
See `~/.config/grok-bot-hq/llm.env.example`. xAI / OpenAI / paid keys are never read by the banter script.

**Your messages are untouched:** HQ chat to anyone still goes to the real Grok Bot (Slack wake). Banter only reads `tasks.json` + the work feed and writes `says.jsonl`; it never sees or answers HQ chat.

**Rate limits (hard):**
- one exchange every 3–6 min at most (random), with a 3-min floor saved to disk so restarts can't double up; 2–4 lines, each ≤ 110 chars; ≤ 120 exchanges/day (`BANTER_DAILY_MAX`); one model call per exchange, ~300 output tokens max
- only between two IDLE people (not busy in tasks.json, no live working/review feed), preferring desk neighbours
- skipped while anything needs you (Needs you list), while a pick card is open (you mid-pick), or someone is waiting on you; optional quiet hours `BANTER_QUIET=23-7`
- on the iPad: nothing in the first 3 min after load, exchanges older than 4 min are dropped, one exchange at a time, not while the HQ chat panel is open or a pick/needs item is up, and none with `?quiet=1` / `hq.talk=off`

**On screen:** the pair walk toward each other, stop and face each other (chat pose), then the lines alternate as bubbles (captions at the bottom if they're out of view). Rides the existing encrypted work feed (`says` with a `banter` group id), so it shows up live, no reload.

**Run it (box):** `tools/banter.sh start | stop | restart | status | once [--force] | dry | off | on`. `hq-inbox.sh bridge` / `pending` also start it (idempotent). `off` pauses (loop keeps running but skips). Log: `~/.config/grok-bot-hq/banter.log`; state: `banter-state.json`.
Test on a device without waiting: open the office with `?banter=now` (skips the 3-min warm-up), then `tools/banter.sh once --force`.

## Every worker remembers you (HQ #58)

Each teammate keeps their **own** memory: everything you say to them in HQ chat and what happens around them. Be mean to Kelly and she remembers; thank her and she warms up.

**Store (private, on Grok Bot's box, never in this public repo):** `~/.config/grok-bot-hq/worker-memory/<botId>.jsonl`, one file per stations.js id, append-only JSON lines:
`{ at, kind, text, src, issue?, tone?, score?, with?, about? }`
- `chris`: you said this TO them (the HQ message's recipient), with a local tone check (`tone.js`: kind / neutral / harsh, score -1..1, plain word lists + shouting, no AI)
- `mention`: you talked ABOUT them to someone else ("tell Kelly…"); counts half
- `reply`: what was answered to you as them (`hq-inbox.sh reply N "…" "Kelly Kapoor"`)
- `event`: their own office goings-on: new task, stage moves (queued → working → review → done), pick cards up, your picks, waiting on you, Needs-you items, lines they said
- `banter`: who they chatted with + their line
- `_shared.jsonl`: the only cross-worker file, for office-wide facts explicitly marked shared (`log shared "…"`). Nobody reads another worker's file.

**Relationship** is worked out on read: decayed sum of the tone of your messages to them. Harsh words count 1.5x and fade over ~10 days, kind words fade over ~4 days (grudges outlast compliments). Labels: hurt / wary / neutral / warm / fond.

**How your messages get in:** the bridge (`hq-bridge.mjs`) appends every new HQ message to the recipient's memory the moment it files the issue (+ anyone you name in it as a mention), and logs desk picks. `worker-memory.mjs sync` (run by `hq-inbox.sh pending` / `read` / `memory`) catches up from `queue.jsonl` + `picks.jsonl`, idempotent. `work-live.mjs` logs a bot's stage / task / pick / waiting / needs / `say` changes to that bot.

**How it changes their voice (free, local):**
- iPad: the work feed carries only `mem` = `{ rel, label, said }` per worker (a few words, encrypted like the rest of the feed). `voices.js` `MOODS` has per-character `stung` / `thanks` / `cold` / `warm` lines; `colorLine()` swaps or tags their normal event lines by mood (hurt ~65 %, wary ~35 %, warm ~25 %, fond ~45 %). Cold lines sometimes quote back what you said ("I'm still not over 'this is trash'. Like, at ALL.").
- The moment you send someone a harsh or kind message, the office tone-checks it locally and they react right away (Kelly: "Excuse me?! I am literally SO offended right now."), and their mood shifts on your device until the box memory confirms it.
- Banter: only the mood label is used (never your words). The model prompt gets a one-line mood hint; local lines swap one of a sore/glad worker's lines for a mood line ("the boss" instead of your name).
- Replies as a bot: `hq-inbox.sh read N` prints the recipient's digest under the message; `hq-inbox.sh memory <bot>` / `work-live.mjs memory <bot>` print it; `work-live.mjs say <bot> "…"` prints a one-line mood hint after saying it.

**Tool:** `node tools/worker-memory.mjs log <bot|shared> "text" [--kind] [--issue N] | chris <bot> "text" | hq <issue> "<To>" "text" | recall <bot> [n] | digest <bot> [--json] | mood | list | sync | who <name>`.

## One office chat (HQ #59)

The HQ chat panel (hold View / Enter / 💬) is now **one chat for the whole office**: a single chronological stream with your messages (from any device), the office bot's in-character answers, the real Grok Bot's replies (Michael · ★ real Grok Bot), and teammates' own lines + banter (shown smaller, "chatting" / "says"). Every line is labeled with the Office character + bot (dot in their color). The audience defaults to **📣 Whole office**; LB / RB or the dropdown can still point a message at one person. Michael's desk monitor mirrors the same stream.

**Who answers (triage).** `office-chat-rules.js` decides, and both the iPad and the box use that same file:

| You type | Route | What happens |
|---|---|---|
| `Phyllis, get out of the way` · `tell Kevin to go to the water cooler` · `Andy come here` · `everyone back to your desks` · `Jim face me` · `Creed stop` · `Phyllis, as you were` · `everyone stop talking` | **office (free)** | The move runs on the iPad the moment you hit send, and that person answers in character. No AI. |
| `hey everyone` · `how's it going Andy?` · `tell me a joke` · `thanks Pam` · `good work, team` | **office (free)** | Office bot answers in character: a FREE model if a key is set (OpenRouter `:free` / Gemini Flash free tier, same `llm.env` keys as banter), else built-in lines. |
| anything with real work in it (build, fix, change, send, email, buy, check, status, schedule, picks, yes/no/ok, questions it doesn't recognize…) | **grok** | Filed as an HQ issue + Slack #hq-chat wake, exactly like before. The 3D view screenshot rides along. The chat shows "★ to Michael (Grok Bot) · #n" and a "Michael: On it (HQ #n)" line. |
| `Phyllis move and then build me a widget` | **both** | Phyllis moves right away (free); the order goes to Grok Bot. |

If it's unsure, it goes to the real Grok Bot. Overrides: start with `@grok` / `grok:` / `/grok` to force the real Grok Bot; `/office` forces the free office bot.

**Commands (safe set, 3D office only).** `move` (step out of your way: walks 2-4 m away from you), `cooler` (water cooler), `desk` (sits at their desk; if they're not on a task they get up again after 90 s), `come` (walks to ~1.3 m in front of you and faces you), `face` (turns to you), `stop` (stays put ~40 s), `wander` (back to normal roaming), `hush` (no idle lines / banter from them for 20 min). Names can be first name, full name, the bot name or `everyone`. With no name, it's the person you're closest to / facing. Busy workers go back to their desk after the command. The casual path never touches files, email, deploys or money: it only moves people around in the 3D office and writes a chat line.

**Add a command.** 1) Add an entry to `ACTS` in `office-chat-rules.js` (label + regex) and put it in `ACT_ORDER`; 2) add its lines to `ACT_LINE` (and any `SPECIAL['bot:act']`); 3) handle the act in `order()` in `workers.js` (or in `runCommands` in `main.js` for non-movement acts, like `hush` → `talk.hush`). Test the wording on the box: `node tools/office-chat.mjs test "Kevin go to the water cooler" [--to "Icon Shop"] [--near onpad]`.

**Plumbing.**
- iPad (`chat.js`): triage → run commands (`workers.order` / `talk.hush`) → instant line from the first person told → send through the same encrypted relay with `office: { near, bot, line }` and a client-picked message id (so the box's copy de-dupes). Small talk skips the screenshot.
- Box (`tools/hq-bridge.mjs` → `tools/office-chat.mjs ingest`): re-triages. Office route: no GitHub issue, no Slack; an `ack` with `route:'office'` and the reply line(s) go straight back to that iPad, encrypted. Grok route: the bridge files + wakes as before and `noteGrok` adds the "On it" line. Every relayed Grok Bot reply is also logged (`noteReply`).
- Unified log: `~/.config/grok-bot-hq/office-chat.jsonl` (Chris lines, office-bot replies, Grok replies, route notes). A publisher inside the bridge merges it with `says.jsonl` (teammates' lines + banter), keeps the newest 120 lines from the last 48 h, encrypts it per HQ device and posts it to `<device topic>_chat` whenever it changes (checked every 2 s). The iPad polls that every ~6-12 s (`hq-link.fetchChatFeed`) and merges it with its own log. Because the feed is shared, every device now sees the same office chat.
- Box tools: `node tools/office-chat.mjs show [n]` (recent unified log), `test "text"`, `push`.
