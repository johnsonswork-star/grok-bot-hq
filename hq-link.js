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
const INBOX_TOPIC = 'hqin_fzBxIcY6ogUeBH0F8ziL4j6ngcEZ4mld';
const INBOX_PUB = {"kty":"EC","crv":"P-256","x":"z0ZG58n1mbb7yy0m4A4gqjxWAJ59Qq37Zw3Bn6nVEBQ","y":"W2tdYXFuAE_Y-q9P44DpwynBHUTSD7pAffCo_5vY37M"};
const DEV = 'hq.device';

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

export async function send({ to, text, sentAt, shot }) {
  try {
    const d = await device();
    const mid = randomId(9);
    const post = async withShot => {
      const msg = { v: 2, mid, to, text: text.slice(0, 2500), ts: sentAt.toISOString(),
        device: { id: d.id, topic: d.topic, pub: d.pubJwk }, ua: navigator.userAgent.slice(0, 120) };
      if (withShot) msg.shot = shot;
      const r = await fetch(`${RELAY}/${INBOX_TOPIC}`, { method: 'POST', body: JSON.stringify(await seal(msg, INBOX_PUB)) });
      if (!r.ok) throw new Error('relay ' + r.status);
    };
    const useShot = typeof shot === 'string' && shot.startsWith('data:image/') && shot.length < SHOT_MAX;
    if (useShot) {
      try { await post(true); return { status: 'delivered', ref: mid, shot: true }; }
      catch (e) { /* relay refused the big one: fall through to text-only (same mid, bridge de-dupes) */ }
    }
    await post(false);
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
    const r = await fetch(`${RELAY}/${d.topic}/json?poll=1&since=all`);
    if (!r.ok) return out;
    for (const line of (await r.text()).split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line); if (m.event !== 'message' || !m.message) continue;
        const p = await open(JSON.parse(m.message), d.priv);
        if (p.type === 'ack') out.push({ type: 'ack', id: p.id, mid: p.mid, issue: p.issue, at: p.at }); // bridge: filed as issue #n
        else out.push({ ref: p.ref, id: p.id, from: p.from || 'Grok Bot', text: p.text, at: p.at });
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
    const r = await fetch(`${RELAY}/${d.topic}_inbox/json?poll=1&since=all`, { cache: 'no-store' });
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
