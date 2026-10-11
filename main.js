import { createChat } from './chat.js';
import * as THREE from './vendor/three.module.js';
import { STATIONS } from './stations.js';
import { createWorkers } from './workers.js';
import { createMonitors } from './monitors.js';
import { createWhiteboard } from './whiteboard.js';
import { startLiveReload, takeResume } from './live.js';
import { fetchInboxFeed, fetchBankFeed, fetchWorkFeed, requestRefresh, requestPick } from './hq-link.js';

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
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
// Daylight spill from north/east windows
const winFill = new THREE.DirectionalLight('#dbeaff', 0.55);
winFill.position.set(10, 6, -30);
scene.add(winFill);
const warm = new THREE.PointLight('#ffcf94', 6, 14, 2);
warm.position.set(0, 2.6, 4.2); // warm spill over Pam's reception
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
}, [14, 9]);
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

// HQ #43: build a block of props in its old-layout coordinates, then slide the whole block (meshes + colliders) by dx/dz.
// Rigid, so counters/shelves/desks stay in one piece; only the aisles between blocks grow.
function moved(dx, dz, fn) {
  const n0 = scene.children.length, c0 = colliders.length; fn();
  for (let i = n0; i < scene.children.length; i++) { scene.children[i].position.x += dx; scene.children[i].position.z += dz; }
  for (let i = c0; i < colliders.length; i++) { const c = colliders[i]; c.minX += dx; c.maxX += dx; c.minZ += dz; c.maxZ += dz; }
}

// ---------- shell: floor, ceiling, walls, windows ----------
// Layout = Dunder Mifflin Scranton, modeled on the set from The Office (HQ #30 / #36 / #38 / #42). Front door + Pam's reception on the
// south wall, Michael's glass office in the south-east corner with the conference room right behind it, the annex past that,
// the bullpen in the middle with desks butted together, kitchen + break room in the back west corner.
const LAYOUT = 'scranton-6-roomy'; // bump when the floor plan changes: live reload then drops Chris at the front door instead of inside a new wall
// HQ #42: set scale 18 x 12 m. HQ #43: a bit roomier, 22 x 15 m (was 26 x 18, before that 40 x 28) with >= 1.2 m aisles;
// the extra room all went into the bullpen aisles + walkways, rooms keep their show proportions. 3 m drop ceiling.
const W = 22, D = 15, H = 3.0, X0 = -11, X1 = 11, Z0 = -7.5, Z1 = 7.5;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.ceiling);
ceil.rotation.x = Math.PI / 2; ceil.position.y = H; scene.add(ceil);

// drop-ceiling fluorescent panels (one instanced mesh, one draw call)
{
  const spots = []; for (let x = -9; x <= 9; x += 3) for (let z = -6; z <= 6; z += 3) spots.push([x, z]);
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
  const head = new THREE.Mesh(mk(len, H - 2.75), M.wall); place(head, mid, (2.75 + H) / 2); scene.add(head);
  const glass = new THREE.Mesh(mk(len, 2.15), M.glass); place(glass, mid, 1.675); glass.renderOrder = 2; scene.add(glass);
  for (let a = from; a <= to + 0.01; a += 2) {
    const m = new THREE.Mesh(axis === 'z' ? boxGeo(0.08, 2.15, 0.24) : boxGeo(0.24, 2.15, 0.08), M.mullion);
    place(m, a, 1.675); scene.add(m);
  }
  const ledge = new THREE.Mesh(axis === 'z' ? boxGeo(len, 0.04, 0.34) : boxGeo(0.34, 0.04, len), M.oak);
  place(ledge, mid, 0.62);
  if (axis === 'z') ledge.position.z += inwardSign * 0.08; else ledge.position.x += inwardSign * 0.08;
  scene.add(ledge);
}
windowWall('z', Z0, X0, X1, 1);   // north: full glass
windowWall('x', X1, Z0, Z1, -1);  // east: full glass
// west wall solid (emergency exit + water cooler live on it)
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
// HQ #42: show-style plaques. Icon Shop's PNGs (assets/signs/png, cream face, brown border, green rule) for the reception,
// conference door and company sign; plate() paints the rest of the office-park door plates in the same style.
const texLoader = new THREE.TextureLoader();
const SIGN_PNG = { reception: 213 / 512, conference: 329 / 512, 'dunder-mifflin': 155 / 512, sales: 256 / 512 };
function pngSign(name, x, y, z, ry, w) {
  const t = texLoader.load(`./assets/signs/png/sign-${name}-512.png`); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = IS_MOBILE ? 4 : 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * SIGN_PNG[name]), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.04, toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
}
const PLATE_FONT = 'Oswald,"Arial Narrow","Helvetica Neue",Impact,Arial,sans-serif';
function plate(text, x, y, z, ry, { w = 1.0, h = 0, sub = '', dark = false } = {}) {
  h = h || w * (sub ? 0.42 : 0.3);
  const tex = canvasTex(512, Math.round(512 * h / w), (g, cw, ch) => {
    const face = dark ? '#2c2416' : '#f3ead6', ink = dark ? '#f3ead6' : '#2c2416';
    roundRect(g, 3, 3, cw - 6, ch - 6, 14); g.fillStyle = ink; g.fill();
    roundRect(g, 11, 11, cw - 22, ch - 22, 9); g.fillStyle = face; g.fill();
    g.strokeStyle = '#d9ccae'; g.lineWidth = 3; roundRect(g, 19, 19, cw - 38, ch - 38, 6); g.stroke();
    g.fillStyle = '#b9ab8a'; for (const [sx, sy] of [[28, 28], [cw - 28, 28], [28, ch - 28], [cw - 28, ch - 28]]) { g.beginPath(); g.arc(sx, sy, 5, 0, 7); g.fill(); }
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = Math.round(ch * (sub ? 0.4 : 0.52)); g.font = `700 ${fs}px ${PLATE_FONT}`;
    while (g.measureText(text).width > cw - 80 && fs > 12) { fs -= 2; g.font = `700 ${fs}px ${PLATE_FONT}`; }
    g.fillText(text, cw / 2, sub ? ch * 0.37 : ch / 2 + 2);
    if (sub) {
      g.fillStyle = '#3d5c3a'; g.fillRect(cw * 0.16, ch * 0.6, cw * 0.68, Math.max(3, ch * 0.035));
      let ss = Math.round(ch * 0.16); g.font = `700 ${ss}px Arial,Helvetica,sans-serif`;
      while (g.measureText(sub).width > cw - 80 && ss > 9) { ss -= 1; g.font = `700 ${ss}px Arial,Helvetica,sans-serif`; }
      g.fillStyle = ink; g.fillText(sub, cw / 2, ch * 0.77);
    }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); return m;
}
// a plate hung from the ceiling on two rods, readable from both sides
function hangPlate(make, x, y, z, ry, w) {
  make(x, y, z + Math.cos(ry) * 0.006, ry); make(x, y, z - Math.cos(ry) * 0.006, ry + Math.PI);
  for (const dx of [-w * 0.35, w * 0.35]) box(0.012, H - y - 0.15, 0.012, M.steel, x + Math.cos(ry) * dx, (H + y + 0.15) / 2, z - Math.sin(ry) * dx, scene, false);
}

// rooms (also used for "where am I" in HQ shots + the mini map)
const ROOMS = [
  { id: 'closet',  name: "Ryan's closet (annex)",             x0: 9.6,  x1: 11,   z0: -7.5, z1: -6.3 },
  { id: 'michael', name: "Michael Scott's office (Grok Bot)", x0: 6.5,  x1: 11,   z0: 2.5,  z1: 7.5 },
  { id: 'conf',    name: 'conference room',                  x0: 6.5,  x1: 11,   z0: -2.5, z1: 2.5 },
  { id: 'supply',  name: 'supply closet',                    x0: -11,  x1: -9.4, z0: 5.9,  z1: 7.5 },
  { id: 'kitchen', name: 'kitchen',                          x0: -11,  x1: -8.4, z0: -7.5, z1: -4.5 },
  { id: 'break',   name: 'break room',                       x0: -8.4, x1: -6,   z0: -7.5, z1: -4.5 },
  { id: 'annex',   name: 'the annex',                        x0: 6.5,  x1: 11,   z0: -7.5, z1: -2.5 },
];
// Michael's office (south-east corner, 4.5 x 4 m): glass + blinds onto the bullpen, door right by Jim, Dwight + Pam
wall(6.5, 2.5, 6.5, 7.5, { glass: true, blinds: true, gaps: [[5.4, 6.6]] });
// shared wall Michael's office | conference room (solid: the live whiteboard hangs on the conference side)
wall(6.5, 2.5, 11, 2.5);
// conference room right behind Michael's office (4.5 x 4 m): glass + blinds onto the bullpen, door by Phyllis + Dwight
wall(6.5, -2.5, 6.5, 2.5, { glass: true, blinds: true, gaps: [[0.4, 1.6]] });
wall(6.5, -2.5, 11, -2.5);
// the annex (back east corner): door on its west side off the bullpen + Ryan's closet in the corner
wall(6.5, -7.5, 6.5, -2.5, { gaps: [[-4.0, -2.8]] });
wall(9.6, -7.5, 9.6, -6.3); wall(9.6, -6.3, 11, -6.3, { gaps: [[9.85, 10.75]] });
// kitchen + break room (back west corner, cramped)
wall(-11, -4.5, -6, -4.5, { gaps: [[-9.9, -8.7], [-7.6, -6.4]] });
wall(-6, -7.5, -6, -4.5);
wall(-8.4, -7.5, -8.4, -4.5, { gaps: [[-6.15, -5.0]] });
// supply closet (front west corner)
wall(-11, 5.9, -9.4, 5.9); wall(-9.4, 5.9, -9.4, 7.5, { gaps: [[6.1, 7.1]] });

// structural columns in the bullpen
const COLUMNS = [[-5.9, 0.9], [1.2, -3.6]];
for (const [x, z] of COLUMNS) {
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, H, 16), M.wall);
  col.position.set(x, H / 2, z); col.castShadow = col.receiveShadow = true; scene.add(col);
  addCollider(x, z, 0.56, 0.56);
}
// floor finishes: vinyl in the kitchen / break room, rug in Michael's office, accounting carpet patch, conference carpet
{
  const k = box(5, 0.006, 3, M.vinyl, -8.5, 0.004, -6.0, scene, false); k.castShadow = false;
  const r = box(2.8, 0.008, 2.8, M.rug, 8.8, 0.005, 4.6, scene, false); r.castShadow = false;
  const a = box(4.2, 0.006, 2.2, M.carpetWarm, -3.6, 0.003, -1.0, scene, false); a.castShadow = false;
  const c = box(4.4, 0.006, 4.9, M.carpet, 8.75, 0.003, 0, scene, false); c.castShadow = false;
}

