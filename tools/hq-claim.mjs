#!/usr/bin/env node
// HQ ack dedupe (Oct 18). Two wake runs (e.g. one Slack ping per message in a catch-up batch) both listed HQ #132 and
// #133 as pending and both said "Got it" a few seconds apart. Claims make exactly one run own each message:
//   hq-claim.mjs filter          stdin = `pending` lines ("#n ..."); this run claims the unclaimed ones and prints them;
//                                ones another run claimed in the last 10 min are listed as "claimed by another run"
//   hq-claim.mjs may-reply <n>   exit 3 (and say why) if ANOTHER run replied on #n in the last 20 s (double ack guard)
//   hq-claim.mjs replied <n>     record that this run just replied on #n
// A run is identified by CURSOR_CONVERSATION_ID (set for every Grok Bot run on the box). Without it nothing is claimed
// and everything is listed, exactly like before. State: ~/.config/grok-bot-hq/claims/<n>.json (callers hold a flock).
import fs from 'node:fs';
import os from 'node:os';
const DIR = `${os.homedir()}/.config/grok-bot-hq/claims`, TTL = 10 * 60e3, REPLY_WINDOW = 20e3;
const me = process.env.CURSOR_CONVERSATION_ID || '';
const file = n => `${DIR}/${String(n).replace(/\D/g, '')}.json`;
const read = n => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return null; } };
const write = (n, o) => { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); fs.writeFileSync(file(n), JSON.stringify(o), { mode: 0o600 }); };
const ago = t => Math.round((Date.now() - t) / 1000) + ' s ago';
const [cmd, n] = process.argv.slice(2);
if (cmd === 'filter') {
  const lines = fs.readFileSync(0, 'utf8').split('\n').filter(l => l.trim());
  const others = [];
  for (const l of lines) {
    const num = +(l.match(/^#(\d+)/) || [])[1];
    if (!num || !me) { console.log(l); continue; }
    const c = read(num) || {};
    if (c.conv && c.conv !== me && Date.now() - c.at < TTL) { others.push(`#${num} (claimed by another Grok Bot run ${ago(c.at)}; it is answering, skip it. It comes back here if still unanswered after 10 min)`); continue; }
    if (c.conv !== me) write(num, { ...c, conv: me, at: Date.now() });
    console.log(l);
  }
  if (others.length) { console.log('-- already being handled by another run (do not reply to these):'); for (const o of others) console.log(o); }
} else if (cmd === 'may-reply') {
  const c = read(n) || {};
  if (c.replyAt && Date.now() - c.replyAt < REPLY_WINDOW && (c.replyConv || '') !== me && me) {
    console.error(`skipped: another Grok Bot run already replied on HQ #${n} ${ago(c.replyAt)} (double-ack guard). If this is a real follow-up, wait 20 s or rerun with HQ_FORCE=1.`);
    process.exit(3);
  }
} else if (cmd === 'replied') {
  const c = read(n) || {}; write(n, { ...c, conv: c.conv || me, at: c.at || Date.now(), replyConv: me, replyAt: Date.now() });
} else { console.log('usage: hq-claim.mjs filter | may-reply <n> | replied <n>'); process.exit(1); }
