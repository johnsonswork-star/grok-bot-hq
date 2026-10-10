// HQ chat delivery: gets Chris's messages to Grok Bot + the team.
// Swap this file out (WebSocket, API, etc.) without touching the chat UI: the UI only calls
//   send({ to, text, sentAt }) -> { status: 'delivered' | 'needs-tap' | 'failed', url?, ref?, error? }
//   fetchReplies() -> [{ ref, id, from, text, at }]
//   isLinked() -> bool
//
// v1 transport = GitHub Issues on a PRIVATE inbox repo that Grok Bot watches with `gh`.
// Nothing secret lives in this public code. A per-device "HQ key" (a fine-grained GitHub token
// limited to Issues on the inbox repo) is stored only in this device's localStorage. Install it once by
// opening the setup link  https://johnsonswork-star.github.io/grok-bot-hq/#hqkey=<token>
// (the page saves it and strips it from the address bar).
// With no key, sending falls back to a pre-filled GitHub "new issue" page that Chris taps Submit on.
export const INBOX_REPO = 'johnsonswork-star/grok-bot-hq-inbox';
export const LABEL = 'hq-chat';
const API = 'https://api.github.com';
const KEY = 'hq.key', SENT = 'hq.sentRefs';

(function captureSetupLink() {
  const m = location.hash.match(/hqkey=([^&]+)/);
  if (m) {
    try { localStorage.setItem(KEY, decodeURIComponent(m[1])); } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (/hqkey=clear/.test(location.hash)) { try { localStorage.removeItem(KEY); } catch (e) {} }
})();

const key = () => { try { const k = localStorage.getItem(KEY); return k && k !== 'clear' ? k : null; } catch (e) { return null; } };
export const isLinked = () => !!key();
const sentRefs = () => { try { return JSON.parse(localStorage.getItem(SENT) || '[]'); } catch (e) { return []; } };
const saveRefs = r => { try { localStorage.setItem(SENT, JSON.stringify(r.slice(-15))); } catch (e) {} };

function chicago(d) {
  try { return d.toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' }) + ' CT'; }
  catch (e) { return d.toISOString(); }
}
function issueFor({ to, text, sentAt }) {
  const snippet = text.replace(/\s+/g, ' ').slice(0, 60) + (text.length > 60 ? '…' : '');
  const team = to === 'Grok Bot' ? 'Grok Bot (+ team)' : `${to} (via Grok Bot + team)`;
  return {
    title: `HQ chat → ${to}: ${snippet}`,
    body: `**From:** Chris (Bot HQ)\n**To:** ${team}\n**Sent:** ${chicago(sentAt)} (${sentAt.toISOString()})\n\n---\n\n${text}\n\n---\n_Reply by commenting on this issue. Start the comment with \`**Bot Name:**\` to show it from a specific bot; replies appear in the HQ chat on Chris's iPad._`,
  };
}
async function gh(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${key()}`,
    'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

export async function send(msg) {
  const issue = issueFor(msg);
  if (key()) {
    try {
      let j;
      try { j = await gh(`/repos/${INBOX_REPO}/issues`, { method: 'POST', body: JSON.stringify({ ...issue, labels: [LABEL] }) }); }
      catch (e) { j = await gh(`/repos/${INBOX_REPO}/issues`, { method: 'POST', body: JSON.stringify(issue) }); } // token may lack label rights
      saveRefs([...sentRefs(), j.number]);
      return { status: 'delivered', ref: j.number, url: j.html_url };
    } catch (e) {
      return { status: 'failed', error: e.message, url: prefill(issue) };
    }
  }
  return { status: 'needs-tap', url: prefill(issue) };
}
function prefill(issue) {
  const q = new URLSearchParams({ title: issue.title, body: issue.body, labels: LABEL });
  return `https://github.com/${INBOX_REPO}/issues/new?${q}`;
}

// Real replies only: comments on the issues this device sent.
export async function fetchReplies() {
  if (!key()) return [];
  const out = [];
  for (const ref of sentRefs().slice(-8)) {
    try {
      const cs = await gh(`/repos/${INBOX_REPO}/issues/${ref}/comments?per_page=50`);
      for (const c of cs) {
        const m = c.body.match(/^\s*\*\*([^*]{1,40}):\*\*\s*/);
        out.push({ ref, id: c.id, from: m ? m[1].trim() : 'Grok Bot', text: m ? c.body.slice(m[0].length) : c.body, at: c.created_at });
      }
    } catch (e) {}
  }
  return out;
}