// ---------- outside view ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.ground);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
box(60, 0.02, 6, M.paving, 0, -0.01, -11, scene, false);
box(6, 0.02, 60, M.paving, 14.5, -0.01, 0, scene, false);
{
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.15, 0.2, 2, 6), std('#6b4f3a'), 40);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 0), M.leaf, 40);
  const m4 = new THREE.Matrix4(); let i = 0;
  const spots = [];
  for (let x = -40; x <= 40; x += 7) spots.push([x + (Math.random() - .5) * 3, -20 - Math.random() * 10]);
  for (let z = -30; z <= 30; z += 7) spots.push([24 + Math.random() * 10, z + (Math.random() - .5) * 3]);
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
function paperStack(x, z, rows, cols, layers) { // paper boxes (The Office-style) on a pallet
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
    { let fs = st.short.length > 3 ? 104 : 130; g.font = `800 ${fs}px system-ui,Segoe UI,Arial`; while (g.measureText(st.short).width > w - 36 && fs > 40) { fs -= 6; g.font = `800 ${fs}px system-ui,Segoe UI,Arial`; } } g.fillText(st.short, w / 2, h / 2 - 22);
    g.font = '500 30px system-ui,Segoe UI,Arial'; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(st.bot ? `${st.name} · ${st.bot}` : st.name, w / 2, h - 52);
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
  st = { ...st, desk: [st.bot, st.desk].filter(Boolean).join(' · ') };
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
const mugGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.1, 16);
// Michael's mug (HQ #37): white with WORLD'S BEST BOSS wrapped around the side
function bossMugMat() {
  const t = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 30px Arial Black,Arial'; g.fillText("WORLD'S", w * 0.75, h * 0.24); g.font = '900 44px Arial Black,Arial'; g.fillText('BEST', w * 0.75, h * 0.52); g.fillText('BOSS', w * 0.75, h * 0.82);
  });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.35 });
}
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
  const mug = new THREE.Mesh(mugGeo, st.hero ? bossMugMat() : std(st.color, 0.6)); mug.position.set(-dw / 2 + 0.22, 0.815, 0.05); g.add(mug);
  if (st.hero) { mug.scale.set(1.5, 1.4, 1.5); mug.position.y = 0.84; mug.rotation.y = Math.PI / 2; const h = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), M.white); h.position.set(-dw / 2 + 0.22, 0.84, 0.05 - 0.07); h.rotation.y = Math.PI / 2; g.add(h); }
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
  const mon = new THREE.Vector3(0, 0, mz).applyMatrix4(g.matrixWorld); st.monitor = mon;
  const yaw = Math.atan2(-(mon.x - stand.x), -(mon.z - stand.z));
  stations.push({ ...st, group: g, screen, frame, plate, bounds, stand, yaw, center: new THREE.Vector3(st.x, 1, st.z), dd, s });
}
const ST = id => STATIONS.find(s => s.id === id);

// live desk monitors: Grok = HQ chat transcript, others = current task / idle (monitors.js)
const monitors = createMonitors({ stations, onPick: p => requestPick(p) });

