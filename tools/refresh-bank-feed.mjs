#!/usr/bin/env node
// Whiteboard BANK panel feed: Finance (Plaid, read-only) balances -> redacted summary -> ENCRYPTED to each HQ device -> ntfy.sh.
// Same privacy model as the Family Inbox feed (refresh-inbox-feed.mjs): balances are NEVER written to the public
// GitHub Pages repo. Only Chris's iPad (the device key that sends HQ chat) can decrypt; ntfy only sees ciphertext (~12 h),
// and the iPad keeps the last good copy locally.
//
// Finance access lives in Grok Bot (Finance connector), not on the box, so a refresh is two steps:
//   1) Grok Bot: user-Finance-xai finance_list_accounts {} and finance_list_connections {} (write_to_file: true each)
//   2) node tools/refresh-bank-feed.mjs <accounts-file> <connections-file>
//      (files may be raw tool output; the JSON line is picked out). With no args it reads
//      ~/.config/grok-bot-hq/bank-snapshot.json ({accounts:[...], connections:[...]}); "-" reads stdin.
//      Any files given are also merged into that snapshot (0600) so the next run can reuse it.
// Options: --dry  print the redacted feed, don't publish.
// What leaves the box (inside the encryption only): institution name, cleaned account name, last 4 of the mask,
// class/subtype, current + available balance, totals, timestamp. No ids, no full numbers, no transactions.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const { seal } = await import(new URL('../hq-crypto.js', import.meta.url));

const RELAY = 'https://ntfy.sh', REPO = 'johnsonswork-star/grok-bot-hq-inbox';
const DIR = `${os.homedir()}/.config/grok-bot-hq`, DEVICES = `${DIR}/devices.json`;
const SNAP = `${DIR}/bank-snapshot.json`, LOCAL = `${DIR}/bank-live.json`;
const MAX_ACCTS = 8;
const args = process.argv.slice(2), dry = args.includes('--dry'), files = args.filter(a => a !== '--dry');

function parseLoose(txt) { // whole-file JSON, or tool output with the JSON on its own line(s)
  try { return JSON.parse(txt); } catch {}
  const out = {};
  for (const l of txt.split('\n')) { const s = l.trim(); if (!s.startsWith('{')) continue; try { Object.assign(out, JSON.parse(s)); } catch {} }
  if (!Object.keys(out).length) throw new Error('no JSON found in input');
  return out;
}
function loadSnapshot() {
  if (!files.length) return JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const snap = {};
  for (const f of files) Object.assign(snap, parseLoose(fs.readFileSync(f === '-' ? 0 : f, 'utf8')));
  if (!snap.connections) try { snap.connections = JSON.parse(fs.readFileSync(SNAP, 'utf8')).connections; } catch {}
  fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(SNAP, JSON.stringify(snap), { mode: 0o600 });
  return snap;
}

const money = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const title = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
function cleanName(a) {
  let n = String(a.name || a.official_name || a.subtype || 'Account')
    .replace(/[^\x20-\x7E]/g, '')            // ® etc. arrive mangled
    .replace(/\.{2,}\s*\d+|x+\d{2,}|\b\d{4,}\b/gi, '') // "...8058", "xx1234", any long digit run
    .replace(/\s+/g, ' ').trim();
  if (n === n.toUpperCase()) n = title(n);
  return (n || title(a.subtype || 'Account')).slice(0, 28);
}

export function build(snap) {
  const inst = Object.fromEntries((snap.connections || []).map(c => [c.id, c.institution_name || 'Bank']));
  const accts = (snap.accounts || []).map(a => ({
    inst: (inst[a.connection_id] || 'Bank').slice(0, 24),
    name: cleanName(a),
    last4: String(a.mask || '').replace(/\D/g, '').slice(-4) || null,
    cls: a.class || 'cash', sub: a.subtype || a.type || '',
    bal: money(a.current_balance), avail: money(a.available_balance),
    limit: money(a.credit_limit ?? a.limit),
  }));
  const sum = (list, k) => Math.round(list.reduce((s, a) => s + (a[k] ?? 0), 0) * 100) / 100;
  const cash = accts.filter(a => a.cls === 'cash'), inv = accts.filter(a => a.cls === 'investment');
  const liab = accts.filter(a => a.cls === 'liability'), cards = liab.filter(a => /credit/i.test(a.sub)), loans = liab.filter(a => !/credit/i.test(a.sub));
  const order = { cash: 0, liability: 1, investment: 2 };
  accts.sort((a, b) => (order[a.cls] ?? 3) - (order[b.cls] ?? 3) || (b.bal ?? 0) - (a.bal ?? 0));
  return {
    type: 'bank', v: 1, at: Date.now(), updatedAt: new Date().toISOString(), readOnly: true,
    totals: {
      cash: sum(cash, 'bal'), cashAvailable: sum(cash, 'avail'),
      credit: cards.length ? { balance: sum(cards, 'bal'), available: sum(cards, 'avail') } : null,
      loans: loans.length ? sum(loans, 'bal') : null,
      investments: inv.length ? sum(inv, 'bal') : null,
    },
    accounts: accts.slice(0, MAX_ACCTS),
  };
}

function devices() {
  let known = {}; try { known = JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch {}
  try {
    const bodies = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', REPO, '--label', 'hq-chat', '--state', 'all', '--limit', '60', '--json', 'body'], { encoding: 'utf8' }));
    for (const { body } of bodies) {
      const mm = (body || '').match(/<!-- hq-meta (\{.*\}) -->/); if (!mm) continue;
      const d = JSON.parse(mm[1]).device; if (d?.id && d.topic && d.pub) known[d.id] = { topic: d.topic, pub: d.pub };
    }
    fs.writeFileSync(DEVICES, JSON.stringify(known), { mode: 0o600 });
  } catch (e) { console.error('device lookup via gh failed, using cache:', e.message); }
  return known;
}

const feed = build(loadSnapshot());
if (dry) { console.log(JSON.stringify(feed, null, 1)); process.exit(0); }
fs.writeFileSync(LOCAL, JSON.stringify(feed), { mode: 0o600 });
const devs = devices();
if (!Object.keys(devs).length) { console.error('no HQ devices known yet (send one HQ chat from the iPad first)'); process.exit(1); }
let ok = 0;
for (const [id, d] of Object.entries(devs)) {
  try {
    const body = JSON.stringify(await seal(feed, d.pub));
    const r = await fetch(`${RELAY}/${d.topic}_bank`, { method: 'POST', body, headers: { Cache: 'yes' }, signal: AbortSignal.timeout(15000) });
    console.log(`device ${id}: ${feed.accounts.length} accounts -> ${r.status}`); if (r.ok) ok++;
  } catch (e) { console.error(`device ${id}: ${e.message}`); }
}
process.exit(ok ? 0 : 1);
