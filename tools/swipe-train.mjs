#!/usr/bin/env node
// HQ #85: design-trainer swipe wall (warehouse east wall, by Darryl's desk). Box side.
// The deck = real product ideas built only from options we actually have (Printful + Tapstitch for the Atom Family
// Clothing Co Etsy shop). Source, in order:
//   1. /workspace/atom-family-clothing-co/designs/swipe-train/cards-v*.json (newest version; the designer bot writes it)
//   2. the SEED deck below: existing design files x blanks named in our own catalog notes
//      (product-launch-plan.md, OPERATIONAL_BACKBONE.md, products/womens/README.md, TAPSTITCH_OPTIONS.md). No made-up SKUs.
// The deck + small JPEG thumbnails are ENCRYPTED to each HQ device key and posted to that device's private ntfy topic
// `<topic>_swipe` (same privacy model as the work feed: no design art in the public Pages repo). The iPad keeps its copy.
// Each swipe comes back through the encrypted HQ relay (type:'swipe'); the bridge calls record() here:
//   ~/.config/grok-bot-hq/design-train/swipes.jsonl  full log { at, sid, mid, cardId, decision keep|pass|undo, card snapshot }
//   ~/.config/grok-bot-hq/design-train/train.jsonl   compact rows for a later fine-tune { sid, at, label 1|0, cardId, f:{...} }
//                                                    HQ #89: train.jsonl only holds LIVE labels. An undo or a RESET DECK
//                                                    from the wall moves the cancelled rows to train.cancelled.jsonl and
//                                                    marks them { cancelled } in swipes.jsonl (audit trail kept).
//   node tools/swipe-train.mjs cancel-round <device> <round> [reason]   cancel a whole round from the box (e.g. keep-all mistake)
//   node tools/swipe-train.mjs reset-walls [reason]   cancel nothing, but tell every wall to restart rounds begun before now
//   node tools/swipe-train.mjs deck            build + print the current deck (no thumbnails)
//   node tools/swipe-train.mjs push [--force]  publish the deck now
//   node tools/swipe-train.mjs watch           background: re-publish when cards-v*.json changes (10 s check), keepalive 2.5 h
//   node tools/swipe-train.mjs stats           keep / pass counts per card + features
//   node tools/swipe-train.mjs export          effective training set (undos applied) as JSONL on stdout
//   node tools/swipe-train.mjs test-swipe <cardId> keep|pass   record a fake swipe (marked test) to check the pipeline
// Plain node, no AI calls. The "AI suggest" button on the wall is a disabled stub (no paid LLM).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { seal } = await import(new URL('../hq-crypto.js', import.meta.url));

