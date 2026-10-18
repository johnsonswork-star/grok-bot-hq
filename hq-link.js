// HQ chat delivery: gets Chris's messages to Grok Bot + the team, instantly, with no login and no token on the device.
// The UI (chat.js) only calls:
//   send({ to, text, sentAt, shot? }) -> { status: 'delivered' | 'failed', ref?, shot: bool, error? }
//     shot = optional JPEG data URL of the 3D view. It is sealed inside the same encrypted envelope; big envelopes
//     become ntfy attachments (bridge fetches them). If the send with a shot fails, it retries text-only.
//   fetchReplies() -> [{ ref, id, from, text, at }]
//   isLinked() -> bool
//
// v2 transport = end-to-end encrypted relay:
//   iPad --(encrypted to the HQ inbox public key)--> ntfy.sh topic --> HQ bridge --> GitHub issue in the PRIVATE
//   repo johnsonswork-star/grok-bot-hq-inbox (label hq-chat). The bridge runs on Grok Bot's box (instant) with a
//   GitHub Action backup (hourly). Replies = issue comments, encrypted to THIS device's own key and relayed back
//   on a per-device ntfy topic. Only public keys are in this file; the relay only ever sees ciphertext.
import { seal, open, newKeyPair, importPriv, randomId } from './hq-crypto.js';

export const INBOX_REPO = 'johnsonswork-star/grok-bot-hq-inbox';
const RELAY = 'https://ntfy.sh';

// Headless checks must not touch the live inbox. navigator.webdriver (Playwright / Puppeteer /
// Headless Chrome) and window.__HQ_BLOCK_NTFY both count. Real iPad Safari is neither.
export function ntfyBlocked() {
  try {
    if (globalThis.__HQ_BLOCK_NTFY) return true;
    const nav = globalThis.navigator;
    if (!nav) return false;
    if (nav.webdriver) return true;
    if (/Headless/i.test(nav.userAgent || '')) return true;
  } catch (e) {}
  return false;
}
function relayBlocked(url) {
  const u = typeof url === 'string' ? url : '';
  // Headless checks must not reach the live inbox or the wake relay.
  return /ntfy\.sh/i.test(u) || /(^|\.)val\.run\b/i.test(u);
}
function relayFetch(url, opts) {
  if (ntfyBlocked() && relayBlocked(url)) {
    return Promise.resolve({ ok: false, status: 0, text: async () => '', json: async () => null });
  }
  return globalThis.fetch(url, opts);
}
const INBOX_TOPIC = 'hqin_fzBxIcY6ogUeBH0F8ziL4j6ngcEZ4mld';
const INBOX_PUB = {"kty":"EC","crv":"P-256","x":"z0ZG58n1mbb7yy0m4A4gqjxWAJ59Qq37Zw3Bn6nVEBQ","y":"W2tdYXFuAE_Y-q9P44DpwynBHUTSD7pAffCo_5vY37M"};
const DEV = 'hq.device';
// Instant wake (Oct 17): always-on relay (tools/hq-wake-relay.mjs, hosted off the box) that pings Grok Bot the moment a
// chat message is on the relay, even while Grok Bot's box is asleep. It gets only the message id, never the text.
// Empty = off (the GitHub Action check every 5 min and the box bridge still deliver).
export const WAKE_URL = 'https://grokbothq--fb701e76caaf11f1848b1607ee4eb77e.web.val.run/';
function wake(mid) {
  if (!WAKE_URL) return;
  // relayFetch refuses ntfy.sh and *.val.run while ntfyBlocked(), so headless tests never wake Grok Bot.
  try { relayFetch(WAKE_URL, { method: 'POST', mode: 'cors', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mid }) }).catch(() => {}); } catch (e) {}
}

