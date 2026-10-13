#!/usr/bin/env node
// HQ #63: DIRECT chat. Chris picks one teammate in the chat's Direct tab and talks to them 1:1, WITHOUT Michael (Grok Bot)
// in the middle. The bridge (tools/hq-bridge.mjs) hands every message that carries `direct: { bot }` to handle() here and
// never files an HQ issue or Slack-wakes Grok Bot for it.
//
// Per message:
//   1. Chris's line goes into the shared log (~/.config/grok-bot-hq/office-chat.jsonl) with thread "dm:<bot>" (the iPad shows
//      it only in that person's Direct thread, not in the Office or Michael tabs).
//   2. Simple moves ("get out of the way", "go to the water cooler") ran on the iPad already; the person answers in character.
//   3. The person's office stand-in answers right away in character (free: built-in lines, or a FREE model if llm.env has an
//      OpenRouter/Gemini key). Lines are marked `standin: true` and the iPad labels them "office stand-in".
//   4. If a REAL teammate agent sits behind that desk (~/.config/grok-bot-hq/teammates.json, private), every non-move message
//      is also queued for that teammate: ~/.config/grok-bot-hq/teammate-inbox/<botId>.jsonl (one JSON line each, with the
//      agentId and the exact command to answer). The teammate answers with
//          node /workspace/bot-office/tools/direct.mjs reply <botId> "text"
//      which lands in Chris's Direct thread within seconds, labeled "✓ real <teammate>" (and as a bubble over their head).
//   5. Worker memory (HQ #58): they remember what Chris said to them and what they answered.
//
// Forward path to the real teammate: nothing on the box can wake another agent by itself. Whoever has agent messaging
// (Grok Bot's SendToAgent, a routine, etc.) runs `direct.mjs pending` and sends each line to its agentId, then
// `direct.mjs forwarded <botId> <id|all>`. `tools/hq-inbox.sh pending` lists the waiting ones too.
//
//   node tools/direct.mjs map                         character -> teammate map (real agent or office stand-in only)
//   node tools/direct.mjs test <bot> "text"           dry run: what the stand-in says + whether it's queued for the teammate
//   node tools/direct.mjs thread <bot> [n]            last n lines of Chris's Direct thread with that person
//   node tools/direct.mjs pending [bot] [--json]      queued for real teammates, not forwarded / not answered yet
//   node tools/direct.mjs forwarded <bot> <id|all>    mark queued line(s) as forwarded to the teammate agent (alias: mark-forwarded)
//   pending prints, per waiting line: id, bot, character/teammate, agentId, text, and a ready SendToAgent prompt
//   node tools/direct.mjs reply <bot> "text"          the REAL teammate answers Chris in the Direct thread (also marks answered)
import fs from 'node:fs';
import os from 'node:os';
const O = await import(new URL('./office-chat.mjs', import.meta.url));
const R = await import(new URL('../office-chat-rules.js', import.meta.url));
const { STATIONS } = await import(new URL('../stations.js', import.meta.url));

const DIR = `${os.homedir()}/.config/grok-bot-hq`, INBOX = `${DIR}/teammate-inbox`, STATE = `${INBOX}/_state.json`;
const TOOL = new URL(import.meta.url).pathname;
let say = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), '[direct]', ...a);
const clip = (s, n = 400) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const st = id => STATIONS.find(s => s.id === id);
const lines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
export function teammates() { try { const t = JSON.parse(fs.readFileSync(`${DIR}/teammates.json`, 'utf8')); return Object.fromEntries(Object.entries(t).filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')); } catch { return {}; } }
// HQ #72: a desk is "real" when a teammate agent sits behind it OR Grok Bot covers it (handler: 'grok', e.g. Oscar = Accounting)
export const isReal = tm => !!(tm && (tm.agentId || tm.handler === 'grok'));
const whoDoes = (tm, s) => tm?.handler === 'grok' ? `Grok Bot (as ${s.name.split(' ')[0]}, ${s.bot})` : (tm?.teammate || s.bot);
const state = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { forwarded: {}, answered: {} }; } };
const saveState = s => { fs.mkdirSync(INBOX, { recursive: true, mode: 0o700 }); fs.writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 }); };
const devices = () => { try { return JSON.parse(fs.readFileSync(`${DIR}/devices.json`, 'utf8')); } catch { return {}; } };
const memory = async () => import(new URL('./worker-memory.mjs', import.meta.url)).catch(() => null);
export const resolve = x => { const id = R.idOf(x); return id && st(id) && !st(id).hero ? id : null; };

