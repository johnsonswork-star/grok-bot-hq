#!/usr/bin/env node
// HQ watcher: answers Bot HQ chat (iPad) with a full AI reply, instantly, from Grok Bot's box.
//   node tools/hq-watcher.mjs            run forever (start/stop via: tools/hq-inbox.sh watcher start|stop|status)
//   node tools/hq-watcher.mjs once       answer whatever is pending now, then exit
//   node tools/hq-watcher.mjs ask "text" print the reply the model would give (no posting)
//
// Loop: every POLL_MS (3 s) run `hq-inbox.sh pending` (gh only, free). For each new unanswered HQ issue:
//   read the message + recent HQ history + ~/.config/grok-bot-hq/hq-context.md, make ONE LLM call, post it with
//   `hq-inbox.sh reply <n> "<text>" "<Bot>"` (relayed to the iPad by the bridge).
// LLM, first that works:
//   1. Hosted API if a key is in env or ~/.config/grok-bot-hq/llm.env: XAI_API_KEY (api.x.ai) or OPENAI_API_KEY.
//   2. Local model on this box (llama.cpp + Qwen2.5-3B-Instruct, CPU, private, free). Server starts on demand and
//      shuts down after IDLE_MIN idle minutes to free RAM.
//   3. No LLM: a contextual non-canned fallback reply (logged as "fallback").
// Approval-type asks (buy/send/delete/...): the reply asks Chris to confirm, and one JSON line goes to needs-chris.jsonl.
// Every handled message also goes to tasks.jsonl so the full Grok Bot session can follow up on real work.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
const run = promisify(execFile);

const TOOLS = path.dirname(new URL(import.meta.url).pathname);
const INBOX = `${TOOLS}/hq-inbox.sh`;
const REPO = process.env.HQ_REPO || 'johnsonswork-star/grok-bot-hq-inbox';
const CFG = `${os.homedir()}/.config/grok-bot-hq`;
const LLMDIR = process.env.HQ_LLM_DIR || `${os.homedir()}/.local/share/grok-bot-hq/llm`;
const POLL_MS = +process.env.POLL_MS || 3000, IDLE_MIN = +process.env.IDLE_MIN || 15;
const MAX_AGE_H = +process.env.MAX_AGE_H || 3, PORT = +process.env.HQ_LLM_PORT || 8765;
const log = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), ...a);
const gh = async (...args) => (await run('gh', args, { maxBuffer: 8 << 20 })).stdout.trim();
const appendJsonl = (f, o) => { try { fs.appendFileSync(`${CFG}/${f}`, JSON.stringify(o) + '\n'); } catch (e) { log('write', f, e.message); } };

