// Worker characters: one low-poly person per bot station.
// Idle  -> wanders the floor (water cooler, windows, phone, chatting, thinking).
// Busy  -> walks to its own desk, sits, and types until the task clears.
// "Busy" comes from tasks.json (polled), ?busy=id,id URL override, or window.__office.workers.setBusy(id, task).
import * as THREE from './vendor/three.module.js';
import { buildCharacter } from './characters.js';

const CELL = 0.4, GX0 = -20, GZ0 = -14, GW = 100, GD = 70; // nav grid over the room
const R = 0.3;              // worker radius for nav
const WALK = 1.25;          // m/s (player walks 3.2, people stroll)
const TASKS_URL = './tasks.json';
const POLL_MS = 20000;

const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#8d5a3b', '#f5d6bd', '#a86f4c'];
const HAIR = ['#2b1d14', '#5a3a22', '#141414', '#8a5a2b', '#c9a25a', '#3d2a1e', '#6b6b6b'];
const PANTS = ['#2f3640', '#3b3f47', '#4a4038', '#283447', '#3a3a3a'];

// shared geometry (one set for all workers)
const G = {
  torso: new THREE.CylinderGeometry(0.17, 0.15, 0.56, 8),
  head: new THREE.SphereGeometry(0.12, 10, 8),
  hair: new THREE.SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
  leg: new THREE.BoxGeometry(0.12, 0.8, 0.13).translate(0, -0.4, 0),
  arm: new THREE.BoxGeometry(0.09, 0.56, 0.1).translate(0, -0.28, 0),
  cup: new THREE.CylinderGeometry(0.035, 0.03, 0.09, 8),
  phone: new THREE.BoxGeometry(0.07, 0.13, 0.012),
};
const matCache = new Map();
const mat = c => { if (!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })); return matCache.get(c); };

function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

// Office cast models live in characters.js (HQ #46). Same rig shape as before, so all the animation below still applies.
function buildPerson(st) {
  return buildCharacter(st, { cupGeo: G.cup, phoneGeo: G.phone, cupMat: mat('#f2f2f0'), phoneMat: mat('#16181c') });
}

function tagSprite(st) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(0.62, 0.155, 1); sp.renderOrder = 6;
  sp.userData.draw = busy => {
    const g = c.getContext('2d'); g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(24,22,20,.8)'; g.beginPath(); g.roundRect ? g.roundRect(4, 6, 248, 52, 26) : g.rect(4, 6, 248, 52); g.fill();
    g.lineWidth = 4; g.strokeStyle = st.color; g.stroke();
    g.fillStyle = busy ? '#ffb74d' : '#7CFC9A'; g.beginPath(); g.arc(34, 32, 10, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '700 30px system-ui,Segoe UI,Arial'; g.textBaseline = 'middle';
    g.fillText(st.short, 54, 33);
    tex.needsUpdate = true;
  };
  return sp;
}

