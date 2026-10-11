#!/usr/bin/env node
// Live work on the desk monitors (HQ #31). Each bot's progress lives in ~/.config/grok-bot-hq/work/<botId>.json on this box:
//   { task, step, file, lines: [last output lines], images: [paths, newest first], watchDir, at,
//     stage: queued|working|review|done|blocked, pct: 0-100, steps: [{ t, s: done|now|todo }], stageAt }   (HQ #46)
// The publisher bundles every fresh bot (updated < 6 h), makes small JPEG thumbnails of the newest images, ENCRYPTS the
// bundle to each HQ device key and posts it to that device's private ntfy topic `<topic>_work` (same privacy model as the
// inbox / bank feeds: nothing goes in the public repo; big bundles ride as a ~3 h ntfy attachment, the iPad keeps its copy).
// A desk monitor shows the LIVE view only while that bot is busy in tasks.json (tools/set-busy.sh).
//
//   node tools/work-live.mjs set <bot> [--task T] [--step S] [--file F] [--line L]... [--image PATH]... [--dir DIR] [--log-file MD] [--clear-lines]
//        --dir: watch a folder (recursive) for new images. --log-file: follow a bot's markdown progress log (Current step:,
//        watching folder:, bullets under "## Last progress lines"), e.g. atom-family-clothing-co/DESIGNER_DESK_LOG.md
//        progress (HQ #46): [--stage queued|working|review|done|blocked] [--pct 0-100] [--steps "A|B|C"] [--now N|name]
//   node tools/work-live.mjs stage <bot> <stage> [pct] ["note"]  set the progress stage (note becomes an output line)
//   node tools/work-live.mjs next <bot>                         tick the current step done, move to the next (last -> review)
//   node tools/work-live.mjs log <bot> "output line"          append one line (keeps the last 12)
//   <cmd> | node tools/work-live.mjs pipe <bot>                 stream a command's output onto the monitor, line by line
//   node tools/work-live.mjs image <bot> <path>                 newest image (thumbnail on the monitor)
//   node tools/work-live.mjs clear <bot>                        drop that bot's live feed
//   node tools/work-live.mjs pick <bot> --id ID [--issue N] [--title T] --opt "H|Title|sub|/path.png"... [--sheet /path.jpg]
//        tap-to-pick cards on that bot's desk screen (HQ #50). Chris taps favorites + SUBMIT on the iPad; the bridge runs
//        `picked` below, comments the picks on HQ issue N, pings Slack. Until then the boards show WAITING ON YOU.
//   node tools/work-live.mjs picked <bot> <id> H,J               record picks (bridge): stage -> working, next step, log file updated
//   node tools/work-live.mjs unpick <bot>                       drop the pick cards
//   node tools/work-live.mjs waiting <bot> [who|off]            mark "waiting on Chris" (boards highlight it) without cards
//   node tools/work-live.mjs need add <id> --title T [--who W] [--do "what Chris should do"] [--bot B] [--issue N]
//        HQ #53 "Needs you": anything else waiting on Chris (approvals, logins, answers). One line in needs-chris.jsonl;
//        rides in this feed as `needs` and shows on Toby's Profile & Settings screen (+ the Team Board count). Feeds that
//        wait on Chris (waiting / open pick / review naming Chris) are listed there automatically, no `need` needed.
//   node tools/work-live.mjs need done <id>  |  need list       close one / show the open ones
//   node tools/work-live.mjs say <bot> "line"                  HQ #54: that teammate says this line in a speech bubble (in character,
//        written by the bot for a real event; shown once on each iPad if < 10 min old). Free: no AI call in the office.
//   node tools/work-live.mjs memory <bot>                       HQ #58: that bot's memory digest (what Chris said to it, mood, recent events)
//   node tools/work-live.mjs show                               print the bundle (no thumbnails)
//   node tools/work-live.mjs push [--force]                     publish now
//   node tools/work-live.mjs watch                              background publisher: checks every 4 s, pushes on change
//        (at most every 15 s), picks up new images in each bot's --dir (recursive), re-pushes every 2.5 h while fresh so the
//        relay copy never expires. Plain node, no AI calls. Started by tools/hq-inbox.sh bridge.
// Everything except push/watch only edits the local file; the running watcher publishes within ~15 s.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { seal } = await import(new URL('../hq-crypto.js', import.meta.url));

