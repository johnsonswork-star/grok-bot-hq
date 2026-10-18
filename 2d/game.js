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

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const noDash = s => String(s ?? '').replace(/\u2014/g, ', ').replace(/\u2013/g, '-');
const noLig = s => String(s).replace(/f(?=[fil])/g, 'f\u200C');   // Pixelify Sans turns "fi" into a glyph that reads like "A"
const FONT = '"Pixelify Sans","Courier New",monospace';

// ---------- world ----------
const GX = 22, GY = 16, HX = 14, HY = 7, ZU = 16, WALL = 3.2;
const WH = { x0: 12, x1: GX, y0: 11.5, y1: GY, z: -2 };        // warehouse pit (downstairs)
const ST = { x0: 9, x1: 12, y0: 12.8, y1: 14.8, n: 6 };        // stairs down to it
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
  designer: { x: 15.2, y: 8.85 }, profile: { x: 17.9, y: 8.85 },
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
const FOCUS = [11.4, 6.35];  // bullpen, conference room, manager office, and the top of the warehouse
const FX = (FOCUS[0] - FOCUS[1]) * HX, FY = (FOCUS[0] + FOCUS[1]) * HY - ZU;
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
  baseDirty = true;
}
const clampZ = z => Math.max(fitPS / homePS * 0.95, Math.min(2.2, z));
function clampWish() {
  wish.zoom = clampZ(wish.zoom);
  const lx = MAP_W * 0.55 * homePS * wish.zoom, ly = (MAP_BOT - MAP_TOP) * 0.6 * homePS * wish.zoom;
  wish.px = Math.max(-lx, Math.min(lx, wish.px));
  wish.py = Math.max(-ly, Math.min(ly, wish.py));
}
function camMoving() {
  return Math.abs(wish.px - cam.px) > 0.35 || Math.abs(wish.py - cam.py) > 0.35 || Math.abs(wish.zoom - cam.zoom) > 0.0015;
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

// World iso pixels, camera applied later so the static floor can be cached.
const P = (x, y, z = 0) => [(x - y) * HX, (x + y) * HY - z * ZU];
const Pf = P;
const devScale = () => homePS * cam.zoom * DPR;
function camOrigin() {
  const s = devScale();
  let tx = W * DPR / 2 + cam.px * DPR - FX * s;
  let ty = H * DPR / 2 + cam.py * DPR - FY * s;
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
function projectCSS(x, y, z = 0) {
  const [ix, iy] = P(x, y, z);
  // camOrigin already centers on FOCUS. Subtracting it again drifts labels off the sprite.
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
function box(c, x, y, z, w, d, h, col, o = {}) {
  const A = P(x, y, z + h), B = P(x + w, y, z + h), C = P(x + w, y + d, z + h), D = P(x, y + d, z + h);
  const B0 = P(x + w, y, z), C0 = P(x + w, y + d, z), D0 = P(x, y + d, z);
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

// ---------- hash noise ----------
const hsh = (x, y) => { let n = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };

// ---------- base layer (floors, walls, pit) cached per camera ----------
const base = document.createElement('canvas'), bg = base.getContext('2d');
let baseDirty = true;
function wallX(c, y0, y1) { // left wall inner face (x = 0) with wainscot, chair rail, crown
  poly(c, quadX(0, y0, y1, 0, WALL), '#e9d9b8');
  for (let y = y0; y < y1; y += 0.5) poly(c, quadX(0, y, y + 0.04, 1.08, 3.0), 'rgba(160,120,70,.10)');
  poly(c, quadX(0, y0, y1, 0, 1.0), '#cdb38a');
  for (let y = y0 + 0.2; y < y1 - 0.4; y += 1.2) { poly(c, quadX(0, y + 0.05, y + 1.0, 0.2, 0.85), 'rgba(90,60,30,.18)'); poly(c, quadX(0, y + 0.09, y + 0.96, 0.24, 0.81), '#d3ba92'); }
  poly(c, quadX(0, y0, y1, 1.0, 1.1), '#7a5232'); poly(c, quadX(0, y0, y1, 1.08, 1.1), '#a0734a');
  poly(c, quadX(0, y0, y1, 2.98, WALL), '#6a4426'); poly(c, quadX(0, y0, y1, 2.98, 3.02), '#8d6440');
  poly(c, quadX(0, y0, y1, 0, 0.16), '#5e4029');
}
function wallY(c, x0, x1, wood) { // back wall inner face (y = 0)
  if (wood) {
    poly(c, quadY(0, x0, x1, 0, WALL), '#8a5a35');
    for (let x = x0; x < x1; x += 0.7) { poly(c, quadY(0, x, x + 0.05, 0, 2.98), '#6f4628'); poly(c, quadY(0, x + 0.08, x + 0.12, 0, 2.98), 'rgba(255,220,170,.10)'); }
  } else {
    poly(c, quadY(0, x0, x1, 0, WALL), '#ddcca8');
    for (let x = x0; x < x1; x += 0.5) poly(c, quadY(0, x, x + 0.04, 1.08, 3.0), 'rgba(150,110,60,.09)');
    poly(c, quadY(0, x0, x1, 0, 1.0), '#c3a87e');
    for (let x = x0 + 0.2; x < x1 - 0.4; x += 1.2) { poly(c, quadY(0, x + 0.05, x + 1.0, 0.2, 0.85), 'rgba(90,60,30,.18)'); poly(c, quadY(0, x + 0.09, x + 0.96, 0.24, 0.81), '#c9b088'); }
    poly(c, quadY(0, x0, x1, 1.0, 1.1), '#7a5232'); poly(c, quadY(0, x0, x1, 1.08, 1.1), '#a0734a');
  }
  poly(c, quadY(0, x0, x1, 2.98, WALL), '#6a4426'); poly(c, quadY(0, x0, x1, 2.98, 3.02), '#8d6440');
  poly(c, quadY(0, x0, x1, 0, 0.16), '#5e4029');
}
function windowY(c, x0, x1, z0 = 1.15, z1 = 2.7) {
  poly(c, quadY(0, x0 - 0.08, x1 + 0.08, z0 - 0.08, z1 + 0.08), '#4e341f');
  const n = 14; for (let i = 0; i < n; i++) { const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n; const k = i / n; poly(c, quadY(0.005, x0, x1, za, zb), `rgb(${Math.round(150 + 60 * k)},${Math.round(200 + 30 * k)},${Math.round(225 + 20 * k)})`); }
  for (const [cx, cz] of [[0.3, 0.75], [0.62, 0.6]]) { const xx = x0 + (x1 - x0) * cx, zz = z0 + (z1 - z0) * cz; poly(c, quadY(0.006, xx - 0.3, xx + 0.3, zz, zz + 0.12), 'rgba(255,255,255,.75)'); poly(c, quadY(0.006, xx - 0.15, xx + 0.2, zz + 0.1, zz + 0.2), 'rgba(255,255,255,.75)'); }
  poly(c, quadY(0.006, x0, x1, z0, z0 + 0.35), 'rgba(90,140,90,.35)');
  const m = (x1 - x0) / 2; for (let x = x0; x <= x1 + 0.01; x += m) poly(c, quadY(0.007, x - 0.04, x + 0.04, z0, z1), '#5d4a36');
  poly(c, quadY(0.007, x0, x1, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03), '#5d4a36');
  poly(c, quadY(0.008, x0 + 0.1, x0 + 0.5, z0 + 0.1, z1 - 0.1), 'rgba(255,255,255,.18)');
  box(c, x0 - 0.12, 0, z0 - 0.12, x1 - x0 + 0.24, 0.16, 0.06, '#7a5232', { ol: false });
}
function windowX(c, y0, y1, z0 = 1.15, z1 = 2.7) {
  poly(c, quadX(0, y0 - 0.08, y1 + 0.08, z0 - 0.08, z1 + 0.08), '#4e341f');
  const n = 14; for (let i = 0; i < n; i++) { const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n; const k = i / n; poly(c, quadX(0.005, y0, y1, za, zb), `rgb(${Math.round(150 + 60 * k)},${Math.round(200 + 30 * k)},${Math.round(225 + 20 * k)})`); }
  poly(c, quadX(0.006, y0, y1, z0, z0 + 0.35), 'rgba(90,140,90,.35)');
  const m = (y1 - y0) / 2; for (let y = y0; y <= y1 + 0.01; y += m) poly(c, quadX(0.007, y - 0.04, y + 0.04, z0, z1), '#5d4a36');
  poly(c, quadX(0.007, y0, y1, (z0 + z1) / 2 - 0.03, (z0 + z1) / 2 + 0.03), '#5d4a36');
  poly(c, quadX(0.008, y1 - 0.5, y1 - 0.1, z0 + 0.1, z1 - 0.1), 'rgba(255,255,255,.18)');
}
function frameY(c, x0, x1, z0, z1, art) { poly(c, quadY(0, x0, x1, z0, z1), '#3d2a1a'); poly(c, quadY(0.005, x0 + 0.08, x1 - 0.08, z0 + 0.08, z1 - 0.08), '#c9a24a'); poly(c, quadY(0.01, x0 + 0.14, x1 - 0.14, z0 + 0.14, z1 - 0.14), art[0]); poly(c, quadY(0.012, x0 + 0.14, x1 - 0.14, z0 + 0.14, (z0 + z1) / 2), art[1]); }
function frameX(c, y0, y1, z0, z1, art) { poly(c, quadX(0, y0, y1, z0, z1), '#3d2a1a'); poly(c, quadX(0.005, y0 + 0.08, y1 - 0.08, z0 + 0.08, z1 - 0.08), '#c9a24a'); poly(c, quadX(0.01, y0 + 0.14, y1 - 0.14, z0 + 0.14, z1 - 0.14), art[0]); poly(c, quadX(0.012, y0 + 0.14, y1 - 0.14, z0 + 0.14, (z0 + z1) / 2), art[1]); }
function boardY(c, x0, x1, z0, z1, face) { poly(c, quadY(0, x0, x1, z0, z1), '#2a1a0e'); poly(c, quadY(0.004, x0 + 0.05, x1 - 0.05, z0 + 0.05, z1 - 0.05), '#6b4426'); poly(c, quadY(0.008, x0 + 0.12, x1 - 0.12, z0 + 0.1, z1 - 0.1), face); poly(c, quadY(0.01, x0 + 0.12, x1 - 0.12, z1 - 0.3, z1 - 0.1), 'rgba(255,255,255,.05)'); }
const SHADOWS = () => {
  const L = [];
  for (const p of people) L.push([p.d.x, p.d.y, p.d.w, p.d.d, 0.7]);
  L.push([8.9, 1.95, 3.8, 1.6, 0.7], [0.05, 13.3, 0.7, 1.3, 1.1], [14.2, 0.25, 0.9, 0.7, 0.9], [15.3, 0.3, 0.45, 0.45, 1.1], [19.6, 0.05, 1.6, 0.45, 1.9], [20.9, 4.0, 0.9, 0.7, 0.6], [15.7, 6.4, 3.9, 0.7, 1.2]);
  for (const [x, y] of PLANTS) L.push([x, y, 0.5, 0.5, 0.9]);
  return L;
};
const PLANTS = [[0.3, 0.3], [6.9, 0.4], [13.3, 0.4], [16.4, 4.6], [0.3, 15.2], [8.3, 11.35], [8.2, 7.9], [21.4, 0.5], [2.15, 7.15]];
const PALLETS = [[13.3, 13.4, 3], [15.3, 13.8, 2], [17.4, 13.3, 3], [19.3, 14.0, 4], [14.6, 14.85, 2]];
function drawBase() {
  const s = homePS * DPR, legW = MAX_X - MIN_X, legH = MAX_Y - MIN_Y;
  base.width = Math.max(1, Math.ceil(legW * s)); base.height = Math.max(1, Math.ceil(legH * s));
  const c = bg;
  c.setTransform(s, 0, 0, s, -MIN_X * s, -MIN_Y * s);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.fillStyle = '#1a1410'; c.fillRect(MIN_X, MIN_Y, legW, legH);
  // ---- warehouse (down a level)
  for (let x = WH.x0; x < WH.x1; x++) for (let y = Math.floor(WH.y0); y < WH.y1; y++) {
    const y0 = Math.max(y, WH.y0), n = hsh(x, y);
    poly(c, [P(x, y0, WH.z), P(x + 1, y0, WH.z), P(x + 1, y + 1, WH.z), P(x, y + 1, WH.z)], shade('#8b8984', 0.92 + n * 0.12));
    for (let k = 0; k < 4; k++) { const p = P(x + hsh(x * 3 + k, y) * 0.95, Math.max(y0, y + hsh(x, y * 5 + k) * 0.95), WH.z); c.fillStyle = k % 2 ? 'rgba(60,60,60,.18)' : 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(p[0], p[1], 0.28, 0, Math.PI * 2); c.fill(); }
    if (x % 2 === 0) seg(c, P(x, y0, WH.z), P(x, y + 1, WH.z), 'rgba(60,58,55,.35)');
  }
  for (const yy of [13.9, 17.4]) { poly(c, [P(15.6, yy, WH.z), P(25.6, yy, WH.z), P(25.6, yy + 0.12, WH.z), P(15.6, yy + 0.12, WH.z)], '#e0b43a'); }
  for (let x = 16; x < 25.5; x += 0.9) poly(c, [P(x, 13.4, WH.z), P(x + 0.4, 13.4, WH.z), P(x + 0.55, 13.9, WH.z), P(x + 0.15, 13.9, WH.z)], 'rgba(30,30,30,.0)');
  // pit walls: painted block
  poly(c, quadY(WH.y0, WH.x0, WH.x1, WH.z, 0), '#9a8a76');
  for (let z = WH.z + 0.25; z < 0; z += 0.25) poly(c, quadY(WH.y0 + 0.002, WH.x0, WH.x1, z, z + 0.02), 'rgba(70,55,40,.35)');
  for (let z = WH.z, r = 0; z < 0; z += 0.25, r++) for (let x = WH.x0 + (r % 2) * 0.35; x < WH.x1; x += 0.7) poly(c, quadY(WH.y0 + 0.002, x, x + 0.02, z, z + 0.25), 'rgba(70,55,40,.3)');
  poly(c, quadY(WH.y0 + 0.003, WH.x0, WH.x1, WH.z, WH.z + 0.5), '#5b6e86');
  poly(c, quadY(WH.y0, WH.x0, WH.x1, -0.25, 0), '#5a4636');
  poly(c, quadX(WH.x0, WH.y0, ST.y0, WH.z, 0), '#857562'); poly(c, quadX(WH.x0, ST.y1, WH.y1, WH.z, 0), '#857562');
  poly(c, quadX(WH.x0 + 0.003, WH.y0, ST.y0, WH.z, WH.z + 0.5), '#4f6075'); poly(c, quadX(WH.x0 + 0.003, ST.y1, WH.y1, WH.z, WH.z + 0.5), '#4f6075');
  poly(c, quadY(ST.y0, ST.x0, ST.x1, WH.z, 0), '#9a8a76');
  for (const [x0, lbl] of [[15.0, 1], [18.6, 2]]) {
    poly(c, quadY(WH.y0 + 0.004, x0 - 0.1, x0 + 2.5, WH.z, WH.z + 1.72), '#3d3d3d');
    poly(c, quadY(WH.y0 + 0.006, x0, x0 + 2.4, WH.z, WH.z + 1.62), '#c3beb2');
    for (let z = WH.z + 0.12; z < WH.z + 1.6; z += 0.16) poly(c, quadY(WH.y0 + 0.008, x0, x0 + 2.4, z, z + 0.035), '#9d988c');
    poly(c, quadY(WH.y0 + 0.01, x0, x0 + 2.4, WH.z, WH.z + 0.12), '#e0b43a');
    poly(c, quadY(WH.y0 + 0.01, x0 + 0.85, x0 + 1.55, WH.z + 1.75, WH.z + 1.97), '#1d1d1d');
    poly(c, quadY(WH.y0 + 0.012, x0 + 0.1, x0 + 0.25, WH.z + 1.75, WH.z + 1.9), lbl === 1 ? '#5f5' : '#f55');
  }
  // ---- office floor
  for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) {
    const cx = x + 0.5, cy = y + 0.5;
    if (inR(cx, cy, WH) || inR(cx, cy, ST)) continue;
    const n = hsh(x, y); let y1 = y + 1; if (x >= WH.x0 && y + 1 > WH.y0 && y < WH.y0) y1 = WH.y0;
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
  // window light on the floor
  for (const [x0, x1] of [[0.6, 2.8], [14.1, 15.9]]) poly(c, [P(x0 + 0.3, 0.3), P(x1 + 0.3, 0.3), P(x1 + 1.4, 2.8), P(x0 + 1.4, 2.8)], 'rgba(255,236,180,.16)');
  poly(c, [P(0.3, 1.9), P(0.3, 3.7), P(2.6, 4.7), P(2.6, 2.9)], 'rgba(255,236,180,.13)');
  // contact shadows
  for (const s of SHADOWS()) shadow(c, ...s);
  for (const [x, y] of PALLETS) shadow(c, x, y, 1.4, 1.1, 1.0, WH.z);
  shadow(c, 13.0, 11.7, 1.9, 0.8, 2, WH.z); shadow(c, 19.6, 11.7, 1.7, 0.8, 2, WH.z);
  // ---- front slab edges (cutaway)
  poly(c, quadY(GY, 0, WH.x0, -0.5, 0), '#4a3322'); poly(c, quadY(GY, 0, WH.x0, -0.08, 0), '#7a5a3c');
  poly(c, quadY(GY, WH.x0, GX, WH.z - 0.5, WH.z), '#4b4a47');
  poly(c, quadX(GX, 0, WH.y0, -0.5, 0), '#3a2719'); poly(c, quadX(GX, 0, WH.y0, -0.08, 0), '#6a4c32');
  poly(c, quadX(GX, WH.y0, GY, WH.z - 0.5, WH.z), '#3c3b38');
  // ---- back walls
  box(c, -0.4, -0.4, 0, 0.4, 0.4, WALL, '#3b2a1c', { ol: false });
  box(c, -0.4, 0, 0, 0.4, GY, WALL, '#2f2216', { r: '#e6d6b4', l: '#4a3322', ol: false });
  box(c, 0, -0.4, 0, GX, 0.4, WALL, '#2f2216', { l: '#ddcca8', r: '#4a3322', ol: false });
  wallX(c, 0, GY); wallY(c, 0, MGR.x0, false); wallY(c, MGR.x0, GX, true);
  // corner + ceiling shade
  poly(c, [P(0, 0, 0), P(0, 0, WALL), P(0, 1.6, WALL), P(0, 1.6, 0)], 'rgba(40,20,5,.12)');
  poly(c, [P(0, 0, 0), P(0, 0, WALL), P(1.6, 0, WALL), P(1.6, 0, 0)], 'rgba(40,20,5,.12)');
  // windows
  windowY(c, 0.6, 2.8); windowY(c, 14.1, 15.9); windowX(c, 1.8, 3.8);
  // whiteboard (left wall)
  poly(c, quadX(0, 4.6, 8.4, 0.95, 2.55), '#8e959b'); poly(c, quadX(0.005, 4.66, 8.34, 1.0, 2.5), '#c9ced2');
  poly(c, quadX(0.01, 4.72, 8.28, 1.05, 2.45), '#f8f8f4'); poly(c, quadX(0.012, 7.1, 8.2, 1.9, 2.4), 'rgba(160,190,220,.15)');
  box(c, 0, 5.0, 0.86, 0.12, 3.0, 0.06, '#6f757b', { ol: false });
  for (const [y, col] of [[5.4, '#d33'], [5.7, '#33c'], [6.0, '#2a2']]) box(c, 0.03, y, 0.92, 0.06, 0.2, 0.04, col, { ol: false });
  // HQ status board (back wall)
  boardY(c, 3.0, 7.2, 0.95, 2.7, '#14110e');
  // Team Board (conference back wall)
  boardY(c, 7.62, 13.9, 0.75, 2.85, '#22303a');
  // manager wall: landscape + diploma; left wall picture near reception
  frameY(c, 16.7, 18.3, 1.5, 2.45, ['#5f8f6a', '#9cc7df']); frameY(c, 18.6, 19.3, 1.6, 2.35, ['#f3ead2', '#f3ead2']);
  frameX(c, 12.4, 14.0, 1.5, 2.4, ['#4a6a8a', '#d9b46a']);
  baseDirty = false;
}
const LIGHTS = [[5.4, 8.3, 78, 0.2], [11.6, 8.3, 78, 0.2], [4.0, 13.1, 64, 0.16], [10.8, 2.8, 66, 0.18], [19, 2.6, 70, 0.24], [16.8, 9.6, 58, 0.16], [2.2, 10.0, 58, 0.16], [17, 14, 86, 0.12]];
function lights(c) {
  const LS = HX / 12;
  c.save(); c.globalCompositeOperation = 'screen';
  for (const [x, y, r0, a] of LIGHTS) {
    const r = r0 * LS, p = Pf(x, y, y > 12.5 && x > 15 ? WH.z : 0);
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
function cabinet(c, x, y) {
  box(c, x, y, 0, 0.7, 0.6, 1.1, '#a3aaaf', { l: '#8a9196', r: '#737a7f' });
  for (const z of [0.08, 0.42, 0.76]) {
    poly(c, quadX(x + 0.702, y + 0.05, y + 0.55, z, z + 0.3), '#8f969b'); poly(c, quadX(x + 0.704, y + 0.07, y + 0.53, z + 0.02, z + 0.28), '#9aa1a6');
    poly(c, quadX(x + 0.706, y + 0.22, y + 0.38, z + 0.16, z + 0.2), '#3a3f43'); poly(c, quadX(x + 0.706, y + 0.24, y + 0.36, z + 0.22, z + 0.26), '#f2efe6');
  }
}
function ream(c, x, y, z, w, d, band) {
  box(c, x, y, z, w, d, 0.27, '#f4f2ec', { l: '#dedbd2', r: '#c4c0b6' });
  poly(c, quadY(y + d + 0.002, x, x + w, z + 0.09, z + 0.16), band); poly(c, quadX(x + w + 0.002, y, y + d, z + 0.09, z + 0.16), shade(band, 0.75));
}
function pallet(c, x, y, layers = 3) {
  box(c, x, y, WH.z, 1.4, 1.1, 0.16, '#a07a4a', { l: '#86643a', r: '#6e512e' });
  for (const f of [0.25, 0.65, 1.05]) poly(c, quadY(y + 1.1 + 0.002, x + f, x + f + 0.2, WH.z, WH.z + 0.1), '#3a2a18');
  for (const f of [0.2, 0.6]) poly(c, quadX(x + 1.4 + 0.002, y + f, y + f + 0.25, WH.z, WH.z + 0.1), '#3a2a18');
  for (let i = 0; i < layers; i++) {
    const z = WH.z + 0.16 + i * 0.28;
    ream(c, x + 0.06, y + 0.06, z, 0.62, 0.48, '#3d7ec4'); ream(c, x + 0.72, y + 0.06, z, 0.62, 0.48, '#3d7ec4');
    ream(c, x + 0.06, y + 0.56, z, 0.62, 0.48, '#3d7ec4'); ream(c, x + 0.72, y + 0.56, z, 0.62, 0.48, '#3d7ec4');
    // plastic wrap sheen
    poly(c, [P(x + 0.12, y + 0.12, z + 0.27), P(x + 0.4, y + 0.12, z + 0.27), P(x + 0.28, y + 0.32, z + 0.27)], 'rgba(255,255,255,.55)');
  }
  const zt = WH.z + 0.16 + layers * 0.28; poly(c, [P(x + 0.1, y + 0.1, zt), P(x + 0.7, y + 0.1, zt), P(x + 0.5, y + 0.35, zt)], 'rgba(255,255,255,.5)');
}
function carton(c, x, y, z, w, d, h) {
  box(c, x, y, z, w, d, h, '#c99b62', { l: '#b0844f', r: '#93693b' });
  poly(c, [P(x + w * 0.45, y, z + h), P(x + w * 0.55, y, z + h), P(x + w * 0.55, y + d, z + h), P(x + w * 0.45, y + d, z + h)], '#e3c48f');
  poly(c, quadY(y + d + 0.002, x + w * 0.2, x + w * 0.45, z + h * 0.3, z + h * 0.6), '#f2ead8');
}
function rack(c, x, y, w) {
  for (let i = 0; i <= w + 0.01; i += w / 2) box(c, x + i, y, WH.z, 0.1, 0.8, 2.0, '#3d5a80', { l: '#35507a', r: '#2b4266' });
  for (const z of [0.0, 0.7, 1.4]) {
    box(c, x, y, WH.z + z + 0.05, w + 0.1, 0.8, 0.07, '#e08a2a', { l: '#c47422', r: '#a8601c' });
    for (let k = 0; k < w - 0.3; k += 0.75) carton(c, x + 0.15 + k, y + 0.1, WH.z + z + 0.12, 0.6, 0.6, 0.42 + ((k * 7 | 0) % 2) * 0.08);
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
  // inner bezel
  poly(c, quadY(y + d + 0.002, x + 0.05, x + w - 0.05, z + 0.2, z + 0.14 + h - 0.04), '#2a261e');
  const glass = busy ? '#86f06a' : '#245c48';
  poly(c, quadY(y + d + 0.004, x + 0.09, x + w - 0.09, z + 0.26, z + 0.14 + h - 0.08), glass);
  if (busy) {
    for (let i = 0; i < 4; i++) {
      const zz = z + 0.14 + h - 0.16 - i * 0.09;
      const len = 0.18 + hsh(k + i, (t * 3 | 0)) * 0.32;
      poly(c, quadY(y + d + 0.006, x + 0.14, x + 0.14 + len, zz, zz + 0.03), 'rgba(12,50,16,.55)');
    }
    poly(c, quadY(y + d + 0.006, x + 0.1, x + w - 0.12, z + 0.14 + h - 0.14, z + 0.14 + h - 0.1), 'rgba(255,255,255,.28)');
    const q = P(x + w * 0.5, y + d, z + 0.14 + h * 0.55);
    const gr = c.createRadialGradient(q[0], q[1], 1, q[0], q[1], 18);
    gr.addColorStop(0, 'rgba(130,255,110,.4)'); gr.addColorStop(1, 'rgba(130,255,110,0)');
    c.fillStyle = gr; c.fillRect(q[0] - 18, q[1] - 14, 36, 28);
  } else {
    poly(c, quadY(y + d + 0.006, x + 0.09, x + w - 0.09, z + 0.3, z + 0.14 + h - 0.12), 'rgba(90,180,140,.16)');
    poly(c, quadY(y + d + 0.006, x + 0.14, x + 0.46, z + 0.48, z + 0.6), 'rgba(190,240,210,.28)');
    poly(c, quadY(y + d + 0.006, x + 0.16, x + 0.38, z + 0.36, z + 0.42), 'rgba(190,240,210,.16)');
    const q = P(x + w * 0.45, y + d, z + 0.14 + h * 0.6);
    const gr = c.createRadialGradient(q[0], q[1], 1, q[0], q[1], 14);
    gr.addColorStop(0, 'rgba(140,220,170,.22)'); gr.addColorStop(1, 'rgba(140,220,170,0)');
    c.fillStyle = gr; c.beginPath(); c.ellipse(q[0], q[1], 12, 8, 0, 0, Math.PI * 2); c.fill();
  }
  // power lamp + curved glass highlight
  poly(c, quadY(y + d + 0.006, x + w - 0.16, x + w - 0.09, z + 0.18, z + 0.23), busy ? '#9dff78' : '#a05040');
  poly(c, quadY(y + d + 0.005, x + 0.08, x + 0.2, z + 0.48, z + 0.64), 'rgba(255,255,255,.18)');
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
    for (let y = d.y + 0.25; y < d.y + d.d - 0.2; y += 0.8) { poly(c, quadX(d.x + d.w + 0.003, y, y + 0.65, 0.12, 0.66), '#4f2f19'); poly(c, quadX(d.x + d.w + 0.005, y + 0.04, y + 0.61, 0.16, 0.62), '#6e4426'); }
    box(c, d.x - 0.12, d.y - 0.12, 0.8, d.w + 0.24, d.d + 0.24, 0.09, '#b07c4e');
    poly(c, quadX(d.x + d.w + 0.01, d.y + 0.65, d.y + d.d - 0.65, 0.2, 0.62), '#2f1d10');
    crt(c, d.x + 0.08, d.y + 0.35, 0.89, true, t, k);
    keys(c, d.x + 0.1, d.y + 1.15, 0.89);
    paperStack(c, d.x + 0.15, d.y + 2.35, 0.89, 4);
    box(c, d.x + 0.2, d.y + 1.85, 0.89, 0.28, 0.18, 0.07, '#2a241c', { ol: false });
    mug(c, d.x + 0.55, d.y + 2.5, 0.89, '#f4efe6', '#c45438');
    hands(c, p, t, 0.89);
    return;
  }
  const top = p.s.hero ? '#7a4a2a' : '#8d5d36';
  box(c, d.x, d.y, 0, d.w, d.d, 0.62, top, { l: shade(top, 0.74), r: shade(top, 0.58), t: shade(top, 1.05) });
  // wood grain on the top
  for (let i = 1; i < 4; i++) seg(c, P(d.x + 0.08 + hsh(k, i) * 0.2, d.y + d.d * i / 4, 0.62), P(d.x + d.w - 0.1 - hsh(i, k) * 0.3, d.y + d.d * i / 4, 0.62), 'rgba(70,38,16,.28)');
  // front: modesty panel + pedestal with drawers
  poly(c, quadY(d.y + d.d + 0.003, d.x + 0.12, d.x + d.w - 0.85, 0.12, 0.52), shade(top, 0.62));
  const px0 = d.x + d.w - 0.78;
  for (const [z0, z1] of [[0.06, 0.24], [0.27, 0.42], [0.45, 0.57]]) {
    poly(c, quadY(d.y + d.d + 0.004, px0, d.x + d.w - 0.06, z0, z1), shade(top, 0.82)); poly(c, quadY(d.y + d.d + 0.005, px0 + 0.03, d.x + d.w - 0.09, z0 + 0.02, z1 - 0.02), shade(top, 0.74));
    poly(c, quadY(d.y + d.d + 0.006, px0 + 0.28, px0 + 0.44, (z0 + z1) / 2 - 0.02, (z0 + z1) / 2 + 0.02), '#e2c98e');
  }
  poly(c, quadX(d.x + d.w + 0.003, d.y + 0.08, d.y + d.d - 0.08, 0.08, 0.52), shade(top, 0.5));
  // desk stuff
  const id = p.s.id;
  if (d.away) {
    crt(c, d.x + 0.15, d.y + 0.02, 0.62, busy, t, k);
    keys(c, d.x + d.w * 0.28, d.y + d.d - 0.28, 0.62);
    paperStack(c, d.x + 0.08, d.y + 0.08, 0.62, 2 + (k % 3));
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
  hands(c, p, t, 0.62);
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

// ---------- scene objects (depth sorted) ----------
function sceneItems(t) {
  const it = [];
  const add = (k, fn) => it.push({ k, fn });
  // glass + low walls
  const refl = (q) => { // q = [TL, TR, BR, BL] of a glass pane: two diagonal light streaks
    const L = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    for (const [f, w, a] of [[0.15, 0.12, 0.22], [0.4, 0.05, 0.16]]) poly(c0, [L(q[3], q[2], f), L(q[3], q[2], f + w), L(q[0], q[1], f + w + 0.3), L(q[0], q[1], f + 0.3)], `rgba(255,255,255,${a})`);
  };
  let c0 = null;
  const glassY = (y, x0, x1, z0 = 0.35, z1 = 2.6) => add(x0 / 2 + x1 / 2 + y + 0.02, c => { c0 = c;
    box(c, x0, y - 0.06, 0, x1 - x0, 0.12, z0, '#6b4a2e');
    const q = quadY(y, x0, x1, z0, z1);
    const gg = c.createLinearGradient(q[0][0], q[0][1], q[3][0], q[3][1]);
    gg.addColorStop(0, 'rgba(214,238,248,.32)'); gg.addColorStop(0.45, 'rgba(150,205,228,.14)'); gg.addColorStop(1, 'rgba(186,214,224,.24)');
    poly(c, q, gg); refl(q);
    for (let x = x0; x <= x1 + 0.001; x += 1.5) poly(c, quadY(y, Math.min(x, x1) - 0.03, Math.min(x, x1) + 0.03, z0, z1), '#56646e');
    poly(c, quadY(y, x0, x1, z1 - 0.06, z1), '#56646e'); seg(c, P(x0, y, z1), P(x1, y, z1), 'rgba(255,255,255,.4)');
  });
  const glassX = (x, y0, y1, z0 = 0.35, z1 = 2.6) => add(x + y0 / 2 + y1 / 2 - 0.3, c => { c0 = c;
    box(c, x - 0.06, y0, 0, 0.12, y1 - y0, z0, '#6b4a2e');
    const q = quadX(x, y0, y1, z0, z1);
    const gg = c.createLinearGradient(q[0][0], q[0][1], q[2][0], q[2][1]);
    gg.addColorStop(0, 'rgba(214,238,248,.30)'); gg.addColorStop(0.5, 'rgba(150,205,228,.13)'); gg.addColorStop(1, 'rgba(186,214,224,.22)');
    poly(c, q, gg); refl(q);
    for (let y = y0; y <= y1 + 0.001; y += 1.5) poly(c, quadX(x, Math.min(y, y1) - 0.03, Math.min(y, y1) + 0.03, z0, z1), '#56646e');
    poly(c, quadX(x, y0, y1, z1 - 0.06, z1), '#56646e'); seg(c, P(x, y0, z1), P(x, y1, z1), 'rgba(255,255,255,.4)');
  });
  // conference room: side glass + front glass with a door gap
  for (const [a, b] of [[0, 1.4], [1.4, 2.8], [2.8, 4.15], [4.15, 5.5]]) glassX(CONF.x0, a, b);
  glassY(CONF.y1, 7.5, 8.9); glassY(CONF.y1, 8.9, 10.3); glassY(CONF.y1, 11.3, 12.65); glassY(CONF.y1, 12.65, 14);
  // manager office: side glass (door gap) + low front wall
  for (const [a, b] of [[0, 1.4], [1.4, 2.8], [2.8, 3.6]]) glassX(MGR.x0, a, b);
  glassX(MGR.x0, 4.8, 5.5);
  for (let x = MGR.x0; x < GX; x += 1) add(x + 0.5 + MGR.y1 + 0.02, c => box(c, x, MGR.y1 - 0.08, 0, 1, 0.16, 0.55, '#6b4a2e', { t: '#8a6440' }));
  // conference table + chairs
  add(10.8 + 2.75, c => {
    box(c, 9.1, 2.1, 0, 0.12, 0.12, 0.55, '#3a2416'); box(c, 12.4, 3.3, 0, 0.12, 0.12, 0.55, '#3a2416');
    box(c, 8.9, 1.95, 0.55, 3.8, 1.6, 0.12, '#6a3e22', { t: '#7d4a2a' });
    for (let i = 1; i < 4; i++) seg(c, P(9.0, 1.95 + i * 0.4, 0.67), P(12.6, 1.95 + i * 0.4, 0.67), 'rgba(60,30,12,.3)');
    box(c, 10.6, 2.6, 0.67, 0.4, 0.3, 0.1, '#222'); // speakerphone
    paperStack(c, 9.3, 2.9, 0.67, 2);
  });
  for (const x of [9.2, 10.4, 11.6]) {
    add(x + 1.3 - 0.5, c => { box(c, x, 1.15, 0.42, 0.5, 0.1, 0.55, '#2f4a8a', { l: '#2a4078', r: '#223463' }); chair(c, x, 1.25, '#3a5aa8'); });
    add(x + 4.1 + 0.3, c => { chair(c, x, 3.65, '#3a5aa8'); box(c, x, 4.1, 0.42, 0.5, 0.1, 0.55, '#2f4a8a', { l: '#2a4078', r: '#223463' }); });
  }
  // kitchen: copier, water cooler
  add(14.6 + 0.7, c => { box(c, 14.2, 0.25, 0, 0.9, 0.7, 0.85, '#d6d6d0', { l: '#bdbdb6', r: '#a3a39c' }); box(c, 14.3, 0.3, 0.85, 0.7, 0.5, 0.08, '#8a8a84'); poly(c, quadX(15.101, 0.35, 0.85, 0.5, 0.7), '#7ad07a'); });
  add(15.5 + 0.7, c => { box(c, 15.35, 0.3, 0, 0.45, 0.45, 0.85, '#e7e7e2'); box(c, 15.4, 0.35, 0.85, 0.35, 0.35, 0.35, '#7cc0e6', { l: '#63a6cc', r: '#4f8fb3' }); });
  // manager office furniture
  add(20.3 + 0.3, c => { box(c, 19.6, 0.05, 0, 1.6, 0.45, 1.9, '#5a3820', { t: '#6e4628' }); poly(c, quadY(0.501, 19.68, 21.12, 0.08, 1.82), '#2e1c0e'); for (let z = 0.12; z < 1.8; z += 0.43) { box(c, 19.62, 0.06, z - 0.05, 1.56, 0.44, 0.05, '#6e4628', { ol: false }); for (let k = 0; k < 7; k++) { const hh = 0.26 + hsh(k, z * 10 | 0) * 0.1; box(c, 19.7 + k * 0.205, 0.2, z, 0.17, 0.26, hh, ['#a33', '#36a', '#3a6', '#c93', '#639', '#933', '#2a6a6a'][(k + (z * 10 | 0)) % 7], { ol: false }); } } });
  add(21.3 + 4.4, c => { box(c, 20.9, 4.0, 0, 0.9, 0.7, 0.6, '#6a3e22'); paperStack(c, 21.1, 4.2, 0.6, 3); });
  // plants + cabinets
  for (const [x, y] of PLANTS) add(x + y + 0.45, c => plant(c, x, y, 1.2));
  for (const y of [13.3, 13.95]) add(0.35 + y + 0.3, c => cabinet(c, 0.05, y));
  // design wall (free-standing cork board on legs, faces the bullpen)
  add(14.2 + 6.4, c => {
    box(c, 15.4, 6.55, 0, 0.12, 0.12, 2.45, '#5a3820'); box(c, 20.0, 6.55, 0, 0.12, 0.12, 2.45, '#5a3820');
    box(c, 15.8, 6.65, 0, 3.9, 0.45, 0.62, '#6a4226');
    box(c, 15.3, 6.4, 0.8, 4.9, 0.18, 1.7, '#4a2e1a', { l: '#5c3a20' });
    poly(c, quadY(6.581, 15.4, 20.1, 0.88, 2.42), '#c8a071');
    for (let k = 0; k < 40; k++) { const p = P(15.5 + hsh(k, 1) * 4.5, 6.58, 0.95 + hsh(1, k) * 1.4); c.fillStyle = 'rgba(120,80,40,.35)'; c.fillRect(p[0], p[1], 1, 1); }
    const cols = ['#efe3c8', '#24324f', '#efe3c8'];
    for (let i = 0; i < 3; i++) {
      const x0 = 15.6 + i * 1.5;
      poly(c, quadY(6.582, x0, x0 + 1.3, 0.95, 2.1), '#fbf6ea');
      const img = deckImgs[i];
      if (img && img.complete && img.naturalWidth) inPlane(c, 1, PLANE_Y(x0 + 0.08, 6.583, 2.04), 100, cc => cc.drawImage(img, 0, 0, 114, 100));
      else inPlane(c, 1, PLANE_Y(x0 + 0.08, 6.583, 2.04), 10, cc => { // pixel tee
        const tee = () => { cc.beginPath(); cc.moveTo(3.6, 0.4); cc.lineTo(8, 0.4); cc.lineTo(11.4, 2.6); cc.lineTo(10, 4.6); cc.lineTo(8.8, 3.8); cc.lineTo(8.8, 10.4); cc.lineTo(2.8, 10.4); cc.lineTo(2.8, 3.8); cc.lineTo(1.6, 4.6); cc.lineTo(0.2, 2.6); cc.closePath(); };
        cc.fillStyle = 'rgba(40,20,5,.35)'; cc.save(); cc.translate(0.5, 0.4); tee(); cc.fill(); cc.restore();
        cc.fillStyle = cols[i]; tee(); cc.fill(); cc.strokeStyle = '#2a1c10'; cc.lineWidth = 0.5; cc.stroke();
        cc.fillStyle = 'rgba(0,0,0,.12)'; cc.fillRect(7.6, 3.8, 1.2, 6.6);
        cc.fillStyle = shade(cols[i], 0.8); cc.beginPath(); cc.ellipse(5.8, 0.6, 1.4, 0.8, 0, 0, Math.PI); cc.fill();
        const ink = i === 1 ? '#efe3c8' : '#24324f'; cc.fillStyle = ink; cc.beginPath(); cc.arc(5.8, 5.2, 1.5, 0, Math.PI * 2); cc.fill();
        cc.fillStyle = i === 1 ? '#24324f' : '#efe3c8'; cc.fillRect(5.5, 4.4, 0.6, 1.6); cc.fillRect(5.0, 4.9, 1.6, 0.5);
        cc.fillStyle = ink; cc.fillRect(4.0, 7.2, 3.6, 0.5); cc.fillRect(4.5, 8.0, 2.6, 0.4);
      });
      { const p = P(x0 + 0.65, 6.583, 2.12); c.fillStyle = '#d33'; c.fillRect(p[0] - 1, p[1] - 1, 2, 2); }
    }
  });
  // reception extras
    // warehouse: racks + pallets
  add(16.5 + 12.1, c => { rack(c, 13.0, 11.7, 1.8); rack(c, 19.6, 11.7, 1.6); });
  for (const [x, y, n] of PALLETS) add(x + y + 1.2, c => pallet(c, x, y, n));
  add(21.3 + 13.9, c => { carton(c, 21.0, 13.5, WH.z, 0.7, 0.6, 0.5); carton(c, 21.05, 13.55, WH.z + 0.5, 0.6, 0.5, 0.45); carton(c, 21.1, 14.3, WH.z, 0.6, 0.6, 0.5); });
  add(17.6 + 15.4, c => { carton(c, 16.8, 15.1, WH.z, 0.7, 0.6, 0.5); carton(c, 17.6, 15.2, WH.z, 0.6, 0.5, 0.4); });
  // stairs down
  for (let i = 0; i < ST.n; i++) {
    const x = ST.x0 + i * (ST.x1 - ST.x0) / ST.n, top = -(i + 1) * (-WH.z) / ST.n, w = (ST.x1 - ST.x0) / ST.n;
    add(x + w + ST.y0 + 1 - 0.5, c => box(c, x, ST.y0, WH.z, w, ST.y1 - ST.y0, top - WH.z, '#8a6a4a', { t: i % 2 ? '#a5835e' : '#9a7a56', l: '#6e5238', r: '#5a432e' }));
  }
  add(10.5 + ST.y1 + 0.6, c => { // railing on the near side
    const a = P(ST.x0, ST.y1, 0.9), b = P(ST.x1, ST.y1, WH.z + 0.9); c.strokeStyle = '#2a2a2a'; c.lineWidth = 0.85; c.lineCap = 'round'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    for (let i = 0; i <= ST.n; i += 2) { const x = ST.x0 + i * 0.5, z = -(i) * (-WH.z) / ST.n; const p = P(x, ST.y1, z), q = P(x, ST.y1, z + 0.9); c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.stroke(); }
  });
  add(ST.x0 + ST.y0 - 0.3, c => { // warehouse sign on posts
    box(c, 9.4, 12.5, 0, 0.08, 0.08, 1.9, '#333'); box(c, 11.5, 12.5, 0, 0.08, 0.08, 1.9, '#333');
    poly(c, quadY(12.6, 9.3, 11.7, 1.55, 2.15), '#1f7a3a'); poly(c, quadY(12.61, 9.36, 11.64, 1.6, 2.1), '#2a9a4a');
  });
  // desks + workers
  for (const p of people) {
    const d = p.d;
    add(p.seat[0] + p.seat[1], c => drawWorker(c, p, t));
    add(d.x + d.w / 2 + d.y + d.d / 2 + 0.2, c => deskDraw(c, p, t));
  }
  return it.sort((a, b) => a.k - b.k);
}
let sel = null;          // selected station id
function drawWorker(c, p, t) {
  const [sx, sy] = P(p.seat[0], p.seat[1], SEATZ), st = stateOf(p.s.id), busy = st === 'active';
  const S = CREW_SC, top = sy + CREW_HIT.y * S;
  const want = (hoverId === p.s.id || sel === p.s.id) ? 1 : 0;
  p.glow = (p.glow || 0) + (want - (p.glow || 0)) * Math.min(1, frameDt * 9);
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
  if (t > p.blinkAt) p.blinkAt = t + 2.3 + Math.random() * 3.6;
  const breath = Math.sin(t * 1.7 + p.phase);
  const bob = (busy ? Math.max(0, Math.sin(t * 7.2 + p.phase)) * 0.7 : 0) + breath * 0.28;
  c.save();
  c.translate(sx, sy);
  c.scale(S * (1 + breath * 0.012), S * (1 + breath * 0.022));
  paintCrew(c, p.s.id, 0, 0, { back: !!p.d.away, blink: p.blinkAt - t < 0.11, bob });
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
  hits.push({ kind: 'worker', id: p.s.id, r: [sx + CREW_HIT.x * S, sy + CREW_HIT.y * S, CREW_HIT.w * S, CREW_HIT.h * S] });
  { const d = p.d; hits.push({ kind: 'worker', id: p.s.id, poly: [P(d.x, d.y, 0.6), P(d.x + d.w, d.y, 0.6), P(d.x + d.w, d.y + d.d, 0), P(d.x, d.y + d.d, 0)] }); }
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
function textPass(t) {
  const S = 1, c = ctx;
  // Team Board (conference back wall). Face is inset 0.12 from the frame, so text starts at 7.74 and runs 6.04 units.
  inPlane(c, S, PLANE_Y(7.74, 0.02, 2.75), 40, cc => {
    const Wd = 6.04 * 40, colW = (Wd - 16) / 3; cc.textBaseline = 'middle';
    const cols = [['IN PROGRESS', '#6fd35b', PROJECTS.filter(p => p.status === 'active' || p.status === 'done').map(p => p.short || p.title)],
      ['TEAM BOARD', '#f2b33d', PROJECTS.filter(p => !['active', 'done'].includes(p.status)).map(p => p.short || p.title)],
      ['NEEDS YOU', '#ff6a55', [...NEEDS, ...liveNeeds()].map(n => n.short || n.title)]];
    cols.forEach(([h, col, items], i) => {
      const x = 4 + i * (colW + 4);
      cc.fillStyle = col; cc.fillRect(x, 3, colW, 16);
      cc.fillStyle = '#16120e';
      const count = String(items.length);
      cc.font = `700 8px ${FONT}`;
      const countW = cc.measureText(count).width + 4;
      const label = fontFit(cc, h, colW - countW - 8, 8, 6.5);
      cc.fillText(label, x + 3, 11);
      cc.textAlign = 'right'; cc.fillText(count, x + colW - 3, 11); cc.textAlign = 'left';
      const show = items.length > 3 ? items.slice(0, 2) : items;
      show.forEach((t, k) => {
        const y = 23 + k * 17; cc.fillStyle = '#f3ead2'; cc.fillRect(x, y, colW, 14); cc.fillStyle = col; cc.fillRect(x, y, 3, 14); cc.fillStyle = '#1d1a16';
        const card = fontFit(cc, t, colW - 10, 8.5, 7);
        cc.fillText(cc.measureText(card).width <= colW - 10 ? card : fitText(cc, card, colW - 10), x + 6, y + 7.5);
      });
      if (items.length > 3) { cc.fillStyle = '#d8d2c2'; const more = fontFit(cc, `+${items.length - 2} more`, colW - 8, 8, 7); cc.fillText(more, x + 4, 23 + 2 * 17 + 7); }
    });
  });
  // HQ status board (back wall, real counts)
  inPlane(c, S, PLANE_Y(3.12, 0.02, 2.6), 40, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#f0c14a'; cc.font = `700 11px ${FONT}`; cc.fillText('PAPER TICKER', 6, 9);
    const shortSt = p => p.status === 'done' ? 'LIVE' : p.status === 'waiting' ? 'REVIEW' : p.status === 'active' ? 'LIVE' : p.status === 'blocked' ? 'STUCK' : 'HOLD';
    const rows = PROJECTS.slice(0, 3).map(p => [p.short || p.title, shortSt(p), p.status === 'done' || p.status === 'active' ? '#7dff78' : p.status === 'waiting' ? '#f0c14a' : '#e7d7b0']);
    rows.push(['Needs you', String(needsCount()), '#ff8a72']);
    cc.font = `700 10px ${FONT}`;
    rows.forEach(([k, v, col], i) => { const y = 22 + i * 11; cc.fillStyle = '#d9cbb0'; cc.fillText(fitText(cc, k, 100), 6, y); cc.fillStyle = col; cc.textAlign = 'right'; cc.fillText(v, 158, y); cc.textAlign = 'left'; });
  });
  // whiteboard (left wall, text runs toward the back corner): 3 short lines
  inPlane(c, S, PLANE_X(0.03, 8.28, 2.45), 40, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#1d3f8f'; cc.font = `700 12px ${FONT}`; cc.fillText(fitText(cc, "Today's priorities", 130), 6, 9);
    cc.font = `700 10px ${FONT}`;
    const etsy = PROJECTS.find(p => p.id === 'etsy'), att = PROJECTS.find(p => p.id === 'att');
    const lines = [['All projects paused', '#222'], [etsy?.status === 'waiting' ? 'Etsy ID in review' : 'Etsy shop paused', '#a8601c'], [att?.due ? `AT&T due ${att.due}` : 'AT&T paused', '#a52a1c']];
    lines.forEach(([t, col], i) => { cc.fillStyle = col; cc.fillText('\u2022 ' + noLig(t), 6, 24 + i * 11); });
  });
  // wall clock (real CT time) above the whiteboard
  inPlane(c, S, PLANE_X(0.03, 10.0, 2.95), 22, cc => {
    const { h, m } = ctTime(); const r = 10;
    cc.fillStyle = '#fff'; cc.strokeStyle = '#222'; cc.lineWidth = 2; cc.beginPath(); cc.arc(r + 2, r + 2, r, 0, Math.PI * 2); cc.fill(); cc.stroke();
    cc.lineWidth = 1.6; const hand = (a, len) => { cc.beginPath(); cc.moveTo(r + 2, r + 2); cc.lineTo(r + 2 + Math.sin(a) * len, r + 2 - Math.cos(a) * len); cc.stroke(); };
    hand(((h % 12) + m / 60) / 12 * Math.PI * 2, 5.5); cc.lineWidth = 1; hand(m / 60 * Math.PI * 2, 8);
  });
  // warehouse sign
  inPlane(c, S, PLANE_Y(9.36, 12.62, 2.1), 40, cc => { cc.textBaseline = 'top'; cc.fillStyle = '#fff'; cc.font = `700 11px ${FONT}`; cc.fillText('\u2193 WAREHOUSE', 9, 5); });
  // reception sign (front of the desk)
  inPlane(c, S, PLANE_X(3.11, 11.15, 0.58), 40, cc => { cc.textBaseline = 'top'; cc.fillStyle = '#f3e3c0'; cc.font = `700 8px ${FONT}`; cc.fillText('DUNDER MIFFLIN', 4, 2); cc.font = `5px ${FONT}`; cc.fillText('RECEPTION', 4, 11); });
  // design wall header
  inPlane(c, S, PLANE_Y(15.4, 6.4, 2.62), 40, cc => { cc.fillStyle = '#2a1c10'; cc.fillRect(4, 0, 76, 11); cc.textBaseline = 'top'; cc.fillStyle = '#ffd27a'; cc.font = `700 8px ${FONT}`; cc.fillText('DESIGN WALL', 8, 2); });

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
let hits = [];
function staticHits() {
  // Polygons are the same quads the painter uses, in P() space, so a rotated camera stays aligned.
  hits.push({ kind: 'board', poly: quadY(0, 7.62, 13.9, 0.75, 2.85) });       // boardY frame
  hits.push({ kind: 'status', poly: quadY(0, 3.0, 7.2, 0.95, 2.7) });          // boardY frame
  hits.push({ kind: 'whiteboard', poly: quadX(0, 4.6, 8.4, 0.95, 2.55) });    // painted frame, not the wall above it
  // design wall: cork face, the DESIGN WALL bar (drawn on the plane just above it), and the shelf
  hits.push({ kind: 'design', poly: quadY(6.582, 15.3, 20.2, 0.8, 2.5) });
  hits.push({ kind: 'design', poly: quadY(6.4, 15.5, 17.4, 2.345, 2.62) });
  hits.push({ kind: 'design', poly: [P(15.8, 6.65, 0.62), P(19.7, 6.65, 0.62), P(19.7, 7.1, 0.62), P(15.8, 7.1, 0.62)] });
  hits.push({ kind: 'design', poly: quadY(7.1, 15.8, 19.7, 0, 0.62) });
  // warehouse pit: sunken floor, the opening, the painted walls, the cutaway edges, and the sign
  const pit = (z) => [P(WH.x0, WH.y0, z), P(WH.x1, WH.y0, z), P(WH.x1, WH.y1, z), P(WH.x0, WH.y1, z)];
  hits.push({ kind: 'warehouse', poly: pit(WH.z) });
  hits.push({ kind: 'warehouse', poly: pit(0) });
  hits.push({ kind: 'warehouse', poly: quadY(WH.y0, WH.x0, WH.x1, WH.z, 0) });
  hits.push({ kind: 'warehouse', poly: quadX(WH.x0, WH.y0, ST.y0, WH.z, 0) });
  hits.push({ kind: 'warehouse', poly: quadX(WH.x0, ST.y1, WH.y1, WH.z, 0) });
  hits.push({ kind: 'warehouse', poly: quadY(GY, WH.x0, GX, WH.z - 0.5, WH.z) });
  hits.push({ kind: 'warehouse', poly: quadX(GX, WH.y0, GY, WH.z - 0.5, WH.z) });
  hits.push({ kind: 'warehouse', poly: quadY(12.6, 9.3, 11.7, 1.55, 2.15) });
}
function inPoly(x, y, pts) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function hitAt(cssX, cssY) {
  const [x, y] = cssToLeg(cssX, cssY);
  for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (h.r ? (x >= h.r[0] && x <= h.r[0] + h.r[2] && y >= h.r[1] && y <= h.r[1] + h.r[3]) : inPoly(x, y, h.poly)) return h; }
  return null;
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
  if (baseDirty) drawBase();
  const t = now();
  const c = ctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.fillStyle = '#1a1410'; c.fillRect(0, 0, cv.width, cv.height);
  camTransform(c);
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.drawImage(base, MIN_X, MIN_Y, MAX_X - MIN_X, MAX_Y - MIN_Y);
  hits = []; staticHits();
  for (const it of sceneItems(t)) it.fn(c);
  lights(c);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'multiply'; c.fillStyle = '#fff6e6'; c.fillRect(0, 0, cv.width, cv.height);
  c.globalCompositeOperation = 'source-over';
  if (!vig || vig.w !== cv.width || vig.h !== cv.height) {
    const gr = c.createRadialGradient(cv.width / 2, cv.height * 0.46, Math.min(cv.width, cv.height) * 0.4, cv.width / 2, cv.height * 0.5, Math.max(cv.width, cv.height) * 0.78);
    gr.addColorStop(0, 'rgba(20,10,2,0)'); gr.addColorStop(1, 'rgba(20,10,2,.26)');
    vig = { gr, w: cv.width, h: cv.height };
  }
  c.fillStyle = vig.gr; c.fillRect(0, 0, cv.width, cv.height);
  tickBubbles(t);
  textPass(t);
  requestAnimationFrame(frame);
}
function startLoop() { if (rafOn || document.hidden) return; rafOn = true; lastFrame = 0; requestAnimationFrame(frame); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });

// ---------- input: tap, drag-pan, pinch, wheel ----------
const ptrs = new Map(); let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); noteInput(); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, px: cam.px, py: cam.py, moved: false };
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: cam.zoom }; drag = null; } });
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
    const z0 = cam.zoom; cam.zoom = clampZ(pinch.z * d / pinch.d); wish.zoom = cam.zoom;
    const k = cam.zoom / Math.max(0.05, z0); cam.px *= k; cam.py *= k; wish.px = cam.px; wish.py = cam.py; clampWish();
    cam.px = wish.px; cam.py = wish.py; cam.zoom = wish.zoom;
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
  if (h.kind === 'worker') { sel = h.id; openWorker(h.id); }
  else if (h.kind === 'board' || h.kind === 'status' || h.kind === 'whiteboard') openProjects();
  else if (h.kind === 'design') openDesign();
  else if (h.kind === 'warehouse') openCard(`<h2>Warehouse</h2><div class="sub">Downstairs</div><p>Paper, pallets and the bay doors. In the 3D office this is also where the Design Trainer wall lives. Nothing is running here right now. ${esc(PAUSE_NOTE)}</p><div class="btns"><button data-act="design">Design cards</button></div>`);
}

