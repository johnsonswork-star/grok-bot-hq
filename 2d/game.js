// Dunder Mifflin Bot HQ, 2.5D isometric pixel office (Canvas 2D, no engine).
// World pass: pixel art into a small offscreen buffer, scaled up with no smoothing.
// Text pass: crisp text drawn on the main canvas in the same iso planes (boards, signs, bubbles).
// Data: ../stations.js (desk/character mapping), ./data.js (real projects + Needs you), ../tasks.json (who is busy),
// ../hq-link.js (same encrypted HQ chat relay, work feed and design deck the 3D office uses).
import { STATIONS } from '../stations.js';
import * as link from '../hq-link.js';
import { triage, OFFICE_TO } from '../office-chat-rules.js';
import { PROJECTS, NEEDS, DESK_NOTE, LOOKS, PAUSE_NOTE, UPDATED } from './data.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const noDash = s => String(s ?? '').replace(/\u2014/g, ', ').replace(/\u2013/g, '-');
const noLig = s => String(s).replace(/f(?=[fil])/g, 'f\u200C');   // Pixelify Sans turns "fi" into a glyph that reads like "A"
const FONT = '"Pixelify Sans","Courier New",monospace';

// ---------- world ----------
const GX = 22, GY = 16, HX = 12, HY = 6, ZU = 14, WALL = 3.2;
const WH = { x0: 12, x1: GX, y0: 11.5, y1: GY, z: -2 };        // warehouse pit (downstairs)
const ST = { x0: 9, x1: 12, y0: 12.8, y1: 14.8, n: 6 };        // stairs down to it
const MGR = { x0: 16, x1: GX, y0: 0, y1: 5.5 };                   // manager office
const CONF = { x0: 7.5, x1: 14, y0: 0, y1: 5.5 };
const KIT = { x0: 14, x1: 16, y0: 0, y1: 3 };                   // conference room
const inR = (x, y, r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

// desk origin (x,y), seat = where the worker sits (behind the desk, facing the viewer)
const DESKS = {
  grok:     { x: 17.8, y: 2.2, w: 2.4 },
  inbox:    { x: 2.4, y: 9.0, w: 1.1, d: 3.2, reception: true, seat: [1.95, 10.6] },
  // quad A + quad B: back row faces you, front row sits with its back to you
  cos:      { x: 4.8, y: 6.8 },  assist:  { x: 6.9, y: 6.8 },
  icons:    { x: 4.8, y: 7.9, away: true }, conn: { x: 6.9, y: 7.9, away: true },
  onpad:    { x: 9.6, y: 6.8 },  builder: { x: 11.7, y: 6.8 },
  faith:    { x: 9.6, y: 7.9, away: true }, broker: { x: 11.7, y: 7.9, away: true },
  review:   { x: 4.4, y: 11.6 }, kids:    { x: 6.5, y: 11.6 },
  designer: { x: 15.0, y: 8.6 }, profile: { x: 17.1, y: 8.6 },
};
const people = STATIONS.filter(s => DESKS[s.id]).map(s => {
  const d = DESKS[s.id]; d.w = d.w || 2; d.d = d.d || 1.1;
  const seat = d.seat || (d.away ? [d.x + d.w * 0.5, d.y + d.d + 0.32] : [d.x + d.w * 0.6, d.y - 0.05]);
  return { s, d, seat, look: LOOKS[s.id] || LOOKS.cos, phase: Math.random() * 10, blinkAt: 0 };
});
const SEATZ = 0.15;
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
const cv = $('#c'), ctx = cv.getContext('2d');
const buf = document.createElement('canvas'), g = buf.getContext('2d');
let W = 0, H = 0, DPR = 1, PS = 2, fitPS = 2, homePS = 3, BW = 0, BH = 0, ox = 0, oy = 0;
const FOCUS = [11.7, 6.2];   // home framing: bullpen + conference room + manager office, warehouse peeking at the bottom
const cam = { zoom: 1, px: 0, py: 0 };
const MAP_W = (GX + GY) * HX, MAP_TOP = -WALL * ZU, MAP_BOT = (GX + GY) * HY + 2.6 * ZU;
function resize() {
  W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  fitPS = Math.max(1.2, Math.min((W - 20) / (MAP_W + 20), (H - 30) / (MAP_BOT - MAP_TOP + 30)));
  homePS = Math.max(fitPS, Math.min(4.6, W / 300, H / 215));
  layout();
}
const clampZ = z => Math.max(fitPS / homePS * 0.95, Math.min(2.2, z));
function layout() {
  cam.zoom = clampZ(cam.zoom);
  PS = homePS * cam.zoom;
  BW = Math.ceil(W / PS); BH = Math.ceil(H / PS);
  if (buf.width !== BW || buf.height !== BH) { buf.width = BW; buf.height = BH; }
  const fx = (FOCUS[0] - FOCUS[1]) * HX, fy = (FOCUS[0] + FOCUS[1]) * HY - ZU;
  ox = Math.round(BW / 2 - fx + cam.px / PS); oy = Math.round(BH / 2 - fy + cam.py / PS);
  baseDirty = true;
}
addEventListener('resize', resize);

const P = (x, y, z = 0) => [Math.round((x - y) * HX + ox), Math.round((x + y) * HY - z * ZU + oy)];
const Pf = (x, y, z = 0) => [(x - y) * HX + ox, (x + y) * HY - z * ZU + oy];
function poly(c, pts, fill, stroke) {
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
}
const hex2 = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const shade = (h, f) => { const [r, gg, b] = hex2(h); const k = v => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${k(r)},${k(gg)},${k(b)})`; };
const OUT = 'rgba(30,17,8,.9)';
function seg(c, a, b, col) { c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.moveTo(a[0] + 0.5, a[1] + 0.5); c.lineTo(b[0] + 0.5, b[1] + 0.5); c.stroke(); }
function box(c, x, y, z, w, d, h, col, o = {}) {
  const A = P(x, y, z + h), B = P(x + w, y, z + h), C = P(x + w, y + d, z + h), D = P(x, y + d, z + h);
  const B0 = P(x + w, y, z), C0 = P(x + w, y + d, z), D0 = P(x, y + d, z);
  const t = o.t || col, l = o.l || shade(col, 0.8), r = o.r || shade(col, 0.63);
  if (!o.noL) poly(c, [D, C, C0, D0], l);
  if (!o.noR) poly(c, [B, C, C0, B0], r);
  if (!o.noT) poly(c, [A, B, C, D], t);
  if (o.ol !== false) {
    seg(c, D, C, o.hi || 'rgba(255,238,205,.38)'); seg(c, C, B, 'rgba(255,238,205,.2)');
    if (h > 0.12) seg(c, C, C0, 'rgba(0,0,0,.22)');
    c.strokeStyle = o.olc || OUT; c.lineWidth = 1; c.beginPath();
    const S = [A, B, B0, C0, D0, D]; c.moveTo(S[0][0] + 0.5, S[0][1] + 0.5); for (let i = 1; i < S.length; i++) c.lineTo(S[i][0] + 0.5, S[i][1] + 0.5); c.closePath(); c.stroke();
  }
  if (o.edge) { c.strokeStyle = o.edge; c.lineWidth = 1; c.beginPath(); c.moveTo(D[0], D[1]); c.lineTo(C[0], C[1]); c.lineTo(B[0], B[1]); c.stroke(); }
}
// soft contact shadow on the floor (light from the back-left, falls to the front-right)
function shadow(c, x, y, w, d, h, z = 0) {
  const s = Math.min(h, 2) * 0.32;
  for (const [e, a] of [[0.18, 0.12], [0, 0.2]]) {
    poly(c, [P(x - e, y - e, z), P(x + w + e, y - e, z), P(x + w + s + e, y + s * 0.5 - e, z), P(x + w + s + e, y + d + s * 0.5 + e, z), P(x + s - e, y + d + s * 0.5 + e, z), P(x - e, y + d + e, z)], `rgba(45,24,8,${a})`);
  }
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
  c.save(); c.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale); fn(c); c.restore();
}

// ---------- hash noise ----------
const hsh = (x, y) => { let n = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967295; };

// ---------- base layer (floors, walls, pit) cached per camera ----------
const base = document.createElement('canvas'), bg = base.getContext('2d');
let baseDirty = true;
const lite = document.createElement('canvas'), lg = lite.getContext('2d');
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
const PLANTS = [[0.3, 0.3], [6.9, 0.4], [13.3, 0.4], [16.4, 4.6], [0.3, 15.2], [8.5, 10.6], [14.2, 6.8], [21.4, 0.5], [3.7, 5.6]];
const PALLETS = [[13.3, 13.4, 3], [15.3, 13.8, 2], [17.4, 13.3, 3], [19.3, 14.0, 4], [14.6, 14.85, 2]];
function drawBase() {
  base.width = BW; base.height = BH; const c = bg;
  c.fillStyle = '#1a1410'; c.fillRect(0, 0, BW, BH);
  // ---- warehouse (down a level)
  for (let x = WH.x0; x < WH.x1; x++) for (let y = Math.floor(WH.y0); y < WH.y1; y++) {
    const y0 = Math.max(y, WH.y0), n = hsh(x, y);
    poly(c, [P(x, y0, WH.z), P(x + 1, y0, WH.z), P(x + 1, y + 1, WH.z), P(x, y + 1, WH.z)], shade('#8b8984', 0.92 + n * 0.12));
    for (let k = 0; k < 5; k++) { const p = P(x + hsh(x * 3 + k, y) * 0.95, Math.max(y0, y + hsh(x, y * 5 + k) * 0.95), WH.z); c.fillStyle = k % 2 ? 'rgba(60,60,60,.25)' : 'rgba(255,255,255,.15)'; c.fillRect(p[0], p[1], 1, 1); }
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
        const gp = P(x + hsh(x, k + y * 3) * 0.8, y + k / 3 + 0.16); c.fillStyle = 'rgba(70,35,12,.25)'; c.fillRect(gp[0] - 3, gp[1], 6, 1); }
    } else if (inR(cx, cy, KIT)) { // kitchen tile
      poly(c, T(0, 0, 0.5, 0.5), '#e2dccd'); poly(c, T(0.5, 0, 1, 0.5), '#b8ae9c'); poly(c, T(0, 0.5, 0.5, 1), '#b8ae9c'); poly(c, T(0.5, 0.5, 1, 1), '#e2dccd');
    } else { // carpet tiles with a woven pattern
      const conf = inR(cx, cy, CONF), base0 = conf ? '#a6977f' : '#c9a777', col = shade(base0, 0.96 + n * 0.07);
      poly(c, T(0, 0, 1, 1), col);
      const a = P(x, y), b = P(x + 1, y), d = P(x, Math.min(y + 1, y1));
      seg(c, a, b, 'rgba(120,85,45,.22)'); seg(c, a, d, 'rgba(255,240,210,.18)');
      const m = P(cx, Math.min(cy, y1 - 0.1)); c.fillStyle = 'rgba(130,95,55,.28)';
      c.fillRect(m[0] - 1, m[1] - 1, 3, 1); c.fillRect(m[0], m[1] - 2, 1, 3);
      for (let k = 0; k < 6; k++) { const p = P(x + hsh(x * 7 + k, y) * 0.95, Math.min(y + hsh(x, y * 7 + k) * 0.95, y1 - 0.02)); c.fillStyle = k % 3 ? 'rgba(110,75,40,.2)' : 'rgba(255,238,205,.28)'; c.fillRect(p[0], p[1], 1, 1); }
    }
  }
  // conference rug (round)
  { const p = Pf(10.8, 2.75); c.fillStyle = '#5e4d3c'; c.beginPath(); c.ellipse(p[0], p[1], 48, 24, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#7d6a54'; c.beginPath(); c.ellipse(p[0], p[1], 45, 22, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#a58c6c'; c.beginPath(); c.ellipse(p[0], p[1], 40, 19.5, 0, 0, Math.PI * 2); c.stroke(); }
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
  boardY(c, 3.0, 7.2, 0.95, 2.7, '#1f2a24');
  // Team Board (conference back wall)
  boardY(c, 8.0, 13.6, 0.75, 2.85, '#22303a');
  // manager wall: landscape + diploma; left wall picture near reception
  frameY(c, 16.7, 18.3, 1.5, 2.45, ['#5f8f6a', '#9cc7df']); frameY(c, 18.6, 19.3, 1.6, 2.35, ['#f3ead2', '#f3ead2']);
  frameX(c, 12.4, 14.0, 1.5, 2.4, ['#4a6a8a', '#d9b46a']);
  // ---- lighting layer (warm ceiling light pools, screen-blended each frame)
  lite.width = BW; lite.height = BH; lg.clearRect(0, 0, BW, BH);
  for (const [x, y, r, a] of [[6.5, 8, 70, 0.22], [11, 8, 70, 0.22], [6.5, 12.5, 60, 0.18], [10.8, 2.8, 60, 0.18], [19, 2.8, 55, 0.2], [17, 9.5, 55, 0.18], [2.5, 10.5, 55, 0.18], [17, 14, 80, 0.14]]) {
    const p = Pf(x, y, y > 12.5 && x > 15 ? WH.z : 0); const gr = lg.createRadialGradient(p[0], p[1], 2, p[0], p[1], r);
    gr.addColorStop(0, `rgba(255,214,150,${a})`); gr.addColorStop(1, 'rgba(255,214,150,0)'); lg.fillStyle = gr; lg.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
  }
  baseDirty = false;
}

// ---------- props ----------
function blobs(c, list, dark) { for (const [x, y, w, h] of list) { c.fillStyle = dark; c.fillRect(x - 1, y - 1, w + 2, h + 2); } }
function plant(c, x, y, s = 1) {
  box(c, x, y, 0, 0.48 * s, 0.48 * s, 0.42 * s, '#b4602f', { l: '#9a4f25', r: '#7a3b1a' });
  box(c, x - 0.03, y - 0.03, 0.36 * s, 0.54 * s, 0.54 * s, 0.08 * s, '#c87040', { ol: false });
  const p = P(x + 0.24 * s, y + 0.24 * s, 0.44 * s), X = p[0], Y = p[1] - 1;
  const F = [[-2.6, 9], [-2.1, 11], [-1.6, 12], [-1.2, 13], [-0.6, 12], [0, 11], [0.5, 13], [1.0, 12], [1.5, 11], [2.0, 10], [2.5, 9], [-0.2, 14], [0.9, 10], [-1.0, 9]];
  const cols = ['#2f6b2f', '#3f8a3a', '#4c9a40', '#5aa84a', '#3a7d35'];
  for (const pass of [0, 1]) F.forEach(([a, len], i) => {
    const L = len * s, ang = a * 0.55 - Math.PI / 2;
    for (let k = 0; k <= L; k++) {
      const droop = (k / L) * (k / L) * 4 * Math.sign(a || 0.1);
      const px = Math.round(X + Math.cos(ang) * k + droop * 0.3), py = Math.round(Y + Math.sin(ang) * k * 0.85 + (k / L) * (k / L) * 5);
      const w = k < L * 0.7 ? 2 : 1;
      if (pass === 0) { c.fillStyle = '#1a3818'; c.fillRect(px - 1, py - 1, w + 2, 3); }
      else { c.fillStyle = cols[i % cols.length]; c.fillRect(px, py, w, 1); if (k % 3 === 1) { c.fillStyle = 'rgba(200,245,150,.5)'; c.fillRect(px, py, 1, 1); } }
    }
  });
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
    ream(c, x + 0.06, y + 0.06, z, 0.62, 0.48, '#5b8fd6'); ream(c, x + 0.72, y + 0.06, z, 0.62, 0.48, '#5b8fd6');
    ream(c, x + 0.06, y + 0.56, z, 0.62, 0.48, '#5b8fd6'); ream(c, x + 0.72, y + 0.56, z, 0.62, 0.48, '#5b8fd6');
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
  box(c, x + 0.22, y + 0.22, 0.05, 0.06, 0.06, 0.28, '#222', { ol: false });
  const p = P(x + 0.25, y + 0.25, 0.04); c.fillStyle = '#151515'; c.fillRect(p[0] - 5, p[1], 10, 1); c.fillRect(p[0] - 1, p[1] - 1, 2, 3);
  box(c, x, y, 0.32, 0.5, 0.5, 0.1, col);
}
function paperStack(c, x, y, z, n) {
  const h = n * 0.05; box(c, x, y, z, 0.36, 0.28, h, '#f8f6ef', { l: '#e2ddcf', r: '#c9c3b3' });
  for (let i = 1; i < n; i++) { seg(c, P(x, y + 0.28, z + i * 0.05), P(x + 0.36, y + 0.28, z + i * 0.05), 'rgba(120,110,90,.35)'); }
  seg(c, P(x + 0.06, y + 0.08, z + h), P(x + 0.28, y + 0.08, z + h), 'rgba(90,90,110,.35)'); seg(c, P(x + 0.06, y + 0.15, z + h), P(x + 0.22, y + 0.15, z + h), 'rgba(90,90,110,.35)');
}
function monitor(c, x, y, z, busy, t, k) {
  box(c, x + 0.08, y + 0.12, z, 0.3, 0.2, 0.04, '#2c2c30', { ol: false });
  box(c, x + 0.18, y + 0.18, z, 0.08, 0.08, 0.16, '#333', { ol: false });
  box(c, x, y, z + 0.14, 0.18, 0.62, 0.56, '#34373e', { t: '#2a2c31', r: '#26282d' });
  // screen faces the front-right (+x): visible glow
  const s = quadX(x + 0.181, y + 0.05, y + 0.57, z + 0.19, z + 0.65);
  poly(c, s, busy ? '#5fc8ff' : '#2b4f6e');
  if (busy) { for (let i = 0; i < 4; i++) { const zz = z + 0.58 - i * 0.09, len = 0.12 + hsh(k + i, (t * 2 | 0)) * 0.28; poly(c, quadX(x + 0.182, y + 0.57 - 0.06 - len, y + 0.57 - 0.06, zz - 0.03, zz), 'rgba(15,60,100,.75)'); }
    poly(c, quadX(x + 0.183, y + 0.05, y + 0.57, z + 0.6, z + 0.65), 'rgba(255,255,255,.35)'); }
  else { poly(c, quadX(x + 0.182, y + 0.08, y + 0.3, z + 0.5, z + 0.62), 'rgba(140,200,240,.22)'); }
}
function monitorY(c, x, y, z, busy, t, k) { // screen faces +y (toward a worker who sits with their back to you)
  box(c, x + 0.16, y + 0.06, z, 0.3, 0.16, 0.04, '#2c2c30', { ol: false });
  box(c, x + 0.27, y + 0.08, z, 0.08, 0.08, 0.16, '#333', { ol: false });
  box(c, x, y, z + 0.14, 0.62, 0.18, 0.56, '#34373e', { t: '#2a2c31', l: '#26282d' });
  poly(c, quadY(y + 0.181, x + 0.05, x + 0.57, z + 0.19, z + 0.65), busy ? '#5fc8ff' : '#2b4f6e');
  if (busy) for (let i = 0; i < 4; i++) { const zz = z + 0.58 - i * 0.09, len = 0.12 + hsh(k + i, (t * 2 | 0)) * 0.28; poly(c, quadY(y + 0.182, x + 0.1, x + 0.1 + len, zz - 0.03, zz), 'rgba(15,60,100,.75)'); }
  else poly(c, quadY(y + 0.182, x + 0.35, x + 0.52, z + 0.5, z + 0.62), 'rgba(140,200,240,.22)');
}
function deskDraw(c, p, t) {
  const d = p.d, busy = stateOf(p.s.id) === 'active', k = (d.x * 13 + d.y * 7) | 0;
  if (d.reception) {
    box(c, d.x, d.y, 0, d.w, d.d, 0.8, '#7a4a2a', { l: '#6b4024', r: '#5a361d' });
    for (let y = d.y + 0.25; y < d.y + d.d - 0.2; y += 0.8) { poly(c, quadX(d.x + d.w + 0.003, y, y + 0.65, 0.12, 0.66), '#4f2f19'); poly(c, quadX(d.x + d.w + 0.005, y + 0.04, y + 0.61, 0.16, 0.62), '#6e4426'); }
    box(c, d.x - 0.12, d.y - 0.12, 0.8, d.w + 0.24, d.d + 0.24, 0.09, '#b07c4e');
    poly(c, quadX(d.x + d.w + 0.01, d.y + 0.65, d.y + d.d - 0.65, 0.2, 0.62), '#2f1d10');
    monitor(c, d.x + 0.12, d.y + 0.2, 0.89, true, t, k);
    paperStack(c, d.x + 0.4, d.y + 2.3, 0.89, 3);
    box(c, d.x + 0.45, d.y + 1.7, 0.89, 0.3, 0.22, 0.08, '#222', { ol: false });   // phone
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
  if (d.away) { monitorY(c, d.x + d.w * 0.5 - 0.31, d.y + 0.08, 0.62, busy, t, k); box(c, d.x + d.w * 0.32, d.y + d.d - 0.3, 0.62, 0.6, 0.18, 0.03, '#3a3c42', { ol: false, t: '#45474e' }); paperStack(c, d.x + 0.08, d.y + 0.12, 0.62, 2 + (k % 3)); return; }
  monitor(c, d.x + 0.12, d.y + 0.1, 0.62, busy, t, k);
  box(c, d.x + d.w * 0.4, d.y + 0.08, 0.62, 0.55, 0.18, 0.03, '#3a3c42', { ol: false, t: '#45474e' });
  for (let i = 0; i < 6; i++) { const q = P(d.x + d.w * 0.4 + 0.06 + i * 0.08, d.y + 0.16, 0.65); c.fillStyle = 'rgba(220,220,220,.5)'; c.fillRect(q[0], q[1], 1, 1); }
  paperStack(c, d.x + 0.08, d.y + 0.76, 0.62, 2 + (k % 4));
  if (k % 3 === 0) box(c, d.x + d.w - 0.3, d.y + 0.3, 0.62, 0.12, 0.12, 0.14, '#e9e2d0', { t: '#4a2a18' });
  if (k % 3 === 1) { box(c, d.x + d.w - 0.3, d.y + 0.3, 0.62, 0.1, 0.1, 0.16, '#3a6ea5', { ol: false }); const q = P(d.x + d.w - 0.25, d.y + 0.35, 0.8); c.fillStyle = '#d33'; c.fillRect(q[0], q[1] - 2, 1, 3); c.fillStyle = '#222'; c.fillRect(q[0] + 1, q[1] - 1, 1, 2); }
  if (k % 4 === 2) box(c, d.x + 1.3, d.y + 0.15, 0.62, 0.3, 0.2, 0.06, '#222', { ol: false });
  if (p.s.id === 'assist') box(c, d.x + 1.45, d.y + 0.65, 0.62, 0.18, 0.18, 0.18, '#d8b23a');   // bobblehead box
  if (p.s.hero) { // green banker's lamp, nameplate, mug
    box(c, d.x + d.w - 0.35, d.y + 0.15, 0.62, 0.06, 0.06, 0.35, '#c9a24a', { ol: false });
    box(c, d.x + d.w - 0.52, d.y + 0.04, 0.95, 0.4, 0.22, 0.11, '#2f8a4a', { t: '#3fa85a' });
    const q = P(d.x + d.w - 0.32, d.y + 0.15, 0.92); c.fillStyle = 'rgba(255,240,170,.9)'; c.fillRect(q[0] - 3, q[1], 6, 1);
    box(c, d.x + 0.9, d.y + d.d - 0.25, 0.62, 0.6, 0.12, 0.12, '#c9a24a');
  }
  hands(c, p, t, 0.62);
}
function hands(c, p, t, z) { // forearms resting on the desk, typing when busy
  const busy = stateOf(p.s.id) === 'active', L = p.look, sl = L.vest ? L.shirt : (L.jacket || L.cardigan || L.shirt);
  const [sx, sy] = P(p.seat[0], p.d.y + 0.16, z), hk = busy ? ((t * 10 + p.phase) | 0) % 2 : 0;
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(sx + x, sy + y, w, h); };
  R(-8, -3, 5, 3, '#21140a'); R(3, -3, 5, 3, '#21140a');
  R(-7, -3, 3, 2, sl); R(4, -3, 3, 2, shade(sl, 0.85));
  R(-5, -3 - hk, 3, 2, L.skin); R(2, -3 - (busy ? 1 - hk : 0), 3, 2, L.skin);
}

// ---------- chibi workers (pixel art) ----------
function chibi(c, sx, sy, L, t, busy, blink, ph) {
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(sx + x, sy + y, w, h); };
  const OL = '#21140a', sk = L.skin, skD = shade(sk, 0.82), skH = shade(sk, 1.08), hr = L.hair, hrH = shade(hr, 1.45), hrD = shade(hr, 0.7);
  // chair back
  R(-10, -24, 20, 20, OL); R(-9, -23, 18, 18, '#2d3546'); R(-8, -22, 16, 2, '#4a5670'); R(-9, -8, 18, 3, '#222938'); R(7, -23, 2, 18, '#252c3b');
  sy += busy && Math.sin(t * 6 + ph) > 0.6 ? -1 : 0;
  const bw = L.big ? 14 : 12, bx = -bw / 2, outer = L.jacket || L.cardigan || L.vest, armC = L.vest ? L.shirt : (outer || L.shirt);
  // arms + torso
  R(bx - 3, -12, bw + 6, 12, OL); R(bx - 1, -13, bw + 2, 1, OL);
  R(bx - 2, -11, 2, 9, shade(armC, 0.9)); R(bx + bw, -11, 2, 9, shade(armC, 0.7));
  R(bx, -12, bw, 12, L.shirt);
  if (outer) { const h = bw / 2 - 1; R(bx, -12, h, 12, outer); R(1, -12, h, 12, shade(outer, 0.86)); if (L.jacket) { R(-2, -12, 1, 4, shade(outer, 1.25)); R(1, -12, 1, 4, shade(outer, 0.7)); } }
  R(bx, -12, bw, 1, 'rgba(255,255,255,.22)'); R(bx + bw - 2, -11, 2, 11, 'rgba(0,0,0,.16)');
  if (L.tie) { R(-2, -12, 1, 2, '#f4f4f4'); R(1, -12, 1, 2, '#f4f4f4'); R(-1, -11, 2, 2, shade(L.tie, 1.25)); R(-1, -9, 2, 7, L.tie); R(0, -9, 1, 7, shade(L.tie, 0.75)); }
  else { R(-2, -12, 4, 1, skD); R(-1, -11, 2, 1, skD); }
  // neck + head
  R(-2, -14, 4, 2, skD);
  R(-7, -27, 14, 1, OL); R(-8, -26, 16, 11, OL); R(-7, -15, 14, 1, OL); R(-9, -22, 1, 4, OL); R(8, -22, 1, 4, OL);
  R(-7, -26, 14, 11, sk); R(-6, -27, 12, 1, sk); R(-6, -15, 12, 1, sk);
  R(5, -25, 2, 10, skD); R(-6, -16, 12, 1, skD);
  R(-8, -21, 1, 3, sk); R(7, -21, 1, 3, skD);
  // hair
  const cap = () => { R(-7, -29, 14, 1, OL); R(-8, -28, 16, 1, OL); R(-7, -28, 14, 3, hr); R(-8, -27, 16, 3, hr); };
  switch (L.style) {
    case 'slick': cap(); R(-8, -24, 2, 4, hr); R(6, -24, 2, 3, hr); R(-6, -25, 8, 1, hr); R(-3, -28, 1, 3, hrH); R(-6, -27, 3, 1, hrH); break;
    case 'messy': cap(); R(-8, -24, 2, 4, hr); R(6, -24, 2, 4, hr); R(-6, -25, 9, 2, hr); R(-6, -30, 2, 2, hr); R(-2, -31, 2, 3, hr); R(2, -30, 3, 2, hr); R(-1, -30, 1, 1, hrH); R(-5, -27, 4, 1, hrH); break;
    case 'part': cap(); R(-8, -24, 2, 3, hr); R(6, -24, 2, 3, hr); R(-7, -25, 6, 2, hr); R(1, -25, 6, 2, hr); R(-1, -28, 2, 4, skH); R(-6, -27, 3, 1, hrH); break;
    case 'short': cap(); R(-8, -24, 2, 3, hr); R(6, -24, 2, 2, hr); R(-6, -25, 7, 1, hr); R(-5, -27, 4, 1, hrH); break;
    case 'long': cap(); R(-10, -26, 4, 17, OL); R(6, -26, 4, 17, OL); R(-9, -26, 3, 16, hr); R(6, -26, 3, 16, hrD); R(-6, -25, 12, 2, hr); R(-5, -27, 4, 1, hrH); R(-9, -20, 1, 8, hrH); R(-8, -17, 1, 1, '#ffd23a'); R(7, -17, 1, 1, '#ffd23a'); break;
    case 'pony': cap(); R(-8, -24, 2, 5, hr); R(6, -24, 2, 3, hr); R(-6, -25, 8, 1, hr); R(7, -27, 4, 4, OL); R(8, -24, 4, 10, OL); R(7, -26, 3, 3, hr); R(8, -23, 3, 9, hrD); R(8, -23, 1, 6, hr); R(-5, -27, 4, 1, hrH); break;
    case 'bun': R(-4, -33, 8, 6, OL); R(-3, -32, 6, 4, hr); R(-2, -32, 2, 1, hrH); cap(); R(-8, -24, 1, 4, hr); R(7, -24, 1, 4, hr); R(-6, -25, 12, 1, hr); R(-5, -27, 5, 1, hrH); break;
    case 'curly': R(-10, -30, 20, 6, OL); R(-11, -26, 5, 11, OL); R(6, -26, 5, 11, OL); R(-9, -29, 18, 5, hr); R(-10, -25, 4, 9, hr); R(6, -25, 4, 9, hrD); for (let i = 0; i < 6; i++) R(-8 + i * 3, -28 + (i % 2), 1, 1, hrD); R(-6, -29, 5, 1, hrH); break;
    case 'bald': R(-9, -23, 3, 5, OL); R(6, -23, 3, 5, OL); R(-8, -22, 2, 4, hr); R(6, -22, 2, 4, hr); R(-4, -26, 3, 1, skH); R(-3, -25, 1, 1, '#fff6'); break;
    case 'balding': R(-9, -26, 4, 9, OL); R(5, -26, 4, 9, OL); R(-8, -25, 3, 7, hr); R(5, -25, 3, 7, hrD); R(-3, -27, 6, 1, hr); R(-1, -26, 2, 1, skH); break;
  }
  // 1px rim light (top-left)
  R(-7, -26, 1, 4, 'rgba(255,248,230,.45)'); R(bx - 2, -11, 1, 3, 'rgba(255,248,230,.35)'); R(bx, -12, 3, 1, 'rgba(255,248,230,.45)');
  // face
  const ey = -21;
  R(-5, ey - 2, 3, 1, hrD); R(2, ey - 2, 3, 1, hrD);
  if (blink) { R(-5, ey + 1, 3, 1, '#1b1b1b'); R(2, ey + 1, 3, 1, '#1b1b1b'); }
  else { R(-5, ey, 2, 3, '#1b1b1b'); R(3, ey, 2, 3, '#1b1b1b'); R(-5, ey, 1, 1, '#fff'); R(3, ey, 1, 1, '#fff'); }
  if (L.glasses) { const G = '#151515'; R(-6, ey - 1, 5, 1, G); R(1, ey - 1, 5, 1, G); R(-6, ey + 3, 5, 1, G); R(1, ey + 3, 5, 1, G); R(-6, ey - 1, 1, 5, G); R(-2, ey - 1, 1, 5, G); R(1, ey - 1, 1, 5, G); R(5, ey - 1, 1, 5, G); R(-1, ey, 2, 1, G); }
  R(0, -18, 1, 1, skD);
  R(-6, -18, 2, 1, 'rgba(235,110,90,.45)'); R(4, -18, 2, 1, 'rgba(235,110,90,.45)');
  if (L.stache) R(-3, -17, 6, 1, '#1d120a');
  if (L.stubble) for (let i = -5; i <= 4; i += 2) { R(i, -16, 1, 1, 'rgba(40,30,20,.35)'); R(i + 1, -15, 1, 1, 'rgba(40,30,20,.3)'); }
  R(-1, -16, 3, 1, '#8e3b2a'); R(-2, -17, 1, 1, '#8e3b2a88'); R(2, -17, 1, 1, '#8e3b2a88');
}
function chibiBack(c, sx, sy, L, t, busy, ph) {
  const R = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(sx + x, sy + y, w, h); };
  const OL = '#21140a', sk = L.skin, skD = shade(sk, 0.82), hr = L.hair, hrH = shade(hr, 1.45), hrD = shade(hr, 0.72);
  sy += busy && Math.sin(t * 6 + ph) > 0.6 ? -1 : 0;
  const bw = L.big ? 14 : 12, bx = -bw / 2, top = L.jacket || L.cardigan || L.vest || L.shirt;
  R(bx - 3, -12, bw + 6, 12, OL); R(bx - 1, -13, bw + 2, 1, OL);
  R(bx - 2, -11, 2, 9, shade(L.vest ? L.shirt : top, 0.9)); R(bx + bw, -11, 2, 9, shade(L.vest ? L.shirt : top, 0.7));
  R(bx, -12, bw, 12, top); R(bx + bw / 2 - 1, -11, 1, 10, shade(top, 0.82)); R(bx + bw - 2, -11, 2, 11, 'rgba(0,0,0,.16)'); R(bx, -12, bw, 1, 'rgba(255,255,255,.25)');
  R(-2, -14, 4, 2, skD);
  const bald = L.style === 'bald' || L.style === 'balding';
  R(-7, -27, 14, 1, OL); R(-8, -26, 16, 11, OL); R(-7, -15, 14, 1, OL); R(-9, -22, 1, 4, OL); R(8, -22, 1, 4, OL);
  R(-7, -26, 14, 11, bald ? sk : hr); R(-6, -27, 12, 1, bald ? sk : hr);
  R(-8, -21, 1, 3, sk); R(7, -21, 1, 3, skD);
  if (bald) { R(-7, -21, 14, 5, hr); R(-3, -26, 3, 1, shade(sk, 1.12)); R(4, -25, 2, 9, skD); }
  else { R(4, -25, 3, 10, hrD); R(-6, -27, 5, 1, hrH); R(-7, -26, 1, 5, hrH); for (let i = 0; i < 3; i++) R(-4 + i * 3, -20 + (i % 2), 1, 3, hrD); }
  if (L.style === 'pony') { R(-2, -16, 5, 9, OL); R(-1, -16, 3, 8, hrD); R(-1, -16, 1, 5, hr); }
  if (L.style === 'bun') { R(-4, -31, 8, 6, OL); R(-3, -30, 6, 4, hr); R(-2, -30, 2, 1, hrH); }
  if (L.style === 'long') { R(-9, -24, 18, 15, OL); R(-8, -24, 16, 14, hr); R(3, -24, 5, 14, hrD); R(-7, -24, 1, 10, hrH); }
  if (L.style === 'curly') { R(-10, -28, 20, 13, OL); R(-9, -27, 18, 11, hr); for (let i = 0; i < 6; i++) R(-8 + i * 3, -25 + (i % 2) * 4, 1, 1, hrD); R(4, -26, 4, 10, hrD); }
  // chair back in front of the body
  R(-10, -10, 20, 13, OL); R(-9, -9, 18, 11, '#2d3546'); R(-8, -9, 16, 2, '#4a5670'); R(7, -9, 2, 11, '#252c3b'); R(-9, 0, 18, 2, '#222938');
}
// small head avatar for chat (data URL per station)
const avatarCache = {};
function avatar(id) {
  if (avatarCache[id]) return avatarCache[id];
  const k = document.createElement('canvas'); k.width = 22; k.height = 22; const c = k.getContext('2d');
  c.fillStyle = id === 'chris' ? '#3d8d2f' : (STATIONS.find(s => s.id === id)?.color || '#555'); c.fillRect(0, 0, 22, 22);
  if (id === 'chris') { c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.fillText('C', 11, 16); }
  else if (LOOKS[id]) { c.fillStyle = 'rgba(0,0,0,0)'; chibi(c, 11, 33, LOOKS[id], 0, false, false, 0); }
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
    const q = quadY(y, x0, x1, z0, z1); poly(c, q, 'rgba(160,210,235,.24)'); refl(q);
    for (let x = x0; x <= x1 + 0.001; x += 1.5) poly(c, quadY(y, Math.min(x, x1) - 0.03, Math.min(x, x1) + 0.03, z0, z1), '#56646e');
    poly(c, quadY(y, x0, x1, z1 - 0.06, z1), '#56646e'); seg(c, P(x0, y, z1), P(x1, y, z1), 'rgba(255,255,255,.4)');
  });
  const glassX = (x, y0, y1, z0 = 0.35, z1 = 2.6) => add(x + y0 / 2 + y1 / 2 - 0.3, c => { c0 = c;
    box(c, x - 0.06, y0, 0, 0.12, y1 - y0, z0, '#6b4a2e');
    const q = quadX(x, y0, y1, z0, z1); poly(c, q, 'rgba(160,210,235,.24)'); refl(q);
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
  for (const [x, y] of PLANTS) add(x + y + 0.45, c => plant(c, x, y));
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
    const a = P(ST.x0, ST.y1, 0.9), b = P(ST.x1, ST.y1, WH.z + 0.9); c.strokeStyle = '#2a2a2a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
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
  if (busy) {
    const gr = c.createRadialGradient(sx, sy - 12, 2, sx, sy - 12, 20);
    gr.addColorStop(0, `rgba(120,255,110,${0.55 + 0.15 * Math.sin(t * 2.5)})`); gr.addColorStop(1, 'rgba(120,255,110,0)');
    c.fillStyle = gr; c.fillRect(sx - 22, sy - 34, 44, 44);
  }
  if (t > p.blinkAt) p.blinkAt = t + 2 + Math.random() * 4;
  if (p.d.away) chibiBack(c, sx, sy, p.look, t, busy, p.phase); else chibi(c, sx, sy, p.look, t, busy, p.blinkAt - t < 0.12, p.phase);
  if (st === 'blocked') { c.fillStyle = '#21140a'; c.fillRect(sx + 7, sy - 34, 5, 8); c.fillStyle = '#e8432f'; c.fillRect(sx + 8, sy - 33, 3, 4); c.fillRect(sx + 8, sy - 28, 3, 1); }
  else if (st !== 'active') { // sleepy "z z" = paused
    const f = (t * 0.8 + p.phase) % 2, a = f < 1 ? f : 2 - f, zx = sx + 8, zy = sy - 30 - Math.round(f * 3);
    c.globalAlpha = 0.45 + 0.5 * a; c.fillStyle = '#f6efe0'; c.fillRect(zx, zy, 4, 1); c.fillRect(zx + 2, zy + 1, 1, 1); c.fillRect(zx + 1, zy + 2, 1, 1); c.fillRect(zx, zy + 3, 4, 1);
    c.fillRect(zx + 5, zy - 4, 3, 1); c.fillRect(zx + 6, zy - 3, 1, 1); c.fillRect(zx + 5, zy - 2, 3, 1); c.globalAlpha = 1;
  }
  if (sel === p.s.id) { const y = sy - 40 + Math.round(Math.sin(t * 5) * 2); c.fillStyle = '#ffd23a'; c.fillRect(sx - 3, y, 7, 2); c.fillRect(sx - 2, y + 2, 5, 2); c.fillRect(sx - 1, y + 4, 3, 2); c.fillStyle = '#24170d'; c.fillRect(sx - 4, y - 1, 9, 1); }
  hits.push({ kind: 'worker', id: p.s.id, r: [sx - 9, sy - 32, 18, 34] });
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
function textPass(t) {
  const S = DPR * PS, c = ctx;
  // Team Board (conference back wall): LIVE | PAUSED | NEEDS YOU, 3 short cards each
  inPlane(c, S, PLANE_Y(8.12, 0.02, 2.75), 40, cc => {
    const Wd = 5.36 * 40, colW = (Wd - 12) / 3; cc.textBaseline = 'middle';
    const cols = [['LIVE', '#6fd35b', PROJECTS.filter(p => p.status === 'active' || p.status === 'done').map(p => p.short || p.title)],
      ['PAUSED', '#f2b33d', PROJECTS.filter(p => !['active', 'done'].includes(p.status)).map(p => p.short || p.title)],
      ['NEEDS YOU', '#ff6a55', [...NEEDS, ...liveNeeds()].map(n => n.short || n.title)]];
    cols.forEach(([h, col, items], i) => {
      const x = 3 + i * (colW + 3);
      cc.fillStyle = col; cc.fillRect(x, 3, colW, 15); cc.fillStyle = '#16120e'; cc.font = `700 10.5px ${FONT}`; cc.fillText(fitText(cc, `${h} ${items.length}`, colW - 6), x + 4, 11);
      const show = items.length > 3 ? items.slice(0, 2) : items;
      show.forEach((t, k) => { const y = 22 + k * 17; cc.fillStyle = '#f3ead2'; cc.fillRect(x, y, colW, 14); cc.fillStyle = col; cc.fillRect(x, y, 3, 14); cc.fillStyle = '#1d1a16'; cc.font = `700 9.5px ${FONT}`; cc.fillText(fitText(cc, t, colW - 9), x + 6, y + 7.5); });
      if (items.length > 3) { cc.fillStyle = '#d8d2c2'; cc.font = `700 9px ${FONT}`; cc.fillText(`+${items.length - 2} more`, x + 4, 22 + 2 * 17 + 7); }
    });
  });
  // HQ status board (back wall, real counts)
  inPlane(c, S, PLANE_Y(3.12, 0.02, 2.6), 40, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#ffd27a'; cc.font = `700 12px ${FONT}`; cc.fillText('HQ STATUS', 6, 9);
    const n = s => PROJECTS.filter(p => p.status === s).length;
    const rows = [['Projects', PROJECTS.length, '#e9e2cf'], ['Live', n('active') + n('done'), '#6fd35b'], ['Paused', n('paused') + n('waiting') + n('blocked'), '#f2b33d'], ['Needs you', needsCount(), '#ff6a55']];
    cc.font = `700 10px ${FONT}`;
    rows.forEach(([k, v, col], i) => { const y = 23 + i * 11; cc.fillStyle = '#cfd8cc'; cc.fillText(k, 7, y); cc.fillStyle = col; cc.textAlign = 'right'; cc.fillText(String(v), 150, y); cc.textAlign = 'left'; });
  });
  // whiteboard (left wall, text runs toward the back corner): 3 short lines
  inPlane(c, S, PLANE_X(0.03, 8.28, 2.45), 40, cc => {
    cc.textBaseline = 'middle'; cc.fillStyle = '#1d3f8f'; cc.font = `700 13px ${FONT}`; cc.fillText('TODAY', 8, 9);
    cc.font = `700 10px ${FONT}`;
    const etsy = PROJECTS.find(p => p.id === 'etsy'), att = PROJECTS.find(p => p.id === 'att');
    const lines = [['All projects paused', '#222'], [etsy?.status === 'waiting' ? 'Etsy ID in review' : 'Etsy shop paused', '#a8601c'], [att?.due ? `AT&T due ${att.due}` : 'AT&T paused', '#a52a1c']];
    lines.forEach(([t, col], i) => { cc.fillStyle = col; cc.fillText('\u2022 ' + noLig(t), 8, 23 + i * 11); });
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
  inPlane(c, S, PLANE_X(3.51, 11.85, 0.62), 40, cc => { cc.textBaseline = 'top'; cc.fillStyle = '#f3e3c0'; cc.font = `700 8px ${FONT}`; cc.fillText('DUNDER MIFFLIN', 4, 2); cc.font = `5px ${FONT}`; cc.fillText('RECEPTION', 4, 11); });
  // design wall header
  inPlane(c, S, PLANE_Y(15.4, 6.4, 2.62), 40, cc => { cc.fillStyle = '#2a1c10'; cc.fillRect(4, 0, 76, 11); cc.textBaseline = 'top'; cc.fillStyle = '#ffd27a'; cc.font = `700 8px ${FONT}`; cc.fillText('DESIGN WALL', 8, 2); });

  // speech bubbles + selected name tag (screen aligned)
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  for (const b of bubbles) {
    const p = byId(b.id); if (!p) continue;
    const [sx, sy] = Pf(p.seat[0], p.seat[1], SEATZ); const X = sx * PS, Y = (sy - 34) * PS;
    const fs = Math.max(13, Math.min(18, 4.6 * PS)); c.font = `700 ${fs}px ${FONT}`;
    const txt = fitText(c, b.text, 340), w = c.measureText(txt).width + 20, h = fs + 14;
    const a = Math.min(1, (b.until - t) * 2, (t - b.at) * 4); if (a <= 0) continue;
    c.globalAlpha = a; c.fillStyle = '#fffdf6'; c.strokeStyle = '#24170d'; c.lineWidth = 3;
    const bx = Math.round(Math.max(8, Math.min(W - w - 8, X - w / 2))), by = Math.round(Math.max(8, Y - h));
    c.beginPath(); c.roundRect ? c.roundRect(bx, by, w, h, 5) : c.rect(bx, by, w, h); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(X - 5, by + h - 1); c.lineTo(X, by + h + 6); c.lineTo(X + 4, by + h - 1); c.fill();
    c.beginPath(); c.moveTo(X - 5, by + h); c.lineTo(X, by + h + 6); c.lineTo(X + 4, by + h); c.stroke();
    c.fillStyle = '#24170d'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(txt, X, by + h / 2 + 1); c.textAlign = 'left';
    c.globalAlpha = 1;
  }
  if (sel) {
    const p = byId(sel); if (p) {
      const [sx, sy] = Pf(p.seat[0], p.seat[1], SEATZ); const X = sx * PS, Y = (sy + 6) * PS;
      c.font = `700 14px ${FONT}`; const s = `${p.s.name} \u00b7 ${p.s.bot}`, w = c.measureText(s).width + 14;
      c.fillStyle = 'rgba(36,23,13,.92)'; c.fillRect(X - w / 2, Y, w, 21); c.fillStyle = '#ffd27a'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, X, Y + 11); c.textAlign = 'left';
    }
  }
}

// ---------- bubbles ----------
const bubbles = []; let nextBubble = 1.2;
function tickBubbles(t) {
  for (let i = bubbles.length - 1; i >= 0; i--) if (bubbles[i].until < t) bubbles.splice(i, 1);
  if (t > nextBubble && bubbles.length < 2) {
    const pool = people.filter(p => !bubbles.some(b => b.id === p.s.id));
    const act = pool.filter(p => stateOf(p.s.id) === 'active');
    const p = (act.length && Math.random() < 0.45 ? act : pool)[Math.floor(Math.random() * (Math.random() < 0.45 && act.length ? act.length : pool.length))] || pool[0];
    if (p) bubbles.push({ id: p.s.id, text: lineOf(p.s.id), at: t, until: t + 4.5 });
    nextBubble = t + 2.6 + Math.random() * 2;
  }
}
function say(id, text, secs = 5) { const t = now(); const i = bubbles.findIndex(b => b.id === id); if (i >= 0) bubbles.splice(i, 1); bubbles.push({ id, text, at: t, until: t + secs }); }

// ---------- hotspots ----------
let hits = [];
function staticHits() {
  hits.push({ kind: 'board', poly: quadY(0, 8.0, 13.6, 0.75, 2.85) });
  hits.push({ kind: 'status', poly: quadY(0, 3.0, 7.2, 0.95, 2.7) });
  hits.push({ kind: 'whiteboard', poly: quadX(0, 4.6, 8.4, 0.95, 3.2) });
  hits.push({ kind: 'design', poly: quadY(6.6, 15.3, 20.2, 0, 2.6) });
  hits.push({ kind: 'warehouse', poly: [P(WH.x0, WH.y0, WH.z), P(WH.x1, WH.y0, WH.z), P(WH.x1, WH.y1, WH.z), P(WH.x0, WH.y1, WH.z)] });
  hits.push({ kind: 'warehouse', poly: quadY(12.6, 9.3, 11.7, 1.5, 2.2) });
}
function inPoly(x, y, pts) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
function hitAt(cssX, cssY) {
  const x = cssX / PS, y = cssY / PS;
  for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (h.r ? (x >= h.r[0] && x <= h.r[0] + h.r[2] && y >= h.r[1] && y <= h.r[1] + h.r[3]) : inPoly(x, y, h.poly)) return h; }
  return null;
}

// ---------- render loop ----------
const T0 = performance.now(); const now = () => (performance.now() - T0) / 1000;
let lastFrame = 0, vig = null;
function frame() {
  requestAnimationFrame(frame);
  const tn = performance.now(); if (tn - lastFrame < 66) return; lastFrame = tn;
  const t = now();
  pollPad();
  if (baseDirty) drawBase();
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(base, 0, 0);
  hits = []; staticHits();
  for (const it of sceneItems(t)) it.fn(g);
  // warm grade + ceiling light pools
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#fff0d8'; g.fillRect(0, 0, BW, BH);
  g.globalCompositeOperation = 'screen'; g.drawImage(lite, 0, 0); g.globalCompositeOperation = 'source-over';
  tickBubbles(t);
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buf, 0, 0, BW * PS * DPR, BH * PS * DPR);
  if (!vig || vig.w !== cv.width || vig.h !== cv.height) { const gr = ctx.createRadialGradient(cv.width / 2, cv.height * 0.48, Math.min(cv.width, cv.height) * 0.35, cv.width / 2, cv.height * 0.48, Math.max(cv.width, cv.height) * 0.75); gr.addColorStop(0, 'rgba(20,10,2,0)'); gr.addColorStop(1, 'rgba(20,10,2,.55)'); vig = { gr, w: cv.width, h: cv.height }; }
  ctx.fillStyle = vig.gr; ctx.fillRect(0, 0, cv.width, cv.height);
  textPass(t);
}

// ---------- input: tap, drag-pan, pinch, wheel ----------
const ptrs = new Map(); let drag = null, pinch = null;
cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, px: cam.px, py: cam.py, moved: false };
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.zoom }; drag = null; } });
cv.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); const z0 = cam.zoom; cam.zoom = pinch.z * d / pinch.d; cam.zoom = clampZ(cam.zoom); const k = cam.zoom / z0; cam.px *= k; cam.py *= k; layout(); }
  else if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.hypot(dx, dy) > 8) drag.moved = true; if (drag.moved) { cam.px = drag.px + dx; cam.py = drag.py + dy; clampPan(); layout(); } } });
const endPtr = e => { const was = ptrs.has(e.pointerId); ptrs.delete(e.pointerId); if (!was) return;
  if (drag && !drag.moved && e.type === 'pointerup') tap(e.clientX, e.clientY);
  if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) drag = null; };
cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', e => { e.preventDefault(); const z0 = cam.zoom; cam.zoom *= e.deltaY < 0 ? 1.1 : 0.9; cam.zoom = clampZ(cam.zoom); const k = cam.zoom / z0; cam.px *= k; cam.py *= k; layout(); }, { passive: false });
let lastTap = 0;
function clampPan() { const lx = MAP_W * 0.55 * PS, ly = (MAP_BOT - MAP_TOP) * 0.6 * PS; cam.px = Math.max(-lx, Math.min(lx, cam.px)); cam.py = Math.max(-ly, Math.min(ly, cam.py)); }
function tap(x, y) {
  const h = hitAt(x, y);
  if (!h) { if (performance.now() - lastTap < 350) { cam.zoom = 1; cam.px = cam.py = 0; layout(); } lastTap = performance.now(); sel = null; return; }
  openHit(h);
}
function openHit(h) {
  if (h.kind === 'worker') { sel = h.id; openWorker(h.id); }
  else if (h.kind === 'board' || h.kind === 'status' || h.kind === 'whiteboard') openProjects();
  else if (h.kind === 'design') openDesign();
  else if (h.kind === 'warehouse') openCard(`<h2>Warehouse</h2><div class="sub">Downstairs</div><p>Paper, pallets and the bay doors. In the 3D office this is also where the Design Trainer wall lives. Nothing is running here right now. ${esc(PAUSE_NOTE)}</p><div class="btns"><button data-act="design">Design cards</button><button data-act="go3d">Open 3D office</button></div>`);
}

// ---------- modal cards ----------
const modal = $('#modal'), cardBody = $('#cardBody');
function openCard(html) { cardBody.innerHTML = noDash(html); modal.classList.remove('hidden'); }
function closeCard() { modal.classList.add('hidden'); }
$('#cardX').onclick = closeCard;
modal.addEventListener('click', e => { if (e.target === modal) closeCard(); });
cardBody.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'design') openDesign();
  else if (a === 'go3d') location.href = '../';
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
      : `<div class="item"><small>The deck is encrypted to your iPad, so it only loads on your device. ${link.swipeStatus ? `(status: ${esc(link.swipeStatus)})` : 'Loading...'} Swiping still lives in the 3D office warehouse.</small></div>`}
    <div class="btns"><button data-act="go3d">Open 3D office</button></div>`);
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
function merged() {
  const mine = new Set(entries.filter(e => e.kind === 'me').map(e => e.ref || e.mid)), ids = new Set(entries.filter(e => e.kind === 'bot').map(e => String(e.id)));
  const out = entries.filter(e => !e.thread).map(e => ({ ...e, t: tms(e.at) }));
  for (const o of office) {
    if (o.thread) continue;
    if (o.kind === 'chris') { if (o.mid && mine.has(o.mid)) continue; out.push({ kind: 'me', text: o.text, to: o.to, t: tms(o.at), status: 'delivered' }); continue; }
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
    html = list.length ? list.map(m => {
      if (m.kind === 'me') { const st = m.status === 'sending' ? ' \u00b7 sending' : m.status === 'failed' ? ` \u00b7 <a href="#" class="retry" data-mid="${esc(m.mid)}">failed, tap to retry</a>` : '';
        return `<div class="msg me"><img class="av" src="${avatar('chris')}"><div><div class="n">Chris <i>to ${esc(m.to === OFFICE_TO || m.to === 'Office' ? 'the office' : m.to === 'Grok Bot' ? 'Michael' : m.to || '')} \u00b7 ${hm(m.t)}${st}</i></div><div class="x">${esc(m.text)}</div></div></div>`; }
      const s = stOf(m.who) || stOf(m.from) || (/grok/i.test(m.from || '') ? stOf('grok') : null);
      return `<div class="msg"><img class="av" src="${avatar(s?.id || 'grok')}"><div><div class="n">${esc(s?.name || m.from || 'Grok Bot')} <i>${hm(m.t)}</i></div><div class="x">${esc(m.text)}</div></div></div>`;
    }).join('') : `<div class="empty">No chat yet on this iPad. Messages go to the same HQ chat as the 3D office. Michael (Grok Bot) answers real orders.</div>`;
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

let fastUntil = 0, polling = false;
async function pollChat() {
  if (polling || document.hidden) return; polling = true;
  try {
    const f = await link.fetchChatFeed();
    if (f?.feed?.items) { office = f.feed.items.slice(-150); try { localStorage.setItem(FEED, JSON.stringify(office)); } catch (e) {} }
    const reps = await link.fetchReplies(); let ch = !!f?.feed;
    const have = new Set(entries.filter(e => e.kind === 'bot').map(e => String(e.id)));
    for (const r of reps) {
      if (r.type === 'ack') { const m = entries.find(x => x.mid === r.mid); if (m && !m.issue) { m.issue = r.issue; m.route = r.route || m.route; ch = true; } continue; }
      if (r.thread || have.has(String(r.id))) continue;
      entries.push({ kind: 'bot', id: r.id, from: r.from, text: r.text, at: r.at, ref: r.ref }); ch = true;
      const who = stOf(r.who) || (/grok/i.test(r.from || '') ? stOf('grok') : null); if (who && byId(who.id)) say(who.id, r.text, 6);
    }
    if (ch) { saveLog(); renderChat(); }
  } catch (e) {}
  polling = false;
}
setInterval(() => { if (Date.now() < fastUntil) pollChat(); }, 5000);
setInterval(pollChat, 25000);

// ---------- live data: tasks.json, work feed, design deck, version ----------
async function loadTasks() { try { const r = await fetch('../tasks.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { busyFile = (await r.json()).busy || {}; renderChat(); } } catch (e) {} }
async function loadWork() { try { const r = await link.fetchWorkFeed(); if (r?.feed) { workFeed = r.feed; renderProjects(); if (tab !== 'chat') renderChat(); } } catch (e) {} }
async function loadDeck(force) {
  try { const r = await link.fetchSwipeDeck(force); if (r?.feed?.cards) { deck = r.feed; deckImgs.length = 0; for (const c of deck.cards.filter(c => c.d).slice(0, 3)) { const im = new Image(); im.src = c.d; deckImgs.push(im); } return true; } } catch (e) {}
  return false;
}
let build = null;
async function checkVersion() {
  try { const r = await fetch('../version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return; const b = (await r.json()).build;
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
function pollPad() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; const gp = pads[0]; if (!gp) return;
  if (!padSeen) { padSeen = true; const h = $('#padHint'); h.classList.remove('hidden'); setTimeout(() => h.classList.add('hidden'), 7000); }
  const b = i => !!gp.buttons[i]?.pressed, edge = i => b(i) && !padPrev[i];
  if (document.activeElement !== chatIn) {
    if (edge(12)) moveSel(0, -1); if (edge(13)) moveSel(0, 1); if (edge(14)) moveSel(-1, 0); if (edge(15)) moveSel(1, 0);
    if (edge(0)) press('A'); if (edge(2)) press('X'); if (edge(3)) press('Y'); if (edge(9)) press('start');
  }
  if (edge(1)) { if (document.activeElement === chatIn) chatIn.blur(); else press('B'); }
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
  let moved = false;
  if (Math.abs(ax) > 0.2 || Math.abs(ay) > 0.2) { cam.px -= ax * 14; cam.py -= ay * 14; clampPan(); moved = true; }
  const zt = (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0) - (Math.abs(ry) > 0.3 ? ry * 0.6 : 0);
  if (Math.abs(zt) > 0.1) { const z0 = cam.zoom; cam.zoom = clampZ(cam.zoom * (1 + zt * 0.04)); const k = cam.zoom / z0; cam.px *= k; cam.py *= k; moved = true; }
  if (moved) layout();
  padPrev = gp.buttons.map(x => x.pressed);
}
addEventListener('keydown', e => {
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
requestAnimationFrame(frame);
document.fonts?.ready?.then(() => { baseDirty = true; });
loadTasks(); setInterval(loadTasks, 30000);
loadWork(); setInterval(loadWork, 90000);
loadDeck(false);
checkVersion(); setInterval(checkVersion, 30000);
pollChat();
setTimeout(() => toast('Tap a desk to see what they are on. Pinch to zoom, drag to look around.'), 900);
window.__hq2d = { bench: (n = 50) => { const a = performance.now(); for (let i = 0; i < n; i++) { g.drawImage(base, 0, 0); hits = []; staticHits(); for (const it of sceneItems(i / 10)) it.fn(g); } return (performance.now() - a) / n; }, proj: (x, y, z = 0) => Pf(x, y, z).map(v => v * PS), openNeeds, openWorker, openProjects, openDesign, state: () => ({ PS, BW, BH, n: people.length, cam: { ...cam } }) };
