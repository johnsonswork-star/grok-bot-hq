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
const LABEL = 'hq-chat', RELAY = process.env.HQ_RELAY || 'https://ntfy.sh';
const DIR = `${os.homedir()}/.config/grok-bot-hq`, STATE = `${DIR}/bridge-state.json`;
const log = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), ...a);
const cfg = () => JSON.parse(process.env.HQ_INBOX_KEY || fs.readFileSync(`${DIR}/inbox-key.json`, 'utf8'));
// Every network call is bounded (Oct 17): gh is killed after 20 s, every fetch aborts after NET_MS (10 s).
const NET_MS = 10e3;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, killSignal: 'SIGKILL' }).trim();
const state = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { done: [] }; } };
const uniq = (a = [], b = []) => [...new Set([...a, ...b])].slice(-500);
const saveState = s => { try { fs.mkdirSync(DIR, { recursive: true }); const d = state();
  fs.writeFileSync(STATE, JSON.stringify({ ...d, ...s, done: uniq(d.done, s.done), relayed: uniq(d.relayed, s.relayed) })); } catch {} };
// HQ #58: each worker remembers what Chris says to them (tools/worker-memory.mjs). Best effort: never blocks filing.
let wm = null; const memory = async () => wm ||= await import(new URL('./worker-memory.mjs', import.meta.url)).catch(e => { log('worker-memory load failed', e.message); return null; });
// HQ #59: one office chat. Small talk + safe in-game commands are answered by the cheap office bot (tools/office-chat.mjs); real orders go on to Grok Bot.
let oc = null; const officeChat = async () => oc ||= await import(new URL('./office-chat.mjs', import.meta.url)).catch(e => { log('office-chat load failed', e.message); return null; });
const chicago = iso => { try { return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT'; } catch { return iso; } };

// Instant wake: POST each newly filed HQ message to the Grok Bot webhook routine `hq-chat-instant-wake`.
// Config (first found wins, per key): env WEBHOOK_URL / WEBHOOK_KEY, then ~/.config/grok-bot-hq/hq-webhook.env,
// then tools/hq-webhook.env. See tools/hq-webhook.env.example. Missing URL => silent no-op (logged once).
function loadWebhook() {
  const out = { url: process.env.WEBHOOK_URL || '', key: process.env.WEBHOOK_KEY || '', header: process.env.WEBHOOK_KEY_HEADER || '' };
  for (const f of [`${DIR}/hq-webhook.env`, new URL('./hq-webhook.env', import.meta.url).pathname]) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(WEBHOOK_URL|WEBHOOK_KEY|WEBHOOK_KEY_HEADER)\s*=\s*(.*?)\s*$/); if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, ''), k = { WEBHOOK_URL: 'url', WEBHOOK_KEY: 'key', WEBHOOK_KEY_HEADER: 'header' }[m[1]];
      if (v && !out[k]) out[k] = v;
    }
  }
  return out;
}
// Email wake (alternative to webhook): if WAKE_EMAIL=<agent inbox> is set in hq-webhook.env (or env), ask ntfy.sh to
// email that inbox for each new HQ message, so an email-triggered routine on that inbox wakes Grok Bot instantly.
// Only the issue number/link is emailed (message text stays in the private GitHub inbox). ntfy.sh anonymous email is rate-limited.
function loadWakeEmail() {
  if (process.env.WAKE_EMAIL) return process.env.WAKE_EMAIL;
  for (const f of [`${DIR}/hq-webhook.env`, new URL('./hq-webhook.env', import.meta.url).pathname]) {
    try { const m = fs.readFileSync(f, 'utf8').match(/^\s*WAKE_EMAIL\s*=\s*['"]?([^'"\s]+)/m); if (m) return m[1]; } catch {}
  }
  return '';
}
async function fireEmail(p) {
  const to = loadWakeEmail(); if (!to || p.test === undefined && !p.issue) return;
  try {
    const topic = 'hqwake-' + cfg().inboxTopic.slice(-12);
    const r = await fetch(`${RELAY}/${topic}`, { method: 'POST', headers: { Email: to, Title: `HQ chat #${p.issue} for ${p.to}` },
      body: `New Bot HQ chat message #${p.issue} for ${p.to}. Run tools/hq-inbox.sh pending and reply. ${p.url}`, signal: AbortSignal.timeout(NET_MS) });
    log('email wake for issue', p.issue, '->', r.status);
  } catch (e) { log('email wake error', e.message); }
}
// Slack wake: post each new HQ message to Slack #hq-chat so a Slack-triggered Grok Bot routine wakes instantly.
// Config (env first, then ~/.config/grok-bot-hq/slack.env, then tools/slack.env). See tools/slack.env.example.
//   SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...      (incoming webhook; simplest), and/or
//   SLACK_BOT_TOKEN=xoxb-...  + SLACK_CHANNEL_ID=C0123456789     (chat.postMessage via Web API)
// Nothing configured => silent no-op (logged once).
function loadSlack() {
  const keys = ['SLACK_WEBHOOK_URL', 'SLACK_BOT_TOKEN', 'SLACK_CHANNEL_ID'];
  const out = Object.fromEntries(keys.map(k => [k, process.env[k] || '']));
  for (const f of [`${DIR}/slack.env`, new URL('./slack.env', import.meta.url).pathname]) {
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*(SLACK_WEBHOOK_URL|SLACK_BOT_TOKEN|SLACK_CHANNEL_ID)\s*=\s*(.*?)\s*$/); if (!m) continue;
      const v = m[2].replace(/^['"]|['"]$/g, ''); if (v && !out[m[1]]) out[m[1]] = v;
    }
  }
  return out;
}
let slackWarned = false;
async function fireSlack(p) {
  const text = `:speech_balloon: *HQ chat #${p.issue}* from Chris → *${p.to}*\n>${String(p.text || '').replace(/\n/g, '\n>')}\n` +
    (p.shot ? `:camera: View screenshot: \`${p.shot}\` (on the box; open with Read)\n` : '') + (p.url || '');
  return postSlack(text, 'issue ' + p.issue);
}
async function postSlack(text, tag) {
  const s = loadSlack();
  const sent = [];
  try {
    if (s.SLACK_WEBHOOK_URL) {
      const r = await fetch(s.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.timeout(NET_MS) });
      sent.push('webhook ' + r.status);
    } else if (s.SLACK_BOT_TOKEN && s.SLACK_CHANNEL_ID) {
      const r = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${s.SLACK_BOT_TOKEN}` },
        body: JSON.stringify({ channel: s.SLACK_CHANNEL_ID, text }), signal: AbortSignal.timeout(NET_MS) });
      const j = await r.json().catch(() => ({})); sent.push('api ' + (j.ok ? 'ok' : j.error || r.status));
    } else { if (!slackWarned) { slackWarned = true; log('slack not configured (no SLACK_WEBHOOK_URL or SLACK_BOT_TOKEN+SLACK_CHANNEL_ID); skipping slack wake'); } return; }
    log('slack wake for', tag, '->', sent.join(', '));
  } catch (e) { log('slack wake error', e.message); }
}
let webhookWarned = false;
async function fireWebhook(payload) {
  const w = loadWebhook();
  if (!w.url) { if (!webhookWarned) { webhookWarned = true; log('webhook not configured (no WEBHOOK_URL); skipping instant wake'); } return; }
  const headers = { 'Content-Type': 'application/json' };
  if (w.key) { const h = w.header || 'Authorization'; headers[h] = h.toLowerCase() === 'authorization' && !/^\w+\s/.test(w.key) ? `Bearer ${w.key}` : w.key; }
  try {
    const r = await fetch(w.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(NET_MS) });
    log('webhook fired for issue', payload.issue, '->', r.status);
  } catch (e) { log('webhook error', e.message); }
}

let labelOk = false;
function ensureLabel() {
  if (labelOk) return; labelOk = true;
  try { gh('label', 'create', LABEL, '--repo', REPO, '--color', 'D4AF37', '--description', 'Message from Bot HQ chat'); } catch {}
}
// Dedupe (Oct 17): one issue per mid, ever, across every bridge process (watch + parallel `once` runs from
// hq-inbox.sh pending). A mid is claimed by atomically creating ~/.config/grok-bot-hq/mids/<mid> (O_EXCL), so two
// processes handling the same relay message can never both file it. GitHub search is only a backup (its index lags).
const MIDS = `${DIR}/mids`;
const midFile = mid => `${MIDS}/${String(mid).replace(/[^\w-]/g, '_').slice(0, 80)}`;
function claimMid(mid) {
  try { fs.mkdirSync(MIDS, { recursive: true, mode: 0o700 }); fs.writeFileSync(midFile(mid), `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx', mode: 0o600 }); return true; }
  catch (e) { if (e.code === 'EEXIST') return false; log('mid claim error (not filing)', e.message); return false; }
}
const releaseMid = mid => { try { fs.unlinkSync(midFile(mid)); } catch {} };
const midSeen = mid => { try { fs.accessSync(midFile(mid)); return true; } catch { return false; } };
function alreadyFiled(mid, st) {
  if (st.done.includes(mid) || state().done?.includes(mid) || midSeen(mid)) return true;
  try { return gh('issue', 'list', '--repo', REPO, '--state', 'all', '--search', `"hq-mid:${mid}" in:body`, '--json', 'number', '-q', 'length') !== '0'; }
  catch { return false; }
}
// Screenshots: the iPad seals a JPEG of the 3D view inside the message (p.shot = data URL). Envelopes > 4 KB arrive
// as ntfy attachments (m.attachment.url, kept ~3 h), so fetch those. Each shot is saved to
// ~/.config/grok-bot-hq/shots/<mid>.jpg (Grok Bot opens it with Read) and, best effort, committed to the private
// inbox repo under shots/ so it also shows inline on the GitHub issue.
const SHOTS = `${DIR}/shots`;
async function envelopeText(m) {
  if (m.attachment?.url) {
    const r = await fetch(m.attachment.url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('attachment ' + r.status);
    return await r.text();
  }
  return m.message;
}
function saveShot(mid, dataUrl) {
  const mm = String(dataUrl || '').match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/); if (!mm) return null;
  const ext = mm[1] === 'png' ? 'png' : 'jpg', name = `${String(mid).replace(/[^\w-]/g, '')}.${ext}`;
  const file = `${SHOTS}/${name}`;
  try { fs.mkdirSync(SHOTS, { recursive: true, mode: 0o700 }); fs.writeFileSync(file, Buffer.from(mm[2], 'base64'), { mode: 0o600 }); }
  catch (e) { log('shot save error', e.message); return null; }
  let repoUrl = '';
  try {
    const tmp = `${SHOTS}/.put-${name}.json`; // body via file: base64 is too long for one argv string
    fs.writeFileSync(tmp, JSON.stringify({ message: `HQ shot ${name}`, content: mm[2] }), { mode: 0o600 });
    try { gh('api', '-X', 'PUT', `repos/${REPO}/contents/shots/${name}`, '--input', tmp, '--jq', '.content.path'); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
    repoUrl = `https://github.com/${REPO}/blob/main/shots/${name}?raw=true`;
  } catch (e) { log('shot repo upload failed (local copy kept)', String(e.stderr || e.message).slice(0, 160)); }
  return { file, repoUrl };
}
// Chat fix (Oct 17): register every device that talks to the bridge in devices.json, so the shared office chat feed
// (<topic>_chat, tools/office-chat.mjs publisher) reaches it even while work-live / inbox feeds are paused.
// A brand new Safari tab or Home Screen app has its own key, so without this it saw no replies from other contexts.
const DEVICES = `${DIR}/devices.json`;
function registerDevice(d) {
  if (!d?.id || !d?.topic || !d?.pub) return false;
  let known = {}; try { known = JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch {}
  const cur = known[d.id];
  if (cur && cur.topic === d.topic && JSON.stringify(cur.pub) === JSON.stringify(d.pub)) return false;
  known[d.id] = { topic: d.topic, pub: d.pub };
  try { fs.writeFileSync(DEVICES, JSON.stringify(known), { mode: 0o600 }); log('registered device', d.id); } catch (e) { log('device register error', e.message); return false; }
  return true;
}
// Instant auto-ack (Oct 17): the moment a message is filed for Grok Bot, a short reply bubble goes back to the sending
// device so Chris sees an answer within seconds. Same id + text as the office feed's route line, so the 2D chat de-dupes it.
const autoAckText = (issue, tri) => tri?.cmds?.length
  ? `Got it, the office moves are done and I'm on the rest (HQ #${issue}). Full answer coming shortly.`
  : `Got it, I'm on it (HQ #${issue}). Full answer coming shortly.`;
async function sendAutoAck(p, issue, tri) {
  const d = p.device; if (!d?.topic || !d?.pub || !issue) return;
  try {
    const msg = { id: 'g-' + p.mid, ref: issue, from: 'Grok Bot', text: autoAckText(issue, tri), at: new Date().toISOString() };
    const r = await fetch(`${RELAY}/${d.topic}`, { method: 'POST', signal: AbortSignal.timeout(NET_MS), body: JSON.stringify(await seal(msg, d.pub)) });
    log('auto-ack issue', issue, 'to device', d.id, r.status);
  } catch (e) { log('auto-ack error', e.message); }
}
// Off-box wake (tools/hq-wake-check.mjs in GitHub Actions) markers on the relay, plain unix seconds only:
//   <inbox>_seen  newest relay time this box has handled (published after each batch), so the Action stays quiet
//   <inbox>_wake  newest relay time the Action already pinged Slack for, so the bridge skips a second ping
async function publishSeen(t) {
  if (!t) return; try { await fetch(`${RELAY}/${cfg().inboxTopic}_seen`, { method: 'POST', body: String(t), headers: { Cache: 'yes' }, signal: AbortSignal.timeout(NET_MS) }); } catch (e) { log('seen marker error', e.message); }
}
async function wakeMarker() {
  try { const r = await fetch(`${RELAY}/${cfg().inboxTopic}_wake/json?poll=1&since=latest`, { signal: AbortSignal.timeout(5000) });
    return Math.max(0, ...(await r.text()).split('\n').filter(Boolean).map(l => +JSON.parse(l).message || 0).filter(v => v <= Date.now() / 1000 + 60)); }
  catch { return 0; }
}
async function handle(m, priv, st) {
  if (m.event !== 'message' || !(m.message || m.attachment?.url)) return;
  let p; try { p = await open(JSON.parse(await envelopeText(m)), priv); } catch { return log('skip undecryptable', m.id); }
  // already-handled mids (relay replays on catch-up) don't re-register, so a removed test device stays removed
  const replay = st.lastTime && m.time && m.time <= st.lastTime; // `once` catch-up re-reads 12 h: old hellos must not re-register pruned devices
  try { if (!replay && !(p.mid && (st.done.includes(p.mid) || midSeen(p.mid)))) registerDevice(p.device); } catch {}
  if (p.type === 'hello') return; // device check-in on page load: registration only (no issue, no Slack)
  if (p.type === 'refresh') return handleRefresh(p, st);
  if (p.type === 'pick') return handlePick(p, st);
  if (p.type === 'swipe') return handleSwipe(p, st); // HQ #85: design-trainer wall swipes -> design-train/*.jsonl (no issue, no Slack)
  if (p.type === 'suggest') return handleSuggest(p, st); // HQ #92: Design Trainer Suggestion Box -> design-train/suggestions.jsonl
  if (p.direct) return handleDirect(p, st); // HQ #63: Direct tab = 1:1 with a teammate, never filed for Grok Bot, no Slack wake
  if (!p.mid || alreadyFiled(p.mid, st)) return;
  if (!claimMid(p.mid)) return log('dup mid skipped', p.mid);
  let tri = null; try { const O = await officeChat(); if (O) { const r = await O.ingest(p, { log }); tri = r.tri; if (r.handled) { st.done.push(p.mid); saveState(st); return; } } } catch (e) { log('office-chat triage error (filing for Grok Bot)', e.message); }
  const shot = p.shot ? saveShot(p.mid, p.shot) : null;
  if (p.shot && shot) log('shot saved', shot.file);
  const to = String(p.to || 'Grok Bot').slice(0, 60), text = String(p.text || '');
  const snippet = text.replace(/\s+/g, ' ').slice(0, 60) + (text.length > 60 ? '…' : '');
  const team = to === 'Grok Bot' ? 'Grok Bot (+ team)' : `${to} (via Grok Bot + team)`;
  const meta = { mid: p.mid, ntfy: m.id, device: p.device };
  const shotMd = shot ? `\n\n**📸 Chris's view when he sent this:**\n` + (shot.repoUrl ? `![HQ view](${shot.repoUrl})\n` : '') +
      `Local copy on Grok Bot's box: \`${shot.file}\` (open with Read)` : p.shot ? '\n\n_📸 Screenshot came in but could not be saved._' : '';
  const body = `**From:** Chris (Bot HQ)\n**To:** ${team}\n**Sent:** ${chicago(p.ts)} (${p.ts})\n\n---\n\n${text}${shotMd}\n\n---\n` +
    `_Reply with \`tools/hq-inbox.sh reply <n> "text" [Bot Name]\` (or comment here, start with \`**Bot Name:**\`). Replies show up in the HQ chat on Chris's iPad._\n\n<!-- hq-mid:${p.mid} -->\n<!-- hq-meta ${JSON.stringify(meta)} -->`;
  ensureLabel();
  let url; try { url = gh('issue', 'create', '--repo', REPO, '--title', `HQ chat → ${to}: ${snippet}`, '--body', body, '--label', LABEL); }
  catch (e) { releaseMid(p.mid); throw e; } // not filed: free the claim so a retry can file it
  st.done.push(p.mid); saveState(st);
  log('filed', url);
  // Wake queue: one JSON line per new HQ message so Grok Bot's poll routine (or anything else) can pick it up.
  const evt = { source: 'grok-bot-hq', event: 'hq-chat', issue: +url.split('/').pop(), url, to, text, ts: p.ts, filedAt: new Date().toISOString(),
    ...(shot ? { shot: shot.file } : {}) };
  try { fs.appendFileSync(`${DIR}/queue.jsonl`, JSON.stringify(evt) + '\n'); } catch {}
  try { const W = await memory(); if (W) { const r = W.logHq({ issue: evt.issue, to, text, at: p.ts, src: 'hq' }); W.markSynced(evt.issue); log('memory: remembered by', r.join(', ') || '-'); } } catch (e) { log('memory error', e.message); }
  await sendAck(p, evt.issue);
  await sendAutoAck(p, evt.issue, tri);
  try { (await officeChat())?.noteGrok(p, evt.issue, tri); } catch {}
  await fireWebhook(evt);
  await fireEmail(evt);
  if (m.time && (await wakeMarker()) >= m.time) log('slack wake skipped for issue', evt.issue, '(off-box relay check already pinged)');
  else await fireSlack(evt);
}

// HQ #63 Direct tab: Chris talks 1:1 to one teammate. tools/direct.mjs answers in character (free), logs the thread, and queues
// it for the REAL teammate agent when one sits behind that desk (~/.config/grok-bot-hq/teammate-inbox/<bot>.jsonl).
// No GitHub issue, no Slack #hq-chat wake: Grok Bot (Michael) is not in this path.
let dm = null; const direct = async () => dm ||= await import(new URL('./direct.mjs', import.meta.url)).catch(e => { log('direct load failed', e.message); return null; });
async function handleDirect(p, st) {
  if (!p.mid || st.done.includes(p.mid)) return;
  st.done.push(p.mid); saveState(st);
  try { const D = await direct(); if (D) await D.handle(p, { log }); } catch (e) { log('direct error', e.message); }
}

// Tap-to-refresh (HQ #29): Chris tapped REFRESH on the whiteboard BANK panel or the Family Inbox monitor. No GitHub issue:
// log it to refresh-requests.jsonl (tools/hq-inbox.sh refreshes / pending show the open ones) and ping Slack #hq-chat,
// which wakes Grok Bot to pull fresh data with its connector and push the feed. One Slack ping per kind per 3 min;
// requests older than 30 min (relay catch-up after a bridge restart) are logged but don't ping.
const REFRESH = {
  bank: { what: 'whiteboard BANK panel', how: 'Finance finance_list_accounts {} + finance_list_connections {} (write_to_file) -> `node tools/refresh-bank-feed.mjs <accounts-file> <connections-file>`' },
  inbox: { what: 'Family Inbox desk monitor', how: 'Gmail search_threads {query:"in:inbox -category:promotions -category:social", pageSize:40} (write_to_file) -> `node tools/refresh-inbox-feed.mjs <file>`' },
};
const RSTATE = `${DIR}/refresh-state.json`;
async function handleRefresh(p, st) {
  if (!p.mid || st.done.includes(p.mid)) return;
  st.done.push(p.mid); saveState(st);
  const kind = REFRESH[p.kind] ? p.kind : null; if (!kind) return log('unknown refresh kind', p.kind);
  const evt = { source: 'grok-bot-hq', event: 'refresh', kind, device: p.device?.id, ts: p.ts, at: new Date().toISOString() };
  try { fs.appendFileSync(`${DIR}/refresh-requests.jsonl`, JSON.stringify(evt) + '\n'); } catch {}
  log('refresh request', kind, 'from device', p.device?.id);
  if (Date.now() - (Date.parse(p.ts) || 0) > 30 * 60e3) return log('refresh', kind, 'is old (catch-up), no ping');
  let rs = {}; try { rs = JSON.parse(fs.readFileSync(RSTATE, 'utf8')); } catch {}
  if (Date.now() - (rs[kind] || 0) < 3 * 60e3) return log('refresh', kind, 'coalesced (pinged <3 min ago)');
  rs[kind] = Date.now(); try { fs.writeFileSync(RSTATE, JSON.stringify(rs)); } catch {}
  const r = REFRESH[kind];
  await postSlack(`:arrows_counterclockwise: *HQ refresh request: ${kind.toUpperCase()}*. Chris tapped REFRESH on the ${r.what} (${chicago(p.ts)}).\n` +
    `Grok Bot: ${r.how}. No HQ chat reply needed; the ${kind === 'bank' ? 'board' : 'monitor'} flips to FRESH when the new feed lands.`, 'refresh ' + kind);
}

// HQ #85: Chris swiped KEEP / PASS (or undo) on the design-trainer wall in the warehouse. Logged as training data by
// tools/swipe-train.mjs record(): design-train/swipes.jsonl (full) + train.jsonl (compact). No issue, no Slack, no AI.
let swm = null; const swipeTrain = async () => swm ||= await import(new URL('./swipe-train.mjs', import.meta.url)).catch(e => { log('swipe-train load failed', e.message); return null; });
async function handleSwipe(p, st) {
  if (!p.mid || st.done.includes(p.mid)) return;
  st.done.push(p.mid); st.done = st.done.slice(-2000); saveState(st);
  try { const S = await swipeTrain(); const n = S ? S.record(p, { log }) : 0; if (!n) log('swipe batch', p.mid, 'nothing new'); } catch (e) { log('swipe record error', e.message); }
}

// HQ #92: Chris typed a design/phrase idea in the Design Trainer Suggestion Box. Append to suggestions.jsonl for Kelly's
// next deck. No GitHub issue, no Slack, no AI. Same mid-dedupe as swipes.
const SUGGEST_F = `${DIR}/design-train/suggestions.jsonl`;
async function handleSuggest(p, st) {
  if (!p.mid || st.done.includes(p.mid)) return;
  st.done.push(p.mid); st.done = st.done.slice(-2000); saveState(st);
  const text = String(p.text || '').trim().slice(0, 280);
  if (!text) return log('suggest empty', p.mid);
  const row = {
    source: 'chris-suggestion',
    at: p.ts || new Date().toISOString(),
    received: new Date().toISOString(),
    device: p.device?.id || null,
    mid: p.mid,
    text,
    cardId: p.cardId ? String(p.cardId).slice(0, 80) : null,
    deck: p.deck ? String(p.deck).slice(0, 40) : null,
    test: p.test || undefined,
  };
  try {
    fs.mkdirSync(`${DIR}/design-train`, { recursive: true, mode: 0o700 });
    fs.appendFileSync(SUGGEST_F, JSON.stringify(row) + '\n', { mode: 0o600 });
    log('suggest', p.mid, text.slice(0, 60));
  } catch (e) { log('suggest write error', e.message); }
}

// Tap-to-pick (HQ #50): Chris tapped his favorite options on a desk screen (e.g. Kelly's badge cards H-L) and SUBMIT.
// Record them (picks.jsonl), move the bot's live feed + desk log past "waiting on Chris" (work-live.mjs picked), comment the
// picks on the HQ issue (so `hq-inbox.sh pending` lists it for Grok Bot, and the comment shows in Chris's chat), ping Slack.
async function handlePick(p, st) {
  if (!p.mid || st.done.includes(p.mid)) return;
  st.done.push(p.mid); saveState(st);
  const bot = String(p.bot || '').replace(/[^\w-]/g, ''), id = String(p.id || '').slice(0, 60);
  const picks = (Array.isArray(p.picks) ? p.picks : []).map(x => String(x).toUpperCase()).filter(x => /^[A-Z0-9]{1,3}$/.test(x)).slice(0, 12);
  if (!bot || !id || !picks.length) return log('bad pick', JSON.stringify({ bot, id, picks }));
  const evt = { source: 'grok-bot-hq', event: 'pick', bot, id, picks, issue: p.issue || null, device: p.device?.id, ts: p.ts, at: new Date().toISOString() };
  try { fs.appendFileSync(`${DIR}/picks.jsonl`, JSON.stringify(evt) + '\n'); } catch {}
  log('pick', bot, id, picks.join(','), 'from device', p.device?.id);
  try { (await memory())?.logEvent(bot, `Chris tapped his picks on my desk: ${picks.join(', ')} (${id})`, { issue: +p.issue || undefined, at: evt.at, src: 'pick' }); } catch {}
  let wl = '';
  try { wl = execFileSync('node', [new URL('./work-live.mjs', import.meta.url).pathname, 'picked', bot, id, picks.join(',')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim(); }
  catch (e) { wl = 'work-live picked failed: ' + String(e.stderr || e.message).slice(0, 160); }
  log(wl);
  let opts = []; try { opts = JSON.parse(fs.readFileSync(`${DIR}/work/${bot}.json`, 'utf8')).pick?.options || []; } catch {}
  const named = picks.map(k => { const o = opts.find(x => x.k === k); return o ? `**${k}** ${o.t}` : `**${k}**`; }).join(', ');
  const issue = +p.issue || 0;
  if (issue) {
    try { gh('issue', 'comment', String(issue), '--repo', REPO, '--body', `📌 Picks from the desk screen (tapped by Chris, ${chicago(p.ts)}): ${named}\n\nThe desk now shows them as picked and the work moved on to prep. Grok Bot / the designer: continue with these.\n\n<!-- hq-pick ${JSON.stringify({ bot, id, picks })} -->`); log('pick comment on issue', issue); }
    catch (e) { log('pick comment failed', String(e.stderr || e.message).slice(0, 160)); }
  }
  await postSlack(`:pushpin: *HQ pick: ${bot}* ${issue ? `(HQ #${issue}) ` : ''}Chris tapped ${picks.join(', ')} on the desk screen (${chicago(p.ts)}).\n` +
    `Grok Bot: continue the ${bot} task with these picks (see ${DIR}/work/${bot}.json + its desk log). ${issue ? `Reply on #${issue} with tools/hq-inbox.sh reply ${issue}.` : ''}`, 'pick ' + bot);
}

// Tell the sending iPad its message was filed (issue #n), encrypted to that device only. The iPad's chat shows "#n"
// and Grok Bot's desk monitor flips to "Grok Bot is on it (#n)". Nothing is published in plaintext.
async function sendAck(p, issue) {
  const d = p.device; if (!d?.topic || !d?.pub || !issue) return;
  try {
    const r = await fetch(`${RELAY}/${d.topic}`, { method: 'POST', signal: AbortSignal.timeout(NET_MS),
      body: JSON.stringify(await seal({ type: 'ack', id: 'ack-' + p.mid, mid: p.mid, issue, at: new Date().toISOString() }, d.pub)) });
    log('ack issue', issue, 'to device', d.id, r.status);
  } catch (e) { log('ack error', e.message); }
}

async function once(since = '12h') {
  const c = cfg(), priv = await importPriv(c.privJwk), st = state();
  const r = await fetch(`${RELAY}/${c.inboxTopic}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(NET_MS) });
  if (!r.ok) throw new Error('relay ' + r.status);
  let top = 0;
  for (const line of (await r.text()).split('\n')) if (line.trim()) { const m = JSON.parse(line); await handle(m, priv, st); if (m.id) st.last = m.id; if (m.event === 'message' && m.time > top) top = m.time; }
  if (top > (st.lastTime || 0)) st.lastTime = top;
  saveState(st);
  if (top) await publishSeen(top);
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

// One live bridge only: ~/.config/grok-bot-hq/bridge.pid. A second `watch` exits if the recorded pid is still alive.
function singleWatch() {
  const f = `${DIR}/bridge.pid`;
  try { const old = +fs.readFileSync(f, 'utf8').trim(); if (old && old !== process.pid) { process.kill(old, 0); log('bridge already running as pid', old, '- exiting'); process.exit(0); } } catch {}
  fs.writeFileSync(f, String(process.pid));
  process.on('exit', () => { try { if (+fs.readFileSync(f, 'utf8') === process.pid) fs.unlinkSync(f); } catch {} });
  for (const sg of ['SIGTERM', 'SIGINT']) process.on(sg, () => process.exit(0));
}
// Watch mode (Oct 17, v3): short polling, no long-lived stream (a stream can hang with no error).
//  - every POLL_MS (4 s): GET <relay>/<topic>/json?poll=1&since=<last handled id>, aborted after NET_MS (10 s)
//  - one loop, messages handled one at a time, the mid claim files make filing exactly-once across processes
//  - heartbeat file ~/.config/grok-bot-hq/bridge.heartbeat after every successful poll; tools/hq-supervisor.sh
//    (the only thing that restarts the bridge) kills + restarts it when the heartbeat is older than 30 s
//  - comment sweep (replies -> iPad) runs in the same loop every 20 s, so nothing runs in parallel
const HEARTBEAT = `${DIR}/bridge.heartbeat`, POLL_MS = +process.env.HQ_POLL_MS || 5000, SWEEP_MS = 20000; // 5 s = ntfy.sh's sustained anonymous rate (1 request / 5 s)
const beat = (extra = {}) => { try { fs.writeFileSync(HEARTBEAT, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...extra }) + '\n'); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pollOnce(c, priv, st) {
  const r = await fetch(`${RELAY}/${c.inboxTopic}/json?poll=1&since=${st.last || '12h'}`, { signal: AbortSignal.timeout(NET_MS) });
  if (!r.ok) throw new Error('relay ' + r.status);
  const lines = (await r.text()).split('\n').filter(l => l.trim());
  let n = 0;
  for (const l of lines) {
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.event !== 'message' || !m.id) continue;
    n++;
    try { await handle(m, priv, st); } catch (e) { log('file error', e.message); }
    st.last = m.id; if (m.time) st.lastTime = Math.max(st.lastTime || 0, m.time); saveState(st); // move past it either way: the mid claim was released if filing failed, and the next 12h catch-up (`once`) can retry
  }
  return n;
}
async function watch() {
  singleWatch();
  const c = cfg(), priv = await importPriv(c.privJwk);
  officeChat().then(O => O?.startPublisher(log)); // HQ #59: unified office chat feed -> <device topic>_chat (pushes only on change)
  const st = state();
  log('polling relay every', POLL_MS / 1000, 's (since', st.last || '12h', ')');
  let fails = 0, lastSweep = 0;
  for (;;) {
    const t0 = Date.now();
    try {
      const n = await pollOnce(c, priv, st);
      if (fails) log('relay poll ok again after', fails, 'failure(s)');
      fails = 0; beat({ last: st.last, n });
      if (n) { log('poll handled', n, 'message(s) in', Date.now() - t0, 'ms'); await publishSeen(st.lastTime); }
    } catch (e) { if (fails++ < 3 || fails % 15 === 0) log('relay poll error', e.name === 'TimeoutError' ? 'timeout' : e.message, `(x${fails})`); }
    if (Date.now() - lastSweep > SWEEP_MS) { lastSweep = Date.now(); try { await sweepComments(); } catch (e) { log('sweep error', String(e.message).slice(0, 160)); } }
    await sleep(Math.max(500, POLL_MS - (Date.now() - t0)));
  }
}

async function relayComment(issueBody, c) {
  const mm = (issueBody || '').match(/<!-- hq-meta (\{.*\}) -->/);
  if (!mm) return log('no device on issue, skip');
  const { device } = JSON.parse(mm[1]); if (!device?.topic || !device?.pub) return;
  const nb = (c.body || '').match(/^\s*\*\*([^*]{1,40}):\*\*\s*/);
  const msg = { id: String(c.id), ref: c.issue, from: nb ? nb[1].trim() : 'Grok Bot', text: nb ? c.body.slice(nb[0].length) : c.body, at: c.created_at };
  const r = await fetch(`${RELAY}/${device.topic}`, { method: 'POST', body: JSON.stringify(await seal(msg, device.pub)), signal: AbortSignal.timeout(NET_MS) });
  log('relayed comment', c.id, 'to device', device.id, r.status);
  try { (await officeChat())?.noteReply({ id: c.id, issue: c.issue, from: msg.from, text: msg.text, at: c.created_at }); } catch {}
  if (r.ok) { const st = state(); (st.relayed ||= []).push(String(c.id)); st.relayed = st.relayed.slice(-500); saveState(st); }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'watch') await watch();
else if (cmd === 'webhook-test') { const w = loadWebhook(); log('webhook configured:', !!w.url, 'key:', !!w.key); await fireWebhook({ source: 'grok-bot-hq', event: 'hq-chat-test', issue: 0, url: '', to: 'Grok Bot', text: 'webhook test (ignore)', ts: new Date().toISOString(), test: true }); }
else if (cmd === 'slack-test') { const s = loadSlack(); log('slack webhook:', !!s.SLACK_WEBHOOK_URL, 'token:', !!s.SLACK_BOT_TOKEN, 'channel:', s.SLACK_CHANNEL_ID || '-'); await fireSlack({ issue: 0, url: '', to: 'Grok Bot', text: a || 'Slack wake test from Bot HQ bridge (ignore)' }); }
else if (cmd === 'once') await once(a);
else if (cmd === 'pick-test') { const [, , , bt, pid, pk] = process.argv; await handlePick({ type: 'pick', bot: bt, id: pid, mid: 'pktest' + Date.now(), picks: String(pk || '').split(','), ts: new Date().toISOString(), device: { id: 'test' } }, state()); }
else if (cmd === 'refresh-test') { await handleRefresh({ type: 'refresh', kind: a || 'bank', mid: 'rftest' + Date.now(), ts: new Date().toISOString(), device: { id: 'test' } }, state()); }
else if (cmd === 'suggest-test') { await handleSuggest({ type: 'suggest', mid: 'sgtest' + Date.now(), text: a || 'FAMILY FIRST test idea', cardId: b || null, ts: new Date().toISOString(), device: { id: 'test' }, test: true }, state()); }
else if (cmd === 'relay') {
  const body = gh('issue', 'view', a, '--repo', REPO, '--json', 'body', '-q', '.body');
  const c = JSON.parse(gh('api', `repos/${REPO}/issues/comments/${b}`));
  await relayComment(body, { ...c, issue: +a });
} else if (cmd === 'relay-event') {
  const ev = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  await relayComment(ev.issue.body, { ...ev.comment, issue: ev.issue.number });
} else console.log('usage: hq-bridge.mjs watch | webhook-test | slack-test [text] | refresh-test [bank|inbox] | suggest-test [text] [cardId] | pick-test <bot> <id> <H,J> | once [since] | relay <issue> <commentId> | relay-event');