// ---------- props: little show-accurate touches (HQ #37), cheap boxes/cylinders so the iPad stays smooth ----------
const gold = std('#d4af37', 0.3, 0.85);
function dundie(x, y, z, ry = 0) { // the Dundie: gold figure on a black base
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
  box(0.09, 0.04, 0.09, M.bezel, 0, 0.02, 0, g, false);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.16, 8), gold); body.position.y = 0.12; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), gold); head.position.y = 0.225; g.add(head);
  box(0.12, 0.018, 0.018, gold, 0, 0.17, 0, g, false); // arms up holding the pen
  return g;
}
function framed(x, y, z, ry, w, h, draw) { // framed picture (draw = canvas painter)
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
  box(w + 0.04, h + 0.04, 0.025, M.walnut, 0, 0, 0, g, false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: canvasTex(256, Math.round(256 * h / w), draw), toneMapped: false }));
  m.position.z = 0.014; g.add(m); return g;
}
const paintBuilding = (g, w, h) => { // Pam's watercolor of the office building
  g.fillStyle = '#eef4fa'; g.fillRect(0, 0, w, h);
  const sky = g.createLinearGradient(0, 0, 0, h * 0.6); sky.addColorStop(0, '#9cc6ea'); sky.addColorStop(1, '#eef4fa'); g.fillStyle = sky; g.fillRect(0, 0, w, h * 0.6);
  g.fillStyle = '#9db28a'; g.fillRect(0, h * 0.72, w, h * 0.28);
  g.fillStyle = '#d9cdb8'; g.fillRect(w * 0.15, h * 0.3, w * 0.7, h * 0.44);
  g.fillStyle = '#7d93a8'; for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) g.fillRect(w * (0.19 + c * 0.11), h * (0.36 + r * 0.17), w * 0.07, h * 0.1);
  g.fillStyle = '#6a8c4e'; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(w * (0.08 + i * 0.22), h * 0.72, 18 + (i % 2) * 8, 0, 7); g.fill(); }
  g.fillStyle = 'rgba(40,40,40,.6)'; g.font = 'italic 14px Georgia'; g.fillText('P.B.', w - 40, h - 10);
};

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
  box(0.22, 0.06, 0.18, M.bezel, rx - 0.75, 0.8, rz - 0.25, scene, false);
  // HQ #42: the show's RECEPTION / PLEASE SIGN IN plaque on the counter front, facing the door (Icon Shop art)
  pngSign('reception', rx, 0.62, rz + 0.075, 0, 1.5);
  // Pam's easel with her watercolor of the building, in the front-west corner by the sales table
  {
    const ex = -9.2, ez = 1.0, g = new THREE.Group(); g.position.set(ex, 0, ez); g.rotation.y = 0.9; scene.add(g);
    for (const dx of [-0.3, 0.3]) { const l = box(0.04, 1.7, 0.04, M.oak, dx, 0.85, 0, g, false); l.rotation.z = dx > 0 ? -0.08 : 0.08; }
    const back = box(0.04, 1.6, 0.04, M.oak, 0, 0.8, -0.35, g, false); back.rotation.x = -0.22;
    box(0.72, 0.04, 0.08, M.oak, 0, 0.9, 0.03, g, false);
    const art = framed(0, 1.3, 0.06, 0, 0.66, 0.5, paintBuilding); scene.remove(art); g.add(art); art.position.set(0, 1.27, 0.07); art.rotation.x = -0.08;
    addCollider(ex, ez, 0.7, 0.55);
  }
  // copier right by the door (the copy machine everyone stands around)
  moved(-1.7, 1.5, () => {
    box(0.75, 0.95, 0.9, M.copier, -3.1, 0.475, 5.45); box(0.8, 0.12, 0.95, M.copierDark, -3.1, 1.01, 5.45);
    box(0.5, 0.04, 0.6, M.white, -3.1, 1.09, 5.45, scene, false); box(0.3, 0.12, 0.04, M.bezel, -3.0, 1.03, 5.0, scene, false);
    addCollider(-3.1, 5.45, 0.8, 0.95);
  });
  paperStack(-1.6, 7.16, 1, 1, 3); // reams for the copier
  // two waiting chairs against the front wall
  chair(scene, -6.6, 7.05, 0); chair(scene, -6.0, 7.05, 0); addCollider(-6.3, 7.05, 1.2, 0.6);
  // coat rack + plant by the door
  { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 8), M.walnut); c.position.set(1.4, 0.9, 7.15); scene.add(c);
    box(0.4, 0.03, 0.4, M.walnut, 1.4, 0.02, 7.15, scene, false); box(0.34, 0.5, 0.12, std('#3b3f46', 0.9), 1.4, 1.5, 7.22, scene, false); addCollider(1.4, 7.15, 0.4, 0.4); }
  plant(2.1, 7.16, 0.9);
  // company plaque on the front wall (you see it when you turn around from Pam) + a second one hung over reception
  pngSign('dunder-mifflin', 3.0, 1.95, Z1 - 0.115, Math.PI, 2.3);
  hangPlate((x, y, z, ry) => pngSign('dunder-mifflin', x, y, z, ry, 1.6), p.x, 2.66, p.z - 0.7, 0, 1.6);
  // the warehouse is downstairs: stairs / elevator plate by the door
  plate('WAREHOUSE', -1.45, 2.05, Z1 - 0.115, Math.PI, { w: 0.62, sub: '↓ STAIRS · ELEVATOR' });
  // Pam's framed watercolor on the reception counter + her teapot from Jim
  framed(rx - 1.43, 1.26, rz - 0.75, Math.PI / 2, 0.22, 0.17, paintBuilding);
  { const tp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), std('#f4f1ea', 0.4)); tp.scale.y = 0.8; tp.position.set(rx + 1.43, 1.22, rz - 0.4); scene.add(tp); }
}

// ---------- Michael Scott's office (Grok Bot) ----------
// HQ #43: built in the old 18x12 coordinates and slid over: +2 m east, +1.5 m south (door plates + shared-wall stuff placed by hand)
plate('MICHAEL SCOTT', 6.42, 2.7, 6.0, -Math.PI / 2, { w: 0.9, sub: 'REGIONAL MANAGER' });
plate('MICHAEL SCOTT', 6.43, 1.55, 5.2, -Math.PI / 2, { w: 0.34, sub: 'REGIONAL MANAGER' }); // small eye-level plate on the frame
plate('MICHAEL SCOTT', 6.58, 2.7, 6.0, Math.PI / 2, { w: 0.9, sub: 'REGIONAL MANAGER' });
// HQ #43: Michael's couch moved to the south wall (back to the parking-lot side) so there's a walkway all the way round his desk
box(1.2, 0.42, 0.7, M.sofa, 7.38, 0.21, 6.95); box(1.2, 0.5, 0.2, M.sofa, 7.38, 0.67, 7.23);
box(0.18, 0.58, 0.7, M.sofa, 6.83, 0.29, 6.95); box(0.18, 0.58, 0.7, M.sofa, 7.93, 0.29, 6.95);
addCollider(7.38, 6.92, 1.26, 0.82);
moved(2, 0.5, () => {
  framed(6.9, 1.8, 2.08, 0, 0.5, 0.36, (g, w, h) => { g.fillStyle = '#fbf6e6'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b8860b'; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = '#333'; g.textAlign = 'center'; g.font = 'bold 20px Georgia'; g.fillText('CERTIFICATE', w / 2, 50); g.font = 'italic 15px Georgia'; g.fillText('Michael Scott', w / 2, 90); g.fillText('Regional Manager', w / 2, 115); g.font = '12px Georgia'; g.fillText('of the Year', w / 2, 140); });
  framed(7.6, 1.8, 2.08, 0, 0.5, 0.36, (g, w, h) => { g.fillStyle = '#e8f0f8'; g.fillRect(0, 0, w, h); g.fillStyle = '#2c4f7a'; g.textAlign = 'center'; g.font = 'bold 22px Georgia'; g.fillText('Michael Scott', w / 2, 70); g.fillText('Paper Company', w / 2, 100); g.font = '14px Georgia'; g.fillStyle = '#555'; g.fillText('est. in a closet', w / 2, 140); });
  framed(8.4, 1.8, 2.08, 0, 0.5, 0.5, (g, w, h) => { g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, w, h); g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 40px Arial Black,Arial'; g.fillText("WORLD'S", w / 2, h * 0.28); g.font = '900 58px Arial Black,Arial'; g.fillText('BEST', w / 2, h * 0.52); g.fillText('BOSS', w / 2, h * 0.76); });
});
moved(2, 1.5, () => {
  // guest chairs facing the desk (couch is along the shared wall, above)
  chair(scene, 5.05, 2.7, -Math.PI / 2 + 0.15); chair(scene, 5.05, 3.5, -Math.PI / 2 - 0.15);
  // Dundies shelf on the south wall
  {
    const sx = 8.1, sz = 5.7;
    box(1.4, 1.9, 0.04, M.walnut, sx, 0.95, sz + 0.17); for (const dx of [-0.68, 0.68]) box(0.04, 1.9, 0.38, M.walnut, sx + dx, 0.95, sz);
    box(1.4, 0.04, 0.38, M.walnut, sx, 1.9, sz); box(1.4, 0.12, 0.38, M.walnut, sx, 0.06, sz);
    for (const y of [0.5, 0.98, 1.46]) box(1.32, 0.03, 0.34, M.oak, sx, y, sz, scene, false);
    addCollider(sx, sz, 1.4, 0.4);
    for (let i = 0; i < 5; i++) dundie(sx - 0.56 + i * 0.28, 1.475, sz - 0.05, Math.PI);
    for (let i = 0; i < 4; i++) dundie(sx - 0.48 + i * 0.32, 0.995, sz - 0.05, Math.PI);
    for (let i = 0; i < 7; i++) box(0.05, 0.3, 0.24, std(['#7a2f2f', '#2c4f7a', '#3d6b3d', '#a0782f'][i % 4], 0.8), sx - 0.6 + i * 0.07, 0.68, sz - 0.04, scene, false);
    sign('THE DUNDIES', sx, 2.12, sz - 0.2, Math.PI, { w: 1.1, h: 0.22, bg: '#111', fg: '#d4af37', font: 'Georgia,serif' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), std('#f6f2e4', 0.6)); ball.position.set(sx + 0.4, 0.57, sz - 0.08); scene.add(ball);
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.004, 4, 20), std('#c62828', 0.6)); seam.position.copy(ball.position); seam.rotation.set(0.6, 0.3, 0); scene.add(seam);
    const bat = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.018, 0.85, 10), std('#c8a26a', 0.5)); bat.position.set(sx + 0.8, 0.42, sz - 0.12); bat.rotation.z = -0.18; scene.add(bat);
  }
  { const pt = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 6), M.steel); pt.position.set(4.75, 0.45, 5.75); pt.rotation.z = 0.15; scene.add(pt); }
});

