// HQ #85: Design Trainer wall screen (warehouse east wall, between the steel stairs and Darryl's desk).
// One card at a time from the designer's deck (real Printful + Tapstitch ideas only, tools/swipe-train.mjs on the box,
// encrypted per-device feed). Swipe RIGHT = KEEP, LEFT = PASS. Controller (while you aim at the screen): A / RB / D-pad ▶ keep,
// B / LB / D-pad ◀ pass, X / D-pad ▼ undo, A on the summary = reshuffle. iPad: tap the right half (KEEP) or left half (PASS),
// UNDO / RESHUFFLE buttons along the bottom. Every swipe is queued on this device and sent through the encrypted HQ relay
// (type:'swipe'); the box logs it as training data. The "AI SUGGEST" button is a disabled stub (no paid LLM).
const CW = 1280, CH = 800, FONT = 'system-ui,-apple-system,Segoe UI,Arial', HEAD = 86, FOOT = 92;
const ST_KEY = 'hq.swipe', DECK_KEY = 'hq.swipeDeck', OUT_KEY = 'hq.swipe.out';
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const SUP_COL = { Printful: '#e8f0ff', Tapstitch: '#ffe9d6' };
function wrap(g, text, maxW, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (l && g.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[maxLines - 1] = l + '…'; }
  return lines;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

export function createSwipeWall({ THREE, parent, x, y, z, ry, w = 2.24, h = 1.4, sendSwipes, toast = () => {} }) {
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const g = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const grp = new THREE.Group(); grp.position.set(x, y, z); grp.rotation.y = ry; parent.add(grp);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.06), new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.5, metalness: 0.4 }));
  bezel.position.z = 0.03; grp.add(bezel);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  mesh.position.z = 0.062; grp.add(mesh);
  for (const sx of [-0.35, 0.35]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.05), bezel.material); m.position.set(sx * w, 0, -0.01); grp.add(m); } // wall brackets

  let status = '', lastDraw = 0, deck = load(DECK_KEY, null), st = load(ST_KEY, null), out = load(OUT_KEY, []), hover = null, anim = null, dirty = true, sending = false, lastSend = 0;
  const imgs = new Map();
  function imgsFor(d) { imgs.clear(); for (const c of d?.cards || []) if (c.d) { const im = new Image(); im.onload = () => { dirty = true; }; im.src = c.d; imgs.set(c.id, im); } }
  const byId = id => deck?.cards.find(c => c.id === id);
  function fresh(d, keep) {
    const ids = d.cards.map(c => c.id), dec = {}, hist = [];
    if (keep) { for (const id of keep.history || []) if (ids.includes(id) && keep.decisions?.[id]) { dec[id] = keep.decisions[id]; hist.push(id); } }
    const order = keep ? [...(keep.order || []).filter(id => ids.includes(id)), ...ids.filter(id => !(keep.order || []).includes(id))] : ids;
    return { deckId: d.id, order, decisions: dec, history: hist, round: keep?.round || 1 };
  }
  if (deck && (!st || st.deckId !== deck.id)) st = fresh(deck, st);
  if (deck) imgsFor(deck);
  const persist = () => { save(ST_KEY, st); dirty = true; };
  const curId = () => st?.order.find(id => !st.decisions[id]) || null;
  const counts = () => { let k = 0, p = 0; for (const v of Object.values(st?.decisions || {})) v.d === 'keep' ? k++ : p++; return { k, p, n: st?.order.length || 0 }; };

  function setDeck(d) {
    if (!d?.cards) return;
    const changed = !deck || deck.id !== d.id, newer = !deck || deck.at !== d.at;
    deck = { id: d.id, label: d.label, source: d.source, note: d.note, at: d.at, cards: d.cards };
    if (!save(DECK_KEY, deck)) save(DECK_KEY, { ...deck, cards: deck.cards.map(c => ({ ...c, d: null })) }); // too big for storage: keep text, images re-download
    if (changed) { const had = !!st; st = fresh(deck, st && st.deckId ? st : null); persist(); imgsFor(deck); if (had) toast(`🃏 New designer deck · ${deck.cards.length} cards`); }
    else if (imgs.size === 0 || newer) imgsFor(deck); // same cards, re-rendered art
    dirty = true;
  }
  function queue(item) { out.push(item); if (out.length > 400) out = out.slice(-400); save(OUT_KEY, out); setTimeout(flush, 1200); }
  async function flush() {
    if (sending || !out.length || !sendSwipes) return; sending = true; lastSend = Date.now();
    const batch = out.slice(0, 20); let ok = false; try { ok = await sendSwipes(batch); } catch (e) {}
    if (ok) { const done = new Set(batch.map(b => b.mid)); out = out.filter(b => !done.has(b.mid)); save(OUT_KEY, out); }
    sending = false; dirty = true; if (ok && out.length) setTimeout(flush, 500);
  }
  setInterval(() => { if (out.length && Date.now() - lastSend > 15000) flush(); }, 5000);
  const snap = c => ({ id: c.id, title: c.title, product: c.product, product_type: c.product_type, supplier: c.supplier, blank: c.blank, technique: c.technique, placement: c.placement, design: c.design, colors: c.colors });

  function swipe(dec) {
    const id = curId(); if (!id) return 'end'; const c = byId(id); if (!c) return null;
    const sid = rid(), pos = st.order.indexOf(id) + 1;
    st.decisions[id] = { d: dec, sid, at: Date.now() }; st.history.push(id); persist();
    anim = { id, dir: dec === 'keep' ? 1 : -1, t0: performance.now() };
    queue({ mid: rid(), sid, at: new Date().toISOString(), cardId: id, decision: dec, deck: deck.id, round: st.round, pos, total: st.order.length, card: snap(c) });
    return dec;
  }
  function undo() {
    const id = st?.history.pop(); if (!id) return 'nothing'; const was = st.decisions[id]; delete st.decisions[id]; persist(); anim = null;
    queue({ mid: rid(), sid: rid(), at: new Date().toISOString(), cardId: id, decision: 'undo', undoes: was?.sid || '', deck: deck.id, round: st.round });
    return 'undo';
  }
  function reshuffle() { if (!deck) return null; st = { deckId: deck.id, order: shuffle(deck.cards.map(c => c.id)), decisions: {}, history: [], round: (st?.round || 1) + 1 }; persist(); anim = null; return 'shuffle'; }

  // ---------- drawing ----------
  function chip(text, x, y, bg, fg = '#1b2a4a') { g.font = `700 24px ${FONT}`; const tw = g.measureText(text).width + 28; rr(g, x, y, tw, 40, 20); g.fillStyle = bg; g.fill(); g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x + 14, y + 21); return tw + 10; }
  function drawCard(c, ox, rot, alpha, stamp) {
    const X = 172, Y = HEAD + 22, Wd = CW - 344, Ht = CH - HEAD - FOOT - 44;
    g.save(); g.globalAlpha = alpha; g.translate(X + Wd / 2 + ox, Y + Ht / 2); g.rotate(rot); g.translate(-Wd / 2, -Ht / 2);
    g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 24; g.shadowOffsetY = 8; rr(g, 0, 0, Wd, Ht, 26); g.fillStyle = '#fbf8f2'; g.fill(); g.shadowColor = 'transparent';
    // HQ #88: product mockups (design on the real blank) get a big image; flat art keeps the old small tile
    const is = c.mock ? 486 : 330, iy = (Ht - is) / 2, im = imgs.get(c.id);
    rr(g, 20, iy, is, is, 18); g.fillStyle = c.mock ? '#ECEAE6' : c.ground || '#1B2A4A'; g.fill();
    if (im?.complete && im.naturalWidth) { g.save(); rr(g, 20, iy, is, is, 18); g.clip(); g.drawImage(im, 20, iy, is, is); g.restore();
      if (c.mock === 'designer') { g.font = `800 20px ${FONT}`; const t = 'MOCKUP · KELLY', w2 = g.measureText(t).width + 24; rr(g, 30, iy + 10, w2, 34, 10); g.fillStyle = 'rgba(27,42,74,.88)'; g.fill(); g.fillStyle = '#F3E3B5'; g.textBaseline = 'middle'; g.fillText(t, 42, iy + 28); } }
    else { g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(c.hasImg ? 'loading art…' : 'no art yet', 20 + is / 2, iy + is / 2); g.textAlign = 'left'; }
    const tx = is + 48, tw = Wd - tx - 28; let ty = 30;
    const sm = !!c.mock; g.textBaseline = 'top'; g.fillStyle = '#1b2a4a'; g.font = `800 ${sm ? 34 : 42}px ${FONT}`;
    for (const l of wrap(g, c.title, tw, sm ? 3 : 2)) { g.fillText(l, tx, ty); ty += sm ? 41 : 50; }
    ty += 6; g.font = `500 ${sm ? 24 : 29}px ${FONT}`; g.fillStyle = '#3b4250';
    for (const l of wrap(g, c.pitch, tw, sm ? 4 : 4)) { g.fillText(l, tx, ty); ty += sm ? 31 : 37; }
    ty += 14; let cx = tx;
    const row = (items) => { for (const [t, bg, fg] of items) { if (!t) continue; g.font = `700 24px ${FONT}`; const need = g.measureText(t).width + 38; if (cx + need > tx + tw) { cx = tx; ty += 50; } cx += chip(t, cx, ty, bg, fg); } };
    row([[c.supplier, SUP_COL[c.supplier] || '#eee', '#1b2a4a'], [c.product_type, '#e9f5ec', '#1e5631'], [c.technique, '#f2eafa', '#4a2a6a']]);
    cx = tx; ty += 52; g.font = `600 27px ${FONT}`; g.fillStyle = '#1b2a4a'; g.textBaseline = 'top';
    const facts = [c.product && `${c.product}${c.blank && !String(c.product).includes(c.blank) ? ' · ' + c.blank : ''}`, c.colors?.length && `Colors: ${c.colors.join(', ')}`, c.placement && `Print: ${c.placement}`, c.price && `From ${c.price}`].filter(Boolean);
    if (sm) g.font = `600 23px ${FONT}`;
    for (const f of facts) { for (const l of wrap(g, f, tw, 2)) { if (ty > Ht - 40) break; g.fillText(l, tx, ty); ty += sm ? 29 : 34; } }
    if (stamp) { g.save(); g.translate(Wd / 2, Ht / 2); g.rotate(stamp === 'keep' ? -0.25 : 0.25); g.globalAlpha = Math.min(1, alpha * 1.4); g.lineWidth = 10; const col = stamp === 'keep' ? '#2e9d4f' : '#d64545';
      g.strokeStyle = col; g.fillStyle = col; g.font = `900 110px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; const t = stamp === 'keep' ? 'KEEP' : 'PASS', mw = g.measureText(t).width + 60;
      g.strokeRect(-mw / 2, -75, mw, 150); g.fillText(t, 0, 4); g.restore(); }
    g.restore();
  }
  function btn(r, label, on, hot, col = '#3a4150') { rr(g, r.x, r.y, r.w, r.h, 16); g.fillStyle = !on ? 'rgba(255,255,255,.06)' : hot ? '#ffd166' : col; g.fill(); g.fillStyle = !on ? 'rgba(255,255,255,.3)' : hot ? '#1b1b1b' : '#fff'; g.font = `800 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1); g.textAlign = 'left'; }
  const R = { undo: { x: 26, y: CH - FOOT + 14, w: 190, h: 64 }, shuffle: { x: 236, y: CH - FOOT + 14, w: 230, h: 64 }, ai: { x: CW - 296, y: CH - FOOT + 14, w: 270, h: 64 } };
  function draw(t) {
    g.fillStyle = '#1d2733'; g.fillRect(0, 0, CW, CH);
    // header
    g.fillStyle = '#121a24'; g.fillRect(0, 0, CW, HEAD); g.fillStyle = '#c4a35a'; g.fillRect(0, HEAD - 4, CW, 4);
    g.fillStyle = '#fff'; g.font = `900 36px ${FONT}`; g.textBaseline = 'middle'; g.fillText('DESIGN TRAINER', 28, 32);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `600 22px ${FONT}`; g.fillText(deck ? `${deck.label}${deck.source === 'seed' ? '' : ''}` : 'Kelly Kapoor · Printful + Tapstitch', 30, 64);
    const { k, p, n } = counts(), cur = curId();
    if (deck) { g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = `900 40px ${FONT}`; g.fillText(`${Math.min(k + p + (cur ? 1 : 0), n)} / ${n}`, CW - 28, 34); g.font = `700 22px ${FONT}`; g.fillStyle = '#9fe0b0'; g.fillText(`✓ ${k} kept`, CW - 182, 68); g.fillStyle = '#ffaaaa'; g.fillText(`✗ ${p} passed`, CW - 28, 68); g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, HEAD - 4, CW, 4); g.fillStyle = '#c4a35a'; g.fillRect(0, HEAD - 4, CW * (n ? (k + p) / n : 0), 4); }
    // body
    if (!deck) {
      g.fillStyle = '#fff'; g.font = `800 46px ${FONT}`; g.textAlign = 'center'; g.fillText('Loading the designer’s deck' + '.'.repeat(1 + (t / 450 | 0) % 3), CW / 2, CH / 2 - 30);
      g.font = `500 28px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText('Real Printful + Tapstitch ideas only. Cards land here on their own.', CW / 2, CH / 2 + 30);
      if (status) { g.font = `500 20px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText('feed: ' + status, CW / 2, CH / 2 + 80); } g.textAlign = 'left';
    } else if (!cur && !anim) {
      g.textAlign = 'center'; g.fillStyle = '#fff'; g.font = `900 54px ${FONT}`; g.fillText('Deck done 🎉', CW / 2, HEAD + 80);
      g.font = `800 36px ${FONT}`; g.fillStyle = '#9fe0b0'; g.fillText(`${k} kept`, CW / 2 - 140, HEAD + 150); g.fillStyle = '#ffaaaa'; g.fillText(`${p} passed`, CW / 2 + 140, HEAD + 150);
      g.font = `600 26px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'left';
      const kept = st.order.filter(id => st.decisions[id]?.d === 'keep').map(byId).filter(Boolean); let yy = HEAD + 210;
      g.fillStyle = '#c4a35a'; g.font = `800 26px ${FONT}`; g.fillText(kept.length ? 'YOU KEPT' : 'Nothing kept this round', 120, yy); yy += 40; g.font = `600 25px ${FONT}`; g.fillStyle = '#fff';
      kept.slice(0, 16).forEach((c, i) => { const col = i % 2, row = i / 2 | 0; g.fillText(wrap(g, `✓ ${c.title}`, 510, 1)[0] || '', 120 + col * 540, yy + row * 36); });
      g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.65)'; g.font = `600 22px ${FONT}`; g.fillText(out.length ? `${out.length} swipe${out.length > 1 ? 's' : ''} still sending…` : 'All swipes saved for the designer’s training ✓', CW / 2, CH - FOOT - 20); g.textAlign = 'left';
    } else {
      // swipe zones
      const zl = hover === 'pass', zr = hover === 'keep';
      g.fillStyle = zl ? 'rgba(214,69,69,.35)' : 'rgba(214,69,69,.12)'; g.fillRect(0, HEAD, 160, CH - HEAD - FOOT);
      g.fillStyle = zr ? 'rgba(46,157,79,.38)' : 'rgba(46,157,79,.12)'; g.fillRect(CW - 160, HEAD, 160, CH - HEAD - FOOT);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `900 46px ${FONT}`;
      g.fillStyle = zl ? '#ffb4b4' : '#e07a7a'; g.fillText('◀', 80, CH / 2 - 40); g.font = `900 36px ${FONT}`; g.fillText('PASS', 80, CH / 2 + 12); g.font = `700 20px ${FONT}`; g.fillText('B · LB', 80, CH / 2 + 52);
      g.font = `900 46px ${FONT}`; g.fillStyle = zr ? '#b6f5c8' : '#6fcf8c'; g.fillText('▶', CW - 80, CH / 2 - 40); g.font = `900 36px ${FONT}`; g.fillText('KEEP', CW - 80, CH / 2 + 12); g.font = `700 20px ${FONT}`; g.fillText('A · RB', CW - 80, CH / 2 + 52); g.textAlign = 'left';
      // next card peeking behind, then current / outgoing
      const nextIds = st.order.filter(id => !st.decisions[id]); const under = anim ? nextIds[0] : nextIds[1];
      if (under && byId(under)) drawCard(byId(under), 0, 0, anim ? 0.55 + 0.45 * Math.min(1, (t - anim.t0) / 320) : 0.35, null);
      if (anim) { const e = Math.min(1, (t - anim.t0) / 320), c = byId(anim.id); if (c) drawCard(c, anim.dir * e * 1100, anim.dir * e * 0.35, 1 - e * 0.6, anim.dir > 0 ? 'keep' : 'pass'); if (e >= 1) { anim = null; dirty = true; } }
      else if (cur) { const lean = hover === 'keep' ? 1 : hover === 'pass' ? -1 : 0; drawCard(byId(cur), lean * 18, lean * 0.02, 1, null); }
    }
    // footer
    g.fillStyle = '#121a24'; g.fillRect(0, CH - FOOT, CW, FOOT);
    btn(R.undo, '↶ UNDO  X', !!st?.history.length, hover === 'undo');
    btn(R.shuffle, '↻ RESHUFFLE', !!deck, hover === 'shuffle', !cur && deck ? '#2e7d4f' : '#3a4150');
    btn(R.ai, '✨ AI SUGGEST · soon', false, false);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `700 20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(!deck ? '' : !cur ? 'A = reshuffle · tap ↻' : 'Tap right = KEEP · left = PASS · D-pad ◀ ▶', (R.shuffle.x + R.shuffle.w + R.ai.x) / 2, CH - FOOT / 2 - 12);
    g.font = `500 16px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText('every swipe trains the designer · Printful + Tapstitch only', (R.shuffle.x + R.shuffle.w + R.ai.x) / 2, CH - FOOT / 2 + 18); g.textAlign = 'left';
    tex.needsUpdate = true;
  }

  return {
    mesh,
    get hasDeck() { return !!deck; },
    setDeck(d) { try { setDeck(d); } catch (e) { status = 'deck error: ' + String(e?.message || e).slice(0, 60); deck = null; dirty = true; throw e; } },
    setStatus(t) { if (t !== status) { status = String(t || ''); dirty = true; } },
    deckId: () => deck?.id || null,
    // uv on the screen -> 'keep' | 'pass' | 'undo' | 'shuffle' | 'idle'
    hit(uv) {
      if (!uv) return 'idle'; const px = uv.x * CW, py = (1 - uv.y) * CH, inR = r => px > r.x - 6 && px < r.x + r.w + 6 && py > r.y - 6 && py < r.y + r.h + 6;
      if (py > CH - FOOT) return inR(R.undo) ? 'undo' : inR(R.shuffle) ? 'shuffle' : 'idle';
      if (!deck || py < HEAD) return 'idle';
      if (!curId()) return 'shuffle';
      return px < CW / 2 ? 'pass' : 'keep';
    },
    setHover(k) { if (hover !== k) { hover = k; dirty = true; } },
    // one action: 'keep' | 'pass' | 'undo' | 'shuffle'. Returns what happened for the toast.
    act(k) {
      if (!deck) return 'nodeck';
      if (k === 'undo') return undo();
      if (k === 'shuffle') return reshuffle();
      if (k === 'keep' || k === 'pass') { if (!curId()) return 'end'; return swipe(k); }
      return null;
    },
    // controller mapping while aiming at the wall
    padKey(gp) {
      const end = deck && !curId();
      if (gp.A) return end ? 'shuffle' : 'keep';
      if (gp.RB || gp.dpad.right) return 'keep';
      if (gp.B || gp.LB || gp.dpad.left) return 'pass';
      if (gp.X || gp.dpad.down) return 'undo';
      if (gp.Y && end) return 'shuffle';
      return null;
    },
    hint(k) {
      const end = deck && !curId();
      if (!deck) return '🃏 Design Trainer · loading the designer’s deck';
      if (end) return k === 'undo' ? '↶ Undo last swipe · X / tap' : '↻ Reshuffle the deck · A / tap';
      return k === 'undo' ? '↶ Undo last swipe · X / tap' : k === 'shuffle' ? '↻ Reshuffle · tap' : k === 'pass' ? '◀ PASS · B / LB / ◀ / tap left' : '▶ KEEP · A / RB / ▶ / tap right';
    },
    pending: () => out.length,
    stats: () => ({ ...counts(), pending: out.length, deck: deck?.id, source: deck?.source }),
    tick(t, visible) { if (!visible) return; if (dirty || anim || (!deck && t - lastDraw > 450)) { dirty = false; lastDraw = t; try { draw(t); } catch (e) { status = 'draw error: ' + String(e?.message || e).slice(0, 60); console.warn('swipe draw', e); tex.needsUpdate = true; } } },
    flush,
  };
}
