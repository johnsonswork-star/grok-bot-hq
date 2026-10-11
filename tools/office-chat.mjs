#!/usr/bin/env node
// HQ #59: ONE office chat. Every message Chris sends from the HQ chat lands here first (tools/hq-bridge.mjs calls ingest()).
// Triage (shared rules in ../office-chat-rules.js, same file the iPad uses):
//   office route  = small talk / banter / safe in-game commands ("Phyllis, get out of the way") -> answered here by the
//                   cheap office bot: built-in in-character lines, or a FREE model for small talk (OpenRouter :free or
//                   Gemini Flash free tier, same keys as banter in ~/.config/grok-bot-hq/llm.env). No GitHub issue, no Slack
//                   wake, no AI allowance. The commands themselves already ran on the iPad the moment Chris hit send.
//   grok route    = real orders / decisions / questions about real stuff / anything unclear -> returned to the bridge, which
//                   files the HQ issue + Slack #hq-chat wake exactly as before. The real Grok Bot (Michael) handles it.
// Everything (Chris's messages from any device, office-bot replies, Grok Bot replies, teammates' says + banter) goes into
// ~/.config/grok-bot-hq/office-chat.jsonl, and a publisher (started inside the bridge) pushes the newest 120 lines,
// encrypted per HQ device, to `<device topic>_chat` on ntfy (same privacy model as the work / inbox feeds).
//
//   node tools/office-chat.mjs test "text" [--to "Icon Shop"] [--near onpad]   dry run: triage + the reply it would give
//   node tools/office-chat.mjs show [n]        last n lines of the unified log (default 30)
//   node tools/office-chat.mjs push            publish the feed now
//   node tools/office-chat.mjs publisher       run the publisher alone (normally runs inside hq-bridge.mjs watch)
import fs from 'node:fs';
import os from 'node:os';
const { seal } = await import(new URL('../hq-crypto.js', import.meta.url));
const R = await import(new URL('../office-chat-rules.js', import.meta.url));
const { STATIONS } = await import(new URL('../stations.js', import.meta.url));

const RELAY = 'https://ntfy.sh', DIR = `${os.homedir()}/.config/grok-bot-hq`;
export const LOG = `${DIR}/office-chat.jsonl`;
const SAYS = `${DIR}/says.jsonl`, DEVICES = `${DIR}/devices.json`, KEEP_MS = 48 * 3600e3, FEED_MAX = 120;
let say = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), '[office-chat]', ...a);
const clip = (s, n = 400) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const st = id => STATIONS.find(s => s.id === id);
const readLines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
export function append(e) {
  const all = readLines(LOG); if (e.id && all.some(x => x.id === e.id)) return false;
  fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(e) + '\n', { mode: 0o600 });
  if (all.length > 2000) fs.writeFileSync(LOG, all.slice(-1500).concat(e).map(x => JSON.stringify(x)).join('\n') + '\n', { mode: 0o600 }); // trim
  return true;
}
export const who = id => { const s = st(id); return s ? { who: id, name: s.name, bot: s.bot } : { who: 'grok', name: 'Michael Scott', bot: 'Grok Bot' }; };

// ---------- cheap writer for small talk: FREE models only, else the built-in lines ----------
function env() {
  const e = {}; try { for (const l of fs.readFileSync(`${DIR}/llm.env`, 'utf8').split('\n')) { const m = l.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/); if (m) e[m[1]] = m[2]; } } catch {}
  const g = k => process.env[k] || e[k] || '';
  return { orKey: g('OPENROUTER_API_KEY'), orModel: g('OFFICE_MODEL') || g('BANTER_MODEL'), gemKey: g('GEMINI_API_KEY') || g('GOOGLE_API_KEY'), gemModel: g('GEMINI_MODEL') || 'gemini-flash-lite-latest' };
}
const isFree = m => m === 'openrouter/free' || /:free$/.test(m);
export const BIO = { grok: 'Michael Scott, needy goofy boss', inbox: 'Pam Beesly, kind receptionist', cos: 'Jim Halpert, deadpan prankster', assist: 'Dwight Schrute, intense beet farmer',
  icons: 'Andy Bernard, eager Cornell a cappella guy', onpad: 'Phyllis Vance, sweet, Bob Vance\'s wife', builder: 'Stanley Hudson, grumpy, crosswords', faith: 'Angela Martin, uptight cat lady',
  broker: 'Oscar Martinez, smart, "actually"', conn: 'Kevin Malone, slow, loves food', review: 'Creed Bratton, bizarre shady past', kids: 'Meredith Palmer, party girl',
  designer: 'Kelly Kapoor, fast-talking gossip', profile: 'Toby Flenderson, sad apologetic HR guy' };