// ---------- conference room (behind Michael's office, glass onto the bullpen) ----------
{
  const tx = 8.9, tz = 0;
  box(2.6, 0.06, 1.1, M.walnut, tx, 0.75, tz);
  box(0.4, 0.72, 0.4, M.steel, tx - 0.85, 0.36, tz); box(0.4, 0.72, 0.4, M.steel, tx + 0.85, 0.36, tz);
  addCollider(tx, tz, 2.6, 1.1);
  for (let i = 0; i < 3; i++) { const x = tx - 0.8 + i * 0.8; chair(scene, x, tz - 0.85, Math.PI + (i % 2 ? 0.12 : -0.1)); chair(scene, x, tz + 0.85, i % 2 ? -0.1 : 0.12); }
  chair(scene, tx - 1.6, tz, -Math.PI / 2); chair(scene, tx + 1.6, tz, Math.PI / 2);
  box(0.3, 0.04, 0.26, M.bezel, tx, 0.8, tz, scene, false);
  { const pit = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.24, 12), M.glassJar); pit.position.set(tx + 0.7, 0.9, tz + 0.15); scene.add(pit);
    for (const dx of [0.9, 1.02]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.1, 10), M.white); c.position.set(tx + dx, 0.83, tz + 0.2); scene.add(c); } }
  for (let i = 0; i < 3; i++) box(0.21, 0.01, 0.29, std('#f5e97a', 0.9), tx - 0.8 + i * 0.8, 0.785, tz + (i % 2 ? -0.35 : 0.35), scene, false);
  // wall TV on the north wall
  box(1.6, 0.92, 0.08, M.bezel, tx, 1.65, -2.38);
  // HQ #48: live team board (open tasks, owner, stage, %) from the same feeds as the desk screens (monitors.js)
  const brief = monitors.board({ x: tx, z: -2.38 });
  const bs = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.86), new THREE.MeshBasicMaterial({ map: brief, toneMapped: false }));
  bs.position.set(tx, 1.65, -2.335); scene.add(bs); monitors.boardMesh = bs; // HQ #52: tappable pick cards on the TV
  // HQ #42: CONFERENCE ROOM door plate beside the door (Icon Shop art) + a matching one over the door
  pngSign('conference', 6.42, 1.6, 0.05, -Math.PI / 2, 0.42);
  plate('CONFERENCE ROOM', 6.42, 2.7, 1.0, -Math.PI / 2, { w: 0.95 });
  plant(10.6, -2.1, 0.9);
}
// full-wall hand-drawn whiteboard on the conference room's south wall (shared with Michael's office) = live widget screen
// (HQ #21, #25): clock, weather, markets, team status + bank. HQ #42: 4.0 x 0.895 m (same 4.47:1 aspect as the canvas)
const whiteboard = createWhiteboard({ scene, x0: 6.75, x1: 10.75, y0: 0.95, y1: 0.95 + 4.0 / 4.47, z: 2.36, std, box });

