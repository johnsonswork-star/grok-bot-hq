#!/usr/bin/env node
// HQ #56 / #57: random in-character office banter, written by a FREE model, kept cheap.
// Every 3–6 min (randomized, hard floor 3 min between exchanges, persisted across restarts) this picks two IDLE teammates
// (not busy in tasks.json, no live "working" feed), preferring desk neighbours, and writes a 2–4 line exchange in their
// Office voices. Lines go into ~/.config/grok-bot-hq/says.jsonl (same file `work-live.mjs say` writes) tagged as one
// banter group, so the running work-feed publisher ships them to the iPad within ~15 s. talk.js walks the pair together
// and plays the lines as alternating speech bubbles.
//
// Provider (first that has a key in ~/.config/grok-bot-hq/llm.env or the environment):
//   1. OpenRouter FREE models only: OPENROUTER_API_KEY, model BANTER_MODEL (default "openrouter/free", then
//      "google/gemma-4-31b-it:free"). Any model id that is not ":free" / "openrouter/free" is refused.
//   2. Google Gemini Flash (free tier): GEMINI_API_KEY or GOOGLE_API_KEY, model GEMINI_MODEL (default gemini-flash-lite-latest).
//   3. No key: local template writer (free, offline). xAI / OpenAI / other paid keys are never read here.
// Chris's HQ messages NEVER pass through this script: it only reads tasks.json + the work feed and writes says.jsonl.
//
// Skips (no exchange, no model call): any open "Needs you" item, any open pick card (Chris mid-pick), fewer than 2 idle
// people, BANTER_OFF file present, quiet hours (BANTER_QUIET="23-7" style, optional), daily cap (BANTER_DAILY_MAX, default 120).
//
//   node tools/banter.mjs run            long-lived loop (tools/banter.sh start|stop|status|once uses this)
//   node tools/banter.mjs once [--force] one exchange now (--force ignores the 3-min floor + skips, still idle-only)
//   node tools/banter.mjs dry            print an exchange, write nothing
//   node tools/banter.mjs status         provider, last exchange, today's count
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const DIR = `${os.homedir()}/.config/grok-bot-hq`, SAYS = `${DIR}/says.jsonl`, LOG = `${DIR}/banter.log`, STATE = `${DIR}/banter-state.json`, OFF = `${DIR}/banter.off`;
const MIN_GAP = 3 * 60e3, MAX_GAP = 6 * 60e3, MAX_LINES = 4, LINE_MAX = 110;
const { STATIONS } = await import(new URL('../stations.js', import.meta.url));

// ---------- config / keys (only free providers are ever read) ----------
function loadEnv() {
  const env = {}; try { for (const l of fs.readFileSync(`${DIR}/llm.env`, 'utf8').split('\n')) { const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/); if (m) env[m[1]] = m[2]; } } catch {}
  const pick = k => process.env[k] || env[k] || '';
  return { orKey: pick('OPENROUTER_API_KEY'), orModel: pick('BANTER_MODEL'), gemKey: pick('GEMINI_API_KEY') || pick('GOOGLE_API_KEY'), gemModel: pick('GEMINI_MODEL') || 'gemini-flash-lite-latest',
    quiet: pick('BANTER_QUIET'), dailyMax: +pick('BANTER_DAILY_MAX') || 120 };
}
const cfg = loadEnv();
const provider = () => cfg.orKey ? 'openrouter' : cfg.gemKey ? 'gemini' : 'local';
const isFree = m => m === 'openrouter/free' || /:free$/.test(m);

