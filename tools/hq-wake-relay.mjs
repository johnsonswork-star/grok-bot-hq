// HQ instant wake relay (Oct 17). An always-on HTTP endpoint (Val Town HTTP val or Deno Deploy app; plain
// web-standard fetch handler, no imports) that the office page POSTs to right after it puts an encrypted chat
// message on the ntfy relay. It holds the wake secret server-side and immediately pokes Grok Bot:
//   CURSOR_WEBHOOK_URL + CURSOR_WEBHOOK_KEY  -> the "HQ chat instant wake" webhook routine (preferred, no Slack hop)
//   SLACK_WEBHOOK_URL                        -> #hq-chat, which wakes the "Wake on HQ Slack ping" routine
// It never sees message text (the page sends only {mid}); the message itself stays end-to-end encrypted on ntfy.
// Abuse guard: the URL is public, so a ping only goes out when the ntfy inbox really has a message from the last
// 2 minutes that nobody pinged for yet (same <inbox>_wake marker the bridge and the GitHub Action use), and at most
// one ping per 8 s. Worst case an abuser causes a few extra wake runs; they can't read or post anything else.
// Env: CURSOR_WEBHOOK_HEADER (default Authorization, Bearer added), INBOX_TOPIC (public, from hq-link.js), ALLOWED_ORIGIN (default https://johnsonswork-star.github.io),
//      RELAY (default https://ntfy.sh). Test: body {"test":true} labels the ping [TEST, no reply needed].
const env = k => (globalThis.Deno?.env?.get?.(k)) ?? (globalThis.process?.env?.[k]) ?? '';
const RELAY = () => env('RELAY') || 'https://ntfy.sh';
const ORIGIN = () => env('ALLOWED_ORIGIN') || 'https://johnsonswork-star.github.io';
const NET = 8000;
let lastPing = 0;
const cors = o => ({ 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' });
const j = (o, status, h) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...h } });
async function latest(topic, since) {
  const r = await fetch(`${RELAY()}/${topic}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(NET) });
  if (!r.ok) throw new Error('relay ' + r.status);
  return (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m?.event === 'message');
}
export default async function handler(req) {
  const origin = req.headers.get('Origin') || '', ok = origin === ORIGIN(), h = ok ? cors(origin) : {};
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: h });
  if (req.method === 'GET') return j({ ok: true, service: 'hq-wake' }, 200, h);
  if (req.method !== 'POST' || !ok) return j({ ok: false }, 403, h);
  const t0 = Date.now(), now = t0 / 1000, topic = env('INBOX_TOPIC');
  let body = {}; try { body = await req.json(); } catch {}
  if (!topic) return j({ ok: false, why: 'not-configured' }, 500, h);
  if (t0 - lastPing < 8000) return j({ ok: true, sent: false, why: 'cooldown' }, 200, h);
  // the message the page just sent must be on the relay (retry briefly: ntfy is eventually consistent for a moment)
  let newest = 0;
  for (let i = 0; i < 3 && !newest; i++) {
    newest = Math.max(0, ...(await latest(topic, '2m').catch(() => [])).map(m => m.time || 0));
    if (!newest) await new Promise(r => setTimeout(r, 400));
  }
  if (!newest || newest < now - 120) return j({ ok: true, sent: false, why: 'no-recent-message' }, 200, h);
  const wake = Math.max(0, ...(await latest(`${topic}_wake`, 'latest').catch(() => [])).map(m => +m.message || 0).filter(v => v <= now + 60));
  if (newest <= wake) return j({ ok: true, sent: false, why: 'already-pinged' }, 200, h);
  lastPing = t0;
  // marker first, so the bridge (which checks it before its own Slack ping) never doubles up
  await fetch(`${RELAY()}/${topic}_wake`, { method: 'POST', body: String(newest), headers: { Cache: 'yes' }, signal: AbortSignal.timeout(NET) }).catch(() => {});
  const ct = new Date(newest * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const test = body?.test === true;
  const text = (test ? ':test_tube: *[TEST, no reply needed]* ' : '') +
    `:zap: *HQ wake (instant relay)*: Chris just sent something from the office (${ct} CT). ` +
    'Grok Bot: run `tools/hq-inbox.sh pending` (it starts the bridge and files the message), then answer it.';
  const sent = [];
  const cw = env('CURSOR_WEBHOOK_URL'), ck = env('CURSOR_WEBHOOK_KEY'), chd = env('CURSOR_WEBHOOK_HEADER') || 'Authorization';
  let hookOk = false;
  if (cw) {
    try {
      const auth = !ck ? {} : { [chd]: chd.toLowerCase() === 'authorization' && !/^\w+\s/.test(ck) ? `Bearer ${ck}` : ck };
      const r = await fetch(cw, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ source: 'grok-bot-hq', event: 'hq-chat-wake', relayTime: newest, test, text }), signal: AbortSignal.timeout(NET) });
      sent.push('webhook ' + r.status); hookOk = r.ok;
    } catch (e) { sent.push('webhook error'); }
  }
  const sw = env('SLACK_WEBHOOK_URL');
  if (sw && !hookOk) { // Slack is the fallback when the webhook routine is missing or refused
    try { const r = await fetch(sw, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(NET) }); sent.push('slack ' + r.status); }
    catch (e) { sent.push('slack error'); }
  }
  return j({ ok: true, sent: sent.length > 0, via: sent, ms: Date.now() - t0 }, 200, h);
}
// Deno Deploy: set env HQ_SELF_SERVE=1 so the file serves itself. Val Town HTTP vals use the default export as is.
if (env('HQ_SELF_SERVE') === '1' && globalThis.Deno?.serve) globalThis.Deno.serve(handler);