// ---------- modal cards ----------
const modal = $('#modal'), cardBody = $('#cardBody');
let openedAt = 0;
function openCard(html) { cardBody.innerHTML = noDash(html); modal.classList.remove('hidden'); openedAt = performance.now(); }
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
    <h3>PROJECTS</h3>${ps.length ? ps.map(pr => `<div class="item"><b>${esc(pr.title)} ${stTag(pr.status)}${pr.due ? `<span class="due">due ${esc(pr.due)}</span>` : ''}</b><small>${esc(pr.note)}</small></div>`).join('') : `<div class="item"><small>${esc(DESK_NOTE[id] || 'No project of its own right now.')}</small></div>`}
    ${live && (live.step || live.task) ? `<h3>LAST DESK UPDATE</h3><div class="item"><b>${esc(live.task || '')}</b><small>${esc(live.step || '')}${live.at ? ` \u00b7 ${fmtAgo(live.at)}` : ''}</small></div>` : ''}
    <div class="note">${esc(PAUSE_NOTE)}</div>
    <div class="btns"><button data-act="ask" data-text="About ${esc(first(s))} (${esc(s.bot)}): ">Ask Michael about this</button></div>`);
}
function openProjects() {
  const grp = s => PROJECTS.filter(p => p.status === s);
  const sec = (h, list) => list.length ? `<h3>${h} (${list.length})</h3>` + list.map(p => `<div class="item"><b>${esc(p.title)} ${stTag(p.status)}${p.due ? `<span class="due">due ${esc(p.due)}</span>` : ''}</b><small>${esc(p.note)}<br>Desk: ${p.owners.map(o => byId(o)?.s.name || o).map(esc).join(', ')}</small></div>`).join('') : '';
  openCard(`<h2>Team Board</h2><div class="sub">Updated ${esc(UPDATED)}. ${esc(PAUSE_NOTE)}</div>${sec('IN PROGRESS', grp('active'))}${sec('DONE', grp('done'))}${sec('STUCK', grp('blocked'))}${sec('UNDER REVIEW', grp('waiting'))}${sec('PAUSED', grp('paused'))}<div class="btns"><button data-act="needs">Needs you (${needsCount()})</button></div>`);
}
function needsHtml() {
  const L = liveNeeds();
  return NEEDS.map(n => `<div class="item"><b>${esc(n.title)}${n.due ? `<span class="due">by ${esc(n.due)}</span>` : ''}</b><small>${esc(n.do)}</small></div>`).join('')
    + (L.length ? `<h3>FROM THE OFFICE FEED (PRIVATE)</h3>` + L.map(n => `<div class="item"><b>${esc(n.title)}</b><small>${esc(n.do || '')}${n.who ? ` \u00b7 ${esc(n.who)}` : ''}</small></div>`).join('') : '');
}
function openNeeds() {
  openCard(`<h2>Needs you (${needsCount()})</h2><div class="sub">Things waiting on you. Answer in chat and Michael picks it up.</div>${needsHtml()}<div class="btns"><button data-act="ask" data-text="">Answer in chat</button><button data-act="projects">Team Board</button></div>`);
}
function openDesign() {
  const cards = (deck?.cards || []).filter(c => c && c.title);
  openCard(`<h2>Design Wall</h2><div class="sub">Kelly's Design Trainer deck. ${esc(PROJECTS.find(p => p.id === 'cards')?.note || '')}</div>
    ${cards.length ? `<div class="grid">${cards.slice(0, 40).map(c => `<figure>${c.d ? `<img src="${c.d}" alt="">` : ''}${esc(c.title)}</figure>`).join('')}</div>`
      : `<div class="item"><small>The deck is encrypted to your iPad, so it only loads on your device. ${link.swipeStatus ? `(status: ${esc(link.swipeStatus)})` : 'Loading...'} Swiping still lives in the 3D office warehouse.</small></div>`}`);
  if (!cards.length) loadDeck(true).then(ok => { if (ok && !modal.classList.contains('hidden')) openDesign(); });
}

// ---------- HUD ----------
const projList = $('#projList');
function renderProjects() {
  projList.innerHTML = noDash(PROJECTS.map(p => `<li data-id="${p.id}"><span class="ico">${p.icon || ''}</span><span class="pip ${p.status}"></span><span class="t">${esc(p.title)}</span>${p.due ? `<span class="st blocked">${esc(p.due)}</span>` : ''}</li>`).join(''));
  const n = needsCount(); $('#needsN').textContent = n; $('#needsBtn').classList.toggle('zero', !n);
}
projList.addEventListener('click', e => { const li = e.target.closest('li'); if (!li) return; const p = PROJECTS.find(x => x.id === li.dataset.id);
  if (p) openCard(`<h2>${esc(p.title)}</h2><div class="sub">${stTag(p.status)}${p.due ? `<span class="due">due ${esc(p.due)}</span>` : ''}</div><p>${esc(p.note)}</p><h3>DESK</h3>${p.owners.map(o => byId(o)).filter(Boolean).map(w => `<div class="item" data-act="worker" data-id="${w.s.id}"><b>${esc(w.s.name)}</b><small>${esc(w.s.bot)}</small></div>`).join('')}<div class="note">${esc(PAUSE_NOTE)}</div><div class="btns"><button data-act="ask" data-text="About ${esc(p.title)}: ">Ask Michael</button></div>`); });
$('#projToggle').onclick = () => { const on = $('#projects').classList.toggle('all'); $('#projToggle').textContent = on ? 'less' : 'all'; };
$('#needsBtn').onclick = openNeeds;
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
function renderChat() {
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#chatForm').classList.toggle('hidden', tab !== 'chat');
  let html = '';
  if (tab === 'chat') {
    const list = merged();
    const meStatus = m => m.status === 'sending' ? 'sending' : m.status === 'failed' ? `<a href="#" class="retry" data-mid="${esc(m.mid)}">failed, tap to retry</a>` : m.ackN ? `Michael has it (#${esc(m.ackN)})` : 'delivered';
    html = list.length ? list.map(m => {
      if (m.kind === 'me') return `<div class="msg me"><img class="av" src="${avatar('chris')}"><div><div class="n">Chris <i>to ${esc(m.to === OFFICE_TO || m.to === 'Office' ? 'the office' : m.to === 'Grok Bot' ? 'Michael' : m.to || '')} \u00b7 ${hm(m.t)}</i></div><div class="x">${esc(m.text)}</div><div class="mst" style="font-size:11px;opacity:.8">${meStatus(m)}</div></div></div>`;
      const s = stOf(m.who) || stOf(m.from) || (/grok/i.test(m.from || '') ? stOf('grok') : null);
      return `<div class="msg"><img class="av" src="${avatar(s?.id || 'grok')}"><div><div class="n">${esc(s?.name || m.from || 'Grok Bot')} <i>${hm(m.t)}</i></div><div class="x">${esc(m.text)}</div></div></div>`;
    }).join('') : `<div class="empty">No messages yet. Send one and Michael answers here.</div>`;
  } else if (tab === 'assign') {
    html = people.map(p => { const st = stateOf(p.s.id); return `<div class="row" data-id="${p.s.id}"><span class="sdot" style="background:${st === 'active' ? '#6fd35b' : st === 'blocked' ? '#d8432f' : '#f2b33d'}"></span><img class="av" src="${avatar(p.s.id)}"><div><b>${esc(p.s.name)}</b> \u00b7 ${esc(p.s.bot)}<small>${esc(lineOf(p.s.id))}</small></div></div>`; }).join('');
  } else {
    html = [...NEEDS, ...liveNeeds()].map(n => `<div class="row" data-needs="1"><span class="sdot" style="background:#d8432f"></span><div><b>${esc(n.title)}</b>${n.due ? ` <span class="st blocked">by ${esc(n.due)}</span>` : ''}<small>${esc(n.do || '')}</small></div></div>`).join('') || '<div class="empty">Nothing needs you right now.</div>';
  }
  const atBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight < 40;
  chatBody.innerHTML = noDash(html);
  if (tab === 'chat' && (atBottom || !renderChat.did)) chatBody.scrollTop = chatBody.scrollHeight; renderChat.did = true;
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; renderChat(); } });
chatBody.addEventListener('click', e => {
  const r = e.target.closest('a.retry'); if (r) { e.preventDefault(); const m = entries.find(x => x.mid === r.dataset.mid); if (m) deliver(m); return; }
  const row = e.target.closest('.row'); if (!row) return;
  if (row.dataset.id) { sel = row.dataset.id; openWorker(row.dataset.id); } else if (row.dataset.needs) openNeeds();
});
const rid = () => Math.random().toString(36).slice(2, 11);
async function deliver(m) {
  m.status = 'sending'; renderChat();
  let tri = { route: m.route, cmds: [] }; try { tri = triage(m.text, { to: m.to, near: null }); } catch (e) {}
  const r = await link.send({ to: m.to, text: m.text, sentAt: new Date(m.at), office: { near: sel || null, bot: tri.cmds?.[0]?.bot || null, line: '' }, mid: m.mid });
  Object.assign(m, { status: r.status, ref: r.ref, route: tri.route }); saveLog(); renderChat();
  if (r.status === 'delivered') { fastUntil = Date.now() + 60000; toast(m.to === 'Grok Bot' ? 'Sent to Michael (Grok Bot)' : 'Sent to the office'); }
  else toast('Did not send. Tap retry in chat.');
}
$('#chatForm').addEventListener('submit', e => {
  e.preventDefault(); const text = chatIn.value.trim(); if (!text) return; chatIn.value = '';
  const m = { kind: 'me', to: chatTo.value, text, at: Date.now(), mid: rid(), status: 'sending' };
  entries.push(m); saveLog(); tab = 'chat'; renderChat(); deliver(m);
  if (m.to === 'Grok Bot') say('grok', 'Got it, looking now.', 4);
});
const chatBox = $('#chat'), chatOpenBtn = $('#chatOpen');
function openChat() { chatBox.classList.remove('hidden'); chatOpenBtn.classList.add('hidden'); }
$('#chatMin').onclick = () => { chatBox.classList.add('hidden'); chatOpenBtn.classList.remove('hidden'); };
chatOpenBtn.onclick = openChat;

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
async function loadDeck(force) {
  try { const r = await link.fetchSwipeDeck(force); if (r?.feed?.cards) { deck = r.feed; deckImgs.length = 0; for (const c of deck.cards.filter(c => c.d).slice(0, 3)) { const im = new Image(); im.src = c.d; deckImgs.push(im); } return true; } } catch (e) {}
  return false;
}
let build = null;
async function checkVersion() {
  try { const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return; const b = (await r.json()).build;
    if (build === null) build = b; else if (b !== build && !chatIn.value && modal.classList.contains('hidden') && document.activeElement !== chatIn) { toast('Office update: reloading'); setTimeout(() => location.reload(), 800); } } catch (e) {}
}

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
  if (btn === 'A') { if (open) closeCard(); else if (sel) openWorker(sel); else sel = 'grok'; }
  else if (btn === 'B') { if (open) closeCard(); else sel = null; }
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
  else return; e.preventDefault();
});

