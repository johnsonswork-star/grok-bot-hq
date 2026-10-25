// Dunder Mifflin Bot HQ, 2.5D isometric office (Canvas 2D, no engine).
// The floor is rasterized at device resolution (no low-res buffer scaled up), with smooth
// shading, soft shadows, and vector chibis. Text stays crisp on the main canvas.
// Data: ../stations.js (desk/character mapping), ./data.js (real projects + Needs you), ../tasks.json (who is busy),
// ../hq-link.js (same encrypted HQ chat relay, work feed and design deck the 3D office uses).
import { STATIONS } from '../stations.js';
import * as link from '../hq-link.js';
import { triage, OFFICE_TO } from '../office-chat-rules.js';
import { PROJECTS, NEEDS, DESK_NOTE, PAUSE_NOTE, UPDATED } from './data.js';
import { paintCrew, crewLook, CREW_HIT } from './cast.js';
import { createTrainer } from './trainer.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const noDash = s => String(s ?? '').replace(/\u2014/g, ', ').replace(/\u2013/g, '-');
const noLig = s => String(s).replace(/f(?=[fil])/g, 'f\u200C');   // Pixelify Sans turns "fi" into a glyph that reads like "A"
const FONT = '"Pixelify Sans","Courier New",monospace';

// ---------- world ----------
const GX = 22, GY = 16, HX = 14, HY = 7, ZU = 16, WALL = 3.2;
// The warehouse is its own floor (a full room, not a pit under the office). ST is the shared stair footprint.
const ST = { x0: 15.3, x1: 18.3, y0: 12.6, y1: 14.5, n: 6 }; // open south-east corner, clear of the desks
const FLOOR_MS = 480;
let floor = 'office';
try {
  const savedFl = localStorage.getItem('hq2d.floor');
  if (savedFl === 'warehouse' || savedFl === 'office') floor = savedFl;
} catch (e) {}
let floorAnim = null; // { from, to, t0 } while the floors crossfade
const MGR = { x0: 16, x1: GX, y0: 0, y1: 5.5 };                   // manager office
const CONF = { x0: 7.5, x1: 14, y0: 0, y1: 5.5 };
const KIT = { x0: 14, x1: 16, y0: 0, y1: 3 };                   // conference room
const inR = (x, y, r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

// desk origin (x,y), seat = where the worker sits (behind the desk, facing the viewer)
const DESKS = {
  grok:     { x: 17.7, y: 1.85, w: 2.35 },
  inbox:    { x: 2.0, y: 8.3, w: 1.1, d: 3.05, reception: true, seat: [1.65, 9.65] },
  // two quads with a center aisle, and a walkway between the facing row and the away row
  cos:      { x: 3.5, y: 6.4 }, assist:  { x: 6.2, y: 6.4 },
  icons:    { x: 3.7, y: 9.7, away: true }, conn: { x: 6.4, y: 9.7, away: true },
  onpad:    { x: 10.15, y: 6.4 }, builder: { x: 12.7, y: 6.4 },
  faith:    { x: 10.35, y: 9.7, away: true }, broker: { x: 12.9, y: 9.7, away: true },
  review:   { x: 5.55, y: 12.95 }, kids:  { x: 8.05, y: 14.9 },
  // South of the design trainer so Kelly and Toby do not cover the shirts.
  designer: { x: 15.15, y: 10.05 }, profile: { x: 18.05, y: 10.05 },
};
const people = STATIONS.filter(s => DESKS[s.id]).map(s => {
  const d = DESKS[s.id]; d.w = d.w || 2; d.d = d.d || 1.1;
  const seat = d.seat || (d.away ? [d.x + d.w * 0.5, d.y + d.d + 0.32] : [d.x + d.w * 0.6, d.y - 0.05]);
  return { s, d, seat, phase: Math.random() * 10, blinkAt: 0 };
});
const SEATZ = 0.15;
// Seated head is about one monitor wide. The cast is drawn in ~20px-wide heads; 0.56 brings that down to the CRT face.
const CREW_SC = 0.56;
const byId = id => people.find(p => p.s.id === id);
const first = s => s.name.split(' ')[0];

// ---------- status (real) ----------
let busyFile = {};
let workFeed = null;          // encrypted per-device work feed { bots, needs } (may be empty while routines are paused)
let deck = null;              // encrypted Design Trainer deck { cards:[{id,title,d}] }
const deckImgs = [];
const STLBL = { blocked: 'stuck', waiting: 'under review', done: 'live', paused: 'paused', active: 'in progress' };
function projectsOf(id) { return PROJECTS.filter(p => p.owners.includes(id)); }
function busyOf(id) {
  const v = busyFile[id]; if (!v) return null;
  if (typeof v === 'string') return v;
  if (v.until && Date.parse(v.until) < Date.now()) return null;
  return v.task || null;
}
function stateOf(id) {
  if (busyOf(id)) return 'active';
  const ps = projectsOf(id);
  if (ps.some(p => p.status === 'active')) return 'active';
  if (ps.some(p => p.status === 'blocked')) return 'blocked';
  return 'paused';
}
function lineOf(id) {
  const b = busyOf(id); if (b) return b;
  const ps = projectsOf(id);
  const a = ps.find(p => p.status === 'active'); if (a) return a.title;
  if (ps.length) { const p = ps[(Math.floor(Date.now() / 9000) + id.length) % ps.length]; return `${p.title}: ${STLBL[p.status] || 'paused'}`; }
  return DESK_NOTE[id] || 'Paused';
}
function liveNeeds() { return Array.isArray(workFeed?.needs) ? workFeed.needs.filter(n => n && n.title && !n.done) : []; }
function needsCount() { return NEEDS.length + liveNeeds().length; }

// ---------- canvas + camera ----------
// Geometry lives in the old iso pixel grid. It is rasterized at full device pixels,
// so outlines and sprites are not chunks of a tiny buffer blown up.
const cv = $('#c'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1, PS = 2, fitPS = 2, homePS = 3, BW = 0, BH = 0;
const FOCUS = [11.4, 6.35];  // bullpen, conference room, and the manager office
const FOCUS_WH = [11, 7.6];   // center of the warehouse floor
function focusPoint() { return floor === 'warehouse' ? FOCUS_WH : FOCUS; }
// Four isometric facings. 0 is the original southeast camera (far walls: north and west).
// Each step orbits the camera 90 degrees clockwise. N E S W are what the iPad remembers.
const FACE_NAME = ['N', 'E', 'S', 'W'];
const ROT_MS = 350;
let facing = 0;
try {
  const saved = localStorage.getItem('hq2d.facing');
  const idx = FACE_NAME.indexOf(saved);
  if (idx >= 0) facing = idx;
} catch (e) {}
let rotAnim = null; // { from, to, t0 } while the view eases to the next facing
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function toView(x, y) {
  switch (facing) {
    case 1: return [y, GX - x];
    case 2: return [GX - x, GY - y];
    case 3: return [GY - y, x];
    default: return [x, y];
  }
}
function isFar(wall) { return [['W', 'N'], ['N', 'E'], ['E', 'S'], ['S', 'W']][facing].includes(wall); }
function showPosX() { return facing === 0 || facing === 3; } // world +x face points at the camera
function showPosY() { return facing === 0 || facing === 1; }
function facesCamera(lookY) { return lookY * [1, 1, -1, -1][facing] > 0; }
function focusIso() {
  const [fx, fy] = focusPoint();
  const [u, v] = toView(fx, fy);
  return [(u - v) * HX, (u + v) * HY - ZU];
}
const cam = { zoom: 1, px: 0, py: 0 };
const wish = { zoom: 1, px: 0, py: 0 };
let velX = 0, velY = 0, frameDt = 0.016, lastInput = performance.now(), hoverId = null, stickGlide = false;
const MAP_W = (GX + GY) * HX, MAP_TOP = -WALL * ZU, MAP_BOT = (GX + GY) * HY + 2.6 * ZU;
const PAD = 56;
const MIN_X = -GY * HX - PAD, MAX_X = GX * HX + PAD;
const MIN_Y = MAP_TOP - PAD, MAX_Y = MAP_BOT + PAD;
const edgeW = () => Math.max(0.32, 1.15 / Math.max(homePS, 1.2));
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  fitPS = Math.max(1.2, Math.min((W - 20) / (MAP_W + 20), (H - 30) / (MAP_BOT - MAP_TOP + 30)));
  // Original mockup window (300 x 215 at HX=12), scaled with the tile size, then opened slightly so the manager office and reception both stay in frame.
  const WIN_X = 300 * (HX / 12) * 1.08, WIN_Y = 215 * (HY / 6) * 1.08;
  homePS = Math.max(fitPS, Math.min(4.6, W / WIN_X, H / WIN_Y));
  PS = homePS * cam.zoom;
  BW = Math.ceil(W / PS); BH = Math.ceil(H / PS);
  for (const fl of ['office', 'warehouse']) baseOk[fl].fill(false);
}
const clampZ = z => Math.max(fitPS / homePS * 0.95, Math.min(2.2, z));
function clampWish() {
  wish.zoom = clampZ(wish.zoom);
  const lx = MAP_W * 0.55 * homePS * wish.zoom, ly = (MAP_BOT - MAP_TOP) * 0.6 * homePS * wish.zoom;
  wish.px = Math.max(-lx, Math.min(lx, wish.px));
  wish.py = Math.max(-ly, Math.min(ly, wish.py));
}
function camMoving() {
  return !!rotAnim || !!floorAnim || Math.abs(wish.px - cam.px) > 0.35 || Math.abs(wish.py - cam.py) > 0.35 || Math.abs(wish.zoom - cam.zoom) > 0.0015;
}
function stepCam(dt) {
  const dragging = ptrs.size > 0 && (drag || pinch);
  if (!dragging) {
    const a = 1 - Math.exp(-13 * dt);
    cam.px += (wish.px - cam.px) * a;
    cam.py += (wish.py - cam.py) * a;
    cam.zoom += (wish.zoom - cam.zoom) * a;
    if (Math.abs(wish.px - cam.px) < 0.12) cam.px = wish.px;
    if (Math.abs(wish.py - cam.py) < 0.12) cam.py = wish.py;
    if (Math.abs(wish.zoom - cam.zoom) < 0.0006) cam.zoom = wish.zoom;
  }
  PS = homePS * cam.zoom;
  BW = Math.ceil(W / Math.max(PS, 0.1)); BH = Math.ceil(H / Math.max(PS, 0.1));
}
function noteInput() { lastInput = performance.now(); }
addEventListener('resize', resize);

// World iso pixels. (x, y) is swung into view space first so every facing shares one projection.
const P = (x, y, z = 0) => { const [u, v] = toView(x, y); return [(u - v) * HX, (u + v) * HY - z * ZU]; };
const Pf = P;
const devScale = () => homePS * cam.zoom * DPR;
function camOrigin() {
  const s = devScale();
  const [fx, fy] = focusIso();
  let tx = W * DPR / 2 + cam.px * DPR - fx * s;
  let ty = H * DPR / 2 + cam.py * DPR - fy * s;
  if (!camMoving() && ptrs.size === 0) { tx = Math.round(tx); ty = Math.round(ty); }
  return [s, tx, ty];
}
function camTransform(c) {
  const [s, tx, ty] = camOrigin();
  c.setTransform(s, 0, 0, s, tx, ty);
}
function legToCSS(ix, iy) {
  const [s, tx, ty] = camOrigin();
  return [(ix * s + tx) / DPR, (iy * s + ty) / DPR];
}
function isoToCSS(ix, iy) { return legToCSS(ix, iy); }
function projectCSS(x, y, z = 0) {
  const [ix, iy] = P(x, y, z);
  // camOrigin already centers on the focus. Subtracting it again drifts labels off the sprite.
  return legToCSS(ix, iy);
}
function cssToLeg(cssX, cssY) {
  const [s, tx, ty] = camOrigin();
  // Inverse of camTransform, in the same P() space the hit polygons are built in.
  return [(cssX * DPR - tx) / s, (cssY * DPR - ty) / s];
}
function poly(c, pts, fill, stroke) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = edgeW(); c.lineJoin = 'round'; c.stroke(); }
}
const hex2 = h => {
  if (!h) return [0, 0, 0];
  if (String(h).startsWith('rgb')) { const m = String(h).match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2]]; }
  h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(ch => ch + ch).join('');
  const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
};
const shade = (h, f) => { const [r, gg, b] = hex2(h); const k = v => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${k(r)},${k(gg)},${k(b)})`; };
const OUT = 'rgba(42,26,14,.78)';
function seg(c, a, b, col) { c.strokeStyle = col; c.lineWidth = edgeW() * 0.9; c.lineCap = 'round'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
function faceFill(c, pts, col) {
  const dx = pts[2][0] - pts[0][0], dy = pts[2][1] - pts[0][1];
  if (dx * dx + dy * dy < 42) { poly(c, pts, col); return; }
  const g = c.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]);
  g.addColorStop(0, shade(col, 1.1));
  g.addColorStop(0.48, col);
  g.addColorStop(1, shade(col, 0.86));
  poly(c, pts, g);
}
// Box corner in view space. su/sv: 0 = far side of that axis, 1 = camera side.
function boxCorner(x, y, w, d, su, sv) {
  switch (facing) {
    case 1: return [x + (1 - sv) * w, y + su * d];
    case 2: return [x + (1 - su) * w, y + (1 - sv) * d];
    case 3: return [x + sv * w, y + (1 - su) * d];
    default: return [x + su * w, y + sv * d];
  }
}
function box(c, x, y, z, w, d, h, col, o = {}) {
  const top = (su, sv) => { const [wx, wy] = boxCorner(x, y, w, d, su, sv); return P(wx, wy, z + h); };
  const bot = (su, sv) => { const [wx, wy] = boxCorner(x, y, w, d, su, sv); return P(wx, wy, z); };
  const A = top(0, 0), B = top(1, 0), C = top(1, 1), D = top(0, 1);
  const B0 = bot(1, 0), C0 = bot(1, 1), D0 = bot(0, 1);
  const t = o.t || col, l = o.l || shade(col, 0.84), r = o.r || shade(col, 0.68);
  if (!o.noL) faceFill(c, [D, C, C0, D0], l);
  if (!o.noR) faceFill(c, [B, C, C0, B0], r);
  if (!o.noT) faceFill(c, [A, B, C, D], t);
  if (o.ol !== false) {
    c.save();
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.strokeStyle = o.hi || 'rgba(255,244,220,.55)'; c.lineWidth = edgeW() * 0.85;
    c.beginPath(); c.moveTo(D[0], D[1]); c.lineTo(C[0], C[1]); c.lineTo(B[0], B[1]); c.stroke();
    c.strokeStyle = o.olc || OUT; c.lineWidth = edgeW();
    c.beginPath();
    const S = [A, B, B0, C0, D0, D]; c.moveTo(S[0][0], S[0][1]); for (let i = 1; i < S.length; i++) c.lineTo(S[i][0], S[i][1]); c.closePath(); c.stroke();
    c.restore();
  }
  if (o.edge) { c.strokeStyle = o.edge; c.lineWidth = edgeW(); c.beginPath(); c.moveTo(D[0], D[1]); c.lineTo(C[0], C[1]); c.lineTo(B[0], B[1]); c.stroke(); }
}
// Soft contact shadow. Light comes from the back-left and falls toward the front-right.
function shadow(c, x, y, w, d, h, z = 0) {
  const lift = Math.min(h, 2);
  const cx = x + w * 0.55 + lift * 0.08, cy = y + d * 0.62 + lift * 0.06;
  const p = Pf(cx, cy, z);
  const rx = Math.max(3, (w + d * 0.65) * HX * 0.34);
  const ry = Math.max(2, rx * 0.46);
  const gr = c.createRadialGradient(p[0], p[1], rx * 0.05, p[0], p[1], rx);
  const a = Math.min(0.34, 0.14 + lift * 0.08);
  gr.addColorStop(0, `rgba(48,26,10,${a})`);
  gr.addColorStop(0.55, `rgba(48,26,10,${a * 0.45})`);
  gr.addColorStop(1, 'rgba(48,26,10,0)');
  c.fillStyle = gr;
  c.beginPath(); c.ellipse(p[0], p[1], rx, ry, 0.15, 0, Math.PI * 2); c.fill();
}
// a rectangle lying in a wall plane: x-plane (const x, spans y) or y-plane (const y, spans x)
const quadY = (y, x0, x1, z0, z1) => [P(x0, y, z1), P(x1, y, z1), P(x1, y, z0), P(x0, y, z0)];
const quadX = (x, y0, y1, z0, z1) => [P(x, y1, z1), P(x, y0, z1), P(x, y0, z0), P(x, y1, z0)];
// plane transform: local px -> buf px. o = top-left 3D, u = 3D dir of text "right", v = 3D dir of text "down", K = local px per world unit
function planeM(o, u, v, K) {
  const a = Pf(...o), b = Pf(o[0] + u[0], o[1] + u[1], o[2] + u[2]), c = Pf(o[0] + v[0], o[1] + v[1], o[2] + v[2]);
  return [(b[0] - a[0]) / K, (b[1] - a[1]) / K, (c[0] - a[0]) / K, (c[1] - a[1]) / K, a[0], a[1]];
}
const PLANE_Y = (x, y, z) => [[x, y, z], [1, 0, 0], [0, 0, -1]];   // y=const wall, text runs +x
const PLANE_X = (x, y, z) => [[x, y, z], [0, -1, 0], [0, 0, -1]];  // x=const wall, text runs -y
function inPlane(c, scale, pl, K, fn) {
  const m = planeM(pl[0], pl[1], pl[2], K);
  const [s, tx, ty] = camOrigin();
  c.save();
  c.setTransform(m[0] * scale * s, m[1] * scale * s, m[2] * scale * s, m[3] * scale * s, m[4] * scale * s + tx, m[5] * scale * s + ty);
  fn(c); c.restore();
}
// Same plane, composed onto the transform already on the canvas. The live view uses the camera;
// the cached warehouse bitmap uses the floor cache. Either way the letters stay on the sign.
function paintOnPlane(c, pl, K, fn) {
  const m = planeM(pl[0], pl[1], pl[2], K);
  c.save();
  c.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  fn(c);
  c.restore();
}
// Keep authored wall text left-to-right on screen. span is the world length of the text block along `right`.
function facePlane(pl, span) {
  const [o, r, dwn] = pl;
  const a = P(o[0], o[1], o[2]);
  const b = P(o[0] + r[0], o[1] + r[1], o[2] + r[2]);
  if (b[0] >= a[0] - 1e-4) return pl;
  return [[o[0] + r[0] * span, o[1] + r[1] * span, o[2] + r[2] * span], [-r[0], -r[1], -r[2]], dwn];
}
// Like facePlane, and also keep local "down" pointing down the screen so a word cannot flip upside down.
function planeUpright(pl, span, height) {
  let [o, r, dwn] = pl;
  const delta = (origin, dir) => {
    const a = P(origin[0], origin[1], origin[2]);
    const b = P(origin[0] + dir[0], origin[1] + dir[1], origin[2] + dir[2]);
    return [b[0] - a[0], b[1] - a[1]];
  };
  if (delta(o, r)[0] < -1e-4) {
    o = [o[0] + r[0] * span, o[1] + r[1] * span, o[2] + r[2] * span];
    r = [-r[0], -r[1], -r[2]];
  }
  if (height > 0 && delta(o, dwn)[1] < -1e-4) {
    o = [o[0] + dwn[0] * height, o[1] + dwn[1] * height, o[2] + dwn[2] * height];
    dwn = [-dwn[0], -dwn[1], -dwn[2]];
  }
  return [o, r, dwn];
}

// ---------- hash noise ----------
const hsh = (x, y) => { let n = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };

// ---------- base layer (floors, walls) cached per floor and facing ----------
function makeBaseSet() {
  const cvs = [0, 1, 2, 3].map(() => document.createElement('canvas'));
  return { cvs, ctx: cvs.map(cv => cv.getContext('2d')), box: [null, null, null, null], ok: [false, false, false, false] };
}
const baseSet = { office: makeBaseSet(), warehouse: makeBaseSet() };
const baseCvs = { office: baseSet.office.cvs, warehouse: baseSet.warehouse.cvs };
const baseCtx = { office: baseSet.office.ctx, warehouse: baseSet.warehouse.ctx };
const baseBox = { office: baseSet.office.box, warehouse: baseSet.warehouse.box };
const baseOk = { office: baseSet.office.ok, warehouse: baseSet.warehouse.ok };
function wallX(c, x, y0, y1, wood) { // inner face of an x=const wall
  const inn = x < 1 ? 0.001 : -0.001;
  if (wood) {
    poly(c, quadX(x, y0, y1, 0, WALL), '#8a5a35');
    for (let y = y0; y < y1; y += 0.7) { poly(c, quadX(x + inn, y, y + 0.05, 0, 2.98), '#6f4628'); poly(c, quadX(x + inn, y + 0.08, y + 0.12, 0, 2.98), 'rgba(255,220,170,.10)'); }
  } else {
    poly(c, quadX(x, y0, y1, 0, WALL), '#e9d9b8');
    for (let y = y0; y < y1; y += 0.5) poly(c, quadX(x + inn, y, y + 0.04, 1.08, 3.0), 'rgba(160,120,70,.10)');
    poly(c, quadX(x + inn, y0, y1, 0, 1.0), '#cdb38a');
    for (let y = y0 + 0.2; y < y1 - 0.4; y += 1.2) { poly(c, quadX(x + inn, y + 0.05, y + 1.0, 0.2, 0.85), 'rgba(90,60,30,.18)'); poly(c, quadX(x + inn, y + 0.09, y + 0.96, 0.24, 0.81), '#d3ba92'); }
    poly(c, quadX(x + inn, y0, y1, 1.0, 1.1), '#7a5232'); poly(c, quadX(x + inn, y0, y1, 1.08, 1.1), '#a0734a');
  }
  poly(c, quadX(x + inn, y0, y1, 2.98, WALL), '#6a4426'); poly(c, quadX(x + inn, y0, y1, 2.98, 3.02), '#8d6440');
  poly(c, quadX(x + inn, y0, y1, 0, 0.16), '#5e4029');
}
function wallY(c, y, x0, x1, wood) { // inner face of a y=const wall
  const inn = y < 1 ? 0.001 : -0.001;
  if (wood) {
    poly(c, quadY(y, x0, x1, 0, WALL), '#8a5a35');
    for (let x = x0; x < x1; x += 0.7) { poly(c, quadY(y + inn, x, x + 0.05, 0, 2.98), '#6f4628'); poly(c, quadY(y + inn, x + 0.08, x + 0.12, 0, 2.98), 'rgba(255,220,170,.10)'); }
  } else {
    poly(c, quadY(y, x0, x1, 0, WALL), '#ddcca8');
    for (let x = x0; x < x1; x += 0.5) poly(c, quadY(y + inn, x, x + 0.04, 1.08, 3.0), 'rgba(150,110,60,.09)');
    poly(c, quadY(y + inn, x0, x1, 0, 1.0), '#c3a87e');
    for (let x = x0 + 0.2; x < x1 - 0.4; x += 1.2) { poly(c, quadY(y + inn, x + 0.05, x + 1.0, 0.2, 0.85), 'rgba(90,60,30,.18)'); poly(c, quadY(y + inn, x + 0.09, x + 0.96, 0.24, 0.81), '#c9b088'); }
    poly(c, quadY(y + inn, x0, x1, 1.0, 1.1), '#7a5232'); poly(c, quadY(y + inn, x0, x1, 1.08, 1.1), '#a0734a');
  }
  poly(c, quadY(y + inn, x0, x1, 2.98, WALL), '#6a4426'); poly(c, quadY(y + inn, x0, x1, 2.98, 3.02), '#8d6440');
  poly(c, quadY(y + inn, x0, x1, 0, 0.16), '#5e4029');
}
function windowY(c, y, x0, x1, z0 = 1.15, z1 = 2.7) {
  const inn = y < GY * 0.5 ? 1 : -1;
  const q = (eps, xa, xb, za, zb) => quadY(y + inn * eps, xa, xb, za, zb);
  poly(c, q(0, x0 - 0.08, x1 + 0.08, z0 - 0.08, z1 + 0.08), '#4e341f');
  const n = 14; for (let i = 0; i < n; i++) { const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n; const k = i / n; poly(c, q(0.005, x0, x1, za, zb), `rgb(${Math.round(150 + 60 * k)},${Math.round(200 + 30 * k)},${Math.round(225 + 20 * k)})`); }
  for (const [cx, cz] of [[0.3, 0.75], [0.62, 0.6]]) { const xx = x0 + (x1 - x0) * cx, zz = z0 + (z1 - z0) * cz; poly(c, q(0.006, xx - 0.3, xx + 0.3, zz, zz + 0.12), 'rgba(255,255,255,.75)'); poly(c, q(0.006, xx - 0.15, xx + 0.2, zz + 0.1, zz + 0.2), 'rgba(255,255,255,.75)'); }
  poly(c, q(0.006, x0, x1, z0, z0 + 0.35), 'rgba(90,140,90,.35)');
  const m = (x1 - x0) / 2; for (let x = x0; x <= x1 + 0.01; x += m) poly(c, q(0.007, x - 0.04, x + 0.04, z0, z1), '#5d4a36');
  poly(c, q(0.007, x0, x1, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03), '#5d4a36');
  poly(c, q(0.008, x0 + 0.1, x0 + 0.5, z0 + 0.1, z1 - 0.1), 'rgba(255,255,255,.18)');
  const sillY = inn > 0 ? y : y - 0.16;
  box(c, x0 - 0.12, sillY, z0 - 0.12, x1 - x0 + 0.24, 0.16, 0.06, '#7a5232', { ol: false });
}
function windowX(c, x, y0, y1, z0 = 1.15, z1 = 2.7) {
  const inn = x < GX * 0.5 ? 1 : -1;
  const q = (eps, ya, yb, za, zb) => quadX(x + inn * eps, ya, yb, za, zb);
  poly(c, q(0, y0 - 0.08, y1 + 0.08, z0 - 0.08, z1 + 0.08), '#4e341f');
  const n = 14; for (let i = 0; i < n; i++) { const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n; const k = i / n; poly(c, q(0.005, y0, y1, za, zb), `rgb(${Math.round(150 + 60 * k)},${Math.round(200 + 30 * k)},${Math.round(225 + 20 * k)})`); }
  poly(c, q(0.006, y0, y1, z0, z0 + 0.35), 'rgba(90,140,90,.35)');
  const m = (y1 - y0) / 2; for (let y = y0; y <= y1 + 0.01; y += m) poly(c, q(0.007, y - 0.04, y + 0.04, z0, z1), '#5d4a36');
  poly(c, q(0.007, y0, y1, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03), '#5d4a36');
  const glare0 = inn > 0 ? y1 - 0.5 : y0 + 0.1, glare1 = inn > 0 ? y1 - 0.1 : y0 + 0.5;
  poly(c, q(0.008, glare0, glare1, z0 + 0.1, z1 - 0.1), 'rgba(255,255,255,.18)');
}
function frameY(c, y, x0, x1, z0, z1, art) {
  const inn = y < GY * 0.5 ? 1 : -1;
  const q = (eps, xa, xb, za, zb) => quadY(y + inn * eps, xa, xb, za, zb);
  poly(c, q(0, x0, x1, z0, z1), '#3d2a1a'); poly(c, q(0.005, x0 + 0.08, x1 - 0.08, z0 + 0.08, z1 - 0.08), '#c9a24a'); poly(c, q(0.01, x0 + 0.14, x1 - 0.14, z0 + 0.14, z1 - 0.14), art[0]); poly(c, q(0.012, x0 + 0.14, x1 - 0.14, z0 + 0.14, (z0 + z1) / 2), art[1]);
}
function frameX(c, x, y0, y1, z0, z1, art) {
  const inn = x < GX * 0.5 ? 1 : -1;
  const q = (eps, ya, yb, za, zb) => quadX(x + inn * eps, ya, yb, za, zb);
  poly(c, q(0, y0, y1, z0, z1), '#3d2a1a'); poly(c, q(0.005, y0 + 0.08, y1 - 0.08, z0 + 0.08, z1 - 0.08), '#c9a24a'); poly(c, q(0.01, y0 + 0.14, y1 - 0.14, z0 + 0.14, z1 - 0.14), art[0]); poly(c, q(0.012, y0 + 0.14, y1 - 0.14, z0 + 0.14, (z0 + z1) / 2), art[1]);
}
function boardY(c, y, x0, x1, z0, z1, face) {
  const inn = y < GY * 0.5 ? 1 : -1;
  const q = (eps, xa, xb, za, zb) => quadY(y + inn * eps, xa, xb, za, zb);
  poly(c, q(0, x0, x1, z0, z1), '#2a1a0e'); poly(c, q(0.004, x0 + 0.05, x1 - 0.05, z0 + 0.05, z1 - 0.05), '#6b4426'); poly(c, q(0.008, x0 + 0.12, x1 - 0.12, z0 + 0.1, z1 - 0.1), face); poly(c, q(0.01, x0 + 0.12, x1 - 0.12, z1 - 0.3, z1 - 0.1), 'rgba(255,255,255,.05)');
}
const SHADOWS = () => {
  const L = [];
  for (const p of people) L.push([p.d.x, p.d.y, p.d.w, p.d.d, 0.7]);
  L.push([8.9, 1.95, 3.8, 1.6, 0.7], [0.05, 13.3, 0.7, 1.3, 1.1], [14.2, 0.25, 0.9, 0.7, 0.9], [15.3, 0.3, 0.45, 0.45, 1.1], [19.6, 0.05, 1.6, 0.45, 1.9], [20.9, 4.0, 0.9, 0.7, 0.6], [15.7, 6.4, 3.9, 0.7, 1.2]);
  L.push([21.22, 6.15, 0.7, 0.6, 1.1], [21.22, 6.9, 0.7, 0.6, 1.1], [21.35, 10.15, 0.45, 0.45, 1.1], [0.35, 15.28, 0.7, 0.6, 1.1], [1.15, 15.28, 0.7, 0.6, 1.1]);
  L.push([12.5, 15.18, 0.7, 0.6, 1.1], [13.85, 15.18, 0.7, 0.6, 1.1], [19.35, 15.18, 0.7, 0.6, 1.1], [20.55, 15.18, 0.7, 0.6, 1.1]);
  for (const [x, y] of PLANTS) L.push([x, y, 0.5, 0.5, 0.9]);
  return L;
};
const PLANTS = [[0.3, 0.3], [6.9, 0.4], [13.3, 0.4], [20.9, 2.55], [0.3, 15.2], [8.3, 11.35], [8.2, 7.9], [21.4, 0.5], [2.15, 7.15], [13.6, 12.15], [19.4, 12.35], [20.5, 14.45]];
// Warehouse stock, spread across the whole downstairs floor (the old pit was only the south-east corner).
const RACKS = [
  [0.85, 2.15, 3.5], [5.0, 2.15, 3.5], [9.3, 2.15, 3.3], [13.4, 2.15, 3.5], [17.7, 2.15, 3.1],
  [0.85, 8.85, 3.5], [5.0, 8.85, 3.5], [13.5, 8.85, 3.5], [17.7, 8.85, 3.1],
];
const PALLETS = [
  [1.0, 4.7, 4], [2.7, 4.85, 3], [4.5, 4.65, 4], [6.3, 4.9, 2],
  [13.7, 4.7, 3], [15.5, 4.85, 4], [17.3, 4.65, 3], [19.1, 4.9, 2],
  [1.15, 6.55, 3], [3.0, 6.7, 4], [4.9, 6.5, 2], [6.6, 6.75, 3],
  [13.8, 6.55, 4], [15.6, 6.7, 3], [17.4, 6.5, 4], [19.2, 6.75, 2],
  [1.0, 11.35, 3], [3.0, 11.55, 4], [5.1, 11.3, 2],
  [12.3, 11.05, 3], [13.9, 11.15, 4], [18.7, 11.05, 3],
  [1.15, 13.35, 2], [3.3, 13.55, 3], [5.4, 13.3, 4],
  [12.35, 13.15, 3], [13.7, 14.35, 2], [19.15, 12.85, 3], [19.35, 14.35, 2],
];
const BENCH = { x: 9.55, y: 10.85, w: 2.5, d: 1.05 };
function measureIso() {
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const add = (x, y, z) => { const p = P(x, y, z); if (p[0] < minX) minX = p[0]; if (p[1] < minY) minY = p[1]; if (p[0] > maxX) maxX = p[0]; if (p[1] > maxY) maxY = p[1]; };
  for (const x of [-0.7, 0, GX, GX + 0.7]) for (const y of [-0.7, 0, GY, GY + 0.7]) { add(x, y, WALL); add(x, y, 0); add(x, y, -0.7); }
  const pad = 14;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}
function ensureBase(fl, f) {
  if (baseOk[fl][f]) return;
  const prevF = facing, prevFl = floor;
  facing = f; floor = fl;
  drawBase();
  facing = prevF; floor = prevFl;
}
function drawBase() {
  const box = measureIso();
  const s = homePS * DPR, legW = box.maxX - box.minX, legH = box.maxY - box.minY;
  const cv = baseCvs[floor][facing], c = baseCtx[floor][facing];
  cv.width = Math.max(1, Math.ceil(legW * s)); cv.height = Math.max(1, Math.ceil(legH * s));
  c.setTransform(s, 0, 0, s, -box.minX * s, -box.minY * s);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.fillStyle = '#1a1410'; c.fillRect(box.minX, box.minY, legW, legH);
  if (floor === 'warehouse') {
    drawWarehouseBase(c);
    baseBox[floor][facing] = box;
    baseOk[floor][facing] = true;
    return;
  }
  // ---- office floor (the warehouse lives on its own floor, so this room is carpet wall to wall)
  for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) {
    const cx = x + 0.5, cy = y + 0.5;
    const n = hsh(x, y); const y1 = y + 1;
    const T = (a, b, cc, dd) => [P(x + a, y + b), P(x + cc, y + b), P(x + cc, Math.min(y + dd, y1)), P(x + a, Math.min(y + dd, y1))];
    if (inR(cx, cy, MGR)) { // wood planks run along x
      for (let k = 0; k < 3; k++) { const pc = shade('#9b6a3e', 0.86 + hsh(x * 3 + k, y) * 0.22); poly(c, T(0, k / 3, 1, (k + 1) / 3), pc); seg(c, P(x, y + k / 3), P(x + 1, y + k / 3), 'rgba(60,30,12,.45)');
        const jx = x + ((k + y) % 3) / 3; seg(c, P(jx, y + k / 3), P(jx, y + (k + 1) / 3), 'rgba(60,30,12,.45)');
        const gp = P(x + hsh(x, k + y * 3) * 0.8, y + k / 3 + 0.16); c.strokeStyle = 'rgba(90,48,18,.22)'; c.lineWidth = 0.28; c.beginPath(); c.moveTo(gp[0] - 2.4, gp[1]); c.lineTo(gp[0] + 2.6, gp[1]); c.stroke(); }
    } else if (inR(cx, cy, KIT)) { // kitchen tile
      poly(c, T(0, 0, 0.5, 0.5), '#e2dccd'); poly(c, T(0.5, 0, 1, 0.5), '#b8ae9c'); poly(c, T(0, 0.5, 0.5, 1), '#b8ae9c'); poly(c, T(0.5, 0.5, 1, 1), '#e2dccd');
    } else { // carpet tiles with a woven pattern
      const conf = inR(cx, cy, CONF), base0 = conf ? '#c4ad8c' : '#d4bc96', col = shade(base0, 0.98 + n * 0.04);
      const a = P(x, y), b = P(x + 1, y), dpt = P(x, Math.min(y + 1, y1));
      const cg = c.createLinearGradient(a[0], a[1], b[0], dpt[1]);
      cg.addColorStop(0, shade(col, 1.05)); cg.addColorStop(1, shade(col, 0.93));
      poly(c, T(0, 0, 1, 1), cg);
      seg(c, a, b, 'rgba(120,85,45,.16)'); seg(c, a, dpt, 'rgba(255,240,210,.16)');
      for (let k = 0; k < 3; k++) { const p = P(x + hsh(x * 7 + k, y) * 0.9 + 0.05, Math.min(y + hsh(x, y * 7 + k) * 0.9 + 0.05, y1 - 0.04)); c.fillStyle = k % 2 ? 'rgba(110,75,40,.16)' : 'rgba(255,238,205,.22)'; c.beginPath(); c.arc(p[0], p[1], 0.22, 0, Math.PI * 2); c.fill(); }
    }
  }
  // conference rug (round, rings in world units so it scales with the tile size)
  { const oval = (x, y, r, fill, stroke) => {
      const p = Pf(x, y), rx = r * HX * Math.SQRT2, ry = r * HY * Math.SQRT2;
      c.beginPath(); c.ellipse(p[0], p[1], rx, ry, 0, 0, Math.PI * 2);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = edgeW() * 1.15; c.stroke(); }
    };
    oval(10.8, 2.75, 2.55, '#5c4636');
    oval(10.8, 2.75, 2.32, '#8d7356');
    oval(10.8, 2.75, 2.05, '#c4a37c');
    oval(10.8, 2.75, 1.55, null, '#6a4e38');
    oval(10.8, 2.75, 1.15, '#a68460');
    oval(10.8, 2.75, 0.42, '#6e533c');
  }
  // reception rug
  poly(c, [P(3.65, 9.1), P(4.25, 9.1), P(4.25, 12.1), P(3.65, 12.1)], '#7a3a2e'); poly(c, [P(3.72, 9.2), P(4.18, 9.2), P(4.18, 12.0), P(3.72, 12.0)], '#94493a');
  // window light on the floor (north, west, and the windows on the east and south walls)
  for (const [x0, x1] of [[0.6, 2.8], [14.1, 15.9]]) poly(c, [P(x0 + 0.3, 0.3), P(x1 + 0.3, 0.3), P(x1 + 1.4, 2.8), P(x0 + 1.4, 2.8)], 'rgba(255,236,180,.16)');
  poly(c, [P(0.3, 1.9), P(0.3, 3.7), P(2.6, 4.7), P(2.6, 2.9)], 'rgba(255,236,180,.13)');
  poly(c, [P(GX - 0.3, 0.55), P(GX - 0.3, 2.15), P(GX - 2.2, 3.1), P(GX - 2.2, 1.5)], 'rgba(255,236,180,.12)');
  poly(c, [P(GX - 0.3, 6.5), P(GX - 0.3, 8.2), P(GX - 2.0, 9.0), P(GX - 2.0, 7.3)], 'rgba(255,236,180,.1)');
  poly(c, [P(0.55, GY - 0.3), P(2.35, GY - 0.3), P(3.2, GY - 2.2), P(1.4, GY - 2.2)], 'rgba(255,236,180,.12)');
  // contact shadows
  for (const s of SHADOWS()) shadow(c, ...s);
  // open aisle in front of the design trainer (Kelly and Toby sit south of this)
  poly(c, [P(15.1, 6.9), P(20.4, 6.9), P(20.4, 9.85), P(15.1, 9.85)], '#c4ad8c');
  poly(c, [P(15.28, 7.08), P(20.22, 7.08), P(20.22, 9.68), P(15.28, 9.68)], '#d8c4a4');
  drawShell(c);
  baseBox[floor][facing] = box;
  baseOk[floor][facing] = true;
}
function lipColors(innerFace, light) {
  const left = ['+y', '-x', '-y', '+x'][facing];
  const right = ['+x', '+y', '-x', '-y'][facing];
  const dark = '#4a3322';
  return { l: innerFace === left ? light : dark, r: innerFace === right ? light : dark };
}
function floorLipY(c, y, x0, x1, z0, z1, dark, lite) {
  poly(c, quadY(y, x0, x1, z0, z1), dark);
  poly(c, quadY(y, x0, x1, z1 - 0.08, z1), lite);
}
function floorLipX(c, x, y0, y1, z0, z1, dark, lite) {
  poly(c, quadX(x, y0, y1, z0, z1), dark);
  poly(c, quadX(x, y0, y1, z1 - 0.08, z1), lite);
}
function stubY(c, y, x0, x1) {
  const inn = y < GY * 0.5 ? 0.004 : -0.004;
  poly(c, quadY(y + inn, x0, x1, 0, 0.46), '#d7c4a2');
  poly(c, quadY(y + inn * 2, x0, x1, 0, 0.14), '#5e4029');
  poly(c, quadY(y + inn * 2, x0, x1, 0.38, 0.46), '#7a5232');
}
function stubX(c, x, y0, y1) {
  const inn = x < GX * 0.5 ? 0.004 : -0.004;
  poly(c, quadX(x + inn, y0, y1, 0, 0.46), '#e4d3ae');
  poly(c, quadX(x + inn * 2, y0, y1, 0, 0.14), '#5e4029');
  poly(c, quadX(x + inn * 2, y0, y1, 0.38, 0.46), '#7a5232');
}
function blockWallY(c, y, x0, x1) {
  const inn = y < GY * 0.5 ? 0.004 : -0.004;
  poly(c, quadY(y + inn, x0, x1, 0, WALL), '#c4b49a');
  for (let z = 0.28; z < WALL - 0.2; z += 0.32) poly(c, quadY(y + inn * 2, x0, x1, z, z + 0.025), 'rgba(70,55,40,.28)');
  for (let z = 0, row = 0; z < WALL - 0.15; z += 0.32, row++) for (let x = x0 + (row % 2) * 0.4; x < x1; x += 0.8) poly(c, quadY(y + inn * 2, x, x + 0.025, z, z + 0.32), 'rgba(70,55,40,.22)');
  poly(c, quadY(y + inn * 2, x0, x1, 0, 0.16), '#e0b43a');
  poly(c, quadY(y + inn * 2, x0, x1, 2.98, WALL), '#6a5340');
}
function blockWallX(c, x, y0, y1) {
  const inn = x < GX * 0.5 ? 0.004 : -0.004;
  poly(c, quadX(x + inn, y0, y1, 0, WALL), '#d2c2a6');
  for (let z = 0.28; z < WALL - 0.2; z += 0.32) poly(c, quadX(x + inn * 2, y0, y1, z, z + 0.025), 'rgba(70,55,40,.28)');
  for (let z = 0, row = 0; z < WALL - 0.15; z += 0.32, row++) for (let y = y0 + (row % 2) * 0.4; y < y1; y += 0.8) poly(c, quadX(x + inn * 2, y, y + 0.025, z, z + 0.32), 'rgba(70,55,40,.22)');
  poly(c, quadX(x + inn * 2, y0, y1, 0, 0.16), '#e0b43a');
  poly(c, quadX(x + inn * 2, y0, y1, 2.98, WALL), '#6a5340');
}
function bayDoorY(c, y, x0) {
  const inn = y < GY * 0.5 ? 1 : -1;
  const q = (eps, xa, xb, za, zb) => quadY(y + inn * eps, xa, xb, za, zb);
  poly(c, q(0.002, x0 - 0.14, x0 + 2.7, 0.02, 2.35), '#2e2e2e');
  poly(c, q(0.006, x0, x0 + 2.5, 0.1, 2.2), '#c9c3b6');
  for (let z = 0.22; z < 2.15; z += 0.2) poly(c, q(0.01, x0, x0 + 2.5, z, z + 0.045), '#9d988c');
  poly(c, q(0.012, x0, x0 + 2.5, 0.1, 0.28), '#e0b43a');
  poly(c, q(0.014, x0 + 0.4, x0 + 2.1, 2.22, 2.55), '#1d1d1d');
}
function drawShell(c) {
  const far = [[0, 0], [GX, 0], [GX, GY], [0, GY]][facing];
  box(c, far[0] < 1 ? -0.4 : GX, far[1] < 1 ? -0.4 : GY, 0, 0.4, 0.4, WALL, '#3b2a1c', { ol: false });
  const shade = (x, y, dx, dy) => poly(c, [P(x, y, 0), P(x, y, WALL), P(x + dx, y + dy, WALL), P(x + dx, y + dy, 0)], 'rgba(40,20,5,.12)');
  if (isFar('W')) {
    const lip = lipColors('+x', '#e6d6b4');
    box(c, -0.4, 0, 0, 0.4, GY, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    wallX(c, 0, 0, GY, false);
    shade(0, far[1] < 1 ? 0 : GY, 0, far[1] < 1 ? 1.6 : -1.6);
    windowX(c, 0, 1.8, 3.8);
    poly(c, quadX(0.001, 4.6, 8.4, 0.95, 2.55), '#8e959b'); poly(c, quadX(0.006, 4.66, 8.34, 1.0, 2.5), '#c9ced2');
    poly(c, quadX(0.01, 4.72, 8.28, 1.05, 2.45), '#f8f8f4'); poly(c, quadX(0.012, 7.1, 8.2, 1.9, 2.4), 'rgba(160,190,220,.15)');
    box(c, 0, 5.0, 0.86, 0.12, 3.0, 0.06, '#6f757b', { ol: false });
    for (const [y, col] of [[5.4, '#d33'], [5.7, '#33c'], [6.0, '#2a2']]) box(c, 0.03, y, 0.92, 0.06, 0.2, 0.04, col, { ol: false });
    frameX(c, 0, 12.4, 14.0, 1.5, 2.4, ['#4a6a8a', '#d9b46a']);
  } else {
    floorLipX(c, 0, 0, GY, -0.5, 0, '#3a2719', '#6a4c32');
    stubX(c, 0, 0, GY);
  }
  if (isFar('N')) {
    const lip = lipColors('+y', '#ddcca8');
    box(c, 0, -0.4, 0, GX, 0.4, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    wallY(c, 0, 0, MGR.x0, false); wallY(c, 0, MGR.x0, GX, true);
    shade(far[0] < 1 ? 0 : GX, 0, far[0] < 1 ? 1.6 : -1.6, 0);
    windowY(c, 0, 0.6, 2.8); windowY(c, 0, 14.1, 15.9);
    boardY(c, 0, 3.0, 7.2, 0.95, 2.7, '#14110e');
    // Team Board: one list, tall enough for every business
    boardY(c, 0, 7.55, 13.95, 0.38, 3.08, '#22303a');
    frameY(c, 0, 16.7, 18.3, 1.5, 2.45, ['#5f8f6a', '#9cc7df']); frameY(c, 0, 18.6, 19.3, 1.6, 2.35, ['#f3ead2', '#f3ead2']);
  } else {
    floorLipY(c, 0, 0, GX, -0.5, 0, '#4a3322', '#7a5a3c');
    stubY(c, 0, 0, GX);
  }
  if (isFar('E')) {
    const lip = lipColors('-x', '#e6d6b4');
    box(c, GX, 0, 0, 0.4, GY, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    wallX(c, GX, 0, MGR.y1, true);
    wallX(c, GX, MGR.y1, GY, false);
    shade(GX, far[1] < 1 ? 0 : GY, 0, far[1] < 1 ? 1.6 : -1.6);
    windowX(c, GX, 0.45, 2.25);
    frameX(c, GX, 3.15, 4.7, 1.5, 2.5, ['#5f8f6a', '#9cc7df']);
    windowX(c, GX, 6.35, 8.25);
    frameX(c, GX, 8.7, 10.25, 1.45, 2.4, ['#8a4a3c', '#e6c98a']);
    windowX(c, GX, 11.6, 13.9);
  } else {
    floorLipX(c, GX, 0, GY, -0.5, 0, '#3a2719', '#6a4c32');
    stubX(c, GX, 0, GY);
  }
  if (isFar('S')) {
    const lip = lipColors('-y', '#ddcca8');
    box(c, 0, GY, 0, GX, 0.4, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    wallY(c, GY, 0, GX, false);
    shade(far[0] < 1 ? 0 : GX, GY, far[0] < 1 ? 1.6 : -1.6, 0);
    windowY(c, GY, 0.45, 2.45);
    frameY(c, GY, 3.45, 4.95, 1.5, 2.45, ['#4a6a8a', '#d9b46a']);
    frameY(c, GY, 6.25, 7.7, 1.55, 2.35, ['#6a5344', '#c9b48a']);
    windowY(c, GY, 9.55, 11.45);
    windowY(c, GY, 14.3, 16.7);
    windowY(c, GY, 18.3, 20.6);
  } else {
    floorLipY(c, GY, 0, GX, -0.5, 0, '#4a3322', '#7a5a3c');
    stubY(c, GY, 0, GX);
  }}
const LIGHTS = [[5.4, 8.3, 78, 0.2], [11.6, 8.3, 78, 0.2], [4.0, 13.1, 64, 0.16], [10.8, 2.8, 66, 0.18], [19, 2.6, 70, 0.24], [16.8, 9.6, 58, 0.16], [2.2, 10.0, 58, 0.16], [17, 14, 86, 0.12]];
function lights(c) {
  const LS = HX / 12;
  const list = floor === 'warehouse' ? WH_LIGHTS : LIGHTS;
  c.save(); c.globalCompositeOperation = 'screen';
  for (const [x, y, r0, a] of list) {
    const r = r0 * LS, p = Pf(x, y, 0);
    const gr = c.createRadialGradient(p[0], p[1], r * 0.06, p[0], p[1], r);
    gr.addColorStop(0, `rgba(255,220,170,${a})`); gr.addColorStop(1, 'rgba(255,220,170,0)');
    c.fillStyle = gr; c.beginPath(); c.arc(p[0], p[1], r, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

// ---------- props ----------
function blobs(c, list, dark) { for (const [x, y, w, h] of list) { c.fillStyle = dark; c.fillRect(x - 1, y - 1, w + 2, h + 2); } }
function plant(c, x, y, s = 1) {
  box(c, x, y, 0, 0.48 * s, 0.48 * s, 0.42 * s, '#b4602f', { l: '#9a4f25', r: '#7a3b1a' });
  box(c, x - 0.03, y - 0.03, 0.36 * s, 0.54 * s, 0.54 * s, 0.08 * s, '#c87040', { ol: false });
  const p = P(x + 0.24 * s, y + 0.24 * s, 0.46 * s);
  const leaves = [
    [-1.15, 13, 3.1, '#2d6a30'], [-0.7, 15, 3.3, '#3c8a3a'], [-0.2, 14, 2.8, '#4e9c46'],
    [0.28, 16, 3.0, '#62b252'], [0.75, 13, 2.7, '#357c34'], [1.15, 11, 2.4, '#2a6230'],
    [-1.55, 10, 2.5, '#245628'], [0.5, 11, 2.2, '#7ec85e'],
  ];
  c.save();
  c.translate(p[0], p[1]);
  for (const [ang, len, fat, col] of leaves) {
    c.save();
    c.rotate(ang);
    c.strokeStyle = '#1c461c'; c.lineWidth = 0.7; c.lineCap = 'round';
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(fat * 0.15, -len * 0.45, 0, -len); c.stroke();
    const g = c.createLinearGradient(0, -len * 0.3, fat, -len);
    g.addColorStop(0, shade(col, 1.12)); g.addColorStop(1, shade(col, 0.78));
    c.fillStyle = g;
    c.beginPath(); c.ellipse(0, -len * 0.72, fat * s, len * 0.4, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(16,40,14,.35)'; c.lineWidth = 0.4; c.stroke();
    c.fillStyle = 'rgba(214,245,170,.4)';
    c.beginPath(); c.ellipse(-fat * 0.25, -len * 0.78, fat * 0.38, len * 0.14, -0.5, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  c.restore();
}
function cabinet(c, x, y, face = 'e') {
  box(c, x, y, 0, 0.7, 0.6, 1.1, '#a3aaaf', { l: '#8a9196', r: '#737a7f' });
  const vis = (face === 'e' && showPosX()) || (face === 'w' && !showPosX()) || (face === 's' && showPosY()) || (face === 'n' && !showPosY());
  if (!vis) return;
  for (const z of [0.08, 0.42, 0.76]) {
    const panel = (pts) => { poly(c, pts, '#8f969b'); };
    if (face === 'e' || face === 'w') {
      const px = face === 'e' ? x + 0.702 : x - 0.004;
      panel(quadX(px, y + 0.05, y + 0.55, z, z + 0.3));
      poly(c, quadX(px + (face === 'e' ? 0.002 : -0.002), y + 0.07, y + 0.53, z + 0.02, z + 0.28), '#9aa1a6');
      poly(c, quadX(px + (face === 'e' ? 0.004 : -0.004), y + 0.22, y + 0.38, z + 0.16, z + 0.2), '#3a3f43');
      poly(c, quadX(px + (face === 'e' ? 0.004 : -0.004), y + 0.24, y + 0.36, z + 0.22, z + 0.26), '#f2efe6');
    } else {
      const py = face === 's' ? y + 0.602 : y - 0.004;
      panel(quadY(py, x + 0.05, x + 0.65, z, z + 0.3));
      poly(c, quadY(py + (face === 's' ? 0.002 : -0.002), x + 0.07, x + 0.63, z + 0.02, z + 0.28), '#9aa1a6');
      poly(c, quadY(py + (face === 's' ? 0.004 : -0.004), x + 0.28, x + 0.42, z + 0.16, z + 0.2), '#3a3f43');
      poly(c, quadY(py + (face === 's' ? 0.004 : -0.004), x + 0.3, x + 0.4, z + 0.22, z + 0.26), '#f2efe6');
    }
  }
}
function cooler(c, x, y) {
  box(c, x, y, 0, 0.45, 0.45, 0.85, '#e7e7e2');
  box(c, x + 0.05, y + 0.05, 0.85, 0.35, 0.35, 0.35, '#7cc0e6', { l: '#63a6cc', r: '#4f8fb3' });
}
function ream(c, x, y, z, w, d, band) {
  box(c, x, y, z, w, d, 0.27, '#f4f2ec', { l: '#dedbd2', r: '#c4c0b6' });
  const yb = showPosY() ? y + d + 0.002 : y - 0.002;
  const xb = showPosX() ? x + w + 0.002 : x - 0.002;
  poly(c, quadY(yb, x, x + w, z + 0.09, z + 0.16), band); poly(c, quadX(xb, y, y + d, z + 0.09, z + 0.16), shade(band, 0.75));
}
function pallet(c, x, y, layers = 3, z0 = 0) {
  box(c, x, y, z0, 1.4, 1.1, 0.16, '#a07a4a', { l: '#86643a', r: '#6e512e' });
  for (const f of [0.25, 0.65, 1.05]) poly(c, quadY(y + 1.1 + 0.002, x + f, x + f + 0.2, z0, z0 + 0.1), '#3a2a18');
  for (const f of [0.2, 0.6]) poly(c, quadX(x + 1.4 + 0.002, y + f, y + f + 0.25, z0, z0 + 0.1), '#3a2a18');
  for (let i = 0; i < layers; i++) {
    const z = z0 + 0.16 + i * 0.28;
    ream(c, x + 0.06, y + 0.06, z, 0.62, 0.48, '#3d7ec4'); ream(c, x + 0.72, y + 0.06, z, 0.62, 0.48, '#3d7ec4');
    ream(c, x + 0.06, y + 0.56, z, 0.62, 0.48, '#3d7ec4'); ream(c, x + 0.72, y + 0.56, z, 0.62, 0.48, '#3d7ec4');
    // plastic wrap sheen
    poly(c, [P(x + 0.12, y + 0.12, z + 0.27), P(x + 0.4, y + 0.12, z + 0.27), P(x + 0.28, y + 0.32, z + 0.27)], 'rgba(255,255,255,.55)');
  }
  const zt = z0 + 0.16 + layers * 0.28; poly(c, [P(x + 0.1, y + 0.1, zt), P(x + 0.7, y + 0.1, zt), P(x + 0.5, y + 0.35, zt)], 'rgba(255,255,255,.5)');
}
function carton(c, x, y, z, w, d, h) {
  box(c, x, y, z, w, d, h, '#c99b62', { l: '#b0844f', r: '#93693b' });
  poly(c, [P(x + w * 0.45, y, z + h), P(x + w * 0.55, y, z + h), P(x + w * 0.55, y + d, z + h), P(x + w * 0.45, y + d, z + h)], '#e3c48f');
  poly(c, quadY(y + d + 0.002, x + w * 0.2, x + w * 0.45, z + h * 0.3, z + h * 0.6), '#f2ead8');
}
function rack(c, x, y, w, z0 = 0) {
  for (let i = 0; i <= w + 0.01; i += w / 2) box(c, x + i, y, z0, 0.1, 0.8, 2.0, '#3d5a80', { l: '#35507a', r: '#2b4266' });
  for (const z of [0.0, 0.7, 1.4]) {
    box(c, x, y, z0 + z + 0.05, w + 0.1, 0.8, 0.07, '#e08a2a', { l: '#c47422', r: '#a8601c' });
    for (let k = 0; k < w - 0.3; k += 0.75) carton(c, x + 0.15 + k, y + 0.1, z0 + z + 0.12, 0.6, 0.6, 0.42 + ((k * 7 | 0) % 2) * 0.08);
  }
}
function chair(c, x, y, col = '#2c3442') {
  const p = P(x + 0.25, y + 0.25, 0.02);
  c.fillStyle = 'rgba(20,12,8,.28)';
  c.beginPath(); c.ellipse(p[0] + 0.6, p[1] + 0.4, 5.2, 2.4, 0.2, 0, Math.PI * 2); c.fill();
  box(c, x + 0.2, y + 0.2, 0, 0.1, 0.1, 0.32, '#2a241c', { ol: false });
  box(c, x, y, 0.32, 0.5, 0.5, 0.1, col, { t: shade(col, 1.08) });
}
function paperStack(c, x, y, z, n) {
  const h = n * 0.05; box(c, x, y, z, 0.36, 0.28, h, '#f8f6ef', { l: '#e2ddcf', r: '#c9c3b3' });
  for (let i = 1; i < n; i++) { seg(c, P(x, y + 0.28, z + i * 0.05), P(x + 0.36, y + 0.28, z + i * 0.05), 'rgba(120,110,90,.35)'); }
  seg(c, P(x + 0.06, y + 0.08, z + h), P(x + 0.28, y + 0.08, z + h), 'rgba(90,90,110,.35)'); seg(c, P(x + 0.06, y + 0.15, z + h), P(x + 0.22, y + 0.15, z + h), 'rgba(90,90,110,.35)');
}
// Chunky beige CRT. The glass faces the camera (+y) so the glow reads in the isometric view.
function crt(c, x, y, z, busy, t, k) {
  const w = 0.78, d = 0.32, h = 0.58;
  box(c, x + 0.22, y + d * 0.2, z, 0.34, 0.16, 0.05, '#c4b49a', { ol: false });
  box(c, x + 0.32, y + d * 0.35, z + 0.04, 0.1, 0.1, 0.12, '#8a7b66', { ol: false });
  box(c, x, y, z + 0.14, w, d, h, '#e4d8c0', { l: '#cbbda4', r: '#b09a7e', t: '#f3e8d4' });
  // Glass sits on whichever large face points at the camera.
  const yS = showPosY() ? y + d : y, s = showPosY() ? 1 : -1;
  const gy = (eps, x0, x1, z0, z1) => quadY(yS + s * eps, x0, x1, z0, z1);
  poly(c, gy(0.002, x + 0.05, x + w - 0.05, z + 0.2, z + 0.14 + h - 0.04), '#2a261e');
  const glass = busy ? '#86f06a' : '#245c48';
  poly(c, gy(0.004, x + 0.09, x + w - 0.09, z + 0.26, z + 0.14 + h - 0.08), glass);
  if (busy) {
    for (let i = 0; i < 4; i++) {
      const zz = z + 0.14 + h - 0.16 - i * 0.09;
      const len = 0.18 + hsh(k + i, (t * 3 | 0)) * 0.32;
      poly(c, gy(0.006, x + 0.14, x + 0.14 + len, zz, zz + 0.03), 'rgba(12,50,16,.55)');
    }
    poly(c, gy(0.006, x + 0.1, x + w - 0.12, z + 0.14 + h - 0.14, z + 0.14 + h - 0.1), 'rgba(255,255,255,.28)');
    const q = P(x + w * 0.5, yS, z + 0.14 + h * 0.55);
    const gr = c.createRadialGradient(q[0], q[1], 1, q[0], q[1], 18);
    gr.addColorStop(0, 'rgba(130,255,110,.4)'); gr.addColorStop(1, 'rgba(130,255,110,0)');
    c.fillStyle = gr; c.fillRect(q[0] - 18, q[1] - 14, 36, 28);
  } else {
    poly(c, gy(0.006, x + 0.09, x + w - 0.09, z + 0.3, z + 0.14 + h - 0.12), 'rgba(90,180,140,.16)');
    poly(c, gy(0.006, x + 0.14, x + 0.46, z + 0.48, z + 0.6), 'rgba(190,240,210,.28)');
    poly(c, gy(0.006, x + 0.16, x + 0.38, z + 0.36, z + 0.42), 'rgba(190,240,210,.16)');
    const q = P(x + w * 0.45, yS, z + 0.14 + h * 0.6);
    const gr = c.createRadialGradient(q[0], q[1], 1, q[0], q[1], 14);
    gr.addColorStop(0, 'rgba(140,220,170,.22)'); gr.addColorStop(1, 'rgba(140,220,170,0)');
    c.fillStyle = gr; c.beginPath(); c.ellipse(q[0], q[1], 12, 8, 0, 0, Math.PI * 2); c.fill();
  }
  poly(c, gy(0.006, x + w - 0.16, x + w - 0.09, z + 0.18, z + 0.23), busy ? '#9dff78' : '#a05040');
  poly(c, gy(0.005, x + 0.08, x + 0.2, z + 0.48, z + 0.64), 'rgba(255,255,255,.18)');
}
function keys(c, x, y, z) {
  box(c, x, y, z, 0.58, 0.2, 0.04, '#2e3034', { t: '#3c3e44', ol: false });
  for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
    const q = P(x + 0.06 + i * 0.1, y + 0.05 + j * 0.08, z + 0.045);
    c.fillStyle = j ? '#c8c4bc' : '#e4e0d8'; c.fillRect(q[0], q[1], 2, 1);
  }
}
function mug(c, x, y, z, col, mark) {
  box(c, x, y, z, 0.16, 0.16, 0.18, col, { t: '#f7f4ee', l: shade(col, 0.85), r: shade(col, 0.7) });
  const q = P(x + 0.16, y + 0.06, z + 0.08);
  c.strokeStyle = shade(col, 0.65); c.strokeRect(q[0], q[1], 2, 3);
  if (mark) { const m = P(x + 0.05, y + 0.16, z + 0.1); c.fillStyle = mark; c.fillRect(m[0], m[1], 2, 3); }
}
function deskDraw(c, p, t) {
  const d = p.d, busy = stateOf(p.s.id) === 'active', k = (d.x * 13 + d.y * 7) | 0;
  if (d.reception) {
    box(c, d.x, d.y, 0, d.w, d.d, 0.8, '#7a4a2a', { l: '#6b4024', r: '#5a361d' });
    const rx = showPosX() ? d.x + d.w : d.x, rs = showPosX() ? 1 : -1;
    for (let y = d.y + 0.25; y < d.y + d.d - 0.2; y += 0.8) { poly(c, quadX(rx + rs * 0.003, y, y + 0.65, 0.12, 0.66), '#4f2f19'); poly(c, quadX(rx + rs * 0.005, y + 0.04, y + 0.61, 0.16, 0.62), '#6e4426'); }
    box(c, d.x - 0.12, d.y - 0.12, 0.8, d.w + 0.24, d.d + 0.24, 0.09, '#b07c4e');
    poly(c, quadX(rx + rs * 0.01, d.y + 0.65, d.y + d.d - 0.65, 0.2, 0.62), '#2f1d10');
    crt(c, d.x + 0.08, d.y + 0.35, 0.89, true, t, k);
    keys(c, d.x + 0.1, d.y + 1.15, 0.89);
    paperStack(c, d.x + 0.15, d.y + 2.35, 0.89, 4);
    box(c, d.x + 0.2, d.y + 1.85, 0.89, 0.28, 0.18, 0.07, '#2a241c', { ol: false });
    mug(c, d.x + 0.55, d.y + 2.5, 0.89, '#f4efe6', '#c45438');
    if (facesCamera(1)) hands(c, p, t, 0.89);
    return;
  }
  const top = p.s.hero ? '#7a4a2a' : '#8d5d36';
  box(c, d.x, d.y, 0, d.w, d.d, 0.62, top, { l: shade(top, 0.74), r: shade(top, 0.58), t: shade(top, 1.05) });
  // wood grain on the top
  for (let i = 1; i < 4; i++) seg(c, P(d.x + 0.08 + hsh(k, i) * 0.2, d.y + d.d * i / 4, 0.62), P(d.x + d.w - 0.1 - hsh(i, k) * 0.3, d.y + d.d * i / 4, 0.62), 'rgba(70,38,16,.28)');
  // front: modesty panel + pedestal with drawers, on the camera-facing sides
  const yF = showPosY() ? d.y + d.d : d.y, ys = showPosY() ? 1 : -1;
  const xF = showPosX() ? d.x + d.w : d.x, xs = showPosX() ? 1 : -1;
  poly(c, quadY(yF + ys * 0.003, d.x + 0.12, d.x + d.w - 0.85, 0.12, 0.52), shade(top, 0.62));
  const px0 = d.x + d.w - 0.78;
  for (const [z0, z1] of [[0.06, 0.24], [0.27, 0.42], [0.45, 0.57]]) {
    poly(c, quadY(yF + ys * 0.004, px0, d.x + d.w - 0.06, z0, z1), shade(top, 0.82)); poly(c, quadY(yF + ys * 0.005, px0 + 0.03, d.x + d.w - 0.09, z0 + 0.02, z1 - 0.02), shade(top, 0.74));
    poly(c, quadY(yF + ys * 0.006, px0 + 0.28, px0 + 0.44, (z0 + z1) / 2 - 0.02, (z0 + z1) / 2 + 0.02), '#e2c98e');
  }
  poly(c, quadX(xF + xs * 0.003, d.y + 0.08, d.y + d.d - 0.08, 0.08, 0.52), shade(top, 0.5));
  // desk stuff
  const id = p.s.id;
  if (d.away) {
    crt(c, d.x + 0.15, d.y + 0.02, 0.62, busy, t, k);
    keys(c, d.x + d.w * 0.28, d.y + d.d - 0.28, 0.62);
    paperStack(c, d.x + 0.08, d.y + 0.08, 0.62, 2 + (k % 3));
    if (facesCamera(-1)) hands(c, p, t, 0.62);
    return;
  }
  crt(c, d.x + 0.12, d.y + 0.02, 0.62, busy, t, k);
  keys(c, d.x + 0.18, d.y + 0.4, 0.62);
  paperStack(c, d.x + d.w - 0.5, d.y + d.d - 0.38, 0.62, 2 + (k % 4));
  if (id === 'assist') box(c, d.x + d.w - 0.42, d.y + 0.42, 0.62, 0.16, 0.16, 0.2, '#e0b83a'); // bobblehead
  if (id === 'builder') paperStack(c, d.x + d.w - 0.55, d.y + 0.42, 0.62, 1); // crossword
  if (id === 'cos') mug(c, d.x + d.w - 0.36, d.y + d.d - 0.4, 0.62, '#f4f1ea');
  if (id === 'designer') mug(c, d.x + d.w - 0.36, d.y + d.d - 0.4, 0.62, '#e4548c');
  if (id === 'faith') box(c, d.x + d.w - 0.32, d.y + 0.4, 0.62, 0.14, 0.12, 0.1, '#e8a04a', { ol: false });
  if (p.s.hero) {
    // green banker's lamp, brass stem, nameplate, world's-best-boss mug
    box(c, d.x + d.w - 0.42, d.y + 0.12, 0.62, 0.08, 0.08, 0.42, '#c9a24a', { ol: false });
    box(c, d.x + d.w - 0.62, d.y + 0.02, 1.0, 0.48, 0.26, 0.12, '#1f6b38', { t: '#3fa85a', l: '#2f8a4a' });
    const q = P(d.x + d.w - 0.38, d.y + 0.16, 0.98);
    const gr = c.createRadialGradient(q[0], q[1], 1, q[0], q[1], 22);
    gr.addColorStop(0, 'rgba(255,236,170,.55)'); gr.addColorStop(1, 'rgba(255,236,170,0)');
    c.fillStyle = gr; c.fillRect(q[0] - 22, q[1] - 10, 44, 28);
    box(c, d.x + 0.95, d.y + d.d - 0.22, 0.62, 0.55, 0.1, 0.08, '#c9a24a');
    mug(c, d.x + d.w - 0.34, d.y + d.d - 0.42, 0.62, '#f7f4ee', '#b42334');
  }
  if (facesCamera(1)) hands(c, p, t, 0.62);
}
function hands(c, p, t, z) { // forearms on the desktop, a soft type when busy and a slower idle tap otherwise
  const busy = stateOf(p.s.id) === 'active', L = crewLook(p.s.id);
  const sl = L.vest ? L.shirt : (L.jacket || L.cardigan || L.shirt);
  const [sx, sy] = P(p.seat[0], p.d.y + 0.16, z);
  const S = CREW_SC;
  const wave = Math.sin((busy ? 9 : 2.2) * t + p.phase);
  const liftL = (busy ? 1.7 : 0.45) * Math.max(0, wave);
  const liftR = (busy ? 1.7 : 0.45) * Math.max(0, -wave);
  const limb = (x, y, lift, sleeve, skin, flip) => {
    c.save();
    c.translate(sx + x * S, sy + (y - lift) * S);
    c.scale(S * (flip ? -1 : 1), S);
    c.fillStyle = sleeve;
    c.beginPath(); c.roundRect(-5.2, -1.8, 7.6, 3.6, 1.6); c.fill();
    c.strokeStyle = 'rgba(36,22,14,.4)'; c.lineWidth = 0.55; c.stroke();
    c.fillStyle = skin;
    c.beginPath(); c.ellipse(2.8, 0.15, 3.1, 2.05, -0.25, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(36,22,14,.38)'; c.lineWidth = 0.45; c.stroke();
    // fingertips
    c.fillStyle = shade(skin, 0.86);
    c.beginPath(); c.ellipse(4.6, -0.55, 0.7, 0.85, 0.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(4.8, 0.7, 0.65, 0.8, 0.2, 0, Math.PI * 2); c.fill();
    c.restore();
  };
  limb(-9, -3.2, liftL, sl, L.skin, false);
  limb(6, -3.2, liftR, shade(sl, 0.86), shade(L.skin, 0.92), true);
}

const avatarCache = {};
function avatar(id) {
  if (avatarCache[id]) return avatarCache[id];
  const k = document.createElement('canvas'); k.width = 64; k.height = 64; const c = k.getContext('2d');
  c.imageSmoothingEnabled = true;
  c.fillStyle = id === 'chris' ? '#3d8d2f' : (STATIONS.find(s => s.id === id)?.color || '#555'); c.fillRect(0, 0, 64, 64);
  if (id === 'chris') { c.fillStyle = '#fff'; c.font = 'bold 36px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('C', 32, 34); }
  else if (crewLook(id)) { c.save(); c.translate(32, 60); c.scale(1.22, 1.22); paintCrew(c, id, 0, 0, {}); c.restore(); }
  return (avatarCache[id] = k.toDataURL());
}

// ---------- stairs (shared footprint; the two floors are never drawn together) ----------
function stairSteps(up) {
  const n = ST.n, w = (ST.x1 - ST.x0) / n, depth = ST.y1 - ST.y0;
  const steps = [];
  for (let i = 0; i < n; i++) {
    const k = up ? i : (n - 1 - i);
    steps.push({ x: ST.x0 + i * w, w, top: 0.2 + k * 0.16, y: ST.y0, d: depth });
  }
  return steps;
}
function paintStep(c, s) {
  box(c, s.x, s.y, 0, s.w + 0.02, s.d, s.top, '#8a6a4a', { t: (s.x * 3 | 0) % 2 ? '#c4a078' : '#b08a62', l: '#6e5238', r: '#5a432e' });
  poly(c, [P(s.x + 0.04, s.y + 0.08, s.top), P(s.x + s.w - 0.04, s.y + 0.08, s.top), P(s.x + s.w - 0.06, s.y + 0.22, s.top), P(s.x + 0.06, s.y + 0.22, s.top)], 'rgba(255,236,210,.28)');
}
function paintStairRails(c) {
  const rail = (y) => {
    c.strokeStyle = '#2a241c'; c.lineWidth = 0.95; c.lineCap = 'round'; c.lineJoin = 'round';
    const a = P(ST.x0, y, 1.28), b = P(ST.x1, y, 1.28);
    c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    for (let i = 0; i <= ST.n; i += 2) {
      const x = ST.x0 + i * (ST.x1 - ST.x0) / ST.n;
      const p = P(x, y, 0.02), q = P(x, y, 1.28);
      c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke();
    }
  };
  rail(ST.y0 + 0.1);
  rail(ST.y1 - 0.1);
}
function stairSignBox() {
  const yPost = ST.y0 - 0.42;
  const x0 = ST.x0 + 0.06, x1 = ST.x1 - 0.06;
  const ySign = showPosY() ? yPost + 0.16 : yPost + 0.02;
  const textX = x0 + (x1 - x0) * 0.34;
  return { yPost, x0, x1, ySign, textX, span: x1 - textX - 0.08, z0: 1.42, z1: 2.08 };
}
// Office stairs go DOWN to the warehouse. Warehouse stairs go UP to the office.
// The chevron uses world height, so the point stays down or up on every facing.
function stairCue(up = floor === 'warehouse') {
  const s = stairSignBox();
  const y = s.ySign + (showPosY() ? 0.03 : -0.03);
  const xMid = s.x0 + (s.x1 - s.x0) * 0.18;
  const half = (s.x1 - s.x0) * 0.12;
  const zTip = up ? s.z1 - 0.1 : s.z0 + 0.1;
  const zTail = up ? s.z1 - 0.42 : s.z0 + 0.42;
  return {
    up,
    word: up ? 'UP' : 'DOWN',
    dest: up ? 'OFFICE' : 'WAREHOUSE',
    tip: [xMid, y, zTip],
    tail: [xMid, y, zTail],
    left: [xMid - half, y, zTail],
    right: [xMid + half, y, zTail],
  };
}
function paintStairChevron(c, cue) {
  c.save();
  c.strokeStyle = '#fff';
  c.lineWidth = 3.1;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const a = P(...cue.left), b = P(...cue.tip), d = P(...cue.right);
  c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); c.stroke();
  c.restore();
}
function paintStairSign(c, up) {
  const s = stairSignBox();
  const cue = stairCue(up);
  box(c, s.x0 + 0.12, s.yPost, 0, 0.1, 0.1, s.z1, '#333');
  box(c, s.x1 - 0.24, s.yPost, 0, 0.1, 0.1, s.z1, '#333');
  poly(c, quadY(s.ySign, s.x0, s.x1, s.z0, s.z1), up ? '#1f4e86' : '#1f7a3a');
  const yFace = s.ySign + (showPosY() ? 0.012 : -0.012);
  poly(c, quadY(yFace, s.x0 + 0.08, s.x1 - 0.08, s.z0 + 0.06, s.z1 - 0.06), up ? '#2a6cb0' : '#2a9a4a');
  // UP: words under the chevron. DOWN: words over the chevron, so the point and the word agree.
  const top = s.z1 - 0.06;
  const height = s.z1 - s.z0 - 0.12;
  const pl = planeUpright(PLANE_Y(s.textX, yFace + (showPosY() ? 0.008 : -0.008), top), s.span, height);
  paintOnPlane(c, pl, 46, cc => {
    const Wd = s.span * 46, Hd = height * 46;
    cc.textAlign = 'center'; cc.textBaseline = 'middle'; cc.fillStyle = '#fff';
    const wordPx = Math.max(16, Math.floor(Hd * 0.46));
    const word = fontFit(cc, cue.word, Wd - 4, wordPx, 12);
    cc.fillText(word, Wd / 2, Hd * 0.32);
    const destPx = Math.max(11, Math.floor(Hd * 0.3));
    const dest = fontFit(cc, cue.dest, Wd - 4, destPx, 9);
    cc.fillText(dest, Wd / 2, Hd * 0.7);
  });
  paintStairChevron(c, cue);
}
function paintBench(c) {
  const b = BENCH;
  box(c, b.x, b.y, 0, b.w, b.d, 0.74, '#6a4226', { t: '#8a5a34', l: '#5a381f', r: '#4a2e18' });
  paperStack(c, b.x + 0.15, b.y + 0.15, 0.74, 5);
  paperStack(c, b.x + 0.72, b.y + 0.22, 0.74, 3);
  box(c, b.x + b.w - 0.72, b.y + 0.28, 0.74, 0.5, 0.38, 0.06, '#1d4e86', { ol: false });
  carton(c, b.x + 1.3, b.y + 0.2, 0.74, 0.42, 0.38, 0.3);
}
function drawWarehouseFloor(c) {
  for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) {
    const n = hsh(x + 20, y + 3);
    const col = shade('#8d8b86', 0.9 + n * 0.16);
    const a = P(x, y), b = P(x + 1, y), dpt = P(x, y + 1);
    const g = c.createLinearGradient(a[0], a[1], b[0], dpt[1]);
    g.addColorStop(0, shade(col, 1.06)); g.addColorStop(1, shade(col, 0.9));
    poly(c, [a, b, P(x + 1, y + 1), dpt], g);
    seg(c, a, b, 'rgba(40,40,38,.22)'); seg(c, a, dpt, 'rgba(255,255,255,.08)');
    for (let k = 0; k < 3; k++) {
      const p = P(x + 0.08 + hsh(x * 3 + k, y + 9) * 0.84, y + 0.08 + hsh(x, y * 4 + k) * 0.84);
      c.fillStyle = k % 2 ? 'rgba(40,40,40,.16)' : 'rgba(255,255,255,.13)';
      c.beginPath(); c.arc(p[0], p[1], 0.22, 0, Math.PI * 2); c.fill();
    }
  }
  poly(c, [P(0.35, 1.7), P(GX - 0.35, 1.7), P(GX - 0.35, 1.88), P(0.35, 1.88)], '#e0b43a');
  poly(c, [P(0.35, 1.92), P(GX - 0.35, 1.92), P(GX - 0.35, 2.04), P(0.35, 2.04)], '#2a2a28');
  poly(c, [P(8.55, 3.15), P(8.78, 3.15), P(8.78, 10.55), P(8.55, 10.55)], '#e0b43a');
  poly(c, [P(13.15, 3.15), P(13.38, 3.15), P(13.38, 10.55), P(13.15, 10.55)], '#e0b43a');
  poly(c, [P(ST.x0 - 0.2, ST.y0 - 0.4), P(ST.x1 + 0.2, ST.y0 - 0.4), P(ST.x1 + 0.2, ST.y1 + 0.18), P(ST.x0 - 0.2, ST.y1 + 0.18)], '#6a6660');
}
function drawWarehouseShell(c) {
  const far = [[0, 0], [GX, 0], [GX, GY], [0, GY]][facing];
  box(c, far[0] < 1 ? -0.4 : GX, far[1] < 1 ? -0.4 : GY, 0, 0.4, 0.4, WALL, '#3b2a1c', { ol: false });
  if (isFar('W')) {
    const lip = lipColors('+x', '#d2c2a6');
    box(c, -0.4, 0, 0, 0.4, GY, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    blockWallX(c, 0, 0, GY);
    windowX(c, 0, 4.1, 7.2, 1.25, 2.55);
    windowX(c, 0, 11.1, 13.7, 1.25, 2.45);
  } else floorLipX(c, 0, 0, GY, -0.45, 0, '#3c3b38', '#8a8680');
  if (isFar('N')) {
    const lip = lipColors('+y', '#c4b49a');
    box(c, 0, -0.4, 0, GX, 0.4, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    blockWallY(c, 0, 0, GX);
    bayDoorY(c, 0, 1.1);
    bayDoorY(c, 0, 6.5);
    bayDoorY(c, 0, 14.55);
    windowY(c, 0, 11.05, 13.45, 1.3, 2.5);
  } else floorLipY(c, 0, 0, GX, -0.45, 0, '#4b4a47', '#8a8680');
  if (isFar('E')) {
    const lip = lipColors('-x', '#d2c2a6');
    box(c, GX, 0, 0, 0.4, GY, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    blockWallX(c, GX, 0, GY);
    windowX(c, GX, 3.3, 6.5, 1.25, 2.55);
    windowX(c, GX, 10.3, 13.3, 1.25, 2.45);
  } else floorLipX(c, GX, 0, GY, -0.45, 0, '#3c3b38', '#8a8680');
  if (isFar('S')) {
    const lip = lipColors('-y', '#c4b49a');
    box(c, 0, GY, 0, GX, 0.4, WALL, '#2f2216', { r: lip.r, l: lip.l, ol: false });
    blockWallY(c, GY, 0, GX);
    windowY(c, GY, 1.05, 3.55, 1.25, 2.45);
    boardY(c, GY, 6.15, 12.55, 0.32, 2.9, '#1c2830');
    windowY(c, GY, 15.1, 18.5, 1.25, 2.45);
  } else floorLipY(c, GY, 0, GX, -0.45, 0, '#4b4a47', '#8a8680');
}
function drawWarehouseProps(c) {
  const props = [];
  const add = (x, y, fn, bias = 0) => { const [u, v] = toView(x, y); props.push({ k: u + v + bias, fn }); };
  for (const [x, y, w] of RACKS) add(x + w / 2, y + 0.4, cc => rack(cc, x, y, w), 0.25);
  for (const [x, y, n] of PALLETS) add(x + 0.7, y + 0.55, cc => pallet(cc, x, y, n), 0.15);
  add(20.55, 8.35, cc => { carton(cc, 20.25, 7.95, 0, 0.7, 0.58, 0.5); carton(cc, 20.35, 8.05, 0.5, 0.52, 0.42, 0.38); });
  add(0.75, 8.15, cc => { carton(cc, 0.35, 7.85, 0, 0.62, 0.52, 0.46); carton(cc, 0.42, 8.45, 0, 0.55, 0.48, 0.4); });
  add(BENCH.x + BENCH.w / 2, BENCH.y + BENCH.d / 2, cc => paintBench(cc), 0.2);
  add(12.45, 11.35, cc => { ream(cc, 12.15, 11.1, 0, 0.7, 0.5, '#3d7ec4'); ream(cc, 12.22, 11.16, 0.27, 0.7, 0.5, '#c45438'); ream(cc, 12.28, 11.22, 0.54, 0.7, 0.5, '#3d7ec4'); });
  for (const s of stairSteps(true)) add(s.x + s.w / 2, s.y + s.d / 2, cc => paintStep(cc, s), 0.4);
  add((ST.x0 + ST.x1) / 2, ST.y0 - 0.15, cc => { paintStairRails(cc); paintStairSign(cc, true); }, 0.15);
  add(11.7, 0.7, cc => {
    box(cc, 11.4, 0.35, 0, 0.62, 0.72, 0.08, '#2c2c2c', { ol: false });
    box(cc, 11.5, 0.82, 0, 0.1, 0.1, 1.15, '#3a3a3a', { ol: false });
    box(cc, 11.88, 0.82, 0, 0.1, 0.1, 1.15, '#3a3a3a', { ol: false });
    carton(cc, 11.38, 0.4, 0.08, 0.58, 0.5, 0.4);
  }, 0.05);
  props.sort((a, b) => a.k - b.k);
  for (const p of props) p.fn(c);
}
function drawWarehouseBase(c) {
  drawWarehouseFloor(c);
  for (const [x, y, n] of PALLETS) shadow(c, x, y, 1.4, 1.1, 0.45 + n * 0.08, 0);
  for (const [x, y, w] of RACKS) shadow(c, x, y, w, 0.85, 1.5, 0);
  shadow(c, BENCH.x, BENCH.y, BENCH.w, BENCH.d, 0.74, 0);
  shadow(c, ST.x0, ST.y0, ST.x1 - ST.x0, ST.y1 - ST.y0, 0.7, 0);
  drawWarehouseShell(c);
  drawWarehouseProps(c);
}
const WH_LIGHTS = [[4.2, 5.4, 96, 0.16], [11, 6.8, 110, 0.18], [17.4, 5.4, 96, 0.16], [4.6, 12.6, 84, 0.14], [16.8, 12.8, 90, 0.15], [10.8, 13.5, 72, 0.13], [11.2, 1.2, 70, 0.1]];

// ---------- scene objects (depth sorted) ----------
function sceneItems(t) {
  if (floor === 'warehouse') return [];
  const it = [];
  const add = (x, y, fn, bias = 0) => { const [u, v] = toView(x, y); it.push({ k: u + v + bias, fn }); };
  // glass + low walls
  const refl = (q) => { // q = [TL, TR, BR, BL] of a glass pane: two diagonal light streaks
    const L = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    for (const [f, w, a] of [[0.15, 0.12, 0.22], [0.4, 0.05, 0.16]]) poly(c0, [L(q[3], q[2], f), L(q[3], q[2], f + w), L(q[0], q[1], f + w + 0.3), L(q[0], q[1], f + 0.3)], `rgba(255,255,255,${a})`);
  };
  let c0 = null;
  const glassY = (y, x0, x1, z0 = 0.35, z1 = 2.6) => add((x0 + x1) / 2, y, c => { c0 = c;
    box(c, x0, y - 0.06, 0, x1 - x0, 0.12, z0, '#6b4a2e');
    const q = quadY(y, x0, x1, z0, z1);
    const gg = c.createLinearGradient(q[0][0], q[0][1], q[3][0], q[3][1]);
    gg.addColorStop(0, 'rgba(214,238,248,.32)'); gg.addColorStop(0.45, 'rgba(150,205,228,.14)'); gg.addColorStop(1, 'rgba(186,214,224,.24)');
    poly(c, q, gg); refl(q);
    for (let x = x0; x <= x1 + 0.001; x += 1.5) poly(c, quadY(y, Math.min(x, x1) - 0.03, Math.min(x, x1) + 0.03, z0, z1), '#56646e');
    poly(c, quadY(y, x0, x1, z1 - 0.06, z1), '#56646e'); seg(c, P(x0, y, z1), P(x1, y, z1), 'rgba(255,255,255,.4)');
  }, 0.02);
  const glassX = (x, y0, y1, z0 = 0.35, z1 = 2.6) => add(x, (y0 + y1) / 2, c => { c0 = c;
    box(c, x - 0.06, y0, 0, 0.12, y1 - y0, z0, '#6b4a2e');
    const q = quadX(x, y0, y1, z0, z1);
    const gg = c.createLinearGradient(q[0][0], q[0][1], q[2][0], q[2][1]);
    gg.addColorStop(0, 'rgba(214,238,248,.30)'); gg.addColorStop(0.5, 'rgba(150,205,228,.13)'); gg.addColorStop(1, 'rgba(186,214,224,.22)');
    poly(c, q, gg); refl(q);
    for (let y = y0; y <= y1 + 0.001; y += 1.5) poly(c, quadX(x, Math.min(y, y1) - 0.03, Math.min(y, y1) + 0.03, z0, z1), '#56646e');
    poly(c, quadX(x, y0, y1, z1 - 0.06, z1), '#56646e'); seg(c, P(x, y0, z1), P(x, y1, z1), 'rgba(255,255,255,.4)');
  }, -0.3);
  // conference room: side glass + front glass with a door gap
  for (const [a, b] of [[0, 1.4], [1.4, 2.8], [2.8, 4.15], [4.15, 5.5]]) glassX(CONF.x0, a, b);
  glassY(CONF.y1, 7.5, 8.9); glassY(CONF.y1, 8.9, 10.3); glassY(CONF.y1, 11.3, 12.65); glassY(CONF.y1, 12.65, 14);
  // manager office: side glass (door gap) + low front wall
  for (const [a, b] of [[0, 1.4], [1.4, 2.8], [2.8, 3.6]]) glassX(MGR.x0, a, b);
  glassX(MGR.x0, 4.8, 5.5);
  // Knee wall is behind the trainer. A low sort bias keeps it from painting over the shirts.
  for (let x = MGR.x0; x < GX; x += 1) add(x + 0.5, MGR.y1, c => box(c, x, MGR.y1 - 0.08, 0, 1, 0.16, 0.55, '#6b4a2e', { t: '#8a6440' }), -6);
  // conference table + chairs
  add(10.8, 2.75, c => {
    box(c, 9.1, 2.1, 0, 0.12, 0.12, 0.55, '#3a2416'); box(c, 12.4, 3.3, 0, 0.12, 0.12, 0.55, '#3a2416');
    box(c, 8.9, 1.95, 0.55, 3.8, 1.6, 0.12, '#6a3e22', { t: '#7d4a2a' });
    for (let i = 1; i < 4; i++) seg(c, P(9.0, 1.95 + i * 0.4, 0.67), P(12.6, 1.95 + i * 0.4, 0.67), 'rgba(60,30,12,.3)');
    box(c, 10.6, 2.6, 0.67, 0.4, 0.3, 0.1, '#222'); // speakerphone
    paperStack(c, 9.3, 2.9, 0.67, 2);
  });
  for (const x of [9.2, 10.4, 11.6]) {
    add(x, 1.3, c => { box(c, x, 1.15, 0.42, 0.5, 0.1, 0.55, '#2f4a8a', { l: '#2a4078', r: '#223463' }); chair(c, x, 1.25, '#3a5aa8'); }, -0.5);
    add(x, 4.1, c => { chair(c, x, 3.65, '#3a5aa8'); box(c, x, 4.1, 0.42, 0.5, 0.1, 0.55, '#2f4a8a', { l: '#2a4078', r: '#223463' }); }, 0.3);
  }
  // kitchen: copier, water cooler
  add(14.6, 0.7, c => { box(c, 14.2, 0.25, 0, 0.9, 0.7, 0.85, '#d6d6d0', { l: '#bdbdb6', r: '#a3a39c' }); box(c, 14.3, 0.3, 0.85, 0.7, 0.5, 0.08, '#8a8a84'); const px = showPosX() ? 15.101 : 14.198; poly(c, quadX(px, 0.35, 0.85, 0.5, 0.7), '#7ad07a'); });
  add(15.5, 0.7, c => cooler(c, 15.35, 0.3));
  // manager office furniture
  add(20.3, 0.3, c => { box(c, 19.6, 0.05, 0, 1.6, 0.45, 1.9, '#5a3820', { t: '#6e4628' }); if (showPosY()) { poly(c, quadY(0.501, 19.68, 21.12, 0.08, 1.82), '#2e1c0e'); for (let z = 0.12; z < 1.8; z += 0.43) { box(c, 19.62, 0.06, z - 0.05, 1.56, 0.44, 0.05, '#6e4628', { ol: false }); for (let k = 0; k < 7; k++) { const hh = 0.26 + hsh(k, z * 10 | 0) * 0.1; box(c, 19.7 + k * 0.205, 0.2, z, 0.17, 0.26, hh, ['#a33', '#36a', '#3a6', '#c93', '#639', '#933', '#2a6a6a'][(k + (z * 10 | 0)) % 7], { ol: false }); } } } });
  add(21.3, 4.4, c => { box(c, 20.9, 4.0, 0, 0.9, 0.7, 0.6, '#6a3e22'); paperStack(c, 21.1, 4.2, 0.6, 3); });
  // plants + cabinets
  for (const [x, y] of PLANTS) add(x, y, c => plant(c, x, y, 1.2), 0.45);
  for (const y of [13.3, 13.95]) add(0.35, y, c => cabinet(c, 0.05, y, 'e'), 0.3);
  for (const y of [6.15, 6.9]) add(21.22, y, c => cabinet(c, 21.22, y, 'w'), 0.3);
  add(21.35, 10.15, c => cooler(c, 21.35, 10.15), 0.4);
  for (const x of [0.35, 1.15]) add(x, 15.28, c => cabinet(c, x, 15.28, 'n'), 0.3);
  for (const x of [12.5, 13.85, 19.35, 20.55]) add(x, 15.18, c => cabinet(c, x, 15.18, 'n'), 0.3);
  // design trainer (free-standing cork board). Raised so the shirts clear the knee wall, sorted in front of it.
  add(17.75, 6.55, c => {
    const yCork = showPosY() ? 6.581 : 6.399;
    const yShirt = showPosY() ? 6.582 : 6.398;
    const yPin = showPosY() ? 6.583 : 6.397;
    box(c, 15.4, 6.55, 0, 0.12, 0.12, 2.62, '#5a3820'); box(c, 20.0, 6.55, 0, 0.12, 0.12, 2.62, '#5a3820');
    box(c, 15.8, 6.65, 0, 3.9, 0.45, 0.62, '#6a4226');
    box(c, 15.3, 6.4, 1.08, 4.9, 0.18, 1.52, '#4a2e1a', { l: '#5c3a20' });
    poly(c, quadY(yCork, 15.4, 20.1, 1.18, 2.52), '#c8a071');
    for (let k = 0; k < 40; k++) { const p = P(15.5 + hsh(k, 1) * 4.5, yCork, 1.26 + hsh(1, k) * 1.15); c.fillStyle = 'rgba(120,80,40,.35)'; c.fillRect(p[0], p[1], 1, 1); }
    const cols = ['#efe3c8', '#24324f', '#efe3c8'];
    for (let i = 0; i < 3; i++) {
      const x0 = 15.6 + i * 1.5;
      poly(c, quadY(yShirt, x0, x0 + 1.3, 1.28, 2.38), '#fbf6ea');
      const img = deckImgs[i];
      const plane = facePlane(PLANE_Y(x0 + 0.08, yPin, 2.32), 1.14);
      if (img && img.complete && img.naturalWidth) inPlane(c, 1, plane, 100, cc => cc.drawImage(img, 0, 0, 114, 100));
      else inPlane(c, 1, plane, 10, cc => { // pixel tee
        const tee = () => { cc.beginPath(); cc.moveTo(3.6, 0.4); cc.lineTo(8, 0.4); cc.lineTo(11.4, 2.6); cc.lineTo(10, 4.6); cc.lineTo(8.8, 3.8); cc.lineTo(8.8, 10.4); cc.lineTo(2.8, 10.4); cc.lineTo(2.8, 3.8); cc.lineTo(1.6, 4.6); cc.lineTo(0.2, 2.6); cc.closePath(); };
        cc.fillStyle = 'rgba(40,20,5,.35)'; cc.save(); cc.translate(0.5, 0.4); tee(); cc.fill(); cc.restore();
        cc.fillStyle = cols[i]; tee(); cc.fill(); cc.strokeStyle = '#2a1c10'; cc.lineWidth = 0.5; cc.stroke();
        cc.fillStyle = 'rgba(0,0,0,.12)'; cc.fillRect(7.6, 3.8, 1.2, 6.6);
        cc.fillStyle = shade(cols[i], 0.8); cc.beginPath(); cc.ellipse(5.8, 0.6, 1.4, 0.8, 0, 0, Math.PI); cc.fill();
        const ink = i === 1 ? '#efe3c8' : '#24324f'; cc.fillStyle = ink; cc.beginPath(); cc.arc(5.8, 5.2, 1.5, 0, Math.PI * 2); cc.fill();
        cc.fillStyle = i === 1 ? '#24324f' : '#efe3c8'; cc.fillRect(5.5, 4.4, 0.6, 1.6); cc.fillRect(5.0, 4.9, 1.6, 0.5);
        cc.fillStyle = ink; cc.fillRect(4.0, 7.2, 3.6, 0.5); cc.fillRect(4.5, 8.0, 2.6, 0.4);
      });
      { const p = P(x0 + 0.65, yPin, 2.4); c.fillStyle = '#d33'; c.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    }
  }, 3);
  // stairs down to the warehouse. Every tread sits on this floor, so nothing from downstairs can poke through.
  for (const s of stairSteps(false)) add(s.x + s.w * 0.5, (ST.y0 + ST.y1) / 2, c => paintStep(c, s), 0.45);
  add((ST.x0 + ST.x1) / 2, ST.y0 - 0.15, c => { paintStairRails(c); paintStairSign(c, false); }, 0.15);
  // desks + workers
  for (const p of people) {
    const d = p.d;
    add(p.seat[0], p.seat[1], c => drawWorker(c, p, t));
    add(d.x + d.w / 2, d.y + d.d / 2, c => deskDraw(c, p, t), 0.2);
  }
  return it.sort((a, b) => a.k - b.k);
}
let sel = null;          // selected station id
function drawWorker(c, p, t) {
  const [sx, sy] = P(p.seat[0], p.seat[1], SEATZ), st = stateOf(p.s.id), busy = st === 'active';
  const S = CREW_SC, top = sy + CREW_HIT.y * S;
  const seeFront = facesCamera(p.d.away ? -1 : 1);
  // contact shadow, then a soft gold ring while hovered or selected
  c.save();
  c.fillStyle = 'rgba(48,26,10,.2)';
  c.beginPath(); c.ellipse(sx + 1, sy + 0.6, 7.2, 3.1, 0.12, 0, Math.PI * 2); c.fill();
  c.restore();
  if (p.glow > 0.03) {
    c.save();
    c.globalAlpha = 0.85 * p.glow;
    const hg = c.createRadialGradient(sx, sy - 1, 1, sx, sy, 13);
    hg.addColorStop(0, 'rgba(255,214,96,.0)');
    hg.addColorStop(0.55, 'rgba(255,206,70,.85)');
    hg.addColorStop(1, 'rgba(255,206,70,0)');
    c.fillStyle = hg;
    c.beginPath(); c.ellipse(sx, sy + 0.4, 9 + p.glow * 1.5, 4.4, 0.1, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  if (busy) {
    const pulse = 0.28 + 0.1 * Math.sin(t * 2.5);
    const gr = c.createRadialGradient(sx, sy - 16, 1, sx, sy - 10, 18);
    gr.addColorStop(0, `rgba(120,230,100,${pulse})`); gr.addColorStop(1, 'rgba(120,230,100,0)');
    c.fillStyle = gr; c.beginPath(); c.ellipse(sx, (top + sy) / 2, 14, 16, 0, 0, Math.PI * 2); c.fill();
  }
  const breath = Math.sin(t * 1.7 + p.phase);
  const bob = (busy ? Math.max(0, Math.sin(t * 7.2 + p.phase)) * 0.7 : 0) + breath * 0.28;
  c.save();
  c.translate(sx, sy);
  c.scale(S * (1 + breath * 0.012), S * (1 + breath * 0.022));
  paintCrew(c, p.s.id, 0, 0, { back: !seeFront, blink: p.blinkAt - t < 0.11, bob });
  c.restore();
  if (st === 'blocked') {
    c.fillStyle = '#e8432f'; c.beginPath(); c.arc(sx + 7, top + 8, 2.3, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.font = `700 2.6px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('!', sx + 7, top + 8.2);
    c.textAlign = 'left';
  } else if (!busy) {
    const f = (t * 0.55 + p.phase) % 2.6;
    const alpha = Math.sin(Math.min(f / 2.6, 1) * Math.PI);
    c.save();
    c.globalAlpha = 0.35 + 0.6 * alpha;
    c.fillStyle = '#f7f1e4';
    c.font = `700 3.3px ${FONT}`;
    c.fillText('z', sx + 7 + f * 0.6, top - 1 - f * 2.4);
    c.font = `700 2.4px ${FONT}`;
    c.fillText('z', sx + 10 + f * 0.4, top - 4.5 - f * 2.2);
    c.restore();
  }
  if (sel === p.s.id) {
    const y = top - 4 + Math.sin(t * 4.2) * 1.1;
    c.fillStyle = '#ffd23a';
    c.beginPath();
    c.moveTo(sx, y + 4.2); c.lineTo(sx - 3.1, y); c.lineTo(sx + 3.1, y); c.closePath(); c.fill();
    c.strokeStyle = '#24170d'; c.lineWidth = 0.45; c.stroke();
  }
  if (collectHits) addWorkerHits(p, sx, sy);
}