// ---------- bullpen extras ----------
cabinets(-6.6, -1.4, 2, Math.PI / 2);   // accounting files
cabinets(-10.6, 3.2, 3, Math.PI / 2);    // front-west files
hangPlate((x, y, z, ry) => plate('ACCOUNTING', x, y, z, ry, { w: 1.0 }), -3.6, 2.45, -1.0, 0, 1.0);
hangPlate((x, y, z, ry) => pngSign('sales', x, y, z, ry, 0.7), 4.2, 2.4, 1.6, 0, 0.7);
// desk touches from the show
{
  const d = ST('assist'), j = ST('cos'), k = ST('conn'), an = ST('faith'), sn = ST('builder'), ph = ST('onpad'), kl = ST('designer'), mr = ST('kids'), cr = ST('review');
  // Dwight: bobblehead, beets, gym bag
  const bob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), std('#f1c9a5', 0.6)); bob.position.set(d.x - 0.55, 0.92, d.z - 0.1); scene.add(bob);
  box(0.06, 0.1, 0.06, std('#5a3a22', 0.7), d.x - 0.55, 0.82, d.z - 0.1, scene, false);
  box(0.3, 0.1, 0.2, M.pallet, d.x + 0.42, 0.82, d.z - 0.12, scene, false);
  for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), std('#7b1e3a', 0.6)); b.position.set(d.x + 0.32 + (i % 3) * 0.08, 0.9, d.z - 0.16 + (i > 2 ? 0.08 : 0)); scene.add(b);
    box(0.01, 0.07, 0.02, std('#4f7d4a', 0.8), b.position.x, 0.96, b.position.z, scene, false); }
  box(0.6, 0.3, 0.3, std('#1d2b4f', 0.9), d.x - 1.15, 0.15, d.z - 0.55); addCollider(d.x - 1.15, d.z - 0.55, 0.6, 0.3);
  // Jim: stapler in jello + the documentary camera on a tripod, wedged by Michael's glass, pointed at him
  const jello = new THREE.Mesh(boxGeo(0.22, 0.09, 0.12), new THREE.MeshPhysicalMaterial({ color: '#f2d33a', transparent: true, opacity: 0.75, roughness: 0.2 }));
  jello.position.set(j.x + 0.55, 0.81, j.z + 0.1); scene.add(jello);
  box(0.16, 0.035, 0.04, M.steel, j.x + 0.55, 0.81, j.z + 0.1, scene, false);
  {
    const cx = 6.28, cz = 3.0, g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = Math.atan2(j.x - cx, j.z + 0.8 - cz) + Math.PI; scene.add(g);
    for (let i = 0; i < 3; i++) { const a = i * 2.09, l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 6), M.steel); l.position.set(Math.sin(a) * 0.18, 0.7, Math.cos(a) * 0.18); l.rotation.set(Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25); g.add(l); }
    box(0.16, 0.2, 0.42, std('#222', 0.5, 0.3), 0, 1.5, 0, g);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 12), std('#111', 0.3, 0.5)); lens.rotation.x = Math.PI / 2; lens.position.set(0, 1.5, -0.28); g.add(lens);
    box(0.03, 0.03, 0.03, new THREE.MeshBasicMaterial({ color: '#ff2a2a' }), 0.05, 1.62, -0.18, g, false);
    box(0.08, 0.06, 0.12, M.bezel, -0.1, 1.62, 0.05, g, false);
    addCollider(cx, cz, 0.44, 0.44);
  }
  // Kevin: M&M jar. Angela: cat photo. Stanley: crossword. Phyllis: yarn. Kelly: magazines. Meredith: thermos. Creed: mung bean sprouts
  { const jr = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 12), M.glassJar); jr.position.set(k.x + 0.5, 0.88, k.z - 0.1); scene.add(jr);
    const mm = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8d5524', '#fb8c00'];
    for (let i = 0; i < 12; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), std(mm[i % 6], 0.4)); c.position.set(k.x + 0.5 + Math.cos(i * 2.4) * 0.045, 0.8 + (i / 12) * 0.1, k.z - 0.1 + Math.sin(i * 2.4) * 0.045); scene.add(c); } }
  framed(an.x + 0.5, 0.84, an.z - 0.25, 0.25, 0.16, 0.12, (g, w, h) => { g.fillStyle = '#f1e6d6'; g.fillRect(0, 0, w, h); g.fillStyle = '#888'; g.beginPath(); g.ellipse(w / 2, h * 0.62, 60, 45, 0, 0, 7); g.fill(); g.beginPath(); g.arc(w / 2, h * 0.32, 38, 0, 7); g.fill();
    g.beginPath(); g.moveTo(w / 2 - 34, h * 0.24); g.lineTo(w / 2 - 22, h * 0.02); g.lineTo(w / 2 - 6, h * 0.2); g.moveTo(w / 2 + 34, h * 0.24); g.lineTo(w / 2 + 22, h * 0.02); g.lineTo(w / 2 + 6, h * 0.2); g.fill(); });
  box(0.3, 0.008, 0.22, std('#f2efe6', 0.9), sn.x - 0.45, 0.772, sn.z - 0.1, scene, false);
  sign('CROSSWORD', sn.x - 0.45, 0.778, sn.z - 0.1, 0, { w: 0.26, h: 0.06, bg: '', fg: '#222' }).rotation.x = -Math.PI / 2;
  { const y = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), std('#ec407a', 0.9)); y.position.set(ph.x + 0.5, 0.83, ph.z + 0.12); scene.add(y);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), M.steel); n.rotation.z = 1.1; n.position.copy(y.position); scene.add(n); }
  box(0.22, 0.03, 0.3, std('#ff4fa3', 0.6), kl.x + 0.48, 0.79, kl.z + 0.1, scene, false); box(0.22, 0.02, 0.3, std('#ffd1e8', 0.6), kl.x + 0.5, 0.81, kl.z + 0.08, scene, false);
  { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.24, 10), std('#7d8b99', 0.4, 0.6)); t.position.set(mr.x - 0.5, 0.89, mr.z); scene.add(t); }
  { box(0.2, 0.04, 0.14, M.pallet, cr.x + 0.5, 0.79, cr.z + 0.1, scene, false); for (let i = 0; i < 6; i++) box(0.01, 0.06, 0.01, M.leaf2, cr.x + 0.43 + i * 0.03, 0.83, cr.z + 0.1, scene, false); }
  // Toby: his sad little plant + a trombone (for the sad trombone) on top of the annex files
  plant(10.72, -2.92, 0.7);
  cabinets(6.95, -6.8, 2, Math.PI / 2);
  {
    const brass = std('#d9a33a', 0.25, 0.9), g = new THREE.Group(); g.position.set(6.95, 1.36, -6.8); g.rotation.y = 0.2; scene.add(g);
    for (const dx of [-0.04, 0.04]) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.75, 6), brass); t.rotation.x = Math.PI / 2; t.position.set(dx, 0.01, 0); g.add(t); }
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.012, 0.22, 14, 1, true), brass); bell.rotation.x = -Math.PI / 2; bell.position.set(0.04, 0.02, -0.46); g.add(bell);
    box(0.1, 0.012, 0.012, brass, 0, 0.01, 0.37, g, false);
  }
}
// printer / fax station on the front-west floor + a bulletin board on the annex wall
{
  const px = -7.8, pz = 2.4;
  box(1.4, 0.05, 0.7, M.oak, px, 0.74, pz); box(1.3, 0.7, 0.6, M.cabinet, px, 0.36, pz); addCollider(px, pz, 1.4, 0.7);
  box(0.6, 0.32, 0.5, M.copier, px - 0.3, 0.93, pz); box(0.5, 0.03, 0.3, M.white, px - 0.3, 1.1, pz, scene, false); box(0.4, 0.15, 0.35, M.copierDark, px + 0.45, 0.84, pz);
  framed(6.58, 1.65, -5.75, Math.PI / 2, 0.9, 0.6, (g, w, h) => { g.fillStyle = '#b98b5a'; g.fillRect(0, 0, w, h);
    const notes = [['#fff', 'SAFETY FIRST'], ['#fff59d', 'Party Planning Cmte'], ['#c5e1a5', 'DM softball'], ['#ffccbc', 'Lost: stapler'], ['#b3e5fc', 'Fun Run: Rabies']];
    notes.forEach(([c, t], i) => { const x = 14 + (i % 3) * 80, y = 14 + Math.floor(i / 3) * 80; g.fillStyle = c; g.fillRect(x, y, 72, 68); g.fillStyle = '#d32f2f'; g.beginPath(); g.arc(x + 36, y + 6, 4, 0, 7); g.fill();
      g.fillStyle = '#222'; g.font = '600 11px Arial'; g.textAlign = 'center'; t.split(' ').reduce((a, wd) => { const l = a[a.length - 1]; if ((l + ' ' + wd).length > 10) a.push(wd); else a[a.length - 1] = (l + ' ' + wd).trim(); return a; }, ['']).forEach((ln, k) => g.fillText(ln, x + 36, y + 26 + k * 13)); }); });
}
// the annex: plate over the door + Ryan's closet desk
plate('THE ANNEX', 6.42, 2.7, -3.4, -Math.PI / 2, { w: 0.85 });
plate('THE ANNEX', 6.58, 2.7, -3.4, Math.PI / 2, { w: 0.85, sub: 'CUSTOMER SERVICE · HR' });
moved(2, -1.5, () => {
  plate("RYAN HOWARD", 8.3, 2.1, -4.72, 0, { w: 0.5, sub: 'TEMP' });
  box(0.9, 0.05, 0.5, M.oak, 8.3, 0.74, -5.65); box(0.85, 0.7, 0.05, M.steel, 8.3, 0.36, -5.87); addCollider(8.3, -5.65, 0.9, 0.5);
  chair(scene, 8.3, -5.15, 0);
});
// supply closet (front west corner): shelves of paper + supplies
moved(-2, 1.5, () => {
  plate('SUPPLY CLOSET', -7.32, 2.7, 5.1, Math.PI / 2, { w: 0.85 });
  box(0.45, 1.9, 1.4, M.cabinet, -8.7, 0.95, 5.2); addCollider(-8.7, 5.2, 0.45, 1.4);
  for (let i = 0; i < 3; i++) box(0.3, 0.27, 0.44, M.paperBox, -8.7, 2.035, 4.7 + i * 0.48, scene, false);
});
// front-west floor: sales meeting table + paper sample shelf
roundTable(-8.4, 4.2, 3);
moved(-1.6, 1.5, () => { box(1.6, 1.6, 0.4, M.walnut, -6.2, 0.8, 5.7); addCollider(-6.2, 5.7, 1.6, 0.4);
  for (const y of [0.55, 1.1]) for (let i = 0; i < 3; i++) box(0.44, 0.27, 0.3, M.paperBox, -6.72 + i * 0.52, y + 0.15, 5.62, scene, false);
  plate('PAPER SAMPLES', -6.2, 1.95, 5.48, Math.PI, { w: 0.9 }); });
