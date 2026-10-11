#!/usr/bin/env node
// Family Inbox desk monitor feed: Gmail headers -> filtered, trimmed list -> ENCRYPTED to each HQ device -> ntfy.sh.
// Nothing about your mail is put on the public GitHub Pages site. Only Chris's iPad (the device key that sends HQ chat)
// can decrypt it; ntfy.sh only ever sees ciphertext, and it drops messages after ~12 h.
//
// Gmail access lives in Grok Bot (Gmail connector), not on the box, so a refresh is two steps:
//   1) Grok Bot: user-Gmail search_threads {query: "in:inbox -category:promotions -category:social", pageSize: 40}
//      with the result saved to a file (CallDynamicTool write_to_file)
//   2) node tools/refresh-inbox-feed.mjs <that-file>        (or pipe the JSON on stdin)
// Options: --dry  print the sanitized feed, don't publish.
// Only these fields leave the box (inside the encryption): sender label (brand/name, no address), subject (codes masked,
// trimmed to 70 chars), time, unread flag. No bodies, snippets, links, or ids.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const { seal } = await import(new URL('../hq-crypto.js', import.meta.url));

const RELAY = 'https://ntfy.sh', REPO = 'johnsonswork-star/grok-bot-hq-inbox';
const DIR = `${os.homedir()}/.config/grok-bot-hq`, DEVICES = `${DIR}/devices.json`, LOCAL = `${DIR}/inbox-live.json`;
const MAX_ITEMS = 12, MAX_ENV = 3800; // ntfy inline message limit is 4096 bytes
const args = process.argv.slice(2), dry = args.includes('--dry'), file = args.find(a => !a.startsWith('--'));

// ---- Chris's rule: no lead-generation / job-alert mail on the desk screen ----
const LEAD_DOMAINS = /(thumbtack|jobrapido|indeed|ziprecruiter|glassdoor|monster\.com|careerbuilder|simplyhired|jooble|talent\.com|neuvoo|adzuna|snagajob|lensa|jobcase|jobget|jobs2careers|careerjet|getwork|appcast|recruit|hiring|homeadvisor|angi\.com|angieslist|bark\.com|porch\.com|networx|houzz|yelp.*leads|craftjack|jobalert)/i;
const LEAD_SENDERS = /^(jobs?-?(noreply|alerts?|listings)|jobalerts?|alert@jobrapido|careers?@)|linkedin\.com$/i;
const LEAD_SUBJECT = /\b(new (job )?leads?|lead (alert|request)|job (alert|match(es)?|recommendations?)|jobs? (near|for) you|roles? (aligned|near|for you)|your (resume|cv|background|profile) (stood out|was noticed|caught)|(is|are) hiring|now hiring|apply now|new jobs?|matching jobs|consider these roles|who.?s hiring|customers? (are )?(looking|requesting)|quote request|project request)\b/i;
export const isLead = (sender, subject) => LEAD_DOMAINS.test(sender) || LEAD_SENDERS.test(sender) || LEAD_SUBJECT.test(subject);

const BRANDS = { 'google.com': 'Google', 'accounts.google.com': 'Google', 'github.com': 'GitHub', 'slack.com': 'Slack', 'x.ai': 'xAI',
  'cursor.sh': 'Cursor', 'accountprotection.microsoft.com': 'Microsoft', 'att-mail.com': 'AT&T', 'youversion.com': 'YouVersion', 'zillow.com': 'Zillow' };
function senderLabel(raw = '') {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); // "Name <addr>"
  const addr = (m ? m[2] : raw).trim().toLowerCase(), name = m && m[1].trim();
  if (name && !/@/.test(name)) return name.slice(0, 28);
  const dom = addr.split('@')[1] || '';
  for (const [d, b] of Object.entries(BRANDS)) if (dom === d || dom.endsWith('.' + d)) return b;
  const parts = dom.split('.'), base = parts.length > 1 ? parts[parts.length - 2] : (addr.split('@')[0] || '?');
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 28);
}
const unent = s => String(s || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function cleanSubject(s) {
  let t = unent(s).replace(/\s+/g, ' ').trim() || '(no subject)';
  t = t.replace(/https?:\/\/\S+/g, '[link]').replace(/\b[A-Z0-9]{0,3}\d{4,}[A-Z0-9]{0,3}\b/g, '••••'); // mask codes / account numbers
  return t.length > 70 ? t.slice(0, 69) + '…' : t;
}

function build(raw) {
  const threads = raw.threads || raw || [];
  let leads = 0; const items = [];
  for (const th of threads) {
    const ms = th.messages || [th]; const m = ms[ms.length - 1]; if (!m) continue;
    const labels = m.labelIds || [];
    if (labels.includes('CATEGORY_PROMOTIONS') || labels.includes('SPAM') || labels.includes('TRASH')) continue;
    if (isLead(m.sender || '', unent(m.subject))) { leads++; continue; }
    const at = Number(m.internalDate) || Date.parse(m.date) || 0;
    items.push({ f: senderLabel(m.sender), s: cleanSubject(m.subject), t: at, u: ms.some(x => (x.labelIds || []).includes('UNREAD')) ? 1 : 0 });
  }
  items.sort((a, b) => b.t - a.t);
  return { type: 'inbox', v: 1, at: Date.now(), leads, items: items.slice(0, MAX_ITEMS) };
}

function devices() {
  let known = {}; try { known = JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch {}
  try { // devices that have sent HQ chat (their public key + reply topic are in the private inbox issues)
    const bodies = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', REPO, '--label', 'hq-chat', '--state', 'all', '--limit', '60', '--json', 'body'], { encoding: 'utf8' }));
    for (const { body } of bodies) {
      const mm = (body || '').match(/<!-- hq-meta (\{.*\}) -->/); if (!mm) continue;
      const d = JSON.parse(mm[1]).device; if (d?.id && d.topic && d.pub) known[d.id] = { topic: d.topic, pub: d.pub };
    }
    fs.writeFileSync(DEVICES, JSON.stringify(known), { mode: 0o600 });
  } catch (e) { console.error('device lookup via gh failed, using cache:', e.message); }
  return known;
}

const input = file ? fs.readFileSync(file, 'utf8') : fs.readFileSync(0, 'utf8');
let feed = build(JSON.parse(input));
if (dry) { console.log(JSON.stringify(feed, null, 1)); process.exit(0); }
fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(LOCAL, JSON.stringify(feed), { mode: 0o600 });
const devs = devices();
if (!Object.keys(devs).length) { console.error('no HQ devices known yet (send one HQ chat from the iPad first)'); process.exit(1); }
for (const [id, d] of Object.entries(devs)) {
  let f = feed, body;
  for (;;) { body = JSON.stringify(await seal(f, d.pub)); if (body.length <= MAX_ENV || f.items.length <= 3) break; f = { ...f, items: f.items.slice(0, -1) }; }
  const r = await fetch(`${RELAY}/${d.topic}_inbox`, { method: 'POST', body, headers: { Cache: 'yes' }, signal: AbortSignal.timeout(15000) });
  console.log(`device ${id}: ${f.items.length} emails (${feed.leads} lead/job mails filtered) -> ${r.status}`);
}