export function createWorkers({ scene, stations, colliders: baseColliders, extraColliders = [], pois = null, onStatus }) {
  const colliders = baseColliders.concat(extraColliders); // extra = things only workers avoid (pod dividers)
  // ---------- nav grid + A* ----------
  const blockedAt = (x, z, r = R) => { for (const c of colliders) if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true; return false; };
  const free = new Uint8Array(GW * GD);
  const cx = i => GX0 + (i + 0.5) * CELL, cz = j => GZ0 + (j + 0.5) * CELL;
  for (let j = 0; j < GD; j++) for (let i = 0; i < GW; i++) free[j * GW + i] = blockedAt(cx(i), cz(j)) ? 0 : 1;
  const toCell = (x, z) => [Math.max(0, Math.min(GW - 1, Math.floor((x - GX0) / CELL))), Math.max(0, Math.min(GD - 1, Math.floor((z - GZ0) / CELL)))];
  function nearestFree(x, z) {
    const [i0, j0] = toCell(x, z);
    for (let r = 0; r < 12; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj; if (i >= 0 && j >= 0 && i < GW && j < GD && free[j * GW + i]) return [i, j];
    }
    return [i0, j0];
  }
  function los(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.15);
    for (let k = 1; k < n; k++) { const t = k / n; if (blockedAt(ax + (bx - ax) * t, az + (bz - az) * t, R - 0.04)) return false; }
    return true;
  }
  const closed = new Uint8Array(GW * GD), gScore = new Float32Array(GW * GD), came = new Int32Array(GW * GD), stamp = new Int32Array(GW * GD); let run = 0;
  function astar(ax, az, bx, bz) {
    const [si, sj] = nearestFree(ax, az), [ti, tj] = nearestFree(bx, bz);
    const s = sj * GW + si, t = tj * GW + ti; run++;
    const heap = []; const push = (n, f) => { heap.push([f, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    stamp[s] = run; gScore[s] = 0; came[s] = -1; push(s, 0);
    let found = false, iter = 0;
    closed.fill(0);
    while (heap.length && iter++ < 60000) {
      const [, n] = pop(); if (n === t) { found = true; break; }
      if (closed[n]) continue; closed[n] = 1;
      const i = n % GW, j = (n / GW) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GD) continue;
        const m = nj * GW + ni; if (!free[m]) continue;
        if (di && dj && (!free[j * GW + ni] || !free[nj * GW + i])) continue; // no corner cutting
        const g = gScore[n] + (di && dj ? 1.414 : 1);
        if (stamp[m] !== run || g < gScore[m]) { stamp[m] = run; gScore[m] = g; came[m] = n; push(m, g + Math.hypot(ti - ni, tj - nj)); }
      }
    }
    if (!found) return null;
    const cells = []; for (let n = t; n !== -1; n = came[n]) cells.push([cx(n % GW), cz((n / GW) | 0)]);
    cells.reverse();
    // string-pull with line-of-sight so they walk straight lines, not grid zigzags
    const out = []; let cur = [ax, az], k = 0;
    while (k < cells.length) {
      let far = k; for (let q = cells.length - 1; q > k; q--) if (los(cur[0], cur[1], cells[q][0], cells[q][1])) { far = q; break; }
      cur = cells[far]; out.push(cur); k = far + 1;
    }
    out.push([bx, bz]);
    return out;
  }

  // ---------- places to hang out when idle ----------
  const P = (x, z, yaw, act) => { const [i, j] = nearestFree(x, z); return { x: cx(i), z: cz(j), yaw, act }; };
  // idle spots come from main.js (floor-plan specific): [x, z, yaw, act]. Drinks happen ONLY at the water cooler (HQ #20).
  const POIS = (pois || [[0, 0, 0, 'think']]).map(([x, z, yaw, act]) => P(x, z, yaw, act));

  // ---------- one worker per station ----------
  const workers = [];
  const tmp = new THREE.Vector3();
  for (const st of stations) {
    const p = buildPerson(st); scene.add(p.root);
    const tag = tagSprite(st); tag.position.y = 2.02; p.root.add(tag);
    st.group.updateMatrixWorld(true);
    const dd = 0.8 * (st.hero ? 1.25 : 1);
    const seat = new THREE.Vector3(0, 0, dd / 2 + 0.3).applyMatrix4(st.group.matrixWorld);
    const approach = new THREE.Vector3(0, 0, dd / 2 + 1.25).applyMatrix4(st.group.matrixWorld);
    const w = { st, ...p, tag, seat, approach, x: 0, z: 0, yaw: Math.random() * 6.28, busy: false, task: '',
      state: 'idle', path: null, after: null, timer: 0, phase: Math.random() * 6.28, act: 'think', actYaw: 0, sit: 0, speed: 0, sitPose: 0 };
    workers.push(w);
  }
  const hero = stations.find(s => s.hero);
  const groundY = (x, z) => hero && hero.platform && Math.hypot(x - hero.x, z - hero.z) < 2.65 ? 0.06 : 0; // no raised hero platform in the Scranton layout

  function goTo(w, x, z, then, mustArrive = false) {
    const path = astar(w.x, w.z, x, z) || (mustArrive ? [[x, z]] : null); // desk trips never give up
    if (!path) { w.path = null; w.state = 'pause'; w.timer = 1 + Math.random() * 2; return; }
    w.path = path; w.state = 'walk'; w.after = then;
  }
  function chooseIdle(w) {
    // prefer a nearby spot nobody else is using; sometimes go chat with another idle worker
    const used = new Set(workers.filter(o => o !== w && o.poi).map(o => o.poi));
    if (Math.random() < 0.18) {
      const mates = workers.filter(o => o !== w && !o.busy && o.state === 'act' && !o.chatWith);
      if (mates.length) {
        const m = mates[(Math.random() * mates.length) | 0];
        const a = Math.random() * 6.28, tx = m.x + Math.cos(a) * 0.9, tz = m.z + Math.sin(a) * 0.9;
        if (!blockedAt(tx, tz)) { w.poi = null; w.chatWith = m; m.chatWith = w; goTo(w, tx, tz, () => startAct(w, 'chat', Math.atan2(-(m.x - w.x), -(m.z - w.z)))); return; }
      }
    }
    const opts = POIS.filter(p => !used.has(p)).map(p => ({ p, d: Math.hypot(p.x - w.x, p.z - w.z) + Math.random() * 8 })).sort((a, b) => a.d - b.d);
    const choice = opts[Math.min(opts.length - 1, (Math.random() * 4) | 0)]?.p;
    if (!choice) { w.state = 'pause'; w.timer = 2; return; }
    w.poi = choice; w.chatWith = null;
    goTo(w, choice.x, choice.z, () => startAct(w, choice.act, choice.yaw + (Math.random() - 0.5) * 0.5));
  }
  function startAct(w, act, yaw) {
    w.state = 'act'; w.act = act; w.actYaw = yaw; w.timer = act === 'chat' ? 5 + Math.random() * 4 : 5 + Math.random() * 7;
    if (act === 'chat' && w.chatWith) { const m = w.chatWith; m.actYaw = Math.atan2(-(w.x - m.x), -(w.z - m.z)); m.timer = Math.max(m.timer, w.timer); m.act = 'chat'; }
  }
  function release(w) { if (w.chatWith) { w.chatWith.chatWith = null; w.chatWith = null; } w.poi = null; }
  function goToDesk(w) {
    release(w);
    goTo(w, w.approach.x, w.approach.z, () => { w.path = [[w.seat.x, w.seat.z]]; w.state = 'walk'; w.after = () => { w.state = 'work'; w.x = w.seat.x; w.z = w.seat.z; }; w.free = true; }, true);
  }
  function leaveDesk(w) {
    w.state = 'walk'; w.free = true; w.path = [[w.approach.x, w.approach.z]]; w.after = () => { w.free = false; chooseIdle(w); };
  }

  function applyBusy(w, busy, task, meta = {}) {
    const was = w.busy; w.busy = busy; w.task = busy ? task || 'On a task' : '';
    w.tag.userData.draw(busy);
    if (was !== busy || onStatus) onStatus?.(w.st, busy, w.task, meta);
    if (was === busy) return;
    if (busy) goToDesk(w);
    else if (w.state === 'work' || (w.after && w.free)) leaveDesk(w);
    else { release(w); chooseIdle(w); }
  }

  // ---------- busy source ----------
  const override = new Map(); // manual setBusy() calls win over tasks.json
  let fileBusy = {};
  const urlBusy = (new URLSearchParams(location.search).get('busy') || '').split(',').map(s => s.trim()).filter(Boolean);
  function resolve() {
    const now = Date.now();
    for (const w of workers) {
      const id = w.st.id;
      let entry = override.has(id) ? override.get(id) : fileBusy[id];
      if (urlBusy.includes(id) || urlBusy.includes('all')) entry = entry || 'Test task (URL ?busy=)';
      let busy = false, task = '', meta = {};
      if (entry) {
        if (typeof entry === 'string') { busy = true; task = entry; }
        else if (typeof entry === 'object') { busy = entry.busy !== false && !(entry.until && Date.parse(entry.until) < now); task = entry.task || ''; meta = { since: entry.since, until: entry.until, stage: entry.stage, pct: entry.pct }; }
        else busy = !!entry;
      }
      const mk = JSON.stringify(meta);
      if (busy !== w.busy || task !== w.task || mk !== w.metaKey) { w.metaKey = mk; applyBusy(w, busy, task, meta); }
    }
  }
  async function poll() {
    try {
      const r = await fetch(TASKS_URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); fileBusy = j.busy || {}; }
    } catch (e) {}
    resolve();
  }

  // ---------- initial placement: busy -> already seated; idle -> scattered around ----------
  const spots = POIS.slice().sort(() => Math.random() - 0.5);
  workers.forEach((w, k) => {
    const s = spots[k % spots.length]; w.x = s.x; w.z = s.z; w.state = 'pause'; w.timer = 0.5 + Math.random() * 3; w.poi = s;
    w.tag.userData.draw(false);
  });
  function seatNow(w) { release(w); w.x = w.seat.x; w.z = w.seat.z; w.yaw = w.st.ry; w.state = 'work'; w.path = null; w.sit = 1; }
  (async () => {
    try { const r = await fetch(TASKS_URL + '?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) fileBusy = (await r.json()).busy || {}; } catch (e) {}
    resolve();
    for (const w of workers) if (w.busy && w.state !== 'work') seatNow(w); // first load: no long walk, they're already at it
    setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    setInterval(resolve, 15000); // expire "until" entries between polls
    document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  })();

  // ---------- per-frame ----------
  const angTo = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  function update(dt, t, player) {
    for (const w of workers) {
      let moving = false;
      if (w.state === 'walk' && w.path) {
        const [tx, tz] = w.path[0]; const dx = tx - w.x, dz = tz - w.z, d = Math.hypot(dx, dz);
        // yield to the player if they're right in front of us
        const pdx = player.pos.x - w.x, pdz = player.pos.z - w.z, pd = Math.hypot(pdx, pdz);
        const yieldP = pd < 0.9 && (pdx * dx + pdz * dz) / (pd * d || 1) > 0.3;
        w.speed += ((yieldP ? 0 : WALK) - w.speed) * Math.min(1, dt * 4);
        if (d < 0.08) { w.path.shift(); if (!w.path.length) { w.path = null; const f = w.after; w.after = null; w.free = false; if (f) f(); else { w.state = 'pause'; w.timer = 1; } } }
        else {
          const step = Math.min(d, w.speed * dt);
          w.x += dx / d * step; w.z += dz / d * step;
          w.yaw += angTo(w.yaw, Math.atan2(-dx, -dz)) * Math.min(1, dt * 8);
          moving = w.speed > 0.15;
        }
      } else w.speed = 0;
      if (w.state === 'pause') { w.timer -= dt; if (w.timer <= 0) { if (w.busy) goToDesk(w); else chooseIdle(w); } }
      if (w.state === 'act') {
        w.timer -= dt; w.yaw += angTo(w.yaw, w.actYaw) * Math.min(1, dt * 3);
        if (w.timer <= 0) { const m = w.chatWith; release(w); if (m) { m.state = 'pause'; m.timer = 0.5 + Math.random(); } w.state = 'pause'; w.timer = 0.2 + Math.random() * 1.5; }
      }
      if (w.state === 'work') { w.yaw += angTo(w.yaw, w.st.ry) * Math.min(1, dt * 5); w.x += (w.seat.x - w.x) * Math.min(1, dt * 5); w.z += (w.seat.z - w.z) * Math.min(1, dt * 5); }
      // light separation so idle folks don't stand inside each other (seated workers stay put)
      if (w.state !== 'work' && !w.free) for (const o of workers) {
        if (o === w) continue; const dx = w.x - o.x, dz = w.z - o.z, d = Math.hypot(dx, dz);
        if (d > 0.01 && d < 0.55) { const px = w.x + dx / d * (0.55 - d) * dt * 3, pz = w.z + dz / d * (0.55 - d) * dt * 3; if (!blockedAt(px, pz, R - 0.08)) { w.x = px; w.z = pz; } }
      }

      // ---------- pose ----------
      const sitT = w.state === 'work' ? 1 : 0; w.sit += (sitT - w.sit) * Math.min(1, dt * 4);
      const s = w.sit; w.phase += dt * (moving ? w.speed * 6.2 : 1.6);
      const swing = moving ? Math.sin(w.phase) * 0.55 * Math.min(1, w.speed / WALK) : 0;
      const breathe = Math.sin(t * 1.7 + w.phase * 0.1) * 0.015;
      w.root.position.set(w.x, groundY(w.x, w.z), w.z); w.root.rotation.y = w.yaw;
      w.body.position.y = (moving ? Math.abs(Math.cos(w.phase)) * 0.035 : 0) - s * 0.27;
      w.body.position.z = -s * 0.04;
      w.legL.rotation.x = swing * (1 - s) + s * 1.45; w.legR.rotation.x = -swing * (1 - s) + s * 1.45;
      let aLx = -swing * 0.9, aRx = swing * 0.9, aLz = 0.06, aRz = -0.06, hx = 0, hy = 0;
      w.cup.visible = false; w.phone.visible = false;
      for (const e of w.extras || []) e.obj.visible = !(e.standOnly && s > 0.4); // Michael's mug goes on the desk when he sits
      if (w.state === 'act' && !moving) {
        const a = w.act;
        if (a === 'water') { w.cup.visible = true; const sip = Math.max(0, Math.sin(t * 0.9 + w.phase)) ** 6; aRx = 0.9 + sip * 1.1; aRz = -0.15; hx = -sip * 0.3; }
        else if (a === 'phone') { w.phone.visible = true; aRx = 1.25 + Math.sin(t * 3 + w.phase) * 0.04; aRz = -0.32; hx = 0.45; hy = 0.15; }
        else if (a === 'think') { aRx = 1.7; aRz = -0.55; aLx = 0.5; aLz = 0.45; hx = -0.1 + Math.sin(t * 0.6) * 0.05; hy = Math.sin(t * 0.4 + w.phase) * 0.35; }
        else if (a === 'window') { aLx = 0.1; aRx = 0.1; aLz = 0.28; aRz = -0.28; hy = Math.sin(t * 0.3 + w.phase) * 0.6; hx = -0.08; }
        else if (a === 'chat') { const g = Math.sin(t * 2.3 + w.phase); aRx = 0.6 + Math.max(0, g) * 0.6; aRz = -0.2; hy = Math.sin(t * 0.7) * 0.15; hx = Math.sin(t * 2.1 + w.phase) * 0.06; }
      } else if (w.state === 'pause' && !moving) { hy = Math.sin(t * 0.8 + w.phase) * 0.5; }
      if (s > 0.01) { // typing at the desk
        const k = t * 11 + w.phase;
        const tl = 1.15 + Math.sin(k) * 0.05 * s, tr = 1.15 + Math.sin(k + 1.9) * 0.05 * s;
        aLx = aLx * (1 - s) + tl * s; aRx = aRx * (1 - s) + tr * s; aLz = aLz * (1 - s) + 0.12 * s; aRz = aRz * (1 - s) - 0.12 * s;
        hx = hx * (1 - s) + (0.12 + Math.sin(t * 0.5 + w.phase) * 0.04) * s; hy = hy * (1 - s) + Math.sin(t * 0.37 + w.phase) * 0.12 * s;
        if (Math.sin(t * 0.21 + w.phase) > 0.93) hy += 0.35 * s; // glance away now and then
      }
      // glance at the player when they're close and we're not busy walking
      const pd = Math.hypot(player.pos.x - w.x, player.pos.z - w.z);
      if (pd < 2.6 && !moving) { const look = angTo(w.yaw, Math.atan2(-(player.pos.x - w.x), -(player.pos.z - w.z))); if (Math.abs(look) < 1.6) hy = hy * 0.3 + look * 0.7; }
      w.armL.rotation.set(aLx, 0, aLz); w.armR.rotation.set(aRx, 0, aRz);
      w.headG.rotation.set(-(hx + breathe), hy, 0); // hx > 0 = look down
      w.tag.position.y = 2.02 - s * 0.27;
      w.tag.material.opacity = (pd > 14 ? 0 : pd > 10 ? (14 - pd) / 4 : 1) * Math.max(0, 1 - s * 1.5); // seated: the desk screen says it
      w.tag.visible = w.tag.material.opacity > 0.02;
    }
  }

  // ray pick so looking at a person focuses that bot
  const sph = new THREE.Sphere(new THREE.Vector3(), 0.42), hit = new THREE.Vector3();
  function pick(ray, maxD = 6) {
    let best = null, bd = maxD;
    for (const w of workers) { sph.center.set(w.x, 1.05 - w.sit * 0.27, w.z); const p = ray.intersectSphere(sph, hit); if (p) { const d = p.distanceTo(ray.origin); if (d < bd) { bd = d; best = w; } } }
    return best;
  }

  return {
    workers, update, pick, poll,
    get: id => workers.find(w => w.st.id === id),
    setBusy(id, task) { override.set(id, task === false || task == null ? false : task || 'On a task'); resolve(); },
    clear(id) { id ? override.delete(id) : override.clear(); resolve(); },
  };
}
