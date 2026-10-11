import { createChat } from './chat.js';
import * as THREE from './vendor/three.module.js';
import { STATIONS } from './stations.js';
import { createWorkers } from './workers.js';
import { createMonitors } from './monitors.js';
import { createWhiteboard } from './whiteboard.js';
import { startLiveReload, takeResume } from './live.js';
import { fetchInboxFeed, fetchBankFeed, fetchWorkFeed, requestRefresh } from './hq-link.js';

// ---------- device detection ----------
const UA = navigator.userAgent;
// iPadOS 13+ reports itself as a Mac, so also check for touch points.
const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_MOBILE = IS_IOS || /Android|Mobile/.test(UA);
const HAS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
// Pointer lock only where there's a real mouse and it's supported (never on iOS/iPadOS).
const CAN_LOCK = !IS_IOS && !IS_MOBILE && 'requestPointerLock' in Element.prototype && matchMedia('(pointer: fine)').matches;
document.documentElement.classList.toggle('touch', HAS_TOUCH && !CAN_LOCK);
document.documentElement.classList.toggle('ios', IS_IOS);

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_MOBILE ? 1.25 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = IS_MOBILE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap; // lighter filtering on iPad
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bcd8ef');
scene.fog = new THREE.Fog('#cfe2f1', 60, 180);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 250);
camera.rotation.order = 'YXZ';
const EYE = 1.65;

// ---------- lights ----------
scene.add(new THREE.HemisphereLight('#fff6ea', '#8a7a68', 1.15));
const sun = new THREE.DirectionalLight('#fff1dc', 1.6);
sun.position.set(6, 20, -8);
sun.castShadow = true;
sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
// Daylight spill from north/east windows
const winFill = new THREE.DirectionalLight('#dbeaff', 0.55);
winFill.position.set(10, 6, -30);
scene.add(winFill);
const warm = new THREE.PointLight('#ffcf94', 6, 14, 2);
warm.position.set(-1, 2.8, 10); // warm spill over Pam's reception
scene.add(warm);