// party planning committee hint in the bullpen: balloons tied to Phyllis's chair + streamers on the column
{
  const ph = ST('onpad'), bal = ['#e53935', '#fdd835', '#1e88e5'];
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), std(bal[i], 0.35)); b.scale.y = 1.18; b.position.set(ph.x - 0.7 + i * 0.18, 1.75 + i * 0.12, ph.z + 0.9); scene.add(b);
    box(0.004, 0.9 + i * 0.12, 0.004, M.white, ph.x - 0.7 + i * 0.18, 1.2, ph.z + 0.9, scene, false); }
  for (let i = 0; i < 6; i++) { const st = box(0.03, 0.9, 0.006, std(['#ec407a', '#fdd835', '#42a5f5'][i % 3], 0.6), COLUMNS[1][0] + Math.cos(i) * 0.27, 2.5, COLUMNS[1][1] + Math.sin(i) * 0.27, scene, false); st.rotation.y = i; }
}

// ---------- kitchen + break room (back west corner, cramped like the show) ----------
// HQ #43: same build, slid 2 m west + 1.5 m north into the bigger shell
moved(-2, -1.5, () => {
  const cab = M.cabinetWhite, seam = std('#9a948b', 0.8), handle = std('#b8bcc2', 0.3, 0.8);
  const kx = -8.55, kz = -5.0; // counter run along the west wall
  box(0.65, 0.86, 1.8, cab, kx, 0.45, kz); box(0.7, 0.04, 1.85, M.walnut, kx, 0.9, kz);
  for (let i = 0; i < 3; i++) { const z = kz - 0.9 + 0.3 + i * 0.6; box(0.02, 0.14, 0.025, handle, kx + 0.345, 0.72, z, scene, false); }
  box(0.42, 0.02, 0.5, std('#c9ccd0', 0.25, 0.8), kx + 0.02, 0.925, kz + 0.45, scene, false);                        // sink
  box(0.04, 0.3, 0.04, handle, kx - 0.22, 1.07, kz + 0.45, scene, false); box(0.18, 0.04, 0.04, handle, kx - 0.14, 1.21, kz + 0.45, scene, false);
  box(0.32, 0.42, 0.3, std('#1d1d1f', 0.4, 0.3), kx - 0.05, 1.13, kz - 0.25);                                        // coffee maker
  box(0.4, 0.3, 0.5, M.white, kx - 0.02, 1.07, kz - 0.65); box(0.02, 0.2, 0.3, M.bezel, kx + 0.19, 1.07, kz - 0.7, scene, false); // microwave
  box(0.4, 0.7, 1.8, cab, -8.7, 2.05, kz);                                                                           // upper cabinets
  for (let i = 1; i < 3; i++) box(0.012, 0.66, 0.012, seam, -8.49, 2.05, kz - 0.9 + i * 0.6, scene, false);
  const ss = std('#c3c7cc', 0.35, 0.7); box(0.75, 1.9, 0.75, ss, -8.55, 0.95, -3.55);                                // fridge
  box(0.04, 0.9, 0.04, std('#6b6f75', 0.3, 0.8), -8.16, 1.15, -3.35, scene, false);
  addCollider(-8.55, -4.53, 0.75, 2.95);
  plate('KITCHEN', -7.3, 2.7, -2.92, 0, { w: 0.7 });
  // break room: snack + soda machines on the east wall, little table
  for (const [z, c, label] of [[-5.4, '#25303f', 'SNACKS'], [-4.35, '#b8242b', 'SODA']]) {
    box(0.85, 1.85, 1.0, std(c, 0.5, 0.2), -4.5, 0.925, z);
    box(0.02, 1.2, 0.62, M.vendGlass, -4.935, 1.1, z - 0.1, scene, false);
    sign(label, -4.94, 1.75, z + 0.38, -Math.PI / 2, { w: 0.3, h: 0.12, bg: '#111', fg: '#ffd27a' });
  }
  addCollider(-4.5, -4.88, 0.9, 2.1);
  { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.05, 18), M.oak); t.position.set(-5.75, 0.74, -5.3); t.castShadow = t.receiveShadow = true; scene.add(t);
    box(0.07, 0.72, 0.07, M.steel, -5.75, 0.36, -5.3); chair(scene, -5.75, -4.72, 0.1); chair(scene, -6.05, -5.65, Math.PI * 0.75); addCollider(-5.75, -5.3, 0.85, 0.85); }
  plate('BREAK ROOM', -4.95, 2.7, -2.92, 0, { w: 0.8 });
  // fridge magnets + the passive-aggressive kitchen note
  const mag = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00', '#00acc1'];
  for (let i = 0; i < 11; i++) box(0.012, 0.045 + (i % 3) * 0.015, 0.05 + (i % 2) * 0.03, std(mag[i % mag.length], 0.5), -8.17, 1.0 + ((i * 37) % 70) / 100, -3.85 + ((i * 53) % 55) / 100, scene, false);
  sign('PLEASE CLEAN UP AFTER YOURSELF', -8.165, 1.55, -3.7, Math.PI / 2, { w: 0.36, h: 0.26, bg: '#fff8c4', fg: '#333', weight: 600, font: 'Comic Sans MS,Chalkboard,cursive' });
  // party planning committee leftovers: IT IS YOUR BIRTHDAY. banner inside the break room + balloons
  sign('IT IS YOUR BIRTHDAY.', -5.2, 2.6, -3.09, Math.PI, { w: 1.9, h: 0.32, bg: '#ffffff', fg: '#1b1b1b', font: 'Arial,Helvetica', weight: 700 });
  const bal = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#ec407a'];
  for (let i = 0; i < 5; i++) {
    const bx = -5.75 + Math.cos(i * 1.3) * 0.22, bz = -5.3 + Math.sin(i * 1.3) * 0.22, by = 1.55 + (i % 3) * 0.18;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), std(bal[i], 0.35)); b.scale.y = 1.18; b.position.set(bx, by, bz); scene.add(b);
    box(0.004, by - 0.8, 0.004, M.white, (bx - 5.75) / 2, (by + 0.78) / 2, (bz - 5.3) / 2, scene, false);
  }
});

