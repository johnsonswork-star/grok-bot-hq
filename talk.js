// HQ #54: speech bubbles + teammates speaking for themselves, in character.
// Small talk queue: say(botId, line, { ttl, prio }). One bubble per person (a world-space billboard above their head that
// fades in, holds a few seconds, fades out); at most MAX_LIVE bubbles on screen, the rest wait in line. When the speaker is
// off-screen or far away, the line also shows as a small caption at the bottom so you don't miss it.
// Lines come from REAL events only (see main.js wiring): tasks.json busy/stage, the live work feed (stage, pick cards,
// picks done, waiting on Chris, `says`), Needs you items, HQ chat (you message someone / a reply attributed to them).
// Words are local templates in voices.js (free). Custom lines a bot writes itself ride in the work feed as `says`
// (tools/work-live.mjs say <bot> "line"). No AI calls happen in the office, ever. Rare idle one-liners only near you.
import * as THREE from './vendor/three.module.js';
import { voiceLine, shortTask, listPicks } from './voices.js';

const MAX_LIVE = 3, BOT_GAP = 25e3, IDLE_MIN = 4 * 60e3, IDLE_MAX = 8 * 60e3, FRESH = 10 * 60e3, WARMUP = 6000;
const FONT = '"Segoe UI",system-ui,Arial,sans-serif';
const quiet = /[?&]quiet=1/.test(location.search) || (() => { try { return localStorage.getItem('hq.talk') === 'off'; } catch (e) { return false; } })();

function wrap(g, text, maxW) {
  const words = String(text).split(/\s+/), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].replace(/\s*\S*$/, '') + '…'; }
  return lines;
}