// ---------- helpers ----------
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function box(w, h, d, mat, x, y, z, parent = scene, shadow = true) {
  const m = new THREE.Mesh(boxGeo(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = IS_MOBILE ? 4 : 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
const std = (color, rough = 0.7, metal = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });

// ---------- materials ----------
// commercial carpet tiles (the Dunder Mifflin floor): blue-grey, speckled, quarter-turned tiles
const carpetTex = canvasTex(512, 512, (g, w, h) => {
  const n = 4, t = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const l = 40 + Math.random() * 4; g.fillStyle = `hsl(212, 12%, ${l}%)`; g.fillRect(i * t, j * t, t, t);
    const vert = (i + j) % 2;
    for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(${Math.random() < .5 ? '20,28,40' : '200,210,220'},${0.08 + Math.random() * 0.12})`;
      const x = i * t + Math.random() * t, y = j * t + Math.random() * t; vert ? g.fillRect(x, y, 1.5, 6) : g.fillRect(x, y, 6, 1.5); }
    g.fillStyle = 'rgba(20,25,35,.25)'; g.fillRect(i * t, j * t, t, 1.5); g.fillRect(i * t, j * t, 1.5, t);
  }
}, [20, 14]);
const vinylTex = canvasTex(256, 256, (g, w, h) => { // kitchen / break room floor tiles
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#d9d2c3' : '#e8e2d5'; g.fillRect(i * 64, j * 64, 64, 64); }
  g.strokeStyle = 'rgba(90,80,60,.25)'; for (let k = 0; k <= 256; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.moveTo(0, k); g.lineTo(256, k); g.stroke(); }
}, [12, 7]);
const blindsTex = canvasTex(64, 64, (g, w, h) => { g.clearRect(0, 0, w, h); for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(236,232,220,.92)'; g.fillRect(0, y, w, 5); } }, [1, 10]);
const paperTex = canvasTex(256, 160, (g, w, h) => {
  g.fillStyle = '#f3f1ec'; g.fillRect(0, 0, w, h); g.fillStyle = '#2d5aa8'; g.fillRect(0, 54, w, 40);
  g.fillStyle = '#fff'; g.font = '800 26px Georgia,serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PAPER · 10 REAMS', w / 2, 75);
  g.strokeStyle = 'rgba(0,0,0,.2)'; g.strokeRect(1, 1, w - 2, h - 2);
});
const M = {
  floor: std('#ffffff', 0.95, 0, { map: carpetTex }),
  vinyl: std('#ffffff', 0.6, 0, { map: vinylTex }),
  rug: std('#7a2f2f', 0.95),
  carpet: std('#5b6670', 0.95),
  carpetWarm: std('#6f6a60', 0.95),
  wall: std('#e9e0cf', 0.9),
  accent: std('#c7764f', 0.85),
  ceiling: std('#f6f3ee', 0.95, 0, { emissive: '#d9d4cc', emissiveIntensity: 0.55 }),
  oak: std('#b8916a', 0.55),
  walnut: std('#6e4a32', 0.6),
  steel: std('#2c2d31', 0.45, 0.6),
  cabinet: std('#8d9093', 0.6, 0.3),
  cabinetWhite: std('#e9e6e0', 0.6),
  recep: std('#c9b79c', 0.7),
  copier: std('#d8d6d0', 0.6), copierDark: std('#4a4c50', 0.6),
  pallet: std('#a07a4e', 0.9),
  paperBox: std('#ffffff', 0.85, 0, { map: paperTex }),
  whDoor: std('#5c6168', 0.6, 0.3),
  vendGlass: new THREE.MeshStandardMaterial({ color: '#9fd0ff', roughness: 0.1, emissive: '#3a5a7a', emissiveIntensity: 0.6 }),
  glassJar: new THREE.MeshStandardMaterial({ color: '#e8f4ff', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }),
  blinds: new THREE.MeshStandardMaterial({ map: blindsTex, transparent: true, depthWrite: false, roughness: 0.8, alphaTest: 0.05 }),
  chair: std('#3a3f47', 0.8),
  chairSeat: std('#4b525c', 0.9),
  bezel: std('#151618', 0.4, 0.3),
  mullion: std('#33363b', 0.5, 0.5),
  glass: new THREE.MeshStandardMaterial({ color: '#cfe6f5', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }),
  light: new THREE.MeshBasicMaterial({ color: '#fffaf0' }),
  pot: std('#d9d3ca', 0.8),
  leaf: std('#4f7d4a', 0.85),
  leaf2: std('#6a9a55', 0.85),
  sofa: std('#5c4a3d', 0.95),
  white: std('#f2f2f0', 0.6),
  divider: std('#b9b2a7', 0.95),
  ground: std('#8fae6b', 1),
  paving: std('#c9c4bb', 0.95),
  bldg: std('#d6dde4', 0.9),
};

// ---------- collision ----------
const colliders = []; // {minX,maxX,minZ,maxZ}
function addCollider(x, z, w, d, ry = 0) {
  // axis-aligned bounds of a rotated rect
  const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
  const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
  colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
}

// ---------- shell: floor, ceiling, walls, windows ----------
// Layout = the Dunder Mifflin Scranton office (The Office), HQ #30 / #36. Front door + Pam's reception on the south wall,
// conference room to the west of reception, Michael's glass corner office to the east, bullpen desk pairs behind,
// kitchen + break room in the back west corner, the annex in the back east corner, warehouse door on the west wall.
const LAYOUT = 'scranton-1'; // bump when the floor plan changes: live reload then drops Chris at the front door instead of inside a new wall
const W = 40, D = 28, H = 3.4, X0 = -20, X1 = 20, Z0 = -14, Z1 = 14;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.ceiling);
ceil.rotation.x = Math.PI / 2; ceil.position.y = H; scene.add(ceil);

// drop-ceiling fluorescent panels (one instanced mesh, one draw call)
{
  const spots = []; for (let x = -16; x <= 16; x += 4) for (let z = -11; z <= 11; z += 4) spots.push([x, z]);
  const lp = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2, 0.6), M.light, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
  spots.forEach(([x, z], i) => lp.setMatrixAt(i, m4.compose(new THREE.Vector3(x, H - 0.01, z), q, new THREE.Vector3(1, 1, 1))));
  scene.add(lp);
}

// window wall: sill (0..0.6), glass (0.6..2.9), header (2.9..H), mullions every 2m
function windowWall(axis, fixed, from, to, inwardSign) {
  const len = to - from, mid = (from + to) / 2, t = 0.2;
  const place = (m, along, y) => axis === 'z' ? m.position.set(along, y, fixed) : m.position.set(fixed, y, along);
  const mk = (w, h, mat) => axis === 'z' ? boxGeo(w, h, t) : boxGeo(t, h, w);
  const sill = new THREE.Mesh(mk(len, 0.6), M.wall); place(sill, mid, 0.3); sill.receiveShadow = true; scene.add(sill);
  const head = new THREE.Mesh(mk(len, H - 2.9), M.wall); place(head, mid, (2.9 + H) / 2); scene.add(head);
  const glass = new THREE.Mesh(mk(len, 2.3), M.glass); place(glass, mid, 1.75); glass.renderOrder = 2; scene.add(glass);
  for (let a = from; a <= to + 0.01; a += 2) {
    const m = new THREE.Mesh(axis === 'z' ? boxGeo(0.08, 2.3, 0.24) : boxGeo(0.24, 2.3, 0.08), M.mullion);
    place(m, a, 1.75); scene.add(m);
  }
  const ledge = new THREE.Mesh(axis === 'z' ? boxGeo(len, 0.04, 0.34) : boxGeo(0.34, 0.04, len), M.oak);
  place(ledge, mid, 0.62);
  if (axis === 'z') ledge.position.z += inwardSign * 0.08; else ledge.position.x += inwardSign * 0.08;
  scene.add(ledge);
}
windowWall('z', Z0, X0, X1, 1);   // north: full glass
windowWall('x', X1, Z0, Z1, -1);  // east: full glass
// west wall solid (warehouse door + water cooler live on it)
box(0.2, H, D, M.wall, X0, H / 2, 0, scene, false);
// south wall with the glass front door at x -0.8..0.8
box(X1 - 0.8, H, 0.2, M.wall, (0.8 + X1) / 2, H / 2, Z1, scene, false);
box(0.8 - X0, H, 0.2, M.wall, (X0 - 0.8) / 2, H / 2, Z1, scene, false);
box(1.6, H - 2.4, 0.2, M.wall, 0, (2.4 + H) / 2, Z1, scene, false);
box(1.5, 2.4, 0.05, M.glass, 0, 1.2, Z1, scene, false);
box(0.06, 2.4, 0.12, M.mullion, -0.78, 1.2, Z1, scene, false); box(0.06, 2.4, 0.12, M.mullion, 0.78, 1.2, Z1, scene, false);
box(0.05, 0.05, 0.6, M.steel, 0.5, 1.05, Z1 - 0.08, scene, false);
// room bounds
colliders.push({ minX: -100, maxX: X0 + 0.1, minZ: -100, maxZ: 100 }, { minX: X1 - 0.1, maxX: 100, minZ: -100, maxZ: 100 },
  { minX: -100, maxX: 100, minZ: -100, maxZ: Z0 + 0.1 }, { minX: -100, maxX: 100, minZ: Z1 - 0.1, maxZ: 100 });

// interior wall from (ax,az) to (bx,bz) (axis-aligned) with door gaps [[a,b],...] measured along the wall.
// glass: full-height glass (0..2.4) with mullions + header; blinds: half-drawn Office-style blinds on the glass.
function wall(ax, az, bx, bz, { gaps = [], glass = false, blinds = false, t = 0.14 } = {}) {
  const alongX = az === bz, a0 = alongX ? Math.min(ax, bx) : Math.min(az, bz), a1 = alongX ? Math.max(ax, bx) : Math.max(az, bz), f = alongX ? az : ax;
  const put = (s0, s1, y0, y1, mat, th = t, shadow = false) => {
    const len = s1 - s0, mid = (s0 + s1) / 2, hh = y1 - y0;
    const m = alongX ? box(len, hh, th, mat, mid, (y0 + y1) / 2, f, scene, shadow) : box(th, hh, len, mat, f, (y0 + y1) / 2, mid, scene, shadow);
    if (mat === M.glass || mat === M.blinds) m.renderOrder = 2;
    return m;
  };
  const segs = []; let cur = a0;
  for (const [g0, g1] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (g0 > cur) segs.push([cur, g0]); cur = g1; }
  if (cur < a1) segs.push([cur, a1]);
  const DOOR = 2.4;
  if (glass) put(a0, a1, DOOR, H, M.wall);            // glass walls: solid header over the whole run
  else for (const [g0, g1] of gaps) put(g0, g1, DOOR, H, M.wall); // solid walls: header only over door gaps
  for (const [s0, s1] of segs) {
    if (glass) {
      put(s0, s1, 0, 0.08, M.mullion, t);             // base track
      put(s0, s1, 0.08, DOOR, M.glass, 0.04);
      if (blinds) put(s0 + 0.05, s1 - 0.05, 0.95, DOOR - 0.06, M.blinds, 0.05);
      const n = Math.max(1, Math.round((s1 - s0) / 1.6));
      for (let k = 0; k <= n; k++) { const a = s0 + (s1 - s0) * k / n; alongX ? box(0.06, DOOR, 0.08, M.mullion, a, DOOR / 2, f, scene, false) : box(0.08, DOOR, 0.06, M.mullion, f, DOOR / 2, a, scene, false); }
    } else put(s0, s1, 0, H, M.wall, t, true);
    colliders.push(alongX ? { minX: s0, maxX: s1, minZ: f - t / 2 - 0.02, maxZ: f + t / 2 + 0.02 } : { minX: f - t / 2 - 0.02, maxX: f + t / 2 + 0.02, minZ: s0, maxZ: s1 });
  }
  for (const [g0, g1] of gaps) for (const a of [g0, g1]) // door frames
    alongX ? box(0.08, DOOR, t + 0.04, M.walnut, a, DOOR / 2, f, scene, false) : box(t + 0.04, DOOR, 0.08, M.walnut, f, DOOR / 2, a, scene, false);
}
// a flat sign (canvas text) on a wall. ry: 0 faces +z (south), PI faces -z (north), PI/2 faces +x (east), -PI/2 faces -x (west)
function sign(text, x, y, z, ry, { w = 1.6, h = 0.32, bg = '#1f2a44', fg = '#ffffff', sub = '', font = 'system-ui,Segoe UI,Arial', weight = 800 } = {}) {
  const cw = 512, ch = Math.round(512 * h / w);
  const tex = canvasTex(cw, ch, (g, w2, h2) => {
    if (bg) { roundRect(g, 2, 2, w2 - 4, h2 - 4, Math.min(18, h2 / 4)); g.fillStyle = bg; g.fill(); } else g.clearRect(0, 0, w2, h2);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = Math.round(h2 * (sub ? 0.46 : 0.6)); g.font = `${weight} ${fs}px ${font}`;
    while (g.measureText(text).width > w2 - 24 && fs > 10) { fs -= 2; g.font = `${weight} ${fs}px ${font}`; }
    g.fillText(text, w2 / 2, sub ? h2 * 0.38 : h2 / 2 + 2);
    if (sub) { g.globalAlpha = 0.85; g.font = `600 ${Math.round(h2 * 0.22)}px ${font}`; g.fillText(sub, w2 / 2, h2 * 0.78); g.globalAlpha = 1; }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: !bg, toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
}

// rooms (also used for "where am I" in HQ shots + the mini map)
const ROOMS = [
  { id: 'closet',  name: "Ryan's closet (annex)",          x0: 17.4, x1: 20,  z0: -14, z1: -11.4 },
  { id: 'michael', name: "Michael's office (Grok Bot)",    x0: 10,   x1: 20,  z0: 4,   z1: 14 },
  { id: 'conf',    name: 'conference room',               x0: -20,  x1: -8,  z0: 4,   z1: 14 },
  { id: 'kitchen', name: 'kitchen',                       x0: -20,  x1: -13, z0: -14, z1: -7 },
  { id: 'break',   name: 'break room',                    x0: -13,  x1: -8,  z0: -14, z1: -7 },
  { id: 'annex',   name: 'the annex',                     x0: 12,   x1: 20,  z0: -14, z1: -3 },
];
// conference room (west of reception): glass + blinds, door off the lobby
wall(-20, 4, -8, 4, { glass: true, blinds: true });
wall(-8, 4, -8, 14, { glass: true, blinds: true, gaps: [[5.0, 6.6]] });
// Michael's office (east of reception): glass + blinds on both inner walls, door on the north side by Jim + Dwight
wall(10, 4, 20, 4, { glass: true, blinds: true, gaps: [[10.6, 12.2]] });
wall(10, 4, 10, 14, { glass: true, blinds: true });
// kitchen + break room (back west corner)
wall(-20, -7, -8, -7, { gaps: [[-17.4, -15.8], [-11.6, -10.0]] });
wall(-8, -14, -8, -7);
wall(-13, -14, -13, -7, { gaps: [[-9.6, -8.0]] });
// the annex (back east corner): opening on its west side off the bullpen
wall(12, -14, 12, -3, { gaps: [[-5.6, -4.0]] });
wall(12, -3, 20, -3);
// Ryan's closet in the annex corner
wall(17.4, -14, 17.4, -11.4); wall(17.4, -11.4, 20, -11.4, { gaps: [[18.0, 19.4]] });

// structural columns in the bullpen
for (const [x, z] of [[-7.4, -1.6], [10.6, -1.2]]) {
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, H, 16), M.wall);
  col.position.set(x, H / 2, z); col.castShadow = col.receiveShadow = true; scene.add(col);
  addCollider(x, z, 0.6, 0.6);
}
// floor finishes: vinyl in the kitchen / break room, rug in Michael's office, accounting carpet patch
{
  const k = box(12, 0.006, 7, M.vinyl, -14, 0.004, -10.5, scene, false); k.castShadow = false;
  const r = box(4.4, 0.008, 3.4, M.rug, 15.6, 0.005, 9.2, scene, false); r.castShadow = false;
  const a = box(5.4, 0.006, 4.6, M.carpetWarm, -3.5, 0.003, -5.3, scene, false); a.castShadow = false;
}

// ---------- outside view ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.ground);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
box(60, 0.02, 6, M.paving, 0, -0.01, -18, scene, false);
box(6, 0.02, 60, M.paving, 24, -0.01, 0, scene, false);
{
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2, 6), std('#6b4f3a'), 40);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), M.leaf, 40);
  const m4 = new THREE.Matrix4(); let i = 0;
  const spots = [];
  for (let x = -40; x <= 40; x += 7) spots.push([x + (Math.random() - .5) * 3, -26 - Math.random() * 10]);
  for (let z = -30; z <= 30; z += 7) spots.push([32 + Math.random() * 10, z + (Math.random() - .5) * 3]);
  for (const [x, z] of spots.slice(0, 40)) {
    const s = 0.8 + Math.random() * 0.7;
    m4.makeScale(s, s, s).setPosition(x, 1 * s, z); trunk.setMatrixAt(i, m4);
    m4.makeScale(s, s * 1.2, s).setPosition(x, 2.6 * s, z); crown.setMatrixAt(i, m4); i++;
  }
  trunk.count = crown.count = i; scene.add(trunk, crown);
  for (let k = 0; k < 6; k++) box(10 + Math.random() * 8, 8 + Math.random() * 18, 10, M.bldg, -50 + k * 20, 6, -70 - Math.random() * 20, scene, false);
}

// ---------- props ----------
const potGeo = new THREE.CylinderGeometry(0.22, 0.17, 0.45, 12), leafGeo = new THREE.IcosahedronGeometry(0.28, 0);
function plant(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s);
  const pot = new THREE.Mesh(potGeo, M.pot); pot.position.y = 0.225; pot.castShadow = true; g.add(pot);
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(leafGeo, i % 2 ? M.leaf : M.leaf2);
    l.position.set((Math.random() - .5) * .25, 0.75 + i * 0.18, (Math.random() - .5) * .25); l.castShadow = true; g.add(l);
  }
  scene.add(g); addCollider(x, z, 0.45 * s, 0.45 * s);
}
function chair(parent, x, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  box(0.5, 0.08, 0.48, M.chairSeat, 0, 0.48, 0, g);
  box(0.48, 0.55, 0.06, M.chair, 0, 0.82, 0.24, g);
  box(0.06, 0.4, 0.06, M.steel, 0, 0.26, 0, g);
  box(0.6, 0.04, 0.08, M.steel, 0, 0.05, 0, g); box(0.08, 0.04, 0.6, M.steel, 0, 0.05, 0, g);
  parent.add(g); return g;
}
function cabinets(x, z, n, ry = 0) { // row of tall grey filing cabinets (front faces local +z)
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  for (let i = 0; i < n; i++) {
    const cx = (i - (n - 1) / 2) * 0.52;
    box(0.5, 1.32, 0.62, M.cabinet, cx, 0.66, 0, g);
    for (let d = 0; d < 4; d++) box(0.1, 0.025, 0.03, M.steel, cx, 0.3 + d * 0.31, 0.32, g, false);
  }
  addCollider(x, z, n * 0.52, 0.64, ry);
}
function roundTable(x, z, seats = 3) {
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.05, 20), M.oak); top.position.set(x, 0.74, z); top.castShadow = top.receiveShadow = true; scene.add(top);
  box(0.08, 0.72, 0.08, M.steel, x, 0.36, z); box(0.5, 0.03, 0.5, M.steel, x, 0.015, z, scene, false);
  for (let i = 0; i < seats; i++) { const a = i / seats * Math.PI * 2 + 0.4; chair(scene, x + Math.sin(a) * 0.95, z + Math.cos(a) * 0.95, a); }
  addCollider(x, z, 1.25, 1.25);
}
function paperStack(x, z, rows, cols, layers) { // Dunder Mifflin-style paper boxes on a pallet
  box(cols * 0.46 + 0.1, 0.14, rows * 0.32 + 0.1, M.pallet, x, 0.07, z);
  for (let l = 0; l < layers; l++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    box(0.44, 0.27, 0.3, M.paperBox, x + (c - (cols - 1) / 2) * 0.46, 0.14 + 0.135 + l * 0.275, z + (r - (rows - 1) / 2) * 0.32, scene, l === layers - 1);
  addCollider(x, z, cols * 0.46 + 0.1, rows * 0.32 + 0.1);
}

function drawScreen(g, w, h, st, busy = false, task = '') {
  {
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, st.color); grd.addColorStop(1, '#141820');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.08)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${st.short.length > 3 ? 104 : 130}px system-ui,Segoe UI,Arial`; g.fillText(st.short, w / 2, h / 2 - 22);
    g.font = '500 30px system-ui,Segoe UI,Arial'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(st.name, w / 2, h - 52);
    g.fillStyle = busy ? '#ffb74d' : '#7CFC9A'; g.beginPath(); g.arc(28, 28, 9, 0, 7); g.fill();
    g.font = '600 20px system-ui,Arial'; g.textAlign = 'left'; g.fillText(busy ? 'WORKING' : 'READY', 44, 29);
    if (busy && task) {
      g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h - 30, w, 30);
      g.fillStyle = '#ffd59a'; g.font = '600 19px system-ui,Arial'; g.textAlign = 'center';
      let t = task; while (g.measureText(t).width > w - 24 && t.length > 4) t = t.slice(0, -2);
      g.fillText(t === task ? t : t + '…', w / 2, h - 14);
    }
  }
}
function monitorScreenTex(st) { return canvasTex(512, 300, (g, w, h) => drawScreen(g, w, h, st)); }
function setScreenStatus(s, busy, task) {
  const tex = s.screen.material.map, c = tex.image, g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  drawScreen(g, c.width, c.height, s, busy, task); tex.needsUpdate = true;
}
// floating nameplate: bot name + whose desk it is in the show (e.g. "Jim's desk")
function nameplateSprite(st) {
  const tex = canvasTex(1024, 200, (g, w, h) => {
    roundRect(g, 8, 8, w - 16, h - 16, 40); g.fillStyle = 'rgba(24,22,20,.82)'; g.fill();
    g.lineWidth = 6; g.strokeStyle = st.color; g.stroke();
    g.fillStyle = st.color; g.beginPath(); g.arc(80, h / 2, 26, 0, 7); g.fill();
    const two = !!st.desk;
    let fs = two ? 72 : 84; g.font = `700 ${fs}px system-ui,Segoe UI,Arial`;
    while (g.measureText(st.name).width > w - 180 && fs > 40) { fs -= 4; g.font = `700 ${fs}px system-ui,Segoe UI,Arial`; }
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(st.name, 130, two ? 74 : h / 2 + 4);
    if (two) {
      let ds = 44; g.font = `600 ${ds}px system-ui,Segoe UI,Arial`;
      while (g.measureText(st.desk).width > w - 180 && ds > 26) { ds -= 2; g.font = `600 ${ds}px system-ui,Segoe UI,Arial`; }
      g.fillStyle = '#ffd59a'; g.fillText(st.desk, 132, 146);
    }
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  const width = st.hero ? 2.2 : 1.5; sp.scale.set(width, width * 200 / 1024, 1); sp.renderOrder = 5;
  sp.userData.baseScale = sp.scale.clone();
  return sp;
}

// ---------- stations ----------
const stations = [];
const mugGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 10);
for (const st of STATIONS) {
  const s = st.hero ? 1.25 : 1;
  const g = new THREE.Group(); g.position.set(st.x, 0, st.z); g.rotation.y = st.ry; scene.add(g);
  const dw = 1.6 * s, dd = 0.8 * s;
  // Office-style desk: wood top, modesty panel, drawer pedestal
  box(dw, 0.05, dd, st.hero ? M.walnut : M.oak, 0, 0.74, 0, g);
  box(0.05, 0.72, dd - 0.06, M.steel, -dw / 2 + 0.06, 0.36, 0, g);
  box(0.42, 0.7, dd - 0.08, M.cabinet, dw / 2 - 0.25, 0.36, 0, g);
  box(dw - 0.2, 0.42, 0.02, M.steel, 0, 0.47, -dd / 2 + 0.04, g);
  // monitor
  const mw = st.hero ? 1.25 : 0.72, mh = mw * 300 / 512;
  const mz = -dd / 2 + 0.17, my = 0.77 + 0.14 + mh / 2;
  box(mw + 0.04, mh + 0.04, 0.03, M.bezel, 0, my, mz - 0.017, g);
  box(0.05, 0.16, 0.05, M.bezel, 0, 0.84, mz - 0.04, g);
  box(0.24, 0.015, 0.16, M.bezel, 0, 0.775, mz - 0.03, g);
  const screenMat = new THREE.MeshBasicMaterial({ map: monitorScreenTex(st), toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), screenMat); screen.position.set(0, my, mz + 0.0); g.add(screen);
  // highlight frame
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(mw + 0.12, mh + 0.12), new THREE.MeshBasicMaterial({ color: '#ffd27a', toneMapped: false }));
  frame.position.set(0, my, mz - 0.035); frame.visible = false; g.add(frame);
  // keyboard, mouse, mug
  box(0.42, 0.015, 0.14, M.white, 0, 0.775, 0.08, g, false);
  box(0.06, 0.02, 0.1, M.white, 0.32, 0.775, 0.08, g, false);
  const mug = new THREE.Mesh(mugGeo, st.hero ? M.white : std(st.color, 0.6)); mug.position.set(-dw / 2 + 0.22, 0.815, 0.05); g.add(mug);
  chair(g, 0, dd / 2 + 0.38, Math.random() * 0.4 - 0.2);
  // nameplate
  const plate = nameplateSprite(st); plate.position.set(0, st.hero ? 2.35 : 2.0, mz); g.add(plate);
  // station light accent under desk edge
  box(dw - 0.1, 0.01, 0.01, new THREE.MeshBasicMaterial({ color: st.color }), 0, 0.715, dd / 2 - 0.01, g, false);

  addCollider(st.x, st.z, dw, dd, st.ry);
  g.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(g); bounds.expandByScalar(0.05);
  // where you stand to use this desk (behind the chair), facing the monitor
  // offset to one side so a worker sitting at the desk doesn't block the monitor (over-the-shoulder view)
  const standLocal = new THREE.Vector3(0.6 * s, 0, dd / 2 + 1.7);
  const stand = standLocal.applyMatrix4(g.matrixWorld);
  const mon = new THREE.Vector3(0, 0, mz).applyMatrix4(g.matrixWorld);
  const yaw = Math.atan2(-(mon.x - stand.x), -(mon.z - stand.z));
  stations.push({ ...st, group: g, screen, frame, plate, bounds, stand, yaw, center: new THREE.Vector3(st.x, 1, st.z) });
}
const ST = id => STATIONS.find(s => s.id === id);

// live desk monitors: Grok = HQ chat transcript, others = current task / idle (monitors.js)
const monitors = createMonitors({ stations });

// ---------- reception (Pam's desk, right inside the front door) ----------
{
  const p = ST('inbox'), rx = p.x, rz = p.z + 0.62; // tall front counter on the door side of the desk
  box(2.9, 1.12, 0.12, M.recep, rx, 0.56, rz);
  box(3.1, 0.05, 0.38, M.oak, rx, 1.145, rz + 0.04);
  for (const sx of [-1, 1]) { box(0.12, 1.12, 1.25, M.recep, rx + sx * 1.43, 0.56, rz - 0.6); box(0.36, 0.05, 1.3, M.oak, rx + sx * 1.43, 1.145, rz - 0.6); }
  addCollider(rx, rz, 3.0, 0.3); addCollider(rx - 1.43, rz - 0.6, 0.3, 1.3); addCollider(rx + 1.43, rz - 0.6, 0.3, 1.3);
  // Pam's candy jar on the counter
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 14), M.glassJar); jar.position.set(rx + 0.9, 1.27, rz + 0.04); scene.add(jar);
  const candy = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), std('#e85d75', 0.5)); candy.position.set(rx + 0.9, 1.22, rz + 0.04); scene.add(candy);
  // phone + sign on the counter front, facing the door
  box(0.22, 0.06, 0.18, M.bezel, rx - 0.75, 0.8, rz - 0.25, scene, false);
  sign('GROK BOT HQ', rx, 0.66, rz + 0.07, 0, { w: 2.2, h: 0.5, bg: '#f4f1ea', fg: '#1d1d1f', sub: 'Scranton Branch · Reception', font: 'Georgia,Times New Roman,serif' });
  // copier (the copy machine by reception, against the conference room glass)
  box(0.75, 0.95, 0.9, M.copier, -7.3, 0.475, 10.6); box(0.8, 0.12, 0.95, M.copierDark, -7.3, 1.01, 10.6);
  box(0.5, 0.04, 0.6, M.white, -7.3, 1.09, 10.6, scene, false); box(0.04, 0.12, 0.3, M.bezel, -6.9, 1.03, 10.5, scene, false);
  addCollider(-7.3, 10.6, 0.8, 0.95);
  // waiting chairs by the door + the big sign on the wall inside the door
  chair(scene, 4.2, 13.3, 0); chair(scene, 5.0, 13.3, 0); addCollider(4.6, 13.3, 1.6, 0.6);
  sign('GROK BOT HQ', -4.2, 2.0, Z1 - 0.12, Math.PI, { w: 3.6, h: 0.9, bg: '#f4f1ea', fg: '#1d1d1f', sub: 'a Dunder Mifflin-style office · Scranton, PA', font: 'Georgia,Times New Roman,serif' });
  plant(-1.5, 13.3, 1.15); plant(1.5, 13.3, 1.15); plant(-7.4, 13.3, 1);
}