const RELAY = 'https://ntfy.sh', REPO = 'johnsonswork-star/grok-bot-hq-inbox';
const DIR = `${os.homedir()}/.config/grok-bot-hq`, TRAIN = `${DIR}/design-train`, THUMBS = `${TRAIN}/.thumbs`, DEVICES = `${DIR}/devices.json`;
const AF = '/workspace/atom-family-clothing-co', CARDS_DIR = `${AF}/designs/swipe-train`;
const SWIPES = `${TRAIN}/swipes.jsonl`, TRAINF = `${TRAIN}/train.jsonl`, PUBST = `${TRAIN}/publish-state.json`, CANCELF = `${TRAIN}/train.cancelled.jsonl`, RESETF = `${TRAIN}/wall-reset.json`;
const KEEPALIVE_MS = 2.5 * 3600e3;
const log = (...a) => console.log(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }), '[swipe]', ...a);
fs.mkdirSync(THUMBS, { recursive: true, mode: 0o700 });
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- seed deck (real files x real catalog options from our own notes) ----------
const D = `${AF}/designs`, BADGE = `${D}/mascot/desk-options-oct10`;
const SEED = [
  { id: 'seed-h-dad-hat', title: 'Badge H minimal · dad hat', design: 'Mascot badge H (minimal)', image: `${BADGE}/badge-H-minimal-hat.png`, ground: '#1B2A4A',
    product: 'Embroidered dad hat', product_type: 'hat', supplier: 'Printful', blank: 'Yupoong 6245CM', technique: 'Embroidery', colors: ['Navy', 'Khaki/stone'], placement: 'front',
    pitch: 'You picked H. Small clean atom badge stitched on the front of a navy dad hat.', src: 'product-launch-plan.md (HAT row) · chosen-badges-oct11' },
  { id: 'seed-k-dad-hat', title: 'Badge K cross-only · dad hat', design: 'Mascot badge K (cross only)', image: `${BADGE}/badge-K-cross-only-hat.png`, ground: '#C9B99A',
    product: 'Embroidered dad hat', product_type: 'hat', supplier: 'Printful', blank: 'Yupoong 6245CM', technique: 'Embroidery', colors: ['Khaki/stone', 'Navy'], placement: 'front',
    pitch: 'You picked K. Cross-only mark on a khaki/stone dad hat. Quiet faith piece.', src: 'product-launch-plan.md (HAT row) · chosen-badges-oct11' },
  { id: 'seed-i-cc1717-leftchest', title: 'Badge I ring · left-chest tee', design: 'Mascot badge I (ring)', image: `${BADGE}/badge-I-ring-leftchest.png`, ground: '#1B2A4A',
    product: 'Unisex garment-dyed heavyweight tee', product_type: 'tee', supplier: 'Printful', blank: 'Comfort Colors 1717', technique: 'DTG', colors: ['Navy'], placement: 'left chest',
    pitch: 'You picked I. Small ring badge on the left chest of the hero tee.', src: 'product-launch-plan.md (TEE row) · products/womens/README.md #11' },
  { id: 'seed-j-tapstitch-hoodie', title: 'Badge J seal · oversized hoodie', design: 'Mascot badge J (seal)', image: `${BADGE}/badge-J-seal-full.png`, ground: '#F3EFE6',
    product: 'Oversized Essential Hoodie', product_type: 'hoodie', supplier: 'Tapstitch', blank: 'Tapstitch #RW0028', technique: 'DTG', colors: ['Cream', 'Navy Blue'], placement: 'full front',
    pitch: 'Big seal badge on a cream oversized hoodie (often ships from China; confirm US stock).', src: 'TAPSTITCH_OPTIONS.md (RW0028)' },
  { id: 'seed-l-mug-11oz', title: 'Badge L orbit · 11 oz mug', design: 'Mascot badge L (orbit nodes)', image: `${BADGE}/badge-L-orbit-nodes-mug.png`, ground: '#FFFFFF',
    product: 'White glossy mug 11 oz', product_type: 'mug', supplier: 'Printful', blank: 'White glossy mug 11 oz', technique: 'Sublimation', colors: ['White'], placement: 'wrap',
    pitch: 'Orbit-nodes badge on a white mug. Cheap gift add-on.', src: 'product-launch-plan.md (MUG row)' },
  { id: 'seed-husband-hoodie', title: 'Husband Leads Under God · hoodie', design: 'Husband Leads Under God (Eph 5:25)', image: `${D}/husband-leads-under-god-cream.png`, ground: '#1B2A4A',
    product: 'Pullover hoodie', product_type: 'hoodie', supplier: 'Printful', blank: 'Gildan 18500', technique: 'DTG', colors: ['Navy', 'Charcoal'], placement: 'front',
    pitch: 'Cream ink on a navy pullover. Dad gift for cold weather.', src: 'product-launch-plan.md (HOOD row, design 1)' },
  { id: 'seed-she-builds-6400', title: "She Builds the Home · women's relaxed tee", design: 'She Builds the Home (Prov 14:1)', image: `${D}/she-builds-the-home-navy.png`, ground: '#F3EFE6',
    product: "Women's relaxed tee", product_type: 'tee', supplier: 'Printful', blank: 'Bella+Canvas 6400', technique: 'DTG', colors: ['Natural/ivory'], placement: 'front',
    pitch: "Navy ink on a natural women's relaxed tee. The women's-fit lead design.", src: 'products/womens/README.md #1 · product-launch-plan.md design 5' },
  { id: 'seed-ezer-alma-crew', title: "Ezer Kenegdo · women's Alma crew", design: 'Ezer Kenegdo · Strong Helpmate (Gen 2:18)', image: `${D}/ezer-kenegdo-strong-helpmate-cream.png`, ground: '#1B2A4A',
    product: "Women's organic crew sweatshirt", product_type: 'crewneck', supplier: 'Printful', blank: 'Stanley/Stella SASW036 Alma', technique: 'DTG', colors: ['Navy'], placement: 'front',
    pitch: "Cream ink on a navy women's-cut crew. Premium price point.", src: 'products/womens/README.md #7 · product-launch-plan.md design 4' },
  { id: 'seed-raise-them-kids', title: 'Raise Them in the Way · kids tee', design: 'Raise Them in the Way (Prov 22:6)', image: `${D}/raise-them-in-the-way-navy.png`, ground: '#F3EFE6',
    product: 'Youth tee', product_type: 'kids tee', supplier: 'Printful', blank: 'Bella+Canvas 3001Y', technique: 'DTG', colors: ['Natural'], placement: 'front',
    pitch: 'Navy ink on a natural youth tee for family matching.', src: 'product-launch-plan.md (KIDS row, design 10)' },
  { id: 'seed-sunday-rt0034', title: 'Sunday Morning Family · heavyweight tee', design: 'Sunday Morning Family', image: `${D}/sunday-morning-family-cream.png`, ground: '#1B2A4A',
    product: 'Essential Heavyweight Cotton T-Shirt', product_type: 'tee', supplier: 'Tapstitch', blank: 'Tapstitch #RT0034', technique: 'DTG', colors: ['Navy Blue'], placement: 'front',
    pitch: 'Cream ink on a navy Tapstitch heavyweight tee. Cheaper base, ships CN + US.', src: 'TAPSTITCH_OPTIONS.md (RT0034)' },
  { id: 'seed-family-first-rw0029', title: 'Family First · Faith Always · crewneck', design: 'Family First · Faith Always', image: `${D}/family-first-faith-always-cream.png`, ground: '#1B2A4A',
    product: 'Essential Heavyweight Crewneck Sweatshirt', product_type: 'crewneck', supplier: 'Tapstitch', blank: 'Tapstitch #RW0029', technique: 'DTG', colors: ['Navy Blue'], placement: 'front',
    pitch: 'Cream ink on a navy heavyweight crew for fall/winter (China-heavy shipping).', src: 'TAPSTITCH_OPTIONS.md (RW0029)' },
  { id: 'seed-dads-house-mug15', title: "Dad's House · God's Word · 15 oz mug", design: "Dad's House · God's Word (Josh 24:15)", image: `${D}/dads-house-gods-word-navy.png`, ground: '#FFFFFF',
    product: 'White glossy mug 15 oz', product_type: 'mug', supplier: 'Printful', blank: 'White glossy mug 15 oz', technique: 'Sublimation', colors: ['White'], placement: 'wrap',
    pitch: 'Navy text on a big 15 oz mug. Dad Gift Box add-on.', src: 'product-launch-plan.md (MUG row, design 9)' },
  { id: 'seed-rooted-cc6014', title: 'Rooted & Rising · long sleeve', design: 'Atom Family · Rooted & Rising (EST. 2026)', image: `${D}/atom-family-rooted-rising-navy.png`, ground: '#E9E2D2',
    product: 'Unisex garment-dyed heavyweight long sleeve', product_type: 'long sleeve', supplier: 'Printful', blank: 'Comfort Colors 6014', technique: 'DTG', colors: ['Ivory'], placement: 'front',
    pitch: 'Brand mark on a garment-dyed long sleeve for Texas winters.', src: 'products/womens/README.md #6 · OPERATIONAL_BACKBONE.md (long-sleeve, L)' },
  { id: 'seed-provider-m2580', title: 'Provider · Protector · Prayer · hoodie', design: 'Provider · Protector · Prayer (Neh 4:14)', image: `${D}/provider-protector-prayer-cream.png`, ground: '#3A3F44',
    product: 'Pullover hoodie', product_type: 'hoodie', supplier: 'Printful', blank: 'Cotton Heritage M2580', technique: 'DTG', colors: ['Charcoal'], placement: 'front',
    pitch: 'Cream ink on a charcoal hoodie. The other hoodie blank in our plan.', src: 'product-launch-plan.md (HOOD row, design 3)' },
];