// ---------- text pass (crisp) ----------
function ctTime(d = new Date()) {
  const tm = d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const dt = d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' });
  const h = +d.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false });
  const m = +d.toLocaleString('en-US', { timeZone: 'America/Chicago', minute: 'numeric' });
  return { tm, dt, h: h % 24, m };
}
function fitText(c, s, w) { s = noLig(noDash(s)); if (c.measureText(s).width <= w) return s; while (s.length > 1 && c.measureText(s + '..').width > w) s = s.slice(0, -1); return s + '..'; }
// Shrink the font until the whole string fits. Headers stay complete words, never "IN PROGRE..".
function fontFit(c, s, w, maxPx, minPx) {
  s = noLig(noDash(s));
  let px = maxPx;
  c.font = `700 ${px}px ${FONT}`;
  while (px > minPx && c.measureText(s).width > w) { px = Math.round((px - 0.5) * 10) / 10; c.font = `700 ${px}px ${FONT}`; }
  return s;
}
function warehouseText(c, S) {
  if (isFar('N')) {
    for (const [x, label] of [[1.1, 'BAY 1'], [6.5, 'BAY 2'], [14.55, 'BAY 3']]) {
      inPlane(c, S, facePlane(PLANE_Y(x + 0.45, 0.02, 2.5), 1.6), 26, cc => {
        cc.textBaseline = 'middle'; cc.textAlign = 'center'; cc.fillStyle = '#f6edd4'; cc.font = `700 11px ${FONT}`; cc.fillText(label, 20, 8);
      });
    }
  }
  if (isFar('S')) paintOnpadBoard(c, S);
  const yB = showPosY() ? BENCH.y + BENCH.d : BENCH.y;
  inPlane(c, S, facePlane(PLANE_Y(BENCH.x + 0.12, yB, 0.68), 2.2), 32, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#f7f1e4'; cc.font = `700 10px ${FONT}`; cc.fillText('STOCK DESK', 2, 8);
  });
}
// South-wall screen. The live OnPad iframe sits on this same quad (see syncOnpadFrame).
function paintOnpadBoard(c, S) {
  const x0 = 6.5, x1 = 12.2, zTop = 2.74, y = GY - 0.02;
  const span = x1 - x0, height = 2.28;
  inPlane(c, S, planeUpright(PLANE_Y(x0, y, zTop), span, height), 40, cc => {
    const Wd = span * 40, Hd = height * 40;
    cc.textBaseline = 'middle';
    cc.fillStyle = '#f2b33d'; cc.fillRect(0, 0, Wd, 18);
    cc.fillStyle = '#16120e'; cc.font = `700 13px ${FONT}`; cc.fillText('ONPAD', 8, 9);
    cc.textAlign = 'right'; cc.fillText('JOBSITE MAP', Wd - 8, 9); cc.textAlign = 'left';
    cc.fillStyle = '#c5dcb0'; cc.fillRect(0, 18, Wd, Hd - 18);
    cc.strokeStyle = 'rgba(255,255,255,.9)'; cc.lineWidth = 4; cc.lineCap = 'round';
    cc.beginPath();
    cc.moveTo(0, 46); cc.lineTo(Wd, 62);
    cc.moveTo(36, 18); cc.lineTo(58, Hd);
    cc.moveTo(Wd * 0.62, 18); cc.lineTo(Wd * 0.46, Hd);
    cc.stroke();
    cc.strokeStyle = '#e6d7a8'; cc.lineWidth = 3;
    cc.beginPath(); cc.moveTo(0, Hd * 0.62); cc.lineTo(Wd, Hd * 0.5); cc.stroke();
    const pin = (px, py, col) => {
      cc.fillStyle = col; cc.beginPath(); cc.arc(px, py, 6, 0, Math.PI * 2); cc.fill();
      cc.fillStyle = '#fff'; cc.beginPath(); cc.arc(px, py, 2.2, 0, Math.PI * 2); cc.fill();
    };
    pin(Wd * 0.3, Hd * 0.46, '#e2533c');
    pin(Wd * 0.58, Hd * 0.6, '#2a6cb0');
    pin(Wd * 0.76, Hd * 0.4, '#e2533c');
    cc.fillStyle = '#1d140c'; cc.font = `700 11px ${FONT}`;
    cc.fillText('Tap to open', 8, Hd - 12);
  });
}
function textPass(t, which = 'all') {
  if (which === 'screen') { screenText(t); return; }
  const S = 1, c = ctx;
  if (floor === 'warehouse') { warehouseText(c, S); if (which === 'walls') return; screenText(t); return; }
  // Team Board: every business, two columns. Needs you stays in the chat tab and in each business panel.
  if (isFar('N')) inPlane(c, S, facePlane(PLANE_Y(7.7, 0.02, 2.96), 6.1), 36, cc => {
    const Wd = 6.1 * 36;
    cc.textBaseline = 'middle';
    cc.fillStyle = '#f2b33d'; cc.fillRect(2, 1, Wd - 4, 12);
    cc.fillStyle = '#16120e'; cc.font = `700 8px ${FONT}`;
    cc.fillText('TEAM BOARD', 6, 7);
    cc.textAlign = 'right'; cc.fillText(String(PROJECTS.length), Wd - 8, 7); cc.textAlign = 'left';
    const rows = Math.ceil(PROJECTS.length / 2), colW = (Wd - 10) / 2, rowH = 10;
    const pill = p => p.status === 'done' || p.status === 'active' ? 'LIVE' : p.status === 'waiting' ? 'REVIEW' : p.status === 'blocked' ? 'STUCK' : 'HOLD';
    const colr = p => p.status === 'done' || p.status === 'active' ? '#7dff78' : p.status === 'waiting' ? '#f0c14a' : p.status === 'blocked' ? '#ff8a72' : '#e7d7b0';
    PROJECTS.forEach((p, i) => {
      const col = i < rows ? 0 : 1, row = col ? i - rows : i;
      const x = 3 + col * (colW + 4), y = 16 + row * rowH;
      cc.fillStyle = '#f3ead2'; cc.fillRect(x, y, colW, rowH - 2);
      cc.fillStyle = colr(p); cc.fillRect(x, y, 3, rowH - 2);
      cc.fillStyle = '#1d1a16'; cc.font = `700 7px ${FONT}`;
      const tag = pill(p);
      const tagW = cc.measureText(tag).width + 4;
      cc.fillText(fitText(cc, p.title, colW - tagW - 10), x + 6, y + (rowH - 2) / 2);
      cc.fillStyle = '#5b3a22'; cc.textAlign = 'right'; cc.fillText(tag, x + colW - 3, y + (rowH - 2) / 2); cc.textAlign = 'left';
    });
  });
  // HQ status board (back wall, real counts)
  if (isFar('N')) inPlane(c, S, facePlane(PLANE_Y(3.12, 0.02, 2.6), 3.95), 40, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#f0c14a'; cc.font = `700 11px ${FONT}`; cc.fillText('PAPER TICKER', 6, 9);
    const shortSt = p => p.status === 'done' ? 'LIVE' : p.status === 'waiting' ? 'REVIEW' : p.status === 'active' ? 'LIVE' : p.status === 'blocked' ? 'STUCK' : 'HOLD';
    const rows = PROJECTS.slice(0, 3).map(p => [p.short || p.title, shortSt(p), p.status === 'done' || p.status === 'active' ? '#7dff78' : p.status === 'waiting' ? '#f0c14a' : '#e7d7b0']);
    rows.push(['Needs you', String(needsCount()), '#ff8a72']);
    cc.font = `700 10px ${FONT}`;
    rows.forEach(([k, v, col], i) => { const y = 22 + i * 11; cc.fillStyle = '#d9cbb0'; cc.fillText(fitText(cc, k, 100), 6, y); cc.fillStyle = col; cc.textAlign = 'right'; cc.fillText(v, 158, y); cc.textAlign = 'left'; });
  });
  // whiteboard (left wall, text runs toward the back corner): 3 short lines
  if (isFar('W')) inPlane(c, S, facePlane(PLANE_X(0.03, 8.28, 2.45), 3.5), 40, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#1d3f8f'; cc.font = `700 12px ${FONT}`; cc.fillText(fitText(cc, "Today's priorities", 130), 6, 9);
    cc.font = `700 10px ${FONT}`;
    const etsy = PROJECTS.find(p => p.id === 'etsy'), att = PROJECTS.find(p => p.id === 'att');
    const lines = [['All projects paused', '#222'], [etsy?.status === 'waiting' ? 'Etsy ID in review' : 'Etsy shop paused', '#a8601c'], [att?.due ? `AT&T due ${att.due}` : 'AT&T paused', '#a52a1c']];
    lines.forEach(([t, col], i) => { cc.fillStyle = col; cc.fillText('\u2022 ' + noLig(t), 6, 24 + i * 11); });
  });
  // wall clock (real CT time) above the whiteboard
  if (isFar('W')) inPlane(c, S, facePlane(PLANE_X(0.03, 10.0, 2.95), 1.1), 22, cc => {
    const { h, m } = ctTime(); const r = 10;
    cc.fillStyle = '#fff'; cc.strokeStyle = '#222'; cc.lineWidth = 2; cc.beginPath(); cc.arc(r + 2, r + 2, r, 0, Math.PI * 2); cc.fill(); cc.stroke();
    cc.lineWidth = 1.6; const hand = (a, len) => { cc.beginPath(); cc.moveTo(r + 2, r + 2); cc.lineTo(r + 2 + Math.sin(a) * len, r + 2 - Math.cos(a) * len); cc.stroke(); };
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, 5.5); cc.lineWidth = 1; hand(m / 60 * Math.PI * 2, 8);
  });
  // reception sign (front of the desk). Only while that face points at the camera.
  if (showPosX()) inPlane(c, S, facePlane(PLANE_X(3.11, 11.15, 0.58), 2.5), 40, cc => { cc.textBaseline = 'top'; cc.fillStyle = '#f3e3c0'; cc.font = `700 8px ${FONT}`; cc.fillText('DUNDER MIFFLIN', 4, 2); cc.font = `5px ${FONT}`; cc.fillText('RECEPTION', 4, 11); });
  // design trainer sign, above the shirts
  inPlane(c, S, facePlane(PLANE_Y(15.35, showPosY() ? 6.4 : 6.58, 2.74), 4.2), 40, cc => {
    cc.fillStyle = '#2a1c10'; cc.fillRect(0, 0, 168, 22);
    cc.textBaseline = 'top'; cc.fillStyle = '#ffd27a'; cc.font = `700 11px ${FONT}`; cc.fillText('DESIGN TRAINER', 6, 1);
    cc.fillStyle = '#f3e6c4'; cc.font = `700 8px ${FONT}`; cc.fillText('TAP TO TRAIN', 6, 12);
  });

  if (which === 'walls') return;
  screenText(t);
}
function screenText(t) {
  if (floor !== 'office') return;
  const c = ctx;
  // speech bubbles + selected name tag (screen aligned)
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  for (const b of bubbles) {
    const p = byId(b.id); if (!p) continue;
    const [X, Yseat] = projectCSS(p.seat[0], p.seat[1], SEATZ); const Y = Yseat + (CREW_HIT.y * CREW_SC - 3) * PS;
    const fs = Math.max(12, Math.min(16, 4.2 * PS)); c.font = `700 ${fs}px ${FONT}`;
    const txt = fitText(c, b.text, 220); if (!txt.trim()) continue;
    const w = c.measureText(txt).width + 16, h = fs + 12;
    const life = t - b.at;
    const a = Math.min(1, (b.until - t) * 2.2, life * 5); if (a <= 0) continue;
    const pop = Math.min(1, life * 7);
    const sca = 0.9 + 0.1 * (1 - Math.pow(1 - pop, 3));
    let bx = Math.round(X - w / 2), by = Math.round(Y - h);
    const overlaps = (r) => r && r.width > 0 && bx < r.right + 4 && bx + w > r.left - 4 && by < r.bottom + 4 && by + h > r.top - 4;
    const tl = $('#tl')?.getBoundingClientRect(), tr = $('#tr')?.getBoundingClientRect(), chat = $('#chat')?.getBoundingClientRect();
    if (overlaps(tl)) by = Math.round(tl.bottom + 6);
    if (overlaps(tr)) by = Math.max(by, Math.round(tr.bottom + 6));
    if (overlaps(chat)) bx = Math.round(chat.left - w - 8);
    bx = Math.max(8, Math.min(W - w - 8, bx)); by = Math.max(8, Math.min(H - h - 8, by));
    c.save();
    c.globalAlpha = a;
    c.translate(bx + w / 2, by + h / 2); c.scale(sca, sca); c.translate(-(bx + w / 2), -(by + h / 2));
    c.fillStyle = '#fffdf6'; c.strokeStyle = '#24170d'; c.lineWidth = 2; c.lineJoin = 'round';
    c.beginPath(); c.roundRect ? c.roundRect(bx, by, w, h, 6) : c.rect(bx, by, w, h); c.fill(); c.stroke();
    const tail = Math.max(bx + 10, Math.min(bx + w - 10, X));
    c.beginPath(); c.moveTo(tail - 5, by + h - 1); c.lineTo(tail, by + h + 6); c.lineTo(tail + 5, by + h - 1); c.closePath(); c.fill();
    c.fillStyle = '#24170d'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(txt, bx + w / 2, by + h / 2 + 1); c.textAlign = 'left';
    c.restore();
  }
  if (sel) {
    const p = byId(sel); if (p) {
      const [X, Y0] = projectCSS(p.seat[0], p.seat[1], SEATZ); const Y = Y0 + 6 * PS;
      c.font = `700 14px ${FONT}`; const s = `${p.s.name} \u00b7 ${p.s.bot}`, w = c.measureText(s).width + 14;
      c.fillStyle = 'rgba(36,23,13,.92)'; c.fillRect(X - w / 2, Y, w, 21); c.fillStyle = '#ffd27a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, X, Y + 11); c.textAlign = 'left';
    }
  }
}