// ---------- Michael's office (Grok Bot) ----------
{
  sign('GROK BOT', 11.4, 2.66, 3.9, Math.PI, { w: 1.5, h: 0.36, bg: '#2b2b2b', fg: '#f4e6cf', sub: 'Regional Manager' });
  sign('GROK BOT', 9.9, 2.66, 9, -Math.PI / 2, { w: 1.5, h: 0.36, bg: '#2b2b2b', fg: '#f4e6cf', sub: 'Regional Manager' }); // seen from reception
  // couch along the south wall + guest chairs facing the desk
  box(2.6, 0.42, 0.85, M.sofa, 13.6, 0.21, 13.3); box(2.6, 0.5, 0.22, M.sofa, 13.6, 0.67, 13.68);
  box(0.25, 0.6, 0.85, M.sofa, 12.2, 0.3, 13.3); box(0.25, 0.6, 0.85, M.sofa, 15.0, 0.3, 13.3);
  addCollider(13.6, 13.4, 3.0, 1.0);
  chair(scene, 14.1, 8.6, -Math.PI / 2 + 0.2); chair(scene, 14.1, 9.8, -Math.PI / 2 - 0.2);
  cabinets(19.5, 5.4, 2, -Math.PI / 2);
  // "World's Best Bot" mug poster on the wall behind the couch
  sign("WORLD'S BEST BOT", 17.4, 1.9, Z1 - 0.12, Math.PI, { w: 2.0, h: 0.5, bg: '#ffffff', fg: '#1d1d1f', font: 'Georgia,Times New Roman,serif' });
  plant(19.2, 13.2, 1.2); plant(10.8, 13.2, 1);
}

