#!/usr/bin/env node
// Live work on the desk monitors (HQ #31). Each bot's progress lives in ~/.config/grok-bot-hq/work/<botId>.json on this box:
//   { task, step, file, lines: [last output lines], images: [paths, newest first], watchDir, at }
// The publisher bundles every fresh bot (updated < 6 h), makes small JPEG thumbnails of the newest images, ENCRYPTS the
// bundle to each HQ device key and posts it to that device's private ntfy topic `<topic>_work` (same privacy model as the
// inbox / bank feeds: nothing goes in the public repo; big bundles ride as a ~3 h ntfy attachment, the iPad keeps its copy).
// A desk monitor shows the LIVE view only while that bot is busy in tasks.json (tools/set-busy.sh).
//
//   node tools/work-live.mjs set <bot> [--task T] [--step S] [--file F] [--line L]... [--image PATH]... [--dir DIR] [--log-file MD] [--clear-lines]
//        --dir: watch a folder (recursive) for new images. --log-file: follow a bot's markdown progress log (Current step:,
//        watching folder:, bullets under "## Last progress lines"), e.g. atom-family-clothing-co/DESIGNER_DESK_LOG.md
//   node tools/work-live.mjs log <bot> "output line"          append one line (keeps the last 12)
//   <cmd> | node tools/work-live.mjs pipe <bot>                 stream a command's output onto the monitor, line by line
//   node tools/work-live.mjs image <bot> <path>                 newest image (thumbnail on the monitor)
//   node tools/work-live.mjs clear <bot>                        drop that bot's live feed
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
const log = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), ...a);
fs.mkdirSync(THUMBS, { recursive: true, mode: 0o700 });

const fileOf = bot => `${WORK}/${String(bot).replace(/[^\w-]/g, '')}.json`;
const read = bot => { try { return JSON.parse(fs.readFileSync(fileOf(bot), 'utf8')); } catch { return {}; } };
const write = (bot, w) => { w.at = Date.now(); fs.writeFileSync(fileOf(bot), JSON.stringify(w, null, 1), { mode: 0o600 }); };
const clip = (s, n = 160) => { s = String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\s+$/, ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const addLine = (w, l) => { w.lines = [...(w.lines || []), clip(l)].slice(-MAX_LINES); };
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
  const dir = txt.match(/watching folder:\s*([^\s*]+)/i); if (dir && fs.existsSync(dir[1]) && path.resolve(dir[1]) !== w.watchDir) { w.watchDir = path.resolve(dir[1]); delete w.dirSeen; }
  const sec = txt.split(/^##\s*Last progress lines.*$/im)[1];
  if (sec) for (const l of sec.split(/^##\s/m)[0].split('\n')) { const b = l.match(/^\s*[-*]\s+(.+)/); if (b && !(w.lines || []).includes(clip(strip(b[1])))) addLine(w, strip(b[1])); }
  w.file = w.file || path.basename(w.logFile); w.logSeen = m; write(bot, w); return true;
}

// thumbnail: ~220 px JPEG on a backdrop that matches the ink (navy ink -> light shirt, cream ink -> navy shirt)
function thumb(p) {
  let st; try { st = fs.statSync(p); } catch { return null; }
  const key = `${THUMBS}/${Buffer.from(p).toString('base64url').slice(-80)}-${Math.round(st.mtimeMs)}.jpg`;
  if (!fs.existsSync(key)) {
    const bg = /cream|white/i.test(path.basename(p)) ? '#1B2A4A' : '#F3EFE6';
    try {
      execFileSync('python3', ['-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]); im.thumbnail((220, 220))
if im.mode in ('RGBA', 'LA', 'P'):
    im = im.convert('RGBA'); bg = Image.new('RGB', im.size, sys.argv[3]); bg.paste(im, mask=im.split()[-1]); im = bg
im.convert('RGB').save(sys.argv[2], 'JPEG', quality=68, optimize=True)`, p, key, bg], { stdio: 'ignore', timeout: 30000 });
    } catch { return null; }
  }
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(key).toString('base64'); } catch { return null; }
}

function bundle(withThumbs = true) {
  const bots = {}; let files = []; try { files = fs.readdirSync(WORK).filter(f => f.endsWith('.json')); } catch {}
  for (const f of files) {
    const bot = f.slice(0, -5), w = read(bot); if (!w.at || Date.now() - w.at > FRESH_MS) continue;
    const imgs = (w.images || []).filter(p => fs.existsSync(p));
    const b = { step: clip(w.step || '', 90), file: clip(w.file || '', 90), lines: (w.lines || []).slice(-MAX_LINES), images: imgs.length, at: w.at };
    if (w.task) b.task = clip(w.task, 80);
    if (withThumbs) b.thumbs = imgs.slice(0, THUMBS_PER_BOT).map(p => ({ n: path.basename(p), d: thumb(p) })).filter(x => x.d);
    bots[bot] = b;
  }
  return { type: 'work', v: 1, at: Date.now(), bots };
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
  return files.map(f => { try { return f + ':' + fs.statSync(`${WORK}/${f}`).mtimeMs; } catch { return f; } }).join('|');
}
async function watch() {
  log('work-live watcher up');
  let last = '', lastPush = 0;
  for (;;) {
    for (const f of fs.readdirSync(WORK).filter(f => f.endsWith('.json'))) { const bot = f.slice(0, -5); let w = read(bot); if (w.logFile && scanLog(bot, w)) w = read(bot); if (w.watchDir) scanDir(bot, w); }
    const s = sig(), fresh = Object.keys(bundle(false).bots).length > 0;
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
    if (k === '--task') w.task = v; else if (k === '--step') w.step = v; else if (k === '--file') w.file = v;
    else if (k === '--line') addLine(w, v); else if (k === '--image') addImage(w, v);
    else if (k === '--dir') { w.watchDir = path.resolve(v); delete w.dirSeen; }
    else if (k === '--log-file') { w.logFile = path.resolve(v); delete w.logSeen; }
  }
  write(bot, w); if (w.logFile) scanLog(bot, read(bot)); if (read(bot).watchDir) scanDir(bot, read(bot)); console.log(bot, 'updated');
} else if (cmd === 'log' && bot) { const w = read(bot); for (const l of rest) addLine(w, l); write(bot, w); }
else if (cmd === 'image' && bot && rest[0]) { const w = read(bot); addImage(w, rest[0]); addLine(w, `new image: ${path.basename(rest[0])}`); write(bot, w); }
else if (cmd === 'pipe' && bot) {
  let buf = '', t = 0; const flush = () => { const w = read(bot); const ls = buf.split('\n'); buf = ls.pop(); for (const l of ls) if (l.trim()) { addLine(w, l); process.stdout.write(l + '\n'); } write(bot, w); };
  process.stdin.on('data', d => { buf += d; if (!t) t = setTimeout(() => { t = 0; flush(); }, 700); });
  process.stdin.on('end', () => { buf += '\n'; flush(); });
} else if (cmd === 'clear' && bot) { try { fs.unlinkSync(fileOf(bot)); } catch {} console.log(bot, 'cleared'); }
else if (cmd === 'show') console.log(JSON.stringify(bundle(rest.includes('--thumbs') || bot === '--thumbs'), null, 1));
else if (cmd === 'push') process.exit((await push()) ? 0 : 1);
else if (cmd === 'watch') await watch();
else console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 21).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