// ---------- the stand-in's line (free) ----------
const HANDOFF = { // real teammate behind the desk: stand-in confirms it went to the real desk
  icons: 'Nard Dog copies! Putting this on the real Icon Shop desk. The real me answers right here in our thread.',
  designer: 'OMG okay, got it! Sending it to the real Atom Family Designer desk. Real answer comes back right here.',
  profile: 'Oh. Okay. Sorry. I passed that to the real HR & Settings desk. The answer comes back in this thread.',
  inbox: 'Got it! I put that on the real Reception desk. The answer comes back right here.',
  cos: 'Yep, passed to the real Market Research desk. *looks at camera* Answer comes back in this thread.',
  assist: 'Logged. Routed to the real Family Assistant desk. Expect results. Here. In this thread.',
  onpad: 'Okay, dear, I sent that to the real Chat & Messaging desk. The answer comes back right here.',
  builder: 'Fine. It is on the real App Builder desk. Answer comes back here.',
  faith: 'I filed that with the real Faith Lands desk. Properly. The answer comes back here.',
  broker: 'Actually, I passed that to Grok Bot, who runs the Accounting desk. The answer comes back right here.',
  conn: 'Okay. Sent to the real IT & Connectivity desk. Answer comes here. Snack?',
  review: 'Sent to the real QA Review desk. Do not ask how. Answer comes back here.',
  kids: 'Sent to the real Kids Tech desk, babe. Answer comes back right here.',
};
const NOREAL = { // no real bot behind the desk: be honest, stay in character
  inbox: 'I would love to help, but I am just the office Pam, there is no real bot behind my desk yet. I can chat and move. Real work goes to Michael.',
  cos: 'Honestly? I am just office Jim. No real bot at this desk yet, so real work goes to Michael. Happy to chat though.',
  assist: 'FALSE. I mean, true: I am only office Dwight, no real bot at this desk. Real work goes through Michael. For now.',
  onpad: 'Oh, sweetie, I am just office Phyllis. No real bot at my desk yet. Michael handles the real stuff.',
  builder: 'I am office Stanley. No real bot here. Take it to Michael.',
  faith: 'I am only the office Angela. There is no real bot at this desk. Take real work to Michael. Properly.',
  broker: 'Actually, I am just office Oscar. No real bot at this desk yet, so real work goes to Michael.',
  conn: 'I am just office Kevin. No real bot at my desk. Michael does the real stuff. Snack?',
  review: 'I am the office Creed. There is no real bot here. There might not even be a real Creed. Ask Michael.',
  kids: 'Just office Meredith here, no real bot at this desk. Michael does the real work, babe.',
};
function digestCtx(bot) {
  // last few lines of this thread so the free model stays on topic (only this worker's own thread; memory stays per worker)
  const t = lines(O.LOG).filter(e => e.thread === 'dm:' + bot).slice(-6).map(e => `${e.who === 'chris' ? 'Chris' : st(bot).name.split(' ')[0]}: ${clip(e.text, 140)}`);
  return t.length ? `Recent lines of your private chat with Chris:\n${t.join('\n')}` : '';
}
export async function standin(bot, text, tri, real, p = {}) {
  if (tri.kind === 'cmd' && tri.route === 'office') {
    const out = await O.reply(text, { ...tri, cmds: tri.cmds.some(c => c.bot === bot) ? tri.cmds : tri.cmds.map(c => ({ ...c, bot })) }, p);
    return out.filter(l => l.bot === bot).slice(0, 1).concat(out.filter(l => l.bot !== bot)).slice(0, 2).map(l => ({ ...l, kind: 'move' }));
  }
  const ask = tri.route !== 'office';
  if (ask && real) return [{ bot, text: HANDOFF[bot] || `Got it. Passing this to the real ${st(bot).bot} desk. The answer comes back right here.`, via: 'built-in', kind: 'handoff' }];
  const f = await O.freeLine(bot, text, digestCtx(bot) + (ask && !real ? '\nYou are only an office character with no real bot behind your desk. If he asks for real work, say plainly (out of character) that this desk cannot do it and it is going to Michael; otherwise chat.' : ''));
  if (f) return [{ bot, text: f.text, via: f.via, kind: ask ? 'chat-ask' : 'chat' }];
  if (ask && !real) return [{ bot, text: NOREAL[bot] || 'I am just the office version of me. Real work goes to Michael.', via: 'built-in', kind: 'chat-ask' }];
  return [{ bot, text: R.casualLine(bot, text, Date.now()), via: 'built-in', kind: 'chat' }];
}