// ---------- conference room (west of reception) ----------
{
  const tx = -14, tz = 8.8;
  box(6, 0.06, 1.7, M.walnut, tx, 0.75, tz);
  box(0.5, 0.72, 0.5, M.steel, tx - 2, 0.36, tz); box(0.5, 0.72, 0.5, M.steel, tx + 2, 0.36, tz);
  addCollider(tx, tz, 6, 1.7);
  for (let i = 0; i < 5; i++) { const x = tx - 2.4 + i * 1.2; chair(scene, x, tz - 1.25, Math.PI); chair(scene, x, tz + 1.25, 0); }
  chair(scene, tx - 3.5, tz, -Math.PI / 2); chair(scene, tx + 3.5, tz, Math.PI / 2);
  // wall TV on the west wall
  box(0.08, 1.2, 2.1, M.bezel, -19.86, 1.65, tz);
  const brief = canvasTex(1024, 580, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#1d2733'); grd.addColorStop(1, '#3b2a1c'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8a33d'; g.font = '800 92px system-ui,Arial'; g.fillText('HQ BRIEFING', 60, 150);
    g.fillStyle = '#ddd'; g.font = '500 44px system-ui,Arial';
    ['14 bots, Scranton floor plan', 'Idle bots roam, busy bots sit at their desk', 'Hold View to chat with the team'].forEach((t, i) => g.fillText('• ' + t, 70, 260 + i * 80));
  });
  const bs = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.12), new THREE.MeshBasicMaterial({ map: brief, toneMapped: false }));
  bs.rotation.y = Math.PI / 2; bs.position.set(-19.81, 1.65, tz); scene.add(bs);
  sign('CONFERENCE ROOM', -7.92, 2.66, 5.8, Math.PI / 2, { w: 1.6, h: 0.3 });
  plant(-19.2, 4.7, 1.1); plant(-8.7, 4.7, 1);
}
// full-wall hand-drawn whiteboard on the conference room's south wall = live widget screen (HQ #21, #25): clock, weather, markets, team status + bank
const whiteboard = createWhiteboard({ scene, x0: -19.7, x1: -8.3, y0: 0.5, y1: 3.05, z: 13.86, std, box });

// ---------- bullpen extras ----------
cabinets(17.6, -2.6, 5, 0);             // filing cabinets along the annex wall, behind Dwight
cabinets(-0.2, -7.6, 3, 0);             // accounting files
sign('ACCOUNTING', -3.5, 2.85, -5.3, 0, { w: 1.6, h: 0.3, bg: '#3c5a3e' });
// Jim + Dwight touches: Dwight's bobblehead, Jim's stapler in jello
{
  const d = ST('assist'), j = ST('cos');
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), std('#f1c9a5', 0.6)); bob.position.set(d.x - 0.55, 0.92, d.z - 0.1); scene.add(bob);
  box(0.06, 0.1, 0.06, std('#5a3a22', 0.7), d.x - 0.55, 0.82, d.z - 0.1, scene, false);
  const jello = new THREE.Mesh(boxGeo(0.22, 0.09, 0.12), new THREE.MeshPhysicalMaterial({ color: '#f2d33a', transparent: true, opacity: 0.75, roughness: 0.2 }));
  jello.position.set(j.x + 0.55, 0.81, j.z + 0.1); scene.add(jello);
  box(0.16, 0.035, 0.04, M.steel, j.x + 0.55, 0.81, j.z + 0.1, scene, false);
}
// the annex: sign at the opening + Ryan's closet desk
sign('THE ANNEX', 11.92, 2.66, -4.8, -Math.PI / 2, { w: 1.4, h: 0.3, bg: '#4a3b6b' });
sign("RYAN'S CLOSET", 18.7, 2.66, -11.32, 0, { w: 1.2, h: 0.24, bg: '#555' });
box(1.0, 0.05, 0.6, M.oak, 18.7, 0.74, -13.3); box(0.9, 0.7, 0.05, M.steel, 18.7, 0.36, -13.55); addCollider(18.7, -13.3, 1.0, 0.6);
chair(scene, 18.7, -12.6, 0);
cabinets(13.0, -13.4, 2, 0);

// ---------- kitchen + break room (back west corner) ----------
{
  const cab = M.cabinetWhite, seam = std('#9a948b', 0.8), handle = std('#b8bcc2', 0.3, 0.8);
  // counter run along the west wall
  const kx = -19.55, kz = -10.6;
  box(0.65, 0.86, 5, cab, kx, 0.45, kz); box(0.7, 0.04, 5.05, M.walnut, kx, 0.9, kz);
  for (let i = 0; i < 6; i++) { const z = kz - 2.5 + 0.42 + i * 0.83; box(0.02, 0.14, 0.025, handle, kx + 0.345, 0.72, z, scene, false); }
  box(0.42, 0.02, 0.6, std('#c9ccd0', 0.25, 0.8), kx + 0.02, 0.925, kz + 0.9, scene, false);                        // sink
  box(0.04, 0.3, 0.04, handle, kx - 0.22, 1.07, kz + 0.9, scene, false); box(0.18, 0.04, 0.04, handle, kx - 0.14, 1.21, kz + 0.9, scene, false);
  box(0.32, 0.42, 0.3, std('#1d1d1f', 0.4, 0.3), kx - 0.05, 1.13, kz - 0.9);                                        // coffee maker
  box(0.4, 0.3, 0.55, M.white, kx - 0.02, 1.07, kz - 1.9); box(0.02, 0.2, 0.3, M.bezel, kx + 0.19, 1.07, kz - 1.95, scene, false); // microwave
  box(0.4, 0.8, 5, cab, -19.7, 2.1, kz);                                                                             // upper cabinets
  for (let i = 1; i < 6; i++) box(0.012, 0.76, 0.012, seam, -19.49, 2.1, kz - 2.5 + i * 0.83, scene, false);
  const ss = std('#c3c7cc', 0.35, 0.7); box(0.75, 1.95, 0.85, ss, -19.5, 0.975, -7.6);                              // fridge
  box(0.04, 0.9, 0.04, std('#6b6f75', 0.3, 0.8), -19.1, 1.15, -7.4, scene, false);
  addCollider(-19.55, -10.4, 0.75, 6.8);
  roundTable(-16.2, -10.4, 3);
  sign('KITCHEN', -16.6, 2.66, -6.92, 0, { w: 1.2, h: 0.28 });
  // break room: snack + soda machines on the east wall, table
  for (const [z, c, label] of [[-12.6, '#25303f', 'SNACKS'], [-11.4, '#b8242b', 'SODA']]) {
    box(0.85, 1.85, 1.0, std(c, 0.5, 0.2), -8.55, 0.925, z);
    box(0.02, 1.2, 0.62, M.vendGlass, -8.98, 1.1, z - 0.1, scene, false);
    sign(label, -8.99, 1.75, z + 0.38, -Math.PI / 2, { w: 0.3, h: 0.12, bg: '#111', fg: '#ffd27a' }).position.x = -8.99;
  }
  addCollider(-8.55, -12, 0.9, 2.2);
  roundTable(-11, -11.4, 3);
  sign('BREAK ROOM', -10.8, 2.66, -6.92, 0, { w: 1.4, h: 0.28 });
  plant(-12.4, -13.3, 1);
}