const log = (...a) => { const l = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT ' + a.join(' '); try { fs.appendFileSync(LOG, l + '\n', { mode: 0o600 }); } catch {} console.log(l); };
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const state = () => readJSON(STATE, { last: 0, day: '', count: 0, calls: 0 });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

// ---------- who's free right now ----------
function feed() { try { return JSON.parse(execFileSync(process.execPath, ['--no-warnings', `${HERE}/work-live.mjs`, 'show'], { encoding: 'utf8', timeout: 20000 })); } catch { return { bots: {}, needs: [] }; } }
function idleCast(f) {
  const busy = readJSON(`${ROOT}/tasks.json`, {}).busy || {}, now = Date.now();
  const isBusy = id => { const e = busy[id]; if (!e) return false; if (typeof e === 'object') return e.busy !== false && !(e.until && Date.parse(e.until) < now); return !!e; };
  return STATIONS.filter(s => !isBusy(s.id) && !['working', 'review'].includes(f.bots?.[s.id]?.stage) && !f.bots?.[s.id]?.pick);
}
function blockers(f) {
  const why = [];
  if ((f.needs || []).length) why.push(`needs-you open (${f.needs.length})`);
  for (const [id, b] of Object.entries(f.bots || {})) { if (b.pick && !b.done && !b.pick.done) why.push(`pick open on ${id}`); if (b.waiting) why.push(`${id} waiting on Chris`); }
  if (fs.existsSync(OFF)) why.push('banter.off present');
  if (cfg.quiet) { const [a, b] = cfg.quiet.split('-').map(Number), h = +new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }) % 24;
    if (a > b ? (h >= a || h < b) : (h >= a && h < b)) why.push(`quiet hours ${cfg.quiet}`); }
  return why;
}
function pickPair(cast) {
  if (cast.length < 2) return null;
  const a = cast[(Math.random() * cast.length) | 0];
  // prefer someone close by (desk neighbours / same area), with a little randomness
  const others = cast.filter(s => s !== a).map(s => ({ s, d: Math.hypot(s.x - a.x, s.z - a.z) + Math.random() * 6 })).sort((x, y) => x.d - y.d);
  return [a, others[0].s];
}

// ---------- writers ----------
const BIO = {
  grok: 'Michael Scott: needy, attention-seeking boss, bad jokes, "that\'s what she said", wants to be loved.',
  inbox: 'Pam Beesly: kind receptionist, dry gentle humor, art, pranks with Jim.',
  cos: 'Jim Halpert: deadpan, sarcastic, pranks Dwight, looks at the camera.',
  assist: 'Dwight Schrute: intense, beet farmer, survivalist, "Assistant to the Regional Manager", facts, "False."',
  icons: 'Andy Bernard: Cornell, a cappella, nicknames (Nard Dog), eager to please, sings.',
  onpad: 'Phyllis Vance: sweet but sneaky, Bob Vance Vance Refrigeration, knitting.',
  builder: 'Stanley Hudson: grumpy, wants to be left alone, crosswords, pretzel day, retirement.',
  faith: 'Angela Martin: uptight, judgmental, cats, rules, disapproves of everyone.',
  broker: 'Oscar Martinez: smart, "actually...", corrects people, cultured.',
  conn: 'Kevin Malone: slow, food-obsessed, M&Ms, chili, short words.',
  review: 'Creed Bratton: bizarre, shady past, non-sequiturs, unclear what he does.',
  kids: 'Meredith Palmer: party girl, oversharing, happy hour.',
  designer: 'Kelly Kapoor: fast-talking, gossip, pop culture, Ryan drama, dramatic.',
  profile: 'Toby Flenderson: sad HR guy, Michael hates him, Costa Rica, apologetic.',
};
const first = s => s.name.split(' ')[0];

