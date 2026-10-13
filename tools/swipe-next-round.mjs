#!/usr/bin/env node
// HQ #92: plan the next Design Trainer round from keep/pass stats. Free: plain node, no AI/paid API, no network.
// Inputs: ~/.config/grok-bot-hq/design-train/train.jsonl (live labels; undos/resets already removed) with
//         swipes.jsonl as fallback, suggestions.jsonl (wall "suggest" ideas), and every cards-v*.json deck.
// Output: designs/swipe-train/next-round.json  (a PLAN for Kelly: which phrases x styles x blanks to make next).
//         It is NOT named cards-v*.json, so the wall never publishes it by accident.
//   node tools/swipe-next-round.mjs [--size 22] [--explore 0.3] [--out path] [--print]
import fs from 'node:fs'; import os from 'node:os';
const T = `${os.homedir()}/.config/grok-bot-hq/design-train`, ST = '/workspace/atom-family-clothing-co/designs/swipe-train';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SIZE = +arg('--size', 22), EXPLORE = +arg('--explore', 0.3), OUT = arg('--out', `${ST}/next-round.json`);
const jl = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const decks = fs.readdirSync(ST).filter(f => /^cards-v\d+.*\.json$/.test(f)).sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7)));
const cards = {}; for (const f of decks) { try { const d = JSON.parse(fs.readFileSync(`${ST}/${f}`, 'utf8')); for (const c of d.cards || d) cards[c.id] = { ...c, _deck: f }; } catch {} }
const blankOf = c => c.printful?.blank || (c.tapstitch ? 'Tapstitch ' + c.tapstitch.sku : '') || c.blank || '';
const feats = c => ({ product_type: c.product_type, supplier: c.printful ? 'Printful' : c.tapstitch ? 'Tapstitch' : c.supplier, blank: blankOf(c),
  style: c.style, garment_color: c.garment_color, ink: (c.ink_colors || []).join('+') || undefined });
let rows = jl(`${T}/train.jsonl`).filter(r => !r.test && !r.cancelled).map(r => ({ id: r.cardId, y: r.label }));
if (!rows.length) rows = jl(`${T}/swipes.jsonl`).filter(r => !r.test && !r.cancelled && /keep|pass/.test(r.decision)).map(r => ({ id: r.cardId, y: r.decision === 'keep' ? 1 : 0 }));
const last = {}; for (const r of rows) last[r.id] = r.y; // newest label per card wins
const stat = {}; const bump = (k, v, y) => { if (v == null || v === '') return; const s = (stat[k] ||= {})[v] ||= { k: 0, n: 0 }; s.n++; s.k += y; };
let K = 0, N = 0;
for (const [id, y] of Object.entries(last)) { const c = cards[id] || {}; N++; K += y; for (const [k, v] of Object.entries(feats(c))) bump(k, v, y); }
const prior = N ? (K + 1) / (N + 2) : 0.5;
const rate = (k, v) => { const s = stat[k]?.[v]; return s ? (s.k + 2 * prior) / (s.n + 2) : prior; }; // smoothed toward overall keep rate
const score = c => { const f = feats(c); let lo = 0, m = 0; for (const [k, v] of Object.entries(f)) if (v) { const p = rate(k, v); lo += Math.log(p / (1 - p)) - Math.log(prior / (1 - prior)); m++; } return prior + (m ? lo / m : 0) * 0.25; };
// candidate phrases: suggestions (not test) + unswiped cards
const used = new Set(Object.values(cards).map(c => String(c.design_name || '').toLowerCase()));
const sugg = jl(`${T}/suggestions.jsonl`).filter(s => !s.test && s.text).map(s => s.text.replace(/\s+/g, ' ').trim()).filter((t, i, a) => a.indexOf(t) === i && !used.has(t.toLowerCase()));
const unswiped = Object.values(cards).filter(c => !(c.id in last));
const top = (k, n) => Object.keys(stat[k] || {}).sort((a, b) => rate(k, b) - rate(k, a)).slice(0, n);
const styles = top('style', 4).length ? top('style', 4) : ['western', 'script', 'stack', 'badge'];
const blanks = top('blank', 5).length ? top('blank', 5) : ['Comfort Colors 1717'];
const allStyles = ['retro', 'script', 'badge', 'typewriter', 'marker', 'varsity', 'elegant', 'stack', 'western', 'hand', 'neon', 'note'];
const plan = [];
// 1) re-test unswiped existing cards, best predicted first
for (const c of unswiped.sort((a, b) => score(b) - score(a)).slice(0, Math.round(SIZE * 0.4))) plan.push({ kind: 'retest', cardId: c.id, phrase: c.design_name, blank: blankOf(c), style: c.style, predicted_keep: +score(c).toFixed(2) });
// 2) new phrases from suggestions on winning style x blank (exploit) or untried styles (explore)
let i = 0; for (const t of sugg) { if (plan.length >= SIZE) break; const exp = Math.random() < EXPLORE;
  const untried = allStyles.filter(s => !stat.style?.[s]); plan.push({ kind: exp ? 'explore' : 'exploit', phrase: t, style: exp && untried.length ? untried[i % untried.length] : styles[i % styles.length], blank: blanks[i % blanks.length] }); i++; }
const out = { created: new Date().toISOString(), labels: N, keeps: K, keep_rate: +(N ? K / N : 0).toFixed(2), size: SIZE,
  feature_keep_rates: Object.fromEntries(Object.entries(stat).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).map(([v, s]) => [v, `${s.k}/${s.n} (${rate(k, v).toFixed(2)})`]))])),
  winners: { styles, blanks, product_types: top('product_type', 3) }, slots_open: Math.max(0, SIZE - plan.length),
  note: 'Plan only. Kelly renders art + concept mockups, then writes the next cards-vN.json. No uploads or orders.', plan };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`labels ${N} (keep ${K}) · plan ${plan.length}/${SIZE} (${plan.filter(p => p.kind === 'retest').length} retest, ${sugg.length} suggestions) · open slots ${out.slots_open} -> ${OUT}`);
if (process.argv.includes('--print')) console.log(JSON.stringify(out.winners), '\n' + plan.map(p => `${p.kind.padEnd(7)} ${p.phrase} · ${p.style || '-'} · ${p.blank}`).join('\n'));