// ---------- bubbles ----------
const bubbles = []; let nextBubble = 1.2;
function tickBubbles(t) {
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].until < t) bubbles.splice(i, 1);
  if (t > nextBubble && bubbles.length < 3) {
    const pool = people.filter(p => !bubbles.some(b => b.id === p.s.id));
    const act = pool.filter(p => stateOf(p.s.id) === 'active');
    const p = (act.length && Math.random() < 0.45 ? act : pool)[Math.floor(Math.random() * (Math.random() < 0.45 && act.length ? act.length : pool.length))] || pool[0];
    if (p) bubbles.push({ id: p.s.id, text: bubbleLine(p.s.id), at: t, until: t + 4.8 });
    nextBubble = t + 2.2 + Math.random() * 1.8;
  }
}
function bubbleLine(id) {
  const st = stateOf(id), real = lineOf(id);
  if (st === 'active') return Math.random() < 0.6 ? 'On it!' : real;
  if (projectsOf(id).some(p => p.status === 'waiting')) return Math.random() < 0.55 ? 'Under review.' : real;
  return Math.random() < 0.4 ? 'Paused.' : real;
}
function say(id, text, secs = 5) { const t = now(); const i = bubbles.findIndex(b => b.id === id); if (i >= 0) bubbles.splice(i, 1); bubbles.push({ id, text, at: t, until: t + secs }); }