// ---------- warehouse door (west wall) ----------
// The real warehouse is downstairs; here it's a labeled door + a pallet of paper so the iPad doesn't pay for a second floor.
{
  box(0.08, 2.25, 1.3, M.whDoor, X0 + 0.12, 1.125, 0.9, scene, false);
  box(0.1, 2.35, 0.08, M.walnut, X0 + 0.12, 1.175, 0.21, scene, false); box(0.1, 2.35, 0.08, M.walnut, X0 + 0.12, 1.175, 1.59, scene, false);
  box(0.06, 0.06, 0.8, M.steel, X0 + 0.2, 1.05, 0.9, scene, false);       // push bar
  box(0.03, 0.4, 0.3, std('#e8e2d5', 0.6), X0 + 0.17, 1.6, 0.9, scene, false);
  sign('WAREHOUSE', X0 + 0.13, 2.55, 0.9, Math.PI / 2, { w: 1.4, h: 0.32, bg: '#2f3a2f', fg: '#ffd27a', sub: 'stairs down · Darryl' });
  paperStack(-18.4, 2.9, 2, 3, 3);
  paperStack(-16.6, 3.1, 2, 2, 2);
}

// water cooler on the west wall in the bullpen, outside the kitchen (workers stop here when idle; the only place they drink)
// classic office cooler: white cabinet, big blue jug upside-down on top, blue/red taps, drip tray, paper-cup tube + bin
const COOLER = { x: -19.45, z: -4.4 };
function waterCooler(x, z, ry = Math.PI / 2) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; // local +z = front (faces into the room)
  const white = std('#f4f5f7', 0.45), grey = std('#9aa0a6', 0.5), dark = std('#2b2f33', 0.6);
  const jugMat = new THREE.MeshPhysicalMaterial({ color: '#3d9bff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.82, clearcoat: 1 });
  box(0.36, 0.98, 0.34, white, 0, 0.49, 0, g);
  box(0.37, 0.05, 0.35, grey, 0, 0.025, 0, g);
  box(0.38, 0.03, 0.36, white, 0, 1.0, 0, g);
  box(0.26, 0.26, 0.02, dark, 0, 0.78, 0.171, g, false);
  box(0.24, 0.02, 0.08, grey, 0, 0.66, 0.2, g, false);
  box(0.05, 0.06, 0.06, std('#1e6fe0', 0.4), -0.06, 0.84, 0.2, g, false);
  box(0.05, 0.06, 0.06, std('#d8312b', 0.4), 0.06, 0.84, 0.2, g, false);
  box(0.2, 0.004, 0.004, grey, 0, 0.42, 0.171, g, false);
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.34, 24), jugMat); jug.position.y = 1.33; g.add(jug);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), jugMat); top.position.y = 1.5; g.add(top);
  const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.055, 0.1, 24), jugMat); shoulder.position.y = 1.11; g.add(shoulder);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), jugMat); neck.position.y = 1.04; g.add(neck);
  for (const y of [1.24, 1.42]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.152, 0.008, 6, 24), jugMat); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); }
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.153, 0.153, 0.07, 24, 1, true, -0.9, 1.8), std('#ffffff', 0.6)); label.position.y = 1.33; g.add(label);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.36, 12), new THREE.MeshPhysicalMaterial({ color: '#dfe7ee', transparent: true, opacity: 0.55, roughness: 0.1 }));
  tube.position.set(0.23, 0.72, 0.05); g.add(tube);
  box(0.06, 0.03, 0.04, grey, 0.2, 0.72, 0.05, g, false);
  const cupMat = std('#ffffff', 0.7);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.07, 12), cupMat); cup.position.set(0.23, 0.505, 0.05); g.add(cup);
  for (const dx of [-0.05, 0.07]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.022, 0.065, 10), cupMat); c.position.set(dx, 0.705, 0.2); g.add(c); }
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.36, 14), grey); bin.position.set(-0.36, 0.18, 0.02); bin.castShadow = true; g.add(bin);
  const sgn = canvasTex(256, 96, (c, w, h) => { roundRect(c, 4, 4, w - 8, h - 8, 18); c.fillStyle = '#1e6fe0'; c.fill(); c.fillStyle = '#fff'; c.font = '800 44px system-ui,Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('💧 WATER', w / 2, h / 2 + 2); });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.19), new THREE.MeshBasicMaterial({ map: sgn, transparent: true, toneMapped: false }));
  sm.position.set(0, 2.0, -0.24); g.add(sm);
  scene.add(g); addCollider(x, z, 1.0, 0.6, ry);
}
waterCooler(COOLER.x, COOLER.z);
for (const [x, z, s] of [[-7.4, -13.2, 1.1], [11.3, -13.2, 1.1], [19.2, -3.7, 1.1], [19.2, 3.3, 1.2], [6.6, 3.4, 1], [-7.4, 3.4, 1], [-19.2, -2.2, 1.1]]) plant(x, z, s);

// idle hangout spots for workers: [x, z, facing yaw, activity]. yaw 0 = facing north, PI/2 = west, -PI/2 = east, PI = south.
// Drinks happen ONLY at the water cooler (HQ #20): no kitchen / sink stops.
const PI = Math.PI;
const IDLE_SPOTS = [
  [-4, -13.1, 0, 'window'], [0.5, -13.1, 0, 'window'], [9.5, -13.1, 0, 'window'], [-6.2, -13.1, 0.1, 'window'],
  [19.1, 0.6, -PI / 2, 'window'], [19.1, -1.6, -PI / 2, 'window'], [15, -13.1, 0, 'window'],
  [-16.2, -8.6, PI, 'think'], [-14.4, -12.8, 0.6, 'phone'],                         // kitchen
  [-9.4, -12, -PI / 2, 'think'], [-10.8, -9.5, PI * 0.8, 'phone'],                  // break room (staring at the vending machine)
  [-12, 11.6, PI, 'think'], [-16.4, 11.6, PI, 'think'], [-18.6, 6.6, PI / 2, 'think'], // conference room
  [2.4, 10.6, PI / 2, 'chat'], [-6.3, 10.6, PI / 2, 'think'], [5.4, 11.4, PI, 'phone'], // reception: chatting with Pam, copier, lobby
  [13.2, 11.6, PI, 'think'], [12.4, 7.2, -PI / 2, 'phone'],                         // Michael's office
  [15.6, -12.6, 0, 'window'], [15.8, -4.4, PI, 'phone'],                            // annex
  [0.8, -1, 2.2, 'phone'], [-6.4, -3, 1.6, 'think'], [11.4, 1.4, -2.2, 'phone'], [9.2, -7.6, 0.4, 'think'], [2.5, 5, 0, 'think'],
  [-18.7, 0.9, PI / 2, 'think'],                                                     // waiting by the warehouse door
  // water cooler on the west wall: stand in front, face the cooler
  [COOLER.x + 0.85, COOLER.z, PI / 2, 'water'], [COOLER.x + 0.85, COOLER.z + 1.0, Math.atan2(0.85, 1.0), 'water'],
  [COOLER.x + 0.85, COOLER.z - 1.0, Math.atan2(0.85, -1.0), 'water'], [COOLER.x + 1.75, COOLER.z, PI / 2, 'water'],
];

// (created after every prop so their nav grid knows about walls, desks, kitchen, cooler, rooms)
// worker characters (one per bot): wander when idle, sit + type at their desk when busy (tasks.json)
const workers = createWorkers({ scene, stations, colliders, pois: IDLE_SPOTS, onStatus: (s, busy, task, meta = {}) => {
  const st = stations.find(x => x.id === s.id); if (!st) return;
  st.busy = busy; st.task = task; monitors.setStatus(st.id, busy, task, meta.since, meta.until);
  if (panelOpen === st) showPanel(st);
} });


// ---------- player ----------
const player = { pos: new THREE.Vector3(0, 0, 12.4), yaw: 0, pitch: 0, radius: 0.3, travel: null };
function blocked(x, z) {
  const r = player.radius;
  for (const c of colliders) if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
  return false;
}
function tryMove(dx, dz) {
  if (!blocked(player.pos.x + dx, player.pos.z)) player.pos.x += dx;
  if (!blocked(player.pos.x, player.pos.z + dz)) player.pos.z += dz;
}

// ---------- input ----------
const keys = new Set();
let mouseDX = 0, mouseDY = 0;
const ui = {
  menu: document.getElementById('menu'), panel: document.getElementById('panel'), reticle: document.getElementById('reticle'),
  focus: document.getElementById('focus'), pad: document.getElementById('pad'), padtxt: document.getElementById('padtxt'), fps: document.getElementById('fps'),
};
let paused = true, panelOpen = null;
function setPaused(p) {
  paused = p; ui.menu.style.display = p ? 'flex' : 'none';
  if (p && document.pointerLockElement) document.exitPointerLock();
}
function lockPointer() {
  if (!CAN_LOCK) return; // iPad / phones: look with the right stick or right-half touch drag instead
  try { const r = renderer.domElement.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
}
document.getElementById('menu').addEventListener('click', () => { setPaused(false); lockPointer(); });
renderer.domElement.addEventListener('click', e => {
  if (!paused && document.pointerLockElement && hoverKind) return refreshCtl.request(hoverKind); // reticle on a REFRESH button
  if (!paused && !document.pointerLockElement) { if (!CAN_LOCK && tapAt(e.clientX, e.clientY)) return; lockPointer(); }
});
document.addEventListener('pointerlockchange', () => {
  // Esc releases the lock: treat that as "pause" unless we released it ourselves
  if (CAN_LOCK && !document.pointerLockElement && !paused && !chat.isOpen() && lastInput === 'mouse') setPaused(true);
});
let lastInput = 'mouse';
addEventListener('mousemove', e => { if (document.pointerLockElement) { mouseDX += e.movementX; mouseDY += e.movementY; lastInput = 'mouse'; } });
addEventListener('keydown', e => {
  if (chat.isOpen()) { // typing in chat: don't walk / interact
    if (e.code === 'Escape') { e.preventDefault(); chat.close(); }
    return;
  }
  if ((e.code === 'Enter' || e.code === 'KeyT') && !paused) { e.preventDefault(); openChat(); return; }
  if (e.code === 'Tab') e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code); lastInput = 'mouse';
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyQ') closePanel();
  if (e.code === 'Tab') nextStation();
  if (e.code === 'KeyP') setPaused(!paused);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); }
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 250));