// ---------- toast ----------
let toastT = 0; function toast(s) { const el = $('#toast'); el.textContent = noDash(s); el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 2600); }

// ---------- boot ----------
resize(); renderProjects(); renderChat();
startLoop();
document.fonts?.ready?.then(() => { /* boards redraw every frame once the font is in */ });
loadTasks(); setInterval(loadTasks, 30000);
loadWork(); setInterval(loadWork, 90000);
loadDeck(false);
checkVersion(); setInterval(checkVersion, 30000);
pollChat();
setTimeout(() => toast('Tap a desk to see what they are on. Pinch to zoom, drag to look around.'), 900);
window.__hq2d = { bench: (n = 30) => { const scratch = document.createElement('canvas'); scratch.width = 640; scratch.height = 420; const sg = scratch.getContext('2d'); const a = performance.now(); for (let i = 0; i < n; i++) { camTransform(sg); hits = []; staticHits(); for (const it of sceneItems(i / 10)) it.fn(sg); } return (performance.now() - a) / n; }, proj: (x, y, z = 0) => projectCSS(x, y, z), hit: (x, y) => hitAt(x, y), regions: () => hits.map(h => {
    if (h.r) {
      const [x, y] = legToCSS(h.r[0], h.r[1]), [x2, y2] = legToCSS(h.r[0] + h.r[2], h.r[1] + h.r[3]);
      return { kind: h.kind, id: h.id || null, rect: [x, y, x2 - x, y2 - y] };
    }
    return { kind: h.kind, id: h.id || null, poly: h.poly.map(p => legToCSS(p[0], p[1])) };
  }), openNeeds, openWorker, openProjects, openDesign, state: () => ({ PS, BW, BH, DPR, n: people.length, cam: { ...cam } }) };