// ---------- the bridge calls this for every Direct message ----------
export async function handle(p, { log } = {}) {
  if (log) say = log;
  const bot = resolve(p.direct?.bot); if (!bot) { say('direct: bad bot', JSON.stringify(p.direct)); return { handled: false }; }
  const s = st(bot), thread = 'dm:' + bot, text = clip(p.text, 2500), at = Date.parse(p.ts) || Date.now();
  const tm = teammates()[bot], real = isReal(tm);
  const tri = R.triage(text.replace(/^\s*(@?grok\b[:,]?|\/grok\b|!grok\b)\s*/i, ''), { to: s.bot, near: bot });
  O.append({ id: 'c-' + p.mid, mid: p.mid, kind: 'chris', who: 'chris', name: 'Chris', text: clip(text, 600), to: s.bot, thread, route: 'direct', why: tri.why, at, device: p.device?.id });
  await O.toDevice(p.device, { type: 'ack', id: 'ack-' + p.mid, mid: p.mid, issue: null, route: 'direct', thread, at: new Date().toISOString() });
  // real teammate: queue everything except pure in-game moves
  const moveOnly = tri.route === 'office' && tri.kind === 'cmd';
  let queued = null;
  if (real && !moveOnly) {
    queued = { id: 'dm-' + p.mid, at: new Date(at).toISOString(), bot, character: s.name, teammate: tm.teammate || s.bot, desk: s.bot, agentId: tm.agentId || null, handler: tm.handler || null,
      from: 'Chris', text, kind: tri.route === 'office' ? 'chat' : 'ask', thread,
      reply: `node ${TOOL} reply ${bot} "<your answer to Chris>"` };
    fs.mkdirSync(INBOX, { recursive: true, mode: 0o700 }); fs.appendFileSync(`${INBOX}/${bot}.jsonl`, JSON.stringify(queued) + '\n', { mode: 0o600 });
  }
  const out = await standin(bot, text, tri, real, p);
  let i = 0;
  for (const l of out) {
    const w = O.who(l.bot), id = `oc-${p.mid}${i ? '-' + i : ''}`; i++;
    const e = { id, kind: 'reply', ...w, text: l.text, at: Date.now(), route: 'direct', thread: 'dm:' + bot, standin: true, via: l.via, re: p.mid,
      ...(l.kind === 'handoff' ? { handoff: whoDoes(tm, s) } : {}) };
    O.append(e);
    await O.toDevice(p.device, { id, ref: null, from: w.name, who: w.who, text: l.text, at: new Date(e.at).toISOString(), office: true, via: l.via, thread: e.thread, standin: true, ...(e.handoff ? { handoff: e.handoff } : {}) });
  }
  try { const W = await memory(); if (W) {
    W.logChris(bot, text, { at: p.ts, src: 'direct' });
    if (out[0]) W.logEvent(bot, `Chris and I talked 1:1 (Direct tab). I said: ${clip(out[0].text, 160)}`, { src: 'direct' });
    for (const c of tri.cmds.slice(0, 4)) if (c.bot !== bot) W.logEvent(c.bot, `Chris told me to ${R.ACTS[c.act]?.label || c.act} (from his chat with ${s.name.split(' ')[0]}).`, { src: 'direct' });
  } } catch {}
  O.bump();
  say(`direct -> ${s.name} (${s.bot}${real ? ', real: ' + whoDoes(tm, s) : ', office only'}): "${clip(text, 70)}" | ${tri.why}${queued ? ' | queued for ' + (tm.agentId || 'Grok Bot') : ''} | ${out.map(l => clip(l.text, 50)).join(' / ')}`);
  return { handled: true, tri, queued, lines: out };
}