// ---------- touch fallback (iPad without a controller) ----------
// Left half: drag = virtual move stick. Right half: drag = look. Buttons: Interact / Next desk / Pause.
const touch = { move: null, look: null, mx: 0, mz: 0, ldx: 0, ldy: 0 };
const TOUCH_RADIUS = 60, TOUCH_LOOK = 0.005;
const knob = document.getElementById('knob'), knobBase = document.getElementById('knobbase');
function showKnob(t, dx = 0, dy = 0) {
  if (!knob) return;
  knobBase.style.display = knob.style.display = t ? 'block' : 'none';
  if (!t) return;
  knobBase.style.left = t.x0 + 'px'; knobBase.style.top = t.y0 + 'px';
  knob.style.left = (t.x0 + dx) + 'px'; knob.style.top = (t.y0 + dy) + 'px';
}
const canvasEl = renderer.domElement;
const taps = new Map(); // short, still touches = taps (REFRESH buttons on the whiteboard / inbox monitor)
canvasEl.addEventListener('touchstart', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    taps.set(t.identifier, { x: t.clientX, y: t.clientY, t: performance.now(), moved: false });
    if (t.clientX < innerWidth / 2 && !touch.move) { touch.move = { id: t.identifier, x0: t.clientX, y0: t.clientY }; showKnob(touch.move); }
    else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
  lastInput = 'touch';
}, { passive: false });
canvasEl.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) {
      let dx = t.clientX - touch.move.x0, dy = t.clientY - touch.move.y0;
      const m = Math.hypot(dx, dy); if (m > TOUCH_RADIUS) { dx *= TOUCH_RADIUS / m; dy *= TOUCH_RADIUS / m; }
      touch.mx = dx / TOUCH_RADIUS; touch.mz = dy / TOUCH_RADIUS; showKnob(touch.move, dx, dy);
    }
    const tp = taps.get(t.identifier); if (tp && Math.hypot(t.clientX - tp.x, t.clientY - tp.y) > 14) tp.moved = true;
    if (touch.look && t.identifier === touch.look.id) {
      touch.ldx += t.clientX - touch.look.x; touch.ldy += t.clientY - touch.look.y;
      touch.look.x = t.clientX; touch.look.y = t.clientY;
    }
  }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
    const tp = taps.get(t.identifier); taps.delete(t.identifier);
    if (tp && !tp.moved && performance.now() - tp.t < 400 && e.type === 'touchend') tapAt(t.clientX, t.clientY);
    if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; showKnob(null); }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
}
canvasEl.addEventListener('touchend', touchEnd); canvasEl.addEventListener('touchcancel', touchEnd);
function tapBtn(id, fn) {
  const el = document.getElementById(id); if (!el) return;
  el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
  el.addEventListener('click', e => { e.stopPropagation(); fn(); });
}
tapBtn('t-interact', () => interact());
tapBtn('t-next', () => nextStation(1));
tapBtn('t-pause', () => setPaused(!paused));
tapBtn('t-chat', () => openChat());
tapBtn('panel', () => closePanel());
// Block iOS pinch-zoom / double-tap zoom / rubber-band scrolling.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1 || e.target === document.body || e.target === document.documentElement) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', e => { if (e.target.closest?.('#chat')) return; const n = Date.now(); if (n - lastTouchEnd < 300) e.preventDefault(); lastTouchEnd = n; }, { passive: false });

const DEAD = 0.16;
function stick(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const n = Math.min(1, (m - DEAD) / (1 - DEAD));
  return [x / m * n, y / m * n];
}
const prevButtons = [];
const VIEW_BTN = 8, VIEW_HOLD_MS = 500;
function padState() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null; for (const p of pads) if (p && p.connected) { pad = p; break; }
  if (!pad) {
    ui.pad.classList.remove('on'); ui.padtxt.textContent = 'No controller: press any button on it';
    document.documentElement.classList.remove('haspad');
    return null;
  }
  ui.pad.classList.add('on');
  document.documentElement.classList.add('haspad'); // hides touch UI + "press any button" prompt
  const id = pad.id.replace(/\(.*?\)/g, '').trim().slice(0, 40) || 'Gamepad';
  ui.padtxt.textContent = `${id} connected`;
  const pressed = i => !!pad.buttons[i]?.pressed;
  const edge = i => { const p = pressed(i), was = prevButtons[i]; prevButtons[i] = p; return p && !was; };
  // Xbox View (two squares, left of the Xbox button) = Standard Gamepad buttons[8] ("Back/Select").
  // In the standard map buttons[6] is LT, so 6 is only treated as View when the browser reports a non-standard mapping.
  const viewDown = pressed(VIEW_BTN) || (pad.mapping !== 'standard' && pressed(6));
  const st = { pad, viewDown, LB: edge(4), RB: edge(5), L: stick(pad.axes[0] || 0, pad.axes[1] || 0), R: stick(pad.axes[2] || 0, pad.axes[3] || 0),
    A: edge(0), B: edge(1), X: edge(2), Y: edge(3), start: edge(9), back: edge(8), sprint: pressed(10) || (pad.buttons[7]?.value || 0) > 0.5,
    dpad: { up: edge(12), down: edge(13), left: edge(14), right: edge(15) } };
  if (st.L[0] || st.L[1] || st.R[0] || st.R[1] || pad.buttons.some(b => b.pressed)) lastInput = 'pad';
  return st;
}
addEventListener('gamepadconnected', e => { document.documentElement.classList.add('haspad'); ui.padtxt.textContent = `${e.gamepad.id.slice(0, 40)} connected`; });
addEventListener('gamepaddisconnected', () => { document.documentElement.classList.remove('haspad'); });