function prompt(a, b, n) {
  const topics = ['the water cooler', 'lunch', 'the weekend', 'a meeting that could have been an email', 'the copier', 'the parking lot', 'someone\'s birthday cake', 'the thermostat', 'a prank', 'the vending machine', 'Michael\'s latest idea', 'paper sales', 'the break room fridge'];
  const topic = topics[(Math.random() * topics.length) | 0];
  return `Write a short, PG, light-hearted ${n}-line exchange between two Dunder Mifflin Scranton coworkers (The Office, US) chatting at the office, starting with ${first(a)}. Topic: ${topic}.
${BIO[a.id]}
${BIO[b.id]}
Rules: lines alternate speakers starting with ${first(a)}; each line under 15 words, in character, funny but kind; no real people outside the show, no mention of Chris, AI, bots, or customers' private info.
Reply ONLY with JSON: [{"who":"${a.id}","text":"..."},{"who":"${b.id}","text":"..."}...]`;
}
function parseLines(txt, a, b, n) {
  const m = String(txt).match(/\[[\s\S]*\]/); if (!m) throw new Error('no JSON in reply');
  const arr = JSON.parse(m[0]); const ids = [a.id, b.id];
  const out = arr.slice(0, n).map((x, i) => ({ who: ids[i % 2], text: String(x.text || '').replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim().slice(0, LINE_MAX) })).filter(x => x.text);
  if (out.length < 2) throw new Error('too few lines'); return out;
}
async function viaOpenRouter(a, b, n) {
  const models = [...new Set([cfg.orModel || 'openrouter/free', 'google/gemma-4-31b-it:free', 'openrouter/free'])].filter(isFree);
  if (cfg.orModel && !isFree(cfg.orModel)) log(`refusing non-free BANTER_MODEL ${cfg.orModel}`);
  let err;
  for (const model of models) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(40000),
        headers: { Authorization: `Bearer ${cfg.orKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://johnsonswork-star.github.io/grok-bot-hq/', 'X-Title': 'Bot Office banter' },
        body: JSON.stringify({ model, max_tokens: 300, temperature: 1, messages: [{ role: 'user', content: prompt(a, b, n) }] }) });
      if (!r.ok) throw new Error(`${model} HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
      const j = await r.json(); return { lines: parseLines(j.choices?.[0]?.message?.content || '', a, b, n), via: `openrouter:${j.model || model}` };
    } catch (e) { err = e; log('openrouter fail:', e.message); }
  }
  throw err;
}
async function viaGemini(a, b, n) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.gemModel}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(40000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.gemKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt(a, b, n) }] }], generationConfig: { maxOutputTokens: 300, temperature: 1 } }) });
  if (!r.ok) throw new Error(`gemini HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = await r.json(); return { lines: parseLines(j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '', a, b, n), via: `gemini:${cfg.gemModel}` };
}

// local fallback: per-character openers / replies / closers + a few hand-written pair scenes. Free, offline.
const L = {
  grok: { o: ['{B}! My favorite employee. Top three. Top five.', 'Who wants to hear about my idea for a mandatory fun day?', 'Quick question, {B}. Am I the coolest boss you\'ve ever had?'], r: ['That\'s what she said.', 'I am going to pretend I understood that.', 'Wow. Okay. Noted. Emotionally.'], c: ['Great talk. Let\'s hug it out.', 'I\'m putting this in my memoir.'] },
  inbox: { o: ['Hey {B}, did you see the new sign by the copier?', '{B}, want to help me with a tiny harmless prank?', 'Somebody left cake in the break room. Just saying.'], r: ['Ha. Yeah, that sounds about right.', 'Oh no. Okay, I\'m not looking.', 'I mean... I won\'t tell anyone.'], c: ['Okay, back to the phones.', 'This is going in my sketchbook.'] },
  cos: { o: ['{B}, quick poll: is today a jelly day or a no-jelly day?', 'I think Dwight\'s been eating his own beets again.', 'So, {B}, how\'s the "big project" going?'], r: ['Yep. That tracks.', 'Wow. Big if true.', 'I\'m going to need a minute with the camera.'], c: ['Great talk. Real productive.', 'Anyway. Back to "work."'] },
  assist: { o: ['{B}. Have you secured your workstation today? I have.', 'Question. What is the best beet? Wrong. Trick question.', 'Fact: the water cooler is a hunting ground.'], r: ['False.', 'Identity theft is not a joke, {A}.', 'That is the most reasonable thing you\'ve ever said. Still wrong.'], c: ['Dismissed.', 'This conversation is now classified.'] },
  icons: { o: ['{B}! Nard Dog here. Who\'s up for a little harmony?', 'Did I ever mention I went to Cornell, {B}?', 'Rit-dit-dit-doo! Morning, {B}!'], r: ['Big Tuna would love that.', 'That is SO Cornell of you.', 'Ha! Classic. Classic you.'], c: ['I\'ll be in the stairwell, practicing.', 'Rock on. Nard Dog out.'] },
  onpad: { o: ['{B}, Bob says the new fridge line is very energy efficient.', 'I\'m knitting you a scarf, {B}. Don\'t ask what color.', 'Did anyone else hear about Angela\'s cat drama?'], r: ['Oh, that\'s nice, dear.', 'Bob Vance would never.', 'Hmm. Interesting.'], c: ['Well, I\'ll let you get back to it.', 'I\'m telling Bob about this.'] },
  builder: { o: ['{B}. Is it pretzel day? Don\'t lie to me.', 'Seven letters, "leave me alone." Anyone?'], r: ['Did I stutter?', 'Mm-hmm.', 'I\'m doing my crossword.', 'I don\'t care.'], c: ['We\'re done here.', 'Wake me when it\'s five.'] },
  faith: { o: ['{B}, someone microwaved fish again. I have a list.', 'I\'m starting a committee to plan the committee.', 'Sprinkles would never have stood for this, {B}.'], r: ['That is disgusting.', 'I don\'t approve.', 'Noted. Judged. Filed.'], c: ['I need to go spritz my desk.', 'This conversation is over.'] },
  broker: { o: ['Actually, {B}, the thermostat isn\'t broken. Michael taped it.', 'Has anyone read the new expense policy? No? Of course not.', '{B}, that\'s not how interest works.'], r: ['Actually, that\'s not quite right.', 'I can\'t believe I have to explain this.', 'Fair. Surprisingly fair.'], c: ['I\'m going back to the spreadsheet.', 'Okay, let\'s never do this again.'] },
  conn: { o: ['{B}. Snack?', 'I brought chili. Some of it.', '{B}, why is the vending machine out of M&Ms?'], r: ['Nice.', 'Me no understand. But okay.', 'Is there food involved?', 'Cookie.'], c: ['I go now. Snack.', 'Okay. Bye. Snack.'] },
  review: { o: ['{B}, if anyone asks, I was here all day.', 'I sprout mung beans on a damp paper towel in my desk drawer.', 'Which one are you again?'], r: ['Interesting. I\'ve been to Canada for less.', 'I\'ve been involved in a number of cults.', 'Cool. I\'m Creed.'], c: ['I need to go check on my, uh, paperwork.', 'Don\'t tell the cops.'] },
  kids: { o: ['{B}! Happy hour tonight? Kidding. Unless...', 'Guess who got banned from another Chili\'s.', '{B}, is there wine in the break room fridge?'], r: ['Ha! I\'ve done worse.', 'Count me in.', 'Same, honestly.'], c: ['Okay, I\'m going to go "file" something.', 'Text me later.'] },
  designer: { o: ['{B}! Oh my God, I have SO much gossip.', 'Okay, {B}, who wore it better: me or literally anyone?', 'Has anyone seen Ryan? Not that I care. I care.'], r: ['OMG, stop. Stop. Keep going.', 'That is SO not okay. I love it.', 'Literally same.'], c: ['Okay, I have to go, I have, like, a million things.', 'Ugh, love this. Bye!'] },
  profile: { o: ['Hey {B}. Sorry. Do you have a sec? No? That\'s fine.', 'Just a reminder about the new break room policy. Sorry.', 'I\'m thinking about Costa Rica again, {B}.'], r: ['Oh. Okay. That\'s fine.', 'I\'ll... make a note of that.', 'Sorry. Go ahead.'], c: ['I\'ll just be in the annex.', 'Okay. Sorry. Bye.'] },
};
const SCENES = [
  [['cos', 'assist'], ['Dwight, your stapler looks lonely. Want me to find it some Jell-O?', 'Touch my stapler and you will lose a finger.', 'Which one?', 'False. All of them.']],
  [['faith', 'broker'], ['Oscar, did you approve this receipt? It has a smiley face on it.', 'Actually, it\'s a valid receipt, Angela.', 'It is smirking at me.']],
  [['conn', 'faith'], ['Angela, can I have your granola bar?', 'Absolutely not, Kevin.', 'Half?', 'Kevin.']],
  [['designer', 'inbox'], ['Pam, OMG, I have the BIGGEST news.', 'Is it about Ryan again?', 'How did you KNOW?']],
  [['builder', 'onpad'], ['Phyllis, is it pretzel day?', 'Not until next week, Stanley.', 'Then I am not here.']],
  [['icons', 'review'], ['Creed, my man! Want to join my a cappella group?', 'I was in a band. The Grass Roots.', 'Wait, really?', 'Don\'t look it up.']],
  [['profile', 'kids'], ['Meredith, HR needs you to stop bringing wine to work.', 'It\'s a fruit drink, Toby.', 'It says Merlot.', 'Fruit drink.']],
  [['assist', 'conn'], ['Kevin, what is your plan if a bear enters the break room?', 'Share my chili?', 'Wrong. Bears hate chili.']],
];
function viaLocal(a, b, n) {
  const sc = SCENES.find(([p]) => (p[0] === a.id && p[1] === b.id) || (p[0] === b.id && p[1] === a.id));
  if (sc && Math.random() < 0.6) { const [p, ls] = sc; const ids = p; return { lines: ls.slice(0, n).map((t, i) => ({ who: ids[i % 2], text: t })), via: 'local:scene' }; }
  const r = arr => arr[(Math.random() * arr.length) | 0], fill = t => t.replace(/\{B\}/g, first(b)).replace(/\{A\}/g, first(a));
  const lines = [{ who: a.id, text: fill(r(L[a.id]?.o || ['Hey {B}.'])) }, { who: b.id, text: fill(r(L[b.id]?.r || ['Ha.'])).replace(/\{A\}/g, first(a)) }];
  if (n >= 3) lines.push({ who: a.id, text: fill(r(L[a.id]?.c || ['Okay.'])) });
  if (n >= 4) lines.push({ who: b.id, text: fill(r(L[b.id]?.c || ['Bye.'])) });
  return { lines, via: 'local:templates' };
}
async function write(a, b) {
  const n = 2 + ((Math.random() * (MAX_LINES - 1)) | 0); // 2–4 lines
  const p = provider();
  if (p !== 'local') {
    try { return p === 'openrouter' ? await viaOpenRouter(a, b, n) : await viaGemini(a, b, n); }
    catch (e) { log(`${p} failed, using local lines:`, e.message); }
  }
  return viaLocal(a, b, n);
}

// ---------- one exchange ----------
async function once({ force = false, dry = false } = {}) {
  const s = state(); if (s.day !== today()) { s.day = today(); s.count = 0; s.calls = 0; }
  if (!force && Date.now() - s.last < MIN_GAP) return log('skip: under 3-min floor');
  if (!force && s.count >= cfg.dailyMax) return log(`skip: daily cap ${cfg.dailyMax}`);
  const f = feed(), why = blockers(f);
  if (why.length && !force) return log('skip:', why.join('; '));
  const pair = pickPair(idleCast(f)); if (!pair) return log('skip: fewer than 2 idle teammates');
  const [a, b] = pair, { lines, via } = await write(a, b);
  if (dry) { console.log(via); for (const l of lines) console.log(`${l.who}: ${l.text}`); return; }
  const gid = 'b' + Date.now().toString(36), at = Date.now();
  const out = lines.map((l, i) => ({ id: `${gid}-${i}`, bot: l.who, text: l.text, at: at + i, banter: gid, with: l.who === a.id ? b.id : a.id, n: i, of: lines.length }));
  fs.appendFileSync(SAYS, out.map(e => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  s.last = Date.now(); s.count++; if (!via.startsWith('local')) s.calls++; s.lastVia = via; s.lastPair = `${a.id}+${b.id}`;
  fs.writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 });
  log(`banter ${gid} ${first(a)} + ${first(b)} via ${via}: ` + lines.map(l => `${l.who}: ${l.text}`).join(' | '));
}

const cmd = process.argv[2];
if (cmd === 'run') {
  log(`banter loop start (pid ${process.pid}, provider ${provider()})`);
  fs.writeFileSync(`${DIR}/banter.pid`, String(process.pid));
  const stop = () => { log('banter loop stop'); try { fs.unlinkSync(`${DIR}/banter.pid`); } catch {} process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  const tick = async () => { try { await once(); } catch (e) { log('error:', e.message); } setTimeout(tick, MIN_GAP + Math.random() * (MAX_GAP - MIN_GAP)); };
  setTimeout(tick, 60e3 + Math.random() * 60e3); // short settle after (re)start
} else if (cmd === 'once') await once({ force: process.argv.includes('--force') });
else if (cmd === 'dry') await once({ force: true, dry: true });
else if (cmd === 'status') { const s = state(); console.log(JSON.stringify({ provider: provider(), ...s, lastAt: s.last ? new Date(s.last).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT' : null, blockers: blockers(feed()) }, null, 1)); }
else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