// ---------- the REAL teammate answers ----------
export async function teammateReply(bot, text) {
  const s = st(bot), tm = teammates()[bot]; if (!s) throw new Error('unknown bot ' + bot);
  const w = O.who(bot), at = Date.now(), id = `tm-${bot}-${at.toString(36)}`;
  const e = { id, kind: 'reply', ...w, text: clip(text, 2000), at, route: 'direct', thread: 'dm:' + bot, real: true, via: 'teammate', teammate: tm?.handler === 'grok' ? `${s.bot} (Grok Bot)` : (tm?.teammate ? `${s.bot}` : s.bot) };
  O.append(e);
  let sent = 0; for (const d of Object.values(devices())) if (await O.toDevice(d, { id, ref: null, from: w.name, who: bot, text: e.text, at: new Date(at).toISOString(), thread: e.thread, real: true, via: 'teammate' })) sent++;
  const stt = state(); for (const q of lines(`${INBOX}/${bot}.jsonl`)) if (!stt.answered[q.id]) stt.answered[q.id] = new Date(at).toISOString(); saveState(stt);
  try { (await memory())?.logEvent(bot, `I (the real ${s.bot}) answered Chris 1:1: ${clip(text, 180)}`, { kind: 'reply', src: 'direct' }); } catch {}
  O.bump(); await O.push().catch(() => {});
  return { id, devices: sent };
}
// one-line prompt the parent pastes into SendToAgent for a queued Direct message
export const forwardPrompt = q => q.handler === 'grok' || !q.agentId
  ? `GROK BOT ANSWERS THIS ONE YOURSELF (no SendToAgent; you run the ${q.desk || 'desk'} desk as ${q.character}). Chris said 1:1: "${clip(q.text, 600).replace(/"/g, "'")}" Do the real work if it is a request, then answer in ${q.character.split(' ')[0]}'s voice with: node ${TOOL} reply ${q.bot} "<your answer>"`
  : `Chris messaged you 1:1 on the HQ Direct tab (you are ${q.character} at the ${q.desk || q.teammate} desk in his 3D office, i.e. you, the ${q.teammate} bot; Grok Bot is not in this thread): "${clip(q.text, 600).replace(/"/g, "'")}" First decide: is this a real work request (do it, then give a plain status: what you did, what is left, or what you need from him) or casual chat (a short in-character reply is fine)? For real work, lead with the work facts and keep character flavor to one line at most. Answer him in your own voice with: node ${TOOL} reply ${q.bot} "<your answer>"`;