// ---------- hotspots ----------
// Each clickable is its real iso footprint (box faces, wall quad, or sprite rect).
// Hits carry a depth key (view-space u+v, plus a little height) and are tested front to back.
let hits = [];
let collectHits = true;
function anchorKey(x, y, z = 0) {
  const [u, v] = toView(x, y);
  return u + v + z * 0.02;
}
function sortHits() { hits.sort((a, b) => a.key - b.key); }
function pushPoly(kind, poly, key, extra) {
  if (!collectHits || !poly) return;
  hits.push(extra ? { kind, poly, key, ...extra } : { kind, poly, key });
}
function fromView(u, v) {
  switch (facing) {
    case 1: return [GX - v, u];
    case 2: return [GX - u, GY - v];
    case 3: return [v, GY - u];
    default: return [u, v];
  }
}
function addStairHits() {
  for (const s of stairSteps(floor === 'warehouse')) {
    const key = anchorKey(s.x + s.w / 2, s.y + s.d / 2, s.top);
    pushPoly('stairs', [P(s.x, s.y, s.top), P(s.x + s.w, s.y, s.top), P(s.x + s.w, s.y + s.d, s.top), P(s.x, s.y + s.d, s.top)], key);
    pushPoly('stairs', [P(s.x, s.y + s.d, s.top), P(s.x + s.w, s.y + s.d, s.top), P(s.x + s.w, s.y + s.d, 0), P(s.x, s.y + s.d, 0)], key);
    pushPoly('stairs', [P(s.x + s.w, s.y, s.top), P(s.x + s.w, s.y + s.d, s.top), P(s.x + s.w, s.y + s.d, 0), P(s.x + s.w, s.y, 0)], key);
  }
  const s = stairSignBox();
  pushPoly('stairs', quadY(s.ySign, s.x0, s.x1, s.z0, s.z1), anchorKey((s.x0 + s.x1) / 2, s.ySign, 1.75));
}
function addStockHits() {
  for (const [x, y, w] of RACKS) {
    const key = anchorKey(x + w / 2, y + 0.4, 1.2);
    pushPoly('warehouse', [P(x, y, 2.05), P(x + w, y, 2.05), P(x + w, y + 0.8, 2.05), P(x, y + 0.8, 2.05)], key);
    const yF = showPosY() ? y + 0.8 : y;
    pushPoly('warehouse', quadY(yF, x, x + w, 0.1, 2.0), key);
  }
  for (const [x, y, n] of PALLETS) {
    const zt = 0.16 + n * 0.28;
    pushPoly('warehouse', [P(x, y, zt), P(x + 1.4, y, zt), P(x + 1.4, y + 1.1, zt), P(x, y + 1.1, zt)], anchorKey(x + 0.7, y + 0.55, zt));
  }
  const b = BENCH, bh = 0.74;
  const key = anchorKey(b.x + b.w / 2, b.y + b.d / 2, bh);
  pushPoly('warehouse', [P(b.x, b.y, bh), P(b.x + b.w, b.y, bh), P(b.x + b.w, b.y + b.d, bh), P(b.x, b.y + b.d, bh)], key);
  if (isFar('N')) {
    for (const x0 of [1.1, 6.5, 14.55]) pushPoly('warehouse', quadY(0.01, x0, x0 + 2.5, 0.1, 2.2), anchorKey(x0 + 1.25, 0, 1.1));
  }
  if (isFar('S')) pushPoly('onpadmap', quadY(GY, 6.15, 12.55, 0.32, 2.9), anchorKey(9.35, GY, 1.6));
}
function deskTop(d) { return d.reception ? 0.89 : 0.62; }
function addDeskHits(p) {
  const d = p.d, h = deskTop(d), id = p.s.id;
  const key = anchorKey(d.x + d.w / 2, d.y + d.d / 2, h);
  const corner = (su, sv, z) => { const [wx, wy] = boxCorner(d.x, d.y, d.w, d.d, su, sv); return P(wx, wy, z); };
  pushPoly('worker', [corner(0, 0, h), corner(1, 0, h), corner(1, 1, h), corner(0, 1, h)], key, { id });
  pushPoly('worker', [corner(0, 1, h), corner(1, 1, h), corner(1, 1, 0), corner(0, 1, 0)], key, { id });
  pushPoly('worker', [corner(1, 0, h), corner(1, 1, h), corner(1, 1, 0), corner(1, 0, 0)], key, { id });
}
function addWorkerHits(p, sx, sy) {
  const S = CREW_SC;
  hits.push({ kind: 'worker', id: p.s.id, key: anchorKey(p.seat[0], p.seat[1], 1.4), r: [sx + CREW_HIT.x * S, sy + CREW_HIT.y * S, CREW_HIT.w * S, CREW_HIT.h * S] });
  addDeskHits(p);
}
function staticHits() {
  if (!collectHits) return;
  addStairHits();
  if (floor === 'warehouse') { addStockHits(); return; }
  if (isFar('N')) {
    pushPoly('board', quadY(0, 7.55, 13.95, 0.38, 3.08), anchorKey(10.75, 0, 1.73));
    pushPoly('status', quadY(0, 3.0, 7.2, 0.95, 2.7), anchorKey(5.1, 0, 1.8));
  }
  if (isFar('W')) pushPoly('whiteboard', quadX(0, 4.6, 8.4, 0.95, 2.55), anchorKey(0, 6.5, 1.75));
  const yCork = showPosY() ? 6.581 : 6.399;
  const yShirt = showPosY() ? 6.582 : 6.398;
  const ySign = showPosY() ? 6.4 : 6.58;
  const yShelf = showPosY() ? 7.1 : 6.65;
  pushPoly('design', quadY(yCork, 15.3, 20.2, 1.15, 2.55), anchorKey(17.75, yCork, 1.85));
  pushPoly('design', quadY(yShirt, 15.6, 19.9, 1.28, 2.38), anchorKey(17.75, yShirt, 1.8));
  pushPoly('design', quadY(ySign, 15.35, 19.55, 2.19, 2.76), anchorKey(17.45, ySign, 2.47));
  pushPoly('design', [P(15.8, 6.65, 0.62), P(19.7, 6.65, 0.62), P(19.7, 7.1, 0.62), P(15.8, 7.1, 0.62)], anchorKey(17.75, 6.87, 0.62));
  pushPoly('design', quadY(yShelf, 15.8, 19.7, 0, 0.62), anchorKey(17.75, yShelf, 0.31));
}
function inPoly(x, y, pts) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function hitAt(cssX, cssY) {
  const [x, y] = cssToLeg(cssX, cssY);
  for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (h.r ? (x >= h.r[0] && x <= h.r[0] + h.r[2] && y >= h.r[1] && y <= h.r[1] + h.r[3]) : inPoly(x, y, h.poly)) return h; }
  return null;
}

