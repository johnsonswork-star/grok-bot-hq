// HQ #96: Darryl works the warehouse floor. Between stretches at his foreman desk he climbs on the forklift and moves pallets
// between the middle racks (east faces, bottom + 2nd level) and the floor, or grabs the pallet jack and shuffles floor pallets.
// Plain scripted coroutines (no AI, no physics). Everything that moves has a live collider in BCOL, and nothing ever moves
// into Chris: if the next step would touch him, Darryl / the forklift / the jack just wait until he steps aside.
// Built at warehouse-local coords (floor y = 0) inside the basement build block, so meshes + colliders land in BASEMENT / BCOL.
const PI = Math.PI;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const fwd = h => [-Math.sin(h), -Math.cos(h)];           // characters + vehicles face local -z
const rgt = h => [Math.cos(h), -Math.sin(h)];
const ease = u => u * u * (3 - 2 * u);
function aabb(c, x, z, w, d, ry) { const co = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry)), hw = (w * co + d * s) / 2, hd = (w * s + d * co) / 2;
  c.minX = x - hw; c.maxX = x + hw; c.minZ = z - hd; c.maxZ = z + hd; return c; }
const hide = c => { c.minX = c.maxX = c.minZ = c.maxZ = 1e6; return c; };
const hits = (c, px, pz, r) => px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ;

