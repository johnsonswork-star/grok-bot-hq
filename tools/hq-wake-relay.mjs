// HQ instant wake relay (Oct 17). An always-on HTTP endpoint (Val Town HTTP val or Deno Deploy app; plain
// web-standard fetch handler, no imports) that the office page POSTs to right after it puts an encrypted chat
// message on the ntfy relay. It holds the wake secret server-side and immediately pokes Grok Bot:
//   CURSOR_WEBHOOK_URL + CURSOR_WEBHOOK_KEY  -> the "HQ chat instant wake" webhook routine (preferred, no Slack hop)
//   SLACK_WEBHOOK_URL                        -> #hq-chat, which wakes the "Wake on HQ Slack ping" routine
// It never sees message text (the page sends only {mid}, and tags its ntfy publish with m-<mid> so the relay can
// check the id is real); the message itself stays end-to-end encrypted on ntfy.
// Abuse guard: the URL is public, so a ping only goes out when the ntfy inbox really has a message from the last
// 30 minutes that nobody pinged for yet (same <inbox>_wake marker the bridge and the cron check use), and at most
// one ping per 3 s (a request inside the cooldown waits, it is not dropped). Worst case an abuser causes a few extra wake runs; they can't read or post anything else.
// Env: CURSOR_WEBHOOK_HEADER (default Authorization, Bearer added), INBOX_TOPIC (public, from hq-link.js), ALLOWED_ORIGIN (default https://johnsonswork-star.github.io),
//      RELAY (default https://ntfy.sh). Test: body {"test":true} labels the ping [TEST, no reply needed].
const env = k => (globalThis.Deno?.env?.get?.(k)) ?? (globalThis.process?.env?.[k]) ?? '';
const RELAY = () => env('RELAY') || 'https://ntfy.sh';
const ORIGIN = () => env('ALLOWED_ORIGIN') || 'https://johnsonswork-star.github.io';
const NET = 8000;
// Durable, atomic dedupe: each Val Town request may run in a fresh isolate, so memory alone can't stop a double ping.
// On Val Town this uses the val's own SQLite (std/sqlite); anywhere else (Deno Deploy, local tests) it falls back to memory.
let db = null, mem = new Map();
async function store() {
  if (db !== null) return db;
  db = false;
  if (env('HQ_STORE') !== 'memory' && globalThis.Deno) {
    try { const m = await import('https://esm.town/v/std/sqlite/main.ts'); db = m.sqlite;
      await db.execute('create table if not exists wake(k text primary key, at integer)'); } catch { db = false; }
  }
  return db;
}
// first caller for key k wins; for 'cool' a new claim only wins once the old one is older than ms
async function claim(k, now, ms = 0) {
  const s = await store();
  if (s) {
    const r = ms
      ? await s.execute({ sql: 'insert into wake(k, at) values (?, ?) on conflict(k) do update set at = excluded.at where wake.at < ?', args: [k, now, now - ms] })
      : await s.execute({ sql: 'insert or ignore into wake(k, at) values (?, ?)', args: [k, now] });
    return r.rowsAffected === 1;
  }
  const old = mem.get(k); if (old !== undefined && (!ms || old >= now - ms)) return false;
  mem.set(k, now); return true;
}
async function unclaim(k) { const s = await store(); if (s) await s.execute({ sql: 'delete from wake where k = ?', args: [k] }).catch(() => {}); else mem.delete(k); }
// Oct 18: every request outcome is kept (time, outcome, relay lag, ms; never the id or any text) so a missed wake can
// be explained afterwards: GET ?diag=1 lists the last 40. Also console.log for the Val Town log view.
async function note(why, lag, ms) {
  try { console.log('hq-wake', why, 'lag', lag, 's', ms, 'ms'); } catch {}
  const s = await store().catch(() => false); if (!s) return;
  try {
    await s.execute('create table if not exists wlog(at integer, why text, lag integer, ms integer)');
    await s.execute({ sql: 'insert into wlog(at, why, lag, ms) values (?, ?, ?, ?)', args: [Date.now(), why, lag ?? -1, ms ?? -1] });
    await s.execute({ sql: 'delete from wlog where at < ?', args: [Date.now() - 7 * 864e5] });
  } catch {}
}
async function diag() {
  const s = await store().catch(() => false); if (!s) return [];
  try { const r = await s.execute('select at, why, lag, ms from wlog order by at desc limit 40');
    return r.rows.map(x => { const [at, why, lag, ms] = Array.isArray(x) ? x : [x.at, x.why, x.lag, x.ms];
      return { at: new Date(+at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT', why, lag, ms }; }); }
  catch { return []; }
}
const cors = o => ({ 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' });
const j = (o, status, h) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...h } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function latest(topic, since) {
  const r = await fetch(`${RELAY()}/${topic}/json?poll=1&since=${since}`, { signal: AbortSignal.timeout(NET) });
  if (!r.ok) throw new Error('relay ' + r.status);
  return (await r.text()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(m => m?.event === 'message');
}
export default async function handler(req) {
  const origin = req.headers.get('Origin') || '', ok = origin === ORIGIN(), h = ok ? cors(origin) : {};
  if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: h });
  if (req.method === 'GET') {
    const u = new URL(req.url);
    if (u.searchParams.get('diag') === '1') return j({ ok: true, recent: await diag() }, 200, h);
    return j({ ok: true, service: 'hq-wake', v: 3, store: (await store()) ? 'sqlite' : 'memory' }, 200, h);
  }
  if (req.method !== 'POST' || !ok) return j({ ok: false }, 403, h);
  const t0 = Date.now();
  try { return await wakeFor(req, t0, h); }
  catch (e) { await note('error ' + String(e?.message || e).slice(0, 60), null, Date.now() - t0); return j({ ok: false, why: 'error' }, 500, h); }
}
async function wakeFor(req, t0, h) {
  const now = t0 / 1000, topic = env('INBOX_TOPIC');
  // the page now sends text/plain (no CORS preflight, so iOS keepalive works); older pages send application/json
  let body = {}; try { body = JSON.parse(await req.text()); } catch {}
  if (!topic) { await note('not-configured'); return j({ ok: false, why: 'not-configured' }, 500, h); }
  // the message the page just sent must be on the relay, tagged with its id (the page publishes ?tags=m-<mid>).
  // Look back 30 min (the page retries a lost wake for up to 30 min) and wait up to ~6 s for ntfy to show it.
  const mid = typeof body?.mid === 'string' && /^[\w-]{4,40}$/.test(body.mid) ? body.mid : '';
  if (!mid) { await note('bad-mid', null, Date.now() - t0); return j({ ok: false, why: 'bad-mid' }, 400, h); }
  let newest = 0;
  for (let i = 0; i < 8 && !newest; i++) {
    const hit = (await latest(topic, '30m').catch(() => [])).find(m => (m.tags || []).includes('m-' + mid));
    newest = hit?.time || 0;
    if (!newest) await sleep(750);
  }
  if (!newest) { await note('unknown-mid', null, Date.now() - t0); return j({ ok: false, why: 'unknown-mid' }, 404, h); }
  const lag = Math.round(now - newest);
  const wake = Math.max(0, ...(await latest(`${topic}_wake`, 'latest').catch(() => [])).map(m => +m.message || 0).filter(v => v <= now + 60));
  if (newest <= wake) { await note('already-pinged', lag, Date.now() - t0); return j({ ok: true, sent: false, why: 'already-pinged' }, 200, h); }
  let claimed = false; try { claimed = await claim('m:' + newest, t0); } catch { claimed = true; } // store down: ping anyway (a rare double beats a miss)
  if (!claimed) { await note('already-pinged', lag, Date.now() - t0); return j({ ok: true, sent: false, why: 'already-pinged' }, 200, h); }
  // short cooldown so a burst of sends makes one ping; wait it out instead of dropping the ping (the old code returned 429)
  for (let i = 0; i < 4; i++) { let c = true; try { c = await claim('cool', Date.now(), 3000); } catch {} if (c) break; await sleep(1000); }
  const ct = new Date(newest * 1000).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const test = body?.test === true;
  const text = (test ? ':test_tube: *[TEST, no reply needed]* ' : '') +
    `:zap: *HQ wake (instant relay)*: Chris just sent something from the office (${ct} CT). ` +
    'Grok Bot: run `tools/hq-inbox.sh pending` (it reads the relay itself, files the message and claims it for this run), then answer it.';
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
  let slackOk = false;
  if (sw && !hookOk) { // Slack is the fallback when the webhook routine is missing or refused; one retry
    for (let i = 0; i < 2 && !slackOk; i++) {
      try { const r = await fetch(sw, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(NET) }); sent.push('slack ' + r.status); slackOk = r.ok; }
      catch (e) { sent.push('slack error'); }
      if (!slackOk && i === 0) await sleep(800);
    }
  }
  if (!hookOk && !slackOk) await unclaim('m:' + newest).catch(() => {}); // let the page's retry try again
  else await fetch(`${RELAY()}/${topic}_wake`, { method: 'POST', body: String(newest), headers: { Cache: 'yes' }, signal: AbortSignal.timeout(NET) }).catch(() => {}); // the bridge and the cron check skip their own ping
  await note(hookOk || slackOk ? (test ? 'pinged-test' : 'pinged') : 'ping-failed ' + sent.join(','), lag, Date.now() - t0);
  return j({ ok: hookOk || slackOk, sent: hookOk || slackOk, via: sent, lag, ms: Date.now() - t0 }, hookOk || slackOk ? 200 : 502, h);
}
// Deno Deploy: set env HQ_SELF_SERVE=1 so the file serves itself. Val Town HTTP vals use the default export as is.
if (env('HQ_SELF_SERVE') === '1' && globalThis.Deno?.serve) globalThis.Deno.serve(handler);