// Glow and blink step once per frame, even while a crossfade paints the scene twice.
function stepActors(t) {
  for (const p of people) {
    const want = (hoverId === p.s.id || sel === p.s.id) ? 1 : 0;
    p.glow = (p.glow || 0) + (want - (p.glow || 0)) * Math.min(1, frameDt * 9);
    if (t > p.blinkAt) p.blinkAt = t + 2.3 + Math.random() * 3.6;
  }
}
function rotateView(dir) {
  if (rotAnim || floorAnim) return;
  const to = (facing + (dir > 0 ? 1 : 3)) % 4;
  try { localStorage.setItem('hq2d.facing', FACE_NAME[to]); } catch (e) {}
  rotAnim = { from: facing, to, t0: performance.now() };
  noteInput();
  ensureBase(floor, to);
}
function updateFloorBtn() {
  const btn = $('#floorBtn'); if (!btn) return;
  const here = floorAnim ? floorAnim.to : floor;
  const down = here === 'office';
  btn.textContent = down ? 'Down' : 'Up';
  const tip = down ? 'Go downstairs to the warehouse' : 'Go back upstairs to the office';
  btn.title = tip; btn.setAttribute('aria-label', tip);
}
function goFloor(to) {
  if (floorAnim || rotAnim) return;
  if (to !== 'office' && to !== 'warehouse') to = floor === 'office' ? 'warehouse' : 'office';
  if (to === floor) return;
  try { localStorage.setItem('hq2d.floor', to); } catch (e) {}
  ensureBase(to, facing);
  floorAnim = { from: floor, to, t0: performance.now() };
  wish.px = 0; wish.py = 0; wish.zoom = 1;
  noteInput();
  updateFloorBtn();
}
function setFloor(name) {
  if (name !== 'office' && name !== 'warehouse') return;
  floorAnim = null;
  floor = name;
  try { localStorage.setItem('hq2d.floor', name); } catch (e) {}
  wish.px = wish.py = 0; wish.zoom = 1;
  cam.px = cam.py = 0; cam.zoom = 1;
  updateFloorBtn();
  noteInput();
}
function setFacing(name) {
  const idx = typeof name === 'number' ? name : FACE_NAME.indexOf(name);
  if (idx < 0 || idx > 3) return;
  facing = idx;
  rotAnim = null;
  try { localStorage.setItem('hq2d.facing', FACE_NAME[idx]); } catch (e) {}
  noteInput();
}
function paintGeom(c, f, alpha, collect, t, fl = floor) {
  const prevF = facing, prevFl = floor;
  facing = f;
  floor = fl;
  ensureBase(fl, f);
  const box = baseBox[fl][f];
  c.save();
  c.globalAlpha = alpha;
  camTransform(c);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (box) c.drawImage(baseCvs[fl][f], box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  collectHits = !!collect;
  if (collectHits) hits = [];
  staticHits();
  for (const it of sceneItems(t)) it.fn(c);
  if (collectHits) sortHits();
  lights(c);
  c.restore();
  facing = prevF;
  floor = prevFl;
}

// ---------- render loop ----------
const T0 = performance.now(); const now = () => (performance.now() - T0) / 1000;
let lastFrame = 0, vig = null, rafOn = false;
function frame(ts) {
  if (document.hidden) { rafOn = false; return; }
  const tNow = now();
  const fading = bubbles.some(b => tNow - b.at < 0.45 && b.until > tNow);
  const idle = !camMoving() && ptrs.size === 0 && !hoverId && performance.now() - lastInput > 12000 && !fading;
  if (ts - lastFrame < (idle ? 50 : 0)) { requestAnimationFrame(frame); return; }
  frameDt = Math.min(0.05, lastFrame ? (ts - lastFrame) / 1000 : 0.016);
  lastFrame = ts;
  pollPad(frameDt);
  stepCam(frameDt);
  const t = now();
  stepActors(t);
  let blend = null, floorBlend = null;
  if (rotAnim) {
    const p = Math.min(1, (performance.now() - rotAnim.t0) / ROT_MS);
    const e = easeIO(p);
    if (e >= 0.5) facing = rotAnim.to;
    if (p < 1) blend = { from: rotAnim.from, to: rotAnim.to, e };
    else { facing = rotAnim.to; rotAnim = null; }
  }
  if (floorAnim) {
    const p = Math.min(1, (performance.now() - floorAnim.t0) / FLOOR_MS);
    const e = easeIO(p);
    if (e >= 0.5) floor = floorAnim.to;
    if (p < 1) floorBlend = { from: floorAnim.from, to: floorAnim.to, e };
    else { floor = floorAnim.to; floorAnim = null; updateFloorBtn(); }
  }
  const c = ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.fillStyle = '#1a1410'; c.fillRect(0, 0, cv.width, cv.height);
  if (floorBlend) {
    paintGeom(c, facing, 1 - floorBlend.e, floorBlend.e < 0.5, t, floorBlend.from);
    paintGeom(c, facing, floorBlend.e, floorBlend.e >= 0.5, t, floorBlend.to);
  } else if (blend) {
    paintGeom(c, blend.from, 1, blend.e < 0.5, t);
    paintGeom(c, blend.to, blend.e, blend.e >= 0.5, t);
  } else paintGeom(c, facing, 1, true, t);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'multiply'; c.fillStyle = '#fff6e6'; c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'source-over';
  if (!vig || vig.w !== cv.width || vig.h !== cv.height) {
    const gr = c.createRadialGradient(cv.width / 2, cv.height * 0.46, Math.min(cv.width, cv.height) * 0.4, cv.width / 2, cv.height * 0.5, Math.max(cv.width, cv.height) * 0.78);
    gr.addColorStop(0, 'rgba(20,10,2,0)'); gr.addColorStop(1, 'rgba(20,10,2,.26)');
    vig = { gr, w: cv.width, h: cv.height };
  }
  c.fillStyle = vig.gr; c.fillRect(0, 0, cv.width, cv.height);
  if (floor === 'office') tickBubbles(t);
  if (floorBlend) {
    const prevF = facing, prevFl = floor;
    c.save();
    floor = floorBlend.from; c.globalAlpha = 1 - floorBlend.e; textPass(t, 'walls');
    floor = floorBlend.to; c.globalAlpha = floorBlend.e; textPass(t, 'walls');
    c.restore();
    facing = prevF; floor = floorBlend.e >= 0.5 ? floorBlend.to : floorBlend.from;
    textPass(t, 'screen');
    floor = prevFl;
    const veil = Math.sin(Math.min(1, floorBlend.e) * Math.PI) * 0.28;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = veil; c.fillStyle = '#120c08'; c.fillRect(0, 0, cv.width, cv.height); c.restore();
  } else if (blend) {
    const prev = facing;
    c.save();
    facing = blend.from; c.globalAlpha = 1 - blend.e; textPass(t, 'walls');
    facing = blend.to; c.globalAlpha = blend.e; textPass(t, 'walls');
    c.restore();
    facing = prev;
    textPass(t, 'screen');
  } else textPass(t);
  syncOnpadFrame();
  requestAnimationFrame(frame);
}
function startLoop() { if (rafOn || document.hidden) return; rafOn = true; lastFrame = 0; requestAnimationFrame(frame); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });

