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

function drawTee(g, cloth, ink) {
  g.fillStyle = 'rgba(20,12,8,.25)';
  g.beginPath(); g.moveTo(-70, -78); g.lineTo(70, -78); g.lineTo(118, -28); g.lineTo(78, 8); g.lineTo(58, -8); g.lineTo(58, 120); g.lineTo(-58, 120); g.lineTo(-58, -8); g.lineTo(-78, 8); g.lineTo(-118, -28); g.closePath(); g.fill();
  g.fillStyle = cloth;
  g.beginPath(); g.moveTo(-64, -86); g.lineTo(64, -86); g.lineTo(112, -36); g.lineTo(72, 0); g.lineTo(52, -16); g.lineTo(52, 112); g.lineTo(-52, 112); g.lineTo(-52, -16); g.lineTo(-72, 0); g.lineTo(-112, -36); g.closePath(); g.fill();
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.stroke();
  g.fillStyle = shadeHex(cloth, 0.82);
  g.beginPath(); g.ellipse(0, -78, 28, 16, 0, 0, Math.PI); g.fill();
  g.fillStyle = ink;
  g.beginPath(); g.arc(0, 10, 26, 0, Math.PI * 2); g.fill();
  g.fillStyle = cloth;
  g.fillRect(-6, -4, 12, 30); g.fillRect(-16, 4, 32, 10);
}
function drawHoodie(g, cloth, ink) {
  drawTee(g, cloth, ink);
  g.fillStyle = shadeHex(cloth, 0.78);
  g.beginPath(); g.moveTo(-36, -86); g.quadraticCurveTo(0, -130, 36, -86); g.lineTo(22, -70); g.quadraticCurveTo(0, -108, -22, -70); g.closePath(); g.fill();
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.stroke();
  g.strokeStyle = ink; g.lineWidth = 5; g.beginPath(); g.moveTo(0, -20); g.lineTo(0, 70); g.stroke();
}
function drawHat(g, cloth, ink) {
  g.fillStyle = 'rgba(20,12,8,.25)';
  g.beginPath(); g.ellipse(4, 48, 120, 28, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = cloth;
  g.beginPath(); g.ellipse(0, 36, 116, 26, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.stroke();
  g.beginPath(); g.ellipse(0, -10, 78, 62, 0, Math.PI, 0); g.fill(); g.stroke();
  g.fillStyle = ink;
  g.beginPath(); g.arc(0, -8, 22, 0, Math.PI * 2); g.fill();
  g.fillStyle = cloth;
  g.fillRect(-5, -20, 10, 24); g.fillRect(-14, -12, 28, 8);
}
function drawMug(g, cloth, ink) {
  g.fillStyle = 'rgba(20,12,8,.25)';
  g.fillRect(-58, -68, 128, 168);
  g.fillStyle = cloth;
  g.fillRect(-70, -80, 140, 170);
  g.strokeStyle = '#2a1c10'; g.lineWidth = 4; g.strokeRect(-70, -80, 140, 170);
  g.beginPath(); g.ellipse(0, -80, 70, 18, 0, 0, Math.PI * 2); g.fillStyle = shadeHex(cloth, 1.08); g.fill(); g.stroke();
  g.beginPath(); g.ellipse(78, 0, 28, 40, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.fillStyle = ink; g.font = `700 22px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('AF', 0, 10);
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
    for (const c of d?.cards || []) if (c.d && !imgs.has(c.id)) {
      const im = new Image(); im.onload = () => { if (isOpen() && curId() === c.id) paint(c); }; im.src = c.d; imgs.set(c.id, im);
    }
  }
  function paint(c) {
    const art = body?.querySelector('#trainerArt'); if (!art) return;
    const g = art.getContext('2d');
    const w = art.width, h = art.height;
    const im = c && imgs.get(c.id);
    g.clearRect(0, 0, w, h);
    if (im && im.complete && im.naturalWidth) {
      g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, w, h);
      const s = Math.min(w / im.naturalWidth, h / im.naturalHeight);
      const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
      g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
      return;
    }
    if (!c) { g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h); return; }
    const cloth = clothOf(c), ink = inkOf(cloth);
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(36,28,16,.06)'; g.fillRect(0, 0, w, 18);
    g.save(); g.translate(w / 2, h / 2 + 8);
    const kind = String(c.product_type || '');
    if (kind.includes('mug')) drawMug(g, cloth, ink);
    else if (kind.includes('hat')) drawHat(g, cloth, ink);
    else if (kind.includes('hood')) drawHoodie(g, cloth, ink);
    else drawTee(g, cloth, ink);
    g.restore();
    const label = noDash(c.design || c.title || '');
    g.fillStyle = '#2a1c10'; g.font = `700 20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    const lines = wrap(g, label, w - 36, 2);
    lines.forEach((ln, i) => g.fillText(ln, w / 2, h - 36 + i * 22));
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
      <div class="trainer-kicker">ATOM FAMILY CLOTHING</div>
      <h2>Design Trainer</h2>
      <p class="trainer-meta">${esc(meta)}</p>
      <p class="trainer-src">${esc(deck?.label || 'Atom Family design deck')}</p>
      <div class="trainer-stage">
        <canvas id="trainerArt" width="480" height="560" aria-label="Design card"></canvas>
        <div class="sw-copy">
          ${c ? `<h3>${esc(c.title || '')}</h3><p>${esc(c.pitch || c.design || '')}</p><div class="sw-chips">${chips}</div>`
            : `<h3>All caught up</h3><p>${kept.length ? 'Kept: ' + esc(kept.slice(0, 8).join(', ')) + (kept.length > 8 ? `, +${kept.length - 8} more` : '') : 'Nothing kept this round.'}</p><button type="button" id="trainerAgain" class="trainer-again">NEW ROUND</button>`}
        </div>
      </div>`);
    paint(c);
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
  document.fonts?.ready?.then(() => { if (isOpen()) paint(byId(curId())); });
  return { open, close, isOpen, setDeck, act, curId };
}