function loadEnv() {
  const env = { ...process.env };
  try { for (const l of fs.readFileSync(`${CFG}/llm.env`, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*['"]?(.*?)['"]?\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2]; } } catch {}
  return env;
}

// ---------- message parsing ----------
async function loadIssue(n) {
  const j = JSON.parse(await gh('issue', 'view', String(n), '--repo', REPO, '--json', 'number,title,body,comments,createdAt'));
  const b = j.body || '';
  const text = (b.match(/\n---\n\n([\s\S]*?)\n\n---\n/) || [, b])[1].trim();
  const to = ((b.match(/\*\*To:\*\*\s*([^\n(]+)/) || [, 'Grok Bot'])[1]).trim();
  const extra = j.comments.filter(c => !/^\s*\*\*[^*]{1,40}:\*\*/.test(c.body)).map(c => c.body.trim()); // Chris follow-ups on the issue
  return { n, text: [text, ...extra].join('\n\n'), to, createdAt: j.createdAt, comments: j.comments };
}
async function history(exclude) {
  try {
    const list = JSON.parse(await gh('issue', 'list', '--repo', REPO, '--label', 'hq-chat', '--state', 'all', '--limit', '7', '--json', 'number,body,comments'));
    return list.filter(i => i.number !== exclude).reverse().flatMap(i => {
      const t = ((i.body || '').match(/\n---\n\n([\s\S]*?)\n\n---\n/) || [, ''])[1].trim();
      const r = i.comments.filter(c => /^\s*\*\*[^*]{1,40}:\*\*/.test(c.body)).map(c => c.body.replace(/^\s*\*\*[^*]{1,40}:\*\*\s*/, '').trim());
      return [t && { role: 'user', content: t.slice(0, 500) }, r.length && { role: 'assistant', content: r.at(-1).slice(0, 500) }].filter(Boolean);
    }).slice(-8);
  } catch { return []; }
}

const APPROVAL = /\b(buy|purchase|order|pay|checkout|subscribe|sign ?up|send (it|the|an?|that|this|him|her|them)|e-?mail (him|her|them|it)|text (him|her|them)|post (it|this|that)|publish|delete|remove|cancel|refund|transfer|wire|book|reserve)\b/i;

// ---------- LLM ----------
const SYSTEM = (bot) => `You are ${bot === 'Grok Bot' ? 'Grok Bot' : `${bot}, one of Grok Bot's team bots`}, Chris Johnson's personal AI assistant, replying instantly in the Bot HQ chat on his iPad.
Rules:
- You are talking directly TO Chris. Address him as "you", never as "Chris" or "he".
- Answer like a capable, friendly teammate: one short chat message (1-4 sentences), plain text, no markdown headers, no em-dashes.
- Actually answer questions and give real help, opinions, and next steps. Do not be vague.
- From this chat you cannot take actions yourself (no email, purchases, browsing, account changes). Never claim you did, checked, sent, or bought anything.
- If he asks for real work (research, building, checking accounts), give your best quick take and say you've queued it for the full Grok Bot session.
- If he asks for anything irreversible (buying, sending messages, deleting, posting, signing up), ask him to confirm with a clear yes before anything happens.
- Never name or speculate about any underlying model or provider; you are ${bot}.
${(() => { try { return '\n' + fs.readFileSync(`${CFG}/hq-context.md`, 'utf8'); } catch { return ''; } })()}`;

let server = null, lastUse = 0;
async function localUp() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return true; } catch {}
  return false;
}
async function ensureLocal() {
  lastUse = Date.now();
  if (await localUp()) return true;
  const bin = fs.readdirSync(LLMDIR).filter(d => d.startsWith('llama-')).map(d => `${LLMDIR}/${d}/llama-server`).find(f => fs.existsSync(f));
  const model = fs.readdirSync(LLMDIR).filter(f => f.endsWith('.gguf')).map(f => `${LLMDIR}/${f}`)[0];
  if (!bin || !model) { log('local LLM missing (bin/model)'); return false; }
  log('starting local model', path.basename(model));
  server = spawn(bin, ['-m', model, '--host', '127.0.0.1', '--port', String(PORT), '-c', '4096', '-t', String(Math.max(2, os.cpus().length)), '--log-disable'],
    { stdio: 'ignore', detached: false });
  server.on('exit', () => { server = null; });
  for (let i = 0; i < 120; i++) { await new Promise(r => setTimeout(r, 500)); if (await localUp()) return true; }
  log('local model failed to start'); return false;
}
setInterval(() => { if (server && Date.now() - lastUse > IDLE_MIN * 60e3) { log('idle, stopping local model'); server.kill(); server = null; } }, 60e3).unref();

async function chat(url, key, model, messages, timeout) {
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model, messages, max_tokens: 260, temperature: 0.6 }) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).choices[0].message.content;
}
async function generate(messages) {
  const env = loadEnv();
  if (env.XAI_API_KEY) try { return { text: await chat('https://api.x.ai/v1/chat/completions', env.XAI_API_KEY, env.XAI_MODEL || 'grok-4-fast-non-reasoning', messages, 45000), via: 'xai' }; } catch (e) { log('xai failed', e.message); }
  if (env.OPENAI_API_KEY) try { return { text: await chat(`${env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, env.OPENAI_API_KEY, env.OPENAI_MODEL || 'gpt-4.1-mini', messages, 45000), via: 'openai' }; } catch (e) { log('openai failed', e.message); }
  if (await ensureLocal()) try { lastUse = Date.now(); return { text: await chat(`http://127.0.0.1:${PORT}/v1/chat/completions`, '', 'local', messages, 120000), via: 'local' }; } catch (e) { log('local failed', e.message); }
  return null;
}
function clean(t) {
  return String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^\s*\**(grok bot|assistant)\**\s*:\s*/i, '')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/^#+\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 900);
}
function fallback(text, needs) {
  const t = text.replace(/\s+/g, ' ').trim(), q = t.length > 90 ? t.slice(0, 87) + '...' : t;
  if (needs) return `Got it: "${q}". That's something I'll only do with your clear yes, so reply "yes" here to confirm and I'll take it from there.`;
  if (/\?\s*$/.test(t)) return `Good question: "${q}". I've queued it for the full Grok Bot session and will answer here with specifics shortly.`;
  return `Got it: "${q}". It's queued for the full Grok Bot session and I'll follow up here.`;
}

// ---------- main ----------
export async function replyFor(msg, hist = []) {
  const needs = APPROVAL.test(msg.text);
  const bot = /grok bot/i.test(msg.to) ? 'Grok Bot' : msg.to;
  const messages = [{ role: 'system', content: SYSTEM(bot) }, ...hist,
    { role: 'user', content: msg.text + (needs ? '\n\n[Note to assistant: this is an irreversible action. In your reply, briefly restate exactly what would happen (what, how many, where; do not guess prices) and ask him to reply yes to confirm. Do not say it is done or queued yet.]' : '') }];
  const g = await generate(messages);
  let text = g && clean(g.text);
  if (!text) { log('NO LLM available (no API key, local model failed); using contextual fallback'); text = fallback(msg.text, needs); }
  return { text, via: g && text ? g.via : 'fallback', needs, bot };
}

const handled = new Map(); // issue -> attempts
const startedAt = Date.now();
async function handle(n) {
  const tries = handled.get(n) || 0; if (tries >= 3) return; handled.set(n, tries + 1);
  const t0 = Date.now();
  const msg = await loadIssue(n);
  if (Date.now() - Date.parse(msg.createdAt) > MAX_AGE_H * 3600e3) { handled.set(n, 99); return log(`#${n} older than ${MAX_AGE_H}h, leaving for the main session`); }
  log(`#${n} new message for ${msg.to}: ${msg.text.replace(/\s+/g, ' ').slice(0, 80)}`);
  const r = await replyFor(msg, await history(n));
  await run(INBOX, ['reply', String(n), r.text, r.bot], { maxBuffer: 1 << 20 });
  handled.set(n, 99);
  const rec = { ts: new Date().toISOString(), issue: n, to: msg.to, text: msg.text, reply: r.text, via: r.via, secs: (Date.now() - t0) / 1000 };
  appendJsonl('tasks.jsonl', rec);
  if (r.needs) appendJsonl('needs-chris.jsonl', { ts: rec.ts, issue: n, ask: msg.text.replace(/\s+/g, ' ').slice(0, 200), status: 'asked Chris to confirm in HQ' });
  log(`#${n} replied via ${r.via} in ${rec.secs}s${r.needs ? ' (approval flagged)' : ''}: ${r.text.replace(/\s+/g, ' ').slice(0, 120)}`);
}
async function tick() {
  let out = '';
  try { out = (await run(INBOX, ['pending'], { maxBuffer: 1 << 20, timeout: 60000 })).stdout; } catch (e) { return log('pending error', e.message.split('\n')[0]); }
  for (const m of out.matchAll(/^#(\d+)\s/gm)) { const n = +m[1]; if ((handled.get(n) || 0) < 3) await handle(n).catch(e => log(`#${n} error`, e.message.split('\n')[0])); }
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'ask') { const r = await replyFor({ text: arg || 'hello', to: 'Grok Bot' }); console.log(`[${r.via}${r.needs ? ', needs approval' : ''}] ${r.text}`); server?.kill(); process.exit(0); }
else if (cmd === 'once') { await tick(); server?.kill(); process.exit(0); }
else {
  log(`hq-watcher up (pid ${process.pid}), polling every ${POLL_MS / 1000}s`);
  const stop = () => { server?.kill(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  for (;;) { await tick(); await new Promise(r => setTimeout(r, POLL_MS)); }
}
