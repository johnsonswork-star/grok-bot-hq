#!/usr/bin/env node
// HQ #58: every office worker keeps their OWN memory: what Chris says to them + what happens around them.
// Store (private, on Grok Bot's box, never published to the Pages repo):
//   ~/.config/grok-bot-hq/worker-memory/<botId>.jsonl   one file per stations.js id, append-only, one JSON object per line:
//     { at: ISO, kind, text, src, issue?, tone?, score?, with?, about? }   (about = other workers he named; counts half for the recipient)
//       kind: chris    = Chris said this TO them (HQ chat addressed to them)      -> tone/score from tone.js (local word lists)
//             mention  = Chris talked ABOUT them in a message to someone else (counts half toward the relationship)
//             reply    = what they (or Grok Bot as them) answered Chris
//             event    = office goings-on that involve them (task stage, picks, needs, desk lines)
//             banter   = a chat they had with a teammate (who + first line)
//             note     = anything else worth remembering
//   ~/.config/grok-bot-hq/worker-memory/_shared.jsonl   office-wide facts EXPLICITLY marked shared (everyone sees these)
// Relationship with Chris (per worker, derived on read, nothing extra stored): decayed sum of tone scores of his messages to
// them. Harsh words count 1.5x and fade over ~10 days; kind words fade over ~4 days (grudges outlast compliments, like people).
//   label: hurt <= -0.45 < wary <= -0.15 < neutral < 0.15 <= warm < 0.45 <= fond
// Memory stays per worker: nobody reads another worker's file. Banter + the iPad only get the mood label, never Chris's words
// (except the bot's own digest, which only that bot's replies read).
//
//   node tools/worker-memory.mjs log <bot|shared> "text" [--kind event|note|reply|banter] [--issue N] [--src S]
//   node tools/worker-memory.mjs chris <bot> "what Chris said to them" [--issue N]       (tone scored)
//   node tools/worker-memory.mjs hq <issue> "<To: bot name>" "message text"              (recipient + people he mentions)
//   node tools/worker-memory.mjs recall <bot> [n]       last n raw memories (default 20)
//   node tools/worker-memory.mjs digest <bot> [--json]  short digest: relationship, what Chris said lately, recent events, shared facts
//   node tools/worker-memory.mjs mood [--json]          one line per worker: relationship label + score
//   node tools/worker-memory.mjs list                   every worker: memory count, last memory, relationship
//   node tools/worker-memory.mjs sync                   catch up from queue.jsonl (HQ messages) + picks.jsonl (idempotent)
//   node tools/worker-memory.mjs who "<name>"           resolve a name to a bot id
// Free: plain node, no AI calls, no network.
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const { STATIONS } = await import(new URL('../stations.js', import.meta.url));
const { scoreTone, relLabel } = await import(new URL('../tone.js', import.meta.url));
const CFG = `${os.homedir()}/.config/grok-bot-hq`;
export const MEM = process.env.WORKER_MEMORY_DIR || `${CFG}/worker-memory`;
const SYNC = `${MEM}/_sync.json`, DEDUPE_MS = 10 * 60e3;
const TAU_HARSH = 10 * 86400e3, TAU_KIND = 4 * 86400e3, TAU_EVENT = 3 * 86400e3;
fs.mkdirSync(MEM, { recursive: true, mode: 0o700 });