// HQ #64/#66: hard rate limit on the free model (shared by office chat + Direct stand-ins). Over the limit -> built-in lines.
// GitHub Models was checked first (Chris asked for it) but GitHub retired it on Jul 30 2026 (inference API + catalog gone;
// from this box models.github.ai only answers a stub "OK"), so the free providers stay OpenRouter :free / Gemini free tier.
const RATE = `${DIR}/free-llm-rate.json`, PER_MIN = +(process.env.FREE_LLM_PER_MIN || 6), PER_DAY = +(process.env.FREE_LLM_PER_DAY || 150);
function takeSlot() {
  const now = Date.now(), day = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  let r = {}; try { r = JSON.parse(fs.readFileSync(RATE, 'utf8')); } catch {}
  if (r.day !== day) r = { day, n: 0, recent: [] };
  r.recent = (r.recent || []).filter(t => now - t < 60e3);
  if (r.n >= PER_DAY || r.recent.length >= PER_MIN) return false;
  r.n++; r.recent.push(now); try { fs.writeFileSync(RATE, JSON.stringify(r), { mode: 0o600 }); } catch {}
  return true;
}
export async function freeLine(bot, text, ctx = '') {
  const c = env(); if (!c.orKey && !c.gemKey) return null;
  if (!takeSlot()) { say('free model rate limit hit -> built-in line'); return null; }
  const prompt = `You are ${BIO[bot] || BIO.inbox} from The Office (US), working at a cozy virtual Dunder Mifflin office.${st(bot)?.bot ? ` Your desk here is ${st(bot).bot}: ${st(bot).role}` : ''} Your boss's boss Chris (the owner) just said in the office chat: "${clip(text, 200)}". ` +
    `Reply with ONE short, friendly, PG, in-character line (under 22 words). Do not promise to do any real work, send anything, or make decisions; that is Michael's job. Reply with the line only.` + (ctx ? `\n${ctx}` : '');
  try {
    if (c.orKey) {
      for (const model of [...new Set([c.orModel, 'openrouter/free', 'google/gemma-4-31b-it:free'])].filter(m => m && isFree(m))) {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(12000),
          headers: { Authorization: `Bearer ${c.orKey}`, 'Content-Type': 'application/json', 'X-Title': 'Bot Office chat' },
          body: JSON.stringify({ model, max_tokens: 80, temperature: 0.9, messages: [{ role: 'user', content: prompt }] }) }).catch(() => null);
        if (!r?.ok) continue; const j = await r.json(); const t = clip(j.choices?.[0]?.message?.content || '', 160).replace(/^["']|["']$/g, ''); if (t) return { text: t, via: 'openrouter-free' };
      }
    }
    if (c.gemKey) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${c.gemModel}:generateContent`, { method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.gemKey }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 80, temperature: 0.9 } }) });
      if (r.ok) { const j = await r.json(); const t = clip(j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '', 160).replace(/^["']|["']$/g, ''); if (t) return { text: t, via: 'gemini-free' }; }
    }
  } catch (e) { say('free model failed', e.message); }
  return null;
}

// the office bot's answer(s) for an office-route message
export async function reply(text, tri, p = {}) {
  const seed = Date.now();
  if (tri.kind === 'cmd') {
    const out = [], seen = new Set(), line0 = typeof p.office?.line === 'string' && p.office.line.length < 200 ? clip(p.office.line, 180) : '';
    for (const c of tri.cmds) { if (seen.has(c.bot)) continue; seen.add(c.bot); if (out.length >= 3) break;
      out.push({ bot: c.bot, text: !out.length && line0 && p.office?.bot === c.bot ? line0 : R.cmdLine(c.bot, c.act, seed + out.length * 7), via: 'built-in' }); }
    if (tri.cmds.length > 3) out.push({ bot: 'inbox', text: `Okay, everyone's on it (${R.ACTS[tri.cmds[0].act]?.label || tri.cmds[0].act}).`, via: 'built-in' });
    return out;
  }
  const bot = tri.speaker || 'inbox', f = await freeLine(bot, text);
  return [{ bot, text: f?.text || R.casualLine(bot, text, seed), via: f?.via || 'built-in' }];
}