export function createTalk({ scene, workers, stations, camera }) {
  const t0 = performance.now(), ready = () => performance.now() - t0 > WARMUP;
  const byId = id => stations.find(s => s.id === id);
  const queue = [], live = new Map(), lastSaid = new Map(), recent = new Map(); // live: id -> bubble
  let nextIdle = performance.now() + IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);

  // caption strip for speakers you can't see
  const cap = document.createElement('div'); cap.id = 'talkcap';
  cap.style.cssText = 'position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:min(80vw,640px);z-index:30;pointer-events:none;display:flex;flex-direction:column;gap:6px;align-items:center;font:600 15px ' + FONT;
  document.body.appendChild(cap);
  function caption(st, text, ttl) {
    const d = document.createElement('div');
    d.style.cssText = `background:rgba(20,18,16,.82);color:#fff;padding:6px 12px;border-radius:14px;border-left:4px solid ${st.color};transition:opacity .5s;opacity:0`;
    d.innerHTML = `<b style="color:${st.color}">${st.short}</b> ${String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}`;
    cap.appendChild(d); while (cap.children.length > 3) cap.firstChild.remove();
    requestAnimationFrame(() => { d.style.opacity = '1'; });
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 600); }, ttl);
  }

  function makeBubble(st, text) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), W = 560, P = 22, LH = 38;
    g.font = `600 30px ${FONT}`;
    const lines = wrap(g, text, W - P * 2), H = 44 + lines.length * LH + P + 26;
    c.width = W; c.height = H;
    const bh = H - 26, r = 26;
    g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.roundRect(6, 8, W - 10, bh - 4, r); g.fill();
    g.fillStyle = '#fffdf6'; g.beginPath(); g.roundRect(3, 3, W - 10, bh - 6, r); g.fill();
    g.beginPath(); g.moveTo(W / 2 - 22, bh - 4); g.lineTo(W / 2, H - 2); g.lineTo(W / 2 + 16, bh - 4); g.closePath(); g.fill(); // tail
    g.lineWidth = 5; g.strokeStyle = st.color; g.beginPath(); g.roundRect(3, 3, W - 10, bh - 6, r); g.stroke();
    g.fillStyle = st.color; g.font = `800 22px ${FONT}`; g.textBaseline = 'top'; g.fillText(st.short, P, 14);
    g.fillStyle = '#1d1b19'; g.font = `600 30px ${FONT}`;
    lines.forEach((l, i) => g.fillText(l, P, 42 + i * LH));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    const w = 1.75; sp.scale.set(w, w * H / W, 1); sp.center.set(0.5, 0); sp.renderOrder = 9; sp.userData.base = sp.scale.clone();
    scene.add(sp); return sp;
  }

  function say(id, text, { ttl, prio = 0, force = false } = {}) {
    if (!text || (quiet && !force)) return false;
    const st = byId(id); if (!st) return false;
    const k = id + '|' + text; if (recent.has(k) && performance.now() - recent.get(k) < 120e3) return false; recent.set(k, performance.now());
    ttl = ttl || Math.max(3500, Math.min(8500, 2200 + text.length * 60));
    queue.push({ id, st, text: String(text).slice(0, 200), ttl, prio, at: performance.now() });
    queue.sort((a, b) => b.prio - a.prio || a.at - b.at);
    return true;
  }
  // character line for an event; per-person cooldown so a burst of updates doesn't turn into a monologue
  function react(id, ev, vars = {}, opt = {}) {
    if (!ready() && !opt.force) return false;
    const now = performance.now(); if (!opt.force && now - (lastSaid.get(id) || -1e9) < BOT_GAP) return false;
    const line = voiceLine(id, ev, { ...vars, task: vars.task ? shortTask(vars.task) : '', picks: vars.picks ? listPicks(vars.picks) : '' });
    if (say(id, line, opt)) { lastSaid.set(id, now); return true; } return false;
  }

  const fr = new THREE.Frustum(), pm = new THREE.Matrix4(), v = new THREE.Vector3();
  function update(dt, player) {
    const now = performance.now();
    // start queued lines (one bubble per person; oldest lines just expire)
    for (let i = 0; i < queue.length && live.size < MAX_LIVE; i++) {
      const q = queue[i]; if (live.has(q.id)) continue;
      queue.splice(i--, 1); if (now - q.at > 90e3) continue;
      const w = workers.get(q.id); if (!w) continue;
      const b = { q, w, sp: makeBubble(q.st, q.text), start: now, end: now + q.ttl, shown: false };
      live.set(q.id, b);
    }
    camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pm);
    const placed = [];
    for (const [id, b] of live) {
      const { w, sp } = b;
      if (now > b.end) { scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); live.delete(id); continue; }
      const d = Math.hypot(player.pos.x - w.x, player.pos.z - w.z);
      const s = Math.min(1.8, Math.max(1, d / 5)); sp.scale.set(sp.userData.base.x * s, sp.userData.base.y * s, 1); // stays readable across the room
      // people standing close together: stack the newer bubble above the older one so they don't overlap
      let head = 2.18 - w.sit * 0.27;
      const base = head; for (const o of placed) if (Math.hypot(o.x - w.x, o.z - w.z) < 0.9 && head < o.top + 0.05) head = Math.min(base + 1.2, o.top + 0.05);
      sp.position.set(w.x, head, w.z); placed.push({ x: w.x, z: w.z, top: head + sp.scale.y });
      const fin = Math.min(1, (now - b.start) / 220), fout = Math.min(1, (b.end - now) / 600);
      sp.material.opacity = Math.min(fin, fout) * (d > 20 ? 0 : d > 16 ? (20 - d) / 4 : 1);
      if (!b.shown) { // first frame: if you can't see them, put it in the caption strip too
        b.shown = true; v.set(w.x, head, w.z);
        if (d > 12 || !fr.containsPoint(v)) caption(b.q.st, b.q.text, b.q.ttl);
      }
    }
    // rare idle small talk, only from someone idle near you (local lines, free). #56 will own real banter.
    if (!quiet && now > nextIdle) {
      nextIdle = now + IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
      const near = workers.workers.filter(w => !w.busy && !live.has(w.st.id) && Math.hypot(player.pos.x - w.x, player.pos.z - w.z) < 9);
      if (near.length && !document.hidden) { const w = near[(Math.random() * near.length) | 0]; react(w.st.id, 'idle'); }
    }
  }

  // ---------- event sources (called from main.js) ----------
  const statusMem = new Map(); // tasks.json: id -> { busy, task, stage, waiting }
  function onStatus(st, busy, task, meta = {}) {
    const p = statusMem.get(st.id), n = { busy, task, stage: busy ? meta.stage || '' : '', waiting: busy ? meta.waiting || '' : '' };
    statusMem.set(st.id, n); if (!p) return;
    if (busy && !p.busy) react(st.id, n.stage && n.stage !== 'working' ? n.stage : 'start', { task });
    else if (!busy && p.busy) react(st.id, 'free');
    else if (busy && n.stage && n.stage !== p.stage) react(st.id, n.stage, { task });
    else if (busy && n.waiting && !p.waiting) react(st.id, 'ask', { task });
    else if (busy && task !== p.task && task) react(st.id, 'start', { task });
  }
  const pickSaid = new Map(); // id -> when they last reacted to your picks (tap SUBMIT and the feed confirming = one reaction)
  const workMem = new Map(); let workSeeded = false; const saysSeen = new Set(JSON.parse(localStorage.getItem('hq.saysSeen') || '[]'));
  function onWork(feed) {
    const bots = feed?.bots || {};
    for (const [id, wk] of Object.entries(bots)) {
      const p = workMem.get(id), pk = wk.pick, n = { stage: wk.stage, pick: pk ? pk.id + (pk.done ? ':done' : '') : '', waiting: wk.waiting || '', task: wk.task || '' };
      workMem.set(id, n); if (!p || !workSeeded) continue;
      const task = wk.task || byId(id)?.task || '', fresh = x => Date.now() - (x || 0) < FRESH;
      if (pk && pk.done && p.pick === pk.id) { if (fresh(pk.pickedAt) && !(Date.now() - (pickSaid.get(id) || 0) < FRESH)) { pickSaid.set(id, Date.now()); react(id, 'picked', { picks: pk.picked }, { force: true, prio: 2 }); } }
      else if (pk && !pk.done && n.pick !== p.pick) react(id, 'ask', { task: pk.title || task }, { prio: 1 });
      else if (n.stage && n.stage !== p.stage && fresh(wk.stageAt || wk.at)) react(id, n.stage, { task });
      else if (n.waiting && !p.waiting && fresh(wk.at)) react(id, 'ask', { task });
    }
    // lines a bot wrote itself for a real event (work-live.mjs say): shown once per device, only while fresh
    for (const s of feed?.says || []) {
      if (!s || !s.id || saysSeen.has(s.id)) continue; saysSeen.add(s.id);
      if (Date.now() - (s.at || 0) < FRESH) say(s.bot, s.text, { prio: 2, force: true });
    }
    try { localStorage.setItem('hq.saysSeen', JSON.stringify([...saysSeen].slice(-80))); } catch (e) {}
    workSeeded = true;
  }
  let needsMem = null;
  function onNeeds(list) {
    const open = new Map((list?.open || []).map(r => [r.key, r]));
    if (needsMem && ready()) {
      for (const [k, r] of open) if (!needsMem.has(k) && k.startsWith('n:')) { const id = idFromWho(r.who) || 'grok'; react(id, 'ask', { task: r.title }, { prio: 1 }); }
      for (const [k, r] of needsMem) if (!open.has(k)) { const id = k.startsWith('w:') || k.startsWith('t:') ? k.slice(2) : idFromWho(r.who) || 'profile'; if (!k.startsWith('w:')) react(id, 'cleared'); }
    }
    needsMem = open;
  }
  function idFromWho(who) {
    const w = String(who || '').toLowerCase().replace(/^\*+|\*+$/g, '').trim(); if (!w) return null;
    const s = stations.find(s => [s.name, s.bot, s.short, s.name.split(' ')[0], s.id].some(x => x && (w === x.toLowerCase() || w.startsWith(x.toLowerCase() + ' ·'))));
    return s ? s.id : null;
  }
  // HQ chat: you message someone -> they acknowledge; a reply attributed to them -> they say it (opener + first bit of the reply)
  let chatSeen = null;
  function onChat(entries) {
    const ids = new Set(entries.map(e => e.kind === 'bot' ? 'b' + e.id : 'm' + e.at));
    if (!chatSeen) { chatSeen = ids; return; }
    for (const e of entries) {
      const k = e.kind === 'bot' ? 'b' + e.id : 'm' + e.at; if (chatSeen.has(k)) continue; chatSeen.add(k);
      if (Date.now() - (Date.parse(e.at) || +e.at || 0) > FRESH) continue;
      if (e.kind === 'me') { const id = idFromWho(e.to) || 'grok'; react(id, 'heard', {}, { force: true }); }
      else if (e.kind === 'bot' && e.text) {
        const id = idFromWho(e.from) || 'grok', body = String(e.text).replace(/\s+/g, ' ').trim();
        const bit = body.length > 120 ? body.slice(0, 117).replace(/\s+\S*$/, '') + '…' : body;
        if (Math.random() < 0.5) react(id, 'reply', {}, { force: true, prio: 2 });
        say(id, bit, { prio: 2, force: true, ttl: Math.min(9000, 3000 + bit.length * 55) });
      }
    }
  }
  function onPickSent(id, picks) { pickSaid.set(id, Date.now()); react(id, 'picked', { picks }, { force: true, prio: 2 }); }

  return { say, react, update, onStatus, onWork, onNeeds, onChat, onPickSent, live, queue, quiet };
}