export function createWarehouseWork({ THREE, parent, box, std, M, loadMat, colliders, buildCharacter, desk: AT }) {
  const col = () => { const c = hide({}); colliders.push(c); return c; };
  // ---------- forklift (same look as HQ #79, now with a lifting carriage + a steering wheel) ----------
  const LANE = -19.2, PARK = { x: LANE, z: -4.2, h: 0 };
  const FL = { x: PARK.x, z: PARK.z, h: PARK.h, y: 0, load: null, col: col(), v: 0 };
  { const g = FL.g = new THREE.Group(); parent.add(g);
    const fy = std('#f2b705', 0.5, 0.2), blk = std('#1f1f1f', 0.8), steel = std('#444', 0.5, 0.5);
    box(1.1, 0.75, 1.7, fy, 0, 0.6, 0.15, g, false); box(1.0, 0.5, 0.5, blk, 0, 0.55, 1.05, g, false);
    box(0.5, 0.12, 0.5, blk, 0, 1.05, 0.35, g, false); box(0.45, 0.5, 0.08, blk, 0, 1.35, 0.6, g, false);
    for (const sx of [-0.5, 0.5]) { box(0.06, 1.5, 0.06, blk, sx, 1.7, -0.35, g, false); box(0.06, 1.5, 0.06, blk, sx, 1.7, 0.85, g, false); }
    box(1.06, 0.06, 1.3, blk, 0, 2.45, 0.25, g, false);
    for (const sx of [-0.3, 0.3]) box(0.08, 2.4, 0.1, steel, sx, 1.2, -0.72, g, false);
    box(0.05, 0.05, 0.42, blk, 0, 1.12, -0.12, g, false).rotation.x = -0.75;                         // steering column
    { const w = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 6, 16), blk); w.rotation.x = PI / 2 - 0.75; w.position.set(0, 1.27, -0.27); g.add(w); }
    const lift = FL.lift = new THREE.Group(); g.add(lift);
    for (const sx of [-0.3, 0.3]) box(0.12, 0.05, 1.1, std('#333', 0.5, 0.6), sx, 0.12, -1.3, lift, false);
    box(0.9, 0.55, 0.05, blk, 0, 0.42, -0.77, lift, false); for (const sx of [-0.3, 0, 0.3]) box(0.04, 0.55, 0.05, steel, sx, 0.42, -0.79, lift, false);
    const wg = new THREE.CylinderGeometry(0.26, 0.26, 0.2, 12);
    for (const [wx, wz] of [[-0.58, -0.35], [0.58, -0.35], [-0.58, 0.75], [0.58, 0.75]]) { const w = new THREE.Mesh(wg, blk); w.rotation.z = PI / 2; w.position.set(wx, 0.26, wz); g.add(w); } }
  // ---------- pallet jack ----------
  const JLANE = -14.8, JPARK = { x: JLANE, z: 4.6, h: PI / 2 }, HOLD = 1.4; // Darryl stands HOLD m behind the forks, on the handle
  const JK = { x: JPARK.x, z: JPARK.z, h: JPARK.h, up: 0, load: null, col: col(), pump: 0 };
  { const g = JK.g = new THREE.Group(); parent.add(g);
    const red = std('#c62828', 0.5, 0.3), dk = std('#222', 0.5, 0.5);
    JK.forks = new THREE.Group(); g.add(JK.forks); box(0.55, 0.08, 1.2, red, 0, 0.08, 0, JK.forks, false);
    box(0.2, 0.3, 0.2, red, 0, 0.25, 0.65, g, false);
    JK.handle = new THREE.Group(); JK.handle.position.set(0, 0.32, 0.72); g.add(JK.handle);
    box(0.04, 1.1, 0.04, dk, 0, 0.55, 0, JK.handle, false); box(0.32, 0.04, 0.04, dk, 0, 1.1, 0, JK.handle, false); JK.handle.rotation.x = 0.3; }
  // ---------- movable pallets + the spots they live in ----------
  const pallets = [];
  function makePallet(h) { const g = new THREE.Group(); box(1.2, 0.14, 1.0, M.pallet, 0, 0.07, 0, g, false); box(1.1, h, 0.92, loadMat, 0, 0.14 + h / 2, 0, g, false);
    parent.add(g); const p = { g, x: 0, y: 0, z: 0, h: 0, col: col(), on: null }; pallets.push(p); return p; }
  const R = (z, y) => ({ kind: 'rack', x: -22.4, z, y, h: PI / 2, lane: z, ins: [-21.1, z] });       // middle racks, east face
  const F = z => ({ kind: 'floor', x: -16.4, z, y: 0, h: -PI / 2, lane: z, ins: [-17.7, z], jack: true });
  const spots = [R(-3.63, 0.15), R(-2.37, 0.15), R(-3.63, 1.5), R(-2.37, 1.5), R(2.8, 0.15), R(4.2, 0.15), R(2.8, 1.5), R(4.2, 1.5),
    F(0.4), F(1.9), F(3.4), { ...F(4.9), jack: false }, { kind: 'floor', x: LANE, z: -6.9, y: 0, h: 0, lane: PARK.z, ins: [LANE, -5.6] }];
  function put(p, s, save = true) { p.on = s; s.p = p; p.x = s.x; p.y = s.y; p.z = s.z; p.h = s.h; if (s.kind === 'floor') aabb(p.col, p.x, p.z, 1.25, 1.05, p.h); else hide(p.col); if (save) persist(); }
  function take(s) { const p = s.p; s.p = null; p.on = null; hide(p.col); return p; }
  const LS_KEY = 'hq.wh.pallets.v1';
  function persist() {
    try {
      const map = spots.map(s => s.p ? pallets.indexOf(s.p) : -1);
      localStorage.setItem(LS_KEY, JSON.stringify(map));
    } catch (e) {}
  }
  function loadPersist() {
    try {
      const raw = localStorage.getItem(LS_KEY); if (!raw) return false;
      const map = JSON.parse(raw); if (!Array.isArray(map) || map.length !== spots.length) return false;
      // clear defaults then re-seat from saved indices
      for (const s of spots) s.p = null;
      for (const p of pallets) p.on = null;
      let ok = true;
      map.forEach((pi, si) => {
        if (pi < 0) return;
        if (!pallets[pi] || spots[si].p) { ok = false; return; }
        put(pallets[pi], spots[si], false);
      });
      // any leftover pallets without a spot → first free
      for (const p of pallets) if (!p.on) {
        const s = spots.find(ss => !ss.p); if (s) put(p, s, false); else ok = false;
      }
      return ok;
    } catch (e) { return false; }
  }
  [[0, 1.0], [3, 0.9], [4, 1.05], [5, 0.95], [6, 0.85], [9, 1.2], [11, 0.9], [12, 1.0]].forEach(([i, h]) => put(makePallet(h), spots[i], false));
  if (!loadPersist()) persist();
  // ---------- Darryl ----------
  const rig = buildCharacter({ id: 'darryl', name: 'Darryl Philbin', color: '#3d5a80' }); parent.add(rig.root);
  const D = { mode: 'desk', x: AT.x, z: AT.z, h: AT.ry, y: 0, sit: 1, arms: 'type', col: col(), lx: AT.x, lz: AT.z, spd: 0, ph: 0 };
  // ---------- the player (Chris) + "never move into him" ----------
  const P = { on: false, x: 0, z: 0 }, RP = 0.3 + 0.22, T = [{}, {}, {}];
  const clear = (...bs) => !P.on || !bs.some(b => hits(b, P.x, P.z, RP));
  const flFoot = (x, z, h, c = T[0]) => { const [fx, fz] = fwd(h); return aabb(c, x + fx * 0.275, z + fz * 0.275, 1.3, 3.15, h); };
  const jkFoot = (x, z, h, c = T[0]) => { const [fx, fz] = fwd(h); return aabb(c, x - fx * 0.125, z - fz * 0.125, JK.load ? 1.25 : 0.6, JK.load ? 1.5 : 1.45, h); };
  const jkMan = (x, z, h, c = T[1]) => { const [fx, fz] = fwd(h); return aabb(c, x - fx * HOLD, z - fz * HOLD, 0.5, 0.5, 0); };
  // ---------- coroutine steps (each loop yields first, then gets this frame's dt) ----------
  function* wait(s) { while (s > 0) s -= yield; }
  function* tween(sec, fn) { let t = 0; for (;;) { const dt = yield; t = Math.min(sec, t + dt); fn(ease(t / sec)); if (t >= sec) return; } }
  function* face(h, rate = 4.5) { for (;;) { const dt = yield; const df = angDiff(D.h, h); if (Math.abs(df) < 0.01) { D.h = h; return; } D.h += Math.sign(df) * Math.min(Math.abs(df), rate * dt); } }
  function* walk(pts, speed = 1.15) {
    for (const [tx, tz] of pts) for (;;) {
      const dt = yield; const dx = tx - D.x, dz = tz - D.z, d = Math.hypot(dx, dz);
      if (d < 0.02) { D.x = tx; D.z = tz; break; }
      const want = Math.atan2(-dx, -dz), df = angDiff(D.h, want); D.h += Math.sign(df) * Math.min(Math.abs(df), 6 * dt);
      if (Math.abs(df) > 0.7) continue;
      const st = Math.min(d, speed * dt), nx = D.x + dx / d * st, nz = D.z + dz / d * st;
      if (!clear(aabb(T[1], nx, nz, 0.5, 0.5, 0))) continue;
      D.x = nx; D.z = nz;
    }
  }
  // vehicles: straight drive (forward or reverse, heading kept), turn in place, lift. Smooth accel / decel.
  function* drive(V, foot, tx, tz, vmax, acc = 1.2) {
    V.v = 0;
    for (;;) { const dt = yield; const dx = tx - V.x, dz = tz - V.z, d = Math.hypot(dx, dz);
      if (d < 0.005) { V.x = tx; V.z = tz; V.v = 0; return; }
      V.v = Math.min(vmax, V.v + acc * dt, Math.sqrt(2 * acc * d) + 0.05); const st = Math.min(d, V.v * dt), nx = V.x + dx / d * st, nz = V.z + dz / d * st;
      if (!clear(...foot(nx, nz, V.h))) { V.v = 0; continue; }
      V.x = nx; V.z = nz; }
  }
  function* turn(V, foot, h, rate) {
    for (;;) { const dt = yield; const df = angDiff(V.h, h); if (Math.abs(df) < 0.004) { V.h = h; return; }
      const nh = V.h + Math.sign(df) * Math.min(Math.abs(df), rate * dt * Math.min(1, 0.25 + Math.abs(df) * 2));
      if (!clear(...foot(V.x, V.z, nh))) continue; V.h = nh; }
  }
  const flF = (x, z, h) => [flFoot(x, z, h)], jkF = (x, z, h) => [jkFoot(x, z, h), jkMan(x, z, h)];
  function* flLift(y, rate = 0.42) { for (;;) { const dt = yield; const d = y - FL.y; if (Math.abs(d) < 0.003) { FL.y = y; return; } FL.y += Math.sign(d) * Math.min(Math.abs(d), rate * dt); } }
  function* flToLane(z) { if (Math.abs(z - FL.z) < 0.01) return; yield* turn(FL, flF, z < FL.z ? 0 : PI, 0.85); yield* drive(FL, flF, LANE, z, 1.5); }
  function* flPick(s) {
    yield* flToLane(s.lane); yield* turn(FL, flF, s.h, 0.85); yield* flLift(s.y + 0.02); yield* wait(0.3);
    yield* drive(FL, flF, s.ins[0], s.ins[1], 0.55, 0.8); FL.load = take(s); yield* flLift(s.y + 0.14, 0.3); yield* wait(0.3);
    yield* drive(FL, flF, LANE, s.lane, 0.55, 0.8); yield* flLift(0.2);
  }
  function* flDrop(s) {
    yield* flToLane(s.lane); yield* turn(FL, flF, s.h, 0.85); yield* flLift(s.y + 0.12); yield* wait(0.3);
    yield* drive(FL, flF, s.ins[0], s.ins[1], 0.5, 0.8); yield* flLift(s.y, 0.25); put(FL.load, s); FL.load = null;
    yield* flLift(Math.max(0.02, s.y - 0.04)); yield* wait(0.4); yield* drive(FL, flF, LANE, s.lane, 0.55, 0.8); yield* flLift(0);
  }
  function* jkTo(z) { if (Math.abs(z - JK.z) < 0.01) return; yield* turn(JK, jkF, z < JK.z ? 0 : PI, 1.0); yield* drive(JK, jkF, JLANE, z, 0.85, 0.9); }
  function* pump(up) { const n = 3; for (let i = 0; i < n; i++) { const a = JK.up, b = JK.up + (up - JK.up) / (n - i);
    yield* tween(0.35, u => { JK.pump = Math.sin(u * PI); JK.up = a + (b - a) * u; }); } JK.pump = 0; }
  function* jkPick(s) { yield* jkTo(s.z); yield* turn(JK, jkF, PI / 2, 1.0); yield* drive(JK, jkF, s.x, s.z, 0.6, 0.8);
    JK.load = take(s); yield* pump(0.06); yield* drive(JK, jkF, JLANE, s.z, 0.6, 0.8); }
  function* jkDrop(s) { yield* jkTo(s.z); yield* turn(JK, jkF, PI / 2, 1.0); yield* drive(JK, jkF, s.x, s.z, 0.6, 0.8);
    yield* tween(0.5, u => { JK.up = 0.06 * (1 - u); JK.pump = -0.5 * Math.sin(u * PI); }); JK.pump = 0; put(JK.load, s); JK.load = null; yield* wait(0.3);
    yield* drive(JK, jkF, JLANE, s.z, 0.7, 0.8); }
  // Darryl getting up / sitting down / climbing on and off
  const UP = [AT.x - 0.65, AT.z];
  function* standUp() { D.mode = 'free'; D.arms = 'none'; D.x = AT.x; D.z = AT.z; D.h = AT.ry; D.y = 0; D.sit = 1;
    yield* tween(0.9, u => { D.sit = 1 - u; D.x = AT.x + (UP[0] - AT.x) * u * 0.5; });
    yield* tween(0.5, u => { D.x = AT.x + (UP[0] - AT.x) * (0.5 + u * 0.5); D.z = AT.z + (UP[1] - AT.z) * u; }); }
  function* sitDown() { yield* walk([UP]); yield* face(AT.ry); yield* tween(0.5, u => { D.x = UP[0] + (AT.x - UP[0]) * u * 0.5; D.z = UP[1] + (AT.z - UP[1]) * u; });
    yield* tween(0.9, u => { D.sit = u; D.x = UP[0] + (AT.x - UP[0]) * (0.5 + u * 0.5); }); D.x = AT.x; D.z = AT.z; D.mode = 'desk'; D.arms = 'type'; }
  const seat = () => { const [fx, fz] = fwd(FL.h); return [FL.x - fx * 0.35, FL.z - fz * 0.35]; };
  function* mount() { const [sx, sz] = seat(), [rx, rz] = rgt(FL.h), x0 = sx + rx * 0.95, z0 = sz + rz * 0.95, h0 = D.h;
    yield* face(FL.h + PI / 2);
    yield* tween(1.1, u => { D.x = x0 + (sx - x0) * u; D.z = z0 + (sz - z0) * u; D.y = 0.6 * Math.sin(u * PI / 2); D.sit = u; D.h = FL.h + PI / 2 * (1 - u); });
    D.mode = 'drive'; D.arms = 'wheel'; }
  function* dismount() { const [sx, sz] = seat(), [rx, rz] = rgt(FL.h), x1 = sx + rx * 0.95, z1 = sz + rz * 0.95;
    D.mode = 'free'; D.arms = 'none'; D.x = sx; D.z = sz; D.h = FL.h;
    yield* tween(1.0, u => { D.x = sx + (x1 - sx) * u; D.z = sz + (z1 - sz) * u; D.y = 0.6 * Math.cos(u * PI / 2); D.sit = 1 - u; D.h = FL.h + PI / 2 * u; }); D.y = 0; }
  const TO_FL = [[-14.4, -0.7], [-17.3, -0.7], [-18.25, -2.6]], TO_JK = [[-13.4, 1.6]];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function* forkliftJob() {
    const full = spots.filter(s => s.p), empty = spots.filter(s => !s.p); if (!full.length || !empty.length) return;
    const src = pick(full), other = empty.filter(s => s.kind !== src.kind), dst = other.length && Math.random() < 0.75 ? pick(other) : pick(empty);
    yield* standUp(); const [sx, sz] = seat(), [rx, rz] = rgt(FL.h); yield* walk([...TO_FL, [sx + rx * 0.95, sz + rz * 0.95]]); yield* mount();
    yield* wait(0.8); yield* flPick(src); yield* flDrop(dst);
    if (Math.random() < 0.5) { const f2 = spots.filter(s => s.p && s !== dst), e2 = spots.filter(s => !s.p); if (f2.length && e2.length) { yield* flPick(pick(f2)); yield* flDrop(pick(e2)); } }
    yield* flToLane(PARK.z); yield* turn(FL, flF, PARK.h, 0.85); yield* wait(0.6);
    yield* dismount(); yield* walk([...TO_FL].reverse()); yield* sitDown();
  }
  function* jackJob() {
    const fl = spots.filter(s => s.jack), full = fl.filter(s => s.p), empty = fl.filter(s => !s.p); if (!full.length || !empty.length) return false;
    const src = pick(full), dst = pick(empty);
    yield* standUp(); const [fx, fz] = fwd(JK.h); yield* walk([...TO_JK, [JK.x - fx * HOLD, JK.z - fz * HOLD]]); yield* face(JK.h);
    D.mode = 'jack'; D.arms = 'handle'; yield* wait(0.5);
    yield* jkPick(src); yield* jkDrop(dst); yield* jkTo(JPARK.z); yield* turn(JK, jkF, JPARK.h, 1.0);
    D.mode = 'free'; D.arms = 'none'; const [mx, mz] = [JK.x - fx * HOLD, JK.z - fz * HOLD]; D.x = mx; D.z = mz; D.h = JK.h;
    yield* wait(0.4); yield* walk([...TO_JK].reverse()); yield* sitDown(); return true;
  }
  function* shift() { // the whole day: desk, then a job, back to the desk, another job...
    yield* wait(2.5); let n = 0;
    for (;;) { const jack = n++ % 2 === 1; if (!(jack && (yield* jackJob()))) yield* forkliftJob(); yield* wait(12 + Math.random() * 10); }
  }
  const run = shift(); run.next();
  // ---------- per-frame: advance the day, then pose everything + move the colliders ----------
  function deskPose(t, pl) {
    const d = rig, breath = Math.sin(t * 1.7), cyc = (t / 22) % 1;
    const u = Math.min(1, Math.max(0, Math.min((cyc - 0.62) / 0.06, (1 - cyc) / 0.06))), typ = 1 - u;
    d.body.position.set(0, -0.27, -0.04);
    d.legL.rotation.x = d.legR.rotation.x = 1.45; d.kneeL.rotation.x = d.kneeR.rotation.x = -1.4;
    const k = t * 8, tl = 0.42 + Math.max(0, Math.sin(k)) ** 2 * 0.06, tr = 0.42 + Math.max(0, Math.sin(k + 1.9)) ** 2 * 0.06;
    const az = 0.16 * typ + 0.3 * u, el = 1.0 * typ + 1.2 * u;
    d.armL.rotation.set(tl * typ + 0.42 * u, 0, az); d.armR.rotation.set(tr * typ + 0.42 * u, 0, -az); d.elbowL.rotation.x = el; d.elbowR.rotation.x = el;
    d.spine.rotation.set(-0.06 * typ - 0.02 * u + breath * 0.012, 0, 0); d.torso.scale.set(1 + breath * 0.012, 1, 1 + breath * 0.02);
    let hx = 0.12 * typ, hy = u * Math.sin(t * 0.9) * 0.6 + typ * Math.sin(t * 0.37) * 0.1;
    if (pl && pl.level === -1) { const dx = pl.pos.x - AT.x, dz = pl.pos.z - AT.z;
      if (Math.hypot(dx, dz) < 3.2) { let a = Math.atan2(-dx, -dz) - AT.ry; a = Math.atan2(Math.sin(a), Math.cos(a)); if (Math.abs(a) < 1.6) { hy = hy * 0.2 + a * 0.8; hx *= 0.2; } } }
    d.headG.rotation.set(-(hx + breath * 0.015), hy, 0);
  }
  function pose(t, dt, pl) {
    const d = rig, sit = D.sit;
    if (D.mode === 'desk') { d.root.position.set(AT.x, 0, AT.z); d.root.rotation.y = AT.ry; D.lx = AT.x; D.lz = AT.z; D.spd = 0; deskPose(t, pl); aabb(D.col, AT.x, AT.z, 0.55, 0.55, 0); return; }
    let x = D.x, z = D.z, y = D.y, h = D.h;
    if (D.mode === 'drive') { [x, z] = seat(); y = 0.6; h = FL.h; hide(D.col); }
    else { if (D.mode === 'jack') { const [fx, fz] = fwd(JK.h); x = JK.x - fx * HOLD; z = JK.z - fz * HOLD; h = JK.h; } aabb(D.col, x, z, 0.5, 0.5, 0); }
    const mv = Math.hypot(x - D.lx, z - D.lz) / Math.max(dt, 1e-3); D.lx = x; D.lz = z; D.spd += (mv - D.spd) * Math.min(1, dt * 8);
    d.root.position.set(x, y, z); d.root.rotation.y = h;
    d.body.position.set(0, -0.27 * sit, -0.04 * sit); d.torso.scale.set(1, 1, 1);
    const w = Math.min(1, D.spd / 0.8) * (1 - sit); D.ph += dt * (2 + D.spd * 5);   // procedural legs (the glTF cast uses its own Walk clip)
    const sw = Math.sin(D.ph) * 0.5 * w;
    d.legL.rotation.x = 1.45 * sit + sw; d.legR.rotation.x = 1.45 * sit - sw;
    d.kneeL.rotation.x = -1.4 * sit - Math.max(0, -Math.sin(D.ph)) * 0.6 * w; d.kneeR.rotation.x = -1.4 * sit - Math.max(0, Math.sin(D.ph)) * 0.6 * w;
    let ax = -sw * 0.6, bx = sw * 0.6, el = 0.25 * w, az = 0.08;
    if (D.arms === 'wheel') { const s = Math.sin(t * 1.3) * 0.08; ax = 0.62 + s; bx = 0.62 - s; el = 0.85; az = 0.14; }
    else if (D.arms === 'handle') { ax = bx = 0.85 + JK.pump * 0.35; el = 0.3; az = 0.1; }
    d.armL.rotation.set(ax, 0, az); d.armR.rotation.set(bx, 0, -az); d.elbowL.rotation.x = d.elbowR.rotation.x = el;
    d.spine.rotation.set(D.arms === 'handle' ? 0.06 : 0, 0, 0);
    let hy = D.mode === 'drive' ? Math.sin(t * 0.45) * 0.35 : 0, hx = 0;
    if (pl && pl.level === -1) {
      const dx = pl.pos.x - x, dz = pl.pos.z - z;
      if (Math.hypot(dx, dz) < 3.4) {
        let a = Math.atan2(-dx, -dz) - h; a = Math.atan2(Math.sin(a), Math.cos(a));
        if (Math.abs(a) < 1.6) hy = hy * 0.25 + a * 0.75;
      }
    }
    d.headG.rotation.set(-hx, hy, 0);
  }
  function sync() {
    FL.g.position.set(FL.x, 0, FL.z); FL.g.rotation.y = FL.h; FL.lift.position.y = FL.y; flFoot(FL.x, FL.z, FL.h, FL.col);
    JK.g.position.set(JK.x, 0, JK.z); JK.g.rotation.y = JK.h; JK.forks.position.y = JK.up; JK.handle.rotation.x = 0.3 + JK.pump * 0.6; jkFoot(JK.x, JK.z, JK.h, JK.col);
    if (FL.load) { const [fx, fz] = fwd(FL.h), p = FL.load; p.x = FL.x + fx * 1.3; p.z = FL.z + fz * 1.3; p.y = FL.y; p.h = FL.h; }
    if (JK.load) { const p = JK.load; p.x = JK.x; p.z = JK.z; p.y = JK.up; p.h = JK.h; }
    for (const p of pallets) { p.g.position.set(p.x, p.y, p.z); p.g.rotation.y = p.h; }
  }
  sync(); pose(0, 0.016, null);
  return {
    rig,
    update(t, pl, dt) {
      P.on = pl.level === -1; P.x = pl.pos.x; P.z = pl.pos.z;
      const dti = Math.min(dt || 0.016, 0.1);
      try { run.next(dti); } catch (e) { console.warn('warehouse work', e); }
      try { sync(); pose(t, dti, pl); } catch (e) { console.warn('warehouse pose', e); }
    },
    state: () => ({ mode: D.mode, fl: { x: FL.x, z: FL.z, h: FL.h, y: FL.y, load: !!FL.load }, jk: { x: JK.x, z: JK.z, load: !!JK.load }, spots: spots.map(s => !!s.p) }),
  };
}