const clip = (s, n = 240) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ct = at => { try { return new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT'; } catch { return String(at); } };
const ids = new Set(STATIONS.map(s => s.id));
const fileOf = id => `${MEM}/${id === 'shared' ? '_shared' : String(id).replace(/[^\w-]/g, '')}.jsonl`;

// name / bot name / short / first name / id -> station id ("Icon Shop" -> icons, "Kelly" -> designer, "Grok Bot" -> grok)
export function botId(name) {
  const w = String(name || '').toLowerCase().replace(/[*@]/g, '').trim(); if (!w) return null;
  if (ids.has(w)) return w;
  const s = STATIONS.find(s => [s.name, s.bot, s.short, s.name.split(' ')[0]].some(x => x && w === x.toLowerCase()));
  return s ? s.id : null;
}
// people Chris names inside a message (first name, full name or bot name, word-bounded)
export function mentions(text) {
  const t = ' ' + String(text || '').toLowerCase() + ' ', out = new Set();
  for (const s of STATIONS) for (const n of [s.name, s.name.split(' ')[0], s.bot]) {
    if (!n || n.length < 3) continue; const re = new RegExp(`(^|[^a-z])@?${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
    if (re.test(t)) { out.add(s.id); break; }
  }
  return [...out];
}

export function read(id) {
  let t = ''; try { t = fs.readFileSync(fileOf(id), 'utf8'); } catch { return []; }
  return t.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
// append one memory (deduped: same kind+text for the same worker within 10 min is skipped)
export function remember(id, e) {
  if (id !== 'shared' && !ids.has(id)) return false;
  const m = { at: e.at || new Date().toISOString(), kind: e.kind || 'event', text: clip(e.text, e.kind === 'chris' || e.kind === 'mention' ? 600 : 240), src: e.src || 'manual' };
  if (!m.text) return false;
  for (const k of ['issue', 'tone', 'score', 'with', 'about']) if (e[k] !== undefined && e[k] !== null && e[k] !== '') m[k] = e[k];
  const prev = read(id).slice(-30);
  if (prev.some(p => p.kind === m.kind && p.text === m.text && (m.issue ? p.issue === m.issue : Math.abs(Date.parse(m.at) - Date.parse(p.at)) < DEDUPE_MS))) return false;
  fs.appendFileSync(fileOf(id), JSON.stringify(m) + '\n', { mode: 0o600 });
  return true;
}
export const logEvent = (id, text, o = {}) => remember(id, { ...o, kind: o.kind || 'event', text });
export function logChris(id, text, o = {}) {
  const t = scoreTone(text);
  return remember(id, { ...o, kind: o.kind || 'chris', text, tone: t.tone, score: t.score });
}
// one HQ message: the recipient remembers it word for word; anyone else he names remembers being talked about
export function logHq({ issue, to, text, at, src = 'hq' }) {
  const rid = botId(to) || 'grok', done = [], others = mentions(text).filter(id => id !== rid);
  if (logChris(rid, text, { issue, at, src, ...(others.length ? { about: others } : {}) })) done.push(rid);
  for (const id of others) if (id !== rid && logChris(id, text, { issue, at, src, kind: 'mention', with: rid })) done.push(id + '(mention)');
  return done;
}

export function mood(id, now = Date.now()) {
  let sum = 0, n = 0, kind = 0, harsh = 0, last = null;
  for (const m of read(id)) {
    if ((m.kind !== 'chris' && m.kind !== 'mention') || typeof m.score !== 'number') continue;
    n++; if (m.tone === 'kind') kind++; if (m.tone === 'harsh') harsh++;
    if (m.tone !== 'neutral') last = m;
    const age = Math.max(0, now - Date.parse(m.at)), w = (m.kind === 'mention' || m.about?.length ? 0.5 : 1) * (m.score < 0 ? 1.5 : 1);
    sum += m.score * w * Math.exp(-age / (m.score < 0 ? TAU_HARSH : TAU_KIND));
  }
  const rel = Math.round(Math.tanh(sum * 0.4) * 100) / 100;
  return { rel, label: relLabel(rel), n, kind, harsh, last: last ? { at: last.at, tone: last.tone, text: clip(last.text, 70), issue: last.issue || null } : null };
}
export const moodAll = () => Object.fromEntries(STATIONS.map(s => [s.id, mood(s.id)]));
// compact per-bot mood for the iPad work feed (label + score + a few words of the last pointed thing Chris said to them)
export function moodFeed() {
  const out = {}; for (const s of STATIONS) { const m = mood(s.id); if (!m.n) continue; out[s.id] = { rel: m.rel, label: m.label, ...(m.last ? { lastTone: m.last.tone, said: clip(m.last.text, 48), saidAt: Date.parse(m.last.at) } : {}) }; }
  return out;
}

export function digest(id, { json = false, chris = 5, events = 6, shared = 3 } = {}) {
  const s = STATIONS.find(x => x.id === id); if (!s) return json ? null : `unknown bot ${id}`;
  const all = read(id), m = mood(id);
  const said = all.filter(x => x.kind === 'chris').slice(-chris), about = all.filter(x => x.kind === 'mention').slice(-2);
  const ev = all.filter(x => !['chris', 'mention'].includes(x.kind)).slice(-events), sh = read('shared').slice(-shared);
  const feel = { hurt: 'Chris was harsh with me and I have not forgotten. Cooler, a bit defensive, still professional.',
    wary: 'Chris has been a little rough with me lately. Careful, slightly guarded.', neutral: 'Normal working relationship with Chris.',
    warm: 'Chris has been nice to me. Friendly and upbeat.', fond: 'Chris has been really kind to me. Warm, eager, loyal.' }[m.label];
  if (json) return { id, name: s.name, bot: s.bot, mood: m, feel, said, about, events: ev, shared: sh };
  const L = [`${s.name} (${s.bot}) · memory digest`, `Relationship with Chris: ${m.label} (${m.rel >= 0 ? '+' : ''}${m.rel}; ${m.n} messages: ${m.kind} kind, ${m.harsh} harsh). ${feel}`];
  if (said.length) { L.push('Chris said to me:'); for (const x of said) L.push(`  - ${ct(x.at)}${x.issue ? ` #${x.issue}` : ''} [${x.tone}] "${clip(x.text, 140)}"`); }
  if (about.length) { L.push('Chris mentioned me:'); for (const x of about) L.push(`  - ${ct(x.at)}${x.issue ? ` #${x.issue}` : ''} [${x.tone}] "${clip(x.text, 100)}"`); }
  if (ev.length) { L.push('Around me:'); for (const x of ev) L.push(`  - ${ct(x.at)} ${x.kind === 'event' ? '' : x.kind + ': '}${clip(x.text, 140)}`); }
  if (sh.length) { L.push('Office-wide:'); for (const x of sh) L.push(`  - ${ct(x.at)} ${clip(x.text, 120)}`); }
  return L.join('\n');
}

// catch up from the bridge's queue (every HQ message ever filed) + picks (idempotent via _sync.json)
export function sync() {
  let st = {}; try { st = JSON.parse(fs.readFileSync(SYNC, 'utf8')); } catch {}
  st.issues ||= []; st.picks ||= []; let n = 0;
  const lines = f => { try { return fs.readFileSync(`${CFG}/${f}`, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  for (const q of lines('queue.jsonl')) {
    if (q.event !== 'hq-chat' || !q.issue || st.issues.includes(q.issue)) continue;
    n += logHq({ issue: q.issue, to: q.to, text: q.text, at: q.ts || q.filedAt, src: 'hq-sync' }).length; st.issues.push(q.issue);
  }
  for (const p of lines('picks.jsonl')) {
    const k = `${p.bot}:${p.id}:${p.at}`; if (st.picks.includes(k) || !ids.has(p.bot)) continue;
    if (logEvent(p.bot, `Chris tapped his picks on my desk: ${(p.picks || []).join(', ')} (${p.id})`, { at: p.at, issue: p.issue, src: 'pick' })) n++;
    st.picks.push(k);
  }
  st.issues = st.issues.slice(-2000); st.picks = st.picks.slice(-500); st.at = new Date().toISOString();
  fs.writeFileSync(SYNC, JSON.stringify(st), { mode: 0o600 });
  return n;
}
export function markSynced(issue) { let st = {}; try { st = JSON.parse(fs.readFileSync(SYNC, 'utf8')); } catch {} st.issues ||= []; if (!st.issues.includes(issue)) st.issues.push(issue); fs.writeFileSync(SYNC, JSON.stringify(st), { mode: 0o600 }); }

// ---------- CLI ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [cmd, ...args] = process.argv.slice(2);
  const flags = {}, pos = [];
  for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { const k = args[i].slice(2), v = args[i + 1]; if (v === undefined || v.startsWith('--')) flags[k] = true; else { flags[k] = v; i++; } } else pos.push(args[i]); }
  const bid = x => x === 'shared' ? 'shared' : botId(x) || (console.error(`unknown bot "${x}" (ids: ${[...ids].join(' ')})`), process.exit(2));
  if (cmd === 'log' && pos[0] && pos[1]) { const id = bid(pos[0]); console.log(remember(id, { kind: flags.kind || (id === 'shared' ? 'note' : 'event'), text: pos.slice(1).join(' '), issue: flags.issue ? +flags.issue : undefined, src: flags.src || 'cli' }) ? `remembered (${id})` : 'skipped (duplicate/empty)'); }
  else if (cmd === 'chris' && pos[0] && pos[1]) { const id = bid(pos[0]); const ok = logChris(id, pos.slice(1).join(' '), { issue: flags.issue ? +flags.issue : undefined, src: 'cli' }); console.log(ok ? `remembered (${id}) · now ${mood(id).label}` : 'skipped (duplicate)'); }
  else if (cmd === 'hq' && pos[0] && pos[1] && pos[2]) { const r = logHq({ issue: +pos[0], to: pos[1], text: pos.slice(2).join(' ') }); markSynced(+pos[0]); console.log('remembered by:', r.join(', ') || '(already had it)'); }
  else if (cmd === 'recall' && pos[0]) { for (const m of read(bid(pos[0])).slice(-(+pos[1] || 20))) console.log(`${ct(m.at)}  ${m.kind}${m.tone ? '/' + m.tone : ''}${m.issue ? ' #' + m.issue : ''}  ${m.text}`); }
  else if (cmd === 'digest' && pos[0]) { const d = digest(bid(pos[0]), { json: !!flags.json }); console.log(flags.json ? JSON.stringify(d, null, 1) : d); }
  else if (cmd === 'mood') { const a = moodAll(); if (flags.json) console.log(JSON.stringify(a, null, 1)); else for (const s of STATIONS) console.log(`${s.id.padEnd(9)} ${s.name.padEnd(16)} ${a[s.id].label.padEnd(8)} ${a[s.id].rel}`); }
  else if (cmd === 'list') { for (const s of STATIONS) { const all = read(s.id), l = all[all.length - 1], m = mood(s.id); console.log(`${s.id.padEnd(9)} ${s.name.padEnd(16)} ${String(all.length).padStart(4)} memories  ${m.label.padEnd(8)} ${l ? ct(l.at) + ' ' + clip(l.text, 60) : '-'}`); } console.log(`shared    ${String(read('shared').length).padStart(21)} facts   (${MEM})`); }
  else if (cmd === 'sync') console.log('synced', sync(), 'new memories');
  else if (cmd === 'who' && pos[0]) console.log(botId(pos.join(' ')) || 'unknown');
  else console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 28).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