(function cleanupOldSetup() { // v1 used a per-device GitHub key; drop it
  try { localStorage.removeItem('hq.key'); } catch (e) {}
  if (/hqkey=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
})();

let devP = null;
function device() {
  return devP ||= (async () => {
    let d = null; try { d = JSON.parse(localStorage.getItem(DEV) || 'null'); } catch (e) {}
    if (!d || !d.privJwk || !d.topic) {
      const k = await newKeyPair();
      d = { id: randomId(9), topic: 'hqout_' + randomId(18), ...k };
      try { localStorage.setItem(DEV, JSON.stringify(d)); } catch (e) {}
    }
    d.priv = await importPriv(d.privJwk);
    return d;
  })();
}
export const isLinked = () => !!(globalThis.crypto && crypto.subtle);

const SHOT_MAX = 1.5e6; // chars of data URL (~1.1 MB JPEG); bigger shots are dropped, text still goes

export async function send({ to, text, sentAt, shot, office, direct, mid: fixedMid }) {
  try {
    const d = await device();
    const mid = fixedMid || randomId(9); // HQ #59: chat.js picks the id up front so its instant office-bot line and the box's copy match
    const post = async withShot => {
      const msg = { v: 2, mid, to, text: text.slice(0, 2500), ts: sentAt.toISOString(),
        device: { id: d.id, topic: d.topic, pub: d.pubJwk }, ua: navigator.userAgent.slice(0, 120) };
      if (withShot) msg.shot = shot;
      if (direct) msg.direct = direct; // HQ #63: { bot } = 1:1 Direct tab; the box answers as that teammate, never files it for Grok Bot
      if (office) msg.office = office; // HQ #59: { near, bot, line } so the box's triage + reply match what the iPad already did
      // ?tags=m-<mid>: plaintext random id only, lets the wake relay confirm this message is real (no extra preflight)
      const r = await relayFetch(`${RELAY}/${INBOX_TOPIC}?tags=m-${encodeURIComponent(mid)}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
      if (!r.ok) throw new Error('relay ' + r.status);
    };
    const useShot = typeof shot === 'string' && shot.startsWith('data:image/') && shot.length < SHOT_MAX;
    if (useShot) {
      try { await post(true); wake(mid); return { status: 'delivered', ref: mid, shot: true }; }
      catch (e) { /* relay refused the big one: fall through to text-only (same mid, bridge de-dupes) */ }
    }
    await post(false);
    wake(mid);
    return { status: 'delivered', ref: mid, shot: false };
  } catch (e) {
    return { status: 'failed', error: e.message, shot: false };
  }
}

// Real replies only: comments on this device's messages, decrypted locally.
export async function fetchReplies() {
  const out = [];
  try {
    const d = await device();
    const r = await relayFetch(`${RELAY}/${d.topic}/json?poll=1&since=all`);
    if (!r.ok) return out;
    for (const line of (await r.text()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line); if (m.event !== 'message' || !m.message) continue;
        const p = await open(JSON.parse(m.message), d.priv);
        if (p.type && p.type !== 'ack') continue; // other feed types never show as chat bubbles
        if (p.type === 'ack') out.push({ type: 'ack', id: p.id, mid: p.mid, issue: p.issue, route: p.route, thread: p.thread, at: p.at }); // bridge: filed as issue #n (or route 'office' = office bot took it)
        else out.push({ ref: p.ref, id: p.id, from: p.from || 'Grok Bot', text: p.text, at: p.at, ...(p.office ? { office: true, via: p.via } : {}), ...(p.thread ? { thread: p.thread, who: p.who, real: !!p.real, standin: !!p.standin, handoff: p.handoff } : {}) });
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}

// Family Inbox desk feed: newest email headers (sender label, subject, time; lead/job mail already filtered out),
// encrypted on the box to THIS device's key and posted to its private ntfy topic `<topic>_inbox`
// (tools/refresh-inbox-feed.mjs). Never on the public site. Returns the newest feed or null.
export async function fetchInboxFeed() {
  try {
    const d = await device();
    const r = await relayFetch(`${RELAY}/${d.topic}_inbox/json?poll=1&since=all`, { cache: 'no-store' });
    if (!r.ok) return null;
    const lines = (await r.text()).split('\n').filter(l => l.trim()).reverse();
    for (const line of lines) {
      try {
        const m = JSON.parse(line); if (m.event !== 'message' || !m.message) continue;
        const p = await open(JSON.parse(m.message), d.priv);
        if (p.type === 'inbox' && Array.isArray(p.items)) return p;
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

// Whiteboard BANK panel feed: read-only balances (redacted: institution, account name, last 4, balances, totals),
// encrypted on the box to THIS device's key and posted to `<topic>_bank` (tools/refresh-bank-feed.mjs).
// Never on the public site. Returns the newest feed or null.
export async function fetchBankFeed() {
  try {
    const d = await device();
    const r = await relayFetch(`${RELAY}/${d.topic}_bank/json?poll=1&since=all`, { cache: 'no-store' });
    if (!r.ok) return null;
    const lines = (await r.text()).split('\n').filter(l => l.trim()).reverse();
    for (const line of lines) {
      try {
        const m = JSON.parse(line); if (m.event !== 'message' || !m.message) continue;
        const p = await open(JSON.parse(m.message), d.priv);
        if (p.type === 'bank' && Array.isArray(p.accounts)) return p;
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

// Tap-to-refresh (HQ #29): the REFRESH marker on the whiteboard BANK panel / Family Inbox monitor sends a tiny encrypted
// request through the same HQ relay as chat. The bridge on Grok Bot's box sees type:'refresh', logs it to
// ~/.config/grok-bot-hq/refresh-requests.jsonl and pings Slack #hq-chat, which wakes Grok Bot to pull fresh data
// (Finance / Gmail connectors) and push the feed. No GitHub issue, no chat bubble. kind = 'bank' | 'inbox'.
export async function requestRefresh(kind) {
  try {
    const d = await device();
    const msg = { v: 2, type: 'refresh', kind: String(kind).slice(0, 20), mid: 'rf' + randomId(9), ts: new Date().toISOString(),
      device: { id: d.id, topic: d.topic, pub: d.pubJwk } };
    const r = await relayFetch(`${RELAY}/${INBOX_TOPIC}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
    return r.ok;
  } catch (e) { return false; }
}

// 2D office page load: encrypted hello so the bridge registers this device for the shared chat feed.
// The page sends it once, then again only after 24 hours (it stores the timestamp).
export async function hello() {
  try {
    const d = await device();
    const msg = { v: 2, type: 'hello', mid: 'hl' + randomId(9), ts: new Date().toISOString(),
      device: { id: d.id, topic: d.topic, pub: d.pubJwk } };
    const r = await relayFetch(`${RELAY}/${INBOX_TOPIC}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
    return r.ok;
  } catch (e) { return false; }
}

// This device's ntfy reply topic (the page also listens on `<topic>_chat`).
export async function deviceTopic() {
  try { return (await device()).topic || ''; } catch (e) { return ''; }
}

// Live work on desk screens (HQ #31): per-bot step / file / last output lines / design thumbnails, encrypted on the box
// to THIS device's key and posted to `<topic>_work` (tools/work-live.mjs). Big feeds (thumbnails) ride as an ntfy
// attachment (kept ~3 h, CORS-open); the iPad keeps its last copy. Only the newest message is read (since=latest),
// and nothing is re-downloaded unless its id changed. Returns { id, feed } | { id, same: true } | null.
let workId = null;
export async function fetchWorkFeed() {
  try {
    const d = await device();
    const r = await relayFetch(`${RELAY}/${d.topic}_work/json?poll=1&since=latest`, { cache: 'no-store' });
    if (!r.ok) return null;
    const line = (await r.text()).split('\n').filter(l => l.trim()).pop(); if (!line) return null;
    const m = JSON.parse(line); if (m.event !== 'message') return null;
    if (m.id === workId) return { id: m.id, same: true };
    let body = m.message;
    if (m.attachment?.url) { const a = await relayFetch(m.attachment.url, { cache: 'no-store' }); if (!a.ok) return null; body = await a.text(); }
    const p = await open(JSON.parse(body), d.priv);
    if (p.type !== 'work' || !p.bots) return null;
    workId = m.id; return { id: m.id, feed: p };
  } catch (e) { return null; }
}

// Tap-to-pick (HQ #50): Chris taps his favorite options on a desk screen (e.g. Kelly's badge cards) and SUBMIT. Same
// encrypted relay as chat / REFRESH; the bridge sees type:'pick', records it, moves that bot's live feed past
// "waiting on Chris", comments the picks on the HQ issue and pings Slack. picks = ['H', 'J'].
export async function requestPick({ bot, id, issue, picks }) {
  try {
    const d = await device();
    const msg = { v: 2, type: 'pick', bot: String(bot).slice(0, 30), id: String(id).slice(0, 60), issue: issue || null,
      picks: (picks || []).map(String).slice(0, 12), mid: 'pk' + randomId(9), ts: new Date().toISOString(),
      device: { id: d.id, topic: d.topic, pub: d.pubJwk } };
    const r = await relayFetch(`${RELAY}/${INBOX_TOPIC}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
    return r.ok;
  } catch (e) { return false; }
}

// HQ #59: the unified office chat (tools/office-chat.mjs on the box): Chris's messages from every device, office-bot replies,
// Grok Bot replies, teammates' lines + banter. Encrypted to THIS device and posted to `<topic>_chat` (newest only, big ones
// ride as an ntfy attachment). Returns { id, feed } | { id, same: true } | null.
let chatId = null;
export async function fetchChatFeed() {
  try {
    const d = await device();
    const r = await relayFetch(`${RELAY}/${d.topic}_chat/json?poll=1&since=latest`, { cache: 'no-store' });
    if (!r.ok) return null;
    const line = (await r.text()).split('\n').filter(l => l.trim()).pop(); if (!line) return null;
    const m = JSON.parse(line); if (m.event !== 'message') return null;
    if (m.id === chatId) return { id: m.id, same: true };
    let body = m.message;
    if (m.attachment?.url) { const a = await relayFetch(m.attachment.url, { cache: 'no-store' }); if (!a.ok) return null; body = await a.text(); }
    const p = await open(JSON.parse(body), d.priv);
    if (p.type !== 'office-chat' || !Array.isArray(p.items)) return null;
    chatId = m.id; return { id: m.id, feed: p };
  } catch (e) { return null; }
}

// HQ #85: design-trainer wall (warehouse). Deck = encrypted per-device feed `<topic>_swipe` from tools/swipe-train.mjs
// (real Printful + Tapstitch ideas + small thumbnails; newest only). Returns { id, feed } | { id, same: true } | null.
let swipeId = null;
export let swipeStatus = '';
const withTimeout = (u, ms) => relayFetch(u, { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined });
// force = the wall still has no deck: re-read even if we've already seen this message id (HQ #87)
export async function fetchSwipeDeck(force = false) {
  let d;
  try { d = await device(); } catch (e) { swipeStatus = 'device key error'; return null; }
  try {
    const r = await withTimeout(`${RELAY}/${d.topic}_swipe/json?poll=1&since=latest`, 20000);
    if (!r.ok) throw new Error('relay ' + r.status);
    const line = (await r.text()).split('\n').filter(l => l.trim()).pop(); if (!line) throw new Error('relay empty');
    const m = JSON.parse(line); if (m.event !== 'message') throw new Error('relay no msg');
    if (m.id === swipeId && !force) return { id: m.id, same: true };
    let body = m.message;
    if (m.attachment?.url) { const a = await withTimeout(m.attachment.url, 30000); if (!a.ok) throw new Error('relay file ' + a.status); body = await a.text(); }
    const p = await open(JSON.parse(body), d.priv);
    if (p.type !== 'swipe-deck' || !Array.isArray(p.cards)) throw new Error('relay bad deck');
    swipeId = m.id; swipeStatus = 'relay ok'; return { id: m.id, feed: p };
  } catch (e) { swipeStatus = String(e?.message || e).slice(0, 60); }
  // HQ #87 fallback: the same deck, still encrypted to THIS device's key, hosted on Pages (swipe/<sha256(topic)>.json)
  try {
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d.topic)))).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    const r = await withTimeout(new URL(`./swipe/${h}.json?t=${Date.now()}`, import.meta.url).href, 30000);
    if (!r.ok) throw new Error('pages ' + r.status);
    const w = await r.json(); const p = await open(w.env || w, d.priv);
    if (p.type !== 'swipe-deck' || !Array.isArray(p.cards)) throw new Error('pages bad deck');
    swipeStatus = 'pages ok'; return { id: 'pages:' + (w.id || p.id), feed: p };
  } catch (e) { swipeStatus += ' · ' + String(e?.message || e).slice(0, 50); return null; }
}
// Swipes go back through the same encrypted relay as chat (type:'swipe'); the bridge logs them as training data.
// items = [{ mid, sid, at, cardId, decision: 'keep'|'pass'|'undo', undoes?, deck, round, pos, total, card }]
export async function sendSwipes(items) {
  try {
    const d = await device();
    const msg = { v: 2, type: 'swipe', mid: 'sw' + randomId(9), items: items.slice(0, 40), ts: new Date().toISOString(), device: { id: d.id, topic: d.topic, pub: d.pubJwk } };
    const r = await relayFetch(`${RELAY}/${INBOX_TOPIC}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
    return r.ok;
  } catch (e) { return false; }
}


// HQ #92: Design Trainer Suggestion Box. Same privacy model as swipes (encrypted to inbox pub → bridge).
// The bridge appends to ~/.config/grok-bot-hq/design-train/suggestions.jsonl for Kelly's next deck. No issue, no Slack.
export async function sendSuggest({ text, cardId = null, deck = null, mid: fixedMid } = {}) {
  try {
    const d = await device();
    const mid = fixedMid || ('sg' + randomId(9));
    const msg = {
      v: 2, type: 'suggest', mid,
      text: String(text || '').trim().slice(0, 280),
      cardId: cardId ? String(cardId).slice(0, 80) : null,
      deck: deck ? String(deck).slice(0, 40) : null,
      ts: new Date().toISOString(),
      device: { id: d.id, topic: d.topic, pub: d.pubJwk },
    };
    if (!msg.text) return { ok: false, mid, error: 'empty' };
    const r = await relayFetch(`${RELAY}/${INBOX_TOPIC}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
    return { ok: r.ok, mid };
  } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 80) }; }
}