// ---------- deck loading ----------
function newestCardsFile() {
  let fs0 = []; try { fs0 = fs.readdirSync(CARDS_DIR).filter(f => /^cards-v\d+.*\.json$/i.test(f)); } catch { return null; }
  fs0.sort((a, b) => (+(b.match(/v(\d+)/)[1]) - +(a.match(/v(\d+)/)[1])) || b.localeCompare(a));
  return fs0.length ? `${CARDS_DIR}/${fs0[0]}` : null;
}
const SUPPLIERS = /^(printful|tapstitch)$/i;
function resolveImg(p, base) {
  if (!p || typeof p !== 'string' || /^https?:|^data:/.test(p)) return null;
  for (const c of [p, path.resolve(base, p), path.resolve(AF, p), path.resolve(`${AF}/designs`, p)]) { try { if (fs.statSync(c).isFile()) return c; } catch {} }
  return null;
}
const MOCK_DIR = `${CARDS_DIR}/mockups`, COMP_DIR = `${TRAIN}/composites`, IMG_RE = /\.(png|jpe?g|webp)$/i;
function kellyMockup(id) {
  if (!id) return null; let fl = []; try { fl = fs.readdirSync(MOCK_DIR).filter(f => IMG_RE.test(f) && [id + '.', id + '-', id + '_', 'mockup-' + id + '-', 'mockup-' + id + '.', 'mockup_' + id].some(pre => f.startsWith(pre))); } catch { return null; }
  const st = fl.map(f => { try { return [f, fs.statSync(`${MOCK_DIR}/${f}`)]; } catch { return null; } }).filter(x => x && x[1].size > 2000).sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
  return st.length ? `${MOCK_DIR}/${st[0][0]}` : null;
}
function compositeFor(id) { const p = `${COMP_DIR}/${id}.jpg`; try { return id && fs.statSync(p).isFile() ? p : null; } catch { return null; } }
// HQ #89: our art on the REAL Printful blank photo (public catalog photo, approx placement), tools/printful-photo-mockup.py
const PF_DIR = `${TRAIN}/pfphoto`;
function pfPhotoFor(id) { const p = `${PF_DIR}/${id}.jpg`; try { return id && fs.statSync(p).isFile() ? p : null; } catch { return null; } }
let pfStamp = '';
function ensurePfPhotos(f) {
  if (!f) return; let st; try { st = fs.statSync(f); } catch { return; } const stamp = f + st.mtimeMs; if (stamp === pfStamp) return; pfStamp = stamp;
  let raw; try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  const ids = (Array.isArray(raw) ? raw : raw?.cards || []).filter(c => c?.id && c.printful && !pfPhotoFor(c.id)).map(c => c.id);
  if (!ids.length) return;
  try { execFileSync('python3', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'printful-photo-mockup.py'), f, PF_DIR, ...ids], { stdio: 'ignore', timeout: 240000 }); log(`printful-photo mockups tried for ${ids.join(', ')}`); }
  catch (e) { log('printful-photo build failed', e.message.slice(0, 120)); }
}
// Kelly's files: newest of the card's explicit mockup field + designs/swipe-train/mockups/<id>* (new drops win automatically).
// A real Printful render (card mockup_kind/mockup_type says printful|render|official, or the file name does) outranks everything.
const isRender = (c, p) => /printful|render|official/i.test(String(c?.mockup_kind || c?.mockup_type || '')) || /printful[-_]?render|pf[-_]render|official/i.test(path.basename(p || ''));
// fill missing composites for any new card ids (plain python + PIL, no AI); run from watch()/push
let compStamp = '';
function ensureComposites(f) {
  if (!f) return; let st; try { st = fs.statSync(f); } catch { return; } const stamp = f + st.mtimeMs; if (stamp === compStamp) return; compStamp = stamp;
  let raw; try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  const ids = (Array.isArray(raw) ? raw : raw?.cards || []).map(c => c?.id).filter(id => id && !compositeFor(id));
  if (!ids.length) return;
  try { execFileSync('python3', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'mockup-composite.py'), f, COMP_DIR, ...ids], { stdio: 'ignore', timeout: 180000 }); log(`composites built for ${ids.join(', ')}`); }
  catch (e) { log('composite build failed', e.message.slice(0, 120)); }
}
const pickF = (o, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, x) => a?.[x], o); if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
function normCard(c, i, base) {
  // cards-v1 schema (designer): { printful: { name, blank, url, base_price_usd } | null, tapstitch: { name, sku, url, base_price_usd } | null,
  //   thumbnail, design_name, design_files, notes }
  const pf = c.printful && typeof c.printful === 'object' ? c.printful : null, ts = c.tapstitch && typeof c.tapstitch === 'object' ? c.tapstitch : null, so = pf || ts;
  if (so && !c.supplier) c = { ...c, supplier: pf ? 'Printful' : 'Tapstitch', product: c.product || so.name, blank: c.blank || (pf ? so.blank : so.sku ? `Tapstitch #${so.sku}` : ''),
    price: c.price || (so.base_price_usd ? `$${Number(so.base_price_usd).toFixed(2)}` : ''), image: c.image || c.thumbnail || (c.design_files || [])[0], design: c.design || c.design_name, src: c.src || c.notes };
  const supplier = String(pickF(c, 'supplier', 'pod', 'vendor', 'provider', 'product.supplier', 'fulfillment') || '').trim();
  const sup = /tapstitch/i.test(supplier) ? 'Tapstitch' : /printful/i.test(supplier) ? 'Printful' : '';
  if (!sup) return { drop: `card ${i} (${c.id || c.title}): supplier "${supplier}" is not Printful/Tapstitch` };
  const product = pickF(c, 'product', 'product_name', 'productName', 'product.name', 'item', 'blank_name');
  const blank = pickF(c, 'blank', 'sku', 'model', 'catalog', 'product_code', 'printful_product', 'tapstitch_sku', 'product.blank', 'product.sku');
  const imgs = [].concat(pickF(c, 'image', 'image_path', 'imagePath', 'img', 'thumb', 'mockup', 'preview', 'design_file', 'file', 'art', 'design.file') || []).concat(c.images || []);
  const art = imgs.map(p => resolveImg(typeof p === 'object' ? p?.path || p?.file : p, base)).find(Boolean) || null;
  // HQ #88: the wall shows the PRODUCT with our design on it. Order: explicit mockup fields in the card JSON (Kelly) ->
  // Kelly's file in designs/swipe-train/mockups/ named for the card id -> our labeled composite -> flat design art.
  const cid0 = String(pickF(c, 'id', 'cardId', 'slug') || '');
  const mk = [].concat(pickF(c, 'mockup', 'mockupUrl', 'mockup_url', 'productImage', 'product_image', 'mockup_path', 'mockup_file') || []).concat(c.mockups || c.mockup_files || [])
    .map(p => resolveImg(typeof p === 'object' ? p?.path || p?.file : p, base)).find(Boolean);
  const km = kellyMockup(cid0), mt0 = p => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
  const kelly = [mk, km].filter(Boolean).sort((a, b) => mt0(b) - mt0(a))[0] || null;
  const render = kelly && isRender(c, kelly) ? kelly : null, pfp = render ? null : pfPhotoFor(cid0), cm = render || pfp || kelly ? null : compositeFor(cid0);
  const image = render || pfp || kelly || cm || art, mock = render ? 'render' : pfp ? 'printful-photo' : kelly ? 'designer' : cm ? 'composite' : null;
  const colors = pickF(c, 'colors', 'color', 'colorways', 'colorway', 'garment_color');
  return { card: {
    id: clip(pickF(c, 'id', 'cardId', 'slug') || `card-${i + 1}`, 60), title: clip(pickF(c, 'title', 'name', 'idea') || (product ? String(product) : `Idea ${i + 1}`), 70),
    pitch: clip(pickF(c, 'pitch', 'why', 'description', 'desc', 'summary', 'blurb') || '', 180), design: clip(pickF(c, 'design', 'design_name', 'artwork', 'design.name') || '', 70),
    product: clip(typeof product === 'object' ? product?.name || '' : product || '', 70), product_type: clip(String(pickF(c, 'product_type', 'productType', 'type', 'category', 'product.type') || '').replace(/_/g, ' '), 30),
    supplier: sup, blank: clip(typeof blank === 'object' ? JSON.stringify(blank) : blank || '', 60), technique: clip(pickF(c, 'technique', 'print_method', 'method', 'decoration', 'print') || '', 30),
    colors: (Array.isArray(colors) ? colors : colors ? String(colors).split(/\s*[,/|]\s*/) : []).map(x => clip(typeof x === 'object' ? x?.name : x, 24)).filter(Boolean).slice(0, 6),
    placement: clip(pickF(c, 'placement', 'print_area', 'location', 'position') || '', 30), price: clip(pickF(c, 'price', 'base_price', 'cost', 'from') || '', 20),
    src: clip(pickF(c, 'src', 'source', 'sources', 'notes', 'ref') || '', 120), image, mock, ground: /^#[0-9a-f]{6}$/i.test(c.ground || c.bg || '') ? (c.ground || c.bg) : null,
  } };
}
export function loadDeck() {
  const f = newestCardsFile(); let raw = null, why = ''; ensureComposites(f); ensurePfPhotos(f);
  if (f) { try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { why = `${path.basename(f)} unreadable (${e.message.slice(0, 60)}), using seed`; } }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.cards) ? raw.cards : Array.isArray(raw?.deck) ? raw.deck : null;
  let cards = [], dropped = [], source = 'seed', label = 'Seed deck · real Printful + Tapstitch options';
  if (arr?.length) {
    const seen = new Set();
    arr.forEach((c, i) => { const r = normCard(c || {}, i, f ? path.dirname(f) : AF); if (r.drop) return dropped.push(r.drop); if (seen.has(r.card.id)) r.card.id += '-' + i; seen.add(r.card.id); cards.push(r.card); });
    if (cards.length) { source = path.basename(f); label = clip(raw?.title || raw?.name || `Kelly’s deck ${raw?.version || source} · ${cards.length} cards · Printful + Tapstitch`, 60); }
  } else if (f && !why) why = `${path.basename(f)} has no cards yet, using seed`;
  if (!cards.length) cards = SEED.map(c => ({ ...c, image: fs.existsSync(c.image) ? c.image : null }));
  const mt = p => { try { return Math.round(fs.statSync(p).mtimeMs); } catch { return 0; } };
  const id = crypto.createHash('sha1').update(JSON.stringify(cards.map(c => [c.id, c.title, c.product, c.supplier, c.blank, c.image, c.image && mt(c.image), c.mock]))).digest('hex').slice(0, 12);
  return { id, source, label, file: f, cards, dropped, note: why, at: Date.now() };
}