// ---------- input: tap, drag-pan, pinch, wheel ----------
const ptrs = new Map(); let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); noteInput(); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, px: cam.px, py: cam.py, moved: false };
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.zoom, ang: Math.atan2(b.y - a.y, b.x - a.x), mode: null, turned: false };
    drag = null;
  } });
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) {
    if (e.pointerType === 'mouse') { const h = hitAt(e.clientX, e.clientY); hoverId = h && h.kind === 'worker' ? h.id : null; }
    return;
  }
  noteInput();
  const prev = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    let dAng = Math.atan2(b.y - a.y, b.x - a.x) - pinch.ang;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    const scale = d / pinch.d;
    if (!pinch.mode) {
      if (Math.abs(dAng) > 0.33 && Math.abs(scale - 1) < 0.12) pinch.mode = 'twist';
      else if (Math.abs(scale - 1) > 0.07) pinch.mode = 'pinch';
    }
    if (pinch.mode === 'twist') {
      if (!pinch.turned && dAng > 0.55) { pinch.turned = true; rotateView(-1); }
      else if (!pinch.turned && dAng < -0.55) { pinch.turned = true; rotateView(1); }
    } else if (pinch.mode === 'pinch') {
      const z0 = cam.zoom; cam.zoom = clampZ(pinch.z * scale); wish.zoom = cam.zoom;
      const k = cam.zoom / Math.max(0.05, z0); cam.px *= k; cam.py *= k; wish.px = cam.px; wish.py = cam.py; clampWish();
      cam.px = wish.px; cam.py = wish.py; cam.zoom = wish.zoom;
    }
  } else if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      wish.px = drag.px + dx; wish.py = drag.py + dy; clampWish();
      const dt = Math.max(0.008, (performance.now() - (prev.t || performance.now())) / 1000);
      velX = (wish.px - cam.px) / dt * 0.55 + velX * 0.45;
      velY = (wish.py - cam.py) / dt * 0.55 + velY * 0.45;
      cam.px = wish.px; cam.py = wish.py;
    }
  }
});
const endPtr = e => { const was = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); if (!was) return;
  if (drag && drag.moved && ptrs.size === 0) { wish.px = cam.px + Math.max(-900, Math.min(900, velX)) * 0.22; wish.py = cam.py + Math.max(-900, Math.min(900, velY)) * 0.22; clampWish(); velX = velY = 0; }
  if (drag && !drag.moved && e.type === 'pointerup') { e.preventDefault(); tap(e.clientX, e.clientY); }
  if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) { drag = null; if (e.pointerType !== 'mouse') hoverId = null; } };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); noteInput(); const z0 = wish.zoom; wish.zoom = clampZ(wish.zoom * (e.deltaY < 0 ? 1.08 : 0.925)); const k = wish.zoom / z0; wish.px *= k; wish.py *= k; cam.px = wish.px; cam.py = wish.py; clampWish(); }, { passive: false });
let lastTap = 0;
function tap(x, y) {
  const h = hitAt(x, y);
  if (!h) { if (performance.now() - lastTap < 350) { wish.zoom = 1; wish.px = 0; wish.py = 0; } lastTap = performance.now(); sel = null; hoverId = null; return; }
  openHit(h);
}
function openHit(h) {
  if (h.kind === 'onpadmap') { closeCard(); openOnpad(); return; }
  if (onpadOpen) closeOnpad();
  if (h.kind === 'worker') { sel = h.id; openWorker(h.id); }
  else if (h.kind === 'board' || h.kind === 'status' || h.kind === 'whiteboard') openProjects();
  else if (h.kind === 'design') openDesign();
  else if (h.kind === 'stairs') goFloor(floor === 'office' ? 'warehouse' : 'office');
  else if (h.kind === 'warehouse') openCard(`<h2>Warehouse</h2><div class="sub">Downstairs</div><p>Paper, pallets and the bay doors. The Design Trainer is the clothes board by Kelly's desk. Tap it to keep or skip designs. ${esc(PAUSE_NOTE)}</p><div class="btns"><button data-act="design">Design Trainer</button></div>`);
}