export async function toDevice(d, msg) {
  if (!d?.topic || !d?.pub) return false;
  try { const r = await fetch(`${RELAY}/${d.topic}`, { method: 'POST', body: JSON.stringify(await seal(msg, d.pub)), signal: AbortSignal.timeout(10000) }); return r.ok; } catch { return false; }
}

// Called by the bridge for every chat message. Returns { handled: true } when the office bot took it,
// else { handled: false, tri } and the bridge files it for the real Grok Bot.
export async function ingest(p, { log } = {}) {
  if (log) say = log;
  const text = String(p.text || ''), to = String(p.to || R.OFFICE_TO);
  const tri = R.triage(text, { to, near: p.office?.near || null });
  const at = Date.parse(p.ts) || Date.now();
  if (tri.route !== 'office') return { handled: false, tri };
  append({ id: 'c-' + p.mid, mid: p.mid, kind: 'chris', who: 'chris', name: 'Chris', text: clip(text, 600), to, route: 'office', why: tri.why, at, device: p.device?.id });
  await toDevice(p.device, { type: 'ack', id: 'ack-' + p.mid, mid: p.mid, issue: null, route: 'office', why: tri.why, at: new Date().toISOString() });
  const lines = await reply(text, tri, p);
  let i = 0;
  for (const l of lines) {
    const w = who(l.bot), id = `oc-${p.mid}${i ? '-' + i : ''}`; i++;
    const e = { id, kind: 'reply', ...w, text: l.text, at: Date.now(), route: 'office', via: l.via, re: p.mid, cmds: tri.cmds.filter(c => c.bot === l.bot).map(c => c.act) };
    append(e);
    await toDevice(p.device, { id, ref: null, from: w.name, text: l.text, at: new Date(e.at).toISOString(), office: true, via: l.via });
  }
  // HQ #58 worker memory (best effort)
  try { const W = await import(new URL('./worker-memory.mjs', import.meta.url));
    W.logHq({ issue: null, to: st(tri.speaker)?.bot || to, text, at: p.ts, src: 'office-chat' });
    for (const c of tri.cmds.slice(0, 14)) W.logEvent(c.bot, `Chris told me to ${R.ACTS[c.act]?.label || c.act} (office chat), and I did.`, { src: 'office-chat' });
  } catch {}
  say(`office route (${tri.why}): "${clip(text, 80)}" -> ${lines.map(l => `${l.bot}: ${clip(l.text, 60)} [${l.via}]`).join(' | ')}`);
  bump();
  return { handled: true, tri, lines };
}
// grok route: the bridge filed issue #n; note it in the shared log (Chris's line + "Michael is on it")
export function noteGrok(p, issue, tri) {
  const at = Date.parse(p.ts) || Date.now();
  append({ id: 'c-' + p.mid, mid: p.mid, kind: 'chris', who: 'chris', name: 'Chris', text: clip(p.text, 600), to: p.to || R.OFFICE_TO, route: 'grok', why: tri?.why || '', issue, at, device: p.device?.id });
  append({ id: 'g-' + p.mid, kind: 'route', who: 'grok', name: 'Michael Scott', bot: 'Grok Bot', text: `On it (HQ #${issue}). ${tri?.cmds?.length ? 'Moves are done in the office; the' : 'The'} real Grok Bot has this one.`, issue, at: at + 1 });
  bump();
}
// a real reply (issue comment relayed to the iPad) also goes into the shared log
export function noteReply({ id, issue, from, text, at }) {
  const w = who(R.idOf(from) || 'grok');
  if (append({ id: String(id), kind: 'reply', ...w, name: R.idOf(from) ? w.name : (from || 'Grok Bot'), text: clip(text, 1200), issue, route: 'grok', at: Date.parse(at) || Date.now() })) bump();
}