function thumb(p, ground, size = 300, mock = null) {
  if (p && mock) size = 640; // HQ #89: mockups fill the card's left side
  if (!p) return null; let st; try { st = fs.statSync(p); } catch { return null; }
  const key = `${THUMBS}/${crypto.createHash('sha1').update('crop2|' + p + '|' + st.mtimeMs + '|' + ground + '|' + size + '|' + (mock || '')).digest('hex').slice(0, 20)}.jpg`;
  if (!fs.existsSync(key)) {
    const bg = mock ? '#ECEAE6' : ground || (/cream|white/i.test(path.basename(p)) ? '#1B2A4A' : '#F3EFE6');
    try {
      execFileSync('python3', ['-c', `
import sys
from PIL import Image
n = int(sys.argv[4]); im = Image.open(sys.argv[1])
if im.mode in ('RGBA', 'LA', 'P'):
    im = im.convert('RGBA'); bb = im.split()[-1].getbbox()
    if bb: pad = max(8, (bb[2] - bb[0]) // 20); im = im.crop((max(0, bb[0] - pad), max(0, bb[1] - pad), min(im.width, bb[2] + pad), min(im.height, bb[3] + pad)))
mk = len(sys.argv) > 5 and sys.argv[5] == 'mock'
im.thumbnail((n, n) if mk else (int(n * .9), int(n * .9)))
bg = Image.new('RGB', (n, n), im.convert('RGB').getpixel((3, 3)) if mk and im.mode not in ('RGBA', 'LA', 'P') else sys.argv[3])
if im.mode in ('RGBA', 'LA', 'P'): im = im.convert('RGBA'); bg.paste(im, ((n - im.width) // 2, (n - im.height) // 2), im.split()[-1])
else: bg.paste(im.convert('RGB'), ((n - im.width) // 2, (n - im.height) // 2))
bg.save(sys.argv[2], 'JPEG', quality=78 if mk else 70, optimize=True)`, p, key, bg, String(size), mock ? 'mock' : ''], { stdio: 'ignore', timeout: 30000 });
    } catch { return null; }
  }
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(key).toString('base64'); } catch { return null; }
}
const wallResetAt = () => { try { return +JSON.parse(fs.readFileSync(RESETF, 'utf8')).at || 0; } catch { return 0; } };
function feed(deck) {
  return { type: 'swipe-deck', v: 1, at: Date.now(), id: deck.id, resetAt: wallResetAt(), label: deck.label, source: deck.source, note: deck.note || '',
    cards: deck.cards.map(c => { const { image, src, ...rest } = c; return { ...rest, src: src || '', hasImg: !!image, d: thumb(image, c.ground, 300, c.mock) }; }) };
}

