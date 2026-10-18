// HQ wake backstop (Oct 18), a Val Town interval (cron) file in the same val as hq-wake-relay.mjs (val hqwake, file
// cron.ts). It covers the case where the page's own wake call never arrived AND the box bridge is dead: every run it
// reads only the TIMESTAMPS and plaintext m-<id> tags on the HQ inbox relay (no key, nothing decrypted) and pings
// #hq-chat once for the newest chat message that the box has not seen (<inbox>_seen) and nobody pinged for yet
// (<inbox>_wake). Hellos / swipes / refreshes carry no m- tag, so they never wake anyone from here.
// Env (shared with the HTTP file): INBOX_TOPIC, SLACK_WEBHOOK_URL, RELAY (default https://ntfy.sh).
const env = k => (globalThis.Deno?.env?.get?.(k)) ?? (globalThis.process?.env?.[k]) ?? '';
const RELAY = () => env('RELAY') || 'https://ntfy.sh';
const NET = 8000;
async function get(topic, since) {
  const r = await fetch(`${RELAY()}/${topic}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(NET) });
  if (!r.ok) throw new Error('relay ' + r.status);
  return (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m?.event === 'message');
}
const marker = async t => Math.max(0, ...(await get(t, 'latest').catch(() => [])).map(m => +m.message).filter(v => v > 0 && v <= Date.now() / 1000 + 60));
export default async function cron() {
  const topic = env('INBOX_TOPIC'), hook = env('SLACK_WEBHOOK_URL'); if (!topic || !hook) return console.log('not-configured');
  const now = Date.now() / 1000;
  const chats = (await get(topic, '2h')).filter(m => (m.tags || []).some(t => /^m-/.test(t)));
  const newest = Math.max(0, ...chats.map(m => m.time || 0));
  if (!newest) return console.log('idle');
  if (now - newest < 20) return console.log('too-new (the page wake and the bridge get the first try)');
  const [wake, seen] = await Promise.all([marker(`${topic}_wake`), marker(`${topic}_seen`)]);
  if (newest <= wake) return console.log('already-pinged');
  if (newest <= seen) return console.log('box-awake');
  const ct = new Date(newest * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const text = `:alarm_clock: *HQ wake (cron check)*: Chris sent something from the office at ${ct} CT and nothing has picked it up yet. ` +
    'Grok Bot: run `tools/hq-inbox.sh pending` (it reads the relay itself, files the message and claims it for this run), then answer it.';
  const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(NET) });
  if (!r.ok) return console.log('slack-failed', r.status);
  await fetch(`${RELAY()}/${topic}_wake`, { method: 'POST', body: String(newest), headers: { Cache: 'yes' }, signal: AbortSignal.timeout(NET) }).catch(() => {});
  console.log('pinged, lag', Math.round(now - newest), 's');
}