// ---------- publisher: newest lines -> each device's `<topic>_chat` (encrypted) ----------
let dirty = true; export const bump = () => { dirty = true; };
function bundle() {
  const cut = Date.now() - KEEP_MS;
  const chat = readLines(LOG).filter(e => e.at > cut);
  const says = readLines(SAYS).filter(s => s.at > cut && s.text).map(s => ({ id: 's-' + s.id, kind: s.banter ? 'banter' : 'say', ...who(s.bot), text: clip(s.text, 300), at: s.at, ...(s.with ? { with: s.with } : {}) }));
  const items = [...chat.map(({ device, ...e }) => e), ...says].sort((a, b) => a.at - b.at).slice(-FEED_MAX);
  return { type: 'office-chat', v: 1, at: Date.now(), items };
}
function devices() { try { return JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch { return {}; } }
export async function push() {
  const feed = bundle(), devs = devices(); let ok = !!Object.keys(devs).length;
  for (const [id, d] of Object.entries(devs)) {
    try { const body = JSON.stringify(await seal(feed, d.pub));
      const r = await fetch(`${RELAY}/${d.topic}_chat`, { method: 'POST', body, headers: { Cache: 'yes' }, signal: AbortSignal.timeout(30000) });
      say(`chat feed -> device ${id}: ${feed.items.length} lines, ${Math.round(body.length / 1024)} KB -> ${r.status}`); ok &&= r.ok;
    } catch (e) { say('chat push error', id, e.message); ok = false; }
  }
  return ok;
}
const sig = () => [LOG, SAYS, DEVICES].map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join('|');
let started = false;
export function startPublisher(log) {
  if (started) return; started = true; if (log) say = log;
  let last = '', lastPush = 0;
  const tick = async () => {
    const s = sig();
    if ((s !== last || dirty) && Date.now() - lastPush > 3000 || Date.now() - lastPush > 2.5 * 3600e3) {
      last = s; dirty = false; lastPush = Date.now(); await push().catch(e => say('chat push failed', e.message));
    }
  };
  tick(); setInterval(tick, 2000);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...a] = process.argv.slice(2);
  const opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
  if (cmd === 'test') {
    const text = a[0] || '', tri = R.triage(text, { to: opt('to') || R.OFFICE_TO, near: opt('near') });
    console.log(JSON.stringify(tri));
    if (tri.route === 'office') for (const l of await reply(text, tri)) console.log(`${who(l.bot).name}: ${l.text}  [${l.via}]`);
    else console.log('-> real order: bridge files an HQ issue + Slack #hq-chat wake for Grok Bot');
  } else if (cmd === 'show') for (const e of readLines(LOG).slice(-(+a[0] || 30))) console.log(new Date(e.at).toLocaleString('en-US', { timeZone: 'America/Chicago', timeStyle: 'short' }), e.route || '', `${e.name}:`, e.text, e.issue ? `#${e.issue}` : '');
  else if (cmd === 'push') process.exit((await push()) ? 0 : 1);
  else if (cmd === 'publisher') startPublisher();
  else console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