// ---------- emergency exit (west wall) ----------
// The warehouse is downstairs off the elevator lobby (plate by the front door), so this west door is the set's Emerg. Exit.
{
  box(0.08, 2.25, 1.2, M.whDoor, X0 + 0.12, 1.125, 0.4, scene, false);
  box(0.1, 2.35, 0.08, M.walnut, X0 + 0.12, 1.175, -0.24, scene, false); box(0.1, 2.35, 0.08, M.walnut, X0 + 0.12, 1.175, 1.04, scene, false);
  box(0.06, 0.06, 0.75, M.steel, X0 + 0.2, 1.05, 0.4, scene, false);
  sign('EXIT', X0 + 0.13, 2.55, 0.4, Math.PI / 2, { w: 0.5, h: 0.2, bg: '#b71c1c', fg: '#ffffff' });
  sign('EMERGENCY EXIT ONLY · ALARM WILL SOUND', X0 + 0.17, 1.55, 0.4, Math.PI / 2, { w: 0.5, h: 0.2, bg: '#fff', fg: '#b71c1c', weight: 700 });
}

// water cooler on the west wall in the bullpen, outside the kitchen (workers stop here when idle; the only place they drink)
// classic office cooler: white cabinet, big blue jug upside-down on top, blue/red taps, drip tray, paper-cup tube + bin
const COOLER = { x: -10.45, z: -1.8 };
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
for (const [x, z, s] of [[-5.6, -7.1, 0.9], [6.15, -7.1, 0.9], [-10.6, 5.3, 0.9]]) plant(x, z, s);

// idle hangout spots for workers: [x, z, facing yaw, activity]. yaw 0 = facing north, PI/2 = west, -PI/2 = east, PI = south.
// Drinks happen ONLY at the water cooler (HQ #20): no kitchen / sink stops.
const PI = Math.PI;
const IDLE_SPOTS = [ // HQ #43: re-placed for the 22 x 15 m floor
  [-2.6, -7.0, 0, 'window'], [3.4, -7.0, 0, 'window'], [-1.8, -7.0, 0.1, 'window'],
  [7.6, -4.2, PI, 'phone'],                                                        // annex
  [-9.4, -6.1, PI / 2, 'think'],                                                    // kitchen (staring into the fridge)
  [-7.5, -5.3, -PI / 2, 'think'],                                                   // break room (staring at the vending machine)
  [8.0, 1.8, PI, 'think'], [10.4, 1.8, PI, 'think'], [8.0, -1.75, PI, 'phone'],   // conference room (whiteboard, table)
  [1.2, 6.3, 0.6, 'chat'], [-4.8, 6.1, PI, 'think'],                              // reception: chatting with Pam, copier
  [7.2, 3.0, -PI / 2, 'think'], [9.8, 6.3, PI, 'phone'],                           // Michael's office
  [1.6, 1.4, 2.2, 'phone'], [-0.4, -4.0, 1.6, 'think'], [2.8, -3.6, -2.2, 'phone'], [0.6, 2.6, 0, 'think'], [-7.4, -0.6, 0.4, 'think'],
  [-10.0, 6.5, PI / 2, 'think'], [-7.4, 5.3, 0, 'phone'], [-7.8, 1.6, 0, 'think'],  // supply closet, front-west floor, printer
  // water cooler on the west wall: stand in front, face the cooler
  [COOLER.x + 0.85, COOLER.z, PI / 2, 'water'], [COOLER.x + 0.85, COOLER.z + 1.0, Math.atan2(0.85, 1.0), 'water'],
  [COOLER.x + 0.85, COOLER.z - 0.6, Math.atan2(0.85, -0.6), 'water'], [COOLER.x + 1.75, COOLER.z, PI / 2, 'water'],
];

// (created after every prop so their nav grid knows about walls, desks, kitchen, cooler, rooms)
// worker characters (one per bot): wander when idle, sit + type at their desk when busy (tasks.json)
const workers = createWorkers({ scene, stations, colliders, pois: IDLE_SPOTS, onStatus: (s, busy, task, meta = {}) => {
  const st = stations.find(x => x.id === s.id); if (!st) return;
  st.busy = busy; st.task = task; monitors.setStatus(st.id, busy, task, meta.since, meta.until, { stage: meta.stage, pct: meta.pct, waiting: meta.waiting });
  if (panelOpen === st) showPanel(st);
} });


