// Design Trainer window: one Atom Family card at a time. KEEP / SKIP, undo, close.
// Decisions queue through the same encrypted swipe relay as the 3D wall (keep | pass | undo).
import { PUBLIC_DECK } from './deck.js';

const ST_KEY = 'hq2d.trainer';
const OUT_KEY = 'hq2d.trainer.out';
const FONT = '"Pixelify Sans","Courier New",monospace';
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function clothOf(card) {
  const c = String((card.colors && card.colors[0]) || '').toLowerCase();
  if (c.includes('navy') || c.includes('charcoal')) return '#24324f';
  if (c.includes('khaki') || c.includes('stone')) return '#c9b99a';
  if (c.includes('white')) return '#f7f4ee';
  return '#f3efe6';
}
function inkOf(cloth) { return cloth === '#24324f' ? '#f3efe6' : '#24324f'; }

// Garments are drawn around (0, 0). The print box is where the design sits on that garment.
function teePath(g) {
  g.beginPath(); g.moveTo(-64, -86); g.lineTo(64, -86); g.lineTo(112, -36); g.lineTo(72, 0); g.lineTo(52, -16); g.lineTo(52, 112); g.lineTo(-52, 112); g.lineTo(-52, -16); g.lineTo(-72, 0); g.lineTo(-112, -36); g.closePath();
}
function drawTee(g, cloth) {
  g.fillStyle = 'rgba(20,12,8,.22)';
  g.beginPath(); g.moveTo(-70, -78); g.lineTo(70, -78); g.lineTo(118, -28); g.lineTo(78, 8); g.lineTo(58, -8); g.lineTo(58, 120); g.lineTo(-58, 120); g.lineTo(-58, -8); g.lineTo(-78, 8); g.lineTo(-118, -28); g.closePath(); g.fill();
  g.fillStyle = cloth; teePath(g); g.fill();
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.stroke();
  g.fillStyle = shadeHex(cloth, 0.82);
  g.beginPath(); g.ellipse(0, -78, 28, 16, 0, 0, Math.PI); g.fill();
}
function drawHoodie(g, cloth, ink) {
  drawTee(g, cloth);
  g.fillStyle = shadeHex(cloth, 0.78);
  g.beginPath(); g.moveTo(-36, -86); g.quadraticCurveTo(0, -130, 36, -86); g.lineTo(22, -70); g.quadraticCurveTo(0, -108, -22, -70); g.closePath(); g.fill();
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.stroke();
  g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.moveTo(0, -20); g.lineTo(0, 78); g.stroke();
}
function drawHat(g, cloth) {
  g.fillStyle = 'rgba(20,12,8,.22)';
  g.beginPath(); g.ellipse(4, 48, 120, 28, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = cloth;
  g.beginPath(); g.ellipse(0, 36, 116, 26, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.stroke();
  g.beginPath(); g.ellipse(0, -8, 78, 64, 0, Math.PI, 0); g.fill(); g.stroke();
}
function drawMug(g, cloth) {
  g.fillStyle = 'rgba(20,12,8,.22)';
  g.fillRect(-58, -68, 128, 168);
  g.fillStyle = cloth;
  g.fillRect(-70, -80, 140, 170);
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.strokeRect(-70, -80, 140, 170);
  g.beginPath(); g.ellipse(0, -80, 70, 18, 0, 0, Math.PI * 2); g.fillStyle = shadeHex(cloth, 1.08); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(78, 0, 28, 40, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
}
function shadeHex(h, f) {
  const n = parseInt(String(h).replace('#', ''), 16);
  const k = v => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${k(n >> 16 & 255)},${k(n >> 8 & 255)},${k(n & 255)})`;
}
function wrap(g, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

const FINISHED = new Set(['printful-photo', 'composite', 'designer', 'render']);
const STUDIO = '#ECEAE6';
// Fractions of the contained product photo. Wearer's left chest is the viewer's right.
const OVERLAY = {
  left: { x: 0.56, y: 0.22, w: 0.16, h: 0.14 },
  full: { x: 0.28, y: 0.22, w: 0.44, h: 0.42 },
  wrap: { x: 0.28, y: 0.32, w: 0.44, h: 0.36 },
  front: { x: 0.32, y: 0.24, w: 0.36, h: 0.30 },
};
// Print boxes in garment-local pixels (the same space as the path commands).
const PRINTS = {
  tee: {
    left: { x: 6, y: -44, w: 42, h: 36 },
    full: { x: -40, y: -22, w: 80, h: 96 },
    front: { x: -34, y: -16, w: 68, h: 72 },
    wrap: { x: -34, y: -16, w: 68, h: 72 },
  },
  hoodie: {
    left: { x: 6, y: -38, w: 42, h: 36 },
    full: { x: -42, y: -12, w: 84, h: 100 },
    front: { x: -36, y: -8, w: 72, h: 78 },
    wrap: { x: -36, y: -8, w: 72, h: 78 },
  },
  hat: {
    left: { x: 4, y: -54, w: 34, h: 28 },
    full: { x: -32, y: -58, w: 64, h: 40 },
    front: { x: -32, y: -58, w: 64, h: 40 },
    wrap: { x: -32, y: -58, w: 64, h: 40 },
  },
  mug: {
    left: { x: 10, y: -6, w: 36, h: 36 },
    full: { x: -46, y: -18, w: 92, h: 72 },
    front: { x: -40, y: -12, w: 80, h: 64 },
    wrap: { x: -46, y: -16, w: 92, h: 70 },
  },
};
const BOUNDS = {
  tee: { l: -122, t: -96, r: 122, b: 128 },
  hoodie: { l: -122, t: -136, r: 122, b: 128 },
  hat: { l: -126, t: -78, r: 126, b: 82 },
  mug: { l: -82, t: -104, r: 114, b: 108 },
};

function ready(im) { return !!(im && im.complete && im.naturalWidth); }
function artSrc(c) { return c ? (c.art || c.designImg || c.designD || '') : ''; }
function placeKey(placement) {
  const p = String(placement || '').toLowerCase();
  if (p.includes('left')) return 'left';
  if (p.includes('full')) return 'full';
  if (p.includes('wrap')) return 'wrap';
  return 'front';
}
function kindOf(c) {
  const k = String(c?.product_type || '').toLowerCase();
  if (k.includes('mug')) return 'mug';
  if (k.includes('hat') || k.includes('cap')) return 'hat';
  if (k.includes('hood')) return 'hoodie';
  return 'tee';
}
function containRect(nw, nh, w, h) {
  if (!(nw > 0) || !(nh > 0) || !(w > 0) || !(h > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const s = Math.min(w / nw, h / nh);
  const dw = nw * s, dh = nh * s;
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh };
}
function containDraw(g, im, x, y, w, h) {
  const r = containRect(im.naturalWidth, im.naturalHeight, w, h);
  if (r.w < 0.5 || r.h < 0.5) return;
  g.imageSmoothingEnabled = true;
  g.drawImage(im, x + r.x, y + r.y, r.w, r.h);
}
function fitText(g, text, box) {
  const raw = String(text || '').trim();
  if (!raw || box.w < 4 || box.h < 4) return;
  let size = Math.max(6, Math.floor(Math.min(box.w * 0.42, box.h * 0.4, 32)));
  let lines = [];
  for (; size >= 6; size--) {
    g.font = `700 ${size}px ${FONT}`;
    const all = wrap(g, raw, Math.max(4, box.w - 4), 12);
    lines = all.slice(0, 4);
    const lh = size + 1;
    const tooWide = lines.some(ln => g.measureText(ln).width > box.w - 2);
    const tooTall = lines.length * lh > box.h - 2;
    if (!tooWide && !tooTall && all.length <= lines.length) break;
  }
  if (size < 6) size = 6;
  g.font = `700 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = size + 1;
  const total = lines.length * lh;
  let y = box.y + (box.h - total) / 2 + lh / 2;
  for (const ln of lines) {
    g.fillText(ln, box.x + box.w / 2, y);
    y += lh;
  }
}

export function createTrainer({ esc, noDash, sendSwipes, toast }) {
  const root = document.querySelector('#trainer');
  const body = document.querySelector('#trainerBody');
  const imgs = new Map();
  let deck = null, st = load(ST_KEY, null), out = load(OUT_KEY, []), sending = false, lastSwipe = 0, openedAt = 0;

  function cards() { return deck?.cards || []; }
  function byId(id) { return cards().find(c => c.id === id); }
  function fresh(d) {
    const ids = d.cards.map(c => c.id), dec = {}, hist = [];
    if (st && st.deckId === d.id) {
      for (const id of st.history || []) if (ids.includes(id) && st.decisions?.[id]) { dec[id] = st.decisions[id]; hist.push(id); }
    }
    const order = ids.filter(id => !dec[id]);
    const done = ids.filter(id => dec[id]);
    return { deckId: d.id, order: [...done, ...order], decisions: dec, history: hist, round: (st?.deckId === d.id ? st.round : 1) || 1 };
  }
  function curId() { return st?.order.find(id => !st.decisions[id]) || null; }
  function counts() {
    let k = 0, p = 0;
    for (const v of Object.values(st?.decisions || {})) v.d === 'keep' ? k++ : p++;
    return { k, p, n: st?.order.length || cards().length };
  }
  function persist() { save(ST_KEY, st); }
  function snap(c) {
    return { id: c.id, title: c.title, product: c.product, product_type: c.product_type, supplier: c.supplier, blank: c.blank, technique: c.technique, placement: c.placement, design: c.design, colors: c.colors };
  }
  function queue(item) {
    out.push(item); if (out.length > 400) out = out.slice(-400); save(OUT_KEY, out); setTimeout(flush, 900);
  }
  async function flush() {
    if (sending || !out.length || !sendSwipes) return;
    sending = true;
    const batch = out.slice(0, 20);
    let ok = false;
    try { ok = await sendSwipes(batch); } catch (e) {}
    if (ok) { const done = new Set(batch.map(b => b.mid)); out = out.filter(b => !done.has(b.mid)); save(OUT_KEY, out); }
    sending = false;
    if (ok && out.length) setTimeout(flush, 400);
  }
  function rememberImages(d) {
    const load = (c, key, src) => {
      if (!src || imgs.has(key)) return;
      const im = new Image();
      im.onload = () => { if (isOpen() && curId() === c.id) paint(c); };
      im.src = src;
      imgs.set(key, im);
    };
    for (const c of d?.cards || []) {
      load(c, c.id, c.d);
      load(c, c.id + '#art', artSrc(c));
    }
  }
  function drawBlank(g, c, w, h, aim) {
    g.fillStyle = STUDIO;
    g.fillRect(0, 0, w, h);
    if (!c) return;
    const kind = kindOf(c);
    const b = BOUNDS[kind];
    const cloth = clothOf(c), ink = inkOf(cloth);
    const gw = b.r - b.l, gh = b.b - b.t;
    const s = (Math.min(w, h) * 0.9) / Math.max(gw, gh);
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(s, s);
    g.translate(-(b.l + b.r) / 2, -(b.t + b.b) / 2);
    if (kind === 'mug') drawMug(g, cloth);
    else if (kind === 'hat') drawHat(g, cloth);
    else if (kind === 'hoodie') drawHoodie(g, cloth, ink);
    else drawTee(g, cloth);
    const box = PRINTS[kind][placeKey(c.placement)];
    g.beginPath();
    g.rect(box.x, box.y, box.w, box.h);
    g.clip();
    if (ready(aim)) containDraw(g, aim, box.x, box.y, box.w, box.h);
    else { g.fillStyle = ink; fitText(g, noDash(c.design || c.title || ''), box); }
    g.restore();
  }
  function paint(c) {
    const art = body?.querySelector('#trainerArt');
    if (!art) return;
    const frame = art.parentElement;
    const w = Math.round(frame?.clientWidth || 0);
    const h = Math.round(frame?.clientHeight || 0);
    if (w < 2 || h < 2) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (art.width !== bw) art.width = bw;
    if (art.height !== bh) art.height = bh;
    const g = art.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const im = c && imgs.get(c.id);
    const aim = c && imgs.get(c.id + '#art');
    const photoOnly = ready(im) && (!c || FINISHED.has(String(c.mock || '')) || !artSrc(c));
    g.fillStyle = STUDIO;
    g.fillRect(0, 0, w, h);
    if (photoOnly) { containDraw(g, im, 0, 0, w, h); return; }
    if (ready(im)) {
      const rect = containRect(im.naturalWidth, im.naturalHeight, w, h);
      g.imageSmoothingEnabled = true;
      g.drawImage(im, rect.x, rect.y, rect.w, rect.h);
      if (ready(aim)) {
        const f = OVERLAY[placeKey(c.placement)] || OVERLAY.front;
        containDraw(g, aim, rect.x + rect.w * f.x, rect.y + rect.h * f.y, rect.w * f.w, rect.h * f.h);
      }
      return;
    }
    drawBlank(g, c, w, h, aim);
  }
  function chip(text) { return `<span class="sw-chip">${esc(noDash(text))}</span>`; }
  function render() {
    if (!root || !body) return;
    const c = byId(curId()), { k, p, n } = counts(), pos = c ? st.order.indexOf(c.id) + 1 : n;
    const meta = c
      ? `Card ${pos} of ${n}. Kept ${k}, skipped ${p}.`
      : `Deck done. Kept ${k}, skipped ${p}.`;
    const chips = c ? [c.supplier, c.product, c.blank, c.technique, c.placement].filter(Boolean).map(chip).join('') : '';
    const kept = Object.entries(st?.decisions || {}).filter(([, v]) => v.d === 'keep').map(([id]) => byId(id)?.title).filter(Boolean);
    body.innerHTML = noDash(`
      <div class="trainer-head">
        <div class="trainer-kicker">ATOM FAMILY CLOTHING</div>
        <h2>Design Trainer</h2>
      </div>
      <p class="trainer-meta">${esc(meta)}</p>
      <p class="trainer-src">${esc(deck?.label || 'Atom Family design deck')}</p>
      <div class="trainer-stage">
        <div class="trainer-frame"><canvas id="trainerArt" aria-label="Design card"></canvas></div>
        <div class="sw-copy">
          ${c ? `<h3>${esc(c.title || '')}</h3><p>${esc(c.pitch || c.design || '')}</p><div class="sw-chips">${chips}</div>`
            : `<h3>All caught up</h3><p>${kept.length ? 'Kept: ' + esc(kept.slice(0, 8).join(', ')) + (kept.length > 8 ? `, +${kept.length - 8} more` : '') : 'Nothing kept this round.'}</p><button type="button" id="trainerAgain" class="trainer-again">NEW ROUND</button>`}
        </div>
      </div>`);
    paint(c);
    watchFrame();
    requestAnimationFrame(() => { if (isOpen()) paint(byId(curId())); });
    const skip = document.querySelector('#trainerSkip'), keep = document.querySelector('#trainerKeep'), undo = document.querySelector('#trainerUndo');
    if (skip) skip.disabled = !c;
    if (keep) keep.disabled = !c;
    if (undo) undo.disabled = !(st?.history || []).length;
    const again = document.querySelector('#trainerAgain');
    if (again) again.onclick = () => act('next');
  }
  function act(kind) {
    if (!deck) return;
    if (kind === 'next') {
      st = { deckId: deck.id, order: shuffle(cards().map(c => c.id)), decisions: {}, history: [], round: (st?.round || 1) + 1 };
      persist(); render(); toast('New round. Same cards, shuffled.'); return;
    }
    if (kind === 'undo') {
      let id = st?.history.pop();
      while (id && !st.decisions[id]) id = st.history.pop();
      if (!id) { toast('Nothing to undo yet'); return; }
      const was = st.decisions[id]; delete st.decisions[id];
      st.order = [...st.order.filter(x => st.decisions[x]), id, ...st.order.filter(x => !st.decisions[x] && x !== id)];
      persist();
      const c = byId(id);
      queue({ mid: rid(), sid: rid(), at: new Date().toISOString(), cardId: id, decision: 'undo', undoes: was?.sid || '', deck: deck.id, round: st.round, roundAt: st.at || 0, card: c ? snap(c) : { id } });
      render(); toast('Undid the last card'); return;
    }
    if (kind !== 'keep' && kind !== 'pass') return;
    const id = curId(); if (!id) return;
    const now = Date.now(); if (now - lastSwipe < 250) return; lastSwipe = now;
    const c = byId(id); if (!c) return;
    const sid = rid();
    if (!st.at) st.at = now;
    st.decisions[id] = { d: kind, sid, at: now }; st.history.push(id); persist();
    queue({ mid: rid(), sid, at: new Date().toISOString(), cardId: id, decision: kind, deck: deck.id, round: st.round, roundAt: st.at || 0, pos: st.order.indexOf(id) + 1, total: st.order.length, card: snap(c) });
    render(); toast(kind === 'keep' ? 'Kept' : 'Skipped');
  }
  function setDeck(feed) {
    const next = feed?.cards?.length ? {
      id: feed.id || 'live',
      label: feed.label || 'Live deck on this iPad',
      source: feed.source || 'live',
      cards: feed.cards.filter(c => c && (c.title || c.id)),
    } : { ...PUBLIC_DECK, cards: PUBLIC_DECK.cards.slice() };
    const changed = !deck || deck.id !== next.id;
    deck = next;
    if (!st || changed) st = fresh(deck);
    rememberImages(deck);
    if (isOpen()) render();
  }
  function isOpen() { return !!root && !root.classList.contains('hidden'); }
  function open() {
    if (!deck) setDeck(null);
    openedAt = performance.now();
    root.classList.remove('hidden');
    render();
  }
  function close() { root?.classList.add('hidden'); }
  document.querySelector('#trainerClose')?.addEventListener('click', close);
  document.querySelector('#trainerSkip')?.addEventListener('click', () => act('pass'));
  document.querySelector('#trainerKeep')?.addEventListener('click', () => act('keep'));
  document.querySelector('#trainerUndo')?.addEventListener('click', () => act('undo'));
  root?.addEventListener('click', e => { if (e.target === root && performance.now() - openedAt > 400) close(); });
  setDeck(null);
  let frameObs = null, seenFrame = '', paintRaf = 0;
  function watchFrame() {
    const frame = body?.querySelector('.trainer-frame');
    if (!frame || typeof ResizeObserver === 'undefined') return;
    frameObs?.disconnect();
    seenFrame = '';
    frameObs = new ResizeObserver(() => {
      if (!isOpen()) return;
      const sig = Math.round(frame.clientWidth) + 'x' + Math.round(frame.clientHeight);
      if (frame.clientWidth < 2 || sig === seenFrame) return;
      seenFrame = sig;
      if (paintRaf) cancelAnimationFrame(paintRaf);
      paintRaf = requestAnimationFrame(() => { paintRaf = 0; if (isOpen()) paint(byId(curId())); });
    });
    frameObs.observe(frame);
  }
  document.fonts?.ready?.then(() => { if (isOpen()) paint(byId(curId())); });
  return { open, close, isOpen, setDeck, act, curId };
}