const RELAY = 'https://ntfy.sh', REPO = 'johnsonswork-star/grok-bot-hq-inbox';
const DIR = `${os.homedir()}/.config/grok-bot-hq`, WORK = `${DIR}/work`, THUMBS = `${WORK}/.thumbs`, DEVICES = `${DIR}/devices.json`;
const MAX_LINES = 12, MAX_IMAGES = 8, THUMBS_PER_BOT = 4, FRESH_MS = 6 * 3600e3, MIN_PUSH_MS = 15000, KEEPALIVE_MS = 2.5 * 3600e3;
const IMG = /\.(png|jpe?g|webp)$/i;
const STAGES = ['queued', 'working', 'review', 'done', 'blocked'];
// how long a feed stays on the monitor after its last update, by stage (review / queued wait on people, so they linger)
const FRESH_BY_STAGE = { queued: 48 * 3600e3, review: 48 * 3600e3, blocked: 24 * 3600e3, done: 3 * 3600e3 };
const freshMs = w => FRESH_BY_STAGE[w.stage] || FRESH_MS;
const log = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), ...a);
fs.mkdirSync(THUMBS, { recursive: true, mode: 0o700 });

// HQ #53: open "needs Chris" items. JSONL, newest line per id wins; { id, done: true } closes one.
// Legacy hq-watcher lines { ts, issue, ask, status } count too (id issue-N).
const NEEDS = `${DIR}/needs-chris.jsonl`;
const SAYS = `${DIR}/says.jsonl`; // HQ #54: { id, bot, text, at } lines for speech bubbles; last 10 min ride in the feed
function recentSays() { let t = ''; try { t = fs.readFileSync(SAYS, 'utf8'); } catch { return []; } return t.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(x => x && Date.now() - x.at < 10 * 60e3).slice(-8); }
function openNeeds() {
  const byId = new Map(); let txt = ''; try { txt = fs.readFileSync(NEEDS, 'utf8'); } catch { return []; }
  for (const l of txt.split('\n')) { let e; try { e = JSON.parse(l); } catch { continue; }
    const id = String(e.id || (e.issue ? 'issue-' + e.issue : '') || ''); if (!id) continue;
    if (e.done) { byId.delete(id); continue; }
    const prev = byId.get(id) || {}; byId.set(id, { ...prev, ...e, id, at: prev.at || Date.parse(e.at || e.ts) || Date.now() }); }
  return [...byId.values()].map(e => ({ id: e.id, title: clip(e.title || e.ask || 'Needs your call', 90), who: clip(e.who || (e.issue ? `HQ #${e.issue}` : ''), 40),
    do: clip(e.do || (e.issue ? `Answer in HQ chat (#${e.issue})` : ''), 120), bot: e.bot || '', issue: e.issue || null, at: e.at })).sort((a, b) => a.at - b.at).slice(0, 12);
}
// HQ #58: office events that involve a bot go into that bot's own memory (tools/worker-memory.mjs). Best effort.
const WM = await import(new URL('./worker-memory.mjs', import.meta.url)).catch(() => null);
const remember = (bot, text, o = {}) => { try { WM?.logEvent(bot, text, { src: 'work-live', ...o }); } catch {} };
const memSig = () => { try { return Math.max(0, ...fs.readdirSync(WM.MEM).map(f => fs.statSync(`${WM.MEM}/${f}`).mtimeMs)); } catch { return 0; } };
const fileOf = bot => `${WORK}/${String(bot).replace(/[^\w-]/g, '')}.json`;
const read = bot => { try { return JSON.parse(fs.readFileSync(fileOf(bot), 'utf8')); } catch { return {}; } };
const write = (bot, w) => {
  const was = read(bot); w.at = Date.now(); fs.writeFileSync(fileOf(bot), JSON.stringify(w, null, 1), { mode: 0o600 });
  // HQ #58: the bot remembers its own task moves (stage, new task, pick cards, waiting on Chris)
  const t = clip(w.task || was.task || 'my task', 80);
  if (w.task && w.task !== was.task) remember(bot, `New task: ${t}`);
  if (w.stage && w.stage !== was.stage) remember(bot, `${t}: ${was.stage ? was.stage + ' → ' : ''}${w.stage}${w.pct !== undefined ? ` (${w.pct}%)` : ''}`);
  if (w.pick && w.pick.id !== was.pick?.id) remember(bot, `Put up pick cards for Chris: ${clip(w.pick.title || w.pick.id, 60)} (${(w.pick.options || []).map(o => o.k).join(', ')})`, { issue: w.pick.issue || undefined });
  if (w.waiting && w.waiting !== was.waiting) remember(bot, `Waiting on ${w.waiting} for ${t}`);
};
const clip = (s, n = 160) => { s = String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+$/, ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const addLine = (w, l) => { w.lines = [...(w.lines || []), clip(l)].slice(-MAX_LINES); };
const pctOf = v => { const n = parseFloat(String(v).replace('%', '')); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined; };
function setStage(w, st) { st = String(st || '').toLowerCase().trim(); if (!STAGES.includes(st)) return false; if (w.stage !== st) { w.stage = st; w.stageAt = Date.now(); } if (st === 'done') { w.pct = 100; (w.steps || []).forEach(x => x.s = 'done'); } return true; }
function setSteps(w, list) { const names = String(list).split('|').map(x => x.trim()).filter(Boolean); const old = new Map((w.steps || []).map(x => [x.t, x.s])); w.steps = names.map(t => ({ t: clip(t, 60), s: old.get(clip(t, 60)) || 'todo' })); if (!w.steps.some(x => x.s !== 'todo')) setNow(w, 1); }
function setNow(w, n) { const st = w.steps || []; let i = /^\d+$/.test(String(n)) ? +n - 1 : st.findIndex(x => x.t.toLowerCase() === String(n).toLowerCase()); if (i < 0 || i >= st.length) return; st.forEach((x, k) => x.s = k < i ? 'done' : k === i ? 'now' : 'todo'); if (!w.stage || w.stage === 'queued') setStage(w, 'working'); }
// stage when nobody set one: guess from the step / status text so old feeds still read right
function inferStage(txt) { const t = String(txt || ''); if (/\b(blocked|stuck|waiting on|needs? (chris|you))\b/i.test(t)) return /review/i.test(t) ? 'review' : 'blocked'; if (/\b(review|awaiting|approve|check(ing)? with chris)/i.test(t)) return 'review'; if (/\b(queued|up next|not started|to do)\b/i.test(t)) return 'queued'; if (/\b(done|complete[d]?|finished|shipped|deployed)\b/i.test(t) && !/\d+\s*\/\s*\d+/.test(t)) return 'done'; return 'working'; }
const addImage = (w, p) => { p = path.resolve(p); w.images = [p, ...(w.images || []).filter(x => x !== p)].slice(0, MAX_IMAGES); };

function listImages(dir, out = [], depth = 0) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) listImages(p, out, depth + 1);
    else if (e.isFile() && IMG.test(e.name)) { try { out.push({ p, m: fs.statSync(p).mtimeMs }); } catch {} }
  }
  return out;
}
// new files in a bot's watched folder -> newest image + an output line
function scanDir(bot, w) {
  if (!w.watchDir) return false;
  const imgs = listImages(w.watchDir).sort((a, b) => b.m - a.m || a.p.localeCompare(b.p));
  const seen = w.dirSeen || 0, fresh = imgs.filter(x => x.m > seen).reverse();
  if (!fresh.length) return false;
  if (!w.dirSeen) { for (const x of imgs.slice(0, MAX_IMAGES).reverse()) addImage(w, x.p); } // first look: just the newest few
  else for (const x of fresh) { addImage(w, x.p); addLine(w, `new image: ${path.relative(w.watchDir, x.p)}`); }
  w.dirSeen = imgs[0].m; write(bot, w); return true;
}