export function pending(bot) {
  const stt = state(), out = [];
  for (const b of bot ? [bot] : Object.keys(teammates())) for (const q of lines(`${INBOX}/${b}.jsonl`)) if (!stt.answered[q.id]) out.push({ ...q, forwarded: stt.forwarded[q.id] || null });
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...a] = process.argv.slice(2);
  const ct = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT';
  if (cmd === 'map') {
    const tm = teammates();
    for (const s of STATIONS) console.log(`${s.name.padEnd(16)} ${(s.bot || '').padEnd(21)} ${s.hero ? 'MAIN TAB ONLY (Michael = Grok Bot)' : tm[s.id]?.agentId ? `REAL teammate ${tm[s.id].teammate} (${tm[s.id].agentId})` : tm[s.id]?.handler === 'grok' ? 'REAL: Grok Bot covers this desk (answers in character)' : `office stand-in only (no teammate agent mapped)`}`);
  } else if (cmd === 'test') {
    const bot = resolve(a[0]); if (!bot) { console.error('unknown bot', a[0]); process.exit(1); }
    const real = isReal(teammates()[bot]), tri = R.triage(a[1] || '', { to: st(bot).bot, near: bot });
    console.log(JSON.stringify({ bot, real, route: tri.route, kind: tri.kind, cmds: tri.cmds, why: tri.why, queued: real && !(tri.route === 'office' && tri.kind === 'cmd') }));
    for (const l of await standin(bot, a[1] || '', tri, real)) console.log(`${st(l.bot).name}: ${l.text}  [${l.via}, ${l.kind}]`);
  } else if (cmd === 'thread') {
    const bot = resolve(a[0]); for (const e of lines(O.LOG).filter(e => e.thread === 'dm:' + bot).slice(-(+a[1] || 20)))
      console.log(ct(e.at), e.who === 'chris' ? 'Chris' : `${e.name}${e.real ? ' (REAL ' + (e.teammate || '') + ')' : ' (stand-in)'}`, ':', e.text);
  } else if (cmd === 'pending') {
    const bot = a[0] && !a[0].startsWith('--') ? resolve(a[0]) : null, list = pending(bot);
    if (a.includes('--json')) console.log(JSON.stringify(list.map(q => ({ ...q, sendToAgent: { agentId: q.agentId, prompt: forwardPrompt(q) }, markForwarded: `node ${TOOL} forwarded ${q.bot} ${q.id}` })), null, 1));
    else if (!list.length) { if (!a.includes('--quiet')) console.log('no Direct messages waiting for a real teammate'); }
    else {
      const q0 = a.includes('--quiet'), nf = list.filter(q => !q.forwarded).length;
      console.log(`DIRECT (HQ #63): ${list.length} message(s) from Chris waiting for a real teammate (${nf} not forwarded). Not for Grok Bot to answer.`);
      console.log(`  Drain: SendToAgent(agentId, prompt) for each NOT FORWARDED line, then: node ${TOOL} forwarded <bot> <id|all>`);
      for (const q of list) {
        console.log(`  [${q.forwarded ? 'forwarded ' + ct(q.forwarded) : 'NOT FORWARDED'}] ${q.id}  bot=${q.bot}  ${q.character} / ${q.desk || ''} / ${q.teammate}  agent=${q.agentId || 'GROK BOT (answer yourself)'}  ${ct(q.at)} [${q.kind}]`);
        console.log(`    text: ${clip(q.text, q0 ? 160 : 400)}`);
        if (!q.forwarded) { console.log(q.agentId ? `    SendToAgent ${q.agentId}: ${forwardPrompt(q)}` : `    ${forwardPrompt(q)}`); console.log(`    then: node ${TOOL} forwarded ${q.bot} ${q.id}`); }
      }
    }
  } else if (cmd === 'forwarded' || cmd === 'mark-forwarded') {
    const bot = resolve(a[0]), stt = state(), now = new Date().toISOString(); let n = 0;
    for (const q of pending(bot)) if (a[1] === 'all' || q.id === a[1]) { stt.forwarded[q.id] = now; n++; }
    saveState(stt); console.log(`marked ${n} forwarded`);
  } else if (cmd === 'reply') {
    const bot = resolve(a[0]); if (!bot || !a[1]) { console.error('usage: direct.mjs reply <bot> "text"'); process.exit(1); }
    const r = await teammateReply(bot, a[1]); console.log(`sent to Chris's Direct thread with ${st(bot).name} (${r.id}, ${r.devices} device(s))`);
  } else console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 30).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
