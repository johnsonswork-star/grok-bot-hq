#!/usr/bin/env node
// HQ off-box wake (Oct 17). Runs in GitHub Actions (.github/workflows/hq-wake.yml) every 5 min, so a message Chris
// sends from the office still wakes Grok Bot while the box is paused (a paused box runs nothing, not even the bridge).
//   1. read only the TIMESTAMP of the newest message on the HQ inbox relay topic (content stays encrypted; this
//      job has no key and never decrypts anything)
//   2. `<topic>_seen` = newest relay time the box bridge has handled (the bridge publishes it after each batch)
//      `<topic>_wake` = newest relay time this job already pinged Slack for
//   3. newer than both => post ONE plain Slack ping to #hq-chat (incoming webhook from the Actions secret
//      SLACK_WEBHOOK_URL). That wakes the "Wake on HQ Slack ping" routine, whose run wakes the box, which files the
//      message (tools/hq-inbox.sh pending -> hq-bridge.mjs once) and answers it. The bridge then skips its own
//      Slack ping for that message, so there is one wake per message.
// Prints only a status word: the workflow log is public, so no times, ids or texts are logged.
// Env: SLACK_WEBHOOK_URL (secret), HQ_RELAY (default https://ntfy.sh), HQ_INBOX_TOPIC (default: read from hq-link.js),
//      HQ_WAKE_TEST (unix seconds: messages at/after it get a [TEST] ping even if the box saw them), DRY=1 (no posts).
import fs from 'node:fs';
const RELAY = process.env.HQ_RELAY || 'https://ntfy.sh';
const TOPIC = process.env.HQ_INBOX_TOPIC ||
  fs.readFileSync(new URL('../hq-link.js', import.meta.url), 'utf8').match(/const INBOX_TOPIC = '([^']+)'/)[1];
const NET = 10e3, now = () => Date.now() / 1000;
const get = async (topic, since) => {
  const r = await fetch(`${RELAY}/${topic}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(NET) });
  if (!r.ok) throw new Error('relay ' + r.status);
  return (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(m => m && m.event === 'message');
};
// marker topics are public-writable: accept only plain numbers that are not in the future
const marker = async t => Math.max(0, ...(await get(t, 'latest').catch(() => [])).map(m => +m.message).filter(v => v > 0 && v <= now() + 60));
const out = s => { console.log(s); process.exit(0); };

const msgs = await get(TOPIC, '30m');
const newest = Math.max(0, ...msgs.map(m => m.time || 0));
if (!newest) out('idle');
const test = +process.env.HQ_WAKE_TEST || 0, isTest = test > 0 && newest >= test;
if (newest <= await marker(`${TOPIC}_wake`)) out('already-pinged');
let seen = await marker(`${TOPIC}_seen`);
if (!isTest && newest <= seen) out('box-awake');
const age = now() - newest;
if (!isTest && age < 25) { await new Promise(r => setTimeout(r, (25 - age) * 1000)); seen = await marker(`${TOPIC}_seen`); if (newest <= seen) out('box-awake'); }
const ct = new Date(newest * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
const text = (isTest ? ':test_tube: *[TEST, no reply needed]* ' : '') +
  `:alarm_clock: *HQ wake (relay check)*: Chris sent something from the office at ${ct} CT and the box has not picked it up yet (box asleep). ` +
  'Grok Bot: run `tools/hq-inbox.sh pending` (it starts the bridge and files the message), then answer it.';
if (process.env.DRY) out('dry-would-ping');
const hook = process.env.SLACK_WEBHOOK_URL; if (!hook) { console.log('no-webhook'); process.exit(1); }
const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(NET) });
if (!r.ok) { console.log('slack-failed'); process.exit(1); }
await fetch(`${RELAY}/${TOPIC}_wake`, { method: 'POST', body: String(newest), headers: { Cache: 'yes' }, signal: AbortSignal.timeout(NET) }).catch(() => {});
out(isTest ? 'pinged-test' : 'pinged');