// a bot's own progress log (markdown, e.g. Atom Family Designer's DESIGNER_DESK_LOG.md): on change, take
// "Current step:" -> step, "watching folder: <dir>" -> watchDir, and the bullets under "Last progress lines" -> output lines
function scanLog(bot, w) {
  if (!w.logFile) return false;
  let m; try { m = fs.statSync(w.logFile).mtimeMs; } catch { return false; }
  if (m === w.logSeen) return false;
  const txt = fs.readFileSync(w.logFile, 'utf8'), strip = x => x.replace(/\*\*/g, '').trim();
  const step = txt.match(/Current step:\**\s*(.+)/i); if (step) w.step = strip(step[1]);
  // HQ #46 progress: "**Stage:** working", "**Progress:** 40%" (or 3/5), and a "## Steps" checklist: - [x] done, - [>] now, - [ ] todo
  const stg = txt.match(/^\W*Stage:\**\s*([a-z]+)/im), status = txt.match(/^\W*Status:\**\s*(.+)/im);
  if (!(stg && setStage(w, stg[1]))) { const g = inferStage((status ? strip(status[1]) + ' ' : '') + (w.step || '')); if (g !== w.stage) { w.stage = g; w.stageAt = Date.now(); } w.stageGuess = true; } else delete w.stageGuess;
  const pr = txt.match(/^\W*Progress:\**\s*(\d+)\s*(%|\/\s*(\d+))/im);
  if (pr) w.pct = pr[3] ? pctOf(100 * pr[1] / pr[3]) : pctOf(pr[1]);
  const ss = txt.split(/^##\s*Steps.*$/im)[1];
  if (ss) { const st = []; for (const l of ss.split(/^##\s/m)[0].split('\n')) { const b = l.match(/^\s*[-*]\s+\[([ xX>~\-])\]\s+(.+)/); if (b) st.push({ t: clip(strip(b[2]), 60), s: /x/i.test(b[1]) ? 'done' : b[1] === ' ' ? 'todo' : 'now' }); } if (st.length) w.steps = st; }
  if (!pr && w.steps?.length) w.pct = pctOf(100 * w.steps.filter(x => x.s === 'done').length / w.steps.length);
  if (w.stage === 'done' || w.stage === 'review') { if (w.stage === 'done') w.pct = 100; (w.steps || []).forEach(x => { if (x.s === 'now' && w.stage === 'done') x.s = 'done'; }); }
  const dir = txt.match(/watching folder:\s*([^\s*]+)/i); if (dir && fs.existsSync(dir[1]) && path.resolve(dir[1]) !== w.watchDir) { w.watchDir = path.resolve(dir[1]); delete w.dirSeen; }
  const sec = txt.split(/^##\s*Last progress lines.*$/im)[1];
  if (sec) for (const l of sec.split(/^##\s/m)[0].split('\n')) { const b = l.match(/^\s*[-*]\s+(.+)/); if (b && !(w.lines || []).includes(clip(strip(b[1])))) addLine(w, strip(b[1])); }
  w.file = w.file || path.basename(w.logFile); w.logSeen = m; write(bot, w); return true;
}

// thumbnail: ~220 px JPEG on a backdrop that matches the ink (navy ink -> light shirt, cream ink -> navy shirt)
function thumb(p, size = 220) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  const key = `${THUMBS}/${Buffer.from(p).toString('base64url').slice(-80)}-${Math.round(st.mtimeMs)}${size === 220 ? '' : '-' + size}.jpg`;
  if (!fs.existsSync(key)) {
    const bg = /cream|white/i.test(path.basename(p)) ? '#1B2A4A' : '#F3EFE6';
    try {
      execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]); n = int(sys.argv[4]); im.thumbnail((n, n))
if im.mode in ('RGBA', 'LA', 'P'):
    im = im.convert('RGBA'); bg = Image.new('RGB', im.size, sys.argv[3]); bg.paste(im, mask=im.split()[-1]); im = bg
im.convert('RGB').save(sys.argv[2], 'JPEG', quality=68, optimize=True)`, p, key, bg, String(size)], { stdio: 'ignore', timeout: 30000 });
    } catch { return null; }
  }
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(key).toString('base64'); } catch { return null; }
}

function bundle(withThumbs = true) {
  const bots = {}; let files = []; try { files = fs.readdirSync(WORK).filter(f => f.endsWith('.json')); } catch {}
  for (const f of files) {
    const bot = f.slice(0, -5), w = read(bot); if (!w.at || Date.now() - w.at > freshMs(w)) continue;
    const imgs = (w.images || []).filter(p => fs.existsSync(p));
    const b = { step: clip(w.step || '', 90), file: clip(w.file || '', 90), lines: (w.lines || []).slice(-MAX_LINES), images: imgs.length, at: w.at };
    if (w.task) b.task = clip(w.task, 80);
    b.stage = STAGES.includes(w.stage) ? w.stage : inferStage(w.step); if (w.stageAt) b.stageAt = w.stageAt;
    if (w.pct !== undefined) b.pct = w.pct; else if (b.stage === 'done') b.pct = 100;
    if (w.steps?.length) b.steps = w.steps.slice(0, 12).map(x => ({ t: x.t, s: x.s }));
    if (w.pick?.options?.length) {
      const pk = w.pick; b.pick = { id: pk.id, issue: pk.issue || null, title: clip(pk.title || 'Pick your favorites', 80), multi: pk.multi !== false, done: !!pk.done, picked: pk.picked || [], pickedAt: pk.pickedAt || null,
        options: pk.options.map(o => ({ k: o.k, t: clip(o.t, 40), sub: clip(o.sub || '', 40), d: withThumbs ? thumb(o.p, 240) : null })) };
      if (pk.sheet && withThumbs) b.pick.sheet = thumb(pk.sheet, 420);
    }
    const wait = w.waiting || (w.pick && !w.pick.done ? 'Chris' : '') || ((b.stage === 'review' || b.stage === 'blocked') && /\b(chris|you)\b/i.test(w.step || '') ? 'Chris' : '');
    if (wait) b.waiting = wait;
    if (withThumbs) b.thumbs = imgs.slice(0, THUMBS_PER_BOT).map(p => ({ n: path.basename(p), d: thumb(p) })).filter(x => x.d);
    bots[bot] = b;
  }
  let mem = {}; try { mem = WM ? WM.moodFeed() : {}; } catch {}
  return { type: 'work', v: 1, at: Date.now(), bots, needs: openNeeds(), says: recentSays(), mem };
}

let devCache = null, devAt = 0;
function devices() {
  if (devCache && Date.now() - devAt < 30 * 60e3) return devCache;
  let known = {}; try { known = JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch {}
  try {
    const bodies = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', REPO, '--label', 'hq-chat', '--state', 'all', '--limit', '60', '--json', 'body'], { encoding: 'utf8', timeout: 30000 }));
    for (const { body } of bodies) {
      const mm = (body || '').match(/<!-- hq-meta (\{.*\}) -->/); if (!mm) continue;
      const d = JSON.parse(mm[1]).device; if (d?.id && d.topic && d.pub) known[d.id] = { topic: d.topic, pub: d.pub };
    }
    fs.writeFileSync(DEVICES, JSON.stringify(known), { mode: 0o600 });
  } catch (e) { log('device lookup via gh failed, using cache'); }
  devCache = known; devAt = Date.now(); return known;
}

async function push() {
  const feed = bundle(true), devs = devices();
  if (!Object.keys(devs).length) { log('no HQ devices known yet'); return false; }
  let ok = true;
  for (const [id, d] of Object.entries(devs)) {
    try {
      const body = JSON.stringify(await seal(feed, d.pub));
      const r = await fetch(`${RELAY}/${d.topic}_work`, { method: 'POST', body, headers: { Cache: 'yes' }, signal: AbortSignal.timeout(30000) });
      log(`work feed -> device ${id}: ${Object.keys(feed.bots).join(',') || '(none)'} ${Math.round(body.length / 1024)} KB -> ${r.status}`);
      ok &&= r.ok;
    } catch (e) { log('push error', id, e.message); ok = false; }
  }
  return ok;
}

function sig() {
  let files = []; try { files = fs.readdirSync(WORK).filter(f => f.endsWith('.json')); } catch {}
  let nm = 0; try { nm = fs.statSync(NEEDS).mtimeMs; } catch {}
  let sm = 0; try { sm = fs.statSync(SAYS).mtimeMs; } catch {}
  return files.map(f => { try { return f + ':' + fs.statSync(`${WORK}/${f}`).mtimeMs; } catch { return f; } }).join('|') + '|needs:' + nm + '|says:' + sm + '|mem:' + memSig();
}
async function watch() {
  log('work-live watcher up');
  let last = '', lastPush = 0;
  for (;;) {
    for (const f of fs.readdirSync(WORK).filter(f => f.endsWith('.json'))) { const bot = f.slice(0, -5); let w = read(bot); if (w.logFile && scanLog(bot, w)) w = read(bot); if (w.watchDir) scanDir(bot, w); }
    const s = sig(), b0 = bundle(false), fresh = Object.keys(b0.bots).length > 0 || b0.needs.length > 0;
    const due = (s !== last && Date.now() - lastPush >= MIN_PUSH_MS) || (fresh && Date.now() - lastPush > KEEPALIVE_MS);
    if (due) { if (await push()) { last = s; lastPush = Date.now(); } else lastPush = Date.now() - MIN_PUSH_MS + 60000; }
    await new Promise(r => setTimeout(r, 4000));
  }
}

const [cmd, bot, ...rest] = process.argv.slice(2);
if (cmd === 'set' && bot) {
  const w = read(bot);
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i], v = rest[i + 1];
    if (k === '--clear-lines') { w.lines = []; continue; }
    if (v === undefined) break; i++;
    if (k === '--stage') { if (!setStage(w, v)) console.error('stage must be one of ' + STAGES.join('|')); }
    else if (k === '--pct') w.pct = pctOf(v); else if (k === '--steps') setSteps(w, v); else if (k === '--now') setNow(w, v);
    else if (k === '--task') w.task = v; else if (k === '--step') w.step = v; else if (k === '--file') w.file = v;
    else if (k === '--line') addLine(w, v); else if (k === '--image') addImage(w, v);
    else if (k === '--dir') { w.watchDir = path.resolve(v); delete w.dirSeen; }
    else if (k === '--log-file') { w.logFile = path.resolve(v); delete w.logSeen; }
  }
  write(bot, w); if (w.logFile) scanLog(bot, read(bot)); if (read(bot).watchDir) scanDir(bot, read(bot)); console.log(bot, 'updated');
} else if (cmd === 'stage' && bot && rest[0]) {
  const w = read(bot); if (!setStage(w, rest[0])) { console.error('stage must be one of ' + STAGES.join('|')); process.exit(2); }
  if (rest[1] !== undefined && pctOf(rest[1]) !== undefined) w.pct = pctOf(rest[1]); const note = rest.find((x, i) => i && pctOf(x) === undefined);
  if (note) addLine(w, note); write(bot, w); console.log(bot, '->', w.stage, w.pct ?? '');
} else if (cmd === 'next' && bot) {
  const w = read(bot), st = w.steps || []; const i = st.findIndex(x => x.s === 'now');
  if (i >= 0) st[i].s = 'done'; const j = st.findIndex(x => x.s === 'todo');
  if (j >= 0) { st[j].s = 'now'; addLine(w, `step ${j + 1}/${st.length}: ${st[j].t}`); setStage(w, 'working'); } else { setStage(w, 'review'); addLine(w, 'all steps done → review'); }
  if (st.length) w.pct = pctOf(100 * st.filter(x => x.s === 'done').length / st.length); write(bot, w); console.log(bot, '->', w.stage, w.pct ?? '');
} else if (cmd === 'pick' && bot) {
  const w = read(bot), pk = { id: '', issue: null, title: '', multi: true, options: [], done: false, picked: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i], v = rest[i + 1]; if (v === undefined) break;
    if (k === '--id') pk.id = v; else if (k === '--issue') pk.issue = +v || null; else if (k === '--title') pk.title = v; else if (k === '--single') pk.multi = v !== '1';
    else if (k === '--sheet') { if (!fs.existsSync(v)) { console.error('missing sheet ' + v); process.exit(2); } pk.sheet = path.resolve(v); }
    else if (k === '--opt') { const [key, t, sub, p] = v.split('|'); if (!p || !fs.existsSync(p)) { console.error('missing image for ' + key + ': ' + p); process.exit(2); } pk.options.push({ k: key.trim().toUpperCase(), t, sub, p: path.resolve(p) }); }
  }
  if (!pk.id || !pk.options.length) { console.error('need --id and at least one --opt'); process.exit(2); }
  w.pick = pk; addLine(w, `${pk.options.length} options on the desk: tap your favorites (${pk.options.map(o => o.k).join(', ')})`); write(bot, w); console.log(bot, 'pick cards set', pk.options.map(o => o.k).join(','));
} else if (cmd === 'picked' && bot && rest[0] && rest[1]) {
  const w = read(bot); if (!w.pick || w.pick.id !== rest[0]) { console.error('no open pick ' + rest[0] + ' on ' + bot); process.exit(3); }
  const keys = new Set(w.pick.options.map(o => o.k)), picks = [...new Set(rest[1].split(',').map(x => x.trim().toUpperCase()))].filter(k => keys.has(k));
  if (!picks.length) { console.error('no valid picks'); process.exit(2); }
  Object.assign(w.pick, { done: true, picked: picks, pickedAt: Date.now() }); delete w.waiting;
  const names = picks.map(k => { const o = w.pick.options.find(x => x.k === k); return `${k} ${o.t}`; }).join(', ');
  const st = w.steps || []; const i = st.findIndex(x => x.s === 'now'); if (i >= 0) st[i].s = 'done'; const j = st.findIndex(x => x.s === 'todo'); if (j >= 0) st[j].s = 'now';
  if (st.length) w.pct = pctOf(100 * st.filter(x => x.s === 'done').length / st.length);
  setStage(w, 'working'); w.step = `Chris picked ${picks.join(', ')}: prepping them`; addLine(w, `✓ Chris picked ${names} (tapped on the desk)`);
  if (w.logFile && fs.existsSync(w.logFile)) { // the bot's own log drives the screen, so move it forward too (else scanLog snaps back to review)
    const now = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'medium' }) + ' CT';
    let t = fs.readFileSync(w.logFile, 'utf8');
    t = t.replace(/^(\W*Stage:\**\s*)[a-z]+/im, '$1working').replace(/^(\W*Current step:\**\s*).+$/im, `$1Chris picked ${picks.join(', ')} on the desk; prep chosen badges`)
         .replace(/^(\W*Status:\**\s*).+$/im, `$1Chris picked ${picks.join(', ')} (${now})`).replace(/^(\s*[-*]\s+\[)[>~\-](\])/m, '$1x$2').replace(/^(\s*[-*]\s+\[) (\])/m, '$1>$2');
    const sec = `\n## Chris's picks (tapped on the desk, ${now})\n${picks.map(k => { const o = w.pick.options.find(x => x.k === k); return `- **${k}** ${o.t}: ${o.p}`; }).join('\n')}\n`;
    t = /^## Last progress lines/m.test(t) ? t.replace(/^## Last progress lines.*$/m, m => sec.trimStart() + '\n' + m + `\n- ${now}: Chris picked ${picks.join(', ')} on the desk screen`) : t + sec;
    fs.writeFileSync(w.logFile, t); delete w.logSeen;
  }
  write(bot, w); console.log(bot, 'picked', picks.join(','));
} else if (cmd === 'unpick' && bot) { const w = read(bot); delete w.pick; write(bot, w); console.log(bot, 'pick cleared'); }
else if (cmd === 'waiting' && bot) { const w = read(bot); if (!rest[0] || rest[0] === 'off') delete w.waiting; else w.waiting = rest[0]; write(bot, w); console.log(bot, 'waiting', w.waiting || 'off'); }
else if (cmd === 'log' && bot) { const w = read(bot); for (const l of rest) addLine(w, l); write(bot, w); }
else if (cmd === 'image' && bot && rest[0]) { const w = read(bot); addImage(w, rest[0]); addLine(w, `new image: ${path.basename(rest[0])}`); write(bot, w); }
else if (cmd === 'pipe' && bot) {
  let buf = '', t = 0; const flush = () => { const w = read(bot); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.trim()) { addLine(w, l); process.stdout.write(l + '\n'); } write(bot, w); };
  process.stdin.on('data', d => { buf += d; if (!t) t = setTimeout(() => { t = 0; flush(); }, 700); });
  process.stdin.on('end', () => { buf += '\n'; flush(); });
} else if (cmd === 'clear' && bot) { try { fs.unlinkSync(fileOf(bot)); } catch {} console.log(bot, 'cleared'); }
else if (cmd === 'need') {
  const sub = bot, id = rest[0];
  if (sub === 'list') console.log(JSON.stringify(openNeeds(), null, 1));
  else if ((sub === 'add' || sub === 'done') && id) {
    const e = { id, at: new Date().toISOString() };
    if (sub === 'done') e.done = true;
    else for (let i = 1; i < rest.length; i += 2) { const k = rest[i].replace(/^--/, ''), v = rest[i + 1]; if (v === undefined) break; if (['title', 'who', 'do', 'bot'].includes(k)) e[k] = v; else if (k === 'issue') e.issue = +v || null; }
    if (sub === 'add' && !e.title) { console.error('need --title'); process.exit(2); }
    fs.appendFileSync(NEEDS, JSON.stringify(e) + '\n', { mode: 0o600 }); console.log('need', sub, id);
    const nb = e.bot || openNeeds().find(x => x.id === id)?.bot; if (nb && WM?.botId(nb)) remember(WM.botId(nb), sub === 'done' ? `Needs-you item cleared: ${id}` : `Asked Chris (Needs you): ${e.title}`, { issue: e.issue || undefined });
  } else { console.error('usage: need add <id> --title T [--who W] [--do D] [--bot B] [--issue N] | need done <id> | need list'); process.exit(2); }
}
else if (cmd === 'say' && bot && rest[0]) { const e = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), bot, text: clip(rest.join(' '), 200), at: Date.now() }; fs.appendFileSync(SAYS, JSON.stringify(e) + '\n', { mode: 0o600 }); remember(bot, `I said out loud: "${e.text}"`, { kind: 'note' }); console.log(bot, 'says:', e.text);
  try { const d = WM?.digest(bot, { json: true }); if (d) console.log(`memory: ${d.name} feels ${d.mood.label} toward Chris (${d.mood.rel}). ${d.feel}${d.mood.last ? ` Last pointed thing he said: "${d.mood.last.text}"` : ''}  (full: node tools/worker-memory.mjs digest ${bot})`); } catch {} }
else if (cmd === 'memory' && bot) console.log(WM ? WM.digest(bot) : 'worker-memory unavailable');
else if (cmd === 'show') console.log(JSON.stringify(bundle(rest.includes('--thumbs') || bot === '--thumbs'), null, 1));
else if (cmd === 'push') process.exit((await push()) ? 0 : 1);
else if (cmd === 'watch') await watch();
else console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 27).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