// ---------- publishing (same per-device encryption as work-live) ----------
function devices() {
  let known = {}; try { known = JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch {}
  try {
    const bodies = JSON.parse(execFileSync('gh', ['issue', 'list', '-R', REPO, '--label', 'hq-chat', '--state', 'all', '--limit', '60', '--json', 'body'], { encoding: 'utf8', timeout: 30000 }));
    for (const { body } of bodies) { const mm = (body || '').match(/<!-- hq-meta (\{.*\}) -->/); if (!mm) continue; const d = JSON.parse(mm[1]).device; if (d?.id && d.topic && d.pub) known[d.id] = { topic: d.topic, pub: d.pub }; }
  } catch { log('device lookup via gh failed, using cache'); }
  return known;
}
async function push(deck = loadDeck()) {
  const f = feed(deck), devs = devices(); if (!Object.keys(devs).length) { log('no HQ devices known yet'); return false; }
  let ok = true;
  for (const [id, d] of Object.entries(devs)) {
    try {
      const body = JSON.stringify(await seal(f, d.pub));
      const r = await fetch(`${RELAY}/${d.topic}_swipe`, { method: 'POST', body, headers: { Cache: 'yes' }, signal: AbortSignal.timeout(30000) });
      log(`deck ${deck.id} (${deck.cards.length} cards, ${deck.source}) -> device ${id}: ${Math.round(body.length / 1024)} KB -> ${r.status}`); ok &&= r.ok;
    } catch (e) { log('push error', id, e.message); ok = false; }
  }
  const pg = await pagesFallback(f, devs, deck);
  if (ok) fs.writeFileSync(PUBST, JSON.stringify({ id: deck.id, at: Date.now(), source: deck.source, n: deck.cards.length, pages: pg }));
  return ok;
}
// HQ #87: the same deck, still sealed to each device key, also hosted on Pages at swipe/<sha256(topic)[0:24]>.json so the
// wall never spins forever if the ntfy relay / attachment fails on the iPad. Ciphertext only (no art or text in the clear).
// Committed + pushed only when the deck id changes (or force), touching just the swipe/ path.
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function pagesFallback(f, devs, deck, force = process.argv.includes('--force')) {
  try {
    const dir = `${SITE}/swipe`; fs.mkdirSync(dir, { recursive: true }); const files = [];
    for (const d of Object.values(devs)) {
      const h = crypto.createHash('sha256').update(d.topic).digest('hex').slice(0, 24), fp = `${dir}/${h}.json`;
      let cur = null; try { cur = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch {}
      if (!force && cur?.id === deck.id && cur?.pub === d.pub.x) continue;
      fs.writeFileSync(fp, JSON.stringify({ v: 1, id: deck.id, at: Date.now(), pub: d.pub.x, env: await seal(f, d.pub) })); files.push(`swipe/${h}.json`);
    }
    if (!files.length) return 'unchanged';
    const git = (...a) => execFileSync('git', ['-C', SITE, ...a], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    git('add', '--', ...files); git('commit', '-m', `HQ #87: encrypted design-trainer deck fallback (${deck.id})`, '--', ...files);
    try { git('push', 'origin', 'HEAD:main'); } catch (e) { git('pull', '--rebase', '--autostash', 'origin', 'main'); git('push', 'origin', 'HEAD:main'); }
    log(`pages fallback: ${files.length} device file(s) for deck ${deck.id} pushed`); return 'pushed';
  } catch (e) { log('pages fallback error', String(e.stderr || e.message).slice(0, 200)); return 'error'; }
}
function pubState() { try { return JSON.parse(fs.readFileSync(PUBST, 'utf8')); } catch { return {}; } }
async function watch() {
  log('swipe-train watcher up');
  let fails = 0;
  for (;;) {
    try {
      const deck = loadDeck(), ps = pubState();
      if (deck.id !== ps.id || Date.now() - (ps.at || 0) > KEEPALIVE_MS) {
        if (deck.dropped.length) log('dropped', deck.dropped.join('; '));
        if (await push(deck)) fails = 0; else fails++;
      }
    } catch (e) { log('watch error', e.message); }
    await new Promise(r => setTimeout(r, fails ? Math.min(300e3, 30e3 * fails) : 10e3));
  }
}

// ---------- recording swipes (called by the bridge) ----------
const FEATS = ['product_type', 'product', 'supplier', 'blank', 'technique', 'placement', 'design'];
function features(c) { const f = {}; for (const k of FEATS) if (c?.[k]) f[k] = String(c[k]); if (c?.colors?.length) f.colors = c.colors.map(String); return f; }
function seenMids() { const s = new Set(); try { for (const l of fs.readFileSync(SWIPES, 'utf8').split('\n')) { const m = l.match(/"mid":"([^"]+)"/); if (m) s.add(m[1]); } } catch {} return s; }
export function record(p, { log: lg = log } = {}) {
  fs.mkdirSync(TRAIN, { recursive: true, mode: 0o700 });
  const items = Array.isArray(p.items) ? p.items : [p];
  const seen = seenMids(), deck = loadDeck(), byId = new Map(deck.cards.map(c => [c.id, c])); let n = 0;
  for (const it of items.slice(0, 60)) {
    const mid = String(it.mid || p.mid || '').slice(0, 40); if (!mid || seen.has(mid)) continue; seen.add(mid);
    const decision = ['keep', 'pass', 'undo', 'reset'].includes(it.decision) ? it.decision : null; if (!decision) { lg('bad swipe decision', it.decision); continue; }
    const cardId = clip(it.cardId, 60), sid = clip(it.sid || mid, 40), at = new Date(Date.parse(it.at) || Date.now()).toISOString();
    const dev = p.device?.id || null, round = +it.round || 0;
    if (decision === 'reset') { // HQ #89: RESET DECK on the wall -> that round never trains the designer
      const sids = (Array.isArray(it.cancels) ? it.cancels : []).map(x => clip(x, 40)).filter(Boolean).slice(0, 200);
      fs.appendFileSync(SWIPES, JSON.stringify({ at, sid, mid, cardId: '', decision, cancels: sids, reason: clip(it.reason || 'reset', 40), deck: clip(it.deck || '', 20), round, roundAt: +it.roundAt || 0, device: dev, test: p.test || undefined }) + '\n', { mode: 0o600 });
      const c = cancel({ sids, device: dev, round, since: +it.roundAt || 0, reason: `wall-${clip(it.reason || 'reset', 30)}` });
      lg(`swipe RESET round ${round} from device ${dev || '?'}: ${c} training row(s) cancelled`); n++; continue;
    }
    const sent = it.card && typeof it.card === 'object' ? it.card : {};
    const box = byId.get(cardId); const snap = box ? (({ image, ...r }) => ({ ...r, image: image || null }))(box) : Object.fromEntries(FEATS.concat(['id', 'title', 'pitch', 'colors']).filter(k => sent[k] !== undefined).map(k => [k, k === 'colors' && Array.isArray(sent[k]) ? sent[k].slice(0, 6).map(x => clip(x, 24)) : clip(sent[k], 180)]));
    const row = { at, sid, mid, cardId, decision, undoes: decision === 'undo' ? clip(it.undoes || '', 40) : undefined, deck: clip(it.deck || p.deck || '', 20), round,
      roundAt: +it.roundAt || undefined, pos: +it.pos || 0, total: +it.total || 0, device: dev, test: p.test || undefined, card: snap, snapFrom: box ? 'box-deck' : 'ipad' };
    fs.appendFileSync(SWIPES, JSON.stringify(row) + '\n', { mode: 0o600 });
    if (decision === 'undo') cancel({ sids: [row.undoes], reason: 'undo' });
    else fs.appendFileSync(TRAINF, JSON.stringify({ sid, at, label: decision === 'keep' ? 1 : 0, cardId, deck: row.deck, round, device: dev, f: features(snap), test: p.test || undefined }) + '\n', { mode: 0o600 });
    n++;
    lg(`swipe ${decision.toUpperCase()} ${cardId}${decision === 'undo' ? ' (undo ' + row.undoes + ')' : ''} from device ${dev || '?'}`);
  }
  return n;
}
// HQ #89: cancel training rows. By sid list, and/or every keep/pass from <device> in <round> at/after <since> (ms).
// train.jsonl is rewritten without them (they move to train.cancelled.jsonl); swipes.jsonl rows get { cancelled: reason }.
export function cancel({ sids = [], device = null, round = 0, since = 0, reason = 'cancelled' } = {}) {
  const want = new Set(sids.filter(Boolean));
  const sw = readJsonl(SWIPES);
  if (device && round) for (const r of sw) if ((r.decision === 'keep' || r.decision === 'pass') && r.device === device && +r.round === +round && (!since || Date.parse(r.at) >= since - 5000)) want.add(r.sid);
  if (!want.size) return 0;
  const tr = readJsonl(TRAINF), keep = [], gone = [];
  for (const r of tr) (r.undo ? want.has(r.sid) : want.has(r.sid)) ? gone.push(r) : keep.push(r);
  const tmp = (f, rows) => { const t = `${f}.tmp${process.pid}`; fs.writeFileSync(t, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), { mode: 0o600 }); fs.renameSync(t, f); };
  if (gone.length) { fs.appendFileSync(CANCELF, gone.map(r => JSON.stringify({ ...r, cancelled: reason, cancelledAt: new Date().toISOString() })).join('\n') + '\n', { mode: 0o600 }); tmp(TRAINF, keep); }
  let marked = 0; const sw2 = sw.map(r => (r.decision === 'keep' || r.decision === 'pass') && want.has(r.sid) && !r.cancelled ? (marked++, { ...r, cancelled: reason }) : r);
  if (marked) tmp(SWIPES, sw2);
  return gone.filter(r => !r.undo).length;
}
function readJsonl(f) { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
export function effective() { const rows = readJsonl(TRAINF), undone = new Set(rows.filter(r => r.undo).map(r => r.sid)); return rows.filter(r => !r.undo && !undone.has(r.sid) && !r.test && !r.cancelled); }

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'deck') { const d = loadDeck(); console.log(JSON.stringify({ ...d, cards: d.cards.map(c => ({ ...c })) }, null, 1)); }
  else if (cmd === 'feed-json') fs.writeFileSync(a || '/dev/stdout', JSON.stringify(feed(loadDeck())));
  else if (cmd === 'push') process.exit((await push()) ? 0 : 1);
  else if (cmd === 'watch') await watch();
  else if (cmd === 'cancel-round' && a && b) console.log('cancelled', cancel({ device: a, round: +b, reason: process.argv[5] || 'box-cancel' }), 'training row(s)');
  else if (cmd === 'reset-walls') { fs.writeFileSync(RESETF, JSON.stringify({ at: Date.now(), reason: a || 'box reset' })); console.log('walls will restart rounds begun before', new Date().toISOString(), '(push --force to send now)'); }
  else if (cmd === 'export') for (const r of effective()) console.log(JSON.stringify(r));
  else if (cmd === 'stats') {
    const rows = effective(), by = {};
    for (const r of rows) { const k = r.cardId; (by[k] ||= { keep: 0, pass: 0, f: r.f }); r.label ? by[k].keep++ : by[k].pass++; }
    console.log(`${rows.length} swipes (${rows.filter(r => r.label).length} keep / ${rows.filter(r => !r.label).length} pass)`);
    for (const [k, v] of Object.entries(by)) console.log(`${v.keep ? '+' + v.keep : '  '} ${v.pass ? '-' + v.pass : '  '}  ${k}  · ${v.f.supplier || ''} ${v.f.product || ''}`);
  } else if (cmd === 'test-swipe' && a) { console.log('recorded', record({ mid: 'test' + Date.now(), cardId: a, decision: b || 'keep', test: true, device: { id: 'test' } })); }
  else console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 20).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