// ---------- modal cards ----------
const modal = $('#modal'), cardBody = $('#cardBody');
let openedAt = 0;
function openCard(html, wide) {
  if (onpadOpen) closeOnpad();
  $('#card').classList.toggle('wide', !!wide); cardBody.innerHTML = noDash(html); modal.classList.remove('hidden'); openedAt = performance.now();
}
function closeCard() { modal.classList.add('hidden'); }
$('#cardX').onclick = closeCard;
// A tap opens the card on pointerup. The same gesture then delivers a click, which lands on
// the dimmed backdrop when the desk is outside the card and would close it immediately.
modal.addEventListener('click', e => { if (e.target === modal && performance.now() - openedAt > 400) closeCard(); });
cardBody.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'design') openDesign();
  else if (a === 'needs') openNeeds();
  else if (a === 'projects') openProjects();
  else if (a === 'biz') openBusiness(b.dataset.id);
  else if (a === 'worker') { sel = b.dataset.id; openWorker(b.dataset.id); }
  else if (a === 'ask') { closeCard(); openChat(); chatTo.value = 'Grok Bot'; chatIn.value = b.dataset.text || ''; chatIn.focus(); }
});
const stTag = s => `<span class="st ${s}">${{ active: 'IN PROGRESS', blocked: 'STUCK', done: 'DONE, LIVE', waiting: 'UNDER REVIEW' }[s] || 'PAUSED'}</span>`;
function fmtAgo(ms) { const m = Math.round((Date.now() - ms) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; }
function openWorker(id) {
  const p = byId(id); if (!p) return; const s = p.s, st = stateOf(id), ps = projectsOf(id), b = busyOf(id), live = workFeed?.bots?.[id];
  say(id, lineOf(id));
  openCard(`<h2>${esc(s.name)}</h2><div class="sub">${esc(s.bot)} \u00b7 ${esc(s.job || '')} ${stTag(st)}</div>
    <p>${esc(s.role || '')}</p>
    ${b ? `<h3>ON IT NOW</h3><div class="item"><b>${esc(b)}</b></div>` : ''}
    <h3>PROJECTS</h3>${ps.length ? ps.map(pr => `<div class="item" data-act="biz" data-id="${esc(pr.id)}"><b>${esc(pr.title)} ${stTag(pr.status)}${pr.due ? `<span class="due">due ${esc(pr.due)}</span>` : ''}</b><small>${esc(pr.note)}</small></div>`).join('') : `<div class="item"><small>${esc(DESK_NOTE[id] || 'No project of its own right now.')}</small></div>`}
    ${live && (live.step || live.task) ? `<h3>LAST DESK UPDATE</h3><div class="item"><b>${esc(live.task || '')}</b><small>${esc(live.step || '')}${live.at ? ` \u00b7 ${fmtAgo(live.at)}` : ''}</small></div>` : ''}
    <div class="note">${esc(PAUSE_NOTE)}</div>
    <div class="btns"><button data-act="ask" data-text="About ${esc(first(s))} (${esc(s.bot)}): ">Ask Michael about this</button></div>`);
}
function openProjects() {
  const rows = PROJECTS.map(p => `<button type="button" class="biz" data-act="biz" data-id="${esc(p.id)}"><span class="ico">${p.icon || ''}</span><span class="t">${esc(p.title)}</span>${stTag(p.status)}</button>`).join('');
  openCard(`<h2>Team Board</h2><div class="sub">${PROJECTS.length} businesses. Updated ${esc(UPDATED)}.</div><div class="btns"><button type="button" class="needs" data-act="needs">Needs you (${needsCount()})</button></div>${rows}`, true);
}
function needsFor(p) {
  const ids = new Set([p.id, ...(p.needIds || [])]);
  const owners = new Set(p.owners || []);
  const keys = [p.short, p.title].map(s => String(s || '').toLowerCase()).filter(s => s.length > 3);
  return [...NEEDS, ...liveNeeds()].filter(n => {
    if (n.id && ids.has(n.id)) return true;
    if (n.bot && owners.has(n.bot)) return true;
    const blob = `${n.title || ''} ${n.short || ''} ${n.do || ''}`.toLowerCase();
    return keys.some(k => blob.includes(k));
  });
}
function taskLines(p) {
  const out = [], seen = new Set();
  const add = (title, sub) => {
    title = noDash(String(title || '').trim());
    if (!title || seen.has(title)) return;
    seen.add(title); out.push({ title, sub: noDash(sub || '') });
  };
  for (const id of p.owners) {
    const who = byId(id)?.s.name || id;
    const b = busyOf(id); if (b) add(b, who);
    const live = workFeed?.bots?.[id]; if (!live) continue;
    const when = live.at ? fmtAgo(live.at) : '';
    if (live.task) add(live.task, [who, live.step, when].filter(Boolean).join(', '));
    else if (live.step) add(live.step, [who, when].filter(Boolean).join(', '));
    for (const st of live.steps || []) if (st && (st.s === 'now' || st.s === 'doing') && st.t) add(st.t, who + ', now');
  }
  return out;
}
function openBusiness(id) {
  const p = PROJECTS.find(x => x.id === id); if (!p) return;
  const tasks = taskLines(p);
  const needs = needsFor(p);
  const links = (p.links || []).filter(l => l && l.href && l.label);
  const desks = p.owners.map(o => byId(o)).filter(Boolean);
  const taskHtml = tasks.length
    ? tasks.map(t => `<div class="item"><b>${esc(t.title)}</b>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</div>`).join('')
    : `<div class="item"><small>No current task. Nobody is on this one right now.</small></div>`;
  const linkHtml = [
    ...links.map(l => `<a class="item" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`),
    ...desks.map(w => `<div class="item" data-act="worker" data-id="${w.s.id}"><b>${esc(w.s.name)}</b><small>${esc(w.s.bot)} desk</small></div>`),
  ].join('') || `<div class="item"><small>No link on file.</small></div>`;
  const needHtml = needs.length
    ? needs.map(n => `<div class="item"><b>${esc(n.title)}${n.due ? `<span class="due">by ${esc(n.due)}</span>` : ''}</b><small>${esc(n.do || '')}${n.who ? ` (${esc(n.who)})` : ''}</small></div>`).join('')
    : `<div class="item"><small>Nothing waiting on you for this business.</small></div>`;
  openCard(`<h2>${esc(p.title)}</h2><div class="sub">${stTag(p.status)}${p.due ? `<span class="due">due ${esc(p.due)}</span>` : ''}</div>
    <h3>STATUS</h3><div class="item"><b>${esc(p.label || STLBL[p.status] || p.status)}</b><small>${esc(p.note || '')}</small></div>
    <h3>CURRENT TASKS</h3>${taskHtml}
    <h3>LINKS</h3>${linkHtml}
    <h3>NEEDS YOU</h3>${needHtml}
    <div class="note">${esc(PAUSE_NOTE)}</div>
    <div class="btns"><button type="button" data-act="ask" data-text="About ${esc(p.title)}: ">Ask Michael</button><button type="button" class="needs" data-act="needs">All needs you</button><button type="button" data-act="projects">Team Board</button></div>`, true);
}
function needsHtml() {
  const L = liveNeeds();
  return NEEDS.map(n => `<div class="item"><b>${esc(n.title)}${n.due ? `<span class="due">by ${esc(n.due)}</span>` : ''}</b><small>${esc(n.do)}</small></div>`).join('')
    + (L.length ? `<h3>FROM THE OFFICE FEED (PRIVATE)</h3>` + L.map(n => `<div class="item"><b>${esc(n.title)}</b><small>${esc(n.do || '')}${n.who ? ` \u00b7 ${esc(n.who)}` : ''}</small></div>`).join('') : '');
}
function openNeeds() {
  openCard(`<h2>Needs you (${needsCount()})</h2><div class="sub">Things waiting on you. Answer in chat and Michael picks it up.</div>${needsHtml()}<div class="btns"><button data-act="ask" data-text="">Answer in chat</button><button data-act="projects">Team Board</button></div>`);
}
const trainer = createTrainer({ esc, noDash, sendSwipes: items => link.sendSwipes(items), toast: s => toast(s) });
function openDesign() { closeCard(); if (onpadOpen) closeOnpad(); trainer.open(); if (!(deck?.cards || []).length) loadDeck(true); }

// ---------- OnPad wall screen (warehouse south wall) ----------
// Same origin as this office on GitHub Pages, so the iframe shares OnPad's storage and Google sign-in.
const ONPAD_URL = 'https://johnsonswork-star.github.io/onpad/';
const ONPAD_FACE = { x0: 6.5, x1: 12.2, z0: 0.5, z1: 2.26 };
let onpadOpen = false, onpadOpenedAt = 0, onpadArmed = false;
function armOnpad() {
  const f = $('#onpadFrame');
  if (!f || onpadArmed) return;
  onpadArmed = true;
  f.src = ONPAD_URL;
}
function onpadIsOpen() { return onpadOpen; }
function facingOnpadBoard() {
  return floor === 'warehouse' && !floorAnim && !rotAnim && isFar('S');
}
function syncOnpadFrame() {
  const f = $('#onpadFrame');
  if (!f) return;
  if (onpadOpen) {
    f.classList.add('onpad-open');
    f.classList.remove('onpad-live');
    f.style.transform = 'none';
    return;
  }
  f.classList.remove('onpad-open');
  const show = facingOnpadBoard();
  f.classList.toggle('onpad-live', show);
  if (!show) return;
  armOnpad();
  const y = GY - 0.02;
  const { x0, x1, z0, z1 } = ONPAD_FACE;
  let tl = projectCSS(x0, y, z1), tr = projectCSS(x1, y, z1), bl = projectCSS(x0, y, z0);
  if (tr[0] < tl[0]) {
    tl = projectCSS(x1, y, z1);
    tr = projectCSS(x0, y, z1);
    bl = projectCSS(x1, y, z0);
  }
  const w = 960, h = 340;
  const a = (tr[0] - tl[0]) / w, b = (tr[1] - tl[1]) / w;
  const c = (bl[0] - tl[0]) / h, d = (bl[1] - tl[1]) / h;
  f.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${tl[0]}, ${tl[1]})`;
}
function openOnpad() {
  armOnpad();
  try { chatIn.blur(); } catch (e) {}
  onpadOpen = true;
  onpadOpenedAt = performance.now();
  document.body.classList.add('onpad-on');
  $('#onpadOverlay')?.classList.remove('hidden');
  syncOnpadFrame();
}
function closeOnpad() {
  if (!onpadOpen && !$('#onpadFrame')?.classList.contains('onpad-open')) {
    syncOnpadFrame();
    return;
  }
  onpadOpen = false;
  document.body.classList.remove('onpad-on');
  $('#onpadOverlay')?.classList.add('hidden');
  syncOnpadFrame();
}
function bindOnpad() {
  const ov = $('#onpadOverlay'), x = $('#onpadClose'), tab = $('#onpadTab');
  if (tab) tab.href = ONPAD_URL;
  if (x) x.onclick = e => { e.preventDefault(); e.stopPropagation(); closeOnpad(); };
  if (ov) ov.addEventListener('click', e => { if (e.target === ov && performance.now() - onpadOpenedAt > 400) closeOnpad(); });
}
bindOnpad();

// ---------- HUD ----------
const projList = $('#projList');
function renderProjects() {
  projList.innerHTML = noDash(PROJECTS.map(p => `<li data-id="${p.id}"><span class="ico">${p.icon || ''}</span><span class="pip ${p.status}"></span><span class="t">${esc(p.title)}</span>${p.due ? `<span class="st blocked">${esc(p.due)}</span>` : ''}</li>`).join(''));
  const n = needsCount(); $('#needsN').textContent = n; $('#needsBtn').classList.toggle('zero', !n);
}
projList.addEventListener('click', e => { const li = e.target.closest('li'); if (li) openBusiness(li.dataset.id); });
$('#projToggle').onclick = () => { const on = $('#projects').classList.toggle('all'); $('#projToggle').textContent = on ? 'less' : 'all'; };
$('#needsBtn').onclick = openNeeds;
const rotL = $('#rotL'), rotR = $('#rotR');
if (rotL) rotL.onclick = () => rotateView(-1);
if (rotR) rotR.onclick = () => rotateView(1);
function tickClock() { const { tm, dt, h } = ctTime(); $('#clkT').textContent = tm + ' CT'; $('#clkD').textContent = dt; $('#clock .ci').textContent = h >= 7 && h < 19 ? '\u2600' : '\u263E'; }
setInterval(tickClock, 15000); tickClock();

// ---------- chat (same encrypted HQ relay + local log as the 3D office) ----------
const LOG = 'hq.chatLog', FEED = 'hq.officeFeed';
const chatBody = $('#chatBody'), chatIn = $('#chatIn'), chatTo = $('#chatTo');
let tab = 'chat';
const load = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } };
let entries = load(LOG), office = load(FEED);
const saveLog = () => { try { localStorage.setItem(LOG, JSON.stringify(entries.slice(-120))); } catch (e) {} };
const tms = a => typeof a === 'number' ? a : Date.parse(a) || 0;
function hqAck(id, text) {
  const mm = /^g-(.+)$/.exec(String(id || '')); if (!mm) return null;
  const n = String(text || '').match(/HQ #(\d+)/); return n ? { mid: mm[1], n: n[1] } : null;
}
function merged() {
  const mine = new Set(entries.filter(e => e.kind === 'me').map(e => e.ref || e.mid)), ids = new Set(entries.filter(e => e.kind === 'bot').map(e => String(e.id)));
  const acks = new Map();
  for (const o of office) { const a = hqAck(o.id, o.text); if (a) acks.set(a.mid, a.n); }
  const stamp = m => { const n = m.ackN || acks.get(m.mid) || acks.get(m.ref); return n ? { ...m, ackN: n } : m; };
  const out = entries.filter(e => !e.thread).map(e => stamp({ ...e, t: tms(e.at) }));
  for (const o of office) {
    if (o.thread || hqAck(o.id, o.text)) continue;
    if (o.kind === 'chris') { if (o.mid && mine.has(o.mid)) continue; out.push(stamp({ kind: 'me', text: o.text, to: o.to, t: tms(o.at), status: 'delivered', mid: o.mid })); continue; }
    if (ids.has(String(o.id))) continue;
    out.push({ kind: 'bot', from: o.name, who: o.who, bot: o.bot, text: o.text, t: tms(o.at), sub: o.kind });
  }
  return out.sort((a, b) => a.t - b.t).slice(-80);
}
const stOf = who => STATIONS.find(s => s.id === who) || STATIONS.find(s => who && s.name.toLowerCase() === String(who).toLowerCase());
const hm = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
let chatStick = true;
// Screenshots in replies: a line that is only an https image URL (or a markdown image ![alt](url)) shows as a
// tappable thumbnail; tap opens it big in the card. Everything else stays plain escaped text, as before.
const IMG_LINE = /^\s*(?:!\[([^\]]*)\]\()?(https:\/\/[^\s()<>"]+\.(?:png|jpe?g|gif|webp)(?:\?[^\s()<>"]*)?)\)?\s*$/i;
function richText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  if (!lines.some(l => IMG_LINE.test(l))) return esc(text);
  return lines.map(l => { const m = l.match(IMG_LINE); return m ? `<a href="${esc(m[2])}" class="shot" data-img="${esc(m[2])}"><img src="${esc(m[2])}" alt="${esc(m[1] || 'screenshot')}" loading="lazy"></a>` : esc(l); })
    .join('<br>').replace(/(<\/a>)(?:<br>)+(?=<a href)/g, '$1'); // consecutive shots sit side by side
}
function renderChat() {
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#chatForm').classList.toggle('hidden', tab !== 'chat');
  let html = '';
  if (tab === 'chat') {
    const list = merged();
    const meStatus = m => (m.status === 'sending' ? 'sending' : m.status === 'failed' ? `<a href="#" class="retry" data-mid="${esc(m.mid)}">failed, tap to retry</a>` : m.ackN ? `Michael has it (#${esc(m.ackN)})` : 'delivered') + (m.shot === 'on' ? ' · 📸' : '');
    html = list.length ? list.map(m => {
      if (m.kind === 'me') return `<div class="msg me"><img class="av" src="${avatar('chris')}"><div><div class="n">Chris <i>to ${esc(m.to === OFFICE_TO || m.to === 'Office' ? 'the office' : m.to === 'Grok Bot' ? 'Michael' : m.to || '')} \u00b7 ${hm(m.t)}</i></div><div class="x">${esc(m.text)}</div><div class="mst">${meStatus(m)}</div></div></div>`;
      const s = stOf(m.who) || stOf(m.from) || (/grok/i.test(m.from || '') ? stOf('grok') : null);
      return `<div class="msg"><img class="av" src="${avatar(s?.id || 'grok')}"><div><div class="n">${esc(s?.name || m.from || 'Grok Bot')} <i>${hm(m.t)}</i></div><div class="x">${richText(m.text)}</div></div></div>`;
    }).join('') : `<div class="empty">No messages yet. Send one and Michael answers here.</div>`;
  } else if (tab === 'assign') {
    html = people.map(p => { const st = stateOf(p.s.id); return `<div class="row" data-id="${p.s.id}"><span class="sdot" style="background:${st === 'active' ? '#6fd35b' : st === 'blocked' ? '#d8432f' : '#f2b33d'}"></span><img class="av" src="${avatar(p.s.id)}"><div><b>${esc(p.s.name)}</b> \u00b7 ${esc(p.s.bot)}<small>${esc(lineOf(p.s.id))}</small></div></div>`; }).join('');
  } else {
    html = [...NEEDS, ...liveNeeds()].map(n => `<div class="row" data-needs="1"><span class="sdot" style="background:#d8432f"></span><div><b>${esc(n.title)}</b>${n.due ? ` <span class="st blocked">by ${esc(n.due)}</span>` : ''}<small>${esc(n.do || '')}</small></div></div>`).join('') || '<div class="empty">Nothing needs you right now.</div>';
  }
  chatBody.innerHTML = noDash(html);
  // HQ #125: always land on the newest message. A new message (or the first render) forces it;
  // plain re-renders keep the bottom pinned unless Chris scrolled up to read older lines.
  let key = '';
  if (tab === 'chat') { const l = merged(); const z = l[l.length - 1]; key = l.length + '|' + (z ? z.t + '|' + (z.text || '').length + '|' + (z.status || '') : ''); }
  const fresh = tab === 'chat' && key !== renderChat.key; if (tab === 'chat') renderChat.key = key;
  scrollChatEnd(fresh || !renderChat.did); renderChat.did = true;
}
function scrollChatEnd(force) {
  if (tab !== 'chat') return;
  if (force) chatStick = true;
  if (!chatStick) return;
  const go = () => { if (tab === 'chat' && chatStick) chatBody.scrollTop = chatBody.scrollHeight; };
  go(); requestAnimationFrame(() => { go(); requestAnimationFrame(go); }); setTimeout(go, 250);
}
chatBody.addEventListener('scroll', () => { if (tab === 'chat') chatStick = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 60; }, { passive: true });
chatBody.addEventListener('load', () => scrollChatEnd(false), true); // avatars finish loading and push the list taller
if (window.ResizeObserver) new ResizeObserver(() => scrollChatEnd(false)).observe(chatBody); // size toggle, keyboard
document.addEventListener('visibilitychange', () => { if (!document.hidden) scrollChatEnd(true); });
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { const was = tab; tab = b.dataset.tab; renderChat(); if (tab === 'chat' && was !== 'chat') scrollChatEnd(true); } });
chatBody.addEventListener('click', e => {
  const sh = e.target.closest('a.shot'); if (sh) { e.preventDefault(); openCard(`<a href="${esc(sh.dataset.img)}" target="_blank" rel="noopener"><img class="shotbig" src="${esc(sh.dataset.img)}" alt="screenshot"></a>`, true); return; }
  const r = e.target.closest('a.retry'); if (r) { e.preventDefault(); const m = entries.find(x => x.mid === r.dataset.mid); if (m) deliver(m); return; }
  const row = e.target.closest('.row'); if (!row) return;
  if (row.dataset.id) { sel = row.dataset.id; openWorker(row.dataset.id); } else if (row.dataset.needs) openNeeds();
});
const rid = () => Math.random().toString(36).slice(2, 11);
// JPEG of the office canvas only. Chat, clock, and the other HUD are HTML on top of #c, so they are not in the shot.
// The canvas already shows the current rotation (including a turn in progress), so every facing is captured as Chris sees it.
// Same envelope field the 3D office used: shot = data:image/jpeg;base64,... (hq-link seals it; the bridge saveShot writes it).
const SHOT_EDGE = 1280, SHOT_Q = 0.7;
let shotCvs = null;
function shotLabel() {
  const place = floor === 'warehouse' ? 'warehouse' : 'office';
  if (rotAnim) return `2.5D ${place} · turning ${FACE_NAME[rotAnim.from] || '?'}→${FACE_NAME[rotAnim.to] || '?'}`;
  return `2.5D ${place} · facing ${FACE_NAME[facing] || '?'}`;
}
function stampShot(g, w, h) {
  const label = shotLabel(), k = Math.max(0.75, w / SHOT_EDGE);
  g.font = `600 ${Math.round(16 * k)}px system-ui, Arial, sans-serif`;
  const padX = 8 * k, tw = g.measureText(label).width, bw = tw + padX * 2, bh = 22 * k;
  const x = 8 * k, y = h - bh - 8 * k;
  g.fillStyle = 'rgba(20,12,6,.62)'; g.fillRect(x, y, bw, bh);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(label, x + padX, y + bh / 2);
}
function snapshot() {
  try {
    if (!cv.width || !cv.height) return null;
    const sc = Math.min(1, SHOT_EDGE / Math.max(cv.width, cv.height));
    const w = Math.max(1, Math.round(cv.width * sc)), h = Math.max(1, Math.round(cv.height * sc));
    if (!shotCvs) shotCvs = document.createElement('canvas');
    if (shotCvs.width !== w || shotCvs.height !== h) { shotCvs.width = w; shotCvs.height = h; }
    const g = shotCvs.getContext('2d', { alpha: false });
    if (!g) return null;
    g.drawImage(cv, 0, 0, w, h);
    try { stampShot(g, w, h); } catch (e) {}
    let url = shotCvs.toDataURL('image/jpeg', SHOT_Q);
    if (url.length >= 1.5e6) url = shotCvs.toDataURL('image/jpeg', 0.5); // hq-link drops anything bigger and sends the text alone
    return /^data:image\/jpeg;base64,/.test(url) && url.length > 2000 && url.length < 1.5e6 ? url : null;
  } catch (e) { return null; }
}
// Let the "sending" bubble paint before the JPEG encode, but never wait on a paused animation frame.
function nextPaint() {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(finish); } catch (e) { finish(); return; }
    setTimeout(finish, 48);
  });
}
async function deliver(m) {
  m.status = 'sending'; renderChat();
  await nextPaint();
  let shot = null; try { shot = snapshot() || null; } catch (e) { shot = null; }
  if (shot) { m.shot = 'on'; renderChat(); }
  let tri = { route: m.route, cmds: [] }; try { tri = triage(m.text, { to: m.to, near: null }); } catch (e) {}
  const r = await link.send({ to: m.to, text: m.text, sentAt: new Date(m.at), shot, office: { near: sel || null, bot: tri.cmds?.[0]?.bot || null, line: '' }, mid: m.mid });
  Object.assign(m, { status: r.status, ref: r.ref, route: tri.route, shot: r.shot ? 'on' : '' }); saveLog(); renderChat();
  if (r.status === 'delivered') { fastUntil = Date.now() + 60000; toast(m.to === 'Grok Bot' ? 'Sent to Michael (Grok Bot)' : 'Sent to the office'); }
  else toast('Did not send. Tap retry in chat.');
}
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault(); const text = chatIn.value.trim(); if (!text) return; chatIn.value = '';
  const m = { kind: 'me', to: chatTo.value, text, at: Date.now(), mid: rid(), status: 'sending' };
  entries.push(m); saveLog(); tab = 'chat'; renderChat(); scrollChatEnd(true); deliver(m);
  if (m.to === 'Grok Bot') say('grok', 'Got it, looking now.', 4);
});
const chatBox = $('#chat'), chatOpenBtn = $('#chatOpen');
function openChat() { chatBox.classList.remove('hidden'); chatOpenBtn.classList.add('hidden'); scrollChatEnd(true); }
$('#chatMin').onclick = () => { chatBox.classList.add('hidden'); chatOpenBtn.classList.remove('hidden'); };
chatOpenBtn.onclick = openChat;

// Chat size: Normal (roomy iPad default), Large, Full screen. Remembered on this device.
const CHAT_SZ_KEY = 'hq2d.chatSize', CHAT_SZS = ['normal', 'large', 'full'];
const chatSzLabel = sz => (sz === 'full' ? 'Full screen' : sz === 'large' ? 'Large' : 'Normal');
const chatSzNext = sz => (sz === 'normal' ? 'Large' : sz === 'large' ? 'Full screen' : 'Normal');
function applyChatSize(sz, persist) {
  if (!CHAT_SZS.includes(sz)) sz = 'normal';
  chatBox.classList.remove('sz-normal', 'sz-large', 'sz-full');
  chatBox.classList.add('sz-' + sz);
  const btn = $('#chatSize'), minBtn = $('#chatMin');
  if (btn) {
    btn.textContent = chatSzLabel(sz);
    const tip = 'Chat size: ' + chatSzLabel(sz) + '. Tap for ' + chatSzNext(sz) + '.';
    btn.title = tip; btn.setAttribute('aria-label', tip);
  }
  if (minBtn) {
    const full = sz === 'full';
    minBtn.textContent = full ? 'Hide' : '_';
    minBtn.title = full ? 'Hide chat' : 'hide';
    minBtn.setAttribute('aria-label', 'Hide chat');
  }
  if (persist) { try { localStorage.setItem(CHAT_SZ_KEY, sz); } catch (e) {} }
}
let chatSz = 'normal';
try { chatSz = localStorage.getItem(CHAT_SZ_KEY) || 'normal'; } catch (e) {}
applyChatSize(chatSz, false);
const chatSizeBtn = $('#chatSize');
if (chatSizeBtn) chatSizeBtn.onclick = e => {
  e.stopPropagation();
  const cur = CHAT_SZS.find(s => chatBox.classList.contains('sz-' + s)) || 'normal';
  applyChatSize(CHAT_SZS[(CHAT_SZS.indexOf(cur) + 1) % CHAT_SZS.length], true);
};
function pinChatAboveKeyboard() {
  const vv = window.visualViewport; if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.offsetTop - vv.height);
  chatBox.style.setProperty('--kb', (kb > 40 ? Math.round(kb) : 0) + 'px');
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', pinChatAboveKeyboard);
  visualViewport.addEventListener('scroll', pinChatAboveKeyboard);
}