// ---------- interaction ----------
const ray = new THREE.Ray(), tmpV = new THREE.Vector3(), hitPt = new THREE.Vector3();
let focused = null;
function findFocus() {
  camera.getWorldDirection(tmpV); ray.set(camera.position, tmpV);
  let best = null, bestD = 6;
  for (const s of stations) { const p = ray.intersectBox(s.bounds, hitPt); if (p) { const d = p.distanceTo(camera.position); if (d < bestD) { bestD = d; best = s; } } }
  const wk = workers.pick(ray, bestD); if (wk) return stations.find(s => s.id === wk.st.id);
  if (best) return best;
  // fallback: nearest desk within 2.6m that is roughly in front of you
  let nd = 2.6;
  for (const s of stations) {
    const to = tmpV.clone().set(s.x - player.pos.x, 0, s.z - player.pos.z); const d = to.length();
    const fwd = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    if (d < nd && to.normalize().dot(fwd) > 0.5) { nd = d; best = s; }
  }
  return best;
}
function setFocus(s) {
  if (s === focused) return;
  if (focused) { focused.frame.visible = false; focused.plate.scale.copy(focused.plate.userData.baseScale); }
  focused = s;
  ui.reticle.classList.toggle('hot', !!s);
  ui.focus.classList.toggle('show', !!s);
  if (s) { s.frame.visible = true; s.plate.scale.copy(s.plate.userData.baseScale).multiplyScalar(1.15); ui.focus.textContent = `${s.name}  ·  A / E to view screen`; }
}
let lastDesk = null;
function interact() {
  if (paused) return;
  if (!panelOpen && hoverKind) return refreshCtl.request(hoverKind); // reticle on a REFRESH button: A / E refreshes
  if (panelOpen) return closePanel();
  if (!focused) return;
  panelOpen = focused; lastDesk = focused;
  showPanel(focused);
}
const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showPanel(s) {
  const status = s.busy ? `<b style="color:#ffb74d">● Working at desk</b>${s.task ? ': ' + escH(s.task) : ''}`
    : `<b style="color:#7CFC9A">● Idle</b>: out on the floor, ready for a task`;
  ui.panel.innerHTML = `<h2><span class="sw" style="background:${s.color}"></span>${s.name}</h2>
    <p>${s.role}</p><p>${status}</p>
    <div class="screenwrap"></div>
    ${REFRESH_KIND[s.id] ? `<button class="refreshbtn" type="button">⟳ REFRESH ${s.short === 'FI' ? 'INBOX' : s.short} <span>(tap or X)</span></button>` : ''}
    <small>Hold View (or Enter) to message this bot via Grok Bot + team. B / Q / A to close.</small>`;
  const rb = ui.panel.querySelector('.refreshbtn');
  if (rb) for (const ev of ['touchstart', 'click']) rb.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); if (ev === 'click' && e.pointerType === 'touch') return; refreshCtl.request(REFRESH_KIND[s.id]); }, { passive: false });
  // the desk's live monitor, full size and readable (same canvas the 3D screen uses, so it keeps updating)
  const cv = monitors.canvas(s.id); if (cv) { cv.className = 'deskscreen'; ui.panel.querySelector('.screenwrap').appendChild(cv); }
  ui.panel.classList.toggle('wide', !!s.hero);
  ui.panel.style.display = 'block';
}
function closePanel() { panelOpen = null; ui.panel.style.display = 'none'; ui.panel.querySelector('canvas')?.remove(); }
let stationIdx = -1;
function nextStation(dir = 1) {
  if (paused) return;
  closePanel();
  stationIdx = (stationIdx + dir + stations.length) % stations.length;
  const s = stations[stationIdx]; lastDesk = s;
  player.travel = { from: player.pos.clone(), to: new THREE.Vector3(s.stand.x, 0, s.stand.z), yaw0: player.yaw, yaw1: s.yaw, t: 0 };
}
// ---------- HQ chat ----------
// Grab what Chris is looking at (3D view only, no HUD/chat) as a small JPEG data URL for HQ chat.
// Renders a fresh frame and copies it in the same task, so no preserveDrawingBuffer is needed. Returns null on any failure.
// Where Chris is + which way he faces, burned into the HQ shot (text banner + mini floor map). North = -z (north window wall), east = +x.
function whereAmI() {
  const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
  const heading = ((Math.atan2(fx, -fz) * 180 / Math.PI) + 360) % 360; // 0 = north, 90 = east
  const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const facing = dirs[Math.round(heading / 45) % 8];
  const near = stations.map(s => ({ s, d: Math.hypot(s.x - player.pos.x, s.z - player.pos.z) })).sort((a, b) => a.d - b.d)[0];
  const { x, z } = player.pos;
  const room = ROOMS.find(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const area = room ? room.name : Math.hypot(x - COOLER.x, z - COOLER.z) < 3 ? 'by the water cooler' : Math.hypot(x - X0, z - 0.9) < 3 ? 'by the warehouse door'
    : z > 4 ? 'reception (Pam\'s desk)' : x > -6.5 && x < -0.5 && z > -8.5 && z < -2.5 ? 'accounting' : z < -8 ? 'back of the bullpen (window side)' : 'the bullpen';
  return { x, z, heading, facing, area, near: near && near.d < 4 ? near : null };
}
function stampWhere(g, w, h) {
  const p = whereAmI(), k = Math.max(0.6, w / 1280);
  const line1 = `📍 Chris at x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)} · facing ${p.facing} (${Math.round(p.heading)}°)`;
  const line2 = `${p.area}${p.near ? ` · near ${p.near.s.name}${p.near.s.desk ? ` at ${p.near.s.desk}` : `'s desk`} (${p.near.d.toFixed(1)} m)` : ''} · north = window wall`;
  g.font = `600 ${Math.round(22 * k)}px system-ui,Arial`;
  const bw = Math.max(g.measureText(line1).width, g.measureText(line2).width) + 28 * k, bh = 66 * k;
  g.fillStyle = 'rgba(0,0,0,.62)'; roundRect(g, 10 * k, 10 * k, bw, bh, 10 * k); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'top'; g.textAlign = 'left';
  g.fillText(line1, 24 * k, 18 * k);
  g.fillStyle = '#ffd59a'; g.font = `500 ${Math.round(19 * k)}px system-ui,Arial`; g.fillText(line2, 24 * k, 44 * k);
  // mini floor map (top-down, north up): Scranton floor plan rooms, desks, cooler, Chris + view cone
  const mw = 220 * k, mh = mw * D / W, mx = w - mw - 12 * k, my = 30 * k, sx = mw / W, sz = mh / D;
  const P = (x, z) => [mx + (x - X0) * sx, my + (z - Z0) * sz];
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(mx - 6 * k, my - 6 * k, mw + 12 * k, mh + 12 * k);
  g.fillStyle = '#b9c2cc'; g.fillRect(mx, my, mw, mh);
  g.fillStyle = '#7fc4ff'; g.fillRect(mx, my, mw, 3 * k); g.fillRect(mx + mw - 3 * k, my, 3 * k, mh); // windows N + E
  g.fillStyle = '#fff'; g.fillRect(...P(-0.8, Z1 - 0.3), 1.6 * sx, 0.6 * sz);                     // front door
  g.fillStyle = '#5c6168'; g.fillRect(mx, my + (0.2 - Z0) * sz, 3 * k, 1.4 * sz);                   // warehouse door
  g.strokeStyle = 'rgba(40,50,70,.9)'; g.lineWidth = 1.5 * k;
  for (const r of ROOMS) g.strokeRect(...P(r.x0, r.z0), (r.x1 - r.x0) * sx, (r.z1 - r.z0) * sz);
  for (const s of stations) { const [a, b] = P(s.x, s.z); g.fillStyle = s.color; g.fillRect(a - 3 * k, b - 3 * k, 6 * k, 6 * k); }
  { const [a, b] = P(COOLER.x, COOLER.z); g.fillStyle = '#1e6fe0'; g.beginPath(); g.arc(a + 3 * k, b, 4 * k, 0, 7); g.fill(); }
  const [px, pz] = P(p.x, p.z), ang = Math.atan2(-Math.cos(player.yaw), -Math.sin(player.yaw)); // canvas angle of facing
  g.fillStyle = 'rgba(255,230,120,.45)'; g.beginPath(); g.moveTo(px, pz); g.arc(px, pz, 34 * k, ang - 0.6, ang + 0.6); g.closePath(); g.fill();
  g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 2 * k; g.beginPath(); g.arc(px, pz, 5 * k, 0, 7); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(13 * k)}px system-ui,Arial`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillText('N (windows)', mx + mw / 2, my - 7 * k);
}
function snapshot(maxW = 1280, q = 0.7) {
  try {
    renderer.render(scene, camera);
    const src = renderer.domElement, sc = Math.min(1, maxW / src.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * sc)); c.height = Math.max(1, Math.round(src.height * sc));
    const g = c.getContext('2d'); g.drawImage(src, 0, 0, c.width, c.height);
    try { stampWhere(g, c.width, c.height); } catch (e) {} // position/facing overlay is a bonus; the shot still goes without it
    const url = c.toDataURL('image/jpeg', q);
    return /^data:image\/jpeg;base64,/.test(url) && url.length > 2000 ? url : null;
  } catch (e) { return null; }
}
// ---------- tap-to-refresh (HQ #29) ----------
// REFRESH marker on the whiteboard BANK panel and the Family Inbox monitor. Tap it (iPad), aim the reticle at it and press
// A / E / click, or press X in the Family Inbox desk panel. That sends an encrypted refresh request through the HQ relay
// (hq-link.requestRefresh); the bridge pings Slack #hq-chat and Grok Bot pulls fresh data. Meanwhile the button shows
// "ASKED GROK…", the feed is polled every 15 s for 10 min, and it flips to "FRESH ✓" when a newer feed lands.
const REFRESH_KIND = { inbox: 'inbox' };
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
const inboxSt = stations.find(s => s.id === 'inbox');
let hoverKind = null;
function refreshHit() {
  const targets = [whiteboard.surface]; if (inboxSt) targets.push(inboxSt.screen);
  raycaster.far = 10;
  const h = raycaster.intersectObjects(targets, false)[0]; if (!h) return null;
  if (h.object === whiteboard.surface) return whiteboard.hitTest(h.uv);
  return h.distance < 5 ? monitors.hitTest('inbox', h.uv) : null;
}
function tapAt(x, y) {
  if (paused || chat.isOpen()) return false;
  const r = canvasEl.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const k = refreshHit(); if (k) { refreshCtl.request(k); return true; }
  return false;
}
function updateHover() {
  let k = null;
  if (!paused && !chat.isOpen() && !panelOpen) { camera.getWorldDirection(tmpV); raycaster.set(camera.position, tmpV); k = refreshHit(); }
  if (k === hoverKind) return;
  hoverKind = k;
  whiteboard.setHover(k === 'bank'); monitors.setHover(k === 'inbox' ? 'inbox' : null, true);
  if (k) { ui.reticle.classList.add('hot'); ui.focus.classList.add('show'); ui.focus.textContent = `⟳ Refresh ${k === 'bank' ? 'bank balances' : 'Family Inbox'}  ·  A / E / tap`; }
  else { const f = focused; focused = null; ui.reticle.classList.remove('hot'); ui.focus.classList.remove('show'); setFocus(f); }
}
const refreshCtl = (() => {
  const KEY = 'hq.refresh', COOLDOWN = 60e3, ASK_TTL = 30 * 60e3, FRESH_TTL = 3 * 60e3, FAIL_TTL = 5 * 60e3;
  let st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const feedAt = { bank: 0, inbox: 0 }, fast = {}, pollers = {};
  function show(kind) {
    const r = st[kind], now = Date.now(); let view = null;
    if (r) {
      if (r.state === 'asked' && feedAt[kind] > r.at) { r.state = 'fresh'; r.fresh = now; save(); }
      if (r.state === 'asked' && now - r.at < ASK_TTL) view = { state: 'asked', at: r.at };
      else if (r.state === 'fresh' && now - r.fresh < FRESH_TTL) view = { state: 'fresh' };
      else if (r.state === 'failed' && now - r.at < FAIL_TTL) view = { state: 'failed' };
    }
    if (kind === 'bank') whiteboard.setRefresh(view); else monitors.setRefresh('inbox', view);
  }
  const label = k => (k === 'bank' ? 'bank balances' : 'inbox');
  async function request(kind) {
    const r = st[kind];
    if (r && r.state === 'asked' && Date.now() - r.at < COOLDOWN) { toast(`Already asked Grok Bot. Fresh ${label(kind)} on the way`); return; }
    st[kind] = { state: 'asked', at: Date.now() }; save(); show(kind);
    toast(`⟳ Refresh requested. Grok Bot will pull fresh ${label(kind)}`);
    const ok = await requestRefresh(kind);
    if (!ok) { st[kind] = { state: 'failed', at: Date.now() }; save(); show(kind); toast('Refresh not sent (no signal?). Tap again'); return; }
    fast[kind] = Date.now() + 10 * 60e3; pollers[kind]?.();
  }
  function feed(kind, at) { if (at > feedAt[kind]) feedAt[kind] = at; show(kind); }
  setInterval(() => { show('bank'); show('inbox'); for (const k in fast) if (Date.now() < fast[k]) pollers[k]?.(); }, 15000);
  setTimeout(() => { show('bank'); show('inbox'); }, 0);
  return { request, feed, pollers };
})();
// Family Inbox desk monitor: real inbox headers, encrypted to this iPad (tools/refresh-inbox-feed.mjs). Last copy kept
// on this device so the screen survives the relay's 12 h expiry; falls back to the task screen when there's none.
(function inboxFeed() {
  const KEY = 'hq.inboxFeed';
  try { const f = JSON.parse(localStorage.getItem(KEY) || 'null'); if (f) monitors.setInbox('inbox', f); } catch (e) {}
  async function poll() {
    if (document.hidden) return;
    const f = await fetchInboxFeed(); if (!f) return;
    refreshCtl.feed('inbox', f.at);
    let old = null; try { old = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (old && old.at >= f.at) return;
    try { localStorage.setItem(KEY, JSON.stringify(f)); } catch (e) {}
    monitors.setInbox('inbox', f);
  }
  refreshCtl.pollers.inbox = poll;
  poll(); setInterval(poll, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
// Whiteboard BANK panel: read-only balances, encrypted to this iPad (tools/refresh-bank-feed.mjs). Last good copy kept on
// this device; if the relay has nothing (offline / expired) the panel shows that copy marked stale, or "bank feed offline".
(function bankFeed() {
  const KEY = 'hq.bankFeed';
  let last = null; try { last = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (last) whiteboard.setBank(last, true); // show the saved copy right away; the first poll marks it stale if the relay is empty
  async function poll() {
    if (document.hidden) return;
    const f = await fetchBankFeed();
    if (f) refreshCtl.feed('bank', f.at);
    if (f && (!last || f.at >= last.at)) { last = f; try { localStorage.setItem(KEY, JSON.stringify(f)); } catch (e) {} }
    whiteboard.setBank(last, !!f);
  }
  refreshCtl.pollers.bank = poll;
  poll(); setInterval(poll, 120000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
// Live work on desk screens (HQ #31): encrypted per-device feed from tools/work-live.mjs (step, file, last output lines,
// image thumbnails). Last copy kept on this device; the monitor shows it only while that bot is busy in tasks.json.
(function workFeed() {
  const KEY = 'hq.workFeed';
  try { const f = JSON.parse(localStorage.getItem(KEY) || 'null'); if (f) monitors.setWork(f); } catch (e) {}
  async function poll() {
    if (document.hidden) return;
    const r = await fetchWorkFeed(); if (!r || r.same || !r.feed) return;
    try { localStorage.setItem(KEY, JSON.stringify(r.feed)); } catch (e) {}
    monitors.setWork(r.feed);
  }
  poll(); setInterval(poll, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
const chat = createChat({ stations, snapshot, onLog: entries => monitors.setLog(entries), onOpenChange: o => {
  if (o) { closePanel(); touch.move = touch.look = null; touch.mx = touch.mz = 0; showKnob(null); if (document.pointerLockElement) document.exitPointerLock(); }
} });
// who you talk to: open panel > desk you're looking at > last desk you used > Grok Bot
function openChat() { if (paused) return; chat.show(panelOpen || focused || lastDesk || stations.find(s => s.hero)); }
const holdHint = document.getElementById('holdhint'), holdBar = holdHint.querySelector('i');
let viewT0 = null, viewFired = false, tapHintT = 0;
function rumble(pad, ms, mag) { try { pad.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: mag, weakMagnitude: mag })?.catch?.(() => {}); } catch (e) {} }
function handleView(gp, now) {
  if (gp.viewDown) {
    if (viewT0 === null) { viewT0 = now; viewFired = false; }
    const held = now - viewT0;
    if (!viewFired && !paused) {
      holdHint.classList.toggle('show', held > 120 && !chat.isOpen());
      holdBar.style.width = Math.min(100, held / VIEW_HOLD_MS * 100) + '%';
    }
    if (!viewFired && held >= VIEW_HOLD_MS && !paused) { viewFired = true; holdHint.classList.remove('show'); rumble(gp.pad, 80, 0.5); chat.isOpen() ? chat.close() : openChat(); }
  } else if (viewT0 !== null) {
    // short tap: no chat, just a tiny nudge + reminder
    if (!viewFired && !paused) { rumble(gp.pad, 30, 0.2); holdHint.textContent = 'Hold View to chat'; holdHint.appendChild(holdBar); holdBar.style.width = '0%'; holdHint.classList.add('show'); tapHintT = now + 900; }
    viewT0 = null;
  }
  if (tapHintT && now > tapHintT && viewT0 === null) { holdHint.classList.remove('show'); tapHintT = 0; }
}
function shortestAngle(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

// ---------- loop ----------
const clock = new THREE.Clock();
let frames = 0, fpsT = 0;
const WALK = 3.2, RUN = 5.6, LOOK = 2.6, MOUSE = 0.0022;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const gp = padState();
  if (gp) handleView(gp, performance.now());
  if (gp && chat.isOpen()) chat.pad(gp);
  else if (gp) {
    if (gp.start) { setPaused(!paused); }
    else if (paused && gp.A) setPaused(false);
    else if (!paused) {
      if (gp.A) interact();
      if (gp.X && panelOpen && REFRESH_KIND[panelOpen.id]) refreshCtl.request(REFRESH_KIND[panelOpen.id]);
      if (gp.B) closePanel();
      if (gp.Y || gp.dpad.right) nextStation(1);
      if (gp.dpad.left) nextStation(-1);
    }
  }
  if (!paused && !chat.isOpen()) {
    let mx = 0, mz = 0, lx = 0, ly = 0, sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz += 1;
    if (keys.has('KeyA')) mx -= 1;
    if (keys.has('KeyD')) mx += 1;
    if (keys.has('ArrowLeft')) lx -= 1;
    if (keys.has('ArrowRight')) lx += 1;
    mx += touch.mx; mz += touch.mz;
    lx += touch.ldx * TOUCH_LOOK / (LOOK * dt || 1); ly += touch.ldy * TOUCH_LOOK / (LOOK * 0.8 * dt || 1);
    if (gp) { mx += gp.L[0]; mz += gp.L[1]; lx += Math.sign(gp.R[0]) * gp.R[0] ** 2; ly += Math.sign(gp.R[1]) * gp.R[1] ** 2; sprint ||= gp.sprint; }
    player.yaw -= lx * LOOK * dt + mouseDX * MOUSE;
    player.pitch -= ly * LOOK * 0.8 * dt + mouseDY * MOUSE;
    player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch));
    const mag = Math.hypot(mx, mz);
    if (mag > 0.01) {
      player.travel = null;
      if (mag > 1) { mx /= mag; mz /= mag; }
      const sp = (sprint ? RUN : WALK) * dt, s = Math.sin(player.yaw), c = Math.cos(player.yaw);
      tryMove((mx * c + mz * s) * sp, (-mx * s + mz * c) * sp);
    }
    if (player.travel) {
      const tr = player.travel; tr.t = Math.min(1, tr.t + dt / 1.1); const e = tr.t * tr.t * (3 - 2 * tr.t);
      player.pos.lerpVectors(tr.from, tr.to, e);
      player.yaw = tr.yaw0 + shortestAngle(tr.yaw0, tr.yaw1) * e;
      player.pitch *= 1 - e * 0.2;
      if (tr.t >= 1) player.travel = null;
    }
  }
  mouseDX = mouseDY = 0; touch.ldx = touch.ldy = 0;
  const bob = 0;
  camera.position.set(player.pos.x, EYE + bob, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  workers.update(dt, clock.elapsedTime, player);
  if (!hoverKind) setFocus(paused ? null : findFocus()); else if (paused) setFocus(null);
  updateHover();
  monitors.tick(performance.now(), player.pos, (panelOpen || focused)?.id);
  for (const s of stations) { // fade nearby plates you aren't looking at so they don't stack up
    const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
    s.plate.material.opacity = s === focused || d > 3.2 ? 1 : 0.25 + 0.75 * Math.max(0, (d - 1.5) / 1.7);
  }
  renderer.render(scene, camera);
  frames++; fpsT += dt; if (fpsT > 0.5) { ui.fps.textContent = `${Math.round(frames / fpsT)} fps`; frames = 0; fpsT = 0; }
  requestAnimationFrame(tick);
}
camera.position.set(player.pos.x, EYE, player.pos.z);
setPaused(true);
// came back from a live reload: same spot, same view, chat reopened with the draft intact
const resume = takeResume();
if (resume) {
  player.pos.set(resume.x, 0, resume.z); player.yaw = resume.yaw; player.pitch = resume.pitch;
  // floor plan changed since that spot was saved (or it's inside a wall now): start at the front door, facing Pam's reception
  if (resume.layout !== LAYOUT || blocked(resume.x, resume.z)) { player.pos.set(0, 0, 12.4); player.yaw = 0; player.pitch = 0; resume.newLayout = true; }
  if (!resume.paused) setPaused(false);
  if (resume.chat) { chat.show(stations.find(s => s.id === resume.chat.to) || stations.find(s => s.hero)); chat.restoreDraft(resume.chat); }
  else if (resume.draft?.text) chat.restoreDraft(resume.draft);
  setTimeout(() => toast(resume.newLayout ? 'Welcome to the Scranton branch: new floor plan' : 'Office updated'), 300);
}
function toast(msg) {
  let el = document.getElementById('livetoast');
  if (!el) { el = document.createElement('div'); el.id = 'livetoast'; el.style.cssText = 'position:fixed;left:50%;top:64px;transform:translateX(-50%);background:rgba(24,22,20,.88);color:#ffd59a;padding:8px 16px;border-radius:999px;font:600 14px system-ui,Arial;z-index:50;pointer-events:none;transition:opacity .4s'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = '1'; clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}
startLiveReload({
  toast,
  isSafe: () => !chat.isSending() && !chat.isTyping(),
  getState: () => ({ layout: LAYOUT, x: player.pos.x, z: player.pos.z, yaw: player.yaw, pitch: player.pitch, paused,
    chat: chat.isOpen() ? chat.draft() : null, draft: chat.draft() }),
});
tick();
// debug hook for automated screenshots
window.__office = { player, stations, setPaused, nextStation, IS_IOS, CAN_LOCK, chat, openChat, snapshot, workers, monitors, whiteboard, camera, colliders, ROOMS, LAYOUT };

// ---------- PWA: offline-capable once loaded (network-first, so updates show up right away) ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