// ---------- player ----------
const player = { pos: new THREE.Vector3(0, 0, 6.9), yaw: 0, pitch: 0, radius: 0.3, travel: null };
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
  if (!paused && document.pointerLockElement && hoverKind) return act(hoverKind); // reticle on a REFRESH button / pick card
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
  if (s) { s.frame.visible = true; s.plate.scale.copy(s.plate.userData.baseScale).multiplyScalar(1.15); ui.focus.textContent = `${s.name}${s.bot ? ' (' + s.bot + ')' : ''}  ·  A / E to view screen`; }
}
let lastDesk = null;
function interact() {
  if (paused) return;
  if (!panelOpen && hoverKind) return act(hoverKind); // reticle on a REFRESH button / pick card: A / E presses it
  if (panelOpen) return closePanel();
  if (!focused) return;
  panelOpen = focused; lastDesk = focused;
  showPanel(focused);
}
const escH = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showPanel(s) {
  const status = s.busy ? `<b style="color:#ffb74d">● Working at desk</b>${s.task ? ': ' + escH(s.task) : ''}`
    : `<b style="color:#7CFC9A">● Idle</b>: out on the floor, ready for a task`;
  ui.panel.innerHTML = `<h2><span class="sw" style="background:${s.color}"></span>${s.name}${s.bot ? ` <span style="opacity:.7;font-weight:500">· ${s.bot}</span>` : ''}</h2>
    <p>${s.role}</p><p>${status}</p>
    <div class="screenwrap"></div>
    ${REFRESH_KIND[s.id] ? `<button class="refreshbtn" type="button">⟳ REFRESH ${s.id === 'inbox' ? 'INBOX' : s.short} <span>(tap or X)</span></button>` : ''}
    ${s.id === 'profile' ? (n => `<p class="pickhint"><b style="color:${n ? '#ffca28' : '#7CFC9A'}">${n ? `⏳ ${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} you` : '✓ Nothing needs you right now'}</b>. This screen lists anything waiting on you, live.</p>`)(monitors.needs().open.length) : ''}
    ${monitors.hasPick(s.id) ? `<p class="pickhint"><b style="color:#ffca28">⏳ Waiting on you:</b> tap the badges you like on the screen (or D-pad ←/→ + X), then <b>SUBMIT PICKS</b>. ${s.name.split(' ')[0]} gets them right away.</p>` : ''}
    <small>Hold View (or Enter) to message ${s.bot || 'this bot'} via Grok Bot + team. B / Q / A to close.</small>`;
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
  const to = freeStand(s);
  player.travel = { from: player.pos.clone(), to, yaw0: player.yaw, yaw1: Math.atan2(-(s.monitor.x - to.x), -(s.monitor.z - to.z)), t: 0 };
}
// HQ #38: desks are packed like the show, so the usual over-the-shoulder spot can land inside a neighbour's desk.
// Walk the candidates (behind the chair, then closer, then to either side) and take the first one that's clear.
function freeStand(s) {
  for (const back of [1.7, 1.4, 1.15, 0.95]) for (const side of [0.6, -0.6, 0, 1.1, -1.1]) {
    const v = new THREE.Vector3(side * s.s, 0, s.dd / 2 + back).applyMatrix4(s.group.matrixWorld);
    const e = 0.12; // a little clearance so the spot isn't wedged against a desk edge
    if (!blocked(v.x, v.z) && !blocked(v.x + e, v.z) && !blocked(v.x - e, v.z) && !blocked(v.x, v.z + e) && !blocked(v.x, v.z - e)) return new THREE.Vector3(v.x, 0, v.z);
  }
  return new THREE.Vector3(s.stand.x, 0, s.stand.z);
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
  const area = room ? room.name : Math.hypot(x - COOLER.x, z - COOLER.z) < 3 ? 'by the water cooler' : Math.hypot(x - X0, z - 0.4) < 2.2 ? 'by the emergency exit'
    : z > 2.6 ? (x > 2.6 ? 'by Jim + Dwight (outside Michael\'s office)' : 'reception (Pam\'s desk)') : x > -5.6 && x < -1.6 && z > -3.0 && z < 0.4 ? 'accounting' : z < -4.8 ? 'back of the bullpen (window side)' : 'the bullpen';
  return { x, z, heading, facing, area, near: near && near.d < 4 ? near : null };
}
function stampWhere(g, w, h) {
  const p = whereAmI(), k = Math.max(0.6, w / 1280);
  const line1 = `📍 Chris at x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)} · facing ${p.facing} (${Math.round(p.heading)}°)`;
  const line2 = `${p.area}${p.near ? ` · near ${p.near.s.name}${p.near.s.bot ? ` (${p.near.s.bot})` : ''}${p.near.s.desk ? ` · ${p.near.s.desk}` : `'s desk`} (${p.near.d.toFixed(1)} m)` : ''} · north = window wall`;
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
  g.fillStyle = '#d32f2f'; g.fillRect(mx, my + (-0.2 - Z0) * sz, 3 * k, 1.2 * sz);                   // emergency exit
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
  for (const s of stations) if (!s.hero && monitors.hasPick(s.id)) targets.push(s.screen); // HQ #50 pick cards
  if (monitors.boardMesh && monitors.boardHasPick()) targets.push(monitors.boardMesh);          // HQ #52 same cards on the Team Board TV
  raycaster.far = 10;
  const h = raycaster.intersectObjects(targets, false)[0]; if (!h) return null;
  if (h.object === whiteboard.surface) return whiteboard.hitTest(h.uv);
  if (h.object === monitors.boardMesh) { const b = h.distance < 8 && monitors.boardPickHit(h.uv); return b ? `bpick:${b.id}:${b.key}` : null; }
  if (h.distance >= 5) return null;
  if (inboxSt && h.object === inboxSt.screen) return monitors.hitTest('inbox', h.uv);
  const ps = stations.find(s => s.screen === h.object); const k = ps && monitors.pickHit(ps.id, h.uv);
  return k ? `pick:${ps.id}:${k}` : null;
}
// one place for "press this on-screen control": REFRESH kinds or HQ #50 pick cards ('pick:<bot>:<H|submit>')
function act(kind) {
  if (!kind) return;
  if (!/^b?pick:/.test(kind)) return refreshCtl.request(kind);
  const [, id, key] = kind.split(':'); pickAct(id, key);
}
function pickAct(id, key) { pickFeedback(id, monitors.pickTap(id, key)); }
function pickFeedback(id, r) {
  const who = stations.find(s => s.id === id)?.name.split(' ')[0] || 'the team';
  if (r === 'empty') toast('Tap the badges you like first, then SUBMIT');
  else if (r === 'submit') toast(`📌 Sending your picks to ${who}…`);
  else if (r === 'already') toast(`${who} already has those picks`);
  else if (r === 'locked') toast('Picks sent. Waiting for the desk to confirm');
  if (r === 'submit') setTimeout(() => workPoll?.(), 20000);
}
let workPoll = null;
function tapAt(x, y) {
  if (paused || chat.isOpen()) return false;
  const r = canvasEl.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const k = refreshHit(); if (k) { act(k); return true; }
  return false;
}
function updateHover() {
  let k = null;
  if (!paused && !chat.isOpen() && !panelOpen) { camera.getWorldDirection(tmpV); raycaster.set(camera.position, tmpV); k = refreshHit(); }
  if (k === hoverKind) return;
  hoverKind = k;
  const pk = k && /^b?pick:/.test(k) ? k.split(':') : null, onBoard = pk && pk[0] === 'bpick';
  whiteboard.setHover(k === 'bank'); monitors.setHover(k === 'inbox' ? 'inbox' : null, true);
  if (!panelOpen) monitors.setPickHover(pk && !onBoard ? pk[1] : null, pk && !onBoard ? pk[2] : null);
  monitors.setBoardPickHover(onBoard ? pk[2] : null);
  if (pk) { ui.reticle.classList.add('hot'); ui.focus.classList.add('show'); ui.focus.textContent = pk[2] === 'submit' ? '📌 Submit your picks  ·  A / E / tap' : `Pick / unpick ${pk[2]}  ·  A / E / tap`; }
  else if (k) { ui.reticle.classList.add('hot'); ui.focus.classList.add('show'); ui.focus.textContent = `⟳ Refresh ${k === 'bank' ? 'bank balances' : 'Family Inbox'}  ·  A / E / tap`; }
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
  workPoll = poll; poll(); setInterval(poll, 12000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
// HQ #50: taps on a desk screen shown full size in the open desk panel (same canvas as the 3D monitor)
for (const s of stations) {
  const cv = monitors.canvas(s.id); if (!cv || s.hero) continue;
  const hit = (x, y) => { if (panelOpen !== s || !monitors.hasPick(s.id)) return false; const r = cv.getBoundingClientRect();
    const k = monitors.pickHit(s.id, { x: (x - r.left) / r.width, y: 1 - (y - r.top) / r.height }); if (k) { monitors.setPickHover(s.id, k); pickAct(s.id, k); } return !!k; };
  cv.addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (t && hit(t.clientX, t.clientY)) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });
  cv.addEventListener('click', e => { if (e.pointerType === 'touch') return; if (hit(e.clientX, e.clientY)) e.stopPropagation(); });
}
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
      const pickPanel = panelOpen && monitors.hasPick(panelOpen.id);
      if (gp.X && panelOpen && REFRESH_KIND[panelOpen.id]) refreshCtl.request(REFRESH_KIND[panelOpen.id]);
      if (gp.X && pickPanel) pickFeedback(panelOpen.id, monitors.pickPress(panelOpen.id));
      if (gp.B) closePanel();
      if (pickPanel && (gp.dpad.left || gp.dpad.right)) monitors.pickMove(panelOpen.id, gp.dpad.right ? 1 : -1); // D-pad walks the pick cards
      else { if (gp.Y || gp.dpad.right) nextStation(1); if (gp.dpad.left) nextStation(-1); }
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
  if (resume.layout !== LAYOUT || blocked(resume.x, resume.z)) { player.pos.set(0, 0, 6.9); player.yaw = 0; player.pitch = 0; resume.newLayout = true; }
  if (!resume.paused) setPaused(false);
  if (resume.chat) { chat.show(stations.find(s => s.id === resume.chat.to) || stations.find(s => s.hero)); chat.restoreDraft(resume.chat); }
  else if (resume.draft?.text) chat.restoreDraft(resume.draft);
  setTimeout(() => toast(resume.newLayout ? 'Welcome to Dunder Mifflin Scranton: tighter, set-size floor' : 'Office updated'), 300);
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
window.__office = { IDLE_SPOTS, blocked, freeStand, player, stations, setPaused, nextStation, IS_IOS, CAN_LOCK, chat, openChat, snapshot, workers, monitors, whiteboard, camera, colliders, ROOMS, LAYOUT };

// ---------- PWA: offline-capable once loaded (network-first, so updates show up right away) ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
