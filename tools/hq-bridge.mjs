#!/usr/bin/env node
// HQ chat bridge: encrypted relay (ntfy.sh) <-> private GitHub inbox (johnsonswork-star/grok-bot-hq-inbox).
//   node tools/hq-bridge.mjs watch            live: stream new iPad messages -> GitHub issues within ~1-2 s (runs on the box)
//   node tools/hq-bridge.mjs once [since]     catch up once (default since=12h) then exit (GitHub Action backup)
//   node tools/hq-bridge.mjs relay <issue#> <commentId>   push one issue comment back to the iPad, encrypted
//   node tools/hq-bridge.mjs relay-event      same, from a GitHub Action issue_comment event
// Key: env HQ_INBOX_KEY (JSON) or ~/.config/grok-bot-hq/inbox-key.json  {inboxTopic, privJwk, pubJwk}
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const { seal, open, importPriv } = await import(new URL('../hq-crypto.js', import.meta.url));

const REPO = process.env.HQ_REPO || 'johnsonswork-star/grok-bot-hq-inbox';
const LABEL = 'hq-chat', RELAY = 'https://ntfy.sh';
const DIR = `${os.homedir()}/.config/grok-bot-hq`, STATE = `${DIR}/bridge-state.json`;
const log = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), ...a);
const cfg = () => JSON.parse(process.env.HQ_INBOX_KEY || fs.readFileSync(`${DIR}/inbox-key.json`, 'utf8'));
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const state = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { done: [] }; } };
const uniq = (a = [], b = []) => [...new Set([...a, ...b])].slice(-500);
const saveState = s => { try { fs.mkdirSync(DIR, { recursive: true }); const d = state();
  fs.writeFileSync(STATE, JSON.stringify({ ...d, ...s, done: uniq(d.done, s.done), relayed: uniq(d.relayed, s.relayed) })); } catch {} };
const chicago = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT'; } catch { return iso; } };

let labelOk = false;
function ensureLabel() {
  if (labelOk) return; labelOk = true;
  try { gh('label', 'create', LABEL, '--repo', REPO, '--color', 'D4AF37', '--description', 'Message from Bot HQ chat'); } catch {}
}
function alreadyFiled(mid, st) {
  if (st.done.includes(mid)) return true;
  try { return gh('issue', 'list', '--repo', REPO, '--state', 'all', '--search', `"hq-mid:${mid}" in:body`, '--json', 'number', '-q', 'length') !== '0'; }
  catch { return false; }
}
async function handle(m, priv, st) {
  if (m.event !== 'message' || !m.message) return;
  let p; try { p = await open(JSON.parse(m.message), priv); } catch { return log('skip undecryptable', m.id); }
  if (!p.mid || alreadyFiled(p.mid, st)) return;
  const to = String(p.to || 'Grok Bot').slice(0, 60), text = String(p.text || '');
  const snippet = text.replace(/\s+/g, ' ').slice(0, 60) + (text.length > 60 ? '…' : '');
  const team = to === 'Grok Bot' ? 'Grok Bot (+ team)' : `${to} (via Grok Bot + team)`;
  const meta = { mid: p.mid, ntfy: m.id, device: p.device };
  const body = `**From:** Chris (Bot HQ)\n**To:** ${team}\n**Sent:** ${chicago(p.ts)} (${p.ts})\n\n---\n\n${text}\n\n---\n` +
    `_Reply with \`tools/hq-inbox.sh reply <n> "text" [Bot Name]\` (or comment here, start with \`**Bot Name:**\`). Replies show up in the HQ chat on Chris's iPad._\n\n<!-- hq-mid:${p.mid} -->\n<!-- hq-meta ${JSON.stringify(meta)} -->`;
  ensureLabel();
  const url = gh('issue', 'create', '--repo', REPO, '--title', `HQ chat → ${to}: ${snippet}`, '--body', body, '--label', LABEL);
  st.done.push(p.mid); saveState(st);
  log('filed', url);
}

async function once(since = '12h') {
  const c = cfg(), priv = await importPriv(c.privJwk), st = state();
  const r = await fetch(`${RELAY}/${c.inboxTopic}/json?poll=1&since=${since}`);
  if (!r.ok) throw new Error('relay ' + r.status);
  for (const line of (await r.text()).split('\n')) if (line.trim()) { const m = JSON.parse(line); await handle(m, priv, st); if (m.id) st.last = m.id; }
  saveState(st);
}

// Relay any new issue comment (made via hq-inbox.sh, gh, or github.com) back to the iPad.
async function sweepComments() {
  const st = state(); st.relayed ||= [];
  const since = st.sweptAt || new Date(Date.now() - 3600e3).toISOString();
  const now = new Date().toISOString();
  const cs = JSON.parse(gh('api', `repos/${REPO}/issues/comments?since=${since}&per_page=100`));
  const bodies = {};
  for (const c of cs) {
    if (st.relayed.includes(String(c.id))) continue;
    const n = +c.issue_url.split('/').pop();
    bodies[n] ??= gh('issue', 'view', String(n), '--repo', REPO, '--json', 'body', '-q', '.body');
    await relayComment(bodies[n], { ...c, issue: n });
  }
  const s2 = state(); s2.sweptAt = now; saveState(s2);
}

async function watch() {
  const c = cfg(), priv = await importPriv(c.privJwk);
  const sweep = () => sweepComments().catch(e => log('sweep error', e.message));
  sweep(); setInterval(sweep, 20000);
  for (;;) {
    const st = state();
    try {
      const r = await fetch(`${RELAY}/${c.inboxTopic}/json?since=${st.last || '12h'}`);
      if (!r.ok) throw new Error('relay ' + r.status);
      log('listening on relay');
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
          const m = JSON.parse(line);
          try { await handle(m, priv, st); } catch (e) { log('file error', e.message); continue; }
          if (m.event === 'message') { st.last = m.id; saveState(st); }
        }
      }
    } catch (e) { log('relay error', e.message); }
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function relayComment(issueBody, c) {
  const mm = (issueBody || '').match(/<!-- hq-meta (\{.*\}) -->/);
  if (!mm) return log('no device on issue, skip');
  const { device } = JSON.parse(mm[1]); if (!device?.topic || !device?.pub) return;
  const nb = (c.body || '').match(/^\s*\*\*([^*]{1,40}):\*\*\s*/);
  const msg = { id: String(c.id), ref: c.issue, from: nb ? nb[1].trim() : 'Grok Bot', text: nb ? c.body.slice(nb[0].length) : c.body, at: c.created_at };
  const r = await fetch(`${RELAY}/${device.topic}`, { method: 'POST', body: JSON.stringify(await seal(msg, device.pub)) });
  log('relayed comment', c.id, 'to device', device.id, r.status);
  if (r.ok) { const st = state(); (st.relayed ||= []).push(String(c.id)); st.relayed = st.relayed.slice(-500); saveState(st); }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'watch') await watch();
else if (cmd === 'once') await once(a);
else if (cmd === 'relay') {
  const body = gh('issue', 'view', a, '--repo', REPO, '--json', 'body', '-q', '.body');
  const c = JSON.parse(gh('api', `repos/${REPO}/issues/comments/${b}`));
  await relayComment(body, { ...c, issue: +a });
} else if (cmd === 'relay-event') {
  const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  await relayComment(ev.issue.body, { ...ev.comment, issue: ev.issue.number });
} else console.log('usage: hq-bridge.mjs watch | once [since] | relay <issue> <commentId> | relay-event');