let fastUntil = 0, polling = false, pollAgain = false;
async function pollChat() {
  if (document.hidden) return;
  if (polling) { pollAgain = true; return; }
  polling = true;
  try {
    do {
      pollAgain = false;
      const f = await link.fetchChatFeed();
      let chSoon = false;
      if (f?.feed?.items) {
        office = f.feed.items.slice(-150); try { localStorage.setItem(FEED, JSON.stringify(office)); } catch (e) {}
        for (const o of office) if (noteAck(o.id, o.text)) chSoon = true;
      }
      const reps = await link.fetchReplies(); let ch = !!f?.feed || chSoon;
      const have = new Set(entries.filter(e => e.kind === 'bot').map(e => String(e.id)));
      for (const r of reps) {
        if (r.type === 'ack') { const m = entries.find(x => x.mid === r.mid); if (m && !m.issue) { m.issue = r.issue; m.route = r.route || m.route; ch = true; } continue; }
        if (hqAck(r.id, r.text)) { if (noteAck(r.id, r.text)) ch = true; continue; }
        if (r.thread || have.has(String(r.id))) continue;
        entries.push({ kind: 'bot', id: r.id, from: r.from, text: r.text, at: r.at, ref: r.ref }); ch = true;
        const who = stOf(r.who) || (/grok/i.test(r.from || '') ? stOf('grok') : null); if (who && byId(who.id)) say(who.id, r.text, 6);
      }
      if (ch) { saveLog(); renderChat(); }
    } while (pollAgain && !document.hidden);
  } catch (e) {}
  polling = false;
  if (pollAgain && !document.hidden) pollChat();
}
function noteAck(id, text) {
  const a = hqAck(id, text); if (!a) return false;
  const m = entries.find(x => x.kind === 'me' && (x.mid === a.mid || x.ref === a.mid));
  if (!m || m.ackN === a.n) return false;
  m.ackN = a.n; return true;
}
setInterval(() => { if (Date.now() < fastUntil) pollChat(); }, 5000);
setInterval(pollChat, 25000);
const HELLO_AT = 'hq.helloAt', HELLO_MS = 24 * 60 * 60 * 1000;
async function sayHello() {
  let last = 0; try { last = Number(localStorage.getItem(HELLO_AT)) || 0; } catch (e) {}
  if (last && Date.now() - last < HELLO_MS) return;
  if (await link.hello()) { try { localStorage.setItem(HELLO_AT, String(Date.now())); } catch (e) {} }
}
let chatEs = null, esWait = 0;
async function openReplyStream() {
  clearTimeout(esWait);
  if (link.ntfyBlocked()) return;
  if (chatEs) { try { chatEs.close(); } catch (e) {} chatEs = null; }
  let topic = ''; try { topic = await link.deviceTopic(); } catch (e) {}
  if (!topic) { esWait = setTimeout(openReplyStream, 4000); return; }
  let es; try { es = new EventSource('https://ntfy.sh/' + topic + ',' + topic + '_chat/sse'); }
  catch (e) { esWait = setTimeout(openReplyStream, 3000); return; }
  chatEs = es;
  es.onmessage = () => pollChat();
  es.onerror = () => {
    if (chatEs !== es) return;
    chatEs = null; try { es.close(); } catch (e) {}
    esWait = setTimeout(openReplyStream, 3000);
  };
}
function onChatVisible() { if (!document.hidden) pollChat(); }
document.addEventListener('visibilitychange', onChatVisible);
window.addEventListener('pageshow', onChatVisible);
sayHello();
openReplyStream();

// ---------- live data: tasks.json, work feed, design deck, version ----------
async function loadTasks() { try { const r = await fetch('../tasks.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { busyFile = (await r.json()).busy || {}; renderChat(); } } catch (e) {} }
async function loadWork() { try { const r = await link.fetchWorkFeed(); if (r?.feed) { workFeed = r.feed; renderProjects(); if (tab !== 'chat') renderChat(); } } catch (e) {} }
let deckToken = 0, deckBusy = 0;
async function loadDeck(force) {
  const token = deckToken;
  deckBusy++;
  let fed = false;
  try {
    const r = await link.fetchSwipeDeck(force);
    if (token === deckToken && r?.feed?.cards) {
      deck = r.feed; deckImgs.length = 0;
      for (const c of deck.cards.filter(c => c.d).slice(0, 3)) { const im = new Image(); im.src = c.d; deckImgs.push(im); }
      trainer.setDeck(deck);
      fed = true;
    }
  } catch (e) {}
  finally { deckBusy--; }
  if (!fed && token === deckToken) trainer.setDeck(null);
  return fed;
}
let build = null;
async function checkVersion() {
  try {
    const stamp = async (url) => {
      const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return '';
      return String((await r.json()).build || '');
    };
    const [here, root] = await Promise.all([stamp('version.json'), stamp('../version.json')]);
    if (!here && !root) return;
    const next = here + '|' + root;
    if (build === null) build = next;
    else if (next !== build && !chatIn.value && modal.classList.contains('hidden') && !trainer.isOpen() && !onpadOpen && document.activeElement !== chatIn && document.activeElement?.id !== 'onpadFrame') { toast('Office update: reloading'); setTimeout(() => location.reload(), 800); }
  } catch (e) {}}

// ---------- controller + keyboard ----------
let padPrev = [], padSeen = false;
function moveSel(dx, dy) {
  if (!sel) { sel = 'grok'; return; }
  const cur = byId(sel); const [cx, cy] = Pf(cur.seat[0], cur.seat[1]);
  let best = null, bd = 1e9;
  for (const p of people) { if (p.s.id === sel) continue; const [x, y] = Pf(p.seat[0], p.seat[1]); const vx = x - cx, vy = y - cy; const along = vx * dx + vy * dy; if (along <= 2) continue; const perp = Math.abs(vx * dy - vy * dx); const d = along + perp * 2.2; if (d < bd) { bd = d; best = p; } }
  if (best) { sel = best.s.id; say(sel, lineOf(sel), 3.5); }
}
function press(btn) {
  const open = !modal.classList.contains('hidden');
  const train = trainer.isOpen();
  if (btn === 'A') {
    if (train || onpadOpen) return;
    if (open) closeCard();
    else if (facingOnpadBoard()) openOnpad();
    else if (sel) openWorker(sel);
    else if (floor === 'office') sel = 'grok';
  }
  else if (btn === 'B') { if (onpadOpen) closeOnpad(); else if (train) trainer.close(); else if (open) closeCard(); else sel = null; }
  else if (btn === 'Y') openNeeds();
  else if (btn === 'X') { closeCard(); openChat(); chatIn.focus(); }
  else if (btn === 'start') openProjects();
}
function pollPad(dt) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; const gp = pads[0]; if (!gp) { stickGlide = false; return; }
  if (!padSeen) { padSeen = true; const h = $('#padHint'); h.classList.remove('hidden'); setTimeout(() => h.classList.add('hidden'), 7000); }
  const b = i => !!gp.buttons[i]?.pressed, edge = i => b(i) && !padPrev[i];
  if (document.activeElement !== chatIn) {
    if (edge(12)) moveSel(0, -1); if (edge(13)) moveSel(0, 1); if (edge(14)) moveSel(-1, 0); if (edge(15)) moveSel(1, 0);
    if (edge(0)) press('A'); if (edge(2)) press('X'); if (edge(3)) press('Y'); if (edge(9)) press('start');
    if (edge(4)) rotateView(-1); if (edge(5)) rotateView(1);
    if (edge(8)) goFloor();
  }
  if (edge(1)) { if (document.activeElement === chatIn) chatIn.blur(); else press('B'); }
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, ry = gp.axes[3] || 0;
  const stick = Math.abs(ax) > 0.18 || Math.abs(ay) > 0.18;
  if (stick) {
    noteInput();
    const dx = -ax * 420 * dt, dy = -ay * 420 * dt;
    wish.px += dx; wish.py += dy; clampWish();
    cam.px = wish.px; cam.py = wish.py;
    velX = dx / Math.max(dt, 0.008); velY = dy / Math.max(dt, 0.008);
    stickGlide = true;
  } else if (stickGlide) {
    wish.px = cam.px + Math.max(-700, Math.min(700, velX)) * 0.16;
    wish.py = cam.py + Math.max(-700, Math.min(700, velY)) * 0.16;
    clampWish(); velX = velY = 0; stickGlide = false;
  }
  const zt = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0) - (Math.abs(ry) > 0.25 ? ry * 0.65 : 0);
  if (Math.abs(zt) > 0.08) {
    noteInput();
    const z0 = wish.zoom; wish.zoom = clampZ(wish.zoom * (1 + zt * 0.85 * dt));
    const k = wish.zoom / z0; wish.px *= k; wish.py *= k; cam.px = wish.px; cam.py = wish.py; clampWish();
  }
  if (gp.buttons.some((x, i) => x.pressed && !padPrev[i])) noteInput();
  padPrev = gp.buttons.map(x => x.pressed);
}
addEventListener('keydown', e => {
  noteInput();
  if (document.activeElement === chatIn) { if (e.key === 'Escape') chatIn.blur(); return; }
  const k = e.key;
  if (k === 'ArrowUp') moveSel(0, -1); else if (k === 'ArrowDown') moveSel(0, 1); else if (k === 'ArrowLeft') moveSel(-1, 0); else if (k === 'ArrowRight') moveSel(1, 0);
  else if (k === 'Enter') press('A'); else if (k === 'Escape') press('B'); else if (k === 'n') press('Y'); else if (k === 'c') { e.preventDefault(); press('X'); }
  else if (k === 'q' || k === 'Q') rotateView(-1); else if (k === 'e' || k === 'E') rotateView(1);
  else if (k === 'f' || k === 'F') goFloor();
  else return; e.preventDefault();
});

// ---------- toast ----------
let toastT = 0; function toast(s) { const el = $('#toast'); el.textContent = noDash(s); el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 2600); }

// ---------- boot ----------
resize(); renderProjects(); renderChat();
startLoop();
document.fonts?.ready?.then(() => { baseOk.warehouse.fill(false); });
loadTasks(); setInterval(loadTasks, 30000);
loadWork(); setInterval(loadWork, 90000);
loadDeck(false);
checkVersion(); setInterval(checkVersion, 30000);
pollChat();
setTimeout(() => toast('Tap the stairs for the warehouse. Pinch to zoom, drag to look around. Q and E rotate.'), 900);
updateFloorBtn();
const floorBtn = $('#floorBtn');
if (floorBtn) floorBtn.onclick = () => goFloor();
let prebuildQ = [];
function queuePrebuild() {
  prebuildQ = [];
  const order = [floor, floor === 'office' ? 'warehouse' : 'office'];
  for (const fl of order) for (const f of [0, 1, 2, 3]) {
    if (fl === floor && f === facing) continue;
    if (!baseOk[fl][f]) prebuildQ.push([fl, f]);
  }
}
function prebuildBases() {
  if (!prebuildQ.length) return;
  if (document.hidden || rotAnim || floorAnim) { requestAnimationFrame(prebuildBases); return; }
  const [fl, f] = prebuildQ.shift();
  if (!baseOk[fl][f]) ensureBase(fl, f);
  if (prebuildQ.length) requestAnimationFrame(prebuildBases);
}
queuePrebuild();
requestAnimationFrame(prebuildBases);
addEventListener('resize', () => { queuePrebuild(); requestAnimationFrame(prebuildBases); });
function rebuildHits() {
  const prev = collectHits;
  hits = [];
  collectHits = true;
  staticHits();
  if (floor === 'office') {
    for (const p of people) {
      const [sx, sy] = P(p.seat[0], p.seat[1], SEATZ);
      addWorkerHits(p, sx, sy);
    }
  }
  sortHits();
  collectHits = prev;
}
function hitLabel(h) { return h ? (h.kind === 'worker' ? h.id : h.kind) : null; }
function expectedTitle(want) {
  if (want === 'warehouse') return 'Warehouse';
  if (want === 'design') return 'Design Trainer';
  if (want === 'board' || want === 'status' || want === 'whiteboard') return 'Team Board';
  return byId(want)?.s.name || '';
}
function clickTargets() {
  const list = [];
  const sign = stairSignBox();
  const step = stairSteps(floor === 'warehouse')[3];
  if (floor === 'warehouse') {
    list.push({ name: 'stairs', want: 'stairs', x: step.x + step.w / 2, y: step.y + step.d / 2, z: step.top });
    list.push({ name: 'stair sign', want: 'stairs', x: (sign.x0 + sign.x1) / 2, y: sign.ySign, z: 1.75 });
    const [px, py, pn] = PALLETS[8];
    list.push({ name: 'pallet', want: 'warehouse', x: px + 0.7, y: py + 0.55, z: 0.16 + pn * 0.28 });
    const [rx, ry, rw] = RACKS[2];
    list.push({ name: 'rack', want: 'warehouse', x: rx + rw / 2, y: ry + 0.4, z: 2.05 });
    list.push({ name: 'stock desk', want: 'warehouse', x: BENCH.x + BENCH.w / 2, y: BENCH.y + BENCH.d / 2, z: 0.74 });
    if (isFar('N')) list.push({ name: 'bay', want: 'warehouse', x: 2.35, y: 0.01, z: 1.15 });
    if (isFar('S')) list.push({ name: 'stock board', want: 'onpadmap', x: 9.35, y: GY, z: 1.6 });
    return list;
  }
  for (const p of people) {
    const d = p.d, h = deskTop(d);
    list.push({ name: 'desk ' + p.s.id, want: p.s.id, x: d.x + d.w / 2, y: d.y + d.d / 2, z: h });
    const [sx, sy] = P(p.seat[0], p.seat[1], SEATZ), S = CREW_SC;
    list.push({ name: 'sprite ' + p.s.id, want: p.s.id, iso: [sx + (CREW_HIT.x + CREW_HIT.w / 2) * S, sy + (CREW_HIT.y + CREW_HIT.h / 2) * S] });
  }
  if (isFar('N')) {
    list.push({ name: 'team board', want: 'board', x: (7.55 + 13.95) / 2, y: 0, z: (0.38 + 3.08) / 2 });
    list.push({ name: 'status board', want: 'status', x: (3 + 7.2) / 2, y: 0, z: (0.95 + 2.7) / 2 });
  }
  if (isFar('W')) list.push({ name: 'whiteboard', want: 'whiteboard', x: 0, y: (4.6 + 8.4) / 2, z: (0.95 + 2.55) / 2 });
  const yShirt = showPosY() ? 6.582 : 6.398;
  list.push({ name: 'design wall', want: 'design', x: 17.75, y: yShirt, z: 1.8 });
  list.push({ name: 'stairs', want: 'stairs', x: step.x + step.w / 2, y: step.y + step.d / 2, z: step.top });
  list.push({ name: 'stair sign', want: 'stairs', x: (sign.x0 + sign.x1) / 2, y: sign.ySign, z: 1.75 });
  return list;
}
const OFFICE_PROBES = [[4, 2, 'conference'], [11, 3, 'table'], [15, 1, 'kitchen'], [18.5, 3.2, 'manager floor'], [5, 8, 'bullpen'], [8, 11, 'aisle'], [2, 14, 'south west'], [16, 10, 'annex floor'], [19, 7.2, 'east floor'], [14, 10.4, 'old pit corner'], [10.4, 13.6, 'old stairs'], [12.4, 13.8, 'south aisle'], [20.4, 14.5, 'south east floor']];
function checkHits() {
  const savedF = facing, savedFl = floor;
  const fails = [], rows = [];
  try {
    for (const fl of ['office', 'warehouse']) {
      floor = fl;
      floorAnim = null;
      for (let f = 0; f < 4; f++) {
        facing = f;
        updateFloorBtn();
        rebuildHits();
        if (fl === 'office' && hits.some(h => h.kind === 'warehouse' || h.kind === 'onpadmap')) fails.push({ floor: fl, facing: FACE_NAME[f], name: 'downstairs hit upstairs', want: 'none', got: hits.find(h => h.kind === 'warehouse' || h.kind === 'onpadmap')?.kind });
        const cue = stairCue(fl === 'warehouse');
        const btn = $('#floorBtn')?.textContent || '';
        const wantWord = fl === 'warehouse' ? 'UP' : 'DOWN';
        const wantDest = fl === 'warehouse' ? 'OFFICE' : 'WAREHOUSE';
        const wantBtn = fl === 'warehouse' ? 'Up' : 'Down';
        if (cue.word !== wantWord || cue.dest !== wantDest || btn !== wantBtn) fails.push({ floor: fl, facing: FACE_NAME[f], name: 'stair sign', want: wantWord + ' ' + wantDest + ' / ' + wantBtn, got: cue.word + ' ' + cue.dest + ' / ' + btn });
        const tip = projectCSS(...cue.tip), tail = projectCSS(...cue.tail);
        const pointOk = fl === 'warehouse' ? tip[1] < tail[1] - 3 : tip[1] > tail[1] + 3;
        if (!pointOk) fails.push({ floor: fl, facing: FACE_NAME[f], name: 'stair arrow', want: fl === 'warehouse' ? 'points up' : 'points down', got: 'tip ' + tip[1].toFixed(1) + ' tail ' + tail[1].toFixed(1) });
        for (const t of clickTargets()) {
          const css = t.iso ? isoToCSS(t.iso[0], t.iso[1]) : projectCSS(t.x, t.y, t.z);
          const h = hitAt(css[0], css[1]);
          const got = hitLabel(h);
          const row = { floor: fl, facing: FACE_NAME[f], name: t.name, want: t.want, got: got || 'none' };
          rows.push(row);
          if (got !== t.want) { fails.push(row); continue; }
          if (t.want === 'stairs') continue;
          openHit(h);
          if (t.want === 'onpadmap') {
            const link = $('#onpadTab'), close = $('#onpadClose');
            if (!onpadOpen) fails.push({ floor: fl, facing: FACE_NAME[f], name: t.name + ' open', want: 'onpad', got: 'closed' });
            if (!close || close.textContent.trim() !== 'Close') fails.push({ floor: fl, facing: FACE_NAME[f], name: 'onpad close', want: 'Close', got: close?.textContent || 'none' });
            if (!link || link.textContent.trim() !== 'Open in new tab') fails.push({ floor: fl, facing: FACE_NAME[f], name: 'onpad link', want: 'Open in new tab', got: link?.textContent || 'none' });
            if (link && link.getAttribute('href') !== ONPAD_URL) fails.push({ floor: fl, facing: FACE_NAME[f], name: 'onpad href', want: ONPAD_URL, got: link.getAttribute('href') || 'none' });
            closeOnpad();
          } else if (t.want === 'design') {
            if (!trainer.isOpen()) fails.push({ floor: fl, facing: FACE_NAME[f], name: t.name + ' card', want: 'Design Trainer', got: 'closed' });
            trainer.close();
          } else {
            const title = $('#card h2')?.textContent || '';
            const exp = expectedTitle(t.want);
            if (title !== exp) fails.push({ floor: fl, facing: FACE_NAME[f], name: t.name + ' card', want: exp, got: title || 'none' });
            closeCard();
          }
        }
        if (fl === 'office') {
          const sg = stairSignBox();
          const sign = quadY(sg.ySign, sg.x0, sg.x1, sg.z0, sg.z1);
          for (let x = 0.6; x < GX; x += 1) for (let y = 0.6; y < GY; y += 1) {
            if (x >= ST.x0 - 0.3 && x <= ST.x1 + 0.3 && y >= ST.y0 - 0.6 && y <= ST.y1 + 0.25) continue;
            const css = projectCSS(x, y, 0);
            const iso = cssToLeg(css[0], css[1]);
            if (inPoly(iso[0], iso[1], sign)) continue;
            const h = hitAt(css[0], css[1]);
            if (h && h.kind === 'warehouse') fails.push({ floor: fl, facing: FACE_NAME[f], name: 'floor ' + x.toFixed(0) + ',' + y.toFixed(0), want: 'office', got: h.kind });
          }
          for (const [x, y, label] of OFFICE_PROBES) {
            const got = hitLabel(hitAt(...projectCSS(x, y, 0)));
            const row = { floor: fl, facing: FACE_NAME[f], name: 'probe ' + label, want: 'not warehouse', got: got || 'none' };
            rows.push(row);
            if (got === 'warehouse') fails.push(row);
          }
        }
      }
    }
    for (const fl of ['office', 'warehouse']) {
      floor = fl;
      floorAnim = null;
      rotAnim = null;
      updateFloorBtn();
      for (let f = 0; f < 4; f++) {
        facing = f;
        closeOnpad();
        closeCard();
        sel = null;
        press('A');
        const wantOpen = fl === 'warehouse' && isFar('S');
        if (onpadOpen !== wantOpen) fails.push({ floor: fl, facing: FACE_NAME[f], name: 'action button', want: wantOpen ? 'onpad' : 'closed', got: onpadOpen ? 'onpad' : 'closed' });
        if (wantOpen) {
          press('B');
          if (onpadOpen) fails.push({ floor: fl, facing: FACE_NAME[f], name: 'action close', want: 'closed', got: 'onpad' });
        }
        closeOnpad();
        closeCard();
      }
    }
  } finally {
    facing = savedF;
    floor = savedFl;
    floorAnim = null;
    rotAnim = null;
    sel = null;
    closeOnpad();
    closeCard();
    updateFloorBtn();
    rebuildHits();
  }
  return { ok: fails.length === 0, fails, checked: rows.length };
}
function lookAt(x, y, z = 1.2, zoom = 0) {
  if (zoom) { wish.zoom = clampZ(zoom); cam.zoom = wish.zoom; }
  const [ix, iy] = P(x, y, z);
  const [fx, fy] = focusIso();
  const sCss = homePS * cam.zoom;
  wish.px = (fx - ix) * sCss; wish.py = (fy - iy) * sCss; clampWish();
  cam.px = wish.px; cam.py = wish.py; cam.zoom = wish.zoom; noteInput();
}
window.__hq2d = { bench: (n = 30) => { const scratch = document.createElement('canvas'); scratch.width = 640; scratch.height = 420; const sg = scratch.getContext('2d'); const a = performance.now(); for (let i = 0; i < n; i++) { camTransform(sg); hits = []; staticHits(); for (const it of sceneItems(i / 10)) it.fn(sg); } return (performance.now() - a) / n; }, proj: (x, y, z = 0) => projectCSS(x, y, z), hit: (x, y) => hitAt(x, y), lookAt, regions: () => hits.map(h => {    if (h.r) {
      const [x, y] = legToCSS(h.r[0], h.r[1]), [x2, y2] = legToCSS(h.r[0] + h.r[2], h.r[1] + h.r[3]);
      return { kind: h.kind, id: h.id || null, rect: [x, y, x2 - x, y2 - y] };
    }
    return { kind: h.kind, id: h.id || null, poly: h.poly.map(p => legToCSS(p[0], p[1])) };
  }), tap: (x, y) => tap(x, y), checkHits, openNeeds, openWorker, openProjects, openBusiness, openDesign, openOnpad, closeOnpad, onpadOpen: () => onpadOpen, stairCue: () => stairCue(), action: () => press('A'), setTrainerDeck: feed => { deckToken++; trainer.setDeck(feed); }, deckBusy: () => deckBusy, facing: () => FACE_NAME[facing], rotate: rotateView, setFacing, snapshot, floor: () => floor, goFloor, setFloor, state: () => ({ PS, BW, BH, DPR, n: people.length, facing: FACE_NAME[facing], floor, cam: { ...cam } }) };
